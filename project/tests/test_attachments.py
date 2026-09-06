"""Attachment API tests with isolated storage and generated fixtures."""
import hashlib
from io import BytesIO
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
from app import app, db, User, Paper, PaperAttachment, AttachmentFileCleanup
from attachment_files import FILE_LIMITS, FORMATS
from storage import LocalAttachmentStorage
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError


def pdf(label="fixture"):
    output = b"%PDF-1.4\n%" + label.encode() + b"\n"
    offsets = []
    for number, obj in enumerate([
        b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
    ], 1):
        offsets.append(len(output))
        output += str(number).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
    start = len(output)
    output += b"xref\n0 4\n0000000000 65535 f \n"
    output += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    return output + f"trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode()


def png():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b""))


def office(kind="document", label="fixture", extras=None):
    document = kind == "document"
    main = "word/document.xml" if document else "ppt/presentation.xml"
    namespace = ("http://schemas.openxmlformats.org/wordprocessingml/2006/main" if document
                 else "http://schemas.openxmlformats.org/presentationml/2006/main")
    tag = "document" if document else "presentation"
    content_type = ("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" if document
                    else "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")
    stream = BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                         f'<Override PartName="/{main}" ContentType="{content_type}"/></Types>')
        archive.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                         '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                         f'Target="{main}"/></Relationships>')
        archive.writestr(main, f'<{tag} xmlns="{namespace}"><!-- {label} --></{tag}>')
        for name, data in (extras or {}).items():
            archive.writestr(name, data)
    return stream.getvalue()


class AttachmentTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        with app.app_context():
            db.session.remove()
            db.engine.dispose()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="attachment-test-")
        self.backend = LocalAttachmentStorage(self.temp.name)
        app.config.update(TESTING=True, SECRET_KEY="isolated-test-session-key", MAX_CONTENT_LENGTH=64 * 1024 * 1024,
                          ATTACHMENT_UPLOAD_ROOT=self.temp.name, ATTACHMENT_FILE_LIMITS=dict(FILE_LIMITS))
        app.extensions["attachment_storage"] = self.backend
        self.client = app.test_client()
        with app.app_context():
            self.assertEqual(db.engine.url.database, ":memory:")
            self.assertEqual(db.session.execute(text("PRAGMA foreign_keys")).scalar(), 1)
            db.create_all()
            for uid, role in [(1, "teacher"), (2, "teacher"), (3, "admin"), (4, "user")]:
                user = User(id=uid, username=f"fixture-{uid}", email=f"fixture-{uid}@example.test", role=role)
                user.set_password("test-only-password")
                db.session.add(user)
            db.session.flush()
            for pid, owner, status in [(1, 1, "published"), (2, 2, "published"), (3, 1, "draft"), (4, 1, "archived")]:
                db.session.add(Paper(id=pid, slug=f"paper-{pid}", title="Fixture Paper", authors=["Fixture"],
                                     publication_type="Research Article", topics=["Memory"], difficulty="Beginner",
                                     estimated_reading_minutes=5, abstract="Fixture abstract", learning_objectives=[],
                                     keywords=[], resource_category="Foundational", status=status, created_by_id=owner,
                                     external_url="https://example.test/canonical"))
            db.session.commit()

    def tearDown(self):
        with app.app_context():
            db.session.remove()
            db.drop_all()
            db.session.execute(text("DROP TABLE IF EXISTS alembic_version"))
            db.session.commit()
        app.extensions.pop("attachment_storage", None)
        self.temp.cleanup()

    def login(self, uid=1):
        with self.client.session_transaction() as session:
            session.clear()
            if uid is not None:
                session["_user_id"] = str(uid)
                session["_fresh"] = True

    def upload(self, paper_id=1, kind="pdf", data=None, filename=None, mime=None, method="post", attachment_id=None, **fields):
        ext = {"pdf": "pdf", "cover": "png", "slides": "pptx", "document": "docx"}[kind]
        if data is None:
            data = pdf() if kind == "pdf" else png() if kind == "cover" else office(kind)
        payload = {"attachmentType": kind, "displayName": "Test resource", **fields,
                   "file": (BytesIO(data), filename or f"fixture.{ext}", mime or FORMATS[kind][ext])}
        url = f"/api/papers/{paper_id}/attachments"
        if attachment_id is not None:
            url += f"/{attachment_id}"
        response = getattr(self.client, method)(url, data=payload, content_type="multipart/form-data")
        # Werkzeug may spool a large test request body even when Flask rejects it.
        response.request.environ["wsgi.input"].close()
        return response

    def create(self, **kwargs):
        self.login()
        response = self.upload(**kwargs)
        self.assertEqual(response.status_code, 201, response.json)
        return response.json["attachment"]

    def link(self, **fields):
        return self.client.post("/api/papers/1/attachments/link", json={
            "attachmentType": "external_link", "displayName": "Extra resource",
            "externalUrl": "https://example.test/resource", **fields})

    def download(self, item, uid=None, paper_id=1, suffix=""):
        self.login(uid)
        response = self.client.get(f"/api/papers/paper-{paper_id}/attachments/{item['id']}/download{suffix}")
        response.get_data()
        response.close()
        return response

    def snapshot(self, attachment_id):
        with app.app_context():
            item = db.session.get(PaperAttachment, attachment_id)
            return {"key": item.storage_key, "version": item.version, "sha": item.sha256} if item else None

    def files(self):
        return sorted(path for path in Path(self.temp.name).rglob("*") if path.is_file())

    def assert_error(self, response, status, code=None):
        self.assertEqual(response.status_code, status, response.get_data(as_text=True))
        self.assertTrue(response.is_json)
        self.assertIn("error", response.json)
        if code:
            self.assertEqual(response.json["code"], code)
        for forbidden in [self.temp.name, "Traceback", "SQLAlchemy", "storage_key"]:
            self.assertNotIn(forbidden, response.get_data(as_text=True))

    def test_anonymous_upload_401(self):
        self.assert_error(self.upload(), 401, "AUTH_REQUIRED")

    def test_user_upload_403(self):
        self.login(4)
        self.assert_error(self.upload(), 403)

    def test_teacher_own_upload(self):
        self.assertEqual(self.create()["uploadedBy"]["role"], "teacher")

    def test_teacher_other_upload_403(self):
        self.login()
        self.assert_error(self.upload(paper_id=2), 403, "PAPER_EDIT_FORBIDDEN")
        self.assertFalse(self.files())

    def test_admin_any_upload(self):
        self.login(3)
        self.assertEqual(self.upload(paper_id=2).status_code, 201)

    def test_missing_paper(self):
        self.login()
        self.assert_error(self.upload(paper_id=999), 404, "PAPER_NOT_FOUND")

    def test_pdf_sha_and_metadata(self):
        item = self.create(description="Description", sortOrder="7")
        self.assertEqual(item["sha256"], hashlib.sha256(pdf()).hexdigest())
        self.assertEqual(item["fileSize"], len(pdf()))
        self.assertEqual(item["sortOrder"], 7)
        self.assertEqual(item["version"], 1)

    def test_fake_pdf_text(self):
        self.login()
        self.assert_error(self.upload(data=b"plain text"), 400, "INVALID_FILE_CONTENT")

    def test_executable_renamed_pdf(self):
        self.login()
        self.assert_error(self.upload(data=b"MZ" + b"\0" * 64), 400, "INVALID_FILE_CONTENT")

    def test_valid_png(self):
        self.assertEqual(self.create(kind="cover")["mimeType"], "image/png")

    def test_office_formats(self):
        self.login()
        for kind in ["slides", "document"]:
            with self.subTest(kind=kind):
                self.assertEqual(self.upload(kind=kind).status_code, 201)

    def test_forbidden_extensions(self):
        self.login()
        for ext in ["doc", "ppt", "exe", "js", "html", "svg", "zip", "rar", "7z", "bat", "cmd", "ps1", "scr", "dll"]:
            with self.subTest(ext=ext):
                self.assert_error(self.upload(filename=f"fixture.{ext}"), 400, "FILE_TYPE_NOT_ALLOWED")

    def test_mime_mismatch(self):
        self.login()
        self.assert_error(self.upload(mime="text/html"), 400, "FILE_TYPE_NOT_ALLOWED")

    def test_bad_image_signatures(self):
        self.login()
        for ext in FORMATS["cover"]:
            with self.subTest(ext=ext):
                self.assert_error(self.upload(kind="cover", filename=f"fake.{ext}", mime=FORMATS["cover"][ext], data=b"not image"),
                                  400, "INVALID_FILE_CONTENT")

    def test_invalid_office_containers(self):
        self.login()
        for data in [b"PK not a zip", office("slides"), office(extras={"../evil": b"bad"}),
                     office(extras={"word/vbaProject.bin": b"macro"}), office(extras={"word/bomb": b"a" * 200000})]:
            with self.subTest(size=len(data)):
                self.assert_error(self.upload(kind="document", data=data), 400, "INVALID_FILE_CONTENT")

    def test_office_requires_package_structure(self):
        self.login()
        stream = BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("word/document.xml", "<document/>")
        self.assert_error(self.upload(kind="document", data=stream.getvalue()), 400, "INVALID_FILE_CONTENT")

    def test_type_size_limits(self):
        self.login()
        for kind in FILE_LIMITS:
            with self.subTest(kind=kind):
                app.config["ATTACHMENT_FILE_LIMITS"] = {**FILE_LIMITS, kind: 16}
                self.assert_error(self.upload(kind=kind), 413, "FILE_TOO_LARGE")
        self.assertFalse(self.files())

    def test_request_hard_limit_json(self):
        self.login()
        app.config["MAX_CONTENT_LENGTH"] = 128
        self.assert_error(self.upload(), 413, "FILE_TOO_LARGE")

    def test_duplicate_sha_different_filename(self):
        self.create()
        self.assert_error(self.upload(filename="renamed.pdf"), 409, "DUPLICATE_ATTACHMENT")
        self.assertEqual(len(self.files()), 1)

    def test_same_sha_allowed_on_different_paper(self):
        self.create()
        self.login(3)
        self.assertEqual(self.upload(paper_id=2).status_code, 201)

    def test_single_pdf_and_cover(self):
        self.create()
        self.assert_error(self.upload(data=pdf("second")), 409, "PRIMARY_ATTACHMENT_EXISTS")
        self.assertEqual(self.upload(kind="cover").status_code, 201)
        self.assert_error(self.upload(kind="cover", data=png() + b"different"), 409, "PRIMARY_ATTACHMENT_EXISTS")

    def test_multiple_documents_slides_and_links(self):
        self.login()
        for kind in ["document", "slides"]:
            for label in ["one", "two"]:
                self.assertEqual(self.upload(kind=kind, data=office(kind, label)).status_code, 201)
        self.assertEqual(self.link().status_code, 201)
        self.assertEqual(self.link(externalUrl="https://example.test/another").status_code, 201)

    def test_anonymous_public_download_and_headers(self):
        item = self.create()
        response = self.download(item)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, pdf())
        self.assertTrue(response.headers["Content-Disposition"].startswith("inline;"))
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertIn("Cookie", response.headers["Vary"])

    def test_authenticated_download_anonymous_401(self):
        self.assert_error(self.download(self.create(accessLevel="authenticated")), 401, "AUTH_REQUIRED")

    def test_authenticated_download_user_success(self):
        self.assertEqual(self.download(self.create(accessLevel="authenticated"), 4).status_code, 200)

    def test_staff_download_user_403(self):
        self.assert_error(self.download(self.create(accessLevel="staff"), 4), 403, "ATTACHMENT_ACCESS_DENIED")

    def test_staff_download_teacher_admin(self):
        item = self.create(accessLevel="staff")
        for uid in [1, 2, 3]:
            with self.subTest(uid=uid):
                self.assertEqual(self.download(item, uid).status_code, 200)

    def test_staff_download_anonymous_401(self):
        self.assert_error(self.download(self.create(accessLevel="staff")), 401)

    def test_draft_and_archived_not_public(self):
        for pid in [3, 4]:
            item = self.create(paper_id=pid)
            for uid in [None, 1, 3]:
                with self.subTest(paper=pid, uid=uid):
                    self.login(uid)
                    self.assert_error(self.client.get(f"/api/papers/paper-{pid}/attachments"), 404, "PAPER_NOT_FOUND")
                    self.assert_error(self.download(item, uid, paper_id=pid), 404, "PAPER_NOT_FOUND")

    def test_download_wrong_paper_and_missing_attachment(self):
        item = self.create()
        self.assert_error(self.download(item, paper_id=2), 404, "ATTACHMENT_NOT_FOUND")
        self.assert_error(self.download({"id": 999}), 404, "ATTACHMENT_NOT_FOUND")

    def test_dispositions(self):
        item = self.create()
        self.assertTrue(self.download(item, suffix="?download=1").headers["Content-Disposition"].startswith("attachment;"))
        for kind in ["document", "slides"]:
            item = self.create(kind=kind)
            self.assertTrue(self.download(item).headers["Content-Disposition"].startswith("attachment;"))

    def test_filename_cannot_escape_or_inject_headers(self):
        item = self.create(filename="../../evil.pdf")
        key = self.snapshot(item["id"])["key"]
        self.assertRegex(key, r"^papers/1/[a-f0-9]{32}\.pdf$")
        self.assertEqual(item["originalFilename"], "evil.pdf")
        with app.app_context():
            db.session.get(PaperAttachment, item["id"]).original_filename = "..\\中文\r\nInjected:yes.pdf"
            db.session.commit()
        response = self.download(item)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Injected", response.headers.keys())
        self.assertNotIn("\r", response.headers["Content-Disposition"])
        self.assertNotIn("\n", response.headers["Content-Disposition"])

    def test_storage_rejects_untrusted_keys(self):
        for key in ["../../evil.pdf", "C:/evil.pdf", "/tmp/evil.pdf", "papers/1/../evil.pdf", "papers\\1\\evil.pdf"]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.backend.build_storage_path(key)

    def test_static_upload_url_not_served(self):
        item = self.create()
        key = self.snapshot(item["id"])["key"]
        self.login(None)
        self.assertEqual(self.client.get("/uploads/" + key).status_code, 404)

    def test_replace_stable_url_version_and_old_file_cleanup(self):
        item = self.create()
        old_key = self.snapshot(item["id"])["key"]
        response = self.upload(method="put", attachment_id=item["id"], data=pdf("replacement"))
        self.assertEqual(response.status_code, 200, response.json)
        updated = response.json["attachment"]
        self.assertEqual(updated["id"], item["id"])
        self.assertEqual(updated["downloadUrl"], item["downloadUrl"])
        self.assertEqual(updated["version"], 2)
        self.assertFalse(self.backend.build_storage_path(old_key).exists())
        self.assertEqual(self.download(item).data, pdf("replacement"))

    def test_invalid_replacement_preserves_old(self):
        item = self.create()
        self.assert_error(self.upload(method="put", attachment_id=item["id"], data=b"invalid"), 400)
        self.assertEqual(self.snapshot(item["id"])["version"], 1)
        self.assertEqual(self.download(item).data, pdf())

    def test_disk_save_failure_preserves_old(self):
        item = self.create()
        with patch.object(self.backend, "replace_file", side_effect=OSError("private path")):
            self.assert_error(self.upload(method="put", attachment_id=item["id"], data=pdf("replacement")), 500)
        self.assertEqual(len(self.files()), 1)
        self.assertEqual(self.download(item).data, pdf())

    def test_replace_database_failure_removes_new_preserves_old(self):
        item = self.create()
        with patch.object(db.session, "commit", side_effect=SQLAlchemyError("private SQL")):
            self.assert_error(self.upload(method="put", attachment_id=item["id"], data=pdf("replacement")), 500)
        self.assertEqual(len(self.files()), 1)
        self.assertEqual(self.snapshot(item["id"])["version"], 1)
        self.assertEqual(self.download(item).data, pdf())

    def test_upload_database_failure_removes_new(self):
        self.login()
        with patch.object(db.session, "commit", side_effect=SQLAlchemyError("private SQL")):
            self.assert_error(self.upload(), 500)
        self.assertFalse(self.files())

    def test_replace_cleanup_failure_durable_retry(self):
        item = self.create()
        old_key = self.snapshot(item["id"])["key"]
        with patch.object(self.backend, "delete_file", side_effect=PermissionError("busy")):
            response = self.upload(method="put", attachment_id=item["id"], data=pdf("replacement"))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["cleanupPending"])
        with app.app_context():
            self.assertIsNotNone(db.session.get(AttachmentFileCleanup, old_key))
        self.assertEqual(self.download(item).data, pdf("replacement"))
        result = app.test_cli_runner().invoke(args=["cleanup-attachment-files"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertFalse(self.backend.build_storage_path(old_key).exists())

    def test_replace_cannot_change_type_or_duplicate_document(self):
        first = self.create(kind="document", data=office(label="one"))
        self.create(kind="document", data=office(label="two"))
        self.assert_error(self.upload(kind="document", method="put", attachment_id=first["id"], data=office(label="two")), 409)
        self.assert_error(self.upload(method="put", attachment_id=first["id"]), 400)

    def test_replace_requires_ownership(self):
        item = self.create()
        self.login(2)
        self.assert_error(self.upload(method="put", attachment_id=item["id"], data=pdf("other")), 403)

    def test_delete_removes_row_and_file(self):
        item = self.create()
        response = self.client.delete(f"/api/papers/1/attachments/{item['id']}")
        self.assertEqual(response.json, {"deleted": True, "attachmentId": item["id"]})
        self.assertIsNone(self.snapshot(item["id"]))
        self.assertFalse(self.files())

    def test_teacher_cannot_delete_others(self):
        item = self.create()
        self.login(2)
        self.assert_error(self.client.delete(f"/api/papers/1/attachments/{item['id']}"), 403)
        self.assertEqual(len(self.files()), 1)

    def test_admin_can_delete_any(self):
        item = self.create()
        self.login(3)
        self.assertEqual(self.client.delete(f"/api/papers/1/attachments/{item['id']}").status_code, 200)
        self.assertFalse(self.files())

    def test_missing_disk_file_download_and_delete(self):
        item = self.create()
        self.backend.delete_file(self.snapshot(item["id"])["key"])
        with self.assertLogs(app.logger, level="WARNING"):
            self.assert_error(self.download(item), 404, "ATTACHMENT_NOT_FOUND")
        self.login()
        with self.assertLogs(app.logger, level="WARNING"):
            self.assertEqual(self.client.delete(f"/api/papers/1/attachments/{item['id']}").status_code, 200)
        self.assertIsNone(self.snapshot(item["id"]))

    def test_delete_database_failure_keeps_file_and_row(self):
        item = self.create()
        with patch.object(db.session, "commit", side_effect=SQLAlchemyError("failure")):
            self.assert_error(self.client.delete(f"/api/papers/1/attachments/{item['id']}"), 500)
        self.assertIsNotNone(self.snapshot(item["id"]))
        self.assertEqual(self.download(item).data, pdf())

    def test_delete_cleanup_failure_keeps_retry_job(self):
        item = self.create()
        with patch.object(self.backend, "delete_file", side_effect=PermissionError("busy")):
            response = self.client.delete(f"/api/papers/1/attachments/{item['id']}")
            self.assertTrue(response.json["cleanupPending"])
            self.assertNotEqual(app.test_cli_runner().invoke(args=["cleanup-attachment-files"]).exit_code, 0)
        self.assertIsNone(self.snapshot(item["id"]))
        self.assertEqual(app.test_cli_runner().invoke(args=["cleanup-attachment-files"]).exit_code, 0)
        self.assertFalse(self.files())

    def test_paper_delete_cleans_all_attachments(self):
        self.create()
        self.create(kind="cover")
        self.create(kind="document")
        self.link()
        self.login(3)
        response = self.client.delete("/api/papers/1")
        self.assertEqual(response.json, {"deleted": True, "paperId": 1})
        with app.app_context():
            self.assertIsNone(db.session.get(Paper, 1))
            self.assertEqual(PaperAttachment.query.count(), 0)
            self.assertEqual(AttachmentFileCleanup.query.count(), 0)
        self.assertFalse(self.files())

    def test_paper_delete_failure_preserves_files(self):
        item = self.create()
        self.login(3)
        with patch.object(db.session, "commit", side_effect=SQLAlchemyError("failure")):
            self.assert_error(self.client.delete("/api/papers/1"), 500)
        self.assertEqual(self.download(item).data, pdf())

    def test_paper_delete_cleanup_failure_retry_after_paper_gone(self):
        self.create()
        self.login(3)
        with patch.object(self.backend, "delete_file", side_effect=PermissionError("busy")):
            response = self.client.delete("/api/papers/1")
        self.assertTrue(response.json["cleanupPending"])
        with app.app_context():
            self.assertIsNone(db.session.get(Paper, 1))
            self.assertEqual(AttachmentFileCleanup.query.count(), 1)
        self.assertEqual(app.test_cli_runner().invoke(args=["cleanup-attachment-files"]).exit_code, 0)
        self.assertFalse(self.files())

    def test_teacher_still_cannot_delete_paper(self):
        self.create()
        self.assert_error(self.client.delete("/api/papers/1"), 403)
        self.assertEqual(len(self.files()), 1)

    def test_link_http_and_https(self):
        self.login()
        for scheme in ["http", "https"]:
            self.assertEqual(self.link(externalUrl=f"{scheme}://example.test/resource").status_code, 201)
        self.assertFalse(self.files())

    def test_link_disallowed_schemes_and_malformed_urls(self):
        self.login()
        for url in ["javascript:alert(1)", "file:///private/file", "data:text/html,bad", "ftp://example.test", "//example.test",
                    "https://", "https://example.test:bad", "https://example.test\r\nX:bad", "https://user:password@example.test", "https://[broken"]:
            with self.subTest(url=url):
                self.assert_error(self.link(externalUrl=url), 400, "VALIDATION_ERROR")

    def test_external_link_does_not_proxy(self):
        self.login()
        item = self.link().json["attachment"]
        self.assertIsNone(item["downloadUrl"])
        self.assert_error(self.download(item), 400, "ATTACHMENT_NOT_DOWNLOADABLE")

    def test_external_link_replace_and_delete(self):
        self.login()
        item = self.link().json["attachment"]
        response = self.client.put(f"/api/papers/1/attachments/{item['id']}", json={"externalUrl": "https://example.test/new"})
        self.assertEqual(response.json["attachment"]["id"], item["id"])
        self.assertEqual(response.json["attachment"]["version"], 2)
        self.assertEqual(self.client.delete(f"/api/papers/1/attachments/{item['id']}").status_code, 200)

    def test_management_list_ownership_levels_sort_and_privacy(self):
        self.login()
        for level, order in [("staff", 2), ("public", 0), ("authenticated", 1)]:
            self.assertEqual(self.link(accessLevel=level, sortOrder=order).status_code, 201)
        response = self.client.get("/api/papers/manage/1/attachments")
        self.assertEqual([item["accessLevel"] for item in response.json["attachments"]], ["public", "authenticated", "staff"])
        self.assertNotIn("email", response.get_data(as_text=True))
        self.login(2)
        self.assert_error(self.client.get("/api/papers/manage/1/attachments"), 403)
        self.login(3)
        self.assertEqual(len(self.client.get("/api/papers/manage/1/attachments").json["attachments"]), 3)

    def test_public_visibility_and_privacy(self):
        self.create()
        for level in ["public", "authenticated", "staff"]:
            self.link(accessLevel=level)
        for uid, count in [(None, 2), (4, 3), (1, 3), (3, 3)]:
            with self.subTest(uid=uid):
                self.login(uid)
                response = self.client.get("/api/papers/paper-1/attachments")
                self.assertEqual(len(response.json["attachments"]), count)
                raw = response.get_data(as_text=True)
                for forbidden in ["storage_key", "storageKey", self.temp.name, "email", "password", "uploadedBy", "sha256"]:
                    self.assertNotIn(forbidden, raw)
                self.assertIn("no-store", response.headers["Cache-Control"])

    def test_invalid_metadata_and_no_mass_assignment(self):
        self.login()
        for fields in [{"displayName": ""}, {"displayName": "x" * 301}, {"description": "x" * 1001},
                       {"accessLevel": "admin"}, {"sortOrder": "1.5"}, {"sortOrder": "2147483648"},
                       {"storage_key": "evil"}, {"uploadedById": 3}]:
            with self.subTest(fields=list(fields)):
                self.assert_error(self.upload(**fields), 400, "VALIDATION_ERROR")
        for body in [[], None, {"attachmentType": []}]:
            self.assert_error(self.client.post("/api/papers/1/attachments/link", json=body), 400)
        self.assertFalse(self.files())

    def test_no_file_or_wrong_request_type(self):
        self.login()
        self.assert_error(self.client.post("/api/papers/1/attachments", json={}), 400)
        self.assert_error(self.client.post("/api/papers/1/attachments", data={"displayName": "none"}, content_type="multipart/form-data"), 400)

    def test_managed_routes_anonymous_and_user_denied(self):
        item = self.create()
        for uid, status in [(None, 401), (4, 403)]:
            self.login(uid)
            self.assert_error(self.client.get("/api/papers/manage/1/attachments"), status)
            self.assert_error(self.link(), status)
            self.assert_error(self.upload(method="put", attachment_id=item["id"]), status)
            self.assert_error(self.client.delete(f"/api/papers/1/attachments/{item['id']}"), status)

    def test_database_constraints_prevent_parallel_primary_and_sha_duplicates(self):
        item = self.create()
        with app.app_context():
            original = db.session.get(PaperAttachment, item["id"])
            fields = {column.name: getattr(original, column.name) for column in PaperAttachment.__table__.columns
                      if column.name not in {"id", "storage_key"}}
            for sha in [original.sha256, "a" * 64]:
                db.session.add(PaperAttachment(**{**fields, "sha256": sha, "storage_key": "papers/1/" + "b" * 32 + ".pdf"}))
                with self.assertRaises(IntegrityError):
                    db.session.commit()
                db.session.rollback()

    def test_optimistic_version_rejects_stale_update(self):
        item = self.create()
        with app.app_context(), Session(db.engine) as first, Session(db.engine) as second:
            a = first.get(PaperAttachment, item["id"])
            b = second.get(PaperAttachment, item["id"])
            a.version += 1
            first.commit()
            b.version += 1
            with self.assertRaises(StaleDataError):
                second.commit()
            second.rollback()

    def test_existing_auth_brain_papers_and_chat_contracts(self):
        self.assertEqual(self.client.get("/api/auth/me").json["authenticated"], False)
        response = self.client.post("/api/auth/login", json={"email": "fixture-1@example.test", "password": "test-only-password"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me").json["user"]["role"], "teacher")
        self.assertEqual(self.client.get("/api/brain-regions").status_code, 200)
        self.assertEqual(self.client.get("/api/brain-regions/frontal-lobe").status_code, 200)
        self.assertEqual(len(self.client.get("/api/papers").json["papers"]), 2)
        detail = self.client.get("/api/papers/paper-1").json["paper"]
        self.assertEqual(detail["externalUrl"], "https://example.test/canonical")
        self.assertNotIn("attachments", detail)
        self.assertEqual(self.client.get("/api/papers/manage/1").status_code, 200)
        self.assertEqual(self.client.get("/api/papers/manage/2").status_code, 403)
        with patch("app.generate_tutor_reply", return_value="Fixture reply"):
            self.assertEqual(self.client.post("/api/chat", json={"message": "Explain memory"}).json, {"reply": "Fixture reply"})
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 200)
        self.assertEqual(self.client.post("/api/chat", json={"message": "Explain memory"}).status_code, 401)

    def test_existing_paper_edit_archive_republish(self):
        self.create()
        self.assertEqual(self.client.patch("/api/papers/1", json={"title": "Updated fixture"}).status_code, 200)
        self.assertEqual(self.client.post("/api/papers/1/archive").status_code, 200)
        self.assert_error(self.client.get("/api/papers/paper-1/attachments"), 404)
        self.assertEqual(self.client.patch("/api/papers/1", json={"status": "published"}).status_code, 200)
        self.assertEqual(len(self.client.get("/api/papers/paper-1/attachments").json["attachments"]), 1)

    def test_valid_jpeg_webp(self):
        import base64
        jpeg = base64.b64decode(
            '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////'
            '2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB'
            '/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ/'
            '/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ/'
            '/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAA'
            'AAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==')
        webp = base64.b64decode('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA')
        for ext, content in [("jpg", jpeg), ("jpeg", jpeg), ("webp", webp)]:
            with self.subTest(ext=ext):
                item = self.create(kind="cover", filename=f"fixture.{ext}", data=content, mime=FORMATS["cover"][ext])
                self.assertEqual(self.client.delete(f"/api/papers/1/attachments/{item['id']}").status_code, 200)


    def test_deleted_url_never_reused(self):
        old = self.create()
        self.client.delete(f"/api/papers/1/attachments/{old['id']}")
        new = self.create(data=pdf("new"))
        self.assertNotEqual(old["id"], new["id"])
        self.assert_error(self.download(old), 404)

    def test_storage_uuid_collision_keeps_existing_file(self):
        from types import SimpleNamespace
        item = self.create()
        key = self.snapshot(item["id"])["key"]
        fixed_uuid = key.rsplit("/", 1)[-1].split(".")[0]
        with patch("storage.uuid4", return_value=SimpleNamespace(hex=fixed_uuid)):
            with self.assertRaises(FileExistsError):
                self.backend.save_file(BytesIO(pdf("other")), 1, "pdf")
        self.assertEqual(self.download(item).data, pdf())

    def test_partial_write_failure_cleans_file(self):
        stream = BytesIO(pdf())
        with patch.object(stream, "read", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                self.backend.save_file(stream, 1, "pdf")
        self.assertFalse(self.files())

    def test_real_default_cover_limit(self):
        self.login()
        self.assertEqual(FILE_LIMITS, {"pdf": 50 * 1024**2, "cover": 8 * 1024**2,
                                      "slides": 50 * 1024**2, "document": 30 * 1024**2})
        self.assert_error(self.upload(kind="cover", data=png() + b"x" * FILE_LIMITS["cover"]), 413, "FILE_TOO_LARGE")
        self.assertFalse(self.files())

    def test_real_migration_roundtrip(self):
        from flask_migrate import upgrade, downgrade
        from sqlalchemy import inspect
        migrations = str(Path(__file__).resolve().parents[1] / "migrations")
        with app.app_context():
            db.drop_all()
            upgrade(directory=migrations)
            inspector = inspect(db.engine)
            self.assertIn("paper_attachments", inspector.get_table_names())
            self.assertEqual(len(inspector.get_foreign_keys("paper_attachments")), 2)
            self.assertIn("uq_attachment_primary", {item["name"] for item in inspector.get_indexes("paper_attachments")})
            self.assertEqual(db.session.execute(text("SELECT version_num FROM alembic_version")).scalar(), "b78b852aa4b4")
            db.session.remove()
            downgrade(directory=migrations, revision="8cadd5a4f419")
            self.assertNotIn("paper_attachments", inspect(db.engine).get_table_names())
            upgrade(directory=migrations)

    def test_missing_attachment_replace_and_delete(self):
        self.login()
        self.assert_error(self.upload(method="put", attachment_id=999), 404, "ATTACHMENT_NOT_FOUND")
        self.assert_error(self.client.delete("/api/papers/1/attachments/999"), 404, "ATTACHMENT_NOT_FOUND")


    def test_failed_upload_rollback_cleanup_is_durable(self):
        self.login()
        real_commit = db.session.commit
        attempts = 0
        def fail_once():
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise SQLAlchemyError("temporary failure")
            return real_commit()
        with patch.object(db.session, "commit", side_effect=fail_once), patch.object(
            self.backend, "delete_file", side_effect=PermissionError("busy")
        ):
            self.assert_error(self.upload(), 500)
        with app.app_context():
            self.assertEqual(PaperAttachment.query.count(), 0)
            self.assertEqual(AttachmentFileCleanup.query.count(), 1)
        self.assertEqual(app.test_cli_runner().invoke(args=["cleanup-attachment-files"]).exit_code, 0)
        self.assertFalse(self.files())

    def test_partial_upload_cleanup_failure_is_durable(self):
        self.login()
        with patch("storage.os.fsync", side_effect=OSError("write failed")), patch.object(
            Path, "unlink", side_effect=PermissionError("busy")
        ):
            self.assert_error(self.upload(), 500)
        with app.app_context():
            self.assertEqual(PaperAttachment.query.count(), 0)
            self.assertEqual(AttachmentFileCleanup.query.count(), 1)
        self.assertEqual(app.test_cli_runner().invoke(args=["cleanup-attachment-files"]).exit_code, 0)
        self.assertFalse(self.files())


    def test_foreign_keys_enforced_for_paper_and_uploader(self):
        item = self.create()
        with app.app_context():
            original = db.session.get(PaperAttachment, item["id"])
            fields = {column.name: getattr(original, column.name) for column in PaperAttachment.__table__.columns
                      if column.name not in {"id", "storage_key"}}
            for overrides in [{"paper_id": 999}, {"uploaded_by_id": 999, "attachment_type": "document"}]:
                db.session.add(PaperAttachment(**{**fields, **overrides, "storage_key": "papers/1/" + "c" * 32 + ".pdf"}))
                with self.assertRaises(IntegrityError):
                    db.session.commit()
                db.session.rollback()


if __name__ == "__main__":
    unittest.main()
