Below is the complete **File 04** for your PRD.

Save it under:

```
docs/PRD_Factor_Portfolio_v1/04_Factor_Definitions_and_Models.md
```

This is one of the **most important and most detailed** PRD files, because factors are the intellectual core of quantitative investing.
The document includes:

* Mathematical definitions
* Industry standards (MSCI, AQR, Barra, Fama-French)
* Data transformations
* Factor construction pipeline
* Design choices for SigmaQLab
* Implementation notes

---

# ------------------------------------------

# **04_Factor_Definitions_and_Models.md**

# ------------------------------------------

# **4. Factor Definitions and Models**

---

## **4.1 Purpose of This Document**

This document defines the **institutional-grade factor model** implemented in SigmaQLab v1.

It provides:

* Theoretical background
* Industry practices
* Raw signals required
* Normalization process
* Mathematical formulas
* Final factor exposure vector

Factors are the essential building blocks for:

* Stock selection
* Constructing optimized portfolios
* Managing factor exposures
* Understanding risk
* Generating smart-beta models
* Performance attribution

---

# **4.2 Overview of the SigmaQLab Factor Model**

SigmaQLab v1 adopts a **5-factor structure**, aligned with:

* **MSCI Barra Global Equity Model (GEM2)**
* **AQR Style Premia Model**
* **BlackRock Systematic Active Equities**
* **Fama-French (Size, Value, Momentum)**

The factors included:

1. **Value (V)**
2. **Quality (Q)**
3. **Momentum (M)**
4. **Low Volatility (LV)**
5. **Size (S)**

Each stock is assigned a **factor exposure vector**:

[
F_i = [V_i, Q_i, M_i, LV_i, S_i]
]

Where each component is a **normalized z-score**, ensuring cross-sectional comparability.

---

# **4.3 Factor Construction Pipeline**

Every factor is computed using the following pipeline:

```
Raw Metric → Winsorization → Standardization → Direction Alignment → Exposure
```

### 1. **Raw Metric**

Directly from fundamentals or price returns.

### 2. **Winsorization**

Limit extreme outliers at the 5th and 95th percentiles.

[
x^{(wins)}*i = \min(\max(x_i, p_5), p*{95})
]

### 3. **Standardization**

Z-score transformation:

[
x^{(std)}_i = \frac{x^{(wins)}_i - \mu_x}{\sigma_x}
]

### 4. **Direction Alignment**

Ensure higher score = better investment trait.

Examples:

* Value = +1 / PE (low PE is good → higher score)
* Low Vol = −Volatility (lower volatility = higher factor value)

### 5. **Exposure**

Final exposure equals the standardized, aligned value.

---

# ------------------------------------------

# **4.4 Factor 1: VALUE**

# ------------------------------------------

## **4.4.1 Definition**

Value factor captures **cheapness** based on valuation metrics.

Stocks with **lower valuation multiples** are considered more attractive.

Industry references:

* Fama-French HML (High book-to-market)
* MSCI Value Factor
* AQR "Value" (multi-metric blend)

---

## **4.4.2 Raw metrics (Signals)**

Use a multi-signal composite:

| Signal                      | Interpretation          |
| --------------------------- | ----------------------- |
| **Earnings Yield = 1 / PE** | High = cheap            |
| **Book-to-Price (1 / PB)**  | High = cheap            |
| **Sales-to-Price (1 / PS)** | High = cheap            |
| **EV/EBITDA (inverse)**     | Lower EV/EBITDA = cheap |

We define raw value score:

[
v^{raw}_i = w_1 \cdot \frac{1}{PE_i} +
w_2 \cdot \frac{1}{PB_i} +
w_3 \cdot \frac{1}{PS_i}
]

Default: ( w_1 = w_2 = w_3 = 1 )

EV/EBITDA can be added in future revisions.

---

## **4.4.3 Standardization**

[
V_i = Z(v^{raw}_i)
]

Where (Z) denotes winsorized z-score.

---

## **4.4.4 Interpretation**

* Higher (V_i) = cheaper relative to peers
* Portfolio tilt toward high (V_i) gives value exposure

Industry performance:

* Value tends to outperform in mean-reversion phases
* Exhibits drawdowns during growth-driven markets

---

# ------------------------------------------

# **4.5 Factor 2: QUALITY**

# ------------------------------------------

## **4.5.1 Definition**

Quality factor identifies companies with:

* High profitability
* Strong balance sheet
* Efficient capital usage
* Stable earnings

Used by:

* AQR Quality Minus Junk (QMJ)
* MSCI Quality Factor
* BlackRock Quality strategies

---

## **4.5.2 Raw metrics (Signals)**

| Signal                                | Interpretation          |
| ------------------------------------- | ----------------------- |
| **ROE (Return on Equity)**            | Higher = better         |
| **ROCE (Return on Capital Employed)** | Strong predictor        |
| **Operating Margin**                  | Efficiency              |
| **Net Margin**                        | Profit quality          |
| **Debt-to-Equity (inverse)**          | Lower leverage = better |
| **Interest Coverage**                 | Solvency                |

Composite:

[
q^{raw}_i = Z(ROE_i) + Z(ROCE_i) + Z(Margin_i) - Z(D/E_i)
]

Winsorize each component before summing.

---

## **4.5.3 Standardization**

[
Q_i = Z(q^{raw}_i)
]

---

## **4.5.4 Interpretation**

* Higher (Q_i) = higher quality
* Quality outperforms in bear markets (defensive factor)

---

# ------------------------------------------

# **4.6 Factor 3: MOMENTUM**

# ------------------------------------------

## **4.6.1 Definition**

Momentum captures **recent relative performance** over medium-term windows.

Industry standard:

* MSCI Momentum
* AQR Momentum
* Jegadeesh–Titman 12m trend

---

## **4.6.2 Raw metric**

12-month momentum skipping the last 1 month:

[
M^{raw}*i = \prod*{t=T-252}^{T-21} (1 + r_{i,t}) - 1
]

We skip last 21 days to avoid reversal bias.

---

## **4.6.3 Standardization**

[
M_i = Z(M^{raw}_i)
]

---

## **4.6.4 Interpretation**

* High (M_i): strong winners continue winning
* Momentum performs well in trending markets
* Tends to crash after sharp reversals (factor crash risk)

---

# ------------------------------------------

# **4.7 Factor 4: LOW VOLATILITY**

# ------------------------------------------

## **4.7.1 Definition**

Low-Vol identifies stocks with **lower risk** but surprisingly **higher risk-adjusted returns**.

This anomaly is documented in:

* Blitz & Van Vliet (Low Volatility Anomaly)
* MSCI Min-Vol indices
* AQR Betting-Against-Beta (BAB)

---

## **4.7.2 Raw metric: Volatility**

[
\sigma_i = \sqrt{252} \cdot StdDev(r_{i,t-180:t})
]

---

## **4.7.3 Reverse the direction**

Low volatility is good → lower = better:

[
LV^{raw}_i = -\sigma_i
]

---

## **4.7.4 Standardization**

[
LV_i = Z(LV^{raw}_i)
]

---

## **4.7.5 Interpretation**

* Higher (LV_i) = lower risk
* Low-vol performs well during downturns
* Helps with portfolio stabilization

---

# ------------------------------------------

# **4.8 Factor 5: SIZE**

# ------------------------------------------

## **4.8.1 Definition**

Size factor captures the **small-cap premium**, as documented in:

* Fama–French SMB factor
* AQR Size factor

However, for construction purposes:

* Lower market cap = higher factor exposure
* But extremely small caps are excluded for liquidity reasons

---

## **4.8.2 Raw metric**

[
S^{raw}_i = - \log(\text{Market Cap}_i)
]

Why?

* Log-scaling stabilizes distribution
* Negative sign ensures smaller = higher factor

---

## **4.8.3 Standardization**

[
S_i = Z(S^{raw}_i)
]

---

## **4.8.4 Liquidity Filters**

Stocks with:

* Avg volume < threshold
* Market cap < threshold

→ Are excluded from size factor portfolio construction.

---

# ------------------------------------------

# **4.9 Composite Factor Score (Optional)**

Used for Screener ranking and simplified selection.

[
F^{(comp)}_i =
\frac{1}{5}(V_i + Q_i + M_i + LV_i + S_i)
]

Or in general:

[
F^{(comp)}*i = w_V V_i + w_Q Q_i + w_M M_i + w*{LV} LV_i + w_S S_i
]

Default weights: equal.

---

# ------------------------------------------

# **4.10 Missing Data & Imputation Rules**

### Missing fundamentals:

* Use cross-sectional median
* Flag stock for quality warning

### Missing OHLCV:

* Exclude from momentum, volatility
* But still usable for value/quality

### Outliers:

* Winsorize at 5%/95%

### Zero or negative book value:

* Exclude PB
* Adjust composite value metric

---

# ------------------------------------------

# **4.11 Validation & Consistency Checks**

Before exposing factors:

* Check exposure distribution ~ N(0,1)
* Check correlations with historical index factors
* Ensure monotonicity:

```
Cheaper → Higher Value
Higher ROE → Higher Quality
Higher Momentum → Higher score
Lower Vol → Higher Low-Vol score
Smaller Cap → Higher Size score
```

---

# ------------------------------------------

# **4.12 Summary**

Factor definitions in SigmaQLab v1:

* Follow global quant standards
* Ensure cross-sectional comparability
* Produce clean z-scored exposures
* Are robust against noise and outliers
* Feed seamlessly into Screener, Optimizer, Backtester

This factor model lays the groundwork for:

* Smart beta strategies
* Multi-factor portfolios
* Factor attribution
* Risk premia research

---

# ✔ FILE 04 COMPLETE

When you are ready, say:

### **“Proceed to File 05”**

Next file:

# **05_Risk_Model_and_Covariance.md**

This file is extremely important and includes:

* Covariance matrix estimation
* Shrinkage techniques
* Beta
* HRP risk tree
* CVaR estimation
* How risk feeds into optimizers

This is one of the most mathematically heavy files and will set up the entire Optimization Engine.
