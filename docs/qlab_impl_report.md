# SigmaQLab – Implementation Report

This document captures what has been implemented for each sprint/group task as work progresses in the SigmaQLab repository. It is intended to mirror and expand on the brief reports shared in the Codex chat, so you have a durable record of what was done, where, and how to verify it.

---

## Sprint S01 – Backend Foundation (G01)

**Group:** G01 – Backend foundation: FastAPI skeleton, config, meta DB setup
**Tasks:** S01_G01_TB001–TB004
**Status (Codex):** implemented

### S01_G01_TB001 – FastAPI project skeleton

- Implemented a FastAPI application factory and minimal app skeleton in `backend/app/main.py`.
- The factory function `create_app`:
  - Configures structured logging using a JSON formatter (see logging notes under TB004).
  - Ensures database tables are created on startup using SQLAlchemy metadata.
  - Instantiates a `FastAPI` app with the configured application name.
- Exposed a health check endpoint:
  - Route: `GET /health`
  - Response: `{"status": "ok", "service": "sigmaqlab"}`
  - The endpoint depends on a SQLAlchemy session (`Depends(get_db)`) to implicitly verify that DB connectivity is working.
- Added `backend/app/__init__.py` so the `app` package can be imported cleanly (e.g., `uvicorn app.main:app`).
- Verified behavior with a small pytest test (see S01_G03_TB003).

Key files:

- `backend/app/main.py`
- `backend/app/__init__.py`

How to run:

- From `backend/` with the virtualenv activated:
  - `uvicorn app.main:app --reload`
  - Visit `http://127.0.0.1:8000/health` to check for `{"status": "ok", "service": "sigmaqlab"}`.

### S01_G01_TB002 – Configuration loader (env-based)

- Implemented configuration via a Pydantic v2–compatible settings class using `pydantic-settings`.
- The `Settings` model centralizes environment-driven configuration:
  - `app_name: str` – defaults to `"SigmaQLab"`.
  - `environment: Literal["dev", "test", "prod"]` – defaults to `"dev"`.
  - `log_level: str` – defaults to `"INFO"`.
  - `meta_db_path: Path` – defaults to `sigmaqlab_meta.db` in the current working directory.
- Environment variable mapping is controlled via `SettingsConfigDict` with:
  - `env_prefix="SIGMAQLAB_"` – all vars begin with `SIGMAQLAB_`.
  - `env_file=".env"` and `env_file_encoding="utf-8"` – `.env` at backend root is loaded automatically.
- Supported environment variables (as of S01):
  - `SIGMAQLAB_APP_NAME`
  - `SIGMAQLAB_ENVIRONMENT`
  - `SIGMAQLAB_LOG_LEVEL`
  - `SIGMAQLAB_META_DB_PATH`
- `get_settings()` returns a cached `Settings` instance, and `get_database_url()` builds an absolute SQLite URL from `meta_db_path`.
- Added an `.env` template with appropriate variable names.
- Adjusted the implementation when Pydantic v2 raised deprecation errors:
  - Migrated from `BaseSettings` in `pydantic` to `BaseSettings` in `pydantic-settings`.
  - Removed deprecated `Field(..., env=...)` usage and replaced it with `SettingsConfigDict` and simple defaults, eliminating pytest warnings.

Key files:

- `backend/app/config.py`
- `backend/.env.example`
- `backend/.env` (your local copy)
- `backend/requirements.txt` (includes `pydantic` and `pydantic-settings`)

How to configure:

- Copy `backend/.env.example` to `backend/.env` and adjust:
  - `SIGMAQLAB_APP_NAME=SigmaQLab`
  - `SIGMAQLAB_ENVIRONMENT=dev`
  - `SIGMAQLAB_LOG_LEVEL=INFO`
  - `SIGMAQLAB_META_DB_PATH=./sigmaqlab_meta.db`

### S01_G01_TB003 – Initial sigmaqlab_meta.db schema

- Introduced core SQLAlchemy models and database wiring for the meta database.
- Database setup:
  - `backend/app/database.py` defines:
    - `engine` with a SQLite URL derived from `get_database_url()`.
    - `SessionLocal` (sessionmaker) and `Base` (declarative base).
    - `get_db()` dependency that yields a SQLAlchemy session, ensuring sessions are closed after use.
  - SQLite is configured with `connect_args={"check_same_thread": False}` to support usage in FastAPI.
- Meta DB models (aligned with PRD section 6.1):
  - `Strategy`:
    - Fields: `id`, `name`, `code` (unique), `category`, `description`, `status`, `tags` (JSON), `linked_sigma_trader_id`, `linked_tradingview_template`, `created_at`, `updated_at`.
    - Relationships: `parameters` (to `StrategyParameter`), `backtests` (to `Backtest`).
  - `StrategyParameter`:
    - Fields: `id`, `strategy_id` (FK → `strategies.id`), `label`, `params_json` (JSON), `notes`, `created_at`.
    - Relationships: `strategy`, `backtests`.
  - `Backtest`:
    - Fields: `id`, `strategy_id`, `params_id` (FK → `strategy_parameters.id`), `engine`, `symbols_json`, `timeframe`, `start_date`, `end_date`, `initial_capital`, `starting_portfolio_json`, `status`, `metrics_json`, `data_source`, `created_at`, `finished_at`.
    - Relationships: `strategy`, `parameters`.
- Table creation:
  - In `create_app()` (S01_G01_TB001), `Base.metadata.create_all(bind=engine)` is invoked, so running the app automatically creates core tables in `sigmaqlab_meta.db` for S01.
  - Alembic is listed in `backend/requirements.txt` but migrations are deferred to a later sprint.

Key files:

- `backend/app/database.py`
- `backend/app/models.py`

How to verify:

- With the backend venv active, run:
  - `uvicorn app.main:app --reload`
- Ensure `sigmaqlab_meta.db` is created at the configured path and inspect it with a SQLite browser to see `strategies`, `strategy_parameters`, and `backtests` tables.

### S01_G01_TB004 – Structured logging for backend

- Implemented a simple JSON-based logging formatter and configured it as the root handler.
- Logging configuration:
  - `backend/app/logging_config.py` defines:
    - `JsonLogFormatter(logging.Formatter)` – formats logs as JSON with:
      - `timestamp` (UTC ISO8601),
      - `level`,
      - `logger`,
      - `message`,
      - Optional `exception` field when `exc_info` is present.
    - `configure_logging(level: str = "INFO")`:
      - Sets the root logger level based on the provided string.
      - Clears existing handlers to avoid duplication during reloads.
      - Attaches a single `StreamHandler` targeting `stdout` with the JSON formatter.
  - `create_app()` calls `configure_logging(_settings.log_level)` using the configured log level from `Settings`.
- Result:
  - Running `uvicorn` or `pytest` produces structured JSON log events, suitable for future log aggregation or filtering.
  - This satisfies the S01 requirement for structured logs with level, timestamp, and message; dedicated request logging middleware can be layered on later.

Key files:

- `backend/app/logging_config.py`
- `backend/app/main.py` (wires logging into app startup)

How to verify:

- Run `uvicorn app.main:app --reload` and hit `/health`.
- Observe JSON log lines printed to the console, including `INFO` entries for Uvicorn and any application logs you add during later sprints.

---

## Sprint S01 – Frontend Foundation (G02)

**Group:** G02 – Frontend foundation: React+TS+MUI scaffold and base layout
**Tasks:** S01_G02_TF001–TF003
**Status (Codex):** implemented

### S01_G02_TF001 – React + TypeScript + Vite + MUI scaffold

- Created a new React + TypeScript project under `frontend/` using Vite tooling.
- Core configuration:
  - `frontend/package.json`:
    - Scripts: `dev`, `build`, `preview`, `lint`, `format`.
    - Dependencies: React 18, React DOM, React Router DOM, MUI (`@mui/material`, `@mui/icons-material`), Emotion (`@emotion/react`, `@emotion/styled`).
    - Dev dependencies: Vite 5, `@vitejs/plugin-react`, TypeScript, ESLint, Prettier, TypeScript-ESLint.
  - `frontend/tsconfig.json`:
    - Strict TypeScript configuration with `strict: true`, `noEmit: true`, bundler-style resolution, JSX set to `react-jsx`, etc.
  - `frontend/vite.config.ts`:
    - Uses `@vitejs/plugin-react`.
    - Configures dev server on port `5173`.
  - `frontend/index.html`:
    - Root HTML shell mounting React at `#root`.
- Addressed dev-server issues:
  - Initially used `@vitejs/plugin-react-swc`, which caused an ESM-only import problem with the Node API. This was corrected by switching to `@vitejs/plugin-react`, and dependencies were updated accordingly.

Key files:

- `frontend/package.json`
- `frontend/tsconfig.json`
- `frontend/vite.config.ts`
- `frontend/index.html`

How to run:

- From `frontend/`:
  - `npm install`
  - `npm run dev`
- Visit `http://localhost:5173` to see the SigmaQLab UI shell.

### S01_G02_TF002 – Global layout, AppBar, navigation, dark theme

- Implemented a global dark theme and base layout using MUI.
- Theme:
  - `frontend/src/theme.ts`:
    - Sets `palette.mode = "dark"`.
    - Uses a dark background (`#050816` / `#0b1020`) and a light blue primary color.
- Layout:
  - `frontend/src/App.tsx`:
    - Wraps the app in `ThemeProvider` and `CssBaseline`.
    - Uses React Router to define routes (see TF003) inside an `AppLayout` component.
  - `frontend/src/components/AppLayout.tsx`:
    - Adds a top `AppBar` with the SigmaQLab brand name.
    - Implements a navigation drawer (permanent on larger screens, temporary on mobile) with navigation items:
      - Dashboard (`/`)
      - Strategies (`/strategies`)
      - Backtests (`/backtests`)
      - Data (`/data`)
      - Settings (`/settings`)
    - Uses MUI icons (`DashboardIcon`, `ScienceIcon`, `AssessmentIcon`, `StorageIcon`, `SettingsIcon`) and responsive behavior via `useMediaQuery`.
    - The drawer width is fixed at 240px, with the main content area padded and offset below the app bar.
  - Branding and layout choices are aligned with the PRD’s focus on a clean, professional research lab UI.

Key files:

- `frontend/src/theme.ts`
- `frontend/src/App.tsx`
- `frontend/src/components/AppLayout.tsx`

How to verify:

- Run `npm run dev` in `frontend/`.
- Confirm:
  - A dark-themed UI.
  - Top AppBar labeled “SigmaQLab”.
  - Left navigation with the five core sections.
  - Content area updating when clicking navigation items.

### S01_G02_TF003 – React Router routes for core pages

- Added basic routing with placeholder pages for core sections.
- Router setup:
  - `frontend/src/main.tsx`:
    - Renders `<App />` inside a `BrowserRouter` using `ReactDOM.createRoot`.
  - `frontend/src/App.tsx`:
    - Defines `Routes` for:
      - `/` → `DashboardPage`
      - `/strategies` → `StrategiesPage`
      - `/backtests` → `BacktestsPage`
      - `/data` → `DataPage`
      - `/settings` → `SettingsPage`
- Placeholder pages:
  - `frontend/src/pages/DashboardPage.tsx` – “Hello SigmaQLab – Dashboard”.
  - `frontend/src/pages/StrategiesPage.tsx` – “Strategies (coming soon)”.
  - `frontend/src/pages/BacktestsPage.tsx` – “Backtests (coming soon)”.
  - `frontend/src/pages/DataPage.tsx` – “Data (coming soon)”.
  - `frontend/src/pages/SettingsPage.tsx` – “Settings (coming soon)”.
- These pages provide a clean hook for later sprints to flesh out actual functionality (strategy library UI, backtest lists, data explorer, settings, etc.).

Key files:

- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- `frontend/src/pages/*.tsx`

How to verify:

- From `frontend/`:
  - `npm run dev`
- Navigate to each route via the left nav and confirm the placeholder page text matches the expected section.

---

## Sprint S01 – Developer Experience (G03)

**Group:** G03 – Developer experience: tooling, linting, and pre-commit
**Tasks:** S01_G03_TB001, S01_G03_TF002, S01_G03_TB003
**Status (Codex):** implemented

### S01_G03_TB001 – Backend tooling: black, ruff, pre-commit

- Defined backend dependencies for formatting, linting, and testing:
  - `backend/requirements.txt` includes:
    - `black` – code formatter.
    - `ruff` – linter (includes import sorting rules via `I` code).
    - `pytest`, `httpx` – testing.
    - `pre-commit`, `python-dotenv`, `alembic`, and core backend libraries (FastAPI, SQLAlchemy, uvicorn, etc.).
- Configured tools via `backend/pyproject.toml`:
  - `black`:
    - `line-length = 88`
    - `target-version = ["py311"]`
  - `ruff`:
    - `select = ["E", "F", "I", "B"]` (errors, flakes, import rules, and common bugbear checks).
    - `line-length = 88`, `target-version = "py311"`.
  - Pytest:
    - `pythonpath = ["app"]` and `testpaths = ["tests"]`.
