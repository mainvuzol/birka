"""How each money command was paid, over HTTP against real PostgreSQL (owner
decisions, 2026-10-04; ADR-0012, B2, B10, B13; D2).

- A sale is paid one way, given by the button that sold: cash, card or
  transfer. A sale paid in parts gives the way of the money taken now, which
  its first payment holds.
- Each payment toward a debt has its own way.
- Money handed back goes the way the sale was paid unless the seller changes
  it. A return of a sale paid in parts that only lowers the debt moves no
  money, and needs no way (ADR-0012, G35).
- «Клієнт забрав» says how an order was paid: in advance by transfer, cash on
  delivery, or at the counter now.
- A new command without a way is refused with `recorded: false`. One a phone
  kept from before the way was asked still replays: its rows are forged here
  from the prints `test_old_prints_are_pinned.py` pinned at `32ea05a`, never
  made by today's code, which would only compare the new code with itself.

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.api.deps import get_current_scope, session_dependency
from app.core.idempotency import IdempotencyRecord, IdempotencyStatus
from app.main import create_app
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.catalog.models import (
    CanonicalConcept,
    ProductFamily,
    ProductVariant,
    Size,
    SizeSystem,
    SizeSystemCode,
)
from app.modules.credit.models import CreditEntry, CustomerCredit
from app.modules.identity.models import AppUser
from app.modules.orders.models import CustomerOrder, CustomerOrderItem, OrderCommand
from app.modules.refunds.models import Refund, RefundItem
from app.modules.sales.models import Sale, SaleItem
from app.modules.tenancy.models import (
    Organization,
    StockLocation,
    Store,
    StoreKind,
    StoreLocationAccess,
)
from tests.conftest import requires_database
from tests.integration.test_cash_schema import a_correction
from tests.integration.test_shared_warehouse import (
    SETTINGS,
    TwoShops,
    api,
    key,
    make_two_shops,
    order_body,
    sale_body,
    stock_a_coat,
)
from tests.unit.test_old_prints_are_pinned import (
    ACTOR,
    COLLECTED_SALE_PERMANENT,
    COMMAND,
    CREDIT,
    CREDIT_BODY,
    IDEMPOTENCY_KEY,
    LINE,
    LOCATION,
    ORDER,
    ORDER_COLLECT_IN_PARTS_PERMANENT,
    ORDER_COLLECT_PERMANENT,
    ORGANIZATION,
    OTHER_STORE,
    PAYMENT_ELSEWHERE_PERMANENT,
    PAYMENT_PERMANENT,
    REFUND_7_DAY,
    REFUND_PERMANENT,
    SALE,
    SALE_7_DAY,
    SALE_IN_PARTS_7_DAY,
    SALE_IN_PARTS_PERMANENT,
    SALE_ITEM,
    SALE_PERMANENT,
    SIZE,
    STORE,
    VARIANT,
    _scope,
)

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
TERMS = {"customer_name": "Ірина Коваль", "customer_phone": "+380671234567"}
REFUSED = {"reason": "PAYMENT_METHOD_REQUIRED", "recorded": False}


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


# --- today's commands ------------------------------------------------------


async def coats(maker, shops: TwoShops, qty: int = 3) -> tuple[str, str]:
    async with api(maker, shops.scope(shops.primary_store, MANAGER)) as client:
        return await stock_a_coat(
            client, shops, store=shops.primary_store, warehouse=shops.shared_warehouse, qty=qty
        )


async def sell(
    maker, shops: TwoShops, coat: tuple[str, str], way: str | None, *, qty: int = 2, **extra: Any
) -> httpx.Response:
    """Two coats at 1500 unless said otherwise, 3000 in all."""
    body = sale_body(shops.primary_store, shops.shared_warehouse, *coat, qty=qty) | extra
    if way is None:
        del body["payment_method"]
    else:
        body["payment_method"] = way
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await client.post("/api/v1/sales", json=body, headers=key())


async def pay(maker, shops: TwoShops, credit_id: str, amount: str, way: str | None):
    body: dict[str, Any] = {"command_id": str(uuid.uuid4()), "amount": amount}
    if way is not None:
        body["payment_method"] = way
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await client.post(f"/api/v1/credits/{credit_id}/payments", json=body)


async def give_back(maker, shops: TwoShops, sale: dict, quantity: int, way: str | None):
    body: dict[str, Any] = {
        "command_id": str(uuid.uuid4()),
        "lines": [
            {
                "sale_item_id": sale["items"][0]["id"],
                "quantity": quantity,
                "restock": True,
                "condition": "INTACT",
            }
        ],
    }
    if way is not None:
        body["payment_method"] = way
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await client.post(f"/api/v1/sales/{sale['id']}/refunds", json=body, headers=key())


async def arrived(maker, shops: TwoShops, coat: tuple[str, str]) -> str:
    async with api(maker, shops.scope(shops.primary_store)) as client:
        made = await client.post(
            "/api/v1/orders",
            json=order_body(shops.primary_store, shops.shared_warehouse, *coat, qty=2)
            | {"carrier": "NOVA_POSHTA"},
        )
        assert made.status_code == 201, made.text
        order: str = made.json()["id"]
        for action in ("dispatch", "arrive"):
            moved = await client.post(
                f"/api/v1/orders/{order}/{action}", json={"command_id": str(uuid.uuid4())}
            )
            assert moved.status_code == 200, moved.text
    return order


async def collect(
    maker, shops: TwoShops, order: str, way: str | None, credit: dict | None = None
) -> httpx.Response:
    body: dict[str, Any] = {"command_id": str(uuid.uuid4())}
    if way is not None:
        body["payment_method"] = way
    if credit is not None:
        body["credit"] = credit
    async with api(maker, shops.scope(shops.primary_store)) as client:
        return await client.post(f"/api/v1/orders/{order}/collect", json=body)


async def way_of(maker, model: Any, row_id: str | uuid.UUID) -> str | None:
    async with maker() as session:
        return await session.scalar(
            select(model.payment_method).where(model.id == uuid.UUID(str(row_id)))
        )


async def payments_of(maker, credit_id: str) -> list[str | None]:
    async with maker() as session:
        return list(
            (
                await session.scalars(
                    select(CreditEntry.payment_method)
                    .where(
                        CreditEntry.credit_id == uuid.UUID(credit_id),
                        CreditEntry.kind == "PAYMENT",
                    )
                    .order_by(CreditEntry.created_at, CreditEntry.id)
                )
            ).all()
        )


async def count(maker, model: Any, shops: TwoShops) -> int:
    async with maker() as session:
        return await session.scalar(
            select(func.count())
            .select_from(model)
            .where(model.organization_id == shops.organization_id)
        )


@pytest.mark.parametrize("way", ["CASH", "CARD", "TRANSFER"])
async def test_a_sale_is_stored_with_the_button_that_sold_and_says_so(maker, way):
    shops = await make_two_shops(maker)
    sold = await sell(maker, shops, await coats(maker, shops), way)

    assert sold.status_code == 201, sold.text
    assert sold.json()["payment_method"] == way
    assert await way_of(maker, Sale, sold.json()["id"]) == way
    async with maker() as session:
        stored = await session.get(Sale, uuid.UUID(sold.json()["id"]))
    # The receipt's snapshot says it too, the way the seller pressed it.
    assert stored is not None and stored.response_snapshot["payment_method"] == way


async def test_a_sale_paid_in_parts_gives_its_way_to_its_first_payment(maker):
    shops = await make_two_shops(maker)
    sold = await sell(
        maker,
        shops,
        await coats(maker, shops),
        "TRANSFER",
        credit=TERMS | {"paid_now": "1000.00"},
    )

    assert sold.status_code == 201, sold.text
    credit_id = sold.json()["credit"]["credit_id"]
    assert await way_of(maker, Sale, sold.json()["id"]) == "TRANSFER"
    assert await payments_of(maker, credit_id) == ["TRANSFER"]


async def test_each_later_payment_keeps_its_own_way_and_the_history_shows_each(maker):
    shops = await make_two_shops(maker)
    sold = await sell(
        maker, shops, await coats(maker, shops), "CASH", credit=TERMS | {"paid_now": "1000.00"}
    )
    credit_id = sold.json()["credit"]["credit_id"]

    by_card = await pay(maker, shops, credit_id, "500.00", "CARD")
    by_transfer = await pay(maker, shops, credit_id, "500.00", "TRANSFER")

    assert by_card.status_code == 201, by_card.text
    assert by_transfer.status_code == 201, by_transfer.text
    assert await payments_of(maker, credit_id) == ["CASH", "CARD", "TRANSFER"]
    entries = by_transfer.json()["entries"]
    assert [(entry["payment_method"], entry["corrected"]) for entry in entries] == [
        ("CASH", False),
        ("CARD", False),
        ("TRANSFER", False),
    ]


async def test_money_handed_back_goes_the_way_the_seller_says(maker):
    """A sale paid in cash, its money handed back to a card: the seller's
    choice, not the sale's (owner decisions, 2026-10-04)."""
    shops = await make_two_shops(maker)
    sold = (await sell(maker, shops, await coats(maker, shops), "CASH")).json()

    back = await give_back(maker, shops, sold, 1, "CARD")

    assert back.status_code == 201, back.text
    assert back.json()["payment_method"] == "CARD"
    assert await way_of(maker, Refund, back.json()["id"]) == "CARD"


