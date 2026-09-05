# Brain Research Tutor

A brain science learning platform with a React frontend and Flask API backend.

## Architecture

- `frontend/`: React, TypeScript, and Vite user interface
- `project/`: Flask API, authentication, database models, migrations, AI Tutor service, and required backend-served assets
- React development server: `http://127.0.0.1:5173`
- Flask API server: `http://127.0.0.1:5000`

The legacy Flask-rendered frontend has been removed. React is the primary frontend, while Flask provides JSON APIs, session authentication, database access, and the AI Tutor service.

## Environment

Create the backend environment file at `project/.env`. Keep secrets local and never commit API keys, passwords, or `SECRET_KEY` values.

Common settings include:

```dotenv
OPENAI_API_KEY=your-api-key
SECRET_KEY=your-secret-key
FRONTEND_URL=http://127.0.0.1:5173
```

## Development

Install the backend dependencies from the repository root:

```powershell
python -m pip install -r requirements.txt
```

Start Flask in one PowerShell terminal:

```powershell
cd project
python app.py
```

Start React in a second PowerShell terminal:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173`. Vite proxies relative `/api` requests to Flask at `http://127.0.0.1:5000`.

## Backend Endpoints

Authentication and learning APIs:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/chat`
- `GET /api/brain-regions`
- `GET /api/brain-regions/<slug>`
- `GET /assets/models/brain.glb`

Public Papers APIs:

- `GET /api/papers`
- `GET /api/papers/<slug>`

Teacher and administrator Papers APIs:

- `GET /api/papers/manage`
- `GET /api/papers/manage/<id>`
- `POST /api/papers`
- `PATCH /api/papers/<id>`
- `POST /api/papers/<id>/archive`

Administrator-only Papers API:

- `DELETE /api/papers/<id>`

Local administration CLI commands:

```powershell
cd project
flask set-user-role EMAIL ROLE
flask seed-papers --owner-email EMAIL
```

Database schema changes can continue to use the configured Flask-Migrate integration. The `flask init-db` CLI command remains available for initial database setup.

## Frontend Checks

```powershell
cd frontend
npm.cmd run lint
npm.cmd run build
```

## Paper Attachments (Stage 3A)

Files are stored outside the database. `PaperAttachment` records only metadata;
this keeps database queries/backups smaller and permits a future object storage backend.
The default local storage root is `<Flask instance_path>/uploads`, currently
`project/instance/uploads`. Random relative keys have the form
`papers/<paper_id>/<uuid>.<extension>`; binary files therefore live under
`project/instance/uploads/papers/`. Original names never determine disk paths.
All upload directories, local databases, and `.env` files must remain ignored by Git.

Local upload storage is for development. Production deployment must configure
persistent/object storage. Never depend on an ephemeral deployment filesystem.
`ATTACHMENT_UPLOAD_ROOT` is a Flask configuration setting; a future backend can
implement the interface in `project/storage.py` and be registered as
`app.extensions["attachment_storage"]`. No cloud storage is connected in this stage.

| Attachment type | Extensions | Maximum file size |
| --- | --- | --- |
| `pdf` | `.pdf` | 50 MiB |
| `cover` | `.jpg`, `.jpeg`, `.png`, `.webp` | 8 MiB |
| `slides` | `.pptx` | 50 MiB |
| `document` | `.docx` | 30 MiB |
| `external_link` | HTTP/HTTPS URL, no uploaded file | 1,500 characters |

Each request has a 64 MiB hard limit. Extension, supplied MIME, and basic content
signature must agree. PDF requires `%PDF-`; images require their PNG/JPEG/WebP
signatures. Office files require a valid ZIP package with matching content types,
root Office relationship, and `word/document.xml` or `ppt/presentation.xml`.
ZIP validation checks CRCs, bounds entry counts and expanded sizes, rejects unsafe
entry paths/encrypted members/macros, and never extracts archive entries.
Legacy DOC/PPT, SVG, HTML, scripts, executables, and general archives are rejected.
These are basic format checks, not antivirus or a guarantee that a PDF/Office file
is harmless. Malware scanning and further production hardening remain pending.

Uploads compute SHA-256 incrementally. The same paper/type/hash returns
`409 DUPLICATE_ATTACHMENT`, regardless of filename. Database uniqueness also
protects against concurrent duplicates. SQLite connections explicitly enable foreign key enforcement. Each paper has at most one PDF and one
cover; a second upload returns `409 PRIMARY_ATTACHMENT_EXISTS` and must use PUT.
Slides, documents, and external links can have multiple records.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/papers/<paper_id>/attachments` | Upload one file (multipart) |
| POST | `/api/papers/<paper_id>/attachments/link` | Add external link (JSON) |
| GET | `/api/papers/manage/<paper_id>/attachments` | All managed metadata |
| GET | `/api/papers/<slug>/attachments` | Visible published metadata |
| GET | `/api/papers/<slug>/attachments/<attachment_id>/download` | Permission-checked file access |
| PUT | `/api/papers/<paper_id>/attachments/<attachment_id>` | Replace file or link |
| DELETE | `/api/papers/<paper_id>/attachments/<attachment_id>` | Delete attachment and clean file |

