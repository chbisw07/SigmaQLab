from datetime import datetime, timedelta

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.backtest_engine import BacktestConfig, BacktraderEngine
from app.backtest_service import BacktestService
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import Strategy, StrategyParameter
from app.prices_database import PricesBase, PricesSessionLocal, prices_engine
from app.prices_models import PriceBar

# Skip this module entirely if Backtrader is not available.
pytest.importorskip(
    "backtrader",
    reason="backtrader not installed; skipping engine tests",
)


client = TestClient(app)


def setup_function() -> None:
    # Ensure meta/prices tables exist for this module without dropping user data.
    Base.metadata.create_all(bind=engine)
    PricesBase.metadata.create_all(bind=prices_engine)


def test_backtrader_engine_runs_on_synthetic_data() -> None:
    # Create a simple upward price series to exercise the SMA strategy.
    idx = pd.date_range("2024-01-01", periods=50, freq="D")
    prices = pd.Series(range(100, 150), index=idx)
    df = pd.DataFrame(
        {
            "open": prices,
            "high": prices + 1,
            "low": prices - 1,
            "close": prices,
            "volume": 1000,
        },
        index=idx,
    )

    cfg = BacktestConfig(
        strategy_code="SMA_X",
        symbol="TEST",
        timeframe="1d",
        initial_capital=100_000.0,
        params={"fast": 5, "slow": 20},
    )

    engine_instance = BacktraderEngine()
    result = engine_instance.run(cfg, df)

    assert result.strategy_code == "SMA_X"
    assert result.symbol == "TEST"
    assert result.timeframe == "1d"
    # Backtrader may only start calling `next()` after the longest lookback
    # period has elapsed, so the equity curve can be shorter than the raw bar
    # count. We only require that it is non-empty and does not exceed input.
    assert 0 < len(result.equity_curve) <= len(df)
    assert "final_value" in result.metrics
    assert result.metrics["final_value"] > 0


def test_backtest_service_persists_backtest_record() -> None:
    # Set up meta DB with a strategy and parameter set.
    meta_session = SessionLocal()
    code = "SMA_X_SERVICE"
    strategy = meta_session.query(Strategy).filter_by(code=code).first()
    if strategy is None:
        strategy = Strategy(
            name="SMA Crossover Test",
            code=code,
            category="trend",
            description="Test strategy for Backtrader integration",
            status="experimental",
            tags=["test"],
        )
        meta_session.add(strategy)
        meta_session.commit()
        meta_session.refresh(strategy)

    params = StrategyParameter(
        strategy_id=strategy.id,
        label="default",
        params_json={"fast": 5, "slow": 20},
        notes="Test params",
    )
    meta_session.add(params)
    meta_session.commit()
    meta_session.refresh(params)

    # Populate price DB with synthetic OHLCV.
    prices_session = PricesSessionLocal()
    start = datetime(2024, 1, 1)
    idx = [start + timedelta(days=i) for i in range(50)]
    for i, ts in enumerate(idx):
        prices_session.add(
            PriceBar(
                symbol="TEST",
                exchange="NSE",
                timeframe="1d",
                timestamp=ts,
                open=100 + i,
                high=101 + i,
                low=99 + i,
                close=100 + i,
                volume=1000,
                source="synthetic",
            )
        )
    prices_session.commit()

    service = BacktestService()

    backtest = service.run_single_backtest(
        meta_db=meta_session,
        prices_db=prices_session,
        strategy_id=strategy.id,
        symbol="TEST",
        timeframe="1d",
        start=idx[0],
        end=idx[-1],
        initial_capital=50_000.0,
        params=None,
        params_id=params.id,
        price_source="synthetic",
    )

    assert backtest.id is not None
    assert backtest.strategy_id == strategy.id
    assert backtest.engine == "backtrader"
    assert backtest.symbols_json == ["TEST"]
    assert backtest.metrics_json is not None
    assert backtest.status == "completed"

    meta_session.close()
    prices_session.close()
