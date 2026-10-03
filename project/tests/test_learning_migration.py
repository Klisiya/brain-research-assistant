"""R5A additive migration preserves all R1-R4 data, including curated readings."""
from contextlib import closing
import hashlib
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import test_attachments as fixtures


class LearningMigrationTests(unittest.TestCase):
    def test_additive_roundtrip_preservation_and_nonempty_downgrade_guard(self):
        with tempfile.TemporaryDirectory(prefix='r5a-migration-') as directory:
            root=Path(directory);database=root/'fixture.db';stored=root/'original.pdf'
            content=fixtures.pdf('preserved-r5a');stored.write_bytes(content)
            environment={**os.environ,'DATABASE_URL':'sqlite:///'+database.as_posix(),'ACCOUNT_MAIL_MODE':'disabled'}
            def migrate(direction,target,success=True):
                result=subprocess.run([sys.executable,'-m','flask','db',direction,target],cwd=Path(__file__).resolve().parents[1],env=environment,capture_output=True,text=True,timeout=60)
                self.assertEqual(result.returncode==0,success,result.stderr);return result
            migrate('upgrade','b9e27f104c63')
            with closing(sqlite3.connect(database)) as con:
                con.execute("INSERT INTO user(id,username,email,password_hash,role,created_at,auth_version) VALUES(1,'Teacher','teacher@example.test','fixture-hash','teacher','2026-01-01',3)")
                con.execute("""INSERT INTO papers(id,slug,title,authors,publication_type,topics,difficulty,estimated_reading_minutes,abstract,learning_objectives,keywords,resource_category,status,created_by_id,created_at,updated_at,featured,open_access)
                    VALUES(1,'original','Original','["Author"]','Research Article','[]','Beginner',5,'Original abstract','[]','[]','Foundational','published',1,'2026-01-01','2026-01-02',0,0)""")
                metadata=('assets/1/'+'a'*32+'.pdf',hashlib.sha256(content).hexdigest(),len(content))
                con.execute("INSERT INTO file_assets(id,asset_type,storage_key,sha256,file_size,mime_type,original_filename,created_by_id,created_at,updated_at) VALUES(1,'pdf',?,?,?,'application/pdf','original.pdf',1,'2026-01-01','2026-01-02')",metadata)
                con.execute("INSERT INTO paper_attachments(paper_id,asset_id,attachment_type,display_name,storage_key,sha256,file_size,mime_type,original_filename,access_level,version,sort_order,uploaded_by_id,created_at,updated_at) VALUES(1,1,'pdf','Original',?,?,?,'application/pdf','original.pdf','public',4,0,1,'2026-01-01','2026-01-02')",metadata)
                con.execute("INSERT INTO account_audit_logs(actor_user_id,target_user_id,action,details,created_at) VALUES(1,1,'preserved','{}','2026-01-01')")
                con.execute("UPDATE courses SET description='Edited course'")
                con.execute("UPDATE course_modules SET learning_focus='Edited focus' WHERE number=8")
                con.execute("UPDATE research_areas SET overview='Edited research overview' WHERE id=1")
                con.execute("INSERT INTO course_staff(course_id,user_id,role,created_at) VALUES(1,1,'assistant','2026-01-01')")
                con.execute("INSERT INTO research_area_staff(research_area_id,user_id,role,created_at) VALUES(1,1,'editor','2026-01-01')")
                con.execute("INSERT INTO research_area_papers(research_area_id,paper_id,sort_order) VALUES(1,1,2)")
                for table,field in [('course_resources','course_id'),('module_resources','module_id'),('research_area_resources','research_area_id')]:
                    con.execute(f"INSERT INTO {table}({field},asset_id,display_name,access_level,version,sort_order,created_at,updated_at) VALUES(1,1,'Shared asset','staff',7,2,'2026-01-01','2026-01-02')")
                con.execute("INSERT INTO course_module_papers(module_id,paper_id,reading_type,sort_order) VALUES(1,1,'required',0)")
                con.commit()
                tables=[r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name!='alembic_version'")]
                before={t:con.execute('SELECT * FROM '+t+' ORDER BY rowid').fetchall() for t in tables}
            for direction,target in [('upgrade','head'),('downgrade','b9e27f104c63'),('upgrade','head')]:
                migrate(direction,target)
                with closing(sqlite3.connect(database)) as con:
                    for table,rows in before.items(): self.assertEqual(con.execute('SELECT * FROM '+table+' ORDER BY rowid').fetchall(),rows,table)
                    self.assertEqual(con.execute('PRAGMA foreign_key_check').fetchall(),[])
                    if direction=='upgrade':self.assertEqual(con.execute('SELECT COUNT(*) FROM learning_enrollments').fetchone()[0],0)
                self.assertEqual(stored.read_bytes(),content)
            with closing(sqlite3.connect(database)) as con:
                con.execute("INSERT INTO learning_enrollments(user_id,course_id,state,completion_rule_version,enrolled_at,last_activity_at) VALUES(1,1,'active',1,'2026-01-01','2026-01-01')");con.commit()
            rejected=migrate('downgrade','b9e27f104c63',False)
            self.assertIn('Cannot downgrade nonempty learning history',rejected.stderr)
            with closing(sqlite3.connect(database)) as con:
                self.assertEqual(con.execute('SELECT version_num FROM alembic_version').fetchone()[0],'c8f14a205d72')
                self.assertEqual(con.execute('SELECT COUNT(*) FROM learning_enrollments').fetchone()[0],1)
                for table,rows in before.items(): self.assertEqual(con.execute('SELECT * FROM '+table+' ORDER BY rowid').fetchall(),rows,table)
