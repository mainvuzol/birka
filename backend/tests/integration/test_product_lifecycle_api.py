"""The M1B vertical slice, end to end over HTTP: create a product, receive it, sell it.

This is the gate criterion itself, exercised the way a client will exercise it:
real requests through the real FastAPI application against real PostgreSQL, with
nothing pre-loaded into the catalog. Every identifier a later request uses comes
out of the response to an earlier one, so a break anywhere in the chain is a
failing test rather than a fixture that quietly papers over it.

Only two dependencies are overridden: the authenticated scope (Telegram sign-in
is proven separately in `tests/unit/test_telegram_init_data.py` and belongs to
M1A) and the session factory, so a test can hold its own engine. The authorization
decisions themselves are NOT bypassed — the scope handed in is exactly the
authority a real seller would carry, and the refusals below are the real ones.

All data here is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.core.errors import CatalogAmbiguousError
from app.main import create_app
from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.catalog.models import (
    BusinessCategory,
    CanonicalConcept,
    ProductFamily,
    ProductVariant,
    SizeSystemCode,
)
from app.modules.catalog.service import ProductDraft, SizeDraft, VariantDraft
from app.modules.catalog.service import create_product as create_product_command
from app.modules.identity.models import AppUser
from app.modules.inventory.models import Inventory, MovementReason, MovementType, StockMovement
from app.modules.inventory.service import find_divergences
from app.modules.sales.models import Sale, SaleItem
from app.modules.tenancy.models import Organization, Store, StoreKind
from tests.conftest import provision_location, requires_database

pytestmark = [pytest.mark.integration, requires_database()]

SETTINGS = Settings(app_env="local", session_secret="product-lifecycle-secret-at-least-32-bytes")

# The default SELLER matrix, read from the matrix itself rather than copied.
# The copy that used to live here had already drifted — it was missing
# `sale:refund`, which the real default grants — and a test claiming to carry
# "what a seller has" while quietly carrying less proves the wrong refusals.
# Tests that check a refusal subtract from this set rather than inventing a role.
SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]


@dataclass(frozen=True, slots=True)
class Shop:
    """One organization with one store and one seller. No catalog rows."""

    organization_id: uuid.UUID
    store_id: uuid.UUID
    user_id: uuid.UUID
    # The store's own warehouse, with explicit access granted. Nothing here is
    # inferred from the store's name or kind (owner rule, 2026-09-15).
    location_id: uuid.UUID

    def scope(self, permissions: frozenset[Permission] = SELLER) -> RequestScope:
        return RequestScope(
            user_id=self.user_id,
            organization_id=self.organization_id,
            store_permissions={self.store_id: permissions},
        )


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def make_shop(maker: async_sessionmaker[AsyncSession]) -> Shop:
    async with maker() as session:
        org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", currency_code="UAH")
        session.add(org)
        await session.flush()
        store = Store(organization_id=org.id, name="Основний", code="MAIN", kind=StoreKind.PRIMARY)
        user = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name="Оля")
        session.add_all([store, user])
        await session.flush()
        location_id = await provision_location(
            session, organization_id=org.id, store_id=store.id, name="Основний склад"
        )
        await session.commit()
        return Shop(
            organization_id=org.id,
            store_id=store.id,
            user_id=user.id,
            location_id=location_id,
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


def product_payload(shop: Shop, **overrides: Any) -> dict[str, Any]:
    """A coat as the shop would describe it: a name, a source, a few words."""
    payload: dict[str, Any] = {
        "store_id": str(shop.store_id),
        "concept": "Лоран",
        "source": "Belardi",
        "business_category": "Куртки",
        "garment_type": "Парка",
        "variant": {"color": "шоколад", "material": "замш", "length_cm": "95.0"},
        "sizes": [
            {"system": "ALPHA", "code": "M"},
            {"system": "ALPHA", "code": "L"},
        ],
    }
    payload.update(overrides)
    return payload


async def create_product(
    client: httpx.AsyncClient, payload: dict[str, Any], headers: dict[str, str] | None = None
) -> httpx.Response:
    return await client.post("/api/v1/catalog/products", json=payload, headers=headers or key())


def size_named(response: httpx.Response, code: str) -> str:
    return str(next(size["size_id"] for size in response.json()["sizes"] if size["code"] == code))


# ---------------------------------------------------------------------------
# The gate criterion
# ---------------------------------------------------------------------------


async def test_create_receive_and_sell_a_product(maker):
    """Create → receive → sell, with nothing in the catalog beforehand."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        created = await create_product(client, product_payload(shop))
        assert created.status_code == 201, created.text
        product = created.json()
        assert product["family_created"] is True
        assert product["variant_created"] is True
        # The receipt will freeze exactly this, in the shop's own words. The
        # length keeps the precision it was stored with: NUMERIC(5,1) holds
        # 95.0, and the name says 95.0 rather than rounding the shop's data
        # for looks.
        assert product["display_name"] == "Лоран Belardi шоколад замш 95.0 см"
        assert {size["code"] for size in product["sizes"]} == {"M", "L"}
        assert all(size["created"] for size in product["sizes"])
        size_m = size_named(created, "M")

        received = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shop.store_id),
                "location_id": str(shop.location_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_m,
                        "quantity": 3,
                        "unit_cost": "1000.00",
                    }
                ],
            },
            headers=key(),
        )
        assert received.status_code == 201, received.text
        assert received.json()["lines"][0]["quantity_after"] == 3

        listed = await client.get("/api/v1/inventory", params={"store_id": str(shop.store_id)})
        assert listed.status_code == 200
        # The warehouse is named, and the row is reported once per place —
        # never summed into a per-store total that would show shared coats
        # under both shops (ADR-0004).
        assert listed.json()["rows"] == [
            {
                "location_id": str(shop.location_id),
                "product_variant_id": product["product_variant_id"],
                "size_id": size_m,
                "quantity": 3,
                "reserved_quantity": 0,
                "available_quantity": 3,
            }
        ]

        sold = await client.post(
            "/api/v1/sales",
            json={
                "store_id": str(shop.store_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_m,
                        "source_location_id": str(shop.location_id),
                        "quantity": 2,
                        "unit_price": "1500.00",
                        "discount_amount": "100.00",
                    }
                ],
            },
            headers=key(),
        )
        assert sold.status_code == 201, sold.text
        sale = sold.json()
        assert sale["subtotal"] == "3000.00"
        assert sale["discount_total"] == "200.00"
        assert sale["total"] == "2800.00"
        assert sale["items"][0]["final_unit_price"] == "1400.00"
        assert sale["items"][0]["line_total"] == "2800.00"
        # The description on the receipt is the one the product was created with.
        assert sale["items"][0]["display_name"] == product["display_name"]
        assert sale["corrections"] == []

        after = await client.get("/api/v1/inventory", params={"store_id": str(shop.store_id)})
        assert after.json()["rows"][0]["quantity"] == 1

        reread = await client.get(f"/api/v1/sales/{sale['id']}")
        assert reread.status_code == 200
        assert reread.json() == sale

    async with maker() as session:
        movements = (
            await session.scalars(
                select(StockMovement)
                .where(StockMovement.location_id == shop.location_id)
                .order_by(StockMovement.created_at)
            )
        ).all()
        assert [(m.movement_type, m.quantity_delta) for m in movements] == [
            (MovementType.DELIVERY, 3),
            (MovementType.SALE, -2),
        ]
        # Invariant I3: the snapshot equals the sum of the ledger.
        assert await find_divergences(session, location_id=shop.location_id) == []


