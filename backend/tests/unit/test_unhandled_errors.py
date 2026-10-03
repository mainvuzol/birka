"""An error nothing handled: answered in JSON with its request id, and still
logged by uvicorn and reported by Sentry (`app/core/correlation.py`).

Before, Starlette's outermost middleware answered it with a bare-text 500
that never passed the middleware adding `X-Request-ID`, so the seller had
nothing to quote. Nothing here touches the database.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
import sentry_sdk
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.correlation import REQUEST_ID_HEADER
from app.core.errors import PermissionDeniedError
from app.main import create_app
from tests.unit.test_log_privacy import HTTP_PROTOCOLS, logging_as_on_the_server, serve_one
from tests.unit.test_sentry_privacy import MemoryTransport

SECRET = "unit-test-session-secret-at-least-32-bytes"
INTERNAL_ERROR = {"code": "INTERNAL_ERROR", "message": "Внутрішня помилка сервера.", "details": {}}


class BrokenError(RuntimeError):
    """What a bug raises."""


def _app(settings: Settings | None = None) -> FastAPI:
    app = create_app(settings or Settings(app_env="local", log_json=False, session_secret=SECRET))

    @app.get("/_test/crash")
    async def _crash() -> None:
        raise BrokenError("a bug")

    @app.get("/_test/refused")
    async def _refused() -> None:
        raise PermissionDeniedError("nope")

    @app.get("/_test/crash-mid-answer")
    async def _crash_mid_answer() -> StreamingResponse:
        async def body() -> AsyncIterator[bytes]:
            yield b"["
            raise BrokenError("half way")

        return StreamingResponse(body(), media_type="application/json")

    return app


def test_an_unhandled_error_answers_json_with_the_request_id() -> None:
    client = TestClient(_app(), raise_server_exceptions=False)

    response = client.get("/_test/crash")

    assert response.status_code == 500
    assert response.headers["content-type"] == "application/json"
    assert response.json() == INTERNAL_ERROR
    assert uuid.UUID(response.headers[REQUEST_ID_HEADER])


def test_the_request_id_is_the_one_the_logs_carry() -> None:
    client = TestClient(_app(), raise_server_exceptions=False)

    response = client.get("/_test/crash", headers={REQUEST_ID_HEADER: "crash-42"})

    assert response.headers[REQUEST_ID_HEADER] == "crash-42"


def test_the_error_still_goes_up_after_the_answer() -> None:
    """So the server writes its traceback; a test client re-raises it."""
    client = TestClient(_app())

    with pytest.raises(BrokenError):
        client.get("/_test/crash")


def test_a_refusal_is_answered_as_before() -> None:
    client = TestClient(_app())

    response = client.get("/_test/refused")

    assert response.status_code == 403
    assert response.json()["code"] == "PERMISSION_DENIED"
    assert REQUEST_ID_HEADER in response.headers


async def test_an_error_after_the_answer_began_is_not_answered_twice() -> None:
    """Once an answer has begun nothing else can be sent; the error only goes
    on up."""
    app = _app()
    sent: list[dict[str, Any]] = []
    asked = 0
    never = asyncio.Event()

    async def receive() -> dict[str, Any]:
        # The request, then a client that stays connected.
        nonlocal asked
        asked += 1
        if asked > 1:
            await never.wait()
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/_test/crash-mid-answer",
        "raw_path": b"/_test/crash-mid-answer",
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"birka.test")],
        "client": ("203.0.113.7", 50000),
        "server": ("birka.test", 80),
        "state": {},
    }
    with pytest.raises(BrokenError):
        await app(scope, receive, send)

    starts = [message for message in sent if message["type"] == "http.response.start"]
    assert len(starts) == 1
    assert starts[0]["status"] == 200


@pytest.mark.parametrize("http", HTTP_PROTOCOLS)
async def test_uvicorn_still_writes_the_traceback_and_a_line_names_the_request(
    http: str, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = Settings(app_env="local", log_json=True, session_secret=SECRET)
    app = _app(settings)

    with logging_as_on_the_server(settings):
        response = await serve_one(
            app, "/_test/crash?query=0671234567", http=http, headers="X-Request-ID: crash-7\r\n"
        )

    head, _, body = response.partition(b"\r\n\r\n")
    assert head.startswith(b"HTTP/1.1 500")
    assert b"x-request-id: crash-7" in head.lower()
    assert json.loads(body) == INTERNAL_ERROR

    out = capsys.readouterr().out
    assert "Exception in ASGI application" in out
    assert "BrokenError: a bug" in out
    [line] = [json.loads(row) for row in out.splitlines() if "request.unhandled_error" in row]
    assert line["request_id"] == "crash-7"
    assert line["error"] == "BrokenError"
    assert line["level"] == "error"
    # The path only: a query may hold a customer's name or phone.
    assert line["path"] == "/_test/crash"
    assert "0671234567" not in out


async def test_sentry_still_reports_it_with_the_request_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
        # Every integration on, as on the server; only the transport differs.
        return real_init(**kwargs, transport=transport)

    monkeypatch.setattr(sentry_sdk, "init", init_with_memory_transport)
    previous_client = sentry_sdk.get_global_scope().client
    with logging_as_on_the_server(settings):
        install_sentry(settings, component="api")
        client = sentry_sdk.get_client()
        try:
            with sentry_sdk.isolation_scope():
                response = await serve_one(
                    app, "/_test/crash", http="h11", headers="X-Request-ID: crash-sentry\r\n"
                )
            sentry_sdk.flush()
        finally:
            client.close()
            sentry_sdk.get_global_scope().set_client(previous_client)

    assert response.startswith(b"HTTP/1.1 500")
    [event] = transport.events
    assert event["exception"]["values"][-1]["type"] == "BrokenError"
    assert event["tags"]["request_id"] == "crash-sentry"
    assert event["tags"]["component"] == "api"
