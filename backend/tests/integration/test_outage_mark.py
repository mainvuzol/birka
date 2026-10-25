"""The mark «продано під час збою» (owner decisions, 2026-10-04 and
2026-10-07; ADR-0013 §5, §6), over HTTP against real PostgreSQL, signed in as
the network's people.

- A sale typed from paper is an ordinary sale, dated when it is typed, typed
  by whoever sent it, with a mark that may name who sold and the paper's
  time. It never moves `sold_at` or the drawer's period.
- The mark is part of the command: in its print, with the paper's time as
  the literal the body carried, whatever the store's zone.
- Who may be named: an active person who may sell in that store now, by a
  grant for it or for the whole network; never another network's. The
  till's list of names is exactly whom the check accepts.
- The paper's time: today or yesterday in the store's zone, and not ahead of
  the server by more than clocks differ.
- The checks sit after the replay lookup: a marked sale recorded and resent
  after its day aged out, or after the person it names left, still replays.
- A marked sale says nothing about the shelf, and its shortfall is never
  correctable; every shortfall says whether an order holds the units.
- The mark is permanent: the database refuses any change of it.
- An ordinary sale asks nothing more of the database for it.

«Звіт» is in `test_sales_report.py`; the prints are pinned in
`test_old_prints_are_pinned.py`. All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import event, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.core import idempotency
from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.authz.permissions import Permission, RoleCode
from app.modules.authz.service import seed_default_roles
from app.modules.identity.models import AppUser
from app.modules.inventory.service import ReservationRequest, reserve_stock
from app.modules.sales import outage
from app.modules.sales.models import Sale
from app.modules.tenancy.models import Store
from tests.conftest import requires_database
from tests.integration.test_cash_schema import a_close, a_sale
from tests.integration.test_shared_warehouse import (
    api,
    key,
    make_two_shops,
    sale_body,
    stock_a_coat,
)
from tests.integration.test_store_states import Network, as_, network, set_state, stocked

pytestmark = [pytest.mark.integration, requires_database()]

KYIV = ZoneInfo("Europe/Kyiv")
SALES = "/api/v1/sales"


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


# --- the network's people, and paper ----------------------------------------


def kyiv_day(days_ago: int) -> date:
    return datetime.now(KYIV).date() - timedelta(days=days_ago)


def paper(days_ago: int, at: str) -> str:
    """The paper's time as the phone writes it: the store's wall clock."""
    return f"{kyiv_day(days_ago).isoformat()}T{at}"


def moment(written: str) -> datetime:
    return datetime.fromisoformat(written).replace(tzinfo=KYIV)


async def person(
    maker,
    net: Network,
    name: str,
    *,
    store: uuid.UUID | None,
    role: str = RoleCode.SELLER.value,
    membership_active: bool = True,
    active: bool = True,
) -> uuid.UUID:
    """Someone of this network: a grant for `store`, or for the whole network
    when it is None, through the role named."""
    async with maker() as session:
        roles = await seed_default_roles(session, net.shops.organization_id)
        user = AppUser(
            telegram_user_id=uuid.uuid4().int % 2**62, display_name=name, is_active=active
        )
        session.add(user)
        await session.flush()
        session.add(
            Membership(
                user_id=user.id,
                organization_id=net.shops.organization_id,
                store_id=store,
                role_id=roles[role].id,
                is_active=membership_active,
            )
        )
        await session.commit()
        return user.id


async def a_viewer(maker, net: Network) -> uuid.UUID:
    """Someone of the primary store whose role reads the sales and sells
    nothing: a role an owner composed."""
    async with maker() as session:
        role = Role(
            organization_id=net.shops.organization_id,
            code=f"VIEWER-{uuid.uuid4().hex[:6]}",
            name="Перегляд",
            is_system=False,
        )
        session.add(role)
        await session.flush()
        session.add(RolePermission(role_id=role.id, permission_code=Permission.SALE_VIEW.value))
        user = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name="Віра")
        session.add(user)
        await session.flush()
        session.add(
            Membership(
                user_id=user.id,
                organization_id=net.shops.organization_id,
                store_id=net.shops.primary_store,
                role_id=role.id,
            )
        )
        await session.commit()
        return user.id


async def coats(maker, net: Network, qty: int = 1) -> tuple[str, str]:
    return await stocked(maker, net, net.shops.shared_warehouse, qty=qty)


def typed(
    net: Network,
    coat: tuple[str, str],
    *,
    sold_by: uuid.UUID | None = None,
    sold_at: str | None = None,
    way: str = "CARD",
    qty: int = 1,
    **extra: Any,
) -> dict[str, Any]:
    """A sale typed from paper at the primary store, from the shared
    warehouse, as the till sends it in paper mode."""
    return (
        sale_body(net.shops.primary_store, net.shops.shared_warehouse, *coat, qty=qty)
        | {
            "payment_method": way,
            "outage": {
                "sold_by_user_id": str(sold_by) if sold_by is not None else None,
                "sold_at": sold_at,
            },
        }
        | extra
    )


async def send(
    maker, net: Network, by: uuid.UUID, body: dict[str, Any], headers: dict | None = None
) -> httpx.Response:
    async with as_(maker, net, by) as client:
        return await client.post(SALES, json=body, headers=headers or key())


def refused(response: httpx.Response, reason: str) -> None:
    """A refusal of the mark: decided after the lookup, so it says it
    recorded nothing."""
    assert response.status_code == 422, response.text
    body = response.json()
    assert (body["code"], body["details"]["reason"]) == ("VALIDATION_ERROR", reason)
    assert body["details"]["recorded"] is False


async def row(maker, sale_id: str) -> Sale:
    async with maker() as session:
        found = await session.get(Sale, uuid.UUID(sale_id))
    assert found is not None
    return found


# --- stored, shown -------------------------------------------------------------


async def test_a_sale_typed_from_paper_is_stored_with_its_mark(maker):
    """Typed by the manager, sold by the seller, as the paper says. Who typed
    it is the sale's seller, as for every sale (owner, Q2)."""
    net = await network(maker)
    coat = await coats(maker, net)
    written = paper(1, "19:40")
    sold = await send(
        maker, net, net.manager, typed(net, coat, sold_by=net.seller, sold_at=written)
    )

    assert sold.status_code == 201, sold.text
    stored = await row(maker, sold.json()["id"])
    assert (stored.during_outage, stored.outage_sold_by) == (True, net.seller)
    assert stored.outage_sold_at == moment(written)
    assert stored.seller_user_id == net.manager
    mark = sold.json()["outage"]
    assert (mark["sold_by_user_id"], mark["sold_by"]) == (str(net.seller), "seller")
    assert datetime.fromisoformat(mark["sold_at"]) == moment(written)


