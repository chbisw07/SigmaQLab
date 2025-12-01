Below is **File 06**, the largest and most mathematically intensive file of the PRD.
This file defines **all optimization algorithms** implemented in SigmaQLab v1:

* Equal Weight
* Market Cap Weighting
* Risk Parity
* Minimum Variance
* Maximum Sharpe
* Mean-Variance Efficient Frontier
* HRP (Hierarchical Risk Parity)
* CVaR Optimization
* Constraint-aware optimization
* Algorithm comparison
* Implementation notes

Save as:

```
docs/PRD_Factor_Portfolio_v1/06_Optimization_Algorithms.md
```

---

# ------------------------------------------

# **06_Optimization_Algorithms.md**

# ------------------------------------------

# **6. Portfolio Optimization Algorithms — Specification & Math Guide**

---

## **6.1 Purpose of This Document**

This document defines all **portfolio optimization algorithms** implemented in SigmaQLab v1.
It includes:

* Mathematical foundations
* Algorithmic workflows
* Inputs/outputs
* Constraint handling
* Advantages & disadvantages
* Implementation considerations

These algorithms form the **core of the Portfolio Construction Engine**.

---

# **6.2 Optimization Inputs and Outputs**

Regardless of method, all optimizers operate on:

---

## **Inputs**

1. **Returns estimate**

   * Historical returns
   * Estimated expected returns (μ)

2. **Risk estimate**

   * Covariance matrix Σ
   * Volatilities σ
   * HRP structure
   * CVaR tail distribution

3. **Constraints**

   * Long-only: (w_i ≥ 0)
   * Weight bounds: (w_{min} ≤ w_i ≤ w_{max})
   * Sector limits
   * Turnover limits
   * Max Beta
   * Target volatility
   * Factor exposure targets/limits

4. **Universe (symbols)**

5. **Rebalance date**

---

## **Outputs**

Every optimization produces:

### **1. Weight vector**

[
\vec{w} = [w_1, w_2, \dots, w_N]
]

### **2. Diagnostics**

* risk (volatility)
* return estimate
* Sharpe
* diversification ratio
* HRP cluster info
* constraint violations

### **3. Explanation fields (for UI)**

* Which constraints were binding
* Factor exposures of the final portfolio

---

# **6.3 Terminology Summary**

* (N): number of assets
* (\vec{w}): weight vector
* (\vec{\mu}): expected returns
* (\Sigma): covariance matrix
* (\sigma_i): volatility of asset i
* (\rho_{ij}): correlation
* (CVaR_\alpha): Conditional Value at Risk

---

# ======================================================

# **6.4 OPTIMIZATION ALGORITHM 1 — EQUAL WEIGHT (EW)**

# ======================================================

## **Definition**

Every stock gets equal allocation:

[
w_i = \frac{1}{N}
]

## **Advantages**

* Simple, robust
* No estimation risk
* Governance-friendly
* Difficult to outperform over long horizons

## **Disadvantages**

* Ignores risk
* Overweights small caps
* Not optimal for volatility control

## **Use Cases**

* Benchmark portfolio
* Smart-beta validator
* Fallback when risk model is unstable

---

# ======================================================

# **6.5 ALGORITHM 2 — MARKET CAP WEIGHT (MCW)**

# ======================================================

[
w_i = \frac{\text{MCap}_i}{\sum_j \text{MCap}_j}
]

## **Advantages**

* Matches index behavior
* Highly liquid allocations
* Easy to rebalance

## **Disadvantages**

* Momentum-driven → can overweight bubbles
* Ignores fundamentals

## **Use Cases**

* Index replication
* Market-neutral overlays

---

# ======================================================

# **6.6 ALGORITHM 3 — RISK PARITY (VOLATILITY WEIGHTING)**

# ======================================================

Goal: **each asset contributes equal risk**.

### **Definitions**

Marginal contribution to risk:

[
MCTR_i = w_i(\Sigma w)_i
]

Total risk:

[
\sigma_p = \sqrt{w^T\Sigma w}
]

Risk contribution:

[
RC_i = \frac{w_i(\Sigma w)_i}{\sigma_p}
]

Risk parity target:

[
RC_i = \frac{1}{N}
]

### **Closed-form approximation (for diagonal Σ)**

[
w_i \propto \frac{1}{\sigma_i}
]

### **General solution**

Solve nonlinear system:

[
w_i(\Sigma w)_i = \lambda
]

## **Advantages**

* Stable
* Does not require expected returns
* Good for risk control

## **Disadvantages**

* Sensitive to volatility estimation
* Underweights high-return assets

