from datetime import date, datetime, time
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
    sector: str | None = Field(default=None, description="Sector/industry label")
    tags: list[str] | None = Field(
        default=None,
        description="Optional list of tags, e.g. ['bank', 'nifty50', 'midcap']",
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
    sector: str | None = None
    tags: list[str] | None = None
    is_active: bool | None = None


class StockRead(StockBase):
    """Stock representation returned by the API."""

    id: int
    created_at: datetime
    updated_at: datetime

    model_config = SettingsConfigDict(from_attributes=True)


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

    members: list[StockRead]


class StockGroupMembersUpdate(BaseModel):
    """Payload to add one or more stocks to a group."""

    stock_ids: list[int] = Field(
        ...,
        description="IDs of stocks to add as members of this group",
        min_length=1,
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
