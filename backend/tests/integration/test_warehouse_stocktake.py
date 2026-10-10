"""A stocktake of a whole warehouse (owner decisions, 2026-10-10; ADR-0022).

What the owner decided, each as a test:
- the warehouse keeps selling while it is counted; a position whose balance
  moved since it was read is refused and counted again, alone;
- positions nobody counted stay as they are, and the end says how many;
- a manager or the owner counts, and each count applies at once;
- one record with its sums, and the bot tells the network's owner, silently.
And what follows from them: a count is recorded once however late it is
resent, a finished stocktake takes no count, «Брак» and a reserved balance are
corrected here no more than by hand, and none of it is ever changed after.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest
from alembic.script import ScriptDirectory
from scripts import backup_watch
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.core.config import Settings
from app.core.idempotency import IdempotencyRecord
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from app.modules.catalog.models import Size
from app.modules.inventory.models import MovementReason, StockAdjustment, StockMovement
from app.modules.stocktake import service as stocktake_service
from app.modules.stocktake.models import Stocktake, StocktakeCount, StocktakeMessage
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import api, key, quantity_at, sale_body, stock_a_coat
from tests.integration.test_stock_rekey_migration import _admin, _alembic, _engine, _run
from tests.integration.test_store_states import Network, as_, network, stocked
from tests.integration.test_till_returns import give_bin

pytestmark = [pytest.mark.integration, requires_database()]

MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


# --- what a phone sends ---------------------------------------------------------------


async def begin(
    maker, net: Network, by: uuid.UUID, *, store=None, warehouse=None
) -> httpx.Response:
    async with as_(maker, net, by) as client:
        return await client.post(
            "/api/v1/stocktakes",
            json={
                "store_id": str(store or net.shops.primary_store),
                "location_id": str(warehouse or net.shops.shared_warehouse),
            },
        )


async def started(maker, net: Network, by: uuid.UUID | None = None) -> str:
    response = await begin(maker, net, by or net.manager)
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def a_count(
    variant: str, size: str, counted: int, expected: int, *, store=None, net=None, command=None
) -> dict[str, Any]:
    return {
        "store_id": str(store or net.shops.primary_store),
        "command_id": command or str(uuid.uuid4()),
        "product_variant_id": variant,
        "size_id": size,
        "counted_quantity": counted,
        "expected_quantity": expected,
    }


async def count(
    maker, net: Network, stocktake: str, body: dict[str, Any], *, by: uuid.UUID | None = None
) -> httpx.Response:
    async with as_(maker, net, by or net.manager) as client:
        return await client.post(f"/api/v1/stocktakes/{stocktake}/counts", json=body, headers=key())


async def counted(maker, net, stocktake, variant, size, shelf, balance, **kwargs) -> dict:
    response = await count(
        maker, net, stocktake, a_count(variant, size, shelf, balance, net=net), **kwargs
    )
    assert response.status_code == 201, response.text
    body: dict = response.json()
    return body


async def finish(
    maker, net: Network, stocktake: str, *, by: uuid.UUID | None = None, store=None
) -> httpx.Response:
    async with as_(maker, net, by or net.manager) as client:
        return await client.post(
            f"/api/v1/stocktakes/{stocktake}/finish",
            json={"store_id": str(store or net.shops.primary_store)},
        )


async def read(
    maker, net: Network, stocktake: str, *, by=None, path="", **params
) -> httpx.Response:
    async with as_(maker, net, by or net.manager) as client:
        return await client.get(
            f"/api/v1/stocktakes/{stocktake}{path}",
            params={"store_id": str(net.shops.primary_store), **params},
        )


async def sums(maker, net: Network, stocktake: str) -> dict[str, int]:
    response = await read(maker, net, stocktake)
    assert response.status_code == 200, response.text
    found: dict[str, int] = response.json()["sums"]
    return found


async def positions(maker, net: Network, stocktake: str, state: str, **kwargs) -> list[dict]:
    response = await read(maker, net, stocktake, path="/positions", state=state, **kwargs)
    assert response.status_code == 200, response.text
    items: list[dict] = response.json()["items"]
    return items


async def balance(maker, net: Network, variant: str, size: str, warehouse=None) -> int:
    async with maker() as session:
        return await quantity_at(session, warehouse or net.shops.shared_warehouse, variant, size)


async def sell(maker, net: Network, variant: str, size: str, qty: int = 1) -> None:
    async with api(maker, net.shops.scope(net.shops.primary_store)) as client:
        sold = await client.post(
            "/api/v1/sales",
            json=sale_body(net.shops.primary_store, net.shops.shared_warehouse, variant, size, qty),
            headers=key(),
        )
    assert sold.status_code == 201, sold.text


def refused(response: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    body: dict[str, Any] = response.json()
    assert body["code"] == code, body
    return body


async def count_rows(maker, stocktake: str) -> int:
    async with maker() as session:
        return len(
            (
                await session.scalars(
                    select(StocktakeCount.id).where(
                        StocktakeCount.stocktake_id == uuid.UUID(stocktake)
                    )
                )
            ).all()
        )


# --- counting -------------------------------------------------------------------------


async def test_a_count_that_matches_changes_nothing_and_one_that_differs_applies_at_once(maker):
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=3)
    jacket = await stocked(maker, net, net.shops.shared_warehouse, qty=2)
    response = await begin(maker, net, net.manager)
    assert response.status_code == 201, response.text
    stocktake = response.json()
    assert (stocktake["started_by"], stocktake["finished_at"]) == ("manager", None)
    assert stocktake["location_name"] == "Основний склад"

    same = await counted(maker, net, stocktake["id"], *coat, 3, 3)
    assert (same["quantity_before"], same["quantity_delta"]) == (3, 0)
    short = await counted(maker, net, stocktake["id"], *jacket, 1, 2)
    assert (short["quantity_before"], short["counted_quantity"], short["quantity_delta"]) == (
        2,
        1,
        -1,
    )
    assert await balance(maker, net, *coat) == 3
    assert await balance(maker, net, *jacket) == 1

    async with maker() as session:
        rows = {
            row.product_variant_id: row
            for row in await session.scalars(
                select(StocktakeCount).where(
                    StocktakeCount.stocktake_id == uuid.UUID(stocktake["id"])
                )
            )
        }
        assert rows[uuid.UUID(coat[0])].adjustment_id is None
        adjustment_id = rows[uuid.UUID(jacket[0])].adjustment_id
        adjustment = await session.get(StockAdjustment, adjustment_id)
        assert adjustment is not None and adjustment.created_by_user_id == net.manager
        movement = await session.scalar(
            select(StockMovement).where(StockMovement.reference_id == adjustment_id)
        )
        assert movement is not None
        assert (movement.quantity_delta, movement.reason_code) == (-1, MovementReason.STOCKTAKE)
        # A matching count wrote no movement at all.
        assert (
            await session.scalar(
                select(StockMovement.id).where(
                    StockMovement.product_variant_id == uuid.UUID(coat[0]),
                    StockMovement.reason_code == MovementReason.STOCKTAKE,
                )
            )
        ) is None

    assert await sums(maker, net, stocktake["id"]) == {
        "counted_positions": 2,
        "unchecked_positions": 0,
        "shortage_units": 1,
        "shortage_positions": 1,
        "surplus_units": 0,
        "surplus_positions": 0,
    }


async def test_the_warehouse_keeps_selling_and_a_moved_position_is_counted_again(maker):
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=3)
    stocktake = await started(maker, net)
    # Read at 3, sold one while it was counted: the shelf holds 2.
    await sell(maker, net, *coat)
    body = refused(
        await count(maker, net, stocktake, a_count(*coat, 2, 3, net=net)), 409, "STOCK_CHANGED"
    )
    assert body["details"] == {"expected": 3, "actual": 2, "recorded": False}
    assert await count_rows(maker, stocktake) == 0
    assert await balance(maker, net, *coat) == 2

    again = await counted(maker, net, stocktake, *coat, 2, 2)
    assert again["quantity_delta"] == 0
    # And a sale after the count is no shortage: the stocktake changed nothing.
    await sell(maker, net, *coat)
    assert (await sums(maker, net, stocktake))["shortage_units"] == 0
    assert await balance(maker, net, *coat) == 1


async def test_a_position_counted_again_counts_once_in_the_sums(maker):
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=5)
    jacket = await stocked(maker, net, net.shops.shared_warehouse, qty=2)
    stocktake = await started(maker, net)
    # Mistyped 3 for 5, then counted again: what the stocktake changed is 0.
    await counted(maker, net, stocktake, *coat, 3, 5)
    assert await balance(maker, net, *coat) == 3
    await counted(maker, net, stocktake, *coat, 5, 3)
    assert await balance(maker, net, *coat) == 5
    await counted(maker, net, stocktake, *jacket, 4, 2)

    assert await sums(maker, net, stocktake) == {
        "counted_positions": 2,
        "unchecked_positions": 0,
        "shortage_units": 0,
        "shortage_positions": 0,
        "surplus_units": 2,
        "surplus_positions": 1,
    }
    done = await positions(maker, net, stocktake, "counted")
    assert [
        (p["product_variant_id"], p["count"]["counted_quantity"], p["count"]["net_delta"])
        for p in done
    ] == [(jacket[0], 4, 2), (coat[0], 5, 0)]
    assert done[0]["count"]["counted_by"] == "manager"
    assert done[0]["quantity"] == 4
    differences = await positions(maker, net, stocktake, "differences")
    assert [p["product_variant_id"] for p in differences] == [jacket[0]]


async def test_positions_nobody_counted_stay_as_they_are_and_are_told(maker):
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=3)
    jacket = await stocked(maker, net, net.shops.shared_warehouse, qty=2)
    vest = await stocked(maker, net, net.shops.shared_warehouse, qty=1)
    stocktake = await started(maker, net)
    left = await positions(maker, net, stocktake, "uncounted")
    assert {p["product_variant_id"] for p in left} == {coat[0], jacket[0], vest[0]}
    assert all(p["count"] is None for p in left)

    await counted(maker, net, stocktake, *coat, 0, 3)
    left = await positions(maker, net, stocktake, "uncounted")
    assert {p["product_variant_id"] for p in left} == {jacket[0], vest[0]}
    # Paged as «Залишки» is.
    first = await read(maker, net, stocktake, path="/positions", state="uncounted", limit=1)
    assert first.json()["has_more"] is True and len(first.json()["items"]) == 1

    done = await finish(maker, net, stocktake)
    assert done.status_code == 200, done.text
    assert done.json()["sums"] == {
        "counted_positions": 1,
        "unchecked_positions": 2,
        "shortage_units": 3,
        "shortage_positions": 1,
        "surplus_units": 0,
        "surplus_positions": 0,
    }
    assert done.json()["finished_by"] == "manager"
    assert (await balance(maker, net, *jacket), await balance(maker, net, *vest)) == (2, 1)
    # A balance counted down to nothing is still a position counted.
    assert await balance(maker, net, *coat) == 0


async def test_goods_found_that_the_list_does_not_show_are_a_surplus(maker):
    net = await network(maker)
    async with api(maker, net.shops.scope(net.shops.primary_store)) as client:
        found = await stock_a_coat(
            client,
            net.shops,
            store=net.shops.primary_store,
            warehouse=net.shops.shared_warehouse,
            qty=0,
        )
    stocktake = await started(maker, net)
    assert await positions(maker, net, stocktake, "uncounted") == []
    await counted(maker, net, stocktake, *found, 2, 0)
    assert await balance(maker, net, *found) == 2
    assert (await sums(maker, net, stocktake))["surplus_units"] == 2


# --- one at a time, and finished once -------------------------------------------------


async def test_one_stocktake_is_open_per_warehouse_and_whoever_starts_another_joins_it(maker):
    net = await network(maker)
    both = await asyncio.gather(begin(maker, net, net.manager), begin(maker, net, net.owner))
    assert sorted(r.status_code for r in both) == [200, 201], [r.text for r in both]
    assert both[0].json()["id"] == both[1].json()["id"]
    # The other store sharing the warehouse joins it too.
    joined = await begin(maker, net, net.child_owner, store=net.shops.child_store)
    assert (joined.status_code, joined.json()["id"]) == (200, both[0].json()["id"])
    # Another warehouse has its own.
    elsewhere = await begin(
        maker, net, net.child_owner, store=net.shops.child_store, warehouse=net.own
    )
    assert elsewhere.status_code == 201, elsewhere.text
    assert elsewhere.json()["id"] != both[0].json()["id"]


async def test_a_finished_stocktake_takes_no_count_and_answers_as_it_was(maker):
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=3)
    stocktake = await started(maker, net)
    await counted(maker, net, stocktake, *coat, 2, 3)
    first = await finish(maker, net, stocktake)
    again = await finish(maker, net, stocktake, by=net.owner)
    assert first.status_code == again.status_code == 200
    assert again.json() == first.json()
    assert again.json()["finished_by"] == "manager"

    body = refused(
        await count(maker, net, stocktake, a_count(*coat, 1, 2, net=net)),
        409,
        "STOCKTAKE_FINISHED",
    )
    assert body["details"] == {"stocktake_id": stocktake, "recorded": False}
    assert await balance(maker, net, *coat) == 2

    later = await begin(maker, net, net.manager)
    assert later.status_code == 201 and later.json()["id"] != stocktake
    async with as_(maker, net, net.seller) as client:
        listed = await client.get(
            "/api/v1/stocktakes",
            params={
                "store_id": str(net.shops.primary_store),
                "location_id": str(net.shops.shared_warehouse),
            },
        )
    assert listed.status_code == 200, listed.text
    assert [(s["id"], s["finished_at"] is None) for s in listed.json()["items"]] == [
        (later.json()["id"], True),
        (stocktake, False),
    ]


async def test_a_count_is_recorded_once_however_late_it_is_resent(maker):
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=3)
    stocktake = await started(maker, net)
    body = a_count(*coat, 1, 3, net=net)
    first = await count(maker, net, stocktake, body)
    assert first.status_code == 201, first.text
    async with maker() as session:
        await session.execute(delete(IdempotencyRecord))
        await session.commit()
    # The answer was lost; the phone resends it with a new key, then after
    # the stocktake was finished: the same answer each time.
    late = await count(maker, net, stocktake, body)
    assert (late.status_code, late.json()) == (201, first.json())
    assert (await finish(maker, net, stocktake)).status_code == 200
    later = await count(maker, net, stocktake, body)
    assert (later.status_code, later.json()) == (201, first.json())
    assert await balance(maker, net, *coat) == 1
    assert await count_rows(maker, stocktake) == 1

    other = dict(body, counted_quantity=2)
    refused(await count(maker, net, stocktake, other), 409, "IDEMPOTENCY_CONFLICT")


# --- who --------------------------------------------------------------------------------


async def test_only_whoever_may_correct_stock_counts_and_whoever_sees_it_reads(maker):
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=3)
    refused(await begin(maker, net, net.seller), 403, "PERMISSION_DENIED")
    stocktake = await started(maker, net)
    refused(
        await count(maker, net, stocktake, a_count(*coat, 2, 3, net=net), by=net.seller),
        403,
        "PERMISSION_DENIED",
    )
    refused(await finish(maker, net, stocktake, by=net.seller), 403, "PERMISSION_DENIED")
    # A seller sees the stock, so sees the stocktake.
    assert (await read(maker, net, stocktake, by=net.seller)).status_code == 200
    assert len(await positions(maker, net, stocktake, "uncounted", by=net.seller)) == 1

    # The other store's owner counts the shared warehouse for their store.
    response = await count(
        maker,
        net,
        stocktake,
        a_count(*coat, 2, 3, store=net.shops.child_store),
        by=net.child_owner,
    )
    assert response.status_code == 201, response.text
    async with maker() as session:
        row = await session.scalar(
            select(StocktakeCount).where(StocktakeCount.stocktake_id == uuid.UUID(stocktake))
        )
        assert row is not None
        assert (row.store_id, row.counted_by_user_id) == (net.shops.child_store, net.child_owner)
        adjustment = await session.get(StockAdjustment, row.adjustment_id)
        assert adjustment is not None and adjustment.acting_store_id == net.shops.child_store

    # Nobody reads another network's.
    stranger = await network(maker)
    async with as_(maker, stranger, stranger.owner) as client:
        response = await client.get(
            f"/api/v1/stocktakes/{stocktake}",
            params={"store_id": str(stranger.shops.primary_store)},
        )
    refused(response, 404, "NOT_FOUND")


async def test_brak_is_never_counted_and_a_reserved_balance_is_only_checked(maker):
    net = await network(maker)
    bin_ = await give_bin(maker, net.shops.organization_id, net.shops.primary_store)
    refused(await begin(maker, net, net.manager, warehouse=bin_), 409, "DAMAGED_STOCK_CLOSED")

    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=3)
    async with api(maker, net.shops.scope(net.shops.primary_store, MANAGER)) as client:
        ordered = await client.post(
            "/api/v1/orders",
            json={
                "store_id": str(net.shops.primary_store),
                "command_id": str(uuid.uuid4()),
                "carrier": "NOVA_POSHTA",
                "lines": [
                    {
                        "product_variant_id": coat[0],
                        "size_id": coat[1],
                        "source_location_id": str(net.shops.shared_warehouse),
                        "quantity": 1,
                        "unit_price": "3000.00",
                    }
                ],
            },
        )
    assert ordered.status_code == 201, ordered.text
    stocktake = await started(maker, net)
    [held] = await positions(maker, net, stocktake, "uncounted")
    assert (held["quantity"], held["reserved_quantity"]) == (3, 1)
    body = refused(
        await count(maker, net, stocktake, a_count(*coat, 2, 3, net=net)), 422, "VALIDATION_ERROR"
    )
    assert (body["details"]["reason"], body["details"]["recorded"]) == ("RESERVED", False)
    # The same count as the balance is a position checked.
    assert (await counted(maker, net, stocktake, *coat, 3, 3))["quantity_delta"] == 0
    assert await balance(maker, net, *coat) == 3


# --- the owner hears of it --------------------------------------------------------------


class Bot:
    def __init__(self) -> None:
        self.sent: list[tuple[int, str]] = []

    async def __call__(self, chat: int, text_: str) -> None:
        self.sent.append((chat, text_))


async def messages(maker, stocktake: str) -> list[StocktakeMessage]:
    async with maker() as session:
        return list(
            (
                await session.scalars(
                    select(StocktakeMessage).where(
                        StocktakeMessage.stocktake_id == uuid.UUID(stocktake)
                    )
                )
            ).all()
        )


async def chat_of(maker, user_id: uuid.UUID) -> int:
    async with maker() as session:
        found = await session.scalar(
            text("SELECT telegram_user_id FROM app_user WHERE id = :id"), {"id": user_id}
        )
    assert found is not None
    return int(found)


async def test_the_owner_hears_the_sum_silently_and_nobody_else(maker):
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=3)
    jacket = await stocked(maker, net, net.shops.shared_warehouse, qty=1)
    await stocked(maker, net, net.shops.shared_warehouse, qty=2)
    stocktake = await started(maker, net)
    await counted(maker, net, stocktake, *coat, 1, 3)
    await counted(maker, net, stocktake, *jacket, 2, 1)
    assert await messages(maker, stocktake) == []
    done = await finish(maker, net, stocktake)
    assert done.status_code == 200, done.text

    [message] = await messages(maker, stocktake)
    # The network's owner only: not the manager who finished it, not the
    # other store's own owner.
    assert (message.user_id, message.status) == (net.owner, "PENDING")
    started_at = datetime.fromisoformat(done.json()["started_at"])
    finished_at = datetime.fromisoformat(done.json()["finished_at"])
    kyiv = "%d.%m %H:%M"
    zone = ZoneInfo("Europe/Kyiv")
    assert message.text == "\n".join(
        [
            "Інвентаризація: склад «Основний склад», магазин «Основний».",
            "Пораховано позицій: 2. Не перевірено: 1 — їхні залишки не змінювались.",
            "Нестача: 2 од. (позицій: 1).",
            "Надлишок: 1 од. (позицій: 1).",
            f"Початок: manager, {started_at.astimezone(zone):{kyiv}}. "
            f"Завершення: manager, {finished_at.astimezone(zone):{kyiv}}.",
        ]
    )

    bot = Bot()
    now = finished_at + timedelta(minutes=1)
    owner_chat = await chat_of(maker, net.owner)
    await backup_watch.tell_stocktakes(maker, bot, now)
    assert [sent for sent in bot.sent if sent[0] == owner_chat] == [(owner_chat, message.text)]
    [message] = await messages(maker, stocktake)
    assert (message.status, message.attempts) == ("SENT", 1)
    await backup_watch.tell_stocktakes(maker, bot, now)
    assert len([sent for sent in bot.sent if sent[0] == owner_chat]) == 1

    # The owner finishing one themselves hears nothing of it.
    own = await started(maker, net, net.owner)
    assert (await finish(maker, net, own, by=net.owner)).status_code == 200
    assert await messages(maker, own) == []


# --- never changed ----------------------------------------------------------------------


async def test_a_finished_stocktake_and_its_counts_are_never_changed(maker, engine):
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=3)
    stocktake = await started(maker, net)
    await counted(maker, net, stocktake, *coat, 2, 3)
    for statement in (
        "UPDATE stocktake_count SET counted_quantity = 3 WHERE stocktake_id = :id",
        "DELETE FROM stocktake_count WHERE stocktake_id = :id",
        "DELETE FROM stocktake WHERE id = :id",
        "UPDATE stocktake SET location_id = location_id, created_at = now() - interval '1 day' "
        "WHERE id = :id",
    ):
        with pytest.raises(DBAPIError, match=r"append-only|never deleted|changes only once"):
            async with engine.begin() as connection:
                await connection.execute(text(statement), {"id": stocktake})
    assert (await finish(maker, net, stocktake)).status_code == 200
    with pytest.raises(DBAPIError, match="changes only once"):
        async with engine.begin() as connection:
            await connection.execute(
                text("UPDATE stocktake SET shortage_units = 0 WHERE id = :id"), {"id": stocktake}
            )


async def test_revision_0040_goes_back_only_without_a_stocktake():
    name = f"birka_stocktake_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        await _run(config, "downgrade", "0039_outage_mark_debts_returns", database=name)
        await _run(config, "upgrade", "head", database=name)
        scratch = await _engine(name)
        try:
            maker = async_sessionmaker(scratch, expire_on_commit=False)
            net = await network(maker)
            await started(maker, net)
            with pytest.raises(Exception, match="0039 cannot hold a stocktake"):
                await _run(config, "downgrade", "0039_outage_mark_debts_returns", database=name)
            async with scratch.connect() as connection:
                version = await connection.scalar(text("SELECT version_num FROM alembic_version"))
            assert version == ScriptDirectory.from_config(config).get_current_head()
        finally:
            await scratch.dispose()
    finally:
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def test_a_size_not_known_is_only_counted_down_and_a_waiting_warehouse_not_at_all(
    maker, monkeypatch
):
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=1)
    async with maker() as session:
        system = await session.scalar(select(Size.size_system_id).where(Size.id == coat[1]))
        unknown = Size(size_system_id=system, code="UNKNOWN", is_unknown=True)
        session.add(unknown)
        await session.commit()
    stocktake = await started(maker, net)
    # As a correction (ADR-0005 §3): it enters only from a legacy stock list.
    body = refused(
        await count(maker, net, stocktake, a_count(coat[0], str(unknown.id), 1, 0, net=net)),
        422,
        "VALIDATION_ERROR",
    )
    assert body["details"] == {"size_id": str(unknown.id), "recorded": False}
    assert await count_rows(maker, stocktake) == 0
    assert (await finish(maker, net, stocktake)).status_code == 200

    # A warehouse that waits for its opening list moves nothing (owner
    # decision, 2026-10-02), so no stocktake of it starts.
    monkeypatch.setattr(stocktake_service, "awaiting_opening_list", waiting)
    refused(await begin(maker, net, net.manager), 409, "OPENING_LIST_PENDING")
    async with maker() as session:
        assert (
            await session.scalar(
                select(Stocktake.id).where(
                    Stocktake.location_id == net.shops.shared_warehouse,
                    Stocktake.finished_at.is_(None),
                )
            )
        ) is None


async def waiting(session, *, organization_id, location_id) -> bool:  # type: ignore[no-untyped-def]
    return True


async def test_the_watcher_tells_stocktakes_every_minute_with_the_silent_sender(monkeypatch):
    """`watch` starts the stocktakes' job beside the drawers', every minute,
    with the same silent `send` as the backups."""
    started: dict[str, tuple[float, Any]] = {}

    def every(name, seconds, timeout, job, stop, **kwargs):  # type: ignore[no-untyped-def]
        started[name] = (seconds, job)
        return asyncio.sleep(0)

    async def remember(self, now):  # type: ignore[no-untyped-def]
        return None

    told: list[Any] = []

    async def tell(maker_, send, now):  # type: ignore[no-untyped-def]
        told.append(send)

    monkeypatch.setattr(backup_watch, "every", every)
    monkeypatch.setattr(backup_watch.Watcher, "remember", remember)
    monkeypatch.setattr(backup_watch, "sender", lambda token: "silent")
    monkeypatch.setattr(backup_watch, "tell_stocktakes", tell)
    stop = asyncio.Event()
    stop.set()
    settings = Settings(
        app_env="local",
        database_url=os.environ["BIRKA_TEST_DATABASE_URL"],
        telegram_bot_token="123456:TEST-TOKEN-not-a-real-secret",
    )
    await backup_watch.watch(settings, 600, stop=stop)
    assert started["stocktakes"][0] == backup_watch.CASH_EVERY == 60.0
    await started["stocktakes"][1](datetime.now(UTC))
    assert told == ["silent"]


async def test_a_count_under_way_lands_before_the_finish_and_none_after(maker, monkeypatch):
    """The finish waits for a count that has passed its check (ADR-0022 §10):
    its sums include it, and nothing is counted into frozen sums."""
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=3)
    stocktake = await started(maker, net)
    reached, release = asyncio.Event(), asyncio.Event()
    real = stocktake_service.lock_stock

    async def paused(*args, **kwargs):  # type: ignore[no-untyped-def]
        reached.set()
        await release.wait()
        return await real(*args, **kwargs)

    monkeypatch.setattr(stocktake_service, "lock_stock", paused)
    counting = asyncio.create_task(count(maker, net, stocktake, a_count(*coat, 2, 3, net=net)))
    await asyncio.wait_for(reached.wait(), timeout=10)
    finishing = asyncio.create_task(finish(maker, net, stocktake, by=net.owner))
    await asyncio.sleep(0.5)
    assert not finishing.done()
    release.set()
    counted_response, finished = await asyncio.gather(counting, finishing)
    assert counted_response.status_code == 201, counted_response.text
    assert finished.status_code == 200, finished.text
    assert finished.json()["sums"]["counted_positions"] == 1
    assert finished.json()["sums"]["shortage_units"] == 1


async def test_another_networks_stocktake_models_and_private_warehouses_are_not_counted(maker):
    net = await network(maker)
    coat = await stocked(maker, net, net.shops.shared_warehouse, qty=3)
    stocktake = await started(maker, net)

    stranger = await network(maker)
    theirs = await stocked(maker, stranger, stranger.shops.shared_warehouse, qty=2)
    # Their manager, at our stocktake: it does not exist for them.
    refused(
        await count(
            maker,
            stranger,
            stocktake,
            a_count(*coat, 2, 3, net=stranger),
            by=stranger.manager,
        ),
        404,
        "NOT_FOUND",
    )
    # Our manager, counting their model here: unknown, and nothing recorded.
    body = refused(
        await count(maker, net, stocktake, a_count(*theirs, 1, 0, net=net)), 404, "NOT_FOUND"
    )
    assert body["details"]["recorded"] is False
    assert await count_rows(maker, stocktake) == 0
    assert await balance(maker, stranger, *theirs) == 2

    # The other store's own warehouse is its own: the network's manager
    # neither starts, counts nor reads a stocktake there.
    refused(
        await begin(maker, net, net.manager, store=net.shops.child_store, warehouse=net.own),
        403,
        "PERMISSION_DENIED",
    )
    own = await begin(maker, net, net.child_owner, store=net.shops.child_store, warehouse=net.own)
    assert own.status_code == 201, own.text
    vest = await stocked(maker, net, net.own, qty=1)
    refused(
        await count(
            maker,
            net,
            own.json()["id"],
            a_count(*vest, 0, 1, store=net.shops.child_store),
            by=net.manager,
        ),
        403,
        "PERMISSION_DENIED",
    )
    async with as_(maker, net, net.manager) as client:
        response = await client.get(
            f"/api/v1/stocktakes/{own.json()['id']}",
            params={"store_id": str(net.shops.child_store)},
        )
    assert response.status_code == 403, response.text
