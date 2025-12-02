# 16. Unified Ingestion Design (v2)

## 16.1 Purpose & Scope

This document defines the **unified ingestion pipeline** for SigmaQLab, focusing on:

1. Ingesting **Screener.in CSV fundamentals** for the stock **universe** and **fundamentals_snapshot**.
2. Integrating these fundamentals with existing **OHLCV** (from Zerodha/Kite) to support:
   - FactorService (Value, Quality, Momentum, Low-Vol, Size)
   - RiskModelService (volatility, beta, covariance)
   - Factor Screener
   - Portfolio Optimization & Backtesting

This is **v2** of the ingestion design and includes:

- Snapshot lineage tracking
- Consolidated vs standalone reporting flag
- Symbol resolution layer
- Minimal but robust validation
- Smooth CLI/UI flow for users


---

## 16.2 Data Sources

### 16.2.1 Primary Fundamentals Source: Screener.in CSV

User exports a CSV from Screener.in with columns similar to:

- Identity / classification
  - `Name`
  - `BSE Code`
  - `NSE Code`
  - `Industry Group` (sector)
  - `Industry` (industry)
- Market & valuation
  - `Current Price`
  - `Market Capitalization`
  - `Price to Earning`
  - `Price to book value`
- Profitability & leverage
  - `Return on equity`
  - `Return on capital employed`
  - `Debt to equity`
- Growth
  - `Sales`
  - `Sales preceding year`
  - `Profit after tax`
  - `Profit after tax preceding year`
  - `EPS growth 3Years`
- Margins & quality
  - `OPM` (Operating profit margin)
  - `NPM last year` (Net profit margin)
  - `Interest Coverage Ratio`
- Ownership
  - `Promoter holding`
  - `FII holding`
  - `DII holding`
- Optional price-based extras
  - `Return over 1year`
  - `Return over 3years`
  - `Return over 5years`

**Key point:** One row per symbol per fundamentals snapshot.

### 16.2.2 Price Data (Existing)

- **Zerodha / Kite OHLCV** for:
  - Daily prices
  - Intraday (for trading/backtest)
- Optional: yfinance or TradingView for additional OHLCV if needed (not core to v2).

These are already wired into the codebase via `DataManager` and related components.


---

## 16.3 Target Data Models

### 16.3.1 Stock / Universe (Existing)

We use the existing `Stock` (or equivalent) model for the **universe**:

- `id`
- `symbol` (canonical trading symbol, e.g., `TCS`)
- `name`
- `nse_code` (optional, could be same as symbol)
- `bse_code` (optional)
- `sector`
- `industry`
- `is_active`
- `created_at`
- `updated_at`

Universe is:

- The set of all `Stock` rows flagged as **active** for SigmaQLab.
- Used by Screener, Backtests, Portfolios, etc.

### 16.3.2 FundamentalsSnapshot (Core Table)

`FundamentalsSnapshot` is the table described in earlier PRD sections and now refined:

- `id` (PK)
- `symbol` (FK → `Stock.symbol`)
- `as_of_date` (date)
- `run_id` (FK → `FundamentalsSnapshotRun.run_id`)
- `report_type` (enum: `"consolidated"` | `"standalone"` | `"unknown"`)
- `market_cap` (float, in INR crores as per Screener)
- `pe` (float)
- `pb` (float)
- `ps` (float, nullable; optional v2 field)
- `roe` (float)
- `roce` (float)
- `debt_to_equity` (float)
- `sales` (float, INR crores)
- `sales_prev_year` (float, INR crores)
- `profit_after_tax` (float, INR crores)
- `profit_after_tax_prev_year` (float, INR crores)
- `sales_growth_yoy` (float, computed)
- `profit_growth_yoy` (float, computed)
- `eps_growth_3y` (float)
- `operating_margin` (float, OPM)
- `net_margin` (float, NPM)
- `interest_coverage` (float)
- `promoter_holding` (float, %)
- `fii_holding` (float, %)
- `dii_holding` (float, %)
- `sector` (string; aligned with Stock sector)
- `industry` (string)
- `fundamentals_unit` (string; e.g. `"INR_CR"`)
- `created_at` (timestamp)