@pytest.mark.parametrize("way", [None, "CARD"])
async def test_a_return_that_only_lowers_a_debt_needs_no_way_and_keeps_none(maker, way):
    """3000 owed after 1000 paid; one coat of 1500 back lowers the debt and
    hands nothing back. A way the screen preselected is not kept: no money
    moved (ADR-0012, G35)."""
    shops = await make_two_shops(maker)
    sold = (
        await sell(
            maker, shops, await coats(maker, shops), "CASH", credit=TERMS | {"paid_now": "1000.00"}
        )
    ).json()

    back = await give_back(maker, shops, sold, 1, way)

    assert back.status_code == 201, back.text
    assert back.json()["credit"]["cash_back"] == "0.00"
    assert back.json()["payment_method"] is None
    assert await way_of(maker, Refund, back.json()["id"]) is None


async def test_a_return_that_hands_money_back_on_a_debt_needs_a_way(maker):
    """2500 paid of 3000; both coats back hand 2500 back, so the way is asked
    once the debt is split — and nothing is recorded without it."""
    shops = await make_two_shops(maker)
    sold = (
        await sell(
            maker, shops, await coats(maker, shops), "CASH", credit=TERMS | {"paid_now": "2500.00"}
        )
    ).json()
    credit_id = sold["credit"]["credit_id"]

    refused = await give_back(maker, shops, sold, 2, None)
    taken = await give_back(maker, shops, sold, 2, "TRANSFER")

    assert refused.status_code == 422, refused.text
    assert refused.json()["details"] == REFUSED
    assert taken.status_code == 201, taken.text
    assert taken.json()["credit"]["cash_back"] == "2500.00"
    assert taken.json()["payment_method"] == "TRANSFER"
    assert await count(maker, Refund, shops) == 1
    async with api(maker, shops.scope(shops.primary_store)) as client:
        debt = (await client.get(f"/api/v1/credits/{credit_id}")).json()
    # The history: the payment's way, and the return's money's.
    assert [(entry["kind"], entry["payment_method"]) for entry in debt["entries"]] == [
        ("PAYMENT", "CASH"),
        ("RETURN", "TRANSFER"),
    ]


