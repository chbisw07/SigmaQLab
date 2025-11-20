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
    assert "total_return" in backtest["metrics"]
    assert "max_drawdown" in backtest["metrics"]

    # Ensure it appears in list endpoint.
    list_resp = client.get("/api/backtests")
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert any(item["id"] == backtest["id"] for item in items)

    # Chart-data endpoint should return aligned series and trades.
    chart_resp = client.get(f"/api/backtests/{backtest['id']}/chart-data")
    assert chart_resp.status_code == 200, chart_resp.text
    chart = chart_resp.json()
    assert chart["backtest"]["id"] == backtest["id"]
    assert chart["price_bars"]
    assert chart["equity_curve"]
    # projection_curve is best-effort; it should have same length as price_bars.
    assert len(chart["projection_curve"]) == len(chart["price_bars"])
    # Trades array should be present (may be empty for some paths).
    assert "trades" in chart

    # Trades export endpoint should return CSV.
    export_resp = client.get(
        f"/api/backtests/{backtest['id']}/trades/export",
    )
    assert export_resp.status_code == 200
    assert "text/csv" in export_resp.headers.get("content-type", "")

    # Settings endpoint should allow updating label, notes and configs without
    # affecting core behaviour.
    settings_payload = {
        "label": "API test run",
        "notes": "BacktestOverhaul settings smoke test",
        "risk_config": {
            "maxPositionSizePct": 10.0,
            "perTradeRiskPct": 1.0,
            "allowShortSelling": False,
        },
        "costs_config": {
            "commissionType": "percent",
            "commissionValue": 0.01,
        },
        "visual_config": {
            "showTradeMarkers": False,
            "showProjection": True,
            "showVolume": True,
        },
    }
    settings_resp = client.patch(
        f"/api/backtests/{backtest['id']}/settings",
        json=settings_payload,
    )
    assert settings_resp.status_code == 200, settings_resp.text
    updated = settings_resp.json()
    assert updated["label"] == "API test run"
    assert updated["notes"].startswith("BacktestOverhaul")
    assert updated["risk_config"]["maxPositionSizePct"] == 10.0
    assert updated["costs_config"]["commissionType"] == "percent"
    assert updated["visual_config"]["showTradeMarkers"] is False

    # Detail endpoint should reflect the same settings.
    detail_resp = client.get(f"/api/backtests/{backtest['id']}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["label"] == "API test run"
    assert detail["visual_config"]["showProjection"] is True

    # Delete the backtest and ensure it no longer appears.
    delete_resp = client.delete(f"/api/backtests/{backtest['id']}")
    assert delete_resp.status_code == 204

    # Detail should now 404.
    detail_after_delete = client.get(f"/api/backtests/{backtest['id']}")
    assert detail_after_delete.status_code == 404

    # List endpoint should no longer include the deleted backtest.
    list_resp_after_delete = client.get("/api/backtests")
    assert list_resp_after_delete.status_code == 200
    items_after = list_resp_after_delete.json()
    assert all(item["id"] != backtest["id"] for item in items_after)

    meta_session.close()
    prices_session.close()
