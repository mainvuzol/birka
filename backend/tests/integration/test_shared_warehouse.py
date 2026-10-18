"""M1-029 — two stores, one shared warehouse, over HTTP against real PostgreSQL.

The shape the owner confirmed on 2026-09-15 and refined on 2026-09-17:

    W-SHARED   the primary store's warehouse — BOTH stores sell from it
    W-CHILD    the child store's own warehouse — only the child store

Every access row below is written out explicitly. Nothing is derived from a
store's name, its `StoreKind`, or which warehouse "looks like" whose: that
inference is exactly what the owner ruled out, so these tests must not lean on
it either, or they would prove the wrong thing.

What each test is evidence for is named in its docstring. The headline is
`test_two_stores_cannot_both_sell_the_last_shared_coat`: before this change the
shared pile had to be recorded twice, once per store, and two `UPDATE`s against
two different rows never contended. One coat could be sold twice.

All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from typing import Any

import httpx
import pytest
from sqlalchemy import func, insert, select, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.main import create_app
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.identity.models import AppUser
from app.modules.inventory.models import Inventory, MovementType, StockMovement
from app.modules.inventory.service import find_divergences
from app.modules.refunds.models import RefundItem
from app.modules.sales.models import Sale, SaleItem
from app.modules.sales.payment import PaymentMethod
from app.modules.tenancy.models import Organization, Store, StoreKind
from tests.conftest import provision_location, requires_database

pytestmark = [pytest.mark.integration, requires_database()]

SETTINGS = Settings(app_env="local", session_secret="shared-warehouse-secret-at-least-32-bytes")
SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]


@dataclass(frozen=True, slots=True)
class TwoShops:
    """One organization, two stores, two warehouses, one of them shared."""

    organization_id: uuid.UUID
    primary_store: uuid.UUID
    child_store: uuid.UUID
    shared_warehouse: uuid.UUID
    child_warehouse: uuid.UUID
    user_id: uuid.UUID

    def scope(
        self, store_id: uuid.UUID, permissions: frozenset[Permission] = SELLER
    ) -> RequestScope:
        return RequestScope(
            user_id=self.user_id,
            organization_id=self.organization_id,
            store_permissions={store_id: permissions},
        )


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def make_two_shops(
    maker: async_sessionmaker[AsyncSession], *, child_may_receive_shared: bool = True
) -> TwoShops:
    async with maker() as session:
        org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", currency_code="UAH")
        session.add(org)
        await session.flush()
        primary = Store(
            organization_id=org.id, name="Основний", code="MAIN", kind=StoreKind.PRIMARY
        )
        child = Store(
            organization_id=org.id, name="Дочірній", code="CHILD", kind=StoreKind.SECONDARY
        )
        session.add_all([primary, child])
        # The person through the table, naming only the columns every
        # revision has: migration tests build their shops before upgrading,
        # and the ORM would also ask back for columns added since.
        user_id = uuid.uuid4()
        await session.execute(
            insert(AppUser.__table__).values(
                id=user_id, telegram_user_id=uuid.uuid4().int % 2**62, display_name="Оля"
            )
        )
        await session.flush()

        shared = await provision_location(
            session,
            organization_id=org.id,
            store_id=primary.id,
            code="W-SHARED",
            name="Основний склад",
        )
        # The child store reaches the shared warehouse because of THIS row —
        # not because of its kind, and not because the warehouse belongs to
        # the primary store.
        from app.modules.tenancy.models import StoreLocationAccess

        session.add(
            StoreLocationAccess(
                organization_id=org.id,
                store_id=child.id,
                location_id=shared,
                can_sell=True,
                can_receive=child_may_receive_shared,
            )
        )
        child_warehouse = await provision_location(
            session,
            organization_id=org.id,
            store_id=child.id,
            code="W-CHILD",
            name="Склад дочірнього",
        )
        await session.commit()
        return TwoShops(
            organization_id=org.id,
            primary_store=primary.id,
            child_store=child.id,
            shared_warehouse=shared,
            child_warehouse=child_warehouse,
            user_id=user_id,
        )


@asynccontextmanager
async def api(
    maker: async_sessionmaker[AsyncSession], scope: RequestScope
) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(SETTINGS)

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[get_current_scope] = lambda: scope
    app.dependency_overrides[session_dependency] = sessions
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


def key() -> dict[str, str]:
    return {"Idempotency-Key": str(uuid.uuid4())}


async def stock_a_coat(
    client: httpx.AsyncClient, shops: TwoShops, *, store: uuid.UUID, warehouse: uuid.UUID, qty: int
) -> tuple[str, str]:
    """Create a product and receive `qty` of it into one warehouse."""
    created = await client.post(
        "/api/v1/catalog/products",
        json={
            "store_id": str(store),
            "concept": f"Лоран-{uuid.uuid4().hex[:8]}",
            "variant": {"color": "шоколад"},
            "sizes": [{"system": "ALPHA", "code": "M"}],
        },
        headers=key(),
    )
    assert created.status_code == 201, created.text
    product = created.json()
    size_id = str(product["sizes"][0]["size_id"])
    if qty == 0:
        # A product that exists in the catalog with nothing on any shelf —
        # the starting point for a "physically present" correction.
        return str(product["product_variant_id"]), size_id
    received = await client.post(
        "/api/v1/inventory/receipts",
        json={
            "store_id": str(store),
            "location_id": str(warehouse),
            "command_id": str(uuid.uuid4()),
            "lines": [
                {
                    "product_variant_id": product["product_variant_id"],
                    "size_id": size_id,
                    "quantity": qty,
                }
            ],
        },
        headers=key(),
    )
    assert received.status_code == 201, received.text
    return str(product["product_variant_id"]), size_id


def sale_body(
    store: uuid.UUID, warehouse: uuid.UUID, variant: str, size: str, qty: int = 1
) -> dict[str, Any]:
    return {
        "store_id": str(store),
        "command_id": str(uuid.uuid4()),
        "lines": [
            {
                "product_variant_id": variant,
                "size_id": size,
                "source_location_id": str(warehouse),
                "quantity": qty,
                "unit_price": "1500.00",
            }
        ],
        # The till's button that sold (owner decisions, 2026-10-04).
        "payment_method": "CASH",
    }


def order_body(
    store: uuid.UUID, warehouse: uuid.UUID, variant: str, size: str, qty: int = 1
) -> dict[str, Any]:
    """The same goods as an order. An order says how it was paid only when it
    is collected, and its request knows no other field."""
    body = sale_body(store, warehouse, variant, size, qty)
    del body["payment_method"]
    return body


async def quantity_at(session: AsyncSession, warehouse: uuid.UUID, variant: str, size: str) -> int:
    return (
        await session.scalar(
            select(Inventory.quantity).where(
                Inventory.location_id == warehouse,
                Inventory.product_variant_id == uuid.UUID(variant),
                Inventory.size_id == uuid.UUID(size),
            )
        )
    ) or 0


# ---------------------------------------------------------------------------
# The headline: one balance, two stores, real contention
# ---------------------------------------------------------------------------


async def test_both_stores_sell_from_the_shared_warehouse_and_each_keeps_its_own_sale(maker):
    """The confirmed shape: one pile, two shops, revenue credited separately.

    Selecting shared stock for a sale is **not** a transfer — no
    `TRANSFER_OUT`/`TRANSFER_IN` may appear anywhere (invariant I16).
    """
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=4
        )
        primary_sale = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size),
            headers=key(),
        )
        assert primary_sale.status_code == 201, primary_sale.text

    async with api(maker, shops.scope(shops.child_store)) as client:
        child_sale = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.child_store, shops.shared_warehouse, variant, size),
            headers=key(),
        )
        assert child_sale.status_code == 201, child_sale.text

    async with maker() as session:
        # One pile, decremented twice — not two piles decremented once each.
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Inventory)
                .where(Inventory.product_variant_id == uuid.UUID(variant))
            )
            == 1
        )

        # Each sale belongs to the store that made it…
        assert primary_sale.json()["store_id"] == str(shops.primary_store)
        assert child_sale.json()["store_id"] == str(shops.child_store)
        # …and the ledger records both where it happened and who did it.
        movements = (
            await session.scalars(
                select(StockMovement).where(
                    StockMovement.location_id == shops.shared_warehouse,
                    StockMovement.movement_type == MovementType.SALE,
                )
            )
        ).all()
        assert {m.acting_store_id for m in movements} == {
            shops.primary_store,
            shops.child_store,
        }
        assert all(m.location_id == shops.shared_warehouse for m in movements)

        # Drawing shared stock is not a transfer.
        assert (
            await session.scalar(
                select(func.count())
                .select_from(StockMovement)
                .where(
                    StockMovement.organization_id == shops.organization_id,
                    StockMovement.movement_type.in_(
                        [MovementType.TRANSFER_IN, MovementType.TRANSFER_OUT]
                    ),
                )
            )
            == 0
        )
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_two_stores_cannot_both_sell_the_last_shared_coat(
    maker: async_sessionmaker[AsyncSession],
):
    """**The reason M1-029 exists.**

    One coat, two sellers in two different shops, both drawing from the shared
    warehouse, neither correcting stock. Exactly one sale may succeed.

    Under the old store-keyed model the shared pile had to be recorded under
    both stores, so the two conditional `UPDATE`s hit two different rows and
    never contended: both sales committed and one coat was sold twice. Here
    they contend on one row, and PostgreSQL serialises them.

    The first transaction is held open deliberately rather than relying on
    `asyncio.gather`: whether two racing requests overlap at the critical
    moment is a coin flip, and a test that only sometimes reaches the window
    is not a guard.
    """
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=1
        )

    async def child_sells() -> int:
        async with api(maker, shops.scope(shops.child_store)) as client:
            response = await client.post(
                "/api/v1/sales",
                json=sale_body(shops.child_store, shops.shared_warehouse, variant, size),
                headers=key(),
            )
            return response.status_code

    # The primary store takes the coat with a real sale, and holds the
    # transaction open. A raw UPDATE would hold the lock just as well, but it
    # would leave a quantity change with no ledger entry behind it — breaking
    # invariant I3 inside the fixture, and reporting a divergence that has
    # nothing to do with what this test is about.
    from decimal import Decimal

    from app.modules.sales.service import SaleLineInput, create_sale

    async with maker() as holder:
        await create_sale(
            holder,
            scope=shops.scope(shops.primary_store),
            store_id=shops.primary_store,
            command_id=uuid.uuid4(),
            currency_code="UAH",
            lines=[
                SaleLineInput(
                    product_variant_id=uuid.UUID(variant),
                    size_id=uuid.UUID(size),
                    source_location_id=shops.shared_warehouse,
                    quantity=1,
                    unit_price=Decimal("1500.00"),
                )
            ],
            payment_method=PaymentMethod.CASH,
        )
        task = asyncio.create_task(child_sells())
        await asyncio.sleep(0.4)
        assert not task.done(), "the second seller should be waiting on the shared row"
        await holder.commit()
        status = await asyncio.wait_for(task, timeout=20)

    # The child store is told the coat is gone, not sold one that is not there.
    assert status == 409, status

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 0
        # Exactly one sale exists, and the ledger explains the whole balance.
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Sale)
                .where(Sale.organization_id == shops.organization_id)
            )
            == 1
        )
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_many_racing_sellers_across_two_stores_sell_exactly_the_stock(
    maker: async_sessionmaker[AsyncSession],
):
    """Ten concurrent sellers, five in each store, three coats in the shared
    warehouse. Exactly three sales, and the shelf ends at zero."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=3
        )

    async def attempt(store: uuid.UUID) -> int:
        async with api(maker, shops.scope(store)) as client:
            response = await client.post(
                "/api/v1/sales",
                json=sale_body(store, shops.shared_warehouse, variant, size),
                headers=key(),
            )
            return response.status_code

    stores = [shops.primary_store] * 5 + [shops.child_store] * 5
    results = await asyncio.wait_for(
        asyncio.gather(*(attempt(store) for store in stores)), timeout=60
    )
    assert results.count(201) == 3, results
    assert results.count(409) == 7, results

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 0
        assert await find_divergences(session, organization_id=shops.organization_id) == []


