from __future__ import annotations

import hashlib
import math
import statistics
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, List

import numpy as np
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .prices_models import PriceBar, PriceFetch
from .models import (
    CovarianceMatrix,
    FactorExposure,
    FundamentalsSnapshot,
    BacktestFactorExposure,
    BacktestSectorExposure,
    PortfolioBacktest,
    Portfolio,
    RiskModel,
    Stock,
    StockGroup,
    StockGroupMember,
)


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

    # Zerodha imposes maximum lookback windows per interval. To support
    # arbitrary start/end ranges from the UI we chunk the request into
    # multiple windows where necessary and stitch the results together.
    #
    # See: https://kite.trade/forum/discussion/3081/is-there-any-limitation-on-getting-historical-data
    max_days_by_interval = {
        "minute": 60,
        "3minute": 100,
        "5minute": 100,
        "10minute": 100,
        "15minute": 200,
        "30minute": 200,
        "60minute": 400,
        "day": 2000,
    }
    max_days = max_days_by_interval.get(interval)

    if max_days is None or end <= start:
        windows = [(start, end)]
    else:
        windows: list[tuple[datetime, datetime]] = []
        cursor = start
        window_size = timedelta(days=max_days)
        while cursor < end:
            window_end = min(cursor + window_size, end)
            windows.append((cursor, window_end))
            cursor = window_end

    # Collect records across all windows and de-duplicate by timestamp so we
    # never insert duplicate bars into the prices DB even if Kite returns
    # overlapping data at window boundaries.
    seen: dict[datetime, OHLCVBar] = {}

    for window_start, window_end in windows:
        records = kite.historical_data(
            instrument_token=instrument_token,
            from_date=window_start,
            to_date=window_end,
            interval=interval,
        )
        for rec in records:
            ts = rec["date"]
            bar = OHLCVBar(
                timestamp=ts,
                open=float(rec["open"]),
                high=float(rec["high"]),
                low=float(rec["low"]),
                close=float(rec["close"]),
                volume=float(rec.get("volume")) if "volume" in rec else None,
                source="kite",
            )
            seen[ts] = bar

    bars = sorted(seen.values(), key=lambda b: b.timestamp)
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

        # Derive basic coverage metadata from the fetched bars. We assume all
        # bars share the same source label.
        start_ts = min(bar.timestamp for bar in bars)
        end_ts = max(bar.timestamp for bar in bars)
        coverage_source = bars[0].source

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

        # Record this fetch operation so that coverage summary rows can use a
        # stable, monotonically increasing identifier and sort by recency.
        db.add(
            PriceFetch(
                symbol=symbol,
                exchange=ex,
                timeframe=timeframe,
                source=coverage_source,
                start_timestamp=start_ts,
                end_timestamp=end_ts,
            )
        )

        db.commit()
        return len(bars)


def _compute_percentile(values: List[float], percentile: float) -> float:
    """Return the given percentile of a list of values.

    Simple linear interpolation between closest ranks; assumes values is non-empty.
    """

    if not values:
        raise ValueError("values must be non-empty")
    if len(values) == 1:
        return values[0]
    sorted_vals = sorted(values)
    k = (percentile / 100.0) * (len(sorted_vals) - 1)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    lower = sorted_vals[f]
    upper = sorted_vals[c]
    return float(lower + (upper - lower) * (k - f))


def _winsorise_and_zscore(raw_by_symbol: Dict[str, float]) -> Dict[str, float]:
    """Apply 5–95% winsorisation and cross-sectional z-scoring.

    Stocks with missing raw values are excluded from the input mapping.
    """

    if not raw_by_symbol:
        return {}

    values = list(raw_by_symbol.values())
    if len(values) == 1:
        # Single-name universe: treat exposure as 0.
        only_key = next(iter(raw_by_symbol))
        return {only_key: 0.0}

    p5 = _compute_percentile(values, 5.0)
    p95 = _compute_percentile(values, 95.0)

    winsorised: Dict[str, float] = {}
    for symbol, val in raw_by_symbol.items():
        if val < p5:
            winsorised[symbol] = p5
        elif val > p95:
            winsorised[symbol] = p95
        else:
            winsorised[symbol] = val

    mu = statistics.fmean(winsorised.values())
    # Population std dev; cross-sectional factor z-scores are scale-invariant.
    variance = statistics.fmean((v - mu) ** 2 for v in winsorised.values())
    if variance <= 0.0:
        return {sym: 0.0 for sym in winsorised}

    std = math.sqrt(variance)
    return {sym: (val - mu) / std for sym, val in winsorised.items()}


def _compute_daily_returns(prices: List[float]) -> List[float]:
    """Compute simple daily returns from a series of prices."""

    returns: List[float] = []
    for prev, curr in zip(prices, prices[1:], strict=False):
        if prev <= 0:
            continue
        returns.append((curr - prev) / prev)
    return returns


def _compute_annualised_volatility(returns: List[float]) -> float | None:
    """Compute annualised volatility from daily returns."""

    if len(returns) < 2:
        return None
    mu = statistics.fmean(returns)
    variance = statistics.fmean((r - mu) ** 2 for r in returns)
    if variance < 0.0:
        variance = 0.0
    return math.sqrt(252.0 * variance)


def _impute_missing_with_median(
    raw_by_symbol: Dict[str, float],
    symbols: List[str],
) -> Dict[str, float]:
    """Impute missing raw factor values with cross-sectional median.

    This is used for fundamentals-based factors (Value, Quality, Size) to
    follow the PRD guidance on median imputation for missing fundamentals.
    """

    if not raw_by_symbol:
        return raw_by_symbol

    values = list(raw_by_symbol.values())
    median_val = statistics.median(values)
    for symbol in symbols:
        if symbol not in raw_by_symbol:
            raw_by_symbol[symbol] = float(median_val)
    return raw_by_symbol


