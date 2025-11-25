from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func
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
            PriceBar.source,
            func.min(PriceBar.timestamp),
            func.max(PriceBar.timestamp),
            func.count(PriceBar.id),
        )
        .group_by(
            PriceBar.symbol,
            PriceBar.exchange,
            PriceBar.timeframe,
            PriceBar.source,
        )
        .order_by(
            PriceBar.symbol.asc(),
            PriceBar.exchange.asc(),
            PriceBar.timeframe.asc(),
            PriceBar.source.asc(),
        )
        .all()
    )

    summary_items: list[DataSummaryItem] = []
    for idx, (
        symbol,
        exchange,
        timeframe,
        source,
        start_ts,
        end_ts,
        bar_count,
    ) in enumerate(rows, start=1):
        coverage_id = f"FS_{idx:05d}"
        summary_items.append(
            DataSummaryItem(
                coverage_id=coverage_id,
                symbol=symbol,
                exchange=exchange,
                timeframe=timeframe,
                source=source,
                start_timestamp=start_ts,
                end_timestamp=end_ts,
                bar_count=bar_count,
            )
        )
    # Present newest-style coverage IDs first (highest sequence number).
    summary_items.sort(key=lambda item: item.coverage_id, reverse=True)
    return summary_items


@router.delete("/bars", status_code=204)
async def delete_data_coverage(
    symbols: list[str] = Query(
        ..., description="One or more symbols whose data should be deleted"
    ),
    timeframe: str = Query(..., description="Timeframe to delete, e.g. 5m, 1h, 1d"),
    exchange: str | None = Query(
        None,
        description=(
            "Optional exchange filter; when omitted, all exchanges "
            "for the symbol are affected"
        ),
    ),
    source: str | None = Query(
        None,
        description=(
            "Optional source filter; when omitted, all sources for the "
            "symbol are affected"
        ),
    ),
    start: datetime | None = Query(
        None,
        description="Optional start timestamp; when omitted, deletes from earliest",
    ),
    end: datetime | None = Query(
        None,
        description="Optional end timestamp; when omitted, deletes up to latest",
    ),
    db: Session = Depends(get_prices_db),
) -> None:
    """Delete price bars for one or more symbols and a given timeframe.

    The deletion can optionally be narrowed by exchange, source, and a
    timestamp window. This is primarily used by the UI to clear data for
    selected coverage rows.
    """

    if not symbols:
        raise HTTPException(status_code=400, detail="At least one symbol is required")

    conditions = [PriceBar.symbol.in_(symbols), PriceBar.timeframe == timeframe]
    if exchange is not None:
        conditions.append(PriceBar.exchange == exchange)
    if source is not None:
        conditions.append(PriceBar.source == source)
    if start is not None:
        conditions.append(PriceBar.timestamp >= start)
    if end is not None:
        conditions.append(PriceBar.timestamp <= end)

    db.query(PriceBar).filter(and_(*conditions)).delete(synchronize_session=False)
    db.commit()


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
