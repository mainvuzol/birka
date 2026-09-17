"""Inventory, the stock ledger, lots and legacy snapshots.

`Inventory.quantity` is the fast current answer; `StockMovement` is the
immutable explanation of how it got there (inventory-ledger-specialist). The
two must always agree, which is what the reconciliation query checks.

Invariants enforced here at the database level:
  I1  quantity never negative            CHECK (quantity >= 0)
  I2  one row per (store, variant, size) unique index, size_id NOT NULL
  I11 the ledger is append-only          trigger (see the migration)
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
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
    """

    FOUND_DURING_SALE = "FOUND_DURING_SALE"
    DAMAGED = "DAMAGED"
    LOST = "LOST"
    STOCKTAKE = "STOCKTAKE"
    SIZE_RECLASSIFICATION_IN = "SIZE_RECLASSIFICATION_IN"
    SIZE_RECLASSIFICATION_OUT = "SIZE_RECLASSIFICATION_OUT"
    CORRECTION = "CORRECTION"
    OTHER = "OTHER"


class SnapshotStatus(StrEnum):
    DRAFT = "DRAFT"
    PARSED = "PARSED"
    IN_REVIEW = "IN_REVIEW"
    APPROVED = "APPROVED"
    APPLIED = "APPLIED"
    REJECTED = "REJECTED"


class SnapshotQuantityState(StrEnum):
    """`UNKNOWN_DISTRIBUTION` is the `Лама бежевая/персик/butter 3 шт` case:
    the total is known, the split across colours is not, and inventing
    1+1+1 is forbidden."""

    KNOWN = "KNOWN"
    UNKNOWN_DISTRIBUTION = "UNKNOWN_DISTRIBUTION"
    UNKNOWN_QUANTITY = "UNKNOWN_QUANTITY"


class SnapshotRowStatus(StrEnum):
    PENDING = "PENDING"
    RESOLVED = "RESOLVED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    SKIPPED = "SKIPPED"


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
    inventory_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventory_snapshot.id", ondelete="SET NULL"),
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
    )


class InventorySnapshot(UUIDPrimaryKey, TimestampMixin, Base):
    """A legacy availability list: a notebook page, a PDF, a stock sheet.

    Evidence of what was on hand at a moment — never reconstructed purchase or
    sale history (invariant I17).
    """

    __tablename__ = "inventory_snapshot"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    # A legacy availability list describes a place that was counted.
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    source_document_ref: Mapped[str | None] = mapped_column(String(300), nullable=True)
    captured_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[SnapshotStatus] = mapped_column(
        Enum(SnapshotStatus, name="snapshot_status", native_enum=True),
        nullable=False,
        server_default=SnapshotStatus.DRAFT.value,
    )
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        # Composite like the stock tables, so a count sheet cannot describe
        # another organization's warehouse. NULL stays legal: a snapshot may
        # predate knowing where it was counted.
        ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_inventory_snapshot_org_location",
            ondelete="RESTRICT",
        ),
    )


class InventorySnapshotRow(UUIDPrimaryKey, TimestampMixin, Base):
    """One source line, kept verbatim even when it cannot be parsed."""

    __tablename__ = "inventory_snapshot_row"

    inventory_snapshot_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventory_snapshot.id", ondelete="CASCADE"),
        nullable=False,
    )
    line_no: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_input_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("raw_input.id", ondelete="RESTRICT"),
        nullable=False,
    )
    parse_result_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parse_result.id", ondelete="SET NULL"),
        nullable=True,
    )
    quantity_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quantity_state: Mapped[SnapshotQuantityState] = mapped_column(
        Enum(SnapshotQuantityState, name="snapshot_quantity_state", native_enum=True),
        nullable=False,
        server_default=SnapshotQuantityState.KNOWN.value,
    )
    resolved_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="RESTRICT"),
        nullable=True,
    )
    resolved_size_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("size.id", ondelete="RESTRICT"), nullable=True
    )
    status: Mapped[SnapshotRowStatus] = mapped_column(
        Enum(SnapshotRowStatus, name="snapshot_row_status", native_enum=True),
        nullable=False,
        server_default=SnapshotRowStatus.PENDING.value,
    )

    __table_args__ = (
        UniqueConstraint("inventory_snapshot_id", "line_no", name="uq_snapshot_row_line"),
        CheckConstraint(
            "quantity_total IS NULL OR quantity_total >= 0", name="quantity_not_negative"
        ),
        # A row can only become an opening balance once it resolved to a
        # concrete variant and size with a known quantity.
        CheckConstraint(
            "status <> 'RESOLVED' OR ("
            " resolved_variant_id IS NOT NULL"
            " AND resolved_size_id IS NOT NULL"
            " AND quantity_total IS NOT NULL"
            " AND quantity_state = 'KNOWN')",
            name="resolved_requires_complete_row",
        ),
    )


__all__ = [
    "AcquisitionType",
    "Inventory",
    "InventorySnapshot",
    "InventorySnapshotRow",
    "MovementReason",
    "MovementType",
    "SnapshotQuantityState",
    "SnapshotRowStatus",
    "SnapshotStatus",
    "StockLot",
    "StockMovement",
]