Indexes:

- `IX_fundamentals_snapshot_symbol_date` on `(symbol, as_of_date)`
- `IX_fundamentals_snapshot_date` on `(as_of_date)`

### 16.3.3 FundamentalsSnapshotRun (New Lineage Table)

To track each ingestion batch:

- `run_id` (PK, UUID or integer)
- `as_of_date` (date)
- `source` (string; e.g., `"screener_csv"`)
- `csv_filename` (string)
- `report_type` (`"consolidated"` | `"standalone"` | `"unknown"`)
- `ingested_symbol_count` (int)
- `ingested_at` (timestamp)
- `notes` (string, nullable)

This allows:

- Multiple runs on same `as_of_date`
- Clear lineage (which run produced which snapshots)
- Rollback, comparison, debugging

### 16.3.4 Other Tables (Reference Only)

- `FactorExposure` (filled later by FactorService)
- `RiskModel`, `CovarianceMatrix` (filled by RiskModelService)

Ingestion v2 focuses on populating `Stock` and `FundamentalsSnapshot` (+ `FundamentalsSnapshotRun`).


---

## 16.4 Screener CSV Contract for v2

The Screener CSV **does not have to match the DB schema 1:1**.
We define a **mapping layer**:

**Required columns from Screener:**

- `NSE Code`                      → `symbol`
- `Industry Group`                → `sector`
- `Industry`                      → `industry`
- `Market Capitalization`         → `market_cap`
- `Price to Earning`              → `pe`
- `Price to book value`           → `pb`
- `Return on equity`              → `roe`
- `Return on capital employed`    → `roce`
- `Debt to equity`                → `debt_to_equity`
- `Sales`                         → `sales`
- `Sales preceding year`          → `sales_prev_year`
- `Profit after tax`              → `profit_after_tax`
- `Profit after tax preceding year` → `profit_after_tax_prev_year`
- `EPS growth 3Years`             → `eps_growth_3y`
- `OPM`                           → `operating_margin`
- `NPM last year`                 → `net_margin`
- `Interest Coverage Ratio`       → `interest_coverage`
- `Promoter holding`              → `promoter_holding`
- `FII holding`                   → `fii_holding`
- `DII holding`                   → `dii_holding`

**Derived during ingestion:**

- `as_of_date` – provided by user (CLI or UI)
- `sales_growth_yoy` – computed as:
  - `(sales - sales_prev_year) / sales_prev_year * 100`
- `profit_growth_yoy` – computed as:
  - `(profit_after_tax - profit_after_tax_prev_year) / profit_after_tax_prev_year * 100`
- `ps` (optional) – computed if sales > 0 and you have effective price or revenue; otherwise left null.
- `fundamentals_unit` – `"INR_CR"` (hard-coded v2)
- `report_type` – `"consolidated"` by default, or selectable in UI/CLI.


---

## 16.5 Unified Ingestion Pipeline Overview

At a high level, ingestion consists of these stages:

1. **CSV Ingestion Setup**
   - User exports Screener CSV.
   - User provides:
     - `as_of_date`
     - `report_type` (optional; default consolidated)
   - System records a new `FundamentalsSnapshotRun`.

2. **Universe / Stock Ingestion (from Screener CSV)**
   - Resolve each `NSE Code` → canonical `symbol`.
   - Upsert `Stock` rows (name, sector, industry, active flag).

3. **FundamentalsSnapshot Ingestion**
   - Map CSV columns → `FundamentalsSnapshot` fields.
   - Compute derived metrics (YoY growth, etc.).
   - Upsert or insert snapshots tagged with `run_id`.

