"""R5B upgrade preserves active R5A state and all existing rows."""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class ReadingMigrationTests(unittest.TestCase):
    def test_additive_roundtrip_including_nonempty_r5a_and_guard(self):
        with tempfile.TemporaryDirectory(prefix='reading-migration-') as folder:
            database=Path(folder)/'fixture.db'
            environment={**os.environ,'DATABASE_URL':'sqlite:///'+database.as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            def migrate(direction,target,success=True):
                r=subprocess.run([sys.executable,'-m','flask','db',direction,target],cwd=Path(__file__).resolve().parents[1],env=environment,capture_output=True,text=True,timeout=60)
                self.assertEqual(r.returncode==0,success,r.stderr);return r
            migrate('upgrade','c8f14a205d72')
            with closing(sqlite3.connect(database)) as con:
                con.execute("PRAGMA foreign_keys=ON")
                con.execute("INSERT INTO user(id,username,email,password_hash,role,created_at,auth_version) VALUES(1,'Learner','learner@example.test','fixture','student','2026-01-01',1)")
                con.execute("INSERT INTO learning_enrollments(id,user_id,course_id,state,completion_rule_version,enrolled_at,last_activity_at) VALUES(1,1,1,'active',1,'2026-01-01','2026-01-02')")
                con.execute("INSERT INTO learning_module_progress(enrollment_id,module_id,started_at,last_activity_at,self_completed_at) VALUES(1,1,'2026-01-01','2026-01-02','2026-01-02')")
                con.execute("INSERT INTO file_assets(id,asset_type,external_url,created_by_id,created_at,updated_at) VALUES(1,'external_link','https://example.test/fixture',1,'2026-01-01','2026-01-02')")
                for kind in ['course','module']:
                    con.execute(f"INSERT INTO {kind}_resources(id,{kind}_id,asset_id,display_name,access_level,version,sort_order,created_at,updated_at) VALUES(1,1,1,'Fixture','public',2,0,'2026-01-01','2026-01-02')")
                    con.execute(f"INSERT INTO learning_{kind}_resource_progress(enrollment_id,resource_id,relation_id_at_recording,resource_version,started_at,last_activity_at,self_completed_at) VALUES(1,1,1,2,'2026-01-01','2026-01-02','2026-01-02')")
                con.commit()
                tables=[r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name!='alembic_version' ORDER BY name")]
                before={t:con.execute('SELECT * FROM "'+t+'" ORDER BY rowid').fetchall() for t in tables}
            for direction,target in [('upgrade','head'),('downgrade','c8f14a205d72'),('upgrade','head')]:
                migrate(direction,target)
                with closing(sqlite3.connect(database)) as con:
                    for table,rows in before.items():self.assertEqual(con.execute('SELECT * FROM "'+table+'" ORDER BY rowid').fetchall(),rows,table)
                    self.assertEqual(con.execute('PRAGMA foreign_key_check').fetchall(),[])
                    self.assertEqual(con.execute('SELECT COUNT(*),SUM(duration_hours) FROM course_modules').fetchone(),(12,36))
                    if direction=='upgrade':
                        for t in ['learning_bookmarks','learning_paper_progress','learning_paper_attachment_progress']:self.assertEqual(con.execute('SELECT COUNT(*) FROM '+t).fetchone()[0],0)
            with closing(sqlite3.connect(database)) as con:
                con.execute("INSERT INTO learning_bookmarks(user_id,course_id,created_at) VALUES(1,1,'2026-01-03')");con.commit()
            rejected=migrate('downgrade','c8f14a205d72',False)
            self.assertIn('Cannot downgrade nonempty bookmark or reading history',rejected.stderr)
            with closing(sqlite3.connect(database)) as con:
                self.assertEqual(con.execute('SELECT version_num FROM alembic_version').fetchone()[0],'d42b7c901ea6')
                for table,rows in before.items():self.assertEqual(con.execute('SELECT * FROM "'+table+'" ORDER BY rowid').fetchall(),rows,table)
