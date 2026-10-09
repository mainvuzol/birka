"""Application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from math import isfinite
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import models_registry  # noqa: F401  - every table on the metadata, like migrations/env.py
from app.api.internal import router as internal_router
from app.api.unavailable import classify
from app.api.v1.router import router as v1_router
from app.core.config import Settings, get_settings
from app.core.correlation import CorrelationIdMiddleware
from app.core.db import dispose_engine, init_engine
from app.core.errors import DomainError
from app.core.logging import configure_logging, get_logger
from app.core.sentry import install_sentry

logger = get_logger(__name__)

# The most refusals one 422 lists; `detail_truncated` counts the rest.
MAX_DETAIL = 50
# Every route of a stock list: a parser's file, typed lines, their answers.
STOCK_LISTS = "/api/v1/snapshots"
# The most of a key or a value a stock list's refusal names, in its `loc` or
# its `ctx`: enough to find it in the file, never the file (review, 2026-10-09).
MAX_NAMED = 60


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Use the settings the app was built with, so a test or a script can run an
    # app configured differently from the process environment.
    settings: Settings = getattr(app.state, "settings", None) or get_settings()
    configure_logging(settings)
    settings.require_runtime_secrets()
    install_sentry(settings, component="api")
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
    # When this process started, as `GET /internal/status` reports it: the
    # app is built once, when uvicorn imports this module.
    app.state.started_at = datetime.now(tz=UTC)
    # Also answers an error nothing handled, with its request id
    # (app/core/correlation.py): 503 when the database does not answer or
    # its schema is behind this code, else 500 (ADR-0013 §2).
    app.add_middleware(CorrelationIdMiddleware, unavailable=classify)
    app.include_router(v1_router, prefix="/api/v1")
    # Not under /api: Caddy passes only /api/* on, so only the compose
    # network reaches it (app/api/internal.py).
    app.include_router(internal_router, prefix="/internal")

    @app.exception_handler(DomainError)
    async def _domain_error_handler(_request: Request, exc: DomainError) -> JSONResponse:
        # Domain failures are expected outcomes, not incidents: logged at
        # warning, never with a stack trace, and never echoing the request body.
        logger.warning("domain_error", code=exc.code, status=exc.http_status)
        return JSONResponse(
            status_code=exc.http_status, content=exc.to_payload(), headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Refuse malformed input without crashing on it.

        FastAPI's own handler echoes the offending value back under `input`,
        and some values cannot survive that round trip: a lone UTF-16
        surrogate (`"\\ud800"`) is rejected by the JSON parser and then breaks
        the encoder rendering the error, so the client gets a 500 for what is
        an ordinary 422. Reported by the independent security review,
        2026-09-15; reachable on every endpoint, by anyone.

        The shape FastAPI produces is kept exactly — clients already parse it —
        and only values that cannot be encoded are replaced.

        At most `MAX_DETAIL` refusals are sent, and `detail_truncated` says how
        many more there were: a small body of many unknown keys would
        otherwise answer with megabytes (review, 2026-10-09).

        A stock list's request (ADR-0014 §13) is never sent back: on
        `/api/v1/snapshots`, each refusal keeps its `type`, `loc`, `msg` and
        `ctx` (a file's line, as `ctx.line`), and loses `input` and `url`,
        wherever it stands — in the file, in the body around it, or the body
        itself. A notebook's lines may name customers, and a refused file of
        up to a megabyte is not echoed to the phone that sent it. A key the
        format does not know is named in `loc`, and a size in `ctx`, by at
        most their first `MAX_NAMED` characters and «…»: a key of 300 000
        characters is not sent back whole either.
        """
        errors = exc.errors()
        shown = errors[:MAX_DETAIL]
        if _is_stock_list(request):
            shown = [_without_input(error) for error in shown]
        content: dict[str, Any] = {"detail": _encodable(shown)}
        if len(errors) > MAX_DETAIL:
            content["detail_truncated"] = len(errors) - MAX_DETAIL
        return JSONResponse(status_code=422, content=content)

    return app


def _is_stock_list(request: Request) -> bool:
    path: str = request.scope.get("path", "")
    return path == STOCK_LISTS or path.startswith(STOCK_LISTS + "/")


def _without_input(error: Any) -> Any:
    """A refusal without the value it refused, nor the link to pydantic's
    page about it, and with each name in its `loc` and `ctx` cut to
    `MAX_NAMED` characters: a stock list's request never comes back in its
    422."""
    if not isinstance(error, dict):
        return error
    kept = {key: item for key, item in error.items() if key not in ("input", "url")}
    if isinstance(kept.get("loc"), list | tuple):
        kept["loc"] = [_named(part) for part in kept["loc"]]
    if isinstance(kept.get("ctx"), dict):
        kept["ctx"] = {key: _named(item) for key, item in kept["ctx"].items()}
    return kept


def _named(value: Any) -> Any:
    """A key or a value as a refusal names it: whole up to `MAX_NAMED`
    characters, then cut, with «…» to say so."""
    if isinstance(value, str) and len(value) > MAX_NAMED:
        return value[:MAX_NAMED] + "…"
    return value


def _encodable(value: Any) -> Any:
    """Return `value` with anything JSON cannot encode replaced in place.

    Walks rather than blanket-stringifies so a normal validation error still
    reads exactly as it did: only the unencodable leaf is replaced, and it is
    replaced with a description rather than dropped, so the client can still
    tell which field was at fault.
    """
    if isinstance(value, dict):
        return {_encodable(str(key)): _encodable(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_encodable(item) for item in value]
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            return "<value could not be encoded>"
        return value
    if isinstance(value, float) and not isfinite(value):
        return "<non-finite number>"
    if isinstance(value, bool | int | float | type(None)):
        return value
    return _encodable(str(value))


app = create_app()

__all__ = ["app", "create_app"]
