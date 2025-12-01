Below is **File 08**, the complete specification for the **Factor Screener UI**, which serves as the user’s entry point into factor-based stock selection.

Save it under:

```
docs/PRD_Factor_Portfolio_v1/08_Factor_Screener_UI.md
```

This document is essential because the Screener is the "research front-end" for portfolio construction. It includes:

* UI/UX design
* Functional behavior
* Supported rules & filters
* Ranking system
* Group creation
* Integration with Factor Data Layer
* Backend APIs
* Example workflows
* Performance considerations

---

# ------------------------------------------

# **08_Factor_Screener_UI.md**

# ------------------------------------------

# **8. Factor Screener UI — Product & UX Specification**

---

## **8.1 Purpose of This Document**

The **Factor Screener UI** allows users to:

* Apply factor-based filters
* Apply fundamental filters
* Combine multiple quantitative rules
* Rank stocks based on factor scores or fundamentals
* Limit results (Top N)
* Save selected stocks as a new **Group**
* Use the group for Portfolio Construction or Backtesting

It functions as SigmaQLab’s **quantitative research interface**, similar to:

* Portfolio123 Stock Ranking System
* Bloomberg Equity Screener
* TradingView Screener (but much more powerful for factors)
* MSCI Barra tools (but simplified for usability)

---

# **8.2 High-Level Design Goals**

1. **Fast and intuitive** UI for users with or without quant backgrounds
2. Ability to build **multi-condition rules**
3. Allow both **filtering** and **ranking**
4. Allow creation of **Top-N** portfolios
5. Export results into **Groups**, which seamlessly feed into Portfolio Construction
6. Provide factor visualization (sparklines or chips)
7. Show latest **as-of date** of factor data
8. Provide consistent UX with existing Universe & Groups pages

---

# **8.3 Screener Workflow Summary**

```
Universe → Apply Filters → Rank → Select Top N → Save as Group → Construct Portfolio
```

This research workflow mirrors institutional quant pipelines.

---

# **8.4 Screen Layout**

### **UI Sections**

1. **Top Bar**

   * Universe selector
   * “As of date” selector
   * Run Screener button

2. **Filter Builder Panel**

   * Add filter condition
   * Condition types: fundamentals, factors, price metrics, liquidity
   * AND/OR aggregation

3. **Ranking Panel**

   * Primary ranking metric
   * Secondary ranking metric
   * Order (ascending/descending)
   * Result limit selection

4. **Results Table**

   * All filtered + ranked stocks
   * Factor exposures
   * Fundamentals
   * Sector / Market Cap / Liquidity
   * Selectable rows

5. **Actions**

   * Save as Group
   * Export CSV
   * Add directly to Portfolio Creation

---

# **8.5 Universe Selector**

Users may choose from:

* All NSE stocks (default)
* NIFTY 50 / NIFTY 100 / NIFTY 500
* Custom user-defined universes
* Sector-specific universes (optional)

The screener runs only on selected universe.

---

# **8.6 “As-of Date” Selector**

Since factors/fundamentals may change over time, user selects:

```
As of: [latest ▼]
```

Options:

* Latest snapshot
* Historical dates (used for backtests or research)

Backend logic ensures factors correspond to correct date.

---

# **8.7 Filter Builder Engine**

Filters allow users to screen based on:

---

## **8.7.1 Category A — Fundamental Filters**

| Field             | Operator      | Value Type |
| ----------------- | ------------- | ---------- |
| PE                | <, ≤, ≥, >    | number     |
| PB                | same          | number     |
| ROE               | same          | %          |
| ROCE              | same          | %          |
| Debt-to-Equity    | <, ≤, =, etc. | number     |
| Sales Growth YoY  | ≥             | %          |
| Profit Growth YoY | ≥             | %          |
| EPS Growth        | ≥             | %          |

Examples:

* PE < 20
* ROE > 15
* Debt/Equity < 0.5

---

## **8.7.2 Category B — Factor Filters**

| Factor   | Operator | Description      |
| -------- | -------- | ---------------- |
| Value    | ≥, ≤     | normalized score |
| Quality  | ≥, ≤     | normalized score |
| Momentum | ≥, ≤     | normalized score |
| Low-Vol  | ≥, ≤     | normalized score |
| Size     | ≥, ≤     | normalized score |

Example:

* Value ≥ 0.5
* Momentum ≤ −0.2

Backend retrieves exposures from `factor_exposures`.

---

## **8.7.3 Category C — Price-Based Filters**

| Field               | Examples               |
| ------------------- | ---------------------- |
| 1M/3M/6M/1Y returns | return_12m > 10%       |
| 52W high/low %      | within 10% of 52W high |
| Volatility          | vol < 25%              |

---

## **8.7.4 Category D — Liquidity Filters**

