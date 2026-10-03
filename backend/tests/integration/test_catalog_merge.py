"""Merging a duplicate into the model that stays (owner decision, 2026-10-03;
ADR-0008 §1, §3, §5), over HTTP against real PostgreSQL.

What the owner decided (business-rules.md, "correcting the catalogue", with
the answers asked the same day):

- **The duplicate's stock moves to the model that stays**, in every warehouse
  and size, recorded in the stock history as a move by the merge. Nothing is
  added or lost.
- **The price of the model that stays is kept**; where it has none, the
  duplicate's is taken. A store's own price follows the same rule.
- **Before it, the app shows both models with their stock** and asks; a merge
  cannot be undone.
- **Not while the duplicate has anything open:** an order holding goods,
  borrowed goods, units still in «Брак», an opening list waiting. A unit
  sent back to its supplier is out of «Брак» and does not stop it (as
  amended the same day); a return cancelled later brings it back as the
  model that stays. **Not into a reach the acting store does not have:**
  another store's own warehouse, a closed one. **Nothing is merged into a
  retired model.** An order of the model that stays does not stop it.
- **Only a person with the right over every store merges:** the owner of the
  network, or a manager in every one of its stores, paused ones included.
- **Afterwards the duplicate leads to the model that stays**, in one step,
  and a family left with nothing but merged models leads to the family of
  the model that stays.

Each test names the rule it proves and asserts what a wrong implementation
would break: quantities per warehouse and size, the ledger pair naming the
correction, statuses and pointers, the record and the audit entry, and that
nothing at all changed after a refusal.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.catalog.models import (
    CatalogCorrection,
    EntityStatus,
    ProductFamily,
    ProductVariant,
    VariantPrice,
)
from app.modules.catalog.read import current_variants as catalog_current_variants
from app.modules.inventory.models import (
    Inventory,
    MovementReason,
    MovementType,
    StockLot,
    StockMovement,
)
from app.modules.inventory.service import current_variants as inventory_current_variants
from app.modules.inventory.service import find_divergences, stock_under_merged_models
from app.modules.tenancy.models import StockLocation, Store, StoreKind, StoreState
from tests.conftest import provision_location, requires_database
from tests.integration.test_shared_warehouse import TwoShops, api, key, make_two_shops
from tests.integration.test_suggested_price import owner

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
OWNER = DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]
MERGE_REASONS = (MovementReason.CATALOG_MERGE_OUT, MovementReason.CATALOG_MERGE_IN)


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Model:
    """A model as creating it answered."""

    variant: str
    sizes: dict[str, str]
    family: str
    name: str

    @property
    def id(self) -> uuid.UUID:
        return uuid.UUID(self.variant)


def suffix() -> str:
    return uuid.uuid4().hex[:8]


def every_store(shops: TwoShops, permissions: frozenset[Permission] = MANAGER) -> RequestScope:
    """A person holding the same role in each of the two stores, no more."""
    return RequestScope(
        user_id=shops.user_id,
        organization_id=shops.organization_id,
        store_permissions={shops.primary_store: permissions, shops.child_store: permissions},
    )


async def create_model(
    maker: async_sessionmaker[AsyncSession],
    shops: TwoShops,
    *,
    concept: str | None = None,
    family: str | None = None,
    color: str = "шоколад",
    sizes: tuple[str, ...] = ("M",),
    similar_confirmed: bool = False,
) -> Model:
    """A model created as a manager of the primary store creates one: by its
    concept's name, or as another colour of an existing family."""
    identity = {"product_family_id": family} if family else {"concept": concept}
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        response = await client.post(
            "/api/v1/catalog/products",
            json={
                "store_id": str(shops.primary_store),
                **identity,
                "variant": {"color": color},
                "sizes": [{"system": "ALPHA", "code": code} for code in sizes],
                "similar_confirmed": similar_confirmed,
            },
            headers=key(),
        )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["variant_created"] is True, body
    return Model(
        variant=body["product_variant_id"],
        sizes={size["code"]: size["size_id"] for size in body["sizes"]},
        family=body["product_family_id"],
        name=body["display_name"],
    )


async def receive(
    maker: async_sessionmaker[AsyncSession],
    shops: TwoShops,
    model: Model,
    *,
    warehouse: uuid.UUID,
    qty: int,
    size: str = "M",
    store: uuid.UUID | None = None,
    scope: RequestScope | None = None,
) -> httpx.Response:
    store = store or shops.primary_store
    async with api(maker, scope or shops.scope(store, MANAGER)) as client:
        return await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(store),
                "location_id": str(warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": model.variant,
                        "size_id": model.sizes[size],
                        "quantity": qty,
                    }
                ],
            },
            headers=key(),
        )


async def stocked(maker, shops: TwoShops, model: Model, **kwargs: Any) -> None:
    received = await receive(maker, shops, model, **kwargs)
    assert received.status_code == 201, received.text


async def warehouse(
    maker: async_sessionmaker[AsyncSession],
    shops: TwoShops,
    *,
    store: uuid.UUID,
    name: str,
    private: bool = False,
) -> uuid.UUID:
    """Another warehouse the store reaches; `private` makes it the store's own."""
    async with maker() as session:
        location = await provision_location(
            session,
            organization_id=shops.organization_id,
            store_id=store,
            code=f"W-{suffix()}",
            name=name,
        )
        if private:
            await session.execute(
                update(StockLocation)
                .where(StockLocation.id == location)
                .values(managing_store_id=store)
            )
        await session.commit()
    return location


async def merge(
    maker: async_sessionmaker[AsyncSession],
    scope: RequestScope,
    *,
    store: uuid.UUID,
    duplicate: Model | str,
    into: Model | str,
    command_id: str | None = None,
    idempotency_key: str | None = None,
) -> httpx.Response:
    duplicate_id = duplicate.variant if isinstance(duplicate, Model) else duplicate
    into_id = into.variant if isinstance(into, Model) else into
    async with api(maker, scope) as client:
        return await client.post(
            f"/api/v1/catalog/models/{duplicate_id}/merge",
            json={
                "store_id": str(store),
                "command_id": command_id or str(uuid.uuid4()),
                "into": into_id,
            },
            headers={"Idempotency-Key": idempotency_key or str(uuid.uuid4())},
        )


async def preview(
    maker: async_sessionmaker[AsyncSession],
    scope: RequestScope,
    *,
    store: uuid.UUID,
    duplicate: Model | str,
    into: Model | str,
) -> httpx.Response:
    duplicate_id = duplicate.variant if isinstance(duplicate, Model) else duplicate
    into_id = into.variant if isinstance(into, Model) else into
    async with api(maker, scope) as client:
        return await client.get(
            f"/api/v1/catalog/models/{duplicate_id}/merge/{into_id}",
            params={"store_id": str(store)},
        )


async def merged(maker, scope: RequestScope, **kwargs: Any) -> dict[str, Any]:
    response = await merge(maker, scope, **kwargs)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def state(maker: async_sessionmaker[AsyncSession], organization_id: uuid.UUID) -> dict:
    """Everything a merge could change in one organization."""
    async with maker() as session:
        stock = {
            (row.location_id, row.product_variant_id, row.size_id): (
                row.quantity,
                row.reserved_quantity,
            )
            for row in (
                await session.execute(
                    select(Inventory)
                    .join(StockLocation, StockLocation.id == Inventory.location_id)
                    .where(
                        StockLocation.organization_id == organization_id,
                        (Inventory.quantity != 0) | (Inventory.reserved_quantity != 0),
                    )
                )
            ).scalars()
        }
        variants = {
            row.id: (row.status, row.merged_into_id)
            for row in await session.execute(
                select(ProductVariant.id, ProductVariant.status, ProductVariant.merged_into_id)
                .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
                .where(ProductFamily.organization_id == organization_id)
            )
        }
        families = {
            row.id: (row.status, row.merged_into_id)
            for row in await session.execute(
                select(ProductFamily.id, ProductFamily.status, ProductFamily.merged_into_id).where(
                    ProductFamily.organization_id == organization_id
                )
            )
        }
        prices = {
            (row.store_id, row.product_variant_id): row.suggested_price
            for row in await session.execute(
                select(
                    VariantPrice.store_id,
                    VariantPrice.product_variant_id,
                    VariantPrice.suggested_price,
                ).where(VariantPrice.organization_id == organization_id)
            )
        }
        corrections = await session.scalar(
            select(func.count())
            .select_from(CatalogCorrection)
            .where(CatalogCorrection.organization_id == organization_id)
        )
        movements = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(StockMovement.organization_id == organization_id)
        )
        audits = await session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.organization_id == organization_id,
                AuditLog.action.like("catalog.model_%"),
            )
        )
    return {
        "stock": stock,
        "variants": variants,
        "families": families,
        "prices": prices,
        "corrections": corrections,
        "movements": movements,
        "audits": audits,
    }


