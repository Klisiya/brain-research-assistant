"""Current-user note/highlight CRUD with immutable source and optimistic edits."""
from datetime import datetime
from functools import wraps
from flask import jsonify, request
from flask_login import current_user
from sqlalchemy import select, text, update, delete
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import joinedload
from werkzeug.exceptions import RequestEntityTooLarge
from attachment_files import AttachmentError
from annotation_models import NOTE_TYPES


class AnnotationError(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status


def register_annotation_api(app, db, User, Paper, Attachment, Note, Highlight, roles_required):
    @app.before_request
    def annotation_body_limit():
        if request.path.startswith('/api/learning/') and request.path.rstrip('/').split('/')[-1] in {'notes', 'highlights'}:
            request.max_content_length = 64 * 1024
        elif request.path.startswith(('/api/learning/notes/', '/api/learning/highlights/')):
            request.max_content_length = 64 * 1024

    def fail(code, message, status=400):
        raise AnnotationError(code, message, status)

    def guarded(view):
        @wraps(view)
        @roles_required('student', 'teacher', 'admin')
        def wrapped(*args, **kwargs):
            try:
                if request.args:
                    fail('ANNOTATION_VALIDATION_ERROR', 'Query parameters are not supported.')
                if request.method != 'GET':
                    uid, version = current_user.id, current_user.auth_version
                    db.session.rollback()
                    if db.engine.dialect.name == 'sqlite':
                        db.session.execute(text('BEGIN IMMEDIATE'))
                    user = db.session.scalar(select(User).where(User.id == uid).with_for_update())
                    if user is None or not user.is_active or user.auth_version != version:
                        fail('AUTH_REQUIRED', 'Authentication required.', 401)
                return view(*args, **kwargs)
            except AnnotationError as error:
                db.session.rollback()
                return jsonify(code=error.code, error=error.message), error.status
            except RequestEntityTooLarge:
                db.session.rollback()
                return jsonify(code='ANNOTATION_VALIDATION_ERROR', error='The annotation request is too large.'), 413
            except IntegrityError:
                db.session.rollback()
                return jsonify(code='ANNOTATION_CONFLICT', error='The personal record changed. Reload before editing.'), 409
            except SQLAlchemyError as error:
                db.session.rollback()
                app.logger.error('Annotation request failed category=%s', type(error).__name__)
                return jsonify(code='ANNOTATION_UNAVAILABLE', error='Your personal workspace is unavailable. Please retry.'), 503
        return wrapped

    def paper_for(slug):
        query = select(Paper).where(Paper.slug == slug, Paper.status == 'published')
        paper = db.session.scalar(query.with_for_update() if request.method != 'GET' else query)
        if paper is None:
            fail('PAPER_NOT_AVAILABLE', 'Paper is not available.', 404)
        return paper

    def readable(paper, item):
        if paper is None or paper.status != 'published' or item is None or item.attachment_type == 'cover' or item.paper_id != paper.id:
            return False
        try:
            app.extensions['file_asset_service'].authorize('paper', paper, item)
            return True
        except AttachmentError:
            return False

    def resources(paper):
        return [dict(id=item.id, displayName=item.display_name, attachmentType=item.attachment_type, version=item.version)
                for item in Attachment.query.filter_by(paper_id=paper.id).order_by(Attachment.sort_order, Attachment.id).all() if readable(paper, item)]

    def source(row):
        paper = row.paper
        public = paper is not None and paper.status == 'published'
        context = dict(kind='paper' if row.resource_version is None else 'resource', available=public,
                       version=row.resource_version, currentVersion=None, attachmentId=None, displayName=None,
                       attachmentType=None, state='current' if public else 'unavailable')
        if row.resource_version is not None:
            item = row.attachment
            context['available'] = readable(paper, item)
            context['state'] = 'unavailable'
            if context['available']:
                context.update(attachmentId=item.id, displayName=item.display_name, attachmentType=item.attachment_type,
                               currentVersion=item.version, state='current' if item.version == row.resource_version else 'earlier')
        return context

    def serialize(row, kind):
        paper = row.paper
        result = dict(kind='note' if kind == 'notes' else 'highlight', id=row.id, revision=row.revision, createdAt=row.created_at.isoformat()+'Z', updatedAt=row.updated_at.isoformat()+'Z',
                      paper=dict(slug=paper.slug, title=paper.title) if paper is not None and paper.status == 'published' else None,
                      source=source(row))
        if kind == 'notes':
            result.update(title=row.title, body=row.body, noteType=row.note_type)
        else:
            result.update(highlightText=row.highlight_text, comment=row.comment)
        return result

    def payload(required, optional=()):
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not set(required) <= set(data) or not set(data) <= set(required) | set(optional):
            fail('ANNOTATION_VALIDATION_ERROR', 'Invalid or unknown fields.')
        return data

    def positive(value):
        return type(value) is int and 1 <= value <= 2147483647

    def string(data, key, maximum, optional=False):
        value = data.get(key)
        if optional and value is None:
            return None
        if not isinstance(value, str) or len(value) > maximum:
            fail('ANNOTATION_VALIDATION_ERROR', f'{key} must be text of at most {maximum} characters.')
        value = value.strip()
        if not value and not optional:
            fail('ANNOTATION_VALIDATION_ERROR', f'{key} cannot be empty.')
        return value or None

    def content(data, kind):
        if kind == 'notes':
            if not isinstance(data['noteType'], str) or data['noteType'] not in NOTE_TYPES:
                fail('ANNOTATION_VALIDATION_ERROR', 'Invalid note type.')
            return dict(title=string(data,'title',200), body=string(data,'body',10000), note_type=data['noteType'])
        values = dict(highlight_text=string(data,'highlightText',1000))
        if request.method != 'PATCH' or 'comment' in data:
            values['comment'] = string(data,'comment',2000,optional=True)
        return values

    def bind_source(data, paper):
        if not {'attachmentId','expectedVersion'} & set(data):
            return {}
        if not {'attachmentId','expectedVersion'} <= set(data) or not positive(data['attachmentId']):
            fail('ANNOTATION_VALIDATION_ERROR', 'Resource source requires attachmentId and expectedVersion.')
        item = db.session.scalar(select(Attachment).where(Attachment.id == data['attachmentId'], Attachment.paper_id == paper.id).with_for_update())
        if not readable(paper, item):
            fail('READING_RESOURCE_NOT_AVAILABLE', 'Reading resource is not available.', 404)
        if not positive(data['expectedVersion']):
            fail('ANNOTATION_VALIDATION_ERROR', 'Invalid resource version.')
        if item.version != data['expectedVersion']:
            fail('ANNOTATION_SOURCE_CONFLICT', 'The resource was updated. Reload the paper before creating a record for this version.', 409)
        return dict(attachment_id=item.id, attachment_relation_id_at_recording=item.id, resource_version=item.version)

    def register(kind, Model, singular, fields):
        def rows(paper_id=None):
            query = Model.query.options(joinedload(Model.paper), joinedload(Model.attachment)).filter_by(user_id=current_user.id)
            if paper_id is not None:
                query = query.filter_by(paper_id=paper_id)
            return query.order_by(Model.updated_at.desc(), Model.id.desc()).all()

        def collection(slug):
            paper = paper_for(slug)
            if request.method == 'GET':
                return jsonify(**{kind:[serialize(row,kind) for row in rows(paper.id)]}, resources=resources(paper))
            data = payload(fields, ('attachmentId','expectedVersion',*(() if kind == 'notes' else ('comment',))))
            now = datetime.utcnow()
            row = Model(user_id=current_user.id, paper_id=paper.id, created_at=now, updated_at=now,
                        **content(data,kind), **bind_source(data,paper))
            db.session.add(row)
            db.session.commit()
            return jsonify(**{singular:serialize(row,kind)}), 201

        def personal_collection():
            # Own text survives unavailable sources; current Paper/resource metadata is redacted.
            return jsonify(**{kind:[serialize(row,kind) for row in rows()]})

        def mutation(record_id):
            data = payload(('expectedRevision',) if request.method == 'DELETE' else (*fields,'expectedRevision'), () if request.method == 'DELETE' or kind == 'notes' else ('comment',))
            if not positive(data['expectedRevision']):
                fail('ANNOTATION_VALIDATION_ERROR', 'Invalid expected revision.')
            row = db.session.scalar(select(Model).where(Model.id == record_id, Model.user_id == current_user.id).with_for_update())
            if row is None:
                fail('ANNOTATION_NOT_FOUND', 'Personal record not found.', 404)
            if row.revision != data['expectedRevision']:
                fail('ANNOTATION_CONFLICT', 'This record changed in another browser. Reload the list and reopen it before editing.', 409)
            where = (Model.id == record_id, Model.user_id == current_user.id, Model.revision == data['expectedRevision'])
            if request.method == 'DELETE':
                result = db.session.execute(delete(Model).where(*where).execution_options(synchronize_session=False))
            else:
                values = content(data,kind)
                result = db.session.execute(update(Model).where(*where).values(**values, revision=Model.revision+1, updated_at=datetime.utcnow()).execution_options(synchronize_session=False))
            if result.rowcount != 1:
                fail('ANNOTATION_CONFLICT', 'This record changed. Reload before editing.', 409)
            db.session.commit()
            if request.method == 'DELETE':
                return jsonify(deleted=True)
            db.session.expire_all()
            return jsonify(**{singular:serialize(db.session.get(Model,record_id),kind)})

        app.add_url_rule('/api/learning/papers/<slug>/'+kind, endpoint='annotation_paper_'+kind, view_func=guarded(collection), methods=['GET','POST'])
        app.add_url_rule('/api/learning/'+kind, endpoint='annotation_personal_'+kind, view_func=guarded(personal_collection), methods=['GET'])
        app.add_url_rule('/api/learning/'+kind+'/<int:record_id>', endpoint='annotation_mutation_'+kind, view_func=guarded(mutation), methods=['PATCH','DELETE'])

    register('notes', Note, 'note', ('title','body','noteType'))
    register('highlights', Highlight, 'highlight', ('highlightText',))
