# SigmaQLab – Product Requirements Document
_File: `sigmaqlab_prd.md`_

---

## 1. Product Overview

### 1.1 Vision

**SigmaQLab** is your private **quantitative research lab**: a platform for designing, backtesting, and optimizing systematic trading strategies that operate on your real-world portfolios.

SigmaQLab focuses on **research and decision support**, not live order execution. Live trading remains the responsibility of **SigmaTrader (ST)**. SigmaQLab answers:

- *What strategy ideas are worth trading?*
- *How do they behave with my actual capital and holdings?*
- *Which parameters and environments make them robust?*

Later, selected strategies can be promoted to SigmaTrader via TradingView alerts or direct integration.

### 1.2 Objectives

1. Provide a **structured environment** for:
   - Strategy definition,
   - Backtesting,
   - Parameter tuning / optimization,
   - Portfolio-aware scenario analysis.

2. Emphasize **portfolio health**:
   - Combine realized and unrealized P&L,
   - Account for core long-term holdings and tactical trading on the same stocks,
   - Focus on long-term wealth growth, not just isolated backtest equity curves.

3. Enable a **daily professional workflow**:
   - Review strategy performance,
   - Inspect new signals / environments,
   - Decide which strategies deserve live deployment via SigmaTrader.

4. Establish an **extensible foundation** for future ML/AI workflows:
   - Regime detection,
   - Meta-labeling,
   - Dynamic position sizing,
   - Smart parameter search.

---

## 2. Users & Use Cases

### 2.1 Primary User

**Full-time systematic retail trader (you)**

- Manages multiple portfolios with overlapping holdings.
- Maintains **core positions** for long-term ownership and **tactical trades** for cash generation.
- Needs clarity on:
  - Which strategies to trust,
  - How they interact with the existing portfolio,
  - How to tune and maintain them over time.

### 2.2 Key Use Cases

1. **Strategy Library & Governance**
   - Capture trading ideas as strategies with:
     - Clear descriptions,
     - Parameters,
     - Status (experimental, candidate, live-ready),
     - Links to TradingView/SigmaTrader implementations.

2. **Single Backtest Runs**
   - Run a backtest for a strategy on one or more symbols/timeframes, with:
     - Defined capital,
     - Optional starting portfolio,
     - Realistic execution assumptions.

3. **Batch Backtests & Optimization**
   - Run many backtests across:
     - Different parameters,
     - Different symbol universes,
   - Evaluate robustness and sensitivity.

4. **Portfolio-Aware Simulations**
   - Overlay strategies on top of **current holdings** and cash,
   - Simulate selling parts of core holdings for tactical trades and re-entering later,
   - Understand impact on total wealth (realized + unrealized).

5. **Data Management & Inspection**
   - Fetch and cache historical data for 100–200 stocks,
   - Use consistent data sources with SigmaTrader (primarily Zerodha / Kite),
   - Inspect OHLCV and basic indicators before writing strategies.

6. **Integration Preparation for SigmaTrader**
   - Mark which strategies are ready for live execution,
   - Store metadata like TradingView Pine script names or SigmaTrader strategy IDs,
   - Provide performance summaries for SigmaTrader to display.

---

## 3. Scope

### 3.1 In Scope (v1)

- Strategy metadata and parameter management.
- Historical data ingestion and storage (100–200 stocks).
- Backtesting via an event-driven engine (Backtrader).
- Batch backtests and parameter sweeps (with basic parallelism).
- Storage and visualization of:
  - Equity curves,
  - Trade lists,
  - Key performance metrics.
- Clean web UI for:
  - Strategies,
  - Backtests,
  - Data,
  - Basic portfolio snapshots.

### 3.2 Out of Scope (v1)

- Live order placement (handled by SigmaTrader).
- High-frequency tick-level backtesting and microstructure modeling.
- Complex multi-broker integrations.
- Full ML pipeline (models, training orchestration, feature stores).
- Multi-user tenancy/security (single-user internal tool is sufficient initially).

---

## 4. Functional Requirements

### 4.1 Strategy Library

**Goal:** Provide a structured catalog of all strategies and parameter sets.

**Features:**

- **Create / Edit / Delete Strategy**
  - Fields:
    - `name`, `code` (short identifier),
    - `category` (trend, mean reversion, breakout, overlay, risk filter),
    - `description` (rich text/markdown),
    - `status` (experimental, candidate, paper, live, deprecated),
    - `tags` (free-form, comma-separated or array).