class FactorService:
    """Service for computing and persisting cross-sectional factor exposures."""

    def __init__(self, *, lookback_days: int = 273) -> None:
        # Default lookback covers roughly 12 months of daily returns plus
        # one month skip for momentum, in line with the PRD.
        self._lookback_days = lookback_days

    def _load_price_series(
        self,
        prices_db: Session,
        *,
        symbol: str,
        timeframe: str,
        as_of: date,
    ) -> List[float]:
        """Return a list of close prices for the lookback window."""

        end_ts = datetime.combine(as_of, datetime.max.time())
        start_ts = end_ts - timedelta(days=self._lookback_days)

        rows = (
            prices_db.query(PriceBar)
            .filter(
                PriceBar.symbol == symbol,
                PriceBar.timeframe == timeframe,
                PriceBar.timestamp >= start_ts,
                PriceBar.timestamp <= end_ts,
            )
            .order_by(PriceBar.timestamp.asc())
            .all()
        )
        return [float(row.close) for row in rows]

    def compute_and_store_exposures(
        self,
        meta_db: Session,
        prices_db: Session,
        *,
        symbols: List[str],
        as_of_date: date,
        timeframe: str = "1d",
    ) -> Dict[str, FactorExposure]:
        """Compute factor exposures for the given symbols and persist them.

        Returns a mapping from symbol to the persisted FactorExposure row.
        """

        if not symbols:
            return {}

        # Load fundamentals snapshot for the as-of date.
        fundamentals = (
            meta_db.query(FundamentalsSnapshot)
            .filter(
                FundamentalsSnapshot.symbol.in_(symbols),  # type: ignore[arg-type]
                FundamentalsSnapshot.as_of_date == as_of_date,
            )
            .all()
        )
        fundamentals_by_symbol: Dict[str, FundamentalsSnapshot] = {
            row.symbol: row for row in fundamentals
        }

        value_raw: Dict[str, float] = {}
        quality_raw: Dict[str, float] = {}
        size_raw: Dict[str, float] = {}
        momentum_raw: Dict[str, float] = {}
        low_vol_raw: Dict[str, float] = {}

        roe_raw: Dict[str, float] = {}
        roce_raw: Dict[str, float] = {}
        margin_raw: Dict[str, float] = {}
        de_raw: Dict[str, float] = {}

        prices_by_symbol: Dict[str, List[float]] = {}
        returns_by_symbol: Dict[str, List[float]] = {}

        fundamental_symbols: List[str] = []

        for symbol in symbols:
            f = fundamentals_by_symbol.get(symbol)
            if f is not None:
                fundamental_symbols.append(symbol)
                # VALUE: multi-signal composite using 1/PE, 1/PB, 1/PS.
                value_components: List[float] = []
                if f.pe is not None and f.pe > 0:
                    value_components.append(1.0 / float(f.pe))
                if f.pb is not None and f.pb > 0:
                    value_components.append(1.0 / float(f.pb))
                if f.ps is not None and f.ps > 0:
                    value_components.append(1.0 / float(f.ps))
                if value_components:
                    # Mean vs sum is a scale factor; z-scoring removes it.
                    value_raw[symbol] = statistics.fmean(value_components)

                # QUALITY components captured separately and z-scored before
                # aggregation.
                if f.roe is not None:
                    roe_raw[symbol] = float(f.roe)
                if f.roce is not None:
                    roce_raw[symbol] = float(f.roce)
                # Margin signal: combine operating and net margin when present.
                margin_components: List[float] = []
                if f.operating_margin is not None:
                    margin_components.append(float(f.operating_margin))
                if f.net_margin is not None:
                    margin_components.append(float(f.net_margin))
                if margin_components:
                    margin_raw[symbol] = statistics.fmean(margin_components)
                if f.debt_to_equity is not None:
                    de_raw[symbol] = float(f.debt_to_equity)

                # SIZE: negative log of market cap.
                if f.market_cap is not None and f.market_cap > 0.0:
                    size_raw[symbol] = -math.log(float(f.market_cap))

            prices = self._load_price_series(
                prices_db,
                symbol=symbol,
                timeframe=timeframe,
                as_of=as_of_date,
            )
            if len(prices) >= 2:
                prices_by_symbol[symbol] = prices
                rets = _compute_daily_returns(prices)
                if rets:
                    returns_by_symbol[symbol] = rets
                    # MOMENTUM: 12m momentum skipping the most recent month
                    # when enough data is available; otherwise fall back to
                    # total return over the available window.
                    if len(rets) >= 252 + 21:
                        window = rets[-(252 + 21) :]
                        core = window[:-21]
                    else:
                        core = rets
                    if core:
                        total_return = 1.0
                        for r in core:
                            total_return *= 1.0 + r
                        momentum_raw[symbol] = total_return - 1.0

                    # LOW-VOL: annualised volatility over a 180-day window
                    # (or the available history if shorter).
                    lv_rets = rets[-180:] if len(rets) > 1 else []
                    vol = _compute_annualised_volatility(lv_rets)
                    if vol is not None:
                        low_vol_raw[symbol] = -vol

        # QUALITY: z-score each component, then form a composite and z-score
        # cross-sectionally again.
        roe_z = _winsorise_and_zscore(roe_raw)
        roce_z = _winsorise_and_zscore(roce_raw)
        margin_z = _winsorise_and_zscore(margin_raw)
        de_z = _winsorise_and_zscore(de_raw)

        for symbol in symbols:
            components: List[float] = []
            if symbol in roe_z:
                components.append(roe_z[symbol])
            if symbol in roce_z:
                components.append(roce_z[symbol])
            if symbol in margin_z:
                components.append(margin_z[symbol])
            if symbol in de_z:
                components.append(-de_z[symbol])
            if components:
                quality_raw[symbol] = statistics.fmean(components)

        # Median imputation for fundamentals-based factors.
        value_raw = _impute_missing_with_median(value_raw, fundamental_symbols)
        quality_raw = _impute_missing_with_median(quality_raw, fundamental_symbols)
        size_raw = _impute_missing_with_median(size_raw, fundamental_symbols)

        value_z = _winsorise_and_zscore(value_raw)
        quality_z = _winsorise_and_zscore(quality_raw)
        momentum_z = _winsorise_and_zscore(momentum_raw)
        low_vol_z = _winsorise_and_zscore(low_vol_raw)
        size_z = _winsorise_and_zscore(size_raw)

        exposures_by_symbol: Dict[str, FactorExposure] = {}

        # Idempotency: clear any existing rows for this date and symbol set.
        meta_db.query(FactorExposure).filter(
            FactorExposure.symbol.in_(symbols),  # type: ignore[arg-type]
            FactorExposure.as_of_date == as_of_date,
        ).delete(synchronize_session=False)

        for symbol in symbols:
            has_any = any(
                symbol in mapping
                for mapping in (value_z, quality_z, momentum_z, low_vol_z, size_z)
            )
            if not has_any:
                continue

            v = value_z.get(symbol)
            q = quality_z.get(symbol)
            m = momentum_z.get(symbol)
            lv = low_vol_z.get(symbol)
            s = size_z.get(symbol)

            components = [c for c in (v, q, m, lv, s) if c is not None]
            composite = float(statistics.fmean(components)) if components else None

            row = FactorExposure(
                symbol=symbol,
                as_of_date=as_of_date,
                value=v,
                quality=q,
                momentum=m,
                low_vol=lv,
                size=s,
                composite_score=composite,
            )
            meta_db.add(row)
            exposures_by_symbol[symbol] = row

        meta_db.commit()
        for row in exposures_by_symbol.values():
            meta_db.refresh(row)
        return exposures_by_symbol


