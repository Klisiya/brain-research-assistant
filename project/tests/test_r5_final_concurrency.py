"""Actual resource replacement races with independent learner connections."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class R5FinalConcurrencyTests(unittest.TestCase):
    def test_replacement_progress_and_editor_cas(self):
        with tempfile.TemporaryDirectory(prefix='r5-races-') as folder:
            env={**os.environ,'DATABASE_URL':'sqlite:///'+(Path(folder)/'fixture.db').as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            script='''
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from app import app,db,User,Course,CourseModule,FileAsset,CourseResource,ModuleResource,Paper,PaperAttachment,CourseResourceProgress,ModuleResourceProgress,PaperAttachmentProgress,ModuleProgress
from course_content import bootstrap_course
app.config.update(TESTING=True,SECRET_KEY='isolated-r5-concurrency',ACCOUNT_RATE_LIMIT_ENABLED=False)
with app.app_context():
    db.create_all()
    db.session.add_all([User(id=i,username='User'+str(i),email=str(i)+'@example.test',password_hash='fixture',role=role) for i,role in [(1,'admin'),(2,'student')]]);db.session.flush()
    course,_=bootstrap_course(db,Course,CourseModule);slug=course.slug;mslug=course.modules[0].slug
    db.session.add(Paper(id=1,slug='paper',title='Fixture',authors=[],publication_type='Research Article',topics=[],difficulty='Beginner',estimated_reading_minutes=5,abstract='Fixture',learning_objectives=[],keywords=[],resource_category='Foundational',status='published',created_by_id=1));db.session.flush()
    for Model,fields in [(CourseResource,dict(course_id=1)),(ModuleResource,dict(module_id=1)),(PaperAttachment,dict(paper_id=1,attachment_type='external_link',external_url='https://example.test/v1',uploaded_by_id=1))]:
        asset=FileAsset(asset_type='external_link',external_url='https://example.test/v1',created_by_id=1);db.session.add(asset);db.session.flush();db.session.add(Model(id=1,asset_id=asset.id,display_name='Resource',**fields))
    db.session.commit()
def client(uid):
    c=app.test_client()
    with c.session_transaction() as s:s['_user_id']=str(uid)+':1';s['auth_version']=1
    return c,{'X-CSRF-Token':c.get('/api/auth/csrf').json['csrfToken']}
c,h=client(2);assert c.post('/api/learning/courses/'+slug+'/enroll',json={},headers=h).status_code==200
cases=[(CourseResource,CourseResourceProgress,'/api/courses/1/resources','/api/learning/courses/'+slug+'/resources/1/progress'),(ModuleResource,ModuleResourceProgress,'/api/courses/1/modules/1/resources','/api/learning/courses/'+slug+'/modules/'+mslug+'/resources/1/progress'),(PaperAttachment,PaperAttachmentProgress,'/api/papers/1/attachments','/api/learning/papers/paper/attachments/1/progress')]
for Model,Progress,base,learning in cases:
    token={}
    if Model!=PaperAttachment:
        c,h=client(1);row=c.get(base+'/manage').json['resources'][0];token=dict(expectedVersion=row['version'],expectedUpdatedAt=row['updatedAt'])
    barrier=Barrier(2)
    def replace():
        c,h=client(1);barrier.wait();r=c.put(base+'/1',json={**token,'externalUrl':'https://example.test/v2'},headers=h);assert r.status_code==200,r.json;return r.status_code
    def learn():
        c,h=client(2);barrier.wait();r=c.post(learning,json={'action':'complete','expectedVersion':1},headers=h);assert r.status_code in [200,409],r.json;return r.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        replacement=pool.submit(replace);action=pool.submit(learn);assert replacement.result()==200;outcome=action.result()
    with app.app_context():
        assert db.session.get(Model,1).version==2
        rows=Progress.query.all();assert len(rows)==(1 if outcome==200 else 0)
        for row in rows:assert (row.attachment_version if Model==PaperAttachment else row.resource_version)==1
    c,h=client(2);assert c.post(learning,json={'action':'complete','expectedVersion':1},headers=h).status_code==409
c,h=client(1);row=c.get('/api/courses/1/resources/manage').json['resources'][0];token=dict(expectedVersion=row['version'],expectedUpdatedAt=row['updatedAt']);barrier=Barrier(2)
def edit(n):
    c,h=client(1);barrier.wait();return c.patch('/api/courses/1/resources/1',json={**token,'displayName':'Editor '+str(n)},headers=h).status_code
with ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(edit,[1,2]))==[200,409]
def module_action(n):
    c,h=client(2);return c.post('/api/learning/courses/'+slug+'/modules/'+mslug+'/progress',json={'action':'complete' if n%2 else 'incomplete'},headers=h).status_code
with ThreadPoolExecutor(max_workers=8) as pool:assert set(pool.map(module_action,range(16)))=={200}
with app.app_context():
    assert ModuleProgress.query.count()==12
    row=ModuleProgress.query.filter_by(module_id=1).one();assert row.started_at and row.last_activity_at and row.verified_completed_at is None
print('R5_FINAL_CONCURRENCY_PASS')
'''
            result=subprocess.run([sys.executable,'-c',script],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=90)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn('R5_FINAL_CONCURRENCY_PASS',result.stdout)
