"""Retiring a model and bringing it back, the ledger's door for a merge, and
migration `0031` (owner decision, 2026-10-03, "correcting the catalogue";
ADR-0008 §3, §4, §5, §6, §9, §11), over HTTP against real PostgreSQL.

The owner's rules under test:

- **A retired model is no longer offered** in «Приймання», the catalogue
  search and the opening lists. Carried out as a refusal: a receipt naming it,
  an opening list's line and creating its name answer `MODEL_RETIRED`.
- **What is in stock may still be sold, returned or written off.** Carried
  out: it also moves between warehouses and is corrected after a count.
- **It can be brought back**, and is offered again as before.
- **A model is not retired while an opening list that waits names it.**
- **The owner and managers correct the catalogue** (`catalog:merge`, in the
  store the person acts in for a retirement); a seller does not.

And how ADR-0008 carries them out: every correction is one command under a
permanent `command_id`; only the merge writes `CATALOG_MERGE_OUT`/`_IN`, in
checked pairs that name their correction, and the database holds that too; a
merged model gives up its name to the unique key; `0031` refuses to go back
over what it added, and to go forward over a model marked merged by hand.

All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import replace
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.errors import ValidationFailedError
from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.catalog.models import CatalogCorrection, EntityStatus, ProductVariant
from app.modules.catalog_correction.service import restore_model, retire_model
from app.modules.inventory.models import (
    GoodsReceipt,
    MovementReason,
    MovementType,
    StockLot,
    StockMovement,
)
from app.modules.inventory.service import (
    CATALOG_CORRECTION_REFERENCE,
    MovementRequest,
    _apply_movements,
    apply_movements,
    find_divergences,
    validate_catalog_merges,
)
from app.modules.sales.models import Sale
from app.modules.sales.payment import PaymentMethod
from app.modules.sales.service import SaleLineInput, create_sale
from app.modules.snapshots.models import (
    InventorySnapshot,
    InventorySnapshotAllocation,
    InventorySnapshotRow,
    SnapshotStatus,
)
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import (
    TwoShops,
    api,
    key,
    make_two_shops,
    quantity_at,
    sale_body,
    stock_a_coat,
)
from tests.integration.test_snapshot_import import (
    World,
    allocation,
    approve,
    client_for,
    idempotent,
    imported,
    prepared,
    resolve,
    seed_world,
)
from tests.integration.test_snapshot_import import create_product as list_product
from tests.integration.test_stock_rekey_migration import _admin, _alembic, _engine, _run
from tests.integration.test_suggested_price import owner
from tests.integration.test_transfer_command import wait_until_blocked_by

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
OWNER = DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]

BEFORE = "0030_opening_list_hold"
CORRECTION = "0031_catalog_correction"
MERGE_CHECK = "ck_stock_movement_catalog_merge_names_its_correction"


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def world() -> AsyncIterator[World]:
    """A bootstrapped network with an opening list's three models, as
    `test_snapshot_import.py` builds it: real memberships, an owner, a manager
    and a seller of the main store."""
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    seeded = await seed_world(maker)
    async with client_for(maker, seeded["users"]["owner"]) as client:
        coat, coat_sizes = await list_product(
            client, seeded["main"], "Лоран", "шоколад", ["S", "M", "L"]
        )
        bomber, _ = await list_product(client, seeded["main"], "Мышка", "чорний", ["M"])
        bottega, _ = await list_product(client, seeded["main"], "Ботега", "бежевий", ["M"])
    yield World(
        engine=engine,
        maker=maker,
        coat=coat,
        bomber=bomber,
        bottega=bottega,
        sizes=coat_sizes,
        **seeded,
    )
    await engine.dispose()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def manager(shops: TwoShops, store: uuid.UUID | None = None) -> RequestScope:
    """A manager of one store: `catalog:merge` there, and nowhere else."""
    return shops.scope(store or shops.primary_store, MANAGER)


def store_command(store: uuid.UUID, command_id: uuid.UUID | None = None) -> dict[str, str]:
    return {"store_id": str(store), "command_id": str(command_id or uuid.uuid4())}


async def correct(
    maker: async_sessionmaker[AsyncSession],
    scope: RequestScope,
    action: str,
    variant: str | uuid.UUID,
    *,
    store: uuid.UUID,
    command_id: uuid.UUID | None = None,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    """`retire` or `restore` one model, as the scope's person, in `store`."""
    async with api(maker, scope) as client:
        return await client.post(
            f"/api/v1/catalog/models/{variant}/{action}",
            json=store_command(store, command_id),
            headers=headers or key(),
        )


async def offered(
    maker: async_sessionmaker[AsyncSession],
    shops: TwoShops,
    query: str,
    *,
    store: uuid.UUID | None = None,
) -> list[str]:
    """What «Приймання» and the opening lists' picker offer a seller."""
    store = store or shops.primary_store
    async with api(maker, shops.scope(store)) as client:
        response = await client.get(
            "/api/v1/catalog/receivable-variants",
            params={"store_id": str(store), "query": query, "limit": 50},
        )
    assert response.status_code == 200, response.text
    return [item["product_variant_id"] for item in response.json()["items"]]


async def card(maker: async_sessionmaker[AsyncSession], shops: TwoShops, variant: str) -> dict:
    async with api(maker, manager(shops)) as client:
        response = await client.get(
            f"/api/v1/catalog/models/{variant}", params={"store_id": str(shops.primary_store)}
        )
    assert response.status_code == 200, response.text
    body: dict = response.json()
    return body


async def receipt(
    client: httpx.AsyncClient,
    shops: TwoShops,
    lines: list[tuple[str, str, int]],
    *,
    command_id: uuid.UUID | None = None,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    return await client.post(
        "/api/v1/inventory/receipts",
        json={
            "store_id": str(shops.primary_store),
            "location_id": str(shops.shared_warehouse),
            "command_id": str(command_id or uuid.uuid4()),
            "lines": [
                {"product_variant_id": variant, "size_id": size, "quantity": quantity}
                for variant, size, quantity in lines
            ],
        },
        headers=headers or key(),
    )


async def status_of(maker: async_sessionmaker[AsyncSession], variant: str | uuid.UUID) -> tuple:
    async with maker() as session:
        row = (
            await session.execute(
                select(ProductVariant.status, ProductVariant.merged_into_id).where(
                    ProductVariant.id == uuid.UUID(str(variant))
                )
            )
        ).one()
    return row[0], row[1]


async def corrections_of(
    maker: async_sessionmaker[AsyncSession], variant: str | uuid.UUID
) -> list[CatalogCorrection]:
    async with maker() as session:
        return list(
            await session.scalars(
                select(CatalogCorrection)
                .where(CatalogCorrection.product_variant_id == uuid.UUID(str(variant)))
                .order_by(CatalogCorrection.created_at, CatalogCorrection.id)
            )
        )


async def audits_of(
    maker: async_sessionmaker[AsyncSession], variant: str | uuid.UUID
) -> list[AuditLog]:
    async with maker() as session:
        return list(
            await session.scalars(
                select(AuditLog)
                .where(
                    AuditLog.entity_id == uuid.UUID(str(variant)),
                    AuditLog.action.like("catalog.model_%"),
                )
                .order_by(AuditLog.created_at, AuditLog.id)
            )
        )


async def ledger_of(
    maker: async_sessionmaker[AsyncSession], variant: str | uuid.UUID
) -> list[tuple[uuid.UUID, str, str | None, int]]:
    """Every movement of a model, as (warehouse, type, reason, delta), sorted."""
    async with maker() as session:
        rows = await session.execute(
            select(
                StockMovement.location_id,
                StockMovement.movement_type,
                StockMovement.reason_code,
                StockMovement.quantity_delta,
            ).where(StockMovement.product_variant_id == uuid.UUID(str(variant)))
        )
        return sorted(
            (
                (location, kind.value, reason.value if reason else None, delta)
                for location, kind, reason, delta in rows.all()
            ),
            key=lambda row: (str(row[0]), row[1], row[2] or "", row[3]),
        )


async def a_coat(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, *, qty: int
) -> tuple[str, str]:
    """A coat a seller of the primary store created and received into the
    shared warehouse (`qty` may be 0)."""
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=qty
        )


