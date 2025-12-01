Below is the complete next file for your PRD.

Save it as:

```
docs/PRD_Factor_Portfolio_v1/02_System_Overview.md
```

This file provides the *big-picture architecture*, the *major modules*, and the *end-to-end flows* for factor ingestion, screening, optimization, and backtesting.

---

# ------------------------------------------

# **02_System_Overview.md**

# ------------------------------------------

# **2. System Overview**

---

## **2.1 Purpose of This Document**

This document describes the **overall architecture** of the SigmaQLab Factor & Portfolio Construction v1 system.
It explains:

* All major subsystems
* How they interact
* End-to-end execution flows
* Technology boundaries
* Responsibilities and dependencies
* Notations used across the PRD

This file acts as the “master blueprint” for the entire system.

---

# **2.2 High-Level Architecture**

SigmaQLab v1 evolves into a **modular quantitative research and portfolio construction system** consisting of:

1. **Factor Data Layer** — ingestion + transformation
2. **Risk Model Layer** — covariance, vol, beta, CVaR parameters
3. **Factor Screener** — filtering, ranking, group creation
4. **Portfolio Construction Engine** — optimization algorithms
5. **Constraint Solver** — weight, sector, factor, turnover constraints
6. **Portfolio Backtest Engine** — simulates rebalance cycles
7. **Analytics Layer** — risk, exposure, attribution
8. **UI Layer** — Universe, Screener, Portfolio creation, Analytics
9. **APIs/Services Layer** — delivers data to FE and BE subsystems

These units interact in tightly defined ways.

---

# **2.3 System Block Diagram**

```
                   +------------------------------+
                   |      External Data Sources   |
                   | (Screener.in, NSE, Zerodha)  |
                   +------------------------------+
                               |
                   +-----------+-----------+
                   |                       |
                   v                       v
       +-------------------+       +---------------------+
       | Fundamentals ETL  |       |  OHLCV Data ETL     |
       |  (snapshot load)  |       | (Kite Connect API)  |
       +-------------------+       +---------------------+
                   |                       |
                   v                       v
       +---------------------------------------------+
       |           Factor Data Layer                 |
       | fundamentals_snapshot, price_returns,       |
       | factor_exposures, volatility, betas, etc.   |
       +---------------------------------------------+
                         |
                         v
             +-------------------------+
             |     Risk Model Layer    |
             | covariance, correlations|
             | HRP clusters, CVaR calc |
             +-------------------------+
                         |
         +---------------+----------------+
         |                                |
         v                                v
 +-------------------+         +---------------------------+
 | Factor Screener   |         | Portfolio Construction    |
 | UI/Engine         |         | Optimization Engine       |
 | Filters + Ranking |         | EW, MCW, RP, MaxSharpe,   |
 +-------------------+         | MinVar, HRP, CVaR, EffF   |
                   |           +---------------------------+
                   v                     |
       +--------------------------+      |
       | Groups (Selected Stocks) |      |
       +--------------------------+      |
                   |                     |
                   +---------+-----------+
                             v
                   +----------------------------+
                   |   Portfolio Backtest Engine|
                   | simulates rebalances       |
                   | computes PnL + analytics   |
                   +----------------------------+
                              |
                              v
                   +---------------------------+
                   |     Analytics & UI        |
                   | performance, exposures,    |
                   | risk metrics, attribution  |
                   +---------------------------+
```

---

# **2.4 Core Concepts**

This release introduces several new concepts that interact with existing SigmaQLab elements.

---

## **2.4.1 Universe**

A Universe is the **broad set of stocks** used for:

* Screening
* Group creation
* Portfolio construction

Examples:

* All NSE
* NIFTY 500
* User-defined list
* Multi-factor screened outputs

*Universe is always the starting point.*

---

## **2.4.2 Factors**

Each stock gets a **5-factor exposure vector**:

[
\textbf{F}_i = [V_i, Q_i, M_i, LV_i, S_i]
]

Where:

* (V_i) = Value exposure
* (Q_i) = Quality
* (M_i) = Momentum
* (LV_i) = Low-Vol
* (S_i) = Size

This is stored in `factor_exposures`.

---

## **2.4.3 Risk Model**

Each rebalancing period maintains:

* Covariance matrix ( \Sigma )
* Asset volatilities ( \sigma_i )
* Betas (vs index)
* CVaR risk values
* HRP cluster tree

Stored in:

* `risk_model`
* `cov_matrix_store`

---

## **2.4.4 Screener Groups**

The Screener outputs:

* A filtered set of stocks
* A ranked set of stocks
* Optionally, a “Top N” selection

These are saved as **Groups**.
Groups act as the **input to the Portfolio Construction Engine**.

---

## **2.4.5 Portfolio Construction**

Given:

* A Group
* Factor exposures
* Risk model
* Optimization parameters
* Constraints

The PC Engine outputs:

* Weight vector ( \vec{w} )
* Allocation table
* Risk profile
* Factor exposures of final portfolio

This portfolio is then available for **backtesting**.

---

## **2.4.6 Backtesting**

Backtests simulate:

* Weight drift over time
* Rebalancing trades
* Transaction costs
* Portfolio risk and performance statistics

