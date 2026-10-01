"""Nothing on the shelf (owner decisions, 2026-10-01; Q-G), over HTTP against
real PostgreSQL.

- A line with nothing on the shelf is dropped from the sale and its shortage
  recorded; the rest of the basket is sold.
- When that leaves nothing to sell, the shortage is still recorded, without a
  sale (`POST /shelf-shortages`).
- Either way the ledger takes off only what it believed in (I25), and one
  basket becomes a sale or an empty shelf, never both (I20).

All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from app.modules.inventory.models import MovementReason, StockMovement
from app.modules.inventory.service import ReservationRequest, find_divergences, reserve_stock
from app.modules.sales.models import Sale
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import (
    TwoShops,
    api,
    key,
    make_two_shops,
    quantity_at,
    stock_a_coat,
)
from tests.integration.test_till_returns import give_bin

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
# The default manager holds «фізично відсутній»; the default seller does not.
MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def coat(maker, shops: TwoShops, qty: int) -> tuple[str, str]:
    """A coat of its own model, `qty` of it in the shared warehouse."""
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        return await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=qty
        )


def line(shops: TwoShops, variant: str, size: str, qty: int) -> dict[str, Any]:
    return {
        "product_variant_id": variant,
        "size_id": size,
        "source_location_id": str(shops.shared_warehouse),
        "quantity": qty,
        "unit_price": "1500.00",
    }


async def sell(maker, shops: TwoShops, body: dict[str, Any], permissions=MANAGER) -> httpx.Response:
    async with api(maker, shops.scope(shops.primary_store, permissions)) as client:
        return await client.post("/api/v1/sales", json=body, headers=key())


def shelf_body(shops: TwoShops, command: uuid.UUID, *lines: tuple[str, str, int]) -> dict:
    return {
        "store_id": str(shops.primary_store),
        "command_id": str(command),
        "lines": [
            {
                "source_location_id": str(shops.shared_warehouse),
                "product_variant_id": variant,
                "size_id": size,
                "quantity": qty,
            }
            for variant, size, qty in lines
        ],
    }


async def empty_shelf(
    maker, shops: TwoShops, body: dict[str, Any], permissions=MANAGER
) -> httpx.Response:
    async with api(maker, shops.scope(shops.primary_store, permissions)) as client:
        return await client.post("/api/v1/shelf-shortages", json=body)


async def missing_at_sale(maker, variant: str) -> list[tuple[int, str | None, uuid.UUID | None]]:
    async with maker() as session:
        rows = await session.execute(
            select(
                StockMovement.quantity_delta,
                StockMovement.reference_type,
                StockMovement.reference_id,
            )
            .where(
                StockMovement.product_variant_id == uuid.UUID(variant),
                StockMovement.reason_code == MovementReason.MISSING_AT_SALE,
            )
            .order_by(StockMovement.created_at)
        )
        return [tuple(row) for row in rows]


async def ledger_holds(maker, shops: TwoShops) -> None:
    async with maker() as session:
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def held(maker, shops: TwoShops, variant: str, size: str) -> int:
    async with maker() as session:
        return await quantity_at(session, shops.shared_warehouse, variant, size)


# --- a line with nothing on the shelf, and the rest sold --------------------


async def test_a_line_with_nothing_on_the_shelf_is_dropped_and_the_rest_sold(maker):
    shops = await make_two_shops(maker)
    empty, empty_size = await coat(maker, shops, qty=2)
    there, there_size = await coat(maker, shops, qty=1)
    body = {
        "store_id": str(shops.primary_store),
        "command_id": str(uuid.uuid4()),
        "lines": [line(shops, empty, empty_size, 2), line(shops, there, there_size, 1)],
        "missing_in_store": [{"line_index": 0, "quantity": 0}],
    }

    sold = await sell(maker, shops, body)

    assert sold.status_code == 201, sold.text
    sale = sold.json()
    assert [item["product_variant_id"] for item in sale["items"]] == [there]
    assert sale["total"] == "1500.00"
    assert len(sale["shortages"]) == 1
    # The two the ledger believed in are taken off, naming the sale.
    assert await missing_at_sale(maker, empty) == [(-2, "sale", uuid.UUID(sale["id"]))]
    assert await held(maker, shops, empty, empty_size) == 0
    assert await held(maker, shops, there, there_size) == 0
    await ledger_holds(maker, shops)

    # A retry is the same sale, not a second shortage.
    again = await sell(maker, shops, body)
    assert again.status_code == 201, again.text
    assert again.json()["id"] == sale["id"]
    assert len(await missing_at_sale(maker, empty)) == 1


async def test_only_what_the_ledger_believed_in_is_taken_off(maker):
    """Three went for, one believed in: one taken off (I25)."""
    shops = await make_two_shops(maker)
    empty, empty_size = await coat(maker, shops, qty=1)
    there, there_size = await coat(maker, shops, qty=1)
    sold = await sell(
        maker,
        shops,
        {
            "store_id": str(shops.primary_store),
            "command_id": str(uuid.uuid4()),
            "lines": [line(shops, empty, empty_size, 3), line(shops, there, there_size, 1)],
            "missing_in_store": [{"line_index": 0, "quantity": 0}],
        },
    )
    assert sold.status_code == 201, sold.text
    assert [delta for delta, _, _ in await missing_at_sale(maker, empty)] == [-1]
    await ledger_holds(maker, shops)


async def test_a_basket_with_nothing_on_the_shelf_is_not_a_sale(maker):
    shops = await make_two_shops(maker)
    empty, empty_size = await coat(maker, shops, qty=2)
    refused = await sell(
        maker,
        shops,
        {
            "store_id": str(shops.primary_store),
            "command_id": str(uuid.uuid4()),
            "lines": [line(shops, empty, empty_size, 2)],
            "missing_in_store": [{"line_index": 0, "quantity": 0}],
        },
    )
    assert refused.status_code == 422, refused.text
    assert refused.json()["details"]["reason"] == "NOTHING_TO_SELL"
    assert await missing_at_sale(maker, empty) == []
    assert await held(maker, shops, empty, empty_size) == 2


async def test_nothing_on_the_shelf_still_takes_the_shortage_permission(maker):
    shops = await make_two_shops(maker)
    empty, empty_size = await coat(maker, shops, qty=2)
    there, there_size = await coat(maker, shops, qty=1)
    refused = await sell(
        maker,
        shops,
        {
            "store_id": str(shops.primary_store),
            "command_id": str(uuid.uuid4()),
            "lines": [line(shops, empty, empty_size, 2), line(shops, there, there_size, 1)],
            "missing_in_store": [{"line_index": 0, "quantity": 0}],
        },
        permissions=SELLER,
    )
    assert refused.status_code == 403
    assert await held(maker, shops, empty, empty_size) == 2


# --- the empty shelf: no sale, and the shortage recorded ---------------------


async def test_an_empty_shelf_is_recorded_without_a_sale(maker):
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, qty=1)
    command = uuid.uuid4()

    response = await empty_shelf(maker, shops, shelf_body(shops, command, (variant, size, 2)))

    assert response.status_code == 201, response.text
    recorded = response.json()
    assert recorded["command_id"] == str(command)
    [entry] = recorded["lines"]
    assert entry["product_variant_id"] == variant
    assert entry["size"] == "M"
    assert entry["display_name"].endswith("шоколад")
    # Two went for, one believed in: one taken off.
    assert (entry["requested"], entry["removed"]) == (2, 1)
    assert await missing_at_sale(maker, variant) == [
        (-1, "shelf_shortage", uuid.UUID(recorded["id"]))
    ]
    assert await held(maker, shops, variant, size) == 0
    async with maker() as session:
        assert (
            await session.scalar(
                select(Sale.id).where(
                    Sale.organization_id == shops.organization_id, Sale.command_id == command
                )
            )
            is None
        )
        actions = set(
            (
                await session.scalars(
                    select(AuditLog.action).where(
                        AuditLog.organization_id == shops.organization_id,
                        AuditLog.action.in_(["sale.empty_shelf", "inventory.missing_at_sale"]),
                    )
                )
            ).all()
        )
    assert actions == {"sale.empty_shelf", "inventory.missing_at_sale"}
    await ledger_holds(maker, shops)

    async with api(maker, shops.scope(shops.primary_store, SELLER)) as client:
        read = await client.get(f"/api/v1/shelf-shortages/{recorded['id']}")
    assert read.status_code == 200, read.text
    assert read.json() == recorded


async def test_a_retry_after_a_delivery_takes_nothing_off(maker):
    """Recorded even when the ledger believed in none of it, so a late retry
    is answered with that and never takes off what arrived since."""
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, qty=0)
    body = shelf_body(shops, uuid.uuid4(), (variant, size, 1))
    first = await empty_shelf(maker, shops, body)
    assert first.status_code == 201, first.text
    assert first.json()["lines"][0]["removed"] == 0

    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        delivered = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(shops.primary_store),
                "location_id": str(shops.shared_warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "quantity": 2}],
            },
            headers=key(),
        )
    assert delivered.status_code == 201, delivered.text

    again = await empty_shelf(maker, shops, body)
    assert again.status_code == 201, again.text
    assert again.json() == first.json()
    assert await held(maker, shops, variant, size) == 2
    assert await missing_at_sale(maker, variant) == []


async def test_one_basket_is_a_sale_or_an_empty_shelf_never_both(maker):
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, qty=3)

    shelved = uuid.uuid4()
    assert (
        await empty_shelf(maker, shops, shelf_body(shops, shelved, (variant, size, 1)))
    ).status_code == 201
    as_sale = await sell(
        maker,
        shops,
        {
            "store_id": str(shops.primary_store),
            "command_id": str(shelved),
            "lines": [line(shops, variant, size, 1)],
        },
    )
    assert as_sale.status_code == 409
    assert as_sale.json()["code"] == "IDEMPOTENCY_CONFLICT"
    another = await empty_shelf(maker, shops, shelf_body(shops, shelved, (variant, size, 2)))
    assert another.status_code == 409

    sold = uuid.uuid4()
    assert (
        await sell(
            maker,
            shops,
            {
                "store_id": str(shops.primary_store),
                "command_id": str(sold),
                "lines": [line(shops, variant, size, 1)],
            },
        )
    ).status_code == 201
    as_shelf = await empty_shelf(maker, shops, shelf_body(shops, sold, (variant, size, 1)))
    assert as_shelf.status_code == 409
    assert as_shelf.json()["code"] == "IDEMPOTENCY_CONFLICT"
    # One taken off by the empty shelf, one sold.
    assert await held(maker, shops, variant, size) == 1
    await ledger_holds(maker, shops)


async def test_the_empty_shelf_takes_the_tills_own_authorities(maker):
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, qty=1)
    seller = await empty_shelf(
        maker, shops, shelf_body(shops, uuid.uuid4(), (variant, size, 1)), permissions=SELLER
    )
    assert seller.status_code == 403
    # The primary store does not sell from the child store's warehouse.
    elsewhere = shelf_body(shops, uuid.uuid4(), (variant, size, 1))
    elsewhere["lines"][0]["source_location_id"] = str(shops.child_warehouse)
    assert (await empty_shelf(maker, shops, elsewhere)).status_code == 403
    async with api(maker, shops.scope(shops.child_store, SELLER)) as client:
        recorded = await empty_shelf(
            maker, shops, shelf_body(shops, uuid.uuid4(), (variant, size, 1))
        )
        foreign = await client.get(f"/api/v1/shelf-shortages/{recorded.json()['id']}")
    assert foreign.status_code == 403
    assert await held(maker, shops, variant, size) == 0


async def test_an_empty_shelf_is_only_where_the_store_sells(maker):
    """«Брак» takes deliveries and returns, and sells nothing: no till goes
    to its shelf, so no empty shelf is reported there."""
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, qty=1)
    bin_ = await give_bin(maker, shops.organization_id, shops.primary_store)
    there = shelf_body(shops, uuid.uuid4(), (variant, size, 1))
    there["lines"][0]["source_location_id"] = str(bin_)
    refused = await empty_shelf(maker, shops, there)
    assert refused.status_code == 403, refused.text
    assert refused.json()["code"] == "LOCATION_ACCESS_DENIED"


async def test_a_reserved_balance_is_not_corrected_at_the_till(maker):
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, qty=2)
    async with maker() as session:
        await reserve_stock(
            session,
            organization_id=shops.organization_id,
            store_id=shops.primary_store,
            reference_id=uuid.uuid4(),
            actor_user_id=shops.user_id,
            requests=[
                ReservationRequest(
                    location_id=shops.shared_warehouse,
                    product_variant_id=uuid.UUID(variant),
                    size_id=uuid.UUID(size),
                    quantity=1,
                )
            ],
        )
        await session.commit()
    refused = await empty_shelf(maker, shops, shelf_body(shops, uuid.uuid4(), (variant, size, 1)))
    assert refused.status_code == 422, refused.text
    assert refused.json()["details"]["reason"] == "RESERVED"
    assert await held(maker, shops, variant, size) == 2


async def test_two_retries_at_once_record_one_empty_shelf(maker):
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, qty=2)
    body = shelf_body(shops, uuid.uuid4(), (variant, size, 2))
    first, second = await asyncio.gather(
        empty_shelf(maker, shops, body), empty_shelf(maker, shops, body)
    )
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert [delta for delta, _, _ in await missing_at_sale(maker, variant)] == [-2]
    await ledger_holds(maker, shops)


@pytest.mark.parametrize(
    "lines",
    [
        [],
        [{"quantity": 0}],
        [{"quantity": 1001}],
    ],
)
async def test_an_empty_shelf_names_what_was_gone_for(maker, lines):
    shops = await make_two_shops(maker)
    variant, size = await coat(maker, shops, qty=1)
    body = shelf_body(shops, uuid.uuid4(), *[(variant, size, 1)] * len(lines))
    for given, override in zip(body["lines"], lines, strict=True):
        given.update(override)
    assert (await empty_shelf(maker, shops, body)).status_code == 422
    extra = {**shelf_body(shops, uuid.uuid4(), (variant, size, 1)), "unit_price": "1.00"}
    assert (await empty_shelf(maker, shops, extra)).status_code == 422
    assert await held(maker, shops, variant, size) == 1


async def test_the_downgrade_refuses_while_an_empty_shelf_is_recorded():
    """`0022` drops the table only while nothing names it: the movements stay
    in the ledger whatever happens."""
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_shelf_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        await _run(config, "downgrade", "0021_suggested_price", database=name)
        await _run(config, "upgrade", "head", database=name)
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        shops = await make_two_shops(fresh)
        variant, size = await coat(fresh, shops, qty=1)
        recorded = await empty_shelf(
            fresh, shops, shelf_body(shops, uuid.uuid4(), (variant, size, 1))
        )
        assert recorded.status_code == 201, recorded.text
        with pytest.raises(Exception, match="An empty shelf is recorded"):
            await _run(config, "downgrade", "0021_suggested_price", database=name)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
