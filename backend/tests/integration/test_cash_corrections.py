"""Corrections of a way of paying (owner decisions, 2026-10-04; ADR-0012,
B6, section 0's G16), over HTTP against real PostgreSQL, with real people
signed in by a session token, and real sales, payments and returns made by
the money commands.

- Nothing is rewritten: a wrong way is fixed by a new row, chained to the
  ones before it; the current way is the newest in that chain.
- Before the close a seller fixes the way of their own operations — their sales,
  the debt payments they took and the returns they handed back — and nobody
  else's; after the close only the owner or a manager, whose correction then
  explains the closed day's difference.
- A screen that saw an older way is refused; so is the way it already has,
  a way the operation could not have had, and a row recorded before the
  drawer was counted. Every such refusal says `recorded: false`.
- The owner's day view lists the drawer's money with sums and ways; the
  money of one operation is given only to the screen that returns or fixes
  it (G32).

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
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.cash.models import PaymentCorrection
from app.modules.credit.models import CreditEntry
from app.modules.sales.models import Sale
from tests.conftest import requires_database
from tests.integration.test_cash_close import (
    Net,
    as_,
    close,
    collected,
    d,
    figures,
    handed_back,
    network,
    seen,
    set_state,
    sold,
    sold_in_parts,
)
from tests.integration.test_shared_warehouse import api, key, sale_body, stock_a_coat

pytestmark = [pytest.mark.integration, requires_database()]

CORRECTION_KEYS = {
    "id",
    "seq",
    "store_id",
    "target",
    "target_id",
    "amount",
    "direction",
    "from_method",
    "to_method",
    "explains_close_id",
    "explains_day",
    "at",
    "by",
    "note",
}


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def fix(
    maker,
    net: Net,
    by: uuid.UUID,
    target: str,
    target_id: Any,
    from_method: str | None,
    to_method: str,
    *,
    note: str | None = None,
    command_id: str | None = None,
) -> httpx.Response:
    async with as_(maker, net, by) as client:
        return await client.post(
            "/api/v1/cash/corrections",
            json={
                "command_id": command_id or str(uuid.uuid4()),
                "target": target,
                "target_id": str(target_id),
                "from_method": from_method,
                "to_method": to_method,
                **({"note": note} if note is not None else {}),
            },
        )


def refusal(answer: httpx.Response, reason: str) -> None:
    assert answer.status_code == 422, answer.text
    assert answer.json()["details"] == {"reason": reason, "recorded": False}


# --- real money, made by the money commands ----------------------------------------------------


@pytest.fixture
async def till(maker) -> tuple[Net, str, str]:
    """A network, and coats on the store's shelf."""
    net = await network(maker)
    async with api(maker, net.shops.scope(net.store)) as client:
        variant, size = await stock_a_coat(
            client, net.shops, store=net.store, warehouse=net.shops.shared_warehouse, qty=10
        )
    return net, variant, size


async def sell(
    maker,
    net: Net,
    variant: str,
    size: str,
    method: str,
    *,
    by: uuid.UUID | None = None,
    paid_now: str | None = None,
) -> dict[str, Any]:
    sent = sale_body(net.store, net.shops.shared_warehouse, variant, size) | {
        "payment_method": method
    }
    if paid_now is not None:
        sent["credit"] = {
            "customer_name": "Оксана",
            "customer_phone": "0671234567",
            "paid_now": paid_now,
        }
    async with as_(maker, net, by or net.seller) as client:
        answer = await client.post("/api/v1/sales", json=sent, headers=key())
    assert answer.status_code == 201, answer.text
    return answer.json()


async def pay(
    maker, net: Net, credit_id: str, amount: str, method: str, *, by: uuid.UUID
) -> dict[str, Any]:
    async with as_(maker, net, by) as client:
        answer = await client.post(
            f"/api/v1/credits/{credit_id}/payments",
            json={"command_id": str(uuid.uuid4()), "amount": amount, "payment_method": method},
        )
    assert answer.status_code == 201, answer.text
    return answer.json()


