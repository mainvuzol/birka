"""Reservations compete with physical stockouts on the same row lock."""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.core.errors import InsufficientStockError, ValidationFailedError
from app.modules.inventory.models import Inventory, MovementReason, MovementType
from app.modules.inventory.service import (
    MovementRequest,
    ReservationRequest,
    apply_movements,
    dispatch_reserved_stock,
    find_divergences,
    release_stock,
    reserve_stock,
)
from tests.conftest import requires_database
from tests.integration.test_sale_command import make_shop

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield engine
    await engine.dispose()


def movement(shop, delta, kind=MovementType.DELIVERY, reason=None):
    return MovementRequest(
        location_id=shop.location_id,
        acting_store_id=shop.store_id,
        product_variant_id=shop.variant_id,
        size_id=shop.size_id,
        quantity_delta=delta,
        movement_type=kind,
        reason_code=reason,
    )


def hold(shop, quantity):
    return ReservationRequest(shop.location_id, shop.variant_id, shop.size_id, quantity)


def args(shop, reference_id):
    return {
        "organization_id": shop.organization_id,
        "store_id": shop.store_id,
        "reference_id": reference_id,
        "actor_user_id": shop.user_id,
    }


@pytest.mark.parametrize("dispatch", [False, True])
async def test_finish_reservation_exactly_once_and_never_resurrect(engine, dispatch):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        shop = await make_shop(session)
        await apply_movements(
            session, organization_id=shop.organization_id, requests=[movement(shop, 5)]
        )
        kwargs = args(shop, uuid.uuid4())
        await reserve_stock(session, **kwargs, requests=[hold(shop, 2)])
        await reserve_stock(session, **kwargs, requests=[hold(shop, 2)])
        finish = dispatch_reserved_stock if dispatch else release_stock
        await finish(session, **kwargs)
        await finish(session, **kwargs)
        await reserve_stock(session, **kwargs, requests=[hold(shop, 2)])
        row = (
            await session.scalars(
                select(Inventory).where(Inventory.location_id == shop.location_id)
            )
        ).one()
        assert (row.quantity, row.reserved_quantity) == (3 if dispatch else 5, 0)
        assert not await find_divergences(session, organization_id=shop.organization_id)


async def test_stockouts_and_corrections_cannot_consume_reserved_stock(engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        shop = await make_shop(session)
        await apply_movements(
            session, organization_id=shop.organization_id, requests=[movement(shop, 3)]
        )
        await reserve_stock(session, **args(shop, uuid.uuid4()), requests=[hold(shop, 2)])
        with pytest.raises(InsufficientStockError) as error:
            async with session.begin_nested():
                await apply_movements(
                    session,
                    organization_id=shop.organization_id,
                    requests=[movement(shop, -2, MovementType.SALE)],
                )
        assert error.value.details["correctable"] is False
        assert error.value.details["available"] == 1
        with pytest.raises(ValidationFailedError):
            await apply_movements(
                session,
                organization_id=shop.organization_id,
                requests=[
                    movement(shop, 1, MovementType.ADJUSTMENT, MovementReason.FOUND_DURING_SALE)
                ],
            )
        await apply_movements(
            session,
            organization_id=shop.organization_id,
            requests=[movement(shop, -1, MovementType.SALE)],
        )
        row = (
            await session.scalars(
                select(Inventory).where(Inventory.location_id == shop.location_id)
            )
        ).one()
        assert (row.quantity, row.reserved_quantity) == (2, 2)


@pytest.mark.parametrize("second_is_sale", [False, True])
async def test_last_unit_concurrency_reservation_or_sale(engine, second_is_sale):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        shop = await make_shop(session)
        await apply_movements(
            session, organization_id=shop.organization_id, requests=[movement(shop, 1)]
        )
        await session.commit()
    barrier = asyncio.Barrier(2)

    async def contender(sale):
        async with maker() as session:
            await barrier.wait()
            try:
                if sale:
                    await apply_movements(
                        session,
                        organization_id=shop.organization_id,
                        requests=[movement(shop, -1, MovementType.SALE)],
                    )
                else:
                    await reserve_stock(
                        session, **args(shop, uuid.uuid4()), requests=[hold(shop, 1)]
                    )
                await session.commit()
                return True
            except InsufficientStockError:
                await session.rollback()
                return False

    results = await asyncio.wait_for(
        asyncio.gather(contender(False), contender(second_is_sale)), timeout=10
    )
    assert sorted(results) == [False, True]
    async with maker() as session:
        row = (
            await session.scalars(
                select(Inventory).where(Inventory.location_id == shop.location_id)
            )
        ).one()
        assert row.quantity - row.reserved_quantity == 0
        assert not await find_divergences(session, organization_id=shop.organization_id)


async def test_reservation_preflight_does_not_partially_hold_basket(engine):
    from tests.conftest import provision_location

    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        shop = await make_shop(session)
        other_location = await provision_location(
            session, organization_id=shop.organization_id, store_id=shop.store_id
        )
        await apply_movements(
            session, organization_id=shop.organization_id, requests=[movement(shop, 2)]
        )
        with pytest.raises(InsufficientStockError):
            await reserve_stock(
                session,
                **args(shop, uuid.uuid4()),
                requests=[
                    hold(shop, 1),
                    ReservationRequest(other_location, shop.variant_id, shop.size_id, 1),
                ],
            )
        row = (
            await session.scalars(
                select(Inventory).where(Inventory.location_id == shop.location_id)
            )
        ).one()
        assert row.reserved_quantity == 0


async def test_paused_warehouse_allows_release_but_not_dispatch(engine):
    from app.core.errors import NotFoundError
    from app.modules.tenancy.models import StockLocation

    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        shop = await make_shop(session)
        await apply_movements(
            session, organization_id=shop.organization_id, requests=[movement(shop, 2)]
        )
        kwargs = args(shop, uuid.uuid4())
        await reserve_stock(session, **kwargs, requests=[hold(shop, 2)])
        location = await session.get(StockLocation, shop.location_id)
        location.is_active = False
        await session.flush()
        with pytest.raises(NotFoundError):
            await dispatch_reserved_stock(session, **kwargs)
        await release_stock(session, **kwargs)
        await release_stock(session, **kwargs)
        row = (
            await session.scalars(
                select(Inventory).where(Inventory.location_id == shop.location_id)
            )
        ).one()
        assert (row.quantity, row.reserved_quantity) == (2, 0)
        assert not await find_divergences(session, organization_id=shop.organization_id)
