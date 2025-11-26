# SigmaQLab – Persistent OHLCV Cache & Data Manager PRD

## 1. Motivation & Goals

Backtests currently depend on ad‑hoc “Fetch Data” (FT) operations and whatever
timeframes/durations happen to be stored in `sigmaqlab_prices.db`. This leads
to:

- Fragile coupling between FT and BT (Backtest) settings.
- Surprises when BT timeframe/duration do not match prior fetches.
- Extra calls to Zerodha Kite or yfinance for overlapping windows.
- Occasional missing or truncated charts when chart‑data cannot find bars.

The goal of this work is to turn the local prices database into a **first‑class
OHLCV cache** backed by a **Data Manager** service:

- Backtests always run purely off the local cache, with Kite/yfinance called
  only to fill gaps.
- For a configurable horizon (e.g. last 3 years), the cache should provide
  reliable OHLCV for any supported timeframe.
- Charts and metrics should always be consistent with the exact data used by
  the engine.

The existing Data page becomes an optional convenience for quick symbol checks
and manual diagnostics, not a prerequisite for running backtests.


## 2. High‑Level Design

### 2.1 Terminology

- **FT (Fetch Data)** – explicit user‑initiated data fetch (currently via
  Data page → `/api/data/fetch`).
- **BT (Backtest)** – a backtest run (single symbol or group) via
  `/api/backtests` and `BacktestService`.
- **Base timeframe** – canonical intraday timeframe used for persistent
  storage (e.g. `5m` or `1m`); coarser timeframes are derived from base bars.
- **Coverage window** – the union of timestamps stored for a given
  `(symbol, timeframe)` in the prices DB, tracked via `price_bars` and
  `price_fetches`.


### 2.2 Core Idea

1. Introduce a **Data Manager** responsible for guaranteeing coverage:

   ```text
   ensure_coverage(symbols, timeframe_bt, [start_bt, end_bt])
   ```

   - Checks existing coverage in `price_bars` / `price_fetches`.
   - Computes missing sub‑ranges of `[start_bt, end_bt]`.
   - For each gap, uses `DataService.fetch_and_store_bars` to fetch from
     Kite/yfinance, chunking by interval limits.
   - Returns only when local coverage is complete for the requested BT window.

2. Backtests (single and group) **always call the Data Manager** before
   loading DataFrames. They never call Kite directly.

3. The Data Manager prefers to use a **base timeframe** for storage:

   - For intraday backtests:
     - Store a canonical base interval (e.g. `5m`) up to a configured horizon
       (e.g. last 3 years).
     - Aggregate base → BT timeframe (15m, 1h, 1d) on the fly using the
       existing `_aggregate_from_lower_timeframe` logic.
   - For daily or longer backtests:
     - Prefer native daily bars if coverage exists; otherwise aggregate from
       base or fetch daily directly for periods not covered by base bars
       (e.g. dates before the base horizon).

4. The Data page becomes **optional**:

   - Users can still:
     - Verify Kite connectivity.
     - Manually inspect coverage.
     - Trigger base‑horizon fills for selected symbols/groups.
   - But BT correctness no longer depends on prior FT operations.


## 3. Functional Requirements

### 3.1 Data Manager & Coverage

1. Implement a `DataManager` component (service class or helper module) that
   exposes:

   ```python
   ensure_symbol_coverage(symbol: str,
                          timeframe: str,
                          start: datetime,
                          end: datetime) -> None

   ensure_group_coverage(group_id: int,
                         timeframe: str,
                         start: datetime,
                         end: datetime) -> list[str]
   ```

   - Single‑symbol variant ensures coverage for `(symbol, timeframe)`.
   - Group variant resolves members from `StockGroup` and ensures coverage
     for each, returning the list of symbols actually covered (may exclude
     inactive or missing symbols with clear logging).

2. Coverage computation:

   - Use `price_bars` and `price_fetches` to determine existing coverage
     windows for `(symbol, timeframe)` and/or `(symbol, base_timeframe)`.
   - Identify gaps in `[start_bt, end_bt]`:
     - If `timeframe_bt == base_timeframe`:
       - Fill direct gaps in base bars.
     - If `timeframe_bt` is coarser:
       - If base coverage fully contains `[start_bt, end_bt]`:
         - No extra fetch required; BT will aggregate from base.
       - If base coverage partially covers `[start_bt, end_bt]`:
         - Fill missing base gaps within the horizon via Kite.
       - If BT window extends before the configured base horizon:
         - Fetch native daily or `timeframe_bt` bars from Kite only for
           the pre‑horizon segment.

3. Kite/yfinance integration:

   - Reuse existing `DataService.fetch_and_store_bars` which already:
     - Maps internal timeframes to Kite/yfinance intervals.
     - Splits requests into multiple windows respecting Kite’s max days per
       interval.
     - Writes bars into `price_bars` and records `PriceFetch` metadata.
   - Data Manager must:
     - Avoid refetching overlapping ranges that are already stored.
     - Log/raise clear errors if providers fail (auth, rate limits, etc.).

4. Base horizon management:

   - Define a configurable base horizon:
     - Example:

       ```env
       SIGMAQLAB_BASE_HORIZON_DAYS=1095   # ~3 years
       SIGMAQLAB_BASE_TIMEFRAME=5m        # or 1m
       ```

   - For each symbol that has ever been backtested or explicitly selected:
     - Ensure base coverage `[today - horizon, today]`.
   - Optional: support pruning of very old base bars to control DB size.


### 3.2 Backtest Integration