async def test_found_during_sale_corrects_exactly_the_shortfall(maker):
    """Business fact F30: the seller is never blocked when the coat is right there."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        product = (await create_product(client, product_payload(shop))).json()
        size_m = next(s["size_id"] for s in product["sizes"] if s["code"] == "M")
        await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shop.store_id),
                "location_id": str(shop.location_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_m,
                        "quantity": 1,
                    }
                ],
            },
            headers=key(),
        )

        def basket(**extra: Any) -> dict[str, Any]:
            return {
                "store_id": str(shop.store_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_m,
                        "source_location_id": str(shop.location_id),
                        "quantity": 3,
                        "unit_price": "1200.00",
                    }
                ],
                **extra,
            }

        blocked = await client.post("/api/v1/sales", json=basket(), headers=key())
        assert blocked.status_code == 409
        assert blocked.json()["code"] == "INSUFFICIENT_STOCK"

        too_much = await client.post(
            "/api/v1/sales",
            json=basket(found_in_store=[{"line_index": 0, "quantity": 3}]),
            headers=key(),
        )
        assert too_much.status_code == 422
        assert too_much.json()["code"] == "CORRECTION_EXCEEDS_SHORTFALL"

        corrected = await client.post(
            "/api/v1/sales",
            json=basket(found_in_store=[{"line_index": 0, "quantity": 2}]),
            headers=key(),
        )
        assert corrected.status_code == 201, corrected.text
        sale = corrected.json()
        assert len(sale["corrections"]) == 1

        remaining = await client.get("/api/v1/inventory", params={"store_id": str(shop.store_id)})
        assert remaining.json()["rows"] == []

    async with maker() as session:
        correction = await session.get(StockMovement, uuid.UUID(sale["corrections"][0]))
        assert correction is not None
        assert correction.movement_type is MovementType.ADJUSTMENT
        assert correction.reason_code is MovementReason.FOUND_DURING_SALE
        assert correction.quantity_delta == 2
        # The rejected attempts wrote nothing: one delivery, one correction, one sale.
        movements = (
            await session.scalars(
                select(StockMovement).where(StockMovement.location_id == shop.location_id)
            )
        ).all()
        assert sorted(m.quantity_delta for m in movements) == [-3, 1, 2]
        assert await find_divergences(session, location_id=shop.location_id) == []
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.organization_id == shop.organization_id,
                    AuditLog.action == "inventory.found_during_sale",
                )
            )
        ) == 1


# ---------------------------------------------------------------------------
# Catalog identity (ADR-0002)
# ---------------------------------------------------------------------------


async def test_the_same_words_never_silently_create_a_second_family(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        first = await create_product(client, product_payload(shop))
        again = await create_product(client, product_payload(shop))

    assert again.status_code == 409
    body = again.json()
    assert body["code"] == "CATALOG_AMBIGUOUS"
    assert body["details"]["candidate_family_ids"] == [first.json()["product_family_id"]]

    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ProductFamily)
                .where(ProductFamily.organization_id == shop.organization_id)
            )
        ) == 1


async def test_a_second_model_needs_a_human_note_and_then_stands_apart(maker):
    """Two families may share the whole signature — but only deliberately."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        first = (await create_product(client, product_payload(shop))).json()

        unexplained = await create_product(
            client, product_payload(shop, new_model=True, variant={"color": "беж"})
        )
        assert unexplained.status_code == 422

        explained = await create_product(
            client,
            product_payload(
                shop,
                new_model=True,
                distinction_note="Інший крій, та сама назва у постачальника",
                variant={"color": "беж"},
            ),
        )
        assert explained.status_code == 201, explained.text
        second = explained.json()

    assert second["product_family_id"] != first["product_family_id"]
    assert second["canonical_concept_id"] == first["canonical_concept_id"]

    async with maker() as session:
        families = (
            await session.scalars(
                select(ProductFamily).where(ProductFamily.organization_id == shop.organization_id)
            )
        ).all()
        assert len(families) == 2
        # The signature really is shared; only the independent id separates them.
        assert (
            len(
                {
                    (f.canonical_concept_id, f.source_identity_id, f.garment_type_id)
                    for f in families
                }
            )
            == 1
        )
        assert {f.distinction_note for f in families} == {
            None,
            "Інший крій, та сама назва у постачальника",
        }


