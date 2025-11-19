from typing import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from .config import get_prices_database_url

SQLALCHEMY_PRICES_DATABASE_URL = get_prices_database_url()

prices_engine = create_engine(
    SQLALCHEMY_PRICES_DATABASE_URL,
    connect_args={"check_same_thread": False},
)

PricesSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=prices_engine,
)

PricesBase = declarative_base()


def ensure_schema_migrations() -> None:
    """Apply lightweight, in-place schema migrations for the prices DB.

    This is intentionally minimal and only covers simple additive changes that
    are safe for SQLite (e.g. adding the `exchange` column if it does not
    exist). More complex migrations should be handled via Alembic in future
    sprints.
    """

    inspector = inspect(prices_engine)
    if "price_bars" in inspector.get_table_names():
        columns = {col["name"] for col in inspector.get_columns("price_bars")}
        if "exchange" not in columns:
            with prices_engine.connect() as conn:
                conn.execute(text("ALTER TABLE price_bars ADD COLUMN exchange VARCHAR"))
                conn.commit()


def get_prices_db() -> Generator[Session, None, None]:
    """Yield a SQLAlchemy session for the prices database."""

    db = PricesSessionLocal()
    try:
        yield db
    finally:
        db.close()
