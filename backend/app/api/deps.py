"""FastAPI dependencies: settings, database session, authenticated scope."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.errors import AuthenticationFailedError, SessionExpiredError
from app.core.rate_limit import limit_heavy_work, limit_person
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


# Requests that only read. A store that does not trade is read by the
# network's owner and managers, and nothing else is done in it (owner
# decisions, 2026-10-01 and 2026-10-10); every command here is a POST, PUT,
# PATCH or DELETE.
_READS = frozenset({"GET", "HEAD"})


async def get_current_scope(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> RequestScope:
    """Resolve the caller's authority from their session token.

    Scope is rebuilt from the database on every request rather than trusted
    from the token, so disabling an account or a membership takes effect on the
    next request. One token cannot be revoked — there is no session store —
    but every token of a person is ended at once by raising their session
    epoch, which is checked here too.
    """
    claims = decode_session_token(
        _bearer_token(authorization), secret=settings.session_secret.get_secret_value()
    )
    # Every signed-in request counts against its person, before the database
    # is asked anything (owner decision, 2026-10-10; ADR-0020).
    limit_person(request, claims.user_id, claims.session_epoch)
    # Deactivating an account must take effect on the next request, not when
    # the token expires. Composed here rather than inside resolve_scope so the
    # authz module does not have to depend on identity.
    user = await assert_user_is_active(session, claims.user_id)
    scope = await resolve_scope(session, claims.user_id, reading=request.method in _READS)
    if scope.organization_id != claims.organization_id:
        # The user's organization changed after the token was issued.
        raise AuthenticationFailedError("Session no longer matches the user's organization")
    if claims.session_epoch < user.session_epoch:
        # Every sign-in of this person was ended on the server, on the owner's
        # word (owner decision, 2026-10-03: a lost phone). Checked after the
        # scope, so that someone turned off, whose sign-ins end too, is told
        # they have no access rather than to sign in again.
        raise SessionExpiredError("This session was ended; sign in again")
    return scope


ScopeDep = Annotated[RequestScope, Depends(get_current_scope)]


async def get_heavy_scope(request: Request, scope: ScopeDep) -> RequestScope:
    """`get_current_scope`, for a request that parses a file or a catalogue
    line on the event loop: it also counts against the person's bucket for
    those (ADR-0020). A coroutine, so the bucket is only touched on the loop."""
    limit_heavy_work(request, scope.user_id)
    return scope


HeavyScopeDep = Annotated[RequestScope, Depends(get_heavy_scope)]

__all__ = ["HeavyScopeDep", "ScopeDep", "SessionDep", "SettingsDep", "get_current_scope"]
