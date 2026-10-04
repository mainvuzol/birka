"""The drawer's schema (revision 0035, ADR-0012), against real PostgreSQL.

What the database itself guarantees, whatever writes to it — a service, a
script or a test:

- every money row is stamped into its drawer's open period at insert: a sale
  into its store's, a payment into the drawer of the store that took it, a
  refund into the drawer of the store that took the goods back, cash moved
  and a correction into their store's; a return's and a write-off's ledger
  entries into none. A period the writer sends is overwritten;
- the stamp waits for a close that holds the store, and a close waits for a
  money row in flight, so a row is in exactly one close, by commit order;
- the stamp refuses to run at any isolation but READ COMMITTED, and the
  app's own sessions run at READ COMMITTED;
- the closes, their reasons, cash moved and corrections are append-only; a
  sale's and a refund's way and period never change;
- a correction carries its money row's drawer, amount and direction, names
  the close of a closed period, and follows the chain of earlier ones; the
  current way is the `to_method` of the highest correction, never the newest
  by time (`cash.current`), and a return suggests the way the sale was paid;
- every CHECK holds; the upgrade grants the drawer's permissions to an
  existing organization's roles as a new one gets them; the downgrade refuses
  once anything says how money was paid.

Rows are written straight into the tables, as a script would: this is about
the schema, not the commands. All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.core.config import Settings
from app.core.db import dispose_engine, get_sessionmaker, init_engine
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from app.modules.cash.current import (
    CurrentMethod,
    SaleMethods,
    entry_methods,
    refund_methods,
    sale_methods,
)
from app.modules.cash.models import (
    CashClose,
    CashCloseReason,
    CashMessage,
    CashMovement,
    PaymentCorrection,
)
from app.modules.credit.models import CreditEntry, CustomerCredit
from app.modules.refunds.models import Refund
from app.modules.sales.models import Sale
from app.modules.sales.payment import PaymentMethod
from app.modules.tenancy.models import Store
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import (
    TwoShops,
    api,
    key,
    make_two_shops,
    sale_body,
    stock_a_coat,
)

pytestmark = [pytest.mark.integration, requires_database()]

PRINT = "0" * 64
FIRST_DAY = date(2026, 10, 1)
CASH_PERMISSIONS = ("cash:close", "cash:expense", "cash:take_out", "cash:correct")


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


# --- rows, written as a script would write them ----------------------------


def sale_row(shops: TwoShops, store: uuid.UUID, **values: Any) -> dict[str, Any]:
    return {
        "organization_id": shops.organization_id,
        "store_id": store,
        "seller_user_id": shops.user_id,
        "command_id": uuid.uuid4(),
        "command_fingerprint": PRINT,
        "currency_code": "UAH",
        "subtotal": Decimal("1000.00"),
        "total": Decimal("1000.00"),
        **values,
    }


async def a_sale(session: AsyncSession, shops: TwoShops, store: uuid.UUID, **values: Any) -> Any:
    return await session.scalar(
        insert(Sale).values(**sale_row(shops, store, **values)).returning(Sale.id)
    )


async def a_credit(session: AsyncSession, shops: TwoShops, sale_id: uuid.UUID) -> Any:
    store = await session.scalar(select(Sale.store_id).where(Sale.id == sale_id))
    return await session.scalar(
        insert(CustomerCredit)
        .values(
            organization_id=shops.organization_id,
            store_id=store,
            sale_id=sale_id,
            customer_name="Оксана",
            customer_phone="0671234567",
            phone_digits="0671234567",
            amount=Decimal("1000.00"),
            currency_code="UAH",
            opened_by_user_id=shops.user_id,
        )
        .returning(CustomerCredit.id)
    )


def entry_row(shops: TwoShops, credit_id: uuid.UUID, **values: Any) -> dict[str, Any]:
    return {
        "organization_id": shops.organization_id,
        "credit_id": credit_id,
        "kind": "PAYMENT",
        "amount": Decimal("300.00"),
        "command_id": uuid.uuid4(),
        "command_fingerprint": PRINT,
        "actor_user_id": shops.user_id,
        **values,
    }


async def an_entry(
    session: AsyncSession, shops: TwoShops, credit_id: uuid.UUID, **values: Any
) -> Any:
    return await session.scalar(
        insert(CreditEntry)
        .values(**entry_row(shops, credit_id, **values))
        .returning(CreditEntry.id)
    )


def refund_row(shops: TwoShops, sale_id: uuid.UUID, taken_at: uuid.UUID, **values: Any) -> dict:
    return {
        "organization_id": shops.organization_id,
        "store_id": shops.primary_store,
        "sale_id": sale_id,
        "taken_at_store_id": taken_at,
        "actor_user_id": shops.user_id,
        "command_id": uuid.uuid4(),
        "command_fingerprint": PRINT,
        "total_amount": Decimal("1000.00"),
        "currency_code": "UAH",
        **values,
    }


async def a_refund(
    session: AsyncSession, shops: TwoShops, sale_id: uuid.UUID, taken_at: uuid.UUID, **values: Any
) -> Any:
    return await session.scalar(
        insert(Refund).values(**refund_row(shops, sale_id, taken_at, **values)).returning(Refund.id)
    )


def close_row(shops: TwoShops, store: uuid.UUID, number: int, **values: Any) -> dict[str, Any]:
    """Close `number`: an opening count for the first, otherwise one that
    started from 100,00 and was counted 10,00 short."""
    figures: dict[str, Any] = {
        "is_opening": True,
        "opening_float": None,
        "expected": None,
        "difference": None,
    }
    if number > 1:
        figures = {
            "is_opening": False,
            "opening_float": Decimal("100.00"),
            "expected": Decimal("150.00"),
            "difference": Decimal("-10.00"),
        }
    return {
        "organization_id": shops.organization_id,
        "store_id": store,
        "number": number,
        "business_day": FIRST_DAY + timedelta(days=number),
        "closed_at": datetime.now(tz=UTC),
        "actor_user_id": shops.user_id,
        "command_id": uuid.uuid4(),
        "command_fingerprint": PRINT,
        "counted": Decimal("140.00"),
        "cash_in": Decimal("50.00"),
        "cash_out": Decimal("0.00"),
        "taken_out": Decimal("0.00"),
        "put_in": Decimal("0.00"),
        "cash_corrected": Decimal("0.00"),
        **figures,
        **values,
    }


async def a_close(
    session: AsyncSession, shops: TwoShops, store: uuid.UUID, number: int, **values: Any
) -> Any:
    return await session.scalar(
        insert(CashClose)
        .values(**close_row(shops, store, number, **values))
        .returning(CashClose.id)
    )


def movement_row(shops: TwoShops, store: uuid.UUID, **values: Any) -> dict[str, Any]:
    return {
        "organization_id": shops.organization_id,
        "store_id": store,
        "kind": "EXPENSES",
        "direction": "OUT",
        "amount": Decimal("150.00"),
        "actor_user_id": shops.user_id,
        "command_id": uuid.uuid4(),
        "command_fingerprint": PRINT,
        **values,
    }


async def a_movement(
    session: AsyncSession, shops: TwoShops, store: uuid.UUID, **values: Any
) -> Any:
    return await session.scalar(
        insert(CashMovement)
        .values(**movement_row(shops, store, **values))
        .returning(CashMovement.id)
    )


def correction_row(shops: TwoShops, **values: Any) -> dict[str, Any]:
    return {
        "organization_id": shops.organization_id,
        "store_id": shops.primary_store,
        "seq": 1,
        "direction": "IN",
        "amount": Decimal("1000.00"),
        "from_method": "CARD",
        "to_method": "CASH",
        "actor_user_id": shops.user_id,
        "command_id": uuid.uuid4(),
        "command_fingerprint": PRINT,
        **values,
    }


async def a_correction(session: AsyncSession, shops: TwoShops, **values: Any) -> Any:
    return await session.scalar(
        insert(PaymentCorrection)
        .values(**correction_row(shops, **values))
        .returning(PaymentCorrection.id)
    )


async def period(session: AsyncSession, model: Any, row_id: uuid.UUID) -> int | None:
    return await session.scalar(select(model.drawer_period).where(model.id == row_id))


async def forget_the_ways(engine: AsyncEngine) -> None:
    """In a throwaway database only: take the way off every money row, as
    rows written before revision 0035 have none.

    For the tests of earlier revisions that make their sales and returns
    through today's commands, which require a way, and then go back below
    0035: its downgrade refuses once anything says how it was paid
    (ADR-0012, B13), and the rows' own guards refuse the change, so they are
    switched off around it."""
    async with engine.begin() as connection:
        for table, guard in (
            ("sale", "sale_money_guard"),
            ("refund", "refund_money_guard"),
            ("credit_entry", "credit_entry_append_only"),
        ):
            await connection.execute(text(f"ALTER TABLE {table} DISABLE TRIGGER {guard}"))
            await connection.execute(text(f"UPDATE {table} SET payment_method = NULL"))  # noqa: S608
            await connection.execute(text(f"ALTER TABLE {table} ENABLE TRIGGER {guard}"))


# --- the stamp ------------------------------------------------------------


async def test_every_money_row_is_stamped_into_its_drawers_open_period(maker):
    """The primary store has closed once; the child store never has. Each row
    lands in the period of the drawer its money went through."""
    shops = await make_two_shops(maker)
    here, there = shops.primary_store, shops.child_store
    async with maker() as session:
        await a_close(session, shops, here, 1)
        sale = await a_sale(session, shops, here)
        sold_there = await a_sale(session, shops, there)
        in_parts = await a_sale(session, shops, here)
        credit = await a_credit(session, shops, in_parts)
        first = await an_entry(session, shops, credit)
        later_elsewhere = await an_entry(session, shops, credit, taken_at_store_id=there)
        refund_here = await a_refund(session, shops, sale, here)
        refund_there = await a_refund(session, shops, sale, there)
        returned = await an_entry(
            session,
            shops,
            credit,
            kind="RETURN",
            amount=Decimal("0.00"),
            refund_id=refund_here,
            command_id=None,
            command_fingerprint=None,
        )
        written_off = await an_entry(session, shops, credit, kind="WRITE_OFF", note="поїхала")
        moved_here = await a_movement(session, shops, here)
        moved_there = await a_movement(session, shops, there)
        await session.commit()

        assert {
            "sale": await period(session, Sale, sale),
            "sale elsewhere": await period(session, Sale, sold_there),
            "first payment": await period(session, CreditEntry, first),
            "later payment, taken elsewhere": await period(session, CreditEntry, later_elsewhere),
            "refund": await period(session, Refund, refund_here),
            "refund elsewhere": await period(session, Refund, refund_there),
            "return entry": await period(session, CreditEntry, returned),
            "write-off": await period(session, CreditEntry, written_off),
            "take-out": await period(session, CashMovement, moved_here),
            "take-out elsewhere": await period(session, CashMovement, moved_there),
        } == {
            "sale": 2,
            "sale elsewhere": 1,
            "first payment": 2,
            "later payment, taken elsewhere": 1,
            "refund": 2,
            "refund elsewhere": 1,
            "return entry": None,
            "write-off": None,
            "take-out": 2,
            "take-out elsewhere": 1,
        }


async def test_a_period_the_writer_sends_is_overwritten(maker):
    shops = await make_two_shops(maker)
    async with maker() as session:
        sale = await a_sale(session, shops, shops.primary_store, drawer_period=99)
        credit = await a_credit(session, shops, sale)
        written_off = await an_entry(
            session, shops, credit, kind="WRITE_OFF", note="поїхала", drawer_period=5
        )
        moved = await a_movement(session, shops, shops.primary_store, drawer_period=99)
        await session.commit()

        assert await period(session, Sale, sale) == 1
        assert await period(session, CreditEntry, written_off) is None
        assert await period(session, CashMovement, moved) == 1


async def test_a_sale_at_the_till_is_stamped_and_its_answer_still_written(maker):
    """The real path: the sale is inserted, stamped, then updated with its
    answer — which the guard on its way and period lets through."""
    shops = await make_two_shops(maker)
    scope = shops.scope(shops.primary_store)
    async with api(maker, scope) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=1
        )
        sold = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size),
            headers=key(),
        )
    assert sold.status_code == 201, sold.text
    async with maker() as session:
        row = (
            await session.execute(
                select(Sale.drawer_period, Sale.response_snapshot).where(
                    Sale.id == uuid.UUID(sold.json()["id"])
                )
            )
        ).one()
    assert row.drawer_period == 1
    assert row.response_snapshot is not None


async def test_a_sale_written_while_a_close_holds_the_store_waits_and_lands_after_it(maker):
    """A raw INSERT takes no lock of its own before the trigger: the trigger's
    hold on the store is what keeps it out of the close being written."""
    shops = await make_two_shops(maker)
    store = shops.primary_store
    async with maker() as closing:
        await closing.execute(select(Store.id).where(Store.id == store).with_for_update())
        await a_close(closing, shops, store, 1)

        async def sell() -> Any:
            async with maker() as selling:
                sale = await a_sale(selling, shops, store)
                await selling.commit()
                return sale

        waiting = asyncio.create_task(sell())
        await asyncio.sleep(0.5)
        assert not waiting.done()
        await closing.commit()
    sale = await waiting
    async with maker() as session:
        assert await period(session, Sale, sale) == 2


async def test_a_close_waits_for_a_sale_in_flight_and_finds_it_in_its_period(maker):
    shops = await make_two_shops(maker)
    store = shops.primary_store
    async with maker() as selling:
        sale = await a_sale(selling, shops, store)

        async def close() -> int:
            async with maker() as closing:
                await closing.execute(select(Store.id).where(Store.id == store).with_for_update())
                found = await closing.scalar(
                    select(func.count())
                    .select_from(Sale)
                    .where(Sale.store_id == store, Sale.drawer_period == 1)
                )
                await a_close(closing, shops, store, 1)
                await closing.commit()
                return int(found or 0)

        waiting = asyncio.create_task(close())
        await asyncio.sleep(0.5)
        assert not waiting.done()
        await selling.commit()
    assert await waiting == 1
    async with maker() as session:
        assert await period(session, Sale, sale) == 1


async def test_the_stamp_refuses_repeatable_read(maker):
    """At REPEATABLE READ it would read a snapshot taken before a close it
    waited for, and place the money in a period already summed."""
    shops = await make_two_shops(maker)
    async with maker() as session:
        await session.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        with pytest.raises(DBAPIError, match="drawer periods need READ COMMITTED"):
            await a_sale(session, shops, shops.primary_store)


async def test_the_apps_own_sessions_run_at_read_committed():
    """The engine sets no isolation; a role's, the database's or the server's
    default could. Read through the app's own session factory."""
    settings = Settings(
        app_env="local",
        session_secret="cash-schema-secret-at-least-32-bytes-long",
        database_url=os.environ["BIRKA_TEST_DATABASE_URL"],
    )
    init_engine(settings)
    try:
        async with get_sessionmaker()() as session:
            assert await session.scalar(text("SHOW transaction_isolation")) == "read committed"
    finally:
        await dispose_engine()


