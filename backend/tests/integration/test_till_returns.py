"""Returns at the till (owner decision, 2026-10-01), over HTTP against real PostgreSQL.

- Every unit that comes back is stated intact or damaged; one sale line may
  come back partly each way, and every part counts towards what is left.
- Intact goes back to the warehouse the line was sold from.
- Damaged goes to the store's own «Брак», where nothing sells.
- A return is taken in the store that made the sale.
- A seller finds the sale in the store's list, searchable by name.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.inventory.service import find_divergences
from app.modules.refunds.models import RefundItem
from app.modules.sales.payment import PaymentMethod
from app.modules.tenancy.models import StockLocation, StoreLocationAccess
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


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def give_bin(
    maker: async_sessionmaker[AsyncSession], organization_id: uuid.UUID, store_id: uuid.UUID
) -> uuid.UUID:
    """The store's own «Брак»: it receives there and never sells."""
    async with maker() as session:
        location = StockLocation(
            organization_id=organization_id, code=f"BIN-{uuid.uuid4().hex[:8]}", name="Брак"
        )
        session.add(location)
        await session.flush()
        session.add(
            StoreLocationAccess(
                organization_id=organization_id,
                store_id=store_id,
                location_id=location.id,
                can_sell=False,
                can_receive=True,
                damaged_returns=True,
            )
        )
        await session.commit()
        return location.id


async def sold(
    maker: async_sessionmaker[AsyncSession], shops: TwoShops, *, qty: int = 2, stocked: int = 3
) -> tuple[dict, str, str]:
    """A sale of `qty` coats from the shared warehouse, made by the primary store."""
    async with api(maker, shops.scope(shops.primary_store)) as client:
        variant, size = await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=stocked
        )
        response = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.shared_warehouse, variant, size, qty=qty),
            headers=key(),
        )
        assert response.status_code == 201, response.text
        return response.json(), variant, size


def part(sale: dict, quantity: int, condition: str | None) -> dict:
    line = {"sale_item_id": sale["items"][0]["id"], "quantity": quantity}
    return line | ({"restock": True, "condition": condition} if condition else {"restock": False})


def body(*lines: dict, command_id: str | None = None) -> dict:
    # The money goes back the way the sale was paid (owner decisions,
    # 2026-10-04): every sale here is paid in cash.
    return {
        "command_id": command_id or str(uuid.uuid4()),
        "lines": list(lines),
        "payment_method": "CASH",
    }


async def test_intact_goes_back_where_it_was_sold_and_damaged_to_the_stores_bin(maker):
    shops = await make_two_shops(maker)
    bin_ = await give_bin(maker, shops.organization_id, shops.primary_store)
    sale, variant, size = await sold(maker, shops, qty=2)

    async with api(maker, shops.scope(shops.primary_store)) as client:
        refunded = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 1, "INTACT"), part(sale, 1, "DAMAGED")),
            headers=key(),
        )
    assert refunded.status_code == 201, refunded.text
    items = {item["condition"]: item for item in refunded.json()["items"]}
    assert items["INTACT"]["destination_location_id"] == str(shops.shared_warehouse)
    assert items["DAMAGED"]["destination_location_id"] == str(bin_)
    # Both parts are refunded at the price actually paid.
    price = sale["items"][0]["final_unit_price"]
    assert items["INTACT"]["amount"] == items["DAMAGED"]["amount"] == price

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2
        assert await quantity_at(session, bin_, variant, size) == 1
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_nothing_sells_from_the_bin(maker):
    shops = await make_two_shops(maker)
    bin_ = await give_bin(maker, shops.organization_id, shops.primary_store)
    sale, variant, size = await sold(maker, shops, qty=1)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        taken = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 1, "DAMAGED")),
            headers=key(),
        )
        assert taken.status_code == 201, taken.text
        again = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, bin_, variant, size, qty=1),
            headers=key(),
        )
    assert again.status_code == 403, again.text
    assert again.json()["code"] == "LOCATION_ACCESS_DENIED"


