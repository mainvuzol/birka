"""The server's own failures answer 503 `SERVER_UNAVAILABLE`, against real
PostgreSQL (ADR-0013 §2).

The phone reads a 503 as "the server does not answer", keeps what it sent,
and tells the seller to sell on paper (owner decision, 2026-10-04). Before,
a database that did not answer, or a schema a migration had not reached,
read as a server error with a number.

- Nothing listens where the database should be, or every connection is
  taken: `DATABASE`.
- A name the database does not know, while the readiness check says the
  schema is behind this code: `SCHEMA`.
- The same name with the schema at this code's head is a bug: 500
  `INTERNAL_ERROR` with its number, as every bug.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.api.deps import SessionDep, get_current_scope, session_dependency
from app.core.config import Settings
from app.core.correlation import REQUEST_ID_HEADER
from app.core.db import create_engine, dispose_engine, init_engine
from app.main import create_app
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.identity.session import issue_session_token
from tests.conftest import requires_database
from tests.integration.test_readiness import code_at, database_revision

pytestmark = [pytest.mark.integration, requires_database()]

SETTINGS = Settings(app_env="local", session_secret="server-unavailable-secret-at-least-32-bytes")
NOWHERE = "postgresql+asyncpg://birka_review@127.0.0.1:1/birka_test_api"
INTERNAL_ERROR = {"code": "INTERNAL_ERROR", "message": "Внутрішня помилка сервера.", "details": {}}


def unavailable(reason: str) -> dict:
    return {
        "code": "SERVER_UNAVAILABLE",
        "message": "Сервер тимчасово недоступний.",
        "details": {"reason": reason},
    }


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def server_engine() -> AsyncIterator[None]:
    """The process's own engine, as the server starts it: what the readiness
    check is asked on, on a session of its own."""
    await dispose_engine()
    init_engine(Settings(database_url=os.environ["BIRKA_TEST_DATABASE_URL"]))
    yield
    await dispose_engine()


def a_token() -> dict[str, str]:
    token, _ = issue_session_token(
        user_id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        secret=SETTINGS.session_secret.get_secret_value(),
        ttl_seconds=3600,
    )
    return {"Authorization": f"Bearer {token}"}


@asynccontextmanager
async def client(
    maker: async_sessionmaker[AsyncSession],
    *,
    app: FastAPI | None = None,
    scope: RequestScope | None = None,
    raise_app_exceptions: bool = True,
) -> AsyncIterator[httpx.AsyncClient]:
    """Sessions from `maker`. An error that goes on up from the app is raised
    here, unless `raise_app_exceptions` is off: so a 503 answered this way
    also proves it went no further."""
    app = app or create_app(SETTINGS)

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    if scope is not None:
        app.dependency_overrides[get_current_scope] = lambda: scope
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=raise_app_exceptions),
        base_url="http://test",
    ) as http:
        yield http


def a_new_column() -> FastAPI:
    """An endpoint that reads a column a migration not yet run would add."""
    app = create_app(SETTINGS)

    @app.get("/_test/new-column")
    async def _new_column(session: SessionDep) -> None:
        await session.execute(text("SELECT outage_never_added FROM sale LIMIT 1"))

    return app


def answered(response: httpx.Response, reason: str) -> None:
    assert response.status_code == 503, response.text
    assert response.json() == unavailable(reason)
    # The id the seller can quote, the one the warning line carries.
    assert response.headers[REQUEST_ID_HEADER]


async def test_nothing_listening_where_the_database_should_be() -> None:
    nowhere = new_engine(NOWHERE)
    try:
        sessions = async_sessionmaker(nowhere, expire_on_commit=False)
        async with client(sessions) as http:
            me = await http.get("/api/v1/me", headers=a_token())
        store = uuid.uuid4()
        scope = RequestScope(
            user_id=uuid.uuid4(),
            organization_id=uuid.uuid4(),
            store_permissions={store: DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]},
        )
        async with client(sessions, scope=scope) as http:
            sale = await http.post(
                "/api/v1/sales",
                json={
                    "store_id": str(store),
                    "command_id": str(uuid.uuid4()),
                    "lines": [
                        {
                            "product_variant_id": str(uuid.uuid4()),
                            "size_id": str(uuid.uuid4()),
                            "source_location_id": str(uuid.uuid4()),
                            "quantity": 1,
                            "unit_price": "1500.00",
                        }
                    ],
                    "payment_method": "CASH",
                },
                headers={"Idempotency-Key": str(uuid.uuid4()), REQUEST_ID_HEADER: "sale-down-1"},
            )
    finally:
        await nowhere.dispose()

    answered(me, "DATABASE")
    assert uuid.UUID(me.headers[REQUEST_ID_HEADER])
    answered(sale, "DATABASE")
    assert sale.headers[REQUEST_ID_HEADER] == "sale-down-1"


async def test_every_connection_taken() -> None:
    """The pool gives up waiting for a free connection, before the phone
    gives up on the answer."""
    busy = create_engine(
        Settings(
            database_url=os.environ["BIRKA_TEST_DATABASE_URL"],
            db_pool_size=1,
            db_max_overflow=0,
            db_pool_timeout_seconds=0.3,
        )
    )
    try:
        async with busy.connect() as held:
            await held.execute(text("SELECT 1"))
            async with client(async_sessionmaker(busy, expire_on_commit=False)) as http:
                me = await http.get("/api/v1/me", headers=a_token())
    finally:
        await busy.dispose()

    answered(me, "DATABASE")


async def test_a_migration_not_run(
    engine: AsyncEngine,
    maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    server_engine: None,
) -> None:
    current = await database_revision(engine)
    code_at(monkeypatch, head="9999_not_yet_run", known={current})

    async with client(maker, app=a_new_column()) as http:
        response = await http.get("/_test/new-column")

    answered(response, "SCHEMA")


async def test_the_same_name_with_the_schema_at_head_is_a_bug(
    engine: AsyncEngine,
    maker: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    server_engine: None,
) -> None:
    """Nothing to sell on paper for: the server answers, its code is wrong."""
    current = await database_revision(engine)
    code_at(monkeypatch, head=current, known=set())

    async with client(maker, app=a_new_column(), raise_app_exceptions=False) as http:
        response = await http.get("/_test/new-column", headers={REQUEST_ID_HEADER: "bug-42"})

    assert (response.status_code, response.json()) == (500, INTERNAL_ERROR)
    assert response.headers[REQUEST_ID_HEADER] == "bug-42"
    # And it goes on up, to uvicorn's traceback and Sentry.
    with pytest.raises(Exception, match="outage_never_added"):
        async with client(maker, app=a_new_column()) as http:
            await http.get("/_test/new-column")


async def test_a_schema_check_that_finds_no_database_says_so(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    """The request's name was unknown, and the check then finds nothing
    listening: the database is the reason."""
    await dispose_engine()
    init_engine(Settings(database_url=NOWHERE))
    try:
        async with client(maker, app=a_new_column()) as http:
            response = await http.get("/_test/new-column")
    finally:
        await dispose_engine()

    answered(response, "DATABASE")
