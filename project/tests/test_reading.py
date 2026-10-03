"""Personal identity, publication redaction and real attachment-version history."""
import unittest
from unittest.mock import patch
from flask.testing import FlaskClient
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
import test_attachments as fixtures
import test_course_management as courses
from app import (app, db, User, Paper, PaperAttachment, Course, CourseModule, ResearchArea,
                 Bookmark, PaperReadingProgress, PaperAttachmentProgress)


class ReadingTests(unittest.TestCase):
    setUp = courses.CourseManagementTests.setUp
    tearDown = courses.CourseManagementTests.tearDown
    tearDownClass = courses.CourseManagementTests.tearDownClass
    login = fixtures.AttachmentTests.login
    upload = fixtures.AttachmentTests.upload
    create = fixtures.AttachmentTests.create
    link = fixtures.AttachmentTests.link
    get = courses.CourseManagementTests.get

    def save(self, kind='paper', target=1, **extra):
        return self.client.post('/api/learning/bookmarks',json={'targetType':kind,'targetId':target,**extra})

    def bookmarks(self):
        return self.get('/api/learning/bookmarks').json['bookmarks']

    def state(self, slug='paper-1'):
        return self.get('/api/learning/papers/'+slug)

    def action(self, action='start', slug='paper-1', **extra):
        return self.client.post('/api/learning/papers/'+slug+'/progress',json={'action':action,**extra})

    def attachment(self, item, action='complete', version=1, slug='paper-1', **extra):
        return self.client.post(f'/api/learning/papers/{slug}/attachments/{item}/progress',json={'action':action,'expectedVersion':version,**extra})

    def test_auth_csrf_revocation_private_headers_and_strict_input(self):
        self.login(None)
        for url in ['/api/learning/bookmarks','/api/learning/papers','/api/learning/papers/paper-1']:
            r=self.get(url);self.assertEqual(r.status_code,401);self.assertEqual(r.headers['Cache-Control'],'private, no-store')
        self.assertEqual(self.save().status_code,401);self.assertEqual(self.action().status_code,401)
        self.login(4)
        plain=FlaskClient(app)
        with plain.session_transaction() as session:session['_user_id']='4:1';session['auth_version']=1
        self.assertEqual(plain.post('/api/learning/bookmarks',json={'targetType':'paper','targetId':1}).status_code,403)
        for payload in [{'targetType':'paper','targetId':True},{'targetType':['paper'],'targetId':1},{'targetType':'user','targetId':1},{'targetType':'paper','targetId':0},{'targetType':'paper','targetId':2**64},{'targetType':'paper','targetId':1,'userId':1}]:
            self.assertEqual(self.client.post('/api/learning/bookmarks',json=payload).status_code,400)
        for url in ['/api/learning/bookmarks','/api/learning/papers','/api/learning/papers/paper-1']:
            self.assertEqual(self.get(url+'?userId=1').status_code,400)
        self.assertEqual(self.action(userId=1).status_code,400)
        self.assertEqual(self.action(action=[]).status_code,400)
        with app.app_context():db.session.get(User,4).auth_version=2;db.session.commit()
        self.assertEqual(self.save().status_code,401)

    def test_all_four_targets_idempotent_and_independent(self):
        self.login(4)
        for kind in ['paper','course','module','research_area']:
            one=self.save(kind);two=self.save(kind)
            self.assertEqual(one.status_code,200,one.json);self.assertEqual(one.json,two.json)
            self.assertEqual(one.json['bookmark']['target']['id'],1)
        rows=self.bookmarks();self.assertEqual(len(rows),4)
        for row in rows:self.assertTrue(row['available']);self.assertIn('title',row['target'])
        with app.app_context():self.assertEqual(PaperReadingProgress.query.count(),0);self.assertEqual(PaperAttachmentProgress.query.count(),0)
        self.action();self.assertEqual(len(self.bookmarks()),4)

    def test_bookmark_own_removal_preserves_target(self):
        self.login(4);row=self.save().json['bookmark']
        self.login(1)
        self.assertEqual(self.client.delete('/api/learning/bookmarks/'+str(row['id']),json={}).status_code,404)
        self.login(4)
        self.assertEqual(self.client.delete('/api/learning/bookmarks/'+str(row['id']),json={}).status_code,200)
        self.assertEqual(self.bookmarks(),[])
        with app.app_context():self.assertIsNotNone(db.session.get(Paper,1))

    def test_unpublished_targets_redaction_and_removal_for_every_role(self):
        self.login(4)
        for kind in ['paper','course','module','research_area']:self.save(kind)
        with app.app_context():
            for Model in [Paper,Course,CourseModule,ResearchArea]:db.session.get(Model,1).status='draft'
            db.session.commit()
        rows=self.bookmarks();self.assertEqual(len(rows),4)
        for row in rows:
            self.assertFalse(row['available']);self.assertIsNone(row['target'])
            self.assertEqual(self.client.delete('/api/learning/bookmarks/'+str(row['id']),json={}).status_code,200)
        for uid in [1,2,3,4]:
            self.login(uid)
            for kind in ['paper','course','module','research_area']:
                r=self.save(kind);self.assertEqual(r.status_code,404);self.assertEqual(r.json['code'],'BOOKMARK_TARGET_UNAVAILABLE')
        with app.app_context():self.assertEqual(Bookmark.query.count(),0)

    def test_module_parent_publication_and_archived_paper(self):
        self.login(3)
        self.assertEqual(self.save('paper',3).status_code,404);self.assertEqual(self.save('paper',4).status_code,404)
        with app.app_context():db.session.get(Course,1).status='archived';db.session.commit()
        self.assertEqual(self.save('module',1).status_code,404)

    def test_personal_isolation_including_admin_and_staff(self):
        self.login(4);self.save();self.action('complete')
        for uid in [1,2,3]:
            self.login(uid);self.assertEqual(self.bookmarks(),[]);self.assertEqual(self.get('/api/learning/papers').json['papers'],[])
            self.assertEqual(self.state().json['reading']['status'],'not_started')
            self.action('start');self.assertEqual(self.state().json['reading']['status'],'in_progress')
        self.login(4);self.assertEqual(self.state().json['reading']['status'],'completed')

    def test_no_get_download_or_bookmark_activity(self):
        pdf=self.create();self.login(4);self.save()
        self.get('/api/papers/paper-1');self.get('/api/papers/paper-1/attachments');self.get('/api/papers/paper-1/attachments/'+str(pdf['id'])+'/download')
        state=self.state().json['reading'];self.assertEqual(state['status'],'not_started');self.assertEqual(state['resources'][0]['status'],'not_started')
        self.get('/api/learning/papers')
        with app.app_context():self.assertEqual(PaperReadingProgress.query.count(),0);self.assertEqual(PaperAttachmentProgress.query.count(),0)

    def test_explicit_start_complete_repeat_undo_preserves_start(self):
        self.login(4)
        start=self.action().json['reading'];again=self.action().json['reading'];self.assertEqual(start['startedAt'],again['startedAt'])
        completed=self.action('complete').json['reading'];repeat=self.action('complete').json['reading'];self.assertEqual(completed['selfCompletedAt'],repeat['selfCompletedAt'])
        undone=self.action('incomplete').json['reading'];self.assertEqual(undone['startedAt'],start['startedAt']);self.assertIsNone(undone['selfCompletedAt']);self.assertEqual(undone['status'],'in_progress')
        self.assertEqual(self.bookmarks(),[])
        with app.app_context():self.assertEqual(PaperReadingProgress.query.count(),1)

    def test_login_restore_and_publication_redaction(self):
        self.login(4);self.action('complete');self.login(None);self.assertEqual(self.state().status_code,401)
        self.login(4);self.assertEqual(self.state().json['reading']['status'],'completed')
        with app.app_context():db.session.get(Paper,1).status='archived';db.session.commit()
        history=self.get('/api/learning/papers').json['papers'];self.assertEqual(len(history),1);self.assertFalse(history[0]['available']);self.assertIsNone(history[0]['paper'])
        for uid in [1,3,4]:
            self.login(uid)
            for slug in ['paper-1','paper-3','paper-4','missing']:
                self.assertEqual(self.state(slug).status_code,404);self.assertEqual(self.action(slug=slug).status_code,404)
        with app.app_context():self.assertEqual(PaperReadingProgress.query.count(),1)

    def test_public_authenticated_staff_policy_and_safe_error(self):
        ids=[]
        for kind,access in [('pdf','public'),('slides','authenticated'),('document','staff')]:ids.append(self.create(kind=kind,accessLevel=access)['id'])
        self.login(4)
        for id in ids[:2]:self.assertEqual(self.attachment(id).status_code,200)
        hidden=self.attachment(ids[2]);missing=self.attachment(99999);self.assertEqual(hidden.status_code,404);self.assertEqual(hidden.json,missing.json)
        self.assertEqual(len(self.state().json['reading']['resources']),2)
        # Published-paper staff policy already admits teachers/admins, including non-owner teachers.
        for uid in [1,2,3]:self.login(uid);self.assertEqual(self.attachment(ids[2]).status_code,200)
        self.login(4);self.assertEqual(self.state().json['reading']['status'],'not_started')

    def test_external_link_and_cover_scope(self):
        cover=self.create(kind='cover')['id'];self.login(1);link=self.link().json['attachment']['id'];self.login(4)
        self.assertEqual(self.attachment(link).status_code,200);self.assertEqual(self.attachment(cover).status_code,404)
        self.assertEqual([r['attachmentId'] for r in self.state().json['reading']['resources']],[link])

    def test_real_pdf_replace_current_version_and_original_completion(self):
        id=self.create()['id'];self.login(4)
        done=self.attachment(id).json['reading']['resources'][0]
        self.assertEqual(self.attachment(id).json['reading']['resources'][0]['selfCompletedAt'],done['selfCompletedAt'])
        self.login(1);replacement=self.upload(method='put',attachment_id=id,data=fixtures.pdf('version-two'))
        self.assertEqual(replacement.status_code,200,replacement.json);self.assertEqual(replacement.json['attachment']['version'],2)
        self.login(4);now=self.state().json['reading']['resources'][0]
        self.assertEqual(now['status'],'not_started');self.assertEqual(now['history'][0]['selfCompletedAt'],done['selfCompletedAt'])
        self.assertEqual(self.attachment(id,version=1).status_code,409)
        self.assertEqual(self.attachment(id,version=2).status_code,200)
        self.assertEqual(self.state().json['reading']['status'],'not_started')
        with app.app_context():self.assertEqual(PaperAttachmentProgress.query.count(),2);self.assertEqual(PaperReadingProgress.query.count(),0)

    def test_attachment_delete_retains_history_and_does_not_block_cleanup(self):
        id=self.create()['id'];self.login(4);self.attachment(id)
        self.login(1);r=self.client.delete(f'/api/papers/1/attachments/{id}');self.assertEqual(r.status_code,200,r.json)
        self.login(4);state=self.state().json['reading'];self.assertEqual(state['resources'],[]);self.assertEqual(len(state['unavailableHistory']),1)
        self.assertNotIn('displayName',state['unavailableHistory'][0]);self.assertNotIn('downloadUrl',state['unavailableHistory'][0]);self.assertEqual(self.attachment(id).json,self.attachment(9999).json)
        with app.app_context():row=PaperAttachmentProgress.query.one();self.assertIsNone(row.attachment_id);self.assertEqual(row.relation_id_at_recording,id);self.assertIsNotNone(row.self_completed_at)

    def test_changed_access_hides_history_and_cross_paper_ids(self):
        id=self.create()['id'];self.login(4);self.attachment(id)
        with app.app_context():db.session.get(PaperAttachment,id).access_level='staff';db.session.commit()
        self.assertEqual(self.state().json['reading']['resources'],[]);self.assertEqual(self.state().json['reading']['unavailableHistory'],[])
        self.assertEqual(self.attachment(id).json,self.attachment(id,slug='paper-2').json)

    def test_db_unique_fk_exactly_one_and_version_constraints(self):
        with app.app_context():
            for values in [{},{'paper_id':1,'course_id':1},{'paper_id':9999}]:
                db.session.add(Bookmark(user_id=4,**values))
                with self.assertRaises(IntegrityError):db.session.commit()
                db.session.rollback()
            db.session.add(Bookmark(user_id=4,paper_id=1));db.session.commit()
            db.session.add(Bookmark(user_id=4,paper_id=1))
            with self.assertRaises(IntegrityError):db.session.commit()
            db.session.rollback()
            db.session.add(PaperAttachmentProgress(user_id=4,paper_id=1,relation_id_at_recording=1,attachment_version=0))
            with self.assertRaises(IntegrityError):db.session.commit()
            db.session.rollback()

    def test_reading_error_contract_does_not_expose_database_details(self):
        self.login(4)
        with patch('reading_api.select',side_effect=SQLAlchemyError('sensitive fixture error')):
            r=self.state();self.assertEqual(r.status_code,503);self.assertEqual(r.json['code'],'READING_PROGRESS_UNAVAILABLE');self.assertNotIn('sensitive',str(r.json))

    def test_deleting_paper_preserves_reading_and_attachment_history(self):
        id=self.create()['id'];self.login(4);self.save();self.action('complete');self.attachment(id)
        self.login(3);r=self.client.delete('/api/papers/1');self.assertEqual(r.status_code,200,r.json)
        self.login(4);self.assertEqual(self.bookmarks(),[])
        self.assertIsNone(self.get('/api/learning/papers').json['papers'][0]['paper'])
        with app.app_context():self.assertIsNone(PaperReadingProgress.query.one().paper_id);self.assertIsNone(PaperAttachmentProgress.query.one().attachment_id)

    def test_resource_strict_versions_and_paper_independence(self):
        id=self.create()['id'];self.login(4)
        for version in [True,0,-1,'1',2**64]:self.assertEqual(self.attachment(id,version=version).status_code,400)
        self.assertEqual(self.attachment(id,userId=1).status_code,400)
        self.action('complete');self.assertEqual(self.state().json['reading']['resources'][0]['status'],'not_started')
        self.attachment(id);self.attachment(id,action='incomplete');self.assertEqual(self.state().json['reading']['status'],'completed')
