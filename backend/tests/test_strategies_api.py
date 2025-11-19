from datetime import datetime

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _iso_to_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def test_strategy_and_parameters_crud() -> None:
    # Create a strategy
    create_payload = {
        "name": "SMA Crossover",
        "code": "SMA_X",
        "category": "trend",
        "description": "Simple SMA crossover strategy",
        "status": "experimental",
        "tags": ["intraday", "nifty"],
        "linked_sigma_trader_id": "st_sma_x",
        "linked_tradingview_template": "tv_sma_x",
        "live_ready": False,
    }

    resp = client.post("/api/strategies", json=create_payload)
    if resp.status_code == 409:
        # Strategy already exists from a previous test run; fetch it.
        list_resp = client.get("/api/strategies")
        assert list_resp.status_code == 200
        existing = [s for s in list_resp.json() if s["code"] == create_payload["code"]]
        assert existing, "Expected existing strategy with code SMA_X"
        strategy = existing[0]
    else:
        assert resp.status_code == 201, resp.text
        strategy = resp.json()
    strategy_id = strategy["id"]
    assert strategy["code"] == "SMA_X"
    assert strategy["tags"] == ["intraday", "nifty"]

    # List strategies
    resp = client.get("/api/strategies")
    assert resp.status_code == 200
    strategies = resp.json()
    assert any(s["id"] == strategy_id for s in strategies)

    # Get strategy by id
    resp = client.get(f"/api/strategies/{strategy_id}")
    assert resp.status_code == 200
    fetched = resp.json()
    assert fetched["code"] == "SMA_X"

    # Update the strategy
    update_payload = {
        "name": "SMA Crossover v2",
        "status": "candidate",
        "live_ready": True,
    }
    resp = client.put(f"/api/strategies/{strategy_id}", json=update_payload)
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["name"] == "SMA Crossover v2"
    assert updated["status"] == "candidate"
    assert updated["live_ready"] is True

    # Create a parameter set for the strategy
    param_payload = {
        "label": "default",
        "params": {"fast": 10, "slow": 30},
        "notes": "Initial parameters",
    }
    resp = client.post(f"/api/strategies/{strategy_id}/params", json=param_payload)
    assert resp.status_code == 201, resp.text
    param = resp.json()
    param_id = param["id"]
    assert param["strategy_id"] == strategy_id
    assert param["params"] == {"fast": 10, "slow": 30}

    # List parameters for the strategy
    resp = client.get(f"/api/strategies/{strategy_id}/params")
    assert resp.status_code == 200
    params = resp.json()
    assert any(p["id"] == param_id for p in params)

    # Get individual parameter
    resp = client.get(f"/api/params/{param_id}")
    assert resp.status_code == 200
    fetched_param = resp.json()
    assert fetched_param["label"] == "default"

    # Update the parameter
    update_param_payload = {
        "label": "aggressive",
        "params": {"fast": 5, "slow": 20},
        "notes": "Tighter settings",
    }
    resp = client.put(f"/api/params/{param_id}", json=update_param_payload)
    assert resp.status_code == 200
    updated_param = resp.json()
    assert updated_param["label"] == "aggressive"
    assert updated_param["params"] == {"fast": 5, "slow": 20}

    # Delete parameter
    resp = client.delete(f"/api/params/{param_id}")
    assert resp.status_code == 204

    # Delete strategy
    resp = client.delete(f"/api/strategies/{strategy_id}")
    assert resp.status_code == 204

    # Ensure subsequent GET returns 404
    resp = client.get(f"/api/strategies/{strategy_id}")
    assert resp.status_code == 404
