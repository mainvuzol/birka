"""The refund command.

A refund never edits the sale. It is a compensating operation written beside
it (`.ai/skills/compensating-operations.md`): the `Sale` and its `SaleItem`
rows are read, locked and left byte-identical, and what changes is a new
`Refund` plus — where the goods actually came back — stock movements that say
so. Invariant I8 is therefore structural here rather than a rule to remember:
this module may not import the catalog (ADR-0001 permits
`refunds → sales, inventory, authz, tenancy, core`, and an import-linter
contract enforces it), so there is no path by which a later rename or re-price
could reach a historical receipt. It does reach catalog rows *underneath*
`inventory.service`, which validates that a stock key still exists before
restocking — that is a present-day stock question, never a money or label one.

**Money comes from history, never from the client.** The refundable amount of
a line is its frozen `final_unit_price` times the quantity coming back. The
request says *how many*, never *how much*. `final_unit_price` is already
`NUMERIC(12,2)` and the quantity is an integer, so the product is exact and a
full refund sums to exactly the sale's total — no rounding drift, nothing to
reconcile.

**Over-refunding is prevented by a row lock, not by a read.** `refund ≤ sold −
already refunded` (invariant I9) is a check-then-act on the aggregate of every
prior refund of that line, so two simultaneous refunds would both pass it if
each read a stale total. The sale's own `sale_item` rows are taken
`FOR UPDATE`, in id order, before that aggregate is read: the second refund
blocks until the first commits, then sees it. The sale line is the natural
serialization point because it is exactly what the invariant is about.

**Every unit that comes back is stated intact or damaged** (owner decisions,
2026-09-15 §3 and 2026-10-01). Intact goes back to the warehouse the line was
sold from; damaged goes to the store's own «Брак», where nothing sells. One
sale line may come back in parts, one per condition, and every part counts
towards what is still returnable. The destination is derived — from the
sale line, or from the store's setup — and accepted from the client in one
case only, below.

**Any store of the network may take the goods back** (owner decisions,
2026-10-01). The store taking them hands the money back and is recorded as
`taken_at_store_id`; `store_id` stays the store that sold. Damaged goods go
to the «Брак» of the store taking them, where they were handed back. Intact
goods go back where they were sold from when that store reaches it; when it
does not — another store's own warehouse — the seller chooses one of their
own store's, and that choice is the one destination a client ever states.

**Money handed back goes the way the sale was paid, unless the seller
changes it** (owner decisions, 2026-10-04): the refund says how, one of the
till's three ways, and money returned to a card does not leave the drawer.
Optional in the request and required of a new refund after the replay
lookup, so a return a phone kept from before the way was asked still replays
(ADR-0012, B2, B13). A return of a sale paid in parts that only lowers its
debt moves no money: it needs no way and is stored with none (ADR-0012, G35).

Lock order is fixed and identical in every path — the router's idempotency-row
insert first (it blocks a concurrent inserter of the same key), then the
advisory lock on the permanent command, then `sale_item` rows in id order,
then the debt of a sale paid in parts, then inventory keys in their own
sorted order — so a refund can never hold what another refund is waiting for.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import (
    DamagedReturnsUnavailableError,
    IdempotencyConflictError,
    NotFoundError,
    RefundExceedsSoldError,
    ValidationFailedError,
    nothing_recorded,
)
from app.core.logging import get_logger
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.credit.service import (
    ReturnSettlement,
    credited_sales,
    money_back,
    return_settlement,
    settle_return,
)
from app.modules.damaged.service import DamagedPart, register
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import (
    MovementRequest,
    apply_movements,
    current_variants,
    refund_return_movement_ids,
)
from app.modules.refunds.models import Refund, RefundItem, ReturnCondition
from app.modules.sales.models import Sale, SaleItem, SaleStatus
from app.modules.sales.payment import TILL_METHODS, PaymentMethod, print_of, stated_way
from app.modules.sales.service import MAX_MONEY, money
from app.modules.tenancy.service import (
    LocationCapability,
    back_on_sale_locations,
    damaged_returns_location,
    hold_trading_stores,
    sold_from,
    validate_active_stores,
)

logger = get_logger(__name__)

REFUND_REFERENCE = "refund"
MAX_LINES = 100
MAX_REASON_LENGTH = 1000


@dataclass(frozen=True, slots=True)
class RefundLineInput:
    """One sold line coming back.

    `restock` is deliberately not defaulted anywhere in this stack. "The coat
    came back" and "we gave the money back for a coat that did not" are
    different facts, and guessing between them silently invents or destroys
    stock. Nor is `condition`: every unit that came back is stated intact or
    damaged, and a unit that did not come back has no condition to state.
    """

    sale_item_id: uuid.UUID
    quantity: int
    restock: bool
    condition: ReturnCondition | None = None
    # Where an intact part goes when the store taking it back does not reach
    # the warehouse it was sold from, and only then (owner decision,
    # 2026-10-01).
    location_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class RefundedLine:
    refund_item: RefundItem
    sale_item: SaleItem


@dataclass(frozen=True, slots=True)
class RefundResult:
    refund: Refund
    lines: list[RefundedLine]
    # `REFUND_RETURN` movements written because goods came back, in the same
    # flat shape `SaleResult.corrections` uses. Not paired to individual lines:
    # one sale may hold two lines of the same variant and size, so the pairing
    # would not survive being read back from the ledger.
    movements: list[uuid.UUID]
    # A sale paid in parts: how the goods' worth split between what was owed
    # and cash back (owner decision, 2026-10-01). None for one paid in full,
    # whose `total_amount` is the cash back.
    credit: ReturnSettlement | None = None


async def _load_sale(
    session: AsyncSession, *, organization_id: uuid.UUID, sale_id: uuid.UUID
) -> Sale:
    """The sale, or a 404 that cannot distinguish another tenant's from absent."""
    sale = await session.scalar(
        select(Sale).where(Sale.id == sale_id, Sale.organization_id == organization_id)
    )
    if sale is None:
        raise NotFoundError("Sale not found", sale_id=str(sale_id))
    return sale


