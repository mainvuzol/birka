"""Returns at another store (owner decisions, 2026-10-01), over HTTP against
real PostgreSQL.

- Any store of the network may take back goods another of its stores sold.
  Whoever takes returns there finds the sale by a search among the other
  stores' sales.
- Intact goods go back to the warehouse they were sold from; where the store
  taking them back does not reach it, to one of its own the seller chooses.
- Damaged goods stay where they were handed back: that store's «Брак».
- The store taking them back hands the money back, and is recorded as such.
- A sale paid in parts comes back by the same rules; its debt stays with the
  store that sold.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import replace

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.inventory.models import StockMovement
from app.modules.inventory.service import find_divergences
from app.modules.refunds.models import Refund
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
from tests.integration.test_till_returns import give_bin

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def sold_at(
    maker, shops: TwoShops, store: uuid.UUID, warehouse: uuid.UUID, *, qty: int = 2, **extra
) -> tuple[dict, str, str]:
    """Coats at 1500 sold by `store` from `warehouse`."""
    async with api(maker, shops.scope(store)) as client:
        variant, size = await stock_a_coat(client, shops, store=store, warehouse=warehouse, qty=3)
        response = await client.post(
            "/api/v1/sales",
            json=sale_body(store, warehouse, variant, size, qty=qty) | extra,
            headers=key(),
        )
    assert response.status_code == 201, response.text
    return response.json(), variant, size


def part(sale: dict, quantity: int, condition: str, **extra: str) -> dict:
    return {
        "sale_item_id": sale["items"][0]["id"],
        "quantity": quantity,
        "restock": True,
        "condition": condition,
    } | extra


async def take_back(
    maker,
    shops: TwoShops,
    sale: dict,
    *lines: dict,
    at: uuid.UUID,
    permissions=SELLER,
    command_id: str | None = None,
    store_id: uuid.UUID | None = None,
    reason: str | None = None,
):
    async with api(maker, shops.scope(at, permissions)) as client:
        return await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": command_id or str(uuid.uuid4()),
                "lines": list(lines),
                "store_id": str(store_id or at),
                "payment_method": "CASH",
            }
            | ({"reason": reason} if reason is not None else {}),
            headers=key(),
        )


async def elsewhere(maker, shops: TwoShops, at: uuid.UUID, q: str | None, permissions=SELLER):
    async with api(maker, shops.scope(at, permissions)) as client:
        return await client.get(
            "/api/v1/sales",
            params={"store_id": str(at), "elsewhere": "true"} | ({"q": q} if q is not None else {}),
        )


async def test_another_stores_sale_is_found_only_by_a_search(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await sold_at(maker, shops, shops.primary_store, shops.shared_warehouse)
    name = sale["items"][0]["display_name"]

    # A word of two letters at least: one-letter words, however many, browse
    # as one letter would (owner decision, 2026-10-18).
    for q in (None, "", " Л ", "о о", "л ш к"):
        refused = await elsewhere(maker, shops, shops.child_store, q)
        assert refused.status_code == 422, refused.text
        assert refused.json()["details"]["reason"] == "SEARCH_REQUIRED"
    with_short = await elsewhere(maker, shops, shops.child_store, f"{name[:8]} ш")
    assert with_short.status_code == 200, with_short.text
    assert [s["id"] for s in with_short.json()["sales"]] == [sale["id"]]

    found = await elsewhere(maker, shops, shops.child_store, name[:8])
    assert found.status_code == 200, found.text
    [listed] = found.json()["sales"]
    assert (listed["id"], listed["store_id"], listed["store_name"]) == (
        sale["id"],
        str(shops.primary_store),
        "Основний",
    )
    # The child store reaches the shared warehouse, so the goods go back there.
    assert listed["items"][0]["back_to_sold_from"] is True

    # A store's own sales are never among the others'.
    mine = await elsewhere(maker, shops, shops.primary_store, name[:8])
    assert mine.json()["sales"] == []
    # Its own list stays its own, and only whoever takes returns searches.
    async with api(maker, shops.scope(shops.child_store)) as client:
        own = await client.get("/api/v1/sales", params={"store_id": str(shops.child_store)})
    assert own.json()["sales"] == []
    unpermitted = await elsewhere(
        maker, shops, shops.child_store, name[:8], SELLER - {Permission.SALE_REFUND}
    )
    assert unpermitted.status_code == 403


async def test_goods_bought_at_one_store_come_back_at_another(maker):
    shops = await make_two_shops(maker)
    bin_ = await give_bin(maker, shops.organization_id, shops.child_store)
    sale, variant, size = await sold_at(maker, shops, shops.primary_store, shops.shared_warehouse)

    returned = await take_back(
        maker, shops, sale, part(sale, 1, "INTACT"), part(sale, 1, "DAMAGED"), at=shops.child_store
    )

    assert returned.status_code == 201, returned.text
    body = returned.json()
    # Sold by one store, taken back — and paid out — by the other.
    assert (body["store_id"], body["taken_at_store_id"]) == (
        str(shops.primary_store),
        str(shops.child_store),
    )
    assert body["total_amount"] == "3000.00"
    destinations = {item["condition"]: item["destination_location_id"] for item in body["items"]}
    # Intact back where it was sold from; damaged where it was handed back.
    assert destinations == {"INTACT": str(shops.shared_warehouse), "DAMAGED": str(bin_)}
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2
        assert await quantity_at(session, bin_, variant, size) == 1
        refund = await session.scalar(select(Refund).where(Refund.id == uuid.UUID(body["id"])))
        assert refund is not None and refund.taken_at_store_id == shops.child_store
        # The store that took them back is the one that moved them.
        movers = set(
            (
                await session.scalars(
                    select(StockMovement.acting_store_id).where(
                        StockMovement.reference_id == refund.id
                    )
                )
            ).all()
        )
        assert movers == {shops.child_store}
        assert await find_divergences(session, organization_id=shops.organization_id) == []

    # The unit is in the child store's «Брак», to be inspected there.
    async with api(maker, shops.scope(shops.child_store)) as client:
        units = (
            await client.get("/api/v1/damaged-units", params={"store_id": str(shops.child_store)})
        ).json()["units"]
    assert [unit["back_to_sold_from"] for unit in units] == [True]
    # The selling store sees its sale fully returned.
    async with api(maker, shops.scope(shops.primary_store)) as client:
        own = await client.get("/api/v1/sales", params={"store_id": str(shops.primary_store)})
    assert own.json()["sales"][0]["items"][0]["refunded"] == 2


async def test_another_stores_own_warehouse_is_not_reached_so_the_seller_chooses(maker):
    shops = await make_two_shops(maker)
    bin_ = await give_bin(maker, shops.organization_id, shops.primary_store)
    sale, variant, size = await sold_at(maker, shops, shops.child_store, shops.child_warehouse)

    [listed] = (
        await elsewhere(maker, shops, shops.primary_store, sale["items"][0]["display_name"])
    ).json()["sales"]
    assert listed["items"][0]["back_to_sold_from"] is False

    for line, reason in (
        (part(sale, 1, "INTACT"), "CHOOSE_A_WAREHOUSE"),
        (
            part(sale, 1, "INTACT", location_id=str(shops.child_warehouse)),
            "NOT_A_WAREHOUSE_OF_THIS_STORE",
        ),
        # «Брак» is never where goods go back on sale.
        (part(sale, 1, "INTACT", location_id=str(bin_)), "NOT_A_WAREHOUSE_OF_THIS_STORE"),
    ):
        refused = await take_back(maker, shops, sale, line, at=shops.primary_store)
        assert refused.status_code == 422, refused.text
        assert refused.json()["details"]["reason"] == reason

    chosen = await take_back(
        maker,
        shops,
        sale,
        part(sale, 1, "INTACT", location_id=str(shops.shared_warehouse)),
        at=shops.primary_store,
    )
    assert chosen.status_code == 201, chosen.text
    assert chosen.json()["items"][0]["destination_location_id"] == str(shops.shared_warehouse)
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 1
        assert await quantity_at(session, shops.child_warehouse, variant, size) == 1
        assert await find_divergences(session, organization_id=shops.organization_id) == []

    # A store taking back its own sale has nothing to choose, as before.
    own = await take_back(
        maker,
        shops,
        sale,
        part(sale, 1, "INTACT", location_id=str(shops.shared_warehouse)),
        at=shops.child_store,
    )
    assert own.status_code == 422, own.text
    assert own.json()["details"]["reason"] == "SOLD_FROM"
    plain = await take_back(maker, shops, sale, part(sale, 1, "INTACT"), at=shops.child_store)
    assert plain.status_code == 201, plain.text
    assert plain.json()["items"][0]["destination_location_id"] == str(shops.child_warehouse)


async def test_a_return_taken_elsewhere_replays_whole_to_whoever_took_it_without_the_right(
    maker,
):
    """Taken at another store, its intact part to a warehouse chosen there,
    its damaged part to that store's «Брак», a reason typed: once its person
    may no longer take returns there, answered what it recorded, every part
    of it (owner decision, 2026-10-18)."""
    shops = await make_two_shops(maker)
    await give_bin(maker, shops.organization_id, shops.primary_store)
    sale, _, _ = await sold_at(maker, shops, shops.child_store, shops.child_warehouse)
    command = str(uuid.uuid4())
    parts = (
        part(sale, 1, "INTACT", location_id=str(shops.shared_warehouse)),
        part(sale, 1, "DAMAGED"),
    )
    first = await take_back(
        maker,
        shops,
        sale,
        *parts,
        at=shops.primary_store,
        command_id=command,
        reason="  Шов розійшовся ",
    )
    assert first.status_code == 201, first.text
    again = await take_back(
        maker,
        shops,
        sale,
        *parts,
        at=shops.primary_store,
        command_id=command,
        reason="  Шов розійшовся ",
        permissions=SELLER - {Permission.SALE_REFUND},
    )
    assert again.status_code == 201, again.text
    assert again.json() == first.json()


@pytest.mark.parametrize(
    "lost,status,code,reason",
    [
        # The store taking it back no longer reaches the warehouse it went to.
        ("reach", 422, "VALIDATION_ERROR", "CHOOSE_A_WAREHOUSE"),
        # Its «Брак» undone.
        ("bin", 409, "DAMAGED_RETURNS_UNAVAILABLE", "NOT_SET_UP"),
        # The warehouse closed: named, though refused as an unknown one.
        ("closed", 404, "NOT_FOUND", "WAREHOUSE_UNAVAILABLE"),
    ],
)
async def test_a_return_is_answered_to_its_recorder_once_where_it_went_is_lost(
    maker, lost, status, code, reason
):
    """Taken back at another store, its intact part to the warehouse it was
    sold from, its damaged part to that store's «Брак»: once where it went is
    lost, whoever recorded it is answered what it recorded — past the days a
    key is kept too, judged by where it went, not where it would go now — a
    new return says it recorded nothing, and anyone else learns nothing
    (owner decisions, 2026-10-18)."""
    shops = await make_two_shops(maker)
    bin_ = await give_bin(maker, shops.organization_id, shops.child_store)
    sale, _, _ = await sold_at(maker, shops, shops.primary_store, shops.shared_warehouse)
    command = str(uuid.uuid4())
    parts = (part(sale, 1, "INTACT"), part(sale, 1, "DAMAGED"))
    first = await take_back(maker, shops, sale, *parts, at=shops.child_store, command_id=command)
    assert first.status_code == 201, first.text

    async with maker() as session:
        if lost == "reach":
            await session.execute(
                text(
                    "UPDATE store_location_access SET can_receive = false "
                    "WHERE store_id = :s AND location_id = :loc"
                ),
                {"s": shops.child_store, "loc": shops.shared_warehouse},
            )
        elif lost == "bin":
            await session.execute(
                text(
                    "UPDATE store_location_access SET damaged_returns = false "
                    "WHERE location_id = :b"
                ),
                {"b": bin_},
            )
        else:
            await session.execute(
                text("UPDATE stock_location SET is_active = false WHERE id = :loc"),
                {"loc": shops.shared_warehouse},
            )
        # Past the days its key is kept: only the return itself answers.
        await session.execute(
            text("DELETE FROM idempotency_record WHERE organization_id = :o"),
            {"o": shops.organization_id},
        )
        await session.commit()

    again = await take_back(maker, shops, sale, *parts, at=shops.child_store, command_id=command)
    assert again.status_code == 201, again.text
    assert again.json() == first.json()
    fresh = await take_back(maker, shops, sale, *parts, at=shops.child_store)
    assert fresh.status_code == status, fresh.text
    assert fresh.json()["code"] == code
    assert fresh.json()["details"]["reason"] == reason
    assert fresh.json()["details"]["recorded"] is False
    someone = replace(shops.scope(shops.child_store), user_id=uuid.uuid4())
    async with api(maker, someone) as client:
        other = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": command,
                "lines": list(parts),
                "store_id": str(shops.child_store),
                "payment_method": "CASH",
            },
            headers=key(),
        )
    assert other.status_code == status, other.text
    assert "recorded" not in other.json()["details"]


async def test_a_choice_is_only_for_intact_goods(maker):
    shops = await make_two_shops(maker)
    await give_bin(maker, shops.organization_id, shops.primary_store)
    sale, _, _ = await sold_at(maker, shops, shops.child_store, shops.child_warehouse)
    refused = await take_back(
        maker,
        shops,
        sale,
        part(sale, 1, "DAMAGED", location_id=str(shops.shared_warehouse)),
        at=shops.primary_store,
    )
    assert refused.status_code == 422, refused.text


async def test_the_store_taking_it_back_decides_by_its_own_authority(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await sold_at(maker, shops, shops.primary_store, shops.shared_warehouse)

    # Without the right to take returns where one stands.
    unpermitted = await take_back(
        maker,
        shops,
        sale,
        part(sale, 1, "INTACT"),
        at=shops.child_store,
        permissions=SELLER - {Permission.SALE_REFUND},
    )
    assert unpermitted.status_code == 403, unpermitted.text
    # Nothing recorded under it, and said so (owner decision, 2026-10-18).
    assert unpermitted.json()["details"]["recorded"] is False
    # The selling store's grant is not the taking store's.
    async with api(maker, shops.scope(shops.primary_store)) as client:
        borrowed = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [part(sale, 1, "INTACT")],
                "store_id": str(shops.child_store),
                "payment_method": "CASH",
            },
            headers=key(),
        )
    assert borrowed.status_code == 403, borrowed.text
    # A store of another organization is no store of this network.
    other = await make_two_shops(maker)
    foreign = await take_back(maker, shops, sale, part(sale, 1, "INTACT"), at=other.child_store)
    assert foreign.status_code == 404, foreign.text

    # A return taken elsewhere replays as itself, and to whoever took it once
    # their grant is revoked (owner decision, 2026-10-18); the same command
    # named at another store is another operation.
    command = str(uuid.uuid4())
    first = await take_back(
        maker, shops, sale, part(sale, 1, "INTACT"), at=shops.child_store, command_id=command
    )
    assert first.status_code == 201, first.text
    again = await take_back(
        maker, shops, sale, part(sale, 1, "INTACT"), at=shops.child_store, command_id=command
    )
    assert again.json()["id"] == first.json()["id"]
    revoked = await take_back(
        maker,
        shops,
        sale,
        part(sale, 1, "INTACT"),
        at=shops.child_store,
        command_id=command,
        permissions=SELLER - {Permission.SALE_REFUND},
    )
    assert revoked.status_code == 201, revoked.text
    assert revoked.json() == first.json()
    moved = await take_back(
        maker, shops, sale, part(sale, 1, "INTACT"), at=shops.primary_store, command_id=command
    )
    assert moved.status_code == 409, moved.text


async def test_a_sale_paid_in_parts_comes_back_elsewhere_by_the_same_rules(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await sold_at(
        maker,
        shops,
        shops.primary_store,
        shops.shared_warehouse,
        credit={
            "customer_name": "Ірина Коваль",
            "customer_phone": "0671234567",
            "paid_now": "1000.00",
        },
    )

    first = await take_back(maker, shops, sale, part(sale, 1, "INTACT"), at=shops.child_store)
    second = await take_back(maker, shops, sale, part(sale, 1, "INTACT"), at=shops.child_store)

    assert first.json()["credit"] == {
        "debt_reduced": "1500.00",
        "cash_back": "0.00",
        "owed_after": "500.00",
    }
    # The child store hands back the 1000 paid; the debt was the primary's.
    assert second.json()["credit"] == {
        "debt_reduced": "500.00",
        "cash_back": "1000.00",
        "owed_after": "0.00",
    }
    async with api(maker, shops.scope(shops.primary_store)) as client:
        debt = (await client.get(f"/api/v1/credits/{sale['credit']['credit_id']}")).json()
    assert (debt["store_id"], debt["status"]) == (str(shops.primary_store), "SETTLED")


async def test_a_unit_handed_back_elsewhere_goes_back_on_sale_in_that_stores_warehouse(maker):
    shops = await make_two_shops(maker)
    bin_ = await give_bin(maker, shops.organization_id, shops.primary_store)
    sale, variant, size = await sold_at(maker, shops, shops.child_store, shops.child_warehouse)
    returned = await take_back(maker, shops, sale, part(sale, 1, "DAMAGED"), at=shops.primary_store)
    assert returned.status_code == 201, returned.text

    async with api(maker, shops.scope(shops.primary_store)) as client:
        [unit] = (
            await client.get("/api/v1/damaged-units", params={"store_id": str(shops.primary_store)})
        ).json()["units"]
        assert unit["back_to_sold_from"] is False
        taken = await client.post(f"/api/v1/damaged-units/{unit['id']}/take")
        assert taken.status_code == 200, taken.text

        async def back_to(location: uuid.UUID):
            return await client.post(
                f"/api/v1/damaged-units/{unit['id']}/return-to-sale",
                json={"destination_location_id": str(location)},
            )

        # Not the other store's own warehouse, nor «Брак» itself.
        assert (await back_to(shops.child_warehouse)).status_code == 403
        assert (await back_to(bin_)).status_code == 422
        moved = await back_to(shops.shared_warehouse)
        assert moved.status_code == 200, moved.text
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 1
        assert await quantity_at(session, bin_, variant, size) == 0
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_the_downgrade_refuses_while_a_return_was_taken_elsewhere():
    from tests.integration.test_cash_schema import forget_the_ways
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_elsewhere_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        shops = await make_two_shops(fresh)
        sale, _, _ = await sold_at(fresh, shops, shops.primary_store, shops.shared_warehouse)
        # Taken where it was sold: the column says nothing 0023 could not.
        here = await take_back(fresh, shops, sale, part(sale, 1, "INTACT"), at=shops.primary_store)
        assert here.status_code == 201, here.text
        await forget_the_ways(engine)
        await _run(config, "downgrade", "0023_customer_credit", database=name)
        await _run(config, "upgrade", "head", database=name)
        async with fresh() as session:
            refund = await session.scalar(select(Refund))
            assert refund is not None and refund.taken_at_store_id == shops.primary_store
        there = await take_back(fresh, shops, sale, part(sale, 1, "INTACT"), at=shops.child_store)
        assert there.status_code == 201, there.text
        await forget_the_ways(engine)
        with pytest.raises(Exception, match="taken at another store"):
            await _run(config, "downgrade", "0023_customer_credit", database=name)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
