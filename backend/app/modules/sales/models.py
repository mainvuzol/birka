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


class ShelfShortage(UUIDPrimaryKey, TimestampMixin, Base):
    """A basket nothing of which was on the shelf, so nothing was sold.

    Owner decision, 2026-10-01 (Q-G): a line with nothing on the shelf is
    dropped and its shortage recorded; when that leaves nothing to sell, the
    shortage is still recorded, without a sale. The units the ledger believed
    in are taken off by `MISSING_AT_SALE` movements naming this row
    (`reference_type = 'shelf_shortage'`), bounded as at a sale (I25).

    The row is the command's permanent identity (I20), and it shares the
    basket's `command_id` with sales: a basket becomes a sale or an empty
    shelf, never both, and a retry finds whichever it became. It exists even
    when the ledger believed in none of it and nothing was taken off, so a
    retry after a delivery cannot take off what arrived since.
    """

    __tablename__ = "shelf_shortage"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    reported_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    command_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    # What the seller went for, line by line, and what the ledger took off —
    # with the names as the till showed them, so the answer reads the same on
    # a retry a year later.
    lines: Mapped[list[dict[str, Any]]] = mapped_column(postgresql.JSONB, nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        UniqueConstraint("organization_id", "command_id", name="uq_shelf_shortage_org_command"),
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_shelf_shortage_org_store",
            ondelete="RESTRICT",
        ),
        Index("ix_shelf_shortage_store_created_at", "store_id", "created_at"),
    )


__all__ = ["Sale", "SaleItem", "SaleStatus", "ShelfShortage"]
