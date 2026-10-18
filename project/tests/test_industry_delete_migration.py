"""TEST ONLY: additive deletion audit schema and nonempty downgrade protection."""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class IndustryDeleteMigrationTests(unittest.TestCase):
    def test_additive_receipts_preserve_existing_data_and_cannot_be_silently_dropped(self):
        with tempfile.TemporaryDirectory(prefix='TEST-ONLY-industry-delete-') as folder:
            path = Path(folder)/'isolated.db'
            env = {**os.environ, 'DATABASE_URL':'sqlite:///'+path.as_posix(), 'ACCOUNT_MAIL_MODE':'disabled'}
            def migrate(direction, target, success=True):
                result = subprocess.run([sys.executable,'-m','flask','db',direction,target],
                    cwd=Path(__file__).resolve().parents[1], env=env, capture_output=True, text=True, timeout=90)
                self.assertEqual(result.returncode == 0, success, result.stderr)
                return result
            migrate('upgrade', 'a27e6b904c15')
            with closing(sqlite3.connect(path)) as connection:
                connection.execute("INSERT INTO user(id,username,email,password_hash,role,created_at,auth_version) VALUES(1,'TEST ONLY','delete@example.test','TEST ONLY','admin','2026-01-01',1)")
                connection.execute("INSERT INTO hub_entries(id,kind,owner_id,working_revision_id,version,created_at,updated_at) VALUES(1,'industry',1,1,2,'2026-01-01','2026-01-01')")
                connection.execute("INSERT INTO hub_revisions(id,entry_id,number,state,title,body,source_name,source_date,created_at) VALUES(1,1,1,'draft','TEST ONLY existing','TEST ONLY body','TEST ONLY source','2020-01-02','2026-01-01')")
                connection.commit()
                tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('alembic_version','sqlite_sequence')")]
                baseline = {name:connection.execute('SELECT * FROM "'+name+'" ORDER BY rowid').fetchall() for name in tables}
            migrate('upgrade','head')
            with closing(sqlite3.connect(path)) as connection:
                for name, rows in baseline.items():
                    self.assertEqual(connection.execute('SELECT * FROM "'+name+'" ORDER BY rowid').fetchall(), rows, name)
                self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM hub_deletion_audits').fetchone()[0], 0)
            migrate('downgrade', 'a27e6b904c15')
            migrate('upgrade', 'head')
            with closing(sqlite3.connect(path)) as connection:
                connection.execute("INSERT INTO hub_deletion_audits(original_entry_id,actor_id,snapshot,created_at) VALUES(99,1,'{}','2026-01-01')")
                connection.commit()
            rejected = migrate('downgrade', 'a27e6b904c15', False)
            self.assertIn('Cannot discard deletion audit receipts', rejected.stderr)
            with closing(sqlite3.connect(path)) as connection:
                self.assertEqual(connection.execute('SELECT original_entry_id FROM hub_deletion_audits').fetchone()[0], 99)
