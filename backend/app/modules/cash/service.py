"""The drawer's commands: the close, its reason, cash taken out or put in, and
corrections of a way of paying (ADR-0012, B4-B6).

The owner decided (business-rules.md, "cash and card, the day's close"):

- one drawer per store, closed once a day by the seller on duty, who counts
  the cash without seeing what it should hold, then sees the difference; what
  was counted is the next day's cash for change;
- a difference is recorded with a reason, which is required, and only
  whoever counted writes it; a difference under 1 грн needs none;
- cash taken out is recorded with who took it and why — the owner and
  managers record any, a seller only expenses — and cash put in for change by
  the owner or a manager;
- a closed day is never reopened: the owner or a manager corrects a wrong way
  of paying, or cash taken out and forgotten, on the day the correction is
  made; before the close a seller fixes the way of their own sales, debt
  payments and returns;
- a blocked store is closed by the network's owner alone.

**Every command is named by the phone's permanent `command_id`**: it is
looked up under its own lock before anything is decided, so a resend is
answered with what the first send did, and two sends at once end in one row.
Every refusal decided after that lookup carries `recorded: false` (`refuse`,
`PaymentMethodChangedError`, and `STORE_NOT_TRADING` for a new command): it
proves this command wrote nothing, and lets a phone that never heard the
first answer settle the attempt (ADR-0008 §9). Refusals before it — who may,
which store — keep their usual meaning. Whether the store trades is decided
after the lookup, on the store's row the command holds: a command recorded
before a block or the archive is still answered with what it did, and only a
new one is refused.

**Which period** a row belongs to is stamped by the database under the
store's lock (`birka_drawer_period`, revision 0035); a close takes the same
row `FOR UPDATE`, so a money row in flight is either in it or in the next one,
never in both and never in neither. The commands here only decide what the
stamp cannot: a movement whose phone saw an older close is put on the close
that came between (B5), and a correction of a closed period explains that
close's difference instead of changing today's cash (B6.3).

The answers are built by `cash.read`; these return the rows.
"""

from __future__ import annotations

import hashlib
import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from typing import Any, NoReturn
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core import idempotency
from app.core.errors import (
    IdempotencyConflictError,
    NotFoundError,
    PaymentMethodChangedError,
    PermissionDeniedError,
    StoreNotTradingError,
    ValidationFailedError,
)
from app.core.logging import get_logger
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.cash.models import (
    CashClose,
    CashCloseReason,
    CashMovement,
    Direction,
    MovementKind,
    PaymentCorrection,
)
from app.modules.credit.models import CreditEntry, CustomerCredit, EntryKind
from app.modules.identity.models import AppUser
from app.modules.orders.models import CustomerOrder
from app.modules.refunds.models import Refund
from app.modules.sales.models import Sale, SaleStatus
from app.modules.sales.payment import DRAWER_METHOD, ORDER_METHODS, TILL_METHODS, PaymentMethod
from app.modules.tenancy.models import Store, StoreState, StoreStateChange
from app.modules.tenancy.service import hold_stores

logger = get_logger(__name__)

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
# A count confirmed on the phone longer ago than this, in seconds, no longer
# describes the drawer, and is not recorded (owner decisions, 2026-10-04:
# "more than 10 minutes late"; ADR-0012, G31).
STALE_AFTER = 600
# A difference whose absolute value is under this is recorded, but needs no
# reason and no message (owner decisions, 2026-10-04; ADR-0012, G41).
SMALL_DIFFERENCE = Decimal("1.00")
# A business day runs from 06:00 to 06:00 in the store's time zone: a close
# before 06:00 belongs to the evening before (owner decisions, 2026-10-04;
# ADR-0012, G8).
DAY_STARTS = timedelta(hours=6)
MAX_NOTE = 200
MAX_REASON = 1000
# A money row written before the way was asked (revision 0035).
NOT_STATED = "NOT_STATED"
# Every way the close shows beside cash, for display (`cash_close.others`):
# card and transfer to compare with the terminal's slip, the order ways, and
# «не вказано». None of them is counted.
OTHER_WAYS: tuple[str, ...] = (
    PaymentMethod.CARD.value,
    PaymentMethod.TRANSFER.value,
    PaymentMethod.PREPAID_TRANSFER.value,
    PaymentMethod.CARRIER_COD.value,
    NOT_STATED,
)
ALL_WAYS: tuple[str, ...] = (DRAWER_METHOD.value, *OTHER_WAYS)
# What a seller may take out (`cash:expense`); `cash:take_out` covers every
# kind, cash put in included (owner decisions, 2026-10-04; ADR-0012, G34).
EXPENSE_KINDS = frozenset({MovementKind.EXPENSES, MovementKind.SUPPLIER_COURIER})


class Target(StrEnum):
    """The money row a correction names. `SALE` is the money taken with a
    sale: the sale itself when it was paid in full, an order collected
    included, and its first payment when it was paid in parts (B6.1)."""

    SALE = "SALE"
    PAYMENT = "PAYMENT"
    REFUND = "REFUND"


# --- refusals ---------------------------------------------------------------

