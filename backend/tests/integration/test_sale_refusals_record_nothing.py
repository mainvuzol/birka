"""A sale refused after its replay lookup says it recorded nothing (owner
decisions, 2026-10-04 and 2026-10-07; ADR-0008 §9, ADR-0013 §1; D, T1), over
HTTP against real PostgreSQL.

The sale command looks its `command_id` up under the command's own lock
before anything else is decided. When that lookup finds nothing, every
refusal after it proves the command wrote nothing, and the transaction rolls
back: each says `recorded: false`. A phone that kept the attempt through an
outage, and is refused when it sends it again, then settles it instead of
staying blocked by it. Without the marker the attempt stayed kept, and,
pressed again days later after a delivery, it sold, dated that day.

- Each refusal below: a first send refused with `recorded: false`, and the
  identical attempt sent again (the same body and the same key, as a phone
  resends) refused the same way.
- Never claimed: the identity refusal (`IDEMPOTENCY_CONFLICT`), a replay
  refused for want of `sale:view` — the sale was recorded — and a refusal
  decided from the body before the lookup (`NOTHING_TO_SELL`).
- Replays still win: a sale recorded, its stock then gone, resent, is
  answered with what it did.

The other commands' cases are in `test_refusals_record_nothing.py`. All data
is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.catalog.models import Size
from app.modules.inventory.models import MovementReason, MovementType
from app.modules.inventory.service import (
    MovementRequest,
    ReservationRequest,
    apply_movements,
    release_stock,
    reserve_stock,
)
from app.modules.tenancy.models import Store
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import (
    TwoShops,
    api,
    key,
    make_two_shops,
    sale_body,
    stock_a_coat,
)
from tests.integration.test_snapshot_import import (
    World,
    clarified,
    client_for,
    coat_sale,
    held_as_size_not_known,
    idempotent,
    seed_world,
    stock,
)
from tests.integration.test_snapshot_import import create_product as list_product

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
SALES = "/api/v1/sales"


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def world() -> AsyncIterator[World]:
    """A bootstrapped network with an opening list's three models, as
    `test_snapshot_import.py` builds it: real memberships, an owner, a
    manager and a seller of the main store."""
    engine = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
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


async def twice(client: httpx.AsyncClient, body: dict[str, Any]) -> list[httpx.Response]:
    """The attempt, and the same attempt again: the same body under the same
    key, as a phone resends what it kept. The refusal rolled the key's claim
    back with the rest, so the key is free again."""
    headers = idempotent()
    return [await client.post(SALES, json=body, headers=headers) for _ in range(2)]


def nothing_recorded(responses: list[httpx.Response], status: int, code: str) -> dict[str, Any]:
    """Both refused alike, each saying it recorded nothing. The details."""
    first, again = responses
    for response in responses:
        assert (response.status_code, response.json()["code"]) == (status, code), response.text
        assert response.json()["details"]["recorded"] is False
    assert again.json()["details"] == first.json()["details"]
    details: dict[str, Any] = first.json()["details"]
    return details


async def coats(maker, shops: TwoShops, qty: int) -> tuple[str, str]:
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        return await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=qty
        )


def selling(shops: TwoShops, coat: tuple[str, str], qty: int, **extra: Any) -> dict[str, Any]:
    return sale_body(shops.primary_store, shops.shared_warehouse, *coat, qty=qty) | extra


# --- refused after the lookup ------------------------------------------------


async def test_a_sale_short_of_stock_says_it_recorded_nothing(maker):
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops, qty=1)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        details = nothing_recorded(
            await twice(client, selling(shops, coat, 2)), 409, "INSUFFICIENT_STOCK"
        )

    assert (details["requested"], details["available"]) == (2, 1)
    # The correction is still offered to a live sale; no order holds the coat.
    assert (details["correctable"], details["reserved"]) == (True, False)


async def test_a_correction_beyond_the_shortfall_says_it_recorded_nothing(maker):
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops, qty=1)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        details = nothing_recorded(
            await twice(
                client,
                selling(shops, coat, 1, found_in_store=[{"line_index": 0, "quantity": 1}]),
            ),
            422,
            "CORRECTION_EXCEEDS_SHORTFALL",
        )

    assert details["shortfall"] == 0


async def test_a_sale_of_a_store_blocked_meanwhile_says_it_recorded_nothing(maker):
    """The scope was built while the store traded; the store was blocked
    before the sale reached its stock (as `test_store_states.py` does)."""
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops, qty=1)
    async with maker.begin() as session:
        await session.execute(
            update(Store).where(Store.id == shops.primary_store).values(state="BLOCKED")
        )
    async with api(maker, shops.scope(shops.primary_store)) as client:
        details = nothing_recorded(
            await twice(client, selling(shops, coat, 1)), 403, "STORE_NOT_TRADING"
        )

    assert details["state"] == "BLOCKED"


async def test_a_sale_in_parts_paid_in_full_says_it_recorded_nothing(maker):
    """Refused by the debt's opening, after the sale itself was written in the
    same transaction, which rolls back (ADR-0013 §1, the till's row)."""
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops, qty=1)
    in_parts = {
        "credit": {
            "customer_name": "Ірина Коваль",
            "customer_phone": "+380671234567",
            "paid_now": "1500.00",
        }
    }
    async with api(maker, shops.scope(shops.primary_store)) as client:
        nothing_recorded(
            await twice(client, selling(shops, coat, 1, **in_parts)), 422, "VALIDATION_ERROR"
        )
        sold = await client.post(SALES, json=selling(shops, coat, 1), headers=key())

    # Nothing was kept of it: the coat was still there to sell.
    assert sold.status_code == 201, sold.text


