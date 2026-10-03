"""Independent SQLite sessions validate optimistic edits and delete/edit races."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class AnnotationConcurrencyTests(unittest.TestCase):
    def test_notes_and_highlights_stale_updates_and_delete_edit_races(self):
        with tempfile.TemporaryDirectory(prefix='annotation-concurrency-') as folder:
            env={**os.environ,'DATABASE_URL':'sqlite:///'+(Path(folder)/'fixture.db').as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            script='''
from concurrent.futures import ThreadPoolExecutor
from app import app,db,User,Paper,GuidedNote,ConceptHighlight
app.config.update(TESTING=True,SECRET_KEY='isolated-annotation-concurrency',ACCOUNT_RATE_LIMIT_ENABLED=False)
with app.app_context():
    db.create_all();db.session.add(User(id=1,username='Learner',email='learner@example.test',password_hash='fixture',role='student'));db.session.flush()
    db.session.add(Paper(id=1,slug='paper',title='Fixture',authors=[],publication_type='Research Article',topics=[],difficulty='Beginner',estimated_reading_minutes=5,abstract='Fixture',learning_objectives=[],keywords=[],resource_category='Foundational',status='published',created_by_id=1));db.session.commit()
def client():
    c=app.test_client()
    with c.session_transaction() as s:s['_user_id']='1:1';s['auth_version']=1
    token=c.get('/api/auth/csrf').json['csrfToken'];return c,{'X-CSRF-Token':token}
for kind,Model in [('notes',GuidedNote),('highlights',ConceptHighlight)]:
    payload={'title':'Original','body':'Body','noteType':'general'} if kind=='notes' else {'highlightText':'Original','comment':None}
    c,h=client();r=c.post('/api/learning/papers/paper/'+kind,json=payload,headers=h);assert r.status_code==201,r.json
    item=r.json['note' if kind=='notes' else 'highlight'];id=item['id']
    def edit(n):
        c,h=client();r=c.patch('/api/learning/'+kind+'/'+str(id),json={**payload,'expectedRevision':1},headers=h);return r.status_code
    with ThreadPoolExecutor(max_workers=8) as pool:statuses=list(pool.map(edit,range(16)))
    assert statuses.count(200)==1 and statuses.count(409)==15,statuses
    with app.app_context():assert db.session.get(Model,id).revision==2
    c,h=client();fresh=c.post('/api/learning/papers/paper/'+kind,json=payload,headers=h).json['note' if kind=='notes' else 'highlight'];rid=fresh['id']
    def race(action):
        c,h=client();url='/api/learning/'+kind+'/'+str(rid)
        r=c.patch(url,json={**payload,'expectedRevision':1},headers=h) if action=='edit' else c.delete(url,json={'expectedRevision':1},headers=h)
        return action,r.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:outcome=dict(pool.map(race,['edit','delete']))
    assert outcome in [{'edit':200,'delete':409},{'edit':404,'delete':200}],outcome
    with app.app_context():
        row=db.session.get(Model,rid)
        assert row is None if outcome['delete']==200 else row.revision==2
    c,h=client();nextrow=c.post('/api/learning/papers/paper/'+kind,json=payload,headers=h).json['note' if kind=='notes' else 'highlight'];assert nextrow['id']>rid
print('ANNOTATION_CONCURRENCY_PASS')
'''
            r=subprocess.run([sys.executable,'-c',script],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=90)
            self.assertEqual(r.returncode,0,r.stderr);self.assertIn('ANNOTATION_CONCURRENCY_PASS',r.stdout)
