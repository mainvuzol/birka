"""The suggested selling price (owner decisions, 2026-10-01; Q-F), over HTTP
against real PostgreSQL.

- The owner and managers set it; a seller sees it.
- One price for the whole shop, which a store may override with its own.
- The till suggests the store's own price, else the shared one.
- Nobody overwrites a price they have not seen.

All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.catalog.models import EntityStatus, ProductVariant
from app.modules.catalog.prices import PriceScope, set_price
from app.modules.tenancy.models import Store, StoreKind, StoreState
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import TwoShops, api, make_two_shops, stock_a_coat

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
OWNER = DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def owner(shops: TwoShops, user_id: uuid.UUID | None = None) -> RequestScope:
    """The owner's membership is organization-wide, as the bootstrap makes it."""
    return RequestScope(
        user_id=user_id or shops.user_id,
        organization_id=shops.organization_id,
        org_permissions=OWNER,
        store_permissions={shops.primary_store: frozenset(), shops.child_store: frozenset()},
    )


async def coat(maker: async_sessionmaker[AsyncSession], shops: TwoShops) -> str:
    """A coat in the shared warehouse, which both stores' tills sell from."""
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, _ = await stock_a_coat(
            client,
            shops,
            store=shops.primary_store,
            warehouse=shops.shared_warehouse,
            qty=2,
        )
    return variant


async def change(
    maker: async_sessionmaker[AsyncSession],
    scope: RequestScope,
    *,
    store: uuid.UUID,
    variant: str,
    applies_to: str,
    expected: str | None,
    price: str | None,
    **extra: Any,
) -> httpx.Response:
    async with api(maker, scope) as client:
        return await client.post(
            "/api/v1/catalog/prices",
            json={
                "store_id": str(store),
                "product_variant_id": variant,
                "applies_to": applies_to,
                "expected_price": expected,
                "suggested_price": price,
                **extra,
            },
        )


async def suggested_at_till(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, store: uuid.UUID, variant: str
) -> str | None:
    async with api(maker, shops.scope(store)) as client:
        response = await client.get(
            "/api/v1/catalog/stock-options",
            params={"store_id": str(store), "location_id": str(shops.shared_warehouse)},
        )
    assert response.status_code == 200, response.text
    [item] = [i for i in response.json()["items"] if i["product_variant_id"] == variant]
    price: str | None = item["suggested_price"]
    return price


async def test_a_manager_sets_the_store_price_and_the_till_suggests_it(maker):
    shops = await make_two_shops(maker)
    variant = await coat(maker, shops)
    assert await suggested_at_till(maker, shops, shops.primary_store, variant) is None

    response = await change(
        maker,
        shops.scope(shops.primary_store, MANAGER),
        store=shops.primary_store,
        variant=variant,
        applies_to="STORE",
        expected=None,
        price="1850.50",
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "product_variant_id": variant,
        "currency_code": "UAH",
        "shared_price": None,
        "store_price": "1850.50",
        "suggested_price": "1850.50",
        # A manager of one of the two stores: not every till is theirs.
        "may_set_shared": False,
    }
    assert await suggested_at_till(maker, shops, shops.primary_store, variant) == "1850.50"
    # Another store's till does not see this store's own price.
    assert await suggested_at_till(maker, shops, shops.child_store, variant) is None


async def test_the_shared_price_is_set_organization_wide_and_reaches_every_till(maker):
    shops = await make_two_shops(maker)
    variant = await coat(maker, shops)

    # A manager of one store holds the permission in that store only: the
    # shared price would change what every other store's till suggests.
    store_manager = await change(
        maker,
        shops.scope(shops.primary_store, MANAGER),
        store=shops.primary_store,
        variant=variant,
        applies_to="ORGANIZATION",
        expected=None,
        price="2000.00",
    )
    assert store_manager.status_code == 403
    assert store_manager.json()["code"] == "PERMISSION_DENIED"

    response = await change(
        maker,
        owner(shops),
        store=shops.primary_store,
        variant=variant,
        applies_to="ORGANIZATION",
        expected=None,
        price="2000",
    )
    assert response.status_code == 200, response.text
    assert response.json()["shared_price"] == "2000.00"
    assert response.json()["store_price"] is None
    async with maker() as session:
        stated = await session.scalar(
            select(AuditLog.after).where(
                AuditLog.organization_id == shops.organization_id,
                AuditLog.action == "catalog.price_set",
            )
        )
    assert stated == {"applies_to": "ORGANIZATION", "store_id": None, "suggested_price": "2000.00"}
    assert await suggested_at_till(maker, shops, shops.primary_store, variant) == "2000.00"
    assert await suggested_at_till(maker, shops, shops.child_store, variant) == "2000.00"