# --- never rewritten ------------------------------------------------------


@pytest.mark.parametrize(
    "table", ["cash_close", "cash_close_reason", "cash_movement", "payment_correction"]
)
async def test_the_drawers_records_are_append_only(maker, table):
    shops = await make_two_shops(maker)
    async with maker() as session:
        close = await a_close(session, shops, shops.primary_store, 1)
        sale = await a_sale(session, shops, shops.primary_store, payment_method="CARD")
        await session.execute(
            insert(CashCloseReason).values(
                organization_id=shops.organization_id,
                close_id=close,
                reason="помилилась зі здачею",
                actor_user_id=shops.user_id,
                command_id=uuid.uuid4(),
                command_fingerprint=PRINT,
            )
        )
        await a_movement(session, shops, shops.primary_store)
        await a_correction(session, shops, sale_id=sale)
        await session.commit()

    for statement in (
        f"UPDATE {table} SET created_at = now() WHERE organization_id = :org",  # noqa: S608
        f"DELETE FROM {table} WHERE organization_id = :org",  # noqa: S608
    ):
        async with maker() as session:
            with pytest.raises(DBAPIError, match="append-only"):
                await session.execute(text(statement), {"org": shops.organization_id})


@pytest.mark.parametrize(
    ("model", "values"),
    [
        (Sale, {"payment_method": "CASH"}),
        (Sale, {"drawer_period": 7}),
        (Refund, {"payment_method": "CASH"}),
        (Refund, {"drawer_period": 7}),
    ],
)
async def test_a_money_rows_way_and_period_never_change(maker, model, values):
    shops = await make_two_shops(maker)
    async with maker() as session:
        sale = await a_sale(session, shops, shops.primary_store, payment_method="CARD")
        refund = await a_refund(session, shops, sale, shops.primary_store, payment_method="CARD")
        await session.commit()
    row = sale if model is Sale else refund
    async with maker() as session:
        with pytest.raises(DBAPIError, match="never changed"):
            await session.execute(update(model).where(model.id == row).values(**values))


