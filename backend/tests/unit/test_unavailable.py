"""A request the server could not serve answers 503 `SERVER_UNAVAILABLE`,
never a 500 (ADR-0013 §2).

The phone reads a 503 as "the server does not answer" and tells the seller
to sell on paper (owner decision, 2026-10-04). So only the server's own
failures may answer it: the database does not answer, or its schema is
behind this code. A bug still answers 500 with its number, and only a bug
goes on to uvicorn and Sentry: an outage is told by the watcher (ADR-0011
§1). Nothing here touches the database; the same against real PostgreSQL is
in `tests/integration/test_server_unavailable.py`.
"""

from __future__ import annotations

import errno
import json
import socket
import uuid
from typing import Any

import pytest
import sentry_sdk
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import exc as sa_exc
from starlette.types import Receive, Scope, Send

from app.core.config import Settings
from app.core.correlation import REQUEST_ID_HEADER, CorrelationIdMiddleware
from app.core.unavailable import database_unreachable, schema_suspect
from app.main import create_app
from tests.unit.test_log_privacy import HTTP_PROTOCOLS, logging_as_on_the_server, serve_one
from tests.unit.test_sentry_privacy import MemoryTransport

SECRET = "unit-test-session-secret-at-least-32-bytes"
INTERNAL_ERROR = {"code": "INTERNAL_ERROR", "message": "Внутрішня помилка сервера.", "details": {}}
UNAVAILABLE = {
    "code": "SERVER_UNAVAILABLE",
    "message": "Сервер тимчасово недоступний.",
    "details": {"reason": "DATABASE"},
}


class PostgresError(Exception):
    """What asyncpg raises, and what SQLAlchemy's adapter carries: the
    SQLSTATE on the error, the server's text in its message."""

    def __init__(self, sqlstate: str, text: str = "") -> None:
        super().__init__(text)
        self.sqlstate = sqlstate


def wrapped(orig: BaseException, **flags: Any) -> sa_exc.DBAPIError:
    """As SQLAlchemy raises a database's error: its own, with the original
    under `orig` and as the cause."""
    error = sa_exc.DBAPIError("SELECT 1", None, orig, **flags)
    error.__cause__ = orig
    return error


def raised_from(error: BaseException, cause: BaseException) -> BaseException:
    try:
        try:
            raise cause
        except BaseException as inner:
            raise error from inner
    except BaseException as outer:
        return outer


def raised_while_handling(error: BaseException, first: BaseException) -> BaseException:
    """`error` raised while `first` was being handled, without `from`: what
    a cleanup that fails after the database stopped answering leaves."""
    try:
        try:
            raise first
        except BaseException:
            raise error  # noqa: B904 - the implicit context is the point
    except BaseException as outer:
        return outer


# --- which errors are the database --------------------------------------------------


@pytest.mark.parametrize(
    "error",
    [
        pytest.param(ConnectionRefusedError(errno.ECONNREFUSED, "refused"), id="refused"),
        pytest.param(ConnectionResetError(errno.ECONNRESET, "reset"), id="reset"),
        pytest.param(socket.gaierror(socket.EAI_NONAME, "no such name"), id="name"),
        pytest.param(TimeoutError(), id="timeout"),
        pytest.param(sa_exc.TimeoutError("QueuePool limit reached"), id="pool"),
        pytest.param(
            wrapped(Exception("connection lost"), connection_invalidated=True), id="invalidated"
        ),
        pytest.param(PostgresError("08006"), id="connection-failure"),
        pytest.param(PostgresError("08001"), id="cannot-connect"),
        pytest.param(PostgresError("57P01"), id="admin-shutdown"),
        pytest.param(PostgresError("57P02"), id="crash-shutdown"),
        pytest.param(PostgresError("57P03"), id="starting-up"),
        pytest.param(PostgresError("53300"), id="too-many-connections"),
        pytest.param(PostgresError("53100"), id="disk-full"),
        pytest.param(wrapped(PostgresError("57P03")), id="wrapped"),
        pytest.param(
            raised_from(RuntimeError("while opening"), ConnectionRefusedError()), id="as-cause"
        ),
        pytest.param(
            raised_while_handling(RuntimeError("while closing"), ConnectionRefusedError()),
            id="as-context",
        ),
    ],
)
def test_the_database_not_answering_is_told_apart(error: BaseException) -> None:
    assert database_unreachable(error)
    assert not schema_suspect(error)