async def test_another_colour_joins_the_family_it_was_told_to_join(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        first = (await create_product(client, product_payload(shop))).json()
        added = await create_product(
            client,
            {
                "store_id": str(shop.store_id),
                "product_family_id": first["product_family_id"],
                "variant": {"color": "беж", "material": "замш", "length_cm": "95.0"},
                "sizes": [{"system": "ALPHA", "code": "M"}],
            },
        )

    assert added.status_code == 201, added.text
    body = added.json()
    assert body["family_created"] is False
    assert body["variant_created"] is True
    assert body["product_family_id"] == first["product_family_id"]
    assert body["product_variant_id"] != first["product_variant_id"]
    # A size that already exists is reused rather than duplicated.
    assert body["sizes"][0]["created"] is False
    assert body["sizes"][0]["size_id"] in {s["size_id"] for s in first["sizes"]}

    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ProductVariant)
                .where(ProductVariant.product_family_id == uuid.UUID(first["product_family_id"]))
            )
        ) == 2


async def test_the_same_attributes_resolve_to_the_same_variant(maker):
    """A variant *is* its attributes, so restating them is not a new product."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        first = (await create_product(client, product_payload(shop))).json()
        repeat = await create_product(
            client,
            {
                "store_id": str(shop.store_id),
                "product_family_id": first["product_family_id"],
                # Same words, differently spaced and cased.
                "variant": {"color": "  ШОКОЛАД ", "material": "замш", "length_cm": "95.0"},
                "sizes": [{"system": "ALPHA", "code": "M"}],
            },
        )

    assert repeat.status_code == 201, repeat.text
    assert repeat.json()["variant_created"] is False
    assert repeat.json()["product_variant_id"] == first["product_variant_id"]


async def test_a_size_written_with_a_slash_stays_one_size(maker):
    """Invariant I15: "L/XL" is how this shop writes a size, not two sizes."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        created = await create_product(
            client, product_payload(shop, sizes=[{"system": "ALPHA", "code": "L/XL"}])
        )

    assert created.status_code == 201, created.text
    assert [size["code"] for size in created.json()["sizes"]] == ["L/XL"]