async def give_back(
    maker, net: Net, sale: dict[str, Any], method: str, *, by: uuid.UUID
) -> dict[str, Any]:
    async with as_(maker, net, by) as client:
        answer = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": sale["items"][0]["id"],
                        "quantity": 1,
                        "restock": True,
                        "condition": "INTACT",
                    }
                ],
                "payment_method": method,
            },
            headers=key(),
        )
    assert answer.status_code == 201, answer.text
    return answer.json()


async def last_payment(maker, net: Net, credit_id: str, by: uuid.UUID) -> str:
    """The newest payment of a debt that this person took."""
    async with maker() as session:
        found = await session.scalar(
            select(CreditEntry.id)
            .where(
                CreditEntry.credit_id == uuid.UUID(credit_id),
                CreditEntry.kind == "PAYMENT",
                CreditEntry.actor_user_id == by,
            )
            .order_by(CreditEntry.created_at.desc())
            .limit(1)
        )
    assert found is not None
    return str(found)


# --- a seller's own, before the close (B6.2, G16) -------------------------------------------------


async def test_a_seller_fixes_her_own_sale_before_the_close_and_not_after(maker, till):
    """B6.4: the seller pressed «Картка», the terminal refused, the customer paid
    cash. After the close it is the owner's or a manager's to correct."""
    net, variant, size = till
    await close(maker, net, "0.00", now=datetime.now(UTC) - timedelta(days=1))
    sale = await sell(maker, net, variant, size, "CARD")

    theirs = await fix(maker, net, net.colleague, "SALE", sale["id"], "CARD", "CASH")
    assert theirs.status_code == 403, theirs.text
    mine = await fix(maker, net, net.seller, "SALE", sale["id"], "CARD", "CASH", note="термінал")
    assert mine.status_code == 201, mine.text
    made = mine.json()
    assert set(made) == CORRECTION_KEYS
    assert figures(
        made, "seq", "target", "target_id", "amount", "direction", "from_method", "to_method"
    ) == (1, "SALE", sale["id"], "1500.00", "IN", "CARD", "CASH")
    assert figures(made, "explains_close_id", "explains_day", "by", "note") == (
        None,
        None,
        "Марина",
        "термінал",
    )

    closed = await close(maker, net, "1500.00", now=None)
    assert (closed.cash_corrected, closed.difference) == (d("1500.00"), d("0.00"))
    too_late = await fix(maker, net, net.seller, "SALE", sale["id"], "CASH", "CARD")
    refusal(too_late, "DAY_CLOSED")
    manager = await fix(maker, net, net.manager, "SALE", sale["id"], "CASH", "CARD")
    assert manager.status_code == 201, manager.text
    assert figures(manager.json(), "seq", "explains_close_id", "explains_day") == (
        2,
        str(closed.id),
        closed.business_day.isoformat(),
    )