async def quantities(
    maker: async_sessionmaker[AsyncSession], model: Model
) -> dict[tuple[uuid.UUID, uuid.UUID], tuple[int, int]]:
    """`(warehouse, size) -> (quantity, reserved)` of one model, where not zero."""
    async with maker() as session:
        rows = await session.execute(
            select(
                Inventory.location_id,
                Inventory.size_id,
                Inventory.quantity,
                Inventory.reserved_quantity,
            ).where(
                Inventory.product_variant_id == model.id,
                (Inventory.quantity != 0) | (Inventory.reserved_quantity != 0),
            )
        )
        return {(row[0], row[1]): (row[2], row[3]) for row in rows}


async def merge_movements(
    maker: async_sessionmaker[AsyncSession], organization_id: uuid.UUID
) -> list[StockMovement]:
    async with maker() as session:
        return list(
            await session.scalars(
                select(StockMovement)
                .where(
                    StockMovement.organization_id == organization_id,
                    StockMovement.reason_code.in_(MERGE_REASONS),
                )
                .order_by(StockMovement.location_id, StockMovement.size_id)
            )
        )


async def variant_row(maker: async_sessionmaker[AsyncSession], model: Model) -> tuple:
    async with maker() as session:
        row = (
            await session.execute(
                select(ProductVariant.status, ProductVariant.merged_into_id).where(
                    ProductVariant.id == model.id
                )
            )
        ).one()
    return row[0], row[1]


async def refused_with(
    maker: async_sessionmaker[AsyncSession],
    scope: RequestScope,
    *,
    store: uuid.UUID,
    duplicate: Model,
    into: Model,
    reasons: list[str],
) -> list[dict[str, Any]]:
    """The preview lists exactly these blockers, the merge is refused with
    exactly these, and nothing at all changed. Returns the merge's reasons."""
    organization_id = scope.organization_id
    before = await state(maker, organization_id)
    shown = await preview(maker, scope, store=store, duplicate=duplicate, into=into)
    assert shown.status_code == 200, shown.text
    assert [blocker["reason"] for blocker in shown.json()["blockers"]] == reasons, shown.text
    refused = await merge(maker, scope, store=store, duplicate=duplicate, into=into)
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "MERGE_BLOCKED", refused.text
    found: list[dict[str, Any]] = refused.json()["details"]["reasons"]
    assert [blocker["reason"] for blocker in found] == reasons, refused.text
    # The preview and the merge make the same checks.
    assert found == shown.json()["blockers"]
    assert await state(maker, organization_id) == before
    return found


async def a_pair(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, sizes: tuple[str, ...] = ("M",)
) -> tuple[Model, Model]:
    """The model that stays, and its duplicate: the same coat, the colour
    misspelt, as another colour of the same family.

    Once one pair is merged, the misspelling is a word only merged models
    use, which warns (ADR-0008 §7); the next pair confirms it, as setup."""
    stays = await create_model(maker, shops, concept=f"Лоран-{suffix()}", sizes=sizes)
    duplicate = await create_model(
        maker,
        shops,
        family=stays.family,
        color="шокалад",
        sizes=sizes,
        similar_confirmed=True,
    )
    return stays, duplicate


# ---------------------------------------------------------------------------
# 1. The merge itself
# ---------------------------------------------------------------------------


async def test_a_merge_moves_every_warehouse_and_size_to_the_model_that_stays(maker):
    """Owner, 2026-10-03: "the duplicate's stock moves to the model that
    stays, in every warehouse and size, recorded in the stock history as a
    move by the merge. Nothing is added or lost." ADR-0008 §3: one
    `CATALOG_MERGE_OUT` −n / `CATALOG_MERGE_IN` +n `ADJUSTMENT` pair per
    warehouse and size, naming the correction; the duplicate `MERGED` with
    `merged_into_id`; the record and the audit entry; lots stay with the
    duplicate as provenance."""
    shops = await make_two_shops(maker)
    podil = await warehouse(maker, shops, store=shops.primary_store, name="Склад на Подолі")
    stays, duplicate = await a_pair(maker, shops, sizes=("M", "L"))
    await stocked(maker, shops, stays, warehouse=shops.shared_warehouse, qty=4)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=3)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=2, size="L")
    await stocked(maker, shops, duplicate, warehouse=podil, qty=1)
    m, size_l = uuid.UUID(stays.sizes["M"]), uuid.UUID(stays.sizes["L"])
    # Both models name the same sizes of the organization.
    assert duplicate.sizes == stays.sizes

    async with maker() as session:
        lots_before = set(
            await session.scalars(
                select(StockLot.id).where(StockLot.product_variant_id == duplicate.id)
            )
        )
    assert len(lots_before) == 3
    before = await state(maker, shops.organization_id)

    body = await merged(
        maker, owner(shops), store=shops.primary_store, duplicate=duplicate, into=stays
    )

    correction_id = uuid.UUID(body["correction_id"])
    assert body["kind"] == "MERGE"
    assert body["status"] == "MERGED"
    assert body["product_variant_id"] == duplicate.variant
    assert body["into_variant_id"] == stays.variant
    assert body["name_before"] == duplicate.name
    assert body["name_after"] == stays.name
    moved = {
        (entry["location_id"], entry["size_id"], entry["quantity"])
        for entry in body["details"]["moved"]
    }
    assert moved == {
        (str(shops.shared_warehouse), str(m), 3),
        (str(shops.shared_warehouse), str(size_l), 2),
        (str(podil), str(m), 1),
    }
    assert body["details"]["prices"] == []
    assert body["details"]["family_merged"] is False

    # Every warehouse and size moved; nothing is left under the duplicate.
    assert await quantities(maker, duplicate) == {}
    assert await quantities(maker, stays) == {
        (shops.shared_warehouse, m): (7, 0),
        (shops.shared_warehouse, size_l): (2, 0),
        (podil, m): (1, 0),
    }

    # Nothing added or lost: per warehouse and size, the two models together
    # hold what they held.
    def totals(stock: dict) -> dict:
        summed: dict[tuple[uuid.UUID, uuid.UUID], int] = {}
        for (location, _variant, size), (quantity, _reserved) in stock.items():
            summed[(location, size)] = summed.get((location, size), 0) + quantity
        return summed

    after = await state(maker, shops.organization_id)
    assert totals(after["stock"]) == totals(before["stock"])
    # One pair per warehouse and size: six movements, no other.
    assert after["movements"] == before["movements"] + 6

    # The ledger: one OUT and one IN per warehouse and size, naming the merge.
    movements = await merge_movements(maker, shops.organization_id)
    assert sorted(
        (m_.reason_code.value, m_.product_variant_id, m_.location_id, m_.size_id, m_.quantity_delta)
        for m_ in movements
    ) == sorted(
        [
            ("CATALOG_MERGE_OUT", duplicate.id, shops.shared_warehouse, m, -3),
            ("CATALOG_MERGE_IN", stays.id, shops.shared_warehouse, m, 3),
            ("CATALOG_MERGE_OUT", duplicate.id, shops.shared_warehouse, size_l, -2),
            ("CATALOG_MERGE_IN", stays.id, shops.shared_warehouse, size_l, 2),
            ("CATALOG_MERGE_OUT", duplicate.id, podil, m, -1),
            ("CATALOG_MERGE_IN", stays.id, podil, m, 1),
        ]
    )
    for movement in movements:
        assert movement.movement_type is MovementType.ADJUSTMENT
        assert movement.reference_type == "catalog_correction"
        assert movement.reference_id == correction_id
        assert movement.acting_store_id == shops.primary_store
        assert movement.actor_user_id == shops.user_id
        assert movement.stock_lot_id is None

    async with maker() as session:
        assert await find_divergences(session, organization_id=shops.organization_id) == []
        assert await stock_under_merged_models(session, organization_id=shops.organization_id) == []

        # The duplicate leads to the model that stays; the model that stays is
        # untouched.
        assert await variant_row(maker, duplicate) == (EntityStatus.MERGED, stays.id)
        assert await variant_row(maker, stays) == (EntityStatus.ACTIVE, None)

        # The record, under its permanent command.
        correction = await session.get(CatalogCorrection, correction_id)
        assert correction is not None
        assert correction.organization_id == shops.organization_id
        assert correction.kind == "MERGE"
        assert correction.product_variant_id == duplicate.id
        assert correction.into_variant_id == stays.id
        assert correction.acting_store_id == shops.primary_store
        assert correction.created_by_user_id == shops.user_id
        assert correction.name_before == duplicate.name
        assert correction.name_after == stays.name
        assert {
            (entry["location_id"], entry["size_id"], entry["quantity"])
            for entry in correction.details["moved"]
        } == moved
        assert correction.response_snapshot == body

        # The audit entry beside it.
        [audit] = (
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.organization_id == shops.organization_id,
                    AuditLog.action == "catalog.model_merge",
                )
            )
        ).all()
        assert audit.entity_type == "product_variant"
        assert audit.entity_id == duplicate.id
        assert audit.actor_user_id == shops.user_id
        assert audit.before == {"display_name": duplicate.name}
        assert audit.after is not None
        assert audit.after["display_name"] == stays.name
        assert audit.after["catalog_correction_id"] == str(correction_id)
        assert audit.after["into_variant_id"] == stays.variant

        # Lots stay with the duplicate, as provenance.
        lots_after = set(
            await session.scalars(
                select(StockLot.id).where(StockLot.product_variant_id == duplicate.id)
            )
        )
        assert lots_after == lots_before

    # The model card says where it leads.
    async with api(maker, owner(shops)) as client:
        card = await client.get(
            f"/api/v1/catalog/models/{duplicate.variant}",
            params={"store_id": str(shops.primary_store)},
        )
    assert card.status_code == 200, card.text
    assert card.json()["status"] == "MERGED"
    assert card.json()["merged_into"] == {
        "product_variant_id": stays.variant,
        "display_name": stays.name,
    }

    # Nothing is taken in under the duplicate any more: refused as final,
    # naming the model that stays.
    late = await receive(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=1)
    assert late.status_code == 409, late.text
    assert late.json()["code"] == "MODEL_MERGED"
    assert late.json()["details"] == {
        "product_variant_id": duplicate.variant,
        "merged_into": stays.variant,
        "recorded": False,
    }


