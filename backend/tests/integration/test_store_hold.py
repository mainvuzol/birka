"""How a command holds its store: `FOR KEY SHARE`, so commands of one store
never wait for each other there, and a change of the store's state, which
takes the row `FOR UPDATE`, waits for all of them (owner decisions,
2026-10-01, "store states").

`with_for_update(key_share=True)` alone renders `FOR NO KEY UPDATE`, which
also conflicts with itself: every command of a store then queued behind
the one before it on the store's row. The tests below fail on that lock.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.core.errors import ValidationFailedError
from app.modules.authz.service import resolve_scope
from app.modules.inventory.service import lock_stock
from app.modules.stores.service import change_state
from app.modules.tenancy.models import Store, StoreState
from app.modules.tenancy.service import hold_trading_stores
from tests.conftest import requires_database
from tests.integration.test_store_states import network, stocked

pytestmark = [pytest.mark.integration, requires_database()]

LOCK_NOT_AVAILABLE = "55P03"


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def store_row(store_id: uuid.UUID, **lock: bool):
    return select(Store.id).where(Store.id == store_id).with_for_update(nowait=True, **lock)


async def test_a_command_holds_its_store_for_key_share_only(maker):
    """Only `FOR UPDATE` — a change of state, or the day's close — conflicts
    with the hold. A share lock and a plain update of the row's other
    columns, such as a rename, do not."""
    net = await network(maker)
    store = net.shops.child_store
    async with maker() as running:
        await hold_trading_stores(
            running, organization_id=net.shops.organization_id, store_ids={store}
        )
        async with maker() as other:
            await other.execute(store_row(store, read=True))  # FOR SHARE
            await other.execute(store_row(store, key_share=True))  # FOR NO KEY UPDATE
            await other.rollback()
        async with maker() as change:
            with pytest.raises(DBAPIError) as caught:
                await change.execute(store_row(store))  # FOR UPDATE
            assert caught.value.orig.sqlstate == LOCK_NOT_AVAILABLE
            await change.rollback()
        await running.commit()


async def test_two_commands_of_one_store_run_at_once_and_a_change_of_state_waits(maker):
    """Two stock commands of the same store, on different coats, both hold
    the store at once. Blocking it waits for both, then reads what they did."""
    net = await network(maker)
    store = net.shops.child_store
    first = await stocked(maker, net, net.own, qty=1)
    second = await stocked(maker, net, net.own, qty=1)
    async with maker() as owner_session:
        owner = await resolve_scope(owner_session, net.owner)

    async with maker() as one, maker() as two:
        await lock_stock(
            one,
            organization_id=net.shops.organization_id,
            keys=[(net.own, uuid.UUID(first[0]), uuid.UUID(first[1]))],
            acting_store_ids={store},
        )
        # Would wait for `one` until it commits under `FOR NO KEY UPDATE`.
        await two.execute(text("SET LOCAL lock_timeout = '2s'"))
        await lock_stock(
            two,
            organization_id=net.shops.organization_id,
            keys=[(net.own, uuid.UUID(second[0]), uuid.UUID(second[1]))],
            acting_store_ids={store},
        )

        async def block() -> Exception | None:
            async with maker() as session:
                try:
                    await change_state(
                        session,
                        scope=owner,
                        store_id=store,
                        command_id=uuid.uuid4(),
                        state=StoreState.BLOCKED,
                        reason="ревізія",
                    )
                    await session.commit()
                except ValidationFailedError as error:
                    return error
            return None

        waiting = asyncio.create_task(block())
        await asyncio.sleep(0.5)
        assert not waiting.done()
        await one.commit()
        await asyncio.sleep(0.3)
        assert not waiting.done()
        await two.commit()
    assert await waiting is None
    async with maker() as session:
        assert await session.scalar(select(Store.state).where(Store.id == store)) == "BLOCKED"
