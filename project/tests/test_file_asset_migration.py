"""Full pre-R3 metadata preservation; migrations never move stored bytes."""
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


class FileAssetMigrationTests(unittest.TestCase):
    def test_upgrade_downgrade_upgrade_preserves_rows_files_and_id_watermark(self):
        with tempfile.TemporaryDirectory(prefix="asset-migration-") as directory:
            root = Path(directory); database = root / "fixture.db"; storage = root / "storage"
            environment = {**os.environ, "DATABASE_URL": "sqlite:///"+database.as_posix(), "ACCOUNT_MAIL_MODE": "disabled"}
            def migrate(direction, target, success=True):
                result = subprocess.run([sys.executable, "-m", "flask", "db", direction, target],
                    cwd=Path(__file__).resolve().parents[1], env=environment, capture_output=True, text=True, timeout=60)
                if success: self.assertEqual(result.returncode, 0, result.stderr)
                else: self.assertNotEqual(result.returncode, 0)
                return result
            migrate("upgrade", "d2f481a6c930")
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("PRAGMA foreign_keys=ON")
                for uid, role in [(1,"teacher"),(2,"admin"),(3,"user")]:
                    connection.execute("INSERT INTO user(id,username,email,password_hash,role,created_at,auth_version) VALUES(?,?,?,?,?,?,?)", (uid,f"Fixture {uid}",f"fixture{uid}@example.test","preserved-hash",role,"2026-01-01",4))
                for pid in [7,8]:
                    connection.execute("""INSERT INTO papers(id,slug,title,authors,publication_type,topics,difficulty,estimated_reading_minutes,abstract,learning_objectives,keywords,resource_category,status,created_by_id,created_at,updated_at,featured,open_access,doi,volume,issue,pages,publisher)
                        VALUES(?,?,'Preserved paper','["Author"]','Research Article','["Memory"]','Beginner',5,'Fixture','["Learn"]','[]','Foundational','published',1,'2026-01-01','2026-01-02',0,0,'10.1234/preserved','2','3','4-9','Publisher')""", (pid,f"preserved-{pid}"))
                entries = [(1,"pdf","pdf","application/pdf",fixtures.pdf()), (2,"cover","png","image/png",fixtures.png()),
                           (3,"slides","pptx",fixtures.FORMATS["slides"]["pptx"],fixtures.office("slides")),
                           (4,"document","docx",fixtures.FORMATS["document"]["docx"],fixtures.office("document"))]
                for aid, kind, ext, mime, content in entries:
                    key = f"papers/7/{aid:032x}.{ext}"; file = storage / key; file.parent.mkdir(parents=True,exist_ok=True); file.write_bytes(content)
                    connection.execute("""INSERT INTO paper_attachments(id,paper_id,attachment_type,display_name,description,original_filename,storage_key,mime_type,file_size,sha256,access_level,version,sort_order,uploaded_by_id,created_at,updated_at)
                        VALUES(?,7,?,'Preserved name','Preserved description',?,?,?,?,?, ?,9,3,1,'2026-01-01','2026-01-02')""", (aid,kind,"original."+ext,key,mime,len(content),hashlib.sha256(content).hexdigest(),["public","authenticated","staff","public"][aid-1]))
                connection.execute("""INSERT INTO paper_attachments(id,paper_id,attachment_type,display_name,external_url,access_level,version,sort_order,uploaded_by_id,created_at,updated_at)
                    VALUES(5,7,'external_link','Link','https://example.test/link','staff',8,4,2,'2026-01-01','2026-01-02')""")
                connection.execute("""INSERT INTO paper_attachments(id,paper_id,attachment_type,display_name,external_url,access_level,version,sort_order,uploaded_by_id,created_at,updated_at)
                    VALUES(50,7,'external_link','Deleted','https://example.test/deleted','public',1,5,2,'2026-01-01','2026-01-02')""")
                connection.execute("DELETE FROM paper_attachments WHERE id=50")
                pending="papers/7/"+"f"*32+".pdf"; (storage/pending).write_bytes(fixtures.pdf("pending"))
                connection.execute("INSERT INTO attachment_file_cleanup(storage_key,created_at) VALUES(?,'2026-01-01')",(pending,))
                connection.execute("INSERT INTO account_audit_logs(id,actor_user_id,target_user_id,action,details,created_at) VALUES(1,2,1,'role_changed',?,'2026-01-01')",(json.dumps({"oldRole":"student","newRole":"teacher"}),))
                connection.execute("INSERT INTO account_invitations(id,email,role,token_hash,pending_email,created_by_id,created_at,expires_at,suggested_username) VALUES(1,'invite@example.test','student',?,'invite@example.test',2,'2026-01-01','2027-01-01','Preserved')",("a"*64,))
                connection.execute("INSERT INTO password_reset_tokens(id,user_id,token_hash,auth_version,created_at,expires_at) VALUES(1,1,?,4,'2026-01-01','2027-01-01')",("b"*64,))
                connection.commit()
                snapshots = {}
                for table in ["user","papers","paper_attachments","attachment_file_cleanup","account_audit_logs","account_invitations","password_reset_tokens"]:
                    columns = [row[1] for row in connection.execute(f"PRAGMA table_info({table})")]
                    query = "SELECT "+",".join(columns)+f" FROM {table} ORDER BY rowid"
                    snapshots[table] = (query, connection.execute(query).fetchall())
            def file_snapshot(): return {file.relative_to(storage).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest() for file in storage.rglob("*") if file.is_file()}
            originals = file_snapshot()
            for direction, target in [("upgrade","head"),("downgrade","d2f481a6c930"),("upgrade","head")]:
                migrate(direction,target)
                with closing(sqlite3.connect(database)) as connection:
                    for table,(query,rows) in snapshots.items(): self.assertEqual(connection.execute(query).fetchall(),rows,table)
                    self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(),[])
                    self.assertEqual(connection.execute("SELECT seq FROM sqlite_sequence WHERE name='paper_attachments'").fetchone()[0],50)
                    if direction == "upgrade":
                        self.assertEqual(connection.execute("SELECT COUNT(*) FROM file_assets").fetchone()[0],5)
                        mismatch = connection.execute("""SELECT COUNT(*) FROM paper_attachments p JOIN file_assets a ON p.asset_id=a.id
                            WHERE p.attachment_type != a.asset_type OR p.storage_key IS NOT a.storage_key OR p.sha256 IS NOT a.sha256 OR p.file_size IS NOT a.file_size OR p.external_url IS NOT a.external_url OR p.original_filename IS NOT a.original_filename OR p.mime_type IS NOT a.mime_type""").fetchone()[0]
                        self.assertEqual(mismatch,0)
                self.assertEqual(file_snapshot(),originals)
            # A genuine second Paper relation can reference the same asset.
            with closing(sqlite3.connect(database)) as connection:
                columns=[row[1] for row in connection.execute("PRAGMA table_info(paper_attachments)") if row[1] not in {"id","paper_id"}]
                fields=','.join(columns)
                connection.execute(f"INSERT INTO paper_attachments(paper_id,{fields}) SELECT 8,{fields} FROM paper_attachments WHERE id=1")
                connection.commit()
                self.assertGreater(connection.execute("SELECT id FROM paper_attachments WHERE paper_id=8").fetchone()[0],50)
            rejected=migrate("downgrade","d2f481a6c930",success=False)
            self.assertIn("Cannot downgrade shared assets",rejected.stderr)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT version_num FROM alembic_version").fetchone()[0],"e4b7610ad932")
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM paper_attachments").fetchone()[0],6)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM file_assets").fetchone()[0],5)
            self.assertEqual(file_snapshot(),originals)
