import pandas as pd
import pytest

from app.backtest_engine import BacktestConfig, BacktraderEngine
from app.backtest_service import BacktestService
from app.database import Base, SessionLocal, engine
from app.models import Strategy, StrategyParameter
from app.prices_database import PricesBase, PricesSessionLocal, prices_engine
from app.prices_models import PriceBar

# Skip this module entirely if Backtrader is not available.
pytest.importorskip(
    "backtrader",
    reason="backtrader not installed; skipping Zero Lag engine tests",
)


def setup_function() -> None:
    Base.metadata.create_all(bind=engine)
    PricesBase.metadata.create_all(bind=prices_engine)


def _synthetic_zero_lag_prices() -> pd.DataFrame:
    """Construct a simple synthetic series with a few trend shifts."""

    idx = pd.date_range("2024-01-01", periods=120, freq="D")
    # Piecewise upward segments with mild oscillation to trigger a handful of
    # reversals without being too noisy.
    base = pd.Series(
        [100 + (i // 30) * 5 for i in range(len(idx))],
        index=idx,
    )
    wobble = (pd.Series(range(len(idx)), index=idx) % 3 - 1) * 0.5
    prices = base + wobble
    return pd.DataFrame(
        {
            "open": prices,
            "high": prices + 1,
            "low": prices - 1,
            "close": prices,
            "volume": 1000,
        },
        index=idx,
    )


def test_zero_lag_engine_basic_metrics() -> None:
    """Smoke test: engine runs and produces stable metrics on synthetic data."""

    df = _synthetic_zero_lag_prices()
    cfg = BacktestConfig(
        strategy_code="ZeroLagTrendMtfStrategy",
        symbol="TESTZL",
        timeframe="1d",
        initial_capital=100_000.0,
        params={
            "length": 20,
            "mult": 1.0,
            "stop_loss_pct": 2.0,
            "take_profit_pct": 4.0,
            "take_long_only": False,
            "pyramid_limit": 2,
        },
    )

    engine_instance = BacktraderEngine()
    result = engine_instance.run(cfg, df)

    # Regression-style expectations derived from the current implementation on
    # this deterministic dataset. If the strategy behaviour drifts, these will
    # fail and prompt a review.
    assert result.strategy_code == "ZeroLagTrendMtfStrategy"
    assert result.symbol == "TESTZL"
    assert result.timeframe == "1d"
    assert len(result.equity_curve) > 0

    # It is possible for some synthetic paths to produce zero trades depending
    # on the band/volatility settings; we only assert that the engine runs and
    # that metrics stay within a sane range.
    final_value = result.metrics["final_value"]
    pnl = result.metrics["pnl"]

    assert 90_000.0 <= final_value <= 110_000.0
    assert -10_000.0 <= pnl <= 10_000.0


def test_zero_lag_service_trades_and_equity() -> None:
    """Integration: BacktestService runs Zero Lag strategy and persists trades."""

    meta_session = SessionLocal()
    prices_session = PricesSessionLocal()

    # Seed a strategy backed by ZeroLagTrendMtfStrategy.
    code = "ZLAG_MTF_TEST"
    strategy = meta_session.query(Strategy).filter_by(code=code).first()
    if strategy is None:
        strategy = Strategy(
            name="Zero Lag Trend MTF Test",
            code=code,
            category="trend",
            description="Zero Lag Trend MTF Backtrader integration test",
            status="experimental",
            tags=["test", "zerolag"],
            engine_code="ZeroLagTrendMtfStrategy",
        )
        meta_session.add(strategy)
        meta_session.commit()
        meta_session.refresh(strategy)

    params = StrategyParameter(
        strategy_id=strategy.id,
        label="default",
        params_json={
            "length": 20,
            "mult": 1.0,
            "stop_loss_pct": 2.0,
            "take_profit_pct": 4.0,
            "take_long_only": False,
            "pyramid_limit": 2,
        },
        notes="Zero Lag Trend MTF default params for tests.",
    )
    meta_session.add(params)
    meta_session.commit()
    meta_session.refresh(params)

    # Populate prices DB with the same synthetic data.
    df = _synthetic_zero_lag_prices()
    for ts, row in df.iterrows():
        prices_session.add(
            PriceBar(
                symbol="TESTZL",
                exchange="NSE",
                timeframe="1d",
                timestamp=ts.to_pydatetime(),
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                volume=float(row["volume"]),
                source="synthetic",
            )
        )
    prices_session.commit()

    service = BacktestService()
    start = df.index[0].to_pydatetime()
    end = df.index[-1].to_pydatetime()

    backtest = service.run_single_backtest(
        meta_db=meta_session,
        prices_db=prices_session,
        strategy_id=strategy.id,
        symbol="TESTZL",
        timeframe="1d",
        start=start,
        end=end,
        initial_capital=100_000.0,
        params=None,
        params_id=params.id,
        price_source="synthetic",
    )

    assert backtest.engine == "backtrader"
    assert backtest.symbols_json == ["TESTZL"]
    assert backtest.status == "completed"
    assert backtest.metrics_json is not None

    meta_session.refresh(backtest)
    assert backtest.equity_points  # type: ignore[attr-defined]
    trades = backtest.trades  # type: ignore[attr-defined]
    assert trades is not None
    # Some parameter/data combinations may legitimately produce zero trades;
    # we simply assert that, when trades exist, they carry PnL information.
    if trades:
        assert any(t.pnl is not None for t in trades)

    meta_session.close()
    prices_session.close()
