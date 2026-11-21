"""TEST ONLY additive migration; existing rows survive, nonempty downgrade is refused."""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class CollaborationMigrationTests(unittest.TestCase):
    def test_upgrade_preserves_all_existing_rows_and_guards_downgrade(self):
        with tempfile.TemporaryDirectory(prefix='TEST-ONLY-collaboration-migration-') as folder:
            path=Path(folder)/'fixture.db'
            env={**os.environ,'DATABASE_URL':'sqlite:///'+path.as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            def migrate(direction,target,success=True):
                result=subprocess.run([sys.executable,'-m','flask','db',direction,target],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=90)
                self.assertEqual(result.returncode==0,success,result.stderr)
                return result
            migrate('upgrade','c491e8d62a70')
            with closing(sqlite3.connect(path)) as c:
                c.execute("INSERT INTO user(id,username,email,password_hash,role,created_at,auth_version) VALUES(1,'TEST ONLY','fixture@example.test','TEST ONLY','teacher','2026-01-01',1)")
                c.execute("INSERT INTO hub_entries(id,kind,owner_id,working_revision_id,version,created_at,updated_at) VALUES(1,'industry',1,1,2,'2026-01-01','2026-01-01')")
                c.execute("INSERT INTO hub_revisions(id,entry_id,number,state,title,body,source_name,created_at) VALUES(1,1,1,'draft','TEST ONLY','TEST ONLY','TEST ONLY','2026-01-01')")
                c.execute("INSERT INTO hub_moderation_events(entry_id,revision_id,actor_id,action,created_at) VALUES(1,1,1,'created','2026-01-01')")
                c.execute('DELETE FROM hub_moderation_events')
                c.commit()
                before_sequence=c.execute("SELECT seq FROM sqlite_sequence WHERE name='hub_moderation_events'").fetchone()[0]
                tables=[row[0] for row in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('alembic_version','sqlite_sequence')")]
                columns={t:[r[1] for r in c.execute('PRAGMA table_info("'+t+'")')] for t in tables}
                baseline={t:c.execute('SELECT * FROM "'+t+'" ORDER BY rowid').fetchall() for t in tables}
            migrate('upgrade','head')
            with closing(sqlite3.connect(path)) as c:
                for table,rows in baseline.items():
                    self.assertEqual(c.execute('SELECT '+','.join('"'+x+'"' for x in columns[table])+' FROM "'+table+'" ORDER BY rowid').fetchall(),rows,table)
                self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])
                self.assertEqual(c.execute("SELECT seq FROM sqlite_sequence WHERE name='hub_moderation_events'").fetchone()[0],before_sequence)
                self.assertIn('AUTOINCREMENT',c.execute("SELECT sql FROM sqlite_master WHERE name='hub_moderation_events'").fetchone()[0].upper())
                self.assertEqual(c.execute("SELECT COUNT(*) FROM hub_entries WHERE kind='collaboration'").fetchone()[0],0)
            migrate('downgrade','c491e8d62a70')
            migrate('upgrade','head')
            with closing(sqlite3.connect(path)) as c:
                c.execute("UPDATE hub_entries SET collaboration_status='closed' WHERE id=1");c.commit()
            self.assertIn('Cannot discard collaboration',migrate('downgrade','c491e8d62a70',False).stderr)


    def test_repair_already_applied_migration_uses_verified_floor_without_new_events(self):
        with tempfile.TemporaryDirectory(prefix='TEST-ONLY-audit-sequence-repair-') as folder:
            path=Path(folder)/'fixture.db'
            env={**os.environ,'DATABASE_URL':'sqlite:///'+path.as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            cwd=Path(__file__).resolve().parents[1]
            def run(target, extra=None):
                result=subprocess.run([sys.executable,'-m','flask','db','upgrade',target],cwd=cwd,env={**env,**(extra or {})},capture_output=True,text=True,timeout=90)
                self.assertEqual(result.returncode,0,result.stderr)
            run('d5a84c901b72')
            with closing(sqlite3.connect(path)) as c:
                c.execute("INSERT INTO sqlite_sequence(name,seq) SELECT 'hub_moderation_events',0 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='hub_moderation_events')")
                c.commit()
                before=c.execute('SELECT COUNT(*) FROM hub_moderation_events').fetchone()[0]
            run('head',{'R8A4_EVENT_SEQUENCE_FLOOR':'7'})
            with closing(sqlite3.connect(path)) as c:
                self.assertEqual(c.execute("SELECT seq FROM sqlite_sequence WHERE name='hub_moderation_events'").fetchone()[0],7)
                self.assertEqual(c.execute('SELECT COUNT(*) FROM hub_moderation_events').fetchone()[0],before)
                self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])
