"""«З паперу»: the first days' paper, a mark of its own (owner decisions,
2026-10-15 and 2026-10-16; ADR-0013 §5.8), over HTTP against real
PostgreSQL, signed in as the network's people.

- A sale, a return or a debt payment typed from the paper of the first
  days carries the mark with `first_days`: the same mark in every other
  way — who sold or took it, the paper's time, the shelf's rule — and it
  says so wherever the mark is shown.
- The paper's time may be any of the last two weeks; an outage's stays
  today's or yesterday's.
- The kind is part of the command: the same command with the other kind is
  another one. An outage's mark is printed exactly as before (the pins in
  `test_old_prints_are_pinned.py` are unchanged).
- The database keeps it: never without the mark, never changed.
- The till is told a warehouse waits for its opening list.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.credit.models import CreditEntry
from app.modules.refunds.models import Refund
from app.modules.sales import outage
from app.modules.sales.models import Sale
from tests.conftest import requires_database
from tests.integration.test_cash_schema import a_sale
from tests.integration.test_outage_mark import (
    SALES,
    coats,
    moment,
    paper,
    refused,
    send,
    typed,
)
from tests.integration.test_outage_mark_returns_payments import (
    a_payment,
    a_return,
    on_credit,
    pay,
    payments_of,
    refund_row,
    sold,
    take_back,
)
from tests.integration.test_sales_report import entries_of
from tests.integration.test_shared_warehouse import make_two_shops
from tests.integration.test_snapshot_import import (
    LIST,
    client_for,
    create_product,
    idempotent,
    seed_world,
)
from tests.integration.test_store_states import as_, network

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def first_days(net, coat, *, sold_by=None, sold_at=None, **extra: Any) -> dict[str, Any]:
    """A sale typed from the first days' paper, as the till sends it."""
    body = typed(net, coat, sold_by=sold_by, sold_at=sold_at, **extra)
    body["outage"] = body["outage"] | {"first_days": True}
    return body


async def sale_row(maker, sale_id: str) -> Sale:
    async with maker() as session:
        found = await session.get(Sale, uuid.UUID(sale_id))
    assert found is not None
    return found


async def test_a_sale_of_the_first_days_is_marked_so_and_shown_so(maker):
    """Typed today from paper written nine days ago, while the warehouse
    waited for its list: dated today, the paper's day kept, and «з паперу»
    wherever the mark is shown."""
    net = await network(maker)
    coat = await coats(maker, net)
    written = paper(9, "12:30")
    before = datetime.now(UTC)
    typed_in = await send(maker, net, net.seller, first_days(net, coat, sold_at=written))
    assert typed_in.status_code == 201, typed_in.text
    mark = typed_in.json()["outage"]
    assert (mark["first_days"], mark["sold_by"]) == (True, None)
    assert datetime.fromisoformat(mark["sold_at"]) == moment(written)

    stored = await sale_row(maker, typed_in.json()["id"])
    assert (stored.during_outage, stored.outage_first_days) == (True, True)
    # Dated when typed, never when written.
    assert stored.sold_at >= before - timedelta(seconds=5)

    async with as_(maker, net, net.seller) as client:
        read = await client.get(f"{SALES}/{typed_in.json()['id']}")
        listed = await client.get(SALES, params={"store_id": str(net.shops.primary_store)})
    assert read.json()["outage"]["first_days"] is True
    by_id = {sale["id"]: sale for sale in listed.json()["sales"]}
    assert by_id[typed_in.json()["id"]]["outage"]["first_days"] is True

    entry = (await entries_of(maker, net, store_id=net.shops.primary_store))[typed_in.json()["id"]]
    assert entry["outage"] == {"sold_by": None, "sold_at": mark["sold_at"], "first_days": True}


