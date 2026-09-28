from csrf_client import csrf_client
"""Invitation/password contracts and atomicity using isolated databases only."""
from datetime import timedelta
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from urllib.parse import urlparse, parse_qs
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
from account_credentials import utc_now
from app import app, db, User, Paper, Invitation, PasswordResetToken, AccountAuditLog, account_lifecycle
from account_lifecycle import AccountLifecycleService, digest
from account_service import AccountError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

PASSWORD = "original-isolated-password"
NEW_PASSWORD = "new-isolated-long-password"

class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.messages = []
        app.config.update(TESTING=True, SECRET_KEY="isolated-lifecycle-session", ACCOUNT_MAIL_TEST_SINK=lambda *args: self.messages.append(args))
        self.client = csrf_client(app); self.admin = csrf_client(app)
        with app.app_context():
            self.assertEqual(db.engine.url.database, ":memory:")
            db.create_all()
            for uid,role,active in [(1,"admin",True),(2,"student",True),(3,"teacher",False)]:
                user=User(id=uid,username=f"Person {uid}",email=f"person{uid}@example.test",role=role,is_active=active,auth_version=1)
                user.set_password(PASSWORD);db.session.add(user)
            db.session.commit()
        self.login(self.admin,1)
    def tearDown(self):
        with app.app_context(): db.session.remove();db.drop_all();db.engine.dispose()
        app.config.pop("ACCOUNT_MAIL_TEST_SINK",None)
    def login(self,client,uid,remember=False,password=PASSWORD):
        return client.post("/api/auth/login",json={"email":f"person{uid}@example.test","password":password,"remember":remember})
    def token(self): return parse_qs(urlparse(self.messages[-1][2]).query)["token"][0]
    def invite(self,role="student",email="invite@example.test"):
        return self.admin.post("/api/admin/invitations",json={"email":email,"role":role})
    def accept(self,token=None,password=NEW_PASSWORD):
        return self.client.post("/api/auth/accept-invitation",json={"token":token or self.token(),"username":"Invited Person","password":password,"confirmPassword":password})
    def forgot(self,email="person2@example.test"):
        return self.client.post("/api/auth/forgot-password",json={"email":email})
    def reset(self,token=None,password=NEW_PASSWORD):
        return self.client.post("/api/auth/reset-password",json={"token":token or self.token(),"password":password,"confirmPassword":password})
    def change(self,current=PASSWORD,password=NEW_PASSWORD):
        return self.client.post("/api/auth/change-password",json={"currentPassword":current,"password":password,"confirmPassword":password})
    def code(self,response,expected): self.assertEqual(response.json.get("code"),expected)
    def test_non_admin_cannot_invite(self):
        self.assertEqual(self.client.post("/api/admin/invitations",json={}).status_code,401)
        self.login(self.client,2);self.assertEqual(self.client.post("/api/admin/invitations",json={}).status_code,403)
    def test_invite_roles_and_accept_correct_role(self):
        for role in ["student","teacher","admin"]:
            with self.subTest(role=role):
                self.assertEqual(self.invite(role,f"{role}@example.test").status_code,201)
                self.assertEqual(self.accept().status_code,201)
                with app.app_context(): self.assertEqual(User.query.filter_by(email=f"{role}@example.test").one().role,role)
    def test_invalid_role(self): self.code(self.invite("owner"),"INVALID_ROLE")
    def test_invalid_email(self): self.code(self.invite(email="bad email"),"VALIDATION_ERROR")
    def test_existing_active_or_disabled_email_rejected(self):
        for uid in [1,3]: self.code(self.invite(email=f"PERSON{uid}@example.test"),"EMAIL_ALREADY_EXISTS")
    def test_pending_conflict(self):
        self.invite();self.code(self.invite(),"INVITATION_PENDING");self.assertEqual(len(self.messages),1)
    def test_invitation_hash_and_no_public_token(self):
        response=self.invite();token=self.token()
        self.assertNotIn(token,str(response.json));self.assertNotIn("token_hash",str(response.json))
        with app.app_context(): self.assertEqual(Invitation.query.one().token_hash,digest(token))
    def test_invalid_invitation(self): self.code(self.accept("x"*43),"INVITATION_INVALID")
    def test_expired_invitation(self):
        self.invite()
        with app.app_context(): Invitation.query.one().expires_at=utc_now()-timedelta(seconds=1);db.session.commit()
        self.code(self.accept(),"INVITATION_EXPIRED")
    def test_expired_invitation_can_be_replaced(self):
        self.invite();old=self.token()
        with app.app_context(): Invitation.query.one().expires_at=utc_now()-timedelta(seconds=1);db.session.commit()
        self.assertEqual(self.invite().status_code,201);self.code(self.accept(old),"INVITATION_EXPIRED")
    def test_revocation_audited_and_new_invitation_allowed(self):
        response=self.invite();old=self.token()
        self.assertEqual(self.admin.post(f"/api/admin/invitations/{response.json['invitation']['id']}/revoke").status_code,200)
        self.code(self.accept(old),"INVITATION_REVOKED");self.assertEqual(self.invite().status_code,201)
    def test_invitation_one_time(self):
        self.invite();token=self.token();self.assertEqual(self.accept(token).status_code,201);self.code(self.accept(token),"INVITATION_USED")
    def test_accepted_cannot_revoke(self):
        value=self.invite().json;self.accept();self.code(self.admin.post(f"/api/admin/invitations/{value['invitation']['id']}/revoke"),"INVITATION_USED")
    def test_failure_does_not_consume_invitation(self):
        self.invite();token=self.token()
        with patch.object(account_lifecycle,"audit",side_effect=SQLAlchemyError()):self.assertEqual(self.accept(token).status_code,503)
        with app.app_context():self.assertIsNone(Invitation.query.one().accepted_at);self.assertIsNone(User.query.filter_by(email="invite@example.test").first())
        self.assertEqual(self.accept(token).status_code,201)
    def test_mail_failure_rolls_back_invitation(self):
        with patch.object(account_lifecycle.mail,"send",side_effect=AccountError("unavailable","MAIL_UNAVAILABLE",503)):
            self.code(self.invite(),"MAIL_UNAVAILABLE")
        with app.app_context():self.assertEqual(Invitation.query.count(),0)
    def test_password_policy_shared(self):
        self.invite();self.code(self.accept(password="short"),"PASSWORD_INVALID")
        self.forgot();self.code(self.reset(password="short"),"PASSWORD_INVALID")
        self.login(self.client,2);self.code(self.change(password="short"),"PASSWORD_INVALID")
    def test_password_confirmation(self):
        self.code(self.client.post("/api/auth/reset-password",json={"password":NEW_PASSWORD,"confirmPassword":"other"}),"PASSWORD_INVALID")
    def test_forgot_public_response_identical(self):
        responses=[self.forgot(email) for email in ["person2@example.test","person3@example.test","missing@example.test","invalid"]]
        self.assertEqual([r.status_code for r in responses],[200]*4);self.assertTrue(all(r.json==responses[0].json for r in responses))
        self.assertEqual(len(self.messages),1)
    def test_forgot_mail_failure_does_not_enumerate(self):
        with patch.object(account_lifecycle.mail,"send",side_effect=AccountError("mail","MAIL_UNAVAILABLE",503)):
            self.assertEqual(self.forgot().json,self.forgot("unknown@example.test").json)
        with app.app_context():self.assertEqual(PasswordResetToken.query.count(),0)
    def test_reset_hash_only(self):
        response=self.forgot();token=self.token()
        self.assertNotIn(token,str(response.json))
        with app.app_context():self.assertEqual(PasswordResetToken.query.one().token_hash,digest(token))
    def test_reset_invalid(self):self.code(self.reset("x"*43),"RESET_TOKEN_INVALID")
    def test_reset_expiry(self):
        self.forgot()
        with app.app_context():PasswordResetToken.query.one().expires_at=utc_now()-timedelta(seconds=1);db.session.commit()
        self.code(self.reset(),"RESET_TOKEN_EXPIRED")
    def test_reset_replacement(self):
        self.forgot();old=self.token();self.forgot();self.code(self.reset(old),"RESET_TOKEN_REVOKED");self.assertEqual(self.reset().status_code,200)
    def test_failed_reset_rolls_back_password_and_token(self):
        self.forgot();token=self.token()
        with patch.object(account_lifecycle,"audit",side_effect=SQLAlchemyError()):self.assertEqual(self.reset(token).status_code,503)
        with app.app_context():
            self.assertIsNone(PasswordResetToken.query.one().used_at)
            self.assertTrue(db.session.get(User,2).check_password(PASSWORD))
            self.assertEqual(db.session.get(User,2).auth_version,1)
        self.assertEqual(self.reset(token).status_code,200)
    def test_reset_used(self):
        self.forgot();token=self.token();self.assertEqual(self.reset(token).status_code,200);self.code(self.reset(token),"RESET_TOKEN_USED")
    def test_reset_revokes_session_remember_and_old_password(self):
        self.login(self.client,2,True);remember=self.client.get_cookie("remember_token").value
        self.forgot();self.assertEqual(self.reset().status_code,200)
        self.assertEqual(self.client.get("/api/auth/me").status_code,401)
        remembered=csrf_client(app);remembered.set_cookie("remember_token",remember)
        self.assertEqual(remembered.get("/api/auth/me").status_code,401)
        self.assertEqual(self.login(self.client,2).status_code,401)
        self.assertEqual(self.login(self.client,2,password=NEW_PASSWORD).status_code,200)
    def test_disabled_or_version_changed_reset_rejected(self):
        self.forgot()
        with app.app_context():user=db.session.get(User,2);user.auth_version+=1;db.session.commit()
        self.code(self.reset(),"RESET_TOKEN_INVALID")
    def test_change_requires_login_current_password(self):
        self.assertEqual(self.change().status_code,401);self.login(self.client,2)
        self.code(self.change(current=""),"CURRENT_PASSWORD_INVALID");self.code(self.change(current="wrong"),"CURRENT_PASSWORD_INVALID")
    def test_change_revokes_all_sessions_and_resets(self):
        self.login(self.client,2,True);other=csrf_client(app);self.login(other,2,True);remember=other.get_cookie("remember_token").value
        self.forgot();token=self.token();self.assertEqual(self.change().status_code,200)
        for client in [self.client,other]:self.assertEqual(client.get("/api/auth/me").status_code,401)
        remembered=csrf_client(app);remembered.set_cookie("remember_token",remember);self.assertEqual(remembered.get("/api/auth/me").status_code,401)
        self.code(self.reset(token),"RESET_TOKEN_REVOKED");self.assertEqual(self.login(self.client,2).status_code,401);self.assertEqual(self.login(self.client,2,password=NEW_PASSWORD).status_code,200)
    def test_admin_send_reset(self):
        self.assertEqual(self.admin.post("/api/admin/users/2/password-reset").status_code,200);self.assertEqual(len(self.messages),1)
        self.assertEqual(self.admin.post("/api/admin/users/3/password-reset").status_code,404)
    def test_invitation_listing_safe_and_paginated(self):
        self.invite();data=self.admin.get("/api/admin/invitations?page=1&perPage=1").json
        self.assertEqual(data["pagination"]["perPage"],1);self.assertNotIn("hash",str(data));self.assertNotIn(self.token(),str(data))
    def test_audit_events_no_credentials(self):
        value=self.invite().json;raw=self.token();self.accept()
        value=self.invite(email="second@example.test").json;self.admin.post(f"/api/admin/invitations/{value['invitation']['id']}/revoke")
        self.forgot();reset=self.token();self.reset();self.login(self.client,2,password=NEW_PASSWORD);self.change(current=NEW_PASSWORD,password="another-new-password")
        data=self.admin.get("/api/admin/audit-logs?perPage=100").json
        actions={row["action"] for row in data["logs"]}
        self.assertTrue({"invitation_created","invitation_revoked","invitation_accepted","password_reset_requested","password_reset_completed","password_changed"}<=actions)
        for secret in [raw,reset,PASSWORD,NEW_PASSWORD,"token_hash","password_hash"]:self.assertNotIn(secret,str(data))
    def test_cross_site_write_rejected(self):
        response=self.admin.post("/api/admin/invitations",json={"email":"test@example.test","role":"student"},headers={"Origin":"https://evil.example"})
        self.code(response,"CSRF_ORIGIN_DENIED")

