"""Explicit curation, scoped editors and shared FileAsset integration."""
from io import BytesIO
import unittest
from unittest.mock import patch
from flask import session
from flask.testing import FlaskClient
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
import test_attachments as fixtures
from app import app,db,User,Paper,PaperAttachment,FileAsset,Course,CourseModule,CourseStaff,BRAIN_REGIONS
from app import ResearchArea as Area,ResearchAreaStaff as Staff,ResearchAreaPaper as PaperLink,ResearchAreaModule as ModuleLink,ResearchAreaResource as Resource
from course_content import bootstrap_course
from research_content import bootstrap_research,canonical_research
from attachment_files import AttachmentError

SLUGS=['neuroscience','cognitive-science','brain-computer-interfaces','brain-inspired-computing','artificial-intelligence','brain-disorders']


class ResearchTests(unittest.TestCase):
    tearDown=fixtures.AttachmentTests.tearDown
    login=fixtures.AttachmentTests.login
    create=fixtures.AttachmentTests.create
    upload=fixtures.AttachmentTests.upload
    files=fixtures.AttachmentTests.files

    def setUp(self):
        fixtures.AttachmentTests.setUp(self)
        with app.app_context():
            bootstrap_course(db,Course,CourseModule)
            bootstrap_research(db,Area,ModuleLink,Course,CourseModule,BRAIN_REGIONS)
            db.session.add(Staff(research_area_id=1,user_id=1)); db.session.commit()
        self.url='/api/research-areas/1'; self.public='/api/research-areas/neuroscience'

    @classmethod
    def tearDownClass(cls):
        with app.app_context(): db.session.remove();db.engine.dispose()

    @property
    def service(self): return app.extensions['file_asset_service']

    def get(self,url):
        response=self.client.get(url);response.get_data();response.close();return response

    def detail(self,area_id=1): return self.get(f'/api/research-areas/{area_id}/manage').json

    def add(self,kind,target,area_id=1):
        self.login(3)
        return self.client.post(f'/api/research-areas/{area_id}/{kind}',json={('paperId' if kind=='papers' else 'moduleId'):target})

    def resource(self,access='public',kind='pdf'):
        self.login(1)
        return self.client.post(self.url+'/resources',data={'displayName':'Research resource','attachmentType':kind,'accessLevel':access,'file':(BytesIO(fixtures.pdf() if kind=='pdf' else fixtures.png()),'fixture.pdf' if kind=='pdf' else 'cover.png','application/pdf' if kind=='pdf' else 'image/png')},content_type='multipart/form-data')

    def test_exact_six_identities_order_and_legitimate_empty_content(self):
        areas=self.get('/api/research-areas').json['areas']
        self.assertEqual([a['slug'] for a in areas],SLUGS)
        self.assertEqual([a['code'] for a in areas],[f'RA-{i:02}' for i in range(1,7)])
        self.assertEqual([a['sortOrder'] for a in areas],list(range(1,7)))
        self.assertEqual(len(set(a['name'] for a in areas)),6)
        self.assertEqual([a['overview'] for a in areas], [''] * 6)
        self.assertEqual([a['subtopics'] for a in areas], [[] for _ in range(6)])
        with app.app_context(): self.assertEqual(Area.query.count(),6);self.assertEqual(PaperLink.query.count(),0)

    def test_canonical_links_only_five_and_anatomy_existing(self):
        ai=self.get('/api/research-areas/artificial-intelligence').json
        self.assertEqual([r['module']['number'] for r in ai['modules']],[8])
        disorders=self.get('/api/research-areas/brain-disorders').json
        self.assertEqual([r['module']['number'] for r in disorders['modules']],[4,5,6,7])
        self.assertEqual({r['slug'] for r in self.get(self.public).json['brainRegions']},set(BRAIN_REGIONS))
        with app.app_context(): self.assertEqual(ModuleLink.query.count(),5)
        for slug in SLUGS[:4]: self.assertEqual(self.get('/api/research-areas/'+slug).json['modules'],[])
        self.assertEqual(ai['hubContent'],[])

    def test_unique_code_slug_order_and_no_seventh_area(self):
        with app.app_context():
            for field,value in [('code','RA-01'),('slug','neuroscience'),('sort_order',1),('code','RA-07')]:
                row=db.session.get(Area,2);setattr(row,field,value)
                with self.assertRaises(IntegrityError): db.session.commit()
                db.session.rollback()

    def test_bootstrap_preserves_edits_and_removed_curated_links(self):
        with app.app_context():
            area=db.session.get(Area,5);area.overview='Edited overview';area.subtopics=['Edited topic']
            ModuleLink.query.filter_by(research_area_id=5).delete(); db.session.commit()
            self.assertEqual(bootstrap_research(db,Area,ModuleLink,Course,CourseModule,BRAIN_REGIONS),0)
            self.assertEqual(area.overview,'Edited overview');self.assertEqual(area.subtopics,['Edited topic'])
            self.assertEqual(ModuleLink.query.filter_by(research_area_id=5).count(),0)

    def test_public_hides_draft_archived_even_from_admin(self):
        self.login(3)
        for status in ['draft','archived']:
            with app.app_context(): db.session.get(Area,1).status=status;db.session.commit()
            self.assertEqual(self.get(self.public).status_code,404)
            self.assertEqual(len(self.get('/api/research-areas').json['areas']),5)
            self.assertEqual(self.get(self.url+'/manage').status_code,200)
        self.assertEqual(self.get('/api/research-areas/missing').status_code,404)

    def test_management_membership_and_global_roles(self):
        for uid,status in [(None,401),(4,403),(2,403),(1,200),(3,200)]:
            self.login(uid);self.assertEqual(self.get(self.url+'/manage').status_code,status)
        self.login(1);self.assertEqual([a['id'] for a in self.get('/api/research-areas/manage').json['areas']],[1])
        self.login(2);self.assertEqual(self.get('/api/research-areas/manage').json['areas'],[])
        self.login(3);self.assertEqual(len(self.get('/api/research-areas/manage').json['areas']),6)

    def test_overview_subtopics_strict_fields_stale_and_anatomy_validation(self):
        self.login(1);stamp=self.detail()['area']['updatedAt']
        for body in [{'name':'Renamed'},{'code':'RA-07'},{'subtopics':'text'},{'brainRegionSlugs':['invented']},{'subtopics':['Repeated','Repeated']}]:
            response=self.client.patch(self.url,json={'expectedUpdatedAt':stamp,**body});self.assertEqual(response.status_code,400)
        result=self.client.patch(self.url,json={'expectedUpdatedAt':stamp,'overview':'Edited overview','subtopics':['Attention'],'brainRegionSlugs':['frontal-lobe']})
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.get(self.public).json['area']['overview'],'Edited overview')
        self.assertEqual(self.get(self.public).json['brainRegions'],[{'slug':'frontal-lobe','name':'Frontal Lobe'}])
        self.assertEqual(self.client.patch(self.url,json={'expectedUpdatedAt':stamp,'overview':'Stale'}).status_code,409)

    def test_editor_can_curate_others_paper_without_edit_permission(self):
        self.login(1)
        self.assertEqual(self.client.post(self.url+'/papers',json={'paperId':2}).status_code,201)
        self.assertEqual(self.client.patch('/api/papers/2',json={'title':'Hijack'}).status_code,403)
        self.assertEqual(self.get('/api/papers/manage/2').status_code,403)
        with app.app_context(): self.assertEqual(db.session.get(Paper,2).created_by_id,2)

    def test_cross_area_paper_remove_archive_and_unique(self):
        first=self.add('papers',1).json['papers'][0]['relationId'];self.assertEqual(self.add('papers',1,2).status_code,201)
        for slug in SLUGS[:2]: self.assertEqual(len(self.get('/api/research-areas/'+slug).json['papers']),1)
        self.assertEqual(self.add('papers',1).status_code,409)
        self.client.delete(self.url+f'/papers/{first}')
        with app.app_context(): self.assertIsNotNone(db.session.get(Paper,1))
        self.assertEqual(len(self.get('/api/research-areas/cognitive-science').json['papers']),1)
        for status in ['draft','archived']:
            with app.app_context(): db.session.get(Paper,1).status=status;db.session.commit()
            self.assertEqual(self.get('/api/research-areas/cognitive-science').json['papers'],[])
        self.assertEqual(self.add('papers',3).status_code,404);self.assertEqual(self.add('papers',4).status_code,404)

    def test_module_cross_area_publication_and_no_course_permission(self):
        self.assertEqual(self.add('modules',1).status_code,201);self.assertEqual(self.add('modules',1,2).status_code,201)
        self.assertEqual(self.add('modules',1).status_code,409)
        self.login(1);self.assertEqual(self.get('/api/courses/1/manage').status_code,403)
        with app.app_context(): self.assertEqual(CourseStaff.query.count(),0)
        for field in ['module','course']:
            with app.app_context():
                target=db.session.get(CourseModule if field=='module' else Course,1);target.status='draft';db.session.commit()
            for slug in SLUGS[:2]: self.assertEqual(self.get('/api/research-areas/'+slug).json['modules'],[])
            self.assertEqual(self.add('modules',1,3).status_code,404)
            with app.app_context(): target=db.session.get(CourseModule if field=='module' else Course,1);target.status='published';db.session.commit()

    def test_atomic_order_persists_and_rejects_missing_or_foreign_ids(self):
        self.add('papers',1);self.add('papers',2)
        self.login(1);ids=[r['relationId'] for r in self.detail()['papers']]
        result=self.client.put(self.url+'/papers/order',json={'relationIds':list(reversed(ids))})
        self.assertEqual(result.status_code,200)
        self.assertEqual([r['paper']['id'] for r in self.get(self.public).json['papers']],[2,1])
        self.assertEqual(self.client.put(self.url+'/papers/order',json={'relationIds':[ids[0]]}).status_code,409)
        self.assertEqual(self.client.put(self.url+'/papers/order',json={'relationIds':[ids[0],ids[0]]}).status_code,400)
        self.assertEqual(self.client.delete('/api/research-areas/2/papers/'+str(ids[0])).status_code,403)

    def test_admin_staff_assignment_eligibility_and_revocation(self):
        self.login(1);self.assertEqual(self.client.post('/api/research-areas/2/staff',json={'userId':1}).status_code,403)
        self.login(3)
        self.assertEqual(self.client.post(self.url+'/staff',json={'userId':4}).status_code,400)
        with app.app_context(): db.session.get(User,2).is_active=False;db.session.commit()
        self.assertEqual(self.client.post(self.url+'/staff',json={'userId':2}).status_code,400)
        with app.app_context(): db.session.get(User,2).is_active=True;db.session.commit()
        row=self.client.post('/api/research-areas/2/staff',json={'userId':2}).json
        self.assertEqual(self.client.post('/api/research-areas/2/staff',json={'userId':2}).status_code,409)
        self.login(2);self.assertEqual(self.get('/api/research-areas/2/manage').status_code,200)
        self.login(3);self.client.delete(f"/api/research-areas/2/staff/{row['id']}")
        self.login(2);self.assertEqual(self.get('/api/research-areas/2/manage').status_code,403)
        with app.app_context(): db.session.get(User,1).role='student';db.session.commit()
        self.login(1);self.assertEqual(self.get(self.url+'/manage').status_code,403)
        with app.app_context(): db.session.get(User,1).role='teacher';db.session.get(User,1).is_active=False;db.session.commit()
        self.login(1);self.assertEqual(self.get(self.url+'/manage').status_code,401)

    def test_editor_search_paged_and_active_teachers_only(self):
        self.login(3);data=self.get('/api/research-areas/editors?q=fixture&page=1').json
        self.assertEqual([u['id'] for u in data['users']],[1,2]);self.assertEqual(data['perPage'],20)
        self.assertEqual(self.get('/api/research-areas/editors?page=0').status_code,400)
        self.login(1);self.assertEqual(self.get('/api/research-areas/editors').status_code,403)

    def test_resource_policy_access_and_entity_context(self):
        for access in ['public','authenticated','staff']:
            item=self.resource(access).json['resource'];path=self.public+f"/resources/{item['id']}/download"
            for uid in [None,4,2,1,3]:
                self.login(uid);allowed=access=='public' or (access=='authenticated' and uid is not None) or uid in [1,3]
                self.assertEqual(self.get(path).status_code,200 if allowed else 403)
        self.assertEqual(self.get('/api/research-areas/cognitive-science/resources/1/download').status_code,404)
        with app.test_request_context():
            session.update(_user_id='3:1',auth_version=1)
            row=db.session.get(Resource,1)
            with self.assertRaises(AttachmentError): self.service.open('research_area',db.session.get(Paper,1),row)
        body=self.get(self.public).get_data(as_text=True)
        self.assertNotIn('storage_key',body);self.assertNotIn('asset_id',body)

    def test_cover_not_regular_download_resource_and_external_url_validation(self):
        self.assertEqual(self.resource(kind='cover').status_code,201);self.login(None)
        self.assertEqual(self.get(self.public).json['resources'],[])
        self.login(1)
        for url,status in [('javascript:alert(1)',400),('https://example.test/resource',201)]:
            response=self.client.post(self.url+'/resources/link',json={'attachmentType':'external_link','displayName':'Link','externalUrl':url})
            self.assertEqual(response.status_code,status)
        self.login(None);item=self.get(self.public).json['resources'][0]
        self.assertIsNone(item['downloadUrl']);self.assertEqual(item['externalUrl'],'https://example.test/resource')

    def test_shared_paper_asset_kept_until_last_area_reference(self):
        source=self.create()
        with app.test_request_context():
            session.update(_user_id='1:1',auth_version=1)
            source_row=db.session.get(PaperAttachment,source['id'])
            row=Resource(research_area_id=1,display_name='Shared',access_level='public')
            self.service.bind_existing('research_area',db.session.get(Area,1),row,source_kind='paper',source_resource=db.session.get(Paper,1),source_relation=source_row)
            db.session.add(row);db.session.commit();rid=row.id;aid=row.asset_id
        self.login(1);self.client.delete(f"/api/papers/1/attachments/{source['id']}")
        self.assertEqual(self.get(self.public+f'/resources/{rid}/download').data,fixtures.pdf())
        with app.app_context():self.assertIsNotNone(db.session.get(FileAsset,aid))
        self.assertEqual(self.client.delete(self.url+f'/resources/{rid}',json={'expectedVersion':1}).status_code,200)
        with app.app_context():self.assertIsNone(db.session.get(FileAsset,aid))
        self.assertFalse(self.files())

    def test_resource_metadata_version_delete_parent_restrict_and_failure_compensation(self):
        item=self.resource().json['resource'];self.login(1)
        self.assertEqual(self.client.patch(self.url+f"/resources/{item['id']}",json={'displayName':'Edited','expectedVersion':1}).json['resource']['version'],2)
        self.assertEqual(self.client.delete(self.url+f"/resources/{item['id']}",json={'expectedVersion':1}).status_code,409)
        with app.app_context():
            db.session.delete(db.session.get(Area,1))
            with self.assertRaises(IntegrityError):db.session.commit()
            db.session.rollback()
        count=len(self.files())
        with patch.object(db.session,'commit',side_effect=SQLAlchemyError('private detail')):
            response=self.resource()
        self.assertEqual(response.status_code,503);self.assertNotIn('private detail',response.get_data(as_text=True));self.assertEqual(len(self.files()),count)
        with patch.object(self.backend,'save_file',side_effect=PermissionError('fixture')):
            self.assertEqual(self.resource().status_code,503)
        self.assertEqual(len(self.files()),count)

    def test_all_mutations_require_csrf(self):
        raw=FlaskClient(app,app.response_class,use_cookies=True)
        with raw.session_transaction() as s:s.update(_user_id='3:1',auth_version=1)
        for method,path in [('PATCH',self.url),('POST',self.url+'/papers'),('DELETE',self.url+'/papers/1'),('PUT',self.url+'/modules/order'),('POST',self.url+'/staff'),('POST',self.url+'/resources/link')]:
            response=raw.open(path,method=method,json={});self.assertEqual(response.status_code,403);self.assertEqual(response.json['code'],'CSRF_MISSING')
