"""Cash taken out of the drawer and put in (owner decisions, 2026-10-04;
ADR-0012, B5, B7 J), over HTTP against real PostgreSQL, with real people
signed in by a session token.

- Taken out with who and why: for the owner, for expenses, for a supplier's
  courier. A seller records expenses and a supplier's courier; the owner and
  managers any kind, and cash put in for change. The note is optional.
- A movement belongs to the period in which the phone recorded it: one whose
  screen saw the close before one that reached the server first, at most ten
  minutes ago, is put on that close, and explains its difference — no
  `cash:correct` needed, since the phone recorded it on time. Two closes
  back, or later than that, it is refused and records nothing
  (`CLOSE_IN_BETWEEN`): the server cannot tell a late resend from a closed
  day reached on purpose, and a closed day is the owner's or a manager's to
  correct.
- Cash taken out and forgotten is recorded against its close by the owner or
  a manager, and explains that close; it changes no period's expected cash.
- Nothing is recorded in a store that does not trade; one recorded before
  the block is still answered with itself.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.cash.models import CashClose, CashMovement
from tests.conftest import requires_database
from tests.integration.test_cash_close import (
    Net,
    as_,
    at,
    close,
    d,
    figures,
    network,
    seen,
    set_state,
    sold,
)

pytestmark = [pytest.mark.integration, requires_database()]

MOVEMENT_KEYS = {
    "id",
    "store_id",
    "kind",
    "direction",
    "amount",
    "note",
    "at",
    "by",
    "for_close_id",
    "for_day",
    "moved_to_close",
}


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def body(
    net: Net,
    kind: str,
    amount: str = "150.00",
    *,
    after: Any = None,
    for_close: Any = None,
    note: str | None = None,
    store: uuid.UUID | None = None,
    command_id: str | None = None,
) -> dict[str, Any]:
    sent: dict[str, Any] = {
        "store_id": str(store or net.store),
        "command_id": command_id or str(uuid.uuid4()),
        "kind": kind,
        "amount": amount,
        "after_close_id": str(after) if after else None,
    }
    if note is not None:
        sent["note"] = note
    if for_close is not None:
        sent["for_close_id"] = str(for_close)
    return sent


async def record(maker, net: Net, by: uuid.UUID, sent: dict[str, Any]) -> httpx.Response:
    async with as_(maker, net, by) as client:
        return await client.post("/api/v1/cash/movements", json=sent)


async def test_a_seller_records_expenses_and_a_couriers_pay_and_nothing_else(maker):
    """Owner decisions, 2026-10-04, and G34: «пакети, кур’єр»."""
    net = await network(maker)
    for kind in ("EXPENSES", "SUPPLIER_COURIER"):
        answer = await record(maker, net, net.seller, body(net, kind, note="пакети"))
        assert answer.status_code == 201, answer.text
        made = answer.json()
        assert set(made) == MOVEMENT_KEYS
        assert figures(made, "kind", "direction", "amount", "note", "by", "moved_to_close") == (
            kind,
            "OUT",
            "150.00",
            "пакети",
            "Марина",
            False,
        )
        assert (made["for_close_id"], made["for_day"]) == (None, None)
    for kind in ("OWNER", "CHANGE"):
        answer = await record(maker, net, net.seller, body(net, kind))
        assert answer.status_code == 403, answer.text
        assert answer.json()["code"] == "PERMISSION_DENIED"


async def test_the_owner_and_a_manager_record_any_kind_and_cash_put_in(maker):
    net = await network(maker)
    for someone in (net.owner, net.manager):
        for kind in ("OWNER", "EXPENSES", "SUPPLIER_COURIER", "CHANGE"):
            answer = await record(maker, net, someone, body(net, kind, "500.00"))
            assert answer.status_code == 201, answer.text
            assert answer.json()["direction"] == ("IN" if kind == "CHANGE" else "OUT")
            assert answer.json()["note"] is None


async def test_a_note_is_optional_and_short(maker):
    net = await network(maker)
    long = await record(maker, net, net.seller, body(net, "EXPENSES", note="я" * 201))
    assert long.status_code == 422, long.text
    blank = await record(maker, net, net.seller, body(net, "EXPENSES", note="   "))
    assert blank.status_code == 201 and blank.json()["note"] is None
    nothing = await record(maker, net, net.seller, body(net, "EXPENSES", "0.00"))
    assert nothing.status_code == 422


async def test_one_command_is_one_movement_however_often_it_is_sent(maker):
    net = await network(maker)
    sent = body(net, "EXPENSES", note="кава")
    first = await record(maker, net, net.seller, sent)
    again = await record(maker, net, net.seller, sent)
    other = await record(maker, net, net.seller, sent | {"amount": "151.00"})
    assert first.status_code == again.status_code == 201, again.text
    assert first.json() == again.json()
    assert other.status_code == 409 and other.json()["code"] == "IDEMPOTENCY_CONFLICT"


async def test_j_a_take_out_resent_after_another_phones_close_explains_that_close(maker):
    """Example J: Olena records «Витрати 150» at 19:40 with close #1 on the
    screen, and nothing arrives; Marina closes at 20:00, 150 short; at 20:05
    Olena presses «Повторити». It lands on Marina's close — not in the next
    period, where it would show as 150 over and a second message."""
    net = await network(maker)
    first = await close(maker, net, "2000.00", now=datetime.now(UTC) - timedelta(days=2))
    await sold(maker, net, "3000.00", "CASH")
    tuesday = await close(maker, net, "4850.00", now=datetime.now(UTC) - timedelta(minutes=5))
    assert (tuesday.expected, tuesday.difference) == (d("5000.00"), d("-150.00"))

    resent = await record(
        maker, net, net.colleague, body(net, "EXPENSES", after=first.id, note="пакети")
    )
    assert resent.status_code == 201, resent.text
    assert figures(resent.json(), "for_close_id", "for_day", "moved_to_close") == (
        str(tuesday.id),
        tuesday.business_day.isoformat(),
        True,
    )
    view = await seen(maker, net, tuesday.id, net.owner)
    assert figures(view, "difference", "explained", "unexplained") == ("-150.00", "-150.00", "0.00")
    assert figures(view["explanations"][0], "kind", "by", "cash", "text") == (
        "TAKE_OUT",
        "Олена",
        "-150.00",
        "Витрати: пакети",
    )

    await sold(maker, net, "1000.00", "CASH")
    # Wednesday evening, a business day later by the server's clock.
    wednesday = await close(maker, net, "5850.00", now=datetime.now(UTC) + timedelta(days=1))
    assert figures(wednesday, "taken_out", "expected", "difference") == (
        d("0.00"),
        d("5850.00"),
        d("0.00"),
    )


async def test_a_take_out_from_a_screen_that_saw_no_close_lands_on_the_first(maker):
    net = await network(maker)
    first = await close(maker, net, "0.00", now=None)
    late = await record(maker, net, net.seller, body(net, "EXPENSES", after=None))
    assert late.status_code == 201, late.text
    assert figures(late.json(), "for_close_id", "moved_to_close") == (str(first.id), True)


def in_between(answer: httpx.Response, newest: CashClose) -> None:
    """Refused after the lookup, naming the close that stands: nothing was
    written, and the phone settles."""
    assert answer.status_code == 422, answer.text
    details = answer.json()["details"]
    assert details == {
        "reason": "CLOSE_IN_BETWEEN",
        "recorded": False,
        "closed_at": details["closed_at"],
        "closed_by": "Марина",
    }
    assert datetime.fromisoformat(details["closed_at"]) == newest.closed_at


async def movements_of(maker, net: Net) -> int:
    async with maker() as session:
        return int(
            await session.scalar(
                select(func.count())
                .select_from(CashMovement)
                .where(CashMovement.store_id == net.store)
            )
            or 0
        )


async def test_a_take_out_naming_a_close_two_back_reaches_no_closed_day(maker):
    """A seller cannot clear an old shortage by naming the close before it as
    the one their screen showed: the close that followed is not the newest, so
    nothing is written, and the old close stays unexplained. The owner or a
    manager names that close (`cash:correct`), and it explains it."""
    net = await network(maker)
    first = await close(maker, net, "1000.00", now=datetime.now(UTC) - timedelta(days=5))
    await sold(maker, net, "500.00", "CASH")
    short = await close(maker, net, "1200.00", now=datetime.now(UTC) - timedelta(days=4))
    assert short.difference == d("-300.00")
    newest = await close(maker, net, "1200.00", now=None)

    for sent in (body(net, "EXPENSES", "300.00", after=first.id), body(net, "EXPENSES", "300.00")):
        refused = await record(maker, net, net.seller, sent)
        in_between(refused, newest)
        # Recorded nothing: the same command, resent, is refused again.
        in_between(await record(maker, net, net.seller, sent), newest)
    view = await seen(maker, net, short.id, net.owner)
    assert figures(view, "difference", "explained", "unexplained") == ("-300.00", "0.00", "-300.00")
    assert await movements_of(maker, net) == 0

    named = await record(
        maker,
        net,
        net.manager,
        body(net, "EXPENSES", "300.00", after=newest.id, for_close=short.id),
    )
    assert named.status_code == 201, named.text
    assert figures(named.json(), "for_close_id", "moved_to_close") == (str(short.id), False)
    view = await seen(maker, net, short.id, net.owner)
    assert figures(view, "difference", "explained", "unexplained") == ("-300.00", "-300.00", "0.00")


async def test_a_take_out_resent_more_than_ten_minutes_after_the_close_is_refused(maker):
    """The close that followed the screen's is the newest, but it was made
    more than ten minutes ago: the server cannot tell this from a closed day
    reached on purpose. Within ten minutes it is example J."""
    net = await network(maker)
    first = await close(maker, net, "2000.00", now=datetime.now(UTC) - timedelta(days=2))
    await sold(maker, net, "3000.00", "CASH")
    tuesday = await close(maker, net, "4850.00", now=datetime.now(UTC) - timedelta(minutes=11))

    late = await record(maker, net, net.colleague, body(net, "EXPENSES", after=first.id))
    in_between(late, tuesday)
    view = await seen(maker, net, tuesday.id, net.owner)
    assert figures(view, "difference", "explained", "unexplained") == (
        "-150.00",
        "0.00",
        "-150.00",
    )
    # Recorded again from a fresh screen, it is the open period's.
    again = await record(maker, net, net.colleague, body(net, "EXPENSES", after=tuesday.id))
    assert again.status_code == 201, again.text
    assert figures(again.json(), "for_close_id", "moved_to_close") == (None, False)


async def test_a_take_out_resent_nine_minutes_after_the_close_is_moved_onto_it(maker):
    net = await network(maker)
    first = await close(maker, net, "2000.00", now=datetime.now(UTC) - timedelta(days=2))
    tuesday = await close(maker, net, "1850.00", now=datetime.now(UTC) - timedelta(minutes=9))
    resent = await record(maker, net, net.colleague, body(net, "EXPENSES", after=first.id))
    assert resent.status_code == 201, resent.text
    assert figures(resent.json(), "for_close_id", "moved_to_close") == (str(tuesday.id), True)


async def test_a_take_out_on_time_stays_in_the_open_period(maker):
    net = await network(maker)
    first = await close(maker, net, "1000.00", now=datetime.now(UTC) - timedelta(days=1))
    on_time = await record(maker, net, net.seller, body(net, "EXPENSES", "100.00", after=first.id))
    assert figures(on_time.json(), "for_close_id", "moved_to_close") == (None, False)
    second = await close(maker, net, "900.00", now=None)
    assert figures(second, "taken_out", "expected", "difference") == (
        d("100.00"),
        d("900.00"),
        d("0.00"),
    )


async def test_cash_forgotten_is_named_against_its_close_by_the_owner_or_a_manager(maker):
    """Example B's record, over HTTP: `for_close_id` needs `cash:correct`, and
    a close of the same store."""
    net = await network(maker)
    first = await close(maker, net, "1000.00", now=at(6, 20))
    theirs = await close(maker, net, "0.00", now=at(6, 20), by=net.child_seller, store=net.other)
    by_seller = await record(
        maker, net, net.seller, body(net, "EXPENSES", after=first.id, for_close=first.id)
    )
    assert by_seller.status_code == 403, by_seller.text
    elsewhere = await record(
        maker, net, net.manager, body(net, "OWNER", after=first.id, for_close=theirs.id)
    )
    assert elsewhere.status_code == 404, elsewhere.text
    named = await record(
        maker, net, net.manager, body(net, "OWNER", "300.00", after=first.id, for_close=first.id)
    )
    assert named.status_code == 201, named.text
    assert figures(named.json(), "for_close_id", "for_day", "moved_to_close") == (
        str(first.id),
        "2026-10-06",
        False,
    )
    second = await close(maker, net, "1000.00", now=at(7, 20))
    assert (second.taken_out, second.expected) == (d("0.00"), d("1000.00"))


async def test_an_unknown_close_named_by_the_screen_is_not_found(maker):
    net = await network(maker)
    answer = await record(maker, net, net.seller, body(net, "EXPENSES", after=uuid.uuid4()))
    assert answer.status_code == 404, answer.text


async def test_nothing_is_taken_out_of_a_store_that_does_not_trade(maker):
    """G15: the owner records their take-out after the store is unblocked."""
    net = await network(maker)
    await set_state(maker, net, net.store, "BLOCKED")
    for someone, kind in ((net.owner, "OWNER"), (net.seller, "EXPENSES")):
        answer = await record(maker, net, someone, body(net, kind))
        assert answer.status_code == 403, answer.text
        assert answer.json()["code"] == "STORE_NOT_TRADING"


async def test_a_take_out_recorded_before_a_block_is_still_answered_and_the_owner_closes(maker):
    """The owner records «Власнику 100,00» and never hears the answer; the
    store is blocked from another device. Their resend is answered with what it
    did, and settles; a new one is refused, saying nothing was recorded, so
    it settles too — and their phone can close the blocked store (B9)."""
    net = await network(maker)
    sent = body(net, "OWNER", "100.00")
    first = await record(maker, net, net.owner, sent)
    assert first.status_code == 201, first.text
    await set_state(maker, net, net.store, "BLOCKED")

    again = await record(maker, net, net.owner, sent)
    assert again.status_code == 201, again.text
    assert again.json() == first.json()
    other = await record(maker, net, net.owner, sent | {"amount": "101.00"})
    assert other.status_code == 409 and other.json()["code"] == "IDEMPOTENCY_CONFLICT"
    for someone, kind in ((net.owner, "OWNER"), (net.manager, "EXPENSES")):
        new = await record(maker, net, someone, body(net, kind))
        assert new.status_code == 403, new.text
        assert new.json()["code"] == "STORE_NOT_TRADING"
        assert new.json()["details"] == {
            "store_id": str(net.store),
            "state": "BLOCKED",
            "recorded": False,
        }

    async with as_(maker, net, net.owner) as client:
        closed = await client.post(
            "/api/v1/cash/closes",
            json={
                "store_id": str(net.store),
                "command_id": str(uuid.uuid4()),
                "counted": "0.00",
                "counted_at": datetime.now(UTC).isoformat(),
                "after_close_id": None,
            },
        )
    assert closed.status_code == 201, closed.text


async def test_the_drawer_shows_a_seller_her_own_movements_and_a_manager_all(maker):
    net = await network(maker)
    first = await close(maker, net, "1000.00", now=datetime.now(UTC) - timedelta(days=1))
    await record(maker, net, net.seller, body(net, "EXPENSES", "10.00", after=first.id))
    await record(maker, net, net.colleague, body(net, "EXPENSES", "20.00", after=first.id))
    await record(maker, net, net.manager, body(net, "CHANGE", "500.00", after=first.id))

    async def drawer(by: uuid.UUID) -> dict[str, Any]:
        async with as_(maker, net, by) as client:
            answer = await client.get(f"/api/v1/cash/drawer?store_id={net.store}")
        assert answer.status_code == 200, answer.text
        return answer.json()

    hers = await drawer(net.seller)
    assert [movement["amount"] for movement in hers["movements"]] == ["10.00"]
    everyone = await drawer(net.manager)
    assert sorted(movement["amount"] for movement in everyone["movements"]) == [
        "10.00",
        "20.00",
        "500.00",
    ]
    assert everyone["movement_kinds"] == ["OWNER", "EXPENSES", "SUPPLIER_COURIER", "CHANGE"]
    assert everyone["may_correct"] is True


async def test_the_movements_of_some_days_are_for_whoever_reads_the_money(maker):
    net = await network(maker)
    await record(maker, net, net.seller, body(net, "EXPENSES", "10.00"))
    await record(maker, net, net.owner, body(net, "OWNER", "700.00"))
    async with as_(maker, net, net.manager) as client:
        listed = await client.get(f"/api/v1/cash/movements?store_id={net.store}")
    assert listed.status_code == 200, listed.text
    assert [movement["amount"] for movement in listed.json()["items"]] == ["700.00", "10.00"]
    async with as_(maker, net, net.seller) as client:
        refused = await client.get(f"/api/v1/cash/movements?store_id={net.store}")
    assert refused.status_code == 403, refused.text
