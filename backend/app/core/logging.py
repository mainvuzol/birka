"""Structured logging.

JSON in deployed environments so logs are queryable; human-readable locally.
Every line carries the correlation id of the request that produced it.

The customers' phones and names are kept out of the logs
(`.ai/project-memory/known-risks.md`, customer credit). They reach a log by two
paths that no call site chooses: the query string of a debt search
(`GET /credits/customers?query=<name or phone>`), which uvicorn's access line
repeats, and the values PostgreSQL repeats in an error's DETAIL, which a
traceback carries. Both are cut here, where every line passes.
"""

from __future__ import annotations

import logging
import re
import sys
from typing import Any

import structlog

from app.core.config import Settings
from app.core.correlation import get_correlation_id

# PostgreSQL repeats the values it refused. A CHECK or NOT NULL violation
# prints the whole row ("Failing row contains (…)"); a unique, foreign-key or
# exclusion violation prints the key ("Key (phone_digits)=(0671234567) already
# exists"). For a debt that row is the customer's name and phone. The first line
# of the error, which names the table and the constraint, says what went wrong
# without them, so only the values are cut: from the opening parenthesis to the
# end of the DETAIL, not of its first line, since a value may hold a line
# break. The DETAIL ends where SQLAlchemy's statement, a HINT, the next
# chained exception (after a blank line) or the text itself ends.
# `hide_parameters` on the engine (app/core/db.py) does not touch this text,
# because PostgreSQL, not SQLAlchemy, writes it.
_DETAIL_END = r"(?=\n\[SQL: |\nHINT: |\n\(Background on this error|\n\n|\Z)"
_FAILING_ROW = re.compile(r"([Ff]ailing row contains )\(.*?" + _DETAIL_END, re.DOTALL)
_KEY_VALUES = re.compile(r"([Kk]ey \(.*?\)=)\(.*?" + _DETAIL_END, re.DOTALL)
_HIDDEN = r"\1(values hidden)"

# A query string inside free text: the "?" that follows a path, up to the next
# space or quote. A "?" ending an ordinary sentence has no path before it and is
# left alone.
_QUERY_AFTER_PATH = re.compile(r"(/[^\s?\"']*)\?[^\s\"']*")


def redact_database_values(text: str) -> str:
    """`text` without the row or key values PostgreSQL repeats in an error."""
    return _KEY_VALUES.sub(_HIDDEN, _FAILING_ROW.sub(_HIDDEN, text))


def without_query(url: str) -> str:
    """A URL or path without its query string and fragment."""
    return url.split("?", 1)[0].split("#", 1)[0]


def without_query_strings(text: str) -> str:
    """Free text with the query string cut from every path in it."""
    return _QUERY_AFTER_PATH.sub(r"\1", text)


class _AccessLineWithoutQuery(logging.Filter):
    """Write uvicorn's access line with the path only, never its query.

    uvicorn logs `client - "METHOD path?query HTTP/1.1" status`, the query as it
    came. A debt search puts a customer's name or phone there, and the line
    would sit in the server's Docker log for as long as 50 MB of lines last.
    The method, path, status and client stay: they are what an access line is
    read for.

    A filter on the logger runs before any handler, so Sentry, which records
    every log line as a breadcrumb, is handed the line already cut.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            # uvicorn's arguments are (client, method, path, http version,
            # status); only the path can hold a "?".
            record.args = tuple(
                without_query(arg) if isinstance(arg, str) else arg for arg in record.args
            )
        if isinstance(record.msg, str):
            record.msg = without_query_strings(record.msg)
        return True


class _RedactingFormatter(logging.Formatter):
    """The stdout format, with PostgreSQL's repeated values cut.

    An unhandled error is written by uvicorn with its whole traceback, and a
    database error's text carries PostgreSQL's DETAIL.
    """

    def format(self, record: logging.LogRecord) -> str:
        return redact_database_values(super().format(record))


def _add_correlation_id(
    _logger: Any, _method: str, event_dict: structlog.types.EventDict
) -> structlog.types.EventDict:
    correlation_id = get_correlation_id()
    if correlation_id:
        event_dict["request_id"] = correlation_id
    return event_dict


def _redact_exception(
    _logger: Any, _method: str, event_dict: structlog.types.EventDict
) -> structlog.types.EventDict:
    """The same cut for a traceback that structlog writes itself
    (`logger.exception(...)`), which never passes a stdlib formatter."""
    exception = event_dict.get("exception")
    if isinstance(exception, str):
        event_dict["exception"] = redact_database_values(exception)
    return event_dict


def configure_logging(settings: Settings) -> None:
    """Configure structlog and the stdlib root logger once, at startup."""
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    stdout = logging.StreamHandler(sys.stdout)
    stdout.setFormatter(_RedactingFormatter("%(message)s"))
    # A no-op when the root logger already has a handler, as before.
    logging.basicConfig(handlers=[stdout], level=level)
    # uvicorn installs its own handlers; let records flow to the root logger
    for noisy in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        named = logging.getLogger(noisy)
        if noisy == "uvicorn.access" and not named.handlers and not named.propagate:
            # `uvicorn --no-access-log` leaves the access logger like this;
            # routing it to the root would switch the access log back on.
            continue
        named.handlers.clear()
        named.propagate = True

    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(existing, _AccessLineWithoutQuery) for existing in access.filters):
        access.addFilter(_AccessLineWithoutQuery())

    processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        # Deliberately the plain processors, not the structlog.stdlib ones:
        # this configuration writes directly (PrintLoggerFactory) rather than
        # through a stdlib logger, and add_logger_name needs a stdlib record.
        structlog.processors.add_log_level,
        _add_correlation_id,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        _redact_exception,
    ]
    processors.append(
        structlog.processors.JSONRenderer()
        if settings.log_json
        else structlog.dev.ConsoleRenderer(colors=False)
    )

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> Any:
    """Logger bound to the calling module's name."""
    return structlog.get_logger().bind(logger=name)


__all__ = [
    "configure_logging",
    "get_logger",
    "redact_database_values",
    "without_query",
    "without_query_strings",
]