async def test_the_mark_shows_on_the_receipt_the_sale_and_the_stores_list(maker):
    net = await network(maker)
    coat = await coats(maker, net, qty=3)
    written = paper(1, "09:05")
    marked = await send(
        maker, net, net.seller, typed(net, coat, sold_by=net.seller, sold_at=written)
    )
    nobody = await send(maker, net, net.seller, typed(net, coat))
    live = await send(
        maker,
        net,
        net.seller,
        sale_body(net.shops.primary_store, net.shops.shared_warehouse, *coat),
    )
    for response in (marked, nobody, live):
        assert response.status_code == 201, response.text
    async with as_(maker, net, net.seller) as client:
        read_back = await client.get(f"{SALES}/{marked.json()['id']}")
        listed = await client.get(SALES, params={"store_id": str(net.shops.primary_store)})
    # Rebuilt without the stored answer, as for a sale from before it existed.
    async with maker.begin() as session:
        await session.execute(
            update(Sale)
            .where(Sale.id == uuid.UUID(marked.json()["id"]))
            .values(response_snapshot=None)
        )
    async with as_(maker, net, net.seller) as client:
        rebuilt = await client.get(f"{SALES}/{marked.json()['id']}")

    expected = {"sold_by_user_id": str(net.seller), "sold_by": "seller"}
    for shown in (marked.json(), read_back.json(), rebuilt.json()):
        assert {k: shown["outage"][k] for k in expected} == expected
        assert datetime.fromisoformat(shown["outage"]["sold_at"]) == moment(written)
    # An outage's mark, not the first days' paper (ADR-0013 §5.8).
    assert nobody.json()["outage"] == {
        "sold_by_user_id": None,
        "sold_by": None,
        "sold_at": None,
        "first_days": False,
    }
    assert live.json()["outage"] is None
    by_id = {sale["id"]: sale for sale in listed.json()["sales"]}
    assert by_id[marked.json()["id"]]["outage"]["sold_by"] == "seller"
    assert by_id[nobody.json()["id"]]["outage"] == {
        "sold_by_user_id": None,
        "sold_by": None,
        "sold_at": None,
        "first_days": False,
    }
    assert by_id[live.json()["id"]]["outage"] is None
    # The list still carries no way of paying (ADR-0012, G32).
    assert "payment_method" not in by_id[marked.json()["id"]]


