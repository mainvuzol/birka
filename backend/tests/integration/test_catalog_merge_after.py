"""After a merge the duplicate leads to the model that stays, everywhere
(owner decision, 2026-10-03 — correcting the catalogue; ADR-0008 §4, §5, §9),
over HTTP against real PostgreSQL.

The owner's words: "afterwards the duplicate leads to the model that stays
everywhere: goods from an old sale of the duplicate come back as the model
that stays; «Звіт» counts the two as one; searching the old name finds the
model that stays". And, how it is carried out: what reopens after a merge
(a cancelled supplier return, a cancelled invoice of borrowed goods) goes to
the model that stays, while the lot, the sale line and the return keep
naming what they named.

Covered here:
- stock commands naming the duplicate are refused `MODEL_MERGED`, naming the
  model that stays, and record nothing;
- a till return of an old sale of the duplicate restocks the model that stays,
  and a damaged one registers its «Брак» unit as it;
- a supplier return cancelled after the merge, and a borrowed lot reopened
  after it, come back and go out as the model that stays;
- «Звіт» counts the two as one line, named by the current name;
- receiving's search, the catalogue search, creating the name again and the
  matcher all lead to the model that stays;
- a command made before the merge, sent again after it, is answered with
  what it did;
- no stock is ever left under a merged model: after a chain of merges, when
  a receipt or a stock correction waits on the merge's hold on the
  duplicate, when a stock command holds the duplicate first, and when a sale
  races the merge.

All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from app.modules.catalog.models import (
    CatalogCorrection,
    EntityStatus,
    ProductFamily,
    ProductVariant,
)
from app.modules.damaged.models import DamagedUnit
from app.modules.inventory.models import (
    GoodsReceipt,
    Inventory,
    MovementReason,
    MovementType,
    StockAdjustment,
    StockLot,
    StockMovement,
)
from app.modules.inventory.service import find_divergences, stock_under_merged_models
from app.modules.refunds.models import RefundItem
from app.modules.sales.models import Sale, SaleItem
from app.modules.suppliers.models import SupplierReturnLine
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
from tests.integration.test_supplier_returns import cancel, document, send, supplier
from tests.integration.test_till_returns import give_bin

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


@dataclass(frozen=True, slots=True)
class Pair:
    """A model that stays, and its duplicate: a typo in the colour, in the
    same family, so typing the duplicate's whole name reaches the same tuple."""

    stay: str
    duplicate: str
    size: str
    family: str
    concept: str
    stay_name: str
    duplicate_name: str


async def create_model(
    client: httpx.AsyncClient,
    store: uuid.UUID,
    *,
    color: str,
    concept: str | None = None,
    family: str | None = None,
    sizes: tuple[str, ...] = ("M",),
    similar_confirmed: bool = False,
) -> httpx.Response:
    return await client.post(
        "/api/v1/catalog/products",
        json={
            "store_id": str(store),
            **({"concept": concept} if concept else {"product_family_id": family}),
            "variant": {"color": color},
            "sizes": [{"system": "ALPHA", "code": code} for code in sizes],
            "similar_confirmed": similar_confirmed,
        },
        headers=key(),
    )


def receipt_body(
    store: uuid.UUID, warehouse: uuid.UUID, variant: str, size: str, qty: int
) -> dict[str, Any]:
    return {
        "store_id": str(store),
        "location_id": str(warehouse),
        "command_id": str(uuid.uuid4()),
        "lines": [{"product_variant_id": variant, "size_id": size, "quantity": qty}],
    }


async def receive(
    maker: async_sessionmaker[AsyncSession],
    shops: TwoShops,
    variant: str,
    size: str,
    qty: int,
    *,
    store: uuid.UUID | None = None,
    warehouse: uuid.UUID | None = None,
) -> httpx.Response:
    store = store or shops.primary_store
    async with api(maker, shops.scope(store)) as client:
        return await client.post(
            "/api/v1/inventory/receipts",
            json=receipt_body(store, warehouse or shops.shared_warehouse, variant, size, qty),
            headers=key(),
        )


async def a_pair(
    maker: async_sessionmaker[AsyncSession],
    shops: TwoShops,
    *,
    stay_qty: int = 2,
    duplicate_qty: int = 3,
) -> Pair:
    """Both models in the shared warehouse, size M, as the primary store."""
    concept = f"Лоран-{uuid.uuid4().hex[:8]}"
    async with api(maker, shops.scope(shops.primary_store)) as client:
        stay = await create_model(client, shops.primary_store, concept=concept, color="шоколад")
        assert stay.status_code == 201, stay.text
        family = stay.json()["product_family_id"]
        # The typo may already be one a merge in this organization left
        # behind; the person says this is another model.
        duplicate = await create_model(
            client, shops.primary_store, family=family, color="шокалад", similar_confirmed=True
        )
        assert duplicate.status_code == 201, duplicate.text
    assert duplicate.json()["variant_created"] is True
    size = str(stay.json()["sizes"][0]["size_id"])
    assert str(duplicate.json()["sizes"][0]["size_id"]) == size
    pair = Pair(
        stay=str(stay.json()["product_variant_id"]),
        duplicate=str(duplicate.json()["product_variant_id"]),
        size=size,
        family=family,
        concept=concept,
        stay_name=stay.json()["display_name"],
        duplicate_name=duplicate.json()["display_name"],
    )
    for variant, qty in ((pair.stay, stay_qty), (pair.duplicate, duplicate_qty)):
        if qty:
            received = await receive(maker, shops, variant, size, qty)
            assert received.status_code == 201, received.text
    return pair


async def merge(
    maker: async_sessionmaker[AsyncSession],
    shops: TwoShops,
    duplicate: str,
    into: str,
    *,
    store: uuid.UUID | None = None,
) -> httpx.Response:
    store = store or shops.primary_store
    async with api(maker, owner(shops)) as client:
        return await client.post(
            f"/api/v1/catalog/models/{duplicate}/merge",
            json={"store_id": str(store), "command_id": str(uuid.uuid4()), "into": into},
            headers=key(),
        )


