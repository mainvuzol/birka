"""M1-017 — the refund command, end to end over HTTP against real PostgreSQL.

`.ai/workflows/refund.md` names six required tests: partial refund, full
refund, duplicate refund, two simultaneous refunds of the same item,
cross-store access rejected, and historical sale totals unchanged. All six are
here, together with the money, idempotency and atomicity properties the
constitution requires of anything that moves stock or money.

The product, the receipt and the sale are all created through the API, so a
refund is always taken against a receipt this suite actually sold — never
against fixture rows that could disagree with what the sale service writes.

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
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.errors import RefundExceedsSoldError
from app.core.idempotency import IdempotencyRecord
from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import Permission
from app.modules.catalog.models import CanonicalConcept
from app.modules.inventory.models import Inventory, MovementType, StockMovement
from app.modules.inventory.service import find_divergences
from app.modules.refunds.models import Refund, RefundItem, ReturnCondition
from app.modules.refunds.service import RefundLineInput, create_refund
from app.modules.sales.models import Sale, SaleStatus
from app.modules.tenancy.models import Store, StoreKind
from tests.conftest import requires_database
from tests.integration.test_product_lifecycle_api import (
    SELLER,
    Shop,
    api,
    create_product,
    key,
    make_shop,
    product_payload,
    size_named,
)

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


# ---------------------------------------------------------------------------
# A sold coat to refund
# ---------------------------------------------------------------------------


class Sold:
    """One completed sale, with everything a refund needs to address it."""

    def __init__(self, shop: Shop, product: dict[str, Any], size_id: str, sale: dict[str, Any]):
        self.shop = shop
        self.product = product
        self.size_id = size_id
        self.sale = sale

    @property
    def sale_id(self) -> str:
        return str(self.sale["id"])

    @property
    def variant_id(self) -> str:
        return str(self.product["product_variant_id"])

    def line(self, index: int = 0) -> dict[str, Any]:
        return dict(self.sale["items"][index])


async def sell(
    client: httpx.AsyncClient,
    shop: Shop,
    *,
    stock: int = 5,
    lines: list[dict[str, Any]] | None = None,
    unit_price: str = "1500.00",
    discount_amount: str = "100.00",
    quantity: int = 2,
    concept: str | None = None,
) -> Sold:
    """Create a product, receive `stock` of it, and sell it.

    Each call names a distinct concept by default. Naming one twice is the
    ambiguity the catalog deliberately refuses to resolve (ADR-0002), and a
    test helper must not depend on that refusal not happening.
    """
    created = await create_product(
        client, product_payload(shop, concept=concept or f"Лоран-{uuid.uuid4().hex[:8]}")
    )
    assert created.status_code == 201, created.text
    product = created.json()
    size_id = size_named(created, "M")

    received = await client.post(
        "/api/v1/inventory/receipts",
        json={
            "store_id": str(shop.store_id),
            "location_id": str(shop.location_id),
            "command_id": str(uuid.uuid4()),
            "lines": [
                {
                    "product_variant_id": product["product_variant_id"],
                    "size_id": size_id,
                    "quantity": stock,
                    "unit_cost": "1000.00",
                }
            ],
        },
        headers=key(),
    )
    assert received.status_code == 201, received.text

    sale_lines = lines or [
        {
            "product_variant_id": product["product_variant_id"],
            "size_id": size_id,
            "source_location_id": str(shop.location_id),
            "quantity": quantity,
            "unit_price": unit_price,
            "discount_amount": discount_amount,
        }
    ]
    sold = await client.post(
        "/api/v1/sales",
        json={
            "store_id": str(shop.store_id),
            "command_id": str(uuid.uuid4()),
            "lines": sale_lines,
        },
        headers=key(),
    )
    assert sold.status_code == 201, sold.text
    return Sold(shop, product, size_id, sold.json())


def refund_body(
    *lines: tuple[str, int, bool], command_id: str | None = None, **extra: Any
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "command_id": command_id or str(uuid.uuid4()),
        "lines": [
            {
                "sale_item_id": sale_item_id,
                "quantity": quantity,
                "restock": restock,
                # Goods that came back are stated intact unless a test says so.
                **({"condition": "INTACT"} if restock else {}),
            }
            for sale_item_id, quantity, restock in lines
        ],
    }
    payload.update(extra)
    return payload


async def refund(
    client: httpx.AsyncClient,
    sale_id: str,
    body: dict[str, Any],
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    return await client.post(
        f"/api/v1/sales/{sale_id}/refunds", json=body, headers=headers or key()
    )


async def stock_of(session: AsyncSession, sold: Sold) -> int:
    return (
        await session.scalar(
            select(Inventory.quantity).where(
                Inventory.location_id == sold.shop.location_id,
                Inventory.product_variant_id == uuid.UUID(sold.variant_id),
                Inventory.size_id == uuid.UUID(sold.size_id),
            )
        )
    ) or 0


async def refund_rows(session: AsyncSession, shop: Shop) -> int:
    return (
        await session.scalar(
            select(func.count())
            .select_from(Refund)
            .where(Refund.organization_id == shop.organization_id)
        )
    ) or 0


async def movements_of(
    session: AsyncSession, shop: Shop, movement_type: MovementType
) -> list[StockMovement]:
    return list(
        (
            await session.scalars(
                select(StockMovement).where(
                    StockMovement.organization_id == shop.organization_id,
                    StockMovement.movement_type == movement_type,
                )
            )
        ).all()
    )


# ---------------------------------------------------------------------------
# The workflow's required cases
# ---------------------------------------------------------------------------


async def test_a_full_refund_returns_the_money_and_the_stock(maker):
    """`.ai/workflows/refund.md`: full refund, restored stock, ledger entry."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        line = sold.line()
        # Sold 2 at 1500 less 100 → 1400 each, 2800 on the receipt.
        assert line["final_unit_price"] == "1400.00"
        assert sold.sale["total"] == "2800.00"

        response = await refund(client, sold.sale_id, refund_body((line["id"], 2, True)))
        assert response.status_code == 201, response.text
        body = response.json()

        # The money is the frozen line price times the units coming back —
        # exactly what was charged, to the kopeck.
        assert body["total_amount"] == "2800.00"
        assert body["currency_code"] == "UAH"
        assert body["items"][0]["amount"] == "2800.00"
        assert body["items"][0]["quantity"] == 2
        assert body["items"][0]["restock"] is True
        assert body["items"][0]["display_name"] == line["display_name"]
        assert body["store_id"] == str(shop.store_id)
        assert len(body["movements"]) == 1

    async with maker() as session:
        # Received 5, sold 2, refunded 2 → 5 on the shelf again.
        assert await stock_of(session, sold) == 5
        returns = await movements_of(session, shop, MovementType.REFUND_RETURN)
        assert len(returns) == 1
        assert returns[0].quantity_delta == 2
        assert returns[0].reference_type == "refund"
        assert str(returns[0].reference_id) == body["id"]
        # Invariant I3: the quantity and the ledger still agree.
        assert await find_divergences(session, location_id=shop.location_id) == []


