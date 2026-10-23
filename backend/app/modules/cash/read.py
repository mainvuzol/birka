"""What the drawer shows: its state, the closes, the day's money events and
what explains a close's difference (ADR-0012, B10).

The owner decided (business-rules.md, "cash and card, the day's close"):

- the seller counts blind: nothing they reach before the count says what
  the drawer should hold — no expected sum, no float, no period sum, and no
  list of their sales with their sums or ways (ADR-0012, G32). The drawer's
  state carries none of them, and their own operations of the open period are
  listed by time and goods only;
- a seller sees only the result of their own close; the split by way of paying
  and the closes are for whoever reads the money (`report:view_financial`),
  as the sales report is. Their view of a close leaves out the cash
  breakdown, the order ways and «не вказано» (G27);
- a day nobody closed goes into the next close and shows as not closed (G9).

Every figure of a close is a frozen column; what is read live beside it is
its reason and what later records explain of its difference (B6.3), and
those only ever grow.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, func, select, union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.errors import NotFoundError, PermissionDeniedError, ValidationFailedError
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.cash.current import entry_methods, refund_methods, sale_methods
from app.modules.cash.models import (
    CashClose,
    CashCloseReason,
    CashMovement,
    Direction,
    MovementKind,
    PaymentCorrection,
)
from app.modules.cash.service import (
    DAY_STARTS,
    EXPENSE_KINDS,
    NOT_STATED,
    SMALL_DIFFERENCE,
    MoneyRow,
    Target,
    business_day,
    cash_effect,
    current_way,
    explained_by,
    is_closed,
    last_close_number,
    may_close,
    may_correct,
    money,
    money_row,
    newest_close,
    reason_required,
    reopened_since,
    unexplained_of,
)
from app.modules.credit.models import CreditEntry, CustomerCredit, EntryKind
from app.modules.identity.models import AppUser
from app.modules.orders.models import CustomerOrder
from app.modules.refunds.models import Refund, RefundItem
from app.modules.sales.models import Sale, SaleItem, SaleStatus
from app.modules.tenancy.models import Store, StoreState
from app.modules.tenancy.service import store_state

# The longest period read at once: a year, leap day included, as the sales
# report (`reports.sales.MAX_DAYS`, which this module may not import).
MAX_DAYS = 366
DEFAULT_ZONE = "Europe/Kyiv"

# The words an explanation is told in, as the app labels them
# (`frontend/src/shared/payment.ts`, ADR-0012, B5).
METHOD_LABELS: dict[str | None, str] = {
    "CASH": "Готівка",
    "CARD": "Картка",
    "TRANSFER": "Переказ",
    "PREPAID_TRANSFER": "Переказ наперед",
    "CARRIER_COD": "Накладений платіж",
    None: "не вказано",
}
KIND_LABELS: dict[str, str] = {
    MovementKind.OWNER.value: "Власнику",
    MovementKind.EXPENSES.value: "Витрати",
    MovementKind.SUPPLIER_COURIER.value: "Кур’єру постачальника",
    # The kind, as «Витрати» is: «Каса» says it so on every screen (owner
    # decision, 2026-10-22).
    MovementKind.CHANGE.value: "Розмін",
}
# The kinds in the order the screen offers them.
KIND_ORDER: tuple[MovementKind, ...] = (
    MovementKind.OWNER,
    MovementKind.EXPENSES,
    MovementKind.SUPPLIER_COURIER,
    MovementKind.CHANGE,
)


@dataclass(frozen=True, slots=True)
class WaySums:
    came_in: Decimal
    went_out: Decimal
    corrected: Decimal
    net: Decimal


@dataclass(frozen=True, slots=True)
class Explanation:
    """A later record that explains part of a closed close's difference."""

    # CORRECTION, TAKE_OUT or PUT_IN.
    kind: str
    at: datetime
    by: str
    # What it explains of the difference: a correction's cash effect, cash
    # taken out (negative) or put in (positive).
    cash: Decimal
    text: str


@dataclass(frozen=True, slots=True)
class CloseBrief:
    id: uuid.UUID
    number: int
    business_day: date
    closed_at: datetime
    closed_by: str
    mine: bool


@dataclass(frozen=True, slots=True)
class CloseView:
    """A close as its reader may see it. In the seller's view — without
    `report:view_financial` at the store — the fields from `opening_float`
    on are None or empty (G27)."""

    id: uuid.UUID
    store_id: uuid.UUID
    store_name: str
    number: int
    business_day: date
    closed_at: datetime
    closed_by: str
    mine: bool
    opening: bool
    since: datetime | None
    counted: Decimal
    expected: Decimal | None
    difference: Decimal | None
    card: WaySums
    transfer: WaySums
    unclosed_days: list[date]
    reason: str | None
    reason_by: str | None
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


@dataclass(frozen=True, slots=True)
class MovementView:
    id: uuid.UUID
    store_id: uuid.UUID
    kind: str
    direction: str
    amount: Decimal
    note: str | None
    at: datetime
    by: str
    for_close_id: uuid.UUID | None
    for_day: date | None
    moved_to_close: bool


