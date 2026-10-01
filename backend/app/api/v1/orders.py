"""Customer orders: permanent command ids are the retry contract.

Where an order goes (owner decisions, 2026-10-01): `destination` and, within
Ukraine, `carrier` when it is made; `waybill`, or `abroad_note` abroad, on
`POST /orders/{id}/dispatch` or later; `POST /orders/{id}/shipping` corrects
any of it while the order is open. `GET /orders?waybill=` finds orders by
their waybill, and an order names the store's other orders sharing it.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep
from app.api.v1.sales import CreditPayload
from app.core.text import CleanText
from app.modules.credit import service as credit_service
from app.modules.orders.models import Carrier, Destination
from app.modules.orders.service import (
    OrderLineInput,
    change_shipping,
    create_order,
    list_orders,
    read_order,
    transition_order,
)

router = APIRouter(tags=["orders"])


class OrderLinePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    source_location_id: uuid.UUID
    quantity: int = Field(strict=True, gt=0, le=1000)
    unit_price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)


DestinationValue = Literal["UKRAINE", "ABROAD"]
CarrierValue = Literal["NOVA_POSHTA", "UKRPOSHTA", "MEEST"]


class CreateOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    store_id: uuid.UUID
    command_id: uuid.UUID
    lines: list[OrderLinePayload] = Field(min_length=1, max_length=100)
    # Within Ukraine unless said otherwise, and then by a carrier, always.
    destination: DestinationValue = "UKRAINE"
    carrier: CarrierValue | None = None


class OrderActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: uuid.UUID


class CollectOrderRequest(OrderActionRequest):
    # Present only when the customer pays in parts: as at the till, above
    # nothing now and the rest owed to the order's store (owner decision,
    # 2026-10-01).
    credit: CreditPayload | None = None


class DispatchOrderRequest(OrderActionRequest):
    # Written now, or later through `/shipping`: the waybill within Ukraine,
    # or abroad the city, country and how it was sent, together.
    waybill: CleanText | None = Field(default=None, max_length=64)
    abroad_note: CleanText | None = Field(default=None, max_length=1000)


class ShippingRequest(OrderActionRequest):
    """Where the order goes, as it should stand: every field, not a change."""

    destination: DestinationValue
    carrier: CarrierValue | None = None
    waybill: CleanText | None = Field(default=None, max_length=64)
    abroad_note: CleanText | None = Field(default=None, max_length=1000)


class ReturnOrderRequest(OrderActionRequest):
    reason: CleanText = Field(min_length=1, max_length=1000)
    physically_received: Literal[True]


class OrderItemResponse(BaseModel):
    id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    source_location_id: uuid.UUID
    quantity: int
    unit_price: str
    discount_amount: str
    display_name: str
    size_label: str | None = None


class OrderCreditResponse(BaseModel):
    """A collected order paid in parts: what is paid and owed so far. No
    name or phone, as on a sale's receipt."""

    credit_id: uuid.UUID
    paid: str
    owed: str


class ShippingChangeResponse(BaseModel):
    """One version of where the order went, and who stated it when."""

    kind: Literal["CREATED", "DISPATCHED", "CORRECTED"]
    destination: DestinationValue
    carrier: CarrierValue | None
    waybill: str | None
    abroad_note: str | None
    by: str
    at: datetime


class SameWaybillResponse(BaseModel):
    id: uuid.UUID
    status: str


class OrderResponse(BaseModel):
    id: uuid.UUID
    store_id: uuid.UUID
    status: Literal[
        "READY_TO_DISPATCH", "DISPATCHED", "ARRIVED", "COLLECTED", "CANCELLED", "RETURNED"
    ]
    sale_id: uuid.UUID | None
    currency_code: str
    total: str
    items: list[OrderItemResponse]
    # Legacy permanent command snapshots remain replayable unchanged.
    created_at: datetime | None = None
    credit: OrderCreditResponse | None = None
    # Not stated on an order made before orders said where they go.
    destination: DestinationValue | None = None
    carrier: CarrierValue | None = None
    waybill: str | None = None
    abroad_note: str | None = None
    # One order only: its history, and the store's other orders carrying the
    # same waybill, which is saved anyway.
    shipping_history: list[ShippingChangeResponse] = []
    same_waybill: list[SameWaybillResponse] = []


