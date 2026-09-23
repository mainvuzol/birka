"""Customer orders keep shipment and completed sale as separate facts."""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
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
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class OrderStatus(StrEnum):
    READY_TO_DISPATCH = "READY_TO_DISPATCH"
    DISPATCHED = "DISPATCHED"
    ARRIVED = "ARRIVED"
    COLLECTED = "COLLECTED"
    CANCELLED = "CANCELLED"
    RETURNED = "RETURNED"


class CustomerOrder(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "customer_order"
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="RESTRICT")
    )
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True))
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="RESTRICT")
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    sale_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sale.id", ondelete="RESTRICT"), unique=True
    )
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False, server_default="UAH")
    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            ondelete="RESTRICT",
        ),
        UniqueConstraint("organization_id", "id"),
        Index("ix_customer_order_store_created", "store_id", "created_at"),
        CheckConstraint(
            "status IN ('READY_TO_DISPATCH','DISPATCHED','ARRIVED',"
            "'COLLECTED','CANCELLED','RETURNED')",
            name="status_valid",
        ),
        CheckConstraint(
            "(status = 'COLLECTED') = (sale_id IS NOT NULL)", name="sale_only_collected"
        ),
        CheckConstraint("currency_code = 'UAH'", name="currency_uah"),
    )


class CustomerOrderItem(UUIDPrimaryKey, Base):
    __tablename__ = "customer_order_item"
    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customer_order.id", ondelete="RESTRICT")
    )
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("product_variant.id", ondelete="RESTRICT")
    )
    size_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("size.id", ondelete="RESTRICT"))
    source_location_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("stock_location.id", ondelete="RESTRICT")
    )
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    display_name_snapshot: Mapped[str] = mapped_column(Text)
    variant_snapshot: Mapped[dict[str, Any]] = mapped_column(postgresql.JSONB)
    __table_args__ = (
        UniqueConstraint(
            "order_id",
            "source_location_id",
            "product_variant_id",
            "size_id",
            name="uq_customer_order_item_stock_key",
        ),
        CheckConstraint("quantity BETWEEN 1 AND 1000", name="quantity_valid"),
        CheckConstraint(
            "unit_price >= 0 AND discount_amount >= 0 AND discount_amount <= unit_price",
            name="money_valid",
        ),
    )


class OrderCommand(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "order_command"
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="RESTRICT")
    )
    order_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True))
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True))
    fingerprint: Mapped[str] = mapped_column(String(64))
    response_snapshot: Mapped[dict[str, Any]] = mapped_column(postgresql.JSONB)
    __table_args__ = (
        UniqueConstraint("organization_id", "command_id"),
        ForeignKeyConstraint(
            ["organization_id", "order_id"],
            ["customer_order.organization_id", "customer_order.id"],
            ondelete="RESTRICT",
        ),
    )