# Every refusal decided after a command's `command_id` was looked up, with
# what it says. `PAYMENT_METHOD_CHANGED` is its own error, a 409, and
# `STORE_NOT_TRADING` its own, a 403 (`_not_trading`).
REFUSALS: Mapping[str, str] = {
    "COUNT_IS_STALE": "The count was confirmed more than ten minutes ago; close as usual later",
    "CLOSED_BY_ANOTHER": "The drawer was closed after this count began; it is not recorded",
    "CLOSE_IN_BETWEEN": (
        "The drawer was closed since this screen showed it; it is not recorded: record it "
        "again, or the owner or a manager records it against that close"
    ),
    "ALREADY_CLOSED_TODAY": "The drawer was already closed this business day",
    "NO_REASON": f"Say why, in 1 to {MAX_REASON} characters",
    "NO_DIFFERENCE": "This close has no difference to explain",
    "REASON_GIVEN": "The reason for this close was already recorded",
    "DAY_CLOSED": "This operation's day is closed; the owner or a manager corrects it",
    "SAME_METHOD": "It was already paid that way",
    "METHOD_NOT_FOR_THIS": "This operation cannot have been paid that way",
    "BEFORE_DRAWER": "Recorded before the drawer was counted; its way is not corrected",
}


def refuse(reason: str, **details: Any) -> NoReturn:
    """Refuse a drawer command after its replay lookup: `422 VALIDATION_ERROR`
    with `reason`, and `recorded: false`, since the lock and the lookup came
    first and so prove this command wrote nothing (ADR-0012, B4)."""
    raise ValidationFailedError(REFUSALS[reason], reason=reason, recorded=False, **details)


def _not_trading(store_id: uuid.UUID, state: StoreState) -> NoReturn:
    """Refuse a new drawer command in a store that does not trade (G14,
    G15). Decided after the command's lookup, which answered one recorded
    before the block or the archive with what it did; so it says `recorded:
    false`, and a phone that never heard whether its attempt went through
    settles it, instead of keeping every cash button disabled until the store
    trades again."""
    raise StoreNotTradingError(store_id=str(store_id), state=state.value, recorded=False)


def _granted(scope: RequestScope, permission: Permission, store_id: uuid.UUID) -> bool:
    """Whether this person's grants give `permission` at this store, whatever
    the store's state: one held organization-wide counts in a store that does
    not trade too. Whether it trades is decided on the store's row the
    command holds, after its lookup (`_not_trading`)."""
    return permission in scope.org_permissions or scope.can(permission, store_id)


def _require_granted(scope: RequestScope, permission: Permission, store_id: uuid.UUID) -> None:
    """The pre-check that keeps outsiders from the store's lock, and decides
    nothing else (B4 step 1). A grant of the store's own gives nothing in a
    store that does not trade, and the scope refuses it there by name, as
    before: that phone shows no «Каса» there."""
    if permission not in scope.org_permissions:
        scope.require(permission, store_id)


# --- the arithmetic (pure) --------------------------------------------------


def money(value: Decimal | int | str | None) -> Decimal:
    """A sum as money: two places, nothing being 0.00."""
    return Decimal(value or 0).quantize(CENT)


def business_day(moment: datetime, timezone: str) -> date:
    """The day `moment` belongs to in a store of this time zone, running
    06:00 to 06:00 (G8): 00:10 and 05:59 are the evening before's."""
    return (moment.astimezone(ZoneInfo(timezone)) - DAY_STARTS).date()


def expected_cash(
    *,
    opening_float: Decimal | None,
    cash_in: Decimal,
    cash_out: Decimal,
    taken_out: Decimal,
    put_in: Decimal,
    cash_corrected: Decimal,
) -> Decimal | None:
    """What the drawer should hold at the close: the last count, plus cash
    taken, less cash handed back and taken out, plus cash put in, plus what
    corrections of the period's own money rows moved into cash (B4 step 11).
    None for an opening count, which has nothing to start from (G6, G30)."""
    if opening_float is None:
        return None
    return money(opening_float + cash_in - cash_out - taken_out + put_in + cash_corrected)


def difference_of(counted: Decimal, expected: Decimal | None) -> Decimal | None:
    """Counted less expected: below nothing a shortage, above it a surplus."""
    return None if expected is None else money(counted - expected)


def reason_required(difference: Decimal | None) -> bool:
    """Whether a close's difference needs a reason and a message: 1,00 грн
    or more either way (owner decisions, 2026-10-04; G41)."""
    return difference is not None and abs(difference) >= SMALL_DIFFERENCE


def way_effect(
    way: str, *, direction: str, amount: Decimal, from_method: str | None, to_method: str
) -> Decimal:
    """What a correction moved into `way` (`NOT_STATED` for none): money
    taken (IN) moves from the old way to the new, money handed back (OUT)
    the other way round (B4.1). «Не вказано» was in no way, so a correction
    from it adds to the new way only, and leaves «не вказано» for display."""
    moved = int(to_method == way) - int((from_method or NOT_STATED) == way)
    sign = 1 if direction == Direction.IN.value else -1
    return money(sign * moved * amount)


def cash_effect(
    *, direction: str, amount: Decimal, from_method: str | None, to_method: str
) -> Decimal:
    """What a correction moved into the drawer's cash (B6.3)."""
    return way_effect(
        DRAWER_METHOD.value,
        direction=direction,
        amount=amount,
        from_method=from_method,
        to_method=to_method,
    )


def explained_by(corrections: Iterable[Decimal], movements: Iterable[Decimal]) -> Decimal:
    """How much of a closed close's difference later records explain: the
    cash effect of corrections of its period, and cash taken out (negative)
    or put in (positive) before it but recorded after (B6.3). None of them
    changes any period's expected cash: the next count already absorbed
    them."""
    return money(sum(corrections, ZERO) + sum(movements, ZERO))


def unexplained_of(difference: Decimal | None, explained: Decimal) -> Decimal | None:
    """The part of a close's difference nothing explains; None for an
    opening count, which has no difference."""
    return None if difference is None else money(difference - explained)


