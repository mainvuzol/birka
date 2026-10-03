"""Renaming one model, and the similar-name warning (owner decision,
2026-10-03, "correcting the catalogue"; ADR-0008 §2, §4, §7), over HTTP
against real PostgreSQL.

The owner's rules proven here:

- **A rename corrects one model**, the one opened, not every model that
  shares the word. Everything in its name may be corrected. If the corrected
  model is one that already exists, the app offers to merge them.
- **Old receipts keep the name they were sold under** (I8).
- **The owner and managers correct the catalogue** (`catalog:merge`); a
  seller creates models but does not correct them.
- **A similar name at creation** (Latin letters in place of Cyrillic, case,
  extra spaces) shows the similar model; confirmed, it is still created.
- **The words of a renamed or merged model stay**: typing a word now used
  only by merged models warns and offers the model that stays.
- How it is carried out: a rename that moves a model to another family finds
  it as creating a model does; a family that could be the same is never
  chosen silently.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.catalog.models import (
    AttributeTerm,
    BusinessCategory,
    CanonicalConcept,
    CatalogCorrection,
    CatalogKnowledgeRevision,
    EntityStatus,
    GarmentType,
    ProductFamily,
    ProductVariant,
)
from app.modules.catalog.service import normalize_label
from app.modules.catalog.similar import _FOLD_SQL, fold
from app.modules.inventory.models import StockLot, StockMovement
from app.modules.sales.models import SaleItem
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import (
    TwoShops,
    api,
    key,
    make_two_shops,
    quantity_at,
    sale_body,
)
from tests.integration.test_suggested_price import owner

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]


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


def manager(shops: TwoShops, store: uuid.UUID | None = None) -> RequestScope:
    """A manager of one store: `catalog:merge` there, nowhere else."""
    return shops.scope(store or shops.primary_store, MANAGER)


def product_body(
    shops: TwoShops,
    *,
    concept: str | None = None,
    family: str | uuid.UUID | None = None,
    sizes: tuple[str, ...] = ("M",),
    store: uuid.UUID | None = None,
    **words: Any,
) -> dict[str, Any]:
    """A `POST /catalog/products` body. Variant words go in `words`; anything
    else in `words` that is not a variant word goes on the body itself."""
    variant_keys = {"color", "material", "texture", "fur", "collar", "length_cm"}
    body: dict[str, Any] = {
        "store_id": str(store or shops.primary_store),
        "variant": {k: v for k, v in words.items() if k in variant_keys},
        "sizes": [{"system": "ALPHA", "code": code} for code in sizes],
        **{k: v for k, v in words.items() if k not in variant_keys},
    }
    if concept is not None:
        body["concept"] = concept
    if family is not None:
        body["product_family_id"] = str(family)
    return body


async def create(
    maker: async_sessionmaker[AsyncSession],
    scope: RequestScope,
    shops: TwoShops,
    **body: Any,
) -> httpx.Response:
    async with api(maker, scope) as client:
        return await client.post(
            "/api/v1/catalog/products", json=product_body(shops, **body), headers=key()
        )


async def model(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, **body: Any
) -> dict[str, Any]:
    """Create a model as a seller does, and return what the catalogue answered."""
    response = await create(maker, shops.scope(shops.primary_store), shops, **body)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def receive(
    maker: async_sessionmaker[AsyncSession],
    shops: TwoShops,
    *,
    store: uuid.UUID,
    warehouse: uuid.UUID,
    variant: str,
    size: str,
    qty: int,
) -> None:
    async with api(maker, shops.scope(store)) as client:
        received = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(store),
                "location_id": str(warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": qty}],
            },
            headers=key(),
        )
    assert received.status_code == 201, received.text


def rename_body(
    shops: TwoShops,
    *,
    concept: str,
    command_id: uuid.UUID | None = None,
    store: uuid.UUID | None = None,
    source: str | None = None,
    variant: dict[str, Any] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "store_id": str(store or shops.primary_store),
        "command_id": str(command_id or uuid.uuid4()),
        "concept": concept,
        "source": source,
        "variant": variant or {},
        **extra,
    }


async def rename(
    maker: async_sessionmaker[AsyncSession],
    scope: RequestScope,
    variant_id: str,
    body: dict[str, Any],
    *,
    idempotency_key: str | None = None,
) -> httpx.Response:
    async with api(maker, scope) as client:
        return await client.post(
            f"/api/v1/catalog/models/{variant_id}/rename",
            json=body,
            headers={"Idempotency-Key": idempotency_key or str(uuid.uuid4())},
        )


async def merge(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, duplicate: str, into: str
) -> dict[str, Any]:
    """The owner merges a duplicate into the model that stays."""
    async with api(maker, owner(shops)) as client:
        response = await client.post(
            f"/api/v1/catalog/models/{duplicate}/merge",
            json={
                "store_id": str(shops.primary_store),
                "command_id": str(uuid.uuid4()),
                "into": into,
            },
            headers=key(),
        )
    assert response.status_code == 200, response.text
    merged: dict[str, Any] = response.json()
    return merged


async def card(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, variant_id: str
) -> dict[str, Any]:
    async with api(maker, manager(shops)) as client:
        response = await client.get(
            f"/api/v1/catalog/models/{variant_id}",
            params={"store_id": str(shops.primary_store)},
        )
    assert response.status_code == 200, response.text
    found: dict[str, Any] = response.json()
    return found


async def receivable(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, query: str
) -> list[dict[str, Any]]:
    async with api(maker, shops.scope(shops.primary_store)) as client:
        response = await client.get(
            "/api/v1/catalog/receivable-variants",
            params={"store_id": str(shops.primary_store), "query": query},
        )
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


async def corrections(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops
) -> list[CatalogCorrection]:
    async with maker() as session:
        return list(
            (
                await session.scalars(
                    select(CatalogCorrection)
                    .where(CatalogCorrection.organization_id == shops.organization_id)
                    .order_by(CatalogCorrection.created_at)
                )
            ).all()
        )


async def audits(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, action: str
) -> list[AuditLog]:
    async with maker() as session:
        return list(
            (
                await session.scalars(
                    select(AuditLog).where(
                        AuditLog.organization_id == shops.organization_id,
                        AuditLog.action == action,
                    )
                )
            ).all()
        )


async def revision(maker: async_sessionmaker[AsyncSession], shops: TwoShops) -> int:
    """The catalogue's knowledge revision: open match proposals were computed
    on it, and every correction changes it (ADR-0008, Consequences)."""
    async with maker() as session:
        value = await session.scalar(
            select(CatalogKnowledgeRevision.revision).where(
                CatalogKnowledgeRevision.organization_id == shops.organization_id
            )
        )
    assert value is not None
    return value


async def variant_row(maker: async_sessionmaker[AsyncSession], variant_id: str) -> ProductVariant:
    async with maker() as session:
        row = await session.get(ProductVariant, uuid.UUID(variant_id))
    assert row is not None
    return row


async def family_row(
    maker: async_sessionmaker[AsyncSession], family_id: str | uuid.UUID
) -> ProductFamily:
    async with maker() as session:
        row = await session.get(ProductFamily, uuid.UUID(str(family_id)))
    assert row is not None
    return row


async def catalogue_counts(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops
) -> dict[str, int]:
    """How many of each catalogue row the organization has: a refusal leaves
    every one of them as it was."""
    org = shops.organization_id
    async with maker() as session:
        return {
            "concepts": await session.scalar(
                select(func.count())
                .select_from(CanonicalConcept)
                .where(CanonicalConcept.organization_id == org)
            )
            or 0,
            "families": await session.scalar(
                select(func.count())
                .select_from(ProductFamily)
                .where(ProductFamily.organization_id == org)
            )
            or 0,
            "variants": await session.scalar(
                select(func.count())
                .select_from(ProductVariant)
                .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
                .where(ProductFamily.organization_id == org)
            )
            or 0,
            "terms": await session.scalar(
                select(func.count())
                .select_from(AttributeTerm)
                .where(AttributeTerm.organization_id == org)
            )
            or 0,
        }


# ---------------------------------------------------------------------------
# 1. A rename corrects one model and keeps everything it holds
# ---------------------------------------------------------------------------


async def test_a_rename_corrects_one_model_and_keeps_its_stock_price_lots_and_old_receipts(
    maker,
):
    """Owner rule "A rename corrects one model, the one opened: not every model
    that shares the word"; "Old receipts keep the name they were sold under"
    (I8); ADR-0008 §2 "the model's own row changes and keeps its id, so its
    stock, prices, lots, reservations and history stay with it"."""
    shops = await make_two_shops(maker)
    typo = await model(maker, shops, concept="Лоран", color="шокалад", material="замш")
    other = await model(maker, shops, concept="Мілан", color="шокалад")
    variant, size = typo["product_variant_id"], typo["sizes"][0]["size_id"]
    assert typo["display_name"] == "Лоран шокалад замш"

    await receive(
        maker,
        shops,
        store=shops.primary_store,
        warehouse=shops.shared_warehouse,
        variant=variant,
        size=size,
        qty=3,
    )
    await receive(
        maker,
        shops,
        store=shops.child_store,
        warehouse=shops.child_warehouse,
        variant=variant,
        size=size,
        qty=2,
    )
    async with api(maker, manager(shops)) as client:
        priced = await client.post(
            "/api/v1/catalog/prices",
            json={
                "store_id": str(shops.primary_store),
                "product_variant_id": variant,
                "applies_to": "STORE",
                "expected_price": None,
                "suggested_price": "1850.00",
            },
        )
    assert priced.status_code == 200, priced.text
    async with api(maker, owner(shops)) as client:
        shared = await client.post(
            "/api/v1/catalog/prices",
            json={
                "store_id": str(shops.primary_store),
                "product_variant_id": variant,
                "applies_to": "ORGANIZATION",
                "expected_price": None,
                "suggested_price": "2000.00",
            },
        )
    assert shared.status_code == 200, shared.text
    async with api(maker, shops.scope(shops.primary_store)) as client:
        sold = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size),
            headers=key(),
        )
    assert sold.status_code == 201, sold.text

    async with maker() as session:
        movements_before = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(StockMovement.product_variant_id == uuid.UUID(variant))
        )
        lots_before = sorted(
            (lot.id, lot.location_id)
            for lot in (
                await session.scalars(
                    select(StockLot).where(StockLot.product_variant_id == uuid.UUID(variant))
                )
            ).all()
        )
    assert len(lots_before) == 2
    revision_before = await revision(maker, shops)

    command_id = uuid.uuid4()
    renamed = await rename(
        maker,
        manager(shops),
        variant,
        rename_body(
            shops,
            command_id=command_id,
            concept="Лоран",
            variant={"color": "шоколад", "material": "нубук", "length_cm": "90"},
        ),
    )

    assert renamed.status_code == 200, renamed.text
    body = renamed.json()
    assert body["correction_id"] is not None
    assert body["kind"] == "RENAME"
    assert body["product_variant_id"] == variant
    assert body["into_variant_id"] is None
    assert body["name_before"] == "Лоран шокалад замш"
    assert body["name_after"] == "Лоран шоколад нубук 90.0 см"
    assert body["status"] == "ACTIVE"
    assert body["details"]["family_created"] is False
    assert body["details"]["family_merged"] is False
    assert body["details"]["before"]["product_family_id"] == typo["product_family_id"]
    assert body["details"]["after"]["product_family_id"] == typo["product_family_id"]
    assert body["details"]["after"]["length_cm"] == "90"
    # Open match proposals were computed on the old name.
    assert await revision(maker, shops) > revision_before

    # The same id, the same family; the name is new everywhere it is shown.
    seen = await card(maker, shops, variant)
    assert seen["product_variant_id"] == variant
    assert seen["product_family_id"] == typo["product_family_id"]
    assert (seen["color"], seen["material"], seen["length_cm"]) == ("шоколад", "нубук", 90.0)
    assert seen["display_name"] == "Лоран шоколад нубук 90.0 см"
    assert [item["product_variant_id"] for item in await receivable(maker, shops, "шоколад")] == [
        variant
    ]
    # The old spelling now finds only the model that still carries it.
    assert [
        (item["product_variant_id"], item["display_name"])
        for item in await receivable(maker, shops, "шокалад")
    ] == [(other["product_variant_id"], "Мілан шокалад")]
    assert (await card(maker, shops, other["product_variant_id"]))["color"] == "шокалад"
    async with api(maker, manager(shops)) as client:
        to_correct = await client.get(
            "/api/v1/catalog/models",
            params={"store_id": str(shops.primary_store), "query": "лоран"},
        )
    assert to_correct.status_code == 200, to_correct.text
    assert to_correct.json()["items"] == [
        {
            "product_variant_id": variant,
            "display_name": "Лоран шоколад нубук 90.0 см",
            "status": "ACTIVE",
        }
    ]

    async with api(maker, shops.scope(shops.primary_store)) as client:
        options = await client.get(
            "/api/v1/catalog/stock-options",
            params={
                "store_id": str(shops.primary_store),
                "location_id": str(shops.shared_warehouse),
            },
        )
        prices = await client.get(
            "/api/v1/catalog/prices",
            params={"store_id": str(shops.primary_store), "product_variant_id": variant},
        )
    assert options.status_code == 200, options.text
    assert [
        (item["product_variant_id"], item["display_name"], item["quantity"])
        for item in options.json()["items"]
    ] == [(variant, "Лоран шоколад нубук 90.0 см", 2)]
    assert prices.status_code == 200, prices.text
    assert (prices.json()["shared_price"], prices.json()["store_price"]) == ("2000.00", "1850.00")

    async with maker() as session:
        # Stock stays under the same id, in both warehouses; nothing moved.
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2
        assert await quantity_at(session, shops.child_warehouse, variant, size) == 2
        assert (
            await session.scalar(
                select(func.count())
                .select_from(StockMovement)
                .where(StockMovement.product_variant_id == uuid.UUID(variant))
            )
            == movements_before
        )
        assert (
            sorted(
                (lot.id, lot.location_id)
                for lot in (
                    await session.scalars(
                        select(StockLot).where(StockLot.product_variant_id == uuid.UUID(variant))
                    )
                ).all()
            )
            == lots_before
        )
        # The receipt keeps the name it was sold under (I8).
        line = await session.scalar(
            select(SaleItem).where(SaleItem.product_variant_id == uuid.UUID(variant))
        )
        assert line is not None
        assert line.display_name_snapshot == "Лоран шокалад замш"
        assert line.variant_snapshot["colour"] == "шокалад"

    [correction] = await corrections(maker, shops)
    assert str(correction.id) == body["correction_id"]
    assert correction.kind == "RENAME"
    assert str(correction.product_variant_id) == variant
    assert correction.into_variant_id is None
    assert correction.acting_store_id == shops.primary_store
    assert correction.created_by_user_id == shops.user_id
    assert correction.command_id == command_id
    assert (correction.name_before, correction.name_after) == (
        "Лоран шокалад замш",
        "Лоран шоколад нубук 90.0 см",
    )
    [entry] = await audits(maker, shops, "catalog.model_rename")
    assert entry.entity_type == "product_variant"
    assert str(entry.entity_id) == variant
    assert entry.actor_user_id == shops.user_id
    assert entry.before == {"display_name": "Лоран шокалад замш"}
    assert entry.after["display_name"] == "Лоран шоколад нубук 90.0 см"
    assert entry.after["catalog_correction_id"] == body["correction_id"]