# ---------------------------------------------------------------------------
# The two warehouses stay separate
# ---------------------------------------------------------------------------


async def test_the_child_warehouse_and_the_shared_warehouse_never_mix(maker):
    """Stock in the child's own warehouse is untouched by shared-warehouse
    sales, and a sale names exactly one warehouse per line."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.child_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.child_store, warehouse=shops.child_warehouse, qty=2
        )
        # The same product also sits in the shared warehouse.
        received = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shops.child_store),
                "location_id": str(shops.shared_warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 5}],
            },
            headers=key(),
        )
        assert received.status_code == 201, received.text

        sold = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.child_store, shops.child_warehouse, variant, size, qty=2),
            headers=key(),
        )
        assert sold.status_code == 201, sold.text

    async with maker() as session:
        # Two separate balances, and only the one that was named moved.
        assert await quantity_at(session, shops.child_warehouse, variant, size) == 0
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 5
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_a_shortfall_never_falls_back_to_the_other_warehouse(maker):
    """Owner decision, 2026-09-17: switching warehouses on a shortage is
    forbidden. One coat in the child warehouse, plenty in the shared one — a
    request for two from the child warehouse is refused, not topped up."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.child_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.child_store, warehouse=shops.child_warehouse, qty=1
        )
        await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shops.child_store),
                "location_id": str(shops.shared_warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 9}],
            },
            headers=key(),
        )
        response = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.child_store, shops.child_warehouse, variant, size, qty=2),
            headers=key(),
        )
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "INSUFFICIENT_STOCK"

    async with maker() as session:
        assert await quantity_at(session, shops.child_warehouse, variant, size) == 1
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 9