class RiskModelService:
    """Service for computing and persisting risk model quantities."""

    def __init__(self, *, lookback_days: int = 180) -> None:
        self._lookback_days = lookback_days

    @staticmethod
    def _universe_hash(symbols: List[str]) -> str:
        """Deterministic hash for a symbol universe."""

        joined = ",".join(symbols)
        return hashlib.sha256(joined.encode("utf-8")).hexdigest()

    def _load_returns_matrix(
        self,
        prices_db: Session,
        *,
        symbols: List[str],
        timeframe: str,
        as_of: date,
    ) -> Dict[str, List[float]]:
        """Load daily returns for each symbol in the lookback window."""

        end_ts = datetime.combine(as_of, datetime.max.time())
        start_ts = end_ts - timedelta(days=self._lookback_days)

        returns_by_symbol: Dict[str, List[float]] = {}
        for symbol in symbols:
            rows = (
                prices_db.query(PriceBar)
                .filter(
                    PriceBar.symbol == symbol,
                    PriceBar.timeframe == timeframe,
                    PriceBar.timestamp >= start_ts,
                    PriceBar.timestamp <= end_ts,
                )
                .order_by(PriceBar.timestamp.asc())
                .all()
            )
            prices = [float(row.close) for row in rows]
            if len(prices) >= 2:
                rets = _compute_daily_returns(prices)
                if rets:
                    returns_by_symbol[symbol] = rets
        return returns_by_symbol

    def _compute_sample_covariance(
        self,
        returns_by_symbol: Dict[str, List[float]],
        symbols: List[str],
    ) -> List[List[float]]:
        """Compute a sample covariance matrix."""

        n = len(symbols)
        if n == 0:
            return []

        # Align to the minimum available length across symbols.
        min_len = min(len(returns_by_symbol[s]) for s in symbols)
        if min_len < 2:
            return [[0.0 for _ in range(n)] for _ in range(n)]

        centred: Dict[str, List[float]] = {}
        for s in symbols:
            series = returns_by_symbol[s][:min_len]
            mu = statistics.fmean(series)
            centred[s] = [r - mu for r in series]

        cov: List[List[float]] = [[0.0 for _ in range(n)] for _ in range(n)]
        denom = float(min_len - 1)
        for i, si in enumerate(symbols):
            for j, sj in enumerate(symbols):
                if j < i:
                    cov[i][j] = cov[j][i]
                    continue
                prod_sum = sum(
                    a * b for a, b in zip(centred[si], centred[sj], strict=False)
                )
                cov_ij = prod_sum / denom
                cov[i][j] = cov_ij
                cov[j][i] = cov_ij
        return cov

    def _estimate_ledoit_wolf_delta(
        self,
        returns_by_symbol: Dict[str, List[float]],
        symbols: List[str],
    ) -> float:
        """Estimate Ledoit–Wolf shrinkage intensity delta for diagonal target.

        Implementation follows the intuition from Ledoit & Wolf (2004):
        delta = pi_hat / gamma_hat, clipped to [0, 1], where
        - pi_hat estimates the expected Frobenius norm of sampling noise,
        - gamma_hat is the squared distance between sample covariance and
          the diagonal shrinkage target.
        """

        n = len(symbols)
        if n == 0:
            return 0.0

        lengths = [len(returns_by_symbol[s]) for s in symbols]
        if not lengths:
            return 0.0
        t = min(lengths)
        if t < 2:
            return 0.0

        # Build zero-mean return matrix X (T x N).
        series_by_symbol = [returns_by_symbol[s][:t] for s in symbols]
        means = [statistics.fmean(series) for series in series_by_symbol]

        x: List[List[float]] = [
            [series_by_symbol[j][i] - means[j] for j in range(n)] for i in range(t)
        ]

        # Sample covariance matrix S using the same convention as
        # _compute_sample_covariance (denominator T-1).
        denom = float(t - 1)
        s_mat: List[List[float]] = [[0.0 for _ in range(n)] for _ in range(n)]
        for i in range(n):
            for j in range(i, n):
                prod_sum = 0.0
                for k in range(t):
                    prod_sum += x[k][i] * x[k][j]
                cov_ij = prod_sum / denom
                s_mat[i][j] = cov_ij
                s_mat[j][i] = cov_ij

        # Target: diagonal matrix with variances on the diagonal.
        diag_vars = [s_mat[i][i] for i in range(n)]

        gamma_hat = 0.0
        for i in range(n):
            for j in range(n):
                target = diag_vars[i] if i == j else 0.0
                diff = s_mat[i][j] - target
                gamma_hat += diff * diff

        if gamma_hat <= 0.0:
            return 0.0

        # pi_hat: average squared deviation of instantaneous covariance
        # x_t x_t^T from the sample covariance S.
        pi_hat = 0.0
        for k in range(t):
            for i in range(n):
                xi = x[k][i]
                for j in range(n):
                    xj = x[k][j]
                    a = xi * xj
                    diff = a - s_mat[i][j]
                    pi_hat += diff * diff
        pi_hat /= float(t)

        delta = pi_hat / gamma_hat
        if delta < 0.0:
            delta = 0.0
        if delta > 1.0:
            delta = 1.0
        return delta

    def _apply_ledoit_wolf_shrinkage(
        self,
        cov: List[List[float]],
        shrinkage: float,
    ) -> List[List[float]]:
        """Apply Ledoit–Wolf-style shrinkage towards a diagonal matrix."""

        n = len(cov)
        if n == 0:
            return []

        diag_vars = [cov[i][i] for i in range(n)]
        shrunk: List[List[float]] = [[0.0 for _ in range(n)] for _ in range(n)]
        for i in range(n):
            for j in range(n):
                target = diag_vars[i] if i == j else 0.0
                shrunk[i][j] = shrinkage * target + (1.0 - shrinkage) * cov[i][j]
        return shrunk

    def compute_and_store_risk(
        self,
        meta_db: Session,
        prices_db: Session,
        *,
        symbols: List[str],
        as_of_date: date,
        timeframe: str = "1d",
        benchmark_symbol: str | None = None,
    ) -> Dict[str, RiskModel]:
        """Compute risk metrics and covariance matrix for the given universe."""

        if not symbols:
            return {}

        returns_by_symbol = self._load_returns_matrix(
            prices_db,
            symbols=symbols,
            timeframe=timeframe,
            as_of=as_of_date,
        )
        usable_symbols = [s for s in symbols if s in returns_by_symbol]
        if not usable_symbols:
            return {}

        vols: Dict[str, float] = {}
        for s in usable_symbols:
            vol = _compute_annualised_volatility(returns_by_symbol[s])
            if vol is not None:
                vols[s] = vol

        benchmark_returns: List[float] | None = None
        # Default to the first usable symbol when a benchmark is not provided.
        bench_sym = benchmark_symbol
        if bench_sym is None and usable_symbols:
            bench_sym = usable_symbols[0]
        if bench_sym is not None and bench_sym in returns_by_symbol:
            benchmark_returns = returns_by_symbol[bench_sym]

        risk_rows: Dict[str, RiskModel] = {}

        # Idempotency: clear previous rows for this date and symbol set.
        meta_db.query(RiskModel).filter(
            RiskModel.symbol.in_(usable_symbols),  # type: ignore[arg-type]
            RiskModel.as_of_date == as_of_date,
        ).delete(synchronize_session=False)

        for s in usable_symbols:
            rets = returns_by_symbol[s]
            vol = vols.get(s)
            beta = None
            if benchmark_returns is not None:
                length = min(len(rets), len(benchmark_returns))
                if length >= 2:
                    r_i = rets[:length]
                    r_m = benchmark_returns[:length]
                    mu_i = statistics.fmean(r_i)
                    mu_m = statistics.fmean(r_m)
                    cov_im = statistics.fmean(
                        (ri - mu_i) * (rm - mu_m)
                        for ri, rm in zip(r_i, r_m, strict=False)
                    )
                    var_m = statistics.fmean((rm - mu_m) ** 2 for rm in r_m)
                    if var_m > 0:
                        beta = cov_im / var_m

            row = RiskModel(
                symbol=s,
                as_of_date=as_of_date,
                volatility=vol,
                beta=beta,
                tail_beta=None,
                skew=None,
                kurtosis=None,
            )
            meta_db.add(row)
            risk_rows[s] = row

        # Covariance and correlation matrix for the universe.
        ordered_symbols = usable_symbols
        cov = self._compute_sample_covariance(returns_by_symbol, ordered_symbols)
        vol_list = [vols.get(s, 0.0) for s in ordered_symbols]
        delta = self._estimate_ledoit_wolf_delta(returns_by_symbol, ordered_symbols)
        cov_shrunk = self._apply_ledoit_wolf_shrinkage(cov, shrinkage=delta)

        corr: List[List[float]] = [
            [0.0 for _ in ordered_symbols] for _ in ordered_symbols
        ]
        # Correlation uses daily vol; RiskModel.volatility stores annualised
        # vol, so we divide by sqrt(252) to convert.
        daily_vols = [v / math.sqrt(252.0) if v > 0.0 else 0.0 for v in vol_list]
        for i, vi in enumerate(daily_vols):
            for j, vj in enumerate(daily_vols):
                if vi > 0.0 and vj > 0.0:
                    corr[i][j] = cov_shrunk[i][j] / (vi * vj)
                else:
                    corr[i][j] = 0.0 if i != j else 1.0

        universe_hash = self._universe_hash(ordered_symbols)

        # Idempotency for covariance matrices.
        meta_db.query(CovarianceMatrix).filter(
            CovarianceMatrix.as_of_date == as_of_date,
            CovarianceMatrix.universe_hash == universe_hash,
        ).delete(synchronize_session=False)

        matrix_blob = {
            "symbols": ordered_symbols,
            "cov_matrix": cov_shrunk,
            "corr_matrix": corr,
        }
        cov_row = CovarianceMatrix(
            as_of_date=as_of_date,
            universe_hash=universe_hash,
            matrix_blob=matrix_blob,
        )
        meta_db.add(cov_row)

        meta_db.commit()
        for row in risk_rows.values():
            meta_db.refresh(row)
        meta_db.refresh(cov_row)
        return risk_rows