class OrderListResponse(BaseModel):
    orders: list[OrderResponse]
    has_more: bool


@router.get("/orders", response_model=OrderListResponse)
async def list_page(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    waybill: Annotated[CleanText | None, Query(max_length=64)] = None,
) -> dict[str, Any]:
    return await list_orders(
        session, scope=scope, store_id=store_id, limit=limit, offset=offset, waybill=waybill
    )


@router.post("/orders", status_code=201, response_model=OrderResponse)
async def create(
    payload: CreateOrderRequest, scope: ScopeDep, session: SessionDep
) -> dict[str, Any]:
    body = await create_order(
        session,
        scope=scope,
        store_id=payload.store_id,
        command_id=payload.command_id,
        lines=[OrderLineInput(**line.model_dump()) for line in payload.lines],
        destination=Destination(payload.destination),
        carrier=Carrier(payload.carrier) if payload.carrier else None,
    )
    await session.commit()
    return body


@router.get("/orders/{order_id}", response_model=OrderResponse)
async def read(order_id: uuid.UUID, scope: ScopeDep, session: SessionDep) -> dict[str, Any]:
    return await read_order(session, scope=scope, order_id=order_id)


@router.post("/orders/{order_id}/return", response_model=OrderResponse)
async def return_goods(
    order_id: uuid.UUID, payload: ReturnOrderRequest, scope: ScopeDep, session: SessionDep
) -> dict[str, Any]:
    body = await transition_order(
        session,
        scope=scope,
        order_id=order_id,
        command_id=payload.command_id,
        action="return",
        reason=payload.reason,
    )
    await session.commit()
    return body


@router.post("/orders/{order_id}/collect", response_model=OrderResponse)
async def collect(
    order_id: uuid.UUID, payload: CollectOrderRequest, scope: ScopeDep, session: SessionDep
) -> dict[str, Any]:
    """The customer has the goods: the sale is recognised now, and may be paid
    in parts."""
    body = await transition_order(
        session,
        scope=scope,
        order_id=order_id,
        command_id=payload.command_id,
        action="collect",
        credit=(
            credit_service.terms(
                customer_name=payload.credit.customer_name,
                customer_phone=payload.credit.customer_phone,
                paid_now=payload.credit.paid_now,
            )
            if payload.credit is not None
            else None
        ),
    )
    await session.commit()
    return body


@router.post("/orders/{order_id}/dispatch", response_model=OrderResponse)
async def dispatch(
    order_id: uuid.UUID, payload: DispatchOrderRequest, scope: ScopeDep, session: SessionDep
) -> dict[str, Any]:
    """Sent: the goods leave, and the waybill may be written now."""
    body = await transition_order(
        session,
        scope=scope,
        order_id=order_id,
        command_id=payload.command_id,
        action="dispatch",
        waybill=payload.waybill,
        abroad_note=payload.abroad_note,
    )
    await session.commit()
    return body


@router.post("/orders/{order_id}/shipping", response_model=OrderResponse)
async def shipping(
    order_id: uuid.UUID, payload: ShippingRequest, scope: ScopeDep, session: SessionDep
) -> dict[str, Any]:
    """Where an open order goes, corrected or written later."""
    body = await change_shipping(
        session,
        scope=scope,
        order_id=order_id,
        command_id=payload.command_id,
        destination=Destination(payload.destination),
        carrier=Carrier(payload.carrier) if payload.carrier else None,
        waybill=payload.waybill,
        abroad_note=payload.abroad_note,
    )
    await session.commit()
    return body


@router.post("/orders/{order_id}/{action}", response_model=OrderResponse)
async def transition(
    order_id: uuid.UUID,
    action: Literal["arrive", "cancel"],
    payload: OrderActionRequest,
    scope: ScopeDep,
    session: SessionDep,
) -> dict[str, Any]:
    body = await transition_order(
        session, scope=scope, order_id=order_id, command_id=payload.command_id, action=action
    )
    await session.commit()
    return body
