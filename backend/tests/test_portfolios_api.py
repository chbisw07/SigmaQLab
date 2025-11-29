from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _create_sample_portfolio(code: str = "CORE_EQ") -> dict:
    payload = {
        "code": code,
        "name": "Core Equity",
        "base_currency": "INR",
        "universe_scope": "group:1",
        "allowed_strategies": [1, 2],
        "risk_profile": {"maxPositionSizePct": 20.0},
        "rebalance_policy": {"frequency": "monthly"},
        "notes": "Sample portfolio used in tests.",
    }
    resp = client.post("/api/portfolios", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_and_get_portfolio() -> None:
    """Creating a portfolio and fetching it back should roundtrip fields."""

    created = _create_sample_portfolio()
    portfolio_id = created["id"]

    resp = client.get(f"/api/portfolios/{portfolio_id}")
    assert resp.status_code == 200
    fetched = resp.json()

    assert fetched["code"] == "CORE_EQ"
    assert fetched["name"] == "Core Equity"
    assert fetched["base_currency"] == "INR"
    assert fetched["universe_scope"] == "group:1"
    assert fetched["allowed_strategies"] == [1, 2]
    assert fetched["risk_profile"]["maxPositionSizePct"] == 20.0
    assert fetched["rebalance_policy"]["frequency"] == "monthly"


def test_unique_code_conflict() -> None:
    """Creating two portfolios with the same code should return HTTP 409."""

    _create_sample_portfolio(code="DUP_CODE")
    resp = client.post(
        "/api/portfolios",
        json={
            "code": "DUP_CODE",
            "name": "Duplicate",
            "base_currency": "INR",
        },
    )
    assert resp.status_code == 409


def test_update_and_delete_portfolio() -> None:
    """Portfolio update and delete should behave as expected."""

    created = _create_sample_portfolio(code="UPD_CODE")
    portfolio_id = created["id"]

    # Update name and risk profile.
    resp = client.put(
        f"/api/portfolios/{portfolio_id}",
        json={
            "name": "Updated Name",
            "risk_profile": {"maxPositionSizePct": 10.0},
        },
    )
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["name"] == "Updated Name"
    assert updated["risk_profile"]["maxPositionSizePct"] == 10.0

    # Delete and ensure it is gone.
    resp = client.delete(f"/api/portfolios/{portfolio_id}")
    assert resp.status_code == 204

    resp = client.get(f"/api/portfolios/{portfolio_id}")
    assert resp.status_code == 404


def test_list_portfolio_backtests_initially_empty() -> None:
    """New portfolios should have an empty backtest list."""

    created = _create_sample_portfolio(code="NO_BT")
    portfolio_id = created["id"]

    resp = client.get(f"/api/portfolios/{portfolio_id}/backtests")
    assert resp.status_code == 200
    assert resp.json() == []


def test_portfolio_backtest_read_shape() -> None:
    """Chart-data consumers expect PortfolioBacktestRead fields to be present."""

    created = _create_sample_portfolio(code="BT_SHAPE")
    portfolio_id = created["id"]

    # Manually insert a PortfolioBacktest row via the ORM so we can
    # exercise the read API without having implemented the engine yet.
    from app.database import SessionLocal
    from app.models import PortfolioBacktest

    now = datetime.now(timezone.utc)
    with SessionLocal() as session:
        bt = PortfolioBacktest(
            portfolio_id=portfolio_id,
            start_date=now - timedelta(days=10),
            end_date=now,
            timeframe="1d",
            initial_capital=100_000.0,
            status="completed",
            metrics_json={"dummy": True},
        )
        session.add(bt)
        session.commit()

    resp = client.get(f"/api/portfolios/{portfolio_id}/backtests")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    item = items[0]
    assert item["portfolio_id"] == portfolio_id
    assert item["timeframe"] == "1d"
    assert item["initial_capital"] == 100_000.0
    assert item["status"] == "completed"
    assert item["metrics"]["dummy"] is True