@dataclass(frozen=True, slots=True)
class CorrectionView:
    id: uuid.UUID
    seq: int
    store_id: uuid.UUID
    target: str
    target_id: uuid.UUID
    amount: Decimal
    direction: str
    from_method: str | None
    to_method: str
    explains_close_id: uuid.UUID | None
    explains_day: date | None
    at: datetime
    by: str
    note: str | None


@dataclass(frozen=True, slots=True)
class DrawerView:
    """The drawer as its count screen needs it. Never an expected sum, nor
    any sum of the period: the count is blind (B4.3)."""

    store_id: uuid.UUID
    store_name: str
    store_state: StoreState
    last_close: CloseBrief | None
    next_is_opening: bool
    closed_today: bool
    may_close: bool
    movement_kinds: list[str]
    may_correct: bool
    movements: list[MovementView]
    unclosed_days: list[date]
    reason_owed: CloseBrief | None


@dataclass(frozen=True, slots=True)
class EventView:
    """One money event of the drawer's day, for whoever reads the money."""

    target: str
    target_id: uuid.UUID
    at: datetime
    by: str
    amount: Decimal
    direction: str
    stated_method: str | None
    method: str | None
    corrected: bool
    closed: bool
    # The business day of the close it fell in, once closed: what a
    # correction of it explains (G7).
    close_day: date | None
    # The goods, never a customer's name.
    label: str
    is_order: bool
    may_change: bool


@dataclass(frozen=True, slots=True)
class MineEvent:
    """One of the seller's own operations of the open period: what it was and
    when, never its sum or its way (G16, G32)."""

    target: str
    target_id: uuid.UUID
    at: datetime
    label: str


@dataclass(frozen=True, slots=True)
class SaleMethodView:
    """The money of one operation, for the one screen that needs it: the sale
    being returned, or the operation being fixed (G32)."""

    sale_id: uuid.UUID
    target: str
    target_id: uuid.UUID
    amount_taken: Decimal
    method: str | None
    corrected: bool
    # The way a return suggests the money goes back (G4, G5).
    refund_method: str | None
    may_change: bool
    # The money taken with a collected order: it may be corrected to any of
    # the order ways too (B6.1).
    is_order: bool


# --- who sees what ---------------------------------------------------------------


def sees_money(scope: RequestScope, store_id: uuid.UUID) -> bool:
    """Whether this person reads the split by way of paying and the closes
    of this store: `report:view_financial` there, or across the network — a
    blocked store's close is answered to the network's owner in full."""
    return (
        scope.can(Permission.REPORT_VIEW_FINANCIAL, store_id)
        or Permission.REPORT_VIEW_FINANCIAL in scope.org_permissions
    )


async def _names(session: AsyncSession, user_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, str]:
    wanted = set(user_ids)
    if not wanted:
        return {}
    rows = await session.execute(
        select(AppUser.id, AppUser.display_name).where(AppUser.id.in_(wanted))
    )
    return {row.id: row.display_name for row in rows}


async def _store(session: AsyncSession, scope: RequestScope, store_id: uuid.UUID) -> Store:
    store = await session.scalar(
        select(Store).where(Store.id == store_id, Store.organization_id == scope.organization_id)
    )
    if store is None:
        raise NotFoundError("Unknown store", store_id=str(store_id))
    return store


# --- days not closed (G9) --------------------------------------------------------


def _day_of(column: Any, zone: str) -> ColumnElement[date]:
    """The business day of a moment, in SQL: the same 06:00 boundary as
    `cash.service.business_day`."""
    return func.date(func.timezone(zone, column) - DAY_STARTS)


async def _days_with_events(
    session: AsyncSession,
    *,
    store: Store,
    number: int,
    after: date,
    before: date,
) -> list[date]:
    """The business days strictly between `after` and `before` on which a
    money row or cash moved of period `number` at this drawer happened."""
    zone = store.timezone
    sales = select(_day_of(Sale.sold_at, zone).label("day")).where(
        Sale.store_id == store.id, Sale.drawer_period == number
    )
    payments = (
        select(_day_of(CreditEntry.created_at, zone).label("day"))
        .join(CustomerCredit, CustomerCredit.id == CreditEntry.credit_id)
        .where(
            CreditEntry.kind == EntryKind.PAYMENT.value,
            CreditEntry.drawer_period == number,
            func.coalesce(CreditEntry.taken_at_store_id, CustomerCredit.store_id) == store.id,
        )
    )
    refunds = select(_day_of(Refund.created_at, zone).label("day")).where(
        Refund.taken_at_store_id == store.id, Refund.drawer_period == number
    )
    moved = select(_day_of(CashMovement.created_at, zone).label("day")).where(
        CashMovement.store_id == store.id, CashMovement.drawer_period == number
    )
    days = union(sales, payments, refunds, moved).subquery()
    rows = await session.scalars(
        select(days.c.day).where(days.c.day > after, days.c.day < before).order_by(days.c.day)
    )
    return list(rows.all())