4. **Validation & Diagnostics**
   - Sanity checks (division by zero, missing values).
   - Count symbols ingested, skipped, updated.
   - Emit warnings.

5. **Price Coverage Check**
   - For the final **eligible universe** (symbols with fundamentals), check that OHLCV is available for the required lookback window.
   - Produce a coverage report.

6. **Downstream Trigger (Optional)**
   - Optionally trigger `FactorService` and `RiskModelService` to compute factor and risk exposures after ingestion completes.


---

## 16.6 Detailed Flows

### 16.6.1 Universe Import from Screener CSV

**Goal:** Use Screener CSV to update the **universe** (`Stock` table).

**Steps:**

1. For each CSV row:
   - Extract `NSE Code`, `Name`, `Industry Group`, `Industry`.

2. Use `SymbolResolverService` (see 16.7) to:
   - Normalize `NSE Code` → internal `symbol` (e.g. `TCS`, not `TCS.NS`).
   - Validate with Zerodha if needed (optional; v2 can skip live broker validation).

3. Upsert into `Stock`:
   - If `symbol` exists:
     - Update `name`, `sector`, `industry`.
   - Else:
     - Create new `Stock` row with `is_active = true`.

4. At the end:
   - Produce a summary:
     - `new_stocks_created`
     - `stocks_updated`
     - `symbols_skipped` (invalid / missing NSE Code etc.).

**Notes:**

- The Universe import uses only a subset of CSV columns.
- It should be **idempotent** w.r.t. symbol identity:
  - Running it again with same CSV should not create duplicates.


### 16.6.2 FundamentalsSnapshot Ingestion from Screener CSV

**Goal:** Populate `FundamentalsSnapshot` for each symbol and `as_of_date`.

**Steps:**

1. Create a new `FundamentalsSnapshotRun` row:
   - `as_of_date`
   - `source = "screener_csv"`
   - `csv_filename`
   - `report_type` (UI/CLI parameter)
   - `ingested_at = now()`

2. For each CSV row:
   - Resolve symbol (via `NSE Code` + SymbolResolverService).
   - Skip row if symbol is missing or invalid (track in diagnostics).
   - Map fields according to section 16.3.2.
   - Compute:

     ```text
     sales_growth_yoy =
       if sales_prev_year > 0 then
         (sales - sales_prev_year) / sales_prev_year * 100
       else null

     profit_growth_yoy =
       if profit_after_tax_prev_year > 0 then
         (profit_after_tax - profit_after_tax_prev_year) / profit_after_tax_prev_year * 100
       else null
     ```

   - Set `fundamentals_unit = "INR_CR"`.

3. Upsert logic for `FundamentalsSnapshot`:
   - If a row already exists for `(symbol, as_of_date)`:
     - Option A (safer): overwrite (update all fields).
     - Option B: only overwrite if `run_id` is the same (to avoid conflicting runs).
   - Else:
     - Insert new row with `run_id` referencing this ingestion run.

4. At the end:
   - Update `FundamentalsSnapshotRun.ingested_symbol_count`.
   - Store counts of:
     - `symbols_processed`
     - `symbols_failed` (with reason)
     - `symbols_skipped` (no fundamentals, invalid values)

5. Validation:
   - Check that at least **N** symbols were successfully ingested (configurable threshold).
   - Warn if `sales_prev_year <= 0` or `profit_after_tax_prev_year <= 0` for large number of symbols.


### 16.6.3 Price & Returns Integration (Existing + Minor Design Notes)

The ingestion design assumes:

- OHLCV data pipeline is already in place (Zerodha).
- After fundamentals ingestion:
  - `FactorService` looks up price history for each symbol from DataManager.
  - `RiskModelService` looks up returns to compute vol, beta, covariance.

In v2 design:

- **After a successful fundamentals run**, the system may optionally trigger:
  - `FactorService.compute_and_persist_exposures(symbols, as_of_date)`
  - `RiskModelService.compute_and_persist_risk(symbols, as_of_date)`