class FactorRiskRebuildService:
    """Orchestration helper to recompute factors and risk for a universe/date."""

    def __init__(
        self,
        *,
        factor_service: FactorService | None = None,
        risk_service: RiskModelService | None = None,
    ) -> None:
        self._factor_service = factor_service or FactorService()
        self._risk_service = risk_service or RiskModelService()

    def _resolve_universe_symbols(self, meta_db: Session, universe: str) -> List[str]:
        universe_norm = (universe or "").strip()
        if not universe_norm or universe_norm.upper() == "NSE_ALL":
            rows = (
                meta_db.query(Stock)
                .filter(Stock.is_active.is_(True))
                .order_by(Stock.symbol.asc())
                .all()
            )
            return [row.symbol for row in rows]

        if universe_norm.startswith("group:"):
            _, group_id_str = universe_norm.split(":", 1)
            try:
                group_id = int(group_id_str)
            except ValueError as exc:  # pragma: no cover - validated via API
                msg = f"Invalid group id in universe: {universe_norm}"
                raise ValueError(msg) from exc
            rows = (
                meta_db.query(Stock)
                .join(StockGroupMember, StockGroupMember.stock_id == Stock.id)
                .filter(StockGroupMember.group_id == group_id)
                .order_by(Stock.symbol.asc())
                .all()
            )
            return [row.symbol for row in rows]

        # Fallback: treat as a comma-separated list of symbols.
        symbols = [s.strip().upper() for s in universe_norm.split(",") if s.strip()]
        if not symbols:
            msg = f"Unsupported universe format: {universe}"
            raise ValueError(msg)
        return symbols

    def rebuild_for_universe(
        self,
        meta_db: Session,
        prices_db: Session,
        *,
        universe: str,
        as_of_date: date,
        timeframe: str = "1d",
    ) -> dict:
        """Compute factors and risk for the given universe and date."""

        symbols = self._resolve_universe_symbols(meta_db, universe)
        if not symbols:
            msg = "Universe resolved to an empty symbol list"
            raise ValueError(msg)

        exposures = self._factor_service.compute_and_store_exposures(
            meta_db=meta_db,
            prices_db=prices_db,
            symbols=symbols,
            as_of_date=as_of_date,
            timeframe=timeframe,
        )
        risk_rows = self._risk_service.compute_and_store_risk(
            meta_db=meta_db,
            prices_db=prices_db,
            symbols=symbols,
            as_of_date=as_of_date,
            timeframe=timeframe,
        )

        returns_by_symbol = self._risk_service._load_returns_matrix(  # type: ignore[attr-defined]
            prices_db,
            symbols=symbols,
            timeframe=timeframe,
            as_of=as_of_date,
        )
        symbols_with_prices = sorted(returns_by_symbol.keys())
        symbols_without_prices = sorted(
            s for s in symbols if s not in returns_by_symbol
        )

        return {
            "universe": universe,
            "as_of_date": as_of_date.isoformat(),
            "timeframe": timeframe,
            "symbols_requested": len(symbols),
            "symbols_with_prices": len(symbols_with_prices),
            "symbols_without_prices": symbols_without_prices,
            "factor_rows_written": len(exposures),
            "risk_rows_written": len(risk_rows),
        }


