"""Application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from math import isfinite
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import models_registry  # noqa: F401  - every table on the metadata, like migrations/env.py
from app.api.v1.router import router as v1_router
from app.core.config import Settings, get_settings
from app.core.correlation import CorrelationIdMiddleware
from app.core.db import dispose_engine, init_engine
from app.core.errors import DomainError
from app.core.logging import (
    configure_logging,
    get_logger,
    redact_database_values,
    without_query,
    without_query_strings,
)

if TYPE_CHECKING:
    from sentry_sdk.types import Breadcrumb, BreadcrumbHint, Event, Hint

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


def _scrub_text(text: str) -> str:
    return without_query_strings(redact_database_values(text))


def _scrub_event(event: Event, hint: Hint) -> Event:
    """Remove what must not leave the process from an event, before it leaves.

    The request body, as above. Then the customers' names and phones, which the
    logs never carry either (`.ai/project-memory/known-risks.md`, customer
    credit): a debt search sends them in its query string, which sentry-sdk
    attaches to every event of the request whatever `send_default_pii` says,
    and PostgreSQL repeats a refused row's values in the text of a database
    error. The request id stays, as a tag (app/core/correlation.py), so the
    event can still be matched to the request's log lines.
    """
    _scrub_request_body(event, hint)
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("query_string", None)
        url = request.get("url")
        if isinstance(url, str):
            request["url"] = without_query(url)
        headers = request.get("headers")
        if isinstance(headers, dict):
            for referer in ("referer", "Referer"):
                if isinstance(headers.get(referer), str):
                    headers[referer] = without_query(headers[referer])
    exceptions = event.get("exception")
    if isinstance(exceptions, dict):
        for exception in exceptions.get("values") or []:
            if isinstance(exception, dict) and isinstance(exception.get("value"), str):
                exception["value"] = _scrub_text(exception["value"])
    if isinstance(event.get("message"), str):
        event["message"] = _scrub_text(event["message"])
    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        for key in ("message", "formatted"):
            if isinstance(logentry.get(key), str):
                logentry[key] = _scrub_text(logentry[key])
        # The arguments of a logged message are its values; the formatted
        # message above already says what they were, without them.
        logentry.pop("params", None)
    return event


def _scrub_breadcrumb(crumb: Breadcrumb, _hint: BreadcrumbHint) -> Breadcrumb:
    """The same for the trail of log lines and calls an event carries.

    Every log line is a breadcrumb, the access line of the failing request
    included. The access line is already cut where it is written
    (app/core/logging.py); this is for any other line that holds a URL.
    """
    if isinstance(crumb.get("message"), str):
        crumb["message"] = _scrub_text(crumb["message"])
    data = crumb.get("data")
    if isinstance(data, dict):
        # sentry-sdk keeps an outgoing call's query apart from its URL.
        data.pop("http.query", None)
        data.pop("http.fragment", None)
        for key, value in list(data.items()):
            if isinstance(value, str):
                data[key] = without_query(value) if key == "url" else _scrub_text(value)
    return crumb


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
        before_send=_scrub_event,
        before_breadcrumb=_scrub_breadcrumb,
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
        return JSONResponse(
            status_code=exc.http_status, content=exc.to_payload(), headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(
        _request: Request, exc: RequestValidationError
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
        """
        return JSONResponse(status_code=422, content={"detail": _encodable(exc.errors())})

    return app


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
