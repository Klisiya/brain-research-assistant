"""Text-only, fully moderated threads/replies; shared Hub transaction primitives."""
from datetime import datetime
from math import ceil
from flask import jsonify, request
from sqlalchemy import select, func
from account_service import account_role


def register_discussion_api(app, db, User, Entry, Revision, Attachment, Event, DeletionAudit, Discussion, Report, ReportEvent):
    shared = app.extensions['hub_moderation']
    guarded, actor, fail, payload = (shared[key] for key in ['guarded','actor','fail','payload'])
    token, revision_for, working, event = (shared[key] for key in ['token','revision_for','working','event'])
    base = '/api/hub/discussions'

    @app.before_request
    def discussion_body_limit():
        if request.path.startswith(base+'/'):
            request.max_content_length = 64 * 1024

    def admin():
        return account_role(actor().role) == 'admin'

    def require_admin():
        if not admin():
            fail('Administrator access required.', 'FORBIDDEN', 403)

    def positive(value):
        return type(value) is int and 0 < value <= 2147483647

    def lookup(identifier, manage=False):
        if not positive(identifier):
            fail('Discussion is not available.', 'HUB_NOT_FOUND', 404)
        relation = db.session.get(Discussion, identifier)
        if relation is None:
            fail('Discussion is not available.', 'HUB_NOT_FOUND', 404)
        # All writes acquire the parent before the reply. Deletion uses the same order.
        lock = request.method not in {'GET','HEAD'}
        if relation.thread_id:
            query = select(Entry).where(Entry.id == relation.thread_id, Entry.kind == 'discussions')
            parent = db.session.scalar(query.with_for_update() if lock else query)
            parent_relation = db.session.get(Discussion, relation.thread_id)
            if parent is None or parent_relation is None or parent_relation.thread_id is not None:
                fail('Discussion is not available.', 'HUB_NOT_FOUND', 404)
        query = select(Entry).where(Entry.id == identifier, Entry.kind == 'discussions')
        entry = db.session.scalar(query.with_for_update() if lock else query)
        if entry is None or manage and not (admin() or entry.owner_id == actor().id):
            fail('Discussion is not available.', 'HUB_NOT_FOUND', 404)
        if not manage and live(entry) is None:
            fail('Discussion is not available.', 'HUB_NOT_FOUND', 404)
        return entry, relation

    def live(entry):
        if entry is None or entry.kind != 'discussions':
            return None
        revision = shared['published'](entry)
        relation = db.session.get(Discussion, entry.id)
        if revision is None or relation is None:
            return None
        if relation.thread_id:
            parent = db.session.get(Entry, relation.thread_id)
            parent_relation = db.session.get(Discussion, relation.thread_id)
            if parent is None or parent.kind != 'discussions' or parent_relation is None or parent_relation.thread_id is not None or shared['published'](parent) is None:
                return None
        return revision

    def parent_open(relation):
        if relation.thread_id and live(db.session.get(Entry, relation.thread_id)) is None:
            fail('The parent thread is unavailable for new discussion activity.', 'HUB_STATE_CONFLICT', 409)

    def text(value, name, maximum, required=True):
        if value is None and not required:
            return None
        if not isinstance(value, str) or len(value) > maximum or any(ord(char) < 32 and char not in '\n\r\t' for char in value):
            fail(f'{name} must be text of at most {maximum} characters.')
        value = value.strip()
        if required and not value:
            fail(f'{name} is required.')
        return value or None

    def revision_data(revision, manage=False, reply=False):
        if revision is None:
            return None
        result = dict(number=revision.number, body=revision.body,
                      publishedAt=revision.reviewed_at.isoformat()+'Z' if revision.state=='approved' and revision.reviewed_at else None)
        if not reply:
            result['title'] = revision.title
        if manage:
            result.update(state=revision.state, reviewNote=revision.review_note)
        return result

    def serialize(entry, manage=False):
        relation = db.session.get(Discussion, entry.id)
        author = db.session.get(User, entry.owner_id)
        result = dict(id=entry.id, type='reply' if relation.thread_id else 'thread', threadId=relation.thread_id,
            canManage=admin() or entry.owner_id == actor().id,
            author=author.username, published=revision_data(shared['approved_snapshot'](entry) if manage else live(entry), manage, bool(relation.thread_id)))
        if manage:
            result.update(status=shared['status'](entry), version=entry.version,isAuthor=entry.owner_id==actor().id,
                working=revision_data(revision_for(entry, entry.working_revision_id), True, bool(relation.thread_id)))
        return result

    def saved(entry, status=200):
        db.session.commit()
        return jsonify(entry=serialize(entry, True)), status

    def page_query(allowed):
        if set(request.args)-set(allowed)-{'page'} or any(len(request.args.getlist(key)) != 1 for key in request.args):
            fail('Invalid or repeated query parameters.')
        value = request.args.get('page','1')
        if not value.isascii() or not value.isdecimal() or len(value)>5 or not 1 <= int(value) <= 10000:
            fail('Invalid pagination.')
        return int(value)

    def page_result(query, page, serializer):
        total = db.session.scalar(select(func.count()).select_from(query.subquery()))
        rows = db.session.scalars(query.limit(12).offset((page-1)*12)).all()
        return dict(entries=[serializer(row) for row in rows], page=page, total=total, totalPages=ceil(total/12))

    @app.get(base+'/entries')
    @guarded
    def discussion_list():
        page = page_query({'scope'})
        scope = request.args.get('scope','published')
        query = select(Entry).join(Discussion, Discussion.entry_id == Entry.id).where(Entry.kind == 'discussions')
        if scope == 'published':
            query = query.join(Revision, (Revision.id == Entry.published_revision_id)&(Revision.entry_id == Entry.id)).where(
                Discussion.thread_id.is_(None), Entry.archived_at.is_(None), Revision.state == 'approved')
        elif scope == 'mine':
            query = query.where(Entry.owner_id == actor().id)
        elif scope in {'all','review'}:
            require_admin()
            if scope == 'review':
                query = query.join(Revision, (Revision.id == Entry.working_revision_id)&(Revision.entry_id == Entry.id)).where(Entry.archived_at.is_(None), Revision.state == 'pending')
        else:
            fail('Invalid discussion scope.')
        return jsonify(page_result(query.order_by(Entry.id.desc()), page, lambda row:serialize(row,scope!='published')))

    @app.get(base+'/entries/<int:entry_id>')
    @guarded
    def discussion_detail(entry_id):
        page_query(set())
        entry, _ = lookup(entry_id)
        return jsonify(entry=serialize(entry))

    @app.get(base+'/entries/<int:entry_id>/manage')
    @guarded
    def discussion_manage(entry_id):
        page_query(set())
        entry, _ = lookup(entry_id, True)
        return jsonify(entry=serialize(entry, True))

    @app.get(base+'/entries/<int:entry_id>/replies')
    @guarded
    def discussion_replies(entry_id):
        page = page_query(set())
        _, relation = lookup(entry_id)
        if relation.thread_id:
            fail('Replies can only belong to a thread.')
        query = select(Entry).join(Discussion, Discussion.entry_id == Entry.id).join(Revision,
            (Revision.id == Entry.published_revision_id)&(Revision.entry_id == Entry.id)).where(
            Entry.kind == 'discussions', Discussion.thread_id == entry_id, Entry.archived_at.is_(None), Revision.state == 'approved').order_by(Entry.id)
        return jsonify(page_result(query, page, serialize))

    def create(data, thread_id=None):
        entry = Entry(kind='discussions', owner_id=actor().id)
        db.session.add(entry); db.session.flush()
        db.session.add(Discussion(entry_id=entry.id, thread_id=thread_id))
        revision = Revision(entry_id=entry.id, number=1,
            title='Reply' if thread_id else text(data['title'],'Title',200), body=text(data['body'],'Body',10000))
        db.session.add(revision); db.session.flush()
        entry.working_revision_id = revision.id
        event(entry, revision, 'created')
        return saved(entry,201)

    @app.post(base+'/entries')
    @guarded
    def discussion_create():
        return create(payload({'title','body'}))

    @app.post(base+'/entries/<int:entry_id>/replies')
    @guarded
    def discussion_create_reply(entry_id):
        _, relation = lookup(entry_id)
        if relation.thread_id:
            fail('Nested replies are not supported.')
        return create(payload({'body'}),entry_id)

    @app.patch(base+'/entries/<int:entry_id>')
    @guarded
    def discussion_edit(entry_id):
        entry, relation = lookup(entry_id,True)
        parent_open(relation)
        data = payload({'expectedVersion','body'} if relation.thread_id else {'expectedVersion','title','body'})
        token(entry,data); revision = working(entry)
        revision.body = text(data['body'],'Body',10000)
        if not relation.thread_id:
            revision.title = text(data['title'],'Title',200)
        event(entry,revision,'edited')
        return saved(entry)

    @app.post(base+'/entries/<int:entry_id>/<action>')
    @guarded
    def discussion_action(entry_id,action):
        if action not in {'draft','submit','withdraw','approve','reject','archive','publish'}:
            fail('Action not found.','HUB_NOT_FOUND',404)
        entry, relation = lookup(entry_id,True)
        data = payload({'expectedVersion'},{'reviewNote'} if action == 'reject' else ())
        token(entry,data)
        if action in {'approve','reject','archive'}:
            require_admin()
        if action == 'archive':
            if shared['approved_snapshot'](entry) is None:
                fail('Only published content can be archived. Withdraw pending content before deletion.','HUB_STATE_CONFLICT',409)
            if entry.archived_at:
                fail('Discussion is already archived.','HUB_STATE_CONFLICT',409)
            entry.archived_at = datetime.utcnow(); event(entry,None,'archived')
        elif action == 'draft':
            parent_open(relation)
            previous = revision_for(entry,entry.working_revision_id) or shared['published'](entry)
            if entry.archived_at or previous is None or previous.state not in {'approved','rejected'}:
                fail('A new draft is not available.','HUB_STATE_CONFLICT',409)
            revision = Revision(entry_id=entry.id,number=previous.number+1,title=previous.title,body=previous.body)
            db.session.add(revision);db.session.flush();entry.working_revision_id=revision.id
            event(entry,revision,'draft_created')
        else:
            if action in {'submit','approve','publish'}:
                parent_open(relation)
            if action == 'publish':
                require_admin()
                if entry.owner_id != actor().id:
                    fail('Only your own draft can be directly published.','FORBIDDEN',403)
            revision = working(entry,'draft' if action in {'submit','publish'} else 'pending')
            if action in {'submit','publish'}:
                revision.state='pending';revision.submitted_at=datetime.utcnow();event(entry,revision,'submitted')
            elif action == 'withdraw':
                revision.state='draft';revision.submitted_at=None;event(entry,revision,'withdrawn')
            if action in {'approve','reject','publish'}:
                note = text(data.get('reviewNote'),'Review reason',2000) if action == 'reject' else None
                revision.state='rejected' if action=='reject' else 'approved'
                revision.reviewed_at=datetime.utcnow();revision.reviewed_by_id=actor().id;revision.review_note=note
                if revision.state=='approved':
                    entry.published_revision_id=revision.id;entry.working_revision_id=None
                event(entry,revision,'rejected' if action=='reject' else 'approved',note)
        return saved(entry)

    @app.get(base+'/entries/<int:entry_id>/history')
    @guarded
    def discussion_history(entry_id):
        require_admin();page=page_query(set());lookup(entry_id,True)
        query=select(Event).where(Event.entry_id==entry_id).order_by(Event.id.desc())
        return jsonify(page_result(query,page,lambda row:dict(id=row.id,action=row.action,actorId=row.actor_id,
            revisionId=row.revision_id,createdAt=row.created_at.isoformat()+'Z')))

    @app.post(base+'/entries/<int:entry_id>/reports')
    @guarded
    def discussion_report(entry_id):
        _,relation=lookup(entry_id)
        data=payload({'reason'},{'detail'})
        report=Report(target_entry_id=entry_id,original_target_id=entry_id,target_type='reply' if relation.thread_id else 'thread',
            reporter_id=actor().id,reason=text(data['reason'],'Reason',200),detail=text(data.get('detail'),'Detail',2000,False))
        db.session.add(report);db.session.flush()
        db.session.add(ReportEvent(report_id=report.id,actor_id=actor().id,action='reported'))
        db.session.commit()
        return jsonify(report=dict(id=report.id,status=report.status)),201

    def report_data(report):
        target=db.session.get(Entry,report.target_entry_id) if report.target_entry_id else None
        relation=db.session.get(Discussion,report.target_entry_id) if report.target_entry_id else None
        author=db.session.get(User,report.reporter_id)
        return dict(id=report.id,targetId=report.target_entry_id,originalTargetId=report.original_target_id,
            targetType=report.target_type,targetState=shared['status'](target) if target else 'deleted',
            threadId=relation.thread_id if relation else None, reporter=author.username,reason=report.reason,detail=report.detail,
            status=report.status,version=report.version,createdAt=report.created_at.isoformat()+'Z',
            resolvedAt=report.resolved_at.isoformat()+'Z' if report.resolved_at else None,resolvedBy=report.resolved_by)

    @app.get(base+'/reports')
    @guarded
    def discussion_reports():
        require_admin();page=page_query({'status'})
        status=request.args.get('status','open')
        if status not in {'open','resolved','dismissed','all'}:
            fail('Invalid report status.')
        query=select(Report)
        if status!='all':query=query.where(Report.status==status)
        return jsonify(page_result(query.order_by(Report.id.desc()),page,report_data))

    @app.get(base+'/reports/<int:report_id>')
    @guarded
    def discussion_report_detail(report_id):
        require_admin();page_query(set())
        report=db.session.get(Report,report_id) if positive(report_id) else None
        if report is None:fail('Report not found.','HUB_NOT_FOUND',404)
        events=db.session.scalars(select(ReportEvent).where(ReportEvent.report_id==report.id).order_by(ReportEvent.id)).all()
        return jsonify(report=report_data(report),events=[dict(action=row.action,actorId=row.actor_id,
            createdAt=row.created_at.isoformat()+'Z') for row in events])

    @app.post(base+'/reports/<int:report_id>/<action>')
    @guarded
    def discussion_resolve(report_id,action):
        require_admin()
        if action not in {'resolve','dismiss'}:fail('Action not found.','HUB_NOT_FOUND',404)
        report=db.session.get(Report,report_id) if positive(report_id) else None
        if report is None:fail('Report not found.','HUB_NOT_FOUND',404)
        if report.target_entry_id:lookup(report.target_entry_id,True)
        report=db.session.scalar(select(Report).where(Report.id==report_id).with_for_update().execution_options(populate_existing=True))
        data=payload({'expectedVersion'});token(report,data)
        if report.status!='open':fail('Report is already closed.','HUB_STATE_CONFLICT',409)
        report.status='resolved' if action=='resolve' else 'dismissed'
        report.resolved_at=datetime.utcnow();report.resolved_by=actor().id;report.version+=1
        db.session.add(ReportEvent(report_id=report.id,actor_id=actor().id,action=report.status))
        db.session.commit()
        return jsonify(report=report_data(report))

    @app.delete(base+'/entries/<int:entry_id>')
    @guarded
    def discussion_delete(entry_id):
        entry,relation=lookup(entry_id,True)
        data=payload({'expectedVersion','confirmation'});token(entry,data)
        if data['confirmation']!='DELETE':fail('Type DELETE to confirm permanent deletion.')
        revisions=db.session.scalars(select(Revision).where(Revision.entry_id==entry.id)).all()
        ever_published=bool(entry.published_revision_id or any(row.state=='approved' for row in revisions) or
            db.session.scalar(select(Event.id).where(Event.entry_id==entry.id,Event.action=='approved').limit(1)))
        current=revision_for(entry,entry.working_revision_id)
        if not admin() and ever_published:fail('Only administrators can permanently delete published content.','FORBIDDEN',403)
        if not ever_published and (current is None or current.state not in {'draft','rejected'}):
            fail('Withdraw pending content before deleting.','HUB_STATE_CONFLICT',409)
        ids=[entry.id]
        if relation.thread_id is None:
            ids+=list(db.session.scalars(select(Discussion.entry_id).where(Discussion.thread_id==entry.id)))
        # A never-published author's thread cannot silently delete another author's reply.
        if not admin() and len(ids)>1:fail('Administrator cleanup is required.','FORBIDDEN',403)
        entries=db.session.scalars(select(Entry).where(Entry.id.in_(ids)).order_by(Entry.id).with_for_update()).all()
        if len(entries)!=len(ids) or any(item.kind!='discussions' for item in entries):
            fail('Discussion relationships require administrator inspection.','HUB_STATE_CONFLICT',409)
        revisions=db.session.scalars(select(Revision).where(Revision.entry_id.in_(ids))).all()
        events=db.session.scalars(select(Event).where(Event.entry_id.in_(ids))).all()
        attachments=db.session.scalars(select(Attachment).where(Attachment.revision_id.in_([row.id for row in revisions]))).all()
        asset_ids=[row.asset_id for row in attachments];keys=[row.asset.storage_key for row in attachments if row.asset.storage_key]
        reports=db.session.scalars(select(Report).where(Report.target_entry_id.in_(ids)).with_for_update()).all()
        for report in reports:
            report.target_entry_id=None;report.version+=1
            db.session.add(ReportEvent(report_id=report.id,actor_id=actor().id,action='target_deleted'))
        for item in entries:
            db.session.add(DeletionAudit(original_entry_id=item.id,actor_id=actor().id,snapshot={
                'kind':'discussions','ownerId':item.owner_id,'version':item.version,'rootEntryId':entry_id,
                'revisions':[dict(id=row.id,number=row.number,state=row.state) for row in revisions if row.entry_id==item.id],
                'moderation':[dict(action=row.action,actorId=row.actor_id,revisionId=row.revision_id,
                    createdAt=row.created_at.isoformat()+'Z') for row in events if row.entry_id==item.id]}))
            item.published_revision_id=item.working_revision_id=None
        for row in events+attachments:db.session.delete(row)
        for row in db.session.scalars(select(Discussion).where(Discussion.entry_id.in_(ids))).all():db.session.delete(row)
        db.session.flush()
        for row in revisions:db.session.delete(row)
        db.session.flush()
        for row in entries:db.session.delete(row)
        assets=app.extensions['file_asset_service'];assets.retire_unreferenced(asset_ids)
        db.session.commit();pending=assets.drain_cleanup(keys)
        return jsonify(deleted=True,cleanupPending=bool(pending))
