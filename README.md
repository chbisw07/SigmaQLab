# SigmaQLab

SigmaQLab is a private quantitative research and backtesting lab that sits alongside SigmaTrader. It provides a structured environment to define strategies, run backtests, and inspect results against your real-world portfolios.

## Repository structure

- `backend/` – FastAPI backend, SQLite meta DB, tests, and tooling.
- `frontend/` – React + TypeScript + MUI frontend.
- `docs/` – Product requirements and sprint planning files.

## Backend – FastAPI

### Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env  # adjust paths and settings if needed
```

### Run dev server

```bash
cd backend
source .venv/bin/activate  # if not already active
uvicorn app.main:app --reload
```

Health check:

- `GET http://127.0.0.1:8000/health` → `{"status": "ok", "service": "sigmaqlab"}`

### Backend tests

```bash
cd backend
source .venv/bin/activate
pytest
```

### Backend tooling

Install pre-commit hooks once:

```bash
cd backend
source .venv/bin/activate
pre-commit install
```

This will run black and ruff on staged files.

## Frontend – React + TypeScript + MUI

### Setup

```bash
cd frontend
npm install
```

### Run dev server

```bash
cd frontend
npm run dev
```

The app will be available at `http://localhost:5173` with a basic SigmaQLab layout and navigation:

- Dashboard (`/`)
- Strategies (`/strategies`)
- Backtests (`/backtests`)
- Data (`/data`)
- Settings (`/settings`)

### Frontend linting

```bash
cd frontend
npm run lint
```

## Top-level Makefile

From the repository root you can use:

```bash
make dev-backend    # run backend dev server (assumes Python and venv available)
make dev-frontend   # run frontend dev server
make test           # run backend tests and frontend lint
```
