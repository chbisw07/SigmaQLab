from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, Index, Integer, String

from .prices_database import PricesBase


class PriceBar(PricesBase):
    """OHLCV bar stored in the dedicated prices database."""

    __tablename__ = "price_bars"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    # Logical exchange for the bar, e.g. NSE, BSE, NYSE, CRYPTO.
    exchange = Column(String, nullable=True, index=True)
    timeframe = Column(String, nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Float, nullable=True)
    source = Column(String, nullable=False, index=True)

    __table_args__ = (
        Index(
            "ix_price_bars_symbol_timeframe_ts",
            "symbol",
            "timeframe",
            "timestamp",
        ),
    )


class PriceFetch(PricesBase):
    """Metadata about individual data fetch operations.

    This is used to assign stable, monotonic coverage identifiers (FS_00001,
    FS_00002, ...) and to order coverage rows by recency.
    """

    __tablename__ = "price_fetches"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    exchange = Column(String, nullable=True, index=True)
    timeframe = Column(String, nullable=False, index=True)
    source = Column(String, nullable=False, index=True)
    start_timestamp = Column(DateTime, nullable=True)
    end_timestamp = Column(DateTime, nullable=True)
    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
