from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Stock, StockGroup, StockGroupMember
from ..schemas import (
    StockCreate,
    StockGroupCreate,
    StockGroupDetail,
    StockGroupMembersUpdate,
    StockGroupRead,
    StockRead,
    StockUpdate,
    StockGroupUpdate,
)

router = APIRouter(prefix="/api", tags=["Stocks"])


def _get_stock_or_404(db: Session, stock_id: int) -> Stock:
    stock = db.get(Stock, stock_id)
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")
    return stock


def _get_group_or_404(db: Session, group_id: int) -> StockGroup:
    group = db.get(StockGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Stock group not found")
    return group


@router.get("/stocks", response_model=List[StockRead])
async def list_stocks(
    active_only: bool = Query(
        True,
        description="If true, return only active stocks in the universe.",
    ),
    db: Session = Depends(get_db),
) -> List[StockRead]:
    query = db.query(Stock)
    if active_only:
        query = query.filter(Stock.is_active.is_(True))
    stocks = query.order_by(Stock.symbol.asc()).all()
    return [StockRead.model_validate(s) for s in stocks]


@router.post("/stocks", response_model=StockRead, status_code=201)
async def create_stock(
    payload: StockCreate,
    db: Session = Depends(get_db),
) -> StockRead:
    symbol = payload.symbol.strip().upper()
    exchange = payload.exchange.strip().upper()

    existing = (
        db.query(Stock)
        .filter(Stock.symbol == symbol, Stock.exchange == exchange)
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Stock {symbol} on {exchange} already exists in the universe",
        )

    stock = Stock(
        symbol=symbol,
        exchange=exchange,
        segment=payload.segment,
        name=payload.name,
        sector=payload.sector,
        tags=payload.tags,
        is_active=payload.is_active,
    )
    db.add(stock)
    db.commit()
    db.refresh(stock)
    return StockRead.model_validate(stock)


@router.get("/stocks/{stock_id}", response_model=StockRead)
async def get_stock(
    stock_id: int,
    db: Session = Depends(get_db),
) -> StockRead:
    stock = _get_stock_or_404(db, stock_id)
    return StockRead.model_validate(stock)


@router.put("/stocks/{stock_id}", response_model=StockRead)
async def update_stock(
    stock_id: int,
    payload: StockUpdate,
    db: Session = Depends(get_db),
) -> StockRead:
    stock = _get_stock_or_404(db, stock_id)
    update_data = payload.model_dump(exclude_unset=True)

    if "symbol" in update_data or "exchange" in update_data:
        new_symbol = (update_data.get("symbol") or stock.symbol).strip().upper()
        new_exchange = (update_data.get("exchange") or stock.exchange).strip().upper()
        existing = (
            db.query(Stock)
            .filter(
                Stock.symbol == new_symbol,
                Stock.exchange == new_exchange,
                Stock.id != stock.id,
            )
            .first()
        )
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Stock {new_symbol} on {new_exchange} already exists",
            )
        stock.symbol = new_symbol
        stock.exchange = new_exchange

    if "segment" in update_data:
        stock.segment = update_data["segment"]
    if "name" in update_data:
        stock.name = update_data["name"]
    if "sector" in update_data:
        stock.sector = update_data["sector"]
    if "tags" in update_data:
        stock.tags = update_data["tags"]
    if "is_active" in update_data and update_data["is_active"] is not None:
        stock.is_active = bool(update_data["is_active"])

    db.add(stock)
    db.commit()
    db.refresh(stock)
    return StockRead.model_validate(stock)


@router.delete("/stocks/{stock_id}", status_code=204)
async def deactivate_stock(
    stock_id: int,
    db: Session = Depends(get_db),
) -> None:
    """Soft-delete a stock by marking it inactive.

    Historical price data remains untouched; the stock simply disappears from
    active-universe queries.
    """

    stock = _get_stock_or_404(db, stock_id)
    if not stock.is_active:
        return
    stock.is_active = False
    db.add(stock)
    db.commit()


@router.get("/stock-groups", response_model=List[StockGroupRead])
async def list_stock_groups(
    db: Session = Depends(get_db),
) -> List[StockGroupRead]:
    groups = db.query(StockGroup).order_by(StockGroup.name.asc()).all()
    results: List[StockGroupRead] = []
    for g in groups:
        stock_count = (
            db.query(StockGroupMember).filter(StockGroupMember.group_id == g.id).count()
        )
        results.append(
            StockGroupRead(
                id=g.id,
                code=g.code,
                name=g.name,
                description=g.description,
                tags=g.tags or [],
                created_at=g.created_at,
                updated_at=g.updated_at,
                stock_count=stock_count,
            )
        )
    return results


@router.post("/stock-groups", response_model=StockGroupDetail, status_code=201)
async def create_stock_group(
    payload: StockGroupCreate,
    db: Session = Depends(get_db),
) -> StockGroupDetail:
    code = payload.code.strip().upper()

    existing = db.query(StockGroup).filter(StockGroup.code == code).first()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Stock group with code '{code}' already exists",
        )

    group = StockGroup(
        code=code,
        name=payload.name,
        description=payload.description,
        tags=payload.tags,
    )
    db.add(group)
    db.commit()
    db.refresh(group)

    members: List[Stock] = []
    if payload.stock_ids:
        for stock_id in payload.stock_ids:
            stock = db.get(Stock, stock_id)
            if stock is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Stock {stock_id} not found for group membership",
                )
            link_exists = (
                db.query(StockGroupMember)
                .filter(
                    StockGroupMember.group_id == group.id,
                    StockGroupMember.stock_id == stock.id,
                )
                .first()
            )
            if link_exists is None:
                db.add(
                    StockGroupMember(group_id=group.id, stock_id=stock.id),
                )
            members.append(stock)
        db.commit()

    return StockGroupDetail(
        id=group.id,
        code=group.code,
        name=group.name,
        description=group.description,
        tags=group.tags or [],
        created_at=group.created_at,
        updated_at=group.updated_at,
        stock_count=len(members),
        members=[StockRead.model_validate(s) for s in members],
    )


