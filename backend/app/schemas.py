from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field
from pydantic_settings import SettingsConfigDict


# -------------------------
# Data service schemas
# -------------------------


class DataFetchRequest(BaseModel):
    """Request payload for triggering a data fetch into the prices DB."""

    symbol: str = Field(..., description="Instrument symbol, e.g. RELIANCE")
    timeframe: str = Field(
        ...,
        description="Timeframe identifier, e.g. 5m, 15m, 1D",
    )
    start_date: date
    end_date: date
    source: Literal["kite", "yfinance", "csv"] = Field(
        "kite",
        description="Preferred data source",
    )
    csv_path: str | None = Field(
        default=None,
        description="Optional local CSV path when source=csv",
    )

    exchange: str = Field(
        "NSE",
        description="Logical exchange for the instrument (e.g. NSE, BSE, NYSE)",
    )

    # Target scope for the fetch operation. By default we fetch data for a
    # single symbol; when 'group' or 'universe' is selected the backend will
    # iterate over the relevant stocks and fetch data for each.
    target: Literal["symbol", "group", "universe"] = Field(
        "symbol",
        description="Fetch target: 'symbol' (single stock), 'group', or 'universe'.",
    )
    group_id: int | None = Field(
        default=None,
        description="Stock group id when target='group'.",
    )

    # Optional intraday session times. When omitted, the backend defaults to
    # the standard India cash session of 09:15–15:30 IST.
    start_time: time | None = None
    end_time: time | None = None


class DataFetchResponse(BaseModel):
    """Response payload summarising a data fetch operation."""

    symbol: str
    timeframe: str
    start_date: date
    end_date: date
    source: str
    bars_written: int


class DataSummaryItem(BaseModel):
    """Aggregated coverage summary for a symbol/timeframe."""

    coverage_id: str = Field(
        ...,
        description=(
            "Stable fetch-sequence identifier of the form "
            "'<SYMBOL>_<NNNNN>' assigned when data is fetched."
        ),
    )
    symbol: str
    exchange: str | None = None
    timeframe: str
    source: str | None = None
    start_timestamp: datetime
    end_timestamp: datetime
    bar_count: int
    created_at: datetime = Field(
        ...,
        description="Timestamp when this symbol/timeframe/source was last fetched.",
    )


class PriceBarPreview(BaseModel):
    """Single bar used in preview responses."""

    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None
    source: str


# -------------------------
# Factor & risk data schemas
# -------------------------


class FactorSymbolsRequest(BaseModel):
    """Request payload for factor/fundamental/risk lookups."""

    symbols: list[str]
    as_of_date: date


class FactorExposureRead(BaseModel):
    """Factor exposure vector returned by the API."""

    value: float | None = None
    quality: float | None = None
    momentum: float | None = None
    low_vol: float | None = None
    size: float | None = None
    composite: float | None = Field(
        default=None,
        validation_alias="composite_score",
    )

    model_config = SettingsConfigDict(from_attributes=True, populate_by_name=True)


class FundamentalsRead(BaseModel):
    """Subset of fundamentals exposed via the Factor Data API."""

    pe: float | None = None
    pb: float | None = None
    ps: float | None = None
    roe: float | None = None
    roce: float | None = None
    debt_to_equity: float | None = None
    sales_growth_yoy: float | None = None
    profit_growth_yoy: float | None = None
    eps_growth_3y: float | None = None
    operating_margin: float | None = None
    net_margin: float | None = None
    interest_coverage: float | None = None
    promoter_holding: float | None = None
    fii_holding: float | None = None
    dii_holding: float | None = None
    sector: str | None = None
    industry: str | None = None

    model_config = SettingsConfigDict(from_attributes=True)


class RiskRead(BaseModel):
    """Risk metrics per symbol from the risk model."""

    volatility: float | None = None
    beta: float | None = None
    tail_beta: float | None = None
    skew: float | None = None
    kurtosis: float | None = None

    model_config = SettingsConfigDict(from_attributes=True)


