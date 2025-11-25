from datetime import datetime, time as time_cls, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import Stock, StockGroup, StockGroupMember
from ..prices_database import get_prices_db
from ..prices_models import PriceBar, PriceFetch
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
    prices_db: Session = Depends(get_prices_db),
    meta_db: Session = Depends(get_db),
) -> DataFetchResponse:
    settings = get_settings()
    service = DataService(
        kite_api_key=settings.kite_api_key,
        kite_access_token=settings.kite_access_token,
    )

    default_start_time = time_cls(9, 15)
    default_end_time = time_cls(15, 30)
    start_time = payload.start_time or default_start_time
    end_time = payload.end_time or default_end_time

    start_dt = datetime.combine(payload.start_date, start_time)
    end_dt = datetime.combine(payload.end_date, end_time)

    def _fetch_for_symbol(symbol: str, exchange: str) -> int:
        return service.fetch_and_store_bars(
            prices_db,
            symbol=symbol,
            timeframe=payload.timeframe,
            start=start_dt,
            end=end_dt,
            source=payload.source,
            csv_path=payload.csv_path,
            exchange=exchange,
        )

    total_bars = 0
    summary_symbol: str

    try:
        if payload.target == "symbol":
            # Standard single-symbol fetch.
            summary_symbol = payload.symbol
            total_bars += _fetch_for_symbol(payload.symbol, payload.exchange)
        elif payload.target == "group":
            if payload.group_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="group_id is required when target='group'",
                )
            group = meta_db.get(StockGroup, payload.group_id)
            if group is None:
                raise HTTPException(status_code=404, detail="Stock group not found")

            memberships = (
                meta_db.query(StockGroupMember)
                .filter(StockGroupMember.group_id == group.id)
                .all()
            )
            member_ids = [m.stock_id for m in memberships]
            if not member_ids:
                raise HTTPException(
                    status_code=400,
                    detail="Selected stock group has no members to fetch data for",
                )
            stocks = (
                meta_db.query(Stock)
                .filter(Stock.id.in_(member_ids))  # type: ignore[arg-type]
                .all()
            )
            summary_symbol = group.code
            for stock in stocks:
                total_bars += _fetch_for_symbol(stock.symbol, stock.exchange)
        elif payload.target == "universe":
            # Fetch for the entire active stock universe.
            stocks = (
                meta_db.query(Stock)
                .filter(Stock.is_active.is_(True))
                .order_by(Stock.symbol.asc())
                .all()
            )
            if not stocks:
                raise HTTPException(
                    status_code=400,
                    detail="No active stocks in the universe to fetch data for",
                )
            summary_symbol = "UNIVERSE"
            for stock in stocks:
                total_bars += _fetch_for_symbol(stock.symbol, stock.exchange)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported fetch target: {payload.target}",
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return DataFetchResponse(
        symbol=summary_symbol,
        timeframe=payload.timeframe,
        start_date=payload.start_date,
        end_date=payload.end_date,
        source=payload.source,
        bars_written=total_bars,
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

    ist_tz = timezone(timedelta(hours=5, minutes=30))

    summary_items: list[DataSummaryItem] = []
    for (
        symbol,
        exchange,
        timeframe,
        source,
        start_ts,
        end_ts,
        bar_count,
    ) in rows:
        latest_fetch = (
            db.query(PriceFetch)
            .filter(
                PriceFetch.symbol == symbol,
                PriceFetch.exchange == exchange,
                PriceFetch.timeframe == timeframe,
                PriceFetch.source == source,
            )
            .order_by(PriceFetch.id.desc())
            .first()
        )
        if latest_fetch is not None:
            seq = latest_fetch.id
            created_at_raw = latest_fetch.created_at
        else:
            # Legacy data created before fetch metadata existed: synthesise a
            # neutral identifier and use the coverage end timestamp.
            seq = 0
            created_at_raw = end_ts

        # Normalise created_at to IST for display and ordering. SQLite stores
        # naive datetimes, so we treat them as UTC and convert.
        if created_at_raw.tzinfo is None:
            created_at = created_at_raw.replace(tzinfo=timezone.utc).astimezone(ist_tz)
        else:
            created_at = created_at_raw.astimezone(ist_tz)

        # For symbol-level fetches, use a per-symbol prefix so coverage IDs
        # read naturally as <SYMBOL>_00001, <SYMBOL>_00002, ...
        symbol_prefix = (symbol or "").upper()
        coverage_id = f"{symbol_prefix}_{seq:05d}"
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
                created_at=created_at,
            )
        )
    # Present most recently fetched coverage first; break ties by identifier.
    summary_items.sort(
        key=lambda item: (item.created_at, item.coverage_id),
        reverse=True,
    )
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
