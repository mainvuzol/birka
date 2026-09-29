"""A stock adjustment is a business operation, not just its ledger row.

The companion of `test_receipt_command_identity.py`. ADR-0006 closed the
defect for receiving goods and recorded that `POST /inventory/adjustments`
still had it; the owner chose the fix on 2026-09-30 (ADR-0007). The first
test is the reproduction run against the code before `0017`: a `STOCKTAKE` of
+7, replayed with its original key after the 7-day record is gone, left 14.
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
from app.modules.inventory.models import MovementType, StockAdjustment, StockMovement
from app.modules.inventory.service import current_quantity
from tests.conftest import provision_location, requires_database
from tests.integration.test_sale_command import make_shop

pytestmark = [pytest.mark.integration, requires_database()]

ADJUSTER = frozenset({Permission.INVENTORY_ADJUST, Permission.INVENTORY_VIEW})


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@asynccontextmanager
async def client_for(maker, shop, permissions=ADJUSTER):
    app = create_app(Settings(app_env="local", session_secret="adjustment-secret-32-bytes-long!"))

    async def sessions():
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    app.dependency_overrides[get_current_scope] = lambda: shop.scope(permissions)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://back-office"
    ) as client:
        yield client


def correction(shop, command_id, *, delta=7, reason="STOCKTAKE", note=None, location=None):
    return {
        "store_id": str(shop.store_id),
        "location_id": str(location or shop.location_id),
        "command_id": str(command_id),
        "product_variant_id": str(shop.variant_id),
        "size_id": str(shop.size_id),
        "quantity_delta": delta,
        "reason_code": reason,
        "note": note,
    }


async def post(client, body):
    return await client.post(
        "/api/v1/inventory/adjustments",
        headers={"Idempotency-Key": str(uuid.uuid4())},
        json=body,
    )


async def held(maker, shop) -> tuple[int, int]:
    """Balance, and how many adjustment rows the ledger holds for it."""
    async with maker() as session:
        quantity = await current_quantity(
            session,
            location_id=shop.location_id,
            product_variant_id=shop.variant_id,
            size_id=shop.size_id,
        )
        movements = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(
                StockMovement.location_id == shop.location_id,
                StockMovement.movement_type == MovementType.ADJUSTMENT,
            )
        )
    return quantity or 0, movements or 0


async def forget_the_cache(maker) -> None:
    """What seven days do on their own."""
    async with maker() as session:
        await session.execute(delete(IdempotencyRecord))
        await session.commit()


async def test_a_correction_applies_once_however_long_the_retry_takes(maker):
    """The reproduction. Before `0017` the last assertion read 14 units, 2 rows."""
    async with maker() as session:
        shop = await make_shop(session)
    command_id = uuid.uuid4()
    key = {"Idempotency-Key": str(uuid.uuid4())}
    async with client_for(maker, shop) as client:
        first = await client.post(
            "/api/v1/inventory/adjustments", headers=key, json=correction(shop, command_id)
        )
        assert first.status_code == 201, first.text
        cached = await client.post(
            "/api/v1/inventory/adjustments", headers=key, json=correction(shop, command_id)
        )
        assert cached.json() == first.json()
    assert await held(maker, shop) == (7, 1)

    await forget_the_cache(maker)

    async with client_for(maker, shop) as client:
        late = await client.post(
            "/api/v1/inventory/adjustments", headers=key, json=correction(shop, command_id)
        )
    assert late.status_code == 201, late.text
    assert late.json() == first.json(), "the durable replay must return the original answer"
    assert await held(maker, shop) == (7, 1), "the correction must not apply twice"


async def test_a_new_transport_key_is_still_the_same_correction(maker):
    async with maker() as session:
        shop = await make_shop(session)
    command_id = uuid.uuid4()
    async with client_for(maker, shop) as client:
        first = await post(client, correction(shop, command_id))
        again = await post(client, correction(shop, command_id))
    assert first.status_code == 201, first.text
    assert again.status_code == 201
    assert again.json()["id"] == first.json()["id"]
    assert (again.json()["quantity_before"], again.json()["quantity_after"]) == (0, 7)
    assert await held(maker, shop) == (7, 1)


@pytest.mark.parametrize(
    "change",
    [{"delta": 8}, {"reason": "CORRECTION"}, {"elsewhere": True}],
    ids=["another amount", "another reason", "another warehouse"],
)
async def test_the_same_command_for_a_different_change_is_refused(maker, change):
    """One of the two payloads is a client bug; guessing would move stock."""
    async with maker() as session:
        shop = await make_shop(session)
        elsewhere = await provision_location(
            session, organization_id=shop.organization_id, store_id=shop.store_id, name="Інший"
        )
        await session.commit()
    command_id = uuid.uuid4()
    async with client_for(maker, shop) as client:
        first = await post(client, correction(shop, command_id))
        assert first.status_code == 201, first.text
        await forget_the_cache(maker)
        different = correction(
            shop,
            command_id,
            delta=change.get("delta", 7),
            reason=change.get("reason", "STOCKTAKE"),
            location=elsewhere if change.get("elsewhere") else None,
        )
        conflict = await post(client, different)
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert conflict.json()["details"]["stock_adjustment_id"] == first.json()["id"]
    assert await held(maker, shop) == (7, 1)


async def test_a_reworded_note_is_still_the_same_correction(maker):
    """Why the note is outside the permanent fingerprint.

    A note is commentary. The same change under the same command with a
    reworded note is a retry, and gets the original answer — including the
    original note, which is never rewritten.
    """
    async with maker() as session:
        shop = await make_shop(session)
    command_id = uuid.uuid4()
    async with client_for(maker, shop) as client:
        first = await post(client, correction(shop, command_id, note="Перерахунок"))
        again = await post(client, correction(shop, command_id, note="Перерахунок, 2 полиця"))
    assert again.status_code == 201
    assert again.json()["id"] == first.json()["id"]
    async with maker() as session:
        row = await session.get(StockAdjustment, uuid.UUID(first.json()["id"]))
    assert row is not None
    assert row.note == "Перерахунок"
    assert await held(maker, shop) == (7, 1)


async def test_the_ledger_row_names_the_adjustment_that_caused_it(maker):
    """Before `0017` a manual correction's ledger row named nothing at all."""
    async with maker() as session:
        shop = await make_shop(session)
    async with client_for(maker, shop) as client:
        made = await post(client, correction(shop, uuid.uuid4(), note="Знайдено на складі"))
    assert made.status_code == 201, made.text
    adjustment_id = uuid.UUID(made.json()["id"])
    async with maker() as session:
        adjustment = await session.get(StockAdjustment, adjustment_id)
        movement = await session.get(StockMovement, uuid.UUID(made.json()["movement_id"]))
    assert adjustment is not None and movement is not None
    assert (movement.reference_type, movement.reference_id) == ("stock_adjustment", adjustment_id)
    assert adjustment.acting_store_id == shop.store_id
    assert adjustment.location_id == shop.location_id
    assert adjustment.created_by_user_id == shop.user_id
    assert adjustment.note == "Знайдено на складі"


async def test_a_replay_is_refused_once_the_right_to_adjust_is_gone(maker):
    async with maker() as session:
        shop = await make_shop(session)
    command_id = uuid.uuid4()
    async with client_for(maker, shop) as client:
        first = await post(client, correction(shop, command_id))
        assert first.status_code == 201, first.text
    await forget_the_cache(maker)
    async with client_for(maker, shop, frozenset({Permission.INVENTORY_VIEW})) as client:
        refused = await post(client, correction(shop, command_id))
    assert refused.status_code == 403
    assert await held(maker, shop) == (7, 1)