class CovarianceMatrixResponse(BaseModel):
    """Covariance and correlation matrix for a symbol universe."""

    symbols: list[str]
    cov_matrix: list[list[float]]
    corr_matrix: list[list[float]]


# -------------------------
# Screener schemas
# -------------------------


class ScreenerFilter(BaseModel):
    """Single screener filter condition."""

    field: str = Field(
        ...,
        description="Field name, e.g. PE, ROE, Value, Momentum.",
    )
    op: Literal["<", "<=", ">", ">=", "=", "=="] = Field(
        ...,
        description="Comparison operator.",
    )
    value: float = Field(..., description="Numeric threshold for the filter.")


class ScreenerRankingField(BaseModel):
    """Ranking specification for a single field."""

    field: str = Field(
        ...,
        description="Field name to rank by, e.g. Composite, Value, ROE.",
    )
    order: Literal["asc", "desc"] = Field(
        "desc",
        description="Sort order: asc or desc.",
    )


class ScreenerRankingConfig(BaseModel):
    """Primary/secondary ranking configuration."""

    primary: ScreenerRankingField
    secondary: ScreenerRankingField | None = None
    limit: int | None = Field(
        default=None,
        description="Optional maximum number of results to return.",
    )


class ScreenerRunRequest(BaseModel):
    """Request payload for running the factor/fundamental screener."""

    universe: str = Field(
        "NSE_ALL",
        description="Universe identifier, e.g. NSE_ALL or a future custom code.",
    )
    as_of_date: date
    filters: list[ScreenerFilter] = Field(
        default_factory=list,
        description="List of filter conditions combined with AND semantics.",
    )
    ranking: ScreenerRankingConfig | None = None


class ScreenerResultItem(BaseModel):
    """Single screener result row."""

    symbol: str
    sector: str | None = None
    market_cap: float | None = None
    value: float | None = None
    quality: float | None = None
    momentum: float | None = None
    low_vol: float | None = None
    size: float | None = None


class CreateGroupFromScreenerRequest(BaseModel):
    """Payload for creating a stock group from screener results."""

    name: str
    description: str | None = None
    symbols: list[str]


class CreateGroupFromScreenerResponse(BaseModel):
    """Response returned when creating a group from screener results."""

    group_id: int
    status: str = "success"


# -------------------------
# Strategy service schemas
# -------------------------


class StrategyBase(BaseModel):
    """Common fields for Strategy models."""

    name: str = Field(..., description="Human-friendly strategy name")
    code: str = Field(..., description="Short identifier used in code/backtests")
    engine_code: str | None = Field(
        default=None,
        description=(
            "Engine implementation key, e.g. 'SmaCrossStrategy'. "
            "Multiple strategies can share the same engine_code."
        ),
    )
    category: str | None = Field(
        default=None,
        description="Category: trend, mean_reversion, breakout, overlay, risk_filter",
    )
    description: str | None = None
    status: str | None = Field(
        default=None,
        description="experimental, candidate, paper, live, deprecated",
    )
    tags: list[str] | None = Field(
        default=None,
        description="Optional list of tags, e.g. ['intraday', 'nifty']",
    )
    linked_sigma_trader_id: str | None = None
    linked_tradingview_template: str | None = None
    live_ready: bool | None = None


class StrategyCreate(StrategyBase):
    """Payload to create a new strategy."""

    pass


class StrategyUpdate(BaseModel):
    """Payload to update an existing strategy (partial update)."""

    name: str | None = None
    code: str | None = None
    engine_code: str | None = None
    category: str | None = None
    description: str | None = None
    status: str | None = None
    tags: list[str] | None = None
    linked_sigma_trader_id: str | None = None
    linked_tradingview_template: str | None = None
    live_ready: bool | None = None


class StrategyRead(StrategyBase):
    """Strategy representation returned by the API."""

    id: int
    created_at: datetime
    updated_at: datetime

    model_config = SettingsConfigDict(from_attributes=True)


class StrategyParameterBase(BaseModel):
    """Common fields for StrategyParameter models."""

    label: str = Field(..., description="e.g. default, aggressive, conservative")
    params: dict[str, Any] = Field(
        ...,
        description="Parameter set as key-value map",
    )
    notes: str | None = None