def may_close(scope: RequestScope, store_id: uuid.UUID, state: StoreState) -> bool:
    """Whether this person closes this store's drawer while it is in `state`
    (B9): a trading store's `cash:close`; a blocked store, the network's owner
    alone — `store:manage` and `cash:close` held organization-wide, as they
    write off its debts (G14); an archived store, nobody."""
    if state is StoreState.ACTIVE:
        held = scope.org_permissions | scope.store_permissions.get(store_id, frozenset())
        return Permission.CASH_CLOSE in held
    if state is StoreState.BLOCKED:
        return {Permission.STORE_MANAGE, Permission.CASH_CLOSE} <= scope.org_permissions
    return False


# --- what a period holds ------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PeriodSums:
    """What period `k` of one drawer took, handed back and moved, by way."""

    came_in: Mapping[str, Decimal]
    went_out: Mapping[str, Decimal]
    corrected: Mapping[str, Decimal]
    taken_out: Decimal
    put_in: Decimal

    def of(self, way: str) -> tuple[Decimal, Decimal, Decimal]:
        return (
            money(self.came_in.get(way)),
            money(self.went_out.get(way)),
            money(self.corrected.get(way)),
        )

    def others(self) -> dict[str, dict[str, str]]:
        """Every way but cash, for the close's `others`."""
        shown = {}
        for way in OTHER_WAYS:
            came_in, went_out, corrected = self.of(way)
            shown[way] = {
                "came_in": str(came_in),
                "went_out": str(went_out),
                "corrected": str(corrected),
            }
        return shown


async def period_sums(session: AsyncSession, *, store_id: uuid.UUID, number: int) -> PeriodSums:
    """Sum period `number` at this store's drawer (B4.1): sales paid in full
    there, payments taken there, money handed back there, cash moved there
    that names no earlier close, and corrections of the period's own money
    rows. Rows are found by their stamp, never by a timestamp."""
    came_in: defaultdict[str, Decimal] = defaultdict(lambda: ZERO)
    went_out: defaultdict[str, Decimal] = defaultdict(lambda: ZERO)
    corrected: defaultdict[str, Decimal] = defaultdict(lambda: ZERO)

    in_parts = select(CustomerCredit.id).where(CustomerCredit.sale_id == Sale.id).exists()
    sales = await session.execute(
        select(Sale.payment_method, func.sum(Sale.total))
        .where(
            Sale.store_id == store_id,
            Sale.drawer_period == number,
            Sale.status == SaleStatus.COMPLETED,
            ~in_parts,
        )
        .group_by(Sale.payment_method)
    )
    for way, total in sales.tuples():
        came_in[way or NOT_STATED] += money(total)

    payments = await session.execute(
        select(CreditEntry.payment_method, func.sum(CreditEntry.amount))
        .join(CustomerCredit, CustomerCredit.id == CreditEntry.credit_id)
        .where(
            CreditEntry.kind == EntryKind.PAYMENT.value,
            CreditEntry.drawer_period == number,
            func.coalesce(CreditEntry.taken_at_store_id, CustomerCredit.store_id) == store_id,
        )
        .group_by(CreditEntry.payment_method)
    )
    for way, total in payments.tuples():
        came_in[way or NOT_STATED] += money(total)

    # A return of a sale paid in parts first lowered the debt: only its cash
    # back left the drawer.
    returned = aliased(CreditEntry)
    handed_back = await session.execute(
        select(
            Refund.payment_method,
            func.sum(func.coalesce(returned.cash_back, Refund.total_amount)),
        )
        .outerjoin(returned, returned.refund_id == Refund.id)
        .where(Refund.taken_at_store_id == store_id, Refund.drawer_period == number)
        .group_by(Refund.payment_method)
    )
    for way, total in handed_back.tuples():
        went_out[way or NOT_STATED] += money(total)

    moved: dict[str, Decimal] = {}
    for direction, total in (
        await session.execute(
            select(CashMovement.direction, func.sum(CashMovement.amount))
            .where(
                CashMovement.store_id == store_id,
                CashMovement.drawer_period == number,
                CashMovement.for_close_id.is_(None),
            )
            .group_by(CashMovement.direction)
        )
    ).tuples():
        moved[direction] = money(total)

    corrections = await session.execute(
        select(
            PaymentCorrection.from_method,
            PaymentCorrection.to_method,
            PaymentCorrection.direction,
            func.sum(PaymentCorrection.amount),
        )
        .where(
            PaymentCorrection.store_id == store_id,
            PaymentCorrection.drawer_period == number,
            PaymentCorrection.explains_close_id.is_(None),
        )
        .group_by(
            PaymentCorrection.from_method, PaymentCorrection.to_method, PaymentCorrection.direction
        )
    )
    for from_method, to_method, direction, total in corrections.tuples():
        for way in ALL_WAYS:
            corrected[way] += way_effect(
                way,
                direction=direction,
                amount=money(total),
                from_method=from_method,
                to_method=to_method,
            )

    return PeriodSums(
        came_in=dict(came_in),
        went_out=dict(went_out),
        corrected=dict(corrected),
        taken_out=money(moved.get(Direction.OUT.value)),
        put_in=money(moved.get(Direction.IN.value)),
    )


async def newest_close(session: AsyncSession, store_id: uuid.UUID) -> CashClose | None:
    """The store's last close, by its number: never by a time."""
    close: CashClose | None = await session.scalar(
        select(CashClose)
        .where(CashClose.store_id == store_id)
        .order_by(CashClose.number.desc())
        .limit(1)
    )
    return close