# ---------------------------------------------------------------------------
# 1. A retired model: not offered, not received; its stock still lives
# ---------------------------------------------------------------------------


async def test_a_retired_model_is_not_offered_but_is_found_to_correct(maker):
    """Owner, 2026-10-03: "a retired model is no longer offered in «Приймання»,
    the catalogue search and the opening lists". ADR-0008 §6: the opening
    lists pick from receiving's own search, in every store, since a retirement
    is seen by every store. The correction screen still finds it, marked
    `RETIRED`, so it can be brought back; and the till still offers its stock.
    """
    shops = await make_two_shops(maker)
    variant, _size = await a_coat(maker, shops, qty=2)
    before = await card(maker, shops, variant)
    concept = before["concept"]
    assert await offered(maker, shops, concept) == [variant]

    async def proposed() -> list[str]:
        # The catalogue's search: what the matcher proposes for its name.
        async with api(maker, manager(shops)) as client:
            preview = await client.post(
                "/api/v1/catalog/match-preview",
                json={"store_id": str(shops.primary_store), "raw_text": before["display_name"]},
            )
        assert preview.status_code == 200, preview.text
        return [candidate["variant_id"] for candidate in preview.json()["candidates"]]

    assert variant in await proposed()

    retired = await correct(maker, manager(shops), "retire", variant, store=shops.primary_store)

    assert retired.status_code == 200, retired.text
    body = retired.json()
    assert body["correction_id"] is not None
    assert {k: v for k, v in body.items() if k != "correction_id"} == {
        "kind": "RETIRE",
        "product_variant_id": variant,
        "into_variant_id": None,
        "name_before": before["display_name"],
        "name_after": before["display_name"],
        "status": "RETIRED",
        "details": {"status_before": "ACTIVE", "status_after": "RETIRED"},
    }
    # Not offered at the back door of either store, by name or unfiltered,
    # nor proposed by the catalogue's search.
    assert variant not in await proposed()
    assert await offered(maker, shops, concept) == []
    assert variant not in await offered(maker, shops, "")
    assert await offered(maker, shops, concept, store=shops.child_store) == []

    # Found where the catalogue is corrected, and marked as retired.
    async with api(maker, manager(shops)) as client:
        found = await client.get(
            "/api/v1/catalog/models",
            params={"store_id": str(shops.primary_store), "query": concept},
        )
        shelf = await client.get(
            "/api/v1/catalog/stock-options",
            params={
                "store_id": str(shops.primary_store),
                "location_id": str(shops.shared_warehouse),
            },
        )
    assert found.status_code == 200, found.text
    assert found.json()["items"] == [
        {
            "product_variant_id": variant,
            "display_name": before["display_name"],
            "status": "RETIRED",
        }
    ]
    assert (await card(maker, shops, variant))["status"] == "RETIRED"
    # The till still offers what is on the shelf.
    assert shelf.status_code == 200, shelf.text
    assert [(i["product_variant_id"], i["quantity"]) for i in shelf.json()["items"]] == [
        (variant, 2)
    ]

    assert await status_of(maker, variant) == (EntityStatus.RETIRED, None)
    [correction] = await corrections_of(maker, variant)
    assert str(correction.id) == body["correction_id"]
    assert (correction.kind, correction.acting_store_id, correction.created_by_user_id) == (
        "RETIRE",
        shops.primary_store,
        shops.user_id,
    )
    assert correction.into_variant_id is None
    assert correction.details == {"status_before": "ACTIVE", "status_after": "RETIRED"}
    [audit] = await audits_of(maker, variant)
    assert (audit.action, audit.entity_type, audit.actor_user_id) == (
        "catalog.model_retire",
        "product_variant",
        shops.user_id,
    )
    assert audit.after["catalog_correction_id"] == body["correction_id"]
    assert audit.after["status_after"] == "RETIRED"


async def test_a_receipt_naming_a_retired_model_is_refused_and_nothing_lands(maker):
    """Carried out (business-rules.md): "'Not received' is a refusal." A
    receipt naming a retired model answers `MODEL_RETIRED`, with
    `recorded = false` (ADR-0008 §9), and the whole basket is refused: the
    active model received beside it does not land either."""
    shops = await make_two_shops(maker)
    variant, size = await a_coat(maker, shops, qty=2)
    other, other_size = await a_coat(maker, shops, qty=0)
    assert (
        await correct(maker, manager(shops), "retire", variant, store=shops.primary_store)
    ).status_code == 200
    command_id = uuid.uuid4()

    async with api(maker, shops.scope(shops.primary_store)) as client:
        alone = await receipt(client, shops, [(variant, size, 3)], command_id=command_id)
        mixed = await receipt(client, shops, [(other, other_size, 1), (variant, size, 1)])

    for refused in (alone, mixed):
        assert refused.status_code == 409, refused.text
        assert refused.json()["code"] == "MODEL_RETIRED"
        assert refused.json()["details"] == {"product_variant_id": variant, "recorded": False}
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2
        assert await quantity_at(session, shops.shared_warehouse, other, other_size) == 0
        assert (
            await session.scalar(
                select(func.count())
                .select_from(GoodsReceipt)
                .where(
                    GoodsReceipt.organization_id == shops.organization_id,
                    GoodsReceipt.command_id == command_id,
                )
            )
            == 0
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(StockLot)
                .where(StockLot.product_variant_id.in_([uuid.UUID(variant), uuid.UUID(other)]))
            )
            == 1
        )
        assert await find_divergences(session, organization_id=shops.organization_id) == []
    assert await ledger_of(maker, variant) == [(shops.shared_warehouse, "DELIVERY", None, 2)]
    assert await ledger_of(maker, other) == []


async def test_a_retired_model_s_stock_still_sells_returns_moves_and_is_written_off(maker):
    """Owner, 2026-10-03: "what is in stock may still be sold, returned or
    written off". Carried out: "a retired model's stock also moves between
    warehouses and is corrected after a count" (ADR-0008 §6). Only taking new
    goods in stops, so every one of these lands, and the ledger explains it."""
    shops = await make_two_shops(maker)
    variant, size = await a_coat(maker, shops, qty=6)
    assert (
        await correct(maker, manager(shops), "retire", variant, store=shops.primary_store)
    ).status_code == 200

    async with api(maker, shops.scope(shops.primary_store)) as client:
        sold = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size, qty=2),
            headers=key(),
        )
        assert sold.status_code == 201, sold.text
        returned = await client.post(
            f"/api/v1/sales/{sold.json()['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": sold.json()["items"][0]["id"],
                        "quantity": 1,
                        "restock": True,
                        "condition": "INTACT",
                    }
                ],
                "payment_method": "CASH",
            },
            headers=key(),
        )
        assert returned.status_code == 201, returned.text
    async with api(maker, manager(shops, shops.child_store)) as client:
        moved = await client.post(
            "/api/v1/transfers",
            json={
                "store_id": str(shops.child_store),
                "command_id": str(uuid.uuid4()),
                "from_location_id": str(shops.shared_warehouse),
                "to_location_id": str(shops.child_warehouse),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 1}],
            },
            headers=key(),
        )
        assert moved.status_code == 201, moved.text
        sold_there = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.child_store, shops.child_warehouse, variant, size, qty=1),
            headers=key(),
        )
        assert sold_there.status_code == 201, sold_there.text
    async with api(maker, manager(shops)) as client:
        for delta, reason in ((-1, "DAMAGED"), (1, "STOCKTAKE")):
            adjusted = await client.post(
                "/api/v1/inventory/adjustments",
                json={
                    "store_id": str(shops.primary_store),
                    "location_id": str(shops.shared_warehouse),
                    "command_id": str(uuid.uuid4()),
                    "product_variant_id": variant,
                    "size_id": size,
                    "quantity_delta": delta,
                    "reason_code": reason,
                },
                headers=key(),
            )
            assert adjusted.status_code == 201, adjusted.text

    shared, child = shops.shared_warehouse, shops.child_warehouse
    async with maker() as session:
        # 6 - 2 sold + 1 returned - 1 moved - 1 written off + 1 found = 4.
        assert await quantity_at(session, shared, variant, size) == 4
        assert await quantity_at(session, child, variant, size) == 0
        assert await find_divergences(session, organization_id=shops.organization_id) == []
    assert await ledger_of(maker, variant) == sorted(
        [
            (shared, "DELIVERY", None, 6),
            (shared, "SALE", None, -2),
            (shared, "REFUND_RETURN", None, 1),
            (shared, "TRANSFER_OUT", None, -1),
            (child, "TRANSFER_IN", None, 1),
            (child, "SALE", None, -1),
            (shared, "ADJUSTMENT", "DAMAGED", -1),
            (shared, "ADJUSTMENT", "STOCKTAKE", 1),
        ],
        key=lambda row: (str(row[0]), row[1], row[2] or "", row[3]),
    )
    # None of it brought the model back.
    assert await status_of(maker, variant) == (EntityStatus.RETIRED, None)


