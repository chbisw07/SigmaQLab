Below is **File 13**, containing the complete **wireframes and UI diagrams** for all new SigmaQLab Factor & Portfolio Construction pages.

Save as:

```
docs/PRD_Factor_Portfolio_v1/13_Wireframes.md
```

This file provides:

* Text-based wireframes (dev-friendly)
* Page structure diagrams
* Navigation flows
* Widget placement
* Component behavior notes
* Interaction logic

These wireframes serve as a design reference for the frontend engineers and also function as UX documentation parallel to the PRD.

---

# ------------------------------------------

# **13_Wireframes.md**

# ------------------------------------------

# **13. Wireframes & UI Interaction Diagrams**

---

## **13.1 Purpose of This Document**

This document provides **UX wireframes**, **layouts**, and **UI flows** for:

* Factor Screener
* Group Detail View
* Portfolio Construction
* Efficient Frontier UI
* Backtest Simulator
* Portfolio Analytics Dashboard

Wireframes are:

* Low-fidelity, text-based diagrams
* Framework-agnostic (React development friendly)
* Designed to match SigmaQLab’s minimal & clean design system

These UI layouts reference specifications from:

* Files 08 (Screener UI)
* File 09 (Portfolio Construction UI)
* File 10 (Backtest Integration)

---

# ==========================================

# **13.2 Factor Screener — Main Page Wireframe**

# ==========================================

```
+---------------------------------------------------------------+
|  Factor Screener                                              |
+---------------------------------------------------------------+
| Universe: [NSE_ALL ▼]     As-of Date: [2025-01-31 ▼]         |
| [Run Screener]                                               |
+---------------------------------------------------------------+

Filters (Builder)
---------------------------------------------------------------
[ + Add Filter ]
   ├── Field: [ROE ▼] Operator: [> ▼] Value: [15]
   ├── Field: [Value ▼] Operator: [≥ ▼] Value: [0.5]
   ├── Field: [Debt/Equity ▼] Operator: [< ▼] Value: [0.6]
AND/OR Relationship Selector

Ranking
---------------------------------------------------------------
Primary Sort: [Quality ▼] Order: [Descending ▼]
Secondary Sort: [Value ▼] Order: [Descending ▼]
Limit: [Top 30 ▼]

+-----------------+
| Run Screener    |
+-----------------+

Results Table
---------------------------------------------------------------
| Symbol | Sector  | MktCap | Value | Quality | Mom | LV | Size |
|--------|---------|--------|--------|----------|-----|-----|------|
| TCS    | IT      | 1234Cr | 0.74  | 1.22     | -.12| 0.4 | -0.6 |
| HDFCBK | Finance | 2000Cr | 0.52  | 0.87     | 0.3 | 0.1 | -0.8 |
| ...                                                            |

[Save as Group]    [Export CSV]
```

### Screener Interaction Notes

* Filters expand/collapse
* Factor chips show color gradients (optional)
* Sticky header for actions

---

# ==========================================

# **13.3 Group Detail Page Wireframe**

# ==========================================

```
+---------------------------------------------------------------+
| Group: QualityTop30                                           |
+---------------------------------------------------------------+

Metadata Panel
---------------------------------------------------------------
Created: 2025-01-31
Universe: NSE_ALL
Symbol Count: 30

[Re-run Screener] [Edit Group Name]

Group Members Table
---------------------------------------------------------------
| # | Symbol | Sector | Value | Quality | Mom | LV | Size |
|---|--------|--------|--------|----------|-----|------|-----|
| 1 | TCS    | IT     | 0.74  | 1.22     | ... | ...  | ... |
| 2 | HDFCBK | Fin    | 0.52  | 0.87     | ... | ...  | ... |
| ...                                                           |

[Send to Portfolio Constructor]
```

---

# ==========================================

# **13.4 Portfolio Construction — Main Wireframe**

# ==========================================

```
+---------------------------------------------------------------+
| Portfolio Construction                                        |
+---------------------------------------------------------------+

Portfolio Metadata
---------------------------------------------------------------
Code: [QLT30]       Name: [Quality 30 Portfolio]
Description: [Long-only quality portfolio]
Universe Group: [QualityTop30 ▼]   [View Group]

Optimization Mode
---------------------------------------------------------------
(●) Max Sharpe        (○) Min Variance       (○) Risk Parity
(○) HRP               (○) CVaR Optimization  (○) Efficient Frontier
(○) Equal Weight      (○) Market-Cap

ⓘ Description Box:
Max Sharpe finds the portfolio with highest risk-adjusted returns...

Constraints ▼
---------------------------------------------------------------
Weight Bounds:
   Min weight: [0%]      Max weight: [10%]

Sector Limits:
   IT: [25%]    Finance: [30%]    Pharma: [20%] ...

Turnover Limit: [10%]
Target Volatility: [12%]
Factor Constraints:
   Value ≥ [0.3]
   Quality ≥ [0.3]
   Momentum ≤ [0]
Max Beta: [1.0]

[Run Optimization]

---------------------------------------------------------------
Optimization Results Preview
---------------------------------------------------------------

Weights Table
---------------------------------------------------------------
| Symbol | Weight | Sector | Value | Quality | Mom | LV |
|--------|--------|--------|--------|----------|-----|-----|
| TCS    | 8.2%   | IT     | 0.74  | 1.22     | ... | ... |
| ...                                                            |

Charts
---------------------------------------------------------------
[Sector Allocation Pie]  [Factor Exposure Radar]  [Risk Contribution Bars]

Risk Summary
---------------------------------------------------------------
Vol: 14.2% | Sharpe: 0.92 | Beta: 0.88 | CVaR: -3.5 |

Diagnostics:
---------------------------------------------------------------
- Sector cap binding: IT
- Beta constraint binding: 1.0
- Turnover applied: 8%

[Save Portfolio]   [Backtest Portfolio]
```

