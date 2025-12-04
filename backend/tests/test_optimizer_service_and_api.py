from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.models import (
    FundamentalsSnapshot,
    Portfolio,
    PortfolioWeight,
    Stock,
    StockGroup,
    StockGroupMember,
)
from app.prices_database import get_prices_db
from app.prices_models import PriceBar
from app.services import OptimizerService


client = TestClient(app)


def _seed_portfolio_universe(as_of: date) -> tuple[int, list[str]]:
    """Create a small portfolio universe with two symbols and a group."""

    meta_db = next(get_db())
    try:
        session: Session = meta_db
        symbols = ["OPT_A", "OPT_B"]
        stocks: list[Stock] = []
        for sym in symbols:
            stock = (
                session.query(Stock)
                .filter(Stock.symbol == sym, Stock.exchange == "NSE")
                .first()
            )
            if stock is None:
                stock = Stock(
                    symbol=sym,
                    exchange="NSE",
                    segment=None,
                    name=f"Optim {sym}",
                    sector="TEST",
                    tags=None,
                    is_active=True,
                )
                session.add(stock)
                session.commit()
                session.refresh(stock)
            stocks.append(stock)

        # Fundamentals snapshot.
        for stock, pe in zip(stocks, (10.0, 20.0), strict=False):
            existing = (
                session.query(FundamentalsSnapshot)
                .filter(
                    FundamentalsSnapshot.symbol == stock.symbol,
                    FundamentalsSnapshot.as_of_date == as_of,
                )
                .one_or_none()
            )
            if existing is None:
                session.add(
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
                        sector="TEST",
                        industry="TEST_IND",
                    )
                )
        session.commit()

        # Group for the universe.
        group = (
            session.query(StockGroup).filter(StockGroup.code == "OPT_GRP").one_or_none()
        )
        if group is None:
            group = StockGroup(
                code="OPT_GRP",
                name="Optimiser Group",
                description=None,
                tags=None,
                composition_mode="weights",
                total_investable_amount=None,
            )
            session.add(group)
            session.commit()
            session.refresh(group)

        for stock in stocks:
            link = (
                session.query(StockGroupMember)
                .filter(
                    StockGroupMember.group_id == group.id,
                    StockGroupMember.stock_id == stock.id,
                )
                .one_or_none()
            )
            if link is None:
                session.add(StockGroupMember(group_id=group.id, stock_id=stock.id))
        session.commit()

        # Portfolio tied to this group.
        portfolio = (
            session.query(Portfolio).filter(Portfolio.code == "OPT_PORT").one_or_none()
        )
        if portfolio is None:
            portfolio = Portfolio(
                code="OPT_PORT",
                name="Optimiser Test Portfolio",
                base_currency="INR",
                universe_scope=f"group:{group.id}",
                allowed_strategies_json=None,
                risk_profile_json=None,
                rebalance_policy_json=None,
                notes=None,
            )
            session.add(portfolio)
            session.commit()
            session.refresh(portfolio)
        else:
            # Keep the universe_scope in sync with the test group so that
            # repeated runs against a persistent dev DB do not reference a
            # deleted group id.
            portfolio.universe_scope = f"group:{group.id}"
            session.add(portfolio)
            session.commit()

        portfolio_id = portfolio.id
    finally:
        meta_db.close()

    # Seed simple daily price history.
    prices_db = next(get_prices_db())
    try:
        start_dt = datetime.combine(as_of - timedelta(days=60), datetime.min.time())
        all_symbols = ["OPT_A", "OPT_B"]
        prices_db.query(PriceBar).filter(
            PriceBar.symbol.in_(all_symbols),  # type: ignore[arg-type]
            PriceBar.timeframe == "1d",
        ).delete(synchronize_session=False)

        for i in range(61):
            ts = start_dt + timedelta(days=i)
            base_price = 100.0 + i
            price_a = base_price
            price_b = base_price + ((-1.0) ** i) * 2.0
            for sym, close in (("OPT_A", price_a), ("OPT_B", price_b)):
                prices_db.add(
                    PriceBar(
                        symbol=sym,
                        exchange="NSE",
                        timeframe="1d",
                        timestamp=ts,
                        open=close,
                        high=close,
                        low=close,
                        close=close,
                        volume=None,
                        source="test",
                    )
                )
        prices_db.commit()
    finally:
        prices_db.close()

    return portfolio_id, ["OPT_A", "OPT_B"]


def test_optimizer_service_equal_weight() -> None:
    """OptimizerService should compute reasonable equal-weight allocations."""

    as_of = date(2024, 5, 1)
    portfolio_id, symbols = _seed_portfolio_universe(as_of)

    meta_db = next(get_db())
    prices_db = next(get_prices_db())
    try:
        service = OptimizerService()
        weights, risk, exposures, diagnostics = service.optimise_portfolio(
            meta_db=meta_db,
            prices_db=prices_db,
            portfolio_id=portfolio_id,
            as_of_date=as_of,
            optimizer_type="equal_weight",
            constraints={"min_weight": 0.0, "max_weight": 1.0},
            previous_weights=None,
        )

        assert diagnostics["optimizer_type"] == "equal_weight"
        assert len(weights) == len(symbols)
        total_weight = sum(w["weight"] for w in weights)
        assert abs(total_weight - 1.0) < 1e-6
        assert risk["volatility"] >= 0.0
        # Factor exposures should be present for the known names.
        assert "value" in exposures
    finally:
        meta_db.close()
        prices_db.close()


def test_portfolio_optimize_and_save_weights_api() -> None:
    """End-to-end test for /portfolio/optimize and /portfolio/save_weights."""

    as_of = date(2024, 5, 2)
    portfolio_id, symbols = _seed_portfolio_universe(as_of)

    # Optimise via API.
    payload = {
        "portfolio_id": portfolio_id,
        "as_of_date": as_of.isoformat(),
        "optimizer_type": "equal_weight",
        "constraints": {"min_weight": 0.0, "max_weight": 1.0},
    }
    resp = client.post("/api/v1/portfolio/optimize", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    weights = body["weights"]
    assert len(weights) == len(symbols)

    # Save weights.
    save_payload = {
        "portfolio_id": portfolio_id,
        "as_of_date": as_of.isoformat(),
        "weights": weights,
    }
    resp_save = client.post("/api/v1/portfolio/save_weights", json=save_payload)
    assert resp_save.status_code == 200
    assert resp_save.json()["status"] == "saved"

    # Verify weights persisted.
    meta_db = next(get_db())
    try:
        rows = (
            meta_db.query(PortfolioWeight)
            .filter(
                PortfolioWeight.portfolio_id == portfolio_id,
                PortfolioWeight.date == as_of,
            )
            .all()
        )
        assert rows
        assert {r.symbol for r in rows} == set(symbols)
    finally:
        meta_db.close()