async def reopened_since(session: AsyncSession, store_id: uuid.UUID, moment: datetime) -> bool:
    """Whether the store came back from the archive after `moment`: its
    drawer was emptied, so its next close is an opening count (G30)."""
    return (
        await session.scalar(
            select(StoreStateChange.id)
            .where(
                StoreStateChange.store_id == store_id,
                StoreStateChange.from_state == StoreState.ARCHIVED.value,
                StoreStateChange.to_state == StoreState.ACTIVE.value,
                StoreStateChange.created_at > moment,
            )
            .limit(1)
        )
    ) is not None


async def _closed_by(session: AsyncSession, close: CashClose | None) -> dict[str, Any]:
    """When the close that stands was made, and by whom, for a refusal."""
    if close is None:
        return {}
    name = await session.scalar(
        select(AppUser.display_name).where(AppUser.id == close.actor_user_id)
    )
    return {"closed_at": close.closed_at.isoformat(), "closed_by": name}


def _lock_key(*parts: bytes) -> int:
    return int.from_bytes(
        hashlib.sha256(b"".join(parts)).digest()[:8], byteorder="big", signed=True
    )


async def lock_command(
    session: AsyncSession, *, organization_id: uuid.UUID, command_id: uuid.UUID
) -> None:
    """Serialize one drawer command before it looks itself up, as the till
    does (`sales.service.lock_command`, which this module may not import).

    Two sends of one command — the first held behind a close, the phone
    timing out, «Повторити» pressed — then end in one row and one replay,
    never a 500 on the command's unique constraint. Hash collisions only
    serialize unrelated commands."""
    key = _lock_key(organization_id.bytes, command_id.bytes)
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


async def _lock_money_row(
    session: AsyncSession, *, organization_id: uuid.UUID, row_id: uuid.UUID
) -> None:
    """Serialize corrections of one money row, so each reads the way the one
    before it left (B6.1)."""
    key = _lock_key(b"payment_correction", organization_id.bytes, row_id.bytes)
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def _conflict(command_id: uuid.UUID) -> NoReturn:
    raise IdempotencyConflictError(
        "This command_id was already used with a different request", command_id=str(command_id)
    )


# --- the close (B4) ---------------------------------------------------------


async def close_day(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    command_id: uuid.UUID,
    counted: Decimal,
    counted_at: datetime,
    after_close_id: uuid.UUID | None,
    age: int = 0,
    now: datetime | None = None,
    correlation_id: str | None = None,
) -> CashClose:
    """Count the drawer and close its period: every figure frozen on one row.

    `counted_at` is the phone's clock at «Так, закрити», and `age` how many
    seconds ago that was by the same clock, measured at each send; the server
    compares the phone's clock only with itself. `after_close_id` is the
    newest close the count screen showed. `now` exists for tests only.
    """
    total = money(counted)
    if total < ZERO:
        raise ValidationFailedError("A count is never below nothing")
    # 1. Keeps outsiders from taking the store's lock. It decides nothing
    # else: the scope's state of the store was read without a lock.
    _require_granted(scope, Permission.CASH_CLOSE, store_id)
    # 2. Every money row already stamped into this period commits before this
    # reads on, and every one after waits and lands in the next period.
    store = await session.scalar(
        select(Store)
        .where(Store.id == store_id, Store.organization_id == scope.organization_id)
        .with_for_update()
    )
    if store is None:
        raise NotFoundError("Unknown store", store_id=str(store_id))
    # 3. Authorised on the state of the row now held: a block committed since
    # the request began is honoured. Who may not close a store that trades is
    # refused here; a store that does not trade, after the lookup, so a close
    # recorded before the block or the archive is still answered with itself.
    state = StoreState(store.state)
    allowed = may_close(scope, store.id, state)
    if not allowed and state is StoreState.ACTIVE:
        raise PermissionDeniedError(
            f"Missing permission {Permission.CASH_CLOSE.value}",
            permission=Permission.CASH_CLOSE.value,
            store_id=str(store.id),
        )
    # 4. Two sends of one close wait for each other on the store's lock; the
    # command's own lock also keeps one command_id sent for two stores from
    # meeting the unique constraint.
    await lock_command(session, organization_id=scope.organization_id, command_id=command_id)
    fingerprint = idempotency.fingerprint(
        {
            "close": str(store.id),
            "counted": str(total),
            "counted_at": counted_at.astimezone(UTC).isoformat(),
            "after": str(after_close_id) if after_close_id else None,
        },
        actor_user_id=scope.user_id,
        store_id=store.id,
    )
    done = await session.scalar(
        select(CashClose).where(
            CashClose.organization_id == scope.organization_id, CashClose.command_id == command_id
        )
    )
    if done is not None:
        if done.command_fingerprint != fingerprint:
            _conflict(command_id)
        return done
    if not allowed:
        _not_trading(store.id, state)
    # 5. A count that no longer describes the drawer (G31).
    if age > STALE_AFTER:
        refuse("COUNT_IS_STALE", counted_at=counted_at.isoformat())
    previous = await newest_close(session, store.id)
    if (previous.id if previous else None) != after_close_id:
        # Somebody closed after the count screen loaded: this count was taken
        # in a period that is closed already.
        refuse("CLOSED_BY_ANOTHER", **await _closed_by(session, previous))
    # 6-7. Once a business day; read after the lock, so it follows the close
    # before it.
    moment = now or await session.scalar(select(func.clock_timestamp()))
    assert moment is not None
    day = business_day(moment, store.timezone)
    if previous is not None and (moment <= previous.closed_at or day <= previous.business_day):
        refuse("ALREADY_CLOSED_TODAY", **await _closed_by(session, previous))
    # 8-11.
    number = previous.number + 1 if previous else 1
    opening = previous is None or await reopened_since(session, store.id, previous.closed_at)
    sums = await period_sums(session, store_id=store.id, number=number)
    cash_in, cash_out, cash_corrected = sums.of(DRAWER_METHOD.value)
    opening_float = None if opening or previous is None else previous.counted
    expected = expected_cash(
        opening_float=opening_float,
        cash_in=cash_in,
        cash_out=cash_out,
        taken_out=sums.taken_out,
        put_in=sums.put_in,
        cash_corrected=cash_corrected,
    )
    difference = difference_of(total, expected)
    # 12.
    close = CashClose(
        organization_id=scope.organization_id,
        store_id=store.id,
        number=number,
        is_opening=opening,
        business_day=day,
        closed_at=moment,
        since=previous.closed_at if previous else None,
        actor_user_id=scope.user_id,
        command_id=command_id,
        command_fingerprint=fingerprint,
        opening_float=opening_float,
        counted=total,
        cash_in=cash_in,
        cash_out=cash_out,
        taken_out=sums.taken_out,
        put_in=sums.put_in,
        cash_corrected=cash_corrected,
        expected=expected,
        difference=difference,
        others=sums.others(),
        correlation_id=correlation_id,
    )
    session.add(close)
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="cash.closed",
        entity_type="cash_close",
        entity_id=close.id,
        after={
            "number": number,
            "counted": str(total),
            "expected": None if expected is None else str(expected),
            "difference": None if difference is None else str(difference),
        },
    )
    logger.info("cash.closed", close_id=str(close.id), store_id=str(store.id), number=number)
    return close