async def merged(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, duplicate: str, into: str, **kw: Any
) -> dict[str, Any]:
    response = await merge(maker, shops, duplicate, into, **kw)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert (body["kind"], body["status"], body["into_variant_id"]) == ("MERGE", "MERGED", into)
    return body


async def sell(
    maker: async_sessionmaker[AsyncSession],
    shops: TwoShops,
    variant: str,
    size: str,
    qty: int = 1,
) -> httpx.Response:
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size, qty=qty),
            headers=key(),
        )


async def at(
    maker: async_sessionmaker[AsyncSession], warehouse: uuid.UUID, variant: str, size: str
) -> int:
    async with maker() as session:
        return await quantity_at(session, warehouse, variant, size)


async def ledger(
    maker: async_sessionmaker[AsyncSession], **where: Any
) -> list[tuple[str, int, str | None, str, uuid.UUID]]:
    """(variant, delta, reason, movement type, location) of matching movements."""
    async with maker() as session:
        rows = await session.execute(
            select(
                StockMovement.product_variant_id,
                StockMovement.quantity_delta,
                StockMovement.reason_code,
                StockMovement.movement_type,
                StockMovement.location_id,
            )
            .where(*(getattr(StockMovement, column) == value for column, value in where.items()))
            .order_by(StockMovement.quantity_delta)
        )
        return [
            (str(variant), delta, reason.value if reason else None, kind.value, location)
            for variant, delta, reason, kind, location in rows.all()
        ]


async def nothing_left_under_merged(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops
) -> None:
    async with maker() as session:
        assert await stock_under_merged_models(session, organization_id=shops.organization_id) == []
        assert await find_divergences(session, organization_id=shops.organization_id) == []


def refused_as_merged(response: httpx.Response, duplicate: str, stay: str) -> None:
    assert response.status_code == 409, response.text
    answer = response.json()
    assert answer["code"] == "MODEL_MERGED", answer
    assert answer["details"]["product_variant_id"] == duplicate
    assert answer["details"]["merged_into"] == stay
    # Refused after the command's lookup: it proves nothing was recorded.
    assert answer["details"]["recorded"] is False


# ---------------------------------------------------------------------------
# 1. Stock commands naming the duplicate
# ---------------------------------------------------------------------------


async def test_stock_commands_naming_the_duplicate_are_refused_and_record_nothing(maker):
    """ADR-0008 §5: `lock_stock`'s first statement holds the basket's models;
    a merged one is refused `MODEL_MERGED`, naming the model that stays, with
    `recorded = false` (§9). A receipt, a sale and a stock correction alike —
    and a basket that also names the model that stays sells nothing of it."""
    shops = await make_two_shops(maker)
    pair = await a_pair(maker, shops, stay_qty=2, duplicate_qty=3)
    done = await merged(maker, shops, pair.duplicate, pair.stay)
    correction = uuid.UUID(done["correction_id"])

    # The merge itself: one pair of movements, both naming the correction.
    assert await ledger(maker, reference_id=correction) == [
        (pair.duplicate, -3, "CATALOG_MERGE_OUT", "ADJUSTMENT", shops.shared_warehouse),
        (pair.stay, 3, "CATALOG_MERGE_IN", "ADJUSTMENT", shops.shared_warehouse),
    ]
    assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 5
    assert await at(maker, shops.shared_warehouse, pair.duplicate, pair.size) == 0

    receipt = receipt_body(
        shops.primary_store, shops.shared_warehouse, pair.duplicate, pair.size, 1
    )
    elsewhere = receipt_body(shops.child_store, shops.child_warehouse, pair.duplicate, pair.size, 2)
    sale = sale_body(shops.primary_store, shops.shared_warehouse, pair.duplicate, pair.size)
    both = sale_body(shops.primary_store, shops.shared_warehouse, pair.stay, pair.size)
    both["lines"].append(dict(sale["lines"][0]))
    adjustment = {
        "store_id": str(shops.primary_store),
        "location_id": str(shops.shared_warehouse),
        "command_id": str(uuid.uuid4()),
        "product_variant_id": pair.duplicate,
        "size_id": pair.size,
        "quantity_delta": 1,
        "reason_code": "STOCKTAKE",
        "note": None,
    }
    async with api(maker, shops.scope(shops.primary_store)) as client:
        received = await client.post("/api/v1/inventory/receipts", json=receipt, headers=key())
        # The same command, sent again under another key: still nothing.
        again = await client.post("/api/v1/inventory/receipts", json=receipt, headers=key())
        sold = await client.post("/api/v1/sales", json=sale, headers=key())
        basket = await client.post("/api/v1/sales", json=both, headers=key())
    async with api(maker, shops.scope(shops.child_store)) as client:
        received_elsewhere = await client.post(
            "/api/v1/inventory/receipts", json=elsewhere, headers=key()
        )
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        corrected = await client.post(
            "/api/v1/inventory/adjustments", json=adjustment, headers=key()
        )

    for response in (received, again, received_elsewhere, sold, basket, corrected):
        refused_as_merged(response, pair.duplicate, pair.stay)

    commands = {
        uuid.UUID(str(body["command_id"])) for body in (receipt, elsewhere, sale, both, adjustment)
    }
    async with maker() as session:
        for table in (GoodsReceipt, Sale, StockAdjustment):
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(table)
                    .where(
                        table.organization_id == shops.organization_id,
                        table.command_id.in_(commands),
                    )
                )
                == 0
            ), table.__name__
        # Nothing moved under either model since the merge: the basket that
        # also named the model that stays sold none of it.
        assert await quantity_at(session, shops.shared_warehouse, pair.stay, pair.size) == 5
        assert await quantity_at(session, shops.shared_warehouse, pair.duplicate, pair.size) == 0
        assert await quantity_at(session, shops.child_warehouse, pair.duplicate, pair.size) == 0
    assert [
        (reason, kind)
        for _, _, reason, kind, _ in await ledger(
            maker, product_variant_id=uuid.UUID(pair.duplicate)
        )
    ] == [("CATALOG_MERGE_OUT", "ADJUSTMENT"), (None, "DELIVERY")]
    assert len(await ledger(maker, product_variant_id=uuid.UUID(pair.stay))) == 2
    await nothing_left_under_merged(maker, shops)


