"""Session token issuing and verification."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core.errors import AuthenticationFailedError, SessionExpiredError
from app.modules.identity.session import decode_session_token, issue_session_token

SECRET = "unit-test-session-secret"


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
        decode_session_token(token, secret="a-different-secret")


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
