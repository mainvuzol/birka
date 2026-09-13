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

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InsufficientStockError, ValidationFailedError
from app.core.logging import get_logger
from app.modules.inventory import repository
from app.modules.inventory.models import MovementReason, MovementType

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
    """One quantity change to apply. `quantity_delta` is signed."""

    store_id: uuid.UUID
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
        """
        return (str(self.store_id), str(self.product_variant_id), str(self.size_id))


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

    applied: list[AppliedMovement] = []

    # Sorting is not cosmetic: two concurrent multi-line commands that touch
    # the same rows in opposite orders will deadlock. Same order, no deadlock.
    for request in sorted(requests, key=lambda r: r.sort_key):
        magnitude = abs(request.quantity_delta)

        if request.quantity_delta < 0:
            quantity_after = await repository.decrement(
                session,
                store_id=request.store_id,
                product_variant_id=request.product_variant_id,
                size_id=request.size_id,
                quantity=magnitude,
            )
            if quantity_after is None:
                available = await repository.current_quantity(
                    session,
                    store_id=request.store_id,
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
                store_id=request.store_id,
                product_variant_id=request.product_variant_id,
                size_id=request.size_id,
                quantity=magnitude,
            )

        movement = await repository.record_movement(
            session,
            organization_id=organization_id,
            store_id=request.store_id,
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


async def find_divergences(
    session: AsyncSession, *, store_id: uuid.UUID | None = None
) -> list[repository.Divergence]:
    """Keys where the quantity and the ledger disagree. Empty is the evidence
    that invariant I3 held. Narrow to one store with `store_id`."""
    return await repository.reconcile(session, store_id=store_id)


__all__ = [
    "DIRECTION",
    "AppliedMovement",
    "MovementRequest",
    "apply_movements",
    "find_divergences",
    "validate_movement",
]