async def test_creating_a_retired_model_s_name_is_refused(maker):
    """Carried out (business-rules.md): creating a model whose name is a
    retired model's is refused (`MODEL_RETIRED`, naming it), so the app can
    offer to bring it back (ADR-0008 §4) — never a second model beside it,
    and never the retired one handed out as if it were received."""
    shops = await make_two_shops(maker)
    variant, _ = await a_coat(maker, shops, qty=0)
    family = (await card(maker, shops, variant))["product_family_id"]
    assert (
        await correct(maker, manager(shops), "retire", variant, store=shops.primary_store)
    ).status_code == 200

    def named(colour: str) -> dict[str, Any]:
        return {
            "store_id": str(shops.primary_store),
            "product_family_id": family,
            "variant": {"color": colour},
            "sizes": [{"system": "ALPHA", "code": "M"}],
        }

    async with api(maker, shops.scope(shops.primary_store)) as client:
        refused = await client.post(
            "/api/v1/catalog/products", json=named("шоколад"), headers=key()
        )
        confirmed = await client.post(
            "/api/v1/catalog/products",
            json=named("шоколад") | {"similar_confirmed": True},
            headers=key(),
        )
        another = await client.post("/api/v1/catalog/products", json=named("графіт"), headers=key())

    for answer in (refused, confirmed):
        assert answer.status_code == 409, answer.text
        assert answer.json()["code"] == "MODEL_RETIRED"
        assert answer.json()["details"] == {"product_variant_id": variant, "recorded": False}
    # Another colour in the family is another model, and is created.
    assert another.status_code == 201, another.text
    assert another.json()["variant_created"] is True
    async with maker() as session:
        in_family = (
            await session.execute(
                select(ProductVariant.id, ProductVariant.status).where(
                    ProductVariant.product_family_id == uuid.UUID(family)
                )
            )
        ).all()
    assert sorted((str(v), s) for v, s in in_family) == sorted(
        [
            (variant, EntityStatus.RETIRED),
            (another.json()["product_variant_id"], EntityStatus.ACTIVE),
        ]
    )


# ---------------------------------------------------------------------------
# 2. Bringing it back
# ---------------------------------------------------------------------------


async def test_a_model_brought_back_is_offered_and_received_again(maker):
    """Owner, 2026-10-03: "it can be brought back, and is offered again as
    before". The receipt refused while it was retired recorded nothing
    (`recorded = false`), so the very same command lands once it is back."""
    shops = await make_two_shops(maker)
    variant, size = await a_coat(maker, shops, qty=1)
    family = (await card(maker, shops, variant))["product_family_id"]
    concept = (await card(maker, shops, variant))["concept"]
    retired = await correct(maker, manager(shops), "retire", variant, store=shops.primary_store)
    assert retired.status_code == 200, retired.text
    command_id, headers = uuid.uuid4(), key()
    async with api(maker, shops.scope(shops.primary_store)) as client:
        early = await receipt(client, shops, [(variant, size, 3)], command_id=command_id)
    assert early.json()["code"] == "MODEL_RETIRED"

    restored = await correct(maker, manager(shops), "restore", variant, store=shops.primary_store)

    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert (body["kind"], body["status"], body["product_variant_id"]) == (
        "RESTORE",
        "ACTIVE",
        variant,
    )
    assert body["details"] == {"status_before": "RETIRED", "status_after": "ACTIVE"}
    assert body["correction_id"] not in (None, retired.json()["correction_id"])
    assert await status_of(maker, variant) == (EntityStatus.ACTIVE, None)
    assert await offered(maker, shops, concept) == [variant]
    assert (await card(maker, shops, variant))["status"] == "ACTIVE"

    async with api(maker, shops.scope(shops.primary_store)) as client:
        landed = await receipt(
            client, shops, [(variant, size, 3)], command_id=command_id, headers=headers
        )
        again = await client.post(
            "/api/v1/catalog/products",
            json={
                "store_id": str(shops.primary_store),
                "product_family_id": family,
                "variant": {"color": "шоколад"},
                "sizes": [{"system": "ALPHA", "code": "M"}],
            },
            headers=key(),
        )
    assert landed.status_code == 201, landed.text
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 4
    # Its name is its own again: the same model, not a new one.
    assert again.status_code == 201, again.text
    assert (again.json()["product_variant_id"], again.json()["variant_created"]) == (variant, False)

    assert [c.kind for c in await corrections_of(maker, variant)] == ["RETIRE", "RESTORE"]
    assert [a.action for a in await audits_of(maker, variant)] == [
        "catalog.model_retire",
        "catalog.model_restore",
    ]


async def test_retiring_a_retired_model_or_restoring_an_active_one_records_nothing(maker):
    """ADR-0008 §6, as a rename "that changes nothing is answered as it is":
    a second retirement is answered with the model as it stands,
    `correction_id` null, and no record or audit entry is written."""
    shops = await make_two_shops(maker)
    variant, _ = await a_coat(maker, shops, qty=0)

    active = await correct(maker, manager(shops), "restore", variant, store=shops.primary_store)
    first = await correct(maker, manager(shops), "retire", variant, store=shops.primary_store)
    second = await correct(maker, manager(shops), "retire", variant, store=shops.primary_store)

    assert first.status_code == 200, first.text
    assert first.json()["correction_id"] is not None
    for answer, kind, state in ((active, "RESTORE", "ACTIVE"), (second, "RETIRE", "RETIRED")):
        assert answer.status_code == 200, answer.text
        assert answer.json()["correction_id"] is None
        assert (answer.json()["kind"], answer.json()["status"]) == (kind, state)
        assert answer.json()["details"] == {}
    assert [c.kind for c in await corrections_of(maker, variant)] == ["RETIRE"]
    assert [a.action for a in await audits_of(maker, variant)] == ["catalog.model_retire"]
    assert await status_of(maker, variant) == (EntityStatus.RETIRED, None)


async def test_a_merged_model_is_neither_retired_nor_brought_back(maker):
    """ADR-0008 §6: "A merged model can be neither retired nor brought back."
    The answer is `MODEL_MERGED`, naming the model that stays, and changes
    nothing: the merged model keeps pointing at the model that stays."""
    shops = await make_two_shops(maker)
    duplicate, _ = await a_coat(maker, shops, qty=1)
    stays, _ = await a_coat(maker, shops, qty=0)
    async with api(maker, owner(shops)) as client:
        merged = await client.post(
            f"/api/v1/catalog/models/{duplicate}/merge",
            json=store_command(shops.primary_store) | {"into": stays},
            headers=key(),
        )
    assert merged.status_code == 200, merged.text

    answers = [
        await correct(maker, scope, action, duplicate, store=shops.primary_store)
        for scope in (manager(shops), owner(shops))
        for action in ("retire", "restore")
    ]

    for answer in answers:
        assert answer.status_code == 409, answer.text
        assert answer.json()["code"] == "MODEL_MERGED"
        assert answer.json()["details"] == {
            "product_variant_id": duplicate,
            "merged_into": stays,
            "recorded": False,
        }
    assert await status_of(maker, duplicate) == (EntityStatus.MERGED, uuid.UUID(stays))
    assert [c.kind for c in await corrections_of(maker, duplicate)] == ["MERGE"]


# ---------------------------------------------------------------------------
# Commands in flight (ADR-0008 §6, §9)
# ---------------------------------------------------------------------------