async def test_the_mark_never_moves_the_day_or_the_drawer(maker):
    """Dated when typed, in the drawer's open period; typed after a close, in
    the next one — the pair the owner accepted (Q5b)."""
    net = await network(maker)
    coat = await coats(maker, net, qty=2)
    async with maker() as session:
        before = await session.scalar(select(text("now()")))
    first = await send(
        maker, net, net.seller, typed(net, coat, sold_at=paper(1, "19:40"), way="CASH")
    )
    async with maker() as session:
        after = await session.scalar(select(text("now()")))
    async with maker.begin() as session:
        await a_close(session, net.shops, net.shops.primary_store, 1)
    second = await send(
        maker, net, net.seller, typed(net, coat, sold_at=paper(1, "19:50"), way="CASH")
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    typed_first, typed_second = (
        await row(maker, first.json()["id"]),
        await row(maker, second.json()["id"]),
    )
    assert before <= typed_first.sold_at <= after
    assert typed_first.outage_sold_at == moment(paper(1, "19:40"))
    async with maker() as session:
        periods = (
            await session.execute(
                select(Sale.id, Sale.drawer_period).where(
                    Sale.id.in_([typed_first.id, typed_second.id])
                )
            )
        ).all()
    assert dict(periods) == {typed_first.id: 1, typed_second.id: 2}


# --- the print ---------------------------------------------------------------


async def test_the_mark_is_in_the_print_and_the_store_s_zone_is_not(maker):
    net = await network(maker)
    coat = await coats(maker, net, qty=3)
    written = paper(1, "19:40")
    body = typed(net, coat, sold_by=net.seller, sold_at=written)
    sold = await send(maker, net, net.seller, body)
    assert sold.status_code == 201, sold.text

    # The literal the body carried, never the moment it reads as.
    line = body["lines"][0]
    expected = idempotency.fingerprint(
        {
            "currency_code": "UAH",
            "lines": [
                {
                    "product_variant_id": line["product_variant_id"],
                    "size_id": line["size_id"],
                    "source_location_id": line["source_location_id"],
                    "quantity": line["quantity"],
                    "unit_price": line["unit_price"],
                    "discount_amount": "0.00",
                }
            ],
            "found_in_store": [],
            "missing_in_store": [],
            "size_clarified": [],
            "payment_method": "CARD",
            "outage": {"sold_by_user_id": str(net.seller), "sold_at": written},
        },
        actor_user_id=net.seller,
        store_id=net.shops.primary_store,
    )
    assert (await row(maker, sold.json()["id"])).command_fingerprint == expected

    # The store's zone changed since: the same sale resent is still the same.
    async with maker.begin() as session:
        await session.execute(
            update(Store)
            .where(Store.id == net.shops.primary_store)
            .values(timezone="America/New_York")
        )
    again = await send(maker, net, net.seller, body)
    assert again.status_code == 201, again.text
    assert again.json()["id"] == sold.json()["id"]

    # The same command with another mark, an empty one, or none, is another
    # sale; the conflict says nothing of what was recorded.
    others = [
        body | {"outage": {"sold_by_user_id": str(net.seller), "sold_at": paper(1, "19:41")}},
        body | {"outage": {"sold_by_user_id": None, "sold_at": written}},
        body | {"outage": {}},
        {name: value for name, value in body.items() if name != "outage"},
    ]
    for other in others:
        conflict = await send(maker, net, net.seller, other)
        assert (conflict.status_code, conflict.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
        assert "recorded" not in conflict.json()["details"]


async def test_the_paper_time_is_checked_only_for_its_shape_before_the_lookup(maker):
    """Seconds, an offset, another spelling or a date that never was: refused
    by the request's schema, which depends on nothing but the value."""
    net = await network(maker)
    coat = await coats(maker, net)
    day = kyiv_day(0).isoformat()
    for written in (
        f"{day}T09:05:00",
        f"{day}T09:05+02:00",
        f"{day} 09:05",
        f"{day}T9:05",
        "2026-02-30T09:05",
        f"{day}T24:00",
    ):
        response = await send(maker, net, net.seller, typed(net, coat, sold_at=written))
        assert response.status_code == 422, (written, response.text)
        assert "recorded" not in response.json().get("details", {})
    unknown_field = typed(net, coat) | {"outage": {"sold_by": "Марина"}}
    assert (await send(maker, net, net.seller, unknown_field)).status_code == 422


# --- who may be named --------------------------------------------------------


async def test_only_someone_who_may_sell_here_now_is_named(maker):
    net = await network(maker)
    other_network = await network(maker)
    left = await person(maker, net, "Звільнена", store=net.shops.primary_store, active=False)
    ended = await person(
        maker, net, "Колишня", store=net.shops.primary_store, membership_active=False
    )
    viewer = await a_viewer(maker, net)
    coat = await coats(maker, net, qty=3)

    for nobody_here in (
        net.child_seller,  # sells in another store of this network
        ended,  # their grant here ended
        left,  # turned off as a person
        viewer,  # their role sells nothing
        other_network.owner,  # another network's owner, a grant for all of it
        uuid.uuid4(),  # nobody at all
    ):
        refused(
            await send(maker, net, net.seller, typed(net, coat, sold_by=nobody_here)),
            "OUTAGE_SELLER_UNKNOWN",
        )
    # This store's seller, and this network's manager and owner, whose grants
    # are for all of it.
    for named in (net.seller, net.manager, net.owner):
        sold = await send(maker, net, net.seller, typed(net, coat, sold_by=named))
        assert sold.status_code == 201, sold.text


async def test_the_till_lists_exactly_whom_the_check_accepts(maker):
    net = await network(maker)
    other_network = await network(maker)
    await person(maker, net, "Звільнена", store=net.shops.primary_store, active=False)
    await person(maker, net, "Колишня", store=net.shops.primary_store, membership_active=False)
    viewer = await a_viewer(maker, net)

    async with as_(maker, net, net.seller) as client:
        primary = await client.get(f"/api/v1/stores/{net.shops.primary_store}/sellers")
    async with as_(maker, net, net.child_seller) as client:
        child = await client.get(f"/api/v1/stores/{net.shops.child_store}/sellers")
        not_theirs = await client.get(f"/api/v1/stores/{net.shops.primary_store}/sellers")
    async with as_(maker, net, viewer) as client:
        sells_nothing = await client.get(f"/api/v1/stores/{net.shops.primary_store}/sellers")
    async with as_(maker, other_network, other_network.owner) as client:
        elsewhere = await client.get(f"/api/v1/stores/{net.shops.primary_store}/sellers")

    assert primary.status_code == 200, primary.text
    assert primary.json() == {
        "sellers": [
            {"user_id": str(net.manager), "display_name": "manager"},
            {"user_id": str(net.owner), "display_name": "owner"},
            {"user_id": str(net.seller), "display_name": "seller"},
        ]
    }
    assert [seller["display_name"] for seller in child.json()["sellers"]] == [
        "child_owner",
        "child_seller",
        "manager",
        "owner",
    ]
    for response in (not_theirs, sells_nothing, elsewhere):
        assert response.status_code == 403, response.text

    # Exactly the check's: everyone listed is accepted.
    coat = await coats(maker, net, qty=3)
    for listed in primary.json()["sellers"]:
        sold = await send(
            maker, net, net.seller, typed(net, coat, sold_by=uuid.UUID(listed["user_id"]))
        )
        assert sold.status_code == 201, sold.text

    # A store that does not trade gives nobody anything.
    assert (await set_state(maker, net, "BLOCKED")).status_code == 200
    for asking in (net.child_seller, net.owner):
        async with as_(maker, net, asking) as client:
            blocked = await client.get(f"/api/v1/stores/{net.shops.child_store}/sellers")
        assert (blocked.status_code, blocked.json()["code"]) == (403, "STORE_NOT_TRADING")


# --- the paper's time ----------------------------------------------------------


async def test_the_paper_time_is_today_or_yesterday_and_never_ahead(maker):
    net = await network(maker)
    coat = await coats(maker, net, qty=2)
    now = datetime.now(KYIV)

    def at(when: datetime) -> str:
        return when.strftime(outage.PAPER_TIME)

    # Paper is written to the minute: at least six minutes ahead, whatever
    # second it is now.
    six_on = now.replace(second=0, microsecond=0) + timedelta(minutes=7)
    refused(
        await send(maker, net, net.seller, typed(net, coat, sold_at=at(six_on))),
        "OUTAGE_TIME_FUTURE",
    )
    refused(
        await send(maker, net, net.seller, typed(net, coat, sold_at=paper(2, "23:59"))),
        "OUTAGE_TIME_TOO_OLD",
    )
    # Clocks may differ by a few minutes; yesterday starts at midnight there.
    for written in (at(now + timedelta(minutes=4)), paper(1, "00:00")):
        sold = await send(maker, net, net.seller, typed(net, coat, sold_at=written))
        assert sold.status_code == 201, (written, sold.text)


async def test_the_paper_s_day_is_the_store_s_and_five_minutes_ahead_is_the_limit(
    maker, monkeypatch
):
    """The server's clock moved to 22:30 UTC on 8 October 2026: already
    01:30 on 9 October in Kyiv (summer time). Yesterday is the store's,
    8 October, never UTC's 7 October. A time from paper is written to the
    minute, and may run ahead of the server's clock by five minutes, never
    six (G1; ADR-0013 §5.3)."""
    net = await network(maker)
    coat = await coats(maker, net, qty=2)
    monkeypatch.setattr(outage, "_now", lambda: datetime(2026, 10, 8, 22, 30, tzinfo=UTC))

    for written in ("2026-10-08T00:00", "2026-10-09T01:35"):
        sold = await send(maker, net, net.seller, typed(net, coat, sold_at=written))
        assert sold.status_code == 201, (written, sold.text)
        assert datetime.fromisoformat(sold.json()["outage"]["sold_at"]) == moment(written)
    refused(
        await send(maker, net, net.seller, typed(net, coat, sold_at="2026-10-07T23:59")),
        "OUTAGE_TIME_TOO_OLD",
    )
    refused(
        await send(maker, net, net.seller, typed(net, coat, sold_at="2026-10-09T01:36")),
        "OUTAGE_TIME_FUTURE",
    )


# --- a recorded marked sale replays ------------------------------------------


async def test_a_marked_sale_replays_after_its_day_aged_out(maker, monkeypatch):
    """(a) Typed while the server's clock read two days ago, «вчора 19:40»
    then; resent now under a new key, its answer lost: the day has aged out
    since, and the same sale is answered all the same. A new sale with that
    time is refused now, so the clock did move."""
    net = await network(maker)
    coat = await coats(maker, net, qty=2)
    written = paper(3, "19:40")
    # Two days back on the store's wall clock, not 48 hours: across the
    # night the clocks change, those land on another day of Kyiv's.
    real = datetime.now(KYIV)
    monkeypatch.setattr(outage, "_now", lambda: (real - timedelta(days=2)).astimezone(UTC))
    body = typed(net, coat, sold_by=net.seller, sold_at=written)
    sold = await send(maker, net, net.seller, body)
    monkeypatch.undo()

    again = await send(maker, net, net.seller, body)
    new = await send(maker, net, net.seller, typed(net, coat, sold_at=written))

    assert sold.status_code == 201, sold.text
    assert again.status_code == 201, again.text
    assert again.json() == sold.json()
    refused(new, "OUTAGE_TIME_TOO_OLD")


async def test_a_marked_sale_replays_after_the_person_it_names_left(maker):
    """(b) The named seller's grant ended after the sale was recorded."""
    net = await network(maker)
    marina = await person(maker, net, "Марина", store=net.shops.primary_store)
    coat = await coats(maker, net, qty=2)
    body = typed(net, coat, sold_by=marina, sold_at=paper(1, "19:40"))
    sold = await send(maker, net, net.manager, body)
    async with maker.begin() as session:
        await session.execute(
            update(Membership).where(Membership.user_id == marina).values(is_active=False)
        )

    again = await send(maker, net, net.manager, body)
    new = await send(maker, net, net.manager, typed(net, coat, sold_by=marina))

    assert sold.status_code == 201, sold.text
    assert again.status_code == 201, again.text
    assert again.json() == sold.json()
    assert again.json()["outage"]["sold_by"] == "Марина"
    refused(new, "OUTAGE_SELLER_UNKNOWN")


async def test_a_marked_sale_replays_from_the_cache_under_its_own_key(maker):
    """(c) Within the 7 days, the cache answers before the command runs."""
    net = await network(maker)
    coat = await coats(maker, net)
    body = typed(net, coat, sold_by=net.seller, sold_at=paper(1, "19:40"))
    headers = key()
    sold = await send(maker, net, net.seller, body, headers)
    again = await send(maker, net, net.seller, body, headers)

    assert sold.status_code == 201, sold.text
    assert (again.status_code, again.json()) == (201, sold.json())


# --- the shelf and the stock -------------------------------------------------


async def test_a_marked_sale_says_nothing_about_the_shelf(maker):
    """Each report describes the shelf now, and at typing time nobody stands
    at it (ADR-0013 §6). The manager, who may report goods missing too."""
    net = await network(maker)
    coat = await coats(maker, net, qty=1)
    for report in (
        {"found_in_store": [{"line_index": 0, "quantity": 1}]},
        {"missing_in_store": [{"line_index": 0, "quantity": 1}]},
        {"size_clarified": [{"line_index": 0, "quantity": 1}]},
    ):
        body = typed(net, coat, qty=2, **report)
        headers = key()
        for _ in range(2):
            refused(await send(maker, net, net.manager, body, headers), "OUTAGE_SHELF_REPORT")
    # Nothing was sold or corrected: the one coat is still there.
    sold = await send(maker, net, net.seller, typed(net, coat))
    assert sold.status_code == 201, sold.text


async def test_a_paper_sale_whose_goods_are_gone_is_refused_and_never_corrected(maker):
    """Refused, and a manager fixes the balance first (owner decision,
    2026-10-04). `correctable` is false for a marked sale, reserved or not;
    `reserved` says whether an order holds the units, for every sale."""
    net = await network(maker)
    gone = await coats(maker, net, qty=0)
    held = await coats(maker, net, qty=1)
    async with maker.begin() as session:
        await reserve_stock(
            session,
            organization_id=net.shops.organization_id,
            store_id=net.shops.primary_store,
            reference_id=uuid.uuid4(),
            requests=[
                ReservationRequest(
                    net.shops.shared_warehouse, uuid.UUID(held[0]), uuid.UUID(held[1]), 1
                )
            ],
            actor_user_id=net.owner,
        )

    def live(coat: tuple[str, str]) -> dict[str, Any]:
        return sale_body(net.shops.primary_store, net.shops.shared_warehouse, *coat)

    answers = {
        "marked": await send(maker, net, net.seller, typed(net, gone)),
        "marked, reserved": await send(maker, net, net.seller, typed(net, held)),
        "live": await send(maker, net, net.seller, live(gone)),
        "live, reserved": await send(maker, net, net.seller, live(held)),
    }

    shortfalls = {}
    for name, response in answers.items():
        assert (response.status_code, response.json()["code"]) == (409, "INSUFFICIENT_STOCK"), name
        details = response.json()["details"]
        assert details["recorded"] is False, name
        shortfalls[name] = (details["correctable"], details["reserved"])
    assert shortfalls == {
        "marked": (False, False),
        "marked, reserved": (False, True),
        "live": (True, False),
        "live, reserved": (False, True),
    }


# --- the database ------------------------------------------------------------


async def test_the_mark_is_never_changed(maker):
    net = await network(maker)
    coat = await coats(maker, net, qty=2)
    marked = await send(
        maker, net, net.seller, typed(net, coat, sold_by=net.seller, sold_at=paper(1, "19:40"))
    )
    live = await send(
        maker,
        net,
        net.seller,
        sale_body(net.shops.primary_store, net.shops.shared_warehouse, *coat),
    )
    assert marked.status_code == 201, marked.text
    assert live.status_code == 201, live.text
    marked_id, live_id = uuid.UUID(marked.json()["id"]), uuid.UUID(live.json()["id"])

    for sale_id, change in (
        (marked_id, "during_outage = false, outage_sold_by = NULL, outage_sold_at = NULL"),
        (marked_id, "outage_sold_by = NULL"),
        (marked_id, "outage_sold_at = outage_sold_at - interval '1 hour'"),
        (live_id, "during_outage = true"),
    ):
        async with maker() as session:
            with pytest.raises(DBAPIError, match="never changed"):
                await session.execute(
                    text(f"UPDATE sale SET {change} WHERE id = :id"),  # noqa: S608
                    {"id": sale_id},
                )
    # Its answer and its date still can be written, as the API and tests do.
    async with maker.begin() as session:
        for sale_id in (marked_id, live_id):
            await session.execute(
                update(Sale)
                .where(Sale.id == sale_id)
                .values(response_snapshot=None, sold_at=datetime.now(UTC))
            )
    # Naming the mark unchanged changes nothing: the rest of the update is
    # written, never silently dropped.
    async with maker.begin() as session:
        for sale_id in (marked_id, live_id):
            await session.execute(
                text(
                    "UPDATE sale SET during_outage = during_outage, "
                    "outage_sold_by = outage_sold_by, outage_sold_at = outage_sold_at, "
                    "response_snapshot = '{}'::jsonb WHERE id = :id"
                ),
                {"id": sale_id},
            )
    for sale_id in (marked_id, live_id):
        assert (await row(maker, str(sale_id))).response_snapshot == {}
    # The details never stand without the mark.
    for detail in ({"outage_sold_by": net.seller}, {"outage_sold_at": datetime.now(UTC)}):
        async with maker() as session:
            with pytest.raises(DBAPIError, match="outage_details_need_the_mark"):
                await a_sale(session, net.shops, net.shops.primary_store, **detail)


async def test_an_ordinary_sale_asks_nothing_more_of_the_database(maker, engine):
    """No person, membership or zone is read for a sale without the mark,
    and the answer written after the insert names none of the mark's
    columns (ADR-0013 §11)."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        coat = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=1
        )
    statements: list[str] = []

    def seen(conn: Any, cursor: Any, statement: str, *args: Any) -> None:
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", seen)
    try:
        async with api(maker, shops.scope(shops.primary_store)) as client:
            sold = await client.post(
                SALES,
                json=sale_body(shops.primary_store, shops.shared_warehouse, *coat),
                headers=key(),
            )
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", seen)

    assert sold.status_code == 201, sold.text
    assert statements
    for statement in statements:
        assert "app_user" not in statement, statement
        assert "membership" not in statement, statement
        assert "store.timezone" not in statement, statement
    updates = [s for s in statements if s.startswith("UPDATE sale SET")]
    assert len(updates) == 1
    assert "response_snapshot" in updates[0]
    assert "outage" not in updates[0] and "during_outage" not in updates[0]


GUARD_DEFINITION = "BEFORE UPDATE OF during_outage, outage_sold_by, outage_sold_at ON public.sale"


async def guard_of(engine: AsyncEngine) -> str | None:
    async with engine.connect() as connection:
        definition: str | None = await connection.scalar(
            text(
                "SELECT pg_get_triggerdef(oid) FROM pg_trigger "
                "WHERE tgname = 'sale_outage_guard' AND tgrelid = 'sale'::regclass"
            )
        )
        return definition


async def test_the_guard_runs_only_when_the_mark_is_named(engine):
    """No behaviour tells `BEFORE UPDATE OF` from `BEFORE UPDATE`: the
    definition is read. The answer written to every new sale after its
    insert names none of the three, so the hot path runs no second trigger
    (ADR-0013 §5.5, §11)."""
    assert GUARD_DEFINITION in (await guard_of(engine) or "")


async def test_revision_0036_guards_the_mark_and_goes_back_only_without_one():
    """On a database of its own, from the revision itself: the guard it
    creates, the clean way back while no sale carries the mark, and the
    refusal once one does."""
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_outage_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        assert GUARD_DEFINITION in (await guard_of(engine) or "")
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        shops = await make_two_shops(fresh)
        async with fresh() as session:
            live = await a_sale(session, shops, shops.primary_store)
            await session.commit()
        async with fresh() as session:
            with pytest.raises(DBAPIError, match="never changed"):
                await session.execute(
                    update(Sale).where(Sale.id == live).values(during_outage=True)
                )

        # Without a marked sale it goes back cleanly, and forward again.
        await _run(config, "downgrade", "0035_cash_and_card", database=name)
        async with engine.connect() as connection:
            columns = set(
                (
                    await connection.scalars(
                        text(
                            "SELECT column_name FROM information_schema.columns "
                            "WHERE table_name = 'sale'"
                        )
                    )
                ).all()
            )
            guard = await connection.scalar(
                text("SELECT count(*) FROM pg_proc WHERE proname = 'birka_guard_outage_mark'")
            )
        assert not columns & {"during_outage", "outage_sold_by", "outage_sold_at"}
        assert guard == 0
        await _run(config, "upgrade", "head", database=name)

        async with fresh() as session:
            await a_sale(
                session,
                shops,
                shops.primary_store,
                during_outage=True,
                outage_sold_at=datetime.combine(kyiv_day(1), time(19, 40), KYIV),
            )
            await session.commit()
        with pytest.raises(
            Exception, match="0035 cannot hold the mark «продано під час збою»: 1 sales carry it"
        ):
            await _run(config, "downgrade", "0035_cash_and_card", database=name)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