class MailAdapterTests(unittest.TestCase):
    def test_production_cannot_use_development_spool(self):
        from account_mail import AccountMail
        from flask import Flask
        isolated=Flask("mail-policy")
        isolated.config.update(ACCOUNT_MAIL_MODE="development",TESTING=False,DEBUG=False)
        with self.assertRaises(AccountError):AccountMail(isolated).send("test@example.test","Test","https://example.test/?token=test")
    def test_smtp_requires_https_outside_debug(self):
        from account_mail import AccountMail
        from flask import Flask
        isolated=Flask("mail-policy")
        isolated.config.update(ACCOUNT_MAIL_MODE="smtp",TESTING=False,DEBUG=False)
        with self.assertRaises(AccountError):AccountMail(isolated).send("test@example.test","Test","http://example.test/?token=test")
    def test_development_spool_is_explicit_and_separate_from_logs(self):
        from account_mail import AccountMail
        from flask import Flask
        with tempfile.TemporaryDirectory(prefix="mail-spool-") as directory:
            isolated=Flask("mail-policy",instance_path=directory)
            isolated.config.update(ACCOUNT_MAIL_MODE="development",TESTING=False,DEBUG=True)
            AccountMail(isolated).send("test@example.test","Test","http://127.0.0.1:5173/?token=test")
            files=list((Path(directory)/"account-mail").glob("*.txt"))
            self.assertEqual(len(files),1);self.assertIn("token=test",files[0].read_text())

