"""Telegram initData verification — the front door of the whole system.

If this is wrong, anyone can impersonate any seller, so the negative cases
matter more than the happy path.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl, urlencode

import pytest

from app.core.errors import InvalidInitDataError
from app.modules.identity.telegram_init_data import verify_init_data
from tests.conftest import TEST_BOT_TOKEN, build_init_data


def test_accepts_correctly_signed_init_data() -> None:
    init_data = build_init_data()

    result = verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)

    assert result.user.telegram_user_id == 777000
    assert result.user.first_name == "Оля"
    assert result.auth_date.tzinfo is not None


def test_preserves_non_ascii_names() -> None:
    """Shop staff have Cyrillic names; the check string must be byte-exact."""
    init_data = build_init_data(
        user={"id": 42, "first_name": "Оля", "last_name": "Ґудзь", "username": "olia"}
    )

    result = verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)

    assert result.user.display_name == "Оля Ґудзь"
    assert result.user.username == "olia"


def test_rejects_tampered_field() -> None:
    """Changing any signed field after the fact must invalidate the hash."""
    original = build_init_data(user={"id": 1, "first_name": "Seller"})
    fields = dict(parse_qsl(original))
    signed_hash = fields["hash"]

    fields["query_id"] = "AAEtampered"
    tampered = urlencode({**fields, "hash": signed_hash})
    assert tampered != original

    with pytest.raises(InvalidInitDataError):
        verify_init_data(tampered, TEST_BOT_TOKEN, max_age_seconds=3600)


def test_rejects_a_swapped_user_identity() -> None:
    """The concrete attack: keep a valid signature, change who you are."""
    victim = build_init_data(user={"id": 111, "first_name": "Owner"})
    fields = dict(parse_qsl(victim))
    fields["user"] = json.dumps({"id": 222, "first_name": "Attacker"}, separators=(",", ":"))

    with pytest.raises(InvalidInitDataError):
        verify_init_data(urlencode(fields), TEST_BOT_TOKEN, max_age_seconds=3600)


def test_rejects_wrong_bot_token() -> None:
    init_data = build_init_data()

    with pytest.raises(InvalidInitDataError):
        verify_init_data(init_data, "999999:OTHER-BOT-TOKEN", max_age_seconds=3600)


def test_rejects_forged_hash() -> None:
    init_data = build_init_data(override_hash="0" * 64)

    with pytest.raises(InvalidInitDataError):
        verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)


def test_rejects_missing_hash() -> None:
    init_data = build_init_data()
    without_hash = "&".join(p for p in init_data.split("&") if not p.startswith("hash="))

    with pytest.raises(InvalidInitDataError, match="no hash"):
        verify_init_data(without_hash, TEST_BOT_TOKEN, max_age_seconds=3600)


def test_rejects_empty_bot_token() -> None:
    """An unconfigured token must never make verification trivially pass."""
    with pytest.raises(InvalidInitDataError, match="not configured"):
        verify_init_data(build_init_data(), "", max_age_seconds=3600)


def test_rejects_expired_auth_date() -> None:
    stale = datetime.now(tz=UTC) - timedelta(hours=5)
    init_data = build_init_data(auth_date=stale)

    with pytest.raises(InvalidInitDataError, match="expired"):
        verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)


def test_accepts_auth_date_within_window() -> None:
    recent = datetime.now(tz=UTC) - timedelta(minutes=30)
    init_data = build_init_data(auth_date=recent)

    result = verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)

    assert result.auth_date <= datetime.now(tz=UTC)


def test_rejects_future_auth_date() -> None:
    """A far-future timestamp would otherwise never expire."""
    future = datetime.now(tz=UTC) + timedelta(hours=2)
    init_data = build_init_data(auth_date=future)

    with pytest.raises(InvalidInitDataError, match="future"):
        verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)


def test_rejects_duplicate_field() -> None:
    """A duplicated key makes the data-check string ambiguous."""
    init_data = build_init_data() + "&auth_date=1"

    with pytest.raises(InvalidInitDataError, match="duplicate"):
        verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)


def test_rejects_oversized_payload() -> None:
    with pytest.raises(InvalidInitDataError, match="too large"):
        verify_init_data("a=" + "x" * 9000, TEST_BOT_TOKEN, max_age_seconds=3600)


def test_rejects_empty_payload() -> None:
    with pytest.raises(InvalidInitDataError, match="empty"):
        verify_init_data("", TEST_BOT_TOKEN, max_age_seconds=3600)


def test_rejects_malformed_user_json() -> None:
    init_data = build_init_data(extra_fields={"user": "{not json"})

    with pytest.raises(InvalidInitDataError):
        verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)


def test_signature_field_participates_in_the_check_string() -> None:
    """Telegram signs every field it sends, `signature` included.

    Excluding it would make a payload carrying `signature` fail to verify.
    """
    init_data = build_init_data(extra_fields={"signature": "abc123"})

    result = verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)

    assert result.raw_fields["signature"] == "abc123"


def test_error_message_never_leaks_the_payload() -> None:
    secret_name = "VERY-SECRET-NAME"
    init_data = build_init_data(user={"id": 5, "first_name": secret_name}, override_hash="f" * 64)

    with pytest.raises(InvalidInitDataError) as exc:
        verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)

    rendered = f"{exc.value}{exc.value.details}"
    assert secret_name not in rendered
    assert TEST_BOT_TOKEN not in rendered


def test_user_without_last_name_has_a_display_name() -> None:
    init_data = build_init_data(user={"id": 9, "first_name": "Ann"})

    result = verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)

    assert result.user.display_name == "Ann"


def test_user_without_first_name_falls_back_to_id() -> None:
    init_data = build_init_data(user={"id": 9, "first_name": ""})

    result = verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)

    assert result.user.display_name == "user9"


def test_raw_fields_round_trip_the_user_payload() -> None:
    payload = {"id": 3, "first_name": "Ira", "language_code": "uk"}
    init_data = build_init_data(user=payload)

    result = verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600)

    assert json.loads(result.raw_fields["user"])["language_code"] == "uk"
    assert result.user.language_code == "uk"
