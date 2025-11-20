# SigmaQLab – User Manual (Data, Strategies, Backtests)

This manual explains how to use the main working areas of SigmaQLab today:

- Data Management – fetching and inspecting price data
- Strategies – defining strategy metadata and parameter sets
- Backtests – running backtests and reviewing recent runs

It focuses on **what each screen/field means** and a **practical workflow** you can follow.

---

## 0. Quick start – typical workflow

In the current version, a typical analysis flow is:

1. **Load data**
   - Use the **Data** page to fetch OHLCV bars into `sigmaqlab_prices.db` from Kite / yfinance (or CSV).
   - Confirm coverage in the summary table and preview charts.
2. **Define strategies + parameters**
   - Use the **Strategies** page to define a strategy (name, code, category, etc.).
   - Add one or more **parameter sets** as JSON (e.g. `{"fast": 10, "slow": 30}`).
3. **Run backtests**
   - Use the **Backtests** page to select a strategy + params, point it at a symbol/timeframe with data, choose dates and capital, and run.
   - Review the **Recent Backtests** table for completed runs, PnL, and final equity.

In other words: **Data → Strategy → Backtest**.

---

## 1. Data Management

Menu: **Data** (left navigation)

Purpose: manage historical price data stored in `sigmaqlab_prices.db` and quickly see what’s available for backtesting.

### 1.1 Fetch Data form

Left-hand card: **Fetch Data**

Controls and their meaning:

- **Symbol**
  - Free-text symbol, e.g. `HDFCBANK`, `RELIANCE`, `TEST`.
  - This symbol is used as-is as the `symbol` column in `price_bars` and is what backtests will refer to later.

- **Timeframe**
  - Choice of `1m`, `5m`, `15m`, `1h`, `1d`.
  - Matches the logical bar size you want to fetch and store.
  - Backtests will later ask for the same `timeframe` string.

- **Exchange**
  - Logical exchange label: `NSE`, `BSE`, `US`, `CRYPTO`.
  - This is stored in the `exchange` column so you can distinguish, for example, `HDFCBANK` on NSE vs. something on BSE or US.
  - At this stage it’s mainly metadata, but it’s important for future multi-exchange support.

- **Source**
  - `kite` – use Zerodha Kite historical API (requires valid API key + access token in backend `.env`).
  - `yfinance` – use Yahoo Finance data via the `yfinance` library.
  - `csv` – load from a local CSV file.
  - The Data Service normalizes all of these to a common internal OHLCV format.

- **Start date / End date**
  - Calendar inputs in `YYYY-MM-DD` format.
  - Define the inclusive **date window** to fetch.
  - Internally, the backend expands each date to full-day datetimes.

Behavior when you click **Fetch**:

1. The frontend calls `POST /api/data/fetch` with your inputs.
2. Backend resolves the provider:
   - `kite` → KiteConnect wrapper.
   - `yfinance` → yfinance client.
   - `csv` → direct CSV reader (expecting headers `timestamp,open,high,low,close,volume`).
3. It normalizes bars and writes them into `sigmaqlab_prices.db` (table `price_bars`):
   - If bars already exist for that `(symbol, timeframe, timestamp)` window, they are replaced to avoid duplicates.
4. You see a short message: e.g. *“Fetched 1234 bars for HDFCBANK (1d).”*
5. The **Coverage Summary** table is refreshed.

Common pitfalls / notes:

- If a provider is misconfigured (e.g. wrong Kite token), the API returns a clear error and the UI shows an error message instead of “Fetched X bars …”.
- If no bars are returned (e.g. empty CSV, no data for that date range), `bars_written` will be `0`: you’re not doing anything wrong; there’s just no data for that request.

### 1.2 Coverage Summary

Right-hand card in the top row: **Coverage Summary**

This table shows what’s currently stored in `sigmaqlab_prices.db`:

- **ID** – a stable coverage identifier of the form `SYMBOL_EXCHANGE_SOURCE_00000`. This is what the Backtests page uses when you select “Use existing coverage”.
- **Symbol** – logical symbol you used when fetching (e.g. `HDFCBANK`).
- **Exchange** – whatever you supplied in the fetch form (`NSE`, `BSE`, etc.).
- **Timeframe** – `1m`, `5m`, `1h`, `1d`, etc.
- **Source** – where the data came from (`kite`, `yfinance`, `local_csv`, etc.).
- **Start** – earliest timestamp we have for this `(symbol, exchange, timeframe, source)`.
- **End** – latest timestamp.
- **Bars** – total number of bars in that coverage window.

How it’s populated:

- The frontend calls `GET /api/data/summary` on load and after each fetch.
- The backend groups `price_bars` by `(symbol, exchange, timeframe, source)` and computes min/max timestamp and count, then attaches a synthetic `coverage_id` for each group.

Selection controls:

- Each row has a checkbox on the left; you can select any subset of rows.
- The header shows:
  - **Select All** – selects all coverage rows currently shown.
  - **Delete Selected** – deletes data for all selected rows after a confirmation dialog.

**Click behavior:**

- Clicking on any row triggers a preview request for that symbol/timeframe:
  - Calls `GET /api/data/{symbol}/preview?timeframe=...`.
  - The selection is reflected in the **Preview** panel title.

### 1.3 Preview (Price, Volume, Indicators)

Bottom card: **Preview [SYMBOL (TIMEFRAME)]**

What you see:

- A **candlestick chart** for price, with optional overlay indicators (e.g. SMA, EMA, Bollinger Bands, Donchian Channels).
- An optional **volume histogram** under the price chart, with green/red colouring for up/down bars.
- An optional **oscillator pane** for indicators like RSI or MACD.

Indicator controls:

- Just above the chart you can toggle indicator groups:
  - **Moving averages** – SMA(5), SMA(20), EMA(20), WMA(20), Hull MA(20).
  - **Trend / bands** – Bollinger(20), Donchian(20).
  - **Momentum / oscillators** – RSI(14), MACD(12,26,9), Momentum(10), ROC(10), CCI(20).
  - **Volume / volatility** – OBV, ATR(14), plus a **Volume bars** checkbox.
- Checking/unchecking these items updates the chart in-place.
- If you uncheck **Volume bars**, the volume histogram disappears, leaving just price + overlays.

Details:

- The backend returns a limited number of recent bars for preview (not the entire historical range).
- Each bar includes `timestamp`, `open`, `high`, `low`, `close`, `volume`, and `source`.
- The chart uses a tall, Moneycontrol-style layout so you can clearly see price swings and indicator behaviour.

Range shortcuts:

- In the Preview header you can quickly change the visible range without refetching data:
  - Intraday-style ranges: `1m`, `3m`, `5m`, `10m`, `30m`, `60m`, `1d`, `1w`.
  - Calendar-style ranges: `1M`, `3M`, `6M`, `1Y`, or `All`.
- These buttons adjust the chart’s time scale (zoom/pan) based on the last bar’s timestamp.

Tools and synchronisation:

- In the Indicators area there are two simple “tools”:
  - **Last price line** – draws a dashed reference line at the most recent price.
  - **Highlight latest bar** – adds a marker above the most recent candle.
- When oscillators are enabled, the price and oscillator charts stay time-synchronised:
  - Panning/zooming either pane keeps the other in the same time window.

Use this to sanity-check:

- That data looks continuous and sensible (no obvious bad spikes from CSV or provider glitches).
- That the symbol/timeframe you intend to backtest is populated before you go to the Backtests page.

---

## 2. Strategies

Menu: **Strategies**

Purpose: define your **strategy catalog** and manage **parameter sets**. Strategies are metadata entries; they are not code here. The actual trading logic lives in the backtest engine (e.g. mapped by `code`).

### 2.1 Strategies list

Left-hand column: **Strategies** table + **New Strategy** form.

Strategies table columns:

- **Name** – human-friendly name (e.g. “SMA Crossover Test”).
- **Code** – short identifier used for engine wiring (e.g. `SMA_X`). This is what backtests use to choose logic.
- **Status** – lifecycle status (e.g. `experimental`, `candidate`, `live`, etc.).
- **Category** – high-level type (e.g. `trend`, `mean_reversion`, `overlay`).

