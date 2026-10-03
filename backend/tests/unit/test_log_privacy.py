"""The customers' names and phones stay out of the server's log.

They reach a log by two paths no call site chooses: the query string of a debt
search, which uvicorn's access line repeats, and the values PostgreSQL repeats
in a database error, which a traceback carries. These tests run uvicorn's own
HTTP protocol, in memory, so a change in how uvicorn writes its access line
shows here. Nothing opens a socket or a database connection.
"""

from __future__ import annotations

import asyncio
import importlib.util
import logging
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any
from urllib.parse import quote, quote_plus

import asyncpg
import pytest
import uvicorn
from sqlalchemy import exc as sa_exc
from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi
from uvicorn.server import ServerState

from app.core.config import Settings
from app.core.db import create_engine
from app.core.logging import (
    configure_logging,
    get_logger,
    redact_database_values,
    without_query_strings,
)

NAME = "Ірина Коваль"
PHONE = "+38 (067) 123-45-67"
DIGITS = "0671234567"
STORE_ID = uuid.UUID("6b1f2a4e-9d0c-4c1e-8a57-0f3e2d1c4b5a")
SEARCH = f"store_id={STORE_ID}&status=OPEN&query={quote_plus(f'Ірина {DIGITS}')}"

# Every spelling in which the customer could appear in a line: as typed, as the
# browser encodes it in a URL, and in part.
PERSONAL = (
    NAME,
    PHONE,
    DIGITS,
    "Ірина",
    "Коваль",
    quote("Ірина"),
    quote_plus(f"Ірина {DIGITS}"),
    "123-45-67",
)

# PostgreSQL 16's wording for a refused debt row, as read from a real server.
_STATEMENT = (
    "INSERT INTO customer_credit (organization_id, store_id, sale_id, customer_name, "
    "customer_phone, phone_digits, amount, currency_code, opened_by_user_id) VALUES "
    "($1::UUID, $2::UUID, $3::UUID, $4::VARCHAR, $5::VARCHAR, $6::VARCHAR, $7::NUMERIC, "
    "$8::VARCHAR, $9::UUID)"
)
_REFUSED_ROW = (
    f"Failing row contains (5e0c8d1a-0b7e-4f4b-9f1e-3c2d1b0a9f8e, {STORE_ID}, "
    f"2d3c4b5a-6978-4a1b-8c2d-3e4f5a6b7c8d, {NAME}, {PHONE}, {DIGITS}, -1.00, UAH, OPEN, "
    "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d, null)."
)


def refused_debt(*, hide_parameters: bool) -> sa_exc.IntegrityError:
    """The error SQLAlchemy raises when PostgreSQL refuses a debt's row.

    Built as asyncpg and SQLAlchemy's asyncpg dialect build it, chained the same
    way, so its text and its traceback read as the real one does.
    """
    refused = asyncpg.exceptions.CheckViolationError.new(
        {
            "S": "ERROR",
            "C": "23514",
            "M": 'new row for relation "customer_credit" violates check constraint '
            '"ck_customer_credit_amount_positive"',
            "D": _REFUSED_ROW,
            "t": "customer_credit",
            "n": "ck_customer_credit_amount_positive",
        }
    )
    dbapi = AsyncAdapt_asyncpg_dbapi
    try:
        try:
            raise refused
        except asyncpg.exceptions.PostgresError as error:
            raise dbapi.IntegrityError(f"{type(error)}: {error}") from error
    except dbapi.IntegrityError as translated:
        wrapped = sa_exc.DBAPIError.instance(
            _STATEMENT,
            (STORE_ID, NAME, PHONE, DIGITS),
            translated,
            dbapi.Error,
            hide_parameters=hide_parameters,
        )
    assert isinstance(wrapped, sa_exc.IntegrityError)
    return wrapped


async def engine_hides_parameters() -> bool:
    """Whether the application's engine leaves values out of its errors."""
    engine = create_engine(Settings())
    try:
        return engine.sync_engine.hide_parameters
    finally:
        await engine.dispose()


def assert_no_customer(text: str) -> None:
    for spelling in PERSONAL:
        assert spelling not in text, f"{spelling!r} leaked"


