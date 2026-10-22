"""The drawer's tables. Owner decisions, 2026-10-04; ADR-0012.

The owner decided (business-rules.md, "cash and card, the day's close"):

- one drawer per store, closed once a day: the seller on duty counts the
  cash without seeing what it should hold, then sees the difference, and
  what was counted is the next day's cash for change;
- a difference is recorded with a reason, which is required, and the bot
  tells the network's owner silently;
- cash taken out is recorded with who took it and why: for the owner, for
  expenses, for a supplier's courier; cash put in for change likewise;
- a closed day is never reopened: a wrong way of paying, or cash taken out
  and forgotten, is corrected on the day the correction is made.

**`cash_close`** — one row per close, every figure frozen at the close and
append-only: `expected = opening_float + cash_in − cash_out − taken_out +
put_in + cash_corrected`, `difference = counted − expected`, both CHECKs.
An opening count (a store's first close, or its first after coming back from
the archive) records what was counted and has no float, no expected sum and
no difference.

**`cash_close_reason`** — the reason for a close's difference, one per close,
written by whoever counted. A second command after the count: required in
the same request, the refusal would reveal the difference before the count
was final.

**`cash_movement`** — cash taken out (`OWNER`, `EXPENSES`,
`SUPPLIER_COURIER`) or put in for change (`CHANGE`). `amount` is always
positive; `direction` carries the sign. One naming an earlier close
(`for_close_id`) explains that close's difference and changes no period's
expected sum.

**`payment_correction`** — a wrong way fixed by a new row for exactly one
money row: a sale, a payment toward a debt, or a refund. `seq` counts them
per money row, and the current way is the `to_method` of the highest; never
the newest by time or id. A correction of a row in a closed period explains
that close (`explains_close_id`).

**`cash_message`** — what the bot tells of a difference, to each of the
network's owners, written before it is sent and retried for a day.

`drawer_period` on the movements and corrections, as on the money rows, is
stamped by the database under the store's lock (ADR-0012, B3), and the
correction's trigger checks it against its money row. The application never
writes it.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
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
from app.core.orm import TimestampMixin, UUIDPrimaryKey

FIVE_WAYS = "('CASH', 'CARD', 'TRANSFER', 'PREPAID_TRANSFER', 'CARRIER_COD')"


class MovementKind(StrEnum):
    """Why cash left the drawer, or came into it (owner decisions,
    2026-10-04). There is no «Інше»."""

    OWNER = "OWNER"  # «Власнику»
    EXPENSES = "EXPENSES"  # «Витрати»
    SUPPLIER_COURIER = "SUPPLIER_COURIER"  # «Кур’єру постачальника»
    # «Розмін»: the one kind that puts cash in («Внесено · розмін» in its row).
    CHANGE = "CHANGE"


class Direction(StrEnum):
    IN = "IN"
    OUT = "OUT"


class MessageStatus(StrEnum):
    PENDING = "PENDING"
    SENT = "SENT"
    # Telegram refused this person's chat for good: they never started the
    # bot, or blocked it.
    REFUSED = "REFUSED"
    # Telegram could not be reached for a day, or the account was disabled.
    FAILED = "FAILED"


class CashClose(UUIDPrimaryKey, TimestampMixin, Base):
    """One close of one store's drawer. Append-only."""

    __tablename__ = "cash_close"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # 1, 2, … per store. Close k ends the store's period k.
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    # Nothing to compare the count with: the store's first close, or its first
    # after coming back from the archive.
    is_opening: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # The day this close is for, in the store's time zone, running 06:00 to
    # 06:00: a close before 06:00 is the evening before's. One per store.
    business_day: Mapped[date] = mapped_column(Date, nullable=False)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Where the period began: the previous close's moment. NULL for the first.
    since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    command_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    # The previous close's count; NULL for an opening count.
    opening_float: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    counted: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # The period's cash, frozen: taken, handed back, taken out, put in, and
    # moved by corrections of the period's own money rows.
    cash_in: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    cash_out: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    taken_out: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    put_in: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    cash_corrected: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    expected: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    difference: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    # Every other way, for display only: card and transfer to compare with
    # the terminal's slip, the order ways and «не вказано». Not counted.
    others: Mapped[dict[str, Any]] = mapped_column(
        postgresql.JSONB, nullable=False, server_default="{}"
    )
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_cash_close_org_store",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("organization_id", "command_id", name="uq_cash_close_org_command"),
        UniqueConstraint("store_id", "number", name="uq_cash_close_store_id_number"),
        UniqueConstraint("store_id", "business_day", name="uq_cash_close_store_id_business_day"),
        # Target of the composite foreign keys that keep a movement or a
        # correction to its own store's closes.
        UniqueConstraint("store_id", "id", name="uq_cash_close_store_id_id"),
        CheckConstraint("number > 0", name="number_positive"),
        CheckConstraint("counted >= 0", name="counted_not_negative"),
        CheckConstraint("number <> 1 OR is_opening", name="first_is_opening"),
        CheckConstraint("is_opening = (opening_float IS NULL)", name="opening_has_no_float"),
        CheckConstraint(
            "(opening_float IS NULL) = (expected IS NULL) "
            "AND (expected IS NULL) = (difference IS NULL)",
            name="expected_with_float",
        ),
        CheckConstraint(
            "expected IS NULL OR expected = "
            "opening_float + cash_in - cash_out - taken_out + put_in + cash_corrected",
            name="expected_is_the_sum",
        ),
        CheckConstraint(
            "difference IS NULL OR difference = counted - expected", name="difference_is_counted"
        ),
        CheckConstraint("jsonb_typeof(others) = 'object'", name="others_object"),
    )