async def test_a_partial_refund_leaves_the_rest_refundable(maker):
    """`.ai/workflows/refund.md`: partial refund, then the remainder."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=3)
        item = sold.line()["id"]

        first = await refund(client, sold.sale_id, refund_body((item, 1, True)))
        assert first.status_code == 201, first.text
        assert first.json()["total_amount"] == "1400.00"

        second = await refund(client, sold.sale_id, refund_body((item, 2, True)))
        assert second.status_code == 201, second.text
        assert second.json()["total_amount"] == "2800.00"

        # Three sold, three returned. A fourth is not owed.
        exhausted = await refund(client, sold.sale_id, refund_body((item, 1, True)))
        assert exhausted.status_code == 409, exhausted.text
        detail = exhausted.json()
        assert detail["code"] == "REFUND_EXCEEDS_SOLD"
        assert detail["details"]["already_refunded"] == 3
        assert detail["details"]["refundable"] == 0

    async with maker() as session:
        assert await stock_of(session, sold) == 5
        assert await refund_rows(session, shop) == 2
        assert await find_divergences(session, location_id=shop.location_id) == []


async def test_a_refund_is_capped_by_what_was_sold(maker):
    """Invariant I9, with nothing refunded yet: 3 back from a sale of 2."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        response = await refund(client, sold.sale_id, refund_body((sold.line()["id"], 3, True)))
        assert response.status_code == 409, response.text
        detail = response.json()
        assert detail["code"] == "REFUND_EXCEEDS_SOLD"
        assert detail["details"] == {
            "sale_item_id": sold.line()["id"],
            "requested": 3,
            "sold": 2,
            "already_refunded": 0,
            "refundable": 2,
        }

    async with maker() as session:
        assert await refund_rows(session, shop) == 0
        # Refused, so the goods never went back on the shelf either.
        assert await stock_of(session, sold) == 3


async def test_a_duplicate_refund_returns_the_original_and_moves_stock_once(maker):
    """`.ai/workflows/refund.md`: duplicate refund. Same key, same answer."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        body = refund_body((sold.line()["id"], 2, True))
        headers = key()

        first = await refund(client, sold.sale_id, body, headers)
        assert first.status_code == 201, first.text
        again = await refund(client, sold.sale_id, body, headers)
        assert again.status_code == 201, again.text
        assert again.json() == first.json()

    async with maker() as session:
        assert await refund_rows(session, shop) == 1
        assert len(await movements_of(session, shop, MovementType.REFUND_RETURN)) == 1
        assert await stock_of(session, sold) == 5


async def test_a_retry_after_the_cache_expires_still_returns_the_original_refund(maker):
    """Invariant I20: the permanent `command_id`, not the 7-day cache, is what
    stops a second refund. A retry that arrives after the record is gone gets
    the original answer rather than a unique-violation error."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        body = refund_body((sold.line()["id"], 2, True))

        first = await refund(client, sold.sale_id, body)
        assert first.status_code == 201, first.text

        async with maker() as session:
            await session.execute(
                delete(IdempotencyRecord).where(
                    IdempotencyRecord.organization_id == shop.organization_id
                )
            )
            await session.commit()

        # A fresh cache key, the same permanent command.
        replayed = await refund(client, sold.sale_id, body, key())
        assert replayed.status_code == 201, replayed.text
        assert replayed.json() == first.json()

    async with maker() as session:
        assert await refund_rows(session, shop) == 1
        assert len(await movements_of(session, shop, MovementType.REFUND_RETURN)) == 1
        assert await stock_of(session, sold) == 5


async def test_the_same_command_id_with_a_different_request_is_refused(maker):
    """One permanent command cannot become two different refunds."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=3)
        item = sold.line()["id"]
        command_id = str(uuid.uuid4())

        first = await refund(
            client, sold.sale_id, refund_body((item, 1, True), command_id=command_id)
        )
        assert first.status_code == 201, first.text

        changed = await refund(
            client, sold.sale_id, refund_body((item, 2, True), command_id=command_id)
        )
        assert changed.status_code == 409, changed.text
        assert changed.json()["code"] == "IDEMPOTENCY_CONFLICT"
        assert changed.json()["details"]["command_id"] == command_id

    async with maker() as session:
        assert await refund_rows(session, shop) == 1


async def test_one_key_cannot_replay_an_answer_about_a_different_sale(maker):
    """`sale_id` is a path parameter, so it has to be folded into both
    fingerprints by hand.

    The body below is *byte-identical* between the two calls — same command id,
    same line — and only the receipt in the URL differs. That is the only shape
    that isolates the path parameter: if `sale_id` were left out, the router
    would replay the first refund from its cache, and the service would replay
    it from the permanent command, both answering 201 about a receipt the
    caller never named.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        first_sale = await sell(client, shop, stock=5, quantity=2)
        second_sale = await sell(client, shop, stock=5, quantity=2)
        body = refund_body((first_sale.line()["id"], 1, True))
        shared = key()

        done = await refund(client, first_sale.sale_id, body, shared)
        assert done.status_code == 201, done.text

        # Same cache key: the router must not answer from its cache.
        cached = await refund(client, second_sale.sale_id, body, shared)
        assert cached.status_code == 409, cached.text
        assert cached.json()["code"] == "IDEMPOTENCY_CONFLICT"

        # Fresh cache key, same permanent command: the durable replay must not
        # answer either.
        durable = await refund(client, second_sale.sale_id, body, key())
        assert durable.status_code == 409, durable.text
        assert durable.json()["code"] == "IDEMPOTENCY_CONFLICT"

    async with maker() as session:
        assert await refund_rows(session, shop) == 1
        # The second sale keeps everything it sold; nothing was refunded for it.
        assert await stock_of(session, second_sale) == 3


# ---------------------------------------------------------------------------
# History is not rewritten
# ---------------------------------------------------------------------------


