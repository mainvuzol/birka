"""Database engine, session and declarative base.

Transaction ownership is explicit and lives at the service boundary
(`.ai/conventions.md`): the request-scoped session is created here, but nothing
in this module commits. A service either commits or the request fails.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import Settings

# Deterministic constraint names. Without these, Alembic autogenerate produces
# unnamed constraints that cannot be dropped in a downgrade.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Base(DeclarativeBase):
    """Declarative base shared by every module's models."""

    metadata = metadata


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        echo=settings.db_echo,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=True,
        future=True,
    )


def init_engine(settings: Settings) -> AsyncEngine:
    """Create the process-wide engine and session factory."""
    global _engine, _sessionmaker
    if _engine is None:
        _engine = create_engine(settings)
        _sessionmaker = async_sessionmaker(
            _engine, expire_on_commit=False, autoflush=False, class_=AsyncSession
        )
    return _engine


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        raise RuntimeError("Database engine is not initialised; call init_engine() at startup")
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped session.

    The session is rolled back on the way out unless a service committed it.
    This is deliberate: an un-committed unit of work is an error, not a silent
    partial write.
    """
    factory = get_sessionmaker()
    session = factory()
    try:
        yield session
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


def utcnow_sql() -> Any:
    """Server-side UTC timestamp expression (timestamps are persisted in UTC)."""
    from sqlalchemy import text

    return text("timezone('utc', now())")


__all__ = [
    "NAMING_CONVENTION",
    "Base",
    "create_engine",
    "dispose_engine",
    "get_session",
    "get_sessionmaker",
    "init_engine",
    "metadata",
    "utcnow_sql",
]
