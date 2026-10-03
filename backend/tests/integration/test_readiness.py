"""Whether the API can serve: `GET /api/v1/ready`, and the database's state
in `GET /internal/status` (app/api/internal.py), against real PostgreSQL.

Ready means the database answers within 3 seconds and its schema is not
behind this code. A schema ahead of the code is allowed: going back to the
previous build alone is a documented step. Which migration counts as this
code's head is set by each test from the database's own revision, so the
tests hold whatever migration is added next.
"""

from __future__ import annotations

import ast
import asyncio
import os
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.api import internal
from app.api.deps import session_dependency
from app.api.internal import CodeSchema
from app.core.config import Settings
from app.main import create_app
from tests.conftest import requires_database

pytestmark = [pytest.mark.integration, requires_database()]

SETTINGS = Settings(
    app_env="local", release="abc1234", session_secret="readiness-secret-at-least-32-bytes"
)


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def database_revision(engine: AsyncEngine) -> str:
    async with engine.connect() as connection:
        revision = await connection.scalar(text("SELECT version_num FROM alembic_version"))
    assert isinstance(revision, str)
    return revision


def code_at(monkeypatch: pytest.MonkeyPatch, *, head: str, known: set[str]) -> None:
    schema = CodeSchema(heads=frozenset({head}), known=frozenset(known | {head}))
    monkeypatch.setattr(internal, "code_schema", lambda: schema)


async def ask(
    maker: async_sessionmaker[AsyncSession], path: str, method: str = "GET"
) -> httpx.Response:
    app = create_app(SETTINGS)

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.request(method, path)


async def test_ready_when_the_database_is_at_the_codes_head(
    engine: AsyncEngine, maker: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    current = await database_revision(engine)
    code_at(monkeypatch, head=current, known={"0001_m1a"})

    ready = await ask(maker, "/api/v1/ready")
    status = await ask(maker, "/internal/status")

    assert (ready.status_code, ready.json()) == (200, {"status": "ready"})
    assert status.status_code == 200
    assert status.json()["database"] == "ok"
    assert status.json()["release"] == "abc1234"
    # An uptime check that asks with HEAD reads the same.
    assert (await ask(maker, "/api/v1/ready", method="HEAD")).status_code == 200


async def test_not_ready_when_a_migration_was_not_run(
    engine: AsyncEngine, maker: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The code's head is newer than the database: every request that reads
    the new column would fail."""
    current = await database_revision(engine)
    code_at(monkeypatch, head="9999_not_yet_run", known={current})

    ready = await ask(maker, "/api/v1/ready")
    status = await ask(maker, "/internal/status")

    assert (ready.status_code, ready.json()) == (503, {"status": "not_ready", "reason": "schema"})
    assert (status.status_code, status.json()["database"]) == (200, "behind")


async def test_ready_when_the_database_is_ahead_of_the_code(
    maker: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The previous build, put back after a migration: its head is an
    ancestor, and the database's revision is one it does not know."""
    code_at(monkeypatch, head="0001_m1a", known=set())

    ready = await ask(maker, "/api/v1/ready")

    assert (ready.status_code, ready.json()) == (200, {"status": "ready"})


async def test_not_ready_when_the_database_does_not_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Nothing listens there; the status still answers, and says so."""
    nowhere = new_engine("postgresql+asyncpg://birka_review@127.0.0.1:1/birka_test_api")
    try:
        unreachable = async_sessionmaker(nowhere, expire_on_commit=False)
        started = time.monotonic()
        ready = await ask(unreachable, "/api/v1/ready")
        status = await ask(unreachable, "/internal/status")
        elapsed = time.monotonic() - started
    finally:
        await nowhere.dispose()

    assert (ready.status_code, ready.json()) == (
        503,
        {"status": "not_ready", "reason": "database"},
    )
    assert (status.status_code, status.json()["database"]) == (200, "unreachable")
    assert elapsed < 6


async def test_a_database_that_does_not_answer_in_time_is_not_ready(
    engine: AsyncEngine, maker: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A database that hangs: here, the migrations' table is held by another
    transaction. Not ready within the limit, and ready again once it answers;
    the connection the check gave up on is not left stuck."""
    current = await database_revision(engine)
    code_at(monkeypatch, head=current, known=set())
    monkeypatch.setattr(internal, "READY_WITHIN_SECONDS", 0.5)

    async with engine.connect() as holder:
        await holder.execute(text("LOCK TABLE alembic_version IN ACCESS EXCLUSIVE MODE"))
        started = time.monotonic()
        held = await asyncio.wait_for(ask(maker, "/api/v1/ready"), timeout=10)
        elapsed = time.monotonic() - started
        await holder.rollback()

    assert (held.status_code, held.json()) == (503, {"status": "not_ready", "reason": "database"})
    assert elapsed < 3
    answered = await asyncio.wait_for(ask(maker, "/api/v1/ready"), timeout=5)
    assert (answered.status_code, answered.json()) == (200, {"status": "ready"})
    # And the database is not left with the check's statement still waiting.
    async with engine.connect() as connection:
        waiting = await connection.scalar(
            text(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                "AND wait_event_type = 'Lock' AND query LIKE '%alembic_version%'"
            )
        )
    assert waiting == 0


async def test_the_health_check_still_does_not_touch_the_database() -> None:
    """CI and the runbook curl it; it must answer when the database does not."""
    nowhere = new_engine("postgresql+asyncpg://birka_review@127.0.0.1:1/birka_test_api")
    try:
        response = await ask(async_sessionmaker(nowhere), "/api/v1/health")
    finally:
        await nowhere.dispose()

    assert (response.status_code, response.json()) == (
        200,
        {"status": "ok", "environment": "local"},
    )


def test_the_codes_head_is_the_newest_migration() -> None:
    """What the API compares with: read from the migrations shipped beside
    the code, the one revision nothing else revises."""
    internal.code_schema.cache_clear()
    schema = internal.code_schema()

    versions = Path(internal.__file__).resolve().parents[2] / "migrations" / "versions"
    revisions: dict[str, Any] = {}
    for script in versions.glob("*.py"):
        named: dict[str, Any] = {}
        for statement in ast.parse(script.read_text(encoding="utf-8")).body:
            if isinstance(statement, ast.AnnAssign | ast.Assign) and statement.value is not None:
                targets = (
                    [statement.target]
                    if isinstance(statement, ast.AnnAssign)
                    else statement.targets
                )
                for target in targets:
                    if isinstance(target, ast.Name):
                        named[target.id] = statement.value
        revisions[ast.literal_eval(named["revision"])] = ast.literal_eval(named["down_revision"])
    newest = set(revisions) - set(revisions.values())

    assert schema.heads == frozenset(newest)
    assert len(schema.heads) == 1
    assert schema.known == frozenset(revisions)


def test_a_database_never_migrated_is_behind() -> None:
    schema = CodeSchema(heads=frozenset({"b"}), known=frozenset({"a", "b"}))

    assert schema.is_behind([])
    assert schema.is_behind(["a"])
    assert not schema.is_behind(["b"])
    assert not schema.is_behind(["c_from_a_newer_build"])