async def test_a_command_made_before_the_merge_is_answered_with_what_it_did(maker):
    """ADR-0008 §9: every stock command reaches `lock_stock` only after its
    `command_id` lookup. So a sale or a receipt of the duplicate that landed
    before the merge, sent again afterwards (a phone retrying), is answered
    with what it did — not refused, and not done twice."""
    shops = await make_two_shops(maker)
    pair = await a_pair(maker, shops, stay_qty=1, duplicate_qty=3)
    sale = sale_body(shops.primary_store, shops.shared_warehouse, pair.duplicate, pair.size)
    receipt = receipt_body(
        shops.primary_store, shops.shared_warehouse, pair.duplicate, pair.size, 2
    )
    async with api(maker, shops.scope(shops.primary_store)) as client:
        sold = await client.post("/api/v1/sales", json=sale, headers=key())
        received = await client.post("/api/v1/inventory/receipts", json=receipt, headers=key())
    assert sold.status_code == 201, sold.text
    assert received.status_code == 201, received.text

    done = await merged(maker, shops, pair.duplicate, pair.stay)
    assert done["details"]["moved"] == [
        {"location_id": str(shops.shared_warehouse), "size_id": pair.size, "quantity": 4}
    ]

    async with api(maker, shops.scope(shops.primary_store)) as client:
        sold_again = await client.post("/api/v1/sales", json=sale, headers=key())
        received_again = await client.post(
            "/api/v1/inventory/receipts", json=receipt, headers=key()
        )
    assert sold_again.status_code in {200, 201}, sold_again.text
    assert sold_again.json()["id"] == sold.json()["id"]
    assert received_again.status_code in {200, 201}, received_again.text
    assert received_again.json() == received.json()
    assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 5
    assert await at(maker, shops.shared_warehouse, pair.duplicate, pair.size) == 0
    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Sale)
                .where(Sale.organization_id == shops.organization_id)
            )
            == 1
        )
    await nothing_left_under_merged(maker, shops)


# ---------------------------------------------------------------------------
# 2. A till return of an old sale of the duplicate
# ---------------------------------------------------------------------------


async def test_an_old_sale_of_the_duplicate_comes_back_as_the_model_that_stays(maker):
    """Owner: "goods from an old sale of the duplicate come back as the model
    that stays". ADR-0008 §5: intact goods restock the model that stays where
    the line was sold from; a return taken damaged registers its «Брак» unit
    as the model that stays; the sale line keeps its frozen name (I8)."""
    shops = await make_two_shops(maker)
    bin_ = await give_bin(maker, shops.organization_id, shops.primary_store)
    pair = await a_pair(maker, shops, stay_qty=1, duplicate_qty=3)
    old = await sell(maker, shops, pair.duplicate, pair.size, qty=2)
    assert old.status_code == 201, old.text
    sale = old.json()
    assert sale["items"][0]["display_name"] == pair.duplicate_name

    await merged(maker, shops, pair.duplicate, pair.stay)
    assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 2

    line = sale["items"][0]["id"]
    async with api(maker, shops.scope(shops.primary_store)) as client:
        refunded = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {"sale_item_id": line, "quantity": 1, "restock": True, "condition": "INTACT"},
                    {"sale_item_id": line, "quantity": 1, "restock": True, "condition": "DAMAGED"},
                ],
            },
            headers=key(),
        )
    assert refunded.status_code == 201, refunded.text
    refund = refunded.json()
    # The return reads as the sale did.
    assert {item["display_name"] for item in refund["items"]} == {pair.duplicate_name}

    # The intact one is back on the shelf it was sold from, as the model that
    # stays; the damaged one is in «Брак», as the model that stays too.
    assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 3
    assert await at(maker, shops.shared_warehouse, pair.duplicate, pair.size) == 0
    assert await at(maker, bin_, pair.stay, pair.size) == 1
    assert await at(maker, bin_, pair.duplicate, pair.size) == 0

    async with maker() as session:
        items = (
            await session.scalars(
                select(RefundItem.id).where(RefundItem.refund_id == uuid.UUID(refund["id"]))
            )
        ).all()
        moved = (
            await session.execute(
                select(
                    StockMovement.product_variant_id,
                    StockMovement.location_id,
                    StockMovement.quantity_delta,
                ).where(
                    StockMovement.organization_id == shops.organization_id,
                    StockMovement.movement_type == MovementType.REFUND_RETURN,
                )
            )
        ).all()
        assert sorted((str(v), loc, d) for v, loc, d in moved) == sorted(
            [
                (pair.stay, shops.shared_warehouse, 1),
                (pair.stay, bin_, 1),
            ]
        )
        [unit] = (
            await session.scalars(select(DamagedUnit).where(DamagedUnit.refund_item_id.in_(items)))
        ).all()
        assert str(unit.product_variant_id) == pair.stay
        assert unit.location_id == bin_
        # The unit reads as the sale did: the frozen name.
        assert unit.display_name == pair.duplicate_name
        # The sale line still names the duplicate, by its frozen name.
        item = await session.get(SaleItem, uuid.UUID(line))
        assert item is not None
        assert str(item.product_variant_id) == pair.duplicate
        assert item.display_name_snapshot == pair.duplicate_name
    await nothing_left_under_merged(maker, shops)


# ---------------------------------------------------------------------------
# 3. A supplier return cancelled after the merge
# ---------------------------------------------------------------------------