class StrategyParameterCreate(StrategyParameterBase):
    """Payload to create a StrategyParameter."""

    pass


class StrategyParameterUpdate(BaseModel):
    """Payload to update a StrategyParameter (partial)."""

    label: str | None = None
    params: dict[str, Any] | None = None
    notes: str | None = None


class StrategyParameterRead(StrategyParameterBase):
    """StrategyParameter representation returned by the API."""

    id: int
    strategy_id: int
    created_at: datetime
    # Map ORM attribute `params_json` to field `params`.
    params: dict[str, Any] = Field(validation_alias="params_json")

    model_config = SettingsConfigDict(from_attributes=True, populate_by_name=True)


# -------------------------
# Stock universe schemas
# -------------------------


class GroupCompositionMode(str, Enum):
    """Composition mode for stock groups/baskets."""

    WEIGHTS = "weights"
    QTY = "qty"
    AMOUNT = "amount"


class StockBase(BaseModel):
    """Common fields for Stock models."""

    symbol: str = Field(..., description="Instrument symbol, e.g. HDFCBANK")
    exchange: str = Field(
        ...,
        description="Logical exchange for the instrument (e.g. NSE, BSE, NYSE)",
    )
    segment: str | None = Field(
        default=None,
        description="Market segment, e.g. equity, fno (optional)",
    )
    name: str | None = Field(
        default=None,
        description="Human-friendly instrument name, e.g. HDFC Bank Ltd.",
    )
    market_cap_crore: float | None = Field(
        default=None,
        description="Optional market capitalisation expressed in INR crores.",
    )
    sector: str | None = Field(default=None, description="Sector/industry label")
    tags: list[str] | None = Field(
        default=None,
        description="Optional list of tags, e.g. ['bank', 'nifty50', 'midcap']",
    )
    analyst_rating: str | None = Field(
        default=None,
        description="Analyst/fundamental rating string imported from TradingView.",
    )
    target_price_one_year: float | None = Field(
        default=None,
        description="Target price for the next 12 months (TradingView column).",
    )
    is_active: bool = Field(
        default=True,
        description="Whether the stock is active in the research universe",
    )


class StockCreate(StockBase):
    """Payload to create a new stock in the universe."""

    pass


class StockUpdate(BaseModel):
    """Partial update payload for a stock."""

    symbol: str | None = None
    exchange: str | None = None
    segment: str | None = None
    name: str | None = None
    market_cap_crore: float | None = None
    sector: str | None = None
    tags: list[str] | None = None
    analyst_rating: str | None = None
    target_price_one_year: float | None = None
    is_active: bool | None = None


class StockImportSummary(BaseModel):
    """Summary returned by CSV-based stock/group import endpoints."""

    created_stocks: int
    updated_stocks: int
    added_to_group: int
    group_code: str | None = None
    errors: list[dict[str, Any]]


class StockRead(StockBase):
    """Stock representation returned by the API."""

    id: int
    created_at: datetime
    updated_at: datetime

    model_config = SettingsConfigDict(from_attributes=True)


class StockGroupMemberRead(StockRead):
    """Stock in a group, including target allocation fields."""

    stock_id: int | None = Field(
        default=None,
        description="Optional explicit stock id for this membership (matches id).",
    )
    target_weight_pct: Decimal | None = None
    target_qty: Decimal | None = None
    target_amount: Decimal | None = None


class StockGroupBase(BaseModel):
    """Common fields for stock groups."""

    code: str = Field(
        ...,
        description="Short identifier for the group, e.g. TRENDING_STOCKS",
    )
    name: str = Field(..., description="Human-friendly group name")
    description: str | None = Field(
        default=None, description="Purpose/definition of this basket"
    )
    tags: list[str] | None = Field(
        default=None,
        description="Optional tags, e.g. ['midcap', 'banking']",
    )
    composition_mode: GroupCompositionMode = Field(
        default=GroupCompositionMode.WEIGHTS,
        description="How this basket allocates members: weights, qty, or amount.",
    )
    total_investable_amount: Decimal | None = Field(
        default=None,
        description="Total investable amount when composition_mode='amount'.",
    )


