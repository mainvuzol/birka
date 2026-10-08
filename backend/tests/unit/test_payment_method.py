"""How a customer paid, at the four money commands' doors (owner decisions,
2026-10-04; ADR-0012, B2, B13; D1).

The way is optional in every request and required of a new command after its
replay lookup. A request schema that required it would refuse an attempt a
phone kept from before the way was asked before that lookup ever ran, and the
attempt would stay stuck for good with its sale recorded. So these check both
halves: what the schemas take and how they print it, and that each service
asks for the way only once the lookup has found nothing — with
`recorded: false`, so a phone may settle an attempt whose outcome it did not
know.

The services are driven as `test_old_prints_are_pinned.py` drives them: the
database calls in front of the lookup are stubbed, and the lookup answers.
What follows a refusal would need the database; the refusal comes first, so
it never gets there.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, get_args

import pytest
from pydantic import ValidationError

from app.api.v1.credits import PaymentRequest
from app.api.v1.orders import CollectOrderRequest
from app.api.v1.refunds import RefundRequest
from app.api.v1.sales import MethodValue, SaleRequest, TillMethodValue
from app.core.errors import ValidationFailedError
from app.modules.credit import service as credit_service
from app.modules.orders import service as orders_service
from app.modules.refunds import service as refunds_service
from app.modules.refunds.models import ReturnCondition
from app.modules.refunds.service import RefundLineInput
from app.modules.sales import service as sales_service
from app.modules.sales.models import SaleStatus
from app.modules.sales.payment import (
    DRAWER_METHOD,
    OFF_TILL_METHODS,
    ORDER_METHODS,
    TILL_METHODS,
    PaymentMethod,
    print_of,
    stated_way,
)
from app.modules.sales.service import SaleLineInput
from tests.unit.test_old_prints_are_pinned import (
    COMMAND,
    CREDIT,
    LINE,
    LOCATION,
    ORDER,
    SALE,
    SALE_ITEM,
    SIZE,
    STORE,
    VARIANT,
    _nothing,
    _scope,
)

SALE_BODY = {"store_id": str(STORE), "command_id": str(COMMAND), "lines": [LINE]}
REFUND_BODY = {
    "command_id": str(COMMAND),
    "lines": [{"sale_item_id": str(SALE_ITEM), "quantity": 1, "restock": False}],
}
TILL = ["CASH", "CARD", "TRANSFER"]
ORDER_ONLY = ["PREPAID_TRANSFER", "CARRIER_COD"]


# --- the enum and its sets ---------------------------------------------------


def test_the_requests_take_exactly_the_ways_of_the_enum() -> None:
    """The schemas spell the ways as Literals; they may not drift from the
    enum the services and the database checks use."""
    assert set(get_args(TillMethodValue)) == {str(way) for way in TILL_METHODS}
    assert set(get_args(MethodValue)) == {str(way) for way in ORDER_METHODS}
    assert set(get_args(MethodValue)) == {str(way) for way in PaymentMethod}


def test_the_drawer_counts_cash_alone_and_orders_take_two_ways_more() -> None:
    assert DRAWER_METHOD is PaymentMethod.CASH
    assert TILL_METHODS == {PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.TRANSFER}
    assert OFF_TILL_METHODS == {PaymentMethod.PREPAID_TRANSFER, PaymentMethod.CARRIER_COD}
    assert ORDER_METHODS == TILL_METHODS | OFF_TILL_METHODS
    assert not TILL_METHODS & OFF_TILL_METHODS


# --- the requests ------------------------------------------------------------


def test_a_sale_request_refuses_a_field_it_does_not_know() -> None:
    with pytest.raises(ValidationError, match="extra"):
        SaleRequest.model_validate(SALE_BODY | {"paid_by": "CASH"})


@pytest.mark.parametrize("way", [*ORDER_ONLY, "CHEQUE", "cash", ""])
def test_a_sale_request_refuses_every_way_but_the_tills(way: str) -> None:
    with pytest.raises(ValidationError):
        SaleRequest.model_validate(SALE_BODY | {"payment_method": way})


@pytest.mark.parametrize("way", TILL)
def test_a_sale_request_takes_each_of_the_tills_ways(way: str) -> None:
    assert SaleRequest.model_validate(SALE_BODY | {"payment_method": way}).payment_method == way


def test_a_sale_request_without_a_way_prints_as_before_ways_existed() -> None:
    """The 7-day print of an attempt kept from before: exactly the body it
    was, with no `payment_method` key at all."""
    request = SaleRequest.model_validate(SALE_BODY)

    assert request.payment_method is None
    printed = request.fingerprinted()
    assert "payment_method" not in printed
    # Nor the mark of a sale typed from paper, which came later still
    # (ADR-0013 §5.2).
    assert printed == {
        key: value
        for key, value in request.model_dump(mode="json").items()
        if key not in {"payment_method", "outage"}
    }


@pytest.mark.parametrize("way", TILL)
def test_a_sale_request_with_a_way_prints_its_whole_body(way: str) -> None:
    request = SaleRequest.model_validate(SALE_BODY | {"payment_method": way})

    # Whole but for the mark of a sale typed from paper, absent when unused
    # (ADR-0013 §5.2).
    printed = request.model_dump(mode="json")
    del printed["outage"]
    assert request.fingerprinted() == printed
    assert request.fingerprinted()["payment_method"] == way


def test_a_sale_in_parts_gives_its_way_beside_the_credit_not_inside() -> None:
    credit = {"customer_name": "Ірина", "customer_phone": "0671234567", "paid_now": "100.00"}

    request = SaleRequest.model_validate(SALE_BODY | {"credit": credit, "payment_method": "CARD"})
    assert request.payment_method == "CARD"
    with pytest.raises(ValidationError, match="extra"):
        SaleRequest.model_validate(SALE_BODY | {"credit": credit | {"payment_method": "CARD"}})


@pytest.mark.parametrize("way", [*ORDER_ONLY, "CHEQUE"])
def test_a_refund_request_refuses_every_way_but_the_tills(way: str) -> None:
    with pytest.raises(ValidationError):
        RefundRequest.model_validate(REFUND_BODY | {"payment_method": way})


def test_a_refund_request_without_a_way_prints_as_before() -> None:
    request = RefundRequest.model_validate(REFUND_BODY)

    assert request.payment_method is None
    assert "payment_method" not in request.fingerprinted()


@pytest.mark.parametrize("way", TILL)
def test_a_refund_request_with_a_way_prints_it(way: str) -> None:
    request = RefundRequest.model_validate(REFUND_BODY | {"payment_method": way})

    assert request.fingerprinted()["payment_method"] == way
    # Otherwise the body as before: the newer fields left out when unused.
    printed = request.model_dump(mode="json")
    del printed["store_id"]
    for line in printed["lines"]:
        del line["location_id"]
    assert request.fingerprinted() == printed


@pytest.mark.parametrize("way", [None, *TILL])
def test_a_payment_request_takes_no_way_or_one_of_the_tills(way: str | None) -> None:
    body: dict[str, Any] = {"command_id": str(COMMAND), "amount": "500.00"}
    if way is not None:
        body["payment_method"] = way

    assert PaymentRequest.model_validate(body).payment_method == way


@pytest.mark.parametrize("way", ORDER_ONLY)
def test_a_payment_request_refuses_an_order_way(way: str) -> None:
    with pytest.raises(ValidationError):
        PaymentRequest.model_validate(
            {"command_id": str(COMMAND), "amount": "500.00", "payment_method": way}
        )


@pytest.mark.parametrize("way", [None, *TILL, *ORDER_ONLY])
def test_a_collection_takes_no_way_or_any_of_the_five(way: str | None) -> None:
    body: dict[str, Any] = {"command_id": str(COMMAND)}
    if way is not None:
        body["payment_method"] = way

    assert CollectOrderRequest.model_validate(body).payment_method == way


def test_a_collection_refuses_a_way_it_does_not_know() -> None:
    with pytest.raises(ValidationError):
        CollectOrderRequest.model_validate({"command_id": str(COMMAND), "payment_method": "GIFT"})


# --- the check and the print -------------------------------------------------


def test_a_new_command_without_a_way_is_refused_and_recorded_nothing() -> None:
    with pytest.raises(ValidationFailedError) as refused:
        stated_way(None, takes=TILL_METHODS)

    assert refused.value.details == {"reason": "PAYMENT_METHOD_REQUIRED", "recorded": False}


@pytest.mark.parametrize("way", sorted(OFF_TILL_METHODS))
def test_an_order_way_is_refused_on_the_till_and_recorded_nothing(way: PaymentMethod) -> None:
    with pytest.raises(ValidationFailedError) as refused:
        stated_way(way, takes=TILL_METHODS)

    assert refused.value.details == {
        "reason": "METHOD_NOT_FOR_THIS",
        "recorded": False,
        "payment_method": str(way),
    }


@pytest.mark.parametrize("way", sorted(ORDER_METHODS))
def test_a_way_the_command_takes_is_handed_back(way: PaymentMethod) -> None:
    assert stated_way(way, takes=ORDER_METHODS) is way
    assert stated_way(None, takes=ORDER_METHODS, required=False) is None


def test_a_print_carries_the_way_only_when_one_is_stated() -> None:
    assert print_of(None) == {}
    assert print_of(PaymentMethod.CARD) == {"payment_method": "CARD"}


# --- each service asks after its replay lookup --------------------------------


class _PastTheCheckError(Exception):
    """Raised by the first database call after the check: the command went on."""


class _Locking:
    """A session whose first lock says the command got past the check."""

    async def refresh(self, *args: Any, **kwargs: Any) -> None:
        raise _PastTheCheckError


@pytest.fixture
def unguarded(monkeypatch: pytest.MonkeyPatch) -> None:
    """Who may reach which warehouse is read from the database, and is not
    what is checked here."""
    for module in (sales_service, refunds_service, orders_service):
        monkeypatch.setattr(module, "require_stock_access", _nothing)


def _lookup(answer: object) -> Any:
    async def lookup(*args: Any, **kwargs: Any) -> object:
        return answer

    return lookup


async def _sell(payment_method: PaymentMethod | None) -> Any:
    return await sales_service.create_sale(
        None,  # type: ignore[arg-type]
        scope=_scope(),
        store_id=STORE,
        command_id=COMMAND,
        lines=[
            SaleLineInput(
                product_variant_id=VARIANT,
                size_id=SIZE,
                source_location_id=LOCATION,
                quantity=1,
                unit_price=Decimal("3000.00"),
            )
        ],
        currency_code="UAH",
        payment_method=payment_method,
    )


async def test_a_sale_kept_from_before_replays_without_a_way(
    unguarded: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    stored = object()
    monkeypatch.setattr(sales_service, "_existing_command", _lookup(stored))

    assert await _sell(None) is stored


async def test_a_new_sale_without_a_way_is_refused_before_anything_is_locked(
    unguarded: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sales_service, "_existing_command", _lookup(None))

    with pytest.raises(ValidationFailedError) as refused:
        await _sell(None)

    assert refused.value.details == {"reason": "PAYMENT_METHOD_REQUIRED", "recorded": False}


async def test_a_new_sale_with_an_order_way_is_refused(
    unguarded: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sales_service, "_existing_command", _lookup(None))

    with pytest.raises(ValidationFailedError) as refused:
        await _sell(PaymentMethod.CARRIER_COD)

    assert refused.value.details["reason"] == "METHOD_NOT_FOR_THIS"
    assert refused.value.details["recorded"] is False


async def _pay(monkeypatch: pytest.MonkeyPatch, replayed: object) -> Any:
    async def locked(session: Any, *, organization_id: uuid.UUID, credit_id: uuid.UUID) -> Any:
        return SimpleNamespace(id=CREDIT, store_id=STORE)

    monkeypatch.setattr(credit_service, "_locked", locked)
    monkeypatch.setattr(credit_service, "_replayed", _lookup(replayed))
    return await credit_service.pay(
        None,  # type: ignore[arg-type]
        scope=_scope(),
        credit_id=CREDIT,
        command_id=COMMAND,
        amount=Decimal("500.00"),
    )


async def test_a_payment_kept_from_before_replays_without_a_way(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored = object()

    assert await _pay(monkeypatch, stored) is stored


async def test_a_new_payment_without_a_way_is_refused_before_the_stores_are_held(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ValidationFailedError) as refused:
        await _pay(monkeypatch, None)

    assert refused.value.details == {"reason": "PAYMENT_METHOD_REQUIRED", "recorded": False}


async def _refund(
    monkeypatch: pytest.MonkeyPatch, replayed: object, payment_method: PaymentMethod | None
) -> Any:
    async def load_sale(session: Any, *, organization_id: uuid.UUID, sale_id: uuid.UUID) -> Any:
        return SimpleNamespace(id=SALE, store_id=STORE, status=SaleStatus.COMPLETED)

    class Lines:
        async def scalars(self, statement: Any) -> Any:
            return SimpleNamespace(
                all=lambda: [SimpleNamespace(id=SALE_ITEM, source_location_id=LOCATION)]
            )

    monkeypatch.setattr(refunds_service, "_load_sale", load_sale)
    monkeypatch.setattr(refunds_service, "hold_trading_stores", _nothing)
    monkeypatch.setattr(refunds_service, "validate_active_stores", _nothing)
    monkeypatch.setattr(refunds_service, "_existing_command", _lookup(replayed))
    return await refunds_service.create_refund(
        Lines(),  # type: ignore[arg-type]
        scope=_scope(),
        sale_id=SALE,
        command_id=COMMAND,
        lines=[
            RefundLineInput(
                sale_item_id=SALE_ITEM, quantity=1, restock=True, condition=ReturnCondition.INTACT
            )
        ],
        payment_method=payment_method,
    )


async def test_a_return_kept_from_before_replays_without_a_way(
    unguarded: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    stored = object()

    assert await _refund(monkeypatch, stored, None) is stored


async def test_a_new_return_with_an_order_way_is_refused_before_the_sale_is_locked(
    unguarded: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Whether a return needs a way at all waits for the split of a debt
    (ADR-0012, G35), under the sale's locks, and is checked against the
    database; a way it can never take is refused at once."""
    with pytest.raises(ValidationFailedError) as refused:
        await _refund(monkeypatch, None, PaymentMethod.PREPAID_TRANSFER)

    assert refused.value.details["reason"] == "METHOD_NOT_FOR_THIS"
    assert refused.value.details["recorded"] is False


