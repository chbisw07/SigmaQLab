# SigmaQLab – Capital‑Aware Signal Routing for Stock Groups

_PRD – portfolio simulator that allocates capital across group signals per bar._

---

## 1. Motivation & Goals

The initial **Stock Universe & Group Backtests** work lets a single strategy run across a group of stocks using a shared capital pot. However, the current portfolio simulator has important limitations:

- At most **one trade per timestamp** is opened, chosen mostly by symbol order.
- Signals from other stocks at the same bar are **ignored**, even if capital is available.
- Per‑symbol results in a group backtest can diverge sharply from their single‑stock counterparts, making portfolio runs hard to trust.

The true goal is:

> For each bar, route capital into the **best available signals across the group**, subject to shared capital & risk constraints, so that the group backtest approximates how a rational trader would use their money.

We call this **capital‑aware signal routing**.

High‑level objectives:

- Use **all viable signals** in a group, not just the first one.
- Honour portfolio‑level risk:
  - `maxPositionSizePct` (max notional per position),
  - `perTradeRiskPct` combined with stop‑loss distance,
  - broker constraints (MIS vs CNC, no overnight cash shorts).
- Prefer trades with **higher quality** (score) when capital is limited.
- Preserve interpretability: we must be able to explain why a trade was picked or skipped.

This is still backtesting (not full portfolio optimisation), but with a smarter allocator between many single‑stock strategy engines and a shared capital pot.

---

## 2. Current Behaviour (Problem Statement)

The current group backtest flow (see `stock_universe_group_backtests_prd.md` and `BacktestService._run_portfolio_simulator`) is:

1. Run the strategy engine for each symbol independently to generate **candidate trades** (`TradeRecord` with entry/exit times, side, size, etc.).
2. Collect candidate entries per timestamp `t`.
3. For each `t`:
   - Process exits scheduled at `t` (freeing capital).
   - Consider entries at `t`, but **open at most one trade**, breaking after the first candidate with non‑zero size.
4. Apply Zerodha‑style costs after the portfolio run.

Consequences:

- Many valid signals are **never used** in the portfolio, even when cash is idle.
- Per‑symbol trade sequences in a group run can differ substantially from the single‑stock runs (e.g. BSE alone vs BSE inside a group).
- Portfolio results can be dominated by:
  - Arbitrary symbol ordering,
  - Cost drag from many small trades, rather than strategy edge + capital routing.

We want to replace this with an allocator that:

- Considers **all** entries at a bar,
- Scores them,
- Allocates capital until **risk or cash runs out**, not after the first accepted trade.

---

## 3. Core Concepts

### 3.1 Candidate Trades (per symbol)

From the existing engine:

- A `TradeRecord` describes a **candidate round‑trip**:
  - `symbol`, `side` (`long` / `short`),
  - `size` (max feasible from single‑stock engine),
  - `entry_timestamp`, `entry_price`,
  - `exit_timestamp`, `exit_price` (or planned exit),
  - `entry_reason`, `exit_reason`.
- For group runs:
  - Each symbol in the group yields a list of such candidate trades over the test period.
  - The portfolio simulator **does not change entry/exit times**; it only decides **which candidates to actually fund and at what size**.

### 3.2 Portfolio State

At any time `t`, the simulator tracks:

- `cash` – free capital (cash in account).
- `positions` – map `symbol -> size` (positive = long, negative = short).
- `last_prices` – last known close per symbol for mark‑to‑market.

Derived:

- `equity = cash + Σ(size_s * last_price_s)` – total portfolio equity, including open positions.

### 3.3 Risk Config & Broker Constraints

From `risk_config` and `costs_config`:

- `maxPositionSizePct` – max notional per symbol:

  - `max_notional_per_symbol = equity * maxPositionSizePct / 100`.

- `perTradeRiskPct` – risk budget per trade:

  - `risk_capital = equity * perTradeRiskPct / 100`.
  - Combined with an effective stop‑loss distance, we size so:

    - `size * per_share_risk ≤ risk_capital`.

- Stop‑loss semantics:

  - If a default stop‑loss is configured:
    - **Custom** mode: `stopLossPct` (e.g. 3%).
    - **Auto** mode: `stopLossAtrMult * ATR` (converted to % of price).
  - If no default stop‑loss is applied:
    - `perTradeRiskPct` is ignored; only `maxPositionSizePct` and cash constrain size.

- Broker constraints:

  - **Product type** (`intraday` vs `delivery`/`auto`) comes from `costs_config.productType`.
  - `allowShortSelling` may be `true` only for MIS; delivery/cash is long‑only.
  - Intraday square‑off and “no overnight cash shorts” are enforced in the strategy engine; the portfolio simulator honours `allowShortSelling` and product type consistently.

---

## 4. Scoring & Allocation Policy

### 4.1 Scoring Function

For each entry candidate at bar `t`, we define a **score**:

