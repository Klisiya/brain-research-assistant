"""Account state, session revocation, admin privacy and transaction regressions."""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from app import app, db, User, Paper, AccountAuditLog, account_service, authenticate_user
from account_service import AccountError, AccountService
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from werkzeug.security import generate_password_hash


PASSWORD = "isolated-account-test-password"
PASSWORD_HASH = generate_password_hash(PASSWORD)


class AccountAuthorizationTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True, SECRET_KEY="isolated-account-test-session")
        self.client = app.test_client()
        self.admin = app.test_client()
        with app.app_context():
            self.assertEqual(db.engine.url.database, ":memory:")
            db.create_all()
            for uid, role, active in [(1, "admin", True), (2, "teacher", True), (3, "teacher", True),
                                      (4, "student", True), (5, "user", True), (6, "admin", False)]:
                db.session.add(User(id=uid, username=f"Test Person {uid}", email=f"person-{uid}@example.test",
                                    role=role, is_active=active, password_hash=PASSWORD_HASH))
            db.session.flush()
            for pid, owner in [(1, 2), (2, 3)]:
                db.session.add(Paper(id=pid, slug=f"account-paper-{pid}", title="Ownership fixture",
                                     authors=["Author"], publication_type="Research Article", topics=["Memory"],
                                     difficulty="Beginner", estimated_reading_minutes=5, abstract="Test",
                                     learning_objectives=["Learn"], keywords=[], resource_category="Foundational",
                                     status="draft", created_by_id=owner))
            db.session.commit()
        self.login(self.admin, 1)

    def tearDown(self):
        with app.app_context():
            db.session.remove()
            db.drop_all()
            db.engine.dispose()

    def login(self, client, uid=4, remember=False):
        response = client.post("/api/auth/login", json={"email": f"person-{uid}@example.test",
                                                       "password": PASSWORD, "remember": remember})
        self.assertEqual(response.status_code, 200, response.json)
        return response

    def change(self, uid, role):
        return self.admin.patch(f"/api/admin/users/{uid}/role", json={"role": role})

    def state(self, uid):
        with app.app_context():
            user = db.session.get(User, uid)
            return {"role": user.role, "active": user.is_active, "version": user.auth_version,
                    "disabled": user.disabled_at, "last_login": user.last_login_at}

    def assert_auth_required(self, response):
        self.assertEqual(response.status_code, 401, response.json)
        self.assertEqual(response.json, {"error": "Authentication required.", "code": "AUTH_REQUIRED"})

    def test_active_login_records_timestamp_and_version(self):
        response = self.login(self.client)
        self.assertTrue(response.json["user"]["isActive"])
        self.assertIsNotNone(self.state(4)["last_login"])
        with self.client.session_transaction() as session:
            self.assertEqual(session["auth_version"], 1)
            self.assertEqual(session["_user_id"], "4:1")
            self.assertNotIn("role", session)

    def test_login_cannot_issue_current_version_after_concurrent_revocation(self):
        def authenticate_then_revoke(email, password):
            user = authenticate_user(email, password)
            account_service.change_role(user.id, "teacher", actor_id=1, actor_version=1)
            return user
        with patch("app.authenticate_user", side_effect=authenticate_then_revoke):
            response = self.client.post("/api/auth/login", json={"email": "person-4@example.test", "password": PASSWORD})
        self.assertEqual(response.status_code, 401)
        with self.client.session_transaction() as session:
            self.assertNotIn("_user_id", session)

    def test_authentication_cookies_explicitly_restrict_cross_site_posts(self):
        response = self.login(self.client, remember=True)
        cookies = response.headers.getlist("Set-Cookie")
        self.assertTrue(any(value.startswith("session=") for value in cookies))
        self.assertTrue(any(value.startswith("remember_token=") for value in cookies))
        self.assertTrue(all("SameSite=Lax" in value and "HttpOnly" in value for value in cookies))

    def test_invalid_disabled_and_missing_login_have_same_response(self):
        responses = [self.client.post("/api/auth/login", json={"email": email, "password": password})
                     for email, password in [("person-6@example.test", PASSWORD),
                                             ("missing@example.test", PASSWORD),
                                             ("person-4@example.test", "wrong")]]
        for response in responses:
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json, responses[0].json)

    def test_auth_me_returns_only_self(self):
        self.login(self.client)
        payload = self.client.get("/api/auth/me?userId=1&id=1&email=person-1@example.test").json
        self.assertEqual(payload["user"]["id"], 4)
        self.assertEqual(set(payload["user"]), {"id", "username", "email", "role", "isActive"})

    def test_legacy_user_is_student_without_changing_database_role(self):
        self.assertEqual(self.login(self.client, 5).json["user"]["role"], "student")
        self.assertEqual(self.state(5)["role"], "user")
        self.assertEqual(self.client.get("/api/papers/manage").status_code, 403)

    def test_deleted_account_invalidates_session(self):
        self.login(self.client)
        with app.app_context():
            db.session.delete(db.session.get(User, 4))
            db.session.commit()
        self.assert_auth_required(self.client.get("/api/auth/me"))

    def test_auth_version_mismatch_clears_session(self):
        self.login(self.client)
        with self.client.session_transaction() as session:
            session["auth_version"] = 999
        self.assert_auth_required(self.client.get("/api/auth/me"))
        with self.client.session_transaction() as session:
            self.assertNotIn("_user_id", session)
            self.assertNotIn("auth_version", session)

    def test_pre_version_session_is_rejected(self):
        with self.client.session_transaction() as session:
            session["_user_id"] = "4"
        self.assert_auth_required(self.client.get("/api/auth/me"))

    def test_malformed_session_is_rejected(self):
        with self.client.session_transaction() as session:
            session["_user_id"] = 4
        self.assert_auth_required(self.client.get("/api/auth/me"))

    def test_inactive_database_state_is_authoritative(self):
        self.login(self.client)
        with app.app_context():
            db.session.get(User, 4).is_active = False
            db.session.commit()
        self.assert_auth_required(self.client.get("/api/auth/me"))

    def test_role_change_increments_version_and_invalidates_multiple_sessions(self):
        second = app.test_client()
        self.login(self.client)
        self.login(second)
        self.assertEqual(self.change(4, "teacher").status_code, 200)
        self.assertEqual(self.state(4)["version"], 2)
        self.assert_auth_required(self.client.get("/api/auth/me"))
        self.assert_auth_required(second.get("/api/papers/manage"))

    def test_demoted_teacher_requires_fresh_login_then_gets_403(self):
        self.login(self.client, 2)
        self.assertEqual(self.change(2, "student").status_code, 200)
        self.assert_auth_required(self.client.get("/api/papers/manage/1/preview"))
        self.assertEqual(self.login(self.client, 2).json["user"]["role"], "student")
        self.assertEqual(self.client.get("/api/papers/manage/1/preview").status_code, 403)

    def test_invalid_roles_are_rejected(self):
        for role in ["user", "superadmin", "staff", None, 3, "", "Teacher"]:
            with self.subTest(role=role):
                response = self.change(4, role)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json["code"], "INVALID_ROLE")

    def test_role_payload_cannot_change_other_fields(self):
        response = self.admin.patch("/api/admin/users/4/role", json={"role": "teacher", "is_active": False})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.state(4)["role"], "student")

    def test_admin_endpoints_deny_anonymous_student_and_teachers(self):
        endpoints = [("get", "/api/admin/users"), ("get", "/api/admin/users/4"),
                     ("get", "/api/admin/audit-logs"), ("patch", "/api/admin/users/4/role"),
                     ("post", "/api/admin/users/4/disable"), ("post", "/api/admin/users/4/enable")]
        for uid, status in [(None, 401), (4, 403), (2, 403), (3, 403)]:
            client = app.test_client()
            if uid:
                self.login(client, uid)
            for method, path in endpoints:
                with self.subTest(uid=uid, path=path):
                    self.assertEqual(getattr(client, method)(path, json={"role": "teacher"}).status_code, status)

    def test_only_active_admin_cannot_demote_self(self):
        response = self.change(1, "teacher")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json["code"], "LAST_ACTIVE_ADMIN")
        self.assertEqual(self.state(1)["version"], 1)

    def test_disabled_admin_does_not_allow_last_admin_disable(self):
        response = self.admin.post("/api/admin/users/1/disable")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json["code"], "LAST_ACTIVE_ADMIN")

    def test_second_admin_allows_self_demotion_and_revokes_current_session(self):
        self.assertEqual(self.change(3, "admin").status_code, 200)
        self.assertEqual(self.change(1, "teacher").status_code, 200)
        self.assert_auth_required(self.admin.get("/api/admin/users"))

    def test_second_admin_allows_self_disable_and_revokes_current_session(self):
        self.change(3, "admin")
        self.assertEqual(self.admin.post("/api/admin/users/1/disable").status_code, 200)
        self.assert_auth_required(self.admin.get("/api/auth/me"))

    def test_disable_and_enable_never_restore_old_cookie(self):
        self.login(self.client, 2)
        old_cookie = self.client.get_cookie("session").value
        self.assertEqual(self.admin.post("/api/admin/users/2/disable").status_code, 200)
        self.assertIsNotNone(self.state(2)["disabled"])
        self.assert_auth_required(self.client.get("/api/auth/me"))
        self.client.set_cookie("session", old_cookie)
        self.assert_auth_required(self.client.get("/api/papers/manage"))
        self.assertEqual(self.admin.post("/api/admin/users/2/enable").status_code, 200)
        self.assertIsNone(self.state(2)["disabled"])
        self.assertEqual(self.state(2)["version"], 3)
        self.client.set_cookie("session", old_cookie)
        self.assert_auth_required(self.client.get("/api/auth/me"))
        self.login(self.client, 2)
        self.assertEqual(self.client.get("/api/papers/manage").status_code, 200)

    def test_unchanged_operations_are_idempotent(self):
        self.assertEqual(self.change(4, "student").status_code, 200)
        self.admin.post("/api/admin/users/4/enable")
        self.admin.post("/api/admin/users/4/disable")
        self.admin.post("/api/admin/users/4/disable")
        self.assertEqual(self.state(4)["version"], 2)
        self.assertEqual(self.admin.get("/api/admin/audit-logs").json["pagination"]["total"], 1)

    def test_valid_remember_cookie_restores_versioned_session(self):
        self.login(self.client, 2, remember=True)
        self.client.delete_cookie("session")
        self.assertEqual(self.client.get("/api/auth/me").status_code, 200)
        with self.client.session_transaction() as session:
            self.assertEqual(session["auth_version"], 1)

    def test_revoked_remember_cookie_cannot_restore_after_enable(self):
        self.login(self.client, 2, remember=True)
        cookie = self.client.get_cookie("remember_token").value
        self.admin.post("/api/admin/users/2/disable")
        self.admin.post("/api/admin/users/2/enable")
        self.client.delete_cookie("session")
        self.client.set_cookie("remember_token", cookie)
        self.assert_auth_required(self.client.get("/api/auth/me"))
        self.assertIsNone(self.client.get_cookie("remember_token"))

    def test_password_setter_revokes_existing_session(self):
        self.login(self.client)
        with app.app_context():
            db.session.get(User, 4).set_password("new-isolated-test-password")
            db.session.commit()
        self.assertEqual(self.state(4)["version"], 2)
        self.assert_auth_required(self.client.get("/api/auth/me"))

    def test_user_search_matches_username_and_email_case_insensitively(self):
        for query in ["TEST%20PERSON%202", "PERSON-2@EXAMPLE.TEST"]:
            response = self.admin.get(f"/api/admin/users?q={query}")
            self.assertEqual(response.status_code, 200)
            self.assertEqual([u["id"] for u in response.json["users"]], [2])

    def test_user_role_and_status_filters(self):
        payload = self.admin.get("/api/admin/users?role=student").json
        self.assertEqual({user["id"] for user in payload["users"]}, {4, 5})
        self.assertEqual(self.admin.get("/api/admin/users?role=admin&status=disabled").json["users"][0]["id"], 6)

    def test_pagination_and_stable_sort(self):
        first = self.admin.get("/api/admin/users?sort=username&perPage=2&page=1").json
        second = self.admin.get("/api/admin/users?sort=username&perPage=2&page=2").json
        self.assertEqual(first["pagination"], {"page": 1, "perPage": 2, "total": 6, "totalPages": 3})
        self.assertEqual([user["id"] for user in first["users"] + second["users"]], [1, 2, 3, 4])

    def test_invalid_filters_and_page_limits(self):
        for query in ["page=0", "page=abc", "perPage=101", "role=user", "status=all", "sort=secret", "page=" + "9" * 30]:
            with self.subTest(query=query):
                self.assertEqual(self.admin.get(f"/api/admin/users?{query}").status_code, 400)

    def test_admin_summary_contains_only_safe_fields(self):
        payload = self.admin.get("/api/admin/users/4").json["user"]
        self.assertEqual(set(payload), {"id", "username", "email", "role", "isActive", "createdAt", "lastLoginAt"})

    def test_missing_account_is_404_for_admin(self):
        for method, suffix in [("get", ""), ("patch", "/role"), ("post", "/disable"), ("post", "/enable")]:
            response = getattr(self.admin, method)(f"/api/admin/users/9999{suffix}", json={"role": "student"})
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json["code"], "USER_NOT_FOUND")

    def test_role_disable_enable_audits_are_minimal_and_filterable(self):
        self.change(4, "teacher")
        self.admin.post("/api/admin/users/4/disable")
        self.admin.post("/api/admin/users/4/enable")
        payload = self.admin.get("/api/admin/audit-logs?actorId=1&targetId=4").json
        self.assertEqual([log["action"] for log in payload["logs"]], ["account_enabled", "account_disabled", "role_changed"])
        for log in payload["logs"]:
            self.assertEqual(set(log["actor"]), {"id", "username"})
            self.assertEqual(set(log["target"]), {"id", "username"})
            self.assertLessEqual(set(log["details"]), {"oldRole", "newRole", "oldStatus", "newStatus"})
        raw = str(payload).lower()
        for secret in ["password", "token", "session", "email", "auth_version", "traceback"]:
            self.assertNotIn(secret, raw)
        filtered = self.admin.get("/api/admin/audit-logs?action=role_changed&perPage=1").json
        self.assertEqual(filtered["pagination"]["total"], 1)

    def test_invalid_audit_filters(self):
        for query in ["actorId=-1", "targetId=abc", "action=password", "perPage=101"]:
            self.assertEqual(self.admin.get(f"/api/admin/audit-logs?{query}").status_code, 400)

    def test_cli_reuses_last_admin_version_and_audit_rules(self):
        runner = app.test_cli_runner()
        result = runner.invoke(args=["set-user-role", "person-1@example.test", "teacher"])
        self.assertNotEqual(result.exit_code, 0)
        self.login(self.client, 2)
        result = runner.invoke(args=["set-user-role", "person-2@example.test", "student"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(self.state(2)["version"], 2)
        self.assert_auth_required(self.client.get("/api/papers/manage"))
        log = self.admin.get("/api/admin/audit-logs").json["logs"][0]
        self.assertIsNone(log["actor"])
        self.assertEqual(log["details"]["newRole"], "student")

    def test_audit_failure_rolls_back_role_and_version(self):
        with patch("account_service.Session.commit", side_effect=SQLAlchemyError("test failure")):
            self.assertEqual(self.change(4, "teacher").status_code, 503)
        self.assertEqual(self.state(4)["role"], "student")
        self.assertEqual(self.state(4)["version"], 1)
        self.assertEqual(self.admin.get("/api/admin/audit-logs").json["pagination"]["total"], 0)

    def test_service_rechecks_actor_after_authorization(self):
        with app.app_context():
            db.session.get(User, 1).auth_version = 2
            db.session.commit()
            with self.assertRaises(AccountError) as error:
                account_service.change_role(4, "teacher", actor_id=1, actor_version=1)
            self.assertEqual(error.exception.status, 401)

    def test_teacher_ownership_and_admin_papers_access(self):
        self.login(self.client, 2)
        for suffix in ["", "/preview", "/attachments"]:
            self.assertEqual(self.client.get(f"/api/papers/manage/1{suffix}").status_code, 200)
            self.assertEqual(self.client.get(f"/api/papers/manage/2{suffix}").status_code, 403)
            self.assertEqual(self.admin.get(f"/api/papers/manage/2{suffix}").status_code, 200)
        self.assertEqual(self.client.patch("/api/papers/1", json={"title": "Updated"}).status_code, 200)
        self.assertEqual(self.client.patch("/api/papers/2", json={"title": "Blocked"}).status_code, 403)
        self.assertEqual(self.client.post("/api/papers/1/archive").status_code, 200)
        self.assertEqual(self.client.post("/api/papers/2/archive").status_code, 403)

    def test_chat_authentication_contract_survives_revocation(self):
        self.login(self.client)
        self.admin.post("/api/admin/users/4/disable")
        response = self.client.post("/api/chat", json={"message": "hello"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json["code"], "AUTH_REQUIRED")
        self.assertIn("login_url", response.json)

    def test_auth_and_admin_responses_are_not_cacheable(self):
        for url in ["/api/auth/me", "/api/admin/users", "/api/admin/audit-logs"]:
            response = self.admin.get(url)
            self.assertIn("no-store", response.headers["Cache-Control"])
            self.assertIn("Cookie", response.headers["Vary"])


class AccountTransactionTests(unittest.TestCase):
    def run_concurrent_admin_change(self, operation):
        with tempfile.TemporaryDirectory(prefix="account-concurrency-") as directory:
            engine = create_engine(f"sqlite:///{Path(directory, 'accounts.db').as_posix()}",
                                   connect_args={"timeout": 10})
            try:
                db.metadata.create_all(engine)
                with Session(engine) as transaction:
                    for uid in (1, 2):
                        transaction.add(User(id=uid, username=f"Admin {uid}", email=f"admin-{uid}@example.test",
                                             password_hash=PASSWORD_HASH, role="admin", is_active=True, auth_version=1))
                    transaction.commit()
                service = AccountService(SimpleNamespace(engine=engine), User, AccountAuditLog)
                barrier = Barrier(2)

                def change(uid):
                    barrier.wait(timeout=10)
                    try:
                        if operation == "role":
                            service.change_role(uid, "teacher", actor_id=uid, actor_version=1)
                        else:
                            service.disable_user(uid, actor_id=uid, actor_version=1)
                        return 200
                    except AccountError as error:
                        return error.status

                with ThreadPoolExecutor(max_workers=2) as executor:
                    futures = [executor.submit(change, uid) for uid in (1, 2)]
                    self.assertEqual(sorted(future.result(timeout=15) for future in futures), [200, 409])
                with Session(engine) as transaction:
                    count = transaction.scalar(select(func.count()).select_from(User).where(
                        User.role == "admin", User.is_active.is_(True)))
                    self.assertEqual(count, 1)
                    self.assertEqual(transaction.scalar(select(func.count()).select_from(AccountAuditLog)), 1)
            finally:
                engine.dispose()

    def test_concurrent_self_demotions_keep_one_active_admin(self):
        self.run_concurrent_admin_change("role")

    def test_concurrent_self_disables_keep_one_active_admin(self):
        self.run_concurrent_admin_change("disable")


class AccountMigrationTests(unittest.TestCase):
    def test_old_users_passwords_roles_and_paper_ownership_survive_upgrade_and_downgrade(self):
        project_dir = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="account-migration-") as directory:
            database = Path(directory, "legacy.db")
            environment = {**os.environ, "DATABASE_URL": f"sqlite:///{database.as_posix()}", "FLASK_APP": "app"}

            def migrate(direction, target):
                result = subprocess.run([sys.executable, "-m", "flask", "db", direction, target],
                                        cwd=project_dir, env=environment, capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

            migrate("upgrade", "6a3f4c2d91e0")
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("PRAGMA foreign_keys=ON")
                for uid, role in [(1, "user"), (2, "teacher"), (3, "admin")]:
                    connection.execute("INSERT INTO user (id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                                       (uid, f"Legacy {uid}", f"legacy-{uid}@example.test", "existing-password-hash", role, "2026-01-01"))
                connection.execute("INSERT INTO papers (id, slug, title, authors, publication_type, topics, difficulty, estimated_reading_minutes, abstract, learning_objectives, keywords, featured, open_access, resource_category, status, created_by_id, created_at, updated_at) VALUES (1, 'legacy-paper', 'Legacy Paper', '[\"Author\"]', 'Research Article', '[\"Memory\"]', 'Beginner', 10, 'Abstract', '[\"Learn\"]', '[]', 0, 0, 'Foundational', 'draft', 2, '2026-01-01', '2026-01-01')")
                connection.commit()
                original = connection.execute("SELECT id, username, email, password_hash, role, created_at FROM user ORDER BY id").fetchall()
            migrate("upgrade", "head")
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT id, username, email, password_hash, role, created_at FROM user ORDER BY id").fetchall(), original)
                self.assertEqual(connection.execute("SELECT is_active, auth_version, disabled_at, last_login_at FROM user").fetchall(), [(1, 1, None, None)] * 3)
                self.assertEqual(connection.execute("SELECT created_by_id FROM papers WHERE id=1").fetchone()[0], 2)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM account_audit_logs").fetchone()[0], 0)
                self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            migrate("downgrade", "6a3f4c2d91e0")
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT id, username, email, password_hash, role, created_at FROM user ORDER BY id").fetchall(), original)
                self.assertEqual(connection.execute("SELECT created_by_id FROM papers WHERE id=1").fetchone()[0], 2)
                self.assertNotIn("auth_version", {row[1] for row in connection.execute("PRAGMA table_info(user)")})
                self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
