# Zero Lag Trend Strategy (MTF) – Design Notes

This document captures the design for implementing the TradingView strategy
`zero_lag_trend_strategy_mtf.pine` inside SigmaQLab as a Backtrader engine
(`ZeroLagTrendMtfStrategy`) plus supporting tests and integrations.

It is intentionally implementation‑oriented but does **not** contain Python code;
it is the blueprint for the S09 tasks.

---

## 1. Pine Script Overview

Source: `ref_strategy_code/zero_lag_trend_strategy_mtf.pine`

### 1.1 Strategy metadata

- `strategy("Zero Lag Trend Strategy (MTF) [AlgoAlpha]", ...)`
  - `overlay = true` – plotted on price chart.
  - `initial_capital = 100000`.
  - `default_qty_type = strategy.cash`, `default_qty_value = 20000`.
  - `pyramiding = 1` (but see custom pyramiding logic below).

### 1.2 User inputs

**Main Calculations**

- `length:int = 70` – look‑back window for zero‑lag EMA.
- `mult:float = 1.2` – band multiplier controlling band thickness.

**Extra Timeframes (MTF inspection only)**

- `t1 = "5"`, `t2 = "15"`, `t3 = "60"`, `t4 = "240"`, `t5 = "1D"`.
  - Used to show trend state on multiple timeframes in a table.
  - Not directly used for entry/exit decisions in this version.

**Appearance**

- `bullColor` – default `#00ffbb`.
- `bearColor` – default `#ff1100`.

**Risk Management**

- `stopLossPerc: float = 2.0` – stop loss as % of entry price.
- `takeProfitPerc: float = 4.0` – take profit as % of entry price.

**Behaviour**

- `takeLongOnly: bool = false` – if true, no new short entries are opened.

### 1.3 Core calculations

Variables:

- `src = close`.
- `lag = floor((length - 1) / 2)`.
- `zlema = ema(src + (src - src[lag]), length)` – zero‑lag EMA approximation:
  - Uses a de‑lagged price (`src + (src - src[lag])`) before EMA.
- `volatility = highest(atr(length), length * 3) * mult` – a smoothed ATR‑based
  band width (max ATR over a 3×length window, scaled by `mult`).

Trend state:

- `var trend = 0` – persistent integer state.
- If `crossover(close, zlema + volatility)` → `trend := 1` (bullish).
- If `crossunder(close, zlema - volatility)` → `trend := -1` (bearish).
  - Between crossovers, trend stays at ±1.

### 1.4 Visuals (bands, arrows, MTF table)

Main band:

- Basis line: `plot(zlema, ...)` with colour based on `trend`.
- Upper band: `zlema + volatility` when `trend == -1` (bearish regime).
- Lower band: `zlema - volatility` when `trend == 1` (bullish regime).
- `fill(...)` calls colour background between price and bands to create
  bull/bear zones.

Reversal arrows:

- `plotshape(crossunder(trend, 0))` above price for bearish trend start.
- `plotshape(crossover(trend, 0))` below price for bullish trend start.

Optional minor arrows:

- `plotchar(crossover(close, zlema) and trend == 1 and trend[1] == 1, ...)`
  for bullish entry hints.
- `plotchar(crossunder(close, zlema) and trend == -1 and trend[1] == -1, ...)`
  for bearish entry hints.
- These are **not** used in actual strategy entry/exit, only visual hints.

MTF table:

- For each timeframe `t1…t5`, script does `request.security(syminfo.tickerid, tx, trend)`
  to get the `trend` state on that higher timeframe.
- Converts to `"Bullish"` / `"Bearish"` and prints in a table when `barstate.islast`.
- Again, purely informational in current logic; no cross‑timeframe filters.

### 1.5 Trading logic

Reversal detection:

- `bullReversal = crossover(trend, 0)` (‑1 → +1).
- `bearReversal = crossunder(trend, 0)` (+1 → ‑1).

Current entry logic (commented original replaced by CB custom logic):

- Original (commented):
  - On bullReversal: `strategy.close_all(); strategy.entry("Long", long)`.
  - On bearReversal: same but for short (if `not takeLongOnly`).
- Current logic:

```pine
pyramidLimit = 2

if bullReversal
    strategy.close("Short")
    if strategy.position_size < pyramidLimit
        strategy.entry("Long", strategy.long)

if bearReversal and not takeLongOnly
    strategy.close("Long")
    if strategy.position_size > -pyramidLimit
        strategy.entry("Short", strategy.short)
```

Notes:

- `pyramidLimit` is a manual cap on the absolute position size (in units, not
  number of entries). It must conceptually match `pyramiding` in the
  `strategy()` call.
- On each reversal:
  - Opposite side is closed.
  - A new position in the direction of the new trend is added, respecting
    pyramidLimit for net position.