async def test_the_inventory_report_names_the_warehouse_and_never_sums_across_them(maker):
    """`GET /inventory` must not put the same shared coats on both stores'
    totals. Rows are keyed by place; the shared row is one row, reported to
    each store that can reach it, never doubled into a per-store figure."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=6
        )
        primary_view = await client.get(
            "/api/v1/inventory", params={"store_id": str(shops.primary_store)}
        )
    async with api(maker, shops.scope(shops.child_store)) as client:
        await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shops.child_store),
                "location_id": str(shops.child_warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 2}],
            },
            headers=key(),
        )
        child_view = await client.get(
            "/api/v1/inventory", params={"store_id": str(shops.child_store)}
        )
        narrowed = await client.get(
            "/api/v1/inventory",
            params={
                "store_id": str(shops.child_store),
                "location_id": str(shops.child_warehouse),
            },
        )

    assert primary_view.status_code == 200
    assert primary_view.json()["rows"] == [
        {
            "location_id": str(shops.shared_warehouse),
            "product_variant_id": variant,
            "size_id": size,
            "quantity": 6,
            "reserved_quantity": 0,
            "available_quantity": 6,
        }
    ]
    # The child store sees the same shared row — the same 6 coats, not another
    # 6 — plus its own warehouse, listed separately.
    by_location = {row["location_id"]: row["quantity"] for row in child_view.json()["rows"]}
    assert by_location == {
        str(shops.shared_warehouse): 6,
        str(shops.child_warehouse): 2,
    }
    assert [row["location_id"] for row in narrowed.json()["rows"]] == [str(shops.child_warehouse)]


# ---------------------------------------------------------------------------
# Returns go back where the goods came from
# ---------------------------------------------------------------------------


async def test_a_return_restocks_the_warehouse_the_goods_were_sold_from(maker):
    """Owner decision, 2026-09-17: goods go back to the warehouse the line was
    sold from. A child-store sale drawn from the shared warehouse returns to
    the shared warehouse — and the refund still belongs to the child store."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=3
        )

    async with api(maker, shops.scope(shops.child_store)) as client:
        sold = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.child_store, shops.shared_warehouse, variant, size, qty=2),
            headers=key(),
        )
        assert sold.status_code == 201, sold.text
        sale = sold.json()
        assert sale["items"][0]["source_location_id"] == str(shops.shared_warehouse)

        refunded = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": sale["items"][0]["id"],
                        "quantity": 1,
                        "restock": True,
                        "condition": "INTACT",
                    }
                ],
                "payment_method": "CASH",
            },
            headers=key(),
        )
        assert refunded.status_code == 201, refunded.text
        body = refunded.json()
        # The destination is derived from history, never requested.
        assert body["items"][0]["destination_location_id"] == str(shops.shared_warehouse)
        assert body["store_id"] == str(shops.child_store)

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2
        assert await quantity_at(session, shops.child_warehouse, variant, size) == 0
        returned = (
            await session.scalars(
                select(StockMovement).where(
                    StockMovement.movement_type == MovementType.REFUND_RETURN,
                    StockMovement.organization_id == shops.organization_id,
                )
            )
        ).one()
        assert returned.location_id == shops.shared_warehouse
        assert returned.acting_store_id == shops.child_store
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_a_return_is_refused_when_the_store_cannot_receive_at_that_warehouse(maker):
    """The child store may take goods OUT of the shared warehouse but not put
    them back. That is a row, not a rule in code — and the refusal is explicit
    rather than a silent restock somewhere else."""
    shops = await make_two_shops(maker, child_may_receive_shared=False)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=3
        )

    async with api(maker, shops.scope(shops.child_store)) as client:
        sale = (
            await client.post(
                "/api/v1/sales",
                json=sale_body(shops.child_store, shops.shared_warehouse, variant, size),
                headers=key(),
            )
        ).json()
        refused = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": sale["items"][0]["id"],
                        "quantity": 1,
                        "restock": True,
                        "condition": "INTACT",
                    }
                ],
                "payment_method": "CASH",
            },
            headers=key(),
        )
        assert refused.status_code == 403, refused.text
        assert refused.json()["code"] == "LOCATION_ACCESS_DENIED"

        # Money back without the goods is unaffected: it asks nothing of a shelf.
        written_off = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {"sale_item_id": sale["items"][0]["id"], "quantity": 1, "restock": False}
                ],
                "payment_method": "CASH",
            },
            headers=key(),
        )
        assert written_off.status_code == 201, written_off.text
        assert written_off.json()["items"][0]["destination_location_id"] is None

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2
        assert (
            await session.scalar(
                select(func.count())
                .select_from(RefundItem)
                .where(RefundItem.destination_location_id.is_(None))
            )
            >= 1
        )