async def test_the_first_days_paper_goes_two_weeks_back_and_an_outage_s_one_day(maker):
    net = await network(maker)
    # The oldest day taken: the thirteenth before today.
    two_weeks = await send(
        maker,
        net,
        net.seller,
        first_days(
            net, await coats(maker, net), sold_at=paper(outage.FIRST_DAYS_PAPER_DAYS - 1, "10:00")
        ),
    )
    assert two_weeks.status_code == 201, two_weeks.text

    older = await send(
        maker,
        net,
        net.seller,
        first_days(
            net, await coats(maker, net), sold_at=paper(outage.FIRST_DAYS_PAPER_DAYS, "10:00")
        ),
    )
    refused(older, "OUTAGE_TIME_TOO_OLD")
    # Today and the thirteen days before it: two weeks.
    assert older.json()["details"]["days"] == 13

    # An outage's paper is still today's or yesterday's (G1).
    outage_s = await send(
        maker, net, net.seller, typed(net, await coats(maker, net), sold_at=paper(2, "10:00"))
    )
    refused(outage_s, "OUTAGE_TIME_TOO_OLD")
    assert outage_s.json()["details"]["days"] == 1


async def test_the_first_days_paper_says_nothing_of_the_shelf(maker):
    """Nobody stands at the shelf when the first days' paper is typed: no
    «фізично є», and a shortfall is never correctable (ADR-0013 §6)."""
    net = await network(maker)
    coat = await coats(maker, net, qty=1)
    told = await send(
        maker,
        net,
        net.seller,
        first_days(net, coat, qty=2, found_in_store=[{"line_index": 0, "quantity": 1}]),
    )
    refused(told, "OUTAGE_SHELF_REPORT")

    short = await send(maker, net, net.seller, first_days(net, coat, qty=2))
    assert short.status_code == 409, short.text
    assert short.json()["code"] == "INSUFFICIENT_STOCK"
    assert short.json()["details"]["correctable"] is False


