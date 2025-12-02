# 16. Unified Ingestion Design – Prices, Fundamentals, Factors & Risk

This document defines a unified ingestion and ETL design for SigmaQLab, with a focus on:

- Using **screener.in fundamentals CSV** as the primary fundamentals source for the Indian equity universe.
- Supporting multiple **price data providers** (Kite, yfinance, CSV).
- Providing a clear **ETL pipeline** from raw inputs → `stocks`, `fundamentals_snapshot`, `price_bars` → `factor_exposures`, `risk_model`, `covariance_matrices`.
- Exposing ingestion in a way that is usable via both **CLI** and **HTTP APIs**, and easy to schedule.

The design builds on the existing services & models in `backend/app`:

- Price ingestion: `DataService`, `PriceBar`, `/api/data/fetch`.
- Fundamentals & factors: `FundamentalsSnapshot`, `FactorExposure`, `FactorService`.
- Risk: `RiskModel`, `CovarianceMatrix`, `RiskModelService`.

---

## 16.1 Goals & Scope

**Goals**

1. Provide a consistent way to ingest **prices** and **fundamentals** for a universe of NSE stocks.
2. Make factor and risk computation **repeatable** and **idempotent** for any `(universe, as_of_date)`.
3. Allow users to plug in new sources (e.g. yfinance fundamentals) without changing downstream services.
4. Ensure the Factor Screener, Optimizer, and Portfolio Backtests can rely on local DBs only.

**Out of scope (for this file)**

- Full production scheduling / monitoring (cron/airflow). The design assumes a simple cron or manual trigger.
- Non‑equity instruments.

---

## 16.2 Data Domains & Target Tables

### 16.2.1 Universe & Metadata

- **Table**: `stocks` (`Stock` model)
- **Key fields**:
  - `symbol` – NSE trading symbol (e.g. `ADANIPORTS`, `HDFCBANK`).
  - `exchange` – `NSE` / `BSE`.
  - `name`, `sector`, `tags`, `is_active`.

Universe membership ultimately comes from:

- Screener‑derived groups (`stock_groups` + `stock_group_members`).
- Direct imports of symbol lists (optional future work).

### 16.2.2 Prices

- **DB**: `sigmaqlab_prices.db`
- **Table**: `price_bars` (`PriceBar`)
- **Key fields**:
  - `symbol`, `exchange`, `timeframe` (`1d`, `1h`, `5m`, …).
  - `timestamp`, `open`, `high`, `low`, `close`, `volume`, `source`.

Sources:

- Zerodha Kite (`source="kite"`).
- yfinance (`source="yfinance"`).
- Local CSV (`source="local_csv"`).

### 16.2.3 Fundamentals

- **DB**: `sigmaqlab_meta.db`
- **Table**: `fundamentals_snapshot` (`FundamentalsSnapshot`)
- **Key fields** (aligned to screener.in columns):
  - `symbol`
  - `as_of_date`
  - `market_cap` (INR crores, or INR scaled consistently)
  - `pe`, `pb`, `ps`
  - `roe`, `roce`
  - `debt_to_equity`
  - `sales_growth_yoy`, `profit_growth_yoy`
  - `eps_growth_3y`
  - `operating_margin`, `net_margin`
  - `interest_coverage`
  - `promoter_holding`, `fii_holding`, `dii_holding`
  - `sector`, `industry`

Primary source:

- **screener.in CSV** exported by the user for a chosen universe and date.
  - For local workflows we standardise on a path under `backend/data/`, e.g.:
    - `backend/data/fundamentals/screener_2025-02-12.csv`
    - `backend/data/fundamentals/latest_screener.csv`
  - The ingestion script can accept either an explicit path or a default
    convention (e.g. “pick the newest CSV in `backend/data/fundamentals/`”).

### 16.2.4 Factors & Risk

- **Factors**
  - Table: `factor_exposures` (`FactorExposure`)
  - Fields: `value`, `quality`, `momentum`, `low_vol`, `size`, `composite_score`.

- **Risk**
  - Table: `risk_model` (`RiskModel`) – vol/beta/etc.
  - Table: `covariance_matrices` (`CovarianceMatrix`) – shrunk covariance & correlation for a universe/date.

These are **derived data** computed by:

- `FactorService.compute_and_store_exposures(...)`
- `RiskModelService.compute_and_store_risk(...)`

---

## 16.3 Screener.in Fundamentals CSV Mapping

Given a sample screener.in CSV (e.g. `/home/cbiswas/Downloads/test.csv`) with headers:

```text
Name,BSE Code,NSE Code,Industry Group,Industry,
Current Price,Market Capitalization,Price to Earning,
Price to book value,Return on equity,Return on capital employed,
Debt to equity,Sales,Sales preceding year,Profit after tax,
Profit after tax preceding year,EPS growth 3Years,OPM,
NPM last year,Interest Coverage Ratio,Promoter holding,
FII holding,DII holding,Return over 1year,Return over 3years,
Return over 5years
```

