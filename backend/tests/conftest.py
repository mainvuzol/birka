"""Shared test fixtures and helpers."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import UTC, datetime
from urllib.parse import urlencode

import pytest

TEST_BOT_TOKEN = "123456:TEST-TOKEN-not-a-real-secret"


def build_init_data(
    *,
    bot_token: str = TEST_BOT_TOKEN,
    user: dict | None = None,
    auth_date: datetime | None = None,
    extra_fields: dict[str, str] | None = None,
    override_hash: str | None = None,
) -> str:
    """Produce a correctly signed Telegram initData string.

    Mirrors what Telegram does, so the verifier is tested against a real
    signature rather than a mock.
    """
    payload_user = user if user is not None else {"id": 777000, "first_name": "Оля"}
    fields: dict[str, str] = {
        "auth_date": str(int((auth_date or datetime.now(tz=UTC)).timestamp())),
        "query_id": "AAEtestquery",
        "user": json.dumps(payload_user, separators=(",", ":"), ensure_ascii=False),
    }
    if extra_fields:
        fields.update(extra_fields)

    data_check_string = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    computed = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    fields["hash"] = override_hash if override_hash is not None else computed
    return urlencode(fields)


def requires_database() -> pytest.MarkDecorator:
    """Skip a test when no real PostgreSQL is available.

    Tests skip loudly rather than passing silently: a green run on a machine
    without a database must not be mistaken for database coverage.
    """
    url = os.environ.get("BIRKA_TEST_DATABASE_URL")
    return pytest.mark.skipif(
        not url,
        reason="BIRKA_TEST_DATABASE_URL is not set — PostgreSQL integration tests skipped",
    )


@pytest.fixture
def bot_token() -> str:
    return TEST_BOT_TOKEN