- **Parameter Sets per Strategy**
  - A strategy can have multiple parameter configurations.
  - Each parameter set has:
    - `label` (e.g., default, aggressive, conservative),
    - `params_json` (key-value map; e.g. `{"fast_ma": 10, "slow_ma": 30, "rsi_lower": 30}`),
    - `notes` and `created_at`.

- **Universe & Timeframe Hints**
  - Optional lists per strategy:
    - Preferred symbols (e.g., `["RELIANCE", "HDFCBANK"]`),
    - Preferred timeframes (e.g., `["5m", "15m", "1D"]`).

- **Integration Metadata**
  - Optional links to:
    - TradingView (Pine script ID, alert template name),
    - SigmaTrader (strategy ID, execution mode).

### 4.2 Data Management

**Goal:** Maintain a clean, consistent data store with preference for Zerodha data.

**Features:**

- **Data Sources**
  - Primary: Zerodha Kite historical API (OHLCV).
  - Secondary: yfinance or CSV upload as fallback (clearly labeled as such).

- **Data Fetch & Ingestion**
  - For each symbol & timeframe:
    - Fetch historical data via Kite for a given date range.
    - Store in a dedicated price DB (`sigmaqlab_prices.db`).
  - If Kite is unavailable or incomplete:
    - Allow optional fallback retrieval from yfinance or user-uploaded CSV.
    - Track `source` per bar (`kite`, `yfinance`, `local_csv`).

- **Data Explorer UI**
  - Select symbol + timeframe + date range.
  - Render:
    - Price chart (candles or OHLC),
    - Volume,
    - Optional indicators (SMA/EMA, RSI, Bollinger, etc.).
  - Provide quick quality checks (missing data segments, gaps).

### 4.3 Backtesting Engine (Backtrader-First, Pluggable)

**Goal:** Execute realistic event-driven backtests and expose a consistent result model.

**Engine abstraction:**

- Define a **Strategy Engine interface** in the backend:
  - `run_backtest(strategy_definition, params, config, data)` → `BacktestResult`.
- Provide a **Backtrader-based implementation** as the default engine.
- Future addition: a **vectorized engine** (e.g., using vectorbt) for fast sweeps.

**Single backtest configuration:**

- Inputs:
  - `strategy_id`, `params_id`,
  - `symbols` (one or many),
  - `timeframe`,
  - `start_date`, `end_date`,
  - `initial_capital`,
  - Optional `starting_portfolio` (symbol, qty, avg price),
  - Execution assumptions:
    - Slippage model (none / simple),
    - Commission (per trade / per share),
    - Order type assumptions (market-on-next-bar, etc.).

- Execution:
  - Engine loads OHLCV for given symbols/timeframe from price DB.
  - Runs Backtrader strategy:
    - Uses Python code that corresponds to the strategy (mapped by `code`).
    - Applies parameters from `params_json`.
    - Respects portfolio rules:
      - Minimum core holdings per symbol (if configured),
      - Max percent of capital per position,
      - Max concurrent positions.

- Output:
  - Equity curve (timestamp, equity),
  - Trades:
    - Symbol, side, entry/exit times & prices, quantity,
    - Trade P&L (absolute & %),
  - Summary metrics:
    - Total return, annualized return,
    - Max drawdown,
    - Win rate, average win/lose,
    - Number of trades, average holding period,
    - (Optionally) volatility and Sharpe-like metrics.

### 4.4 Batch Backtesting & Optimization

**Goal:** Explore parameter spaces and multi-symbol behavior efficiently.

**Features:**

- **Batch Runs**
  - Submit jobs specifying:
    - Strategy + parameter grid or list of parameter sets,
    - Symbol universe,
    - Timeframe(s),
    - Date range,
    - Initial capital and/or starting portfolio.
  - Backends:
    - Use `concurrent.futures.ProcessPoolExecutor` for parallel execution of independent backtests.
  - Record each combination as an entry in the `backtests` table.

- **Optimization Views**
  - For a selected batch:
    - Table view: params vs key metrics,
    - Plots:
      - Parameter vs performance (e.g., 1D line or 2D heatmap),
      - Distribution of returns across parameter combinations.

