from __future__ import annotations

from datetime import date
from pathlib import Path
from tempfile import NamedTemporaryFile

from app.database import SessionLocal
from app.models import FundamentalsSnapshot, FundamentalsSnapshotRun, Stock
from app.services_fundamentals import FundamentalsIngestionService


def _write_sample_screener_csv(path: Path) -> None:
    header = (
        "Name,BSE Code,NSE Code,Industry Group,Industry,Current Price,"
        "Market Capitalization,Price to Earning,Price to book value,"
        "Return on equity,Return on capital employed,Debt to equity,"
        "Sales,Sales preceding year,Profit after tax,Profit after tax preceding year,"
        "EPS growth 3Years,OPM,NPM last year,Interest Coverage Ratio,"
        "Promoter holding,FII holding,DII holding,Return over 1year,"
        "Return over 3years,Return over 5years\n"
    )
    row = (
        "Test Co,123456,TESTSYM,IT,Software,100.0,"
        "1000.0,20.0,4.0,15.0,18.0,0.5,"
        "200.0,150.0,40.0,30.0,"
        "25.0,20.0,15.0,5.0,"
        "60.0,10.0,8.0,12.0,20.0,30.0\n"
    )
    path.write_text(header + row, encoding="utf-8")


def test_ingest_screener_csv_creates_snapshot_and_run() -> None:
    """FundamentalsIngestionService should upsert Stock and FundamentalsSnapshot."""

    as_of = date(2025, 2, 12)
    with NamedTemporaryFile("w+", suffix=".csv", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    _write_sample_screener_csv(tmp_path)

    session = SessionLocal()
    try:
        service = FundamentalsIngestionService()
        summary = service.ingest_screener_csv(
            session,
            csv_path=tmp_path,
            as_of_date=as_of,
            report_type="consolidated",
            dry_run=False,
        )

        assert summary.symbols_processed == 1
        # Depending on existing state of the meta DB this symbol may be
        # created on first ingest or updated on subsequent runs. We only
        # require that exactly one row was affected and none were skipped.
        assert summary.symbols_created + summary.symbols_updated == 1
        assert summary.symbols_skipped == 0

        run = session.get(FundamentalsSnapshotRun, summary.run_id)
        assert run is not None
        assert run.as_of_date == as_of
        assert run.source == "screener_csv"

        stock = session.query(Stock).filter(Stock.symbol == "TESTSYM").one_or_none()
        assert stock is not None
        assert stock.sector == "IT"
        # Market cap and segment should be mirrored onto the Stock row so
        # the universe grid can display them without additional joins.
        assert stock.market_cap_crore == 1000.0
        assert stock.segment == "micro-cap"

        snapshot = (
            session.query(FundamentalsSnapshot)
            .filter(
                FundamentalsSnapshot.symbol == "TESTSYM",
                FundamentalsSnapshot.as_of_date == as_of,
            )
            .one_or_none()
        )
        assert snapshot is not None
        assert snapshot.market_cap == 1000.0
        assert snapshot.pe == 20.0
        assert snapshot.pb == 4.0
        assert snapshot.roe == 15.0
        # Growth metrics should be derived from current vs previous values.
        assert snapshot.sales_growth_yoy is not None
        assert snapshot.profit_growth_yoy is not None
    finally:
        session.close()
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