async def test_a_supplier_return_cancelled_after_the_merge_comes_back_as_the_model_that_stays(
    maker,
):
    """ADR-0008 §5, "goods that come back": a supplier return of the
    duplicate, other than a «Брак» unit's, made before the merge and cancelled
    after it, puts the goods back as the model that stays — where they left.
    The return's own line keeps naming the duplicate."""
    shops = await make_two_shops(maker)
    pair = await a_pair(maker, shops, stay_qty=1, duplicate_qty=5)
    supplier_id = (await supplier(maker, shops)).json()["id"]
    sent = await send(maker, shops, document(shops, supplier_id, (pair.duplicate, pair.size, 2)))
    assert sent.status_code == 201, sent.text
    assert await at(maker, shops.shared_warehouse, pair.duplicate, pair.size) == 3

    await merged(maker, shops, pair.duplicate, pair.stay)
    assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 4

    undone = await cancel(maker, shops, sent.json()["id"])
    assert undone.status_code == 200, undone.text

    assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 6
    assert await at(maker, shops.shared_warehouse, pair.duplicate, pair.size) == 0
    back = await ledger(
        maker,
        organization_id=shops.organization_id,
        movement_type=MovementType.SUPPLIER_RETURN_CANCEL,
    )
    assert back == [(pair.stay, 2, None, "SUPPLIER_RETURN_CANCEL", shops.shared_warehouse)]
    async with maker() as session:
        [named] = (
            await session.scalars(
                select(SupplierReturnLine.product_variant_id).where(
                    SupplierReturnLine.supplier_return_id == uuid.UUID(sent.json()["id"])
                )
            )
        ).all()
    assert str(named) == pair.duplicate
    await nothing_left_under_merged(maker, shops)


# ---------------------------------------------------------------------------
# 4. A borrowed lot that reopens after the merge
# ---------------------------------------------------------------------------


async def test_a_borrowed_lot_reopened_after_the_merge_goes_back_as_the_model_that_stays(maker):
    """Owner, as carried out: "a borrowed lot whose invoice or return is
    cancelled later is sent back to the supplier as the model that stays;
    the lot keeps naming the duplicate" (ADR-0008 §5, `lot_to_return`).

    The lot is fully marked sold before the merge, so nothing borrowed is on
    hand and the merge is allowed; its invoice is then cancelled."""
    shops = await make_two_shops(maker)
    pair = await a_pair(maker, shops, stay_qty=1, duplicate_qty=0)
    neighbour = (await supplier(maker, shops, "Сусідка Оксана")).json()["id"]
    borrowed_in = {
        "store_id": str(shops.primary_store),
        "location_id": str(shops.shared_warehouse),
        "command_id": str(uuid.uuid4()),
        "supplier_id": neighbour,
        "lines": [
            {
                "product_variant_id": pair.duplicate,
                "size_id": pair.size,
                "quantity": 3,
                "acquisition_type": "BORROWED",
                "unit_cost": "2000.00",
            }
        ],
        "notes": None,
    }
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        took = await client.post("/api/v1/inventory/receipts", json=borrowed_in, headers=key())
        assert took.status_code == 201, took.text
        [lot] = (
            await client.get(
                "/api/v1/borrowed",
                params={"store_id": str(shops.primary_store), "on_hand": "false"},
            )
        ).json()["items"]
        invoice = await client.post(
            "/api/v1/supplier-invoices/sold",
            json={
                "command_id": str(uuid.uuid4()),
                "store_id": str(shops.primary_store),
                "stock_lot_id": lot["stock_lot_id"],
                "quantity": 3,
            },
        )
        assert invoice.status_code == 201, invoice.text

    done = await merged(maker, shops, pair.duplicate, pair.stay)
    assert done["details"]["moved"] == [
        {"location_id": str(shops.shared_warehouse), "size_id": pair.size, "quantity": 3}
    ]
    assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 4

    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        undone = await client.post(
            f"/api/v1/supplier-invoices/{invoice.json()['id']}/cancel",
            json={"reason": "позначили помилково"},
        )
        assert undone.status_code == 200, undone.text
        [reopened] = (
            await client.get("/api/v1/borrowed", params={"store_id": str(shops.primary_store)})
        ).json()["items"]
        assert (reopened["received"], reopened["sold"], reopened["returned"]) == (3, 0, 0)
        assert reopened["on_hand"] == 3

        def back(variant: str, qty: int = 1) -> dict[str, Any]:
            return {
                "command_id": str(uuid.uuid4()),
                "store_id": str(shops.primary_store),
                "location_id": str(shops.shared_warehouse),
                "supplier_id": neighbour,
                "stock_lot_id": lot["stock_lot_id"],
                "lines": [{"product_variant_id": variant, "size_id": pair.size, "quantity": qty}],
                "note": None,
            }

        as_duplicate = await client.post("/api/v1/supplier-returns", json=back(pair.duplicate))
        as_stay = await client.post("/api/v1/supplier-returns", json=back(pair.stay))
        [after] = (
            await client.get("/api/v1/borrowed", params={"store_id": str(shops.primary_store)})
        ).json()["items"]

    # Naming the duplicate is refused: its goods are the model that stays now.
    assert as_duplicate.status_code in {409, 422}, as_duplicate.text
    assert as_duplicate.json()["code"] in {"VALIDATION_ERROR", "MODEL_MERGED"}
    assert as_stay.status_code == 201, as_stay.text
    assert as_stay.json()["stock_lot_id"] == lot["stock_lot_id"]
    assert (after["received"], after["sold"], after["returned"], after["on_hand"]) == (3, 0, 1, 2)
    assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 3
    assert await at(maker, shops.shared_warehouse, pair.duplicate, pair.size) == 0
    assert await ledger(
        maker,
        organization_id=shops.organization_id,
        movement_type=MovementType.SUPPLIER_RETURN,
    ) == [(pair.stay, -1, None, "SUPPLIER_RETURN", shops.shared_warehouse)]
    async with maker() as session:
        # The lot keeps naming the model it arrived as.
        stored = await session.get(StockLot, uuid.UUID(lot["stock_lot_id"]))
        assert stored is not None
        assert str(stored.product_variant_id) == pair.duplicate
    await nothing_left_under_merged(maker, shops)