- **Robustness Insight**
  - Highlight:
    - Clusters of “good” parameter sets (robust regions),
    - Isolated peaks (likely overfitting).

### 4.5 Portfolio-Aware Simulations (Phase 2+)

**Goal:** Evaluate strategies in context of the real portfolio, not just a synthetic cash account.

**Features:**

- **Portfolio Snapshots**
  - Import or manually enter current holdings:
    - Symbol, quantity, average buy price.
  - Tag holdings as:
    - Core (should not fall below a minimum qty),
    - Tactical (can be rotated more aggressively).

- **Strategy Overlay**
  - Configure backtests that:
    - Start with a specific portfolio snapshot,
    - Apply a strategy’s trades within:
      - Max sell limitations on core positions,
      - Tactical trading constraints on overlapping symbols.

- **Metrics**
  - How total wealth (portfolio + cash) changes over time,
  - Impact of strategy on:
    - Realized gains,
    - Unrealized gains,
    - Drawdowns at portfolio level.

### 4.6 Reporting & Journaling (Phase 2+)

**Goal:** Preserve insights and provide clean summaries.

- **Backtest Report**
  - Summarize:
    - Strategy description & parameters,
    - Key metrics,
    - Equity curve,
    - Best/worst trades.
  - Optionally export as HTML/PDF.

- **Notes / Journal**
  - Per strategy and per backtest:
    - Store trader’s notes (e.g. observations, caveats, ideas).
  - Allow filtering backtests with notes to revisit important experiments.

### 4.7 Integration Hooks with SigmaTrader

**Goal:** Provide information that SigmaTrader can use to display strategy performance and status.

- Store for each strategy:
  - `linked_sigma_trader_id` (optional),
  - `linked_tradingview_template` (optional),
  - `live_ready` flag (boolean).

- Expose read-only API endpoints for SigmaTrader to:
  - Fetch latest backtest summary for a given `strategy_id`,
  - Display high-level metrics in SigmaTrader’s UI.

---

## 5. System Architecture

### 5.1 Technology Stack

- **Backend**
  - Python
  - FastAPI (REST API)
  - Backtrader (primary backtesting engine)
  - Optional vectorized engine (e.g. vectorbt) in future phases
  - SQLite:
    - `sigmaqlab_meta.db` for metadata, backtests, trades
    - `sigmaqlab_prices.db` for OHLCV price history
  - Zerodha Kite Connect:
    - Read-only usage for:
      - Historical OHLCV,
      - Holdings/positions snapshots
  - yfinance:
    - Fallback data provider when Kite data is unavailable or insufficient.

- **Frontend**
  - TypeScript
  - React
  - Material UI (MUI)
  - Node.js + npm/yarn tooling
  - Charting:
    - Financial price charts via a JS charting library (e.g. `lightweight-charts`),
    - Analytics charts via `recharts`, `nivo`, or similar.

### 5.2 High-Level Architecture

```text
+---------------------------+      +------------------------------+
|      React + MUI         |      |           FastAPI            |
|     (SigmaQLab UI)       +----->+       REST Endpoints         |
|   - Dashboard            |  HTTP|                              |
|   - Strategy Library     |      |  Strategy Service            |
|   - Backtests            |      |  Data Service (Kite/yf/CSV)  |
|   - Data Management      |      |  Backtest Service            |
|   - Portfolio (later)    |      |    (Backtrader engine)       |
+---------------------------+      |  Results Service             |
                                   |                              |
                                   | SQLite Databases:            |
                                   |  - sigmaqlab_meta.db         |
                                   |  - sigmaqlab_prices.db       |
                                   +------------------------------+
```

**Data Service**

- Knows how to:
  - Pull historical data from Kite,
  - Fallback to yfinance or CSV,
  - Write OHLCV to `sigmaqlab_prices.db`,
  - Read OHLCV for backtest requests.

**Backtest Service**

- Implements the **Strategy Engine interface** using Backtrader.
- Accepts backtest requests (strategy, params, config) and:
  - Loads data via Data Service,
  - Runs the simulation,
  - Stores results in `sigmaqlab_meta.db`.

**Strategy & Results Services**

- Strategy Service manages:
  - Strategy metadata,
  - Parameter sets,
  - Links to external systems.
- Results Service:
  - Exposes backtest lists and details,
  - Packs time-series data for charts (equity, price + signals, P&L).

