"""Customer orders: permanent command ids are the retry contract."""

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
from app.modules.orders.service import (
    OrderLineInput,
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


class CreateOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    store_id: uuid.UUID
    command_id: uuid.UUID
    lines: list[OrderLinePayload] = Field(min_length=1, max_length=100)


class OrderActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: uuid.UUID


class CollectOrderRequest(OrderActionRequest):
    # Present only when the customer pays in parts: as at the till, above
    # nothing now and the rest owed to the order's store (owner decision,
    # 2026-10-01).
    credit: CreditPayload | None = None


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
) -> dict[str, Any]:
    return await list_orders(session, scope=scope, store_id=store_id, limit=limit, offset=offset)


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


@router.post("/orders/{order_id}/{action}", response_model=OrderResponse)
async def transition(
    order_id: uuid.UUID,
    action: Literal["dispatch", "arrive", "cancel"],
    payload: OrderActionRequest,
    scope: ScopeDep,
    session: SessionDep,
) -> dict[str, Any]:
    body = await transition_order(
        session, scope=scope, order_id=order_id, command_id=payload.command_id, action=action
    )
    await session.commit()
    return body
