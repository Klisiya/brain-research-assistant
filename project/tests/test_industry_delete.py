"""R8A2.1 TEST ONLY: permanent deletion, isolated memory DB and temporary files."""
import unittest
from unittest.mock import patch
from sqlalchemy import event, select, text
from sqlalchemy.exc import SQLAlchemyError
import test_industry as industry
from test_industry import BASE
from file_assets import ASSET_FIELDS
from app import app, db, HubEntry, HubRevision, HubAttachment, HubModerationEvent, HubDeletionAudit, FileAsset, AttachmentFileCleanup, PaperAttachment


class IndustryDeleteTests(unittest.TestCase):
    setUp = industry.IndustryTests.setUp
    tearDown = industry.IndustryTests.tearDown
    tearDownClass = industry.IndustryTests.tearDownClass
    login = industry.IndustryTests.login
    create = industry.IndustryTests.create
    action = industry.IndustryTests.action
    publish = industry.IndustryTests.publish
    upload = industry.IndustryTests.upload
    get = industry.IndustryTests.get
    search = industry.IndustryTests.search

    def delete(self, entry, uid=1, **extra):
        self.login(uid)
        return self.client.delete(f"{BASE}/{entry['id']}", json={
            'expectedVersion': entry['version'], 'confirmation': 'DELETE', **extra})

    def assert_deleted(self, entry, actor_id, ever_published=False):
        for uid in [1, 2, 3, 4]:
            self.login(uid)
            for suffix in ['', '/manage', '/history']:
                self.assertEqual(self.client.get(f"{BASE}/{entry['id']}{suffix}").status_code, 404)
        with app.app_context():
            self.assertIsNone(db.session.get(HubEntry, entry['id']))
            self.assertEqual(db.session.query(HubRevision).filter_by(entry_id=entry['id']).count(), 0)
            self.assertEqual(db.session.query(HubModerationEvent).filter_by(entry_id=entry['id']).count(), 0)
            self.assertEqual(db.session.execute(text('PRAGMA foreign_key_check')).all(), [])
            audit = db.session.query(HubDeletionAudit).filter_by(original_entry_id=entry['id']).one()
            self.assertEqual(audit.actor_id, actor_id)
            self.assertEqual(audit.snapshot['everPublished'], ever_published)
            self.assertNotIn('body', str(audit.snapshot))
            self.assertTrue(audit.snapshot['moderation'])

    def test_teacher_deletes_own_never_published_draft_and_rejected(self):
        for rejected in [False, True]:
            entry = self.create()
            if rejected:
                pending = self.action(entry, 'submit').json['entry']
                entry = self.action(pending, 'reject', 3, reviewNote='TEST ONLY reject').json['entry']
            self.assertEqual(self.delete(entry).json, {'deleted': True, 'cleanupPending': False})
            self.assert_deleted(entry, 1)

    def test_pending_requires_withdraw_and_teacher_cannot_delete_any_published_history(self):
        entry = self.action(self.create(), 'submit').json['entry']
        for uid in [1, 3]:
            self.assertEqual(self.delete(entry, uid).status_code, 409)
        entry = self.action(entry, 'withdraw').json['entry']
        self.assertEqual(self.delete(entry).status_code, 200)
        entry = self.publish(self.create())
        self.assertEqual(self.delete(entry).status_code, 403)
        draft = self.action(entry, 'draft').json['entry']
        self.assertEqual(self.delete(draft).status_code, 403)
        pending = self.action(draft, 'submit').json['entry']
        rejected = self.action(pending, 'reject', 3, reviewNote='TEST ONLY reject revision').json['entry']
        self.assertEqual(self.delete(rejected).status_code, 403)
        archived = self.action(rejected, 'archive', 3).json['entry']
        self.assertEqual(self.delete(archived).status_code, 403)
        self.assertEqual(self.delete(archived, 3).status_code, 200)
        self.assert_deleted(archived, 3, True)

    def test_admin_deletes_draft_and_rejected(self):
        entry = self.create()
        self.assertEqual(self.delete(entry, 3).status_code, 200)
        self.assert_deleted(entry, 3)
        entry = self.action(self.create(), 'submit').json['entry']
        entry = self.action(entry, 'reject', 3, reviewNote='TEST ONLY invalid').json['entry']
        self.assertEqual(self.delete(entry, 3).status_code, 200)
        self.assert_deleted(entry, 3)

    def test_admin_published_deletion_removes_all_versions_search_files_and_pointers(self):
        entry = self.publish(self.upload(self.create()).json['entry'])
        live_url = entry['published']['attachments'][0]['downloadUrl']
        entry = self.action(entry, 'draft').json['entry']
        entry = self.upload(entry, image=True).json['entry']
        private_urls = [row['downloadUrl'] for row in entry['working']['attachments']]
        entry = self.action(entry, 'submit').json['entry']
        survivor = self.publish(self.create(uid=2), uid=2)
        self.login(4)
        self.assertEqual(self.search('LiveAlpha')['total'], 2)
        self.assertEqual(self.get(live_url).status_code, 200)
        self.assertEqual(self.delete(entry, 3).json, {'deleted': True, 'cleanupPending': False})
        self.assert_deleted(entry, 3, True)
        for uid in [1, 3, 4]:
            self.login(uid)
            for url in [live_url, *private_urls]:
                self.assertEqual(self.client.get(url).status_code, 404)
        self.login(4)
        self.assertEqual([item['id'] for item in self.client.get(BASE).json['entries']], [survivor['id']])
        results = self.search('LiveAlpha')
        self.assertEqual(results['total'], 1)
        with app.app_context():
            self.assertEqual(db.session.query(HubAttachment).count(), 0)
            self.assertEqual(db.session.query(FileAsset).count(), 0)
            self.assertEqual(db.session.query(AttachmentFileCleanup).count(), 0)
        self.assertEqual(list(self.backend.root.rglob('*.pdf')), [])
        self.assertEqual(list(self.backend.root.rglob('*.png')), [])

    def test_shared_file_survives_other_industry_faculty_and_paper_references(self):
        entry = self.upload(self.create()).json['entry']
        other = self.create(uid=2)
        self.login(1)
        faculty = self.client.post('/api/hub/entries', json={'title': 'TEST ONLY shared Faculty'}).json['entry']
        with app.app_context():
            original = db.session.get(HubAttachment, entry['working']['attachments'][0]['id'])
            asset_id, key = original.asset_id, original.asset.storage_key
            for destination in [other, faculty]:
                db.session.add(HubAttachment(revision_id=destination['working']['id'], asset_id=asset_id, display_name='TEST ONLY shared PDF'))
            # Another registered content type must protect the same asset too.
            relation = PaperAttachment(paper_id=1, asset_id=asset_id, uploaded_by_id=1, attachment_type='pdf',
                display_name='TEST ONLY shared paper PDF', **{name:getattr(original.asset, name) for name in ASSET_FIELDS})
            db.session.add(relation)
            db.session.commit()
            paper_relation_id = relation.id
        self.assertEqual(self.delete(entry).status_code, 200)
        with app.app_context():
            self.assertIsNotNone(db.session.get(FileAsset, asset_id))
            self.assertTrue(self.backend.exists(key))
        self.assertEqual(self.delete(other, 2).status_code, 200)
        with app.app_context():
            self.assertIsNotNone(db.session.get(FileAsset, asset_id))
            self.assertIsNotNone(db.session.get(PaperAttachment, paper_relation_id))
        self.login(1)
        managed = self.client.get(f"/api/hub/entries/{faculty['id']}/manage").json['entry']
        self.assertEqual(self.get(managed['working']['attachments'][0]['downloadUrl']).status_code, 200)

    def test_authorization_csrf_namespace_confirmation_version_and_repeat(self):
        entry = self.create()
        for uid, code in [(None, 401), (4, 404), (2, 404)]:
            self.assertEqual(self.delete(entry, uid).status_code, code)
        self.login(1)
        self.assertEqual(app.test_client().delete(f"{BASE}/{entry['id']}", json={}).status_code, 403)
        self.assertEqual(self.delete(entry, confirmation='delete').status_code, 400)
        self.assertEqual(self.delete(entry, expectedVersion=entry['version']+1).status_code, 409)
        self.assertEqual(self.delete(entry, unknown=True).status_code, 400)
        self.assertEqual(self.client.delete(f"{BASE}/{entry['id']}?kind=faculty", json={'expectedVersion':entry['version'],'confirmation':'DELETE'}).status_code, 400)
        faculty = self.client.post('/api/hub/entries', json={'title':'TEST ONLY faculty'}).json['entry']
        self.assertEqual(self.delete(faculty).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/hub/entries/{entry['id']}", json={'expectedVersion':entry['version'],'confirmation':'DELETE'}).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/hub/entries/{faculty['id']}", json={'expectedVersion':faculty['version'],'confirmation':'DELETE'}).status_code, 200)
        raw = app.test_client()
        with raw.session_transaction() as session:
            session['_user_id'] = '1:1'; session['auth_version'] = 1; session['_fresh'] = True
        self.assertEqual(raw.delete(f"{BASE}/{entry['id']}", json={'expectedVersion':entry['version'],'confirmation':'DELETE'}).status_code, 403)
        self.assertEqual(self.delete(entry).status_code, 200)
        self.assertEqual(self.delete(entry).status_code, 404)

    def test_audit_failure_rolls_back_everything_before_any_file_deletion(self):
        entry = self.publish(self.upload(self.create()).json['entry'])
        def fail(*_):
            raise SQLAlchemyError('TEST ONLY deletion audit unavailable')
        event.listen(HubDeletionAudit, 'before_insert', fail)
        try:
            self.assertEqual(self.delete(entry, 3).status_code, 503)
        finally:
            event.remove(HubDeletionAudit, 'before_insert', fail)
        self.login(4)
        self.assertEqual(self.client.get(f"{BASE}/{entry['id']}").status_code, 200)
        self.assertEqual(self.get(entry['published']['attachments'][0]['downloadUrl']).status_code, 200)
        with app.app_context():
            self.assertEqual(db.session.query(HubDeletionAudit).count(), 0)
            self.assertTrue(db.session.query(HubModerationEvent).filter_by(entry_id=entry['id']).count())
            self.assertEqual(db.session.query(HubAttachment).count(), 1)

    def test_disk_cleanup_failure_revokes_access_and_durably_retries(self):
        entry = self.publish(self.upload(self.create()).json['entry'])
        url = entry['published']['attachments'][0]['downloadUrl']
        with patch.object(self.backend, 'delete_file', side_effect=OSError('TEST ONLY locked file')):
            self.assertEqual(self.delete(entry, 3).json, {'deleted':True,'cleanupPending':True})
        self.assert_deleted(entry, 3, True)
        self.login(4)
        self.assertEqual(self.client.get(url).status_code, 404)
        with app.app_context():
            self.assertEqual(db.session.query(FileAsset).count(), 0)
            self.assertEqual(db.session.query(AttachmentFileCleanup).count(), 1)
            self.assertEqual(app.extensions['file_asset_service'].drain_cleanup(), 0)
            self.assertEqual(db.session.query(AttachmentFileCleanup).count(), 0)

    def test_disabled_actor_and_no_learning_writes(self):
        entry = self.create()
        with app.app_context():
            tables = [table for table in db.metadata.sorted_tables if table.name.startswith('learning_')]
            before = [db.session.scalar(select(db.func.count()).select_from(table)) for table in tables]
        self.assertEqual(self.delete(entry).status_code, 200)
        with app.app_context():
            self.assertEqual(before, [db.session.scalar(select(db.func.count()).select_from(table)) for table in tables])
        entry = self.create()
        from app import User
        with app.app_context():
            db.session.get(User, 1).is_active = False; db.session.commit()
        self.assertEqual(self.delete(entry).status_code, 401)
