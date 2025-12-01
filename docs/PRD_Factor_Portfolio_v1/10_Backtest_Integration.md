Below is **File 10**, the complete specification for **Backtest Integration**, the subsystem that connects factor-based groups and optimized portfolios to SigmaQLab’s backtesting engine.

Save it as:

```
docs/PRD_Factor_Portfolio_v1/10_Backtest_Integration.md
```

This file is extremely important because **portfolio backtesting is the final validation step** for factor research, optimization, and constraints. It defines:

* How optimized weights evolve through time
* How rebalancing uses fresh factor/risk data
* How constraints interact during each rebalance
* How PnL, risk, turnover, and exposures are computed
* How backtest results feed into Analytics

This document mirrors the design of quant platforms like Portfolio123, QuantConnect Lean, and BlackRock Aladdin simulation engines.

---

# ------------------------------------------

# **10_Backtest_Integration.md**

# ------------------------------------------

# **10. Backtest Integration — Portfolio Rebalancing & Simulation Engine**

---

## **10.1 Purpose of This Document**

This document describes how optimized portfolios integrate with the SigmaQLab **backtesting engine**.
It covers:

* Rebalancing workflow
* Weight drift modeling
* Constraint enforcement during rebalancing
* Applying the optimizer on historical dates
* Simulating transaction costs
* Tracking performance
* Tracking factor exposures through time
* Producing analytics outputs

The goal is to deliver **realistic and institutional-grade** portfolio backtesting.

---

# **10.2 Backtest Overview**

Backtesting in SigmaQLab involves:

1. A portfolio definition (weights + constraints + optimizer).

2. A date range (start and end).

3. A rebalance frequency (monthly, quarterly, annual).

4. Access to historical OHLCV, factors, and fundamentals.

5. Simulation of:

   * Weight drift
   * Rebalancing
   * Transaction costs
   * Market impact (simple version)

6. Portfolio-level time series:

   * NAV
   * Returns
   * Drawdowns
   * Volatility
   * Beta
   * CVaR
   * Factor exposures

---

# **10.3 High-Level Backtest Flow**

```
Initialize Portfolio
↓
For each rebalance date:
    Load data (OHLCV, factors, fundamentals)
    Run optimizer with historical data
    Compute new weights
    Apply turnover constraints
    Simulate trades
    Update portfolio holdings
↓
Daily NAV computation
↓
Generate analytics
```

Backtests use **historical factor data**, ensuring realistic simulation.

---

# **10.4 Backtest Initialization**

Inputs:

```
portfolio_id
start_date
end_date
rebalance_frequency
transaction_cost_model
initial_capital (default: 100)
benchmark_index (optional)
```

Initialization:

1. Load portfolio definition
2. Load starting universe (the Group)
3. Fetch initial OHLCV
4. Compute initial holdings based on initial optimized weights
5. Set NAV = 100

---

# **10.5 Rebalancing Logic**

### Supported Frequencies:

* Monthly
* Quarterly
* Annual
* Custom X days (advanced)

### Rebalance Date Steps:

For each rebalance date (t):

1. **Load factor data as of t-1**
2. **Load covariance matrix as of t-1**
3. **Load fundamentals as of t-1**
4. **Run optimization using historical data before t**
5. **Evaluate constraints**
6. **Calculate new target weights**
7. **Apply turnover constraint (if enabled)**
8. **Simulate trades**
9. **Update holdings**

---

# **10.6 Optimization During Backtest**

Optimizers behave identically to File 06, but on **historical data slices**.

Example for Max Sharpe on rebalance date (t):

* Use returns from (t-252) to (t-1)
* Build covariance matrix from historical slice
* Use normalized factor exposures as of (t-1)
* Apply constraints
* Solve for weights

This simulates "what a quant PM would know at that time."

---

# **10.7 Weight Drift Between Rebalances**

Weights drift due to differential asset performance:

[
w_{i,t} = \frac{h_{i,t} \cdot P_{i,t}}
{\sum_j h_{j,t} \cdot P_{j,t}}
]

Where (h_{i,t}) = shares held.

Drift is applied **daily** in backtest.

---

# **10.8 Turnover and Transaction Simulation**

Turnover:

[
Turnover_t = \sum_i |w_{i,t}^{new} - w_{i,t}^{old}|
]

Transaction cost model:

### Simple cost:

[
cost = TC \cdot |trade_value|
]

Where:

* TC default = 0.1%
* trade_value = transaction amount in INR

### Total transaction cost:

[
TC_t = \sum_i TC \cdot |h_{i,t}^{new} - h_{i,t}^{old}| \cdot P_{i,t}
]

NAV update:
[
NAV_t = NAV_{t^-} - TC_t
]

---

# **10.9 Handling Missing Data in Backtest**

