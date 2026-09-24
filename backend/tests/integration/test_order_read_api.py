"""Seller read pages filter access before pagination and preserve frozen labels."""

from __future__ import annotations

import os
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.models import Size
from app.modules.orders.service import OrderLineInput, create_order
from app.modules.tenancy.models import StockLocation, StoreLocationAccess
from tests.conftest import provision_location, requires_database
from tests.integration.test_customer_orders import setup
from tests.integration.test_sale_command import give_stock, make_shop
from tests.integration.test_transfer_command import api

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def new_order(session, shop, locations):
    return await create_order(
        session,
        scope=shop.scope(),
        store_id=shop.store_id,
        command_id=uuid.uuid4(),
        lines=[
            OrderLineInput(shop.variant_id, shop.size_id, location, 1, Decimal("10"))
            for location in locations
        ],
    )


async def test_order_pages_filter_whole_inaccessible_orders_before_pagination(maker):
    shop, first = await setup(maker)
    async with maker() as session:
        second = await new_order(session, shop, [shop.location_id])
        private = await provision_location(
            session,
            organization_id=shop.organization_id,
            store_id=shop.store_id,
        )
        original = shop.location_id
        shop.location_id = private
        await give_stock(session, shop, 2)
        shop.location_id = original
        hidden = await new_order(session, shop, [original, private])
        await session.execute(
            delete(StoreLocationAccess).where(
                StoreLocationAccess.location_id == private,
            )
        )
        await session.execute(update(Size).where(Size.id == shop.size_id).values(code="XL"))
        await session.commit()
    async with api(maker, shop.scope()) as client:
        first_page = await client.get(
            "/api/v1/orders", params={"store_id": str(shop.store_id), "limit": 1}
        )
        assert first_page.status_code == 200
        body = first_page.json()
        assert body["has_more"] and body["orders"][0]["id"] == second["id"]
        assert body["orders"][0]["items"][0]["size_label"] == "M"
        assert body["orders"][0]["created_at"]
        next_page = (
            await client.get(
                "/api/v1/orders", params={"store_id": str(shop.store_id), "limit": 1, "offset": 1}
            )
        ).json()
        assert not next_page["has_more"] and next_page["orders"][0]["id"] == str(first)
        assert (await client.get("/api/v1/orders/" + hidden["id"])).status_code == 403
        assert (
            await client.get(
                "/api/v1/orders", params={"store_id": str(shop.store_id), "offset": -1}
            )
        ).status_code == 422
        assert (
            await client.get(
                "/api/v1/orders", params={"store_id": str(shop.store_id), "limit": 101}
            )
        ).status_code == 422


async def test_order_private_permissions_and_tenant_store_boundaries(maker):
    shop, order = await setup(maker)
    async with maker() as session:
        other = await make_shop(session)
        await session.execute(
            update(StockLocation)
            .where(StockLocation.id == shop.location_id)
            .values(managing_store_id=shop.store_id)
        )
        await session.commit()
    elevated = RequestScope(
        user_id=shop.user_id,
        organization_id=shop.organization_id,
        org_permissions=frozenset(Permission),
        store_permissions={shop.store_id: frozenset({Permission.INVENTORY_VIEW})},
    )
    async with api(maker, elevated) as client:
        result = await client.get("/api/v1/orders", params={"store_id": str(shop.store_id)})
        assert result.json() == {"orders": [], "has_more": False}
        assert (await client.get(f"/api/v1/orders/{order}")).status_code == 403
    async with api(maker, shop.scope()) as client:
        assert (
            len(
                (
                    await client.get("/api/v1/orders", params={"store_id": str(shop.store_id)})
                ).json()["orders"]
            )
            == 1
        )
    async with api(maker, other.scope()) as client:
        assert (await client.get(f"/api/v1/orders/{order}")).status_code == 404
        assert (
            await client.get("/api/v1/orders", params={"store_id": str(shop.store_id)})
        ).status_code == 403
    async with api(maker, shop.scope(frozenset({Permission.INVENTORY_VIEW}))) as client:
        assert (
            await client.get("/api/v1/orders", params={"store_id": str(shop.store_id)})
        ).status_code == 403


async def test_stock_options_pagination_reservations_labels_and_access(maker):
    shop, _ = await setup(maker)
    async with maker() as session:
        original_size = await session.get(Size, shop.size_id)
        added_size = Size(size_system_id=original_size.size_system_id, code="S")
        session.add(added_size)
        await session.flush()
        original_id = shop.size_id
        shop.size_id = added_size.id
        await give_stock(session, shop, 4)
        shop.size_id = original_id
        other = await make_shop(session)
        await session.commit()
    params = {"store_id": str(shop.store_id), "location_id": str(shop.location_id), "limit": 1}
    async with api(maker, shop.scope()) as client:
        page = await client.get("/api/v1/catalog/stock-options", params=params)
        assert page.status_code == 200 and page.json()["has_more"]
        next_page = (
            await client.get("/api/v1/catalog/stock-options", params={**params, "offset": 1})
        ).json()
        assert not next_page["has_more"]
        items = page.json()["items"] + next_page["items"]
        assert {i["size_label"] for i in items} == {"M", "S"}
        reserved = next(i for i in items if i["size_label"] == "M")
        assert (
            reserved["quantity"],
            reserved["reserved_quantity"],
            reserved["available_quantity"],
        ) == (5, 2, 3)
        assert "Лоран" in reserved["display_name"]
        assert (
            await client.get(
                "/api/v1/catalog/stock-options",
                params={**params, "location_id": str(other.location_id)},
            )
        ).status_code == 404
        assert (
            await client.get("/api/v1/catalog/stock-options", params={**params, "offset": -1})
        ).status_code == 422
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
        org_permissions=frozenset(Permission),
        store_permissions={shop.store_id: frozenset()},
    )
    async with api(maker, global_scope) as client:
        assert (await client.get("/api/v1/catalog/stock-options", params=params)).status_code == 403
    async with maker() as session:
        await session.execute(
            delete(StoreLocationAccess).where(StoreLocationAccess.location_id == shop.location_id)
        )
        await session.commit()
    async with api(maker, shop.scope()) as client:
        assert (await client.get("/api/v1/catalog/stock-options", params=params)).status_code == 403
