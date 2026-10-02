"""Public search contracts, literal matching and cross-table pagination."""
import unittest
from unittest.mock import patch
from sqlalchemy import event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.dialects import postgresql
import test_attachments as fixtures
from app import app, db, Paper, Course, CourseModule, ResearchArea as Area, ResearchAreaModule, BRAIN_REGIONS
from course_content import bootstrap_course
from research_content import bootstrap_research


class SearchTests(unittest.TestCase):
    tearDown = fixtures.AttachmentTests.tearDown
    login = fixtures.AttachmentTests.login

    def setUp(self):
        fixtures.AttachmentTests.setUp(self)
        with app.app_context():
            bootstrap_course(db, Course, CourseModule)
            bootstrap_research(db, Area, ResearchAreaModule, Course, CourseModule, BRAIN_REGIONS)
            p = db.session.get(Paper, 1)
            p.title = 'Exact PaperSignal'; p.authors = ['AuthorSignal', '脑作者']; p.journal = 'JournalSignal'
            p.abstract = 'AbstractSignal'; p.keywords = ['KeywordSignal', '中文关键词']; p.topics = ['TopicSignal']; p.doi = '10.555/DOISignal'
            c = Course.query.first(); c.title = 'CourseSignal'; c.title_zh = '脑科学课程'; c.description = 'CourseDescriptionSignal'
            m = CourseModule.query.filter_by(number=1).first()
            m.title = 'ModuleSignal'; m.title_zh = '学习记忆'; m.description = 'ModuleDescriptionSignal'
            m.learning_focus = 'FocusSignal'; m.category = 'CategorySignal'
            a = db.session.get(Area, 1); a.name = 'AreaSignal'; a.overview = 'AreaOverviewSignal'; a.subtopics = ['SubtopicSignal', '神经中文']
            db.session.commit()
            self.course_id, self.module_id = c.id, m.id

    @classmethod
    def tearDownClass(cls):
        with app.app_context(): db.session.remove(); db.engine.dispose()

    def get(self, q='brain', **params):
        return self.client.get('/api/search', query_string=dict(q=q, **params))

    def test_empty_invalid_repeated_and_unknown_parameters(self):
        for query in [{}, {'q':''}, {'q':'   '}, {'q':'x'*201}, {'q':'a\x00b'}, {'q':'a\nb'}, {'q':'brain','other':'x'}, [('q','brain'),('q','memory')]]:
            response=self.client.get('/api/search',query_string=query)
            self.assertEqual(response.status_code,400);self.assertEqual(response.json['code'],'SEARCH_VALIDATION_ERROR')
        self.assertEqual(self.get('  PaperSignal  ').json['q'],'PaperSignal')

    def test_type_and_pagination_validation(self):
        for key, values in {'type':['foo',''], 'page':['-1','0','1.1','10001','١',''], 'perPage':['0','-1','51','100000','abc']}.items():
            for value in values:
                with self.subTest(key=key,value=value): self.assertEqual(self.get(**{key:value}).status_code,400)

    def test_paper_title_author_journal_abstract_keywords_topics_doi(self):
        for q in ['PaperSignal','AuthorSignal','JournalSignal','AbstractSignal','KeywordSignal','TopicSignal','DOISignal','中文关键词','脑作者']:
            with self.subTest(q=q):
                response=self.get(q,type='papers');self.assertEqual(response.status_code,200)
                self.assertEqual([r['slug'] for r in response.json['items']],['paper-1'])
                item=response.json['items'][0]; self.assertEqual(item['route'],'/papers/paper-1');self.assertNotIn('id',item)
                self.assertEqual(item['metadata']['authors'],['AuthorSignal','脑作者'])

    def test_course_title_chinese_description(self):
        for q in ['CourseSignal','脑科学','CourseDescriptionSignal']:
            with self.subTest(q=q):
                rows=self.get(q,type='courses').json['items'];self.assertEqual(len(rows),1)
                self.assertEqual(rows[0]['titleZh'],'脑科学课程');self.assertTrue(rows[0]['route'].startswith('/course/'))

    def test_module_all_fields_and_chinese_substring(self):
        for q in ['ModuleSignal','学习记忆','记忆','ModuleDescriptionSignal','FocusSignal','CategorySignal']:
            with self.subTest(q=q):
                item=self.get(q,type='modules').json['items'][0]
                self.assertEqual(item['metadata']['number'],1);self.assertEqual(item['titleZh'],'学习记忆')
                self.assertIn(item['courseSlug'],item['route']);self.assertIn(item['moduleSlug'],item['route'])
                self.assertNotIn('id',item);self.assertEqual(item['metadata']['durationHours'],3)

    def test_research_fields_decoded_json_and_no_related_paper_expansion(self):
        for q in ['AreaSignal','AreaOverviewSignal','SubtopicSignal','神经中文','中文']:
            self.assertIn('neuroscience',[r['slug'] for r in self.get(q,type='research').json['items']])
        self.assertEqual(self.get('AuthorSignal',type='research').json['total'],0)

    def test_english_case_insensitive(self):
        self.assertEqual(self.get('pApErSiGnAl').json,self.get('papersignal').json | {'q':'pApErSiGnAl'})

    def test_public_status_boundaries_for_every_type(self):
        for status in ['draft','archived']:
            with app.app_context():
                db.session.get(Paper,1).status=status;db.session.get(Course,self.course_id).status=status
                db.session.get(Area,1).status=status;db.session.commit()
            for q,kind in [('PaperSignal','papers'),('CourseSignal','courses'),('ModuleSignal','modules'),('AreaSignal','research')]:
                with self.subTest(status=status,kind=kind): self.assertEqual(self.get(q,type=kind).json['total'],0)

    def test_unpublished_module_under_published_course_excluded(self):
        for status in ['draft','archived']:
            with app.app_context(): db.session.get(CourseModule,self.module_id).status=status;db.session.commit()
            self.assertEqual(self.get('ModuleSignal',type='modules').json['total'],0)

    def test_admin_teacher_student_and_anonymous_identical_public_results(self):
        anonymous=self.get().json
        for uid in [1,3,4]:
            self.login(uid);self.assertEqual(self.get().json,anonymous)
            self.assertEqual(self.get('Fixture',type='papers').json['total'],1)

    def test_literal_wildcards_and_injection_safe(self):
        with app.app_context():
            db.session.get(Paper,1).title="Literal 50%_\\value 'safe'";db.session.commit()
        for q in ['50%_\\value', "'safe'",'%','_','\\']:
            self.assertEqual([r['slug'] for r in self.get(q).json['items']],['paper-1'])
        self.assertEqual(self.get("' OR 1=1 --").json['total'],0)
        self.assertEqual(self.get('not-present').json['total'],0)

    def test_title_rank_exact_prefix_contains_then_body(self):
        with app.app_context():
            for pid,title,abstract in [(1,'rank',''),(2,'rank title',''),(3,'A rank title',''),(4,'A body only','rank')]:
                p=db.session.get(Paper,pid);p.status='published';p.title=title;p.abstract=abstract
            db.session.commit()
        self.assertEqual([r['slug'] for r in self.get('rank').json['items']],['paper-1','paper-2','paper-3','paper-4'])
        for _ in range(3): self.assertEqual(self.get('rank').json,self.get('rank').json)

    def populate_boundary(self):
        with app.app_context():
            for p in Paper.query.all(): p.title='Boundary';p.status='published'
            for c in Course.query.all(): c.title='Boundary'
            for m in CourseModule.query.all(): m.title='Boundary'
            for a in Area.query.all(): a.name='Boundary'
            for number in range(30):
                db.session.add(Paper(slug=f'boundary-{number}',title='Boundary',authors=[],publication_type='Research Article',topics=[],difficulty='Beginner',estimated_reading_minutes=5,abstract='',learning_objectives=[],keywords=[],resource_category='Foundational',status='published',created_by_id=1))
            db.session.commit()

    def test_global_pagination_over_thirty_matches_no_duplicate_or_missing(self):
        self.populate_boundary()
        response=self.get('Boundary',perPage=20).json
        self.assertEqual(response['total'],53);self.assertEqual(response['totalPages'],3)
        self.assertEqual(response['counts'],dict(papers=34,courses=1,modules=12,research=6))
        all_rows=[]
        for page in [1,2,3]:
            data=self.get('Boundary',perPage=20,page=page).json
            self.assertEqual(data['page'],page);self.assertEqual(data['total'],53);all_rows.extend(data['items'])
        expected=self.get('Boundary',perPage=50).json['items']+self.get('Boundary',perPage=50,page=2).json['items']
        self.assertEqual(all_rows,expected);self.assertEqual(len({r['key'] for r in all_rows}),53)
        self.assertEqual(self.get('Boundary',page=10000).json['items'],[])

    def test_type_filters_counts_and_pagination(self):
        self.populate_boundary()
        for kind,total in [('papers',34),('courses',1),('modules',12),('research',6)]:
            response=self.get('Boundary',type=kind,perPage=5).json
            self.assertEqual(response['total'],total);self.assertTrue(all(r['type']==kind for r in response['items']))
            self.assertEqual(response['counts']['papers'],34)

    def test_multicourse_module_identity_routes(self):
        with app.app_context():
            course=Course(slug='second-course',title='Second',description='',status='published');db.session.add(course);db.session.flush()
            module=CourseModule(course_id=course.id,slug='same-module',number=1,title='OtherModuleSignal',title_zh='另一个',duration_hours=2,category='General',description='',learning_focus='',cover_variant='base',status='published')
            db.session.add(module);db.session.commit()
        row=self.get('OtherModuleSignal').json['items'][0]
        self.assertEqual(row['route'],'/course/second-course/modules/same-module');self.assertEqual(row['key'],'modules:second-course/same-module')

    def test_only_page_hydrated_no_n_plus_one(self):
        self.populate_boundary();statements=[]
        def count(_connection,_cursor,statement,_parameters,_context,_many): statements.append(statement)
        with app.app_context():
            event.listen(db.engine,'before_cursor_execute',count)
            try: result=app.extensions['search_service'].search(dict(q='Boundary',type='all',page=3,perPage=20))
            finally: event.remove(db.engine,'before_cursor_execute',count)
        self.assertEqual(len(result['items']),13);self.assertLessEqual(len(statements),6)
        self.assertIn('LIMIT',statements[1].upper());self.assertTrue(any('JOIN courses' in s for s in statements[2:]))

    def test_safe_excerpt_and_no_private_fields_or_entities(self):
        with app.app_context(): db.session.get(Paper,1).abstract='long ' * 500;db.session.commit()
        response=self.get('PaperSignal');item=response.json['items'][0]
        self.assertLessEqual(len(item['summary']),260)
        self.assertFalse({'created_by_id','assetId','storageKey','status','password','id'} & set(item))
        self.assertEqual(response.headers['Cache-Control'],'private, no-store');self.assertIn('Cookie',response.headers['Vary'])
        self.assertEqual(response.headers['X-Content-Type-Options'],'nosniff')

    def test_database_failure_safe_error_and_retry(self):
        with patch.object(app.extensions['search_service'],'search',side_effect=SQLAlchemyError('internal secret')):
            response=self.get();self.assertEqual(response.status_code,503);self.assertEqual(response.json['code'],'SEARCH_UNAVAILABLE')
            self.assertNotIn('secret',response.get_data(as_text=True))
        self.assertEqual(self.get().status_code,200)

    def test_publication_rechecked_after_candidate_query(self):
        for q, Model, identity in [('PaperSignal',Paper,1),('ModuleSignal',Course,self.course_id)]:
            with app.app_context():
                execute=db.session.execute; calls=0
                def changing(statement,*args,**kwargs):
                    nonlocal calls
                    calls+=1
                    if calls==3:
                        execute(Model.__table__.update().where(Model.id==identity).values(status='archived'))
                    return execute(statement,*args,**kwargs)
                with patch.object(db.session,'execute',side_effect=changing):
                    response=app.extensions['search_service'].search(dict(q=q,type='all',page=1,perPage=12))
                self.assertEqual(response['items'],[])
                db.session.rollback()

    def test_postgresql_json_candidate_compiles_with_parameters(self):
        with app.app_context():
            with patch.object(type(db.engine.dialect),'name','postgresql'):
                query=app.extensions['search_service'].providers('神经中文')[3]
                compiled=query.compile(dialect=postgresql.dialect())
        self.assertIn('json_array_elements_text',str(compiled));self.assertIn('神经中文',str(compiled.params))
        self.assertNotIn('神经中文',str(compiled))


if __name__ == '__main__': unittest.main()
