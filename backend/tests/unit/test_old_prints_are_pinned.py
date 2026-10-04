"""The prints old attempts were stored with, pinned (ADR-0012, B13; D1).

A money command is recognised by two prints: the 7-day one the
Idempotency-Key cache compares, and the permanent one stored on the business
row (`command_fingerprint`, I20). An attempt a phone kept from before «cash
and card» carries no way of paying, and once the commands require one it must
still replay: so the print of a request without `payment_method` has to stay,
byte for byte, what it was.

Nothing pinned them before (`test_idempotency_fingerprint.py` tests only the
hash). The values below were computed by this file against the code of #67
(`32ea05a`), before any money command knew a way of paying, and they never
change: when one of these tests goes red, the change broke old attempts, not
the test. How a print is taken may follow the code (a new parameter passed as
None, a capture point that moves); the values may not. The integration tests
that forge old rows write these same literals (ADR-0012, D2).

Each print is taken from the real command code, driven from an HTTP body
through its endpoint where there is one. The database calls in front of the
print are stubbed, and the replay lookup — where the print is compared with
what was stored — takes it and stops the command there.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import Response

from app.api.v1 import credits as credits_api
from app.api.v1 import orders as orders_api
from app.api.v1 import refunds as refunds_api
from app.api.v1 import sales as sales_api
from app.core import idempotency
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.credit import service as credit_service
from app.modules.orders import service as orders_service
from app.modules.refunds import service as refunds_service
from app.modules.sales import order_collection
from app.modules.sales import service as sales_service
from app.modules.sales.models import SaleStatus
from app.modules.sales.order_collection import CollectedSaleLine, record_collected_sale

# Fixed inputs. Every print names the actor and the store, and most name the
# goods, so a test that forges an old row must use exactly these.
ORGANIZATION = uuid.UUID("0a000000-0000-4000-8000-000000000001")
ACTOR = uuid.UUID("0a000000-0000-4000-8000-000000000002")
STORE = uuid.UUID("0a000000-0000-4000-8000-000000000003")
# The store taking a payment or a return when it is not the one that sold.
OTHER_STORE = uuid.UUID("0a000000-0000-4000-8000-000000000004")
VARIANT = uuid.UUID("0a000000-0000-4000-8000-000000000005")
SIZE = uuid.UUID("0a000000-0000-4000-8000-000000000006")
LOCATION = uuid.UUID("0a000000-0000-4000-8000-000000000007")
# A warehouse of the other store, chosen for intact goods it cannot send back.
OTHER_LOCATION = uuid.UUID("0a000000-0000-4000-8000-000000000008")
# The other store's «Брак».
DAMAGED_LOCATION = uuid.UUID("0a000000-0000-4000-8000-000000000009")
CREDIT = uuid.UUID("0a000000-0000-4000-8000-00000000000a")
ORDER = uuid.UUID("0a000000-0000-4000-8000-00000000000b")
SALE = uuid.UUID("0a000000-0000-4000-8000-00000000000c")
SALE_ITEM = uuid.UUID("0a000000-0000-4000-8000-00000000000d")
COMMAND = uuid.UUID("0a000000-0000-4000-8000-00000000000e")
IDEMPOTENCY_KEY = "pinned-print-0001"

LINE = {
    "product_variant_id": str(VARIANT),
    "size_id": str(SIZE),
    "source_location_id": str(LOCATION),
    "quantity": 2,
    "unit_price": "3000.00",
    "discount_amount": "200.00",
}
CREDIT_BODY = {
    "customer_name": "Оксана Петренко",
    "customer_phone": "+380 67 123 45 67",
    "paid_now": "1000.00",
}

# The golden prints, computed at 32ea05a.
SALE_7_DAY = "cb7e4a49c6ff5f798e6e988d7a26397430e5c138a3070f20af52556276e0fe0b"
SALE_PERMANENT = "e1ab72174fc0837abc06413788c20f0c06bb07bd24c9dc3e6b38e875d13d93cc"
SALE_IN_PARTS_7_DAY = "834761bbf03fab7388f8000c7d937ff405af92b9afa5a0ceb262501ba34fe8f6"
SALE_IN_PARTS_PERMANENT = "9d945b142f793e36a248c64e82e79ccc143187ae23c52346af8bb3bca46d71c1"
PAYMENT_PERMANENT = "fdb14f223779b046289411f7d0858eec04474505a9644453f3ea23f404588b01"
PAYMENT_ELSEWHERE_PERMANENT = "410843bb7b8da9be7de724a4536b95e8f7e63ef4569f719878d18ad0f27ef34a"
REFUND_7_DAY = "72b2a11dab20994cfccce63330baee36878fe4fbc852d9e2a86b409671d9ac15"
REFUND_PERMANENT = "61250f66683ecfa9c03abf9898636b2035a7d3af0e966fd650ce029513855ad4"
REFUND_ELSEWHERE_7_DAY = "7112911b9973c59e42c4f3b76dcebd40c785af6edcda8a146438eb0e707cc6b6"
REFUND_ELSEWHERE_PERMANENT = "d0c1e0c0110554f647bf6cb7ea436c43027a5b2adabd5c7d05dfdbb973a7f0ca"
ORDER_COLLECT_PERMANENT = "31e146b93045cca3c66be30f8374c342a50f014507e8d6ef7cb3081a55ec6997"
ORDER_COLLECT_IN_PARTS_PERMANENT = (
    "57c4adf476afd5ccb0fb4056c78400326083eb000ae0f121ec3df756bbe78959"
)
COLLECTED_SALE_PERMANENT = "58134a528d0ccede44c4919580a26ce12b28af2c4e7211340e88ab8e99ab7c67"


class _StoppedError(Exception):
    """Raised where the stored print would be compared: the command goes no
    further, and nothing after the print matters here."""


async def _nothing(*args: Any, **kwargs: Any) -> None:
    return None


def _scope() -> RequestScope:
    """Everything, in both stores: authority is not what is pinned here."""
    every = frozenset(Permission)
    return RequestScope(
        user_id=ACTOR,
        organization_id=ORGANIZATION,
        store_permissions={STORE: every, OTHER_STORE: every},
    )


@pytest.fixture
def taken(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """The prints the command code computes, by kind ("7-day", "permanent")."""
    prints: dict[str, str] = {}

    async def claim(session: Any, *, request_fingerprint: str, **_: Any) -> idempotency.Claim:
        prints["7-day"] = request_fingerprint
        return idempotency.Claim(record_id=uuid.uuid4())

    async def command_lookup(
        session: Any, *, scope: RequestScope, command_id: uuid.UUID, request_fingerprint: str
    ) -> None:
        prints["permanent"] = request_fingerprint
        raise _StoppedError

    async def payment_lookup(
        session: Any,
        *,
        scope: RequestScope,
        command_id: uuid.UUID,
        fingerprint: str,
        credit_id: uuid.UUID,
    ) -> None:
        prints["permanent"] = fingerprint
        raise _StoppedError

    async def order_lookup(
        session: Any, scope: RequestScope, command_id: uuid.UUID, request_fingerprint: str
    ) -> None:
        prints["permanent"] = request_fingerprint
        raise _StoppedError

    monkeypatch.setattr(idempotency, "claim", claim)
    # Who may reach which warehouse is read from the database, and is not
    # what is pinned.
    for module in (
        sales_api,
        sales_service,
        refunds_api,
        refunds_service,
        orders_service,
        order_collection,
    ):
        monkeypatch.setattr(module, "require_stock_access", _nothing)
    monkeypatch.setattr(sales_service, "_existing_command", command_lookup)
    monkeypatch.setattr(order_collection, "_existing_command", command_lookup)
    monkeypatch.setattr(refunds_service, "_existing_command", command_lookup)
    monkeypatch.setattr(credit_service, "_replayed", payment_lookup)
    monkeypatch.setattr(orders_service, "_command", order_lookup)
    return prints


async def _sell(body: dict[str, Any]) -> None:
    with pytest.raises(_StoppedError):
        await sales_api.create(
            payload=sales_api.SaleRequest.model_validate(body),
            scope=_scope(),
            session=None,
            settings=SimpleNamespace(default_currency_code="UAH"),
            response=Response(),
            idempotency_key=IDEMPOTENCY_KEY,
        )


async def test_a_sale_paid_in_full_keeps_both_prints(taken: dict[str, str]) -> None:
    await _sell({"store_id": str(STORE), "command_id": str(COMMAND), "lines": [LINE]})

    assert taken == {"7-day": SALE_7_DAY, "permanent": SALE_PERMANENT}


async def test_a_sale_paid_in_parts_keeps_both_prints(taken: dict[str, str]) -> None:
    """The first payment toward the debt is stored with this same permanent
    print (`credit/service.py: open_credit`)."""
    await _sell(
        {
            "store_id": str(STORE),
            "command_id": str(COMMAND),
            "lines": [LINE],
            "credit": CREDIT_BODY,
        }
    )

    assert taken == {"7-day": SALE_IN_PARTS_7_DAY, "permanent": SALE_IN_PARTS_PERMANENT}


@pytest.mark.parametrize(
    ("taken_at", "expected"),
    [(None, PAYMENT_PERMANENT), (OTHER_STORE, PAYMENT_ELSEWHERE_PERMANENT)],
    ids=["where-sold", "elsewhere"],
)
async def test_a_later_payment_keeps_its_print(
    taken: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    taken_at: uuid.UUID | None,
    expected: str,
) -> None:
    async def locked(session: Any, *, organization_id: uuid.UUID, credit_id: uuid.UUID) -> Any:
        return SimpleNamespace(id=CREDIT, store_id=STORE)

    monkeypatch.setattr(credit_service, "_locked", locked)
    body: dict[str, Any] = {"command_id": str(COMMAND), "amount": "500.00"}
    if taken_at is not None:
        body["store_id"] = str(taken_at)

    with pytest.raises(_StoppedError):
        await credits_api.pay(
            credit_id=CREDIT,
            payload=credits_api.PaymentRequest.model_validate(body),
            scope=_scope(),
            session=None,
        )

    assert taken == {"permanent": expected}


class _SaleLines:
    """The one query `create_refund` sends itself: the sale's lines."""

    async def scalars(self, statement: Any) -> Any:
        return SimpleNamespace(
            all=lambda: [SimpleNamespace(id=SALE_ITEM, source_location_id=LOCATION)]
        )


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (
            {
                "command_id": str(COMMAND),
                "lines": [
                    {
                        "sale_item_id": str(SALE_ITEM),
                        "quantity": 1,
                        "restock": True,
                        "condition": "INTACT",
                    },
                    {"sale_item_id": str(SALE_ITEM), "quantity": 1, "restock": False},
                ],
                "reason": "Не підійшов розмір",
            },
            {"7-day": REFUND_7_DAY, "permanent": REFUND_PERMANENT},
        ),
        (
            {
                "command_id": str(COMMAND),
                "lines": [
                    {
                        "sale_item_id": str(SALE_ITEM),
                        "quantity": 1,
                        "restock": True,
                        "condition": "INTACT",
                        "location_id": str(OTHER_LOCATION),
                    },
                    {
                        "sale_item_id": str(SALE_ITEM),
                        "quantity": 1,
                        "restock": True,
                        "condition": "DAMAGED",
                    },
                ],
                "store_id": str(OTHER_STORE),
            },
            {"7-day": REFUND_ELSEWHERE_7_DAY, "permanent": REFUND_ELSEWHERE_PERMANENT},
        ),
    ],
    ids=["where-sold", "elsewhere"],
)
async def test_a_refund_keeps_both_prints(
    taken: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    body: dict[str, Any],
    expected: dict[str, str],
) -> None:
    async def sold_at(session: Any, *, organization_id: uuid.UUID, sale_id: uuid.UUID) -> Any:
        return STORE

    async def load_sale(session: Any, *, organization_id: uuid.UUID, sale_id: uuid.UUID) -> Any:
        return SimpleNamespace(id=SALE, store_id=STORE, status=SaleStatus.COMPLETED)

    async def back_on_sale(session: Any, *, organization_id: uuid.UUID, store_id: uuid.UUID) -> Any:
        return {OTHER_LOCATION}

    async def damaged(session: Any, *, organization_id: uuid.UUID, store_id: uuid.UUID) -> Any:
        return DAMAGED_LOCATION

    async def destinations(session: Any, **_: Any) -> set[uuid.UUID]:
        return set()

    monkeypatch.setattr(refunds_api, "sale_store_id", sold_at)
    monkeypatch.setattr(refunds_api, "refund_destinations", destinations)
    monkeypatch.setattr(refunds_service, "_load_sale", load_sale)
    monkeypatch.setattr(refunds_service, "hold_trading_stores", _nothing)
    monkeypatch.setattr(refunds_service, "validate_active_stores", _nothing)
    monkeypatch.setattr(refunds_service, "back_on_sale_locations", back_on_sale)
    monkeypatch.setattr(refunds_service, "damaged_destination", damaged)

    with pytest.raises(_StoppedError):
        await refunds_api.create(
            sale_id=SALE,
            payload=refunds_api.RefundRequest.model_validate(body),
            scope=_scope(),
            session=_SaleLines(),
            response=Response(),
            idempotency_key=IDEMPOTENCY_KEY,
        )

    assert taken == expected