async def test_every_part_of_a_line_counts_towards_what_is_left(maker):
    shops = await make_two_shops(maker)
    await give_bin(maker, shops.organization_id, shops.primary_store)
    sale, _, _ = await sold(maker, shops, qty=2)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        too_many = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 2, "INTACT"), part(sale, 1, "DAMAGED")),
            headers=key(),
        )
        assert too_many.status_code == 409, too_many.text
        assert too_many.json()["code"] == "REFUND_EXCEEDS_SOLD"
        assert too_many.json()["details"]["requested"] == 3

        first = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 1, "INTACT"), part(sale, 1, "DAMAGED")),
            headers=key(),
        )
        assert first.status_code == 201, first.text
        more = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 1, "INTACT")),
            headers=key(),
        )
        assert more.status_code == 409
        assert more.json()["details"]["refundable"] == 0


async def test_the_same_part_twice_is_refused(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await sold(maker, shops, qty=2)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        twice = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 1, "INTACT"), part(sale, 1, "INTACT")),
            headers=key(),
        )
    assert twice.status_code == 422, twice.text


@pytest.mark.parametrize(
    "line",
    [
        {"restock": True},
        {"restock": True, "condition": None},
        {"restock": True, "condition": "BROKEN"},
        {"restock": False, "condition": "DAMAGED"},
    ],
    ids=["no condition", "null condition", "unknown condition", "condition without goods"],
)
async def test_goods_that_came_back_are_stated_intact_or_damaged_and_only_they(maker, line):
    shops = await make_two_shops(maker)
    sale, _, _ = await sold(maker, shops, qty=1)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        refused = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body({"sale_item_id": sale["items"][0]["id"], "quantity": 1, **line}),
            headers=key(),
        )
    assert refused.status_code == 422, refused.text


async def test_damaged_goods_are_refused_where_the_store_has_no_bin(maker):
    shops = await make_two_shops(maker)
    sale, variant, size = await sold(maker, shops, qty=1)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        refused = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 1, "DAMAGED")),
            headers=key(),
        )
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "DAMAGED_RETURNS_UNAVAILABLE"
    assert refused.json()["details"]["reason"] == "NOT_SET_UP"
    async with maker() as session:
        assert (
            await session.scalar(
                select(RefundItem.id).where(RefundItem.sale_item_id == sale["items"][0]["id"])
            )
            is None
        )
        assert await quantity_at(session, shops.shared_warehouse, variant, size) == 2


async def test_damaged_goods_never_land_where_another_store_sells(maker):
    shops = await make_two_shops(maker)
    bin_ = await give_bin(maker, shops.organization_id, shops.primary_store)
    async with maker() as session:
        session.add(
            StoreLocationAccess(
                organization_id=shops.organization_id,
                store_id=shops.child_store,
                location_id=bin_,
                can_sell=True,
                can_receive=True,
            )
        )
        await session.commit()
    sale, _, _ = await sold(maker, shops, qty=1)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        refused = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 1, "DAMAGED")),
            headers=key(),
        )
    assert refused.status_code == 409, refused.text
    assert refused.json()["details"]["reason"] == "SOLD_FROM"


async def test_a_return_is_taken_only_in_the_store_that_sold(maker):
    shops = await make_two_shops(maker)
    await give_bin(maker, shops.organization_id, shops.child_store)
    sale, _, _ = await sold(maker, shops, qty=1)
    async with api(maker, shops.scope(shops.child_store)) as client:
        refused = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 1, "DAMAGED")),
            headers=key(),
        )
    assert refused.status_code == 403, refused.text


async def test_a_repeated_return_is_the_same_return_and_its_condition_is_part_of_it(maker):
    shops = await make_two_shops(maker)
    await give_bin(maker, shops.organization_id, shops.primary_store)
    sale, _, _ = await sold(maker, shops, qty=2)
    command = str(uuid.uuid4())
    async with api(maker, shops.scope(shops.primary_store)) as client:
        first = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 1, "DAMAGED"), command_id=command),
            headers=key(),
        )
        replay = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 1, "DAMAGED"), command_id=command),
            headers=key(),
        )
        flipped = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=body(part(sale, 1, "INTACT"), command_id=command),
            headers=key(),
        )
    assert first.status_code == replay.status_code == 201
    assert replay.json() == first.json()
    assert flipped.status_code == 409
    assert flipped.json()["code"] == "IDEMPOTENCY_CONFLICT"


