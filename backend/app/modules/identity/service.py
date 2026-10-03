"""Authentication: exchange verified Telegram init data for a session."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AuthenticationFailedError
from app.core.logging import get_logger
from app.modules.authz.scope import RequestScope
from app.modules.authz.service import resolve_scope
from app.modules.identity.models import AppUser
from app.modules.identity.session import issue_session_token
from app.modules.identity.telegram_init_data import TelegramUser, verify_init_data

logger = get_logger(__name__)


async def _upsert_user(session: AsyncSession, telegram_user: TelegramUser) -> AppUser:
    """Insert or refresh the user for this Telegram account.

    A single INSERT ... ON CONFLICT rather than SELECT-then-INSERT: a Mini App
    fires several requests when it opens, so two concurrent first logins would
    otherwise both see "no such user", both insert, and the loser would get an
    IntegrityError surfacing as a 500 on a brand-new user's very first action.

    Profile fields are display data. Refreshing them can never change authority
    — that comes solely from memberships.
    """
    statement = (
        pg_insert(AppUser)
        .values(
            telegram_user_id=telegram_user.telegram_user_id,
            display_name=telegram_user.display_name,
            username=telegram_user.username,
            language_code=telegram_user.language_code,
        )
        .on_conflict_do_update(
            index_elements=[AppUser.telegram_user_id],
            set_={
                "display_name": telegram_user.display_name,
                "username": telegram_user.username,
                "language_code": telegram_user.language_code,
            },
        )
        .returning(AppUser)
    )
    user = (await session.execute(statement)).scalar_one()
    await session.flush()
    return user


async def assert_user_is_active(session: AsyncSession, user_id: uuid.UUID) -> AppUser:
    """Refuse a deactivated account.

    Checked on every authenticated request, not only at login: an owner who
    disables an account expects it to stop working now, not when a 12-hour
    session token happens to expire. The account it returns carries the
    session epoch the token is then held to (`session.py`).
    """
    user = (
        await session.execute(select(AppUser).where(AppUser.id == user_id))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise AuthenticationFailedError("User account is not active")
    return user


async def telegram_chats(
    session: AsyncSession, user_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """The Telegram chat of each *active* user among `user_ids`.

    A bot's private chat with a person has that person's Telegram user id.
    A disabled account is left out: it no longer hears from the shop.
    """
    wanted = list(user_ids)
    if not wanted:
        return {}
    rows = await session.execute(
        select(AppUser.id, AppUser.telegram_user_id).where(
            AppUser.id.in_(wanted), AppUser.is_active.is_(True)
        )
    )
    return {row.id: row.telegram_user_id for row in rows}


async def display_names(
    session: AsyncSession, user_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """What the app calls each of these people, e.g. who is inspecting a unit."""
    wanted = list(user_ids)
    if not wanted:
        return {}
    rows = await session.execute(
        select(AppUser.id, AppUser.display_name).where(AppUser.id.in_(wanted))
    )
    return {row.id: row.display_name for row in rows}


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
    if not user.is_active:
        raise AuthenticationFailedError("User account is not active")
    # Raises AuthenticationFailedError when the Telegram account has no membership:
    # being a Telegram user is not being a user of this system.
    scope = await resolve_scope(session, user.id)

    token, claims = issue_session_token(
        user_id=user.id,
        organization_id=scope.organization_id,
        secret=settings.session_secret.get_secret_value(),
        ttl_seconds=settings.session_ttl_seconds,
        now=now,
        session_epoch=user.session_epoch,
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


__all__ = [
    "assert_user_is_active",
    "authenticate_with_init_data",
    "display_names",
    "telegram_chats",
]