# ---------------------------------------------------------------------------
# 5. «Звіт» counts the two as one
# ---------------------------------------------------------------------------


async def test_the_sales_report_counts_the_duplicate_with_the_model_that_stays(maker):
    """Owner: "«Звіт» counts the two as one"; as carried out, "«Звіт» names a
    merged model's line by the current name of the model that stays"
    (ADR-0008 §5). The figures stay the frozen lines' own."""
    shops = await make_two_shops(maker)
    pair = await a_pair(maker, shops, stay_qty=3, duplicate_qty=3)
    # Another model, sold too, that must stay a line of its own.
    other = await a_pair(maker, shops, stay_qty=1, duplicate_qty=0)
    stay_sale = await sell(maker, shops, pair.stay, pair.size, qty=2)
    duplicate_sale = await sell(maker, shops, pair.duplicate, pair.size, qty=1)
    other_sale = await sell(maker, shops, other.stay, other.size, qty=1)
    for response in (stay_sale, duplicate_sale, other_sale):
        assert response.status_code == 201, response.text

    await merged(maker, shops, pair.duplicate, pair.stay)
    # A return of the duplicate's old sale, taken after the merge.
    async with api(maker, shops.scope(shops.primary_store)) as client:
        taken = await client.post(
            f"/api/v1/sales/{duplicate_sale.json()['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": duplicate_sale.json()["items"][0]["id"],
                        "quantity": 1,
                        "restock": True,
                        "condition": "INTACT",
                    }
                ],
            },
            headers=key(),
        )
    assert taken.status_code == 201, taken.text

    async def models() -> list[tuple[str, str, int, str, int, str]]:
        async with api(maker, owner(shops)) as client:
            response = await client.get(
                "/api/v1/reports/sales/models", params={"store_id": str(shops.primary_store)}
            )
        assert response.status_code == 200, response.text
        return [
            (
                m["product_variant_id"],
                m["display_name"],
                m["units"],
                m["sold"],
                m["returned_units"],
                m["returned"],
            )
            for m in response.json()["models"]
        ]

    assert await models() == [
        (pair.stay, pair.stay_name, 3, "4500.00", 1, "1500.00"),
        (other.stay, other.stay_name, 1, "1500.00", 0, "0.00"),
    ]

    # Renamed afterwards: the line is named as the model is named now.
    async with api(maker, owner(shops)) as client:
        renamed = await client.post(
            f"/api/v1/catalog/models/{pair.stay}/rename",
            json={
                "store_id": str(shops.primary_store),
                "command_id": str(uuid.uuid4()),
                "concept": pair.concept,
                "variant": {"color": "гіркий шоколад"},
            },
            headers=key(),
        )
    assert renamed.status_code == 200, renamed.text
    new_name = renamed.json()["name_after"]
    assert new_name != pair.stay_name and "гіркий шоколад" in new_name
    assert await models() == [
        (pair.stay, new_name, 3, "4500.00", 1, "1500.00"),
        (other.stay, other.stay_name, 1, "1500.00", 0, "0.00"),
    ]


# ---------------------------------------------------------------------------
# 6. Searching and typing the old name
# ---------------------------------------------------------------------------


async def test_searching_or_typing_the_old_name_finds_the_model_that_stays(maker):
    """Owner: "searching the old name finds the model that stays". ADR-0008
    §5: receiving's search, the catalogue search and the matcher lead to the
    model that stays, listed once; §4: creating a merged model's name gives
    the model that stays (`created = false`, `redirected_from`), after the
    similar-name warning that the typed word is the typo a merge left (§7)."""
    shops = await make_two_shops(maker)
    pair = await a_pair(maker, shops, stay_qty=0, duplicate_qty=0)
    await merged(maker, shops, pair.duplicate, pair.stay)

    async with api(maker, shops.scope(shops.primary_store)) as client:
        found = {}
        for query in ("шокалад", pair.duplicate_name, pair.concept):
            response = await client.get(
                "/api/v1/catalog/receivable-variants",
                params={"store_id": str(shops.primary_store), "query": query},
            )
            assert response.status_code == 200, response.text
            found[query] = [
                (item["product_variant_id"], item["display_name"])
                for item in response.json()["items"]
            ]

        typed = await create_model(client, shops.primary_store, family=pair.family, color="шокалад")
        confirmed = await create_model(
            client, shops.primary_store, family=pair.family, color="шокалад", similar_confirmed=True
        )
        matched = await client.post(
            "/api/v1/catalog/match-preview",
            json={"store_id": str(shops.primary_store), "raw_text": pair.duplicate_name},
        )
    for query, items in found.items():
        assert items == [(pair.stay, pair.stay_name)], query

    # Typed again, the typo is caught first, offering the model that stays…
    assert typed.status_code == 409, typed.text
    assert typed.json()["code"] == "CATALOG_SIMILAR"
    [similar] = typed.json()["details"]["similar"]
    assert (similar["field"], similar["typed"], similar["left_by_merge"]) == (
        "color",
        "шокалад",
        True,
    )
    assert [m["product_variant_id"] for m in similar["models"]] == [pair.stay]
    # …and confirmed, it answers with the model that stays, creating nothing.
    assert confirmed.status_code == 201, confirmed.text
    created = confirmed.json()
    assert created["product_variant_id"] == pair.stay
    assert created["variant_created"] is False
    assert created["redirected_from"] == pair.duplicate
    assert created["display_name"] == pair.stay_name
    async with maker() as session:
        family = uuid.UUID(pair.family)
        variants = (
            await session.execute(
                select(ProductVariant.id, ProductVariant.status).where(
                    ProductVariant.product_family_id == family
                )
            )
        ).all()
        assert sorted((str(v), s) for v, s in variants) == sorted(
            [(pair.stay, EntityStatus.ACTIVE), (pair.duplicate, EntityStatus.MERGED)]
        )

    # The matcher proposes the model that stays for the duplicate's exact name.
    assert matched.status_code == 200, matched.text
    candidates = [c["variant_id"] for c in matched.json()["candidates"]]
    assert candidates and candidates[0] == pair.stay, matched.json()
    # The duplicate's exact name is the model that stays's, exactly: one
    # strong candidate, so the same model.
    assert "EXACT_DISPLAY_NAME" in matched.json()["candidates"][0]["reasons"], matched.json()
    assert matched.json()["decision_type"] == "SAME_VARIANT", matched.json()
    assert pair.duplicate not in candidates

    # The catalogue's own search, for whoever corrects it, also leads there.
    async with api(maker, owner(shops)) as client:
        listed = await client.get(
            "/api/v1/catalog/models",
            params={"store_id": str(shops.primary_store), "query": "шокалад"},
        )
    assert listed.status_code == 200, listed.text
    assert [item["product_variant_id"] for item in listed.json()["items"]] == [pair.stay]


