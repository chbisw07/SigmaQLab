# SigmaQLab – Portfolio Optimisation & Management PRD

_PRD – full‑fledged portfolio management on top of Stock Universe & capital‑aware backtesting._

---

## 1. Motivation & Vision

Backtesting a **single strategy on a single stock** or even a **group with capital‑aware routing** answers:

- “How does this strategy behave on this stock / basket under broker constraints?”

But an investor really cares about:

- “How should I allocate my capital across many stocks and strategies to maximise my **risk‑adjusted** return over time?”

Portfolio optimisation / management is the layer that:

- Converts **stock & strategy‑level backtests** into **portfolio‑level allocations**,
- Balances:
  - Expected return vs risk (volatility, drawdown),
  - Capital utilisation vs diversification,
  - Realised + unrealised gains vs a simple buy‑and‑hold baseline,
  - Broker / product constraints (MIS vs CNC, margin, no overnight shorts).

This PRD defines a separate, higher‑level module:

> A **Portfolio Management** area that can host one or more portfolios, run portfolio‑level backtests, and simulate rebalancing policies over a universe of stocks `U`.

Backtests here are **portfolio‑centric**, not just “group runs” of a single strategy.

---

## 2. Core Concepts

### 2.1 Universe `U` and Strategy Library

We assume:

- **Stock Universe**:
  - Table of stocks (`Stock`) with symbol, exchange, sector, tags, is_active.
- **Stock Groups / Baskets**:
  - Named subsets of `U` (e.g. `NIFTY50`, `HighPotentialMidcaps`).
- **Strategies**:
  - As today: business strategies referencing a strategy engine (`engine_code`) + parameter sets.

Portfolio management builds on this foundation; it does **not** replace it.

#### 2.1.1 Stock groups as composition-aware baskets

As of S14–S15 the legacy “stock group” concept has been extended into a true **basket** model:

- Each `StockGroup` carries a `composition_mode` (`weights`, `qty`, or `amount`) plus optional `total_investable_amount`.
- Each `StockGroupMember` can store mode-appropriate targets (`target_weight_pct`, `target_qty`, `target_amount`).
- The Stocks → Groups UI exposes a two-pane basket editor where researchers can:
  - Switch composition mode, equalise targets, and edit members inline.
  - Add members individually, in bulk from the universe, or via CSV import.
- Backtests and Portfolios consume these baskets as universes, displaying labels such as `CODE – Name (mode, #stocks)` with deep links back to the basket editor.

This keeps **universe management** centralised: once a basket is curated, it can be reused consistently across capital-aware backtests and portfolio definitions without duplicating membership metadata.

### 2.2 Portfolio Definition

New entity: `Portfolio`.

Fields (initial):

- `id`, `code`, `name`,
- `base_currency` (INR),
- `universe_scope`:
  - `group:<group_id>` (points at a basket with explicit `composition_mode` + member targets),
  - `tag_filter:<tag>` (future),
  - or explicit `universe:custom` list.
- **Allowed strategies**:
  - One or more `strategy_id`s that may generate trades for this portfolio.
- **Risk profile**:
  - `target_volatility` (optional),
  - `max_drawdown_tolerance`,
  - `max_position_size_pct` (per name),
  - `max_sector_weight_pct` (future),
  - `max_concurrent_positions`,
  - `max_leverage` (future),
  - product constraints (MIS vs CNC, intraday vs delivery mix).
- **Rebalancing policy**:
  - `rebalance_frequency` (e.g. daily, weekly, monthly),
  - `rebalance_trigger` (drift thresholds, risk limits).

Portfolios are independent “containers” that own their own capital, universe selection, and rule set.

### 2.3 Portfolio Backtest

Separate from per‑strategy group backtests:

- A **Portfolio Backtest** simulates:
  - One `Portfolio` definition,
  - Over a date range `[start, end]` and interval (e.g. `1d`, `1h`),
  - With an initial capital (e.g. ₹100,000).
