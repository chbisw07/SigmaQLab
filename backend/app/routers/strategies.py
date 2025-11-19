from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Strategy, StrategyParameter
from ..schemas import (
    StrategyCreate,
    StrategyParameterCreate,
    StrategyParameterRead,
    StrategyParameterUpdate,
    StrategyRead,
    StrategyUpdate,
)

router = APIRouter(prefix="/api", tags=["Strategies"])


def _get_strategy_or_404(db: Session, strategy_id: int) -> Strategy:
    strategy = db.get(Strategy, strategy_id)
    if strategy is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return strategy


def _get_param_or_404(db: Session, param_id: int) -> StrategyParameter:
    param = db.get(StrategyParameter, param_id)
    if param is None:
        raise HTTPException(status_code=404, detail="Strategy parameter not found")
    return param


@router.get("/strategies", response_model=List[StrategyRead])
async def list_strategies(db: Session = Depends(get_db)) -> List[StrategyRead]:
    strategies = db.query(Strategy).order_by(Strategy.name.asc()).all()
    return [StrategyRead.model_validate(s) for s in strategies]


@router.post("/strategies", response_model=StrategyRead, status_code=201)
async def create_strategy(
    payload: StrategyCreate,
    db: Session = Depends(get_db),
) -> StrategyRead:
    strategy = Strategy(
        name=payload.name,
        code=payload.code,
        category=payload.category,
        description=payload.description,
        status=payload.status,
        tags=payload.tags,
        linked_sigma_trader_id=payload.linked_sigma_trader_id,
        linked_tradingview_template=payload.linked_tradingview_template,
    )
    try:
        db.add(strategy)
        db.commit()
        db.refresh(strategy)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Strategy with code '{payload.code}' already exists",
        ) from exc
    return StrategyRead.model_validate(strategy)


@router.get("/strategies/{strategy_id}", response_model=StrategyRead)
async def get_strategy(
    strategy_id: int,
    db: Session = Depends(get_db),
) -> StrategyRead:
    strategy = _get_strategy_or_404(db, strategy_id)
    return StrategyRead.model_validate(strategy)


@router.put("/strategies/{strategy_id}", response_model=StrategyRead)
async def update_strategy(
    strategy_id: int,
    payload: StrategyUpdate,
    db: Session = Depends(get_db),
) -> StrategyRead:
    strategy = _get_strategy_or_404(db, strategy_id)
    update_data = payload.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        if field == "tags":
            setattr(strategy, field, value)
        else:
            setattr(strategy, field, value)

    try:
        db.add(strategy)
        db.commit()
        db.refresh(strategy)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Strategy with code '{payload.code}' already exists",
        ) from exc

    return StrategyRead.model_validate(strategy)


@router.delete("/strategies/{strategy_id}", status_code=204)
async def delete_strategy(
    strategy_id: int,
    db: Session = Depends(get_db),
) -> None:
    strategy = _get_strategy_or_404(db, strategy_id)

    # Delete associated parameters first due to FK constraint.
    db.query(StrategyParameter).filter(
        StrategyParameter.strategy_id == strategy.id
    ).delete()
    db.delete(strategy)
    db.commit()


@router.get(
    "/strategies/{strategy_id}/params",
    response_model=List[StrategyParameterRead],
)
async def list_strategy_params(
    strategy_id: int,
    db: Session = Depends(get_db),
) -> List[StrategyParameterRead]:
    _ = _get_strategy_or_404(db, strategy_id)
    params = (
        db.query(StrategyParameter)
        .filter(StrategyParameter.strategy_id == strategy_id)
        .order_by(StrategyParameter.created_at.asc())
        .all()
    )
    return [StrategyParameterRead.model_validate(p) for p in params]


@router.post(
    "/strategies/{strategy_id}/params",
    response_model=StrategyParameterRead,
    status_code=201,
)
async def create_strategy_param(
    strategy_id: int,
    payload: StrategyParameterCreate,
    db: Session = Depends(get_db),
) -> StrategyParameterRead:
    _ = _get_strategy_or_404(db, strategy_id)

    param = StrategyParameter(
        strategy_id=strategy_id,
        label=payload.label,
        params_json=payload.params,
        notes=payload.notes,
    )
    db.add(param)
    db.commit()
    db.refresh(param)
    return StrategyParameterRead.model_validate(param)


@router.get("/params/{param_id}", response_model=StrategyParameterRead)
async def get_param(
    param_id: int,
    db: Session = Depends(get_db),
) -> StrategyParameterRead:
    param = _get_param_or_404(db, param_id)
    return StrategyParameterRead.model_validate(param)


@router.put("/params/{param_id}", response_model=StrategyParameterRead)
async def update_param(
    param_id: int,
    payload: StrategyParameterUpdate,
    db: Session = Depends(get_db),
) -> StrategyParameterRead:
    param = _get_param_or_404(db, param_id)
    update_data = payload.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        if field == "params":
            param.params_json = value
        else:
            setattr(param, field, value)

    db.add(param)
    db.commit()
    db.refresh(param)
    return StrategyParameterRead.model_validate(param)


@router.delete("/params/{param_id}", status_code=204)
async def delete_param(
    param_id: int,
    db: Session = Depends(get_db),
) -> None:
    param = _get_param_or_404(db, param_id)
    db.delete(param)
    db.commit()