async def test_an_existing_concept_keeps_its_own_classification(maker):
    """A later caller's words never rewrite what a name already means.

    The command does not refuse here either. Refusing would have made the
    obvious workaround — drop the field and resend — the path of least
    resistance, and that path silently splits the product into two families.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        first = (await create_product(client, product_payload(shop))).json()
        clash = await create_product(
            client,
            product_payload(shop, business_category="Шуби", source="Ponte"),
        )

    # The concept keeps the classification it was created with, and the
    # response says so rather than echoing what the caller typed.
    assert clash.status_code == 201, clash.text
    assert clash.json()["business_category_id"] == first["business_category_id"]

    async with maker() as session:
        concept = (
            await session.scalars(
                select(CanonicalConcept).where(
                    CanonicalConcept.organization_id == shop.organization_id
                )
            )
        ).one()
        assert str(concept.business_category_id) == first["business_category_id"]
        # And "Шуби" was never created: a category is only materialized for a
        # concept that is actually being created with it.
        categories = (
            await session.scalars(
                select(BusinessCategory.name).where(
                    BusinessCategory.organization_id == shop.organization_id
                )
            )
        ).all()
        assert list(categories) == ["Куртки"]


# ---------------------------------------------------------------------------
# Retries
# ---------------------------------------------------------------------------


async def test_a_retried_create_returns_the_first_answer(maker):
    """The dangerous path: `new_model` would otherwise make a family per retry."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        await create_product(client, product_payload(shop))
        payload = product_payload(
            shop, new_model=True, distinction_note="Інша модель", variant={"color": "беж"}
        )
        headers = key()
        first = await create_product(client, payload, headers)
        retry = await create_product(client, payload, headers)

    assert first.status_code == 201, first.text
    assert retry.status_code == 201
    assert retry.json() == first.json()

    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ProductFamily)
                .where(ProductFamily.organization_id == shop.organization_id)
            )
        ) == 2


async def test_a_retried_sale_sells_once(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        product = (await create_product(client, product_payload(shop))).json()
        size_m = next(s["size_id"] for s in product["sizes"] if s["code"] == "M")
        await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shop.store_id),
                "location_id": str(shop.location_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_m,
                        "quantity": 5,
                    }
                ],
            },
            headers=key(),
        )
        sale_body = {
            "store_id": str(shop.store_id),
            "command_id": str(uuid.uuid4()),
            "lines": [
                {
                    "product_variant_id": product["product_variant_id"],
                    "size_id": size_m,
                    "source_location_id": str(shop.location_id),
                    "quantity": 2,
                    "unit_price": "1200.00",
                }
            ],
        }
        headers = key()
        first = await client.post("/api/v1/sales", json=sale_body, headers=headers)
        retry = await client.post("/api/v1/sales", json=sale_body, headers=headers)
        left = await client.get("/api/v1/inventory", params={"store_id": str(shop.store_id)})

    assert first.status_code == 201, first.text
    assert retry.json()["id"] == first.json()["id"]
    assert left.json()["rows"][0]["quantity"] == 3

    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Sale)
                .where(Sale.organization_id == shop.organization_id)
            )
        ) == 1
        # Scoped to this sale and exact: a global `>= 1` would pass even if the
        # retry had duplicated every line.
        assert (
            await session.scalar(
                select(func.count())
                .select_from(SaleItem)
                .where(SaleItem.sale_id == uuid.UUID(first.json()["id"]))
            )
        ) == 1


# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------


async def test_a_seller_without_catalog_create_is_refused(maker):
    shop = await make_shop(maker)
    scope = shop.scope(SELLER - {Permission.CATALOG_CREATE})
    async with api(maker, scope) as client:
        refused = await create_product(client, product_payload(shop))

    assert refused.status_code == 403
    assert refused.json()["code"] == "PERMISSION_DENIED"

    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ProductFamily)
                .where(ProductFamily.organization_id == shop.organization_id)
            )
        ) == 0


async def test_another_shop_can_neither_see_nor_extend_this_catalog(maker):
    ours = await make_shop(maker)
    theirs = await make_shop(maker)
    async with api(maker, ours.scope()) as client:
        product = (await create_product(client, product_payload(ours))).json()

    async with api(maker, theirs.scope()) as client:
        # Their own store, our family: the family must not even be acknowledged.
        borrowed = await create_product(
            client,
            {
                "store_id": str(theirs.store_id),
                "product_family_id": product["product_family_id"],
                "variant": {"color": "беж"},
                "sizes": [{"system": "ALPHA", "code": "M"}],
            },
        )
        # Our store, their session: refused before anything is read.
        intruded = await create_product(client, product_payload(ours))

    assert borrowed.status_code == 404
    assert borrowed.json()["code"] == "NOT_FOUND"
    assert intruded.status_code == 403
    assert intruded.json()["code"] == "FORBIDDEN_STORE"

    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ProductFamily)
                .where(ProductFamily.organization_id == theirs.organization_id)
            )
        ) == 0


async def test_stock_and_sales_stay_inside_the_organization(maker):
    """A variant that exists, in a shop that does not own it, is simply unknown."""
    ours = await make_shop(maker)
    theirs = await make_shop(maker)
    async with api(maker, ours.scope()) as client:
        product = (await create_product(client, product_payload(ours))).json()
    size_m = next(s["size_id"] for s in product["sizes"] if s["code"] == "M")

    async with api(maker, theirs.scope()) as client:
        received = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(theirs.store_id),
                "location_id": str(theirs.location_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_m,
                        "quantity": 1,
                    }
                ],
            },
            headers=key(),
        )
        # The name of the test promises sales too, so sell as well as receive.
        sold = await client.post(
            "/api/v1/sales",
            json={
                "store_id": str(theirs.store_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_m,
                        "source_location_id": str(theirs.location_id),
                        "quantity": 1,
                        "unit_price": "1200.00",
                    }
                ],
            },
            headers=key(),
        )

    assert received.status_code == 404
    assert received.json()["code"] == "NOT_FOUND"
    assert sold.status_code == 404
    assert sold.json()["code"] == "NOT_FOUND"

    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Inventory)
                .where(Inventory.location_id == theirs.store_id)
            )
        ) == 0
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Sale)
                .where(Sale.organization_id == theirs.organization_id)
            )
        ) == 0


