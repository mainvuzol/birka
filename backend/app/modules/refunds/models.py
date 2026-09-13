"""Refunds.

A refund is a compensating operation, never an edit of the original sale
(`.ai/skills/compensating-operations.md`). Amounts are computed from the frozen
`SaleItem` snapshots, so refunding an item whose price changed since still
refunds what was actually charged.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
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
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class Refund(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "refund"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    store_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("store.id", ondelete="RESTRICT"), nullable=False
    )
    sale_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("sale.id", ondelete="RESTRICT"), nullable=False
    )
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        UniqueConstraint("organization_id", "command_id", name="uq_refund_org_command"),
        Index("ix_refund_sale", "sale_id"),
        CheckConstraint("total_amount >= 0", name="amount_not_negative"),
        CheckConstraint("char_length(currency_code) = 3", name="currency_code_iso4217"),
    )


class RefundItem(UUIDPrimaryKey, Base):
    __tablename__ = "refund_item"

    refund_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("refund.id", ondelete="RESTRICT"), nullable=False
    )
    sale_item_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("sale_item.id", ondelete="RESTRICT"),
        nullable=False,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Goods physically came back, so stock returns. A refund without restock is
    # a legitimate case (damaged item kept by the shop) and must be explicit.
    restock: Mapped[bool] = mapped_column(Boolean, nullable=False)

    __table_args__ = (
        Index("ix_refund_item_refund", "refund_id"),
        Index("ix_refund_item_sale_item", "sale_item_id"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("amount >= 0", name="amount_not_negative"),
    )


__all__ = ["Refund", "RefundItem"]
