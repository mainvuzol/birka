"""The «Брак» section (owner decisions, 2026-10-01), over HTTP against real PostgreSQL.

- A unit returned damaged waits in the store's «Брак», one row per unit.
- Anyone who takes returns may take it for inspection, visibly to the others.
- It then goes back on sale — only to the warehouse it was sold from — or is
  confirmed damaged and stays; a confirmed unit may be written off.
- Stock in «Брак» changes only through returns and this section, so the
  units still there always add up to what «Брак» holds.

All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.damaged.models import IN_BIN, DamagedUnit
from app.modules.inventory.models import MovementReason, MovementType, StockMovement
from app.modules.inventory.service import find_divergences
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import TwoShops, api, key, make_two_shops, quantity_at
from tests.integration.test_till_returns import body, give_bin, part, sold

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


async def damaged_bin(
    maker: async_sessionmaker[AsyncSession], *, damaged: int = 1, intact: int = 0
) -> tuple[TwoShops, uuid.UUID, str, str]:
    """A store with its «Брак», and a return of `damaged` coats into it."""
    shops = await make_two_shops(maker)
    bin_ = await give_bin(maker, shops.organization_id, shops.primary_store)
    sale, variant, size = await sold(maker, shops, qty=damaged + intact, stocked=damaged + intact)
    parts = [part(sale, damaged, "DAMAGED")] + ([part(sale, intact, "INTACT")] if intact else [])
    async with api(maker, shops.scope(shops.primary_store)) as client:
        taken = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds", json=body(*parts), headers=key()
        )
    assert taken.status_code == 201, taken.text
    return shops, bin_, variant, size


async def listed(maker, shops: TwoShops, permissions=SELLER) -> list[dict]:
    async with api(maker, shops.scope(shops.primary_store, permissions)) as client:
        response = await client.get(
            "/api/v1/damaged-units", params={"store_id": str(shops.primary_store)}
        )
    assert response.status_code == 200, response.text
    return response.json()["units"]


async def step(maker, shops: TwoShops, unit: str, action: str, payload=None, **scope):
    permissions = scope.get("permissions", SELLER)
    who = shops.scope(shops.primary_store, permissions)
    if "user_id" in scope:
        who = type(who)(
            user_id=scope["user_id"],
            organization_id=who.organization_id,
            store_permissions=who.store_permissions,
        )
    async with api(maker, who) as client:
        return await client.post(f"/api/v1/damaged-units/{unit}/{action}", json=payload or {})


async def units_left_add_up(maker, shops: TwoShops, bin_: uuid.UUID, variant: str, size: str):
    """The invariant this section exists to keep."""
    async with maker() as session:
        in_bin = await session.scalar(
            select(func.count())
            .select_from(DamagedUnit)
            .where(
                DamagedUnit.location_id == bin_,
                DamagedUnit.status.in_([status.value for status in IN_BIN]),
            )
        )
        assert in_bin == await quantity_at(session, bin_, variant, size)
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_a_damaged_return_waits_in_the_bin_one_row_per_unit(maker):
    shops, bin_, variant, size = await damaged_bin(maker, damaged=2, intact=1)
    units = await listed(maker, shops)
    assert len(units) == 2
    assert {unit["status"] for unit in units} == {"AWAITING"}
    assert units[0]["size"] == "M"
    assert units[0]["status_by"] is None
    assert units[0]["sold_from_location_id"] == str(shops.shared_warehouse)
    assert units[0]["sold_from_location_name"] == "Основний склад"
    await units_left_add_up(maker, shops, bin_, variant, size)


async def test_taking_a_unit_shows_the_others_who_is_looking(maker):
    shops, _, _, _ = await damaged_bin(maker)
    [unit] = await listed(maker, shops)
    taken = await step(maker, shops, unit["id"], "take")
    assert taken.status_code == 200, taken.text
    assert taken.json()["status"] == "INSPECTING"
    assert taken.json()["status_by"] == "Оля"
    again = await step(maker, shops, unit["id"], "take")
    assert again.json() == taken.json()
    someone_else = await step(maker, shops, unit["id"], "take", user_id=uuid.uuid4())
    assert someone_else.status_code == 409
    assert someone_else.json()["code"] == "DAMAGED_UNIT_CHANGED"
    assert someone_else.json()["details"]["actual"] == "INSPECTING"


async def test_an_inspected_unit_goes_back_on_sale_where_it_was_sold_and_only_there(maker):
    shops, bin_, variant, size = await damaged_bin(maker)
    [unit] = await listed(maker, shops)
    await step(maker, shops, unit["id"], "take")
    elsewhere = await step(
        maker,
        shops,
        unit["id"],
        "return-to-sale",
        {"destination_location_id": str(shops.child_warehouse)},
    )
    assert elsewhere.status_code == 422, elsewhere.text

    back = await step(
        maker,
        shops,
        unit["id"],
        "return-to-sale",
        {"destination_location_id": str(shops.shared_warehouse)},
    )
    assert back.status_code == 200, back.text
    assert back.json()["status"] == "RETURNED"
    again = await step(
        maker,
        shops,
        unit["id"],
        "return-to-sale",
        {"destination_location_id": str(shops.shared_warehouse)},
    )
    assert again.status_code == 200
    assert await listed(maker, shops) == []
    async with maker() as session:
        assert await quantity_at(session, bin_, variant, size) == 0
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 1
        legs = (
            await session.scalars(
                select(StockMovement.movement_type).where(
                    StockMovement.organization_id == shops.organization_id,
                    StockMovement.movement_type.in_(
                        [MovementType.TRANSFER_OUT, MovementType.TRANSFER_IN]
                    ),
                )
            )
        ).all()
        assert sorted(legs) == [MovementType.TRANSFER_IN, MovementType.TRANSFER_OUT]
    await units_left_add_up(maker, shops, bin_, variant, size)


async def test_nothing_leaves_the_bin_before_someone_has_looked(maker):
    shops, _, _, _ = await damaged_bin(maker)
    [unit] = await listed(maker, shops)
    for action, payload in [
        ("return-to-sale", {"destination_location_id": str(shops.shared_warehouse)}),
        ("confirm", {}),
        ("write-off", {}),
    ]:
        refused = await step(maker, shops, unit["id"], action, payload)
        assert refused.status_code == 409, (action, refused.text)
        assert refused.json()["details"]["actual"] == "AWAITING"


async def test_a_confirmed_unit_stays_until_it_is_written_off(maker):
    shops, bin_, variant, size = await damaged_bin(maker)
    [unit] = await listed(maker, shops)
    await step(maker, shops, unit["id"], "take")
    confirmed = await step(maker, shops, unit["id"], "confirm", {"note": "розірвана підкладка"})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "CONFIRMED"
    assert confirmed.json()["note"] == "розірвана підкладка"
    [still] = await listed(maker, shops)
    assert still["status"] == "CONFIRMED"
    await units_left_add_up(maker, shops, bin_, variant, size)

    # A seller may write it off: the owner gave it to whoever takes returns.
    gone = await step(maker, shops, unit["id"], "write-off", {"note": "не ремонтується"})
    assert gone.status_code == 200, gone.text
    assert gone.json()["status"] == "WRITTEN_OFF"
    assert (await step(maker, shops, unit["id"], "write-off")).status_code == 200
    assert await listed(maker, shops) == []
    async with maker() as session:
        assert await quantity_at(session, bin_, variant, size) == 0
        reason = await session.scalar(
            select(StockMovement.reason_code).where(
                StockMovement.location_id == bin_,
                StockMovement.movement_type == MovementType.ADJUSTMENT,
            )
        )
        assert reason == MovementReason.DAMAGED
    await units_left_add_up(maker, shops, bin_, variant, size)


async def test_a_confirmed_unit_may_be_looked_at_again_and_go_back_on_sale(maker):
    shops, bin_, variant, size = await damaged_bin(maker)
    [unit] = await listed(maker, shops)
    await step(maker, shops, unit["id"], "take")
    await step(maker, shops, unit["id"], "confirm")
    second = await step(maker, shops, unit["id"], "take")
    assert second.json()["status"] == "INSPECTING"
    back = await step(
        maker,
        shops,
        unit["id"],
        "return-to-sale",
        {"destination_location_id": str(shops.shared_warehouse)},
    )
    assert back.json()["status"] == "RETURNED"
    await units_left_add_up(maker, shops, bin_, variant, size)


async def test_the_bin_changes_through_nothing_else(maker):
    # One coat back intact, so the shared warehouse has one to move.
    shops, bin_, variant, size = await damaged_bin(maker, damaged=1, intact=1)
    everything = frozenset(Permission)
    async with api(maker, shops.scope(shops.primary_store, everything)) as client:
        delivered = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shops.primary_store),
                "location_id": str(bin_),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 1}],
            },
            headers=key(),
        )
        corrected = await client.post(
            "/api/v1/inventory/adjustments",
            json={
                "store_id": str(shops.primary_store),
                "location_id": str(bin_),
                "command_id": str(uuid.uuid4()),
                "product_variant_id": variant,
                "size_id": size,
                "quantity_delta": -1,
                "reason_code": "DAMAGED",
            },
            headers=key(),
        )
        moved_in = await client.post(
            "/api/v1/transfers",
            json={
                "store_id": str(shops.primary_store),
                "command_id": str(uuid.uuid4()),
                "from_location_id": str(shops.shared_warehouse),
                "to_location_id": str(bin_),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 1}],
            },
            headers=key(),
        )
    for refused in (delivered, corrected, moved_in):
        assert refused.status_code == 409, refused.text
        assert refused.json()["code"] == "DAMAGED_STOCK_CLOSED"
    await units_left_add_up(maker, shops, bin_, variant, size)


async def test_the_bin_is_for_whoever_takes_returns_in_that_store(maker):
    shops, _, _, _ = await damaged_bin(maker)
    [unit] = await listed(maker, shops)
    without = frozenset(SELLER - {Permission.DAMAGED_HANDLE})
    assert (await step(maker, shops, unit["id"], "take", permissions=without)).status_code == 403
    async with api(maker, shops.scope(shops.child_store)) as client:
        other = await client.get(
            "/api/v1/damaged-units", params={"store_id": str(shops.primary_store)}
        )
        foreign = await client.post(f"/api/v1/damaged-units/{unit['id']}/take", json={})
    assert other.status_code == 403
    assert foreign.status_code == 403
    assert (await step(maker, shops, str(uuid.uuid4()), "take")).status_code == 404


async def test_two_people_returning_one_unit_at_once_move_it_once(maker):
    shops, bin_, variant, size = await damaged_bin(maker)
    [unit] = await listed(maker, shops)
    await step(maker, shops, unit["id"], "take")
    destination = {"destination_location_id": str(shops.shared_warehouse)}
    first, second = await asyncio.gather(
        step(maker, shops, unit["id"], "return-to-sale", destination),
        step(maker, shops, unit["id"], "return-to-sale", destination, user_id=uuid.uuid4()),
    )
    assert first.status_code == second.status_code == 200
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 1
    await units_left_add_up(maker, shops, bin_, variant, size)


async def test_the_migration_gives_earlier_damaged_returns_their_units():
    """Returns taken damaged under `0019` are in «Брак» by the ledger; `0020`
    gives them their rows, one per unit, waiting — and grants «Брак» to every
    role that takes returns."""
    from sqlalchemy import text

    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_damaged_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        shops, bin_, variant, size = await damaged_bin(fresh, damaged=2)
        await _run(config, "downgrade", "0019_till_returns", database=name)
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "INSERT INTO role (id, organization_id, code, name, is_system, created_at) "
                    "VALUES (:id, :org, 'CASHIER', 'Касир', false, now())"
                ),
                {"id": (cashier := uuid.uuid4()), "org": shops.organization_id},
            )
            await connection.execute(
                text(
                    "INSERT INTO role_permission (role_id, permission_code) "
                    "VALUES (:id, 'sale:refund')"
                ),
                {"id": cashier},
            )
        await _run(config, "upgrade", "head", database=name)
        units = await listed(fresh, shops)
        assert [unit["status"] for unit in units] == ["AWAITING", "AWAITING"]
        async with engine.connect() as connection:
            granted = await connection.scalar(
                text(
                    "SELECT count(*) FROM role_permission "
                    "WHERE role_id = :id AND permission_code = 'damaged:handle'"
                ),
                {"id": cashier},
            )
        assert granted == 1
        await units_left_add_up(fresh, shops, bin_, variant, size)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
