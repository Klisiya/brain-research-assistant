"""Independent SQLite connections exercise simultaneous learner retries."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class LearningConcurrencyTests(unittest.TestCase):
    def test_concurrent_enrollment_module_and_version_progress(self):
        with tempfile.TemporaryDirectory(prefix='learning-concurrency-') as directory:
            environment = {**os.environ, 'DATABASE_URL': 'sqlite:///' + (Path(directory)/'fixture.db').as_posix(), 'ACCOUNT_MAIL_MODE': 'disabled'}
            script = '''
from concurrent.futures import ThreadPoolExecutor
from app import app,db,User,Course,CourseModule,FileAsset,CourseResource,Enrollment,ModuleProgress,CourseResourceProgress
from course_content import bootstrap_course
app.config.update(TESTING=True,SECRET_KEY='isolated-concurrency',ACCOUNT_RATE_LIMIT_ENABLED=False)
with app.app_context():
    db.create_all()
    user=User(id=1,username='Learner',email='learner@example.test',role='student');user.set_password('isolated-password');db.session.add(user);db.session.flush()
    course,_=bootstrap_course(db,Course,CourseModule);slug=course.slug;module=course.modules[0].slug
    asset=FileAsset(asset_type='external_link',external_url='https://example.test/resource',created_by_id=1);db.session.add(asset);db.session.flush()
    db.session.add(CourseResource(id=1,course_id=course.id,asset_id=asset.id,display_name='Reference',access_level='public'));db.session.commit()
def tab(number):
    client=app.test_client()
    with client.session_transaction() as session:session['_user_id']='1:1';session['auth_version']=1;session['_fresh']=True
    token=client.get('/api/auth/csrf').json['csrfToken'];headers={'X-CSRF-Token':token}
    root='/api/learning/courses/'+slug
    for url,payload in [(root+'/enroll',{}),(root+'/modules/'+module+'/progress',{'action':'complete'}),(root+'/resources/1/progress',{'action':'complete','expectedVersion':1})]:
        response=client.post(url,json=payload,headers=headers)
        assert response.status_code==200,response.json
    return True
with ThreadPoolExecutor(max_workers=8) as pool:assert all(pool.map(tab,range(16)))
with app.app_context():
    assert Enrollment.query.count()==1
    assert ModuleProgress.query.count()==12
    assert ModuleProgress.query.filter(ModuleProgress.self_completed_at.isnot(None)).count()==1
    assert CourseResourceProgress.query.count()==1
    assert ModuleProgress.query.filter(ModuleProgress.verified_completed_at.isnot(None)).count()==0
print('CONCURRENT_TABS_PASS')
'''
            result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).resolve().parents[1], env=environment, capture_output=True, text=True, timeout=90)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('CONCURRENT_TABS_PASS', result.stdout)
