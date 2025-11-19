from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.prices_database import PricesBase, prices_engine


def setup_function() -> None:
    # Ensure a clean prices DB for this test module.
    PricesBase.metadata.drop_all(bind=prices_engine)
    PricesBase.metadata.create_all(bind=prices_engine)


def test_data_summary_and_preview_from_csv(tmp_path: Path) -> None:
    csv_path = tmp_path / "sample.csv"
    csv_path.write_text(
        "timestamp,open,high,low,close,volume\n"
        "2024-01-01T09:15:00,100,110,95,105,1000\n"
        "2024-01-01T09:20:00,105,115,100,110,1500\n",
        encoding="utf-8",
    )

    client = TestClient(app)

    payload = {
        "symbol": "TEST2",
        "timeframe": "5m",
        "start_date": "2024-01-01",
        "end_date": "2024-01-01",
        "source": "csv",
        "csv_path": str(csv_path),
        "exchange": "NSE",
    }

    # Trigger fetch
    res = client.post("/api/data/fetch", json=payload)
    assert res.status_code == 200

    # Summary endpoint should reflect the ingested data.
    res_sum = client.get("/api/data/summary")
    assert res_sum.status_code == 200
    summary = res_sum.json()
    assert len(summary) == 1
    item = summary[0]
    assert item["symbol"] == "TEST2"
    assert item["exchange"] == "NSE"
    assert item["timeframe"] == "5m"
    assert item["bar_count"] == 2

    # Preview endpoint should return the actual bars.
    res_prev = client.get("/api/data/TEST2/preview", params={"timeframe": "5m"})
    assert res_prev.status_code == 200
    preview = res_prev.json()
    assert len(preview) == 2
    assert preview[0]["close"] == 105
    assert preview[1]["close"] == 110
