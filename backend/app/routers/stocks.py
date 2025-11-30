from typing import List

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Stock, StockGroup, StockGroupMember
from ..schemas import (
    StockBulkUpdate,
    StockCreate,
    StockGroupBulkAddBySymbols,
    StockGroupCreate,
    StockGroupDetail,
    StockGroupMembersUpdate,
    StockGroupRead,
    StockImportSummary,
    StockRead,
    StockUpdate,
    StockGroupUpdate,
)
from ..symbol_resolution import ResolvedSymbol, resolve_symbol


def _detect_delimiter(text: str) -> str:
    """Best-effort detection of CSV delimiter.

    TradingView exports are sometimes comma-separated and sometimes
    tab-separated. We inspect the first non-empty line and pick a sensible
    delimiter based on the characters we see.
    """

    for line in text.splitlines():
        if not line.strip():
            continue
        if "\t" in line and "," not in line:
            return "\t"
        if "," in line:
            return ","
        break
    # Fallback to comma; the csv module will then treat the entire line as
    # a single field if the guess is wrong, which we handle downstream.
    return ","


def _classify_segment_from_market_cap(value_raw: float | None) -> str | None:
    """Classify a stock into cap buckets based on market cap in INR crores.

    The input is expected to be the market capitalisation expressed directly
    in crores of rupees. Thresholds:

    - Large-cap:     >= 20,000 cr
    - Mid-cap:     5,000–19,999 cr
    - Small-cap:   1,000–4,999 cr
    - Micro-cap:     100–999 cr
    - Ultra-micro:   < 100 cr
    """

    if value_raw is None or value_raw <= 0:
        return None

    crore = value_raw
    if crore >= 20_000:
        return "large-cap"
    if crore >= 5_000:
        return "mid-cap"
    if crore > 1_000:
        return "small-cap"
    if crore >= 100:
        return "micro-cap"
    return "ultra-micro-cap"


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


def _normalise_sector(raw: str | None) -> str | None:
    """Basic normalisation for sector labels from CSV imports."""

    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    # Use title-case for consistency with human-facing UI while remaining
    # tolerant of already well-formed inputs.
    return text.title()


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
    if "market_cap_crore" in update_data:
        stock.market_cap_crore = update_data["market_cap_crore"]
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


