"""Inventory service — the single door through which stock changes.

Every caller (sales, refunds, transfers, receipts) hands this module a list of
movements and gets back what the quantities became. It guarantees three things
the callers must not have to remember:

1. **A movement row for every quantity change** (invariant I3). The pair is
   written here, together, or not at all.
2. **A deterministic order** across concurrent transactions, so two multi-line
   commands touching the same items cannot deadlock each other.
3. **No oversell** (invariants I1/I6): decrements are conditional single
   statements, so a shortfall is reported rather than written.

It does not open or commit transactions — the calling command owns the unit of
work (`.ai/conventions.md`).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InsufficientStockError, ValidationFailedError
from app.core.logging import get_logger
from app.modules.catalog.validation import validate_stock_references
from app.modules.inventory import repository
from app.modules.inventory.models import Inventory, MovementReason, MovementType
from app.modules.tenancy.service import (
    accessible_locations,
    require_location_access,
    validate_active_locations,
    validate_active_stores,
)

logger = get_logger(__name__)

# Movement types whose direction is fixed by their meaning. ADJUSTMENT and
# STOCKTAKE_CORRECTION are absent on purpose: those are the two that may go
# either way, and the caller must say which.
DIRECTION: dict[MovementType, int] = {
    MovementType.SALE: -1,
    MovementType.TRANSFER_OUT: -1,
    MovementType.DELIVERY: +1,
    MovementType.REFUND_RETURN: +1,
    MovementType.TRANSFER_IN: +1,
    MovementType.OPENING_BALANCE: +1,
}


@dataclass(frozen=True, slots=True)
class MovementRequest:
    """One quantity change to apply. `quantity_delta` is signed.

    `location_id` is where the quantity changes; `acting_store_id` is which
    store is responsible for it. A shared warehouse is exactly where those two
    differ, which is why they are separate fields rather than one (ADR-0004).
    """

    location_id: uuid.UUID
    acting_store_id: uuid.UUID | None
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity_delta: int
    movement_type: MovementType
    reason_code: MovementReason | None = None
    stock_lot_id: uuid.UUID | None = None
    reference_type: str | None = None
    reference_id: uuid.UUID | None = None

    @property
    def sort_key(self) -> tuple[str, str, str]:
        """Deterministic ordering key.

        The plan proposed ordering by `inventory.id`, but an incoming delivery
        may have no inventory row yet. The natural key is equally deterministic
        across processes and works before the row exists.

        Canonical lowercase-hex UUID text sorts in the same order as the UUIDs
        themselves, so this agrees with `lock_stock`'s tuple sort. Both must
        lead with the location or the global lock order breaks.
        """
        return (str(self.location_id), str(self.product_variant_id), str(self.size_id))


@dataclass(frozen=True, slots=True)
class AppliedMovement:
    request: MovementRequest
    movement_id: uuid.UUID
    quantity_after: int


def validate_movement(request: MovementRequest) -> None:
    """Reject a movement the ledger should never contain.

    Public because it is part of the service contract: callers may validate a
    basket before opening a transaction, and it is directly testable without a
    database.
    """
    if request.quantity_delta == 0:
        raise ValidationFailedError(
            "A movement must change the quantity", movement_type=request.movement_type.value
        )

    expected = DIRECTION.get(request.movement_type)
    if expected is not None and (request.quantity_delta > 0) != (expected > 0):
        # A SALE that adds stock, or a DELIVERY that removes it, is a caller
        # bug that would otherwise produce a plausible-looking ledger entry.
        raise ValidationFailedError(
            f"{request.movement_type.value} must move stock {'up' if expected > 0 else 'down'}",
            movement_type=request.movement_type.value,
            quantity_delta=request.quantity_delta,
        )

    if request.movement_type is MovementType.ADJUSTMENT and request.reason_code is None:
        raise ValidationFailedError(
            "An adjustment must carry a reason code",
            movement_type=request.movement_type.value,
        )


async def lock_stock(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    keys: list[tuple[uuid.UUID, uuid.UUID, uuid.UUID]],
    acting_store_ids: set[uuid.UUID],
) -> dict[tuple[uuid.UUID, uuid.UUID, uuid.UUID], int]:
    """Validate then lock the complete command basket before making decisions.

    Keys are `(location, variant, size)`. Locks, including previously absent
    stock keys, last until commit/rollback. Callers must supply all command
    keys up front, never a partial correction basket followed by a differently
    ordered sale basket.

    `acting_store_ids` has no default on purpose. It is the half of the check
    the re-key nearly deleted — see below — and a caller that forgets it would
    silently stop validating the acting store. An empty set is the honest way
    to say "no store acts here", which today only a transfer can claim.
    """
    ordered = sorted(set(keys))
    if not ordered:
        return {}
    # Both questions, not one. Before the re-key `key[0]` was the store, and
    # this single call proved the tenant and the store's activity on every
    # command. Moving the key to the location would have silently turned it
    # into a location check and left nothing validating the acting store.
    await validate_active_locations(
        session, organization_id=organization_id, location_ids={key[0] for key in ordered}
    )
    if acting_store_ids:
        await validate_active_stores(
            session, organization_id=organization_id, store_ids=acting_store_ids
        )
    await validate_stock_references(
        session,
        organization_id=organization_id,
        variant_ids={key[1] for key in ordered},
        size_ids={key[2] for key in ordered},
    )
    quantities = {}
    for key in ordered:
        quantities[key] = await repository.ensure_and_lock(session, key=key)
    return quantities


async def apply_movements(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    requests: list[MovementRequest],
    actor_user_id: uuid.UUID | None = None,
    correlation_id: str | None = None,
) -> list[AppliedMovement]:
    """Apply every movement, or raise and leave the transaction to roll back.

    Raises `InsufficientStockError` naming the first line that cannot be
    satisfied, so the caller can offer the correction flow (business fact F30)
    instead of a dead end.
    """
    if not requests:
        raise ValidationFailedError("No movements supplied")

    for request in requests:
        validate_movement(request)

    await repository.validate_lot_references(
        session,
        organization_id=organization_id,
        references=[
            (r.stock_lot_id, (r.location_id, r.product_variant_id, r.size_id))
            for r in requests
            if r.stock_lot_id is not None
        ],
    )
    await lock_stock(
        session,
        organization_id=organization_id,
        keys=[(r.location_id, r.product_variant_id, r.size_id) for r in requests],
        acting_store_ids={r.acting_store_id for r in requests if r.acting_store_id is not None},
    )

    applied: list[AppliedMovement] = []

    # Sorting is not cosmetic: two concurrent multi-line commands that touch
    # the same rows in opposite orders will deadlock. Same order, no deadlock.
    for request in sorted(requests, key=lambda r: r.sort_key):
        magnitude = abs(request.quantity_delta)

        if request.quantity_delta < 0:
            quantity_after = await repository.decrement(
                session,
                location_id=request.location_id,
                product_variant_id=request.product_variant_id,
                size_id=request.size_id,
                quantity=magnitude,
            )
            if quantity_after is None:
                available = await repository.current_quantity(
                    session,
                    location_id=request.location_id,
                    product_variant_id=request.product_variant_id,
                    size_id=request.size_id,
                )
                raise InsufficientStockError(
                    product_variant_id=str(request.product_variant_id),
                    size_id=str(request.size_id),
                    requested=magnitude,
                    available=available,
                    correctable=True,
                )
        else:
            quantity_after = await repository.increment(
                session,
                location_id=request.location_id,
                product_variant_id=request.product_variant_id,
                size_id=request.size_id,
                quantity=magnitude,
            )

        movement = await repository.record_movement(
            session,
            organization_id=organization_id,
            location_id=request.location_id,
            acting_store_id=request.acting_store_id,
            product_variant_id=request.product_variant_id,
            size_id=request.size_id,
            movement_type=request.movement_type,
            quantity_delta=request.quantity_delta,
            reason_code=request.reason_code,
            stock_lot_id=request.stock_lot_id,
            reference_type=request.reference_type,
            reference_id=request.reference_id,
            actor_user_id=actor_user_id,
            correlation_id=correlation_id,
        )
        applied.append(
            AppliedMovement(request=request, movement_id=movement.id, quantity_after=quantity_after)
        )

    logger.info(
        "inventory.movements_applied",
        organization_id=str(organization_id),
        lines=len(applied),
        types=sorted({a.request.movement_type.value for a in applied}),
    )
    return applied


@dataclass(frozen=True, slots=True)
class StockRow:
    """One balance, at one place."""

    location_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int


async def readable_stock(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    location_id: uuid.UUID | None = None,
    limit: int = 100,
) -> list[StockRow]:
    """What this store may see, keyed by the place it actually sits.

    Never a per-store total. A shared warehouse is one balance that two stores
    can both reach, and summing it under each of them would put the same coats
    on two reports — the duplication the owner ruled out, reappearing at the
    read layer while the write layer stays correct.

    The query lives here rather than in the router so invariant I23 has
    somewhere to be enforced for reads at all.
    """
    granted = set(
        await accessible_locations(session, organization_id=organization_id, store_id=store_id)
    )
    if location_id is not None:
        await require_location_access(
            session,
            organization_id=organization_id,
            store_id=store_id,
            location_ids={location_id},
            capability=None,
        )
        granted &= {location_id}
    if not granted:
        return []
    rows = (
        await session.scalars(
            select(Inventory)
            .where(Inventory.location_id.in_(granted), Inventory.quantity > 0)
            .order_by(Inventory.location_id, Inventory.product_variant_id, Inventory.size_id)
            .limit(limit)
        )
    ).all()
    return [
        StockRow(
            location_id=row.location_id,
            product_variant_id=row.product_variant_id,
            size_id=row.size_id,
            quantity=row.quantity,
        )
        for row in rows
    ]


async def current_quantity(
    session: AsyncSession,
    *,
    location_id: uuid.UUID,
    product_variant_id: uuid.UUID,
    size_id: uuid.UUID,
) -> int:
    """Quantity on hand. Exposed here so other modules never have to import
    the repository, which is what keeps invariant I3 checkable."""
    return await repository.current_quantity(
        session,
        location_id=location_id,
        product_variant_id=product_variant_id,
        size_id=size_id,
    )


async def find_divergences(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID | None = None,
    location_id: uuid.UUID | None = None,
) -> list[repository.Divergence]:
    """Keys where the quantity and the ledger disagree. Empty is the evidence
    that invariant I3 held.

    Narrow to one warehouse, one tenant, or both — but never, by omission, to
    every tenant at once: an unscoped sweep is a cross-tenant read, and the
    empty argument list is exactly how one would arrive by accident. A single
    location is already tenant-scoped, since it belongs to one organization.
    """
    if organization_id is None and location_id is None:
        raise ValueError("Reconciliation must be scoped to an organization or a location")
    return await repository.reconcile(
        session, organization_id=organization_id, location_id=location_id
    )


__all__ = [
    "DIRECTION",
    "AppliedMovement",
    "MovementRequest",
    "StockRow",
    "apply_movements",
    "current_quantity",
    "find_divergences",
    "lock_stock",
    "readable_stock",
    "refund_return_movement_ids",
    "sale_correction_ids",
    "sale_shortage_ids",
    "validate_movement",
]


async def sale_correction_ids(
    session: AsyncSession, *, organization_id: uuid.UUID, sale_id: uuid.UUID
) -> list[uuid.UUID]:
    """Durable, tenant-scoped correction references for a sale receipt."""
    return await repository.sale_adjustment_ids(
        session,
        organization_id=organization_id,
        sale_id=sale_id,
        reason=MovementReason.FOUND_DURING_SALE,
    )


async def sale_shortage_ids(
    session: AsyncSession, *, organization_id: uuid.UUID, sale_id: uuid.UUID
) -> list[uuid.UUID]:
    """The same, for goods the seller reported missing while making the sale."""
    return await repository.sale_adjustment_ids(
        session,
        organization_id=organization_id,
        sale_id=sale_id,
        reason=MovementReason.MISSING_AT_SALE,
    )


async def refund_return_movement_ids(
    session: AsyncSession, *, organization_id: uuid.UUID, refund_id: uuid.UUID
) -> list[uuid.UUID]:
    """Durable, tenant-scoped restock references for a refund.

    Ordered by the stock key so a replay reads them back the same way twice.
    """
    return await repository.refund_return_movement_ids(
        session, organization_id=organization_id, refund_id=refund_id
    )