async def test_a_product_needs_either_a_name_or_a_family(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        neither = await create_product(
            client,
            {"store_id": str(shop.store_id), "sizes": [{"system": "ALPHA", "code": "M"}]},
        )
        both = await create_product(
            client,
            {
                "store_id": str(shop.store_id),
                "concept": "Лоран",
                "product_family_id": str(uuid.uuid4()),
                "sizes": [{"system": "ALPHA", "code": "M"}],
            },
        )
        blank = await create_product(client, product_payload(shop, concept="   "))

    assert neither.status_code == 422
    assert both.status_code == 422
    assert blank.status_code == 422


async def test_an_unknown_size_system_is_refused_rather_than_guessed(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        guessed = await create_product(
            client, product_payload(shop, sizes=[{"system": "EU", "code": "46"}])
        )
        missing = await create_product(client, product_payload(shop, sizes=[{"code": "46"}]))

    assert guessed.status_code == 422
    assert missing.status_code == 422


async def test_the_same_name_from_two_sources_is_two_products(maker):
    """Invariant I14, the golden case: Лоран/Belardi is not Лоран/Ponte.

    Different sources make a different signature, so there is nothing ambiguous
    to resolve and no human decision to ask for — the shop simply gets two
    families. This is the case the whole of ADR-0002 exists to protect, and it
    has to work without ceremony or sellers will stop describing the source.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        belardi = await create_product(client, product_payload(shop, source="Belardi"))
        ponte = await create_product(client, product_payload(shop, source="Ponte"))

    assert belardi.status_code == 201, belardi.text
    assert ponte.status_code == 201, ponte.text
    assert ponte.json()["product_family_id"] != belardi.json()["product_family_id"]
    assert ponte.json()["source_identity_id"] != belardi.json()["source_identity_id"]
    # One name, one concept row: the shop calls both of them Лоран.
    assert ponte.json()["canonical_concept_id"] == belardi.json()["canonical_concept_id"]
    # And they are genuinely separate things to stock and sell.
    assert ponte.json()["product_variant_id"] != belardi.json()["product_variant_id"]


async def test_a_price_beyond_the_column_is_refused_not_a_crash(maker):
    """`NUMERIC(12,2)` overflow must be a message, never a 500.

    This guard came out of the earlier M1B review; its only regression test
    lived on a branch that never merged, so it is re-covered here.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        product = (await create_product(client, product_payload(shop))).json()
        size_m = next(s["size_id"] for s in product["sizes"] if s["code"] == "M")
        await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shop.store_id),
                "location_id": str(shop.location_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_m,
                        "quantity": 1,
                    }
                ],
            },
            headers=key(),
        )
        refused = await client.post(
            "/api/v1/sales",
            json={
                "store_id": str(shop.store_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_m,
                        "source_location_id": str(shop.location_id),
                        "quantity": 1,
                        "unit_price": "99999999999.99",
                    }
                ],
            },
            headers=key(),
        )

    assert refused.status_code == 422, refused.text
    # Schema-level refusals come back in FastAPI's own shape (`detail`), not the
    # domain shape (`code`/`message`). A client has to handle both; that is a
    # pre-existing property of every endpoint here, recorded rather than hidden.
    assert "detail" in refused.json()


async def test_a_name_that_grows_when_normalized_is_refused_not_crashed(maker):
    """`casefold()` can make a string longer: 'ß' becomes 'ss'.

    A value inside the request cap can therefore overflow the column it is
    stored in, and a driver error there is a 500 — an incident raised for what
    is really a request the person should be told to shorten.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        long_concept = await create_product(client, product_payload(shop, concept="ß" * 101))
        long_term = await create_product(client, product_payload(shop, variant={"color": "ß" * 61}))
        # The plain-ASCII boundary still behaves: 200 is accepted, 201 is not.
        at_the_limit = await create_product(client, product_payload(shop, concept="a" * 200))

    assert long_concept.status_code == 422, long_concept.text
    assert long_concept.json()["code"] == "VALIDATION_ERROR"
    assert long_term.status_code == 422, long_term.text
    assert at_the_limit.status_code == 201, at_the_limit.text


# ---------------------------------------------------------------------------
# Identity under partial information, and under concurrency
# ---------------------------------------------------------------------------


async def test_leaving_a_field_out_does_not_quietly_make_a_second_product(maker):
    """`NULL` means "not stated", never a value of its own.

    Creating "Лоран / Belardi / Парка" and then the same coat with the garment
    type simply left out must not produce two families. Every identity field
    here is optional, so this is the ordinary case, not a corner.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        first = await create_product(client, product_payload(shop))
        without_garment = await create_product(client, product_payload(shop, garment_type=None))
        without_source = await create_product(client, product_payload(shop, source=None))

    assert first.status_code == 201, first.text
    for response in (without_garment, without_source):
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "CATALOG_AMBIGUOUS"
        assert (
            first.json()["product_family_id"] in response.json()["details"]["candidate_family_ids"]
        )

    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ProductFamily)
                .where(ProductFamily.organization_id == shop.organization_id)
            )
        ) == 1


