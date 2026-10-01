"""A store's debts: sales paid in parts (owner decisions, 2026-10-01).

A debt opens with its sale (`credit` on `POST /sales`, or on collecting an
order). Here it is found by the customer's name or phone, paid in parts in
the store that sold, and written off by the owner with a reason. One phone
is one customer, and the store sees what it is owed in all. Returns lower it through
`POST /sales/{id}/refunds`, which says how much goes back in cash.

While the store that sold is blocked or archived, any store of the network
that trades finds its debts by a search (`elsewhere=true`) and takes their
payments (`store_id`); the debt stays the selling store's, and the network's
owner may still write it off (owner decisions, 2026-10-01).

Payments and write-offs are named by a client `command_id`, as a sale is:
the same command is answered with what it did, however late it is retried.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep
from app.core.correlation import get_correlation_id
from app.core.text import CleanText
from app.modules.credit import service
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


class CreditResponse(BaseModel):
    id: uuid.UUID
    sale_id: uuid.UUID
    store_id: uuid.UUID
    # The store that sold, and whether it trades.
    store_name: str
    store_state: StoreState
    customer_name: str
    customer_phone: str
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
    """One customer's debts in the store: one phone, one customer."""

    phone_digits: str
    # As the newest of these debts wrote them.
    customer_name: str
    customer_phone: str
    owed: Decimal
    open_debts: int
    credits: list[CreditResponse]


class CustomerPage(BaseModel):
    items: list[CustomerResponse]
    has_more: bool


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


class WriteOffRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    reason: CleanText = Field(min_length=1, max_length=1000)


def _response(view: service.CreditView) -> CreditResponse:
    return CreditResponse(
        id=view.id,
        sale_id=view.sale_id,
        store_id=view.store_id,
        store_name=view.store_name,
        store_state=view.store_state,
        customer_name=view.customer_name,
        customer_phone=view.customer_phone,
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
    return CreditPage(items=[_response(view) for view in views], has_more=has_more)


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
    payments this store takes; a `query` of two letters at least is needed."""
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
    return CustomerPage(
        items=[
            CustomerResponse(
                phone_digits=customer.phone_digits,
                customer_name=customer.customer_name,
                customer_phone=customer.customer_phone,
                owed=customer.owed,
                open_debts=customer.open_debts,
                credits=[_response(view) for view in customer.credits],
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
    return _response(
        await service.read_credit(session, scope=scope, credit_id=credit_id, at_store_id=store_id)
    )


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
    )
    await session.commit()
    return _response(view)


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
    await session.commit()
    return _response(view)


__all__ = ["router"]
