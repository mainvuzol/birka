"""The mark «під час збою» on returns and debt payments typed from paper
(owner decision, 2026-10-10; ADR-0021), over HTTP against real PostgreSQL,
signed in as the network's people.

- A return or a payment typed from paper is an ordinary one, dated and in
  the drawer of the moment it is typed, typed by whoever sent it, with a
  mark that may name who took it and the paper's time.
- The mark is part of the command: in its prints, as the literal the body
  carried. The same command resent with another mark is refused.
- Who may be named: someone who may take a return (`sale:refund`), or a
  payment (`sale:credit`), in the store taking it now; the screens' list of
  names is exactly whom the check accepts.
- The paper's time: today or yesterday in that store's zone, never ahead.
- The checks sit after the replay lookup: one recorded and resent after its
  day aged out, or after its person left, still replays.
- «Звіт» shows a marked return; the debt's history a marked payment.
- The mark is permanent, and 0039 goes back only while nothing carries it.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, time, timedelta
from typing import Any

import httpx
import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.authz.permissions import Permission
from app.modules.credit.models import CreditEntry
from app.modules.identity.models import AppUser
from app.modules.refunds.models import Refund
from app.modules.sales import outage as outage_module
from tests.conftest import requires_database
from tests.integration.test_outage_mark import KYIV, kyiv_day, paper, person
from tests.integration.test_shared_warehouse import (
    api,
    key,
    make_two_shops,
    sale_body,
    stock_a_coat,
)
from tests.integration.test_stock_rekey_migration import _admin, _alembic, _engine, _run
from tests.integration.test_store_states import Network, as_, network, set_state, stocked

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


# --- a sale to return, a debt to pay --------------------------------------------


async def sold(
    maker, net: Network, *, store: uuid.UUID | None = None, **extra: Any
) -> dict[str, Any]:
    """A coat at 1500 from the shared warehouse, sold by the store's seller."""
    store = store or net.shops.primary_store
    variant, size = await stocked(maker, net, net.shops.shared_warehouse, qty=1)
    by = net.seller if store == net.shops.primary_store else net.child_seller
    async with as_(maker, net, by) as client:
        response = await client.post(
            "/api/v1/sales",
            json=sale_body(store, net.shops.shared_warehouse, variant, size)
            | {"payment_method": "CASH"}
            | extra,
            headers=key(),
        )
    assert response.status_code == 201, response.text
    return response.json()


def outage(by: uuid.UUID | None = None, at: str | None = None) -> dict[str, Any]:
    return {"by_user_id": str(by) if by is not None else None, "at": at}


def a_return(
    sale: dict[str, Any],
    *,
    mark: dict[str, Any] | None,
    command: str | None = None,
    at: uuid.UUID | None = None,
) -> dict[str, Any]:
    """The coat back intact, the money in cash, as «Повернення» sends it."""
    return (
        {
            "command_id": command or str(uuid.uuid4()),
            "payment_method": "CASH",
            "lines": [
                {
                    "sale_item_id": sale["items"][0]["id"],
                    "quantity": 1,
                    "restock": True,
                    "condition": "INTACT",
                }
            ],
        }
        | ({"outage": mark} if mark is not None else {})
        | ({"store_id": str(at)} if at is not None else {})
    )


async def take_back(
    maker, net: Network, by: uuid.UUID, sale: dict[str, Any], body: dict[str, Any]
) -> httpx.Response:
    async with as_(maker, net, by) as client:
        return await client.post(f"/api/v1/sales/{sale['id']}/refunds", json=body, headers=key())


async def on_credit(maker, net: Network, *, store: uuid.UUID | None = None) -> str:
    """1500 of which 500 paid now: 1000 owed. The debt's id."""
    sale = await sold(
        maker,
        net,
        store=store,
        credit={"customer_name": "Ірина", "customer_phone": "0671234567", "paid_now": "500.00"},
    )
    return sale["credit"]["credit_id"]