async def test_a_bare_family_is_offered_as_a_candidate_to_a_stated_request(maker):
    """The reverse order: unstated first, stated second, still one product."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        bare = await create_product(client, product_payload(shop, source=None, garment_type=None))
        stated = await create_product(client, product_payload(shop))

    assert bare.status_code == 201, bare.text
    assert stated.status_code == 409
    assert stated.json()["details"]["candidate_family_ids"] == [bare.json()["product_family_id"]]


async def test_one_name_can_carry_two_garment_types(maker):
    """ADR-0002 §4.2 puts the garment type in the *family* signature.

    Two families under one concept are allowed to differ on it — that is what
    the dimension is for. Binding it to the concept would make the second one
    unrepresentable forever, and a seller holds `catalog:create`.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        parka = await create_product(client, product_payload(shop, garment_type="Парка"))
        kosukha = await create_product(
            client, product_payload(shop, source="Ponte", garment_type="Косуха")
        )

    assert parka.status_code == 201, parka.text
    assert kosukha.status_code == 201, kosukha.text
    assert kosukha.json()["canonical_concept_id"] == parka.json()["canonical_concept_id"]
    assert kosukha.json()["garment_type_id"] != parka.json()["garment_type_id"]
    assert kosukha.json()["product_family_id"] != parka.json()["product_family_id"]