async def test_a_receipt_that_waited_behind_a_retirement_is_refused_and_records_nothing(
    maker, engine
):
    """ADR-0008 §6: "Retire and restore hold the variant `FOR UPDATE`, so a
    receipt in flight lands first or is refused." §9: the receipt's first
    statement holds the model `FOR KEY SHARE`, waits, and reads the row the
    retirement left — so it is refused `MODEL_RETIRED`, not received under a
    model that is no longer received. Proven with `pg_locks`, not timing."""
    shops = await make_two_shops(maker)
    variant, size = await a_coat(maker, shops, qty=1)
    command_id = uuid.uuid4()

    async def receives() -> httpx.Response:
        async with api(maker, shops.scope(shops.primary_store)) as client:
            return await receipt(client, shops, [(variant, size, 2)], command_id=command_id)

    async with maker() as holder:
        pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        await retire_model(
            holder,
            scope=manager(shops),
            store_id=shops.primary_store,
            product_variant_id=uuid.UUID(variant),
            command_id=uuid.uuid4(),
            fingerprint=uuid.uuid4().hex,
            correlation_id=None,
        )
        task = asyncio.create_task(receives())
        await wait_until_blocked_by(engine, pid)
        await holder.commit()
        refused = await asyncio.wait_for(task, timeout=20)

    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "MODEL_RETIRED"
    assert refused.json()["details"] == {"product_variant_id": variant, "recorded": False}
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 1
        assert (
            await session.scalar(
                select(func.count())
                .select_from(GoodsReceipt)
                .where(
                    GoodsReceipt.organization_id == shops.organization_id,
                    GoodsReceipt.command_id == command_id,
                )
            )
            == 0
        )
    assert await ledger_of(maker, variant) == [(shops.shared_warehouse, "DELIVERY", None, 1)]


async def test_a_retirement_waits_for_a_sale_in_flight_and_both_land(maker, engine):
    """ADR-0008 §9: "a command that holds a model before a [correction]
    commits first". A sale already holding the model is not undone by a
    retirement behind it; the retirement waits for it, then lands — and the
    coat is sold, since a retired model's stock still sells (owner)."""
    shops = await make_two_shops(maker)
    variant, size = await a_coat(maker, shops, qty=2)

    async def retires() -> httpx.Response:
        return await correct(maker, manager(shops), "retire", variant, store=shops.primary_store)

    async with maker() as holder:
        pid = await holder.scalar(text("SELECT pg_backend_pid()"))
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
        task = asyncio.create_task(retires())
        await wait_until_blocked_by(engine, pid)
        await holder.commit()
        retired = await asyncio.wait_for(task, timeout=20)

    assert retired.status_code == 200, retired.text
    assert retired.json()["status"] == "RETIRED"
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 1
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Sale)
                .where(Sale.organization_id == shops.organization_id)
            )
            == 1
        )
        assert await find_divergences(session, organization_id=shops.organization_id) == []
    assert await status_of(maker, variant) == (EntityStatus.RETIRED, None)


# ---------------------------------------------------------------------------
# 3. Opening lists
# ---------------------------------------------------------------------------


async def test_a_model_a_waiting_opening_list_names_is_not_retired(world: World):
    """Carried out (business-rules.md): "a model is not retired while an
    opening list that waits names it. The list could then never be approved,
    and its warehouse would stay waiting." Refused as `OPENING_LIST_WAITING`,
    naming the list; once the list is decided, the model is retired."""
    w = world
    async with w.client("owner") as client:
        snapshot = await imported(client, w)
        named = await resolve(
            client,
            snapshot["snapshot_id"],
            2,
            allocations=[allocation(w.bomber, w.sizes["M"], 2)],
            quantity_basis="STATED",
        )
        assert named.status_code == 200, named.text

        async def retire(variant: uuid.UUID) -> httpx.Response:
            return await client.post(
                f"/api/v1/catalog/models/{variant}/retire",
                json=store_command(w.main),
                headers=idempotent(),
            )

        refused = await retire(w.bomber)
        unnamed = await retire(w.bottega)
        rejected = await client.post(
            f"/api/v1/snapshots/{snapshot['snapshot_id']}/reject",
            json={"reason": "список переписуємо"},
        )
        assert rejected.status_code == 200, rejected.text
        decided = await retire(w.bomber)

    assert refused.status_code == 422, refused.text
    assert refused.json()["code"] == "VALIDATION_ERROR"
    assert refused.json()["details"] == {
        "reason": "OPENING_LIST_WAITING",
        "snapshot_ids": [snapshot["snapshot_id"]],
        # Refused after the command was looked up: nothing was recorded.
        "recorded": False,
    }
    # A model the list does not name is not held back by it.
    assert unnamed.status_code == 200, unnamed.text
    assert decided.status_code == 200, decided.text
    assert [c.kind for c in await corrections_of(w.maker, w.bomber)] == ["RETIRE"]
    assert await status_of(w.maker, w.bomber) == (EntityStatus.RETIRED, None)


async def test_an_opening_list_line_is_not_resolved_to_a_retired_or_merged_model(world: World):
    """ADR-0008 §5: resolving a line holds its models and refuses a merged or
    a retired one (`MODEL_MERGED` naming the model that stays,
    `MODEL_RETIRED`). The line keeps no answer; an active model resolves it."""
    w = world
    async with w.client("owner") as client:
        retired = await client.post(
            f"/api/v1/catalog/models/{w.bottega}/retire",
            json=store_command(w.main),
            headers=idempotent(),
        )
        assert retired.status_code == 200, retired.text
        merged = await client.post(
            f"/api/v1/catalog/models/{w.bomber}/merge",
            json=store_command(w.main) | {"into": str(w.coat)},
            headers=idempotent(),
        )
        assert merged.status_code == 200, merged.text
        snapshot = await imported(client, w)
        answers = {
            variant: await resolve(
                client,
                snapshot["snapshot_id"],
                2,
                allocations=[allocation(variant, w.sizes["M"], 2)],
                quantity_basis="STATED",
            )
            for variant in (w.bottega, w.bomber)
        }
        async with w.maker() as session:
            kept = await session.scalar(
                select(func.count())
                .select_from(InventorySnapshotAllocation)
                .join(
                    InventorySnapshotRow,
                    InventorySnapshotRow.id == InventorySnapshotAllocation.snapshot_row_id,
                )
                .where(
                    InventorySnapshotRow.inventory_snapshot_id == uuid.UUID(snapshot["snapshot_id"])
                )
            )
        active = await resolve(
            client,
            snapshot["snapshot_id"],
            2,
            allocations=[allocation(w.coat, w.sizes["M"], 2)],
            quantity_basis="STATED",
        )

    assert answers[w.bottega].status_code == 409, answers[w.bottega].text
    assert answers[w.bottega].json()["code"] == "MODEL_RETIRED"
    assert answers[w.bottega].json()["details"] == {
        "product_variant_id": str(w.bottega),
        "recorded": False,
    }
    assert answers[w.bomber].status_code == 409, answers[w.bomber].text
    assert answers[w.bomber].json()["code"] == "MODEL_MERGED"
    assert answers[w.bomber].json()["details"] == {
        "product_variant_id": str(w.bomber),
        "merged_into": str(w.coat),
        "recorded": False,
    }
    assert kept == 0
    assert active.status_code == 200, active.text


