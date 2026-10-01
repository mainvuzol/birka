"""Real database boundaries and locks for every stock-changing command."""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.core.errors import NotFoundError, StoreNotTradingError
from app.modules.inventory.models import AcquisitionType, Inventory, MovementType, StockLot
from app.modules.inventory.service import MovementRequest, apply_movements, lock_stock
from app.modules.tenancy.models import StockLocation, Store, StoreState
from tests.conftest import provision_location, requires_database
from tests.integration.test_sale_command import make_shop

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield engine
    await engine.dispose()


@pytest.mark.parametrize(
    "foreign_part",
    [
        "location",
        "variant",
        "size",
        "missing_location",
        "missing_variant",
        "missing_size",
        "inactive_location",
        "inactive_store",
    ],
)
async def test_stock_rejects_invalid_scope_before_creating_rows(
    engine: AsyncEngine, foreign_part: str
) -> None:
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        own = await make_shop(session)
        foreign = await make_shop(session)
        key = [own.location_id, own.variant_id, own.size_id]
        if foreign_part == "inactive_location":
            location = await session.get(StockLocation, own.location_id)
            assert location is not None
            location.is_active = False
            await session.flush()
        elif foreign_part == "inactive_store":
            # The acting store is validated separately from the location.
            # Before the re-key one call proved both; a location-only check
            # would have left the acting store unvalidated entirely.
            store = await session.get(Store, own.store_id)
            assert store is not None
            store.state = StoreState.BLOCKED
            await session.flush()
        elif foreign_part.startswith("missing_"):
            i = {"missing_location": 0, "missing_variant": 1, "missing_size": 2}[foreign_part]
            key[i] = uuid.uuid4()
        else:
            i = {"location": 0, "variant": 1, "size": 2}[foreign_part]
            key[i] = [foreign.location_id, foreign.variant_id, foreign.size_id][i]
        # Include a valid key first: validation must finish before ANY upsert.
        # A store that does not trade is refused by name (owner decisions,
        # 2026-10-01); everything else is no such thing.
        refusal = StoreNotTradingError if foreign_part == "inactive_store" else NotFoundError
        with pytest.raises(refusal):
            await lock_stock(
                session,
                organization_id=own.organization_id,
                keys=[(own.location_id, own.variant_id, own.size_id), tuple(key)],
                acting_store_ids={own.store_id},
            )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Inventory)
                .where(Inventory.location_id == own.location_id)
            )
            == 0
        )


@pytest.mark.parametrize("lot_case", ["foreign", "wrong_key", "missing"])
async def test_movements_reject_foreign_or_mismatched_lots(
    engine: AsyncEngine, lot_case: str
) -> None:
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        own = await make_shop(session)
        foreign = await make_shop(session)
        if lot_case == "missing":
            lot_id = uuid.uuid4()
        else:
            lot = StockLot(
                organization_id=foreign.organization_id
                if lot_case == "foreign"
                else own.organization_id,
                location_id=foreign.location_id
                if lot_case == "foreign"
                else await provision_location(
                    session,
                    organization_id=own.organization_id,
                    store_id=own.store_id,
                    name="Інший склад",
                ),
                product_variant_id=foreign.variant_id if lot_case == "foreign" else own.variant_id,
                size_id=foreign.size_id if lot_case == "foreign" else own.size_id,
                acquisition_type=AcquisitionType.PURCHASE,
            )
            session.add(lot)
            await session.flush()
            lot_id = lot.id
        with pytest.raises(NotFoundError):
            await apply_movements(
                session,
                organization_id=own.organization_id,
                requests=[
                    MovementRequest(
                        location_id=own.location_id,
                        acting_store_id=own.store_id,
                        product_variant_id=own.variant_id,
                        size_id=own.size_id,
                        quantity_delta=1,
                        movement_type=MovementType.DELIVERY,
                        stock_lot_id=lot_id,
                    )
                ],
            )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Inventory)
                .where(Inventory.location_id == own.location_id)
            )
            == 0
        )


