"""Customer orders: permanent command ids are the retry contract."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep
from app.core.text import CleanText
from app.modules.orders.service import OrderLineInput, create_order, read_order, transition_order

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


class ReturnOrderRequest(OrderActionRequest):
    reason: CleanText = Field(min_length=1, max_length=1000)
    physically_received: Literal[True]


@router.post("/orders", status_code=201)
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


@router.get("/orders/{order_id}")
async def read(order_id: uuid.UUID, scope: ScopeDep, session: SessionDep) -> dict[str, Any]:
    return await read_order(session, scope=scope, order_id=order_id)


@router.post("/orders/{order_id}/return")
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


@router.post("/orders/{order_id}/{action}")
async def transition(
    order_id: uuid.UUID,
    action: Literal["dispatch", "arrive", "collect", "cancel"],
    payload: OrderActionRequest,
    scope: ScopeDep,
    session: SessionDep,
) -> dict[str, Any]:
    body = await transition_order(
        session, scope=scope, order_id=order_id, command_id=payload.command_id, action=action
    )
    await session.commit()
    return body