async def test_a_refund_never_changes_the_sale(maker):
    """`.ai/workflows/refund.md`: historical sale totals unchanged.

    Compared column by column, not just on the totals: a refund is a
    compensating row written beside the receipt, and the receipt is evidence.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)

        async with maker() as session:
            before_sale = (
                (
                    await session.execute(
                        text("SELECT * FROM sale WHERE id = :id"), {"id": sold.sale_id}
                    )
                )
                .mappings()
                .one()
            )
            before_items = (
                (
                    await session.execute(
                        text("SELECT * FROM sale_item WHERE sale_id = :id ORDER BY id"),
                        {"id": sold.sale_id},
                    )
                )
                .mappings()
                .all()
            )

        assert (
            await refund(client, sold.sale_id, refund_body((sold.line()["id"], 2, True)))
        ).status_code == 201

        async with maker() as session:
            after_sale = (
                (
                    await session.execute(
                        text("SELECT * FROM sale WHERE id = :id"), {"id": sold.sale_id}
                    )
                )
                .mappings()
                .one()
            )
            after_items = (
                (
                    await session.execute(
                        text("SELECT * FROM sale_item WHERE sale_id = :id ORDER BY id"),
                        {"id": sold.sale_id},
                    )
                )
                .mappings()
                .all()
            )

        assert dict(after_sale) == dict(before_sale)
        assert [dict(row) for row in after_items] == [dict(row) for row in before_items]

        # And the receipt still reads the same over HTTP.
        reread = await client.get(f"/api/v1/sales/{sold.sale_id}")
        assert reread.status_code == 200
        assert reread.json() == sold.sale


async def test_the_refund_price_comes_from_the_receipt_not_the_catalog(maker):
    """Invariant I8. The concept is renamed between the two refunds; the
    second one still refunds what was charged, under the name it was sold
    under. The refund module cannot import catalog at all — an import-linter
    contract enforces that — so this is structural, and the test is the proof
    that the structure holds end to end."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        item = sold.line()["id"]
        original_name = sold.line()["display_name"]

        first = await refund(client, sold.sale_id, refund_body((item, 1, True)))
        assert first.status_code == 201, first.text

        async with maker() as session:
            concept = await session.get(
                CanonicalConcept, uuid.UUID(sold.product["canonical_concept_id"])
            )
            assert concept is not None
            concept.display_name = "Совершенно другое имя"
            await session.commit()

        second = await refund(client, sold.sale_id, refund_body((item, 1, True)))
        assert second.status_code == 201, second.text
        assert second.json()["items"][0]["amount"] == first.json()["items"][0]["amount"]
        assert second.json()["items"][0]["display_name"] == original_name


async def test_a_refund_is_audited(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=3)
        item = sold.line()["id"]
        assert (await refund(client, sold.sale_id, refund_body((item, 1, True)))).status_code == 201
        response = await refund(
            client, sold.sale_id, refund_body((item, 1, False), reason="  испорчена молния  ")
        )
        assert response.status_code == 201, response.text

    async with maker() as session:
        entry = (
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.organization_id == shop.organization_id,
                    AuditLog.action == "sale.refunded",
                    AuditLog.entity_id == uuid.UUID(response.json()["id"]),
                )
            )
        ).one()
        assert entry.entity_type == "refund"
        assert entry.actor_user_id == shop.user_id
        # Trimmed at the boundary, stored trimmed, and audited as stored.
        assert entry.reason == "испорчена молния"
        assert response.json()["reason"] == "испорчена молния"
        # "One was already back before this one" is the fact that makes the
        # remaining quantity reviewable months later.
        assert entry.before["refunded_before"] == {item: 1}
        assert entry.after["refunded_now"] == {item: 1}
        assert entry.after["restocked"] == []
        assert entry.after["total_amount"] == "1400.00"


# ---------------------------------------------------------------------------
# Restock is a decision, not a default
# ---------------------------------------------------------------------------


async def test_a_refund_without_restock_returns_money_but_no_stock(maker):
    """The damaged coat the shop keeps. Money back, nothing on the rack."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        response = await refund(client, sold.sale_id, refund_body((sold.line()["id"], 2, False)))
        assert response.status_code == 201, response.text
        assert response.json()["total_amount"] == "2800.00"
        assert response.json()["movements"] == []
        assert response.json()["items"][0]["restock"] is False

    async with maker() as session:
        # Sold 2 out of 5 and kept them: still 3.
        assert await stock_of(session, sold) == 3
        assert await movements_of(session, shop, MovementType.REFUND_RETURN) == []
        assert await find_divergences(session, location_id=shop.location_id) == []


async def test_restock_must_be_stated(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop)
        response = await refund(
            client,
            sold.sale_id,
            {
                "command_id": str(uuid.uuid4()),
                "lines": [{"sale_item_id": sold.line()["id"], "quantity": 1}],
            },
        )
        assert response.status_code == 422, response.text


async def test_one_refund_may_mix_restocked_and_written_off_lines(maker):
    """Two lines of the same coat — the shop's own habit of ringing up a
    discounted unit separately — one back on the rack, one written off."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        created = await create_product(client, product_payload(shop))
        product = created.json()
        size_id = size_named(created, "M")
        await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shop.store_id),
                "location_id": str(shop.location_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_id,
                        "quantity": 6,
                    }
                ],
            },
            headers=key(),
        )
        sold_response = await client.post(
            "/api/v1/sales",
            json={
                "store_id": str(shop.store_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_id,
                        "source_location_id": str(shop.location_id),
                        "quantity": 1,
                        "unit_price": "1500.00",
                    },
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_id,
                        "source_location_id": str(shop.location_id),
                        "quantity": 1,
                        "unit_price": "1500.00",
                        "discount_amount": "500.00",
                    },
                ],
            },
            headers=key(),
        )
        assert sold_response.status_code == 201, sold_response.text
        sale = sold_response.json()
        sold = Sold(shop, product, size_id, sale)
        full_price, discounted = sale["items"][0]["id"], sale["items"][1]["id"]

        response = await refund(
            client, sold.sale_id, refund_body((full_price, 1, True), (discounted, 1, False))
        )
        assert response.status_code == 201, response.text
        body = response.json()
        # Each line refunds its own frozen price, not an average of the two.
        amounts = {item["sale_item_id"]: item["amount"] for item in body["items"]}
        assert amounts == {full_price: "1500.00", discounted: "1000.00"}
        assert body["total_amount"] == "2500.00"
        assert len(body["movements"]) == 1

    async with maker() as session:
        # Received 6, sold 2, one came back.
        assert await stock_of(session, sold) == 5
        assert await find_divergences(session, location_id=shop.location_id) == []


# ---------------------------------------------------------------------------
# Authority and tenancy
# ---------------------------------------------------------------------------


async def test_a_seller_without_refund_rights_is_refused(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop)

    async with api(maker, shop.scope(SELLER - {Permission.SALE_REFUND})) as client:
        response = await refund(client, sold.sale_id, refund_body((sold.line()["id"], 1, True)))
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "PERMISSION_DENIED"

    async with maker() as session:
        assert await refund_rows(session, shop) == 0
        # Refused before the key was claimed, so nothing is cached either.
        assert (
            await session.scalar(
                select(func.count())
                .select_from(IdempotencyRecord)
                .where(
                    IdempotencyRecord.organization_id == shop.organization_id,
                    IdempotencyRecord.endpoint == "POST /sales/{sale_id}/refunds",
                )
            )
        ) == 0


async def test_another_organization_cannot_refund_this_sale(maker):
    """Invariant I12. A foreign receipt is indistinguishable from a missing one."""
    shop = await make_shop(maker)
    stranger = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop)

    async with api(maker, stranger.scope()) as client:
        response = await refund(client, sold.sale_id, refund_body((sold.line()["id"], 1, True)))
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "NOT_FOUND"
        # No identifier belonging to the other organization leaks back.
        assert str(shop.store_id) not in response.text
        assert str(shop.organization_id) not in response.text

    async with maker() as session:
        assert await refund_rows(session, stranger) == 0
        assert await refund_rows(session, shop) == 0
        assert await stock_of(session, sold) == 3


