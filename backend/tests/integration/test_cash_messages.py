"""What the bot is to tell of a close's difference, and to whom (owner
decisions, 2026-10-04; ADR-0012, B8), against real PostgreSQL.

- The network's owner: whoever holds `store:manage` through an
  organization-wide membership of that network, with a chat — not a
  manager, not a store's own owner, not another network's owner — and never
  whoever closed (G10, G40).
- Once the reason is written, or 15 minutes after the close without it
  (G11); once per close per person, however often the watcher looks; a
  reason written later is not sent again.
- Nothing for a difference under 1 грн (G41), for none, or for an opening
  count; nothing for a close older than a day.

Each assertion is about its own close: the watcher looks at every
network's closes, and the shared test database holds other tests' too.
All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.models import Membership, Role
from app.modules.cash.messages import WAIT_FOR_REASON, messages_of, queue_due
from app.modules.cash.models import CashMessage
from app.modules.identity.models import AppUser
from tests.conftest import requires_database
from tests.integration.test_cash_close import Net, at, close, give, network, sold

pytestmark = [pytest.mark.integration, requires_database()]

# November, so no other test's close of B7's week is in the watcher's day.
EVENING = at(10, 20, 14, month=11)


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def short_close(maker, net: Net, counted: str = "6100.00", *, by: uuid.UUID | None = None):
    """Close #1 counted 2000 the evening before; 4250 sold in cash; close #2
    counted `counted` at 20:14 against 6250."""
    await close(maker, net, "2000.00", now=EVENING - timedelta(days=1))
    await sold(maker, net, "4250.00", "CASH")
    return await close(maker, net, counted, now=EVENING, by=by)


async def queue(maker, minutes: int) -> None:
    async with maker() as session:
        await queue_due(session, now=EVENING + timedelta(minutes=minutes))


async def told(maker, close_id: uuid.UUID) -> list[CashMessage]:
    async with maker() as session:
        return await messages_of(session, close_id)


async def second_owner(maker, net: Net) -> uuid.UUID:
    """Another owner of the whole network, with a chat of their own."""
    async with maker() as session:
        role = await session.get(Role, await owner_role(session, net))
        assert role is not None
        user = AppUser(telegram_user_id=uuid.uuid4().int % 2**52, display_name="Співвласниця")
        session.add(user)
        await session.flush()
        session.add(
            Membership(user_id=user.id, organization_id=net.org, store_id=None, role_id=role.id)
        )
        await session.commit()
        return user.id


async def owner_role(session: AsyncSession, net: Net) -> uuid.UUID:
    found = await session.scalar(select(Membership.role_id).where(Membership.user_id == net.owner))
    assert found is not None
    return found


async def test_the_network_owner_is_told_once_the_reason_is_written_and_no_one_else(maker):
    net = await network(maker)
    stranger = await network(maker)
    short = await short_close(maker, net)
    await queue(maker, 1)
    assert await told(maker, short.id) == []
    assert (
        await give(maker, net, short.id, "помилилась зі здачею", by=net.seller)
    ).status_code == 200

    await queue(maker, 2)
    [message] = await told(maker, short.id)
    assert message.user_id == net.owner
    assert message.user_id not in {net.manager, net.child_owner, stranger.owner, net.seller}
    assert (message.status, message.attempts, message.organization_id) == ("PENDING", 0, net.org)
    assert message.text == (
        "Каса «Основний», 10.11: нестача 150,00 грн.\n"
        "Підрахунок: Марина, 20:14 — 6100,00 грн; мало бути 6250,00 грн.\n"
        "Причина: «помилилась зі здачею»."
    )
    # However often the watcher looks.
    await queue(maker, 3)
    await queue(maker, 30)
    assert len(await told(maker, short.id)) == 1


async def test_without_a_reason_the_bot_waits_fifteen_minutes_then_tells_once(maker):
    net = await network(maker)
    short = await short_close(maker, net, "6600.00")
    await queue(maker, 14)
    assert await told(maker, short.id) == []
    await queue(maker, int(WAIT_FOR_REASON.total_seconds() // 60))
    [message] = await told(maker, short.id)
    assert message.text.splitlines()[0] == "Каса «Основний», 10.11: надлишок 350,00 грн."
    assert message.text.splitlines()[-1] == "Причину не вказано."
    # A reason written later is in the app, and not sent again.
    assert (await give(maker, net, short.id, "не знаю", by=net.seller)).status_code == 200
    await queue(maker, 20)
    assert [one.text for one in await told(maker, short.id)] == [message.text]


async def test_whoever_closed_is_not_told_of_her_own_close(maker):
    """G40, example H: the owner counted it themselves; another owner of the
    network is still told."""
    net = await network(maker)
    other = await second_owner(maker, net)
    hers = await short_close(maker, net, by=net.owner)
    await queue(maker, 16)
    assert [message.user_id for message in await told(maker, hers.id)] == [other]


@pytest.mark.parametrize(
    ("counted", "messages"),
    [
        ("6250.00", 0),
        ("6249.01", 0),
        ("6250.99", 0),
        ("6249.00", 1),
        ("6251.00", 1),
    ],
)
async def test_no_message_for_no_difference_or_one_under_a_hryvnia(maker, counted, messages):
    net = await network(maker)
    found = await short_close(maker, net, counted)
    await queue(maker, 16)
    assert len(await told(maker, found.id)) == messages


async def test_no_message_for_an_opening_count(maker):
    net = await network(maker)
    first = await close(maker, net, "2000.00", now=EVENING)
    await queue(maker, 16)
    assert await told(maker, first.id) == []


async def test_a_close_older_than_a_day_is_not_told(maker):
    net = await network(maker)
    short = await short_close(maker, net)
    await queue(maker, 24 * 60 + 1)
    assert await told(maker, short.id) == []


async def test_an_owner_whose_account_is_disabled_is_not_told(maker):
    net = await network(maker)
    async with maker() as session:
        await session.execute(
            update(AppUser).where(AppUser.id == net.owner).values(is_active=False)
        )
        await session.commit()
    short = await short_close(maker, net)
    await queue(maker, 16)
    assert await told(maker, short.id) == []


async def test_a_days_not_closed_are_named_in_the_message(maker):
    """G42: nothing is told of a day nobody closed; the next close's message
    names it."""
    net = await network(maker)
    await close(maker, net, "2000.00", now=EVENING - timedelta(days=2))
    await sold(maker, net, "4250.00", "CASH", when=EVENING - timedelta(days=1))
    short = await close(maker, net, "6100.00", now=EVENING)
    await queue(maker, 16)
    [message] = await told(maker, short.id)
    assert message.text.splitlines()[-1] == "Не закрито: 09.11 — цей день увійшов у це закриття."