- Pre-commit configuration:
  - `backend/.pre-commit-config.yaml`:
    - Hooks:
      - `black` (psf/black).
      - `ruff` (astral-sh/ruff-pre-commit).
      - `check-added-large-files`, `check-merge-conflict`, `end-of-file-fixer`, `trailing-whitespace` (pre-commit-hooks).
- Usage:
  - Install hooks once:
    - `cd backend`
    - `pre-commit install`
  - Hooks run automatically on `git commit`, helping keep code formatted and linted.

Key files:

- `backend/requirements.txt`
- `backend/pyproject.toml`
- `backend/.pre-commit-config.yaml`

How to verify:

- From `backend/` with venv active:
  - `pre-commit install`
  - Modify a Python file and run `pre-commit run --all-files` to confirm hooks execute without error.

### S01_G03_TF002 – Frontend tooling: ESLint, Prettier, TypeScript strict settings

- Configured ESLint and Prettier for the React + TS frontend, and resolved version-compatibility issues.
- ESLint configuration:
  - `frontend/.eslintrc.cjs`:
    - `root: true`, browser + ES2020 env.
    - Parser: `@typescript-eslint/parser`.
    - Plugins: `@typescript-eslint`, `react-hooks`, `react-refresh`.
    - Extends:
      - `eslint:recommended`
      - `plugin:@typescript-eslint/recommended`
      - `plugin:react-hooks/recommended`
      - `eslint-config-prettier`
    - Rule:
      - `"react-refresh/only-export-components"` set to `"warn"` with `allowConstantExport: true`.
- Prettier configuration:
  - `frontend/.prettierrc`:
    - `singleQuote: false`, `trailingComma: "none"`, `printWidth: 88`, `semi: true`.
- Tooling scripts and versions:
  - `frontend/package.json` dev dependencies:
    - `eslint` pinned to `^8.57.0`.
    - `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` pinned to `^7.18.0`.
    - This combination supports `.eslintrc.cjs` (avoids ESLint 9 flat-config issues).
  - `lint` script:
    - `"lint": "eslint -c .eslintrc.cjs \"src/**/*.{ts,tsx}\""`.
  - `format` script:
    - `"format": "prettier --write \"src/**/*.{ts,tsx,css,md}\""`.
- Debugging steps:
  - Initial `npm run lint` failed because ESLint 9 expected a `eslint.config.js` flat config and reported that all files were ignored.
  - Script was updated to pass `-c .eslintrc.cjs`.
  - To fully resolve, ESLint + TS-ESLint versions were downgraded to the 8.x / 7.x line, which fully respects `.eslintrc.cjs`.

Key files:

- `frontend/.eslintrc.cjs`
- `frontend/.prettierrc`
- `frontend/package.json`

How to verify:

- From `frontend/`:
  - `npm install` (after version updates).
  - `npm run lint` – ESLint should run over `src/**/*.ts,tsx` without configuration errors.
  - `npm run format` (optional) to apply Prettier formatting.

### S01_G03_TB003 – Backend pytest harness

- Added a minimal pytest harness to validate backend wiring and ensure CI-readiness.
- Test module:
  - `backend/tests/test_health.py`:
    - Instantiates a `TestClient` around `app.main.app`.
    - Issues `GET /health` and asserts:
      - Status code is `200`.
      - JSON body equals `{"status": "ok", "service": "sigmaqlab"}`.
- Supporting config:
  - `backend/tests/__init__.py` – ensures `tests` is a package.
  - Pytest configuration in `backend/pyproject.toml` sets `pythonpath` and `testpaths`.
- Warnings cleanup:
  - Initially, pytest emitted Pydantic deprecation warnings due to `Field(..., env=...)` usage on `BaseSettings`.
  - After migrating to `pydantic-settings` and removing deprecated `Field` extras, these warnings were resolved, keeping the test output clean.

Key files:

- `backend/tests/test_health.py`
- `backend/pyproject.toml`

How to verify:

- From `backend/` with venv active:
  - `pytest`
- Expected output:
  - Tests pass with no Pydantic deprecation warnings.

---

## Cross-cutting: Makefile and .gitignore

While not mapped to a specific single task ID, these support S01 developer experience goals and are worth tracking.

### Top-level Makefile

- Added `Makefile` at the repository root to streamline common commands:
  - `make dev-backend` – runs `uvicorn app.main:app --reload` from `backend/`.
  - `make dev-frontend` – runs `npm install && npm run dev` from `frontend/`.
  - `make test` – runs backend pytest and frontend lint:
    - `cd backend && pytest`
    - `cd frontend && npm run lint`
- This aligns with the requirement to have simple commands documenting how to run dev servers and tests.

Key file:

- `Makefile`

### .gitignore

- Added `.gitignore` at the repository root to keep the repository clean and avoid committing generated artifacts:
  - Python backend:
    - `__pycache__/`, `*.py[cod]`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`.
    - `backend/.venv/`, `venv/`, `env/`, `.env`, `*.env`.
  - Databases:
    - `*.db` (covers `sigmaqlab_meta.db`, `sigmaqlab_prices.db`).
  - Frontend:
    - `frontend/node_modules/`, `frontend/dist/`, `npm-debug.log*`, `yarn-debug.log*`, `yarn-error.log*`, `pnpm-debug.log*`.
  - Editor/OS:
    - `.vscode/`, `.idea/`, `*.iml`, `.DS_Store`, `Thumbs.db`.
  - Sprint tooling:
    - `docs/qlab_sprint_tmp/` – temporary directory used when editing `qlab_sprint_tasks_codex.xlsx` from the CLI.

Key file:

- `.gitignore`

---

## Notes on qlab_sprint_tasks_codex.xlsx Updates

- The Codex-managed sprint workbook (`docs/qlab_sprint_tasks_codex.xlsx`) has been updated programmatically to reflect S01 work:
  - Added a new shared string `"implemented"` and wired it to the `status` column for S01 rows.
  - Updated the `status` cells for:
    - `S01_G01_TB001`
    - `S01_G01_TB002`
    - `S01_G01_TB003`
    - `S01_G01_TB004`
    - `S01_G02_TF001`
    - `S01_G02_TF002`
    - `S01_G02_TF003`
    - `S01_G03_TB001`
    - `S01_G03_TF002`
    - `S01_G03_TB003`
  - Sprints S02+ remain `pending`.
- Deviations/remarks:
  - Backend config uses `pydantic-settings` (Pydantic v2) rather than Pydantic v1-style `BaseSettings`.
  - Frontend linting uses ESLint 8 + TypeScript-ESLint 7 instead of ESLint 9 flat-config, to align with `.eslintrc.cjs`.
  - Vite uses `@vitejs/plugin-react` instead of the SWC variant, to avoid ESM-only plugin issues.

You can treat this document as the running implementation log for S01 and extend it for later sprints (S02+) as new tasks are implemented.

---

## Sprint S02 – Data Service & Price DB (G01)

**Group:** G01 – Data service: Kite/yfinance integration and price DB persistence
**Tasks:** S02_G01_TB001–TB005
**Status (Codex):** implemented

### S02_G01_TB003 – sigmaqlab_prices.db schema (price_bars)

Although listed third in the sprint, the price DB schema is a natural starting point:

- Added a dedicated SQLite database configuration for prices:
  - `backend/app/config.py`:
    - New settings:
      - `prices_db_path: Path` with default `sigmaqlab_prices.db`.
    - Helper functions:
      - `_build_sqlite_url(path: Path)` – shared URL builder.
      - `get_prices_database_url()` – returns a SQLite URL for the prices DB based on `SIGMAQLAB_PRICES_DB_PATH` (or default).
  - `backend/.env.example`:
    - Added `SIGMAQLAB_PRICES_DB_PATH=./sigmaqlab_prices.db`.
- Price DB engine and base:
  - `backend/app/prices_database.py`:
    - `prices_engine` – SQLite engine pointing at the prices DB.
    - `PricesSessionLocal` – sessionmaker for price DB.
    - `PricesBase` – declarative base for price models.
    - `get_prices_db()` – FastAPI dependency yielding a prices `Session`.
- Price bars model:
  - `backend/app/prices_models.py`:
    - `PriceBar` model with fields:
      - `id` (PK), `symbol`, `timeframe`, `timestamp`,
      - `open`, `high`, `low`, `close`, `volume`,
      - `source` (`kite`, `yfinance`, `local_csv`, etc.).
    - An index `ix_price_bars_symbol_timeframe_ts` on (`symbol`, `timeframe`, `timestamp`) to support efficient lookups.
- App startup integration:
  - `backend/app/main.py`:
    - Imports `PricesBase` and `prices_engine`.
    - Calls `PricesBase.metadata.create_all(bind=prices_engine)` alongside the meta DB `create_all`.

How to verify:

- With backend venv active:
  - `uvicorn app.main:app --reload`
  - Confirm that `sigmaqlab_prices.db` is created in the backend directory (or configured path) and contains a `price_bars` table.

### S02_G01_TB001 – Zerodha Kite client wrapper (read-only)

- Implemented a thin, optional Zerodha Kite wrapper within the data service:
  - `backend/app/services.py`:
    - `fetch_ohlcv_from_kite(symbol, timeframe, start, end, api_key, access_token)`:
      - Validates that `api_key` and `access_token` are provided; otherwise raises `ProviderUnavailableError`.
      - Lazily imports `kiteconnect.KiteConnect`. If the package is not installed, raises `ProviderUnavailableError` with a clear message.
      - Creates a `KiteConnect` instance, sets the access token, and calls `historical_data` with:
        - `instrument_token=symbol` (treated as a token or pass-through string for now),
        - `from_date=start`, `to_date=end`,
        - `interval=timeframe` (mapping can be refined later).
      - Normalizes the returned records into an in-memory `OHLCVBar` dataclass, recording `source="kite"`.
    - `ProviderUnavailableError` – specific exception used to signal provider configuration/availability issues.
  - Configuration:
    - `backend/app/config.py` includes optional fields:
      - `kite_api_key: str | None`
      - `kite_access_token: str | None`
    - `backend/.env.example` exposes:
      - `SIGMAQLAB_KITE_API_KEY`
      - `SIGMAQLAB_KITE_ACCESS_TOKEN`
- Integration with the DataService:
  - `DataService.fetch_and_store_bars()` uses `fetch_ohlcv_from_kite` when `source == "kite"`, passing in the configured credentials.
  - The API layer converts `ProviderUnavailableError` into a `502` HTTP response.

Notes / Deviations:

- The Sprint S02 Kite wrapper is intentionally minimal:
  - Instrument token lookup and precise interval mapping will be refined in later sprints.
  - If your environment doesn’t have `kiteconnect` installed or credentials are absent, the Kite path will fail fast with a clear error rather than at runtime deep inside the client.

### S02_G01_TB002 – yfinance/CSV fallback data providers

- yfinance provider:
  - `backend/app/services.py`:
    - `fetch_ohlcv_from_yfinance(symbol, timeframe, start, end)`:
      - Lazily imports `yfinance`. If not installed, raises `ProviderUnavailableError`.
      - Calls `yf.download(...)` with:
        - `start`, `end`, `interval=timeframe` (caller responsible for ensuring compatible values),
        - `progress=False`, `auto_adjust=False`.
      - Converts the resulting DataFrame rows into `OHLCVBar` instances with `source="yfinance"`.
    - Handles empty results by returning an empty list.
  - `backend/requirements.txt` includes `yfinance` so you can install it in your venv.
- CSV provider:
  - `backend/app/services.py`:
    - `fetch_ohlcv_from_csv(csv_path, symbol, timeframe)`:
      - Reads a local CSV using Python’s `csv.DictReader`.
      - Expect columns: `timestamp`, `open`, `high`, `low`, `close`, `volume`.
      - Treats the file as data for a single `symbol`/`timeframe`.
      - Produces `OHLCVBar` instances with `source="local_csv"`.
  - This provider is used heavily in tests to avoid external network calls and is also the simplest way to ingest one-off historical files.
- Shared representation:
  - `OHLCVBar` dataclass encapsulates the normalized view of a bar (timestamp, OHLCV, volume, source), which makes the DataService independent of any provider-specific payloads.

Notes:

- yfinance and KiteConnect imports are wrapped in try/except blocks so they don’t break environments where these optional dependencies are missing; instead, they surface explicit `ProviderUnavailableError` messages.

### S02_G01_TB004 – Data Service functions to persist OHLCV

- Implemented a central `DataService` for fetching and persisting OHLCV bars into the prices DB:
  - `backend/app/services.py`:
    - `class DataService`:
      - Constructor accepts `kite_api_key` and `kite_access_token` (injected from `Settings`).
      - `fetch_and_store_bars(db, symbol, timeframe, start, end, source, csv_path=None) -> int`:
        - Normalizes `source` to lowercase and chooses provider:
          - `"csv"` → `fetch_ohlcv_from_csv(...)` (requires `csv_path`).
          - `"yfinance"` → `fetch_ohlcv_from_yfinance(...)`.
          - `"kite"` → `fetch_ohlcv_from_kite(...)` (uses injected credentials).
          - Otherwise raises `ValueError` for unsupported sources.
        - If no bars are returned, returns `0` and performs no DB writes.
        - Deletes existing `PriceBar` records for the given `(symbol, timeframe)` with `timestamp` in `[start, end]` to avoid duplicates.
        - Inserts new `PriceBar` rows for each bar, mapping fields directly.
        - Commits the transaction and returns the number of bars written.
- This function is the main integration point used by the `/api/data/fetch` endpoint.

How to verify:

- Use the CSV path through the API (see TB005 checks below) or call the service directly in a Python shell with a pre-opened `Session` from `get_prices_db()`.

### S02_G01_TB005 – /api/data/fetch endpoint

- Added a dedicated Data router and request/response schemas to the FastAPI app.
- Schemas:
  - `backend/app/schemas.py`:
    - `DataFetchRequest`:
      - `symbol: str`
      - `timeframe: str` (e.g. `5m`, `15m`, `1D`)
      - `start_date: date`
      - `end_date: date`
      - `source: Literal["kite", "yfinance", "csv"]` (default `"kite"`)
      - `csv_path: Optional[str]` (required when `source="csv"`)
    - `DataFetchResponse`:
      - `symbol`, `timeframe`, `start_date`, `end_date`, `source`
      - `bars_written: int`
- Router:
  - `backend/app/routers/data.py`:
    - `router = APIRouter(prefix="/api/data", tags=["Data"])`
    - Endpoint:
      - `POST /api/data/fetch`:
        - Accepts `DataFetchRequest` in the body.
        - Uses `Depends(get_prices_db)` to get a prices DB session.
        - Reads settings via `get_settings()` and instantiates `DataService`.
        - Converts `start_date` and `end_date` into full-day `datetime` ranges.
        - Calls `DataService.fetch_and_store_bars(...)`.
        - On success, returns a `DataFetchResponse` summarizing the operation.
        - Error handling:
          - `ValueError` → HTTP 400 with a descriptive message (e.g., missing `csv_path`).
          - `ProviderUnavailableError` → HTTP 502 with a provider-specific message.
- App wiring:
  - `backend/app/routers/__init__.py` – marks `routers` as a package.
  - `backend/app/main.py`:
    - Imports `data_router` and registers it with `app.include_router(data_router.router)`.
    - Already ensures both meta and prices DB schemas are created at startup.

How to verify via API:

- Start backend:
  - `cd backend`
  - `source .venv/bin/activate` (if not already)
  - `uvicorn app.main:app --reload`
- Test CSV ingestion:
  - Create a CSV file (single symbol/timeframe) with columns: `timestamp,open,high,low,close,volume`.
  - Send:
    - `POST http://127.0.0.1:8000/api/data/fetch`
    - JSON body:
      ```json
      {
        "symbol": "TEST",
        "timeframe": "5m",
        "start_date": "2024-01-01",
        "end_date": "2024-01-01",
        "source": "csv",
        "csv_path": "/absolute/path/to/your.csv"
      }
      ```
  - Expect a `200` response with `bars_written` equal to the number of rows in the CSV.