async def sale_store_id(
    session: AsyncSession, *, organization_id: uuid.UUID, sale_id: uuid.UUID
) -> uuid.UUID:
    """Which store's authority governs refunding this sale.

    The router needs this before it may claim an idempotency key (invariant
    I13), and the store is a property of the sale rather than something the
    client gets to assert.
    """
    return (await _load_sale(session, organization_id=organization_id, sale_id=sale_id)).store_id


def _normalize(
    lines: list[RefundLineInput], reason: str | None
) -> tuple[list[RefundLineInput], str | None]:
    """Reject at the service boundary what the HTTP schema also rejects.

    The service is callable directly — by a future Telegram command handler, by
    a test — so it validates for itself rather than trusting a caller to have
    arrived through the router.
    """
    if not lines:
        raise ValidationFailedError("A refund must contain at least one line")
    if len(lines) > MAX_LINES:
        raise ValidationFailedError(f"A refund may not contain more than {MAX_LINES} lines")

    seen: set[tuple[uuid.UUID, ReturnCondition | None]] = set()
    normalized: list[RefundLineInput] = []
    for line in lines:
        if type(line.quantity) is not int or not 0 < line.quantity <= 1000:
            raise ValidationFailedError("Quantity must be an integer between 1 and 1000")
        if type(line.restock) is not bool:
            raise ValidationFailedError("restock must be stated explicitly as true or false")
        condition = _condition(line)
        part = (line.sale_item_id, condition)
        if part in seen:
            # A line comes back in parts, one per condition. Two parts in the
            # same condition are one part written twice.
            raise ValidationFailedError(
                "A sale line may appear only once per condition in a refund",
                sale_item_id=str(line.sale_item_id),
            )
        seen.add(part)
        if line.location_id is not None and condition is not ReturnCondition.INTACT:
            raise ValidationFailedError(
                "Only intact goods coming back are put in a warehouse of one's choosing",
                sale_item_id=str(line.sale_item_id),
            )
        normalized.append(
            RefundLineInput(
                sale_item_id=line.sale_item_id,
                quantity=line.quantity,
                restock=line.restock,
                condition=condition,
                location_id=line.location_id,
            )
        )

    note = reason.strip() if reason is not None else None
    if note is not None:
        if not is_storable(note):
            # A NUL or a lone surrogate. Either one makes the driver raise
            # mid-write, turning a 422 into a 500 (app/core/text.py).
            raise ValidationFailedError("A refund reason contains characters that cannot be stored")
        if not note:
            note = None
        elif len(note) > MAX_REASON_LENGTH:
            raise ValidationFailedError(
                f"A refund reason may not exceed {MAX_REASON_LENGTH} characters"
            )
    return normalized, note