---

## 6. Data Model (High-Level)

### 6.1 Meta Database (`sigmaqlab_meta.db`)

- **strategies**
  - `id` (PK)
  - `name`
  - `code`
  - `category`
  - `description`
  - `status` (experimental, candidate, paper, live, deprecated)
  - `tags` (JSON/text)
  - `linked_sigma_trader_id` (nullable)
  - `linked_tradingview_template` (nullable)
  - `created_at`, `updated_at`

- **strategy_parameters**
  - `id` (PK)
  - `strategy_id` (FK → strategies.id)
  - `label` (e.g. default, aggressive)
  - `params_json`
  - `notes`
  - `created_at`

- **backtests**
  - `id` (PK)
  - `strategy_id` (FK)
  - `params_id` (FK → strategy_parameters.id, nullable)
  - `engine` (e.g. `backtrader`, `vectorized`)
  - `symbols_json` (list of symbols)
  - `timeframe`
  - `start_date`, `end_date`
  - `initial_capital`
  - `starting_portfolio_json` (nullable)
  - `status` (`pending`, `running`, `completed`, `failed`)
  - `metrics_json` (summary metrics)
  - `data_source` (kite/yfinance/mixed)
  - `created_at`, `finished_at`

- **backtest_equity_points**
  - `id` (PK)
  - `backtest_id` (FK)
  - `timestamp`
  - `equity`

- **backtest_trades**
  - `id` (PK)
  - `backtest_id` (FK)
  - `symbol`
  - `side` (`long`/`short`/`flat`)
  - `entry_time`, `exit_time`
  - `entry_price`, `exit_price`
  - `quantity`
  - `pnl`, `pnl_pct`
  - `notes` (nullable)

- **portfolio_snapshots** (Phase 2+)
  - `id` (PK)
  - `name`
  - `snapshot_date`
  - `holdings_json` (symbol, qty, avg_price, flags for core/tactical)

- **notes** (optional shared table)
  - `id` (PK)
  - `parent_type` (`strategy`/`backtest`)
  - `parent_id`
  - `content`
  - `created_at`

### 6.2 Price Database (`sigmaqlab_prices.db`)

- **price_bars**
  - `id` (PK)
  - `symbol`
  - `timeframe` (e.g. 5m, 15m, 1D)
  - `timestamp`
  - `open`, `high`, `low`, `close`
  - `volume`
  - `source` (`kite`, `yfinance`, `local_csv`)
  - Index on (`symbol`, `timeframe`, `timestamp`)

---

## 7. API (High-Level Endpoints)

### 7.1 Strategy Endpoints

- `GET /api/strategies`
- `POST /api/strategies`
- `GET /api/strategies/{id}`
- `PUT /api/strategies/{id}`
- `DELETE /api/strategies/{id}`

- `GET /api/strategies/{id}/params`
- `POST /api/strategies/{id}/params`
- `GET /api/params/{id}`
- `PUT /api/params/{id}`
- `DELETE /api/params/{id}`

### 7.2 Data Endpoints

- `POST /api/data/fetch`
  - Trigger fetch from Kite (and fallback if needed) for a symbol + timeframe + date range.
- `POST /api/data/upload`
  - Upload CSV with OHLCV.
- `GET /api/data/symbols`
- `GET /api/data/{symbol}/summary`
- `GET /api/data/{symbol}/preview?timeframe=...&start=...&end=...`

### 7.3 Backtest Endpoints

- `POST /api/backtests`
  - Submit a new backtest (single or batch spec).
- `GET /api/backtests`
- `GET /api/backtests/{id}`
- `GET /api/backtests/{id}/equity`
- `GET /api/backtests/{id}/trades`

### 7.4 Portfolio Endpoints (Phase 2+)

- `POST /api/portfolios`
- `GET /api/portfolios`
- `GET /api/portfolios/{id}`

### 7.5 SigmaTrader Integration (Read-Only)

- `GET /api/integration/strategies/{id}/summary`
  - Returns latest backtest summary for a strategy.

---

## 8. UX & UI

### 8.1 General Aesthetic

- **Tone:** Professional, quant-oriented, “research terminal” feel.
- **Theme:** Dark mode by default, with:
  - Muted background colors,
  - High-contrast text,
  - Green/red accents for P&L.
