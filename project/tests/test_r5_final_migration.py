"""Nonempty R5 chain retains each generation of private state and versions."""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class R5FinalMigrationTests(unittest.TestCase):
    def test_full_chain_nonempty_history_and_safe_downgrade(self):
        with tempfile.TemporaryDirectory(prefix='r5-final-migration-') as folder:
            database=Path(folder)/'fixture.db'
            env={**os.environ,'DATABASE_URL':'sqlite:///'+database.as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            def command(*args,success=True):
                result=subprocess.run([sys.executable,*args],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=60)
                self.assertEqual(result.returncode==0,success,result.stderr)
                return result
            def snapshot():
                with closing(sqlite3.connect(database)) as c:
                    self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])
                    self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                    return {r[0]:c.execute('SELECT * FROM "'+r[0]+'" ORDER BY rowid').fetchall() for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('alembic_version','sqlite_sequence') ORDER BY name").fetchall()}
            def preserved(before):
                after=snapshot()
                for name,rows in before.items():self.assertEqual(after[name],rows,name)
            command('-m','flask','db','upgrade','b9e27f104c63')
            command('-c','''
from app import app,db,User,Paper,FileAsset,PaperAttachment,CourseResource,ModuleResource
with app.app_context():
    db.session.add(User(id=1,username='Learner',email='learner@example.test',password_hash='fixture',role='student'));db.session.flush()
    db.session.add(Paper(id=1,slug='preserved',title='Preserved',authors=[],publication_type='Research Article',topics=[],difficulty='Beginner',estimated_reading_minutes=5,abstract='Original',learning_objectives=[],keywords=[],resource_category='Foundational',status='published',created_by_id=1));db.session.flush()
    asset=FileAsset(asset_type='external_link',external_url='https://example.test/v2',created_by_id=1);db.session.add(asset);db.session.flush()
    db.session.add(PaperAttachment(id=1,paper_id=1,asset_id=asset.id,attachment_type='external_link',external_url=asset.external_url,display_name='Paper source',version=2,uploaded_by_id=1))
    db.session.add(CourseResource(id=1,course_id=1,asset_id=asset.id,display_name='Course source',version=2))
    db.session.add(ModuleResource(id=1,module_id=1,asset_id=asset.id,display_name='Module source',version=2));db.session.commit()
''')
            public=snapshot()
            command('-m','flask','db','upgrade','head');preserved(public)
            command('-m','flask','db','downgrade','b9e27f104c63');self.assertEqual(snapshot(),public)
            command('-m','flask','db','upgrade','c8f14a205d72');preserved(public)
            command('-c','''
from datetime import datetime
from app import app,db,Enrollment,ModuleProgress,CourseResourceProgress,ModuleResourceProgress
with app.app_context():
    now=datetime(2026,1,1);db.session.add(Enrollment(id=1,user_id=1,course_id=1));db.session.flush()
    db.session.add_all([ModuleProgress(enrollment_id=1,module_id=i,started_at=now,self_completed_at=now if i<=2 else None) for i in range(1,13)])
    for Model in [CourseResourceProgress,ModuleResourceProgress]:
        for version in [1,2]:db.session.add(Model(enrollment_id=1,resource_id=1,relation_id_at_recording=1,resource_version=version,self_completed_at=now))
    db.session.commit()
''')
            a=snapshot();command('-m','flask','db','downgrade','b9e27f104c63',success=False);self.assertEqual(snapshot(),a)
            command('-m','flask','db','upgrade','d42b7c901ea6');preserved(a)
            command('-c','''
from datetime import datetime
from app import app,db,Bookmark,PaperReadingProgress,PaperAttachmentProgress
with app.app_context():
    now=datetime(2026,1,1);db.session.add(Bookmark(user_id=1,paper_id=1));db.session.add(PaperReadingProgress(user_id=1,paper_id=1,self_completed_at=now))
    for version in [1,2]:db.session.add(PaperAttachmentProgress(user_id=1,paper_id=1,attachment_id=1,relation_id_at_recording=1,attachment_version=version,self_completed_at=now))
    db.session.commit()
''')
            b=snapshot();command('-m','flask','db','downgrade','c8f14a205d72',success=False);self.assertEqual(snapshot(),b)
            command('-m','flask','db','upgrade','e63a9d20bf17');preserved(b)
            command('-c','''
from app import app,db,GuidedNote,ConceptHighlight
with app.app_context():
    fields=dict(user_id=1,paper_id=1,attachment_id=1,attachment_relation_id_at_recording=1,resource_version=1)
    db.session.add(GuidedNote(**fields,title='Own title',body='Own text',note_type='general'));db.session.add(ConceptHighlight(**fields,highlight_text='Own concept'));db.session.commit()
''')
            c=snapshot();command('-m','flask','db','upgrade','head');self.assertEqual(snapshot(),c)
            command('-m','flask','db','downgrade','d42b7c901ea6',success=False);self.assertEqual(snapshot(),c)
            command('-m','flask','db','check')
