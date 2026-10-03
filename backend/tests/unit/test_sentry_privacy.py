"""Credentials and customers' personal data must stay out of real Sentry events."""

from __future__ import annotations

import json
import logging
from typing import Any
from unittest.mock import AsyncMock

import pytest
import sentry_sdk
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.telegram import TelegramAPIServer
from aiohttp import web
from scripts.backup_watch import ping
from sentry_sdk.envelope import Envelope
from sentry_sdk.integrations.aiohttp import AioHttpIntegration
from sentry_sdk.transport import Transport

from app.api.deps import get_current_scope
from app.core import db
from app.core.config import Settings
from app.core.sentry import install_sentry
from app.main import create_app
from app.modules.identity.service import authenticate_with_init_data
from app.modules.telegram.messages import check_bot
from tests.conftest import TEST_BOT_TOKEN, build_init_data
from tests.unit.test_log_privacy import (
    BOT_TOKEN,
    DIGITS,
    HTTP_PROTOCOLS,
    NAME,
    PHONE,
    SEARCH,
    STORE_ID,
    TELEGRAM_CALL,
    assert_no_customer,
    engine_hides_parameters,
    logging_as_on_the_server,
    refused_debt,
    serve_one,
)


class MemoryTransport(Transport):
    """Collect the final serialized event without opening a network connection."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[dict[str, Any]] = []

    def capture_envelope(self, envelope: Envelope) -> None:
        for item in envelope.items:
            if item.type == "event":
                self.events.append(json.loads(item.get_bytes()))


@pytest.mark.asyncio
async def test_auth_exception_event_does_not_expose_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = MemoryTransport()
    real_init = sentry_sdk.init

    def init_with_memory_transport(**kwargs: Any) -> Any:
        # Exercise the application's complete configuration. Only transport
        # and process-wide integrations are replaced for this isolated test.
        return real_init(**kwargs, transport=transport, default_integrations=False)

    monkeypatch.setattr(sentry_sdk, "init", init_with_memory_transport)
    previous_client = sentry_sdk.get_global_scope().client
    settings = Settings(
        sentry_dsn="https://public@example.invalid/1",
        telegram_bot_token=TEST_BOT_TOKEN,
        session_secret="privacy-test-session-secret-at-least-32-bytes",
    )
    install_sentry(settings, component="api")
    client = sentry_sdk.get_client()
    try:
        with sentry_sdk.isolation_scope() as scope:
            scope.set_tag("request_id", "privacy-regression")
            init_data = build_init_data()
            # Keep both a plain argument and a nested copy alive in traceback
            # locals, as a router's parsed request would be during a DB outage.
            payload = {"nested": {"init_data": init_data}}
            session = AsyncMock()
            session.execute.side_effect = RuntimeError("database unavailable")
            try:
                await authenticate_with_init_data(
                    session, init_data=payload["nested"]["init_data"], settings=settings
                )
            except RuntimeError:
                sentry_sdk.capture_exception()

        assert len(transport.events) == 1
        event = transport.events[0]
        serialized = json.dumps(event)
        assert init_data not in serialized
        assert TEST_BOT_TOKEN not in serialized
        assert settings.session_secret.get_secret_value() not in serialized
        assert event["tags"]["request_id"] == "privacy-regression"
        exception = event["exception"]["values"][-1]
        assert exception["type"] == "RuntimeError"
        assert exception["value"] == "database unavailable"
        frames = exception["stacktrace"]["frames"]
        assert any(frame["function"] == "authenticate_with_init_data" for frame in frames)
        assert all("vars" not in frame for frame in frames)
    finally:
        client.close()
        sentry_sdk.get_global_scope().set_client(previous_client)


def _install_memory_sentry(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> MemoryTransport:
    """The application's own Sentry configuration, every integration on, as in
    production; only the transport is replaced, so nothing leaves the test."""
    transport = MemoryTransport()
    real_init = sentry_sdk.init

    def init_with_memory_transport(**kwargs: Any) -> Any:
        return real_init(**kwargs, transport=transport)

    monkeypatch.setattr(sentry_sdk, "init", init_with_memory_transport)
    install_sentry(settings, component="api")
    return transport


@pytest.mark.parametrize("http", HTTP_PROTOCOLS)
async def test_a_failed_debt_search_reaches_sentry_and_the_log_without_the_customer(
    http: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A debt search by name and phone that ends in an unhandled database error.

    The search text is in the query string, and the error repeats a debt's row
    with the customer's name and phone. Neither reaches the access line, the
    traceback on stdout, the Sentry event or its breadcrumbs. The event keeps
    the request id, so it can still be found in the log.
    """
    settings = Settings(
        sentry_dsn="https://public@example.invalid/1",
        session_secret="privacy-test-session-secret-at-least-32-bytes",
        log_json=True,
    )
    hide_parameters = await engine_hides_parameters()
    app = create_app(settings)

    def refusing_sessionmaker() -> Any:
        def open_session() -> Any:
            error = refused_debt(hide_parameters=hide_parameters)
            raise error from error.orig

        return open_session

    # The database refuses whatever this request does; who the caller is does
    # not matter here.
    monkeypatch.setattr(db, "get_sessionmaker", refusing_sessionmaker)
    app.dependency_overrides[get_current_scope] = lambda: None

    previous_client = sentry_sdk.get_global_scope().client
    with logging_as_on_the_server(settings):
        transport = _install_memory_sentry(monkeypatch, settings)
        client = sentry_sdk.get_client()
        try:
            with sentry_sdk.isolation_scope():
                response = await serve_one(
                    app,
                    f"/api/v1/credits/customers?{SEARCH}&elsewhere=true",
                    http=http,
                    headers="Authorization: Bearer x\r\nX-Request-ID: privacy-500\r\n",
                )
            sentry_sdk.flush()
        finally:
            client.close()
            sentry_sdk.get_global_scope().set_client(previous_client)

    assert response.startswith(b"HTTP/1.1 500")

    out = capsys.readouterr().out
    assert '"GET /api/v1/credits/customers HTTP/1.1" 500' in out
    assert "Exception in ASGI application" in out
    assert "Failing row contains (values hidden)" in out
    assert_no_customer(out)

    assert transport.events
    for event in transport.events:
        serialized = json.dumps(event, ensure_ascii=False)
        assert_no_customer(serialized)
        assert str(STORE_ID) not in serialized
        assert event["tags"]["request_id"] == "privacy-500"
    reported = transport.events[0]
    assert "query_string" not in reported["request"]
    assert reported["request"]["url"] == "http://birka.test/api/v1/credits/customers"
    error = reported["exception"]["values"][-1]
    assert error["type"] == "IntegrityError"
    assert "ck_customer_credit_amount_positive" in error["value"]
    assert "Failing row contains (values hidden)" in error["value"]
    # The request's own access line is in the trail, without its query.
    trail = [crumb.get("message") or "" for crumb in reported["breadcrumbs"]["values"]]
    assert any('"GET /api/v1/credits/customers HTTP/1.1" 500' in line for line in trail)


