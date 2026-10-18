"""TEST ONLY additive source-date migration against a temporary SQLite database."""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class IndustryMigrationTests(unittest.TestCase):
    def test_existing_hub_snapshots_survive_additive_upgrade_and_date_loss_is_guarded(self):
        with tempfile.TemporaryDirectory(prefix='TEST-ONLY-industry-migration-') as folder:
            path = Path(folder) / 'fixture.db'
            env = {**os.environ, 'DATABASE_URL':'sqlite:///'+path.as_posix(), 'ACCOUNT_MAIL_MODE':'disabled'}
            def migrate(direction, target, success=True):
                result = subprocess.run([sys.executable,'-m','flask','db',direction,target],
                    cwd=Path(__file__).resolve().parents[1], env=env, capture_output=True, text=True, timeout=90)
                self.assertEqual(result.returncode == 0, success, result.stderr)
                return result
            migrate('upgrade','f18a4c70d293')
            with closing(sqlite3.connect(path)) as connection:
                connection.execute("INSERT INTO user(id,username,email,password_hash,role,created_at,auth_version) VALUES(1,'TEST ONLY','fixture@example.test','TEST ONLY','teacher','2026-01-01',1)")
                connection.execute("INSERT INTO hub_entries(id,kind,owner_id,working_revision_id,version,created_at,updated_at) VALUES(1,'faculty',1,1,2,'2026-01-01','2026-01-01')")
                connection.execute("INSERT INTO hub_revisions(id,entry_id,number,state,title,body,source_name,created_at) VALUES(1,1,1,'draft','TEST ONLY legacy','TEST ONLY body','TEST ONLY source','2026-01-01')")
                connection.commit()
                tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('alembic_version','sqlite_sequence')")]
                columns = {t:[row[1] for row in connection.execute('PRAGMA table_info("'+t+'")')] for t in tables}
                baseline = {t:connection.execute('SELECT * FROM "'+t+'" ORDER BY rowid').fetchall() for t in tables}
            migrate('upgrade','head')
            with closing(sqlite3.connect(path)) as connection:
                for table, rows in baseline.items():
                    selected = ','.join('"'+column+'"' for column in columns[table])
                    self.assertEqual(connection.execute('SELECT '+selected+' FROM "'+table+'" ORDER BY rowid').fetchall(), rows, table)
                self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])
                self.assertEqual(connection.execute('SELECT source_date FROM hub_revisions').fetchall(), [(None,)])
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM hub_entries WHERE kind='industry'").fetchone()[0], 0)
                connection.execute("UPDATE hub_revisions SET source_date='2020-01-02'"); connection.commit()
            rejected = migrate('downgrade','f18a4c70d293',False)
            self.assertIn('Cannot discard existing Industry source dates', rejected.stderr)
            with closing(sqlite3.connect(path)) as connection:
                self.assertEqual(connection.execute('SELECT source_date FROM hub_revisions').fetchone()[0], '2020-01-02')
                connection.execute('UPDATE hub_revisions SET source_date=NULL'); connection.commit()
            migrate('downgrade','f18a4c70d293')
            migrate('upgrade','head')
