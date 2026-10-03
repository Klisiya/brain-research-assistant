"""Authenticated personal learning APIs; reads never create activity."""
from datetime import datetime
from functools import wraps
from flask import jsonify, request
from flask_login import current_user
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import joinedload
from course_content import canonical_content


class LearningError(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status


def register_learning_api(app, db, User, Course, Module, CourseResource, ModuleResource,
                          Enrollment, ModuleProgress, CourseProgress, ResourceProgress, auth, roles_required):
    def fail(code, message, status=400):
        raise LearningError(code, message, status)

    def guarded(view):
        @wraps(view)
        @roles_required('student', 'teacher', 'admin')
        def wrapped(*args, **kwargs):
            try:
                if request.args:
                    fail('LEARNING_VALIDATION_ERROR', 'Query parameters are not supported.')
                if request.method != 'GET':
                    # Serialize retries/tabs before checking identities or the resource version.
                    uid, version = current_user.id, current_user.auth_version
                    db.session.rollback()
                    if db.engine.dialect.name == 'sqlite':
                        db.session.execute(text('BEGIN IMMEDIATE'))
                    user = db.session.scalar(select(User).where(User.id == uid).with_for_update())
                    if user is None or not user.is_active or user.auth_version != version:
                        fail('AUTH_REQUIRED', 'Authentication required.', 401)
                return view(*args, **kwargs)
            except LearningError as error:
                db.session.rollback()
                return jsonify(code=error.code, error=error.message), error.status
            except IntegrityError:
                db.session.rollback()
                return jsonify(code='LEARNING_CONFLICT', error='Learning state changed. Please retry.'), 409
            except SQLAlchemyError as error:
                db.session.rollback()
                app.logger.error('Learning request failed category=%s', type(error).__name__)
                return jsonify(code='LEARNING_UNAVAILABLE', error='Learning state is unavailable. Please retry.'), 503
        return wrapped

    @app.after_request
    def learning_headers(response):
        if request.path.startswith('/api/learning/'):
            response.headers['Cache-Control'] = 'private, no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.vary.add('Cookie')
        return response

    def body(fields):
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or set(data) != set(fields):
            fail('LEARNING_VALIDATION_ERROR', 'Invalid or unknown fields.')
        if 'action' in fields and data['action'] not in ['start', 'complete', 'incomplete']:
            fail('LEARNING_VALIDATION_ERROR', 'Invalid learning action.')
        return data

    def course_for(slug):
        course = db.session.scalar(select(Course).where(Course.slug == slug, Course.status == 'published').with_for_update() if request.method != 'GET'
                                   else select(Course).where(Course.slug == slug, Course.status == 'published'))
        if course is None:
            fail('COURSE_NOT_AVAILABLE', 'Course is not available.', 404)
        return course

    def enrollment_for(course):
        row = Enrollment.query.filter_by(user_id=current_user.id, course_id=course.id).first()
        if row is None:
            fail('ENROLLMENT_REQUIRED', 'Enroll in this course to record learning.', 403)
        return row

    def module_for(course, slug):
        module = db.session.scalar(select(Module).where(Module.course_id == course.id, Module.slug == slug, Module.status == 'published').with_for_update())
        if module is None:
            fail('MODULE_NOT_AVAILABLE', 'Module is not available.', 404)
        return module

    def iso(value):
        return value.isoformat() + 'Z' if value else None

    def progress(row):
        return dict(status='completed' if row and row.self_completed_at else 'in_progress' if row and row.started_at else 'not_started',
                    startedAt=iso(row.started_at) if row else None,
                    lastActivityAt=iso(row.last_activity_at) if row else None,
                    selfCompletedAt=iso(row.self_completed_at) if row else None)

    def record(row, action, now):
        # Retrying complete preserves the original completion time; undo keeps activity.
        row.started_at = row.started_at or now
        row.last_activity_at = now
        if action == 'complete':
            row.self_completed_at = row.self_completed_at or now
        elif action == 'incomplete':
            row.self_completed_at = None

    def resource_rows(enrollment, course):
        output = []
        for kind, Model, Progress in [('course', CourseResource, CourseProgress), ('module', ModuleResource, ResourceProgress)]:
            query = Model.query.options(joinedload(Model.asset))
            query = query.filter(Model.course_id == course.id) if kind == 'course' else query.join(Module).filter(Module.course_id == course.id, Module.status == 'published')
            histories = Progress.query.filter_by(enrollment_id=enrollment.id).order_by(Progress.resource_version).all()
            for row in query.order_by(Model.sort_order, Model.id).all():
                parent = course if kind == 'course' else row.module
                if row.asset.asset_type == 'cover' or not auth.can_read_resource(parent, row):
                    continue
                history = [h for h in histories if h.resource_id == row.id]
                current = next((h for h in history if h.resource_version == row.version), None)
                output.append(dict(kind=kind, resourceId=row.id, version=row.version, displayName=row.display_name,
                    moduleSlug=None if kind == 'course' else parent.slug, **progress(current),
                    history=[dict(version=h.resource_version, **progress(h)) for h in history if h.resource_version != row.version]))
        return output

    def summary(enrollment, detail=False):
        course = enrollment.course
        if course.status != 'published':
            return dict(enrollmentId=enrollment.id, available=False, course=None,
                        enrolledAt=iso(enrollment.enrolled_at), lastActivityAt=iso(enrollment.last_activity_at))
        rows = ModuleProgress.query.options(joinedload(ModuleProgress.module)).filter_by(enrollment_id=enrollment.id).all()
        rows.sort(key=lambda r: (r.module.number, r.module_id))
        completed = sum(r.self_completed_at is not None for r in rows)
        available = [r for r in rows if r.module.status == 'published']
        incomplete = [r for r in available if r.self_completed_at is None]
        active = [r for r in incomplete if r.last_activity_at]
        target = max(active, key=lambda r: (r.last_activity_at, -r.module.number, -r.module_id)) if active else next(iter(incomplete), None)
        path = '/course/' + course.slug
        item = dict(enrollmentId=enrollment.id, available=True, course=dict(slug=course.slug, title=course.title),
                    enrolledAt=iso(enrollment.enrolled_at), lastActivityAt=iso(enrollment.last_activity_at),
                    completionRuleVersion=enrollment.completion_rule_version, requiredModuleCount=len(rows),
                    completedModuleCount=completed, studyProgressPercent=round(completed * 100 / len(rows), 2) if rows else 0,
                    selfCompleted=bool(rows) and completed == len(rows), verifiedPassed=False, verificationStatus='not_available',
                    continuePath=path + '/modules/' + target.module.slug if target else path)
        if detail:
            item['modules'] = [dict(moduleId=r.module_id, available=r.module.status == 'published',
                                   slug=r.module.slug if r.module.status == 'published' else None,
                                   title=r.module.title if r.module.status == 'published' else None,
                                   **progress(r)) for r in rows]
            item['resources'] = resource_rows(enrollment, course)
        return item

    @app.get('/api/learning/enrollments')
    @guarded
    def learning_enrollments():
        rows = Enrollment.query.options(joinedload(Enrollment.course)).filter_by(user_id=current_user.id).order_by(Enrollment.last_activity_at.desc(), Enrollment.id).all()
        return jsonify(enrollments=[summary(row, detail=True) for row in rows])

    @app.get('/api/learning/courses/<slug>')
    @guarded
    def learning_course(slug):
        course = course_for(slug)
        row = Enrollment.query.filter_by(user_id=current_user.id, course_id=course.id).first()
        return jsonify(enrollment=summary(row, detail=True) if row else None)

    @app.post('/api/learning/courses/<slug>/enroll')
    @guarded
    def learning_enroll(slug):
        body(())
        course = course_for(slug)
        row = Enrollment.query.filter_by(user_id=current_user.id, course_id=course.id).first()
        if row is None:
            modules = Module.query.filter_by(course_id=course.id).order_by(Module.number).all()
            canonical = canonical_content()
            if not modules or (course.slug == canonical['course']['slug'] and {m.slug for m in modules} != {m['slug'] for m in canonical['modules']}):
                fail('COURSE_NOT_AVAILABLE', 'The course completion rule is not available.', 409)
            row = Enrollment(user_id=current_user.id, course_id=course.id)
            db.session.add(row)
            db.session.flush()
            db.session.add_all([ModuleProgress(enrollment_id=row.id, module_id=m.id) for m in modules])
        db.session.commit()
        return jsonify(enrollment=summary(row, detail=True))

    @app.post('/api/learning/courses/<slug>/modules/<module_slug>/progress')
    @guarded
    def learning_module(slug, module_slug):
        data = body(('action',))
        course = course_for(slug)
        enrollment = enrollment_for(course)
        module = module_for(course, module_slug)
        row = ModuleProgress.query.filter_by(enrollment_id=enrollment.id, module_id=module.id).first()
        if row is None:
            fail('MODULE_NOT_AVAILABLE', 'Module is not part of this enrollment rule.', 404)
        now = datetime.utcnow()
        record(row, data['action'], now)
        enrollment.last_activity_at = now
        db.session.commit()
        return jsonify(enrollment=summary(enrollment, detail=True))

    @app.post('/api/learning/courses/<slug>/resources/<int:resource_id>/progress', defaults={'module_slug': None})
    @app.post('/api/learning/courses/<slug>/modules/<module_slug>/resources/<int:resource_id>/progress')
    @guarded
    def learning_resource(slug, module_slug, resource_id):
        data = body(('action', 'expectedVersion'))
        course = course_for(slug)
        enrollment = enrollment_for(course)
        parent = module_for(course, module_slug) if module_slug else course
        Model, Progress, field = (ModuleResource, ResourceProgress, 'module_id') if module_slug else (CourseResource, CourseProgress, 'course_id')
        row = db.session.scalar(select(Model).where(Model.id == resource_id, getattr(Model, field) == parent.id).with_for_update())
        if row is None or row.asset.asset_type == 'cover' or not auth.can_read_resource(parent, row):
            fail('RESOURCE_NOT_AVAILABLE', 'Resource is not available.', 404)
        version = data['expectedVersion']
        if type(version) is not int or not 1 <= version < 2**31:
            fail('LEARNING_VALIDATION_ERROR', 'A valid resource version is required.')
        if version != row.version:
            fail('LEARNING_CONFLICT', 'Resource version changed. Reload before recording progress.', 409)
        state = Progress.query.filter_by(enrollment_id=enrollment.id, resource_id=row.id, resource_version=version).first()
        if state is None:
            state = Progress(enrollment_id=enrollment.id, resource_id=row.id, relation_id_at_recording=row.id, resource_version=version)
            db.session.add(state)
        now = datetime.utcnow()
        record(state, data['action'], now)
        enrollment.last_activity_at = now
        if module_slug:
            module_state = ModuleProgress.query.filter_by(enrollment_id=enrollment.id, module_id=parent.id).first()
            if module_state:
                record(module_state, 'start', now)
        db.session.commit()
        return jsonify(enrollment=summary(enrollment, detail=True))
