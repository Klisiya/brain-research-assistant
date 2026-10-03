"""Private learning state, explicit completion and resource-version boundaries."""
from io import BytesIO
import unittest
from unittest.mock import patch
from flask.testing import FlaskClient
from sqlalchemy.exc import SQLAlchemyError
import test_attachments as fixtures
import test_course_management as course_fixtures
from csrf_client import csrf_client
from app import (app, db, User, Course, CourseModule, CourseResource, ModuleResource,
                 Enrollment, ModuleProgress, CourseResourceProgress, ModuleResourceProgress, FileAsset)
from course_content import canonical_content


class LearningTests(unittest.TestCase):
    setUp = course_fixtures.CourseManagementTests.setUp
    tearDown = course_fixtures.CourseManagementTests.tearDown
    tearDownClass = course_fixtures.CourseManagementTests.tearDownClass
    login = fixtures.AttachmentTests.login
    get = course_fixtures.CourseManagementTests.get
    resource = course_fixtures.CourseManagementTests.resource

    def enroll(self):
        return self.client.post('/api/learning/courses/'+self.slug+'/enroll', json={})

    def state(self):
        return self.get('/api/learning/courses/'+self.slug).json['enrollment']

    def action(self, action='complete', slug=None, **extra):
        return self.client.post(f'/api/learning/courses/{self.slug}/modules/{slug or self.module_slug}/progress', json={'action':action, **extra})

    def resource_action(self, resource, kind='module', version=1, action='complete'):
        suffix = f'/modules/{self.module_slug}' if kind == 'module' else ''
        return self.client.post(f'/api/learning/courses/{self.slug}{suffix}/resources/{resource}/progress', json={'action':action, 'expectedVersion':version})

    def test_enrollment_roles_idempotence_and_no_implicit_staff_enrollment(self):
        self.assertEqual(self.get('/api/learning/enrollments').json['enrollments'], [])
        for uid in [1, 2, 3, 4]:
            self.login(uid)
            self.assertIsNone(self.state())
            one = self.enroll(); two = self.enroll()
            self.assertEqual(one.status_code, 200, one.json)
            self.assertEqual(one.json['enrollment']['enrollmentId'], two.json['enrollment']['enrollmentId'])
            self.assertEqual(one.json['enrollment']['requiredModuleCount'], 12)
        with app.app_context():
            self.assertEqual(Enrollment.query.count(), 4)
            self.assertEqual(ModuleProgress.query.count(), 48)
            self.assertEqual(ModuleProgress.query.filter(ModuleProgress.started_at.isnot(None)).count(), 0)

    def test_anonymous_disabled_and_csrf(self):
        self.login(None)
        self.assertEqual(self.enroll().status_code, 401)
        self.assertEqual(self.get('/api/learning/enrollments').status_code, 401)
        self.login(4)
        plain = FlaskClient(app)
        with plain.session_transaction() as session:
            session['_user_id']='4:1'; session['auth_version']=1
        self.assertEqual(plain.post('/api/learning/courses/'+self.slug+'/enroll', json={}).status_code, 403)
        with app.app_context():
            db.session.get(User, 4).is_active=False; db.session.commit()
        self.assertEqual(self.enroll().status_code, 401)

    def test_private_identity_strict_input_and_cache(self):
        self.login(4); self.enroll(); self.action()
        for uid in [1, 2, 3]:
            self.login(uid)
            self.assertIsNone(self.state())
            self.assertEqual(self.get('/api/learning/enrollments').json['enrollments'], [])
            self.assertEqual(self.get('/api/learning/enrollments?userId=4').status_code, 400)
            self.assertEqual(self.client.post('/api/learning/courses/'+self.slug+'/enroll', json={'userId':4}).status_code, 400)
            self.enroll()
            self.assertEqual(self.action(userId=4).status_code, 400)
            self.assertEqual(self.state()['completedModuleCount'], 0)
        response=self.get('/api/learning/enrollments')
        self.assertEqual(response.headers['Cache-Control'], 'private, no-store')

    def test_no_get_side_effect_or_implicit_enrollment(self):
        self.login(4)
        self.get(self.public); self.get(self.public+'/resources'); self.get('/api/learning/enrollments'); self.state()
        with app.app_context(): self.assertEqual(Enrollment.query.count(), 0)
        self.assertEqual(self.action().json['code'], 'ENROLLMENT_REQUIRED')
        self.enroll(); old=self.state()
        self.get(self.public); self.state(); self.get('/api/learning/enrollments')
        self.assertEqual(self.state(), old)

    def test_start_complete_undo_idempotence_never_verifies(self):
        self.enroll(); self.action('start')
        state=self.state(); row=state['modules'][0]
        self.assertEqual(row['status'], 'in_progress'); self.assertIsNone(row['selfCompletedAt'])
        self.assertEqual(state['studyProgressPercent'], 0)
        self.action(); stamp=self.state()['modules'][0]['selfCompletedAt']
        self.action(); self.assertEqual(self.state()['modules'][0]['selfCompletedAt'], stamp)
        self.action('incomplete'); row2=self.state()['modules'][0]
        self.assertEqual(row2['startedAt'], row['startedAt']); self.assertIsNone(row2['selfCompletedAt'])
        self.assertEqual(self.action(verified_completed_at='now').status_code, 400)
        self.assertEqual(self.action('passed').status_code, 400)
        with app.app_context(): self.assertEqual(ModuleProgress.query.filter(ModuleProgress.verified_completed_at.isnot(None)).count(), 0)

    def test_canonical_twelve_completion_derived(self):
        self.enroll(); self.assertEqual(self.state()['studyProgressPercent'], 0)
        for index, module in enumerate(canonical_content()['modules'], 1):
            self.assertEqual(self.action(slug=module['slug']).status_code, 200)
            state=self.state()
            self.assertEqual(state['studyProgressPercent'], round(index*100/12, 2))
            self.assertFalse(state['verifiedPassed']); self.assertEqual(state['verificationStatus'], 'not_available')
            self.assertEqual(state['selfCompleted'], index==12)
        self.assertEqual(state['continuePath'], '/course/'+self.slug)
        self.assertEqual(state['studyProgressPercent'], 100)

    def test_continue_learning_from_persisted_incomplete_activity(self):
        self.enroll(); modules=canonical_content()['modules']
        self.assertTrue(self.state()['continuePath'].endswith(modules[0]['slug']))
        self.action('start', modules[4]['slug']); self.action('start', modules[2]['slug'])
        self.assertTrue(self.state()['continuePath'].endswith(modules[2]['slug']))
        self.action('complete', modules[2]['slug'])
        self.assertTrue(self.state()['continuePath'].endswith(modules[4]['slug']))

    def test_publication_preserves_rule_and_private_history(self):
        self.enroll(); self.action()
        with app.app_context():
            m=db.session.get(CourseModule, 1); m.status='draft'; m.title='Private module title'; db.session.commit()
        self.assertEqual(self.action().status_code, 404)
        state=self.state(); self.assertEqual(state['requiredModuleCount'], 12)
        self.assertEqual(state['completedModuleCount'], 1); self.assertIsNone(state['modules'][0]['title'])
        self.assertNotIn('Private module title', str(state))
        with app.app_context():
            c=db.session.get(Course, 1); c.status='archived'; c.title='Private course title'; db.session.commit()
        self.assertEqual(self.enroll().status_code, 404)
        self.assertEqual(self.get('/api/learning/courses/'+self.slug).status_code, 404)
        listed=self.get('/api/learning/enrollments').json
        self.assertFalse(listed['enrollments'][0]['available']); self.assertNotIn('Private course title', str(listed))
        with app.app_context():
            self.assertEqual(Enrollment.query.count(), 1); self.assertEqual(ModuleProgress.query.count(), 12)

    def test_frozen_rule_not_changed_by_later_module_addition(self):
        self.enroll()
        with app.app_context():
            db.session.add(CourseModule(course_id=1,slug='later-module',number=13,title='Later',title_zh='Later',duration_hours=3,category='Later',description='Later',learning_focus='Later',cover_variant='foundation',status='published'));db.session.commit()
        self.assertEqual(self.state()['requiredModuleCount'], 12)
        self.assertEqual(self.action(slug='later-module').status_code, 404)
        self.assertEqual(self.action(slug='missing').status_code, 404)
        self.assertEqual(self.client.post('/api/learning/courses/other-course/modules/'+self.module_slug+'/progress',json={'action':'complete'}).json['code'], 'ENROLLMENT_REQUIRED')

    def test_resources_versions_history_and_access_side_channel(self):
        for kind, target in [('course', self.base), ('module', self.module)]:
            self.login(1)
            public=self.resource(target).json['resources'][-1]
            hidden=self.resource(target,access='staff').json['resources'][-1]
            self.login(4); self.enroll()
            a=self.resource_action(hidden['id'],kind); b=self.resource_action(98765,kind)
            self.assertEqual(a.status_code,404);self.assertEqual(a.json,b.json)
            self.assertEqual(self.resource_action(public['id'],kind,action='start').status_code,200)
            self.assertEqual(self.resource_action(public['id'],kind).status_code,200)
            stamp=next(r for r in self.state()['resources'] if r['kind']==kind and r['resourceId']==public['id'])['selfCompletedAt']
            self.resource_action(public['id'],kind)
            self.assertEqual(next(r for r in self.state()['resources'] if r['kind']==kind and r['resourceId']==public['id'])['selfCompletedAt'],stamp)
            self.login(1)
            self.assertEqual(self.client.patch(target+f"/resources/{public['id']}",json={'displayName':'Version two','expectedVersion':1}).status_code,200)
            self.login(4)
            item=next(r for r in self.state()['resources'] if r['kind']==kind and r['resourceId']==public['id'])
            self.assertEqual(item['version'],2);self.assertEqual(item['status'],'not_started');self.assertEqual(item['history'][0]['selfCompletedAt'],stamp)
            self.assertEqual(self.resource_action(public['id'],kind).status_code,409)
            self.assertEqual(self.resource_action(public['id'],kind,version=2).status_code,200)
            self.resource_action(public['id'],kind,version=2,action='incomplete')
            self.assertEqual(self.state()['completedModuleCount'],0)

    def test_deleted_resource_history_survives_file_cleanup_and_reused_ids(self):
        for kind, target, Progress in [('course',self.base,CourseResourceProgress),('module',self.module,ModuleResourceProgress)]:
            self.login(1); item=self.resource(target).json['resources'][-1]
            self.login(4); self.enroll(); self.resource_action(item['id'],kind)
            self.login(1)
            self.assertEqual(self.client.delete(target+f"/resources/{item['id']}",json={'expectedVersion':1}).status_code,200)
            with app.app_context():
                old=Progress.query.one();self.assertIsNone(old.resource_id);self.assertEqual(old.relation_id_at_recording,item['id']);self.assertIsNotNone(old.self_completed_at)
                self.assertEqual(FileAsset.query.count(),0)
            new=self.resource(target).json['resources'][-1]
            self.login(4)
            state=next(r for r in self.state()['resources'] if r['kind']==kind and r['resourceId']==new['id'])
            self.assertEqual(state['status'],'not_started');self.assertEqual(state['history'],[])
            self.resource_action(new['id'],kind)
            with app.app_context():self.assertEqual(Progress.query.count(),2)
            self.login(1);self.client.delete(target+f"/resources/{new['id']}",json={'expectedVersion':1})

    def test_shared_asset_relations_do_not_share_progress_and_cross_course_denied(self):
        self.login(1); item=self.resource().json['resources'][0]
        with app.app_context():
            asset=db.session.get(CourseResource,item['id']).asset_id
            db.session.add(ModuleResource(id=25,module_id=1,asset_id=asset,display_name='Same physical file',access_level='public'))
            db.session.add(ModuleResource(id=26,module_id=13,asset_id=asset,display_name='Other course',access_level='public'));db.session.commit()
        self.login(4);self.enroll();self.resource_action(item['id'],'course')
        self.assertEqual(next(r for r in self.state()['resources'] if r['kind']=='module')['status'],'not_started')
        self.assertEqual(self.resource_action(26).status_code,404)

    def test_new_login_session_restores_and_other_account_does_not(self):
        self.login(4);self.enroll();self.action()
        original=self.state()
        second=csrf_client(app)
        response=second.post('/api/auth/login',json={'email':'fixture-4@example.test','password':'test-only-password','remember':False})
        self.assertEqual(response.status_code,200)
        self.assertEqual(second.get('/api/learning/courses/'+self.slug).json['enrollment'],original)
        second.post('/api/auth/logout',json={})
        self.assertEqual(second.get('/api/learning/enrollments').status_code,401)
        self.login(2);self.assertIsNone(self.state())

    def test_database_failure_rolls_back_and_does_not_disclose_errors(self):
        with patch.object(db.session,'commit',side_effect=SQLAlchemyError('private connection details')):
            response=self.enroll();self.assertEqual(response.status_code,503);self.assertNotIn('private connection',str(response.json))
        with app.app_context():self.assertEqual(Enrollment.query.count(),0)
        self.enroll()
        with patch.object(db.session,'commit',side_effect=SQLAlchemyError('private')):
            self.assertEqual(self.action().status_code,503)
        self.assertEqual(self.state()['completedModuleCount'],0)


if __name__ == '__main__': unittest.main()
