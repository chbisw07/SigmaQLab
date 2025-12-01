Below is **File 12**, the complete specification for all **APIs & Service Contracts** required for Factor Data, Screener, Portfolio Construction, Optimization Engine, Backtesting Engine, and Analytics.

Save as:

```
docs/PRD_Factor_Portfolio_v1/12_APIs_and_Service_Contracts.md
```

This file is extremely important for backend implementation because it provides:

* REST endpoint definitions
* Request/response schemas
* Payload validation rules
* Error messages
* Backend services used by the UI
* Module-level responsibilities
* Integration patterns

Let’s proceed.

---

# ------------------------------------------

# **12_APIs_and_Service_Contracts.md**

# ------------------------------------------

# **12. APIs & Service Contracts — Specification for SigmaQLab v1**

---

## **12.1 Purpose of This Document**

This document defines the **public APIs**, **internal service contracts**, and **request/response schemas** used by:

* Factor Data Layer
* Screener
* Portfolio Construction
* Optimization Engine
* Backtesting Engine
* Analytics
* UI layer

It ensures:

* Clean FE/BE integration
* Predictable backend services
* Clear input/output structures
* Version consistency
* Extendibility

---

# ==========================================

# **12.2 API Overview**

# ==========================================

The API system is organized into 6 groups:

1. **Factor Data API**
2. **Screener API**
3. **Portfolio Construction API**
4. **Optimizer API**
5. **Backtest API**
6. **Analytics API**

All endpoints are versioned:

```
/api/v1/<module>/<endpoint>
```

---

# ==========================================

# **12.3 Factor Data API**

# ==========================================

These APIs expose factor, fundamental, and risk model data.

---

## **12.3.1 GET /api/v1/factors/exposures**

### **Description**

Fetch factor exposures for a list of symbols as of a given date.

### **Request**

```
{
  "symbols": ["TCS", "HDFCBANK"],
  "as_of_date": "2025-01-31"
}
```

### **Response**

```
{
  "TCS": {
    "value": 0.84,
    "quality": 1.12,
    "momentum": -0.2,
    "low_vol": 0.4,
    "size": -0.6,
    "composite": 0.31
  },
  "HDFCBANK": { ... }
}
```

---

## **12.3.2 GET /api/v1/factors/fundamentals**

### **Request**

```
{
  "symbols": ["INFY"],
  "as_of_date": "2025-01-31"
}
```

### **Response**

```
{
  "INFY": {
    "pe": 28.3,
    "pb": 6.2,
    "roe": 29.4,
    "debt_to_equity": 0.08,
    "sector": "IT"
  }
}
```

---

## **12.3.3 GET /api/v1/factors/risk**

Fetch volatility, beta, and skew/kurtosis (future).

### **Response**

```
{
  "TCS": { "volatility": 0.21, "beta": 0.85 }
}
```

---

## **12.3.4 POST /api/v1/factors/covariance**

Fetch covariance matrix and related data.

### Request

```
{
  "symbols": ["TCS","HDFCBANK","ASIANPAINT"],
  "as_of_date": "2025-01-31"
}
```

### Response

```
{
  "symbols": ["TCS","HDFCBANK","ASIANPAINT"],
  "cov_matrix": [[...], [...], [...]],
  "corr_matrix": [[...], [...], [...]]
}
```

---

# ==========================================

# **12.4 Screener API**

# ==========================================

## **12.4.1 POST /api/v1/screener/run**

### **Description**

Executes filter + ranking logic.

### **Request**

```
{
  "universe": "NSE_ALL",
  "as_of_date": "2025-01-31",
  "filters": [
      {"field": "ROE", "op": ">", "value": 15},
      {"field": "Value", "op": ">=", "value": 0.5}
  ],
  "ranking": {
      "primary": {"field": "Quality", "order": "desc"},
      "secondary": {"field": "Value", "order": "desc"},
      "limit": 30
  }
}
```

### **Response**

```
[
  {
    "symbol": "TCS",
    "sector": "IT",
    "value": 0.74,
    "quality": 1.22,
    "momentum": -0.12,
    "market_cap": 1200000
  },
  ...
]
```

---