def _condition(line: RefundLineInput) -> ReturnCondition | None:
    """The stated condition, which goods that came back must have and goods
    that did not must not."""
    if not line.restock:
        if line.condition is not None:
            raise ValidationFailedError(
                "Goods that did not come back have no condition to state",
                sale_item_id=str(line.sale_item_id),
            )
        return None
    try:
        if line.condition is None:
            raise ValueError
        return ReturnCondition(line.condition)
    except ValueError:
        raise ValidationFailedError(
            "Say whether each unit that came back is INTACT or DAMAGED",
            sale_item_id=str(line.sale_item_id),
        ) from None


async def damaged_destination(
    session: AsyncSession, *, organization_id: uuid.UUID, store_id: uuid.UUID
) -> uuid.UUID:
    """The store's «Брак», or a refusal: damaged goods never go anywhere that
    sells (owner decision, 2026-10-01)."""
    location = await damaged_returns_location(
        session, organization_id=organization_id, store_id=store_id
    )
    if location is None:
        raise DamagedReturnsUnavailableError(reason="NOT_SET_UP", store_id=str(store_id))
    if await sold_from(session, organization_id=organization_id, location_id=location):
        raise DamagedReturnsUnavailableError(
            reason="SOLD_FROM", store_id=str(store_id), location_id=str(location)
        )
    return location


async def _elsewhere(
    session: AsyncSession, *, organization_id: uuid.UUID, sale: Sale, taking: uuid.UUID
) -> set[uuid.UUID] | None:
    """Where the store taking goods back may put them back on sale, when it is
    not the store that sold them; None when it is, and nothing changes."""
    if taking == sale.store_id:
        return None
    # A store of this network, and trading: a blocked or archived one takes
    # nothing back, its own sales included (owner decisions, 2026-10-01).
    await validate_active_stores(session, organization_id=organization_id, store_ids={taking})
    return await back_on_sale_locations(session, organization_id=organization_id, store_id=taking)


def _destination(
    line: RefundLineInput,
    sale_item: SaleItem,
    damaged: uuid.UUID | None,
    elsewhere: set[uuid.UUID] | None = None,
) -> uuid.UUID | None:
    """Where this part goes: nowhere, «Брак», back where it was sold from, or
    — taken back at a store that does not reach that warehouse — where the
    seller chose."""
    if not line.restock:
        return None
    if line.condition is ReturnCondition.DAMAGED:
        return damaged
    if elsewhere is None or sale_item.source_location_id in elsewhere:
        return sale_item.source_location_id
    return line.location_id


def _check_choices(
    lines: list[RefundLineInput],
    sale_items: dict[uuid.UUID, SaleItem],
    elsewhere: set[uuid.UUID] | None,
) -> None:
    """A warehouse is chosen exactly when the store taking the goods back does
    not reach the one they were sold from, and is then one of its own."""
    for line in lines:
        sale_item = sale_items.get(line.sale_item_id)
        if sale_item is None or not line.restock or line.condition is ReturnCondition.DAMAGED:
            continue
        sold_from_here = elsewhere is None or sale_item.source_location_id in elsewhere
        if sold_from_here:
            if line.location_id not in (None, sale_item.source_location_id):
                raise ValidationFailedError(
                    "Intact goods go back to the warehouse they were sold from",
                    reason="SOLD_FROM",
                    sale_item_id=str(line.sale_item_id),
                    sold_from_location_id=str(sale_item.source_location_id),
                )
        elif line.location_id is None:
            raise ValidationFailedError(
                "This store does not reach the warehouse the goods were sold from; "
                "choose one of its own",
                reason="CHOOSE_A_WAREHOUSE",
                sale_item_id=str(line.sale_item_id),
                sold_from_location_id=str(sale_item.source_location_id),
            )
        elif elsewhere is not None and line.location_id not in elsewhere:
            raise ValidationFailedError(
                "Goods go back on sale in a warehouse this store receives into, never «Брак»",
                reason="NOT_A_WAREHOUSE_OF_THIS_STORE",
                sale_item_id=str(line.sale_item_id),
                location_id=str(line.location_id),
            )


