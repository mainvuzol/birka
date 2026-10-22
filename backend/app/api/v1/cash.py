"""The drawer: the day's close, cash taken out and put in, and corrections of
a way of paying (owner decisions, 2026-10-04; ADR-0012, B10).

One drawer per store, closed once a day by the seller on duty, who counts
the cash without seeing what it should hold (`GET /cash/drawer` never says),
then sees the difference and writes its reason as a second command. Cash
taken out or put in is recorded with who and why. A closed day is never
reopened: a wrong way of paying is corrected by a new row, on the day it is
made, and explains that day's difference.

Commands are named by the phone's permanent `command_id`, as a payment
toward a debt is, and keep no Idempotency-Key cache: the same command is
answered with what it did, however late it is retried. Every refusal decided
after that lookup says `recorded: false` (`cash.service.refuse`). `age` on a
close is outside its print, so a resend stays byte for byte the same.

Who reads what is decided in `cash.read`: a seller sees only the result of
their own close, and nothing before their count says what the drawer should hold.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Query, status
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep
from app.core.correlation import get_correlation_id
from app.core.text import CleanText
from app.modules.cash import read, service
from app.modules.cash.models import MovementKind
from app.modules.cash.service import Target
from app.modules.sales.payment import PaymentMethod
from app.modules.tenancy.models import StoreState

router = APIRouter(prefix="/cash", tags=["cash"])

MethodValue = Literal["CASH", "CARD", "TRANSFER", "PREPAID_TRANSFER", "CARRIER_COD"]
TargetValue = Literal["SALE", "PAYMENT", "REFUND"]


# --- requests ------------------------------------------------------------------


class CloseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    store_id: uuid.UUID
    command_id: uuid.UUID
    counted: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    # The phone's clock at «Так, закрити»: in the print, shown nowhere.
    counted_at: AwareDatetime
    # The newest close the count screen showed; null when there was none.
    after_close_id: uuid.UUID | None


class ReasonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    reason: CleanText = Field(min_length=1, max_length=1000)


class MovementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    store_id: uuid.UUID
    command_id: uuid.UUID
    kind: Literal["OWNER", "EXPENSES", "SUPPLIER_COURIER", "CHANGE"]
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    note: CleanText | None = Field(default=None, max_length=200)
    # The newest close the screen showed (B5).
    after_close_id: uuid.UUID | None
    # Cash taken out and forgotten, named by the owner or a manager.
    for_close_id: uuid.UUID | None = None


class CorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    target: TargetValue
    target_id: uuid.UUID
    # The way the screen showed; null for «не вказано».
    from_method: MethodValue | None
    to_method: MethodValue
    note: CleanText | None = Field(default=None, max_length=200)


# --- answers -------------------------------------------------------------------


class WaySums(BaseModel):
    came_in: Decimal
    went_out: Decimal
    corrected: Decimal
    net: Decimal


class Explanation(BaseModel):
    kind: Literal["CORRECTION", "TAKE_OUT", "PUT_IN"]
    at: datetime
    by: str
    cash: Decimal
    text: str


class CloseBrief(BaseModel):
    id: uuid.UUID
    number: int
    business_day: date
    closed_at: datetime
    closed_by: str
    mine: bool


class CloseResponse(BaseModel):
    """A close. In the seller's view — no `report:view_financial` at the
    store — the fields from `opening_float` on are null or empty (G27)."""

    id: uuid.UUID
    store_id: uuid.UUID
    store_name: str
    number: int
    business_day: date
    closed_at: datetime
    closed_by: str
    mine: bool
    # A first count, or the first after the archive: no expected sum and no
    # difference (G6, G30).
    opening: bool
    since: datetime | None
    counted: Decimal
    expected: Decimal | None
    difference: Decimal | None
    # For the terminal's slip (owner, answer 11).
    card: WaySums
    transfer: WaySums
    unclosed_days: list[date]
    reason: str | None
    reason_by: str | None
    # 1,00 грн or more either way (G41).
    reason_required: bool
    opening_float: Decimal | None
    cash_in: Decimal | None
    cash_out: Decimal | None
    taken_out: Decimal | None
    put_in: Decimal | None
    cash_corrected: Decimal | None
    prepaid_transfer: Decimal | None
    carrier_cod: Decimal | None
    not_stated: WaySums | None
    explained: Decimal | None
    unexplained: Decimal | None
    explanations: list[Explanation]


class ClosePage(BaseModel):
    items: list[CloseResponse]
    has_more: bool


class MovementResponse(BaseModel):
    id: uuid.UUID
    store_id: uuid.UUID
    kind: MovementKind
    direction: Literal["OUT", "IN"]
    amount: Decimal
    note: str | None
    at: datetime
    by: str
    for_close_id: uuid.UUID | None
    for_day: date | None
    # Put on that close because the phone saw an older one (B5), not by a
    # person.
    moved_to_close: bool


class MovementPage(BaseModel):
    items: list[MovementResponse]


class DrawerResponse(BaseModel):
    """Never an expected sum, nor any sum of the period (B4.3)."""

    store_id: uuid.UUID
    store_name: str
    store_state: StoreState
    # None: no close yet, and the next is an opening count.
    last_close: CloseBrief | None
    next_is_opening: bool
    closed_today: bool
    may_close: bool
    movement_kinds: list[MovementKind]
    may_correct: bool
    # A seller's own of the open period; everyone's to whoever reads the money.
    movements: list[MovementResponse]
    unclosed_days: list[date]
    # The caller's own newest close whose difference still needs their reason.
    reason_owed: CloseBrief | None


class CorrectionResponse(BaseModel):
    id: uuid.UUID
    seq: int
    store_id: uuid.UUID
    target: TargetValue
    target_id: uuid.UUID
    amount: Decimal
    direction: Literal["IN", "OUT"]
    from_method: str | None
    to_method: str
    explains_close_id: uuid.UUID | None
    explains_day: date | None
    at: datetime
    by: str
    note: str | None


class EventResponse(BaseModel):
    target: TargetValue
    target_id: uuid.UUID
    at: datetime
    by: str
    amount: Decimal
    direction: Literal["IN", "OUT"]
    stated_method: str | None
    method: str | None
    corrected: bool
    closed: bool
    # The business day of the close it fell in, once closed.
    close_day: date | None
    # The goods, never a customer's name.
    label: str
    is_order: bool
    may_change: bool


class EventPage(BaseModel):
    items: list[EventResponse]


class MineEvent(BaseModel):
    """The seller's own operation of the open period: no sum, no way (G32)."""

    target: TargetValue
    target_id: uuid.UUID
    at: datetime
    label: str


