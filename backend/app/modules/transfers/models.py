"""Transfers between the two stores.

A transfer is two stock movements, never a sale (invariant I16): it must not
appear anywhere as revenue.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
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
    from_store_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("store.id", ondelete="RESTRICT"), nullable=False
    )
    to_store_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("store.id", ondelete="RESTRICT"), nullable=False
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

    __table_args__ = (
        UniqueConstraint("organization_id", "command_id", name="uq_transfer_org_command"),
        CheckConstraint("from_store_id <> to_store_id", name="stores_differ"),
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
