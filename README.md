# Brain Research Tutor

A learning platform for brain science and brain-inspired intelligence.

## Overview

Explore brain regions, browse research papers, and use an AI tutor for educational
support. The React frontend connects to a Flask backend for authentication,
paper management, and resource attachments.

## Tech Stack

React, TypeScript, Vite, Flask, SQLAlchemy, Flask-Migrate, and the OpenAI API.
The database defaults to SQLite; PostgreSQL can be configured with `DATABASE_URL`.

## Local Development

From the repository root, install backend dependencies and copy the environment
template. Replace the secret placeholders in `project/.env` before starting.

```powershell
python -m pip install -r requirements.txt
Copy-Item .env.example project/.env
cd project
python -m flask db upgrade
python app.py
```

In a separate terminal:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Open `http://127.0.0.1:5173`. Flask runs at `http://127.0.0.1:5000`.

## Environment

See [.env.example](.env.example) for safe placeholders.

- `OPENAI_API_KEY`
- `SECRET_KEY`
- `FRONTEND_URL`
- `DATABASE_URL`

## Checks

Frontend, from `frontend/`:

```powershell
npm.cmd run lint
npm.cmd run build
```

Backend, from `project/`:

```powershell
python -m unittest discover -s tests
python -m flask db check
```

## Disclaimer

For education and research learning only. AI responses may be inaccurate and
should be verified. This platform does not provide medical advice.
