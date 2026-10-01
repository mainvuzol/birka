"""Suppliers, and goods returned to them. See `models.py` for the owner's
decisions of 2026-10-01.

**Two doors, one core.** `return_goods` is the command a person sends from
the «Постачальникам» section: goods from one warehouse, never a «Брак».
A confirmed unit from «Брак» goes back through the «Брак» section instead
(`damaged.service`), which calls `record_return` and `record_cancel` here
for its one unit — so stock in «Брак» still changes only through returns and
that section.

**The ledger does the moving.** A return is `SUPPLIER_RETURN` movements out
of the warehouse; its cancellation `SUPPLIER_RETURN_CANCEL` movements back.
Only goods free to sell leave: goods held for an order do not
(`InsufficientStockError`).

**Safe to repeat.** A return is named by the client's permanent `command_id`
(I20): the same command is answered with the return, however late. A
cancellation needs no name of its own: a return is cancelled once, and
cancelling it again answers with it as it is.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import IdempotencyConflictError, NotFoundError, ValidationFailedError
from app.core.logging import get_logger
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.read import describe_variants, size_labels
from app.modules.identity.models import AppUser
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import MovementRequest, apply_movements
from app.modules.suppliers.models import (
    Supplier,
    SupplierReturn,
    SupplierReturnCancel,
    SupplierReturnLine,
)
from app.modules.tenancy.service import (
    LocationCapability,
    damaged_returns_locations,
    location_names,
)

logger = get_logger(__name__)

MAX_NAME = 200
MAX_PHONE = 40
MAX_TEXT = 1000
MAX_LINES = 100
MAX_QUANTITY = 10_000


@dataclass(frozen=True, slots=True)
class ReturnLine:
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int


@dataclass(frozen=True, slots=True)
class SupplierView:
    id: uuid.UUID
    name: str
    phone: str | None


@dataclass(frozen=True, slots=True)
class LineView:
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int
    display_name: str
    size_label: str | None


@dataclass(frozen=True, slots=True)
class Cancellation:
    reason: str
    by: str
    at: datetime


@dataclass(frozen=True, slots=True)
class ReturnView:
    id: uuid.UUID
    store_id: uuid.UUID
    location_id: uuid.UUID
    location_name: str
    supplier: SupplierView
    # A unit from «Брак»: cancelled only from there.
    damaged_unit_id: uuid.UUID | None
    note: str | None
    by: str
    at: datetime
    lines: list[LineView]
    cancelled: Cancellation | None


def _normalized(name: str) -> str:
    return " ".join(name.split()).casefold()


def _text(value: str | None, *, limit: int, reason: str, required: bool) -> str | None:
    clean = " ".join((value or "").split()) if reason == "NAME" else (value or "").strip()
    if not clean:
        if required:
            raise ValidationFailedError("Say it, please", reason=reason)
        return None
    if len(clean) > limit or not is_storable(clean):
        raise ValidationFailedError(f"At most {limit} characters", reason=reason)
    return clean


def _view(supplier: Supplier) -> SupplierView:
    return SupplierView(id=supplier.id, name=supplier.name, phone=supplier.phone)


# --- the list ---------------------------------------------------------------


async def list_suppliers(
    session: AsyncSession, *, scope: RequestScope, store_id: uuid.UUID
) -> list[SupplierView]:
    """The network's suppliers, by name, for whoever returns goods here."""
    scope.require(Permission.SUPPLIER_RETURN, store_id)
    rows = await session.scalars(
        select(Supplier)
        .where(Supplier.organization_id == scope.organization_id)
        .order_by(Supplier.normalized_name, Supplier.id)
    )
    return [_view(row) for row in rows.all()]


async def _same_name(
    session: AsyncSession, *, organization_id: uuid.UUID, normalized: str
) -> Supplier | None:
    found: Supplier | None = await session.scalar(
        select(Supplier).where(
            Supplier.organization_id == organization_id,
            Supplier.normalized_name == normalized,
        )
    )
    return found