---

# ==========================================

# **13.5 Efficient Frontier UI Wireframe**

# ==========================================

```
+---------------------------------------------------------------+
| Efficient Frontier                                            |
+---------------------------------------------------------------+

[Compute Frontier] → Fetches 20–40 points

Plot Area
---------------------------------------------------------------
Risk (X-axis) vs Return (Y-axis)
Frontier curve drawn with dots.

Hover Tooltip:
Risk: 0.12
Return: 0.10
Sharpe: 0.83

Controls Panel
---------------------------------------------------------------
Target Risk Slider: [------●------] (12%)
Show only efficient points: [✓]

Point Detail Panel
---------------------------------------------------------------
Optimal Point @ 12% Risk:
   Return: 10.0%
   Vol: 12.0%
   Sharpe: 0.83

[Use These Weights for Portfolio]
```

---

# ==========================================

# **13.6 Backtest Configuration Wireframe**

# ==========================================

```
+---------------------------------------------------------------+
| Backtest Configuration                                        |
+---------------------------------------------------------------+

Portfolio: [QLT30]
Start Date: [2019-01-01 ▼]
End Date:   [2024-01-01 ▼]
Rebalance Frequency: [Monthly ▼]
Transaction Cost: [0.10%]
Initial Capital: [100]

[Run Backtest]

Status:
---------------------------------------------------------------
Running... Completed in 0.8s
```

---

# ==========================================

# **13.7 Backtest Results & Analytics Wireframe**

# ==========================================

```
+---------------------------------------------------------------+
| Backtest Results — QLT30                                      |
+---------------------------------------------------------------+

Performance Summary
---------------------------------------------------------------
Total Return: 68%
CAGR: 10.5%
Max Drawdown: -18%
Sharpe: 0.92
Volatility: 14.0%
Beta: 0.81
CVaR: -3.9

Charts
---------------------------------------------------------------
[Equity Curve Line Chart]
[Drawdown Chart]
[Rolling Volatility Chart]
[Rolling Sharpe Chart]

Factor Exposure Over Time
---------------------------------------------------------------
Date     Value   Quality   Momentum   LowVol   Size
-----------------------------------------------------
2019-01  0.22     0.45       -0.1       0.2      -0.3
...

Sector Allocation Over Time
---------------------------------------------------------------
Stacked area chart of sector weights.

Trades Summary
---------------------------------------------------------------
| Rebalance Date | Symbol | Shares | Value | Cost |
---------------------------------------------------------------
| 2019-02-01     | TCS    | +10    | 12000 |   12 |
| ...                                               |

[Download Full Backtest Report]  [Export CSV]
```

---

# ==========================================

# **13.8 Mobile & Responsive Considerations**

# ==========================================

* Screener table → horizontal scroll
* Radar charts collapse into stacked bars
* Portfolio Construction cards collapse into vertical column
* Efficient Frontier graph → tap-enabled tooltips

---

# ==========================================

# **13.9 Navigation Flow Diagram**

# ==========================================

```
Universe → Screener → Group → Portfolio Constructor → Backtest → Analytics
```

Expanded:

```
Universe
  ↓
Screener
  → Create Group
       ↓
       Group Details
         ↓
         Portfolio Construction
              ↓ Run Optimization
              ↓ Save Portfolio
                 ↓
                 Backtest Config
                    ↓ Run
                    ↓
                    Backtest Results
                       ↓
                       Analytics Dashboard
```

Complete and intuitive research workflow:

1. Build group (using screener)
2. Construct optimized portfolio
3. Backtest
4. Evaluate
5. Iterate

---

# ==========================================

# **13.10 Component List**

### Screener Page Components

* UniverseSelector
* FilterBuilder
* RankingConfig
* ScreenerTable
* GroupCreatorModal

### Portfolio Constructor Components

* OptimizerSelector
* ConstraintPanel
* WeightPreviewTable
* Charts (SectorPie, FactorRadar, RiskBars)
* DiagnosticsPanel

### Efficient Frontier Components

* FrontierPlot
* TargetRiskSlider
* WeightExtractionPanel

### Backtest Components

* ConfigPanel
* BacktestSummaryCard
* EquityCurve
* DrawdownPlot
* FactorExposureChart
* TradesTable

---

# ==========================================

# **13.11 Summary**

These wireframes define the complete UI/UX flow for:

* Screening
* Group creation
* Portfolio construction
* Optimization visualization
* Backtest execution
* Performance analytics

They provide developers:

* A blueprint for layout
* Guidance for UX interactions
* A bridge between frontend & quant engine

This chapter ties together the user-facing experience of SigmaQLab’s new quant capabilities.

---

# ✔ FILE 13 COMPLETE

When you're ready, say:

### **“Proceed to File 14”**

Next file:

# **14_Appendix_Mathematics.md**

This file will contain **all core mathematical derivations and formulas**:

* Covariance shrinkage (Ledoit-Wolf)
* MinVar closed-form
* MaxSharpe derivation
* Efficient Frontier math
* Risk parity MCTR equations
* HRP clustering formulas
* CVaR optimization LP formulation
* Factor normalization & z-score math

This appendix is the mathematical backbone for developers and quant researchers.
