"""What a receipt says about a sale's stock, in units (redesign P1-1).

A receipt named its in-sale corrections as stock movements, «1 рух(и)
складу» — a size clarified writes two. It now says how many coats were found
on the shelf, written off as missing, and sold with a size read off a label,
counted from the movements the sale wrote; and each line names its size.
Answers stored before these fields keep their shape.
"""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.main import create_app
from app.modules.authz.permissions import Permission
from app.modules.catalog.models import Size
from app.modules.inventory.models import MovementReason, MovementType
from app.modules.inventory.service import MovementRequest, apply_movements
from app.modules.sales.models import Sale
from tests.conftest import requires_database
from tests.integration.test_sale_command import SELLER_PERMISSIONS, Shop, give_stock, make_shop

pytestmark = [pytest.mark.integration, requires_database()]

# Whoever may also write a shelf off as missing (M1-030).
COUNTER = SELLER_PERMISSIONS | {Permission.INVENTORY_REPORT_MISSING_DURING_SALE}


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@asynccontextmanager
async def client_for(maker, shop: Shop):
    app = create_app(Settings(app_env="local", session_secret="receipt-units-secret-32-bytes!!!"))

    async def sessions():
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    app.dependency_overrides[get_current_scope] = lambda: shop.scope(COUNTER)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://till"
    ) as client:
        yield client


def sale_of(shop: Shop, quantity: int, **answers: list[dict[str, int]]) -> dict:
    return {
        "store_id": str(shop.store_id),
        "command_id": str(uuid.uuid4()),
        "lines": [
            {
                "product_variant_id": str(shop.variant_id),
                "size_id": str(shop.size_id),
                "source_location_id": str(shop.location_id),
                "quantity": quantity,
                "unit_price": "1200.00",
            }
        ],
        "payment_method": "CASH",
        **answers,
    }


async def sell(client, body: dict) -> httpx.Response:
    return await client.post(
        "/api/v1/sales", headers={"Idempotency-Key": str(uuid.uuid4())}, json=body
    )


async def held_with_no_size(maker, shop: Shop, quantity: int) -> None:
    """Coats of the shop's model whose size nobody knows (ADR-0005 §11)."""
    async with maker() as session:
        system = await session.scalar(select(Size.size_system_id).where(Size.id == shop.size_id))
        unknown = Size(size_system_id=system, code="UNKNOWN", is_unknown=True)
        session.add(unknown)
        await session.flush()
        await apply_movements(
            session,
            organization_id=shop.organization_id,  # type: ignore[arg-type]
            requests=[
                MovementRequest(
                    location_id=shop.location_id,  # type: ignore[arg-type]
                    acting_store_id=shop.store_id,  # type: ignore[arg-type]
                    product_variant_id=shop.variant_id,  # type: ignore[arg-type]
                    size_id=unknown.id,
                    quantity_delta=quantity,
                    movement_type=MovementType.ADJUSTMENT,
                    reason_code=MovementReason.CORRECTION,
                )
            ],
        )
        await session.commit()


async def test_a_plain_sale_names_each_line_s_size_and_no_correction(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 2)
    async with client_for(maker, shop) as client:
        sold = await sell(client, sale_of(shop, 1))
        read = await client.get(f"/api/v1/sales/{sold.json()['id']}")
    assert sold.status_code == 201, sold.text
    body = sold.json()
    assert [item["size"] for item in body["items"]] == ["M"]
    assert (body["found_quantity"], body["missing_quantity"], body["clarified"]) == (0, 0, [])
    assert read.json() == body


async def test_goods_found_on_the_shelf_are_counted_in_units(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 2)
    async with client_for(maker, shop) as client:
        sold = await sell(
            client, sale_of(shop, 3, found_in_store=[{"line_index": 0, "quantity": 1}])
        )
    assert sold.status_code == 201, sold.text
    assert sold.json()["found_quantity"] == 1
    assert len(sold.json()["corrections"]) == 1


async def test_a_shortage_writes_off_what_the_ledger_believed_less_what_was_there(maker):
    """Three in the books, three asked for, one on the shelf: one sold, two
    written off. The seller said «one», never «two»."""
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 3)
    async with client_for(maker, shop) as client:
        sold = await sell(
            client, sale_of(shop, 3, missing_in_store=[{"line_index": 0, "quantity": 1}])
        )
    assert sold.status_code == 201, sold.text
    body = sold.json()
    assert body["missing_quantity"] == 2
    assert [item["quantity"] for item in body["items"]] == [1]


async def test_a_size_read_off_a_label_is_counted_once_by_its_size(maker):
    """Two movements, out of "size not known" and into M: one coat."""
    async with maker() as session:
        shop = await make_shop(session)
    await held_with_no_size(maker, shop, 2)
    async with client_for(maker, shop) as client:
        sold = await sell(
            client, sale_of(shop, 1, size_clarified=[{"line_index": 0, "quantity": 1}])
        )
        read = await client.get(f"/api/v1/sales/{sold.json()['id']}")
    assert sold.status_code == 201, sold.text
    body = sold.json()
    assert len(body["size_reclassifications"]) == 2
    assert body["clarified"] == [{"size": "M", "quantity": 1}]
    assert read.json()["clarified"] == body["clarified"]


async def test_a_sale_read_with_no_stored_answer_counts_from_the_ledger(maker):
    """Sales recorded before answers were stored are read from their rows."""
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 2)
    async with client_for(maker, shop) as client:
        sold = await sell(
            client, sale_of(shop, 3, found_in_store=[{"line_index": 0, "quantity": 1}])
        )
        async with maker() as session:
            await session.execute(
                update(Sale)
                .where(Sale.id == uuid.UUID(sold.json()["id"]))
                .values(response_snapshot=None)
            )
            await session.commit()
        read = await client.get(f"/api/v1/sales/{sold.json()['id']}")
    assert read.status_code == 200, read.text
    assert read.json()["found_quantity"] == 1
    assert [item["size"] for item in read.json()["items"]] == ["M"]


async def test_an_answer_stored_before_the_units_keeps_its_shape(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 2)
    async with client_for(maker, shop) as client:
        sold = await sell(client, sale_of(shop, 1))
        stored = {
            key: value
            for key, value in sold.json().items()
            if key not in {"found_quantity", "missing_quantity", "clarified"}
        }
        stored["items"] = [
            {key: value for key, value in item.items() if key != "size"} for item in stored["items"]
        ]
        async with maker() as session:
            await session.execute(
                update(Sale)
                .where(Sale.id == uuid.UUID(sold.json()["id"]))
                .values(response_snapshot=stored)
            )
            await session.commit()
        read = await client.get(f"/api/v1/sales/{sold.json()['id']}")
    body = read.json()
    assert (body["found_quantity"], body["missing_quantity"], body["clarified"]) == (
        None,
        None,
        None,
    )
    assert [item["size"] for item in body["items"]] == [None]
