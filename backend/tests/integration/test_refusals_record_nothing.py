"""A refusal that proves nothing was recorded says so (ADR-0013 §1), over
HTTP against real PostgreSQL.

Every refusal decided after a command's `command_id` was looked up under its
lock, and found nothing, carries `details.recorded = false`: the lock and the
lookup prove this command wrote nothing, and the transaction rolls back. A
phone that sent the command and never heard the answer keeps the attempt
until something definite comes back; this is what settles it. Without it, a
kept attempt refused on resend stayed on the phone, blocked every tab, and
pressed again days later did whatever the stock allowed then.

Each case sends the attempt, then the identical attempt again, as the phone
does: both are refused the same way, and both say nothing was recorded.

What never says it:
- a refusal of the command's identity (`IDEMPOTENCY_CONFLICT`), which the
  lookup itself raises for a command that may have recorded something, and
  which a lookup nested in another command's region raises for another
  command;
- a refusal decided before the lookup, from the request alone or the
  caller's rights: it proves nothing about an earlier attempt. Among them a
  command resent after its store was blocked: the phone keeps it until the
  store trades again (owner decision, 2026-10-08);
- a replay the lookup found but refuses to its sender: that was recorded.

And a command that was recorded is still answered with what it did, however
the debt or the shelf changed since. The sale's own refusals are pinned
beside the sale command.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.core.errors import ValidationFailedError
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.credit import service as credit_service
from app.modules.sales.models import Sale
from app.modules.sales.payment import PaymentMethod
from app.modules.tenancy.models import Store
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import (
    TwoShops,
    api,
    key,
    make_two_shops,
    order_body,
    sale_body,
    stock_a_coat,
)
from tests.integration.test_snapshot_import import (
    LIST,
    client_for,
    create_product,
    idempotent,
    seed_world,
)

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
OWNER = DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]

Send = Callable[[], Awaitable[httpx.Response]]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


# --- how a refusal is read -------------------------------------------------------------


async def refused_twice(
    send: Send, http_status: int, code: str, /, **details: Any
) -> dict[str, Any]:
    """The attempt and the identical attempt again: each refused with `code`,
    saying nothing was recorded, the second exactly as the first."""
    first = await send()
    again = await send()
    for response in (first, again):
        assert response.status_code == http_status, response.text
        body = response.json()
        assert body["code"] == code, body
        assert body["details"]["recorded"] is False, body
        for name, value in details.items():
            assert body["details"][name] == value, body
    assert again.json() == first.json()
    return dict(first.json()["details"])


def never_claimed(response: httpx.Response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["code"] == code
    assert "recorded" not in response.json().get("details", {})


async def block(maker: async_sessionmaker[AsyncSession], store_id: uuid.UUID) -> None:
    """The owner blocks the store after the seller's request was let in: the
    scope a request carries was built before, and still names the store."""
    async with maker.begin() as session:
        await session.execute(update(Store).where(Store.id == store_id).values(state="BLOCKED"))


async def coat(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, qty: int, *, store=None
) -> tuple[str, str]:
    store = store or shops.primary_store
    async with api(maker, shops.scope(store, MANAGER)) as client:
        return await stock_a_coat(
            client, shops, store=store, warehouse=shops.shared_warehouse, qty=qty
        )


def terms(paid_now: str = "1000.00") -> dict[str, str]:
    return {
        "customer_name": "Ірина Коваль",
        "customer_phone": "+38 (067) 123-45-67",
        "paid_now": paid_now,
    }


async def sold_in_parts(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, *, store=None
) -> dict[str, Any]:
    """Two coats at 1500, 3000 in all, 1000 paid now, 2000 owed."""
    store = store or shops.primary_store
    variant, size = await coat(maker, shops, 2, store=store)
    async with api(maker, shops.scope(store)) as client:
        sold = await client.post(
            "/api/v1/sales",
            json=sale_body(store, shops.shared_warehouse, variant, size, qty=2)
            | {"credit": terms()},
            headers=key(),
        )
    assert sold.status_code == 201, sold.text
    return sold.json()


def payment(command: str, amount: str, at: uuid.UUID | None = None) -> dict[str, Any]:
    return {"command_id": command, "amount": amount, "payment_method": "CASH"} | (
        {"store_id": str(at)} if at else {}
    )


async def pay(
    maker, shops: TwoShops, credit_id: str, body: dict[str, Any], *, store=None
) -> httpx.Response:
    async with api(maker, shops.scope(store or shops.primary_store)) as client:
        return await client.post(f"/api/v1/credits/{credit_id}/payments", json=body)


# --- the empty shelf ------------------------------------------------------------------


async def test_an_empty_shelf_in_a_store_blocked_meanwhile(maker):
    """Blocked while the report runs: the scope still names the store, so
    the stock lock refuses it, after the lookup. A report resent after the
    block is refused by the scope first, before the lookup, with no
    `recorded`, and the phone keeps it until the store trades again (owner
    decision, 2026-10-08; ADR-0013 §1)."""
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, 1)
    body = {
        "store_id": str(shops.primary_store),
        "command_id": str(uuid.uuid4()),
        "lines": [
            {
                "source_location_id": str(shops.shared_warehouse),
                "product_variant_id": variant,
                "size_id": size,
                "quantity": 1,
            }
        ],
    }
    await block(maker, shops.primary_store)

    async def send() -> httpx.Response:
        async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
            return await client.post("/api/v1/shelf-shortages", json=body)

    await refused_twice(send, 403, "STORE_NOT_TRADING", state="BLOCKED")


# --- a debt's payments and its write-off ----------------------------------------------


async def test_a_payment_when_nothing_is_owed_any_more(maker):
    """A colleague took the rest meanwhile: the seller gives the money back
    (owner decision, 2026-10-04)."""
    shops = await make_two_shops(maker)
    credit_id = (await sold_in_parts(maker, shops))["credit"]["credit_id"]
    paid_off = await pay(maker, shops, credit_id, payment(str(uuid.uuid4()), "2000.00"))
    assert paid_off.status_code == 201, paid_off.text
    late = payment(str(uuid.uuid4()), "500.00")

    await refused_twice(
        lambda: pay(maker, shops, credit_id, late), 422, "VALIDATION_ERROR", reason="NOT_OWED"
    )


async def test_a_payment_of_more_than_is_owed(maker):
    shops = await make_two_shops(maker)
    credit_id = (await sold_in_parts(maker, shops))["credit"]["credit_id"]
    paid = await pay(maker, shops, credit_id, payment(str(uuid.uuid4()), "1500.00"))
    assert paid.status_code == 201, paid.text
    late = payment(str(uuid.uuid4()), "1000.00")

    details = await refused_twice(
        lambda: pay(maker, shops, credit_id, late), 422, "VALIDATION_ERROR", reason="MORE_THAN_OWED"
    )
    assert details["owed"] == "500.00"


async def test_a_payment_taken_elsewhere_once_the_selling_store_trades_again(maker):
    """Taken on paper in another store while the selling store was blocked,
    typed after it opened again: a manager decides (owner decision,
    2026-10-07). Here the selling store trades throughout."""
    shops = await make_two_shops(maker)
    credit_id = (await sold_in_parts(maker, shops, store=shops.child_store))["credit"]["credit_id"]
    elsewhere = payment(str(uuid.uuid4()), "100.00", at=shops.primary_store)

    await refused_twice(
        lambda: pay(maker, shops, credit_id, elsewhere),
        422,
        "VALIDATION_ERROR",
        reason="PAID_WHERE_SOLD",
        store_id=str(shops.child_store),
    )


async def test_a_payment_in_a_store_blocked_meanwhile(maker):
    """Blocked while the payment runs: the scope still names the store, so
    the refusal comes under the debt's lock, after the lookup. A payment
    resent after the block is refused by the scope first, before the
    lookup, with no `recorded`, and the phone keeps it until the store
    trades again (owner decision, 2026-10-08; ADR-0013 §1)."""
    shops = await make_two_shops(maker)
    credit_id = (await sold_in_parts(maker, shops))["credit"]["credit_id"]
    await block(maker, shops.primary_store)
    late = payment(str(uuid.uuid4()), "100.00")

    await refused_twice(
        lambda: pay(maker, shops, credit_id, late), 403, "STORE_NOT_TRADING", state="BLOCKED"
    )


async def test_a_write_off_of_a_debt_paid_off_meanwhile(maker):
    shops = await make_two_shops(maker)
    credit_id = (await sold_in_parts(maker, shops))["credit"]["credit_id"]
    paid_off = await pay(maker, shops, credit_id, payment(str(uuid.uuid4()), "2000.00"))
    assert paid_off.status_code == 201, paid_off.text
    body = {"command_id": str(uuid.uuid4()), "reason": "поїхала за кордон"}

    async def send() -> httpx.Response:
        async with api(maker, shops.scope(shops.primary_store, OWNER)) as client:
            return await client.post(f"/api/v1/credits/{credit_id}/write-off", json=body)

    await refused_twice(send, 422, "VALIDATION_ERROR", reason="NOT_OWED")


async def test_a_payment_recorded_is_still_answered_after_the_debt_was_paid_off(maker):
    """The replay wins over what changed since: a payment whose answer was
    lost, resent after a colleague took the rest, is the payment it was."""
    shops = await make_two_shops(maker)
    credit_id = (await sold_in_parts(maker, shops))["credit"]["credit_id"]
    first = payment(str(uuid.uuid4()), "500.00")
    recorded = await pay(maker, shops, credit_id, first)
    rest = await pay(maker, shops, credit_id, payment(str(uuid.uuid4()), "1500.00"))
    assert (recorded.status_code, rest.status_code) == (201, 201), rest.text

    resent = await pay(maker, shops, credit_id, first)

    assert resent.status_code == 201, resent.text
    assert (resent.json()["status"], resent.json()["owed"]) == ("SETTLED", "0.00")
    assert [e["amount"] for e in resent.json()["entries"]] == ["1000.00", "500.00", "1500.00"]


async def test_a_payment_refused_before_its_lookup_claims_nothing(maker):
    shops = await make_two_shops(maker)
    credit_id = (await sold_in_parts(maker, shops))["credit"]["credit_id"]
    command = str(uuid.uuid4())
    taken = await pay(maker, shops, credit_id, payment(command, "100.00"))
    assert taken.status_code == 201, taken.text

    other = await pay(maker, shops, credit_id, payment(command, "200.00"))
    # The request's schema refuses nothing paid before the service sees it;
    # the service's own check, for any other caller, is decided first too.
    async with maker() as session:
        with pytest.raises(ValidationFailedError) as nothing:
            await credit_service.pay(
                session,
                scope=shops.scope(shops.primary_store),
                credit_id=uuid.UUID(credit_id),
                command_id=uuid.uuid4(),
                amount=Decimal("0"),
                payment_method=PaymentMethod.CASH,
            )
        await session.rollback()

    never_claimed(other, 409, "IDEMPOTENCY_CONFLICT")
    assert nothing.value.details == {"reason": "NOTHING_PAID"}


async def test_a_debt_that_would_owe_nothing_says_the_sale_recorded_nothing(maker):
    """`PAID_IN_FULL` is decided where the debt is opened, after the sale's
    lookup, for a sale new in its transaction: it says so where it is raised,
    whichever command opens the debt."""
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, 1)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        sold = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size),
            headers=key(),
        )
    assert sold.status_code == 201, sold.text

    async with maker() as session:
        sale = await session.get(Sale, uuid.UUID(sold.json()["id"]))
        assert sale is not None
        with pytest.raises(ValidationFailedError) as refused:
            await credit_service.open_credit(
                session,
                scope=shops.scope(shops.primary_store),
                sale=sale,
                credit=credit_service.CreditTerms(
                    customer_name="Ірина Коваль",
                    customer_phone="+38 (067) 123-45-67",
                    paid_now=Decimal("1500.00"),
                ),
                payment_method=PaymentMethod.CASH,
            )
        await session.rollback()

    assert refused.value.details == {
        "reason": "PAID_IN_FULL",
        "total": "1500.00",
        "recorded": False,
    }


# --- orders ---------------------------------------------------------------------------


def an_order(shops: TwoShops, variant: str, size: str, qty: int) -> dict[str, Any]:
    """Within Ukraine, by a carrier, as every order now says."""
    return order_body(shops.primary_store, shops.shared_warehouse, variant, size, qty=qty) | {
        "carrier": "NOVA_POSHTA"
    }


async def ordered(
    maker, shops: TwoShops, *, qty: int = 1, stocked: int = 1
) -> tuple[str, str, str]:
    """An order of `qty` coats, made: its id, and the coat's model and size."""
    variant, size = await coat(maker, shops, stocked)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        made = await client.post("/api/v1/orders", json=an_order(shops, variant, size, qty))
    assert made.status_code == 201, made.text
    return made.json()["id"], variant, size