This produces:

* Equity curve
* Drawdown curve
* Exposure history
* Attribution reports

---

# **2.5 End-to-End Flow**

Below is the detailed flow from data ingestion → backtest.

---

## **2.5.1 Data Processing Flow**

```
OHLCV → Daily returns → Volatility → Covariance → Risk Model
Fundamentals → Normalization → Factor exposures
```

### Raw inputs:

* OHLCV from Zerodha Kite
* Fundamentals from Screener.in

### Derived metrics:

* Returns (r_i)
* Volatility (σ_i)
* Covariance (Σ_{ij})
* Factor exposures (F_i)
* Beta
* CVaR

This completes the Factor + Risk modeling stage.

---

## **2.5.2 Screening Flow**

```
Universe
   ↓
Factor Screener (rules)
   ↓
Ranked + filtered stock set
   ↓
Save as Group
```

---

## **2.5.3 Portfolio Construction Flow**

```
Group of stocks
   ↓
Fetch factors + fundamentals
   ↓
Fetch covariance matrix
   ↓
Apply constraints
   ↓
Optimization Engine
   ↓
Final weights vector
   ↓
Portfolio created
```

---

## **2.5.4 Backtest Flow**

```
Portfolio configuration
   ↓
For each rebalance date:
    - load stocks
    - compute risk model
    - run optimizer
    - simulate trades
    - update weights
    - track PnL
   ↓
Analytics generation
```

---

# **2.6 Subsystem Overview**

Here is a list of main subsystems and their responsibilities.

---

## **2.6.1 Factor Data Layer**

**Responsible for:**

* ingesting fundamentals
* computing standardized factor values
* computing rolling price returns
* storing factor exposures

**Exposes:**

* APIs to query factor exposures at any date
* APIs to compute factor rankings

---

## **2.6.2 Risk Model Layer**

**Responsible for:**

* covariance matrix calculation
* correlation matrix
* HRP clustering
* CVaR estimation

**Exposes:**

* covariance matrix service
* HRP tree generation
* beta calculation

---

## **2.6.3 Factor Screener Engine**

**Responsible for:**

* applying rules
* filtering
* ranking
* combining factor/fundamental constraints

**Exposes:**

* Screener results
* Save-as-Group

---

## **2.6.4 Portfolio Construction Engine**

**Responsible for:**

* running optimization algorithms
* applying constraints
* validating infeasible inputs
* producing optimal weights

**Exposes:**

* `optimize_portfolio(request)`
* returns `weights`, `diagnostics`, `exposure_report`

---

## **2.6.5 Backtest Engine**

**Responsible for:**

* weight drift
* rebalancing simulation
* trade cost modeling
* PnL and risk metric generation

**Exposes:**

* backtest results
* holdings timeline
* risk metrics

---

## **2.6.6 Analytics Layer**

**Responsible for:**

* Sharpe, Sortino
* volatility
* drawdowns
* factor exposures over time
* sector allocation
* attribution

---

## **2.6.7 UI Layer**

Includes:

* Universe view
* Screener UI
* Portfolio Construction UI
* Backtest UI
* Analytics UI

The UI interacts only via REST or local APIs — no direct DB access.

---

# **2.7 Technology Stack & Boundaries**

### Back-end:

* Python
* Pandas / NumPy
* SciPy for optimizers
* NetworkX for HRP tree or custom implementation
* CVXOPT or PyPortfolioOpt for CVaR and MPT

### Front-end:

* React
* Chakra / Material UI (per SigmaQLab UI kit)

### Data:

* Prisma or SQL DB for fundamentals, factors, and risk
* Local caching for OHLCV and covariance matrices

---

# **2.8 Non-Functional Considerations**

### Performance

* Covariance matrix computation must run < 300 ms for ≤ 500 stocks
* Optimization < 800 ms
* Screener < 200 ms

### Reliability

* Fail-safe handling for missing fundamentals
* Algorithms must detect infeasible constraints

### Accuracy

* Factor models validated against test cases
* Optimization results unit tested for correctness

### Security

* No external service keys leaked in UI
* Local storage of sensitive OHLCV and fundamentals

---

# **2.9 Future Extensions**

The architecture supports:

* ESG factor integration
* Regime-based allocation
* LLM-based strategy suggestions
* Live trading rebalance engine
* Multi-asset portfolios (equity + bonds + gold + crypto)
* Risk parity (across asset classes)
* Monte Carlo simulation engine

The v1 is intentionally modular for future growth.

---

# **2.10 Summary**

This System Overview describes a **modular, extensible, and production-grade quant architecture** for SigmaQLab.
It defines how:

* raw data → becomes factors → becomes optimized portfolios → becomes backtests → becomes analytics.

This structure now lays the groundwork for the rest of the PRD documents.

---

# ✔ FILE 02 COMPLETE

Please say:

### **“Proceed to File 03”**

… and I will generate:

# **03_Factor_Data_Layer.md**

This is a deep, detailed document explaining:

* Fundamentals ingestion
* Factor preprocessing
* Rolling return computation
* Price normalization
* Data schemas
* Update schedules
* Error handling
* How factors are stored and queried

This section is *the foundation* of everything else.
