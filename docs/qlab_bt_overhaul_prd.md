# SigmaQLab – Backtest Overhaul PRD

This document refines and extends the backtesting capabilities described in `docs/sigmaqlab_prd.md`, focusing on richer backtest detail views, risk/fees modelling, and higher‑quality metrics and visualizations. It assumes the existing S01–S05 implementation (FastAPI + Backtrader backend, React/MUI frontend, basic backtests UI) is in place and stable.

---

## 1. Background & Goals

### 1.1 Current state

As of S05:

- Backend:
  - Backtests are driven by a Backtrader‑based engine via `BacktestService`.
  - Results are persisted in `sigmaqlab_meta.db` (`backtests` table) with:
    - Basic metadata (strategy, params, symbol, timeframe, date range, initial capital, data source).
    - Summary metrics stored in `metrics_json` (e.g. `final_value`, `pnl`, simple stats).
  - Trades and equity points are available in memory during a run and some basic results are persisted (see implementation report).
- Frontend:
  - Backtests page provides:
    - **Run Backtest** form (strategy, params, symbol, timeframe, dates, capital, overrides).
    - **Recent Backtests** table (ID, Strategy, Symbol, Timeframe, Status, PnL, Final value, Created).
  - There is no dedicated backtest detail page yet (no per‑bar charts, trade list, or exports).

The current UX is suitable for simple single‑run checks but does not yet deliver:

- TradingView‑style charts with signals, indicators, and trades.
- Visual comparison of realised vs unrealised (“could have held”) outcomes.
- Rich trade‑level analytics and exportable trade logs.
- A structured “strategy settings” surface for risk, fees, and visualization behaviour.
- Expanded risk/return metrics (Sharpe/Sortino, alpha/beta, etc.).

### 1.2 Goals of the Backtest Overhaul

The Backtest Overhaul (BT Overhaul) aims to:

1. Provide a **rich backtest detail view** per backtest:
   - Price + signals chart with trade markers.
   - Volume and basic oscillators (e.g. RSI) aligned with price.
   - Visual overlays for realised vs “hold” projections.
   - A detailed trade table and export capability.
2. Introduce a **strategy/backtest settings panel** that centralizes:
   - Strategy inputs (parameters),
   - Risk controls,
   - Costs/fees,
   - Visualization preferences,
   - Notes/labels.
3. Expand **metrics computation** to include standard risk metrics, with clear definitions and assumptions.
4. Define a clean **backend data and API contract**:
   - Dedicated endpoints for chart data, trades, and metrics.
   - Clear separation between persisted vs derived data.
5. Maintain **regression safety**:
   - Preserve existing S01–S05 behaviour and APIs where possible.
   - Introduce the new capabilities incrementally via new endpoints and views.

---

## 2. Functional Requirements

### 2.1 Backtest Detail – Price + Signals Chart

For a selected backtest, SigmaQLab should show a **TradingView‑style chart** on a dedicated backtest detail view.

#### 2.1.1 Data sources

- Price data:
  - From `sigmaqlab_prices.db` (`price_bars` table) for the backtest’s symbol/exchange/timeframe and date window.
- Signals and trades:
  - Derived from backtest run data:
    - Individual trade records (entries/exits, side, qty, PnL).
    - Per‑bar position, realised PnL, running equity, etc.
  - Accessed via new endpoints under `/api/backtests/{id}` (see section 3).

#### 2.1.2 Main price pane

The main pane must show:

- Candlestick series of OHLCV for the tested symbol/timeframe.
- Overlay indicators as applicable for the strategy:
  - At minimum: SMA and EMA at configurable periods (e.g. as implied by strategy parameters).
  - Later: reuse indicator catalogue from Data preview where it makes sense.
- Buy/sell markers:
  - Each executed trade should produce:
    - An “entry marker” (e.g. upward triangle or arrow for buys, downward for sells) at the entry bar.
    - An “exit marker” at the exit bar.
  - Hovering a marker should show a tooltip with trade details:
    - Side (long/short), qty,
    - Entry/exit price and timestamps,
    - Realised PnL (₹ and %, see section 2.4).
- Optional PnL labels:
  - If enabled, small textual labels may be shown near markers (e.g. `+₹500`, `‑₹250`).

Implementation constraints:

- Use `lightweight-charts` (same library and theme base as Data preview).
- Chart should be interactive:
  - Zoom/pan,
  - Crosshair with synced price/time readouts.
- Layout height should be similar to Data preview:
  - Desktop: ~600–800 px main area, responsive width.

#### 2.1.3 Volume pane

- Render a histogram series beneath the price candles:
  - Bars colored:
    - Green (up) when close ≥ open,
    - Red (down) when close < open.
  - Same x‑axis/time range as the main pane.
- Users can toggle volume visibility from Visualization settings (see section 2.3.4).

#### 2.1.4 Oscillator pane

- Provide at least one oscillator pane (initially **RSI**):
  - RSI(14) computed on closing prices.
  - Horizontal reference levels (e.g. 30/70).
- Optional future oscillators (phase‑2):
  - MACD, Stochastics, etc.
- The oscillator pane must be time‑synchronised with the price pane:
  - Panning/zooming either pane adjusts the other.

### 2.2 Unrealised Projection Overlay

Goal: Provide a visual and numerical comparison between **realised** performance and a simple **“hold” projection**.

#### 2.2.1 Concept

For each backtest and trade, define:

- **Realised equity**: actual equity path produced by the backtest (already available from the engine).
- **Hold projection**:
  - For each trade, imagine the position was entered at the trade’s entry point and then **left open** until:
    - The backtest end date/time, or
    - A specified “scrutiny period end” (e.g. a configurable projection horizon).
  - The hold projection value at each bar is:
    - `entry_equity + position_size * (price_t - entry_price)` (for long),
    - Corresponding formula for short positions.
  - The baseline (entry_equity) can be:
    - The actual account equity just before opening the trade,
    - Or a normalized base (e.g. 100) for relative comparison (this should be specified in implementation).

#### 2.2.2 Visual representation

Options (to be refined during implementation, but PRD must define defaults):

- Primary approach:
  - Overlay a **thin projection line** on the equity curve chart representing:
    - For single‑position strategies: the equity path if the last trade had been held.
    - For multi‑trade sequences: either:
      - A combined projection (treating trades as if they were “held and never closed”), or
      - A per‑trade projection visualised only when a specific trade is selected in the trade table.
- Secondary metrics:
  - For each trade, compute:
    - `max_theoretical_pnl`: the maximum PnL that could have been achieved by holding from entry to the best price within the window.
    - `pnl_capture_ratio = realized_pnl / max_theoretical_pnl` (where denominator ≠ 0).
  - Expose these metrics in the trade list and in tooltip details.

PRD decision:

- For v1 of BT Overhaul:
  - Persist realised equity as today.
  - Compute projections **on the backend per request**:
    - `/api/backtests/{id}/chart-data` returns both realised equity and projection lines (if configured).
    - `/api/backtests/{id}/trades` returns per‑trade projection metrics (`max_theoretical_pnl`, `pnl_capture_ratio`).
  - Projection visualisation in the frontend is driven by:
    - One “global” projection line (e.g. aggregated or per‑strategy default),
    - Plus per‑trade metrics in the table.

### 2.3 Strategy/Backtest Settings UI

Each backtest run should be configurable via a structured settings surface inspired by TradingView’s “Inputs / Properties / Style / Visibility”, but simplified and suited to SigmaQLab.

Depending on UX choice, the settings can appear as:

- A modal dialog opened from the Backtests page (“Configure backtest”), or
- A slide‑out side panel anchored to the right of the Backtests page.

Settings should be grouped into **tabs**:

#### 2.3.1 Inputs tab

Purpose: Capture all **strategy parameters** that affect signals.

- Fields:
  - Render the current strategy parameter set (`params_json`) as named fields:
    - Simple types (int, float, bool, enum) mapped to MUI inputs/selects.
    - More complex structures may remain in a JSON editor for now.
  - Support:
    - **Load from parameter set**: pick an existing `StrategyParameter` row to populate the inputs.
    - **Reset to defaults**: revert to the underlying parameter set or strategy default.
    - **Override per backtest**:
      - Modifications are stored as part of the backtest configuration (not overwriting the saved parameter set).

Backend mapping:

- Inputs tab values map directly to the `params` sent in `POST /api/backtests` and persisted in `Backtest.params_effective_json` (a new field) or within `metrics_json` if no new column is added.

#### 2.3.2 Risk tab