def _duplicate(existing: Supplier) -> ValidationFailedError:
    return ValidationFailedError(
        "A supplier of that name is already on the list",
        reason="DUPLICATE",
        supplier_id=str(existing.id),
        name=existing.name,
    )


async def add_supplier(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    name: str,
    phone: str | None,
) -> SupplierView:
    """A new supplier, added on the spot. A name already on the list, however
    spaced or capitalised, is refused with that supplier, to pick instead."""
    scope.require(Permission.SUPPLIER_RETURN, store_id)
    clean = _text(name, limit=MAX_NAME, reason="NAME", required=True)
    assert clean is not None
    tel = _text(phone, limit=MAX_PHONE, reason="PHONE", required=False)
    normalized = _normalized(clean)
    existing = await _same_name(
        session, organization_id=scope.organization_id, normalized=normalized
    )
    if existing is not None:
        raise _duplicate(existing)
    supplier = Supplier(
        organization_id=scope.organization_id,
        name=clean,
        normalized_name=normalized,
        phone=tel,
        created_by_user_id=scope.user_id,
    )
    try:
        async with session.begin_nested():
            session.add(supplier)
            await session.flush()
    except IntegrityError:
        # Added by someone else in the same instant.
        raced = await _same_name(
            session, organization_id=scope.organization_id, normalized=normalized
        )
        assert raced is not None
        raise _duplicate(raced) from None
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="supplier.added",
        entity_type="supplier",
        entity_id=supplier.id,
        after={"name": clean, "phone": tel},
    )
    return _view(supplier)


async def edit_supplier(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    supplier_id: uuid.UUID,
    name: str,
    phone: str | None,
) -> SupplierView:
    """A supplier's name or phone, corrected by whoever returns goods."""
    scope.require(Permission.SUPPLIER_RETURN, store_id)
    supplier = await session.scalar(
        select(Supplier)
        .where(Supplier.id == supplier_id, Supplier.organization_id == scope.organization_id)
        .with_for_update()
    )
    if supplier is None:
        raise NotFoundError("Unknown supplier", supplier_id=str(supplier_id))
    clean = _text(name, limit=MAX_NAME, reason="NAME", required=True)
    assert clean is not None
    tel = _text(phone, limit=MAX_PHONE, reason="PHONE", required=False)
    normalized = _normalized(clean)
    if normalized != supplier.normalized_name:
        existing = await _same_name(
            session, organization_id=scope.organization_id, normalized=normalized
        )
        if existing is not None:
            raise _duplicate(existing)
    before = {"name": supplier.name, "phone": supplier.phone}
    if before == {"name": clean, "phone": tel}:
        return _view(supplier)
    supplier.name = clean
    supplier.normalized_name = normalized
    supplier.phone = tel
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError:
        raced = await _same_name(
            session, organization_id=scope.organization_id, normalized=normalized
        )
        assert raced is not None
        raise _duplicate(raced) from None
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="supplier.edited",
        entity_type="supplier",
        entity_id=supplier.id,
        before=before,
        after={"name": clean, "phone": tel},
    )
    return _view(supplier)


async def _supplier(
    session: AsyncSession, *, organization_id: uuid.UUID, supplier_id: uuid.UUID
) -> Supplier:
    supplier = await session.scalar(
        select(Supplier).where(
            Supplier.id == supplier_id, Supplier.organization_id == organization_id
        )
    )
    if supplier is None:
        raise NotFoundError("Unknown supplier", supplier_id=str(supplier_id))
    return supplier


# --- the core, shared with «Брак» -------------------------------------------


