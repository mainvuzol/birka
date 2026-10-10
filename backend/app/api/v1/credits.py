"""A store's debts: sales paid in parts (owner decisions, 2026-10-01).

A debt opens with its sale (`credit` on `POST /sales`, or on collecting an
order). Here it is found by the customer's name or phone, paid in parts in
the store that sold, and written off by the owner with a reason. One phone
is one customer, and the store sees what it is owed in all. Returns lower it through
`POST /sales/{id}/refunds`, which says how much goes back in cash.

While the store that sold is blocked or archived, any store of the network
that trades finds its debts by a search (`elsewhere=true`) and takes their
payments (`store_id`); the debt stays the selling store's, and the network's
owner may still write it off (owner decisions, 2026-10-01). It is found by
the customer's whole phone, and only while it is owed (owner decisions,
2026-10-10).

A closed debt's customer is erased a year after it was paid or returned,
three after it was written off, or at once by the owner when the customer
asks (`POST /credits/{id}/erase-customer`): the network's owner in the whole
network, a store's owner in that store. The debt then reads with no name and
no phone, and every sum stays (owner decisions, 2026-10-09; ADR-0015).

Payments and write-offs are named by a client `command_id`, as a sale is:
the same command is answered with what it did, however late it is retried.

A payment says how it was paid: «Готівка», «Картка» or «Переказ» (owner
decisions, 2026-10-04). Optional in the request, so a payment a phone kept
from before the way was asked still replays; the service requires it of a
new one (ADR-0012, B13). The history shows each payment's way, and each
return's, as they stand after corrections (ADR-0012, B10).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ScopeDep, SessionDep
from app.api.v1.sales import (
    PaperMarkPayload,
    PaperMarkResponse,
    TillMethodValue,
    method_of,
    paper_response,
)
from app.core.correlation import get_correlation_id
from app.core.text import CleanText
from app.modules.cash.current import CurrentMethod, entry_methods, refund_methods
from app.modules.credit import erasure, service
from app.modules.credit.models import CreditStatus, EntryKind
from app.modules.tenancy.models import StoreState

router = APIRouter(prefix="/credits", tags=["credits"])


class EntryResponse(BaseModel):
    kind: EntryKind
    amount: Decimal
    cash_back: Decimal
    at: datetime
    by: str
    note: str | None
    # The store that took this payment, when the one that sold did not trade.
    taken_at: str | None
    # A payment: how it was paid. A return: how its money went back, None
    # when it only lowered the debt. Both as they stand after corrections;
    # None too for one recorded before the way was asked («не вказано»).
    payment_method: str | None = None
    corrected: bool = False
    # A payment typed from paper (ADR-0021): who took it and when, as the
    # paper says; `by` is who typed it. None for every other entry.
    outage: PaperMarkResponse | None = None


class CreditResponse(BaseModel):
    id: uuid.UUID
    sale_id: uuid.UUID
    store_id: uuid.UUID
    # The store that sold, and whether it trades.
    store_name: str
    store_state: StoreState
    # None once the customer is erased, from `customer_erased_at` on.
    customer_name: str | None
    customer_phone: str | None
    customer_erased_at: datetime | None
    # What was agreed: the sale's total.
    amount: Decimal
    currency_code: str
    status: CreditStatus
    paid: Decimal
    # The worth of goods brought back, of which `cash_back` went back in cash.
    returned: Decimal
    cash_back: Decimal
    written_off: Decimal
    owed: Decimal
    opened_at: datetime
    last_payment_at: datetime | None
    closed_at: datetime | None
    goods: list[str]
    entries: list[EntryResponse]


class CreditPage(BaseModel):
    items: list[CreditResponse]
    has_more: bool


class CustomerResponse(BaseModel):
    """One customer's debts in the store: one phone, one customer. A debt
    whose customer is erased stands alone, with no phone and no name."""

    phone_digits: str | None
    # As the newest of these debts wrote them.
    customer_name: str | None
    customer_phone: str | None
    owed: Decimal
    open_debts: int
    credits: list[CreditResponse]


class CustomerPage(BaseModel):
    items: list[CustomerResponse]
    has_more: bool


class ErasureResponse(BaseModel):
    """What the owner's erasure did."""

    # Closed debts whose customer was erased now.
    erased: int
    # The customer's open debts within the same reach, which keep them.
    still_open: int
    # The whole network (the network's owner), or the debt's store alone.
    network: bool
    credit: CreditResponse


