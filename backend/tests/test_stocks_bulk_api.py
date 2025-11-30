from __future__ import annotations

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models import Stock, StockGroup, StockGroupMember


client = TestClient(app)


def test_bulk_deactivate_and_remove_from_universe() -> None:
    """Bulk-deactivation marks stocks inactive, bulk-remove deletes them."""

    db = next(get_db())
    try:
        stock1 = (
            db.query(Stock)
            .filter(Stock.symbol == "BULK1", Stock.exchange == "NSE")
            .first()
        )
        if stock1 is None:
            stock1 = Stock(
                symbol="BULK1",
                exchange="NSE",
                segment=None,
                name=None,
                sector=None,
                tags=None,
                is_active=True,
            )
            db.add(stock1)

        stock2 = (
            db.query(Stock)
            .filter(Stock.symbol == "BULK2", Stock.exchange == "NSE")
            .first()
        )
        if stock2 is None:
            stock2 = Stock(
                symbol="BULK2",
                exchange="NSE",
                segment=None,
                name=None,
                sector=None,
                tags=None,
                is_active=True,
            )
            db.add(stock2)

        # Ensure both are active at the start of the test.
        stock1.is_active = True
        stock2.is_active = True
        db.commit()
        db.refresh(stock1)
        db.refresh(stock2)

        group = db.query(StockGroup).filter(StockGroup.code == "BULKGRP").one_or_none()
        if group is None:
            group = StockGroup(
                code="BULKGRP",
                name="Bulk Ops Group",
                description=None,
                tags=None,
            )
            db.add(group)
            db.commit()
            db.refresh(group)

        # Ensure memberships exist for both stocks.
        for stock in (stock1, stock2):
            link = (
                db.query(StockGroupMember)
                .filter(
                    StockGroupMember.group_id == group.id,
                    StockGroupMember.stock_id == stock.id,
                )
                .one_or_none()
            )
            if link is None:
                db.add(StockGroupMember(group_id=group.id, stock_id=stock.id))
        db.commit()

        stock1_id = stock1.id
        stock2_id = stock2.id
        group_id = group.id
    finally:
        db.close()

    # Bulk-deactivate only the first stock.
    resp = client.post(
        "/api/stocks/bulk-deactivate",
        json={"ids": [stock1_id]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["updated"] == 1

    db = next(get_db())
    try:
        s1 = db.get(Stock, stock1_id)
        s2 = db.get(Stock, stock2_id)
        assert s1 is not None and s1.is_active is False
        assert s2 is not None and s2.is_active is True
    finally:
        db.close()

    # Now remove both stocks from the universe (and their memberships).
    resp = client.post(
        "/api/stocks/bulk-remove-from-universe",
        json={"ids": [stock1_id, stock2_id]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["updated"] == 2

    db = next(get_db())
    try:
        assert db.get(Stock, stock1_id) is None
        assert db.get(Stock, stock2_id) is None
        membership_count = (
            db.query(StockGroupMember)
            .filter(StockGroupMember.group_id == group_id)
            .count()
        )
        assert membership_count == 0
    finally:
        db.close()


def test_bulk_add_group_members_by_symbols() -> None:
    """Bulk-add endpoint attaches symbols to a group and avoids duplicates."""

    # Create or reuse a group and a couple of stocks in the universe.
    db = next(get_db())
    try:
        stock_a = (
            db.query(Stock)
            .filter(Stock.symbol == "ADD_A", Stock.exchange == "NSE")
            .first()
        )
        if stock_a is None:
            stock_a = Stock(
                symbol="ADD_A",
                exchange="NSE",
                segment=None,
                name=None,
                sector=None,
                tags=None,
                is_active=True,
            )
            db.add(stock_a)

        stock_b = (
            db.query(Stock)
            .filter(Stock.symbol == "ADD_B", Stock.exchange == "NSE")
            .first()
        )
        if stock_b is None:
            stock_b = Stock(
                symbol="ADD_B",
                exchange="NSE",
                segment=None,
                name=None,
                sector=None,
                tags=None,
                is_active=True,
            )
            db.add(stock_b)

        db.commit()
        db.refresh(stock_a)
        db.refresh(stock_b)

        group = db.query(StockGroup).filter(StockGroup.code == "BULKADD").one_or_none()
        if group is None:
            group = StockGroup(
                code="BULKADD",
                name="Bulk Add Group",
                description=None,
                tags=None,
            )
            db.add(group)
            db.commit()
            db.refresh(group)

        # Start from an empty membership set for this group.
        db.query(StockGroupMember).filter(
            StockGroupMember.group_id == group.id
        ).delete()
        db.commit()

        group_code = group.code
        group_id = group.id
    finally:
        db.close()

    # First call should add both symbols (duplicates are ignored).
    resp = client.post(
        f"/api/stock-groups/{group_code}/members/bulk-add",
        json={"symbols": ["ADD_A", "add_b", "ADD_A"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["added"] == 2

    db = next(get_db())
    try:
        membership_count = (
            db.query(StockGroupMember)
            .filter(StockGroupMember.group_id == group_id)
            .count()
        )
        assert membership_count == 2
    finally:
        db.close()

    # Second call with the same payload should be a no-op.
    resp = client.post(
        f"/api/stock-groups/{group_code}/members/bulk-add",
        json={"symbols": ["ADD_A", "ADD_B"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["added"] == 0