---

# ======================================================

# **6.7 ALGORITHM 4 — MINIMUM VARIANCE PORTFOLIO (MinVar)**

# ======================================================

Goal: minimize volatility:

[
\min_w w^T\Sigma w
]

Subject to:

[
w_i ≥ 0,\ \sum_i w_i = 1
]

### **Solution**

Quadratic programming (QP) problem:

[
w^* = \frac{\Sigma^{-1}\mathbf{1}}{\mathbf{1}^T\Sigma^{-1}\mathbf{1}}
]

If no weight bounds.

## **Advantages**

* Extremely stable
* Ideal for defensive portfolios
* Achieves low drawdowns

## **Disadvantages**

* Can unintentionally create factor tilts
* Sensitive to estimation error if Σ noisy
* Overweights low-vol, low-return stocks

Use with shrinkage covariance.

---

# ======================================================

# **6.8 ALGORITHM 5 — MAXIMUM SHARPE RATIO (MSR)**

# ======================================================

The tangency portfolio:

[
\max_w \frac{w^T\mu}{\sqrt{w^T\Sigma w}}
]

Equivalent QP form:

[
\max_w\ w^T\mu - \lambda w^T\Sigma w
]

## **Advantages**

* Best risk-adjusted returns
* Core of Modern Portfolio Theory

## **Disadvantages**

* Requires reliable expected returns
* Sensitive to estimation error
* Can concentrate weights

Expected returns default sources:

* Historical mean
* CAPM
* Factor model alpha (future version)

---

# ======================================================

# **6.9 ALGORITHM 6 — MEAN-VARIANCE EFFICIENT FRONTIER**

# ======================================================

Classic Markowitz curve:

### Min-var at target return (R):

[
\min_w w^T\Sigma w,\ \text{s.t. } w^T\mu = R
]

Frontier computed by solving across range of R.

### UI Implementation:

* Show curve
* Allow user to pick a specific optimal point
* Provide sliders for risk tolerance

## **Advantages**

* Full risk-return tradeoff
* Highly visual
* Standard in all professional PM tools

## **Disadvantages**

* Requires reliable expected returns
* Sensitive to return estimation

---

# ======================================================

# **6.10 ALGORITHM 7 — HIERARCHICAL RISK PARITY (HRP)**

# ======================================================

Uses López de Prado’s method:

### Step 1 — Compute distance matrix

[
D_{ij} = \sqrt{\frac{1 - \rho_{ij}}{2}}
]

### Step 2 — Hierarchical clustering

Single-linkage clustering recommended.

### Step 3 — Quasi-diagonalization

Reorder covariance matrix Σ.

### Step 4 — Recursive bisection

Allocate weights recursively:

[
w_{left} =
\frac{1 / \sigma_{left}^2}
{1 / \sigma_{left}^2 + 1 / \sigma_{right}^2}
]

[
w_{right} = 1 - w_{left}
]

### Summary

HRP avoids covariance inversion → extremely stable.

## **Advantages**

* Smooth, robust
* Excellent out-of-sample performance
* Immune to multicollinearity
* Ideal for portfolios with many correlated stocks

## **Disadvantages**

* Does not optimize for returns
* Results depend on clustering algorithm

---

# ======================================================

# **6.11 ALGORITHM 8 — CVaR OPTIMIZATION**

# ======================================================

CVaR = expected tail loss at confidence α:

[
CVaR_\alpha = E[r | r \le q_\alpha]
]

Goal:

[
\min_w CVaR_\alpha(w)
]

Where portfolio returns:

[
r_{p,t} = \sum_i w_i r_{i,t}
]

### Linear Programming formulation (Rockafellar-Uryasev)

Introduce auxiliary variable ( \eta ):

[
\min_{\eta, w} \left[
\eta + \frac{1}{(1-\alpha)T}\sum_t \max(0, -r_{p,t} - \eta)
\right]
]

Where:

* (r_{p,t}) are portfolio returns
* (\alpha = 95%) or 99%

This is solved via LP (linear programming).

## **Advantages**

* Controls tail risk explicitly
* Better than variance-based risk in crises

## **Disadvantages**

* Heavier computation
* Sensitive to window length
* Optimization may concentrate weights

---

# ======================================================

# **6.12 CONSTRAINT-AWARE OPTIMIZATION**

# ======================================================

All above algorithms support constraints.

---

## **6.12.1 Weight Bounds**

[
w_{min,i} \le w_i \le w_{max,i}
]

Defaults:

* Long-only: (0 \le w_i \le 0.2)

---