- It may use **multiple strategies**:
  - Each strategy generates candidate signals on subsets of the universe.
  - The portfolio allocator decides:
    - Which signals to take,
    - At what size,
    - Given portfolio‑level risk + allocation rules.

Key difference from group BT:

- Group BT: single strategy + group + shared capital (treats each stock symmetrically).
- Portfolio BT: possibly **multiple strategies**, weighting by:
  - strategy risk, performance, conviction, or user‑defined weights.

---

## 3. Portfolio Allocation Model

### 3.1 Signals & Position Intents

For each bar `t`:

- For each strategy `s` in the portfolio:
  - For each symbol `i` in the portfolio’s universe:
    - Strategy engine may emit a **signal**:
      - `side` (`long`, `short`, `flat`),
      - `strength` or `score` (0–1 or real‑valued),
      - Optional target weight `w_{s,i,t}` (e.g. 2%).

We interpret all signals across strategies and symbols as **position intents**:

- Desired portfolio weights `w_{i,t}` per symbol, possibly aggregated from multiple strategies:

```text
w_{i,t} = Σ_s α_s * w_{s,i,t}
```

where:

- `α_s` are **strategy weights** (e.g. 0.5/0.3/0.2) set per portfolio.

### 3.2 Risk & Constraint Layer

Given desired weights `{w_{i,t}}`:

1. Apply hard constraints:
   - `0 ≤ w_{i,t} ≤ max_position_size_pct`,
   - Sector exposures ≤ `max_sector_weight_pct`,
   - Sum of absolute weights ≤ `max_leverage`.
2. Adjust for **target volatility / drawdown**:
   - Scale all weights by `k_t` such that portfolio volatility estimate matches `target_volatility` (or stays below it).
   - Optionally reduce exposure when recent drawdown exceeds `max_drawdown_tolerance`.
3. Apply MIS vs CNC product rules:
   - Decide which legs are intraday trades vs carry positions.
   - Ensure overnight shorts obey broker rules (no cash overnight shorts).

### 3.3 Execution & Rebalancing

On each rebalance step `t`:

- Compare current holdings `{position_i}` to desired weights `{w_{i,t}}`.
- Compute trade list:

```text
desired_notional_i = w_{i,t} * equity_t
delta_notional_i = desired_notional_i - current_notional_i
trade_size_i = floor(delta_notional_i / price_i)
```

- Execute trades subject to:
  - Minimum ticket size (must be able to afford at least 1 share),
  - Optional transaction cost model (Zerodha‑style for delivery & MIS).

Between rebalances:

- Holdings are carried forward (subject to broker constraints).
- Equity evolves with mark‑to‑market PnL + costs.

---

## 4. Portfolio Backtest Metrics & Reporting

Portfolio metrics (per backtest):

- **Core PnL & equity:**
  - `final_value`, `pnl`, `pnl_realised`, `pnl_unrealised`,
  - Gross vs net (before / after costs).
- **Risk metrics:**
  - Volatility, Sharpe, Sortino,
  - Max drawdown, Calmar,
  - Value‑at‑Risk style summaries (simple percentile loss).
- **Utilisation metrics:**
  - Average & max % capital deployed,
  - Average # of open positions,
  - Average turnover (per year).
- **Per‑symbol & per‑strategy contributions:**
  - PnL contribution by symbol and by strategy,
  - Risk contribution (volatility / drawdown attribution).

UI for a portfolio backtest:

- **Summary card**:
  - Portfolio name, universe, strategies used,
  - Key metrics, PnL breakdown, utilisation.
- **Equity & risk chart**:
  - Equity curve,
  - Drawdown curve.
- **Allocation chart**:
  - Stacked area chart of weights by sector / symbol over time.
- **Trades / holdings table**:
  - Executed trades with symbol, strategy, size, price, PnL, costs,
  - Snapshot of current holdings at end date.

---

## 5. Separation from Strategy Backtests

To avoid coupling and keep UX clean:

- **Backtests page** (existing):
  - Focused on **strategy backtests**:
    - Single stock or group target,
    - One strategy at a time,
    - Capital‑aware routing for groups.