async def test_a_typo_in_its_own_family_leads_to_the_model_that_stays_once_merged(maker):
    """ADR-0008 §3, §5, §7: a duplicate in a family of its own (a typo in the
    model's name) empties that family when merged, which then leads to the
    family of the model that stays. Its name is no longer offered in family
    search; searching it finds the model that stays; typing it again warns
    that it is the typo a merge left, naming the model that stays."""
    shops = await make_two_shops(maker)
    stem = uuid.uuid4().hex[:8]
    right, typo = f"Лоран-{stem}", f"Лорaн-{stem}"  # a Latin «a»
    async with api(maker, shops.scope(shops.primary_store)) as client:
        stay = await create_model(client, shops.primary_store, concept=right, color="шоколад")
        assert stay.status_code == 201, stay.text
        warned = await create_model(client, shops.primary_store, concept=typo, color="шоколад")
        duplicate = await create_model(
            client, shops.primary_store, concept=typo, color="шоколад", similar_confirmed=True
        )
    assert warned.status_code == 409 and warned.json()["code"] == "CATALOG_SIMILAR", warned.text
    assert duplicate.status_code == 201, duplicate.text
    stay_id = str(stay.json()["product_variant_id"])
    duplicate_id = str(duplicate.json()["product_variant_id"])
    size = str(stay.json()["sizes"][0]["size_id"])
    assert (await receive(maker, shops, duplicate_id, size, 2)).status_code == 201

    done = await merged(maker, shops, duplicate_id, stay_id)
    assert done["details"]["family_merged"] is True
    async with maker() as session:
        family = await session.get(ProductFamily, uuid.UUID(duplicate.json()["product_family_id"]))
        assert family is not None
        await session.refresh(family)
        assert family.status is EntityStatus.MERGED
        assert str(family.merged_into_id) == stay.json()["product_family_id"]

    async with api(maker, shops.scope(shops.primary_store)) as client:
        families = await client.get(
            "/api/v1/catalog/families", params={"store_id": str(shops.primary_store), "query": typo}
        )
        searched = await client.get(
            "/api/v1/catalog/receivable-variants",
            params={"store_id": str(shops.primary_store), "query": typo},
        )
        again = await create_model(client, shops.primary_store, concept=typo, color="шоколад")
    assert families.status_code == 200, families.text
    assert duplicate.json()["product_family_id"] not in [
        item["family_id"] for item in families.json()["items"]
    ]
    assert [item["product_variant_id"] for item in searched.json()["items"]] == [stay_id]
    assert again.status_code == 409, again.text
    assert again.json()["code"] == "CATALOG_SIMILAR"
    reports = {report["field"]: report for report in again.json()["details"]["similar"]}
    assert reports["concept"]["left_by_merge"] is True
    assert [m["product_variant_id"] for m in reports["concept"]["models"]] == [stay_id]

    # Typed again exactly and confirmed, the merged model's name is still the
    # model that stays (ADR-0008 §4): no family, no model made again.
    async with maker() as session:
        families_before = await session.scalar(
            select(func.count())
            .select_from(ProductFamily)
            .where(ProductFamily.organization_id == shops.organization_id)
        )
    async with api(maker, shops.scope(shops.primary_store)) as client:
        confirmed = await create_model(
            client, shops.primary_store, concept=typo, color="шоколад", similar_confirmed=True
        )
    assert confirmed.status_code == 201, confirmed.text
    assert confirmed.json()["product_variant_id"] == stay_id
    assert confirmed.json()["redirected_from"] == duplicate_id
    assert confirmed.json()["variant_created"] is False
    assert confirmed.json()["family_created"] is False
    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ProductFamily)
                .where(ProductFamily.organization_id == shops.organization_id)
            )
            == families_before
        )
    assert await at(maker, shops.shared_warehouse, stay_id, size) == 2
    await nothing_left_under_merged(maker, shops)


# ---------------------------------------------------------------------------
# 7. No stock under a merged model, even through a chain of merges
# ---------------------------------------------------------------------------


