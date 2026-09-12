"""Authentication: exchange verified Telegram init data for a session."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.logging import get_logger
from app.modules.authz.scope import RequestScope
from app.modules.authz.service import resolve_scope
from app.modules.identity.models import AppUser
from app.modules.identity.session import issue_session_token
from app.modules.identity.telegram_init_data import TelegramUser, verify_init_data

logger = get_logger(__name__)


async def _upsert_user(session: AsyncSession, telegram_user: TelegramUser) -> AppUser:
    """Find the user by Telegram id, creating or refreshing the profile.

    Profile fields are display data only. Changing them can never change
    authority — that comes solely from memberships.
    """
    user = (
        await session.execute(
            select(AppUser).where(AppUser.telegram_user_id == telegram_user.telegram_user_id)
        )
    ).scalar_one_or_none()

    if user is None:
        user = AppUser(
            telegram_user_id=telegram_user.telegram_user_id,
            display_name=telegram_user.display_name,
            username=telegram_user.username,
            language_code=telegram_user.language_code,
        )
        session.add(user)
        await session.flush()
        return user

    user.display_name = telegram_user.display_name
    user.username = telegram_user.username
    user.language_code = telegram_user.language_code
    return user


async def authenticate_with_init_data(
    session: AsyncSession,
    *,
    init_data: str,
    settings: Settings,
    now: datetime | None = None,
) -> tuple[str, AppUser, RequestScope]:
    """Verify Telegram init data and issue a session token.

    Owns its transaction: it commits, or the request fails and nothing is
    written.
    """
    verified = verify_init_data(
        init_data,
        settings.telegram_bot_token.get_secret_value(),
        max_age_seconds=settings.telegram_init_data_max_age_seconds,
        now=now,
    )

    user = await _upsert_user(session, verified.user)
    # Raises AuthenticationFailedError when the Telegram account has no membership:
    # being a Telegram user is not being a user of this system.
    scope = await resolve_scope(session, user.id)

    token, claims = issue_session_token(
        user_id=user.id,
        organization_id=scope.organization_id,
        secret=settings.session_secret.get_secret_value(),
        ttl_seconds=settings.session_ttl_seconds,
        now=now,
    )
    await session.commit()

    logger.info(
        "session.issued",
        user_id=str(user.id),
        organization_id=str(scope.organization_id),
        session_id=str(claims.session_id),
        store_count=len(scope.store_permissions),
    )
    return token, user, scope


__all__ = ["authenticate_with_init_data"]