async def test_the_rest_of_a_sale_may_still_be_written(maker):
    """Tests backdate a sale, and the till writes a sale's answer after it."""
    shops = await make_two_shops(maker)
    async with maker() as session:
        sale = await a_sale(session, shops, shops.primary_store, payment_method="CARD")
        await session.execute(
            update(Sale)
            .where(Sale.id == sale)
            .values(sold_at=datetime(2026, 9, 1, tzinfo=UTC), response_snapshot={"id": str(sale)})
        )
        await session.commit()
        assert (await session.get(Sale, sale)).sold_at == datetime(2026, 9, 1, tzinfo=UTC)  # type: ignore[union-attr]


# --- corrections ----------------------------------------------------------


async def test_corrections_of_each_money_row_are_stamped_and_chained(maker):
    shops = await make_two_shops(maker)
    here, there = shops.primary_store, shops.child_store
    async with maker() as session:
        await a_close(session, shops, there, 1)
        sale = await a_sale(session, shops, here, payment_method="CARD")
        in_parts = await a_sale(session, shops, here, payment_method="CASH")
        credit = await a_credit(session, shops, in_parts)
        payment = await an_entry(session, shops, credit, payment_method="CASH")
        taken_there = await an_entry(
            session, shops, credit, payment_method="CASH", taken_at_store_id=there
        )
        refund = await a_refund(
            session,
            shops,
            in_parts,
            there,
            payment_method="CARD",
            total_amount=Decimal("800.00"),
        )
        # A sale paid in parts hands back only what was paid beyond the debt.
        await an_entry(
            session,
            shops,
            credit,
            kind="RETURN",
            amount=Decimal("700.00"),
            cash_back=Decimal("100.00"),
            refund_id=refund,
            command_id=None,
            command_fingerprint=None,
        )
        first = await a_correction(session, shops, sale_id=sale)
        second = await a_correction(
            session, shops, sale_id=sale, seq=2, from_method="CASH", to_method="TRANSFER"
        )
        of_payment = await a_correction(
            session,
            shops,
            credit_entry_id=payment,
            amount=Decimal("300.00"),
            from_method="CASH",
            to_method="CARD",
        )
        # In the drawer of the store that took it.
        of_payment_there = await a_correction(
            session,
            shops,
            credit_entry_id=taken_there,
            store_id=there,
            amount=Decimal("300.00"),
            from_method="CASH",
            to_method="TRANSFER",
        )
        of_refund = await a_correction(
            session,
            shops,
            refund_id=refund,
            store_id=there,
            direction="OUT",
            amount=Decimal("100.00"),
            from_method="CARD",
            to_method="CASH",
        )
        await session.commit()

        assert [
            await period(session, PaymentCorrection, row)
            for row in (first, second, of_payment, of_payment_there, of_refund)
        ] == [1, 1, 1, 2, 2]


