from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Stock
from app.prices_database import PricesSessionLocal
from app.prices_models import PriceBar
from app.services import FactorRiskRebuildService


client = TestClient(app)


def _seed_prices_for_symbols(symbols: list[str], as_of: date) -> None:
    prices_session = PricesSessionLocal()
    try:
        start_dt = datetime.combine(as_of - timedelta(days=60), datetime.min.time())
        prices_session.query(PriceBar).filter(
            PriceBar.symbol.in_(symbols),  # type: ignore[arg-type]
            PriceBar.timeframe == "1d",
        ).delete(synchronize_session=False)

        for i in range(61):
            ts = start_dt + timedelta(days=i)
            for sym in symbols:
                base = 100.0 + i
                close = base + (0.5 if sym.endswith("B") else 0.0)
                prices_session.add(
                    PriceBar(
                        symbol=sym,
                        exchange="NSE",
                        timeframe="1d",
                        timestamp=ts,
                        open=close,
                        high=close,
                        low=close,
                        close=close,
                        volume=1_000,
                        source="test",
                    )
                )
        prices_session.commit()
    finally:
        prices_session.close()


def test_factor_risk_rebuild_service_for_nse_all() -> None:
    """FactorRiskRebuildService should compute factors and risk for NSE_ALL."""

    as_of = date(2025, 2, 12)
    meta_session: Session = SessionLocal()
    try:
        # Ensure at least two active stocks exist.
        symbols = ["REBUILD_A", "REBUILD_B"]
        for sym in symbols:
            stock = (
                meta_session.query(Stock)
                .filter(Stock.symbol == sym, Stock.exchange == "NSE")
                .one_or_none()
            )
            if stock is None:
                stock = Stock(
                    symbol=sym,
                    exchange="NSE",
                    segment=None,
                    name=f"Rebuild {sym}",
                    sector="TEST",
                    tags=None,
                    is_active=True,
                )
                meta_session.add(stock)
        meta_session.commit()

        _seed_prices_for_symbols(symbols, as_of)

        service = FactorRiskRebuildService()
        summary = service.rebuild_for_universe(
            meta_db=meta_session,
            prices_db=PricesSessionLocal(),
            universe="REBUILD_A,REBUILD_B",
            as_of_date=as_of,
            timeframe="1d",
        )

        assert summary["symbols_requested"] == 2
        assert summary["factor_rows_written"] >= 0
        assert summary["risk_rows_written"] == 2
    finally:
        meta_session.close()


def test_factors_rebuild_api_roundtrip() -> None:
    """POST /api/v1/factors/rebuild should return a summary payload."""

    as_of = date(2025, 2, 13)
    meta_session = SessionLocal()
    try:
        stock = (
            meta_session.query(Stock)
            .filter(Stock.symbol == "REBUILD_API", Stock.exchange == "NSE")
            .one_or_none()
        )
        if stock is None:
            stock = Stock(
                symbol="REBUILD_API",
                exchange="NSE",
                segment=None,
                name="Rebuild API Stock",
                sector="TEST",
                tags=None,
                is_active=True,
            )
            meta_session.add(stock)
            meta_session.commit()

        _seed_prices_for_symbols(["REBUILD_API"], as_of)
    finally:
        meta_session.close()

    resp = client.post(
        "/api/v1/factors/rebuild",
        json={
            "universe": "REBUILD_API",
            "as_of_date": as_of.isoformat(),
            "timeframe": "1d",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["universe"] == "REBUILD_API"
    assert body["symbols_requested"] >= 1
    assert "factor_rows_written" in body
    assert "risk_rows_written" in body
