"""What a store owes its suppliers: invoices, payments, set-offs, write-offs.

See `models.py` for the owner's decisions of 2026-10-01. Nothing here moves
goods: an invoice is recorded on its own, never with a delivery, and a
set-off only names a return that already moved them.

**Every command locks the invoice's row** before reading what is owed, so
two payments, or a payment and a set-off, never both see the same debt and
both lower it (as a customer's debt is locked, `credit.service`).

**Safe to repeat.** An invoice, a payment, a set-off and a write-off are
named by the client's permanent `command_id` (I20): the same command is
answered with the invoice as it stands, however late. A cancellation needs
no name of its own: it happens once, and asking again answers with the
invoice as it is.

**Who.** The owner and managers (`supplier:debt`) in the store that owes;
the owner alone writes off (`supplier:write_off`). The permission is checked
before anything already done is answered, so a person who lost it learns
nothing from a replay.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import (
    IdempotencyConflictError,
    NotFoundError,
    StoreNotTradingError,
    ValidationFailedError,
)
from app.core.logging import get_logger
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.identity.models import AppUser
from app.modules.suppliers.common import (
    Cancellation,
    SupplierView,
    clean_note,
    clean_reason,
    supplier_view,
)
from app.modules.suppliers.models import (
    InvoiceEntryKind,
    InvoiceStatus,
    Supplier,
    SupplierInvoice,
    SupplierInvoiceCancel,
    SupplierInvoiceEntry,
    SupplierInvoiceEntryCancel,
    SupplierReturn,
    SupplierReturnCancel,
)
from app.modules.tenancy.models import Store, StoreState
from app.modules.tenancy.service import hold_stores, hold_trading_stores, store_names, store_state

logger = get_logger(__name__)

ZERO = Decimal("0.00")
CENTS = Decimal("0.01")
# What the money columns hold: 12 digits, two of them after the point.
MAX_AMOUNT = Decimal("9999999999.99")


def money(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


@dataclass(frozen=True, slots=True)
class SoldLot:
    """Borrowed goods, or goods under consignment, sold: an invoice for them
    names their lot (`borrowed.py`, which knows lots; this module does not)."""

    stock_lot_id: uuid.UUID
    quantity: int
    # What they were called when sold: kept, so the invoice reads the same
    # however the catalogue changes. Not part of the command's fingerprint.
    label: str


@dataclass(frozen=True, slots=True)
class SetOffView:
    """Goods returned to a supplier, counted against one invoice."""

    invoice_id: uuid.UUID
    entry_id: uuid.UUID
    amount: Decimal
    at: datetime


@dataclass(frozen=True, slots=True)
class EntryView:
    id: uuid.UUID
    kind: InvoiceEntryKind
    amount: Decimal
    at: datetime
    by: str
    # A write-off's reason.
    note: str | None
    # A payment made by another store, because the one that owes did not
    # trade: that store's name.
    paid_at: str | None
    # A set-off: the return the supplier counted.
    supplier_return_id: uuid.UUID | None
    cancelled: Cancellation | None


@dataclass(frozen=True, slots=True)
class InvoiceView:
    id: uuid.UUID
    store_id: uuid.UUID
    # The store that owes, and whether it trades: while it does not, any
    # store of the network that trades pays (owner decision, 2026-10-01).
    store_name: str
    store_state: StoreState
    supplier: SupplierView
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
    cancelled: Cancellation | None
    entries: list[EntryView]
    # Borrowed goods sold, when that is what the invoice is for.
    sold: SoldLot | None = None


@dataclass(frozen=True, slots=True)
class SupplierDebt:
    supplier: SupplierView
    owed: Decimal
    invoices: int


@dataclass(frozen=True, slots=True)
class StoreSupplierDebts:
    """What a store owes its suppliers now, in all and by supplier."""

    owed: Decimal
    invoices: int
    suppliers: list[SupplierDebt]


def _standing() -> Any:
    """An entry nobody cancelled."""
    return (
        ~select(SupplierInvoiceEntryCancel.id)
        .where(SupplierInvoiceEntryCancel.entry_id == SupplierInvoiceEntry.id)
        .exists()
    )


def _lowered() -> Any:
    """What the standing entries of the invoice in the outer query lowered it
    by."""
    return (
        select(func.coalesce(func.sum(SupplierInvoiceEntry.amount), 0))
        .where(SupplierInvoiceEntry.invoice_id == SupplierInvoice.id, _standing())
        .correlate(SupplierInvoice)
        .scalar_subquery()
    )


async def _owed(session: AsyncSession, invoice: SupplierInvoice) -> Decimal:
    if invoice.status != InvoiceStatus.OPEN.value:
        return ZERO
    lowered = await session.scalar(
        select(func.coalesce(func.sum(SupplierInvoiceEntry.amount), 0)).where(
            SupplierInvoiceEntry.invoice_id == invoice.id, _standing()
        )
    )
    return max(ZERO, money(invoice.amount - Decimal(lowered or 0)))


def _amount(value: Decimal, *, reason: str, allow_zero: bool = False) -> Decimal:
    amount = money(value)
    if amount < ZERO or (amount == ZERO and not allow_zero) or amount > MAX_AMOUNT:
        raise ValidationFailedError(
            "A sum of money above nothing" if not allow_zero else "A sum of money, or nothing",
            reason=reason,
        )
    return amount


async def _locked(
    session: AsyncSession, *, organization_id: uuid.UUID, invoice_id: uuid.UUID
) -> SupplierInvoice:
    invoice = await session.scalar(
        select(SupplierInvoice)
        .where(SupplierInvoice.id == invoice_id, SupplierInvoice.organization_id == organization_id)
        .with_for_update()
    )
    if invoice is None:
        raise NotFoundError("Unknown invoice", invoice_id=str(invoice_id))
    return invoice


def _settle_if_paid(invoice: SupplierInvoice, owed: Decimal) -> None:
    if owed == ZERO and invoice.status == InvoiceStatus.OPEN.value:
        invoice.status = InvoiceStatus.SETTLED.value
        invoice.closed_at = datetime.now(tz=UTC)


async def _command_lock(
    session: AsyncSession, *, organization_id: uuid.UUID, command_id: uuid.UUID
) -> None:
    """Two requests carrying one command take turns here, so the second finds
    what the first did rather than colliding with it."""
    await session.execute(
        select(
            func.pg_advisory_xact_lock(
                int.from_bytes(
                    hashlib.sha256(organization_id.bytes + command_id.bytes).digest()[:8],
                    byteorder="big",
                    signed=True,
                )
            )
        )
    )


async def _replayed(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    fingerprint: str,
    invoice: SupplierInvoice,
) -> InvoiceView | None:
    """A payment, set-off or write-off already made under this command (I20)."""
    entry = await session.scalar(
        select(SupplierInvoiceEntry).where(
            SupplierInvoiceEntry.organization_id == scope.organization_id,
            SupplierInvoiceEntry.command_id == command_id,
        )
    )
    if entry is None:
        return None
    if entry.command_fingerprint != fingerprint or entry.invoice_id != invoice.id:
        raise IdempotencyConflictError(
            "This command_id was already used with a different request",
            command_id=str(command_id),
        )
    return await view(session, invoice)


# --- recording an invoice ---------------------------------------------------


async def record_invoice(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    command_id: uuid.UUID,
    supplier_id: uuid.UUID,
    amount: Decimal,
    paid_now: Decimal,
    note: str | None,
    currency_code: str,
    correlation_id: str | None = None,
    sold: SoldLot | None = None,
) -> InvoiceView:
    """An invoice the store owes a supplier: the sum on it, and anything from
    nothing to all of it paid at once (owner decisions, 2026-10-01). Paid in
    full, it is settled at once, and stays in the history.

    `sold` is borrowed goods marked sold, which the caller has priced and
    counted against what is on hand (`borrowed.mark_sold`)."""
    scope.require(Permission.SUPPLIER_DEBT, store_id)
    total = _amount(amount, reason="AMOUNT")
    paid = _amount(paid_now, reason="PAID_NOW", allow_zero=True)
    if paid > total:
        raise ValidationFailedError(
            "More is paid than the invoice says", reason="MORE_THAN_OWED", owed=str(total)
        )
    remark = clean_note(note)
    fingerprint = idempotency.fingerprint(
        {
            "supplier_id": str(supplier_id),
            "amount": str(total),
            "paid_now": str(paid),
            "note": remark,
            # Only for borrowed goods sold, so every other invoice keeps its
            # print.
            **(
                {"stock_lot_id": str(sold.stock_lot_id), "lot_quantity": sold.quantity}
                if sold is not None
                else {}
            ),
        },
        actor_user_id=scope.user_id,
        store_id=store_id,
    )
    await _command_lock(session, organization_id=scope.organization_id, command_id=command_id)
    done = await session.scalar(
        select(SupplierInvoice).where(
            SupplierInvoice.organization_id == scope.organization_id,
            SupplierInvoice.command_id == command_id,
        )
    )
    if done is not None:
        if done.command_fingerprint != fingerprint:
            raise IdempotencyConflictError(
                "This command_id was already used with a different request",
                command_id=str(command_id),
            )
        return await view(session, done)
    if (
        await session.scalar(
            select(SupplierInvoiceEntry.id).where(
                SupplierInvoiceEntry.organization_id == scope.organization_id,
                SupplierInvoiceEntry.command_id == command_id,
            )
        )
        is not None
    ):
        # A payment's name, sent again as an invoice's.
        raise IdempotencyConflictError(
            "This command_id was already used with a different request",
            command_id=str(command_id),
        )
    await hold_trading_stores(session, organization_id=scope.organization_id, store_ids={store_id})
    supplier = await session.scalar(
        select(Supplier).where(
            Supplier.id == supplier_id, Supplier.organization_id == scope.organization_id
        )
    )
    if supplier is None:
        raise NotFoundError("Unknown supplier", supplier_id=str(supplier_id))
    invoice = SupplierInvoice(
        organization_id=scope.organization_id,
        store_id=store_id,
        supplier_id=supplier.id,
        amount=total,
        currency_code=currency_code,
        note=remark,
        created_by_user_id=scope.user_id,
        command_id=command_id,
        command_fingerprint=fingerprint,
        correlation_id=correlation_id,
        stock_lot_id=sold.stock_lot_id if sold else None,
        lot_quantity=sold.quantity if sold else None,
        lot_label=sold.label if sold else None,
    )
    session.add(invoice)
    await session.flush()
    if paid > ZERO:
        session.add(
            SupplierInvoiceEntry(
                organization_id=scope.organization_id,
                invoice_id=invoice.id,
                kind=InvoiceEntryKind.PAYMENT.value,
                amount=paid,
                # The first payment is the invoice's own command.
                command_id=command_id,
                command_fingerprint=fingerprint,
                actor_user_id=scope.user_id,
                correlation_id=correlation_id,
            )
        )
        await session.flush()
    _settle_if_paid(invoice, money(total - paid))
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="supplier.invoice_recorded",
        entity_type="supplier_invoice",
        entity_id=invoice.id,
        after={
            "supplier_id": str(supplier.id),
            "amount": str(total),
            "paid_now": str(paid),
        }
        | (
            {"stock_lot_id": str(sold.stock_lot_id), "lot_quantity": sold.quantity}
            if sold is not None
            else {}
        ),
        reason=remark,
    )
    logger.info("supplier.invoice_recorded", invoice_id=str(invoice.id), store_id=str(store_id))
    return await view(session, invoice)


# --- what lowers it ---------------------------------------------------------


async def _paying_store(
    session: AsyncSession,
    *,
    scope: RequestScope,
    invoice: SupplierInvoice,
    at_store_id: uuid.UUID | None,
) -> uuid.UUID:
    """The store that pays this invoice now: the one that owes it while it
    trades, and any store of the network that trades while it does not
    (owner decision, 2026-10-01). Its authority decides, and it keeps its
    state until this transaction ends."""
    paying = at_store_id or invoice.store_id
    # A blocked or archived store is refused here by name, before anything
    # already done is answered.
    scope.require(Permission.SUPPLIER_DEBT, paying)
    states = await hold_stores(
        session, organization_id=scope.organization_id, store_ids={paying, invoice.store_id}
    )
    if states[paying] is not StoreState.ACTIVE:
        raise StoreNotTradingError(store_id=str(paying), state=states[paying].value)
    if paying != invoice.store_id and states[invoice.store_id] is StoreState.ACTIVE:
        raise ValidationFailedError(
            "The store that owes pays its invoices while it trades",
            reason="PAID_WHERE_OWED",
            store_id=str(invoice.store_id),
        )
    return paying


def _still_owed(invoice: SupplierInvoice) -> None:
    if invoice.status != InvoiceStatus.OPEN.value:
        raise ValidationFailedError(
            "Nothing is owed on this invoice any more", reason="NOT_OWED", status=invoice.status
        )


async def pay(
    session: AsyncSession,
    *,
    scope: RequestScope,
    invoice_id: uuid.UUID,
    command_id: uuid.UUID,
    amount: Decimal,
    at_store_id: uuid.UUID | None = None,
    correlation_id: str | None = None,
) -> InvoiceView:
    """A payment on one invoice, never more than is owed. `at_store_id` is
    the store paying, when it is not the one that owes."""
    paid = _amount(amount, reason="NOTHING_PAID")
    invoice = await _locked(session, organization_id=scope.organization_id, invoice_id=invoice_id)
    paying = at_store_id or invoice.store_id
    scope.require(Permission.SUPPLIER_DEBT, paying)
    elsewhere = paying != invoice.store_id
    fingerprint = idempotency.fingerprint(
        {
            "pay": str(invoice.id),
            "amount": str(paid),
            **({"paid_at_store_id": str(paying)} if elsewhere else {}),
        },
        actor_user_id=scope.user_id,
        store_id=invoice.store_id,
    )
    replay = await _replayed(
        session, scope=scope, command_id=command_id, fingerprint=fingerprint, invoice=invoice
    )
    if replay is not None:
        return replay
    await _paying_store(session, scope=scope, invoice=invoice, at_store_id=at_store_id)
    _still_owed(invoice)
    owed = await _owed(session, invoice)
    if paid > owed:
        raise ValidationFailedError("More than is owed", reason="MORE_THAN_OWED", owed=str(owed))
    session.add(
        SupplierInvoiceEntry(
            organization_id=scope.organization_id,
            invoice_id=invoice.id,
            kind=InvoiceEntryKind.PAYMENT.value,
            amount=paid,
            command_id=command_id,
            command_fingerprint=fingerprint,
            actor_user_id=scope.user_id,
            paid_at_store_id=paying if elsewhere else None,
            correlation_id=correlation_id,
        )
    )
    await session.flush()
    _settle_if_paid(invoice, money(owed - paid))
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="supplier.invoice_paid",
        entity_type="supplier_invoice",
        entity_id=invoice.id,
        before={"owed": str(owed)},
        after={
            "owed": str(money(owed - paid)),
            "paid": str(paid),
            **({"paid_at_store_id": str(paying)} if elsewhere else {}),
        },
    )
    logger.info("supplier.invoice_paid", invoice_id=str(invoice.id), paid_at=str(paying))
    return await view(session, invoice)


async def set_off(
    session: AsyncSession,
    *,
    scope: RequestScope,
    invoice_id: uuid.UUID,
    command_id: uuid.UUID,
    supplier_return_id: uuid.UUID,
    amount: Decimal,
    correlation_id: str | None = None,
) -> InvoiceView:
    """Goods returned to this invoice's supplier, from this invoice's store,
    counted against it for the sum the supplier counted (owner decisions,
    2026-10-01). One return may be counted against several invoices."""
    counted = _amount(amount, reason="AMOUNT")
    invoice = await _locked(session, organization_id=scope.organization_id, invoice_id=invoice_id)
    scope.require(Permission.SUPPLIER_DEBT, invoice.store_id)
    fingerprint = idempotency.fingerprint(
        {
            "set_off": str(invoice.id),
            "supplier_return_id": str(supplier_return_id),
            "amount": str(counted),
        },
        actor_user_id=scope.user_id,
        store_id=invoice.store_id,
    )
    replay = await _replayed(
        session, scope=scope, command_id=command_id, fingerprint=fingerprint, invoice=invoice
    )
    if replay is not None:
        return replay
    await hold_trading_stores(
        session, organization_id=scope.organization_id, store_ids={invoice.store_id}
    )
    # Shared, so a cancellation of the return — which takes it for update —
    # waits for this one, and then finds the set-off standing.
    returned = await session.scalar(
        select(SupplierReturn)
        .where(
            SupplierReturn.id == supplier_return_id,
            SupplierReturn.organization_id == scope.organization_id,
        )
        .with_for_update(read=True)
    )
    if returned is None or returned.store_id != invoice.store_id:
        raise NotFoundError(
            "Unknown return to a supplier", supplier_return_id=str(supplier_return_id)
        )
    if returned.supplier_id != invoice.supplier_id:
        raise ValidationFailedError(
            "Goods returned to another supplier are not counted here",
            reason="OTHER_SUPPLIER",
            supplier_return_id=str(returned.id),
        )
    if (
        await session.scalar(
            select(SupplierReturnCancel.id).where(
                SupplierReturnCancel.supplier_return_id == returned.id
            )
        )
        is not None
    ):
        raise ValidationFailedError(
            "That return was cancelled: its goods came back",
            reason="RETURN_CANCELLED",
            supplier_return_id=str(returned.id),
        )
    _still_owed(invoice)
    owed = await _owed(session, invoice)
    if counted > owed:
        raise ValidationFailedError("More than is owed", reason="MORE_THAN_OWED", owed=str(owed))
    session.add(
        SupplierInvoiceEntry(
            organization_id=scope.organization_id,
            invoice_id=invoice.id,
            kind=InvoiceEntryKind.SET_OFF.value,
            amount=counted,
            supplier_return_id=returned.id,
            command_id=command_id,
            command_fingerprint=fingerprint,
            actor_user_id=scope.user_id,
            correlation_id=correlation_id,
        )
    )
    await session.flush()
    _settle_if_paid(invoice, money(owed - counted))
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="supplier.invoice_set_off",
        entity_type="supplier_invoice",
        entity_id=invoice.id,
        before={"owed": str(owed)},
        after={
            "owed": str(money(owed - counted)),
            "set_off": str(counted),
            "supplier_return_id": str(returned.id),
        },
    )
    logger.info("supplier.invoice_set_off", invoice_id=str(invoice.id))
    return await view(session, invoice)


async def write_off(
    session: AsyncSession,
    *,
    scope: RequestScope,
    invoice_id: uuid.UUID,
    command_id: uuid.UUID,
    reason: str,
    correlation_id: str | None = None,
) -> InvoiceView:
    """The owner writes off everything still owed, saying why: the supplier
    forgave it (owner decision, 2026-10-01). Final."""
    why = clean_reason(reason)
    invoice = await _locked(session, organization_id=scope.organization_id, invoice_id=invoice_id)
    if (
        await store_state(session, organization_id=scope.organization_id, store_id=invoice.store_id)
        is StoreState.ACTIVE
    ):
        scope.require(Permission.SUPPLIER_WRITE_OFF, invoice.store_id)
    else:
        # Nothing is done in a store that does not trade, but what it owes is
        # still the owner's to write off: the network's owner, whose role
        # covers every store — as a customer's debt there is.
        scope.require(Permission.SUPPLIER_WRITE_OFF)
    fingerprint = idempotency.fingerprint(
        {"write_off": str(invoice.id), "reason": why},
        actor_user_id=scope.user_id,
        store_id=invoice.store_id,
    )
    replay = await _replayed(
        session, scope=scope, command_id=command_id, fingerprint=fingerprint, invoice=invoice
    )
    if replay is not None:
        return replay
    _still_owed(invoice)
    owed = await _owed(session, invoice)
    session.add(
        SupplierInvoiceEntry(
            organization_id=scope.organization_id,
            invoice_id=invoice.id,
            kind=InvoiceEntryKind.WRITE_OFF.value,
            amount=owed,
            command_id=command_id,
            command_fingerprint=fingerprint,
            actor_user_id=scope.user_id,
            note=why,
            correlation_id=correlation_id,
        )
    )
    invoice.status = InvoiceStatus.WRITTEN_OFF.value
    invoice.closed_at = datetime.now(tz=UTC)
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="supplier.invoice_written_off",
        entity_type="supplier_invoice",
        entity_id=invoice.id,
        before={"owed": str(owed)},
        after={"owed": "0.00"},
        reason=why,
    )
    logger.info("supplier.invoice_written_off", invoice_id=str(invoice.id))
    return await view(session, invoice)


# --- what was recorded by mistake -------------------------------------------


async def cancel_entry(
    session: AsyncSession,
    *,
    scope: RequestScope,
    invoice_id: uuid.UUID,
    entry_id: uuid.UUID,
    reason: str,
    at_store_id: uuid.UUID | None = None,
    correlation_id: str | None = None,
) -> InvoiceView:
    """A payment or a set-off recorded by mistake, cancelled saying why: the
    invoice owes it again (owner decision, 2026-10-01). Once: cancelling it
    again answers with the invoice as it is.

    A payment is cancelled where it may be made now (`_paying_store`); a
    set-off in the store that owes. A write-off is final."""
    invoice = await _locked(session, organization_id=scope.organization_id, invoice_id=invoice_id)
    entry = await session.scalar(
        select(SupplierInvoiceEntry).where(
            SupplierInvoiceEntry.id == entry_id, SupplierInvoiceEntry.invoice_id == invoice.id
        )
    )
    if entry is None:
        scope.require(Permission.SUPPLIER_DEBT, at_store_id or invoice.store_id)
        raise NotFoundError("Unknown entry of this invoice", entry_id=str(entry_id))
    payment = entry.kind == InvoiceEntryKind.PAYMENT.value
    scope.require(
        Permission.SUPPLIER_DEBT, (at_store_id or invoice.store_id) if payment else invoice.store_id
    )
    why = clean_reason(reason)
    if await _cancellation_of(session, entry_id=entry.id) is not None:
        return await view(session, invoice)
    if entry.kind == InvoiceEntryKind.WRITE_OFF.value or invoice.status in {
        InvoiceStatus.WRITTEN_OFF.value,
        InvoiceStatus.CANCELLED.value,
    }:
        raise ValidationFailedError(
            "What was written off stays written off", reason="WRITTEN_OFF", status=invoice.status
        )
    if payment:
        await _paying_store(session, scope=scope, invoice=invoice, at_store_id=at_store_id)
    else:
        await hold_trading_stores(
            session, organization_id=scope.organization_id, store_ids={invoice.store_id}
        )
    owed = await _owed(session, invoice) if invoice.status == InvoiceStatus.OPEN.value else ZERO
    session.add(
        SupplierInvoiceEntryCancel(
            entry_id=entry.id,
            reason=why,
            created_by_user_id=scope.user_id,
            correlation_id=correlation_id,
        )
    )
    if invoice.status == InvoiceStatus.SETTLED.value:
        invoice.status = InvoiceStatus.OPEN.value
        invoice.closed_at = None
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="supplier.invoice_entry_cancelled",
        entity_type="supplier_invoice",
        entity_id=invoice.id,
        before={"owed": str(owed)},
        after={
            "owed": str(money(owed + entry.amount)),
            "entry_id": str(entry.id),
            "kind": entry.kind,
        },
        reason=why,
    )
    logger.info("supplier.invoice_entry_cancelled", invoice_id=str(invoice.id))
    return await view(session, invoice)


async def cancel_invoice(
    session: AsyncSession,
    *,
    scope: RequestScope,
    invoice_id: uuid.UUID,
    reason: str,
    correlation_id: str | None = None,
) -> InvoiceView:
    """An invoice recorded by mistake, cancelled saying why — only once no
    payment or set-off on it stands (owner decision, 2026-10-01), so no money
    disappears by accident. Once: cancelling it again answers with it."""
    invoice = await _locked(session, organization_id=scope.organization_id, invoice_id=invoice_id)
    scope.require(Permission.SUPPLIER_DEBT, invoice.store_id)
    why = clean_reason(reason)
    if invoice.status == InvoiceStatus.CANCELLED.value:
        return await view(session, invoice)
    if invoice.status == InvoiceStatus.WRITTEN_OFF.value:
        raise ValidationFailedError(
            "What was written off stays written off", reason="WRITTEN_OFF", status=invoice.status
        )
    await hold_trading_stores(
        session, organization_id=scope.organization_id, store_ids={invoice.store_id}
    )
    standing = (
        await session.scalars(
            select(SupplierInvoiceEntry.id)
            .where(SupplierInvoiceEntry.invoice_id == invoice.id, _standing())
            .order_by(SupplierInvoiceEntry.created_at, SupplierInvoiceEntry.id)
        )
    ).all()
    if standing:
        raise ValidationFailedError(
            "Payments or set-offs on this invoice stand: cancel them first",
            reason="ENTRIES_STAND",
            entry_ids=[str(entry_id) for entry_id in standing],
        )
    session.add(
        SupplierInvoiceCancel(
            invoice_id=invoice.id,
            reason=why,
            created_by_user_id=scope.user_id,
            correlation_id=correlation_id,
        )
    )
    invoice.status = InvoiceStatus.CANCELLED.value
    invoice.closed_at = datetime.now(tz=UTC)
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="supplier.invoice_cancelled",
        entity_type="supplier_invoice",
        entity_id=invoice.id,
        before={"status": InvoiceStatus.OPEN.value},
        after={"status": InvoiceStatus.CANCELLED.value},
        reason=why,
    )
    logger.info("supplier.invoice_cancelled", invoice_id=str(invoice.id))
    return await view(session, invoice)


# --- reading ----------------------------------------------------------------


async def _cancellation_of(
    session: AsyncSession, *, entry_id: uuid.UUID
) -> SupplierInvoiceEntryCancel | None:
    found: SupplierInvoiceEntryCancel | None = await session.scalar(
        select(SupplierInvoiceEntryCancel).where(SupplierInvoiceEntryCancel.entry_id == entry_id)
    )
    return found


async def set_offs_of_return(
    session: AsyncSession, *, supplier_return_id: uuid.UUID
) -> list[SetOffView]:
    """What the supplier counts of this return against invoices now: the
    set-offs that stand."""
    rows = (
        await session.scalars(
            select(SupplierInvoiceEntry)
            .where(SupplierInvoiceEntry.supplier_return_id == supplier_return_id, _standing())
            .order_by(SupplierInvoiceEntry.created_at, SupplierInvoiceEntry.id)
        )
    ).all()
    return [
        SetOffView(invoice_id=row.invoice_id, entry_id=row.id, amount=row.amount, at=row.created_at)
        for row in rows
    ]


async def view(session: AsyncSession, invoice: SupplierInvoice) -> InvoiceView:
    supplier = await session.get(Supplier, invoice.supplier_id)
    assert supplier is not None
    entries = list(
        (
            await session.execute(
                select(SupplierInvoiceEntry, AppUser.display_name)
                .join(AppUser, AppUser.id == SupplierInvoiceEntry.actor_user_id)
                .where(SupplierInvoiceEntry.invoice_id == invoice.id)
                .order_by(SupplierInvoiceEntry.created_at, SupplierInvoiceEntry.id)
            )
        ).all()
    )
    cancels = {
        row.entry_id: Cancellation(reason=row.reason, by=name, at=row.created_at)
        for row, name in (
            await session.execute(
                select(SupplierInvoiceEntryCancel, AppUser.display_name)
                .join(AppUser, AppUser.id == SupplierInvoiceEntryCancel.created_by_user_id)
                .where(SupplierInvoiceEntryCancel.entry_id.in_([entry.id for entry, _ in entries]))
            )
        ).all()
    }
    cancelled = (
        await session.execute(
            select(SupplierInvoiceCancel, AppUser.display_name)
            .join(AppUser, AppUser.id == SupplierInvoiceCancel.created_by_user_id)
            .where(SupplierInvoiceCancel.invoice_id == invoice.id)
        )
    ).first()
    by = await session.scalar(
        select(AppUser.display_name).where(AppUser.id == invoice.created_by_user_id)
    )
    names = await store_names(
        session,
        organization_id=invoice.organization_id,
        store_ids={invoice.store_id}
        | {entry.paid_at_store_id for entry, _ in entries if entry.paid_at_store_id},
    )
    state = await store_state(
        session, organization_id=invoice.organization_id, store_id=invoice.store_id
    )
    assert state is not None
    total = dict.fromkeys(InvoiceEntryKind, ZERO)
    last_payment: datetime | None = None
    for entry, _ in entries:
        if entry.id in cancels:
            continue
        kind = InvoiceEntryKind(entry.kind)
        total[kind] += entry.amount
        if kind is InvoiceEntryKind.PAYMENT:
            last_payment = entry.created_at
    return InvoiceView(
        id=invoice.id,
        store_id=invoice.store_id,
        store_name=names[invoice.store_id],
        store_state=state,
        supplier=supplier_view(supplier),
        amount=invoice.amount,
        currency_code=invoice.currency_code,
        note=invoice.note,
        status=InvoiceStatus(invoice.status),
        paid=money(total[InvoiceEntryKind.PAYMENT]),
        set_off=money(total[InvoiceEntryKind.SET_OFF]),
        written_off=money(total[InvoiceEntryKind.WRITE_OFF]),
        owed=await _owed(session, invoice),
        by=by or "",
        at=invoice.created_at,
        last_payment_at=last_payment,
        closed_at=invoice.closed_at,
        cancelled=None
        if cancelled is None
        else Cancellation(reason=cancelled[0].reason, by=cancelled[1], at=cancelled[0].created_at),
        entries=[
            EntryView(
                id=entry.id,
                kind=InvoiceEntryKind(entry.kind),
                amount=entry.amount,
                at=entry.created_at,
                by=name,
                note=entry.note,
                paid_at=names[entry.paid_at_store_id] if entry.paid_at_store_id else None,
                supplier_return_id=entry.supplier_return_id,
                cancelled=cancels.get(entry.id),
            )
            for entry, name in entries
        ],
        sold=SoldLot(
            stock_lot_id=invoice.stock_lot_id,
            quantity=invoice.lot_quantity or 0,
            label=invoice.lot_label or "",
        )
        if invoice.stock_lot_id is not None
        else None,
    )


def _of_stores(
    statement: Select[Any],
    scope: RequestScope,
    store_id: uuid.UUID,
    elsewhere: bool,
) -> Select[Any]:
    """The store's own invoices; with `elsewhere`, those of every store of
    the network that does not trade, which this one may pay."""
    return statement.where(
        SupplierInvoice.organization_id == scope.organization_id,
        SupplierInvoice.store_id.in_(
            select(Store.id).where(
                Store.organization_id == scope.organization_id,
                Store.state != StoreState.ACTIVE.value,
            )
        )
        if elsewhere
        else SupplierInvoice.store_id == store_id,
    )


async def list_invoices(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    supplier_id: uuid.UUID | None,
    status: InvoiceStatus | None,
    elsewhere: bool,
    limit: int,
    offset: int,
) -> tuple[list[InvoiceView], bool]:
    """The store's invoices, newest first (owner decision, 2026-10-01: each
    store its own). `elsewhere` lists the invoices of the stores that do not
    trade instead, whose payments this store makes."""
    scope.require(Permission.SUPPLIER_DEBT, store_id)
    statement = _of_stores(select(SupplierInvoice), scope, store_id, elsewhere)
    if supplier_id is not None:
        statement = statement.where(SupplierInvoice.supplier_id == supplier_id)
    if status is not None:
        statement = statement.where(SupplierInvoice.status == status.value)
    rows: Sequence[SupplierInvoice] = (
        await session.scalars(
            statement.order_by(SupplierInvoice.created_at.desc(), SupplierInvoice.id)
            .limit(limit + 1)
            .offset(offset)
        )
    ).all()
    return [await view(session, row) for row in rows[:limit]], len(rows) > limit


async def store_debts(
    session: AsyncSession, *, scope: RequestScope, store_id: uuid.UUID
) -> StoreSupplierDebts:
    """What the store owes its suppliers now: in all, and by supplier, the
    largest first (owner decisions, 2026-10-01)."""
    scope.require(Permission.SUPPLIER_DEBT, store_id)
    owed = func.greatest(SupplierInvoice.amount - _lowered(), 0)
    rows = (
        await session.execute(
            _of_stores(
                select(
                    SupplierInvoice.supplier_id,
                    func.sum(owed).label("owed"),
                    func.count(SupplierInvoice.id).label("invoices"),
                ),
                scope,
                store_id,
                elsewhere=False,
            )
            .where(SupplierInvoice.status == InvoiceStatus.OPEN.value)
            .group_by(SupplierInvoice.supplier_id)
        )
    ).all()
    suppliers = {
        supplier.id: supplier
        for supplier in (
            await session.scalars(
                select(Supplier).where(Supplier.id.in_([row.supplier_id for row in rows]))
            )
        ).all()
    }
    debts = sorted(
        (
            SupplierDebt(
                supplier=supplier_view(suppliers[row.supplier_id]),
                owed=money(Decimal(row.owed)),
                invoices=row.invoices,
            )
            for row in rows
        ),
        key=lambda debt: (-debt.owed, debt.supplier.name.casefold(), str(debt.supplier.id)),
    )
    return StoreSupplierDebts(
        owed=money(sum((debt.owed for debt in debts), ZERO)),
        invoices=sum(debt.invoices for debt in debts),
        suppliers=debts,
    )


__all__ = [
    "EntryView",
    "InvoiceView",
    "SetOffView",
    "SoldLot",
    "StoreSupplierDebts",
    "SupplierDebt",
    "cancel_entry",
    "cancel_invoice",
    "list_invoices",
    "money",
    "pay",
    "record_invoice",
    "set_off",
    "set_offs_of_return",
    "store_debts",
    "view",
    "write_off",
]
