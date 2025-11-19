from datetime import date
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def test_data_fetch_from_csv(tmp_path: Path) -> None:
    # Prepare a small CSV file with two bars.
    csv_path = tmp_path / "sample.csv"
    csv_path.write_text(
        "timestamp,open,high,low,close,volume\n"
        "2024-01-01T09:15:00,100,110,95,105,1000\n"
        "2024-01-01T09:20:00,105,115,100,110,1500\n",
        encoding="utf-8",
    )

    client = TestClient(app)

    payload = {
        "symbol": "TEST",
        "timeframe": "5m",
        "start_date": date(2024, 1, 1).isoformat(),
        "end_date": date(2024, 1, 1).isoformat(),
        "source": "csv",
        "csv_path": str(csv_path),
        "exchange": "NSE",
    }

    response = client.post("/api/data/fetch", json=payload)
    assert response.status_code == 200, response.text

    data = response.json()
    assert data["symbol"] == "TEST"
    assert data["timeframe"] == "5m"
    assert data["bars_written"] == 2
    assert data["source"] == "csv"
