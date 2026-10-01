"""The empty shelf: a basket nothing of which was there, so nothing was sold.

The owner answered Q-G on 2026-10-01 (business-rules.md, "nothing on the
shelf"). A line with nothing on the shelf is dropped from the sale and its
shortage recorded, and the rest is sold; that part lives in `create_sale`. When
it leaves nothing to sell, **the shortage is still recorded, without a sale**.

It is the same statement «фізично відсутній» makes, bounded the same way
(I25): for each stock key, the ledger takes off what it believed in for this
basket, `min(available, demand)`, and no more. A basket of two coats the ledger
believed one of takes off one. It never adds stock and is not a write-off: the
reason is `MISSING_AT_SALE`, and each movement names the row recorded here.

**One basket, one outcome.** The row is the command's permanent identity (I20)
and shares the basket's `command_id` with sales, under the same lock: a basket
becomes a sale or an empty shelf, never both. A retry is answered with what
was recorded, even when nothing was taken off — so a delivery that arrives in
between is never taken off by a late retry.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import IdempotencyConflictError, NotFoundError, ValidationFailedError
from app.core.logging import get_logger
from app.modules.audit import service as audit
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.read import describe_variants, size_label
from app.modules.inventory.models import MovementReason, MovementType
from app.modules.inventory.service import MovementRequest, apply_movements, lock_stock
from app.modules.sales.models import Sale, ShelfShortage
from app.modules.sales.service import lock_command
from app.modules.tenancy.service import LocationCapability

logger = get_logger(__name__)

REFERENCE = "shelf_shortage"

# (location, variant, size), as in the sale command.
StockKey = tuple[uuid.UUID, uuid.UUID, uuid.UUID]


@dataclass(frozen=True, slots=True)
class ShelfLine:
    """A line of the basket: what the seller went for, and found none of."""

    source_location_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int


def _key(line: ShelfLine) -> StockKey:
    return (line.source_location_id, line.product_variant_id, line.size_id)


async def report_empty_shelf(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    command_id: uuid.UUID,
    lines: Sequence[ShelfLine],
    correlation_id: str | None = None,
) -> ShelfShortage:
    """Record that nothing in the basket was on the shelf. The caller owns the
    transaction; a refusal writes nothing."""
    if not 1 <= len(lines) <= 100:
        raise ValidationFailedError("An empty shelf names between 1 and 100 lines")
    for line in lines:
        if type(line.quantity) is not int or not 0 < line.quantity <= 1000:
            raise ValidationFailedError("Quantity must be an integer between 1 and 1000")
    # Both of the sale's own authorities: this happens at the till, and takes
    # stock off a shelf — which `inventory:correct_during_sale` does not give.
    scope.require(Permission.SALE_CREATE, store_id)
    scope.require(Permission.INVENTORY_REPORT_MISSING_DURING_SALE, store_id)
    locations = {line.source_location_id for line in lines}
    for permission in (Permission.SALE_CREATE, Permission.INVENTORY_REPORT_MISSING_DURING_SALE):
        await require_stock_access(
            session,
            scope=scope,
            permission=permission,
            store_id=store_id,
            location_ids=locations,
            capability=LocationCapability.SELL,
        )
    fingerprint = idempotency.fingerprint(
        {
            "empty_shelf": [
                {
                    "source_location_id": str(line.source_location_id),
                    "product_variant_id": str(line.product_variant_id),
                    "size_id": str(line.size_id),
                    "quantity": line.quantity,
                }
                for line in lines
            ]
        },
        actor_user_id=scope.user_id,
        store_id=store_id,
    )

    await lock_command(session, organization_id=scope.organization_id, command_id=command_id)
    existing = await session.scalar(
        select(ShelfShortage).where(
            ShelfShortage.organization_id == scope.organization_id,
            ShelfShortage.command_id == command_id,
        )
    )
    if existing is not None:
        if existing.command_fingerprint != fingerprint:
            raise IdempotencyConflictError(
                "This command_id already recorded a different empty shelf",
                command_id=str(command_id),
            )
        scope.require(Permission.SALE_VIEW, existing.store_id)
        return existing
    if await session.scalar(
        select(Sale.id).where(
            Sale.organization_id == scope.organization_id, Sale.command_id == command_id
        )
    ):
        raise IdempotencyConflictError(
            "This command_id already made a sale", command_id=str(command_id)
        )

    demand: dict[StockKey, int] = {}
    for line in lines:
        demand[_key(line)] = demand.get(_key(line), 0) + line.quantity
    keys = sorted(demand)
    # A balance an order holds is not corrected at the till, whatever the
    # shelf says. The ledger refuses it (`RESERVED`), as at a sale: a reserved
    # balance is held stock, so there is always something here to take off.
    quantities = await lock_stock(
        session, organization_id=scope.organization_id, keys=keys, acting_store_ids={store_id}
    )
    described = await describe_variants(session, [key[1] for key in keys])
    for key in keys:
        description = described.get(key[1])
        if description is None or description.organization_id != scope.organization_id:
            raise NotFoundError("Unknown product variant", product_variant_id=str(key[1]))

    shortage = ShelfShortage(
        organization_id=scope.organization_id,
        store_id=store_id,
        reported_by_user_id=scope.user_id,
        command_id=command_id,
        command_fingerprint=fingerprint,
        lines=[],
        correlation_id=correlation_id,
    )
    session.add(shortage)
    await session.flush()

    # What the ledger believed in for this basket, and no more (I25).
    believed = {key: min(quantities[key], demand[key]) for key in keys}
    requests = [
        MovementRequest(
            location_id=key[0],
            acting_store_id=store_id,
            product_variant_id=key[1],
            size_id=key[2],
            quantity_delta=-believed[key],
            movement_type=MovementType.ADJUSTMENT,
            reason_code=MovementReason.MISSING_AT_SALE,
            reference_type=REFERENCE,
            reference_id=shortage.id,
        )
        for key in keys
        if believed[key] > 0
    ]
    moved: dict[StockKey, uuid.UUID] = {}
    if requests:
        for entry in await apply_movements(
            session,
            organization_id=scope.organization_id,
            requests=requests,
            actor_user_id=scope.user_id,
            correlation_id=correlation_id,
        ):
            request = entry.request
            moved[(request.location_id, request.product_variant_id, request.size_id)] = (
                entry.movement_id
            )
            await audit.record(
                session,
                organization_id=scope.organization_id,
                actor_user_id=scope.user_id,
                action="inventory.missing_at_sale",
                entity_type="stock_movement",
                entity_id=entry.movement_id,
                before={"quantity": entry.quantity_after - request.quantity_delta},
                after={"quantity": entry.quantity_after},
                reason=MovementReason.MISSING_AT_SALE.value,
            )

    recorded: list[dict[str, Any]] = []
    for key in keys:
        recorded.append(
            {
                "source_location_id": str(key[0]),
                "product_variant_id": str(key[1]),
                "size_id": str(key[2]),
                "display_name": described[key[1]].display_name,
                "size": await size_label(session, key[2]),
                "requested": demand[key],
                "removed": believed[key],
                "movement_id": str(moved[key]) if key in moved else None,
            }
        )
    shortage.lines = recorded
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="sale.empty_shelf",
        entity_type=REFERENCE,
        entity_id=shortage.id,
        after={"command_id": str(command_id), "lines": recorded},
    )
    logger.info(
        "sale.empty_shelf",
        shelf_shortage_id=str(shortage.id),
        store_id=str(store_id),
        lines=len(recorded),
        removed=sum(believed.values()),
    )
    return shortage


async def read_empty_shelf(
    session: AsyncSession, *, scope: RequestScope, shortage_id: uuid.UUID
) -> ShelfShortage:
    shortage = await session.scalar(
        select(ShelfShortage).where(
            ShelfShortage.id == shortage_id,
            ShelfShortage.organization_id == scope.organization_id,
        )
    )
    if shortage is None:
        raise NotFoundError("Empty shelf not found", shelf_shortage_id=str(shortage_id))
    scope.require(Permission.SALE_VIEW, shortage.store_id)
    return shortage


__all__ = ["REFERENCE", "ShelfLine", "read_empty_shelf", "report_empty_shelf"]