async def test_approving_a_list_whose_model_was_retired_after_resolving_names_the_line(
    world: World,
):
    """ADR-0008 §5: approval holds a list's models before the warehouse and
    "names the line whose model was merged or retired, so it can be resolved
    again" (`details.line_nos`). Nothing is applied.

    The retirement command itself cannot do this while the list waits (see
    above), so the state is written by hand: the approval's own guard is what
    is under test. Put right, the same list is approved."""
    w = world
    async with w.client("owner") as client:
        view = await prepared(client, w)
        snapshot_id = view["snapshot_id"]

        async with w.maker() as session:
            await session.execute(
                update(ProductVariant)
                .where(ProductVariant.id == w.bomber)
                .values(status=EntityStatus.RETIRED)
            )
            await session.commit()
        retired = await approve(client, snapshot_id, 3)

        async with w.maker() as session:
            await session.execute(
                update(ProductVariant)
                .where(ProductVariant.id == w.bomber)
                .values(status=EntityStatus.ACTIVE)
            )
            await session.execute(
                update(ProductVariant)
                .where(ProductVariant.id == w.coat)
                .values(status=EntityStatus.MERGED, merged_into_id=w.bottega)
            )
            await session.commit()
        merged = await approve(client, snapshot_id, 3)

        async with w.maker() as session:
            status = await session.scalar(
                select(InventorySnapshot.status).where(
                    InventorySnapshot.id == uuid.UUID(snapshot_id)
                )
            )
            opened = await session.scalar(
                select(func.count())
                .select_from(StockMovement)
                .where(
                    StockMovement.organization_id == w.org,
                    StockMovement.movement_type == MovementType.OPENING_BALANCE,
                )
            )
            await session.execute(
                update(ProductVariant)
                .where(ProductVariant.id == w.coat)
                .values(status=EntityStatus.ACTIVE, merged_into_id=None)
            )
            await session.commit()
        approved = await approve(client, snapshot_id, 3)
        # Applied, the list no longer waits: the model it named may retire.
        after = await client.post(
            f"/api/v1/catalog/models/{w.bomber}/retire",
            json=store_command(w.main),
            headers=idempotent(),
        )

    assert retired.status_code == 409, retired.text
    assert retired.json()["code"] == "MODEL_RETIRED"
    assert retired.json()["details"] == {
        "product_variant_id": str(w.bomber),
        "recorded": False,
        "line_nos": [2],
    }
    assert merged.status_code == 409, merged.text
    assert merged.json()["code"] == "MODEL_MERGED"
    assert merged.json()["details"] == {
        "product_variant_id": str(w.coat),
        "merged_into": str(w.bottega),
        "recorded": False,
        "line_nos": [1],
    }
    assert (status, opened) == (SnapshotStatus.IN_REVIEW, 0)
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPLIED"
    assert after.status_code == 200, after.text
    assert after.json()["status"] == "RETIRED"


# ---------------------------------------------------------------------------
# 4. Authority and command identity
# ---------------------------------------------------------------------------


async def test_a_seller_does_not_retire_and_a_manager_of_any_store_does(maker):
    """Owner, 2026-10-03: "the owner and managers correct the catalogue
    (`catalog:merge`). A seller creates models but does not correct them";
    "renaming, retiring and bringing back stay with a manager of any store".
    ADR-0008 §1: in the store the person acts in, and seen by every store."""
    shops = await make_two_shops(maker)
    variant, _ = await a_coat(maker, shops, qty=1)
    concept = (await card(maker, shops, variant))["concept"]
    seller = shops.scope(shops.primary_store)
    child_manager = manager(shops, shops.child_store)

    by_seller = await correct(maker, seller, "retire", variant, store=shops.primary_store)
    async with api(maker, seller) as client:
        seller_search = await client.get(
            "/api/v1/catalog/models", params={"store_id": str(shops.primary_store)}
        )
    elsewhere = await correct(maker, child_manager, "retire", variant, store=shops.primary_store)

    assert (by_seller.status_code, by_seller.json()["code"]) == (403, "PERMISSION_DENIED")
    assert by_seller.json()["details"]["permission"] == "catalog:merge"
    assert seller_search.status_code == 403
    # A manager of the child store acts in the child store, not the primary.
    assert (elsewhere.status_code, elsewhere.json()["code"]) == (403, "FORBIDDEN_STORE")
    assert await status_of(maker, variant) == (EntityStatus.ACTIVE, None)
    assert await corrections_of(maker, variant) == []

    retired = await correct(maker, child_manager, "retire", variant, store=shops.child_store)
    assert retired.status_code == 200, retired.text
    # Seen by every store: the primary store no longer receives it.
    assert await offered(maker, shops, concept) == []

    seller_restore = await correct(maker, seller, "restore", variant, store=shops.primary_store)
    assert (seller_restore.status_code, seller_restore.json()["code"]) == (
        403,
        "PERMISSION_DENIED",
    )
    assert await status_of(maker, variant) == (EntityStatus.RETIRED, None)

    restored = await correct(maker, manager(shops), "restore", variant, store=shops.primary_store)
    assert restored.status_code == 200, restored.text
    assert [(c.kind, c.acting_store_id) for c in await corrections_of(maker, variant)] == [
        ("RETIRE", shops.child_store),
        ("RESTORE", shops.primary_store),
    ]


async def test_another_organization_s_model_is_not_found(maker):
    """Invariant I12 and `hold_models`: "Unknown and foreign ids are one
    non-disclosing answer." A manager of one network neither retires nor
    brings back another network's model, nor learns that it exists."""
    ours = await make_two_shops(maker)
    theirs = await make_two_shops(maker)
    foreign, _ = await a_coat(maker, theirs, qty=1)

    answers = [
        await correct(maker, manager(ours), action, target, store=ours.primary_store)
        for action in ("retire", "restore")
        for target in (foreign, str(uuid.uuid4()))
    ]
    async with api(maker, manager(ours)) as client:
        opened = await client.get(
            f"/api/v1/catalog/models/{foreign}", params={"store_id": str(ours.primary_store)}
        )

    assert [(a.status_code, a.json()["code"]) for a in answers] == [(404, "NOT_FOUND")] * 4
    assert answers[0].json() == answers[1].json()
    assert opened.status_code == 404
    assert await status_of(maker, foreign) == (EntityStatus.ACTIVE, None)
    assert await corrections_of(maker, foreign) == []


async def test_a_retirement_is_one_command_however_often_it_is_sent(maker):
    """ADR-0008 §1 (I20): "the same command is answered with what it did;
    another request under the same id is `IDEMPOTENCY_CONFLICT`". A late
    retry after the model was brought back answers the retirement it made,
    and does not retire the model a second time."""
    shops = await make_two_shops(maker)
    variant, _ = await a_coat(maker, shops, qty=0)
    other, _ = await a_coat(maker, shops, qty=0)
    command_id, headers = uuid.uuid4(), key()
    scope = manager(shops)

    first = await correct(
        maker,
        scope,
        "retire",
        variant,
        store=shops.primary_store,
        command_id=command_id,
        headers=headers,
    )
    cached = await correct(
        maker,
        scope,
        "retire",
        variant,
        store=shops.primary_store,
        command_id=command_id,
        headers=headers,
    )
    durable = await correct(
        maker, scope, "retire", variant, store=shops.primary_store, command_id=command_id
    )
    assert first.status_code == 200, first.text
    assert cached.status_code == durable.status_code == 200
    assert cached.json() == durable.json() == first.json()

    assert (
        await correct(maker, scope, "restore", variant, store=shops.primary_store)
    ).status_code == 200
    late = await correct(
        maker, scope, "retire", variant, store=shops.primary_store, command_id=command_id
    )
    assert late.status_code == 200, late.text
    assert late.json() == first.json()
    assert await status_of(maker, variant) == (EntityStatus.ACTIVE, None)

    conflicts = [
        await correct(
            maker, scope, "restore", variant, store=shops.primary_store, command_id=command_id
        ),
        await correct(
            maker, scope, "retire", other, store=shops.primary_store, command_id=command_id
        ),
        # The same key, with another command behind it.
        await correct(maker, scope, "retire", variant, store=shops.primary_store, headers=headers),
    ]
    for conflict in conflicts:
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert await status_of(maker, variant) == (EntityStatus.ACTIVE, None)
    assert await status_of(maker, other) == (EntityStatus.ACTIVE, None)
    assert [(c.kind, c.command_id == command_id) for c in await corrections_of(maker, variant)] == [
        ("RETIRE", True),
        ("RESTORE", False),
    ]
    assert await corrections_of(maker, other) == []


async def test_a_retirement_replay_is_refused_once_the_grant_is_gone(maker):
    """Invariant I13 (milestone-1-plan.md): a command "must be refused before
    it claims an idempotency key or replays a stored response, so a revoked
    grant cannot keep returning an old success". Only `catalog:merge` goes,
    so `require_store` cannot be what refuses."""
    shops = await make_two_shops(maker)
    variant, _ = await a_coat(maker, shops, qty=0)
    command_id, headers = uuid.uuid4(), key()
    first = await correct(
        maker,
        manager(shops),
        "retire",
        variant,
        store=shops.primary_store,
        command_id=command_id,
        headers=headers,
    )
    assert first.status_code == 200, first.text
    revoked = replace(
        manager(shops),
        store_permissions={shops.primary_store: MANAGER - {Permission.CATALOG_MERGE}},
    )

    durable = await correct(
        maker, revoked, "retire", variant, store=shops.primary_store, command_id=command_id
    )
    cached = await correct(
        maker,
        revoked,
        "retire",
        variant,
        store=shops.primary_store,
        command_id=command_id,
        headers=headers,
    )

    assert (durable.status_code, durable.json().get("code")) == (403, "PERMISSION_DENIED")
    assert (cached.status_code, cached.json().get("code")) == (403, "PERMISSION_DENIED"), (
        cached.text
    )


