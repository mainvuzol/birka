"""Suppliers, and goods returned to them.

The owner decided on 2026-10-01 (business-rules.md, "returns to a supplier"):

- suppliers are one list for the network; whoever returns goods picks one or
  adds a new one, and may correct its name or phone; nobody deletes one;
- only the goods are recorded, with a note: money stays outside the system
  until the store's purchase installments are built;
- the owner and managers return goods, from a warehouse — one document with
  a list — or a confirmed unit from «Брак»;
- a return may be cancelled, whole, at any time, once, saying why: its goods
  go back where they were taken from, and both stay in the history.

**A return and its cancellation are facts, append-only** like the stock
ledger: nothing rewrites what was sent back, or that it came back. Whether a
return stands is whether a cancellation names it.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    CheckConstraint,
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
from app.core.orm import TimestampMixin, UpdatedAtMixin, UUIDPrimaryKey


class Supplier(UUIDPrimaryKey, TimestampMixin, UpdatedAtMixin, Base):
    __tablename__ = "supplier"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("organization.id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # What makes two names one supplier: «Беларді» and « беларді » are one.
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "normalized_name", name="uq_supplier_organization_id_normalized_name"
        ),
        # Target for the returns' composite key: a return names a supplier of
        # its own organization only.
        UniqueConstraint("organization_id", "id", name="uq_supplier_organization_id_id"),
        CheckConstraint("char_length(btrim(name)) > 0", name="has_a_name"),
    )


class SupplierReturn(UUIDPrimaryKey, TimestampMixin, Base):
    """Goods sent back to a supplier from one warehouse, by one store."""

    __tablename__ = "supplier_return"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    # The store that sent them back, and is answerable for it.
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # Where they were taken from, and where a cancellation puts them back.
    location_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    supplier_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # A unit from «Брак»: the return is that unit's, and it leaves and comes
    # back through the «Брак» section only.
    damaged_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("damaged_unit.id", ondelete="RESTRICT"),
        nullable=True,
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # The client's permanent name for it (I20), or, for a unit from «Брак»,
    # one derived from the unit, so it is never returned twice by accident.
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    command_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_supplier_return_org_store",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_supplier_return_org_location",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "supplier_id"],
            ["supplier.organization_id", "supplier.id"],
            name="fk_supplier_return_org_supplier",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("organization_id", "command_id", name="uq_supplier_return_org_command"),
        Index("ix_supplier_return_store_id_created_at", "store_id", "created_at"),
        Index("ix_supplier_return_supplier_id", "supplier_id"),
        Index("ix_supplier_return_damaged_unit_id", "damaged_unit_id"),
    )


class SupplierReturnLine(UUIDPrimaryKey, Base):
    __tablename__ = "supplier_return_line"

    supplier_return_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("supplier_return.id", ondelete="RESTRICT"),
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
    # As the catalogue named it then, so the history reads as it was.
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    size_label: Mapped[str | None] = mapped_column(String(40), nullable=True)

    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        UniqueConstraint(
            "supplier_return_id",
            "product_variant_id",
            "size_id",
            name="uq_supplier_return_line_return_variant_size",
        ),
    )


class SupplierReturnCancel(UUIDPrimaryKey, TimestampMixin, Base):
    """A return cancelled, whole, once: its goods came back where they left."""

    __tablename__ = "supplier_return_cancel"

    supplier_return_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("supplier_return.id", ondelete="RESTRICT"),
        nullable=False,
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        UniqueConstraint("supplier_return_id", name="uq_supplier_return_cancel_supplier_return_id"),
        CheckConstraint("char_length(btrim(reason)) > 0", name="says_why"),
    )


__all__ = ["Supplier", "SupplierReturn", "SupplierReturnCancel", "SupplierReturnLine"]
