"""Application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.v1.router import router as v1_router
from app.core.config import Settings, get_settings
from app.core.correlation import CorrelationIdMiddleware
from app.core.db import dispose_engine, init_engine
from app.core.errors import DomainError
from app.core.logging import configure_logging, get_logger

if TYPE_CHECKING:
    from sentry_sdk.types import Event, Hint

logger = get_logger(__name__)


def _scrub_request_body(event: Event, _hint: Hint) -> Event:
    """Remove the request body from every event before it leaves the process.

    `POST /auth/telegram` carries raw Telegram initData, which is a usable
    credential until `telegram_init_data_max_age_seconds` elapses. Anyone able
    to read the Sentry project could replay it and mint a session.
    """
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
        request.pop("cookies", None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            for sensitive in ("authorization", "Authorization", "cookie", "Cookie"):
                headers.pop(sensitive, None)
    return event


def _install_sentry(settings: Settings) -> None:
    if not settings.sentry_dsn:
        return
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        send_default_pii=False,
        # send_default_pii=False only gates cookies; sentry-sdk 2.x attaches
        # request bodies regardless. Both of the next two lines are required.
        max_request_body_size="never",
        before_send=_scrub_request_body,
        # Login credentials also live in traceback locals (init_data and
        # parsed payloads). Request scrubbing does not remove those copies.
        include_local_variables=False,
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
