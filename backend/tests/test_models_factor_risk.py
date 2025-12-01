from __future__ import annotations

from datetime import date

from app.database import get_db
from app.models import (
    CovarianceMatrix,
    FactorExposure,
    FundamentalsSnapshot,
    RiskModel,
    Stock,
)


def _get_or_create_test_stock() -> Stock:
    db = next(get_db())
    try:
        symbol = "FACTOR_TEST"
        exchange = "NSE"
        stock = (
            db.query(Stock)
            .filter(Stock.symbol == symbol, Stock.exchange == exchange)
            .first()
        )
        if stock is None:
            stock = Stock(
                symbol=symbol,
                exchange=exchange,
                segment=None,
                name="Factor Test Stock",
                sector="TEST",
                tags=None,
                is_active=True,
            )
            db.add(stock)
            db.commit()
            db.refresh(stock)
        return stock
    finally:
        db.close()


def test_fundamentals_snapshot_roundtrip() -> None:
    stock = _get_or_create_test_stock()
    as_of = date(2024, 1, 1)

    db = next(get_db())
    try:
        snapshot = FundamentalsSnapshot(
            symbol=stock.symbol,
            as_of_date=as_of,
            market_cap=123.45,
            pe=15.2,
            pb=3.1,
            ps=2.0,
            roe=18.0,
            roce=20.0,
            debt_to_equity=0.5,
            sales_growth_yoy=10.0,
            profit_growth_yoy=12.0,
            eps_growth_3y=8.0,
            operating_margin=25.0,
            net_margin=18.0,
            interest_coverage=5.0,
            promoter_holding=60.0,
            fii_holding=12.0,
            dii_holding=8.0,
            sector="TEST",
            industry="TEST_INDUSTRY",
        )
        db.add(snapshot)
        db.commit()
        db.refresh(snapshot)

        loaded = db.get(FundamentalsSnapshot, snapshot.id)
        assert loaded is not None
        assert loaded.symbol == stock.symbol
        assert loaded.as_of_date == as_of
        assert loaded.market_cap == 123.45
        assert loaded.pe == 15.2
        assert loaded.sector == "TEST"
        assert loaded.industry == "TEST_INDUSTRY"
    finally:
        db.close()


def test_factor_exposure_roundtrip() -> None:
    stock = _get_or_create_test_stock()
    as_of = date(2024, 1, 2)

    db = next(get_db())
    try:
        exposure = FactorExposure(
            symbol=stock.symbol,
            as_of_date=as_of,
            value=0.8,
            quality=0.6,
            momentum=0.4,
            low_vol=0.2,
            size=-0.1,
            composite_score=0.5,
        )
        db.add(exposure)
        db.commit()
        db.refresh(exposure)

        loaded = db.get(FactorExposure, exposure.id)
        assert loaded is not None
        assert loaded.symbol == stock.symbol
        assert loaded.as_of_date == as_of
        assert loaded.value == 0.8
        assert loaded.quality == 0.6
        assert loaded.momentum == 0.4
        assert loaded.low_vol == 0.2
        assert loaded.size == -0.1
        assert loaded.composite_score == 0.5
    finally:
        db.close()


def test_risk_model_roundtrip() -> None:
    stock = _get_or_create_test_stock()
    as_of = date(2024, 1, 3)

    db = next(get_db())
    try:
        risk = RiskModel(
            symbol=stock.symbol,
            as_of_date=as_of,
            volatility=0.25,
            beta=1.1,
            tail_beta=1.3,
            skew=-0.2,
            kurtosis=3.5,
        )
        db.add(risk)
        db.commit()
        db.refresh(risk)

        loaded = db.get(RiskModel, risk.id)
        assert loaded is not None
        assert loaded.symbol == stock.symbol
        assert loaded.as_of_date == as_of
        assert loaded.volatility == 0.25
        assert loaded.beta == 1.1
        assert loaded.tail_beta == 1.3
        assert loaded.skew == -0.2
        assert loaded.kurtosis == 3.5
    finally:
        db.close()


def test_covariance_matrix_roundtrip() -> None:
    as_of = date(2024, 1, 4)
    universe_hash = "TEST_UNIVERSE_HASH"
    matrix = {
        "symbols": ["FACTOR_TEST"],
        "matrix": [[1.0]],
    }

    db = next(get_db())
    try:
        cov = CovarianceMatrix(
            as_of_date=as_of,
            universe_hash=universe_hash,
            matrix_blob=matrix,
        )
        db.add(cov)
        db.commit()
        db.refresh(cov)

        loaded = db.get(CovarianceMatrix, cov.id)
        assert loaded is not None
        assert loaded.as_of_date == as_of
        assert loaded.universe_hash == universe_hash
        assert loaded.matrix_blob == matrix
    finally:
        db.close()