class StoreDebtsResponse(BaseModel):
    """What the store is owed now, across its open debts."""

    owed: Decimal
    customers: int
    debts: int


class PaymentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    # The store taking the payment, when it is not the one that sold: only
    # while that one does not trade.
    store_id: uuid.UUID | None = None
    # One of the till's three ways. Absent only from a payment a phone kept
    # from before it was asked.
    payment_method: TillMethodValue | None = None
    # «Під час збою»: typed from paper after the server did not answer
    # (owner decision, 2026-10-10; ADR-0021).
    outage: PaperMarkPayload | None = None


class WriteOffRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    reason: CleanText = Field(min_length=1, max_length=1000)


async def _ways(
    session: AsyncSession, views: list[service.CreditView]
) -> dict[uuid.UUID, CurrentMethod]:
    """Each entry's way, by entry id: a payment's own, a return's refund's.
    Read here because the debts' module reads neither the corrections nor
    the refunds (ADR-0012, B10, B15)."""
    entries = [entry for view in views for entry in view.entries]
    payments = await entry_methods(
        session, [entry.id for entry in entries if entry.kind is EntryKind.PAYMENT]
    )
    refunds = await refund_methods(
        session, [entry.refund_id for entry in entries if entry.refund_id is not None]
    )
    ways = dict(payments)
    for entry in entries:
        if entry.refund_id is not None and entry.refund_id in refunds:
            ways[entry.id] = refunds[entry.refund_id]
    return ways


async def _responses(
    session: AsyncSession, views: list[service.CreditView]
) -> list[CreditResponse]:
    ways = await _ways(session, views)
    return [_response(view, ways) for view in views]


def _response(view: service.CreditView, ways: dict[uuid.UUID, CurrentMethod]) -> CreditResponse:
    return CreditResponse(
        id=view.id,
        sale_id=view.sale_id,
        store_id=view.store_id,
        store_name=view.store_name,
        store_state=view.store_state,
        customer_name=view.customer_name,
        customer_phone=view.customer_phone,
        customer_erased_at=view.customer_erased_at,
        amount=view.amount,
        currency_code=view.currency_code,
        status=view.status,
        paid=view.paid,
        returned=view.returned,
        cash_back=view.cash_back,
        written_off=view.written_off,
        owed=view.owed,
        opened_at=view.opened_at,
        last_payment_at=view.last_payment_at,
        closed_at=view.closed_at,
        goods=view.goods,
        entries=[
            EntryResponse(
                kind=entry.kind,
                amount=entry.amount,
                cash_back=entry.cash_back,
                at=entry.at,
                by=entry.by,
                note=entry.note,
                taken_at=entry.taken_at,
                payment_method=(
                    way.value
                    if entry.id in ways and (way := ways[entry.id].method) is not None
                    else None
                ),
                corrected=entry.id in ways and ways[entry.id].corrected,
                outage=paper_response(entry.outage),
            )
            for entry in view.entries
        ],
    )