class CashCloseReason(UUIDPrimaryKey, TimestampMixin, Base):
    """Why a close's count differs, as whoever counted wrote it. One per
    close; append-only."""

    __tablename__ = "cash_close_reason"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    close_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("cash_close.id", ondelete="RESTRICT"),
        nullable=False,
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    command_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (
        UniqueConstraint("close_id", name="uq_cash_close_reason_close_id"),
        UniqueConstraint("organization_id", "command_id", name="uq_cash_close_reason_org_command"),
        CheckConstraint(
            "char_length(btrim(reason)) > 0 AND char_length(reason) <= 1000", name="says_why"
        ),
    )


class CashMovement(UUIDPrimaryKey, TimestampMixin, Base):
    """Cash taken out of a store's drawer, or put in for change. Append-only."""

    __tablename__ = "cash_movement"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # IN exactly for `CHANGE`.
    direction: Mapped[str] = mapped_column(String(3), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The close this cash moved before: named by a person for one forgotten,
    # or set when the phone recorded it before a close that reached the
    # server first (`moved_to_close`). It explains that close's difference.
    for_close_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    moved_to_close: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    # Stamped by the database at insert; never written by the application.
    drawer_period: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    command_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_cash_movement_org_store",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["store_id", "for_close_id"],
            ["cash_close.store_id", "cash_close.id"],
            name="fk_cash_movement_store_for_close",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("organization_id", "command_id", name="uq_cash_movement_org_command"),
        CheckConstraint(
            "kind IN ('OWNER', 'EXPENSES', 'SUPPLIER_COURIER', 'CHANGE')", name="kind_known"
        ),
        CheckConstraint("direction IN ('IN', 'OUT')", name="direction_known"),
        CheckConstraint("(direction = 'IN') = (kind = 'CHANGE')", name="direction_of_kind"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("note IS NULL OR char_length(note) <= 200", name="note_short"),
        CheckConstraint("NOT moved_to_close OR for_close_id IS NOT NULL", name="moved_names_close"),
        CheckConstraint(
            "drawer_period IS NULL OR drawer_period > 0", name="drawer_period_positive"
        ),
        Index("ix_cash_movement_store_id_drawer_period", "store_id", "drawer_period"),
        Index("ix_cash_movement_for_close_id", "for_close_id"),
    )


class PaymentCorrection(UUIDPrimaryKey, TimestampMixin, Base):
    """A wrong way of paying, corrected for one money row. Append-only.

    `store_id`, `direction` and `amount` are the money row's own — its
    drawer, IN for a sale or a payment and OUT for a refund, and the money it
    took or handed back — and the database refuses any other.
    """

    __tablename__ = "payment_correction"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # Exactly one of the three: the money row this corrects.
    sale_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("sale.id", ondelete="RESTRICT"), nullable=True
    )
    credit_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("credit_entry.id", ondelete="RESTRICT"),
        nullable=True,
    )
    refund_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("refund.id", ondelete="RESTRICT"), nullable=True
    )
    # 1, 2, … per money row.
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    direction: Mapped[str] = mapped_column(String(3), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # NULL for «не вказано»: a row written with a period but no way.
    from_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_method: Mapped[str] = mapped_column(String(20), nullable=False)
    # The close of the money row's period, when that period was closed.
    explains_close_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    # Stamped by the database at insert; never written by the application.
    drawer_period: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    command_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_payment_correction_org_store",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["store_id", "explains_close_id"],
            ["cash_close.store_id", "cash_close.id"],
            name="fk_payment_correction_store_explains_close",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("organization_id", "command_id", name="uq_payment_correction_org_command"),
        # Also the per-row indexes the current way is read through.
        UniqueConstraint("sale_id", "seq", name="uq_payment_correction_sale_id_seq"),
        UniqueConstraint(
            "credit_entry_id", "seq", name="uq_payment_correction_credit_entry_id_seq"
        ),
        UniqueConstraint("refund_id", "seq", name="uq_payment_correction_refund_id_seq"),
        CheckConstraint(
            "num_nonnulls(sale_id, credit_entry_id, refund_id) = 1", name="one_money_row"
        ),
        CheckConstraint("direction IN ('IN', 'OUT')", name="direction_known"),
        CheckConstraint("(direction = 'OUT') = (refund_id IS NOT NULL)", name="out_is_a_refund"),
        CheckConstraint(
            f"from_method IS NULL OR from_method IN {FIVE_WAYS}", name="from_method_known"
        ),
        CheckConstraint(f"to_method IN {FIVE_WAYS}", name="to_method_known"),
        CheckConstraint("from_method IS DISTINCT FROM to_method", name="changes_the_way"),
        CheckConstraint("amount >= 0", name="amount_not_negative"),
        CheckConstraint("seq > 0", name="seq_positive"),
        CheckConstraint("note IS NULL OR char_length(note) <= 200", name="note_short"),
        CheckConstraint(
            "drawer_period IS NULL OR drawer_period > 0", name="drawer_period_positive"
        ),
        Index("ix_payment_correction_store_id_drawer_period", "store_id", "drawer_period"),
        Index("ix_payment_correction_explains_close_id", "explains_close_id"),
    )


class CashMessage(UUIDPrimaryKey, TimestampMixin, Base):
    """One message about one close's difference to one of the network's
    owners, written before it is sent, so it goes once however often the
    watcher looks. Its status moves, as a backup alert's does."""

    __tablename__ = "cash_message"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    close_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("cash_close.id", ondelete="RESTRICT"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=MessageStatus.PENDING.value
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("close_id", "user_id", name="uq_cash_message_close_id_user_id"),
        CheckConstraint("status IN ('PENDING', 'SENT', 'REFUSED', 'FAILED')", name="status_known"),
        CheckConstraint("(status = 'SENT') = (sent_at IS NOT NULL)", name="sent_has_time"),
        CheckConstraint("attempts >= 0", name="attempts_not_negative"),
    )


__all__ = [
    "CashClose",
    "CashCloseReason",
    "CashMessage",
    "CashMovement",
    "Direction",
    "MessageStatus",
    "MovementKind",
    "PaymentCorrection",
]
