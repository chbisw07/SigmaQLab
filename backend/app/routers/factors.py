from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CovarianceMatrix, FactorExposure, FundamentalsSnapshot, RiskModel
from ..prices_database import get_prices_db
from ..schemas import (
    CovarianceMatrixResponse,
    FactorExposureRead,
    FactorRebuildRequest,
    FactorRebuildResponse,
    FactorSymbolsRequest,
    FundamentalsRead,
    RiskRead,
)
from ..services import FactorRiskRebuildService, FactorService, RiskModelService

router = APIRouter(prefix="/api/v1/factors", tags=["Factors"])


@router.post("/exposures", response_model=dict[str, FactorExposureRead])
async def get_factor_exposures(
    payload: FactorSymbolsRequest,
    meta_db: Session = Depends(get_db),
    prices_db: Session = Depends(get_prices_db),
) -> dict[str, FactorExposureRead]:
    """Return factor exposures for the requested symbols and date.

    Missing exposures will trigger a compute-and-store pass via FactorService.
    """

    service = FactorService()

    rows = (
        meta_db.query(FactorExposure)
        .filter(
            FactorExposure.symbol.in_(payload.symbols),  # type: ignore[arg-type]
            FactorExposure.as_of_date == payload.as_of_date,
        )
        .all()
    )
    exposures_by_symbol: dict[str, FactorExposure] = {row.symbol: row for row in rows}

    missing = [s for s in payload.symbols if s not in exposures_by_symbol]
    if missing:
        computed = service.compute_and_store_exposures(
            meta_db=meta_db,
            prices_db=prices_db,
            symbols=missing,
            as_of_date=payload.as_of_date,
        )
        exposures_by_symbol.update(computed)

    result: dict[str, FactorExposureRead] = {}
    for symbol in payload.symbols:
        row = exposures_by_symbol.get(symbol)
        if row is not None:
            result[symbol] = FactorExposureRead.model_validate(row)
    return result


@router.post("/fundamentals", response_model=dict[str, FundamentalsRead])
async def get_fundamentals(
    payload: FactorSymbolsRequest,
    meta_db: Session = Depends(get_db),
) -> dict[str, FundamentalsRead]:
    """Return fundamentals snapshot data for the requested symbols and date."""

    rows = (
        meta_db.query(FundamentalsSnapshot)
        .filter(
            FundamentalsSnapshot.symbol.in_(payload.symbols),  # type: ignore[arg-type]
            FundamentalsSnapshot.as_of_date == payload.as_of_date,
        )
        .all()
    )
    fundamentals_by_symbol: dict[str, FundamentalsSnapshot] = {
        row.symbol: row for row in rows
    }

    result: dict[str, FundamentalsRead] = {}
    for symbol in payload.symbols:
        row = fundamentals_by_symbol.get(symbol)
        if row is not None:
            result[symbol] = FundamentalsRead.model_validate(row)
    return result


@router.post("/risk", response_model=dict[str, RiskRead])
async def get_risk_metrics(
    payload: FactorSymbolsRequest,
    meta_db: Session = Depends(get_db),
    prices_db: Session = Depends(get_prices_db),
) -> dict[str, RiskRead]:
    """Return per-symbol risk metrics for the requested universe and date."""

    service = RiskModelService()

    rows = (
        meta_db.query(RiskModel)
        .filter(
            RiskModel.symbol.in_(payload.symbols),  # type: ignore[arg-type]
            RiskModel.as_of_date == payload.as_of_date,
        )
        .all()
    )
    risk_by_symbol: dict[str, RiskModel] = {row.symbol: row for row in rows}

    missing = [s for s in payload.symbols if s not in risk_by_symbol]
    if missing:
        computed = service.compute_and_store_risk(
            meta_db=meta_db,
            prices_db=prices_db,
            symbols=missing,
            as_of_date=payload.as_of_date,
        )
        risk_by_symbol.update(computed)

    result: dict[str, RiskRead] = {}
    for symbol in payload.symbols:
        row = risk_by_symbol.get(symbol)
        if row is not None:
            result[symbol] = RiskRead.model_validate(row)
    return result


@router.post("/covariance", response_model=CovarianceMatrixResponse)
async def get_covariance_matrix(
    payload: FactorSymbolsRequest,
    meta_db: Session = Depends(get_db),
    prices_db: Session = Depends(get_prices_db),
) -> CovarianceMatrixResponse:
    """Return covariance and correlation matrices for the requested universe."""

    if not payload.symbols:
        raise HTTPException(status_code=400, detail="symbols list must not be empty")

    service = RiskModelService()
    # Ensure risk entries and covariance matrix exist.
    service.compute_and_store_risk(
        meta_db=meta_db,
        prices_db=prices_db,
        symbols=payload.symbols,
        as_of_date=payload.as_of_date,
    )

    # Fetch the most recent matching covariance matrix for this universe.
    # Universe hash is computed using the same helper as the service.
    universe_hash = service._universe_hash(payload.symbols)
    row = (
        meta_db.query(CovarianceMatrix)
        .filter(
            CovarianceMatrix.as_of_date == payload.as_of_date,
            CovarianceMatrix.universe_hash == universe_hash,
        )
        .one_or_none()
    )
    if row is None or row.matrix_blob is None:
        raise HTTPException(
            status_code=404,
            detail="Covariance matrix not available for the requested universe",
        )

    blob = row.matrix_blob
    symbols = blob.get("symbols") or payload.symbols
    cov_matrix = blob.get("cov_matrix")
    corr_matrix = blob.get("corr_matrix")

    if cov_matrix is None or corr_matrix is None:
        raise HTTPException(
            status_code=500,
            detail="Stored covariance matrix is incomplete",
        )

    return CovarianceMatrixResponse(
        symbols=symbols,
        cov_matrix=cov_matrix,
        corr_matrix=corr_matrix,
    )


@router.post("/rebuild", response_model=FactorRebuildResponse)
async def rebuild_factors_and_risk(
    payload: FactorRebuildRequest,
    meta_db: Session = Depends(get_db),
    prices_db: Session = Depends(get_prices_db),
) -> FactorRebuildResponse:
    """Recompute factor and risk model data for a universe and date."""

    service = FactorRiskRebuildService()
    try:
        summary = service.rebuild_for_universe(
            meta_db=meta_db,
            prices_db=prices_db,
            universe=payload.universe,
            as_of_date=payload.as_of_date,
            timeframe=payload.timeframe,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return FactorRebuildResponse(
        universe=summary["universe"],
        as_of_date=date.fromisoformat(summary["as_of_date"]),
        timeframe=summary["timeframe"],
        symbols_requested=summary["symbols_requested"],
        symbols_with_prices=summary["symbols_with_prices"],
        symbols_without_prices=summary["symbols_without_prices"],
        factor_rows_written=summary["factor_rows_written"],
        risk_rows_written=summary["risk_rows_written"],
    )