class LifecycleConcurrencyTests(unittest.TestCase):
    def test_invitation_and_reset_double_submit(self):
        for operation in ["accept","reset"]:
            with self.subTest(operation=operation), tempfile.TemporaryDirectory(prefix="lifecycle-race-") as directory:
                engine=create_engine("sqlite:///"+str(Path(directory)/"isolated.db"),connect_args={"check_same_thread":False})
                db.metadata.create_all(engine)
                with Session(engine) as tx:
                    user=User(id=1,username="Test",email="test@example.test",role="admin",is_active=True,auth_version=1);user.set_password(PASSWORD);tx.add(user);tx.flush()
                    token="x"*43
                    if operation=="accept":tx.add(Invitation(email="invite@example.test",role="teacher",created_by_id=1,token_hash=digest(token),pending_email="invite@example.test",expires_at=utc_now()+timedelta(hours=1)))
                    else:tx.add(PasswordResetToken(user_id=1,auth_version=1,token_hash=digest(token),expires_at=utc_now()+timedelta(hours=1)))
                    tx.commit()
                service=AccountLifecycleService(type("Database",(),{"engine":engine})(),User,AccountAuditLog,Invitation,PasswordResetToken,None,app)
                barrier=Barrier(2)
                def run():
                    barrier.wait()
                    try:
                        if operation=="accept":service.accept(token,"Invited",NEW_PASSWORD)
                        else:service.reset(token,NEW_PASSWORD)
                        return "ok"
                    except AccountError as error:return error.code
                with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:run(),range(2)))
                self.assertEqual(results.count("ok"),1);self.assertIn("INVITATION_USED" if operation=="accept" else "RESET_TOKEN_USED",results)
                with Session(engine) as tx:self.assertEqual(tx.query(AccountAuditLog).count(),1)
                engine.dispose()