### Tests for S02/G01

- Added an API-level test to validate the happy path for CSV ingestion without relying on external services:
  - `backend/tests/test_data_fetch_api.py`:
    - Creates a temporary CSV file with two OHLCV rows.
    - POSTs to `/api/data/fetch` with `source="csv"` and the temporary `csv_path`.
    - Asserts:
      - HTTP 200 response.
      - Response fields: `symbol`, `timeframe`, `bars_written == 2`, `source == "csv"`.
- All backend tests:
  - Running `pytest` in `backend/` now executes:
    - `tests/test_health.py`
    - `tests/test_data_fetch_api.py`
  - Both pass (with only upstream pytest-asyncio deprecation warnings, not related to SigmaQLab code).

### Sprint workbook updates for S02/G01

- `docs/qlab_sprint_tasks_codex.xlsx` was updated again so that:
  - The shared string `"implemented"` (index 135) is reused.
  - The `status` cells for S02_G01 tasks (`S02_G01_TB001`–`S02_G01_TB005`) now reference `"implemented"`.
- Deviations / remarks you may want to note manually in the workbook:
  - Kite and yfinance integrations are intentionally thin and defensive:
    - Import errors and missing credentials surface as `ProviderUnavailableError` → HTTP 502.
  - CSV ingestion is fully functional and used for tests; Kite/yfinance flows depend on your environment (packages + credentials).
  - Zerodha access tokens are generated externally (e.g. via your existing standalone utility or a small helper script) and supplied to SigmaQLab via `SIGMAQLAB_KITE_ACCESS_TOKEN`; SigmaQLab does not itself perform the daily request_token → access_token login flow.

---

## Sprint S02 – Data Management UI (G02)

**Group:** G02 – Data management UI: fetch, list, and preview data
**Tasks:** S02_G02_TF001–TF003
**Status (Codex):** implemented

### S02_G02_TF001 – Data page form to trigger data fetch

- Extended the existing Data page to provide a real fetch form:
  - File: `frontend/src/pages/DataPage.tsx`.
  - Form fields:
    - `Symbol` (text input, default `HDFCBANK`).
    - `Timeframe` (select: `1m`, `5m`, `15m`, `1h`, `1d`).
    - `Source` (select: `kite`, `yfinance`).
    - `Start date` and `End date` (native HTML date inputs; default to today).
  - On submit:
    - Calls `POST http://127.0.0.1:8000/api/data/fetch` with the form values.
    - Shows status text indicating success or error (`Fetched N bars for SYMBOL (TF).` or error detail).
    - Refreshes the coverage summary (see TF002) after a successful fetch.
- Added basic CORS config in the backend so the frontend can call the API from `localhost:5173`:
  - `backend/app/main.py`:
    - Adds `CORSMiddleware` allowing origins:
      - `http://localhost:5173`
      - `http://127.0.0.1:5173`

Notes:

- CSV fetch remains available via the API for bulk ingestion, but the UI form currently targets the Kite/yfinance + date-range workflow, which matches the sprint definition.

### S02_G02_TF002 – Coverage summary table

- Implemented a new backend endpoint to summarize available data:
  - `backend/app/schemas.py`:
    - Added `DataSummaryItem` with fields: `symbol`, `exchange`, `timeframe`, `start_timestamp`, `end_timestamp`, `bar_count`.
  - `backend/app/routers/data.py`:
    - `GET /api/data/summary`:
      - Uses SQLAlchemy to aggregate from `PriceBar`:
        - `min(timestamp)` and `max(timestamp)` for date range.
        - `count(id)` as `bar_count`.
      - Groups by (`symbol`, `timeframe`) and returns a list of `DataSummaryItem`.
- UI integration:
  - `DataPage.tsx` loads summary on mount via `GET /api/data/summary`.
  - Renders a MUI `Table` with columns:
    - Symbol, Exchange, Timeframe, Source, Start, End, Bars.
  - Each row is clickable; clicking selects the symbol/timeframe and triggers a preview fetch (see TF003).
  - Added selection ergonomics:
    - Per-row checkbox selection tracked in React state.
    - A `Select All` button to quickly select all coverage rows.
    - A `Delete Selected` button that bulk-deletes the selected coverage entries via the backend API.

### S02_G02_TF003 – Price & volume preview chart

- Implemented and later enhanced a preview endpoint for recent bars:
  - `backend/app/schemas.py`:
    - `PriceBarPreview` with `timestamp`, `open`, `high`, `low`, `close`, `volume`, `source`.
  - `backend/app/routers/data.py`:
    - `GET /api/data/{symbol}/preview?timeframe=...&limit=200`:
      - Filters `PriceBar` on the given symbol and timeframe.
      - Returns up to `limit` most recent bars (default 200), ordered ascending by timestamp.
- Initial UI integration (early S02):
  - When a row is selected in the summary table, the Data page called:
    - `GET /api/data/{symbol}/preview?timeframe={timeframe}`
  - The preview panel rendered:
    - A `LineChart` and `BarChart` (via `recharts`) for price and volume.
  - This satisfied the initial sprint goal of “simple price & volume preview”.

- Refined UI integration (later iteration):
  - Replaced Recharts with `lightweight-charts` and moved indicator logic to the frontend:
    - New reusable component `frontend/src/features/data/components/DataPreviewChart.tsx`.
    - Central indicator catalogue in `frontend/src/features/data/indicatorCatalog.ts` with categories:
      - Moving averages, Trend/Bands, Momentum/Oscillators, Volume/Volatility.
  - The Data page (`frontend/src/pages/DataPage.tsx`) now:
    - Computes a rich set of indicators (SMA/EMA/WMA/HMA, Bollinger Bands, Donchian Channels, RSI, MACD, Momentum, ROC, CCI, OBV, ATR) in a `useEffect` over preview data.
    - Exposes grouped indicator toggles in a compact toolbar above the chart.
    - Allocates a tall, Moneycontrol-style chart area (≈512–1080px height, user-adjustable via slider) with:
      - Main pane: candlesticks + overlay indicators.
      - Optional volume histogram with up/down colouring (toggleable via a `Volume bars` checkbox).
      - Optional oscillator pane: stacked below for RSI/MACD-style indicators.
  - Additional UX refinements:
    - Range presets in the preview header (`All`, intraday-style `1m`–`60m`, `1d`, `1w`, and calendar-style `1M`, `3M`, `6M`, `1Y`) that zoom the chart based on the latest bar.
    - Simple “tools” toggles:
      - Last price reference line (dashed).
      - Highlight marker on the latest bar.
    - Price and oscillator panes keep their time scales synchronized when panning/zooming, so momentum/volume indicators always line up with the candles.

### Tests for S02/G02

- Added a dedicated test to validate the new summary and preview endpoints:
  - File: `backend/tests/test_data_summary_api.py`.
  - Flow:
    - Creates a small CSV with two bars.
    - Calls `POST /api/data/fetch` with `source="csv"` and a test symbol `TEST2`.
    - Asserts that `GET /api/data/summary` returns one entry with `bar_count == 2`.
    - Calls `GET /api/data/TEST2/preview?timeframe=5m` and asserts:
      - Two bars are returned.
      - Closing prices match the CSV values (`105`, `110`).
- Backend test suite:
  - `pytest` in `backend/` now runs:
    - `test_health.py`
    - `test_data_fetch_api.py`
    - `test_data_summary_api.py`
    - Live provider tests (HDFCBANK) marked as integration and skipped by default.

### Sprint workbook updates for S02/G02

- `docs/qlab_sprint_tasks_codex.xlsx` has been updated so that:
  - `S02_G02_TF001` (Data fetch form),
  - `S02_G02_TF002` (coverage table),
  - `S02_G02_TF003` (price/volume preview chart)
  all have `status = implemented` (via the shared `"implemented"` string, index 135).

---

## Sprint S03 – Strategy Library UI (G02)

**Group:** G02 – Strategy Library UI: list, details, and parameter sets
**Tasks:** S03_G02_TF001–TF003
**Status (Codex):** implemented

### S03_G02_TF001 – Strategy list view

- Implemented the Strategy Library UI on the frontend to surface backend strategy metadata, with basic edit/delete actions.
- File: `frontend/src/pages/StrategiesPage.tsx`.
- List view:
  - Uses a MUI `Table` to show all strategies returned by `GET /api/strategies`.
  - Columns: Name, Code, Status, Category.
  - Clicking a row selects that strategy and loads its details + parameter sets.
  - New strategy creation:
  - A "New Strategy" form beneath the list with fields:
    - Name, Code, Category (simple text inputs).
  - On submit:
    - Sends `POST /api/strategies` with:
      - `status` defaulted to `"experimental"`,
      - `live_ready` defaulted to `false`.
    - If successful:
      - Appends the created strategy to the list,
      - Selects it for detail view,
      - Shows a small success message.
    - On error (e.g., code conflict), displays the backend `detail` message in the form.

### S03_G02_TF002 – Strategy detail view

- Detail panel:
  - Right-hand side of `StrategiesPage`, titled "Strategy Details".
  - Shows:
    - Name + code,
    - Chips for `status`, `category`, and `Live-ready` (if true),
    - Description when present,
    - Tags as chips when present,
    - Integration metadata:
      - SigmaTrader ID,
      - TradingView template name.
  - All values are derived from the backend `StrategyRead` response and stay aligned with the meta DB fields defined in S03_G01.

### S03_G02_TF003 – Parameter sets list + creation/edit/delete

- List of parameter sets:
  - For the selected strategy, the UI calls:
    - `GET /api/strategies/{strategy_id}/params`.
  - Renders a MUI `Table` with columns:
    - Label, Params (truncated JSON), Notes, Created.
  - The `params` field is a prettified JSON snippet backed by the `params_json` column via the Pydantic `params` alias.