async def prices_seen(
    maker: async_sessionmaker[AsyncSession], scope: RequestScope, store: uuid.UUID, variant: str
) -> dict[str, Any]:
    async with api(maker, scope) as client:
        response = await client.get(
            "/api/v1/catalog/prices",
            params={"store_id": str(store), "product_variant_id": variant},
        )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_whoever_holds_the_price_in_every_store_sets_the_shared_one(maker):
    """Owner decision, 2026-10-01: a child store's owner may also manage the
    main store. Holding the price in every store, they set the shared one
    too. Every store counts, a paused one included; some of them do not."""
    shops = await make_two_shops(maker)
    variant = await coat(maker, shops)

    def holding(child: frozenset[Permission]) -> RequestScope:
        return RequestScope(
            user_id=shops.user_id,
            organization_id=shops.organization_id,
            store_permissions={shops.primary_store: MANAGER, shops.child_store: child},
        )

    shared = {
        "store": shops.child_store,
        "variant": variant,
        "applies_to": "ORGANIZATION",
    }
    some = holding(SELLER)
    assert (await prices_seen(maker, some, shops.child_store, variant))["may_set_shared"] is False
    refused = await change(maker, some, **shared, expected=None, price="2000.00")
    assert refused.status_code == 403
    assert refused.json()["code"] == "PERMISSION_DENIED"

    every = holding(OWNER)
    assert (await prices_seen(maker, every, shops.child_store, variant))["may_set_shared"] is True
    response = await change(maker, every, **shared, expected=None, price="2000.00")
    assert response.status_code == 200, response.text
    assert response.json()["may_set_shared"] is True
    assert await suggested_at_till(maker, shops, shops.primary_store, variant) == "2000.00"
    assert await suggested_at_till(maker, shops, shops.child_store, variant) == "2000.00"

    # A third store, paused, where they hold nothing: its till will suggest
    # the shared price again when it reopens.
    async with maker() as session:
        session.add(
            Store(
                organization_id=shops.organization_id,
                name="На паузі",
                code="PAUSED",
                kind=StoreKind.SECONDARY,
                state=StoreState.BLOCKED,
            )
        )
        await session.commit()
    assert (await prices_seen(maker, every, shops.child_store, variant))["may_set_shared"] is False
    paused = await change(maker, every, **shared, expected="2000.00", price="2100.00")
    assert paused.status_code == 403
    # Organization-wide, the owner still does.
    assert (await prices_seen(maker, owner(shops), shops.child_store, variant))["may_set_shared"]


