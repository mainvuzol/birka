"""Where an order goes (owner decisions, 2026-10-01), over HTTP against real
PostgreSQL.

- An order goes within Ukraine — the default — by one of three carriers,
  picked when it is made, or abroad.
- The waybill, or abroad one free text, is written when the order is sent,
  or later. An order may be sent without it.
- Whoever works with orders corrects any of it while the order is open; every
  version stays.
- One waybill on two orders is saved, and each names the other. Orders are
  found by their waybill.
- Nobody's name, phone or address is kept.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.core.idempotency import fingerprint
from app.modules.authz.permissions import Permission
from app.modules.orders.models import CustomerOrder, OrderCommand
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import (
    TwoShops,
    api,
    make_two_shops,
    order_body,
    stock_a_coat,
)

pytestmark = [pytest.mark.integration, requires_database()]

ONLY_READS = frozenset({Permission.SALE_VIEW, Permission.INVENTORY_VIEW})


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def coats(maker, shops: TwoShops, store: uuid.UUID | None = None, qty: int = 6):
    async with api(maker, shops.scope(store or shops.primary_store)) as client:
        return await stock_a_coat(
            client,
            shops,
            store=store or shops.primary_store,
            warehouse=shops.shared_warehouse,
            qty=qty,
        )


async def order(maker, shops: TwoShops, coat, store: uuid.UUID | None = None, **shipping):
    store = store or shops.primary_store
    async with api(maker, shops.scope(store)) as client:
        return await client.post(
            "/api/v1/orders",
            json=order_body(store, shops.shared_warehouse, *coat) | shipping,
        )


async def step(maker, shops: TwoShops, order_id: str, action: str, permissions=None, **extra):
    scope = (
        shops.scope(shops.primary_store)
        if permissions is None
        else shops.scope(shops.primary_store, permissions)
    )
    async with api(maker, scope) as client:
        return await client.post(
            f"/api/v1/orders/{order_id}/{action}",
            json={"command_id": extra.pop("command_id", str(uuid.uuid4()))} | extra,
        )


async def read(maker, shops: TwoShops, order_id: str) -> dict:
    async with api(maker, shops.scope(shops.primary_store)) as client:
        answer = await client.get(f"/api/v1/orders/{order_id}")
    assert answer.status_code == 200, answer.text
    return answer.json()


def history(body: dict) -> list[tuple]:
    return [
        (c["kind"], c["destination"], c["carrier"], c["waybill"], c["abroad_note"])
        for c in body["shipping_history"]
    ]


async def test_an_order_says_where_it_goes(maker):
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops)

    # Within Ukraine, the default, always by a carrier.
    missing = await order(maker, shops, coat)
    assert missing.status_code == 422, missing.text
    assert missing.json()["details"]["reason"] == "CARRIER"
    unknown = await order(maker, shops, coat, carrier="DHL")
    assert unknown.status_code == 422, unknown.text

    payload = order_body(shops.primary_store, shops.shared_warehouse, *coat) | {
        "carrier": "NOVA_POSHTA"
    }
    async with api(maker, shops.scope(shops.primary_store)) as client:
        made = await client.post("/api/v1/orders", json=payload)
        assert made.status_code == 201, made.text
        body = made.json()
        assert (body["destination"], body["carrier"], body["waybill"], body["abroad_note"]) == (
            "UKRAINE",
            "NOVA_POSHTA",
            None,
            None,
        )
        assert history(body) == [("CREATED", "UKRAINE", "NOVA_POSHTA", None, None)]
        assert body["shipping_history"][0]["by"] == "Оля"
        # The same command is answered with its order; another carrier under
        # it is another operation.
        again = await client.post("/api/v1/orders", json=payload)
        assert again.status_code == 201 and again.json()["id"] == body["id"]
        other = await client.post("/api/v1/orders", json=payload | {"carrier": "MEEST"})
        assert other.status_code == 409, other.text

    # Abroad, by no carrier from the list.
    wrong = await order(maker, shops, coat, destination="ABROAD", carrier="UKRPOSHTA")
    assert wrong.json()["details"]["reason"] == "CARRIER_WITHIN_UKRAINE"
    abroad = await order(maker, shops, coat, destination="ABROAD")
    assert abroad.status_code == 201, abroad.text
    assert (abroad.json()["destination"], abroad.json()["carrier"]) == ("ABROAD", None)
    # Each of the three carriers.
    for carrier in ("UKRPOSHTA", "MEEST"):
        made = await order(maker, shops, coat, carrier=carrier)
        assert made.json()["carrier"] == carrier, made.text

    # No name, phone or address is taken.
    assert (await order(maker, shops, coat, carrier="MEEST", phone="0671234567")).status_code == (
        422
    )


async def test_a_command_from_before_is_still_answered_with_its_order(maker):
    """An order sent before orders said where they go, whose answer was lost,
    is answered with that order — never refused for the carrier it could not
    name."""
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops)
    made = (await order(maker, shops, coat, carrier="NOVA_POSHTA")).json()
    legacy = order_body(shops.primary_store, shops.shared_warehouse, *coat)
    line = legacy["lines"][0]
    async with maker() as session:
        session.add(
            OrderCommand(
                organization_id=shops.organization_id,
                order_id=uuid.UUID(made["id"]),
                command_id=uuid.UUID(legacy["command_id"]),
                # As a create was fingerprinted before 0028.
                fingerprint=fingerprint(
                    {
                        "action": "create",
                        "lines": [
                            {
                                "variant": line["product_variant_id"],
                                "size": line["size_id"],
                                "location": line["source_location_id"],
                                "quantity": line["quantity"],
                                "price": line["unit_price"],
                                "discount": "0.00",
                            }
                        ],
                    },
                    actor_user_id=shops.user_id,
                    store_id=shops.primary_store,
                ),
                response_snapshot={k: v for k, v in made.items() if k != "shipping_history"},
            )
        )
        await session.commit()
    async with api(maker, shops.scope(shops.primary_store)) as client:
        replayed = await client.post("/api/v1/orders", json=legacy)
    assert replayed.status_code == 201, replayed.text
    assert replayed.json()["id"] == made["id"]


async def test_the_waybill_is_written_when_it_is_sent_or_later(maker):
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops)
    plain = (await order(maker, shops, coat, carrier="NOVA_POSHTA")).json()["id"]
    # Sent without it: written later.
    sent = await step(maker, shops, plain, "dispatch")
    assert sent.status_code == 200, sent.text
    assert (sent.json()["status"], sent.json()["waybill"]) == ("DISPATCHED", None)

    with_number = (await order(maker, shops, coat, carrier="NOVA_POSHTA")).json()["id"]
    command = str(uuid.uuid4())
    sent = await step(
        maker, shops, with_number, "dispatch", command_id=command, waybill=" 20 4500 1234 5678 "
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["waybill"] == "20 4500 1234 5678"
    assert history(sent.json()) == [
        ("CREATED", "UKRAINE", "NOVA_POSHTA", None, None),
        ("DISPATCHED", "UKRAINE", "NOVA_POSHTA", "20 4500 1234 5678", None),
    ]
    again = await step(
        maker, shops, with_number, "dispatch", command_id=command, waybill=" 20 4500 1234 5678 "
    )
    assert again.json()["id"] == with_number and again.json()["waybill"] == "20 4500 1234 5678"
    other = await step(maker, shops, with_number, "dispatch", command_id=command, waybill="1")
    assert other.status_code == 409, other.text
    # Within Ukraine the waybill says how it went; the note is for abroad.
    noted = (await order(maker, shops, coat, carrier="UKRPOSHTA")).json()["id"]
    refused = await step(maker, shops, noted, "dispatch", abroad_note="Варшава")
    assert refused.json()["details"]["reason"] == "NOTE_ABROAD_ONLY", refused.text
    blank = await step(maker, shops, noted, "dispatch", waybill=" - ")
    assert blank.json()["details"]["reason"] == "WAYBILL", blank.text

    abroad = (await order(maker, shops, coat, destination="ABROAD")).json()["id"]
    numbered = await step(maker, shops, abroad, "dispatch", waybill="20450012345678")
    assert numbered.json()["details"]["reason"] == "WAYBILL_WITHIN_UKRAINE", numbered.text
    gone = await step(
        maker, shops, abroad, "dispatch", abroad_note="Варшава, Польща — Нова пошта Глобал"
    )
    assert gone.status_code == 200, gone.text
    assert gone.json()["abroad_note"] == "Варшава, Польща — Нова пошта Глобал"

    # Only when it is sent: arriving takes no waybill.
    late = await step(maker, shops, plain, "arrive", waybill="20450012345678")
    assert late.status_code == 422, late.text


async def test_where_it_goes_is_corrected_while_open_and_every_version_stays(maker):
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops)
    order_id = (await order(maker, shops, coat, carrier="NOVA_POSHTA")).json()["id"]

    def shipping(destination: str = "UKRAINE", **fields) -> dict:
        return {"destination": destination} | fields

    command = str(uuid.uuid4())
    corrected = await step(
        maker,
        shops,
        order_id,
        "shipping",
        command_id=command,
        **shipping(carrier="UKRPOSHTA", waybill="0500012345678"),
    )
    assert corrected.status_code == 200, corrected.text
    assert (corrected.json()["carrier"], corrected.json()["waybill"]) == (
        "UKRPOSHTA",
        "0500012345678",
    )
    # The same command is answered with what it did, and never to someone
    # who only reads orders.
    replayed = await step(
        maker,
        shops,
        order_id,
        "shipping",
        command_id=command,
        **shipping(carrier="UKRPOSHTA", waybill="0500012345678"),
    )
    assert replayed.json()["carrier"] == "UKRPOSHTA"
    reader = await step(
        maker,
        shops,
        order_id,
        "shipping",
        ONLY_READS,
        command_id=command,
        **shipping(carrier="UKRPOSHTA", waybill="0500012345678"),
    )
    assert reader.status_code == 403, reader.text

    for refused, reason in (
        (shipping(), "CARRIER"),
        (shipping("ABROAD", waybill="0500012345678"), "WAYBILL_WITHIN_UKRAINE"),
        (shipping("ABROAD", carrier="MEEST"), "CARRIER_WITHIN_UKRAINE"),
        (shipping(carrier="MEEST", abroad_note="Прага"), "NOTE_ABROAD_ONLY"),
    ):
        answer = await step(maker, shops, order_id, "shipping", **refused)
        assert answer.json()["details"]["reason"] == reason, answer.text

    sent = await step(maker, shops, order_id, "dispatch")
    assert sent.json()["waybill"] == "0500012345678"
    # Still open once sent: abroad after all, with what it says.
    moved = await step(
        maker, shops, order_id, "shipping", **shipping("ABROAD", abroad_note="Прага, Чехія")
    )
    assert (moved.json()["carrier"], moved.json()["waybill"], moved.json()["abroad_note"]) == (
        None,
        None,
        "Прага, Чехія",
    )
    # Stated again as it stands: nothing new in its history.
    same = await step(
        maker, shops, order_id, "shipping", **shipping("ABROAD", abroad_note="Прага, Чехія")
    )
    assert history(same.json()) == [
        ("CREATED", "UKRAINE", "NOVA_POSHTA", None, None),
        ("CORRECTED", "UKRAINE", "UKRPOSHTA", "0500012345678", None),
        ("CORRECTED", "ABROAD", None, None, "Прага, Чехія"),
    ]

    # Closed, it stays as it went.
    closed = (await order(maker, shops, coat, carrier="MEEST")).json()["id"]
    assert (await step(maker, shops, closed, "cancel")).status_code == 200
    late = await step(maker, shops, closed, "shipping", **shipping(carrier="NOVA_POSHTA"))
    assert late.json()["details"]["reason"] == "ORDER_CLOSED", late.text


async def test_an_order_made_before_says_nothing_until_told(maker):
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops)
    order_id = (await order(maker, shops, coat, carrier="NOVA_POSHTA")).json()["id"]
    async with maker() as session:
        # As every order made before 0028 stands.
        await session.execute(
            update(CustomerOrder)
            .where(CustomerOrder.id == uuid.UUID(order_id))
            .values(destination=None, carrier=None)
        )
        await session.commit()
    body = await read(maker, shops, order_id)
    assert (body["destination"], body["carrier"]) == (None, None)
    # No waybill is written for an order going nobody knows where.
    blind = await step(maker, shops, order_id, "dispatch", waybill="20450012345678")
    assert blind.json()["details"]["reason"] == "NO_DESTINATION", blind.text
    assert (await read(maker, shops, order_id))["status"] == "READY_TO_DISPATCH"
    told = await step(
        maker,
        shops,
        order_id,
        "shipping",
        destination="UKRAINE",
        carrier="MEEST",
        waybill="MEEST-123",
    )
    assert (told.json()["destination"], told.json()["waybill"]) == ("UKRAINE", "MEEST-123")


async def test_one_waybill_on_two_orders_is_saved_and_each_names_the_other(maker):
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops)
    first = (await order(maker, shops, coat, carrier="NOVA_POSHTA")).json()["id"]
    second = (await order(maker, shops, coat, carrier="NOVA_POSHTA")).json()["id"]
    lone = (await order(maker, shops, coat, carrier="NOVA_POSHTA")).json()["id"]
    theirs_coat = await coats(maker, shops, store=shops.child_store)
    theirs = (
        await order(maker, shops, theirs_coat, store=shops.child_store, carrier="NOVA_POSHTA")
    ).json()["id"]

    assert (await step(maker, shops, first, "dispatch", waybill="20450012345678")).json()[
        "same_waybill"
    ] == []
    # Another store's order with that waybill is no business of this one.
    async with api(maker, shops.scope(shops.child_store)) as client:
        child = await client.post(
            f"/api/v1/orders/{theirs}/dispatch",
            json={"command_id": str(uuid.uuid4()), "waybill": "20450012345678"},
        )
    assert child.json()["same_waybill"] == [], child.text
    # One parcel: saved anyway, however it is spaced, and named.
    sent = await step(maker, shops, second, "dispatch", waybill="2045 0012 3456 78")
    assert sent.status_code == 200, sent.text
    assert sent.json()["same_waybill"] == [{"id": first, "status": "DISPATCHED"}]
    assert (await read(maker, shops, first))["same_waybill"] == [
        {"id": second, "status": "DISPATCHED"}
    ]
    assert (await read(maker, shops, lone))["same_waybill"] == []

    async with api(maker, shops.scope(shops.primary_store)) as client:

        async def found(query: str) -> list[str]:
            page = await client.get(
                "/api/v1/orders", params={"store_id": str(shops.primary_store), "waybill": query}
            )
            assert page.status_code == 200, page.text
            return sorted(o["id"] for o in page.json()["orders"])

        assert await found("0012 3456") == sorted([first, second])
        assert await found("99999") == []
        # An empty search lists every order.
        assert len(await found(" ")) == 3
        # The list shows how each goes.
        listed = (
            await client.get("/api/v1/orders", params={"store_id": str(shops.primary_store)})
        ).json()["orders"]
    assert {(o["id"], o["carrier"], o["waybill"]) for o in listed} == {
        (first, "NOVA_POSHTA", "20450012345678"),
        (second, "NOVA_POSHTA", "2045 0012 3456 78"),
        (lone, "NOVA_POSHTA", None),
    }


async def test_the_downgrade_refuses_while_an_order_says_where_it_goes():
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_shipping_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "0027_supplier_invoices", database=name)
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        shops = await make_two_shops(fresh)
        old = uuid.uuid4()
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "INSERT INTO customer_order (id, organization_id, store_id, "
                    "created_by_user_id, status, currency_code, created_at) "
                    "VALUES (:id, :org, :store, :user, 'READY_TO_DISPATCH', 'UAH', now())"
                ),
                {
                    "id": old,
                    "org": shops.organization_id,
                    "store": shops.primary_store,
                    "user": shops.user_id,
                },
            )
        await _run(config, "upgrade", "head", database=name)
        # An order made before stays without a destination: none is invented.
        async with engine.connect() as connection:
            assert (
                await connection.scalar(
                    text("SELECT destination FROM customer_order WHERE id = :id"), {"id": old}
                )
            ) is None
        await _run(config, "downgrade", "0027_supplier_invoices", database=name)
        await _run(config, "upgrade", "head", database=name)
        coat = await coats(fresh, shops)
        assert (await order(fresh, shops, coat, carrier="MEEST")).status_code == 201
        with pytest.raises(Exception, match="Orders state where they go"):
            await _run(config, "downgrade", "0027_supplier_invoices", database=name)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
