"""Course publication, membership and real shared-asset integration regressions."""
import unittest
from unittest.mock import patch
from flask import session
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
import test_attachments as fixtures
from app import app, db, User, Paper, PaperAttachment, FileAsset, Course, CourseModule, CourseStaff, CourseResource, ModuleResource, course_authorization
from attachment_files import AttachmentError
from course_content import bootstrap_course, canonical_content, MODULE_FIELDS

SLUGS = [
    'brain-science-overview',
    'brain-function-structure-microstructure-networks-one',
    'brain-function-structure-microstructure-networks-two',
    'clinical-frontiers-brain-disorders-one',
    'clinical-frontiers-brain-disorders-two',
    'clinical-frontiers-brain-disorders-three',
    'clinical-frontiers-brain-disorders-four',
    'brain-science-ai-bidirectional-integration',
    'frontier-literature-seminar-one', 'frontier-literature-seminar-two',
    'industry-education-integration-workshop-one', 'industry-education-integration-workshop-two',
]


class CourseTests(unittest.TestCase):
    tearDown = fixtures.AttachmentTests.tearDown
    login = fixtures.AttachmentTests.login
    create = fixtures.AttachmentTests.create
    upload = fixtures.AttachmentTests.upload
    link = fixtures.AttachmentTests.link
    files = fixtures.AttachmentTests.files

    def setUp(self):
        fixtures.AttachmentTests.setUp(self)
        with app.app_context():
            course, _ = bootstrap_course(db, Course, CourseModule)
            self.slug = course.slug
            self.module_slug = course.modules[0].slug
            self.course_id = course.id
            self.module_id = course.modules[0].id
            other = Course(slug='other-course', title='Other', description='Fixture', status='published')
            db.session.add(other); db.session.flush()
            self.other_id = other.id
            db.session.add_all([CourseStaff(course_id=course.id, user_id=1, role='instructor'),
                               CourseStaff(course_id=other.id, user_id=2, role='assistant')])
            db.session.commit()
        self.url = f'/api/courses/{self.slug}'

    @classmethod
    def tearDownClass(cls):
        with app.app_context(): db.session.remove(); db.engine.dispose()

    @property
    def service(self): return app.extensions['file_asset_service']

    def get(self, path):
        response = self.client.get(path)
        response.get_data(); response.close()
        return response

    def share(self, attachment_id, kind='course', parent_id=None, uid=1, access='public'):
        with app.test_request_context():
            session.update(_user_id=f'{uid}:1', auth_version=1, _fresh=True)
            parent_id = parent_id or (self.course_id if kind == 'course' else self.module_id)
            model, field, parent_model = (CourseResource, 'course_id', Course) if kind == 'course' else (ModuleResource, 'module_id', CourseModule)
            relation = model(**{field: parent_id}, display_name='Shared course resource', access_level=access, version=1, sort_order=0)
            source = db.session.get(PaperAttachment, attachment_id)
            self.service.bind_existing(kind, db.session.get(parent_model, parent_id), relation,
                source_kind='paper', source_resource=db.session.get(Paper, source.paper_id), source_relation=source)
            db.session.add(relation); db.session.commit()
            return relation.id

    def test_canonical_bootstrap_exact_fields_slugs_order_hours(self):
        with app.app_context():
            course, added = bootstrap_course(db, Course, CourseModule)
            self.assertEqual(added, 0)
            self.assertEqual(len(course.modules), 12)
            self.assertEqual([m.number for m in course.modules], list(range(1, 13)))
            self.assertEqual([m.slug for m in course.modules], SLUGS)
            self.assertEqual([m.duration_hours for m in course.modules], [3] * 12)
            for row, expected in zip(course.modules, canonical_content()['modules']):
                self.assertEqual({key: getattr(row, field) for key, field in MODULE_FIELDS.items()}, {key: expected[key] for key in MODULE_FIELDS})
            course.title = 'Edited'; course.modules[0].description = 'Edited'; course.modules[0].status = 'draft'
            db.session.commit()
            course, added = bootstrap_course(db, Course, CourseModule)
            self.assertEqual((course.title, course.modules[0].description, course.modules[0].status, added), ('Edited', 'Edited', 'draft', 0))

    def test_duplicate_slug_and_number_rejected_but_other_course_allowed(self):
        for field in ['slug', 'number']:
            with app.app_context():
                values = {target: canonical_content()['modules'][0][source] for source, target in MODULE_FIELDS.items()}
                values['number' if field == 'slug' else 'slug'] = 13 if field == 'slug' else 'unique-module'
                db.session.add(CourseModule(course_id=self.course_id, **values))
                with self.assertRaises(IntegrityError): db.session.commit()
                db.session.rollback()
        with app.app_context():
            values = {target: canonical_content()['modules'][0][source] for source, target in MODULE_FIELDS.items()}
            db.session.add(CourseModule(course_id=self.other_id, **values)); db.session.commit()

    def test_public_reads_derived_totals_and_no_private_fields(self):
        response = self.get(self.url)
        self.assertEqual(response.status_code, 200)
        course = response.json['course']
        self.assertEqual((course['moduleCount'], course['totalHours']), (12, 36))
        self.assertEqual([m['slug'] for m in course['modules']], SLUGS)
        self.assertNotIn('status', course); self.assertNotIn('createdAt', course)
        self.assertEqual(self.get(self.url + '/modules').json['modules'], course['modules'])
        self.assertEqual(self.get(self.url + '/modules/' + self.module_slug).json['module'], course['modules'][0])
        self.assertEqual(len(self.get('/api/courses').json['courses']), 2)
        self.assertIn('no-store', response.headers['Cache-Control'])
        self.assertEqual(self.get(self.url + '/resources').json, {'resources': []})

    def test_draft_archived_hidden_even_for_admin_and_counts_filtered(self):
        self.login(3)
        with app.app_context():
            db.session.get(CourseModule, self.module_id).status = 'draft'; db.session.commit()
        self.assertEqual(self.get(self.url + '/modules/' + self.module_slug).status_code, 404)
        public = self.get(self.url).json['course']
        self.assertEqual((public['moduleCount'], public['totalHours']), (11, 33))
        self.assertEqual(len(self.get(f'/api/courses/{self.course_id}/manage').json['course']['modules']), 12)
        for status in ['draft', 'archived']:
            with app.app_context(): db.session.get(Course, self.course_id).status = status; db.session.commit()
            for path in [self.url, self.url + '/modules', self.url + '/resources', self.url + '/modules/' + self.module_slug]:
                self.assertEqual(self.get(path).status_code, 404)
            self.assertEqual(len(self.get('/api/courses').json['courses']), 1)

    def test_management_is_membership_scoped_and_student_denied(self):
        for uid, expected in [(None, 401), (4, 403), (2, 403), (1, 200), (3, 200)]:
            self.login(uid)
            self.assertEqual(self.get(f'/api/courses/{self.course_id}/manage').status_code, expected)
        self.login(1)
        self.assertEqual([c['id'] for c in self.get('/api/courses/manage').json['courses']], [self.course_id])
        self.assertEqual(self.get(f'/api/courses/{self.other_id}/manage').status_code, 403)
        self.assertEqual(self.get(f'/api/courses/{self.course_id}/modules/{self.module_id}/manage').status_code, 200)
        self.assertEqual(self.get(f'/api/courses/{self.course_id}/modules/999/manage').status_code, 404)
        self.login(2)
        self.assertEqual(self.get(f'/api/courses/{self.other_id}/manage').status_code, 200)
        self.login(3); self.assertEqual(len(self.get('/api/courses/manage').json['courses']), 2)

    def test_staff_unique_and_changes_effective_without_new_session(self):
        with app.app_context():
            db.session.add(CourseStaff(course_id=self.course_id, user_id=1, role='assistant'))
            with self.assertRaises(IntegrityError): db.session.commit()
            db.session.rollback()
        self.login(1)
        with app.app_context(): CourseStaff.query.filter_by(course_id=self.course_id, user_id=1).delete(); db.session.commit()
        self.assertEqual(self.get(f'/api/courses/{self.course_id}/manage').status_code, 403)
        self.assertEqual(self.get('/api/courses/manage').json['courses'], [])
        with app.app_context(): db.session.get(User, 1).is_active = False; db.session.commit()
        self.assertEqual(self.get('/api/courses/manage').status_code, 401)

    def test_authorization_contract_draft_and_wrong_entity_deny(self):
        with app.test_request_context():
            session.update(_user_id='1:1', auth_version=1)
            course = db.session.get(Course, self.course_id); module = db.session.get(CourseModule, self.module_id)
            course.status = 'draft'; module.status = 'draft'
            self.assertTrue(course_authorization.can_read_course(course))
            self.assertTrue(course_authorization.can_read_module(module))
            self.assertFalse(course_authorization.can_manage_course(db.session.get(Paper, 1)))
        with app.test_request_context():
            course = db.session.get(Course, self.course_id); course.status = 'draft'
            self.assertFalse(course_authorization.can_read_course(course))

    def test_course_module_resources_share_asset_and_reference_safe_retirement(self):
        source = self.create()
        cr = self.share(source['id']); mr = self.share(source['id'], 'module')
        self.login(None)
        resource = self.get(self.url + '/resources').json['resources'][0]
        self.assertNotIn('asset_id', resource); self.assertNotIn('storageKey', resource)
        self.assertEqual(resource['version'], 1)
        self.assertEqual(self.get(resource['downloadUrl']).data, fixtures.pdf())
        module_resource = self.get(self.url + '/modules/' + self.module_slug + '/resources').json['resources'][0]
        self.login(1)
        replaced = self.upload(method='put', attachment_id=source['id'], data=fixtures.pdf('replacement'))
        self.assertEqual(replaced.status_code, 200)
        self.assertEqual(self.get(resource['downloadUrl']).data, fixtures.pdf())
        self.client.delete(f"/api/papers/1/attachments/{source['id']}")
        with app.app_context():
            asset_id = db.session.get(CourseResource, cr).asset_id
            db.session.delete(db.session.get(CourseResource, cr)); self.service.retire_unreferenced([asset_id]); db.session.commit()
            self.assertIsNotNone(db.session.get(FileAsset, asset_id))
        self.assertEqual(self.get(module_resource['downloadUrl']).data, fixtures.pdf())
        with app.app_context():
            db.session.delete(db.session.get(ModuleResource, mr)); self.service.retire_unreferenced([asset_id]); db.session.commit()
            self.assertIsNone(db.session.get(FileAsset, asset_id)); self.service.drain_cleanup()
        self.assertFalse(self.files())

    def test_unrelated_teacher_cannot_republish_into_course_or_module(self):
        source = self.create()
        with self.assertRaises(AttachmentError): self.share(source['id'], parent_id=self.other_id)
        for kind in ['course', 'module']:
            with self.assertRaises(AttachmentError): self.share(source['id'], kind, uid=2)
        self.assertEqual(len(self.files()), 1)

    def test_resource_access_is_contextual_and_draft_parent_hidden(self):
        source = self.create(); cr = self.share(source['id'], access='staff')
        path = self.url + f'/resources/{cr}/download'
        for uid, expected in [(None, 403), (4, 403), (2, 403), (1, 200), (3, 200)]:
            self.login(uid); self.assertEqual(self.get(path).status_code, expected)
            self.assertEqual(len(self.get(self.url + '/resources').json['resources']), int(expected == 200))
        with app.app_context(): db.session.get(CourseResource, cr).access_level = 'authenticated'; db.session.commit()
        self.login(None); self.assertEqual(self.get(path).status_code, 403)
        self.login(4); self.assertEqual(self.get(path).status_code, 200)
        self.assertEqual(self.get(f'/api/courses/other-course/resources/{cr}/download').status_code, 404)
        with app.test_request_context():
            session.update(_user_id='3:1', auth_version=1)
            relation = db.session.get(CourseResource, cr)
            for parent in [db.session.get(Course, self.other_id), db.session.get(CourseModule, self.module_id), db.session.get(Paper, 1)]:
                with self.assertRaises(AttachmentError): self.service.open('course', parent, relation)
            with self.assertRaises(IntegrityError):
                db.session.delete(relation.asset); db.session.commit()
            db.session.rollback()
        with app.app_context(): db.session.get(Course, self.course_id).status = 'draft'; db.session.commit()
        self.login(3); self.assertEqual(self.get(path).status_code, 404)

    def test_external_resource_has_no_binary_download(self):
        self.login(1); item = self.link().json['attachment']; cr = self.share(item['id'])
        self.login(None)
        value = self.get(self.url + '/resources').json['resources'][0]
        self.assertEqual(value['externalUrl'], 'https://example.test/resource'); self.assertIsNone(value['downloadUrl'])
        self.assertEqual(self.get(self.url + f'/resources/{cr}/download').status_code, 400)
        self.assertFalse(self.files())

    def test_module_adapter_checks_both_source_and_destination_memberships(self):
        source = self.create()
        module_resource = self.share(source['id'], 'module', access='staff')
        with app.app_context():
            fields = {target: canonical_content()['modules'][0][key] for key, target in MODULE_FIELDS.items()}
            other_module = CourseModule(course_id=self.other_id, status='published', **fields)
            db.session.add(other_module); db.session.commit(); other_module_id = other_module.id
        with app.test_request_context():
            session.update(_user_id='1:1', auth_version=1)
            relation = db.session.get(ModuleResource, module_resource)
            target = ModuleResource(module_id=other_module_id, display_name='Denied destination', access_level='public')
            with self.assertRaises(AttachmentError):
                self.service.bind_existing('module', db.session.get(CourseModule, other_module_id), target,
                    source_kind='module', source_resource=db.session.get(CourseModule, self.module_id), source_relation=relation)
        # Source owner can manage Paper B, but cannot manage Module A.
        self.login(2); response = self.upload(paper_id=2)
        self.assertEqual(response.status_code, 201)
        other_source = response.json['attachment']['id']
        with self.assertRaises(AttachmentError): self.share(other_source, 'module', uid=2)
        accepted = self.share(other_source, 'module', parent_id=other_module_id, uid=2)
        self.login(2)
        self.assertEqual(self.get(f'/api/courses/other-course/modules/{self.module_slug}/resources/{accepted}/download').status_code, 200)
        self.assertEqual(self.get(self.url+f'/modules/{self.module_slug}/resources/{module_resource}/download').status_code, 403)
        with app.app_context(): self.assertEqual(ModuleResource.query.count(), 2)

    def test_resource_parent_fk_and_metadata_constraints(self):
        source = self.create(); relation_id = self.share(source['id'], 'module')
        with app.app_context():
            module = db.session.get(CourseModule, self.module_id)
            db.session.delete(module)
            with self.assertRaises(IntegrityError): db.session.commit()
            db.session.rollback()
            for name, value in [('version', 0), ('sort_order', -1), ('access_level', 'unknown')]:
                relation = db.session.get(ModuleResource, relation_id)
                setattr(relation, name, value)
                with self.assertRaises(IntegrityError): db.session.commit()
                db.session.rollback()
            db.session.delete(db.session.get(Course, self.course_id))
            with self.assertRaises(IntegrityError): db.session.commit()
            db.session.rollback()

    def test_bootstrap_collision_does_not_overwrite_runtime_content(self):
        with app.app_context():
            module = db.session.get(CourseModule, self.module_id)
            module.slug = 'runtime-identity'; module.title = 'Runtime content'; db.session.commit()
            with self.assertRaises(ValueError): bootstrap_course(db, Course, CourseModule)
            db.session.rollback()
            self.assertEqual(db.session.get(CourseModule, self.module_id).title, 'Runtime content')
            self.assertEqual(CourseModule.query.filter_by(course_id=self.course_id).count(), 12)

    def test_query_failure_safe_503_and_unknown_slugs_404(self):
        self.assertEqual(self.get('/api/courses/missing').status_code, 404)
        self.assertEqual(self.get(self.url + '/modules/missing').status_code, 404)
        with patch('sqlalchemy.orm.Query.first', side_effect=SQLAlchemyError('private diagnostic')):
            response = self.get(self.url)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private diagnostic', response.get_data(as_text=True))