def test_breadcrumbs_lose_their_query_strings() -> None:
    from app.core.sentry import scrub_breadcrumb

    logged = scrub_breadcrumb(
        {
            "category": "app",
            "message": f"retrying /api/v1/credits/customers?{SEARCH}",
            "data": {"note": f"/api/v1/credits?query={DIGITS}"},
        },
        {},
    )
    called = scrub_breadcrumb(
        {
            "category": "httplib",
            "data": {
                "url": "https://api.telegram.org/bot/sendMessage",
                "http.method": "POST",
                "http.query": f"query={DIGITS}",
                "http.fragment": NAME,
            },
        },
        {},
    )

    assert logged["message"] == "retrying /api/v1/credits/customers"
    assert logged["data"] == {"note": "/api/v1/credits"}
    assert called["data"] == {"url": "https://api.telegram.org", "http.method": "POST"}


def test_a_breadcrumb_keeps_only_the_scheme_and_host_of_an_address() -> None:
    """An address's path can be a secret: the bot's token in Telegram's, the
    whole of the check-in's (`BIRKA_HEARTBEAT_URL`)."""
    from app.core.sentry import scrub_breadcrumb

    called = scrub_breadcrumb(
        {
            "type": "http",
            "category": "httplib",
            "message": f"POST {TELEGRAM_CALL}",
            "data": {
                "url": TELEGRAM_CALL,
                "heartbeat": "https://hc-ping.com/0b0b5e1c-secret",
                "database": "postgresql+asyncpg://birka:pa55word@db:5432/birka",
                "path": f"/bot{BOT_TOKEN}/getMe?offset=1",
                "status_code": 200,
            },
        },
        {},
    )
    relative = scrub_breadcrumb({"data": {"url": f"/bot{BOT_TOKEN}/getMe?offset=1"}}, {})

    assert called == {
        "type": "http",
        "category": "httplib",
        "message": "POST https://api.telegram.org/bot(token hidden)/getMe",
        "data": {
            "url": "https://api.telegram.org",
            "heartbeat": "https://hc-ping.com",
            "database": "postgresql+asyncpg://db:5432",
            "path": "/bot(token hidden)/getMe",
            "status_code": 200,
        },
    }
    assert relative["data"] == {"url": "/bot(token hidden)/getMe"}


def test_the_event_scrubber_cuts_the_bot_token() -> None:
    from app.core.sentry import scrub_event

    scrubbed = scrub_event(
        {
            "message": f"giving up on {TELEGRAM_CALL}",
            "exception": {
                "values": [
                    {"type": "TelegramNetworkError", "value": f"InvalidURL: {TELEGRAM_CALL}"}
                ]
            },
            "logentry": {"message": "%s failed", "formatted": f"{TELEGRAM_CALL} failed"},
        },
        {},
    )

    assert BOT_TOKEN not in json.dumps(scrubbed)
    assert scrubbed["exception"]["values"][0]["value"] == (
        "InvalidURL: https://api.telegram.org/bot(token hidden)/getMe"
    )


