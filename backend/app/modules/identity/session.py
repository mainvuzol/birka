"""Session tokens.

Telegram `initData` proves *who* the person is; it is not used as a session
credential on every request. We exchange it once for a short-lived signed token
of our own, so request authorization never depends on replaying Telegram data.

There is no session store, so a token cannot be revoked before it expires: the
`jti` claim identifies a session for logging, it is not a revocation handle.
What *is* re-checked on every request is the user's active flag and their
memberships, so disabling an account or a membership takes effect immediately
even though the token itself stays cryptographically valid.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from app.core.errors import AuthenticationFailedError, SessionExpiredError

_ALGORITHM = "HS256"
_ISSUER = "birka"


@dataclass(frozen=True, slots=True)
class SessionClaims:
    user_id: uuid.UUID
    organization_id: uuid.UUID
    session_id: uuid.UUID
    issued_at: datetime
    expires_at: datetime


def issue_session_token(
    *,
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    secret: str,
    ttl_seconds: int,
    now: datetime | None = None,
    session_id: uuid.UUID | None = None,
) -> tuple[str, SessionClaims]:
    if not secret:
        raise RuntimeError("session secret is not configured")

    issued_at = now or datetime.now(tz=UTC)
    expires_at = issued_at + timedelta(seconds=ttl_seconds)
    claims = SessionClaims(
        user_id=user_id,
        organization_id=organization_id,
        session_id=session_id or uuid.uuid4(),
        issued_at=issued_at,
        expires_at=expires_at,
    )
    token = jwt.encode(
        {
            "iss": _ISSUER,
            "sub": str(claims.user_id),
            "org": str(claims.organization_id),
            "jti": str(claims.session_id),
            "iat": int(issued_at.timestamp()),
            "exp": int(expires_at.timestamp()),
        },
        secret,
        algorithm=_ALGORITHM,
    )
    return token, claims


def decode_session_token(token: str, *, secret: str, leeway_seconds: int = 0) -> SessionClaims:
    """Verify and decode a session token.

    The algorithm is pinned explicitly, so a token claiming ``alg: none`` or a
    different algorithm is rejected rather than negotiated.
    """
    if not secret:
        raise RuntimeError("session secret is not configured")
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[_ALGORITHM],
            issuer=_ISSUER,
            leeway=leeway_seconds,
            options={"require": ["exp", "iat", "sub", "org", "jti"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise SessionExpiredError() from exc
    except jwt.InvalidTokenError as exc:
        raise AuthenticationFailedError("Session token is invalid") from exc

    try:
        return SessionClaims(
            user_id=uuid.UUID(payload["sub"]),
            organization_id=uuid.UUID(payload["org"]),
            session_id=uuid.UUID(payload["jti"]),
            issued_at=datetime.fromtimestamp(int(payload["iat"]), tz=UTC),
            expires_at=datetime.fromtimestamp(int(payload["exp"]), tz=UTC),
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise AuthenticationFailedError("Session token payload is malformed") from exc


__all__ = ["SessionClaims", "decode_session_token", "issue_session_token"]