async def _observe_block(engine: AsyncEngine, pid: int) -> None:
    """Assert a PostgreSQL lock wait, rather than relying on task scheduling."""
    async with engine.connect() as observer:
        for _ in range(200):
            blocked = await observer.scalar(
                text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
            )
            if blocked:
                return
            await asyncio.sleep(0.01)
    pytest.fail("contending transaction never waited for the stock lock")


@pytest.mark.parametrize("already_exists", [False, True])
async def test_lock_serializes_receipt_until_command_finishes(
    engine: AsyncEngine, already_exists: bool
) -> None:
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as setup:
        shop = await make_shop(setup)
        key = (shop.location_id, shop.variant_id, shop.size_id)
        if already_exists:
            await lock_stock(
                setup,
                organization_id=shop.organization_id,
                keys=[key],
                acting_store_ids={shop.store_id},
            )
            await setup.commit()
    async with maker() as command:
        quantities = await lock_stock(
            command,
            organization_id=shop.organization_id,
            keys=[key],
            acting_store_ids={shop.store_id},
        )
        assert quantities[key] == 0
        started: asyncio.Future[int] = asyncio.get_running_loop().create_future()

        async def receipt() -> None:
            async with maker() as session:
                pid = await session.scalar(text("SELECT pg_backend_pid()"))
                started.set_result(pid)
                await apply_movements(
                    session,
                    organization_id=shop.organization_id,
                    requests=[
                        MovementRequest(
                            location_id=shop.location_id,
                            acting_store_id=shop.store_id,
                            product_variant_id=shop.variant_id,
                            size_id=shop.size_id,
                            quantity_delta=1,
                            movement_type=MovementType.DELIVERY,
                        )
                    ],
                )
                await session.commit()

        task = asyncio.create_task(receipt())
        try:
            await _observe_block(engine, await started)
            assert not task.done()
        finally:
            await command.commit()
            await asyncio.wait_for(task, timeout=5)
    async with maker() as check:
        locked = await lock_stock(
            check,
            organization_id=shop.organization_id,
            keys=[key],
            acting_store_ids={shop.store_id},
        )
        assert locked[key] == 1
        assert (
            await check.scalar(
                select(func.count())
                .select_from(Inventory)
                .where(Inventory.location_id == shop.location_id)
            )
            == 1
        )


async def test_opposite_input_order_locks_full_baskets_without_deadlock(
    engine: AsyncEngine,
) -> None:
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as setup:
        shop = await make_shop(setup)
        # A second warehouse the same store reaches — which is the real shape
        # now that a store can hold stock in more than one place.
        second_location = await provision_location(
            setup,
            organization_id=shop.organization_id,
            store_id=shop.store_id,
            name="Другий склад",
        )
        await setup.commit()
        keys = [
            (shop.location_id, shop.variant_id, shop.size_id),
            (second_location, shop.variant_id, shop.size_id),
        ]
    barrier = asyncio.Barrier(2)

    async def receive(order: list) -> None:
        async with maker() as session:
            await barrier.wait()
            await apply_movements(
                session,
                organization_id=shop.organization_id,
                requests=[
                    MovementRequest(
                        location_id=store,
                        acting_store_id=shop.store_id,
                        product_variant_id=variant,
                        size_id=size,
                        quantity_delta=1,
                        movement_type=MovementType.DELIVERY,
                    )
                    for store, variant, size in order
                ],
            )
            await session.commit()

    await asyncio.wait_for(asyncio.gather(receive(keys), receive(keys[::-1])), timeout=5)
    async with maker() as check:
        quantities = await lock_stock(
            check,
            organization_id=shop.organization_id,
            keys=keys,
            acting_store_ids={shop.store_id},
        )
        assert quantities == dict.fromkeys(keys, 2)
