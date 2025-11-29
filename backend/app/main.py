from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .database import Base, SessionLocal, engine, ensure_meta_schema_migrations, get_db
from .logging_config import configure_logging
from .prices_database import PricesBase, ensure_schema_migrations, prices_engine
from .routers import backtests as backtests_router
from .routers import data as data_router
from .routers import portfolios as portfolios_router
from .routers import stocks as stocks_router
from .routers import strategies as strategies_router
from .seed import seed_preset_strategies


def create_app(settings: Settings | None = None) -> FastAPI:
    """FastAPI application factory for SigmaQLab."""

    _settings = settings or get_settings()
    configure_logging(_settings.log_level)

    # Ensure metadata and prices tables exist. For early sprints we can use
    # simple create_all; migrations via Alembic can be introduced later.
    Base.metadata.create_all(bind=engine)
    PricesBase.metadata.create_all(bind=prices_engine)
    ensure_meta_schema_migrations()
    ensure_schema_migrations()

    # Seed preset strategies and parameter sets in the meta DB.
    with SessionLocal() as session:
        seed_preset_strategies(session)

    app = FastAPI(title=_settings.app_name)

    # Basic CORS for local dev (frontend on 5173).
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health(db: Session = Depends(get_db)) -> dict[str, str]:
        # Dependency ensures DB connectivity is at least attempted.
        _ = db  # unused variable hint for linters
        return {"status": "ok", "service": "sigmaqlab"}

    app.include_router(data_router.router)
    app.include_router(stocks_router.router)
    app.include_router(strategies_router.router)
    app.include_router(portfolios_router.router)
    app.include_router(backtests_router.router)

    return app


app = create_app()
