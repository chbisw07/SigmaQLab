Below is **File 11**, the complete specification for **Data Models & Schema** for SigmaQLab’s Factor & Portfolio Construction v1 system.

Save as:

```
docs/PRD_Factor_Portfolio_v1/11_Data_Models_and_Schema.md
```

This file covers:

* All database tables
* Relationships
* Field definitions
* Keys & indexing
* How factors, risk data, portfolios, backtests, groups, weights, constraints, and metrics are stored
* Data integrity rules
* Query and access patterns

This is essential for backend implementation and long-term scalability.

---

# ------------------------------------------

# **11_Data_Models_and_Schema.md**

# ------------------------------------------

# **11. Data Models & Schema — Complete Specification**

---

## **11.1 Purpose of This Document**

This document defines the **database schema** and **data models** needed for:

* Factor ingestion
* Risk model storage
* Screener filtering
* Portfolio construction
* Backtest simulation
* Analytics reporting
* UI queries

The system is designed for:

* Speed
* Scalability
* Clean relationships
* Ease of updates
* Cross-module reuse
* Clear versioning

Database can be **PostgreSQL** or **MySQL** (recommended) with Prisma ORM.

---

# **11.2 High-Level Schema Diagram**

```
fundamentals_snapshot  →  factor_exposures   →  groups
                                 |              |
OHLCV ─ price_returns ─ cov_matrices ─ risk_model  → portfolios
                                                    |       |
                                           portfolio_weights  portfolio_constraints
                                                    |
                                       backtest_runs   backtest_timeseries
```

This modular schema cleanly separates:

* Inputs (data ingestion)
* Factors (derived)
* Optimization artifacts
* Backtest outputs

---

# ------------------------------------------

# **11.3 Ingestion Tables**

# ------------------------------------------

These tables store inputs from Screener.in and Zerodha.

---

## **11.3.1 Table: `fundamentals_snapshot`**

Stores raw and cleaned fundamentals as of a particular date.

```
fundamentals_snapshot
-------------------------------------------
id (pk)
symbol (fk: symbols.symbol)
as_of_date (date)
market_cap (float)
pe (float)
pb (float)
ps (float)
roe (float)
roce (float)
debt_to_equity (float)
sales_growth_yoy (float)
profit_growth_yoy (float)
eps_growth_3y (float)
operating_margin (float)
net_margin (float)
interest_coverage (float)
promoter_holding (float)
fii_holding (float)
dii_holding (float)

sector (string)
industry (string)

created_at
```

### Notes:

* Multiple snapshots are allowed (historical)
* Used for backtests

Indexes:

```
(symbol, as_of_date)
as_of_date
```

---

## **11.3.2 Table: `market_data_ohlcv`**

Stores daily candle data.

```
market_data_ohlcv
-------------------------------------------
id (pk)
symbol (fk)
date
open
high
low
close
volume
adj_close
```

Indexes:

```
(symbol, date)
date
```

---

## **11.3.3 Table: `price_returns`**

Precomputed daily returns (speed).

```
price_returns
-------------------------------------------
id
symbol (fk)
date
return
```

Used by:

* Risk model
* Covariance creation
* CVaR

---

# ------------------------------------------

# **11.4 Factor & Risk Model Tables**

# ------------------------------------------

These hold computed factors, volatility, covariance, beta, HRP structure, etc.

---

## **11.4.1 Table: `factor_exposures`**

Stores normalized exposures for each factor.

```
factor_exposures
-------------------------------------------
id
symbol
as_of_date
value
quality
momentum
low_vol
size
composite_score
```

Indexes:

```
(symbol, as_of_date)
as_of_date
```

---

## **11.4.2 Table: `risk_model`**

Stores single-asset risk quantities.

```
risk_model
-------------------------------------------
id
symbol
as_of_date
volatility
beta
tail_beta (future)
skew (future)
kurtosis (future)
```

---

## **11.4.3 Table: `covariance_matrices`**

Stores covariance matrix snapshots.

```
covariance_matrices
-------------------------------------------
id
as_of_date
universe_hash (string)
matrix_blob (binary json)
```

Notes:

* `universe_hash` = hash(symbol list)
* Avoids recomputation for same universe

---

## **11.4.4 Table: `hrp_trees`**

Stores the hierarchical clustering structure.

```
hrp_trees
-------------------------------------------
id
as_of_date
universe_hash
tree_json (json)
```

Used by HRP optimization.

---

# ------------------------------------------

# **11.5 Screener & Groups**

# ------------------------------------------

## **11.5.1 Table: `groups`**

User-defined groups (from Screener or manually created).

```
groups
-------------------------------------------
id
name
description
created_at
updated_at
```

---

## **11.5.2 Table: `group_members`**

Stores group → stock mapping.

```
group_members
-------------------------------------------
id
group_id (fk: groups)
symbol (fk: symbols)
position (int)  // rank order from screener
```

---

# ------------------------------------------

# **11.6 Portfolio Storage Tables**

# ------------------------------------------

## **11.6.1 Table: `portfolios`**

Stores metadata for each portfolio.

```
portfolios
-------------------------------------------
id
code
name
description
group_id (fk: groups)
optimizer_type (string)   // e.g., "max_sharpe"
expected_return_mode (string)
initial_capital (float)
created_at
updated_at
```

---