# ---------------------------------------------------------------------------
# 2–4. Another model's name, a merged model's name, a merged model
# ---------------------------------------------------------------------------


async def test_a_rename_to_another_live_models_name_is_refused_same_as_and_changes_nothing(maker):
    """ADR-0008 §2: "If the corrected name is another model's in that family,
    the rename is refused with SAME_AS, naming the model it leads to"; owner
    rule "if the corrected model is one that already exists, the app offers to
    merge them"."""
    shops = await make_two_shops(maker)
    first = await model(maker, shops, concept="Лоран", color="шоколад")
    second = await model(maker, shops, family=first["product_family_id"], color="чорний")
    before = await catalogue_counts(maker, shops)
    first_card = await card(maker, shops, first["product_variant_id"])

    refused = await rename(
        maker,
        manager(shops),
        first["product_variant_id"],
        rename_body(shops, concept="Лоран", variant={"color": "чорний"}),
    )

    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "SAME_AS"
    assert refused.json()["details"]["same_as"] == second["product_variant_id"]
    # Refused after the command was looked up: proof nothing was recorded.
    assert refused.json()["details"]["recorded"] is False
    assert await card(maker, shops, first["product_variant_id"]) == first_card
    assert (await card(maker, shops, second["product_variant_id"]))["color"] == "чорний"
    assert await catalogue_counts(maker, shops) == before
    assert await corrections(maker, shops) == []
    assert await audits(maker, shops, "catalog.model_rename") == []