We map each row to a `FundamentalsSnapshot` as follows:

- **Symbol & metadata**
  - `symbol` ← `NSE Code` (upper‑cased, e.g. `ADANIPORTS`).
  - `as_of_date` ← ingestion run date or a column if screener.in adds it.
  - `sector` ← `Industry Group` (or a curated mapping).
  - `industry` ← `Industry`.

- **Valuation & size**
  - `market_cap` ← `Market Capitalization` (stored as float).
  - `pe` ← `Price to Earning`.
  - `pb` ← `Price to book value`.
  - `ps` ← `Sales` / `Market Capitalization` * optional scaling, or left `NULL` if not obvious.

- **Quality & profitability**
  - `roe` ← `Return on equity`.
  - `roce` ← `Return on capital employed`.
  - `operating_margin` ← `OPM`.
  - `net_margin` ← `NPM last year`.
  - `interest_coverage` ← `Interest Coverage Ratio`.

- **Growth**
  - `sales_growth_yoy` ← ( `Sales` − `Sales preceding year` ) / `Sales preceding year`.
  - `profit_growth_yoy` ← ( `Profit after tax` − `Profit after tax preceding year` )
    / `Profit after tax preceding year`.
  - `eps_growth_3y` ← `EPS growth 3Years`.

- **Leverage & ownership**
  - `debt_to_equity` ← `Debt to equity`.
  - `promoter_holding` ← `Promoter holding`.
  - `fii_holding` ← `FII holding`.
  - `dii_holding` ← `DII holding`.

All missing or non‑numeric values are stored as `NULL`. The ETL should upsert per `(symbol, as_of_date)`.

---

## 16.4 Unified Ingestion Components

### 16.4.1 PriceIngestionService (existing)

- **Implementation**: `DataService` in `backend/app/services.py`.
- **Entry point**: `POST /api/data/fetch`.
- **Responsibilities**:
  - Accept `DataFetchRequest` (single symbol, group, or universe).
  - Dispatch to provider (`csv`, `kite`, `yfinance`).
  - Clean old bars in the same window, insert new rows into `PriceBar`.
  - Record fetch metadata in `PriceFetch`.

This component is already in place and will be reused as‑is.

### 16.4.2 FundamentalsIngestionService (new)

**Responsibilities**

- Take a fundamentals source (initially: **screener.in CSV**).
- Map incoming rows to `FundamentalsSnapshot` schema.
- Ensure matching `Stock` rows exist for each symbol.
- Upsert snapshots for `(symbol, as_of_date)` so repeated runs update
  existing rows and insert new symbols without duplication.

**Proposed interface**

- Service: `FundamentalsIngestionService` in `backend/app/services_fundamentals.py` (new).
- Methods:

```python
class FundamentalsIngestionService:
    def ingest_screener_csv(
        self,
        meta_db: Session,
        *,
        csv_path: str,
        as_of_date: date,
        exchange: str = "NSE",
    ) -> int:
        """Parse screener.in CSV and upsert FundamentalsSnapshot rows.

        Returns number of symbols ingested.
        """
```

The ingestion flow must be usable in two ways:

1. **Manual script** (recommended for the initial setup and daily runs)

   - Location: e.g. `backend/scripts/ingest_screener_fundamentals.py`.
   - Behaviour:
     - Look for a CSV under `backend/data/fundamentals/` (or accept
       `--csv-path` explicitly).
     - Use the file’s intended `as_of_date` (CLI arg) to upsert all rows.
     - If the same file is ingested again, existing `(symbol, as_of_date)`
       rows are updated, new symbols are added.
     - If no CSV is found or nothing has changed, the script can exit
       gracefully; downstream factor/risk rebuilds can still proceed using
       previously stored fundamentals.

2. **API endpoint** for ad‑hoc ingestion

- `POST /api/v1/fundamentals/import` with payload:

```json
{
  "source": "screener_csv",
  "csv_path": "/home/cbiswas/Downloads/test.csv",
  "as_of_date": "2025-02-12"
}
```

(For local dev, `csv_path` is acceptable; a file‑upload based variant can be added later.)

### 16.4.3 Factor/RiskRebuildService (orchestration)

Rather than sprinkling factor/risk computation across routers, we introduce a tiny orchestration layer.

**Responsibilities**

- Given `(universe, as_of_date)`:
  - Resolve the symbol list (via `Stock` / `StockGroup` / `universe=NSE_ALL`).
  - Verify fundamentals exist in `FundamentalsSnapshot` for those symbols/date.
  - Verify price coverage exists for the lookback window in `PriceBar`.
  - Call:
    - `FactorService.compute_and_store_exposures(...)`
    - `RiskModelService.compute_and_store_risk(...)`

**Proposed interface**