async def give_reason(
    session: AsyncSession,
    *,
    scope: RequestScope,
    close_id: uuid.UUID,
    command_id: uuid.UUID,
    reason: str,
) -> CashClose:
    """Why a close's count differs, as whoever counted writes it — and only
    they (G12). Once per close; a second command meets the first's reason.

    A blocked store's close takes its reason too: the network's owner closes
    it, and their phone asks for the reason before anything else (B7 H). An
    archived store's takes none; a reason recorded before the archive is
    still answered with itself."""
    why = reason.strip()
    await lock_command(session, organization_id=scope.organization_id, command_id=command_id)
    close = await session.scalar(
        select(CashClose).where(
            CashClose.id == close_id, CashClose.organization_id == scope.organization_id
        )
    )
    if close is None:
        raise NotFoundError("Unknown close", close_id=str(close_id))
    if close.actor_user_id != scope.user_id:
        raise PermissionDeniedError("Only whoever counted gives the reason", close_id=str(close_id))
    # The store keeps the state read here until this transaction ends.
    states = await hold_stores(
        session, organization_id=scope.organization_id, store_ids={close.store_id}
    )
    fingerprint = idempotency.fingerprint(
        {"reason_for": str(close.id), "reason": why},
        actor_user_id=scope.user_id,
        store_id=close.store_id,
    )
    done = await session.scalar(
        select(CashCloseReason).where(
            CashCloseReason.organization_id == scope.organization_id,
            CashCloseReason.command_id == command_id,
        )
    )
    if done is not None:
        if done.command_fingerprint != fingerprint or done.close_id != close.id:
            _conflict(command_id)
        return close
    if states[close.store_id] is StoreState.ARCHIVED:
        _not_trading(close.store_id, StoreState.ARCHIVED)
    # A row lock that fires no trigger and keeps no foreign key waiting: two
    # reasons for one close under two commands are decided one after the
    # other, and the second meets the first.
    await session.execute(
        select(CashClose.id).where(CashClose.id == close.id).with_for_update(key_share=True)
    )
    if not why or len(why) > MAX_REASON or not is_storable(why):
        refuse("NO_REASON")
    if not reason_required(close.difference):
        refuse("NO_DIFFERENCE")
    if await session.scalar(select(CashCloseReason.id).where(CashCloseReason.close_id == close.id)):
        refuse("REASON_GIVEN")
    session.add(
        CashCloseReason(
            organization_id=scope.organization_id,
            close_id=close.id,
            reason=why,
            actor_user_id=scope.user_id,
            command_id=command_id,
            command_fingerprint=fingerprint,
        )
    )
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="cash.reason_given",
        entity_type="cash_close",
        entity_id=close.id,
        reason=why,
    )
    logger.info("cash.reason_given", close_id=str(close.id))
    return close


# --- cash taken out and put in (B5) -------------------------------------------


def _note(note: str | None) -> str | None:
    if note is None or not note.strip():
        return None
    kept = note.strip()
    if len(kept) > MAX_NOTE or not is_storable(kept):
        raise ValidationFailedError(f"A note is at most {MAX_NOTE} characters", reason="NOTE")
    return kept


async def _closes_of(
    session: AsyncSession, store_id: uuid.UUID, close_ids: set[uuid.UUID]
) -> dict[uuid.UUID, CashClose]:
    """These closes, each of this store; any other is unknown here."""
    if not close_ids:
        return {}
    found = {
        close.id: close
        for close in (
            await session.scalars(
                select(CashClose).where(CashClose.id.in_(close_ids), CashClose.store_id == store_id)
            )
        ).all()
    }
    if set(found) != close_ids:
        raise NotFoundError("Unknown close", store_id=str(store_id))
    return found


