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
- **Stock Groups**:
  - Named subsets of `U` (e.g. `NIFTY50`, `HighPotentialMidcaps`).
- **Strategies**:
  - As today: business strategies referencing a strategy engine (`engine_code`) + parameter sets.

Portfolio management builds on this foundation; it does **not** replace it.

### 2.2 Portfolio Definition

New entity: `Portfolio`.

Fields (initial):

- `id`, `code`, `name`,
- `base_currency` (INR),
- `universe_scope`:
  - `group:<group_id>`,
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
