from fastapi import Depends, FastAPI
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .database import Base, engine, get_db
from .logging_config import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    """FastAPI application factory for SigmaQLab."""

    _settings = settings or get_settings()
    configure_logging(_settings.log_level)

    # Ensure metadata tables exist. For S01 we can use simple create_all;
    # migrations via Alembic can be introduced in later sprints.
    Base.metadata.create_all(bind=engine)

    app = FastAPI(title=_settings.app_name)

    @app.get("/health")
    async def health(db: Session = Depends(get_db)) -> dict[str, str]:
        # Dependency ensures DB connectivity is at least attempted.
        _ = db  # unused variable hint for linters
        return {"status": "ok", "service": "sigmaqlab"}

    return app


app = create_app()


