"""A sale paid in parts (owner decisions, 2026-10-01), over HTTP against real
PostgreSQL.

- The customer takes the goods at once, pays above nothing now, owes the rest.
- The shop records the customer's name and phone; there is no schedule.
- A seller sells this way and takes payments, in the store that sold.
- Returned goods first lower what is owed; money goes back only for what was
  paid beyond the worth of what the customer keeps.
- The owner may write off a debt, saying why.

All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.core.errors import ValidationFailedError
from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.credit import service
from app.modules.inventory.service import find_divergences
from app.modules.sales.payment import PaymentMethod
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import (
    TwoShops,
    api,
    key,
    make_two_shops,
    order_body,
    quantity_at,
    sale_body,
    stock_a_coat,
)

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
OWNER = DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def terms(paid_now: str = "1000.00", **extra: str) -> dict:
    return {
        "customer_name": "Ірина Коваль",
        "customer_phone": "+38 (067) 123-45-67",
        "paid_now": paid_now,
    } | extra


async def on_credit(
    maker, shops: TwoShops, *, paid_now: str = "1000.00", qty: int = 2, permissions=SELLER
) -> tuple[dict, str, str]:
    """Two coats at 1500, 3000 in all, paid in part by the primary store."""
    async with api(maker, shops.scope(shops.primary_store, permissions)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=3
        )
        body = sale_body(shops.primary_store, shops.shared_warehouse, variant, size, qty=qty)
        response = await client.post(
            "/api/v1/sales", json=body | {"credit": terms(paid_now)}, headers=key()
        )
        assert response.status_code == 201, response.text
        return response.json(), variant, size


async def pay(maker, shops, credit_id: str, amount: str, command_id: str | None = None):
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await client.post(
            f"/api/v1/credits/{credit_id}/payments",
            json={
                "command_id": command_id or str(uuid.uuid4()),
                "amount": amount,
                "payment_method": "CASH",
            },
        )


async def give_back(maker, shops, sale: dict, quantity: int):
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": sale["items"][0]["id"],
                        "quantity": quantity,
                        "restock": True,
                        "condition": "INTACT",
                    }
                ],
                "payment_method": "CASH",
            },
            headers=key(),
        )


async def debt(maker, shops, credit_id: str) -> dict:
    async with api(maker, shops.scope(shops.primary_store)) as client:
        response = await client.get(f"/api/v1/credits/{credit_id}")
    assert response.status_code == 200, response.text
    return response.json()


async def test_a_sale_paid_in_part_leaves_the_rest_owed(maker):
    shops = await make_two_shops(maker)
    sale, variant, size = await on_credit(maker, shops)

    assert sale["total"] == "3000.00"
    assert sale["credit"]["paid_now"] == "1000.00"
    assert sale["credit"]["owed"] == "2000.00"
    async with api(maker, shops.scope(shops.primary_store)) as client:
        listed = await client.get(
            "/api/v1/credits", params={"store_id": str(shops.primary_store), "status": "OPEN"}
        )
    [item] = listed.json()["items"]
    assert item["id"] == sale["credit"]["credit_id"]
    assert item["customer_name"] == "Ірина Коваль"
    assert item["customer_phone"] == "+38 (067) 123-45-67"
    assert (item["amount"], item["paid"], item["owed"]) == ("3000.00", "1000.00", "2000.00")
    assert item["goods"] == [f"{sale['items'][0]['display_name']} × 2"]
    assert item["last_payment_at"] is not None
    # The goods left with the customer.
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 1
        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.organization_id == shops.organization_id,
                AuditLog.action == "credit.opened",
            )
        )
    assert entry.after == {"sale_id": sale["id"], "amount": "3000.00", "paid_now": "1000.00"}
    # The phone stays out of the audit log, and out of the receipt. Looked for
    # whole, in each spelling: three of its digits turn up in a random sale id
    # now and then.
    for spelling in ("+38 (067) 123-45-67", "0671234567", "123-45-67"):
        assert spelling not in str(entry.after)
    assert "customer_phone" not in sale["credit"]


async def test_payments_lower_the_debt_until_nothing_is_owed(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await on_credit(maker, shops)
    credit_id = sale["credit"]["credit_id"]
    command = str(uuid.uuid4())

    first = await pay(maker, shops, credit_id, "500.00", command)
    again = await pay(maker, shops, credit_id, "500.00", command)
    other = await pay(maker, shops, credit_id, "600.00", command)
    last = await pay(maker, shops, credit_id, "1500.00")
    after = await pay(maker, shops, credit_id, "1.00")

    assert first.status_code == 201, first.text
    assert first.json()["owed"] == "1500.00"
    # The same command is answered with what it did, once.
    assert again.status_code == 201
    assert again.json()["paid"] == "1500.00"
    assert other.status_code == 409
    assert other.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert last.json()["status"] == "SETTLED"
    assert last.json()["owed"] == "0.00"
    assert last.json()["closed_at"] is not None
    assert after.status_code == 422
    assert after.json()["details"]["reason"] == "NOT_OWED"
    assert [e["kind"] for e in last.json()["entries"]] == ["PAYMENT", "PAYMENT", "PAYMENT"]


async def test_never_more_than_is_owed(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await on_credit(maker, shops)

    too_much = await pay(maker, shops, sale["credit"]["credit_id"], "2000.01")
    nothing = await pay(maker, shops, sale["credit"]["credit_id"], "0")

    assert too_much.status_code == 422
    # Refused after the payment's lookup: it says nothing was recorded
    # (ADR-0013 §1).
    assert too_much.json()["details"] == {
        "reason": "MORE_THAN_OWED",
        "owed": "2000.00",
        "recorded": False,
    }
    assert nothing.status_code == 422
    assert (await debt(maker, shops, sale["credit"]["credit_id"]))["owed"] == "2000.00"


@pytest.mark.parametrize(
    ("credit", "reason"),
    [
        (terms("0.00"), None),
        (terms("3000.00"), "PAID_IN_FULL"),
        (terms(customer_phone="12345"), "CUSTOMER_PHONE"),
        (terms(customer_name="   "), "CUSTOMER_NAME"),
    ],
)
async def test_what_the_seller_states_is_checked(maker, credit, reason):
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=2
        )
        body = sale_body(shops.primary_store, shops.shared_warehouse, variant, size, qty=2)
        refused = await client.post("/api/v1/sales", json=body | {"credit": credit}, headers=key())

    assert refused.status_code == 422, refused.text
    if reason:
        assert refused.json()["details"]["reason"] == reason
    # Nothing was sold either.
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2


async def test_returned_goods_first_lower_the_debt(maker):
    shops = await make_two_shops(maker)
    sale, variant, size = await on_credit(maker, shops)

    first = await give_back(maker, shops, sale, 1)
    second = await give_back(maker, shops, sale, 1)

    assert first.status_code == 201, first.text
    # Paid 1000 of 3000, keeps a coat worth 1500: still owes 500, gets nothing.
    assert first.json()["total_amount"] == "1500.00"
    assert first.json()["credit"] == {
        "debt_reduced": "1500.00",
        "cash_back": "0.00",
        "owed_after": "500.00",
    }
    # Keeps nothing: the 1000 paid goes back, and nothing is owed.
    assert second.json()["credit"] == {
        "debt_reduced": "500.00",
        "cash_back": "1000.00",
        "owed_after": "0.00",
    }
    state = await debt(maker, shops, sale["credit"]["credit_id"])
    assert state["status"] == "SETTLED"
    assert (state["returned"], state["cash_back"]) == ("3000.00", "1000.00")
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 3
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_the_store_sales_say_which_were_paid_in_parts(maker):
    shops = await make_two_shops(maker)
    sale, variant, size = await on_credit(maker, shops)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        ordinary = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size),
            headers=key(),
        )
        assert ordinary.status_code == 201, ordinary.text
        listed = await client.get("/api/v1/sales", params={"store_id": str(shops.primary_store)})

    # Where a seller finds the sale being returned: the till cannot say up
    # front what goes back in cash for one paid in parts.
    flags = {item["id"]: item["paid_in_parts"] for item in listed.json()["sales"]}
    assert flags == {sale["id"]: True, ordinary.json()["id"]: False}


async def test_a_paid_off_sale_gives_back_what_it_is_worth(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await on_credit(maker, shops)
    await pay(maker, shops, sale["credit"]["credit_id"], "2000.00")

    back = await give_back(maker, shops, sale, 1)
    rest = await give_back(maker, shops, sale, 1)

    # Each coat brings back what it cost, and no more, however many come back.
    for returned in (back, rest):
        assert returned.json()["credit"] == {
            "debt_reduced": "0.00",
            "cash_back": "1500.00",
            "owed_after": "0.00",
        }


async def test_only_the_owner_writes_off_and_says_why_and_it_never_becomes_cash(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await on_credit(maker, shops)
    credit_id = sale["credit"]["credit_id"]
    command = str(uuid.uuid4())

    async with api(maker, shops.scope(shops.primary_store)) as client:
        by_seller = await client.post(
            f"/api/v1/credits/{credit_id}/write-off",
            json={"command_id": command, "reason": "поїхала"},
        )
    async with api(maker, shops.scope(shops.primary_store, OWNER)) as client:
        silent = await client.post(
            f"/api/v1/credits/{credit_id}/write-off",
            json={"command_id": command, "reason": "  "},
        )
        written = await client.post(
            f"/api/v1/credits/{credit_id}/write-off",
            json={"command_id": command, "reason": "поїхала за кордон"},
        )
        again = await client.post(
            f"/api/v1/credits/{credit_id}/write-off",
            json={"command_id": command, "reason": "поїхала за кордон"},
        )
    first = await give_back(maker, shops, sale, 1)
    second = await give_back(maker, shops, sale, 1)

    assert by_seller.status_code == 403
    assert silent.status_code == 422
    assert written.status_code == 200, written.text
    assert written.json()["status"] == "WRITTEN_OFF"
    assert (written.json()["written_off"], written.json()["owed"]) == ("2000.00", "0.00")
    assert written.json()["entries"][-1]["note"] == "поїхала за кордон"
    assert again.json() == written.json()
    # Only the 1000 actually paid can ever come back.
    assert first.json()["credit"]["cash_back"] == "0.00"
    assert second.json()["credit"]["cash_back"] == "1000.00"


async def test_only_the_store_that_sold_takes_payments_and_sees_the_debt(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await on_credit(maker, shops)
    credit_id = sale["credit"]["credit_id"]

    async with api(maker, shops.scope(shops.child_store)) as client:
        seen = await client.get(f"/api/v1/credits/{credit_id}")
        paid = await client.post(
            f"/api/v1/credits/{credit_id}/payments",
            json={"command_id": str(uuid.uuid4()), "amount": "100.00", "payment_method": "CASH"},
        )
        listed = await client.get("/api/v1/credits", params={"store_id": str(shops.primary_store)})

    assert seen.status_code == paid.status_code == listed.status_code == 403
    assert (await debt(maker, shops, credit_id))["owed"] == "2000.00"


async def test_selling_in_parts_needs_its_own_permission(maker):
    shops = await make_two_shops(maker)
    without = SELLER - {Permission.SALE_CREDIT}
    async with api(maker, shops.scope(shops.primary_store, without)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=2
        )
        body = sale_body(shops.primary_store, shops.shared_warehouse, variant, size)
        refused = await client.post("/api/v1/sales", json=body | {"credit": terms()}, headers=key())
        plain = await client.post("/api/v1/sales", json=body, headers=key())

    assert refused.status_code == 403
    assert refused.json()["details"]["permission"] == "sale:credit"
    assert plain.status_code == 201
    assert plain.json()["credit"] is None


async def test_the_same_sale_retried_is_one_debt_and_other_terms_are_refused(maker):
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=3
        )
        body = sale_body(shops.primary_store, shops.shared_warehouse, variant, size, qty=2)
        first = await client.post("/api/v1/sales", json=body | {"credit": terms()}, headers=key())
        again = await client.post("/api/v1/sales", json=body | {"credit": terms()}, headers=key())
        cheaper = await client.post(
            "/api/v1/sales", json=body | {"credit": terms("900.00")}, headers=key()
        )
        in_full = await client.post("/api/v1/sales", json=body, headers=key())
        listed = await client.get("/api/v1/credits", params={"store_id": str(shops.primary_store)})

    assert first.status_code == again.status_code == 201
    assert again.json()["credit"] == first.json()["credit"]
    assert cheaper.status_code == in_full.status_code == 409
    assert len(listed.json()["items"]) == 1
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 1


async def test_two_payments_at_once_never_pay_more_than_is_owed(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await on_credit(maker, shops)
    credit_id = uuid.UUID(sale["credit"]["credit_id"])
    scope = shops.scope(shops.primary_store)

    async with maker.begin() as first:
        await service.pay(
            first,
            scope=scope,
            credit_id=credit_id,
            command_id=uuid.uuid4(),
            amount=Decimal("1500"),
            payment_method=PaymentMethod.CASH,
        )

        async def second():
            async with maker.begin() as session:
                return await service.pay(
                    session,
                    scope=scope,
                    credit_id=credit_id,
                    command_id=uuid.uuid4(),
                    amount=Decimal("1500"),
                    payment_method=PaymentMethod.CASH,
                )

        meanwhile = asyncio.create_task(second())
        await asyncio.sleep(0.5)
        # It waits for the first payment to end, then sees what is left.
        assert not meanwhile.done()

    with pytest.raises(ValidationFailedError) as refused:
        await meanwhile
    assert refused.value.details == {
        "reason": "MORE_THAN_OWED",
        "owed": "500.00",
        "recorded": False,
    }


async def test_the_ledger_of_a_debt_is_never_rewritten(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await on_credit(maker, shops)

    for statement in (
        "UPDATE credit_entry SET amount = 1 WHERE credit_id = :id",
        "DELETE FROM credit_entry WHERE credit_id = :id",
    ):
        async with maker() as session:
            with pytest.raises(DBAPIError, match="append-only"):
                await session.execute(text(statement), {"id": sale["credit"]["credit_id"]})


async def test_a_debt_is_found_by_name_or_by_any_form_of_its_phone(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await on_credit(maker, shops)

    async with api(maker, shops.scope(shops.primary_store)) as client:

        async def found(query: str) -> list[str]:
            response = await client.get(
                "/api/v1/credits",
                params={"store_id": str(shops.primary_store), "query": query},
            )
            return [item["id"] for item in response.json()["items"]]

        assert await found("0671234567") == [sale["credit"]["credit_id"]]
        assert await found("+380671234567") == [sale["credit"]["credit_id"]]
        assert await found("123-45") == [sale["credit"]["credit_id"]]
        assert await found("коваль") == [sale["credit"]["credit_id"]]
        assert await found("Петренко") == []
        # A name's digits are part of the name, never a phone to look for.
        assert await found("Петренко 067") == []
        assert await found("+38 (067)") == [sale["credit"]["credit_id"]]
        # Pasted from contacts between two invisible direction marks, or
        # written with dots or slashes: still a phone here, as among the
        # closed stores, never a name owing nothing (review, 2026-10-19).
        assert await found("\u202a+38 067 123 45 67\u202c") == [sale["credit"]["credit_id"]]
        assert await found("067.123.45.67") == [sale["credit"]["credit_id"]]
        assert await found("067/123/45/67") == [sale["credit"]["credit_id"]]
        assert await found("\u202a123-45\u202c") == [sale["credit"]["credit_id"]]


async def test_a_store_lists_only_its_own_debts(maker):
    shops = await make_two_shops(maker)
    ours, _, _ = await on_credit(maker, shops)
    async with api(maker, shops.scope(shops.child_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.child_store, warehouse=shops.child_warehouse, qty=2
        )
        body = sale_body(shops.child_store, shops.child_warehouse, variant, size, qty=2)
        theirs = await client.post("/api/v1/sales", json=body | {"credit": terms()}, headers=key())
    assert theirs.status_code == 201, theirs.text

    async with api(maker, shops.scope(shops.primary_store)) as client:
        listed = await client.get("/api/v1/credits", params={"store_id": str(shops.primary_store)})
    assert [item["id"] for item in listed.json()["items"]] == [ours["credit"]["credit_id"]]


async def sold_to(maker, shops: TwoShops, name: str, phone: str, paid_now: str = "1000.00"):
    """Two coats at 1500, 3000 in all, paid in part by whoever the terms name."""
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=2
        )
        body = sale_body(shops.primary_store, shops.shared_warehouse, variant, size, qty=2)
        terms_ = {"customer_name": name, "customer_phone": phone, "paid_now": paid_now}
        response = await client.post("/api/v1/sales", json=body | {"credit": terms_}, headers=key())
    assert response.status_code == 201, response.text
    return response.json()


async def customers(maker, shops: TwoShops, **params: str) -> list[dict]:
    async with api(maker, shops.scope(shops.primary_store)) as client:
        response = await client.get(
            "/api/v1/credits/customers", params={"store_id": str(shops.primary_store)} | params
        )
    assert response.status_code == 200, response.text
    return response.json()["items"]


async def test_one_phone_is_one_customer_whatever_the_name(maker):
    shops = await make_two_shops(maker)
    first = await sold_to(maker, shops, "Ірина Коваль", "+38 (067) 123-45-67")
    other = await sold_to(maker, shops, "Олег", "050 000 00 01", paid_now="500.00")
    second = await sold_to(maker, shops, "Ірина", "0671234567", paid_now="2000.00")

    # Owner decision, 2026-10-01: one phone, one customer. The newest debt
    # names her; both debts and what she owes in all are hers.
    irina, oleh = await customers(maker, shops, status="OPEN")
    assert (irina["customer_name"], irina["customer_phone"]) == ("Ірина", "0671234567")
    assert irina["phone_digits"] == "0671234567"
    assert [debt["id"] for debt in irina["credits"]] == [
        second["credit"]["credit_id"],
        first["credit"]["credit_id"],
    ]
    assert (irina["owed"], irina["open_debts"]) == ("3000.00", 2)
    assert (oleh["customer_name"], oleh["owed"]) == ("Олег", "2500.00")
    assert [debt["id"] for debt in oleh["credits"]] == [other["credit"]["credit_id"]]

    # Found by any of her debts, then all of them shown: the one written as
    # «Ірина» is the same customer as «Коваль».
    [found] = await customers(maker, shops, query="Коваль")
    assert len(found["credits"]) == 2
    # Олег's number holds a 0 and a 1; a name with them is still a name.
    assert await customers(maker, shops, query="Ірина 01") == []
    # A whole number pasted from contacts finds her here too.
    [pasted] = await customers(maker, shops, query="\u202a+38 067 123 45 67\u202c")
    assert len(pasted["credits"]) == 2

    # A payment is still taken on the debt the seller chooses.
    paid = await pay(maker, shops, second["credit"]["credit_id"], "1000.00")
    assert paid.status_code == 201, paid.text
    # Her newest open debt is now the older one, so Олег comes first.
    [_, owing] = await customers(maker, shops, status="OPEN")
    assert [debt["id"] for debt in owing["credits"]] == [first["credit"]["credit_id"]]
    assert (owing["owed"], owing["open_debts"]) == ("2000.00", 1)
    [everything, _] = await customers(maker, shops)
    assert [debt["status"] for debt in everything["credits"]] == ["SETTLED", "OPEN"]
    assert (everything["owed"], everything["open_debts"]) == ("2000.00", 1)


async def test_a_customer_is_found_by_each_word_of_a_debts_name_in_any_order(maker):
    shops = await make_two_shops(maker)
    oksana = await sold_to(maker, shops, "Оксана Петренко", "067 111 11 11")
    await sold_to(maker, shops, "Петро Оксанюк", "067 222 22 22")
    # One customer, two debts, a word of her name in each.
    iryna = await sold_to(maker, shops, "Ірина", "067 333 33 33")
    koval = await sold_to(maker, shops, "Коваль", "067 333 33 33")

    async def names(query: str) -> list[str]:
        return [found["customer_name"] for found in await customers(maker, shops, query=query)]

    # Credits task list, P1-3: each word, in any order and letter case, as
    # the till and «Повернення» read each word.
    assert await names("петренко оксана") == ["Оксана Петренко"]
    assert await names("Оксана  Петренко") == ["Оксана Петренко"]
    assert await names("ПЕТРЕНКО") == ["Оксана Петренко"]
    # A word typed twice still finds her; a space pasted from a contact,
    # not the keyboard's, still parts two words.
    assert await names("оксана оксана") == ["Оксана Петренко"]
    assert await names("петренко\u00a0оксана") == ["Оксана Петренко"]
    # Parts of words find both; a word neither name holds, none.
    assert sorted(await names("окс петр")) == ["Оксана Петренко", "Петро Оксанюк"]
    assert await names("оксана петро") == []
    # Literally: «%» and «_» are letters typed, never a pattern.
    assert await names("о%а") == []
    assert await names("о_сана") == []
    # Words of two debts do not add up: each word is in the name of one.
    assert await names("ірина коваль") == []
    # Found by one debt, the customer is shown with both.
    [found] = await customers(maker, shops, query="коваль")
    assert {debt["id"] for debt in found["credits"]} == {
        iryna["credit"]["credit_id"],
        koval["credit"]["credit_id"],
    }
    # A name's digits are part of the name, never a phone to look for.
    assert await names("Оксана 067") == []

    # The list of debts reads the same words.
    async with api(maker, shops.scope(shops.primary_store)) as client:
        listed = await client.get(
            "/api/v1/credits",
            params={"store_id": str(shops.primary_store), "query": "петренко  оксана"},
        )
    assert [item["id"] for item in listed.json()["items"]] == [oksana["credit"]["credit_id"]]


async def test_a_name_is_found_whatever_apostrophe_or_i_it_is_typed_with(maker):
    shops = await make_two_shops(maker)
    # Written on an iPhone, and with a Latin «i» for the Ukrainian «і».
    await sold_to(maker, shops, "Мар\u2019яна Коваль", "067 444 44 44")
    await sold_to(maker, shops, "Васил\u0069на", "067 555 55 55")

    async def names(query: str) -> list[str]:
        return [found["customer_name"] for found in await customers(maker, shops, query=query)]

    # Owner decision, 2026-10-18: the apostrophes Android, iPhone and
    # documents write, and those typed in their place, are one sign; a
    # Latin «i», in either case, is the Ukrainian «і».
    for apostrophe in ("'", "\u2019", "\u02bc", "`", "\u00b4", "\u2018"):
        assert await names(f"мар{apostrophe}яна") == ["Мар\u2019яна Коваль"], apostrophe
    assert await names("василіна") == ["Васил\u0069на"]
    assert await names("ВАСИЛ\u0049НА") == ["Васил\u0069на"]
    # Other letters are as typed.
    assert await names("марияна") == []


async def test_a_letter_pasted_in_two_parts_is_the_letter(maker):
    shops = await make_two_shops(maker)
    # «й» pasted as «и» and its breve; «Ї» typed as one letter.
    await sold_to(maker, shops, "Ярослав Кра\u0438\u0306ній", "067 666 66 66")
    await sold_to(maker, shops, "Мирослава \u0407жакевич", "067 777 77 77")
    # A name typed with a Latin «Ï», from a Latin keyboard.
    await sold_to(maker, shops, "\u00cfвга Король", "067 888 88 88")

    async def names(query: str) -> list[str]:
        return [found["customer_name"] for found in await customers(maker, shops, query=query)]

    # Owner decision, 2026-10-19: one letter however it was put together.
    assert await names("крайній") == ["Ярослав Кра\u0438\u0306ній"]
    assert await names("\u0456\u0308жакевич") == ["Мирослава \u0407жакевич"]
    assert await names("їжакевич") == ["Мирослава \u0407жакевич"]
    # A Latin «i» and its dots is the letter too: the fold, then one form.
    assert await names("\u0069\u0308жакевич") == ["Мирослава \u0407жакевич"]
    # A Latin «ï» typed as one sign, in either case, is «ї» too, typed or
    # stored (owner decision, 2026-10-21).
    assert await names("\u00efжакевич") == ["Мирослава \u0407жакевич"]
    assert await names("\u00cfЖАКЕВИЧ") == ["Мирослава \u0407жакевич"]
    assert await names("ївга") == ["\u00cfвга Король"]


async def test_customers_come_a_page_at_a_time(maker):
    shops = await make_two_shops(maker)
    for index in range(3):
        await sold_to(maker, shops, f"Покупець {index}", f"067000000{index}")

    async with api(maker, shops.scope(shops.primary_store)) as client:
        pages = [
            (
                await client.get(
                    "/api/v1/credits/customers",
                    params={"store_id": str(shops.primary_store), "limit": 2, "offset": offset},
                )
            ).json()
            for offset in (0, 2)
        ]
    assert [c["customer_name"] for c in pages[0]["items"]] == ["Покупець 2", "Покупець 1"]
    assert pages[0]["has_more"] is True
    assert [c["customer_name"] for c in pages[1]["items"]] == ["Покупець 0"]
    assert pages[1]["has_more"] is False


async def test_the_store_sees_what_it_is_owed_in_all(maker):
    shops = await make_two_shops(maker)

    async def summary(store: uuid.UUID, permissions=SELLER):
        async with api(maker, shops.scope(store, permissions)) as client:
            return await client.get("/api/v1/credits/summary", params={"store_id": str(store)})

    nothing = await summary(shops.primary_store)
    assert nothing.json() == {"owed": "0.00", "customers": 0, "debts": 0}

    first = await sold_to(maker, shops, "Ірина Коваль", "0671234567")
    await sold_to(maker, shops, "Ірина", "+380671234567", paid_now="2500.00")
    third = await sold_to(maker, shops, "Олег", "0500000001")
    settled = await sold_to(maker, shops, "Марта", "0930000002")
    await pay(maker, shops, settled["credit"]["credit_id"], "2000.00")
    # A debt partly paid and partly returned counts what is still owed.
    await pay(maker, shops, first["credit"]["credit_id"], "200.00")
    await give_back(maker, shops, first, 1)
    # The child store's own debts are its own.
    async with api(maker, shops.scope(shops.child_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.child_store, warehouse=shops.child_warehouse, qty=2
        )
        body = sale_body(shops.child_store, shops.child_warehouse, variant, size, qty=2)
        theirs = await client.post("/api/v1/sales", json=body | {"credit": terms()}, headers=key())
    assert theirs.status_code == 201, theirs.text

    # Owed: 300 (first: 3000 - 1200 paid - 1500 returned) + 500 + 2000; the
    # settled one counts nothing. Two customers: «Ірина» twice is one phone.
    owed = await summary(shops.primary_store)
    assert owed.json() == {"owed": "2800.00", "customers": 2, "debts": 3}

    async with api(maker, shops.scope(shops.primary_store, OWNER)) as client:
        written = await client.post(
            f"/api/v1/credits/{third['credit']['credit_id']}/write-off",
            json={"command_id": str(uuid.uuid4()), "reason": "виїхав"},
        )
    assert written.status_code == 200, written.text
    assert (await summary(shops.primary_store)).json() == {
        "owed": "800.00",
        "customers": 1,
        "debts": 2,
    }
    child = await summary(shops.child_store)
    assert child.json() == {"owed": "2000.00", "customers": 1, "debts": 1}

    # Only whoever sells in parts in that store sees it.
    unpermitted = await summary(shops.primary_store, SELLER - {Permission.SALE_CREDIT})
    assert unpermitted.status_code == 403
    async with api(maker, shops.scope(shops.child_store)) as client:
        foreign = await client.get(
            "/api/v1/credits/summary", params={"store_id": str(shops.primary_store)}
        )
    assert foreign.status_code == 403


async def arrived_order(maker, shops: TwoShops) -> str:
    """Two coats at 1500 ordered, sent and arrived at the post office."""
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=2
        )
        created = await client.post(
            "/api/v1/orders",
            json=order_body(shops.primary_store, shops.shared_warehouse, variant, size, qty=2)
            | {"carrier": "NOVA_POSHTA"},
        )
        assert created.status_code == 201, created.text
        order = created.json()["id"]
        for action in ("dispatch", "arrive"):
            moved = await client.post(
                f"/api/v1/orders/{order}/{action}", json={"command_id": str(uuid.uuid4())}
            )
            assert moved.status_code == 200, moved.text
    return order


async def collect(maker, shops: TwoShops, order: str, credit: dict | None, command=None, **kw):
    async with api(maker, shops.scope(shops.primary_store, kw.get("permissions", SELLER))) as c:
        return await c.post(
            f"/api/v1/orders/{order}/collect",
            json={"command_id": command or str(uuid.uuid4()), "payment_method": "CASH"}
            | ({"credit": credit} if credit is not None else {}),
        )


async def test_a_collected_order_may_be_paid_in_parts(maker):
    shops = await make_two_shops(maker)
    order = await arrived_order(maker, shops)
    command = str(uuid.uuid4())

    collected = await collect(maker, shops, order, terms(), command)

    assert collected.status_code == 200, collected.text
    body = collected.json()
    assert body["status"] == "COLLECTED"
    assert (body["credit"]["paid"], body["credit"]["owed"]) == ("1000.00", "2000.00")
    # The same command is answered with what it did; other terms are another
    # operation under a used command.
    assert (await collect(maker, shops, order, terms(), command)).json() == body
    conflict = await collect(maker, shops, order, terms("1500.00"), command)
    assert conflict.status_code == 409, conflict.text
    # Nor is a revoked grant handed the cached answer.
    revoked = await collect(
        maker, shops, order, terms(), command, permissions=SELLER - {Permission.SALE_CREDIT}
    )
    assert revoked.status_code == 403, revoked.text

    # A debt like any other: owed to the order's store, paid there, read back
    # on the order, and lowered first by a return of the sale.
    credit_id = body["credit"]["credit_id"]
    state = await debt(maker, shops, credit_id)
    assert (state["sale_id"], state["store_id"]) == (body["sale_id"], str(shops.primary_store))
    assert (await pay(maker, shops, credit_id, "500.00")).status_code == 201
    async with api(maker, shops.scope(shops.primary_store)) as client:
        read = (await client.get(f"/api/v1/orders/{order}")).json()
        sale = (await client.get(f"/api/v1/sales/{body['sale_id']}")).json()
    assert (read["credit"]["paid"], read["credit"]["owed"]) == ("1500.00", "1500.00")
    returned = await give_back(maker, shops, sale, 1)
    assert returned.json()["credit"] == {
        "debt_reduced": "1500.00",
        "cash_back": "0.00",
        "owed_after": "0.00",
    }


async def test_a_collected_order_paid_in_parts_follows_the_tills_rules(maker):
    shops = await make_two_shops(maker)
    order = await arrived_order(maker, shops)

    # Owner decision, 2026-10-01: above nothing at collection, as at the till.
    for credit, reason in (
        (terms("3000.00"), "PAID_IN_FULL"),
        (terms("1000.00", customer_phone="12345"), "CUSTOMER_PHONE"),
        (terms("1000.00", customer_name="   "), "CUSTOMER_NAME"),
    ):
        refused = await collect(maker, shops, order, credit)
        assert refused.status_code == 422, refused.text
        assert refused.json()["details"]["reason"] == reason
    nothing = await collect(maker, shops, order, terms("0"))
    assert nothing.status_code == 422, nothing.text
    unpermitted = await collect(
        maker, shops, order, terms(), permissions=SELLER - {Permission.SALE_CREDIT}
    )
    assert unpermitted.status_code == 403, unpermitted.text

    # Nothing of any refusal stayed: the order still waits, and is then
    # collected as an ordinary sale with no debt.
    async with api(maker, shops.scope(shops.primary_store)) as client:
        assert (await client.get(f"/api/v1/orders/{order}")).json()["status"] == "ARRIVED"
    plain = await collect(maker, shops, order, None)
    assert plain.status_code == 200, plain.text
    assert plain.json()["credit"] is None
    async with maker() as session:
        sale_id = uuid.UUID(plain.json()["sale_id"])
        assert await service.credit_for_sale(session, sale_id=sale_id) is None


async def test_only_a_collection_is_paid_in_parts(maker):
    shops = await make_two_shops(maker)
    order = await arrived_order(maker, shops)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        refused = await client.post(
            f"/api/v1/orders/{order}/arrive",
            json={"command_id": str(uuid.uuid4()), "credit": terms()},
        )
    assert refused.status_code == 422, refused.text


def test_the_seller_states_something_paid_whoever_calls() -> None:
    """The service's own bounds, for a caller that is not the HTTP API."""
    for paid in (Decimal("0"), Decimal("-1"), Decimal("0.004")):
        with pytest.raises(ValidationFailedError) as refused:
            service.terms(customer_name="Ірина", customer_phone="0671234567", paid_now=paid)
        assert refused.value.details["reason"] == "NOTHING_PAID"
    stated = service.terms(
        customer_name="  Ірина  ", customer_phone=" 067 123 45 67 ", paid_now=Decimal("10.005")
    )
    assert (stated.customer_name, stated.customer_phone, stated.paid_now) == (
        "Ірина",
        "067 123 45 67",
        Decimal("10.01"),
    )


async def test_the_downgrade_refuses_while_a_debt_is_recorded():
    from tests.integration.test_cash_schema import a_credit, a_sale
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_credit_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        await _run(config, "downgrade", "0022_shelf_shortage", database=name)
        await _run(config, "upgrade", "head", database=name)
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        shops = await make_two_shops(fresh)
        # Written as a debt recorded before the way of paying was asked: one
        # recorded with its way stops revision 0035's own downgrade first.
        async with fresh.begin() as session:
            await a_credit(session, shops, await a_sale(session, shops, shops.primary_store))
        with pytest.raises(Exception, match="A sale paid in parts is recorded"):
            await _run(config, "downgrade", "0022_shelf_shortage", database=name)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