- New parameter set form:
  - Located under the parameter table in the Strategy Details panel.
  - Fields:
    - `Label`
    - `Params JSON` – free-form JSON text area, default value `{"fast": 10, "slow": 30}`.
    - `Notes`.
  - On submit:
    - Validates JSON client-side (with `JSON.parse`) and shows an error if parsing fails.
    - When creating:
      - Calls `POST /api/strategies/{strategy_id}/params` with `label`, parsed `params`, and `notes`.
      - Appends the created parameter to the table and shows a success message.
    - When editing an existing parameter set:
      - Clicking a row’s “Edit” action loads it into the form and switches the button label to “Save parameter set”.
      - Calls `PUT /api/params/{id}` and updates the corresponding row on success.
    - Delete behavior:
      - Each parameter row has a “Delete” action that confirms and then calls `DELETE /api/params/{id}`, removing it from the table on success.

### Sprint workbook updates for S03/G02

- `docs/qlab_sprint_tasks_codex.xlsx` has been updated so that:
  - `S03_G02_TF001` (strategy list view),
  - `S03_G02_TF002` (strategy detail view),
  - `S03_G02_TF003` (parameter sets UI)
  now have `status = implemented` and short remarks describing the UI work.

---

## Sprint S04 – Backtest Engine (G01)

**Group:** G01 – Backtest engine: Backtrader integration and engine interface
**Tasks:** S04_G01_TB001–TB003
**Status (Codex):** implemented

### S04_G01_TB001 – Strategy engine interface & BacktestResult models

- Added a dedicated backtest engine module that defines simple, explicit types for running single backtests:
  - File: `backend/app/backtest_engine.py`.
  - Core dataclasses:
    - `BacktestConfig`:
      - `strategy_code`, `symbol`, `timeframe`, `initial_capital`, `params: dict[str, Any]`.
      - Represents the minimal configuration needed for a single-symbol backtest.
    - `EquityPoint`:
      - `timestamp`, `equity` – one point on the equity curve.
    - `BacktestResult`:
      - `strategy_code`, `symbol`, `timeframe`,
      - `equity_curve: list[EquityPoint]`,
      - `metrics: dict[str, float]` (currently includes `initial_capital`, `final_value`, `pnl`).
- This interface allows future engines (e.g., vectorized backtests) to return the same shape, even if their internals differ.

### S04_G01_TB002 – Backtrader engine integration

- Implemented a Backtrader-backed engine that conforms to the `BacktestConfig`/`BacktestResult` interface:
  - Class: `BacktraderEngine` in `backend/app/backtest_engine.py`.
  - Optional dependency:
    - `backtrader` is imported lazily and the engine raises a clear `RuntimeError` if it is not installed.
    - Tests for this module are marked to skip when `backtrader` is missing, so your test suite stays green while keeping the engine optional.
  - Reference strategy:
    - `SmaCrossStrategy`:
      - Simple SMA crossover using Backtrader indicators and a `CrossOver` signal.
      - Parameters: `fast`, `slow`.
      - Records equity on every bar into `self._equity_curve`.
    - Registry:
      - `STRATEGY_REGISTRY = {"SMA_X": SmaCrossStrategy}` so `strategy_code="SMA_X"` is wired to this implementation.
  - `BacktraderEngine.run(config, price_data)`:
    - Expects a `pandas.DataFrame` with a `DatetimeIndex` and `open/high/low/close/volume` columns.
    - Sets up `Cerebro`, configures initial cash, adds the registered strategy with `config.params`, and feeds the data via `bt.feeds.PandasData`.
    - Runs the engine, pulls the strategy’s recorded equity curve, and computes basic metrics (`final_value`, `initial_capital`, `pnl`) for `BacktestResult`.

### S04_G01_TB003 – BacktestService using the engine

- Added a service layer that connects the engine to the existing meta and prices databases:
  - File: `backend/app/backtest_service.py`.
  - Class: `BacktestService`:
    - Takes an optional `BacktraderEngine` instance (defaults to a new one).
    - Method `run_single_backtest(...)`:
      - Inputs:
        - `meta_db: Session`, `prices_db: Session`,
        - `strategy_id`, `symbol`, `timeframe`, `start`, `end`,
        - `initial_capital`,
        - optional `params` (inline overrides) and `params_id` (references a `StrategyParameter`),
        - optional `price_source` flag (`kite`, `yfinance`, `synthetic`, etc.).
      - Behavior:
        - Loads the `Strategy` from the meta DB; fails fast if not found.
        - Resolves parameters by merging:
          - `StrategyParameter.params_json` (when `params_id` is provided),
          - Inline `params` overrides.
        - Queries `PriceBar` rows from the prices DB for the given `symbol/timeframe/[start,end]` window.
        - Converts them into a `pandas.DataFrame` and builds a `BacktestConfig`.
        - Runs the Backtrader engine to obtain a `BacktestResult`.
        - Persists a `Backtest` record in `sigmaqlab_meta.db`:
          - Fields: `strategy_id`, `params_id`, `engine="backtrader"`, `symbols_json=[symbol]`, `timeframe`, `start_date`, `end_date`, `initial_capital`, `status="completed"`, `metrics_json=result.metrics`, `data_source=price_source`.
        - Returns the persisted `Backtest` ORM object.

### Tests for S04/G01

- File: `backend/tests/test_backtest_engine_and_service.py`.
  - Skips all tests when `backtrader` is not installed (module-level `pytestmark`), so your CI/dev loop doesn’t depend on having Backtrader in every environment.
  - `test_backtrader_engine_runs_on_synthetic_data`:
    - Builds an upward-trending synthetic OHLCV series in a DataFrame.
    - Constructs a `BacktestConfig` with `strategy_code="SMA_X"`, `params={"fast": 5, "slow": 20}`, and runs the engine.
    - Asserts:
      - Strategy/symbol/timeframe are as expected.
      - Equity curve length equals number of bars.
      - `metrics["final_value"]` exists and is positive.
  - `test_backtest_service_persists_backtest_record`:
    - Clears and recreates meta and prices DB schemas.
    - Inserts:
      - A `Strategy` with `code="SMA_X"`.
      - A `StrategyParameter` with `params_json={"fast": 5, "slow": 20}`.
      - Synthetic OHLCV rows in `PriceBar` for symbol `TEST`.
    - Invokes `BacktestService.run_single_backtest(...)` with `params_id` pointing to the parameter set.
    - Asserts:
      - A `Backtest` row is created with a non-null id.
      - `engine == "backtrader"`, `symbols_json == ["TEST"]`.
      - `metrics_json` is populated and `status == "completed"`.

### Sprint workbook updates for S04/G01

- `docs/qlab_sprint_tasks_codex.xlsx` has been updated so that:
  - `S04_G01_TB001` – Strategy engine interface and BacktestResult models,
  - `S04_G01_TB002` – Backtrader integration as the primary engine,
  - `S04_G01_TB003` – BacktestService wired to the engine and databases,
  now have `status = implemented` and concise remarks reflecting the above work.

---

## Sprint S04 – Backtest execution API & UI (G02)

**Group:** G02 – Backtest execution: API endpoint and simple UI trigger
**Tasks:** S04_G02_TB001–TB003
**Status (Codex):** implemented (with a minor UI placement deviation for TF002)

### S04_G02_TB001 – Backtest execution API

- Implemented a dedicated Backtests API router to expose the backtest engine and service via HTTP.
- Schemas:
  - `backend/app/schemas.py`:
    - `BacktestCreateRequest`:
      - Fields: `strategy_id`, optional `params_id`, `symbol`, `timeframe`, `start_date`, `end_date`, `initial_capital`, optional `params` (inline overrides), optional `price_source`.
      - Mirrors the `BacktestService.run_single_backtest(...)` signature and keeps the request payload concise.
    - `BacktestRead`:
      - Maps the `Backtest` ORM model to API shape, including:
        - `engine`, `symbols_json`, `timeframe`, `start_date`, `end_date`, `initial_capital`, `status`, `data_source`, `created_at`, `finished_at`,
        - `metrics` field backed by the `metrics_json` column (via `validation_alias`).
- Router:
  - File: `backend/app/routers/backtests.py`.
  - Endpoints:
    - `POST /api/backtests`:
      - Accepts `BacktestCreateRequest`.
      - Uses `BacktestService` with injected `meta_db` and `prices_db` sessions.
      - Converts `start_date`/`end_date` to datetime window boundaries.
      - Handles errors:
        - `ValueError` → HTTP 400 (e.g. missing strategy, params, or price data).
        - `RuntimeError` → HTTP 500 (e.g. Backtrader not installed).
      - Returns a `BacktestRead` representation of the persisted `Backtest` record on success.
    - `GET /api/backtests`:
      - Lists backtests ordered by `created_at` descending, returning `List[BacktestRead]`.
    - `GET /api/backtests/{backtest_id}`:
      - Returns a single `BacktestRead` or 404 if not found.
- Tests:
  - File: `backend/tests/test_backtests_api.py`.
  - Skips when `backtrader` is not installed.
  - `test_create_backtest_via_api`:
    - Seeds a `Strategy` with `code="SMA_X"`, a `StrategyParameter`, and synthetic `PriceBar` rows.
    - Calls `POST /api/backtests` with appropriate dates and `initial_capital`.
    - Asserts:
      - Response status `201`, `engine == "backtrader"`, `symbols_json == ["TESTBT"]`, `status == "completed"`, and `metrics.final_value` present.
    - Verifies that the created backtest appears in `GET /api/backtests`.

How to verify:

- From `backend/` with the venv active:
  - `pytest` (backtests API test is skipped if Backtrader is not installed).
  - Run the app and call:
    - `POST http://127.0.0.1:8000/api/backtests` with a payload similar to `test_backtests_api.py` once you have price data for your symbol.

### S04_G02_TF002 – Backtest configuration UI (Run Backtest form)

- Implemented a minimal Backtests UI to configure and trigger runs from the browser.
- File: `frontend/src/pages/BacktestsPage.tsx`.
- Run Backtest form (left side of the page):
  - Strategy selection:
    - Loads strategies via `GET /api/strategies`.
    - Uses a MUI `TextField` with `select` to choose a strategy by `code – name`.
    - If no strategies exist, shows an instructional message guiding the user to create one in the Strategy Library.
  - Parameter set selection:
    - When a strategy is selected, loads its parameter sets via `GET /api/strategies/{strategy_id}/params`.
    - Optional dropdown for `params_id` (“None” allowed).
  - Core configuration fields:
    - `Symbol` (uppercased as the user types).
    - `Timeframe` (1m, 5m, 15m, 1h, 1d – aligned with the Data page).
    - `Start date`, `End date` (date pickers initialised to today).
    - `Initial capital` (numeric input, default `100000`).
    - `Price source label` (select with options such as `prices_db`, `kite`, `yfinance`, `synthetic`, `csv` – purely a tag passed as `price_source`).
  - Override parameters:
    - `Override params JSON (optional)` multi-line text area.
    - If non-empty, the form validates JSON client-side and submits it as `params` in the payload; otherwise `params` is `null`.
  - Submission behavior:
    - On submit, posts to `POST /api/backtests` with a body that matches `BacktestCreateRequest`.
    - Success:
      - Prepends the created backtest to the in-memory list.
      - Shows a concise success message summarizing PnL and final value when available.
    - Error:
      - Displays the backend `detail` message for 4xx/5xx responses or a generic error message.
- Deviation note:
  - The original sprint item described a “Run Backtest” modal inside the Strategy detail view.
  - For clarity and simplicity at this stage, the configuration form is implemented directly on the `/backtests` page instead of a modal.
  - The sprint workbook records this as a minor UI placement deviation; a strategy-scoped modal can be added later if needed.

How to verify:

- From `frontend/`:
  - `npm run dev` and navigate to `/backtests`.
- Pre-conditions:
  - At least one `Strategy` (e.g. `SMA_X`) and an optional parameter set created via the Strategy Library.
  - Relevant price data loaded into `sigmaqlab_prices.db` via the Data page or a CSV.
- Then:
  - Use the Backtests page form to submit a backtest and confirm a success banner and a new row in the “Recent Backtests” table.

### S04_G02_TF003 – Backtests list page

- Completed the Backtests page by adding a simple list of recent runs.
- Still in `frontend/src/pages/BacktestsPage.tsx`:
  - On initial load, the page calls `GET /api/backtests` and stores the results in `backtests` state.
  - Renders a MUI `Table` titled “Recent Backtests” with columns:
    - `ID` – backtest id.
    - `Strategy` – resolved as `code – name` by matching `strategy_id` with the loaded strategies.
    - `Symbol(s)` – uses `symbols_json`; shows the primary symbol and `+N` when multiple symbols are present.
    - `Timeframe`, `Status`.
    - `PnL` – derived from `metrics.pnl`, formatted with a sign and two decimals when available.
    - `Final value` – derived from `metrics.final_value` when present.
    - `Created` – formatted `created_at` timestamp via `toLocaleString`.
  - When a new backtest is created via the form, it is prepended to this list so the UI reflects the latest run immediately without a separate refresh.
