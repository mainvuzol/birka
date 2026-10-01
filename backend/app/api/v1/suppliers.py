"""Suppliers, and goods returned to them (owner decisions, 2026-10-01).

- `GET /suppliers`, `POST /suppliers`, `PUT /suppliers/{id}`: the
  network's list, kept by whoever returns goods. A name already on it is
  refused as `DUPLICATE`, with that supplier to pick instead.
- `POST /supplier-returns`: goods from one warehouse back to a supplier,
  named by a client `command_id` as a sale is.
- `POST /supplier-returns/{id}/cancel`: the whole return cancelled, saying
  why. A unit from «Брак» is cancelled from there
  (`/damaged-units/{id}/cancel-supplier-return`).
- `GET /supplier-returns`: this store's returns, newest first, each with
  what the supplier counts of it against the store's invoices now.
- `GET /borrowed`: goods this store borrowed from a supplier, or took under
  consignment, with how much was sold, returned or is still on hand (owner
  decisions, 2026-10-01). A return naming `stock_lot_id` sends some back
  unsold; `POST /supplier-invoices/sold` marks some sold.

All of it needs `supplier:return` in the store: the owner's and managers'.
The list of suppliers is also kept by whoever records what the store owes
them (`supplier:debt`, `supplier_invoices.py`).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep
from app.core.correlation import get_correlation_id
from app.core.text import CleanText
from app.modules.inventory.models import AcquisitionType
from app.modules.suppliers import borrowed, service

router = APIRouter(tags=["suppliers"])


class SupplierResponse(BaseModel):
    id: uuid.UUID
    name: str
    phone: str | None


class SupplierRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The store the person works in, whose `supplier:return` decides.
    store_id: uuid.UUID
    name: CleanText = Field(min_length=1, max_length=200)
    phone: CleanText | None = Field(default=None, max_length=40)


class LineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int = Field(gt=0, le=10_000)


class ReturnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    store_id: uuid.UUID
    location_id: uuid.UUID
    supplier_id: uuid.UUID
    lines: list[LineRequest] = Field(min_length=1, max_length=100)
    note: CleanText | None = Field(default=None, max_length=1000)
    # Borrowed goods going back unsold: their lot, its model and size alone.
    stock_lot_id: uuid.UUID | None = None


class CancelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: CleanText = Field(min_length=1, max_length=1000)


class LineResponse(BaseModel):
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int
    display_name: str
    size: str | None


class CancellationResponse(BaseModel):
    reason: str
    by: str
    at: datetime


class SetOffResponse(BaseModel):
    invoice_id: uuid.UUID
    entry_id: uuid.UUID
    amount: Decimal
    at: datetime


class ReturnResponse(BaseModel):
    id: uuid.UUID
    store_id: uuid.UUID
    location_id: uuid.UUID
    location_name: str
    supplier: SupplierResponse
    # A unit from «Брак»: its return is cancelled from there.
    damaged_unit_id: uuid.UUID | None
    note: str | None
    by: str
    at: datetime
    lines: list[LineResponse]
    cancelled: CancellationResponse | None
    # What the supplier counts of it against invoices now. While any stands,
    # the return is not cancelled.
    set_offs: list[SetOffResponse]
    # Borrowed goods going back unsold: the lot they arrived as.
    stock_lot_id: uuid.UUID | None = None


class ReturnPage(BaseModel):
    items: list[ReturnResponse]
    has_more: bool


class BorrowedResponse(BaseModel):
    stock_lot_id: uuid.UUID
    acquisition_type: Literal["BORROWED", "CONSIGNMENT"]
    supplier: SupplierResponse
    location_id: uuid.UUID
    location_name: str
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    display_name: str
    size: str | None
    # The price agreed for each, owed once sold.
    unit_cost: Decimal | None
    currency_code: str | None
    received: int
    sold: int
    returned: int
    on_hand: int
    at: datetime


class BorrowedPage(BaseModel):
    items: list[BorrowedResponse]
    has_more: bool


def _supplier(view: service.SupplierView) -> SupplierResponse:
    return SupplierResponse(id=view.id, name=view.name, phone=view.phone)


def _return(view: service.ReturnView) -> ReturnResponse:
    return ReturnResponse(
        id=view.id,
        store_id=view.store_id,
        location_id=view.location_id,
        location_name=view.location_name,
        supplier=_supplier(view.supplier),
        damaged_unit_id=view.damaged_unit_id,
        note=view.note,
        by=view.by,
        at=view.at,
        lines=[
            LineResponse(
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity=line.quantity,
                display_name=line.display_name,
                size=line.size_label,
            )
            for line in view.lines
        ],
        cancelled=None
        if view.cancelled is None
        else CancellationResponse(
            reason=view.cancelled.reason, by=view.cancelled.by, at=view.cancelled.at
        ),
        set_offs=[
            SetOffResponse(
                invoice_id=item.invoice_id, entry_id=item.entry_id, amount=item.amount, at=item.at
            )
            for item in view.set_offs
        ],
        stock_lot_id=view.stock_lot_id,
    )


@router.get("/suppliers", response_model=list[SupplierResponse])
async def list_suppliers(
    store_id: uuid.UUID, scope: ScopeDep, session: SessionDep
) -> list[SupplierResponse]:
    return [
        _supplier(view)
        for view in await service.list_suppliers(session, scope=scope, store_id=store_id)
    ]


@router.post("/suppliers", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED)
async def add_supplier(
    payload: SupplierRequest, scope: ScopeDep, session: SessionDep
) -> SupplierResponse:
    view = await service.add_supplier(
        session, scope=scope, store_id=payload.store_id, name=payload.name, phone=payload.phone
    )
    await session.commit()
    return _supplier(view)


@router.put("/suppliers/{supplier_id}", response_model=SupplierResponse)
async def edit_supplier(
    supplier_id: uuid.UUID, payload: SupplierRequest, scope: ScopeDep, session: SessionDep
) -> SupplierResponse:
    view = await service.edit_supplier(
        session,
        scope=scope,
        store_id=payload.store_id,
        supplier_id=supplier_id,
        name=payload.name,
        phone=payload.phone,
    )
    await session.commit()
    return _supplier(view)


@router.get("/supplier-returns", response_model=ReturnPage)
async def list_returns(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    supplier_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> ReturnPage:
    views, has_more = await service.list_returns(
        session,
        scope=scope,
        store_id=store_id,
        supplier_id=supplier_id,
        limit=limit,
        offset=offset,
    )
    return ReturnPage(items=[_return(view) for view in views], has_more=has_more)


@router.post(
    "/supplier-returns", response_model=ReturnResponse, status_code=status.HTTP_201_CREATED
)
async def return_goods(
    payload: ReturnRequest, scope: ScopeDep, session: SessionDep
) -> ReturnResponse:
    view = await service.return_goods(
        session,
        scope=scope,
        command_id=payload.command_id,
        store_id=payload.store_id,
        location_id=payload.location_id,
        supplier_id=payload.supplier_id,
        lines=[
            service.ReturnLine(
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity=line.quantity,
            )
            for line in payload.lines
        ],
        note=payload.note,
        correlation_id=get_correlation_id(),
        stock_lot_id=payload.stock_lot_id,
    )
    await session.commit()
    return _return(view)


@router.post("/supplier-returns/{supplier_return_id}/cancel", response_model=ReturnResponse)
async def cancel_return(
    supplier_return_id: uuid.UUID, payload: CancelRequest, scope: ScopeDep, session: SessionDep
) -> ReturnResponse:
    view = await service.cancel_return(
        session,
        scope=scope,
        supplier_return_id=supplier_return_id,
        reason=payload.reason,
        correlation_id=get_correlation_id(),
    )
    await session.commit()
    return _return(view)


@router.get("/borrowed", response_model=BorrowedPage)
async def list_borrowed(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    supplier_id: uuid.UUID | None = None,
    on_hand: bool = True,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> BorrowedPage:
    """What this store borrowed, newest first; `on_hand=false` for all of
    it, sold and returned too."""
    views, has_more = await borrowed.list_borrowed(
        session,
        scope=scope,
        store_id=store_id,
        supplier_id=supplier_id,
        on_hand_only=on_hand,
        limit=limit,
        offset=offset,
    )
    return BorrowedPage(
        items=[
            BorrowedResponse(
                stock_lot_id=view.stock_lot_id,
                acquisition_type="BORROWED"
                if view.acquisition_type is AcquisitionType.BORROWED
                else "CONSIGNMENT",
                supplier=_supplier(view.supplier),
                location_id=view.location_id,
                location_name=view.location_name,
                product_variant_id=view.product_variant_id,
                size_id=view.size_id,
                display_name=view.display_name,
                size=view.size_label,
                unit_cost=view.unit_cost,
                currency_code=view.currency_code,
                received=view.received,
                sold=view.sold,
                returned=view.returned,
                on_hand=view.on_hand,
                at=view.at,
            )
            for view in views
        ],
        has_more=has_more,
    )


__all__ = ["router"]