async def test_a_correction_of_a_closed_period_names_its_close(maker):
    shops = await make_two_shops(maker)
    async with maker() as session:
        sale = await a_sale(session, shops, shops.primary_store, payment_method="CARD")
        close = await a_close(session, shops, shops.primary_store, 1)
        await session.commit()
    async with maker() as session:
        with pytest.raises(DBAPIError, match="explains the close"):
            await a_correction(session, shops, sale_id=sale)
    async with maker() as session:
        correction = await a_correction(session, shops, sale_id=sale, explains_close_id=close)
        await session.commit()
        assert await period(session, PaymentCorrection, correction) == 2


async def before_the_drawer(session: AsyncSession, shops: TwoShops) -> Any:
    """A sale as revision 0034 wrote it: no way, and in no period."""
    await session.execute(text("ALTER TABLE sale DISABLE TRIGGER sale_drawer_period"))
    sale = await a_sale(session, shops, shops.primary_store)
    await session.execute(text("ALTER TABLE sale ENABLE TRIGGER sale_drawer_period"))
    return sale


@pytest.mark.parametrize(
    ("change", "refusal"),
    [
        ({"store_id": "child"}, "drawer, amount and direction"),
        ({"amount": Decimal("999.00")}, "drawer, amount and direction"),
        ({"direction": "OUT"}, "drawer, amount and direction"),
        ({"explains_close_id": "close of the child store"}, "explains the close"),
        ({"seq": 2}, "follows the last one"),
        ({"from_method": "TRANSFER"}, "changes the way its money row has now"),
        ({"from_method": None}, "changes the way its money row has now"),
        ({"sale_id": "paid in parts"}, "corrected through its first payment"),
        ({"sale_id": "before the drawer"}, "in no drawer period"),
        ({"sale_id": None, "credit_entry_id": "write-off"}, "in no drawer period"),
    ],
)
async def test_the_correction_trigger_refuses_what_its_money_row_contradicts(
    maker, change, refusal
):
    shops = await make_two_shops(maker)
    async with maker() as session:
        sale = await a_sale(session, shops, shops.primary_store, payment_method="CARD")
        in_parts = await a_sale(session, shops, shops.primary_store, payment_method="CARD")
        credit = await a_credit(session, shops, in_parts)
        written_off = await an_entry(session, shops, credit, kind="WRITE_OFF", note="поїхала")
        elsewhere = await a_close(session, shops, shops.child_store, 1)
        old = await before_the_drawer(session, shops)
        await session.commit()
    named = {
        "child": shops.child_store,
        "close of the child store": elsewhere,
        "paid in parts": in_parts,
        "before the drawer": old,
        "write-off": written_off,
    }
    values = {"sale_id": sale} | {
        column: named.get(value, value) if isinstance(value, str) else value
        for column, value in change.items()
    }
    async with maker() as session:
        with pytest.raises(DBAPIError, match=refusal):
            await a_correction(session, shops, **values)


