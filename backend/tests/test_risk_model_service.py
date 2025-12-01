from __future__ import annotations

from datetime import date, datetime, timedelta

from app.database import get_db
from app.models import CovarianceMatrix, RiskModel, Stock
from app.prices_database import get_prices_db
from app.prices_models import PriceBar
from app.services import RiskModelService


def _seed_returns_for_risk(as_of: date, symbols: list[str]) -> None:
    """Seed simple synthetic daily returns via PriceBar rows."""

    meta_db = next(get_db())
    try:
        # Ensure stocks exist in the meta DB.
        for sym in symbols:
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

        # Clear existing rows for these symbols/timeframe.
        prices_db.query(PriceBar).filter(
            PriceBar.symbol.in_(symbols),  # type: ignore[arg-type]
            PriceBar.timeframe == "1d",
        ).delete(synchronize_session=False)

        # Symbol RISK_A: lower volatility upward trend.
        # Symbol RISK_B: higher volatility zig-zag.
        for i in range(31):
            ts = start_dt + timedelta(days=i)
            base_price = 100.0 + i

            price_a = base_price
            if i % 2 == 0:
                price_b = base_price + 2.0
            else:
                price_b = base_price - 2.0

            for sym, close in (("RISK_A", price_a), ("RISK_B", price_b)):
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


def test_risk_model_and_covariance_basic() -> None:
    """RiskModelService should populate vol/beta and covariance matrix."""

    as_of = date(2024, 2, 28)
    symbols = ["RISK_A", "RISK_B"]
    _seed_returns_for_risk(as_of, symbols)

    meta_db = next(get_db())
    prices_db = next(get_prices_db())
    try:
        service = RiskModelService(lookback_days=30)
        risk_rows = service.compute_and_store_risk(
            meta_db=meta_db,
            prices_db=prices_db,
            symbols=symbols,
            as_of_date=as_of,
            timeframe="1d",
        )

        assert set(risk_rows.keys()) == set(symbols)

        # Persisted rows should exist with non-null volatility.
        stored = meta_db.query(RiskModel).filter(RiskModel.as_of_date == as_of).all()
        by_symbol = {row.symbol: row for row in stored}
        assert set(symbols).issubset(by_symbol.keys())
        assert by_symbol["RISK_A"].volatility is not None
        assert by_symbol["RISK_B"].volatility is not None

        # A simple sanity check on covariance matrix dimensions.
        cov_rows = (
            meta_db.query(CovarianceMatrix)
            .filter(CovarianceMatrix.as_of_date == as_of)
            .all()
        )
        assert cov_rows, "Expected at least one covariance matrix row"
        blob = cov_rows[-1].matrix_blob
        assert blob is not None
        cov = blob.get("cov_matrix")
        corr = blob.get("corr_matrix")
        assert cov is not None and corr is not None
        assert len(cov) == len(symbols)
        assert len(cov[0]) == len(symbols)
        assert len(corr) == len(symbols)
        assert len(corr[0]) == len(symbols)
    finally:
        meta_db.close()
        prices_db.close()