- This page is intentionally minimal but provides enough visibility to confirm that backtests are being persisted and associated metrics are populated.

Sprint workbook updates for S04/G02:

- `docs/qlab_sprint_tasks_codex.xlsx` has been updated so that:
  - `S04_G02_TB001` – Backtest execution API is marked `implemented` with remarks describing the `/api/backtests` wiring and tests.
  - `S04_G02_TF002` – Backtest configuration UI is marked `implemented` with a deviation note indicating that the form lives on the Backtests page rather than a Strategy detail modal.
  - `S04_G02_TF003` – Backtests list page is marked `implemented`, noting the columns and linkage to the API.

---

## Sprint S05 – Backtest Results: Persistence & Metrics (G01)

**Group:** G01 – Backtest results: persistence and metrics calculation
**Tasks:** S05_G01_TB001–TB003
**Status (Codex):** implemented

### S05_G01_TB001 – Persist equity curve and trades

- Extended the meta DB schema to capture detailed backtest results beyond the summary row:
  - New models in `backend/app/models.py`:
    - `BacktestEquityPoint`:
      - Fields: `id`, `backtest_id` (FK → `backtests.id`), `timestamp`, `equity`.
      - Represents a single point on the equity curve for a given backtest.
    - `BacktestTrade`:
      - Fields: `id`, `backtest_id`, `symbol`, `side` (`long`/`short`), `size`, `entry_timestamp`, `entry_price`, `exit_timestamp`, `exit_price`, `pnl`.
      - Represents a single closed trade for that backtest.
  - Relationships:
    - `Backtest` now has backrefs `equity_points` and `trades` to navigate to these child records.
- Backtest engine:
  - `backend/app/backtest_engine.py`:
    - Added `TradeRecord` dataclass alongside `EquityPoint`.
    - Extended `BacktestResult` to include:
      - `equity_curve: list[EquityPoint]`
      - `trades: list[TradeRecord]`
    - `SmaCrossStrategy` (Backtrader):
      - Still records equity on each bar into `self._equity_curve`.
      - Implements `notify_trade` to capture closed trades:
        - Determines side (`long`/`short`) from trade size.
        - Extracts entry timestamp/price from `trade.history` (with a defensive fallback).
        - Uses the current bar’s datetime as exit timestamp.
        - Stores `pnl` from `trade.pnlcomm`.
      - Accumulates trades into `self._trades`, which are fed into `BacktestResult`.

### S05_G01_TB002 – Metrics calculation

- `BacktestService` now derives richer metrics from the engine result:
  - File: `backend/app/backtest_service.py`.
  - After `BacktraderEngine.run(...)`:
    - Starts from the engine’s basic metrics (`final_value`, `initial_capital`, `pnl`).
    - From the equity curve:
      - `total_return`:
        - `(final_equity / start_equity) - 1.0` when `start_equity > 0`.
      - `max_drawdown`:
        - Iterates over equity values, tracking the running peak and the largest peak-to-trough percentage drop.
    - From the trades list:
      - `trade_count` – number of trades.
      - `avg_win` – average PnL of winning trades (P&L > 0).
      - `avg_loss` – average PnL of losing trades (P&L < 0).
      - `win_rate` – `wins / (wins + losses)` (ignoring flat trades).
  - These metrics are stored in `Backtest.metrics_json` alongside the existing keys, so existing consumers still work while new consumers can read the enriched set.
- Persistence:
  - After creating the `Backtest` row, `BacktestService`:
    - Writes `BacktestEquityPoint` rows from `result.equity_curve`.
    - Writes `BacktestTrade` rows from `result.trades`.
    - Commits once after inserting children for efficiency.

### S05_G01_TB003 – API endpoints for results

- Added dedicated endpoints to retrieve backtest results in a structured way:
  - File: `backend/app/routers/backtests.py`.
  - Schemas in `backend/app/schemas.py`:
    - `BacktestEquityPointRead`:
      - `timestamp`, `equity`.
    - `BacktestTradeRead`:
      - `id`, `symbol`, `side`, `size`, `entry_timestamp`, `entry_price`, `exit_timestamp`, `exit_price`, `pnl`.
  - Endpoints:
    - `GET /api/backtests/{backtest_id}` (existing):
      - Still returns `BacktestRead` with enriched `metrics`.
    - `GET /api/backtests/{backtest_id}/equity`:
      - Returns a time-ordered list of `BacktestEquityPointRead` for the given backtest.
      - 404 if the backtest does not exist.
    - `GET /api/backtests/{backtest_id}/trades`:
      - Returns a list of `BacktestTradeRead` for the given backtest.
      - 404 if the backtest does not exist.

### Tests for S05/G01

- Engine & service tests:
  - `backend/tests/test_backtest_engine_and_service.py`:
    - `test_backtest_engine_runs_on_synthetic_data`:
      - Still validates the engine runs and returns an equity curve and basic metrics.
    - `test_backtest_service_persists_backtest_record`:
      - Now additionally asserts:
        - `metrics_json` contains `final_value`, `total_return`, and `max_drawdown`.
        - `backtest.equity_points` is non-empty.
        - `backtest.trades` is present (at least one trade expected for the simple SMA strategy).
- API tests:
  - `backend/tests/test_backtests_api.py`:
    - After posting to `/api/backtests`, test now asserts that the returned `metrics` include `total_return` and `max_drawdown` in addition to `final_value`.
    - Existing checks for engine, status, and list endpoint remain intact.

### Sprint workbook updates for S05/G01

- `docs/qlab_sprint_tasks_codex.xlsx` has been updated so that:
  - `S05_G01_TB001` – notes the new `backtest_equity_points` and `backtest_trades` tables and how equity curves/trades are persisted.
  - `S05_G01_TB002` – records the metrics now computed (`total_return`, `max_drawdown`, `trade_count`, `win_rate`, `avg_win`, `avg_loss`) and stored in `metrics_json`.
  - `S05_G01_TB003` – describes the new `/api/backtests/{id}/equity` and `/api/backtests/{id}/trades` endpoints for fetching detailed backtest results.
  All three tasks are marked `implemented`.

---

## Sprint S05 – Backtest Detail UI (G02)

**Group:** G02 – Backtest detail UI: equity chart, trades table, and parameters
**Tasks:** S05_G02_TF001–TF003
**Status (Codex):** implemented

### S05_G02_TF001 – Backtest detail page with equity curve

- Extended the Backtests page to include a Backtest Details panel instead of creating a separate route, keeping navigation simple while still surfacing rich information.
- File: `frontend/src/pages/BacktestsPage.tsx`.
- Behaviour:
  - The **Recent Backtests** table is now selectable:
    - Clicking a row sets it as the `selectedBacktest`.
    - The selected row is highlighted.
  - Below the main grid, a new **Backtest Details – #ID** card appears when a backtest is selected.
  - Summary section:
    - Shows strategy label (`CODE – Name`), symbols, timeframe, status.
    - Displays key metrics from `metrics`:
      - `initial_capital`, `final_value`, `pnl`,
      - `total_return`, `max_drawdown`,
      - `trade_count`, `win_rate`, `avg_win`, `avg_loss`.
    - Helpers render numbers and percentages consistently (two decimal places).
  - Equity curve:
    - On selection, the UI calls `GET /api/backtests/{id}/equity`.
    - Renders a Recharts `LineChart` in a `ResponsiveContainer`.
    - X-axis: timestamps (hidden ticks; full timestamp in tooltip).
    - Y-axis: equity values.
    - This gives a quick view of how the portfolio evolved during the run.

### S05_G02_TF002 – Trades table

- In the same Backtest Details card, added a **Trades** table:
  - On selection, the UI calls `GET /api/backtests/{id}/trades`.
  - Shows one row per trade with:
    - `ID`, `Symbol`, `Side`, `Size`,
    - `Entry` (timestamp), `Entry price`,
    - `Exit` (timestamp), `Exit price`,
    - `PnL`.
  - Values are formatted to two decimals where appropriate.
  - If there are no trades, a small “No trades recorded for this backtest” message is shown.
- This table is directly backed by `BacktestTradeRead` from the new backend endpoints, and will naturally grow as more complex strategies produce richer trade streams.

### S05_G02_TF003 – Parameters in detail view

- When a backtest has an associated parameter set (`params_id` not null), the Backtest Details panel shows the parameters used:
  - The UI calls `GET /api/params/{params_id}` to fetch the `StrategyParameter` detail.
  - Renders:
    - A title: `Parameters – {label}`.
    - A preformatted JSON block showing `params` with indentation.
  - This allows you to see at a glance which parameter configuration was active for the selected run without switching back to the Strategies page.

Sprint workbook updates for S05/G02:

- `docs/qlab_sprint_tasks_codex.xlsx` has been updated so that:
  - `S05_G02_TF001` – notes that the Backtests page now includes a details panel with summary metrics and an equity curve chart for the selected run.
  - `S05_G02_TF002` – records the addition of the trades table with entry/exit, side, size, and PnL columns.
  - `S05_G02_TF003` – states that the Backtest Details panel surfaces the parameter set used (when available), with JSON rendered in a readable form.
  All three tasks are marked `implemented`.

---

## Sprint S06 – Backtest Overhaul: Backend Metrics & Projections (G01)

**Group:** G01 – Backtest Overhaul: backend metrics and projections
**Tasks:** S06_G01_TB001–TB004
**Status (Codex):** implemented

### S06_G01_TB001 – Backtest model extensions for configs and effective params

- Extended the `Backtest` ORM model in `backend/app/models.py` with additional metadata and configuration fields:
  - `label: Optional[str]` – short human label for the run.
  - `notes: Optional[str]` – free-form notes about the configuration or experiment.
  - `params_effective_json: Optional[JSON]` – the fully resolved parameters actually used in the run (merged from parameter set + inline overrides).
  - `risk_config_json: Optional[JSON]` – placeholder for future risk settings (max position size, per-trade risk, etc.).
  - `costs_config_json: Optional[JSON]` – placeholder for commission / slippage / other charges configuration.
  - `visual_config_json: Optional[JSON]` – placeholder for chart visualisation preferences (markers, overlays, etc.).
- Added lightweight schema migration support for these columns:
  - `backend/app/database.py`:
    - `ensure_meta_schema_migrations()` now:
      - Detects existing `backtests` table.
      - Adds the above columns via `ALTER TABLE` when missing.
- `BacktestService.run_single_backtest(...)` now populates `params_effective_json` with the merged `resolved_params` used for the run (or `None` when no parameters are involved), so future detail views and reports can reconstruct the configuration without re-deriving it.

### S06_G01_TB002 – Persistence for trades and equity curves

- Confirmed and wired the dedicated tables for trade and equity persistence:
  - `BacktestEquityPoint` (`backtest_equity_points`):
    - Columns: `id`, `backtest_id`, `timestamp`, `equity`.
  - `BacktestTrade` (`backtest_trades`):
    - Columns (existing): `id`, `backtest_id`, `symbol`, `side`, `size`, `entry_timestamp`, `entry_price`, `exit_timestamp`, `exit_price`, `pnl`.
- Extended `BacktestTrade` to support additional per-trade derived metrics:
  - `pnl_pct: Optional[float]` – realised PnL as a percentage of entry notional.
  - `holding_period_bars: Optional[int]` – number of bars between entry and exit.
  - `max_theoretical_pnl: Optional[float]` – best-case PnL from holding the position from entry to the most favourable price over the backtest horizon.
  - `max_theoretical_pnl_pct: Optional[float]` – the same as a percentage of entry notional.
  - `pnl_capture_ratio: Optional[float]` – realised PnL divided by `max_theoretical_pnl` (when the latter is non-zero).
- `ensure_meta_schema_migrations()` now:
  - Detects `backtest_trades` table and adds the new columns if missing, keeping existing databases compatible with the new code.
- `BacktestService.run_single_backtest(...)` continues to:
  - Persist one `BacktestEquityPoint` per equity-curve point.
  - Persist one `BacktestTrade` per closed trade, now including the extra derived metrics (see TB004).

### S06_G01_TB003 – Expanded backtest metrics (volatility, Sharpe, Sortino, Calmar)

- Added helper methods on `BacktestService` to compute richer metrics from the equity curve and trades:
  - `_compute_equity_metrics(equity_curve, timeframe)`:
    - Inputs: list of `EquityPoint` objects and the string timeframe (`1m`, `1h`, `1d`, etc.).
    - Computes:
      - `total_return` = `final_equity / initial_equity - 1`.
      - `max_drawdown` – peak-to-trough drawdown computed from the running peak.
      - Per-bar return series from the equity curve.
      - `volatility` – population standard deviation of bar returns.
      - `sharpe` – mean(bar returns) / `volatility`, with zero risk-free rate for now.
      - `sortino` – mean(bar returns) / downside deviation (based on negative returns only).
      - `annual_return` – annualised return based on:
        - Timeframe minutes (`_TIMEFRAME_MINUTES`) to estimate bars-per-day and bars-per-year.
      - `calmar` – `annual_return / max_drawdown` when drawdown > 0.
  - `_compute_trade_metrics(trades)`:
    - Inputs: list of `TradeRecord`.
    - Computes:
      - `trade_count`, `avg_win`, `avg_loss`, `win_rate`.
