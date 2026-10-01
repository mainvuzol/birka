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
            json={"command_id": command_id or str(uuid.uuid4()), "amount": amount},
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
    # The phone stays out of the audit log, and out of the receipt.
    assert "067" not in str(entry.after)
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
    assert too_much.json()["details"] == {"reason": "MORE_THAN_OWED", "owed": "2000.00"}
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
            json={"command_id": str(uuid.uuid4()), "amount": "100.00"},
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
            first, scope=scope, credit_id=credit_id, command_id=uuid.uuid4(), amount=Decimal("1500")
        )

        async def second():
            async with maker.begin() as session:
                return await service.pay(
                    session,
                    scope=scope,
                    credit_id=credit_id,
                    command_id=uuid.uuid4(),
                    amount=Decimal("1500"),
                )

        meanwhile = asyncio.create_task(second())
        await asyncio.sleep(0.5)
        # It waits for the first payment to end, then sees what is left.
        assert not meanwhile.done()

    with pytest.raises(ValidationFailedError) as refused:
        await meanwhile
    assert refused.value.details == {"reason": "MORE_THAN_OWED", "owed": "500.00"}


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
        assert await found("123-45") == [sale["credit"]["credit_id"]]
        assert await found("коваль") == [sale["credit"]["credit_id"]]
        assert await found("Петренко") == []


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
        await on_credit(fresh, shops)
        with pytest.raises(Exception, match="A sale paid in parts is recorded"):
            await _run(config, "downgrade", "0022_shelf_shortage", database=name)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