async def record_return(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    command_id: uuid.UUID,
    command_fingerprint: str,
    location_id: uuid.UUID,
    supplier_id: uuid.UUID,
    lines: Sequence[ReturnLine],
    note: str | None,
    correlation_id: str | None,
    damaged_unit_id: uuid.UUID | None = None,
) -> SupplierReturn:
    """Write one return: its row, the goods out of the warehouse, its lines
    as the catalogue names them now, and the audit entry.

    The person's authority is the caller's to decide. `damaged_unit_id` is
    the «Брак» section vouching that this is its unit leaving «Брак», the one
    way stock there may change here.
    """
    supplier = await _supplier(session, organization_id=organization_id, supplier_id=supplier_id)
    row = SupplierReturn(
        organization_id=organization_id,
        store_id=store_id,
        location_id=location_id,
        supplier_id=supplier.id,
        damaged_unit_id=damaged_unit_id,
        note=note,
        created_by_user_id=actor_user_id,
        command_id=command_id,
        command_fingerprint=command_fingerprint,
        correlation_id=correlation_id,
    )
    session.add(row)
    await session.flush()
    await apply_movements(
        session,
        organization_id=organization_id,
        requests=[
            MovementRequest(
                location_id=location_id,
                acting_store_id=store_id,
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity_delta=-line.quantity,
                movement_type=MovementType.SUPPLIER_RETURN,
                reference_type="supplier_return",
                reference_id=row.id,
            )
            for line in lines
        ],
        actor_user_id=actor_user_id,
        correlation_id=correlation_id,
        damaged_stock=damaged_unit_id is not None,
    )
    names = await describe_variants(session, [line.product_variant_id for line in lines])
    labels = await size_labels(session, [line.size_id for line in lines])
    session.add_all(
        [
            SupplierReturnLine(
                supplier_return_id=row.id,
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity=line.quantity,
                display_name=names[line.product_variant_id].display_name,
                size_label=labels.get(line.size_id),
            )
            for line in lines
        ]
    )
    await session.flush()
    await audit.record(
        session,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action="supplier.returned",
        entity_type="supplier_return",
        entity_id=row.id,
        after={
            "supplier_id": str(supplier.id),
            "location_id": str(location_id),
            "units": sum(line.quantity for line in lines),
        },
        reason=note,
    )
    logger.info("supplier.returned", supplier_return_id=str(row.id), store_id=str(store_id))
    return row


async def record_cancel(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    supplier_return: SupplierReturn,
    reason: str,
    correlation_id: str | None,
) -> SupplierReturnCancel:
    """The whole return cancelled: its goods back where they were taken from.
    The caller holds the return's row and has checked it stands."""
    lines = (
        await session.scalars(
            select(SupplierReturnLine).where(
                SupplierReturnLine.supplier_return_id == supplier_return.id
            )
        )
    ).all()
    cancel = SupplierReturnCancel(
        supplier_return_id=supplier_return.id,
        reason=reason,
        created_by_user_id=actor_user_id,
        correlation_id=correlation_id,
    )
    session.add(cancel)
    await session.flush()
    await apply_movements(
        session,
        organization_id=organization_id,
        requests=[
            MovementRequest(
                location_id=supplier_return.location_id,
                acting_store_id=supplier_return.store_id,
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity_delta=line.quantity,
                movement_type=MovementType.SUPPLIER_RETURN_CANCEL,
                reference_type="supplier_return_cancel",
                reference_id=cancel.id,
            )
            for line in lines
        ],
        actor_user_id=actor_user_id,
        correlation_id=correlation_id,
        damaged_stock=supplier_return.damaged_unit_id is not None,
    )
    await audit.record(
        session,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action="supplier.return_cancelled",
        entity_type="supplier_return",
        entity_id=supplier_return.id,
        before={"cancelled": False},
        after={"cancelled": True},
        reason=reason,
    )
    logger.info("supplier.return_cancelled", supplier_return_id=str(supplier_return.id))
    return cancel


async def locked_return(
    session: AsyncSession, *, organization_id: uuid.UUID, supplier_return_id: uuid.UUID
) -> SupplierReturn:
    """The return's row, held until commit: two cancellations of one return
    take turns, and the second finds it cancelled."""
    row = await session.scalar(
        select(SupplierReturn)
        .where(
            SupplierReturn.id == supplier_return_id,
            SupplierReturn.organization_id == organization_id,
        )
        .with_for_update()
    )
    if row is None:
        raise NotFoundError(
            "Unknown return to a supplier", supplier_return_id=str(supplier_return_id)
        )
    return row