async def test_the_database_keeps_a_bin_unsold_and_one_per_store():
    """Held by `0019` itself, so checked on a database it has just migrated."""
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_bins_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    try:
        await _run(_alembic(name), "upgrade", "head", database=name)
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        shops = await make_two_shops(fresh)
        await give_bin(fresh, shops.organization_id, shops.primary_store)
        with pytest.raises(IntegrityError, match="damaged_returns_are_not_sold"):
            async with fresh() as session:
                session.add(
                    StoreLocationAccess(
                        organization_id=shops.organization_id,
                        store_id=shops.child_store,
                        location_id=shops.child_warehouse,
                        can_sell=True,
                        can_receive=True,
                        damaged_returns=True,
                    )
                )
                await session.flush()
        with pytest.raises(IntegrityError, match="uq_store_location_access_damaged_returns"):
            await give_bin(fresh, shops.organization_id, shops.primary_store)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def test_the_bin_is_named_in_the_stores_warehouses(maker):
    shops = await make_two_shops(maker)
    bin_ = await give_bin(maker, shops.organization_id, shops.primary_store)
    permissions = frozenset(SELLER | {Permission.INVENTORY_VIEW})
    async with api(maker, shops.scope(shops.primary_store, permissions)) as client:
        listed = await client.get(
            "/api/v1/stock-locations", params={"store_id": str(shops.primary_store)}
        )
    assert listed.status_code == 200
    flags = {loc["id"]: (loc["damaged_returns"], loc["can_sell"]) for loc in listed.json()}
    assert flags[str(bin_)] == (True, False)
    assert flags[str(shops.shared_warehouse)] == (False, True)


async def test_the_store_lists_its_sales_newest_first_with_what_came_back(maker):
    shops = await make_two_shops(maker)
    await give_bin(maker, shops.organization_id, shops.primary_store)
    older, _, _ = await sold(maker, shops, qty=2)
    newer, _, _ = await sold(maker, shops, qty=1)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        await client.post(
            f"/api/v1/sales/{older['id']}/refunds",
            json=body(part(older, 1, "DAMAGED")),
            headers=key(),
        )
        listed = await client.get(
            "/api/v1/sales", params={"store_id": str(shops.primary_store), "limit": 1}
        )
        rest = await client.get(
            "/api/v1/sales",
            params={"store_id": str(shops.primary_store), "limit": 1, "offset": 1},
        )
    assert listed.status_code == 200, listed.text
    assert [s["id"] for s in listed.json()["sales"]] == [newer["id"]]
    assert listed.json()["has_more"] is True
    [line] = rest.json()["sales"][0]["items"]
    assert rest.json()["sales"][0]["id"] == older["id"]
    assert (line["quantity"], line["refunded"]) == (2, 1)
    assert line["display_name"] == older["items"][0]["display_name"]
    assert line["size"] == "M"
    assert rest.json()["has_more"] is False


async def test_the_list_is_searched_by_name_in_any_letter_case(maker):
    shops = await make_two_shops(maker)
    sale, _, _ = await sold(maker, shops, qty=1)
    name = sale["items"][0]["display_name"]
    async with api(maker, shops.scope(shops.primary_store)) as client:
        found = await client.get(
            "/api/v1/sales",
            params={"store_id": str(shops.primary_store), "q": name[:4].upper()},
        )
        missed = await client.get(
            "/api/v1/sales", params={"store_id": str(shops.primary_store), "q": "немає такого"}
        )
        wildcard = await client.get(
            "/api/v1/sales", params={"store_id": str(shops.primary_store), "q": "%"}
        )
    assert [s["id"] for s in found.json()["sales"]] == [sale["id"]]
    assert missed.json()["sales"] == []
    # `%` is a letter to search for, not a pattern that matches everything.
    assert wildcard.json()["sales"] == []