async def test_the_watchers_calls_reach_sentry_without_the_bot_token_or_the_check_in_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The watcher as on the server: Sentry with every default integration,
    the bot asking Telegram `getMe`, a check-in, then an error. Neither the
    token nor the check-in's address is anywhere in the event."""
    secret = "0b0b5e1c-7d2a-4f3e-9c1b-secret"
    paths: list[str] = []

    async def answer(request: web.Request) -> web.Response:
        paths.append(request.path)
        if request.path.endswith("/getMe"):
            bot = {"id": 123456, "is_bot": True, "first_name": "Birka"}
            return web.json_response({"ok": True, "result": bot})
        return web.Response(text="OK")

    app = web.Application()
    app.router.add_route("*", "/{tail:.*}", answer)
    # The test's own server logs no access lines: on the server the watcher
    # only calls out.
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", 0).start()
    base = f"http://127.0.0.1:{runner.addresses[0][1]}"

    transport = MemoryTransport()
    given: dict[str, Any] = {}
    real_init = sentry_sdk.init

    def init_with_memory_transport(**kwargs: Any) -> Any:
        given.update(kwargs)
        return real_init(**kwargs, transport=transport)

    monkeypatch.setattr(sentry_sdk, "init", init_with_memory_transport)
    previous_client = sentry_sdk.get_global_scope().client
    install_sentry(
        Settings(sentry_dsn="https://public@example.invalid/1"), component="backup-watch"
    )
    client = sentry_sdk.get_client()
    try:
        with sentry_sdk.isolation_scope():
            telegram = AiohttpSession(api=TelegramAPIServer.from_base(base))
            await check_bot(BOT_TOKEN, session=telegram)
            await ping(f"{base}/{secret}")
            logging.getLogger("tests.privacy.watch").warning("asked %s", TELEGRAM_CALL)
            try:
                raise RuntimeError(f"Telegram unreachable: {base}/bot{BOT_TOKEN}/sendMessage")
            except RuntimeError:
                sentry_sdk.capture_exception()
        sentry_sdk.flush()
    finally:
        client.close()
        sentry_sdk.get_global_scope().set_client(previous_client)
        await runner.cleanup()

    assert paths == [f"/bot{BOT_TOKEN}/getMe", f"/{secret}"]
    assert AioHttpIntegration in given["disabled_integrations"]
    (event,) = transport.events
    serialized = json.dumps(event, ensure_ascii=False)
    assert event["tags"]["component"] == "backup-watch"
    assert BOT_TOKEN not in serialized
    assert "AAHsecret" not in serialized
    assert secret not in serialized
    assert event["exception"]["values"][-1]["value"] == (
        f"Telegram unreachable: {base}/bot(token hidden)/sendMessage"
    )
    trail = [crumb.get("message") for crumb in event["breadcrumbs"]["values"]]
    assert "asked https://api.telegram.org/bot(token hidden)/getMe" in trail


def test_the_event_scrubber_cuts_queries_and_database_values() -> None:
    from app.core.sentry import scrub_event

    event = {
        "request": {
            "url": f"https://birka.test/api/v1/credits/customers?{SEARCH}",
            "query_string": SEARCH,
            "headers": {"Referer": f"https://birka.test/?{SEARCH}", "User-Agent": "tg"},
        },
        "exception": {
            "values": [
                {
                    "type": "CheckViolationError",
                    "value": f"x\nDETAIL:  Key (customer_phone)=({PHONE})",
                }
            ]
        },
        "logentry": {
            "message": "search failed: %s",
            "formatted": f"search failed: Key (phone_digits)=({DIGITS}) already exists.",
            "params": [DIGITS],
        },
    }

    scrubbed = scrub_event(event, {})

    assert scrubbed["request"] == {
        "url": "https://birka.test/api/v1/credits/customers",
        "headers": {"Referer": "https://birka.test/", "User-Agent": "tg"},
    }
    assert scrubbed["exception"]["values"][0]["value"] == (
        "x\nDETAIL:  Key (customer_phone)=(values hidden)"
    )
    assert scrubbed["logentry"] == {
        "message": "search failed: %s",
        "formatted": "search failed: Key (phone_digits)=(values hidden)",
    }
    assert_no_customer(json.dumps(scrubbed, ensure_ascii=False))


def test_the_application_scrubs_every_breadcrumb(monkeypatch: pytest.MonkeyPatch) -> None:
    """A log line with a URL in it, from any logger, reaches the event's trail
    without the URL's query."""
    previous_client = sentry_sdk.get_global_scope().client
    transport = _install_memory_sentry(
        monkeypatch, Settings(sentry_dsn="https://public@example.invalid/1")
    )
    client = sentry_sdk.get_client()
    try:
        with sentry_sdk.isolation_scope():
            logging.getLogger("app.privacy").warning(
                "slow response for /api/v1/credits/customers?%s", SEARCH
            )
            sentry_sdk.capture_message("boom")
        sentry_sdk.flush()
    finally:
        client.close()
        sentry_sdk.get_global_scope().set_client(previous_client)

    (event,) = transport.events
    trail = [crumb.get("message") for crumb in event["breadcrumbs"]["values"]]
    assert "slow response for /api/v1/credits/customers" in trail
    assert_no_customer(json.dumps(event, ensure_ascii=False))