async def is_cancelled(session: AsyncSession, *, supplier_return_id: uuid.UUID) -> bool:
    return (
        await session.scalar(
            select(SupplierReturnCancel.id).where(
                SupplierReturnCancel.supplier_return_id == supplier_return_id
            )
        )
    ) is not None


def clean_reason(reason: str) -> str:
    why = _text(reason, limit=MAX_TEXT, reason="NO_REASON", required=True)
    assert why is not None
    return why


def clean_note(note: str | None) -> str | None:
    return _text(note, limit=MAX_TEXT, reason="NOTE", required=False)


async def returns_of_unit(session: AsyncSession, *, damaged_unit_id: uuid.UUID) -> int:
    """How many times this unit from «Брак» has gone back to a supplier,
    cancelled ones included: its next return's name is derived from it."""
    return int(
        await session.scalar(
            select(func.count(SupplierReturn.id)).where(
                SupplierReturn.damaged_unit_id == damaged_unit_id
            )
        )
        or 0
    )


# --- the commands of the «Постачальникам» section ---------------------------


def _lines(lines: Sequence[ReturnLine]) -> list[ReturnLine]:
    if not lines:
        raise ValidationFailedError("Name what goes back", reason="NO_LINES")
    if len(lines) > MAX_LINES:
        raise ValidationFailedError(f"At most {MAX_LINES} lines", reason="TOO_MANY_LINES")
    keys = [(line.product_variant_id, line.size_id) for line in lines]
    if len(set(keys)) != len(keys):
        raise ValidationFailedError(
            "Each model and size once, with its whole quantity", reason="DUPLICATE_LINE"
        )
    for line in lines:
        if not 0 < line.quantity <= MAX_QUANTITY:
            raise ValidationFailedError(f"A quantity from 1 to {MAX_QUANTITY}", reason="QUANTITY")
    return sorted(lines, key=lambda line: (str(line.product_variant_id), str(line.size_id)))


async def return_goods(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    store_id: uuid.UUID,
    location_id: uuid.UUID,
    supplier_id: uuid.UUID,
    lines: Sequence[ReturnLine],
    note: str | None,
    correlation_id: str | None = None,
) -> ReturnView:
    """Goods from one warehouse back to a supplier, for the owner and
    managers. Never from a «Брак»: a unit there goes back from «Брак»."""
    scope.require(Permission.SUPPLIER_RETURN, store_id)
    ordered = _lines(lines)
    remark = clean_note(note)
    fingerprint = idempotency.fingerprint(
        {
            "location_id": str(location_id),
            "supplier_id": str(supplier_id),
            "lines": [
                [str(line.product_variant_id), str(line.size_id), line.quantity] for line in ordered
            ],
            "note": remark,
        },
        actor_user_id=scope.user_id,
        store_id=store_id,
    )
    # Two requests carrying one command take turns here, so the second finds
    # the first's return rather than colliding with it.
    await session.execute(
        select(
            func.pg_advisory_xact_lock(
                int.from_bytes(
                    hashlib.sha256(scope.organization_id.bytes + command_id.bytes).digest()[:8],
                    byteorder="big",
                    signed=True,
                )
            )
        )
    )
    done = await session.scalar(
        select(SupplierReturn).where(
            SupplierReturn.organization_id == scope.organization_id,
            SupplierReturn.command_id == command_id,
        )
    )
    if done is not None:
        if done.command_fingerprint != fingerprint:
            raise IdempotencyConflictError(
                "This command_id was already used with a different request",
                command_id=str(command_id),
            )
        return await view(session, done)
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.SUPPLIER_RETURN,
        store_id=store_id,
        location_ids={location_id},
        capability=LocationCapability.RECEIVE,
    )
    if await damaged_returns_locations(
        session, organization_id=scope.organization_id, location_ids={location_id}
    ):
        raise ValidationFailedError(
            "A unit in «Брак» goes back to its supplier from «Брак»",
            reason="FROM_DAMAGED",
            location_id=str(location_id),
        )
    row = await record_return(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        actor_user_id=scope.user_id,
        command_id=command_id,
        command_fingerprint=fingerprint,
        location_id=location_id,
        supplier_id=supplier_id,
        lines=ordered,
        note=remark,
        correlation_id=correlation_id,
    )
    return await view(session, row)