async def test_only_the_merge_writes_its_two_movements(maker):
    """ADR-0008 §3: "only the merge writes these reasons. `apply_movements`
    refuses them, as it refuses an opening balance", and the pairs are
    checked at the door: per warehouse and size one OUT and one IN, equal and
    opposite, of two models, naming one correction. A pair that would be a
    perfect merge, sent through the ordinary door, moves nothing."""
    from app.core.errors import ValidationFailedError
    from app.modules.inventory.service import (
        MovementRequest,
        apply_movements,
        validate_catalog_merges,
    )

    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=2)
    m = uuid.UUID(stays.sizes["M"])
    correction = uuid.uuid4()

    def leg(model: Model, delta: int, reason: MovementReason, **change: Any) -> MovementRequest:
        fields: dict[str, Any] = {
            "location_id": shops.shared_warehouse,
            "acting_store_id": shops.primary_store,
            "product_variant_id": model.id,
            "size_id": m,
            "quantity_delta": delta,
            "movement_type": MovementType.ADJUSTMENT,
            "reason_code": reason,
            "reference_type": "catalog_correction",
            "reference_id": correction,
        }
        return MovementRequest(**(fields | change))

    out = leg(duplicate, -2, MovementReason.CATALOG_MERGE_OUT)
    into = leg(stays, 2, MovementReason.CATALOG_MERGE_IN)
    before = await state(maker, shops.organization_id)
    async with maker() as session:
        with pytest.raises(ValidationFailedError) as refused:
            await apply_movements(
                session,
                organization_id=shops.organization_id,
                requests=[out, into],
                actor_user_id=shops.user_id,
            )
        await session.rollback()
    assert refused.value.details["reason_code"] in {"CATALOG_MERGE_OUT", "CATALOG_MERGE_IN"}
    assert await state(maker, shops.organization_id) == before

    # The door's own check: a well-formed pair passes, anything else does not.
    validate_catalog_merges([out, into])
    for basket in (
        [out],  # half a pair
        [out, leg(stays, 1, MovementReason.CATALOG_MERGE_IN)],  # not equal
        [out, leg(duplicate, 2, MovementReason.CATALOG_MERGE_IN)],  # one model
        [out, into, leg(stays, 1, MovementReason.CATALOG_MERGE_IN, size_id=uuid.uuid4())],
        [out, leg(stays, 2, MovementReason.CATALOG_MERGE_IN, reference_id=uuid.uuid4())],
        [out, leg(stays, 2, MovementReason.CATALOG_MERGE_IN, movement_type=MovementType.DELIVERY)],
        [out, leg(stays, 2, MovementReason.CATALOG_MERGE_IN, reference_type="stock_lot")],
        [
            leg(duplicate, 2, MovementReason.CATALOG_MERGE_OUT),
            leg(stays, -2, MovementReason.CATALOG_MERGE_IN),
        ],
        [out, into, leg(stays, 1, MovementReason.CORRECTION)],  # not the merge's alone
    ):
        with pytest.raises(ValidationFailedError):
            validate_catalog_merges(basket)


# ---------------------------------------------------------------------------
# 2. Prices
# ---------------------------------------------------------------------------


async def set_price(
    maker: async_sessionmaker[AsyncSession],
    shops: TwoShops,
    model: Model,
    price: str,
    *,
    store: uuid.UUID | None = None,
) -> None:
    """The owner sets the shared price (`store=None`) or one store's own."""
    async with api(maker, owner(shops)) as client:
        response = await client.post(
            "/api/v1/catalog/prices",
            json={
                "store_id": str(store or shops.primary_store),
                "product_variant_id": model.variant,
                "applies_to": "STORE" if store else "ORGANIZATION",
                "expected_price": None,
                "suggested_price": price,
            },
        )
    assert response.status_code == 200, response.text


async def prices_of(
    maker: async_sessionmaker[AsyncSession], model: Model
) -> dict[uuid.UUID | None, Decimal]:
    async with maker() as session:
        rows = await session.execute(
            select(VariantPrice.store_id, VariantPrice.suggested_price).where(
                VariantPrice.product_variant_id == model.id
            )
        )
        return dict(rows.tuples().all())


