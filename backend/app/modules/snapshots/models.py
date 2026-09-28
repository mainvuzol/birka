"""Legacy availability lists and what a person decided about each line.

A snapshot is evidence of what was on hand at one place and moment — a notebook
page, a PDF, a stock sheet — never reconstructed purchase or sale history
(invariant I17, constitution §27). Three layers, kept apart on purpose
(ADR-0005):

* the **line** as written: an append-only `RawInput`, and the pure parser's
  reading of it;
* the **row**: that line's place in the list, a summary of what the line itself
  said about quantity, and a person's verdict on it;
* the **allocations**: the `(variant, size, quantity)` a person stated the line
  means. Only these ever become stock, and only by approval.

Once a list is decided — applied or rejected — the database freezes it, its
rows and its allocations (trigger `inventory_snapshot_is_final`, `0015`).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class SnapshotStatus(StrEnum):
    """`IN_REVIEW` → `APPLIED` or `REJECTED`.

    `DRAFT`, `PARSED` and `APPROVED` exist in the database enum since `0002` and
    are never written: parsing happens inside the import transaction, and
    approving *is* applying — an approved list whose stock has not landed
    would be a state with nothing to do.
    """

    DRAFT = "DRAFT"
    PARSED = "PARSED"
    IN_REVIEW = "IN_REVIEW"
    APPROVED = "APPROVED"
    APPLIED = "APPLIED"
    REJECTED = "REJECTED"


class SnapshotQuantityState(StrEnum):
    """What the source line said about quantity — evidence, not the answer.

    `UNKNOWN_DISTRIBUTION` is a line naming several colours or sizes — the
    `Лама бежевая/персик/butter 3 шт` case, and `Лоран S M L 3 шт` too: the
    total may be known, the split across them is not, and inventing 1+1+1 is
    forbidden (invariant I15). `UNKNOWN_QUANTITY` is a line with no count the
    parser could trust, which includes a line with two counts or a negated one.
    """

    KNOWN = "KNOWN"
    UNKNOWN_DISTRIBUTION = "UNKNOWN_DISTRIBUTION"
    UNKNOWN_QUANTITY = "UNKNOWN_QUANTITY"


class SnapshotRowStatus(StrEnum):
    """`PENDING` and `NEEDS_REVIEW` both block approval; the difference is
    triage — the parser flagged something in the second. `RESOLVED` has
    allocations; `SKIPPED` is "not stock", with a written reason."""

    PENDING = "PENDING"
    RESOLVED = "RESOLVED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    SKIPPED = "SKIPPED"


class SnapshotQuantityBasis(StrEnum):
    """Where the numbers in a line's answer came from (ADR-0005 §3).

    The approver sees how many lines rest on each, so a count typed from
    memory can never pass for one the list itself stated.

    * `STATED` — the line states the total, and the answer is that total, in
      one allocation. Nothing was added to what the list says.
    * `LINE_IMPLIES_ONE` — the line states no count, and it is taken as one
      piece. Recorded as the convention it is, pending the owner's answer.
    * `RECOUNTED` — someone counted the goods. A note says who and when.
    * `OWNER_KNOWLEDGE` — known some other way. A note says how.

    A split across sizes or colours is never `STATED`: the parser reads no
    per-size counts, so any split is somebody's knowledge, and says so.
    """

    STATED = "STATED"
    LINE_IMPLIES_ONE = "LINE_IMPLIES_ONE"
    RECOUNTED = "RECOUNTED"
    OWNER_KNOWLEDGE = "OWNER_KNOWLEDGE"


class InventorySnapshot(UUIDPrimaryKey, TimestampMixin, Base):
    """One legacy list, counted at one place.

    `command_id` is the client's permanent name for the import, unique within
    the organization, so a retry can never create a second list — the rule a
    sale or a transfer follows (ADR-0003, without the retention-limited
    cache). The primary key is the server's own, so one organization's
    command id says nothing about another's.
    """

    __tablename__ = "inventory_snapshot"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # A legacy availability list describes a place that was counted.
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    # The store whose authority imports, reviews and approves this list, and
    # the acting store of every opening movement it produces. Not `store_id`:
    # ADR-0004 retired that name on this table, where it meant the place that
    # was counted, and `0006`'s downgrade still recreates it.
    acting_store_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    source_document_ref: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Free text on purpose: a legacy list is dated "осінь 2025" as often as
    # "2025-10-01", and turning the first into the second would be inventing.
    captured_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[SnapshotStatus] = mapped_column(
        Enum(SnapshotStatus, name="snapshot_status", native_enum=True),
        nullable=False,
        server_default=SnapshotStatus.DRAFT.value,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    # sha256 of the import request. NULL means the request cannot be proven —
    # a list restored by a downgrade — and a retry of it is a conflict.
    command_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Bumped by every review change. An approval names the revision it looked
    # at, so it can never apply a list that changed after it was checked.
    review_revision: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    rejected_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("organization_id", "command_id", name="uq_inventory_snapshot_org_command"),
        # Composite like the stock tables, so a count sheet cannot describe
        # another organization's warehouse or act through its store. NULL stays
        # legal: a snapshot may predate knowing where it was counted.
        ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_inventory_snapshot_org_location",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "acting_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_inventory_snapshot_org_acting_store",
            ondelete="RESTRICT",
        ),
        Index("ix_inventory_snapshot_acting_store_created", "acting_store_id", "created_at"),
        CheckConstraint("review_revision >= 0", name="review_revision_not_negative"),
        CheckConstraint(
            "(status = 'REJECTED') = (rejection_reason IS NOT NULL)",
            name="rejection_has_reason",
        ),
        CheckConstraint(
            "(status IN ('APPLIED', 'REJECTED')) = (decided_at IS NOT NULL)",
            name="decision_has_time",
        ),
        # An applied list became stock somewhere, through some store.
        CheckConstraint(
            "status <> 'APPLIED' OR (location_id IS NOT NULL AND acting_store_id IS NOT NULL)",
            name="applied_names_place_and_store",
        ),
    )


class InventorySnapshotRow(UUIDPrimaryKey, TimestampMixin, Base):
    """One source line, kept verbatim even when nobody can interpret it."""

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
    # What the line itself said, as the parser read it. Never overwritten by a
    # resolution: when a person's answer differs, both stay visible.
    quantity_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quantity_state: Mapped[SnapshotQuantityState] = mapped_column(
        Enum(SnapshotQuantityState, name="snapshot_quantity_state", native_enum=True),
        nullable=False,
        server_default=SnapshotQuantityState.KNOWN.value,
    )
    status: Mapped[SnapshotRowStatus] = mapped_column(
        Enum(SnapshotRowStatus, name="snapshot_row_status", native_enum=True),
        nullable=False,
        server_default=SnapshotRowStatus.PENDING.value,
    )
    quantity_basis: Mapped[SnapshotQuantityBasis | None] = mapped_column(
        Enum(SnapshotQuantityBasis, name="snapshot_quantity_basis", native_enum=True),
        nullable=True,
    )
    # The skip reason, or how a count that is not simply stated was known.
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("inventory_snapshot_id", "line_no", name="uq_snapshot_row_line"),
        UniqueConstraint("raw_input_id", name="uq_inventory_snapshot_row_raw_input_id"),
        CheckConstraint(
            "quantity_total IS NULL OR quantity_total >= 0", name="quantity_not_negative"
        ),
        # The evidence summary is self-consistent: a known quantity has a total,
        # an unknown one has none. (A slash line may state a total or not.)
        CheckConstraint(
            "quantity_state <> 'KNOWN' OR quantity_total IS NOT NULL",
            name="known_quantity_has_total",
        ),
        CheckConstraint(
            "quantity_state <> 'UNKNOWN_QUANTITY' OR quantity_total IS NULL",
            name="unknown_quantity_has_no_total",
        ),
        CheckConstraint(
            "(status = 'RESOLVED') = (quantity_basis IS NOT NULL)",
            name="basis_exactly_when_resolved",
        ),
        CheckConstraint(
            "status <> 'SKIPPED' OR resolution_note IS NOT NULL", name="skip_has_reason"
        ),
        CheckConstraint(
            "(status IN ('RESOLVED', 'SKIPPED')) = (resolved_at IS NOT NULL)",
            name="verdict_has_time",
        ),
    )


class InventorySnapshotAllocation(UUIDPrimaryKey, TimestampMixin, Base):
    """One `(variant, size, quantity)` a person stated a line means.

    A line listing three sizes is three allocations — each stated, none
    inferred. After approval `stock_lot_id` names the opening lot this
    allocation became, which is what makes an opening balance traceable back
    to the line of the list it came from.
    """

    __tablename__ = "inventory_snapshot_allocation"

    snapshot_row_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey(
            "inventory_snapshot_row.id",
            ondelete="CASCADE",
            name="fk_inventory_snapshot_allocation_row",
        ),
        nullable=False,
    )
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey(
            "product_variant.id",
            ondelete="RESTRICT",
            name="fk_inventory_snapshot_allocation_variant",
        ),
        nullable=False,
    )
    size_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("size.id", ondelete="RESTRICT", name="fk_inventory_snapshot_allocation_size"),
        nullable=False,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    stock_lot_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey(
            "stock_lot.id",
            ondelete="RESTRICT",
            name="fk_inventory_snapshot_allocation_stock_lot",
        ),
        nullable=True,
    )

    __table_args__ = (
        # The same size of the same variant twice in one line is one
        # allocation with a larger quantity, not two.
        UniqueConstraint(
            "snapshot_row_id",
            "product_variant_id",
            "size_id",
            name="uq_inventory_snapshot_allocation_row_key",
        ),
        UniqueConstraint("stock_lot_id", name="uq_inventory_snapshot_allocation_stock_lot_id"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
    )


__all__ = [
    "InventorySnapshot",
    "InventorySnapshotAllocation",
    "InventorySnapshotRow",
    "SnapshotQuantityBasis",
    "SnapshotQuantityState",
    "SnapshotRowStatus",
    "SnapshotStatus",
]
