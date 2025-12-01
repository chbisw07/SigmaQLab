from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models import (
    FactorExposure,
    FundamentalsSnapshot,
    Stock,
    StockGroup,
    StockGroupMember,
)
from app.services import ScreenerService


client = TestClient(app)


def _seed_screener_data(as_of: date) -> None:
    """Seed a small universe with fundamentals and factor exposures."""

    db = next(get_db())
    try:
        stocks = []
        for symbol, pe, roe, value in (
            ("SC_A", 10.0, 20.0, 1.0),
            ("SC_B", 20.0, 10.0, -0.5),
        ):
            stock = (
                db.query(Stock)
                .filter(Stock.symbol == symbol, Stock.exchange == "NSE")
                .first()
            )
            if stock is None:
                stock = Stock(
                    symbol=symbol,
                    exchange="NSE",
                    segment=None,
                    name=f"Screener {symbol}",
                    sector="TEST",
                    tags=None,
                    is_active=True,
                )
                db.add(stock)
                db.commit()
                db.refresh(stock)
            stocks.append((stock, pe, roe, value))

        for stock, pe, roe, value in stocks:
            existing_f = (
                db.query(FundamentalsSnapshot)
                .filter(
                    FundamentalsSnapshot.symbol == stock.symbol,
                    FundamentalsSnapshot.as_of_date == as_of,
                )
                .one_or_none()
            )
            if existing_f is None:
                db.add(
                    FundamentalsSnapshot(
                        symbol=stock.symbol,
                        as_of_date=as_of,
                        market_cap=1_000.0,
                        pe=pe,
                        pb=3.0,
                        ps=2.0,
                        roe=roe,
                        roce=roe,
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

            existing_fx = (
                db.query(FactorExposure)
                .filter(
                    FactorExposure.symbol == stock.symbol,
                    FactorExposure.as_of_date == as_of,
                )
                .one_or_none()
            )
            if existing_fx is None:
                db.add(
                    FactorExposure(
                        symbol=stock.symbol,
                        as_of_date=as_of,
                        value=value,
                        quality=0.5,
                        momentum=0.0,
                        low_vol=0.0,
                        size=0.0,
                        composite_score=value,
                    )
                )
        db.commit()
    finally:
        db.close()


def test_screener_service_basic_filter_and_ranking() -> None:
    """ScreenerService should filter and rank universe as per config."""

    as_of = date(2024, 4, 1)
    _seed_screener_data(as_of)

    db = next(get_db())
    try:
        service = ScreenerService()
        results = service.run_screener(
            db,
            universe="NSE_ALL",
            as_of_date=as_of,
            filters=[{"field": "PE", "op": "<", "value": 25}],
            ranking={
                "primary": {"field": "Value", "order": "desc"},
                "secondary": {"field": "ROE", "order": "desc"},
                "limit": 10,
            },
        )
        symbols = [row["symbol"] for row in results]
        assert "SC_A" in symbols and "SC_B" in symbols
        # SC_A has higher Value score than SC_B.
        assert symbols[0] == "SC_A"
    finally:
        db.close()


def test_screener_endpoint_and_group_creation() -> None:
    """End-to-end test for /screener/run and /groups/create_from_screener."""

    as_of = date(2024, 4, 2)
    _seed_screener_data(as_of)

    payload = {
        "universe": "NSE_ALL",
        "as_of_date": as_of.isoformat(),
        "filters": [
            {"field": "Value", "op": ">=", "value": -1.0},
        ],
        "ranking": {
            "primary": {"field": "Value", "order": "desc"},
            "secondary": {"field": "ROE", "order": "desc"},
            "limit": 2,
        },
    }
    resp = client.post("/api/v1/screener/run", json=payload)
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 2
    symbols = [item["symbol"] for item in items]
    assert symbols[0] == "SC_A"

    group_payload = {
        "name": "QualityTop2",
        "description": "Created from screener",
        "symbols": symbols,
    }
    resp_group = client.post("/api/v1/groups/create_from_screener", json=group_payload)
    assert resp_group.status_code == 200
    body = resp_group.json()
    assert body["status"] == "success"
    group_id = body["group_id"]

    # Verify group exists and holds the expected members.
    db = next(get_db())
    try:
        group = db.get(StockGroup, group_id)
        assert group is not None
        member_rows = (
            db.query(StockGroupMember)
            .join(Stock, Stock.id == StockGroupMember.stock_id)
            .filter(StockGroupMember.group_id == group.id)
            .all()
        )
        member_symbols = {
            db.get(Stock, m.stock_id).symbol  # type: ignore[union-attr]
            for m in member_rows
        }
        assert set(symbols).issubset(member_symbols)
    finally:
        db.close()