async def test_two_sellers_naming_one_product_at_once_get_one_family(maker):
    """The check and the insert are a check-then-act on a deliberately
    non-unique index, so without a lock both callers pass the check.

    The dictionary rows are created first, on purpose: while a concept or a
    source is *itself* new its own `ON CONFLICT` serializes the two requests
    and hides the race. It opens once the shop has been running a week.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        # Warm every dictionary row the racing callers need — the concept
        # "Лоран", the source "Ponte", the garment type — while leaving the
        # combination of all three without a family of its own.
        first_family = (await create_product(client, product_payload(shop))).json()
        await create_product(client, product_payload(shop, concept="Мишка", source="Ponte"))

    concept_id = uuid.UUID(first_family["canonical_concept_id"])
    draft = ProductDraft(
        concept="Лоран",
        source="Ponte",
        garment_type="Парка",
        variant=VariantDraft(color="беж"),
        sizes=(SizeDraft(system=SizeSystemCode.ALPHA, code="M"),),
    )

    async def second() -> str:
        async with maker() as session:
            try:
                result = await create_product_command(
                    session,
                    organization_id=shop.organization_id,
                    actor_user_id=shop.user_id,
                    draft=draft,
                )
            except CatalogAmbiguousError:
                return "refused"
            await session.commit()
            return str(result.product_family_id)

    # Two requests fired with `gather` are not enough — whether the second one
    # reads before the first commits is a coin flip, and a test that only
    # sometimes exercises the window is not a guard. So the first transaction
    # is held open on purpose while the second one runs into it.
    async with maker() as holder:
        await create_product_command(
            holder,
            organization_id=shop.organization_id,
            actor_user_id=shop.user_id,
            draft=draft,
        )
        racer = asyncio.create_task(second())
        # Long enough for the second caller to reach the lock and stop there.
        # Without the lock it sails past, sees an uncommitted world, and makes
        # a second family — which is the failure this test exists to catch.
        await asyncio.sleep(0.3)
        assert not racer.done(), "the second caller should be waiting, not finished"
        await holder.commit()
        outcome = await asyncio.wait_for(racer, timeout=10)

    assert outcome == "refused", outcome

    async with maker() as session:
        siblings = (
            await session.scalars(
                select(ProductFamily.id).where(
                    ProductFamily.organization_id == shop.organization_id,
                    ProductFamily.canonical_concept_id == concept_id,
                )
            )
        ).all()
        # "Лоран" ends up with exactly two families — Belardi and Ponte. The
        # race added one row, not two.
        assert len(siblings) == 2


async def test_sizes_are_inserted_in_a_total_order_whatever_was_listed(maker, engine):
    """Two requests naming the same new sizes in opposite orders must not
    deadlock: each would hold the other's speculative insert, the loser getting
    a 500 and the winner paying a second of `deadlock_timeout`.

    The guarantee is that insertion order does not depend on the caller, so
    that is what is asserted — by watching the statements the request actually
    issues. Racing two requests and hoping to observe the deadlock is not a
    guard: whether they collide is a coin flip, and a test that only sometimes
    exercises the window would pass happily with the ordering removed.
    """
    inserted: list[str] = []
    codes = {"3XL", "4XL", "5XL"}

    def record(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("INSERT INTO SIZE "):
            inserted.extend(str(value) for value in parameters if str(value) in codes)

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        shop = await make_shop(maker)
        async with api(maker, shop.scope()) as client:
            created = await create_product(
                client,
                product_payload(
                    shop,
                    sizes=[
                        {"system": "ALPHA", "code": "5XL"},
                        {"system": "ALPHA", "code": "3XL"},
                        {"system": "ALPHA", "code": "4XL"},
                    ],
                ),
            )
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)

    assert created.status_code == 201, created.text
    assert inserted == ["3XL", "4XL", "5XL"], inserted
    # The response still lists them the way the person asked for them.
    assert [size["code"] for size in created.json()["sizes"]] == ["5XL", "3XL", "4XL"]


async def test_a_replay_is_refused_once_the_grant_is_gone(maker):
    """Authorization runs before the key is claimed and before a stored answer
    is returned, so a revoked seller cannot keep replaying a success."""
    shop = await make_shop(maker)
    payload = product_payload(shop)
    headers = key()
    async with api(maker, shop.scope()) as client:
        first = await create_product(client, payload, headers)
    async with api(maker, shop.scope(SELLER - {Permission.CATALOG_CREATE})) as client:
        replay = await create_product(client, payload, headers)

    assert first.status_code == 201, first.text
    assert replay.status_code == 403
    assert replay.json()["code"] == "PERMISSION_DENIED"


@pytest.mark.parametrize("field", ["item_code", "attributes", "hood", "colour", "size_extra"])
async def test_unsupported_catalog_fields_are_rejected_without_writes(maker, field):
    shop = await make_shop(maker)
    payload = product_payload(shop)
    if field == "item_code":
        payload[field] = "1636"
    elif field == "size_extra":
        payload["sizes"][0]["alias"] = "medium"
    else:
        payload["variant"][field] = {"hood": True} if field == "attributes" else True
    async with api(maker, shop.scope()) as client:
        response = await create_product(client, payload)
        assert response.status_code == 422, response.text
        assert any(error["type"] == "extra_forbidden" for error in response.json()["detail"])
    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ProductFamily)
                .where(ProductFamily.organization_id == shop.organization_id)
            )
            == 0
        )


@pytest.mark.parametrize("note", ["", "   ", "\t\n\u00a0"])
async def test_blank_new_model_note_is_refused_by_api_and_service(maker, note):
    from app.core.errors import ValidationFailedError

    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        original = await create_product(client, product_payload(shop))
        assert original.status_code == 201
        response = await create_product(
            client, product_payload(shop, new_model=True, distinction_note=note)
        )
        assert response.status_code == 422, response.text
    async with maker() as session:
        with pytest.raises(ValidationFailedError):
            await create_product_command(
                session,
                organization_id=shop.organization_id,
                actor_user_id=shop.user_id,
                draft=ProductDraft(
                    concept="Лоран",
                    new_model=True,
                    distinction_note=note,
                    sizes=(SizeDraft(system=SizeSystemCode.ALPHA, code="M"),),
                ),
            )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ProductFamily)
                .where(ProductFamily.organization_id == shop.organization_id)
            )
            == 1
        )


@pytest.mark.parametrize("via_http", [True, False])
async def test_new_model_note_is_trimmed_and_persisted(maker, via_http):
    shop = await make_shop(maker)
    note = "  Інша підкладка\n"
    if via_http:
        async with api(maker, shop.scope()) as client:
            response = await create_product(
                client, product_payload(shop, new_model=True, distinction_note=note)
            )
            assert response.status_code == 201, response.text
            family_id = uuid.UUID(response.json()["product_family_id"])
    else:
        async with maker() as session:
            result = await create_product_command(
                session,
                organization_id=shop.organization_id,
                actor_user_id=shop.user_id,
                draft=ProductDraft(
                    concept="Лоран",
                    new_model=True,
                    distinction_note=note,
                    sizes=(SizeDraft(system=SizeSystemCode.ALPHA, code="M"),),
                ),
            )
            family_id = result.product_family_id
            await session.commit()
    async with maker() as session:
        family = await session.get(ProductFamily, family_id)
        assert family.distinction_note == "Інша підкладка"
        audit = await session.scalar(
            select(AuditLog).where(
                AuditLog.organization_id == shop.organization_id,
                AuditLog.action == "catalog.product_created",
            )
        )
        assert audit.reason == "Інша підкладка"