async def test_a_return_without_a_way_of_a_sale_paid_in_full_is_refused_before_its_lines(maker):
    """A phone kept a return from before the way was asked, and a colleague
    took the same coat back meanwhile. Its resend is refused for the way,
    checked first for a sale paid in full (ADR-0012, B2, B13), and settles;
    a new return with a way is refused for the coat, and settles too: both
    were decided after the command's lookup found nothing."""
    shops = await make_two_shops(maker)
    sold = (await sell(maker, shops, await coats(maker, shops), "CASH", qty=1)).json()
    taken = await give_back(maker, shops, sold, 1, "CASH")
    assert taken.status_code == 201, taken.text

    kept = await give_back(maker, shops, sold, 1, None)
    assert kept.status_code == 422, kept.text
    assert kept.json()["details"] == REFUSED
    with_a_way = await give_back(maker, shops, sold, 1, "CARD")
    assert with_a_way.status_code == 409, with_a_way.text
    assert with_a_way.json()["code"] == "REFUND_EXCEEDS_SOLD"
    assert with_a_way.json()["details"]["recorded"] is False
    assert await count(maker, Refund, shops) == 1


async def test_a_return_without_a_way_of_a_sale_paid_in_parts_settles_on_its_lines(maker):
    """Paid in parts, the way waits for the split (G35), which a line
    already back never reaches: refused for the coat, saying nothing was
    recorded."""
    shops = await make_two_shops(maker)
    sold = (
        await sell(
            maker,
            shops,
            await coats(maker, shops),
            "CASH",
            qty=1,
            credit=TERMS | {"paid_now": "1000.00"},
        )
    ).json()
    taken = await give_back(maker, shops, sold, 1, "CASH")
    assert taken.status_code == 201, taken.text

    kept = await give_back(maker, shops, sold, 1, None)
    assert kept.status_code == 409, kept.text
    assert kept.json()["code"] == "REFUND_EXCEEDS_SOLD"
    assert kept.json()["details"]["recorded"] is False
    assert await count(maker, Refund, shops) == 1


@pytest.mark.parametrize("way", ["PREPAID_TRANSFER", "CARRIER_COD", "CASH", "CARD", "TRANSFER"])
async def test_a_collected_order_keeps_any_of_the_five_ways(maker, way):
    shops = await make_two_shops(maker)
    order = await arrived(maker, shops, await coats(maker, shops))

    collected = await collect(maker, shops, order, way)

    assert collected.status_code == 200, collected.text
    assert collected.json()["payment_method"] == way
    assert await way_of(maker, Sale, collected.json()["sale_id"]) == way


async def test_an_order_collected_in_parts_gives_its_way_to_its_first_payment(maker):
    """Any of the five, the part paid now's (ADR-0012, G2)."""
    shops = await make_two_shops(maker)
    order = await arrived(maker, shops, await coats(maker, shops))

    collected = await collect(
        maker, shops, order, "PREPAID_TRANSFER", credit=TERMS | {"paid_now": "1000.00"}
    )

    assert collected.status_code == 200, collected.text
    assert await payments_of(maker, collected.json()["credit"]["credit_id"]) == ["PREPAID_TRANSFER"]


