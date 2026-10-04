"""R4 completion: scoped edits, reading curation, resources and filter contracts."""
from datetime import datetime, timedelta
from io import BytesIO
import unittest
from unittest.mock import patch
from flask.testing import FlaskClient
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.sql.dml import Update
import test_attachments as fixtures
from app import app,db,User,Paper,Course,CourseModule,CourseStaff,CourseResource,ModuleResource,CourseModulePaper as Reading,FileAsset,PaperAttachment
from app import ResearchArea,ResearchAreaStaff,ResearchAreaPaper,ResearchAreaModule,BRAIN_REGIONS
from course_content import bootstrap_course,canonical_content
from research_content import bootstrap_research


class CourseManagementTests(unittest.TestCase):
    tearDown=fixtures.AttachmentTests.tearDown
    login=fixtures.AttachmentTests.login
    create=fixtures.AttachmentTests.create
    upload=fixtures.AttachmentTests.upload
    files=fixtures.AttachmentTests.files

    def setUp(self):
        fixtures.AttachmentTests.setUp(self)
        with app.app_context():
            course,_=bootstrap_course(db,Course,CourseModule)
            bootstrap_research(db,ResearchArea,ResearchAreaModule,Course,CourseModule,BRAIN_REGIONS)
            db.session.add(CourseStaff(course_id=course.id,user_id=1,role='instructor'))
            db.session.add(ResearchAreaStaff(research_area_id=1,user_id=2))
            other=Course(slug='other-course',title='Other course',description='Other content',status='published')
            db.session.add(other);db.session.flush()
            db.session.add(CourseModule(course_id=other.id,slug=course.modules[0].slug,number=1,title='Other module',title_zh='其他',duration_hours=3,category='Other',description='Other description',learning_focus='Other focus',cover_variant='foundation',status='published'))
            db.session.commit();self.slug=course.slug;self.module_slug=course.modules[0].slug
        self.base='/api/courses/1';self.module=self.base+'/modules/1'
        self.public=f'/api/courses/{self.slug}/modules/{self.module_slug}'
        self.login(1)

    @classmethod
    def tearDownClass(cls):
        with app.app_context():db.session.remove();db.engine.dispose()

    def get(self,url):
        response=self.client.get(url);response.get_data();response.close();return response

    def content(self,base,**fields):
        response=self.get(base+'/manage').json
        row=response['module'] if '/modules/' in base else response['course']
        return self.client.patch(base,json=dict(expectedUpdatedAt=row['updatedAt'],**fields))

    def add(self,paper=1,kind='recommended',module=None):
        return self.client.post((module or self.module)+'/papers',json={'paperId':paper,'readingType':kind})

    def resource(self,base=None,access='public',kind='pdf'):
        base=base or self.base
        return self.client.post(base+'/resources/manage',data={'displayName':'Selected resource','attachmentType':kind,'accessLevel':access,'file':(BytesIO(fixtures.png() if kind=='cover' else fixtures.pdf()),'cover.png' if kind=='cover' else 'fixture.pdf')},content_type='multipart/form-data')

    def test_roles_scopes_and_permission_separation(self):
        for uid,status in [(None,401),(4,403),(2,403),(1,200),(3,200)]:
            self.login(uid)
            self.assertEqual(self.get(self.base+'/manage').status_code,status)
            response=self.client.patch(self.base,json={'description':'X','expectedUpdatedAt':'old'})
            self.assertEqual(response.status_code,409 if status==200 else status)
        self.login(1);self.assertEqual(len(self.get('/api/courses/manage').json['courses']),1)
        self.assertEqual(self.get('/api/courses/2/manage').status_code,403)
        self.assertEqual(self.get('/api/research-areas/1/manage').status_code,403)
        self.login(2);self.assertEqual(self.get('/api/research-areas/1/manage').status_code,200)
        self.assertEqual(self.get(self.base+'/manage').status_code,403)
        self.login(3);self.assertEqual(len(self.get('/api/courses/manage').json['courses']),2)

    def test_content_updates_stale_conflicts_and_canonical_identity(self):
        for base,key in [(self.base,'course'),(self.module,'module')]:
            old=self.get(base+'/manage').json[key]
            response=self.client.patch(base,json={'description':'Edited description','expectedUpdatedAt':old['updatedAt']})
            self.assertEqual(response.status_code,200)
            self.assertEqual(self.get(base+'/manage').json[key]['description'],'Edited description')
            self.assertEqual(self.client.patch(base,json={'description':'Stale description','expectedUpdatedAt':old['updatedAt']}).status_code,409)
        self.assertEqual(self.content(self.module,learningFocus='Edited focus',category='Edited category').status_code,200)
        with app.app_context():
            rows=CourseModule.query.filter_by(course_id=1).order_by(CourseModule.number).all()
            self.assertEqual([(r.number,r.slug,r.title,r.title_zh,r.duration_hours) for r in rows],[(r['number'],r['slug'],r['title'],r['titleZh'],r['durationHours']) for r in canonical_content()['modules']])
            self.assertEqual(sum(r.duration_hours for r in rows),36)

    def test_atomic_compare_and_swap_rejects_intervening_write(self):
        stamp=self.get(self.base+'/manage').json['course']['updatedAt'];execute=db.session.execute;triggered=False
        def concurrent(statement,*args,**kwargs):
            nonlocal triggered
            if isinstance(statement,Update) and statement.table.name=='courses' and not triggered:
                triggered=True
                execute(update(Course).where(Course.id==1).values(description='Other editor',updated_at=datetime.fromisoformat(stamp)+timedelta(seconds=1)),execution_options={'synchronize_session':False})
                db.session.commit()
            return execute(statement,*args,**kwargs)
        with patch.object(db.session,'execute',side_effect=concurrent):
            response=self.client.patch(self.base,json={'description':'Overwritten','expectedUpdatedAt':stamp})
        self.assertTrue(triggered);self.assertEqual(response.status_code,409)
        self.assertEqual(self.get(self.base+'/manage').json['course']['description'],'Other editor')

    def test_strict_fields_validation_csrf_and_wrong_module(self):
        for base in [self.base,self.module]:
            for field in ['slug','number','title','titleZh','durationHours','course_id','userId']:
                self.assertEqual(self.content(base,**{field:'alter'}).status_code,400)
            for data in [{'description':''},{'description':'x'*6001},{'status':'hidden'}]:
                self.assertEqual(self.content(base,**data).status_code,400)
        self.assertEqual(self.content(self.module,category='x'*151).status_code,400)
        self.assertEqual(self.get(self.base+'/modules/13/manage').status_code,404)
        raw=FlaskClient(app)
        with raw.session_transaction() as session:session['_user_id']='1:1';session['auth_version']=1;session['_fresh']=True
        self.assertEqual(raw.patch(self.base,json={}).status_code,403)
        self.assertEqual(raw.post(self.module+'/papers',json={}).status_code,403)

    def test_staff_admin_assignment_role_eligibility_and_removal(self):
        self.assertEqual(self.client.post(self.base+'/staff',json={'userId':2,'role':'assistant'}).status_code,403)
        self.login(3)
        for uid,role in [(4,'assistant'),(3,'instructor'),(2,'owner')]:
            self.assertEqual(self.client.post(self.base+'/staff',json={'userId':uid,'role':role}).status_code,400)
        assigned=self.client.post(self.base+'/staff',json={'userId':2,'role':'assistant'})
        self.assertEqual(assigned.status_code,201);sid=assigned.json['staff'][-1]['id']
        self.assertEqual(self.client.post(self.base+'/staff',json={'userId':2,'role':'instructor'}).status_code,409)
        self.login(2);self.assertEqual(self.get(self.base+'/manage').status_code,200)
        self.assertEqual(self.client.delete(self.base+f'/staff/{sid}').status_code,403)
        with app.app_context():db.session.delete(db.session.get(CourseStaff,sid));db.session.commit()
        self.assertEqual(self.get(self.base+'/manage').status_code,403)
        self.login(3);self.assertEqual(self.client.delete(self.base+'/staff/1').status_code,200)
        self.login(1);self.assertEqual(self.get(self.base+'/manage').status_code,403)

    def test_disabled_and_demoted_course_staff_lose_effective_access(self):
        with app.app_context():db.session.get(User,1).is_active=False;db.session.commit()
        self.assertEqual(self.get(self.base+'/manage').status_code,401)
        with app.app_context():db.session.get(User,1).is_active=True;db.session.get(User,1).role='student';db.session.commit()
        self.login(1);self.assertEqual(self.get(self.base+'/manage').status_code,403)
        self.login(3);self.assertEqual(self.client.post(self.base+'/staff',json={'userId':1,'role':'instructor'}).status_code,400)

    def test_reading_others_paper_no_ownership_gain_redacts_private_metadata(self):
        self.assertEqual(self.add(2,'required').status_code,201)
        self.assertEqual(self.client.patch('/api/papers/2',json={'title':'Hijack'}).status_code,403)
        with app.app_context():
            paper=db.session.get(Paper,2);paper.status='draft';paper.title='Private content';paper.abstract='Secret draft';db.session.commit()
        self.assertEqual(self.get(self.public+'/papers').json['readings'],[])
        rows=self.get(self.module+'/papers').json['readings'];self.assertIsNone(rows[0]['paper'])
        self.assertNotIn('Private content',str(rows));self.assertEqual(rows[0]['status'],'draft')
        self.login(3);self.assertEqual(self.get(self.module+'/papers').json['readings'][0]['paper']['title'],'Private content')

    def test_reading_unique_remove_and_safe_parent_fks(self):
        response=self.add();rid=response.json['readings'][0]['relationId'];self.assertEqual(self.add().status_code,409)
        with app.app_context():
            for Model,identity in [(Paper,1),(CourseModule,1)]:
                db.session.delete(db.session.get(Model,identity))
                with self.assertRaises(IntegrityError):db.session.commit()
                db.session.rollback()
        self.assertEqual(self.client.delete(self.module+f'/papers/{rid}').status_code,200)
        self.assertEqual(self.client.delete(self.module+f'/papers/{rid}').status_code,404)
        with app.app_context():self.assertIsNotNone(db.session.get(Paper,1));self.assertIsNotNone(db.session.get(CourseModule,1))
        self.assertEqual(self.add(999).status_code,404)
        for pid in [3,4]:self.assertEqual(self.add(pid).status_code,404)

    def test_reading_types_and_persisted_order(self):
        self.add(1,'required');self.add(2,'recommended')
        rows=self.get(self.module+'/papers').json['readings'];ids=[r['relationId'] for r in rows]
        self.assertEqual(self.client.put(self.module+'/papers/order',json={'relationIds':ids[::-1]}).status_code,200)
        actual=self.get(self.public+'/papers').json['readings'];self.assertEqual([r['relationId'] for r in actual],ids[::-1])
        self.assertEqual(self.client.patch(self.module+f'/papers/{ids[0]}',json={'readingType':'recommended'}).status_code,200)
        self.assertEqual(self.client.put(self.module+'/papers/order',json={'relationIds':ids[:1]}).status_code,409)
        self.assertEqual(self.client.put(self.module+'/papers/order',json={'relationIds':[ids[0],ids[0]]}).status_code,400)
        self.assertEqual(self.client.patch(self.module+f'/papers/{ids[0]}',json={'readingType':'fake'}).status_code,400)

    def test_module_and_parent_publication_boundaries_even_admin(self):
        self.add();self.login(3)
        for base in [self.base,self.module]:
            for status in ['draft','archived']:
                self.assertEqual(self.content(base,status=status).status_code,200)
                self.assertEqual(self.get(self.public+'/papers').status_code,404)
                self.assertEqual(self.client.get('/api/papers',query_string={'course':self.slug,'module':self.module_slug}).json['pagination']['total'],0)
            self.content(base,status='published')

    def test_papers_filter_disambiguates_courses_preserves_other_filters(self):
        self.add(1);self.login(3);self.add(2,module='/api/courses/2/modules/13')
        query={'course':self.slug,'module':self.module_slug,'q':'Fixture','topic':'Memory','author':'Fixture','difficulty':'Beginner','publicationType':'Research Article','resourceCategory':'Foundational','sort':'title','view':'all','perPage':1,'page':1}
        response=self.client.get('/api/papers',query_string=query)
        self.assertEqual(response.status_code,200);self.assertEqual([p['id'] for p in response.json['papers']],[1])
        self.assertEqual(response.json['filters']['course'],self.slug);self.assertEqual(response.json['filters']['module'],self.module_slug)
        query['course']='other-course';self.assertEqual([p['id'] for p in self.client.get('/api/papers',query_string=query).json['papers']],[2])
        query['q']='no-match';self.assertEqual(self.client.get('/api/papers',query_string=query).json['papers'],[])
        self.assertEqual(self.client.get('/api/papers',query_string={'module':self.module_slug}).status_code,400)
        self.assertEqual(self.client.get('/api/papers',query_string={'course':"' OR 1=1 --"}).status_code,400)
        self.assertEqual(self.client.get('/api/papers',query_string={'course':'missing'}).json['papers'],[])

    def test_no_duplicate_paper_when_course_filter_has_multiple_module_links(self):
        self.add(1);self.add(1,module=self.base+'/modules/2')
        response=self.client.get('/api/papers',query_string={'course':self.slug})
        self.assertEqual(response.json['pagination']['total'],1)

    def test_research_editor_cannot_read_private_related_content(self):
        self.login(2)
        self.assertEqual(self.client.post('/api/research-areas/1/papers',json={'paperId':1}).status_code,201)
        self.assertEqual(self.client.post('/api/research-areas/1/modules',json={'moduleId':1}).status_code,201)
        with app.app_context():
            db.session.get(Paper,1).status='archived';db.session.get(Paper,1).title='Sensitive paper'
            db.session.get(CourseModule,1).status='draft';db.session.get(CourseModule,1).description='Sensitive module';db.session.commit()
        data=self.get('/api/research-areas/1/manage').json
        self.assertIsNone(data['papers'][0]['paper']);self.assertIsNone(data['modules'][0]['module']);self.assertIsNone(data['modules'][0]['course'])
        self.assertNotIn('Sensitive',str(data))
        self.login(3);data=self.get('/api/research-areas/1/manage').json
        self.assertEqual(data['papers'][0]['paper']['title'],'Sensitive paper');self.assertIsNotNone(data['modules'][0]['module'])

    def test_resources_create_access_cover_and_metadata_versions(self):
        for base,public in [(self.base,f'/api/courses/{self.slug}'),(self.module,self.public)]:
            items=[]
            for access in ['public','authenticated','staff']:
                self.login(1);response=self.resource(base,access);self.assertEqual(response.status_code,201);items.append(response.json['resources'][-1])
            self.resource(base,kind='cover')
            for uid,total in [(None,1),(4,2),(2,2),(1,3),(3,3)]:
                self.login(uid);self.assertEqual(len(self.get(public+'/resources').json['resources']),total)
                self.assertEqual(self.get(public+f"/resources/{items[-1]['id']}/download").status_code,200 if uid in [1,3] else 403)
            self.login(1);row=items[0]
            self.assertEqual(self.client.patch(base+f"/resources/{row['id']}",json={'expectedVersion':1,'expectedUpdatedAt':row['updatedAt'],'displayName':'Changed'}).status_code,200)
            self.assertEqual(self.client.delete(base+f"/resources/{row['id']}",json={'expectedVersion':1,'expectedUpdatedAt':row['updatedAt']}).status_code,409)
            fresh=next(r for r in self.get(base+'/resources/manage').json['resources'] if r['id']==row['id'])
            self.assertEqual(fresh['version'],1)
            self.assertEqual(self.client.delete(base+f"/resources/{row['id']}",json={'expectedVersion':1,'expectedUpdatedAt':fresh['updatedAt']}).status_code,200)
        self.login(2);self.assertEqual(self.resource().status_code,403)

    def test_resource_links_order_validation_and_draft_download(self):
        for name in ['One','Two']:
            response=self.client.post(self.module+'/resources/manage',json={'displayName':name,'attachmentType':'external_link','externalUrl':'https://example.test/'+name,'accessLevel':'public'})
            self.assertEqual(response.status_code,201)
        rows=response.json['resources'];ids=[r['id'] for r in rows]
        self.assertEqual(self.client.put(self.module+'/resources/order',json={'relationIds':ids[::-1]}).status_code,200)
        self.assertEqual([r['id'] for r in self.get(self.module+'/resources/manage').json['resources']],ids[::-1])
        self.assertEqual(self.client.post(self.module+'/resources/manage',json={'displayName':'Bad','attachmentType':'external_link','externalUrl':'javascript:alert(1)'}).status_code,400)
        self.assertEqual(self.client.put(self.module+'/resources/order',json={'relationIds':[]}).status_code,409)
        file=next(r for r in self.resource(self.module).json['resources'] if r['attachmentType']=='pdf')
        self.content(self.module,status='draft')
        self.assertEqual(self.get(file['downloadUrl']).status_code,200)
        self.assertEqual(self.get(self.public+f"/resources/{file['id']}/download").status_code,404)

    def test_resource_db_storage_compensation_and_shared_asset_retirement(self):
        with patch.object(db.session,'commit',side_effect=SQLAlchemyError('internal detail')):
            response=self.resource();self.assertEqual(response.status_code,503);self.assertNotIn('internal detail',str(response.json))
        self.assertEqual(self.files(),[])
        with patch.object(self.backend,'save_file',side_effect=PermissionError('fixture')): self.assertEqual(self.resource().status_code,503)
        response=self.resource();row=response.json['resources'][0]
        with app.app_context():
            resource=db.session.get(CourseResource,row['id']);aid=resource.asset_id
            db.session.add(ModuleResource(module_id=1,asset_id=aid,display_name='Shared',access_level='public'));db.session.commit()
        self.assertEqual(self.client.delete(self.base+f"/resources/{row['id']}",json={'expectedVersion':1,'expectedUpdatedAt':row['updatedAt']}).status_code,200)
        with app.app_context():self.assertIsNotNone(db.session.get(FileAsset,aid))
        shared=self.get(self.module+'/resources/manage').json['resources'][0]
        self.assertTrue(self.files());self.assertEqual(self.client.delete(self.module+'/resources/1',json={'expectedVersion':1,'expectedUpdatedAt':shared['updatedAt']}).status_code,200)
        self.assertFalse(self.files())

    def test_database_failure_rolls_back_content(self):
        before=self.get(self.base+'/manage').json['course']
        with patch.object(db.session,'commit',side_effect=SQLAlchemyError('internal detail')):
            response=self.content(self.base,description='Not committed');self.assertEqual(response.status_code,503)
        self.assertEqual(self.get(self.base+'/manage').json['course']['description'],before['description'])


if __name__=='__main__': unittest.main()
