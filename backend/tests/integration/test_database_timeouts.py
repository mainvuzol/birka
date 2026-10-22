"""The engine's limits (`app/core/db.py create_engine`), on real PostgreSQL.

A statement that runs too long is cancelled by PostgreSQL, a transaction left
idle is ended, and waiting for a free connection gives up in time, so one
stuck request cannot hold a connection, or the locks it took, for good. The
limits here are tiny so the tests are quick; the server's are 30 s, 60 s and
10 s (`app/core/config.py`).
"""

from __future__ import annotations

import asyncio
import os
import time

import pytest
from sqlalchemy import exc as sa_exc
from sqlalchemy import text

from app.core.config import Settings
from app.core.db import create_engine
from tests.conftest import requires_database

pytestmark = [pytest.mark.integration, requires_database()]


def settings(**limits: float) -> Settings:
    return Settings(database_url=os.environ["BIRKA_TEST_DATABASE_URL"], **limits)


async def test_a_statement_over_the_limit_is_cancelled() -> None:
    engine = create_engine(settings(db_statement_timeout_seconds=0.2))
    try:
        async with engine.connect() as connection:
            assert await connection.scalar(text("SHOW statement_timeout")) == "200ms"
            started = time.monotonic()
            with pytest.raises(sa_exc.DBAPIError, match="statement timeout"):
                await connection.execute(text("SELECT pg_sleep(5)"))
            assert time.monotonic() - started < 2
            await connection.rollback()
            # The connection is still good for the next statement.
            assert await connection.scalar(text("SELECT 1")) == 1
    finally:
        await engine.dispose()


async def test_a_transaction_left_idle_is_ended() -> None:
    engine = create_engine(settings(db_idle_in_transaction_timeout_seconds=0.2))
    try:
        async with engine.connect() as connection:
            assert (
                await connection.scalar(text("SHOW idle_in_transaction_session_timeout")) == "200ms"
            )
            await asyncio.sleep(0.6)
            with pytest.raises(sa_exc.DBAPIError):
                await connection.execute(text("SELECT 1"))
    finally:
        await engine.dispose()


async def test_the_servers_limits_and_zero_turns_them_off() -> None:
    server = create_engine(settings())
    off = create_engine(
        settings(db_statement_timeout_seconds=0, db_idle_in_transaction_timeout_seconds=0)
    )
    try:
        async with server.connect() as connection:
            assert await connection.scalar(text("SHOW statement_timeout")) == "30s"
            assert (
                await connection.scalar(text("SHOW idle_in_transaction_session_timeout")) == "1min"
            )
        async with off.connect() as connection:
            assert await connection.scalar(text("SHOW statement_timeout")) == "0"
            assert await connection.scalar(text("SHOW idle_in_transaction_session_timeout")) == "0"
    finally:
        await server.dispose()
        await off.dispose()


async def test_a_limit_under_a_millisecond_is_still_a_limit() -> None:
    """PostgreSQL counts in milliseconds and reads 0 as off.

    On a busy machine the 1 ms limit can cancel the very statement that
    reads it, which shows it on as surely (it failed so twice on a loaded
    Mac, 2026-10-22); a limit read as off is never cancelled, and fails.
    """
    engine = create_engine(settings(db_statement_timeout_seconds=0.0004))
    try:
        async with engine.connect() as connection:
            try:
                shown = await connection.scalar(text("SHOW statement_timeout"))
            except sa_exc.DBAPIError as error:
                assert "statement timeout" in str(error.orig)
            else:
                assert shown == "1ms"
    finally:
        await engine.dispose()


async def test_waiting_for_a_connection_gives_up_in_time() -> None:
    engine = create_engine(
        Settings(
            database_url=os.environ["BIRKA_TEST_DATABASE_URL"],
            db_pool_size=1,
            db_max_overflow=0,
            db_pool_timeout_seconds=0.3,
        )
    )
    try:
        async with engine.connect() as held:
            await held.execute(text("SELECT 1"))
            started = time.monotonic()
            with pytest.raises(sa_exc.TimeoutError):
                async with engine.connect() as second:
                    await second.execute(text("SELECT 1"))
            waited = time.monotonic() - started
        assert 0.25 <= waited < 2
        # Once the connection is back, the next request has it.
        async with engine.connect() as connection:
            assert await connection.scalar(text("SELECT 1")) == 1
    finally:
        await engine.dispose()


def test_the_server_waits_less_than_the_phone() -> None:
    """The phone gives up after 20 s (frontend/src/shared/api.ts)."""
    engine = create_engine(Settings())
    try:
        assert engine.pool.timeout() == 10  # type: ignore[attr-defined]
    finally:
        engine.sync_engine.dispose()
