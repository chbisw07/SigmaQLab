from datetime import date, datetime
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

    symbol: str
    exchange: str | None = None
    timeframe: str
    source: str | None = None
    start_timestamp: datetime
    end_timestamp: datetime
    bar_count: int


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
# Backtest service schemas
# -------------------------


class BacktestCreateRequest(BaseModel):
    """Request payload for running a backtest via the API."""

    strategy_id: int
    params_id: int | None = Field(
        default=None,
        description="Optional strategy_parameters.id to use as base params",
    )
    symbol: str
    timeframe: str
    start_date: date
    end_date: date
    initial_capital: float = 100_000.0
    params: dict[str, Any] | None = Field(
        default=None,
        description="Optional inline parameter overrides",
    )
    price_source: str | None = Field(
        default=None,
        description="Label for data source used (e.g. kite, yfinance, synthetic)",
    )


class BacktestRead(BaseModel):
    """Backtest record representation returned by the API."""

    id: int
    strategy_id: int
    params_id: int | None
    engine: str
    symbols_json: list[str]
    timeframe: str
    start_date: datetime
    end_date: datetime
    initial_capital: float
    status: str
    metrics: dict[str, Any] = Field(validation_alias="metrics_json")
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

    model_config = SettingsConfigDict(from_attributes=True)