async def test_the_model_that_stays_keeps_its_prices_and_takes_the_duplicates_where_it_has_none(
    maker,
):
    """Owner, 2026-10-03: "the price of the model that stays is kept; when it
    has none, the duplicate's is taken. A store's own price follows the same
    rule." ADR-0008 §3 step 4: scope by scope, the organization's and each
    store's."""
    shops = await make_two_shops(maker)

    # The model that stays has a shared price and the primary store's own;
    # the duplicate has all three, the child store's own among them.
    stays, duplicate = await a_pair(maker, shops)
    await set_price(maker, shops, stays, "2000.00")
    await set_price(maker, shops, stays, "2100.00", store=shops.primary_store)
    await set_price(maker, shops, duplicate, "1500.00")
    await set_price(maker, shops, duplicate, "1600.00", store=shops.primary_store)
    await set_price(maker, shops, duplicate, "1700.00", store=shops.child_store)
    duplicate_prices = await prices_of(maker, duplicate)

    body = await merged(
        maker, owner(shops), store=shops.primary_store, duplicate=duplicate, into=stays
    )

    # Its own two kept; only the child store's own, which it lacked, carried.
    assert await prices_of(maker, stays) == {
        None: Decimal("2000.00"),
        shops.primary_store: Decimal("2100.00"),
        shops.child_store: Decimal("1700.00"),
    }
    assert body["details"]["prices"] == [
        {"store_id": str(shops.child_store), "suggested_price": "1700.00"}
    ]
    # The duplicate's own rows are left as they were: history, not moved.
    assert await prices_of(maker, duplicate) == duplicate_prices
    async with api(maker, owner(shops)) as client:
        seen = await client.get(
            "/api/v1/catalog/prices",
            params={"store_id": str(shops.child_store), "product_variant_id": stays.variant},
        )
    assert seen.status_code == 200, seen.text
    assert (seen.json()["shared_price"], seen.json()["store_price"]) == ("2000.00", "1700.00")

    # A model that stays with no price at all takes the duplicate's shared one.
    bare, priced = await a_pair(maker, shops)
    await set_price(maker, shops, priced, "1500.00")
    body = await merged(maker, owner(shops), store=shops.primary_store, duplicate=priced, into=bare)
    assert await prices_of(maker, bare) == {None: Decimal("1500.00")}
    assert body["details"]["prices"] == [{"store_id": None, "suggested_price": "1500.00"}]

    # A shared price of the model that stays is never overwritten, though the
    # duplicate has a store's own the model that stays lacks.
    kept, other = await a_pair(maker, shops)
    await set_price(maker, shops, kept, "2500.00")
    await set_price(maker, shops, other, "900.00")
    await set_price(maker, shops, other, "950.00", store=shops.primary_store)
    await merged(maker, owner(shops), store=shops.primary_store, duplicate=other, into=kept)
    assert await prices_of(maker, kept) == {
        None: Decimal("2500.00"),
        shops.primary_store: Decimal("950.00"),
    }


# ---------------------------------------------------------------------------
# 3. The preview
# ---------------------------------------------------------------------------


async def test_the_preview_shows_both_models_their_stock_and_nothing_blocking(maker):
    """ADR-0008 §3: the preview shows both models with their names and prices,
    the stock that would move by warehouse and size, and what blocks the
    merge; with nothing open it lists no blockers. It changes nothing."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops, sizes=("M", "L"))
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=3)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=1, size="L")
    await stocked(maker, shops, stays, warehouse=shops.shared_warehouse, qty=5)
    await set_price(maker, shops, stays, "2000.00")
    await set_price(maker, shops, duplicate, "1500.00")
    await set_price(maker, shops, duplicate, "1550.00", store=shops.primary_store)
    before = await state(maker, shops.organization_id)

    shown = await preview(
        maker, owner(shops), store=shops.primary_store, duplicate=duplicate, into=stays
    )

    assert shown.status_code == 200, shown.text
    body = shown.json()
    assert body["duplicate"] == {
        "product_variant_id": duplicate.variant,
        "display_name": duplicate.name,
        "status": "ACTIVE",
        "shared_price": "1500.00",
        "store_price": "1550.00",
    }
    assert body["into"] == {
        "product_variant_id": stays.variant,
        "display_name": stays.name,
        "status": "ACTIVE",
        "shared_price": "2000.00",
        "store_price": None,
    }
    # Only the duplicate's stock: what would move.
    assert sorted(
        (line["location_id"], line["location_name"], line["size_label"], line["quantity"])
        for line in body["stock"]
    ) == sorted(
        [
            (str(shops.shared_warehouse), "Основний склад", "M", 3),
            (str(shops.shared_warehouse), "Основний склад", "L", 1),
        ]
    )
    assert {line["size_id"] for line in body["stock"]} == set(duplicate.sizes.values())
    assert body["blockers"] == []
    assert await state(maker, shops.organization_id) == before


async def test_the_preview_hides_quantities_of_a_warehouse_the_person_may_not_read(maker):
    """ADR-0008 §3: "Quantities are shown only in warehouses the person may
    read." The child store's own warehouse is named, its quantity null, for
    the owner acting in the primary store; and it blocks the merge from
    there (owner's follow-up: a merge does not reach into another store's own
    warehouse). A manager of both stores acting in the child store reads it,
    and may merge there."""
    shops = await make_two_shops(maker)
    own = await warehouse(
        maker, shops, store=shops.child_store, name="Власний склад дочірнього", private=True
    )
    stays, duplicate = await a_pair(maker, shops)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=3)
    await stocked(
        maker,
        shops,
        duplicate,
        warehouse=own,
        qty=2,
        store=shops.child_store,
        scope=shops.scope(shops.child_store, MANAGER),
    )

    shown = await preview(
        maker, owner(shops), store=shops.primary_store, duplicate=duplicate, into=stays
    )
    assert shown.status_code == 200, shown.text
    lines = {line["location_id"]: line for line in shown.json()["stock"]}
    assert lines[str(shops.shared_warehouse)]["quantity"] == 3
    assert lines[str(own)]["quantity"] is None
    assert lines[str(own)]["location_name"] == "Власний склад дочірнього"
    assert shown.json()["blockers"] == [
        {
            "reason": "STOCK_OUT_OF_REACH",
            "locations": [{"location_id": str(own), "name": "Власний склад дочірнього"}],
        }
    ]

    both = every_store(shops)
    read_there = await preview(
        maker, both, store=shops.child_store, duplicate=duplicate, into=stays
    )
    assert read_there.status_code == 200, read_there.text
    assert {line["location_id"]: line["quantity"] for line in read_there.json()["stock"]} == {
        str(shops.shared_warehouse): 3,
        str(own): 2,
    }
    assert read_there.json()["blockers"] == []
    await merged(maker, both, store=shops.child_store, duplicate=duplicate, into=stays)
    m = uuid.UUID(stays.sizes["M"])
    assert await quantities(maker, stays) == {(shops.shared_warehouse, m): (3, 0), (own, m): (2, 0)}
    assert await quantities(maker, duplicate) == {}


# ---------------------------------------------------------------------------
# 4. What blocks a merge
# ---------------------------------------------------------------------------


async def place_order(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, model: Model, qty: int
) -> dict[str, Any]:
    """An order of `qty`, from the shared warehouse, made in the primary store."""
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        response = await client.post(
            "/api/v1/orders",
            json={
                "store_id": str(shops.primary_store),
                "command_id": str(uuid.uuid4()),
                "carrier": "NOVA_POSHTA",
                "lines": [
                    {
                        "product_variant_id": model.variant,
                        "size_id": model.sizes["M"],
                        "source_location_id": str(shops.shared_warehouse),
                        "quantity": qty,
                        "unit_price": "3000.00",
                    }
                ],
            },
        )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    assert body["status"] == "READY_TO_DISPATCH"
    return body


async def advance(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, order_id: str, action: str
) -> dict[str, Any]:
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        response = await client.post(
            f"/api/v1/orders/{order_id}/{action}", json={"command_id": str(uuid.uuid4())}
        )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_an_open_order_of_the_duplicate_blocks_the_merge_until_it_is_closed(maker):
    """Owner, 2026-10-03: not while the duplicate has "an order holding
    goods". ADR-0008 §3: an order that is not closed — `READY_TO_DISPATCH`,
    `DISPATCHED`, `ARRIVED` — blocks, though only the first still reserves
    anything. Collected, it no longer does."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=5)
    order = await place_order(maker, shops, duplicate, 2)

    for stage in ("READY_TO_DISPATCH", "DISPATCHED", "ARRIVED"):
        found = await refused_with(
            maker,
            owner(shops),
            store=shops.primary_store,
            duplicate=duplicate,
            into=stays,
            reasons=["OPEN_ORDERS"],
        )
        assert found[0]["order_ids"] == [order["id"]], stage
        if stage == "READY_TO_DISPATCH":
            assert (await advance(maker, shops, order["id"], "dispatch"))["status"] == "DISPATCHED"
        elif stage == "DISPATCHED":
            assert (await advance(maker, shops, order["id"], "arrive"))["status"] == "ARRIVED"

    assert (await advance(maker, shops, order["id"], "collect"))["status"] == "COLLECTED"
    await merged(maker, owner(shops), store=shops.primary_store, duplicate=duplicate, into=stays)
    m = uuid.UUID(stays.sizes["M"])
    assert await quantities(maker, stays) == {(shops.shared_warehouse, m): (3, 0)}
    assert await quantities(maker, duplicate) == {}


