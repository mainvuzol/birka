"""Text the database cannot store must be a 422, never a 500.

Found by the independent reviews of M1-017 and traced wider than that task.
Two values do it. A JSON string may legally carry `U+0000`, which a PostgreSQL
text column cannot hold (`CharacterNotInRepertoireError`); and it may carry a
lone surrogate such as `\ud800`, a legal Python `str` with no UTF-8 encoding
at all (`DataError`).
Both happen *after* the request has been authorized and has begun writing, so
the client sees an unhandled 500 — raised at will by the lowest-privileged
role, on every endpoint that stores free text.

The `Idempotency-Key` header is the widest instance: it is claimed by every
mutating endpoint before any business logic runs, so a NUL there crashed the
sale, receipt, adjustment and catalog commands equally. Those three were
pre-existing defects, not introduced by the refund work; they are fixed here
because they are the same one-line defect behind one shared helper.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.errors import ValidationFailedError
from app.modules.catalog.models import SizeSystemCode
from app.modules.catalog.service import ProductDraft, SizeDraft, VariantDraft
from app.modules.catalog.service import create_product as create_product_command
from app.modules.refunds.service import RefundLineInput, create_refund
from tests.conftest import requires_database
from tests.integration.test_product_lifecycle_api import (
    Shop,
    api,
    create_product,
    key,
    make_shop,
    product_payload,
    size_named,
)
from tests.integration.test_refund_command import refund, refund_body, sell

pytestmark = [pytest.mark.integration, requires_database()]

# Built from `chr(0)` rather than imported from `app.core.text`: a test that
# takes its poison from the module under test stops being a test of it. Proven
# the hard way — neutralising the guard left eight of these passing, because
# their NUL had come from the same constant.
NUL = chr(0)
SURROGATE = "\ud800"
POISON = "bad" + NUL + "text"


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def stocked_variant(client: httpx.AsyncClient, shop: Shop) -> tuple[str, str]:
    created = await create_product(
        client, product_payload(shop, concept=f"Лоран-{uuid.uuid4().hex[:8]}")
    )
    assert created.status_code == 201, created.text
    product = created.json()
    size_id = size_named(created, "M")
    received = await client.post(
        "/api/v1/inventory/receipts",
        json={
            "store_id": str(shop.store_id),
            "lines": [
                {
                    "product_variant_id": product["product_variant_id"],
                    "size_id": size_id,
                    "quantity": 2,
                }
            ],
        },
        headers=key(),
    )
    assert received.status_code == 201, received.text
    return str(product["product_variant_id"]), size_id


# ---------------------------------------------------------------------------
# The header every mutating endpoint claims before it does anything
# ---------------------------------------------------------------------------


async def test_a_nul_in_the_idempotency_key_is_refused_by_every_command(maker):
    """The widest instance: the key is claimed before any business logic, so a
    NUL here crashed sale, receipt, adjustment, catalog and refund alike."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        variant_id, size_id = await stocked_variant(client, shop)
        poisoned = {"Idempotency-Key": "abcdefgh" + NUL}

        requests: list[tuple[str, str, dict[str, Any]]] = [
            (
                "receipt",
                "/api/v1/inventory/receipts",
                {
                    "store_id": str(shop.store_id),
                    "lines": [
                        {"product_variant_id": variant_id, "size_id": size_id, "quantity": 1}
                    ],
                },
            ),
            (
                "sale",
                "/api/v1/sales",
                {
                    "store_id": str(shop.store_id),
                    "command_id": str(uuid.uuid4()),
                    "lines": [
                        {
                            "product_variant_id": variant_id,
                            "size_id": size_id,
                            "quantity": 1,
                            "unit_price": "100.00",
                        }
                    ],
                },
            ),
            ("catalog", "/api/v1/catalog/products", product_payload(shop, concept="Нове")),
        ]
        for name, url, body in requests:
            response = await client.post(url, json=body, headers=poisoned)
            assert response.status_code == 422, f"{name}: {response.status_code} {response.text}"


# ---------------------------------------------------------------------------
# Free-text fields, endpoint by endpoint
# ---------------------------------------------------------------------------


async def test_a_nul_in_a_refund_reason_is_refused(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop)
        response = await refund(
            client, sold.sale_id, refund_body((sold.line()["id"], 1, True), reason=POISON)
        )
        assert response.status_code == 422, response.text


async def test_a_nul_in_receipt_notes_is_refused(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        variant_id, size_id = await stocked_variant(client, shop)
        response = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shop.store_id),
                "notes": POISON,
                "lines": [{"product_variant_id": variant_id, "size_id": size_id, "quantity": 1}],
            },
            headers=key(),
        )
        assert response.status_code == 422, response.text


async def test_a_nul_in_an_adjustment_note_is_refused(maker):
    from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode

    shop = await make_shop(maker)
    manager = shop.scope(DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER])
    async with api(maker, manager) as client:
        variant_id, size_id = await stocked_variant(client, shop)
        response = await client.post(
            "/api/v1/inventory/adjustments",
            json={
                "store_id": str(shop.store_id),
                "product_variant_id": variant_id,
                "size_id": size_id,
                "quantity_delta": 1,
                "reason_code": "CORRECTION",
                "note": POISON,
            },
            headers=key(),
        )
        assert response.status_code == 422, response.text