## **11.6.2 Table: `portfolio_constraints`**

Stores constraint settings.

```
portfolio_constraints
-------------------------------------------
id
portfolio_id

min_weight (float)
max_weight (float)
turnover_limit (float)

target_volatility (float nullable)
max_beta (float nullable)

// Sector caps: JSON object
sector_caps_json (json)

// Factor exposure targets: JSON object
factor_constraints_json (json)
```

---

## **11.6.3 Table: `portfolio_weights`**

Stores optimized weights for each rebalance date.

```
portfolio_weights
-------------------------------------------
id
portfolio_id
date   // rebalance date
symbol
weight
```

Notes:

* One row per stock per rebalance
* Used during backtest

Indexes:

```
(portfolio_id, date)
```

---

# ------------------------------------------

# **11.7 Backtest Tables**

# ------------------------------------------

Backtests produce a large set of daily time series.

---

## **11.7.1 Table: `backtest_runs`**

Tracks configuration for a specific backtest.

```
backtest_runs
-------------------------------------------
id
portfolio_id
start_date
end_date
rebalance_frequency
transaction_cost
initial_capital
status
created_at
```

---

## **11.7.2 Table: `backtest_holdings`**

Stores number of shares & weights for each day.

```
backtest_holdings
-------------------------------------------
id
backtest_id
date
symbol
shares
weight
```

---

## **11.7.3 Table: `backtest_timeseries`**

Stores NAV and performance.

```
backtest_timeseries
-------------------------------------------
id
backtest_id
date
nav
return
cumulative_return
drawdown
volatility_rolling
```

Indexes:

```
(backtest_id, date)
```

---

## **11.7.4 Table: `backtest_factor_exposures`**

Tracks factor exposures over time.

```
backtest_factor_exposures
-------------------------------------------
id
backtest_id
date
value
quality
momentum
low_vol
size
```

---

## **11.7.5 Table: `backtest_sector_exposures`**

Tracks sector weights daily.

```
backtest_sector_exposures
-------------------------------------------
id
backtest_id
date
sector
weight
```

---

## **11.7.6 Table: `backtest_trades`**

Tracks executed trades at each rebalance.

```
backtest_trades
-------------------------------------------
id
backtest_id
rebalance_date
symbol
shares_delta
trade_value
transaction_cost
```

---

# ------------------------------------------

# **11.8 Supporting Tables**

# ------------------------------------------

## **11.8.1 Table: `symbols`**

Stores metadata for each tradable instrument.

```
symbols
-------------------------------------------
symbol (pk)
name
sector
industry
exchange
```

---

# ------------------------------------------

# **11.9 Indexing and Optimization Strategy**

### Critical indexes:

* `(symbol, date)` on OHLCV
* `(symbol, as_of_date)` on factors & fundamentals
* `(portfolio_id, date)` on portfolio weights
* `(backtest_id, date)` on backtest timeseries

### Large objects:

Covariance matrices stored as compressed JSON or binary.

### Caching:

* Factor exposures
* Covariance matrices
* HRP trees
* Fundamentals snapshots

---

# ------------------------------------------

# **11.10 Data Integrity Rules**

1. **No missing sector or symbol records** → screener must validate
2. Factor exposures cannot be null unless fundamentals missing
3. Covariance matrix must correspond exactly to universe
4. Backtest must not run if data incomplete
5. Group membership must preserve order
6. Portfolio weights must sum to ~1 within tolerance

---

# ------------------------------------------

# **11.11 Query Patterns**

### For Screener:

```
SELECT symbol, pe, roe, value, momentum
FROM fundamentals_snapshot
JOIN factor_exposures USING(symbol, as_of_date)
WHERE ...
```

### For Optimizer:

```
SELECT *
FROM factor_exposures
WHERE as_of_date = <rebalance_date>
  AND symbol IN <group_symbols>
```

### For Backtest:

Fetch:

1. weights per rebalance
2. OHLCV per day
3. factor exposures per day (optional)

### For Analytics:

Aggregate sector exposures:

```
SELECT sector, SUM(weight)
FROM backtest_holdings
WHERE date = <d>
GROUP BY sector
```

---

# ------------------------------------------

# **11.12 Example Data Flow**

### Step 1 — Screener produces Group

→ rows saved in `groups` / `group_members`.

### Step 2 — Portfolio Construction

→ constraints saved to `portfolio_constraints`
→ optimized weights saved to `portfolio_weights`.

### Step 3 — Backtest

→ daily NAV, exposures, trades saved to `backtest_*` tables.

This ensures reproducibility.

---

# ------------------------------------------

# **11.13 Summary**

The Data Model:

* Supports clean ingestion of fundamentals & prices
* Cleanly stores factors, risk metrics, covariance matrices
* Fully supports optimization & constraints
* Enables daily time-series for backtesting analytics
* Is scalable, modular, and extensible

This schema completes the foundation needed for the backend of SigmaQLab’s factor & portfolio system.

---

# ✔ FILE 11 COMPLETE

When you're ready, say:

### **“Proceed to File 12”**

Next file:

# **12_APIs_and_Service_Contracts.md**

This file defines:

* All backend API endpoints
* Input/output formats
* Optimizer contract
* Screener contract
* Backtest contract
* Error handling
* Pagination, caching

This is the main implementation guide for the backend developers.
