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

## Data service and external providers

SigmaQLab’s backend can fetch and persist OHLCV data into a dedicated prices database (`sigmaqlab_prices.db`) using Zerodha Kite, yfinance, or local CSV files.

### Configuration (`.env`)

The backend reads configuration via environment variables defined in `backend/.env`:

- Core paths:
  - `SIGMAQLAB_META_DB_PATH=./sigmaqlab_meta.db`
  - `SIGMAQLAB_PRICES_DB_PATH=./sigmaqlab_prices.db`
- Zerodha Kite (optional, for live data):
  - `SIGMAQLAB_KITE_API_KEY=...`
  - `SIGMAQLAB_KITE_API_SECRET=...` (used only by your own token-generation utility)
  - `SIGMAQLAB_KITE_ACCESS_TOKEN=...` (daily access token obtained via your preferred script/utility)

SigmaQLab itself requires only a valid `api_key` + `access_token` at runtime; how you obtain/refresh the access token (e.g. your existing standalone utility, or a small Python snippet using `kite.generate_session`) is left to you.

### Data fetch API

Once the backend is running, you can populate the prices DB via:

- `POST /api/data/fetch`

Example JSON payload for CSV ingest:

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

Supported `source` values:

- `"csv"` – local CSV, single symbol/timeframe, columns: `timestamp,open,high,low,close,volume`.
- `"yfinance"` – yfinance download for the given symbol/timeframe/date range.
- `"kite"` – Zerodha Kite historical data (requires valid Kite credentials and access token).

### Live provider tests (optional)

There are opt-in integration tests that hit yfinance and Kite for HDFCBANK:

```bash
cd backend
export SIGMAQLAB_RUN_LIVE_DATA_TESTS=1
pytest tests/test_live_providers_hdfcbank.py -vv
```

- Tests are marked `@pytest.mark.integration` and:
  - Will be skipped if the env flag is not set.
  - Will be skipped if Kite credentials or access token are missing/invalid.
