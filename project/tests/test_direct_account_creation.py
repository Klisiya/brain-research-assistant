"""TEST ONLY: direct Admin account creation using isolated DBs and existing Auth."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO, StringIO
import json
import logging
from pathlib import Path
import tempfile
from threading import Barrier
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
import test_account_lifecycle as fixtures
from account_lifecycle import AccountLifecycleService
from account_service import AccountError
from app import app, db, User, Invitation, PasswordResetToken, AccountAuditLog, account_lifecycle
from csrf_client import csrf_client

PASSWORD = 'TEST-ONLY-direct-temporary-password-42'
BASE = '/api/admin/users'


class DirectAccountTests(unittest.TestCase):
    setUp = fixtures.LifecycleTests.setUp
    tearDown = fixtures.LifecycleTests.tearDown
    login = fixtures.LifecycleTests.login

    def create(self, client=None, **changes):
        return (client or self.admin).post(BASE, json={
            'username':'TEST ONLY Direct', 'email':'direct@example.test', 'role':'student',
            'temporaryPassword':PASSWORD, **changes})

    def test_admin_creates_all_roles_and_created_users_login(self):
        for role in ['student', 'teacher', 'admin']:
            with self.subTest(role=role):
                response = self.create(username='TEST ONLY '+role, email=role+'@example.test', role=role, confirmAdmin=role=='admin')
                self.assertEqual(response.status_code, 201, response.json)
                user = response.json['user']
                self.assertEqual(user['role'], role)
                self.assertTrue(user['isActive'])
                login = self.client.post('/api/auth/login', json={'email':role+'@example.test','password':PASSWORD})
                self.assertEqual(login.status_code, 200, login.json)
                self.assertEqual(login.json['user']['id'], user['id'])
        self.assertEqual(self.messages, [])

    def test_admin_role_requires_explicit_boolean_confirmation(self):
        for confirmation in [None, False, 'true', 1]:
            response = self.create(role='admin', **({} if confirmation is None else {'confirmAdmin':confirmation}))
            self.assertEqual((response.status_code,response.json['code']), (400,'ADMIN_CONFIRMATION_REQUIRED'))
        with app.app_context():
            self.assertEqual(User.query.count(), 3)
            self.assertEqual(AccountAuditLog.query.count(), 0)

    def test_password_hash_audit_and_all_responses_never_contain_secrets(self):
        stream = StringIO(); handler = logging.StreamHandler(stream); app.logger.addHandler(handler)
        try:
            result = self.create()
        finally:
            app.logger.removeHandler(handler)
        self.assertEqual(result.status_code, 201)
        uid = result.json['user']['id']
        with app.app_context():
            user = db.session.get(User, uid)
            self.assertNotEqual(user.password_hash, PASSWORD)
            self.assertTrue(user.check_password(PASSWORD))
            hashed = user.password_hash
            audit = AccountAuditLog.query.filter_by(action='account_created').one()
            self.assertEqual((audit.actor_user_id,audit.target_user_id), (1,uid))
            self.assertEqual(audit.details, {'username':'TEST ONLY Direct','assignedRole':'student'})
            self.assertIsNotNone(audit.created_at)
            self.assertNotIn(PASSWORD, json.dumps(audit.details))
            self.assertNotIn(hashed, json.dumps(audit.details))
        audit_response = self.admin.get('/api/admin/audit-logs?action=account_created')
        self.assertEqual(audit_response.json['logs'][0]['details'], {'username':'TEST ONLY Direct','assignedRole':'student'})
        for response in [result, self.admin.get(BASE), self.admin.get(f'{BASE}/{uid}'), audit_response]:
            text = response.get_data(as_text=True)
            self.assertNotIn(PASSWORD, text); self.assertNotIn(hashed, text)
            self.assertNotIn('password', text.lower())
            self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
        self.assertNotIn(PASSWORD, stream.getvalue())
        self.assertNotIn(hashed, stream.getvalue())

    def test_duplicate_username_is_rejected_including_case_and_unicode(self):
        self.assertEqual(self.create().status_code, 201)
        for username in ['TEST ONLY Direct','  test only direct  ']:
            response = self.create(username=username,email='different@example.test')
            self.assertEqual((response.status_code,response.json['code']), (409,'USERNAME_ALREADY_EXISTS'))
        with app.app_context():
            db.session.get(User, 2).username = 'ÉCOLE'; db.session.commit()
        response = self.create(username='école',email='unicode@example.test')
        self.assertEqual(response.json['code'],'USERNAME_ALREADY_EXISTS')

    def test_duplicate_email_active_disabled_and_normalization(self):
        response = self.create(username='  TEST ONLY Trimmed  ',email='  DIRECT@EXAMPLE.TEST  ')
        self.assertEqual(response.status_code,201)
        self.assertEqual(response.json['user']['email'],'direct@example.test')
        self.assertEqual(response.json['user']['username'],'TEST ONLY Trimmed')
        for email in ['DIRECT@example.test','PERSON3@EXAMPLE.TEST']:
            response=self.create(username='TEST ONLY Different',email=email)
            self.assertEqual((response.status_code,response.json['code']),(409,'EMAIL_ALREADY_EXISTS'))

    def test_invalid_fields_and_existing_password_policy(self):
        for values, code in [({'username':''},'USERNAME_INVALID'),({'username':'x'*81},'USERNAME_INVALID'),
            ({'username':3},'USERNAME_INVALID'),({'email':'bad email'},'EMAIL_INVALID'),({'email':None},'EMAIL_INVALID'),
            ({'role':'learner'},'INVALID_ROLE'),({'role':'user'},'INVALID_ROLE'),({'role':'owner'},'INVALID_ROLE'),
            ({'temporaryPassword':'short'},'PASSWORD_INVALID'),({'temporaryPassword':'x'*513},'PASSWORD_INVALID'),
            ({'temporaryPassword':None},'PASSWORD_INVALID'),({'isActive':False},'VALIDATION_ERROR')]:
            with self.subTest(values=list(values)):
                response=self.create(**values)
                self.assertEqual((response.status_code,response.json['code']),(400,code))
        self.assertEqual(self.admin.post(BASE,json=[]).status_code,400)
        self.assertEqual(self.admin.post(BASE,json={}).status_code,400)
        self.assertEqual(self.admin.post(BASE,json={'username':'x'*17000}).status_code,413)

    def test_non_admin_anonymous_csrf_and_foreign_origin(self):
        self.assertEqual(self.create(client=self.client).status_code,401)
        with app.app_context():
            db.session.get(User,3).is_active=True; db.session.commit()
        for uid in [2,3]:
            self.login(self.client,uid)
            self.assertEqual(self.create(client=self.client).status_code,403)
        raw=app.test_client()
        with self.admin.session_transaction() as source, raw.session_transaction() as target:
            target.update(source)
        response=raw.post(BASE,json={'username':'TEST ONLY Missing CSRF'})
        self.assertEqual((response.status_code,response.json['code']),(403,'CSRF_MISSING'))
        token=raw.get('/api/auth/csrf').json['csrfToken']
        self.assertEqual(raw.post(BASE,json={},headers={'X-CSRF-Token':token,'Origin':'https://evil.example'}).status_code,403)

    def test_disabled_demoted_and_stale_admin_sessions_rejected(self):
        with app.app_context():
            admin=db.session.get(User,1);admin.is_active=False;db.session.commit()
        self.assertEqual(self.create().status_code,401)
        with app.app_context():
            admin=db.session.get(User,1);admin.is_active=True;admin.role='teacher';db.session.commit()
        self.login(self.admin,1)
        self.assertEqual(self.create().status_code,403)
        with app.app_context():
            admin=db.session.get(User,1);admin.role='admin';admin.auth_version+=1;db.session.commit()
        self.assertEqual(self.create().status_code,401)
        with app.app_context():
            with self.assertRaises(AccountError) as error:
                account_lifecycle.create_account('TEST ONLY stale','stale@example.test','student',PASSWORD,1,1)
            self.assertEqual(error.exception.code,'AUTH_REQUIRED')

    def test_audit_failure_rolls_back_user_creation(self):
        with patch.object(account_lifecycle,'audit',side_effect=SQLAlchemyError('TEST ONLY unavailable')):
            response=self.create()
        self.assertEqual(response.status_code,503)
        with app.app_context():
            self.assertEqual(User.query.count(),3)
            self.assertEqual(AccountAuditLog.query.count(),0)
        self.assertEqual(self.create().status_code,201)

    def test_pending_invitation_is_not_silently_replaced_and_invite_csv_survive(self):
        invited=self.admin.post('/api/admin/invitations',json={'email':'direct@example.test','role':'teacher'})
        self.assertEqual(invited.status_code,201)
        self.assertEqual(self.create().json['code'],'INVITATION_PENDING')
        self.assertEqual(self.admin.post('/api/admin/invitations/'+str(invited.json['invitation']['id'])+'/revoke').status_code,200)
        self.assertEqual(self.create().status_code,201)
        csv=self.admin.post('/api/admin/users/import',data={'file':(BytesIO(b'email,username,role\nbatch@example.test,TEST ONLY Batch,student\n'),'TEST-ONLY.csv')})
        self.assertEqual((csv.status_code,csv.json['invited']),(200,1))
        self.assertEqual(len(self.messages),2)
        with app.app_context():
            self.assertEqual(Invitation.query.count(),2)

    def test_created_account_uses_existing_change_password_and_recovery(self):
        self.create()
        login=self.client.post('/api/auth/login',json={'email':'direct@example.test','password':PASSWORD})
        self.assertEqual(login.status_code,200)
        changed=self.client.post('/api/auth/change-password',json={'currentPassword':PASSWORD,'password':fixtures.NEW_PASSWORD,'confirmPassword':fixtures.NEW_PASSWORD})
        self.assertEqual(changed.status_code,200)
        self.assertEqual(self.client.get('/api/auth/me').status_code,401)
        self.assertEqual(self.client.post('/api/auth/login',json={'email':'direct@example.test','password':fixtures.NEW_PASSWORD}).status_code,200)
        self.assertEqual(self.admin.post('/api/admin/users/'+str(login.json['user']['id'])+'/password-reset').status_code,200)
        self.assertEqual(len(self.messages),1)
        with app.app_context():
            self.assertEqual(PasswordResetToken.query.count(),1)


class DirectAccountConcurrencyTests(unittest.TestCase):
    def test_concurrent_direct_creates_from_different_admins_cannot_duplicate_username(self):
        with tempfile.TemporaryDirectory(prefix='TEST-ONLY-direct-race-') as folder:
            engine=create_engine('sqlite:///'+str(Path(folder)/'isolated.db'),connect_args={'check_same_thread':False})
            try:
                db.metadata.create_all(engine)
                with Session(engine) as tx:
                    for uid in [1,2]:
                        user=User(id=uid,username='TEST ONLY Admin '+str(uid),email=f'admin{uid}@example.test',role='admin',is_active=True,auth_version=1)
                        user.set_password(PASSWORD);tx.add(user)
                    tx.commit()
                service=AccountLifecycleService(SimpleNamespace(engine=engine),User,AccountAuditLog,Invitation,PasswordResetToken,None,app)
                barrier=Barrier(2)
                def run(uid):
                    barrier.wait()
                    try:
                        service.create_account('TEST ONLY Race',f'race{uid}@example.test','student',PASSWORD,uid,1)
                        return 'ok'
                    except AccountError as error:
                        return error.code
                with ThreadPoolExecutor(max_workers=2) as pool:
                    results=list(pool.map(run,[1,2]))
                self.assertCountEqual(results,['ok','USERNAME_ALREADY_EXISTS'])
                with Session(engine) as tx:
                    self.assertEqual(tx.query(User).count(),3)
                    self.assertEqual(tx.query(AccountAuditLog).count(),1)
            finally:
                engine.dispose()