def a_payment(
    amount: str = "300.00",
    *,
    mark: dict[str, Any] | None,
    command: str | None = None,
    at: uuid.UUID | None = None,
    way: str = "CARD",
) -> dict[str, Any]:
    return (
        {"command_id": command or str(uuid.uuid4()), "amount": amount, "payment_method": way}
        | ({"outage": mark} if mark is not None else {})
        | ({"store_id": str(at)} if at is not None else {})
    )


async def pay(
    maker, net: Network, by: uuid.UUID, credit_id: str, body: dict[str, Any]
) -> httpx.Response:
    async with as_(maker, net, by) as client:
        return await client.post(f"/api/v1/credits/{credit_id}/payments", json=body)


def refused(response: httpx.Response, reason: str) -> None:
    assert response.status_code == 422, response.text
    body = response.json()
    assert (body["code"], body["details"]["reason"]) == ("VALIDATION_ERROR", reason)
    assert body["details"]["recorded"] is False


async def refund_row(maker, refund_id: str) -> Refund:
    async with maker() as session:
        found = await session.get(Refund, uuid.UUID(refund_id))
    assert found is not None
    return found


async def payments_of(maker, credit_id: str) -> list[CreditEntry]:
    async with maker() as session:
        return list(
            (
                await session.scalars(
                    select(CreditEntry)
                    .where(
                        CreditEntry.credit_id == uuid.UUID(credit_id),
                        CreditEntry.kind == "PAYMENT",
                    )
                    .order_by(CreditEntry.created_at, CreditEntry.id)
                )
            ).all()
        )


async def a_cashier(
    maker, net: Network, may: Permission = Permission.SALE_CREATE, name: str = "Каса"
) -> uuid.UUID:
    """Someone of the primary store whose role does one thing only: by
    default sells, and takes nothing back, nor any debt payment. A role an
    owner composed."""
    async with maker() as session:
        role = Role(
            organization_id=net.shops.organization_id,
            code=f"CASHIER-{uuid.uuid4().hex[:6]}",
            name="Лише одне",
            is_system=False,
        )
        session.add(role)
        await session.flush()
        session.add(RolePermission(role_id=role.id, permission_code=may.value))
        user = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name=name)
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


# --- stored, shown -------------------------------------------------------------------


async def test_a_return_typed_from_paper_is_stored_with_its_mark_and_shown_in_the_report(maker):
    """Typed by the manager from yesterday evening's paper, taken by the
    seller: today's return, in today's drawer, typed by the manager."""
    net = await network(maker)
    sale = await sold(maker, net)
    written = paper(1, "19:40")
    typed = await take_back(
        maker, net, net.manager, sale, a_return(sale, mark=outage(net.seller, written))
    )
    assert typed.status_code == 201, typed.text
    assert typed.json()["outage"] == {
        "by_user_id": str(net.seller),
        "by": "seller",
        "at": typed.json()["outage"]["at"],
        "first_days": False,
    }
    assert datetime.fromisoformat(typed.json()["outage"]["at"]) == datetime.combine(
        kyiv_day(1), time(19, 40), KYIV
    )

    stored = await refund_row(maker, typed.json()["id"])
    assert (stored.during_outage, stored.outage_taken_by, stored.actor_user_id) == (
        True,
        net.seller,
        net.manager,
    )
    assert stored.outage_taken_at == datetime.combine(kyiv_day(1), time(19, 40), KYIV)
    assert stored.created_at.astimezone(KYIV).date() == kyiv_day(0)

    # An ordinary return beside it carries none.
    other = await sold(maker, net)
    ordinary = await take_back(maker, net, net.seller, other, a_return(other, mark=None))
    assert ordinary.status_code == 201, ordinary.text
    assert ordinary.json()["outage"] is None
    plain = await refund_row(maker, ordinary.json()["id"])
    assert (plain.during_outage, plain.outage_taken_by, plain.outage_taken_at) == (
        False,
        None,
        None,
    )
    # Both in the same drawer: the mark never moves it.
    assert stored.drawer_period == plain.drawer_period

    async with as_(maker, net, net.owner) as client:
        listed = await client.get(
            "/api/v1/reports/sales/entries", params={"store_id": str(net.shops.primary_store)}
        )
    assert listed.status_code == 200, listed.text
    entries = {entry["id"]: entry for entry in listed.json()["entries"]}
    marked = entries[typed.json()["id"]]
    assert (marked["kind"], marked["by"], marked["outage"]["sold_by"]) == (
        "RETURN",
        "manager",
        "seller",
    )
    assert datetime.fromisoformat(marked["outage"]["sold_at"]) == datetime.combine(
        kyiv_day(1), time(19, 40), KYIV
    )
    assert entries[ordinary.json()["id"]]["outage"] is None


