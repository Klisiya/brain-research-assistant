"""Retired content cannot overwrite unknown edits or alter private learning history."""
import copy
import unittest

from sqlalchemy import text
import test_course_management as fixtures
from app import (app, db, Course, CourseModule, ResearchArea, ResearchAreaModule,
                 Paper, PaperAttachment, CourseResource, CourseModulePaper, ResearchAreaPaper, BRAIN_REGIONS)
from content_authority import clean_content, fingerprint, retired_content
from course_content import bootstrap_course, canonical_content
from research_content import bootstrap_research


class ContentAuthorityTests(unittest.TestCase):
    setUp = fixtures.CourseManagementTests.setUp
    tearDown = fixtures.CourseManagementTests.tearDown
    tearDownClass = fixtures.CourseManagementTests.tearDownClass
    login = fixtures.CourseManagementTests.login
    resource = fixtures.CourseManagementTests.resource
    get = fixtures.CourseManagementTests.get

    def snapshot(self, connection):
        return {name: connection.execute(text('SELECT * FROM "' + name + '" ORDER BY rowid')).all()
                for name in db.metadata.tables}

    def rule(self, value, empty=''):
        return {'sha256': fingerprint(value), 'empty': empty}

    def test_fresh_bootstrap_blanks_and_idempotent_preserved_structure(self):
        with app.app_context():
            course, added = bootstrap_course(db, Course, CourseModule)
            self.assertEqual(added, 0)
            self.assertEqual((course.title, course.description), ('', ''))
            self.assertEqual(len(course.modules), 12)
            for module, expected in zip(course.modules, canonical_content()['modules']):
                self.assertEqual((module.number, module.slug, module.title, module.title_zh, module.duration_hours),
                                 (expected['number'], expected['slug'], expected['title'], expected['titleZh'], 3))
                self.assertEqual((module.description, module.learning_focus, module.category), ('', '', ''))
            self.assertEqual(ResearchArea.query.count(), 6)
            self.assertEqual(ResearchAreaModule.query.count(), 5)
            for area in ResearchArea.query.all():
                self.assertEqual((area.overview, area.subtopics), ('', []))
            self.assertEqual(bootstrap_research(db, ResearchArea, ResearchAreaModule,
                                              Course, CourseModule, BRAIN_REGIONS), 0)
            course.title = 'User-confirmed title'
            course.description = 'User-provided description'
            db.session.commit()
            bootstrap_course(db, Course, CourseModule)
            self.assertEqual(course.title, 'User-confirmed title')
            self.assertEqual(course.description, 'User-provided description')
        public = self.get('/api/courses/' + self.slug).json['course']
        self.assertEqual(public['categories'], [])
        self.assertEqual((public['moduleCount'], public['totalHours']), (12, 36))
        self.assertEqual(self.get(self.public).status_code, 200)
        self.assertEqual(self.get('/api/research-areas/neuroscience').status_code, 200)
        before = self.get('/api/papers').json
        result = app.test_cli_runner().invoke(args=['seed-papers'])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn('Demo seeding is disabled', result.output)
        self.assertEqual(self.get('/api/papers').json, before)

    def test_actual_fingerprints_match_exact_text_not_near_matches(self):
        # Historical category values are audit fixtures, never teaching seeds.
        with app.app_context():
            one = db.session.get(CourseModule, 1)
            two = db.session.get(CourseModule, 2)
            one.category = 'Brain Foundations'
            two.category = 'Structure and Networks '
            db.session.commit()
            original_stamp = one.updated_at
            db.session.remove()
            with db.engine.begin() as connection:
                report = clean_content(connection, apply=True)
            self.assertEqual(report['changed'], 1)
            self.assertEqual(db.session.get(CourseModule, 1).category, '')
            self.assertGreater(db.session.get(CourseModule, 1).updated_at, original_stamp)
            self.assertEqual(db.session.get(CourseModule, 2).category, 'Structure and Networks ')
            self.assertTrue(any(r.get('id') == 2 and r['field'] == 'category' for r in report['preserved']))
            # An identical slug in another course is not part of the cleanup.
            self.assertEqual(db.session.get(CourseModule, 13).category, 'Other')
            db.session.remove()
            with db.engine.begin() as connection:
                self.assertEqual(clean_content(connection, apply=True)['changed'], 0)

    def test_lists_are_exact_and_unknown_rows_survive_dry_run_and_apply(self):
        manifest = copy.deepcopy(retired_content())
        area_rules = [entry for entry in manifest if entry['table'] == 'research_areas']
        for entry in area_rules:
            entry['fields']['subtopics'] = self.rule(['TEST A', 'TEST B'], [])
        with app.app_context():
            db.session.get(ResearchArea, 1).subtopics = ['TEST A', 'TEST B']
            db.session.get(ResearchArea, 2).subtopics = ['TEST B', 'TEST A']
            db.session.get(ResearchArea, 3).subtopics = ['TEST A', 'TEST B', 'User addition']
            db.session.commit(); db.session.remove()
            with db.engine.begin() as connection:
                before = self.snapshot(connection)
                audit = clean_content(connection, manifest=manifest)
                self.assertEqual(audit['changed'], 0)
                self.assertEqual(self.snapshot(connection), before)
                self.assertTrue(any(r['field'] == '*' for r in audit['preserved']))
                result = clean_content(connection, apply=True, manifest=manifest)
                self.assertEqual(result['changed'], 1)
            self.assertEqual(db.session.get(ResearchArea, 1).subtopics, [])
            self.assertEqual(db.session.get(ResearchArea, 2).subtopics, ['TEST B', 'TEST A'])
            self.assertEqual(db.session.get(ResearchArea, 3).subtopics, ['TEST A', 'TEST B', 'User addition'])

    def test_paper_retirement_requires_exact_record_and_preserves_unknown_fields(self):
        with app.app_context():
            paper = db.session.get(Paper, 1)
            manifest = [{'table': 'papers', 'selector': {'id': 1},
                         'fields': {'abstract': self.rule(paper.abstract)},
                         'retire_when': {'title': fingerprint(paper.title), 'status': fingerprint('published')}}]
            original_title = paper.title
            paper.title = 'User title'; db.session.commit(); db.session.remove()
            with db.engine.begin() as connection:
                clean_content(connection, apply=True, manifest=manifest)
            self.assertEqual(db.session.get(Paper, 1).title, 'User title')
            self.assertEqual(db.session.get(Paper, 1).status, 'published')
            db.session.get(Paper, 1).title = original_title
            db.session.commit(); db.session.remove()
            with db.engine.begin() as connection:
                clean_content(connection, apply=True, manifest=manifest)
            self.assertEqual(db.session.get(Paper, 1).status, 'archived')
            self.assertEqual(Paper.query.count(), 4)

    def test_nonempty_relationships_history_and_cas_survive(self):
        course_resource = self.resource().json['resources'][-1]
        module_resource = self.resource(self.module).json['resources'][-1]
        with app.app_context():
            paper = db.session.get(Paper, 1)
            slug = paper.slug
            asset_id = db.session.get(CourseResource, course_resource['id']).asset_id
            db.session.add(PaperAttachment(paper_id=1, asset_id=asset_id, attachment_type='external_link',
                                          display_name='TEST LINK', external_url='https://example.test/content',
                                          access_level='public', version=1, sort_order=0, uploaded_by_id=1))
            db.session.add(CourseModulePaper(module_id=1, paper_id=1, reading_type='required', sort_order=0))
            db.session.add(ResearchAreaPaper(research_area_id=1, paper_id=1, sort_order=0))
            db.session.get(CourseModule, 1).category = 'Brain Foundations'
            db.session.commit()
            attachment_id = PaperAttachment.query.one().id
        self.login(4)
        self.assertEqual(self.client.post('/api/learning/courses/' + self.slug + '/enroll', json={}).status_code, 200)
        prefix = '/api/learning/courses/' + self.slug
        self.assertEqual(self.client.post(prefix+'/modules/'+self.module_slug+'/progress', json={'action':'complete'}).status_code, 200)
        for path, resource in [(prefix, course_resource), (prefix+'/modules/'+self.module_slug, module_resource)]:
            self.assertEqual(self.client.post(path+f"/resources/{resource['id']}/progress",
                                             json={'action':'complete','expectedVersion':1}).status_code, 200)
        root = '/api/learning/papers/' + slug
        self.assertEqual(self.client.post(root+'/progress', json={'action':'start'}).status_code, 200)
        self.assertEqual(self.client.post(root+f'/attachments/{attachment_id}/progress',
                                         json={'action':'complete','expectedVersion':1}).status_code, 200)
        for kind, payload in [('notes', {'title':'Private','body':'TEST NOTE','noteType':'general'}),
                              ('highlights', {'highlightText':'TEST HIGHLIGHT'})]:
            self.assertEqual(self.client.post(root+'/'+kind, json={**payload, 'attachmentId':attachment_id,
                                                                  'expectedVersion':1}).status_code, 201)
        self.assertIn(self.client.post('/api/learning/bookmarks', json={'targetType':'module','targetId':1}).status_code, [200,201])
        self.login(1)
        stamp = self.get(self.module+'/manage').json['module']['updatedAt']
        with app.app_context():
            db.session.remove()
            with db.engine.begin() as connection:
                before = self.snapshot(connection)
                report = clean_content(connection, apply=True)
                self.assertEqual(report['changed'], 1)
                after = self.snapshot(connection)
                for table in before:
                    if table != 'course_modules': self.assertEqual(before[table], after[table], table)
                for table in ['learning_enrollments','learning_module_progress','learning_course_resource_progress',
                              'learning_module_resource_progress','learning_paper_progress','learning_paper_attachment_progress',
                              'learning_bookmarks','learning_guided_notes','learning_concept_highlights',
                              'course_module_papers','research_area_papers','file_assets','paper_attachments']:
                    self.assertTrue(before[table], table)
                self.assertEqual(connection.execute(text('PRAGMA foreign_key_check')).all(), [])
        self.assertEqual(self.client.patch(self.module, json={'description':'Stale restore',
                                                              'expectedUpdatedAt':stamp}).status_code, 409)

    def test_empty_editor_fields_remain_valid_and_cli_dry_run_does_not_write(self):
        row = self.get(self.module+'/manage').json['module']
        response = self.client.patch(self.module, json={'description':'', 'category':'', 'learningFocus':'',
                                                       'expectedUpdatedAt':row['updatedAt']})
        self.assertEqual(response.status_code, 200)
        self.login(3)
        area = self.get('/api/research-areas/1/manage').json['area']
        self.assertEqual(self.client.patch('/api/research-areas/1', json={'overview':'', 'subtopics':[],
                                          'expectedUpdatedAt':area['updatedAt']}).status_code, 200)
        with app.app_context():
            db.session.get(CourseModule, 1).category = 'Brain Foundations'; db.session.commit()
        result = app.test_cli_runner().invoke(args=['cleanup-content-authority'])
        self.assertEqual(result.exit_code, 0, result.output)
        with app.app_context(): self.assertEqual(db.session.get(CourseModule, 1).category, 'Brain Foundations')

    def test_failed_cleanup_transaction_rolls_back(self):
        with app.app_context():
            db.session.get(CourseModule, 1).category = 'Brain Foundations'; db.session.commit(); db.session.remove()
            with self.assertRaises(RuntimeError):
                with db.engine.begin() as connection:
                    clean_content(connection, apply=True)
                    raise RuntimeError('TEST interrupted transaction')
            self.assertEqual(db.session.get(CourseModule, 1).category, 'Brain Foundations')
