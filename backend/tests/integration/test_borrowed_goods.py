"""Goods borrowed from another shop, and goods under consignment (owner
decisions, 2026-10-01), over HTTP against real PostgreSQL.

- They arrive through receiving, from a supplier on the list, at a price
  agreed for each. Only the owner and managers take them.
- Sold at the till as any goods; marked sold by hand, which is an invoice in
  «Накладні» for their price. Cancelling it puts them back on hand.
- Unsold, they go back to the supplier they came from, for nothing.
  Cancelling that return puts them back on hand too.
- Never more is marked sold or sent back than is still on hand.

All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import (
    TwoShops,
    api,
    key,
    make_two_shops,
    quantity_at,
    stock_a_coat,
)
from tests.integration.test_supplier_returns import supplier

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def model(maker, shops: TwoShops) -> tuple[str, str]:
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=0
        )


def receipt(
    shops: TwoShops,
    coat: tuple[str, str],
    *,
    qty: int = 3,
    kind: str = "BORROWED",
    cost: str | None = "2000.00",
    supplier_id: str | None = None,
    store: uuid.UUID | None = None,
) -> dict:
    return {
        "store_id": str(store or shops.primary_store),
        "location_id": str(shops.shared_warehouse),
        "command_id": str(uuid.uuid4()),
        "lines": [
            {
                "product_variant_id": coat[0],
                "size_id": coat[1],
                "quantity": qty,
                "acquisition_type": kind,
                "unit_cost": cost,
            }
        ],
        "notes": None,
    } | ({"supplier_id": supplier_id} if supplier_id else {})


async def receive(maker, shops: TwoShops, payload: dict, permissions=MANAGER):
    store = uuid.UUID(payload["store_id"])
    async with api(maker, shops.scope(store, permissions)) as client:
        return await client.post("/api/v1/inventory/receipts", json=payload, headers=key())


async def borrowed(maker, shops: TwoShops, store=None, permissions=MANAGER, **params):
    store = store or shops.primary_store
    async with api(maker, shops.scope(store, permissions)) as client:
        return await client.get("/api/v1/borrowed", params={"store_id": str(store)} | params)


async def lot_of(maker, shops: TwoShops, **params) -> dict:
    answer = await borrowed(maker, shops, **params)
    assert answer.status_code == 200, answer.text
    [lot] = answer.json()["items"]
    return lot


async def sold(maker, shops: TwoShops, lot_id: str, qty: int, permissions=MANAGER, **extra):
    store = extra.pop("store", shops.primary_store)
    async with api(maker, shops.scope(store, permissions)) as client:
        return await client.post(
            "/api/v1/supplier-invoices/sold",
            json={
                "command_id": extra.pop("command_id", str(uuid.uuid4())),
                "store_id": str(store),
                "stock_lot_id": lot_id,
                "quantity": qty,
            },
        )


async def send_back(maker, shops: TwoShops, lot: dict, qty: int, **override):
    body = {
        "command_id": str(uuid.uuid4()),
        "store_id": str(shops.primary_store),
        "location_id": lot["location_id"],
        "supplier_id": lot["supplier"]["id"],
        "stock_lot_id": lot["stock_lot_id"],
        "lines": [
            {
                "product_variant_id": lot["product_variant_id"],
                "size_id": lot["size_id"],
                "quantity": qty,
            }
        ],
        "note": None,
    } | override
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        return await client.post("/api/v1/supplier-returns", json=body)


def counts(lot: dict) -> tuple[int, int, int, int]:
    return lot["received"], lot["sold"], lot["returned"], lot["on_hand"]


async def test_borrowed_goods_come_from_a_supplier_at_a_price(maker):
    shops = await make_two_shops(maker)
    coat = await model(maker, shops)
    neighbour = (await supplier(maker, shops, "Сусідка Оксана")).json()["id"]

    # Not a seller's: a seller receives the shop's own goods only.
    seller = await receive(maker, shops, receipt(shops, coat, supplier_id=neighbour), SELLER)
    assert seller.status_code == 403, seller.text
    own = await receive(maker, shops, receipt(shops, coat, kind="PURCHASE", cost=None), SELLER)
    assert own.status_code == 201, own.text

    for payload, reason in (
        (receipt(shops, coat), "SUPPLIER"),
        (receipt(shops, coat, cost=None, supplier_id=neighbour), "PRICE"),
        (receipt(shops, coat, cost="0.00", supplier_id=neighbour), "PRICE"),
        (receipt(shops, coat, kind="CONSIGNMENT", supplier_id=None), "SUPPLIER"),
    ):
        answer = await receive(maker, shops, payload)
        assert answer.status_code == 422, answer.text
        assert answer.json()["details"]["reason"] == reason
    foreign = await make_two_shops(maker)
    stranger = (await supplier(maker, foreign, "Чужий")).json()["id"]
    assert (
        await receive(maker, shops, receipt(shops, coat, supplier_id=stranger))
    ).status_code == 404

    command = str(uuid.uuid4())
    took = await receive(
        maker, shops, receipt(shops, coat, supplier_id=neighbour) | {"command_id": command}
    )
    assert took.status_code == 201, took.text
    # The same delivery from another supplier is another delivery.
    other_hand = (await supplier(maker, shops, "Інша сусідка")).json()["id"]
    clash = await receive(
        maker, shops, receipt(shops, coat, supplier_id=other_hand) | {"command_id": command}
    )
    assert clash.status_code == 409, clash.text
    # Bought from a supplier, the shop's own: nothing to mark sold.
    bought = await receive(
        maker, shops, receipt(shops, coat, kind="PURCHASE", qty=1, supplier_id=neighbour)
    )
    assert bought.status_code == 201, bought.text
    lot = await lot_of(maker, shops)
    assert (lot["supplier"]["name"], lot["acquisition_type"], lot["unit_cost"]) == (
        "Сусідка Оксана",
        "BORROWED",
        "2000.00",
    )
    assert counts(lot) == (3, 0, 0, 3)
    assert lot["location_name"] == "Основний склад"
    async with maker() as session:
        # On the shelf with the shop's own: two bought, three borrowed.
        assert await quantity_at(session, shops.shared_warehouse, *coat) == 7

    consigned = await receive(
        maker, shops, receipt(shops, coat, qty=2, kind="CONSIGNMENT", supplier_id=neighbour)
    )
    assert consigned.status_code == 201, consigned.text
    every = (await borrowed(maker, shops)).json()["items"]
    assert [(item["acquisition_type"], item["on_hand"]) for item in every] == [
        ("CONSIGNMENT", 2),
        ("BORROWED", 3),
    ]
    # Seen by whoever keeps the suppliers, never a seller; each store its own.
    assert (await borrowed(maker, shops, permissions=SELLER)).status_code == 403
    assert (await borrowed(maker, shops, store=shops.child_store)).json()["items"] == []
    other = (await supplier(maker, shops, "Інший")).json()["id"]
    assert (await borrowed(maker, shops, supplier_id=other)).json()["items"] == []


async def test_borrowed_goods_sold_are_owed_in_the_invoices(maker):
    shops = await make_two_shops(maker)
    coat = await model(maker, shops)
    neighbour = (await supplier(maker, shops, "Сусідка Оксана")).json()["id"]
    assert (
        await receive(maker, shops, receipt(shops, coat, supplier_id=neighbour))
    ).status_code == 201
    lot = await lot_of(maker, shops)

    command = str(uuid.uuid4())
    marked = await sold(maker, shops, lot["stock_lot_id"], 2, command_id=command)
    assert marked.status_code == 201, marked.text
    invoice = marked.json()
    assert (invoice["supplier"]["name"], invoice["amount"], invoice["owed"]) == (
        "Сусідка Оксана",
        "4000.00",
        "4000.00",
    )
    assert invoice["sold"]["stock_lot_id"] == lot["stock_lot_id"]
    assert invoice["sold"]["quantity"] == 2
    assert invoice["sold"]["label"].endswith(", M")
    assert counts(await lot_of(maker, shops)) == (3, 2, 0, 1)
    # Marking sold moves no goods: the till sold them.
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, *coat) == 3

    # The same command is answered with its invoice, and never to a seller.
    again = await sold(maker, shops, lot["stock_lot_id"], 2, command_id=command)
    assert again.json()["id"] == invoice["id"]
    assert (
        await sold(maker, shops, lot["stock_lot_id"], 2, SELLER, command_id=command)
    ).status_code == 403
    assert (await sold(maker, shops, lot["stock_lot_id"], 1, command_id=command)).status_code == 409
    # Never more than is on hand, and never another store's.
    over = await sold(maker, shops, lot["stock_lot_id"], 2)
    assert over.json()["details"] == {"reason": "MORE_THAN_ON_HAND", "on_hand": 1}, over.text
    assert (
        await sold(maker, shops, lot["stock_lot_id"], 1, store=shops.child_store)
    ).status_code == 404
    assert (await sold(maker, shops, str(uuid.uuid4()), 1)).status_code == 404

    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        owes = (
            await client.get(
                "/api/v1/supplier-invoices/summary", params={"store_id": str(shops.primary_store)}
            )
        ).json()
        assert owes["owed"] == "4000.00"
        # Marked by mistake: its invoice is cancelled, and they are on hand again.
        undone = await client.post(
            f"/api/v1/supplier-invoices/{invoice['id']}/cancel", json={"reason": "не продали"}
        )
    assert undone.json()["status"] == "CANCELLED", undone.text
    assert counts(await lot_of(maker, shops)) == (3, 0, 0, 3)


async def test_unsold_borrowed_goods_go_back_to_their_supplier(maker):
    shops = await make_two_shops(maker)
    coat = await model(maker, shops)
    neighbour = (await supplier(maker, shops, "Сусідка Оксана")).json()["id"]
    other = (await supplier(maker, shops, "Інший")).json()["id"]
    assert (
        await receive(maker, shops, receipt(shops, coat, supplier_id=neighbour))
    ).status_code == 201
    lot = await lot_of(maker, shops)

    back = await send_back(maker, shops, lot, 1)
    assert back.status_code == 201, back.text
    assert back.json()["stock_lot_id"] == lot["stock_lot_id"]
    assert counts(await lot_of(maker, shops)) == (3, 0, 1, 2)
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, *coat) == 2

    wrong = await send_back(maker, shops, lot, 1, supplier_id=other)
    assert wrong.json()["details"]["reason"] == "OTHER_SUPPLIER", wrong.text
    another = await model(maker, shops)
    for override in (
        {"lines": [{"product_variant_id": another[0], "size_id": another[1], "quantity": 1}]},
        {
            "lines": [
                {
                    "product_variant_id": lot["product_variant_id"],
                    "size_id": lot["size_id"],
                    "quantity": 1,
                },
                {"product_variant_id": another[0], "size_id": another[1], "quantity": 1},
            ]
        },
    ):
        answer = await send_back(maker, shops, lot, 1, **override)
        assert answer.json()["details"]["reason"] == "NOT_THE_LOT", answer.text

    # One sold, still on the shelf until the till says so: two in stock, one
    # on hand to send back.
    assert (await sold(maker, shops, lot["stock_lot_id"], 1)).status_code == 201
    over = await send_back(maker, shops, lot, 2)
    assert over.json()["details"] == {"reason": "MORE_THAN_ON_HAND", "on_hand": 1}, over.text
    assert (await send_back(maker, shops, lot, 1)).status_code == 201
    assert (await borrowed(maker, shops)).json()["items"] == []
    assert counts(await lot_of(maker, shops, on_hand="false")) == (3, 1, 2, 0)

    # A return cancelled puts them back on hand, and on the shelf.
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        undone = await client.post(
            f"/api/v1/supplier-returns/{back.json()['id']}/cancel", json={"reason": "не взяла"}
        )
    assert undone.status_code == 200, undone.text
    assert counts(await lot_of(maker, shops)) == (3, 1, 1, 1)


async def test_two_marks_in_one_instant_never_take_more_than_is_on_hand(maker):
    shops = await make_two_shops(maker)
    coat = await model(maker, shops)
    neighbour = (await supplier(maker, shops, "Сусідка Оксана")).json()["id"]
    assert (
        await receive(maker, shops, receipt(shops, coat, qty=1, supplier_id=neighbour))
    ).status_code == 201
    lot = await lot_of(maker, shops)
    answers = await asyncio.gather(
        sold(maker, shops, lot["stock_lot_id"], 1),
        send_back(maker, shops, lot, 1),
    )
    assert sorted(answer.status_code for answer in answers) == [201, 422]
    assert (await lot_of(maker, shops, on_hand="false"))["on_hand"] == 0


async def test_the_downgrade_refuses_while_a_receipt_names_its_supplier():
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_borrowed_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        await _run(config, "downgrade", "0028_order_shipping", database=name)
        await _run(config, "upgrade", "head", database=name)
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        shops = await make_two_shops(fresh)
        coat = await model(fresh, shops)
        neighbour = (await supplier(fresh, shops, "Сусідка Оксана")).json()["id"]
        assert (
            await receive(fresh, shops, receipt(shops, coat, supplier_id=neighbour))
        ).status_code == 201
        with pytest.raises(Exception, match="Receipts name whose goods they were"):
            await _run(config, "downgrade", "0028_order_shipping", database=name)
        async with engine.connect() as connection:
            assert (
                await connection.scalar(
                    text("SELECT count(*) FROM goods_receipt WHERE supplier_id IS NOT NULL")
                )
            ) == 1
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
