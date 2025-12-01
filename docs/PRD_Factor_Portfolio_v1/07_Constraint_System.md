Below is **File 07**, the full specification of the **Constraint System**, which governs how optimization behaves under real-world limitations such as weight bounds, sector caps, turnover limits, target factors, target volatility, and beta constraints.

Save as:

```
docs/PRD_Factor_Portfolio_v1/07_Constraint_System.md
```

This file is critical because **constraints define portfolio realism** — without them, optimizers can create mathematically optimal but practically unusable portfolios (extreme concentration, excessive turnover, sector imbalance, etc.).

This Constraint System ensures SigmaQLab behaves like professional-grade optimizers (AQR, BlackRock Aladdin, MSCI Barra).

---

# ------------------------------------------

# **07_Constraint_System.md**

# ------------------------------------------

# **7. Constraint System — Specification & Mathematical Framework**

---

## **7.1 Purpose of This Document**

The Constraint System defines all supported portfolio construction constraints in SigmaQLab v1.
It explains:

* Weight constraints
* Sector constraints
* Turnover constraints
* Target volatility constraints
* Factor exposure constraints
* Max beta constraint
* Feasibility detection
* Constraint resolution logic
* Integration with optimization algorithms

These constraints make portfolio construction realistic, controlled, and robust.

---

# **7.2 Why Constraints Matter (Industry Context)**

Professional portfolio optimization *always* requires constraints because:

* Sample covariance matrices can produce unstable solutions.
* Optimizers tend to concentrate weights in a few assets.
* Portfolios may unintentionally take extreme factor exposures.
* Sector concentration creates catastrophic downside risk.
* Excessive turnover generates high transaction costs.
* Beta drift exposes investors to unwanted systematic risk.

Every quant PM system — BlackRock Aladdin, JPM Athena, AQR, MSCI Barra — uses a similar constraint framework.

SigmaQLab's Constraint System brings institutional-grade discipline into portfolio construction.

---

# **7.3 Types of Constraints Supported**

SigmaQLab v1 supports **seven major constraint categories**, all selectable by user in Portfolio Settings:

| Constraint Type                    | Description                          |
| ---------------------------------- | ------------------------------------ |
| **1. Weight Bounds**               | Min/max per-stock allocation         |
| **2. Sector Weight Limits**        | Caps per sector                      |
| **3. Turnover Constraints**        | Limit trading activity               |
| **4. Target Volatility**           | Achieve desired portfolio volatility |
| **5. Factor Exposure Constraints** | Min/max exposures to factors         |
| **6. Max Beta Constraint**         | Cap market beta                      |
| **7. Budget Constraint**           | Ensures weights sum to 1             |

Each is explained in detail below.

---

# ======================================================

# **7.4 Constraint 1 — Weight Bounds**

# ======================================================

Weight bounds prevent concentration and over-allocation.

### Mathematical Form

[
w_{min,i} \le w_i \le w_{max,i}
]

### SigmaQLab Defaults:

* (w_{min,i} = 0) (long-only portfolios)
* (w_{max,i} = 0.20) (20%)

### Benefits

* Prevents optimizer from allocating 80–90% into one low-vol stock
* Ensures diversification
* Produces stable results

### Implementation Notes

* Bounds enforced in QP/LP solvers
* HRP inherently respects bounding by weight normalization

---

# ======================================================

# **7.5 Constraint 2 — Sector Max Weights**

# ======================================================

Sector constraint prevents overexposure to a single sector (e.g., IT = 45% of weights).

### Mathematical Form

[
\sum_{i \in S_k} w_i \le sector_{max,k}
]

Where:

* (S_k) = set of assets in sector k
* `sector_max` = user-defined (e.g., 25%)

### Example

If max Financials = 30%:

[
w_{HDFC} + w_{ICICI} + w_{KOTAK} + ... \le 0.30
]

### Benefits

