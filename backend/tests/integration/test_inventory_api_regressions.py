"""Receipt provenance and adjustment audit facts against real PostgreSQL."""

from __future__ import annotations

import os
import uuid
from decimal import Decimal

import httpx
import pytest
from fastapi import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import get_current_scope, session_dependency
from app.api.v1 import inventory as api
from app.core.config import Settings
from app.main import create_app
from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import Permission
from app.modules.inventory.models import Inventory, MovementReason, StockLot, StockMovement
from tests.conftest import requires_database
from tests.integration.test_sale_command import give_stock, make_shop

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def engine():
    instance = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


SETTINGS = Settings(app_env="local", session_secret="inventory-regression-secret-at-least-32-bytes")
PERMISSIONS = frozenset({Permission.INVENTORY_RECEIVE, Permission.INVENTORY_ADJUST})


def receipt(shop, *, quantity=1, command_id=None):
    return api.ReceiptRequest(
        store_id=shop.store_id,
        location_id=shop.location_id,
        command_id=command_id or uuid.uuid4(),
        lines=[
            api.ReceiptLine(
                product_variant_id=shop.variant_id, size_id=shop.size_id, quantity=quantity
            )
        ],
    )


async def receive(session, shop, payload, *, key=None):
    return await api.receive_goods(
        payload, shop.scope(PERMISSIONS), session, SETTINGS, Response(), key or str(uuid.uuid4())
    )


async def test_repeated_receipt_lines_keep_distinct_costs_and_lots(engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        shop = await make_shop(session)
        payload = receipt(shop, quantity=2)
        payload.lines[0].unit_cost = Decimal("100.00")
        payload.lines.append(
            payload.lines[0].model_copy(update={"quantity": 3, "unit_cost": Decimal("200.00")})
        )
        key = str(uuid.uuid4())
        response = await receive(session, shop, payload, key=key)
        assert [line.quantity_received for line in response.lines] == [2, 3]
        assert [line.quantity_after for line in response.lines] == [2, 5]
        assert len({line.stock_lot_id for line in response.lines}) == 2
        for line, expected_cost in zip(
            response.lines, [Decimal("100.00"), Decimal("200.00")], strict=True
        ):
            lot = await session.get(StockLot, line.stock_lot_id)
            movement = await session.get(StockMovement, line.movement_id)
            assert lot.unit_cost == expected_cost
            assert movement.stock_lot_id == lot.id
            assert movement.reference_id == lot.id
            assert movement.quantity_delta == line.quantity_received
        replay = await receive(session, shop, payload, key=key)
        assert replay == response
        assert (
            await session.scalar(
                select(Inventory.quantity).where(Inventory.location_id == shop.location_id)
            )
            == 5
        )


async def test_adjustment_audit_uses_quantity_at_locked_write(engine, monkeypatch):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 10)
        # The correction writes through `inventory.record_adjustment`, which
        # calls the ledger door in its own module.
        from app.modules.inventory import service as inventory_service

        original_apply = inventory_service.apply_movements

        async def interleaved_apply(*args, **kwargs):
            # A delivery commits after the route has started but before its
            # stock write. Reading "before" outside the lock would report 10.
            async with maker() as concurrent:
                await give_stock(concurrent, shop, 1)
            return await original_apply(*args, **kwargs)

        monkeypatch.setattr(inventory_service, "apply_movements", interleaved_apply)
        result = await api.adjust_inventory(
            api.AdjustmentRequest(
                store_id=shop.store_id,
                location_id=shop.location_id,
                command_id=uuid.uuid4(),
                product_variant_id=shop.variant_id,
                size_id=shop.size_id,
                quantity_delta=1,
                reason_code=MovementReason.FOUND_DURING_SALE,
            ),
            shop.scope(PERMISSIONS),
            session,
            Response(),
            str(uuid.uuid4()),
        )
        assert (result.quantity_before, result.quantity_after) == (11, 12)
        audit = await session.scalar(
            select(AuditLog).where(AuditLog.entity_id == result.movement_id)
        )
        assert audit.before == {"quantity": 11}
        assert audit.after == {"quantity": 12}


@pytest.mark.parametrize("foreign_field", ["variant", "size", "missing_variant"])
async def test_receipt_http_rejects_foreign_catalog_without_side_effects(engine, foreign_field):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        shop = await make_shop(session)
        foreign = await make_shop(session)
    app = create_app(SETTINGS)

    async def sessions():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_current_scope] = lambda: shop.scope(PERMISSIONS)
    app.dependency_overrides[session_dependency] = sessions
    payload = receipt(shop)
    if foreign_field == "size":
        payload.lines[0].size_id = foreign.size_id
    else:
        payload.lines[0].product_variant_id = (
            foreign.variant_id if foreign_field == "variant" else uuid.uuid4()
        )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/inventory/receipts",
            json=payload.model_dump(mode="json"),
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
    assert response.status_code == 404, response.text
    async with maker() as session:
        for model in (Inventory, StockLot, StockMovement):
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(model)
                    .where(model.location_id == shop.location_id)
                )
                == 0
            )