async def _collect(
    monkeypatch: pytest.MonkeyPatch,
    replayed: object,
    payment_method: PaymentMethod | None,
    action: str = "collect",
) -> Any:
    async def load(session: Any, scope: Any, order_id: uuid.UUID, **_: Any) -> Any:
        return SimpleNamespace(id=ORDER, store_id=STORE), []

    monkeypatch.setattr(orders_service, "_load", load)
    monkeypatch.setattr(orders_service, "_command", _lookup(replayed))
    return await orders_service.transition_order(
        _Locking(),  # type: ignore[arg-type]
        scope=_scope(),
        order_id=ORDER,
        command_id=COMMAND,
        action=action,
        payment_method=payment_method,
    )


async def test_a_collection_kept_from_before_replays_without_a_way(
    unguarded: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    stored = {"id": str(ORDER)}

    assert await _collect(monkeypatch, stored, None) is stored


async def test_a_new_collection_without_a_way_is_refused_before_the_order_is_locked(
    unguarded: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(ValidationFailedError) as refused:
        await _collect(monkeypatch, None, None)

    assert refused.value.details == {"reason": "PAYMENT_METHOD_REQUIRED", "recorded": False}


@pytest.mark.parametrize("action", ["dispatch", "arrive", "cancel"])
async def test_only_a_collection_says_how_an_order_was_paid(
    unguarded: None, monkeypatch: pytest.MonkeyPatch, action: str
) -> None:
    with pytest.raises(ValidationFailedError, match="Only a collected order"):
        await _collect(monkeypatch, None, PaymentMethod.CASH, action=action)


@pytest.mark.parametrize("way", sorted(ORDER_METHODS))
async def test_a_new_collection_goes_on_with_any_of_the_five(
    unguarded: None, monkeypatch: pytest.MonkeyPatch, way: PaymentMethod
) -> None:
    with pytest.raises(_PastTheCheckError):
        await _collect(monkeypatch, None, way)


@pytest.mark.parametrize("action", ["dispatch", "arrive", "cancel"])
async def test_the_other_order_actions_ask_no_way(
    unguarded: None, monkeypatch: pytest.MonkeyPatch, action: str
) -> None:
    with pytest.raises(_PastTheCheckError):
        await _collect(monkeypatch, None, None, action=action)