# --- every CHECK ----------------------------------------------------------


async def _valid_rows(maker, shops: TwoShops) -> dict[str, dict[str, Any]]:
    """One valid row of each table, each case below breaking one thing."""
    async with maker() as session:
        sale = await a_sale(session, shops, shops.primary_store, payment_method="CARD")
        credit = await a_credit(session, shops, sale)
        # The child store's: the primary store's rows below have none of
        # their own, and a close of another store is what a movement may not
        # name.
        close = await a_close(session, shops, shops.child_store, 1)
        await session.commit()
    return {
        "sale": sale_row(shops, shops.primary_store),
        "credit_entry": entry_row(shops, credit),
        "refund": refund_row(shops, sale, shops.primary_store),
        "cash_close": close_row(shops, shops.primary_store, 7),
        "cash_close_reason": {
            "organization_id": shops.organization_id,
            "close_id": close,
            "reason": "помилилась зі здачею",
            "actor_user_id": shops.user_id,
            "command_id": uuid.uuid4(),
            "command_fingerprint": PRINT,
        },
        "cash_movement": movement_row(shops, shops.primary_store),
        "payment_correction": correction_row(shops, sale_id=sale),
        "cash_message": {
            "organization_id": shops.organization_id,
            "close_id": close,
            "user_id": shops.user_id,
            "text": "Каса «Основний»: нестача 10,00 грн.",
        },
        "other store's close": {"id": close},
        "the credit": {"id": credit},
    }


MODELS: dict[str, Any] = {
    "sale": Sale,
    "credit_entry": CreditEntry,
    "refund": Refund,
    "cash_close": CashClose,
    "cash_close_reason": CashCloseReason,
    "cash_movement": CashMovement,
    "payment_correction": PaymentCorrection,
    "cash_message": CashMessage,
}
# The stamps set or check what the CHECKs below also hold; with the trigger
# on, they would refuse first, or overwrite the value. The CHECKs stand for
# when it is off: a restore, a script with triggers disabled.
STAMPS = {
    "sale": "sale_drawer_period",
    "credit_entry": "credit_entry_drawer_period",
    "refund": "refund_drawer_period",
    "cash_movement": "cash_movement_drawer_period",
    "payment_correction": "payment_correction_stamp",
}
WRITE_OFF = {"kind": "WRITE_OFF", "note": "поїхала"}


