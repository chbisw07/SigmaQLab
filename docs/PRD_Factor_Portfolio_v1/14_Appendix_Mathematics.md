Below is **File 14**, the complete **Mathematical Appendix** containing all key formulas, derivations, and quant foundations behind SigmaQLab’s factor system, risk model, optimization algorithms, constraints, and backtesting logic.

Save as:

```
docs/PRD_Factor_Portfolio_v1/14_Appendix_Mathematics.md
```

This is the most mathematically detailed document of the entire PRD and serves as the **reference chapter for quantitative developers and researchers**.
It contains derived formulas, expanded explanations, and full mathematical rationale for design decisions in SigmaQLab.

---

# ------------------------------------------

# **14_Appendix_Mathematics.md**

# ------------------------------------------

# **14. Appendix — Mathematical Foundations of SigmaQLab Factor & Portfolio System**

---

## **14.1 Purpose of This Document**

This appendix serves as a comprehensive mathematical reference for:

* Factor construction
* Risk estimation
* Covariance shrinkage
* Portfolio optimization
* Efficient frontier
* Risk parity
* Hierarchical risk parity
* CVaR optimization
* Factor exposure calculations
* Constraint formulations

It complements Files 03–10 by providing **full derivations and quant explanations**, ensuring the portfolio engine is mathematically traceable and auditable.

---

# ======================================================

# **14.2 Factor Model Mathematics**

# ======================================================

SigmaQLab uses **cross-sectional z-scored factors**, meaning each factor is standardized across a universe:

### **14.2.1 Winsorization**

For raw metric (x_i):

[
x_i^{(wins)} =
\begin{cases}
p_5 & \text{if } x_i < p_5 \
p_{95} & \text{if } x_i > p_{95} \
x_i & \text{otherwise}
\end{cases}
]

Where (p_5, p_{95}) are 5th and 95th percentile values.

---

## **14.2.2 Z-Score Standardization**

[
Z(x_i) = \frac{x_i - \mu_x}{\sigma_x}
]

Where:

* (\mu_x) = cross-sectional mean
* (\sigma_x) = cross-sectional std dev

---

## **14.2.3 Direction Alignment**

Some factors reward *low* raw values (e.g., volatility):

[
LV^{raw}_i = -\sigma_i
]

Size:

[
S^{raw}_i = -\log(\text{MCap})
]

---

## **14.2.4 Final Factor Exposure Vector**

[
F_i = [V_i, Q_i, M_i, LV_i, S_i]
]

Where (V_i) etc. are z-scored exposures.

---

# ======================================================

# **14.3 Risk Model Mathematics**

# ======================================================

---

# **14.3.1 Daily Returns**

[
r_{i,t} = \frac{P_{i,t} - P_{i,t-1}}{P_{i,t-1}}
]

---

# **14.3.2 Annualized Volatility**

[
\sigma_i = \sqrt{252} \cdot StdDev(r_{i,t-W:t})
]

---

# **14.3.3 Covariance Matrix**

Let (R) be an (N \times T) return matrix.

Sample covariance:

[
\Sigma = \frac{1}{T-1} (R - \bar{R})(R - \bar{R})^T
]

---

# **14.3.4 Correlation Coefficients**

[
\rho_{ij} = \frac{\Sigma_{ij}}{\sigma_i \sigma_j}
]

---

# **14.3.5 Beta**

[
\beta_i = \frac{\text{Cov}(r_i, r_m)}{\text{Var}(r_m)}
]

---

## **14.3.6 Ledoit-Wolf Shrinkage Covariance**

Shrinkage target = diagonal matrix:

[
F = diag(\sigma_1^2, \sigma_2^2, ..., \sigma_N^2)
]

Shrinkage estimator:

[
\Sigma^{(shrunk)} = \delta F + (1 - \delta)\Sigma
]

Where shrinkage intensity (\delta) minimizes MSE.

---

## **14.3.7 Distance Matrix for HRP**

[
D_{ij} = \sqrt{\frac{1 - \rho_{ij}}{2}}
]

---

## **14.3.8 Cluster Variance in HRP**

Given cluster (C):

[
\sigma^2(C) = w_C^T \Sigma_C w_C
]

