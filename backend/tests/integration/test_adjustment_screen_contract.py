"""What the stock-correction screen relies on from `POST /inventory/adjustments`.

Mostly one guard. A stocktake states a count: the screen asks a manager what
the shelf holds and sends the difference from the balance it showed, together
with that balance as `expected_quantity`. Without the guard, a sale landing
between the two would turn "the shelf holds 3, the system says 5" into −2
applied to 4, and the ledger would record a coat going missing that nobody saw
go.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.modules.inventory.models import MovementType, StockAdjustment, StockMovement
from app.modules.inventory.service import (
    MovementRequest,
    ReservationRequest,
    apply_movements,
    reserve_stock,
)
from tests.conftest import requires_database
from tests.integration.test_adjustment_command_identity import (
    client_for,
    correction,
    forget_the_cache,
    held,
    post,
)
from tests.integration.test_sale_command import give_stock, make_shop

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def counted(shop, command_id, *, shelf: int, system: int, reason="STOCKTAKE"):
    """What the screen sends for "the shelf holds `shelf`" against `system`."""
    return {
        **correction(shop, command_id, delta=shelf - system, reason=reason),
        "expected_quantity": system,
    }


async def adjustments(maker, shop) -> int:
    async with maker() as session:
        return (
            await session.scalar(
                select(func.count())
                .select_from(StockAdjustment)
                .where(StockAdjustment.location_id == shop.location_id)
            )
            or 0
        )


async def test_a_count_against_the_balance_it_saw_applies(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 5)
    async with client_for(maker, shop) as client:
        response = await post(client, counted(shop, uuid.uuid4(), shelf=3, system=5))
    assert response.status_code == 201, response.text
    assert (response.json()["quantity_before"], response.json()["quantity_after"]) == (5, 3)
    assert await held(maker, shop) == (3, 1)


async def test_a_count_against_a_balance_that_moved_is_refused_and_writes_nothing(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 5)
        # A delivery lands after the screen showed 5.
        await give_stock(session, shop, 1)
    async with client_for(maker, shop) as client:
        response = await post(client, counted(shop, uuid.uuid4(), shelf=3, system=5))
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "STOCK_CHANGED"
    # Refused after the correction's lookup, so it says nothing was recorded
    # (ADR-0013 §1).
    assert response.json()["details"] == {"expected": 5, "actual": 6, "recorded": False}
    assert await held(maker, shop) == (6, 0), "nothing may be written"
    assert await adjustments(maker, shop) == 0


async def test_a_count_of_goods_the_system_never_held(maker):
    """Found on a stocktake: the system holds none, so the count is against zero."""
    async with maker() as session:
        shop = await make_shop(session)
    async with client_for(maker, shop) as client:
        response = await post(client, counted(shop, uuid.uuid4(), shelf=2, system=0))
    assert response.status_code == 201, response.text
    assert (response.json()["quantity_before"], response.json()["quantity_after"]) == (0, 2)


async def test_a_late_retry_gets_its_answer_even_after_the_balance_moved(maker):
    """The permanent answer comes first: a count applied once is not re-judged.

    If the guard ran before the replay, the retry would be told STOCK_CHANGED
    about a correction that did apply, and the screen would ask for a recount
    of stock it had already corrected.
    """
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 5)
    body = counted(shop, uuid.uuid4(), shelf=3, system=5)
    async with client_for(maker, shop) as client:
        first = await post(client, body)
    assert first.status_code == 201, first.text

    async with maker() as session:
        await give_stock(session, shop, 4)
    await forget_the_cache(maker)

    async with client_for(maker, shop) as client:
        late = await post(client, body)
    assert late.status_code == 201, late.text
    assert late.json() == first.json()
    assert await held(maker, shop) == (7, 1)


async def test_the_count_is_compared_under_the_lock(maker):
    """`.ai/workflows/inventory-adjustment.md`: concurrent adjustment vs stock write.

    A delivery holds the stock row and has not committed when the count
    arrives. Compared before the lock, the count would read 5, pass, then wait
    and apply −2 to 6. Compared under it, it waits, reads 6, and is refused.
    """
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 5)

    async with maker() as delivery:
        await apply_movements(
            delivery,
            organization_id=shop.organization_id,
            requests=[
                MovementRequest(
                    location_id=shop.location_id,
                    acting_store_id=shop.store_id,
                    product_variant_id=shop.variant_id,
                    size_id=shop.size_id,
                    quantity_delta=1,
                    movement_type=MovementType.DELIVERY,
                )
            ],
        )
        async with client_for(maker, shop) as client:
            request = asyncio.create_task(
                post(client, counted(shop, uuid.uuid4(), shelf=3, system=5))
            )
            await someone_waits_for_a_lock(maker)
            await delivery.commit()
            response = await request

    assert response.status_code == 409, response.text
    assert response.json()["details"] == {"expected": 5, "actual": 6, "recorded": False}
    async with maker() as session:
        adjusted = await session.scalar(
            select(func.count())
            .select_from(StockMovement)
            .where(
                StockMovement.location_id == shop.location_id,
                StockMovement.movement_type == MovementType.ADJUSTMENT,
            )
        )
    assert adjusted == 0
    assert await held(maker, shop) == (6, 0)


async def someone_waits_for_a_lock(maker, *, timeout: float = 5.0) -> None:
    async with maker() as session:
        for _ in range(int(timeout / 0.05)):
            waiting = await session.scalar(text("SELECT count(*) FROM pg_locks WHERE NOT granted"))
            if waiting:
                return
            await asyncio.sleep(0.05)
    raise AssertionError("the correction never reached the stock lock")


async def test_a_change_without_a_count_applies_to_whatever_is_there(maker):
    """A coat that is damaged is one coat whatever the balance, so no count is sent."""
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 5)
        await give_stock(session, shop, 1)
    async with client_for(maker, shop) as client:
        response = await post(client, correction(shop, uuid.uuid4(), delta=-1, reason="DAMAGED"))
    assert response.status_code == 201, response.text
    assert (response.json()["quantity_before"], response.json()["quantity_after"]) == (6, 5)


async def test_a_reserved_balance_is_refused_and_says_how_much_is_reserved(maker):
    """Shaped as the till's refusal, so the screen can name the reservation."""
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 5)
        await reserve_stock(
            session,
            organization_id=shop.organization_id,
            store_id=shop.store_id,
            reference_id=uuid.uuid4(),
            actor_user_id=shop.user_id,
            requests=[
                ReservationRequest(
                    location_id=shop.location_id,
                    product_variant_id=shop.variant_id,
                    size_id=shop.size_id,
                    quantity=2,
                )
            ],
        )
        await session.commit()
    async with client_for(maker, shop) as client:
        response = await post(client, counted(shop, uuid.uuid4(), shelf=4, system=5))
    assert response.status_code == 422, response.text
    assert response.json()["details"] == {
        "reason": "RESERVED",
        "location_id": str(shop.location_id),
        "product_variant_id": str(shop.variant_id),
        "size_id": str(shop.size_id),
        "reserved": 2,
        "recorded": False,
    }
    assert await held(maker, shop) == (5, 0)