# ---------------------------------------------------------------------------
# 5. The ledger's door
# ---------------------------------------------------------------------------


def leg(
    reason: MovementReason,
    variant: uuid.UUID,
    delta: int,
    *,
    correction: uuid.UUID,
    location: uuid.UUID,
    size: uuid.UUID,
    store: uuid.UUID | None = None,
    **changes: Any,
) -> MovementRequest:
    """One half of a merge, as `apply_catalog_merge` writes it."""
    fields: dict[str, Any] = {
        "location_id": location,
        "acting_store_id": store or uuid.uuid4(),
        "product_variant_id": variant,
        "size_id": size,
        "quantity_delta": delta,
        "movement_type": MovementType.ADJUSTMENT,
        "reason_code": reason,
        "reference_type": CATALOG_CORRECTION_REFERENCE,
        "reference_id": correction,
    }
    return MovementRequest(**(fields | changes))


OUT, IN = MovementReason.CATALOG_MERGE_OUT, MovementReason.CATALOG_MERGE_IN
A, B, C = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
HERE, THERE = uuid.uuid4(), uuid.uuid4()
SIZE_M, SIZE_L = uuid.uuid4(), uuid.uuid4()
FIX, OTHER_FIX = uuid.uuid4(), uuid.uuid4()


def pair(
    duplicate: uuid.UUID = A,
    stays: uuid.UUID = B,
    n: int = 2,
    *,
    location: uuid.UUID = HERE,
    size: uuid.UUID = SIZE_M,
    correction: uuid.UUID = FIX,
) -> list[MovementRequest]:
    where = {"correction": correction, "location": location, "size": size}
    return [leg(OUT, duplicate, -n, **where), leg(IN, stays, n, **where)]


WHERE = {"correction": FIX, "location": HERE, "size": SIZE_M}

# The refusal each basket must meet: its own rule, not a neighbour's. A leg
# naming no correction would otherwise also be "two corrections", and a check
# could be deleted without a single case noticing.
ONLY_THE_MERGE = "basket holds only the merge's own movements"
NAMES_ITS_CORRECTION = "is an adjustment that names its correction"
DIRECTION = "takes stock out of the duplicate and puts it into the model that stays"
ONE_CORRECTION = "movements name one correction"
ONE_PAIR = "moves each warehouse and size as one pair, out and in"
EQUAL = "must put in exactly what it takes out"
TWO_MODELS = "moves one model's stock to another model"

REFUSED_BASKETS: dict[str, tuple[list[MovementRequest], str]] = {
    "an OUT without its IN": ([leg(OUT, A, -2, **WHERE)], ONE_PAIR),
    "an IN without its OUT": ([leg(IN, B, 2, **WHERE)], ONE_PAIR),
    "unequal magnitudes": ([leg(OUT, A, -2, **WHERE), leg(IN, B, 3, **WHERE)], EQUAL),
    "both legs on one model": (pair(A, A), TWO_MODELS),
    "mixed with a sale": (
        [
            *pair(),
            MovementRequest(
                location_id=HERE,
                acting_store_id=uuid.uuid4(),
                product_variant_id=C,
                size_id=SIZE_M,
                quantity_delta=-1,
                movement_type=MovementType.SALE,
            ),
        ],
        ONLY_THE_MERGE,
    ),
    "an OUT that adds stock": ([leg(OUT, A, 2, **WHERE), leg(IN, B, -2, **WHERE)], DIRECTION),
    "an IN that takes stock": ([leg(OUT, A, -2, **WHERE), leg(IN, B, -2, **WHERE)], DIRECTION),
    "a leg naming a stock adjustment": (
        [leg(OUT, A, -2, **WHERE), leg(IN, B, 2, **WHERE, reference_type="stock_adjustment")],
        NAMES_ITS_CORRECTION,
    ),
    "a leg naming no correction": (
        [leg(OUT, A, -2, **WHERE, reference_id=None), leg(IN, B, 2, **WHERE)],
        NAMES_ITS_CORRECTION,
    ),
    "a leg carrying a lot": (
        [leg(OUT, A, -2, **WHERE, stock_lot_id=uuid.uuid4()), leg(IN, B, 2, **WHERE)],
        NAMES_ITS_CORRECTION,
    ),
    "a leg that is a count, not an adjustment": (
        [
            leg(OUT, A, -2, **WHERE),
            leg(IN, B, 2, **WHERE, movement_type=MovementType.STOCKTAKE_CORRECTION),
        ],
        NAMES_ITS_CORRECTION,
    ),
    "two corrections in one basket": (
        [*pair(), *pair(size=SIZE_L, correction=OTHER_FIX)],
        ONE_CORRECTION,
    ),
    "two OUTs of one key": (
        [leg(OUT, A, -1, **WHERE), leg(OUT, A, -1, **WHERE), leg(IN, B, 2, **WHERE)],
        ONE_PAIR,
    ),
    "two duplicates into one model": ([*pair(A, B), *pair(C, B, size=SIZE_L)], TWO_MODELS),
    "one duplicate into two models": ([*pair(A, B), *pair(A, C, size=SIZE_L)], TWO_MODELS),
}


@pytest.mark.parametrize(("basket", "rule"), REFUSED_BASKETS.values(), ids=REFUSED_BASKETS.keys())
def test_the_door_refuses_anything_but_a_merge_s_own_pairs(basket, rule):
    """ADR-0008 §3: "per warehouse and size one OUT and one IN, equal and
    opposite, on two different models, of the same correction", each an
    `ADJUSTMENT` naming it, with no lot, and nothing else in the basket."""
    with pytest.raises(ValidationFailedError) as refused:
        validate_catalog_merges(basket)
    assert refused.value.code == "VALIDATION_ERROR"
    assert rule in refused.value.message


@pytest.mark.parametrize(
    "basket",
    [
        pair(),
        # Every warehouse and size the duplicate holds, one pair each.
        [*pair(n=1), *pair(n=4, size=SIZE_L), *pair(n=3, location=THERE)],
        # A basket with no merge reason is not the merge's business.
        [
            MovementRequest(
                location_id=HERE,
                acting_store_id=uuid.uuid4(),
                product_variant_id=A,
                size_id=SIZE_M,
                quantity_delta=-1,
                movement_type=MovementType.SALE,
            )
        ],
    ],
    ids=["one pair", "a pair per warehouse and size", "no merge at all"],
)
def test_the_door_lets_a_merge_s_own_pairs_through(basket):
    """The same door lets the merge's own baskets through untouched."""
    validate_catalog_merges(basket)


@pytest.mark.parametrize("legs", ["OUT", "IN", "PAIR"])
async def test_only_a_merge_writes_the_merge_reasons(maker, legs):
    """ADR-0008 §3: "Only the merge writes these reasons. `apply_movements`
    refuses them, as it refuses an opening balance" — even a well-formed
    pair, which only `apply_catalog_merge` may write under its hold on both
    models. Nothing moves."""
    shops = await make_two_shops(maker)
    duplicate, size = await a_coat(maker, shops, qty=2)
    stays, _ = await a_coat(maker, shops, qty=0)
    built = pair(
        uuid.UUID(duplicate),
        uuid.UUID(stays),
        location=shops.shared_warehouse,
        size=uuid.UUID(size),
        correction=uuid.uuid4(),
    )
    built = [replace(request, acting_store_id=shops.primary_store) for request in built]
    basket = {"OUT": built[:1], "IN": built[1:], "PAIR": built}[legs]

    async with maker() as session:
        with pytest.raises(ValidationFailedError) as refused:
            await apply_movements(
                session,
                organization_id=shops.organization_id,
                requests=basket,
                actor_user_id=shops.user_id,
            )
        await session.rollback()

    assert refused.value.details["reason_code"] in {"CATALOG_MERGE_OUT", "CATALOG_MERGE_IN"}
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, duplicate, size) == 2
        assert await quantity_at(session, shops.shared_warehouse, stays, size) == 0
    assert await ledger_of(maker, duplicate) == [(shops.shared_warehouse, "DELIVERY", None, 2)]
    assert await ledger_of(maker, stays) == []


