import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from environment variables or `.env`.

    Environment variables:
    - SIGMAQLAB_APP_NAME
    - SIGMAQLAB_ENVIRONMENT
    - SIGMAQLAB_LOG_LEVEL
    - SIGMAQLAB_META_DB_PATH
    - SIGMAQLAB_PRICES_DB_PATH
    - SIGMAQLAB_KITE_API_KEY
    - SIGMAQLAB_KITE_API_SECRET
    - SIGMAQLAB_KITE_ACCESS_TOKEN
    - SIGMAQLAB_BASE_TIMEFRAME
    - SIGMAQLAB_BASE_HORIZON_DAYS
    """

    model_config = SettingsConfigDict(
        env_prefix="SIGMAQLAB_",
        env_file=".env",
        env_file_encoding="utf-8",
    )

    app_name: str = "SigmaQLab"
    environment: Literal["dev", "test", "prod"] = "dev"
    log_level: str = "INFO"
    meta_db_path: Path = Path("sigmaqlab_meta.db")
    prices_db_path: Path = Path("sigmaqlab_prices.db")

    kite_api_key: str | None = None
    kite_api_secret: str | None = None
    kite_access_token: str | None = None

    # Optional base timeframe and horizon for the local OHLCV cache. When
    # configured, components like the DataManager can prefer fetching this
    # timeframe for caching and reuse it across multiple backtests.
    base_timeframe: str | None = None
    base_horizon_days: int = 1095


@lru_cache()
def get_settings() -> Settings:
    """Return cached application settings."""

    return Settings()


def _build_sqlite_url(path: Path) -> str:
    """Build a SQLite database URL from a filesystem path."""

    # Ensure the path is absolute to avoid surprises when running from different CWDs.
    db_path = path
    if not db_path.is_absolute():
        db_path = Path(os.getcwd()) / db_path
    return f"sqlite:///{db_path}"


def get_database_url(settings: Settings | None = None) -> str:
    """Return SQLite URL for the meta database."""

    _settings = settings or get_settings()
    return _build_sqlite_url(_settings.meta_db_path)


def get_prices_database_url(settings: Settings | None = None) -> str:
    """Return SQLite URL for the prices database."""

    _settings = settings or get_settings()
    return _build_sqlite_url(_settings.prices_db_path)
