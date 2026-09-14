"""Credentials must stay out of real Sentry exception events."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest
import sentry_sdk
from sentry_sdk.envelope import Envelope
from sentry_sdk.transport import Transport

from app.core.config import Settings
from app.main import _install_sentry
from app.modules.identity.service import authenticate_with_init_data
from tests.conftest import TEST_BOT_TOKEN, build_init_data


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
