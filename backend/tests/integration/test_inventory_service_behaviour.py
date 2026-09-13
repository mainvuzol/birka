"""Inventory service against a real PostgreSQL.

The tests that matter most here are the concurrent ones. Overselling is not a
logic bug you can reason away in review — it appears only when two sellers hit
the same row at the same moment, which is precisely what this file reproduces.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

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
    IdempotencyInProgressError,
    InsufficientStockError,
)
from app.core.idempotency import Claim, Replay, claim, complete, fingerprint
from app.modules.catalog.models import (
    CanonicalConcept,
    ProductFamily,
    ProductVariant,
    Size,
    SizeSystem,
    SizeSystemCode,
)
from app.modules.inventory import repository
from app.modules.inventory.models import MovementReason, MovementType
from app.modules.inventory.service import MovementRequest, apply_movements, find_divergences
from app.modules.tenancy.models import Organization, Store, StoreKind
from tests.conftest import requires_database

pytestmark = [pytest.mark.integration, requires_database()]


def _url() -> str:
    return os.environ["BIRKA_TEST_DATABASE_URL"]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(_url())
    yield engine
    await engine.dispose()


@pytest.fixture
async def session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
        await s.rollback()


class World:
    """One organization with a store, a variant and a size, committed so that
    a second connection can see it."""

    def __init__(self, **kwargs: uuid.UUID) -> None:
        self.__dict__.update(kwargs)


async def make_world(session: AsyncSession) -> World:
    org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", currency_code="UAH")
    session.add(org)
    await session.flush()

    store = Store(organization_id=org.id, name="A", code="A", kind=StoreKind.PRIMARY)
    concept = CanonicalConcept(organization_id=org.id, name="Мышка", normalized_name="мышка")
    system = SizeSystem(organization_id=org.id, code=SizeSystemCode.ALPHA, name="Alpha")
    session.add_all([store, concept, system])
    await session.flush()

    size = Size(size_system_id=system.id, code="M")
    family = ProductFamily(organization_id=org.id, canonical_concept_id=concept.id)
    session.add_all([size, family])
    await session.flush()

    variant = ProductVariant(product_family_id=family.id)
    session.add(variant)
    await session.flush()
    await session.commit()

    return World(organization_id=org.id, store_id=store.id, size_id=size.id, variant_id=variant.id)


def line(
    world: World, delta: int, movement_type: MovementType, **kwargs: object
) -> MovementRequest:
    return MovementRequest(
        store_id=world.store_id,
        product_variant_id=world.variant_id,
        size_id=world.size_id,
        quantity_delta=delta,
        movement_type=movement_type,
        **kwargs,  # type: ignore[arg-type]
    )


async def stock(session: AsyncSession, world: World, delta: int) -> None:
    await apply_movements(
        session,
        organization_id=world.organization_id,
        requests=[line(world, delta, MovementType.DELIVERY)],
    )
    await session.commit()


# --- the ledger stays honest -------------------------------------------------


async def test_a_delivery_creates_the_row_the_movement_and_agrees(
    session: AsyncSession,
) -> None:
    world = await make_world(session)

    applied = await apply_movements(
        session,
        organization_id=world.organization_id,
        requests=[line(world, 4, MovementType.DELIVERY)],
    )
    await session.commit()

    assert applied[0].quantity_after == 4
    assert (
        await repository.current_quantity(
            session,
            store_id=world.store_id,
            product_variant_id=world.variant_id,
            size_id=world.size_id,
        )
        == 4
    )
    assert await find_divergences(session) == []


async def test_a_sale_reduces_stock_and_the_ledger_still_agrees(
    session: AsyncSession,
) -> None:
    world = await make_world(session)
    await stock(session, world, 5)

    applied = await apply_movements(
        session,
        organization_id=world.organization_id,
        requests=[line(world, -2, MovementType.SALE)],
    )
    await session.commit()

    assert applied[0].quantity_after == 3
    assert await find_divergences(session) == []


async def test_selling_more_than_exists_is_refused_with_the_real_count(
    session: AsyncSession,
) -> None:
    """The error carries what is actually on hand, so the client can offer the
    FOUND_DURING_SALE correction instead of a dead end."""
    world = await make_world(session)
    await stock(session, world, 2)

    with pytest.raises(InsufficientStockError) as exc:
        await apply_movements(
            session,
            organization_id=world.organization_id,
            requests=[line(world, -5, MovementType.SALE)],
        )

    assert exc.value.details["available"] == 2
    assert exc.value.details["requested"] == 5
    assert exc.value.details["correctable"] is True


async def test_a_refused_line_leaves_no_trace(session: AsyncSession) -> None:
    """Invariant I4: the whole command rolls back, ledger included."""
    world = await make_world(session)
    await stock(session, world, 1)

    with pytest.raises(InsufficientStockError):
        await apply_movements(
            session,
            organization_id=world.organization_id,
            requests=[line(world, -9, MovementType.SALE)],
        )
    await session.rollback()

    assert (
        await repository.current_quantity(
            session,
            store_id=world.store_id,
            product_variant_id=world.variant_id,
            size_id=world.size_id,
        )
        == 1
    )
    assert await find_divergences(session) == []


async def test_reconciliation_detects_a_quantity_changed_behind_the_service(
    session: AsyncSession,
) -> None:
    """Invariant I3 is SERVICE_ENFORCED, so this query is its detection half.
    An empty result elsewhere in this file is only evidence if this test proves
    the query can actually see a divergence."""
    world = await make_world(session)
    await stock(session, world, 3)

    await session.execute(
        text(
            "UPDATE inventory SET quantity = quantity + 7"
            " WHERE store_id = :s AND product_variant_id = :v AND size_id = :z"
        ),
        {"s": world.store_id, "v": world.variant_id, "z": world.size_id},
    )
    await session.commit()

    divergences = await find_divergences(session)

    assert len(divergences) == 1
    assert divergences[0].difference == 7


# --- concurrency -------------------------------------------------------------


async def test_two_sellers_cannot_sell_the_same_last_unit(engine: AsyncEngine) -> None:
    """`.ai/workflows/sale.md`: two concurrent sales for the last unit.

    Both transactions run the conditional UPDATE. PostgreSQL serialises them on
    the row; the loser matches zero rows and is told the stock is gone. The
    final quantity is 0, never -1.
    """
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as setup:
        world = await make_world(setup)
        await stock(setup, world, 1)

    async def sell() -> str:
        async with maker() as s:
            try:
                await apply_movements(
                    s,
                    organization_id=world.organization_id,
                    requests=[line(world, -1, MovementType.SALE)],
                )
                await s.commit()
                return "sold"
            except InsufficientStockError:
                await s.rollback()
                return "refused"

    outcomes = await asyncio.gather(sell(), sell())

    assert sorted(outcomes) == ["refused", "sold"]

    async with maker() as check:
        assert (
            await repository.current_quantity(
                check,
                store_id=world.store_id,
                product_variant_id=world.variant_id,
                size_id=world.size_id,
            )
            == 0
        )
        assert await find_divergences(check) == []


async def test_ten_concurrent_sales_of_four_units_sell_exactly_four(
    engine: AsyncEngine,
) -> None:
    """Stronger than the two-seller case: the count must be exact, not merely
    non-negative."""
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as setup:
        world = await make_world(setup)
        await stock(setup, world, 4)

    async def sell() -> bool:
        async with maker() as s:
            try:
                await apply_movements(
                    s,
                    organization_id=world.organization_id,
                    requests=[line(world, -1, MovementType.SALE)],
                )
                await s.commit()
                return True
            except InsufficientStockError:
                await s.rollback()
                return False

    results = await asyncio.gather(*(sell() for _ in range(10)))

    assert sum(results) == 4
    async with maker() as check:
        assert (
            await repository.current_quantity(
                check,
                store_id=world.store_id,
                product_variant_id=world.variant_id,
                size_id=world.size_id,
            )
            == 0
        )
        assert await find_divergences(check) == []


async def test_multi_line_commands_in_opposite_order_do_not_deadlock(
    engine: AsyncEngine,
) -> None:
    """Two baskets containing the same two items, listed in opposite orders.

    Without the deterministic sort in the service these two transactions grab
    the rows in opposite orders and deadlock. The assertion is simply that both
    finish.
    """
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as setup:
        world = await make_world(setup)
        second_variant = ProductVariant(
            product_family_id=(
                await setup.execute(
                    text("SELECT product_family_id FROM product_variant WHERE id = :i"),
                    {"i": world.variant_id},
                )
            ).scalar_one(),
            length_cm=70,
        )
        setup.add(second_variant)
        await setup.flush()
        await setup.commit()
        other = World(
            organization_id=world.organization_id,
            store_id=world.store_id,
            size_id=world.size_id,
            variant_id=second_variant.id,
        )
        await stock(setup, world, 5)
        await stock(setup, other, 5)

    async def sell(order: list[World]) -> None:
        async with maker() as s:
            await apply_movements(
                s,
                organization_id=world.organization_id,
                requests=[line(w, -1, MovementType.SALE) for w in order],
            )
            await s.commit()

    await asyncio.wait_for(asyncio.gather(sell([world, other]), sell([other, world])), timeout=20)

    async with maker() as check:
        assert await find_divergences(check) == []


# --- idempotency -------------------------------------------------------------


async def test_a_repeated_identical_request_replays_instead_of_executing(
    session: AsyncSession,
) -> None:
    world = await make_world(session)
    print_ = fingerprint({"q": 1}, actor_user_id=uuid.uuid4(), store_id=world.store_id)

    first = await claim(
        session,
        organization_id=world.organization_id,
        endpoint="POST /inventory/receipts",
        key="k-1",
        request_fingerprint=print_,
    )
    assert isinstance(first, Claim)
    await complete(session, first.record_id, response={"ok": True}, http_status=201)
    await session.commit()

    second = await claim(
        session,
        organization_id=world.organization_id,
        endpoint="POST /inventory/receipts",
        key="k-1",
        request_fingerprint=print_,
    )

    assert isinstance(second, Replay)
    assert second.response == {"ok": True}
    assert second.http_status == 201


async def test_the_same_key_with_a_different_payload_is_refused(
    session: AsyncSession,
) -> None:
    """Never execute: the client either reused a key or changed the command
    mid-retry, and guessing which could perform an operation nobody asked for."""
    world = await make_world(session)
    actor = uuid.uuid4()

    first = await claim(
        session,
        organization_id=world.organization_id,
        endpoint="POST /sales",
        key="k-2",
        request_fingerprint=fingerprint({"q": 1}, actor_user_id=actor, store_id=world.store_id),
    )
    assert isinstance(first, Claim)
    await complete(session, first.record_id, response={}, http_status=201)
    await session.commit()

    with pytest.raises(IdempotencyConflictError):
        await claim(
            session,
            organization_id=world.organization_id,
            endpoint="POST /sales",
            key="k-2",
            request_fingerprint=fingerprint(
                {"q": 99}, actor_user_id=actor, store_id=world.store_id
            ),
        )


async def test_an_unfinished_identical_request_is_reported_as_in_progress(
    session: AsyncSession,
) -> None:
    world = await make_world(session)
    print_ = fingerprint({"q": 1}, actor_user_id=uuid.uuid4(), store_id=world.store_id)

    first = await claim(
        session,
        organization_id=world.organization_id,
        endpoint="POST /sales",
        key="k-3",
        request_fingerprint=print_,
    )
    assert isinstance(first, Claim)
    await session.commit()

    with pytest.raises(IdempotencyInProgressError):
        await claim(
            session,
            organization_id=world.organization_id,
            endpoint="POST /sales",
            key="k-3",
            request_fingerprint=print_,
        )


async def test_the_same_key_on_a_different_endpoint_is_unrelated(
    session: AsyncSession,
) -> None:
    """Keys are namespaced by operation, so a client reusing a counter across
    endpoints is not punished for it."""
    world = await make_world(session)
    print_ = fingerprint({"q": 1}, actor_user_id=uuid.uuid4(), store_id=world.store_id)

    first = await claim(
        session,
        organization_id=world.organization_id,
        endpoint="POST /sales",
        key="shared",
        request_fingerprint=print_,
    )
    second = await claim(
        session,
        organization_id=world.organization_id,
        endpoint="POST /inventory/receipts",
        key="shared",
        request_fingerprint=print_,
    )

    assert isinstance(first, Claim)
    assert isinstance(second, Claim)
    assert first.record_id != second.record_id


async def test_an_adjustment_records_its_reason(session: AsyncSession) -> None:
    """Business fact F30: how often stock was wrong must stay measurable."""
    world = await make_world(session)
    await stock(session, world, 1)

    await apply_movements(
        session,
        organization_id=world.organization_id,
        requests=[
            line(
                world,
                2,
                MovementType.ADJUSTMENT,
                reason_code=MovementReason.FOUND_DURING_SALE,
            )
        ],
    )
    await session.commit()

    recorded = (
        await session.execute(
            text(
                "SELECT reason_code FROM stock_movement"
                " WHERE movement_type = 'ADJUSTMENT' AND store_id = :s"
            ),
            {"s": world.store_id},
        )
    ).scalar_one()

    assert recorded == "FOUND_DURING_SALE"