## **6.12.2 Sector Constraints**

For each sector (s):

[
\sum_{i \in s} w_i \le \text{sector_max}_s
]

Example:

* Max IT: 25%
* Max Financials: 30%

---

## **6.12.3 Turnover Constraint**

[
\sum_i |w_i - w_i^{prev}| \le \tau_{max}
]

Used during rebalancing.

---

## **6.12.4 Target Volatility**

Find weights such that:

[
\sqrt{w^T\Sigma w} = \sigma_{target}
]

Add as equality or penalty term.

---

## **6.12.5 Factor Exposure Constraints**

Example:

* Quality > 0.3
* Momentum < 0
* Value + Quality > 0.5

General form:

[
\sum_i w_i F_{i,k} \ge T_k
]

Where (F_{i,k}) is factor exposure for stock i.

---

## **6.12.6 Max Beta Constraint**

[
\beta_p = \sum_i w_i \beta_i \le \beta_{max}
]

Used for risk control.

---

# ======================================================

# **6.13 Algorithm Comparison Table**

# ======================================================

| Algorithm          | Risk Use  | Return Use | Stable | Tail Risk | Best For               |
| ------------------ | --------- | ---------- | ------ | --------- | ---------------------- |
| EW                 | None      | None       | ★★★★   | No        | Simple baseline        |
| MCW                | None      | Implicit   | ★★★★   | No        | Index-like             |
| Risk Parity        | Vol, Σ    | None       | ★★★★   | No        | Balanced risk          |
| MinVar             | Σ         | None       | ★★★★   | No        | Defensive              |
| MaxSharpe          | Σ         | μ          | ★★     | No        | Aggressive returns     |
| Efficient Frontier | Σ         | μ          | ★★     | No        | Risk-return trade-off  |
| HRP                | Σ (tree)  | None       | ★★★★★  | No        | Robust diversification |
| CVaR               | Tail dist | μ          | ★★★    | ★★★★★     | Crisis protection      |

HRP and CVaR are the most robust during extreme events.

---

# ======================================================

# **6.14 Optimizer Selection Logic (Internal)**

# ======================================================

Depending on Portfolio Settings:

### If “Construction Mode = HRP”

→ HRP directly

### If “Target Volatility defined”

→ MinVar or scaled MaxSharpe

### If “Factor tilts defined”

→ Solve with linear constraints added

### If “Turnover limit active”

→ Use QP with L1 penalty

### If “CVaR optimization selected”

→ LP solver

### Else default

→ Maximum Sharpe

---

# ======================================================

# **6.15 Optimization Engine API**

# ======================================================

### **`optimize_portfolio(request) → result`**

### Request includes:

```
{
  "symbols": [...],
  "expected_returns": μ,
  "covariance_matrix": Σ,
  "factor_exposures": F,
  "constraints": {...},
  "objective": "max_sharpe" | "min_var" | "hrp" | "cvar",
  "rebalance_date": "...",
  "previous_weights": [...]
}
```

### Result:

```
{
  "weights": {...},
  "risk": {vol, cvar, beta, diversification},
  "exposures": {...},
  "warnings": [...],
  "debug": {...}
}
```

---

# ======================================================

# **6.16 Implementation Notes**

# ======================================================

### Numerical Stability

* Use shrinkage Σ
* Add diagonal jitter ε = 1e-8

### Efficiency

* Pre-cache Σ, returns, exposures
* Use NumPy vectorization
* Use SciPy for QP
* Use CVXOPT for CVaR

### Infeasibility Handling

* Relax constraints gradually
* Provide warnings to user
* Fall back to MinVar or EW

---

# ======================================================

# **6.17 Summary**

This file defines the complete portfolio optimization suite for SigmaQLab v1:

* Modern Portfolio Theory (Sharpe, MinVar, Frontier)
* Risk-based methods (RP, HRP)
* Tail risk optimization (CVaR)
* Full constraint engine
* Clean APIs for integration

These optimizers support sophisticated workflows:

* Smart-beta construction
* Multi-factor portfolios
* Portfolio-level backtesting
* Factor exposure management
* Risk-aware rebalancing

This is the computational heart of the SigmaQLab portfolio engine.

---

# ✔ FILE 06 COMPLETE

When ready, say:

### **“Proceed to File 07”**

Next file:

# **07_Constraint_System.md**

This file defines:

* Weight constraints
* Sector constraints
* Factor exposure constraints
* Turnover constraints
* Target volatility
* Max beta
* Constraint resolution logic
* Infeasibility handling

Extremely important for real-world portfolio construction.