async def act(maker, shops: TwoShops, order: str, action: str, **body: Any) -> httpx.Response:
    payload: dict[str, Any] = {"command_id": str(uuid.uuid4())} | body
    if action == "return":
        payload |= {"reason": "Повернулось поштою", "physically_received": True}
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await client.post(f"/api/v1/orders/{order}/{action}", json=payload)


async def test_an_order_with_too_little_stock_to_hold(maker):
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, 1)
    body = an_order(shops, variant, size, 2)

    async def send() -> httpx.Response:
        async with api(maker, shops.scope(shops.primary_store)) as client:
            return await client.post("/api/v1/orders", json=body)

    details = await refused_twice(send, 409, "INSUFFICIENT_STOCK")
    # No other order holds the coat: every shortfall says so (ADR-0013 §6).
    assert (details["requested"], details["available"], details["reserved"]) == (2, 1, False)


async def test_an_order_for_goods_another_order_holds(maker):
    """The only coat is held for another order: the shortfall says an order
    holds it, as every shortfall does (ADR-0013 §6)."""
    shops = await make_two_shops(maker)
    _, variant, size = await ordered(maker, shops)
    body = an_order(shops, variant, size, 1)

    async def send() -> httpx.Response:
        async with api(maker, shops.scope(shops.primary_store)) as client:
            return await client.post("/api/v1/orders", json=body)

    details = await refused_twice(send, 409, "INSUFFICIENT_STOCK")
    assert (details["available"], details["correctable"], details["reserved"]) == (0, False, True)