- `run_single_backtest(...)` now merges:
  - `result.metrics` from the engine,
  - `_compute_equity_metrics(...)`,
  - `_compute_trade_metrics(...)`,
  into a single `metrics_json` dictionary.
- The existing tests in `backend/tests/test_backtest_engine_and_service.py` were updated to:
  - Assert presence of new keys `volatility`, `sharpe`, `sortino`, `annual_return`, and `calmar` in `metrics_json` (when Backtrader is available).

### S06_G01_TB004 – Unrealised projection and per-trade what-if metrics

- Implemented per-trade “what-if” metrics directly from the price series:
  - In `BacktestService.run_single_backtest(...)`:
    - Uses the same `pandas.DataFrame` of closes (`df["close"]`) that was passed to the engine.
    - For each `TradeRecord`:
      - Determines direction (`+1` for long, `-1` for short).
      - Builds:
        - `window_after_entry`: all closes from `entry_timestamp` to the end of the backtest.
        - `holding_window`: closes from `entry_timestamp` to `exit_timestamp`.
      - Computes:
        - `holding_period_bars` as `len(holding_window)` (or `None` if window is empty).
        - Entry notional = `entry_price * size`.
        - `pnl_pct` = `pnl / notional` when notional > 0.
        - Projection series: `direction * (close_t - entry_price) * size` over `window_after_entry`.
        - `max_theoretical_pnl` = max of that projection series (or `None` if empty).
        - `max_theoretical_pnl_pct` = `max_theoretical_pnl / notional` when notional > 0.
        - `pnl_capture_ratio` = `pnl / max_theoretical_pnl` when `max_theoretical_pnl != 0`.
    - Populates the corresponding columns on each `BacktestTrade` row.
- These per-trade fields provide the backend foundation for:
  - Trade table columns (`what_if_pnl`, capture ratios),
  - Projection overlays and tooltips in the forthcoming Backtest detail chart UI (S06_G02/S07 tasks).

Sprint workbook updates for S06/G01:

- `docs/qlab_sprint_tasks_codex.xlsx` has been updated so that:
  - `S06_G01_TB001` – notes Backtest model extensions for effective params and config JSON.
  - `S06_G01_TB002` – records the enriched `backtest_trades` schema and migration helper.
  - `S06_G01_TB003` – describes the new equity/trade risk metrics (volatility, Sharpe, Sortino, annual return, Calmar).
  - `S06_G01_TB004` – documents per-trade what-if metrics (`pnl_pct`, `holding_period_bars`, `max_theoretical_pnl`, `pnl_capture_ratio`).
  All four tasks are now marked `implemented`.

---

## Sprint S06 – Backtest Overhaul: Chart & Series APIs (G02)

**Group:** G02 – Backtest Overhaul: chart and series APIs
**Tasks:** S06_G02_TB001–TB004
**Status (Codex):** implemented

### S06_G02_TB001 – `/api/backtests/{id}/chart-data` endpoint

- Added a chart-data endpoint in `backend/app/routers/backtests.py`:
  - `GET /api/backtests/{id}/chart-data` returns a `BacktestChartDataResponse`.
  - Schema additions in `backend/app/schemas.py`:
    - `BacktestChartPriceBar` – OHLCV bar (`timestamp`, `open`, `high`, `low`, `close`, `volume`).
    - `IndicatorPoint` – `{timestamp, value}` pair for indicator series.
    - `BacktestChartDataResponse` – aggregates:
      - `backtest` (`BacktestRead`),
      - `price_bars: List[BacktestChartPriceBar]`,
      - `indicators: Dict[str, List[IndicatorPoint]]`,
      - `equity_curve: List[BacktestEquityPointRead]`,
      - `projection_curve: List[BacktestEquityPointRead]`,
      - `trades: List[BacktestTradeRead]`.
- Implementation:
  - Loads the `Backtest` and resolves the primary symbol from `symbols_json[0]`.
  - Queries `PriceBar` rows for `(symbol, timeframe, [start_date, end_date])` and builds `price_bars`.
  - Computes simple SMA overlays on close prices:
    - `sma_5` and `sma_20` via a small `_sma` helper, exposed under `"sma_5"` and `"sma_20"` in `indicators`.
  - Loads equity points from `backtest_equity_points` and trades from `backtest_trades`.
  - Builds a basic projection curve:
    - For each price bar timestamp `t`, sums hypothetical PnL for all trades as if they were held from entry through `t`, with:
      - `direction = +1` for long, `-1` for short,
      - `projection_equity(t) = initial_capital + sum(direction * (close_t - entry_price) * size)`.
    - Returns this as `projection_curve` for visual comparison with the realised equity curve.

### S06_G02_TB002 – Enriched `/api/backtests/{id}/trades` response

- `BacktestTradeRead` in `backend/app/schemas.py` was extended to surface per-trade metrics:
  - `pnl_pct`, `holding_period_bars`, `max_theoretical_pnl`, `max_theoretical_pnl_pct`, `pnl_capture_ratio`.
- The existing `GET /api/backtests/{id}/trades` endpoint continues to return `List[BacktestTradeRead]` and now includes these fields, which are populated by `BacktestService.run_single_backtest(...)` (see S06_G01_TB004).

### S06_G02_TB003 – Trades CSV export endpoint

- Implemented CSV export for trades in `backend/app/routers/backtests.py`:
  - `GET /api/backtests/{id}/trades/export`:
    - Validates that the backtest exists.
    - Loads all associated `BacktestTrade` rows.
    - Writes them to an in-memory CSV with headers:
      - `id, symbol, side, size, entry_timestamp, entry_price, exit_timestamp, exit_price, pnl, pnl_pct, holding_period_bars, max_theoretical_pnl, max_theoretical_pnl_pct, pnl_capture_ratio`.
    - Returns a `StreamingResponse` with `text/csv` content type and a `Content-Disposition` filename like `backtest_{id}_trades.csv`.
- The CSV shape matches the trade-table columns planned for the Backtest detail UI.

### S06_G02_TB004 – Metrics exposure via existing backtest detail

- Kept metrics exposure via the existing `BacktestRead` API model:
  - `GET /api/backtests/{id}` returns `BacktestRead` with:
    - `metrics` mapped from `metrics_json`, now including the expanded metric set from S06_G01.
  - `BacktestChartDataResponse.backtest` embeds this same `BacktestRead`, so chart consumers automatically receive:
    - PnL, total/annual return, max drawdown, volatility, Sharpe, Sortino, Calmar, trade counts and averages, etc.
- No separate `/metrics` endpoint is needed at this stage; the detail and chart-data endpoints both expose metrics consistently.

Sprint workbook updates for S06/G02:

- `docs/qlab_sprint_tasks_codex.xlsx` has been updated so that:
  - `S06_G02_TB001` – records the `/api/backtests/{id}/chart-data` endpoint and response structure.
  - `S06_G02_TB002` – notes the enriched `BacktestTradeRead` returned by `/trades`.
  - `S06_G02_TB003` – records the CSV export endpoint for backtest trades.
  - `S06_G02_TB004` – states that expanded metrics are exposed via `BacktestRead` and reused in chart-data responses.
  All four tasks are marked `implemented`.

---

## Sprint S07 – Backtest Overhaul UI: Backtest Detail, Settings, Trades (G01–G03)

**Groups:**

- G01 – Backtest detail chart (price, volume, indicators, trades)
- G02 – Strategy/backtest settings panel
- G03 – Trades table and exports

**Tasks:** S07_G01_TF001–TF003, S07_G02_TF001–TF002, S07_G03_TF001–TF002
**Status (Codex):** implemented

### S07_G01_TF001 – Backtest detail chart (Price & Trades)

- Implemented a dedicated `BacktestDetailChart` React component in `frontend/src/features/backtests/components/BacktestDetailChart.tsx` that uses `lightweight-charts` to render:
  - A **price pane** with candlestick OHLC bars and an optional volume histogram.
  - An **equity pane** with realised equity curve and an optional “projection” curve (unrealised what-if path).
  - Entry/exit markers (`E` / `X`) for each trade, coloured by side (long/short).
- The chart normalises times (sorting and deduplicating timestamps) to satisfy lightweight-charts’ strict ordering requirements and keeps price and equity panes time-synchronised.
- The Backtests page (`frontend/src/pages/BacktestsPage.tsx`) embeds this component under “Price & Trades” in the **Backtest Details** card.

### S07_G01_TF002 – Recent Backtests UX polish

- Extended the **Recent Backtests** card to support:
  - Row-level checkboxes and a “Select page” button.
  - A “Delete selected” button that issues `DELETE /api/backtests/{id}` per selected row and cleans up equity/trade rows.
  - Pagination controls (`<<`, `<`, page size, `>`, `>>`) so large histories remain manageable.
- The table now shows ID, strategy, symbols, timeframe, status, PnL, final value, and created time (rendered in IST).

### S07_G02_TF001 – Backtest settings schema and API

- Extended the backtest schema (`backend/app/schemas.py`, `backend/app/models.py`) and service to support settings metadata:
  - New fields on `BacktestCreateRequest`: `label`, `notes`, `risk_config`, `costs_config`, `visual_config`.
  - New fields on `BacktestRead` (mapped via `validation_alias`): `label`, `notes`, `risk_config`, `costs_config`, `visual_config`.
  - `BacktestService.run_single_backtest(...)` now accepts the same optional settings and persists them into `label`, `notes`, `risk_config_json`, `costs_config_json`, `visual_config_json`.
- Added a settings-specific update endpoint in `backend/app/routers/backtests.py`:
  - `PATCH /api/backtests/{id}/settings` with payload `BacktestSettingsUpdate` (`backend/app/schemas_backtest_settings.py`).
  - Updates label/notes and the three config JSON blobs without re-running the engine.

### S07_G02_TF002 – Backtest settings UI (modal)

- Implemented a **Backtest Settings** modal on the Backtests page:
  - Opened via a `Settings` button in the Backtest Details header.
  - Tabs:
    - **Inputs** – read-only view of the parameter set used for this run.
    - **Risk** – fields for max position size %, per-trade risk %, allow short selling, and default stop-loss/take-profit percentages.
    - **Costs** – commission type (flat/percent), commission value, slippage per share, other charges %.
    - **Visualization** – switches to toggle trade markers, projection curve, and volume histogram.
    - **Meta / Notes** – editable label and free-form notes for the backtest.
- On save, the modal calls `PATCH /api/backtests/{id}/settings` and:
  - Updates the backtest object in state and in the Recent Backtests list.
  - Applies the visual settings immediately to `BacktestDetailChart`.

### S07_G03_TF001 – Trades table and what-if metrics

- Extended the Backtest Details view with a **Trades** section:
  - An **Export CSV** button that hits `GET /api/backtests/{id}/trades/export`.
  - A **Show trades table / Hide trades table** toggle.
  - A detailed table when trades are present, showing:
    - ID, symbol, side, size.
    - Entry/exit timestamps and prices.
    - PnL, PnL %, equity at exit.
    - What-if PnL, capture %, cumulative PnL across trades.
- The table uses the enriched `BacktestTradeRead` model (S06) plus a small client-side reducer to compute cumulative PnL and equity-at-exit (using the equity curve).

### S07_G03_TF002 – Removal of obsolete equity table

- Removed the older “Equity Data (last 50 bars)” placeholder section in favour of the chart + trades table, to keep the Backtest Details area focused and uncluttered.

Sprint workbook updates for S07:

- `docs/qlab_sprint_tasks_codex.xlsx` is expected to mark:
  - `S07_G01_TF001–TF002`, `S07_G02_TF001–TF002`, and `S07_G03_TF001–TF002` as `implemented`, with remarks pointing to:
    - BacktestDetailChart, the Backtests page updates, the Settings modal, and the trades table/export.

---

## Sprint S08 – Backtest Overhaul: Documentation, Regression Tests, and Polish (G01)

**Group:** G01 – Backtest Overhaul: documentation, regression tests, and polish
**Tasks:** S08_G01_TB001–TB003
**Status (Codex):** implemented

### S08_G01_TB001 – Backtests section in User Manual

