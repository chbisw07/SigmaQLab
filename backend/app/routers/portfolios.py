import datetime as _dt
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Portfolio, PortfolioBacktest, StockGroup, StockGroupMember
from ..prices_database import get_prices_db
from ..schemas import (
    GroupCompositionMode,
    PortfolioBacktestRead,
    PortfolioCreate,
    PortfolioRead,
    PortfolioUpdate,
    PortfolioUniverseSummary,
)
from ..portfolio_service import PortfolioService

router = APIRouter(prefix="/api/portfolios", tags=["Portfolios"])


def _get_portfolio_or_404(db: Session, portfolio_id: int) -> Portfolio:
    portfolio = db.get(Portfolio, portfolio_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return portfolio


def _build_portfolio_read(db: Session, obj: Portfolio) -> PortfolioRead:
    """Construct a PortfolioRead including optional universe summary.

    Existing fields are populated via from_attributes on the ORM object so
    API compatibility is preserved; universe metadata is attached as an
    additional, optional field for display/UX purposes.
    """

    universe: PortfolioUniverseSummary | None = None
    scope = obj.universe_scope or ""
    if scope.startswith("group:"):
        _, group_id_str = scope.split(":", 1)
        try:
            group_id = int(group_id_str)
        except ValueError:
            group_id = None

        if group_id is not None:
            group = db.get(StockGroup, group_id)
            if group is not None:
                num_stocks = (
                    db.query(StockGroupMember)
                    .filter(StockGroupMember.group_id == group.id)
                    .count()
                )
                mode = (
                    GroupCompositionMode(group.composition_mode)
                    if getattr(group, "composition_mode", None)
                    else GroupCompositionMode.WEIGHTS
                )
                universe = PortfolioUniverseSummary(
                    group_id=group.id,
                    group_code=group.code,
                    group_name=group.name,
                    composition_mode=mode,
                    num_stocks=int(num_stocks),
                )

    model = PortfolioRead.model_validate(obj)
    model.universe = universe
    return model


@router.post("", response_model=PortfolioRead, status_code=201)
async def create_portfolio(
    payload: PortfolioCreate,
    db: Session = Depends(get_db),
) -> PortfolioRead:
    """Create a new Portfolio definition."""

    # Enforce unique code at the API level to provide a clear error
    # instead of a generic 500 when the DB unique constraint fires.
    existing = db.query(Portfolio).filter(Portfolio.code == payload.code).one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Portfolio with code '{payload.code}' already exists",
        )

    obj = Portfolio(
        code=payload.code,
        name=payload.name,
        base_currency=payload.base_currency,
        universe_scope=payload.universe_scope,
        allowed_strategies_json=payload.allowed_strategies,
        risk_profile_json=payload.risk_profile,
        rebalance_policy_json=payload.rebalance_policy,
        notes=payload.notes,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _build_portfolio_read(db, obj)


@router.get("", response_model=List[PortfolioRead])
async def list_portfolios(
    db: Session = Depends(get_db),
) -> List[PortfolioRead]:
    """List all portfolios."""

    items = db.query(Portfolio).order_by(Portfolio.created_at.asc()).all()
    return [_build_portfolio_read(db, p) for p in items]


@router.get("/{portfolio_id}", response_model=PortfolioRead)
async def get_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
) -> PortfolioRead:
    """Fetch a single portfolio by id."""

    obj = _get_portfolio_or_404(db, portfolio_id)
    return _build_portfolio_read(db, obj)


@router.put("/{portfolio_id}", response_model=PortfolioRead)
async def update_portfolio(
    portfolio_id: int,
    payload: PortfolioUpdate,
    db: Session = Depends(get_db),
) -> PortfolioRead:
    """Update an existing portfolio definition."""

    obj = _get_portfolio_or_404(db, portfolio_id)

    if payload.code is not None and payload.code != obj.code:
        existing = (
            db.query(Portfolio).filter(Portfolio.code == payload.code).one_or_none()
        )
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Portfolio with code '{payload.code}' already exists",
            )
        obj.code = payload.code

    if payload.name is not None:
        obj.name = payload.name
    if payload.base_currency is not None:
        obj.base_currency = payload.base_currency
    if payload.universe_scope is not None:
        obj.universe_scope = payload.universe_scope
    if payload.allowed_strategies is not None:
        obj.allowed_strategies_json = payload.allowed_strategies
    if payload.risk_profile is not None:
        obj.risk_profile_json = payload.risk_profile
    if payload.rebalance_policy is not None:
        obj.rebalance_policy_json = payload.rebalance_policy
    if payload.notes is not None:
        obj.notes = payload.notes

    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _build_portfolio_read(db, obj)


@router.delete("/{portfolio_id}", status_code=204)
async def delete_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
) -> None:
    """Delete a portfolio definition.

    Any portfolio-level backtests associated with this portfolio are removed
    first so that the delete does not violate foreign-key constraints.
    """

    obj = _get_portfolio_or_404(db, portfolio_id)

    db.query(PortfolioBacktest).filter(
        PortfolioBacktest.portfolio_id == portfolio_id
    ).delete(synchronize_session=False)

    db.delete(obj)
    db.commit()
    return None


@router.get(
    "/{portfolio_id}/backtests",
    response_model=List[PortfolioBacktestRead],
)
async def list_portfolio_backtests(
    portfolio_id: int,
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=500),
) -> List[PortfolioBacktestRead]:
    """List portfolio backtests for a given portfolio.

    This is a read-only API for now; portfolio backtests will be created by
    the PortfolioService in later sprints.
    """

    _ = _get_portfolio_or_404(db, portfolio_id)
    rows = (
        db.query(PortfolioBacktest)
        .filter(PortfolioBacktest.portfolio_id == portfolio_id)
        .order_by(PortfolioBacktest.created_at.desc())
        .limit(limit)
        .all()
    )
    return [PortfolioBacktestRead.model_validate(row) for row in rows]


@router.post(
    "/{portfolio_id}/backtests",
    response_model=PortfolioBacktestRead,
    status_code=201,
)
async def create_portfolio_backtest(
    portfolio_id: int,
    timeframe: str = Query("1d"),
    start: _dt.datetime = Query(...),
    end: _dt.datetime = Query(...),
    initial_capital: float = Query(100_000.0, gt=0),
    meta_db: Session = Depends(get_db),
    prices_db: Session = Depends(get_prices_db),
) -> PortfolioBacktestRead:
    """Run a portfolio backtest for the given portfolio.

    V1 runs a long-only, equal-weight allocation across the portfolio's
    universe, rebalanced on every bar of the chosen timeframe.
    """

    service = PortfolioService()
    bt = service.run_portfolio_backtest(
        meta_db=meta_db,
        prices_db=prices_db,
        portfolio_id=portfolio_id,
        timeframe=timeframe,
        start=start,
        end=end,
        initial_capital=initial_capital,
    )
    return PortfolioBacktestRead.model_validate(bt)
