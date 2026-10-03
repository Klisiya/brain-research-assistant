"""Course resource mutations through the existing shared FileAsset service."""
from types import SimpleNamespace
from flask import g, jsonify, request, send_file, url_for
from flask_login import current_user
from sqlalchemy import delete, update
from attachment_files import safe_filename, validate_metadata


def register_course_resource_writes(app,db,CourseResource,ModuleResource,assets,roles_required,guarded,managed,body,integer,fail,commit):
    def context(course_id,module_id):
        parent=managed(course_id,module_id)
        kind,Model,field=('course',CourseResource,'course_id') if module_id is None else ('module',ModuleResource,'module_id')
        return kind,parent,Model,field

    def metadata(row,course_id,module_id):
        a=row.asset
        return dict(id=row.id,displayName=row.display_name,description=row.description,attachmentType=a.asset_type,
            mimeType=a.mime_type,fileSize=a.file_size,accessLevel=row.access_level,version=row.version,sortOrder=row.sort_order,
            externalUrl=a.external_url,downloadUrl=None if a.asset_type=='external_link' else url_for('course_resource_managed_download',course_id=course_id,module_id=module_id,resource_id=row.id))

    @app.route('/api/courses/<int:course_id>/resources/manage',methods=['GET','POST'],defaults={'module_id':None})
    @app.route('/api/courses/<int:course_id>/modules/<int:module_id>/resources/manage',methods=['GET','POST'])
    @roles_required('teacher','admin')
    @guarded
    def course_resource_manage(course_id,module_id):
        kind,parent,Model,field=context(course_id,module_id)
        if request.method=='POST':
            if request.is_json:
                values=validate_metadata(request.get_json(silent=True),link=True)
            else:
                if request.mimetype!='multipart/form-data' or set(request.files)!={'file'} or len(request.files.getlist('file'))!=1 or any(len(request.form.getlist(k))!=1 for k in request.form): fail('Exactly one file and valid metadata are required.')
                values=validate_metadata(request.form.to_dict())
                file_metadata,extension=assets.validate_upload(request.files['file'],values['attachment_type'],app.config['ATTACHMENT_FILE_LIMITS'])
                key=assets.save(kind,parent,request.files['file'].stream,extension);g.course_new_keys.append(key)
                values.update(file_metadata,storage_key=key)
            integer(values['sort_order'])
            asset=assets.create(kind,parent,values,current_user.id)
            row=Model(**{field:parent.id},asset=asset,**{k:values[k] for k in ['display_name','description','access_level','sort_order']})
            db.session.add(row);commit()
        rows=Model.query.filter_by(**{field:parent.id}).order_by(Model.sort_order,Model.id).all()
        return jsonify(resources=[metadata(row,course_id,module_id) for row in rows]),201 if request.method=='POST' else 200

    @app.route('/api/courses/<int:course_id>/resources/<int:resource_id>',methods=['PATCH','DELETE'],defaults={'module_id':None})
    @app.route('/api/courses/<int:course_id>/modules/<int:module_id>/resources/<int:resource_id>',methods=['PATCH','DELETE'])
    @roles_required('teacher','admin')
    @guarded
    def course_resource_edit(course_id,module_id,resource_id):
        kind,parent,Model,field=context(course_id,module_id)
        row=Model.query.filter_by(id=resource_id,**{field:parent.id}).first()
        if row is None: fail('Resource not found.','RESOURCE_NOT_FOUND',404)
        data=body({'expectedVersion','displayName','description','accessLevel','sortOrder'} if request.method=='PATCH' else {'expectedVersion'},{'expectedVersion'})
        expected=integer(data.pop('expectedVersion'),1)
        predicate=(Model.id==row.id,Model.version==expected)
        if request.method=='DELETE':
            key,asset_id=row.asset.storage_key,row.asset_id
            changed=db.session.execute(delete(Model).where(*predicate),execution_options={'synchronize_session':False})
        else:
            existing=SimpleNamespace(attachment_type=row.asset.asset_type,display_name=row.display_name,description=row.description,access_level=row.access_level,sort_order=row.sort_order,external_url=row.asset.external_url)
            values=validate_metadata(data,existing=existing,link=row.asset.asset_type=='external_link');integer(values['sort_order'])
            changed=db.session.execute(update(Model).where(*predicate).values(**{k:values[k] for k in ['display_name','description','access_level','sort_order']},version=Model.version+1),execution_options={'synchronize_session':False})
        if changed.rowcount!=1: fail('Resource changed. Reload before editing.','COURSE_STALE',409)
        if request.method=='DELETE': assets.retire_unreferenced([asset_id])
        commit()
        return jsonify(saved=True,cleanupPending=bool(assets.drain_cleanup([key] if key else [])) if request.method=='DELETE' else False)

    @app.put('/api/courses/<int:course_id>/resources/order',defaults={'module_id':None})
    @app.put('/api/courses/<int:course_id>/modules/<int:module_id>/resources/order')
    @roles_required('teacher','admin')
    @guarded
    def course_resource_order(course_id,module_id):
        _,parent,Model,field=context(course_id,module_id);ids=body({'relationIds'},{'relationIds'})['relationIds']
        if not isinstance(ids,list) or any(type(i) is not int for i in ids) or len(set(ids))!=len(ids): fail('Invalid resource order.')
        rows=Model.query.filter_by(**{field:parent.id}).all();mapping={r.id:r for r in rows}
        if set(ids)!=set(mapping): fail('Resources changed. Reload before sorting.','COURSE_STALE',409)
        for order,identity in enumerate(ids):
            db.session.execute(update(Model).where(Model.id==identity).values(sort_order=order,version=Model.version+1))
        commit();return jsonify(saved=True)

    @app.get('/api/courses/<int:course_id>/resources/<int:resource_id>/manage-download',defaults={'module_id':None})
    @app.get('/api/courses/<int:course_id>/modules/<int:module_id>/resources/<int:resource_id>/manage-download')
    @roles_required('teacher','admin')
    @guarded
    def course_resource_managed_download(course_id,module_id,resource_id):
        kind,parent,Model,field=context(course_id,module_id);row=Model.query.filter_by(id=resource_id,**{field:parent.id}).first()
        if row is None: fail('Resource not found.','RESOURCE_NOT_FOUND',404)
        stream=assets.open(kind,parent,row)
        try:
            response=send_file(stream,mimetype=row.asset.mime_type,download_name=safe_filename(row.asset.original_filename) or 'resource',as_attachment=True,conditional=False,etag=False,max_age=0)
            response.content_length=row.asset.file_size;response.call_on_close(stream.close);return response
        except Exception: stream.close();raise