async def test_a_payment_typed_from_paper_is_stored_and_shown_in_the_debt_s_history(maker):
    net = await network(maker)
    credit_id = await on_credit(maker, net)
    # Yesterday's: a morning hour of today has not come yet when the suite
    # runs after midnight (local CI, 2026-10-11).
    written = paper(1, "10:05")
    typed = await pay(
        maker, net, net.manager, credit_id, a_payment(mark=outage(net.seller, written))
    )
    assert typed.status_code == 201, typed.text
    live = await pay(maker, net, net.seller, credit_id, a_payment("200.00", mark=None))
    assert live.status_code == 201, live.text

    async with as_(maker, net, net.seller) as client:
        read = (await client.get(f"/api/v1/credits/{credit_id}")).json()
    first, marked, ordinary = read["entries"]
    assert first["outage"] is None  # the sale's own first payment
    assert (marked["by"], marked["outage"]["by_user_id"], marked["outage"]["by"]) == (
        "manager",
        str(net.seller),
        "seller",
    )
    assert datetime.fromisoformat(marked["outage"]["at"]) == datetime.combine(
        kyiv_day(1), time(10, 5), KYIV
    )
    assert ordinary["outage"] is None
    assert read["owed"] == "500.00"

    _, stored, plain = await payments_of(maker, credit_id)
    assert (stored.during_outage, stored.outage_taken_by, stored.actor_user_id) == (
        True,
        net.seller,
        net.manager,
    )
    assert (plain.during_outage, plain.outage_taken_by, plain.outage_taken_at) == (
        False,
        None,
        None,
    )
    assert stored.drawer_period == plain.drawer_period


async def test_naming_nobody_and_no_time_is_still_the_mark(maker):
    net = await network(maker)
    sale = await sold(maker, net)
    taken = await take_back(maker, net, net.seller, sale, a_return(sale, mark={}))
    assert taken.status_code == 201, taken.text
    # An outage's mark, not the first days' paper (ADR-0013 §5.8).
    nobody = {"by_user_id": None, "by": None, "at": None, "first_days": False}
    assert taken.json()["outage"] == nobody
    assert (await refund_row(maker, taken.json()["id"])).during_outage is True

    credit_id = await on_credit(maker, net)
    paid = await pay(maker, net, net.seller, credit_id, a_payment(mark={}))
    assert paid.status_code == 201, paid.text
    assert paid.json()["entries"][-1]["outage"] == nobody


# --- the prints ---------------------------------------------------------------------