These are **not required** within ingestion itself but are closely coupled via `as_of_date` and symbol universe.


---

## 16.7 Symbol Resolution Layer

### 16.7.1 Purpose

Different sources use different symbol formats:

- Screener: `TCS` / `HDFCBANK`
- Zerodha: sometimes same, sometimes slightly different
- yfinance: `TCS.NS`
- TradingView: `NSE:TCS`

The `SymbolResolverService` bridges these differences and ensures that ingestion always uses a single **canonical symbol**.

### 16.7.2 Responsibilities

- Map `NSE Code` from Screener to the internal canonical `Stock.symbol`.
- Optionally validate that the symbol is tradable (via Zerodha if configured).
- Maintain a small mapping table if needed:
  - `SymbolAlias`:
    - `alias` (string from source)
    - `symbol` (canonical)
    - `source` (`"screener"`, `"yfinance"`, `"tv"`)

In v2, this can be implemented as a simple in-memory/DB mapping, with a fallback that `symbol = nse_code` if we do not have a more complex mapping yet.


---

## 16.8 Validation & Diagnostics

### 16.8.1 Fundamentals Validation

During ingestion:

- **Field-level checks**
  - `market_cap >= 0`
  - `debt_to_equity >= 0` (or null if missing)
  - `promoter_holding` between 0 and 100
  - `fii_holding` between 0 and 100
  - `dii_holding` between 0 and 100
  - `interest_coverage >= 0` (or null)

- **Derived metric checks**
  - If `sales_prev_year == 0` → set `sales_growth_yoy = null` and log warning.
  - If `profit_after_tax_prev_year == 0` → set `profit_growth_yoy = null` and log warning.

### 16.8.2 Price Coverage Validation

After fundamentals ingestion, optionally:

- For the set of symbols with fundamentals at `as_of_date`:
  - Check OHLCV availability for required lookback window (e.g., 252 days).
  - Produce a `PriceCoverageReport`:
    - `symbols_with_full_coverage`
    - `symbols_with_partial_coverage`
    - `symbols_missing_coverage`

This report can be surfaced in UI or logs.

### 16.8.3 Run Summary

At the end of ingestion, create a structured summary:

- `run_id`
- `as_of_date`
- `total_rows_csv`
- `symbols_success`
- `symbols_failed` (with top N error reasons)
- `symbols_skipped`
- Optional: top 10 symbols by market cap that were successfully ingested.

This summary can be:

- Stored in DB (`FundamentalsSnapshotRun.notes` as JSON)
- Exposed via an admin API
- Logged for debugging.


---

## 16.9 Versioning, Idempotency & Re-Runs

### 16.9.1 CSV Format Version

Add a small field or config key:

- `csv_format_version = 1`

If Screener changes column names or structure, you can:

- Add new parsers for `version 2`
- Maintain backward compatibility

### 16.9.2 Idempotency

- Re-running ingestion for the **same CSV + same `as_of_date`** should not produce duplicate rows.
- The logic should:
  - Reuse or overwrite existing `(symbol, as_of_date, run_id)` rows in `FundamentalsSnapshot`.
  - Not create duplicate `Stock` entries.

### 16.9.3 Re-Runs with Different CSVs for Same Date

If user imports a new Screener CSV for the same `as_of_date`:

- Option A: Create a **new** `FundamentalsSnapshotRun` and:
  - Overwrite affected `FundamentalsSnapshot` rows (by `(symbol, as_of_date)`).
- Option B: Require user to pass `--overwrite` flag explicitly.

This should be defined clearly in CLI help and logs.


---

## 16.10 CLI & API Surfaces

### 16.10.1 CLI Example

Two main commands:

1. **Ingest fundamentals from Screener CSV**

```bash
python -m sigmaqlab.ingest_fundamentals \
  --csv-path data/screener_export_2025-02-12.csv \
  --as-of-date 2025-02-12 \
  --report-type consolidated \
  --dry-run false
