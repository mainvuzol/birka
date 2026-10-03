"""Ending a person's sign-ins (owner decision, 2026-10-03), over HTTP against
real PostgreSQL, with tokens issued by a real sign-in.

- On the owner's word, every sign-in of a person is ended on the server, and
  they keep their access: the next sign-in works with the stores they had.
- Turning a person off ends their sign-ins too: a later grant lets them sign
  in again, and does not bring back a token issued before.
- Out of one store, the others keep working, signed in as they are; out of
  the last, the sign-ins end.
- A token issued before the epoch existed counts as 0, so deploying it signs
  nobody out.
- A token whose organization is no longer the person's is refused.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.deps import session_dependency
from app.core.config import Settings
from app.main import create_app
from app.modules.identity import people
from app.modules.identity.models import AppUser
from tests.conftest import requires_database
from tests.integration.test_people import Shop, open_shop, sign_in, telegram_id

pytestmark = [pytest.mark.integration, requires_database()]

# The secret `test_people.sign_in` signs its tokens with.
SETTINGS = Settings(app_env="local", log_json=False, session_secret="s" * 48)


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def shop(maker) -> Shop:
    return await open_shop(maker)


async def me(maker: async_sessionmaker[AsyncSession], token: str) -> httpx.Response:
    """What the app's next request with this token gets."""
    app = create_app(SETTINGS)

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as client:
        return await client.get("/api/v1/me")


def refused(response: httpx.Response, code: str) -> None:
    assert response.status_code == 401, response.text
    assert response.json()["code"] == code


async def epoch(maker, telegram_user_id: int) -> int | None:
    async with maker() as session:
        return await session.scalar(
            select(AppUser.session_epoch).where(AppUser.telegram_user_id == telegram_user_id)
        )


async def test_signed_out_on_the_owners_word_and_still_works_there(shop: Shop, maker) -> None:
    seller = telegram_id()
    await shop.grant(seller, "MAIN", "SELLER")
    await shop.grant(seller, "SECOND", "SELLER")
    token, _, _ = await sign_in(maker, seller)
    assert (await me(maker, token)).status_code == 200

    async with maker.begin() as session:
        kept = await people.sign_out(session, approved_by=shop.owner, telegram_user_id=seller)

    assert kept == 2
    refused(await me(maker, token), "SESSION_EXPIRED")
    # The new phone signs in, with the stores they had.
    again, _, _ = await sign_in(maker, seller)
    answer = await me(maker, again)
    assert answer.status_code == 200, answer.text
    assert {store["code"] for store in answer.json()["stores"]} == {"MAIN", "SECOND"}
    # Once ended, a token stays ended.
    refused(await me(maker, token), "SESSION_EXPIRED")


async def test_turned_off_then_back_does_not_bring_an_old_token_back(shop: Shop, maker) -> None:
    seller = telegram_id()
    await shop.grant(seller, "MAIN", "SELLER")
    token, _, _ = await sign_in(maker, seller)

    assert await shop.deactivate(seller) == 1
    # Turned off, they are told they have no access, not to sign in again.
    refused(await me(maker, token), "NO_ACCESS")

    await shop.grant(seller, "MAIN", "SELLER")
    refused(await me(maker, token), "SESSION_EXPIRED")
    again, _, _ = await sign_in(maker, seller)
    assert (await me(maker, again)).status_code == 200


async def test_out_of_one_store_signed_in_as_before_out_of_the_last_not(shop: Shop, maker) -> None:
    seller = telegram_id()
    await shop.grant(seller, "MAIN", "SELLER")
    await shop.grant(seller, "SECOND", "SELLER")
    token, _, _ = await sign_in(maker, seller)

    assert await shop.remove(seller, "MAIN")
    answer = await me(maker, token)
    assert answer.status_code == 200, answer.text
    assert {store["code"] for store in answer.json()["stores"]} == {"SECOND"}
    assert await epoch(maker, seller) == 0

    assert await shop.remove(seller, "SECOND")
    refused(await me(maker, token), "NO_ACCESS")
    assert await epoch(maker, seller) == 1
    await shop.grant(seller, "SECOND", "SELLER")
    refused(await me(maker, token), "SESSION_EXPIRED")


async def test_a_token_from_before_the_epoch_counts_as_zero(shop: Shop, maker) -> None:
    """Deploying the epoch signs nobody out; ending sign-ins ends it too."""
    seller = telegram_id()
    await shop.grant(seller, "MAIN", "SELLER")
    _, user, scope = await sign_in(maker, seller)
    now = datetime.now(tz=UTC)
    before = jwt.encode(
        {
            "iss": "birka",
            "sub": str(user.id),
            "org": str(scope.organization_id),
            "jti": str(uuid.uuid4()),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=1)).timestamp()),
        },
        SETTINGS.session_secret.get_secret_value(),
        algorithm="HS256",
    )

    assert (await me(maker, before)).status_code == 200
    async with maker.begin() as session:
        await people.sign_out(session, approved_by=shop.owner, telegram_user_id=seller)
    refused(await me(maker, before), "SESSION_EXPIRED")


async def test_a_token_of_another_organization_is_refused(shop: Shop, maker) -> None:
    seller = telegram_id()
    await shop.grant(seller, "MAIN", "SELLER")
    _, user, _ = await sign_in(maker, seller)
    now = datetime.now(tz=UTC)
    elsewhere = jwt.encode(
        {
            "iss": "birka",
            "sub": str(user.id),
            "org": str(uuid.uuid4()),
            "jti": str(uuid.uuid4()),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=1)).timestamp()),
            "ep": 0,
        },
        SETTINGS.session_secret.get_secret_value(),
        algorithm="HS256",
    )

    answer = await me(maker, elsewhere)

    refused(answer, "AUTHENTICATION_FAILED")
    assert answer.json()["message"] == "Session no longer matches the user's organization"