async def test_the_model_that_stays_takes_the_name_of_the_duplicate_merged_into_it(maker):
    """ADR-0008 §4: "A merged model gives up its name … So the model that stays
    may be renamed to it: if the owner kept the misspelled model because it
    holds more history, it can still take the right spelling." §2: "A merged
    model whose name it is and which leads to this very model does not stand
    in the way."
    """
    shops = await make_two_shops(maker)
    kept = await model(maker, shops, concept="Лоран", color="шокалад")
    duplicate = await model(maker, shops, family=kept["product_family_id"], color="шоколад")
    size = kept["sizes"][0]["size_id"]
    await receive(
        maker,
        shops,
        store=shops.primary_store,
        warehouse=shops.shared_warehouse,
        variant=duplicate["product_variant_id"],
        size=size,
        qty=1,
    )
    merged = await merge(maker, shops, duplicate["product_variant_id"], kept["product_variant_id"])
    assert merged["status"] == "MERGED"

    # Confirmed: whether the word its own duplicate left should warn at all is
    # the next test's question; this one is about the name.
    renamed = await rename(
        maker,
        manager(shops),
        kept["product_variant_id"],
        rename_body(shops, concept="Лоран", variant={"color": "шоколад"}, similar_confirmed=True),
    )

    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name_before"] == "Лоран шокалад"
    assert renamed.json()["name_after"] == "Лоран шоколад"
    assert renamed.json()["correction_id"] is not None
    stays = await variant_row(maker, kept["product_variant_id"])
    gone = await variant_row(maker, duplicate["product_variant_id"])
    assert stays.status is EntityStatus.ACTIVE
    assert stays.color_term_id == gone.color_term_id
    assert gone.status is EntityStatus.MERGED
    assert str(gone.merged_into_id) == kept["product_variant_id"]
    async with maker() as session:
        assert (
            await quantity_at(session, shops.shared_warehouse, kept["product_variant_id"], size)
            == 1
        )
    # Creating the name now finds the model that holds it, and creates nothing.
    again = await model(maker, shops, family=kept["product_family_id"], color="шоколад")
    assert again["product_variant_id"] == kept["product_variant_id"]
    assert again["variant_created"] is False


async def test_taking_back_the_name_its_own_duplicate_left_is_not_warned(maker):
    """ADR-0008 §4: the model that stays "can still take the right spelling";
    §2: "A merged model whose name it is and which leads to this very model
    does not stand in the way. The rename takes the name." The owner's rule
    on a word left by a merge is that it "warns … and offers the model that
    stays" — here that is the very model being renamed, so there is nothing
    to offer and nothing to warn of."""
    shops = await make_two_shops(maker)
    kept = await model(maker, shops, concept="Лоран", color="шокалад")
    duplicate = await model(maker, shops, family=kept["product_family_id"], color="шоколад")
    await merge(maker, shops, duplicate["product_variant_id"], kept["product_variant_id"])

    renamed = await rename(
        maker,
        manager(shops),
        kept["product_variant_id"],
        rename_body(shops, concept="Лоран", variant={"color": "шоколад"}),
    )

    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name_after"] == "Лоран шоколад"


async def test_a_merged_models_name_that_leads_elsewhere_is_still_another_models(maker):
    """ADR-0008 §2: only a merged model "which leads to this very model" stands
    aside; one merged into a third model is that model's name, and the rename
    is refused SAME_AS naming the model it leads to (§5)."""
    shops = await make_two_shops(maker)
    renamed = await model(maker, shops, concept="Лоран", color="шокалад")
    stays = await model(maker, shops, family=renamed["product_family_id"], color="коньяк")
    folded = await model(maker, shops, family=renamed["product_family_id"], color="карамель")
    await merge(maker, shops, folded["product_variant_id"], stays["product_variant_id"])

    refused = await rename(
        maker,
        manager(shops),
        renamed["product_variant_id"],
        rename_body(shops, concept="Лоран", variant={"color": "карамель"}, similar_confirmed=True),
    )

    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "SAME_AS"
    assert refused.json()["details"]["same_as"] == stays["product_variant_id"]
    assert (await card(maker, shops, renamed["product_variant_id"]))["color"] == "шокалад"
    assert [c.kind for c in await corrections(maker, shops)] == ["MERGE"]


