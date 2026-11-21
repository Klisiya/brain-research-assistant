"""R8A4 TEST ONLY: isolated memory database and temporary FileAssets."""
from io import BytesIO
import unittest
from sqlalchemy import select, event
from sqlalchemy.exc import SQLAlchemyError
import test_attachments as fixtures
from app import app, db, User, HubEntry, HubRevision, HubAttachment, HubModerationEvent, HubDeletionAudit, FileAsset

BASE = '/api/hub/collaboration/entries'


class CollaborationTests(unittest.TestCase):
    setUp = fixtures.AttachmentTests.setUp
    tearDown = fixtures.AttachmentTests.tearDown
    tearDownClass = fixtures.AttachmentTests.tearDownClass
    login = fixtures.AttachmentTests.login

    def create(self, uid=1, **extra):
        self.login(uid)
        values = dict(title='TEST ONLY OpportunityAlpha', body='TEST ONLY description',
                      sourceName='TEST ONLY neutral source', requirements='TEST ONLY conditions')
        values.update(extra)
        return self.client.post(BASE, json=values)

    def action(self, entry, action, uid=1, **extra):
        self.login(uid)
        return self.client.post(f"{BASE}/{entry['id']}/{action}", json=dict(expectedVersion=entry['version'], **extra))

    def publish(self, entry):
        pending = self.action(entry, 'submit'); self.assertEqual(pending.status_code, 200, pending.json)
        approved = self.action(pending.json['entry'], 'approve', 3)
        self.assertEqual(approved.status_code, 200, approved.json)
        return approved.json['entry']

    def edit(self, entry, **extra):
        self.login(1)
        values = dict(title='TEST ONLY OpportunityBeta', body='TEST ONLY changed', sourceName='TEST ONLY source',
                      requirements='TEST ONLY changed conditions')
        values.update(extra)
        return self.client.patch(f"{BASE}/{entry['id']}", json=dict(expectedVersion=entry['version'], **values))

    def live(self, entry, uid=4):
        self.login(uid)
        return self.client.get(f"{BASE}/{entry['id']}")

    def search(self, query):
        return self.client.get('/api/search', query_string=dict(q=query, type='hub'))

    def test_create_reject_resubmit_approve_contact_and_audit(self):
        response = self.create(deadline='2020-01-02', contactName='TEST ONLY contact', contactEmail='contact@example.test', sourceUrl='https://example.test/contact')
        self.assertEqual(response.status_code, 201, response.json)
        entry = response.json['entry']
        self.assertEqual((entry['kind'], entry['businessStatus'], entry['submittedById']), ('collaboration', 'open', 1))
        pending = self.action(entry, 'submit').json['entry']
        self.assertEqual(self.live(pending).status_code, 404)
        rejected = self.action(pending, 'reject', 3, reviewNote='TEST ONLY revise').json['entry']
        self.assertEqual(self.live(rejected).status_code, 404)
        draft = self.action(rejected, 'draft').json['entry']
        self.assertEqual(draft['working']['contactEmail'], 'contact@example.test')
        draft = self.edit(draft, deadline='2020-01-02', contactName='TEST ONLY contact', contactEmail='contact@example.test', sourceUrl='https://example.test/contact').json['entry']
        published = self.publish(draft)
        public = self.live(published).json['entry']
        self.assertEqual(public['businessStatus'], 'open')  # Past deadline does not close anything.
        self.assertEqual(public['published']['deadline'], '2020-01-02')
        self.assertEqual(public['published']['contactEmail'], 'contact@example.test')
        for field in ['ownerId', 'submittedById', 'working', 'version']:
            self.assertNotIn(field, public)
        for field in ['reviewedById', 'state', 'reviewNote', 'submittedAt']:
            self.assertNotIn(field, public['published'])
        self.login(1)
        events = self.client.get(f"{BASE}/{entry['id']}/history").json['events']
        self.assertEqual([x['action'] for x in reversed(events)], ['created', 'submitted', 'rejected', 'draft_created', 'edited', 'submitted', 'approved'])
        self.assertEqual(events[0]['actorId'], 3)

    def test_revision_isolation_search_and_rejection(self):
        live = self.publish(self.create().json['entry'])
        original = self.live(live).json['entry']
        draft = self.action(live, 'draft').json['entry']
        draft = self.edit(draft, contactEmail='private@example.test').json['entry']
        pending = self.action(draft, 'submit').json['entry']
        self.assertEqual(self.live(pending).json['entry'], original)
        self.assertEqual(self.search('OpportunityBeta').json['total'], 0)
        self.assertEqual(self.search('OpportunityAlpha').json['total'], 1)
        rejected = self.action(pending, 'reject', 3, reviewNote='TEST ONLY rejected revision').json['entry']
        self.assertEqual(self.live(rejected).json['entry'], original)
        draft = self.action(rejected, 'draft').json['entry']
        published = self.publish(draft)
        self.assertEqual(self.live(published).json['entry']['published']['contactEmail'], 'private@example.test')
        self.assertEqual(self.search('OpportunityAlpha').json['total'], 0)
        self.assertEqual(self.search('OpportunityBeta').json['items'][0]['route'], f"/innovation-hub/collaboration/{live['id']}")

    def test_business_close_reopen_archive_and_filters(self):
        entry = self.create().json['entry']
        self.assertIsNone(entry['working']['deadline'])
        self.assertEqual(self.action(entry, 'close').status_code, 409)
        entry = self.publish(entry)
        closed = self.action(entry, 'close').json['entry']
        self.assertEqual((closed['status'], closed['businessStatus']), ('published', 'closed'))
        self.assertEqual(self.live(closed).status_code, 200)
        self.assertEqual(self.search('OpportunityAlpha').json['total'], 1)
        self.assertEqual(self.client.get(BASE+'?status=open').json['total'], 0)
        self.assertEqual(self.client.get(BASE+'?status=closed').json['total'], 1)
        self.assertEqual(self.client.get(BASE+'?status=invalid').status_code, 400)
        reopened = self.action(closed, 'reopen').json['entry']
        self.assertEqual(reopened['businessStatus'], 'open')
        self.assertEqual(self.action(reopened, 'archive').status_code, 403)
        archived = self.action(reopened, 'archive', 3).json['entry']
        self.assertEqual(archived['businessStatus'], 'archived')
        self.assertEqual(self.live(archived).status_code, 404)
        self.assertEqual(self.search('OpportunityAlpha').json['total'], 0)
        self.login(3)
        actions = self.client.get(f"{BASE}/{entry['id']}/history").json['events']
        self.assertEqual([x['action'] for x in actions[:3]], ['archived', 'reopened', 'closed'])

    def test_permissions_csrf_disabled_namespace_and_forgery(self):
        self.assertEqual(self.create(uid=None).status_code, 401)
        self.assertEqual(self.create(uid=4).status_code, 403)
        entry = self.create().json['entry']
        for uid in [None, 4, 2]:
            self.login(uid)
            self.assertIn(self.client.get(f"{BASE}/{entry['id']}/manage").status_code, [401,404])
        for field in ['ownerId', 'author', 'reviewedById', 'status', 'businessStatus', 'kind']:
            self.assertEqual(self.create(**{field:'forged'}).status_code, 400, field)
        self.login(2)
        self.assertEqual(self.client.patch(f"{BASE}/{entry['id']}", json=dict(expectedVersion=entry['version'], title='stolen', body='x',sourceName='x')).status_code, 404)
        self.assertEqual(self.client.get(f"/api/hub/industry/entries/{entry['id']}/manage").status_code, 404)
        pending = self.action(entry, 'submit').json['entry']
        self.assertEqual(self.action(pending, 'approve').status_code, 403)
        self.assertEqual(self.action(pending, 'reject', reviewNote='forged').status_code, 403)
        self.login(1)
        with self.client.session_transaction() as session:
            session.pop('_csrf_token', None)
        raw = app.test_client()
        with self.client.session_transaction() as source, raw.session_transaction() as target:
            target.update(source)
        self.assertEqual(raw.post(BASE, json=dict(title='x',body='x',sourceName='x')).status_code, 403)
        with app.app_context():
            user=db.session.get(User,1); user.is_active=False; db.session.commit()
        self.assertEqual(self.client.get(BASE).status_code, 401)

    def test_validation_and_stale_version(self):
        for fields in [dict(deadline='2026-02-30'), dict(deadline='20260101'), dict(contactEmail='x\r\nBcc:other@example.test'), dict(contactEmail='bad'), dict(sourceUrl='javascript:alert(1)'), dict(sourceUrl='https://user:pass@example.test'), dict(sourceUrl='//evil.test')]:
            self.assertEqual(self.create(**fields).status_code, 400, fields)
        entry = self.create(body='<script>TEST ONLY</script>',contactName='<b>TEST ONLY</b>').json['entry']
        saved = self.edit(entry).json['entry']
        self.assertEqual(self.action(entry, 'submit').status_code, 409)
        self.assertEqual(self.edit(entry).status_code, 409)
        self.assertEqual(self.action(saved,'submit').status_code, 200)

    def test_attachment_revision_and_cleanup(self):
        entry = self.create().json['entry']
        self.login(1)
        response = self.client.post(f"{BASE}/{entry['id']}/attachments", content_type='multipart/form-data', data=dict(expectedVersion=str(entry['version']), displayName='TEST ONLY attachment', attachmentType='pdf', file=(BytesIO(fixtures.pdf()),'TEST.pdf','application/pdf')))
        self.assertEqual(response.status_code,201,response.json)
        entry=response.json['entry']; url=entry['working']['attachments'][0]['downloadUrl']
        self.login(4); self.assertEqual(self.client.get(url).status_code,404)
        live=self.publish(entry)
        download=self.client.get(url);download.close()
        self.login(4); download=self.client.get(url); self.assertEqual(download.status_code,200);download.close()
        draft=self.action(live,'draft').json['entry']
        self.assertEqual(draft['working']['attachments'][0]['downloadUrl'].split('/revisions/')[0], url.split('/revisions/')[0])
        private_url=draft['working']['attachments'][0]['downloadUrl']
        self.login(4);self.assertEqual(self.client.get(private_url).status_code,404)
        discarded=self.action(draft,'discard-revision',confirmation='DISCARD').json['entry']
        self.assertEqual(discarded['published']['id'],live['published']['id'])
        self.login(4);download=self.client.get(url);self.assertEqual(download.status_code,200);download.close()
        self.assertEqual(self.client.get(private_url).status_code,404)
        with app.app_context():
            self.assertEqual(db.session.query(FileAsset).count(),1)
            self.assertEqual(db.session.query(HubAttachment).count(),1)
            self.assertEqual(db.session.query(HubRevision).count(),1)

    def test_delete_draft_pending_rejected_and_published_protection(self):
        entry=self.create().json['entry']
        pending=self.action(entry,'submit').json['entry']
        def delete(e,uid=1):
            self.login(uid)
            return self.client.delete(f"{BASE}/{e['id']}",json=dict(expectedVersion=e['version'],confirmation='DELETE'))
        self.assertEqual(delete(pending).status_code,409)
        rejected=self.action(pending,'reject',3,reviewNote='TEST ONLY').json['entry']
        self.assertEqual(delete(rejected,2).status_code,404)
        self.assertEqual(delete(rejected).status_code,200)
        self.assertEqual(self.live(rejected).status_code,404)
        draft=self.create().json['entry'];self.assertEqual(delete(draft).status_code,200)
        live=self.publish(self.create().json['entry']);self.assertEqual(delete(live).status_code,403)
        self.assertEqual(delete(live,3).status_code,403)  # Published cleanup remains Archive.
        with app.app_context():
            self.assertEqual(db.session.query(HubDeletionAudit).count(),2)
            self.assertEqual(db.session.query(HubEntry).count(),1)
            self.assertEqual(db.session.query(HubRevision).count(),1)

    def test_failed_business_transition_is_atomic(self):
        entry=self.publish(self.create().json['entry'])
        def fail(*args): raise SQLAlchemyError('TEST ONLY audit failure')
        event.listen(HubModerationEvent,'before_insert',fail)
        try: self.assertEqual(self.action(entry,'close').status_code,503)
        finally: event.remove(HubModerationEvent,'before_insert',fail)
        self.assertEqual(self.live(entry).json['entry']['businessStatus'],'open')
        self.login(1);self.assertEqual(self.client.get(f"{BASE}/{entry['id']}/manage").json['entry']['version'],entry['version'])

    def test_withdraw_then_delete_and_pending_revision_discard_guard(self):
        entry=self.create().json['entry']
        pending=self.action(entry,'submit').json['entry']
        draft=self.action(pending,'withdraw').json['entry']
        self.login(1)
        response=self.client.delete(f"{BASE}/{draft['id']}",json=dict(expectedVersion=draft['version'],confirmation='DELETE'))
        self.assertEqual(response.status_code,200)
        live=self.publish(self.create().json['entry'])
        draft=self.action(live,'draft').json['entry']
        pending=self.action(draft,'submit').json['entry']
        self.assertEqual(self.action(pending,'discard-revision',confirmation='DISCARD').status_code,409)
        draft=self.action(pending,'withdraw').json['entry']
        saved=self.action(draft,'discard-revision',confirmation='DISCARD').json['entry']
        self.assertIsNone(saved['working'])
        self.assertEqual(saved['published']['id'],live['published']['id'])
        self.assertEqual(self.live(saved).status_code,200)

    def test_file_access_tracks_published_pointer_and_archive(self):
        entry=self.create().json['entry']
        self.login(1)
        entry=self.client.post(f"{BASE}/{entry['id']}/attachments",content_type='multipart/form-data',data=dict(expectedVersion=str(entry['version']),displayName='TEST ONLY shared attachment',attachmentType='pdf',file=(BytesIO(fixtures.pdf()),'TEST.pdf','application/pdf'))).json['entry']
        live=self.publish(entry);old=live['published']['attachments'][0]['downloadUrl']
        draft=self.action(live,'draft').json['entry'];new=draft['working']['attachments'][0]['downloadUrl']
        published=self.publish(draft)
        self.login(4)
        self.assertEqual(self.client.get(old).status_code,404)
        response=self.client.get(new);self.assertEqual(response.status_code,200);response.close()
        archived=self.action(published,'archive',3)
        self.assertEqual(archived.status_code,200)
        self.login(4);self.assertEqual(self.client.get(new).status_code,404)
