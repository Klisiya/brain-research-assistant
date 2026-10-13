"""TEST ONLY: exercise real Hub limits, which regular testing-mode tests exempt."""
from io import BytesIO
import unittest
import test_hub as hub_fixtures
from test_attachments import pdf
from app import app, limiter


class HubRateLimitTests(unittest.TestCase):
    setUp = hub_fixtures.HubTests.setUp
    login = hub_fixtures.HubTests.login
    tearDownClass = hub_fixtures.HubTests.tearDownClass

    def tearDown(self):
        app.config['TESTING'] = True
        limiter.reset()
        hub_fixtures.HubTests.tearDown(self)

    def enable_limits(self):
        app.config['TESTING'] = False
        limiter.reset()

    def test_each_read_consumes_one_unit_and_endpoint_budgets_are_independent(self):
        self.login(3)
        self.enable_limits()
        first = self.client.get('/api/hub/entries?scope=review')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.headers['X-RateLimit-Remaining'], '119')
        for index in range(119):
            response = self.client.get('/api/hub/entries?scope=' + ('review' if index % 2 else 'mine'))
            self.assertEqual(response.status_code, 200, (index, response.json))
        limited = self.client.get('/api/hub/entries?scope=published')
        self.assertEqual((limited.status_code, limited.json['code']), (429, 'RATE_LIMITED'))
        self.assertGreater(int(limited.headers['Retry-After']), 0)
        # A different endpoint must not inherit the list's exhausted bucket.
        detail = self.client.get('/api/hub/entries/999999/manage')
        self.assertEqual(detail.status_code, 404)
        self.assertEqual(detail.headers['X-RateLimit-Remaining'], '119')
        limiter.reset()
        self.assertEqual(self.client.get('/api/hub/entries?scope=review').status_code, 200)

    def test_upload_limit_and_authorization_remain_enforced(self):
        self.login(1)
        entry = self.client.post('/api/hub/entries', json={'title': 'TEST ONLY rate limit fixture'}).json['entry']
        self.enable_limits()
        for _ in range(10):
            response = self.client.post(f"/api/hub/entries/{entry['id']}/attachments", data={
                'expectedVersion': str(entry['version']), 'displayName': 'TEST ONLY PDF',
                'attachmentType': 'pdf', 'file': (BytesIO(pdf()), 'TEST.pdf', 'application/pdf'),
            }, content_type='multipart/form-data')
            self.assertEqual(response.status_code, 201, response.json)
            entry = response.json['entry']
        limited = self.client.post(f"/api/hub/entries/{entry['id']}/attachments", json={})
        self.assertEqual((limited.status_code, limited.json['code']), (429, 'RATE_LIMITED'))
        self.assertEqual(self.client.get('/api/hub/entries?scope=mine').status_code, 200)
        self.login(2)
        self.assertEqual(self.client.get(f"/api/hub/entries/{entry['id']}/manage").status_code, 404)
        self.login(4)
        self.assertEqual(self.client.get('/api/hub/entries?scope=mine').status_code, 403)
        with self.client.session_transaction() as session:
            session.clear()
        self.assertEqual(self.client.get('/api/hub/entries').status_code, 401)


if __name__ == '__main__':
    unittest.main()
