"""A close racing the money it counts, and commands racing themselves
(ADR-0012, B3, B4, B5, B6.2; D2 "Concurrency"), against real PostgreSQL.

Membership of a period follows commit order, never a timestamp. A money row
whose insert ran before the close took the store waits for nothing and is
waited for: the close counts it. One whose insert comes after waits in the
database's stamp, and lands in the next close. Never both, never neither.

«Клієнт забрав» and a raw `INSERT` take no store lock of their own before
they insert: on those paths the stamp's own hold on the store is the only
thing between them and the close, so they are raced here in both orders.

Two sends of one movement, one correction or one reason, both in flight at
once, end in one row and one replay, never a 500; two reasons for one close
under two commands end in one reason and a refusal. Two closes of one store
at once end in one close.

All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy import insert as sql_insert
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.core.errors import PaymentMethodChangedError, ValidationFailedError
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.authz.service import resolve_scope
from app.modules.cash.models import CashCloseReason, CashMovement, MovementKind, PaymentCorrection
from app.modules.cash.service import (
    Target,
    close_day,
    correct,
    give_reason,
    newest_close,
    record_movement,
)
from app.modules.credit.models import CreditEntry
from app.modules.orders.service import transition_order
from app.modules.refunds.models import Refund
from app.modules.sales.models import Sale
from app.modules.sales.payment import PaymentMethod
from tests.conftest import requires_database
from tests.integration.test_cash_close import (
    Net,
    at,
    close,
    d,
    days_ago,
    handed_back,
    network,
    paid,
    refused,
    sold,
    sold_in_parts,
)
from tests.integration.test_customer_orders import act, setup

pytestmark = [pytest.mark.integration, requires_database()]

WAIT = 0.5


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def sale_values(net: Net, method: str = "CASH", total: str = "500.00") -> dict[str, Any]:
    return {
        "organization_id": net.org,
        "store_id": net.store,
        "seller_user_id": net.seller,
        "command_id": uuid.uuid4(),
        "command_fingerprint": "0" * 64,
        "currency_code": "UAH",
        "subtotal": d(total),
        "total": d(total),
        "payment_method": method,
    }


async def closing(session, scope: RequestScope, store: uuid.UUID, *, now: datetime) -> Any:
    """A close of `store` in `session`, left uncommitted: it holds the store's
    row `FOR UPDATE` until the caller commits."""
    newest = await newest_close(session, store)
    return await close_day(
        session,
        scope=scope,
        store_id=store,
        command_id=uuid.uuid4(),
        counted=d("0.00"),
        counted_at=now,
        after_close_id=newest.id if newest else None,
        now=now,
    )


async def close_in_task(maker, scope: RequestScope, store: uuid.UUID, *, now: datetime) -> Any:
    async with maker() as session:
        found = await closing(session, scope, store, now=now)
        await session.commit()
        return found


Insert = Callable[[Any], Awaitable[uuid.UUID]]


async def money_first(maker, net: Net, insert: Insert, *, now: datetime) -> tuple[Any, uuid.UUID]:
    """The money row's insert runs and its transaction stays open; a close
    starts, waits, and counts it once the row commits."""
    async with maker() as session:
        scope = await resolve_scope(session, net.seller)
    async with maker() as money:
        row_id = await insert(money)
        task = asyncio.create_task(close_in_task(maker, scope, net.store, now=now))
        await asyncio.sleep(WAIT)
        assert not task.done(), "the close did not wait for the money in flight"
        await money.commit()
    return await task, row_id


async def close_first(maker, net: Net, insert: Insert, *, now: datetime) -> tuple[Any, uuid.UUID]:
    """The close holds the store; the money row's insert waits in the stamp,
    and lands in the next period once the close commits."""
    async with maker() as session:
        scope = await resolve_scope(session, net.seller)

    async def write() -> uuid.UUID:
        async with maker() as money:
            row_id = await insert(money)
            await money.commit()
            return row_id

    async with maker() as session:
        held = await closing(session, scope, net.store, now=now)
        task = asyncio.create_task(write())
        await asyncio.sleep(WAIT)
        assert not task.done(), "the money row did not wait for the close"
        await session.commit()
    return held, await task


async def period_of(maker, model: Any, row_id: uuid.UUID) -> int | None:
    async with maker() as session:
        return await session.scalar(select(model.drawer_period).where(model.id == row_id))


# --- a raw INSERT, a payment taken here, a refund taken here ---------------------------------


def raw_sale(net: Net) -> Insert:
    async def insert(session: Any) -> uuid.UUID:
        found = await session.scalar(sql_insert(Sale).values(**sale_values(net)).returning(Sale.id))
        assert found is not None
        return found

    return insert


@pytest.mark.parametrize("order", ["money_first", "close_first"])
async def test_a_raw_insert_and_a_close_never_lose_nor_double_the_money(maker, order):
    net = await network(maker)
    await close(maker, net, "0.00", now=at(6, 20))
    race = money_first if order == "money_first" else close_first
    second, sale_id = await race(maker, net, raw_sale(net), now=at(7, 20))
    third = await close(maker, net, "0.00", now=at(8, 20))
    if order == "money_first":
        assert await period_of(maker, Sale, sale_id) == 2
        assert (second.cash_in, third.cash_in) == (d("500.00"), d("0.00"))
    else:
        assert await period_of(maker, Sale, sale_id) == 3
        assert (second.cash_in, third.cash_in) == (d("0.00"), d("500.00"))


@pytest.mark.parametrize("order", ["money_first", "close_first"])
async def test_a_payment_taken_here_for_another_stores_debt_races_the_close(maker, order):
    net = await network(maker)
    await close(maker, net, "0.00", now=at(6, 20))
    debt = await sold_in_parts(
        maker, net, "1000.00", "100.00", "CARD", store=net.other, seller=net.child_seller
    )

    async def insert(session: Any) -> uuid.UUID:
        found = await session.scalar(
            sql_insert(CreditEntry)
            .values(
                organization_id=net.org,
                credit_id=debt.credit_id,
                kind="PAYMENT",
                amount=d("400.00"),
                command_id=uuid.uuid4(),
                command_fingerprint="0" * 64,
                actor_user_id=net.seller,
                payment_method="CASH",
                taken_at_store_id=net.store,
            )
            .returning(CreditEntry.id)
        )
        assert found is not None
        return found

    race = money_first if order == "money_first" else close_first
    second, entry = await race(maker, net, insert, now=at(7, 20))
    third = await close(maker, net, "0.00", now=at(8, 20))
    expected = (d("400.00"), d("0.00")) if order == "money_first" else (d("0.00"), d("400.00"))
    assert (second.cash_in, third.cash_in) == expected
    assert await period_of(maker, CreditEntry, entry) == (2 if order == "money_first" else 3)


@pytest.mark.parametrize("order", ["money_first", "close_first"])
async def test_a_refund_taken_here_for_another_stores_sale_races_the_close(maker, order):
    net = await network(maker)
    await close(maker, net, "0.00", now=at(6, 20))
    theirs = await sold(maker, net, "800.00", "CARD", store=net.other, seller=net.child_seller)

    async def insert(session: Any) -> uuid.UUID:
        found = await session.scalar(
            sql_insert(Refund)
            .values(
                organization_id=net.org,
                store_id=net.other,
                sale_id=theirs,
                taken_at_store_id=net.store,
                actor_user_id=net.seller,
                command_id=uuid.uuid4(),
                command_fingerprint="0" * 64,
                total_amount=d("800.00"),
                currency_code="UAH",
                payment_method="CASH",
            )
            .returning(Refund.id)
        )
        assert found is not None
        return found

    race = money_first if order == "money_first" else close_first
    second, refund = await race(maker, net, insert, now=at(7, 20))
    third = await close(maker, net, "0.00", now=at(8, 20))
    expected = (d("800.00"), d("0.00")) if order == "money_first" else (d("0.00"), d("800.00"))
    assert (second.cash_out, third.cash_out) == expected
    assert await period_of(maker, Refund, refund) == (2 if order == "money_first" else 3)


# --- «Клієнт забрав» --------------------------------------------------------------------------


@pytest.mark.parametrize("order", ["collect_first", "close_first"])
async def test_a_collect_and_a_close_never_lose_nor_double_the_money(maker, order):
    """Collecting takes no store lock of its own: only the stamp's hold on
    the store keeps the collected sale out of a close already summing."""
    shop, order_id = await setup(maker)
    await act(maker, shop, order_id, "dispatch")
    await act(maker, shop, order_id, "arrive")
    everything = shop.scope(frozenset(Permission))
    store = shop.store_id
    await close_in_task(maker, everything, store, now=at(6, 20))

    async def collect(session: Any) -> uuid.UUID:
        body = await transition_order(
            session,
            scope=everything,
            order_id=order_id,
            command_id=uuid.uuid4(),
            action="collect",
            payment_method=PaymentMethod.CASH,
        )
        return uuid.UUID(body["sale_id"])

    if order == "collect_first":
        async with maker() as collecting:
            sale_id = await collect(collecting)
            task = asyncio.create_task(close_in_task(maker, everything, store, now=at(7, 20)))
            await asyncio.sleep(WAIT)
            assert not task.done(), "the close did not wait for the collect in flight"
            await collecting.commit()
        second = await task
    else:

        async def collect_later() -> uuid.UUID:
            async with maker() as collecting:
                found = await collect(collecting)
                await collecting.commit()
                return found

        async with maker() as session:
            second = await closing(session, everything, store, now=at(7, 20))
            task = asyncio.create_task(collect_later())
            await asyncio.sleep(WAIT)
            assert not task.done(), "the collect did not wait for the close"
            await session.commit()
        sale_id = await task
    third = await close_in_task(maker, everything, store, now=at(8, 20))
    collected = (d("560.00"), d("0.00")) if order == "collect_first" else (d("0.00"), d("560.00"))
    assert (second.cash_in, third.cash_in) == collected
    assert await period_of(maker, Sale, sale_id) == (2 if order == "collect_first" else 3)


# --- a seller's correction and the close ------------------------------------------------------


@pytest.mark.parametrize("order", ["correction_first", "close_first"])
async def test_a_sellers_fix_and_the_close_agree_on_whether_the_day_was_open(maker, order):
    """Either the fix is in the close's expected cash, or it is refused as
    being of a closed day: never in neither, never counted in a close that
    did not see it (B6.2)."""
    net = await network(maker)
    await close(maker, net, "0.00", now=at(6, 20))
    card = await sold(maker, net, "700.00", "CARD")
    async with maker() as session:
        seller = await resolve_scope(session, net.seller)

    async def fix(session: Any) -> Any:
        return await correct(
            session,
            scope=seller,
            command_id=uuid.uuid4(),
            target=Target.SALE,
            target_id=card,
            from_method=PaymentMethod.CARD,
            to_method=PaymentMethod.CASH,
        )

    if order == "correction_first":
        async with maker() as fixing:
            await fix(fixing)
            task = asyncio.create_task(close_in_task(maker, seller, net.store, now=at(7, 20)))
            await asyncio.sleep(WAIT)
            assert not task.done(), "the close did not wait for the fix in flight"
            await fixing.commit()
        second = await task
        assert second.cash_corrected == d("700.00")
        return

    async def fix_later() -> Any:
        async with maker() as fixing:
            found = await fix(fixing)
            await fixing.commit()
            return found

    async with maker() as session:
        second = await closing(session, seller, net.store, now=at(7, 20))
        task = asyncio.create_task(fix_later())
        await asyncio.sleep(WAIT)
        assert not task.done(), "the fix did not wait for the close"
        await session.commit()
    error = await refused(task)
    assert isinstance(error, ValidationFailedError)
    assert error.details == {"reason": "DAY_CLOSED", "recorded": False}
    assert second.cash_corrected == d("0.00")


# --- two closes at once -------------------------------------------------------------------------


async def test_two_phones_closing_at_once_make_one_close(maker):
    """Both screens showed the same last close: one close is recorded, the
    other count was taken in a period already closed."""
    net = await network(maker)
    first = await close(maker, net, "100.00", now=days_ago(1))
    async with maker() as session:
        marina = await resolve_scope(session, net.seller)
        olena = await resolve_scope(session, net.colleague)

    async def count(scope: RequestScope) -> Any:
        async with maker() as session:
            found = await close_day(
                session,
                scope=scope,
                store_id=net.store,
                command_id=uuid.uuid4(),
                counted=d("100.00"),
                counted_at=datetime.now(UTC),
                after_close_id=first.id,
            )
            await session.commit()
            return found

    results = await asyncio.gather(count(marina), count(olena), return_exceptions=True)
    closes = [one for one in results if not isinstance(one, BaseException)]
    refusals = [one for one in results if isinstance(one, BaseException)]
    assert len(closes) == 1 and len(refusals) == 1, results
    [error] = refusals
    assert isinstance(error, ValidationFailedError)
    assert error.details["reason"] == "CLOSED_BY_ANOTHER"
    assert error.details["recorded"] is False


# --- two sends of one command ---------------------------------------------------------------------


async def twice(maker, send: Callable[[Any], Awaitable[Any]]) -> tuple[Any, Any]:
    """The first send writes and stays open; the second arrives meanwhile,
    and must wait for it rather than miss it.

    Each holds the store `FOR KEY SHARE` (`tenancy.service.hold_stores`), so
    two sends of one command do not wait for each other there: only the
    command's own lock — the one these tests are about — keeps them apart."""

    async def second() -> Any:
        async with maker() as session:
            found = await send(session)
            await session.commit()
            return found

    async with maker() as session:
        first = await send(session)
        task = asyncio.create_task(second())
        await asyncio.sleep(WAIT)
        assert not task.done(), "the second send did not wait for the first"
        await session.commit()
    return first, await task