async def test_the_list_is_searched_by_each_word_in_any_order(maker):
    """As the till's search reads each word (returns task list, P1-3)."""
    shops = await make_two_shops(maker)
    sale, _, _ = await sold(maker, shops, qty=1)
    concept, colour = sale["items"][0]["display_name"].split(" ", 1)
    found: dict[str, list[str]] = {}
    async with api(maker, shops.scope(shops.primary_store)) as client:
        for q in (
            f"{colour} {concept}",
            f"  {concept.upper()}   {colour}  ",
            f"{colour[:3]} {concept[-4:]}",
            f"{concept} немає",
        ):
            response = await client.get(
                "/api/v1/sales", params={"store_id": str(shops.primary_store), "q": q}
            )
            assert response.status_code == 200, response.text
            found[q] = [s["id"] for s in response.json()["sales"]]
    assert found[f"{colour} {concept}"] == [sale["id"]]
    assert found[f"  {concept.upper()}   {colour}  "] == [sale["id"]]
    assert found[f"{colour[:3]} {concept[-4:]}"] == [sale["id"]]
    # Every word must be there, not one of them.
    assert found[f"{concept} немає"] == []


async def test_words_of_two_lines_of_a_sale_do_not_add_up(maker):
    """Each word in the name of one line: a sale of two coats is not found by
    a word of each."""
    shops = await make_two_shops(maker)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        lines = []
        for _ in range(2):
            variant, size = await stock_a_coat(
                client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=1
            )
            lines.append(
                sale_body(shops.primary_store, shops.shared_warehouse, variant, size)["lines"][0]
            )
        made = await client.post(
            "/api/v1/sales",
            json=sale_body(shops.primary_store, shops.shared_warehouse, "", "") | {"lines": lines},
            headers=key(),
        )
        assert made.status_code == 201, made.text
        sale = made.json()
        first, second = (item["display_name"].split(" ", 1)[0] for item in sale["items"])
        apart = await client.get(
            "/api/v1/sales",
            params={"store_id": str(shops.primary_store), "q": f"{first} {second}"},
        )
        together = await client.get(
            "/api/v1/sales",
            params={"store_id": str(shops.primary_store), "q": f"{second} шоколад"},
        )
        literal = await client.get(
            "/api/v1/sales",
            params={"store_id": str(shops.primary_store), "q": f"{first} %"},
        )
    assert apart.json()["sales"] == []
    assert [s["id"] for s in together.json()["sales"]] == [sale["id"]]
    # `%` is still a letter to look for, word by word.
    assert literal.json()["sales"] == []


async def test_a_store_lists_only_its_own_sales_and_only_for_who_may_view_them(maker):
    shops = await make_two_shops(maker)
    await sold(maker, shops, qty=1)
    async with api(maker, shops.scope(shops.child_store)) as client:
        own = await client.get("/api/v1/sales", params={"store_id": str(shops.child_store)})
        other = await client.get("/api/v1/sales", params={"store_id": str(shops.primary_store)})
    assert own.json()["sales"] == []
    assert other.status_code == 403
    blind = frozenset(SELLER - {Permission.SALE_VIEW})
    async with api(maker, shops.scope(shops.primary_store, blind)) as client:
        refused = await client.get("/api/v1/sales", params={"store_id": str(shops.primary_store)})
    assert refused.status_code == 403


async def test_returns_taken_before_conditions_were_asked_keep_no_condition(maker):
    """History is not rewritten: a restocked line from before 2026-10-01 keeps
    a NULL condition, which the database accepts; a new one must state it."""
    shops = await make_two_shops(maker)
    sale, _, _ = await sold(maker, shops, qty=1)
    async with maker() as session:
        await session.execute(
            text(
                "INSERT INTO refund (id, organization_id, store_id, taken_at_store_id, sale_id, "
                "actor_user_id, command_id, total_amount, currency_code, created_at) VALUES (:id, "
                ":org, :store, :store, :sale, :user, :command, 0, 'UAH', now())"
            ),
            {
                "id": (refund_id := uuid.uuid4()),
                "org": shops.organization_id,
                "store": shops.primary_store,
                "sale": sale["id"],
                "user": shops.user_id,
                "command": uuid.uuid4(),
            },
        )
        await session.execute(
            text(
                "INSERT INTO refund_item (id, refund_id, sale_item_id, quantity, amount, restock, "
                "destination_location_id) VALUES (:id, :refund, :item, 1, 0, true, :dest)"
            ),
            {
                "id": uuid.uuid4(),
                "refund": refund_id,
                "item": sale["items"][0]["id"],
                "dest": shops.shared_warehouse,
            },
        )
        await session.commit()


