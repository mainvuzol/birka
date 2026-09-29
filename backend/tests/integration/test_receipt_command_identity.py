"""A goods receipt is a business operation, not just its side effects.

Every other command that writes stock — a sale, a refund, a transfer, an
approved legacy list — carries a permanent `command_id` under
`UNIQUE (organization_id, command_id)`. That is invariant I20: *a critical
command can never create a second business operation, at any distance in
time.* Receiving goods did not, and nothing recorded a decision to exempt it.

Before `0016` the protection was the 7-day response cache and nothing else.
The first test here is the reproduction that was run against the old code:
delete the cache row, replay the identical request, and the delivery is
received twice. The client pattern that reaches past seven days is the
ordinary one — a command written to durable storage before it is sent and
replayed when the app is opened again, which is exactly what the till does
for a sale.
"""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.core.idempotency import IdempotencyRecord
from app.main import create_app
from app.modules.authz.permissions import Permission
from app.modules.inventory.models import GoodsReceipt, StockLot
from app.modules.inventory.service import current_quantity
from tests.conftest import requires_database
from tests.integration.test_sale_command import make_shop

pytestmark = [pytest.mark.integration, requires_database()]

RECEIVER = frozenset({Permission.INVENTORY_RECEIVE, Permission.INVENTORY_VIEW})


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@asynccontextmanager
async def client_for(maker, shop, permissions=RECEIVER):
    app = create_app(Settings(app_env="local", session_secret="receipt-secret-32-bytes-long!!!"))

    async def sessions():
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    app.dependency_overrides[get_current_scope] = lambda: shop.scope(permissions)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://warehouse"
    ) as client:
        yield client


def delivery(shop, command_id: uuid.UUID, *, quantity: int = 10) -> dict:
    return {
        "store_id": str(shop.store_id),
        "location_id": str(shop.location_id),
        "command_id": str(command_id),
        "lines": [
            {
                "product_variant_id": str(shop.variant_id),
                "size_id": str(shop.size_id),
                "quantity": quantity,
            }
        ],
    }


async def held(maker, shop) -> tuple[int, int]:
    async with maker() as session:
        quantity = await current_quantity(
            session,
            location_id=shop.location_id,
            product_variant_id=shop.variant_id,
            size_id=shop.size_id,
        )
        lots = await session.scalar(
            select(func.count())
            .select_from(StockLot)
            .where(StockLot.location_id == shop.location_id)
        )
    return quantity or 0, lots or 0


async def forget_the_cache(maker) -> None:
    """What seven days do on their own."""
    async with maker() as session:
        await session.execute(delete(IdempotencyRecord))
        await session.commit()


async def test_a_delivery_is_received_once_however_long_the_retry_takes(maker):
    """The reproduction. Before `0016` the last assertion read 20 units, 2 lots."""
    async with maker() as session:
        shop = await make_shop(session)
    command_id = uuid.uuid4()
    key = str(uuid.uuid4())
    async with client_for(maker, shop) as client:
        first = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": key},
            json=delivery(shop, command_id),
        )
        assert first.status_code == 201, first.text
        cached = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": key},
            json=delivery(shop, command_id),
        )
        assert cached.status_code == 201
        assert cached.json() == first.json()
    assert await held(maker, shop) == (10, 1)

    await forget_the_cache(maker)

    async with client_for(maker, shop) as client:
        late = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": key},
            json=delivery(shop, command_id),
        )
    assert late.status_code == 201, late.text
    assert late.json() == first.json(), "the durable replay must return the original receipt"
    assert await held(maker, shop) == (10, 1), "the delivery must not arrive twice"


async def test_a_new_transport_key_is_still_the_same_delivery(maker):
    """The key is transport, the `command_id` is the operation."""
    async with maker() as session:
        shop = await make_shop(session)
    command_id = uuid.uuid4()
    async with client_for(maker, shop) as client:
        first = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=delivery(shop, command_id),
        )
        again = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=delivery(shop, command_id),
        )
    assert first.status_code == 201, first.text
    assert again.status_code == 201
    assert again.json()["id"] == first.json()["id"]
    assert await held(maker, shop) == (10, 1)


async def test_the_same_command_for_a_different_delivery_is_refused(maker):
    """One of the two payloads is a client bug; guessing would invent stock."""
    async with maker() as session:
        shop = await make_shop(session)
    command_id = uuid.uuid4()
    async with client_for(maker, shop) as client:
        first = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=delivery(shop, command_id, quantity=10),
        )
        assert first.status_code == 201, first.text
        await forget_the_cache(maker)
        conflict = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=delivery(shop, command_id, quantity=99),
        )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert conflict.json()["details"]["command_id"] == str(command_id)
    assert await held(maker, shop) == (10, 1)


