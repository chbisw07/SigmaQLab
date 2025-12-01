from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models import FundamentalsSnapshot, Stock
from app.prices_database import get_prices_db
from app.prices_models import PriceBar


client = TestClient(app)


def _seed_factor_universe(as_of: date) -> None:
    meta_db = next(get_db())
    try:
        stocks: list[tuple[str, float]] = [("EP_A", 10.0), ("EP_B", 20.0)]
        for sym, pe in stocks:
            stock = (
                meta_db.query(Stock)
                .filter(Stock.symbol == sym, Stock.exchange == "NSE")
                .first()
            )
            if stock is None:
                stock = Stock(
                    symbol=sym,
                    exchange="NSE",
                    segment=None,
                    name=f"Endpoint {sym}",
                    sector="TEST",
                    tags=None,
                    is_active=True,
                )
                meta_db.add(stock)
                meta_db.commit()

            existing = (
                meta_db.query(FundamentalsSnapshot)
                .filter(
                    FundamentalsSnapshot.symbol == sym,
                    FundamentalsSnapshot.as_of_date == as_of,
                )
                .one_or_none()
            )
            if existing is None:
                row = FundamentalsSnapshot(
                    symbol=sym,
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
                meta_db.add(row)
        meta_db.commit()
    finally:
        meta_db.close()

    prices_db = next(get_prices_db())
    try:
        start_dt = datetime.combine(as_of - timedelta(days=10), datetime.min.time())
        symbols = ["EP_A", "EP_B"]
        prices_db.query(PriceBar).filter(
            PriceBar.symbol.in_(symbols),  # type: ignore[arg-type]
            PriceBar.timeframe == "1d",
        ).delete(synchronize_session=False)

        for i in range(11):
            ts = start_dt + timedelta(days=i)
            close = 100.0 + i
            for sym in symbols:
                bar = PriceBar(
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
                prices_db.add(bar)
        prices_db.commit()
    finally:
        prices_db.close()


def _seed_risk_universe(as_of: date) -> None:
    meta_db = next(get_db())
    try:
        for sym in ("ERP_A", "ERP_B"):
            stock = (
                meta_db.query(Stock)
                .filter(Stock.symbol == sym, Stock.exchange == "NSE")
                .first()
            )
            if stock is None:
                stock = Stock(
                    symbol=sym,
                    exchange="NSE",
                    segment=None,
                    name=f"Risk {sym}",
                    sector="TEST",
                    tags=None,
                    is_active=True,
                )
                meta_db.add(stock)
        meta_db.commit()
    finally:
        meta_db.close()

    prices_db = next(get_prices_db())
    try:
        start_dt = datetime.combine(as_of - timedelta(days=30), datetime.min.time())
        symbols = ["ERP_A", "ERP_B"]
        prices_db.query(PriceBar).filter(
            PriceBar.symbol.in_(symbols),  # type: ignore[arg-type]
            PriceBar.timeframe == "1d",
        ).delete(synchronize_session=False)

        for i in range(31):
            ts = start_dt + timedelta(days=i)
            base_price = 100.0 + i
            price_a = base_price
            price_b = base_price + ((-1.0) ** i) * 2.0
            for sym, close in (("ERP_A", price_a), ("ERP_B", price_b)):
                bar = PriceBar(
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
                prices_db.add(bar)
        prices_db.commit()
    finally:
        prices_db.close()


def test_exposures_endpoint_returns_values() -> None:
    as_of = date(2024, 3, 1)
    _seed_factor_universe(as_of)

    payload = {"symbols": ["EP_A", "EP_B"], "as_of_date": as_of.isoformat()}
    resp = client.post("/api/v1/factors/exposures", json=payload)
    assert resp.status_code == 200

    body = resp.json()
    assert set(body.keys()) == {"EP_A", "EP_B"}
    assert "value" in body["EP_A"]
    # Lower PE (EP_A) should have higher Value score.
    assert body["EP_A"]["value"] > body["EP_B"]["value"]


def test_fundamentals_endpoint_returns_snapshot() -> None:
    as_of = date(2024, 3, 2)
    _seed_factor_universe(as_of)

    payload = {"symbols": ["EP_A"], "as_of_date": as_of.isoformat()}
    resp = client.post("/api/v1/factors/fundamentals", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert "EP_A" in body
    fundamentals = body["EP_A"]
    assert fundamentals["pe"] == 10.0
    assert fundamentals["sector"] == "TEST"


def test_risk_and_covariance_endpoints() -> None:
    as_of = date(2024, 3, 3)
    _seed_risk_universe(as_of)

    payload = {"symbols": ["ERP_A", "ERP_B"], "as_of_date": as_of.isoformat()}

    # Risk metrics endpoint.
    resp = client.post("/api/v1/factors/risk", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"ERP_A", "ERP_B"}
    assert body["ERP_A"]["volatility"] is not None
    assert body["ERP_B"]["volatility"] is not None

    # Covariance endpoint.
    resp_cov = client.post("/api/v1/factors/covariance", json=payload)
    assert resp_cov.status_code == 200
    cov_body = resp_cov.json()
    assert cov_body["symbols"] == ["ERP_A", "ERP_B"]
    cov = cov_body["cov_matrix"]
    corr = cov_body["corr_matrix"]
    assert len(cov) == 2 and len(cov[0]) == 2
    assert len(corr) == 2 and len(corr[0]) == 2