- Long‑only mode:
  - `bearReversal` block is skipped if `takeLongOnly` is true; short positions
    are never opened.

Exits:

```pine
longStopPrice = avg_price * (1 - stopLossPerc/100)
longProfPrice = avg_price * (1 + takeProfitPerc/100)
strategy.exit(\"Long Exit\", \"Long\", stop=longStopPrice, limit=longProfPrice)

shortStopPrice = avg_price * (1 + stopLossPerc/100)
shortProfPrice = avg_price * (1 - takeProfitPerc/100)
strategy.exit(\"Short Exit\", \"Short\", stop=shortStopPrice, limit=shortProfPrice)
```

- Continuous stop/target orders are attached for both directions based on the
  current `strategy.position_avg_price`.
- Pine will manage exits automatically when price hits stop/limit.

---

## 2. Backtrader Engine Design – ZeroLagTrendMtfStrategy

### 2.1 High‑level goals

- Implement a Backtrader strategy that:
  - Reproduces the zero‑lag band and trend state.
  - Uses trend reversals as trade triggers with similar pyramiding behaviour.
  - Applies simple percentage‑based stops and targets per position.
  - Emits enough internal state (zlema, bands, trend, reversals) for
    `/api/backtests/{id}/chart-data` to draw the band and markers.
- Integrates cleanly with existing engine infrastructure:
  - `BacktestConfig.strategy_code` / `STRATEGY_REGISTRY`.
  - `BacktestService`’s metrics, trades, and equity curve handling.

### 2.2 Proposed Backtrader params

`ZeroLagTrendMtfStrategy(bt.Strategy)` params (initial proposal):

- `length: int = 70`
- `mult: float = 1.2`
- `stop_loss_pct: float = 2.0`
- `take_profit_pct: float = 4.0`
- `take_long_only: bool = False`
- `pyramid_limit: int = 2`
- Optional MTF diagnostic params (for later use/UI only):
  - `tf1, tf2, tf3, tf4, tf5: str` corresponding to Pine’s `t1…t5`.

These match Pine defaults so a “TV‑parity” parameter set can be defined
directly from the script.

### 2.3 Internal state and indicators

Within `__init__`:

- Compute zero‑lag EMA:

  - Backtrader does not natively support the `src + (src - src[lag])` form, so
    we will either:
    - Implement a custom indicator that replicates the exact formula, or
    - Pre‑compute a “de‑lagged” close series using `bt.indicators` / manual
      buffers.

- ATR‑based `volatility`:

  - Use `ATR(period=length)` followed by a `Highest` over `length*3` bars to
    mirror `highest(atr(length), length*3)`.

- Trend state:

  - Maintain an integer `self.trend` updated each bar:
    - +1 when `close` crosses above `zlema + volatility`.
    - ‑1 when `close` crosses below `zlema - volatility`.
  - Detect reversals using explicit checks:
    - `bull_reversal = self.trend_prev == -1 and self.trend == 1`.
    - `bear_reversal = self.trend_prev == 1 and self.trend == -1`.

- Per‑bar tracking:

  - `self.zlema`, `self.band_upper`, `self.band_lower` arrays (or attributes)
    so chart-data can reconstruct the band easily.
  - Internal record of `trend` per bar for MTF diagnostics and chart colouring.

### 2.4 Order logic mapping

Position sizing:

- For now, use a fixed cash or percentage of portfolio consistent with the
  current Backtrader engine conventions (e.g. default “all‑in” or a fixed
  stake). Mapping Pine’s `strategy.cash` amount exactly is a **nice‑to‑have**,
  not a hard requirement for first parity tests.

Entries:

- On `bull_reversal`:
  - Close any open short (if size < 0).
  - If `position.size < pyramid_limit`:
    - Issue `buy()` order (could be 1 unit or a stake; see sizing above).
- On `bear_reversal`:
  - If `take_long_only` is true:
    - Close any open long but do not open a short (optional).
  - Else:
    - Close any open long (if size > 0).
    - If `position.size > -pyramid_limit`:
      - Issue `sell()` (or `sell`/`short`) to increase short exposure.

Stops and targets:

- For each direction, approximate Pine’s `strategy.exit` with Backtrader order
  management:
  - When a new position is opened, place corresponding stop/limit orders using
    either:
    - Bracket orders (`buy_bracket` / `sell_bracket`), or
    - Manual checks in `next()` that close positions when price breaches
      stop/target levels.
- The Backtrader strategy should recompute stop/target levels based on
  `position.price` and `stop_loss_pct` / `take_profit_pct`, in line with how
  Pine uses `strategy.position_avg_price`.

Pyramiding:

- Track `self.position.size` in contracts.
- Use `pyramid_limit` as a hard cap on absolute `position.size`:
  - For example, if each entry adds +1 (long) or ‑1 (short):
    - Allowed sizes: `-pyramid_limit … +pyramid_limit`.
  - If a different sizing scheme is used (e.g. `stake`), we will document how
    `pyramid_limit` should be interpreted and test it against reference
    results.

### 2.5 Data requirements and MTF handling

Single‑timeframe operation:

- The trading logic as written does **not** use the MTF table for decisions,
  only for display.
- First implementation will treat ZeroLagTrendMtfStrategy as a
  single‑timeframe strategy:
  - Execute strictly on the primary timeframe bars loaded by
    `BacktestService`.

MTF diagnostics (phase 2):

- Once core parity is achieved, we can optionally:
  - Pre‑compute trend on additional timeframes in a separate preprocessing
    step; or
  - Maintain multiple Backtrader data feeds (higher timeframes) and compute
    trend per feed.
- For S09, we only need to design how/where MTF trend states would be exposed
  in `/api/backtests/{id}/chart-data` if we decide to use them:
  - e.g. `indicators["zl_trend_tf_5m"] = ...` series of +1/‑1 for each bar.

### 2.6 Engine integration and registry

- `STRATEGY_REGISTRY` in `backend/app/backtest_engine.py` will be extended to
  include:
  - `"ZeroLagTrendMtfStrategy": ZeroLagTrendMtfStrategy`
  - Optionally alias codes for SigmaQLab strategies, e.g.
    `"ZLAG_MTF"` → `ZeroLagTrendMtfStrategy`.
- `Strategy.engine_code` for any Zero Lag strategies in the meta DB will be set
  to `"ZeroLagTrendMtfStrategy"`.
- `BacktestService` will treat this engine identically to others:
  - Build `BacktestConfig(strategy_code=engine_code, params=resolved_params)`.
  - Metrics, equity points, and trades will be processed through the existing
    Overhaul pipeline (S06).

---

## 3. Verification Plan (for S09_G01_TB003 and G02 tasks)

### 3.1 Reference cases

To be defined with user input (TV runs), but the structure is:

- For each reference case:
  - Symbol (e.g. `HDFCBANK`).
  - Exchange (e.g. `NSE`).
  - Timeframe (e.g. `1h` or `1D`).
  - Date range (start/end).
  - Parameter set (length, mult, stopLossPerc, takeProfitPerc, takeLongOnly,
    pyramidLimit).
  - TradingView benchmark metrics:
    - Total closed trade count.
    - Net profit in currency or %.
    - Max drawdown (equity or balance).
    - Optionally, a short list of representative trades (entry/exit dates,
      side).

These can be stored later as a small JSON/YAML file or hard‑coded in the tests.

### 3.2 Pytest harness design

Planned tests (S09_G02_TB003/TB004):

- **Metric parity test**
  - Fetch or synthesise OHLCV data for the reference symbol/timeframe
    (preferably from Kite to match TV as closely as possible).
  - Run `BacktestService` with a strategy/params referencing
    `ZeroLagTrendMtfStrategy`.
  - Compare:
    - `trade_count` vs benchmark trades (exact match or within ±1).
    - `pnl` vs benchmark net profit (within small tolerance).
    - `max_drawdown` vs benchmark (within tolerance).
- **Signal alignment test**
  - For a short date window (e.g. 50–100 bars), collect the sequence of trades
    from `BacktestService` and compare entry/exit timestamps (date + bar index)
    with a curated list from TV.
  - We do not need tick‑level equality; we care that the major swing entries
    and reversals occur at similar bars.

Both tests will be marked as integration‑style tests and can be skipped in
environments where the required data or reference metrics are unavailable.

---

## 4. Open Questions / Future Enhancements

1. **Exact position sizing parity with TradingView**
   - The Pine script uses `default_qty_type=strategy.cash` and
     `default_qty_value=20000`. We may:
     - Approximate with a fixed `stake` in Backtrader; or
     - Implement a broker wrapper that mimics cash‑based sizing.
   - Decision: first iteration may prioritise signal/metric shape parity over
     exact per‑trade notional.

2. **Multi‑timeframe filtering**
   - Currently, the MTF table is informational only. If you later want
     conditions like “only trade when higher‑timeframe trend agrees with
     lower‑timeframe trend”, this will require:
     - Additional MTF data in the engine; and
     - Extended chart‑data and UI handling.

3. **Partial closes / more complex exits**
   - Pine’s `strategy.exit` can in theory be layered with additional logic;
     Backtrader translation may need refinement if you later introduce
     partial exits or dynamic trailing stops.

4. **Performance**
   - For single‑symbol runs the current design is fine. If Zero Lag becomes
     part of larger parameter sweeps, a future vectorised implementation could
     be considered.

These questions are intentionally left for later phases so that S09 can focus
on a faithful, stable first implementation aligned with the existing
Backtest Overhaul architecture.
