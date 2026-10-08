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

Except when the server itself cannot serve: its database does not answer, or
its schema is behind this code (ADR-0013 §2). Then the answer is 503
`SERVER_UNAVAILABLE` with the reason, which the phone reads as "the server
does not answer" and tells the seller to sell on paper (owner decision,
2026-10-04); one warning line says so, and the error goes no further. An
outage is told by the watcher (ADR-0011 §1), not by an error report for
every request it fails.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from typing import Any

import sentry_sdk
import structlog
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.unavailable import UnavailableReason

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

# What a request the server could not serve answers (ADR-0013 §2), in the
# same shape: `details.reason` is `DATABASE` or `SCHEMA`.
SERVER_UNAVAILABLE_CODE = "SERVER_UNAVAILABLE"
SERVER_UNAVAILABLE_MESSAGE = "Сервер тимчасово недоступний."

# Says whether an error nothing handled is the server's own failure, and
# which (`app/api/unavailable.py classify`); None for any other error.
Unavailable = Callable[[BaseException], Awaitable[UnavailableReason | None]]


def unavailable_payload(reason: UnavailableReason) -> dict[str, Any]:
    return {
        "code": SERVER_UNAVAILABLE_CODE,
        "message": SERVER_UNAVAILABLE_MESSAGE,
        "details": {"reason": reason},
    }


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
    """Pure-ASGI middleware so the id is set before anything else runs.

    `unavailable` tells an error nothing handled that is the server's own
    failure from a bug (ADR-0013 §2). Without it, every such error is a 500.
    """

    def __init__(self, app: ASGIApp, unavailable: Unavailable | None = None) -> None:
        self.app = app
        self.unavailable = unavailable

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
                reason = await _reason(self.unavailable, error)
                if reason is not None:
                    # Answered and told, and not raised: the watcher tells
                    # of an outage, not a report per request (ADR-0013 §2).
                    await _answer_unavailable(send_with_header, reason)
                    _log_unavailable(error, reason, scope)
                    return
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


async def _reason(unavailable: Unavailable | None, error: Exception) -> UnavailableReason | None:
    """What `unavailable` says of `error`. A failure to tell is no reason:
    the error is then answered as any other, never left unanswered."""
    if unavailable is None:
        return None
    try:
        return await unavailable(error)
    except Exception:
        return None


def _log_unavailable(error: Exception, reason: UnavailableReason, scope: Scope) -> None:
    """One warning line with the request's id: the reason and the error's
    kind, never its text, which may name the database's host
    (`app/api/internal.py`). The path only, never the query, as above."""
    try:
        structlog.get_logger().bind(logger=__name__).warning(
            "request.unavailable",
            reason=reason,
            error=type(error).__name__,
            method=scope.get("method"),
            path=scope.get("path"),
        )
    except Exception:  # pragma: no cover - only a broken logging setup gets here
        return


async def _answer(send: Send, status: int, body: bytes) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("latin-1")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


async def _answer_internal_error(send: Send) -> None:
    await _answer(send, 500, _INTERNAL_ERROR_BODY)


async def _answer_unavailable(send: Send, reason: UnavailableReason) -> None:
    body = json.dumps(unavailable_payload(reason), ensure_ascii=False).encode("utf-8")
    await _answer(send, 503, body)


async def correlation_id_dependency(request: Request) -> str:
    """FastAPI dependency exposing the current correlation id."""
    return get_correlation_id() or request.headers.get(REQUEST_ID_HEADER, "")


__all__ = [
    "INTERNAL_ERROR_PAYLOAD",
    "REQUEST_ID_HEADER",
    "SERVER_UNAVAILABLE_CODE",
    "SERVER_UNAVAILABLE_MESSAGE",
    "CorrelationIdMiddleware",
    "Unavailable",
    "correlation_id_dependency",
    "get_correlation_id",
    "set_correlation_id",
    "unavailable_payload",
]
