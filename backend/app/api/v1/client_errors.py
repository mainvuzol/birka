"""A note from a seller's screen that broke (owner decision, 2026-10-03).

When the app's screen breaks, the seller sees «Щось пішло не так» and
«Перезапустити», and the app sends a short note here: which screen, which
error, the app's version and the number of the request it was making. The
note goes to the server's log only, as one line, `client.error`. Nothing is
stored, nothing goes to Sentry, and the bot does not write about it.

The note never holds a name, a phone, what was typed, or the Telegram number.
The app does not put them in; this endpoint makes sure of what it can, since
an error's message is free text that may repeat a value: PostgreSQL's
repeated row values and any URL's query are cut (`app/core/logging.py`), and
any run of seven or more digits, phones and Telegram numbers among them,
becomes «[число]».

No session is needed, because a screen can break before its sign-in. So each
address has its own limit (`app/core/rate_limit.py`), and the body is small.
"""

from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, ValidationError

from app.core.errors import PayloadTooLargeError
from app.core.logging import get_logger, redact_database_values, without_query_strings
from app.core.rate_limit import limit_client_errors

logger = get_logger(__name__)

router = APIRouter(tags=["ops"])

MAX_BODY_BYTES = 4096
SCREEN_CHARS = 40
NAME_CHARS = 80
MESSAGE_CHARS = 500
RELEASE_CHARS = 40
REQUEST_ID_CHARS = 64

# Seven digits or more, with spaces, dashes, brackets or a plus between them:
# «+38 (067) 123-45-67», «0671234567», a Telegram number.
_LONG_NUMBER = re.compile(r"\+?\d(?:[\s()\[\]+-]*\d){6,}")
_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]+")


class ClientErrorReport(BaseModel):
    """What the app sends. Fields it may add later are ignored."""

    model_config = ConfigDict(extra="ignore")

    kind: Literal["render", "error", "rejection"]
    screen: str
    name: str
    message: str
    release: str
    request_id: str | None = None


def without_personal_data(text: str) -> str:
    """Free text without the values it may repeat: a refused row's values, a
    URL's query, and long numbers."""
    text = without_query_strings(redact_database_values(text))
    return _LONG_NUMBER.sub("[число]", text)


def _cut(text: str, limit: int) -> str:
    """At most `limit` characters, the values taken out first so a cut never
    leaves part of a number behind. Only twice the limit is looked at: the
    rest is cut anyway, and a body of 4096 bytes is then never scanned whole
    on every request."""
    return without_personal_data(text[: limit * 2])[:limit]


def _request_id(value: str | None) -> str | None:
    """Kept only when it can be the server's own request number."""
    if value and len(value) <= REQUEST_ID_CHARS and _REQUEST_ID.fullmatch(value):
        return value
    return None


async def _body(request: Request) -> bytes:
    """The body, refused with 413 past `MAX_BODY_BYTES` before it is read
    whole, whether or not it says its length."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise PayloadTooLargeError()
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_BODY_BYTES:
            raise PayloadTooLargeError()
    return bytes(body)


@router.post(
    "/client-errors",
    status_code=204,
    dependencies=[Depends(limit_client_errors)],
    responses={413: {"description": "The body is over 4096 bytes"}},
)
async def report_client_error(request: Request) -> Response:
    """Write one line, `client.error`, at warning; answer 204.

    Over-long fields are cut, not refused: a note is worth more cut than
    lost. A request id that cannot be the server's own is dropped. The id the
    app sends is logged as `client_request_id`: `request_id` on every line is
    the id of the request that wrote it, this one.
    """
    raw = await _body(request)
    try:
        report = ClientErrorReport.model_validate_json(raw)
    except ValidationError as invalid:
        # Refused as FastAPI refuses any body, at `body.<field>`.
        errors = invalid.errors(include_url=False)
        raise RequestValidationError(
            [{**error, "loc": ("body", *error["loc"])} for error in errors]
        ) from None
    logger.warning(
        "client.error",
        kind=report.kind,
        screen=_cut(report.screen, SCREEN_CHARS),
        name=_cut(report.name, NAME_CHARS),
        message=_cut(report.message, MESSAGE_CHARS),
        release=report.release[:RELEASE_CHARS],
        client_request_id=_request_id(report.request_id),
    )
    return Response(status_code=204)


__all__ = ["MAX_BODY_BYTES", "ClientErrorReport", "router", "without_personal_data"]
