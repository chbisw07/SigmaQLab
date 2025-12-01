from __future__ import annotations

from datetime import date, datetime, timedelta

from app.database import get_db
from app.models import FactorExposure, FundamentalsSnapshot, Stock
from app.prices_database import get_prices_db
from app.prices_models import PriceBar
from app.services import FactorService


def _seed_basic_universe(as_of: date) -> None:
    """Seed two stocks with different PE ratios and identical other metrics."""

    meta_db = next(get_db())
    try:
        # Create or reuse stocks.
        stock_a = (
            meta_db.query(Stock)
            .filter(Stock.symbol == "FACTOR_A", Stock.exchange == "NSE")
            .first()
        )
        if stock_a is None:
            stock_a = Stock(
                symbol="FACTOR_A",
                exchange="NSE",
                segment=None,
                name="Factor A",
                sector="TEST",
                tags=None,
                is_active=True,
            )
            meta_db.add(stock_a)

        stock_b = (
            meta_db.query(Stock)
            .filter(Stock.symbol == "FACTOR_B", Stock.exchange == "NSE")
            .first()
        )
        if stock_b is None:
            stock_b = Stock(
                symbol="FACTOR_B",
                exchange="NSE",
                segment=None,
                name="Factor B",
                sector="TEST",
                tags=None,
                is_active=True,
            )
            meta_db.add(stock_b)

        meta_db.commit()

        # Ensure fundamentals snapshots for the as_of date.
        for stock, pe in ((stock_a, 10.0), (stock_b, 20.0)):
            existing = (
                meta_db.query(FundamentalsSnapshot)
                .filter(
                    FundamentalsSnapshot.symbol == stock.symbol,
                    FundamentalsSnapshot.as_of_date == as_of,
                )
                .one_or_none()
            )
            if existing is None:
                row = FundamentalsSnapshot(
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
                meta_db.add(row)
        meta_db.commit()
    finally:
        meta_db.close()

    # Seed simple daily price history in the prices DB.
    prices_db = next(get_prices_db())
    try:
        start_dt = datetime.combine(as_of - timedelta(days=10), datetime.min.time())
        symbols = ["FACTOR_A", "FACTOR_B"]
        # Clear any existing rows for these symbols/timeframe.
        prices_db.query(PriceBar).filter(
            PriceBar.symbol.in_(symbols),  # type: ignore[arg-type]
            PriceBar.timeframe == "1d",
        ).delete(synchronize_session=False)

        for i in range(11):
            ts = start_dt + timedelta(days=i)
            # Identical simple upward trend for both symbols to keep
            # non-value factors roughly aligned.
            close_a = 100.0 + i
            close_b = 100.0 + i
            for symbol, close in (("FACTOR_A", close_a), ("FACTOR_B", close_b)):
                bar = PriceBar(
                    symbol=symbol,
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


def _seed_universe_with_missing_fundamentals(as_of: date) -> None:
    """Universe where one stock has missing valuation metrics to test imputation."""

    meta_db = next(get_db())
    try:
        symbols = ["FACTOR_M1", "FACTOR_M2", "FACTOR_MISS"]
        stocks: list[Stock] = []
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
                    name=f"Factor {sym}",
                    sector="TEST",
                    tags=None,
                    is_active=True,
                )
                meta_db.add(stock)
                meta_db.commit()
                meta_db.refresh(stock)
            stocks.append(stock)

        # Two stocks with full fundamentals, one with missing PE/PB/PS to
        # trigger median imputation for Value factor.
        for stock, pe in zip(stocks[:2], (10.0, 20.0), strict=False):
            existing = (
                meta_db.query(FundamentalsSnapshot)
                .filter(
                    FundamentalsSnapshot.symbol == stock.symbol,
                    FundamentalsSnapshot.as_of_date == as_of,
                )
                .one_or_none()
            )
            if existing is None:
                meta_db.add(
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

        # Third stock: fundamentals snapshot without PE/PB/PS so that Value
        # raw is missing and must be imputed.
        missing_stock = stocks[2]
        existing_missing = (
            meta_db.query(FundamentalsSnapshot)
            .filter(
                FundamentalsSnapshot.symbol == missing_stock.symbol,
                FundamentalsSnapshot.as_of_date == as_of,
            )
            .one_or_none()
        )
        if existing_missing is None:
            meta_db.add(
                FundamentalsSnapshot(
                    symbol=missing_stock.symbol,
                    as_of_date=as_of,
                    market_cap=1_000.0,
                    pe=None,
                    pb=None,
                    ps=None,
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
        meta_db.commit()
    finally:
        meta_db.close()

    # Seed simple identical price history so that momentum/low-vol can be
    # computed when needed, though the imputation test focuses on Value.
    prices_db = next(get_prices_db())
    try:
        start_dt = datetime.combine(as_of - timedelta(days=10), datetime.min.time())
        symbols = ["FACTOR_M1", "FACTOR_M2", "FACTOR_MISS"]
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


def test_factor_service_value_ordering() -> None:
    """Lowest PE should correspond to highest Value exposure."""

    as_of = date(2024, 1, 31)
    _seed_basic_universe(as_of)

    meta_db = next(get_db())
    prices_db = next(get_prices_db())
    try:
        service = FactorService(lookback_days=10)
        exposures = service.compute_and_store_exposures(
            meta_db=meta_db,
            prices_db=prices_db,
            symbols=["FACTOR_A", "FACTOR_B"],
            as_of_date=as_of,
            timeframe="1d",
        )

        assert "FACTOR_A" in exposures and "FACTOR_B" in exposures

        # Check that rows were persisted.
        rows = (
            meta_db.query(FactorExposure)
            .filter(FactorExposure.as_of_date == as_of)
            .all()
        )
        symbols = {row.symbol for row in rows}
        assert {"FACTOR_A", "FACTOR_B"}.issubset(symbols)

        val_a = exposures["FACTOR_A"].value
        val_b = exposures["FACTOR_B"].value
        assert val_a is not None and val_b is not None
        assert val_a > val_b
    finally:
        meta_db.close()
        prices_db.close()


def test_factor_service_median_imputation_for_missing_fundamentals() -> None:
    """Stocks with missing fundamentals should receive imputed factor values."""

    as_of = date(2024, 2, 15)
    _seed_universe_with_missing_fundamentals(as_of)

    meta_db = next(get_db())
    prices_db = next(get_prices_db())
    try:
        service = FactorService(lookback_days=10)
        exposures = service.compute_and_store_exposures(
            meta_db=meta_db,
            prices_db=prices_db,
            symbols=["FACTOR_M1", "FACTOR_M2", "FACTOR_MISS"],
            as_of_date=as_of,
            timeframe="1d",
        )

        # All three symbols should have factor exposure rows, including the
        # one with missing PE/PB/PS.
        assert set(exposures.keys()) == {
            "FACTOR_M1",
            "FACTOR_M2",
            "FACTOR_MISS",
        }
        assert exposures["FACTOR_MISS"].value is not None
    finally:
        meta_db.close()
        prices_db.close()