async def test_no_stock_is_left_under_a_merged_model_after_a_chain_of_merges(maker):
    """ADR-0008 §3 step 5 and §9: models merged into the duplicate are pointed
    at the model that stays, so `merged_into_id` always names a model not
    merged; reconciliation (`stock_under_merged_models`) finds nothing after
    merges, in every warehouse; and a command naming the first duplicate is
    refused naming the model that stands now."""
    shops = await make_two_shops(maker)
    first = await a_pair(maker, shops, stay_qty=2, duplicate_qty=3)
    final = await a_pair(maker, shops, stay_qty=1, duplicate_qty=0)
    # The child's own warehouse too: the merges act as the child store, which
    # reaches it and the shared one.
    for variant, qty in ((first.duplicate, 4), (first.stay, 1)):
        assert (
            await receive(
                maker,
                shops,
                variant,
                first.size,
                qty,
                store=shops.child_store,
                warehouse=shops.child_warehouse,
            )
        ).status_code == 201

    await merged(maker, shops, first.duplicate, first.stay, store=shops.child_store)
    async with maker() as session:
        assert await stock_under_merged_models(session, organization_id=shops.organization_id) == []
    await merged(maker, shops, first.stay, final.stay, store=shops.child_store)

    async with maker() as session:
        assert await stock_under_merged_models(session, organization_id=shops.organization_id) == []
        rows = (
            await session.execute(
                select(ProductVariant.id, ProductVariant.status, ProductVariant.merged_into_id)
                .where(
                    ProductVariant.id.in_(
                        [uuid.UUID(first.duplicate), uuid.UUID(first.stay), uuid.UUID(final.stay)]
                    )
                )
                .execution_options(populate_existing=True)
            )
        ).all()
        state = {str(v): (s, None if m is None else str(m)) for v, s, m in rows}
        assert state == {
            first.duplicate: (EntityStatus.MERGED, final.stay),
            first.stay: (EntityStatus.MERGED, final.stay),
            final.stay: (EntityStatus.ACTIVE, None),
        }
        assert await quantity_at(session, shops.shared_warehouse, final.stay, final.size) == 6
        assert await quantity_at(session, shops.child_warehouse, final.stay, final.size) == 5
        assert (
            await session.scalar(
                select(func.coalesce(func.sum(Inventory.quantity), 0)).where(
                    Inventory.product_variant_id.in_(
                        [uuid.UUID(first.duplicate), uuid.UUID(first.stay)]
                    )
                )
            )
            == 0
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(CatalogCorrection)
                .where(
                    CatalogCorrection.organization_id == shops.organization_id,
                    CatalogCorrection.kind == "MERGE",
                )
            )
            == 2
        )

    refused_as_merged(
        await receive(maker, shops, first.duplicate, first.size, 1), first.duplicate, final.stay
    )
    await nothing_left_under_merged(maker, shops)


# ---------------------------------------------------------------------------
# 8. Commands in flight
# ---------------------------------------------------------------------------


async def wait_until_blocked_by(engine: AsyncEngine, holder_pid: int) -> None:
    """Some backend is genuinely waiting on `holder_pid`'s locks, asked of
    `pg_locks` (the pattern of test_snapshot_import.py)."""
    async with engine.connect() as observer:
        for _ in range(1000):
            blocked = await observer.scalar(
                text(
                    "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted"
                    " AND CAST(:holder AS integer) = ANY(pg_blocking_pids(pid)))"
                ),
                {"holder": holder_pid},
            )
            await observer.rollback()
            if blocked:
                return
            await asyncio.sleep(0.01)
    pytest.fail("nothing ever waited on the held transaction's locks")


@pytest.mark.parametrize("command", ["receipt", "adjustment"])
@pytest.mark.parametrize("where", ["new size", "new warehouse", "emptied row"])
async def test_a_stock_command_waiting_on_the_merge_is_refused_and_leaves_nothing(
    maker, engine, command, where
):
    """The race the review found (ADR-0008 §5, §9, and "Alternatives
    considered": reading status in `lock_stock` without a lock). The merge
    holds the duplicate `FOR UPDATE`; a receipt or a stock correction of the
    duplicate — at a key where it has no stock row yet (a new size, a new
    warehouse), or at a row it emptied — must wait for that hold, then read
    the merged row and be refused `MODEL_MERGED`, recording nothing. A plain
    read let it write under a model nothing could move again."""
    shops = await make_two_shops(maker)
    pair = await a_pair(maker, shops, stay_qty=1, duplicate_qty=0)
    store, warehouse, size = shops.primary_store, shops.shared_warehouse, pair.size
    if where == "new size":
        # The duplicate gains a size it has never held anywhere.
        async with api(maker, shops.scope(shops.primary_store)) as client:
            sized = await create_model(
                client,
                shops.primary_store,
                family=pair.family,
                color="шокалад",
                sizes=("L",),
                similar_confirmed=True,
            )
        assert sized.status_code == 201, sized.text
        assert str(sized.json()["product_variant_id"]) == pair.duplicate
        size = str(sized.json()["sizes"][0]["size_id"])
        assert size != pair.size
    elif where == "new warehouse":
        store, warehouse = shops.child_store, shops.child_warehouse
    else:
        # A row that exists and holds nothing: received, then sold.
        assert (await receive(maker, shops, pair.duplicate, size, 1)).status_code == 201
        assert (await sell(maker, shops, pair.duplicate, size)).status_code == 201
    duplicate = uuid.UUID(pair.duplicate)
    async with maker() as session:
        movements_before = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(StockMovement.product_variant_id == duplicate)
        )
        rows_before = await session.scalar(
            select(func.count())
            .select_from(Inventory)
            .where(Inventory.product_variant_id == duplicate)
        )

    if command == "receipt":
        path, body, permissions = (
            "/api/v1/inventory/receipts",
            receipt_body(store, warehouse, pair.duplicate, size, 2),
            SELLER,
        )
    else:
        path, permissions = "/api/v1/inventory/adjustments", MANAGER
        body = {
            "store_id": str(store),
            "location_id": str(warehouse),
            "command_id": str(uuid.uuid4()),
            "product_variant_id": pair.duplicate,
            "size_id": size,
            "quantity_delta": 2,
            "reason_code": "STOCKTAKE",
            "note": "знайшли на складі",
        }

    async with maker() as holding:
        # As the merge holds its models: first, `FOR UPDATE`.
        await holding.execute(
            select(ProductVariant.id).where(ProductVariant.id == duplicate).with_for_update()
        )
        holder = await holding.scalar(text("SELECT pg_backend_pid()"))
        async with api(maker, shops.scope(store, permissions)) as client:
            in_flight = asyncio.create_task(client.post(path, json=body, headers=key()))
            await wait_until_blocked_by(engine, holder)
            await asyncio.sleep(0.5)
            assert not in_flight.done(), "the command did not wait for the model's hold"
            await holding.execute(
                update(ProductVariant)
                .where(ProductVariant.id == duplicate)
                .values(status=EntityStatus.MERGED, merged_into_id=uuid.UUID(pair.stay))
            )
            await holding.commit()
            landed = await in_flight

    refused_as_merged(landed, pair.duplicate, pair.stay)
    async with maker() as session:
        assert (
            await session.scalar(
                select(func.coalesce(func.sum(Inventory.quantity), 0)).where(
                    Inventory.product_variant_id == duplicate
                )
            )
            == 0
        )
        # Not even an empty row was left at the new key.
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Inventory)
                .where(Inventory.product_variant_id == duplicate)
            )
            == rows_before
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(StockMovement)
                .where(StockMovement.product_variant_id == duplicate)
            )
            == movements_before
        )
        table = GoodsReceipt if command == "receipt" else StockAdjustment
        assert (
            await session.scalar(
                select(func.count())
                .select_from(table)
                .where(
                    table.organization_id == shops.organization_id,
                    table.command_id == uuid.UUID(body["command_id"]),
                )
            )
            == 0
        )
    await nothing_left_under_merged(maker, shops)


