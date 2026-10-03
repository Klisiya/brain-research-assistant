"""Additive R5C migration preserves real R5A/R5B records and rejects data loss."""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class AnnotationMigrationTests(unittest.TestCase):
    def test_r5a_r5b_nonempty_preservation_roundtrip_and_guards(self):
        with tempfile.TemporaryDirectory(prefix='annotation-migration-') as folder:
            database=Path(folder)/'fixture.db'
            env={**os.environ,'DATABASE_URL':'sqlite:///'+database.as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            def command(*args,success=True):
                r=subprocess.run([sys.executable,*args],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=60)
                self.assertEqual(r.returncode==0,success,r.stderr);return r
            command('-m','flask','db','upgrade','d42b7c901ea6')
            seed='''
from datetime import datetime
from app import app,db,User,Paper,FileAsset,PaperAttachment,CourseResource,ModuleResource,Enrollment,ModuleProgress,CourseResourceProgress,ModuleResourceProgress,Bookmark,PaperReadingProgress,PaperAttachmentProgress
with app.app_context():
    now=datetime(2026,1,1);db.session.add(User(id=1,username='Learner',email='learner@example.test',password_hash='fixture',role='student'));db.session.flush()
    paper=Paper(slug='preserved',title='Preserved paper',authors=['Original'],publication_type='Research Article',topics=[],difficulty='Beginner',estimated_reading_minutes=5,abstract='Original abstract',learning_objectives=[],keywords=[],resource_category='Foundational',status='published',created_by_id=1);db.session.add(paper);db.session.flush()
    asset=FileAsset(asset_type='external_link',external_url='https://example.test/preserved',created_by_id=1);db.session.add(asset);db.session.flush()
    relation=PaperAttachment(paper_id=paper.id,asset_id=asset.id,attachment_type='external_link',external_url=asset.external_url,display_name='Preserved source',version=3,uploaded_by_id=1);db.session.add(relation)
    db.session.add(CourseResource(id=1,course_id=1,asset_id=asset.id,display_name='Course source',version=3))
    db.session.add(ModuleResource(id=1,module_id=1,asset_id=asset.id,display_name='Module source',version=3))
    e=Enrollment(user_id=1,course_id=1);db.session.add(e);db.session.flush()
    db.session.add(ModuleProgress(enrollment_id=e.id,module_id=1,started_at=now,last_activity_at=now,self_completed_at=now))
    for Model in [CourseResourceProgress,ModuleResourceProgress]:db.session.add(Model(enrollment_id=e.id,resource_id=1,relation_id_at_recording=1,resource_version=3,self_completed_at=now))
    db.session.add(Bookmark(user_id=1,paper_id=paper.id));db.session.add(PaperReadingProgress(user_id=1,paper_id=paper.id,self_completed_at=now))
    db.session.add(PaperAttachmentProgress(user_id=1,paper_id=paper.id,attachment_id=relation.id,relation_id_at_recording=relation.id,attachment_version=3,self_completed_at=now));db.session.commit()
'''
            command('-c',seed)
            with closing(sqlite3.connect(database)) as con:
                tables=[r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name!='alembic_version' ORDER BY name")]
                before={t:con.execute('SELECT * FROM "'+t+'" ORDER BY rowid').fetchall() for t in tables}
            for direction,target in [('upgrade','head'),('downgrade','d42b7c901ea6'),('upgrade','head')]:
                command('-m','flask','db',direction,target)
                with closing(sqlite3.connect(database)) as con:
                    for table,rows in before.items():self.assertEqual(con.execute('SELECT * FROM "'+table+'" ORDER BY rowid').fetchall(),rows,table)
                    self.assertEqual(con.execute('PRAGMA foreign_key_check').fetchall(),[])
                    self.assertEqual(con.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                    self.assertEqual(con.execute('SELECT COUNT(*),SUM(duration_hours) FROM course_modules').fetchone(),(12,36))
                    if direction=='upgrade':
                        for table in ['learning_guided_notes','learning_concept_highlights']:self.assertEqual(con.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)
            for kind in ['note','highlight']:
                with closing(sqlite3.connect(database)) as con:
                    if kind=='note':con.execute("INSERT INTO learning_guided_notes(user_id,paper_id,title,body,note_type,revision,created_at,updated_at) VALUES(1,1,'Title','Body','general',1,'2026-01-01','2026-01-01')")
                    else:con.execute("INSERT INTO learning_concept_highlights(user_id,paper_id,highlight_text,revision,created_at,updated_at) VALUES(1,1,'Concept',1,'2026-01-01','2026-01-01')")
                    con.commit()
                rejected=command('-m','flask','db','downgrade','d42b7c901ea6',success=False)
                self.assertIn('Cannot downgrade nonempty notes or highlights',rejected.stderr)
                with closing(sqlite3.connect(database)) as con:
                    self.assertEqual(con.execute('SELECT version_num FROM alembic_version').fetchone()[0],'e63a9d20bf17')
                    for table,rows in before.items():
                        after=con.execute('SELECT * FROM "'+table+'" ORDER BY rowid').fetchall()
                        if table=='sqlite_sequence':self.assertTrue(all(row in after for row in rows))
                        else:self.assertEqual(after,rows,table)
                    con.execute('DELETE FROM learning_guided_notes');con.execute('DELETE FROM learning_concept_highlights');con.commit()