@contextmanager
def logging_as_on_the_server(settings: Settings) -> Iterator[None]:
    """`configure_logging` as at server start, when the root logger has no
    handler yet, so its stdout handler is the one installed. The test runner's
    own handlers are put back afterwards.

    A migration test earlier in the run reads alembic.ini through
    `logging.config.fileConfig`, which disables every logger that already
    exists, uvicorn's among them. The server never runs a migration in its own
    process, so its uvicorn loggers are on here as there; otherwise a line
    never written would pass for a line written clean.
    """
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    uvicorn_loggers = [logging.getLogger(name) for name in ("uvicorn.error", "uvicorn.access")]
    disabled = [named.disabled for named in uvicorn_loggers]
    root.handlers.clear()
    for named in uvicorn_loggers:
        named.disabled = False
    try:
        configure_logging(settings)
        yield
    finally:
        root.handlers[:] = handlers
        root.setLevel(level)
        for named, was_disabled in zip(uvicorn_loggers, disabled, strict=True):
            named.disabled = was_disabled


class _Transport(asyncio.Transport):
    """Just enough of a client connection for uvicorn's protocol."""

    def __init__(self) -> None:
        super().__init__()
        self.written = bytearray()
        self.closed = asyncio.Event()

    def get_extra_info(self, name: str, default: Any = None) -> Any:
        addresses = {"peername": ("172.18.0.5", 41234), "sockname": ("172.18.0.3", 8000)}
        return addresses.get(name, default)

    def write(self, data: bytes | bytearray | memoryview) -> None:
        self.written += data

    def close(self) -> None:
        self.closed.set()

    def is_closing(self) -> bool:
        return self.closed.is_set()

    def pause_reading(self) -> None:
        pass

    def resume_reading(self) -> None:
        pass


HTTP_PROTOCOLS = [
    "h11",
    pytest.param(
        "httptools",
        marks=pytest.mark.skipif(
            importlib.util.find_spec("httptools") is None, reason="httptools is not installed"
        ),
    ),
]


async def serve_one(app: Any, target: str, *, http: str, headers: str = "") -> bytes:
    """One request through uvicorn's HTTP protocol, as the server would run it.

    `http` picks the protocol: the image installs uvicorn[standard], so the
    server runs httptools; h11 is uvicorn's fallback.
    """
    config = uvicorn.Config(app, http=http, log_config=None, lifespan="off")
    config.load()
    protocol: Any = config.http_protocol_class(  # type: ignore[call-arg]
        config=config,
        server_state=ServerState(),
        app_state={},
        _loop=asyncio.get_running_loop(),
    )
    transport = _Transport()
    protocol.connection_made(transport)
    protocol.data_received(
        f"GET {target} HTTP/1.1\r\nHost: birka.test\r\n{headers}Connection: close\r\n\r\n".encode(
            "ascii"
        )
    )
    await asyncio.wait_for(transport.closed.wait(), timeout=10)
    protocol.connection_lost(None)
    return bytes(transport.written)


async def _ok(scope: dict[str, Any], receive: Callable[..., Any], send: Callable[..., Any]) -> None:
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"[]"})


@pytest.mark.parametrize("http", HTTP_PROTOCOLS)
async def test_the_access_line_keeps_the_path_but_not_the_query(
    http: str, capsys: pytest.CaptureFixture[str]
) -> None:
    with logging_as_on_the_server(Settings(log_json=True)):
        response = await serve_one(_ok, f"/api/v1/credits/customers?{SEARCH}", http=http)

    assert response.startswith(b"HTTP/1.1 200")
    out = capsys.readouterr().out
    # The line is still written, and still says who asked for what and how it
    # ended.
    assert '172.18.0.5:41234 - "GET /api/v1/credits/customers HTTP/1.1" 200' in out
    assert "?" not in out
    assert str(STORE_ID) not in out
    assert_no_customer(out)


def test_no_access_log_on_the_command_line_stays_off() -> None:
    """`uvicorn --no-access-log` is not switched back on at startup."""
    access = logging.getLogger("uvicorn.access")
    handlers, propagate = access.handlers[:], access.propagate
    try:
        uvicorn.Config("app.main:app", log_config=None, access_log=False)
        configure_logging(Settings())

        assert not access.hasHandlers()
    finally:
        access.handlers[:] = handlers
        access.propagate = propagate