- **Design System:** Material UI with:
  - Consistent spacing,
  - Typography scale,
  - Reusable layout components (app bar, side nav, cards).

### 8.2 Global Layout

- Top-level navigation:
  - Dashboard
  - Strategies
  - Backtests
  - Data
  - Portfolio (later)
  - Settings

- Layout:
  - Top app bar with brand (`SigmaQLab`) and nav.
  - Optional side nav for quick access.
  - Main content area with responsive cards and tables.

### 8.3 Dashboard

- **Cards**
  - Number of strategies (by status),
  - Number of backtests (last 7/30 days),
  - Best/worst performing strategies (recent).

- **Recent Backtests Table**
  - Strategy, parameters label, symbols, date, return, max drawdown, link to details.

- **Quick Actions**
  - New Strategy
  - Run Backtest
  - Fetch Data

### 8.4 Strategies Page

- **Strategy List**
  - Table with columns:
    - Name, Code, Category, Status, Tags, Last Backtest Return (if available).
  - Filters:
    - Status, Category, Tag search.

- **Strategy Detail View**
  - Description,
  - Parameter sets list,
  - Linked symbols/timeframes,
  - Integration metadata (TV/ST),
  - Recent backtests associated with this strategy.

### 8.5 Backtests Page

- **Backtest List**
  - Filter by:
    - Strategy, status, date range.
  - Columns:
    - ID, Strategy, Params label, Symbols, Timeframe, Period, Return, Max DD, Status.

- **Backtest Detail**
  - Summary metrics,
  - **Interactive equity curve**:
    - Hover tooltips,
    - Zoom/pan,
    - Markers for significant events (e.g., largest drawdown).
  - **Trades table**:
    - Entry/exit times, symbol, side, quantity, P&L.
  - **Price + signals chart**:
    - Price candles,
    - Indicators,
    - Buy/sell markers.
  - Parameters & engine configuration snapshot.
  - Notes/journal section.

### 8.6 Data Management Page

- **Data Fetch UI**
  - Form:
    - Symbol, timeframe, start date, end date.
  - Button: “Fetch from Kite”.
  - Show status & logs (success, fallback, errors).

- **Data Table**
  - List of available symbol/timeframe combos:
    - Symbol, timeframe, start_date, end_date, source(s).

- **Data Preview**
  - Mini chart and table snippet for selected symbol/timeframe.

---

## 9. Non-Functional Requirements

### 9.1 Performance

- Single-symbol, multi-year daily backtests should complete within a few seconds on a typical development machine.
- Batch parameter sweeps:
  - Use multi-process parallelism where viable.
  - UI should indicate progress/status (running, completed, failed).

### 9.2 Reliability

- Backtests must be **deterministic** for a given dataset/config.
- Clear error messages for:
  - Missing data,
  - Misconfigured strategies,
  - Engine-level exceptions.

### 9.3 Security

- Local single-user installation is assumed.
- Sensitive keys (Kite API, tokens) stored via environment/config files, not hard-coded.
- No external network calls beyond configured data providers (Kite, yfinance) unless explicitly added.

### 9.4 Maintainability & Modularity

- Clear separation into services/modules:
  - `strategy_service`, `data_service`, `backtest_service`, `results_service`.
- Communication via:
  - Pydantic models (internal),
  - REST APIs (external/UI),
  - Well-defined DB schemas.
- Backtest engines are pluggable behind a shared interface.

### 9.5 Extensibility

- Data providers can be extended (add new sources) without changing the whole system.
- Engine layer can host multiple engines (Backtrader, vectorized engine, later ML-based evaluators).
- SigmaTrader integration is via **stable, documented endpoints**, not internal coupling.

---

## 10. Future Enhancements

- **ML/AI Layer**
  - Add regime classifiers and meta-labeling modules.
  - Introduce Optuna/Hyperopt-based model and parameter optimization pipelines.

- **Advanced Portfolio Analytics**
  - Correlation, factor exposure estimates, scenario analysis.

- **Deeper SigmaTrader Integration**
  - Initiate backtests from SigmaTrader UI.
  - Show SigmaQLab-derived metrics directly in SigmaTrader dashboards.

- **Job Queue / Distributed Runs**
  - Introduce Celery, Dask or Ray for large-scale parameter sweeps and distributed experiments.

---

_End of `sigmaqlab_prd.md`_
