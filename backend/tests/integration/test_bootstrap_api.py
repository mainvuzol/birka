"""Seeded configuration must be usable, without fixture-created warehouses."""

from __future__ import annotations

import os
import uuid

import pytest
from scripts.seed_organization import seed_in_session
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.authz.service import resolve_scope
from app.modules.identity.models import AppUser
from app.modules.tenancy.models import Organization, StockLocation, Store, StoreLocationAccess
from tests.conftest import requires_database
from tests.integration.test_product_lifecycle_api import api, key

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def setup():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    telegram_id = uuid.uuid4().int % 2**62
    org_name = f"bootstrap-api-{uuid.uuid4()}"
    async with maker() as session:
        for _ in range(2):
            await seed_in_session(
                session,
                telegram_user_id=telegram_id,
                owner_name="Synthetic owner",
                org_name=org_name,
                with_child_warehouse=True,
            )
        await session.commit()
        user = await session.scalar(select(AppUser).where(AppUser.telegram_user_id == telegram_id))
        scope = await resolve_scope(session, user_id=user.id)
        stores = {
            store.code: store.id
            for store in await session.scalars(
                select(Store).where(Store.organization_id == scope.organization_id)
            )
        }
    yield maker, scope, stores
    await engine.dispose()


async def test_seed_discover_receive_and_sell_shared_stock(setup):
    maker, scope, stores = setup
    async with api(maker, scope) as client:
        main = await client.get("/api/v1/stock-locations", params={"store_id": str(stores["MAIN"])})
        child = await client.get(
            "/api/v1/stock-locations", params={"store_id": str(stores["SECOND"])}
        )
        assert main.status_code == child.status_code == 200
        assert len(main.json()) == 1
        # Organization-wide OWNER alone does not see the private child location.
        assert len(child.json()) == 1
        location_id = main.json()[0]["id"]
        assert location_id in {location["id"] for location in child.json()}
        # These places are discoverable before any catalog or stock exists.
        stock = await client.get("/api/v1/inventory", params={"store_id": str(stores["MAIN"])})
        assert stock.json()["rows"] == []
        product = await client.post(
            "/api/v1/catalog/products",
            headers=key(),
            json={
                "store_id": str(stores["MAIN"]),
                "concept": "Bootstrap coat",
                "variant": {"color": "чорний"},
                "sizes": [{"system": "ALPHA", "code": "M"}],
            },
        )
        assert product.status_code == 201, product.text
        variant_id = product.json()["product_variant_id"]
        size_id = product.json()["sizes"][0]["size_id"]
        received = await client.post(
            "/api/v1/inventory/receipts",
            headers=key(),
            json={
                "store_id": str(stores["MAIN"]),
                "location_id": location_id,
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant_id, "size_id": size_id, "quantity": 2}],
            },
        )
        assert received.status_code == 201, received.text
        sold = await client.post(
            "/api/v1/sales",
            headers=key(),
            json={
                "store_id": str(stores["SECOND"]),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": variant_id,
                        "size_id": size_id,
                        "source_location_id": location_id,
                        "quantity": 1,
                        "unit_price": "1500.00",
                    }
                ],
            },
        )
        assert sold.status_code == 201, sold.text
        # Rerun real setup after stock has moved: it must preserve the balance.
        async with maker() as session:
            owner = await session.get(AppUser, scope.user_id)
            organization = await session.get(Organization, scope.organization_id)
            await seed_in_session(
                session,
                telegram_user_id=owner.telegram_user_id,
                owner_name=owner.display_name,
                org_name=organization.name,
                with_child_warehouse=True,
            )
            await session.commit()
        for store_id in stores.values():
            stock = await client.get("/api/v1/inventory", params={"store_id": str(store_id)})
            assert stock.json()["rows"][0]["quantity"] == 1
            assert stock.json()["rows"][0]["location_id"] == location_id


async def test_discovery_preserves_paused_visibility_and_honors_revocation(setup):
    maker, scope, stores = setup
    async with api(maker, scope) as client:
        response = await client.get(
            "/api/v1/stock-locations", params={"store_id": str(stores["MAIN"])}
        )
        location_id = uuid.UUID(response.json()[0]["id"])
        async with maker() as session:
            await session.execute(
                update(StockLocation).where(StockLocation.id == location_id).values(is_active=False)
            )
            await session.commit()
        paused = await client.get(
            "/api/v1/stock-locations", params={"store_id": str(stores["MAIN"])}
        )
        assert paused.json()[0]["is_active"] is False
        async with maker() as session:
            await session.execute(
                delete(StoreLocationAccess).where(StoreLocationAccess.store_id == stores["MAIN"])
            )
            await session.commit()
        revoked = await client.get(
            "/api/v1/stock-locations", params={"store_id": str(stores["MAIN"])}
        )
        assert revoked.json() == []


async def test_discovery_requires_view_and_store_membership(setup):
    maker, scope, stores = setup
    restricted = RequestScope(
        user_id=scope.user_id,
        organization_id=scope.organization_id,
        store_permissions={stores["SECOND"]: frozenset()},
    )
    async with api(maker, restricted) as client:
        missing_permission = await client.get(
            "/api/v1/stock-locations", params={"store_id": str(stores["SECOND"])}
        )
        assert missing_permission.status_code == 403
        assert missing_permission.json()["code"] == "PERMISSION_DENIED"
    viewer = RequestScope(
        user_id=scope.user_id,
        organization_id=scope.organization_id,
        store_permissions={stores["SECOND"]: frozenset({Permission.INVENTORY_VIEW})},
    )
    async with api(maker, viewer) as client:
        for store_id in (stores["MAIN"], uuid.uuid4()):
            refused = await client.get(
                "/api/v1/stock-locations", params={"store_id": str(store_id)}
            )
            assert refused.status_code == 403
            assert refused.json()["code"] == "FORBIDDEN_STORE"
