"""Customer orders keep shipment and completed sale as separate facts.

**Where an order goes** (owner decisions, 2026-10-01, business-rules.md,
"where an order goes"): within Ukraine, the default, by one of three
carriers, picked when the order is made; or abroad. The waybill number — or,
abroad, one free text saying city, country and how it was sent — is written
when the order is sent, or later. Whoever works with orders may correct any
of it while the order is open, and every version stays in
`customer_order_shipping_change`. Nobody's name, phone or address is kept.

An order made before this has no destination: it reads «не вказано» until
someone states one.
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


class OrderStatus(StrEnum):
    READY_TO_DISPATCH = "READY_TO_DISPATCH"
    DISPATCHED = "DISPATCHED"
    ARRIVED = "ARRIVED"
    COLLECTED = "COLLECTED"
    CANCELLED = "CANCELLED"
    RETURNED = "RETURNED"


class Destination(StrEnum):
    UKRAINE = "UKRAINE"
    ABROAD = "ABROAD"


class Carrier(StrEnum):
    NOVA_POSHTA = "NOVA_POSHTA"
    UKRPOSHTA = "UKRPOSHTA"
    MEEST = "MEEST"


class ShippingChangeKind(StrEnum):
    # Stated when the order was made.
    CREATED = "CREATED"
    # The waybill, or the note abroad, written when it was sent.
    DISPATCHED = "DISPATCHED"
    # Corrected, or written later.
    CORRECTED = "CORRECTED"


# Shared by the order and its history: what may stand together.
SHIPPING_CHECKS = (
    ("destination IS NULL OR destination IN ('UKRAINE', 'ABROAD')", "destination_known"),
    ("carrier IS NULL OR carrier IN ('NOVA_POSHTA', 'UKRPOSHTA', 'MEEST')", "carrier_known"),
    # Within Ukraine always by a carrier; abroad, or not stated, by none.
    (
        "(carrier IS NOT NULL) = (destination IS NOT DISTINCT FROM 'UKRAINE')",
        "carrier_within_ukraine",
    ),
    ("waybill IS NULL OR destination = 'UKRAINE'", "waybill_within_ukraine"),
    ("abroad_note IS NULL OR destination = 'ABROAD'", "note_abroad_only"),
)


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
    # Where it goes, as it stands now; its history is
    # `customer_order_shipping_change`. NULL on an order made before 0028.
    destination: Mapped[str | None] = mapped_column(String(8), nullable=True)
    carrier: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # As typed, and its letters and digits alone, which is what a search and
    # the warning about a waybill on two orders compare.
    waybill: Mapped[str | None] = mapped_column(String(64), nullable=True)
    waybill_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    abroad_note: Mapped[str | None] = mapped_column(Text, nullable=True)
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
        *(CheckConstraint(check, name=name) for check, name in SHIPPING_CHECKS),
        CheckConstraint("(waybill IS NULL) = (waybill_key IS NULL)", name="waybill_has_key"),
        Index("ix_customer_order_store_id_waybill_key", "store_id", "waybill_key"),
    )


class CustomerOrderShippingChange(UUIDPrimaryKey, Base):
    """Where an order went, as stated at one moment: when it was made, when
    it was sent, or when someone corrected it. Append-only: what was there
    before stays."""

    __tablename__ = "customer_order_shipping_change"
    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    order_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    destination: Mapped[str] = mapped_column(String(8), nullable=False)
    carrier: Mapped[str | None] = mapped_column(String(16), nullable=True)
    waybill: Mapped[str | None] = mapped_column(String(64), nullable=True)
    abroad_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=UTC_NOW
    )
    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "order_id"],
            ["customer_order.organization_id", "customer_order.id"],
            name="fk_customer_order_shipping_change_org_order",
            ondelete="RESTRICT",
        ),
        CheckConstraint("kind IN ('CREATED', 'DISPATCHED', 'CORRECTED')", name="kind_known"),
        *(CheckConstraint(check, name=name) for check, name in SHIPPING_CHECKS),
        Index("ix_customer_order_shipping_change_order_id", "order_id", "created_at"),
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