async def test_an_order_kept_from_before_orders_named_their_carrier(maker):
    """Where an order goes is checked after its command's lookup, so one
    recorded before orders named a carrier is still answered with its order
    (`test_order_shipping.py`), and one that was not settles."""
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, 1)
    body = order_body(shops.primary_store, shops.shared_warehouse, variant, size, qty=1)

    async def send() -> httpx.Response:
        async with api(maker, shops.scope(shops.primary_store)) as client:
            return await client.post("/api/v1/orders", json=body)

    await refused_twice(send, 422, "VALIDATION_ERROR", reason="CARRIER")


async def test_where_an_open_order_goes_said_the_wrong_way(maker):
    """Abroad by a carrier from the list: checked after the command's lookup,
    like the order being closed (owner decisions, 2026-10-01)."""
    shops = await make_two_shops(maker)
    order, _, _ = await ordered(maker, shops)
    command = str(uuid.uuid4())

    await refused_twice(
        lambda: act(
            maker,
            shops,
            order,
            "shipping",
            command_id=command,
            destination="ABROAD",
            carrier="NOVA_POSHTA",
        ),
        422,
        "VALIDATION_ERROR",
        reason="CARRIER_WITHIN_UKRAINE",
    )


async def test_a_dispatch_after_another_phone_cancelled_the_order(maker):
    shops = await make_two_shops(maker)
    order, _, _ = await ordered(maker, shops)
    cancelled = await act(maker, shops, order, "cancel")
    assert cancelled.status_code == 200, cancelled.text
    command = str(uuid.uuid4())

    await refused_twice(
        lambda: act(maker, shops, order, "dispatch", command_id=command),
        422,
        "VALIDATION_ERROR",
        status="CANCELLED",
        action="dispatch",
    )


