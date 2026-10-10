"""A stocktake of a whole warehouse. Owner decisions, 2026-10-10; ADR-0022.

The owner decided (business-rules.md, "a stocktake of a whole warehouse"):

- the warehouse keeps selling while it is counted: each position counted is
  checked against its balance when it is saved, and one that moved meanwhile
  is counted again, alone;
- positions nobody counted stay as they are; the end says how many were not
  checked;
- a manager or the owner counts (`inventory:adjust`), and each count applies
  at once;
- the stocktake is one record — who, when, how many positions, the shortage
  and the surplus in units — and the bot tells the network's owner its sum,
  silently, as a drawer's difference.

**`stocktake`** — one per count of one warehouse, open until someone
finishes it, and one open per warehouse at a time. Its sums are written once,
when it is finished, and never change after.

**`stocktake_count`** — one count of one position, append-only. A position
counted again has a second row: what it was counted at is its last, and what
the stocktake changed there is the sum of its rows' deltas. A count that
differs from the balance applies as a stock adjustment with the reason
`STOCKTAKE` (ADR-0007), which this row names; one that matches changes
nothing and names none.

**`stocktake_message`** — what the bot tells each of the network's owners of
one finished stocktake, written before it is sent, as `cash_message` is.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
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

# The sums a finished stocktake carries, and an open one does not have yet.
SUMS = (
    "counted_positions",
    "unchecked_positions",
    "shortage_units",
    "shortage_positions",
    "surplus_units",
    "surplus_positions",
)


class Stocktake(UUIDPrimaryKey, TimestampMixin, Base):
    """One count of one warehouse. `created_at` is when it was started."""

    __tablename__ = "stocktake"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("stock_location.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # The store it was started from. Whoever counts acts for their own store,
    # which may be another one sharing the warehouse.
    store_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("store.id", ondelete="RESTRICT"),
        nullable=False,
    )
    started_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=True,
    )
    counted_positions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Positions with stock on record that nobody counted: they stay as they are.
    unchecked_positions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shortage_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shortage_positions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    surplus_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    surplus_positions: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "(finished_at IS NULL) = (finished_by_user_id IS NULL)"
            + "".join(f" AND (finished_at IS NULL) = ({name} IS NULL)" for name in SUMS),
            name="finished_has_its_sums",
        ),
        CheckConstraint(
            " AND ".join(f"({name} IS NULL OR {name} >= 0)" for name in SUMS),
            name="sums_not_negative",
        ),
        Index(
            "uq_stocktake_open_location",
            "location_id",
            unique=True,
            postgresql_where=text("finished_at IS NULL"),
        ),
        Index("ix_stocktake_location_id_created_at", "location_id", "created_at"),
    )


class StocktakeCount(UUIDPrimaryKey, TimestampMixin, Base):
    """One count of one position. `created_at` is when it was saved."""

    __tablename__ = "stocktake_count"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    stocktake_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("stocktake.id", ondelete="RESTRICT"),
        nullable=False,
    )
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    size_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("size.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # What was on the shelf, what the balance was when it was saved, and the
    # difference this count made.
    counted_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_before: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    adjustment_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("stock_adjustment.id", ondelete="RESTRICT"),
        nullable=True,
    )
    # The store whoever counted acted for.
    store_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("store.id", ondelete="RESTRICT"),
        nullable=False,
    )
    counted_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # Client-generated and permanent, as a stock adjustment's (ADR-0007).
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    command_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "command_id", name="uq_stocktake_count_organization_id_command_id"
        ),
        UniqueConstraint("adjustment_id", name="uq_stocktake_count_adjustment_id"),
        CheckConstraint(
            "counted_quantity >= 0 AND quantity_before >= 0", name="quantities_not_negative"
        ),
        CheckConstraint(
            "quantity_delta = counted_quantity - quantity_before", name="delta_is_the_difference"
        ),
        CheckConstraint(
            "(quantity_delta = 0) = (adjustment_id IS NULL)", name="a_difference_is_adjusted"
        ),
        Index(
            "ix_stocktake_count_stocktake_id_position",
            "stocktake_id",
            "product_variant_id",
            "size_id",
        ),
    )


class StocktakeMessage(UUIDPrimaryKey, TimestampMixin, Base):
    """One message about one finished stocktake to one of the network's
    owners, written before it is sent, as a close's is (`cash_message`)."""

    __tablename__ = "stocktake_message"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    stocktake_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("stocktake.id", ondelete="RESTRICT"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "stocktake_id", "user_id", name="uq_stocktake_message_stocktake_id_user_id"
        ),
        CheckConstraint("status IN ('PENDING', 'SENT', 'REFUSED', 'FAILED')", name="status_known"),
        CheckConstraint("(status = 'SENT') = (sent_at IS NOT NULL)", name="sent_has_time"),
        CheckConstraint("attempts >= 0", name="attempts_not_negative"),
    )


__all__ = ["SUMS", "Stocktake", "StocktakeCount", "StocktakeMessage"]