async def cancel_return(
    session: AsyncSession,
    *,
    scope: RequestScope,
    supplier_return_id: uuid.UUID,
    reason: str,
    correlation_id: str | None = None,
) -> ReturnView:
    """A return from a warehouse cancelled, whole, saying why: its goods go
    back there. Once: cancelling it again answers with it as it is."""
    row = await locked_return(
        session, organization_id=scope.organization_id, supplier_return_id=supplier_return_id
    )
    scope.require(Permission.SUPPLIER_RETURN, row.store_id)
    why = clean_reason(reason)
    if await is_cancelled(session, supplier_return_id=row.id):
        return await view(session, row)
    if row.damaged_unit_id is not None:
        raise ValidationFailedError(
            "A unit from «Брак» comes back from its supplier through «Брак»",
            reason="FROM_DAMAGED",
            damaged_unit_id=str(row.damaged_unit_id),
        )
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.SUPPLIER_RETURN,
        store_id=row.store_id,
        location_ids={row.location_id},
        capability=LocationCapability.RECEIVE,
    )
    await record_cancel(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        supplier_return=row,
        reason=why,
        correlation_id=correlation_id,
    )
    return await view(session, row)


# --- reading ----------------------------------------------------------------


async def view(session: AsyncSession, row: SupplierReturn) -> ReturnView:
    supplier = await session.get(Supplier, row.supplier_id)
    assert supplier is not None
    by = await session.scalar(
        select(AppUser.display_name).where(AppUser.id == row.created_by_user_id)
    )
    lines = (
        await session.scalars(
            select(SupplierReturnLine)
            .where(SupplierReturnLine.supplier_return_id == row.id)
            .order_by(SupplierReturnLine.display_name, SupplierReturnLine.size_label)
        )
    ).all()
    cancelled = (
        await session.execute(
            select(SupplierReturnCancel, AppUser.display_name)
            .join(AppUser, AppUser.id == SupplierReturnCancel.created_by_user_id)
            .where(SupplierReturnCancel.supplier_return_id == row.id)
        )
    ).first()
    places = await location_names(
        session, organization_id=row.organization_id, location_ids={row.location_id}
    )
    return ReturnView(
        id=row.id,
        store_id=row.store_id,
        location_id=row.location_id,
        location_name=places.get(row.location_id, ""),
        supplier=_view(supplier),
        damaged_unit_id=row.damaged_unit_id,
        note=row.note,
        by=by or "",
        at=row.created_at,
        lines=[
            LineView(
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity=line.quantity,
                display_name=line.display_name,
                size_label=line.size_label,
            )
            for line in lines
        ],
        cancelled=None
        if cancelled is None
        else Cancellation(reason=cancelled[0].reason, by=cancelled[1], at=cancelled[0].created_at),
    )


async def list_returns(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    supplier_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> tuple[list[ReturnView], bool]:
    """This store's returns, newest first, of one supplier if asked (owner
    decision, 2026-10-01: each store its own)."""
    scope.require(Permission.SUPPLIER_RETURN, store_id)
    statement = select(SupplierReturn).where(
        SupplierReturn.organization_id == scope.organization_id,
        SupplierReturn.store_id == store_id,
    )
    if supplier_id is not None:
        statement = statement.where(SupplierReturn.supplier_id == supplier_id)
    rows = (
        await session.scalars(
            statement.order_by(SupplierReturn.created_at.desc(), SupplierReturn.id)
            .limit(limit + 1)
            .offset(offset)
        )
    ).all()
    return [await view(session, row) for row in rows[:limit]], len(rows) > limit


__all__ = [
    "Cancellation",
    "LineView",
    "ReturnLine",
    "ReturnView",
    "SupplierView",
    "add_supplier",
    "cancel_return",
    "clean_note",
    "clean_reason",
    "edit_supplier",
    "is_cancelled",
    "list_returns",
    "list_suppliers",
    "locked_return",
    "record_cancel",
    "record_return",
    "return_goods",
    "returns_of_unit",
    "view",
]
