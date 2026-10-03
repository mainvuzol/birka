"""Why a sign-in was refused, and how sign-ins have gone lately
(`app/modules/identity/sign_ins.py`, `GET /internal/status`).

Owner decision, 2026-10-03: the owner and an administrator hear when nobody
can sign in for 10 minutes while people kept trying. The watcher decides that
from these figures; the reason tells a wrong clock from a wrong bot token, and
a refusal counts only with a sender, so a stranger's junk raises nothing.
Nothing here has a database: a bad signature's claimed sender, which only the
database can vouch for, is in `tests/integration/test_sign_in_outcomes.py`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode

import httpx
import pytest
from fastapi import FastAPI

from app.api.deps import session_dependency
from app.core.config import Settings
from app.core.errors import InvalidInitDataError
from app.core.rate_limit import TokenBucket
from app.main import create_app
from app.modules.identity import service as identity_service
from app.modules.identity.sign_ins import SENDERS_AT_MOST, SignInOutcomes
from app.modules.identity.telegram_init_data import verify_init_data
from tests.conftest import TEST_BOT_TOKEN, build_init_data
from tests.unit.test_client_errors import Recorder
from tests.unit.test_rate_limit import Clock

NOW = datetime(2026, 10, 3, 10, 0, tzinfo=UTC)
ZERO = {"expired": 0, "future": 0, "signature": 0, "malformed": 0}


# --- the figures ----------------------------------------------------------------


def test_nothing_yet() -> None:
    assert SignInOutcomes().snapshot() == {
        "last_success_at": None,
        "failing_since": None,
        "last_failure_at": None,
        "failures": 0,
        "senders": 0,
        "reasons": ZERO,
    }


def test_failing_since_is_the_first_failure_and_each_is_counted_by_reason() -> None:
    outcomes = SignInOutcomes()
    assert outcomes.refused("expired", NOW, sender=1) is True
    outcomes.refused("expired", NOW + timedelta(minutes=3), sender=1)
    outcomes.refused("signature", NOW + timedelta(minutes=7), sender=2)

    assert outcomes.snapshot() == {
        "last_success_at": None,
        "failing_since": "2026-10-03T10:00:00+00:00",
        "last_failure_at": "2026-10-03T10:07:00+00:00",
        "failures": 3,
        "senders": 2,
        "reasons": ZERO | {"expired": 2, "signature": 1},
    }


def test_a_refusal_with_no_sender_or_malformed_is_not_counted() -> None:
    """Nobody can be told apart in it: a stranger's junk, or a payload no
    Telegram client sends."""
    outcomes = SignInOutcomes()
    assert outcomes.refused("signature", NOW, sender=None) is False
    assert outcomes.refused("expired", NOW, sender=None) is False
    assert outcomes.refused("malformed", NOW, sender=7) is False

    assert outcomes.snapshot() == SignInOutcomes().snapshot()


def test_a_success_ends_the_failing_and_the_count_starts_again() -> None:
    outcomes = SignInOutcomes()
    outcomes.refused("future", NOW, sender=1)
    outcomes.succeeded(NOW + timedelta(minutes=1))

    assert outcomes.snapshot() == {
        "last_success_at": "2026-10-03T10:01:00+00:00",
        "failing_since": None,
        "last_failure_at": None,
        "failures": 0,
        "senders": 0,
        "reasons": ZERO,
    }

    outcomes.refused("expired", NOW + timedelta(minutes=5), sender=1)
    outcomes.refused("signature", NOW + timedelta(minutes=6), sender=1)
    snapshot = outcomes.snapshot()
    assert snapshot["failing_since"] == "2026-10-03T10:05:00+00:00"
    assert snapshot["last_failure_at"] == "2026-10-03T10:06:00+00:00"
    assert snapshot["last_success_at"] == "2026-10-03T10:01:00+00:00"
    assert snapshot["failures"] == 2
    assert snapshot["senders"] == 1


def test_the_senders_kept_are_bounded_and_never_shown() -> None:
    outcomes = SignInOutcomes()
    for sender in range(1, SENDERS_AT_MOST * 3):
        outcomes.refused("expired", NOW, sender=10**9 + sender)

    snapshot = outcomes.snapshot()
    assert snapshot["senders"] == SENDERS_AT_MOST
    assert snapshot["failures"] == SENDERS_AT_MOST * 3 - 1
    assert str(10**9 + 1) not in repr(snapshot)


# --- the reasons -------------------------------------------------------------


def _with_hash(init_data: str, value: str | None) -> str:
    fields = dict(parse_qsl(init_data))
    if value is None:
        fields.pop("hash")
    else:
        fields["hash"] = value
    return urlencode(fields)


@pytest.mark.parametrize(
    ("init_data", "token", "reason"),
    [
        (build_init_data(auth_date=NOW - timedelta(hours=2)), TEST_BOT_TOKEN, "expired"),
        (build_init_data(auth_date=NOW + timedelta(minutes=5)), TEST_BOT_TOKEN, "future"),
        # Signed by another bot: the token on the server is not the bot's.
        (build_init_data(auth_date=NOW, bot_token="999:OTHER"), TEST_BOT_TOKEN, "signature"),
        (build_init_data(auth_date=NOW, override_hash="f" * 64), TEST_BOT_TOKEN, "signature"),
        (build_init_data(auth_date=NOW, override_hash="abc"), TEST_BOT_TOKEN, "signature"),
        (build_init_data(auth_date=NOW, override_hash="é" * 64), TEST_BOT_TOKEN, "signature"),
        (_with_hash(build_init_data(auth_date=NOW), None), TEST_BOT_TOKEN, "malformed"),
        ("", TEST_BOT_TOKEN, "malformed"),
        ("a=1&a=2&hash=" + "f" * 64, TEST_BOT_TOKEN, "malformed"),
        ("x" * 9000, TEST_BOT_TOKEN, "malformed"),
        ("=&&", TEST_BOT_TOKEN, "malformed"),
        (build_init_data(auth_date=NOW), "", "malformed"),
        (build_init_data(auth_date=NOW, user={"first_name": "no id"}), TEST_BOT_TOKEN, "malformed"),
        (
            build_init_data(auth_date=NOW, extra_fields={"auth_date": "soon"}),
            TEST_BOT_TOKEN,
            "malformed",
        ),
    ],
)
def test_each_refusal_names_its_reason(init_data: str, token: str, reason: str) -> None:
    with pytest.raises(InvalidInitDataError) as refused:
        verify_init_data(init_data, token, max_age_seconds=3600, now=NOW)

    assert refused.value.reason == reason
    # The client is told the same whatever the reason.
    assert refused.value.to_payload()["code"] == "INVALID_INIT_DATA"
    assert "reason" not in refused.value.details
    assert refused.value.to_payload().keys() == {"code", "message"}


@pytest.mark.parametrize(
    ("init_data", "sender", "claimed"),
    [
        # Signed: the person Telegram named is the sender.
        (build_init_data(auth_date=NOW - timedelta(hours=2)), 777000, None),
        (build_init_data(auth_date=NOW + timedelta(minutes=5)), 777000, None),
        # Not signed by this bot: a claim only.
        (build_init_data(auth_date=NOW, bot_token="999:OTHER"), None, 777000),
        (build_init_data(auth_date=NOW, override_hash="abc"), None, 777000),
        # Nothing to name: no sender at all.
        (build_init_data(auth_date=NOW, bot_token="999:OTHER", user={"id": "777"}), None, None),
        (build_init_data(auth_date=NOW, bot_token="999:OTHER", user={"id": True}), None, None),
        (build_init_data(auth_date=NOW, bot_token="999:OTHER", user={"id": 2**63}), None, None),
        (build_init_data(auth_date=NOW, bot_token="999:OTHER", user={"id": -5}), None, None),
        (build_init_data(auth_date=NOW, bot_token="999:OTHER", user=[777000]), None, None),
        (
            build_init_data(
                auth_date=NOW, bot_token="999:OTHER", extra_fields={"user": "[" * 3000}
            ),
            None,
            None,
        ),
        ("user=%7B%22id%22%3A5%7D&hash=" + "f" * 64, None, 5),
        ("user=%7B%22id%22%3A5%7D", None, None),
    ],
    ids=[
        "expired",
        "future",
        "other-bot",
        "bad-hash",
        "id-as-text",
        "id-as-bool",
        "id-too-big",
        "id-negative",
        "user-a-list",
        "user-not-json",
        "forged",
        "malformed",
    ],
)
def test_a_refusal_names_who_sent_it_and_how_far_it_is_believed(
    init_data: str, sender: int | None, claimed: int | None
) -> None:
    with pytest.raises(InvalidInitDataError) as refused:
        verify_init_data(init_data, TEST_BOT_TOKEN, max_age_seconds=3600, now=NOW)

    assert (refused.value.sender, refused.value.claimed_sender) == (sender, claimed)
    # Neither ever reaches the client.
    assert "777000" not in str(refused.value.to_payload())


# --- through the app ---------------------------------------------------------


def _app() -> FastAPI:
    app = create_app(
        Settings(
            app_env="local",
            log_json=False,
            release="abc1234",
            telegram_bot_token=TEST_BOT_TOKEN,
            session_secret="unit-test-session-secret-at-least-32-bytes",
        )
    )

    async def no_database() -> AsyncIterator[None]:
        yield None

    app.dependency_overrides[session_dependency] = no_database
    return app


async def _call(app: FastAPI, method: str, path: str, **kwargs: Any) -> httpx.Response:
    transport = httpx.ASGITransport(app=app, client=("203.0.113.7", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, path, **kwargs)


async def _status(app: FastAPI) -> dict[str, Any]:
    response = await _call(app, "GET", "/internal/status")
    assert response.status_code == 200
    body: dict[str, Any] = response.json()
    return body


@pytest.fixture
def logged(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    recorder = Recorder()
    monkeypatch.setattr(identity_service, "logger", recorder)
    return recorder


def _stale(person: int = 4242) -> dict[str, str]:
    """A launch signed by the bot for `person`, three hours old: a phone
    sending an old launch again, or a server clock ahead."""
    return {
        "init_data": build_init_data(
            user={"id": person, "first_name": "VERY-SECRET-NAME"},
            auth_date=datetime.now(tz=UTC) - timedelta(hours=3),
        )
    }


async def test_a_refused_sign_in_is_logged_by_its_reason_alone(logged: Recorder) -> None:
    app = _app()

    response = await _call(app, "POST", "/api/v1/auth/telegram", json=_stale())

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_INIT_DATA"
    assert logged.lines == [
        ("warning", "identity.sign_in_refused", {"reason": "expired", "counted": True})
    ]


async def test_the_status_counts_refusals_and_says_since_when(logged: Recorder) -> None:
    app = _app()
    before = datetime.now(tz=UTC).replace(microsecond=0)

    for person in (4242, 4242, 4343):
        await _call(app, "POST", "/api/v1/auth/telegram", json=_stale(person))
    status = await _status(app)

    sign_ins = status["sign_ins"]
    assert sign_ins["failures"] == 3
    assert sign_ins["senders"] == 2
    assert sign_ins["reasons"] == ZERO | {"expired": 3}
    assert sign_ins["last_success_at"] is None
    assert datetime.fromisoformat(sign_ins["failing_since"]) >= before
    assert datetime.fromisoformat(sign_ins["last_failure_at"]) >= datetime.fromisoformat(
        sign_ins["failing_since"]
    )
    assert "4242" not in str(status)
    assert status["release"] == "abc1234"
    assert datetime.fromisoformat(status["started_at"]) <= datetime.now(tz=UTC)
    # Its database does not answer here, and it still answers 200.
    assert status["database"] == "unreachable"
    assert set(status) == {"started_at", "release", "database", "sign_ins"}


async def test_a_strangers_junk_is_refused_logged_and_not_counted(logged: Recorder) -> None:
    """Anyone may post to the sign-in endpoint (finding of 2026-10-03: three
    junk posts raised the alarm). Malformed launch data never counts; a bad
    signature counts only for a person of the shop, which needs the
    database, and a database that does not answer vouches for nobody: the
    sign-in is still refused, not a 500."""
    app = _app()

    for junk in (
        "a=b",
        "x",
        build_init_data(override_hash="f" * 64),
        build_init_data(bot_token="999:OTHER"),
    ):
        response = await _call(app, "POST", "/api/v1/auth/telegram", json={"init_data": junk})
        assert response.status_code == 401
        assert response.json()["code"] == "INVALID_INIT_DATA"

    sign_ins = (await _status(app))["sign_ins"]
    assert (sign_ins["failures"], sign_ins["senders"], sign_ins["failing_since"]) == (0, 0, None)
    refusals = [fields for _, event, fields in logged.lines if event == "identity.sign_in_refused"]
    assert refusals == [
        {"reason": "malformed", "counted": False},
        {"reason": "malformed", "counted": False},
        {"reason": "signature", "counted": False},
        {"reason": "signature", "counted": False},
    ]
    assert "777000" not in str(logged.lines)


async def test_a_sign_in_held_by_the_address_limit_is_not_a_failure(logged: Recorder) -> None:
    app = _app()
    app.state.sign_in_bucket = TokenBucket(per_minute=1, burst=1, clock=Clock())

    assert (await _call(app, "POST", "/api/v1/auth/telegram", json=_stale())).status_code == 401
    assert (await _call(app, "POST", "/api/v1/auth/telegram", json=_stale())).status_code == 429

    assert (await _status(app))["sign_ins"]["failures"] == 1


async def test_each_app_counts_on_its_own(logged: Recorder) -> None:
    app = _app()
    await _call(app, "POST", "/api/v1/auth/telegram", json=_stale())

    assert (await _status(app))["sign_ins"]["failures"] == 1
    assert (await _status(_app()))["sign_ins"]["failures"] == 0


async def test_the_status_is_not_under_the_public_prefix() -> None:
    """Caddy passes only /api/* to the API, so this is never public."""
    app = _app()

    assert (await _call(app, "GET", "/api/v1/internal/status")).status_code == 404
    assert (await _call(app, "GET", "/api/internal/status")).status_code == 404
    paths = (await _call(app, "GET", "/openapi.json")).json()["paths"]
    assert not [path for path in paths if "internal" in path]
    assert "/api/v1/ready" in paths
