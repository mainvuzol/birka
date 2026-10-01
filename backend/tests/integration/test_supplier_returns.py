"""Returns to a supplier (owner decisions, 2026-10-01), over HTTP against
real PostgreSQL.

- Suppliers are one list for the network, kept by whoever returns goods: the
  owner and managers. A name is never written twice.
- Goods go back from a warehouse as one document with a list, and only
  goods free to sell. Never from a «Брак».
- A confirmed unit from «Брак» goes back from «Брак», and comes back there.
- A return is cancelled whole, once, saying why: its goods go back where
  they left, and both stay in the history.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from app.modules.inventory.models import MovementType, StockMovement
from app.modules.inventory.service import find_divergences
from app.modules.tenancy.models import Store, StoreState
from tests.conftest import provision_location, requires_database
from tests.integration.test_damaged_units import damaged_bin, listed, step, units_left_add_up
from tests.integration.test_shared_warehouse import (
    TwoShops,
    api,
    make_two_shops,
    quantity_at,
    stock_a_coat,
)
from tests.integration.test_till_returns import give_bin

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


async def supplier(maker, shops: TwoShops, name: str = "Беларді", phone: str | None = None):
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        return await client.post(
            "/api/v1/suppliers",
            json={"store_id": str(shops.primary_store), "name": name, "phone": phone},
        )


async def coats(maker, shops: TwoShops, qty: int = 5) -> tuple[str, str]:
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=qty
        )


def document(
    shops: TwoShops,
    supplier_id: str,
    *lines: tuple[str, str, int],
    location: uuid.UUID | None = None,
    command_id: str | None = None,
) -> dict:
    return {
        "command_id": command_id or str(uuid.uuid4()),
        "store_id": str(shops.primary_store),
        "location_id": str(location or shops.shared_warehouse),
        "supplier_id": supplier_id,
        "lines": [
            {"product_variant_id": variant, "size_id": size, "quantity": quantity}
            for variant, size, quantity in lines
        ],
        "note": "не продалось за сезон",
    }


async def send(maker, shops: TwoShops, payload: dict, permissions=MANAGER):
    async with api(maker, shops.scope(shops.primary_store, permissions)) as client:
        return await client.post("/api/v1/supplier-returns", json=payload)


async def cancel(maker, shops: TwoShops, return_id: str, reason: str = "постачальник не взяв"):
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        return await client.post(
            f"/api/v1/supplier-returns/{return_id}/cancel", json={"reason": reason}
        )


async def movements(maker, reference_id: str) -> list[tuple[str, int]]:
    async with maker() as session:
        rows = await session.execute(
            select(StockMovement.movement_type, StockMovement.quantity_delta).where(
                StockMovement.reference_id == uuid.UUID(reference_id)
            )
        )
        return [(row[0].value, row[1]) for row in rows]


async def test_suppliers_are_one_list_kept_by_whoever_returns(maker):
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store, SELLER)) as client:
        assert (
            await client.get("/api/v1/suppliers", params={"store_id": str(shops.primary_store)})
        ).status_code == 403
        assert (
            await client.post(
                "/api/v1/suppliers", json={"store_id": str(shops.primary_store), "name": "X"}
            )
        ).status_code == 403

    added = await supplier(maker, shops, "Беларді", "067 123 45 67")
    assert added.status_code == 201, added.text
    # One supplier, however it is spaced or capitalised.
    again = await supplier(maker, shops, "  беларді ")
    assert again.status_code == 422, again.text
    assert again.json()["details"] == {
        "reason": "DUPLICATE",
        "supplier_id": added.json()["id"],
        "name": "Беларді",
    }
    other = await supplier(maker, shops, "Арно")
    assert other.status_code == 201, other.text

    async with api(maker, shops.scope(shops.child_store, MANAGER)) as client:
        # The network's list, from either store.
        listed_ = await client.get("/api/v1/suppliers", params={"store_id": str(shops.child_store)})
        assert [s["name"] for s in listed_.json()] == ["Арно", "Беларді"]
        edited = await client.put(
            f"/api/v1/suppliers/{added.json()['id']}",
            json={"store_id": str(shops.child_store), "name": "Беларді Італія", "phone": None},
        )
        assert edited.status_code == 200, edited.text
        assert (edited.json()["name"], edited.json()["phone"]) == ("Беларді Італія", None)
        clash = await client.put(
            f"/api/v1/suppliers/{added.json()['id']}",
            json={"store_id": str(shops.child_store), "name": "АРНО"},
        )
        assert clash.json()["details"]["reason"] == "DUPLICATE"

    foreign = await make_two_shops(maker)
    async with api(maker, foreign.scope(foreign.primary_store, MANAGER)) as client:
        assert (
            await client.put(
                f"/api/v1/suppliers/{added.json()['id']}",
                json={"store_id": str(foreign.primary_store), "name": "Чуже"},
            )
        ).status_code == 404
        assert (
            await client.get("/api/v1/suppliers", params={"store_id": str(foreign.primary_store)})
        ).json() == []


async def test_goods_go_back_from_a_warehouse_and_come_back_when_cancelled(maker):
    shops = await make_two_shops(maker)
    variant, size = await coats(maker, shops, qty=5)
    supplier_id = (await supplier(maker, shops)).json()["id"]
    command = str(uuid.uuid4())
    payload = document(shops, supplier_id, (variant, size, 2), command_id=command)

    sent = await send(maker, shops, payload)
    assert sent.status_code == 201, sent.text
    body = sent.json()
    assert (body["supplier"]["name"], body["note"], body["cancelled"]) == (
        "Беларді",
        "не продалось за сезон",
        None,
    )
    [line] = body["lines"]
    assert line["quantity"] == 2 and line["display_name"].startswith("Лоран")
    assert await movements(maker, body["id"]) == [("SUPPLIER_RETURN", -2)]
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 3

    # The same command is answered with what it did; another body is refused.
    assert (await send(maker, shops, payload)).json() == body
    # And never to someone who may not return goods: refused before any
    # answer is replayed.
    replayed = await send(maker, shops, payload, permissions=SELLER)
    assert replayed.status_code == 403, replayed.text
    assert replayed.json()["code"] == "PERMISSION_DENIED"
    changed = await send(
        maker, shops, document(shops, supplier_id, (variant, size, 1), command_id=command)
    )
    assert changed.status_code == 409, changed.text

    # Another supplier's return here, and another store's return there.
    arno = (await supplier(maker, shops, "Арно")).json()["id"]
    other = await send(maker, shops, document(shops, arno, (variant, size, 1)))
    assert other.status_code == 201, other.text
    async with api(maker, shops.scope(shops.child_store, MANAGER)) as client:
        theirs = await client.post(
            "/api/v1/supplier-returns",
            json=document(shops, supplier_id, (variant, size, 1))
            | {"store_id": str(shops.child_store)},
        )
        assert theirs.status_code == 201, theirs.text
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        page = await client.get(
            "/api/v1/supplier-returns",
            params={"store_id": str(shops.primary_store), "supplier_id": supplier_id},
        )
        assert [item["id"] for item in page.json()["items"]] == [body["id"]]
        every = await client.get(
            "/api/v1/supplier-returns", params={"store_id": str(shops.primary_store)}
        )
        assert [item["id"] for item in every.json()["items"]] == [
            other.json()["id"],
            body["id"],
        ]
        # Each store sees its own.
        assert (
            await client.get(
                "/api/v1/supplier-returns", params={"store_id": str(shops.child_store)}
            )
        ).status_code == 403

    blank = await cancel(maker, shops, body["id"], reason="   ")
    assert blank.status_code == 422, blank.text
    undone = await cancel(maker, shops, body["id"])
    assert undone.status_code == 200, undone.text
    assert undone.json()["cancelled"]["reason"] == "постачальник не взяв"
    # Once: again, it is answered as it is, and nothing moves twice.
    twice = await cancel(maker, shops, body["id"], reason="ще раз")
    assert twice.json() == undone.json()
    async with maker() as session:
        # Five, less the two other returns that stand.
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 3
        assert await find_divergences(session, organization_id=shops.organization_id) == []
        cancels = (
            await session.scalars(
                select(StockMovement.quantity_delta).where(
                    StockMovement.movement_type == MovementType.SUPPLIER_RETURN_CANCEL,
                    StockMovement.product_variant_id == uuid.UUID(variant),
                )
            )
        ).all()
    assert cancels == [2]


async def test_only_goods_free_to_sell_go_back(maker):
    shops = await make_two_shops(maker)
    variant, size = await coats(maker, shops, qty=2)
    supplier_id = (await supplier(maker, shops)).json()["id"]
    too_many = await send(maker, shops, document(shops, supplier_id, (variant, size, 3)))
    assert too_many.status_code == 409, too_many.text
    assert too_many.json()["code"] == "INSUFFICIENT_STOCK"

    async with api(maker, shops.scope(shops.primary_store)) as client:
        held = await client.post(
            "/api/v1/orders",
            json={
                "store_id": str(shops.primary_store),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": variant,
                        "size_id": size,
                        "source_location_id": str(shops.shared_warehouse),
                        "quantity": 1,
                        "unit_price": "1500.00",
                    }
                ],
            },
        )
    assert held.status_code == 201, held.text
    # One of the two is held for a customer.
    refused = await send(maker, shops, document(shops, supplier_id, (variant, size, 2)))
    assert refused.json()["code"] == "INSUFFICIENT_STOCK"
    fits = await send(maker, shops, document(shops, supplier_id, (variant, size, 1)))
    assert fits.status_code == 201, fits.text

    duplicate = document(shops, supplier_id, (variant, size, 1), (variant, size, 1))
    assert (await send(maker, shops, duplicate)).json()["details"]["reason"] == "DUPLICATE_LINE"


async def test_who_returns_what_and_from_where(maker):
    shops = await make_two_shops(maker)
    variant, size = await coats(maker, shops, qty=2)
    supplier_id = (await supplier(maker, shops)).json()["id"]
    line = (variant, size, 1)

    # Not a seller.
    seller = await send(maker, shops, document(shops, supplier_id, line), permissions=SELLER)
    assert seller.status_code == 403, seller.text
    # Not from a warehouse the store does not reach.
    async with maker() as session:
        elsewhere = await provision_location(session, organization_id=shops.organization_id)
        await session.commit()
    unreached = await send(maker, shops, document(shops, supplier_id, line, location=elsewhere))
    assert unreached.status_code == 403, unreached.text
    assert unreached.json()["code"] == "LOCATION_ACCESS_DENIED"
    # Never from a «Брак»: a unit there goes back from «Брак».
    bin_ = await give_bin(maker, shops.organization_id, shops.primary_store)
    from_bin = await send(maker, shops, document(shops, supplier_id, line, location=bin_))
    assert from_bin.json()["details"]["reason"] == "FROM_DAMAGED"
    # Not to another network's supplier.
    foreign = await make_two_shops(maker)
    theirs = (await supplier(maker, foreign, "Чужий")).json()["id"]
    assert (await send(maker, shops, document(shops, theirs, line))).status_code == 404
    # Not from a store that does not trade.
    async with maker() as session:
        store = await session.get(Store, shops.primary_store)
        assert store is not None
        store.state = StoreState.BLOCKED
        await session.commit()
    blocked = await send(maker, shops, document(shops, supplier_id, line))
    assert blocked.json()["code"] == "STORE_NOT_TRADING"

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2


async def test_a_confirmed_unit_goes_back_from_the_bin_and_comes_back_there(maker):
    shops, bin_, variant, size = await damaged_bin(maker)
    supplier_id = (await supplier(maker, shops)).json()["id"]
    [unit] = await listed(maker, shops)
    to_supplier = {"supplier_id": supplier_id, "note": "шов розійшовся"}

    # Not before its damage is confirmed.
    early = await step(
        maker, shops, unit["id"], "return-to-supplier", to_supplier, permissions=MANAGER
    )
    assert early.status_code == 409, early.text
    assert (await step(maker, shops, unit["id"], "take")).status_code == 200
    assert (await step(maker, shops, unit["id"], "confirm", {"note": "брак"})).status_code == 200
    # Not by a seller, though a seller handles «Брак».
    seller = await step(maker, shops, unit["id"], "return-to-supplier", to_supplier)
    assert seller.status_code == 403, seller.text

    gone = await step(
        maker, shops, unit["id"], "return-to-supplier", to_supplier, permissions=MANAGER
    )
    assert gone.status_code == 200, gone.text
    assert gone.json()["status"] == "SUPPLIER"
    # Pressed again, it is answered as it is — to whoever may do it.
    again = await step(
        maker, shops, unit["id"], "return-to-supplier", to_supplier, permissions=MANAGER
    )
    assert again.json() == gone.json()
    assert (
        await step(maker, shops, unit["id"], "return-to-supplier", to_supplier)
    ).status_code == 403
    assert await listed(maker, shops) == []
    await units_left_add_up(maker, shops, bin_, variant, size)

    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        [document_] = (
            await client.get(
                "/api/v1/supplier-returns", params={"store_id": str(shops.primary_store)}
            )
        ).json()["items"]
    assert document_["damaged_unit_id"] == unit["id"]
    assert document_["location_id"] == str(bin_)
    assert [line["quantity"] for line in document_["lines"]] == [1]
    # Its return comes back through «Брак», not the section for warehouses.
    wrong_door = await cancel(maker, shops, document_["id"])
    assert wrong_door.json()["details"]["reason"] == "FROM_DAMAGED"

    payload = {"supplier_return_id": document_["id"], "reason": "постачальник відмовив"}
    back = await step(
        maker, shops, unit["id"], "cancel-supplier-return", payload, permissions=MANAGER
    )
    assert back.status_code == 200, back.text
    assert back.json()["status"] == "CONFIRMED"
    assert [u["id"] for u in await listed(maker, shops)] == [unit["id"]]
    await units_left_add_up(maker, shops, bin_, variant, size)
    # Cancelled once: again, the unit is answered as it is.
    twice = await step(
        maker, shops, unit["id"], "cancel-supplier-return", payload, permissions=MANAGER
    )
    assert twice.json()["status"] == "CONFIRMED"
    assert (
        await step(maker, shops, unit["id"], "cancel-supplier-return", payload)
    ).status_code == 403
    await units_left_add_up(maker, shops, bin_, variant, size)

    # And it may go back again, as a return of its own.
    second = await step(
        maker, shops, unit["id"], "return-to-supplier", to_supplier, permissions=MANAGER
    )
    assert second.json()["status"] == "SUPPLIER"
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        items = (
            await client.get(
                "/api/v1/supplier-returns", params={"store_id": str(shops.primary_store)}
            )
        ).json()["items"]
    assert [item["cancelled"] is None for item in items] == [True, False]
    # The first, cancelled, cannot be cancelled again over the second.
    stale = await step(
        maker, shops, unit["id"], "cancel-supplier-return", payload, permissions=MANAGER
    )
    assert stale.json()["status"] == "SUPPLIER"
    await units_left_add_up(maker, shops, bin_, variant, size)


async def test_the_downgrade_refuses_while_a_supplier_is_on_the_list():
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_suppliers_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "0025_store_states", database=name)
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        shops = await make_two_shops(fresh)
        roles: dict[str, uuid.UUID] = {}
        async with engine.begin() as connection:
            for code, held in (("STOCKKEEPER", "inventory:adjust"), ("CASHIER", "sale:create")):
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

        async def granted() -> dict[str, bool]:
            async with engine.connect() as connection:
                return {
                    code: bool(
                        await connection.scalar(
                            text(
                                "SELECT count(*) FROM role_permission WHERE role_id = :id "
                                "AND permission_code = 'supplier:return'"
                            ),
                            {"id": role_id},
                        )
                    )
                    for code, role_id in roles.items()
                }

        # Whoever may correct stock, whatever the role is called; nobody else.
        assert await granted() == {"STOCKKEEPER": True, "CASHIER": False}
        await _run(config, "downgrade", "0025_store_states", database=name)
        assert await granted() == {"STOCKKEEPER": False, "CASHIER": False}
        await _run(config, "upgrade", "head", database=name)
        assert (await supplier(fresh, shops)).status_code == 201
        with pytest.raises(Exception, match="Suppliers are on the list"):
            await _run(config, "downgrade", "0025_store_states", database=name)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