async def test_an_open_order_of_the_model_that_stays_does_not_block_and_keeps_its_hold(maker):
    """How it is carried out (2026-10-03): "an order of the model that stays
    does not stop a merge. Adding stock takes nothing from what an order
    holds." ADR-0008 §3: the IN leg is exempt from the reservation guard; the
    reservation of the model that stays is intact afterwards, and the order
    goes on."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    await stocked(maker, shops, stays, warehouse=shops.shared_warehouse, qty=4)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=3)
    order = await place_order(maker, shops, stays, 2)
    m = uuid.UUID(stays.sizes["M"])
    assert await quantities(maker, stays) == {(shops.shared_warehouse, m): (4, 2)}

    shown = await preview(
        maker, owner(shops), store=shops.primary_store, duplicate=duplicate, into=stays
    )
    assert shown.json()["blockers"] == [], shown.text
    await merged(maker, owner(shops), store=shops.primary_store, duplicate=duplicate, into=stays)

    # Same warehouse and size: three more on the shelf, the order's two still held.
    assert await quantities(maker, stays) == {(shops.shared_warehouse, m): (7, 2)}
    assert await quantities(maker, duplicate) == {}
    dispatched = await advance(maker, shops, order["id"], "dispatch")
    assert dispatched["status"] == "DISPATCHED"
    assert await quantities(maker, stays) == {(shops.shared_warehouse, m): (5, 0)}
    async with maker() as session:
        assert await find_divergences(session, organization_id=shops.organization_id) == []


@pytest.mark.parametrize("kind", ["BORROWED", "CONSIGNMENT"])
async def test_borrowed_goods_on_hand_block_the_merge_until_they_go_back(maker, kind):
    """Owner, 2026-10-03: not while the duplicate has "borrowed goods".
    ADR-0008 §3: a lot paid when sold, with units still on hand. Sent back
    to their supplier, they no longer block; the shop's own goods then move."""
    from tests.integration.test_borrowed_goods import lot_of, send_back
    from tests.integration.test_supplier_returns import supplier

    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    neighbour = (await supplier(maker, shops, "Сусідка Оксана")).json()["id"]
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        borrowed = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shops.primary_store),
                "location_id": str(shops.shared_warehouse),
                "command_id": str(uuid.uuid4()),
                "supplier_id": neighbour,
                "lines": [
                    {
                        "product_variant_id": duplicate.variant,
                        "size_id": duplicate.sizes["M"],
                        "quantity": 3,
                        "acquisition_type": kind,
                        "unit_cost": "2000.00",
                    }
                ],
            },
            headers=key(),
        )
    assert borrowed.status_code == 201, borrowed.text
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=1)
    lot = await lot_of(maker, shops)
    assert lot["product_variant_id"] == duplicate.variant

    found = await refused_with(
        maker,
        owner(shops),
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        reasons=["BORROWED_ON_HAND"],
    )
    assert found[0]["lots"] == [{"stock_lot_id": lot["stock_lot_id"], "on_hand": 3}]

    # Two back: one still on hand still blocks.
    assert (await send_back(maker, shops, lot, 2)).status_code == 201
    found = await refused_with(
        maker,
        owner(shops),
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        reasons=["BORROWED_ON_HAND"],
    )
    assert found[0]["lots"] == [{"stock_lot_id": lot["stock_lot_id"], "on_hand": 1}]

    assert (await send_back(maker, shops, lot, 1)).status_code == 201
    body = await merged(
        maker, owner(shops), store=shops.primary_store, duplicate=duplicate, into=stays
    )
    m = uuid.UUID(stays.sizes["M"])
    assert [entry["quantity"] for entry in body["details"]["moved"]] == [1]
    assert await quantities(maker, stays) == {(shops.shared_warehouse, m): (1, 0)}


def as_model(variant: str, size: str) -> Model:
    return Model(variant=variant, sizes={"M": size}, family="", name="")


async def test_a_unit_of_the_duplicate_in_the_stores_brak_blocks_the_merge(maker):
    """Owner, 2026-10-03: not while the duplicate has "units in «Брак»".
    ADR-0008 §3: a «Брак» unit not finished, here one a till return took
    damaged and left `AWAITING`."""
    from tests.integration.test_damaged_units import damaged_bin, listed

    shops, bin_, variant, size = await damaged_bin(maker)
    [unit] = await listed(maker, shops)
    assert unit["status"] == "AWAITING"
    duplicate = as_model(variant, size)
    stays = await create_model(maker, shops, concept=f"Лоран-{suffix()}")

    found = await refused_with(
        maker,
        owner(shops),
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        reasons=["DAMAGED_IN_BIN"],
    )
    assert found[0]["units"] == 1
    assert found[0]["locations"] == [{"location_id": str(bin_), "name": "Брак"}]
    assert await quantities(maker, duplicate) == {(bin_, uuid.UUID(size)): (1, 0)}