async def unclosed_days(
    session: AsyncSession,
    *,
    store: Store,
    close: CashClose | None = None,
    now: datetime | None = None,
) -> list[date]:
    """The days nobody closed that went into `close` — or, without one, into
    the store's next close so far, as of `now` (tests only).

    A day is listed when something happened at the drawer on it, between the
    previous close's business day and this one's; the counted day itself is
    never listed. Read from stamped rows, which never change, so a close's
    list never changes either. An opening count has nothing before it to
    have missed (G6, G30)."""
    if close is not None:
        if close.is_opening:
            return []
        previous = await session.scalar(
            select(CashClose.business_day).where(
                CashClose.store_id == store.id, CashClose.number == close.number - 1
            )
        )
        if previous is None:
            return []
        return await _days_with_events(
            session, store=store, number=close.number, after=previous, before=close.business_day
        )
    last = await newest_close(session, store.id)
    if last is None or await reopened_since(session, store.id, last.closed_at):
        return []
    today = business_day(now or datetime.now(UTC), store.timezone)
    return await _days_with_events(
        session, store=store, number=last.number + 1, after=last.business_day, before=today
    )


# --- a close ---------------------------------------------------------------------


def _way(others: dict[str, Any], way: str) -> WaySums:
    sums = others.get(way) or {}
    came_in = money(sums.get("came_in"))
    went_out = money(sums.get("went_out"))
    corrected = money(sums.get("corrected"))
    return WaySums(
        came_in=came_in,
        went_out=went_out,
        corrected=corrected,
        net=money(came_in - went_out + corrected),
    )


def _correction_text(from_method: str | None, to_method: str, note: str | None) -> str:
    told = f"{METHOD_LABELS[from_method]} → {METHOD_LABELS[to_method]}"
    return f"{told}: {note}" if note else told


def _movement_text(kind: str, note: str | None) -> str:
    told = KIND_LABELS[kind]
    return f"{told}: {note}" if note else told


async def explanations(session: AsyncSession, close: CashClose) -> list[Explanation]:
    """What later records explain of a closed close's difference (B6.3):
    corrections of its period's money rows, and cash moved before it but
    recorded after, whether named by a person or put there because the
    phone saw an older close (B5)."""
    corrections = (
        await session.execute(
            select(PaymentCorrection, AppUser.display_name)
            .join(AppUser, AppUser.id == PaymentCorrection.actor_user_id)
            .where(PaymentCorrection.explains_close_id == close.id)
        )
    ).all()
    movements = (
        await session.execute(
            select(CashMovement, AppUser.display_name)
            .join(AppUser, AppUser.id == CashMovement.actor_user_id)
            .where(CashMovement.for_close_id == close.id)
        )
    ).all()
    told: list[tuple[datetime, uuid.UUID, Explanation]] = []
    for correction, name in corrections:
        told.append(
            (
                correction.created_at,
                correction.id,
                Explanation(
                    kind="CORRECTION",
                    at=correction.created_at,
                    by=name,
                    cash=cash_effect(
                        direction=correction.direction,
                        amount=correction.amount,
                        from_method=correction.from_method,
                        to_method=correction.to_method,
                    ),
                    text=_correction_text(
                        correction.from_method, correction.to_method, correction.note
                    ),
                ),
            )
        )
    for movement, name in movements:
        out = movement.direction == Direction.OUT.value
        told.append(
            (
                movement.created_at,
                movement.id,
                Explanation(
                    kind="TAKE_OUT" if out else "PUT_IN",
                    at=movement.created_at,
                    by=name,
                    cash=money(-movement.amount if out else movement.amount),
                    text=_movement_text(movement.kind, movement.note),
                ),
            )
        )
    return [explanation for _, _, explanation in sorted(told, key=lambda item: item[:2])]


async def close_view(session: AsyncSession, *, scope: RequestScope, close: CashClose) -> CloseView:
    """A close, in full for whoever reads the money, otherwise in the
    seller's view (G27)."""
    store = await session.get(Store, close.store_id)
    assert store is not None
    reason = await session.scalar(
        select(CashCloseReason).where(CashCloseReason.close_id == close.id)
    )
    names = await _names(
        session, {close.actor_user_id} | ({reason.actor_user_id} if reason else set())
    )
    full = sees_money(scope, close.store_id)
    others = dict(close.others or {})
    told = await explanations(session, close) if full else []
    explained = (
        explained_by(
            (one.cash for one in told if one.kind == "CORRECTION"),
            (one.cash for one in told if one.kind != "CORRECTION"),
        )
        if full
        else None
    )
    return CloseView(
        id=close.id,
        store_id=close.store_id,
        store_name=store.name,
        number=close.number,
        business_day=close.business_day,
        closed_at=close.closed_at,
        closed_by=names[close.actor_user_id],
        mine=close.actor_user_id == scope.user_id,
        opening=close.is_opening,
        since=close.since,
        counted=close.counted,
        expected=close.expected,
        difference=close.difference,
        card=_way(others, "CARD"),
        transfer=_way(others, "TRANSFER"),
        unclosed_days=await unclosed_days(session, store=store, close=close),
        reason=reason.reason if reason else None,
        reason_by=names[reason.actor_user_id] if reason else None,
        reason_required=reason_required(close.difference),
        opening_float=close.opening_float if full else None,
        cash_in=close.cash_in if full else None,
        cash_out=close.cash_out if full else None,
        taken_out=close.taken_out if full else None,
        put_in=close.put_in if full else None,
        cash_corrected=close.cash_corrected if full else None,
        prepaid_transfer=_way(others, "PREPAID_TRANSFER").net if full else None,
        carrier_cod=_way(others, "CARRIER_COD").net if full else None,
        not_stated=_way(others, NOT_STATED) if full else None,
        explained=explained,
        unexplained=unexplained_of(close.difference, explained) if explained is not None else None,
        explanations=told,
    )