async def test_the_mark_is_part_of_the_command(maker):
    """The same command resent with the same mark is the same; with another
    mark, or none, it is refused, as a sale's is."""
    net = await network(maker)
    # Yesterday's, so the hour has always come (local CI, 2026-10-11).
    written = paper(1, "09:00")
    sale = await sold(maker, net)
    command = str(uuid.uuid4())
    body = a_return(sale, mark=outage(net.seller, written), command=command)
    first = await take_back(maker, net, net.seller, sale, body)
    again = await take_back(maker, net, net.seller, sale, body)
    assert first.status_code == 201, first.text
    assert again.json() == first.json()
    for other in (outage(net.manager, written), outage(net.seller, paper(1, "09:01")), None):
        conflict = await take_back(
            maker, net, net.seller, sale, a_return(sale, mark=other, command=command)
        )
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"

    credit_id = await on_credit(maker, net)
    command = str(uuid.uuid4())
    body = a_payment(mark=outage(net.seller, written), command=command)
    first = await pay(maker, net, net.seller, credit_id, body)
    again = await pay(maker, net, net.seller, credit_id, body)
    assert first.status_code == 201, first.text
    assert again.json() == first.json()
    for other in (outage(net.manager, written), outage(net.seller, None), None):
        conflict = await pay(
            maker, net, net.seller, credit_id, a_payment(mark=other, command=command)
        )
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert len(await payments_of(maker, credit_id)) == 2


# --- who may be named ---------------------------------------------------------------


async def test_only_someone_who_may_take_it_there_now_is_named(maker):
    net = await network(maker)
    cashier = await a_cashier(maker, net)
    left = await person(maker, net, "Звільнена", store=net.shops.primary_store, active=False)
    for nobody in (cashier, left, net.child_seller, uuid.uuid4()):
        sale = await sold(maker, net)
        refused(
            await take_back(maker, net, net.seller, sale, a_return(sale, mark=outage(nobody))),
            "OUTAGE_SELLER_UNKNOWN",
        )
        credit_id = await on_credit(maker, net)
        refused(
            await pay(maker, net, net.seller, credit_id, a_payment(mark=outage(nobody))),
            "OUTAGE_SELLER_UNKNOWN",
        )
    # This store's seller, and the network's manager and owner.
    for named in (net.seller, net.manager, net.owner):
        sale = await sold(maker, net)
        taken = await take_back(maker, net, net.seller, sale, a_return(sale, mark=outage(named)))
        assert taken.status_code == 201, taken.text
        credit_id = await on_credit(maker, net)
        paid = await pay(maker, net, net.seller, credit_id, a_payment(mark=outage(named)))
        assert paid.status_code == 201, paid.text


async def test_returns_and_payments_each_name_their_own_people(maker):
    """Someone who may take returns and no payments is named on a return,
    never on a payment, and listed so."""
    net = await network(maker)
    returns_only = await a_cashier(maker, net, Permission.SALE_REFUND, "Повернення")
    sale = await sold(maker, net)
    taken = await take_back(maker, net, net.seller, sale, a_return(sale, mark=outage(returns_only)))
    assert taken.status_code == 201, taken.text
    credit_id = await on_credit(maker, net)
    refused(
        await pay(maker, net, net.seller, credit_id, a_payment(mark=outage(returns_only))),
        "OUTAGE_SELLER_UNKNOWN",
    )
    primary = net.shops.primary_store
    async with as_(maker, net, net.seller) as client:
        lists = {
            named_for: [
                seller["display_name"]
                for seller in (
                    await client.get(f"/api/v1/stores/{primary}/sellers", params={"for": named_for})
                ).json()["sellers"]
            ]
            for named_for in ("sale", "refund", "credit")
        }
    assert "Повернення" in lists["refund"]
    assert "Повернення" not in lists["credit"] and "Повернення" not in lists["sale"]