async def test_a_unit_at_its_supplier_does_not_block_and_returns_as_the_model_that_stays(
    maker,
):
    """How it is carried out (2026-10-03, as amended): "units in «Брак»" are
    those still there; a unit sent back to its supplier is out of «Брак»
    while that return stands, so it does not stop a merge. ADR-0008 §3, §5:
    if that return is cancelled after the merge, the unit comes back as the
    model that stays and is written off as it; the unit keeps its name."""
    from app.modules.damaged.models import DamagedUnit
    from tests.integration.test_damaged_units import damaged_bin, listed, step
    from tests.integration.test_supplier_returns import supplier

    shops, bin_, variant, size = await damaged_bin(maker)
    supplier_id = (await supplier(maker, shops)).json()["id"]
    [unit] = await listed(maker, shops)
    assert (await step(maker, shops, unit["id"], "take")).status_code == 200
    assert (await step(maker, shops, unit["id"], "confirm", {"note": "брак"})).status_code == 200
    gone = await step(
        maker,
        shops,
        unit["id"],
        "return-to-supplier",
        {"supplier_id": supplier_id, "note": "шов розійшовся"},
        permissions=MANAGER,
    )
    assert gone.status_code == 200, gone.text
    assert gone.json()["status"] == "SUPPLIER"
    duplicate = as_model(variant, size)
    stays = await create_model(maker, shops, concept=f"Лоран-{suffix()}")
    # Nothing of the duplicate is on any shelf, or in «Брак».
    assert await quantities(maker, duplicate) == {}

    shown = await preview(
        maker, owner(shops), store=shops.primary_store, duplicate=duplicate, into=stays
    )
    assert shown.json()["blockers"] == [], shown.text
    assert shown.json()["stock"] == []
    body = await merged(
        maker, owner(shops), store=shops.primary_store, duplicate=duplicate, into=stays
    )
    assert body["details"]["moved"] == []

    # The supplier refuses it: it comes back to «Брак», as the model that stays.
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        [document] = (
            await client.get(
                "/api/v1/supplier-returns", params={"store_id": str(shops.primary_store)}
            )
        ).json()["items"]
    back = await step(
        maker,
        shops,
        unit["id"],
        "cancel-supplier-return",
        {"supplier_return_id": document["id"], "reason": "постачальник відмовив"},
        permissions=MANAGER,
    )
    assert back.status_code == 200, back.text
    assert back.json()["status"] == "CONFIRMED"
    m = uuid.UUID(size)
    assert await quantities(maker, duplicate) == {}
    assert await quantities(maker, stays) == {(bin_, m): (1, 0)}
    async with maker() as session:
        held = await session.get(DamagedUnit, uuid.UUID(unit["id"]))
        assert held is not None
        # Frozen provenance: the unit keeps naming what was sold.
        assert held.product_variant_id == duplicate.id
        assert await stock_under_merged_models(session, organization_id=shops.organization_id) == []
        assert await find_divergences(session, organization_id=shops.organization_id) == []

    # Written off as the model that stays.
    written = await step(maker, shops, unit["id"], "write-off", {"note": "не підлягає"})
    assert written.status_code == 200, written.text
    assert await quantities(maker, stays) == {}
    assert await quantities(maker, duplicate) == {}
    async with maker() as session:
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_an_opening_list_waiting_with_a_line_of_the_duplicate_blocks_the_merge(maker):
    """Owner, 2026-10-03: not while the duplicate has "an opening list
    waiting". ADR-0008 §3: a line of a list not yet applied or rejected,
    resolved to the duplicate. Rejected, the list no longer blocks."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=2)
    fresh = await warehouse(maker, shops, store=shops.primary_store, name="Новий склад")
    boss = owner(shops)
    async with api(maker, boss) as client:
        imported = await client.post(
            "/api/v1/snapshots",
            json={
                "command_id": str(uuid.uuid4()),
                "store_id": str(shops.primary_store),
                "location_id": str(fresh),
                "lines": ["Лоран шокалад M 2 шт"],
            },
        )
        assert imported.status_code == 201, imported.text
        snapshot_id = imported.json()["snapshot_id"]
        resolved = await client.put(
            f"/api/v1/snapshots/{snapshot_id}/lines/1",
            json={
                "allocations": [
                    {
                        "product_variant_id": duplicate.variant,
                        "size_id": duplicate.sizes["M"],
                        "quantity": 2,
                    }
                ],
                "quantity_basis": "RECOUNTED",
                "note": "перерахувала Оля",
            },
        )
        assert resolved.status_code == 200, resolved.text
        assert resolved.json()["snapshot"]["status"] == "IN_REVIEW"

    found = await refused_with(
        maker,
        boss,
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        reasons=["OPENING_LIST_WAITING"],
    )
    assert found[0]["snapshot_ids"] == [snapshot_id]
    # The model that stays may be in a waiting list: nothing of it moves.
    assert (
        await preview(maker, boss, store=shops.primary_store, duplicate=stays, into=duplicate)
    ).json()["blockers"] == []

    async with api(maker, boss) as client:
        rejected = await client.post(
            f"/api/v1/snapshots/{snapshot_id}/reject", json={"reason": "не той склад"}
        )
    assert rejected.status_code == 200, rejected.text
    await merged(maker, boss, store=shops.primary_store, duplicate=duplicate, into=stays)
    assert await variant_row(maker, duplicate) == (EntityStatus.MERGED, stays.id)


async def test_stock_the_acting_store_may_not_change_blocks_the_merge(maker):
    """Owner's follow-up, 2026-10-03: "a merge does not reach into another
    store's own warehouse"; how it is carried out: "a merge moves stock as
    the store the person acts in, and only where that store may change
    stock". ADR-0008 §3: a warehouse the acting store has no access to, or a
    store's own (private) warehouse without the person's own right granted
    there, is `STOCK_OUT_OF_REACH`, each named."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=2)
    await stocked(
        maker,
        shops,
        duplicate,
        warehouse=shops.child_warehouse,
        qty=1,
        store=shops.child_store,
        scope=shops.scope(shops.child_store, MANAGER),
    )
    boss = owner(shops)

    # The primary store has no access to the child store's warehouse.
    found = await refused_with(
        maker,
        boss,
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        reasons=["STOCK_OUT_OF_REACH"],
    )
    assert found[0]["locations"] == [
        {"location_id": str(shops.child_warehouse), "name": "Склад дочірнього"}
    ]

    # The child store's own private warehouse: the owner's network-wide right
    # never extends into it.
    own = await warehouse(maker, shops, store=shops.child_store, name="Власний склад", private=True)
    await stocked(
        maker,
        shops,
        duplicate,
        warehouse=own,
        qty=4,
        store=shops.child_store,
        scope=shops.scope(shops.child_store, MANAGER),
    )
    found = await refused_with(
        maker,
        boss,
        store=shops.child_store,
        duplicate=duplicate,
        into=stays,
        reasons=["STOCK_OUT_OF_REACH"],
    )
    assert found[0]["locations"] == [{"location_id": str(own), "name": "Власний склад"}]

    # A manager of both stores, acting in the child store, reaches all three.
    body = await merged(
        maker, every_store(shops), store=shops.child_store, duplicate=duplicate, into=stays
    )
    m = uuid.UUID(stays.sizes["M"])
    assert await quantities(maker, stays) == {
        (shops.shared_warehouse, m): (2, 0),
        (shops.child_warehouse, m): (1, 0),
        (own, m): (4, 0),
    }
    assert await quantities(maker, duplicate) == {}
    for movement in await merge_movements(maker, shops.organization_id):
        assert movement.acting_store_id == shops.child_store
        assert str(movement.reference_id) == body["correction_id"]


async def test_stock_in_a_closed_warehouse_blocks_the_merge(maker):
    """ADR-0008 §3: "a closed warehouse holding the duplicate's stock:
    nothing moves there" (ADR-0004). Named as `WAREHOUSE_CLOSED`."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    podil = await warehouse(maker, shops, store=shops.primary_store, name="Склад на Подолі")
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=1)
    await stocked(maker, shops, duplicate, warehouse=podil, qty=2)
    async with maker() as session:
        await session.execute(
            update(StockLocation).where(StockLocation.id == podil).values(is_active=False)
        )
        await session.commit()

    found = await refused_with(
        maker,
        owner(shops),
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        reasons=["WAREHOUSE_CLOSED"],
    )
    assert found[0]["locations"] == [{"location_id": str(podil), "name": "Склад на Подолі"}]
    m = uuid.UUID(stays.sizes["M"])
    assert await quantities(maker, duplicate) == {
        (shops.shared_warehouse, m): (1, 0),
        (podil, m): (2, 0),
    }


async def correct(
    maker: async_sessionmaker[AsyncSession],
    scope: RequestScope,
    model: Model,
    action: str,
    *,
    store: uuid.UUID,
) -> httpx.Response:
    async with api(maker, scope) as client:
        return await client.post(
            f"/api/v1/catalog/models/{model.variant}/{action}",
            json={"store_id": str(store), "command_id": str(uuid.uuid4())},
            headers=key(),
        )


async def test_nothing_is_merged_into_a_retired_model(maker):
    """Owner's follow-up, 2026-10-03: "nothing is merged into a retired
    model. The app offers to bring it back first." ADR-0008 §3:
    `TARGET_RETIRED`; brought back, the merge goes through."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=2)
    boss = owner(shops)
    retired = await correct(maker, boss, stays, "retire", store=shops.primary_store)
    assert retired.status_code == 200, retired.text
    assert retired.json()["status"] == "RETIRED"

    shown = await preview(maker, boss, store=shops.primary_store, duplicate=duplicate, into=stays)
    assert shown.json()["into"]["status"] == "RETIRED"
    found = await refused_with(
        maker,
        boss,
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        reasons=["TARGET_RETIRED"],
    )
    assert found[0]["product_variant_id"] == stays.variant

    restored = await correct(maker, boss, stays, "restore", store=shops.primary_store)
    assert restored.status_code == 200, restored.text
    await merged(maker, boss, store=shops.primary_store, duplicate=duplicate, into=stays)
    assert await variant_row(maker, stays) == (EntityStatus.ACTIVE, None)
    assert await variant_row(maker, duplicate) == (EntityStatus.MERGED, stays.id)