class ScreenerService:
    """Service responsible for applying screener filters and rankings."""

    def _load_universe_symbols(
        self,
        db: Session,
        *,
        universe: str,
    ) -> List[Stock]:
        """Return stocks for the requested universe.

        For S16 we support a single universe identifier:
        - 'NSE_ALL' → all active stocks.
        """

        universe_norm = universe.strip().upper()
        if universe_norm == "NSE_ALL":
            return (
                db.query(Stock)
                .filter(Stock.is_active.is_(True))
                .order_by(Stock.symbol.asc())
                .all()
            )
        # Fallback: treat as NSE_ALL for now.
        return (
            db.query(Stock)
            .filter(Stock.is_active.is_(True))
            .order_by(Stock.symbol.asc())
            .all()
        )

    @staticmethod
    def _resolve_field_value(
        *,
        field: str,
        stock: Stock,
        fundamentals: FundamentalsSnapshot | None,
        factors: FactorExposure | None,
    ) -> float | None:
        """Return the numeric value for a given screener field."""

        key = field.strip().lower()
        # Fundamental fields.
        if fundamentals is not None:
            if key == "pe":
                return float(fundamentals.pe) if fundamentals.pe is not None else None
            if key == "pb":
                return float(fundamentals.pb) if fundamentals.pb is not None else None
            if key in {"ps", "price_to_sales"}:
                return float(fundamentals.ps) if fundamentals.ps is not None else None
            if key == "roe":
                return float(fundamentals.roe) if fundamentals.roe is not None else None
            if key == "roce":
                return (
                    float(fundamentals.roce) if fundamentals.roce is not None else None
                )
            if key in {"debt_to_equity", "d/e"}:
                return (
                    float(fundamentals.debt_to_equity)
                    if fundamentals.debt_to_equity is not None
                    else None
                )
            if key in {"sales_growth_yoy", "sales_growth"}:
                return (
                    float(fundamentals.sales_growth_yoy)
                    if fundamentals.sales_growth_yoy is not None
                    else None
                )
            if key in {"profit_growth_yoy", "profit_growth"}:
                return (
                    float(fundamentals.profit_growth_yoy)
                    if fundamentals.profit_growth_yoy is not None
                    else None
                )
            if key in {"eps_growth_3y", "eps_growth"}:
                return (
                    float(fundamentals.eps_growth_3y)
                    if fundamentals.eps_growth_3y is not None
                    else None
                )
        # Factor fields.
        if factors is not None:
            if key in {"value", "v"}:
                return float(factors.value) if factors.value is not None else None
            if key in {"quality", "q"}:
                return float(factors.quality) if factors.quality is not None else None
            if key in {"momentum", "m"}:
                return float(factors.momentum) if factors.momentum is not None else None
            if key in {"low_vol", "lv", "lowvol"}:
                return float(factors.low_vol) if factors.low_vol is not None else None
            if key in {"size", "s"}:
                return float(factors.size) if factors.size is not None else None
            if key in {"composite", "composite_score"}:
                return (
                    float(factors.composite_score)
                    if factors.composite_score is not None
                    else None
                )
        # Stock-level fields.
        if key in {"market_cap", "market_cap_crore"}:
            return (
                float(stock.market_cap_crore)
                if stock.market_cap_crore is not None
                else None
            )
        return None

    @staticmethod
    def _compare(op: str, lhs: float | None, rhs: float) -> bool:
        """Evaluate lhs <op> rhs with None treated as not passing."""

        if lhs is None:
            return False
        if op in {"<", "lt"}:
            return lhs < rhs
        if op in {"<=", "le"}:
            return lhs <= rhs
        if op in {">", "gt"}:
            return lhs > rhs
        if op in {">=", "ge"}:
            return lhs >= rhs
        if op in {"=", "=="}:
            return lhs == rhs
        return False

    def run_screener(
        self,
        meta_db: Session,
        *,
        universe: str,
        as_of_date: date,
        filters: List[dict],
        ranking: dict | None = None,
    ) -> List[dict]:
        """Execute screener filters and ranking.

        Returns a list of plain dicts with symbol, sector, market_cap and
        factor exposures.
        """

        stocks = self._load_universe_symbols(meta_db, universe=universe)
        if not stocks:
            return []

        symbols = [s.symbol for s in stocks]

        fundamentals_rows = (
            meta_db.query(FundamentalsSnapshot)
            .filter(
                FundamentalsSnapshot.symbol.in_(symbols),  # type: ignore[arg-type]
                FundamentalsSnapshot.as_of_date == as_of_date,
            )
            .all()
        )
        fundamentals_by_symbol: Dict[str, FundamentalsSnapshot] = {
            row.symbol: row for row in fundamentals_rows
        }

        factors_rows = (
            meta_db.query(FactorExposure)
            .filter(
                FactorExposure.symbol.in_(symbols),  # type: ignore[arg-type]
                FactorExposure.as_of_date == as_of_date,
            )
            .all()
        )
        factors_by_symbol: Dict[str, FactorExposure] = {
            row.symbol: row for row in factors_rows
        }

        results: List[dict] = []
        for stock in stocks:
            fundamentals = fundamentals_by_symbol.get(stock.symbol)
            factors = factors_by_symbol.get(stock.symbol)

            passed = True
            for cond in filters:
                field = cond.get("field", "")
                op = str(cond.get("op", "")).strip()
                value = float(cond.get("value"))
                lhs = self._resolve_field_value(
                    field=field,
                    stock=stock,
                    fundamentals=fundamentals,
                    factors=factors,
                )
                if not self._compare(op, lhs, value):
                    passed = False
                    break
            if not passed:
                continue

            results.append(
                {
                    "symbol": stock.symbol,
                    "sector": stock.sector,
                    "market_cap": (
                        float(stock.market_cap_crore)
                        if stock.market_cap_crore is not None
                        else None
                    ),
                    "value": getattr(factors, "value", None) if factors else None,
                    "quality": getattr(factors, "quality", None) if factors else None,
                    "momentum": getattr(factors, "momentum", None) if factors else None,
                    "low_vol": getattr(factors, "low_vol", None) if factors else None,
                    "size": getattr(factors, "size", None) if factors else None,
                }
            )

        if not results or ranking is None:
            return results

        def _ranking_key(item: dict, field: str, order: str) -> float:
            raw = item.get(field)
            if raw is None:
                # Push missing values to the end.
                return float("-inf") if order == "asc" else float("inf")
            return float(raw)

        primary_conf = ranking.get("primary")
        secondary_conf = ranking.get("secondary") or {}

        if primary_conf:
            p_field = str(primary_conf.get("field", "")).strip()
            p_order = str(primary_conf.get("order", "desc")).strip().lower()
            s_field = str(secondary_conf.get("field", "")).strip()
            s_order = str(secondary_conf.get("order", p_order)).strip().lower()

            reverse_primary = p_order == "desc"

            results.sort(
                key=lambda item: (
                    _ranking_key(item, p_field, p_order),
                    _ranking_key(item, s_field, s_order) if s_field else 0.0,
                ),
                reverse=reverse_primary,
            )

        limit = ranking.get("limit")
        if isinstance(limit, int) and limit > 0:
            results = results[:limit]
        return results