async def test_a_seller_fixes_her_own_debt_payment_and_return_and_no_one_elses(maker, till):
    """Section 0, G16: their own debt payments and returns too, while open."""
    net, variant, size = till
    await close(maker, net, "0.00", now=datetime.now(UTC) - timedelta(days=1))
    in_parts = await sell(maker, net, variant, size, "CASH", paid_now="500.00")
    credit_id = in_parts["credit"]["credit_id"]
    await pay(maker, net, credit_id, "300.00", "CARD", by=net.seller)
    her_payment = await last_payment(maker, net, credit_id, net.seller)
    await pay(maker, net, credit_id, "100.00", "CARD", by=net.colleague)
    their_payment = await last_payment(maker, net, credit_id, net.colleague)
    in_full = await sell(maker, net, variant, size, "CASH")
    her_return = await give_back(maker, net, in_full, "CASH", by=net.seller)
    other = await sell(maker, net, variant, size, "CARD", by=net.colleague)
    their_return = await give_back(maker, net, other, "CARD", by=net.colleague)

    assert (
        await fix(maker, net, net.seller, "PAYMENT", their_payment, "CARD", "CASH")
    ).status_code == 403
    assert (
        await fix(maker, net, net.seller, "REFUND", their_return["id"], "CARD", "CASH")
    ).status_code == 403

    payment = await fix(maker, net, net.seller, "PAYMENT", her_payment, "CARD", "TRANSFER")
    assert payment.status_code == 201, payment.text
    assert figures(payment.json(), "target", "amount", "direction") == ("PAYMENT", "300.00", "IN")
    returned = await fix(maker, net, net.seller, "REFUND", her_return["id"], "CASH", "CARD")
    assert returned.status_code == 201, returned.text
    assert figures(returned.json(), "target", "amount", "direction") == ("REFUND", "1500.00", "OUT")

    async with as_(maker, net, net.seller) as client:
        mine = (await client.get(f"/api/v1/cash/events?store_id={net.store}&mine=true")).json()
    kinds = sorted((item["target"], item["target_id"]) for item in mine["items"])
    assert kinds == sorted(
        [
            ("SALE", in_parts["id"]),
            ("PAYMENT", her_payment),
            ("SALE", in_full["id"]),
            ("REFUND", her_return["id"]),
        ]
    )
    assert all("Лоран" in item["label"] for item in mine["items"])

    await close(maker, net, "0.00", now=None)
    refusal(
        await fix(maker, net, net.seller, "PAYMENT", her_payment, "TRANSFER", "CASH"), "DAY_CLOSED"
    )
    refusal(
        await fix(maker, net, net.seller, "REFUND", her_return["id"], "CARD", "CASH"), "DAY_CLOSED"
    )
    async with as_(maker, net, net.seller) as client:
        after = (await client.get(f"/api/v1/cash/events?store_id={net.store}&mine=true")).json()
    assert after == {"items": []}


async def test_after_the_close_her_own_operations_no_longer_offer_a_change(maker, till):
    """B6.2, G16: «Змінити спосіб оплати» follows the rule the command keeps
    (`may_change`): offered to the seller for their own sale, debt payment and
    return while their period is open, not after the close; still offered to
    a manager, who corrects a closed day."""
    net, variant, size = till
    await close(maker, net, "0.00", now=datetime.now(UTC) - timedelta(days=1))
    sale = await sell(maker, net, variant, size, "CARD")
    in_parts = await sell(maker, net, variant, size, "CASH", paid_now="500.00")
    credit_id = in_parts["credit"]["credit_id"]
    await pay(maker, net, credit_id, "300.00", "CARD", by=net.seller)
    payment = await last_payment(maker, net, credit_id, net.seller)
    in_full = await sell(maker, net, variant, size, "CASH")
    returned = await give_back(maker, net, in_full, "CASH", by=net.seller)
    paths = (
        f"/api/v1/cash/sales/{sale['id']}/method?store_id={net.store}",
        f"/api/v1/cash/payments/{payment}/method",
        f"/api/v1/cash/refunds/{returned['id']}/method",
    )

    async def offered(by: uuid.UUID) -> list[bool]:
        async with as_(maker, net, by) as client:
            answers = [await client.get(path) for path in paths]
        assert all(answer.status_code == 200 for answer in answers), [a.text for a in answers]
        return [answer.json()["may_change"] for answer in answers]

    assert await offered(net.seller) == [True, True, True]
    await close(maker, net, "0.00", now=None)
    assert await offered(net.seller) == [False, False, False]
    assert await offered(net.manager) == [True, True, True]


# --- what the screen saw, and what the operation could have been ----------------------------------


async def test_a_screen_that_saw_an_older_way_is_refused_with_the_way_that_stands(maker):
    net = await network(maker)
    card = await sold(maker, net, "700.00", "CARD")
    assert (await fix(maker, net, net.manager, "SALE", card, "CARD", "CASH")).status_code == 201
    stale = await fix(maker, net, net.seller, "SALE", card, "CARD", "TRANSFER")
    assert stale.status_code == 409, stale.text
    assert stale.json()["code"] == "PAYMENT_METHOD_CHANGED"
    assert stale.json()["details"] == {"current": "CASH", "recorded": False}
    refusal(await fix(maker, net, net.seller, "SALE", card, "CASH", "CASH"), "SAME_METHOD")