- **Portfolio page** (new):
  - Dedicated to **portfolio definitions** and **portfolio backtests**.
  - Allows:
    - Multiple strategies per portfolio,
    - Explicit risk profiles,
    - Rebalancing policies,
    - Portfolio‑level reports.

Strategy backtests remain building blocks for understanding engines; portfolio backtests are the “whole account” view.

---

## 6. Implementation Phases

### Phase 1 – Foundations

- Data model:
  - Add `portfolios` table with fields described in 2.2.
  - Add `portfolio_backtests` table:
    - `portfolio_id`, `start`, `end`, `interval`,
    - `initial_capital`, `risk_profile_snapshot`, `status`,
    - `metrics_json`, `equity_points`, `trades` (could reuse existing trade/equity tables with a `scope` flag).
- API:
  - CRUD for portfolios.
  - `POST /api/portfolios/{id}/backtests` to run a portfolio backtest.
  - `GET /api/portfolio-backtests/{id}` for results & chart data.

### Phase 2 – Portfolio Engine v1

- Implement:
  - Multi‑strategy signal aggregation for a given universe.
  - Simple risk model:
    - Max position size %, max concurrent positions, no leverage.
  - Rebalancing:
    - Fixed frequency (e.g. daily close).
    - Execution at next bar’s open / close.
  - Costs model:
    - Reuse Zerodha‑style equity costs per trade.

### Phase 3 – Risk / Allocation Enhancements

- Add:
  - Target volatility scaling (exposure dial),
  - Drawdown‑aware de‑risking (cut exposure when DD exceeds threshold),
  - Sector / tag weight constraints.

### Phase 4 – UX & Analysis Tools

- Portfolio page UI:
  - Portfolio list, create/edit forms,
  - Backtest run panel, recent portfolio backtests,
  - Detail view with equity, allocation, and attribution.
- Comparison tools:
  - Side‑by‑side comparison of portfolios,
  - Compare vs benchmark (e.g. buy‑and‑hold NIFTY50).

---

## 7. Non‑Goals & Future Work

Out of scope for this PRD (but possible later):

- Optimisers that search over portfolios automatically (e.g. Markowitz, Black‑Litterman).
- Machine‑learning‑based portfolio construction.
- Options and futures portfolios with complex margin rules.
- Live trade execution / auto‑rebalancing (this will require a separate “Live” PRD).

This PRD instead focuses on building a solid, **backtest‑driven portfolio management module** that:

- Plays nicely with the existing strategy and group backtest system,
- Gives a realistic view of portfolio‑level performance under Indian broker constraints,
- Provides the framework needed for future optimisation and live trading features.

---

## 7. Portfolio Management UI – First-Pass Professional Specification

This section describes a first-pass **professional-grade UI** for the Portfolio Management module. It assumes:

- The existing SigmaQLab shell (App bar + left navigation) remains unchanged.
- All portfolio-specific UI is contained within the **main content area**.
- Visual patterns are consistent with the rest of the app (Backtests, Strategies, Stocks).

The goal is to provide a layout that feels familiar to users of professional portfolio management tools while staying achievable within the current stack.

### 7.1 Portfolio List Page

The Portfolio List page is the entry point for portfolio work.

#### Layout & structure

- **Main content only**:
  - Left sidebar remains the global navigation; it should not contain portfolio-specific KPIs or widgets.
  - All portfolio UI (filters, KPIs, tables) lives inside the central content region.
- **Header**:
  - Page title: `Portfolios`.
  - Subtitle: short description, e.g. “Define portfolios, run portfolio backtests, and analyse performance.”
- **KPI chips row (optional in v1 but documented)**:
  - Located below the title/subtitle.
  - Example chips:
    - `Total portfolios: N`
    - `Active: N`, `Archived: M`
    - `YTD PnL: +X%` (for selected portfolio or aggregate).
  - Chips are clickable in later iterations (e.g. filter to “Archived”), but can be static in v1.

#### Filters bar

Placed directly above the portfolio table, using a horizontal layout:

- **Search**:
  - Text field: “Search by code or name”.
  - Filters in real time as the user types.