async def count_of(maker, model: Any, **where: Any) -> int:
    async with maker() as session:
        query = select(func.count()).select_from(model)
        for column, value in where.items():
            query = query.where(getattr(model, column) == value)
        return int(await session.scalar(query) or 0)


async def test_a_movement_sent_twice_at_once_is_one_movement(maker):
    net = await network(maker)
    async with maker() as session:
        scope = await resolve_scope(session, net.seller)
    command = uuid.uuid4()

    async def send(session: Any) -> Any:
        return await record_movement(
            session,
            scope=scope,
            store_id=net.store,
            command_id=command,
            kind=MovementKind.EXPENSES,
            amount=d("150.00"),
            note="пакети",
            after_close_id=None,
        )

    first, second = await twice(maker, send)
    assert first.id == second.id
    assert await count_of(maker, CashMovement, command_id=command) == 1


async def test_a_correction_sent_twice_at_once_is_one_correction(maker):
    net = await network(maker)
    card = await sold(maker, net, "700.00", "CARD")
    async with maker() as session:
        scope = await resolve_scope(session, net.seller)
    command = uuid.uuid4()

    async def send(session: Any) -> Any:
        return await correct(
            session,
            scope=scope,
            command_id=command,
            target=Target.SALE,
            target_id=card,
            from_method=PaymentMethod.CARD,
            to_method=PaymentMethod.CASH,
        )

    first, second = await twice(maker, send)
    assert first.id == second.id
    assert await count_of(maker, PaymentCorrection, command_id=command) == 1


