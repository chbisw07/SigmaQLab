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

- **Symbol** – logical symbol you used when fetching (e.g. `HDFCBANK`).
- **Exchange** – whatever you supplied in the fetch form (`NSE`, `BSE`, etc.).
- **Timeframe** – `1m`, `5m`, `1h`, `1d`, etc.
- **Start** – earliest timestamp we have for this `(symbol, exchange, timeframe)`.
- **End** – latest timestamp.
- **Bars** – total number of bars in that coverage window.

How it’s populated:

- The frontend calls `GET /api/data/summary` on load and after each fetch.
- The backend groups `price_bars` by `(symbol, exchange, timeframe)` and computes min/max timestamp and count.

**Click behavior:**

- Clicking on any row triggers a preview request for that symbol/timeframe:
  - Calls `GET /api/data/{symbol}/preview?timeframe=...`.
  - The selection is reflected in the **Preview** panel title.

### 1.3 Preview (Price + Volume)

Bottom card: **Preview [SYMBOL (TIMEFRAME)]**

What you see:

- **Top chart** – line chart of closing prices over time.
- **Bottom chart** – bar chart of volumes over time.

Details:

- The backend returns a limited number of recent bars for preview (not the entire historical range).
- Each bar includes `timestamp`, `open`, `high`, `low`, `close`, `volume`, and `source`.
- The charts hide X-axis text for readability but show exact timestamps in the tooltip.

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
  - Choosing a strategy drives which parameter sets appear in the next field.

- **Parameter set (optional)**
  - Drop-down populated via `GET /api/strategies/{strategy_id}/params`.
  - Includes a `None` option (no saved parameter set).
  - When selected, the corresponding parameters are used as the base configuration for the strategy.

- **Symbol**
  - The symbol the backtest will trade, e.g. `HDFCBANK`, `TESTBT`.
  - Must match the symbol you used when fetching data (for the same timeframe).

- **Timeframe**
  - Choice of `1m`, `5m`, `15m`, `1h`, `1d`.
  - Must match the timeframe of the stored data you want to backtest.

- **Start date / End date**
  - Date pickers specifying the period of the backtest.
  - The engine will load bars from `sigmaqlab_prices.db` with timestamps between these dates (inclusive).

- **Initial capital**
  - Starting cash in the backtest (e.g. `100000`).
  - The Backtrader engine uses this as the broker’s initial equity.

- **Price source label**
  - Drop-down: `prices_db`, `kite`, `yfinance`, `synthetic`, `csv`, etc.
  - This does **not** change where data is loaded from (it always comes from `sigmaqlab_prices.db`); it is purely a metadata tag stored as `data_source` in the Backtest record so you know which upstream source you used when the data was fetched.

- **Override params JSON (optional)**
  - Multi-line JSON text area.
  - When provided, these key/value pairs are merged **on top of**:
    1. The selected parameter set’s JSON (if `Parameter set` is chosen), then
    2. The inline overrides you type here.
  - Example: if the parameter set is `{"fast": 10, "slow": 30}` and you override with `{"slow": 20}`, the effective params will be `{"fast": 10, "slow": 20}`.

What happens when you click **Run backtest**:

1. The frontend constructs a payload and calls `POST /api/backtests`:
   - Includes `strategy_id`, optional `params_id`, symbol, timeframe, start/end dates, initial capital, optional `params` (overrides), and `price_source` label.
2. Backend `BacktestService`:
   - Loads the `Strategy` from `sigmaqlab_meta.db` (checks for a known `code` in the engine registry).
   - Loads `StrategyParameter` (if `params_id` is provided) and merges JSON parameters.
   - Loads OHLCV bars for `(symbol, timeframe, start, end)` from `sigmaqlab_prices.db`.
   - Runs the Backtrader engine (`SmaCrossStrategy` for `SMA_X` / its variants).
   - Persists a `Backtest` row with basic metrics (`final_value`, `pnl`, etc.) and status `completed`.
3. The API returns the created Backtest record.
4. The frontend:
   - Shows a short summary message (ID, PnL, final value).
   - Adds the new backtest to the top of the **Recent Backtests** table.

Error scenarios:

- No price data in the DB for the chosen symbol/timeframe/date window → HTTP 400 with a clear message.
- Invalid or unknown strategy code (not in engine registry) → HTTP 400.
- Backtrader not installed in the backend environment → HTTP 500 with an explicit message.

### 3.2 Recent Backtests table

Right-hand column: **Recent Backtests**

Populated by `GET /api/backtests` on page load and updated when new runs complete.

Columns:

- **ID** – primary key of the `backtests` record.
- **Strategy** – derived from `strategy_id` by looking up the current strategies (`CODE – Name`).
- **Symbol(s)** – shows:
  - Just the symbol when there is one (e.g. `TESTBT`).
  - `SYMBOL +N` when there are more (multi-symbol runs will be supported later).
- **Timeframe** – `1d`, etc.
- **Status** – backend status (`completed` today; future: `pending`, `failed`, etc.).
- **PnL** – taken from `metrics.pnl` if present, rendered with sign and two decimals (e.g. `+1000.00`).
- **Final value** – taken from `metrics.final_value` if present (final account value).
- **Created** – timestamp of when the Backtest row was created, formatted via `toLocaleString`.

Usage tips:

- This table is your quick “audit log” of what you’ve run recently.
- You can run multiple parameter sets or date ranges and compare PnL and final value side by side.
- In later sprints, dedicated detail views (equity curve, trades, etc.) will hang off each backtest ID.

---

## 4. Putting it all together (example)

Here is a small concrete example you can replicate:

1. **Load test data**
   - Go to **Data**.
   - Symbol: `TESTBT`
   - Timeframe: `1d`
   - Exchange: `NSE`
   - Source: `yfinance` (or `kite`, if configured)
   - Start date / End date: choose a 1–2 month window.
   - Click **Fetch** and confirm `bars_written > 0` and you see `TESTBT` in Coverage Summary.

2. **Create strategy + params**
   - Go to **Strategies**.
   - New Strategy:
     - Name: `SMA API Test`
     - Code: `SMA_X_API`
     - Category: `trend`
   - In Strategy Details → Parameter sets:
     - Add parameter set:
       - Label: `api_default`
       - Params JSON: `{"fast": 5, "slow": 20}`
       - Notes: `Basic SMA cross.`

3. **Run backtest**
   - Go to **Backtests**.
   - Strategy: `SMA_X_API – SMA API Test`.
   - Parameter set: `api_default`.
   - Symbol: `TESTBT`.
   - Timeframe: `1d`.
   - Start date / End date: same range as your fetched data.
   - Initial capital: `100000`.
   - Price source label: `prices_db`.
   - Override params JSON: leave empty (or tweak e.g. `{"slow": 30}`).
   - Click **Run backtest**.
   - Check the right-hand **Recent Backtests** table for a new row with `status=completed` and PnL / final value.

This flow exercises **all three** areas of the app and matches the screenshot you shared. As the platform grows (portfolio-aware backtests, optimization, etc.), these three pages will remain the core building blocks.