Multipart fields: `file`, `attachmentType`, `displayName`, optional `description`,
`accessLevel` (default `public`), and `sortOrder` (default `0`). Exactly one file is
accepted. Link JSON uses the same metadata plus `attachmentType: "external_link"`
and `externalUrl`. Only HTTP/HTTPS URLs without embedded credentials are allowed;
external resources are never fetched or proxied. PUT accepts multipart for files
or JSON for links, preserves unspecified metadata, and cannot change attachment type.
A file PUT always requires the replacement file; sending identical bytes returns 409.

Management operations require a session: anonymous requests receive 401, ordinary
users 403. Teachers manage only papers they created; administrators manage any
paper. Permanent Paper deletion remains administrator-only. Lists are stably
ordered by `sort_order`, `created_at`, then `id`.

| Access level | Published file download | Public metadata list |
| --- | --- | --- |
| `public` | Anyone | Everyone |
| `authenticated` | Any signed-in user; otherwise 401 | Signed-in users |
| `staff` | Teacher/Admin; anonymous 401, ordinary user 403 | Omitted; use managed list |

Draft and archived papers always return 404 from public metadata/download routes,
even for staff. There is no static `/uploads/` route. Downloads verify the attachment
belongs to the requested paper. External links have `downloadUrl: null` and their
download route returns 400 `ATTACHMENT_NOT_DOWNLOADABLE`.
PDFs/covers default to inline; `?download=1` forces download. DOCX/PPTX default to
attachment. Filenames are stripped of path components/control characters and passed
to Werkzeug's header handling. Attachment responses use `Cache-Control: private,
no-store`, `Vary: Cookie`, and `X-Content-Type-Options: nosniff`.

Create returns `201 {"attachment": {...}}`; PUT returns the same envelope with 200.
Managed metadata includes IDs, type, display name, description, original filename,
MIME, size, SHA-256, external URL, access, version, order, uploader ID/username/role,
and timestamps. Public metadata omits original filename, hash, and uploader.
Neither serializer exposes storage keys, absolute paths, email, or password hashes.
The stable `downloadUrl` depends on paper slug and attachment ID, not the disk name.
Replacement preserves ID/URL and increments `version`; changing the Paper slug
separately retains the existing Paper routing behavior. Deleted attachment IDs
are not reused on SQLite.

Replacement validates and saves the new file before committing metadata. A failed
save/DB commit preserves the old file and removes the new file. After commit, old
file removal uses a durable `attachment_file_cleanup` outbox. Attachment deletion
and Paper deletion enqueue keys in the same database transaction as metadata deletion,
then remove disk files. Missing files log a warning and do not block metadata cleanup.
Disk cleanup failures are logged and return `cleanupPending: true`; the committed
operation remains successful, and its retry job survives application restart.

Retry pending cleanup jobs (up to 100 per invocation, nonzero exit if jobs remain):

```powershell
cd project
.venv/Scripts/python.exe -m flask cleanup-attachment-files
```

Production operations should schedule this command and monitor failures. A process
termination during an uncommitted upload, or simultaneous database and disk failure,
can still require filesystem/database reconciliation; automated orphan reconciliation
and malware scanning belong to production hardening.

Errors are JSON `{ "error": "...", "code": "..." }`, including 413
`FILE_TOO_LARGE`, 400 validation/type/content errors, 409 duplicate/concurrency
conflicts, 404 missing resources, and sanitized 500 storage/database failures.
Exceptions and filesystem paths are never returned to clients.

`Paper.external_url` remains the canonical source; attachment links are additional
learning resources. `PaperTag` is deferred to Stage 4 search/classification.
`PaperModuleRelation` is deferred until Stage 6 introduces a real `CourseModule` FK.
No placeholder modules, topic/keyword migration, or frontend upload UI are added.
Stage 3B will connect attachments to the existing Paper Editor.

### Attachment migrations and backend checks

From `project/`:

```powershell
.venv/Scripts/python.exe -m flask db upgrade
.venv/Scripts/python.exe -m flask db current
.venv/Scripts/python.exe -m flask db heads
.venv/Scripts/python.exe -m flask db check
```

The Stage 3A migration adds `paper_attachments` and the internal cleanup outbox.
Back up the local database before applying migrations. A schema downgrade does not
remove uploaded files: clean attachments before downgrading.

From the repository root:

```powershell
project/.venv/Scripts/python.exe -m unittest discover -s project/tests -v
project/.venv/Scripts/python.exe -m compileall -q -x '[\\/]\.venv[\\/]' project
```

Tests use an isolated in-memory database, temporary uploads, generated tiny PDF/Office
packages, and small image fixtures. No real papers, student files, or production
credentials are used. The suite also checks existing authentication, Papers, brain
regions, and a mocked AI Tutor response without contacting OpenAI.
