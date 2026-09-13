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

from app.modules.inventory.models import (
    Inventory,
    MovementReason,
    MovementType,
    StockMovement,
)


async def decrement(
    session: AsyncSession,
    *,
    store_id: uuid.UUID,
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
            Inventory.store_id == store_id,
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
    store_id: uuid.UUID,
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
            store_id=store_id,
            product_variant_id=product_variant_id,
            size_id=size_id,
            quantity=quantity,
        )
        .on_conflict_do_update(
            index_elements=["store_id", "product_variant_id", "size_id"],
            set_={"quantity": Inventory.quantity + quantity},
        )
        .returning(Inventory.quantity)
    )
    return (await session.execute(statement)).scalar_one()


async def record_movement(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
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
        store_id=store_id,
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
    store_id: uuid.UUID,
    product_variant_id: uuid.UUID,
    size_id: uuid.UUID,
) -> int:
    """Quantity on hand, 0 when the item has never been stocked here."""
    quantity = (
        await session.execute(
            select(Inventory.quantity).where(
                Inventory.store_id == store_id,
                Inventory.product_variant_id == product_variant_id,
                Inventory.size_id == size_id,
            )
        )
    ).scalar_one_or_none()
    return quantity or 0


@dataclass(frozen=True, slots=True)
class Divergence:
    """A key where the snapshot and the ledger disagree."""

    store_id: uuid.UUID
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
        COALESCE(i.store_id, m.store_id)                     AS store_id,
        COALESCE(i.product_variant_id, m.product_variant_id) AS product_variant_id,
        COALESCE(i.size_id, m.size_id)                       AS size_id,
        COALESCE(i.quantity, 0)                              AS inventory_quantity,
        COALESCE(m.ledger_quantity, 0)                       AS ledger_quantity
    FROM inventory i
    FULL OUTER JOIN (
        SELECT store_id, product_variant_id, size_id, SUM(quantity_delta) AS ledger_quantity
        FROM stock_movement
        GROUP BY store_id, product_variant_id, size_id
    ) m
      ON  m.store_id = i.store_id
      AND m.product_variant_id = i.product_variant_id
      AND m.size_id = i.size_id
    WHERE COALESCE(i.quantity, 0) <> COALESCE(m.ledger_quantity, 0)
      -- Cast explicitly: asyncpg sends an untyped NULL and PostgreSQL
      -- cannot infer the parameter type from `IS NULL` alone.
      AND (
          CAST(:store_id AS uuid) IS NULL
          OR COALESCE(i.store_id, m.store_id) = CAST(:store_id AS uuid)
      )
    """
)


async def reconcile(
    session: AsyncSession, *, store_id: uuid.UUID | None = None
) -> list[Divergence]:
    """Every key where `Inventory.quantity` differs from the ledger sum.

    Invariant I3 is `SERVICE_ENFORCED` — the database cannot require a movement
    for every write. This query is the detection half of that, and an empty
    result is the evidence. A FULL OUTER JOIN so a quantity with no ledger
    history, and ledger history with no quantity, both surface.

    `store_id` narrows the report to one shop. An owner asking "is the second
    store consistent?" should not have to read the whole business, and a caller
    checking its own work should not be answered about someone else's rows.
    """
    rows = (await session.execute(RECONCILE_SQL, {"store_id": store_id})).mappings().all()
    return [
        Divergence(
            store_id=row["store_id"],
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
    "increment",
    "reconcile",
    "record_movement",
]
