"""Scoped editorial operations; canonical instructional identities are immutable."""
from datetime import datetime
from functools import wraps
from flask import g, jsonify, request
from flask_login import current_user
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge
from attachment_files import AttachmentError
from storage import StorageWriteError
from module_readings import reading_rows
from course_resource_api import register_course_resource_writes


def register_course_management(app, db, Course, Module, Staff, Link, CourseResource, ModuleResource, User, Paper, auth, roles_required, can_manage_paper):
    assets = app.extensions['file_asset_service']

    def fail(message, code='COURSE_VALIDATION_ERROR', status=400):
        raise AttachmentError(message, code, status)

    def guarded(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            g.course_new_keys = []
            try: return view(*args, **kwargs)
            except RequestEntityTooLarge:
                db.session.rollback(); assets.compensate(g.course_new_keys)
                return jsonify(error='Request is too large.',code='FILE_TOO_LARGE'),413
            except (AttachmentError, BadRequest) as error:
                db.session.rollback(); assets.compensate(g.course_new_keys)
                return jsonify(error=str(error) if isinstance(error,AttachmentError) else 'Invalid request.',code=getattr(error,'code','COURSE_VALIDATION_ERROR')),getattr(error,'status',400)
            except IntegrityError:
                db.session.rollback(); assets.compensate(g.course_new_keys)
                return jsonify(error='This relation already exists or conflicts with current data.',code='COURSE_CONFLICT'),409
            except (SQLAlchemyError, OSError, ValueError) as error:
                db.session.rollback()
                if isinstance(error,StorageWriteError): g.course_new_keys.append(error.storage_key)
                assets.compensate(g.course_new_keys)
                app.logger.error('Course write failed category=%s',type(error).__name__)
                return jsonify(error='Course workspace is unavailable. Please retry.',code='COURSE_UNAVAILABLE'),503
        return wrapped

    def body(allowed, required=()):
        data = request.get_json(silent=True)
        if not isinstance(data,dict) or set(data)-set(allowed) or set(required)-set(data): fail('Invalid or unknown fields.')
        return data

    def integer(value, minimum=0):
        if type(value) is not int or not minimum <= value < 2**31: fail('A valid integer is required.')
        return value

    def managed(course_id, module_id=None):
        course = db.session.get(Course, course_id)
        if course is None: fail('Course not found.','COURSE_NOT_FOUND',404)
        if not auth.can_manage_course(course): fail('Course management is not allowed.','COURSE_MANAGE_FORBIDDEN',403)
        if module_id is None: return course
        module = Module.query.filter_by(id=module_id,course_id=course_id).first()
        if module is None: fail('Module not found.','MODULE_NOT_FOUND',404)
        return module

    def commit(): db.session.commit(); g.course_new_keys = []

    @app.patch('/api/courses/<int:course_id>',defaults={'module_id':None})
    @app.patch('/api/courses/<int:course_id>/modules/<int:module_id>')
    @roles_required('teacher','admin')
    @guarded
    def course_edit_content(course_id,module_id):
        row = managed(course_id,module_id); Model = Course if module_id is None else Module
        fields = {'description':'description','status':'status'}
        if module_id is not None: fields.update(learningFocus='learning_focus',category='category')
        data = body(set(fields)|{'expectedUpdatedAt'},{'expectedUpdatedAt'})
        if data.pop('expectedUpdatedAt') != row.updated_at.isoformat(): fail('Content changed. Reload before saving.','COURSE_STALE',409)
        values = {}
        for key,value in data.items():
            if key == 'status':
                if value not in ['draft','published','archived']: fail('Invalid publication status.')
            elif not isinstance(value,str) or not value.strip() or len(value.strip()) > (150 if key=='category' else 6000):
                fail('Invalid content length.')
            values[fields[key]] = value.strip() if isinstance(value,str) else value
        if not values: fail('No editable fields supplied.')
        values['updated_at'] = datetime.utcnow()
        changed = db.session.execute(update(Model).where(Model.id==row.id,Model.updated_at==row.updated_at).values(**values),execution_options={'synchronize_session':False})
        if changed.rowcount != 1: fail('Content changed. Reload before saving.','COURSE_STALE',409)
        commit(); return jsonify(saved=True)

    @app.get('/api/courses/editors')
    @roles_required('admin')
    @guarded
    def course_editor_candidates():
        q=request.args.get('q','').strip();page=request.args.get('page','1')
        if len(q)>150 or not page.isascii() or not page.isdecimal() or len(page)>5 or not 1<=int(page)<=10000: fail('Invalid teacher query.')
        query=User.query.filter_by(role='teacher',is_active=True)
        if q:
            literal=q.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
            query=query.filter(db.or_(User.username.ilike('%'+literal+'%',escape='\\'),User.email.ilike('%'+literal+'%',escape='\\')))
        total=query.count();rows=query.order_by(User.id).offset((int(page)-1)*20).limit(20).all()
        return jsonify(users=[dict(id=u.id,username=u.username,email=u.email) for u in rows],total=total)

    @app.route('/api/courses/<int:course_id>/staff',methods=['GET','POST'])
    @roles_required('teacher','admin')
    @guarded
    def course_staff_members(course_id):
        managed(course_id)
        if request.method=='POST':
            if current_user.role!='admin': fail('Only admins can assign course staff.','COURSE_STAFF_FORBIDDEN',403)
            data=body({'userId','role'},{'userId','role'});user=db.session.get(User,integer(data['userId'],1))
            if user is None or not user.is_active or user.role!='teacher': fail('Only active teachers can be assigned.')
            if data['role'] not in ['instructor','assistant']: fail('Invalid staff role.')
            db.session.add(Staff(course_id=course_id,user_id=user.id,role=data['role']));commit()
        rows=Staff.query.filter_by(course_id=course_id).order_by(Staff.id).all()
        return jsonify(staff=[dict(id=r.id,userId=r.user_id,username=r.user.username,role=r.role,eligible=r.user.is_active and r.user.role=='teacher') for r in rows]),201 if request.method=='POST' else 200

    @app.delete('/api/courses/<int:course_id>/staff/<int:staff_id>')
    @roles_required('admin')
    @guarded
    def course_staff_remove(course_id,staff_id):
        managed(course_id);row=Staff.query.filter_by(id=staff_id,course_id=course_id).first()
        if row is None: fail('Staff relation not found.','COURSE_NOT_FOUND',404)
        db.session.delete(row);commit();return jsonify(deleted=True)

    @app.route('/api/courses/<int:course_id>/modules/<int:module_id>/papers',methods=['GET','POST'])
    @roles_required('teacher','admin')
    @guarded
    def module_reading_manage(course_id,module_id):
        managed(course_id,module_id)
        if request.method=='POST':
            data=body({'paperId','readingType'},{'paperId','readingType'})
            paper=db.session.get(Paper,integer(data['paperId'],1))
            if paper is None or paper.status!='published': fail('Published paper not found.','PAPER_NOT_FOUND',404)
            if data['readingType'] not in ['required','recommended']: fail('Invalid reading type.')
            order=db.session.query(db.func.max(Link.sort_order)).filter_by(module_id=module_id).scalar()
            db.session.add(Link(module_id=module_id,paper_id=paper.id,reading_type=data['readingType'],sort_order=0 if order is None else order+1));commit()
        return jsonify(readings=reading_rows(Link,module_id,can_manage_paper)),201 if request.method=='POST' else 200

    @app.route('/api/courses/<int:course_id>/modules/<int:module_id>/papers/<int:relation_id>',methods=['PATCH','DELETE'])
    @roles_required('teacher','admin')
    @guarded
    def module_reading_edit(course_id,module_id,relation_id):
        managed(course_id,module_id);row=Link.query.filter_by(id=relation_id,module_id=module_id).first()
        if row is None: fail('Reading relation not found.','READING_NOT_FOUND',404)
        if request.method=='DELETE': db.session.delete(row)
        else:
            data=body({'readingType'},{'readingType'})
            if data['readingType'] not in ['required','recommended']: fail('Invalid reading type.')
            row.reading_type=data['readingType']
        commit();return jsonify(saved=True)

    @app.put('/api/courses/<int:course_id>/modules/<int:module_id>/papers/order')
    @roles_required('teacher','admin')
    @guarded
    def module_reading_order(course_id,module_id):
        managed(course_id,module_id);ids=body({'relationIds'},{'relationIds'})['relationIds']
        if not isinstance(ids,list) or any(type(i) is not int for i in ids) or len(set(ids))!=len(ids): fail('Invalid relation order.')
        rows=Link.query.filter_by(module_id=module_id).all();mapping={r.id:r for r in rows}
        if set(ids)!=set(mapping): fail('Readings changed. Reload before sorting.','COURSE_STALE',409)
        for order,identity in enumerate(ids): mapping[identity].sort_order=order
        commit();return jsonify(saved=True)

    register_course_resource_writes(app,db,CourseResource,ModuleResource,assets,roles_required,guarded,managed,body,integer,fail,commit)