async def record_movement(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    command_id: uuid.UUID,
    kind: MovementKind,
    amount: Decimal,
    note: str | None,
    after_close_id: uuid.UUID | None,
    for_close_id: uuid.UUID | None = None,
    correlation_id: str | None = None,
) -> CashMovement:
    """Cash taken out of the drawer, or put in for change, with who and why.

    It belongs to the period in which the phone recorded it, not the one in
    which the server got it: `after_close_id` is the newest close its screen
    showed. If one other close reached the server first, the movement is put
    on it (`moved_to_close`) — the cash left before that count (B5, B7 J) —
    but only while that close is the store's newest and was made at most ten
    minutes ago (`STALE_AFTER`, as a count) by the server's clock. Otherwise
    it is refused (`CLOSE_IN_BETWEEN`) and nothing is written: the phone
    settles, and the person records it again in the open period, or the owner
    or a manager names the close. The server cannot tell a genuine late resend
    from a request that names an older close only to reach a closed day,
    which is the owner's or a manager's to correct (`cash:correct`); within
    ten minutes of the close, a seller could as well have recorded the cash
    before closing, so moving it there gives nobody more than they had.

    `for_close_id`, named by the owner or a manager, records cash taken out
    and forgotten against the close it belongs to (`cash:correct`). Either
    way it explains that close's difference and leaves today's expected cash
    alone (B6.3).
    """
    moved = money(amount)
    if moved <= ZERO:
        raise ValidationFailedError("Cash moved is more than nothing", reason="NOTHING_MOVED")
    kept_note = _note(note)
    # Who: a seller records expenses and a supplier's courier; the owner and
    # managers any kind, cash put in included. Nothing in a store that does
    # not trade (G15), decided after the lookup below.
    if kind in EXPENSE_KINDS and not _granted(scope, Permission.CASH_TAKE_OUT, store_id):
        _require_granted(scope, Permission.CASH_EXPENSE, store_id)
    else:
        _require_granted(scope, Permission.CASH_TAKE_OUT, store_id)
    if for_close_id is not None:
        _require_granted(scope, Permission.CASH_CORRECT, store_id)
    # No close commits from here until this transaction ends, so the newest
    # close read below is the one that stands when the row is stamped; and
    # the store keeps the state read here.
    states = await hold_stores(session, organization_id=scope.organization_id, store_ids={store_id})
    named = await _closes_of(session, store_id, {c for c in (after_close_id, for_close_id) if c})
    await lock_command(session, organization_id=scope.organization_id, command_id=command_id)
    fingerprint = idempotency.fingerprint(
        {
            "movement": str(store_id),
            "kind": kind.value,
            "amount": str(moved),
            "note": kept_note,
            "after": str(after_close_id) if after_close_id else None,
            "for": str(for_close_id) if for_close_id else None,
        },
        actor_user_id=scope.user_id,
        store_id=store_id,
    )
    done = await session.scalar(
        select(CashMovement).where(
            CashMovement.organization_id == scope.organization_id,
            CashMovement.command_id == command_id,
        )
    )
    if done is not None:
        if done.command_fingerprint != fingerprint:
            _conflict(command_id)
        return done
    if states[store_id] is not StoreState.ACTIVE:
        _not_trading(store_id, states[store_id])
    close_id = for_close_id
    resent = False
    newest = await newest_close(session, store_id)
    if close_id is None and newest is not None and newest.id != after_close_id:
        # Recorded on the phone before a close that reached the server first:
        # the cash left before that count, so it explains that close — when
        # it is the one that followed the screen's, and a fresh one.
        following = named[after_close_id].number + 1 if after_close_id else 1
        moment = await session.scalar(select(func.clock_timestamp()))
        assert moment is not None
        if newest.number != following or moment - newest.closed_at > timedelta(seconds=STALE_AFTER):
            refuse("CLOSE_IN_BETWEEN", **await _closed_by(session, newest))
        close_id = newest.id
        resent = True
    direction = Direction.IN if kind is MovementKind.CHANGE else Direction.OUT
    movement = CashMovement(
        organization_id=scope.organization_id,
        store_id=store_id,
        kind=kind.value,
        direction=direction.value,
        amount=moved,
        note=kept_note,
        for_close_id=close_id,
        moved_to_close=resent,
        actor_user_id=scope.user_id,
        command_id=command_id,
        command_fingerprint=fingerprint,
        correlation_id=correlation_id,
    )
    session.add(movement)
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="cash.moved",
        entity_type="cash_movement",
        entity_id=movement.id,
        after={
            "kind": kind.value,
            "direction": direction.value,
            "amount": str(moved),
            "for_close_id": str(close_id) if close_id else None,
            "moved_to_close": resent,
        },
    )
    logger.info("cash.moved", movement_id=str(movement.id), store_id=str(store_id))
    return movement


# --- corrections of a way of paying (B6) ----------------------------------------


@dataclass(frozen=True, slots=True)
class MoneyRow:
    """The money row a correction is for, as its trigger checks it."""

    target: Target
    row_id: uuid.UUID
    # The drawer it went through, IN for money taken and OUT for money
    # handed back, and how much.
    store_id: uuid.UUID
    direction: Direction
    amount: Decimal
    # Its drawer period; None for a row written before revision 0035.
    period: int | None
    stated: str | None
    # Whose operation it is: the seller of a sale (an order they collected
    # included), whoever took a payment or handed money back (G16).
    owner: uuid.UUID
    # The money taken with a collected order: any of the order ways (G2).
    for_order: bool
    # The sale it belongs to.
    sale_id: uuid.UUID

    def ways(self) -> frozenset[PaymentMethod]:
        """The ways this money may have gone (B6.1)."""
        return ORDER_METHODS if self.for_order else TILL_METHODS