async def test_a_merged_model_is_not_renamed(maker):
    """ADR-0008 §2: "A merged model is not renamed (MODEL_MERGED, naming the
    model that stays)", and the refusal proves nothing was recorded (§9)."""
    shops = await make_two_shops(maker)
    stays = await model(maker, shops, concept="Лоран", color="шоколад")
    duplicate = await model(maker, shops, family=stays["product_family_id"], color="шокалад")
    await merge(maker, shops, duplicate["product_variant_id"], stays["product_variant_id"])
    before = await variant_row(maker, duplicate["product_variant_id"])

    refused = await rename(
        maker,
        manager(shops),
        duplicate["product_variant_id"],
        rename_body(shops, concept="Лоран", variant={"color": "бежевий"}),
    )

    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "MODEL_MERGED"
    assert refused.json()["details"] == {
        "product_variant_id": duplicate["product_variant_id"],
        "merged_into": stays["product_variant_id"],
        "recorded": False,
    }
    after = await variant_row(maker, duplicate["product_variant_id"])
    assert (after.color_term_id, after.status, after.merged_into_id) == (
        before.color_term_id,
        before.status,
        before.merged_into_id,
    )
    assert [c.kind for c in await corrections(maker, shops)] == ["MERGE"]
    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AttributeTerm)
                .where(
                    AttributeTerm.organization_id == shops.organization_id,
                    AttributeTerm.normalized_name == "бежевий",
                )
            )
            == 0
        )


# ---------------------------------------------------------------------------
# 5. A new concept finds its family as creation does
# ---------------------------------------------------------------------------


async def test_a_concept_whose_family_could_be_the_same_is_refused_until_one_is_named(maker):
    """ADR-0008 §2: a new concept "finds its family as creation does … with
    any, the rename is refused (CATALOG_AMBIGUOUS, listing them) unless the
    request names one of them"; owner rule "a family that could be the same is
    offered, never chosen silently". The family the model left, with no model
    that is not merged, is merged into the new one (§3)."""
    shops = await make_two_shops(maker)
    moved = await model(maker, shops, concept="Лоран", color="шоколад")
    there = await model(maker, shops, concept="Мілан", color="чорний")
    beige = await model(maker, shops, family=there["product_family_id"], color="бежевий")
    before = await catalogue_counts(maker, shops)

    ambiguous = await rename(
        maker,
        manager(shops),
        moved["product_variant_id"],
        rename_body(shops, concept="Мілан", variant={"color": "шоколад"}),
    )
    assert ambiguous.status_code == 409, ambiguous.text
    assert ambiguous.json()["code"] == "CATALOG_AMBIGUOUS"
    assert ambiguous.json()["details"]["candidate_family_ids"] == [there["product_family_id"]]
    assert await catalogue_counts(maker, shops) == before
    assert (await card(maker, shops, moved["product_variant_id"]))["product_family_id"] == moved[
        "product_family_id"
    ]
    assert await corrections(maker, shops) == []

    # In the family named, the name is checked against that family's models.
    taken = await rename(
        maker,
        manager(shops),
        moved["product_variant_id"],
        rename_body(
            shops,
            concept="Мілан",
            variant={"color": "бежевий"},
            product_family_id=there["product_family_id"],
        ),
    )
    assert taken.status_code == 409, taken.text
    assert taken.json()["code"] == "SAME_AS"
    assert taken.json()["details"]["same_as"] == beige["product_variant_id"]
    assert await catalogue_counts(maker, shops) == before
    assert (await family_row(maker, moved["product_family_id"])).status is EntityStatus.ACTIVE

    chosen = await rename(
        maker,
        manager(shops),
        moved["product_variant_id"],
        rename_body(
            shops,
            concept="Мілан",
            variant={"color": "шоколад"},
            product_family_id=there["product_family_id"],
        ),
    )
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["name_after"] == "Мілан шоколад"
    assert chosen.json()["details"]["family_created"] is False
    assert chosen.json()["details"]["family_merged"] is True
    seen = await card(maker, shops, moved["product_variant_id"])
    assert seen["product_family_id"] == there["product_family_id"]
    assert seen["concept"] == "Мілан"
    left = await family_row(maker, moved["product_family_id"])
    assert left.status is EntityStatus.MERGED
    assert str(left.merged_into_id) == there["product_family_id"]
    # Family search no longer offers the emptied family.
    async with api(maker, shops.scope(shops.primary_store)) as client:
        families = await client.get(
            "/api/v1/catalog/families",
            params={"store_id": str(shops.primary_store), "query": "лоран"},
        )
    assert families.status_code == 200, families.text
    assert families.json()["items"] == []


async def test_a_concept_said_to_be_a_new_model_gets_a_family_of_its_own(maker):
    """ADR-0008 §2: with candidates, the rename goes ahead when it "says
    new_model with a distinction_note" — creation's own answer (ADR-0002)."""
    shops = await make_two_shops(maker)
    moved = await model(maker, shops, concept="Лоран", color="шоколад")
    there = await model(maker, shops, concept="Мілан", color="чорний")

    note_missing = await rename(
        maker,
        manager(shops),
        moved["product_variant_id"],
        rename_body(shops, concept="Мілан", variant={"color": "шоколад"}, new_model=True),
    )
    assert note_missing.status_code == 422, note_missing.text
    assert await corrections(maker, shops) == []

    renamed = await rename(
        maker,
        manager(shops),
        moved["product_variant_id"],
        rename_body(
            shops,
            concept="Мілан",
            variant={"color": "шоколад"},
            new_model=True,
            distinction_note="Довша, з капюшоном",
        ),
    )

    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["details"]["family_created"] is True
    assert renamed.json()["details"]["family_merged"] is True
    seen = await card(maker, shops, moved["product_variant_id"])
    assert seen["product_family_id"] not in {there["product_family_id"], moved["product_family_id"]}
    assert seen["concept"] == "Мілан"
    assert seen["distinction_note"] == "Довша, з капюшоном"
    new_family = await family_row(maker, seen["product_family_id"])
    there_family = await family_row(maker, there["product_family_id"])
    assert new_family.canonical_concept_id == there_family.canonical_concept_id
    assert new_family.status is EntityStatus.ACTIVE
    left = await family_row(maker, moved["product_family_id"])
    assert left.status is EntityStatus.MERGED
    assert str(left.merged_into_id) == seen["product_family_id"]
    assert there_family.status is EntityStatus.ACTIVE