async def test_the_screens_list_exactly_whom_the_check_accepts(maker):
    net = await network(maker)
    await a_cashier(maker, net)
    primary = net.shops.primary_store
    async with as_(maker, net, net.seller) as client:
        lists = {
            named_for: await client.get(
                f"/api/v1/stores/{primary}/sellers",
                params={"for": named_for} if named_for else {},
            )
            for named_for in (None, "sale", "refund", "credit")
        }
        unknown = await client.get(f"/api/v1/stores/{primary}/sellers", params={"for": "x"})
    assert unknown.status_code == 422
    names = {
        named_for: [seller["display_name"] for seller in response.json()["sellers"]]
        for named_for, response in lists.items()
    }
    # Whoever sells; the cashier among them, who takes nothing back. In the
    # order of their names, which is the database's collation's: compared
    # as sets here.
    assert names[None] == names["sale"]
    assert set(names["sale"]) == {"manager", "owner", "seller", "Каса"}
    assert set(names["refund"]) == set(names["credit"]) == {"manager", "owner", "seller"}
    # And whoever is listed is accepted.
    for listed in lists["refund"].json()["sellers"]:
        sale = await sold(maker, net)
        taken = await take_back(
            maker,
            net,
            net.seller,
            sale,
            a_return(sale, mark=outage(uuid.UUID(listed["user_id"]))),
        )
        assert taken.status_code == 201, taken.text

    # Only whoever may take one there reads the list for it.
    cashier = await a_cashier(maker, net)
    async with as_(maker, net, cashier) as client:
        assert (
            await client.get(f"/api/v1/stores/{primary}/sellers", params={"for": "sale"})
        ).status_code == 200
        for named_for in ("refund", "credit"):
            response = await client.get(
                f"/api/v1/stores/{primary}/sellers", params={"for": named_for}
            )
            assert response.status_code == 403, response.text


# --- the paper's time ---------------------------------------------------------------


async def test_the_paper_time_is_today_or_yesterday_and_never_ahead(maker):
    net = await network(maker)
    for written, reason in (
        (paper(2, "12:00"), "OUTAGE_TIME_TOO_OLD"),
        (paper(-1, "12:00"), "OUTAGE_TIME_FUTURE"),
    ):
        sale = await sold(maker, net)
        response = await take_back(
            maker, net, net.seller, sale, a_return(sale, mark=outage(None, written))
        )
        refused(response, reason)
        assert response.json()["details"]["at"] == written
        credit_id = await on_credit(maker, net)
        response = await pay(
            maker, net, net.seller, credit_id, a_payment(mark=outage(None, written))
        )
        refused(response, reason)
        assert response.json()["details"]["at"] == written
    # Only its shape before the lookup.
    sale = await sold(maker, net)
    for written in (f"{kyiv_day(0).isoformat()}T09:05:00", f"{kyiv_day(0).isoformat()} 09:05"):
        response = await take_back(
            maker, net, net.seller, sale, a_return(sale, mark=outage(None, written))
        )
        assert response.status_code == 422, response.text
        assert "recorded" not in response.json().get("details", {})
    unknown = await take_back(
        maker, net, net.seller, sale, a_return(sale, mark={"sold_by_user_id": None})
    )
    assert unknown.status_code == 422


# --- after the lookup ---------------------------------------------------------------


async def test_a_marked_return_and_payment_replay_after_their_day_aged_out(maker, monkeypatch):
    """Typed while the server's clock read two days ago, «вчора 18:00» then;
    resent now, their answers lost: the day has aged out since, and the same
    return and payment are answered all the same. A new one with that time
    is refused now, so the clock did move."""
    net = await network(maker)
    written = paper(3, "18:00")
    sale = await sold(maker, net)
    credit_id = await on_credit(maker, net)
    return_body = a_return(sale, mark=outage(net.seller, written))
    payment_body = a_payment(mark=outage(net.seller, written))
    real = datetime.now(UTC)
    monkeypatch.setattr(outage_module, "_now", lambda: real - timedelta(days=2))
    taken = await take_back(maker, net, net.seller, sale, return_body)
    paid = await pay(maker, net, net.seller, credit_id, payment_body)
    monkeypatch.undo()
    assert taken.status_code == 201, taken.text
    assert paid.status_code == 201, paid.text

    again = await take_back(maker, net, net.seller, sale, return_body)
    assert again.status_code == 201, again.text
    assert again.json()["id"] == taken.json()["id"]
    assert (await pay(maker, net, net.seller, credit_id, payment_body)).json() == paid.json()
    other = await sold(maker, net)
    refused(
        await take_back(maker, net, net.seller, other, a_return(other, mark=outage(None, written))),
        "OUTAGE_TIME_TOO_OLD",
    )
    refused(
        await pay(maker, net, net.seller, credit_id, a_payment(mark=outage(None, written))),
        "OUTAGE_TIME_TOO_OLD",
    )


