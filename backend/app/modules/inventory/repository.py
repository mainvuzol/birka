"""The only place that writes stock.

Invariant I3 says every quantity change is explained by a StockMovement. That
is enforceable only because this module is the single writer — the
import-linter contract in `pyproject.toml` fails the build if `sales`,
`refunds`, `transfers` or `catalog` import it directly. They go through
`inventory.service` instead, which always writes the pair.

Both write paths are single atomic statements. Nothing here reads a quantity,
decides, and writes it back: that pattern loses updates under concurrency no
matter how carefully it is guarded in Python.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.modules.inventory.models import (
    Inventory,
    MovementReason,
    MovementType,
    StockLot,
    StockMovement,
)


async def validate_lot_references(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    references: list[tuple[uuid.UUID, tuple[uuid.UUID, uuid.UUID, uuid.UUID]]],
) -> None:
    """A lot must belong to both the command tenant and its exact stock key."""
    if not references:
        return
    lots = {
        lot.id: lot
        for lot in (
            await session.scalars(
                select(StockLot).where(
                    StockLot.id.in_({ref[0] for ref in references}),
                    StockLot.organization_id == organization_id,
                )
            )
        ).all()
    }
    for lot_id, key in references:
        lot = lots.get(lot_id)
        if lot is None or (lot.location_id, lot.product_variant_id, lot.size_id) != key:
            raise NotFoundError("Unknown stock lot for this stock key")


async def ensure_and_lock(
    session: AsyncSession, *, key: tuple[uuid.UUID, uuid.UUID, uuid.UUID]
) -> int:
    """Materialize an empty stock key and lock it through transaction end.

    The unique-key insert also serializes concurrent first arrivals. Zero is
    bookkeeping only: no quantity changes and no movement is required.
    Call in the same sorted order for every key a command will touch.
    """
    location_id, variant_id, size_id = key
    await session.execute(
        pg_insert(Inventory)
        .values(
            id=uuid.uuid4(),
            location_id=location_id,
            product_variant_id=variant_id,
            size_id=size_id,
            quantity=0,
        )
        .on_conflict_do_nothing(index_elements=["location_id", "product_variant_id", "size_id"])
    )
    return (
        await session.execute(
            select(Inventory.quantity)
            .where(
                Inventory.location_id == location_id,
                Inventory.product_variant_id == variant_id,
                Inventory.size_id == size_id,
            )
            .with_for_update()
        )
    ).scalar_one()


async def decrement(
    session: AsyncSession,
    *,
    location_id: uuid.UUID,
    product_variant_id: uuid.UUID,
    size_id: uuid.UUID,
    quantity: int,
) -> int | None:
    """Take `quantity` off the shelf, or report that it is not there.

    The `quantity >= :q` predicate is what makes overselling impossible: two
    concurrent callers both run this statement, PostgreSQL serialises them on
    the row, and the loser matches zero rows. Returns the new quantity, or
    None when there was not enough — never a negative number, and never a
    decision made from a stale read.
    """
    statement = (
        update(Inventory)
        .where(
            Inventory.location_id == location_id,
            Inventory.product_variant_id == product_variant_id,
            Inventory.size_id == size_id,
            Inventory.quantity >= quantity,
        )
        .values(quantity=Inventory.quantity - quantity)
        .returning(Inventory.quantity)
    )
    return (await session.execute(statement)).scalar_one_or_none()


async def increment(
    session: AsyncSession,
    *,
    location_id: uuid.UUID,
    product_variant_id: uuid.UUID,
    size_id: uuid.UUID,
    quantity: int,
) -> int:
    """Add `quantity`, creating the inventory row if this is the first arrival.

    Upsert rather than select-then-insert: two first deliveries of the same
    item arriving together would otherwise race, and one would fail on the
    unique key.
    """
    statement = (
        pg_insert(Inventory)
        .values(
            id=uuid.uuid4(),
            location_id=location_id,
            product_variant_id=product_variant_id,
            size_id=size_id,
            quantity=quantity,
        )
        .on_conflict_do_update(
            index_elements=["location_id", "product_variant_id", "size_id"],
            set_={"quantity": Inventory.quantity + quantity},
        )
        .returning(Inventory.quantity)
    )
    return (await session.execute(statement)).scalar_one()


async def record_movement(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    location_id: uuid.UUID,
    acting_store_id: uuid.UUID | None,
    product_variant_id: uuid.UUID,
    size_id: uuid.UUID,
    movement_type: MovementType,
    quantity_delta: int,
    reason_code: MovementReason | None = None,
    stock_lot_id: uuid.UUID | None = None,
    reference_type: str | None = None,
    reference_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    correlation_id: str | None = None,
) -> StockMovement:
    """Append the explanation for a quantity change."""
    movement = StockMovement(
        organization_id=organization_id,
        location_id=location_id,
        acting_store_id=acting_store_id,
        product_variant_id=product_variant_id,
        size_id=size_id,
        movement_type=movement_type,
        quantity_delta=quantity_delta,
        reason_code=reason_code,
        stock_lot_id=stock_lot_id,
        reference_type=reference_type,
        reference_id=reference_id,
        actor_user_id=actor_user_id,
        correlation_id=correlation_id,
    )
    session.add(movement)
    await session.flush()
    return movement


async def current_quantity(
    session: AsyncSession,
    *,
    location_id: uuid.UUID,
    product_variant_id: uuid.UUID,
    size_id: uuid.UUID,
) -> int:
    """Quantity on hand, 0 when the item has never been stocked here."""
    quantity = (
        await session.execute(
            select(Inventory.quantity).where(
                Inventory.location_id == location_id,
                Inventory.product_variant_id == product_variant_id,
                Inventory.size_id == size_id,
            )
        )
    ).scalar_one_or_none()
    return quantity or 0


@dataclass(frozen=True, slots=True)
class Divergence:
    """A key where the snapshot and the ledger disagree."""

    location_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    inventory_quantity: int
    ledger_quantity: int

    @property
    def difference(self) -> int:
        return self.inventory_quantity - self.ledger_quantity


RECONCILE_SQL = text(
    """
    SELECT
        COALESCE(i.location_id, m.location_id)               AS location_id,
        COALESCE(i.product_variant_id, m.product_variant_id) AS product_variant_id,
        COALESCE(i.size_id, m.size_id)                       AS size_id,
        COALESCE(i.quantity, 0)                              AS inventory_quantity,
        COALESCE(m.ledger_quantity, 0)                       AS ledger_quantity
    FROM inventory i
    FULL OUTER JOIN (
        SELECT location_id, product_variant_id, size_id, SUM(quantity_delta) AS ledger_quantity
        FROM stock_movement
        GROUP BY location_id, product_variant_id, size_id
    ) m
      ON  m.location_id = i.location_id
      AND m.product_variant_id = i.product_variant_id
      AND m.size_id = i.size_id
    JOIN stock_location l ON l.id = COALESCE(i.location_id, m.location_id)
    WHERE COALESCE(i.quantity, 0) <> COALESCE(m.ledger_quantity, 0)
      -- Cast explicitly: asyncpg sends an untyped NULL and PostgreSQL
      -- cannot infer the parameter type from `IS NULL` alone.
      AND (
          CAST(:location_id AS uuid) IS NULL
          OR COALESCE(i.location_id, m.location_id) = CAST(:location_id AS uuid)
      )
      AND (
          CAST(:organization_id AS uuid) IS NULL
          OR l.organization_id = CAST(:organization_id AS uuid)
      )
    """
)


async def reconcile(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID | None = None,
    location_id: uuid.UUID | None = None,
) -> list[Divergence]:
    """Every key where `Inventory.quantity` differs from the ledger sum.

    Invariant I3 is `SERVICE_ENFORCED` — the database cannot require a movement
    for every write. This query is the detection half of that, and an empty
    result is the evidence. A FULL OUTER JOIN so a quantity with no ledger
    history, and ledger history with no quantity, both surface.

    `location_id` narrows the report to one warehouse, and `organization_id`
    to one tenant — the query had no tenant predicate at all before the
    re-key, so an unscoped call read every organization's rows.

    The question changed shape with the key: "is store C consistent?" stops
    being answerable once C's stock lives partly in a shared warehouse, and
    "is warehouse W-C consistent?" replaces it.
    """
    rows = (
        (
            await session.execute(
                RECONCILE_SQL, {"organization_id": organization_id, "location_id": location_id}
            )
        )
        .mappings()
        .all()
    )
    return [
        Divergence(
            location_id=row["location_id"],
            product_variant_id=row["product_variant_id"],
            size_id=row["size_id"],
            inventory_quantity=row["inventory_quantity"],
            ledger_quantity=row["ledger_quantity"],
        )
        for row in rows
    ]


__all__ = [
    "Divergence",
    "current_quantity",
    "decrement",
    "ensure_and_lock",
    "increment",
    "reconcile",
    "record_movement",
    "refund_return_movement_ids",
    "validate_lot_references",
]


async def sale_adjustment_ids(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    sale_id: uuid.UUID,
    reason: MovementReason,
) -> list[uuid.UUID]:
    """Read a sale's in-sale adjustments without exposing inventory ORM to sales.

    Narrowed by reason, so the two directions stay two answers: goods found on
    the shelf and goods missing from it are different facts on a receipt.
    """
    return list(
        (
            await session.scalars(
                select(StockMovement.id)
                .where(
                    StockMovement.organization_id == organization_id,
                    StockMovement.reference_type == "sale",
                    StockMovement.reference_id == sale_id,
                    StockMovement.movement_type == MovementType.ADJUSTMENT,
                    StockMovement.reason_code == reason,
                )
                .order_by(StockMovement.product_variant_id, StockMovement.size_id, StockMovement.id)
            )
        ).all()
    )


async def refund_return_movement_ids(
    session: AsyncSession, *, organization_id: uuid.UUID, refund_id: uuid.UUID
) -> list[uuid.UUID]:
    """Read restock references without exposing inventory ORM to refunds."""
    return list(
        (
            await session.scalars(
                select(StockMovement.id)
                .where(
                    StockMovement.organization_id == organization_id,
                    StockMovement.reference_type == "refund",
                    StockMovement.reference_id == refund_id,
                    StockMovement.movement_type == MovementType.REFUND_RETURN,
                )
                .order_by(StockMovement.product_variant_id, StockMovement.size_id, StockMovement.id)
            )
        ).all()
    )
