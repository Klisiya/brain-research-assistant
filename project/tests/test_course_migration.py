"""Additive course migration preserves existing R1/R2/R3 rows and stored bytes."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import test_attachments as fixtures
from course_content import MODULE_FIELDS, canonical_content


class CourseMigrationTests(unittest.TestCase):
    def test_preservation_canonical_insert_and_guarded_downgrade(self):
        with tempfile.TemporaryDirectory(prefix='course-migration-') as directory:
            root = Path(directory); database = root / 'fixture.db'; file = root / 'storage' / 'papers' / '7' / ('a'*32 + '.pdf')
            file.parent.mkdir(parents=True)
            content = fixtures.pdf('preserved'); file.write_bytes(content)
            environment = {**os.environ, 'DATABASE_URL': 'sqlite:///' + database.as_posix(), 'ACCOUNT_MAIL_MODE': 'disabled'}
            def migrate(direction, target, success=True):
                result = subprocess.run([sys.executable, '-m', 'flask', 'db', direction, target], cwd=Path(__file__).resolve().parents[1], env=environment, capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode == 0, success, result.stderr)
                return result
            migrate('upgrade', 'e4b7610ad932')
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("INSERT INTO user(id,username,email,password_hash,role,created_at,auth_version) VALUES(1,'Preserved','fixture@example.test','preserved-hash','user','2026-01-01',4)")
                connection.execute("""INSERT INTO papers(id,slug,title,authors,publication_type,topics,difficulty,estimated_reading_minutes,abstract,learning_objectives,keywords,resource_category,status,created_by_id,created_at,updated_at,featured,open_access)
                    VALUES(7,'preserved','Original','["Author"]','Research Article','["Memory"]','Beginner',5,'Original abstract','["Learn"]','[]','Foundational','published',1,'2026-01-01','2026-01-02',0,0)""")
                metadata = ('papers/7/' + 'a'*32 + '.pdf', hashlib.sha256(content).hexdigest(), len(content))
                connection.execute("""INSERT INTO file_assets(id,asset_type,storage_key,sha256,file_size,mime_type,original_filename,created_by_id,created_at,updated_at)
                    VALUES(1,'pdf',?,?,?,'application/pdf','original.pdf',1,'2026-01-01','2026-01-02')""", metadata)
                connection.execute("""INSERT INTO paper_attachments(id,paper_id,asset_id,attachment_type,display_name,storage_key,sha256,file_size,mime_type,original_filename,access_level,version,sort_order,uploaded_by_id,created_at,updated_at)
                    VALUES(1,7,1,'pdf','Original',?,?,?,'application/pdf','original.pdf','staff',9,3,1,'2026-01-01','2026-01-02')""", metadata)
                connection.execute("INSERT INTO account_audit_logs(id,actor_user_id,target_user_id,action,details,created_at) VALUES(1,1,1,'role_changed','{}','2026-01-01')")
                connection.execute("INSERT INTO account_invitations(id,email,role,token_hash,pending_email,created_by_id,created_at,expires_at,suggested_username) VALUES(1,'invite@example.test','student',?,'invite@example.test',1,'2026-01-01','2027-01-01','Original')", ('a'*64,))
                connection.execute("INSERT INTO password_reset_tokens(id,user_id,token_hash,auth_version,created_at,expires_at) VALUES(1,1,?,4,'2026-01-01','2027-01-01')", ('b'*64,))
                connection.execute("INSERT INTO attachment_file_cleanup(storage_key,created_at) VALUES('papers/7/" + 'f'*32 + ".pdf','2026-01-01')")
                connection.commit()
                tables = ['user','papers','file_assets','paper_attachments','account_audit_logs','account_invitations','password_reset_tokens','attachment_file_cleanup','sqlite_sequence']
                snapshots = {table: connection.execute(f'SELECT * FROM {table} ORDER BY rowid').fetchall() for table in tables}
            for direction, target in [('upgrade', 'head'), ('downgrade', 'e4b7610ad932'), ('upgrade', 'head')]:
                migrate(direction, target)
                with closing(sqlite3.connect(database)) as connection:
                    for table, rows in snapshots.items():
                        self.assertEqual(connection.execute(f'SELECT * FROM {table} ORDER BY rowid').fetchall(), rows, table)
                    self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])
                    if direction == 'upgrade':
                        self.assertEqual(connection.execute('SELECT COUNT(*) FROM courses').fetchone()[0], 1)
                        columns = ','.join(MODULE_FIELDS.values())
                        actual = connection.execute('SELECT ' + columns + ' FROM course_modules ORDER BY number').fetchall()
                        expected = [tuple(item[k] for k in MODULE_FIELDS) for item in canonical_content()['modules']]
                        self.assertEqual(actual, expected)
                self.assertEqual(file.read_bytes(), content)
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("UPDATE course_modules SET title='Edited by staff' WHERE number=1"); connection.commit()
            rejected = migrate('downgrade', 'e4b7610ad932', False)
            self.assertIn('Cannot downgrade course content', rejected.stderr)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute('SELECT version_num FROM alembic_version').fetchone()[0], 'f6a940c27b18')
                self.assertEqual(connection.execute('SELECT title FROM course_modules WHERE number=1').fetchone()[0], 'Edited by staff')
                self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])
