"""Independent connections cannot lose Hub edits or double-review a revision."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class HubConcurrencyTests(unittest.TestCase):
    def test_editor_and_moderation_compare_and_swap(self):
        with tempfile.TemporaryDirectory(prefix='TEST-ONLY-hub-races-') as folder:
            env={**os.environ,'DATABASE_URL':'sqlite:///'+(Path(folder)/'fixture.db').as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            script='''
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from app import app,db,User,HubEntry,HubRevision,HubModerationEvent
app.config.update(TESTING=True,SECRET_KEY='TEST ONLY concurrency',ACCOUNT_RATE_LIMIT_ENABLED=False)
with app.app_context():
    db.create_all()
    for i,role in [(1,'teacher'),(2,'admin'),(3,'admin')]:
        db.session.add(User(id=i,username='TEST ONLY '+str(i),email=str(i)+'@example.test',password_hash='TEST ONLY',role=role))
    db.session.commit()
def client(uid):
    c=app.test_client()
    with c.session_transaction() as s:s['_user_id']=str(uid)+':1';s['auth_version']=1
    return c,{'X-CSRF-Token':c.get('/api/auth/csrf').json['csrfToken']}
c,h=client(1);entry=c.post('/api/hub/entries',json={'title':'TEST ONLY'},headers=h).json['entry']
barrier=Barrier(2)
def edit(n):
    c,h=client(1);barrier.wait()
    return c.patch('/api/hub/entries/1',json={'expectedVersion':entry['version'],'title':'TEST ONLY '+str(n)},headers=h).status_code
with ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(edit,[1,2]))==[200,409]
c,h=client(1);entry=c.get('/api/hub/entries/1/manage').json['entry']
entry=c.post('/api/hub/entries/1/submit',json={'expectedVersion':entry['version']},headers=h).json['entry']
barrier=Barrier(2)
def review(n):
    c,h=client(n);barrier.wait()
    return c.post('/api/hub/entries/1/'+('approve' if n==2 else 'reject'),json={'expectedVersion':entry['version'],**({'reviewNote':'TEST ONLY'} if n==3 else {})},headers=h).status_code
with ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(review,[2,3]))==[200,409]
with app.app_context():
    entry=db.session.get(HubEntry,1);revision=db.session.get(HubRevision,1)
    assert (revision.state=='approved')==(entry.published_revision_id==1)
    assert HubModerationEvent.query.filter(HubModerationEvent.action.in_(['approved','rejected'])).count()==1
print('HUB_CONCURRENCY_PASS')
'''
            result=subprocess.run([sys.executable,'-c',script],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=60)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn('HUB_CONCURRENCY_PASS',result.stdout)
