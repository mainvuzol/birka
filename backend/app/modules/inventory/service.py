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

import hashlib
import uuid
from collections import Counter
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    InsufficientStockError,
    OpeningBalanceConflictError,
    PermissionDeniedError,
    ValidationFailedError,
)
from app.core.logging import get_logger
from app.modules.authz.locations import readable_location_ids, require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.read import unknown_size_ids
from app.modules.catalog.validation import validate_stock_references
from app.modules.inventory import repository
from app.modules.inventory.models import (
    AcquisitionType,
    Inventory,
    MovementReason,
    MovementType,
    StockLot,
)
from app.modules.tenancy.service import (
    accessible_locations,
    require_location_access,
    validate_active_locations,
    validate_active_stores,
    validate_locations,
)

logger = get_logger(__name__)

# Movement types whose direction is fixed by their meaning. ADJUSTMENT and
# STOCKTAKE_CORRECTION are absent on purpose: those are the two that may go
# either way, and the caller must say which.
DIRECTION: dict[MovementType, int] = {
    MovementType.SALE: -1,
    MovementType.ORDER_DISPATCH: -1,
    MovementType.ORDER_RETURN: +1,
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

    if request.movement_type is MovementType.OPENING_BALANCE and (
        request.reference_type != OPENING_BALANCE_REFERENCE
        or request.reference_id is None
        or request.stock_lot_id is None
    ):
        # Invariant I17's other half: an opening balance is only ever the
        # approved answer to a legacy list, with the lot that traces it there.
        # `apply_opening_balance` is the one caller that writes it, and the
        # database refuses any other shape, or a lot of another list (`0015`).
        raise ValidationFailedError(
            "An opening balance must name the stock list and lot it comes from",
            movement_type=request.movement_type.value,
        )


def _warehouse_lock_key(location_id: uuid.UUID) -> int:
    """One advisory-lock key per warehouse, in a namespace of its own."""
    digest = hashlib.sha256(b"warehouse-ledger:" + location_id.bytes).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


# What an opening balance's movements point back at: the legacy list itself.
OPENING_BALANCE_REFERENCE = "inventory_snapshot"

# What a transfer's two legs point back at. Defined here rather than in the
# transfers module because the ledger is the one that has to recognise a pair,
# and inventory may not import transfers (ADR-0001).
TRANSFER_REFERENCE = "transfer"
TRANSFER_TYPES = frozenset({MovementType.TRANSFER_OUT, MovementType.TRANSFER_IN})

# The two halves of giving goods held with their size not known a size (F34).
SIZE_RECLASSIFICATION_REASONS = frozenset(
    {MovementReason.SIZE_RECLASSIFICATION_OUT, MovementReason.SIZE_RECLASSIFICATION_IN}
)


def validate_location_flows(requests: list[MovementRequest]) -> None:
    """Invariant I24: a transfer is always a pair.

    Every `TRANSFER_OUT` has exactly one `TRANSFER_IN` of the same variant,
    size and magnitude, at a *different* location, naming the same transfer —
    and every `TRANSFER_IN` has its `TRANSFER_OUT`. Half a transfer is stock
    that vanished or appeared, and this is the one door both halves must pass
    through together.

    Deliberately **not** checked here: that nothing *else* moves goods between
    places. A rule of the form "no plus at one location beside a minus at
    another" looks natural and is wrong at this door, because a door is not a
    command. The sale writes its in-sale corrections in one call and its lines
    in another, and a single basket may confirm two coats on one shelf that the
    app thought empty (`FOUND_DURING_SALE`, +2) while finding one missing from
    another (`MISSING_AT_SALE`, -1). Those are two bounded observations the
    owner approved (I18, I25), not a move — and a net-flow check on that call
    refused a real sale when it was tried. That half of I24 is kept by
    construction instead: the transfer is the only command that writes a
    transfer, and every command that exists nets no location upward while
    netting another downward.
    """
    legs: dict[tuple[uuid.UUID, uuid.UUID, uuid.UUID], list[MovementRequest]] = {}
    for request in requests:
        if request.movement_type not in TRANSFER_TYPES:
            continue
        if request.reference_type != TRANSFER_REFERENCE or request.reference_id is None:
            raise ValidationFailedError(
                "A transfer movement must name the transfer it belongs to",
                movement_type=request.movement_type.value,
            )
        group = (request.reference_id, request.product_variant_id, request.size_id)
        legs.setdefault(group, []).append(request)

    for (transfer_id, variant_id, size_id), group_legs in legs.items():
        outs = [leg for leg in group_legs if leg.movement_type is MovementType.TRANSFER_OUT]
        ins = [leg for leg in group_legs if leg.movement_type is MovementType.TRANSFER_IN]
        details = {
            "transfer_id": str(transfer_id),
            "product_variant_id": str(variant_id),
            "size_id": str(size_id),
        }
        if len(outs) != 1 or len(ins) != 1:
            raise ValidationFailedError(
                "A transfer must take goods out of exactly one location and into exactly one",
                transfer_out=len(outs),
                transfer_in=len(ins),
                **details,
            )
        if outs[0].location_id == ins[0].location_id:
            raise ValidationFailedError(
                "A transfer must move goods between two different locations", **details
            )
        if -outs[0].quantity_delta != ins[0].quantity_delta:
            raise ValidationFailedError(
                "A transfer must put in exactly what it takes out",
                taken_out=-outs[0].quantity_delta,
                put_in=ins[0].quantity_delta,
                **details,
            )


def validate_size_reclassifications(requests: list[MovementRequest]) -> None:
    """F34: goods get their size in one piece, never half of one.

    Milestone plan §4.9. One negative `ADJUSTMENT` takes the units out of the
    size-not-known balance (`SIZE_RECLASSIFICATION_OUT`), and positive ones put
    them into the sizes they turned out to be (`SIZE_RECLASSIFICATION_IN`).
    Both halves share one warehouse, one model and one command, and exactly as
    many units go in as come out. Anything less is stock that changed size
    with no trace of where it came from.

    Which sizes may stand on each side needs the catalog, and
    `_apply_movements` checks it: out of "size not known" only, into a real
    size only.
    """
    groups: dict[
        tuple[str | None, uuid.UUID | None, uuid.UUID, uuid.UUID], list[MovementRequest]
    ] = {}
    for request in requests:
        if request.reason_code not in SIZE_RECLASSIFICATION_REASONS:
            continue
        details = {
            "reason_code": request.reason_code.value,
            "product_variant_id": str(request.product_variant_id),
            "size_id": str(request.size_id),
        }
        outgoing = request.reason_code is MovementReason.SIZE_RECLASSIFICATION_OUT
        if request.movement_type is not MovementType.ADJUSTMENT or (
            (request.quantity_delta < 0) != outgoing
        ):
            raise ValidationFailedError(
                "A size reclassification is an adjustment out of one size and into another",
                movement_type=request.movement_type.value,
                quantity_delta=request.quantity_delta,
                **details,
            )
        if request.reference_type is None or request.reference_id is None:
            raise ValidationFailedError(
                "A size reclassification must name the command it belongs to", **details
            )
        group = (
            request.reference_type,
            request.reference_id,
            request.location_id,
            request.product_variant_id,
        )
        groups.setdefault(group, []).append(request)

    for (_, reference_id, location_id, variant_id), legs in groups.items():
        outs = [leg for leg in legs if leg.reason_code is MovementReason.SIZE_RECLASSIFICATION_OUT]
        ins = [leg for leg in legs if leg.reason_code is MovementReason.SIZE_RECLASSIFICATION_IN]
        details = {
            "reference_id": str(reference_id),
            "location_id": str(location_id),
            "product_variant_id": str(variant_id),
        }
        if len(outs) != 1 or not ins:
            raise ValidationFailedError(
                "A size reclassification takes goods out of exactly one size and into others",
                taken_out=len(outs),
                put_in=len(ins),
                **details,
            )
        sizes = [leg.size_id for leg in ins]
        if len(set(sizes)) != len(sizes) or outs[0].size_id in sizes:
            raise ValidationFailedError(
                "A size reclassification puts goods into sizes other than the one they left",
                **details,
            )
        if -outs[0].quantity_delta != sum(leg.quantity_delta for leg in ins):
            raise ValidationFailedError(
                "A size reclassification must put in exactly what it takes out",
                taken_out=-outs[0].quantity_delta,
                put_in=sum(leg.quantity_delta for leg in ins),
                **details,
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
    # An opening balance must see a ledger nobody else is writing (ADR-0005
    # §5). So every command that moves or reserves stock comes through here
    # and holds a *shared* lock on each warehouse it touches until it commits;
    # the opening balance takes the same lock exclusively, first, and waits for
    # all of them. Shared locks never wait for each other, and they are taken
    # in location order before any row lock, so no two stock commands can
    # deadlock on them.
    for location_id in sorted({key[0] for key in ordered}):
        await session.execute(
            select(func.pg_advisory_xact_lock_shared(_warehouse_lock_key(location_id)))
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

    Never an opening balance. Only `apply_opening_balance` writes one, after
    holding the warehouse exclusively and proving it has no stock history
    (ADR-0005 §5); a caller that could write one here would skip both.
    """
    if any(request.movement_type is MovementType.OPENING_BALANCE for request in requests):
        raise ValidationFailedError(
            "An opening balance is written only by approving a stock list",
            movement_type=MovementType.OPENING_BALANCE.value,
        )
    return await _apply_movements(
        session,
        organization_id=organization_id,
        requests=requests,
        actor_user_id=actor_user_id,
        correlation_id=correlation_id,
    )


async def _apply_movements(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    requests: list[MovementRequest],
    actor_user_id: uuid.UUID | None,
    correlation_id: str | None,
) -> list[AppliedMovement]:
    """The ledger door itself, shared by `apply_movements` and `apply_opening_balance`."""
    if not requests:
        raise ValidationFailedError("No movements supplied")

    for request in requests:
        validate_movement(request)
    validate_location_flows(requests)
    validate_size_reclassifications(requests)
    reclassified = [r for r in requests if r.reason_code in SIZE_RECLASSIFICATION_REASONS]
    if reclassified:
        unknown = await unknown_size_ids(session, organization_id=organization_id)
        for request in reclassified:
            if (request.reason_code is MovementReason.SIZE_RECLASSIFICATION_OUT) != (
                request.size_id in unknown
            ):
                raise ValidationFailedError(
                    "Only goods held with their size not known are reclassified, "
                    "and only into a size",
                    reason_code=request.reason_code.value if request.reason_code else None,
                    size_id=str(request.size_id),
                )

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

    reserved = await reserved_stock(
        session, keys=[(r.location_id, r.product_variant_id, r.size_id) for r in requests]
    )
    for request in requests:
        if request.movement_type in {
            MovementType.ADJUSTMENT,
            MovementType.STOCKTAKE_CORRECTION,
        } and reserved.get((request.location_id, request.product_variant_id, request.size_id), 0):
            raise ValidationFailedError("Release reservations before correcting this stock key")

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
                physical = await repository.current_quantity(
                    session,
                    location_id=request.location_id,
                    product_variant_id=request.product_variant_id,
                    size_id=request.size_id,
                )
                raise InsufficientStockError(
                    location_id=str(request.location_id),
                    product_variant_id=str(request.product_variant_id),
                    size_id=str(request.size_id),
                    requested=magnitude,
                    available=physical
                    - reserved.get(
                        (request.location_id, request.product_variant_id, request.size_id), 0
                    ),
                    # Only a sale has a correction to offer (FOUND_DURING_SALE,
                    # business fact F30). Telling a transfer or an adjustment
                    # it could "correct" its way past a shortfall would point
                    # the client at a flow that does not exist for it.
                    correctable=(
                        request.movement_type is MovementType.SALE
                        and not reserved.get(
                            (request.location_id, request.product_variant_id, request.size_id), 0
                        )
                    ),
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
    reserved_quantity: int
    available_quantity: int


async def readable_stock(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    location_id: uuid.UUID | None = None,
    limit: int = 100,
    offset: int = 0,
    scope: RequestScope | None = None,
) -> list[StockRow]:
    """What this store may see, keyed by the place it actually sits.

    Never a per-store total. A shared warehouse is one balance that two stores
    can both reach, and summing it under each of them would put the same coats
    on two reports — the duplication the owner ruled out, reappearing at the
    read layer while the write layer stays correct.

    The query lives here rather than in the router so invariant I23 has
    somewhere to be enforced for reads at all.
    """
    if scope is not None:
        if scope.organization_id != organization_id:
            raise PermissionDeniedError("Stock scope organization mismatch")
        scope.require(Permission.INVENTORY_VIEW, store_id)
    granted = set(
        await accessible_locations(session, organization_id=organization_id, store_id=store_id)
    )
    granted = await readable_location_ids(
        session,
        organization_id=organization_id,
        store_id=store_id,
        location_ids=granted,
        scope=scope,
    )
    if location_id is not None:
        await require_location_access(
            session,
            organization_id=organization_id,
            store_id=store_id,
            location_ids={location_id},
            capability=None,
        )
        if scope is not None:
            await require_stock_access(
                session,
                scope=scope,
                store_id=store_id,
                location_ids={location_id},
                capability=None,
                permission=Permission.INVENTORY_VIEW,
            )
        if location_id not in granted:
            raise PermissionDeniedError("Private stock requires a direct store permission")
        granted &= {location_id}
    if not granted:
        return []
    rows = (
        await session.scalars(
            select(Inventory)
            .where(Inventory.location_id.in_(granted), Inventory.quantity > 0)
            .order_by(Inventory.location_id, Inventory.product_variant_id, Inventory.size_id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return [
        StockRow(
            location_id=row.location_id,
            product_variant_id=row.product_variant_id,
            size_id=row.size_id,
            quantity=row.quantity,
            reserved_quantity=row.reserved_quantity,
            available_quantity=row.quantity - row.reserved_quantity,
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
    "OPENING_BALANCE_REFERENCE",
    "SIZE_RECLASSIFICATION_REASONS",
    "TRANSFER_REFERENCE",
    "TRANSFER_TYPES",
    "AppliedMovement",
    "MovementRequest",
    "OpenedLine",
    "OpeningBalanceLine",
    "StockRow",
    "apply_movements",
    "apply_opening_balance",
    "current_quantity",
    "find_divergences",
    "lock_stock",
    "opening_balance_movement_ids",
    "readable_stock",
    "refund_return_movement_ids",
    "sale_correction_ids",
    "sale_reclassification_ids",
    "sale_shortage_ids",
    "transfer_movement_ids",
    "validate_location_flows",
    "validate_movement",
    "validate_size_reclassifications",
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


async def sale_reclassification_ids(
    session: AsyncSession, *, organization_id: uuid.UUID, sale_id: uuid.UUID
) -> list[uuid.UUID]:
    """Both halves of every size the seller read off a coat while making the sale.

    Ordered by the stock key, then the movement, so a durable replay lists
    them the way the original response did.
    """
    return await repository.sale_reclassification_ids(
        session, organization_id=organization_id, sale_id=sale_id
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


async def transfer_movement_ids(
    session: AsyncSession, *, organization_id: uuid.UUID, transfer_id: uuid.UUID
) -> list[uuid.UUID]:
    """Both legs of a transfer, read back in one stable order.

    Ordered by the stock key, so a durable replay reads them the way the
    original response listed them.
    """
    return await repository.transfer_movement_ids(
        session, organization_id=organization_id, transfer_id=transfer_id
    )


@dataclass(frozen=True, slots=True)
class ReservationRequest:
    location_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int


async def reserved_stock(
    session: AsyncSession, *, keys: list[tuple[uuid.UUID, uuid.UUID, uuid.UUID]]
) -> dict[tuple[uuid.UUID, uuid.UUID, uuid.UUID], int]:
    """Read reservations after lock_stock has locked the complete command basket."""
    return await repository.reserved_quantities(session, keys=keys)


async def available_stock(
    session: AsyncSession, *, keys: list[tuple[uuid.UUID, uuid.UUID, uuid.UUID]]
) -> dict[tuple[uuid.UUID, uuid.UUID, uuid.UUID], int]:
    """On hand less reserved, as of one committed state (see the repository)."""
    return await repository.available_quantities(session, keys=keys)


async def reserve_stock(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    reference_id: uuid.UUID,
    requests: list[ReservationRequest],
    actor_user_id: uuid.UUID,
) -> None:
    demand: dict[tuple[uuid.UUID, uuid.UUID, uuid.UUID], int] = {}
    for request in requests:
        if type(request.quantity) is not int or request.quantity <= 0:
            raise ValidationFailedError("Reservation quantity must be a positive integer")
        key = (request.location_id, request.product_variant_id, request.size_id)
        demand[key] = demand.get(key, 0) + request.quantity
    if not demand:
        raise ValidationFailedError("No reservations supplied")
    existing = await repository.reservation_rows(
        session, organization_id=organization_id, reference_id=reference_id
    )
    physical = await lock_stock(
        session, organization_id=organization_id, keys=list(demand), acting_store_ids={store_id}
    )
    if existing:
        previous = {(r.location_id, r.product_variant_id, r.size_id): r.quantity for r in existing}
        if previous != demand or any(r.store_id != store_id for r in existing):
            raise ValidationFailedError("Reservation reference has different stock or store")
        # An inactive historical reservation must never be resurrected by retry.
        return
    reserved = await reserved_stock(session, keys=list(demand))
    for key, quantity in demand.items():
        available = physical[key] - reserved.get(key, 0)
        if quantity > available:
            raise InsufficientStockError(
                location_id=str(key[0]),
                product_variant_id=str(key[1]),
                size_id=str(key[2]),
                requested=quantity,
                available=available,
                correctable=False,
            )
    for key, quantity in sorted(demand.items()):
        await repository.change_reserved(session, key=key, delta=quantity)
        await repository.add_reservation(
            session,
            organization_id=organization_id,
            store_id=store_id,
            reference_id=reference_id,
            location_id=key[0],
            product_variant_id=key[1],
            size_id=key[2],
            quantity=quantity,
            actor_user_id=actor_user_id,
        )


async def _finish_reservations(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    reference_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    dispatch: bool,
) -> list[AppliedMovement]:
    rows = await repository.reservation_rows(
        session, organization_id=organization_id, reference_id=reference_id
    )
    if any(row.store_id != store_id for row in rows):
        raise PermissionDeniedError("Reservation belongs to another store")
    active = [r for r in rows if r.active]
    if not active:
        return []
    keys = [(r.location_id, r.product_variant_id, r.size_id) for r in active]
    if dispatch:
        await lock_stock(
            session,
            organization_id=organization_id,
            keys=keys,
            acting_store_ids={store_id},
        )
    else:
        # A pause blocks physical movement, not cancellation of an existing
        # hold. The tenant/store match was established on the reservation
        # rows above and is backed by their composite foreign keys.
        await validate_locations(
            session,
            organization_id=organization_id,
            location_ids={key[0] for key in keys},
            must_be_active=False,
        )
        await repository.lock_existing_stock(session, keys=keys)
    movements = []
    for row in sorted(active, key=lambda r: (r.location_id, r.product_variant_id, r.size_id)):
        await repository.change_reserved(
            session, key=(row.location_id, row.product_variant_id, row.size_id), delta=-row.quantity
        )
        await repository.deactivate_reservation(session, row)
        movements.append(
            MovementRequest(
                location_id=row.location_id,
                acting_store_id=store_id,
                product_variant_id=row.product_variant_id,
                size_id=row.size_id,
                quantity_delta=-row.quantity,
                movement_type=MovementType.ORDER_DISPATCH,
                reference_type="customer_order",
                reference_id=reference_id,
            )
        )
    if dispatch:
        return await apply_movements(
            session,
            organization_id=organization_id,
            requests=movements,
            actor_user_id=actor_user_id,
        )
    return []


async def release_stock(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    reference_id: uuid.UUID,
    actor_user_id: uuid.UUID,
) -> None:
    await _finish_reservations(
        session,
        organization_id=organization_id,
        store_id=store_id,
        reference_id=reference_id,
        actor_user_id=actor_user_id,
        dispatch=False,
    )


async def dispatch_reserved_stock(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    reference_id: uuid.UUID,
    actor_user_id: uuid.UUID,
) -> list[AppliedMovement]:
    return await _finish_reservations(
        session,
        organization_id=organization_id,
        store_id=store_id,
        reference_id=reference_id,
        actor_user_id=actor_user_id,
        dispatch=True,
    )


@dataclass(frozen=True, slots=True)
class OpeningBalanceLine:
    """One quantity a person stated was on hand.

    `reference_id` is the caller's own row for it (a snapshot allocation),
    echoed back so the caller can link each line to the lot it became.
    """

    reference_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int


@dataclass(frozen=True, slots=True)
class OpenedLine:
    line: OpeningBalanceLine
    stock_lot_id: uuid.UUID
    movement_id: uuid.UUID


async def apply_opening_balance(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    location_id: uuid.UUID,
    acting_store_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    lines: list[OpeningBalanceLine],
    actor_user_id: uuid.UUID,
    correlation_id: str | None = None,
) -> list[OpenedLine]:
    """Open a warehouse's ledger from a legacy list: all of it, or none.

    Invariant I17: the only movement written is `OPENING_BALANCE`, one per
    line, each with its own `StockLot` (`acquisition_type = OPENING_BALANCE`,
    linked to the snapshot), so every unit traces back to the line of the list
    it came from. Nothing here can write a delivery, a sale or an adjustment.

    **Only into a warehouse with no stock history** (ADR-0005 §5). A balance
    counted on paper cannot be added to a warehouse the app already tracks
    without counting twice what it already knows; bringing a tracked
    warehouse to a count is a stocktake, which can go down as well as up.

    Lock order: the warehouse's advisory lock, **exclusively**. Every command
    that moves or reserves stock holds it shared while it writes there
    (`lock_stock`), so this waits for all of them and admits none until it
    commits: a receipt, a sale, a reservation or a transfer at this warehouse
    — on any key, not only the list's — lands wholly before the history check
    below (and is seen) or wholly after the opening balance. Then every stock
    key in the global order, then the check. (Cancelling an order's
    reservation only lowers `reserved_quantity` under row locks, without this
    lock; a live reservation already means history here, so it cannot turn a
    tracked warehouse into an empty-looking one.)

    This is the only function that writes `OPENING_BALANCE`: `apply_movements`
    refuses it, and the database refuses one that does not trace to an
    opening lot of its list (`0015`).
    """
    if not lines:
        raise ValidationFailedError("An opening balance needs at least one line")
    for line in lines:
        if type(line.quantity) is not int or line.quantity <= 0:
            raise ValidationFailedError("An opening balance quantity must be a positive integer")

    await session.execute(select(func.pg_advisory_xact_lock(_warehouse_lock_key(location_id))))
    keys = [(location_id, line.product_variant_id, line.size_id) for line in lines]
    await lock_stock(
        session, organization_id=organization_id, keys=keys, acting_store_ids={acting_store_id}
    )
    if await repository.location_has_stock_history(
        session, organization_id=organization_id, location_id=location_id
    ):
        raise OpeningBalanceConflictError(location_id=str(location_id))

    lots = [
        StockLot(
            id=uuid.uuid4(),
            organization_id=organization_id,
            location_id=location_id,
            product_variant_id=line.product_variant_id,
            size_id=line.size_id,
            acquisition_type=AcquisitionType.OPENING_BALANCE,
            inventory_snapshot_id=snapshot_id,
        )
        for line in lines
    ]
    session.add_all(lots)
    await session.flush()

    applied = await _apply_movements(
        session,
        organization_id=organization_id,
        requests=[
            MovementRequest(
                location_id=location_id,
                acting_store_id=acting_store_id,
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity_delta=line.quantity,
                movement_type=MovementType.OPENING_BALANCE,
                stock_lot_id=lot.id,
                reference_type=OPENING_BALANCE_REFERENCE,
                reference_id=snapshot_id,
            )
            for line, lot in zip(lines, lots, strict=True)
        ],
        actor_user_id=actor_user_id,
        correlation_id=correlation_id,
    )

    # Workflow step 8: the warehouse now holds exactly what the list was
    # approved with. It held nothing before, so each key's balance must equal
    # the sum of its lines; anything else is a defect, and nothing commits.
    expected: Counter[tuple[uuid.UUID, uuid.UUID, uuid.UUID]] = Counter()
    for key, line in zip(keys, lines, strict=True):
        expected[key] += line.quantity
    for key, quantity in expected.items():
        actual = await repository.current_quantity(
            session, location_id=key[0], product_variant_id=key[1], size_id=key[2]
        )
        if actual != quantity:
            raise RuntimeError(
                f"Opening balance does not reconcile at {key}: expected {quantity}, got {actual}"
            )

    by_lot = {entry.request.stock_lot_id: entry.movement_id for entry in applied}
    return [
        OpenedLine(line=line, stock_lot_id=lot.id, movement_id=by_lot[lot.id])
        for line, lot in zip(lines, lots, strict=True)
    ]


async def opening_balance_movement_ids(
    session: AsyncSession, *, organization_id: uuid.UUID, snapshot_id: uuid.UUID
) -> dict[uuid.UUID, uuid.UUID]:
    """For a replayed approval: each opening lot and the movement that brought it in."""
    return await repository.opening_balance_movements(
        session, organization_id=organization_id, snapshot_id=snapshot_id
    )
