"""TEST ONLY additive schema preservation and governance downgrade guard."""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class DiscussionMigrationTests(unittest.TestCase):
    def test_existing_hub_content_preserved_no_seeds_and_nonempty_downgrade_refused(self):
        with tempfile.TemporaryDirectory(prefix='TEST-ONLY-discussion-migration-') as folder:
            path=Path(folder)/'isolated.db'
            env={**os.environ,'DATABASE_URL':'sqlite:///'+path.as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            def migrate(direction,target,success=True):
                result=subprocess.run([sys.executable,'-m','flask','db',direction,target],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=90)
                self.assertEqual(result.returncode==0,success,result.stderr);return result
            migrate('upgrade','b3d970ef624a')
            with closing(sqlite3.connect(path)) as connection:
                connection.execute("INSERT INTO user(id,username,email,password_hash,role,created_at,auth_version) VALUES(1,'TEST ONLY','test@example.test','TEST ONLY','admin','2026-01-01',1)")
                connection.execute("INSERT INTO hub_entries(id,kind,owner_id,working_revision_id,version,created_at,updated_at) VALUES(1,'industry',1,1,2,'2026-01-01','2026-01-01')")
                connection.execute("INSERT INTO hub_revisions(id,entry_id,number,state,title,body,source_name,created_at) VALUES(1,1,1,'draft','TEST ONLY preserved','TEST ONLY body','TEST ONLY source','2026-01-01')")
                connection.commit()
                tables=[row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('alembic_version','sqlite_sequence')")]
                before={table:connection.execute('SELECT * FROM "'+table+'" ORDER BY rowid').fetchall() for table in tables}
            for direction,target in [('upgrade','head'),('downgrade','b3d970ef624a'),('upgrade','head')]:
                migrate(direction,target)
                with closing(sqlite3.connect(path)) as connection:
                    for table,rows in before.items():self.assertEqual(connection.execute('SELECT * FROM "'+table+'" ORDER BY rowid').fetchall(),rows,table)
                    self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(),[])
                    if direction=='upgrade':
                        for table in ['hub_discussions','hub_reports','hub_report_events']:
                            self.assertEqual(connection.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)
            with closing(sqlite3.connect(path)) as connection:
                connection.execute("INSERT INTO hub_entries(id,kind,owner_id,version,created_at,updated_at) VALUES(2,'discussions',1,1,'2026-01-01','2026-01-01')")
                connection.execute('INSERT INTO hub_discussions(entry_id) VALUES(2)');connection.commit()
            self.assertIn('Cannot discard nonempty discussions',migrate('downgrade','b3d970ef624a',False).stderr)
