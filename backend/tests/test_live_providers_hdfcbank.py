import os
from datetime import datetime, timedelta

import pytest

from app.config import get_settings
from app.services import (
    ProviderUnavailableError,
    fetch_ohlcv_from_kite,
    fetch_ohlcv_from_yfinance,
)


RUN_LIVE = os.getenv("SIGMAQLAB_RUN_LIVE_DATA_TESTS") == "1"


pytestmark = pytest.mark.skipif(
    not RUN_LIVE,
    reason="Set SIGMAQLAB_RUN_LIVE_DATA_TESTS=1 to run live data provider tests",
)


@pytest.mark.integration
def test_yfinance_hdfcbank_intervals() -> None:
    """Basic smoke test that yfinance can return HDFCBANK data."""

    end = datetime.now()
    start = end - timedelta(days=14)

    # Test a couple of realistic intervals.
    for tf in ("1d", "1h"):
        bars = fetch_ohlcv_from_yfinance(
            symbol="HDFCBANK",
            timeframe=tf,
            start=start,
            end=end,
            exchange="NSE",
        )
        if not bars:
            pytest.skip(
                "yfinance returned no data for timeframe "
                f"{tf} (ticker may be unavailable)"
            )
        assert len(bars) > 0, f"Expected yfinance data for timeframe {tf}"


@pytest.mark.integration
def test_kite_hdfcbank_intervals() -> None:
    """Basic smoke test that Kite can return HDFCBANK data when credentials exist."""

    settings = get_settings()
    if not settings.kite_api_key or not settings.kite_access_token:
        pytest.skip("Kite credentials not configured in environment")

    # Import TokenException lazily so the test still runs if kiteconnect is
    # missing or its exception layout changes.
    try:  # pragma: no cover - import layout is external
        from kiteconnect.exception import TokenException  # type: ignore[import]
    except Exception:  # pragma: no cover - fallback when kiteconnect is absent
        TokenException = Exception  # type: ignore[assignment]

    end = datetime.now()
    start = end - timedelta(days=5)

    for tf in ("1m", "5m", "1d"):
        try:
            bars = fetch_ohlcv_from_kite(
                symbol="HDFCBANK",
                timeframe=tf,
                start=start,
                end=end,
                api_key=settings.kite_api_key,
                access_token=settings.kite_access_token,
                exchange="NSE",
            )
        except (ProviderUnavailableError, TokenException) as exc:
            pytest.skip(f"Kite provider unavailable or auth failed: {exc}")

        assert len(bars) > 0, f"Expected Kite data for timeframe {tf}"