async def test_a_marked_return_and_payment_replay_after_their_person_left(maker):
    net = await network(maker)
    taker = await person(maker, net, "Оксана", store=net.shops.primary_store)
    sale = await sold(maker, net)
    return_body = a_return(sale, mark=outage(taker))
    taken = await take_back(maker, net, net.seller, sale, return_body)
    credit_id = await on_credit(maker, net)
    payment_body = a_payment(mark=outage(taker))
    paid = await pay(maker, net, net.seller, credit_id, payment_body)
    assert taken.status_code == 201 and paid.status_code == 201

    async with maker() as session:
        await session.execute(update(AppUser).where(AppUser.id == taker).values(is_active=False))
        await session.commit()
    again = await take_back(maker, net, net.seller, sale, return_body)
    assert again.status_code == 201, again.text
    assert again.json()["id"] == taken.json()["id"]
    assert (await pay(maker, net, net.seller, credit_id, payment_body)).json() == paid.json()
    # A new one naming them is refused now, so they did leave.
    other = await sold(maker, net)
    refused(
        await take_back(maker, net, net.seller, other, a_return(other, mark=outage(taker))),
        "OUTAGE_SELLER_UNKNOWN",
    )


async def test_a_marked_return_replays_to_whoever_took_it_once_they_may_not(maker):
    """A return typed from paper, its answer lost, and its person's right to
    take returns taken away meanwhile: answered as recorded, its mark and
    all, and nothing new taken (owner decision, 2026-10-18)."""
    net = await network(maker)
    # Sells, and takes returns until that is taken away.
    taker = await a_cashier(maker, net, name="Оксана")
    async with maker() as session:
        role = await session.scalar(select(Membership.role_id).where(Membership.user_id == taker))
        session.add(RolePermission(role_id=role, permission_code=Permission.SALE_REFUND.value))
        await session.commit()
    sale = await sold(maker, net)
    body = a_return(sale, mark=outage(taker))
    taken = await take_back(maker, net, taker, sale, body)
    assert taken.status_code == 201, taken.text

    async with maker() as session:
        await session.execute(
            delete(RolePermission).where(
                RolePermission.role_id == role,
                RolePermission.permission_code == Permission.SALE_REFUND.value,
            )
        )
        await session.commit()
    again = await take_back(maker, net, taker, sale, body)
    assert again.status_code == 201, again.text
    assert again.json() == taken.json()
    other = await sold(maker, net)
    fresh = await take_back(maker, net, taker, other, a_return(other, mark=outage(taker)))
    assert fresh.status_code == 403, fresh.text
    assert fresh.json()["details"]["recorded"] is False


# --- the store taking it ------------------------------------------------------------


async def test_another_store_names_its_own_people_and_its_own_day(maker):
    """A closed store's debt paid at the primary store, and the child
    store's sale taken back there: whoever is named is the primary store's."""
    net = await network(maker)
    sale = await sold(maker, net, store=net.shops.child_store)
    elsewhere = net.shops.primary_store
    refused(
        await take_back(
            maker,
            net,
            net.seller,
            sale,
            a_return(sale, mark=outage(net.child_seller), at=elsewhere),
        ),
        "OUTAGE_SELLER_UNKNOWN",
    )
    taken = await take_back(
        maker, net, net.seller, sale, a_return(sale, mark=outage(net.seller), at=elsewhere)
    )
    assert taken.status_code == 201, taken.text
    assert (await refund_row(maker, taken.json()["id"])).outage_taken_by == net.seller

    credit_id = await on_credit(maker, net, store=net.shops.child_store)
    assert (await set_state(maker, net, "BLOCKED")).status_code == 200
    refused(
        await pay(
            maker,
            net,
            net.seller,
            credit_id,
            a_payment(mark=outage(net.child_seller), at=elsewhere),
        ),
        "OUTAGE_SELLER_UNKNOWN",
    )
    paid = await pay(
        maker, net, net.seller, credit_id, a_payment(mark=outage(net.seller), at=elsewhere)
    )
    assert paid.status_code == 201, paid.text
    assert paid.json()["entries"][-1]["outage"]["by"] == "seller"


