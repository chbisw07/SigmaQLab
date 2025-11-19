from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..backtest_service import BacktestService
from ..database import get_db
from ..models import Backtest, BacktestEquityPoint, BacktestTrade
from ..prices_database import get_prices_db
from ..schemas import (
    BacktestCreateRequest,
    BacktestEquityPointRead,
    BacktestRead,
    BacktestTradeRead,
)

router = APIRouter(prefix="/api/backtests", tags=["Backtests"])


def _get_backtest_or_404(db: Session, backtest_id: int) -> Backtest:
    backtest = db.get(Backtest, backtest_id)
    if backtest is None:
        raise HTTPException(status_code=404, detail="Backtest not found")
    return backtest


@router.post("", response_model=BacktestRead, status_code=201)
async def create_backtest(
    payload: BacktestCreateRequest,
    meta_db: Session = Depends(get_db),
    prices_db: Session = Depends(get_prices_db),
) -> BacktestRead:
    """Run a backtest synchronously and persist the Backtest record."""

    service = BacktestService()

    try:
        backtest = service.run_single_backtest(
            meta_db=meta_db,
            prices_db=prices_db,
            strategy_id=payload.strategy_id,
            symbol=payload.symbol,
            timeframe=payload.timeframe,
            start=datetime.combine(payload.start_date, datetime.min.time()),
            end=datetime.combine(payload.end_date, datetime.max.time()),
            initial_capital=payload.initial_capital,
            params=payload.params,
            params_id=payload.params_id,
            price_source=payload.price_source,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        # Likely missing backtrader or misconfigured engine.
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return BacktestRead.model_validate(backtest)


@router.get("", response_model=List[BacktestRead])
async def list_backtests(
    meta_db: Session = Depends(get_db),
) -> List[BacktestRead]:
    """List backtests ordered by creation time (latest first)."""

    rows = meta_db.query(Backtest).order_by(Backtest.created_at.desc()).all()
    return [BacktestRead.model_validate(row) for row in rows]


@router.get("/{backtest_id}", response_model=BacktestRead)
async def get_backtest(
    backtest_id: int,
    meta_db: Session = Depends(get_db),
) -> BacktestRead:
    backtest = _get_backtest_or_404(meta_db, backtest_id)
    return BacktestRead.model_validate(backtest)


@router.get("/{backtest_id}/equity", response_model=List[BacktestEquityPointRead])
async def get_backtest_equity(
    backtest_id: int,
    meta_db: Session = Depends(get_db),
) -> List[BacktestEquityPointRead]:
    _ = _get_backtest_or_404(meta_db, backtest_id)
    points = (
        meta_db.query(BacktestEquityPoint)
        .filter(BacktestEquityPoint.backtest_id == backtest_id)
        .order_by(BacktestEquityPoint.timestamp.asc())
        .all()
    )
    return [
        BacktestEquityPointRead(timestamp=p.timestamp, equity=p.equity) for p in points
    ]


@router.get("/{backtest_id}/trades", response_model=List[BacktestTradeRead])
async def get_backtest_trades(
    backtest_id: int,
    meta_db: Session = Depends(get_db),
) -> List[BacktestTradeRead]:
    _ = _get_backtest_or_404(meta_db, backtest_id)
    trades = (
        meta_db.query(BacktestTrade)
        .filter(BacktestTrade.backtest_id == backtest_id)
        .order_by(BacktestTrade.id.asc())
        .all()
    )
    return [BacktestTradeRead.model_validate(t) for t in trades]