async def test_a_row_recorded_before_the_drawer_is_not_corrected(maker):
    net = await network(maker)
    async with maker() as session:
        await session.execute(text("ALTER TABLE sale DISABLE TRIGGER sale_drawer_period"))
        old = await session.scalar(
            insert(Sale)
            .values(
                organization_id=net.org,
                store_id=net.store,
                seller_user_id=net.seller,
                command_id=uuid.uuid4(),
                currency_code="UAH",
                subtotal=d("100.00"),
                total=d("100.00"),
            )
            .returning(Sale.id)
        )
        await session.execute(text("ALTER TABLE sale ENABLE TRIGGER sale_drawer_period"))
        await session.commit()
    refusal(await fix(maker, net, net.manager, "SALE", old, None, "CASH"), "BEFORE_DRAWER")


async def test_a_way_never_stated_is_corrected_from_not_stated(maker):
    """B6.1: a row with a period and no way — the code of #67 during a
    rollback — is corrected from «не вказано»; its cash then counts."""
    net = await network(maker)
    await close(maker, net, "0.00", now=datetime.now(UTC) - timedelta(days=1))
    unknown = await sold(maker, net, "400.00", None)
    made = await fix(maker, net, net.manager, "SALE", unknown, None, "CASH")
    assert made.status_code == 201, made.text
    assert made.json()["from_method"] is None
    closed = await close(maker, net, "400.00", now=None)
    assert (closed.cash_corrected, closed.difference) == (d("400.00"), d("0.00"))
    view = await seen(maker, net, closed.id, net.owner)
    assert view["not_stated"] == {
        "came_in": "400.00",
        "went_out": "0.00",
        "corrected": "-400.00",
        "net": "0.00",
    }


async def test_order_ways_only_for_the_money_of_a_collected_order(maker):
    net = await network(maker)
    till_sale = await sold(maker, net, "500.00", "CARD")
    refusal(
        await fix(maker, net, net.manager, "SALE", till_sale, "CARD", "CARRIER_COD"),
        "METHOD_NOT_FOR_THIS",
    )
    order = await collected(maker, net, "1800.00", "CARRIER_COD")
    # The screen that fixes one operation offers the order ways for it alone.
    async with as_(maker, net, net.seller) as client:
        for sale_id, is_order in ((till_sale, False), (order, True)):
            method = await client.get(f"/api/v1/cash/sales/{sale_id}/method?store_id={net.store}")
            assert method.status_code == 200, method.text
            assert method.json()["is_order"] is is_order
    to_cash = await fix(maker, net, net.manager, "SALE", order, "CARRIER_COD", "CASH")
    assert to_cash.status_code == 201, to_cash.text
    back = await fix(maker, net, net.manager, "SALE", order, "CASH", "PREPAID_TRANSFER")
    assert back.status_code == 201, back.text
    refund = await handed_back(maker, net, till_sale, "500.00", "CASH")
    refusal(
        await fix(maker, net, net.manager, "REFUND", refund, "CASH", "PREPAID_TRANSFER"),
        "METHOD_NOT_FOR_THIS",
    )


async def test_a_sale_paid_in_parts_is_corrected_through_its_first_payment(maker):
    net = await network(maker)
    debt = await sold_in_parts(maker, net, "4000.00", "1000.00", "CARD")
    made = await fix(maker, net, net.seller, "SALE", debt.sale_id, "CARD", "CASH")
    assert made.status_code == 201, made.text
    assert figures(made.json(), "target", "target_id", "amount") == (
        "SALE",
        str(debt.sale_id),
        "1000.00",
    )
    async with maker() as session:
        row = await session.scalar(
            select(PaymentCorrection).where(PaymentCorrection.id == uuid.UUID(made.json()["id"]))
        )
    assert row is not None
    assert (row.sale_id, row.credit_entry_id) == (None, debt.first_payment)
    async with as_(maker, net, net.seller) as client:
        method = await client.get(f"/api/v1/cash/sales/{debt.sale_id}/method?store_id={net.store}")
    assert method.status_code == 200, method.text
    assert figures(
        method.json(), "target", "target_id", "amount_taken", "method", "corrected", "may_change"
    ) == ("PAYMENT", str(debt.first_payment), "1000.00", "CASH", True, True)