async def test_a_size_clarified_short_of_the_shortfall_says_it_recorded_nothing(world):
    """Two M sold and none held as M, and only one said to be among the
    coats held with their size not known."""
    w = world
    await held_as_size_not_known(w, 3)
    async with w.client("seller") as client:
        details = nothing_recorded(
            await twice(client, coat_sale(w, (w.sizes["M"], 2), size_clarified=clarified((0, 1)))),
            422,
            "CORRECTION_EXCEEDS_SHORTFALL",
        )

    assert (details["reason"], details["shortfall"]) == ("SIZE_CLARIFIED", 2)


async def test_a_size_not_known_balance_short_says_it_recorded_nothing(world):
    w = world
    await held_as_size_not_known(w, 1)
    async with w.client("seller") as client:
        details = nothing_recorded(
            await twice(client, coat_sale(w, (w.sizes["M"], 2), size_clarified=clarified((0, 2)))),
            409,
            "INSUFFICIENT_STOCK",
        )

    assert details["reason"] == "SIZE_NOT_KNOWN_SHORT"
    # Every shortfall says whether an order holds the units (ADR-0013 §6).
    assert (details["correctable"], details["reserved"]) == (False, False)


async def test_a_size_clarified_with_nothing_held_says_it_recorded_nothing(world):
    """A size clarified for a model nothing of which is held here with its
    size not known: the other shortfall of a clarification."""
    w = world
    async with w.client("seller") as client:
        details = nothing_recorded(
            await twice(client, coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1)))),
            409,
            "INSUFFICIENT_STOCK",
        )

    assert (details["reason"], details["available"]) == ("SIZE_NOT_KNOWN_SHORT", 0)
    # Every shortfall says whether an order holds the units (ADR-0013 §6).
    assert (details["correctable"], details["reserved"]) == (False, False)


async def test_a_size_not_known_balance_reported_says_it_recorded_nothing(world):
    """The manager, who may report goods missing too."""
    w = world
    unknown = await held_as_size_not_known(w)
    async with w.client("manager") as client:
        details = nothing_recorded(
            await twice(
                client,
                coat_sale(
                    w,
                    (w.sizes["M"], 1),
                    (unknown, 2),
                    size_clarified=clarified((0, 1)),
                    missing_in_store=[{"line_index": 1, "quantity": 1}],
                ),
            ),
            422,
            "VALIDATION_ERROR",
        )

    assert details["reason"] == "SIZE_NOT_KNOWN_REPORTED"


async def test_a_model_held_under_two_sizes_nobody_knows_says_it_recorded_nothing(world):
    w = world
    unknown = await held_as_size_not_known(w, 1)
    async with w.maker.begin() as session:
        system = await session.scalar(select(Size.size_system_id).where(Size.id == unknown))
        second = Size(
            size_system_id=system, code=f"UNKNOWN-{uuid.uuid4().hex[:8]}", is_unknown=True
        )
        session.add(second)
        await session.flush()
        await apply_movements(
            session,
            organization_id=w.org,
            requests=[
                MovementRequest(
                    location_id=w.shared,
                    acting_store_id=w.main,
                    product_variant_id=w.coat,
                    size_id=second.id,
                    quantity_delta=1,
                    movement_type=MovementType.ADJUSTMENT,
                    reason_code=MovementReason.CORRECTION,
                )
            ],
        )
    async with w.client("seller") as client:
        details = nothing_recorded(
            await twice(client, coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1)))),
            422,
            "VALIDATION_ERROR",
        )

    assert details["reason"] == "SIZE_NOT_KNOWN_AMBIGUOUS"


async def test_reserved_goods_corrected_at_the_counter_say_it_recorded_nothing(world):
    w = world
    unknown = await held_as_size_not_known(w)
    async with w.maker.begin() as session:
        await reserve_stock(
            session,
            organization_id=w.org,
            store_id=w.main,
            reference_id=uuid.uuid4(),
            requests=[ReservationRequest(w.shared, w.coat, unknown, 1)],
            actor_user_id=w.users["owner"],
        )
    async with w.client("seller") as client:
        details = nothing_recorded(
            await twice(client, coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1)))),
            422,
            "VALIDATION_ERROR",
        )

    assert (details["reason"], details["size_id"]) == ("RESERVED", str(unknown))