async def test_a_late_collect_after_the_order_came_back(maker):
    """«Клієнт забрав» typed after another phone marked the order returned:
    the seller then types it as a sale from paper (owner decision,
    2026-10-07)."""
    shops = await make_two_shops(maker)
    order, _, _ = await ordered(maker, shops)
    for action in ("dispatch", "return"):
        moved = await act(maker, shops, order, action)
        assert moved.status_code == 200, moved.text
    command = str(uuid.uuid4())

    await refused_twice(
        lambda: act(maker, shops, order, "collect", command_id=command, payment_method="CASH"),
        422,
        "VALIDATION_ERROR",
        status="RETURNED",
        action="collect",
    )


async def test_a_collect_in_parts_that_would_owe_nothing(maker):
    shops = await make_two_shops(maker)
    order, _, _ = await ordered(maker, shops)
    for action in ("dispatch", "arrive"):
        moved = await act(maker, shops, order, action)
        assert moved.status_code == 200, moved.text
    command = str(uuid.uuid4())

    await refused_twice(
        lambda: act(
            maker,
            shops,
            order,
            "collect",
            command_id=command,
            payment_method="CASH",
            credit=terms("1500.00"),
        ),
        422,
        "VALIDATION_ERROR",
        reason="PAID_IN_FULL",
    )