Behavior:

- Clicking a row selects that strategy and loads its details + parameter sets on the right.
- The selected row is visually highlighted.

### 2.2 New Strategy form

Under the list: **New Strategy** form.

Fields:

- **Name** – descriptive name.
- **Code**
  - Uppercased automatically as you type.
  - Must be unique; used by the backtest engine (`strategy.code` → engine registry key).
  - For example, `SMA_X` is wired to a simple SMA crossover in Backtrader.
- **Category** – free text, but you can follow PRD suggestions like `trend`, `mean_reversion`, `breakout`, etc.

On submit:

- Sends `POST /api/strategies` with:
  - Provided `name`, `code`, `category`.
  - Default status `experimental`, `live_ready = false`, other fields `null`.
- If success:
  - Appends strategy to the table.
  - Selects it in the details panel.
  - Shows a short success message.
- If code already exists:
  - Backend returns `409 Conflict` with a clear message (displayed under the form).

### 2.3 Strategy Details panel

Right-hand card: **Strategy Details**

Top section:

- Shows **Name (Code)**.
- Buttons:
  - **Edit** – switch into inline edit mode for basic metadata.
  - **Delete** – deletes this strategy and all its parameter sets (after confirmation).

Edit mode:

- Editable fields:
  - **Name**
  - **Status**
  - **Category**
- On Save:
  - Sends `PUT /api/strategies/{id}`.
  - Updates the list and details panel.

Metadata chips:

- Small chips showing:
  - `status` (e.g. `experimental`, `candidate`).
  - `category` (e.g. `trend`).
  - `Live-ready` if `live_ready == true`.

Other fields (when present):

- **Description** – free text explanation of the strategy.
- **Tags** – list of string tags (e.g. `["intraday", "nifty"]`) shown as chips.
- **Integration metadata**:
  - **SigmaTrader ID** – link to any external ID you use in SigmaTrader.
  - **TradingView template** – name of the TV layout / script template associated with this strategy.

Deletion:

- Clicking **Delete**:
  - Confirms in a browser dialog.
  - Sends `DELETE /api/strategies/{id}`.
  - Removes the strategy from the left table and clears details + param sets.

### 2.4 Parameter sets

Lower part of the Strategy Details panel: **Parameter sets** table + form.

Concept:

- A **parameter set** is a named JSON blob attached to a strategy (e.g. `default`, `aggressive`, `conservative`).
- It defines the numeric (or other) parameters the backtest engine expects for that strategy code.

Table columns:

- **Label** – human label (e.g. `default`, `aggressive`).
- **Params** – truncated pretty-printed JSON (full JSON is visible in the edit form).
- **Notes** – free text notes.
- **Created** – timestamp when the parameter set was created.
- Actions:
  - **Edit** – loads the row into the form below for modification.
  - **Delete** – removes the parameter set (after confirmation).

New / Edit parameter form:

- Fields:
  - **Label** – name; defaults to `"default"` if empty.
  - **Params JSON** – multi-line text field containing JSON, e.g. `{"fast": 10, "slow": 30}`.
  - **Notes** – optional comments about the parameter set.

Behavior:

- On submit:
  - Validates that `Params JSON` is valid JSON; if not, shows an error.
  - When **creating**:
    - Calls `POST /api/strategies/{strategy_id}/params`.
    - Appends the new row to the table.
  - When **editing**:
    - Calls `PUT /api/params/{id}`.
    - Replaces the row in the table.
- Delete:
  - Calls `DELETE /api/params/{id}` and removes the row from the table.

Relation to Backtests:

- Backtests can refer to a parameter set via `params_id` in the **Backtests** page.
- You can also override or extend parameters per-backtest using **Override params JSON** on the Backtests form (see next section).

---

## 3. Backtests

Menu: **Backtests**

Purpose: configure and run a single backtest against stored historical data, and review recent runs.

Prerequisites:

- At least one **Strategy** with a meaningful `code` already defined.
  - For example, `SMA_X` has a Backtrader implementation in the backend engine.