async def test_the_same_command_towards_another_warehouse_is_refused(maker):
    """Why the warehouse is in the permanent fingerprint.

    Without it, a retry aimed at a different warehouse would be judged a
    retry and answered "received" about goods that never went there.
    """
    from tests.conftest import provision_location

    async with maker() as session:
        shop = await make_shop(session)
        elsewhere = await provision_location(
            session, organization_id=shop.organization_id, store_id=shop.store_id, name="Другий"
        )
        await session.commit()
    command_id = uuid.uuid4()
    async with client_for(maker, shop) as client:
        first = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=delivery(shop, command_id),
        )
        assert first.status_code == 201, first.text
        await forget_the_cache(maker)
        moved = delivery(shop, command_id)
        moved["location_id"] = str(elsewhere)
        conflict = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=moved,
        )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    async with maker() as session:
        nothing = await current_quantity(
            session,
            location_id=elsewhere,
            product_variant_id=shop.variant_id,
            size_id=shop.size_id,
        )
    assert not nothing


async def test_every_lot_names_the_delivery_it_came_from(maker):
    async with maker() as session:
        shop = await make_shop(session)
    async with client_for(maker, shop) as client:
        created = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=delivery(shop, uuid.uuid4()),
        )
    assert created.status_code == 201, created.text
    receipt_id = uuid.UUID(created.json()["id"])
    async with maker() as session:
        receipt = await session.get(GoodsReceipt, receipt_id)
        lot = await session.scalar(select(StockLot).where(StockLot.location_id == shop.location_id))
    assert receipt is not None
    assert receipt.receiving_store_id == shop.store_id
    assert receipt.location_id == shop.location_id
    assert receipt.created_by_user_id == shop.user_id
    assert lot is not None
    assert lot.goods_receipt_id == receipt_id


async def test_a_replay_is_refused_once_the_right_to_receive_is_gone(maker):
    """A revoked grant must not keep handing back a stored success (I13)."""
    async with maker() as session:
        shop = await make_shop(session)
    command_id = uuid.uuid4()
    async with client_for(maker, shop) as client:
        first = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=delivery(shop, command_id),
        )
        assert first.status_code == 201, first.text
    await forget_the_cache(maker)
    async with client_for(maker, shop, frozenset({Permission.INVENTORY_VIEW})) as client:
        refused = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=delivery(shop, command_id),
        )
    assert refused.status_code == 403
    assert await held(maker, shop) == (10, 1)


async def test_the_purchase_cost_comes_back_as_it_was_stored(maker):
    """A seller may enter and see what the shop paid (owner, 2026-09-30).

    The receipt answers with the cost stored on each lot, so the screen shows
    what was recorded rather than what it typed — and a late replay, answered
    from the permanent record, says the same.
    """
    async with maker() as session:
        shop = await make_shop(session)
    command_id = uuid.uuid4()
    body = delivery(shop, command_id, quantity=3)
    body["lines"][0]["unit_cost"] = "1850.50"
    body["lines"].append(
        {"product_variant_id": str(shop.variant_id), "size_id": str(shop.size_id), "quantity": 1}
    )
    async with client_for(maker, shop) as client:
        first = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=body,
        )
        assert first.status_code == 201, first.text
        await forget_the_cache(maker)
        late = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=body,
        )
    costed, uncosted = first.json()["lines"]
    assert (costed["unit_cost"], costed["currency_code"]) == ("1850.50", "UAH")
    assert (uncosted["unit_cost"], uncosted["currency_code"]) == (None, None)
    assert late.json() == first.json()


async def test_the_same_command_at_another_price_is_another_delivery(maker):
    """The cost is in the permanent fingerprint: a changed price is refused."""
    async with maker() as session:
        shop = await make_shop(session)
    command_id = uuid.uuid4()
    body = delivery(shop, command_id)
    body["lines"][0]["unit_cost"] = "1000.00"
    async with client_for(maker, shop) as client:
        first = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=body,
        )
        assert first.status_code == 201, first.text
        await forget_the_cache(maker)
        body["lines"][0]["unit_cost"] = "1100.00"
        repriced = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=body,
        )
    assert repriced.status_code == 409
    assert repriced.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert await held(maker, shop) == (10, 1)
