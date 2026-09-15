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

Lock order is fixed and identical in every path — the router's idempotency-row
insert first (it blocks a concurrent inserter of the same key), then the
advisory lock on the permanent command, then `sale_item` rows in id order,
then inventory keys in their own sorted order — so a refund can never hold
what another refund is waiting for.
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
    IdempotencyConflictError,
    NotFoundError,
    RefundExceedsSoldError,
    ValidationFailedError,
)
from app.core.logging import get_logger
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import (
    MovementRequest,
    apply_movements,
    refund_return_movement_ids,
)
from app.modules.refunds.models import Refund, RefundItem
from app.modules.sales.models import Sale, SaleItem, SaleStatus
from app.modules.sales.service import MAX_MONEY, money
from app.modules.tenancy.service import store_is_active

logger = get_logger(__name__)

REFUND_REFERENCE = "refund"
MAX_LINES = 100
MAX_REASON_LENGTH = 1000


@dataclass(frozen=True, slots=True)
class RefundLineInput:
    """One sold line coming back.

    `restock` is deliberately not defaulted anywhere in this stack. "The coat
    came back and goes on the rack" and "we refunded the customer and binned
    it" are both ordinary, and guessing between them silently invents or
    destroys stock.
    """

    sale_item_id: uuid.UUID
    quantity: int
    restock: bool


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

    seen: set[uuid.UUID] = set()
    for line in lines:
        if type(line.quantity) is not int or not 0 < line.quantity <= 1000:
            raise ValidationFailedError("Quantity must be an integer between 1 and 1000")
        if type(line.restock) is not bool:
            raise ValidationFailedError("restock must be stated explicitly as true or false")
        if line.sale_item_id in seen:
            # Two entries for one line would make the refundable-quantity check
            # read an aggregate that does not account for its own sibling.
            raise ValidationFailedError(
                "A sale line may appear only once in a refund",
                sale_item_id=str(line.sale_item_id),
            )
        seen.add(line.sale_item_id)

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
    return lines, note


def _fingerprint(
    *, scope: RequestScope, sale: Sale, lines: list[RefundLineInput], reason: str | None
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
                }
                for line in lines
            ],
        },
        actor_user_id=scope.user_id,
        store_id=sale.store_id,
    )


def _result(
    refund: Refund,
    items: list[RefundItem],
    sale_items: dict[uuid.UUID, SaleItem],
    movements: list[uuid.UUID],
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
        if existing.store_id in scope.store_ids and scope.can(
            Permission.SALE_REFUND, existing.store_id
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
    scope.require(Permission.SALE_REFUND, existing.store_id)
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
) -> RefundResult:
    """Take goods back against an existing sale, or raise and roll back.

    Everything below commits together or not at all: the refund, its lines, the
    stock that came back, and the audit entry that explains it.
    """
    lines, reason = _normalize(lines, reason)
    sale = await _load_sale(session, organization_id=scope.organization_id, sale_id=sale_id)

    # Re-checked here even though the router already decided: this service is
    # the command boundary for any caller that is not an HTTP request.
    scope.require(Permission.SALE_REFUND, sale.store_id)

    if sale.status is not SaleStatus.COMPLETED:
        # Nothing voids a sale yet. The guard is here so that when something
        # does, it does not silently inherit the right to be refunded too.
        raise ValidationFailedError(
            "Only a completed sale can be refunded",
            sale_id=str(sale.id),
            status=sale.status.value,
        )

    request_fingerprint = _fingerprint(scope=scope, sale=sale, lines=lines, reason=reason)
    existing = await _existing_command(
        session, scope=scope, command_id=command_id, request_fingerprint=request_fingerprint
    )
    if existing is not None:
        return existing

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

    total = Decimal("0")
    amounts: list[Decimal] = []
    for line in lines:
        sale_item = sale_items[line.sale_item_id]
        refunded = already_refunded.get(line.sale_item_id, 0)
        refundable = sale_item.quantity - refunded
        if line.quantity > refundable:
            raise RefundExceedsSoldError(
                sale_item_id=str(line.sale_item_id),
                requested=line.quantity,
                sold=sale_item.quantity,
                already_refunded=refunded,
                refundable=refundable,
            )
        # The only arithmetic in a refund. Both operands are exact, so this is
        # the amount actually charged for those units, to the kopeck.
        amount = money(sale_item.final_unit_price * line.quantity)
        amounts.append(amount)
        total += amount

    if total > MAX_MONEY:  # pragma: no cover - unreachable while refund <= sale total
        raise ValidationFailedError("Refund total is out of range")

    refund = Refund(
        organization_id=scope.organization_id,
        store_id=sale.store_id,
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
        )
        for line, amount in zip(lines, amounts, strict=True)
    ]
    session.add_all(refund_items)
    await session.flush()

    movements: list[uuid.UUID] = []
    restocked = [line for line in lines if line.restock]
    if restocked and not await store_is_active(
        session, organization_id=scope.organization_id, store_id=sale.store_id
    ):
        # A closed store can give money back; it has no shelf to put goods on,
        # and inventing one would be stock in a store that is not trading.
        # Stated here rather than inherited from `lock_stock`, which would
        # refuse this with "Unknown store" — wrong, and about a store the
        # caller is standing in (independent review, 2026-09-15).
        #
        # OPEN QUESTION for the owner: is that the right split? The alternative
        # is to refuse the whole refund, and send the customer to the store
        # that is still trading. Nothing sets `is_active = False` from the
        # application yet, so this is reachable only by an operator today.
        raise ValidationFailedError(
            "Goods cannot be returned to a store that is closed; "
            "refund without restocking, or reopen the store",
            store_id=str(sale.store_id),
        )
    if restocked:
        await apply_movements(
            session,
            organization_id=scope.organization_id,
            requests=[
                MovementRequest(
                    store_id=sale.store_id,
                    product_variant_id=sale_items[line.sale_item_id].product_variant_id,
                    size_id=sale_items[line.sale_item_id].size_id,
                    quantity_delta=line.quantity,
                    movement_type=MovementType.REFUND_RETURN,
                    reference_type=REFUND_REFERENCE,
                    reference_id=refund.id,
                )
                for line in restocked
            ],
            actor_user_id=scope.user_id,
            correlation_id=correlation_id,
        )
        movements = await refund_return_movement_ids(
            session, organization_id=scope.organization_id, refund_id=refund.id
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
                str(line.sale_item_id): already_refunded.get(line.sale_item_id, 0) for line in lines
            },
        },
        after={
            "refund_id": str(refund.id),
            "total_amount": str(refund.total_amount),
            "currency_code": refund.currency_code,
            "refunded_now": {str(line.sale_item_id): line.quantity for line in lines},
            "restocked": sorted(str(line.sale_item_id) for line in restocked),
        },
        reason=reason,
    )

    logger.info(
        "refund.created",
        refund_id=str(refund.id),
        sale_id=str(sale.id),
        store_id=str(sale.store_id),
        lines=len(refund_items),
        restocked=len(restocked),
        total=str(refund.total_amount),
    )

    return _result(refund, refund_items, sale_items, movements)


__all__ = [
    "RefundLineInput",
    "RefundResult",
    "RefundedLine",
    "create_refund",
    "sale_store_id",
]