- Sufficient **price data** for your target symbol/timeframe in `sigmaqlab_prices.db` (via the Data page).

### 3.1 Run Backtest form

Left-hand column: **Run Backtest**.

Controls:

- **Strategy**
  - Drop-down populated from `GET /api/strategies`.
  - Items shown as `CODE – Name` (e.g. `SMA_X_API – SMA API Test`).
  - When you pick a strategy, the backend automatically chooses its default parameter set (e.g. `api_default`) for the run.

- **Data mode**
  - `Use existing coverage` – run against OHLC data already stored in the DB, identified by a coverage ID from the Data page.
  - `Fetch fresh data` – fetch new OHLC data just for this run, then store it for reuse.

- **Coverage ID** (when *Use existing coverage* is selected)
  - Drop-down listing coverage IDs from **Coverage Summary**, e.g. `HDFCBANK_NSE_kite_00000`.
  - Each entry shows `ID – SYMBOL TIMEFRAME SOURCE`.
  - When you pick one, the form derives symbol, timeframe, date range, and source from that coverage and uses them for the backtest.

- **Symbol / Exchange / Interval / Dates** (when *Fetch fresh data* is selected)
  - **Symbol** – e.g. `HDFCBANK`.
  - **Exchange** – `NSE`, `BSE`, `US`, `CRYPTO`.
  - **Interval** – `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `1d` (same values as Data → Timeframe).
  - **Start date / End date** – same semantics as the Data page; defines the bar window.
  - Before running the backtest, the backend calls `POST /api/data/fetch` with these values so the prices DB is up to date.

- **Initial capital**
  - Starting cash in the backtest (e.g. `100000`).
  - The Backtrader engine uses this as the broker’s initial equity.

- **Price source label**
  - Drop-down: `prices_db`, `kite`, `yfinance`, `synthetic`, `csv`, etc.
  - This is metadata only, stored as `data_source` on the Backtest row to remind you which upstream source you used when you fetched data.

- **Override params JSON (optional)**
  - Multi-line JSON text area.
  - When provided, these key/value pairs are merged **on top of** the selected strategy’s default parameter set.
  - Example: if the default params are `{"fast": 5, "slow": 20}` and you override with `{"slow": 30}`, the effective params will be `{"fast": 5, "slow": 30}`.

What happens when you click **Run backtest**:

1. If **Fetch fresh data** is selected:
   - The frontend first calls `POST /api/data/fetch` with your symbol/exchange/interval/date range, then reloads `GET /api/data/summary`.
2. The frontend constructs a payload and calls `POST /api/backtests`:
   - Includes `strategy_id`, default `params_id`, effective symbol/timeframe/start/end, initial capital, optional `params` (overrides), and `price_source` label.
3. Backend `BacktestService`:
   - Loads the `Strategy` from `sigmaqlab_meta.db` and resolves the engine implementation.
   - Loads the chosen parameter set and merges JSON parameters + overrides.
   - Loads OHLCV bars from `sigmaqlab_prices.db` for the derived symbol/timeframe/date window.
   - Runs the Backtrader engine and persists a `Backtest` row with metrics, configs, and status `completed`.
4. The API returns the created Backtest record.
5. The frontend:
   - Shows a summary message (ID, PnL, final value).
   - Adds the new backtest to the top of the **Recent Backtests** table.

Error scenarios:

- No price data in the DB for the given symbol/timeframe/date window → HTTP 400 with a clear message.
- Invalid or unknown strategy code (not in engine registry) → HTTP 400.
- Backtrader not installed in the backend environment → HTTP 500 with an explicit message.

### 3.2 Recent Backtests table

Right-hand column: **Recent Backtests**

Populated by `GET /api/backtests` on page load and updated when new runs complete.

Columns:

- **(Checkbox)** – per-row selection for bulk delete.
- **ID** – primary key of the `backtests` record.
- **Strategy** – derived from `strategy_id` by looking up the current strategies (`CODE – Name`).
- **Symbol(s)** – shows:
  - Just the symbol when there is one (e.g. `TESTBT`).
  - `SYMBOL +N` when there are more (multi-symbol runs in future).
- **Timeframe** – `1d`, etc.
- **Status** – backend status (`completed` today; future: `pending`, `failed`, etc.).
- **PnL** – taken from `metrics.pnl` if present, rendered with sign and two decimals (e.g. `+1000.00`).
- **Final value** – taken from `metrics.final_value` if present (final account value).
- **Created** – timestamp of when the Backtest row was created, formatted in IST.

Toolbar controls:

- **Select page** – selects all rows on the current page.
- **Delete selected** – deletes all selected backtests (with a confirmation dialog).
- Pagination controls: `<<`, `<`, page size, `>`, `>>` let you navigate through your history.

Usage tips:

- This table is your quick “audit log” of what you’ve run recently.
- Delete old or experimental runs to keep the list manageable; this also cleans up their equity/trade rows.

### 3.3 Backtest Details – chart, trades, settings

Below the main grid: **Backtest Details – #ID**.

Summary column:

- Shows core metadata and metrics for the selected backtest:
  - Strategy name/code.
  - Symbols, timeframe, status.
  - Initial capital, final value, PnL, total return, max drawdown.
  - Trade count, win rate, average win/loss.
  - Parameters JSON for the parameter set used.
- A **Settings** button opens a modal for per-backtest settings (see below).

Price & Trades chart:

- Uses the same `lightweight-charts` theme as the Data preview.
- Upper pane:
  - Candlestick price chart with volume histogram at the bottom (toggleable).
  - Trade markers:
    - Entry (`E`) and exit (`X`) markers at the appropriate bars, coloured by side (long/short).
- Lower pane:
  - Realised equity curve for the backtest.
  - Optional “projection” curve showing what equity would look like if trades were held from entry until each bar (unrealised potential).
- Panning/zooming and the time scale are synchronised between panes.

Trades section:

- **Export CSV** button:
  - Opens `/api/backtests/{id}/trades/export`, which downloads all trades as CSV with PnL and what-if fields.
- **Show trades table / Hide trades table** toggles a detailed table of executed trades:
  - Columns include:
    - ID, Symbol, Side, Size.
    - Entry/Exit timestamps and prices.
    - PnL and PnL %.
    - Equity at exit (funds balance).
    - What-if PnL, capture %, and cumulative PnL across trades.

Backtest Settings modal:

- Opened via the **Settings** button in the Backtest Details header.
- Tabs:
  - **Inputs** – read-only view of the parameter set used for this run.
  - **Risk** – metadata for risk assumptions:
    - Max position size %, per-trade risk %, default stop-loss / take-profit, allow short selling.
  - **Costs** – metadata for commissions, slippage, and other charges.
  - **Visualization** – toggles for:
    - Show trade markers.
    - Show projection curve.
    - Show volume histogram.
  - **Meta / Notes** – editable label and free-form notes for this backtest.
- When you click **Save**:
  - The modal calls `PATCH /api/backtests/{id}/settings`.
  - Updated settings are persisted on the Backtest record and immediately reflected in the chart and details panel.

> Note: Risk and cost settings are currently stored as metadata and used for analysis/documentation; the engine math itself still uses the simpler commission/slippage assumptions defined in the Backtest Overhaul backend. Future sprints can wire these fields directly into the engine.

---

## 4. Putting it all together (example)

One practical way to use the system now:

1. **Load data on the Data page** for `HDFCBANK` (or another symbol) and confirm you see a coverage row with a clear coverage ID.
2. **Create or reuse a strategy** in the Strategies page and make sure it has a default parameter set (e.g. `api_default`).
3. **On Backtests → Run Backtest**:
   - Strategy: pick your strategy.
   - Data mode: “Use existing coverage”.
   - Coverage ID: pick the ID you just created on the Data page.
   - Initial capital: choose a value (e.g. `100000`), set any override params if needed, and run.
4. Inspect the **Recent Backtests** table, open **Backtest Details**, and:
   - Use the chart to see entries/exits, equity, and projection.
   - Export the trades CSV if you want to analyse in Excel.
   - Use the **Settings** modal to document risk assumptions and favourite visual toggles for this run.
