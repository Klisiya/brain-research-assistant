"""R8A2 TEST ONLY: in-memory Hub data and temporary FileAsset storage."""
from io import BytesIO
import unittest
from sqlalchemy import event, select
from sqlalchemy.exc import SQLAlchemyError
import test_attachments as fixtures
from app import app, db, User, HubEntry, HubRevision, HubAttachment, HubModerationEvent

BASE = '/api/hub/industry/entries'


class IndustryTests(unittest.TestCase):
    setUp = fixtures.AttachmentTests.setUp
    tearDown = fixtures.AttachmentTests.tearDown
    tearDownClass = fixtures.AttachmentTests.tearDownClass
    login = fixtures.AttachmentTests.login

    def get(self, path):
        response = self.client.get(path)
        response.get_data()
        response.close()
        return response

    def create(self, uid=1, **fields):
        self.login(uid)
        response = self.client.post(BASE, json=dict(title='TEST ONLY LiveAlpha', body='TEST ONLY description',
            sourceName='TEST ONLY neutral source', sourceUrl='https://example.test/source', sourceDate='2020-01-02', **fields))
        self.assertEqual(response.status_code, 201, response.json)
        return response.json['entry']

    def action(self, entry, action, uid=1, **fields):
        self.login(uid)
        return self.client.post(f"{BASE}/{entry['id']}/{action}", json=dict(expectedVersion=entry['version'], **fields))

    def publish(self, entry, uid=1):
        pending = self.action(entry, 'submit', uid)
        self.assertEqual(pending.status_code, 200, pending.json)
        approved = self.action(pending.json['entry'], 'approve', 3)
        self.assertEqual(approved.status_code, 200, approved.json)
        return approved.json['entry']

    def edit(self, entry, title='TEST ONLY PendingBeta', **extra):
        self.login(1)
        return self.client.patch(f"{BASE}/{entry['id']}", json=dict(expectedVersion=entry['version'], title=title,
            body='TEST ONLY revised description', sourceName='TEST ONLY revised source', sourceDate='2021-03-04', **extra))

    def upload(self, entry, image=False):
        self.login(1)
        return self.client.post(f"{BASE}/{entry['id']}/attachments", content_type='multipart/form-data', data={
            'expectedVersion': str(entry['version']), 'displayName': 'TEST ONLY image' if image else 'TEST ONLY PDF',
            'attachmentType': 'cover' if image else 'pdf',
            'file': (BytesIO(fixtures.png() if image else fixtures.pdf()), 'TEST.png' if image else 'TEST.pdf', 'image/png' if image else 'application/pdf')})

    def live(self, entry, uid=4):
        self.login(uid)
        return self.client.get(f"{BASE}/{entry['id']}")

    def search(self, text):
        return self.client.get('/api/search', query_string={'q': text, 'type': 'hub'}).json

    def test_new_moderation_rejection_resubmit_and_real_actors(self):
        entry = self.create()
        self.assertEqual(entry['kind'], 'industry')
        self.assertEqual(entry['submittedById'], 1)
        self.assertEqual(entry['working']['sourceDate'], '2020-01-02')
        self.assertNotEqual(entry['createdAt'][:10], entry['working']['sourceDate'])
        self.assertEqual(self.action(entry, 'approve', 3).status_code, 409)
        pending = self.action(entry, 'submit').json['entry']
        self.assertEqual(self.edit(pending).status_code, 409)
        rejected = self.action(pending, 'reject', 3, reviewNote='TEST ONLY revise source').json['entry']
        draft = self.action(rejected, 'draft').json['entry']
        saved = self.edit(draft).json['entry']
        live = self.publish(saved)
        detail = self.live(live).json['entry']
        self.assertEqual(detail['published']['title'], 'TEST ONLY PendingBeta')
        self.assertNotIn('working', detail)
        self.assertNotIn('ownerId', detail)
        self.assertNotIn('reviewedById', detail['published'])
        self.assertNotIn('reviewNote', detail['published'])
        self.login(1)
        events = self.client.get(f"{BASE}/{entry['id']}/history").json['events']
        self.assertEqual([e['action'] for e in reversed(events)], ['created','submitted','rejected','draft_created','edited','submitted','approved'])
        self.assertEqual(events[0]['actorId'], 3)
        self.assertEqual(events[0]['contentAuthorId'], 1)
        self.assertEqual(events[0]['revisionNumber'], 2)
        self.assertEqual(events[0]['sourceName'], 'TEST ONLY revised source')
        self.assertEqual(events[-1]['actorId'], 1)
        self.assertEqual(self.client.get(f"{BASE}/{entry['id']}/manage").json['entry'], live)

    def test_pending_revision_preserves_live_content_search_and_dates(self):
        entry = self.publish(self.create())
        original = self.live(entry).json['entry']
        self.assertEqual(self.search('LiveAlpha')['total'], 1)
        draft = self.action(entry, 'draft').json['entry']
        self.assertEqual(draft['working']['number'], 2)
        self.assertEqual(draft['working']['sourceDate'], '2020-01-02')
        draft = self.edit(draft).json['entry']
        pending = self.action(draft, 'submit').json['entry']
        self.assertEqual(self.live(pending).json['entry'], original)
        self.assertEqual(self.search('PendingBeta')['total'], 0)
        self.assertEqual(self.search('revised source')['total'], 0)
        self.assertEqual(self.search('LiveAlpha')['items'][0]['route'], f"/innovation-hub/industry/{entry['id']}")
        self.login(4)
        self.assertEqual(self.client.get(f"{BASE}/{entry['id']}?revision={pending['working']['id']}").status_code, 400)
        self.assertEqual(self.client.get(f"{BASE}/{entry['id']}/revisions/{pending['working']['id']}").status_code, 404)
        approved = self.action(pending, 'approve', 3).json['entry']
        detail = self.live(approved).json['entry']
        self.assertEqual(detail['published']['title'], 'TEST ONLY PendingBeta')
        self.assertEqual(detail['published']['sourceDate'], '2021-03-04')
        self.assertEqual(self.search('LiveAlpha')['total'], 0)
        result = self.search('PendingBeta')
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['items'][0]['key'], f"hub:{entry['id']}")
        self.assertEqual(self.client.get(BASE).json['total'], 1)

    def test_rejected_revision_keeps_published_and_can_resubmit(self):
        entry = self.publish(self.create())
        draft = self.action(entry, 'draft').json['entry']
        pending = self.action(self.edit(draft).json['entry'], 'submit').json['entry']
        rejected = self.action(pending, 'reject', 3, reviewNote='TEST ONLY revision rejected').json['entry']
        self.assertEqual(self.live(rejected).json['entry']['published']['title'], 'TEST ONLY LiveAlpha')
        self.assertEqual(self.search('PendingBeta')['total'], 0)
        draft = self.action(rejected, 'draft').json['entry']
        self.assertEqual(draft['working']['number'], 3)
        self.assertEqual(draft['working']['title'], 'TEST ONLY PendingBeta')
        self.publish(draft)
        self.assertEqual(self.live(draft).json['entry']['published']['title'], 'TEST ONLY PendingBeta')

    def test_auth_roles_idor_all_nonpublic_states_and_forged_fields(self):
        entry = self.create()
        for state in ['draft', 'pending', 'rejected']:
            for uid in [None, 2, 4]:
                self.login(uid)
                expected = 401 if uid is None else 404
                for suffix in ['', '/manage', '/history']:
                    self.assertEqual(self.client.get(f"{BASE}/{entry['id']}"+suffix).status_code, expected)
                self.assertEqual(self.client.patch(f"{BASE}/{entry['id']}", json={'expectedVersion':entry['version'],'title':'TEST ONLY','body':'TEST ONLY','sourceName':'TEST ONLY'}).status_code, expected)
                if uid:
                    self.assertEqual(self.client.get(BASE).json['entries'], [])
                    self.assertEqual(self.search('LiveAlpha')['total'], 0)
            self.assertEqual(self.action(entry, 'approve').status_code, 403)
            self.assertEqual(self.action(entry, 'reject', reviewNote='TEST ONLY').status_code, 403)
            if state == 'draft': entry = self.action(entry, 'submit').json['entry']
            elif state == 'pending': entry = self.action(entry, 'reject', 3, reviewNote='TEST ONLY').json['entry']
        self.login(3)
        for field in ['reviewer', 'reviewedById', 'submittedById', 'ownerId', 'kind', 'state']:
            response = self.client.post(f"{BASE}/{entry['id']}/approve", json={'expectedVersion':entry['version'],field:3})
            self.assertEqual(response.status_code, 400)
        for uid in [None, 4]:
            self.login(uid)
            self.assertEqual(self.client.post(BASE,json={'title':'TEST ONLY','body':'TEST ONLY','sourceName':'TEST ONLY'}).status_code, 401 if uid is None else 403)
        self.login(None)
        self.assertEqual(self.client.get('/api/search?q=LiveAlpha&type=hub').status_code, 401)

    def test_source_validation_csrf_stale_token_and_no_partner_identity(self):
        self.login(1)
        for extra in [{'sourceDate':'2023-02-29'},{'sourceDate':'20200102'},{'sourceDate':123},{'sourceUrl':'javascript:alert(1)'},{'sourceName':''},{'body':''},{'submittedById':2},{'organizationId':1}]:
            payload = {'title':'TEST ONLY','body':'TEST ONLY','sourceName':'TEST ONLY',**extra}
            self.assertEqual(self.client.post(BASE,json=payload).status_code,400)
        entry = self.create()
        saved = self.edit(entry).json['entry']
        self.assertEqual(self.edit(entry).status_code,409)
        self.assertEqual(self.action(entry,'submit').status_code,409)
        self.assertEqual(self.action(saved,'publish').status_code,404)
        plain = app.test_client()
        with plain.session_transaction() as session: session['_user_id']='1:1';session['auth_version']=1
        self.assertEqual(plain.post(BASE,json={'title':'TEST ONLY'}).status_code,403)
        with app.app_context():
            row=db.session.get(User,1);row.is_active=False;db.session.commit()
        self.assertEqual(self.client.get(BASE+'?scope=mine').status_code,401)

    def test_attachment_permissions_follow_revision_pointer_and_namespace(self):
        entry = self.create()
        entry = self.upload(entry).json['entry']
        entry = self.publish(entry)
        old = entry['published']['attachments'][0]['downloadUrl']
        self.assertEqual(self.live(entry).status_code,200)
        self.assertEqual(self.get(old).status_code,200)
        draft = self.action(entry,'draft').json['entry']
        copied = draft['working']['attachments'][0]
        self.login(1)
        draft = self.client.delete(f"{BASE}/{entry['id']}/attachments/{copied['id']}", json={'expectedVersion':draft['version']}).json['entry']
        draft = self.upload(draft, image=True).json['entry']
        new = draft['working']['attachments'][0]['downloadUrl']
        pending = self.action(draft,'submit').json['entry']
        for uid in [None,2,4]:
            self.login(uid)
            self.assertEqual(self.client.get(new).status_code,401 if uid is None else 404)
            self.assertEqual(self.get(old).status_code,401 if uid is None else 200)
        self.login(4)
        self.assertEqual(self.client.get(new.replace('/industry','',1)).status_code,404)
        self.assertEqual(self.client.get(f"/api/hub/entries/{entry['id']}").status_code,404)
        self.assertEqual(self.client.get(new.replace(f"/revisions/{pending['working']['id']}/", f"/revisions/{entry['published']['id']}/")).status_code,404)
        approved=self.action(pending,'approve',3).json['entry']
        self.live(approved)
        self.assertEqual(self.get(new).status_code,200)
        self.assertEqual(self.client.get(old).status_code,404)
        archived=self.action(approved,'archive',3).json['entry']
        self.assertEqual(self.live(archived).status_code,404)
        self.assertEqual(self.client.get(new).status_code,404)
        self.assertEqual(self.search('PendingBeta')['total'],0)

    def test_scoped_lists_review_queue_and_admin_entry(self):
        entry=self.create()
        faculty=self.client.post('/api/hub/entries',json={'title':'TEST ONLY faculty'}).json['entry']
        self.assertEqual([r['id'] for r in self.client.get('/api/hub/entries?scope=mine').json['entries']],[faculty['id']])
        self.assertEqual([r['id'] for r in self.client.get(BASE+'?scope=mine').json['entries']],[entry['id']])
        self.assertEqual(self.client.get(f"{BASE}/{faculty['id']}/manage").status_code,404)
        self.login(2)
        self.assertEqual(self.client.get(BASE+'?scope=mine').json['entries'],[])
        for scope in ['all','review']:
            self.assertEqual(self.client.get(BASE+'?scope='+scope).status_code,403)
        self.login(3)
        self.assertEqual(self.client.get(BASE+'?scope=review').json['entries'],[])
        self.assertEqual(self.client.get(BASE+'?scope=all').json['total'],1)
        pending=self.action(entry,'submit').json['entry']
        self.login(3)
        self.assertEqual(self.client.get(BASE+'?scope=review').json['entries'][0]['id'],entry['id'])
        self.action(pending,'approve',3)
        self.assertEqual(self.client.get(BASE+'?scope=review').json['entries'],[])
        own=self.create(uid=3)
        self.publish(own,uid=3)
        self.assertEqual(self.live(own).json['entry']['submittedById'],3)

    def test_publication_and_audit_are_atomic_and_reads_do_not_write_learning(self):
        entry=self.create();pending=self.action(entry,'submit').json['entry']
        def fail(*_args): raise SQLAlchemyError('TEST ONLY audit failure')
        event.listen(HubModerationEvent,'before_insert',fail)
        try:self.assertEqual(self.action(pending,'approve',3).status_code,503)
        finally:event.remove(HubModerationEvent,'before_insert',fail)
        self.assertEqual(self.live(entry).status_code,404)
        self.login(1)
        self.assertEqual(self.client.get(f"{BASE}/{entry['id']}/manage").json['entry']['working']['state'],'pending')
        entry=self.action(pending,'approve',3).json['entry']
        with app.app_context():
            tables=[table for table in db.metadata.sorted_tables if table.name.startswith('learning_')]
            before=[db.session.scalar(select(db.func.count()).select_from(table)) for table in tables]
        for _ in range(3): self.live(entry);self.client.get(BASE);self.search('LiveAlpha')
        with app.app_context():
            self.assertEqual(before,[db.session.scalar(select(db.func.count()).select_from(table)) for table in tables])
            self.assertEqual(db.session.get(HubEntry,entry['id']).owner_id,1)
            self.assertEqual(db.session.get(HubRevision,entry['published']['id']).reviewed_by_id,3)
        response=self.client.get(BASE)
        self.assertEqual(response.headers['Cache-Control'],'private, no-store')
