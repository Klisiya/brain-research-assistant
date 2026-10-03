"""Current-user bookmarks and self-reported reading; public content boundaries."""
from datetime import datetime
from functools import wraps
from flask import jsonify, request
from flask_login import current_user
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import joinedload
from attachment_files import AttachmentError


class ReadingError(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status


def register_reading_api(app, db, User, Paper, Attachment, Course, Module, Area,
                         Bookmark, PaperProgress, AttachmentProgress, roles_required):
    targets = {'paper': (Paper, 'paper_id'), 'course': (Course, 'course_id'),
               'module': (Module, 'module_id'), 'research_area': (Area, 'research_area_id')}

    def fail(code, message, status=400):
        raise ReadingError(code, message, status)

    def guarded(view):
        @wraps(view)
        @roles_required('student', 'teacher', 'admin')
        def wrapped(*args, **kwargs):
            try:
                if request.args:
                    fail('BOOKMARK_VALIDATION_ERROR' if 'bookmarks' in request.path else 'READING_VALIDATION_ERROR', 'Query parameters are not supported.')
                if request.method != 'GET':
                    uid, version = current_user.id, current_user.auth_version
                    db.session.rollback()
                    if db.engine.dialect.name == 'sqlite':
                        db.session.execute(text('BEGIN IMMEDIATE'))
                    user = db.session.scalar(select(User).where(User.id == uid).with_for_update())
                    if user is None or not user.is_active or user.auth_version != version:
                        fail('AUTH_REQUIRED', 'Authentication required.', 401)
                return view(*args, **kwargs)
            except ReadingError as error:
                db.session.rollback()
                return jsonify(code=error.code, error=error.message), error.status
            except IntegrityError:
                db.session.rollback()
                return jsonify(code='READING_CONFLICT', error='Personal state changed. Please retry.'), 409
            except SQLAlchemyError as error:
                db.session.rollback()
                app.logger.error('Reading request failed category=%s', type(error).__name__)
                return jsonify(code='READING_PROGRESS_UNAVAILABLE', error='Personal state is unavailable. Please retry.'), 503
        return wrapped

    def body(fields, bookmark=False):
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or set(data) != set(fields):
            fail('BOOKMARK_VALIDATION_ERROR' if bookmark else 'READING_VALIDATION_ERROR', 'Invalid or unknown fields.')
        if 'action' in fields and data['action'] not in ['start', 'complete', 'incomplete']:
            fail('READING_VALIDATION_ERROR', 'Invalid reading action.')
        return data

    def published(target):
        return target is not None and target.status == 'published' and (not isinstance(target, Module) or target.course.status == 'published')

    def target_data(kind, target):
        if not published(target):
            return None
        result = dict(id=target.id, slug=target.slug, title=target.name if kind == 'research_area' else target.title)
        if kind == 'paper':
            result.update(authors=target.authors, year=target.year, journal=target.journal)
        elif kind == 'course':
            result.update(titleZh=target.title_zh, description=target.description[:240])
        elif kind == 'module':
            result.update(titleZh=target.title_zh, number=target.number, courseSlug=target.course.slug, courseTitle=target.course.title)
        else:
            result.update(code=target.code, overview=target.overview[:240])
        return result

    def bookmark_data(row):
        kind = next(kind for kind, (_, field) in targets.items() if getattr(row, field) is not None)
        target = target_data(kind, getattr(row, kind))
        return dict(id=row.id, targetType=kind, available=target is not None, target=target, createdAt=iso(row.created_at))

    def iso(value):
        return value.isoformat() + 'Z' if value else None

    def activity(row):
        return dict(status='completed' if row and row.self_completed_at else 'in_progress' if row else 'not_started',
                    startedAt=iso(row.started_at) if row else None, lastActivityAt=iso(row.last_activity_at) if row else None,
                    selfCompletedAt=iso(row.self_completed_at) if row else None)

    def record(row, action):
        now = datetime.utcnow()
        row.started_at = row.started_at or now
        row.last_activity_at = now
        if action == 'complete':
            row.self_completed_at = row.self_completed_at or now
        elif action == 'incomplete':
            row.self_completed_at = None

    def paper_for(slug):
        paper = db.session.scalar(select(Paper).where(Paper.slug == slug, Paper.status == 'published').with_for_update())
        if paper is None:
            fail('PAPER_NOT_AVAILABLE', 'Paper is not available.', 404)
        return paper

    def readable(paper, item):
        if item is None or item.attachment_type == 'cover':
            return False
        try:
            app.extensions['file_asset_service'].authorize('paper', paper, item)
            return True
        except AttachmentError:
            return False

    def paper_state(paper):
        row = PaperProgress.query.filter_by(user_id=current_user.id, paper_id=paper.id).first()
        histories = AttachmentProgress.query.filter_by(user_id=current_user.id, paper_id=paper.id).order_by(AttachmentProgress.attachment_version, AttachmentProgress.id).all()
        resources = []
        for item in Attachment.query.filter_by(paper_id=paper.id).order_by(Attachment.sort_order, Attachment.id).all():
            if not readable(paper, item):
                continue
            history = [h for h in histories if h.attachment_id == item.id]
            live = next((h for h in history if h.attachment_version == item.version), None)
            resources.append(dict(attachmentId=item.id, version=item.version, displayName=item.display_name, **activity(live),
                                  history=[dict(version=h.attachment_version, **activity(h)) for h in history if h.attachment_version != item.version]))
        return dict(**activity(row), resources=resources,
                    unavailableHistory=[dict(progressId=h.id, version=h.attachment_version, **activity(h)) for h in histories if h.attachment_id is None])

    @app.get('/api/learning/bookmarks')
    @guarded
    def personal_bookmarks():
        rows = Bookmark.query.options(joinedload(Bookmark.paper), joinedload(Bookmark.course), joinedload(Bookmark.module).joinedload(Module.course), joinedload(Bookmark.research_area)).filter_by(user_id=current_user.id).order_by(Bookmark.created_at.desc(), Bookmark.id.desc()).all()
        return jsonify(bookmarks=[bookmark_data(row) for row in rows])

    @app.post('/api/learning/bookmarks')
    @guarded
    def save_bookmark():
        data = body(('targetType', 'targetId'), bookmark=True)
        if not isinstance(data['targetType'], str) or data['targetType'] not in targets or type(data['targetId']) is not int or not 1 <= data['targetId'] <= 2147483647:
            fail('BOOKMARK_VALIDATION_ERROR', 'Invalid bookmark target.')
        Model, field = targets[data['targetType']]
        target = db.session.scalar(select(Model).where(Model.id == data['targetId']).with_for_update())
        if not published(target):
            fail('BOOKMARK_TARGET_UNAVAILABLE', 'Bookmark target is not available.', 404)
        if isinstance(target, Module):
            # Lock the parent publication boundary against concurrent management changes.
            parent = db.session.scalar(select(Course).where(Course.id == target.course_id).with_for_update().execution_options(populate_existing=True))
            if parent.status != 'published':
                fail('BOOKMARK_TARGET_UNAVAILABLE', 'Bookmark target is not available.', 404)
        row = Bookmark.query.filter_by(user_id=current_user.id, **{field:target.id}).first()
        if row is None:
            row = Bookmark(user_id=current_user.id, **{field:target.id})
            db.session.add(row)
        db.session.commit()
        return jsonify(bookmark=bookmark_data(row))

    @app.delete('/api/learning/bookmarks/<int:bookmark_id>')
    @guarded
    def remove_bookmark(bookmark_id):
        body((), bookmark=True)
        row = Bookmark.query.filter_by(id=bookmark_id, user_id=current_user.id).first()
        if row is None:
            fail('BOOKMARK_NOT_FOUND', 'Bookmark not found.', 404)
        db.session.delete(row)
        db.session.commit()
        return jsonify(deleted=True)

    @app.get('/api/learning/papers')
    @guarded
    def personal_papers():
        rows = PaperProgress.query.options(joinedload(PaperProgress.paper)).filter_by(user_id=current_user.id).order_by(PaperProgress.last_activity_at.desc(), PaperProgress.id.desc()).all()
        return jsonify(papers=[dict(progressId=row.id, available=published(row.paper), paper=target_data('paper', row.paper), **activity(row)) for row in rows])

    @app.get('/api/learning/papers/<slug>')
    @guarded
    def reading_paper(slug):
        return jsonify(reading=paper_state(paper_for(slug)))

    @app.post('/api/learning/papers/<slug>/progress')
    @guarded
    def record_paper(slug):
        data = body(('action',))
        paper = paper_for(slug)
        row = PaperProgress.query.filter_by(user_id=current_user.id, paper_id=paper.id).first()
        if row is None:
            row = PaperProgress(user_id=current_user.id, paper_id=paper.id)
            db.session.add(row)
        record(row, data['action'])
        db.session.commit()
        return jsonify(reading=paper_state(paper))

    @app.post('/api/learning/papers/<slug>/attachments/<int:attachment_id>/progress')
    @guarded
    def record_attachment(slug, attachment_id):
        data = body(('action', 'expectedVersion'))
        paper = paper_for(slug)
        item = db.session.scalar(select(Attachment).where(Attachment.id == attachment_id, Attachment.paper_id == paper.id).with_for_update())
        if not readable(paper, item):
            fail('READING_RESOURCE_NOT_AVAILABLE', 'Reading resource is not available.', 404)
        if type(data['expectedVersion']) is not int or not 1 <= data['expectedVersion'] <= 2147483647:
            fail('READING_VALIDATION_ERROR', 'Invalid resource version.')
        if item.version != data['expectedVersion']:
            fail('READING_CONFLICT', 'Resource version changed. Refresh the paper before recording this version.', 409)
        row = AttachmentProgress.query.filter_by(user_id=current_user.id, attachment_id=item.id, attachment_version=item.version).first()
        if row is None:
            row = AttachmentProgress(user_id=current_user.id, paper_id=paper.id, attachment_id=item.id,
                                     relation_id_at_recording=item.id, attachment_version=item.version)
            db.session.add(row)
        record(row, data['action'])
        db.session.commit()
        return jsonify(reading=paper_state(paper))