1. `BacktestService.run_single_backtest`:

   - Before `_load_price_dataframe` is called, it must:

     ```python
     DataManager.ensure_symbol_coverage(symbol, timeframe, start, end)
     ```

   - `_load_price_dataframe` can then:
     - Load `timeframe_bt` directly if present, or
     - Aggregate from base timeframe if only base exists.

2. `BacktestService.run_group_backtest`:

   - Before loading data for each symbol, it must call:

     ```python
     symbols = DataManager.ensure_group_coverage(group_id, timeframe, start, end)
     ```

   - Symbols with no coverage after attempted fetches should be:
     - Logged and skipped, or
     - Cause a clear `ValueError` if *all* members fail coverage.

3. Backtest/Chart consistency:

   - Chart‑data (`/api/backtests/{id}/chart-data`) must assume that:
     - Coverage for `(symbol, timeframe_bt, [start_bt, end_bt])` exists in
       local DB for the primary chart symbol.
     - Aggregation from base is used consistently with the engine when needed.
   - Any HTTP 404 from chart‑data should indicate a genuine absence of data,
     not a configuration mismatch.


### 3.3 Data Page UX (optional but recommended)

1. Add a **“Save to cache”** switch in the Data page Fetch card:

   - Modes:
     - `Casual preview only`:
       - Behaves like today: fetch bars and show chart, but optionally **do
         not** persist to DB (or persist under a distinct “preview” source).
     - `Save for backtesting`:
       - Triggers a cache‑oriented fetch:
         - Force `timeframe = base_timeframe` (e.g. `5m`), or
         - Respect user timeframe if it is finer than or equal to base.
       - Sets duration to a standard BT horizon window for base caching, e.g.:

         ```text
         base_start = 01-Apr-2022 (configurable)
         base_end   = today (or user-selected end)
         ```

       - Only missing segments are fetched from Kite (rest are reused).

2. Indicate coverage:

   - Extend Coverage Summary table to show:
     - Whether a row is part of the base cache or a one‑off preview.
     - Age / freshness of the latest fetch (`created_at` already exists).
   - Optionally show a small badge for “BT‑ready” vs “preview only”.

3. The Data page should clearly communicate that:

   - BT no longer requires manual FT.
   - Saving to cache is primarily for pre‑warming or inspecting the local
     history, not a requirement for correctness.


## 4. Non‑Functional Requirements

1. **Performance & rate limits**
   - Data Manager should:
     - Minimise redundant Kite calls by checking coverage first.
     - Chunk long windows per Kite’s documented limits (already implemented).
   - For large groups:
     - Consider per‑symbol pacing or a simple “max symbols per BT run” guard.

2. **Storage**
   - With a 3‑year base horizon and 5m bars for ~100–200 symbols, monitor
     `sigmaqlab_prices.db` size.
   - Provide configuration for:
     - Base timeframe,
     - Horizon length,
     - Optional pruning policy.

3. **Robustness**
   - Fail BT runs loudly when coverage cannot be ensured after retries.
   - Keep metrics & charts consistent even in edge cases (e.g. partial coverage
     for some group members).

4. **Backwards compatibility**
   - Existing backtests in `sigmaqlab_meta.db` remain valid.
   - Old Data page behaviour continues to work; the new switch is additive.


## 5. Implementation Phases (for Sprint Planning)

### Phase 1 – Design & scaffolding

- Finalise base timeframe and horizon configuration.
- Implement `DataManager` skeleton with:
  - Coverage queries using `price_bars` and `price_fetches`.
  - Gap detection logic (without provider calls yet).
- Document design in this PRD and cross‑reference from
  `qlab_impl_report.md`.

### Phase 2 – Backend Data Manager & coverage enforcement

- Implement `ensure_symbol_coverage` and `ensure_group_coverage`:
  - Integrate with `DataService.fetch_and_store_bars`.
  - Handle base vs BT timeframe logic and pre‑horizon/daily fetch rules.
- Wire Data Manager into:
  - `run_single_backtest`,
  - `run_group_backtest`.
- Add regression tests that:
  - Run BT with no prior FT and assert that data is fetched and cached.
  - Run BT with mismatched FT/BT timeframes and verify consistent results.

### Phase 3 – Data page integration (optional)

- Add “Target: Preview vs Save to cache” switch and default BT horizon logic.
- Ensure Coverage Summary clearly indicates which rows are BT‑ready.
- Keep existing preview chart behaviour intact.

### Phase 4 – Maintenance, pruning & monitoring

- Add CLI or scheduled job to:
  - Refresh the base horizon daily for selected universes/groups.
  - Optionally prune bars older than the configured horizon.
- Extend metrics / admin tooling to inspect:
  - Coverage per symbol,
  - DB size and growth.


## 6. Open Questions

1. Base timeframe choice:
   - `1m` gives highest fidelity but increases DB size and Kite traffic.
   - `5m` or `15m` may be a better trade‑off for Indian equities.

2. Horizon length:
   - Default 3 years, but some strategies may need longer (e.g. weekly/daily).
   - Consider separate horizons for intraday vs daily caches.

3. Provider mix:
   - For very long daily histories, yfinance might be preferred over Kite
     to reduce API usage; needs clear precedence rules.

4. UI exposure:
   - How much of the Data Manager behaviour should be visible/tunable in UI
     vs fixed in configuration?

These decisions can be finalised during sprint implementation, but the PRD sets
the overall direction: **Backtests rely on a persistent OHLCV cache managed by
a Data Manager, with Kite/yfinance used only to fill gaps, not as the primary
runtime source.**
