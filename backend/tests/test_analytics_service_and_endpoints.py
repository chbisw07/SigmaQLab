from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import (
    BacktestFactorExposure,
    BacktestSectorExposure,
    PortfolioBacktest,
)


client = TestClient(app)


def test_backtest_factor_and_sector_exposures_endpoints() -> None:
    """Factor/sector exposure analytics endpoints should return stored rows."""

    meta_session = SessionLocal()
    try:
        # Create a minimal PortfolioBacktest row.
        start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        end = start + timedelta(days=5)
        bt = PortfolioBacktest(
            portfolio_id=1,
            start_date=start,
            end_date=end,
            timeframe="1d",
            initial_capital=100_000.0,
            config_snapshot_json={},
            risk_profile_snapshot_json={},
            status="completed",
            metrics_json={},
        )
        meta_session.add(bt)
        meta_session.commit()
        meta_session.refresh(bt)

        # Seed a couple of factor and sector exposure rows.
        meta_session.add(
            BacktestFactorExposure(
                backtest_id=bt.id,
                date=start.date(),
                value=0.1,
                quality=0.2,
                momentum=0.3,
                low_vol=0.4,
                size=-0.1,
            )
        )
        meta_session.add(
            BacktestSectorExposure(
                backtest_id=bt.id,
                date=start.date(),
                sector="IT",
                weight=0.6,
            )
        )
        meta_session.add(
            BacktestSectorExposure(
                backtest_id=bt.id,
                date=start.date(),
                sector="FIN",
                weight=0.4,
            )
        )
        meta_session.commit()

        # Hit factor exposures endpoint.
        resp_f = client.get(f"/api/backtests/{bt.id}/factor-exposures")
        assert resp_f.status_code == 200, resp_f.text
        body_f = resp_f.json()
        assert isinstance(body_f, list)
        assert body_f
        first = body_f[0]
        assert first["date"].startswith("2024-01-01")
        assert first["value"] == 0.1
        assert first["quality"] == 0.2

        # Hit sector exposures endpoint.
        resp_s = client.get(f"/api/backtests/{bt.id}/sector-exposures")
        assert resp_s.status_code == 200, resp_s.text
        body_s = resp_s.json()
        assert isinstance(body_s, list)
        assert body_s
        dates = {row["date"] for row in body_s}
        assert dates == {"2024-01-01"}
        weights_by_sector = {row["sector"]: row["weight"] for row in body_s}
        # Ensure weights are surfaced as floats and sum close to 1.
        total_weight = sum(weights_by_sector.values())
        assert abs(total_weight - 1.0) < 1e-6
    finally:
        meta_session.close()