async def test_a_store_price_overrides_the_shared_one_until_it_is_removed(maker):
    shops = await make_two_shops(maker)
    variant = await coat(maker, shops)
    shared = await change(
        maker,
        owner(shops),
        store=shops.primary_store,
        variant=variant,
        applies_to="ORGANIZATION",
        expected=None,
        price="2000.00",
    )
    assert shared.status_code == 200, shared.text
    child_manager = shops.scope(shops.child_store, MANAGER)
    own = await change(
        maker,
        child_manager,
        store=shops.child_store,
        variant=variant,
        applies_to="STORE",
        expected=None,
        price="1900.00",
    )
    assert own.status_code == 200, own.text
    assert own.json()["shared_price"] == "2000.00"
    assert own.json()["suggested_price"] == "1900.00"
    assert await suggested_at_till(maker, shops, shops.child_store, variant) == "1900.00"
    assert await suggested_at_till(maker, shops, shops.primary_store, variant) == "2000.00"

    removed = await change(
        maker,
        child_manager,
        store=shops.child_store,
        variant=variant,
        applies_to="STORE",
        expected="1900.00",
        price=None,
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["store_price"] is None
    assert removed.json()["suggested_price"] == "2000.00"
    assert await suggested_at_till(maker, shops, shops.child_store, variant) == "2000.00"


async def test_a_seller_sees_the_price_but_does_not_set_it(maker):
    shops = await make_two_shops(maker)
    variant = await coat(maker, shops)
    refused = await change(
        maker,
        shops.scope(shops.primary_store, SELLER),
        store=shops.primary_store,
        variant=variant,
        applies_to="STORE",
        expected=None,
        price="1850.00",
    )
    assert refused.status_code == 403
    assert refused.json()["details"]["permission"] == Permission.CATALOG_SET_PRICE.value

    async with api(maker, shops.scope(shops.primary_store, SELLER)) as client:
        seen = await client.get(
            "/api/v1/catalog/prices",
            params={"store_id": str(shops.primary_store), "product_variant_id": variant},
        )
    assert seen.status_code == 200, seen.text
    assert seen.json()["suggested_price"] is None

    # Working in another store is no way in.
    async with api(maker, shops.scope(shops.child_store, MANAGER)) as client:
        foreign = await client.get(
            "/api/v1/catalog/prices",
            params={"store_id": str(shops.primary_store), "product_variant_id": variant},
        )
    assert foreign.status_code == 403


async def test_nobody_overwrites_a_price_they_have_not_seen(maker):
    shops = await make_two_shops(maker)
    variant = await coat(maker, shops)
    manager = shops.scope(shops.primary_store, MANAGER)
    first: dict[str, Any] = {
        "store": shops.primary_store,
        "variant": variant,
        "applies_to": "STORE",
        "expected": None,
    }

    assert (await change(maker, manager, **first, price="1850.00")).status_code == 200

    # Someone else, looking at the screen from before, with another price.
    stale = await change(maker, manager, **first, price="1900.00")
    assert stale.status_code == 409
    assert stale.json()["code"] == "PRICE_CHANGED"
    assert stale.json()["details"]["current"] == "1850.00"

    # The first change again — its answer lost — is answered as done.
    retried = await change(maker, manager, **first, price="1850.00")
    assert retried.status_code == 200, retried.text
    assert retried.json()["store_price"] == "1850.00"

    # Stated against what stands, it goes through.
    changed = await change(
        maker,
        manager,
        store=shops.primary_store,
        variant=variant,
        applies_to="STORE",
        expected="1850",
        price="1900.00",
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["store_price"] == "1900.00"

    async with maker() as session:
        entries = (
            await session.scalars(
                select(AuditLog)
                .where(
                    AuditLog.organization_id == shops.organization_id,
                    AuditLog.action.like("catalog.price%"),
                )
                .order_by(AuditLog.created_at)
            )
        ).all()
    # Two changes, two entries: neither the refusal nor the retry wrote one.
    assert [(e.before["suggested_price"], e.after["suggested_price"]) for e in entries] == [
        (None, "1850.00"),
        ("1850.00", "1900.00"),
    ]
    assert {e.actor_user_id for e in entries} == {shops.user_id}
    assert {e.entity_id for e in entries} == {uuid.UUID(variant)}


async def test_two_people_setting_one_price_at_once_are_decided_one_after_the_other(maker):
    """One change holds its transaction open; the other, stated against the
    same empty price, waits for it and is then refused with what it left —
    never a second row, never an error."""
    shops = await make_two_shops(maker)
    variant = await coat(maker, shops)
    other = RequestScope(
        user_id=uuid.uuid4(),
        organization_id=shops.organization_id,
        store_permissions={shops.primary_store: MANAGER},
    )
    async with maker() as session:
        await set_price(
            session,
            scope=shops.scope(shops.primary_store, MANAGER),
            store_id=shops.primary_store,
            variant_id=uuid.UUID(variant),
            applies_to=PriceScope.STORE,
            expected=None,
            price=Decimal("1850.00"),
        )
        second = asyncio.create_task(
            change(
                maker,
                other,
                store=shops.primary_store,
                variant=variant,
                applies_to="STORE",
                expected=None,
                price="1900.00",
            )
        )
        await asyncio.sleep(0.5)
        assert not second.done()
        await session.commit()

    refused = await second
    assert refused.status_code == 409, refused.text
    assert refused.json()["details"]["current"] == "1850.00"


@pytest.mark.parametrize(
    "price",
    ["0", "0.00", "-1.00", "18.505", "12345678901.00"],
)
async def test_a_price_is_more_than_nothing_and_to_the_kopeck(maker, price):
    shops = await make_two_shops(maker)
    variant = await coat(maker, shops)
    response = await change(
        maker,
        shops.scope(shops.primary_store, MANAGER),
        store=shops.primary_store,
        variant=variant,
        applies_to="STORE",
        expected=None,
        price=price,
    )
    assert response.status_code == 422


async def test_a_price_request_says_nothing_it_was_not_asked(maker):
    shops = await make_two_shops(maker)
    variant = await coat(maker, shops)
    response = await change(
        maker,
        shops.scope(shops.primary_store, MANAGER),
        store=shops.primary_store,
        variant=variant,
        applies_to="STORE",
        expected=None,
        price="1850.00",
        currency_code="USD",
    )
    assert response.status_code == 422


async def test_only_the_organizations_own_live_model_is_priced(maker):
    shops = await make_two_shops(maker)
    variant = await coat(maker, shops)
    elsewhere = await make_two_shops(maker)
    foreign = await coat(maker, elsewhere)
    manager = shops.scope(shops.primary_store, MANAGER)

    response = await change(
        maker,
        manager,
        store=shops.primary_store,
        variant=foreign,
        applies_to="STORE",
        expected=None,
        price="1850.00",
    )
    assert response.status_code == 404

    async with maker() as session:
        await session.execute(
            update(ProductVariant)
            .where(ProductVariant.id == uuid.UUID(variant))
            .values(status=EntityStatus.MERGED)
        )
        await session.commit()
    merged = await change(
        maker,
        manager,
        store=shops.primary_store,
        variant=variant,
        applies_to="STORE",
        expected=None,
        price="1850.00",
    )
    assert merged.status_code == 404


async def test_the_migration_gives_the_price_to_whoever_corrects_balances():
    """`0021` grants `catalog:set_price` to every role holding
    `inventory:adjust`, whatever it is called, and to no other."""
    from sqlalchemy import text

    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_price_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "0020_damaged_units", database=name)
        roles: dict[str, uuid.UUID] = {}
        organization_id = uuid.uuid4()
        async with engine.begin() as connection:
            # Written as 0020 knew it: today's models describe a later schema.
            await connection.execute(
                text(
                    "INSERT INTO organization (id, name, currency_code, created_at) "
                    "VALUES (:id, :name, 'UAH', now())"
                ),
                {"id": organization_id, "name": f"org-{name}"},
            )
            for code, held in (("STOCKKEEPER", "inventory:adjust"), ("CASHIER", "sale:create")):
                roles[code] = uuid.uuid4()
                await connection.execute(
                    text(
                        "INSERT INTO role (id, organization_id, code, name, is_system, "
                        "created_at) VALUES (:id, :org, :code, :code, false, now())"
                    ),
                    {"id": roles[code], "org": organization_id, "code": code},
                )
                await connection.execute(
                    text(
                        "INSERT INTO role_permission (role_id, permission_code) VALUES (:id, :held)"
                    ),
                    {"id": roles[code], "held": held},
                )
        await _run(config, "upgrade", "head", database=name)

        async def granted() -> dict[str, bool]:
            async with engine.connect() as connection:
                return {
                    code: bool(
                        await connection.scalar(
                            text(
                                "SELECT count(*) FROM role_permission WHERE role_id = :id "
                                "AND permission_code = 'catalog:set_price'"
                            ),
                            {"id": role_id},
                        )
                    )
                    for code, role_id in roles.items()
                }

        assert await granted() == {"STOCKKEEPER": True, "CASHIER": False}
        await _run(config, "downgrade", "0020_damaged_units", database=name)
        assert await granted() == {"STOCKKEEPER": False, "CASHIER": False}
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
