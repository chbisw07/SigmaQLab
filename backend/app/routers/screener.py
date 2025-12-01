from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Stock, StockGroup, StockGroupMember
from ..schemas import (
    CreateGroupFromScreenerRequest,
    CreateGroupFromScreenerResponse,
    ScreenerResultItem,
    ScreenerRunRequest,
)
from ..services import ScreenerService

router = APIRouter(prefix="/api/v1", tags=["Screener"])


@router.post("/screener/run", response_model=List[ScreenerResultItem])
async def run_screener(
    payload: ScreenerRunRequest,
    meta_db: Session = Depends(get_db),
) -> List[ScreenerResultItem]:
    """Execute filter + ranking across the selected universe."""

    service = ScreenerService()

    results = service.run_screener(
        meta_db,
        universe=payload.universe,
        as_of_date=payload.as_of_date,
        filters=[f.model_dump() for f in payload.filters],
        ranking=payload.ranking.model_dump() if payload.ranking else None,
    )
    return [ScreenerResultItem(**row) for row in results]


@router.post(
    "/groups/create_from_screener",
    response_model=CreateGroupFromScreenerResponse,
)
async def create_group_from_screener(
    payload: CreateGroupFromScreenerRequest,
    meta_db: Session = Depends(get_db),
) -> CreateGroupFromScreenerResponse:
    """Create a stock group from screener results."""

    symbols = [s.strip().upper() for s in payload.symbols if s.strip()]
    if not symbols:
        raise HTTPException(
            status_code=400,
            detail="symbols list must not be empty",
        )

    # Generate a simple group code from name.
    base_code = "".join(ch for ch in payload.name.upper() if ch.isalnum()) or "SCREENER"
    code = base_code[:12]
    suffix = 1
    while (
        meta_db.query(StockGroup).filter(StockGroup.code == code).one_or_none()
        is not None
    ):
        suffix += 1
        code = f"{base_code[:9]}{suffix:03d}"

    group = StockGroup(
        code=code,
        name=payload.name,
        description=payload.description,
        tags=None,
        composition_mode="weights",
        total_investable_amount=None,
    )
    meta_db.add(group)
    meta_db.commit()
    meta_db.refresh(group)

    stocks = (
        meta_db.query(Stock)
        .filter(Stock.symbol.in_(symbols))  # type: ignore[arg-type]
        .all()
    )
    symbol_to_stock = {s.symbol.upper(): s for s in stocks}

    for symbol in symbols:
        stock = symbol_to_stock.get(symbol)
        if stock is None:
            continue
        link_exists = (
            meta_db.query(StockGroupMember)
            .filter(
                StockGroupMember.group_id == group.id,
                StockGroupMember.stock_id == stock.id,
            )
            .one_or_none()
        )
        if link_exists is None:
            meta_db.add(StockGroupMember(group_id=group.id, stock_id=stock.id))

    meta_db.commit()

    return CreateGroupFromScreenerResponse(group_id=group.id, status="success")
