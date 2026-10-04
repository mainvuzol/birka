"""Regression coverage for M1B correction, command replay and money failures.

All stock assertions use real committed PostgreSQL state. Synchronization pauses
at transaction boundaries while the actual SQL locking and writes still execute.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from dataclasses import replace
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.sales import SaleRequest, create, read_sale
from app.core.errors import (
    CorrectionExceedsShortfallError,
    ForbiddenStoreError,
    IdempotencyConflictError,
    PermissionDeniedError,
    ValidationFailedError,
)
from app.core.idempotency import IdempotencyRecord
from app.modules.authz.permissions import Permission
from app.modules.catalog.models import ProductVariant
from app.modules.inventory.models import MovementType, StockMovement
from app.modules.inventory.service import MovementRequest, apply_movements, current_quantity
from app.modules.sales import service as sales_service
from app.modules.sales.models import Sale
from app.modules.sales.service import FoundInStore
from tests.conftest import requires_database
from tests.integration.test_sale_command import basket, give_stock, make_shop, sell

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def quantity(session, shop):
    return await current_quantity(
        session,
        location_id=shop.location_id,
        product_variant_id=shop.variant_id,
        size_id=shop.size_id,
    )


def payload_for(shop, *, found=False):
    return SaleRequest(
        store_id=shop.store_id,
        command_id=uuid.uuid4(),
        lines=[
            {
                "product_variant_id": shop.variant_id,
                "size_id": shop.size_id,
                "source_location_id": shop.location_id,
                "quantity": 1,
                "unit_price": "100.00",
            }
        ],
        found_in_store=[{"line_index": 0, "quantity": 1}] if found else [],
        # The till's button that sold (owner decisions, 2026-10-04).
        payment_method="CASH",
    )


async def api_sale(session, shop, payload, *, key=None, scope=None):
    return await create(
        payload=payload,
        scope=scope or shop.scope(),
        session=session,
        settings=SimpleNamespace(default_currency_code="UAH"),
        response=Response(),
        idempotency_key=key or str(uuid.uuid4()),
    )


async def test_duplicate_correction_cannot_mint_extra_stock(maker):
    async with maker() as session:
        shop = await make_shop(session)
        with pytest.raises(ValidationFailedError, match="Duplicate"):
            await sell(session, shop, found_in_store=[FoundInStore(0, 1)] * 100)
        await session.rollback()
        assert await quantity(session, shop) == 0
        assert (
            await session.scalar(select(func.count()).select_from(Sale)) == 0
            or (
                await session.scalar(
                    select(func.count()).select_from(Sale).where(Sale.store_id == shop.store_id)
                )
            )
            == 0
        )


async def test_repeated_sale_keys_share_one_exact_correction(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 1)
        result = await sell(
            session,
            shop,
            lines=basket(shop) + basket(shop, quantity=2),
            found_in_store=[FoundInStore(0, 1), FoundInStore(1, 1)],
        )
        await session.commit()
        assert len(result.corrections) == 1
        assert await quantity(session, shop) == 0
        assert result.sale.total == sum(item.line_total for item in result.items)
        movement = await session.get(StockMovement, result.corrections[0])
        assert movement.quantity_delta == 2


async def test_repeated_lines_cannot_each_reuse_the_same_initial_stock(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 1)
        with pytest.raises(CorrectionExceedsShortfallError) as error:
            await sell(
                session,
                shop,
                lines=basket(shop) + basket(shop),
                found_in_store=[FoundInStore(0, 1), FoundInStore(1, 1)],
            )
        assert error.value.details["shortfall"] == 1
        await session.rollback()
        assert await quantity(session, shop) == 1


async def test_receipt_committed_before_lock_invalidates_stale_correction(maker):
    async with maker() as setup:
        shop = await make_shop(setup)
    pending_lock = asyncio.Event()
    receipt_committed = asyncio.Event()
    original_lock = sales_service.lock_stock

    async def delayed_lock(*args, **kwargs):
        pending_lock.set()
        await receipt_committed.wait()
        return await original_lock(*args, **kwargs)

    async def sale():
        async with maker() as session:
            with pytest.raises(CorrectionExceedsShortfallError) as error:
                await sell(session, shop, found_in_store=[FoundInStore(0, 1)])
            assert error.value.details["shortfall"] == 0
            await session.rollback()

    async def receipt():
        await pending_lock.wait()
        async with maker() as session:
            await give_stock(session, shop, 1)
        receipt_committed.set()

    with patch.object(sales_service, "lock_stock", delayed_lock):
        await asyncio.wait_for(asyncio.gather(sale(), receipt()), timeout=10)
    async with maker() as check:
        assert await quantity(check, shop) == 1
        assert (
            await check.scalar(
                select(func.count()).select_from(Sale).where(Sale.store_id == shop.store_id)
            )
            == 0
        )


async def test_receipt_cannot_change_quantity_between_shortfall_read_and_sale(maker):
    async with maker() as setup:
        shop = await make_shop(setup)
    locked = asyncio.Event()
    receipt_started = asyncio.Event()
    receipt_finished = asyncio.Event()
    original_lock = sales_service.lock_stock

    async def paused_lock(*args, **kwargs):
        values = await original_lock(*args, **kwargs)
        locked.set()
        await receipt_started.wait()
        # The receipt has its own session and must stay blocked on the missing
        # stock row materialized by the sale until the sale commits.
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(receipt_finished.wait(), timeout=0.1)
        return values

    async def sale():
        async with maker() as session:
            await sell(session, shop, found_in_store=[FoundInStore(0, 1)])
            await session.commit()

    async def receipt():
        await locked.wait()
        async with maker() as session:
            receipt_started.set()
            await give_stock(session, shop, 1)
            receipt_finished.set()

    with patch.object(sales_service, "lock_stock", paused_lock):
        await asyncio.wait_for(asyncio.gather(sale(), receipt()), timeout=10)
    async with maker() as check:
        assert await quantity(check, shop) == 1  # received after the completed sale


async def test_opposite_correction_subsets_lock_the_entire_basket_without_deadlock(maker):
    async with maker() as setup:
        shop = await make_shop(setup)
        first = await setup.get(ProductVariant, shop.variant_id)
        second = ProductVariant(product_family_id=first.product_family_id)
        setup.add(second)
        await setup.flush()
        variants = sorted([first.id, second.id], key=str)
        await apply_movements(
            setup,
            organization_id=shop.organization_id,
            requests=[
                MovementRequest(
                    shop.location_id, shop.store_id, variant, shop.size_id, 1, MovementType.DELIVERY
                )
                for variant in variants
            ],
        )
        await setup.commit()
    start = asyncio.Barrier(2)
    original_lock = sales_service.lock_stock

    async def together(*args, **kwargs):
        await start.wait()
        return await original_lock(*args, **kwargs)

    async def sale(index):
        async with maker() as session:
            lines = [
                replace(
                    basket(shop)[0], product_variant_id=variants[0], quantity=1 if index == 0 else 2
                ),
                replace(
                    basket(shop)[0], product_variant_id=variants[1], quantity=2 if index == 0 else 1
                ),
            ]
            try:
                await sell(
                    session,
                    shop,
                    lines=lines,
                    found_in_store=[FoundInStore(1 if index == 0 else 0, 1)],
                )
                await session.commit()
                return "sold"
            except CorrectionExceedsShortfallError:
                await session.rollback()
                return "changed"

    with patch.object(sales_service, "lock_stock", together):
        results = await asyncio.wait_for(asyncio.gather(sale(0), sale(1)), timeout=10)
    assert sorted(results) == ["changed", "sold"]


async def test_new_key_and_deleted_cache_replay_original_receipt_with_corrections(maker):
    async with maker() as session:
        shop = await make_shop(session)
        payload = payload_for(shop, found=True)
        original = await api_sale(session, shop, payload)
        assert len(original.corrections) == 1
        replay = await api_sale(session, shop, payload)
        assert replay.model_dump() == original.model_dump()
        await session.execute(
            delete(IdempotencyRecord).where(
                IdempotencyRecord.organization_id == shop.organization_id
            )
        )
        await session.commit()
        replay = await api_sale(session, shop, payload)
        assert replay.model_dump() == original.model_dump()
        read = await read_sale(original.id, shop.scope(), session)
        assert read.model_dump() == original.model_dump()
        assert await quantity(session, shop) == 0
        assert (
            await session.scalar(
                select(func.count()).select_from(Sale).where(Sale.store_id == shop.store_id)
            )
            == 1
        )


async def test_changed_permanent_command_is_conflict_with_no_second_sale(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 2)
        payload = payload_for(shop)
        await api_sale(session, shop, payload)
        changed = payload.model_copy(deep=True)
        changed.lines[0].unit_price = Decimal("101.00")
        with pytest.raises(IdempotencyConflictError):
            await api_sale(session, shop, changed)
        await session.rollback()
        assert await quantity(session, shop) == 1


async def test_permanent_command_cannot_be_replayed_by_another_actor(maker):
    async with maker() as session:
        shop = await make_shop(session)
        other = await make_shop(session)
        await give_stock(session, shop, 1)
        payload = payload_for(shop)
        await api_sale(session, shop, payload)
        other_actor = replace(shop.scope(), user_id=other.user_id)
        with pytest.raises(IdempotencyConflictError):
            await api_sale(session, shop, payload, scope=other_actor)
        await session.rollback()
        assert await quantity(session, shop) == 0


@pytest.mark.parametrize("reuse_key", [False, True])
@pytest.mark.parametrize("revoked", ["store", "view", "correction"])
async def test_replay_honors_current_permissions(maker, reuse_key, revoked):
    async with maker() as session:
        shop = await make_shop(session)
        payload = payload_for(shop, found=True)
        key = str(uuid.uuid4())
        await api_sale(session, shop, payload, key=key)
        permissions = shop.scope().store_permissions[shop.store_id]
        scope = replace(
            shop.scope(),
            store_permissions=(
                {}
                if revoked == "store"
                else {
                    shop.store_id: permissions
                    - {
                        Permission.SALE_VIEW
                        if revoked == "view"
                        else Permission.INVENTORY_CORRECT_DURING_SALE
                    }
                }
            ),
        )
        with pytest.raises((ForbiddenStoreError, PermissionDeniedError)):
            await api_sale(session, shop, payload, key=key if reuse_key else None, scope=scope)
        await session.rollback()
        assert await quantity(session, shop) == 0


async def test_concurrent_different_cache_keys_replay_one_permanent_command(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 2)
    payload = payload_for(shop)
    start = asyncio.Barrier(2)

    async def attempt():
        async with maker() as session:
            await start.wait()
            result = await api_sale(session, shop, payload)
            return result.model_dump()

    first, second = await asyncio.wait_for(asyncio.gather(attempt(), attempt()), timeout=10)
    assert first == second
    async with maker() as session:
        assert await quantity(session, shop) == 1


async def test_concurrent_mismatched_command_returns_conflict_instead_of_integrity_error(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 2)
    payload = payload_for(shop)
    other = payload.model_copy(deep=True)
    other.lines[0].quantity = 2
    start = asyncio.Barrier(2)

    async def attempt(body):
        async with maker() as session:
            await start.wait()
            try:
                await api_sale(session, shop, body)
                return "sold"
            except IdempotencyConflictError:
                await session.rollback()
                return "conflict"

    results = await asyncio.wait_for(asyncio.gather(attempt(payload), attempt(other)), timeout=10)
    assert sorted(results) == ["conflict", "sold"]


async def test_legacy_command_without_fingerprint_is_not_guessed(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 1)
        payload = payload_for(shop)
        original = await api_sale(session, shop, payload)
        sale = await session.get(Sale, original.id)
        sale.command_fingerprint = None
        sale.response_snapshot = None
        await session.commit()
        with pytest.raises(IdempotencyConflictError, match="cannot be verified") as error:
            await api_sale(session, shop, payload)
        assert error.value.details["sale_id"] == str(original.id)
        await session.rollback()
        assert (await read_sale(original.id, shop.scope(), session)).id == original.id


@pytest.mark.parametrize("value", [Decimal("10.005"), Decimal("NaN"), Decimal("Infinity"), 1.5])
async def test_service_rejects_subcent_nonfinite_and_float_prices(maker, value):
    async with maker() as session:
        shop = await make_shop(session)
        with pytest.raises(ValidationFailedError):
            await sell(session, shop, lines=[replace(basket(shop)[0], unit_price=value)])
        await session.rollback()
        assert await quantity(session, shop) == 0


async def test_service_totals_equal_sum_of_frozen_lines(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 3)
        result = await sell(
            session,
            shop,
            lines=basket(shop, quantity=2, price="10.010", discount="0.020")
            + basket(shop, price="1.010", discount="0.00"),
        )
        await session.commit()
        assert result.sale.total == Decimal("20.99")
        assert result.sale.total == sum(item.line_total for item in result.items)
        assert result.sale.subtotal == sum(item.unit_price * item.quantity for item in result.items)
        assert result.sale.discount_total == sum(
            item.discount_amount * item.quantity for item in result.items
        )
