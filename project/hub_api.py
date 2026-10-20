"""Authenticated, version-checked moderation with isolated Faculty / Industry routes."""
from datetime import date, datetime
from functools import wraps
from math import ceil
from flask import g, jsonify, request, send_file
from flask_login import current_user
from sqlalchemy import select, text, func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge
from account_service import account_role
from attachment_files import AttachmentError, validate_external_url
from hub_files import validate_hub_file
from storage import StorageWriteError


def register_hub_api(app, db, User, Entry, Revision, Attachment, Event, roles_required, limiter, DeletionAudit):
    assets = app.extensions['file_asset_service']

    def request_kind():
        # Route identity, never client-provided JSON/query fields, selects the namespace.
        return 'industry' if request.path.startswith('/api/hub/industry/') else 'faculty'

    def fail(message, code='HUB_VALIDATION_ERROR', status=400):
        raise AttachmentError(message, code, status)

    def actor():
        return getattr(g, 'hub_actor', current_user)

    def owns(entry):
        user = actor()
        return user.is_authenticated and (account_role(user.role) == 'admin' or
            account_role(user.role) == 'teacher' and entry.owner_id == user.id)

    def revision_for(entry, identifier):
        return db.session.scalar(select(Revision).where(Revision.entry_id == entry.id, Revision.id == identifier)) if identifier else None

    def published(entry):
        revision = revision_for(entry, entry.published_revision_id)
        return revision if entry.archived_at is None and revision and revision.state == 'approved' else None

    def approved_snapshot(entry):
        revision = revision_for(entry, entry.published_revision_id)
        return revision if revision and revision.state == 'approved' else None

    def can_read(revision, _attachment):
        if not actor().is_authenticated:
            return False
        entry = db.session.get(Entry, revision.entry_id)
        return bool(entry and entry.kind in {'faculty', 'industry'} and
                    (owns(entry) or published(entry) is not None and entry.published_revision_id == revision.id))

    def can_manage(revision):
        entry = db.session.get(Entry, revision.entry_id)
        return bool(entry and owns(entry) and not entry.archived_at and
                    revision.id == entry.working_revision_id and revision.state == 'draft')

    assets.register_resource('hub', Attachment, 'revision_id', can_read=can_read, can_manage=can_manage)

    @app.before_request
    def hub_body_limit():
        if request.path.startswith('/api/hub/'):
            request.max_content_length = 64 * 1024 * 1024 if request.mimetype == 'multipart/form-data' else 64 * 1024

    @app.after_request
    def hub_headers(response):
        if request.path.startswith('/api/hub/'):
            response.headers['Cache-Control'] = 'private, no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.vary.add('Cookie')
        return response

    def guarded(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            g.hub_new_keys = []
            try:
                if request.method not in {'GET', 'HEAD'}:
                    if request.args:
                        fail('Query parameters are not supported for this action.')
                    uid, version = current_user.id, current_user.auth_version
                    db.session.rollback()
                    if db.engine.dialect.name == 'sqlite':
                        db.session.execute(text('BEGIN IMMEDIATE'))
                    user = db.session.scalar(select(User).where(User.id == uid).with_for_update())
                    if user is None or not user.is_active or user.auth_version != version:
                        fail('Authentication required.', 'AUTH_REQUIRED', 401)
                    g.hub_actor = user
                return view(*args, **kwargs)
            except (AttachmentError, BadRequest, RequestEntityTooLarge) as error:
                db.session.rollback()
                assets.compensate(g.hub_new_keys)
                if isinstance(error, AttachmentError):
                    return jsonify(error=str(error), code=error.code), error.status
                return jsonify(error='Invalid or oversized Hub request.', code='HUB_VALIDATION_ERROR'), 413 if isinstance(error, RequestEntityTooLarge) else 400
            except (OSError, ValueError, SQLAlchemyError) as error:
                db.session.rollback()
                if isinstance(error, StorageWriteError):
                    g.hub_new_keys.append(error.storage_key)
                assets.compensate(g.hub_new_keys)
                app.logger.error('Hub operation failed category=%s', type(error).__name__)
                return jsonify(error='Hub is unavailable. Refresh and retry.', code='HUB_CONFLICT' if isinstance(error, IntegrityError) else 'HUB_UNAVAILABLE'), 409 if isinstance(error, IntegrityError) else 503
        # Apply the limiter after wraps assigns each original endpoint's identity.
        # Decorating the unnamed inner wrapper registered all Hub limits together.
        return roles_required('student', 'teacher', 'admin')(
            limiter.limit('120/minute', exempt_when=lambda: app.testing)(wrapped))

    def payload(required, optional=()):
        data = request.get_json(silent=True)
        if not request.is_json or not isinstance(data, dict) or not set(required) <= set(data) or set(data) - set(required) - set(optional):
            fail('Invalid or unknown fields.')
        return data

    def positive(value):
        return type(value) is int and 1 <= value <= 2147483647

    def content(data):
        result = {}
        for key, column, limit, required in [('title','title',200,True), ('body','body',10000,False),
                ('sourceName','source_name',300,False), ('sourceUrl','source_url',1500,False)]:
            value = data.get(key, '' if key == 'body' else None)
            if value is None and not required:
                result[column] = '' if key == 'body' else None
                continue
            if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 and c not in '\n\r\t' for c in value):
                fail(f'{key} must be text of at most {limit} characters.')
            value = value.strip()
            if required and not value:
                fail('A title is required.')
            result[column] = value if key == 'body' else value or None
        if result['source_url']:
            result['source_url'] = validate_external_url(result['source_url'])
        if request_kind() == 'industry':
            if not result['body'] or not result['source_name']:
                fail('A description and a real source name are required.')
            value = data.get('sourceDate')
            try:
                result['source_date'] = None if value in (None, '') else date.fromisoformat(value)
                if value not in (None, '') and result['source_date'].isoformat() != value:
                    raise ValueError('Use YYYY-MM-DD.')
            except (TypeError, ValueError):
                fail('Source date must be a real date in YYYY-MM-DD format.')
        return result

    def entry_for(identifier, *, manage=False):
        query = select(Entry).where(Entry.id == identifier, Entry.kind == request_kind())
        entry = db.session.scalar(query.with_for_update() if request.method not in {'GET', 'HEAD'} else query)
        if entry is None or (manage and not owns(entry)) or (not manage and published(entry) is None):
            fail('Industry update is not available.' if request_kind() == 'industry' else
                 'Faculty resource is not available.', 'HUB_NOT_FOUND', 404)
        return entry

    def token(entry, data):
        expected = data.get('expectedVersion')
        if isinstance(expected, str) and expected.isascii() and expected.isdecimal():
            expected = int(expected)
        if not positive(expected):
            fail('A valid expectedVersion is required.')
        if expected != entry.version:
            fail('This resource changed. Refresh before editing.', 'HUB_CONFLICT', 409)

    def working(entry, state='draft'):
        revision = revision_for(entry, entry.working_revision_id)
        if entry.archived_at or revision is None or revision.state != state:
            fail('This action is not allowed in the current state.', 'HUB_STATE_CONFLICT', 409)
        return revision

    def event(entry, revision, action, note=None):
        db.session.add(Event(entry_id=entry.id, revision_id=revision.id if revision else None,
                             actor_id=actor().id, action=action, note=note))
        entry.version += 1
        entry.updated_at = datetime.utcnow()

    def status(entry):
        if entry.archived_at:
            return 'archived'
        if published(entry):
            return 'published'
        revision = revision_for(entry, entry.working_revision_id)
        return revision.state if revision else 'draft'

    def serialize_revision(revision, *, manage=False):
        if revision is None:
            return None
        attachments = db.session.scalars(select(Attachment).where(Attachment.revision_id == revision.id).order_by(Attachment.id)).all()
        items = []
        for item in attachments:
            assets.authorize('hub', revision, item)
            asset = item.asset
            prefix = '/api/hub/industry/entries' if db.session.get(Entry, revision.entry_id).kind == 'industry' else '/api/hub/entries'
            items.append(dict(id=item.id, displayName=item.display_name, attachmentType=asset.asset_type,
                mimeType=asset.mime_type, fileSize=asset.file_size, externalUrl=asset.external_url,
                downloadUrl=None if asset.external_url else f'{prefix}/{revision.entry_id}/revisions/{revision.id}/attachments/{item.id}/download'))
        result = dict(id=revision.id, number=revision.number, title=revision.title, body=revision.body,
                      sourceName=revision.source_name, sourceUrl=revision.source_url, attachments=items)
        industry = db.session.get(Entry, revision.entry_id).kind == 'industry'
        if industry:
            result.update(sourceDate=revision.source_date.isoformat() if revision.source_date else None,
                          createdAt=revision.created_at.isoformat()+'Z')
        if manage:
            result.update(state=revision.state, reviewNote=revision.review_note,
                          submittedAt=revision.submitted_at.isoformat()+'Z' if revision.submitted_at else None)
            if industry:
                result.update(reviewedById=revision.reviewed_by_id,
                              reviewedAt=revision.reviewed_at.isoformat()+'Z' if revision.reviewed_at else None)
        return result

    def serialize(entry, *, manage=False):
        result = dict(id=entry.id, kind=entry.kind, status=status(entry),
                      published=serialize_revision(approved_snapshot(entry) if manage else published(entry), manage=manage))
        if entry.kind == 'industry':
            live = published(entry)
            result.update(submittedById=entry.owner_id, createdAt=entry.created_at.isoformat()+'Z',
                          updatedAt=(entry.updated_at if manage else (live.reviewed_at or live.created_at) if live else entry.created_at).isoformat()+'Z')
        if manage:
            result.update(version=entry.version, ownerId=entry.owner_id,
                          working=serialize_revision(revision_for(entry, entry.working_revision_id), manage=True))
        return result

    def saved(entry, response_status=200):
        db.session.commit()
        return jsonify(entry=serialize(entry, manage=True)), response_status

    @app.get('/api/hub/industry/entries')
    @app.get('/api/hub/entries')
    @guarded
    def hub_list():
        if set(request.args) - {'scope', 'page'} or any(len(request.args.getlist(k)) != 1 for k in request.args):
            fail('Invalid or repeated list parameters.')
        scope, page = request.args.get('scope', 'published'), request.args.get('page', '1')
        scopes = {'published', 'mine', 'review', 'all'} if request_kind() == 'industry' else {'published', 'mine', 'review'}
        if scope not in scopes or not page.isascii() or not page.isdecimal() or len(page) > 5 or not 1 <= int(page) <= 10000:
            fail('Invalid list parameters.')
        query = select(Entry).where(Entry.kind == request_kind())
        manage = scope != 'published'
        if scope == 'published':
            query = query.join(Revision, (Revision.id == Entry.published_revision_id) & (Revision.entry_id == Entry.id)).where(
                Entry.archived_at.is_(None), Revision.state == 'approved')
        elif scope == 'mine':
            if account_role(actor().role) not in {'teacher','admin'}:
                fail('Access denied.', 'FORBIDDEN', 403)
            query = query.where(Entry.owner_id == actor().id)
        else:
            if account_role(actor().role) != 'admin':
                fail('Access denied.', 'FORBIDDEN', 403)
            if request_kind() == 'industry' and scope == 'review':
                query = query.join(Revision, (Revision.id == Entry.working_revision_id) & (Revision.entry_id == Entry.id)).where(
                    Entry.archived_at.is_(None), Revision.state == 'pending')
        total = db.session.scalar(select(func.count()).select_from(query.subquery()))
        rows = db.session.scalars(query.order_by(Entry.id.desc()).limit(12).offset((int(page)-1)*12)).all()
        return jsonify(entries=[serialize(row, manage=manage) for row in rows], page=int(page), total=total, totalPages=ceil(total/12))

    @app.get('/api/hub/industry/entries/<int:entry_id>')
    @app.get('/api/hub/entries/<int:entry_id>')
    @guarded
    def hub_detail(entry_id):
        if request.args:
            fail('Query parameters are not supported.')
        return jsonify(entry=serialize(entry_for(entry_id)))

    @app.get('/api/hub/industry/entries/<int:entry_id>/manage')
    @app.get('/api/hub/entries/<int:entry_id>/manage')
    @guarded
    def hub_managed_detail(entry_id):
        if request.args:
            fail('Query parameters are not supported.')
        return jsonify(entry=serialize(entry_for(entry_id, manage=True), manage=True))

    @app.post('/api/hub/industry/entries')
    @app.post('/api/hub/entries')
    @guarded
    def hub_create():
        if account_role(actor().role) not in {'teacher','admin'}:
            fail('Access denied.', 'FORBIDDEN', 403)
        data = (payload({'title', 'body', 'sourceName'}, {'sourceUrl', 'sourceDate'}) if request_kind() == 'industry'
                else payload({'title'}, {'body', 'sourceName', 'sourceUrl'}))
        entry = Entry(kind=request_kind(), owner_id=actor().id)
        db.session.add(entry); db.session.flush()
        revision = Revision(entry_id=entry.id, number=1, **content(data))
        db.session.add(revision); db.session.flush()
        entry.working_revision_id = revision.id
        event(entry, revision, 'created')
        return saved(entry, 201)

    @app.patch('/api/hub/industry/entries/<int:entry_id>')
    @app.patch('/api/hub/entries/<int:entry_id>')
    @guarded
    def hub_edit(entry_id):
        entry = entry_for(entry_id, manage=True)
        data = (payload({'expectedVersion', 'title', 'body', 'sourceName'}, {'sourceUrl', 'sourceDate'}) if request_kind() == 'industry'
                else payload({'expectedVersion', 'title'}, {'body','sourceName','sourceUrl'}))
        token(entry, data); revision = working(entry)
        for key, value in content(data).items():
            setattr(revision, key, value)
        event(entry, revision, 'edited')
        return saved(entry)

    @app.post('/api/hub/industry/entries/<int:entry_id>/draft')
    @app.post('/api/hub/entries/<int:entry_id>/draft')
    @guarded
    def hub_new_draft(entry_id):
        entry = entry_for(entry_id, manage=True)
        token(entry, payload({'expectedVersion'}))
        previous = revision_for(entry, entry.working_revision_id) or published(entry)
        if entry.archived_at or previous is None or previous.state not in {'approved', 'rejected'}:
            fail('A new draft is not available in this state.', 'HUB_STATE_CONFLICT', 409)
        revision = Revision(entry_id=entry.id, number=next_revision_number(entry), title=previous.title, body=previous.body,
                            source_name=previous.source_name, source_url=previous.source_url, source_date=previous.source_date)
        db.session.add(revision); db.session.flush()
        for item in db.session.scalars(select(Attachment).where(Attachment.revision_id == previous.id)).all():
            db.session.add(Attachment(revision_id=revision.id, asset_id=item.asset_id, display_name=item.display_name))
        entry.working_revision_id = revision.id
        event(entry, revision, 'draft_created')
        return saved(entry)

    @app.post('/api/hub/industry/entries/<int:entry_id>/<action>')
    @app.post('/api/hub/entries/<int:entry_id>/<action>')
    @guarded
    def hub_transition(entry_id, action):
        if action not in {'submit', 'withdraw', 'approve', 'reject', 'archive'}:
            fail('Action not found.', 'HUB_NOT_FOUND', 404)
        entry = entry_for(entry_id, manage=True)
        data = payload({'expectedVersion'}, {'reviewNote'} if action == 'reject' else ())
        token(entry, data)
        if action in {'approve', 'reject', 'archive'} and account_role(actor().role) != 'admin':
            fail('Only administrators can review or archive Hub content.', 'FORBIDDEN', 403)
        if action == 'archive':
            if entry.archived_at:
                fail('Resource is already archived.', 'HUB_STATE_CONFLICT', 409)
            entry.archived_at = datetime.utcnow()
            revision = revision_for(entry, entry.working_revision_id)
            event(entry, revision, 'archived')
        else:
            revision = working(entry, 'draft' if action == 'submit' else 'pending')
            if action == 'submit':
                revision.state, revision.submitted_at = 'pending', datetime.utcnow()
            elif action == 'withdraw':
                revision.state, revision.submitted_at = 'draft', None
            else:
                note = data.get('reviewNote')
                if action == 'reject' and (not isinstance(note, str) or not note.strip() or len(note) > 2000):
                    fail('Provide a rejection reason of 1–2000 characters.')
                revision.state = 'approved' if action == 'approve' else 'rejected'
                revision.reviewed_by_id, revision.reviewed_at = actor().id, datetime.utcnow()
                revision.review_note = note.strip() if note else None
                if action == 'approve':
                    entry.published_revision_id = revision.id
                    entry.working_revision_id = None
            event(entry, revision, {'submit':'submitted','withdraw':'withdrawn','approve':'approved','reject':'rejected'}[action], revision.review_note)
        return saved(entry)

    def deletion_receipt(entry, snapshot, discard=None):
        # One receipt per entry already exists in the schema. Revision cleanup
        # appends minimal facts; later whole-entry deletion preserves these facts.
        receipt = db.session.scalar(select(DeletionAudit).where(
            DeletionAudit.original_entry_id == entry.id).with_for_update())
        discarded = list((receipt.snapshot or {}).get('discardedRevisions', [])) if receipt else []
        if discard is not None:
            discarded.append(discard)
        snapshot = dict(operation='revision_discarded' if discard else 'entry_deleted', **snapshot)
        if discarded:
            snapshot['discardedRevisions'] = discarded
        if receipt is None:
            db.session.add(DeletionAudit(original_entry_id=entry.id, actor_id=actor().id, snapshot=snapshot))
        else:
            receipt.actor_id, receipt.created_at, receipt.snapshot = actor().id, datetime.utcnow(), snapshot

    def next_revision_number(entry):
        highest = db.session.scalar(select(func.max(Revision.number)).where(Revision.entry_id == entry.id)) or 0
        receipt = db.session.scalar(select(DeletionAudit).where(DeletionAudit.original_entry_id == entry.id))
        discarded = (receipt.snapshot or {}).get('discardedRevisions', []) if receipt else []
        return max([highest, *[row['number'] for row in discarded]]) + 1

    def discard_working_revision(entry):
        revision = revision_for(entry, entry.working_revision_id)
        if (entry.archived_at or approved_snapshot(entry) is None or revision is None or
                revision.id == entry.published_revision_id or revision.state not in {'draft', 'rejected'}):
            fail('Only a Draft or Rejected working revision can be discarded. Withdraw pending revisions first.', 'HUB_STATE_CONFLICT', 409)
        items = db.session.scalars(select(Attachment).where(Attachment.revision_id == revision.id)).all()
        asset_ids = [row.asset_id for row in items]
        keys = [row.asset.storage_key for row in items if row.asset.storage_key]
        deletion_receipt(entry, dict(kind=entry.kind, ownerId=entry.owner_id, version=entry.version,
            publishedRevisionId=entry.published_revision_id), discard=dict(id=revision.id, number=revision.number,
            state=revision.state, actorId=actor().id, createdAt=datetime.utcnow().isoformat()+'Z'))
        # Retain moderation history without a dangling FK to the removed revision.
        for row in db.session.scalars(select(Event).where(Event.revision_id == revision.id)).all():
            row.revision_id = None
        for row in items:
            db.session.delete(row)
        entry.working_revision_id = None
        entry.version += 1
        entry.updated_at = datetime.utcnow()
        db.session.flush()
        db.session.delete(revision)
        assets.retire_unreferenced(asset_ids)
        return keys

    @app.post('/api/hub/industry/entries/<int:entry_id>/discard-revision')
    @app.post('/api/hub/entries/<int:entry_id>/discard-revision')
    @guarded
    def hub_discard_revision(entry_id):
        entry = entry_for(entry_id, manage=True)
        data = payload({'expectedVersion', 'confirmation'}); token(entry, data)
        if data['confirmation'] != 'DISCARD':
            fail('Confirm discarding this working revision.')
        keys = discard_working_revision(entry)
        db.session.commit()
        pending = assets.drain_cleanup(keys)
        return jsonify(entry=serialize(entry, manage=True), cleanupPending=bool(pending))

    @app.delete('/api/hub/industry/entries/<int:entry_id>')
    @app.delete('/api/hub/entries/<int:entry_id>')
    @guarded
    def hub_delete(entry_id):
        entry = entry_for(entry_id, manage=True)
        data = payload({'expectedVersion', 'confirmation'})
        token(entry, data)
        if data['confirmation'] != 'DELETE':
            fail('Type DELETE to confirm permanent deletion.')
        revisions = db.session.scalars(select(Revision).where(Revision.entry_id == entry.id).order_by(Revision.number)).all()
        events = db.session.scalars(select(Event).where(Event.entry_id == entry.id).order_by(Event.id)).all()
        # An archived entry or a working draft does not erase its publication history.
        ever_published = bool(entry.published_revision_id or any(row.state == 'approved' for row in revisions)
                              or any(row.action == 'approved' for row in events))
        current = revision_for(entry, entry.working_revision_id)
        if ever_published:
            if request_kind() != 'industry' or account_role(actor().role) != 'admin':
                fail('Previously published content cannot be deleted as a draft.', 'FORBIDDEN', 403)
        elif current is None or current.state not in {'draft', 'rejected'}:
            fail('Withdraw pending updates to Draft before deleting.', 'HUB_STATE_CONFLICT', 409)
        ids = [row.id for row in revisions]
        attachments = db.session.scalars(select(Attachment).where(Attachment.revision_id.in_(ids))).all()
        asset_ids = [row.asset_id for row in attachments]
        keys = [row.asset.storage_key for row in attachments if row.asset.storage_key]
        # Keep an attributable receipt, not a hidden copy of deleted content/files.
        deletion_receipt(entry, {
            'kind': entry.kind, 'ownerId': entry.owner_id, 'version': entry.version,
            'everPublished': ever_published, 'archived': entry.archived_at is not None,
            'publishedRevisionId': entry.published_revision_id, 'workingRevisionId': entry.working_revision_id,
            'revisions': [{'id': row.id, 'number': row.number, 'state': row.state} for row in revisions],
            'attachmentCount': len(attachments),
            'moderation': [{'action': row.action, 'actorId': row.actor_id, 'revisionId': row.revision_id,
                            'createdAt': row.created_at.isoformat()+'Z'} for row in events],
        })
        # Explicit ordering honors RESTRICT constraints; the guard makes all changes atomic.
        for row in events:
            db.session.delete(row)
        for row in attachments:
            db.session.delete(row)
        db.session.flush()
        entry.published_revision_id = entry.working_revision_id = None
        for row in revisions:
            db.session.delete(row)
        db.session.flush()
        db.session.delete(entry)
        assets.retire_unreferenced(asset_ids)
        db.session.commit()
        pending = assets.drain_cleanup(keys)
        return jsonify(deleted=True, cleanupPending=bool(pending))

    @app.post('/api/hub/industry/entries/<int:entry_id>/attachments')
    @app.post('/api/hub/entries/<int:entry_id>/attachments')
    @limiter.limit('10/minute', exempt_when=lambda: app.testing)
    @guarded
    def hub_upload(entry_id):
        entry = entry_for(entry_id, manage=True)
        if request.is_json:
            data = payload({'expectedVersion', 'displayName', 'externalUrl'})
            values = dict(attachment_type='external_link', external_url=validate_external_url(data['externalUrl']))
        else:
            if request.mimetype != 'multipart/form-data' or set(request.files) != {'file'} or len(request.files.getlist('file')) != 1 or any(len(request.form.getlist(k)) != 1 for k in request.form):
                fail('Exactly one file and valid metadata are required.')
            data = request.form.to_dict()
            if set(data) != {'expectedVersion','displayName','attachmentType'}:
                fail('Invalid or unknown attachment fields.')
            values = dict(attachment_type=data['attachmentType'])
        token(entry, data); revision = working(entry)
        name = data.get('displayName')
        if not isinstance(name, str) or not name.strip() or len(name) > 300:
            fail('An attachment name of 1–300 characters is required.')
        if db.session.scalar(select(func.count()).select_from(Attachment).where(Attachment.revision_id == revision.id)) >= 20:
            fail('A resource can have at most 20 attachments.')
        if values['attachment_type'] != 'external_link':
            metadata, extension = validate_hub_file(request.files['file'], values['attachment_type'], app.config['ATTACHMENT_FILE_LIMITS'])
            key = assets.save('hub', revision, request.files['file'].stream, extension)
            g.hub_new_keys.append(key)
            values.update(metadata, storage_key=key)
        asset = assets.create('hub', revision, values, actor().id)
        db.session.add(Attachment(revision_id=revision.id, asset_id=asset.id, display_name=name.strip()))
        event(entry, revision, 'attachment_added')
        return saved(entry, 201)

    @app.delete('/api/hub/industry/entries/<int:entry_id>/attachments/<int:attachment_id>')
    @app.delete('/api/hub/entries/<int:entry_id>/attachments/<int:attachment_id>')
    @guarded
    def hub_remove_attachment(entry_id, attachment_id):
        entry = entry_for(entry_id, manage=True)
        token(entry, payload({'expectedVersion'})); revision = working(entry)
        item = db.session.scalar(select(Attachment).where(Attachment.id == attachment_id, Attachment.revision_id == revision.id))
        if item is None:
            fail('Attachment not found.', 'HUB_NOT_FOUND', 404)
        asset_id, key = item.asset_id, item.asset.storage_key
        db.session.delete(item)
        assets.retire_unreferenced([asset_id])
        event(entry, revision, 'attachment_removed')
        db.session.commit()
        assets.drain_cleanup([key] if key else [])
        return jsonify(entry=serialize(entry, manage=True))

    @app.get('/api/hub/industry/entries/<int:entry_id>/revisions/<int:revision_id>/attachments/<int:attachment_id>/download')
    @app.get('/api/hub/entries/<int:entry_id>/revisions/<int:revision_id>/attachments/<int:attachment_id>/download')
    @guarded
    def hub_download(entry_id, revision_id, attachment_id):
        if request.args:
            fail('Query parameters are not supported.')
        entry = db.session.get(Entry, entry_id)
        revision = revision_for(entry, revision_id) if entry and entry.kind == request_kind() else None
        item = db.session.scalar(select(Attachment).where(Attachment.id == attachment_id, Attachment.revision_id == revision_id))
        if revision is None or item is None or not can_read(revision, item):
            fail('Attachment is not available.', 'HUB_NOT_FOUND', 404)
        file = assets.open('hub', revision, item)
        response = send_file(file, mimetype=item.asset.mime_type, download_name=item.asset.original_filename,
                             as_attachment=True, conditional=False, etag=False, max_age=0)
        response.headers['Content-Security-Policy'] = "sandbox; default-src 'none'"
        return response

    @app.get('/api/hub/industry/entries/<int:entry_id>/history')
    @app.get('/api/hub/entries/<int:entry_id>/history')
    @guarded
    def hub_history(entry_id):
        entry = entry_for(entry_id, manage=True)
        if request.args:
            fail('Query parameters are not supported.')
        rows = db.session.scalars(select(Event).where(Event.entry_id == entry.id).order_by(Event.id.desc()).limit(100)).all()
        items = []
        for row in rows:
            item = dict(id=row.id, action=row.action, actorId=row.actor_id, revisionId=row.revision_id,
                        note=row.note, createdAt=row.created_at.isoformat()+'Z')
            if entry.kind == 'industry':
                revision = revision_for(entry, row.revision_id)
                item.update(contentAuthorId=entry.owner_id, revisionNumber=revision.number if revision else None,
                            sourceName=revision.source_name if revision else None)
            items.append(item)
        return jsonify(events=items)

    # Reuse the established transaction/session, concurrency and audit boundary.
    # Discussion-specific publication/parent rules live in their own adapter.
    app.extensions['hub_moderation'] = dict(guarded=guarded, actor=actor, fail=fail,
        payload=payload, token=token, revision_for=revision_for, working=working,
        event=event, status=status, published=published, approved_snapshot=approved_snapshot,
        deletion_receipt=deletion_receipt, discard_working_revision=discard_working_revision, next_revision_number=next_revision_number)