## **12.4.2 POST /api/v1/groups/create_from_screener**

```
{
  "name": "QualityTop30",
  "description": "Created from screener",
  "symbols": ["TCS", "HDFCBANK", ...]
}
```

Response:

```
{ "group_id": 14, "status": "success" }
```

---

# ==========================================

# **12.5 Portfolio Construction API**

# ==========================================

## **12.5.1 POST /api/v1/portfolio/create**

```
{
  "code": "QLT30",
  "name": "Quality 30",
  "description": "...",
  "group_id": 14,
  "optimizer_type": "max_sharpe",
  "expected_return_mode": "historical_mean"
}
```

Response:

```
{ "portfolio_id": 10 }
```

---

## **12.5.2 POST /api/v1/portfolio/set_constraints**

```
{
  "portfolio_id": 10,
  "constraints": {
    "min_weight": 0,
    "max_weight": 0.10,
    "turnover_limit": 0.10,
    "target_volatility": 0.12,
    "max_beta": 1.0,
    "sector_caps": { "IT": 0.25, "Financials": 0.30 },
    "factor_constraints": {
        "value_min": 0.2,
        "quality_min": 0.3
    }
  }
}
```

Response:

```
{ "status": "saved" }
```

---

# ==========================================

# **12.6 Optimization API**

# ==========================================

## **12.6.1 POST /api/v1/portfolio/optimize**

### **Description**

Runs the optimization engine using:

* universe symbols
* factor exposures
* covariance matrix
* constraints
* expected returns
* chosen optimization method

### **Request**

```
{
  "portfolio_id": 10,
  "as_of_date": "2025-01-31",
  "previous_weights": [...],   // optional
  "optimizer_type": "max_sharpe"
}
```

### **Response**

```
{
  "weights": [
      {"symbol": "TCS", "weight": 0.082},
      {"symbol": "HDFCBANK", "weight": 0.071},
      ...
  ],
  "risk": {
      "volatility": 0.142,
      "sharpe": 0.92,
      "beta": 0.88,
      "cvar": -3.5
  },
  "exposures": {
      "value": 0.32,
      "quality": 0.48,
      "momentum": -0.05,
      "low_vol": 0.22,
      "size": -0.3
  },
  "diagnostics": {
      "binding_constraints": ["sector_cap_IT", "max_beta"],
      "turnover": 0.08
  }
}
```

---

## **12.6.2 POST /api/v1/portfolio/save_weights**

Saves optimized weights for portfolio initialization.

```
{
  "portfolio_id": 10,
  "weights": [{"symbol":"TCS","weight":0.081}, ...]
}
```

Response:

```
{ "status": "saved" }
```

---

# ==========================================

# **12.7 Backtest API**

# ==========================================

## **12.7.1 POST /api/v1/backtest/run**

### **Request**

```
{
  "portfolio_id": 10,
  "start_date": "2019-01-01",
  "end_date": "2024-01-01",
  "rebalance_frequency": "monthly",
  "transaction_cost": 0.001,
  "initial_capital": 100
}
```

### **Response**

```
{
  "backtest_id": 55,
  "summary": {
      "total_return": 0.68,
      "cagr": 0.105,
      "volatility": 0.14,
      "sharpe": 0.92,
      "max_drawdown": -0.18,
      "beta": 0.81,
      "cvar": -3.9,
      "turnover_annualized": 0.42
  }
}
```

---

## **12.7.2 GET /api/v1/backtest/timeseries/{backtest_id}**

Returns NAV curve:

```
[
  {"date":"2019-01-01","nav":100},
  {"date":"2019-01-02","nav":100.3},
  ...
]
```

---

## **12.7.3 GET /api/v1/backtest/factor_exposures/{backtest_id}**

Returns factor time series:

```
[
  {"date":"2019-01-31", "value":0.18, "quality":0.45, ...},
  ...
]
```

---

## **12.7.4 GET /api/v1/backtest/trades/{backtest_id}**

```
[
  {"rebalance_date":"2019-02-01","symbol":"TCS","shares_delta":4,"value":12000,"cost":12},
  ...
]
```

---

# ==========================================

# **12.8 Analytics API**