async def test_the_kind_is_part_of_the_command(maker):
    """The same command with the other kind is another sale; resent as it
    was, it replays."""
    net = await network(maker)
    body = first_days(net, await coats(maker, net), sold_at=paper(5, "18:00"))
    first = await send(maker, net, net.seller, body)
    assert first.status_code == 201, first.text
    again = await send(maker, net, net.seller, body)
    assert again.json()["id"] == first.json()["id"]

    as_an_outage = body | {"outage": {k: v for k, v in body["outage"].items() if k != "first_days"}}
    conflict = await send(maker, net, net.seller, as_an_outage)
    assert (conflict.status_code, conflict.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")

    outage_body = typed(net, await coats(maker, net))
    recorded = await send(maker, net, net.seller, outage_body)
    assert recorded.status_code == 201, recorded.text
    marked_later = outage_body | {"outage": outage_body["outage"] | {"first_days": True}}
    conflict = await send(maker, net, net.seller, marked_later)
    assert (conflict.status_code, conflict.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    # `first_days: false` sent is an outage's mark, printed as before.
    stated = outage_body | {"outage": outage_body["outage"] | {"first_days": False}}
    replayed = await send(maker, net, net.seller, stated)
    assert replayed.json()["id"] == recorded.json()["id"]


async def test_the_kind_is_part_of_a_return_s_and_a_payment_s_command(maker):
    """A return or a payment resent with the other kind is another one; resent
    as it was, it replays; an outage's stated `first_days: false` is the
    outage's own."""
    net = await network(maker)
    first_days_mark = {"by_user_id": None, "at": None, "first_days": True}
    outage_mark = {"by_user_id": None, "at": None}

    sale = await sold(maker, net)
    command = str(uuid.uuid4())
    body = a_return(sale, mark=first_days_mark, command=command)
    first = await take_back(maker, net, net.seller, sale, body)
    assert first.status_code == 201, first.text
    again = await take_back(maker, net, net.seller, sale, body)
    assert again.json() == first.json()
    conflict = await take_back(
        maker, net, net.seller, sale, a_return(sale, mark=outage_mark, command=command)
    )
    assert (conflict.status_code, conflict.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")

    credit_id = await on_credit(maker, net)
    command = str(uuid.uuid4())
    body = a_payment(mark=outage_mark, command=command)
    first = await pay(maker, net, net.seller, credit_id, body)
    assert first.status_code == 201, first.text
    stated = await pay(
        maker,
        net,
        net.seller,
        credit_id,
        a_payment(mark=outage_mark | {"first_days": False}, command=command),
    )
    assert stated.json() == first.json()
    conflict = await pay(
        maker, net, net.seller, credit_id, a_payment(mark=first_days_mark, command=command)
    )
    assert (conflict.status_code, conflict.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    assert len(await payments_of(maker, credit_id)) == 2


def test_an_outage_s_mark_is_printed_as_before_and_the_first_days_say_so():
    plain = outage.OutageMark(sold_at="2026-10-06T19:40")
    assert outage.print_of_mark(plain) == {
        "outage": {"sold_by_user_id": None, "sold_at": "2026-10-06T19:40"}
    }
    first = outage.OutageMark(sold_at="2026-10-06T19:40", first_days=True)
    assert outage.print_of_mark(first) == {
        "outage": {"sold_by_user_id": None, "sold_at": "2026-10-06T19:40", "first_days": True}
    }
    assert outage.print_of_paper(outage.PaperMark()) == {"outage": {"by_user_id": None, "at": None}}
    assert outage.print_of_paper(outage.PaperMark(first_days=True)) == {
        "outage": {"by_user_id": None, "at": None, "first_days": True}
    }


async def test_a_return_and_a_payment_of_the_first_days_carry_it_too(maker):
    """Owner decision, 2026-10-16: the first days' returns and debt payments
    typed from paper are «з паперу», with the same two weeks."""
    net = await network(maker)
    sale = await sold(maker, net)
    written = paper(10, "16:40")
    mark = {"by_user_id": str(net.seller), "at": written, "first_days": True}
    returned = await take_back(maker, net, net.manager, sale, a_return(sale, mark=mark))
    assert returned.status_code == 201, returned.text
    assert returned.json()["outage"]["first_days"] is True
    assert (await refund_row(maker, returned.json()["id"])).outage_first_days is True
    entry = (await entries_of(maker, net, store_id=net.shops.primary_store))[returned.json()["id"]]
    assert entry["outage"]["first_days"] is True

    other = await sold(maker, net)
    too_old = await take_back(
        maker, net, net.manager, other, a_return(other, mark=mark | {"at": paper(14, "16:40")})
    )
    assert too_old.status_code == 422, too_old.text
    assert too_old.json()["details"]["reason"] == "OUTAGE_TIME_TOO_OLD"
    assert too_old.json()["details"]["days"] == 13

    credit_id = await on_credit(maker, net)
    paid = await pay(maker, net, net.seller, credit_id, a_payment(mark=mark))
    assert paid.status_code == 201, paid.text
    assert paid.json()["entries"][-1]["outage"]["first_days"] is True
    assert (await payments_of(maker, credit_id))[-1].outage_first_days is True
    old = await pay(
        maker, net, net.seller, credit_id, a_payment(mark=mark | {"at": paper(14, "16:40")})
    )
    assert old.status_code == 422, old.text
    assert old.json()["details"]["reason"] == "OUTAGE_TIME_TOO_OLD"


async def test_the_database_keeps_the_first_days_mark(maker):
    """Never without the mark, never changed once written."""
    shops = await make_two_shops(maker)
    async with maker() as session:
        with pytest.raises(DBAPIError, match="first_days_need_the_mark"):
            await a_sale(session, shops, shops.primary_store, outage_first_days=True)
    async with maker() as session:
        live = await a_sale(session, shops, shops.primary_store)
        marked = await a_sale(
            session, shops, shops.primary_store, during_outage=True, outage_first_days=True
        )
        await session.commit()
    for sale_id, value in ((live, True), (marked, False)):
        async with maker() as session:
            with pytest.raises(DBAPIError, match="never changed"):
                await session.execute(
                    update(Sale).where(Sale.id == sale_id).values(outage_first_days=value)
                )

    net = await network(maker)
    sale = await sold(maker, net)
    returned = await take_back(maker, net, net.seller, sale, a_return(sale, mark={}))
    assert returned.status_code == 201, returned.text
    async with maker() as session:
        with pytest.raises(DBAPIError, match="never changed"):
            await session.execute(
                update(Refund)
                .where(Refund.id == uuid.UUID(returned.json()["id"]))
                .values(outage_first_days=True)
            )
    credit_id = await on_credit(maker, net)
    paid = await pay(maker, net, net.seller, credit_id, a_payment(mark={}))
    assert paid.status_code == 201, paid.text
    entry = (await payments_of(maker, credit_id))[-1]
    async with maker() as session:
        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(
                update(CreditEntry).where(CreditEntry.id == entry.id).values(outage_first_days=True)
            )


async def test_the_till_is_told_a_warehouse_has_recorded_nothing_yet(maker):
    """Nothing is sold where nothing has been recorded: its opening list,
    typed or not, or its first delivery is awaited, and a «Товар на місці»
    there would close it to its list for good (owner decisions, 2026-10-02
    and 2026-10-16; redesign P1-5). One delivery, and it is open."""

    async def waiting(client, seeded) -> bool:
        listed = await client.get(
            "/api/v1/stock-locations", params={"store_id": str(seeded["main"])}
        )
        assert listed.status_code == 200, listed.text
        return next(
            loc["awaiting_first_stock"]
            for loc in listed.json()
            if loc["id"] == str(seeded["shared"])
        )

    # Nothing recorded, no list yet: waiting all the same; its list typed,
    # still waiting.
    listed_world = await seed_world(maker)
    async with client_for(maker, listed_world["users"]["owner"]) as client:
        fresh = await waiting(client, listed_world)
        typed = await client.post(
            "/api/v1/snapshots",
            json={
                "command_id": str(uuid.uuid4()),
                "store_id": str(listed_world["main"]),
                "location_id": str(listed_world["shared"]),
                "lines": LIST,
            },
        )
        assert typed.status_code == 201, typed.text
        held = await waiting(client, listed_world)

    # One delivery, and the warehouse is open.
    delivered_world = await seed_world(maker)
    async with client_for(maker, delivered_world["users"]["owner"]) as client:
        variant, sizes = await create_product(
            client, delivered_world["main"], "Лоран", "шоколад", ["M"]
        )
        before = await waiting(client, delivered_world)
        received = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(delivered_world["main"]),
                "location_id": str(delivered_world["shared"]),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {"product_variant_id": str(variant), "size_id": str(sizes["M"]), "quantity": 1}
                ],
            },
            headers=idempotent(),
        )
        assert received.status_code == 201, received.text
        opened = await waiting(client, delivered_world)

    assert (fresh, held, before, opened) == (True, True, True, False)


async def test_revision_0041_goes_back_only_without_the_first_days_mark():
    """On a database of its own: the clean way back while no row carries the
    mark, and the refusal once one does."""
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_first_days_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine_ = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        await _run(config, "downgrade", "0040_warehouse_stocktake", database=name)
        async with engine_.connect() as connection:
            columns = set(
                (
                    await connection.scalars(
                        text(
                            "SELECT table_name FROM information_schema.columns "
                            "WHERE column_name = 'outage_first_days'"
                        )
                    )
                ).all()
            )
            guard = await connection.scalar(
                text("SELECT count(*) FROM pg_proc WHERE proname = 'birka_guard_first_days_mark'")
            )
        assert (columns, guard) == (set(), 0)
        await _run(config, "upgrade", "head", database=name)

        fresh = async_sessionmaker(engine_, expire_on_commit=False)
        shops = await make_two_shops(fresh)
        async with fresh() as session:
            await a_sale(
                session, shops, shops.primary_store, during_outage=True, outage_first_days=True
            )
            await session.commit()
        with pytest.raises(Exception, match="cannot hold the mark «з паперу»"):
            await _run(config, "downgrade", "0040_warehouse_stocktake", database=name)
        async with fresh() as session:
            assert (
                await session.scalar(select(Sale.id).where(Sale.outage_first_days.is_(True)))
            ) is not None
    finally:
        await engine_.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