async def test_one_refund_returns_each_line_to_the_warehouse_it_came_from(maker):
    """A basket drawn from two warehouses goes back to two warehouses.

    This is the whole reason `refund_item.destination_location_id` is a column
    per line rather than one field on the refund (ADR-0004 §2.4). With a single
    destination — or with "wherever this store may receive" — both coats would
    come back to the same shelf and one warehouse would quietly gain stock the
    other lost.
    """
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=2
        )
    async with api(maker, shops.scope(shops.child_store)) as client:
        received = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shops.child_store),
                "location_id": str(shops.child_warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 2}],
            },
            headers=key(),
        )
        assert received.status_code == 201, received.text

        sold = await client.post(
            "/api/v1/sales",
            json={
                "store_id": str(shops.child_store),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": variant,
                        "size_id": size,
                        "source_location_id": str(warehouse),
                        "quantity": 1,
                        "unit_price": "1500.00",
                    }
                    for warehouse in (shops.shared_warehouse, shops.child_warehouse)
                ],
                "payment_method": "CASH",
            },
            headers=key(),
        )
        assert sold.status_code == 201, sold.text
        sale = sold.json()
        sold_from = {item["id"]: item["source_location_id"] for item in sale["items"]}
        assert set(sold_from.values()) == {
            str(shops.shared_warehouse),
            str(shops.child_warehouse),
        }

        refunded = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {"sale_item_id": item_id, "quantity": 1, "restock": True, "condition": "INTACT"}
                    for item_id in sold_from
                ],
                "payment_method": "CASH",
            },
            headers=key(),
        )
        assert refunded.status_code == 201, refunded.text
        for item in refunded.json()["items"]:
            assert item["destination_location_id"] == sold_from[item["sale_item_id"]]

    async with maker() as session:
        # Both shelves are back where they started, which only holds if each
        # line went home rather than both landing on one of them.
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2
        assert await quantity_at(session, shops.child_warehouse, variant, size) == 2
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_revoking_receive_access_is_honoured_on_a_refund_replay(maker):
    """Invariant I13 on the refund path, which has its own cached answer —
    but for whoever recorded the return.

    The sale path is covered above; this is the same question asked of the
    other endpoint, and it is a different piece of code. A store that may no
    longer receive goods here takes no new return there, and nobody else is
    handed the stored success; whoever recorded it is answered what it
    recorded, which moves no goods, so the phone that kept it is not held
    for good (owner decision, 2026-10-18).
    """
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=5
        )
    async with api(maker, shops.scope(shops.child_store)) as client:
        sale = (
            await client.post(
                "/api/v1/sales",
                json=sale_body(shops.child_store, shops.shared_warehouse, variant, size, qty=2),
                headers=key(),
            )
        ).json()
        refund_body = {
            "command_id": str(uuid.uuid4()),
            "lines": [
                {
                    "sale_item_id": sale["items"][0]["id"],
                    "quantity": 1,
                    "restock": True,
                    "condition": "INTACT",
                }
            ],
            "payment_method": "CASH",
        }
        headers = key()
        first = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds", json=refund_body, headers=headers
        )
        assert first.status_code == 201, first.text

    async with maker() as session:
        await session.execute(
            text(
                "UPDATE store_location_access SET can_receive = false "
                "WHERE store_id = :s AND location_id = :loc"
            ),
            {"s": shops.child_store, "loc": shops.shared_warehouse},
        )
        await session.commit()

    async with api(maker, shops.scope(shops.child_store)) as client:
        cached = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds", json=refund_body, headers=headers
        )
        assert cached.status_code == 201, cached.text
        assert cached.json() == first.json()
        durable = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds", json=refund_body, headers=key()
        )
        assert durable.status_code == 201, durable.text
        assert durable.json() == first.json()
        fresh = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": sale["items"][0]["id"],
                        "quantity": 1,
                        "restock": True,
                        "condition": "INTACT",
                    }
                ],
                "payment_method": "CASH",
            },
            headers=key(),
        )
        assert fresh.status_code == 403, fresh.text
        assert fresh.json()["code"] == "LOCATION_ACCESS_DENIED"
        # Nothing under that command, and said so.
        assert fresh.json()["details"]["recorded"] is False

    # Anyone else at that store is refused the stored success, as before.
    someone = replace(shops.scope(shops.child_store), user_id=uuid.uuid4())
    async with api(maker, someone) as client:
        other = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds", json=refund_body, headers=key()
        )
        assert other.status_code == 403, other.text
        assert other.json()["code"] == "LOCATION_ACCESS_DENIED"
        assert "recorded" not in other.json()["details"]

    async with maker() as session:
        # The one refund that was allowed, and nothing the replay smuggled in.
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 4