* Prevents sector risk
* Required for PMS-style compliance
* Reflects realistic investment mandates

### Implementation Notes

* Implemented as linear inequality in QP
* Violations push weight to other sectors

---

# ======================================================

# **7.6 Constraint 3 — Turnover Constraint**

# ======================================================

Turnover constraint limits trading costs and preserves stability.

### Mathematical Form

[
\sum_i |w_i - w^{prev}*i| \le \tau*{max}
]

Where:

* (w^{prev}) = previous rebalance weights
* (\tau_{max}) = turnover threshold (e.g., 10%)

### Benefits

* Reduces rebalancing noise
* Improves tax efficiency
* Required for recurring backtests
* Reduces optimizer oscillations

### Implementation Notes

* Use L1-penalty approximation for absolute value
* Convert constraint into LP or penalized QP form

---

# ======================================================

# **7.7 Constraint 4 — Target Volatility**

# ======================================================

Portfolio must meet a specified volatility.

### Mathematical Requirement

[
\sqrt{w^T \Sigma w} = \sigma_{target}
]

Two ways to enforce:

### (A) Equality Constraint

Direct enforcement:

[
w^T\Sigma w = \sigma_{target}^2
]

### (B) Penalty Method (recommended)

Modify objective:

[
\min_w w^T\Sigma w + \lambda(w^T\Sigma w - \sigma_{target}^2)^2
]

### Benefits

* Helps build portfolios matching risk profiles
* Used in risk-budgeted models
* Allows user to design custom defensive/aggressive portfolios

### Implementation Notes

* Use penalty method to avoid infeasible QP
* HRP cannot directly incorporate target volatility

---

# ======================================================

# **7.8 Constraint 5 — Factor Exposure Constraints**

# ======================================================

Allows user to control exposures to:

* Value
* Quality
* Momentum
* Low Volatility
* Size

### Factor Exposure of Portfolio

[
F_{p,k} = \sum_i w_i F_{i,k}
]

Where (F_{i,k}) = factor exposure of stock i for factor k.

### Constraints

[
F_{p,k} \ge F^{min}_k
]

[
F_{p,k} \le F^{max}_k
]

### Example

Require:

* Value > 0.3
* Quality > 0.2
* Momentum < 0

### Benefits

* Creates factor-tilted portfolios
* Allows construction of smart-beta themes
* Controls unintended exposures

### Implementation Notes

* Implement as linear constraints
* Maps well into QP/LP frameworks
* Synergistic with MaxSharpe and MinVar

---

# ======================================================

# **7.9 Constraint 6 — Max Beta Constraint**

# ======================================================

Limits systematic market risk.

### Portfolio Beta

[
\beta_{p} = \sum_i w_i \beta_i
]

Constraint:

[
\beta_p \le \beta_{max}
]

Example:

* Beta ≤ 0.90 → defensive portfolio
* Beta ≥ 1.10 → aggressive portfolio

### Benefits

* Controls market sensitivity
* Essential for risk-managed portfolios

### Implementation Notes

* Linear constraint
* Beta must be fetched from Risk Model Layer

---

# ======================================================

# **7.10 Constraint 7 — Budget Constraint**

# ======================================================

Always enforced:

[
\sum_i w_i = 1
]

With:

[
w_i \ge 0
]

This ensures long-only, fully invested portfolios.

---

# ======================================================

# **7.11 Constraint Interaction & Priorities**

# ======================================================

When multiple constraints are active, conflicts may arise.

### Internal Priority Order

1. **Budget constraint (must always hold)**
2. **Bounds (min/max per stock)**
3. **Sector constraints**
4. **Turnover constraint**
5. **Max Beta**
6. **Factor exposure constraints**
7. **Target volatility**
8. **Objective maximization (Sharpe, CVaR, HRP)**

This ensures:

* Hard constraints are honored first
* Soft constraints (like target vol) may be relaxed

---

# ======================================================