async def test_a_reason_sent_twice_at_once_is_one_reason(maker):
    net = await network(maker)
    await close(maker, net, "100.00", now=at(6, 20))
    await sold(maker, net, "500.00", "CASH")
    short = await close(maker, net, "550.00", now=at(7, 20))
    async with maker() as session:
        scope = await resolve_scope(session, net.seller)
    command = uuid.uuid4()

    async def send(session: Any) -> Any:
        return await give_reason(
            session, scope=scope, close_id=short.id, command_id=command, reason="здача"
        )

    first, second = await twice(maker, send)
    assert first.id == second.id == short.id
    assert await count_of(maker, CashCloseReason, close_id=short.id) == 1


async def test_two_reasons_for_one_close_at_once_are_one_reason_and_a_refusal(maker):
    net = await network(maker)
    await close(maker, net, "100.00", now=at(6, 20))
    await sold(maker, net, "500.00", "CASH")
    short = await close(maker, net, "550.00", now=at(7, 20))
    async with maker() as session:
        scope = await resolve_scope(session, net.seller)

    async def send(session: Any) -> Any:
        return await give_reason(
            session, scope=scope, close_id=short.id, command_id=uuid.uuid4(), reason="здача"
        )

    async def second() -> Any:
        async with maker() as session:
            await send(session)
            await session.commit()

    async with maker() as session:
        await send(session)
        task = asyncio.create_task(second())
        await asyncio.sleep(WAIT)
        assert not task.done(), "the second reason did not wait for the first"
        await session.commit()
    error = await refused(task)
    assert isinstance(error, ValidationFailedError)
    assert error.details == {"reason": "REASON_GIVEN", "recorded": False}
    assert await count_of(maker, CashCloseReason, close_id=short.id) == 1


