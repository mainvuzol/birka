"""What a store owes its suppliers (owner decisions, 2026-10-01).

- `POST /supplier-invoices`: an invoice, recorded on its own — a supplier from
  the list, the sum on it, anything from nothing to all of it paid at once,
  a note.
- `POST /supplier-invoices/{id}/payments`: a payment, never more than is
  owed, in the store that owes while it trades; while it does not, any store
  of the network that trades pays (`store_id`).
- `POST /supplier-invoices/{id}/set-offs`: goods returned to that supplier
  from that store, counted against the invoice for the sum the supplier
  counted. A return may be counted against several invoices; while any of
  it stands, the return is not cancelled.
- `POST /supplier-invoices/{id}/write-off`: the owner writes off what is
  left, saying why. Final.
- `POST /supplier-invoices/{id}/entries/{entry_id}/cancel` and
  `POST /supplier-invoices/{id}/cancel`: a payment, a set-off or the invoice
  itself recorded by mistake, cancelled saying why — the invoice only once
  nothing on it stands.
- `GET /supplier-invoices`: the store's invoices, newest first;
  `elsewhere=true` lists those of the stores that do not trade instead.
- `GET /supplier-invoices/summary`: what the store owes, in all and by
  supplier.
- `POST /supplier-invoices/sold`: borrowed goods, or goods under
  consignment, sold — an invoice for their agreed price, never for more than
  is still on hand (owner decisions, 2026-10-01). Cancelling it puts them
  back on hand.

The owner's and managers' (`supplier:debt`); the write-off is the owner's
(`supplier:write_off`). The four commands that record money are named by a
client `command_id`, as a sale is: the same command is answered with the
invoice as it stands, however late it is retried.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep, SettingsDep
from app.api.v1.suppliers import CancellationResponse, CancelRequest, SupplierResponse
from app.core.correlation import get_correlation_id
from app.core.text import CleanText
from app.modules.suppliers import borrowed, invoices
from app.modules.suppliers.common import Cancellation, SupplierView
from app.modules.suppliers.models import InvoiceEntryKind, InvoiceStatus
from app.modules.tenancy.models import StoreState

router = APIRouter(prefix="/supplier-invoices", tags=["suppliers"])

Money = Annotated[Decimal, Field(max_digits=12, decimal_places=2)]


class EntryResponse(BaseModel):
    id: uuid.UUID
    kind: InvoiceEntryKind
    amount: Decimal
    at: datetime
    by: str
    # A write-off's reason.
    note: str | None
    # The store that made this payment, when the one that owes did not trade.
    paid_at: str | None
    # A set-off: the return the supplier counted.
    supplier_return_id: uuid.UUID | None
    cancelled: CancellationResponse | None


class SoldResponse(BaseModel):
    """Borrowed goods sold, which the invoice is for."""

    stock_lot_id: uuid.UUID
    quantity: int
    # What they were called when sold.
    label: str


class InvoiceResponse(BaseModel):
    id: uuid.UUID
    store_id: uuid.UUID
    # The store that owes, and whether it trades.
    store_name: str
    store_state: StoreState
    supplier: SupplierResponse
    # The sum on the invoice, never changed.
    amount: Decimal
    currency_code: str
    note: str | None
    status: InvoiceStatus
    paid: Decimal
    set_off: Decimal
    written_off: Decimal
    owed: Decimal
    by: str
    at: datetime
    last_payment_at: datetime | None
    closed_at: datetime | None
    cancelled: CancellationResponse | None
    entries: list[EntryResponse]
    sold: SoldResponse | None = None


class InvoicePage(BaseModel):
    items: list[InvoiceResponse]
    has_more: bool


class SupplierDebtResponse(BaseModel):
    supplier: SupplierResponse
    owed: Decimal
    invoices: int


class StoreDebtsResponse(BaseModel):
    """What the store owes its suppliers now, in all and by supplier."""

    owed: Decimal
    invoices: int
    suppliers: list[SupplierDebtResponse]


class InvoiceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    # The store that owes it.
    store_id: uuid.UUID
    supplier_id: uuid.UUID
    amount: Money = Field(gt=0)
    paid_now: Money = Field(default=Decimal("0"), ge=0)
    note: CleanText | None = Field(default=None, max_length=1000)


class PaymentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    amount: Money = Field(gt=0)
    # The store paying, when it is not the one that owes: only while that one
    # does not trade.
    store_id: uuid.UUID | None = None


class SetOffRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    supplier_return_id: uuid.UUID
    amount: Money = Field(gt=0)


class SoldRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    # The store that borrowed them.
    store_id: uuid.UUID
    stock_lot_id: uuid.UUID
    quantity: int = Field(gt=0, le=10_000)


class WriteOffRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    reason: CleanText = Field(min_length=1, max_length=1000)


class EntryCancelRequest(CancelRequest):
    # The store cancelling a payment it made, when it is not the one that
    # owes: only while that one does not trade.
    store_id: uuid.UUID | None = None


def _cancellation(value: Cancellation | None) -> CancellationResponse | None:
    return (
        None
        if value is None
        else CancellationResponse(reason=value.reason, by=value.by, at=value.at)
    )


def _supplier(view: SupplierView) -> SupplierResponse:
    return SupplierResponse(id=view.id, name=view.name, phone=view.phone)


def _response(view: invoices.InvoiceView) -> InvoiceResponse:
    return InvoiceResponse(
        id=view.id,
        store_id=view.store_id,
        store_name=view.store_name,
        store_state=view.store_state,
        supplier=_supplier(view.supplier),
        amount=view.amount,
        currency_code=view.currency_code,
        note=view.note,
        status=view.status,
        paid=view.paid,
        set_off=view.set_off,
        written_off=view.written_off,
        owed=view.owed,
        by=view.by,
        at=view.at,
        last_payment_at=view.last_payment_at,
        closed_at=view.closed_at,
        cancelled=_cancellation(view.cancelled),
        entries=[
            EntryResponse(
                id=entry.id,
                kind=entry.kind,
                amount=entry.amount,
                at=entry.at,
                by=entry.by,
                note=entry.note,
                paid_at=entry.paid_at,
                supplier_return_id=entry.supplier_return_id,
                cancelled=_cancellation(entry.cancelled),
            )
            for entry in view.entries
        ],
        sold=None
        if view.sold is None
        else SoldResponse(
            stock_lot_id=view.sold.stock_lot_id,
            quantity=view.sold.quantity,
            label=view.sold.label,
        ),
    )


@router.get("", response_model=InvoicePage)
async def list_invoices(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    supplier_id: uuid.UUID | None = None,
    status: InvoiceStatus | None = None,
    elsewhere: bool = False,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> InvoicePage:
    """The store's invoices, newest first; `status=OPEN` for those still
    owed. `elsewhere=true`: the stores' that do not trade, which this one
    pays."""
    views, has_more = await invoices.list_invoices(
        session,
        scope=scope,
        store_id=store_id,
        supplier_id=supplier_id,
        status=status,
        elsewhere=elsewhere,
        limit=limit,
        offset=offset,
    )
    return InvoicePage(items=[_response(view) for view in views], has_more=has_more)


# Before any `/{invoice_id}` route, which would otherwise take the name.
@router.get("/summary", response_model=StoreDebtsResponse)
async def summary(store_id: uuid.UUID, scope: ScopeDep, session: SessionDep) -> StoreDebtsResponse:
    """What the store owes its suppliers now, the largest debt first."""
    debts = await invoices.store_debts(session, scope=scope, store_id=store_id)
    return StoreDebtsResponse(
        owed=debts.owed,
        invoices=debts.invoices,
        suppliers=[
            SupplierDebtResponse(
                supplier=_supplier(debt.supplier), owed=debt.owed, invoices=debt.invoices
            )
            for debt in debts.suppliers
        ],
    )


@router.post("", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
async def record_invoice(
    payload: InvoiceRequest, scope: ScopeDep, session: SessionDep, settings: SettingsDep
) -> InvoiceResponse:
    view = await invoices.record_invoice(
        session,
        scope=scope,
        store_id=payload.store_id,
        command_id=payload.command_id,
        supplier_id=payload.supplier_id,
        amount=payload.amount,
        paid_now=payload.paid_now,
        note=payload.note,
        currency_code=settings.default_currency_code,
        correlation_id=get_correlation_id(),
    )
    await session.commit()
    return _response(view)


@router.post("/sold", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
async def mark_sold(
    payload: SoldRequest, scope: ScopeDep, session: SessionDep, settings: SettingsDep
) -> InvoiceResponse:
    view = await borrowed.mark_sold(
        session,
        scope=scope,
        store_id=payload.store_id,
        stock_lot_id=payload.stock_lot_id,
        quantity=payload.quantity,
        command_id=payload.command_id,
        currency_code=settings.default_currency_code,
        correlation_id=get_correlation_id(),
    )
    await session.commit()
    return _response(view)


@router.post(
    "/{invoice_id}/payments", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED
)
async def pay(
    invoice_id: uuid.UUID, payload: PaymentRequest, scope: ScopeDep, session: SessionDep
) -> InvoiceResponse:
    view = await invoices.pay(
        session,
        scope=scope,
        invoice_id=invoice_id,
        command_id=payload.command_id,
        amount=payload.amount,
        at_store_id=payload.store_id,
        correlation_id=get_correlation_id(),
    )
    await session.commit()
    return _response(view)


@router.post(
    "/{invoice_id}/set-offs", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED
)
async def set_off(
    invoice_id: uuid.UUID, payload: SetOffRequest, scope: ScopeDep, session: SessionDep
) -> InvoiceResponse:
    view = await invoices.set_off(
        session,
        scope=scope,
        invoice_id=invoice_id,
        command_id=payload.command_id,
        supplier_return_id=payload.supplier_return_id,
        amount=payload.amount,
        correlation_id=get_correlation_id(),
    )
    await session.commit()
    return _response(view)


@router.post("/{invoice_id}/write-off", response_model=InvoiceResponse)
async def write_off(
    invoice_id: uuid.UUID, payload: WriteOffRequest, scope: ScopeDep, session: SessionDep
) -> InvoiceResponse:
    view = await invoices.write_off(
        session,
        scope=scope,
        invoice_id=invoice_id,
        command_id=payload.command_id,
        reason=payload.reason,
        correlation_id=get_correlation_id(),
    )
    await session.commit()
    return _response(view)


@router.post("/{invoice_id}/entries/{entry_id}/cancel", response_model=InvoiceResponse)
async def cancel_entry(
    invoice_id: uuid.UUID,
    entry_id: uuid.UUID,
    payload: EntryCancelRequest,
    scope: ScopeDep,
    session: SessionDep,
) -> InvoiceResponse:
    view = await invoices.cancel_entry(
        session,
        scope=scope,
        invoice_id=invoice_id,
        entry_id=entry_id,
        reason=payload.reason,
        at_store_id=payload.store_id,
        correlation_id=get_correlation_id(),
    )
    await session.commit()
    return _response(view)


@router.post("/{invoice_id}/cancel", response_model=InvoiceResponse)
async def cancel_invoice(
    invoice_id: uuid.UUID, payload: CancelRequest, scope: ScopeDep, session: SessionDep
) -> InvoiceResponse:
    view = await invoices.cancel_invoice(
        session,
        scope=scope,
        invoice_id=invoice_id,
        reason=payload.reason,
        correlation_id=get_correlation_id(),
    )
    await session.commit()
    return _response(view)


__all__ = ["router"]