- **Universe filter**:
  - Select: `Universe`.
  - Options: “All”, plus entries for each stock group (e.g. `NIFTY50`, `HPS`, etc.).
  - Filters portfolios whose `universe_scope` matches the selected group (for v1 either `group:<id>` or “(none)”).
- **Strategy filter**:
  - Multi-select: `Strategies`.
  - Options populated from Strategy Library.
  - When non-empty, show portfolios whose **allowed strategies** intersect the selection.
- **Risk profile filter**:
  - Simple select for v1, e.g.:
    - “All profiles”
    - “Conservative” (max_position_size_pct low, max_concurrent_positions high),
    - “Balanced”,
    - “Aggressive”.
  - Backed by tags or risk-profile presets later.
- **Archived toggle**:
  - Checkbox or switch: `Show archived`.
  - When off, only active portfolios are shown.

Filters should update the table **immediately** (client-side) when changed.

#### Portfolio table (DataGrid-style)

The core of the page is a dense, sortable table:

- Columns (first pass):
  - `Code` – portfolio code (e.g. `CORE_EQ`).
  - `Name` – human-friendly name.
  - `Universe` – group name or scope summary (e.g. `NIFTY50`, `Custom`).
  - `Strategies` – chips or comma-separated list of allowed strategies.
  - `Last PnL %` – most recent portfolio backtest PnL %, or `–` if none.
  - `Sharpe` – Sharpe ratio from the latest backtest, or `–`.
  - `Status` – active/archived or custom lifecycle (planned later).
  - `Actions` – inline buttons:
    - **View** – navigates to Portfolio Detail (Overview tab) for that portfolio.
    - **Run Backtest** – opens a backtest dialog (see below).

Sorting:

- Default sort: `Code` ascending or `Created` descending (implementation choice).
- Columns `Code`, `Name`, `Universe`, `Last PnL %`, `Sharpe` are sortable.
- Sorting is client-side for v1; server-side can be added later for large datasets.

Pagination:

- Standard page-size controls (10 / 25 / 50) and page navigation at the bottom.
- Pagination is client-side for v1.

#### Row behaviour & backtest dialog

- **Row click**:
  - Clicking anywhere on a row (except Action buttons) selects the portfolio and navigates to **Portfolio Detail** for that portfolio.
- **View button**:
  - Explicit trigger to open Portfolio Detail (Overview tab) in the same page route.
- **Run Backtest button**:
  - Opens a **modal dialog**, not a new page:
    - Fields: date range, interval, initial capital, benchmark, cost model.
    - On submit, triggers `POST /api/portfolios/{id}/backtests`.
    - Shows short success/failure message and optionally a link/button to open the new backtest in the detail view.

### 7.2 Portfolio Detail – Overview Tab

The Portfolio Detail view is a multi-tab shell. The **Overview** tab is the landing tab when a portfolio is opened from the list.

#### Summary header

- Shows portfolio identity:
  - Name & code.
  - Universe description (e.g. “NSE – High Potential Stocks (19 names)”).
  - Key strategies (chips for allowed strategies).

#### Summary cards

First row of content: 3–4 information cards with at-a-glance KPIs for the **selected backtest**:

- `Final value` – absolute equity at end of backtest.
- `PnL %` – net return over the backtest period.
- `Max drawdown` – worst peak-to-trough decline.
- `Sharpe / Vol` – Sharpe ratio and annualised volatility.

Cards show numbers, small sparklines (optional later), and tooltips that explain definitions.

#### Equity & drawdown charts

- Side-by-side or stacked:
  - **Equity curve**: portfolio equity vs time.
  - **Drawdown curve**: % drawdown vs time.
- Display overlays:
  - Benchmark equity curve (e.g. NIFTY 50 or equal-weight universe index).
  - Optional annotations for major drawdowns or regime changes.

#### Allocation and contribution views

Below the charts, show two complementary perspectives:

- **Allocation views**:
  - Pie or horizontal bar for end-of-period allocation by:
    - Sector,
    - Strategy,
    - Symbol (top N).
  - Option to toggle between dimensions (Sector / Strategy / Symbol).
