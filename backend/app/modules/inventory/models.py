"""Inventory, the stock ledger and lots.

`Inventory.quantity` is the fast current answer; `StockMovement` is the
immutable explanation of how it got there (inventory-ledger-specialist). The
two must always agree, which is what the reconciliation query checks.

Legacy availability lists (`inventory_snapshot*`) belong to the `snapshots`
module since M1-023 (ADR-0005). They become stock only through this module's
`apply_opening_balance`, so the ledger's single door still holds.

Invariants enforced here at the database level:
  I1  quantity never negative            CHECK (quantity >= 0)
  I2  one row per (store, variant, size) unique index, size_id NOT NULL
  I11 the ledger is append-only          trigger (see the migration)
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UpdatedAtMixin, UUIDPrimaryKey


class AcquisitionType(StrEnum):
    """How the goods came to be here. Consignment and borrowed stock are
    physically present but not necessarily owned — the distinction exists from
    day one so it never has to be reconstructed."""

    PURCHASE = "PURCHASE"
    CONSIGNMENT = "CONSIGNMENT"
    BORROWED = "BORROWED"
    TRANSFER = "TRANSFER"
    RETURN = "RETURN"
    ADJUSTMENT = "ADJUSTMENT"
    OPENING_BALANCE = "OPENING_BALANCE"


class MovementType(StrEnum):
    ORDER_DISPATCH = "ORDER_DISPATCH"
    ORDER_RETURN = "ORDER_RETURN"
    SALE = "SALE"
    REFUND_RETURN = "REFUND_RETURN"
    DELIVERY = "DELIVERY"
    ADJUSTMENT = "ADJUSTMENT"
    TRANSFER_OUT = "TRANSFER_OUT"
    TRANSFER_IN = "TRANSFER_IN"
    STOCKTAKE_CORRECTION = "STOCKTAKE_CORRECTION"
    OPENING_BALANCE = "OPENING_BALANCE"


class MovementReason(StrEnum):
    """Controlled vocabulary for why a manual movement happened.

    `FOUND_DURING_SALE` is deliberately its own reason: how often the system
    said zero while the coat was on the rack is a data-quality signal the owner
    should be able to measure, not an anonymous adjustment.

    `MISSING_AT_SALE` is its mirror and just as deliberately separate from
    `LOST` and `DAMAGED`. At the counter nobody knows whether the coat was
    stolen, misfiled, already sold or standing in the other warehouse — the
    reason records what was *observed*, never a conclusion about why, and it
    is not a write-off (owner decision, 2026-09-17).
    """

    FOUND_DURING_SALE = "FOUND_DURING_SALE"
    MISSING_AT_SALE = "MISSING_AT_SALE"
    DAMAGED = "DAMAGED"
    LOST = "LOST"
    STOCKTAKE = "STOCKTAKE"
    SIZE_RECLASSIFICATION_IN = "SIZE_RECLASSIFICATION_IN"
    SIZE_RECLASSIFICATION_OUT = "SIZE_RECLASSIFICATION_OUT"
    CORRECTION = "CORRECTION"
    OTHER = "OTHER"


class GoodsReceipt(UUIDPrimaryKey, TimestampMixin, Base):
    """One delivery arriving at one warehouse: the lots it created, as a fact.

    It exists for the same reason `transfer` does. Every other command that
    writes stock — a sale, a refund, a transfer, an approved legacy list —
    carries a permanent `command_id` under `UNIQUE (organization_id,
    command_id)`, which is invariant I20: *a critical command can never create
    a second business operation, at any distance in time.* Receiving goods was
    the one that did not, and nothing recorded a decision to exempt it.

    What that cost, before `0016`: a receipt was idempotent for exactly as
    long as its 7-day response cache. An identical request arriving after the
    record was pruned created a second set of lots and doubled the delivered
    quantity, silently. The client pattern that reaches it is the ordinary
    one — a command written to durable storage before it is sent, replayed
    when the app is opened again.

    Following ADR-0003, as transfers do: `command_fingerprint` decides whether
    a request carrying a known `command_id` is the same business operation,
    and `response_snapshot` lets a retry arriving after the cache expires
    receive the original receipt rather than a unique violation.
    """

    __tablename__ = "goods_receipt"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # Where the goods arrived, and on whose authority — two facts, because a
    # shared warehouse is exactly where they differ (ADR-0004).
    location_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    receiving_store_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    command_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    response_snapshot: Mapped[dict[str, Any] | None] = mapped_column(
        postgresql.JSONB, nullable=True
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "command_id", name="uq_goods_receipt_org_command"),
        ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_goods_receipt_org_location",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "receiving_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_goods_receipt_org_store",
            ondelete="RESTRICT",
        ),
    )


class StockLot(UUIDPrimaryKey, TimestampMixin, Base):
    """Provenance of one receipt of goods.

    M1 scope: a record of how and at what cost stock arrived. There is no
    lot-based consumption or FIFO costing yet, so `StockMovement.stock_lot_id`
    stays nullable.
    """

    __tablename__ = "stock_lot"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Where the goods physically arrived — not who sells them (ADR-0004).
    location_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    size_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("size.id", ondelete="RESTRICT"), nullable=False
    )
    acquisition_type: Mapped[AcquisitionType] = mapped_column(
        Enum(AcquisitionType, name="acquisition_type", native_enum=True), nullable=False
    )
    source_identity_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("source_identity.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Acquisition cost lives here, never on catalog identity (business fact F33).
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency_code: Mapped[str | None] = mapped_column(String(3), nullable=True)
    # RESTRICT since `0015`: a list whose goods became stock can never be
    # deleted out from under them (ADR-0005).
    inventory_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventory_snapshot.id", ondelete="RESTRICT"),
        nullable=True,
    )
    # The delivery that created this lot, where one did. Nullable because most
    # lots have no receipt at all: an opening balance comes from a legacy list,
    # and a restocking refund makes a lot out of goods that were already here.
    goods_receipt_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("goods_receipt.id", ondelete="RESTRICT"),
        nullable=True,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_stock_lot_location_variant", "location_id", "product_variant_id", "size_id"),
        # Composite, so a lot cannot point at another organization's location.
        ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_stock_lot_org_location",
            ondelete="RESTRICT",
        ),
        CheckConstraint("unit_cost IS NULL OR unit_cost >= 0", name="unit_cost_not_negative"),
        CheckConstraint(
            "(unit_cost IS NULL) = (currency_code IS NULL)", name="cost_requires_currency"
        ),
        # An opening lot always names the legacy list it came from (I17).
        CheckConstraint(
            "acquisition_type <> 'OPENING_BALANCE' OR inventory_snapshot_id IS NOT NULL",
            name="opening_lot_names_its_list",
        ),
    )


class Inventory(UUIDPrimaryKey, UpdatedAtMixin, Base):
    """Current quantity for one store + variant + size.

    `size_id` is NOT NULL and points at a real Size row — including the
    "size unknown" one (business fact F34). That keeps NULLs out of the unique
    key entirely, so duplicate inventory rows are impossible rather than merely
    unlikely.
    """

    __tablename__ = "inventory"

    # The balance belongs to a place, not to a shop. Two stores selling from
    # one warehouse therefore contend on ONE row (ADR-0004 §2.3).
    location_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("stock_location.id", ondelete="RESTRICT"),
        nullable=False,
    )
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    size_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("size.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    reserved_quantity: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        UniqueConstraint(
            "location_id",
            "product_variant_id",
            "size_id",
            name="uq_inventory_location_variant_size",
        ),
        # The hard floor. Service logic keeps stock correct; this keeps it sane
        # even if service logic is wrong (invariant I1).
        CheckConstraint("quantity >= 0", name="quantity_not_negative"),
        CheckConstraint(
            "reserved_quantity >= 0 AND reserved_quantity <= quantity",
            name="reservation_within_stock",
        ),
    )


class StockReservation(UUIDPrimaryKey, TimestampMixin, Base):
    """A command's hold on physical stock; inactive rows retain its history."""

    __tablename__ = "stock_reservation"
    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    reference_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    location_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    size_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("size.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_stock_reservation_org_location",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_stock_reservation_org_store",
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "organization_id",
            "reference_id",
            "location_id",
            "product_variant_id",
            "size_id",
            name="uq_stock_reservation_reference_key",
        ),
        CheckConstraint("quantity > 0", name="quantity_positive"),
    )


