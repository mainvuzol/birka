"""Application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.v1.router import router as v1_router
from app.core.config import Settings, get_settings
from app.core.correlation import CorrelationIdMiddleware
from app.core.db import dispose_engine, init_engine
from app.core.errors import DomainError
from app.core.logging import configure_logging, get_logger

logger = get_logger(__name__)


def _install_sentry(settings: Settings) -> None:
    if not settings.sentry_dsn:
        return
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        # Errors carry a request id; payloads are not sent.
        send_default_pii=False,
        traces_sample_rate=0.0,
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Use the settings the app was built with, so a test or a script can run an
    # app configured differently from the process environment.
    settings: Settings = getattr(app.state, "settings", None) or get_settings()
    configure_logging(settings)
    settings.require_runtime_secrets()
    _install_sentry(settings)
    init_engine(settings)
    logger.info("app.startup", environment=settings.app_env)
    try:
        yield
    finally:
        await dispose_engine()
        logger.info("app.shutdown")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    app = FastAPI(
        title="birka API",
        version="0.1.0",
        docs_url=None if settings.is_production else "/docs",
        openapi_url=None if settings.is_production else "/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.add_middleware(CorrelationIdMiddleware)
    app.include_router(v1_router, prefix="/api/v1")

    @app.exception_handler(DomainError)
    async def _domain_error_handler(_request: Request, exc: DomainError) -> JSONResponse:
        # Domain failures are expected outcomes, not incidents: logged at
        # warning, never with a stack trace, and never echoing the request body.
        logger.warning("domain_error", code=exc.code, status=exc.http_status)
        return JSONResponse(status_code=exc.http_status, content=exc.to_payload())

    return app


app = create_app()

__all__ = ["app", "create_app"]