# ==========================================

## **12.8.1 GET /api/v1/analytics/summary/{portfolio_id}**

Returns last computed analytics summary.

```
{
  "volatility": 0.142,
  "beta": 0.88,
  "expected_return": 0.12,
  "value_exposure": 0.32,
  "sector_allocation": { ... }
}
```

---

## **12.8.2 GET /api/v1/analytics/efficient_frontier**

Used by the UI when user chooses Efficient Frontier mode.

### **Request**

```
{
  "symbols": [...],
  "as_of_date": "2025-01-31"
}
```

### **Response**

```
{
  "points": [
      {"risk": 0.10, "return": 0.08, "weights":[...]},
      {"risk": 0.12, "return": 0.10, "weights":[...]},
      ...
  ]
}
```

---

# ==========================================

# **12.9 Error Handling Specification**

# ==========================================

### **Common Error Response**

All endpoints return errors as:

```
{
  "error": {
      "code": "DATA_MISSING",
      "message": "No factor data available for date 2025-01-31"
  }
}
```

---

## **12.9.1 Screener Errors**

* `INVALID_FILTER`
* `UNKNOWN_FIELD`
* `NO_RESULTS`
* `UNSUPPORTED_OPERATOR`

---

## **12.9.2 Optimizer Errors**

* `INFEASIBLE_CONSTRAINTS`
* `NO_COVARIANCE_DATA`
* `NO_FACTOR_DATA`
* `OPTIMIZER_FAILURE`
* `INVALID_PORTFOLIO`

---

## **12.9.3 Backtest Errors**

* `PRICE_DATA_MISSING`
* `FACTOR_DATA_MISSING`
* `REBALANCE_ERROR`
* `INVALID_DATE_RANGE`

---

# ==========================================

# **12.10 Internal Service Contracts**

# ==========================================

The backend itself is divided into services:

1. **FactorService**
2. **RiskModelService**
3. **ScreenerService**
4. **OptimizerService**
5. **ConstraintService**
6. **PortfolioService**
7. **BacktestService**
8. **AnalyticsService**

---

## **12.10.1 FactorService**

### Methods:

* `get_factor_exposures(symbols, date)`
* `get_fundamentals(symbols, date)`
* `get_volatility(symbols, date)`
* `get_returns_matrix(symbols, start, end)`
* `compute_composite_score(symbols, date)`

---

## **12.10.2 RiskModelService**

* `get_covariance_matrix(symbols, date)`
* `get_correlation_matrix(symbols, date)`
* `compute_beta(symbols, date)`
* `build_hrp_tree(symbols, date)`
* `compute_cvar(weights, returns)`

---

## **12.10.3 ScreenerService**

* `apply_filters(filters)`
* `apply_ranking(ranking)`
* `save_group()`

---

## **12.10.4 OptimizerService**

* `optimize(weights_init, constraints)`
* `max_sharpe()`
* `min_var()`
* `risk_parity()`
* `hrp()`
* `cvar_opt()`
* `efficient_frontier()`

---

## **12.10.5 BacktestService**

* `run_backtest(portfolio_id)`
* `rebalance(portfolio_id, date)`
* `compute_daily_nav()`
* `record_factor_exposures()`

---

## **12.10.6 AnalyticsService**

* `summarize_backtest(backtest_id)`
* `compute_risk_metrics()`
* `compute_sector_allocations()`
* `compute_factor_tilt()`

---

# ==========================================

# **12.11 Summary**

This API specification:

* Defines all endpoints for SigmaQLab v1
* Standardizes requests & responses
* Provides clean interfaces for UI
* Ensures backend consistency
* Includes detailed error handling
* Maps directly to Services & Controllers

This is the primary reference for backend developers implementing the Factor & Portfolio system.

---

# ✔ FILE 12 COMPLETE

When ready, say:

### **“Proceed to File 13”**

Next file:

# **13_Wireframes.md**

This file provides **visual layouts**, **page flows**, **UI element placement**, and **user interaction diagrams** for:

* Screener
* Portfolio Constructor
* Efficient Frontier UI
* Backtest results & analytics

These wireframes will guide frontend developers and designers.