async def test_downgrade_refuses_while_a_line_came_back_in_parts():
    """`0018` held one row per sale line in a refund. Going back while a line
    came back in parts would have to drop one part's meaning, so it refuses."""
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_returns_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        refund, item = uuid.uuid4(), uuid.uuid4()
        async with engine.begin() as connection:
            # Foreign keys are beside the point here, and a real sale would
            # need a whole shop: skip them for these two rows only.
            await connection.execute(text("SET LOCAL session_replication_role = replica"))
            for condition in ("INTACT", "DAMAGED"):
                await connection.execute(
                    text(
                        "INSERT INTO refund_item (id, refund_id, sale_item_id, quantity, amount, "
                        "restock, condition, destination_location_id) "
                        "VALUES (:id, :refund, :item, 1, 0, true, :condition, :dest)"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "refund": refund,
                        "item": item,
                        "condition": condition,
                        "dest": uuid.uuid4(),
                    },
                )
        with pytest.raises(Exception, match="returns a sale line in parts"):
            await _run(config, "downgrade", "0018_backup_alerts", database=name)
        async with engine.begin() as connection:
            await connection.execute(
                text("DELETE FROM refund_item WHERE condition = 'DAMAGED' AND refund_id = :r"),
                {"r": refund},
            )
        await _run(config, "downgrade", "0018_backup_alerts", database=name)
        await _run(config, "upgrade", "head", database=name)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def test_swapping_which_line_came_back_damaged_is_a_different_return(maker):
    """Two lines from the same warehouse: A intact and B damaged sends goods
    to the same two places as A damaged and B intact, so only the stated
    conditions tell the two apart. The same command_id must not replay one
    as the other."""
    shops = await make_two_shops(maker)
    await give_bin(maker, shops.organization_id, shops.primary_store)
    async with api(maker, shops.scope(shops.primary_store)) as client:
        coats = [
            await stock_a_coat(
                client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=1
            )
            for _ in range(2)
        ]
        order = sale_body(shops.primary_store, shops.shared_warehouse, *coats[0])
        order["lines"].append(
            sale_body(shops.primary_store, shops.shared_warehouse, *coats[1])["lines"][0]
        )
        made = await client.post("/api/v1/sales", json=order, headers=key())
        assert made.status_code == 201, made.text
        first, second = (item["id"] for item in made.json()["items"])
        command = str(uuid.uuid4())

        def swap(a: str, b: str) -> dict:
            return body(
                {"sale_item_id": first, "quantity": 1, "restock": True, "condition": a},
                {"sale_item_id": second, "quantity": 1, "restock": True, "condition": b},
                command_id=command,
            )

        taken = await client.post(
            f"/api/v1/sales/{made.json()['id']}/refunds",
            json=swap("INTACT", "DAMAGED"),
            headers=key(),
        )
        swapped = await client.post(
            f"/api/v1/sales/{made.json()['id']}/refunds",
            json=swap("DAMAGED", "INTACT"),
            headers=key(),
        )
    assert taken.status_code == 201, taken.text
    assert swapped.status_code == 409, swapped.text
    assert swapped.json()["code"] == "IDEMPOTENCY_CONFLICT"


async def test_the_command_itself_refuses_goods_back_unjudged(maker):
    """The service is callable without HTTP, so it checks for itself."""
    from app.core.errors import ValidationFailedError
    from app.modules.refunds.models import ReturnCondition
    from app.modules.refunds.service import RefundLineInput, create_refund

    shops = await make_two_shops(maker)
    sale, _, _ = await sold(maker, shops, qty=1)
    for line in [
        RefundLineInput(sale_item_id=uuid.UUID(sale["items"][0]["id"]), quantity=1, restock=True),
        RefundLineInput(
            sale_item_id=uuid.UUID(sale["items"][0]["id"]),
            quantity=1,
            restock=False,
            condition=ReturnCondition.DAMAGED,
        ),
    ]:
        async with maker() as session:
            with pytest.raises(ValidationFailedError):
                await create_refund(
                    session,
                    scope=shops.scope(shops.primary_store),
                    sale_id=uuid.UUID(sale["id"]),
                    command_id=uuid.uuid4(),
                    lines=[line],
                    payment_method=PaymentMethod.CASH,
                )