def _fingerprint(
    *,
    scope: RequestScope,
    sale: Sale,
    lines: list[RefundLineInput],
    reason: str | None,
    sale_items: dict[uuid.UUID, SaleItem],
    damaged: uuid.UUID | None,
    taking: uuid.UUID,
    elsewhere: set[uuid.UUID] | None,
    payment_method: PaymentMethod | None,
) -> str:
    """Everything that makes this refund *this* refund.

    `sale_id` is in here because it is a path parameter rather than a body
    field: without it, the same key and body aimed at a different sale would
    look like a retry and replay an answer about someone else's receipt.
    """
    return idempotency.fingerprint(
        {
            "sale_id": str(sale.id),
            "reason": reason,
            "lines": [
                {
                    "sale_item_id": str(line.sale_item_id),
                    "quantity": line.quantity,
                    "restock": line.restock,
                    # Only when stated, so a refund of goods that did not come
                    # back still has the fingerprint it had before conditions.
                    **({"condition": line.condition.value} if line.condition else {}),
                }
                for line in lines
            ],
            # The destination is derived — from the sale line, or from the
            # store's «Брак» — never sent by the client. It still belongs in
            # the permanent fingerprint, so a retry cannot silently restock a
            # different warehouse if either were ever to change.
            "destinations": sorted(
                str(destination)
                for line in lines
                if line.sale_item_id in sale_items
                and (
                    destination := _destination(
                        line, sale_items[line.sale_item_id], damaged, elsewhere
                    )
                )
                is not None
            ),
            # Only when taken at another store, so every earlier refund keeps
            # the fingerprint it had.
            **({"taken_at_store_id": str(taking)} if taking != sale.store_id else {}),
            # The same for how the money goes back: none on a return kept from
            # before it was asked (ADR-0012, B13).
            **print_of(payment_method),
        },
        actor_user_id=scope.user_id,
        store_id=sale.store_id,
    )


def _result(
    refund: Refund,
    items: list[RefundItem],
    sale_items: dict[uuid.UUID, SaleItem],
    movements: list[uuid.UUID],
    credit: ReturnSettlement | None = None,
) -> RefundResult:
    """Assemble a result in the one canonical order.

    Creation and durable replay both come through here, ordered the way
    `_read_refund` reads rows back, so a replay returns what the original
    returned. Lines are ordered by the sale line they refund rather than by the
    order the request listed them: nothing persists the request's order, so
    honouring it would make the answer depend on which path produced it —
    and the rebuild path is the *only* one for a refund created off HTTP,
    whose `response_snapshot` is never written.
    """
    return RefundResult(
        refund=refund,
        lines=[
            RefundedLine(refund_item=item, sale_item=sale_items[item.sale_item_id])
            for item in sorted(items, key=lambda item: (str(item.sale_item_id), str(item.id)))
        ],
        movements=movements,
        credit=credit,
    )


async def _read_refund(session: AsyncSession, refund: Refund) -> RefundResult:
    """Rebuild a refund result from committed rows, for a durable replay."""
    items = list(
        (
            await session.scalars(
                select(RefundItem)
                .where(RefundItem.refund_id == refund.id)
                .order_by(RefundItem.sale_item_id, RefundItem.id)
            )
        ).all()
    )
    sale_items = {
        item.id: item
        for item in (
            await session.scalars(
                select(SaleItem).where(SaleItem.id.in_([item.sale_item_id for item in items]))
            )
        ).all()
    }
    return _result(
        refund,
        items,
        sale_items,
        await refund_return_movement_ids(
            session, organization_id=refund.organization_id, refund_id=refund.id
        ),
        await return_settlement(session, refund_id=refund.id),
    )