@router.get("/stock-groups/{group_id}", response_model=StockGroupDetail)
async def get_stock_group(
    group_id: int,
    db: Session = Depends(get_db),
) -> StockGroupDetail:
    group = _get_group_or_404(db, group_id)
    memberships = (
        db.query(StockGroupMember).filter(StockGroupMember.group_id == group.id).all()
    )
    member_ids = [m.stock_id for m in memberships]
    members: List[Stock] = []
    if member_ids:
        members = (
            db.query(Stock)
            .filter(Stock.id.in_(member_ids))  # type: ignore[arg-type]
            .order_by(Stock.symbol.asc())
            .all()
        )
    return StockGroupDetail(
        id=group.id,
        code=group.code,
        name=group.name,
        description=group.description,
        tags=group.tags or [],
        created_at=group.created_at,
        updated_at=group.updated_at,
        stock_count=len(memberships),
        members=[StockRead.model_validate(s) for s in members],
    )


@router.put("/stock-groups/{group_id}", response_model=StockGroupRead)
async def update_stock_group(
    group_id: int,
    payload: StockGroupUpdate,
    db: Session = Depends(get_db),
) -> StockGroupRead:
    group = _get_group_or_404(db, group_id)
    update_data = payload.model_dump(exclude_unset=True)

    if "code" in update_data and update_data["code"]:
        new_code = update_data["code"].strip().upper()
        existing = (
            db.query(StockGroup)
            .filter(StockGroup.code == new_code, StockGroup.id != group.id)
            .first()
        )
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Stock group with code '{new_code}' already exists",
            )
        group.code = new_code
    if "name" in update_data:
        group.name = update_data["name"]
    if "description" in update_data:
        group.description = update_data["description"]
    if "tags" in update_data:
        group.tags = update_data["tags"]

    db.add(group)
    db.commit()
    db.refresh(group)

    stock_count = (
        db.query(StockGroupMember).filter(StockGroupMember.group_id == group.id).count()
    )

    return StockGroupRead(
        id=group.id,
        code=group.code,
        name=group.name,
        description=group.description,
        tags=group.tags or [],
        created_at=group.created_at,
        updated_at=group.updated_at,
        stock_count=stock_count,
    )


@router.delete("/stock-groups/{group_id}", status_code=204)
async def delete_stock_group(
    group_id: int,
    db: Session = Depends(get_db),
) -> None:
    group = _get_group_or_404(db, group_id)
    db.query(StockGroupMember).filter(
        StockGroupMember.group_id == group.id,
    ).delete()
    db.delete(group)
    db.commit()


@router.get(
    "/stock-groups/{group_id}/members",
    response_model=List[StockRead],
)
async def list_group_members(
    group_id: int,
    db: Session = Depends(get_db),
) -> List[StockRead]:
    _ = _get_group_or_404(db, group_id)
    memberships = (
        db.query(StockGroupMember).filter(StockGroupMember.group_id == group_id).all()
    )
    member_ids = [m.stock_id for m in memberships]
    if not member_ids:
        return []
    stocks = (
        db.query(Stock)
        .filter(Stock.id.in_(member_ids))  # type: ignore[arg-type]
        .order_by(Stock.symbol.asc())
        .all()
    )
    return [StockRead.model_validate(s) for s in stocks]


@router.post(
    "/stock-groups/{group_id}/members",
    response_model=StockGroupDetail,
    status_code=200,
)
async def add_group_members(
    group_id: int,
    payload: StockGroupMembersUpdate,
    db: Session = Depends(get_db),
) -> StockGroupDetail:
    group = _get_group_or_404(db, group_id)
    members: List[Stock] = []

    for stock_id in payload.stock_ids:
        stock = db.get(Stock, stock_id)
        if stock is None:
            raise HTTPException(
                status_code=404,
                detail=f"Stock {stock_id} not found for group membership",
            )
        link_exists = (
            db.query(StockGroupMember)
            .filter(
                StockGroupMember.group_id == group.id,
                StockGroupMember.stock_id == stock.id,
            )
            .first()
        )
        if link_exists is None:
            db.add(StockGroupMember(group_id=group.id, stock_id=stock.id))
        members.append(stock)

    db.commit()

    # Reload full detail
    return await get_stock_group(group_id=group.id, db=db)


@router.delete(
    "/stock-groups/{group_id}/members/{stock_id}",
    status_code=204,
)
async def remove_group_member(
    group_id: int,
    stock_id: int,
    db: Session = Depends(get_db),
) -> None:
    _ = _get_group_or_404(db, group_id)
    _ = _get_stock_or_404(db, stock_id)
    db.query(StockGroupMember).filter(
        StockGroupMember.group_id == group_id,
        StockGroupMember.stock_id == stock_id,
    ).delete()
    db.commit()
