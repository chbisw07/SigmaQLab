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

    Currently this adds the `engine_code` column to the `strategies` table
    if it does not already exist. This mirrors the prices DB helper and keeps
    early-sprint schema evolution simple without full Alembic migrations.
    """

    inspector = inspect(engine)
    if "strategies" in inspector.get_table_names():
        columns = {col["name"] for col in inspector.get_columns("strategies")}
        if "engine_code" not in columns:
            with engine.connect() as conn:
                conn.execute(
                    text("ALTER TABLE strategies ADD COLUMN engine_code VARCHAR")
                )
                conn.commit()
