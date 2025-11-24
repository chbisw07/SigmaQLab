# SigmaQLab – Stock Universe & Group Backtests (High‑Level Intent)

_Draft PRD extension – focuses on portfolio‑level backtesting using stock groups._

---

## 1. Motivation & Goals

Today SigmaQLab backtests are effectively **single‑symbol**: one strategy, one symbol, one capital pot. Real trading capital, however, is deployed across a **universe of stocks** with overlapping signals and shared risk constraints.

This document captures the intent to:

- Introduce a **Stock Universe** and **Stock Groups** (baskets like `trending_stocks`, `high_potential_midcap`).
- Allow a **single strategy + risk config** to be run on a **group**, with:
  - One shared initial capital (e.g. ₹100,000).
  - Capital allocated across multiple symbols according to well‑defined rules.
- Separate **realised vs unrealised** performance at the **portfolio level**, not just per symbol.
- Measure whether multi‑stock portfolio runs are **more profitable and better utilised** than single‑stock runs.

The long‑term aim is to bridge the gap between “nice backtest on one stock” and “how my real capital behaves across many instruments under broker constraints”.

---

## 2. Core Concepts

### 2.1 Stock Universe

Authoritative list of instruments:

- Fields (initial):
  - `symbol` (e.g. `HDFCBANK`),
  - `exchange` (e.g. `NSE`, `BSE`),
  - `segment` (e.g. `equity`, `fno` – future use),
  - `name` / `display_name`,
  - `sector` / `industry` (optional),
  - `tags` (e.g. `bank`, `nifty50`, `midcap`),
  - `is_active` flag.
- Behaviour:
  - Shared across Data, Backtests, Strategies, and (later) Live modules.
  - Stocks can be deactivated without deleting historical data.

### 2.2 Stock Groups

Named baskets of stocks created from the universe:

- Examples: `trending_stocks`, `high_potential_midcap`, `bank_nifty_constituents`.
- Each group:
  - `id`, `code`, `name`,
  - `description`,
  - `tags`,
  - Many‑to‑many link to Universe (`stock_group_members`).
- Initial scope:
  - **Static groups** (manually curated).
  - Future: rule‑based groups (e.g. all `tags` containing `midcap`).

### 2.3 Group Backtest (Portfolio Backtest)

A **group backtest** is a single run defined by:

- Strategy + parameter set (`strategy_id`, `params_id`),
- Target: either
  - `Single stock` (current behaviour), or
  - `Stock group` (new behaviour),
- Shared initial capital (e.g. ₹100,000),
- Shared risk & cost settings (max position size %, per‑trade risk %, broker model, MIS/CNC rules),
- Date range, interval, data source.

The engine must:

- Simulate signals for every symbol in the group.
- Apply **portfolio‑level capital and broker constraints**.
- Emit:
  - A **portfolio equity curve**,
  - A **portfolio trade log** (with `symbol` column),
  - Per‑symbol summary metrics.

---

## 3. Capital & Risk Behaviour (Group Runs)

### 3.1 Single Capital Pot

- `initial_capital` belongs to the **entire group**, not per stock.
- Risk config applies at the **portfolio level**:
  - `maxPositionSizePct` → max notional per position = `% * current portfolio equity`.
  - `perTradeRiskPct` → risk budget per trade based on current equity.
  - Broker constraints (MIS vs CNC, no overnight cash shorts) enforced globally:
    - MIS positions must be squared off by 15:15 IST.
    - No overnight shorts in CNC.

### 3.2 Signal Arbitration Across Stocks

At each bar:

- Each symbol may generate **one candidate entry** (or none), driven by the chosen strategy engine and its per‑symbol data.
- Each candidate has a **confidence** score:
  - For now: default `1.0` for all.
  - Future: model‑derived or rule‑based scores.

When multiple candidates compete for limited capital, we apply a **policy**:

1. `highestConfidenceSingle`
   - Pick the candidate with highest confidence (tie‑break deterministic or random).
   - Allocate position size based on portfolio risk rules.
   - Other candidates for that bar are skipped.

2. `allEligibleEqualWeight`
   - Split available buying power equally across all candidates.
   - For each candidate:
     - Compute how much capital is available to that stock,
     - Derive quantity from that capital and risk limits,
     - Skip if price > allocated capital (cannot afford 1 share).