async def test_a_line_from_another_sale_cannot_be_refunded(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        first_sale = await sell(client, shop)
        second_sale = await sell(client, shop)
        response = await refund(
            client, first_sale.sale_id, refund_body((second_sale.line()["id"], 1, True))
        )
        assert response.status_code == 404, response.text
        assert response.json()["details"]["sale_id"] == first_sale.sale_id

    async with maker() as session:
        assert await refund_rows(session, shop) == 0


async def test_only_a_completed_sale_can_be_refunded(maker):
    """Nothing voids a sale yet, so the status is forced here directly.

    The guard exists so that whenever a void command does land, it does not
    silently inherit the right to be refunded as well — and a guard nothing
    exercises is a guard nobody knows is broken.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)

        async with maker() as session:
            sale = await session.get(Sale, uuid.UUID(sold.sale_id))
            assert sale is not None
            sale.status = SaleStatus.VOIDED
            await session.commit()

        response = await refund(client, sold.sale_id, refund_body((sold.line()["id"], 1, True)))
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "VALIDATION_ERROR"
        assert response.json()["details"]["status"] == "VOIDED"

    async with maker() as session:
        assert await refund_rows(session, shop) == 0
        assert await stock_of(session, sold) == 3


async def test_a_refund_of_a_missing_sale_is_not_found(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        response = await refund(
            client, str(uuid.uuid4()), refund_body((str(uuid.uuid4()), 1, True))
        )
        assert response.status_code == 404, response.text


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------


async def test_one_sale_line_may_appear_only_once(maker):
    """Two entries for one line would each check a refundable quantity that
    ignores the other, and together they could exceed what was sold."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        item = sold.line()["id"]
        response = await refund(client, sold.sale_id, refund_body((item, 1, True), (item, 2, True)))
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "VALIDATION_ERROR"

    async with maker() as session:
        assert await refund_rows(session, shop) == 0
        assert await stock_of(session, sold) == 3


@pytest.mark.parametrize(
    "body_extra",
    [
        {"amount": "10.00"},
        {"store_id": "8f14e45f-ceea-467a-9b72-7bd2f1f8a0aa"},
        {"total_amount": "1.00"},
    ],
)
async def test_an_unsupported_top_level_field_is_refused(maker, body_extra):
    """A client that thinks it can quote the refund amount must find out, not
    have the field silently dropped and be told a different number."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop)
        response = await refund(
            client, sold.sale_id, refund_body((sold.line()["id"], 1, True), **body_extra)
        )
        assert response.status_code == 422, response.text


async def test_an_unsupported_line_field_is_refused(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop)
        response = await refund(
            client,
            sold.sale_id,
            {
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": sold.line()["id"],
                        "quantity": 1,
                        "restock": True,
                        "condition": "INTACT",
                        "amount": "1.00",
                    }
                ],
            },
        )
        assert response.status_code == 422, response.text


async def test_an_empty_reason_is_stored_as_none(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop)
        response = await refund(
            client, sold.sale_id, refund_body((sold.line()["id"], 1, True), reason="     ")
        )
        assert response.status_code == 201, response.text
        assert response.json()["reason"] is None


# ---------------------------------------------------------------------------
# Atomicity
# ---------------------------------------------------------------------------


async def test_a_refund_that_fails_halfway_leaves_nothing_behind(maker):
    """Two lines, the second one over the limit. The first line's money and
    stock must not survive the refusal (constitution: all-or-nothing)."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        created = await create_product(client, product_payload(shop))
        product = created.json()
        size_id = size_named(created, "M")
        await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shop.store_id),
                "location_id": str(shop.location_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size_id,
                        "quantity": 6,
                    }
                ],
            },
            headers=key(),
        )
        sale = (
            await client.post(
                "/api/v1/sales",
                json={
                    "store_id": str(shop.store_id),
                    "command_id": str(uuid.uuid4()),
                    "lines": [
                        {
                            "product_variant_id": product["product_variant_id"],
                            "size_id": size_id,
                            "source_location_id": str(shop.location_id),
                            "quantity": 1,
                            "unit_price": "1500.00",
                        },
                        {
                            "product_variant_id": product["product_variant_id"],
                            "size_id": size_id,
                            "source_location_id": str(shop.location_id),
                            "quantity": 1,
                            "unit_price": "1200.00",
                        },
                    ],
                },
                headers=key(),
            )
        ).json()
        sold = Sold(shop, product, size_id, sale)
        good, overreaching = sale["items"][0]["id"], sale["items"][1]["id"]

        response = await refund(
            client, sold.sale_id, refund_body((good, 1, True), (overreaching, 2, True))
        )
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "REFUND_EXCEEDS_SOLD"

    async with maker() as session:
        assert await refund_rows(session, shop) == 0
        assert (
            await session.scalar(
                select(func.count())
                .select_from(RefundItem)
                .join(Refund, Refund.id == RefundItem.refund_id)
                .where(Refund.organization_id == shop.organization_id)
            )
        ) == 0
        assert await movements_of(session, shop, MovementType.REFUND_RETURN) == []
        # Received 6, sold 2, refunded none.
        assert await stock_of(session, sold) == 4
        assert await find_divergences(session, location_id=shop.location_id) == []


# ---------------------------------------------------------------------------
# Concurrency — the case invariant I9 exists for
# ---------------------------------------------------------------------------


async def _observe_block(engine: AsyncEngine, pid: int) -> None:
    """Assert a real PostgreSQL lock wait rather than trusting task scheduling."""
    async with engine.connect() as observer:
        for _ in range(500):
            blocked = await observer.scalar(
                text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
            )
            if blocked:
                return
            await asyncio.sleep(0.01)
    pytest.fail("the contending refund never waited for the sale line lock")