Purpose: Configure position sizing and risk limits for the backtest.

Fields (initial set):

- Max position size:
  - Expressed as % of equity or fixed currency amount.
- Per‑trade risk:
  - Simple model: % of equity willing to risk per trade (for later R‑multiple metrics).
- Stop‑loss / Take‑profit defaults:
  - Optional ATR‑based or percentage‑based levels (e.g. `stop_loss_pct`, `take_profit_pct`).
- Short selling:
  - Boolean flag: allow or disallow short trades.

Backend mapping:

- These values populate a `risk_config` object in the backtest config passed to the engine.
- The engine interprets them as:
  - Caps on order size,
  - Automatic protective exits where implemented.

#### 2.3.3 Costs tab

Purpose: Model transactional costs and slippage more realistically.

Fields:

- Commission model:
  - `none`, `per_trade_flat`, `percent_of_value`.
  - Parameters:
    - Flat fee per order,
    - Percentage per notional.
- Slippage model:
  - `none`, `per_share`, `ticks`.
  - Parameters:
    - Per‑share slippage (₹),
    - Tick size * N ticks.
- Other charges:
  - A simple percentage or basis‑point field to approximate taxes and broker charges.
  - Optional separate inputs for **intraday** vs **delivery** (CNC).

Backend mapping:

- Costs settings produce a `costs_config` object:
  - Engine uses it to adjust fills and PnL (commission/slippage) during simulation.
- Metrics later include:
  - Gross vs net PnL, fees breakdown (Phase 2).

#### 2.3.4 Visualization tab

Purpose: Control chart display and overlays associated with this backtest.

Fields:

- Toggles:
  - Show/hide buy/sell markers.
  - Show PnL labels on chart.
  - Show unrealised projection overlay.
  - Show/hide volume histogram.
  - Show/hide oscillator pane (RSI).
- Indicator selection for backtest chart:
  - Reuse the indicator catalogue where feasible (`SMA(20)`, `EMA(20)`, `Bollinger(20)`, etc.).
  - Only a subset may be enabled by default.

Backend mapping:

- Visualization settings can be stored alongside the backtest record:
  - Either as `visual_config` JSON on `Backtest`,
  - Or as part of a separate `backtest_display_prefs` table keyed by backtest ID.
- The backend uses these settings to determine which series and markers to include in `/chart-data`.

#### 2.3.5 Meta / Notes tab

Purpose: Capture descriptive metadata and notes.

Fields:

- Backtest label:
  - Short label (e.g. “RVNL 30m mean-reversion – v1”).
  - Displayed in the Recent Backtests table and/or detail header.
- Notes:
  - Multi‑line text area for researcher notes.

Backend mapping:

- Label and notes are persisted in the `Backtest` record.

### 2.4 Trade List & Exports

Backtest detail must include a **trade list** with richer columns and export support.

#### 2.4.1 Trade table

Columns (initial version):

- Symbol,
- Side (Long/Short, maybe `Buy`/`Sell` for entries/exits),
- Quantity,
- Entry time, Entry price,
- Exit time, Exit price,
- Holding period (bars/days),
- Realised PnL (₹ and %),
- What‑if PnL (₹ and %, based on projection),
- Optional R‑multiple (Phase 2 once per‑trade risk is defined).

Behaviour:

- Sortable by any numeric column (Pnl, %Pnl, R, etc.).
- Filterable by side (long/short) and by outcome (win/loss).
- Clicking a trade:
  - Highlights corresponding markers on the chart.
  - Optionally filters/highlights the projection line relevant to that trade.

#### 2.4.2 Export behaviour

- UI:
  - Provide an **Export** button near the trade table.
  - Offer at least CSV export; possibly JSON later.
- Backend options:
  - **Option A (preferred)**: backend endpoint generates CSV:
    - `GET /api/backtests/{id}/trades/export?format=csv`.
    - Returns `text/csv` with appropriate headers.
  - **Option B**: frontend fetches JSON trades from `/trades` and constructs CSV client‑side.

PRD decision:

- For consistency and reusability:
  - Implement backend CSV export (Option A) with the same column set as the table.
  - Frontend simply triggers a file download.

### 2.5 Metrics Expansion

Extend the metrics captured for each backtest beyond basic PnL and drawdown.

#### 2.5.1 Return and volatility metrics

Inputs:

- Per‑bar equity series `E_t` for t = 0…T.
- Bar return series `r_t = (E_t / E_{t-1} - 1)` for t ≥ 1.
- Optionally, a **risk‑free rate** `r_f` (per year) configured globally or per backtest.

Metrics:

- **Total return**:
  - `R_total = E_T / E_0 - 1`.
- **Annualised return** (approximate):
  - For daily bars:
    - `R_ann = (1 + R_total)^(252 / N_days) - 1`.
  - For generic bar durations:
    - Use bar duration to compute equivalent trading days.
- **Volatility** (σ):
  - `σ = stddev(r_t)` over the backtest period.
  - Annualised volatility: `σ_ann = σ * sqrt(N_periods_per_year)`.

#### 2.5.2 Sharpe & Sortino ratios

Assumptions:

- Simple Sharpe/Sortino based on the bar return series.
- Risk‑free rate `r_f` can be:
  - 0 for simplicity, or
  - A configurable constant (e.g. 6% annualised).

Definitions:

- **Sharpe ratio**:
  - Excess returns: `excess_t = r_t - r_f_per_bar`.
  - `Sharpe = mean(excess_t) / stddev(excess_t)`.
- **Sortino ratio**:
  - Downside returns: `downside_t = min(excess_t, 0)`.
  - Downside deviation: `σ_down = sqrt(mean(downside_t^2))`.
  - `Sortino = mean(excess_t) / σ_down`.

#### 2.5.3 Alpha, Beta, and related metrics

Inputs:

- Backtest return series `r_t`.
- Benchmark return series `r_bench_t` for a chosen index:
  - Fetched from `sigmaqlab_prices.db` using a configured benchmark symbol and same timeframe.

Metrics:

- Beta:
  - `Beta = cov(r_t, r_bench_t) / var(r_bench_t)`.
- Alpha (per period):
  - `Alpha = mean(r_t) - (r_f_per_bar + Beta * (mean(r_bench_t) - r_f_per_bar))`.
- Information ratio (optional):
  - `IR = mean(r_t - r_bench_t) / stddev(r_t - r_bench_t)`.

All these can be annualised following standard practice (multiply alpha by periods per year, etc.).

#### 2.5.4 Drawdown and tail metrics

Complement existing max drawdown with:

- Maximum drawdown duration (time in drawdown).
- Number of distinct drawdown episodes (optional).
- Calmar ratio:
  - `Calmar = R_ann / abs(max_drawdown)` (with max_drawdown expressed as fraction).

Persisted location:

- All expanded metrics are stored under `Backtest.metrics_json`:
  - E.g. `metrics_json = { "final_value": ..., "pnl": ..., "total_return": ..., "sharpe": ..., "sortino": ..., "beta": ..., "alpha": ..., "calmar": ... }`.

---

## 3. Backend Design

### 3.1 Data Model

Existing core tables:

- `strategies`
- `strategy_parameters`
- `backtests`
- `price_bars`
- Equity/trade artefacts (as per current implementation).

#### 3.1.1 Backtest extensions

Potential new columns on `backtests`:

- `label` (short string),
- `notes` (text),
- `risk_config_json` (JSON),
- `costs_config_json` (JSON),
- `visual_config_json` (JSON),
- `params_effective_json` (JSON) – final parameters used in this run.

These can be added incrementally. The initial BT Overhaul can work with:

- `label` and `notes` for UX,
- `params_effective_json` to capture full parameter context when a backtest is run,
- `metrics_json` extended per section 2.5 (no schema change needed for metrics).

#### 3.1.2 Trades and equity points

For chart and table use, we assume or introduce:

- `backtest_trades` table:
  - Columns:
    - `id`, `backtest_id`,
    - `symbol`, `side`, `quantity`,
    - `entry_time`, `entry_price`,
    - `exit_time`, `exit_price`,
    - `realized_pnl`, `realized_pnl_pct`,
    - Optional `max_theoretical_pnl`, `what_if_pnl`, `pnl_capture_ratio`.
- `backtest_equity_points` table:
  - Columns:
    - `id`, `backtest_id`,
    - `timestamp`,
    - `equity`,
    - Optional `drawdown`, `runup`.

If not already present, these tables can be introduced as part of S06 backend work. Alternatively, trades/equity can continue to be stored in `metrics_json` or in a compressed series, but explicit tables are preferred for queries and exports.

