from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import (
    BacktestFactorExposure,
    BacktestSectorExposure,
    FundamentalsSnapshot,
    PortfolioBacktest,
    Stock,
    StockGroup,
    StockGroupMember,
)
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


def test_portfolio_backtest_persists_exposures() -> None:
    """Portfolio backtests should persist factor and sector exposures."""

    created = _create_sample_portfolio(code="BT_EXPOSURES")
    portfolio_id = created["id"]

    meta_session = SessionLocal()
    prices_session = PricesSessionLocal()

    try:
        # Universe with two stocks in different sectors.
        stocks: list[Stock] = []
        for sym, sector in (("PF_A", "SECT_A"), ("PF_B", "SECT_B")):
            stock = (
                meta_session.query(Stock)
                .filter(Stock.symbol == sym, Stock.exchange == "NSE")
                .first()
            )
            if stock is None:
                stock = Stock(
                    symbol=sym,
                    exchange="NSE",
                    segment="equity",
                    name=f"Portfolio {sym}",
                    sector=sector,
                )
                meta_session.add(stock)
                meta_session.commit()
                meta_session.refresh(stock)
            stocks.append(stock)

        group = (
            meta_session.query(StockGroup)
            .filter(StockGroup.code == "PF_GRP_EXPO")
            .one_or_none()
        )
        if group is None:
            group = StockGroup(code="PF_GRP_EXPO", name="Portfolio Group Exposures")
            meta_session.add(group)
            meta_session.commit()
            meta_session.refresh(group)

        for stock in stocks:
            link = (
                meta_session.query(StockGroupMember)
                .filter(
                    StockGroupMember.group_id == group.id,
                    StockGroupMember.stock_id == stock.id,
                )
                .one_or_none()
            )
            if link is None:
                meta_session.add(StockGroupMember(group_id=group.id, stock_id=stock.id))
        meta_session.commit()

        # Attach portfolio to this group.
        resp = client.put(
            f"/api/portfolios/{portfolio_id}",
            json={"universe_scope": f"group:{group.id}"},
        )
        assert resp.status_code == 200

        # Fundamentals snapshot for factor construction.
        as_of = datetime(2024, 2, 1, tzinfo=timezone.utc).date()
        for stock, pe in zip(stocks, (10.0, 20.0), strict=False):
            existing = (
                meta_session.query(FundamentalsSnapshot)
                .filter(
                    FundamentalsSnapshot.symbol == stock.symbol,
                    FundamentalsSnapshot.as_of_date == as_of,
                )
                .one_or_none()
            )
            if existing is None:
                meta_session.add(
                    FundamentalsSnapshot(
                        symbol=stock.symbol,
                        as_of_date=as_of,
                        market_cap=1_000.0,
                        pe=pe,
                        pb=3.0,
                        ps=2.0,
                        roe=18.0,
                        roce=18.0,
                        debt_to_equity=0.5,
                        sales_growth_yoy=10.0,
                        profit_growth_yoy=10.0,
                        eps_growth_3y=8.0,
                        operating_margin=20.0,
                        net_margin=15.0,
                        interest_coverage=5.0,
                        promoter_holding=60.0,
                        fii_holding=10.0,
                        dii_holding=8.0,
                        sector=stock.sector,
                        industry="TEST_IND",
                    )
                )
        meta_session.commit()

        # Seed daily prices for both symbols with a modest history so that
        # factor and risk lookbacks have data to work with.
        start_prices = datetime(2023, 11, 1, tzinfo=timezone.utc)
        end_prices = datetime(2024, 2, 10, tzinfo=timezone.utc)
        prices_session.query(PriceBar).filter(
            PriceBar.symbol.in_([s.symbol for s in stocks]),  # type: ignore[arg-type]
            PriceBar.timeframe == "1d",
        ).delete(synchronize_session=False)

        cur = start_prices
        i = 0
        while cur <= end_prices:
            for stock in stocks:
                base = 100.0 + i
                prices_session.add(
                    PriceBar(
                        symbol=stock.symbol,
                        exchange="NSE",
                        timeframe="1d",
                        timestamp=cur,
                        open=base,
                        high=base,
                        low=base,
                        close=base,
                        volume=1_000,
                        source="synthetic",
                    )
                )
            cur += timedelta(days=1)
            i += 1
        prices_session.commit()

        # Run portfolio backtest over a window that includes the fundamentals
        # as-of date so that at least one rebalance has factor data.
        bt_start = datetime(2024, 2, 1, tzinfo=timezone.utc)
        bt_end = datetime(2024, 2, 10, tzinfo=timezone.utc)
        resp_bt = client.post(
            f"/api/portfolios/{portfolio_id}/backtests",
            params={
                "timeframe": "1d",
                "start": bt_start.isoformat(),
                "end": bt_end.isoformat(),
                "initial_capital": 100_000.0,
            },
        )
        assert resp_bt.status_code == 201, resp_bt.text
        bt_payload = resp_bt.json()
        bt_id = bt_payload["id"]

        # Fetch backtest from the meta DB to confirm metrics and exposure rows.
        bt_row = meta_session.get(PortfolioBacktest, bt_id)
        assert bt_row is not None
        metrics = bt_row.metrics_json or {}
        assert "equity_curve" in metrics

        factor_rows = (
            meta_session.query(BacktestFactorExposure)
            .filter(BacktestFactorExposure.backtest_id == bt_id)
            .all()
        )
        sector_rows = (
            meta_session.query(BacktestSectorExposure)
            .filter(BacktestSectorExposure.backtest_id == bt_id)
            .all()
        )

        assert factor_rows, "Expected factor exposures persisted for backtest."
        assert sector_rows, "Expected sector exposures persisted for backtest."

        # Factor rows should have at least one non-null factor value and the
        # sector rows should sum close to 1.0 for a given date.
        any_factor_non_null = any(
            fr.value is not None
            or fr.quality is not None
            or fr.momentum is not None
            or fr.low_vol is not None
            or fr.size is not None
            for fr in factor_rows
        )
        assert any_factor_non_null

        by_date: dict[date, float] = {}
        for row in sector_rows:
            by_date[row.date] = by_date.get(row.date, 0.0) + float(row.weight)
        assert any(abs(total - 1.0) < 1e-6 for total in by_date.values())
    finally:
        meta_session.close()
        prices_session.close()