async def test_a_concept_new_to_the_catalogue_is_created_with_its_family(maker):
    """ADR-0008 §2: "a new concept's category and garment type, which the app
    fills in from the current concept"; "with none, a family is created with
    that concept and source and the model's garment type". The family the
    model left is merged only when no model that is not merged stays in it."""
    shops = await make_two_shops(maker)
    moved = await model(
        maker,
        shops,
        concept="Лоран",
        color="шоколад",
        business_category="Верхній одяг",
        garment_type="Пальто",
    )
    stayed = await model(maker, shops, concept="Мілан", color="чорний", garment_type="Пальто")
    sibling = await model(maker, shops, family=stayed["product_family_id"], color="сірий")
    old_family = await family_row(maker, moved["product_family_id"])

    renamed = await rename(
        maker,
        manager(shops),
        moved["product_variant_id"],
        rename_body(
            shops,
            concept="Верона",
            variant={"color": "шоколад"},
            business_category="Верхній одяг",
            garment_type="Пальто",
        ),
    )

    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name_after"] == "Верона шоколад"
    assert renamed.json()["details"]["family_created"] is True
    assert renamed.json()["details"]["family_merged"] is True
    seen = await card(maker, shops, moved["product_variant_id"])
    assert seen["concept"] == "Верона"
    assert seen["business_category"] == "Верхній одяг"
    assert seen["garment_type"] == "Пальто"
    async with maker() as session:
        concept = await session.scalar(
            select(CanonicalConcept).where(
                CanonicalConcept.organization_id == shops.organization_id,
                CanonicalConcept.normalized_name == "верона",
            )
        )
        assert concept is not None
        category = await session.get(BusinessCategory, concept.business_category_id)
        garment = await session.get(GarmentType, concept.garment_type_id)
        assert category is not None and category.name == "Верхній одяг"
        assert garment is not None and garment.name == "Пальто"
    new_family = await family_row(maker, seen["product_family_id"])
    assert new_family.canonical_concept_id == concept.id
    assert new_family.garment_type_id == old_family.garment_type_id
    left = await family_row(maker, moved["product_family_id"])
    assert left.status is EntityStatus.MERGED
    assert str(left.merged_into_id) == seen["product_family_id"]

    # A family that keeps a live model is not merged when one of its models
    # moves out.
    moved_out = await rename(
        maker,
        manager(shops),
        sibling["product_variant_id"],
        rename_body(shops, concept="Флоренція", variant={"color": "сірий"}),
    )
    assert moved_out.status_code == 200, moved_out.text
    assert moved_out.json()["details"]["family_merged"] is False
    kept = await family_row(maker, stayed["product_family_id"])
    assert kept.status is EntityStatus.ACTIVE
    assert kept.merged_into_id is None
    assert (await card(maker, shops, stayed["product_variant_id"]))["product_family_id"] == stayed[
        "product_family_id"
    ]


# ---------------------------------------------------------------------------
# 6–7. Nothing to change; command identity; who renames
# ---------------------------------------------------------------------------


async def test_a_rename_that_changes_nothing_records_nothing(maker):
    """ADR-0008 §2: "A name that changes nothing is answered as it is, and
    records nothing." Case and spaces are the same name (`normalize_label`)."""
    shops = await make_two_shops(maker)
    found = await model(maker, shops, concept="Лоран", color="шоколад", length_cm="90")
    revision_before = await revision(maker, shops)

    same = await rename(
        maker,
        manager(shops),
        found["product_variant_id"],
        rename_body(shops, concept="  ЛОРАН ", variant={"color": "Шоколад", "length_cm": "90.0"}),
    )

    assert same.status_code == 200, same.text
    assert same.json() == {
        "correction_id": None,
        "kind": "RENAME",
        "product_variant_id": found["product_variant_id"],
        "into_variant_id": None,
        "name_before": "Лоран шоколад 90.0 см",
        "name_after": "Лоран шоколад 90.0 см",
        "status": "ACTIVE",
        "details": {},
    }
    assert await corrections(maker, shops) == []
    assert await audits(maker, shops, "catalog.model_rename") == []
    # Nothing in the catalogue changed, so no open proposal is made stale.
    assert await revision(maker, shops) == revision_before


async def test_one_command_is_one_rename_and_another_request_under_it_is_refused(maker):
    """ADR-0008 §1: "Each correction is named by a permanent command_id (I20).
    The same command is answered with what it did; another request under the
    same id is IDEMPOTENCY_CONFLICT." The answer is what it did then, even
    after the model was renamed again."""
    shops = await make_two_shops(maker)
    found = await model(maker, shops, concept="Лоран", color="шоколад")
    variant = found["product_variant_id"]
    command_id = uuid.uuid4()
    body = rename_body(shops, command_id=command_id, concept="Лоран", variant={"color": "чорний"})

    first = await rename(maker, manager(shops), variant, body)
    assert first.status_code == 200, first.text
    later = await rename(
        maker,
        manager(shops),
        variant,
        rename_body(shops, concept="Лоран", variant={"color": "бежевий"}),
    )
    assert later.status_code == 200, later.text

    # A new Idempotency-Key, the same command: the first answer, done once.
    replayed = await rename(maker, manager(shops), variant, body)
    assert replayed.status_code == 200, replayed.text
    assert replayed.json() == first.json()
    assert (await card(maker, shops, variant))["color"] == "бежевий"

    conflict = await rename(
        maker,
        manager(shops),
        variant,
        rename_body(shops, command_id=command_id, concept="Лоран", variant={"color": "сірий"}),
    )
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert (await card(maker, shops, variant))["color"] == "бежевий"
    assert [str(c.id) for c in await corrections(maker, shops)] == [
        first.json()["correction_id"],
        later.json()["correction_id"],
    ]
    assert len(await audits(maker, shops, "catalog.model_rename")) == 2


async def test_a_seller_does_not_rename_and_a_manager_of_the_store_does(maker):
    """Owner rule: "The owner and managers correct the catalogue
    (catalog:merge). A seller creates models but does not correct them."
    ADR-0008 §1: rename needs `catalog:merge` in the store the person acts in."""
    shops = await make_two_shops(maker)
    found = await model(maker, shops, concept="Лоран", color="шоколад")
    variant = found["product_variant_id"]
    body = rename_body(shops, concept="Лоран", variant={"color": "чорний"})

    seller = await rename(maker, shops.scope(shops.primary_store, SELLER), variant, body)
    assert seller.status_code == 403, seller.text
    assert seller.json()["code"] == "PERMISSION_DENIED"
    # Nor does a seller open the models to correct them.
    async with api(maker, shops.scope(shops.primary_store, SELLER)) as client:
        listing = await client.get(
            "/api/v1/catalog/models", params={"store_id": str(shops.primary_store)}
        )
        opened = await client.get(
            f"/api/v1/catalog/models/{variant}", params={"store_id": str(shops.primary_store)}
        )
    assert (listing.status_code, opened.status_code) == (403, 403)
    # A manager of another store does not act in this one.
    elsewhere = await rename(maker, manager(shops, shops.child_store), variant, body)
    assert elsewhere.status_code == 403, elsewhere.text
    assert (await card(maker, shops, variant))["color"] == "шоколад"
    assert await corrections(maker, shops) == []

    # Another organization's manager is told the model does not exist.
    strangers = await make_two_shops(maker)
    foreign = await rename(
        maker, manager(strangers), variant, body | {"store_id": str(strangers.primary_store)}
    )
    assert foreign.status_code == 404, foreign.text
    assert foreign.json()["code"] == "NOT_FOUND"

    managed = await rename(maker, manager(shops), variant, body)
    assert managed.status_code == 200, managed.text
    assert managed.json()["name_after"] == "Лоран чорний"
    # And the child store's manager renames from her own store.
    hers = await rename(
        maker,
        manager(shops, shops.child_store),
        variant,
        rename_body(shops, store=shops.child_store, concept="Лоран", variant={"color": "бежевий"}),
    )
    assert hers.status_code == 200, hers.text
    assert [c.acting_store_id for c in await corrections(maker, shops)] == [
        shops.primary_store,
        shops.child_store,
    ]


