"""The till's search of every warehouse a store sells from (sale-slice TZ,
P2-5; owner decision, 2026-10-17: a chip per warehouse).

With no warehouse named, the list holds the stock of each warehouse the store
sells from now — active, with `can_sell` — that the seller may read, and each
row says where it is, so the seller still chooses the warehouse line by line
(owner decision, 2026-09-17). A warehouse named is listed alone, as before.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.main import create_app
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import MovementRequest, apply_movements
from app.modules.tenancy.models import StockLocation
from tests.conftest import provision_location, requires_database
from tests.integration.test_sale_command import Shop, make_shop
from tests.integration.test_till_search import client_for, sizes

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


OPTIONS = "/api/v1/catalog/stock-options"


@asynccontextmanager
async def scoped(maker, scope: RequestScope):
    """Signed in with exactly this scope."""
    app = create_app(Settings(app_env="local", session_secret="till-search-secret-32-bytes-long!"))

    async def sessions():
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    app.dependency_overrides[get_current_scope] = lambda: scope
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://till"
    ) as client:
        yield client


async def warehouse(maker, shop: Shop, name: str, **access: bool) -> uuid.UUID:
    async with maker() as session:
        made = await provision_location(
            session,
            organization_id=shop.organization_id,  # type: ignore[arg-type]
            store_id=shop.store_id if access.pop("reached", True) else None,  # type: ignore[arg-type]
            name=name,
            **access,
        )
        await session.commit()
        return made


async def held(maker, shop: Shop, at: uuid.UUID, counts: dict[uuid.UUID, int]) -> None:
    async with maker() as session:
        await apply_movements(
            session,
            organization_id=shop.organization_id,  # type: ignore[arg-type]
            requests=[
                MovementRequest(
                    location_id=at,
                    acting_store_id=shop.store_id,  # type: ignore[arg-type]
                    product_variant_id=shop.variant_id,  # type: ignore[arg-type]
                    size_id=size_id,
                    quantity_delta=quantity,
                    movement_type=MovementType.DELIVERY,
                )
                for size_id, quantity in counts.items()
            ],
        )
        await session.commit()


def where(response) -> list[tuple[str, str, int]]:
    assert response.status_code == 200, response.text
    return [
        (item["location_id"], item["size_label"], item["available_quantity"])
        for item in response.json()["items"]
    ]


async def test_with_no_warehouse_named_every_one_it_sells_from_is_listed_each_row_saying_where(
    maker,
):
    async with maker() as session:
        shop = await make_shop(session)
    known = await sizes(maker, shop, "M", "L")
    main = shop.location_id
    shared = await warehouse(maker, shop, "Спільний")
    no_sale = await warehouse(maker, shop, "Лише приймання", can_sell=False)
    paused = await warehouse(maker, shop, "На паузі")
    unreached = await warehouse(maker, shop, "Чужий", reached=False)
    await held(maker, shop, main, {known["M"]: 1})
    await held(maker, shop, shared, {known["M"]: 2, known["L"]: 1})
    for elsewhere in (no_sale, paused):
        await held(maker, shop, elsewhere, {known["M"]: 5})
    async with maker() as session:
        await session.execute(
            update(StockLocation).where(StockLocation.id == paused).values(is_active=False)
        )
        await session.commit()
    await held(maker, shop, unreached, {known["M"]: 7})

    async with client_for(maker, shop) as client:
        every = await client.get(OPTIONS, params={"store_id": str(shop.store_id)})
        alone = await client.get(
            OPTIONS, params={"store_id": str(shop.store_id), "location_id": str(shared)}
        )
    # Sizes in receiving's order, and within a size each warehouse in turn.
    assert sorted(where(every)) == sorted(
        [(str(main), "M", 1), (str(shared), "M", 2), (str(shared), "L", 1)]
    )
    labels = [label for _, label, _ in where(every)]
    assert labels == sorted(labels, key=["M", "L"].index)
    # Named, a warehouse is listed alone, its rows saying it.
    assert where(alone) == [(str(shared), "M", 2), (str(shared), "L", 1)]


async def test_the_pages_neither_repeat_nor_skip_a_row_across_warehouses(maker):
    async with maker() as session:
        shop = await make_shop(session)
    known = await sizes(maker, shop, "S", "M", "L")
    shared = await warehouse(maker, shop, "Спільний")
    for at in (shop.location_id, shared):
        await held(maker, shop, at, dict.fromkeys(known.values(), 1))
    async with client_for(maker, shop) as client:
        whole = where(await client.get(OPTIONS, params={"store_id": str(shop.store_id)}))
        paged: list[tuple[str, str, int]] = []
        for offset in range(0, 6, 2):
            paged += where(
                await client.get(
                    OPTIONS,
                    params={"store_id": str(shop.store_id), "limit": 2, "offset": offset},
                )
            )
    assert len(whole) == 6
    assert paged == whole


async def test_the_whole_list_asks_the_same_right_as_one_warehouse(maker):
    async with maker() as session:
        shop = await make_shop(session)
    async with client_for(maker, shop, frozenset({Permission.SALE_CREATE})) as client:
        refused = await client.get(OPTIONS, params={"store_id": str(shop.store_id)})
    assert refused.status_code == 403, refused.text


async def test_a_private_warehouse_is_listed_only_for_whoever_reads_that_store_s_own(maker):
    """I23 unchanged with no warehouse named: a warehouse a store manages for
    itself is read only by those holding `inventory:view` there directly,
    never through a network-wide right."""
    async with maker() as session:
        shop = await make_shop(session)
    known = await sizes(maker, shop, "M")
    private = await warehouse(maker, shop, "Свій приватний")
    async with maker() as session:
        await session.execute(
            update(StockLocation)
            .where(StockLocation.id == private)
            .values(managing_store_id=shop.store_id)
        )
        await session.commit()
    await held(maker, shop, shop.location_id, {known["M"]: 1})
    await held(maker, shop, private, {known["M"]: 2})
    network_wide = RequestScope(
        user_id=shop.user_id,  # type: ignore[arg-type]
        organization_id=shop.organization_id,  # type: ignore[arg-type]
        org_permissions=frozenset({Permission.INVENTORY_VIEW, Permission.SALE_CREATE}),
        # As the server builds it for a network-wide person: the store
        # loaded, nothing granted there directly.
        store_permissions={shop.store_id: frozenset()},  # type: ignore[dict-item]
    )
    async with client_for(maker, shop) as client:
        direct = await client.get(OPTIONS, params={"store_id": str(shop.store_id)})
    async with scoped(maker, network_wide) as client:
        across = await client.get(OPTIONS, params={"store_id": str(shop.store_id)})
    assert sorted(where(direct)) == sorted(
        [(str(shop.location_id), "M", 1), (str(private), "M", 2)]
    )
    assert where(across) == [(str(shop.location_id), "M", 1)]