class LifecycleMigrationTests(unittest.TestCase):
    def test_additive_roundtrip_preserves_existing_records(self):
        with tempfile.TemporaryDirectory(prefix="lifecycle-migration-") as directory:
            path=Path(directory)/"isolated.db"
            env={**os.environ,"DATABASE_URL":"sqlite:///"+path.as_posix(),"ACCOUNT_MAIL_MODE":"disabled"}
            def migrate(direction,target):
                result=subprocess.run([sys.executable,"-m","flask","db",direction,target],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=60)
                self.assertEqual(result.returncode,0,result.stderr)
            migrate("upgrade","9d71b6a42c30")
            with closing(sqlite3.connect(path)) as connection:
                connection.execute("INSERT INTO user(id,username,email,password_hash,role,created_at) VALUES(1,'Preserved','preserved@example.test','preserved-hash','teacher','2026-01-01')")
                connection.execute("INSERT INTO papers(id,slug,title,authors,publication_type,topics,difficulty,estimated_reading_minutes,abstract,learning_objectives,keywords,resource_category,status,created_by_id,created_at,updated_at,featured,open_access) VALUES(1,'preserved','Preserved','[]','Research Article','[]','Beginner',1,'Test','[]','[]','Foundational','draft',1,'2026-01-01','2026-01-01',0,0)")
                connection.commit();before={table:connection.execute(f"SELECT * FROM {table}").fetchall() for table in ["user","papers"]}
            for direction,target in [("upgrade","head"),("downgrade","9d71b6a42c30"),("upgrade","head")]:
                migrate(direction,target)
                with closing(sqlite3.connect(path)) as connection:
                    for table,rows in before.items():self.assertEqual(connection.execute(f"SELECT * FROM {table}").fetchall(),rows)
                    self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(),[])