async def test_where_a_closed_order_goes_is_not_changed(maker):
    shops = await make_two_shops(maker)
    order, _, _ = await ordered(maker, shops)
    cancelled = await act(maker, shops, order, "cancel")
    assert cancelled.status_code == 200, cancelled.text
    command = str(uuid.uuid4())

    await refused_twice(
        lambda: act(
            maker,
            shops,
            order,
            "shipping",
            command_id=command,
            destination="UKRAINE",
            carrier="NOVA_POSHTA",
            waybill="20450000000000",
        ),
        422,
        "VALIDATION_ERROR",
        reason="ORDER_CLOSED",
    )


async def test_an_order_command_reused_claims_nothing(maker):
    shops = await make_two_shops(maker)
    order, _, _ = await ordered(maker, shops)
    command = str(uuid.uuid4())
    dispatched = await act(maker, shops, order, "dispatch", command_id=command)
    assert dispatched.status_code == 200, dispatched.text

    other = await act(maker, shops, order, "arrive", command_id=command)

    never_claimed(other, 409, "IDEMPOTENCY_CONFLICT")


async def test_a_collect_whose_command_another_journal_used_claims_nothing(maker):
    """«Клієнт забрав» runs the collected sale's own lookup inside its own
    region. Under a `command_id` a till sale already used, that lookup refuses
    the command's identity: it proves nothing about what was recorded, and
    leaves as it came (ADR-0013 §1)."""
    shops = await make_two_shops(maker)
    order, variant, size = await ordered(maker, shops, stocked=2)
    for action in ("dispatch", "arrive"):
        moved = await act(maker, shops, order, action)
        assert moved.status_code == 200, moved.text
    till = sale_body(shops.primary_store, shops.shared_warehouse, variant, size)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        sold = await client.post("/api/v1/sales", json=till, headers=key())
    assert sold.status_code == 201, sold.text

    collected = await act(
        maker, shops, order, "collect", command_id=till["command_id"], payment_method="CASH"
    )

    never_claimed(collected, 409, "IDEMPOTENCY_CONFLICT")


# --- returns --------------------------------------------------------------------------


async def bought(maker, shops: TwoShops, qty: int = 1) -> dict[str, Any]:
    variant, size = await coat(maker, shops, qty)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        sold = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size, qty=qty),
            headers=key(),
        )
    assert sold.status_code == 201, sold.text
    return sold.json()


