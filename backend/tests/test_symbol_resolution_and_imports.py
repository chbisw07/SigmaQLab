from __future__ import annotations

from app.database import get_db
from app.models import Stock, StockGroup, StockGroupMember
from app.routers.stocks import _classify_segment_from_market_cap
from app.main import app
from fastapi.testclient import TestClient


client = TestClient(app)


def test_resolve_symbol_uses_overrides_and_creates_nse_stock() -> None:
    # Import a tiny CSV with a symbol that appears in the overrides map to
    # exercise the resolution helper and TradingView import endpoint.
    # Include market cap and sector columns so we can assert classification.
    # Use a large market cap ~200,000 crore to fall into the large-cap bucket.
    csv_content = (
        "Ticker,Market Capitalization,Sector\n"
        "BAJAJFINSV,2000000000000,FINANCIAL SERVICES\n"
    )
    files = {
        "file": ("tv.csv", csv_content.encode("utf-8"), "text/csv"),
    }
    data = {
        "group_code": "TESTTV",
        "group_name": "Test TradingView Import",
        "create_or_update_group": "true",
        "mark_active": "true",
    }

    resp = client.post(
        "/api/stocks/import/tradingview",
        files=files,
        data=data,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["created_stocks"] + body["updated_stocks"] >= 1
    assert body["group_code"] == "TESTTV"

    # Verify the stock exists in the universe with NSE exchange and has
    # derived segment/sector metadata.
    db = next(get_db())
    try:
        rows = (
            db.query(Stock)
            .filter(Stock.symbol == "BAJAJFINSV", Stock.exchange == "NSE")
            .all()
        )
        assert rows
        stock = rows[0]
        assert stock.segment == "large-cap"
        assert stock.sector == "Financial Services"
    finally:
        db.close()


def test_import_portfolio_creates_group_and_members() -> None:
    csv_content = "Symbol\nHDFCBANK\n"
    files = {
        "file": ("portfolio.csv", csv_content.encode("utf-8"), "text/csv"),
    }
    data = {
        "group_code": "TESTPORT",
        "group_name": "Test Portfolio Import",
        "mark_active": "true",
    }

    resp = client.post(
        "/api/stock-groups/import-portfolio-csv",
        files=files,
        data=data,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["group_code"] == "TESTPORT"

    # Verify that the group exists and that HDFCBANK is a member, regardless
    # of whether this test has been run before.
    db = next(get_db())
    try:
        group = db.query(StockGroup).filter(StockGroup.code == "TESTPORT").one()
        membership_exists = (
            db.query(StockGroupMember)
            .join(Stock, Stock.id == StockGroupMember.stock_id)
            .filter(
                StockGroupMember.group_id == group.id,
                Stock.symbol == "HDFCBANK",
            )
            .count()
            > 0
        )
        assert membership_exists
    finally:
        db.close()


def test_classify_segment_boundaries_in_crores() -> None:
    # None or non-positive market cap should not classify.
    assert _classify_segment_from_market_cap(None) is None
    assert _classify_segment_from_market_cap(0) is None
    assert _classify_segment_from_market_cap(-10) is None

    # Ultra-micro-cap: < 100 cr
    assert _classify_segment_from_market_cap(50) == "ultra-micro-cap"

    # Micro-cap: 100–1,000 cr (inclusive)
    assert _classify_segment_from_market_cap(100) == "micro-cap"
    assert _classify_segment_from_market_cap(1_000) == "micro-cap"

    # Small-cap: 1,000–4,999 cr (strictly greater than 1,000, below 5,000)
    assert _classify_segment_from_market_cap(1_000.01) == "small-cap"
    assert _classify_segment_from_market_cap(4_999.99) == "small-cap"

    # Mid-cap: 5,000–19,999 cr
    assert _classify_segment_from_market_cap(5_000) == "mid-cap"
    assert _classify_segment_from_market_cap(19_999.99) == "mid-cap"

    # Large-cap: >= 20,000 cr
    assert _classify_segment_from_market_cap(20_000) == "large-cap"
    assert _classify_segment_from_market_cap(50_000) == "large-cap"