class StockGroupCreate(StockGroupBase):
    """Payload to create a new stock group."""

    stock_ids: list[int] | None = Field(
        default=None,
        description="Optional initial list of stock IDs to add as members",
    )


class StockGroupUpdate(BaseModel):
    """Partial update payload for a stock group (metadata only)."""

    code: str | None = None
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    composition_mode: GroupCompositionMode | None = None
    total_investable_amount: Decimal | None = None


class StockGroupRead(StockGroupBase):
    """Stock group representation returned by the API."""

    id: int
    created_at: datetime
    updated_at: datetime
    stock_count: int = Field(
        0,
        description="Number of member stocks in this group",
    )

    model_config = SettingsConfigDict(from_attributes=True)


class StockGroupDetail(StockGroupRead):
    """Stock group including full member details."""

    members: list[StockGroupMemberRead]


class StockGroupMembersUpdate(BaseModel):
    """Payload to add one or more stocks to a group."""

    stock_ids: list[int] = Field(
        ...,
        description="IDs of stocks to add as members of this group",
        min_length=1,
    )


class StockBulkUpdate(BaseModel):
    """Payload for bulk stock operations by id."""

    ids: list[int] = Field(
        ...,
        description="IDs of stocks to update in bulk",
        min_length=1,
    )


class StockGroupBulkAddBySymbols(BaseModel):
    """Payload to bulk-add group members by symbol."""

    symbols: list[str] = Field(
        ...,
        description="Symbol codes to add as members of this group",
        min_length=1,
    )

    # Optional hints for how allocations should be interpreted when
    # equalising group members. When omitted, the group's existing mode
    # and total_investable_amount are used.
    mode: GroupCompositionMode | None = Field(
        default=None,
        description="Optional composition mode override for this bulk add.",
    )
    total_investable_amount: Decimal | None = Field(
        default=None,
        description=(
            "Optional total investable amount to use when " "composition_mode='amount'."
        ),
    )


# -------------------------
# Backtest service schemas
# -------------------------


class BacktestCreateRequest(BaseModel):
    """Request payload for running a backtest via the API."""

    strategy_id: int
    params_id: int | None = Field(
        default=None,
        description="Optional strategy_parameters.id to use as base params",
    )
    # For single-symbol backtests, `symbol` is required. For group backtests
    # (universe_mode='group'), `group_id` is used instead.
    symbol: str
    timeframe: str
    start_date: date
    end_date: date
    # Optional intraday session times. When omitted, the backend will default
    # to the standard India cash session of 09:15–15:30 IST.
    start_time: time | None = None
    end_time: time | None = None
    initial_capital: float = 100_000.0
    params: dict[str, Any] | None = Field(
        default=None,
        description="Optional inline parameter overrides",
    )
    price_source: str | None = Field(
        default=None,
        description="Label for data source used (e.g. kite, yfinance, synthetic)",
    )
    label: str | None = Field(
        default=None,
        description="Optional human-friendly label for this backtest run",
    )
    notes: str | None = Field(
        default=None,
        description="Optional free-form notes about this backtest configuration",
    )
    risk_config: dict[str, Any] | None = Field(
        default=None,
        description="Optional risk settings (max position size, per-trade risk, etc.)",
    )
    costs_config: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Optional costs/fees settings (commission, slippage, other charges)"
        ),
    )
    visual_config: dict[str, Any] | None = Field(
        default=None,
        description="Optional visualisation settings for the backtest chart",
    )
    # Optional group/universe fields for portfolio backtests.
    group_id: int | None = Field(
        default=None,
        description=(
            "Optional stock_groups.id when running a group/portfolio backtest."
        ),
    )
    universe_mode: Literal["single", "group"] = Field(
        "single",
        description="Universe mode: 'single' for symbol-level, 'group' for portfolio.",
    )