def refund(sale_item_id: str, *, quantity: int = 1, command: str | None = None) -> dict:
    return {
        "command_id": command or str(uuid.uuid4()),
        "lines": [
            {
                "sale_item_id": sale_item_id,
                "quantity": quantity,
                "restock": True,
                "condition": "INTACT",
            }
        ],
        "payment_method": "CASH",
    }


async def give_back(maker, shops: TwoShops, sale: dict, body: dict, *, key_: dict | None = None):
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await client.post(
            f"/api/v1/sales/{sale['id']}/refunds", json=body, headers=key_ or key()
        )


async def test_a_return_of_a_line_not_on_the_receipt(maker):
    shops = await make_two_shops(maker)
    sale = await bought(maker, shops)
    body = refund(str(uuid.uuid4()))
    same_key = key()

    await refused_twice(
        lambda: give_back(maker, shops, sale, body, key_=same_key), 404, "NOT_FOUND"
    )


async def test_a_return_of_goods_a_colleague_took_back_meanwhile(maker):
    shops = await make_two_shops(maker)
    sale = await bought(maker, shops)
    line = sale["items"][0]["id"]
    taken = await give_back(maker, shops, sale, refund(line))
    assert taken.status_code == 201, taken.text
    late = refund(line)

    await refused_twice(lambda: give_back(maker, shops, sale, late), 409, "REFUND_EXCEEDS_SOLD")


async def test_a_return_command_reused_claims_nothing(maker):
    shops = await make_two_shops(maker)
    sale = await bought(maker, shops, qty=2)
    line = sale["items"][0]["id"]
    command = str(uuid.uuid4())
    taken = await give_back(maker, shops, sale, refund(line, command=command))
    assert taken.status_code == 201, taken.text

    other = await give_back(maker, shops, sale, refund(line, quantity=2, command=command))

    never_claimed(other, 409, "IDEMPOTENCY_CONFLICT")


# --- deliveries and stock corrections -------------------------------------------------


def delivery(shops: TwoShops, variant: str, size: str, *, location=None) -> dict[str, Any]:
    return {
        "store_id": str(shops.primary_store),
        "location_id": str(location or shops.shared_warehouse),
        "command_id": str(uuid.uuid4()),
        "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 1}],
    }


async def receive(maker, shops: TwoShops, body: dict, *, permissions=SELLER, key_=None):
    async with api(maker, shops.scope(shops.primary_store, permissions)) as client:
        return await client.post("/api/v1/inventory/receipts", json=body, headers=key_ or key())


async def test_a_delivery_to_a_store_blocked_meanwhile(maker):
    """A kept delivery keeps the till from selling, so a block that lands
    while it runs must settle it: the scope still names the store, and the
    stock lock refuses it, after the lookup. A delivery resent after the
    block, or after its warehouse was closed, is refused before the lookup,
    by the scope or the warehouse's access, with no `recorded`: the phone
    keeps it until the store trades or the warehouse reopens (owner
    decision, 2026-10-08; ADR-0013 §1)."""
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, 0)
    body = delivery(shops, variant, size)
    await block(maker, shops.primary_store)
    same_key = key()

    await refused_twice(
        lambda: receive(maker, shops, body, key_=same_key), 403, "STORE_NOT_TRADING"
    )


async def test_a_delivery_to_a_warehouse_whose_opening_list_waits(maker):
    """A list was typed for the warehouse meanwhile, and waits (owner
    decision, 2026-10-02): nothing moves there until it is decided."""
    seeded = await seed_world(maker)
    owner = seeded["users"]["owner"]
    async with client_for(maker, owner) as client:
        variant, sizes = await create_product(client, seeded["main"], "Лоран", "шоколад", ["M"])
        listed = await client.post(
            "/api/v1/snapshots",
            json={
                "command_id": str(uuid.uuid4()),
                "store_id": str(seeded["main"]),
                "location_id": str(seeded["shared"]),
                "lines": LIST,
            },
        )
        assert listed.status_code == 201, listed.text
    body = {
        "store_id": str(seeded["main"]),
        "location_id": str(seeded["shared"]),
        "command_id": str(uuid.uuid4()),
        "lines": [{"product_variant_id": str(variant), "size_id": str(sizes["M"]), "quantity": 1}],
    }
    same_key = idempotent()

    async def send() -> httpx.Response:
        async with client_for(maker, owner) as client:
            return await client.post("/api/v1/inventory/receipts", json=body, headers=same_key)

    await refused_twice(send, 409, "OPENING_LIST_PENDING", location_ids=[str(seeded["shared"])])