@pytest.mark.parametrize(
    "error",
    [
        pytest.param(PostgresError("23505"), id="unique-violation"),
        pytest.param(wrapped(PostgresError("23505")), id="wrapped-unique-violation"),
        # A statement cancelled by its own limit ran too long: a request, not
        # a server that is down.
        pytest.param(PostgresError("57014"), id="statement-timeout"),
        pytest.param(ValueError("a bug"), id="bug"),
        # Any other `OSError` is not the database: a file, say.
        pytest.param(FileNotFoundError(errno.ENOENT, "no such file"), id="file"),
        pytest.param(OSError("read failed"), id="os-error"),
        pytest.param(PostgresError(None), id="no-sqlstate"),  # type: ignore[arg-type]
    ],
)
def test_anything_else_is_not_the_database(error: BaseException) -> None:
    assert not database_unreachable(error)
    assert not schema_suspect(error)


@pytest.mark.parametrize("sqlstate", ["42P01", "42703", "42883"])
def test_an_undefined_name_only_suspects_the_schema(sqlstate: str) -> None:
    """What code newer than its schema meets, and equally what a bug meets:
    the readiness check decides which."""
    for error in (PostgresError(sqlstate), wrapped(PostgresError(sqlstate))):
        assert schema_suspect(error)
        assert not database_unreachable(error)


def test_only_a_few_steps_down_the_causes_are_read() -> None:
    error: BaseException = ConnectionRefusedError()
    for depth in range(1, 8):
        error = raised_from(RuntimeError(f"step {depth}"), error)
        assert database_unreachable(error) is (depth <= 5)


def test_a_cause_that_loops_is_read_once() -> None:
    first, second = RuntimeError("first"), ValueError("second")
    first.__context__, second.__context__ = second, first

    assert not database_unreachable(first)


# --- what the request is answered -----------------------------------------------------


def _app(settings: Settings | None = None) -> FastAPI:
    app = create_app(settings or Settings(app_env="local", log_json=False, session_secret=SECRET))

    @app.get("/_test/database-gone")
    async def _database_gone() -> None:
        # The text names the host: it must reach neither the answer nor the log.
        raise ConnectionRefusedError(
            errno.ECONNREFUSED, "Connect call failed ('db.internal', 5432)"
        )

    @app.get("/_test/undefined-column")
    async def _undefined_column() -> None:
        raise wrapped(PostgresError("42703", 'column "outage_sold_at" does not exist'))

    @app.get("/_test/crash")
    async def _crash() -> None:
        raise RuntimeError("a bug")

    return app


def test_the_database_not_answering_is_answered_503_with_the_request_id() -> None:
    client = TestClient(_app(), raise_server_exceptions=False)

    response = client.get("/_test/database-gone", headers={REQUEST_ID_HEADER: "outage-1"})

    assert response.status_code == 503
    assert response.headers["content-type"] == "application/json"
    assert response.json() == UNAVAILABLE
    assert response.headers[REQUEST_ID_HEADER] == "outage-1"


def test_it_goes_no_further() -> None:
    """Answered and told, not raised: a test client re-raises what goes on
    up, as uvicorn writes its traceback and Sentry reports it."""
    client = TestClient(_app())

    response = client.get("/_test/database-gone")

    assert response.status_code == 503
    assert uuid.UUID(response.headers[REQUEST_ID_HEADER])


def test_a_bug_is_still_a_500_and_goes_on_up() -> None:
    client = TestClient(_app(), raise_server_exceptions=False)

    response = client.get("/_test/crash")

    assert (response.status_code, response.json()) == (500, INTERNAL_ERROR)
    with pytest.raises(RuntimeError):
        TestClient(_app()).get("/_test/crash")