class AnalyticsService:
    """Analytics helpers for factor and sector exposures over time."""

    def get_factor_exposures(
        self,
        meta_db: Session,
        *,
        backtest_id: int,
    ) -> List[dict]:
        """Return factor exposure time series for a portfolio backtest."""

        rows = (
            meta_db.query(BacktestFactorExposure)
            .filter(BacktestFactorExposure.backtest_id == backtest_id)
            .order_by(BacktestFactorExposure.date.asc())
            .all()
        )
        series: List[dict] = []
        for row in rows:
            series.append(
                {
                    "date": row.date,
                    "value": row.value,
                    "quality": row.quality,
                    "momentum": row.momentum,
                    "low_vol": row.low_vol,
                    "size": row.size,
                }
            )
        return series

    def get_sector_exposures(
        self,
        meta_db: Session,
        *,
        backtest_id: int,
    ) -> List[dict]:
        """Return sector allocation time series for a portfolio backtest."""

        rows = (
            meta_db.query(BacktestSectorExposure)
            .filter(BacktestSectorExposure.backtest_id == backtest_id)
            .order_by(
                BacktestSectorExposure.date.asc(),
                BacktestSectorExposure.sector.asc(),
            )
            .all()
        )
        result: Dict[tuple, float] = {}
        for row in rows:
            key = (row.date, row.sector)
            result[key] = float(row.weight)

        series: List[dict] = []
        for (dt, sector), weight in sorted(result.items()):
            series.append({"date": dt, "sector": sector, "weight": weight})
        return series

    def summarize_backtest(
        self,
        meta_db: Session,
        *,
        backtest_id: int,
    ) -> dict:
        """Return a lightweight analytics summary for a portfolio backtest."""

        bt = meta_db.get(PortfolioBacktest, backtest_id)
        if bt is None:
            return {}

        metrics = bt.metrics_json or {}
        summary = {
            "volatility": float(metrics.get("volatility", 0.0)),
            "sharpe": float(
                metrics.get("sharpe") or metrics.get("sharpe_ratio") or 0.0
            ),
            "beta": float(metrics.get("beta", 0.0)),
            "cvar_95": float(metrics.get("cvar_95", 0.0)),
        }

        factor_rows = self.get_factor_exposures(meta_db, backtest_id=backtest_id)
        if factor_rows:
            latest = factor_rows[-1]
            summary["factor_tilt"] = {
                "value": latest.get("value"),
                "quality": latest.get("quality"),
                "momentum": latest.get("momentum"),
                "low_vol": latest.get("low_vol"),
                "size": latest.get("size"),
            }

        sector_rows = self.get_sector_exposures(meta_db, backtest_id=backtest_id)
        if sector_rows:
            latest_date = sector_rows[-1]["date"]
            sector_alloc: Dict[str, float] = {}
            for row in sector_rows:
                if row["date"] != latest_date:
                    continue
                sector_alloc[row["sector"]] = sector_alloc.get(
                    row["sector"],
                    0.0,
                ) + float(row["weight"])
            summary["sector_allocation"] = sector_alloc

        return summary


