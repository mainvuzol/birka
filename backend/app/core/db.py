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


def _milliseconds(seconds: float) -> str:
    # A positive limit never rounds down to 0, which PostgreSQL reads as off.
    return str(max(1, round(seconds * 1000)) if seconds > 0 else 0)


def create_engine(settings: Settings) -> AsyncEngine:
    """The engine of the API and of the scripts that share its settings.

    Each connection is opened with two limits, so one stuck request cannot
    hold a connection, or the locks it took, for good: a statement that runs
    longer than `db_statement_timeout_seconds` is cancelled by PostgreSQL
    itself, and a transaction left open and idle for
    `db_idle_in_transaction_timeout_seconds` is ended with its connection.
    0 turns either off. Waiting for a free connection gives up after
    `db_pool_timeout_seconds`, before the phone gives up on the answer.
    Migrations open their own engine (migrations/env.py) and are not limited.
    """
    return create_async_engine(
        settings.database_url,
        echo=settings.db_echo,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
        pool_pre_ping=True,
        future=True,
        # A database error's text otherwise ends with the statement's values,
        # `[parameters: ('Ірина Коваль', '+38 (067) 123-45-67')]` for a debt or
        # the search text for a debt search, and that text reaches the log and
        # Sentry with the traceback. The statement itself stays, for debugging.
        hide_parameters=True,
        # Sent by asyncpg when each connection opens, in milliseconds.
        connect_args={
            "server_settings": {
                "statement_timeout": _milliseconds(settings.db_statement_timeout_seconds),
                "idle_in_transaction_session_timeout": _milliseconds(
                    settings.db_idle_in_transaction_timeout_seconds
                ),
            }
        },
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