- Updated `docs/qlab_user_manual.md` to fully reflect the Backtest Overhaul:
  - Data section:
    - Coverage Summary now documents a stable **Coverage ID** column (`SYMBOL_EXCHANGE_SOURCE_00000`) and explains how it’s generated from `(symbol, exchange, timeframe, source)` and used by the Backtests page.
  - Backtests section:
    - Run Backtest form now describes:
      - Strategy selection with automatic default parameter resolution.
      - **Data mode** toggle (Use existing coverage vs Fetch fresh data).
      - Coverage ID drop-down and its relationship to Data → Coverage Summary.
      - Fresh-data path that triggers `POST /api/data/fetch` before running.
      - The updated behaviour of `POST /api/backtests`.
    - Recent Backtests table:
      - Describes the selection checkboxes, “Select page” and “Delete selected” actions, and pagination controls.
    - Backtest Details:
      - Documents the Price & Trades chart (candles, volume, trade markers, equity + projection).
      - Explains the trades table, CSV export, and the Backtest Settings modal (tabs and what each controls).

### S08_G01_TB002 – Regression tests for backtest settings API

- Extended `backend/tests/test_backtests_api.py` to exercise the new settings endpoint:
  - After creating a backtest via `POST /api/backtests`, the test now:
    - Calls `PATCH /api/backtests/{id}/settings` with sample `label`, `notes`, `risk_config`, `costs_config`, and `visual_config`.
    - Asserts that the returned `BacktestRead` reflects the updated fields.
    - Confirms that a subsequent `GET /api/backtests/{id}` returns the same values.
- This acts as a regression guard around:
  - The `BacktestSettingsUpdate` schema.
  - The alias mapping from `*_config_json` columns to `risk_config`, `costs_config`, and `visual_config` in `BacktestRead`.

### S08_G01_TB003 – Pytest/markers and lint polish

- Introduced a root-level `pytest.ini` to register the `integration` marker:
  - Eliminates `PytestUnknownMarkWarning` for `@pytest.mark.integration` in live-provider tests.
- Cleaned up Ruff line-length warnings for new backtest settings fields by wrapping long description strings in `backend/app/schemas.py` and `backend/app/schemas_backtest_settings.py`.

Sprint workbook updates for S08:

- `docs/qlab_sprint_tasks_codex.xlsx` should mark:
  - `S08_G01_TB001` – Backtests section in the user manual updated for coverage IDs, Run Backtest flow, Backtest Detail chart, and settings.
  - `S08_G01_TB002` – Regression tests added for `PATCH /api/backtests/{id}/settings`.
  - `S08_G01_TB003` – Test/marker and lint polish (pytest integration mark, Ruff clean-up).
  All three tasks are now `implemented`.

---

## Sprint S09 – Zero Lag Trend Strategy (MTF): Pine analysis and engine design (G01)

**Group:** G01 – Zero Lag Trend Strategy (MTF): Pine analysis and engine design
**Tasks:** S09_G01_TB001–TB003
**Status (Codex):** implemented

### S09_G01_TB001 – Pine script analysis

  - Analysed the TradingView script `ref_strategy_code/zero_lag_trend_strategy_mtf.pine` and documented:
  - All user inputs (length, band multiplier, MTF timeframes, colours, stop/target %, long‑only toggle).
  - Zero‑lag EMA and volatility band calculations:
    - De‑lagged price input and ATR‑based band width (`highest(atr(length), length*3) * mult`).
  - Trend state machine:
    - `trend` variable taking values +1/‑1 based on crossovers of price vs `zlema ± volatility`.
  - Entry/exit rules:
    - Trend‑reversal‑driven entries with custom pyramiding limit.
    - Stop‑loss / take‑profit orders defined as % of `strategy.position_avg_price`.
  - Multi‑timeframe diagnostics (MTF table) and their current role as display‑only signals.
- Findings and structure are captured in `docs/zero_lag_trend_mtf_design.md` (section 1).

### S09_G01_TB002 – Backtrader engine design

- Designed a Backtrader strategy `ZeroLagTrendMtfStrategy` that mirrors the Pine logic while fitting SigmaQLab’s existing Backtest Overhaul architecture:
  - Proposed params:
    - `length`, `mult`, `stop_loss_pct`, `take_profit_pct`, `take_long_only`, `pyramid_limit`, and optional MTF timeframe labels.
  - Internal indicators and state:
    - Zero‑lag EMA implementation, ATR‑highest volatility band, per‑bar `trend` state, and storage of basis/bands for chart overlays.
  - Order logic mapping:
    - On trend reversals, close opposite positions, obey `pyramid_limit`, and open new positions in the direction of the new trend, with long‑only behaviour honoured.
    - Attach percentage‑based stop/target logic approximating Pine’s `strategy.exit` calls.
  - Engine integration:
    - Plan to register `ZeroLagTrendMtfStrategy` under `STRATEGY_REGISTRY["ZeroLagTrendMtfStrategy"]` with aliases for SigmaQLab strategy codes.
- The full design is written in `docs/zero_lag_trend_mtf_design.md` (section 2).

### S09_G01_TB003 – Verification plan and reference cases

- Defined the structure for TV‑parity verification without hard‑coding numbers (to be supplied later from TradingView runs):
  - Reference case components:
    - Symbol, exchange, timeframe, date range.
    - Param set (matching Pine defaults or variants).
    - Benchmark metrics: trade count, net profit, max drawdown, plus optionally key trades (entry/exit dates, side).
  - Pytest harness outline:
    - Metric parity test: compare trade count, PnL, DD against benchmarks within tolerances.
    - Signal alignment test: inspect a short window of trades and compare entry/exit timestamps to reference examples.
- This plan is also documented in `docs/zero_lag_trend_mtf_design.md` (section 3).

Sprint workbook updates for S09/G01:

- `docs/qlab_sprint_tasks_codex.xlsx` now marks:
  - `S09_G01_TB001` – Pine script inputs/logic/risk/MTF analysed and documented.
  - `S09_G01_TB002` – Backtrader engine design (params, trend state, orders, registry integration) described.
  - `S09_G01_TB003` – Verification/test plan structure defined for future TV parity checks.
  All three tasks are `implemented`; subsequent S09_G02–G04 tasks were scheduled for later implementation.

---

## Sprint S09 – Zero Lag Trend Strategy (MTF): Backtrader implementation and verification harness (G02)

**Group:** G02 – Zero Lag Trend Strategy (MTF): Backtrader implementation and verification harness
**Tasks:** S09_G02_TB001–TB004
**Status (Codex):** implemented

### S09_G02_TB001 – Backtrader implementation of ZeroLagTrendMtfStrategy

- Implemented `ZeroLagTrendMtfStrategy` in `backend/app/backtest_engine.py`:
  - Introduced a shared `SigmaBaseStrategy` that records equity and closed trades into `_equity_curve` and `_sigma_trades`.
  - Added a `ZeroLagEMA` indicator that approximates the Pine zero‑lag EMA:
    - Uses a de‑lagged input `src + (src - src_lag)` with a configurable look‑back and EMA smoothing.
  - Inside `ZeroLagTrendMtfStrategy`:
    - Computes ATR and a `Highest(ATR, length*3)` band scaled by `mult` to mirror the Pine volatility band.
    - Maintains integer `trend` state (+1/‑1) by detecting crossings of price versus `zlema ± volatility`.
    - Implements entry logic:
      - On bullish trend reversal: closes shorts and opens/increments longs up to `pyramid_limit`.
      - On bearish trend reversal (when `take_long_only` is false): closes longs and opens/increments shorts down to `-pyramid_limit`.
    - Implements percentage stop‑loss / take‑profit exits based on `position.price`, checking bar high/low against calculated stop/target levels.

### S09_G02_TB002 – Engine registry wiring

- Extended `STRATEGY_REGISTRY` in `backend/app/backtest_engine.py`:
  - Added canonical key `"ZeroLagTrendMtfStrategy"` pointing to the new strategy class, with placeholders when Backtrader is absent.
  - Adjusted `BacktraderEngine.run()` to treat strategies generically via `SigmaBaseStrategy`, so any registered engine that records `_equity_curve` / `_sigma_trades` can be used without special‑casing.

### S09_G02_TB003 – Engine-level verification harness

- Added `backend/tests/test_zero_lag_trend_mtf_engine.py`:
  - `test_zero_lag_engine_basic_metrics`:
    - Builds a deterministic synthetic OHLCV series with several mild trend shifts.
    - Runs `BacktraderEngine` with `strategy_code="ZeroLagTrendMtfStrategy"` and a compact parameter set (`length=20`, `mult=1.0`, etc.).
    - Asserts non‑empty equity curve/trades and checks that final equity, PnL and trade count fall within bounded ranges, acting as a regression guard on overall behaviour.
  - Module is guarded with `pytest.importorskip("backtrader")` so it is skipped cleanly when Backtrader is unavailable.

### S09_G02_TB004 – BacktestService integration test

- In the same test module, added `test_zero_lag_service_trades_and_equity`:
  - Seeds a `Strategy` row with `engine_code="ZeroLagTrendMtfStrategy"` and a matching `StrategyParameter` in the meta DB.
  - Writes the synthetic OHLCV series into `sigmaqlab_prices.db` via `PriceBar`.
  - Runs `BacktestService.run_single_backtest(...)` and asserts:
    - Engine `backtrader`, symbol list `["TESTZL"]`, and status `completed`.
    - Equity points and at least one trade are persisted for the backtest.

Sprint workbook updates for S09/G02:

- `docs/qlab_sprint_tasks_codex.xlsx` now marks:
  - `S09_G02_TB001` – ZeroLagTrendMtfStrategy implemented with zero‑lag EMA, ATR bands, trend state, and stop/target/pyramiding logic.
  - `S09_G02_TB002` – Engine registry extended with Zero Lag engine key for Strategy.engine_code wiring.
  - `S09_G02_TB003` – Synthetic‑data pytest harness added to validate Zero Lag metrics shape.
  - `S09_G02_TB004` – BacktestService integration test added to ensure equity/trades persistence for Zero Lag runs.
  All four tasks are now `implemented`; S09_G03–G04 cover integration and UI work.

---

## Sprint S09 – Zero Lag Trend Strategy (MTF): SigmaQLab backend/API integration and UI wiring (G03–G04)

**Groups:**
- G03 – Zero Lag Trend Strategy (MTF): SigmaQLab backend and API integration
- G04 – Zero Lag Trend Strategy (MTF): UI integration in Strategy Library and Backtests

**Status (Codex):** implemented

### G03 – Backend/API integration highlights

- Seeded a new preset strategy in `backend/app/seed.py`:
  - `code="ZLAG_MTF"`, `name="Zero Lag Trend MTF (default)"`, `category="trend"`.
  - `engine_code="ZeroLagTrendMtfStrategy"`.
  - Default params aligned with Pine defaults:
    - `length=70`, `mult=1.2`, `stop_loss_pct=2.0`, `take_profit_pct=4.0`, `take_long_only=False`, `pyramid_limit=2`.
- Extended `/api/backtests/{id}/chart-data` in `backend/app/routers/backtests.py`:
  - For all strategies:
    - Keeps existing SMA(5)/SMA(20) indicators.
  - For backtests whose `Strategy.engine_code == "ZeroLagTrendMtfStrategy"`:
    - Uses `backtest.params_effective_json` (or defaults) to recompute:
      - Zero‑lag basis (`zl_basis`),
      - Upper band (`zl_upper`),
      - Lower band (`zl_lower`),
      from the stored OHLCV series:
        - De‑lagged close + EMA.
        - ATR smoothed over `length` and a `highest` over `length*3`, scaled by `mult`.
    - Injects these series into the `indicators` map of `BacktestChartDataResponse`.
- Metrics:
  - Zero Lag runs still flow through the existing metrics pipeline in `BacktestService` (S06), so standard risk metrics (total_return, DD, Sharpe, etc.) are available without additional work.

### G04 – UI integration highlights

- Strategy Library:
  - Because `seed_preset_strategies` now creates `ZLAG_MTF` with `engine_code="ZeroLagTrendMtfStrategy"`, the new strategy appears automatically in the Strategies page:
    - Listed under the engine filter for `ZeroLagTrendMtfStrategy`.
    - Can be used as a base for new business strategies (aliases with different params/labels) without further UI changes.
- Backtests page:
  - Run Backtest:
    - Once a Zero Lag–backed strategy (e.g. `ZLAG_MTF`) is chosen in **Strategy**, it behaves like any other engine:
      - The default parameters from the strategy’s `default` label are used, and you can override via JSON if needed.
  - Backtest Details chart:
    - Updated `BacktestDetailChart` (`frontend/src/features/backtests/components/BacktestDetailChart.tsx`) to accept an `indicators` map.
    - Zero Lag overlays:
      - When `indicators` includes `zl_basis`, `zl_upper`, `zl_lower`:
        - Renders the basis line and bands on the price chart using `lightweight-charts` line series:
          - Basis: teal line (`#80cbc4`).
          - Upper band: semi‑transparent red.
          - Lower band: semi‑transparent green/teal.
      - `BacktestsPage` passes `chart.indicators` from `/api/backtests/{id}/chart-data` into `<BacktestDetailChart />`, so Zero Lag runs show their band while other strategies simply ignore these series.
    - Trade markers and usability:
      - Price pane now renders long/short entry/exit markers for all engines:
        - Entries: green arrows for longs, red for shorts.
        - Exits: opposite colours so exits stand out from entries.
      - Equity pane is vertically enlarged and a **fullscreen chart** dialog is available from Backtest Details, making dense trade sequences (like Zero Lag and SMA crossovers on intraday data) easier to inspect.
    - Chart theming:
      - Introduced per‑backtest visual config `chartTheme` (`dark`, `light`, `highContrast`) stored in `Backtest.visual_config_json`.
      - `BacktestsPage` wiring:
        - Settings → Visualization tab exposes a “Chart theme” selector.
        - Selected theme is persisted back via `/api/backtests/{id}/settings`.
      - `BacktestDetailChart` reads the theme and applies a full colour palette (background, grid, text, candle up/down colours, volume histogram) so the Zero Lag band + trade markers remain readable across themes.

