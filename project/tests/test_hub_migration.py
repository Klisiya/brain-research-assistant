"""Additive R8 upgrade preserves nonempty existing data; no Hub seeds."""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class HubMigrationTests(unittest.TestCase):
    def test_additive_upgrade_roundtrip_and_nonempty_downgrade_guard(self):
        with tempfile.TemporaryDirectory(prefix='TEST-ONLY-hub-migration-') as folder:
            path=Path(folder)/'isolated.db'
            environment={**os.environ,'DATABASE_URL':'sqlite:///'+path.as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            def migrate(direction,target,success=True):
                result=subprocess.run([sys.executable,'-m','flask','db',direction,target],cwd=Path(__file__).resolve().parents[1],env=environment,capture_output=True,text=True,timeout=90)
                self.assertEqual(result.returncode==0,success,result.stderr);return result
            migrate('upgrade','e63a9d20bf17')
            with closing(sqlite3.connect(path)) as connection:
                connection.execute("INSERT INTO user(id,username,email,password_hash,role,created_at,auth_version) VALUES(1,'TEST ONLY','test@example.test','fixture','teacher','2026-01-01',1)")
                connection.commit()
                tables=[row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('alembic_version','sqlite_sequence')")]
                baseline={t:connection.execute('SELECT * FROM "'+t+'" ORDER BY rowid').fetchall() for t in tables}
            for direction,target in [('upgrade','head'),('downgrade','e63a9d20bf17'),('upgrade','head')]:
                migrate(direction,target)
                with closing(sqlite3.connect(path)) as connection:
                    for table,rows in baseline.items():self.assertEqual(connection.execute('SELECT * FROM "'+table+'" ORDER BY rowid').fetchall(),rows,table)
                    self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(),[])
                    if direction=='upgrade':
                        self.assertEqual(connection.execute('SELECT version_num FROM alembic_version').fetchone()[0],'b3d970ef624a')
                        for table in ['hub_entries','hub_revisions','hub_attachments','hub_moderation_events','hub_deletion_audits']:
                            self.assertEqual(connection.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)
            with closing(sqlite3.connect(path)) as connection:
                connection.execute("INSERT INTO hub_entries(kind,owner_id,version,created_at,updated_at) VALUES('faculty',1,1,'2026-01-01','2026-01-01')");connection.commit()
            self.assertIn('Cannot downgrade nonempty Hub',migrate('downgrade','e63a9d20bf17',False).stderr)