@pytest.mark.parametrize("way", ["PREPAID_TRANSFER", "CARRIER_COD"])
async def test_the_till_debts_and_returns_refuse_an_order_way(maker, way):
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops)
    sold = (await sell(maker, shops, coat, "CASH", credit=TERMS | {"paid_now": "1000.00"})).json()

    at_the_till = await sell(maker, shops, coat, way, qty=1)
    a_payment = await pay(maker, shops, sold["credit"]["credit_id"], "100.00", way)
    a_return = await give_back(maker, shops, sold, 1, way)

    for refused in (at_the_till, a_payment, a_return):
        assert refused.status_code == 422, refused.text
    assert await count(maker, Sale, shops) == 1
    assert await count(maker, Refund, shops) == 0
    assert await payments_of(maker, sold["credit"]["credit_id"]) == ["CASH"]


async def test_a_new_command_without_a_way_records_nothing_and_says_so(maker):
    """Each of the four, refused after its replay lookup found nothing: the
    phone may settle an attempt whose outcome it did not know (ADR-0008 §9)."""
    shops = await make_two_shops(maker)
    coat = await coats(maker, shops, qty=6)
    sold = (await sell(maker, shops, coat, "CASH")).json()
    in_parts = (
        await sell(maker, shops, coat, "CASH", credit=TERMS | {"paid_now": "1000.00"})
    ).json()
    order = await arrived(maker, shops, coat)
    sales, refunds = await count(maker, Sale, shops), await count(maker, Refund, shops)

    refused = [
        await sell(maker, shops, coat, None),
        await sell(maker, shops, coat, None, credit=TERMS | {"paid_now": "1000.00"}),
        await pay(maker, shops, in_parts["credit"]["credit_id"], "100.00", None),
        await give_back(maker, shops, sold, 1, None),
        await collect(maker, shops, order, None),
    ]

    for response in refused:
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "VALIDATION_ERROR"
        assert response.json()["details"] == REFUSED
    assert await count(maker, Sale, shops) == sales
    assert await count(maker, Refund, shops) == refunds
    assert await payments_of(maker, in_parts["credit"]["credit_id"]) == ["CASH"]
    async with maker() as session:
        status = await session.scalar(
            select(CustomerOrder.status).where(CustomerOrder.id == uuid.UUID(order))
        )
    assert status == "ARRIVED"


# --- who reads the way back (ADR-0012, G32) --------------------------------


def as_someone(shops: TwoShops, permissions=SELLER, user: uuid.UUID | None = None) -> RequestScope:
    return RequestScope(
        user_id=user or uuid.uuid4(),
        organization_id=shops.organization_id,
        store_permissions={shops.primary_store: permissions},
    )


async def read(maker, scope: RequestScope, path: str) -> dict:
    async with api(maker, scope) as client:
        response = await client.get(path)
    assert response.status_code == 200, response.text
    body: dict = response.json()
    return body


async def test_a_sale_read_on_its_own_shows_its_way_only_to_its_seller_and_the_managers(maker):
    shops = await make_two_shops(maker)
    sold = (await sell(maker, shops, await coats(maker, shops), "CARD")).json()
    path = f"/api/v1/sales/{sold['id']}"

    another_seller = await read(maker, as_someone(shops), path)
    her_own = await read(maker, shops.scope(shops.primary_store), path)
    a_manager = await read(maker, as_someone(shops, MANAGER), path)

    assert another_seller["payment_method"] is None
    assert her_own["payment_method"] == "CARD"
    assert a_manager["payment_method"] == "CARD"
    # Nothing else differs: the receipt is the same receipt.
    assert {**another_seller, "payment_method": "CARD"} == her_own == a_manager


async def test_a_corrected_sale_is_read_with_its_way_as_it_stands(maker):
    shops = await make_two_shops(maker)
    sold = (await sell(maker, shops, await coats(maker, shops), "CARD")).json()
    async with maker() as session:
        await a_correction(
            session,
            shops,
            sale_id=uuid.UUID(sold["id"]),
            amount=Decimal(sold["total"]),
            from_method="CARD",
            to_method="CASH",
        )
        await session.commit()

    read_back = await read(maker, shops.scope(shops.primary_store), f"/api/v1/sales/{sold['id']}")

    assert read_back["payment_method"] == "CASH"


async def test_the_list_of_the_stores_sales_never_carries_a_way(maker):
    shops = await make_two_shops(maker)
    await sell(maker, shops, await coats(maker, shops), "CARD")

    page = await read(
        maker,
        shops.scope(shops.primary_store),
        f"/api/v1/sales?store_id={shops.primary_store}",
    )

    [listed] = page["sales"]
    assert set(listed) == {
        "id",
        "store_id",
        "store_name",
        "sold_at",
        "currency_code",
        "total",
        "paid_in_parts",
        "items",
        # «Продано під час збою», which says nothing of money (ADR-0013 §5.6).
        "outage",
    }
    assert listed["outage"] is None
    assert set(listed["items"][0]) == {
        "id",
        "display_name",
        "size",
        "source_location_id",
        "quantity",
        "final_unit_price",
        "line_total",
        "refunded",
        "back_to_sold_from",
    }