- **Contribution tables**:
  - Symbol-level contribution:
    - Columns: Symbol, Trades, Net PnL, PnL %, Contribution %, Max DD contribution (future).
  - Strategy-level contribution:
    - Strategy code/name, Net PnL, PnL %, Risk contribution (future).

#### Backtest selector

- A dropdown near the top of the Overview tab:
  - Lists available portfolio backtests (`#ID – timeframe – start/end summary`).
  - Selecting a backtest updates:
    - Summary cards,
    - Equity/Drawdown charts,
    - Allocation and contribution views,
    - Any derived metrics.

### 7.3 Portfolio Detail – Settings Tab

The **Settings** tab exposes the editable portfolio definition.

#### Basic information

- Inputs:
  - `Code` (read-only or editable with uniqueness warning).
  - `Name`.
  - `Base currency` (INR / USD / ...).

#### Universe selector

- Controls:
  - Dropdown: `Universe type`:
    - `Stock group` (v1),
    - `Custom list` (future),
    - `Tag filter` (future).
  - When `Stock group`:
    - `Group` select listing existing stock groups.
  - UI exposes a read-only summary of current members (count, sample symbols).

#### Allowed strategies & weights

- List of strategies (from Strategy Library) with:
  - Checkbox to include/exclude in the portfolio.
  - Optional **weight** field per strategy (e.g. target allocation % or relative weight factor).
- v1 can treat all selected strategies equally while capturing weights in the model for future use.

#### Risk profile

Editable fields:

- `Max position size (% of capital)` – per-name cap (`max_position_size_pct`).
- `Max concurrent positions` – integer cap on number of open names.
- `Drawdown tolerance (%)` – threshold above which auto de-risking is applied.
- Future (documented now for continuity):
  - `Target volatility (%)`.
  - `Max sector weight (%)`.

#### Product constraints

- Controls reflecting broker constraints:
  - Toggle or select for **product mix**:
    - `Delivery only (CNC)`,
    - `Intraday only (MIS)`,
    - `Hybrid` (strategy-level or rule-based).
  - When CNC/delivery:
    - Short-selling in cash is disabled.
  - When MIS:
    - Intraday-only trades with auto square-off at 15:15.

#### Rebalancing settings

- Fields:
  - `Rebalance frequency`: daily / weekly / monthly / custom.
  - `Drift trigger`: e.g. rebalance when weight deviates by more than X%.
  - `DD de-risking`: boolean + threshold (e.g. “Reduce exposure by 50% when drawdown exceeds Y%”).

#### Save / Cancel behaviours

- **Save**:
  - Validates required fields (code, name, universe).
  - Persists changes via portfolio API.
  - Shows success banner and updates Overview tab.
- **Cancel**:
  - Discards unsaved changes and reverts form to last persisted state.

### 7.4 Portfolio Detail – Backtests Tab

The **Backtests** tab is focused on configuring and managing portfolio backtests.

#### Backtest configuration panel

Top-left panel with:

- `Date range`: start date + end date.
- `Interval`: timeframe (1d, 1h, 30m, etc.).
- `Initial capital`.
- `Benchmark`:
  - Select from available benchmarks (e.g. NIFTY, equal-weight universe index).
- `Cost model`:
  - Choice of cost profiles (Zerodha-equity, synthetic, none).
- `Run backtest` button:
  - Triggers portfolio backtest for the current portfolio.

#### Backtest runs table

Below or right of the config panel:

- Columns:
  - `ID`, `Timeframe`, `Start`, `End`,
  - `Initial`, `Final`, `PnL %`,
  - `Max DD`, `Sharpe`, `Status`.
- Supports sorting and basic filtering (e.g. by timeframe or date).
- Row click:
  - Selects backtest as the **active** one for the Overview/Analytics tabs.

#### Inline preview

- Small equity/PnL preview for the selected backtest:
  - Mini-equity chart and key metrics rendered on the Backtests tab.
  - Serves as a quick glance without leaving the tab.

#### Deep-link to Overview/Analytics

