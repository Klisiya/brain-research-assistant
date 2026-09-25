"""R1B citation metadata and managed preview regression tests."""
import os
from contextlib import closing
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from app import app, db, Paper, User


def paper_payload(**changes):
    return {
        "title": "Citation Test Paper", "authors": ["A. Author", "B. Author"],
        "year": 2025, "journal": "Test Journal", "publicationType": "Research Article",
        "topics": ["Memory"], "difficulty": "Beginner", "estimatedReadingMinutes": 10,
        "abstract": "Test abstract", "learningObjectives": ["Learn citation"], "keywords": [],
        "featured": False, "openAccess": True, "externalUrl": None,
        "resourceCategory": "Foundational", "status": "draft", **changes,
    }


class CitationPreviewTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        with app.app_context():
            db.session.remove()
            db.engine.dispose()

    def setUp(self):
        app.config.update(TESTING=True, SECRET_KEY="citation-preview-test")
        self.client = app.test_client()
        with app.app_context():
            db.create_all()
            for uid, role in ((1, "teacher"), (2, "teacher"), (3, "admin"), (4, "user")):
                user = User(id=uid, username=f"test-{uid}", email=f"test-{uid}@example.test", role=role)
                user.set_password("test-only-password")
                db.session.add(user)
            db.session.commit()

    def tearDown(self):
        with app.app_context():
            db.session.remove()
            db.drop_all()

    def login(self, uid=None):
        with self.client.session_transaction() as session:
            session.clear()
            if uid is not None:
                session["_user_id"] = str(uid)
                session["_fresh"] = True

    def create(self, **changes):
        self.login(1)
        response = self.client.post("/api/papers", json=paper_payload(**changes))
        self.assertEqual(response.status_code, 201, response.json)
        return response.json["paper"]

    def test_doi_normalization_and_metadata_roundtrip(self):
        for raw in (" 10.1038/s41586-026-12345-6 ", "doi:10.1038/s41586-026-12345-6",
                    "https://doi.org/10.1038/s41586-026-12345-6",
                    "http://doi.org/10.1038/s41586-026-12345-6"):
            with self.subTest(raw=raw):
                paper = self.create(doi=raw, volume="12", issue="Suppl 1", pages="e104221", publisher="Test Press")
                self.assertEqual(paper["doi"], "10.1038/s41586-026-12345-6")
                for field, expected in (("volume", "12"), ("issue", "Suppl 1"), ("pages", "e104221"), ("publisher", "Test Press")):
                    self.assertEqual(paper[field], expected)
                edited = self.client.patch(f"/api/papers/{paper['id']}", json={"pages": "123–138", "doi": "doi:10.1000/new"})
                self.assertEqual(edited.status_code, 200)
                self.assertEqual(edited.json["paper"]["pages"], "123–138")
                self.assertEqual(edited.json["paper"]["doi"], "10.1000/new")

    def test_invalid_doi_is_field_error_and_optional_fields_are_null(self):
        self.login(1)
        for raw in ("11.1000/test", "10.12/test", "10.1000/", "10.1000/a b", "10.1000/a\x01b", "10.1000/a\x85b", "10.1234/" + "x" * 260):
            with self.subTest(raw=raw):
                response = self.client.post("/api/papers", json=paper_payload(doi=raw))
                self.assertEqual(response.status_code, 400, response.json)
                self.assertEqual(response.json["code"], "VALIDATION_ERROR")
                self.assertEqual(response.json["field"], "doi")
        old = self.create()
        for field in ("doi", "volume", "issue", "pages", "publisher"):
            self.assertIsNone(old[field])
        managed = self.client.get(f"/api/papers/manage/{old['id']}").json["paper"]
        self.assertIsNone(managed["doi"])

    def test_preview_permissions_and_public_isolation_across_statuses(self):
        draft = self.create(doi="10.1000/draft")
        identifier, slug = draft["id"], draft["slug"]
        preview_url = f"/api/papers/manage/{identifier}/preview"
        public_url = f"/api/papers/{slug}"

        self.login()
        self.assertEqual(self.client.get(preview_url).status_code, 401)
        self.assertEqual(self.client.get(public_url).status_code, 404)
        self.login(4)
        self.assertEqual(self.client.get(preview_url).status_code, 403)
        self.login(2)
        self.assertEqual(self.client.get(preview_url).status_code, 403)
        self.assertEqual(self.client.get(public_url).status_code, 404)
        self.login(1)
        own = self.client.get(preview_url)
        self.assertEqual(own.status_code, 200)
        self.assertTrue(own.json["paper"]["preview"])
        self.assertEqual(own.json["paper"]["status"], "draft")
        self.assertNotIn("createdBy", own.json["paper"])
        self.assertEqual(own.json["paper"]["doi"], "10.1000/draft")
        self.login(3)
        self.assertEqual(self.client.get(preview_url).status_code, 200)
        self.assertEqual(self.client.get("/api/papers/manage/99999/preview").status_code, 404)

        self.login(1)
        self.assertEqual(self.client.get("/api/papers").json["pagination"]["total"], 0)
        published = self.client.patch(f"/api/papers/{identifier}", json={"status": "published"})
        self.assertEqual(published.status_code, 200)
        self.assertEqual(self.client.get(public_url).json["paper"]["doi"], "10.1000/draft")
        self.assertEqual(self.client.get(preview_url).json["paper"]["status"], "published")
        self.assertEqual(self.client.get("/api/papers").json["pagination"]["total"], 1)
        self.assertEqual(self.client.post(f"/api/papers/{identifier}/archive").status_code, 200)
        self.assertEqual(self.client.get(public_url).status_code, 404)
        self.assertEqual(self.client.get("/api/papers").json["pagination"]["total"], 0)
        self.assertEqual(self.client.get(preview_url).json["paper"]["status"], "archived")
        self.login(2)
        self.assertEqual(self.client.get(preview_url).status_code, 403)
        self.login(3)
        self.assertEqual(self.client.get(preview_url).status_code, 200)
        self.login(1)
        self.assertEqual(self.client.patch(f"/api/papers/{identifier}", json={"status": "published"}).status_code, 200)
        self.assertEqual(self.client.get(public_url).status_code, 200)

    def test_metadata_empty_values_and_limits(self):
        paper = self.create(doi="", volume=" ", issue=None, pages="", publisher=" ")
        for field in ("doi", "volume", "issue", "pages", "publisher"):
            self.assertIsNone(paper[field])
        for field, maximum in (("volume", 100), ("issue", 100), ("pages", 100), ("publisher", 300)):
            response = self.client.patch(f"/api/papers/{paper['id']}", json={field: "x" * (maximum + 1)})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json["field"], field)