@router.post(
    "/stocks/bulk-deactivate",
    status_code=200,
)
async def bulk_deactivate_stocks(
    payload: StockBulkUpdate,
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Bulk-deactivate one or more stocks in the universe.

    This is a soft operation that marks stocks as inactive without removing
    historical data or group memberships.
    """

    if not payload.ids:
        return {"updated": 0}

    updated = (
        db.query(Stock)
        .filter(Stock.id.in_(payload.ids), Stock.is_active.is_(True))  # type: ignore[arg-type]
        .update({Stock.is_active: False}, synchronize_session=False)
    )
    db.commit()
    return {"updated": int(updated or 0)}


@router.post(
    "/stocks/bulk-remove-from-universe",
    status_code=200,
)
async def bulk_remove_from_universe(
    payload: StockBulkUpdate,
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Bulk-remove stocks from the research universe.

    This performs a soft-delete at the universe level by removing stocks and
    their group memberships, while leaving historical price data untouched.
    """

    if not payload.ids:
        return {"updated": 0}

    # Remove group memberships first to satisfy FK constraints.
    db.query(StockGroupMember).filter(
        StockGroupMember.stock_id.in_(payload.ids),  # type: ignore[arg-type]
    ).delete(synchronize_session=False)
    deleted = (
        db.query(Stock)
        .filter(Stock.id.in_(payload.ids))  # type: ignore[arg-type]
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"updated": int(deleted or 0)}


@router.post(
    "/stock-groups/{group_code}/members/bulk-add",
    status_code=200,
)
async def bulk_add_group_members_by_symbols(
    group_code: str,
    payload: StockGroupBulkAddBySymbols,
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Bulk-add existing universe stocks to a group by symbol.

    Symbols are matched case-insensitively against the Stock.symbol field.
    Existing memberships are left untouched.
    """

    code_norm = group_code.strip().upper()
    group = db.query(StockGroup).filter(StockGroup.code == code_norm).one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Stock group not found")

    added = 0
    seen_stock_ids: set[int] = set()
    for raw_symbol in payload.symbols:
        symbol = raw_symbol.strip().upper()
        if not symbol:
            continue
        stock = (
            db.query(Stock)
            .filter(Stock.symbol == symbol)
            .order_by(Stock.id.asc())
            .first()
        )
        if stock is None:
            continue
        if stock.id in seen_stock_ids:
            continue
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
            added += 1
            seen_stock_ids.add(stock.id)

    db.commit()
    return {"added": added}


@router.post(
    "/stocks/import/tradingview",
    response_model=StockImportSummary,
    status_code=201,
)
async def import_tradingview_screener(
    file: UploadFile = File(...),
    group_code: str | None = Form(
        default=None,
        description="Optional group code to create/update for this universe.",
    ),
    group_name: str | None = Form(
        default=None,
        description=(
            "Optional group name; required if group_code is provided and the "
            "group does not yet exist."
        ),
    ),
    create_or_update_group: bool = Form(
        default=True,
        description=(
            "If true, create or update a stock group " "with the resolved symbols."
        ),
    ),
    mark_active: bool = Form(
        default=True,
        description="If true, mark all imported stocks as active in the universe.",
    ),
    db: Session = Depends(get_db),
) -> StockImportSummary:
    """Import a TradingView screener CSV and upsert stocks (+ optional group).

    The endpoint is intentionally tolerant of CSV header variants. It will try
    to locate a suitable symbol column using common TradingView conventions
    such as 'Ticker' or 'Symbol'.
    """

    import csv
    from io import StringIO

    content = await file.read()
    try:
        text = content.decode("utf-8")
    except Exception as exc:  # pragma: no cover - defensive
        msg = f"Unable to decode CSV as UTF-8: {exc}"
        raise HTTPException(status_code=400, detail=msg) from exc

    delimiter = _detect_delimiter(text)
    reader = csv.reader(StringIO(text), delimiter=delimiter)
    try:
        header = next(reader)
    except StopIteration as exc:
        raise HTTPException(status_code=400, detail="CSV file is empty") from exc
    header_lower = [h.strip().lower() for h in header]
    symbol_idx = -1
    mcap_idx = -1
    sector_idx = -1
    for idx, name in enumerate(header_lower):
        if name in {"ticker", "symbol", "nse code", "nse_code"}:
            symbol_idx = idx
        elif name == "market capitalization":
            mcap_idx = idx
        elif name == "sector":
            sector_idx = idx
    if symbol_idx == -1:
        raise HTTPException(
            status_code=400,
            detail="Unable to locate a symbol/ticker column in the CSV header.",
        )

    created = 0
    updated = 0
    added_to_group = 0
    errors: list[dict[str, str | int]] = []

    group: StockGroup | None = None
    group_code_norm: str | None = None
    if create_or_update_group and group_code:
        group_code_norm = group_code.strip().upper()
        group = (
            db.query(StockGroup)
            .filter(StockGroup.code == group_code_norm)
            .one_or_none()
        )
        if group is None:
            if not group_name:
                detail = "group_name is required when creating a new group."
                raise HTTPException(status_code=400, detail=detail)
            group = StockGroup(
                code=group_code_norm,
                name=group_name.strip(),
                description=None,
                tags=None,
            )
            db.add(group)
            db.commit()
            db.refresh(group)

    for idx, row in enumerate(reader, start=2):
        if symbol_idx >= len(row):
            continue
        raw_symbol = row[symbol_idx].strip()
        if not raw_symbol:
            continue

        market_cap_crore: float | None = None
        if 0 <= mcap_idx < len(row):
            raw_mcap = row[mcap_idx].replace(",", "").strip()
            if raw_mcap:
                try:
                    absolute_value = float(raw_mcap)
                except ValueError:
                    absolute_value = None
                if absolute_value is not None:
                    # Interpret TradingView's market cap as an absolute INR
                    # value and convert to crores for classification.
                    market_cap_crore = absolute_value / 10_000_000.0

        sector_value: str | None = None
        if 0 <= sector_idx < len(row):
            sector_value = _normalise_sector(row[sector_idx])

        resolved: ResolvedSymbol = resolve_symbol(db, raw_symbol)
        if not resolved.resolved or not resolved.exchange:
            errors.append(
                {
                    "row": idx,
                    "symbol": raw_symbol,
                    "reason": resolved.reason or "Unresolved symbol",
                }
            )
            continue

        stock = (
            db.query(Stock)
            .filter(
                Stock.symbol == resolved.symbol,
                Stock.exchange == resolved.exchange,
            )
            .one_or_none()
        )
        if stock is None:
            segment_value = _classify_segment_from_market_cap(market_cap_crore)
            stock = Stock(
                symbol=resolved.symbol,
                exchange=resolved.exchange,
                segment=segment_value,
                market_cap_crore=market_cap_crore,
                name=None,
                sector=sector_value,
                tags=None,
                is_active=bool(mark_active),
            )
            db.add(stock)
            db.commit()
            db.refresh(stock)
            created += 1
        else:
            # Update basic classification fields when we have fresh data.
            segment_value = _classify_segment_from_market_cap(market_cap_crore)
            if segment_value is not None:
                stock.segment = segment_value
            if market_cap_crore is not None:
                stock.market_cap_crore = market_cap_crore
            if sector_value is not None:
                stock.sector = sector_value
            if mark_active and not stock.is_active:
                stock.is_active = True
            db.add(stock)
            db.commit()
            updated += 1

        if group is not None:
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
                db.commit()
                added_to_group += 1

    return StockImportSummary(
        created_stocks=created,
        updated_stocks=updated,
        added_to_group=added_to_group,
        group_code=group.code if group is not None else group_code_norm,
        errors=errors,
    )


@router.post(
    "/stock-groups/import-portfolio-csv",
    response_model=StockImportSummary,
    status_code=201,
)
async def import_portfolio_csv(
    file: UploadFile = File(...),
    group_code: str = Form(...),
    group_name: str = Form(...),
    mark_active: bool = Form(
        default=True,
        description="If true, mark all imported stocks as active in the universe.",
    ),
    db: Session = Depends(get_db),
) -> StockImportSummary:
    """Import a portfolio CSV and map it into a stock group.

    The CSV is expected to contain at least one column describing the symbol
    (e.g. 'Symbol', 'Ticker', or 'NSE Code'). If the group already exists,
    new members are merged into it.
    """

    import csv
    from io import StringIO

    content = await file.read()
    try:
        text = content.decode("utf-8")
    except Exception as exc:  # pragma: no cover - defensive
        msg = f"Unable to decode CSV as UTF-8: {exc}"
        raise HTTPException(status_code=400, detail=msg) from exc

    delimiter = _detect_delimiter(text)
    reader = csv.reader(StringIO(text), delimiter=delimiter)
    try:
        header = next(reader)
    except StopIteration as exc:
        raise HTTPException(status_code=400, detail="CSV file is empty") from exc

    header_lower = [h.strip().lower() for h in header]
    symbol_idx = -1
    mcap_idx = -1
    sector_idx = -1
    for idx, name in enumerate(header_lower):
        if name in {"symbol", "ticker", "nse code", "nse_code"}:
            symbol_idx = idx
        elif name == "market capitalization":
            mcap_idx = idx
        elif name == "sector":
            sector_idx = idx
    if symbol_idx == -1:
        raise HTTPException(
            status_code=400,
            detail="Unable to locate a symbol/ticker column in the CSV header.",
        )

    group_code_norm = group_code.strip().upper()
    if not group_code_norm or not group_name.strip():
        raise HTTPException(
            status_code=400,
            detail="group_code and group_name are required.",
        )

    group = (
        db.query(StockGroup).filter(StockGroup.code == group_code_norm).one_or_none()
    )
    if group is None:
        group = StockGroup(
            code=group_code_norm,
            name=group_name.strip(),
            description=None,
            tags=None,
        )
        db.add(group)
        db.commit()
        db.refresh(group)

    created = 0
    updated = 0
    added_to_group = 0
    errors: list[dict[str, str | int]] = []

    for idx, row in enumerate(reader, start=2):
        if symbol_idx >= len(row):
            continue
        raw_symbol = row[symbol_idx].strip()
        if not raw_symbol:
            continue

        market_cap_crore: float | None = None
        if 0 <= mcap_idx < len(row):
            raw_mcap = row[mcap_idx].replace(",", "").strip()
            if raw_mcap:
                try:
                    absolute_value = float(raw_mcap)
                except ValueError:
                    absolute_value = None
                if absolute_value is not None:
                    market_cap_crore = absolute_value / 10_000_000.0

        sector_value: str | None = None
        if 0 <= sector_idx < len(row):
            sector_value = _normalise_sector(row[sector_idx])

        resolved: ResolvedSymbol = resolve_symbol(db, raw_symbol)
        if not resolved.resolved or not resolved.exchange:
            errors.append(
                {
                    "row": idx,
                    "symbol": raw_symbol,
                    "reason": resolved.reason or "Unresolved symbol",
                }
            )
            continue

        stock = (
            db.query(Stock)
            .filter(
                Stock.symbol == resolved.symbol,
                Stock.exchange == resolved.exchange,
            )
            .one_or_none()
        )
        if stock is None:
            segment_value = _classify_segment_from_market_cap(market_cap_crore)
            stock = Stock(
                symbol=resolved.symbol,
                exchange=resolved.exchange,
                segment=segment_value,
                market_cap_crore=market_cap_crore,
                name=None,
                sector=sector_value,
                tags=None,
                is_active=bool(mark_active),
            )
            db.add(stock)
            db.commit()
            db.refresh(stock)
            created += 1
        else:
            # Update basic classification fields when we have fresh data.
            segment_value = _classify_segment_from_market_cap(market_cap_crore)
            if segment_value is not None:
                stock.segment = segment_value
            if sector_value is not None:
                stock.sector = sector_value
            if market_cap_crore is not None:
                stock.market_cap_crore = market_cap_crore
            if mark_active and not stock.is_active:
                stock.is_active = True
                db.add(stock)
                db.commit()
            updated += 1

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
            db.commit()
            added_to_group += 1

    return StockImportSummary(
        created_stocks=created,
        updated_stocks=updated,
        added_to_group=added_to_group,
        group_code=group.code,
        errors=errors,
    )