async def test_a_delivery_refused_before_its_lookup_claims_nothing(maker):
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, 0)
    command = delivery(shops, variant, size)
    taken = await receive(maker, shops, command)
    assert taken.status_code == 201, taken.text

    unreached = await receive(
        maker, shops, delivery(shops, variant, size, location=shops.child_warehouse)
    )
    unpermitted = await receive(
        maker,
        shops,
        delivery(shops, variant, size),
        permissions=SELLER - {Permission.INVENTORY_RECEIVE},
    )
    other = await receive(
        maker, shops, command | {"lines": [command["lines"][0] | {"quantity": 2}]}
    )

    never_claimed(unreached, 403, "LOCATION_ACCESS_DENIED")
    never_claimed(unpermitted, 403, "PERMISSION_DENIED")
    never_claimed(other, 409, "IDEMPOTENCY_CONFLICT")


async def test_a_stock_correction_below_what_is_there(maker):
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, 1)
    body = {
        "store_id": str(shops.primary_store),
        "location_id": str(shops.shared_warehouse),
        "command_id": str(uuid.uuid4()),
        "product_variant_id": variant,
        "size_id": size,
        "quantity_delta": -2,
        "reason_code": "LOST",
    }
    same_key = key()

    async def send() -> httpx.Response:
        async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
            return await client.post("/api/v1/inventory/adjustments", json=body, headers=same_key)

    details = await refused_twice(send, 409, "INSUFFICIENT_STOCK")
    # Never offered a correction, and no order holds the coat (ADR-0013 §6).
    assert (details["correctable"], details["reserved"]) == (False, False)


async def test_a_refused_payment_left_no_entry(maker):
    """What `recorded: false` promises, read back: the debt holds only the
    part paid when it was sold."""
    shops = await make_two_shops(maker)
    credit_id = (await sold_in_parts(maker, shops))["credit"]["credit_id"]
    refused = await pay(maker, shops, credit_id, payment(str(uuid.uuid4()), "2500.00"))
    assert refused.json()["details"]["recorded"] is False

    async with api(maker, shops.scope(shops.primary_store)) as client:
        read = await client.get(f"/api/v1/credits/{credit_id}")
    assert read.status_code == 200, read.text
    assert [e["amount"] for e in read.json()["entries"]] == ["1000.00"]


# --- refused before the lookup: the phone keeps the attempt -----------------------------


def signed_in_after_the_block(shops: TwoShops) -> RequestScope:
    """The scope a sign-in builds once the owner has blocked the primary
    store: its own people's grants give nothing there while it does not
    trade (owner decisions, 2026-10-01)."""
    return RequestScope(
        user_id=shops.user_id,
        organization_id=shops.organization_id,
        closed_stores={shops.primary_store: "BLOCKED"},
    )