class StockMovement(UUIDPrimaryKey, TimestampMixin, Base):
    """Every change to a quantity, forever. APPEND-ONLY.

    `quantity_delta` is signed and may not be zero: a movement that changes
    nothing is not a movement, it is a bug that would otherwise hide in the
    ledger.
    """

    __tablename__ = "stock_movement"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    # WHERE the quantity changed…
    location_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # …and WHICH STORE caused it. Different facts, and a shared warehouse is
    # exactly where they differ. A transfer between two warehouses is the one
    # movement no single store is responsible for, hence the CHECK below.
    acting_store_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    size_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("size.id", ondelete="RESTRICT"), nullable=False
    )
    stock_lot_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("stock_lot.id", ondelete="SET NULL"),
        nullable=True,
    )
    movement_type: Mapped[MovementType] = mapped_column(
        Enum(MovementType, name="movement_type", native_enum=True), nullable=False
    )
    quantity_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    reason_code: Mapped[MovementReason | None] = mapped_column(
        Enum(MovementReason, name="movement_reason", native_enum=True), nullable=True
    )
    # What caused this movement: 'sale', 'refund', 'transfer', 'snapshot'.
    reference_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    # Ties a stock change back to the exact HTTP request that caused it.
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        Index(
            "ix_stock_movement_key",
            "location_id",
            "product_variant_id",
            "size_id",
            "created_at",
        ),
        ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_stock_movement_org_location",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "acting_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_stock_movement_org_acting_store",
            ondelete="RESTRICT",
        ),
        # Today's NOT NULL attribution is preserved everywhere a store really
        # is responsible, and relaxed only for a warehouse-to-warehouse move.
        CheckConstraint(
            "movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') OR acting_store_id IS NOT NULL",
            name="acting_store_required",
        ),
        Index("ix_stock_movement_reference", "reference_type", "reference_id"),
        CheckConstraint("quantity_delta <> 0", name="delta_not_zero"),
        # `.ai/workflows/inventory-adjustment.md`: an adjustment always carries
        # a reason. Without this an untraceable stock edit is one missing
        # argument away.
        CheckConstraint(
            "movement_type <> 'ADJUSTMENT' OR reason_code IS NOT NULL",
            name="adjustment_requires_reason",
        ),
        # Invariant I17, held by the database: an opening balance is only ever
        # the approved answer to a legacy list, through the lot that traces it.
        CheckConstraint(
            "movement_type <> 'OPENING_BALANCE' OR ("
            "reference_type = 'inventory_snapshot'"
            " AND reference_id IS NOT NULL AND stock_lot_id IS NOT NULL)",
            name="opening_balance_names_its_list",
        ),
    )


__all__ = [
    "AcquisitionType",
    "Inventory",
    "MovementReason",
    "MovementType",
    "StockLot",
    "StockMovement",
    "StockReservation",
]