@pytest.mark.parametrize(
    ("table", "change", "constraint", "stamp_off"),
    [
        ("sale", {"payment_method": "CHEQUE"}, "ck_sale_payment_method_known", False),
        ("sale", {"drawer_period": 0}, "ck_sale_drawer_period_positive", True),
        (
            "credit_entry",
            {"payment_method": "CHEQUE"},
            "ck_credit_entry_payment_method_known",
            False,
        ),
        (
            "credit_entry",
            WRITE_OFF | {"payment_method": "CASH"},
            "ck_credit_entry_only_a_payment_has_a_method",
            False,
        ),
        (
            "credit_entry",
            WRITE_OFF | {"drawer_period": 3},
            "ck_credit_entry_only_a_payment_has_a_period",
            True,
        ),
        ("credit_entry", {"drawer_period": 0}, "ck_credit_entry_drawer_period_positive", True),
        # Money goes back through the till: never in advance or by the carrier.
        ("refund", {"payment_method": "CARRIER_COD"}, "ck_refund_payment_method_known", False),
        ("refund", {"drawer_period": 0}, "ck_refund_drawer_period_positive", True),
        ("cash_close", {"number": 0}, "ck_cash_close_number_positive", False),
        (
            "cash_close",
            {"counted": Decimal("-1.00"), "difference": Decimal("-151.00")},
            "ck_cash_close_counted_not_negative",
            False,
        ),
        ("cash_close", {"number": 1}, "ck_cash_close_first_is_opening", False),
        ("cash_close", {"is_opening": True}, "ck_cash_close_opening_has_no_float", False),
        ("cash_close", {"expected": None}, "ck_cash_close_expected_with_float", False),
        (
            "cash_close",
            {"expected": Decimal("151.00"), "difference": Decimal("-11.00")},
            "ck_cash_close_expected_is_the_sum",
            False,
        ),
        (
            "cash_close",
            {"difference": Decimal("-9.00")},
            "ck_cash_close_difference_is_counted",
            False,
        ),
        ("cash_close", {"others": []}, "ck_cash_close_others_object", False),
        ("cash_close_reason", {"reason": "   "}, "ck_cash_close_reason_says_why", False),
        ("cash_close_reason", {"reason": "я" * 1001}, "ck_cash_close_reason_says_why", False),
        ("cash_movement", {"kind": "OTHER"}, "ck_cash_movement_kind_known", False),
        ("cash_movement", {"direction": "UP"}, "ck_cash_movement_direction_known", False),
        ("cash_movement", {"kind": "CHANGE"}, "ck_cash_movement_direction_of_kind", False),
        (
            "cash_movement",
            {"kind": "OWNER", "direction": "IN"},
            "ck_cash_movement_direction_of_kind",
            False,
        ),
        ("cash_movement", {"amount": Decimal("0.00")}, "ck_cash_movement_amount_positive", False),
        ("cash_movement", {"note": "я" * 201}, "ck_cash_movement_note_short", False),
        ("cash_movement", {"moved_to_close": True}, "ck_cash_movement_moved_names_close", False),
        ("cash_movement", {"drawer_period": 0}, "ck_cash_movement_drawer_period_positive", True),
        (
            "cash_movement",
            {"for_close_id": "other store's close"},
            "fk_cash_movement_store_for_close",
            False,
        ),
        (
            "payment_correction",
            {"credit_entry_id": "a payment"},
            "ck_payment_correction_one_money_row",
            True,
        ),
        ("payment_correction", {"sale_id": None}, "ck_payment_correction_one_money_row", True),
        ("payment_correction", {"direction": "UP"}, "ck_payment_correction_direction_known", True),
        ("payment_correction", {"direction": "OUT"}, "ck_payment_correction_out_is_a_refund", True),
        (
            "payment_correction",
            {"from_method": "CHEQUE"},
            "ck_payment_correction_from_method_known",
            True,
        ),
        (
            "payment_correction",
            {"to_method": "CHEQUE"},
            "ck_payment_correction_to_method_known",
            True,
        ),
        (
            "payment_correction",
            {"from_method": "CASH"},
            "ck_payment_correction_changes_the_way",
            True,
        ),
        (
            "payment_correction",
            {"amount": Decimal("-1.00")},
            "ck_payment_correction_amount_not_negative",
            True,
        ),
        ("payment_correction", {"seq": 0}, "ck_payment_correction_seq_positive", True),
        ("payment_correction", {"note": "я" * 201}, "ck_payment_correction_note_short", True),
        (
            "payment_correction",
            {"drawer_period": 0},
            "ck_payment_correction_drawer_period_positive",
            True,
        ),
        ("cash_message", {"status": "LOST"}, "ck_cash_message_status_known", False),
        ("cash_message", {"status": "SENT"}, "ck_cash_message_sent_has_time", False),
        ("cash_message", {"attempts": -1}, "ck_cash_message_attempts_not_negative", False),
    ],
)
async def test_every_check_refuses_the_row_it_is_about(maker, table, change, constraint, stamp_off):
    shops = await make_two_shops(maker)
    rows = await _valid_rows(maker, shops)
    named = {"other store's close": rows["other store's close"]["id"]}
    async with maker() as session:
        if change.get("credit_entry_id") == "a payment":
            named["a payment"] = await an_entry(session, shops, rows["the credit"]["id"])
        values = rows[table] | {
            column: named.get(value, value) if isinstance(value, str) else value
            for column, value in change.items()
        }
        if stamp_off:
            await session.execute(text(f"ALTER TABLE {table} DISABLE TRIGGER {STAMPS[table]}"))
        with pytest.raises(IntegrityError, match=constraint):
            await session.execute(insert(MODELS[table]).values(**values))
        # Rolled back on the way out: the trigger is on again.


