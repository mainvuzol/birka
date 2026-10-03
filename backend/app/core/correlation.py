"""Request correlation.

Every request carries an id. It appears on the response as ``X-Request-ID``, in
every log line emitted while handling that request, on its error report when
Sentry is on, and later on every audit and stock-movement row, so a stock change
can be traced back to the exact request that caused it.
"""

from __future__ import annotations

import uuid
from contextvars import ContextVar

import sentry_sdk
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
_MAX_INBOUND_LENGTH = 128

_correlation_id: ContextVar[str | None] = ContextVar("correlation_id", default=None)


def get_correlation_id() -> str | None:
    """Correlation id of the request being handled, if any."""
    return _correlation_id.get()


def set_correlation_id(value: str) -> None:
    _correlation_id.set(value)


def _clean_inbound(raw: str | None) -> str | None:
    """Accept a client-supplied id only when it is safe to echo and log.

    An inbound header is untrusted input: it ends up in log files and response
    headers, so control characters and unbounded length are rejected rather than
    sanitised silently.
    """
    if not raw:
        return None
    candidate = raw.strip()
    if not candidate or len(candidate) > _MAX_INBOUND_LENGTH:
        return None
    if not all(c.isalnum() or c in "-_." for c in candidate):
        return None
    return candidate


def _tag_error_reports(request_id: str) -> None:
    """Put the request id on the error report Sentry may send for this request.

    Error reports carry no query string, so the id is what ties a report to the
    request's log lines and audit rows. Sentry's ASGI middleware, outside this
    one, has already opened a scope for the request, and it reports an unhandled
    error after this middleware has reset the id (the `finally` below). So the
    id goes on that scope now rather than being read back when the report is
    built. Nothing is done when Sentry is off.
    """
    if sentry_sdk.get_client().is_active():
        sentry_sdk.get_isolation_scope().set_tag("request_id", request_id)


class CorrelationIdMiddleware:
    """Pure-ASGI middleware so the id is set before anything else runs."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        request_id = _clean_inbound(headers.get(REQUEST_ID_HEADER.lower())) or str(uuid.uuid4())
        token = _correlation_id.set(request_id)
        _tag_error_reports(request_id)

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                raw_headers = list(message.get("headers", []))
                raw_headers.append(
                    (REQUEST_ID_HEADER.encode("latin-1"), request_id.encode("latin-1"))
                )
                message = {**message, "headers": raw_headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        finally:
            _correlation_id.reset(token)


async def correlation_id_dependency(request: Request) -> str:
    """FastAPI dependency exposing the current correlation id."""
    return get_correlation_id() or request.headers.get(REQUEST_ID_HEADER, "")


__all__ = [
    "REQUEST_ID_HEADER",
    "CorrelationIdMiddleware",
    "correlation_id_dependency",
    "get_correlation_id",
    "set_correlation_id",
]
