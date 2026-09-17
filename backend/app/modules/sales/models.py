"""Sales.

Money rules (business fact F33, invariants I7/I8/I22):

* `NUMERIC(12,2)` in the database, `Decimal` in Python. Never a float.
* Every `SaleItem` freezes its own `unit_price`, `discount_amount`,
  `final_unit_price` and `currency_code`, plus the name and variant it was sold
  under. A later rename, re-price or catalog merge cannot change what a past
  receipt says.
* Two CHECK constraints make the line arithmetic a database guarantee, so a
  rounding bug cannot persist an internally inconsistent line.

Command identity (business fact F36, invariant I20): `command_id` is permanent
and unique. The idempotency record is a 7-day response cache; this is what
stops a retry from creating a second sale a year later.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
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
from app.core.orm import UTC_NOW, TimestampMixin, UUIDPrimaryKey


class SaleStatus(StrEnum):
    COMPLETED = "COMPLETED"
    VOIDED = "VOIDED"


class Sale(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "sale"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    store_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("store.id", ondelete="RESTRICT"), nullable=False
    )
    seller_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # Permanent business identity of the command that created this sale.
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # Nullable only for sales written before migration 0003: their original
    # request cannot be reconstructed safely from catalog/receipt snapshots.
    command_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    response_snapshot: Mapped[dict[str, Any] | None] = mapped_column(
        postgresql.JSONB, nullable=True
    )
    status: Mapped[SaleStatus] = mapped_column(
        Enum(SaleStatus, name="sale_status", native_enum=True),
        nullable=False,
        server_default=SaleStatus.COMPLETED.value,
    )
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_total: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, server_default="0"
    )
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    sold_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=UTC_NOW
    )
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        # Invariant I20: the same command can never create a second sale,
        # at any distance in time.
        UniqueConstraint("organization_id", "command_id", name="uq_sale_org_command"),
        Index("ix_sale_store_sold_at", "store_id", "sold_at"),
        CheckConstraint(
            "subtotal >= 0 AND total >= 0 AND discount_total >= 0", name="amounts_sane"
        ),
        CheckConstraint("total = subtotal - discount_total", name="total_is_consistent"),
        CheckConstraint("char_length(currency_code) = 3", name="currency_code_iso4217"),
    )


class SaleItem(UUIDPrimaryKey, Base):
    """One sold line, frozen at the moment of sale.

    There is deliberately no foreign key behaviour that could rewrite these
    numbers, and no code path recomputes them from the catalog.
    """

    __tablename__ = "sale_item"

    sale_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("sale.id", ondelete="RESTRICT"), nullable=False
    )
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    size_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("size.id", ondelete="RESTRICT"), nullable=False
    )
    # Which warehouse these units actually left. Frozen beside the price: a
    # refund reads it to know where to put goods back, and guessing instead
    # would move stock between warehouses without a transfer (I16, ADR-0004).
    # Per line, because one basket may legitimately draw from two warehouses.
    source_location_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("stock_location.id", ondelete="RESTRICT"),
        nullable=False,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, server_default="0"
    )
    final_unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)

    # What the seller saw on screen, kept so an old receipt still reads right
    # after the product is renamed or its family merged.
    display_name_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    variant_snapshot: Mapped[dict[str, Any]] = mapped_column(postgresql.JSONB, nullable=False)

    __table_args__ = (
        Index("ix_sale_item_sale", "sale_id"),
        Index("ix_sale_item_source_location", "source_location_id"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint(
            "unit_price >= 0 AND discount_amount >= 0 AND final_unit_price >= 0",
            name="amounts_not_negative",
        ),
        # Invariant I22: the arithmetic of a line is a database guarantee.
        CheckConstraint(
            "final_unit_price = unit_price - discount_amount", name="final_price_is_consistent"
        ),
        CheckConstraint(
            "line_total = final_unit_price * quantity", name="line_total_is_consistent"
        ),
        CheckConstraint("char_length(currency_code) = 3", name="currency_code_iso4217"),
    )


__all__ = ["Sale", "SaleItem", "SaleStatus"]
