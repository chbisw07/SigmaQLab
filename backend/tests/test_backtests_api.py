from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import Strategy, StrategyParameter
from app.prices_database import PricesBase, PricesSessionLocal, prices_engine
from app.prices_models import PriceBar

# Skip this module entirely if Backtrader is not available.
pytest.importorskip(
    "backtrader",
    reason="backtrader not installed; skipping backtests API tests",
)


client = TestClient(app)


def setup_function() -> None:
    # Ensure tables exist without wiping user data.
    Base.metadata.create_all(bind=engine)
    PricesBase.metadata.create_all(bind=prices_engine)


def test_create_backtest_via_api() -> None:
    meta_session = SessionLocal()
    prices_session = PricesSessionLocal()

    # Ensure a strategy and parameter set exist.
    code = "SMA_X_API"
    strategy = meta_session.query(Strategy).filter_by(code=code).first()
    if strategy is None:
        strategy = Strategy(
            name="SMA API Test",
            code=code,
            category="trend",
            description="SMA backtest via API",
            status="experimental",
        )
        meta_session.add(strategy)
        meta_session.commit()
        meta_session.refresh(strategy)

    param = StrategyParameter(
        strategy_id=strategy.id,
        label="api_default",
        params_json={"fast": 5, "slow": 20},
        notes="API test params",
    )
    meta_session.add(param)
    meta_session.commit()
    meta_session.refresh(param)

    # Insert synthetic price data for TESTBT
    start = datetime(2024, 1, 1)
    idx = [start + timedelta(days=i) for i in range(30)]
    for i, ts in enumerate(idx):
        prices_session.add(
            PriceBar(
                symbol="TESTBT",
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

    payload = {
        "strategy_id": strategy.id,
        "params_id": param.id,
        "symbol": "TESTBT",
        "timeframe": "1d",
        "start_date": idx[0].date().isoformat(),
        "end_date": idx[-1].date().isoformat(),
        "initial_capital": 50000.0,
        "price_source": "synthetic",
        "params": None,
    }

    resp = client.post("/api/backtests", json=payload)
    assert resp.status_code == 201, resp.text
    backtest = resp.json()

    assert backtest["strategy_id"] == strategy.id
    assert backtest["engine"] == "backtrader"
    assert backtest["symbols_json"] == ["TESTBT"]
    assert backtest["timeframe"] == "1d"
    assert backtest["status"] == "completed"
    assert "metrics" in backtest
    assert "final_value" in backtest["metrics"]

    # Ensure it appears in list endpoint.
    list_resp = client.get("/api/backtests")
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert any(item["id"] == backtest["id"] for item in items)

    meta_session.close()
    prices_session.close()