async def test_a_collected_order_is_read_with_its_way_only_by_whoever_may_see_it(maker):
    shops = await make_two_shops(maker)
    order = await arrived(maker, shops, await coats(maker, shops))
    assert (await collect(maker, shops, order, "CARRIER_COD")).status_code == 200
    one, listed = f"/api/v1/orders/{order}", f"/api/v1/orders?store_id={shops.primary_store}"

    collector = shops.scope(shops.primary_store)
    for scope, shown in (
        (collector, "CARRIER_COD"),
        (as_someone(shops, MANAGER), "CARRIER_COD"),
        (as_someone(shops), None),
    ):
        assert (await read(maker, scope, one))["payment_method"] == shown
        [item] = (await read(maker, scope, listed))["orders"]
        assert item["payment_method"] == shown


# --- commands kept from before the way was asked (D2) -----------------------
#
# The prints name the actor, the store and the goods, so the rows are forged
# with exactly the ids the prints were taken with. Each test builds them in
# a transaction of its own and rolls it back at the end, so the fixed ids
# never collide with another run. The API's own commits only release a
# savepoint inside it.

OLD_SALE_ANSWER = {
    "id": str(SALE),
    "store_id": str(STORE),
    "currency_code": "UAH",
    "subtotal": "6000.00",
    "discount_total": "400.00",
    "total": "5600.00",
    "items": [
        {
            "id": str(SALE_ITEM),
            "product_variant_id": str(VARIANT),
            "size_id": str(SIZE),
            "source_location_id": str(LOCATION),
            "quantity": 2,
            "unit_price": "3000.00",
            "discount_amount": "200.00",
            "final_unit_price": "2800.00",
            "line_total": "5600.00",
            "display_name": "Пальто Лоран, чорне",
        }
    ],
    "corrections": [],
    "shortages": [],
    "size_reclassifications": [],
    "credit": None,
}
SALE_BODY = {"store_id": str(STORE), "command_id": str(COMMAND), "lines": [LINE]}
PAY_COMMAND = uuid.UUID("0b000000-0000-4000-8000-000000000001")
REFUND = uuid.UUID("0b000000-0000-4000-8000-000000000002")
# The 7-day print of a refund holds its body, `command_id` included, and the
# prints were taken with the sale's: one command id for both, as the rows of
# two tables never meet.
REFUND_COMMAND = COMMAND
# The refund the prints were taken of: one coat back intact, one not back.
REFUND_BODY = {
    "command_id": str(REFUND_COMMAND),
    "lines": [
        {"sale_item_id": str(SALE_ITEM), "quantity": 1, "restock": True, "condition": "INTACT"},
        {"sale_item_id": str(SALE_ITEM), "quantity": 1, "restock": False},
    ],
    "reason": "Не підійшов розмір",
}
COAT_SNAPSHOT = {"model": "Пальто Лоран", "colour": "чорне", "size": "M"}


