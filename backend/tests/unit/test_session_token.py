"""Session token issuing and verification."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core.config import Settings
from app.core.errors import AuthenticationFailedError, SessionExpiredError
from app.modules.identity.session import decode_session_token, issue_session_token

# 32+ bytes: PyJWT warns below the RFC 7518 minimum for HS256, and the
# production guard in config.py enforces the same floor.
SECRET = "unit-test-session-secret-32-bytes-min"


def _issue(**kwargs: object) -> tuple[str, object]:
    defaults = {
        "user_id": uuid.uuid4(),
        "organization_id": uuid.uuid4(),
        "secret": SECRET,
        "ttl_seconds": 3600,
    }
    defaults.update(kwargs)
    return issue_session_token(**defaults)  # type: ignore[arg-type]


def test_round_trip_preserves_identity() -> None:
    user_id, org_id = uuid.uuid4(), uuid.uuid4()
    token, claims = issue_session_token(
        user_id=user_id, organization_id=org_id, secret=SECRET, ttl_seconds=3600
    )

    decoded = decode_session_token(token, secret=SECRET)

    assert decoded.user_id == user_id
    assert decoded.organization_id == org_id
    assert decoded.session_id == claims.session_id


def test_rejects_a_token_signed_with_another_secret() -> None:
    token, _ = _issue()

    with pytest.raises(AuthenticationFailedError):
        decode_session_token(token, secret="a-different-secret-of-adequate-length")


def test_rejects_an_expired_token() -> None:
    past = datetime.now(tz=UTC) - timedelta(hours=2)
    token, _ = _issue(ttl_seconds=60, now=past)

    with pytest.raises(SessionExpiredError):
        decode_session_token(token, secret=SECRET)


def test_rejects_an_unsigned_token() -> None:
    """`alg: none` must not be negotiated — the algorithm is pinned."""
    forged = jwt.encode(
        {
            "iss": "birka",
            "sub": str(uuid.uuid4()),
            "org": str(uuid.uuid4()),
            "jti": str(uuid.uuid4()),
            "iat": int(datetime.now(tz=UTC).timestamp()),
            "exp": int((datetime.now(tz=UTC) + timedelta(hours=1)).timestamp()),
        },
        key="",
        algorithm="none",
    )

    with pytest.raises(AuthenticationFailedError):
        decode_session_token(forged, secret=SECRET)


def test_rejects_a_token_from_another_issuer() -> None:
    forged = jwt.encode(
        {
            "iss": "somebody-else",
            "sub": str(uuid.uuid4()),
            "org": str(uuid.uuid4()),
            "jti": str(uuid.uuid4()),
            "iat": int(datetime.now(tz=UTC).timestamp()),
            "exp": int((datetime.now(tz=UTC) + timedelta(hours=1)).timestamp()),
        },
        SECRET,
        algorithm="HS256",
    )

    with pytest.raises(AuthenticationFailedError):
        decode_session_token(forged, secret=SECRET)


def test_rejects_a_token_missing_required_claims() -> None:
    incomplete = jwt.encode(
        {
            "iss": "birka",
            "sub": str(uuid.uuid4()),
            "exp": int((datetime.now(tz=UTC) + timedelta(hours=1)).timestamp()),
        },
        SECRET,
        algorithm="HS256",
    )

    with pytest.raises(AuthenticationFailedError):
        decode_session_token(incomplete, secret=SECRET)


def test_rejects_garbage() -> None:
    with pytest.raises(AuthenticationFailedError):
        decode_session_token("not-a-token", secret=SECRET)


def test_refuses_to_issue_without_a_secret() -> None:
    with pytest.raises(RuntimeError):
        issue_session_token(
            user_id=uuid.uuid4(), organization_id=uuid.uuid4(), secret="", ttl_seconds=60
        )


# --- the session epoch (owner decision, 2026-10-03: a lost phone) -----------


def _claims(**extra: object) -> dict[str, object]:
    now = datetime.now(tz=UTC)
    return {
        "iss": "birka",
        "sub": str(uuid.uuid4()),
        "org": str(uuid.uuid4()),
        "jti": str(uuid.uuid4()),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=1)).timestamp()),
        **extra,
    }


def test_a_token_carries_the_epoch_it_was_issued_under() -> None:
    token, claims = _issue(session_epoch=3)

    assert claims.session_epoch == 3
    assert jwt.decode(token, SECRET, algorithms=["HS256"], issuer="birka")["ep"] == 3
    assert decode_session_token(token, secret=SECRET).session_epoch == 3


def test_a_token_issued_before_the_epoch_existed_counts_as_zero() -> None:
    """Deploying the epoch signs nobody out."""
    token = jwt.encode(_claims(), SECRET, algorithm="HS256")

    assert decode_session_token(token, secret=SECRET).session_epoch == 0


@pytest.mark.parametrize("epoch", ["1", -1, True, 1.5, None])
def test_a_malformed_epoch_is_refused(epoch: object) -> None:
    token = jwt.encode(_claims(ep=epoch), SECRET, algorithm="HS256")

    with pytest.raises(AuthenticationFailedError, match="malformed"):
        decode_session_token(token, secret=SECRET)


# --- how long a sign-in lasts -------------------------------------------------


def test_a_seller_stays_signed_in_twelve_hours() -> None:
    """The owner decided on 2026-10-03 that a seller stays signed in for 12
    hours after opening the app, as before; then the app is closed and opened
    again in Telegram. The default is pinned, not the environment's value."""
    assert Settings.model_fields["session_ttl_seconds"].default == 12 * 3600


def test_telegram_launch_data_is_taken_for_an_hour() -> None:
    """How old Telegram's signed launch data may be when it is exchanged for a
    session (server-runbook.md: refused when more than an hour old)."""
    assert Settings.model_fields["telegram_init_data_max_age_seconds"].default == 3600
