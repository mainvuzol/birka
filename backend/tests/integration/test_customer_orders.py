"""Order reservations, postal stages and collection are distinct durable facts."""

from __future__ import annotations

import asyncio
import os
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.errors import (
    IdempotencyConflictError,
    LocationAccessDeniedError,
    ValidationFailedError,
)
from app.modules.authz.permissions import Permission
from app.modules.catalog.models import CanonicalConcept
from app.modules.inventory.models import Inventory, MovementType, StockMovement
from app.modules.orders.models import CustomerOrder
from app.modules.orders.service import OrderLineInput, create_order, read_order, transition_order
from app.modules.sales.models import Sale, SaleItem
from app.modules.tenancy.models import StoreLocationAccess
from tests.conftest import requires_database
from tests.integration.test_sale_command import give_stock, make_shop
from tests.integration.test_transfer_command import api

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def setup(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 5)
        body = await create_order(
            session,
            scope=shop.scope(),
            store_id=shop.store_id,
            command_id=uuid.uuid4(),
            lines=[
                OrderLineInput(
                    shop.variant_id,
                    shop.size_id,
                    shop.location_id,
                    2,
                    Decimal("300.00"),
                    Decimal("20.00"),
                )
            ],
        )
        await session.commit()
    return shop, uuid.UUID(body["id"])


async def act(maker, shop, order, action, *, command_id=None, reason=None):
    async with maker() as session:
        body = await transition_order(
            session,
            scope=shop.scope(frozenset(Permission)),
            order_id=order,
            command_id=command_id or uuid.uuid4(),
            action=action,
            reason=reason,
        )
        await session.commit()
        return body


async def stock_and_sales(maker, shop):
    async with maker() as session:
        stock = (
            await session.scalars(
                select(Inventory).where(Inventory.location_id == shop.location_id)
            )
        ).one()
        count = await session.scalar(
            select(func.count())
            .select_from(Sale)
            .where(Sale.organization_id == shop.organization_id)
        )
        return stock.quantity, stock.reserved_quantity, count


async def test_collection_freezes_order_price_and_name_without_second_stockout(maker):
    shop, order = await setup(maker)
    assert await stock_and_sales(maker, shop) == (5, 2, 0)
    await act(maker, shop, order, "dispatch")
    assert await stock_and_sales(maker, shop) == (3, 0, 0)
    await act(maker, shop, order, "arrive")
    assert await stock_and_sales(maker, shop) == (3, 0, 0)
    async with maker() as session:
        await session.execute(
            update(CanonicalConcept)
            .where(CanonicalConcept.id == shop.concept_id)
            .values(name="Перейменовано")
        )
        await session.commit()
    collected = await act(maker, shop, order, "collect")
    assert collected["status"] == "COLLECTED" and collected["total"] == "560.00"
    assert await stock_and_sales(maker, shop) == (3, 0, 1)
    async with maker() as session:
        sale_item = (
            await session.scalars(
                select(SaleItem).where(SaleItem.sale_id == uuid.UUID(collected["sale_id"]))
            )
        ).one()
        assert sale_item.final_unit_price == Decimal("280.00")
        assert "Лоран" in sale_item.display_name_snapshot
        assert (
            await session.scalar(
                select(func.count())
                .select_from(StockMovement)
                .where(
                    StockMovement.reference_id == order,
                    StockMovement.movement_type == MovementType.ORDER_DISPATCH,
                )
            )
            == 1
        )


async def test_original_stage_response_is_durable_after_advancing(maker):
    shop, order = await setup(maker)
    command = uuid.uuid4()
    dispatched = await act(maker, shop, order, "dispatch", command_id=command)
    await act(maker, shop, order, "arrive")
    assert await act(maker, shop, order, "dispatch", command_id=command) == dispatched
    with pytest.raises(IdempotencyConflictError):
        await act(maker, shop, order, "collect", command_id=command)


async def test_cancel_releases_and_dispatch_cannot_follow(maker):
    shop, order = await setup(maker)
    await act(maker, shop, order, "cancel")
    assert await stock_and_sales(maker, shop) == (5, 0, 0)
    with pytest.raises(ValidationFailedError):
        await act(maker, shop, order, "dispatch")


async def test_postdispatch_return_needs_physical_reason_and_restocks_once(maker):
    shop, order = await setup(maker)
    await act(maker, shop, order, "dispatch")
    with pytest.raises(ValidationFailedError):
        await act(maker, shop, order, "cancel")
    with pytest.raises(ValidationFailedError):
        await act(maker, shop, order, "return", reason="  ")
    command = uuid.uuid4()
    body = await act(
        maker, shop, order, "return", command_id=command, reason="Товар фізично повернувся"
    )
    assert (
        await act(
            maker, shop, order, "return", command_id=command, reason="Товар фізично повернувся"
        )
        == body
    )
    assert await stock_and_sales(maker, shop) == (5, 0, 0)


async def test_access_revocation_blocks_replay_and_reads(maker):
    shop, order = await setup(maker)
    command = uuid.uuid4()
    await act(maker, shop, order, "dispatch", command_id=command)
    async with maker() as session:
        await session.execute(
            StoreLocationAccess.__table__.delete().where(
                StoreLocationAccess.store_id == shop.store_id
            )
        )
        await session.commit()
    with pytest.raises(LocationAccessDeniedError):
        await act(maker, shop, order, "dispatch", command_id=command)
    async with maker() as session:
        with pytest.raises(LocationAccessDeniedError):
            await read_order(session, scope=shop.scope(), order_id=order)


