Below is **File 09**, the complete specification for the **Portfolio Construction UI** — one of the most user-visible and strategically important components of the entire system.

Save as:

```
docs/PRD_Factor_Portfolio_v1/09_Portfolio_Construction_UI.md
```

This file includes:

* UI layout
* User workflow
* All settings & constraints (how surfaced in UI)
* Interaction with optimizer
* Weight preview panel
* Factor exposure chart
* Validation & warnings
* Post-optimization actions
* Example use cases
* Wireframe-level detail

---

# ------------------------------------------

# **09_Portfolio_Construction_UI.md**

# ------------------------------------------

# **9. Portfolio Construction UI — Product & UX Specification**

---

## **9.1 Purpose of This Document**

The **Portfolio Construction UI** is where users transform a set of stocks (Group) into a fully optimized portfolio using:

* SigmaQLab’s multi-factor model
* Risk model (covariance, vol, beta, HRP, CVaR)
* Full Optimization Engine (EW, MCW, MinVar, MaxSharpe, HRP, CVaR, Efficient Frontier)
* Constraint System (weight bounds, sector caps, turnover, factor targets, beta limits, etc.)

This UI must make complex quant processes feel effortless, transparent, and intuitive.

---

# **9.2 High-Level Design Goals**

1. Support **all optimizers** with clean UX
2. Clearly surface **constraints**
3. Provide **diagnostics** and **warnings**
4. Provide **visual previews** of weights and factor exposures
5. Integrate smoothly into backtesting flow
6. Support step-by-step construction (wizard-style)
7. Maintain elegance & simplicity despite quant complexity

The design takes inspiration from:

* BlackRock Aladdin Portfolio Constructor
* Morningstar Direct
* Portfolio123 Simulation Constructor
* QuantConnect Lean Portfolio Optimizer
* MSCI Barra Optimizer (simplified)

---

# **9.3 Portfolio Creation Workflow Overview**

```
[Select Group]
    → [Choose Optimization Mode]
        → [Set Constraints]
            → [Run Optimization]
                → [Preview Weights]
                    → [Save Portfolio]
                        → [Backtest Portfolio]
```

This workflow is used for both Quant Beginners and Professionals.

---

# **9.4 UI Layout Overview**

The Portfolio Construction UI contains **five primary panels**:

1. **Portfolio Metadata Panel**
2. **Universe Selection Panel**
3. **Optimization Configuration Panel**
4. **Constraints Panel**
5. **Preview & Diagnostics Panel**

---

## **9.4.1 Panel 1 — Portfolio Metadata Panel**

Fields:

```
Portfolio Code
Portfolio Name
Description
Base Currency (INR by default)
Universe Group (dropdown)
```

Metadata is saved before optimization is run.

---

## **9.4.2 Panel 2 — Universe Selection Panel**

Users must pick an existing **Group** created from:

* Universe selection
* Screener results
* Custom user-defined lists

UI:

```
Universe Group: [dropdown]
Symbols Count: 50
[View Group Details]
```

Pressing "View Group Details" opens a modal showing:

* Symbol list
* Sector distribution
* Factor distribution summary
* Market-cap distribution

---

# ------------------------------------------

# **9.5 Optimization Configuration Panel**

# ------------------------------------------

The core heart of the UI.

Users select **one optimization mode**:

### **A. Equal Weighted (EW)**

### **B. Market-Cap Weighted (MCW)**

### **C. Risk Parity (RP)**

### **D. Minimum Variance (MinVar)**

### **E. Maximum Sharpe Ratio**

### **F. Efficient Frontier (Interactive)**

### **G. Hierarchical Risk Parity (HRP)**

### **H. CVaR Optimization (Advanced)**

Displayed as:

```
[●] Max Sharpe
[○] Min Variance
[○] Risk Parity
[○] HRP
[○] CVaR Optimization
[○] Equal Weight
[○] Market-Cap
[○] Efficient Frontier (launch UI)
```

When users select an option, the following occur:

* Description panel updates
* Required inputs appear
* Optional parameters become visible

---

## **9.5.1 Optimization Mode Explanations**

Each mode contains:

* Tooltip icon (ⓘ)
* Mathematical explanation (mini version from File 06)
* Pros and cons
* Graphical aids for Efficient Frontier