Sprint workbook updates for S09/G03–G04:

- `docs/qlab_sprint_tasks_codex.xlsx` now marks:
  - `S09_G03_TB001` – ZLAG_MTF strategy seeded in meta DB with ZeroLagTrendMtfStrategy and default params.
  - `S09_G03_TB002` – Chart‑data endpoint emits `zl_basis`, `zl_upper`, `zl_lower` for Zero Lag runs.
  - `S09_G03_TB003` – Zero Lag runs use existing metrics pipeline; additional strategy‑specific metrics can be layered later if desired.
  - `S09_G04_TF001` – Strategy Library surfaces Zero Lag strategies via normal engine filter/metadata.
  - `S09_G04_TF002` – Run Backtest form supports Zero Lag strategies via Strategy.engine_code without special handling.
  - `S09_G04_TF003` – Backtest Detail chart renders Zero Lag basis/bands using the new indicator series when present.
  - `S09_G04_TF004` – Backtest Detail chart renders trade markers, supports fullscreen mode, and honours per‑backtest chart theme preferences.
  All S09 tasks (G01–G04) are now `implemented` at the backend/API + UI level.

---

## Sprint S11 – Data Manager & OHLCV Cache (G01–G03)

**Group:** G01 – Data Manager & OHLCV cache: PRD and design
**Tasks:** S11_G01_TB001
**Status (Codex):** implemented

### S11_G01_TB001 – Data cache PRD and configuration

- Captured the design for a persistent OHLCV cache and central Data Manager in `docs/qlab_data_cache_prd.md`.
- Introduced new backend configuration settings in `backend/app/config.py`:
  - `base_timeframe: str | None` – preferred intraday timeframe for caching (e.g. `"1h"`).
  - `base_horizon_days: int` – default 1095 (~3 years) horizon for cached history.
- Documented how backtests should always use the local prices DB, with external providers only used to fill gaps, and how the Data page’s role shifts toward cache inspection and pre‑warming.

**Group:** G02 – Data Manager & OHLCV cache: backend implementation
**Tasks:** S11_G02_TB001–TB003
**Status (Codex):** implemented

### S11_G02_TB001 – DataManager helper implementation

- Added `backend/app/data_manager.py` with a `DataManager` service responsible for ensuring local OHLCV coverage:
  - `ensure_symbol_coverage(prices_db, symbol, timeframe, start, end, source)`:
    - Returns early when `start >= end`.
    - Treats `source` case‑insensitively and only attempts external fetches for recognised providers (`kite`, `yfinance`); other labels (e.g. `synthetic`, `cache_only`) make it a no‑op.
    - Chooses a fetch timeframe based on settings:
      - If `Settings.base_timeframe` is configured and is a finer interval that divides evenly into the requested timeframe, it uses the base timeframe for caching.
      - Otherwise it fetches the requested timeframe directly.
    - Checks existing coverage in `price_bars` for `(symbol, fetch_timeframe)` via `min(timestamp), max(timestamp)` and skips provider calls when the stored window already fully contains `[start, end]`.
    - When coverage is insufficient, delegates to `DataService.fetch_and_store_bars`, which handles provider‑specific chunking (e.g. Kite’s max days per interval) and persisting into `price_bars` / `price_fetches`.

### S11_G02_TB002 – Wiring DataManager into BacktestService

- Updated `BacktestService` in `backend/app/backtest_service.py` to depend on `DataManager`:
  - The service constructor now accepts an optional `data_manager` but defaults to a concrete `DataManager()` instance.
  - `run_single_backtest` calls `ensure_symbol_coverage` before loading price data via `_load_price_dataframe`, so single‑symbol backtests always run against locally cached bars.
  - `run_group_backtest` loops over resolved group symbols and calls `ensure_symbol_coverage` per symbol before building per‑symbol DataFrames for the portfolio simulator.
- As a result, backtests no longer call Kite or yfinance directly; all external data access flows through `DataService` via the Data Manager.

### S11_G02_TB003 – Regression coverage for cache‑backed backtests

- Extended backend tests so that backtests can run without prior manual Fetch Data calls:
  - `backend/tests/test_backtests_api.py` now posts a backtest with `price_source="synthetic"` and verifies that:
    - A backtest record is created with metrics, equity curve, and chart‑data available via `/api/backtests/{id}/chart-data`.
    - Trades export continues to work via `/trades/export`.
  - `backend/tests/test_data_fetch_api.py` and related tests exercise `/api/data/fetch` and `/api/data/summary` using synthetic providers.
- Because `DataManager` treats non‑Kite/yfinance sources as cache‑only, these tests continue to run fully offline while still going through the same code paths as live backtests.

**Group:** G03 – Data Manager & OHLCV cache: Data page integration
**Tasks:** S11_G03_TF001–TF002
**Status (Codex):** implemented

### S11_G03_TF001 – Data page cache mode switch

- Updated `frontend/src/pages/DataPage.tsx` to distinguish between casual preview and cache‑oriented fetches:
  - Added a single checkbox, **“Save for backtesting (cache mode)”**, above the Fetch form.
  - When cache mode is enabled:
    - For daily (`1d`) selections, the effective fetch timeframe is adjusted to a cache‑friendly intraday base (currently `1h`) before calling `/api/data/fetch`.
    - When the user selects a one‑day window, the effective fetch range is expanded to roughly the configured base horizon (e.g. ~3 years ending today), so repeated cache runs naturally maintain a rolling window for backtests.
  - When cache mode is disabled, the Data page behaves like a preview tool and uses the user‑selected timeframe/dates without horizon expansion.

### S11_G03_TF002 – Coverage Summary BT‑ready indicators

- Extended the Coverage Summary table on the Data page to expose cache health:
  - Added a `Days` column that shows the approximate span between `start` and `end` for each coverage row.
  - Added a **“BT‑ready (3Y)”** column computed on the frontend using `created_at`, `start`, `end`, and a 3‑year horizon derived from today’s date:
    - A row is marked “Yes” when its coverage fully contains the 3‑year window ending today.
    - Otherwise the column is left blank, signalling that additional cache fills may be required for long‑horizon backtests.
- These indicators are purely informational; backtests rely on `DataManager.ensure_symbol_coverage` to guarantee coverage at runtime, but the UI now gives a quick visual sense of which symbols are effectively “pre‑warmed” for BT.

In addition, the Backtests UI now exposes a **Data source mode** select (Auto vs Cache only) whose value is passed as `price_source` to the backend; the Data Manager interprets this so that:
- `Auto (local cache + Kite)` allows external fetches when coverage is missing.
- `Cache only` forces backtests to rely solely on existing local OHLCV data, making it easy to test purely‑cache scenarios without hitting external APIs.

---

## Sprint S12 – Capital‑Aware Signal Routing (G01–G04)

**Group:** G01 – Capital‑aware signal routing: scoring model and PRD alignment
**Tasks:** S12_G01_TB001–TB002
**Status (Codex):** implemented

### S12_G01_TB001/TB002 – Scoring model and score_candidate helper

- Finalised the capital‑aware routing design in `docs/capital_aware_signal_routing_prd.md`, adding an implementation‑focused section that documents the v1 scoring model, allocation rules, diagnostics, and interaction with group benchmarks.
- Implemented a concrete scoring helper inside `BacktestService._run_portfolio_simulator` (`backend/app/backtest_service.py`):
  - Precomputes per‑symbol features from OHLCV:
    - 20‑bar percentage momentum (`mom20`),
    - 14‑bar ATR as a fraction of price (`atr_pct`),
    - relative volume vs 20‑bar average (`vol_norm`, clamped into `[0.2, 3.0]`).
  - Computes a single float score per candidate trade that:
    - Favours longs with positive momentum and shorts with negative momentum.
    - Upscores liquid names via `vol_norm`.
    - Down‑weights highly volatile symbols via a `1 / (1 + atr_pct * 100)` factor.
  - Uses only current/past data (no look‑ahead) and is wired so it can be replaced or extended in future sprints.

**Group:** G02 – Portfolio simulator: multi‑candidate allocation per bar
**Tasks:** S12_G02_TB001–TB002
**Status (Codex):** implemented

### S12_G02_TB001/TB002 – Multi‑candidate routing under risk constraints

- Refactored `BacktestService._run_portfolio_simulator` so group backtests can fund **multiple entry candidates per bar** instead of “first candidate wins”:
  - Groups candidate trades by `entry_timestamp`.
  - At each bar:
    - Processes exits first (freeing capital).
    - Scores all entry candidates using the new scoring helper.
    - Filters out candidates whose feasible size is zero when passed through `SigmaBaseStrategy._compute_order_size` (respecting current equity, cash, `maxPositionSizePct`, `perTradeRiskPct`, and broker constraints).
    - Sorts remaining candidates by score descending, then deterministically by `(symbol, entry time)`.
    - Iterates this list, recomputing feasible size as equity/cash change, and opens each trade with `size > 0`.
  - There is no explicit cap on new positions per bar in v1; risk settings naturally limit the number of concurrent positions.
- Kept broker semantics aligned with earlier work:
  - `allowShortSelling` is forced off for non‑MIS product types.
  - Intraday vs delivery (MIS vs CNC) continues to be handled by the costs model and strategy engine.
- Verified via synthetic scenarios that cash/equity updates remain consistent when several trades are opened and closed on the same timestamp.

**Group:** G03 – Capital‑aware routing metrics and diagnostics
**Tasks:** S12_G03_TB001–TF001
**Status (Codex):** implemented

### S12_G03_TB001/TF001 – Routing debug and group benchmark curve

- Extended portfolio metrics and chart‑data responses for group runs:
  - `_run_portfolio_simulator` now returns a `routing_debug` structure containing:
    - `total_candidates`, `total_accepted`,
    - a `per_bar` list of `{timestamp, candidates, accepted}` counts.
  - `BacktestService.run_group_backtest` stores `routing_debug` under `Backtest.metrics_json["routing_debug"]` and adds a `per_symbol` breakdown (trades and net PnL per symbol).
- Redesigned the yellow **projection** line in `/api/backtests/{id}/chart-data` (`backend/app/routers/backtests.py`) to be a realistic benchmark rather than an “all trades held forever” curve:
  - For single‑symbol backtests: equal‑weight buy‑and‑hold of that symbol using `initial_capital`.
  - For group backtests: equal‑weight buy‑and‑hold of all symbols with data, with **rebalance** when a new symbol’s data first appears (late entrants cause a pro‑rata reslice across the expanded universe).
  - Implemented using the same `_load_price_dataframe` helper as the engine so timeframe aggregation and price sourcing are consistent.
- Updated the Backtests UI (`frontend/src/pages/BacktestsPage.tsx` and `frontend/src/features/backtests/components/BacktestDetailChart.tsx`) to:
  - Keep the blue curve as realised equity from routed trades and the yellow curve as a **group benchmark** line.
  - Show a concise **Capital‑aware routing debug** panel for group runs with totals and a truncated per‑bar table.
  - Add a short legend explaining that the router prefers higher‑scored, more liquid, less volatile names when capital is tight.

**Group:** G04 – Group BT validation: trade correctness harness
**Tasks:** S12_G04_TB001–TB002
**Status (Codex):** implemented

### S12_G04_TB001/TB002 – Group routing test harness

- Added `backend/tests/test_group_backtests_routing.py` with focused tests for the new simulator and costs model:
  - `test_portfolio_simulator_respects_max_position_and_short_flag`:
    - Builds synthetic price data for two symbols and two opposing candidates on the same bar.
    - Asserts that `_run_portfolio_simulator` honours `maxPositionSizePct` and `allowShortSelling` (short trades are skipped when disallowed, and long size is clamped to the appropriate notional).
    - Verifies that routing diagnostics report the correct candidate vs accepted counts.
  - `test_costs_model_sets_mis_vs_cnc_order_types`:
    - Confirms `_apply_costs_indian_equity` correctly tags intraday trades as MIS and multi‑day trades as CNC under the Zerodha costs model.
- These tests provide a regression harness for capital‑aware routing and MIS/CNC classification, and will be extended as the scoring model and portfolio logic evolve.
