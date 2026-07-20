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

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/chat`
- `GET /api/brain-regions`
- `GET /api/brain-regions/<slug>`
- `GET /assets/models/brain.glb`

Database schema changes can continue to use the configured Flask-Migrate integration. The `flask init-db` CLI command remains available for initial database setup.

## Frontend Checks

```powershell
cd frontend
npm.cmd run lint
npm.cmd run build
```