async def test_a_payment_raced_by_nothing_still_names_its_period(maker):
    """Sanity of the helpers above: with no close in between, a payment taken
    here is in the open period."""
    net = await network(maker)
    debt = await sold_in_parts(maker, net, "1000.00", "100.00", "CASH")
    entry = await paid(maker, net, debt.credit_id, "300.00", "CARD")
    refund = await handed_back(maker, net, debt.sale_id, "500.00", None, credit_id=debt.credit_id)
    assert await period_of(maker, CreditEntry, entry) == 1
    assert await period_of(maker, Refund, refund) == 1


async def test_two_corrections_of_one_sale_at_once_are_decided_one_after_the_other(maker):
    """Two screens fixed the same card sale at once: the second meets the
    first's way, and is refused for having seen an older one."""
    net = await network(maker)
    card = await sold(maker, net, "700.00", "CARD")
    async with maker() as session:
        manager = await resolve_scope(session, net.manager)

    async def send(session: Any) -> Any:
        return await correct(
            session,
            scope=manager,
            command_id=uuid.uuid4(),
            target=Target.SALE,
            target_id=card,
            from_method=PaymentMethod.CARD,
            to_method=PaymentMethod.CASH,
        )

    async def second() -> Any:
        async with maker() as session:
            await send(session)
            await session.commit()

    async with maker() as session:
        await send(session)
        task = asyncio.create_task(second())
        await asyncio.sleep(WAIT)
        assert not task.done(), "the second correction did not wait for the first"
        await session.commit()
    error = await refused(task)
    assert isinstance(error, PaymentMethodChangedError)
    assert error.details == {"current": "CASH", "recorded": False}
    assert await count_of(maker, PaymentCorrection, sale_id=card) == 1