@pytest.mark.parametrize("competing_actions", [("collect", "collect"), ("dispatch", "cancel")])
async def test_competing_transitions_are_serialized(maker, competing_actions):
    shop, order = await setup(maker)
    if competing_actions == ("collect", "collect"):
        await act(maker, shop, order, "dispatch")
        await act(maker, shop, order, "arrive")
    async with maker() as holder:
        await holder.scalar(
            select(CustomerOrder).where(CustomerOrder.id == order).with_for_update()
        )
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        tasks = [
            asyncio.create_task(act(maker, shop, order, action)) for action in competing_actions
        ]
        try:
            async with maker() as observer:
                for _ in range(1000):
                    blocked = await observer.scalar(
                        text(
                            "WITH RECURSIVE waiters(pid) AS (SELECT CAST(:pid AS integer) "
                            "UNION SELECT l.pid FROM pg_locks l JOIN waiters w "
                            "ON w.pid = ANY(pg_blocking_pids(l.pid)) WHERE NOT l.granted) "
                            "SELECT count(*) - 1 FROM waiters"
                        ),
                        {"pid": holder_pid},
                    )
                    await observer.rollback()
                    if blocked == 2:
                        break
                    await asyncio.sleep(0.01)
                else:
                    pytest.fail("Both stage commands must contend on the order row")
            await holder.commit()
            outcomes = await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
    assert sum(isinstance(x, dict) for x in outcomes) == 1
    assert sum(isinstance(x, ValidationFailedError) for x in outcomes) == 1
    if competing_actions == ("collect", "collect"):
        assert await stock_and_sales(maker, shop) == (3, 0, 1)
    else:
        winner = next(body for body in outcomes if isinstance(body, dict))
        physical = 3 if winner["status"] == "DISPATCHED" else 5
        assert await stock_and_sales(maker, shop) == (physical, 0, 0)


async def test_http_contract_requires_physical_return_confirmation(maker):
    shop, order = await setup(maker)
    async with api(maker, shop.scope(frozenset(Permission))) as client:
        read = await client.get(f"/api/v1/orders/{order}")
        assert read.status_code == 200, read.text
        dispatched = await client.post(
            f"/api/v1/orders/{order}/dispatch", json={"command_id": str(uuid.uuid4())}
        )
        assert dispatched.status_code == 200, dispatched.text
        bad = await client.post(
            f"/api/v1/orders/{order}/return",
            json={"command_id": str(uuid.uuid4()), "reason": "Returned"},
        )
        assert bad.status_code == 422
        good = await client.post(
            f"/api/v1/orders/{order}/return",
            json={
                "command_id": str(uuid.uuid4()),
                "reason": "Returned",
                "physically_received": True,
            },
        )
        assert good.status_code == 200, good.text


async def test_concurrent_same_create_command_reserves_once(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 5)
    command = uuid.uuid4()

    async def create():
        async with maker() as session:
            body = await create_order(
                session,
                scope=shop.scope(),
                store_id=shop.store_id,
                command_id=command,
                lines=[
                    OrderLineInput(
                        shop.variant_id, shop.size_id, shop.location_id, 2, Decimal("300")
                    )
                ],
            )
            await session.commit()
            return body

    first, second = await asyncio.gather(create(), create())
    assert first == second
    assert await stock_and_sales(maker, shop) == (5, 2, 0)


async def test_http_create_strict_quantity_and_no_client_status(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 5)
    payload = {
        "store_id": str(shop.store_id),
        "command_id": str(uuid.uuid4()),
        "lines": [
            {
                "product_variant_id": str(shop.variant_id),
                "size_id": str(shop.size_id),
                "source_location_id": str(shop.location_id),
                "quantity": True,
                "unit_price": "300",
            }
        ],
    }
    async with api(maker, shop.scope()) as client:
        invalid = await client.post("/api/v1/orders", json=payload)
        assert invalid.status_code == 422
        payload["lines"][0]["quantity"] = 2
        good = await client.post("/api/v1/orders", json=payload)
        assert good.status_code == 201, good.text
        repeat = await client.post("/api/v1/orders", json=payload)
        assert repeat.json() == good.json()
        payload["status"] = "COLLECTED"
        invalid = await client.post("/api/v1/orders", json=payload)
        assert invalid.status_code == 422
    assert await stock_and_sales(maker, shop) == (5, 2, 0)


async def test_foreign_tenant_order_is_not_disclosed(maker):
    from app.core.errors import NotFoundError

    shop, order = await setup(maker)
    async with maker() as session:
        outsider = await make_shop(session)
        with pytest.raises(NotFoundError):
            await read_order(session, scope=outsider.scope(), order_id=order)
        with pytest.raises(NotFoundError):
            await transition_order(
                session,
                scope=outsider.scope(),
                order_id=order,
                command_id=uuid.uuid4(),
                action="cancel",
            )
    assert await stock_and_sales(maker, shop) == (5, 2, 0)


async def test_global_manager_cannot_operate_private_order_without_direct_permission(maker):
    from app.core.errors import PermissionDeniedError
    from app.modules.authz.scope import RequestScope
    from app.modules.tenancy.models import StockLocation

    shop, order = await setup(maker)
    async with maker() as session:
        await session.execute(
            update(StockLocation)
            .where(StockLocation.id == shop.location_id)
            .values(managing_store_id=shop.store_id)
        )
        await session.commit()
        global_scope = RequestScope(
            user_id=shop.user_id,
            organization_id=shop.organization_id,
            store_permissions={shop.store_id: frozenset({Permission.SALE_VIEW})},
            org_permissions=frozenset(Permission),
        )
        with pytest.raises(PermissionDeniedError):
            await transition_order(
                session,
                scope=global_scope,
                order_id=order,
                command_id=uuid.uuid4(),
                action="dispatch",
            )
