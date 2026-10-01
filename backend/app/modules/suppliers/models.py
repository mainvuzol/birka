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

**What a store owes its suppliers** (owner decisions, 2026-10-01,
business-rules.md, "the store's purchases in parts"):

- an invoice is recorded on its own, never with a delivery: a supplier from
  the list, the sum on the supplier's invoice, a note; anything from nothing
  to the whole sum may be paid at once;
- each invoice is its own debt, and a payment names it; there is no
  schedule;
- the owner and managers record them; each store keeps its own, and pays
  them while it trades; while it does not, any store of the network that
  trades pays them;
- goods returned to that supplier are set off against an invoice of the
  same supplier, for the sum the supplier counted;
- a payment, a set-off or the whole invoice recorded by mistake is
  cancelled, saying why — an invoice only once nothing on it stands, and a
  return only once no set-off of it stands;
- the owner writes off what is left, saying why.

**`supplier_invoice` holds the sum on the invoice**, never changed, and where
it stands. **`supplier_invoice_entry` is its ledger, append-only**: each row
lowers what is owed by its `amount`, unless a cancellation names it. What is
owed is never stored, only summed.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

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
    # Borrowed goods, or goods under consignment, going back unsold: the lot
    # they arrived as (`suppliers.borrowed`).
    stock_lot_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("stock_lot.id", ondelete="RESTRICT"),
        nullable=True,
    )

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
        Index("ix_supplier_return_stock_lot_id", "stock_lot_id"),
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


class InvoiceStatus(StrEnum):
    # Something is still owed.
    OPEN = "OPEN"
    # Nothing is owed: paid, or set off.
    SETTLED = "SETTLED"
    # The owner wrote off what was left.
    WRITTEN_OFF = "WRITTEN_OFF"
    # Recorded by mistake, and cancelled saying why.
    CANCELLED = "CANCELLED"


class InvoiceEntryKind(StrEnum):
    PAYMENT = "PAYMENT"
    # Goods returned to the supplier, counted against the invoice.
    SET_OFF = "SET_OFF"
    WRITE_OFF = "WRITE_OFF"


class SupplierInvoice(UUIDPrimaryKey, TimestampMixin, Base):
    """What one store owes one supplier for one invoice."""

    __tablename__ = "supplier_invoice"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    # The store that owes it, and pays it while it trades.
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    supplier_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # The sum on the supplier's invoice, as typed: never changed.
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, server_default=InvoiceStatus.OPEN.value
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # The client's permanent name for it (I20). A first payment shares it.
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    command_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Borrowed goods, or goods under consignment, sold: the lot they arrived
    # as, how many of it, and what it was called then. Cancelling the invoice
    # puts them back on hand (owner decisions, 2026-10-01).
    stock_lot_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("stock_lot.id", ondelete="RESTRICT"),
        nullable=True,
    )
    lot_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lot_label: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_supplier_invoice_org_store",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "supplier_id"],
            ["supplier.organization_id", "supplier.id"],
            name="fk_supplier_invoice_org_supplier",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("organization_id", "command_id", name="uq_supplier_invoice_org_command"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(
            "status IN ('OPEN', 'SETTLED', 'WRITTEN_OFF', 'CANCELLED')", name="status_known"
        ),
        CheckConstraint("(status = 'OPEN') = (closed_at IS NULL)", name="closed_when_not_open"),
        Index("ix_supplier_invoice_store_id_created_at", "store_id", "created_at"),
        Index("ix_supplier_invoice_supplier_id", "supplier_id"),
        CheckConstraint(
            "(stock_lot_id IS NULL) = (lot_quantity IS NULL) "
            "AND (stock_lot_id IS NULL) = (lot_label IS NULL)",
            name="sold_names_its_lot",
        ),
        CheckConstraint("lot_quantity IS NULL OR lot_quantity > 0", name="lot_quantity_positive"),
        Index("ix_supplier_invoice_stock_lot_id", "stock_lot_id"),
    )


class SupplierInvoiceEntry(UUIDPrimaryKey, TimestampMixin, Base):
    """One thing that lowered what an invoice owes, unless cancelled."""

    __tablename__ = "supplier_invoice_entry"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("supplier_invoice.id", ondelete="RESTRICT"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # A set-off only: the return whose goods the supplier counted.
    supplier_return_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("supplier_return.id", ondelete="RESTRICT"),
        nullable=True,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    command_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # A write-off's reason.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A payment made by another store, because the one that owes did not
    # trade. NULL for every other entry.
    paid_at_store_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        CheckConstraint("kind IN ('PAYMENT', 'SET_OFF', 'WRITE_OFF')", name="kind_known"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(
            "(kind = 'SET_OFF') = (supplier_return_id IS NOT NULL)", name="set_off_names_return"
        ),
        CheckConstraint("(kind = 'WRITE_OFF') = (note IS NOT NULL)", name="write_off_says_why"),
        CheckConstraint(
            "paid_at_store_id IS NULL OR kind = 'PAYMENT'", name="only_a_payment_is_made_elsewhere"
        ),
        ForeignKeyConstraint(
            ["organization_id", "paid_at_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_supplier_invoice_entry_org_paid_at_store",
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "organization_id", "command_id", name="uq_supplier_invoice_entry_org_command"
        ),
        Index("ix_supplier_invoice_entry_invoice_id_created_at", "invoice_id", "created_at"),
        Index("ix_supplier_invoice_entry_supplier_return_id", "supplier_return_id"),
    )


class SupplierInvoiceEntryCancel(UUIDPrimaryKey, TimestampMixin, Base):
    """A payment or a set-off recorded by mistake, cancelled once."""

    __tablename__ = "supplier_invoice_entry_cancel"

    entry_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        # Named by hand: the convention's name is one character too long.
        ForeignKey(
            "supplier_invoice_entry.id",
            ondelete="RESTRICT",
            name="fk_supplier_invoice_entry_cancel_entry",
        ),
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
        UniqueConstraint("entry_id", name="uq_supplier_invoice_entry_cancel_entry_id"),
        CheckConstraint("char_length(btrim(reason)) > 0", name="says_why"),
    )


class SupplierInvoiceCancel(UUIDPrimaryKey, TimestampMixin, Base):
    """An invoice recorded by mistake, cancelled once, with nothing on it."""

    __tablename__ = "supplier_invoice_cancel"

    invoice_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("supplier_invoice.id", ondelete="RESTRICT"),
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
        UniqueConstraint("invoice_id", name="uq_supplier_invoice_cancel_invoice_id"),
        CheckConstraint("char_length(btrim(reason)) > 0", name="says_why"),
    )


__all__ = [
    "InvoiceEntryKind",
    "InvoiceStatus",
    "Supplier",
    "SupplierInvoice",
    "SupplierInvoiceCancel",
    "SupplierInvoiceEntry",
    "SupplierInvoiceEntryCancel",
    "SupplierReturn",
    "SupplierReturnCancel",
    "SupplierReturnLine",
]
