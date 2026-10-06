"""Published discipline views and scoped, CSRF-protected editorial operations."""
from functools import wraps
import click
from flask import g, jsonify, request, send_file, url_for
from flask_login import current_user
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge
from attachment_files import AttachmentError, safe_filename, validate_metadata
from storage import StorageWriteError
from research_content import bootstrap_research


def register_research_api(app, db, Area, Staff, PaperLink, ModuleLink, Resource, User, Paper, Course, Module, auth, roles_required, brain_regions, serialize_paper, can_manage_paper, can_manage_module):
    assets = app.extensions['file_asset_service']
    assets.register_resource('research_area',Resource,'research_area_id',can_read=auth.can_read,can_manage=auth.can_manage)

    def fail(message, code='RESEARCH_VALIDATION_ERROR', status=400): raise AttachmentError(message,code,status)

    def guarded(view):
        @wraps(view)
        def wrapped(*args,**kwargs):
            g.research_new_keys = []
            try: return view(*args,**kwargs)
            except RequestEntityTooLarge:
                db.session.rollback(); assets.compensate(g.research_new_keys)
                return jsonify(error='Request is too large.',code='FILE_TOO_LARGE'),413
            except (AttachmentError, BadRequest) as error:
                db.session.rollback(); assets.compensate(g.research_new_keys)
                return jsonify(error=str(error) if isinstance(error,AttachmentError) else 'Invalid request.',code=getattr(error,'code','RESEARCH_VALIDATION_ERROR')),getattr(error,'status',400)
            except IntegrityError:
                db.session.rollback(); assets.compensate(g.research_new_keys)
                return jsonify(error='This relation already exists or conflicts with current data.',code='RESEARCH_CONFLICT'),409
            except (OSError, ValueError, SQLAlchemyError) as error:
                db.session.rollback()
                if isinstance(error,StorageWriteError): g.research_new_keys.append(error.storage_key)
                assets.compensate(g.research_new_keys)
                app.logger.error('Research operation failed category=%s',type(error).__name__)
                return jsonify(error='Research content is unavailable. Please retry.',code='RESEARCH_UNAVAILABLE'),503
        return wrapped

    @app.after_request
    def research_headers(response):
        if request.path.startswith('/api/research-areas'):
            response.headers['Cache-Control']='private, no-store'
            response.headers['X-Content-Type-Options']='nosniff'; response.vary.add('Cookie')
        return response

    def commit(): db.session.commit(); g.research_new_keys = []

    def payload(allowed, required=()):
        value = request.get_json(silent=True) if request.is_json else None
        if not isinstance(value,dict) or set(value)-set(allowed) or set(required)-set(value): fail('Invalid or unknown fields.')
        return value

    def integer(value, minimum=0):
        if type(value) is not int or not minimum <= value < 2**31: fail('A valid integer is required.')
        return value

    def strings(value, limit, length):
        if not isinstance(value,list) or len(value)>limit or any(not isinstance(v,str) or not v.strip() or len(v.strip())>length for v in value): fail('A valid list of text values is required.')
        cleaned = [v.strip() for v in value]
        if len(set(cleaned))!=len(cleaned): fail('Duplicate list entries are not allowed.')
        return cleaned

    def published(slug):
        area = Area.query.filter_by(slug=slug,status='published').first()
        if area is None: fail('Research area not found.','RESEARCH_NOT_FOUND',404)
        return area

    def managed(area_id):
        area = Area.query.filter_by(id=area_id).with_for_update().first()
        if area is None: fail('Research area not found.','RESEARCH_NOT_FOUND',404)
        if not auth.can_manage(area): fail('Research area editing is not allowed.','RESEARCH_FORBIDDEN',403)
        return area

    def metadata(area, manage=False):
        item = dict(id=area.id,code=area.code,slug=area.slug,name=area.name,overview=area.overview,subtopics=area.subtopics,sortOrder=area.sort_order,
                    brainRegionSlugs=area.brain_region_slugs)
        if manage: item.update(status=area.status,updatedAt=area.updated_at.isoformat())
        return item

    def resource_json(row, area, manage=False):
        asset = row.asset
        return dict(id=row.id,displayName=row.display_name,description=row.description,attachmentType=asset.asset_type,
            mimeType=asset.mime_type,fileSize=asset.file_size,accessLevel=row.access_level,version=row.version,sortOrder=row.sort_order,
            externalUrl=asset.external_url,downloadUrl=(url_for('research_resource_download',slug=area.slug,resource_id=row.id) if not manage else
                url_for('research_managed_resource_download',area_id=area.id,resource_id=row.id)) if asset.asset_type!='external_link' else None)

    def detail(area, manage=False):
        papers = PaperLink.query.filter_by(research_area_id=area.id).order_by(PaperLink.sort_order,PaperLink.id).all()
        modules = ModuleLink.query.filter_by(research_area_id=area.id).order_by(ModuleLink.sort_order,ModuleLink.id).all()
        resources = Resource.query.filter_by(research_area_id=area.id).order_by(Resource.sort_order,Resource.id).all()
        result = dict(area=metadata(area,manage),papers=[dict(relationId=r.id,sortOrder=r.sort_order,paper=serialize_paper(r.paper) if r.paper.status=='published' or can_manage_paper(r.paper) else None,**({'status':r.paper.status} if manage else {})) for r in papers if manage or r.paper.status=='published'],
            modules=[dict(relationId=r.id,sortOrder=r.sort_order,course=dict(id=r.module.course.id,slug=r.module.course.slug,title=r.module.course.title),
                module=dict(id=r.module.id,slug=r.module.slug,title=r.module.title,titleZh=r.module.title_zh,number=r.module.number,durationHours=r.module.duration_hours),
                **({'status':r.module.status,'courseStatus':r.module.course.status} if manage else {})) for r in modules if manage or (r.module.status=='published' and r.module.course.status=='published')],
            resources=[resource_json(r,area,manage) for r in resources if manage or (r.asset.asset_type!='cover' and auth.can_read(area,r))],
            brainRegions=[dict(slug=s,name=brain_regions[s]['name']) for s in area.brain_region_slugs if s in brain_regions],hubContent=[])
        if manage:
            for item, relation in zip(result['modules'], modules):
                if (relation.module.status!='published' or relation.module.course.status!='published') and not can_manage_module(relation.module):
                    item['course'] = None
                    item['module'] = None
        return result

    @app.get('/api/research-areas')
    @guarded
    def research_list(): return jsonify(areas=[metadata(a) for a in Area.query.filter_by(status='published').order_by(Area.sort_order,Area.id).all()])

    @app.get('/api/research-areas/<slug>')
    @guarded
    def research_detail(slug): return jsonify(detail(published(slug)))

    @app.get('/api/research-areas/manage')
    @roles_required('teacher','admin')
    @guarded
    def research_manage_list():
        query = Area.query
        if current_user.role!='admin': query=query.join(Staff).filter(Staff.user_id==current_user.id)
        return jsonify(areas=[metadata(a,True) for a in query.order_by(Area.sort_order,Area.id).all()])

    @app.get('/api/research-areas/<int:area_id>/manage')
    @roles_required('teacher','admin')
    @guarded
    def research_manage_detail(area_id): return jsonify(detail(managed(area_id),True))

    @app.patch('/api/research-areas/<int:area_id>')
    @roles_required('teacher','admin')
    @guarded
    def research_update(area_id):
        area=managed(area_id); body=payload({'overview','subtopics','brainRegionSlugs','status','expectedUpdatedAt'},{'expectedUpdatedAt'})
        if body['expectedUpdatedAt']!=area.updated_at.isoformat(): fail('This area changed. Refresh before saving.','RESEARCH_STALE',409)
        if 'overview' in body:
            value=body['overview']
            if not isinstance(value,str) or len(value.strip())>6000: fail('Overview must contain at most 6000 characters.')
            area.overview=value.strip()
        if 'subtopics' in body: area.subtopics=strings(body['subtopics'],20,200)
        if 'brainRegionSlugs' in body:
            slugs=strings(body['brainRegionSlugs'],len(brain_regions),220)
            if not set(slugs).issubset(brain_regions): fail('Unknown anatomical region.','BRAIN_REGION_INVALID')
            area.brain_region_slugs=slugs
        if 'status' in body:
            if body['status'] not in ['draft','published','archived']: fail('Invalid publication status.')
            area.status=body['status']
        commit(); return jsonify(detail(area,True))

    relation_models={'papers':(PaperLink,'paper_id',Paper,'paperId'),'modules':(ModuleLink,'module_id',Module,'moduleId')}

    @app.post('/api/research-areas/<int:area_id>/<kind>')
    @roles_required('teacher','admin')
    @guarded
    def research_add_relation(area_id,kind):
        area=managed(area_id)
        if kind not in relation_models: fail('Relation type not found.','RESEARCH_NOT_FOUND',404)
        Link,field,Target,key=relation_models[kind]; body=payload({key,'sortOrder'},{key})
        target=db.session.get(Target,integer(body[key],1))
        if target is None or target.status!='published' or (kind=='modules' and target.course.status!='published'): fail('Published content not found.','RELATED_CONTENT_NOT_FOUND',404)
        row=Link(research_area_id=area.id,**{field:target.id},sort_order=integer(body.get('sortOrder',0)))
        db.session.add(row); commit(); return jsonify(detail(area,True)),201

    @app.delete('/api/research-areas/<int:area_id>/<kind>/<int:relation_id>')
    @roles_required('teacher','admin')
    @guarded
    def research_remove_relation(area_id,kind,relation_id):
        area=managed(area_id)
        if kind not in relation_models: fail('Relation type not found.','RESEARCH_NOT_FOUND',404)
        Link=relation_models[kind][0]; row=Link.query.filter_by(id=relation_id,research_area_id=area.id).first()
        if row is None: fail('Relation not found.','RESEARCH_NOT_FOUND',404)
        db.session.delete(row); commit(); return jsonify(detail(area,True))

    @app.put('/api/research-areas/<int:area_id>/<kind>/order')
    @roles_required('teacher','admin')
    @guarded
    def research_order(area_id,kind):
        area=managed(area_id); Link=Resource if kind=='resources' else relation_models.get(kind,(None,))[0]
        if Link is None: fail('Relation type not found.','RESEARCH_NOT_FOUND',404)
        ids=payload({'relationIds'},{'relationIds'})['relationIds']
        if not isinstance(ids,list) or any(type(i) is not int for i in ids) or len(set(ids))!=len(ids): fail('Order must contain unique relation IDs.')
        rows=Link.query.filter_by(research_area_id=area.id).all(); mapping={r.id:r for r in rows}
        if set(ids)!=set(mapping): fail('Relations changed. Refresh before sorting.','RESEARCH_STALE',409)
        for order,relation_id in enumerate(ids):
            row=mapping[relation_id]
            if kind=='resources' and row.sort_order!=order: row.version+=1
            row.sort_order=order
        commit(); return jsonify(detail(area,True))

    @app.get('/api/research-areas/editors')
    @roles_required('admin')
    @guarded
    def research_editor_candidates():
        q=request.args.get('q','').strip(); page=request.args.get('page','1')
        if len(q)>150 or not page.isdecimal() or not 1<=int(page)<=100000: fail('Invalid editor query.')
        query=User.query.filter_by(role='teacher',is_active=True)
        if q:
            literal=q.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
            query=query.filter(db.or_(User.username.ilike('%'+literal+'%',escape='\\'),User.email.ilike('%'+literal+'%',escape='\\')))
        total=query.count(); rows=query.order_by(User.id).offset((int(page)-1)*20).limit(20).all()
        return jsonify(users=[dict(id=u.id,username=u.username,email=u.email) for u in rows],total=total,page=int(page),perPage=20)

    @app.get('/api/research-areas/<int:area_id>/staff')
    @roles_required('admin')
    @guarded
    def research_staff_list(area_id):
        managed(area_id)
        return jsonify(staff=[dict(id=r.id,userId=r.user_id,username=r.user.username,role=r.role,eligible=r.user.is_active and r.user.role=='teacher') for r in Staff.query.filter_by(research_area_id=area_id).order_by(Staff.id).all()])

    @app.post('/api/research-areas/<int:area_id>/staff')
    @roles_required('admin')
    @guarded
    def research_staff_add(area_id):
        area=managed(area_id); body=payload({'userId'},{'userId'}); user=db.session.get(User,integer(body['userId'],1))
        if user is None or not user.is_active or user.role!='teacher': fail('Only active teachers can be assigned.','EDITOR_INELIGIBLE',400)
        row=Staff(research_area_id=area.id,user_id=user.id,role='editor'); db.session.add(row); commit()
        return jsonify(id=row.id,userId=row.user_id,role=row.role),201

    @app.delete('/api/research-areas/<int:area_id>/staff/<int:staff_id>')
    @roles_required('admin')
    @guarded
    def research_staff_remove(area_id,staff_id):
        area=managed(area_id); row=Staff.query.filter_by(id=staff_id,research_area_id=area.id).first()
        if row is None: fail('Editor relation not found.','RESEARCH_NOT_FOUND',404)
        db.session.delete(row); commit(); return jsonify(deleted=True)

    def resource_for(area, resource_id):
        row=Resource.query.filter_by(id=resource_id,research_area_id=area.id).first()
        if row is None: fail('Resource not found.','RESOURCE_NOT_FOUND',404)
        return row

    def download(area,row):
        stream=assets.open('research_area',area,row)
        try:
            response=send_file(stream,mimetype=row.asset.mime_type,download_name=safe_filename(row.asset.original_filename) or 'resource',as_attachment=True,conditional=False,etag=False,max_age=0)
            response.content_length=row.asset.file_size; response.call_on_close(stream.close); return response
        except Exception: stream.close(); raise

    @app.get('/api/research-areas/<slug>/resources/<int:resource_id>/download')
    @guarded
    def research_resource_download(slug,resource_id):
        area=published(slug); return download(area,resource_for(area,resource_id))

    @app.get('/api/research-areas/<int:area_id>/resources/<int:resource_id>/manage-download')
    @roles_required('teacher','admin')
    @guarded
    def research_managed_resource_download(area_id,resource_id):
        area=managed(area_id); return download(area,resource_for(area,resource_id))

    @app.post('/api/research-areas/<int:area_id>/resources')
    @roles_required('teacher','admin')
    @guarded
    def research_upload_resource(area_id):
        area=managed(area_id)
        if request.mimetype!='multipart/form-data' or set(request.files)!={'file'} or len(request.files.getlist('file'))!=1 or any(len(request.form.getlist(k))!=1 for k in request.form): fail('Exactly one file and valid metadata are required.')
        values=validate_metadata(request.form.to_dict()); integer(values['sort_order'])
        metadata, extension=assets.validate_upload(request.files['file'],values['attachment_type'],app.config['ATTACHMENT_FILE_LIMITS'])
        key=assets.save('research_area',area,request.files['file'].stream,extension); g.research_new_keys.append(key)
        values.update(metadata,storage_key=key); asset=assets.create('research_area',area,values,current_user.id)
        row=Resource(research_area_id=area.id,asset=asset,**{k:values[k] for k in ['display_name','description','access_level','sort_order']})
        db.session.add(row); commit(); return jsonify(resource=resource_json(row,area,True)),201

    @app.post('/api/research-areas/<int:area_id>/resources/link')
    @roles_required('teacher','admin')
    @guarded
    def research_link_resource(area_id):
        area=managed(area_id); values=validate_metadata(request.get_json(silent=True),link=True); integer(values['sort_order'])
        asset=assets.create('research_area',area,values,current_user.id)
        row=Resource(research_area_id=area.id,asset=asset,**{k:values[k] for k in ['display_name','description','access_level','sort_order']})
        db.session.add(row); commit(); return jsonify(resource=resource_json(row,area,True)),201

    @app.route('/api/research-areas/<int:area_id>/resources/<int:resource_id>',methods=['PATCH','DELETE'])
    @roles_required('teacher','admin')
    @guarded
    def research_edit_resource(area_id,resource_id):
        area=managed(area_id); row=resource_for(area,resource_id)
        body=payload({'displayName','description','accessLevel','sortOrder','expectedVersion'} if request.method=='PATCH' else {'expectedVersion'},{'expectedVersion'})
        if integer(body.pop('expectedVersion'),1)!=row.version: fail('Resource changed. Refresh before editing.','RESEARCH_STALE',409)
        if request.method=='DELETE':
            key, asset_id=row.asset.storage_key,row.asset_id
            db.session.delete(row); assets.retire_unreferenced([asset_id]); commit()
            return jsonify(deleted=True,cleanupPending=bool(assets.drain_cleanup([key] if key else [])))
        # Validate with the shared metadata contract using a read-only variant view.
        from types import SimpleNamespace
        existing=SimpleNamespace(attachment_type=row.asset.asset_type,display_name=row.display_name,description=row.description,access_level=row.access_level,sort_order=row.sort_order,external_url=row.asset.external_url)
        values=validate_metadata(body,existing=existing,link=row.asset.asset_type=='external_link'); integer(values['sort_order'])
        for field in ['display_name','description','access_level','sort_order']: setattr(row,field,values[field])
        row.version+=1; commit(); return jsonify(resource=resource_json(row,area,True))

    @app.cli.command('bootstrap-research-areas')
    def research_bootstrap_command():
        try:
            added=bootstrap_research(db,Area,ModuleLink,Course,Module,brain_regions); db.session.commit()
        except (ValueError,SQLAlchemyError) as error:
            db.session.rollback(); raise click.ClickException('Canonical bootstrap failed; existing content was not overwritten.') from error
        click.echo(f'Research areas added: {added}.')
