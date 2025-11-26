from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .prices_models import PriceBar
from .services import DataService


class DataManager:
    """Helper responsible for ensuring OHLCV coverage in the prices DB.

    This component is used by backtests (and optionally the Data page) to
    guarantee that sufficient local price data exists for a given
    (symbol, timeframe, [start, end]) window before the engine runs.

    For now the implementation is deliberately conservative:

    - If there are already `PriceBar` rows for the requested
      (symbol, timeframe) that fully cover [start, end], it is a no-op.
    - Otherwise, if a recognised external source is provided (kite/yfinance),
      it calls `DataService.fetch_and_store_bars` once for [start, end].

    This keeps the behaviour simple while avoiding unnecessary provider calls
    when coverage already exists. More advanced base-timeframe caching and
    gap-filling logic can be layered on top in later sprints.
    """

    def __init__(
        self,
        *,
        settings: Optional[Settings] = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._service = DataService(
            kite_api_key=self._settings.kite_api_key,
            kite_access_token=self._settings.kite_access_token,
        )

        # Lightweight timeframe map so we can decide when a target timeframe
        # can reasonably be aggregated from a finer "base" timeframe. This is
        # intentionally duplicated from BacktestService to avoid import cycles.
        self._timeframe_minutes = {
            "1m": 1,
            "3m": 3,
            "5m": 5,
            "10m": 10,
            "15m": 15,
            "30m": 30,
            "60m": 60,
            "1h": 60,
            "1d": 24 * 60,
        }

    def ensure_symbol_coverage(
        self,
        prices_db: Session,
        *,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
        source: Optional[str],
    ) -> None:
        """Ensure that local OHLCV coverage exists for the given window.

        Parameters
        ----------
        prices_db:
            SQLAlchemy session for the prices database.
        symbol, timeframe:
            Logical instrument identifier and timeframe (e.g. 5m, 1h, 1d).
        start, end:
            Datetime window for the backtest. If start >= end, this is a no-op.
        source:
            Preferred external data source label (kite, yfinance). When the
            source is not recognised or missing, this method does not attempt
            to fetch additional data and simply relies on whatever is already
            stored in the prices DB.
        """

        if start >= end:
            return

        # If the caller did not specify a known external source, we do not
        # attempt to fetch additional data. This keeps tests (which often use
        # synthetic data) and offline environments predictable.
        src = (source or "").lower()
        if src not in {"kite", "yfinance"}:
            return

        # Decide which timeframe we want to fetch for caching. When a base
        # timeframe is configured and is finer than the requested timeframe,
        # we fetch the base timeframe and allow the backtest engine to
        # aggregate it up (e.g. cache 5m bars and use them for 15m/1h/1d
        # backtests). Otherwise we fetch the requested timeframe directly.
        fetch_timeframe = timeframe
        base_tf = (self._settings.base_timeframe or "").lower()
        if base_tf:
            minutes_map = self._timeframe_minutes
            base_minutes = minutes_map.get(base_tf)
            target_minutes = minutes_map.get(timeframe.lower())
            if (
                base_minutes is not None
                and target_minutes is not None
                and base_minutes < target_minutes
                and target_minutes % base_minutes == 0
            ):
                fetch_timeframe = base_tf

        # Check existing coverage for this symbol/fetch_timeframe. If we
        # already cover the requested window, avoid any external calls.
        min_ts, max_ts = (
            prices_db.query(
                func.min(PriceBar.timestamp),
                func.max(PriceBar.timestamp),
            )
            .filter(
                PriceBar.symbol == symbol,
                PriceBar.timeframe == fetch_timeframe,
            )
            .one()
        )

        if min_ts is not None and max_ts is not None:
            # Existing coverage window fully contains the requested window.
            if min_ts <= start and max_ts >= end:
                return

        # Otherwise, fetch the full requested window from the preferred source.
        # DataService handles provider-specific chunking (e.g. Kite's max
        # days per interval) and persists bars into `price_bars` and
        # `price_fetches`.
        self._service.fetch_and_store_bars(
            prices_db,
            symbol=symbol,
            timeframe=fetch_timeframe,
            start=start,
            end=end,
            source=src,
            csv_path=None,
            # For backtests we treat exchange as a logical label; PriceBar
            # queries for backtests do not filter by exchange today.
            exchange="NSE",
        )