class BacktestRead(BaseModel):
    """Backtest record representation returned by the API."""

    id: int
    strategy_id: int
    params_id: int | None
    engine: str
    group_id: int | None = None
    universe_mode: str | None = None
    label: str | None = None
    notes: str | None = None
    symbols_json: list[str]
    timeframe: str
    start_date: datetime
    end_date: datetime
    initial_capital: float
    status: str
    metrics: dict[str, Any] = Field(validation_alias="metrics_json")
    risk_config: dict[str, Any] | None = Field(
        default=None,
        validation_alias="risk_config_json",
    )
    costs_config: dict[str, Any] | None = Field(
        default=None,
        validation_alias="costs_config_json",
    )
    visual_config: dict[str, Any] | None = Field(
        default=None,
        validation_alias="visual_config_json",
    )
    data_source: str | None = None
    created_at: datetime
    finished_at: datetime | None = None

    model_config = SettingsConfigDict(from_attributes=True, populate_by_name=True)


class BacktestEquityPointRead(BaseModel):
    """Single equity point associated with a backtest."""

    timestamp: datetime
    equity: float


class BacktestTradeRead(BaseModel):
    """Single trade associated with a backtest."""

    id: int
    symbol: str
    side: str
    size: float
    entry_timestamp: datetime
    entry_price: float
    exit_timestamp: datetime
    exit_price: float
    pnl: float

    # Optional derived metrics populated by the Backtest Overhaul.
    pnl_pct: float | None = None
    holding_period_bars: int | None = None
    max_theoretical_pnl: float | None = None
    max_theoretical_pnl_pct: float | None = None
    pnl_capture_ratio: float | None = None
    entry_order_type: str | None = None
    exit_order_type: str | None = None
    entry_brokerage: float | None = None
    exit_brokerage: float | None = None
    entry_reason: str | None = None
    exit_reason: str | None = None

    model_config = SettingsConfigDict(from_attributes=True)


class BacktestChartPriceBar(BaseModel):
    """Single OHLCV bar used in backtest chart-data responses."""

    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None


class IndicatorPoint(BaseModel):
    """Single time/value pair for an indicator series."""

    timestamp: datetime
    value: float


class BacktestChartDataResponse(BaseModel):
    """Aggregated chart data for a backtest."""

    backtest: BacktestRead
    price_bars: list[BacktestChartPriceBar]
    indicators: dict[str, list[IndicatorPoint]]
    equity_curve: list[BacktestEquityPointRead]
    projection_curve: list[BacktestEquityPointRead]
    trades: list[BacktestTradeRead]


# -------------------------
# Portfolio management schemas
# -------------------------


class PortfolioUniverseSummary(BaseModel):
    """Lightweight summary of a portfolio's universe group (if any)."""

    group_id: int
    group_code: str
    group_name: str
    composition_mode: GroupCompositionMode
    num_stocks: int


class PortfolioBase(BaseModel):
    """Common fields for Portfolio models."""

    code: str = Field(
        ...,
        description="Short identifier for the portfolio, e.g. CORE_EQUITY",
    )
    name: str = Field(..., description="Human-friendly portfolio name")
    base_currency: str = Field(
        "INR",
        description="Base currency for the portfolio (e.g. INR, USD).",
    )
    universe_scope: str | None = Field(
        default=None,
        description="Universe scoping string, e.g. 'group:1' or 'universe:custom'.",
    )
    allowed_strategies: list[int] | list[str] | None = Field(
        default=None,
        description=(
            "Optional list of allowed strategy identifiers for this portfolio. "
            "May be strategy_ids or codes."
        ),
    )
    risk_profile: dict[str, Any] | None = Field(
        default=None,
        description="Optional risk profile configuration blob.",
    )
    rebalance_policy: dict[str, Any] | None = Field(
        default=None,
        description="Optional rebalance policy configuration blob.",
    )
    notes: str | None = None


class PortfolioCreate(PortfolioBase):
    """Payload to create a new Portfolio."""

    pass


class PortfolioUpdate(BaseModel):
    """Partial update payload for a Portfolio."""

    code: str | None = None
    name: str | None = None
    base_currency: str | None = None
    universe_scope: str | None = None
    allowed_strategies: list[int] | list[str] | None = None
    risk_profile: dict[str, Any] | None = None
    rebalance_policy: dict[str, Any] | None = None
    notes: str | None = None


