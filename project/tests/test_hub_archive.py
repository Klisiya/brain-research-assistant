"""R8 closeout regression for the three shared Hub moderation routes."""
from datetime import datetime
from io import BytesIO
import unittest

import test_attachments as fixtures
from app import HubEntry, HubModerationEvent, app, db


class HubArchiveTests(unittest.TestCase):
    setUp = fixtures.AttachmentTests.setUp
    tearDown = fixtures.AttachmentTests.tearDown
    tearDownClass = fixtures.AttachmentTests.tearDownClass
    login = fixtures.AttachmentTests.login

    routes = ('/api/hub/entries', '/api/hub/industry/entries', '/api/hub/collaboration/entries')

    def create(self, route, title):
        self.login(1)
        response = self.client.post(route, json={'title': title, 'body': 'TEST ONLY', 'sourceName': 'TEST ONLY'})
        self.assertEqual(response.status_code, 201, response.json)
        entry = response.json['entry']
        return f"{route}/{entry['id']}", entry

    def action(self, path, entry, action, actor=3, status=200, **fields):
        self.login(actor)
        response = self.client.post(f'{path}/{action}', json={'expectedVersion': entry['version'], **fields})
        self.assertEqual(response.status_code, status, response.json)
        return response.json['entry'] if status == 200 else response.json['code']

    def manage(self, path):
        self.login(3)
        return self.client.get(f'{path}/manage').json['entry']

    def history(self, path):
        self.login(3)
        return self.client.get(f'{path}/history').json['events']

    def upload(self, path, entry, name):
        self.login(1)
        response = self.client.post(f'{path}/attachments', data={
            'expectedVersion': str(entry['version']), 'attachmentType': 'pdf', 'displayName': name,
            'file': (BytesIO(fixtures.pdf(name)), f'{name}.pdf', 'application/pdf'),
        })
        self.assertEqual(response.status_code, 201, response.json)
        return response.json['entry']

    def visible(self, path, title, status):
        self.login(4)
        response = self.client.get(path)
        self.assertEqual(response.status_code, status)
        if status == 200:
            self.assertEqual(response.json['entry']['published']['title'], title)
        results = self.client.get('/api/search', query_string={'q': title, 'type': 'hub'})
        self.assertEqual(results.status_code, 200)
        self.assertEqual(results.json['total'], int(status == 200))

    def test_pending_archive_is_rejected_without_mutating_entry_or_audit(self):
        for route in self.routes:
            with self.subTest(route=route):
                title = f'TEST ONLY Pending {route}'
                path, draft = self.create(route, title)
                pending = self.action(path, draft, 'submit', actor=1)
                events = self.history(path)
                self.action(path, pending, 'archive', actor=1, status=403)
                self.action(path, pending, 'archive', actor=4, status=404)
                for _ in range(2):
                    self.assertEqual(self.action(path, pending, 'archive', status=409), 'HUB_STATE_CONFLICT')
                self.assertEqual(self.manage(path), pending)
                self.assertEqual(self.history(path), events)
                self.visible(path, title, 404)
                rejected = self.action(path, pending, 'reject', reviewNote='TEST ONLY reason')
                self.assertEqual(rejected['working']['state'], 'rejected')
                archived = self.action(path, rejected, 'archive')
                self.assertEqual((archived['status'], archived['working']['state']), ('archived', 'rejected'))
                self.assertEqual(self.action(path, rejected, 'archive', status=409), 'HUB_CONFLICT')

    def test_published_snapshot_and_files_survive_blocked_archive_and_discard(self):
        for route in self.routes:
            with self.subTest(route=route):
                title = f'TEST ONLY Published {route}'
                path, draft = self.create(route, title)
                draft = self.upload(path, draft, 'published')
                v1 = self.action(path, self.action(path, draft, 'submit', actor=1), 'approve')
                v1_url = v1['published']['attachments'][0]['downloadUrl']
                draft = self.action(path, v1, 'draft', actor=1)
                v2_title = f'TEST ONLY replacement {route}'
                self.login(1)
                edit = self.client.patch(path, json={'expectedVersion': draft['version'], 'title': v2_title,
                                                     'body': 'TEST ONLY update', 'sourceName': 'TEST ONLY'})
                self.assertEqual(edit.status_code, 200, edit.json)
                draft = self.upload(path, edit.json['entry'], 'pending')
                pending_url = draft['working']['attachments'][-1]['downloadUrl']
                pending = self.action(path, draft, 'submit', actor=1)
                self.action(path, pending, 'archive', status=409)
                self.visible(path, title, 200)
                with self.client.get(v1_url) as response:
                    self.assertEqual(response.status_code, 200)
                self.assertEqual(self.client.get(pending_url).status_code, 404)
                self.assertEqual(self.client.get('/api/search', query_string={'q': v2_title, 'type': 'hub'}).json['total'], 0)
                draft = self.action(path, pending, 'withdraw', actor=1)
                pending = self.action(path, draft, 'submit', actor=1)
                draft = self.action(path, pending, 'withdraw', actor=1)
                live = self.action(path, draft, 'discard-revision', actor=1, confirmation='DISCARD')
                self.assertIsNone(live['working'])
                self.assertEqual(live['published'], v1['published'])
                self.visible(path, title, 200)
                with self.client.get(v1_url) as response:
                    self.assertEqual(response.status_code, 200)
                self.assertEqual(self.client.get(pending_url).status_code, 404)
                working = self.action(path, live, 'draft', actor=1)
                archived = self.action(path, working, 'archive')
                self.assertEqual(archived['published'], v1['published'])
                self.assertEqual(archived['working']['state'], 'draft')
                self.visible(path, title, 404)
                self.assertEqual(self.client.get(v1_url).status_code, 404)

    def test_admin_can_withdraw_legacy_archived_pending_without_republishing(self):
        for route in self.routes:
            for previously_published in (False, True):
                with self.subTest(route=route, previously_published=previously_published):
                    title = f'TEST ONLY Historical {route} {previously_published}'
                    path, draft = self.create(route, title)
                    if previously_published:
                        v1 = self.action(path, self.action(path, draft, 'submit', actor=1), 'approve')
                        draft = self.action(path, v1, 'draft', actor=1)
                    draft = self.upload(path, draft, 'legacy')
                    pending = self.action(path, draft, 'submit', actor=1)
                    # Reproduce the pre-fix archive write on the isolated fixture.
                    with app.app_context():
                        entry = db.session.get(HubEntry, pending['id'])
                        entry.archived_at = datetime(2026, 1, 2)
                        entry.updated_at = entry.archived_at
                        entry.version += 1
                        db.session.add(HubModerationEvent(entry_id=entry.id, revision_id=entry.working_revision_id,
                                                         actor_id=3, action='archived'))
                        db.session.commit()
                    archived = self.manage(path)
                    events = self.history(path)
                    self.action(path, archived, 'withdraw', actor=1, status=409)
                    self.action(path, archived, 'withdraw', actor=4, status=404)
                    self.action(path, archived, 'approve', status=409)
                    self.action(path, archived, 'reject', status=409, reviewNote='TEST ONLY reason')
                    recovered = self.action(path, archived, 'withdraw')
                    self.assertEqual(recovered['status'], 'archived')
                    self.assertEqual(recovered['published'], archived['published'])
                    self.assertEqual(recovered['working']['id'], archived['working']['id'])
                    self.assertEqual(recovered['working']['attachments'], archived['working']['attachments'])
                    self.assertEqual(recovered['working']['state'], 'draft')
                    self.assertIsNone(recovered['working']['submittedAt'])
                    self.assertEqual(self.action(path, archived, 'withdraw', status=409), 'HUB_CONFLICT')
                    self.action(path, recovered, 'withdraw', status=409)
                    self.action(path, recovered, 'submit', status=409)
                    after = self.history(path)
                    self.assertEqual(after[1:], events)
                    self.assertEqual((after[0]['action'], after[0]['actorId'], after[0]['revisionId']),
                                     ('withdrawn', 3, recovered['working']['id']))
                    self.visible(path, title, 404)
                    self.assertEqual(self.client.get(recovered['working']['attachments'][-1]['downloadUrl']).status_code, 404)

