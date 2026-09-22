"""Transfers between warehouses.

A transfer is two stock movements, never a sale (invariant I16): it must not
appear anywhere as revenue. Goods move between *locations*; the store only says
on whose authority they moved (ADR-0004 §2.5).

Command identity works as it does for a sale and a refund: `command_id` is
permanent and unique (invariant I20), the idempotency record is a 7-day
response cache, and `command_fingerprint` + `response_snapshot` (revision
`0008_transfer_replay`, following ADR-0003) let a retry arriving after that
cache expires receive the original transfer rather than a unique violation.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class TransferStatus(StrEnum):
    """M1 default is single-step: SENT and RECEIVED in one transaction
    (assumption A8). The two-phase states exist so that enabling confirmation
    at the receiving store later is a service change, not a migration."""

    DRAFT = "DRAFT"
    SENT = "SENT"
    RECEIVED = "RECEIVED"
    CANCELLED = "CANCELLED"


class Transfer(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "transfer"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # Goods move between warehouses, not between shops (ADR-0004 §2.5). Both
    # are bound through `organization_id` below, so a transfer cannot name
    # another tenant's warehouse even if a service check were missed.
    from_location_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    to_location_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # The store on whose authority the move happens, and the subject of the
    # transfer:create permission check. Dropping every store column would
    # leave that check with nothing to check.
    initiating_store_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    status: Mapped[TransferStatus] = mapped_column(
        Enum(TransferStatus, name="transfer_status", native_enum=True), nullable=False
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    command_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    response_snapshot: Mapped[dict[str, Any] | None] = mapped_column(
        postgresql.JSONB, nullable=True
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "command_id", name="uq_transfer_org_command"),
        CheckConstraint("from_location_id <> to_location_id", name="locations_differ"),
        ForeignKeyConstraint(
            ["organization_id", "from_location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_transfer_org_from_location",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "to_location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_transfer_org_to_location",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "initiating_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_transfer_org_initiating_store",
            ondelete="RESTRICT",
        ),
    )


class TransferItem(UUIDPrimaryKey, Base):
    __tablename__ = "transfer_item"

    transfer_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("transfer.id", ondelete="RESTRICT"),
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
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        Index("ix_transfer_item_transfer", "transfer_id"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
    )


__all__ = ["Transfer", "TransferItem", "TransferStatus"]
