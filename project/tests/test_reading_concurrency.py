"""Independent connections serialize duplicate and opposing personal mutations."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ReadingConcurrencyTests(unittest.TestCase):
    def test_duplicate_bookmark_start_complete_and_opposing_actions(self):
        with tempfile.TemporaryDirectory(prefix='reading-concurrency-') as directory:
            env={**os.environ,'DATABASE_URL':'sqlite:///'+(Path(directory)/'fixture.db').as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            script='''
from concurrent.futures import ThreadPoolExecutor
from app import app,db,User,Paper,PaperAttachment,FileAsset,Bookmark,PaperReadingProgress,PaperAttachmentProgress
app.config.update(TESTING=True,SECRET_KEY='isolated-reading-concurrency',ACCOUNT_RATE_LIMIT_ENABLED=False)
with app.app_context():
    db.create_all();db.session.add(User(id=1,username='Learner',email='learner@example.test',password_hash='fixture',role='student'));db.session.flush()
    db.session.add(Paper(id=1,slug='paper',title='Fixture',authors=[],publication_type='Research Article',topics=[],difficulty='Beginner',estimated_reading_minutes=5,abstract='Fixture',learning_objectives=[],keywords=[],resource_category='Foundational',status='published',created_by_id=1));db.session.flush()
    asset=FileAsset(asset_type='external_link',external_url='https://example.test/fixture',created_by_id=1);db.session.add(asset);db.session.flush()
    db.session.add(PaperAttachment(id=1,paper_id=1,asset_id=asset.id,attachment_type='external_link',external_url=asset.external_url,display_name='Fixture link',uploaded_by_id=1));db.session.commit()
def tab(n):
    client=app.test_client()
    with client.session_transaction() as session:session['_user_id']='1:1';session['auth_version']=1
    token=client.get('/api/auth/csrf').json['csrfToken'];headers={'X-CSRF-Token':token}
    for url,payload in [('/api/learning/bookmarks',{'targetType':'paper','targetId':1}),('/api/learning/papers/paper/progress',{'action':'start'}),('/api/learning/papers/paper/progress',{'action':'complete'}),('/api/learning/papers/paper/attachments/1/progress',{'action':'complete','expectedVersion':1})]:
        r=client.post(url,json=payload,headers=headers);assert r.status_code==200,r.json
    return True
with ThreadPoolExecutor(max_workers=8) as pool:assert all(pool.map(tab,range(16)))
with app.app_context():
    assert Bookmark.query.count()==1 and PaperReadingProgress.query.count()==1 and PaperAttachmentProgress.query.count()==1
    assert PaperReadingProgress.query.one().self_completed_at is not None
def race(n):
    client=app.test_client()
    with client.session_transaction() as session:session['_user_id']='1:1';session['auth_version']=1
    token=client.get('/api/auth/csrf').json['csrfToken']
    r=client.post('/api/learning/papers/paper/progress',json={'action':'complete' if n%2 else 'incomplete'},headers={'X-CSRF-Token':token});assert r.status_code==200,r.json
    return True
with ThreadPoolExecutor(max_workers=8) as pool:assert all(pool.map(race,range(16)))
with app.app_context():
    row=PaperReadingProgress.query.one();assert row.started_at and row.last_activity_at
    assert Bookmark.query.count()==1 and PaperAttachmentProgress.query.count()==1
print('READING_CONCURRENT_PASS')
'''
            result=subprocess.run([sys.executable,'-c',script],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=90)
            self.assertEqual(result.returncode,0,result.stderr);self.assertIn('READING_CONCURRENT_PASS',result.stdout)