async def _existing_command(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    request_fingerprint: str,
) -> RefundResult | None:
    """Durable replay: has this permanent command already produced a refund?

    Taken before any row lock, and only ever serializes two requests carrying
    the same `command_id` — which are by definition the same business
    operation. A hash collision costs two unrelated commands a short wait; the
    identity decision below still uses the exact UUID pair.
    """
    lock_key = int.from_bytes(
        hashlib.sha256(scope.organization_id.bytes + command_id.bytes).digest()[:8],
        byteorder="big",
        signed=True,
    )
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
    existing = await session.scalar(
        select(Refund).where(
            Refund.organization_id == scope.organization_id, Refund.command_id == command_id
        )
    )
    if existing is None:
        return None
    if existing.command_fingerprint != request_fingerprint:
        # Same permanent command, different request. Never execute: one of the
        # two payloads is a client bug, and guessing which would refund money
        # nobody asked to refund. A NULL fingerprint — a refund taken while
        # revision 0004 was rolled back — is the same refusal for a different
        # reason: there is nothing to compare, and a retry is not something to
        # assume.
        details = {"command_id": str(command_id)}
        if existing.taken_at_store_id in scope.store_ids and scope.can(
            Permission.SALE_REFUND, existing.taken_at_store_id
        ):
            details["refund_id"] = str(existing.id)
        raise IdempotencyConflictError(
            "The original request for this existing refund cannot be verified"
            if existing.command_fingerprint is None
            else "This command_id was already used with a different request",
            **details,
        )
    # The right to replay is the right to have issued the command, not a
    # stricter one: a client that timed out must be able to learn the outcome
    # of its own authorized refund (independent review, 2026-09-15).
    scope.require(Permission.SALE_REFUND, existing.taken_at_store_id)
    return await _read_refund(session, existing)