Where:

[
w_C = \frac{1}{|C|} \mathbf{1}
]

---

# ======================================================

# **14.4 Classic MPT Optimization Mathematics**

# ======================================================

---

# **14.4.1 Minimum Variance Portfolio (Unconstrained)**

Target:

[
\min_w w^T \Sigma w
]

Budget:

[
\mathbf{1}^T w = 1
]

Solution:

[
w^* = \frac{\Sigma^{-1} \mathbf{1}}{\mathbf{1}^T \Sigma^{-1} \mathbf{1}}
]

---

# **14.4.2 Maximum Sharpe Ratio Portfolio**

Sharpe:

[
S(w) = \frac{w^T \mu}{\sqrt{w^T \Sigma w}}
]

Equivalent to:

[
\max_w (w^T\mu - \lambda w^T\Sigma w)
]

Where (\lambda) controls risk preference.

---

# **14.4.3 Efficient Frontier**

Solve:

[
\min_w w^T\Sigma w
]
Subject to:
[
w^T \mu = R
\quad \text{and} \quad \mathbf{1}^T w = 1
]

This yields the parameterized frontier.

---

## **14.4.4 Frontier Closed-Form (2-Fund Separation)**

Let:

[
A = \mathbf{1}^T \Sigma^{-1} \mathbf{1}
]
[
B = \mathbf{1}^T \Sigma^{-1} \mu
]
[
C = \mu^T \Sigma^{-1} \mu
]

Efficient frontier weights:

[
w(R) = \Sigma^{-1} \left[ \frac{C - RB}{AC - B^2}\mathbf{1}
+ \frac{AR - B}{AC - B^2}\mu \right]
]

This is classic Markowitz theory.

---

# ======================================================

# **14.5 Risk Parity Mathematics**

# ======================================================

Goal: Equal risk contribution.

---

## **14.5.1 Portfolio Risk**

[
\sigma_p = \sqrt{w^T\Sigma w}
]

---

## **14.5.2 Marginal Contribution to Risk**

[
MCTR_i = (\Sigma w)_i
]

---

## **14.5.3 Risk Contribution of Asset i**

[
RC_i = w_i \cdot (\Sigma w)_i / \sigma_p
]

---

## **14.5.4 Risk Parity Condition**

[
RC_1 = RC_2 = ... = RC_N
\quad = \frac{\sigma_p}{N}
]

This is nonlinear → solved via iterative methods.

---

# ======================================================

# **14.6 Hierarchical Risk Parity (HRP) Mathematics**

# ======================================================

HRP avoids matrix inversion.

---

## **14.6.1 Step 1 — Distance Matrix**

[
D_{ij} = \sqrt{\frac{1 - \rho_{ij}}{2}}
]

---

## **14.6.2 Step 2 — Clustering**

Use single-linkage hierarchical clustering.

---

## **14.6.3 Step 3 — Quasi-Diagonalization**

Reorder Σ according to cluster tree.

---

## **14.6.4 Step 4 — Recursive Bisection Weighting**

Split cluster into Left (L) and Right (R):

Cluster variance:

[
\sigma_L^2 = w_L^T \Sigma_L w_L
]
[
\sigma_R^2 = w_R^T \Sigma_R w_R
]

Weight assignment:

[
w_L = \frac{1/\sigma_L^2}{1/\sigma_L^2 + 1/\sigma_R^2}
]
[
w_R = 1 - w_L
]

Repeat recursively until single assets remain.

---

# ======================================================

# **14.7 CVaR Optimization Mathematics**

# ======================================================

CVaR (expected shortfall):

[
CVaR_\alpha(w) = E[r_p | r_p \le q_\alpha]
]

Where:

[
r_p = \sum_i w_i r_{i,t}
]

---

## **14.7.1 Rockafellar-Uryasev Linear Programming Form**

Introduce auxiliary variable (\eta):

[
\min_{w,\eta} \left( \eta

* \frac{1}{(1-\alpha)T} \sum_{t=1}^{T}
  \max, (0, -r_{p,t} - \eta) \right)
  ]

Since:

[
r_{p,t} = \sum_i w_i r_{i,t}
]