async def test_the_door_itself_checks_the_pair_not_only_its_caller(maker):
    """ADR-0008 §3: "the pairs are checked at the door, as transfers and size
    reclassifications are", so "totals never change" does not rest on the
    caller. A lone OUT handed to the ledger's own door would otherwise take
    two coats out of the network with nothing put back."""
    shops = await make_two_shops(maker)
    duplicate, size = await a_coat(maker, shops, qty=2)
    lone = leg(
        OUT,
        uuid.UUID(duplicate),
        -2,
        correction=uuid.uuid4(),
        location=shops.shared_warehouse,
        size=uuid.UUID(size),
        store=shops.primary_store,
    )

    async with maker() as session:
        with pytest.raises(ValidationFailedError):
            await _apply_movements(
                session,
                organization_id=shops.organization_id,
                requests=[lone],
                actor_user_id=shops.user_id,
                correlation_id=None,
            )
        await session.rollback()

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, duplicate, size) == 2
    assert await ledger_of(maker, duplicate) == [(shops.shared_warehouse, "DELIVERY", None, 2)]


@pytest.mark.parametrize(
    ("movement_type", "reason", "reference_type", "names_it", "accepted"),
    [
        ("ADJUSTMENT", "CATALOG_MERGE_IN", "catalog_correction", True, True),
        ("ADJUSTMENT", "CATALOG_MERGE_OUT", "catalog_correction", True, True),
        ("ADJUSTMENT", "CATALOG_MERGE_IN", "stock_adjustment", True, False),
        ("ADJUSTMENT", "CATALOG_MERGE_IN", None, False, False),
        ("ADJUSTMENT", "CATALOG_MERGE_OUT", "catalog_correction", False, False),
        ("STOCKTAKE_CORRECTION", "CATALOG_MERGE_IN", "catalog_correction", True, False),
        ("DELIVERY", "CATALOG_MERGE_IN", "catalog_correction", True, False),
    ],
)
async def test_the_database_ties_a_merge_movement_to_its_correction(
    maker, movement_type, reason, reference_type, names_it, accepted
):
    """ADR-0008 §3, §11: "A database CHECK ties both reasons to `ADJUSTMENT`
    and to `reference_type = 'catalog_correction'`", so a raw INSERT that
    skips the door is refused as well. The well-formed rows are inserted and
    rolled back, to show the CHECK refuses only what it should."""
    shops = await make_two_shops(maker)
    variant, size = await a_coat(maker, shops, qty=0)
    insert = text(
        "INSERT INTO stock_movement (id, organization_id, location_id, acting_store_id, "
        "product_variant_id, size_id, movement_type, quantity_delta, reason_code, "
        "reference_type, reference_id, created_at) VALUES (:id, :org, :location, :store, "
        ":variant, :size, CAST(:movement_type AS movement_type), 1, "
        "CAST(:reason AS movement_reason), :reference_type, :reference_id, now())"
    )
    values = {
        "id": uuid.uuid4(),
        "org": shops.organization_id,
        "location": shops.shared_warehouse,
        "store": shops.primary_store,
        "variant": uuid.UUID(variant),
        "size": uuid.UUID(size),
        "movement_type": movement_type,
        "reason": reason,
        "reference_type": reference_type,
        "reference_id": uuid.uuid4() if names_it else None,
    }

    async with maker() as session:
        if accepted:
            await session.execute(insert, values)
        else:
            with pytest.raises(IntegrityError) as refused:
                await session.execute(insert, values)
            assert MERGE_CHECK in str(refused.value)
        await session.rollback()
    assert await ledger_of(maker, variant) == []


# ---------------------------------------------------------------------------
# 6. A merged model gives up its name
# ---------------------------------------------------------------------------


async def test_only_a_merged_model_shares_its_name_with_a_live_one(maker):
    """ADR-0008 §4: `uq_product_variant_attributes` is a partial unique index,
    `NULLS NOT DISTINCT … WHERE status <> 'MERGED'`. Two models of one name in
    one family are refused by the database whatever their live status
    (active, retired, in review); a merged one keeps its words beside a live
    one, as often as merges left them."""
    shops = await make_two_shops(maker)
    variant, _ = await a_coat(maker, shops, qty=0)
    async with maker() as session:
        named = await session.get(ProductVariant, uuid.UUID(variant))
        assert named is not None
        name = {
            column: getattr(named, column)
            for column in (
                "product_family_id",
                "color_term_id",
                "material_term_id",
                "texture_term_id",
                "fur_term_id",
                "collar_term_id",
                "length_cm",
            )
        }

    for status in (EntityStatus.ACTIVE, EntityStatus.RETIRED, EntityStatus.NEEDS_REVIEW):
        async with maker() as session:
            session.add(ProductVariant(**name, status=status))
            with pytest.raises(IntegrityError, match="uq_product_variant_attributes"):
                await session.flush()
            await session.rollback()

    async with maker() as session:
        merged = [
            ProductVariant(**name, status=EntityStatus.MERGED, merged_into_id=uuid.UUID(variant))
            for _ in range(2)
        ]
        session.add_all(merged)
        await session.commit()

    async with maker() as session:
        holders = (
            await session.execute(
                select(ProductVariant.status, func.count())
                .where(ProductVariant.product_family_id == name["product_family_id"])
                .group_by(ProductVariant.status)
            )
        ).all()
    assert dict(holders) == {EntityStatus.ACTIVE: 1, EntityStatus.MERGED: 2}


# ---------------------------------------------------------------------------
# 7. Migration 0031, in a database of the test's own
# ---------------------------------------------------------------------------


@pytest.fixture
async def scratch() -> AsyncIterator[str]:
    name = f"birka_retire_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    try:
        yield name
    finally:
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def _sql(database: str, *statements: tuple[str, dict]) -> list:
    engine = await _engine(database)
    results = []
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as s:
            for statement, parameters in statements:
                result = await s.execute(text(statement), parameters)
                results.append(result.scalar_one_or_none() if result.returns_rows else None)
            await s.commit()
    finally:
        await engine.dispose()
    return results


async def _shape(database: str) -> dict[str, Any]:
    """What `0031` adds, read from the catalogue of the database itself."""
    version, table, merge_check, target_check, key_kind, key_def, retired_label = await _sql(
        database,
        ("SELECT version_num FROM alembic_version", {}),
        ("SELECT to_regclass('catalog_correction') IS NOT NULL", {}),
        ("SELECT count(*) FROM pg_constraint WHERE conname = :name", {"name": MERGE_CHECK}),
        (
            "SELECT count(*) FROM pg_constraint "
            "WHERE conname = 'ck_product_variant_merged_requires_target'",
            {},
        ),
        (
            "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_constraint "
            "WHERE conname = 'uq_product_variant_attributes' AND contype = 'u') "
            "THEN 'constraint' ELSE 'index' END",
            {},
        ),
        ("SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_product_variant_attributes'", {}),
        (
            "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
            "WHERE t.typname = 'catalog_entity_status' AND e.enumlabel = 'RETIRED'",
            {},
        ),
    )
    return {
        "version": version,
        "table": table,
        "merge_check": merge_check,
        "target_check": target_check,
        "key": key_kind,
        "partial": "WHERE" in key_def and "MERGED" in key_def,
        "nulls_not_distinct": "NULLS NOT DISTINCT" in key_def,
        "retired_label": retired_label,
    }


# At `0031` itself, whatever revision is newest: these test what it does.
AT_CORRECTION = {
    "version": CORRECTION,
    "table": True,
    "merge_check": 1,
    "target_check": 1,
    "key": "index",
    "partial": True,
    "nulls_not_distinct": True,
    "retired_label": 1,
}