async def test_a_retired_duplicate_may_still_be_merged(maker):
    """ADR-0008 §3 refuses a retired model *that stays*, and nothing else of
    retirement: the duplicate's stock still moves, as a retired model's stock
    still moves between warehouses (how it is carried out, 2026-10-03)."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=2)
    boss = owner(shops)
    assert (
        await correct(maker, boss, duplicate, "retire", store=shops.primary_store)
    ).status_code == 200
    await merged(maker, boss, store=shops.primary_store, duplicate=duplicate, into=stays)
    assert await variant_row(maker, duplicate) == (EntityStatus.MERGED, stays.id)
    assert await quantities(maker, stays) == {
        (shops.shared_warehouse, uuid.UUID(stays.sizes["M"])): (2, 0)
    }


async def test_every_blocker_standing_at_once_is_listed(maker):
    """ADR-0008 §3: refused with `MERGE_BLOCKED`, "each reason listed with
    what to finish first" — all of them, not the first found, so the person
    sees everything to finish in one answer. The preview lists the same."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    podil = await warehouse(maker, shops, store=shops.primary_store, name="Склад на Подолі")
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=3)
    await stocked(maker, shops, duplicate, warehouse=podil, qty=1)
    await stocked(
        maker,
        shops,
        duplicate,
        warehouse=shops.child_warehouse,
        qty=2,
        store=shops.child_store,
        scope=shops.scope(shops.child_store, MANAGER),
    )
    order = await place_order(maker, shops, duplicate, 1)
    boss = owner(shops)
    assert (
        await correct(maker, boss, stays, "retire", store=shops.primary_store)
    ).status_code == 200
    async with maker() as session:
        await session.execute(
            update(StockLocation).where(StockLocation.id == podil).values(is_active=False)
        )
        await session.commit()
    before = await state(maker, shops.organization_id)

    shown = await preview(maker, boss, store=shops.primary_store, duplicate=duplicate, into=stays)
    refused = await merge(maker, boss, store=shops.primary_store, duplicate=duplicate, into=stays)

    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "MERGE_BLOCKED"
    found = {blocker["reason"]: blocker for blocker in refused.json()["details"]["reasons"]}
    assert set(found) == {
        "TARGET_RETIRED",
        "OPEN_ORDERS",
        "WAREHOUSE_CLOSED",
        "STOCK_OUT_OF_REACH",
    }
    assert found["OPEN_ORDERS"]["order_ids"] == [order["id"]]
    assert found["WAREHOUSE_CLOSED"]["locations"] == [
        {"location_id": str(podil), "name": "Склад на Подолі"}
    ]
    # A closed warehouse is named once, for what it is.
    assert found["STOCK_OUT_OF_REACH"]["locations"] == [
        {"location_id": str(shops.child_warehouse), "name": "Склад дочірнього"}
    ]
    assert shown.status_code == 200, shown.text
    assert shown.json()["blockers"] == refused.json()["details"]["reasons"]
    assert await state(maker, shops.organization_id) == before


# ---------------------------------------------------------------------------
# 5. Who merges
# ---------------------------------------------------------------------------


async def test_only_a_person_with_the_right_over_every_store_merges(maker):
    """Owner's follow-up, 2026-10-03: "only a person with the right over
    every store merges: the owner of the network, or a manager in every one
    of its stores, paused ones included." ADR-0008 §1: the preview needs it
    too. A seller has none of it."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=2)
    before = await state(maker, shops.organization_id)

    for scope, store in (
        (shops.scope(shops.primary_store, SELLER), shops.primary_store),
        (shops.scope(shops.primary_store, MANAGER), shops.primary_store),
        (shops.scope(shops.child_store, OWNER), shops.child_store),
        # Every store but one: the merge right in the child store missing.
        (
            RequestScope(
                user_id=shops.user_id,
                organization_id=shops.organization_id,
                store_permissions={shops.primary_store: MANAGER, shops.child_store: SELLER},
            ),
            shops.primary_store,
        ),
    ):
        shown = await preview(maker, scope, store=store, duplicate=duplicate, into=stays)
        assert shown.status_code == 403, shown.text
        assert shown.json()["code"] == "PERMISSION_DENIED"
        assert shown.json()["details"]["permission"] == "catalog:merge"
        refused = await merge(maker, scope, store=store, duplicate=duplicate, into=stays)
        assert refused.status_code == 403, refused.text
        assert refused.json()["code"] == "PERMISSION_DENIED"
    assert await state(maker, shops.organization_id) == before

    # A manager of each of the two stores merges.
    both = every_store(shops)
    assert (
        await preview(maker, both, store=shops.primary_store, duplicate=duplicate, into=stays)
    ).status_code == 200
    command, idempotency_key = str(uuid.uuid4()), str(uuid.uuid4())
    await merged(
        maker,
        both,
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        command_id=command,
        idempotency_key=idempotency_key,
    )
    assert await variant_row(maker, duplicate) == (EntityStatus.MERGED, stays.id)

    # Their role in the child store taken away, the same request is not
    # answered with the success they were once entitled to (I12, I13).
    revoked = await merge(
        maker,
        RequestScope(
            user_id=shops.user_id,
            organization_id=shops.organization_id,
            store_permissions={shops.primary_store: MANAGER, shops.child_store: SELLER},
        ),
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        command_id=command,
        idempotency_key=idempotency_key,
    )
    assert revoked.status_code == 403, revoked.text
    assert revoked.json()["code"] == "PERMISSION_DENIED"

    # A third store, paused, where they hold nothing: not every store now.
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
    kept, other = await a_pair(maker, shops)
    await stocked(maker, shops, other, warehouse=shops.shared_warehouse, qty=1)
    before = await state(maker, shops.organization_id)
    refused = await merge(maker, both, store=shops.primary_store, duplicate=other, into=kept)
    assert refused.status_code == 403, refused.text
    assert refused.json()["code"] == "PERMISSION_DENIED"
    assert await state(maker, shops.organization_id) == before

    # The owner, organization-wide, still does.
    await merged(maker, owner(shops), store=shops.primary_store, duplicate=other, into=kept)
    assert await variant_row(maker, other) == (EntityStatus.MERGED, kept.id)


# ---------------------------------------------------------------------------
# 6. The command's identity
# ---------------------------------------------------------------------------


async def test_the_same_command_is_answered_with_what_it_did(maker):
    """ADR-0008 §1 (I20): each correction is named by a permanent
    `command_id`. The same command is answered with what it did — under the
    same idempotency key or another — with one correction and one set of
    movements; another request under the same id is `IDEMPOTENCY_CONFLICT`."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    elsewhere = await create_model(
        maker, shops, family=stays.family, color="чорний", similar_confirmed=True
    )
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=3)
    boss = owner(shops)
    command = str(uuid.uuid4())
    first_key = str(uuid.uuid4())

    first = await merged(
        maker,
        boss,
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        command_id=command,
        idempotency_key=first_key,
    )
    after_first = await state(maker, shops.organization_id)

    # The same key: the cached answer.
    again = await merged(
        maker,
        boss,
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        command_id=command,
        idempotency_key=first_key,
    )
    # Another key, the same command: the permanent answer, not a refusal for
    # the duplicate now being merged.
    retried = await merged(
        maker, boss, store=shops.primary_store, duplicate=duplicate, into=stays, command_id=command
    )
    assert again == first
    assert retried == first
    assert await state(maker, shops.organization_id) == after_first
    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(CatalogCorrection)
                .where(CatalogCorrection.product_variant_id == duplicate.id)
            )
            == 1
        )
    assert len(await merge_movements(maker, shops.organization_id)) == 2

    # The same command into another model is another request.
    for idempotency_key in (str(uuid.uuid4()), first_key):
        conflict = await merge(
            maker,
            boss,
            store=shops.primary_store,
            duplicate=duplicate,
            into=elsewhere,
            command_id=command,
            idempotency_key=idempotency_key,
        )
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    # So is another model merged under it.
    reused = await merge(
        maker, boss, store=shops.primary_store, duplicate=elsewhere, into=stays, command_id=command
    )
    assert reused.status_code == 409, reused.text
    assert reused.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert await state(maker, shops.organization_id) == after_first
    assert await variant_row(maker, elsewhere) == (EntityStatus.ACTIVE, None)


# ---------------------------------------------------------------------------
# 7. Refusals
# ---------------------------------------------------------------------------


