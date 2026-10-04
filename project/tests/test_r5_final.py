"""Final learning/content-version and cross-feature contracts."""
from io import BytesIO
import unittest
from unittest.mock import patch
from sqlalchemy.exc import SQLAlchemyError
import test_attachments as fixtures
import test_learning as learning_fixtures
from app import (app, db, CourseResource, ModuleResource, FileAsset, PaperAttachment,
                 CourseResourceProgress, ModuleResourceProgress, PaperAttachmentProgress,
                 GuidedNote, ConceptHighlight, Enrollment, ModuleProgress, Bookmark, PaperReadingProgress)


class R5FinalTests(unittest.TestCase):
    setUp=learning_fixtures.LearningTests.setUp
    tearDown=learning_fixtures.LearningTests.tearDown
    tearDownClass=learning_fixtures.LearningTests.tearDownClass
    login=learning_fixtures.LearningTests.login
    get=learning_fixtures.LearningTests.get
    resource=learning_fixtures.LearningTests.resource
    enroll=learning_fixtures.LearningTests.enroll
    state=learning_fixtures.LearningTests.state
    resource_action=learning_fixtures.LearningTests.resource_action
    action=learning_fixtures.LearningTests.action
    link=fixtures.AttachmentTests.link

    def token(self,row):
        return dict(expectedVersion=row['version'],expectedUpdatedAt=row['updatedAt'])

    def managed(self,base,identity):
        return next(r for r in self.get(base+'/resources/manage').json['resources'] if r['id']==identity)

    def test_metadata_sort_access_keep_content_and_completion_but_reject_stale_editor(self):
        for kind,base in [('course',self.base),('module',self.module)]:
            self.login(1);row=self.resource(base).json['resources'][-1]
            second=self.resource(base).json['resources'][-1]
            self.login(4);self.enroll();self.resource_action(row['id'],kind)
            original=next(r for r in self.state()['resources'] if r['kind']==kind and r['resourceId']==row['id'])
            self.login(1)
            r=self.client.patch(base+f"/resources/{row['id']}",json={**self.token(row),'displayName':'Corrected','description':'Presentation only','sortOrder':8,'accessLevel':'authenticated'})
            self.assertEqual(r.status_code,200,r.json)
            self.assertEqual(self.client.patch(base+f"/resources/{row['id']}",json={**self.token(row),'displayName':'Stale'}).status_code,409)
            self.assertEqual(self.client.put(base+'/resources/order',json={'relationIds':[second['id'],row['id']]}).status_code,200)
            row=self.managed(base,row['id']);self.assertEqual(row['version'],1)
            self.login(4)
            current=next(r for r in self.state()['resources'] if r['kind']==kind and r['resourceId']==row['id'])
            self.assertEqual(current['selfCompletedAt'],original['selfCompletedAt']);self.assertEqual(current['history'],[])
            self.assertEqual(self.resource_action(row['id'],kind,action='start').status_code,200)
            self.login(1)
            self.client.patch(base+f"/resources/{row['id']}",json={**self.token(row),'accessLevel':'staff'})
            hidden=self.managed(base,row['id']);self.assertEqual(hidden['version'],1)
            self.login(4)
            self.assertEqual(self.resource_action(row['id'],kind).json,self.resource_action(99999,kind).json)
            self.login(1);self.client.patch(base+f"/resources/{row['id']}",json={**self.token(hidden),'accessLevel':'public'})
            self.login(4)
            current=next(r for r in self.state()['resources'] if r['kind']==kind and r['resourceId']==row['id'])
            self.assertEqual(current['selfCompletedAt'],original['selfCompletedAt'])

    def test_file_and_url_replacements_keep_relation_and_history(self):
        for kind,base,Model,Progress in [('course',self.base,CourseResource,CourseResourceProgress),('module',self.module,ModuleResource,ModuleResourceProgress)]:
            for file in [False,True]:
                self.login(1)
                row=(self.resource(base) if file else self.client.post(base+'/resources/manage',json={'attachmentType':'external_link','displayName':'Link','externalUrl':'https://example.test/v1'})).json['resources'][-1]
                self.login(4);self.enroll();self.resource_action(row['id'],kind)
                self.login(1)
                if file:
                    r=self.client.put(base+f"/resources/{row['id']}",data={**self.token(row),'file':(BytesIO(fixtures.pdf('real v2')),'v2.pdf')},content_type='multipart/form-data')
                else:
                    r=self.client.put(base+f"/resources/{row['id']}",json={**self.token(row),'externalUrl':'https://example.test/v2'})
                self.assertEqual(r.status_code,200,r.json);fresh=r.json['resource']
                self.assertEqual(fresh['id'],row['id']);self.assertEqual(fresh['version'],2)
                self.login(4);self.assertEqual(self.resource_action(row['id'],kind).status_code,409)
                current=next(r for r in self.state()['resources'] if r['kind']==kind and r['resourceId']==row['id'])
                self.assertEqual(current['status'],'not_started');self.assertEqual(current['history'][0]['status'],'completed')
                self.resource_action(row['id'],kind,version=2)
                with app.app_context():self.assertEqual([p.resource_version for p in Progress.query.filter_by(resource_id=row['id']).order_by(Progress.resource_version)],[1,2])
                self.login(1)
                if file:r=self.client.put(base+f"/resources/{row['id']}",data={**self.token(fresh),'file':(BytesIO(fixtures.pdf('real v2')),'renamed.pdf')},content_type='multipart/form-data')
                else:r=self.client.put(base+f"/resources/{row['id']}",json={**self.token(fresh),'externalUrl':'https://example.test/v2'})
                self.assertEqual(r.status_code,200,r.json);self.assertEqual(r.json['resource']['version'],2)
                self.assertEqual(r.json['resource']['updatedAt'],fresh['updatedAt'])

    def test_replacement_access_validation_rollback_and_shared_asset(self):
        row=self.resource().json['resources'][0];url=self.base+f"/resources/{row['id']}"
        with app.app_context():
            old=db.session.get(CourseResource,row['id']);asset_id=old.asset_id
            db.session.add(ModuleResource(module_id=1,asset_id=asset_id,display_name='Shared',access_level='public'));db.session.commit()
        for uid,status in [(None,401),(4,403),(2,403)]:
            self.login(uid);self.assertEqual(self.client.put(url,json={}).status_code,status)
        self.login(1)
        self.assertEqual(self.client.put(url,data={**self.token(row),'file':(BytesIO(b'bad'),'bad.pdf')},content_type='multipart/form-data').status_code,400)
        with patch.object(db.session,'commit',side_effect=SQLAlchemyError('private connection')):
            r=self.client.put(url,data={**self.token(row),'file':(BytesIO(fixtures.pdf('rollback')),'new.pdf')},content_type='multipart/form-data')
            self.assertEqual(r.status_code,503);self.assertNotIn('private connection',str(r.json))
        self.assertEqual(self.managed(self.base,row['id']),row)
        r=self.client.put(url,data={**self.token(row),'file':(BytesIO(fixtures.pdf('replacement')),'new.pdf')},content_type='multipart/form-data')
        self.assertEqual(r.status_code,200,r.json)
        with app.app_context():
            self.assertIsNotNone(db.session.get(FileAsset,asset_id));self.assertEqual(ModuleResource.query.one().asset_id,asset_id)
            self.assertNotEqual(db.session.get(CourseResource,row['id']).asset_id,asset_id)

    def test_paper_link_metadata_keeps_reading_notes_highlights_current(self):
        item=self.link().json['attachment'];aid=item['id'];slug='published-paper'
        with app.app_context():slug=db.session.get(PaperAttachment,aid).paper.slug;old_asset=db.session.get(PaperAttachment,aid).asset_id
        root='/api/learning/papers/'+slug
        self.login(4)
        self.client.post(root+f'/attachments/{aid}/progress',json={'action':'complete','expectedVersion':1})
        for kind,payload in [('notes',dict(title='Private title',body='Private body',noteType='general')),('highlights',dict(highlightText='Private concept'))]:
            self.assertEqual(self.client.post(root+'/'+kind,json={**payload,'attachmentId':aid,'expectedVersion':1}).status_code,201)
        self.login(1)
        r=self.client.put(f'/api/papers/1/attachments/{aid}',json={'displayName':'Corrected','description':'Metadata','sortOrder':10,'accessLevel':'authenticated'})
        self.assertEqual(r.status_code,200,r.json);self.assertEqual(r.json['attachment']['version'],1)
        with app.app_context():self.assertEqual(db.session.get(PaperAttachment,aid).asset_id,old_asset)
        self.login(4)
        self.assertEqual(self.get(root).json['reading']['resources'][0]['status'],'completed')
        for kind in ['notes','highlights']:self.assertEqual(self.get(root+'/'+kind).json[kind][0]['source']['state'],'current')
        self.login(1);r=self.client.put(f'/api/papers/1/attachments/{aid}',json={'externalUrl':'https://example.test/new-content'})
        self.assertEqual(r.json['attachment']['version'],2)
        self.login(4);self.assertEqual(self.client.post(root+f'/attachments/{aid}/progress',json={'action':'complete','expectedVersion':1}).status_code,409)
        for kind in ['notes','highlights']:self.assertEqual(self.get(root+'/'+kind).json[kind][0]['source']['state'],'earlier')

    def test_learning_events_do_not_grant_assessment_or_other_feature_completion(self):
        self.login(1);resource=self.resource(self.module).json['resources'][0];item=self.link().json['attachment']
        with app.app_context():slug=db.session.get(PaperAttachment,item['id']).paper.slug
        self.login(4);root='/api/learning/papers/'+slug
        self.client.post('/api/learning/bookmarks',json={'targetType':'paper','targetId':1})
        for kind,payload in [('notes',dict(title='Own',body='Text',noteType='general')),('highlights',dict(highlightText='Own'))]:self.client.post(root+'/'+kind,json=payload)
        self.get('/api/papers/'+slug);self.get(root)
        with app.app_context():
            self.assertEqual(Enrollment.query.count(),0);self.assertEqual(PaperReadingProgress.query.count(),0);self.assertEqual(PaperAttachmentProgress.query.count(),0)
        self.enroll();self.client.post(root+'/progress',json={'action':'complete'})
        self.assertEqual(self.state()['completedModuleCount'],0)
        self.client.post(root+f"/attachments/{item['id']}/progress",json={'action':'complete','expectedVersion':1})
        self.resource_action(resource['id']);self.assertEqual(self.state()['completedModuleCount'],0)
        before=self.get(root).json;self.action();self.assertEqual(self.get(root).json,before)
        with app.app_context():
            self.assertEqual(Bookmark.query.count(),1);self.assertEqual(GuidedNote.query.count(),1);self.assertEqual(ConceptHighlight.query.count(),1)
            self.assertEqual(ModuleProgress.query.filter(ModuleProgress.verified_completed_at.isnot(None)).count(),0)