async def _is_order(session: AsyncSession, sale_id: uuid.UUID) -> bool:
    return (
        await session.scalar(select(CustomerOrder.id).where(CustomerOrder.sale_id == sale_id))
    ) is not None


async def money_row(
    session: AsyncSession, *, organization_id: uuid.UUID, target: Target, target_id: uuid.UUID
) -> MoneyRow:
    """Resolve what a correction names to its money row, or 404."""
    if target is Target.SALE:
        sale = await session.scalar(
            select(Sale).where(Sale.id == target_id, Sale.organization_id == organization_id)
        )
        if sale is None:
            raise NotFoundError("Unknown sale", sale_id=str(target_id))
        credit = await session.scalar(
            select(CustomerCredit).where(CustomerCredit.sale_id == sale.id)
        )
        if credit is None:
            return MoneyRow(
                target=Target.SALE,
                row_id=sale.id,
                store_id=sale.store_id,
                direction=Direction.IN,
                amount=sale.total,
                period=sale.drawer_period,
                stated=sale.payment_method,
                owner=sale.seller_user_id,
                for_order=await _is_order(session, sale.id),
                sale_id=sale.id,
            )
        # Paid in parts: the money taken with the sale is its first payment,
        # which shares the sale's command (`credit.open_credit`).
        first = await session.scalar(
            select(CreditEntry).where(
                CreditEntry.credit_id == credit.id,
                CreditEntry.kind == EntryKind.PAYMENT.value,
                CreditEntry.command_id == sale.command_id,
            )
        )
        if first is None:
            raise NotFoundError("This sale took no money", sale_id=str(target_id))
        return MoneyRow(
            target=Target.PAYMENT,
            row_id=first.id,
            store_id=first.taken_at_store_id or credit.store_id,
            direction=Direction.IN,
            amount=first.amount,
            period=first.drawer_period,
            stated=first.payment_method,
            owner=sale.seller_user_id,
            for_order=await _is_order(session, sale.id),
            sale_id=sale.id,
        )
    if target is Target.PAYMENT:
        found = (
            await session.execute(
                select(CreditEntry, CustomerCredit.store_id, Sale.id, Sale.command_id)
                .join(CustomerCredit, CustomerCredit.id == CreditEntry.credit_id)
                .join(Sale, Sale.id == CustomerCredit.sale_id)
                .where(
                    CreditEntry.id == target_id,
                    CreditEntry.organization_id == organization_id,
                    CreditEntry.kind == EntryKind.PAYMENT.value,
                )
            )
        ).first()
        if found is None:
            raise NotFoundError("Unknown payment", credit_entry_id=str(target_id))
        entry, sold_at, sale_id, sale_command = found
        return MoneyRow(
            target=Target.PAYMENT,
            row_id=entry.id,
            store_id=entry.taken_at_store_id or sold_at,
            direction=Direction.IN,
            amount=entry.amount,
            period=entry.drawer_period,
            stated=entry.payment_method,
            owner=entry.actor_user_id,
            for_order=entry.command_id == sale_command and await _is_order(session, sale_id),
            sale_id=sale_id,
        )
    returned = aliased(CreditEntry)
    found_refund = (
        await session.execute(
            select(Refund, returned.cash_back)
            .outerjoin(returned, returned.refund_id == Refund.id)
            .where(Refund.id == target_id, Refund.organization_id == organization_id)
        )
    ).first()
    if found_refund is None:
        raise NotFoundError("Unknown refund", refund_id=str(target_id))
    refund, cash_back = found_refund
    return MoneyRow(
        target=Target.REFUND,
        row_id=refund.id,
        store_id=refund.taken_at_store_id,
        direction=Direction.OUT,
        amount=refund.total_amount if cash_back is None else cash_back,
        period=refund.drawer_period,
        stated=refund.payment_method,
        owner=refund.actor_user_id,
        for_order=False,
        sale_id=refund.sale_id,
    )


async def current_way(session: AsyncSession, row: MoneyRow) -> tuple[str | None, int]:
    """The way a money row stands at now, and the `seq` of its last
    correction (0 for none): the `to_method` of the highest `seq`, never the
    newest by time or by id (B6.1)."""
    column = {
        Target.SALE: PaymentCorrection.sale_id,
        Target.PAYMENT: PaymentCorrection.credit_entry_id,
        Target.REFUND: PaymentCorrection.refund_id,
    }[row.target]
    last = (
        await session.execute(
            select(PaymentCorrection.seq, PaymentCorrection.to_method)
            .where(column == row.row_id)
            .order_by(PaymentCorrection.seq.desc())
            .limit(1)
        )
    ).first()
    if last is None:
        return row.stated, 0
    return last.to_method, last.seq


async def last_close_number(session: AsyncSession, store_id: uuid.UUID) -> int:
    """The number of the store's last close; 0 before its first."""
    return int(
        await session.scalar(
            select(func.coalesce(func.max(CashClose.number), 0)).where(
                CashClose.store_id == store_id
            )
        )
        or 0
    )


def is_closed(period: int | None, last: int) -> bool:
    """Whether a money row's period has been closed."""
    return period is not None and period <= last


