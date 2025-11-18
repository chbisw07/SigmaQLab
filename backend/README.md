# SigmaQLab Backend

This directory contains the FastAPI backend for SigmaQLab.

## Python version

Use Python 3.11+ (recommended).

## Initial setup

From the repository root:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\\Scripts\\activate
pip install --upgrade pip
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and adjust values as needed.

## Running the development server

From the `backend/` directory with the virtualenv activated:

```bash
uvicorn app.main:app --reload
```

The health check will be available at:

- `GET http://127.0.0.1:8000/health`

## Running tests

From the `backend/` directory with the virtualenv activated:

```bash
pytest
```

