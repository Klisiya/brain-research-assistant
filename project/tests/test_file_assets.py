"""Shared asset lifecycle regressions using real Paper relations, not fake entities."""
from io import BytesIO
from pathlib import Path
import unittest
from unittest.mock import patch
from flask import session
from flask.testing import FlaskClient
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
import test_attachments as fixtures
from app import app, db, Paper, PaperAttachment, FileAsset, AttachmentFileCleanup
from attachment_files import AttachmentError


class SharedAssetTests(unittest.TestCase):
    setUp = fixtures.AttachmentTests.setUp
    tearDown = fixtures.AttachmentTests.tearDown
    login = fixtures.AttachmentTests.login
    create = fixtures.AttachmentTests.create
    upload = fixtures.AttachmentTests.upload
    link = fixtures.AttachmentTests.link
    download = fixtures.AttachmentTests.download
    snapshot = fixtures.AttachmentTests.snapshot
    files = fixtures.AttachmentTests.files
    assert_error = fixtures.AttachmentTests.assert_error

    @classmethod
    def tearDownClass(cls):
        with app.app_context():
            db.session.remove(); db.engine.dispose()

    @property
    def service(self): return app.extensions["file_asset_service"]

    def share(self, source_id, uid=3):
        with app.test_request_context():
            session.update(_user_id=f"{uid}:1", auth_version=1, _fresh=True)
            source = db.session.get(PaperAttachment, source_id)
            target = PaperAttachment(paper_id=2, attachment_type=source.attachment_type, display_name="Shared resource",
                                     access_level="public", uploaded_by_id=uid, version=1, sort_order=0)
            self.service.bind_existing("paper", db.session.get(Paper, 2), target,
                                       source_kind="paper", source_resource=db.session.get(Paper, 1), source_relation=source)
            db.session.add(target); db.session.commit()
            return target.id

    def test_upload_creates_physical_metadata_and_relation(self):
        item = self.create()
        with app.app_context():
            relation = db.session.get(PaperAttachment, item["id"])
            asset = relation.asset
            self.assertIsNotNone(asset)
            for field in ["storage_key", "sha256", "original_filename", "mime_type", "file_size"]:
                self.assertEqual(getattr(asset, field), getattr(relation, field))
            self.assertEqual(asset.created_by_id, 1)
            self.assertNotIn("access_level", FileAsset.__table__.columns)
            self.assertNotIn("version", FileAsset.__table__.columns)
        self.assertNotIn("asset_id", item)

    def test_external_link_is_asset_variant_without_disk_file(self):
        self.login(); item = self.link().json["attachment"]
        with app.app_context():
            asset = db.session.get(PaperAttachment, item["id"]).asset
            self.assertEqual(asset.asset_type, "external_link"); self.assertIsNone(asset.storage_key)
            self.assertEqual(asset.external_url, item["externalUrl"])
        self.assertFalse(self.files())

    def test_delete_one_shared_relation_keeps_other_download(self):
        item = self.create(); other = self.share(item["id"])
        self.login(1)
        self.assertEqual(self.client.delete(f"/api/papers/1/attachments/{item['id']}").status_code, 200)
        self.assertEqual(self.download({"id": other}, paper_id=2).data, fixtures.pdf())
        with app.app_context(): self.assertEqual(FileAsset.query.count(), 1)
        self.login(2)
        self.assertEqual(self.client.delete(f"/api/papers/2/attachments/{other}").status_code, 200)
        self.assertFalse(self.files())
        with app.app_context(): self.assertEqual(FileAsset.query.count(), 0)

    def test_replacing_shared_asset_keeps_old_bytes_for_other_relation(self):
        item = self.create(); other = self.share(item["id"])
        with app.app_context(): old_asset = db.session.get(PaperAttachment, item["id"]).asset_id
        self.login(1)
        updated = self.upload(method="put", attachment_id=item["id"], data=fixtures.pdf("new"))
        self.assertEqual(updated.status_code, 200, updated.json); self.assertEqual(updated.json["attachment"]["version"], 2)
        self.assertEqual(self.download({"id": other}, paper_id=2).data, fixtures.pdf())
        self.assertEqual(self.download(item).data, fixtures.pdf("new"))
        with app.app_context():
            self.assertNotEqual(db.session.get(PaperAttachment, item["id"]).asset_id, old_asset)
            self.assertEqual(db.session.get(PaperAttachment, other).asset_id, old_asset)
            self.assertEqual(db.session.get(PaperAttachment, other).version, 1)

    def test_delete_parent_keeps_shared_asset(self):
        item = self.create(); other = self.share(item["id"])
        self.login(3); self.assertEqual(self.client.delete("/api/papers/1").status_code, 200)
        self.assertEqual(self.download({"id": other}, paper_id=2).data, fixtures.pdf())

    def test_replace_commit_failure_restores_asset_reference(self):
        item = self.create(); other = self.share(item["id"])
        with app.app_context(): old_asset = db.session.get(PaperAttachment, item["id"]).asset_id
        self.login(1)
        with patch.object(db.session, "commit", side_effect=SQLAlchemyError("fixture failure")):
            self.assert_error(self.upload(method="put", attachment_id=item["id"], data=fixtures.pdf("new")), 500)
        with app.app_context():
            self.assertEqual(FileAsset.query.count(), 1)
            self.assertEqual(db.session.get(PaperAttachment, item["id"]).asset_id, old_asset)
        self.assertEqual(len(self.files()), 1)
        self.assertEqual(self.download({"id": other}, paper_id=2).data, fixtures.pdf())

    def test_queue_refuses_even_accidentally_queued_live_asset(self):
        item = self.create(); key = self.snapshot(item["id"])["key"]
        with app.app_context():
            self.service.queue_cleanup(key); db.session.commit()
            self.assertEqual(self.service.drain_cleanup(), 1)
            self.assertTrue(self.backend.exists(key))
            self.assertIsNotNone(db.session.get(AttachmentFileCleanup, key))
        self.login(1); self.client.delete(f"/api/papers/1/attachments/{item['id']}")
        self.assertFalse(self.files())

    def test_compensation_never_deletes_referenced_file(self):
        item = self.create(); key = self.snapshot(item["id"])["key"]
        with app.app_context(): self.service.compensate([key])
        self.assertTrue(self.backend.exists(key))

    def test_fk_rejects_retirement_while_relation_exists(self):
        item = self.create()
        with app.app_context():
            asset = db.session.get(PaperAttachment, item["id"]).asset
            db.session.delete(asset)
            with self.assertRaises(IntegrityError): db.session.commit()
            db.session.rollback()
        self.assertEqual(self.download(item).data, fixtures.pdf())

    def test_source_read_permission_cannot_republish_another_teachers_file(self):
        item = self.create(accessLevel="staff")
        self.assertEqual(self.download(item, uid=2).status_code, 200)
        with self.assertRaises(AttachmentError): self.share(item["id"], uid=2)
        with app.app_context(): self.assertEqual(PaperAttachment.query.count(), 1)

    def test_owner_cannot_share_into_another_owners_resource(self):
        item = self.create()
        with self.assertRaises(AttachmentError): self.share(item["id"], uid=1)

    def test_context_mismatch_and_unknown_policy_deny_access(self):
        item = self.create(accessLevel="staff")
        with app.test_request_context():
            session.update(_user_id="3:1", auth_version=1)
            relation = db.session.get(PaperAttachment, item["id"])
            with self.assertRaises(AttachmentError): self.service.open("paper", db.session.get(Paper, 2), relation)
            with self.assertRaises(AttachmentError): self.service.open("unknown", db.session.get(Paper, 1), relation)

    def test_new_namespace_retains_safe_immutable_storage_contract(self):
        key = self.backend.save_file(BytesIO(fixtures.pdf()), 1, "pdf", namespace="assets")
        self.assertRegex(key, r"^assets/[0-9a-f]{32}\.pdf$")
        next_key = self.backend.replace_file(BytesIO(fixtures.pdf("new")), 1, "pdf", namespace="assets")
        self.assertNotEqual(key, next_key); self.assertTrue(self.backend.exists(key))
        with self.backend.open_file(next_key) as stream: self.assertEqual(stream.read(), fixtures.pdf("new"))
        self.assertTrue(self.backend.delete_file(key)); self.assertFalse(self.backend.exists(key))
        for key in ["assets/../private.pdf", "assets/"+"a"*32+".exe", "assets/"+"a"*32+".pdf/child", "assets\\"+"a"*32+".pdf"]:
            with self.assertRaises(ValueError): self.backend.exists(key)

    def test_mutations_require_csrf_including_multipart(self):
        raw = FlaskClient(app, app.response_class, use_cookies=True)
        with raw.session_transaction() as state: state.update(_user_id="1:1", auth_version=1)
        for method, path in [("POST", "/api/papers/1/attachments"), ("POST", "/api/papers/1/attachments/link"),
                             ("PUT", "/api/papers/1/attachments/1"), ("DELETE", "/api/papers/1/attachments/1")]:
            with self.subTest(path=path, method=method):
                result = raw.open(path, method=method, data={"file": (BytesIO(fixtures.pdf()), "test.pdf")})
                self.assertEqual(result.status_code, 403); self.assertEqual(result.json["code"], "CSRF_MISSING")
                raw.get("/api/auth/csrf")
                result = raw.open(path, method=method, headers={"X-CSRF-Token": "x"*43})
                self.assertEqual(result.json["code"], "CSRF_INVALID")
        self.assertFalse(self.files())

    def test_metadata_cannot_point_at_missing_storage(self):
        with app.test_request_context():
            session.update(_user_id="1:1", auth_version=1)
            with self.assertRaises(AttachmentError):
                self.service.create("paper", db.session.get(Paper, 1),
                                    {"attachment_type": "pdf", "storage_key": "assets/"+"a"*32+".pdf"}, 1)
            self.assertEqual(FileAsset.query.count(), 0)

    def test_shared_external_replacement_does_not_mutate_other_link(self):
        self.login(); item = self.link().json["attachment"]; other = self.share(item["id"])
        self.login(1)
        self.assertEqual(self.client.put(f"/api/papers/1/attachments/{item['id']}", json={"externalUrl": "https://example.test/replaced"}).status_code, 200)
        with app.app_context():
            self.assertEqual(db.session.get(PaperAttachment, other).asset.external_url, "https://example.test/resource")
            self.assertEqual(FileAsset.query.count(), 2)

    def test_transient_source_cannot_smuggle_an_asset_id(self):
        item = self.create(accessLevel="staff")
        with app.test_request_context():
            session.update(_user_id="2:1", auth_version=1)
            asset_id = db.session.get(PaperAttachment, item["id"]).asset_id
            forged = PaperAttachment(paper_id=2, attachment_type="pdf", asset_id=asset_id)
            target = PaperAttachment(paper_id=2, attachment_type="pdf")
            with self.assertRaises(AttachmentError):
                self.service.bind_existing("paper", db.session.get(Paper, 2), target,
                    source_kind="paper", source_resource=db.session.get(Paper, 2), source_relation=forged)

    def test_shared_validator_rejects_unknown_types(self):
        for kind in ["exe", "zip", None, []]:
            with self.assertRaises(AttachmentError): self.service.validate_upload(None, kind)