---

## **9.5.2 Expected Returns Source**

For Max Sharpe / Efficient Frontier:

Users may choose:

* Historical mean (default)
* Custom expected return (future version)

UI:

```
Expected Returns Mode:
   (●) Historical Mean
   (○) Constant (set manually)
   (○) Upload CSV (future)
```

---

# ------------------------------------------

# **9.6 Constraints Panel**

# ------------------------------------------

Constraints make portfolio construction realistic.
Users configure constraints in a dedicated collapsible panel:

```
▼ Constraints
```

Inside:

---

## **9.6.1 Weight Constraints**

```
Min weight per stock: [0% slider]
Max weight per stock: [10% slider]
```

Integer/decimal support.

---

## **9.6.2 Sector Constraints**

```
Max weight per sector:
   IT: [input or slider] %
   Financials: [input]
   Energy: [input]
   ...
```

Only sectors present in group are displayed.

---

## **9.6.3 Turnover Constraint**

Only used during backtest rebalancing:

```
Max turnover per rebalance: [10% slider]
```

---

## **9.6.4 Target Volatility**

```
Target portfolio volatility: [optional input] %
(If blank → no vol constraint)
```

Automatically paired with MinVar or MaxSharpe mode.

---

## **9.6.5 Factor Exposure Constraints**

Show factor chips with sliders or input boxes:

```
Value exposure minimum:   [0.2]
Quality exposure minimum: [0.3]
Momentum exposure max:    [0]
Low-Vol exposure minimum: [0]
Size exposure max:        [0.5]
```

Each:

* Greys out if factor exposure unavailable
* Shows error if constraint infeasible

---

## **9.6.6 Max Beta Constraint**

```
Max portfolio beta: [1.0]
(Leave blank for no limit)
```

---

# ------------------------------------------

# **9.7 Run Optimization Flow**

# ------------------------------------------

When user clicks:

```
[Run Optimization]
```

### The frontend collects:

* Universe symbols
* Selected optimization method
* All constraints
* As-of date (implicit)
* Previous weights (if editing portfolio)

### Sends to backend API:

```
POST /api/portfolio/optimize
```

Backend computes:

* Factor exposures
* Covariance matrix
* Expected returns
* Constraint feasibility
* Optimization solution
* Diagnostics

And returns:

* Weight vector
* Risk metrics
* Factor exposures of the portfolio
* Sector allocation
* Constraint warnings

---

# ------------------------------------------

# **9.8 Preview & Diagnostics Panel**

# ------------------------------------------

This panel appears AFTER optimization is evaluated.

### Panels:

---

## **9.8.1 Weight Table**

Columns:

* Symbol
* Weight
* Sector
* Factor exposures (brief)

Table supports:

* Sorting
* Download CSV
* Export to Group

---

## **9.8.2 Allocation Charts**

### A. Sector Allocation Pie

### B. Factor Exposure Radar/Spider Chart

### C. Risk Contributions Bar Chart

These visualizations help users understand the portfolio's characteristics.

---

## **9.8.3 Risk Summary Card**

Examples:

```
Portfolio Volatility: 14.2%
Portfolio Beta: 0.88
CVaR(95%): -3.5%
Sharpe Ratio (estimated): 0.92
Diversification Ratio: 1.32
```

---

## **9.8.4 Constraint Diagnostics**

Possible messages:

* “Sector constraint: IT reached maximum 25%.”
* “Beta constraint binding: portfolio beta capped at 1.0.”
* “Turnover constraint reduced allocation changes.”
* “Factor exposure (Value) required ≥0.2 → Achieved = 0.24.”
* “WARNING: Min weight constraint required for 50 stocks → sum(min) = 65% → reducing min weights.”

This transparency builds user trust.

---

# ------------------------------------------

# **9.9 Save Portfolio Workflow**

User clicks:

```
[Save Portfolio]
```

Saved with:

```
Portfolio metadata
Universe group
Optimizer selection
All constraints
Optimized weights
Diagnostics
Initialization timestamp
```

A new portfolio entry is created in:

```
portfolios table
portfolio_weights table
portfolio_constraints table
```

User is then prompted:

```
→ Run Backtest
→ Return to Portfolios List
```

---

# ------------------------------------------

