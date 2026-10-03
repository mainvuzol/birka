"""Migration 0033, in a database of the test's own."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest

from tests.conftest import requires_database
from tests.integration.test_size_spelling_migration import _rows
from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run

pytestmark = [pytest.mark.integration, requires_database()]

BEFORE = "0032_size_spelling"
EPOCH = "0033_session_epoch"


@pytest.fixture
async def scratch() -> AsyncIterator[str]:
    name = f"birka_epoch_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    try:
        yield name
    finally:
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def _column(database: str) -> tuple[str, str | None, str | None]:
    [(version, nullable, default)] = await _rows(
        database,
        "SELECT (SELECT version_num FROM alembic_version),"
        " (SELECT is_nullable FROM information_schema.columns"
        "   WHERE table_name = 'app_user' AND column_name = 'session_epoch'),"
        " (SELECT column_default FROM information_schema.columns"
        "   WHERE table_name = 'app_user' AND column_name = 'session_epoch')",
    )
    return version, nullable, default


async def test_0033_starts_everyone_at_zero_and_goes_down_and_up_again(scratch):
    """Everyone already there starts at 0, which a token issued before also
    counts as: deploying it signs nobody out. Down, the column goes."""
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    person = uuid.uuid4()
    await _rows(
        scratch,
        "INSERT INTO app_user (id, telegram_user_id, display_name) VALUES (:id, 42, 'Оля')",
        id=person,
    )

    await _run(config, "upgrade", EPOCH, database=scratch)
    assert await _column(scratch) == (EPOCH, "NO", "0")
    assert await _rows(scratch, "SELECT session_epoch FROM app_user") == [(0,)]

    await _run(config, "downgrade", BEFORE, database=scratch)
    assert await _column(scratch) == (BEFORE, None, None)
    assert await _rows(scratch, "SELECT id FROM app_user") == [(person,)]

    await _run(config, "upgrade", EPOCH, database=scratch)
    assert await _column(scratch) == (EPOCH, "NO", "0")
