"""«Сьогодні ви продали N шт.» (owner decisions, 2026-10-16, В8, and
2026-10-17), over HTTP against real PostgreSQL, signed in as the network's
people, and the store's day read at chosen moments.

- The caller's own units sold today in the store, less every unit returned
  from those same sales, whoever took the return; units only, no sum or way.
- A sale typed from paper counts for whoever is named under «Хто продав»,
  else for whoever typed it.
- Only the till's sales: a collected order's is not one.
- The store's business day, 06:00 to 06:00, as the drawer's (G8).
- Only someone who may sell in that store reads it.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, time, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.scope import RequestScope
from app.modules.cash.service import business_day
from app.modules.cash.sold_today import sold_today
from app.modules.sales.models import Sale, SaleItem
from app.modules.tenancy.models import Store
from tests.conftest import requires_database
from tests.integration.test_cash_schema import a_sale
from tests.integration.test_outage_mark import SALES, a_viewer, coats, person, send, typed
from tests.integration.test_outage_mark_returns_payments import a_return, take_back
from tests.integration.test_shared_warehouse import order_body, sale_body
from tests.integration.test_store_states import Network, as_, network, stocked

pytestmark = [pytest.mark.integration, requires_database()]

TODAY = f"{SALES}/sold-today"


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def sell(
    maker, net: Network, by: uuid.UUID, qty: int = 1, *, store: uuid.UUID | None = None
) -> dict:
    """`qty` coats at the till, by `by`, from the shared warehouse."""
    store = store or net.shops.primary_store
    variant, size = await stocked(maker, net, net.shops.shared_warehouse, qty=qty)
    sent = await send(
        maker, net, by, sale_body(store, net.shops.shared_warehouse, variant, size, qty=qty)
    )
    assert sent.status_code == 201, sent.text
    return sent.json()


async def today(maker, net: Network, by: uuid.UUID, store: uuid.UUID | None = None) -> dict:
    async with as_(maker, net, by) as client:
        read = await client.get(TODAY, params={"store_id": str(store or net.shops.primary_store)})
    assert read.status_code == 200, read.text
    return read.json()


async def units(maker, net: Network, by: uuid.UUID, store: uuid.UUID | None = None) -> int:
    return (await today(maker, net, by, store))["units"]


async def test_a_seller_s_units_today_less_those_returned_and_nothing_else(maker):
    net = await network(maker)
    assert await units(maker, net, net.seller) == 0
    two = await sell(maker, net, net.seller, qty=2)
    await sell(maker, net, net.seller)
    assert await units(maker, net, net.seller) == 3

    # One of the two back, taken by the manager: the seller's count falls.
    back = await take_back(maker, net, net.manager, two, a_return(two, mark=None))
    assert back.status_code == 201, back.text
    read = await today(maker, net, net.seller)
    async with maker() as session:
        store = await session.get(Store, net.shops.primary_store)
    assert store is not None
    assert read == {
        "business_day": business_day(datetime.now(UTC), store.timezone).isoformat(),
        "units": 2,
    }


async def test_only_the_caller_s_own_sales_count(maker):
    net = await network(maker)
    colleague = await person(maker, net, "Оксана", store=net.shops.primary_store)
    await sell(maker, net, net.seller, qty=2)
    theirs = await sell(maker, net, colleague, qty=2)
    await sell(maker, net, net.owner)
    # A return of the colleague's sale is the colleague's, not the seller's.
    back = await take_back(maker, net, net.manager, theirs, a_return(theirs, mark=None))
    assert back.status_code == 201, back.text
    assert await units(maker, net, net.seller) == 2
    assert await units(maker, net, colleague) == 1
    assert await units(maker, net, net.owner) == 1


async def test_a_sale_typed_from_paper_counts_for_whoever_is_named_as_selling(maker):
    net = await network(maker)
    colleague = await person(maker, net, "Оксана", store=net.shops.primary_store)
    # Typed by the seller, sold by the colleague, as the paper says.
    named = await send(
        maker, net, net.seller, typed(net, await coats(maker, net), sold_by=colleague)
    )
    assert named.status_code == 201, named.text
    # Typed by the seller, nobody named: the seller's.
    unnamed = await send(maker, net, net.seller, typed(net, await coats(maker, net)))
    assert unnamed.status_code == 201, unnamed.text
    assert await units(maker, net, net.seller) == 1
    assert await units(maker, net, colleague) == 1


async def test_a_collected_order_is_not_counted(maker):
    net = await network(maker)
    variant, size = await stocked(maker, net, net.shops.shared_warehouse, qty=2)
    async with as_(maker, net, net.seller) as client:
        made = await client.post(
            "/api/v1/orders",
            json=order_body(
                net.shops.primary_store, net.shops.shared_warehouse, variant, size, qty=2
            )
            | {"carrier": "NOVA_POSHTA"},
        )
        assert made.status_code == 201, made.text
        order = made.json()["id"]
        for action in ("dispatch", "arrive"):
            moved = await client.post(
                f"/api/v1/orders/{order}/{action}", json={"command_id": str(uuid.uuid4())}
            )
            assert moved.status_code == 200, moved.text
        collected = await client.post(
            f"/api/v1/orders/{order}/collect",
            json={"command_id": str(uuid.uuid4()), "payment_method": "CARRIER_COD"},
        )
        assert collected.status_code == 200, collected.text
        assert collected.json()["sale_id"]
    assert await units(maker, net, net.seller) == 0
    await sell(maker, net, net.seller)
    assert await units(maker, net, net.seller) == 1


async def test_each_store_counts_its_own(maker):
    net = await network(maker)
    await sell(maker, net, net.owner, qty=2)
    await sell(maker, net, net.owner, store=net.shops.child_store)
    assert await units(maker, net, net.owner) == 2
    assert await units(maker, net, net.owner, net.shops.child_store) == 1


async def test_the_day_is_the_store_s_from_six_to_six(maker):
    net = await network(maker)
    sale = await sell(maker, net, net.seller, qty=2)
    async with maker() as session:
        stored = await session.get(Sale, uuid.UUID(sale["id"]))
        store = await session.get(Store, net.shops.primary_store)
        assert stored is not None and store is not None
        zone = ZoneInfo(store.timezone)
        day = business_day(stored.sold_at, store.timezone)
        begins = datetime.combine(day, time(6), zone)
        scope = RequestScope(user_id=net.seller, organization_id=net.shops.organization_id)

        async def at(moment: datetime) -> int:
            return (await sold_today(session, scope=scope, store_id=store.id, now=moment)).units

        assert await at(begins) == 2
        assert await at(begins + timedelta(hours=23, minutes=59)) == 2
        # 05:59 is the evening before's; 06:00 the next day's.
        assert await at(begins - timedelta(minutes=1)) == 0
        assert await at(begins + timedelta(days=1)) == 0
        assert (
            await sold_today(session, scope=scope, store_id=store.id, now=begins)
        ).business_day == day


async def a_sale_at(maker, net: Network, line: SaleItem, at: datetime, qty: int) -> dict:
    """A sale of `qty` of `line`'s coat by the seller, dated `at`: a day long
    past, as no request can date it. Returned as the API shows a sale."""
    async with maker() as session:
        sale = await a_sale(
            session,
            SimpleNamespace(organization_id=net.shops.organization_id, user_id=net.seller),
            net.shops.primary_store,
            sold_at=at,
        )
        copied = {
            column.key: getattr(line, column.key)
            for column in SaleItem.__table__.columns
            if column.key not in {"id", "sale_id"}
        }
        item = SaleItem(
            sale_id=sale,
            **copied | {"quantity": qty, "line_total": line.final_unit_price * qty},
        )
        session.add(item)
        await session.commit()
        return {"id": str(sale), "items": [{"id": str(item.id)}]}


async def test_a_day_runs_from_six_to_six_by_the_store_s_own_clock(maker):
    """Sold at 03:00 and at 07:00 on a day long past, by the store's clock
    (Kyiv, two hours ahead of UTC that day): 03:00 is the evening before's,
    07:00 the day's — which a day counted by UTC, from 08:00, would miss."""
    net = await network(maker)
    real = await sell(maker, net, net.seller)
    async with maker() as session:
        store = await session.get(Store, net.shops.primary_store)
        line = await session.scalar(
            select(SaleItem).where(SaleItem.sale_id == uuid.UUID(real["id"]))
        )
    assert store is not None and line is not None
    zone = ZoneInfo(store.timezone)
    march = date(2026, 3, 10)
    night = await a_sale_at(maker, net, line, datetime.combine(march, time(3), zone), qty=2)
    await a_sale_at(maker, net, line, datetime.combine(march, time(7), zone), qty=3)
    scope = RequestScope(user_id=net.seller, organization_id=net.shops.organization_id)

    async def at(moment: datetime) -> int:
        async with maker() as session:
            return (await sold_today(session, scope=scope, store_id=store.id, now=moment)).units

    assert await at(datetime.combine(march, time(5, 59), zone)) == 2
    assert await at(datetime.combine(march, time(12), zone)) == 3
    assert await at(datetime.combine(march - timedelta(days=1), time(12), zone)) == 2

    # Returned today, the March sale changes neither today nor that day:
    # a return counts against its own sale, by the day's end.
    back = await take_back(maker, net, net.manager, night, a_return(night, mark=None))
    assert back.status_code == 201, back.text
    assert await units(maker, net, net.seller) == 1
    assert await at(datetime.combine(march, time(5, 59), zone)) == 2


async def test_only_someone_who_may_sell_there_reads_it(maker):
    net = await network(maker)
    viewer = await a_viewer(maker, net)
    async with as_(maker, net, viewer) as client:
        read = await client.get(TODAY, params={"store_id": str(net.shops.primary_store)})
    assert read.status_code == 403, read.text
    # The child store's seller, of the primary store's figure.
    async with as_(maker, net, net.child_seller) as client:
        read = await client.get(TODAY, params={"store_id": str(net.shops.primary_store)})
    assert read.status_code == 403, read.text
    async with as_(maker, net, net.seller) as client:
        read = await client.get(TODAY, params={"store_id": str(uuid.uuid4())})
    # Refused before the store is looked up: nothing says whether it exists.
    assert read.status_code == 403, read.text


async def test_the_path_is_never_taken_for_a_sale_s_id(maker):
    net = await network(maker)
    async with as_(maker, net, net.seller) as client:
        read = await client.get(TODAY, params={"store_id": str(net.shops.primary_store)})
        missing = await client.get(TODAY)
    assert read.status_code == 200, read.text
    assert missing.status_code == 422
    assert "store_id" in missing.text