- Each backtest row includes:
  - Link / button: “Open in Overview”.
  - When clicked, switches to the Overview or Analytics tab with that backtest pre-selected.

### 7.5 Portfolio Detail – Trades & Holdings Tab

The **Trades & Holdings** tab lets users inspect executed trades and end-of-period holdings for a selected portfolio backtest.

#### Toggle: Trades / Holdings

- At the top of the tab:
  - Segmented control or toggle:
    - `Trades` view.
    - `Holdings` view.

#### Trades view

- Table columns (per trade):
  - `Date` (execution or entry date).
  - `Symbol`.
  - `Strategy` (originating strategy, if tracked).
  - `Side` (buy/sell, long/short).
  - `Quantity`.
  - `Price`.
  - `Notional` (qty × price).
  - `Fees` (brokerage + taxes).
  - `Realised PnL`.
  - `Unrealised PnL` (if trade still open).
- Filters:
  - Date range, symbol, strategy, side.
- CSV export:
  - “Export trades CSV” button exporting the filtered set.

#### Holdings view

- Table columns (per symbol at a chosen date, typically end-of-period):
  - `Symbol`.
  - `Quantity`.
  - `Average cost`.
  - `Market price`.
  - `Market value` (qty × price).
  - `Unrealised PnL`.
  - `Weight %` in portfolio.
- Snapshot selector:
  - Dropdown to choose snapshot date (end-of-backtest or specific rebalance points).
- CSV export:
  - “Export holdings CSV” button exporting visible holdings.

### 7.6 Portfolio Detail – Analytics Tab

The **Analytics** tab is for deep-dive quantitative analysis of a portfolio backtest.

#### Charts

- **Equity / Drawdown**:
  - Larger, more detailed versions of the Overview charts.
- **Allocation over time**:
  - Stacked area chart of weights by sector / strategy / symbol.
- **Per-strategy PnL**:
  - Line or bar chart showing cumulative PnL by strategy.

#### Exposure views

- Sector and industry exposures:
  - Current snapshot and time-series.
- Country or factor exposures (future).

#### Risk metrics

- Summary block:
  - Volatility, Sharpe, Sortino,
  - Max drawdown (absolute and %),
  - Value-at-Risk style percentile losses (e.g. 5% worst-day loss).
- Optional tables:
  - Periodic returns (monthly, quarterly).
  - Rolling metrics (rolling 3M / 6M vol, Sharpe).

The Analytics tab does not change portfolio configuration; it is read-only, driven by backtest data.

### 7.7 Portfolio Comparison View

The **Portfolio Comparison** view allows users to compare multiple portfolios side by side.

#### Access & layout

- Accessed via:
  - A “Comparison” entry under the Portfolios section in the navigation, and/or
  - A “Compare” button from Portfolio Detail (pre-selecting that portfolio).
- Layout:
  - Left: portfolio selection and filters.
  - Right: comparison charts and metrics table.

#### Portfolio selection

- Multi-select control or list:
  - Users can check multiple portfolios to include in the comparison.
  - Optional filters: search by code/name, universe, strategy, risk profile.

#### Equity curve comparison

- Chart:
  - Multiple equity curves (one per portfolio), normalised to the same starting value.
  - Optional benchmark curve:
    - Toggle to show/hide benchmark (e.g. NIFTY50, equal-weight universe index).
  - Legend indicates which colour corresponds to which portfolio.

#### Metrics table

- Columns per portfolio:
  - `Portfolio` (code/name).
  - `CAGR` (annualised return).
  - `Max drawdown`.
  - `Sharpe`.
  - `Capital utilisation` (avg % invested).
  - `Turnover` (per year).
  - Optional: `Sortino`, `Calmar`, benchmark-relative PnL.

#### Component reuse

- Where possible, reuse existing chart and metrics components from:
  - Strategy backtests (equity/drawdown chart),
  - Portfolio Overview/Analytics (metrics cards, allocation charts).
- Comparison view focuses on **side-by-side** evaluation, not on editing; there are no configuration controls here beyond selection and filters.