async def test_two_simultaneous_refunds_of_one_line_cannot_both_succeed(
    maker: async_sessionmaker[AsyncSession], engine: AsyncEngine
):
    """`.ai/workflows/refund.md`: two simultaneous refunds of the same item.

    `refund <= sold - already refunded` is a check-then-act, so two refunds
    that each read the total before the other commits would both pass it and
    together return more than was ever sold. Firing them with `gather` is not
    a guard — whether they overlap at the critical moment is a coin flip — so
    the first transaction is held open on purpose, and the test asserts the
    second one is genuinely parked on a lock before letting go.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=1)
    item_id = uuid.UUID(sold.line()["id"])
    scope = shop.scope()

    started: asyncio.Future[int] = asyncio.get_running_loop().create_future()

    async def contender() -> str:
        async with maker() as session:
            pid = await session.scalar(text("SELECT pg_backend_pid()"))
            assert pid is not None
            started.set_result(pid)
            try:
                await create_refund(
                    session,
                    scope=scope,
                    sale_id=uuid.UUID(sold.sale_id),
                    command_id=uuid.uuid4(),
                    lines=[
                        RefundLineInput(
                            sale_item_id=item_id,
                            quantity=1,
                            restock=True,
                            condition=ReturnCondition.INTACT,
                        )
                    ],
                )
            except RefundExceedsSoldError:
                await session.rollback()
                return "refused"
            await session.commit()
            return "refunded"

    async with maker() as holder:
        await create_refund(
            holder,
            scope=scope,
            sale_id=uuid.UUID(sold.sale_id),
            command_id=uuid.uuid4(),
            lines=[
                RefundLineInput(
                    sale_item_id=item_id, quantity=1, restock=True, condition=ReturnCondition.INTACT
                )
            ],
        )
        task = asyncio.create_task(contender())
        try:
            await _observe_block(engine, await started)
            assert not task.done(), "the second refund should be waiting, not finished"
        finally:
            await holder.commit()
            outcome = await asyncio.wait_for(task, timeout=15)

    assert outcome == "refused", outcome

    async with maker() as session:
        assert await refund_rows(session, shop) == 1
        assert (
            await session.scalar(
                select(func.sum(RefundItem.quantity)).where(RefundItem.sale_item_id == item_id)
            )
        ) == 1
        # Received 5, sold 1, exactly one came back.
        assert await stock_of(session, sold) == 5
        assert await find_divergences(session, location_id=shop.location_id) == []


async def test_many_racing_refunds_return_exactly_what_was_sold(
    maker: async_sessionmaker[AsyncSession],
):
    """Eight callers, three units sold. Three succeed and the shelf shows it."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=3)
    item_id = uuid.UUID(sold.line()["id"])
    scope = shop.scope()

    async def attempt() -> str:
        async with maker() as session:
            try:
                await create_refund(
                    session,
                    scope=scope,
                    sale_id=uuid.UUID(sold.sale_id),
                    command_id=uuid.uuid4(),
                    lines=[
                        RefundLineInput(
                            sale_item_id=item_id,
                            quantity=1,
                            restock=True,
                            condition=ReturnCondition.INTACT,
                        )
                    ],
                )
            except RefundExceedsSoldError:
                await session.rollback()
                return "refused"
            await session.commit()
            return "refunded"

    outcomes = await asyncio.wait_for(asyncio.gather(*(attempt() for _ in range(8))), timeout=30)
    assert outcomes.count("refunded") == 3, outcomes
    assert outcomes.count("refused") == 5, outcomes

    async with maker() as session:
        assert (
            await session.scalar(
                select(func.sum(RefundItem.quantity)).where(RefundItem.sale_item_id == item_id)
            )
        ) == 3
        assert await stock_of(session, sold) == 5
        assert await find_divergences(session, location_id=shop.location_id) == []


async def test_a_refund_and_a_sale_of_the_same_item_agree_on_the_ledger(
    maker: async_sessionmaker[AsyncSession],
):
    """A refund and a sale of the same item, run together, leave the quantity
    and the ledger agreeing.

    Named for what it actually proves. It was called a deadlock test, and the
    independent review pointed out it could not fail as one: `POST /sales`
    never locks a `sale_item` row, so no ordering of the refund's own locks
    could deadlock against it. The lock-order guarantee is covered by
    `test_the_sale_line_lock_covers_the_whole_receipt` instead.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        item_id = uuid.UUID(sold.line()["id"])
        scope = shop.scope()

        async def give_back() -> None:
            async with maker() as session:
                await create_refund(
                    session,
                    scope=scope,
                    sale_id=uuid.UUID(sold.sale_id),
                    command_id=uuid.uuid4(),
                    lines=[
                        RefundLineInput(
                            sale_item_id=item_id,
                            quantity=2,
                            restock=True,
                            condition=ReturnCondition.INTACT,
                        )
                    ],
                )
                await session.commit()

        async def sell_more() -> int:
            response = await client.post(
                "/api/v1/sales",
                json={
                    "store_id": str(shop.store_id),
                    "command_id": str(uuid.uuid4()),
                    "lines": [
                        {
                            "product_variant_id": sold.variant_id,
                            "size_id": sold.size_id,
                            "source_location_id": str(shop.location_id),
                            "quantity": 1,
                            "unit_price": "1500.00",
                        }
                    ],
                },
                headers=key(),
            )
            return response.status_code

        _, status_code = await asyncio.wait_for(
            asyncio.gather(give_back(), sell_more()), timeout=30
        )
        assert status_code == 201

    async with maker() as session:
        # Received 5, sold 2, refunded 2, sold 1 more.
        assert await stock_of(session, sold) == 4
        assert await find_divergences(session, location_id=shop.location_id) == []


# ---------------------------------------------------------------------------
# Direct service calls — the boundary a non-HTTP caller would arrive at
# ---------------------------------------------------------------------------


async def test_the_service_refuses_what_the_schema_refuses(
    maker: async_sessionmaker[AsyncSession],
):
    """A Telegram handler calling the service directly gets the same refusals."""
    from app.core.errors import PermissionDeniedError, ValidationFailedError

    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
    item_id = uuid.UUID(sold.line()["id"])
    sale_id = uuid.UUID(sold.sale_id)

    async with maker() as session:
        with pytest.raises(ValidationFailedError):
            await create_refund(
                session, scope=shop.scope(), sale_id=sale_id, command_id=uuid.uuid4(), lines=[]
            )
        with pytest.raises(ValidationFailedError):
            await create_refund(
                session,
                scope=shop.scope(),
                sale_id=sale_id,
                command_id=uuid.uuid4(),
                lines=[
                    RefundLineInput(
                        sale_item_id=item_id,
                        quantity=0,
                        restock=True,
                        condition=ReturnCondition.INTACT,
                    )
                ],
            )
        with pytest.raises(ValidationFailedError):
            await create_refund(
                session,
                scope=shop.scope(),
                sale_id=sale_id,
                command_id=uuid.uuid4(),
                lines=[
                    RefundLineInput(
                        sale_item_id=item_id,
                        quantity=1,
                        restock=True,
                        condition=ReturnCondition.INTACT,
                    )
                ],
                reason="x" * 1001,
            )
        with pytest.raises(PermissionDeniedError):
            await create_refund(
                session,
                scope=shop.scope(SELLER - {Permission.SALE_REFUND}),
                sale_id=sale_id,
                command_id=uuid.uuid4(),
                lines=[
                    RefundLineInput(
                        sale_item_id=item_id,
                        quantity=1,
                        restock=True,
                        condition=ReturnCondition.INTACT,
                    )
                ],
            )
        await session.rollback()

    async with maker() as session:
        assert await refund_rows(session, shop) == 0


async def test_the_amount_is_exact_decimal_arithmetic(
    maker: async_sessionmaker[AsyncSession],
):
    """No float ever touches this. A price whose binary expansion is not exact
    still refunds to the kopeck, and the refund total equals the sale total."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(
            client, shop, stock=5, quantity=3, unit_price="1000.10", discount_amount="0.07"
        )
        assert sold.line()["final_unit_price"] == "1000.03"
        assert sold.sale["total"] == "3000.09"
        response = await refund(client, sold.sale_id, refund_body((sold.line()["id"], 3, True)))
        assert response.status_code == 201, response.text
        assert response.json()["total_amount"] == "3000.09"

    async with maker() as session:
        row = (
            await session.scalars(
                select(Refund).where(Refund.organization_id == shop.organization_id)
            )
        ).one()
        assert isinstance(row.total_amount, Decimal)
        assert row.total_amount == Decimal("3000.09")
        # The refund gives back exactly what the receipt charged.
        sale_row = await session.get(Sale, uuid.UUID(sold.sale_id))
        assert sale_row is not None
        assert row.total_amount == sale_row.total
        assert row.currency_code == sale_row.currency_code