async def test_a_revoked_grant_is_not_handed_the_stored_rename(maker):
    """`RequestScope.require` is checked "before a stored response is
    replayed, so that a revoked grant cannot keep returning a success it was
    once entitled to" (I12/I13), as every other command endpoint does."""
    shops = await make_two_shops(maker)
    found = await model(maker, shops, concept="Лоран", color="шоколад")
    body = rename_body(shops, concept="Лоран", variant={"color": "чорний"})
    idempotency_key = str(uuid.uuid4())
    first = await rename(
        maker, manager(shops), found["product_variant_id"], body, idempotency_key=idempotency_key
    )
    assert first.status_code == 200, first.text

    # The same person, a seller now, sends the same request under the same key.
    revoked = await rename(
        maker,
        shops.scope(shops.primary_store, SELLER),
        found["product_variant_id"],
        body,
        idempotency_key=idempotency_key,
    )

    assert revoked.status_code == 403, revoked.text


# ---------------------------------------------------------------------------
# 8. A similar name at creation
# ---------------------------------------------------------------------------


async def test_a_concept_typed_with_a_latin_letter_is_refused_once_and_names_the_model(maker):
    """Owner rule "A similar name at creation (Latin letters in place of
    Cyrillic, case, extra spaces): the app shows the similar model and offers
    to take it. If the person confirms it is another model, it is still
    created." ADR-0008 §7."""
    shops = await make_two_shops(maker)
    laurent = await model(maker, shops, concept="Лоран", color="шоколад")
    before = await catalogue_counts(maker, shops)
    latin_o = "Лoран"  # the «o» is Latin
    assert latin_o != "Лоран"

    refused = await create(maker, shops.scope(shops.primary_store), shops, concept=latin_o)

    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "CATALOG_SIMILAR"
    assert refused.json()["details"]["similar"] == [
        {
            "field": "concept",
            "typed": latin_o,
            "existing": ["Лоран"],
            "left_by_merge": False,
            "models": [
                {
                    "product_variant_id": laurent["product_variant_id"],
                    "display_name": "Лоран шоколад",
                }
            ],
        }
    ]
    assert await catalogue_counts(maker, shops) == before

    confirmed = await create(
        maker,
        shops.scope(shops.primary_store),
        shops,
        concept=latin_o,
        similar_confirmed=True,
    )
    assert confirmed.status_code == 201, confirmed.text
    assert confirmed.json()["family_created"] is True
    assert confirmed.json()["display_name"] == latin_o
    assert confirmed.json()["product_variant_id"] != laurent["product_variant_id"]
    after = await catalogue_counts(maker, shops)
    assert after["concepts"] == before["concepts"] + 1


async def test_a_colour_typed_with_a_latin_letter_is_refused_and_the_spelling_in_use_is_not(maker):
    """Owner rule "A similar name at creation"; ADR-0008 §7: every typed word,
    each of the five terms included, is compared with the organization's words
    of the same kind. The existing spelling itself, in any case or spacing, is
    the same word and is not warned."""
    shops = await make_two_shops(maker)
    laurent = await model(maker, shops, concept="Лоран", color="шоколад")
    milan = await model(maker, shops, concept="Мілан", color="шоколад", material="замш")
    latin_a = "шоколaд"  # the second «a» is Latin

    refused = await create(
        maker, shops.scope(shops.primary_store), shops, concept="Верона", color=latin_a
    )

    assert refused.status_code == 409, refused.text
    [similar] = refused.json()["details"]["similar"]
    assert similar["field"] == "color"
    assert similar["typed"] == latin_a
    assert similar["existing"] == ["шоколад"]
    assert similar["left_by_merge"] is False
    assert sorted(
        (m["product_variant_id"], m["display_name"]) for m in similar["models"]
    ) == sorted(
        [
            (laurent["product_variant_id"], "Лоран шоколад"),
            (milan["product_variant_id"], "Мілан шоколад замш"),
        ]
    )
    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(CanonicalConcept)
                .where(
                    CanonicalConcept.organization_id == shops.organization_id,
                    CanonicalConcept.normalized_name == "верона",
                )
            )
            == 0
        )

    # The spelling in use, shouted and padded, is the same word: no warning.
    same_word = await create(
        maker, shops.scope(shops.primary_store), shops, concept="Верона", color="  ШОКОЛАД "
    )
    assert same_word.status_code == 201, same_word.text
    assert same_word.json()["display_name"] == "Верона шоколад"

    confirmed = await create(
        maker,
        shops.scope(shops.primary_store),
        shops,
        concept="Флоренція",
        color=latin_a,
        similar_confirmed=True,
    )
    assert confirmed.status_code == 201, confirmed.text
    assert confirmed.json()["display_name"] == f"Флоренція {latin_a}"


async def test_a_source_is_checked_too_and_a_word_is_compared_only_with_its_own_kind(maker):
    """ADR-0008 §7: "Every typed word (concept, source, each of the five terms)
    is compared with the organization's words of the same kind." A colour that
    looks like a material in use is not that material."""
    shops = await make_two_shops(maker)
    belardi = await model(
        maker, shops, concept="Лоран", source="Belardi", color="шоколад", material="замш"
    )
    cyrillic_b = "Вelardi"  # the «В» is Cyrillic

    refused = await create(
        maker,
        shops.scope(shops.primary_store),
        shops,
        concept="Мілан",
        source=cyrillic_b,
    )
    assert refused.status_code == 409, refused.text
    assert refused.json()["details"]["similar"] == [
        {
            "field": "source",
            "typed": cyrillic_b,
            "existing": ["Belardi"],
            "left_by_merge": False,
            "models": [
                {
                    "product_variant_id": belardi["product_variant_id"],
                    "display_name": "Лоран Belardi шоколад замш",
                }
            ],
        }
    ]

    # «зaмш» (Latin a) as a colour: no colour folds like it.
    colour = await create(
        maker, shops.scope(shops.primary_store), shops, concept="Мілан", color="зaмш"
    )
    assert colour.status_code == 201, colour.text


