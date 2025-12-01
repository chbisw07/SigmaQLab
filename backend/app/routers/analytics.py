from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import PortfolioBacktest
from ..services import AnalyticsService


router = APIRouter(prefix="/api/v1/analytics", tags=["Analytics"])


@router.get("/summary/{portfolio_backtest_id}")
async def get_portfolio_backtest_summary(
    portfolio_backtest_id: int,
    meta_db: Session = Depends(get_db),
) -> dict:
    """Return analytics summary for a portfolio backtest.

    For S16 this wraps AnalyticsService.summarize_backtest and returns a
    lightweight JSON blob with volatility, sharpe, beta, cvar_95, and
    optional factor_tilt and sector_allocation fields.
    """

    bt = meta_db.get(PortfolioBacktest, portfolio_backtest_id)
    if bt is None:
        raise HTTPException(status_code=404, detail="PortfolioBacktest not found")

    service = AnalyticsService()
    summary = service.summarize_backtest(
        meta_db,
        backtest_id=portfolio_backtest_id,
    )
    return summary
