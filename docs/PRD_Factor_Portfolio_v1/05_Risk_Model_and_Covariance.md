Below is **File 05** for your PRD, one of the most mathematically detailed and conceptually important documents in the entire system.

Save it under:

```
docs/PRD_Factor_Portfolio_v1/05_Risk_Model_and_Covariance.md
```

This file covers:

* Covariance estimation
* Shrinkage techniques
* Beta computation
* Risk decomposition
* HRP clustering tree
* CVaR estimation
* Risk diagnostics for optimizers
* Handling missing data
* Performance considerations

This is the backbone of all portfolio optimization algorithms in File 06.

---

# ------------------------------------------

# **05_Risk_Model_and_Covariance.md**

# ------------------------------------------

# **5. Risk Model & Covariance System**

---

## **5.1 Purpose of This Document**

This document describes SigmaQLab’s **Risk Model Layer**, which provides all risk-related quantities used by:

* Portfolio Optimization Engine
* Backtesting Engine
* Factor Attribution Engine
* Analytics dashboards

The goal of the Risk Model Layer is to produce reliable, stable, and mathematically consistent estimates of:

* Asset volatilities
* Pairwise correlations
* Covariance matrix
* Beta exposures
* HRP cluster structure
* CVaR (Conditional Value at Risk)
* Tail correlations (for CVaR optimizer)

This is a **mission-critical subsystem** because:

* Optimization requires accurate risk estimates
* Backtests become unstable if covariance is noisy
* Constraints like Max Beta depend on correct betas
* HRP depends entirely on hierarchical clustering
* CVaR optimization requires tail distribution modeling

---

# **5.2 Conceptual Overview**

The Risk Model Layer uses a **three-tiered approach**:

### Tier 1 — Price-Based Risk Metrics

Derived from returns:

* Daily returns
* Rolling volatilities
* Covariance matrix
* Correlations
* Beta vs benchmark

### Tier 2 — Structure-Based Risk Modeling

Based on hierarchical clustering:

* Distance matrix
* Dendrogram tree (HRP)
* Quasi-diagonalization

### Tier 3 — Tail-Risk Modeling

Based on empirical distributions:

* Historical CVaR
* Tail correlations
* Loss distribution sampling

These three tiers together form a robust risk estimation framework.

---

# **5.3 Return Series**

Returns are computed as:

[
r_{i,t} = \frac{P_{i,t} - P_{i,t-1}}{P_{i,t-1}}
]

* Use **adjusted close** for corporate actions
* Missing days filled with previous close
* Outliers winsorized at 1%/99%

---

# **5.4 Volatility Estimation**

### Annualized volatility:

[
\sigma_i = \sqrt{252} \cdot StdDev(r_{i,t-W:t})
]

Default window (W = 180) days.

### Implementation Notes

* Rolling window used for time-period consistency
* Robust against high-frequency noise
* Volatility is always **positive**

---

# **5.5 Correlation Matrix**

Correlation between stocks (i) and (j):

[
\rho_{ij} = \frac{\text{Cov}(r_i, r_j)}{\sigma_i \sigma_j}
]

Covariance calculation is described next.

Missing data is handled by:

* Pairwise deletion
* Minimum required overlap threshold (e.g., 100 days)

---

# **5.6 Covariance Matrix (Σ)**

The covariance matrix is essential for:

* Min-Var
* Max-Sharpe
* Efficient Frontier
* Hierarchical Risk Parity
* Risk Parity
* CVaR-based Optimization (via risk estimates)

### Sample covariance estimator:

[
\Sigma = \frac{1}{T-1}(R - \bar{R})(R - \bar{R})^T
]

Where:

* (R) is matrix of returns
* (T) = number of observations

---

## **5.6.1 Issues with Sample Covariance**

* Very noisy when N > T
* High off-diagonal instability
* Sensitive to regime changes
* Leads to unstable optimizations

**Solution → Shrinkage estimators**

---

# **5.7 Covariance Shrinkage (Ledoit-Wolf)**

Industry standard used by:

* BlackRock
* AQR
* MSCI Barra Lite
* PyPortfolioOpt

Shrinkage formula:

[
\Sigma^{(shrunk)} = \delta F + (1 - \delta)\Sigma
]

Where:

* (F) = structured target (diagonal matrix of variances)
* (\delta) = shrinkage intensity (0–1)

Benefits:

* More stable covariance
* Reduces overfitting
* Helps optimizer convergence

SigmaQLab uses Ledoit–Wolf estimator to compute (\delta) automatically.

---

# **5.8 Beta Calculation**

Beta relative to benchmark index (NIFTY50):

[
\beta_i = \frac{\text{Cov}(r_i, r_m)}{\text{Var}(r_m)}
]

Where (r_m) = index returns.

This is used in:

* Max Beta constraint
* Factor exposures
* Risk diagnostics

---

# **5.9 Correlation Distance for HRP**

HRP (Hierarchical Risk Parity) requires a **distance matrix**:

[
D_{ij} = \sqrt{ \frac{1 - \rho_{ij}}{2} }
]

This ensures:

* (D_{ij}) ∈ [0, 1]
* Perfect correlation → 0
* No correlation → ~0.7
* Negative correlation → > 0.7

---

# **5.10 Hierarchical Clustering (HRP)**

HRP follows López de Prado (2016).

### Steps:

