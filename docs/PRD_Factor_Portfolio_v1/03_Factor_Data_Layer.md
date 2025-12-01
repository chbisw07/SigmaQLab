Below is the complete **File 03** for your PRD:

Save it under:

```
docs/PRD_Factor_Portfolio_v1/03_Factor_Data_Layer.md
```

This file is **core infrastructure documentation**, explaining how fundamentals, OHLCV, factors, and derived metrics are ingested, computed, normalized, stored, and served.

It is intentionally deep, because the Factor Data Layer is the foundation for all optimization, risk modeling, screening, and portfolio construction.

---

# ------------------------------------------

# **03_Factor_Data_Layer.md**

# ------------------------------------------

# **3. Factor Data Layer — Architecture & Specification**

---

## **3.1 Purpose of This Document**

The Factor Data Layer is the **foundation** of SigmaQLab’s multi-factor investing system.
It is responsible for:

* Ingesting raw fundamentals (Screener.in)
* Ingesting OHLCV (Zerodha Kite)
* Computing returns, volatility, rolling metrics
* Computing the 5-factor exposures
* Normalizing and storing factor values
* Serving factor data to Screener, Optimizer, Backtester, and Analytics

This document defines:

* Architecture
* Data flows
* Mathematical preprocessing
* Data models
* APIs
* Update schedules
* Edge cases

---

# **3.2 High-Level Diagram**

```
                +------------------------+
                |  External Data Sources |
                |  Screener.in, Kite API |
                +-----------+------------+
                            |
             (fundamentals) | (OHLCV)
                            |
                            v
        +----------------------------------------+
        |           Factor Data Layer            |
        |----------------------------------------|
        | 1. Fundamentals Ingestion              |
        | 2. Price Data Ingestion (OHLCV)        |
        | 3. Returns, Volatility, Beta, etc.     |
        | 4. Factor Preprocessing (standardize)  |
        | 5. Factor Exposure Computation         |
        | 6. Data Store & Caching                |
        | 7. API Services for FE/BE              |
        +----------------------------------------+
                            |
                            v
        +------------------------+----------------+
        |         Consumers                       |
        +------------------------+----------------+
        | Screener | Optimizer | Backtester | UI |
        +-----------------------------------------+
```

---

# **3.3 Factor Model Overview**

SigmaQLab v1 supports **five institutional factors**:

1. **Value**
2. **Quality**
3. **Momentum**
4. **Low Volatility**
5. **Size**

These match industry-standard models:

* **MSCI Barra Equity Model**
* **AQR’s Factor Premia Framework**
* **Fama-French extensions**
* **BlackRock Scientific Active Equity (SAE)**

Each factor is computed from:

* Raw fundamentals (snapshot)
* Price returns (window-based)
* Statistical normalization

---

# **3.4 Data Ingestion**

There are two ingestion streams:

---

## **3.4.1 Fundamentals Ingestion (from Screener.in CSV)**

Required fields:

| Category      | Fields                                       |
| ------------- | -------------------------------------------- |
| Valuation     | PE, PB, PS, EV, EBITDA, Dividend Yield       |
| Profitability | ROE, ROA, ROCE, Net Margin, Operating Margin |
| Growth        | Sales YoY, Profit YoY, EPS 3Y CAGR           |
| Balance Sheet | Debt-to-Equity, Interest Coverage            |
| Ownership     | Promoter Holding, Pledge %, FII/DII Holding  |
| Metadata      | Market Cap, Sector                           |

### Ingestion Process:

1. Load CSV uploaded by user
2. Standardize column names → internal schema
3. Validate rows
4. Store into **fundamentals_snapshot** table with timestamp

### Snapshot Requirements:

* Only the latest snapshot is used for screening
* Historical snapshots are used in backtests
* Missing fields are imputed or marked `null`

---

## **3.4.2 Price Data Ingestion (from Zerodha Kite)**

For each symbol:

* Timeframe: Daily/EOD
* Columns: open, high, low, close, volume, adj_close
* Duration: 5+ years recommended

Fetched via SigmaQLab’s existing Kite integration:

```
kite.historical_data(token, interval, from_date, to_date)
```

### Requirements:

* Store in `market_data_ohlcv`
* Ensure continuous history (fill gaps if needed)
* Handle splits/dividends via adj_close

---

# **3.5 Derived Price Metrics**

Several quantities are computed from OHLCV:

---

## **3.5.1 Daily Returns**

[
r_{i,t} = \frac{P_{i,t} - P_{i,t-1}}{P_{i,t-1}}
]

These returns are used for:

* Volatility
* Covariance
* Momentum
* Beta
* CVaR

---

## **3.5.2 Rolling Volatility**

Default window: 180 days

[
\sigma_i = \sqrt{252} \cdot \text{StdDev}(r_{i,t-W:t})
]

Annualizing factor 252 is standard.

---

## **3.5.3 Momentum (12m−1m)**

MSCI + AQR standard:

[
\text{Mom}*i = \left( \prod*{t-252}^{t-21} (1 + r_{i,t}) \right) - 1
]

Exclude past 21 days to avoid short-term reversal.

---

## **3.5.4 Beta**

Beta vs benchmark index (NIFTY50):

[
\beta_i = \frac{\text{Cov}(r_i, r_m)}{\text{Var}(r_m)}
]

Required for:

* Risk constraints
* CVaR model
* Portfolio diagnostics

---

## **3.5.5 CVaR Input Returns**

Used later by the optimizer:

* Historical returns matrix ( R_{i,t} )
* Needed for tail-risk measurement:

[
\text{CVaR}*\alpha = E[r | r \leq q*\alpha]
]

Where (q_\alpha) is the quantile at level (α=5%).

---

# **3.6 Factor Preprocessing (Normalization)**

Raw metrics must be standardized cross-sectionally so factor values are comparable across stocks.

Standard approach:

1. Winsorization at 5% tails
2. Z-score normalization
3. Sign correction (so “higher = better”)

---

### Example:

Value raw metric:

[
v_i = \frac{1}{PE_i}
]

Standardize:

[
V_i = \frac{v_i - \mu_v}{\sigma_v}
]

Where:

* ( \mu_v ) = mean across universe
* ( \sigma_v ) = standard deviation

This yields a normalized exposure.

Repeat for:

* ROE, ROCE → Quality
* Momentum raw → Momentum
* (-\sigma_i) → Low Vol
* (-\log(\text{Market Cap}_i)) → Size

---

# **3.7 Factor Exposure Computation**

## **3.7.1 Five-Factor Model Vector**

Each stock has final normalized exposures:

[
F_i = [V_i, Q_i, M_i, LV_i, S_i]
]

Where:

* (V_i =) Value factor
* (Q_i =) Quality factor
* (M_i =) Momentum
* (LV_i =) Low Vol (negative volatility)
* (S_i =) Size (negative log market cap)

---

## **3.7.2 Storage**

Stored in table:

```
factor_exposures
---------------------
symbol
as_of_date
value
quality
momentum
low_vol
size
composite_score (optional)
```

---

## **3.7.3 Composite Factor Scores**

Used for ranking in Screener:

[
F^{(comp)}*i = w_V V_i + w_Q Q_i + w_M M_i + w*{LV} LV_i + w_S S_i
]

Default weights: equal
User-configurable in future versions.

---

# **3.8 Data Models**

### Table: fundamentals_snapshot

```
symbol
as_of_date
market_cap
pe
pb
ps
roe
roce
debt_to_equity
promoter_holding
fii_holding
dii_holding
sales_growth
profit_growth
eps_growth
operating_margin
net_margin
...
```

### Table: market_data_ohlcv

```
symbol
date
open
high
low
close
volume
adj_close
```

### Table: factor_exposures

```
symbol
as_of_date
value
quality
momentum
low_vol
size
```

### Table: price_returns

```
symbol
date
return
```

---

# **3.9 Factor Data APIs**

All other subsystems (Screener, Optimizer, Backtester) use these services:

---

## **3.9.1 get_factor_exposures(symbols, as_of_date)**

Returns:

```
{
  "TCS": {value: 0.8, quality: 1.2, ...},
  "INFY": {...}
}
```

---

## **3.9.2 get_fundamentals(symbols, as_of_date)**

Returns raw and standardized fundamentals.

---

## **3.9.3 get_price_returns(symbols, window)**

Returns return vectors (used in CVaR, covariance, etc.).

---

## **3.9.4 get_volatility(symbol)**

Returns annualized volatility.

---

## **3.9.5 get_beta(symbol)**

Returns daily return beta vs benchmark.

---

## **3.9.6 get_covariance_matrix(symbols)**

Returns covariance matrix from Risk Model Layer.

---

# **3.10 Update Schedules**

### Fundamentals:

* Updated manually when user uploads Screener.in CSV
* Can add automated weekly ingestion in future

### OHLCV:

* Pulled on demand for backtests
* Cache updated daily if running in “live mode”

### Factor recomputation:

* Recomputed whenever fundamentals snapshot changes
* Recomputed rolling price metrics daily

---

# **3.11 Error Handling & Edge Cases**

### Missing fundamentals:

* Factor exposure = null
* Stock excluded from factor-based screening

### Missing OHLCV:

* Attempt retry
* Mark unavailable
* Skip in optimizer

### Outlier values:

* Winsorization applied

### Zero volatility stocks:

* Exclude from HRP clustering and Risk Parity

---

# **3.12 Performance Considerations**

With 500–1000 stocks:

* Factor computation < 150 ms
* Covariance matrix < 300 ms
* Factor query < 50 ms

Caching strategies must be used:

* In-memory cache for latest factor exposures
* Persistent cache for covariance matrices
* Lazy-loading for OHLCV

---

# **3.13 Summary**

The Factor Data Layer is the **core building block** enabling:

* Factor Screener
* Optimization Engine
* Risk Model
* Backtesting
* Portfolio Analytics

Its duties include:

* Clean data ingestion
* Robust cleansing & normalization
* Cross-sectional factor computation
* Exposure vector generation
* Efficient storage & retrieval

This is the quantitative heart of SigmaQLab v1.

---

# ✔ FILE 03 COMPLETE

When you're ready, say:

### **“Proceed to File 04”**

Next file:

# **04_Factor_Definitions_and_Models.md**

This file explains *in detail* the mathematical definitions of each factor:

* Value
* Quality
* Momentum
* Low-Vol
* Size

And covers:

* Factor signals
* Winsorization
* Standardization
* Composite scoring
* Industry precedents (MSCI, AQR, Barra)
* Practical implications

This is one of the most important chapters in the entire PRD.