async def test_0031_goes_up_down_and_up_again_on_an_empty_database(scratch):
    """ADR-0008 §11. Down, it restores the unique constraint and drops what it
    added; the enum labels stay, as `0010`'s and `0026`'s do."""
    config = _alembic(scratch)
    await _run(config, "upgrade", CORRECTION, database=scratch)
    assert await _shape(scratch) == AT_CORRECTION

    await _run(config, "downgrade", BEFORE, database=scratch)
    assert await _shape(scratch) == {
        "version": BEFORE,
        "table": False,
        "merge_check": 0,
        "target_check": 0,
        "key": "constraint",
        "partial": False,
        "nulls_not_distinct": True,
        "retired_label": 1,
    }

    await _run(config, "upgrade", CORRECTION, database=scratch)
    assert await _shape(scratch) == AT_CORRECTION


async def _seed_model(database: str) -> dict:
    """An organization with one store, one person and one model. Raw SQL,
    valid at `0030` and at `0031` alike: the ORM describes the schema after
    `0031`, and a fixture that could only exist after it proves nothing about
    what the migration has to carry."""
    ids = {name: uuid.uuid4() for name in ("org", "store", "user", "concept", "family")}
    ids |= {"variant": uuid.uuid4(), "other": uuid.uuid4(), "telegram": uuid.uuid4().int % 2**62}
    statements = [
        (
            "INSERT INTO organization (id, name, currency_code) VALUES (:org, :name, 'UAH')",
            {"org": ids["org"], "name": f"org-{ids['org'].hex[:8]}"},
        ),
        (
            "INSERT INTO store (id, organization_id, name, code, kind) "
            "VALUES (:store, :org, 'Основний', 'MAIN', 'PRIMARY')",
            ids,
        ),
        (
            "INSERT INTO app_user (id, telegram_user_id, display_name) "
            "VALUES (:user, :telegram, 'Оля')",
            ids,
        ),
        (
            "INSERT INTO canonical_concept (id, organization_id, name, normalized_name) "
            "VALUES (:concept, :org, 'Лоран', 'лоран')",
            ids,
        ),
        (
            "INSERT INTO product_family (id, organization_id, canonical_concept_id) "
            "VALUES (:family, :org, :concept)",
            ids,
        ),
        (
            "INSERT INTO product_variant (id, product_family_id, length_cm) "
            "VALUES (:variant, :family, 70)",
            ids,
        ),
    ]
    await _sql(database, *statements)
    return ids


async def _correction(database: str, ids: dict, action: str) -> None:
    """Retire or bring back the seeded model through the command itself."""
    engine = await _engine(database)
    scope = RequestScope(
        user_id=ids["user"],
        organization_id=ids["org"],
        org_permissions=OWNER,
        store_permissions={ids["store"]: frozenset()},
    )
    work = {"retire": retire_model, "restore": restore_model}[action]
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            await work(
                session,
                scope=scope,
                store_id=ids["store"],
                product_variant_id=ids["variant"],
                command_id=uuid.uuid4(),
                fingerprint=uuid.uuid4().hex,
                correlation_id=None,
            )
            await session.commit()
    finally:
        await engine.dispose()


async def test_0031_does_not_go_down_over_a_retired_model_or_a_recorded_correction(scratch):
    """ADR-0008 §11: "The downgrade refuses while any of these exist: a
    variant that is `RETIRED`; a merge movement; a recorded correction". A
    rollback must never quietly forget a retirement or a merge. Refused, the
    schema stays at `0031` with its record intact."""
    config = _alembic(scratch)
    await _run(config, "upgrade", CORRECTION, database=scratch)
    ids = await _seed_model(scratch)

    await _correction(scratch, ids, "retire")
    with pytest.raises(Exception, match=r">: Cannot downgrade: a model is retired"):
        await _run(config, "downgrade", BEFORE, database=scratch)
    assert await _shape(scratch) == AT_CORRECTION

    # Brought back, nothing is retired; the two corrections still stand.
    await _correction(scratch, ids, "restore")
    with pytest.raises(Exception, match=r">: Cannot downgrade: corrections of the catalogue"):
        await _run(config, "downgrade", BEFORE, database=scratch)
    assert await _shape(scratch) == AT_CORRECTION
    assert await _sql(
        scratch,
        ("SELECT string_agg(kind, ',' ORDER BY created_at, kind) FROM catalog_correction", {}),
        ("SELECT status::text FROM product_variant WHERE id = :id", {"id": ids["variant"]}),
    ) == ["RETIRE,RESTORE", "ACTIVE"]


async def test_a_recorded_correction_is_never_changed_or_deleted(scratch):
    """ADR-0008 §1: `catalog_correction` is append-only, as the ledger and
    the audit log are: the database refuses to change or delete a row, the
    answer it gave included."""
    config = _alembic(scratch)
    await _run(config, "upgrade", CORRECTION, database=scratch)
    ids = await _seed_model(scratch)
    await _correction(scratch, ids, "retire")
    for statement in (
        "UPDATE catalog_correction SET name_after = 'інша назва'",
        "UPDATE catalog_correction SET response_snapshot = NULL",
        "DELETE FROM catalog_correction",
    ):
        with pytest.raises(Exception, match="is append-only"):
            await _sql(scratch, (statement, {}))
    assert await _sql(scratch, ("SELECT count(*) FROM catalog_correction", {})) == [1]


async def test_0031_does_not_go_down_over_a_merge_in_the_ledger(scratch):
    """ADR-0008 §11: the downgrade refuses while the ledger holds a merge's
    movement — "no other reason means the same thing" — even with no model
    retired and no correction left to point at it."""
    config = _alembic(scratch)
    await _run(config, "upgrade", CORRECTION, database=scratch)
    ids = await _seed_model(scratch)
    ids |= {name: uuid.uuid4() for name in ("location", "system", "size", "movement")}
    await _sql(
        scratch,
        (
            "INSERT INTO stock_location (id, organization_id, code, name) "
            "VALUES (:location, :org, 'WH', 'Склад')",
            ids,
        ),
        (
            "INSERT INTO size_system (id, organization_id, code, name) "
            "VALUES (:system, :org, 'ALPHA', 'Alpha')",
            ids,
        ),
        ("INSERT INTO size (id, size_system_id, code) VALUES (:size, :system, 'M')", ids),
        (
            "INSERT INTO stock_movement (id, organization_id, location_id, acting_store_id, "
            "product_variant_id, size_id, movement_type, quantity_delta, reason_code, "
            "reference_type, reference_id) VALUES (:movement, :org, :location, :store, "
            ":variant, :size, 'ADJUSTMENT', 1, 'CATALOG_MERGE_IN', 'catalog_correction', "
            ":movement)",
            ids,
        ),
    )

    with pytest.raises(Exception, match=r">: Cannot downgrade: the ledger records a merge"):
        await _run(config, "downgrade", BEFORE, database=scratch)
    assert await _shape(scratch) == AT_CORRECTION


@pytest.mark.parametrize(
    "hand_written",
    [
        "UPDATE product_variant SET status = 'MERGED' WHERE id = :variant",
        "UPDATE product_variant SET merged_into_id = :variant WHERE id = :other",
    ],
    ids=["merged without a target", "a target without being merged"],
)
async def test_0031_does_not_go_up_over_a_model_merged_by_hand(scratch, hand_written):
    """ADR-0008 §3, §11: `merged_requires_target` is added, and a row that
    breaks it "cannot be given the model it was merged into without a person".
    The upgrade refuses with a message that says so, stays at `0030`, and
    goes through once the row is put right."""
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    ids = await _seed_model(scratch)
    await _sql(
        scratch,
        (
            "INSERT INTO product_variant (id, product_family_id, length_cm) "
            "VALUES (:other, :family, 80)",
            ids,
        ),
        (hand_written, ids),
    )

    with pytest.raises(Exception, match=r">: Cannot upgrade: a model is marked merged"):
        await _run(config, "upgrade", CORRECTION, database=scratch)
    assert (await _shape(scratch))["version"] == BEFORE
    assert (await _shape(scratch))["table"] is False

    await _sql(
        scratch,
        (
            "UPDATE product_variant SET status = 'ACTIVE', merged_into_id = NULL "
            "WHERE id IN (:variant, :other)",
            ids,
        ),
    )
    await _run(config, "upgrade", CORRECTION, database=scratch)
    assert await _shape(scratch) == AT_CORRECTION