class PortfolioRead(PortfolioBase):
    """Portfolio representation returned by the API."""

    id: int
    created_at: datetime
    updated_at: datetime
    # Map ORM JSON columns to logical fields.
    allowed_strategies: list[int] | list[str] | None = Field(
        default=None,
        validation_alias="allowed_strategies_json",
    )
    risk_profile: dict[str, Any] | None = Field(
        default=None,
        validation_alias="risk_profile_json",
    )
    rebalance_policy: dict[str, Any] | None = Field(
        default=None,
        validation_alias="rebalance_policy_json",
    )
    universe: PortfolioUniverseSummary | None = None

    model_config = SettingsConfigDict(from_attributes=True, populate_by_name=True)


class PortfolioBacktestRead(BaseModel):
    """Portfolio-level backtest record."""

    id: int
    portfolio_id: int
    start_date: datetime
    end_date: datetime
    timeframe: str
    initial_capital: float
    status: str
    metrics: dict[str, Any] | None = Field(
        default=None,
        validation_alias="metrics_json",
    )
    created_at: datetime
    finished_at: datetime | None = None

    model_config = SettingsConfigDict(from_attributes=True, populate_by_name=True)


class PortfolioConstraintsConfig(BaseModel):
    """Constraint configuration for portfolio optimisation."""

    min_weight: float | None = Field(
        default=None,
        description="Minimum weight per stock (0–1, optional).",
    )
    max_weight: float | None = Field(
        default=None,
        description="Maximum weight per stock (0–1, optional).",
    )
    turnover_limit: float | None = Field(
        default=None,
        description="Optional per-rebalance turnover limit (0–1).",
    )
    target_volatility: float | None = Field(
        default=None,
        description="Target annualised volatility for the portfolio (0–1, optional).",
    )
    max_beta: float | None = Field(
        default=None,
        description="Maximum allowed portfolio beta (optional).",
    )
    sector_caps: dict[str, float] | None = Field(
        default=None,
        description="Optional per-sector maximum weights.",
    )
    factor_constraints: dict[str, float] | None = Field(
        default=None,
        description=(
            "Optional factor exposure constraints, keyed by factor name "
            "(e.g. 'value_min', 'quality_min')."
        ),
    )


class PortfolioConstraintsRead(PortfolioConstraintsConfig):
    """Constraints as stored in the persistence layer."""

    id: int
    portfolio_id: int
    sector_caps: dict[str, float] | None = Field(
        default=None,
        validation_alias="sector_caps_json",
    )
    factor_constraints: dict[str, float] | None = Field(
        default=None,
        validation_alias="factor_constraints_json",
    )

    model_config = SettingsConfigDict(from_attributes=True, populate_by_name=True)


class PortfolioWeightItem(BaseModel):
    """Single weight entry."""

    symbol: str
    weight: float


class PortfolioOptimizeRequest(BaseModel):
    """Request payload for optimising a portfolio."""

    portfolio_id: int
    as_of_date: date
    optimizer_type: Literal[
        "equal_weight",
        "market_cap",
        "min_var",
        "max_sharpe",
        "risk_parity",
        "hrp",
        "cvar",
    ] = "max_sharpe"
    previous_weights: list[PortfolioWeightItem] | None = None
    constraints: PortfolioConstraintsConfig | None = None


class PortfolioOptimizeResponse(BaseModel):
    """Optimised weights, risk metrics, exposures, and diagnostics."""

    weights: list[PortfolioWeightItem]
    risk: dict[str, float]
    exposures: dict[str, float]
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class PortfolioSaveWeightsRequest(BaseModel):
    """Payload to persist optimised portfolio weights."""

    portfolio_id: int
    as_of_date: date | None = None
    weights: list[PortfolioWeightItem]


class PortfolioSaveWeightsResponse(BaseModel):
    """Status returned after saving portfolio weights."""

    status: str = "saved"
    portfolio_id: int