@pytest.fixture
async def old_world(engine: AsyncEngine) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """The organization, stores, person, warehouse and coat the prints name,
    in a transaction rolled back after the test."""
    async with engine.connect() as connection:
        outer = await connection.begin()
        maker = async_sessionmaker(
            bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        async with maker() as session:
            session.add(Organization(id=ORGANIZATION, name="Старі спроби", currency_code="UAH"))
            await session.flush()
            session.add_all(
                [
                    Store(
                        id=STORE,
                        organization_id=ORGANIZATION,
                        name="Основний",
                        code="MAIN",
                        kind=StoreKind.PRIMARY,
                    ),
                    Store(
                        id=OTHER_STORE,
                        organization_id=ORGANIZATION,
                        name="Дочірній",
                        code="CHILD",
                        kind=StoreKind.SECONDARY,
                    ),
                    AppUser(id=ACTOR, telegram_user_id=4_200_000_042, display_name="Оля"),
                    StockLocation(
                        id=LOCATION, organization_id=ORGANIZATION, code="W-OLD", name="Склад"
                    ),
                ]
            )
            await session.flush()
            session.add(
                StoreLocationAccess(
                    organization_id=ORGANIZATION,
                    store_id=STORE,
                    location_id=LOCATION,
                    can_sell=True,
                    can_receive=True,
                )
            )
            concept = CanonicalConcept(
                organization_id=ORGANIZATION, name="Лоран", normalized_name="лоран"
            )
            system = SizeSystem(
                organization_id=ORGANIZATION, code=SizeSystemCode.ALPHA, name="Літерні"
            )
            session.add_all([concept, system])
            await session.flush()
            family = ProductFamily(organization_id=ORGANIZATION, canonical_concept_id=concept.id)
            session.add_all([family, Size(id=SIZE, size_system_id=system.id, code="M")])
            await session.flush()
            session.add(ProductVariant(id=VARIANT, product_family_id=family.id))
            await session.commit()
        try:
            yield maker
        finally:
            await outer.rollback()


@asynccontextmanager
async def old_client(
    maker: async_sessionmaker[AsyncSession],
) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(SETTINGS)

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[get_current_scope] = _scope
    app.dependency_overrides[session_dependency] = sessions
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


async def forge_sale(session: AsyncSession, print_: str, *, in_parts: bool = False) -> None:
    """The sale of LINE as #67 recorded it: no way, and its answer as sent."""
    session.add(
        Sale(
            id=SALE,
            organization_id=ORGANIZATION,
            store_id=STORE,
            seller_user_id=ACTOR,
            command_id=COMMAND,
            command_fingerprint=print_,
            currency_code="UAH",
            subtotal=Decimal("6000.00"),
            discount_total=Decimal("400.00"),
            total=Decimal("5600.00"),
            response_snapshot=OLD_SALE_ANSWER
            | (
                {"credit": {"credit_id": str(CREDIT), "paid_now": "1000.00", "owed": "4600.00"}}
                if in_parts
                else {}
            ),
        )
    )
    await session.flush()
    session.add(
        SaleItem(
            id=SALE_ITEM,
            sale_id=SALE,
            product_variant_id=VARIANT,
            size_id=SIZE,
            source_location_id=LOCATION,
            quantity=2,
            unit_price=Decimal("3000.00"),
            discount_amount=Decimal("200.00"),
            final_unit_price=Decimal("2800.00"),
            line_total=Decimal("5600.00"),
            currency_code="UAH",
            display_name_snapshot="Пальто Лоран, чорне",
            variant_snapshot=COAT_SNAPSHOT,
        )
    )
    if in_parts:
        await forge_debt(session, sale_id=SALE, amount="5600.00", print_=print_)
    await session.flush()


async def forge_debt(session: AsyncSession, *, sale_id: uuid.UUID, amount: str, print_: str):
    """The debt, and its first payment under the sale's own command and print."""
    session.add(
        CustomerCredit(
            id=CREDIT,
            organization_id=ORGANIZATION,
            store_id=STORE,
            sale_id=sale_id,
            customer_name=CREDIT_BODY["customer_name"],
            customer_phone=CREDIT_BODY["customer_phone"],
            phone_digits="380671234567",
            amount=Decimal(amount),
            currency_code="UAH",
            opened_by_user_id=ACTOR,
        )
    )
    await session.flush()
    session.add(
        CreditEntry(
            organization_id=ORGANIZATION,
            credit_id=CREDIT,
            kind="PAYMENT",
            amount=Decimal("1000.00"),
            command_id=COMMAND,
            command_fingerprint=print_,
            actor_user_id=ACTOR,
        )
    )
    await session.flush()


async def cache(session: AsyncSession, endpoint: str, print_: str, answer: dict) -> None:
    """The 7-day record of the same attempt, answered and not yet purged."""
    session.add(
        IdempotencyRecord(
            organization_id=ORGANIZATION,
            endpoint=endpoint,
            key=IDEMPOTENCY_KEY,
            request_fingerprint=print_,
            status=IdempotencyStatus.COMPLETED,
            response_snapshot=answer,
            http_status=201,
            expires_at=datetime.now(tz=UTC) + timedelta(days=6),
        )
    )
    await session.flush()


async def rows(maker, model: Any) -> int:
    async with maker() as session:
        return await session.scalar(
            select(func.count()).select_from(model).where(model.organization_id == ORGANIZATION)
        )


@pytest.mark.parametrize("cached", [True, False], ids=["within-7-days", "after-7-days"])
async def test_a_sale_kept_from_before_replays_never_refused(old_world, cached):
    async with old_world() as session:
        await forge_sale(session, SALE_PERMANENT)
        if cached:
            await cache(session, "POST /sales", SALE_7_DAY, OLD_SALE_ANSWER)
        await session.commit()

    async with old_client(old_world) as client:
        replayed = await client.post(
            "/api/v1/sales",
            json=SALE_BODY,
            headers={"Idempotency-Key": IDEMPOTENCY_KEY if cached else str(uuid.uuid4())},
        )

    assert replayed.status_code == 201, replayed.text
    # What #67 answered, and no way: an old receipt never shows one. Nor a
    # mark, which no sale had then (ADR-0013 §5.6).
    assert replayed.json() == OLD_SALE_ANSWER | {"payment_method": None, "outage": None}
    assert await rows(old_world, Sale) == 1


@pytest.mark.parametrize("cached", [True, False], ids=["within-7-days", "after-7-days"])
async def test_a_sale_in_parts_kept_from_before_replays_never_refused(old_world, cached):
    answer = OLD_SALE_ANSWER | {
        "credit": {"credit_id": str(CREDIT), "paid_now": "1000.00", "owed": "4600.00"}
    }
    async with old_world() as session:
        await forge_sale(session, SALE_IN_PARTS_PERMANENT, in_parts=True)
        if cached:
            await cache(session, "POST /sales", SALE_IN_PARTS_7_DAY, answer)
        await session.commit()

    async with old_client(old_world) as client:
        replayed = await client.post(
            "/api/v1/sales",
            json=SALE_BODY | {"credit": CREDIT_BODY},
            headers={"Idempotency-Key": IDEMPOTENCY_KEY if cached else str(uuid.uuid4())},
        )

    assert replayed.status_code == 201, replayed.text
    assert replayed.json() == answer | {"payment_method": None, "outage": None}
    assert (await rows(old_world, Sale), await rows(old_world, CreditEntry)) == (1, 1)


@pytest.mark.parametrize(
    ("taken_at", "print_"),
    [(None, PAYMENT_PERMANENT), (OTHER_STORE, PAYMENT_ELSEWHERE_PERMANENT)],
    ids=["where-sold", "elsewhere"],
)
async def test_a_payment_kept_from_before_replays_never_refused(old_world, taken_at, print_):
    async with old_world() as session:
        await forge_sale(session, SALE_IN_PARTS_PERMANENT, in_parts=True)
        session.add(
            CreditEntry(
                organization_id=ORGANIZATION,
                credit_id=CREDIT,
                kind="PAYMENT",
                amount=Decimal("500.00"),
                command_id=PAY_COMMAND,
                command_fingerprint=print_,
                actor_user_id=ACTOR,
                taken_at_store_id=taken_at,
            )
        )
        await session.commit()
    body: dict[str, Any] = {"command_id": str(PAY_COMMAND), "amount": "500.00"}
    if taken_at is not None:
        body["store_id"] = str(taken_at)

    async with old_client(old_world) as client:
        replayed = await client.post(f"/api/v1/credits/{CREDIT}/payments", json=body)

    assert replayed.status_code == 201, replayed.text
    assert replayed.json()["paid"] == "1500.00"
    # Recorded before the way was asked: «не вказано», never guessed.
    assert [entry["payment_method"] for entry in replayed.json()["entries"]] == [None, None]
    assert await rows(old_world, CreditEntry) == 2


async def forge_refund(session: AsyncSession) -> None:
    await forge_sale(session, SALE_PERMANENT)
    session.add(
        Refund(
            id=REFUND,
            organization_id=ORGANIZATION,
            store_id=STORE,
            taken_at_store_id=STORE,
            sale_id=SALE,
            actor_user_id=ACTOR,
            command_id=REFUND_COMMAND,
            command_fingerprint=REFUND_PERMANENT,
            currency_code="UAH",
            total_amount=Decimal("5600.00"),
            reason="Не підійшов розмір",
        )
    )
    await session.flush()
    session.add_all(
        [
            RefundItem(
                refund_id=REFUND,
                sale_item_id=SALE_ITEM,
                quantity=1,
                amount=Decimal("2800.00"),
                restock=True,
                condition="INTACT",
                destination_location_id=LOCATION,
            ),
            RefundItem(
                refund_id=REFUND,
                sale_item_id=SALE_ITEM,
                quantity=1,
                amount=Decimal("2800.00"),
                restock=False,
            ),
        ]
    )
    await session.flush()


@pytest.mark.parametrize("cached", [True, False], ids=["within-7-days", "after-7-days"])
async def test_a_return_kept_from_before_replays_never_refused(old_world, cached):
    answer = {"id": str(REFUND), "sale_id": str(SALE), "store_id": str(STORE), "items": []}
    async with old_world() as session:
        await forge_refund(session)
        if cached:
            await cache(
                session,
                "POST /sales/{sale_id}/refunds",
                REFUND_7_DAY,
                answer | {"currency_code": "UAH", "total_amount": "5600.00"},
            )
        await session.commit()

    async with old_client(old_world) as client:
        replayed = await client.post(
            f"/api/v1/sales/{SALE}/refunds",
            json=REFUND_BODY,
            headers={"Idempotency-Key": IDEMPOTENCY_KEY if cached else str(uuid.uuid4())},
        )

    assert replayed.status_code == 201, replayed.text
    assert replayed.json()["id"] == str(REFUND)
    assert replayed.json()["total_amount"] == "5600.00"
    assert replayed.json()["payment_method"] is None
    assert await rows(old_world, Refund) == 1


async def forge_collection(session: AsyncSession, *, in_parts: bool) -> dict[str, Any]:
    """An order collected by #67, with the sale its collection recorded, and
    the answer its command stored."""
    session.add(
        Sale(
            id=SALE,
            organization_id=ORGANIZATION,
            store_id=STORE,
            seller_user_id=ACTOR,
            command_id=COMMAND,
            command_fingerprint=COLLECTED_SALE_PERMANENT,
            currency_code="UAH",
            subtotal=Decimal("4200.00"),
            discount_total=Decimal("300.00"),
            total=Decimal("3900.00"),
        )
    )
    await session.flush()
    line = {
        "product_variant_id": VARIANT,
        "size_id": SIZE,
        "source_location_id": LOCATION,
        "quantity": 1,
        "unit_price": Decimal("4200.00"),
        "discount_amount": Decimal("300.00"),
        "display_name_snapshot": "Пальто Лоран, чорне",
        "variant_snapshot": COAT_SNAPSHOT,
    }
    session.add(
        SaleItem(
            sale_id=SALE,
            final_unit_price=Decimal("3900.00"),
            line_total=Decimal("3900.00"),
            currency_code="UAH",
            **line,
        )
    )
    session.add(
        CustomerOrder(
            id=ORDER,
            organization_id=ORGANIZATION,
            store_id=STORE,
            created_by_user_id=ACTOR,
            status="COLLECTED",
            sale_id=SALE,
        )
    )
    await session.flush()
    session.add(CustomerOrderItem(order_id=ORDER, **line))
    if in_parts:
        await forge_debt(session, sale_id=SALE, amount="3900.00", print_=COLLECTED_SALE_PERMANENT)
    answer: dict[str, Any] = {
        "id": str(ORDER),
        "store_id": str(STORE),
        "status": "COLLECTED",
        "sale_id": str(SALE),
        "currency_code": "UAH",
        "total": "3900.00",
        "items": [],
    } | (
        {"credit": {"credit_id": str(CREDIT), "paid": "1000.00", "owed": "2900.00"}}
        if in_parts
        else {}
    )
    session.add(
        OrderCommand(
            organization_id=ORGANIZATION,
            order_id=ORDER,
            command_id=COMMAND,
            fingerprint=ORDER_COLLECT_IN_PARTS_PERMANENT if in_parts else ORDER_COLLECT_PERMANENT,
            response_snapshot=answer,
        )
    )
    await session.flush()
    return answer


@pytest.mark.parametrize("in_parts", [False, True], ids=["paid-in-full", "in-parts"])
async def test_a_collection_kept_from_before_replays_never_refused(old_world, in_parts):
    async with old_world() as session:
        answer = await forge_collection(session, in_parts=in_parts)
        await session.commit()
    body: dict[str, Any] = {"command_id": str(COMMAND)}
    if in_parts:
        body["credit"] = CREDIT_BODY

    async with old_client(old_world) as client:
        replayed = await client.post(f"/api/v1/orders/{ORDER}/collect", json=body)

    assert replayed.status_code == 200, replayed.text
    assert replayed.json()["sale_id"] == answer["sale_id"]
    assert replayed.json()["payment_method"] is None
    assert await rows(old_world, Sale) == 1


async def test_an_old_command_resent_with_a_way_is_another_command(old_world):
    """The rollback residue the design records (ADR-0012, B13 (a)): a command
    recorded without a way and resent with one is not the same command, at
    any distance — a conflict, and nothing recorded twice."""
    async with old_world() as session:
        await forge_refund(session)
        await cache(session, "POST /sales", SALE_7_DAY, OLD_SALE_ANSWER)
        await session.commit()

    async with old_client(old_world) as client:
        sale_cached = await client.post(
            "/api/v1/sales",
            json=SALE_BODY | {"payment_method": "CASH"},
            headers={"Idempotency-Key": IDEMPOTENCY_KEY},
        )
        sale_permanent = await client.post(
            "/api/v1/sales", json=SALE_BODY | {"payment_method": "CASH"}, headers=key()
        )
        refund = await client.post(
            f"/api/v1/sales/{SALE}/refunds",
            json=REFUND_BODY | {"payment_method": "CASH"},
            headers=key(),
        )

    for conflict in (sale_cached, sale_permanent, refund):
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert (await rows(old_world, Sale), await rows(old_world, Refund)) == (1, 1)


async def test_an_old_payment_or_collection_resent_with_a_way_is_another_command(old_world):
    async with old_world() as session:
        await forge_collection(session, in_parts=True)
        session.add(
            CreditEntry(
                organization_id=ORGANIZATION,
                credit_id=CREDIT,
                kind="PAYMENT",
                amount=Decimal("500.00"),
                command_id=PAY_COMMAND,
                command_fingerprint=PAYMENT_PERMANENT,
                actor_user_id=ACTOR,
            )
        )
        await session.commit()

    async with old_client(old_world) as client:
        payment = await client.post(
            f"/api/v1/credits/{CREDIT}/payments",
            json={"command_id": str(PAY_COMMAND), "amount": "500.00", "payment_method": "CASH"},
        )
        collection = await client.post(
            f"/api/v1/orders/{ORDER}/collect",
            json={"command_id": str(COMMAND), "credit": CREDIT_BODY, "payment_method": "CASH"},
        )

    for conflict in (payment, collection):
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert await rows(old_world, CreditEntry) == 2