### 3.2 New/Updated API Endpoints

#### 3.2.1 Backtest chart data

`GET /api/backtests/{id}/chart-data`

Response JSON shape (draft):

```json
{
  "backtest": {
    "id": 123,
    "strategy_id": 1,
    "symbol": "HDFCBANK",
    "timeframe": "1h",
    "start": "2025-01-01T09:15:00Z",
    "end": "2025-03-31T15:30:00Z",
    "label": "HDFCBANK 1h SMA test"
  },
  "price_bars": [
    {
      "timestamp": "2025-01-01T09:15:00Z",
      "open": 100.0,
      "high": 101.5,
      "low": 99.5,
      "close": 101.0,
      "volume": 123456
    }
    // ...
  ],
  "indicators": {
    "sma_fast": [{ "timestamp": "...", "value": 100.5 }],
    "sma_slow": [{ "timestamp": "...", "value": 99.8 }],
    "rsi_14": [{ "timestamp": "...", "value": 55.2 }]
  },
  "equity_curve": [
    { "timestamp": "...", "equity": 100000.0 }
    // ...
  ],
  "projection_curve": [
    { "timestamp": "...", "value": 101500.0 }
    // ...
  ],
  "signals": {
    "trades": [
      {
        "id": 1,
        "symbol": "HDFCBANK",
        "side": "long",
        "quantity": 100,
        "entry_time": "2025-01-10T10:00:00Z",
        "entry_price": 102.0,
        "exit_time": "2025-01-15T14:00:00Z",
        "exit_price": 108.0,
        "realized_pnl": 600.0,
        "realized_pnl_pct": 5.88,
        "max_theoretical_pnl": 900.0,
        "pnl_capture_ratio": 0.67
      }
    ]
  }
}
```

Notes:

- `price_bars` and `indicators` are aligned by timestamp.
- `equity_curve` and `projection_curve` can be plotted either in separate panes or share an axis scaled to equity.
- `signals.trades` mirrors the trade table; frontend uses this for markers.

#### 3.2.2 Backtest trades

`GET /api/backtests/{id}/trades`

Response:

```json
{
  "backtest_id": 123,
  "trades": [
    {
      "id": 1,
      "symbol": "HDFCBANK",
      "side": "long",
      "quantity": 100,
      "entry_time": "2025-01-10T10:00:00Z",
      "entry_price": 102.0,
      "exit_time": "2025-01-15T14:00:00Z",
      "exit_price": 108.0,
      "holding_period_bars": 20,
      "realized_pnl": 600.0,
      "realized_pnl_pct": 5.88,
      "what_if_pnl": 900.0,
      "what_if_pnl_pct": 8.82,
      "pnl_capture_ratio": 0.67
    }
  ]
}
```

`GET /api/backtests/{id}/trades/export?format=csv`

- Returns the same data as CSV (`text/csv`).

#### 3.2.3 Backtest metrics

Options:

- **Option A**: Enrich `GET /api/backtests/{id}` to include all metrics under `metrics` field.
- **Option B**: Add `GET /api/backtests/{id}/metrics`.

PRD preference:

- Start with Option A (single detail endpoint), while keeping the `/chart-data` and `/trades` endpoints focused on timeseries and trades.

### 3.3 Computation vs Persistence

- Persisted:
  - Backtest metadata (`backtests` table),
  - Effective parameters (`params_effective_json`),
  - Risk/costs/visualization configs (as JSON),
  - Core trades and equity points (`backtest_trades`, `backtest_equity_points`),
  - Summary metrics (`metrics_json`).
- Derived at request time:
  - Indicators (SMA/EMA/RSI) for chart:
    - Either recomputed on request using price bars (simple SMA/EMA/RSI are cheap),
    - Or stored if later profiling shows performance issues.
  - Projection curves and per‑trade what‑if metrics:
    - Computed in the `/chart-data` and `/trades` handlers using trades + price bars + equity points.

Performance expectations:

- Typical backtests (months to a few years of 1h/1d bars) should:
  - Load and serve chart data within a few hundred milliseconds.
  - Trade exports should stream results without blocking the main API.
- For very long histories or intraday bar sets:
  - Consider pagination or down‑sampling in chart endpoints (Phase 2).

---