async def test_a_refunded_receipt_still_reads_the_same_after_a_replay(
    maker: async_sessionmaker[AsyncSession],
):
    """The stored response snapshot and a freshly rebuilt one must agree."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        body = refund_body((sold.line()["id"], 2, True))
        original = await refund(client, sold.sale_id, body)
        assert original.status_code == 201, original.text

        async with maker() as session:
            stored = await session.get(Refund, uuid.UUID(original.json()["id"]))
            assert stored is not None
            # Drop the snapshot so the replay has to rebuild from rows.
            stored.response_snapshot = None
            await session.execute(
                delete(IdempotencyRecord).where(
                    IdempotencyRecord.organization_id == shop.organization_id
                )
            )
            await session.commit()

        rebuilt = await refund(client, sold.sale_id, body, key())
        assert rebuilt.status_code == 201, rebuilt.text
        assert rebuilt.json() == original.json()

    async with maker() as session:
        assert await refund_rows(session, shop) == 1
        assert len(await movements_of(session, shop, MovementType.REFUND_RETURN)) == 1


async def test_a_replay_is_refused_once_the_grant_is_gone(
    maker: async_sessionmaker[AsyncSession],
):
    """Invariant I13: a revoked seller does not keep receiving the success they
    were once entitled to, cached or durable."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        body = refund_body((sold.line()["id"], 2, True))
        headers = key()
        assert (await refund(client, sold.sale_id, body, headers)).status_code == 201

    # Only `sale:refund` goes. Revoking the whole membership would be caught
    # by `require_store` in several places at once, and the test would pass
    # with the pre-claim permission check deleted — which is the one thing it
    # is here to guard (found by the independent review, 2026-09-15).
    revoked = replace(
        shop.scope(),
        store_permissions={shop.store_id: SELLER - {Permission.SALE_REFUND}},
    )
    async with api(maker, revoked) as client:
        cached = await refund(client, sold.sale_id, body, headers)
        assert cached.status_code == 403, cached.text
        durable = await refund(client, sold.sale_id, body, key())
        assert durable.status_code == 403, durable.text


async def test_a_sale_item_is_never_touched_by_the_refund_query(
    maker: async_sessionmaker[AsyncSession],
):
    """The lock is `FOR UPDATE`, which is a lock and not an update. Proven by
    the row's own xmin: a real write would change it."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)

        async with maker() as session:
            before = await session.scalar(
                text("SELECT xmin::text FROM sale_item WHERE sale_id = :id"),
                {"id": sold.sale_id},
            )

        assert (
            await refund(client, sold.sale_id, refund_body((sold.line()["id"], 1, True)))
        ).status_code == 201

        async with maker() as session:
            after = await session.scalar(
                text("SELECT xmin::text FROM sale_item WHERE sale_id = :id"),
                {"id": sold.sale_id},
            )
    assert after == before


async def test_the_sale_line_lock_covers_the_whole_receipt(
    maker: async_sessionmaker[AsyncSession], engine: AsyncEngine
):
    """Two refunds against *different* lines of one sale still serialize.

    That is broader than invariant I9 strictly needs, and it is the deliberate
    choice: locking the whole receipt in a single id order is what makes the
    lock order provably identical in every refund, so two of them can never
    hold what the other is waiting for. The cost is that two returns from one
    receipt queue; the benefit is that they cannot deadlock.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        created = await create_product(client, product_payload(shop))
        product = created.json()
        size_m, size_l = size_named(created, "M"), size_named(created, "L")
        await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shop.store_id),
                "location_id": str(shop.location_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": s,
                        "quantity": 2,
                    }
                    for s in (size_m, size_l)
                ],
            },
            headers=key(),
        )
        sale = (
            await client.post(
                "/api/v1/sales",
                json={
                    "store_id": str(shop.store_id),
                    "command_id": str(uuid.uuid4()),
                    "lines": [
                        {
                            "product_variant_id": product["product_variant_id"],
                            "size_id": s,
                            "source_location_id": str(shop.location_id),
                            "quantity": 1,
                            "unit_price": "1500.00",
                        }
                        for s in (size_m, size_l)
                    ],
                },
                headers=key(),
            )
        ).json()

    first_line = uuid.UUID(sale["items"][0]["id"])
    second_line = uuid.UUID(sale["items"][1]["id"])
    scope = shop.scope()
    started: asyncio.Future[int] = asyncio.get_running_loop().create_future()

    async def other_line() -> None:
        async with maker() as session:
            pid = await session.scalar(text("SELECT pg_backend_pid()"))
            assert pid is not None
            started.set_result(pid)
            await create_refund(
                session,
                scope=scope,
                sale_id=uuid.UUID(sale["id"]),
                command_id=uuid.uuid4(),
                lines=[
                    RefundLineInput(
                        sale_item_id=second_line,
                        quantity=1,
                        restock=True,
                        condition=ReturnCondition.INTACT,
                    )
                ],
            )
            await session.commit()

    async with maker() as holder:
        await create_refund(
            holder,
            scope=scope,
            sale_id=uuid.UUID(sale["id"]),
            command_id=uuid.uuid4(),
            lines=[
                RefundLineInput(
                    sale_item_id=first_line,
                    quantity=1,
                    restock=True,
                    condition=ReturnCondition.INTACT,
                )
            ],
        )
        task = asyncio.create_task(other_line())
        try:
            await _observe_block(engine, await started)
            assert not task.done()
        finally:
            await holder.commit()
            await asyncio.wait_for(task, timeout=15)

    async with maker() as session:
        # Both refunds land: they queued, they did not fail.
        assert await refund_rows(session, shop) == 2
        assert await find_divergences(session, location_id=shop.location_id) == []


# ---------------------------------------------------------------------------
# Gaps found by the independent review, 2026-09-15
# ---------------------------------------------------------------------------