# ---------------------------------------------------------------------------
# Replay identity includes the warehouse
# ---------------------------------------------------------------------------


async def test_the_same_command_against_a_different_warehouse_is_a_conflict(maker):
    """A retry that names another warehouse is a different business command.

    Without the warehouse in the permanent fingerprint the second request would
    be judged an identical retry and replayed, telling the caller "sold" about
    stock it never named — and the error would be invisible until someone
    counted the shelves.
    """
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.child_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.child_store, warehouse=shops.child_warehouse, qty=3
        )
        await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shops.child_store),
                "location_id": str(shops.shared_warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 3}],
            },
            headers=key(),
        )
        body = sale_body(shops.child_store, shops.child_warehouse, variant, size)
        first = await client.post("/api/v1/sales", json=body, headers=key())
        assert first.status_code == 201, first.text

        moved = dict(body)
        moved["lines"] = [{**body["lines"][0], "source_location_id": str(shops.shared_warehouse)}]
        # Same permanent command_id, different warehouse — a fresh cache key,
        # so this reaches the durable replay check rather than the 7-day cache.
        conflict = await client.post("/api/v1/sales", json=moved, headers=key())
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"

        # An identical retry still replays, and moves stock exactly once.
        replay = await client.post("/api/v1/sales", json=body, headers=key())
        assert replay.status_code == 201, replay.text
        assert replay.json()["id"] == first.json()["id"]

    async with maker() as session:
        assert await quantity_at(session, shops.child_warehouse, variant, size) == 2
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 3
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Sale)
                .where(Sale.organization_id == shops.organization_id)
            )
            == 1
        )


# ---------------------------------------------------------------------------
# Access is a row, and revoking it takes effect immediately
# ---------------------------------------------------------------------------


async def test_a_store_without_an_access_row_cannot_sell_from_a_warehouse(maker):
    """Invariant I23. The seller has every permission; the store has no row."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=2
        )
        # The primary store was never granted the child's warehouse.
        refused = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.child_warehouse, variant, size),
            headers=key(),
        )
        assert refused.status_code == 403, refused.text
        assert refused.json()["code"] == "LOCATION_ACCESS_DENIED"

    async with maker() as session:
        # Refused before anything was claimed or written.
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Sale)
                .where(Sale.organization_id == shops.organization_id)
            )
            == 0
        )


async def test_revoking_access_stops_the_next_sale_and_is_honoured_on_a_replay(maker):
    """Invariant I13 at the warehouse level: a cached success must not keep
    being handed back after the store's access is taken away."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=5
        )
    body = sale_body(shops.child_store, shops.shared_warehouse, variant, size)
    headers = key()
    async with api(maker, shops.scope(shops.child_store)) as client:
        first = await client.post("/api/v1/sales", json=body, headers=headers)
        assert first.status_code == 201, first.text

    async with maker() as session:
        await session.execute(
            text("DELETE FROM store_location_access WHERE store_id = :s AND location_id = :loc"),
            {"s": shops.child_store, "loc": shops.shared_warehouse},
        )
        await session.commit()

    async with api(maker, shops.scope(shops.child_store)) as client:
        cached = await client.post("/api/v1/sales", json=body, headers=headers)
        assert cached.status_code == 403, cached.text
        fresh = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.child_store, shops.shared_warehouse, variant, size),
            headers=key(),
        )
        assert fresh.status_code == 403, fresh.text

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 4


