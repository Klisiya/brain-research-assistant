"""TEST ONLY standalone browser fixture. No production database or content writes.

Run from the repository root with the project virtualenv; stop with Ctrl+C.
Every run creates a fresh database and test accounts under ignored tmp/r8a4.
"""
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

root = Path(__file__).resolve().parents[2]
folder = root / 'tmp/r8a4'
folder.mkdir(parents=True, exist_ok=True)
database = folder / ('browser-' + uuid4().hex + '.db')
os.environ.update(DATABASE_URL='sqlite:///' + database.as_posix(),
                  SECRET_KEY='TEST-ONLY-R8A4-SESSION', ACCOUNT_MAIL_MODE='disabled',
                  FRONTEND_URL='http://127.0.0.1:5190')
sys.path.insert(0, str(root / 'project'))
from app import app, db, User
from flask_migrate import upgrade
from storage import LocalAttachmentStorage

app.config.update(TESTING=True, ACCOUNT_RATE_LIMIT_ENABLED=False)
app.extensions['attachment_storage'] = LocalAttachmentStorage(folder / 'uploads')
with app.app_context():
    upgrade(directory=str(root / 'project/migrations'))
    users = {}
    for role, name in [('teacher', 'teacher'), ('teacher', 'teacher-b'), ('admin', 'admin'), ('student', 'learner')]:
        user = User(username='TEST ONLY ' + name, email=name + '@example.test', role=role, auth_version=1)
        user.set_password('TEST-ONLY-R8A4-password')
        db.session.add(user)
        db.session.flush()
        users[name] = user.id
    db.session.commit()
(folder / 'fixture.json').write_text(json.dumps(dict(database=str(database), users=users)))
sys.path.insert(0, str(root / 'project/tests'))
from test_attachments import pdf
(folder / 'TEST-ONLY.pdf').write_bytes(pdf())
app.run(host='127.0.0.1', port=5191, debug=False, use_reloader=False)
