"""What a client may do after a sale is refused.

A seller's app is the only caller that ever sees `INSUFFICIENT_STOCK`, and the
whole point of the in-sale corrections is that the answer to it is another
attempt, not a dead end. That makes the retry rules part of the API's contract
rather than an implementation detail, and the till screen is written against
exactly these three facts:

1. the refusal says *what* is short and *whether* a correction may be offered;
2. a refusal rolls its idempotency claim back with the rest of the
   transaction, so the rejected key is free again — reusing it is legal;
3. it is still better to mint a new key per payload, because `command_id` —
   not the key — is what stops the corrected attempt from selling twice.

Fact 3 is what the module docstring of `app.api.v1.sales` recommends; these
tests exist because it recommended it for the wrong reason, and a client author
who believed the old reason would have built the recovery path backwards.
"""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.main import create_app
from app.modules.sales.models import Sale
from tests.conftest import requires_database
from tests.integration.test_sale_command import give_stock, make_shop

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@asynccontextmanager
async def client_for(maker, shop):
    """A client whose session is discarded unless a service committed it.

    This is the one detail the test turns on, so it mirrors `get_session`
    rather than sharing the test's own session: a refused request must leave
    nothing behind, including its idempotency claim.
    """
    app = create_app(Settings(app_env="local", session_secret="retry-contract-secret-32-bytes!!"))

    async def sessions():
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    app.dependency_overrides[get_current_scope] = lambda: shop.scope()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://till"
    ) as client:
        yield client


def basket_of(shop, quantity: int, command_id: uuid.UUID) -> dict:
    return {
        "store_id": str(shop.store_id),
        "command_id": str(command_id),
        "lines": [
            {
                "product_variant_id": str(shop.variant_id),
                "size_id": str(shop.size_id),
                "source_location_id": str(shop.location_id),
                "quantity": quantity,
                "unit_price": "1200.00",
            }
        ],
        # The till's button that sold (owner decisions, 2026-10-04).
        "payment_method": "CASH",
    }


async def sold_count(maker, shop) -> int:
    async with maker() as session:
        return await session.scalar(
            select(func.count()).select_from(Sale).where(Sale.store_id == shop.store_id)
        )


async def test_the_refusal_names_the_shortfall_and_whether_to_offer_a_correction(maker):
    """The client needs the stock key to find the basket line it must ask about."""
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 4)
    async with client_for(maker, shop) as client:
        refused = await client.post(
            "/api/v1/sales",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=basket_of(shop, 5, uuid.uuid4()),
        )
    assert refused.status_code == 409
    body = refused.json()
    assert body["code"] == "INSUFFICIENT_STOCK"
    assert body["details"] == {
        "location_id": str(shop.location_id),
        "product_variant_id": str(shop.variant_id),
        "size_id": str(shop.size_id),
        "requested": 5,
        "available": 4,
        "correctable": True,
    }
    assert await sold_count(maker, shop) == 0


async def test_a_refusal_frees_its_own_idempotency_key(maker):
    """Reusing the rejected key is legal: its claim rolled back with the refusal.

    The old docstring promised `IDEMPOTENCY_CONFLICT` here. A client that
    trusted it would treat a perfectly good retry as a lost sale.
    """
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 4)
    key = str(uuid.uuid4())
    payload = basket_of(shop, 5, uuid.uuid4())
    async with client_for(maker, shop) as client:
        refused = await client.post("/api/v1/sales", headers={"Idempotency-Key": key}, json=payload)
        assert refused.status_code == 409
        corrected = await client.post(
            "/api/v1/sales",
            headers={"Idempotency-Key": key},
            json={**payload, "found_in_store": [{"line_index": 0, "quantity": 1}]},
        )
    assert corrected.status_code == 201, corrected.text
    assert corrected.json()["total"] == "6000.00"
    assert len(corrected.json()["corrections"]) == 1
    assert await sold_count(maker, shop) == 1


async def test_a_new_key_for_the_corrected_attempt_still_sells_once(maker):
    """The recommended path, and why it is safe.

    A new key per payload keeps one key answering one payload, which is what
    makes a later replay of that key unambiguous. It cannot double-sell,
    because the permanent `command_id` (I20) recognises the second attempt as
    the same sale and replays it.
    """
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 4)
    command_id = uuid.uuid4()
    payload = basket_of(shop, 5, command_id)
    corrected = {**payload, "found_in_store": [{"line_index": 0, "quantity": 1}]}
    async with client_for(maker, shop) as client:
        refused = await client.post(
            "/api/v1/sales", headers={"Idempotency-Key": str(uuid.uuid4())}, json=payload
        )
        assert refused.status_code == 409
        first = await client.post(
            "/api/v1/sales", headers={"Idempotency-Key": str(uuid.uuid4())}, json=corrected
        )
        again = await client.post(
            "/api/v1/sales", headers={"Idempotency-Key": str(uuid.uuid4())}, json=corrected
        )
    assert first.status_code == 201, first.text
    assert again.status_code == 201, again.text
    assert first.json()["id"] == again.json()["id"]
    assert await sold_count(maker, shop) == 1


async def test_replaying_the_very_same_attempt_is_what_recovers_an_unknown_outcome(maker):
    """A client that never learned the answer resends the identical attempt.

    Same key, same body: either the cache replays the receipt it already
    stored, or the sale had never happened and is made now. One sale, and the
    client learns the sale id either way — which is why the key must be
    written down before the request is sent, not after.
    """
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 2)
    key = str(uuid.uuid4())
    payload = basket_of(shop, 1, uuid.uuid4())
    async with client_for(maker, shop) as client:
        first = await client.post("/api/v1/sales", headers={"Idempotency-Key": key}, json=payload)
        replay = await client.post("/api/v1/sales", headers={"Idempotency-Key": key}, json=payload)
    assert first.status_code == 201, first.text
    assert replay.status_code == 201
    assert replay.json() == first.json()
    assert await sold_count(maker, shop) == 1


async def test_a_corrected_payload_under_a_completed_key_is_refused(maker):
    """The one case the old docstring described correctly.

    Once an attempt has *succeeded*, its key answers that payload forever.
    Sending a different payload under it is a client bug, and saying so is
    better than quietly replaying the wrong receipt.
    """
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 2)
    key = str(uuid.uuid4())
    payload = basket_of(shop, 1, uuid.uuid4())
    async with client_for(maker, shop) as client:
        first = await client.post("/api/v1/sales", headers={"Idempotency-Key": key}, json=payload)
        assert first.status_code == 201, first.text
        conflict = await client.post(
            "/api/v1/sales",
            headers={"Idempotency-Key": key},
            json={**payload, "found_in_store": [{"line_index": 0, "quantity": 1}]},
        )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert await sold_count(maker, shop) == 1