# **7.12 Constraint Feasibility Checker**

# ======================================================

Before running optimization, system checks:

### 1. Feasibility of bounds

If:

[
\sum_i w_{min,i} > 1 \quad \text{or} \quad \sum_i w_{max,i} < 1
]

→ infeasible.

### 2. Sector constraints

If one sector minimum > maximum feasible → infeasible.

### 3. Factor exposures

Check:

[
\sum_i F_{i,k} w_{max,i} < F^{min}_k
]

→ infeasible.

### 4. Beta

If:

[
\sum_i w_{min,i} \beta_i > \beta_{max}
]

→ infeasible.

### 5. Turnover

Turnover + new bounds must be achievable.

In case of infeasibility:

* Provide user-readable error
* Suggest relaxations
* Optionally auto-relax constraints (future version)

---

# ======================================================

# **7.13 Constraint Resolution (When Infeasible)**

SigmaQLab uses multi-level resolution:

### **Level 1: Relax soft constraints**

* Relax target volatility
* Relax non-binding factor constraints

### **Level 2: Proportional relaxation**

Relax limits by fixed delta (e.g., +5%).

### **Level 3: Fallback Optimizer**

If constraints cannot be met:

* Fall back to MinVar or EW
* Display warning to user

---

# ======================================================

# **7.14 Integration with Optimization Algorithms**

### EW

* Only weight bounds enforced

### MCW

* Harder to enforce constraints
* If constraints active → solve QP on MCW target vector

### Risk Parity

* Constraints enforced through penalty QP

### MinVar

* All linear constraints supported natively

### MaxSharpe

* All linear constraints + target vol

### Efficient Frontier

* All constraints supported
* Target return vs constraints adjusted

### HRP

* Supports only: weight bounds
* Sector/factor constraints require QP overlay after HRP weights (optional future)

### CVaR

* Handles all constraints in LP formulation

---

# ======================================================

# **7.15 Constraint Configuration in UI**

Portfolio Settings Page exposes:

```
Max weight per stock: slider (5%–50%)
Min weight per stock: slider (0%–5%)
Max sector weight: per-sector list
Max turnover per rebalance: slider (0%–50%)
Target volatility: optional field
Target factor exposures: per factor
Max portfolio beta: optional field
```

Users can toggle constraints on/off and specify values.

---

# ======================================================

# **7.16 Example Constraint Specification**

### Example Portfolio (illustration)

```
Construction Mode: Max Sharpe
Constraints:
  - Each stock weight ≤ 10%
  - Each stock weight ≥ 1%
  - Sector cap: 25%
  - Turnover limit: 10%
  - Target volatility: 12%
  - Factor exposure:
        Value ≥ 0.3
        Quality ≥ 0.2
  - Max Beta: 1.0
```

### Resulting Optimization Problem

[
\max_w \frac{w^T\mu}{\sqrt{w^T\Sigma w}}
]

Subject to:

* Weight bounds
* Sector caps
* Turnover limit
* Beta constraint
* Factor constraints
* Budget constraint

This is solved via QP with penalties for soft constraints.

---

# ======================================================

# **7.17 Summary**

The Constraint System in SigmaQLab v1 is designed to be:

* Flexible
* Robust
* Industry-standard
* Fully integrated with all optimizers
* Mathematically well-defined
* Aligned with real-world investment workflows

By implementing these constraints, SigmaQLab enables:

* Practical portfolio construction
* Risk-managed allocations
* Smart-beta development
* Institutional-quality backtests
* Multi-factor controlled exposures

This system is a cornerstone of reliable and realistic portfolio construction.

---

# ✔ FILE 07 COMPLETE

When ready, say:

### **“Proceed to File 08”**

Next file:

# **08_Factor_Screener_UI.md**

This file covers:

* UI design
* Rule engine
* Filtering & ranking logic
* Output → Group creation
* Backend APIs
* Performance considerations

This is where users interact with factors directly.