This gives two useful modes:

- **“Best idea only”** – mimics picking the strongest signal per bar.
- **“Spread across all signals”** – tries to exploit breadth while honouring the capital pot.

### 3.3 Realised vs Unrealised PnL

For group backtests, portfolio PnL is decomposed as:

- `pnl_realised` – sum of net PnL from closed trades (after costs),
- `pnl_unrealised` – difference between portfolio mark‑to‑market and realised PnL,
- `pnl = pnl_realised + pnl_unrealised`,
- `pnl_what_if` – current open PnL if all open positions were closed at the last price (approximate).

The UI shows:

- `PnL: 3285.51 = 1200.00 (realised) + 2085.51 (unrealised)`,
- Plus per‑symbol breakdowns to see which stocks contribute most.

---

## 4. Functional Requirements (Incremental)

### 4.1 Stocks Page (New left‑nav entry)

**Universe tab**

- Table of stocks with:
  - Symbol, Exchange, Segment, Name, Sector, Tags, Active.
- Operations:
  - Add / edit / deactivate stock.
  - Optional CSV import (future).

**Groups tab**

- List of groups:
  - Name, Code, #Stocks, Tags.
- Operations:
  - Create/edit/delete group.
  - Add/remove members from Universe with multi‑select.
  - View members for a selected group.

### 4.2 Backtests – Target Type & Group Runs

- Run Backtest form:
  - New “Target” selector:
    - `Single stock` (existing symbol / coverage workflow),
    - `Stock group` (select group from dropdown).
  - For `Stock group`:
    - Shared:
      - Strategy + parameter set,
      - Initial capital,
      - Risk & cost settings,
      - Interval and date range.
    - Data mode:
      - v1: require coverage for each group symbol; report if some symbols had no data.
      - v2: “Fetch fresh data for all group stocks” (batch fetch).

- Backtest records:
  - Extend `Backtest` to include optional `group_id` and `universe_mode` (`"single"` / `"group"`).
  - `symbols_json` for group runs stores all symbols that actually participated.

### 4.3 Reporting & UI

For group backtests, Backtest Details page will show:

- **Summary**
  - Target: `Group – <group_name>`.
  - Interval, period, status.
  - Initial capital, final value.
  - `PnL` line with realised/unrealised breakdown.
  - Portfolio metrics (total return, max drawdown, Sharpe, etc.).
  - Position metrics: max concurrent positions, average capital utilisation.

- **Per‑symbol breakdown**
  - Table of:
    - Symbol,
    - #Trades,
    - Net PnL,
    - Max drawdown,
    - Win rate,
    - Avg win / loss,
    - Contribution to final portfolio PnL.

- **Trades table**
  - Existing trade log, but used as a **portfolio trade ledger**:
    - Symbol column remains,
    - Filters for symbol, side, date (future enhancement).

---

## 5. Implementation Approach (High‑Level)

1. **Data Model**
   - Add `stocks`, `stock_groups`, `stock_group_members` tables.
   - Extend `backtests` table with `group_id`, `universe_mode`.

2. **Engine Layer**
   - Phase 1:
     - Keep current single‑symbol Backtrader strategies.
     - Build a **Portfolio Simulator** that:
       - Runs strategy per symbol to get candidate trades,
       - Replays candidates in time order with shared capital/risk rules,
       - Produces final equity curve + executed trades.
   - Phase 2 (optional):
     - Explore multi‑data Backtrader strategies for tighter integration.

3. **Frontend**
   - Add **Stocks** page (universe + groups).
   - Extend Run Backtest to support `Single stock` vs `Stock group`.
   - Extend Backtest Details to present portfolio vs per‑stock metrics and PnL breakdown.

4. **Evaluation**

   - Compare:
     - Single‑stock backtests vs group backtests using the same strategy and capital.
   - Track:
     - Capital utilisation,
     - Risk (drawdowns, volatility),
     - Net PnL and risk‑adjusted returns.
   - Use this to judge whether multi‑stock strategies meaningfully improve profitability and robustness.

---

_This document is intentionally high‑level. Detailed schemas, engine design, and UI specs should be added as we open dedicated sprints for Stock Universe & Group Backtests (e.g. `S10`)._
