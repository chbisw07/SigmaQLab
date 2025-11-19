from __future__ import annotations

from datetime import datetime
from typing import Any, Dict

import pandas as pd
from sqlalchemy.orm import Session

from .backtest_engine import BacktestConfig, BacktraderEngine
from .models import Backtest, Strategy, StrategyParameter
from .prices_models import PriceBar


class BacktestService:
    """Service layer for running backtests against stored price data."""

    def __init__(self, *, engine: BacktraderEngine | None = None) -> None:
        self._engine = engine or BacktraderEngine()

    def run_single_backtest(
        self,
        meta_db: Session,
        prices_db: Session,
        *,
        strategy_id: int,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
        initial_capital: float,
        params: Dict[str, Any] | None = None,
        params_id: int | None = None,
        price_source: str | None = None,
    ) -> Backtest:
        """Run a single backtest and persist a Backtest record.

        The function:
        - Loads the Strategy (and optional StrategyParameter) from the meta DB.
        - Loads OHLCV from the prices DB (price_bars).
        - Runs the Backtrader engine.
        - Persists an entry in the `backtests` table with basic metrics.
        """

        strategy = meta_db.get(Strategy, strategy_id)
        if strategy is None:
            msg = f"Strategy {strategy_id} not found"
            raise ValueError(msg)

        engine_code = strategy.engine_code or strategy.code

        resolved_params: Dict[str, Any] = {}
        if params_id is not None:
            param = meta_db.get(StrategyParameter, params_id)
            if param is None:
                msg = f"StrategyParameter {params_id} not found"
                raise ValueError(msg)
            resolved_params.update(param.params_json or {})
        if params:
            resolved_params.update(params)

        price_rows = (
            prices_db.query(PriceBar)
            .filter(
                PriceBar.symbol == symbol,
                PriceBar.timeframe == timeframe,
                PriceBar.timestamp >= start,
                PriceBar.timestamp <= end,
            )
            .order_by(PriceBar.timestamp.asc())
            .all()
        )

        if not price_rows:
            msg = "No price data available for given symbol/timeframe window"
            raise ValueError(msg)

        df = pd.DataFrame(
            {
                "open": [r.open for r in price_rows],
                "high": [r.high for r in price_rows],
                "low": [r.low for r in price_rows],
                "close": [r.close for r in price_rows],
                "volume": [r.volume or 0.0 for r in price_rows],
            },
            index=[r.timestamp for r in price_rows],
        )

        cfg = BacktestConfig(
            strategy_code=engine_code,
            symbol=symbol,
            timeframe=timeframe,
            initial_capital=initial_capital,
            params=resolved_params,
        )
        result = self._engine.run(cfg, df)

        backtest = Backtest(
            strategy_id=strategy.id,
            params_id=params_id,
            engine="backtrader",
            symbols_json=[symbol],
            timeframe=timeframe,
            start_date=start,
            end_date=end,
            initial_capital=initial_capital,
            starting_portfolio_json=None,
            status="completed",
            metrics_json=result.metrics,
            data_source=price_source,
        )
        meta_db.add(backtest)
        meta_db.commit()
        meta_db.refresh(backtest)
        return backtest