async def test_a_stock_command_holding_the_duplicate_first_lands_and_the_merge_moves_the_rest(
    maker, engine
):
    """ADR-0008 §9, the other order: "a command that holds a model before a
    merge commits first, and the merge then moves its stock". A stock
    correction of the duplicate is in flight through the ledger's door (so it
    holds the model `FOR KEY SHARE`); the merge waits for it, and moves what
    it left, read under the stock lock — not what was there before."""
    from app.modules.inventory.service import record_adjustment

    shops = await make_two_shops(maker)
    pair = await a_pair(maker, shops, stay_qty=2, duplicate_qty=3)
    async with maker() as holding:
        await record_adjustment(
            holding,
            organization_id=shops.organization_id,
            store_id=shops.primary_store,
            actor_user_id=shops.user_id,
            command_id=uuid.uuid4(),
            command_fingerprint=None,
            location_id=shops.shared_warehouse,
            product_variant_id=uuid.UUID(pair.duplicate),
            size_id=uuid.UUID(pair.size),
            quantity_delta=-1,
            reason_code=MovementReason.LOST,
            note=None,
            correlation_id=None,
        )
        holder = await holding.scalar(text("SELECT pg_backend_pid()"))
        joining = asyncio.create_task(merge(maker, shops, pair.duplicate, pair.stay))
        await wait_until_blocked_by(engine, holder)
        await asyncio.sleep(0.3)
        assert not joining.done(), "the merge did not wait for the command holding the model"
        await holding.commit()
        joined = await joining

    assert joined.status_code == 200, joined.text
    assert joined.json()["details"]["moved"] == [
        {"location_id": str(shops.shared_warehouse), "size_id": pair.size, "quantity": 2}
    ]
    assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 4
    assert await at(maker, shops.shared_warehouse, pair.duplicate, pair.size) == 0
    await nothing_left_under_merged(maker, shops)


async def test_a_sale_of_the_model_that_stays_and_a_merge_into_it_both_land(maker):
    """ADR-0008 §9, one lock order for every command: a sale of the model
    that stays and a merge of a duplicate into it, at the same warehouse and
    size, in the same instant. Both succeed — no deadlock, no 500 — and the
    totals add up: what was sold left, what the duplicate held arrived."""
    shops = await make_two_shops(maker)
    for _ in range(5):
        pair = await a_pair(maker, shops, stay_qty=4, duplicate_qty=3)
        sale, joined = await asyncio.gather(
            sell(maker, shops, pair.stay, pair.size, qty=1),
            merge(maker, shops, pair.duplicate, pair.stay),
        )
        assert sale.status_code == 201, sale.text
        assert joined.status_code == 200, joined.text
        assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 4 - 1 + 3
        assert await at(maker, shops.shared_warehouse, pair.duplicate, pair.size) == 0
        assert await ledger(maker, reference_id=uuid.UUID(joined.json()["correction_id"])) == [
            (pair.duplicate, -3, "CATALOG_MERGE_OUT", "ADJUSTMENT", shops.shared_warehouse),
            (pair.stay, 3, "CATALOG_MERGE_IN", "ADJUSTMENT", shops.shared_warehouse),
        ]
    await nothing_left_under_merged(maker, shops)


async def test_a_sale_of_the_duplicate_racing_its_merge_lands_wholly_before_or_is_refused(maker):
    """ADR-0008 §9: "a command that holds a model before a merge commits
    first, and the merge then moves its stock. One that comes after waits,
    and is refused MODEL_MERGED." Either way nothing is lost or left behind."""
    shops = await make_two_shops(maker)
    outcomes = set()
    for _ in range(5):
        pair = await a_pair(maker, shops, stay_qty=2, duplicate_qty=3)
        sale, joined = await asyncio.gather(
            sell(maker, shops, pair.duplicate, pair.size, qty=1),
            merge(maker, shops, pair.duplicate, pair.stay),
        )
        assert joined.status_code == 200, joined.text
        moved = joined.json()["details"]["moved"]
        if sale.status_code == 201:
            outcomes.add("sold first")
            assert moved == [
                {"location_id": str(shops.shared_warehouse), "size_id": pair.size, "quantity": 2}
            ]
            assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 4
        else:
            outcomes.add("refused")
            refused_as_merged(sale, pair.duplicate, pair.stay)
            assert moved == [
                {"location_id": str(shops.shared_warehouse), "size_id": pair.size, "quantity": 3}
            ]
            assert await at(maker, shops.shared_warehouse, pair.stay, pair.size) == 5
        assert await at(maker, shops.shared_warehouse, pair.duplicate, pair.size) == 0
    assert outcomes
    await nothing_left_under_merged(maker, shops)