async def read_close(
    session: AsyncSession, *, scope: RequestScope, close_id: uuid.UUID
) -> CloseView:
    """One close: to whoever counted it, in their view, whatever their store's
    state; to whoever reads the store's money, in full."""
    close = await session.scalar(
        select(CashClose).where(
            CashClose.id == close_id, CashClose.organization_id == scope.organization_id
        )
    )
    if close is None:
        raise NotFoundError("Unknown close", close_id=str(close_id))
    if close.actor_user_id != scope.user_id:
        scope.require(Permission.REPORT_VIEW_FINANCIAL, close.store_id)
    return await close_view(session, scope=scope, close=close)


def _period(stores: Sequence[Store], first: date | None, last: date | None) -> tuple[date, date]:
    """Today's business day unless asked otherwise; a first day alone is
    that one day; one day to a year, as the sales report."""
    zone = stores[0].timezone if stores else DEFAULT_ZONE
    today = business_day(datetime.now(UTC), zone)
    first = first or last or today
    last = last or first
    if last < first or (last - first).days >= MAX_DAYS:
        raise ValidationFailedError(
            f"From one day to {MAX_DAYS} days, the first not after the last",
            reason="PERIOD",
            max_days=MAX_DAYS,
        )
    return first, last


async def _readable_stores(
    session: AsyncSession, scope: RequestScope, store_id: uuid.UUID | None
) -> list[Store]:
    """The store asked for, or every store whose money this person reads,
    one that does not trade included where they may read it."""
    if store_id is not None:
        scope.require(Permission.REPORT_VIEW_FINANCIAL, store_id)
        ids = {store_id}
    else:
        ids = {
            store
            for store in scope.store_ids | scope.readable_closed_stores
            if scope.can(Permission.REPORT_VIEW_FINANCIAL, store)
        }
        if not ids:
            scope.require(Permission.REPORT_VIEW_FINANCIAL)
    return list(
        (
            await session.scalars(
                select(Store)
                .where(Store.organization_id == scope.organization_id, Store.id.in_(ids))
                .order_by(Store.code, Store.id)
            )
        ).all()
    )


async def list_closes(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID | None,
    first: date | None,
    last: date | None,
    limit: int,
    offset: int,
) -> tuple[list[CloseView], bool]:
    """The closes of these business days, newest first, in full."""
    stores = await _readable_stores(session, scope, store_id)
    first, last = _period(stores, first, last)
    closes = list(
        (
            await session.scalars(
                select(CashClose)
                .where(
                    CashClose.store_id.in_([store.id for store in stores]),
                    CashClose.business_day >= first,
                    CashClose.business_day <= last,
                )
                .order_by(CashClose.closed_at.desc(), CashClose.id)
                .limit(limit + 1)
                .offset(offset)
            )
        ).all()
    )
    views = [await close_view(session, scope=scope, close=close) for close in closes[:limit]]
    return views, len(closes) > limit


# --- cash moved and corrections -------------------------------------------------------


async def movement_views(
    session: AsyncSession, movements: Sequence[CashMovement]
) -> list[MovementView]:
    names = await _names(session, {movement.actor_user_id for movement in movements})
    close_ids = {movement.for_close_id for movement in movements if movement.for_close_id}
    days: dict[uuid.UUID, date] = {}
    if close_ids:
        for close_id, day in (
            await session.execute(
                select(CashClose.id, CashClose.business_day).where(CashClose.id.in_(close_ids))
            )
        ).tuples():
            days[close_id] = day
    return [
        MovementView(
            id=movement.id,
            store_id=movement.store_id,
            kind=movement.kind,
            direction=movement.direction,
            amount=movement.amount,
            note=movement.note,
            at=movement.created_at,
            by=names[movement.actor_user_id],
            for_close_id=movement.for_close_id,
            for_day=days.get(movement.for_close_id) if movement.for_close_id else None,
            moved_to_close=movement.moved_to_close,
        )
        for movement in movements
    ]


async def movement_view(session: AsyncSession, movement: CashMovement) -> MovementView:
    await session.refresh(movement, ["created_at"])
    return (await movement_views(session, [movement]))[0]


