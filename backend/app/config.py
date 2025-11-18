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


@lru_cache()
def get_settings() -> Settings:
    """Return cached application settings."""

    return Settings()


def get_database_url(settings: Settings | None = None) -> str:
    """Build a SQLite database URL from settings."""

    _settings = settings or get_settings()
    # Ensure the path is absolute to avoid surprises when running from different CWDs.
    db_path = _settings.meta_db_path
    if not db_path.is_absolute():
        db_path = Path(os.getcwd()) / db_path
    return f"sqlite:///{db_path}"
