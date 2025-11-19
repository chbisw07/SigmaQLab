from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


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
