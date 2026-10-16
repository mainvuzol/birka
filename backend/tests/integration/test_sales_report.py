"""The sales report (owner decisions, 2026-10-02), over HTTP against real
PostgreSQL, signed in as the network's people.

- The owner and managers read it, each for the stores they hold
  `report:view_financial` in; a seller does not.
- Today, or any day or days, by the store's own clock.
- What was sold and returned, and the money through the till: sales paid in
  full, payments towards debts, less what returns handed back.
- Each store, and the stores together for whoever sees several.
- A return counts on the day it was taken.
- A sale and its returns are the store's that sold; money is the store's
  whose till it went through.
- The models sold, and every sale and return.

Since 2026-10-04 (owner decisions, "cash and card, the day's close"; ADR-0012,
B11, G24):

- the money is split by the way it was paid: cash, card, transfer, and «не
  вказано» for a row written before the way was asked, never guessed;
- an order paid in advance by transfer, or by cash on delivery through the
  carrier, never went through the till: it is outside «Разом» (`money`);
- money handed back to a card does not lower the cash;
- a correction of the way counts on the day it is made, and a past day's
  figures never change;
- the till's four ways always add up to `money` (checked on every block read
  here, `balanced`).

Since 2026-10-07 (owner decisions, "the server is unreachable"; ADR-0013
§5.6): a sale typed from paper counts on the day it was typed, and its entry
says «продано під час збою», who sold and the paper's time, while `by` stays
whoever typed it.

Corrections are written straight into their table, as a script would: the
database checks each against its money row (revision 0035), and the command
that records them is the drawer's, tested with it. All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.models import Membership
from app.modules.authz.permissions import RoleCode
from app.modules.authz.service import seed_default_roles
from app.modules.cash.models import PaymentCorrection
from app.modules.credit.models import CreditEntry, CustomerCredit, EntryKind
from app.modules.identity.models import AppUser
from app.modules.refunds.models import Refund
from app.modules.sales.models import Sale
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import key, sale_body
from tests.integration.test_store_states import Network, as_, network, set_state, stocked

pytestmark = [pytest.mark.integration, requires_database()]

KYIV = ZoneInfo("Europe/Kyiv")
REPORT = "/api/v1/reports/sales"


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def credit(paid_now: str) -> dict:
    return {
        "credit": {
            "customer_name": "Ірина Коваль",
            "customer_phone": "0671234567",
            "paid_now": paid_now,
        }
    }


async def sell(
    maker,
    net: Network,
    by: uuid.UUID,
    store: uuid.UUID,
    *,
    qty: int = 2,
    way: str = "CASH",
    **extra,
) -> dict:
    """Coats at 1500 each, from the shared warehouse, paid `way`."""
    variant, size = await stocked(maker, net, net.shops.shared_warehouse, qty=qty)
    async with as_(maker, net, by) as client:
        response = await client.post(
            "/api/v1/sales",
            json=sale_body(store, net.shops.shared_warehouse, variant, size, qty=qty)
            | {"payment_method": way}
            | extra,
            headers=key(),
        )
    assert response.status_code == 201, response.text
    return response.json()


async def take_back(
    maker,
    net: Network,
    sale: dict,
    *,
    by: uuid.UUID,
    at: uuid.UUID,
    qty: int = 1,
    way: str = "CASH",
):
    """Coats of `sale` back at `at`, the money handed back `way`. A return of
    a sale paid in parts that only lowers its debt is stored with no way
    (ADR-0012, G35)."""
    async with as_(maker, net, by) as client:
        response = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "store_id": str(at),
                "payment_method": way,
                "lines": [
                    {
                        "sale_item_id": sale["items"][0]["id"],
                        "quantity": qty,
                        "restock": True,
                        "condition": "INTACT",
                    }
                ],
            },
            headers=key(),
        )
    assert response.status_code == 201, response.text
    return response.json()


async def pay(
    maker, net: Network, credit_id: str, amount: str, *, by: uuid.UUID, at=None, way="CASH"
):
    async with as_(maker, net, by) as client:
        response = await client.post(
            f"/api/v1/credits/{credit_id}/payments",
            json={"command_id": str(uuid.uuid4()), "amount": amount, "payment_method": way}
            | ({"store_id": str(at)} if at else {}),
        )
    assert response.status_code == 201, response.text


async def collected(maker, net: Network, *, way: str, **extra) -> dict:
    """Two coats at 1500 ordered at the primary store from the shared
    warehouse, sent, arrived at the post office and collected, paid `way`."""
    primary = net.shops.primary_store
    variant, size = await stocked(maker, net, net.shops.shared_warehouse, qty=2)
    order = {
        name: value
        for name, value in sale_body(
            primary, net.shops.shared_warehouse, variant, size, qty=2
        ).items()
        if name != "payment_method"
    } | {"carrier": "NOVA_POSHTA"}
    async with as_(maker, net, net.seller) as client:
        created = await client.post("/api/v1/orders", json=order)
        assert created.status_code == 201, created.text
        order_id = created.json()["id"]
        for action in ("dispatch", "arrive"):
            moved = await client.post(
                f"/api/v1/orders/{order_id}/{action}", json={"command_id": str(uuid.uuid4())}
            )
            assert moved.status_code == 200, moved.text
        done = await client.post(
            f"/api/v1/orders/{order_id}/collect",
            json={"command_id": str(uuid.uuid4()), "payment_method": way} | extra,
        )
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "COLLECTED"
    return done.json()


async def corrected(
    maker,
    net: Network,
    *,
    by: uuid.UUID,
    sale: str | None = None,
    payment: uuid.UUID | None = None,
    refund: str | None = None,
    way: str,
) -> None:
    """The way of one money row corrected now, as the drawer's command
    records it: the row's own drawer, money and direction, and the way it
    stands at as `from_method`. The database refuses anything else."""
    async with maker() as session:
        if sale is not None:
            row = await session.get(Sale, uuid.UUID(sale))
            assert row is not None
            target: dict[str, Any] = {"sale_id": row.id}
            store, amount, direction, stated = row.store_id, row.total, "IN", row.payment_method
        elif payment is not None:
            entry = await session.get(CreditEntry, payment)
            assert entry is not None
            debt = await session.get(CustomerCredit, entry.credit_id)
            assert debt is not None
            target = {"credit_entry_id": entry.id}
            store = entry.taken_at_store_id or debt.store_id
            amount, direction, stated = entry.amount, "IN", entry.payment_method
        else:
            assert refund is not None
            taken = await session.get(Refund, uuid.UUID(refund))
            assert taken is not None
            cash_back = await session.scalar(
                select(CreditEntry.cash_back).where(CreditEntry.refund_id == taken.id)
            )
            target = {"refund_id": taken.id}
            store, direction, stated = taken.taken_at_store_id, "OUT", taken.payment_method
            amount = taken.total_amount if cash_back is None else cash_back
        (column,) = target
        earlier = (
            await session.execute(
                select(PaymentCorrection.seq, PaymentCorrection.to_method)
                .where(getattr(PaymentCorrection, column) == target[column])
                .order_by(PaymentCorrection.seq.desc())
                .limit(1)
            )
        ).first()
        await session.execute(
            insert(PaymentCorrection).values(
                organization_id=net.shops.organization_id,
                store_id=store,
                seq=1 if earlier is None else earlier.seq + 1,
                direction=direction,
                amount=amount,
                from_method=stated if earlier is None else earlier.to_method,
                to_method=way,
                actor_user_id=by,
                command_id=uuid.uuid4(),
                command_fingerprint="0" * 64,
                **target,
            )
        )
        await session.commit()


async def read(maker, net: Network, by: uuid.UUID, path: str = REPORT, **params):
    async with as_(maker, net, by) as client:
        return await client.get(path, params={k: str(v) for k, v in params.items()})


def balanced(found: dict) -> dict:
    """The till's money adds up both ways: what came in less what went out,
    and the four ways together; each way's net is its own in, out and
    corrections."""
    for way in found["ways"]:
        assert set(way) == {"method", "came_in", "went_out", "corrected", "net"}
        assert Decimal(way["net"]) == (
            Decimal(way["came_in"]) - Decimal(way["went_out"]) + Decimal(way["corrected"])
        )
    for sums in found["off_till"].values():
        assert set(sums) == {"came_in", "corrected", "net"}
        assert Decimal(sums["net"]) == Decimal(sums["came_in"]) + Decimal(sums["corrected"])
    assert sum(Decimal(way["net"]) for way in found["ways"]) == Decimal(found["money"])
    assert Decimal(found["money"]) == (
        Decimal(found["paid_in_full"])
        + Decimal(found["debt_payments"])
        - Decimal(found["paid_back"])
        + Decimal(found["corrected_into_till"])
    )
    return found


def figures(report: dict, store: uuid.UUID) -> dict:
    [found] = [each for each in report["stores"] if each["store_id"] == str(store)]
    return balanced(found)


def money_of(found: dict) -> tuple:
    return tuple(
        found[name]
        for name in (
            "sales",
            "units",
            "sold",
            "returns",
            "returned_units",
            "returned",
            "net",
            "paid_in_full",
            "debt_payments",
            "paid_back",
            "money",
        )
    )


# A way with no money in these days: the till's, and one paid off it.
NONE = ("0.00", "0.00", "0.00", "0.00")
NONE_OFF = ("0.00", "0.00", "0.00")


def ways_of(found: dict) -> dict[str, tuple[str, ...]]:
    """Each way's money: in, out, corrected and net for the till's four, always
    these and in this order; in, corrected and net for the two an order is
    paid by off the till."""
    assert [way["method"] for way in found["ways"]] == ["CASH", "CARD", "TRANSFER", "NOT_STATED"]
    assert list(found["off_till"]) == ["prepaid_transfer", "carrier_cod"]
    return {
        **{
            way["method"]: (way["came_in"], way["went_out"], way["corrected"], way["net"])
            for way in found["ways"]
        },
        **{
            name.upper(): (sums["came_in"], sums["corrected"], sums["net"])
            for name, sums in found["off_till"].items()
        },
    }


def kyiv_day(days_ago: int) -> date:
    return datetime.now(KYIV).date() - timedelta(days=days_ago)


async def on_day(
    maker, day: date, *, sales: Sequence[str] = (), refunds: Sequence[str] = ()
) -> None:
    """Sales sold, and returns taken, at noon of `day` in Kyiv."""
    noon = datetime.combine(day, time(12, 0), KYIV)
    async with maker() as session:
        for sale in sales:
            await session.execute(
                update(Sale).where(Sale.id == uuid.UUID(sale)).values(sold_at=noon)
            )
        for refund in refunds:
            await session.execute(
                update(Refund).where(Refund.id == uuid.UUID(refund)).values(created_at=noon)
            )
        await session.commit()


async def a_store_manager(maker, net: Network, store: uuid.UUID) -> uuid.UUID:
    async with maker() as session:
        roles = await seed_default_roles(session, net.shops.organization_id)
        user = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name="Марта")
        session.add(user)
        await session.flush()
        session.add(
            Membership(
                user_id=user.id,
                organization_id=net.shops.organization_id,
                store_id=store,
                role_id=roles[RoleCode.MANAGER.value].id,
            )
        )
        await session.commit()
        return user.id


async def test_a_day_of_one_store_in_sales_returns_and_money(maker):
    net = await network(maker)
    primary = net.shops.primary_store
    paid = await sell(maker, net, net.seller, primary)
    in_parts = await sell(maker, net, net.seller, primary, **credit("1000.00"))
    await pay(maker, net, in_parts["credit"]["credit_id"], "500.00", by=net.seller)
    # Both coats of the sale paid in full come back, in one return, for their
    # money; one of the sale paid in parts only lowers the debt, 1500 still
    # being owed.
    await take_back(maker, net, paid, by=net.seller, at=primary, qty=2)
    await take_back(maker, net, in_parts, by=net.seller, at=primary)

    response = await read(maker, net, net.owner)

    assert response.status_code == 200, response.text
    report = response.json()
    assert report["date_from"] == report["date_to"] == report["today"]
    assert report["today"] == datetime.now(KYIV).date().isoformat()
    assert report["currency_code"] == "UAH"
    assert [each["store_name"] for each in report["stores"]] == ["Дочірній", "Основний"]
    here = figures(report, primary)
    assert money_of(here) == (
        2,
        4,
        "6000.00",
        2,
        3,
        "4500.00",
        "1500.00",
        "3000.00",
        "1500.00",
        "3000.00",
        "1500.00",
    )
    assert here["store_state"] == "ACTIVE"
    # Every payment was cash, and so was every coin handed back.
    assert ways_of(here) == {
        "CASH": ("4500.00", "3000.00", "0.00", "1500.00"),
        "CARD": NONE,
        "TRANSFER": NONE,
        "NOT_STATED": NONE,
        "PREPAID_TRANSFER": NONE_OFF,
        "CARRIER_COD": NONE_OFF,
    }
    assert here["corrected_into_till"] == "0.00"
    assert set(here) == {
        "store_id",
        "store_name",
        "store_state",
        "sales",
        "units",
        "sold",
        "returns",
        "returned_units",
        "returned",
        "net",
        "paid_in_full",
        "debt_payments",
        "paid_back",
        "corrected_into_till",
        "money",
        "ways",
        "off_till",
    }
    assert money_of(figures(report, net.shops.child_store)) == (
        0,
        0,
        "0.00",
        0,
        0,
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
    )
    # The stores together.
    assert money_of(balanced(report["total"])) == money_of(here)
    assert ways_of(report["total"]) == ways_of(here)


async def test_the_sale_is_the_sellers_and_the_money_the_tills(maker):
    net = await network(maker)
    primary, child = net.shops.primary_store, net.shops.child_store
    # Sold at the child store, brought back to the primary one.
    sold_there = await sell(maker, net, net.child_seller, child, qty=1)
    await take_back(maker, net, sold_there, by=net.seller, at=primary)
    # A debt of the child store, paid at the primary one while the child is
    # blocked.
    owed = await sell(maker, net, net.child_seller, child, **credit("500.00"))
    assert (await set_state(maker, net, "BLOCKED")).status_code == 200
    await pay(maker, net, owed["credit"]["credit_id"], "200.00", by=net.seller, at=primary)

    report = (await read(maker, net, net.owner)).json()

    there = figures(report, child)
    assert there["store_state"] == "BLOCKED"
    # Both sales and the return are the child's: it sold them.
    assert (there["sales"], there["sold"], there["returns"], there["returned"]) == (
        2,
        "4500.00",
        1,
        "1500.00",
    )
    # Its till took the coat sold in full and the first payment; it handed
    # nothing back and took no later payment.
    assert (
        there["paid_in_full"],
        there["debt_payments"],
        there["paid_back"],
        there["money"],
    ) == ("1500.00", "500.00", "0.00", "2000.00")
    here = figures(report, primary)
    assert (here["sales"], here["returns"]) == (0, 0)
    # The primary store's till handed the money back and took the payment.
    assert (here["debt_payments"], here["paid_back"], here["money"]) == (
        "200.00",
        "1500.00",
        "-1300.00",
    )
    assert balanced(report["total"])["money"] == "700.00"
    assert report["total"]["net"] == "3000.00"


async def test_a_day_is_the_stores_own_and_a_return_counts_on_its_day(maker):
    net = await network(maker)
    primary = net.shops.primary_store
    sale = await sell(maker, net, net.seller, primary, qty=1)
    refund = await take_back(maker, net, sale, by=net.seller, at=primary)
    # Sold at 23:30 in Kyiv on the 10th of March — 21:30 on the 10th by UTC —
    # and brought back at 00:10 on the 11th, which is still the 10th by UTC.
    async with maker() as session:
        await session.execute(
            update(Sale)
            .where(Sale.id == uuid.UUID(sale["id"]))
            .values(sold_at=datetime(2026, 3, 10, 23, 30, tzinfo=KYIV))
        )
        await session.execute(
            update(Refund)
            .where(Refund.id == uuid.UUID(refund["id"]))
            .values(created_at=datetime(2026, 3, 11, 0, 10, tzinfo=KYIV))
        )
        await session.commit()

    tenth = figures((await read(maker, net, net.owner, date_from="2026-03-10")).json(), primary)
    eleventh = figures((await read(maker, net, net.owner, date_from="2026-03-11")).json(), primary)
    both = (await read(maker, net, net.owner, date_from="2026-03-10", date_to="2026-03-11")).json()
    ninth = figures((await read(maker, net, net.owner, date_from="2026-03-09")).json(), primary)

    assert (tenth["sales"], tenth["returns"], tenth["net"], tenth["money"]) == (
        1,
        0,
        "1500.00",
        "1500.00",
    )
    # The day of the sale is never changed by its return.
    assert (eleventh["sales"], eleventh["returns"], eleventh["net"], eleventh["money"]) == (
        0,
        1,
        "-1500.00",
        "-1500.00",
    )
    assert (both["date_from"], both["date_to"]) == ("2026-03-10", "2026-03-11")
    assert figures(both, primary)["net"] == "0.00"
    assert (ninth["sales"], ninth["returns"]) == (0, 0)


async def test_who_reads_the_report_and_for_which_stores(maker):
    net = await network(maker)
    primary, child = net.shops.primary_store, net.shops.child_store
    child_manager = await a_store_manager(maker, net, child)
    await sell(maker, net, net.seller, primary, qty=1)

    seller = await read(maker, net, net.seller)
    assert seller.status_code == 403, seller.text
    assert seller.json()["code"] == "PERMISSION_DENIED"
    assert (await read(maker, net, net.child_seller)).status_code == 403
    for path in (f"{REPORT}/models", f"{REPORT}/entries"):
        assert (await read(maker, net, net.seller, path)).status_code == 403
        assert (await read(maker, net, net.seller, path, store_id=primary)).status_code == 403

    # A manager of one store reads that store alone, and no total.
    mine = (await read(maker, net, child_manager)).json()
    assert [each["store_id"] for each in mine["stores"]] == [str(child)]
    assert mine["total"] is None
    elsewhere = await read(maker, net, child_manager, f"{REPORT}/entries", store_id=primary)
    assert elsewhere.status_code == 403, elsewhere.text
    # The network's manager and owner read every store, and the total.
    for person in (net.manager, net.owner):
        every = (await read(maker, net, person)).json()
        assert {each["store_id"] for each in every["stores"]} == {str(primary), str(child)}
        assert every["total"]["sales"] == 1

    # A blocked store is read by the network, never by its own people.
    assert (await set_state(maker, net, "BLOCKED")).status_code == 200
    assert {each["store_id"] for each in (await read(maker, net, net.owner)).json()["stores"]} == {
        str(primary),
        str(child),
    }
    blocked = await read(maker, net, child_manager)
    assert blocked.status_code == 403, blocked.text
    shut = await read(maker, net, child_manager, f"{REPORT}/models", store_id=child)
    assert shut.status_code == 403
    assert shut.json()["code"] == "STORE_NOT_TRADING"


async def test_a_period_is_one_day_to_a_year(maker):
    net = await network(maker)

    backwards = await read(maker, net, net.owner, date_from="2026-03-11", date_to="2026-03-10")
    # 367 days, and 366: a year with its leap day.
    too_long = await read(maker, net, net.owner, date_from="2025-03-09", date_to="2026-03-10")
    a_year = await read(maker, net, net.owner, date_from="2025-03-10", date_to="2026-03-10")
    one_day = await read(maker, net, net.owner, f"{REPORT}/entries", date_from="2026-03-11")
    only_last = await read(maker, net, net.owner, f"{REPORT}/models", date_to="2026-03-11")

    for refused in (backwards, too_long):
        assert refused.status_code == 422, refused.text
        assert refused.json()["details"]["reason"] == "PERIOD"
    assert a_year.status_code == 200, a_year.text
    assert (one_day.json()["date_from"], one_day.json()["date_to"]) == ("2026-03-11", "2026-03-11")
    assert (only_last.json()["date_from"], only_last.json()["date_to"]) == (
        "2026-03-11",
        "2026-03-11",
    )


async def test_the_models_sold_and_every_sale_and_return(maker):
    net = await network(maker)
    primary, child = net.shops.primary_store, net.shops.child_store
    two = await sell(maker, net, net.seller, primary, qty=2)
    three = await sell(maker, net, net.seller, primary, qty=3, **credit("1000.00"))
    elsewhere = await sell(maker, net, net.child_seller, child, qty=1)
    returned = await take_back(maker, net, three, by=net.seller, at=primary)
    brought = await take_back(maker, net, elsewhere, by=net.seller, at=primary)

    models = (await read(maker, net, net.owner, f"{REPORT}/models", store_id=primary)).json()
    every_model = (await read(maker, net, net.owner, f"{REPORT}/models")).json()
    listed = (await read(maker, net, net.owner, f"{REPORT}/entries", store_id=primary)).json()
    child_listed = (await read(maker, net, net.owner, f"{REPORT}/entries", store_id=child)).json()
    first = (
        await read(maker, net, net.owner, f"{REPORT}/entries", store_id=primary, limit=1)
    ).json()
    exactly = (
        await read(maker, net, net.owner, f"{REPORT}/entries", store_id=child, limit=2)
    ).json()

    # The most money first; a model's returns beside it.
    assert [
        (m["display_name"], m["units"], m["sold"], m["returned_units"], m["returned"])
        for m in models["models"]
    ] == [
        (three["items"][0]["display_name"], 3, "4500.00", 1, "1500.00"),
        (two["items"][0]["display_name"], 2, "3000.00", 0, "0.00"),
    ]
    assert len(every_model["models"]) == 3

    # The primary store's: its two sales, the return of one, and the return
    # it took of the child's sale, the newest first.
    assert [(e["kind"], e["id"]) for e in listed["entries"]] == [
        ("RETURN", brought["id"]),
        ("RETURN", returned["id"]),
        ("SALE", three["id"]),
        ("SALE", two["id"]),
    ]
    took, gave_back, in_parts, paid = listed["entries"]
    assert paid["goods"] == [f"{two['items'][0]['display_name']}, M × 2"]
    assert (paid["by"], paid["units"], paid["amount"], paid["money"], paid["paid_in_parts"]) == (
        "seller",
        2,
        "3000.00",
        "3000.00",
        False,
    )
    assert (paid["payment_method"], paid["method_now"]) == ("CASH", None)
    assert (in_parts["amount"], in_parts["money"], in_parts["paid_in_parts"]) == (
        "4500.00",
        "1000.00",
        True,
    )
    assert (in_parts["payment_method"], in_parts["method_now"]) == ("CASH", None)
    # A return of a sale paid in parts lowered the debt: nothing left the till,
    # and it went no way.
    assert (gave_back["amount"], gave_back["money"], gave_back["paid_in_parts"]) == (
        "1500.00",
        "0.00",
        True,
    )
    assert (gave_back["payment_method"], gave_back["method_now"]) == (None, None)
    assert (
        took["store_name"],
        took["taken_at_store_name"],
        took["by"],
        took["amount"],
        took["money"],
        took["payment_method"],
    ) == ("Дочірній", "Основний", "seller", "1500.00", "1500.00", "CASH")
    assert set(took) == {
        "kind",
        "id",
        "sale_id",
        "at",
        "store_id",
        "store_name",
        "taken_at_store_id",
        "taken_at_store_name",
        "by",
        "units",
        "amount",
        "money",
        "payment_method",
        "method_now",
        "paid_in_parts",
        "goods",
        "outage",
    }
    # Nothing here was typed from paper.
    assert {entry["outage"] for entry in listed["entries"]} == {None}
    # The child's list has its sale and the return of it taken elsewhere.
    assert [(e["kind"], e["id"]) for e in child_listed["entries"]] == [
        ("RETURN", brought["id"]),
        ("SALE", elsewhere["id"]),
    ]
    assert first["has_more"] is True
    assert [e["id"] for e in first["entries"]] == [brought["id"]]
    assert (len(exactly["entries"]), exactly["has_more"]) == (2, False)
    assert listed["has_more"] is False


async def entries_of(maker, net: Network, **params) -> dict[str, dict]:
    listed = (await read(maker, net, net.owner, f"{REPORT}/entries", **params)).json()
    return {entry["id"]: entry for entry in listed["entries"]}


async def test_the_money_is_split_by_the_way_it_was_paid(maker):
    net = await network(maker)
    primary = net.shops.primary_store
    await sell(maker, net, net.seller, primary, way="CASH")
    # A card sale returned to the card: the money never left the drawer.
    to_card = await sell(maker, net, net.seller, primary, qty=1, way="CARD")
    card_back = await take_back(maker, net, to_card, by=net.seller, at=primary, way="CARD")
    # A card sale returned in cash: the owner's own example of money handed
    # back another way than the sale's.
    in_cash = await sell(maker, net, net.seller, primary, qty=1, way="CARD")
    cash_back = await take_back(maker, net, in_cash, by=net.seller, at=primary, way="CASH")
    by_transfer = await sell(maker, net, net.seller, primary, qty=1, way="TRANSFER")
    # Paid in parts: 1000 now by card, 500 later by transfer.
    in_parts = await sell(maker, net, net.seller, primary, way="CARD", **credit("1000.00"))
    await pay(maker, net, in_parts["credit"]["credit_id"], "500.00", by=net.seller, way="TRANSFER")

    here = figures((await read(maker, net, net.owner)).json(), primary)

    assert money_of(here) == (
        5,
        7,
        "10500.00",
        2,
        2,
        "3000.00",
        "7500.00",
        "7500.00",
        "1500.00",
        "3000.00",
        "6000.00",
    )
    # A card refund lowers the card, never the cash.
    assert ways_of(here) == {
        "CASH": ("3000.00", "1500.00", "0.00", "1500.00"),
        "CARD": ("4000.00", "1500.00", "0.00", "2500.00"),
        "TRANSFER": ("2000.00", "0.00", "0.00", "2000.00"),
        "NOT_STATED": NONE,
        "PREPAID_TRANSFER": NONE_OFF,
        "CARRIER_COD": NONE_OFF,
    }
    listed = await entries_of(maker, net)
    assert [
        (listed[each["id"]]["money"], listed[each["id"]]["payment_method"])
        for each in (to_card, card_back, in_cash, cash_back, by_transfer, in_parts)
    ] == [
        ("1500.00", "CARD"),
        ("1500.00", "CARD"),
        ("1500.00", "CARD"),
        ("1500.00", "CASH"),
        ("1500.00", "TRANSFER"),
        ("1000.00", "CARD"),
    ]
    assert {entry["method_now"] for entry in listed.values()} == {None}


async def test_an_order_paid_off_the_till_is_outside_its_money(maker):
    net = await network(maker)
    primary = net.shops.primary_store
    by_carrier = await collected(maker, net, way="CARRIER_COD")
    await collected(maker, net, way="PREPAID_TRANSFER")
    # «Готівкою — зараз, на касі»: the only order money the till took.
    at_the_counter = await collected(maker, net, way="CASH")
    # Paid in parts, the part paid now by the carrier (ADR-0012, G2): it is
    # no payment through the till either.
    in_parts = await collected(maker, net, way="CARRIER_COD", **credit("1000.00"))

    here = figures((await read(maker, net, net.owner)).json(), primary)

    # Four sales, every one sold; the till took 3000 of them.
    assert money_of(here) == (
        4,
        8,
        "12000.00",
        0,
        0,
        "0.00",
        "12000.00",
        "3000.00",
        "0.00",
        "0.00",
        "3000.00",
    )
    assert ways_of(here) == {
        "CASH": ("3000.00", "0.00", "0.00", "3000.00"),
        "CARD": NONE,
        "TRANSFER": NONE,
        "NOT_STATED": NONE,
        "PREPAID_TRANSFER": ("3000.00", "0.00", "3000.00"),
        "CARRIER_COD": ("4000.00", "0.00", "4000.00"),
    }
    listed = await entries_of(maker, net)
    assert [
        (
            listed[order["sale_id"]]["money"],
            listed[order["sale_id"]]["payment_method"],
            listed[order["sale_id"]]["paid_in_parts"],
        )
        for order in (by_carrier, at_the_counter, in_parts)
    ] == [
        ("3000.00", "CARRIER_COD", False),
        ("3000.00", "CASH", False),
        ("1000.00", "CARRIER_COD", True),
    ]


async def test_a_correction_counts_on_the_day_it_is_made_and_a_past_day_never_changes(maker):
    net = await network(maker)
    primary = net.shops.primary_store
    yesterday, today = kyiv_day(1), kyiv_day(0)
    # Yesterday: a card sale, an order paid by the carrier, and a cash sale
    # whose coat came back for cash.
    by_card = await sell(maker, net, net.seller, primary, qty=1, way="CARD")
    by_carrier = await collected(maker, net, way="CARRIER_COD")
    by_cash = await sell(maker, net, net.seller, primary, qty=1, way="CASH")
    returned = await take_back(maker, net, by_cash, by=net.seller, at=primary, way="CASH")
    await on_day(
        maker,
        yesterday,
        sales=[by_card["id"], by_carrier["sale_id"], by_cash["id"]],
        refunds=[returned["id"]],
    )
    before = await read(maker, net, net.owner, date_from=yesterday)
    assert ways_of(figures(before.json(), primary)) == {
        "CASH": ("1500.00", "1500.00", "0.00", "0.00"),
        "CARD": ("1500.00", "0.00", "0.00", "1500.00"),
        "TRANSFER": NONE,
        "NOT_STATED": NONE,
        "PREPAID_TRANSFER": NONE_OFF,
        "CARRIER_COD": ("3000.00", "0.00", "3000.00"),
    }
    # Today: a sale in parts, 1000 now by card.
    in_parts = await sell(maker, net, net.seller, primary, way="CARD", **credit("1000.00"))
    async with maker() as session:
        first_payment = await session.scalar(
            select(CreditEntry.id).where(
                CreditEntry.credit_id == uuid.UUID(in_parts["credit"]["credit_id"]),
                CreditEntry.kind == EntryKind.PAYMENT.value,
            )
        )

    # Today a manager finds every one of them was paid another way: the card
    # sale and the order in cash, the return's money to the card, and the
    # part paid today by transfer.
    await corrected(maker, net, by=net.manager, sale=by_card["id"], way="CASH")
    await corrected(maker, net, by=net.manager, sale=by_carrier["sale_id"], way="CASH")
    await corrected(maker, net, by=net.manager, refund=returned["id"], way="CARD")
    await corrected(maker, net, by=net.manager, payment=first_payment, way="TRANSFER")

    # Yesterday's report has not moved by a byte.
    after = await read(maker, net, net.owner, date_from=yesterday)
    assert after.status_code == 200, after.text
    assert after.content == before.content
    # Today's has each correction as its own figure: into the cash, out of
    # the card and the carrier's money, into the transfers.
    here = figures((await read(maker, net, net.owner, date_from=today)).json(), primary)
    assert money_of(here) == (
        1,
        2,
        "3000.00",
        0,
        0,
        "0.00",
        "3000.00",
        "0.00",
        "1000.00",
        "0.00",
        "4000.00",
    )
    assert ways_of(here) == {
        "CASH": ("0.00", "0.00", "6000.00", "6000.00"),
        "CARD": ("1000.00", "0.00", "-4000.00", "-3000.00"),
        "TRANSFER": ("0.00", "0.00", "1000.00", "1000.00"),
        "NOT_STATED": NONE,
        "PREPAID_TRANSFER": NONE_OFF,
        "CARRIER_COD": ("0.00", "-3000.00", "-3000.00"),
    }
    # The order's 3000 came into the till only today.
    assert here["corrected_into_till"] == "3000.00"
    # Together the two days say what happened: 6000 in cash, the card's 1500
    # handed back, 1000 by transfer, nothing left with the carrier.
    both = figures(
        (await read(maker, net, net.owner, date_from=yesterday, date_to=today)).json(), primary
    )
    assert (both["money"], both["corrected_into_till"]) == ("5500.00", "3000.00")
    assert ways_of(both) == {
        "CASH": ("1500.00", "1500.00", "6000.00", "6000.00"),
        "CARD": ("2500.00", "0.00", "-4000.00", "-1500.00"),
        "TRANSFER": ("0.00", "0.00", "1000.00", "1000.00"),
        "NOT_STATED": NONE,
        "PREPAID_TRANSFER": NONE_OFF,
        "CARRIER_COD": ("3000.00", "-3000.00", "0.00"),
    }
    # The other store's drawer saw none of it.
    other = figures((await read(maker, net, net.owner)).json(), net.shops.child_store)
    assert {way[2] for name, way in ways_of(other).items() if name in ("CASH", "CARD")} == {"0.00"}

    # Each entry keeps the way it was stated with; the correction is a note.
    listed = await entries_of(maker, net, date_from=yesterday, date_to=today)
    assert [
        (listed[row]["payment_method"], listed[row]["method_now"])
        for row in (
            by_card["id"],
            by_carrier["sale_id"],
            by_cash["id"],
            returned["id"],
            in_parts["id"],
        )
    ] == [
        ("CARD", "CASH"),
        ("CARRIER_COD", "CASH"),
        ("CASH", None),
        ("CASH", "CARD"),
        ("CARD", "TRANSFER"),
    ]


async def test_money_recorded_before_the_way_was_asked_reads_not_stated(maker):
    net = await network(maker)
    primary = net.shops.primary_store
    # A sale as the app wrote it before revision 0035: no way at all.
    async with maker() as session:
        old = await session.scalar(
            insert(Sale)
            .values(
                organization_id=net.shops.organization_id,
                store_id=primary,
                seller_user_id=net.seller,
                command_id=uuid.uuid4(),
                command_fingerprint="0" * 64,
                currency_code="UAH",
                subtotal=Decimal("1000.00"),
                total=Decimal("1000.00"),
            )
            .returning(Sale.id)
        )
        await session.commit()
    await sell(maker, net, net.seller, primary, qty=1, way="CASH")

    here = figures((await read(maker, net, net.owner)).json(), primary)

    # It went through the till, as everything did then, and nothing guesses
    # how.
    assert (here["paid_in_full"], here["money"]) == ("2500.00", "2500.00")
    assert ways_of(here)["CASH"] == ("1500.00", "0.00", "0.00", "1500.00")
    assert ways_of(here)["NOT_STATED"] == ("1000.00", "0.00", "0.00", "1000.00")
    entry = (await entries_of(maker, net))[str(old)]
    assert (entry["money"], entry["payment_method"], entry["method_now"]) == (
        "1000.00",
        None,
        None,
    )

    # A manager says how it was paid: from «не вказано» to cash, today.
    await corrected(maker, net, by=net.manager, sale=str(old), way="CASH")

    here = figures((await read(maker, net, net.owner)).json(), primary)
    assert (here["money"], here["corrected_into_till"]) == ("2500.00", "0.00")
    assert ways_of(here)["CASH"] == ("1500.00", "0.00", "1000.00", "2500.00")
    assert ways_of(here)["NOT_STATED"] == ("1000.00", "0.00", "-1000.00", "0.00")
    entry = (await entries_of(maker, net))[str(old)]
    assert (entry["payment_method"], entry["method_now"]) == (None, "CASH")


async def test_a_sale_typed_from_paper_counts_the_day_it_was_typed_and_names_both(maker):
    """Typed today by the manager from yesterday evening's paper, sold by the
    seller: today's sale, as the paper sales of the first days were; «Звіт»
    shows who sold and who typed it (owner decision, 2026-10-04). The mark
    changes no figure."""
    net = await network(maker)
    primary = net.shops.primary_store
    written = f"{kyiv_day(1).isoformat()}T19:40"
    typed = await sell(
        maker,
        net,
        net.manager,
        primary,
        qty=1,
        way="CARD",
        outage={"sold_by_user_id": str(net.seller), "sold_at": written},
    )
    live = await sell(maker, net, net.seller, primary, qty=1, way="CASH")

    today = figures((await read(maker, net, net.owner)).json(), primary)
    yesterday = figures((await read(maker, net, net.owner, date_from=kyiv_day(1))).json(), primary)
    entries = await entries_of(maker, net, store_id=primary)

    assert (today["sales"], today["sold"], today["money"]) == (2, "3000.00", "3000.00")
    assert ways_of(today)["CARD"] == ("1500.00", "0.00", "0.00", "1500.00")
    assert (yesterday["sales"], yesterday["money"]) == (0, "0.00")
    entry = entries[typed["id"]]
    assert (entry["by"], entry["outage"]["sold_by"]) == ("manager", "seller")
    assert datetime.fromisoformat(entry["outage"]["sold_at"]) == datetime.combine(
        kyiv_day(1), time(19, 40), KYIV
    )
    assert datetime.fromisoformat(entry["at"]).astimezone(KYIV).date() == kyiv_day(0)
    assert entries[live["id"]]["outage"] is None


async def test_a_sale_typed_from_paper_naming_nobody_still_says_so(maker):
    """Who sold and when are both optional on the paper (owner decision,
    2026-10-04): with neither named, «Звіт» still says the sale was typed
    from paper, and who typed it."""
    net = await network(maker)
    primary = net.shops.primary_store
    typed = await sell(maker, net, net.seller, primary, qty=1, way="CASH", outage={})

    entry = (await entries_of(maker, net, store_id=primary))[typed["id"]]

    assert entry["by"] == "seller"
    assert entry["outage"] == {"sold_by": None, "sold_at": None, "first_days": False}