@pytest.mark.parametrize("field", ["concept", "source", "business_category", "garment_type"])
async def test_a_nul_in_a_catalog_name_is_refused(maker, field):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        response = await create_product(client, product_payload(shop, **{field: POISON}))
        assert response.status_code == 422, response.text


async def test_a_nul_in_a_variant_attribute_or_size_code_is_refused(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        attribute = await create_product(
            client,
            product_payload(shop, variant={"color": POISON}, concept=f"A-{uuid.uuid4().hex[:6]}"),
        )
        assert attribute.status_code == 422, attribute.text

        size = await create_product(
            client,
            product_payload(
                shop,
                concept=f"B-{uuid.uuid4().hex[:6]}",
                sizes=[{"system": "ALPHA", "code": POISON}],
            ),
        )
        assert size.status_code == 422, size.text


async def test_a_nul_in_a_distinction_note_is_refused(maker):
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        concept = f"Лоран-{uuid.uuid4().hex[:8]}"
        first = await create_product(client, product_payload(shop, concept=concept))
        assert first.status_code == 201, first.text
        second = await create_product(
            client,
            product_payload(shop, concept=concept, new_model=True, distinction_note=POISON),
        )
        assert second.status_code == 422, second.text


# ---------------------------------------------------------------------------
# The same refusal for a caller that never touches HTTP
# ---------------------------------------------------------------------------


async def test_the_services_refuse_a_nul_without_the_router(maker):
    """A Telegram handler calling a command directly must get the same 422, not
    a driver error — the schema validators alone would not save it."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop)
    sale_item_id = uuid.UUID(sold.line()["id"])

    async with maker() as session:
        with pytest.raises(ValidationFailedError):
            await create_refund(
                session,
                scope=shop.scope(),
                sale_id=uuid.UUID(sold.sale_id),
                command_id=uuid.uuid4(),
                lines=[RefundLineInput(sale_item_id=sale_item_id, quantity=1, restock=True)],
                reason=POISON,
            )
        with pytest.raises(ValidationFailedError):
            await create_product_command(
                session,
                organization_id=shop.organization_id,
                actor_user_id=shop.user_id,
                draft=ProductDraft(
                    concept=POISON,
                    variant=VariantDraft(color="беж"),
                    sizes=(SizeDraft(system=SizeSystemCode.ALPHA, code="M"),),
                ),
            )
        with pytest.raises(ValidationFailedError):
            await create_product_command(
                session,
                organization_id=shop.organization_id,
                actor_user_id=shop.user_id,
                draft=ProductDraft(
                    concept=f"C-{uuid.uuid4().hex[:6]}",
                    variant=VariantDraft(color="беж"),
                    sizes=(SizeDraft(system=SizeSystemCode.ALPHA, code=POISON),),
                ),
            )
        await session.rollback()


# ---------------------------------------------------------------------------
# The other half of the class: a string with no UTF-8 encoding at all
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("escape", ["\\u0000", "\\ud800", "\\udfff"])
async def test_unstorable_text_is_refused_everywhere_it_is_accepted(maker, escape):
    """A lone surrogate passes JSON parsing and Pydantic — it is a perfectly
    ordinary Python `str` — and then has no UTF-8 encoding when asyncpg tries
    to send it. Same 500, different driver error (independent security review,
    2026-09-15).

    The body is built as raw bytes on purpose: an HTTP client cannot serialize
    a lone surrogate into a request, so the only way one arrives is as a JSON
    escape sequence that the server's parser decodes. That is the real path,
    and sending it any other way would test the client instead.
    """
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        sold = await sell(client, shop)
        body = (
            f'{{"command_id": "{uuid.uuid4()}", "reason": "bad{escape}text", "lines": '
            f'[{{"sale_item_id": "{sold.line()["id"]}", "quantity": 1, "restock": true}}]}}'
        )
        response = await client.post(
            f"/api/v1/sales/{sold.sale_id}/refunds",
            headers={**key(), "Content-Type": "application/json"},
            content=body.encode(),
        )
        assert response.status_code == 422, (
            f"{escape}: {response.status_code} {response.text[:200]}"
        )

        catalog_body = (
            f'{{"store_id": "{shop.store_id}", "concept": "bad{escape}text", '
            f'"variant": {{}}, "sizes": [{{"system": "ALPHA", "code": "M"}}]}}'
        )
        catalog = await client.post(
            "/api/v1/catalog/products",
            headers={**key(), "Content-Type": "application/json"},
            content=catalog_body.encode(),
        )
        assert catalog.status_code == 422, f"{escape}: {catalog.status_code} {catalog.text[:200]}"

    async with maker() as session:
        from app.modules.refunds.models import Refund

        assert (
            await session.scalar(
                select(func.count())
                .select_from(Refund)
                .where(Refund.organization_id == shop.organization_id)
            )
        ) == 0


async def test_a_validation_error_about_unencodable_input_still_renders(maker):
    """FastAPI echoes the offending value back inside its 422 body. When that
    value cannot be encoded, rendering the error used to fail and the client
    got a 500 for an ordinary validation failure."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        response = await client.post(
            "/api/v1/sales",
            headers={**key(), "Content-Type": "application/json"},
            content=b'{"store_id": "\\ud800", "command_id": "not-a-uuid", "lines": []}',
        )
        assert response.status_code == 422, f"{response.status_code}: {response.text[:300]}"
        # The body is renderable, and still says which field was at fault.
        assert "store_id" in response.text