async def test_corrections_of_one_row_chain_one_after_another(maker):
    net = await network(maker)
    card = await sold(maker, net, "700.00", "CARD")
    seen_ways = []
    for before, after in (("CARD", "CASH"), ("CASH", "TRANSFER"), ("TRANSFER", "CASH")):
        made = await fix(maker, net, net.manager, "SALE", card, before, after)
        assert made.status_code == 201, made.text
        seen_ways.append(figures(made.json(), "seq", "from_method", "to_method"))
    assert seen_ways == [(1, "CARD", "CASH"), (2, "CASH", "TRANSFER"), (3, "TRANSFER", "CASH")]
    async with as_(maker, net, net.manager) as client:
        method = await client.get(f"/api/v1/cash/sales/{card}/method?store_id={net.store}")
    assert figures(method.json(), "method", "corrected") == ("CASH", True)


async def test_one_correction_command_is_one_correction(maker):
    net = await network(maker)
    card = await sold(maker, net, "700.00", "CARD")
    command = str(uuid.uuid4())
    first = await fix(maker, net, net.seller, "SALE", card, "CARD", "CASH", command_id=command)
    again = await fix(maker, net, net.seller, "SALE", card, "CARD", "CASH", command_id=command)
    other = await fix(maker, net, net.seller, "SALE", card, "CARD", "TRANSFER", command_id=command)
    assert first.status_code == again.status_code == 201, again.text
    assert first.json() == again.json()
    assert other.status_code == 409 and other.json()["code"] == "IDEMPOTENCY_CONFLICT"


async def test_nothing_is_corrected_in_a_store_that_does_not_trade(maker):
    """G15."""
    net = await network(maker)
    card = await sold(maker, net, "700.00", "CARD")
    await set_state(maker, net, net.store, "BLOCKED")
    for someone in (net.owner, net.seller):
        answer = await fix(maker, net, someone, "SALE", card, "CARD", "CASH")
        assert answer.status_code == 403, answer.text
        assert answer.json()["code"] == "STORE_NOT_TRADING"


async def test_a_correction_recorded_before_a_block_is_still_answered_with_itself(maker):
    """Its answer was lost, and the store was blocked meanwhile: the resend
    is answered with what it did, and settles; a new one is refused, saying
    nothing was recorded, so it settles too."""
    net = await network(maker)
    card = await sold(maker, net, "700.00", "CARD")
    command = str(uuid.uuid4())
    first = await fix(maker, net, net.manager, "SALE", card, "CARD", "CASH", command_id=command)
    assert first.status_code == 201, first.text
    await set_state(maker, net, net.store, "BLOCKED")

    again = await fix(maker, net, net.manager, "SALE", card, "CARD", "CASH", command_id=command)
    assert again.status_code == 201, again.text
    assert again.json() == first.json()
    new = await fix(maker, net, net.manager, "SALE", card, "CASH", "TRANSFER")
    assert new.status_code == 403, new.text
    assert new.json()["code"] == "STORE_NOT_TRADING"
    assert new.json()["details"] == {
        "store_id": str(net.store),
        "state": "BLOCKED",
        "recorded": False,
    }


async def test_an_unknown_operation_is_not_found(maker):
    net = await network(maker)
    for target in ("SALE", "PAYMENT", "REFUND"):
        answer = await fix(maker, net, net.manager, target, uuid.uuid4(), "CARD", "CASH")
        assert answer.status_code == 404, answer.text


# --- the day's money, and one operation's ---------------------------------------------------------


