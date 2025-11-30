from app.database import get_db
from app.models import StockGroup, StockGroupMember


def test_example_groups_seeded() -> None:
    db = next(get_db())
    try:
        codes = {"GRP_WEIGHTS", "GRP_QTY", "GRP_AMOUNT"}
        groups = (
            db.query(StockGroup)
            .filter(StockGroup.code.in_(list(codes)))  # type: ignore[arg-type]
            .all()
        )
        found_codes = {g.code for g in groups}
        assert codes.issubset(found_codes)

        for g in groups:
            members = (
                db.query(StockGroupMember)
                .filter(StockGroupMember.group_id == g.id)
                .all()
            )
            assert members, f"group {g.code} should have at least one member"

            if g.composition_mode == "weights":
                assert any(m.target_weight_pct is not None for m in members)
            elif g.composition_mode == "qty":
                assert any(m.target_qty is not None for m in members)
            elif g.composition_mode == "amount":
                assert any(m.target_amount is not None for m in members)
    finally:
        db.close()
