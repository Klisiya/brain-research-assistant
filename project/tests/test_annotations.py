"""Private text CRUD, source history, access and optimistic revision contracts."""
import unittest
from unittest.mock import patch
from flask.testing import FlaskClient
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
import test_attachments as fixtures
import test_course_management as courses
from app import (app,db,User,Paper,PaperAttachment,GuidedNote,ConceptHighlight,
                 Bookmark,PaperReadingProgress,PaperAttachmentProgress,Enrollment)


class AnnotationTests(unittest.TestCase):
    setUp=courses.CourseManagementTests.setUp
    tearDown=courses.CourseManagementTests.tearDown
    tearDownClass=courses.CourseManagementTests.tearDownClass
    login=fixtures.AttachmentTests.login
    upload=fixtures.AttachmentTests.upload
    create=fixtures.AttachmentTests.create
    link=fixtures.AttachmentTests.link
    get=courses.CourseManagementTests.get

    def payload(self,kind='notes',**changes):
        return dict({'title':'My note','body':'My own text','noteType':'summary'} if kind=='notes' else {'highlightText':'My concept','comment':'My comment'},**changes)

    def add(self,kind='notes',slug='paper-1',**changes):
        return self.client.post(f'/api/learning/papers/{slug}/{kind}',json=self.payload(kind,**changes))

    def items(self,kind='notes',slug='paper-1'):
        return self.get(f'/api/learning/papers/{slug}/{kind}').json[kind]

    def edit(self,id,kind='notes',revision=1,**changes):
        return self.client.patch(f'/api/learning/{kind}/{id}',json=self.payload(kind,expectedRevision=revision,**changes))

    def remove(self,id,kind='notes',revision=1):
        return self.client.delete(f'/api/learning/{kind}/{id}',json={'expectedRevision':revision})

    def item(self,response,kind='notes'):
        self.assertIn(response.status_code,[200,201],response.json)
        return response.json['note' if kind=='notes' else 'highlight']

    def test_anonymous_csrf_and_private_cache(self):
        self.login(None)
        for kind in ['notes','highlights']:
            self.assertEqual(self.add(kind).status_code,401)
            for url in [f'/api/learning/{kind}',f'/api/learning/papers/paper-1/{kind}']:
                r=self.get(url);self.assertEqual(r.status_code,401);self.assertEqual(r.headers['Cache-Control'],'private, no-store')
                self.assertIn('Cookie',r.headers['Vary'])
        self.login(4)
        plain=FlaskClient(app)
        with plain.session_transaction() as session:session['_user_id']='4:1';session['auth_version']=1
        for kind in ['notes','highlights']:
            self.assertEqual(plain.post('/api/learning/papers/paper-1/'+kind,json=self.payload(kind)).status_code,403)
            self.assertEqual(plain.patch('/api/learning/'+kind+'/1',json=self.payload(kind,expectedRevision=1)).status_code,403)
            self.assertEqual(plain.delete('/api/learning/'+kind+'/1',json={'expectedRevision':1}).status_code,403)

    def test_paper_notes_all_types_trim_times_no_implicit_state(self):
        self.login(4)
        for t in ['general','summary','question','connection','key_idea']:
            row=self.item(self.add(title='  My title  ',body='  First line\nSecond line  ',noteType=t))
            self.assertEqual(row['title'],'My title');self.assertEqual(row['body'],'First line\nSecond line');self.assertEqual(row['source']['kind'],'paper');self.assertIsNone(row['source']['version']);self.assertEqual(row['revision'],1)
            self.assertTrue(row['createdAt'].endswith('Z'));self.assertEqual(row['createdAt'],row['updatedAt'])
        self.assertEqual(len(self.items()),5)
        with app.app_context():
            for Model in [Bookmark,PaperReadingProgress,PaperAttachmentProgress,Enrollment]:self.assertEqual(Model.query.count(),0)

    def test_highlight_paper_create_optional_comment_and_limits(self):
        self.login(4)
        r=self.client.post('/api/learning/papers/paper-1/highlights',json={'highlightText':'  Explicit concept  '})
        row=self.item(r,'highlights');self.assertEqual(row['highlightText'],'Explicit concept');self.assertIsNone(row['comment']);self.assertIsNone(row['source']['version'])
        self.assertEqual(self.add('highlights',highlightText='x'*1000,comment='x'*2000).status_code,201)
        self.assertEqual(self.add('highlights',highlightText='x'*1001).status_code,400)
        self.assertEqual(self.add('highlights',comment='x'*2001).status_code,400)
        with app.app_context():self.assertEqual(PaperReadingProgress.query.count(),0);self.assertEqual(Bookmark.query.count(),0)

    def test_invalid_note_content_and_types(self):
        self.login(4)
        for changes in [{'title':' '},{'body':'\n\t '},{'title':None},{'body':[]},{'noteType':'custom'},{'noteType':[]},{'title':'x'*201},{'body':'x'*10001}]:
            self.assertEqual(self.add(**changes).status_code,400,changes.keys())
        self.assertEqual(self.add(title='x'*200,body='x'*10000).status_code,201)

    def test_invalid_highlight_content(self):
        self.login(4)
        for changes in [{'highlightText':' '},{'highlightText':None},{'highlightText':[]},{'comment':[]},{'comment':123}]:self.assertEqual(self.add('highlights',**changes).status_code,400)

    def test_own_read_edit_delete_and_other_roles_isolated(self):
        self.login(4)
        saved={kind:self.item(self.add(kind),kind) for kind in ['notes','highlights']}
        for uid in [1,2,3]:
            self.login(uid)
            for kind,row in saved.items():
                self.assertEqual(self.items(kind),[]);self.assertEqual(self.get('/api/learning/'+kind).json[kind],[])
                self.assertEqual(self.edit(row['id'],kind).status_code,404);self.assertEqual(self.remove(row['id'],kind).status_code,404)
        self.login(4)
        for kind,row in saved.items():
            edited=self.item(self.edit(row['id'],kind),kind);self.assertEqual(edited['revision'],2);self.assertEqual(edited['createdAt'],row['createdAt']);self.assertNotEqual(edited['updatedAt'],row['updatedAt'])
            self.assertEqual(self.edit(row['id'],kind).status_code,409);self.assertEqual(self.remove(row['id'],kind).status_code,409)
            self.assertEqual(self.remove(row['id'],kind,2).status_code,200);self.assertEqual(self.remove(row['id'],kind,2).status_code,404)
            self.assertEqual(self.edit(row['id'],kind,2).status_code,404);self.assertEqual(self.items(kind),[])

    def test_repeat_edit_stable_conflict_and_no_source_rebinding(self):
        id=self.create()['id'];self.login(4)
        for kind in ['notes','highlights']:
            row=self.item(self.add(kind,attachmentId=id,expectedVersion=1),kind)
            self.assertEqual(self.edit(row['id'],kind,attachmentId=id,expectedVersion=1).status_code,400)
            edited=self.item(self.edit(row['id'],kind),kind);self.assertEqual(edited['source'],row['source'])
            self.assertEqual(self.edit(row['id'],kind).json['code'],'ANNOTATION_CONFLICT')

    def test_validation_injection_queries_revision_and_body(self):
        self.login(4)
        for kind in ['notes','highlights']:
            row=self.item(self.add(kind),kind)
            for field in ['userId','paperId','assetId','storageKey','createdAt','updatedAt','sourceType','sourceId']:
                self.assertEqual(self.add(kind,**{field:1}).status_code,400)
                self.assertEqual(self.edit(row['id'],kind,**{field:1}).status_code,400)
            for revision in [True,0,-1,'1',None,2**64]:self.assertEqual(self.edit(row['id'],kind,revision).status_code,400)
            for url in [f'/api/learning/{kind}',f'/api/learning/papers/paper-1/{kind}']:
                self.assertEqual(self.get(url+'?userId=4').status_code,400)
            for data in [None,[],{},self.payload(kind,userId=4)]:self.assertEqual(self.client.post('/api/learning/papers/paper-1/'+kind,json=data).status_code,400)

    def test_resource_context_public_authenticated_staff_cover_and_wrong_parent(self):
        ids=[self.create(kind=kind,accessLevel=access)['id'] for kind,access in [('pdf','public'),('slides','authenticated'),('document','staff'),('cover','public')]]
        self.login(4)
        for kind in ['notes','highlights']:
            for id in ids[:2]:self.assertEqual(self.add(kind,attachmentId=id,expectedVersion=1).status_code,201)
            hidden=self.add(kind,attachmentId=ids[2],expectedVersion=1)
            self.assertEqual(hidden.status_code,404);self.assertEqual(hidden.json,self.add(kind,attachmentId=99999,expectedVersion=1).json)
            self.assertEqual(hidden.json,self.add(kind,slug='paper-2',attachmentId=ids[0],expectedVersion=1).json)
            self.assertEqual(self.add(kind,attachmentId=ids[3],expectedVersion=1).status_code,404)
            resources=self.get('/api/learning/papers/paper-1/'+kind).json['resources'];self.assertEqual([r['id'] for r in resources],ids[:2])
            for id in ids[:2]:self.assertNotIn('storageKey',str(resources));self.assertNotIn('downloadUrl',str(resources))
        for uid in [1,2,3]:
            self.login(uid)
            for kind in ['notes','highlights']:self.assertEqual(self.add(kind,attachmentId=ids[2],expectedVersion=1).status_code,201)

    def test_external_link_source_and_paired_version_input(self):
        self.login(1);id=self.link().json['attachment']['id'];self.login(4)
        for kind in ['notes','highlights']:
            self.assertEqual(self.add(kind,attachmentId=id,expectedVersion=1).status_code,201)
            for changes in [{'attachmentId':id},{'expectedVersion':1},{'attachmentId':None,'expectedVersion':None},{'attachmentId':True,'expectedVersion':1},{'attachmentId':id,'expectedVersion':True}]:self.assertEqual(self.add(kind,**changes).status_code,400)

    def test_real_pdf_version_history_and_stale_create(self):
        id=self.create()['id'];self.login(4)
        original={kind:self.item(self.add(kind,attachmentId=id,expectedVersion=1),kind) for kind in ['notes','highlights']}
        self.login(1);r=self.upload(method='put',attachment_id=id,data=fixtures.pdf('annotation-v2'));self.assertEqual(r.status_code,200)
        self.login(4)
        for kind in ['notes','highlights']:
            old=self.items(kind)[0];self.assertEqual(old['source']['state'],'earlier');self.assertEqual(old['source']['version'],1);self.assertEqual(old['source']['currentVersion'],2)
            self.assertEqual(old['createdAt'],original[kind]['createdAt'])
            self.assertEqual(self.add(kind,attachmentId=id,expectedVersion=1).json['code'],'ANNOTATION_SOURCE_CONFLICT')
            current=self.item(self.add(kind,attachmentId=id,expectedVersion=2),kind);self.assertEqual(current['source']['state'],'current')
            edited=self.item(self.edit(old['id'],kind),kind);self.assertEqual(edited['source']['version'],1);self.assertEqual(edited['source']['state'],'earlier')

    def test_deleted_attachment_safe_retention_edit_delete_and_cleanup(self):
        id=self.create()['id'];self.login(4)
        rows={kind:self.item(self.add(kind,attachmentId=id,expectedVersion=1),kind) for kind in ['notes','highlights']}
        self.login(1);r=self.client.delete(f'/api/papers/1/attachments/{id}');self.assertEqual(r.status_code,200,r.json)
        self.login(4)
        for kind,row in rows.items():
            history=self.items(kind)[0];self.assertEqual(history['source']['state'],'unavailable');self.assertIsNone(history['source']['displayName']);self.assertIsNone(history['source']['attachmentId']);self.assertEqual(history['source']['version'],1)
            self.assertEqual(self.add(kind,attachmentId=id,expectedVersion=1).json,self.add(kind,attachmentId=9999,expectedVersion=1).json)
            self.assertEqual(self.edit(row['id'],kind).status_code,200);self.assertEqual(self.remove(row['id'],kind,2).status_code,200)

    def test_hidden_attachment_retains_own_text_without_current_metadata(self):
        id=self.create(displayName='Private current source')['id'];self.login(4)
        for kind in ['notes','highlights']:self.add(kind,attachmentId=id,expectedVersion=1)
        with app.app_context():db.session.get(PaperAttachment,id).access_level='staff';db.session.commit()
        for kind in ['notes','highlights']:
            data=self.get('/api/learning/papers/paper-1/'+kind).json
            self.assertEqual(data['resources'],[]);self.assertEqual(data[kind][0]['source']['state'],'unavailable');self.assertNotIn('Private current source',str(data))
            self.assertEqual(self.add(kind,attachmentId=id,expectedVersion=1).status_code,404)

    def test_unpublished_paper_blocks_create_redacts_personal_history(self):
        self.login(4)
        for kind in ['notes','highlights']:self.add(kind)
        with app.app_context():db.session.get(Paper,1).status='archived';db.session.commit()
        for uid in [1,3,4]:
            self.login(uid)
            for kind in ['notes','highlights']:
                for slug in ['paper-1','paper-3','paper-4','missing']:
                    self.assertEqual(self.add(kind,slug).status_code,404);self.assertEqual(self.get('/api/learning/papers/'+slug+'/'+kind).status_code,404)
        self.login(4)
        for kind in ['notes','highlights']:
            row=self.get('/api/learning/'+kind).json[kind][0];self.assertIsNone(row['paper']);self.assertEqual(row['source']['state'],'unavailable');self.assertNotIn('Fixture Paper',str(row));self.assertEqual(self.edit(row['id'],kind).status_code,200)

    def test_physical_paper_delete_retains_own_history_no_fk_blocker(self):
        id=self.create()['id'];self.login(4)
        for kind in ['notes','highlights']:self.add(kind);self.add(kind,attachmentId=id,expectedVersion=1)
        self.login(3);r=self.client.delete('/api/papers/1');self.assertEqual(r.status_code,200,r.json)
        self.login(4)
        for kind,Model in [('notes',GuidedNote),('highlights',ConceptHighlight)]:
            rows=self.get('/api/learning/'+kind).json[kind];self.assertEqual(len(rows),2)
            for row in rows:self.assertIsNone(row['paper']);self.assertEqual(row['source']['state'],'unavailable')
            with app.app_context():
                for row in Model.query.all():self.assertIsNone(row.paper_id);self.assertIsNone(row.attachment_id)

    def test_login_restore_disabled_and_revoked_sessions(self):
        self.login(4);self.add();self.add('highlights');self.login(None);self.assertEqual(self.get('/api/learning/notes').status_code,401)
        self.login(4);self.assertEqual(len(self.items()),1);self.assertEqual(len(self.items('highlights')),1)
        with app.app_context():db.session.get(User,4).is_active=False;db.session.commit()
        self.assertEqual(self.add().status_code,401)
        with app.app_context():db.session.get(User,4).is_active=True;db.session.get(User,4).auth_version=2;db.session.commit()
        self.assertEqual(self.add('highlights').status_code,401)

    def test_plain_data_xss_and_global_search_exclusion(self):
        self.login(4);text='<script>window.annotationInjected=true</script> <img src=x onerror=alert(1)> PrivateNeedle984'
        note=self.item(self.add(body=text));highlight=self.item(self.add('highlights',highlightText=text,comment=text),'highlights')
        self.assertEqual(note['body'],text);self.assertEqual(highlight['highlightText'],text);self.assertEqual(highlight['comment'],text)
        for uid in [4,1,3,None]:
            self.login(uid);response=self.get('/api/search?q=PrivateNeedle984');self.assertEqual(response.status_code,200);self.assertEqual(response.json['total'],0)

    def test_source_db_checks_fk_and_non_reused_record_identity(self):
        with app.app_context():
            for Model,fields in [(GuidedNote,dict(title='Title',body='Body',note_type='general')),(ConceptHighlight,dict(highlight_text='Concept'))]:
                for extra in [{'attachment_relation_id_at_recording':1},{'resource_version':1},{'attachment_id':999,'attachment_relation_id_at_recording':999,'resource_version':1},{'resource_version':0,'attachment_relation_id_at_recording':1},{'user_id':999}]:
                    row=Model(**dict(user_id=4,paper_id=1,**fields,**extra)) if 'user_id' not in extra else Model(user_id=999,paper_id=1,**fields)
                    db.session.add(row)
                    with self.assertRaises(IntegrityError):db.session.commit()
                    db.session.rollback()
        self.login(4)
        for kind in ['notes','highlights']:
            old=self.item(self.add(kind),kind);self.remove(old['id'],kind);new=self.item(self.add(kind),kind);self.assertGreater(new['id'],old['id']);self.assertEqual(self.edit(old['id'],kind).status_code,404)

    def test_request_size_and_safe_database_errors(self):
        self.login(4)
        r=self.add(body='x'*70000);self.assertEqual(r.status_code,413);self.assertEqual(r.json['code'],'ANNOTATION_VALIDATION_ERROR')
        with patch('annotation_api.select',side_effect=SQLAlchemyError('private database details')):
            r=self.get('/api/learning/papers/paper-1/notes');self.assertEqual(r.status_code,503);self.assertEqual(r.json['code'],'ANNOTATION_UNAVAILABLE');self.assertNotIn('private database details',str(r.json))

    def test_reading_and_bookmark_actions_never_create_annotations(self):
        id=self.create()['id'];self.login(4)
        self.client.post('/api/learning/bookmarks',json={'targetType':'paper','targetId':1})
        self.client.post('/api/learning/papers/paper-1/progress',json={'action':'complete'})
        self.client.post(f'/api/learning/papers/paper-1/attachments/{id}/progress',json={'action':'complete','expectedVersion':1})
        self.assertEqual(self.items(),[]);self.assertEqual(self.items('highlights'),[])
        self.add();self.add('highlights')
        self.assertEqual(self.get('/api/learning/papers/paper-1').json['reading']['status'],'completed')
        with app.app_context():self.assertEqual(Bookmark.query.count(),1);self.assertEqual(PaperReadingProgress.query.count(),1);self.assertEqual(PaperAttachmentProgress.query.count(),1)