async def test_another_organization_cannot_reach_this_warehouse(maker):
    """A foreign warehouse is a 404 that discloses nothing, never a 403 that
    confirms it exists."""
    shops = await make_two_shops(maker)
    stranger = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=2
        )
        refused = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, stranger.shared_warehouse, variant, size),
            headers=key(),
        )
        assert refused.status_code == 404, refused.text
        assert refused.json()["code"] == "NOT_FOUND"
        assert str(stranger.organization_id) not in refused.text
        assert str(stranger.primary_store) not in refused.text


async def test_a_seller_without_the_permission_is_refused_even_with_store_access(maker):
    """Permission and access are independent, and both are necessary."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=2
        )

    without_sale = shops.scope(shops.child_store, SELLER - {Permission.SALE_CREATE})
    async with api(maker, without_sale) as client:
        refused = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.child_store, shops.shared_warehouse, variant, size),
            headers=key(),
        )
        assert refused.status_code == 403, refused.text
        assert refused.json()["code"] == "PERMISSION_DENIED"


async def test_an_inactive_warehouse_refuses_sales_and_receipts(maker):
    """Closing a warehouse is not the same event as closing a shop.

    The refusal is a deliberately uninformative 404, identical to the answer
    for a warehouse in another organization: one refusal, never a probe that
    tells a caller which of the two it hit.
    """
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=3
        )

    async with maker() as session:
        await session.execute(
            text("UPDATE stock_location SET is_active = false WHERE id = :i"),
            {"i": shops.shared_warehouse},
        )
        await session.commit()

    async with api(maker, shops.scope(shops.primary_store)) as client:
        sale = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size),
            headers=key(),
        )
        assert sale.status_code == 404, sale.text
        receipt = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shops.primary_store),
                "location_id": str(shops.shared_warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 1}],
            },
            headers=key(),
        )
        assert receipt.status_code == 404, receipt.text

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 3


async def test_an_inactive_warehouse_can_still_be_read(maker):
    """Stock in a closed warehouse is frozen, not hidden (ADR-0004 §1.11).

    Nothing may move through it, but someone has to be able to see what is
    standing there — otherwise closing a warehouse deletes it from every
    report and the goods are stranded with no way to count them before
    transferring them out.
    """
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=4
        )

    async with maker() as session:
        await session.execute(
            text("UPDATE stock_location SET is_active = false WHERE id = :i"),
            {"i": shops.shared_warehouse},
        )
        await session.commit()

    async with api(maker, shops.scope(shops.primary_store)) as client:
        listed = await client.get(
            "/api/v1/inventory", params={"store_id": str(shops.primary_store)}
        )
        assert listed.status_code == 200, listed.text
        by_location = {row["location_id"]: row["quantity"] for row in listed.json()["rows"]}
        assert by_location[str(shops.shared_warehouse)] == 4

        # Naming the same warehouse must give the same answer as listing it.
        # The two used to disagree: the filtered read demanded an active
        # location and 404'd on the very rows the unfiltered one had shown.
        narrowed = await client.get(
            "/api/v1/inventory",
            params={
                "store_id": str(shops.primary_store),
                "location_id": str(shops.shared_warehouse),
            },
        )
        assert narrowed.status_code == 200, narrowed.text
        assert [row["quantity"] for row in narrowed.json()["rows"]] == [4]


# ---------------------------------------------------------------------------
# "Physically present" at a shared warehouse
# ---------------------------------------------------------------------------


async def test_found_during_sale_corrects_the_named_warehouse_only(maker):
    """Owner decision, 2026-09-17: a child-store seller may confirm goods are
    physically present at a warehouse they can reach, with the narrow
    permission. The correction lands on the shelf the line names — and only
    the exact shortfall, inside the sale's own transaction (F30, I18).
    """
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=0
        )

    async with api(maker, shops.scope(shops.child_store)) as client:
        body = sale_body(shops.child_store, shops.shared_warehouse, variant, size, qty=2)
        body["found_in_store"] = [{"line_index": 0, "quantity": 2}]
        sold = await client.post("/api/v1/sales", json=body, headers=key())
        assert sold.status_code == 201, sold.text
        assert len(sold.json()["corrections"]) == 1

    async with maker() as session:
        correction = (
            await session.scalars(
                select(StockMovement).where(
                    StockMovement.movement_type == MovementType.ADJUSTMENT,
                    StockMovement.organization_id == shops.organization_id,
                )
            )
        ).one()
        assert correction.location_id == shops.shared_warehouse
        assert correction.acting_store_id == shops.child_store
        assert correction.quantity_delta == 2
        # The child's own warehouse is untouched by a correction made elsewhere.
        assert await quantity_at(session, shops.child_warehouse, variant, size) == 0
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 0
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_found_during_sale_still_needs_the_narrow_permission(maker):
    """`inventory:correct_during_sale` is not implied by reaching a warehouse.

    Access says where a store may act; it never says a seller may create stock
    there. Arbitrary adjustment stays with a manager (owner instruction:
    do not hand every seller the right to correct balances).
    """
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=0
        )

    narrow = shops.scope(shops.child_store, SELLER - {Permission.INVENTORY_CORRECT_DURING_SALE})
    async with api(maker, narrow) as client:
        body = sale_body(shops.child_store, shops.shared_warehouse, variant, size)
        body["found_in_store"] = [{"line_index": 0, "quantity": 1}]
        refused = await client.post("/api/v1/sales", json=body, headers=key())
        assert refused.status_code == 403, refused.text
        assert refused.json()["code"] == "PERMISSION_DENIED"

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 0


async def test_a_correction_needs_can_sell_only_and_can_never_leave_the_shelf_fuller(maker):
    """The one place `can_receive` is deliberately *not* required, pinned here.

    A store that may sell from a warehouse but not receive into it can still
    say "these coats are physically here" for the line it is selling — the
    owner's decision of 2026-09-17 grants that at any reachable warehouse.
    Every other way of adding stock is refused for the same store at the same
    warehouse in the same breath, so the exception is this one, and it is
    bounded: the correction is capped at the shortfall the sale consumes, so
    the shelf is never left fuller than it was found. Change either half of
    this and the rule stops being the one anybody agreed to.
    """
    shops = await make_two_shops(maker, child_may_receive_shared=False)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=0
        )

    async with api(maker, shops.scope(shops.child_store)) as client:
        body = sale_body(shops.child_store, shops.shared_warehouse, variant, size, qty=2)
        body["found_in_store"] = [{"line_index": 0, "quantity": 2}]
        sold = await client.post("/api/v1/sales", json=body, headers=key())
        assert sold.status_code == 201, sold.text

        # The same store, the same warehouse, the same direction of travel —
        # refused, because these are not bounded by a sale in front of anyone.
        received = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shops.child_store),
                "location_id": str(shops.shared_warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 2}],
            },
            headers=key(),
        )
        assert received.status_code == 403, received.text
        assert received.json()["code"] == "LOCATION_ACCESS_DENIED"

    manager = shops.scope(shops.child_store, SELLER | {Permission.INVENTORY_ADJUST})
    async with api(maker, manager) as client:
        adjusted = await client.post(
            "/api/v1/inventory/adjustments",
            json={
                "store_id": str(shops.child_store),
                "location_id": str(shops.shared_warehouse),
                "command_id": str(uuid.uuid4()),
                "product_variant_id": variant,
                "size_id": size,
                "quantity_delta": 2,
                "reason_code": "STOCKTAKE",
            },
            headers=key(),
        )
        assert adjusted.status_code == 403, adjusted.text
        assert adjusted.json()["code"] == "LOCATION_ACCESS_DENIED"

    async with maker() as session:
        # Two coats appeared and two coats left: net zero, and the ledger says
        # so in two entries rather than one silent one.
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 0
        deltas = sorted(
            (
                await session.scalars(
                    select(StockMovement.quantity_delta).where(
                        StockMovement.organization_id == shops.organization_id,
                        StockMovement.location_id == shops.shared_warehouse,
                    )
                )
            ).all()
        )
        assert deltas == [-2, 2]
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_a_shortage_at_the_shared_warehouse_takes_only_what_the_sale_named(maker):
    """«Фізично відсутній» on a shelf two shops depend on (M1-030).

    This is where the negative correction is most dangerous: the child store's
    seller is reporting on stock the primary store also sells. Bounded by the
    line, the write-off is one coat — the other store still sees the rest, and
    the shared balance is one number that both of them now agree on.
    """
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=6
        )

    reporter = shops.scope(
        shops.child_store, SELLER | {Permission.INVENTORY_REPORT_MISSING_DURING_SALE}
    )
    async with api(maker, reporter) as client:
        body = sale_body(shops.child_store, shops.shared_warehouse, variant, size, qty=3)
        body["missing_in_store"] = [{"line_index": 0, "quantity": 2}]
        sold = await client.post("/api/v1/sales", json=body, headers=key())
        assert sold.status_code == 201, sold.text
        sale = sold.json()
        # Sold what was there, charged for what was sold.
        assert sale["items"][0]["quantity"] == 2
        assert sale["total"] == "3000.00"
        assert len(sale["shortages"]) == 1
        assert sale["corrections"] == []

    async with api(maker, shops.scope(shops.primary_store)) as client:
        listed = await client.get(
            "/api/v1/inventory", params={"store_id": str(shops.primary_store)}
        )
        by_location = {row["location_id"]: row["quantity"] for row in listed.json()["rows"]}
        # 6 − 1 missing − 2 sold. Not zero: the seller counted the coats they
        # went to fetch, not the shelf.
        assert by_location[str(shops.shared_warehouse)] == 3

    async with maker() as session:
        movement = (
            await session.scalars(
                select(StockMovement).where(
                    StockMovement.organization_id == shops.organization_id,
                    StockMovement.movement_type == MovementType.ADJUSTMENT,
                )
            )
        ).one()
        assert movement.location_id == shops.shared_warehouse
        assert movement.acting_store_id == shops.child_store
        assert movement.quantity_delta == -1
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_reporting_a_shortage_needs_its_own_permission_at_the_api(maker):
    """The seller default carries `inventory:correct_during_sale` and not this.
    Reaching a warehouse never confers it either (owner instruction: sellers do
    not get arbitrary balance correction)."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=4
        )

    async with api(maker, shops.scope(shops.child_store)) as client:
        body = sale_body(shops.child_store, shops.shared_warehouse, variant, size, qty=2)
        body["missing_in_store"] = [{"line_index": 0, "quantity": 1}]
        refused = await client.post("/api/v1/sales", json=body, headers=key())
        assert refused.status_code == 403, refused.text
        assert refused.json()["code"] == "PERMISSION_DENIED"

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 4