## 4. Frontend UX – Backtests Overhaul

### 4.1 Navigation and layout

- Backtests main page:
  - Left column: **Run Backtest** form (similar to current version, extended with a “Settings” button to open the settings panel).
  - Right column: **Recent Backtests** table.
- Backtest detail view:
  - When a user clicks a row in Recent Backtests:
    - Navigate to `/backtests/{id}` or open a detail view in the right pane.
  - Detail layout:
    - Top: summary header (strategy, symbol, timeframe, label, PnL, key metrics).
    - Middle: tabs or stacked sections:
      - **Chart** – price + signals + projection panes.
      - **Trades** – rich trade table + export button.
      - **Settings** – read‑only view of the configuration used (and possibly edit+rerun in future).

### 4.2 Chart UX

- Reuse the `lightweight-charts` infrastructure from Data preview:
  - Shared dark theme,
  - Volume histogram styling,
  - Oscillator pane with synced crosshair and time axis.
- Additional elements:
  - Trade markers (entry/exit).
  - Optional projection line(s).
  - Option to toggle overlays from the Visualization tab (persisted per backtest).
- Range controls:
  - Same range presets as Data preview (intraday + calendar).
  - Chart should auto‑adjust y‑axis to visible bars for clarity.

### 4.3 Settings UX

- Settings panel (modal or side drawer) with tabs:
  - Inputs, Risk, Costs, Visualization, Meta/Notes.
- When user runs a backtest:
  - Settings panel can be opened, edited, and then used to populate the `Run Backtest` form.
- In the detail view:
  - Settings tab shows the **effective** configuration used for that run (read‑only or with a “Clone as new backtest” action).

### 4.4 Trades UX

- Trade table with:
  - Sorting, filtering, paging if needed.
  - Visual linkage to chart (select row → highlight markers and projection segment).
- Export button:
  - Triggers CSV download via `/trades/export`.

---

## 5. Testing & Regression

### 5.1 Backend tests

- Unit tests for:
  - Metrics calculations (Sharpe, Sortino, alpha/beta, Calmar, etc.) with simple synthetic time series.
  - Projection metrics (max_theoretical_pnl, pnl_capture_ratio) on controlled price/trade scenarios.
- API tests for:
  - `/api/backtests/{id}/chart-data`:
    - Shape of JSON,
    - Alignment between price bars, indicators, equity, projection, and trades.
  - `/api/backtests/{id}/trades` and `/trades/export`:
    - Presence and correctness of fields,
    - CSV encoding/headers.
- Regression tests to ensure:
  - `POST /api/backtests` behaviour remains unchanged for existing S01–S05 flows.
  - Existing data service endpoints (/data/fetch, /data/summary, /data/preview) still pass.

### 5.2 Frontend tests

- Component tests (or focused integration tests) for:
  - Backtest detail chart:
    - Rendering of candles, volume, indicators, trade markers, projection line.
    - Range buttons changing visible data window.
  - Trades table:
    - Correct rendering of trade fields,
    - CSV export trigger.
  - Settings panel:
    - Loading and editing of inputs, risk, costs, and visualization toggles.

### 5.3 Manual regression checklist

- Data page:
  - Fetch data and preview remain functional.
- Strategies page:
  - Strategy and parameter CRUD unaffected.
- Backtests page:
  - Running a simple SMA_X backtest still works as before.
  - New detail view loads without breaking existing list.

---

## 6. Open Questions & Phase‑2 Ideas

1. **Portfolio‑level backtests**:
   - How to integrate multi‑symbol, portfolio‑aware simulations (originally planned for S07) with the BT Overhaul detail views.
2. **Batch backtests and optimization**:
   - How to connect batch result grids/heatmaps (original S06) with the richer backtest detail (e.g. click a cell → open detail).
3. **ML/AI enhancements**:
   - Regime detection overlays on charts (e.g. color‑coding background for bull/bear regimes).
   - Meta‑labeling trade outcomes for ML classifiers.
4. **More advanced risk models**:
   - Kelly fraction, VaR/Expected Shortfall, and scenario tests.
5. **Reporting and journals**:
   - PDF/HTML “backtest reports” summarising charts, metrics, and trades for printing or sharing.
6. **Live‑paper bridge**:
   - Deeper two‑way integration with SigmaTrader (e.g. import live trades to compare vs backtests).
