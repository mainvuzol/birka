"""FastAPI dependencies: settings, database session, authenticated scope."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.errors import AuthenticationFailedError
from app.modules.authz.scope import RequestScope
from app.modules.authz.service import resolve_scope
from app.modules.identity.service import assert_user_is_active
from app.modules.identity.session import decode_session_token


async def session_dependency() -> AsyncIterator[AsyncSession]:
    async for session in get_session():
        yield session


def settings_dependency(request: Request) -> Settings:
    """Settings the app was built with, falling back to the process defaults."""
    configured: Settings | None = getattr(request.app.state, "settings", None)
    return configured or get_settings()


SettingsDep = Annotated[Settings, Depends(settings_dependency)]
SessionDep = Annotated[AsyncSession, Depends(session_dependency)]


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise AuthenticationFailedError("Authorization header is missing")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthenticationFailedError("Authorization header must be a Bearer token")
    return token.strip()


async def get_current_scope(
    session: SessionDep,
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> RequestScope:
    """Resolve the caller's authority from their session token.

    Scope is rebuilt from the database on every request rather than trusted
    from the token, so disabling an account or a membership takes effect on the
    next request. The token itself cannot be revoked — there is no session
    store — so it stays cryptographically valid until it expires.
    """
    claims = decode_session_token(
        _bearer_token(authorization), secret=settings.session_secret.get_secret_value()
    )
    # Deactivating an account must take effect on the next request, not when
    # the token expires. Composed here rather than inside resolve_scope so the
    # authz module does not have to depend on identity.
    await assert_user_is_active(session, claims.user_id)
    scope = await resolve_scope(session, claims.user_id)
    if scope.organization_id != claims.organization_id:
        # The user's organization changed after the token was issued.
        raise AuthenticationFailedError("Session no longer matches the user's organization")
    return scope


ScopeDep = Annotated[RequestScope, Depends(get_current_scope)]

__all__ = ["ScopeDep", "SessionDep", "SettingsDep", "get_current_scope"]
