from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import Stock, StockGroup, StockGroupMember
from app.prices_database import PricesBase, PricesSessionLocal, prices_engine
from app.prices_models import PriceBar


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
    if resp.status_code == 201:
        return resp.json()

    if resp.status_code == 409:
        # Portfolio with this code already exists; fetch it from the list so
        # tests remain idempotent across repeated runs.
        list_resp = client.get("/api/portfolios")
        assert list_resp.status_code == 200, list_resp.text
        for item in list_resp.json():
            if item["code"] == code:
                return item
        raise AssertionError(
            f"Portfolio with code '{code}' exists but could not be fetched",
        )

    assert resp.status_code == 201, resp.text
    return resp.json()


def setup_function() -> None:
    # Ensure tables exist without wiping user data.
    Base.metadata.create_all(bind=engine)
    PricesBase.metadata.create_all(bind=prices_engine)


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

    # Create a minimal stock group with price data so the portfolio
    # backtest engine has something to work with.
    meta_session = SessionLocal()
    prices_session = PricesSessionLocal()

    stock = meta_session.query(Stock).filter(Stock.symbol == "PF_TEST").first()
    if stock is None:
        stock = Stock(
            symbol="PF_TEST",
            exchange="NSE",
            segment="equity",
            name="Portfolio Test",
        )
        meta_session.add(stock)
        meta_session.commit()
        meta_session.refresh(stock)

    group = meta_session.query(StockGroup).filter(StockGroup.code == "PF_GRP").first()
    if group is None:
        group = StockGroup(code="PF_GRP", name="Portfolio Group")
        meta_session.add(group)
        meta_session.commit()
        meta_session.refresh(group)

    existing_member = (
        meta_session.query(StockGroupMember)
        .filter(
            StockGroupMember.group_id == group.id,
            StockGroupMember.stock_id == stock.id,
        )
        .first()
    )
    if existing_member is None:
        member = StockGroupMember(group_id=group.id, stock_id=stock.id)
        meta_session.add(member)
        meta_session.commit()

    # Update portfolio to reference this group.
    resp = client.put(
        f"/api/portfolios/{portfolio_id}",
        json={"universe_scope": f"group:{group.id}"},
    )
    assert resp.status_code == 200

    # Universe summary in PortfolioRead should surface group metadata.
    resp = client.get(f"/api/portfolios/{portfolio_id}")
    assert resp.status_code == 200
    portfolio = resp.json()
    assert portfolio["universe"] is not None
    assert portfolio["universe"]["group_code"] == "PF_GRP"
    assert portfolio["universe"]["num_stocks"] >= 1

    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    idx = [start + timedelta(days=i) for i in range(5)]
    for i, ts in enumerate(idx):
        prices_session.add(
            PriceBar(
                symbol="PF_TEST",
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

    # Run a portfolio backtest via the API.
    resp = client.post(
        f"/api/portfolios/{portfolio_id}/backtests",
        params={
            "timeframe": "1d",
            "start": idx[0].isoformat(),
            "end": idx[-1].isoformat(),
            "initial_capital": 100_000.0,
        },
    )
    assert resp.status_code == 201, resp.text
    bt = resp.json()
    assert bt["portfolio_id"] == portfolio_id
    assert bt["timeframe"] == "1d"
    assert bt["initial_capital"] == 100_000.0
    assert bt["status"] == "completed"
    assert "metrics" in bt
    assert "final_value" in bt["metrics"]
    assert "equity_curve" in bt["metrics"]

    meta_session.close()
    prices_session.close()