async def test_a_traceback_on_stdout_leaves_out_the_refused_row(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """What uvicorn writes for an unhandled database error, as on the server."""
    error = refused_debt(hide_parameters=await engine_hides_parameters())

    with logging_as_on_the_server(Settings(log_json=True)):
        try:
            raise error from error.orig
        except sa_exc.IntegrityError as unhandled:
            logging.getLogger("uvicorn.error").error(
                "Exception in ASGI application\n", exc_info=unhandled
            )

    out = capsys.readouterr().out
    assert "Exception in ASGI application" in out
    assert "CheckViolationError" in out
    # The constraint still says what went wrong; the row does not say whose.
    assert "ck_customer_credit_amount_positive" in out
    assert "Failing row contains (values hidden)" in out
    assert "[SQL parameters hidden due to hide_parameters=True]" in out
    assert_no_customer(out)


async def test_a_traceback_structlog_writes_leaves_out_the_refused_row(
    capsys: pytest.CaptureFixture[str],
) -> None:
    error = refused_debt(hide_parameters=await engine_hides_parameters())

    with logging_as_on_the_server(Settings(log_json=True)):
        logger = get_logger("tests.privacy")
        try:
            raise error from error.orig
        except sa_exc.IntegrityError:
            logger.exception("credit.open_failed")

    out = capsys.readouterr().out
    assert "credit.open_failed" in out
    assert "Failing row contains (values hidden)" in out
    assert_no_customer(out)


async def test_the_engine_leaves_statement_values_out_of_its_errors() -> None:
    """The values sent with a statement never reach a database error's text.

    SQLAlchemy builds that text with its engine's `hide_parameters`, as here.
    """
    assert await engine_hides_parameters()

    error = refused_debt(hide_parameters=await engine_hides_parameters())

    assert "[SQL parameters hidden due to hide_parameters=True]" in str(error)
    assert "[parameters:" not in str(error)
    # The statement stays, for debugging.
    assert "INSERT INTO customer_credit" in str(error)
    # PostgreSQL's own DETAIL is not SQLAlchemy's to hide.
    assert NAME in str(error)
    assert_no_customer(redact_database_values(str(error)))


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        # CHECK and NOT NULL violations print the whole row.
        (
            'new row for relation "customer_credit" violates check constraint "x"\n'
            f"DETAIL:  {_REFUSED_ROW}\n[SQL: INSERT ...]",
            'new row for relation "customer_credit" violates check constraint "x"\n'
            "DETAIL:  Failing row contains (values hidden)\n[SQL: INSERT ...]",
        ),
        (
            'null value in column "customer_name" of relation "customer_credit" violates '
            f"not-null constraint\nDETAIL:  Failing row contains (1, null, {PHONE}).",
            'null value in column "customer_name" of relation "customer_credit" violates '
            "not-null constraint\nDETAIL:  Failing row contains (values hidden)",
        ),
        # Unique, foreign-key and exclusion violations print the key.
        (
            'duplicate key value violates unique constraint "uq_x"\n'
            f"DETAIL:  Key (organization_id, phone_digits)=(1, {DIGITS}) already exists.",
            'duplicate key value violates unique constraint "uq_x"\n'
            "DETAIL:  Key (organization_id, phone_digits)=(values hidden)",
        ),
        (
            f'DETAIL:  Key (customer_phone)=({PHONE}) is not present in table "customer".',
            "DETAIL:  Key (customer_phone)=(values hidden)",
        ),
        (
            f"DETAIL:  Key (lower(customer_name::text))=({NAME}) conflicts with existing key "
            f"(lower(customer_name::text))=({NAME}).",
            "DETAIL:  Key (lower(customer_name::text))=(values hidden)",
        ),
        # A value holding a line break is hidden to the end of the DETAIL,
        # up to SQLAlchemy's statement or the next chained exception.
        (
            "DETAIL:  Failing row contains (1, Ірина\nКоваль, +38 067\n123 45 67, -1).\n"
            "[SQL: INSERT ...]",
            "DETAIL:  Failing row contains (values hidden)\n[SQL: INSERT ...]",
        ),
        (
            "DETAIL:  Key (customer_phone)=(+38 067\n123 45 67) already exists.\n\n"
            "The above exception was the direct cause of the following exception:",
            "DETAIL:  Key (customer_phone)=(values hidden)\n\n"
            "The above exception was the direct cause of the following exception:",
        ),
        # Anything else is left as it was.
        (
            'duplicate key value violates unique constraint "uq_x"',
            'duplicate key value violates unique constraint "uq_x"',
        ),
        (
            "[SQL: INSERT INTO t (a, b) VALUES ($1, $2)]",
            "[SQL: INSERT INTO t (a, b) VALUES ($1, $2)]",
        ),
    ],
)
def test_postgresql_detail_values_are_hidden(text: str, expected: str) -> None:
    assert redact_database_values(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            f'1.2.3.4:5 - "GET /api/v1/credits?query={DIGITS} HTTP/1.1" 500',
            '1.2.3.4:5 - "GET /api/v1/credits HTTP/1.1" 500',
        ),
        (f"https://birka.test/api/v1/credits?{SEARCH}#top", "https://birka.test/api/v1/credits"),
        ("Is this the customer?", "Is this the customer?"),
    ],
)
def test_query_strings_are_cut_from_free_text(text: str, expected: str) -> None:
    assert without_query_strings(text) == expected
