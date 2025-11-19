from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import get_settings
from ..prices_database import get_prices_db
from ..prices_models import PriceBar
from ..schemas import (
    DataFetchRequest,
    DataFetchResponse,
    DataSummaryItem,
    PriceBarPreview,
)
from ..services import DataService, ProviderUnavailableError

router = APIRouter(prefix="/api/data", tags=["Data"])


@router.post("/fetch", response_model=DataFetchResponse)
async def fetch_data(
    payload: DataFetchRequest,
    db: Session = Depends(get_prices_db),
) -> DataFetchResponse:
    settings = get_settings()
    service = DataService(
        kite_api_key=settings.kite_api_key,
        kite_access_token=settings.kite_access_token,
    )

    try:
        bars_written = service.fetch_and_store_bars(
            db,
            symbol=payload.symbol,
            timeframe=payload.timeframe,
            start=datetime.combine(payload.start_date, datetime.min.time()),
            end=datetime.combine(payload.end_date, datetime.max.time()),
            source=payload.source,
            csv_path=payload.csv_path,
            exchange=payload.exchange,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return DataFetchResponse(
        symbol=payload.symbol,
        timeframe=payload.timeframe,
        start_date=payload.start_date,
        end_date=payload.end_date,
        source=payload.source,
        bars_written=bars_written,
    )


@router.get("/summary", response_model=List[DataSummaryItem])
async def get_data_summary(
    db: Session = Depends(get_prices_db),
) -> List[DataSummaryItem]:
    """Return coverage summary for all symbol/timeframe combinations."""

    rows = (
        db.query(
            PriceBar.symbol,
            PriceBar.exchange,
            PriceBar.timeframe,
            func.min(PriceBar.timestamp),
            func.max(PriceBar.timestamp),
            func.count(PriceBar.id),
        )
        .group_by(PriceBar.symbol, PriceBar.exchange, PriceBar.timeframe)
        .order_by(
            PriceBar.symbol.asc(),
            PriceBar.exchange.asc(),
            PriceBar.timeframe.asc(),
        )
        .all()
    )

    return [
        DataSummaryItem(
            symbol=symbol,
            exchange=exchange,
            timeframe=timeframe,
            start_timestamp=start_ts,
            end_timestamp=end_ts,
            bar_count=bar_count,
        )
        for symbol, exchange, timeframe, start_ts, end_ts, bar_count in rows
    ]


@router.get(
    "/{symbol}/preview",
    response_model=List[PriceBarPreview],
)
async def preview_data(
    symbol: str,
    timeframe: str = Query(..., description="Timeframe to preview, e.g. 5m, 1h, 1d"),
    db: Session = Depends(get_prices_db),
    limit: int = Query(200, ge=1, le=2000),
) -> List[PriceBarPreview]:
    """Return a preview of recent bars for a symbol/timeframe."""

    query = (
        db.query(PriceBar)
        .filter(PriceBar.symbol == symbol, PriceBar.timeframe == timeframe)
        .order_by(PriceBar.timestamp.desc())
        .limit(limit)
    )
    rows = list(query)
    rows.reverse()  # return in ascending time order

    return [
        PriceBarPreview(
            timestamp=row.timestamp,
            open=row.open,
            high=row.high,
            low=row.low,
            close=row.close,
            volume=row.volume,
            source=row.source,
        )
        for row in rows
    ]