def _window(store: Store, first: date, last: date) -> tuple[datetime, datetime]:
    """From 06:00 of the first business day to 06:00 after the last."""
    zone = ZoneInfo(store.timezone)
    start = datetime.combine(first, time(), zone) + DAY_STARTS
    end = datetime.combine(last + timedelta(days=1), time(), zone) + DAY_STARTS
    return start, end


async def list_movements(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    first: date | None,
    last: date | None,
) -> list[MovementView]:
    """Cash taken out and put in during these business days, newest first."""
    stores = await _readable_stores(session, scope, store_id)
    first, last = _period(stores, first, last)
    start, end = _window(stores[0], first, last)
    movements = (
        await session.scalars(
            select(CashMovement)
            .where(
                CashMovement.store_id == store_id,
                CashMovement.created_at >= start,
                CashMovement.created_at < end,
            )
            .order_by(CashMovement.created_at.desc(), CashMovement.id)
        )
    ).all()
    return await movement_views(session, movements)


async def correction_view(
    session: AsyncSession, correction: PaymentCorrection, *, target: Target, target_id: uuid.UUID
) -> CorrectionView:
    """A correction, under the target its command named."""
    await session.refresh(correction, ["created_at"])
    names = await _names(session, {correction.actor_user_id})
    day = None
    if correction.explains_close_id is not None:
        day = await session.scalar(
            select(CashClose.business_day).where(CashClose.id == correction.explains_close_id)
        )
    return CorrectionView(
        id=correction.id,
        seq=correction.seq,
        store_id=correction.store_id,
        target=target.value,
        target_id=target_id,
        amount=correction.amount,
        direction=correction.direction,
        from_method=correction.from_method,
        to_method=correction.to_method,
        explains_close_id=correction.explains_close_id,
        explains_day=day,
        at=correction.created_at,
        by=names[correction.actor_user_id],
        note=correction.note,
    )


# --- the drawer ------------------------------------------------------------------------


async def _brief(
    session: AsyncSession, scope: RequestScope, close: CashClose | None
) -> CloseBrief | None:
    if close is None:
        return None
    names = await _names(session, {close.actor_user_id})
    return CloseBrief(
        id=close.id,
        number=close.number,
        business_day=close.business_day,
        closed_at=close.closed_at,
        closed_by=names[close.actor_user_id],
        mine=close.actor_user_id == scope.user_id,
    )


async def reason_owed(session: AsyncSession, scope: RequestScope) -> CashClose | None:
    """The caller's own newest close whose difference needs a reason that they
    have not written (G12, G41). Until they write it, their phone keeps only
    «Каса» open. A close of an archived store is not owed: its reason could
    no longer be taken."""
    has_reason = select(CashCloseReason.id).where(CashCloseReason.close_id == CashClose.id)
    owed: CashClose | None = await session.scalar(
        select(CashClose)
        .join(Store, Store.id == CashClose.store_id)
        .where(
            CashClose.organization_id == scope.organization_id,
            CashClose.actor_user_id == scope.user_id,
            func.abs(CashClose.difference) >= SMALL_DIFFERENCE,
            Store.state != StoreState.ARCHIVED.value,
            ~has_reason.exists(),
        )
        .order_by(CashClose.closed_at.desc(), CashClose.id)
        .limit(1)
    )
    return owed


def movement_kinds(scope: RequestScope, store_id: uuid.UUID, state: StoreState) -> list[str]:
    """What this person may take out or put in here; nothing in a store that
    does not trade (G15)."""
    if state is not StoreState.ACTIVE:
        return []
    if scope.can(Permission.CASH_TAKE_OUT, store_id):
        return [kind.value for kind in KIND_ORDER]
    if scope.can(Permission.CASH_EXPENSE, store_id):
        return [kind.value for kind in KIND_ORDER if kind in EXPENSE_KINDS]
    return []


async def drawer(
    session: AsyncSession, *, scope: RequestScope, store_id: uuid.UUID, now: datetime | None = None
) -> DrawerView:
    """The drawer's state for its screen: the last close, whether the next is
    an opening count, what this person may do, cash moved in the open period
    (a seller's own; everyone's to whoever reads the money), the days not
    closed so far, and their own close still owing a reason. No sum of the
    period, nor anything it should hold (B4.3)."""
    scope.require_store(store_id)
    held = scope.permissions_for(store_id)
    if not held & {
        Permission.CASH_CLOSE,
        Permission.CASH_EXPENSE,
        Permission.REPORT_VIEW_FINANCIAL,
    }:
        raise PermissionDeniedError(
            f"Missing permission {Permission.CASH_CLOSE.value}",
            permission=Permission.CASH_CLOSE.value,
            store_id=str(store_id),
        )
    store = await _store(session, scope, store_id)
    state = StoreState(store.state)
    last = await newest_close(session, store.id)
    reopened = last is not None and await reopened_since(session, store.id, last.closed_at)
    moment = now or datetime.now(UTC)
    movements_query = select(CashMovement).where(
        CashMovement.store_id == store.id,
        CashMovement.drawer_period == (last.number if last else 0) + 1,
    )
    if not sees_money(scope, store.id):
        movements_query = movements_query.where(CashMovement.actor_user_id == scope.user_id)
    movements = (
        await session.scalars(
            movements_query.order_by(CashMovement.created_at.desc(), CashMovement.id)
        )
    ).all()
    owed = await reason_owed(session, scope)
    return DrawerView(
        store_id=store.id,
        store_name=store.name,
        store_state=state,
        last_close=await _brief(session, scope, last),
        next_is_opening=last is None or reopened,
        closed_today=last is not None and last.business_day == business_day(moment, store.timezone),
        may_close=may_close(scope, store.id, state),
        movement_kinds=movement_kinds(scope, store.id, state),
        may_correct=state is StoreState.ACTIVE and scope.can(Permission.CASH_CORRECT, store.id),
        movements=await movement_views(session, movements),
        unclosed_days=await unclosed_days(session, store=store, now=moment),
        reason_owed=await _brief(session, scope, owed),
    )