async def test_a_store_closes_once_per_number_and_once_per_business_day(maker):
    shops = await make_two_shops(maker)
    async with maker() as session:
        await a_close(session, shops, shops.primary_store, 1)
        await session.commit()
    for values, constraint in (
        ({"business_day": FIRST_DAY + timedelta(days=9)}, "uq_cash_close_store_id_number"),
        ({"number": 2}, "uq_cash_close_store_id_business_day"),
    ):
        row = close_row(shops, shops.primary_store, 1) | values
        if values.get("number") == 2:
            row |= {
                "is_opening": False,
                "opening_float": Decimal("100.00"),
                "expected": Decimal("150.00"),
                "difference": Decimal("-10.00"),
            }
        async with maker() as session:
            with pytest.raises(IntegrityError, match=constraint):
                await session.execute(insert(CashClose).values(**row))


# --- the current way -----------------------------------------------------


async def test_the_current_way_is_that_of_the_highest_correction_never_the_newest(maker):
    """Two corrections of one sale, the first written with the later time:
    the chain decides, not the clock (ADR-0012, B6.1)."""
    shops = await make_two_shops(maker)
    later = datetime.now(tz=UTC) + timedelta(hours=1)
    async with maker() as session:
        sale = await a_sale(session, shops, shops.primary_store, payment_method="CARD")
        untouched = await a_sale(session, shops, shops.primary_store, payment_method="CARD")
        refund = await a_refund(session, shops, sale, shops.primary_store, payment_method="CARD")
        await a_correction(session, shops, sale_id=sale, created_at=later)
        await a_correction(
            session, shops, sale_id=sale, seq=2, from_method="CASH", to_method="TRANSFER"
        )
        await a_correction(
            session,
            shops,
            refund_id=refund,
            direction="OUT",
            from_method="CARD",
            to_method="CASH",
        )
        await session.commit()

        methods = await sale_methods(session, [sale, untouched, uuid.uuid4()])
        refunds = await refund_methods(session, [refund])

    card, cash, transfer = PaymentMethod.CARD, PaymentMethod.CASH, PaymentMethod.TRANSFER
    assert methods == {
        sale: SaleMethods(
            taken_with_sale=CurrentMethod(stated=card, method=transfer, corrected=True),
            payments=frozenset(),
            refund_method=transfer,
        ),
        untouched: SaleMethods(
            taken_with_sale=CurrentMethod(stated=card, method=card, corrected=False),
            payments=frozenset(),
            refund_method=card,
        ),
    }
    assert refunds == {refund: CurrentMethod(stated=card, method=cash, corrected=True)}


@pytest.mark.parametrize(
    ("way", "suggested"),
    [
        ("CASH", PaymentMethod.CASH),
        ("CARD", PaymentMethod.CARD),
        ("TRANSFER", PaymentMethod.TRANSFER),
        # An order paid off the till goes back by transfer (ADR-0012, G4).
        ("PREPAID_TRANSFER", PaymentMethod.TRANSFER),
        ("CARRIER_COD", PaymentMethod.TRANSFER),
        # Never stated: nothing is guessed, the seller chooses.
        (None, None),
    ],
)
async def test_a_return_suggests_the_way_a_sale_paid_in_full_was_paid(maker, way, suggested):
    shops = await make_two_shops(maker)
    async with maker() as session:
        sale = await a_sale(session, shops, shops.primary_store, payment_method=way)
        await session.commit()
        methods = await sale_methods(session, [sale])
    assert methods[sale].refund_method is suggested


@pytest.mark.parametrize(
    ("first", "later", "suggested"),
    [
        ("CASH", ["CASH"], PaymentMethod.CASH),
        # Several ways: nothing is suggested (ADR-0012, G5).
        ("CASH", ["CARD"], None),
        ("PREPAID_TRANSFER", [], PaymentMethod.TRANSFER),
        # A payment that never said how: nothing is guessed.
        ("CASH", [None], None),
    ],
)
async def test_a_sale_paid_in_parts_is_its_first_payment_and_suggests_one_way_only(
    maker, first, later, suggested
):
    shops = await make_two_shops(maker)
    async with maker() as session:
        command = uuid.uuid4()
        sale = await a_sale(
            session, shops, shops.primary_store, payment_method=first, command_id=command
        )
        credit = await a_credit(session, shops, sale)
        # Written before the first, so neither time nor order of writing
        # finds it: the first payment is the sale's own command.
        for way in later:
            await an_entry(session, shops, credit, payment_method=way)
        first_payment = await an_entry(
            session, shops, credit, payment_method=first, command_id=command
        )
        written_off = await an_entry(session, shops, credit, kind="WRITE_OFF", note="поїхала")
        await session.commit()
        methods = await sale_methods(session, [sale])
        entries = await entry_methods(session, [first_payment, written_off])

    stated = PaymentMethod(first)
    assert methods[sale] == SaleMethods(
        taken_with_sale=CurrentMethod(stated=stated, method=stated, corrected=False),
        payments=frozenset({stated} | {PaymentMethod(w) if w else None for w in later}),
        refund_method=suggested,
    )
    assert entries == {
        first_payment: CurrentMethod(stated=stated, method=stated, corrected=False),
        written_off: CurrentMethod(stated=None, method=None, corrected=False),
    }