class MinePage(BaseModel):
    items: list[MineEvent]


class SaleMethodResponse(BaseModel):
    sale_id: uuid.UUID
    target: TargetValue
    target_id: uuid.UUID
    amount_taken: Decimal
    method: str | None
    corrected: bool
    refund_method: str | None
    # Whether the caller may correct it now.
    may_change: bool
    # A collected order's money: the order ways may be chosen too (B6.1).
    is_order: bool


# --- the drawer and its closes ---------------------------------------------------------


@router.get("/drawer", response_model=DrawerResponse)
async def drawer(store_id: uuid.UUID, scope: ScopeDep, session: SessionDep) -> DrawerResponse:
    """The drawer's state for «Каса»: what the count screen shows before the
    count, and nothing of what the drawer should hold."""
    view = await read.drawer(session, scope=scope, store_id=store_id)
    return DrawerResponse.model_validate(asdict(view))


@router.post("/closes", response_model=CloseResponse, status_code=status.HTTP_201_CREATED)
async def close(
    payload: CloseRequest,
    scope: ScopeDep,
    session: SessionDep,
    # Seconds since the seller confirmed the count, by the phone's own clock
    # at each send; outside the print (B4 step 5). Any whole number: a phone
    # whose clock was set back since sends one below nothing, taken as none,
    # so a resend is never refused before its replay is looked up.
    age: Annotated[int, Query()] = 0,
) -> CloseResponse:
    row = await service.close_day(
        session,
        scope=scope,
        store_id=payload.store_id,
        command_id=payload.command_id,
        counted=payload.counted,
        counted_at=payload.counted_at,
        after_close_id=payload.after_close_id,
        age=max(age, 0),
        correlation_id=get_correlation_id(),
    )
    view = await read.close_view(session, scope=scope, close=row)
    await session.commit()
    return CloseResponse.model_validate(asdict(view))


@router.post("/closes/{close_id}/reason", response_model=CloseResponse)
async def give_reason(
    close_id: uuid.UUID, payload: ReasonRequest, scope: ScopeDep, session: SessionDep
) -> CloseResponse:
    """Why the count differs, by whoever counted, once (G12)."""
    row = await service.give_reason(
        session,
        scope=scope,
        close_id=close_id,
        command_id=payload.command_id,
        reason=payload.reason,
    )
    view = await read.close_view(session, scope=scope, close=row)
    await session.commit()
    return CloseResponse.model_validate(asdict(view))