@router.get("", response_model=CreditPage)
async def list_debts(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    status: CreditStatus | None = None,
    query: Annotated[CleanText, Query(max_length=200)] = "",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> CreditPage:
    """The store's debts, newest first; `status=OPEN` for those still owed."""
    views, has_more = await service.list_credits(
        session,
        scope=scope,
        store_id=store_id,
        status=status,
        query=query,
        limit=limit,
        offset=offset,
    )
    return CreditPage(items=await _responses(session, views), has_more=has_more)


# Before `/{credit_id}`, which would otherwise take these names for an id.
@router.get("/customers", response_model=CustomerPage)
async def list_customers(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    status: CreditStatus | None = None,
    query: Annotated[CleanText, Query(max_length=200)] = "",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
    elsewhere: bool = False,
) -> CustomerPage:
    """The store's debts by customer: one phone is one customer (owner
    decision, 2026-10-01). `status=OPEN` for those still owing.

    `elsewhere=true` searches the debts of the stores that do not trade, whose
    payments this store takes: `query` is the customer's whole phone, and only
    debts still owed are answered (owner decisions, 2026-10-10)."""
    customers, has_more = await service.list_customers(
        session,
        scope=scope,
        store_id=store_id,
        status=status,
        query=query,
        limit=limit,
        offset=offset,
        elsewhere=elsewhere,
    )
    ways = await _ways(session, [view for customer in customers for view in customer.credits])
    return CustomerPage(
        items=[
            CustomerResponse(
                phone_digits=customer.phone_digits,
                customer_name=customer.customer_name,
                customer_phone=customer.customer_phone,
                owed=customer.owed,
                open_debts=customer.open_debts,
                credits=[_response(view, ways) for view in customer.credits],
            )
            for customer in customers
        ],
        has_more=has_more,
    )


@router.get("/summary", response_model=StoreDebtsResponse)
async def summary(store_id: uuid.UUID, scope: ScopeDep, session: SessionDep) -> StoreDebtsResponse:
    """What the store is owed now, by store only (owner decision, 2026-10-01)."""
    debts = await service.store_debts(session, scope=scope, store_id=store_id)
    return StoreDebtsResponse(owed=debts.owed, customers=debts.customers, debts=debts.debts)


@router.get("/{credit_id}", response_model=CreditResponse)
async def read_debt(
    credit_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    store_id: uuid.UUID | None = None,
) -> CreditResponse:
    """One debt. `store_id` is the store reading it, when it is not the one
    that sold: only while that one does not trade."""
    view = await service.read_credit(
        session, scope=scope, credit_id=credit_id, at_store_id=store_id
    )
    return (await _responses(session, [view]))[0]


@router.post(
    "/{credit_id}/payments", response_model=CreditResponse, status_code=status.HTTP_201_CREATED
)
async def pay(
    credit_id: uuid.UUID, payload: PaymentRequest, scope: ScopeDep, session: SessionDep
) -> CreditResponse:
    view = await service.pay(
        session,
        scope=scope,
        credit_id=credit_id,
        command_id=payload.command_id,
        amount=payload.amount,
        at_store_id=payload.store_id,
        correlation_id=get_correlation_id(),
        payment_method=method_of(payload.payment_method),
        outage=payload.outage.mark() if payload.outage is not None else None,
    )
    body = (await _responses(session, [view]))[0]
    await session.commit()
    return body


@router.post("/{credit_id}/write-off", response_model=CreditResponse)
async def write_off(
    credit_id: uuid.UUID, payload: WriteOffRequest, scope: ScopeDep, session: SessionDep
) -> CreditResponse:
    view = await service.write_off(
        session,
        scope=scope,
        credit_id=credit_id,
        command_id=payload.command_id,
        reason=payload.reason,
        correlation_id=get_correlation_id(),
    )
    body = (await _responses(session, [view]))[0]
    await session.commit()
    return body


@router.post("/{credit_id}/erase-customer", response_model=ErasureResponse)
async def erase_customer(
    credit_id: uuid.UUID, scope: ScopeDep, session: SessionDep
) -> ErasureResponse:
    """The owner erases a closed debt's customer at their request, from every
    closed debt under the same phone: the network's owner in the whole
    network, a store's owner in the debt's store (owner decisions,
    2026-10-09). An open debt is refused. Asked again, nothing more is
    erased."""
    done = await erasure.erase_customer(session, scope=scope, credit_id=credit_id)
    body = ErasureResponse(
        erased=done.erased,
        still_open=done.still_open,
        network=done.network,
        credit=(await _responses(session, [done.credit]))[0],
    )
    await session.commit()
    return body


__all__ = ["router"]