@pytest.mark.parametrize(
    ("credit", "expected"),
    [(None, ORDER_COLLECT_PERMANENT), (CREDIT_BODY, ORDER_COLLECT_IN_PARTS_PERMANENT)],
    ids=["paid-in-full", "in-parts"],
)
async def test_an_order_collected_keeps_its_print(
    taken: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    credit: dict[str, str] | None,
    expected: str,
) -> None:
    async def load(session: Any, scope: RequestScope, order_id: uuid.UUID, **_: Any) -> Any:
        return SimpleNamespace(id=ORDER, store_id=STORE), []

    monkeypatch.setattr(orders_service, "_load", load)
    body: dict[str, Any] = {"command_id": str(COMMAND)}
    if credit is not None:
        body["credit"] = credit

    with pytest.raises(_StoppedError):
        await orders_api.collect(
            order_id=ORDER,
            payload=orders_api.CollectOrderRequest.model_validate(body),
            scope=_scope(),
            session=None,
        )

    assert taken == {"permanent": expected}


async def test_the_sale_an_order_records_keeps_its_print(taken: dict[str, str]) -> None:
    """The sale «Клієнт забрав» records shares the order command's id; its own
    print is checked against the sale row."""
    with pytest.raises(_StoppedError):
        await record_collected_sale(
            None,
            scope=_scope(),
            store_id=STORE,
            order_id=ORDER,
            command_id=COMMAND,
            lines=[
                CollectedSaleLine(
                    product_variant_id=VARIANT,
                    size_id=SIZE,
                    source_location_id=LOCATION,
                    quantity=1,
                    unit_price=Decimal("4200.00"),
                    discount_amount=Decimal("300.00"),
                    display_name_snapshot="Пальто Лоран, чорне",
                    variant_snapshot={"model": "Пальто Лоран", "colour": "чорне", "size": "M"},
                )
            ],
            payment_method=None,
        )

    assert taken == {"permanent": COLLECTED_SALE_PERMANENT}