async def create_refund(
    session: AsyncSession,
    *,
    scope: RequestScope,
    sale_id: uuid.UUID,
    command_id: uuid.UUID,
    lines: list[RefundLineInput],
    reason: str | None = None,
    correlation_id: str | None = None,
    at_store_id: uuid.UUID | None = None,
    payment_method: PaymentMethod | None = None,
    method_required: bool = True,
) -> RefundResult:
    """Take goods back against an existing sale, or raise and roll back.

    `at_store_id` is the store taking them back, when it is not the one that
    sold (owner decisions, 2026-10-01).

    `payment_method` is how the money goes back, one of the till's three
    ways. A new refund without it is refused right after the replay lookup,
    before its lines are checked — for a sale paid in parts only once the
    split shows money going back (ADR-0012, B2, G35). `method_required=False`
    is for this service's unit tests only.

    Everything below commits together or not at all: the refund, its lines, the
    stock that came back, and the audit entry that explains it.
    """
    lines, reason = _normalize(lines, reason)
    sale = await _load_sale(session, organization_id=scope.organization_id, sale_id=sale_id)

    # Re-checked here even though the router already decided: this service is
    # the command boundary for any caller that is not an HTTP request. The
    # authority is the store taking the goods back, whichever store sold.
    taking = at_store_id or sale.store_id
    scope.require(Permission.SALE_REFUND, taking)
    # Only a trading store takes anything back, its own sales included: a
    # blocked or archived one does nothing, and its customers go to another
    # (owner decisions, 2026-10-01). Held until commit, so a store blocked in
    # the meantime waits for this return or refuses it.
    await hold_trading_stores(session, organization_id=scope.organization_id, store_ids={taking})

    if sale.status is not SaleStatus.COMPLETED:
        # Nothing voids a sale yet. The guard is here so that when something
        # does, it does not silently inherit the right to be refunded too.
        raise ValidationFailedError(
            "Only a completed sale can be refunded",
            sale_id=str(sale.id),
            status=sale.status.value,
        )

    # The sale's lines are read before the fingerprint, because the fingerprint
    # now includes each refunded line's destination warehouse, and that is a
    # property of the sale rather than of the request. This read takes no lock;
    # the authoritative locked read follows below.
    preview = {
        item.id: item
        for item in (
            await session.scalars(select(SaleItem).where(SaleItem.sale_id == sale.id))
        ).all()
    }
    elsewhere = await _elsewhere(
        session, organization_id=scope.organization_id, sale=sale, taking=taking
    )
    _check_choices(lines, preview, elsewhere)
    # Damaged goods stay where they were handed back: the «Брак» of the store
    # taking them (owner decision, 2026-10-01).
    damaged = (
        await damaged_destination(session, organization_id=scope.organization_id, store_id=taking)
        if any(line.condition is ReturnCondition.DAMAGED for line in lines)
        else None
    )
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.SALE_REFUND,
        store_id=taking,
        location_ids={
            destination
            for line in lines
            if line.sale_item_id in preview
            and (destination := _destination(line, preview[line.sale_item_id], damaged, elsewhere))
            is not None
        },
        capability=LocationCapability.RECEIVE,
    )
    request_fingerprint = _fingerprint(
        scope=scope,
        sale=sale,
        lines=lines,
        reason=reason,
        sale_items=preview,
        damaged=damaged,
        taking=taking,
        elsewhere=elsewhere,
        payment_method=payment_method,
    )
    existing = await _existing_command(
        session, scope=scope, command_id=command_id, request_fingerprint=request_fingerprint
    )
    if existing is not None:
        return existing
    # Under the command's lock, and no refund under it: every refusal from
    # here on proves this return recorded nothing, and says so, so a phone
    # that never heard its answer can settle it (ADR-0008 §9, ADR-0013 §1).
    # Those that already said so keep saying it.
    with nothing_recorded():
        # A way stated must be one of the till's in any case.
        method = stated_way(payment_method, takes=TILL_METHODS, required=False)
        # A sale paid in full hands all of the goods' worth back as money, so a
        # new refund of one says how before anything else is checked (ADR-0012,
        # B2): an attempt a phone kept from before the way was asked is refused
        # `PAYMENT_METHOD_REQUIRED` and settles, whatever happened to its lines
        # since (B13). One paid in parts needs a way only once the split below
        # shows money going back (G35). Whether a sale was paid in parts was
        # settled when it was sold.
        if method is None and sale.id not in await credited_sales(session, sale_ids=[sale.id]):
            stated_way(method, takes=TILL_METHODS, required=method_required)

        # Lock the whole sale's lines, in id order, before reading how much of it
        # has already been refunded. Every refund of this sale takes the same rows
        # in the same order, so they serialize instead of racing (invariant I9).
        sale_items = {
            item.id: item
            for item in (
                await session.scalars(
                    select(SaleItem)
                    .where(SaleItem.sale_id == sale.id)
                    .order_by(SaleItem.id)
                    .with_for_update()
                )
            ).all()
        }
        for line in lines:
            if line.sale_item_id not in sale_items:
                # Scoped to this sale, so a line belonging to another receipt — or
                # to another tenant's — is simply not found.
                raise NotFoundError(
                    "Sale line not found on this sale",
                    sale_id=str(sale.id),
                    sale_item_id=str(line.sale_item_id),
                )

        already_refunded = {
            sale_item_id: int(quantity)
            for sale_item_id, quantity in (
                await session.execute(
                    select(RefundItem.sale_item_id, func.sum(RefundItem.quantity))
                    .where(RefundItem.sale_item_id.in_(list(sale_items)))
                    .group_by(RefundItem.sale_item_id)
                )
            ).all()
        }

        # Every part of a line counts: two intact and one damaged is three back.
        requested: dict[uuid.UUID, int] = {}
        for line in lines:
            requested[line.sale_item_id] = requested.get(line.sale_item_id, 0) + line.quantity
        for sale_item_id, quantity in requested.items():
            sale_item = sale_items[sale_item_id]
            refunded = already_refunded.get(sale_item_id, 0)
            refundable = sale_item.quantity - refunded
            if quantity > refundable:
                # After the command's lock and lookup, so it proves this command
                # wrote nothing, and says so (ADR-0008 §9): a phone that never
                # heard whether its attempt went through settles it, though a
                # colleague took the same goods back meanwhile.
                raise RefundExceedsSoldError(
                    sale_item_id=str(sale_item_id),
                    requested=quantity,
                    sold=sale_item.quantity,
                    already_refunded=refunded,
                    refundable=refundable,
                    recorded=False,
                )

        total = Decimal("0")
        amounts: list[Decimal] = []
        for line in lines:
            sale_item = sale_items[line.sale_item_id]
            # The only arithmetic in a refund. Both operands are exact, so this is
            # the amount actually charged for those units, to the kopeck.
            amount = money(sale_item.final_unit_price * line.quantity)
            amounts.append(amount)
            total += amount

        if total > MAX_MONEY:  # pragma: no cover - unreachable while refund <= sale total
            raise ValidationFailedError("Refund total is out of range")

        # A sale paid in parts: how much of the goods' worth goes back as money
        # rather than off the debt. Locked here, after the sale's lines, and split
        # the same way by `settle_return` below. None for a sale paid in full,
        # where all of it goes back.
        back = await money_back(
            session, organization_id=scope.organization_id, sale_id=sale.id, worth=money(total)
        )
        moves_money = back is None or back > 0
        if back is not None and moves_money:
            stated_way(method, takes=TILL_METHODS, required=method_required)

        refund = Refund(
            organization_id=scope.organization_id,
            store_id=sale.store_id,
            taken_at_store_id=taking,
            sale_id=sale.id,
            actor_user_id=scope.user_id,
            command_id=command_id,
            command_fingerprint=request_fingerprint,
            # The sale's currency, not the configured one: a receipt is refunded in
            # what it was paid in.
            currency_code=sale.currency_code,
            total_amount=money(total),
            reason=reason,
            correlation_id=correlation_id,
            # Only when money goes back: a return that only lowered a debt moved
            # none, whatever the screen had preselected (ADR-0012, G35).
            payment_method=method.value if method is not None and moves_money else None,
        )
        session.add(refund)
        await session.flush()

        refund_items = [
            RefundItem(
                refund_id=refund.id,
                sale_item_id=line.sale_item_id,
                quantity=line.quantity,
                amount=amount,
                restock=line.restock,
                condition=line.condition.value if line.condition else None,
                destination_location_id=_destination(
                    line, sale_items[line.sale_item_id], damaged, elsewhere
                ),
            )
            for line, amount in zip(lines, amounts, strict=True)
        ]
        session.add_all(refund_items)
        await session.flush()
        # Taken after the sale's lines are locked, so two returns of one sale
        # split its debt one after the other.
        credit = await settle_return(
            session,
            organization_id=scope.organization_id,
            sale_id=sale.id,
            refund_id=refund.id,
            worth=refund.total_amount,
            actor_user_id=scope.user_id,
            correlation_id=correlation_id,
        )

        movements: list[uuid.UUID] = []
        restocked = [
            (line, item) for line, item in zip(lines, refund_items, strict=True) if line.restock
        ]
        # Goods come back as the model that stands now: an old sale of a model
        # merged since comes back as the model that stays (owner decision,
        # 2026-10-03). Held as a stock command holds a model, so a merge cannot
        # take it away before the goods land. The sale line keeps its own.
        leading = await current_variants(
            session,
            organization_id=scope.organization_id,
            variant_ids={sale_items[line.sale_item_id].product_variant_id for line in lines},
        )
        # Owner decision, 2026-09-17: goods go back to the warehouse the sale line
        # drew them from. Returning them anywhere else is a return plus a transfer,
        # and must be two explicit operations (invariant I16) — with the one
        # exception the owner made on 2026-10-01: a damaged unit goes to the
        # store's «Брак», so it is never back on sale.
        if restocked:
            await apply_movements(
                session,
                organization_id=scope.organization_id,
                requests=[
                    MovementRequest(
                        location_id=item.destination_location_id,
                        acting_store_id=taking,
                        product_variant_id=leading[
                            sale_items[line.sale_item_id].product_variant_id
                        ],
                        size_id=sale_items[line.sale_item_id].size_id,
                        quantity_delta=line.quantity,
                        movement_type=MovementType.REFUND_RETURN,
                        reference_type=REFUND_REFERENCE,
                        reference_id=refund.id,
                    )
                    for line, item in restocked
                    if item.destination_location_id is not None
                ],
                actor_user_id=scope.user_id,
                correlation_id=correlation_id,
                # A damaged part goes into the store's «Брак», which only a
                # return taken damaged and the «Брак» section may fill.
                damaged_stock=damaged is not None,
            )
            movements = await refund_return_movement_ids(
                session, organization_id=scope.organization_id, refund_id=refund.id
            )

        if damaged is not None:
            # Each unit returned damaged is one row in «Брак», to be inspected
            # (owner decision, 2026-10-01).
            await register(
                session,
                organization_id=scope.organization_id,
                store_id=taking,
                location_id=damaged,
                parts=[
                    DamagedPart(
                        refund_item_id=item.id,
                        product_variant_id=leading[
                            sale_items[item.sale_item_id].product_variant_id
                        ],
                        size_id=sale_items[item.sale_item_id].size_id,
                        sold_from_location_id=sale_items[item.sale_item_id].source_location_id,
                        display_name=sale_items[item.sale_item_id].display_name_snapshot,
                        size_label=sale_items[item.sale_item_id].variant_snapshot.get("size"),
                        quantity=item.quantity,
                    )
                    for item in refund_items
                    if item.condition == ReturnCondition.DAMAGED.value
                ],
            )

        await audit.record(
            session,
            organization_id=scope.organization_id,
            actor_user_id=scope.user_id,
            action="sale.refunded",
            entity_type="refund",
            entity_id=refund.id,
            before={
                "sale_id": str(sale.id),
                "refunded_before": {
                    str(line.sale_item_id): already_refunded.get(line.sale_item_id, 0)
                    for line in lines
                },
            },
            after={
                "refund_id": str(refund.id),
                "total_amount": str(refund.total_amount),
                "currency_code": refund.currency_code,
                **({"taken_at_store_id": str(taking)} if taking != sale.store_id else {}),
                **(
                    {
                        "debt_reduced": str(credit.debt_reduced),
                        "cash_back": str(credit.cash_back),
                    }
                    if credit is not None
                    else {}
                ),
                "refunded_now": {
                    str(sale_item_id): quantity for sale_item_id, quantity in requested.items()
                },
                "restocked": sorted({str(line.sale_item_id) for line, _ in restocked}),
                "damaged": {
                    str(line.sale_item_id): line.quantity
                    for line in lines
                    if line.condition is ReturnCondition.DAMAGED
                },
            },
            reason=reason,
        )

        logger.info(
            "refund.created",
            refund_id=str(refund.id),
            sale_id=str(sale.id),
            store_id=str(sale.store_id),
            taken_at_store_id=str(taking),
            lines=len(refund_items),
            restocked=len(restocked),
            total=str(refund.total_amount),
            payment_method=refund.payment_method,
        )

        return _result(refund, refund_items, sale_items, movements, credit)