async def test_every_command_resent_after_its_store_was_blocked_claims_nothing(maker):
    """The store was blocked while a phone kept an operation there. The
    resend is refused before the operation is looked up, which proves
    nothing about what was recorded: it never says so, and the phone keeps
    the attempt until the store trades again (owner decision, 2026-10-08;
    ADR-0013 §1). Each command a seller sends, as its phone resends it."""
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, 1)
    credit_id = (await sold_in_parts(maker, shops))["credit"]["credit_id"]
    order, _, _ = await ordered(maker, shops)
    sale = await bought(maker, shops)
    await block(maker, shops.primary_store)

    shelf = {
        "store_id": str(shops.primary_store),
        "command_id": str(uuid.uuid4()),
        "lines": [
            {
                "source_location_id": str(shops.shared_warehouse),
                "product_variant_id": variant,
                "size_id": size,
                "quantity": 1,
            }
        ],
    }
    correction = {
        "store_id": str(shops.primary_store),
        "location_id": str(shops.shared_warehouse),
        "command_id": str(uuid.uuid4()),
        "product_variant_id": variant,
        "size_id": size,
        "quantity_delta": -1,
        "reason_code": "LOST",
    }
    shipping = {
        "command_id": str(uuid.uuid4()),
        "destination": "UKRAINE",
        "carrier": "NOVA_POSHTA",
        "waybill": "20450000000000",
    }
    write_off = {"command_id": str(uuid.uuid4()), "reason": "поїхала за кордон"}
    sale_line = sale_body(shops.primary_store, shops.shared_warehouse, variant, size)
    resent: dict[str, tuple[str, dict[str, Any], dict[str, str], str]] = {
        "sale": ("/api/v1/sales", sale_line, key(), "STORE_NOT_TRADING"),
        "empty shelf": ("/api/v1/shelf-shortages", shelf, {}, "STORE_NOT_TRADING"),
        "payment": (
            f"/api/v1/credits/{credit_id}/payments",
            payment(str(uuid.uuid4()), "100.00"),
            {},
            "STORE_NOT_TRADING",
        ),
        # A debt of a store that does not trade is the network owner's to
        # write off; a store's own people are refused (owner, 2026-10-01).
        "write-off": (
            f"/api/v1/credits/{credit_id}/write-off",
            write_off,
            {},
            "PERMISSION_DENIED",
        ),
        "order": ("/api/v1/orders", an_order(shops, variant, size, 1), {}, "STORE_NOT_TRADING"),
        "order's step": (
            f"/api/v1/orders/{order}/dispatch",
            {"command_id": str(uuid.uuid4())},
            {},
            "STORE_NOT_TRADING",
        ),
        "where the order goes": (
            f"/api/v1/orders/{order}/shipping",
            shipping,
            {},
            "STORE_NOT_TRADING",
        ),
        "return": (
            f"/api/v1/sales/{sale['id']}/refunds",
            refund(sale["items"][0]["id"]),
            key(),
            "STORE_NOT_TRADING",
        ),
        "delivery": (
            "/api/v1/inventory/receipts",
            delivery(shops, variant, size),
            key(),
            "STORE_NOT_TRADING",
        ),
        "stock correction": (
            "/api/v1/inventory/adjustments",
            correction,
            key(),
            "STORE_NOT_TRADING",
        ),
    }

    async with api(maker, signed_in_after_the_block(shops)) as client:
        for name, (path, body, headers, code) in resent.items():
            response = await client.post(path, json=body, headers=headers)
            assert response.status_code == 403, (name, response.text)
            assert response.json()["code"] == code, (name, response.text)
            assert "recorded" not in response.json()["details"], (name, response.text)


async def test_an_empty_shelf_resent_without_sale_view_claims_nothing(maker):
    """The lookup found the report: refused only because the sender may no
    longer read it back. It was recorded, so the refusal must not say it was
    not."""
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, 0)
    body = {
        "store_id": str(shops.primary_store),
        "command_id": str(uuid.uuid4()),
        "lines": [
            {
                "source_location_id": str(shops.shared_warehouse),
                "product_variant_id": variant,
                "size_id": size,
                "quantity": 1,
            }
        ],
    }
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        recorded = await client.post("/api/v1/shelf-shortages", json=body)
    assert recorded.status_code == 201, recorded.text
    async with api(
        maker, shops.scope(shops.primary_store, MANAGER - {Permission.SALE_VIEW})
    ) as client:
        again = await client.post("/api/v1/shelf-shortages", json=body)

    never_claimed(again, 403, "PERMISSION_DENIED")
    assert again.json()["details"]["permission"] == Permission.SALE_VIEW.value
