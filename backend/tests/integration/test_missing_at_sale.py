"""«Фізично відсутній» — the bounded negative correction during a sale (M1-030).

The owner settled the open question on 2026-09-17: **the sale proceeds for the
quantity that is actually there.** A customer holding one coat can buy it, and
the unit the system believed in is taken off the shelf with its own reason.

What these tests are really guarding is the blast radius. The positive half
(`FOUND_DURING_SALE`) is safe to give a seller because it is capped at the
shortfall of the line being sold. The negative half has no such cap by nature —
"the shelf is emptier than you think" is a statement about the whole shelf —
so two bounds are imposed and pinned here: the line being sold, and what the
ledger already believed. Past either of those it would be a stocktake, which
needs `inventory:adjust` and a manager.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.errors import (
    IdempotencyConflictError,
    InsufficientStockError,
    NotFoundError,
    PermissionDeniedError,
    ValidationFailedError,
)
from app.modules.authz.permissions import Permission
from app.modules.inventory.service import current_quantity, find_divergences
from app.modules.sales.service import FoundInStore, MissingInStore, SaleLineInput
from tests.conftest import requires_database
from tests.integration.test_sale_command import (
    SELLER_PERMISSIONS,
    basket,
    give_stock,
    make_shop,
    sell,
)

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
async def session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with async_sessionmaker(engine, expire_on_commit=False)() as opened:
        yield opened
        await opened.rollback()


# A seller who may report a shortage holds this on top of the seller default,
# which deliberately does not include it.
REPORTER = SELLER_PERMISSIONS | {Permission.INVENTORY_REPORT_MISSING_DURING_SALE}


async def on_hand(session: AsyncSession, shop) -> int:
    return await current_quantity(
        session,
        location_id=shop.location_id,
        product_variant_id=shop.variant_id,
        size_id=shop.size_id,
    )


async def movements(session: AsyncSession, shop) -> list[tuple]:
    rows = (
        await session.execute(
            text(
                "SELECT movement_type, quantity_delta, reason_code FROM stock_movement"
                " WHERE location_id = :l ORDER BY created_at, quantity_delta"
            ),
            {"l": shop.location_id},
        )
    ).all()
    return [tuple(row) for row in rows]


# --- the owner's answer ------------------------------------------------------


async def test_the_sale_proceeds_for_the_quantity_that_is_there(session: AsyncSession) -> None:
    """Two coats expected, one on the rack: one is sold, one is written off.

    The money follows the goods — the customer pays for what they carry out,
    not for what the app believed.
    """
    shop = await make_shop(session)
    await give_stock(session, shop, 5)

    result = await sell(
        session,
        shop,
        scope=shop.scope(REPORTER),
        lines=basket(shop, quantity=2, price="1200.00"),
        missing_in_store=[MissingInStore(line_index=0, quantity=1)],
    )
    await session.commit()

    assert result.items[0].quantity == 1
    assert result.sale.total == Decimal("1200.00")
    assert len(result.shortages) == 1
    assert result.corrections == []

    # 5 − 1 written off − 1 sold.
    assert await on_hand(session, shop) == 3
    assert ("ADJUSTMENT", -1, "MISSING_AT_SALE") in await movements(session, shop)
    assert ("SALE", -1, None) in await movements(session, shop)
    assert await find_divergences(session, location_id=shop.location_id) == []


async def test_the_write_off_is_capped_by_the_line_not_by_the_shelf(session: AsyncSession) -> None:
    """The seller went for two and found one. That says nothing about the other
    eight, and the correction must not pretend otherwise — a whole-shelf count
    is a stocktake, and `inventory:adjust` is where it lives."""
    shop = await make_shop(session)
    await give_stock(session, shop, 10)

    await sell(
        session,
        shop,
        scope=shop.scope(REPORTER),
        lines=basket(shop, quantity=2),
        missing_in_store=[MissingInStore(line_index=0, quantity=1)],
    )
    await session.commit()

    assert await on_hand(session, shop) == 8
    assert await find_divergences(session, location_id=shop.location_id) == []


async def test_nothing_is_written_off_that_the_ledger_did_not_believe_in(
    session: AsyncSession,
) -> None:
    """The system already said one; the seller found one. There is no
    discrepancy — and a correction here would drive the balance negative.

    The sale is still for the confirmed quantity: the report is honoured even
    when it turns out the ledger had nothing to answer for.
    """
    shop = await make_shop(session)
    await give_stock(session, shop, 1)

    result = await sell(
        session,
        shop,
        scope=shop.scope(REPORTER),
        lines=basket(shop, quantity=2),
        missing_in_store=[MissingInStore(line_index=0, quantity=1)],
    )
    await session.commit()

    assert result.items[0].quantity == 1
    assert result.shortages == []
    assert await on_hand(session, shop) == 0
    assert [m for m in await movements(session, shop) if m[2] == "MISSING_AT_SALE"] == []
    assert await find_divergences(session, location_id=shop.location_id) == []


async def test_two_lines_on_one_shelf_are_one_statement_about_it(session: AsyncSession) -> None:
    """A basket may name the same goods twice. The shortage is then resolved
    against the shelf, not line by line: the ledger believed in four for this
    basket, three were found, one comes off."""
    shop = await make_shop(session)
    await give_stock(session, shop, 6)

    result = await sell(
        session,
        shop,
        scope=shop.scope(REPORTER),
        lines=basket(shop, quantity=3) + basket(shop, quantity=1),
        missing_in_store=[MissingInStore(line_index=0, quantity=2)],
    )
    await session.commit()

    assert [item.quantity for item in result.items] == [2, 1]
    assert len(result.shortages) == 1
    # 6 − 1 written off − 3 sold.
    assert await on_hand(session, shop) == 2
    assert await find_divergences(session, location_id=shop.location_id) == []


# --- the refusals ------------------------------------------------------------


async def test_a_shortage_report_can_never_add_stock(session: AsyncSession) -> None:
    """The one way this path could mint stock, closed.

    The seller reports *more* units present than the ledger believes in, on a
    line asking for more still. That is a claim goods appeared, which is the
    other direction entirely — it needs `found_in_store` and its own
    permission. Here it must write nothing and the sale must fail honestly on
    the stock that is actually recorded.
    """
    shop = await make_shop(session)
    await give_stock(session, shop, 1)

    with pytest.raises(InsufficientStockError):
        await sell(
            session,
            shop,
            scope=shop.scope(REPORTER),
            lines=basket(shop, quantity=3),
            missing_in_store=[MissingInStore(line_index=0, quantity=2)],
        )
    await session.rollback()

    assert await on_hand(session, shop) == 1
    assert await movements(session, shop) == [("DELIVERY", 1, None)]


async def test_a_basket_with_nothing_present_is_not_a_sale(session: AsyncSession) -> None:
    """Owner decision, 2026-10-01 (Q-G): a line with nothing present is
    dropped and the rest sold. With nothing else in the basket there is no sale
    to make, so the sale command refuses and writes nothing; the empty shelf
    is recorded by its own command (`test_empty_shelf.py`)."""
    shop = await make_shop(session)
    await give_stock(session, shop, 3)

    with pytest.raises(ValidationFailedError, match="nothing to sell"):
        await sell(
            session,
            shop,
            scope=shop.scope(REPORTER),
            lines=basket(shop, quantity=2),
            missing_in_store=[MissingInStore(line_index=0, quantity=0)],
        )
    await session.rollback()

    assert await on_hand(session, shop) == 3
    assert await movements(session, shop) == [("DELIVERY", 3, None)]


async def test_confirming_the_whole_line_is_not_a_shortage(session: AsyncSession) -> None:
    """Nothing is missing, so there is nothing to report. Refused rather than
    accepted as a no-op: a client sending this has misunderstood the field, and
    silence would let that ship."""
    shop = await make_shop(session)
    await give_stock(session, shop, 3)

    with pytest.raises(ValidationFailedError, match="Nothing is missing"):
        await sell(
            session,
            shop,
            scope=shop.scope(REPORTER),
            lines=basket(shop, quantity=2),
            missing_in_store=[MissingInStore(line_index=0, quantity=2)],
        )


async def test_the_same_goods_cannot_be_reported_present_and_missing(
    session: AsyncSession,
) -> None:
    """Two contradictory statements about one shelf. Whichever won would be
    arbitrary, so neither does."""
    shop = await make_shop(session)
    await give_stock(session, shop, 2)

    with pytest.raises(ValidationFailedError, match="both present and missing"):
        await sell(
            session,
            shop,
            scope=shop.scope(REPORTER),
            lines=basket(shop, quantity=3) + basket(shop, quantity=2),
            found_in_store=[FoundInStore(line_index=0, quantity=1)],
            missing_in_store=[MissingInStore(line_index=1, quantity=1)],
        )


async def test_a_shortage_report_refers_to_a_line_that_exists(session: AsyncSession) -> None:
    shop = await make_shop(session)
    await give_stock(session, shop, 2)

    with pytest.raises(ValidationFailedError, match="missing_in_store refers to a line"):
        await sell(
            session,
            shop,
            scope=shop.scope(REPORTER),
            lines=basket(shop, quantity=2),
            missing_in_store=[MissingInStore(line_index=7, quantity=1)],
        )

    with pytest.raises(ValidationFailedError, match="Duplicate missing_in_store"):
        await sell(
            session,
            shop,
            scope=shop.scope(REPORTER),
            lines=basket(shop, quantity=2),
            missing_in_store=[
                MissingInStore(line_index=0, quantity=1),
                MissingInStore(line_index=0, quantity=1),
            ],
        )


# --- authority ---------------------------------------------------------------


async def test_reporting_goods_present_does_not_confer_reporting_them_missing(
    session: AsyncSession,
) -> None:
    """The default seller holds `inventory:correct_during_sale` and not the
    other. Taking stock off a shelf is its own grant: the owner's instruction
    is that no seller gets the run of the balances without being given it."""
    shop = await make_shop(session)
    await give_stock(session, shop, 5)

    assert Permission.INVENTORY_CORRECT_DURING_SALE in SELLER_PERMISSIONS
    assert Permission.INVENTORY_REPORT_MISSING_DURING_SALE not in SELLER_PERMISSIONS

    with pytest.raises(PermissionDeniedError):
        await sell(
            session,
            shop,
            lines=basket(shop, quantity=2),
            missing_in_store=[MissingInStore(line_index=0, quantity=1)],
        )
    await session.rollback()
    assert await on_hand(session, shop) == 5


async def test_the_default_seller_role_does_not_carry_the_permission() -> None:
    """Stated against the shipped matrix, not against a test fixture: whether
    every seller may do this is a role edit the owner makes deliberately."""
    from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode

    assert (
        Permission.INVENTORY_REPORT_MISSING_DURING_SALE
        not in DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
    )
    for role in (RoleCode.MANAGER, RoleCode.OWNER):
        assert Permission.INVENTORY_REPORT_MISSING_DURING_SALE in DEFAULT_ROLE_PERMISSIONS[role]


# --- the trail ---------------------------------------------------------------


async def test_the_shortage_is_audited_with_before_and_after(session: AsyncSession) -> None:
    """Reviewable in a month: who, where, from what to what, and why — with a
    reason that records the observation, not a conclusion about it."""
    shop = await make_shop(session)
    await give_stock(session, shop, 4)

    await sell(
        session,
        shop,
        scope=shop.scope(REPORTER),
        lines=basket(shop, quantity=2),
        missing_in_store=[MissingInStore(line_index=0, quantity=1)],
    )
    await session.commit()

    entry = (
        await session.execute(
            text(
                "SELECT action, before, after, reason, actor_user_id FROM audit_log"
                " WHERE organization_id = :o AND action = 'inventory.missing_at_sale'"
            ),
            {"o": shop.organization_id},
        )
    ).one()
    action, before, after, reason, actor = entry
    assert action == "inventory.missing_at_sale"
    assert before["quantity"] == 4
    assert after["quantity"] == 3
    assert reason == "MISSING_AT_SALE"
    assert actor == shop.user_id


async def test_a_shortage_is_not_a_write_off(session: AsyncSession) -> None:
    """`MISSING_AT_SALE` is deliberately not `LOST` or `DAMAGED`. At the counter
    nobody knows why the coat is not there, and the ledger must not pretend to."""
    shop = await make_shop(session)
    await give_stock(session, shop, 3)

    await sell(
        session,
        shop,
        scope=shop.scope(REPORTER),
        lines=basket(shop, quantity=2),
        missing_in_store=[MissingInStore(line_index=0, quantity=1)],
    )
    await session.commit()

    reasons = {m[2] for m in await movements(session, shop)}
    assert "MISSING_AT_SALE" in reasons
    assert reasons & {"LOST", "DAMAGED"} == set()


async def test_the_shortage_and_the_sale_are_one_transaction(session: AsyncSession) -> None:
    """A second line that cannot be sold takes the whole command down with it,
    including the write-off the first line asked for."""
    shop = await make_shop(session)
    other = await make_shop(session)
    await give_stock(session, shop, 4)

    stranger_line = SaleLineInput(
        product_variant_id=other.variant_id,
        size_id=shop.size_id,
        source_location_id=shop.location_id,
        quantity=1,
        unit_price=Decimal("100.00"),
    )
    with pytest.raises(NotFoundError):
        await sell(
            session,
            shop,
            scope=shop.scope(REPORTER),
            lines=[*basket(shop, quantity=2), stranger_line],
            missing_in_store=[MissingInStore(line_index=0, quantity=1)],
        )
    await session.rollback()

    assert await on_hand(session, shop) == 4
    assert await movements(session, shop) == [("DELIVERY", 4, None)]


# --- command identity --------------------------------------------------------


async def test_the_same_command_without_the_shortage_report_is_a_conflict(
    session: AsyncSession,
) -> None:
    """It would sell two coats instead of one. A retry that changes what is
    being sold is not a retry (invariant I20)."""
    shop = await make_shop(session)
    await give_stock(session, shop, 5)
    command_id = uuid.uuid4()

    await sell(
        session,
        shop,
        scope=shop.scope(REPORTER),
        command_id=command_id,
        lines=basket(shop, quantity=2),
        missing_in_store=[MissingInStore(line_index=0, quantity=1)],
    )
    await session.commit()

    with pytest.raises(IdempotencyConflictError):
        await sell(
            session,
            shop,
            scope=shop.scope(REPORTER),
            command_id=command_id,
            lines=basket(shop, quantity=2),
        )
    await session.rollback()
    assert await on_hand(session, shop) == 3


async def test_a_genuine_retry_replays_the_same_shortage(session: AsyncSession) -> None:
    """The movement is written once and reported the same way twice."""
    shop = await make_shop(session)
    await give_stock(session, shop, 5)
    command_id = uuid.uuid4()
    arguments = {
        "scope": shop.scope(REPORTER),
        "command_id": command_id,
        "lines": basket(shop, quantity=2),
        "missing_in_store": [MissingInStore(line_index=0, quantity=1)],
    }

    original = await sell(session, shop, **arguments)
    await session.commit()
    replay = await sell(session, shop, **arguments)

    assert replay.sale.id == original.sale.id
    assert replay.shortages == original.shortages
    assert await on_hand(session, shop) == 3