| Field      | Examples  |
| ---------- | --------- |
| Avg volume | > 200k    |
| Market-cap | > 5000 Cr |

---

## **8.7.5 Rule Combining**

Conditions can be combined with:

* AND
* OR
* Parentheses for precedence

Example:

```
(ROE > 15 AND Quality > 0.3) AND (Momentum < 0)
```

---

# **8.8 Ranking Engine**

After filtering:

### Primary ranking field:

* Composite factor score
* Individual factor (e.g., Momentum descending)
* ROE descending
* Market-cap ascending
* Custom selects (future version)

### Secondary ranking:

Used when ties occur.

### Order:

* Ascending
* Descending

### Limit:

```
Take top N:
- 10
- 20
- 30
- custom
```

---

# **8.9 Results Table Specification**

Columns include:

### **Identity**

* Symbol
* Name
* Sector
* Segment

### **Fundamentals**

* PE
* PB
* ROE
* Debt/Equity
* Market Cap

### **Factors**

* Value (chip with gradient color)
* Quality
* Momentum
* Low-Vol
* Size
* Composite factor score

### **Price Metrics**

* Volatility
* 1-year return

### Interaction:

* Sort by any column
* Multi-column sort
* Checkbox selection

---

# **8.10 Group Creation**

User may create a group:

```
Group Name: [FactorValue_30]
Description: Auto-created from Screener on <date>
Include weights? No (weights defined during Portfolio Construction)
```

Saved into:

`groups` table.

Later used in:

* Portfolio Construction UI
* Backtesting workflow

---

# **8.11 Screener API Architecture**

Frontend → Backend

### **POST /api/screener/run**

Request:

```
{
  "universe": "NSE_ALL",
  "as_of_date": "2025-01-31",
  "filters": [
     {"field": "ROE", "op": ">", "value": 15},
     {"field": "Value", "op": ">=", "value": 0.3}
  ],
  "ranking": {
      "primary": {"field": "Quality", "order": "desc"},
      "secondary": {"field": "Value", "order": "desc"},
      "limit": 30
   }
}
```

Response:

```
[
  {
    "symbol": "TCS",
    "sector": "IT",
    "value": 0.74,
    "quality": 1.22,
    "momentum": -0.12,
    ...
  },
  ...
]
```

### **POST /api/groups/create_from_screener**

Used to save the result.

---

# **8.12 Performance Considerations**

### Expected Universe Size:

* 500–1000 stocks

### Performance goals:

* Filter + ranking < 150ms
* Table render < 50ms
* Group creation < 10ms

### Optimizations:

* Pre-cache factor tables
* Pre-cache fundamentals
* Vectorized filtering
* Avoid DB round-trips per stock

---

# **8.13 Example Screener Workflows**

---

## **8.13.1 Example 1 — High Quality + Reasonable Value Portfolio**

Filters:

* ROE > 15
* Debt/Equity < 0.5
* Value ≥ 0
* Quality ≥ 0.5

Rank:

* Primary: Quality (desc)
* Limit: 30

Output:

* Creates a “HighQuality30” group

---

## **8.13.2 Example 2 — Momentum Crash Avoidance**

Filters:

* Momentum ≤ 0
* Low Vol ≥ 0.5

Rank:

* Primary: Low-Vol (desc)
* Limit: 20

---

## **8.13.3 Example 3 — Multi-Factor Balanced Portfolio**

Filters:

* Value ≥ 0
* Quality ≥ 0
* Momentum ≥ 0

Rank:

* Composite factor score
* Limit: 50

---

# **8.14 Error Handling**

### Missing factor data:

* Display red badge
* Allow exclusion or imputation

### Missing fundamentals:

* Display warning
* Allow the user to toggle “exclude missing”

### Infeasible filters:

(e.g., PE < 0 AND MarketCap > 500 Cr AND Sector = IT but no stocks match)

* Show “0 results”
* Suggest filter relaxation

---

# **8.15 Future Enhancements**

* Factor regression analysis
* Factor return charts
* Multi-period factor stability panel
* Save/load screener templates
* Multi-universe comparison mode

---

# **8.16 Summary**

The Factor Screener UI is SigmaQLab’s **research gateway**:

* Flexible filtering
* Multi-factor ranking
* Fast execution
* UI consistent with Quant apps like Portfolio123
* Direct integration into Portfolio Construction

It is intentionally simple to use yet powerful enough to support institutional quant workflows.

---

# ✔ FILE 08 COMPLETE

When ready, say:

### **“Proceed to File 09”**

Next file:

# **09_Portfolio_Construction_UI.md**

This file explains:

* UI layout for portfolio creation
* How constraints appear in UI
* How optimizer settings appear
* Flow diagrams
* Example portfolios
* Validation inside UI before running optimization

This is one of the most user-facing documents in the PRD.
