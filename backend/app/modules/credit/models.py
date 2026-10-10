"""A sale paid in parts: what the customer owes, and every change to it.

The owner decided on 2026-10-01 (business-rules.md, "paying in parts"):

- the customer takes the goods at once, pays something now, and owes the
  rest; any amount above nothing will do as the first payment;
- the shop records the customer's name and phone;
- there is no schedule: the customer pays when they can, and the shop sees
  what was paid, what is left, and when the last payment came;
- a seller may sell this way and take a payment, in the store that sold;
  while that store is blocked or archived, any store of the network that
  trades takes it, and the debt stays the selling store's (owner decision,
  2026-10-01, "store states");
- goods returned first reduce what is owed; money goes back only when the
  customer has paid more than what they keep is worth;
- the owner may write off a debt that will not be paid, with a reason.

**One `customer_credit` per such sale**, holding the agreed amount — the
sale's own total, never changed — and whether anything is still owed.

The customer's name and phone are erased a year after the debt was paid or
returned, three after it was written off, or at once on the owner's word
once it is closed; every sum stays (owner decisions, 2026-10-09; ADR-0015).

**`credit_entry` is its ledger, append-only** like the stock ledger — but for
a write-off's reason, erased with the customer. Each row
lowers what is owed by its `amount`:
- a payment, by what was paid;
- a return, by the part of the returned goods' worth that was still owed;
  the rest of that worth went back in cash, as `cash_back`;
- a write-off, by everything still owed.

What is owed is therefore never stored, only summed: the agreed amount less
every entry. Nothing can rewrite it but a new entry.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    Boolean,
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
    text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class CreditStatus(StrEnum):
    # Something is still owed.
    OPEN = "OPEN"
    # Nothing is owed: paid, or returned.
    SETTLED = "SETTLED"
    # The owner wrote off what was left.
    WRITTEN_OFF = "WRITTEN_OFF"


class EntryKind(StrEnum):
    PAYMENT = "PAYMENT"
    RETURN = "RETURN"
    WRITE_OFF = "WRITE_OFF"


class CustomerCredit(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "customer_credit"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    # The store that sold, and the one that takes the payments while it
    # trades.
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    sale_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("sale.id", ondelete="RESTRICT"), nullable=False
    )
    # NULL once the customer is erased (ADR-0015), with the phone and its
    # digits: all three, or none.
    customer_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # As the seller typed it, and its digits alone, which is what a search
    # compares: "+38 (067) 123-45-67" and "0671234567" are one customer.
    customer_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    phone_digits: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # The sale's total: what was agreed, frozen like the receipt (I8).
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, server_default=CreditStatus.OPEN.value
    )
    opened_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # When the customer's name and phone were erased (owner decisions,
    # 2026-10-09): a year after the debt was paid or returned, three after it
    # was written off, or at once on the owner's word. Every sum stays.
    customer_erased_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # The owner who erased on the customer's request; NULL when the term ran
    # out.
    customer_erased_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=True,
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_customer_credit_org_store",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("sale_id", name="uq_customer_credit_sale_id"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("status IN ('OPEN', 'SETTLED', 'WRITTEN_OFF')", name="status_known"),
        CheckConstraint("(status = 'OPEN') = (closed_at IS NULL)", name="closed_when_not_open"),
        Index("ix_customer_credit_store_id_status", "store_id", "status"),
        Index("ix_customer_credit_organization_id_phone_digits", "organization_id", "phone_digits"),
        # ADR-0015 §3: the name, the phone and its digits, or none, exactly
        # when erased; never an open debt; the erasing owner only with it. A
        # trigger keeps an erased customer erased (`0038`).
        CheckConstraint(
            "(customer_erased_at IS NULL AND customer_name IS NOT NULL "
            "AND customer_phone IS NOT NULL AND phone_digits IS NOT NULL) "
            "OR (customer_erased_at IS NOT NULL AND customer_name IS NULL "
            "AND customer_phone IS NULL AND phone_digits IS NULL)",
            name="customer_erased_whole",
        ),
        CheckConstraint(
            "customer_erased_at IS NULL OR status <> 'OPEN'", name="customer_erased_when_closed"
        ),
        CheckConstraint(
            "customer_erased_by_user_id IS NULL OR customer_erased_at IS NOT NULL",
            name="customer_erased_by_when_erased",
        ),
        # What the hourly erasure reads.
        Index(
            "ix_customer_credit_kept_closed",
            "closed_at",
            postgresql_where=text("customer_erased_at IS NULL AND status <> 'OPEN'"),
        ),
    )


class CreditEntry(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "credit_entry"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    credit_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("customer_credit.id", ondelete="RESTRICT"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    # How much less is owed after this entry.
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # A return only: what went back to the customer in cash.
    cash_back: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, server_default="0")
    # A return only: the refund whose goods came back.
    refund_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("refund.id", ondelete="RESTRICT"), nullable=True
    )
    # A payment or a write-off: the client's permanent name for it (I20). The
    # first payment shares the sale's.
    command_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    command_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # A write-off's reason; NULL once its customer is erased.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # A payment taken by another store, because the one that sold was not
    # trading: that store took the money. NULL for every other entry, so a
    # payment taken where the goods were sold reads as it always has, and no
    # row of this append-only ledger had to be rewritten to add it.
    taken_at_store_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    # A payment only: how it was paid (owner decisions, 2026-10-04). The first
    # payment holds the way the sale was sold with. NULL for a payment taken
    # before revision 0035, which reads «не вказано», and for every other
    # entry: a return's money goes back on its refund, and a write-off moves
    # none.
    payment_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # A payment only: the period of the drawer of the store that took it,
    # stamped by the database at insert (ADR-0012, B3). Never written by the
    # application.
    drawer_period: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # A payment typed from paper after the server did not answer (owner
    # decision, 2026-10-10; ADR-0021): the mark «під час збою», as a sale's.
    # It may name who took the payment, as the paper says (one who may take
    # payments in the store that took it), and the paper's time, composed in
    # that store's zone. Who typed it is `actor_user_id`; the day and the
    # drawer are those of the moment it was typed. Never changed: the ledger's
    # guard freezes every column of an entry (revision 0038).
    during_outage: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    outage_taken_by: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=True,
    )
    outage_taken_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("kind IN ('PAYMENT', 'RETURN', 'WRITE_OFF')", name="kind_known"),
        CheckConstraint("amount >= 0 AND cash_back >= 0", name="amounts_not_negative"),
        # Only a return can lower nothing: goods worth less than nothing owed.
        CheckConstraint("kind = 'RETURN' OR amount > 0", name="payment_lowers_the_debt"),
        CheckConstraint("kind = 'RETURN' OR cash_back = 0", name="only_a_return_pays_back"),
        CheckConstraint("(kind = 'RETURN') = (refund_id IS NOT NULL)", name="return_names_refund"),
        CheckConstraint(
            "(kind = 'RETURN') = (command_id IS NULL AND command_fingerprint IS NULL)",
            name="command_names_payment",
        ),
        # A write-off says why when it is written (`credit_entry_guard`, on
        # insert); its reason is erased with its customer (ADR-0015).
        CheckConstraint("kind = 'WRITE_OFF' OR note IS NULL", name="only_a_write_off_says_why"),
        CheckConstraint(
            "taken_at_store_id IS NULL OR kind = 'PAYMENT'", name="only_a_payment_is_taken"
        ),
        CheckConstraint(
            "payment_method IS NULL OR payment_method IN "
            "('CASH', 'CARD', 'TRANSFER', 'PREPAID_TRANSFER', 'CARRIER_COD')",
            name="payment_method_known",
        ),
        CheckConstraint(
            "payment_method IS NULL OR kind = 'PAYMENT'", name="only_a_payment_has_a_method"
        ),
        CheckConstraint(
            "drawer_period IS NULL OR kind = 'PAYMENT'", name="only_a_payment_has_a_period"
        ),
        CheckConstraint(
            "drawer_period IS NULL OR drawer_period > 0", name="drawer_period_positive"
        ),
        CheckConstraint("NOT during_outage OR kind = 'PAYMENT'", name="only_a_payment_is_marked"),
        CheckConstraint(
            "during_outage OR (outage_taken_by IS NULL AND outage_taken_at IS NULL)",
            name="outage_details_need_the_mark",
        ),
        ForeignKeyConstraint(
            ["organization_id", "taken_at_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_credit_entry_org_taken_at_store",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("organization_id", "command_id", name="uq_credit_entry_org_command"),
        UniqueConstraint("refund_id", name="uq_credit_entry_refund_id"),
        Index("ix_credit_entry_credit_id_created_at", "credit_id", "created_at"),
        Index(
            "ix_credit_entry_drawer_period",
            "drawer_period",
            postgresql_where=text("kind = 'PAYMENT'"),
        ),
    )


__all__ = ["CreditEntry", "CreditStatus", "CustomerCredit", "EntryKind"]