async def refunded_quantities(
    session: AsyncSession, *, sale_item_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """How much of each sale line has already come back, in every part and
    condition — what a seller must see before taking another return."""
    if not sale_item_ids:
        return {}
    return {
        sale_item_id: int(quantity)
        for sale_item_id, quantity in (
            await session.execute(
                select(RefundItem.sale_item_id, func.sum(RefundItem.quantity))
                .where(RefundItem.sale_item_id.in_(sale_item_ids))
                .group_by(RefundItem.sale_item_id)
            )
        ).all()
    }


__all__ = [
    "RefundLineInput",
    "RefundResult",
    "RefundedLine",
    "create_refund",
    "damaged_destination",
    "refund_destinations",
    "refunded_quantities",
    "sale_store_id",
]


async def refund_destinations(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    sale_id: uuid.UUID,
    store_id: uuid.UUID,
    lines: list[RefundLineInput],
) -> set[uuid.UUID]:
    """Where the goods coming back would go, taken back at `store_id`: the
    warehouse each intact part was sold from — or the one chosen, at a store
    that does not reach it — and that store's «Брак» for damaged parts.

    Read from the sale and the store's setup, because that is where the
    answer lives. Exposed so the router can check the store's access to those
    warehouses *before* it claims an idempotency key, which is what stops a
    revoked grant from replaying a cached success.

    Unknown ids, and a choice that is missing or not allowed, are simply
    absent: the authoritative validation happens in the command, under the
    sale's own row locks.
    """
    sale = await _load_sale(session, organization_id=organization_id, sale_id=sale_id)
    elsewhere = await _elsewhere(
        session, organization_id=organization_id, sale=sale, taking=store_id
    )
    intact = {
        line.sale_item_id
        for line in lines
        if line.restock and line.condition is not ReturnCondition.DAMAGED
    }
    sale_items = (
        {
            item.id: item
            for item in (
                await session.scalars(
                    select(SaleItem).where(SaleItem.sale_id == sale.id, SaleItem.id.in_(intact))
                )
            ).all()
        }
        if intact
        else {}
    )
    destinations = {
        destination
        for line in lines
        if line.sale_item_id in sale_items
        and line.condition is not ReturnCondition.DAMAGED
        and (destination := _destination(line, sale_items[line.sale_item_id], None, elsewhere))
        is not None
        # A choice the command will refuse is not checked for access first.
        and (elsewhere is None or destination in elsewhere)
    }
    if any(line.restock and line.condition is ReturnCondition.DAMAGED for line in lines):
        destinations.add(
            await damaged_destination(session, organization_id=organization_id, store_id=store_id)
        )
    return destinations