async def test_the_same_command_arriving_twice_at_once_is_serialized(
    maker: async_sessionmaker[AsyncSession], engine: AsyncEngine
):
    """The advisory lock on `(organization, command_id)` is load-bearing.

    Two requests carrying the same permanent `command_id` but different cache
    keys are not stopped by the sale-line lock: the second one reads
    `refund WHERE command_id = …` *before* it reaches that lock, sees nothing,
    and proceeds to insert. What it hits then is `uq_refund_org_command` — an
    unhandled `IntegrityError`, which is a 500 for what is a perfectly ordinary
    retry. The advisory lock is what turns that into a durable replay.

    Deleting the lock leaves every other test in this file green, which is why
    this one exists (ADR-0003; independent review, 2026-09-15).
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
    item_id = uuid.UUID(sold.line()["id"])
    scope = shop.scope()
    command_id = uuid.uuid4()
    started: asyncio.Future[int] = asyncio.get_running_loop().create_future()

    def command(session: AsyncSession):
        return create_refund(
            session,
            scope=scope,
            sale_id=uuid.UUID(sold.sale_id),
            command_id=command_id,
            lines=[
                RefundLineInput(
                    sale_item_id=item_id, quantity=1, restock=True, condition=ReturnCondition.INTACT
                )
            ],
        )

    async def retry() -> str:
        async with maker() as session:
            pid = await session.scalar(text("SELECT pg_backend_pid()"))
            assert pid is not None
            started.set_result(pid)
            result = await command(session)
            await session.commit()
            return str(result.refund.id)

    async with maker() as holder:
        first = await command(holder)
        first_id = str(first.refund.id)
        task = asyncio.create_task(retry())
        try:
            await _observe_block(engine, await started)
            assert not task.done(), "the duplicate command should be waiting on the advisory lock"
        finally:
            await holder.commit()
            replayed = await asyncio.wait_for(task, timeout=15)

    # The retry got the original refund back, not a second one and not a crash.
    assert replayed == first_id

    async with maker() as session:
        assert await refund_rows(session, shop) == 1
        assert (
            await session.scalar(
                select(func.sum(RefundItem.quantity)).where(RefundItem.sale_item_id == item_id)
            )
        ) == 1
        assert await stock_of(session, sold) == 4
        assert await find_divergences(session, location_id=shop.location_id) == []


async def test_a_rebuilt_multi_line_replay_matches_the_original_exactly(
    maker: async_sessionmaker[AsyncSession],
):
    """A refund whose response snapshot is absent must rebuild identically.

    The single-line version of this test could not see the defect it was
    written for: creation returned lines in request order while the rebuild
    returned them ordered by sale line, so a two-line refund sent in the other
    order replayed with its lines transposed. A refund created off HTTP — by
    the Telegram handler this module anticipates — has no snapshot at all, so
    the rebuild is its *only* path (independent review, 2026-09-15).
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        created = await create_product(
            client, product_payload(shop, concept=f"Лоран-{uuid.uuid4().hex[:8]}")
        )
        product = created.json()
        sizes = [size_named(created, code) for code in ("M", "L")]
        await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shop.store_id),
                "location_id": str(shop.location_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": product["product_variant_id"],
                        "size_id": size,
                        "quantity": 2,
                    }
                    for size in sizes
                ],
            },
            headers=key(),
        )
        sale = (
            await client.post(
                "/api/v1/sales",
                json={
                    "store_id": str(shop.store_id),
                    "command_id": str(uuid.uuid4()),
                    "lines": [
                        {
                            "product_variant_id": product["product_variant_id"],
                            "size_id": size,
                            "source_location_id": str(shop.location_id),
                            "quantity": 1,
                            "unit_price": price,
                        }
                        for size, price in zip(sizes, ["1500.00", "1200.00"], strict=True)
                    ],
                },
                headers=key(),
            )
        ).json()
        sold = Sold(shop, product, sizes[0], sale)

        # Deliberately the reverse of the order the rebuild reads them in.
        by_id = sorted(item["id"] for item in sale["items"])
        body = refund_body((by_id[1], 1, True), (by_id[0], 1, True))
        original = await refund(client, sold.sale_id, body)
        assert original.status_code == 201, original.text
        assert len(original.json()["items"]) == 2

        async with maker() as session:
            stored = await session.get(Refund, uuid.UUID(original.json()["id"]))
            assert stored is not None
            stored.response_snapshot = None
            await session.execute(
                delete(IdempotencyRecord).where(
                    IdempotencyRecord.organization_id == shop.organization_id
                )
            )
            await session.commit()

        rebuilt = await refund(client, sold.sale_id, body, key())
        assert rebuilt.status_code == 201, rebuilt.text
        assert rebuilt.json() == original.json()

    async with maker() as session:
        assert await refund_rows(session, shop) == 1
        assert await find_divergences(session, location_id=shop.location_id) == []


async def test_a_sale_in_a_sibling_store_cannot_be_refunded(maker):
    """`.ai/workflows/refund.md`: cross-store access rejected.

    Two stores in one organization is this business's actual shape
    (`.ai/project.md`: one primary and one related store), so the refusal that
    matters is not only the cross-tenant one.
    """
    shop = await make_shop(maker)
    async with maker() as session:
        sibling = Store(
            organization_id=shop.organization_id,
            name="Друга",
            code=f"S{uuid.uuid4().hex[:6]}",
            kind=StoreKind.SECONDARY,
        )
        session.add(sibling)
        await session.commit()
        sibling_id = sibling.id

    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop)

    # A seller who works only in the sibling store, with full seller rights there.
    outsider = replace(shop.scope(), store_permissions={sibling_id: SELLER})
    async with api(maker, outsider) as client:
        response = await refund(client, sold.sale_id, refund_body((sold.line()["id"], 1, True)))
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "FORBIDDEN_STORE"

    async with maker() as session:
        assert await refund_rows(session, shop) == 0
        assert await stock_of(session, sold) == 3


async def test_restocking_into_a_closed_store_is_refused_whole(maker):
    """A defined failure state, not an accident.

    A closed store can give money back; it has no shelf to put goods on. Both
    halves are pinned here so that split is a decision on record rather than
    something discovered later — and so that the refusal takes the *whole*
    refund with it rather than paying the money while silently skipping the
    stock.

    Whether the split is what the owner wants is an open question; the
    alternative is to refuse the refund outright and send the customer to the
    store that is still trading.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)

        async with maker() as session:
            store = await session.get(Store, shop.store_id)
            assert store is not None
            store.is_active = False
            await session.commit()

        blocked = await refund(client, sold.sale_id, refund_body((sold.line()["id"], 1, True)))
        assert blocked.status_code == 422, blocked.text
        assert blocked.json()["code"] == "VALIDATION_ERROR"
        # The message names the real reason. It used to come out of
        # `lock_stock` as "Unknown store" — about a store the caller is
        # standing in (independent review, 2026-09-15).
        assert "closed" in blocked.json()["message"]
        assert blocked.json()["details"]["store_id"] == str(shop.store_id)

        async with maker() as session:
            assert await refund_rows(session, shop) == 0
            assert await stock_of(session, sold) == 3

        written_off = await refund(client, sold.sale_id, refund_body((sold.line()["id"], 1, False)))
        assert written_off.status_code == 201, written_off.text
        assert written_off.json()["movements"] == []

    async with maker() as session:
        assert await refund_rows(session, shop) == 1
        assert await stock_of(session, sold) == 3


@pytest.mark.parametrize("quantity", [True, "2", 2.0, 2.5, None])
async def test_a_quantity_that_is_not_an_integer_is_refused(maker, quantity):
    """`true` must not become one coat. Pydantic's lax mode would coerce every
    value here into a plausible integer, and each one is money going back on a
    number the client did not mean to send (independent review)."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        response = await refund(
            client,
            sold.sale_id,
            {
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": sold.line()["id"],
                        "quantity": quantity,
                        "restock": True,
                        "condition": "INTACT",
                    }
                ],
            },
        )
        assert response.status_code == 422, f"{quantity!r}: {response.text}"

    async with maker() as session:
        assert await refund_rows(session, shop) == 0
        assert await stock_of(session, sold) == 3