def test_an_undefined_column_is_a_500_unless_the_schema_is_behind() -> None:
    """Without the readiness check's word, nothing proves a migration was not
    run: here no database is set up to ask, so it stays a bug with its
    number. The schema behind is proved against PostgreSQL."""
    client = TestClient(_app(), raise_server_exceptions=False)

    response = client.get("/_test/undefined-column")

    assert (response.status_code, response.json()) == (500, INTERNAL_ERROR)
    assert REQUEST_ID_HEADER in response.headers


def test_a_failure_to_tell_is_answered_as_before() -> None:
    """A classifier that breaks never leaves the request unanswered."""

    async def database_gone(_scope: Scope, _receive: Receive, _send: Send) -> None:
        raise ConnectionRefusedError(errno.ECONNREFUSED, "refused")

    async def broken(_error: BaseException) -> None:
        raise RuntimeError("the classifier broke")

    client = TestClient(
        CorrelationIdMiddleware(database_gone, unavailable=broken),
        raise_server_exceptions=False,
    )

    response = client.get("/")

    assert (response.status_code, response.json()) == (500, INTERNAL_ERROR)
    assert REQUEST_ID_HEADER in response.headers


@pytest.mark.parametrize("http", HTTP_PROTOCOLS)
async def test_one_warning_line_says_why_and_never_the_errors_text(
    http: str, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = Settings(app_env="local", log_json=True, session_secret=SECRET)
    app = _app(settings)

    with logging_as_on_the_server(settings):
        response = await serve_one(
            app,
            "/_test/database-gone?query=0671234567",
            http=http,
            headers="X-Request-ID: outage-7\r\n",
        )

    head, _, body = response.partition(b"\r\n\r\n")
    assert head.startswith(b"HTTP/1.1 503")
    assert b"x-request-id: outage-7" in head.lower()
    assert json.loads(body) == UNAVAILABLE

    out = capsys.readouterr().out
    # No traceback: it did not go on up.
    assert "Exception in ASGI application" not in out
    assert "request.unhandled_error" not in out
    [line] = [json.loads(row) for row in out.splitlines() if "request.unavailable" in row]
    assert line["level"] == "warning"
    assert line["request_id"] == "outage-7"
    assert (line["reason"], line["error"]) == ("DATABASE", "ConnectionRefusedError")
    assert (line["method"], line["path"]) == ("GET", "/_test/database-gone")
    # Neither the host the error names nor the query.
    assert "db.internal" not in out
    assert "0671234567" not in out


async def test_sentry_is_not_told(monkeypatch: pytest.MonkeyPatch) -> None:
    """An outage fails every request; the watcher tells of it once."""
    from app.core.sentry import install_sentry

    settings = Settings(
        app_env="local",
        log_json=True,
        session_secret=SECRET,
        sentry_dsn="https://public@example.invalid/1",
    )
    app = _app(settings)
    transport = MemoryTransport()
    real_init = sentry_sdk.init

    def init_with_memory_transport(**kwargs: Any) -> Any:
        return real_init(**kwargs, transport=transport)

    monkeypatch.setattr(sentry_sdk, "init", init_with_memory_transport)
    previous_client = sentry_sdk.get_global_scope().client
    with logging_as_on_the_server(settings):
        install_sentry(settings, component="api")
        client = sentry_sdk.get_client()
        try:
            with sentry_sdk.isolation_scope():
                outage = await serve_one(app, "/_test/database-gone", http="h11")
            with sentry_sdk.isolation_scope():
                bug = await serve_one(app, "/_test/crash", http="h11")
            sentry_sdk.flush()
        finally:
            client.close()
            sentry_sdk.get_global_scope().set_client(previous_client)

    assert outage.startswith(b"HTTP/1.1 503")
    assert bug.startswith(b"HTTP/1.1 500")
    # Only the bug was reported.
    [event] = transport.events
    assert event["exception"]["values"][-1]["type"] == "RuntimeError"