async def test_a_similar_name_is_warned_when_created_from_a_match_decision(maker):
    """ADR-0008 §7 "Where it runs: create_product, creating from a match
    decision, and a rename's new words." The decision stays undecided after
    the warning, and the confirmed request creates it."""
    shops = await make_two_shops(maker)
    laurent = await model(maker, shops, concept="Лоран", color="шоколад")
    scope = shops.scope(shops.primary_store)
    async with api(maker, scope) as client:
        proposed = await client.post(
            "/api/v1/catalog/match-decisions",
            json={
                "decision_id": str(uuid.uuid4()),
                "store_id": str(shops.primary_store),
                "raw_text": "лоран чорна нова",
            },
        )
        assert proposed.status_code == 200, proposed.text
        decision = proposed.json()
        endpoint = f"/api/v1/catalog/match-decisions/{decision['decision_id']}/create-product"
        body = product_body(shops, concept="Лoран", color="чорний")

        refused = await client.post(endpoint, json=body)
        assert refused.status_code == 409, refused.text
        assert refused.json()["code"] == "CATALOG_SIMILAR"
        # Under the decision's lock, not applied: nothing was recorded.
        assert refused.json()["details"]["recorded"] is False
        [similar] = refused.json()["details"]["similar"]
        assert (similar["field"], similar["typed"], similar["existing"]) == (
            "concept",
            "Лoран",
            ["Лоран"],
        )
        assert similar["models"] == [
            {"product_variant_id": laurent["product_variant_id"], "display_name": "Лоран шоколад"}
        ]
        state = await client.get(f"/api/v1/catalog/match-decisions/{decision['decision_id']}")
        assert state.status_code == 200, state.text
        assert state.json()["status"] == decision["status"]
        assert state.json()["creation"] is None

        confirmed = await client.post(endpoint, json=body | {"similar_confirmed": True})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "APPLIED"
    assert confirmed.json()["creation"]["display_name"] == "Лoран чорний"
    assert confirmed.json()["creation"]["family_created"] is True


async def test_a_word_left_only_by_a_merged_model_is_warned_and_offers_the_model_that_stays(maker):
    """Owner rule (how it is carried out): "The words of a renamed or merged
    model stay. Typing a word now used only by merged models warns, as a
    similar name does, and offers the model that stays." ADR-0008 §7."""
    shops = await make_two_shops(maker)
    stays = await model(maker, shops, concept="Лоран", color="шоколад")
    typo = await model(maker, shops, family=stays["product_family_id"], color="шокалад")
    await merge(maker, shops, typo["product_variant_id"], stays["product_variant_id"])

    refused = await create(
        maker, shops.scope(shops.primary_store), shops, concept="Мілан", color="шокалад"
    )

    assert refused.status_code == 409, refused.text
    assert refused.json()["details"]["similar"] == [
        {
            "field": "color",
            "typed": "шокалад",
            # The spelling the model that stays uses, to take it.
            "existing": ["шоколад"],
            "left_by_merge": True,
            "models": [
                {"product_variant_id": stays["product_variant_id"], "display_name": "Лоран шоколад"}
            ],
        }
    ]

    confirmed = await create(
        maker,
        shops.scope(shops.primary_store),
        shops,
        concept="Мілан",
        color="шокалад",
        similar_confirmed=True,
    )
    assert confirmed.status_code == 201, confirmed.text
    assert confirmed.json()["display_name"] == "Мілан шокалад"


async def test_creating_a_merged_models_name_gives_the_model_that_stays(maker):
    """ADR-0008 §4: "Creating a merged model's name gives the model that
    stays" (`created = false`, `redirected_from`), once the similar-name
    warning about the word the merge left behind is confirmed."""
    shops = await make_two_shops(maker)
    stays = await model(maker, shops, concept="Лоран", color="шоколад")
    typo = await model(maker, shops, family=stays["product_family_id"], color="шокалад")
    await merge(maker, shops, typo["product_variant_id"], stays["product_variant_id"])

    again = await create(
        maker,
        shops.scope(shops.primary_store),
        shops,
        family=stays["product_family_id"],
        color="шокалад",
        similar_confirmed=True,
    )

    assert again.status_code == 201, again.text
    assert again.json()["product_variant_id"] == stays["product_variant_id"]
    assert again.json()["variant_created"] is False
    assert again.json()["redirected_from"] == typo["product_variant_id"]
    assert again.json()["display_name"] == "Лоран шоколад"


# ---------------------------------------------------------------------------
# 9. A rename's new words get the same check
# ---------------------------------------------------------------------------


