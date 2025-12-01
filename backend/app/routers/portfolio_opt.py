from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Portfolio, PortfolioWeight
from ..prices_database import get_prices_db
from ..schemas import (
    PortfolioOptimizeRequest,
    PortfolioOptimizeResponse,
    PortfolioSaveWeightsRequest,
    PortfolioSaveWeightsResponse,
)
from ..services import OptimizerService

router = APIRouter(prefix="/api/v1/portfolio", tags=["Portfolio Optimization"])


def _get_portfolio_or_404(db: Session, portfolio_id: int) -> Portfolio:
    portfolio = db.get(Portfolio, portfolio_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return portfolio


@router.post(
    "/optimize",
    response_model=PortfolioOptimizeResponse,
)
async def optimize_portfolio(
    payload: PortfolioOptimizeRequest,
    meta_db: Session = Depends(get_db),
    prices_db: Session = Depends(get_prices_db),
) -> PortfolioOptimizeResponse:
    """Optimise a portfolio using the configured optimiser and constraints."""

    _ = _get_portfolio_or_404(meta_db, payload.portfolio_id)

    service = OptimizerService()
    weights, risk, exposures, diagnostics = service.optimise_portfolio(
        meta_db=meta_db,
        prices_db=prices_db,
        portfolio_id=payload.portfolio_id,
        as_of_date=payload.as_of_date,
        optimizer_type=payload.optimizer_type,
        constraints=(payload.constraints.model_dump() if payload.constraints else None),
        previous_weights=[w.model_dump() for w in (payload.previous_weights or [])],
    )
    return PortfolioOptimizeResponse(
        weights=weights,
        risk=risk,
        exposures=exposures,
        diagnostics=diagnostics,
    )


@router.post(
    "/save_weights",
    response_model=PortfolioSaveWeightsResponse,
)
async def save_portfolio_weights(
    payload: PortfolioSaveWeightsRequest,
    meta_db: Session = Depends(get_db),
) -> PortfolioSaveWeightsResponse:
    """Persist a set of optimised weights for a portfolio."""

    _ = _get_portfolio_or_404(meta_db, payload.portfolio_id)

    if not payload.weights:
        raise HTTPException(
            status_code=400,
            detail="weights list must not be empty",
        )

    as_of_date = payload.as_of_date
    if as_of_date is None:
        from datetime import date as _date

        as_of_date = _date.today()

    # Replace any existing weights for this portfolio/date snapshot.
    meta_db.query(PortfolioWeight).filter(
        PortfolioWeight.portfolio_id == payload.portfolio_id,
        PortfolioWeight.date == as_of_date,
    ).delete(synchronize_session=False)

    for item in payload.weights:
        meta_db.add(
            PortfolioWeight(
                portfolio_id=payload.portfolio_id,
                date=as_of_date,
                symbol=item.symbol,
                weight=item.weight,
            )
        )

    meta_db.commit()

    return PortfolioSaveWeightsResponse(
        status="saved",
        portfolio_id=payload.portfolio_id,
    )