class OptimizerService:
    """Portfolio optimisation service built on factor and risk models."""

    def __init__(
        self,
        *,
        factor_service: FactorService | None = None,
        risk_service: RiskModelService | None = None,
    ) -> None:
        self._factor_service = factor_service or FactorService()
        self._risk_service = risk_service or RiskModelService()

    def _resolve_universe_symbols(
        self,
        meta_db: Session,
        portfolio: Portfolio,
    ) -> List[str]:
        """Resolve portfolio.universe_scope into a list of symbols.

        Currently supports universe_scope strings of the form 'group:<id>'.
        """

        scope = portfolio.universe_scope or ""
        if scope.startswith("group:"):
            _, group_id_str = scope.split(":", 1)
            try:
                group_id = int(group_id_str)
            except ValueError:
                msg = f"Invalid universe_scope for portfolio: {scope}"
                raise ValueError(msg) from None
            group = meta_db.get(StockGroup, group_id)
            if group is None:
                msg = f"StockGroup {group_id} referenced by portfolio not found"
                raise ValueError(msg)
            rows = (
                meta_db.query(Stock)
                .join(StockGroupMember, StockGroupMember.stock_id == Stock.id)
                .filter(StockGroupMember.group_id == group_id)
                .order_by(Stock.symbol.asc())
                .all()
            )
            return [row.symbol for row in rows]

        msg = (
            "Portfolio.universe_scope must currently be of the form 'group:<id>'. "
            f"Got '{scope}'."
        )
        raise ValueError(msg)

    @staticmethod
    def _equal_weight(n: int) -> np.ndarray:
        if n <= 0:
            return np.array([], dtype=float)
        w = np.full(n, 1.0 / float(n), dtype=float)
        return w

    @staticmethod
    def _clamp_and_normalise(
        weights: np.ndarray,
        *,
        min_weight: float | None,
        max_weight: float | None,
    ) -> np.ndarray:
        if weights.size == 0:
            return weights
        w = weights.copy()
        if min_weight is not None:
            w = np.maximum(w, float(min_weight))
        if max_weight is not None:
            w = np.minimum(w, float(max_weight))
        total = float(w.sum())
        if total <= 0.0:
            return OptimizerService._equal_weight(len(w))
        return w / total

    @staticmethod
    def _min_variance_weights(cov: np.ndarray) -> np.ndarray:
        """Compute unconstrained minimum-variance weights."""

        n = cov.shape[0]
        if n == 0:
            return np.array([], dtype=float)
        jitter = 1e-8
        cov_jittered = cov + np.eye(n) * jitter
        inv = np.linalg.pinv(cov_jittered)
        ones = np.ones(n)
        num = inv @ ones
        denom = float(ones.T @ inv @ ones)
        if denom <= 0.0:
            return OptimizerService._equal_weight(n)
        w = num / denom
        if not np.isfinite(w).all():
            return OptimizerService._equal_weight(n)
        return w

    @staticmethod
    def _max_sharpe_weights(cov: np.ndarray, mu: np.ndarray) -> np.ndarray:
        """Compute approximate long-only maximum Sharpe weights."""

        n = cov.shape[0]
        if n == 0:
            return np.array([], dtype=float)
        jitter = 1e-8
        cov_jittered = cov + np.eye(n) * jitter
        inv = np.linalg.pinv(cov_jittered)
        w = inv @ mu
        if not np.isfinite(w).all():
            return OptimizerService._equal_weight(n)
        # Enforce long-only by clipping negatives and renormalising.
        w = np.maximum(w, 0.0)
        total = float(w.sum())
        if total <= 0.0:
            return OptimizerService._equal_weight(n)
        return w / total

    def optimise_portfolio(
        self,
        meta_db: Session,
        prices_db: Session,
        *,
        portfolio_id: int,
        as_of_date: date,
        optimizer_type: str,
        constraints: dict | None = None,
        previous_weights: list[dict] | None = None,
    ) -> tuple[list[dict], dict[str, float], dict[str, float], dict[str, object]]:
        """Optimise weights for a portfolio universe.

        Returns (weights, risk_metrics, factor_exposures, diagnostics).
        """

        portfolio = meta_db.get(Portfolio, portfolio_id)
        if portfolio is None:
            msg = f"Portfolio {portfolio_id} not found"
            raise ValueError(msg)

        symbols = self._resolve_universe_symbols(meta_db, portfolio)
        if not symbols:
            msg = "Portfolio universe resolved to an empty symbol list"
            raise ValueError(msg)

        # Compute factor exposures for the full universe; some names may be
        # dropped later if insufficient price history is available.
        exposures_by_symbol = self._factor_service.compute_and_store_exposures(
            meta_db=meta_db,
            prices_db=prices_db,
            symbols=symbols,
            as_of_date=as_of_date,
            timeframe="1d",
        )

        # Load returns up-front so we can identify symbols with usable history.
        returns_by_symbol = self._risk_service._load_returns_matrix(  # type: ignore[attr-defined]
            prices_db,
            symbols=symbols,
            timeframe="1d",
            as_of=as_of_date,
        )
        symbols_with_prices = [s for s in symbols if s in returns_by_symbol]
        if not symbols_with_prices:
            # Fall back to equal-weight with zero risk metrics when no
            # historical data is available for any universe member.
            weights_arr = self._equal_weight(len(symbols))
            risk_metrics = {
                "volatility": 0.0,
                "expected_return": 0.0,
                "sharpe": 0.0,
                "beta": 0.0,
                "risk_free_rate": 0.0,
            }
            diagnostics: Dict[str, object] = {
                "optimizer_type": optimizer_type,
                "universe_size": len(symbols),
                "note": "Fell back to equal-weight: no price history for optimisation.",
            }
            stocks = (
                meta_db.query(Stock)
                .filter(Stock.symbol.in_(symbols))  # type: ignore[arg-type]
                .all()
            )
            sector_by_symbol = {s.symbol: s.sector for s in stocks}
            weight_dicts: list[dict] = []
            for i, sym in enumerate(symbols):
                weight_dicts.append(
                    {
                        "symbol": sym,
                        "weight": float(weights_arr[i]),
                        "sector": sector_by_symbol.get(sym),
                    }
                )

            agg_exposures: Dict[str, float] = {}
            factor_names = ["value", "quality", "momentum", "low_vol", "size"]
            for name in factor_names:
                total = 0.0
                for i, sym in enumerate(symbols):
                    exposure = exposures_by_symbol.get(sym)
                    if exposure is None:
                        continue
                    val = getattr(exposure, name, None)
                    if val is None:
                        continue
                    total += float(weights_arr[i]) * float(val)
                agg_exposures[name] = total

            return weight_dicts, risk_metrics, agg_exposures, diagnostics

        # Restrict optimiser universe to symbols with sufficient price history.
        symbols_for_opt = symbols_with_prices

        # Compute or load risk model and covariance matrix for the usable subset.
        self._risk_service.compute_and_store_risk(
            meta_db=meta_db,
            prices_db=prices_db,
            symbols=symbols_for_opt,
            as_of_date=as_of_date,
            timeframe="1d",
        )

        universe_hash = self._risk_service._universe_hash(symbols_for_opt)
        cov_row = (
            meta_db.query(CovarianceMatrix)
            .filter(
                CovarianceMatrix.as_of_date == as_of_date,
                CovarianceMatrix.universe_hash == universe_hash,
            )
            .one_or_none()
        )
        if cov_row is None or not cov_row.matrix_blob:
            msg = "Covariance matrix not available for optimisation universe"
            raise ValueError(msg)
        blob = cov_row.matrix_blob
        cov_matrix = blob.get("cov_matrix")
        if cov_matrix is None:
            msg = "Covariance matrix blob missing 'cov_matrix'"
            raise ValueError(msg)

        cov = np.array(cov_matrix, dtype=float)
        n = cov.shape[0]
        if n != len(symbols_for_opt):
            msg = "Covariance matrix dimension mismatch with optimisation subset"
            raise ValueError(msg)

        # Expected returns: simple annualised mean return estimate from
        # historical daily returns, restricted to the symbols actually
        # included in the covariance universe.
        mu_vec: list[float] = []
        vol_vec: list[float] = []
        for sym in symbols_for_opt:
            rets = returns_by_symbol.get(sym, [])
            if rets:
                mu_daily = statistics.fmean(rets)
                mu_vec.append(mu_daily * 252.0)
                vol = _compute_annualised_volatility(rets) or 0.0
                vol_vec.append(vol)
            else:
                mu_vec.append(0.0)
                vol_vec.append(0.0)
        mu = np.array(mu_vec, dtype=float)

        # Choose optimisation mode.
        opt = optimizer_type.lower()
        if opt in {"equal_weight", "ew"}:
            weights_arr = self._equal_weight(n)
        elif opt in {"market_cap", "mcw"}:
            # Approximate market-cap weights. For this sprint we fall back to
            # equal-weight as market caps are not surfaced here yet.
            weights_arr = self._equal_weight(n)
        elif opt in {"minvar", "min_var", "minimum_variance"}:
            weights_arr = self._min_variance_weights(cov)
        elif opt in {"maxsharpe", "max_sharpe", "maximum_sharpe"}:
            weights_arr = self._max_sharpe_weights(cov, mu)
        elif opt in {"risk_parity", "rp"}:
            vols = np.array([v if v > 0.0 else 0.0 for v in vol_vec], dtype=float)
            inv_vol = np.where(vols > 0.0, 1.0 / vols, 0.0)
            if inv_vol.sum() <= 0.0:
                weights_arr = self._equal_weight(n)
            else:
                weights_arr = inv_vol / float(inv_vol.sum())
        elif opt in {"hrp"}:
            # For S16 we approximate HRP with risk-parity-style weights.
            vols = np.array([v if v > 0.0 else 0.0 for v in vol_vec], dtype=float)
            inv_vol = np.where(vols > 0.0, 1.0 / vols, 0.0)
            if inv_vol.sum() <= 0.0:
                weights_arr = self._equal_weight(n)
            else:
                weights_arr = inv_vol / float(inv_vol.sum())
        elif opt in {"cvar"}:
            # CVaR optimisation is approximated by a minimum-variance
            # solution for this sprint.
            weights_arr = self._min_variance_weights(cov)
        else:
            weights_arr = self._max_sharpe_weights(cov, mu)

        min_w = None
        max_w = None
        if constraints is not None:
            min_w = constraints.get("min_weight")
            max_w = constraints.get("max_weight")
        weights_arr = self._clamp_and_normalise(
            weights_arr,
            min_weight=min_w,
            max_weight=max_w,
        )

        # Persist constraints snapshot for the portfolio when provided.
        if constraints is not None:
            from .models import PortfolioConstraints  # local import to avoid cycles

            pc = (
                meta_db.query(PortfolioConstraints)
                .filter(PortfolioConstraints.portfolio_id == portfolio_id)
                .one_or_none()
            )
            if pc is None:
                pc = PortfolioConstraints(portfolio_id=portfolio_id)
            pc.min_weight = constraints.get("min_weight")
            pc.max_weight = constraints.get("max_weight")
            pc.turnover_limit = constraints.get("turnover_limit")
            pc.target_volatility = constraints.get("target_volatility")
            pc.max_beta = constraints.get("max_beta")
            pc.sector_caps_json = constraints.get("sector_caps")
            pc.factor_constraints_json = constraints.get("factor_constraints")
            meta_db.add(pc)
            meta_db.commit()

        # Compute risk metrics.
        w = weights_arr.reshape((n, 1))
        portfolio_var_arr = w.T @ cov @ w
        portfolio_var = (
            float(portfolio_var_arr[0][0]) if portfolio_var_arr.size else 0.0
        )
        portfolio_vol = math.sqrt(portfolio_var) if portfolio_var > 0.0 else 0.0
        portfolio_return = float(mu @ weights_arr)
        # Use portfolio-specific risk-free rate when configured.
        risk_profile = portfolio.risk_profile_json or {}
        try:
            risk_free_rate = float(risk_profile.get("risk_free_rate") or 0.0)
        except (TypeError, ValueError):
            risk_free_rate = 0.0
        excess_return = portfolio_return - risk_free_rate
        sharpe = excess_return / portfolio_vol if portfolio_vol > 0.0 else 0.0

        # Aggregate beta using stored RiskModel rows.
        betas: Dict[str, float] = {}
        risk_rows = (
            meta_db.query(RiskModel)
            .filter(
                RiskModel.symbol.in_(symbols_for_opt),  # type: ignore[arg-type]
                RiskModel.as_of_date == as_of_date,
            )
            .all()
        )
        for row in risk_rows:
            if row.beta is not None:
                betas[row.symbol] = float(row.beta)
        portfolio_beta = float(
            sum(
                weights_arr[i] * betas.get(sym, 0.0)
                for i, sym in enumerate(symbols_for_opt)
            )
        )

        risk_metrics = {
            "volatility": portfolio_vol,
            "expected_return": portfolio_return,
            "sharpe": sharpe,
            "beta": portfolio_beta,
            "risk_free_rate": risk_free_rate,
        }

        # Portfolio-level factor exposures as weighted averages.
        agg_exposures: Dict[str, float] = {}
        factor_names = ["value", "quality", "momentum", "low_vol", "size"]
        for name in factor_names:
            total = 0.0
            for i, sym in enumerate(symbols_for_opt):
                exposure = exposures_by_symbol.get(sym)
                if exposure is None:
                    continue
                val = getattr(exposure, name, None)
                if val is None:
                    continue
                total += float(weights_arr[i]) * float(val)
            agg_exposures[name] = total

        diagnostics: Dict[str, object] = {
            "optimizer_type": optimizer_type,
            "universe_size": len(symbols),
            "optimisation_symbols": symbols_for_opt,
        }
        if constraints is not None:
            diagnostics["constraints_applied"] = {
                "min_weight": min_w,
                "max_weight": max_w,
            }

        weight_dicts: list[dict] = []
        # Fetch basic sector and factor metadata for reporting.
        stocks = (
            meta_db.query(Stock)
            .filter(Stock.symbol.in_(symbols_for_opt))  # type: ignore[arg-type]
            .all()
        )
        sector_by_symbol = {s.symbol: s.sector for s in stocks}
        for i, sym in enumerate(symbols_for_opt):
            factor_row = exposures_by_symbol.get(sym)
            weight_dicts.append(
                {
                    "symbol": sym,
                    "weight": float(weights_arr[i]),
                    "sector": sector_by_symbol.get(sym),
                    "value": (
                        getattr(factor_row, "value", None)
                        if factor_row is not None
                        else None
                    ),
                    "quality": (
                        getattr(factor_row, "quality", None)
                        if factor_row is not None
                        else None
                    ),
                    "momentum": (
                        getattr(factor_row, "momentum", None)
                        if factor_row is not None
                        else None
                    ),
                    "low_vol": (
                        getattr(factor_row, "low_vol", None)
                        if factor_row is not None
                        else None
                    ),
                    "size": (
                        getattr(factor_row, "size", None)
                        if factor_row is not None
                        else None
                    ),
                }
            )

        return weight_dicts, risk_metrics, agg_exposures, diagnostics
