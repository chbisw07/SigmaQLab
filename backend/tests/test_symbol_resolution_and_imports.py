from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.models import Stock


client = TestClient(app)


def test_resolve_symbol_uses_overrides_and_creates_nse_stock() -> None:
    # Import a tiny CSV with a symbol that appears in the overrides map to
    # exercise the resolution helper and TradingView import endpoint.
    csv_content = "Ticker\nBAJAJFINSV\n"
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

    # Verify the stock exists in the universe with NSE exchange.
    db = next(get_db())
    try:
        rows = (
            db.query(Stock)
            .filter(Stock.symbol == "BAJAJFINSV", Stock.exchange == "NSE")
            .all()
        )
        assert rows
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
    # At least one symbol should be added to the group (created or updated).
    assert body["added_to_group"] >= 1
