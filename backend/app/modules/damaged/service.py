"""The «Брак» section: every unit returned damaged, and what becomes of it.

Owner decisions of 2026-10-01 (business-rules.md, "what happens in «Брак»"):

    AWAITING ──take──▶ INSPECTING ──return to sale──▶ RETURNED
        ▲                   │
        │                   └──confirm──▶ CONFIRMED ──write off──▶ WRITTEN_OFF
        └───────────take again─────────────┘  ▲  │
                                               │  └──to the supplier──▶ SUPPLIER
                                               └────cancelled────────────┘

- Anyone who takes returns may do every step (`damaged:handle`).
- «На перевірці» shows who is looking, so two people do not inspect one
  unit. It does not stop anyone else from finishing: it is information, as
  the owner asked, and an app that locked a unit to someone on leave would
  be the clutter the owner did not want.
- A unit goes back on sale only to the warehouse it was sold from, which the
  person is shown and confirms. Anywhere else would be a transfer no one
  asked for.
- A confirmed unit stays in «Брак», no longer for sale, until someone
  decides its fate: it is written off, or — by the owner or a manager — sent
  back to its supplier (owner decision, 2026-10-01, "returns to a supplier").
  That return may be cancelled, and the unit is confirmed damaged again.

**The ledger does the moving.** A return to sale is a transfer out of «Брак»
(`transfers.move_goods`, invariant I24), a write-off is a stock adjustment
(`inventory.record_adjustment`, ADR-0007). Both carry `damaged_stock`: stock
in «Брак» changes only through a return taken damaged and through here, so
the units still in «Брак» always add up to what it holds.

**Each step is safe to repeat.** A unit's own row is locked, and a step that
finds it already where that step leads answers with it as it is, rather than
doing it twice. A step that finds it anywhere else refuses with what it found
(`DamagedUnitChangedError`): somebody else got there first. The ledger's own
command ids are derived from the unit and the step, so even a second
transaction could not move or write off a unit twice.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import NoReturn

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import DamagedUnitChangedError, NotFoundError, ValidationFailedError
from app.core.logging import get_logger
from app.modules.audit import service as audit
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.damaged.models import IN_BIN, DamagedStatus, DamagedUnit
from app.modules.inventory.models import MovementReason
from app.modules.inventory.service import current_variants, record_adjustment
from app.modules.suppliers import service as suppliers
from app.modules.tenancy.service import LocationCapability, back_on_sale_locations
from app.modules.transfers.service import TransferLineInput, move_goods

logger = get_logger(__name__)

# The namespace the ledger's command ids for a unit's steps are derived in.
STEPS = uuid.UUID("5d7c3f2e-9a41-4b8e-9f0a-0b7f2c1e6d44")


@dataclass(frozen=True, slots=True)
class DamagedPart:
    """Units a return put in «Брак»: one damaged part of one sale line."""

    refund_item_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    sold_from_location_id: uuid.UUID
    display_name: str
    size_label: str | None
    quantity: int


async def register(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    location_id: uuid.UUID,
    parts: Sequence[DamagedPart],
) -> list[DamagedUnit]:
    """One row per unit a return put in the store's «Брак», in the return's
    own transaction. Called by the refund command, which moved the stock."""
    units = [
        DamagedUnit(
            organization_id=organization_id,
            store_id=store_id,
            location_id=location_id,
            product_variant_id=part.product_variant_id,
            size_id=part.size_id,
            refund_item_id=part.refund_item_id,
            sold_from_location_id=part.sold_from_location_id,
            display_name=part.display_name,
            size_label=part.size_label,
        )
        for part in parts
        for _ in range(part.quantity)
    ]
    session.add_all(units)
    await session.flush()
    return units


async def units_in_bin(
    session: AsyncSession, *, scope: RequestScope, store_id: uuid.UUID
) -> list[DamagedUnit]:
    """The store's «Брак»: waiting first, then being looked at, then confirmed;
    oldest first within each."""
    scope.require(Permission.DAMAGED_HANDLE, store_id)
    order = case(
        (DamagedUnit.status == DamagedStatus.AWAITING.value, 0),
        (DamagedUnit.status == DamagedStatus.INSPECTING.value, 1),
        else_=2,
    )
    return list(
        (
            await session.scalars(
                select(DamagedUnit)
                .where(
                    DamagedUnit.organization_id == scope.organization_id,
                    DamagedUnit.store_id == store_id,
                    DamagedUnit.status.in_([status.value for status in IN_BIN]),
                )
                .order_by(order, DamagedUnit.created_at, DamagedUnit.id)
            )
        ).all()
    )


async def _locked(session: AsyncSession, *, scope: RequestScope, unit_id: uuid.UUID) -> DamagedUnit:
    unit = await session.scalar(
        select(DamagedUnit)
        .where(DamagedUnit.id == unit_id, DamagedUnit.organization_id == scope.organization_id)
        .with_for_update()
    )
    if unit is None:
        raise NotFoundError("Damaged unit not found", damaged_unit_id=str(unit_id))
    scope.require(Permission.DAMAGED_HANDLE, unit.store_id)
    return unit


def _refuse(unit: DamagedUnit, *expected: DamagedStatus) -> NoReturn:
    raise DamagedUnitChangedError(
        damaged_unit_id=str(unit.id),
        expected=[status.value for status in expected],
        actual=unit.status,
        by_user_id=str(unit.status_by_user_id) if unit.status_by_user_id else None,
    )


async def _moved(
    session: AsyncSession,
    *,
    scope: RequestScope,
    unit: DamagedUnit,
    status: DamagedStatus,
    action: str,
    before: str,
    note: str | None = None,
    transfer_id: uuid.UUID | None = None,
    stock_adjustment_id: uuid.UUID | None = None,
    supplier_return_id: uuid.UUID | None = None,
) -> DamagedUnit:
    # The time first: a query flushes, and the status and the ledger fact it
    # names must reach the database together (the row's CHECKs hold them so).
    now = await session.scalar(select(func.now()))
    unit.status = status.value
    unit.status_by_user_id = scope.user_id
    unit.status_at = now
    unit.transfer_id = transfer_id or unit.transfer_id
    unit.stock_adjustment_id = stock_adjustment_id or unit.stock_adjustment_id
    # Only while the return stands: a cancelled one is kept by its own history.
    unit.supplier_return_id = supplier_return_id
    if note is not None:
        unit.note = note
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action=action,
        entity_type="damaged_unit",
        entity_id=unit.id,
        before={"status": before},
        after={
            "status": unit.status,
            "transfer_id": str(unit.transfer_id) if unit.transfer_id else None,
            "stock_adjustment_id": str(unit.stock_adjustment_id)
            if unit.stock_adjustment_id
            else None,
            "supplier_return_id": str(unit.supplier_return_id) if unit.supplier_return_id else None,
        },
        reason=note,
    )
    logger.info(action, damaged_unit_id=str(unit.id), store_id=str(unit.store_id))
    return unit


async def take(session: AsyncSession, *, scope: RequestScope, unit_id: uuid.UUID) -> DamagedUnit:
    """«Взяти на перевірку»: from waiting, or from confirmed for a second look."""
    unit = await _locked(session, scope=scope, unit_id=unit_id)
    if unit.status == DamagedStatus.INSPECTING and unit.status_by_user_id == scope.user_id:
        return unit
    if unit.status not in {DamagedStatus.AWAITING, DamagedStatus.CONFIRMED}:
        _refuse(unit, DamagedStatus.AWAITING, DamagedStatus.CONFIRMED)
    return await _moved(
        session,
        scope=scope,
        unit=unit,
        status=DamagedStatus.INSPECTING,
        action="damaged.taken",
        before=unit.status,
    )


async def confirm(
    session: AsyncSession, *, scope: RequestScope, unit_id: uuid.UUID, note: str | None
) -> DamagedUnit:
    """«Брак підтверджений»: it stays in «Брак», no longer for sale."""
    unit = await _locked(session, scope=scope, unit_id=unit_id)
    if unit.status == DamagedStatus.CONFIRMED:
        return unit
    if unit.status != DamagedStatus.INSPECTING:
        _refuse(unit, DamagedStatus.INSPECTING)
    return await _moved(
        session,
        scope=scope,
        unit=unit,
        status=DamagedStatus.CONFIRMED,
        action="damaged.confirmed",
        before=unit.status,
        note=note,
    )


async def _model_now(session: AsyncSession, *, scope: RequestScope, unit: DamagedUnit) -> uuid.UUID:
    """The model a unit's stock is held under now. A unit keeps the name it
    was taken back as, as a sale line does; if that model was merged since,
    its stock is the model that stays (owner decision, 2026-10-03), held as a
    stock command holds a model."""
    leading = await current_variants(
        session, organization_id=scope.organization_id, variant_ids={unit.product_variant_id}
    )
    return leading[unit.product_variant_id]


async def return_to_sale(
    session: AsyncSession,
    *,
    scope: RequestScope,
    unit_id: uuid.UUID,
    destination_location_id: uuid.UUID,
    correlation_id: str | None = None,
) -> DamagedUnit:
    """Back on sale, in the warehouse it was sold from — the one the person
    was shown and confirmed, which must still be that one.

    A unit handed back at a store that does not reach that warehouse — one
    sold from another store's own — goes to a warehouse of this store's that
    the person chooses instead, as intact goods taken back there do (owner
    decision, 2026-10-01)."""
    unit = await _locked(session, scope=scope, unit_id=unit_id)
    if unit.status == DamagedStatus.RETURNED:
        return unit
    if unit.status != DamagedStatus.INSPECTING:
        _refuse(unit, DamagedStatus.INSPECTING)
    if destination_location_id != unit.sold_from_location_id:
        own = await back_on_sale_locations(
            session, organization_id=scope.organization_id, store_id=unit.store_id
        )
        if unit.sold_from_location_id in own or destination_location_id not in own:
            raise ValidationFailedError(
                "A unit goes back on sale only to the warehouse it was sold from, or — "
                "where this store does not reach that one — to one of this store's own",
                damaged_unit_id=str(unit.id),
                sold_from_location_id=str(unit.sold_from_location_id),
            )
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.DAMAGED_HANDLE,
        store_id=unit.store_id,
        location_ids={unit.location_id, destination_location_id},
        capability=LocationCapability.RECEIVE,
    )
    moved = await move_goods(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        store_id=unit.store_id,
        command_id=uuid.uuid5(STEPS, f"{unit.id}:returned"),
        command_fingerprint=idempotency.fingerprint(
            {"damaged_unit_id": str(unit.id), "to": str(destination_location_id)},
            actor_user_id=scope.user_id,
            store_id=unit.store_id,
        ),
        from_location_id=unit.location_id,
        to_location_id=destination_location_id,
        lines=[
            TransferLineInput(
                product_variant_id=await _model_now(session, scope=scope, unit=unit),
                size_id=unit.size_id,
                quantity=1,
            )
        ],
        correlation_id=correlation_id,
        damaged_stock=True,
        reason="Back on sale from «Брак» after inspection",
    )
    return await _moved(
        session,
        scope=scope,
        unit=unit,
        status=DamagedStatus.RETURNED,
        action="damaged.returned_to_sale",
        before=unit.status,
        transfer_id=moved.transfer.id,
    )


async def write_off(
    session: AsyncSession,
    *,
    scope: RequestScope,
    unit_id: uuid.UUID,
    note: str | None,
    correlation_id: str | None = None,
) -> DamagedUnit:
    """A confirmed unit written off: gone from «Брак», and from stock."""
    unit = await _locked(session, scope=scope, unit_id=unit_id)
    if unit.status == DamagedStatus.WRITTEN_OFF:
        return unit
    if unit.status != DamagedStatus.CONFIRMED:
        _refuse(unit, DamagedStatus.CONFIRMED)
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.DAMAGED_HANDLE,
        store_id=unit.store_id,
        location_ids={unit.location_id},
        capability=LocationCapability.RECEIVE,
    )
    recorded = await record_adjustment(
        session,
        organization_id=scope.organization_id,
        store_id=unit.store_id,
        actor_user_id=scope.user_id,
        command_id=uuid.uuid5(STEPS, f"{unit.id}:written-off"),
        command_fingerprint=None,
        location_id=unit.location_id,
        product_variant_id=await _model_now(session, scope=scope, unit=unit),
        size_id=unit.size_id,
        quantity_delta=-1,
        reason_code=MovementReason.DAMAGED,
        note=note or "Written off from «Брак»",
        correlation_id=correlation_id,
        damaged_stock=True,
    )
    return await _moved(
        session,
        scope=scope,
        unit=unit,
        status=DamagedStatus.WRITTEN_OFF,
        action="damaged.written_off",
        before=unit.status,
        note=note,
        stock_adjustment_id=recorded.adjustment.id,
    )


async def return_to_supplier(
    session: AsyncSession,
    *,
    scope: RequestScope,
    unit_id: uuid.UUID,
    supplier_id: uuid.UUID,
    note: str | None,
    correlation_id: str | None = None,
) -> DamagedUnit:
    """A confirmed unit back to its supplier instead of written off: gone from
    «Брак» while that return stands. The owner's and managers' to do."""
    unit = await _locked(session, scope=scope, unit_id=unit_id)
    scope.require(Permission.SUPPLIER_RETURN, unit.store_id)
    if unit.status == DamagedStatus.SUPPLIER:
        return unit
    if unit.status != DamagedStatus.CONFIRMED:
        _refuse(unit, DamagedStatus.CONFIRMED)
    remark = suppliers.clean_note(note)
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.SUPPLIER_RETURN,
        store_id=unit.store_id,
        location_ids={unit.location_id},
        capability=LocationCapability.RECEIVE,
    )
    # Derived from the unit and how often it went back before, so a second
    # transaction could never send it twice, and a unit whose return was
    # cancelled can go back again.
    times = await suppliers.returns_of_unit(session, damaged_unit_id=unit.id)
    row = await suppliers.record_return(
        session,
        organization_id=scope.organization_id,
        store_id=unit.store_id,
        actor_user_id=scope.user_id,
        command_id=uuid.uuid5(STEPS, f"{unit.id}:supplier:{times}"),
        command_fingerprint=idempotency.fingerprint(
            {"damaged_unit_id": str(unit.id), "supplier_id": str(supplier_id), "note": remark},
            actor_user_id=scope.user_id,
            store_id=unit.store_id,
        ),
        location_id=unit.location_id,
        supplier_id=supplier_id,
        lines=[
            suppliers.ReturnLine(
                product_variant_id=await _model_now(session, scope=scope, unit=unit),
                size_id=unit.size_id,
                quantity=1,
            )
        ],
        note=remark,
        correlation_id=correlation_id,
        damaged_unit_id=unit.id,
    )
    return await _moved(
        session,
        scope=scope,
        unit=unit,
        status=DamagedStatus.SUPPLIER,
        action="damaged.returned_to_supplier",
        before=unit.status,
        supplier_return_id=row.id,
    )


async def cancel_supplier_return(
    session: AsyncSession,
    *,
    scope: RequestScope,
    unit_id: uuid.UUID,
    supplier_return_id: uuid.UUID,
    reason: str,
    correlation_id: str | None = None,
) -> DamagedUnit:
    """That return cancelled, saying why: the unit is back in «Брак», damage
    confirmed. Once: cancelling it again answers with the unit as it is."""
    unit = await _locked(session, scope=scope, unit_id=unit_id)
    scope.require(Permission.SUPPLIER_RETURN, unit.store_id)
    why = suppliers.clean_reason(reason)
    row = await suppliers.locked_return(
        session, organization_id=scope.organization_id, supplier_return_id=supplier_return_id
    )
    if row.damaged_unit_id != unit.id:
        raise NotFoundError(
            "Unknown return to a supplier", supplier_return_id=str(supplier_return_id)
        )
    if await suppliers.is_cancelled(session, supplier_return_id=row.id):
        return unit
    if unit.status != DamagedStatus.SUPPLIER or unit.supplier_return_id != row.id:
        _refuse(unit, DamagedStatus.SUPPLIER)
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.SUPPLIER_RETURN,
        store_id=unit.store_id,
        location_ids={unit.location_id},
        capability=LocationCapability.RECEIVE,
    )
    await suppliers.record_cancel(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        supplier_return=row,
        reason=why,
        correlation_id=correlation_id,
    )
    return await _moved(
        session,
        scope=scope,
        unit=unit,
        status=DamagedStatus.CONFIRMED,
        action="damaged.supplier_return_cancelled",
        before=unit.status,
    )


__all__ = [
    "DamagedPart",
    "cancel_supplier_return",
    "confirm",
    "register",
    "return_to_sale",
    "return_to_supplier",
    "take",
    "units_in_bin",
    "write_off",
]
