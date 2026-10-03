"""A sign-in that passed its checks is a success, whatever follows it
(`GET /internal/status`, owner decision 2026-10-03), over HTTP against real
PostgreSQL.

A person with no access yet is told so (NO_ACCESS), and that is not the
trouble the owner hears about: the sign-in itself works, so the failures
counted before it end there.

A launch whose signature fails counts only when the id it claims is an
active person of the shop: a wrong bot token refuses the shop's sellers,
while anyone on the internet can post a forged one (finding of 2026-10-03).
"""

from __future__ import annotations

import os
import random
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.api.deps import session_dependency
from app.core.config import Settings
from app.main import create_app
from app.modules.identity.models import AppUser
from tests.conftest import TEST_BOT_TOKEN, build_init_data, requires_database

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def _unused_id() -> int:
    return random.randint(10**12, 10**13)  # noqa: S311 - an id nobody has


@pytest.fixture
async def people(maker: async_sessionmaker[AsyncSession]) -> AsyncIterator[tuple[int, int]]:
    """An active person of the shop and a disabled one, by Telegram id."""
    active, disabled = _unused_id(), _unused_id()
    async with maker() as session:
        session.add_all(
            [
                AppUser(telegram_user_id=active, display_name="Продавчиня"),
                AppUser(telegram_user_id=disabled, display_name="Колишній", is_active=False),
            ]
        )
        await session.commit()
    yield active, disabled
    async with maker() as session:
        await session.execute(
            delete(AppUser).where(AppUser.telegram_user_id.in_([active, disabled]))
        )
        await session.commit()


@pytest.fixture
async def client(maker: async_sessionmaker[AsyncSession]) -> AsyncIterator[httpx.AsyncClient]:
    app: FastAPI = create_app(
        Settings(
            app_env="local",
            telegram_bot_token=TEST_BOT_TOKEN,
            session_secret="sign-in-outcomes-secret-at-least-32-bytes",
        )
    )

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as instance:
        yield instance


async def _sign_in(client: httpx.AsyncClient, init_data: str) -> httpx.Response:
    return await client.post("/api/v1/auth/telegram", json={"init_data": init_data})


async def _sign_ins(client: httpx.AsyncClient) -> dict[str, Any]:
    response = await client.get("/internal/status")
    assert response.status_code == 200
    figures: dict[str, Any] = response.json()["sign_ins"]
    return figures


def _other_bot(person: int) -> str:
    """A launch for `person` that this server's token does not sign: what a
    wrong token on the server, or a forger, sends."""
    return build_init_data(bot_token="999:OTHER", user={"id": person, "first_name": "Оля"})


async def test_a_bad_signature_counts_only_for_an_active_person_of_the_shop(
    client: httpx.AsyncClient, people: tuple[int, int]
) -> None:
    active, disabled = people

    for claimed in (_unused_id(), disabled, _unused_id()):
        refused = await _sign_in(client, _other_bot(claimed))
        assert refused.json()["code"] == "INVALID_INIT_DATA"
    assert (await _sign_ins(client))["failures"] == 0

    for _ in range(2):
        refused = await _sign_in(client, _other_bot(active))
        assert refused.json()["code"] == "INVALID_INIT_DATA"
    figures = await _sign_ins(client)
    assert (figures["failures"], figures["senders"], figures["reasons"]["signature"]) == (2, 1, 2)
    assert figures["failing_since"] is not None
    assert str(active) not in str(figures)


async def test_a_person_with_no_access_ends_the_failing(
    maker: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient,
    people: tuple[int, int],
) -> None:
    active, _ = people
    stranger = _unused_id()

    for _ in range(3):
        refused = await _sign_in(client, _other_bot(active))
        assert refused.json()["code"] == "INVALID_INIT_DATA"
    assert (await _sign_ins(client))["failures"] == 3

    before = datetime.now(tz=UTC).replace(microsecond=0)
    no_access = await _sign_in(client, build_init_data(user={"id": stranger, "first_name": "Нова"}))

    assert no_access.status_code == 401
    assert no_access.json()["code"] == "NO_ACCESS"
    figures = await _sign_ins(client)
    assert figures["failing_since"] is None
    assert figures["failures"] == 0
    assert datetime.fromisoformat(figures["last_success_at"]) >= before

    # And nothing of the stranger was kept.
    async with maker() as session:
        assert (
            await session.scalar(select(AppUser.id).where(AppUser.telegram_user_id == stranger))
        ) is None