### 1. Stock delisted

* Remove from portfolio at last available close
* Redistribute weight pro-rata

### 2. Stock untradable (no price data)

* Skip for rebalance
* Raise warning

### 3. Corporate actions

Handled implicitly via adj_close.

---

# **10.10 Daily NAV Computation**

NAV evolves daily via:

[
NAV_t = NAV_{t-1} \cdot (1 + \sum_i w_{i,t} r_{i,t})
]

Track:

* Daily returns
* Cumulative returns
* Drawdowns
* Rolling volatility

---

# **10.11 Tracking Factor Exposures Over Time**

Portfolio factor exposure at date t:

[
F_{p,t,k} = \sum_i w_{i,t} \cdot F_{i,t,k}
]

These exposures are important for:

* Performance attribution
* Risk monitoring
* Constraint verification

Store exposures as a time series:

```
portfolio_factor_exposures
---------------------------------
portfolio_id
date
value
quality
momentum
low_vol
size
```

---

# **10.12 Tracking Sector Exposure Over Time**

Similar mapping:

[
Sector_{p,t,s} = \sum_{i \in s} w_{i,t}
]

Used in analytics and constraint validation.

---

# **10.13 Risk Metrics During Backtest**

Compute rolling metrics:

* Volatility
* Sharpe Ratio
* Sortino Ratio
* Max Drawdown
* Beta vs benchmark
* CVaR (95%)
* Diversification Ratio
* Portfolio turnover (annualized)

Backtest stores these in:

```
portfolio_risk_timeseries
portfolio_performance_timeseries
```

---

# **10.14 Backtest Output Summary**

UI Summary Cards:

### Performance Metrics

* Total Return
* CAGR
* Sharpe Ratio
* Max Drawdown
* Volatility
* CVaR

### Risk Metrics

* Beta
* Tracking Error
* Value factor exposure drift
* Quality exposure
* Momentum exposure
* Sector allocation

### Diagnostics

* Number of rebalances
* Turnover cost
* Constraint violation logs

---

# **10.15 Example Backtest Scenario**

Portfolio:

* Group: “QualityTop30”
* Optimizer: MinVar
* Constraints:

  * Max weight 10%
  * Target volatility 10%
* Rebalance: Monthly
* Date: 2018–2024

At each rebalance:

1. Recompute covariance matrix
2. Rebuild MinVar portfolio
3. Compare with previous weights
4. Turnover = 4–9% typical
5. NAV evolves daily
6. Factor exposures plotted

Final results show:

* Sharpe: 1.18
* Max DD: -14%
* Beta: 0.74

---

# **10.16 Backtest API Specification**

### **POST /api/backtest/run**

Payload:

```
{
  "portfolio_id": "...",
  "start_date": "2019-01-01",
  "end_date": "2024-01-01",
  "rebalance": "monthly",
  "transaction_cost": 0.001,
  "initial_capital": 100
}
```

Response:

```
{
  "nav_timeseries": [...],
  "drawdowns": [...],
  "factor_exposures": [...],
  "risk_metrics": {...},
  "sector_exposures": [...],
  "rebalances": [...],
  "trades": [...]
}
```

---

# **10.17 Error Handling**

### Case 1 — No historical factors

* Cannot run factor-driven optimization
* Display clear error

### Case 2 — Optimization infeasible

* Use fallback: MinVar or EW
* Log warning in backtest summary

### Case 3 — Missing prices

* Remove asset
* Rebalance remaining

### Case 4 — High turnover causing NAV collapse

* Suggest adjusting turnover constraint

---

# **10.18 Backtest Performance Considerations**

For 6 years of data:

* 1500 trading days
* 500-stock universe
* 72 rebalances (monthly)

Expected runtime:

* With cache: <1.0 sec
* Without cache: ~3 sec

Optimizations:

* Pre-compute factor tables
* Pre-compute rolling covariances
* Store HRP trees
* Use vectorized returns calculation

---

# **10.19 Summary**

This file describes **full integration of optimized portfolios into the backtesting engine**, including:

* Rebalancing workflow
* Historical optimization
* Turnover simulation
* Factor exposure tracking
* Performance/risk analytics

This module ties together:

* Factor Data Layer
* Optimization Engine
* Constraint System
* Portfolio Construction UI
* Analytics Engine

and enables SigmaQLab to deliver **end-to-end institutional-grade portfolio analysis**.

---

# ✔ FILE 10 COMPLETE

When you're ready, say:

### **“Proceed to File 11”**

Next file:

# **11_Data_Models_and_Schema.md**

This file covers:

* Database tables
* Relationships
* Field definitions
* Storage of factors, portfolios, weights, constraints, backtests
* Query patterns
* Data integrity & indexing

This is required for implementing the backend cleanly.