# **9.10 Portfolio Editing Workflow**

When opening an existing portfolio:

* All settings preloaded
* Weights shown as “initial weights”
* “Re-optimize” button becomes available

Re-optimization uses:

* New factor data
* New risk model
* Updated constraints

---

# ------------------------------------------

# **9.11 Error Handling & Validation**

### **Case 1 — No stocks match constraints**

Solution: Show message and disable Run.

### **Case 2 — Optimization infeasible**

Backend returns:

* Feasibility warnings
* Suggestions (e.g., reduce target volatility, increase max weight)

UI displays error summary in red box.

### **Case 3 — Missing factor/fundamental data**

User may:

* Remove stock
* Continue with imputation warning

### **Case 4 — HRP incompatible with factor constraints**

UI displays:

```
HRP does not support factor constraints. Please disable them or switch optimizer.
```

---

# ------------------------------------------

# **9.12 Example User Workflows**

---

## **Workflow A — Building a Quality-Focused Defensive Portfolio**

1. Select Group: “QualityTop30”
2. Optimization Mode: Minimum Variance
3. Constraints:

   * Max weight 10%
   * Target volatility 12%
4. Run Optimization
5. Review weights
6. Save Portfolio
7. Run Backtest

---

## **Workflow B — Building a Multi-Factor Smart Beta Portfolio**

1. Select Group: “MF50”
2. Mode: Max Sharpe
3. Constraints:

   * Value ≥ 0.2
   * Quality ≥ 0.2
   * Momentum ≥ 0
   * Max sector weight 25%
4. Run Optimization
5. Save
6. Backtest

---

## **Workflow C — Using Efficient Frontier UI**

User clicks:

```
Launch Efficient Frontier
```

Interactive UI appears:

* Frontier curve
* Slider for risk
* Highlighted optimal portfolio
* Option to "Select this point" → used as optimized weights

---

# ------------------------------------------

# **9.13 UI Wireframe (Text-based)**

```
+-------------------------------------------------------------+
| Portfolio Construction                                      |
+-------------------------------------------------------------+

Portfolio Metadata
---------------------------------------------------------------
Code: [_____]    Name: [______________________]
Description: [______________________________________________]

Universe Group: [Dropdown ▼]   [View]

Optimization Mode
---------------------------------------------------------------
(●) Max Sharpe     (○) MinVar   (○) HRP   (○) CVaR   (○) RP   ...
[Description + tooltip]

Constraints  ▼
---------------------------------------------------------------
Weight bounds:
   Min weight: [0% slider]   Max weight: [10% slider]

Sector caps:
   IT: [25%]
   Financials: [30%]
   ...

Turnover: [10% slider]
Target Volatility: [12%]
Factor Exposure Constraints:
   Value ≥ [0.3]
   Quality ≥ [0.2]
   Momentum ≤ [0]
Max Beta: [1.0]

[Run Optimization Button]

---------------------------------------------------------------
Preview + Diagnostics
---------------------------------------------------------------

Weights Table:
| Symbol | Weight | Sector | Value | Quality | Mom | LV | Size |

Charts:
   [Sector Allocation]  [Factor Radar]  [Risk Bars]

Risk Summary:
   Vol: 14.2% | Sharpe: 0.92 | Beta: 0.88 | CVaR: -3.5%

Warnings:
   - Sector cap binding: IT
   - Factor constraint binding: Value

[Save Portfolio]  [Backtest Portfolio]
```

---

# ------------------------------------------

# **9.14 Summary**

The Portfolio Construction UI:

* Surfaces complex quant settings with intuitive UX
* Incorporates all optimization modes & constraints
* Provides full previews & diagnostics
* Integrates directly with backtesting
* Enables institutional-grade portfolio design in a self-explanatory workflow

This UI is crucial for making the quant engine **usable, understandable, and trustworthy**.

---

# ✔ FILE 09 COMPLETE

When you're ready, say:

### **“Proceed to File 10”**

Next file:

# **10_Backtest_Integration.md**

This file covers:

* How optimized portfolio weights feed into backtests
* Rebalancing logic
* Weight drift
* Transaction cost modeling
* PnL computation
* Factor exposure tracking
* Output metrics shown in Analytics UI

This ties everything together end-to-end.