1. **Compute distance matrix**
2. **Perform hierarchical clustering** (single-linkage recommended)
3. **Build dendrogram tree**
4. **Compute quasi-diagonalized covariance matrix**
5. **Recursive bisection to assign weights**

Benefits:

* Does not require matrix inversion
* Robust with high noise covariance
* Outperforms traditional MPT in small sample windows
* Industry-accepted (implemented in Aladdin, AQR)

---

# **5.11 HRP Weight Computation (Short Summary)**

### Step 1 — Tree Ordering

Reorder assets based on cluster proximity.

### Step 2 — Recursive Bisection

At each split, allocate cluster weight as:

[
w_{left} = \frac{1/{\sigma^2_{left}}}
{1/{\sigma^2_{left}} + 1/{\sigma^2_{right}}}
]

Where:

* ( \sigma^2_{cluster} = \vec{1}^T \Sigma_{cluster} \vec{1} )

### Step 3 — Normalize final weights

HRP produces diversified, stable portfolios.

---

# **5.12 CVaR Modeling**

CVaR (Conditional Value at Risk) is a tail-risk measure:

[
CVaR_\alpha = E[ r | r \leq q_\alpha ]
]

Where:

* ( q_\alpha ) = (\alpha)-quantile of loss distribution
* Typical ( \alpha = 0.05 )

CVaR is used in:

* CVaR optimization objective
* Risk diagnostics
* Tail risk analytics

---

## **5.12.1 Portfolio CVaR Approximation**

Given weight vector (w):

1. Compute portfolio returns:

[
r_{p,t} = \sum_i w_i \cdot r_{i,t}
]

2. Sort returns → find 5% worst losses
3. Average them → CVaR value

Used as objective in CVaR optimization model.

---

# **5.13 Tail Correlation**

CVaR requires understanding of **tail dependencies**.

Tail correlation:

[
\rho^{tail}*{ij} =
Corr(r*{i,t}, r_{j,t} \mid r_{p,t} \leq q_\alpha)
]

Used to:

* Improve CVaR accuracy
* Improve diversification in CVaR optimizer

---

# **5.14 Portfolio Risk Metrics Provided by Risk Model**

The risk model computes:

1. Per-asset volatility
2. Correlation matrix
3. Covariance matrix
4. Beta
5. HRP cluster structure
6. CVaR
7. Expected shortfall
8. Tracking error (vs benchmark)
9. Diversification ratio
10. Marginal contribution to risk (MCTR)
11. Component contribution to risk (CTR)

These feed into Portfolio Construction and Analytics.

---

# **5.15 Missing Data Handling**

| Scenario                    | Action                                   |
| --------------------------- | ---------------------------------------- |
| No OHLCV                    | Exclude from optimization                |
| Zero variance               | Exclude from LV + RP models              |
| Correlation undefined       | Treat as 0                               |
| Missing returns > threshold | Drop from covariance set                 |
| Thinly traded               | Apply liquidity penalty (future version) |

---

# **5.16 Performance Considerations**

### With N stocks:

* Covariance matrix is NxN
* HRP clustering is O(N²)
* CVaR sampling is O(NT)

Empirical performance:

* N ≤ 200: < 300 ms
* N ≤ 500: < 900 ms
* N ≤ 1000: ~1.7 sec (acceptable for offline optimization)

Caching strategy:

* Cache covariance per universe/per date
* Reuse HRP tree if only small changes occurred
* Incremental CVaR updates possible

---

# **5.17 Outputs of Risk Model Layer**

The Risk Model Layer exposes:

### **1. Covariance matrix (Σ)**

### **2. Correlation matrix (ρ)**

### **3. Volatility vector (σ)**

### **4. Beta vector (β)**

### **5. HRP cluster tree**

### **6. Returns matrix**

### **7. CVaR values**

### **8. Tail correlation matrix**

All optimizers rely on some or all of these.

---

# **5.18 API Definitions**

### **get_covariance_matrix(symbols)**

Returns Σ (NxN).

### **compute_beta(symbol)**

Returns β for symbol.

### **get_volatility(symbols)**

Returns σ.

### **get_hrp_clusters(symbols)**

Returns cluster tree & ordered list.

### **compute_cvar(weights, returns_matrix)**

Returns portfolio CVaR.

### **compute_tail_correlation(symbols)**

Returns ρ^{tail}.

---

# **5.19 Summary**

This file defines the entire risk modeling framework for SigmaQLab:

* Stable covariance estimation (shrinkage)
* Beta and volatility modeling
* HRP clustering
* CVaR tail-risk modeling
* APIs for Screener, Optimizer, Backtester

This is the mathematical backbone enabling:

* Min-variance portfolios
* Efficient frontier
* Risk-parity
* HRP allocations
* Tail-risk (CVaR) optimization

Next, the Optimization Algorithms file will build directly on this risk foundation.

---

# ✔ FILE 05 COMPLETE

When ready, say:

### **“Proceed to File 06”**

Next file:

# **06_Optimization_Algorithms.md**

This will be **the largest and most mathematically rich file so far**, covering:

* EW, MCW
* Risk parity
* Maximum Sharpe
* Minimum variance
* Efficient Frontier
* HRP optimization
* CVaR optimization
* Constraint-aware variants
* Objective functions
* Implementation guidelines

This is the heart of portfolio construction.
