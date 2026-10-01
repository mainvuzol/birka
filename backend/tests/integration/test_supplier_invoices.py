"""What a store owes its suppliers (owner decisions, 2026-10-01), over HTTP
against real PostgreSQL.

- An invoice is recorded on its own: a supplier from the list, the sum on
  it, anything from nothing to all of it paid at once, a note.
- Each invoice is its own debt, paid in parts with no schedule, never more
  than is owed. Each store keeps its own; the owner and managers do it.
- Goods returned to that supplier are set off against an invoice, for the
  sum the supplier counted; one return against several invoices if need
  be. While a set-off stands, the return is not cancelled.
- A payment, a set-off or the invoice itself recorded by mistake is
  cancelled, saying why — the invoice only once nothing on it stands.
- The owner writes off what is left, saying why. That is final.
- While a store does not trade, any store of the network that trades pays
  its invoices; the network's owner may write one off.

All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.suppliers.models import SupplierInvoiceEntry
from tests.conftest import requires_database
from tests.integration.test_damaged_units import damaged_bin, listed, step
from tests.integration.test_shared_warehouse import TwoShops, api, make_two_shops, quantity_at
from tests.integration.test_store_states import as_, network, set_state
from tests.integration.test_supplier_returns import cancel, coats, document, send, supplier

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
OWNER = DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def invoice_body(
    store: uuid.UUID,
    supplier_id: str,
    amount: str,
    paid_now: str = "0",
    *,
    note: str | None = "накладна № 17",
    command_id: str | None = None,
) -> dict:
    return {
        "command_id": command_id or str(uuid.uuid4()),
        "store_id": str(store),
        "supplier_id": supplier_id,
        "amount": amount,
        "paid_now": paid_now,
        "note": note,
    }


async def record(maker, shops: TwoShops, payload: dict, permissions=MANAGER):
    store = uuid.UUID(payload["store_id"])
    async with api(maker, shops.scope(store, permissions)) as client:
        return await client.post("/api/v1/supplier-invoices", json=payload)


async def act(
    maker,
    shops: TwoShops,
    invoice_id: str,
    path: str,
    payload: dict,
    permissions=MANAGER,
    store: uuid.UUID | None = None,
):
    """A command on one invoice, from the primary store unless told."""
    async with api(maker, shops.scope(store or shops.primary_store, permissions)) as client:
        return await client.post(f"/api/v1/supplier-invoices/{invoice_id}/{path}", json=payload)


def money(amount: str, command: str | None = None) -> dict:
    return {"command_id": command or str(uuid.uuid4()), "amount": amount}


async def page(maker, shops: TwoShops, store: uuid.UUID | None = None, **params) -> list[dict]:
    store = store or shops.primary_store
    async with api(maker, shops.scope(store, MANAGER)) as client:
        answer = await client.get(
            "/api/v1/supplier-invoices", params={"store_id": str(store)} | params
        )
    assert answer.status_code == 200, answer.text
    return answer.json()["items"]


async def summary(maker, shops: TwoShops, store: uuid.UUID | None = None) -> dict:
    store = store or shops.primary_store
    async with api(maker, shops.scope(store, MANAGER)) as client:
        answer = await client.get(
            "/api/v1/supplier-invoices/summary", params={"store_id": str(store)}
        )
    assert answer.status_code == 200, answer.text
    return answer.json()


async def test_an_invoice_is_paid_in_parts_and_settled(maker):
    shops = await make_two_shops(maker)
    belardi = (await supplier(maker, shops)).json()["id"]
    arno = (await supplier(maker, shops, "Арно")).json()["id"]

    # Never a seller's business.
    async with api(maker, shops.scope(shops.primary_store, SELLER)) as client:
        for path in ("/api/v1/supplier-invoices", "/api/v1/supplier-invoices/summary"):
            seen = await client.get(path, params={"store_id": str(shops.primary_store)})
            assert seen.status_code == 403, seen.text
    seller = await record(
        maker, shops, invoice_body(shops.primary_store, belardi, "100.00"), SELLER
    )
    assert seller.status_code == 403, seller.text

    command = str(uuid.uuid4())
    payload = invoice_body(shops.primary_store, belardi, "10000.00", command_id=command)
    recorded = await record(maker, shops, payload)
    assert recorded.status_code == 201, recorded.text
    body = recorded.json()
    assert (body["status"], body["amount"], body["owed"], body["paid"], body["entries"]) == (
        "OPEN",
        "10000.00",
        "10000.00",
        "0.00",
        [],
    )
    assert (body["supplier"]["name"], body["note"], body["closed_at"]) == (
        "Беларді",
        "накладна № 17",
        None,
    )
    # The same command is answered with the invoice; another body is refused,
    # and someone who may not is refused before any answer.
    assert (await record(maker, shops, payload)).json() == body
    assert (await record(maker, shops, payload, SELLER)).status_code == 403
    changed = await record(
        maker, shops, invoice_body(shops.primary_store, belardi, "9000.00", command_id=command)
    )
    assert changed.status_code == 409, changed.text

    # More than the invoice says is never paid at once; all of it settles it.
    over = await record(maker, shops, invoice_body(shops.primary_store, arno, "500.00", "500.01"))
    assert over.json()["details"]["reason"] == "MORE_THAN_OWED"
    for amount in ("0", "-1"):
        nothing = await record(maker, shops, invoice_body(shops.primary_store, arno, amount))
        assert nothing.status_code == 422, nothing.text
    paid_up = await record(maker, shops, invoice_body(shops.primary_store, arno, "800.00", "800"))
    assert paid_up.status_code == 201, paid_up.text
    assert (paid_up.json()["status"], paid_up.json()["owed"], paid_up.json()["paid"]) == (
        "SETTLED",
        "0.00",
        "800.00",
    )
    assert paid_up.json()["closed_at"] is not None
    assert [e["kind"] for e in paid_up.json()["entries"]] == ["PAYMENT"]
    partly = await record(maker, shops, invoice_body(shops.primary_store, arno, "3000.00", "1000"))
    assert partly.json()["owed"] == "2000.00"

    invoice_id = body["id"]
    pay_command = str(uuid.uuid4())
    paid = await act(maker, shops, invoice_id, "payments", money("4000", pay_command))
    assert paid.status_code == 201, paid.text
    assert (paid.json()["owed"], paid.json()["paid"]) == ("6000.00", "4000.00")
    assert paid.json()["last_payment_at"] is not None
    assert (await act(maker, shops, invoice_id, "payments", money("4000", pay_command))).json() == (
        paid.json()
    )
    assert (
        await act(maker, shops, invoice_id, "payments", money("4000", pay_command), SELLER)
    ).status_code == 403
    other = await act(maker, shops, invoice_id, "payments", money("3999", pay_command))
    assert other.status_code == 409, other.text
    # Never more than is owed.
    over = await act(maker, shops, invoice_id, "payments", money("6000.01"))
    assert over.json()["details"] == {"reason": "MORE_THAN_OWED", "owed": "6000.00"}

    owes = await summary(maker, shops)
    assert owes["owed"] == "8000.00" and owes["invoices"] == 2
    assert [(s["supplier"]["name"], s["owed"], s["invoices"]) for s in owes["suppliers"]] == [
        ("Беларді", "6000.00", 1),
        ("Арно", "2000.00", 1),
    ]

    settled = await act(maker, shops, invoice_id, "payments", money("6000"))
    assert (settled.json()["status"], settled.json()["owed"]) == ("SETTLED", "0.00")
    late = await act(maker, shops, invoice_id, "payments", money("1"))
    assert late.json()["details"]["reason"] == "NOT_OWED"
    owes = await summary(maker, shops)
    assert [(s["supplier"]["name"], s["owed"]) for s in owes["suppliers"]] == [("Арно", "2000.00")]

    # Each store its own.
    theirs = await record(maker, shops, invoice_body(shops.child_store, belardi, "700.00"))
    assert theirs.status_code == 201, theirs.text
    assert [i["id"] for i in await page(maker, shops, supplier_id=belardi)] == [invoice_id]
    assert [i["id"] for i in await page(maker, shops, status="OPEN")] == [partly.json()["id"]]
    assert [i["id"] for i in await page(maker, shops)] == [
        partly.json()["id"],
        paid_up.json()["id"],
        invoice_id,
    ]
    assert [i["id"] for i in await page(maker, shops, shops.child_store)] == [theirs.json()["id"]]
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        assert (
            await client.get(
                "/api/v1/supplier-invoices", params={"store_id": str(shops.child_store)}
            )
        ).status_code == 403
    assert (
        await act(maker, shops, theirs.json()["id"], "payments", money("100"))
    ).status_code == 403

    # Another network's supplier and invoice are not reached.
    foreign = await make_two_shops(maker)
    stranger = (await supplier(maker, foreign, "Чужий")).json()["id"]
    assert (
        await record(maker, shops, invoice_body(shops.primary_store, stranger, "10"))
    ).status_code == 404
    async with api(maker, foreign.scope(foreign.primary_store, MANAGER)) as client:
        assert (
            await client.post(
                f"/api/v1/supplier-invoices/{partly.json()['id']}/payments", json=money("1")
            )
        ).status_code == 404


async def test_whoever_records_invoices_keeps_the_list_of_suppliers(maker):
    shops = await make_two_shops(maker)
    bookkeeper = SELLER | {Permission.SUPPLIER_DEBT}
    async with api(maker, shops.scope(shops.primary_store, bookkeeper)) as client:
        added = await client.post(
            "/api/v1/suppliers", json={"store_id": str(shops.primary_store), "name": "Арно"}
        )
        assert added.status_code == 201, added.text
        listed_ = await client.get(
            "/api/v1/suppliers", params={"store_id": str(shops.primary_store)}
        )
        assert [s["name"] for s in listed_.json()] == ["Арно"]
        # Returning goods stays someone else's.
        assert (
            await client.get(
                "/api/v1/supplier-returns", params={"store_id": str(shops.primary_store)}
            )
        ).status_code == 403


async def test_two_payments_in_one_instant_never_pay_more_than_is_owed(maker):
    shops = await make_two_shops(maker)
    arno = (await supplier(maker, shops, "Арно")).json()["id"]
    invoice_id = (
        await record(maker, shops, invoice_body(shops.primary_store, arno, "1000.00"))
    ).json()["id"]
    answers = await asyncio.gather(
        *(act(maker, shops, invoice_id, "payments", money("700")) for _ in range(2))
    )
    assert sorted(answer.status_code for answer in answers) == [201, 422]
    [invoice] = await page(maker, shops)
    assert (invoice["owed"], invoice["paid"]) == ("300.00", "700.00")


async def test_goods_returned_are_set_off_and_their_return_waits_for_it(maker):
    shops = await make_two_shops(maker)
    variant, size = await coats(maker, shops, qty=5)
    belardi = (await supplier(maker, shops)).json()["id"]
    arno = (await supplier(maker, shops, "Арно")).json()["id"]
    returned = await send(maker, shops, document(shops, belardi, (variant, size, 2)))
    assert returned.status_code == 201, returned.text
    return_id = returned.json()["id"]
    assert returned.json()["set_offs"] == []
    to_arno = (await send(maker, shops, document(shops, arno, (variant, size, 1)))).json()["id"]
    async with api(maker, shops.scope(shops.child_store, MANAGER)) as client:
        theirs = await client.post(
            "/api/v1/supplier-returns",
            json=document(shops, belardi, (variant, size, 1))
            | {"store_id": str(shops.child_store)},
        )
    assert theirs.status_code == 201, theirs.text

    first = (
        await record(maker, shops, invoice_body(shops.primary_store, belardi, "5000.00"))
    ).json()["id"]
    second = (
        await record(maker, shops, invoice_body(shops.primary_store, belardi, "400.00"))
    ).json()["id"]

    def counted(supplier_return_id: str, amount: str, command: str | None = None) -> dict:
        return money(amount, command) | {"supplier_return_id": supplier_return_id}

    # Not by a seller; not another supplier's goods, nor another store's.
    assert (
        await act(maker, shops, first, "set-offs", counted(return_id, "1500"), SELLER)
    ).status_code == 403
    wrong = await act(maker, shops, first, "set-offs", counted(to_arno, "1500"))
    assert wrong.json()["details"]["reason"] == "OTHER_SUPPLIER"
    assert (
        await act(maker, shops, first, "set-offs", counted(theirs.json()["id"], "1500"))
    ).status_code == 404
    too_much = await act(maker, shops, second, "set-offs", counted(return_id, "400.01"))
    assert too_much.json()["details"]["reason"] == "MORE_THAN_OWED"

    command = str(uuid.uuid4())
    set_off = await act(maker, shops, first, "set-offs", counted(return_id, "1500", command))
    assert set_off.status_code == 201, set_off.text
    assert (set_off.json()["owed"], set_off.json()["set_off"]) == ("3500.00", "1500.00")
    [entry] = set_off.json()["entries"]
    assert (entry["kind"], entry["supplier_return_id"]) == ("SET_OFF", return_id)
    replayed = await act(maker, shops, first, "set-offs", counted(return_id, "1500", command))
    assert replayed.json() == set_off.json()
    # The rest of what the supplier counted, against another invoice.
    rest = await act(maker, shops, second, "set-offs", counted(return_id, "400"))
    assert rest.json()["status"] == "SETTLED"

    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        items = (
            await client.get(
                "/api/v1/supplier-returns", params={"store_id": str(shops.primary_store)}
            )
        ).json()["items"]
    [listed_] = [item for item in items if item["id"] == return_id]
    assert [(s["invoice_id"], s["amount"]) for s in listed_["set_offs"]] == [
        (first, "1500.00"),
        (second, "400.00"),
    ]

    # The goods cannot come back while the supplier counts them.
    refused = await cancel(maker, shops, return_id)
    assert refused.status_code == 422, refused.text
    assert refused.json()["details"] == {
        "reason": "SET_OFF",
        "set_offs": [
            {"invoice_id": first, "amount": "1500.00"},
            {"invoice_id": second, "amount": "400.00"},
        ],
    }
    async with maker() as session:
        # Five, less the two, Arno's one and the child store's one.
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 1

    for invoice_id, body in ((first, set_off.json()), (second, rest.json())):
        [entry] = [e for e in body["entries"] if e["kind"] == "SET_OFF"]
        assert (
            await act(
                maker,
                shops,
                invoice_id,
                f"entries/{entry['id']}/cancel",
                {"reason": "постачальник не зарахував"},
                SELLER,
            )
        ).status_code == 403
        undone = await act(
            maker,
            shops,
            invoice_id,
            f"entries/{entry['id']}/cancel",
            {"reason": "постачальник не зарахував"},
        )
        assert undone.status_code == 200, undone.text
    assert undone.json()["status"] == "OPEN" and undone.json()["owed"] == "400.00"

    back = await cancel(maker, shops, return_id)
    assert back.status_code == 200, back.text
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 3
    # A cancelled return is not counted any more.
    late = await act(maker, shops, first, "set-offs", counted(return_id, "100"))
    assert late.json()["details"]["reason"] == "RETURN_CANCELLED"


async def test_a_unit_from_the_bin_comes_back_only_once_its_set_off_is_cancelled(maker):
    shops, *_ = await damaged_bin(maker)
    belardi = (await supplier(maker, shops)).json()["id"]
    [unit] = await listed(maker, shops)
    assert (await step(maker, shops, unit["id"], "take")).status_code == 200
    assert (await step(maker, shops, unit["id"], "confirm", {"note": "брак"})).status_code == 200
    gone = await step(
        maker,
        shops,
        unit["id"],
        "return-to-supplier",
        {"supplier_id": belardi, "note": None},
        permissions=MANAGER,
    )
    assert gone.json()["status"] == "SUPPLIER", gone.text
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        [document_] = (
            await client.get(
                "/api/v1/supplier-returns", params={"store_id": str(shops.primary_store)}
            )
        ).json()["items"]
    invoice_id = (
        await record(maker, shops, invoice_body(shops.primary_store, belardi, "2000.00"))
    ).json()["id"]
    counted = await act(
        maker,
        shops,
        invoice_id,
        "set-offs",
        money("900") | {"supplier_return_id": document_["id"]},
    )
    assert counted.status_code == 201, counted.text

    payload = {"supplier_return_id": document_["id"], "reason": "постачальник відмовив"}
    refused = await step(
        maker, shops, unit["id"], "cancel-supplier-return", payload, permissions=MANAGER
    )
    assert refused.json()["details"]["reason"] == "SET_OFF", refused.text
    assert await listed(maker, shops) == []

    [entry] = counted.json()["entries"]
    assert (
        await act(maker, shops, invoice_id, f"entries/{entry['id']}/cancel", {"reason": "ні"})
    ).status_code == 200
    back = await step(
        maker, shops, unit["id"], "cancel-supplier-return", payload, permissions=MANAGER
    )
    assert back.json()["status"] == "CONFIRMED", back.text


async def test_mistakes_are_cancelled_saying_why(maker):
    shops = await make_two_shops(maker)
    arno = (await supplier(maker, shops, "Арно")).json()["id"]
    recorded = await record(maker, shops, invoice_body(shops.primary_store, arno, "3000", "1000"))
    invoice_id = recorded.json()["id"]
    [first] = recorded.json()["entries"]

    # Not while a payment on it stands: no money disappears by accident.
    standing = await act(maker, shops, invoice_id, "cancel", {"reason": "не та сума"})
    assert standing.status_code == 422, standing.text
    assert standing.json()["details"] == {"reason": "ENTRIES_STAND", "entry_ids": [first["id"]]}

    path = f"entries/{first['id']}/cancel"
    assert (await act(maker, shops, invoice_id, path, {"reason": "   "})).status_code == 422
    assert (
        await act(maker, shops, invoice_id, f"entries/{uuid.uuid4()}/cancel", {"reason": "x"})
    ).status_code == 404
    undone = await act(maker, shops, invoice_id, path, {"reason": "гроші не віддали"})
    assert undone.status_code == 200, undone.text
    assert (undone.json()["owed"], undone.json()["paid"]) == ("3000.00", "0.00")
    [entry] = undone.json()["entries"]
    assert (entry["amount"], entry["cancelled"]["reason"]) == ("1000.00", "гроші не віддали")
    # Once: again, the invoice as it is; never by a seller.
    assert (await act(maker, shops, invoice_id, path, {"reason": "ще раз"})).json() == undone.json()
    assert (
        await act(maker, shops, invoice_id, path, {"reason": "ще раз"}, SELLER)
    ).status_code == 403

    # A settled invoice owes again when its payment is cancelled.
    settled = await act(maker, shops, invoice_id, "payments", money("3000"))
    assert settled.json()["status"] == "SETTLED"
    [_, last] = settled.json()["entries"]
    reopened = await act(
        maker, shops, invoice_id, f"entries/{last['id']}/cancel", {"reason": "двічі"}
    )
    assert (reopened.json()["status"], reopened.json()["owed"], reopened.json()["closed_at"]) == (
        "OPEN",
        "3000.00",
        None,
    )

    assert (
        await act(maker, shops, invoice_id, "cancel", {"reason": "не та сума"}, SELLER)
    ).status_code == 403
    gone = await act(maker, shops, invoice_id, "cancel", {"reason": "не та сума"})
    assert gone.status_code == 200, gone.text
    assert (gone.json()["status"], gone.json()["owed"], gone.json()["cancelled"]["reason"]) == (
        "CANCELLED",
        "0.00",
        "не та сума",
    )
    assert (await act(maker, shops, invoice_id, "cancel", {"reason": "ще"})).json() == gone.json()
    assert (await act(maker, shops, invoice_id, "payments", money("1"))).json()["details"][
        "reason"
    ] == "NOT_OWED"
    assert (await summary(maker, shops))["owed"] == "0.00"


async def test_the_owner_writes_off_what_is_left_for_good(maker):
    shops = await make_two_shops(maker)
    arno = (await supplier(maker, shops, "Арно")).json()["id"]
    recorded = await record(maker, shops, invoice_body(shops.primary_store, arno, "2500", "500"))
    invoice_id = recorded.json()["id"]
    [payment] = recorded.json()["entries"]

    def forgiven(command: str | None = None, reason: str = "постачальник пробачив") -> dict:
        return {"command_id": command or str(uuid.uuid4()), "reason": reason}

    assert (
        await act(maker, shops, invoice_id, "write-off", forgiven(), MANAGER)
    ).status_code == 403
    assert (
        await act(maker, shops, invoice_id, "write-off", forgiven(reason=" "), OWNER)
    ).status_code == 422
    command = str(uuid.uuid4())
    written = await act(maker, shops, invoice_id, "write-off", forgiven(command), OWNER)
    assert written.status_code == 200, written.text
    body = written.json()
    assert (body["status"], body["owed"], body["written_off"], body["paid"]) == (
        "WRITTEN_OFF",
        "0.00",
        "2000.00",
        "500.00",
    )
    assert body["entries"][-1]["note"] == "постачальник пробачив"
    replayed = await act(maker, shops, invoice_id, "write-off", forgiven(command), OWNER)
    assert replayed.json() == body
    again = await act(maker, shops, invoice_id, "write-off", forgiven(), OWNER)
    assert again.json()["details"]["reason"] == "NOT_OWED"

    # Final: neither it, nor what came before it, nor the invoice is undone.
    for entry in (payment, body["entries"][-1]):
        kept = await act(
            maker, shops, invoice_id, f"entries/{entry['id']}/cancel", {"reason": "помилка"}, OWNER
        )
        assert kept.json()["details"]["reason"] == "WRITTEN_OFF", kept.text
    kept = await act(maker, shops, invoice_id, "cancel", {"reason": "помилка"}, OWNER)
    assert kept.json()["details"]["reason"] == "WRITTEN_OFF"


async def test_another_store_pays_while_the_one_that_owes_does_not_trade(maker):
    net = await network(maker)
    shops = net.shops
    async with as_(maker, net, net.manager) as client:
        added = await client.post(
            "/api/v1/suppliers", json={"store_id": str(shops.child_store), "name": "Арно"}
        )
        recorded = await client.post(
            "/api/v1/supplier-invoices",
            json=invoice_body(shops.child_store, added.json()["id"], "1200.00"),
        )
    assert recorded.status_code == 201, recorded.text
    invoice_id = recorded.json()["id"]
    elsewhere = {"store_id": str(shops.primary_store), "elsewhere": "true"}

    async with as_(maker, net, net.manager) as client:
        # While it trades, its invoices are its own business.
        early = await client.post(
            f"/api/v1/supplier-invoices/{invoice_id}/payments",
            json=money("100") | {"store_id": str(shops.primary_store)},
        )
        assert early.json()["details"]["reason"] == "PAID_WHERE_OWED", early.text
        unseen = await client.get("/api/v1/supplier-invoices", params=elsewhere)
        assert unseen.json()["items"] == []
    async with as_(maker, net, net.seller) as client:
        assert (await client.get("/api/v1/supplier-invoices", params=elsewhere)).status_code == 403

    assert (await set_state(maker, net, "BLOCKED")).status_code == 200
    async with as_(maker, net, net.child_owner) as client:
        blocked = await client.post(
            f"/api/v1/supplier-invoices/{invoice_id}/payments", json=money("100")
        )
        assert blocked.json()["code"] == "STORE_NOT_TRADING", blocked.text
        refused = await client.post(
            "/api/v1/supplier-invoices",
            json=invoice_body(shops.child_store, added.json()["id"], "10"),
        )
        assert refused.json()["code"] == "STORE_NOT_TRADING"

    async with as_(maker, net, net.manager) as client:
        [found] = (await client.get("/api/v1/supplier-invoices", params=elsewhere)).json()["items"]
        assert (found["id"], found["store_name"], found["store_state"], found["owed"]) == (
            invoice_id,
            "Дочірній",
            "BLOCKED",
            "1200.00",
        )
        # Its own store is still not where it is paid.
        at_home = await client.post(
            f"/api/v1/supplier-invoices/{invoice_id}/payments", json=money("100")
        )
        assert at_home.json()["code"] == "STORE_NOT_TRADING"
        paid = await client.post(
            f"/api/v1/supplier-invoices/{invoice_id}/payments",
            json=money("200") | {"store_id": str(shops.primary_store)},
        )
        assert paid.status_code == 201, paid.text
        assert (paid.json()["store_id"], paid.json()["owed"]) == (str(shops.child_store), "1000.00")
        [entry] = paid.json()["entries"]
        assert entry["paid_at"] == "Основний"
        # A payment made there by mistake is cancelled there too.
        undone = await client.post(
            f"/api/v1/supplier-invoices/{invoice_id}/entries/{entry['id']}/cancel",
            json={"reason": "не той магазин", "store_id": str(shops.primary_store)},
        )
        assert undone.status_code == 200, undone.text
        assert undone.json()["owed"] == "1200.00"
        # The network's manager writes off nothing.
        assert (
            await client.post(
                f"/api/v1/supplier-invoices/{invoice_id}/write-off",
                json={"command_id": str(uuid.uuid4()), "reason": "пробачив"},
            )
        ).status_code == 403
    async with maker() as session:
        stored = await session.scalar(
            select(SupplierInvoiceEntry.paid_at_store_id).where(
                SupplierInvoiceEntry.id == uuid.UUID(entry["id"])
            )
        )
    assert stored == shops.primary_store

    # The network's owner writes off what the store that does not trade owes.
    async with as_(maker, net, net.owner) as client:
        written = await client.post(
            f"/api/v1/supplier-invoices/{invoice_id}/write-off",
            json={"command_id": str(uuid.uuid4()), "reason": "пробачив"},
        )
    assert written.json()["status"] == "WRITTEN_OFF", written.text


async def test_an_open_invoice_does_not_keep_a_store_from_the_archive(maker):
    net = await network(maker)
    async with as_(maker, net, net.manager) as client:
        added = await client.post(
            "/api/v1/suppliers", json={"store_id": str(net.shops.child_store), "name": "Арно"}
        )
        recorded = await client.post(
            "/api/v1/supplier-invoices",
            json=invoice_body(net.shops.child_store, added.json()["id"], "300.00"),
        )
    assert recorded.status_code == 201, recorded.text
    archived = await set_state(maker, net, "ARCHIVED")
    assert archived.status_code == 200, archived.text
    async with as_(maker, net, net.manager) as client:
        [still] = (
            await client.get(
                "/api/v1/supplier-invoices",
                params={"store_id": str(net.shops.primary_store), "elsewhere": "true"},
            )
        ).json()["items"]
    assert (still["store_state"], still["owed"]) == ("ARCHIVED", "300.00")


async def test_the_migration_gives_the_debts_to_whoever_returns_goods():
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_invoices_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "0026_supplier_returns", database=name)
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        shops = await make_two_shops(fresh)
        roles: dict[str, uuid.UUID] = {}
        async with engine.begin() as connection:
            for code, held in (
                ("BUYER", "supplier:return"),
                ("CASHIER", "sale:create"),
                ("BOSS", "credit:write_off"),
            ):
                roles[code] = uuid.uuid4()
                await connection.execute(
                    text(
                        "INSERT INTO role (id, organization_id, code, name, is_system, "
                        "created_at) VALUES (:id, :org, :code, :code, false, now())"
                    ),
                    {"id": roles[code], "org": shops.organization_id, "code": code},
                )
                await connection.execute(
                    text(
                        "INSERT INTO role_permission (role_id, permission_code) VALUES (:id, :held)"
                    ),
                    {"id": roles[code], "held": held},
                )
        await _run(config, "upgrade", "head", database=name)

        async def granted() -> dict[str, set[str]]:
            async with engine.connect() as connection:
                return {
                    code: set(
                        (
                            await connection.scalars(
                                text(
                                    "SELECT permission_code FROM role_permission "
                                    "WHERE role_id = :id AND permission_code IN "
                                    "('supplier:debt', 'supplier:write_off')"
                                ),
                                {"id": role_id},
                            )
                        ).all()
                    )
                    for code, role_id in roles.items()
                }

        assert await granted() == {
            "BUYER": {"supplier:debt"},
            "CASHIER": set(),
            "BOSS": {"supplier:write_off"},
        }
        await _run(config, "downgrade", "0026_supplier_returns", database=name)
        assert await granted() == {"BUYER": set(), "CASHIER": set(), "BOSS": set()}
        await _run(config, "upgrade", "head", database=name)
        arno = (await supplier(fresh, shops, "Арно")).json()["id"]
        assert (
            await record(fresh, shops, invoice_body(shops.primary_store, arno, "10"))
        ).status_code == 201
        with pytest.raises(Exception, match="Invoices are recorded"):
            await _run(config, "downgrade", "0026_supplier_returns", database=name)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