```python
class FactorRiskRebuildService:
    def rebuild_for_universe(
        self,
        meta_db: Session,
        prices_db: Session,
        *,
        universe: str,        # e.g. "NSE_ALL" or "group:123"
        as_of_date: date,
        timeframe: str = "1d",
    ) -> dict:
        """Compute and persist factors + risk for the universe/date.

        Returns simple diagnostics (symbol counts, missing data, etc.).
        """
```

- API: `POST /api/v1/factors/rebuild`:

```json
{
  "universe": "NSE_ALL",
  "as_of_date": "2025-02-12",
  "timeframe": "1d"
}
```

This endpoint would be used manually (or by a cron job) after fundamentals ingestion.

---

## 16.5 End‑to‑End Daily Pipeline

For a given trading date `D` (e.g. `2025-02-12`), the unified ingestion flow is:

1. **Update universes (optional)**
   - Use Screener UI + “Save as Group” to maintain `StockGroup` definitions.
   - Ensure `stocks` table contains all NSE symbols of interest.

2. **Ingest/update prices**
   - For each symbol / group / universe, call:
     - `POST /api/data/fetch` with:
       - `source = "kite" | "yfinance" | "csv"`.
       - `target = "group"` for a screener‑generated group, or `target = "universe"` for all active stocks.

3. **Ingest fundamentals from screener.in CSV**

- Export screener.in CSV for your universe whenever new financials are
  available (typically quarterly or when you decide to refresh).
- Copy it into `backend/data/fundamentals/` (or update an existing file).
- Either:
  - Run the manual script

```bash
cd backend
python scripts/ingest_screener_fundamentals.py \
  --csv-path data/fundamentals/screener_2025-02-12.csv \
  --as-of-date 2025-02-12
```

  - or call the API:

```json
POST /api/v1/fundamentals/import
{
  "source": "screener_csv",
  "csv_path": "/home/cbiswas/Downloads/test.csv",
  "as_of_date": "2025-02-12"
}
```

   - This writes `FundamentalsSnapshot` rows for `(symbol, D)` and ensures `stocks` entries exist.

4. **Rebuild factors & risk**
   - Call:

```json
POST /api/v1/factors/rebuild
{
  "universe": "NSE_ALL",
  "as_of_date": "2025-02-12",
  "timeframe": "1d"
}
```

   - `FactorRiskRebuildService`:
     - Resolves `symbols` for `NSE_ALL` (all active `Stock` entries).
     - Calls `FactorService` and `RiskModelService`.
     - Populates `factor_exposures`, `risk_model`, `covariance_matrices`.

5. **Downstream consumption**

- **Factor Screener**
  - Uses `FundamentalsSnapshot` and `FactorExposure` for `as_of_date = D`.
- **OptimizerService**
  - Reuses `factor_exposures`, `risk_model`, `covariance_matrices` computed above.
- **Portfolio backtests**
  - Use price bars in `PriceBar`, risk/factor data for optimisation at rebalance dates.

---

## 16.6 Idempotency & Error Handling

**Idempotency rules**

- `PriceIngestionService`:
  - Deletes existing bars in `[start, end]` for `(symbol, timeframe)` before inserting new ones.
- `FundamentalsIngestionService`:
  - Upserts `(symbol, as_of_date)` rows in `fundamentals_snapshot`.
- `FactorService` & `RiskModelService`:
  - Already delete/replace existing rows for `(symbols, as_of_date)` before inserting new ones.

**Error handling**

- Missing fundamentals:
  - `rebuild_for_universe` should report which symbols are missing fundamentals for `as_of_date`; they can be skipped or included with factor values `NULL`.
- Missing prices:
  - If a symbol lacks sufficient price history, it is excluded from factor/risk computation; diagnostics should list such symbols.
- CSV parsing issues:
  - `FundamentalsIngestionService` should log row‑level errors (bad numbers, missing NSE Code) and continue with others.

---

## 16.7 Extensibility

The design allows adding new sources with minimal changes:

- **New price providers** (e.g. official NSE API):
  - Implement a new branch in `DataService.fetch_and_store_bars`.
- **New fundamentals providers** (e.g. yfinance):
  - Implement `ingest_yfinance_fundamentals(...)` in `FundamentalsIngestionService`.
  - Add a `source` mode to `/api/v1/fundamentals/import`.

The rest of the system (Screener, Optimizer, PortfolioService) remains unchanged as long as the core tables are populated.

---

## 16.8 Summary

- Screener.in CSV becomes the **authoritative fundamentals source** for NSE equities, ingested into `fundamentals_snapshot`.
- Existing price ingestion via `DataService` is reused and treated as the canonical OHLCV pipeline.
- A new orchestration service ensures that, for any `(universe, as_of_date)`, factor and risk data are recomputed in a single, repeatable step.
- With this unified design, the user’s workflow is:
  1. Ingest/update prices.
  2. Ingest fundamentals CSV.
  3. Rebuild factors & risk.
  4. Use Screener, Optimizer, and Portfolio backtests on a fully consistent local dataset.
