"""A note from a broken screen (`POST /api/v1/client-errors`, owner decision
2026-10-03): one line in the server's log, nothing stored, nothing sent.

The note never holds a name, a phone, what was typed or the Telegram number;
these tests prove what the server cuts from the free text it is given. No
session and no database are involved: a screen can break before sign-in.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import sentry_sdk
from fastapi import FastAPI

from app.api.v1 import client_errors
from app.core.config import Settings
from app.core.rate_limit import TokenBucket
from app.main import create_app
from tests.unit.test_log_privacy import NAME, PHONE, logging_as_on_the_server
from tests.unit.test_rate_limit import Clock
from tests.unit.test_rate_limit import _app as sign_in_app
from tests.unit.test_rate_limit import _sign_in as sign_in
from tests.unit.test_sentry_privacy import MemoryTransport

SECRET = "unit-test-session-secret-at-least-32-bytes"


class Recorder:
    """The module's logger, as calls: what the line holds, whatever the
    renderer makes of it."""

    def __init__(self) -> None:
        self.lines: list[tuple[str, str, dict[str, Any]]] = []

    def __getattr__(self, level: str) -> Any:
        def write(event: str, **fields: Any) -> None:
            self.lines.append((level, event, fields))

        return write


@pytest.fixture
def logged(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    recorder = Recorder()
    monkeypatch.setattr(client_errors, "logger", recorder)
    return recorder


def _app(**settings: Any) -> FastAPI:
    return create_app(Settings(app_env="local", log_json=True, session_secret=SECRET, **settings))


def note(**fields: Any) -> dict[str, Any]:
    return {
        "kind": "render",
        "screen": "sale",
        "name": "TypeError",
        "message": "Cannot read properties of undefined (reading 'lines')",
        "release": "abc1234",
        "request_id": "5d0c6c7e-8f7a-4a52-9a0b-0c2f8d1e7b11",
    } | fields


async def send(
    app: FastAPI,
    body: Any = None,
    *,
    content: bytes | None = None,
    headers: dict[str, str] | None = None,
    address: str = "203.0.113.7",
) -> httpx.Response:
    transport = httpx.ASGITransport(app=app, client=(address, 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        if content is not None:
            return await client.post(
                "/api/v1/client-errors", content=content, headers=headers or {}
            )
        return await client.post("/api/v1/client-errors", json=body, headers=headers or {})


async def test_a_note_is_one_warning_line_and_no_answer(logged: Recorder) -> None:
    response = await send(_app(), note())

    assert response.status_code == 204
    assert response.content == b""
    assert logged.lines == [
        (
            "warning",
            "client.error",
            {
                "kind": "render",
                "screen": "sale",
                "name": "TypeError",
                "message": "Cannot read properties of undefined (reading 'lines')",
                "release": "abc1234",
                "client_request_id": "5d0c6c7e-8f7a-4a52-9a0b-0c2f8d1e7b11",
            },
        )
    ]


async def test_no_session_is_needed_and_nothing_else_is_asked(logged: Recorder) -> None:
    """Before sign-in there is no token; extra fields are ignored."""
    response = await send(
        _app(), note(kind="rejection", request_id=None, user={"id": 777000}, url="/#tgWebAppData")
    )

    assert response.status_code == 204
    [(_, _, fields)] = logged.lines
    assert fields["kind"] == "rejection"
    assert fields["client_request_id"] is None
    assert "user" not in fields and "url" not in fields


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        (f"no debt for {PHONE}", "no debt for [число]"),
        ("Telegram 123456789 has no access", "Telegram [число] has no access"),
        ("+380671234567", "[число]"),
        ("067-123-45-67 and 0671234567", "[число] and [число]"),
        # Short numbers say what went wrong and stay.
        ("line 12 of 345, status 500", "line 12 of 345, status 500"),
        (
            "GET /api/v1/credits/customers?query=Ірина failed",
            "GET /api/v1/credits/customers failed",
        ),
        (
            f"DETAIL:  Key (customer_phone)=({PHONE}) already exists.",
            "DETAIL:  Key (customer_phone)=(values hidden)",
        ),
    ],
)
async def test_values_are_cut_from_the_message(
    logged: Recorder, message: str, expected: str
) -> None:
    await send(_app(), note(message=message))

    [(_, _, fields)] = logged.lines
    assert fields["message"] == expected


async def test_long_fields_are_cut_not_refused(logged: Recorder) -> None:
    response = await send(
        _app(),
        note(screen="s" * 100, name="N" * 100, message="m" * 1000, release="r" * 100),
    )

    assert response.status_code == 204
    [(_, _, fields)] = logged.lines
    assert fields["screen"] == "s" * 40
    assert fields["name"] == "N" * 80
    assert fields["message"] == "m" * 500
    assert fields["release"] == "r" * 40


async def test_a_number_is_cut_before_the_message_is(logged: Recorder) -> None:
    """Cutting first could leave half a phone, short enough to stay."""
    await send(_app(), note(message="x" * 495 + "0671234567"))

    [(_, _, fields)] = logged.lines
    assert fields["message"] == "x" * 495 + "[числ"
    assert "06712" not in fields["message"]


@pytest.mark.parametrize(
    "request_id",
    ["x" * 65, "has space", "semi;colon", "кирилиця", "", "a\nb"],
)
async def test_a_request_id_that_cannot_be_ours_is_dropped(
    logged: Recorder, request_id: str
) -> None:
    response = await send(_app(), note(request_id=request_id))

    assert response.status_code == 204
    [(_, _, fields)] = logged.lines
    assert fields["client_request_id"] is None


async def test_a_request_id_of_ours_is_kept(logged: Recorder) -> None:
    await send(_app(), note(request_id="crash-7.A_b"))

    [(_, _, fields)] = logged.lines
    assert fields["client_request_id"] == "crash-7.A_b"


async def test_a_body_over_4096_bytes_is_refused(logged: Recorder) -> None:
    big = json.dumps(note(message="m" * 5000)).encode()

    said = await send(_app(), content=big, headers={"Content-Type": "application/json"})

    assert said.status_code == 413
    assert said.json()["code"] == "PAYLOAD_TOO_LARGE"
    assert logged.lines == []


async def test_a_body_that_does_not_say_its_length_is_refused_past_4096(
    logged: Recorder,
) -> None:
    async def chunks() -> AsyncIterator[bytes]:
        for _ in range(5):
            yield b" " * 1000
        yield json.dumps(note()).encode()

    transport = httpx.ASGITransport(app=_app(), client=("203.0.113.7", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        said = await client.post("/api/v1/client-errors", content=chunks())

    assert said.status_code == 413
    assert logged.lines == []


async def test_a_body_of_exactly_4096_bytes_is_taken(logged: Recorder) -> None:
    body = json.dumps(note()).encode()
    padded = body + b" " * (4096 - len(body))

    said = await send(_app(), content=padded, headers={"Content-Type": "application/json"})

    assert said.status_code == 204
    assert len(logged.lines) == 1


@pytest.mark.parametrize(
    "body",
    [
        note(kind="other"),
        {key: value for key, value in note().items() if key != "screen"},
        note(message=None),
        note(name=123),
    ],
)
async def test_a_note_not_shaped_as_one_is_refused(logged: Recorder, body: Any) -> None:
    said = await send(_app(), body)

    assert said.status_code == 422
    assert said.json()["detail"][0]["loc"][0] == "body"
    assert logged.lines == []


async def test_a_body_that_is_not_json_is_refused(logged: Recorder) -> None:
    said = await send(_app(), content=b"not json", headers={"Content-Type": "text/plain"})

    assert said.status_code == 422
    assert logged.lines == []


async def test_a_text_plain_beacon_is_taken(logged: Recorder) -> None:
    """`navigator.sendBeacon` with a string sends text/plain."""
    said = await send(
        _app(), content=json.dumps(note()).encode(), headers={"Content-Type": "text/plain"}
    )

    assert said.status_code == 204
    assert len(logged.lines) == 1


async def test_notes_past_the_address_limit_are_refused(logged: Recorder) -> None:
    app = _app(client_errors_per_minute=10, client_error_burst=2)

    taken = [await send(app, note()) for _ in range(2)]
    refused = await send(app, note())

    assert [said.status_code for said in taken] == [204, 204]
    assert refused.status_code == 429
    assert refused.json()["code"] == "RATE_LIMITED"
    assert refused.json()["details"] == {"retry_after": 6}
    assert refused.headers["Retry-After"] == "6"
    assert len(logged.lines) == 2
    # Another address has its own; and a large body is limited too, before
    # it is read.
    assert (await send(app, note(), address="198.51.100.20")).status_code == 204
    over = await send(app, content=b"x" * 5000)
    assert over.status_code == 429


async def test_the_notes_limit_is_not_the_sign_in_limit(logged: Recorder) -> None:
    app = sign_in_app()
    app.state.client_error_bucket = TokenBucket(per_minute=1, burst=1, clock=Clock())

    assert (await send(app, note())).status_code == 204
    assert (await send(app, note())).status_code == 429
    # The same address still signs in: refused for what it carries, not held.
    assert (await sign_in(app, "203.0.113.7")).json()["code"] == "INVALID_INIT_DATA"


async def test_the_default_limit_is_ten_at_once(logged: Recorder) -> None:
    app = _app()

    said = [(await send(app, note())).status_code for _ in range(11)]

    assert said == [204] * 10 + [429]


async def test_the_line_on_the_server_and_nothing_to_sentry(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Owner decision, 2026-10-03: the note goes to the server's log only,
    even with Sentry on. Written as the server writes it."""
    from app.core.sentry import install_sentry

    settings = Settings(
        app_env="local",
        log_json=True,
        session_secret=SECRET,
        sentry_dsn="https://public@example.invalid/1",
    )
    app = create_app(settings)
    transport = MemoryTransport()
    real_init = sentry_sdk.init

    def init_with_memory_transport(**kwargs: Any) -> Any:
        return real_init(**kwargs, transport=transport)

    monkeypatch.setattr(sentry_sdk, "init", init_with_memory_transport)
    previous_client = sentry_sdk.get_global_scope().client
    with logging_as_on_the_server(settings):
        # The module's logger as the server has it: taken after logging is
        # set up (`app.core.logging.get_logger`).
        from app.core.logging import get_logger

        monkeypatch.setattr(client_errors, "logger", get_logger(client_errors.__name__))
        install_sentry(settings, component="api")
        client = sentry_sdk.get_client()
        try:
            with sentry_sdk.isolation_scope():
                said = await send(
                    app,
                    note(message=f"{NAME} {PHONE}"),
                    headers={"X-Request-ID": "note-1"},
                )
            sentry_sdk.flush()
        finally:
            client.close()
            sentry_sdk.get_global_scope().set_client(previous_client)

    assert said.status_code == 204
    assert transport.events == []
    [line] = [
        json.loads(row) for row in capsys.readouterr().out.splitlines() if "client.error" in row
    ]
    assert line["event"] == "client.error"
    assert line["level"] == "warning"
    assert line["request_id"] == "note-1"
    assert line["client_request_id"] == "5d0c6c7e-8f7a-4a52-9a0b-0c2f8d1e7b11"
    assert PHONE not in json.dumps(line, ensure_ascii=False)