async def test_a_corrected_first_payment_is_what_the_sale_took(maker):
    shops = await make_two_shops(maker)
    async with maker() as session:
        command = uuid.uuid4()
        sale = await a_sale(
            session, shops, shops.primary_store, payment_method="CARD", command_id=command
        )
        credit = await a_credit(session, shops, sale)
        first_payment = await an_entry(
            session, shops, credit, payment_method="CARD", command_id=command
        )
        await a_correction(session, shops, credit_entry_id=first_payment, amount=Decimal("300.00"))
        await session.commit()
        methods = await sale_methods(session, [sale])

    card, cash = PaymentMethod.CARD, PaymentMethod.CASH
    assert methods[sale] == SaleMethods(
        taken_with_sale=CurrentMethod(stated=card, method=cash, corrected=True),
        payments=frozenset({cash}),
        refund_method=cash,
    )


# --- the upgrade and the downgrade ---------------------------------------


async def _roles_of(engine: AsyncEngine, roles: dict[str, uuid.UUID]) -> dict[str, set[str]]:
    async with engine.connect() as connection:
        return {
            code: set(
                (
                    await connection.scalars(
                        text("SELECT permission_code FROM role_permission WHERE role_id = :id"),
                        {"id": role_id},
                    )
                ).all()
            )
            for code, role_id in roles.items()
        }


async def test_the_upgrade_gives_an_existing_organization_the_drawer_as_a_new_one_gets_it():
    """Roles seeded before 0035 hold, after it, exactly what a new
    organization's roles hold; a role an owner composed gets the drawer
    with what it already does."""
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_cash_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "0034_server_incidents", database=name)
        shops = await make_two_shops(async_sessionmaker(engine, expire_on_commit=False))
        before = {
            role.value: {
                permission.value
                for permission in DEFAULT_ROLE_PERMISSIONS[role]
                if permission.value not in CASH_PERMISSIONS
            }
            for role in RoleCode
        } | {
            "CASHIER": {"sale:create"},
            "BOOKKEEPER": {"report:view_financial"},
            "VIEWER": {"sale:view"},
        }
        roles: dict[str, uuid.UUID] = {}
        async with engine.begin() as connection:
            for code, held in before.items():
                roles[code] = uuid.uuid4()
                await connection.execute(
                    text(
                        "INSERT INTO role (id, organization_id, code, name, is_system, "
                        "created_at) VALUES (:id, :org, :code, :code, false, now())"
                    ),
                    {"id": roles[code], "org": shops.organization_id, "code": code},
                )
                for permission in held:
                    await connection.execute(
                        text(
                            "INSERT INTO role_permission (role_id, permission_code) "
                            "VALUES (:id, :held)"
                        ),
                        {"id": roles[code], "held": permission},
                    )
        await _run(config, "upgrade", "head", database=name)

        assert await _roles_of(engine, roles) == {
            role.value: {permission.value for permission in DEFAULT_ROLE_PERMISSIONS[role]}
            for role in RoleCode
        } | {
            "CASHIER": {"sale:create", "cash:close", "cash:expense"},
            "BOOKKEEPER": {"report:view_financial", "cash:take_out", "cash:correct"},
            "VIEWER": {"sale:view"},
        }
        await _run(config, "downgrade", "0034_server_incidents", database=name)
        assert await _roles_of(engine, roles) == before
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def test_the_downgrade_refuses_once_anything_says_how_money_was_paid():
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_cash_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        shops = await make_two_shops(fresh)
        # Stamped, but saying nothing of how it was paid: as the code before
        # the way of paying would write it during a rollback.
        async with fresh() as session:
            await a_sale(session, shops, shops.primary_store)
            await session.commit()
        await _run(config, "downgrade", "0034_server_incidents", database=name)
        await _run(config, "upgrade", "head", database=name)

        async with fresh() as session:
            with_a_way = await a_sale(session, shops, shops.primary_store, payment_method="CASH")
            await session.commit()
        with pytest.raises(Exception, match="0034 cannot say how anything was paid"):
            await _run(config, "downgrade", "0034_server_incidents", database=name)
        async with fresh() as session:
            await session.execute(text("DELETE FROM sale WHERE id = :id"), {"id": with_a_way})
            await a_close(session, shops, shops.primary_store, 1)
            await session.commit()
        with pytest.raises(Exception, match="0034 cannot say how anything was paid"):
            await _run(config, "downgrade", "0034_server_incidents", database=name)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
