"""Adversarial coverage of shared request security and administrator import."""
import io
import unittest
from unittest.mock import patch
from threading import Event
from flask.testing import FlaskClient
import test_account_lifecycle as lifecycle_tests
from test_account_lifecycle import PASSWORD, NEW_PASSWORD
from app import app, db, User, Invitation, AccountAuditLog, account_lifecycle, limiter
from account_service import AccountError
from limits.errors import StorageError


class HardeningTests(unittest.TestCase):
    setUp = lifecycle_tests.LifecycleTests.setUp
    tearDown = lifecycle_tests.LifecycleTests.tearDown
    login = lifecycle_tests.LifecycleTests.login
    invite = lifecycle_tests.LifecycleTests.invite
    token = lifecycle_tests.LifecycleTests.token

    def raw(self):
        return FlaskClient(app, app.response_class, use_cookies=True)

    def upload(self, content, client=None, filename="users.csv", mime="text/csv"):
        return (client or self.admin).post("/api/admin/users/import", data={"file": (io.BytesIO(content), filename, mime)})

    def test_csrf_missing_rejects_every_unsafe_route(self):
        client = self.raw()
        paths = [("POST", p) for p in ["/api/auth/login", "/api/auth/logout", "/api/auth/forgot-password", "/api/auth/reset-password", "/api/auth/accept-invitation", "/api/auth/change-password", "/api/auth/invitation-details", "/api/admin/invitations", "/api/admin/users/import", "/api/admin/users/2/disable", "/api/admin/users/2/enable", "/api/admin/users/2/password-reset", "/api/admin/invitations/1/revoke", "/api/papers", "/api/papers/1/archive", "/api/papers/1/attachments", "/api/papers/1/attachments/link", "/api/chat"]]
        paths += [("PATCH", "/api/admin/users/2/role"), ("PATCH", "/api/papers/1"), ("DELETE", "/api/papers/1"), ("PUT", "/api/papers/1/attachments/1"), ("DELETE", "/api/papers/1/attachments/1")]
        for method, path in paths:
            with self.subTest(method=method, path=path):
                result = client.open(path, method=method, json={})
                self.assertEqual((result.status_code, result.json["code"]), (403, "CSRF_MISSING"))

    def test_csrf_valid_invalid_foreign_and_safe_methods(self):
        client = self.raw(); other = self.raw()
        token = client.get("/api/auth/csrf").json["csrfToken"]
        for wrong in ["x" * 43, "non-ascii-" + chr(233), other.get("/api/auth/csrf").json["csrfToken"]]:
            response = client.post("/api/auth/logout", headers={"X-CSRF-Token": wrong})
            self.assertEqual(response.json["code"], "CSRF_INVALID")
        for extra in [{"Origin": "https://evil.example"}, {"Origin": "null"}, {"Sec-Fetch-Site": "cross-site"}]:
            self.assertEqual(client.post("/api/auth/logout", headers={"X-CSRF-Token": token, **extra}).json["code"], "CSRF_ORIGIN_DENIED")
        self.assertEqual(client.get("/api/auth/me").status_code, 200)
        self.assertEqual(client.head("/api/auth/me").status_code, 200)
        self.assertEqual(client.post("/api/auth/logout", headers={"X-CSRF-Token": token, "Origin": "http://127.0.0.1:5173"}).status_code, 200)

    def test_login_logout_rotate_token_and_no_legacy_bypass(self):
        client = self.raw(); token = client.get("/api/auth/csrf").json["csrfToken"]
        response = client.post("/api/auth/login", json={"email": "person2@example.test", "password": PASSWORD}, headers={"X-CSRF-Token": token})
        self.assertEqual(response.status_code, 200)
        fresh = client.get("/api/auth/csrf").json["csrfToken"]; self.assertNotEqual(token, fresh)
        client.get("/logout"); self.assertTrue(client.get("/api/auth/me").json["authenticated"])
        self.assertEqual(client.post("/login", headers={"X-CSRF-Token": fresh}).status_code, 405)
        self.assertEqual(client.post("/api/auth/logout", headers={"X-CSRF-Token": token}).status_code, 403)
        self.assertEqual(client.post("/api/auth/logout", headers={"X-CSRF-Token": fresh}).status_code, 200)
        self.assertNotEqual(fresh, client.get("/api/auth/csrf").json["csrfToken"])

    def test_rate_limits_all_sensitive_routes_and_spares_admin(self):
        config = app.config.copy()
        try:
            app.config["ACCOUNT_RATE_LIMIT_ENABLED"] = True
            for name in ["LOGIN", "FORGOT", "RESET", "ACCEPT", "INVITATION", "CHANGE"]: app.config["ACCOUNT_LIMIT_" + name] = "2/minute"
            limiter.reset()
            for path in ["login", "forgot-password", "reset-password", "accept-invitation", "invitation-details", "change-password"]:
                with self.subTest(path=path):
                    for _ in range(2): self.assertNotEqual(self.client.post("/api/auth/" + path, json={"email": "missing@example.test"}).status_code, 429)
                    limited = self.client.post("/api/auth/" + path, json={})
                    self.assertEqual((limited.status_code, limited.json["code"]), (429, "RATE_LIMITED"))
                    self.assertIn("Retry-After", limited.headers)
            self.assertEqual(self.admin.get("/api/admin/users").status_code, 200)
            self.assertEqual(self.admin.post("/api/admin/users/2/enable").status_code, 200)
        finally:
            app.config.update(config); limiter.reset()

    def test_rate_storage_failure_is_safe_and_closed(self):
        app.config["ACCOUNT_RATE_LIMIT_ENABLED"] = True
        try:
            with patch.object(limiter.limiter, "hit", side_effect=StorageError(Exception("private storage detail"))):
                response = self.client.post("/api/auth/login", json={"email": "person2@example.test", "password": PASSWORD})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("private storage", response.get_data(as_text=True))
        finally: app.config["ACCOUNT_RATE_LIMIT_ENABLED"] = False

    def test_async_forgot_never_waits_for_lookup_or_delivery(self):
        app.config["ACCOUNT_RECOVERY_SYNCHRONOUS"] = False
        entered, release = Event(), Event()
        def blocked(**kwargs): entered.set(); release.wait(5)
        recovery = app.extensions["account_recovery"]
        try:
            with patch.object(account_lifecycle, "request_reset", side_effect=blocked):
                first = self.client.post("/api/auth/forgot-password", json={"email": "person2@example.test"})
                self.assertTrue(entered.wait(1)); self.assertFalse(release.is_set())
                second = self.client.post("/api/auth/forgot-password", json={"email": "missing@example.test"})
                self.assertEqual((first.status_code, first.json), (second.status_code, second.json))
                release.set()
                recovery.executor.submit(lambda: None).result(5)
        finally:
            release.set(); app.config["ACCOUNT_RECOVERY_SYNCHRONOUS"] = True

    def test_recovery_queue_full_identical_for_all_accounts(self):
        app.config["ACCOUNT_RECOVERY_SYNCHRONOUS"] = False
        try:
            with patch.object(app.extensions["account_recovery"].slots, "acquire", return_value=False):
                responses = [self.client.post("/api/auth/forgot-password", json={"email": email}) for email in ["person2@example.test", "missing@example.test"]]
            self.assertEqual(responses[0].status_code, 503); self.assertEqual(responses[0].json, responses[1].json)
        finally: app.config["ACCOUNT_RECOVERY_SYNCHRONOUS"] = True

    def test_import_partial_results_no_overwrite_and_first_time_setup(self):
        content = b"email,username,role\nimport@example.test,Imported Name,teacher\nIMPORT@example.test,Duplicate,admin\nperson2@example.test,Overwrite,admin\nbad@example.test,Invalid,owner\nonly-one-column\ngood@example.test,Good,student\n"
        response = self.upload(content)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual((response.json["invited"], response.json["failed"]), (2, 4))
        self.assertEqual([row.get("code") for row in response.json["results"]], [None, "DUPLICATE_EMAIL", "EMAIL_ALREADY_EXISTS", "INVALID_ROLE", "MALFORMED_ROW", None])
        with app.app_context():
            self.assertEqual(User.query.count(), 3); self.assertEqual(db.session.get(User, 2).role, "student")
            self.assertEqual(Invitation.query.filter_by(email="import@example.test").one().suggested_username, "Imported Name")
        token = self.token()
        self.assertEqual(self.client.post("/api/auth/invitation-details", json={"token": token}).json, {"username": "Good"})
        self.assertEqual(self.client.post("/api/auth/accept-invitation", json={"token": token, "username": "Changed Name", "password": NEW_PASSWORD, "confirmPassword": NEW_PASSWORD}).status_code, 201)
        self.assertNotIn(token, str(response.json))

    def test_import_role_matrix_and_all_roles(self):
        csv = b"email,username,role\nnew@example.test,Name,student\n"
        self.assertEqual(self.upload(csv, self.client).status_code, 401)
        self.login(self.client, 2); self.assertEqual(self.upload(csv, self.client).status_code, 403)
        with app.app_context(): db.session.get(User, 2).role = "teacher"; db.session.commit()
        self.assertEqual(self.upload(csv, self.client).status_code, 403)
        response = self.upload(b"email,display_name,role\ns@example.test,S,student\nt@example.test,T,teacher\na@example.test,A,admin\n")
        self.assertEqual(response.json["invited"], 3)

    def test_import_rejects_password_columns_types_binary_size_and_row_count(self):
        valid = b"email,username,role\nnew@example.test,Name,student\n"
        cases = [(b"email,username,role,password\nnew@example.test,Name,student,secret", "users.csv", "text/csv"),
                 (valid, "users.xlsx", "text/csv"), (valid, "users.csv", "image/png"),
                 (b"\x00binary", "users.csv", "text/csv"), (b"\xff", "users.csv", "text/csv"),
                 (b"email,username,role\n" + b"x@y.test,X,student\n" * 101, "users.csv", "text/csv"),
                 (b"email,username,role\n\"unterminated", "users.csv", "text/csv"),
                 (b"x" * (129 * 1024), "users.csv", "text/csv")]
        for content, filename, mime in cases:
            with self.subTest(filename=filename, size=len(content)):
                self.assertIn(self.upload(content, filename=filename, mime=mime).status_code, [400, 413])
        with app.app_context(): self.assertEqual(Invitation.query.count(), 0)

    def test_import_mail_failure_rolls_back_only_failed_row(self):
        real = account_lifecycle.mail.send
        def send(email, *args):
            if email.startswith("fail"): raise AccountError("Email delivery is unavailable.", "MAIL_UNAVAILABLE", 503)
            return real(email, *args)
        with patch.object(account_lifecycle.mail, "send", side_effect=send):
            response = self.upload(b"email,username,role\nok@example.test,OK,student\nfail@example.test,Fail,student\nlast@example.test,Last,teacher\n")
        self.assertEqual((response.json["invited"], response.json["failed"]), (2, 1))
        with app.app_context(): self.assertEqual(Invitation.query.count(), 2)

    def test_audit_invitation_target_truthful_safe_details_and_huge_ids(self):
        self.invite()
        response = self.admin.get("/api/admin/audit-logs?action=invitation_created")
        entry = response.json["logs"][0]
        self.assertEqual(entry["actor"]["id"], 1); self.assertIsNone(entry["target"])
        self.assertIn("invitationId", entry["details"])
        with app.app_context():
            record = AccountAuditLog.query.first(); record.details = {"oldRole": "secret", "token": "secret", "invitationId": 1}; db.session.commit()
        self.assertNotIn("secret", str(self.admin.get("/api/admin/audit-logs").json))
        for path in ["/api/admin/audit-logs?actorId=" + "9"*80, "/api/admin/users/" + "9"*80]: self.assertEqual(self.admin.get(path).status_code, 400)

    def test_private_cache_and_bounded_credentials(self):
        for path in ["/api/auth/csrf", "/api/papers/manage", "/api/papers/manage/1/preview"]:
            response = self.admin.get(path); self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "person2@example.test", "password": "x"*513}).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "x"*20000, "password": PASSWORD}).status_code, 413)

    def test_unknown_login_does_hash_work_and_safe_db_failure(self):
        with patch("app.check_password_hash", return_value=False) as hashed:
            self.client.post("/api/auth/login", json={"email": "missing@example.test", "password": PASSWORD})
            self.assertTrue(hashed.called)
        from sqlalchemy.exc import SQLAlchemyError
        with patch("app.authenticate_user", side_effect=SQLAlchemyError("private failure")):
            response = self.client.post("/api/auth/login", json={"email": "person2@example.test", "password": PASSWORD})
        self.assertEqual(response.status_code, 503); self.assertNotIn("private failure", str(response.json))

    def test_failed_replacement_mail_preserves_prior_reset(self):
        self.client.post("/api/auth/forgot-password", json={"email": "person2@example.test"})
        token = self.token()
        with patch.object(account_lifecycle.mail, "send", side_effect=AccountError("Unavailable", "MAIL_UNAVAILABLE", 503)):
            self.client.post("/api/auth/forgot-password", json={"email": "person2@example.test"})
        response = self.client.post("/api/auth/reset-password", json={"token": token, "password": NEW_PASSWORD, "confirmPassword": NEW_PASSWORD})
        self.assertEqual(response.status_code, 200)

    def test_production_configuration_fails_closed(self):
        import os
        from flask import Flask
        from request_security import install_security, LIMITS
        def isolated():
            instance = Flask("production-security")
            instance.config.update(FRONTEND_URL="https://example.test", ACCOUNT_MAIL_MODE="disabled")
            for endpoint in LIMITS: instance.add_url_rule("/"+endpoint, endpoint, lambda: "ok", methods=["POST"])
            return instance
        settings = {"APP_ENV": "production", "SECRET_KEY": "x"*40, "RATELIMIT_STORAGE_URI": "redis://127.0.0.1:6379/0"}
        with patch.dict(os.environ, settings):
            instance = isolated(); install_security(instance)
            self.assertTrue(instance.config["SESSION_COOKIE_SECURE"]); self.assertTrue(instance.config["REMEMBER_COOKIE_SECURE"])
            for changes in [{"SECRET_KEY": ""}, {"RATELIMIT_STORAGE_URI": "memory://"}, {"ACCOUNT_LIMIT_LOGIN": "invalid"}]:
                with self.subTest(changes=list(changes)), patch.dict(os.environ, changes), self.assertRaises((RuntimeError, ValueError)):
                    install_security(isolated())
            instance = isolated(); instance.config["FRONTEND_URL"] = "http://example.test"
            with self.assertRaises(RuntimeError): install_security(instance)
            instance = isolated(); instance.config["ACCOUNT_MAIL_MODE"] = "development"
            with self.assertRaises(RuntimeError): install_security(instance)

    def test_smtp_starttls_and_production_spool_gate(self):
        from flask import Flask
        from account_mail import AccountMail
        instance = Flask("mail-transport")
        instance.config.update(ACCOUNT_MAIL_MODE="smtp", ACCOUNT_MAIL_FROM="sender@example.test", ACCOUNT_SMTP_HOST="smtp.example.test", ACCOUNT_SMTP_USER="test", ACCOUNT_SMTP_PASSWORD="test", APP_ENV="production")
        with patch("account_mail.smtplib.SMTP") as smtp:
            AccountMail(instance).send("recipient@example.test", "Reset", "https://example.test/reset-password?token=test")
            smtp.return_value.__enter__.return_value.starttls.assert_called_once()
            smtp.return_value.__enter__.return_value.send_message.assert_called_once()
        instance.config.update(ACCOUNT_MAIL_MODE="development", DEBUG=True)
        with self.assertRaises(AccountError): AccountMail(instance).send("recipient@example.test", "Reset", "https://example.test/reset-password?token=test")

    def test_final_role_matrix_for_auth_public_papers_ownership_and_admin(self):
        from app import Paper
        from account_credentials import utc_now
        from datetime import timedelta
        from csrf_client import csrf_client
        with app.app_context():
            for uid, role in [(4, "admin"), (5, "teacher"), (6, "teacher")]:
                user = User(id=uid, username=f"Matrix {uid}", email=f"person{uid}@example.test", role=role, is_active=True)
                user.set_password(PASSWORD); db.session.add(user)
            db.session.flush()
            for pid, owner, status in [(8, 5, "draft"), (9, 5, "published"), (10, 6, "draft")]:
                db.session.add(Paper(id=pid, slug=f"matrix-{pid}", title="Matrix paper", authors=["Fixture"], publication_type="Research Article", topics=["Memory"], difficulty="Beginner", estimated_reading_minutes=5, abstract="Fixture", learning_objectives=["Learn"], keywords=[], resource_category="Foundational", status=status, created_by_id=owner))
            db.session.commit()
        self.invite(email="invited@example.test"); self.invite(email="expired@example.test")
        with app.app_context():
            Invitation.query.filter_by(email="expired@example.test").one().expires_at = utc_now()-timedelta(seconds=1); db.session.commit()
        cases = [("Anonymous", None, 401, 401, 401), ("Student", 2, 200, 403, 403),
                 ("Teacher A", 5, 200, 403, 200), ("Teacher B", 6, 200, 403, 403),
                 ("Admin A", 1, 200, 200, 200), ("Admin B", 4, 200, 200, 200),
                 ("Disabled", 3, 401, 401, 401), ("Invited", "invited", 401, 401, 401),
                 ("Expired invitation", "expired", 401, 401, 401)]
        for label, uid, login_status, admin_status, owner_status in cases:
            with self.subTest(role=label):
                client = csrf_client(app)
                if uid is not None:
                    email = f"person{uid}@example.test" if isinstance(uid, int) else f"{uid}@example.test"
                    self.assertEqual(client.post("/api/auth/login", json={"email": email, "password": PASSWORD}).status_code, login_status)
                self.assertEqual(client.get("/api/papers/matrix-9").status_code, 200)
                self.assertEqual(client.get("/api/admin/users").status_code, admin_status)
                self.assertEqual(client.get("/api/admin/audit-logs").status_code, admin_status)
                self.assertEqual(client.get("/api/papers/manage/8").status_code, owner_status)
                if uid == 6: self.assertEqual(client.get("/api/papers/manage/10").status_code, 200)
                self.assertEqual(client.get("/api/auth/me").json["authenticated"], login_status == 200)
