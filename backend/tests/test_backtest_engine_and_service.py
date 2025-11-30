from datetime import datetime, timedelta

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.backtest_engine import BacktestConfig, BacktraderEngine
from app.backtest_service import BacktestService
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import Stock, StockGroup, StockGroupMember, Strategy, StrategyParameter
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
        risk_config=None,
        costs_config=None,
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
    metrics = backtest.metrics_json
    assert "final_value" in metrics
    assert "total_return" in metrics
    assert "max_drawdown" in metrics
    # New risk metrics from Backtest Overhaul.
    assert "volatility" in metrics
    assert "sharpe" in metrics
    assert "sortino" in metrics
    assert "annual_return" in metrics
    assert "calmar" in metrics
    assert backtest.status == "completed"

    # Equity curve and trades should also have been persisted.
    meta_session.refresh(backtest)
    assert backtest.equity_points  # type: ignore[attr-defined]
    # Equity curve and trades should also have been persisted.
    trades = backtest.trades  # type: ignore[attr-defined]
    assert trades is not None

    # Per-trade derived metrics (what-if projections) should be present when
    # at least one trade exists. Some synthetic paths may produce zero trades,
    # so we guard the detailed checks accordingly.
    if trades:
        trade = trades[0]
        assert trade.pnl is not None  # type: ignore[attr-defined]
        # New optional columns should exist even if some values are None.
        assert hasattr(trade, "pnl_pct")
        assert hasattr(trade, "holding_period_bars")
        assert hasattr(trade, "max_theoretical_pnl")
        assert hasattr(trade, "max_theoretical_pnl_pct")
        assert hasattr(trade, "pnl_capture_ratio")

    meta_session.close()
    prices_session.close()


def test_group_backtest_includes_group_composition_metadata() -> None:
    """Group backtests should attach group composition metadata in metrics."""

    meta_session = SessionLocal()
    prices_session = PricesSessionLocal()

    # Ensure a strategy and params exist (reuse SMA_X_SERVICE).
    code = "SMA_X_SERVICE"
    strategy = meta_session.query(Strategy).filter_by(code=code).first()
    if strategy is None:
        strategy = Strategy(
            name="SMA Crossover Test",
            code=code,
            category="trend",
            description="Test strategy for group backtests",
            status="experimental",
        )
        meta_session.add(strategy)
        meta_session.commit()
        meta_session.refresh(strategy)

    params = (
        meta_session.query(StrategyParameter)
        .filter(
            StrategyParameter.strategy_id == strategy.id,
            StrategyParameter.label == "default",
        )
        .order_by(StrategyParameter.id.asc())
        .first()
    )
    if params is None:
        params = StrategyParameter(
            strategy_id=strategy.id,
            label="default",
            params_json={"fast": 5, "slow": 20},
            notes="Group backtest params",
        )
        meta_session.add(params)
        meta_session.commit()
        meta_session.refresh(params)

    # Use one of the seeded example groups (weights mode).
    group = (
        meta_session.query(StockGroup).filter(StockGroup.code == "GRP_WEIGHTS").one()
    )
    members = (
        meta_session.query(StockGroupMember, Stock)
        .join(Stock, Stock.id == StockGroupMember.stock_id)
        .filter(StockGroupMember.group_id == group.id)
        .all()
    )
    assert members

    # Seed simple synthetic prices for each member symbol.
    start = datetime(2024, 1, 1)
    idx = [start + timedelta(days=i) for i in range(60)]
    for _member, stock in members:
        for i, ts in enumerate(idx):
            prices_session.add(
                PriceBar(
                    symbol=stock.symbol,
                    exchange=stock.exchange or "NSE",
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
    bt = service.run_group_backtest(
        meta_db=meta_session,
        prices_db=prices_session,
        strategy_id=strategy.id,
        group_id=group.id,
        timeframe="1d",
        start=idx[0],
        end=idx[-1],
        initial_capital=100_000.0,
        params=None,
        params_id=params.id,
        price_source="synthetic",
    )

    metrics = bt.metrics_json or {}
    assert "group_composition" in metrics
    comp = metrics["group_composition"]
    assert comp["group_id"] == group.id
    assert comp["group_code"] == group.code
    assert comp["composition_mode"] == group.composition_mode
    assert comp["member_count"] == len(members)
    assert isinstance(comp["members"], list)
    assert comp["members"]
    first_member = comp["members"][0]
    # Plumbing-only: target fields may be None, but keys should exist.
    assert "symbol" in first_member
    assert "target_weight_pct" in first_member
    assert "target_qty" in first_member
    assert "target_amount" in first_member

    meta_session.close()
    prices_session.close()
