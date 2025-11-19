from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List

from sqlalchemy import delete
from sqlalchemy.orm import Session

from .prices_models import PriceBar


class ProviderUnavailableError(RuntimeError):
    """Raised when a requested data provider cannot be used."""


@dataclass
class OHLCVBar:
    """In-memory representation of a single OHLCV bar."""

    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None
    source: str


def _map_timeframe_to_yf_interval(timeframe: str) -> str:
    """Map internal timeframe tokens to yfinance intervals.

    Supported inputs include: 1m, 3m, 5m, 15m, 30m, 60m, 1h, 1d, 1D.
    """

    tf = timeframe.lower()
    if tf in {"1m", "3m", "5m", "15m", "30m", "60m", "90m", "1h", "1d"}:
        # yfinance accepts these directly (1h is also fine).
        return "60m" if tf == "1h" else tf
    raise ValueError(f"Unsupported yfinance timeframe: {timeframe}")


def _map_timeframe_to_kite_interval(timeframe: str) -> str:
    """Map internal timeframe tokens to Zerodha Kite intervals.

    Supported inputs include: 1m, 3m, 5m, 15m, 30m, 60m, 1h, 1d, 1D.
    """

    tf = timeframe.lower()
    mapping = {
        "1m": "minute",
        "3m": "3minute",
        "5m": "5minute",
        "15m": "15minute",
        "30m": "30minute",
        "60m": "60minute",
        "1h": "60minute",
        "1d": "day",
    }
    if tf in mapping:
        return mapping[tf]
    raise ValueError(f"Unsupported Kite timeframe: {timeframe}")


def _normalise_yf_symbol(symbol: str, exchange: str | None) -> str:
    """Return a yfinance-compatible symbol.

    For plain symbols like HDFCBANK we attach a suffix based on exchange:
    - NSE → .NS
    - BSE → .BO
    If the symbol already contains a '.' or ':' it is passed through unchanged.
    US or other exchanges are passed through as-is.
    """

    if "." in symbol or ":" in symbol:
        return symbol

    ex = (exchange or "").upper()
    if ex == "NSE":
        return f"{symbol}.NS"
    if ex == "BSE":
        return f"{symbol}.BO"
    return symbol


def _from_csv_row(row: dict[str, str], symbol: str, timeframe: str) -> OHLCVBar:
    ts = datetime.fromisoformat(row["timestamp"])
    return OHLCVBar(
        timestamp=ts,
        open=float(row["open"]),
        high=float(row["high"]),
        low=float(row["low"]),
        close=float(row["close"]),
        volume=(
            float(row["volume"])
            if row.get("volume") not in (None, "", "null")
            else None
        ),
        source="local_csv",
    )


def fetch_ohlcv_from_csv(
    csv_path: str,
    symbol: str,
    timeframe: str,
) -> List[OHLCVBar]:
    """Load OHLCV bars from a local CSV file.

    The CSV is expected to contain at least: timestamp, open, high, low, close, volume.
    It is treated as data for a single symbol/timeframe.
    """

    import csv

    bars: List[OHLCVBar] = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            bars.append(_from_csv_row(row, symbol=symbol, timeframe=timeframe))
    return bars


def fetch_ohlcv_from_yfinance(
    symbol: str,
    timeframe: str,
    start: datetime,
    end: datetime,
    exchange: str | None = None,
) -> List[OHLCVBar]:
    """Fetch OHLCV bars from yfinance as a fallback data source."""

    try:
        import yfinance as yf
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise ProviderUnavailableError("yfinance is not installed") from exc

    interval = _map_timeframe_to_yf_interval(timeframe)
    yf_symbol = _normalise_yf_symbol(symbol, exchange=exchange)

    # yfinance has stricter limits for high-resolution data (e.g. 1m). To keep
    # the helper robust we cap the lookback window for intraday intervals.
    if interval in {"1m", "3m", "5m", "15m", "30m", "60m", "90m"}:
        max_lookback = timedelta(days=7)
        if end - start > max_lookback:
            start = end - max_lookback

    df = yf.download(
        yf_symbol,
        start=start,
        end=end,
        interval=interval,
        progress=False,
        auto_adjust=False,
    )

    if df.empty:
        return []

    bars: List[OHLCVBar] = []
    for ts, row in df.iterrows():
        ts_dt = ts.to_pydatetime()

        def _scalar(value: object) -> float | None:
            if value is None:
                return None
            # Pandas may return a 0-dim Series; .item() avoids the deprecation
            # of calling float() on a Series.
            if hasattr(value, "item"):
                try:
                    value = value.item()  # type: ignore[assignment]
                except Exception:
                    pass
            return float(value)

        open_price = _scalar(row["Open"])
        high_price = _scalar(row["High"])
        low_price = _scalar(row["Low"])
        close_price = _scalar(row["Close"])
        volume_val = _scalar(row.get("Volume")) if "Volume" in row else None

        if (
            open_price is None
            or high_price is None
            or low_price is None
            or close_price is None
        ):
            # Skip malformed rows.
            continue

        bars.append(
            OHLCVBar(
                timestamp=ts_dt,
                open=open_price,
                high=high_price,
                low=low_price,
                close=close_price,
                volume=volume_val,
                source="yfinance",
            )
        )
    return bars


