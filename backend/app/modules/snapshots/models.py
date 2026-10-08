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

A list is filled by **parts** (ADR-0014 §2): a parser's file, or lines typed
by hand. A part is added, shown and removed as one; a removed part's lines
stay as evidence and count nowhere.

Once a list is decided — applied or rejected — the database freezes it, its
rows and its allocations (trigger `inventory_snapshot_is_final`, `0015`), and
its parts (`inventory_snapshot_part_is_final`, `0037`).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

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
    text,
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
    allocations; `SKIPPED` is "not stock", with a written reason.

    `REMOVED`: its file was removed; the answer is gone, the line kept as
    evidence (ADR-0014 §9). It counts nowhere and is never answered again.
    """

    PENDING = "PENDING"
    RESOLVED = "RESOLVED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    SKIPPED = "SKIPPED"
    REMOVED = "REMOVED"


class SnapshotQuantityBasis(StrEnum):
    """Where the numbers in a line's answer came from (ADR-0005 §3).

    The approver sees how many lines rest on each, so a count typed from
    memory can never pass for one the list itself stated.

    * `STATED` — the line states the total, and the answer is that total, in
      one allocation. Nothing was added to what the list says.
    * `STATED_BY_SIZE` — a line from a file whose text shows each size beside
      its count («S-1 M-2 L-1», «Лоран M-3»), answered as it shows: one model,
      one allocation per size, each with its count (ADR-0014 §5).
    * `LINE_IMPLIES_ONE` — the line states no count, and it is taken as one
      piece. Recorded as the convention it is, pending the owner's answer.
    * `RECOUNTED` — someone counted the goods. A note says who and when.
    * `OWNER_KNOWLEDGE` — known some other way. A note says how.

    A split across sizes or colours is never `STATED`: the parser reads no
    per-size counts, so any split is somebody's knowledge, and says so. The
    one exception is a split the line's own text shows, each size with its
    count, which is `STATED_BY_SIZE` (owner, 2026-10-08).
    """

    STATED = "STATED"
    LINE_IMPLIES_ONE = "LINE_IMPLIES_ONE"
    RECOUNTED = "RECOUNTED"
    OWNER_KNOWLEDGE = "OWNER_KNOWLEDGE"
    STATED_BY_SIZE = "STATED_BY_SIZE"


class SnapshotPartKind(StrEnum):
    """`FILE`: a parser's file (`birka.stock-list`). `PASTED`: lines typed or
    pasted by hand, as every list was before ADR-0014."""

    FILE = "FILE"
    PASTED = "PASTED"


class SnapshotPriceKind(StrEnum):
    """The kind of every price in one file: one notebook, one kind (owner,
    2026-10-08). The price is only shown, never a price in Birka."""

    SALE = "SALE"
    PURCHASE = "PURCHASE"


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


class InventorySnapshotPart(UUIDPrimaryKey, TimestampMixin, Base):
    """One part of a list: a parser's file, or lines typed by hand (ADR-0014 §2).

    The unit that is added, shown and removed. Its lines are contiguous in
    the list's own numbering (`first_line_no`..`last_line_no`), which stays
    list-wide: a removed part leaves a gap.

    `command_id` is the client's permanent name for adding it, unique within
    the organization like a list's. A list's first part takes the list's own
    command id and fingerprint, so a stock-list command id names one list or
    one added part, never both (§8). `content_fingerprint` is what a file
    says, line by line; one list never holds the same file twice while
    neither is removed (`uq_inventory_snapshot_part_active_file`).

    Removing a part only stamps `removed_at` and `removed_by_user_id`, once;
    the database refuses any other change, any delete, and any change at all
    once the list is decided (`inventory_snapshot_part_is_final`, `0037`).
    """

    __tablename__ = "inventory_snapshot_part"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    inventory_snapshot_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventory_snapshot.id", ondelete="CASCADE"),
        nullable=False,
    )
    part_no: Mapped[int] = mapped_column(Integer, nullable=False)
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # sha256 of the request that added it. NULL only for the part a list
    # restored by a downgrade was given: such a list cannot be replayed.
    command_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # sha256 of a file's lines (`stock_file.content_fingerprint_of_file`);
    # none for hand-typed lines, which may go into two lists as before.
    content_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    kind: Mapped[SnapshotPartKind] = mapped_column(
        Enum(SnapshotPartKind, name="snapshot_part_kind", native_enum=True), nullable=False
    )
    # What the file said of itself, as it said it.
    file_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source: Mapped[str | None] = mapped_column(String(300), nullable=True)
    counted_on: Mapped[str | None] = mapped_column(String(40), nullable=True)
    price_kind: Mapped[SnapshotPriceKind | None] = mapped_column(
        Enum(SnapshotPriceKind, name="snapshot_price_kind", native_enum=True), nullable=True
    )
    parser: Mapped[str | None] = mapped_column(String(100), nullable=True)
    format_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    line_count: Mapped[int] = mapped_column(Integer, nullable=False)
    first_line_no: Mapped[int] = mapped_column(Integer, nullable=False)
    last_line_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # Who added and who removed it are history: their links restrict. NULL
    # only for the first part of a list whose creator is gone.
    added_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=True
    )
    removed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=True
    )
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "command_id", name="uq_inventory_snapshot_part_org_command"
        ),
        UniqueConstraint("inventory_snapshot_id", "part_no", name="uq_inventory_snapshot_part_no"),
        # What a row's composite link to its part names: a row's part is in
        # the row's own list.
        UniqueConstraint("inventory_snapshot_id", "id", name="uq_inventory_snapshot_part_list_id"),
        CheckConstraint("part_no >= 1", name="part_no_positive"),
        CheckConstraint("line_count BETWEEN 1 AND 1000", name="line_count_bounded"),
        CheckConstraint("first_line_no >= 1", name="first_line_positive"),
        CheckConstraint("last_line_no = first_line_no + line_count - 1", name="lines_contiguous"),
        CheckConstraint(
            "(kind = 'FILE') = (file_name IS NOT NULL AND format_version IS NOT NULL"
            " AND content_fingerprint IS NOT NULL)",
            name="file_names_itself",
        ),
        CheckConstraint(
            "kind = 'FILE' OR (price_kind IS NULL AND parser IS NULL)",
            name="only_a_file_has_a_parser",
        ),
        CheckConstraint(
            "(removed_at IS NULL) = (removed_by_user_id IS NULL)", name="removal_names_who"
        ),
        # One file is in a list once while neither copy is removed. A removed
        # file may come back, as a new part (owner, 2026-10-08).
        Index(
            "uq_inventory_snapshot_part_active_file",
            "inventory_snapshot_id",
            "content_fingerprint",
            unique=True,
            postgresql_where=text("removed_at IS NULL AND kind = 'FILE'"),
        ),
    )


class InventorySnapshotRow(UUIDPrimaryKey, TimestampMixin, Base):
    """One source line, kept verbatim even when nobody can interpret it.

    A line from a file also keeps where it was written — the photo's name
    and its line on it — and what the parser read of it, written once and
    never changed (ADR-0014 §3). Nothing of that reading reaches the
    catalogue or a price.
    """

    __tablename__ = "inventory_snapshot_row"

    inventory_snapshot_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventory_snapshot.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The part the line came in. With the list it names the part's own
    # list, by a composite link (`fk_inventory_snapshot_row_part`).
    part_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
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
    # A line from a file: where it was written, so a person can go back to
    # the photo (Birka keeps none), and what the parser read, exactly as the
    # file said it (`model`, `colours`, `sizes`, `size_counts`, `count`,
    # `price`, `note`). A hint, never an answer.
    photo_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    photo_line: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reading: Mapped[dict[str, Any] | None] = mapped_column(postgresql.JSONB, nullable=True)
    # Why the reading sends the line to a person (`file_lines.FILE_REASONS`).
    file_reasons: Mapped[list[str]] = mapped_column(
        postgresql.ARRAY(String(40)), nullable=False, server_default=text("'{}'")
    )
    # The split the line's text shows, each size beside its count, as
    # `[{"size": "M", "count": 2}]`: what `STATED_BY_SIZE` may answer.
    shown_split: Mapped[list[dict[str, Any]] | None] = mapped_column(
        postgresql.JSONB, nullable=True
    )

    __table_args__ = (
        UniqueConstraint("inventory_snapshot_id", "line_no", name="uq_snapshot_row_line"),
        ForeignKeyConstraint(
            ["inventory_snapshot_id", "part_id"],
            ["inventory_snapshot_part.inventory_snapshot_id", "inventory_snapshot_part.id"],
            name="fk_inventory_snapshot_row_part",
            ondelete="RESTRICT",
        ),
        Index("ix_inventory_snapshot_row_part", "part_id"),
        Index(
            "ix_inventory_snapshot_row_photo", "inventory_snapshot_id", "photo_name", "photo_line"
        ),
        CheckConstraint(
            "(photo_name IS NULL) = (photo_line IS NULL)", name="photo_named_with_its_line"
        ),
        CheckConstraint("photo_line IS NULL OR photo_line >= 1", name="photo_line_positive"),
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
    "InventorySnapshotPart",
    "InventorySnapshotRow",
    "SnapshotPartKind",
    "SnapshotPriceKind",
    "SnapshotQuantityBasis",
    "SnapshotQuantityState",
    "SnapshotRowStatus",
    "SnapshotStatus",
]