async def test_a_second_count_of_size_not_known_stock_says_it_recorded_nothing(world):
    w = world
    await held_as_size_not_known(w)
    async with w.client("seller") as client:
        nothing_recorded(
            await twice(
                client,
                coat_sale(w, (w.sizes["M"], 1), found_in_store=[{"line_index": 0, "quantity": 1}]),
            ),
            409,
            "UNKNOWN_SIZE_STOCK",
        )


async def test_a_reservation_released_frees_the_same_attempt(world):
    """What `recorded: false` promises: the attempt refused because an order
    held the coat is a new command once the order lets it go, and sells."""
    w = world
    unknown = await held_as_size_not_known(w)
    order = uuid.uuid4()
    async with w.maker.begin() as session:
        await reserve_stock(
            session,
            organization_id=w.org,
            store_id=w.main,
            reference_id=order,
            requests=[ReservationRequest(w.shared, w.coat, unknown, 1)],
            actor_user_id=w.users["owner"],
        )
    body = coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1)))
    async with w.client("seller") as client:
        nothing_recorded(await twice(client, body), 422, "VALIDATION_ERROR")
        async with w.maker.begin() as session:
            await release_stock(
                session,
                organization_id=w.org,
                store_id=w.main,
                reference_id=order,
                actor_user_id=w.users["owner"],
            )
        sold = await client.post(SALES, json=body, headers=idempotent())

    assert sold.status_code == 201, sold.text
    assert await stock(w) == {(w.coat, unknown): 1}


# --- never claimed -------------------------------------------------------------


async def test_the_same_command_with_another_basket_never_claims_anything(maker):
    """`IDEMPOTENCY_CONFLICT` may concern a sale that was recorded: it never
    says either way (ADR-0013 §1)."""
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops, qty=3)
    body = selling(shops, coat, 1)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        sold = await client.post(SALES, json=body, headers=key())
        other = await client.post(
            SALES, json=body | {"lines": [body["lines"][0] | {"quantity": 2}]}, headers=key()
        )

    assert sold.status_code == 201, sold.text
    assert (other.status_code, other.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    assert "recorded" not in other.json()["details"]


@pytest.mark.parametrize("from_the_cache", [False, True], ids=["looked-up", "from-the-cache"])
async def test_a_replay_refused_for_want_of_sale_view_never_claims_anything(maker, from_the_cache):
    """The lookup found the sale: refused only because the sender may no
    longer read it back. It was recorded, so the refusal must not say it was
    not. The same when it is resent under its own key within the week, and
    the 7-day cache finds it before the command runs."""
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops, qty=1)
    body = selling(shops, coat, 1)
    headers = key()
    async with api(maker, shops.scope(shops.primary_store)) as client:
        sold = await client.post(SALES, json=body, headers=headers)
    async with api(
        maker, shops.scope(shops.primary_store, frozenset({Permission.SALE_CREATE}))
    ) as client:
        again = await client.post(SALES, json=body, headers=headers if from_the_cache else key())

    assert sold.status_code == 201, sold.text
    assert (again.status_code, again.json()["code"]) == (403, "PERMISSION_DENIED")
    assert again.json()["details"]["permission"] == Permission.SALE_VIEW.value
    assert "recorded" not in again.json()["details"]


async def test_a_basket_with_nothing_on_the_shelf_is_refused_before_the_lookup(maker):
    """Decided from the body alone: it proves nothing about the command, and
    says nothing (ADR-0013 §1). The till sends such a basket as an empty
    shelf instead."""
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops, qty=1)
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        refused = await client.post(
            SALES,
            json=selling(shops, coat, 1, missing_in_store=[{"line_index": 0, "quantity": 0}]),
            headers=key(),
        )

    assert (refused.status_code, refused.json()["details"]["reason"]) == (422, "NOTHING_TO_SELL")
    assert "recorded" not in refused.json()["details"]


# --- replays still win ---------------------------------------------------------


async def test_a_sale_recorded_then_its_stock_gone_still_replays(maker):
    """The lookup comes first: a recorded sale is answered with what it did,
    whatever its stock is now."""
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops, qty=1)
    body = selling(shops, coat, 1)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        sold = await client.post(SALES, json=body, headers=key())
        assert sold.status_code == 201, sold.text
        # The last coat went with it: a new sale of it is short.
        short = await client.post(SALES, json=selling(shops, coat, 1), headers=key())
        # Its answer lost, the phone sends it again under a new key.
        again = await client.post(SALES, json=body, headers=key())

    assert (short.status_code, short.json()["details"]["recorded"]) == (409, False)
    assert again.status_code == 201, again.text
    assert again.json() == sold.json()