```text
score = f(strategy_signal, price_context, volume, volatility, symbol_metadata)
```

Initial (v1) proposal — keep simple & interpretable:

- Components:
  - `trend_strength` – derived from strategy output (e.g., distance from Zero Lag band, SMA crossover strength).
  - `liquidity_factor` – based on recent average volume or turnover (penalise illiquid names).
  - `risk_factor` – penalise extremely volatile symbols (e.g., normalised ATR).
- Implementation detail:
  - Score is a float (higher is better).
  - All inputs are derived from **past and current data only**; no look‑ahead.
- Extensibility:
  - Later versions may incorporate RSI, MACD, Bollinger, VWAP, or external ranking signals.
  - The scoring function should be pluggable/configurable, not hard‑coded.

### 4.2 Per‑Bar Allocation Algorithm

For each timestamp `t` (after processing exits and updating prices):

1. Build the list of **entry candidates** at `t`: `C_t = {c_1, c_2, …, c_k}`.
2. For each `c_i`:
   - Compute `score_i`.
   - Compute `max_size_i` via `_compute_order_size` using:
     - current `equity`,
     - current `cash`,
     - `maxPositionSizePct`,
     - `perTradeRiskPct` + effective stop‑loss (if active),
     - `c_i.size` as a hard upper bound.
3. Filter to `C_t' = {c_i | max_size_i > 0}`.
4. Sort `C_t'` by `score_i` descending (then tie‑break deterministic: e.g. symbol, entry time).
5. Iterate `C_t'` in that order:
   - Recompute `equity` and `cash` as you accept trades (each accepted entry updates state).
   - For each candidate:
     - Recompute feasible `size` (since equity/cash may have changed).
     - If `size > 0`:
       - Open position:
         - debit/credit `cash`,
         - update `positions[symbol]`,
         - store `TradeRecord` with realised PnL determined at exit.
   - Stop when either:
     - All candidates have been considered, or
     - Optional cap on new positions per bar is reached (configurable; v1 can be “no cap”).

This replaces the current “pick first candidate and break” logic with **multi‑candidate, scored allocation**.

### 4.3 Capital Recycling

At each timestamp:

1. Process scheduled **exits** first:
   - Update `cash`, `positions`.
2. Then process **entries** with the algorithm above.
3. Record the new equity point.

Capital freed by exits at `t` is immediately available for new entries at `t`, giving natural capital recycling.

---

## 5. Behaviour vs Single‑Stock Backtests

With capital‑aware routing:

- Per‑symbol trade sequences in a group run should be closer to the union of each symbol’s single‑stock trades, moderated by capital/risk constraints.
- BSE inside a group:
  - Will still lose some trades when capital is exhausted or better‑scored stocks compete.
  - Should not be suppressed purely by alphabetical ordering or “one trade per bar” rules.
- Diagnostics from portfolio metrics:
  - `per_symbol` PnL and trade counts,
  - capital utilisation over time,
  - average number of positions per bar,
  - distribution of scores for executed vs skipped trades.

These diagnostics let us see whether our allocator is doing what we intend:

- Using capital aggressively but not recklessly,
- Preferring higher‑quality signals across the group,
- Avoiding systematic biases (e.g., always favouring one symbol).

---

## 6. Non‑Goals (for this PRD)

In scope:

- Routing capital across signals **within a single strategy** for a given group.
- Respecting existing risk_config and costs_config.
- Providing clear metrics and diagnostics.

Out of scope (for now):

- Full portfolio optimisation (choosing strategy mixes, rebalancing schedules, etc.).
- Dynamic position sizing based on higher‑level portfolio objectives (e.g. risk parity).
- Multi‑asset classes or derivatives‑specific constraints.

These belong to a separate **Portfolio Management / Optimisation PRD**.

---

## 7. Implementation Outline

1. **Scoring function**
   - Implement a first‑pass `score_candidate(trade, bar_context)` in `BacktestService`.
   - Use simple trend + liquidity + volatility factors.
   - Log scores alongside executed trades for debugging.

2. **Update `_run_portfolio_simulator`**
   - Replace single‑entry‑per‑bar logic with the multi‑candidate, scored allocation described above.
   - Keep existing risk and cost logic intact.

3. **Metrics & diagnostics**
   - Extend portfolio metrics with:
     - Average # positions per bar,
     - Capital utilisation,
     - Per‑symbol contribution.
   - Add optional debug export of `(timestamp, symbol, score, accepted/ignored)` rows.

4. **Validation**
   - Compare:
     - Single‑stock runs vs group runs for the same strategy + risk + costs.
   - Confirm:
     - BSE‑only backtest vs BSE inside group behaves consistently given capital/risk,
     - Group BT no longer suffers from arbitrary “first symbol wins” behaviour.

Once this is stable, we can layer more sophisticated scoring or incorporate portfolio‑level objectives, but the core routing semantics will stay the same.
