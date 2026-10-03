"""Credentials and customers' personal data must stay out of real Sentry events."""

from __future__ import annotations

import json
import logging
from typing import Any
from unittest.mock import AsyncMock

import pytest
import sentry_sdk
from sentry_sdk.envelope import Envelope
from sentry_sdk.transport import Transport

from app.api.deps import get_current_scope
from app.core import db
from app.core.config import Settings
from app.main import _install_sentry, create_app
from app.modules.identity.service import authenticate_with_init_data
from tests.conftest import TEST_BOT_TOKEN, build_init_data
from tests.unit.test_log_privacy import (
    DIGITS,
    HTTP_PROTOCOLS,
    NAME,
    PHONE,
    SEARCH,
    STORE_ID,
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
    _install_sentry(settings)
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
    _install_sentry(settings)
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
    from app.main import _scrub_breadcrumb

    logged = _scrub_breadcrumb(
        {
            "category": "app",
            "message": f"retrying /api/v1/credits/customers?{SEARCH}",
            "data": {"note": f"/api/v1/credits?query={DIGITS}"},
        },
        {},
    )
    called = _scrub_breadcrumb(
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
    assert called["data"] == {
        "url": "https://api.telegram.org/bot/sendMessage",
        "http.method": "POST",
    }


def test_the_event_scrubber_cuts_queries_and_database_values() -> None:
    from app.main import _scrub_event

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

    scrubbed = _scrub_event(event, {})

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