@router.get("/closes", response_model=ClosePage)
async def list_closes(
    scope: ScopeDep,
    session: SessionDep,
    store_id: uuid.UUID | None = None,
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> ClosePage:
    """The closes of these business days, newest first: every store whose
    money this person reads, or the one asked for."""
    views, has_more = await read.list_closes(
        session,
        scope=scope,
        store_id=store_id,
        first=date_from,
        last=date_to,
        limit=limit,
        offset=offset,
    )
    return ClosePage(
        items=[CloseResponse.model_validate(asdict(view)) for view in views], has_more=has_more
    )


@router.get("/closes/{close_id}", response_model=CloseResponse)
async def read_close(close_id: uuid.UUID, scope: ScopeDep, session: SessionDep) -> CloseResponse:
    view = await read.read_close(session, scope=scope, close_id=close_id)
    return CloseResponse.model_validate(asdict(view))


# --- cash taken out and put in ------------------------------------------------------------


@router.post("/movements", response_model=MovementResponse, status_code=status.HTTP_201_CREATED)
async def record_movement(
    payload: MovementRequest, scope: ScopeDep, session: SessionDep
) -> MovementResponse:
    row = await service.record_movement(
        session,
        scope=scope,
        store_id=payload.store_id,
        command_id=payload.command_id,
        kind=MovementKind(payload.kind),
        amount=payload.amount,
        note=payload.note,
        after_close_id=payload.after_close_id,
        for_close_id=payload.for_close_id,
        correlation_id=get_correlation_id(),
    )
    view = await read.movement_view(session, row)
    await session.commit()
    return MovementResponse.model_validate(asdict(view))


@router.get("/movements", response_model=MovementPage)
async def list_movements(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
) -> MovementPage:
    views = await read.list_movements(
        session, scope=scope, store_id=store_id, first=date_from, last=date_to
    )
    return MovementPage(items=[MovementResponse.model_validate(asdict(view)) for view in views])


# --- corrections of a way of paying ---------------------------------------------------------


@router.post("/corrections", response_model=CorrectionResponse, status_code=status.HTTP_201_CREATED)
async def correct(
    payload: CorrectionRequest, scope: ScopeDep, session: SessionDep
) -> CorrectionResponse:
    target = Target(payload.target)
    row = await service.correct(
        session,
        scope=scope,
        command_id=payload.command_id,
        target=target,
        target_id=payload.target_id,
        from_method=PaymentMethod(payload.from_method) if payload.from_method else None,
        to_method=PaymentMethod(payload.to_method),
        note=payload.note,
        correlation_id=get_correlation_id(),
    )
    view = await read.correction_view(session, row, target=target, target_id=payload.target_id)
    await session.commit()
    return CorrectionResponse.model_validate(asdict(view))


@router.get("/events", response_model=EventPage | MinePage)
async def events(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    day: Annotated[date | None, Query()] = None,
    mine: bool = False,
) -> EventPage | MinePage:
    """`mine=true`: the caller's own sales, debt payments and returns of the
    open period, by time and goods only (G16, G32). Otherwise the drawer's
    money of one business day, with sums and ways, for whoever reads the
    money."""
    if mine:
        own = await read.my_events(session, scope=scope, store_id=store_id)
        return MinePage(items=[MineEvent.model_validate(asdict(event)) for event in own])
    views = await read.day_events(session, scope=scope, store_id=store_id, day=day)
    return EventPage(items=[EventResponse.model_validate(asdict(view)) for view in views])


@router.get("/sales/{sale_id}/method", response_model=SaleMethodResponse)
async def sale_method(
    sale_id: uuid.UUID, store_id: uuid.UUID, scope: ScopeDep, session: SessionDep
) -> SaleMethodResponse:
    """The money taken with one sale, for the screen that returns or fixes
    it (G32): its sum, its way now, and the way a return suggests."""
    view = await read.sale_method(session, scope=scope, sale_id=sale_id, store_id=store_id)
    return SaleMethodResponse.model_validate(asdict(view))


@router.get("/payments/{entry_id}/method", response_model=SaleMethodResponse)
async def payment_method(
    entry_id: uuid.UUID, scope: ScopeDep, session: SessionDep
) -> SaleMethodResponse:
    """One debt payment's money and its way now, for the seller who took it,
    to fix it before the close (G16)."""
    view = await read.operation_method(
        session, scope=scope, target=Target.PAYMENT, target_id=entry_id
    )
    return SaleMethodResponse.model_validate(asdict(view))


@router.get("/refunds/{refund_id}/method", response_model=SaleMethodResponse)
async def refund_method(
    refund_id: uuid.UUID, scope: ScopeDep, session: SessionDep
) -> SaleMethodResponse:
    """The money one return handed back and how, for the seller who took it,
    to fix it before the close (G16)."""
    view = await read.operation_method(
        session, scope=scope, target=Target.REFUND, target_id=refund_id
    )
    return SaleMethodResponse.model_validate(asdict(view))


__all__ = ["router"]