This produces a solvable LP.

---

# ======================================================

# **14.8 Constraints Mathematics**

# ======================================================

---

## **14.8.1 Weight Bounds**

[
w_{min,i} \le w_i \le w_{max,i}
]

---

## **14.8.2 Sector Caps**

For sector (s):

[
\sum_{i \in s} w_i \le \text{cap}_s
]

---

## **14.8.3 Turnover Limit**

[
\sum_i |w_i - w^{prev}*i| \le \tau*{max}
]

L1-penalty approximation:

[
\lambda \sum_i |w_i - w_i^{prev}|
]

---

## **14.8.4 Beta Limit**

Portfolio beta:

[
\beta_p = \sum_i w_i \beta_i
]

Constraint:

[
\beta_p \le \beta_{max}
]

---

## **14.8.5 Target Volatility**

[
w^T \Sigma w = \sigma_{target}^2
]

Implemented as penalty:

[
\min_w w^T\Sigma w

* \lambda (w^T\Sigma w - \sigma_{target}^2)^2
  ]

---

## **14.8.6 Factor Exposure Constraints**

Portfolio exposure:

[
F_{p,k} = \sum_i w_i F_{i,k}
]

Constraint:

[
F_{p,k} \ge F_{min,k}
]
[
F_{p,k} \le F_{max,k}
]

---

# ======================================================

# **14.9 Backtest Mathematics**

# ======================================================

---

## **14.9.1 Daily Portfolio Return**

[
r_{p,t} = \sum_i w_{i,t} r_{i,t}
]

---

## **14.9.2 NAV Evolution**

[
NAV_t = NAV_{t-1}(1+r_{p,t})
]

---

## **14.9.3 Drawdown**

[
DD_t = \frac{NAV_t - \max_{u \le t} NAV_u}{\max_{u \le t} NAV_u}
]

---

## **14.9.4 Turnover Calculation**

[
Turnover_t = \sum_i |w_{i,t} - w_{i,t^-}|
]

---

## **14.9.5 Transaction Cost Deduction**

[
NAV_t = NAV_{t^-} - \sum_i (TC \cdot |trade_value_i|)
]

---

## **14.9.6 Rolling Volatility Estimate**

[
\sigma_{p,t} = \sqrt{252} \cdot StdDev(r_{p,t-W:t})
]

---

# ======================================================

# **14.10 Attribution Mathematics (future version)**

# ======================================================

### Factor Attribution

[
Return_p = \sum_k F_{p,k} \cdot RP_k + \alpha
]

Where:

* (RP_k) = return to factor k
* (\alpha) = idiosyncratic return

### Sector Attribution

[
Return_{sector,s} = \sum_{i \in s} w_i r_i
]

---

# ======================================================

# **14.11 Mathematical Notes & Design Rationale**

# ======================================================

1. **Z-scoring exposures** ensures comparability across universes.
2. **Shrinkage covariance** avoids MPT instability.
3. **HRP’s recursive allocation** avoids matrix inversion, making it robust.
4. **Risk parity** represents true diversification rather than naive equal weights.
5. **CVaR optimization** models crisis performance realistically.
6. **Turnover constraints** stabilize portfolio evolution.

SigmaQLab’s design prioritizes:

* Mathematical rigor
* Practical stability
* Interpretability
* Transparency

---

# ======================================================

# **14.12 Summary**

This appendix provides the mathematical backbone for:

* Factor computation
* Risk modeling
* Optimization
* Constraints
* Backtesting

Every formula used inside the SigmaQLab quant engine is documented here, enabling:

* Full transparency
* Auditability
* Educational value
* Future extensibility (new factors, new optimizers)

This file completes the mathematical foundations of the PRD.

---

# ✔ FILE 14 COMPLETE

When you’re ready, say:

### **“Proceed to File 15”**

Next file:

# **15_Milestones_and_Versions.md**

This file will:

* Define delivery phases
* Break PRD into implementable sprints
* Assign milestone criteria
* Provide version roadmap (v1.0, v1.1, v2.0)
* Offer testing & validation guidelines

This will be the **execution roadmap** for building SigmaQLab’s factor & portfolio engine.