# --- never changed ------------------------------------------------------------------


async def test_the_mark_is_never_changed(maker, engine):
    net = await network(maker)
    sale = await sold(maker, net)
    taken = await take_back(maker, net, net.seller, sale, a_return(sale, mark=outage(net.seller)))
    credit_id = await on_credit(maker, net)
    paid = await pay(maker, net, net.seller, credit_id, a_payment(mark=outage(net.seller)))
    assert taken.status_code == 201 and paid.status_code == 201
    entry = (await payments_of(maker, credit_id))[-1]
    for statement, ids in (
        ("UPDATE refund SET during_outage = false WHERE id = :id", taken.json()["id"]),
        ("UPDATE refund SET outage_taken_by = NULL WHERE id = :id", taken.json()["id"]),
        ("UPDATE refund SET outage_taken_at = now() WHERE id = :id", taken.json()["id"]),
        ("UPDATE credit_entry SET outage_taken_by = NULL WHERE id = :id", str(entry.id)),
        ("UPDATE credit_entry SET during_outage = false WHERE id = :id", str(entry.id)),
    ):
        with pytest.raises(DBAPIError, match=r"never changed|append-only"):
            async with engine.begin() as connection:
                await connection.execute(text(statement), {"id": ids})
    # Nor is a return typed live marked afterwards.
    plain = await sold(maker, net)
    ordinary = await take_back(maker, net, net.seller, plain, a_return(plain, mark=None))
    with pytest.raises(DBAPIError, match="never changed"):
        async with engine.begin() as connection:
            await connection.execute(
                text("UPDATE refund SET during_outage = true WHERE id = :id"),
                {"id": ordinary.json()["id"]},
            )


async def test_revision_0039_goes_back_only_without_a_mark():
    name = f"birka_paper_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        await _run(config, "downgrade", "0038_customer_erasure", database=name)
        await _run(config, "upgrade", "head", database=name)
        scratch = await _engine(name)
        try:
            maker = async_sessionmaker(scratch, expire_on_commit=False)
            shops = await make_two_shops(maker)
            async with api(maker, shops.scope(shops.primary_store)) as client:
                variant, size = await stock_a_coat(
                    client,
                    shops,
                    store=shops.primary_store,
                    warehouse=shops.shared_warehouse,
                    qty=1,
                )
                sale = await client.post(
                    "/api/v1/sales",
                    json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size)
                    | {
                        "credit": {
                            "customer_name": "Ірина",
                            "customer_phone": "0671234567",
                            "paid_now": "500.00",
                        }
                    },
                    headers=key(),
                )
                assert sale.status_code == 201, sale.text
                paid = await client.post(
                    f"/api/v1/credits/{sale.json()['credit']['credit_id']}/payments",
                    json=a_payment(mark={}),
                )
                assert paid.status_code == 201, paid.text

            with pytest.raises(Exception, match="0038 cannot hold the mark"):
                await _run(config, "downgrade", "0038_customer_erasure", database=name)
            async with scratch.connect() as connection:
                version = await connection.scalar(text("SELECT version_num FROM alembic_version"))
            assert version == ScriptDirectory.from_config(config).get_current_head()
        finally:
            await scratch.dispose()
    finally:
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
