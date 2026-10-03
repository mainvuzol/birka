"""Request correlation.

Every request carries an id. It appears on the response as ``X-Request-ID``, in
every log line emitted while handling that request, on its error report when
Sentry is on, and later on every audit and stock-movement row, so a stock change
can be traced back to the exact request that caused it.

That includes a request that fails with an error nothing handled. Starlette
answers those from its outermost middleware, outside this one, with a bare
text 500 and no id, so a seller had nothing to quote and the app nothing to
parse. This middleware answers them itself, in the shape every other refusal
has, with the id; then the error goes on up unchanged, so uvicorn still writes
its traceback and Sentry, when it is on, still reports it.
"""

from __future__ import annotations

import json
import uuid
from contextvars import ContextVar

import sentry_sdk
import structlog
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
_MAX_INBOUND_LENGTH = 128

# What an unhandled error answers: the shape of a refusal
# (`DomainError.to_payload()`), with `details` always there, as ADR-0011 gives
# it, and the message in Ukrainian like everything a person reads. The app
# tells it from a refusal by its code.
INTERNAL_ERROR_PAYLOAD = {
    "code": "INTERNAL_ERROR",
    "message": "Внутрішня помилка сервера.",
    "details": {},
}
_INTERNAL_ERROR_BODY = json.dumps(INTERNAL_ERROR_PAYLOAD, ensure_ascii=False).encode("utf-8")


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
        response_started = False

        async def send_with_header(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                raw_headers = list(message.get("headers", []))
                raw_headers.append(
                    (REQUEST_ID_HEADER.encode("latin-1"), request_id.encode("latin-1"))
                )
                message = {**message, "headers": raw_headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        except Exception as error:
            if not response_started:
                # Once an answer has begun, nothing else can be said: the
                # error only goes on up.
                await _answer_internal_error(send_with_header)
            _log_unhandled(error, scope)
            raise
        finally:
            _correlation_id.reset(token)


def _log_unhandled(error: Exception, scope: Scope) -> None:
    """A line with the request's id: uvicorn's traceback, written once this
    middleware is done, no longer carries it. The path only, never the query
    (app/core/logging.py).

    The logger is taken when used, so it is the configured one whenever this
    module was imported (`app.core.logging` imports this module, so its
    `get_logger` is not imported here). A failure to write the line must not
    take the place of the error itself, which goes on up to uvicorn and Sentry.
    """
    try:
        structlog.get_logger().bind(logger=__name__).error(
            "request.unhandled_error",
            error=type(error).__name__,
            method=scope.get("method"),
            path=scope.get("path"),
        )
    except Exception:  # pragma: no cover - only a broken logging setup gets here
        return


async def _answer_internal_error(send: Send) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": 500,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(_INTERNAL_ERROR_BODY)).encode("latin-1")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": _INTERNAL_ERROR_BODY})


async def correlation_id_dependency(request: Request) -> str:
    """FastAPI dependency exposing the current correlation id."""
    return get_correlation_id() or request.headers.get(REQUEST_ID_HEADER, "")


__all__ = [
    "INTERNAL_ERROR_PAYLOAD",
    "REQUEST_ID_HEADER",
    "CorrelationIdMiddleware",
    "correlation_id_dependency",
    "get_correlation_id",
    "set_correlation_id",
]