class CitationMigrationTests(unittest.TestCase):
    def test_upgrade_keeps_old_paper_without_backfill_and_downgrade(self):
        project_dir = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="citation-migration-") as temporary_dir:
            database = Path(temporary_dir) / "legacy.db"
            environment = {**os.environ, "DATABASE_URL": f"sqlite:///{database.as_posix()}", "FLASK_APP": "app"}

            def migrate(target):
                result = subprocess.run([sys.executable, "-m", "flask", "db", target[0], target[1]],
                                        cwd=project_dir, env=environment, capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

            migrate(("upgrade", "b78b852aa4b4"))
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("INSERT INTO user (id, username, email, password_hash, role, created_at) VALUES (1, 'legacy', 'legacy@example.test', 'test-hash', 'teacher', '2026-01-01')")
                connection.execute("INSERT INTO papers (id, slug, title, authors, publication_type, topics, difficulty, estimated_reading_minutes, abstract, learning_objectives, keywords, featured, open_access, resource_category, status, created_by_id, created_at, updated_at) VALUES (1, 'legacy-paper', 'Legacy Paper', '[\"Legacy Author\"]', 'Research Article', '[\"Memory\"]', 'Beginner', 10, 'Legacy abstract', '[\"Study\"]', '[]', 0, 0, 'Foundational', 'draft', 1, '2026-01-01', '2026-01-01')")
                connection.commit()
            migrate(("upgrade", "head"))
            with closing(sqlite3.connect(database)) as connection:
                row = connection.execute("SELECT slug, doi, volume, issue, pages, publisher FROM papers WHERE id=1").fetchone()
                self.assertEqual(row, ("legacy-paper", None, None, None, None, None))
            migrate(("downgrade", "b78b852aa4b4"))
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT slug FROM papers WHERE id=1").fetchone()[0], "legacy-paper")


if __name__ == "__main__":
    unittest.main()