async def test_a_model_is_not_merged_into_itself_a_merged_one_or_another_shops(maker):
    """ADR-0008 §3, "also refused": merging a model into itself, or into
    another organization's; merging a merged model, or into one
    (`MODEL_MERGED`, naming the model that stays). Each refusal changes
    nothing."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    third = await create_model(
        maker, shops, family=stays.family, color="чорний", similar_confirmed=True
    )
    await stocked(maker, shops, duplicate, warehouse=shops.shared_warehouse, qty=1)
    await stocked(maker, shops, third, warehouse=shops.shared_warehouse, qty=2)
    foreign_shops = await make_two_shops(maker)
    foreign = await create_model(maker, foreign_shops, concept=f"Лоран-{suffix()}")
    boss = owner(shops)
    before = await state(maker, shops.organization_id)

    for response in (
        await merge(maker, boss, store=shops.primary_store, duplicate=duplicate, into=duplicate),
        await preview(maker, boss, store=shops.primary_store, duplicate=duplicate, into=duplicate),
    ):
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "VALIDATION_ERROR"
    for response in (
        await merge(maker, boss, store=shops.primary_store, duplicate=duplicate, into=foreign),
        await merge(maker, boss, store=shops.primary_store, duplicate=foreign, into=stays),
        await preview(maker, boss, store=shops.primary_store, duplicate=duplicate, into=foreign),
        await merge(
            maker, boss, store=shops.primary_store, duplicate=duplicate, into=str(uuid.uuid4())
        ),
    ):
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "NOT_FOUND"
    assert await state(maker, shops.organization_id) == before
    assert await variant_row(maker, foreign) == (EntityStatus.ACTIVE, None)

    await merged(maker, boss, store=shops.primary_store, duplicate=duplicate, into=stays)
    before = await state(maker, shops.organization_id)
    expected = {
        "product_variant_id": duplicate.variant,
        "merged_into": stays.variant,
        "recorded": False,
    }
    for response in (
        # The merged model, again, into another.
        await merge(maker, boss, store=shops.primary_store, duplicate=duplicate, into=third),
        await preview(maker, boss, store=shops.primary_store, duplicate=duplicate, into=third),
        # Another model into the merged one.
        await merge(maker, boss, store=shops.primary_store, duplicate=third, into=duplicate),
        await preview(maker, boss, store=shops.primary_store, duplicate=third, into=duplicate),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "MODEL_MERGED"
        assert response.json()["details"] == expected
    assert await state(maker, shops.organization_id) == before


# ---------------------------------------------------------------------------
# 8. Chains
# ---------------------------------------------------------------------------


async def test_a_chain_of_merges_leads_in_one_step_to_the_model_that_stands(maker):
    """ADR-0008 §3 step 5: models already merged into the duplicate are
    pointed at the model that stays too, so `merged_into_id` always names a
    model that is not merged, in one step; §5: `current_variants` gives the
    model that stands now. Their emptied families follow alike."""
    shops = await make_two_shops(maker)
    tag = suffix()
    a = await create_model(maker, shops, concept=f"Лоран-a-{tag}")
    b = await create_model(maker, shops, concept=f"Лоран-b-{tag}")
    c = await create_model(maker, shops, concept=f"Лоран-c-{tag}")
    await stocked(maker, shops, a, warehouse=shops.shared_warehouse, qty=1)
    await stocked(maker, shops, b, warehouse=shops.shared_warehouse, qty=2)
    await stocked(maker, shops, c, warehouse=shops.shared_warehouse, qty=4)
    boss = owner(shops)

    await merged(maker, boss, store=shops.primary_store, duplicate=a, into=b)
    assert await variant_row(maker, a) == (EntityStatus.MERGED, b.id)
    await merged(maker, boss, store=shops.primary_store, duplicate=b, into=c)

    # One step, from either.
    assert await variant_row(maker, a) == (EntityStatus.MERGED, c.id)
    assert await variant_row(maker, b) == (EntityStatus.MERGED, c.id)
    assert await variant_row(maker, c) == (EntityStatus.ACTIVE, None)
    async with maker() as session:
        assert await catalog_current_variants(
            session, organization_id=shops.organization_id, variant_ids=[a.id, b.id, c.id]
        ) == {a.id: c.id, b.id: c.id, c.id: c.id}
        assert await inventory_current_variants(
            session, organization_id=shops.organization_id, variant_ids={a.id, b.id}
        ) == {a.id: c.id, b.id: c.id}
        await session.rollback()

        families = {
            row.id: (row.status, row.merged_into_id)
            for row in await session.execute(
                select(ProductFamily.id, ProductFamily.status, ProductFamily.merged_into_id).where(
                    ProductFamily.id.in_([uuid.UUID(m.family) for m in (a, b, c)])
                )
            )
        }
    c_family = uuid.UUID(c.family)
    assert families == {
        uuid.UUID(a.family): (EntityStatus.MERGED, c_family),
        uuid.UUID(b.family): (EntityStatus.MERGED, c_family),
        c_family: (EntityStatus.ACTIVE, None),
    }

    # All of it stands under the last model; the ledger explains it.
    m = uuid.UUID(c.sizes["M"])
    assert await quantities(maker, c) == {(shops.shared_warehouse, m): (7, 0)}
    assert await quantities(maker, a) == {}
    assert await quantities(maker, b) == {}
    async with maker() as session:
        assert await find_divergences(session, organization_id=shops.organization_id) == []
        assert await stock_under_merged_models(session, organization_id=shops.organization_id) == []

    # The card of the first names the model that stands, not the one between.
    async with api(maker, boss) as client:
        card = await client.get(
            f"/api/v1/catalog/models/{a.variant}", params={"store_id": str(shops.primary_store)}
        )
    assert card.json()["merged_into"]["product_variant_id"] == c.variant


# ---------------------------------------------------------------------------
# 9. The duplicate's family
# ---------------------------------------------------------------------------


async def families_listed(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, query: str
) -> set[str]:
    async with api(maker, shops.scope(shops.primary_store, SELLER)) as client:
        response = await client.get(
            "/api/v1/catalog/families",
            params={"store_id": str(shops.primary_store), "query": query},
        )
    assert response.status_code == 200, response.text
    return {item["family_id"] for item in response.json()["items"]}


async def test_a_family_left_with_only_merged_models_leads_to_the_family_that_stays(maker):
    """ADR-0008 §3 step 5 and §5: a family left with no model that is not
    merged is merged into the family of the model that stays, so family
    search no longer offers the corrected typo; a family that still has a
    live model is not touched."""
    shops = await make_two_shops(maker)
    tag = suffix()
    stays = await create_model(maker, shops, concept=f"Лоран-{tag}")
    # The typo, a Latin «o», confirmed as another model when it was typed.
    typo = await create_model(maker, shops, concept=f"Лoран-{tag}", similar_confirmed=True)
    # Another family with two colours, one of them a duplicate.
    other = await create_model(maker, shops, concept=f"Ларан-{tag}", color="чорний")
    sibling = await create_model(maker, shops, family=other.family, color="шоколад")
    assert len({stays.family, typo.family, other.family}) == 3
    assert await families_listed(maker, shops, tag) == {stays.family, typo.family, other.family}
    boss = owner(shops)

    emptied = await merged(maker, boss, store=shops.primary_store, duplicate=typo, into=stays)
    kept = await merged(maker, boss, store=shops.primary_store, duplicate=sibling, into=stays)

    assert emptied["details"]["family_merged"] is True
    assert kept["details"]["family_merged"] is False
    async with maker() as session:
        families = {
            row.id: (row.status, row.merged_into_id)
            for row in await session.execute(
                select(ProductFamily.id, ProductFamily.status, ProductFamily.merged_into_id).where(
                    ProductFamily.id.in_(
                        [uuid.UUID(model.family) for model in (stays, typo, other)]
                    )
                )
            )
        }
    assert families == {
        uuid.UUID(stays.family): (EntityStatus.ACTIVE, None),
        uuid.UUID(typo.family): (EntityStatus.MERGED, uuid.UUID(stays.family)),
        uuid.UUID(other.family): (EntityStatus.ACTIVE, None),
    }
    assert await families_listed(maker, shops, tag) == {stays.family, other.family}
    # The model left in the family that was not emptied is untouched.
    assert await variant_row(maker, other) == (EntityStatus.ACTIVE, None)