async def test_found_and_missing_can_stand_together_on_different_shelves(maker):
    """One basket, two warehouses: a coat found on the shared shelf and one
    absent from the child's. They describe different places, so both hold —
    only contradicting statements about the *same* shelf are refused."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=0
        )

    both = shops.scope(
        shops.child_store, SELLER | {Permission.INVENTORY_REPORT_MISSING_DURING_SALE}
    )
    async with api(maker, both) as client:
        received = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shops.child_store),
                "location_id": str(shops.child_warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 3}],
            },
            headers=key(),
        )
        assert received.status_code == 201, received.text

        sold = await client.post(
            "/api/v1/sales",
            json={
                "store_id": str(shops.child_store),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": variant,
                        "size_id": size,
                        "source_location_id": str(warehouse),
                        "quantity": 2,
                        "unit_price": "1500.00",
                    }
                    for warehouse in (shops.shared_warehouse, shops.child_warehouse)
                ],
                "found_in_store": [{"line_index": 0, "quantity": 2}],
                "missing_in_store": [{"line_index": 1, "quantity": 1}],
                "payment_method": "CASH",
            },
            headers=key(),
        )
        assert sold.status_code == 201, sold.text
        sale = sold.json()
        assert len(sale["corrections"]) == 1
        assert len(sale["shortages"]) == 1
        assert [item["quantity"] for item in sale["items"]] == [2, 1]

    async with maker() as session:
        # Shared: 0 + 2 found − 2 sold. Child: 3 − 1 missing − 1 sold.
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 0
        assert await quantity_at(session, shops.child_warehouse, variant, size) == 1
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_a_sale_line_must_name_its_warehouse(maker):
    """No default, no inference. The client may prefill when a store reaches
    exactly one warehouse, but the request always carries it."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.child_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.child_store, warehouse=shops.child_warehouse, qty=2
        )
        body = sale_body(shops.child_store, shops.child_warehouse, variant, size)
        del body["lines"][0]["source_location_id"]
        response = await client.post("/api/v1/sales", json=body, headers=key())
        assert response.status_code == 422, response.text