def may_correct(
    scope: RequestScope, row: MoneyRow, *, last: int, state: StoreState | None = None
) -> bool:
    """Whether this person may correct this money row's way now, in a store
    that trades: the owner or a manager any row with a period, any time; a
    seller their own operation, while its period is open (B6.2, G16)."""
    if row.period is None or (state is not None and state is not StoreState.ACTIVE):
        return False
    if scope.can(Permission.CASH_CORRECT, row.store_id):
        return True
    return (
        row.owner == scope.user_id
        and scope.can(Permission.SALE_CREATE, row.store_id)
        and not is_closed(row.period, last)
    )


async def correct(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    target: Target,
    target_id: uuid.UUID,
    from_method: PaymentMethod | None,
    to_method: PaymentMethod,
    note: str | None = None,
    correlation_id: str | None = None,
) -> PaymentCorrection:
    """Correct the way one sale, payment or refund was paid, by a new row.

    `from_method` is the way the person saw (None for «не вказано»): a
    correction made meanwhile refuses this one (`PAYMENT_METHOD_CHANGED`).
    A row of the open period moves today's expected cash; a row of a closed
    period explains that close's difference instead (B6.3).
    """
    kept_note = _note(note)
    row = await money_row(
        session, organization_id=scope.organization_id, target=target, target_id=target_id
    )
    # Who (B6.2): the owner or a manager, at the drawer; otherwise a seller
    # their own operation. Nothing in a store that does not trade (G15),
    # decided after the lookup below.
    manager = _granted(scope, Permission.CASH_CORRECT, row.store_id)
    if not manager:
        scope.require(Permission.SALE_CREATE, row.store_id)
        if row.owner != scope.user_id:
            raise PermissionDeniedError(
                "A seller corrects only their own sales, payments and returns",
                permission=Permission.CASH_CORRECT.value,
                store_id=str(row.store_id),
            )
    # Before anything about closes is read: no close of this drawer commits
    # until this transaction ends, so "open or closed" decided below agrees
    # with the stamp the trigger gives the row; and the store keeps the state
    # read here.
    states = await hold_stores(
        session, organization_id=scope.organization_id, store_ids={row.store_id}
    )
    await lock_command(session, organization_id=scope.organization_id, command_id=command_id)
    fingerprint = idempotency.fingerprint(
        {
            "correct": target.value,
            "target_id": str(target_id),
            "from": from_method.value if from_method else None,
            "to": to_method.value,
            "note": kept_note,
        },
        actor_user_id=scope.user_id,
        store_id=row.store_id,
    )
    done = await session.scalar(
        select(PaymentCorrection).where(
            PaymentCorrection.organization_id == scope.organization_id,
            PaymentCorrection.command_id == command_id,
        )
    )
    if done is not None:
        if done.command_fingerprint != fingerprint:
            _conflict(command_id)
        return done
    if states[row.store_id] is not StoreState.ACTIVE:
        _not_trading(row.store_id, states[row.store_id])
    await _lock_money_row(session, organization_id=scope.organization_id, row_id=row.row_id)
    if row.period is None:
        refuse("BEFORE_DRAWER")
    current, seq = await current_way(session, row)
    last = await last_close_number(session, row.store_id)
    closed = is_closed(row.period, last)
    if closed and not manager:
        refuse("DAY_CLOSED")
    if (from_method.value if from_method else None) != current:
        raise PaymentMethodChangedError(current=current)
    if to_method.value == current:
        refuse("SAME_METHOD")
    if to_method not in row.ways():
        refuse("METHOD_NOT_FOR_THIS")
    explains = None
    if closed:
        explains = await session.scalar(
            select(CashClose.id).where(
                CashClose.store_id == row.store_id, CashClose.number == row.period
            )
        )
    correction = PaymentCorrection(
        organization_id=scope.organization_id,
        store_id=row.store_id,
        sale_id=row.row_id if row.target is Target.SALE else None,
        credit_entry_id=row.row_id if row.target is Target.PAYMENT else None,
        refund_id=row.row_id if row.target is Target.REFUND else None,
        seq=seq + 1,
        direction=row.direction.value,
        amount=row.amount,
        from_method=current,
        to_method=to_method.value,
        explains_close_id=explains,
        note=kept_note,
        actor_user_id=scope.user_id,
        command_id=command_id,
        command_fingerprint=fingerprint,
        correlation_id=correlation_id,
    )
    session.add(correction)
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="cash.corrected",
        entity_type="payment_correction",
        entity_id=correction.id,
        before={"method": current},
        after={
            "method": to_method.value,
            "target": row.target.value,
            "target_id": str(row.row_id),
            "explains_close_id": str(explains) if explains else None,
        },
        reason=kept_note,
    )
    logger.info("cash.corrected", correction_id=str(correction.id), store_id=str(row.store_id))
    return correction


__all__ = [
    "ALL_WAYS",
    "DAY_STARTS",
    "EXPENSE_KINDS",
    "NOT_STATED",
    "OTHER_WAYS",
    "REFUSALS",
    "SMALL_DIFFERENCE",
    "STALE_AFTER",
    "MoneyRow",
    "PeriodSums",
    "Target",
    "business_day",
    "cash_effect",
    "close_day",
    "correct",
    "current_way",
    "difference_of",
    "expected_cash",
    "explained_by",
    "give_reason",
    "is_closed",
    "last_close_number",
    "lock_command",
    "may_close",
    "may_correct",
    "money",
    "money_row",
    "newest_close",
    "period_sums",
    "reason_required",
    "record_movement",
    "refuse",
    "reopened_since",
    "unexplained_of",
    "way_effect",
]