async def test_the_days_money_is_listed_with_sums_and_ways_for_whoever_reads_it(maker, till):
    net, variant, size = till
    first = await close(maker, net, "0.00", now=datetime.now(UTC) - timedelta(days=1))
    assert first.number == 1
    card = await sell(maker, net, variant, size, "CARD")
    in_parts = await sell(maker, net, variant, size, "CASH", paid_now="500.00", by=net.colleague)
    await pay(maker, net, in_parts["credit"]["credit_id"], "200.00", "TRANSFER", by=net.seller)
    cash = await sell(maker, net, variant, size, "CASH")
    returned = await give_back(maker, net, cash, "CASH", by=net.seller)
    assert (
        await fix(maker, net, net.seller, "SALE", card["id"], "CARD", "CASH")
    ).status_code == 201

    async with as_(maker, net, net.manager) as client:
        day = await client.get(f"/api/v1/cash/events?store_id={net.store}")
    assert day.status_code == 200, day.text
    items = {(item["target"], item["target_id"]): item for item in day.json()["items"]}
    fixed = items[("SALE", card["id"])]
    assert figures(
        fixed, "amount", "direction", "stated_method", "method", "corrected", "closed", "by"
    ) == ("1500.00", "IN", "CARD", "CASH", True, False, "Марина")
    assert "Лоран" in fixed["label"] and "Оксана" not in fixed["label"]
    assert (fixed["is_order"], fixed["may_change"]) == (False, True)
    parts = items[("SALE", in_parts["id"])]
    assert figures(parts, "amount", "method", "by") == ("500.00", "CASH", "Олена")
    [payment] = [item for (target, _), item in items.items() if target == "PAYMENT"]
    assert figures(payment, "amount", "method", "by") == ("200.00", "TRANSFER", "Марина")
    back = items[("REFUND", returned["id"])]
    assert figures(back, "amount", "direction", "method") == ("1500.00", "OUT", "CASH")
    assert len(items) == 5

    async with as_(maker, net, net.seller) as client:
        refused = await client.get(f"/api/v1/cash/events?store_id={net.store}")
    assert refused.status_code == 403


async def test_the_money_of_one_operation_is_for_its_own_screen(maker, till):
    """G32: the seller who made it, to fix it; whoever may take its return;
    whoever reads the money. A debt payment's and a return's: their own
    seller and whoever reads the money (G16)."""
    net, variant, size = till
    sale = await sell(maker, net, variant, size, "CARD")
    in_parts = await sell(maker, net, variant, size, "CASH", paid_now="500.00")
    credit_id = in_parts["credit"]["credit_id"]
    await pay(maker, net, credit_id, "300.00", "CARD", by=net.seller)
    payment = await last_payment(maker, net, credit_id, net.seller)
    returned = await give_back(maker, net, sale, "CARD", by=net.seller)

    async def method(by: uuid.UUID, path: str) -> httpx.Response:
        async with as_(maker, net, by) as client:
            return await client.get(path)

    sale_path = f"/api/v1/cash/sales/{sale['id']}/method?store_id={net.store}"
    own = await method(net.seller, sale_path)
    assert own.status_code == 200, own.text
    assert figures(
        own.json(), "sale_id", "target", "amount_taken", "method", "refund_method", "may_change"
    ) == (sale["id"], "SALE", "1500.00", "CARD", "CARD", True)
    colleague = await method(net.colleague, sale_path)
    assert colleague.status_code == 200, colleague.text
    assert colleague.json()["may_change"] is False
    elsewhere = await method(
        net.child_seller, f"/api/v1/cash/sales/{sale['id']}/method?store_id={net.other}"
    )
    assert elsewhere.status_code == 200, elsewhere.text
    # Not at a store they cannot take a return in.
    not_hers = await method(
        net.child_seller, f"/api/v1/cash/sales/{sale['id']}/method?store_id={net.store}"
    )
    assert not_hers.status_code == 403, not_hers.text

    for path in (
        f"/api/v1/cash/payments/{payment}/method",
        f"/api/v1/cash/refunds/{returned['id']}/method",
    ):
        mine = await method(net.seller, path)
        assert mine.status_code == 200, mine.text
        assert mine.json()["may_change"] is True
        assert (await method(net.colleague, path)).status_code == 403
        assert (await method(net.manager, path)).status_code == 200
    paid_with = (await method(net.seller, f"/api/v1/cash/payments/{payment}/method")).json()
    assert figures(paid_with, "target", "amount_taken", "method", "refund_method") == (
        "PAYMENT",
        "300.00",
        "CARD",
        None,
    )
    handed = (await method(net.seller, f"/api/v1/cash/refunds/{returned['id']}/method")).json()
    assert figures(handed, "target", "amount_taken", "method") == ("REFUND", "1500.00", "CARD")