async def test_a_renames_new_words_are_checked_and_the_words_it_carries_are_not(maker):
    """ADR-0008 §7 "Where it runs: … a rename's new words"; §2 "Each word is
    found or created as when a model is created … after the similar-name check
    of §7". A word the model already carries was answered when it was typed."""
    shops = await make_two_shops(maker)
    black = await model(maker, shops, concept="Мілан", color="чорний")
    await model(maker, shops, concept="Лоран", color="бежевий")
    # This model's concept was confirmed as another one when it was created.
    latin = await model(maker, shops, concept="Лoран", color="шоколад", similar_confirmed=True)
    variant = latin["product_variant_id"]
    latin_o = "чoрний"  # the «o» is Latin

    refused = await rename(
        maker,
        manager(shops),
        variant,
        rename_body(shops, concept="Лoран", variant={"color": latin_o}),
    )

    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "CATALOG_SIMILAR"
    # Only the new word: the concept it already carries is not warned again.
    assert refused.json()["details"]["similar"] == [
        {
            "field": "color",
            "typed": latin_o,
            "existing": ["чорний"],
            "left_by_merge": False,
            "models": [
                {"product_variant_id": black["product_variant_id"], "display_name": "Мілан чорний"}
            ],
        }
    ]
    assert (await card(maker, shops, variant))["color"] == "шоколад"
    assert await corrections(maker, shops) == []

    confirmed = await rename(
        maker,
        manager(shops),
        variant,
        rename_body(shops, concept="Лoран", variant={"color": latin_o}, similar_confirmed=True),
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["name_after"] == f"Лoран {latin_o}"

    # A word the model carries, kept while another is changed: no warning.
    plain = await rename(
        maker,
        manager(shops),
        variant,
        rename_body(shops, concept="Лoран", variant={"color": latin_o, "material": "замш"}),
    )
    assert plain.status_code == 200, plain.text
    assert plain.json()["name_after"] == f"Лoран {latin_o} замш"


@pytest.mark.parametrize("spelling_in_use", [False, True])
async def test_correcting_a_lookalike_typo_is_not_warned_about_the_typo_itself(
    maker, spelling_in_use
):
    """The reason the owner asked for a rename: «Лоран» typed with a Latin
    letter. ADR-0008 §7 warns when "another spelling folds the same and is used
    by a model not merged" so the person "can take one" — the only model using
    the typo is the one being corrected, and the warning would offer it its
    own typo. Owner rule: "the app shows the similar model and offers to take
    it"."""
    shops = await make_two_shops(maker)
    typo_concept = "Лорaн"  # the «a» is Latin
    typo = await model(maker, shops, concept=typo_concept, color="чорний")
    extra: dict[str, Any] = {}
    if spelling_in_use:
        right = await model(maker, shops, concept="Лоран", color="шоколад", similar_confirmed=True)
        # The family the right spelling already has could be this coat's.
        extra = {"product_family_id": right["product_family_id"]}

    corrected = await rename(
        maker,
        manager(shops),
        typo["product_variant_id"],
        rename_body(shops, concept="Лоран", variant={"color": "чорний"}, **extra),
    )

    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["name_before"] == f"{typo_concept} чорний"
    assert corrected.json()["name_after"] == "Лоран чорний"
    assert (await family_row(maker, typo["product_family_id"])).status is EntityStatus.MERGED


async def test_a_family_named_must_be_one_the_typed_name_could_be(maker):
    """ADR-0008 §2: with candidates, the rename is refused "unless the request
    names one of them". A family of the same concept under another source is
    not one of them: moving the model there would give it a source nobody
    typed, while the request states another."""
    shops = await make_two_shops(maker)
    moved = await model(maker, shops, concept="Лоран", color="шоколад")
    ponte = await model(
        maker,
        shops,
        concept="Лоран",
        source="Ponte",
        color="чорний",
        new_model=True,
        distinction_note="Інша фабрика",
    )
    assert ponte["product_family_id"] != moved["product_family_id"]
    before = await card(maker, shops, moved["product_variant_id"])

    renamed = await rename(
        maker,
        manager(shops),
        moved["product_variant_id"],
        rename_body(
            shops,
            concept="Лоран",
            source="Belardi",
            variant={"color": "шоколад"},
            product_family_id=ponte["product_family_id"],
        ),
    )

    assert renamed.status_code in {409, 422}, renamed.text
    assert await card(maker, shops, moved["product_variant_id"]) == before
    assert await corrections(maker, shops) == []


async def test_a_source_stated_in_a_rename_is_never_silently_dropped(maker):
    """Owner rule: "Everything in its name may be corrected: the model's name,
    the factory or brand label, …". ADR-0008 §2: the request "states the
    model's whole name again". The model's own family is where it is, not a
    product it could be: adding a label to a model whose family states none
    puts it in a family that states it, and never answers success with the
    label gone. Naming its own family is refused."""
    shops = await make_two_shops(maker)
    found = await model(maker, shops, concept="Лоран", color="шоколад")
    neighbour = await model(maker, shops, family=found["product_family_id"], color="молоко")
    body = rename_body(shops, concept="Лоран", source="Belardi", variant={"color": "шоколад"})

    own = await rename(
        maker,
        manager(shops),
        found["product_variant_id"],
        body | {"product_family_id": found["product_family_id"]},
    )
    assert own.status_code == 422, own.text
    assert own.json()["details"]["reason"] == "NOT_A_CANDIDATE"
    assert (await card(maker, shops, found["product_variant_id"]))["source"] is None

    renamed = await rename(
        maker,
        manager(shops),
        found["product_variant_id"],
        body | {"command_id": str(uuid.uuid4())},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name_after"] == "Лоран Belardi шоколад"
    assert renamed.json()["details"]["family_created"] is True
    # Its old family still has a model of its own, and is left alone.
    assert renamed.json()["details"]["family_merged"] is False
    after = await card(maker, shops, found["product_variant_id"])
    assert after["source"] == "Belardi"
    assert after["product_family_id"] != found["product_family_id"]
    assert (await card(maker, shops, neighbour["product_variant_id"]))["source"] is None


# ---------------------------------------------------------------------------
# 10. The fold
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("typed", "folded"),
    [
        ("Лoран", "лоран"),  # Latin o
        ("шоколaд", "шоколад"),  # Latin a
        ("ЛОРАН", "лоран"),  # case
        ("  лоран   шоколад ", "лоран шоколад"),  # whitespace
        ("ïжачок", "їжачок"),  # Latin ï
        ("зелёний", "зелений"),  # ё
        ("п’ятнистий", "п'ятнистий"),  # right single quotation mark
        ("пʼятнистий", "п'ятнистий"),  # modifier letter apostrophe
        ("п`ятнистий", "п'ятнистий"),  # grave accent
        ("п´ятнистий", "п'ятнистий"),  # acute accent: before NFKC splits it
        ("BEPOHA", "верона"),  # upper-case Latin B, E, P, O, H, A
        ("TEMHO", "темно"),  # upper-case Latin T, M
        ("сxid", "схіd"),  # c and x, i; d has no Cyrillic twin
        ("ＬＯＲＡＮ", "l\u043er\u0430n"),  # full-width: NFKC first; r, l, n stay Latin
    ],
)
def test_the_fold_maps_what_looks_alike_and_nothing_else(typed, folded):
    """ADR-0008 §7: NFKC, then casefold; Latin letters that look Cyrillic
    (a c e i o p x y k m t b h); ï → ї, ё → е; apostrophes unified;
    whitespace collapsed."""
    assert fold(typed) == folded


def test_the_fold_keeps_different_words_apart():
    """A fold that warns of everything would be a fold that warns of nothing:
    two real words stay two."""
    assert fold("шоколад") != fold("шокалад")
    assert fold("лоран") != fold("мілан")
    assert fold(normalize_label("  ЛOРАН ", limit=200)) == fold(normalize_label("лоран", limit=200))


async def test_the_sql_fold_agrees_with_the_python_fold_on_stored_names(maker):
    """ADR-0008 §7: the check compares the typed word, folded in Python, with
    the stored words folded in SQL. The two must fold every stored name the
    same, or a lookalike would slip through."""
    shops = await make_two_shops(maker)
    names = [
        ("BEPOHA", "TEMHO"),
        ("Лoран", "шоколaд"),
        ("Ïрис", "п’ятнистий"),
        ("Зелёна", "пʼятнистий"),
        ("ＬＯＲＡＮ", "с x і"),
    ]
    for concept, colour in names:
        await model(maker, shops, concept=concept, color=colour, similar_confirmed=True)

    fold_concept = _FOLD_SQL.format(column="c.normalized_name")
    fold_term = _FOLD_SQL.format(column="t.normalized_name")
    async with maker() as session:
        rows = (
            await session.execute(
                text(
                    f"SELECT c.normalized_name, {fold_concept} FROM canonical_concept c "  # noqa: S608
                    "WHERE c.organization_id = :org "
                    f"UNION ALL SELECT t.normalized_name, {fold_term} FROM attribute_term t "
                    "WHERE t.organization_id = :org"
                ),
                {"org": shops.organization_id},
            )
        ).all()
    assert len(rows) == 2 * len(names)
    assert dict(rows) == {stored: fold(stored) for stored, _ in rows}
    # And on a few literal values, as the check binds them.
    async with maker() as session:
        for value in ["лoран", "ïрис", "зелёна", "п’ять", "ｍ", "bepoha"]:
            in_sql = await session.scalar(
                text(f"SELECT {_FOLD_SQL.format(column='CAST(:value AS text)')}"),
                {"value": value},
            )
            assert in_sql == fold(value), value