# --- the day's money, and the seller's own -----------------------------------------------


async def _goods_of_sales(session: AsyncSession, sale_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not sale_ids:
        return {}
    lines: defaultdict[uuid.UUID, list[str]] = defaultdict(list)
    for sale_id, name, quantity in (
        await session.execute(
            select(SaleItem.sale_id, SaleItem.display_name_snapshot, SaleItem.quantity)
            .where(SaleItem.sale_id.in_(sale_ids))
            .order_by(SaleItem.sale_id, SaleItem.id)
        )
    ).tuples():
        lines[sale_id].append(f"{name} × {quantity}")
    return {sale_id: ", ".join(names) for sale_id, names in lines.items()}


async def _goods_of_refunds(
    session: AsyncSession, refund_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    if not refund_ids:
        return {}
    lines: defaultdict[uuid.UUID, list[str]] = defaultdict(list)
    for refund_id, name, quantity in (
        await session.execute(
            select(RefundItem.refund_id, SaleItem.display_name_snapshot, RefundItem.quantity)
            .join(SaleItem, SaleItem.id == RefundItem.sale_item_id)
            .where(RefundItem.refund_id.in_(refund_ids))
            .order_by(RefundItem.refund_id, RefundItem.id)
        )
    ).tuples():
        lines[refund_id].append(f"{name} × {quantity}")
    return {refund_id: ", ".join(names) for refund_id, names in lines.items()}


@dataclass(frozen=True, slots=True)
class _Money:
    """One money event found at a drawer, before it is shown."""

    row: MoneyRow
    # What the screen names it by: the sale for the money taken with a sale.
    shown_as: Target
    shown_id: uuid.UUID
    at: datetime


def _first_payment() -> Any:
    """A payment that shares its sale's command: the money taken with a
    sale paid in parts (`credit.open_credit`)."""
    return CreditEntry.command_id == Sale.command_id


async def _money_at(
    session: AsyncSession,
    *,
    store: Store,
    window: tuple[datetime, datetime] | None = None,
    period: int | None = None,
    owner: uuid.UUID | None = None,
) -> list[_Money]:
    """The drawer's money events: sales (paid in full, or the first payment
    of one paid in parts), later payments taken here and money handed back
    here — within `window`, or of drawer `period`, and of `owner` alone when
    given. A return that handed nothing back moved no money, and is left
    out."""
    in_parts = select(CustomerCredit.id).where(CustomerCredit.sale_id == Sale.id).exists()

    def where(at: Any, stamp: Any, actor: Any) -> list[ColumnElement[bool]]:
        found: list[ColumnElement[bool]] = []
        if window is not None:
            found += [at >= window[0], at < window[1]]
        if period is not None:
            found.append(stamp == period)
        if owner is not None:
            found.append(actor == owner)
        return found

    events: list[_Money] = []
    for sale in (
        await session.scalars(
            select(Sale).where(
                Sale.store_id == store.id,
                Sale.status == SaleStatus.COMPLETED,
                ~in_parts,
                *where(Sale.sold_at, Sale.drawer_period, Sale.seller_user_id),
            )
        )
    ).all():
        events.append(
            _Money(
                row=MoneyRow(
                    target=Target.SALE,
                    row_id=sale.id,
                    store_id=sale.store_id,
                    direction=Direction.IN,
                    amount=sale.total,
                    period=sale.drawer_period,
                    stated=sale.payment_method,
                    owner=sale.seller_user_id,
                    for_order=False,
                    sale_id=sale.id,
                ),
                shown_as=Target.SALE,
                shown_id=sale.id,
                at=sale.sold_at,
            )
        )
    drawer = func.coalesce(CreditEntry.taken_at_store_id, CustomerCredit.store_id)
    payments = (
        await session.execute(
            select(CreditEntry, Sale.id, Sale.seller_user_id, Sale.sold_at, _first_payment())
            .join(CustomerCredit, CustomerCredit.id == CreditEntry.credit_id)
            .join(Sale, Sale.id == CustomerCredit.sale_id)
            .where(
                CreditEntry.kind == EntryKind.PAYMENT.value,
                drawer == store.id,
                *where(
                    CreditEntry.created_at, CreditEntry.drawer_period, CreditEntry.actor_user_id
                ),
            )
        )
    ).all()
    for entry, sale_id, seller, sold_at, first in payments:
        events.append(
            _Money(
                row=MoneyRow(
                    target=Target.PAYMENT,
                    row_id=entry.id,
                    store_id=store.id,
                    direction=Direction.IN,
                    amount=entry.amount,
                    period=entry.drawer_period,
                    stated=entry.payment_method,
                    owner=seller if first else entry.actor_user_id,
                    for_order=False,
                    sale_id=sale_id,
                ),
                shown_as=Target.SALE if first else Target.PAYMENT,
                shown_id=sale_id if first else entry.id,
                at=sold_at if first else entry.created_at,
            )
        )
    returned = aliased(CreditEntry)
    handed_back = func.coalesce(returned.cash_back, Refund.total_amount)
    refunds = (
        await session.execute(
            select(Refund, handed_back)
            .outerjoin(returned, returned.refund_id == Refund.id)
            .where(
                Refund.taken_at_store_id == store.id,
                handed_back > 0,
                *where(Refund.created_at, Refund.drawer_period, Refund.actor_user_id),
            )
        )
    ).all()
    for refund, amount in refunds:
        events.append(
            _Money(
                row=MoneyRow(
                    target=Target.REFUND,
                    row_id=refund.id,
                    store_id=store.id,
                    direction=Direction.OUT,
                    amount=money(amount),
                    period=refund.drawer_period,
                    stated=refund.payment_method,
                    owner=refund.actor_user_id,
                    for_order=False,
                    sale_id=refund.sale_id,
                ),
                shown_as=Target.REFUND,
                shown_id=refund.id,
                at=refund.created_at,
            )
        )
    sale_ids = {event.shown_id for event in events if event.shown_as is Target.SALE}
    orders = set()
    if sale_ids:
        orders = set(
            (
                await session.scalars(
                    select(CustomerOrder.sale_id).where(CustomerOrder.sale_id.in_(sale_ids))
                )
            ).all()
        )
    # The money taken with a collected order may have gone any order way (G2).
    found = [
        replace(
            event,
            row=replace(
                event.row, for_order=event.shown_as is Target.SALE and event.shown_id in orders
            ),
        )
        for event in events
    ]
    return sorted(found, key=lambda event: (event.at, event.row.row_id), reverse=True)


async def _labels(session: AsyncSession, events: Sequence[_Money]) -> dict[uuid.UUID, str]:
    """The goods of each event, by the row it shows: a sale's or a debt's
    goods, a refund's returned goods. Never a customer's name."""
    sales = await _goods_of_sales(
        session, {event.row.sale_id for event in events if event.shown_as is not Target.REFUND}
    )
    refunds = await _goods_of_refunds(
        session, {event.row.row_id for event in events if event.shown_as is Target.REFUND}
    )
    return {
        event.shown_id: refunds.get(event.row.row_id, "")
        if event.shown_as is Target.REFUND
        else sales.get(event.row.sale_id, "")
        for event in events
    }


async def day_events(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    day: date | None = None,
    now: datetime | None = None,
) -> list[EventView]:
    """The drawer's money of one business day (today unless asked), with
    sums and ways, for the owner's and a manager's «Виправити спосіб
    оплати»."""
    scope.require(Permission.REPORT_VIEW_FINANCIAL, store_id)
    store = await _store(session, scope, store_id)
    asked = day or business_day(now or datetime.now(UTC), store.timezone)
    events = await _money_at(session, store=store, window=_window(store, asked, asked))
    last = await last_close_number(session, store.id)
    state = StoreState(store.state)
    names = await _names(session, {event.row.owner for event in events})
    labels = await _labels(session, events)
    ways = await _ways(session, events)
    days = await _close_days(
        session,
        store.id,
        {
            event.row.period
            for event in events
            if event.row.period is not None and is_closed(event.row.period, last)
        },
    )
    return [
        EventView(
            target=event.shown_as.value,
            target_id=event.shown_id,
            at=event.at,
            by=names[event.row.owner],
            amount=event.row.amount,
            direction=event.row.direction.value,
            stated_method=event.row.stated,
            method=ways[event.row.row_id][0],
            corrected=ways[event.row.row_id][1],
            closed=is_closed(event.row.period, last),
            close_day=None if event.row.period is None else days.get(event.row.period),
            label=labels[event.shown_id],
            is_order=event.row.for_order,
            may_change=may_correct(scope, event.row, last=last, state=state),
        )
        for event in events
    ]


async def _close_days(
    session: AsyncSession, store_id: uuid.UUID, periods: set[int]
) -> dict[int, date]:
    """The business day of the close that ended each of these periods:
    close k ends period k."""
    if not periods:
        return {}
    rows = await session.execute(
        select(CashClose.number, CashClose.business_day).where(
            CashClose.store_id == store_id, CashClose.number.in_(periods)
        )
    )
    return {row.number: row.business_day for row in rows}


async def _ways(
    session: AsyncSession, events: Sequence[_Money]
) -> dict[uuid.UUID, tuple[str | None, bool]]:
    """The current way of each event's money row, and whether it was
    corrected (`cash.current`)."""
    entries = await entry_methods(
        session, [event.row.row_id for event in events if event.row.target is Target.PAYMENT]
    )
    refunds = await refund_methods(
        session, [event.row.row_id for event in events if event.row.target is Target.REFUND]
    )
    sales = await sale_methods(
        session, [event.row.row_id for event in events if event.row.target is Target.SALE]
    )
    ways: dict[uuid.UUID, tuple[str | None, bool]] = {}
    for row_id, current in entries.items():
        ways[row_id] = (current.method.value if current.method else None, current.corrected)
    for row_id, current in refunds.items():
        ways[row_id] = (current.method.value if current.method else None, current.corrected)
    for row_id, methods in sales.items():
        taken = methods.taken_with_sale
        ways[row_id] = (taken.method.value if taken.method else None, taken.corrected)
    return ways


async def my_events(
    session: AsyncSession, *, scope: RequestScope, store_id: uuid.UUID
) -> list[MineEvent]:
    """The seller's own sales, debt payments and returns of the drawer's
    open period, newest first — what they may still fix before the close
    (G16) — by time and goods only: no sum, no way (G32)."""
    scope.require(Permission.SALE_CREATE, store_id)
    store = await _store(session, scope, store_id)
    events = await _money_at(
        session,
        store=store,
        period=await last_close_number(session, store.id) + 1,
        # Theirs: the sales they sold, the payments they took — toward a
        # colleague's debt too — and the money they handed back.
        owner=scope.user_id,
    )
    labels = await _labels(session, events)
    return [
        MineEvent(
            target=event.shown_as.value,
            target_id=event.shown_id,
            at=event.at,
            label=labels[event.shown_id],
        )
        for event in events
    ]


# --- the money of one operation --------------------------------------------------------


async def sale_method(
    session: AsyncSession, *, scope: RequestScope, sale_id: uuid.UUID, store_id: uuid.UUID
) -> SaleMethodView:
    """The money taken with one sale: its sum, its way now, and the way a
    return suggests. For whoever reads the drawer's money; for the sale's
    own seller, to fix it; and for whoever may take its return at
    `store_id` — any store of the network that trades (owner decision,
    2026-10-01)."""
    row = await money_row(
        session, organization_id=scope.organization_id, target=Target.SALE, target_id=sale_id
    )
    if not (
        sees_money(scope, row.store_id)
        or row.owner == scope.user_id
        or scope.can(Permission.SALE_REFUND, store_id)
    ):
        scope.require(Permission.SALE_REFUND, store_id)
    methods = (await sale_methods(session, [sale_id]))[sale_id]
    return await _method_view(session, scope, row, refund_method=methods.refund_method)


async def operation_method(
    session: AsyncSession, *, scope: RequestScope, target: Target, target_id: uuid.UUID
) -> SaleMethodView:
    """The money of one debt payment or one refund, its way now, for the
    seller who took it — to fix it before the close (G16) — and for whoever
    reads the drawer's money."""
    row = await money_row(
        session, organization_id=scope.organization_id, target=target, target_id=target_id
    )
    if not (sees_money(scope, row.store_id) or row.owner == scope.user_id):
        scope.require(Permission.REPORT_VIEW_FINANCIAL, row.store_id)
    return await _method_view(session, scope, row, refund_method=None)


async def _method_view(
    session: AsyncSession,
    scope: RequestScope,
    row: MoneyRow,
    *,
    refund_method: Any,
) -> SaleMethodView:
    current, seq = await current_way(session, row)
    state = await store_state(session, organization_id=scope.organization_id, store_id=row.store_id)
    last = await last_close_number(session, row.store_id)
    return SaleMethodView(
        sale_id=row.sale_id,
        target=row.target.value,
        target_id=row.row_id,
        amount_taken=row.amount,
        method=current,
        corrected=seq > 0,
        refund_method=refund_method.value if refund_method else None,
        may_change=may_correct(scope, row, last=last, state=state),
        is_order=row.for_order,
    )


__all__ = [
    "KIND_LABELS",
    "MAX_DAYS",
    "METHOD_LABELS",
    "CloseBrief",
    "CloseView",
    "CorrectionView",
    "DrawerView",
    "EventView",
    "Explanation",
    "MineEvent",
    "MovementView",
    "SaleMethodView",
    "WaySums",
    "close_view",
    "correction_view",
    "day_events",
    "drawer",
    "explanations",
    "list_closes",
    "list_movements",
    "movement_kinds",
    "movement_view",
    "movement_views",
    "my_events",
    "operation_method",
    "read_close",
    "reason_owed",
    "sale_method",
    "sees_money",
    "unclosed_days",
]