async def test_the_sale_line_keeps_its_warehouse_after_the_location_is_renamed(maker):
    """Invariant I8: a past receipt's facts do not move when today's data does."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=2
        )
        sale = (
            await client.post(
                "/api/v1/sales",
                json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size),
                headers=key(),
            )
        ).json()

    async with maker() as session:
        await session.execute(
            text("UPDATE stock_location SET name = 'Перейменований' WHERE id = :i"),
            {"i": shops.shared_warehouse},
        )
        await session.commit()
        item = (
            await session.scalars(select(SaleItem).where(SaleItem.sale_id == uuid.UUID(sale["id"])))
        ).one()
        assert item.source_location_id == shops.shared_warehouse

    async with api(maker, shops.scope(shops.primary_store)) as client:
        reread = await client.get(f"/api/v1/sales/{sale['id']}")
        assert reread.json() == sale


async def test_the_service_refuses_a_foreign_warehouse_without_the_router(
    maker: async_sessionmaker[AsyncSession],
):
    """Defence in depth that nothing exercises is defence in depth that rots.

    The router checks warehouse access before it claims an idempotency key, so
    every HTTP path is already refused there. A caller that is not an HTTP
    request — the Telegram handler the sale module anticipates — reaches the
    command directly, and must get the same refusal.
    """
    from app.core.errors import LocationAccessDeniedError
    from app.modules.sales.service import SaleLineInput, create_sale

    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=2
        )

    async with maker() as session:
        with pytest.raises(LocationAccessDeniedError):
            await create_sale(
                session,
                scope=shops.scope(shops.primary_store),
                # The primary store was never granted the child's warehouse.
                store_id=shops.primary_store,
                command_id=uuid.uuid4(),
                currency_code="UAH",
                lines=[
                    SaleLineInput(
                        product_variant_id=uuid.UUID(variant),
                        size_id=uuid.UUID(size),
                        source_location_id=shops.child_warehouse,
                        quantity=1,
                        unit_price=__import__("decimal").Decimal("1500.00"),
                    )
                ],
                payment_method=PaymentMethod.CASH,
            )
        await session.rollback()

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2