def fetch_ohlcv_from_kite(
    symbol: str,
    timeframe: str,
    start: datetime,
    end: datetime,
    api_key: str | None,
    access_token: str | None,
    exchange: str | None = None,
) -> List[OHLCVBar]:
    """Fetch OHLCV bars from Zerodha Kite.

    This is a thin wrapper and assumes that `kiteconnect` is installed and credentials
    are provided. If kiteconnect is unavailable or credentials are missing, a
    ProviderUnavailableError is raised.
    """

    if not api_key or not access_token:
        raise ProviderUnavailableError("Kite credentials are not configured")

    try:
        from kiteconnect import KiteConnect
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise ProviderUnavailableError("kiteconnect is not installed") from exc

    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)

    # Determine instrument token. If the symbol is numeric we interpret it as a
    # token directly; otherwise we treat it as a trading symbol like HDFCBANK
    # on a given exchange (defaulting to NSE) and resolve via quote().
    instrument_token: int
    if symbol.isdigit():
        instrument_token = int(symbol)
    else:
        ex = (exchange or "NSE").upper()
        if ":" in symbol:
            kite_symbol = symbol
        else:
            kite_symbol = f"{ex}:{symbol}"
        quote = kite.quote([kite_symbol])
        if kite_symbol not in quote:
            raise ProviderUnavailableError(
                f"Unable to resolve instrument for {kite_symbol}"
            )
        instrument_token = quote[kite_symbol]["instrument_token"]

    interval = _map_timeframe_to_kite_interval(timeframe)

    records = kite.historical_data(
        instrument_token=instrument_token,
        from_date=start,
        to_date=end,
        interval=interval,
    )

    bars: List[OHLCVBar] = []
    for rec in records:
        bars.append(
            OHLCVBar(
                timestamp=rec["date"],
                open=float(rec["open"]),
                high=float(rec["high"]),
                low=float(rec["low"]),
                close=float(rec["close"]),
                volume=float(rec.get("volume")) if "volume" in rec else None,
                source="kite",
            )
        )
    return bars


class DataService:
    """Data service responsible for persisting OHLCV into the prices DB."""

    def __init__(self, *, kite_api_key: str | None, kite_access_token: str | None):
        self._kite_api_key = kite_api_key
        self._kite_access_token = kite_access_token

    def fetch_and_store_bars(
        self,
        db: Session,
        *,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
        source: str,
        csv_path: str | None = None,
        exchange: str | None = None,
    ) -> int:
        """Fetch OHLCV bars from the chosen provider and persist them.

        Returns the number of bars written.
        """

        source = source.lower()
        ex = (exchange or "NSE").upper()
        if source == "csv":
            if not csv_path:
                raise ValueError("csv_path is required when source=csv")
            bars = fetch_ohlcv_from_csv(csv_path, symbol=symbol, timeframe=timeframe)
        elif source == "yfinance":
            bars = fetch_ohlcv_from_yfinance(
                symbol=symbol,
                timeframe=timeframe,
                start=start,
                end=end,
                exchange=ex,
            )
        elif source == "kite":
            bars = fetch_ohlcv_from_kite(
                symbol=symbol,
                timeframe=timeframe,
                start=start,
                end=end,
                api_key=self._kite_api_key,
                access_token=self._kite_access_token,
                exchange=ex,
            )
        else:
            raise ValueError(f"Unsupported data source: {source}")

        if not bars:
            return 0

        # Remove any existing bars in the requested window to avoid duplicates.
        db.execute(
            delete(PriceBar).where(
                PriceBar.symbol == symbol,
                PriceBar.timeframe == timeframe,
                PriceBar.timestamp >= start,
                PriceBar.timestamp <= end,
            )
        )

        # Persist new bars.
        db.add_all(
            PriceBar(
                symbol=symbol,
                exchange=ex,
                timeframe=timeframe,
                timestamp=bar.timestamp,
                open=bar.open,
                high=bar.high,
                low=bar.low,
                close=bar.close,
                volume=bar.volume,
                source=bar.source,
            )
            for bar in bars
        )

        db.commit()
        return len(bars)