async def test_the_service_guards_that_http_never_reaches_still_hold(
    maker: async_sessionmaker[AsyncSession],
):
    """Defence in depth that nothing exercises is defence in depth that rots.

    Each of these is unreachable through the router — the schema refuses it
    first, or the router's own permission check does — and each is reachable by
    a direct caller (independent review).
    """
    from app.core.errors import PermissionDeniedError, ValidationFailedError

    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
    sale_id = uuid.UUID(sold.sale_id)
    item_id = uuid.UUID(sold.line()["id"])

    async with maker() as session:
        # More lines than the command accepts.
        with pytest.raises(ValidationFailedError):
            await create_refund(
                session,
                scope=shop.scope(),
                sale_id=sale_id,
                command_id=uuid.uuid4(),
                lines=[
                    RefundLineInput(
                        sale_item_id=uuid.uuid4(),
                        quantity=1,
                        restock=True,
                        condition=ReturnCondition.INTACT,
                    )
                    for _ in range(101)
                ],
            )
        # `restock` stated as something that is not a decision.
        with pytest.raises(ValidationFailedError):
            await create_refund(
                session,
                scope=shop.scope(),
                sale_id=sale_id,
                command_id=uuid.uuid4(),
                lines=[RefundLineInput(sale_item_id=item_id, quantity=1, restock="yes")],  # type: ignore[arg-type]
            )
        await session.rollback()

    # A durable replay still requires the right to see what it returns.
    command_id = uuid.uuid4()
    async with maker() as session:
        await create_refund(
            session,
            scope=shop.scope(),
            sale_id=sale_id,
            command_id=command_id,
            lines=[
                RefundLineInput(
                    sale_item_id=item_id, quantity=1, restock=True, condition=ReturnCondition.INTACT
                )
            ],
        )
        await session.commit()

    async with maker() as session:
        with pytest.raises(PermissionDeniedError):
            await create_refund(
                session,
                scope=shop.scope(SELLER - {Permission.SALE_REFUND}),
                sale_id=sale_id,
                command_id=command_id,
                lines=[
                    RefundLineInput(
                        sale_item_id=item_id,
                        quantity=1,
                        restock=True,
                        condition=ReturnCondition.INTACT,
                    )
                ],
            )
        await session.rollback()

    # …but losing only `sale:view` must NOT stop a caller from learning the
    # outcome of a refund it was authorized to issue.
    async with maker() as session:
        replayed = await create_refund(
            session,
            scope=shop.scope(SELLER - {Permission.SALE_VIEW}),
            sale_id=sale_id,
            command_id=command_id,
            lines=[
                RefundLineInput(
                    sale_item_id=item_id, quantity=1, restock=True, condition=ReturnCondition.INTACT
                )
            ],
        )
        assert replayed.refund.command_id == command_id
        await session.rollback()

    async with maker() as session:
        assert await refund_rows(session, shop) == 1


@pytest.mark.parametrize("restock", ["yes", 1, 0, "true", None])
async def test_a_restock_flag_that_is_not_a_decision_is_refused(maker, restock):
    """`"yes"` and `1` must not become "put it back on the rack".

    The service guard says restock is stated explicitly, and Pydantic's lax
    mode would have coerced all of these before the guard could see them —
    the schema deciding what a person is supposed to decide (independent
    review, 2026-09-15).
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        response = await refund(
            client,
            sold.sale_id,
            {
                "command_id": str(uuid.uuid4()),
                "lines": [{"sale_item_id": sold.line()["id"], "quantity": 1, "restock": restock}],
            },
        )
        assert response.status_code == 422, f"{restock!r}: {response.text}"

    async with maker() as session:
        assert await refund_rows(session, shop) == 0
        assert await stock_of(session, sold) == 3


async def test_a_refund_whose_original_request_cannot_be_proven_is_not_guessed(maker):
    """Revision 0004 is reversible, so a NULL fingerprint is a state that can
    really occur: a refund taken while the migration was rolled back.

    A retry of such a command must be refused, not assumed to match — and
    still must never produce a second refund (the permanent unique constraint
    survives the downgrade).
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop, stock=5, quantity=2)
        body = refund_body((sold.line()["id"], 1, True))
        original = await refund(client, sold.sale_id, body)
        assert original.status_code == 201, original.text

        async with maker() as session:
            stored = await session.get(Refund, uuid.UUID(original.json()["id"]))
            assert stored is not None
            stored.command_fingerprint = None
            await session.execute(
                delete(IdempotencyRecord).where(
                    IdempotencyRecord.organization_id == shop.organization_id
                )
            )
            await session.commit()

        retried = await refund(client, sold.sale_id, body, key())
        assert retried.status_code == 409, retried.text
        assert retried.json()["code"] == "IDEMPOTENCY_CONFLICT"
        assert "cannot be verified" in retried.json()["message"]

    async with maker() as session:
        assert await refund_rows(session, shop) == 1
        assert await stock_of(session, sold) == 4


async def test_a_lone_surrogate_is_refused_not_crashed(maker):
    """A value JSON cannot round-trip must not take the error handler with it.

    FastAPI echoes the offending input back in its 422 body; a lone UTF-16
    surrogate then breaks the encoder rendering that body, and the caller gets
    a 500 for an ordinary validation failure. Reachable on every endpoint
    (independent security review, 2026-09-15).
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop)
        response = await client.post(
            f"/api/v1/sales/{sold.sale_id}/refunds",
            headers={**key(), "Content-Type": "application/json"},
            content=(
                '{"command_id": "' + str(uuid.uuid4()) + '", "reason": "\\ud800", "lines": '
                '[{"sale_item_id": "'
                + sold.line()["id"]
                + '", "quantity": 1, "restock": true, "condition": "INTACT"}]}'
            ).encode(),
        )
        assert response.status_code == 422, f"{response.status_code}: {response.text[:300]}"

        # The same shape on the sale endpoint, which had the same defect.
        sale_response = await client.post(
            "/api/v1/sales",
            headers={**key(), "Content-Type": "application/json"},
            content=b'{"store_id": "\\ud800", "command_id": "x", "lines": []}',
        )
        assert sale_response.status_code == 422, sale_response.status_code

    async with maker() as session:
        assert await refund_rows(session, shop) == 0
