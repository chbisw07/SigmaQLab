from typing import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from .config import get_database_url

SQLALCHEMY_DATABASE_URL = get_database_url()

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """Yield a SQLAlchemy session for FastAPI dependencies."""

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_meta_schema_migrations() -> None:
    """Apply lightweight, in-place schema migrations for the meta DB.

    This mirrors the prices DB helper and keeps early-sprint schema evolution
    simple without full Alembic migrations. Only additive, backwards-compatible
    changes are performed here.
    """

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    # Strategies: engine_code (engine implementation key).
    if "strategies" in tables:
        columns = {col["name"] for col in inspector.get_columns("strategies")}
        if "engine_code" not in columns:
            with engine.connect() as conn:
                conn.execute(
                    text("ALTER TABLE strategies ADD COLUMN engine_code VARCHAR")
                )
                conn.commit()

    # Backtests: additional metadata/config fields.
    if "backtests" in tables:
        columns = {col["name"] for col in inspector.get_columns("backtests")}
        new_cols: dict[str, str] = {
            "label": "VARCHAR",
            "notes": "TEXT",
            "params_effective_json": "JSON",
            "risk_config_json": "JSON",
            "costs_config_json": "JSON",
            "visual_config_json": "JSON",
            "group_id": "INTEGER",
            "universe_mode": "VARCHAR",
        }
        missing = {name: ddl for name, ddl in new_cols.items() if name not in columns}
        if missing:
            with engine.connect() as conn:
                for name, ddl in missing.items():
                    conn.execute(text(f"ALTER TABLE backtests ADD COLUMN {name} {ddl}"))
                conn.commit()

    # Backtest trades: per-trade derived metrics, optional Indian-equity
    # cost metadata, and human-readable reasons.
    if "backtest_trades" in tables:
        columns = {col["name"] for col in inspector.get_columns("backtest_trades")}
        new_cols = {
            "pnl_pct": "FLOAT",
            "holding_period_bars": "INTEGER",
            "max_theoretical_pnl": "FLOAT",
            "max_theoretical_pnl_pct": "FLOAT",
            "pnl_capture_ratio": "FLOAT",
            "entry_order_type": "VARCHAR",
            "exit_order_type": "VARCHAR",
            "entry_brokerage": "FLOAT",
            "exit_brokerage": "FLOAT",
            "entry_reason": "VARCHAR",
            "exit_reason": "VARCHAR",
        }
        missing = {name: ddl for name, ddl in new_cols.items() if name not in columns}
        if missing:
            with engine.connect() as conn:
                for name, ddl in missing.items():
                    conn.execute(
                        text(f"ALTER TABLE backtest_trades ADD COLUMN {name} {ddl}")
                    )
                conn.commit()

    # Stocks: optional market cap in INR crores.
    if "stocks" in tables:
        columns = {col["name"] for col in inspector.get_columns("stocks")}
        new_cols = {
            "market_cap_crore": "FLOAT",
            "analyst_rating": "VARCHAR",
            "target_price_one_year": "FLOAT",
        }
        missing = {name: ddl for name, ddl in new_cols.items() if name not in columns}
        if missing:
            with engine.connect() as conn:
                for name, ddl in missing.items():
                    conn.execute(text(f"ALTER TABLE stocks ADD COLUMN {name} {ddl}"))
                conn.commit()
