"""Refunds.

A refund is a compensating operation, never an edit of the original sale
(`.ai/skills/compensating-operations.md`). Amounts are computed from the frozen
`SaleItem` snapshots, so refunding an item whose price changed since still
refunds what was actually charged.

Command identity (invariant I20) works exactly as it does for a sale:
`command_id` is permanent and unique, the idempotency record is a 7-day
response cache, and `command_fingerprint` + `response_snapshot` (revision
`0004_refund_replay`, following ADR-0003) let a retry arriving after that cache
expires receive the original refund instead of a unique-violation error.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import StrEnum
from typing import Any

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


class ReturnCondition(StrEnum):
    """What a returned unit is like, as the person taking it back states it
    (owner decision, 2026-09-15 §3, and 2026-10-01)."""

    INTACT = "INTACT"
    DAMAGED = "DAMAGED"


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
    # The store that took the goods back and handed the money back. Any store
    # of the network may (owner decision, 2026-10-01); `store_id` stays the
    # store that sold.
    taken_at_store_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("store.id", ondelete="RESTRICT"), nullable=False
    )
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # Nullable, exactly as on `sale`: NULL means this row's original request
    # cannot be proven, and a NOT NULL column here would make revision 0004 a
    # one-way door (see its docstring).
    command_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    response_snapshot: Mapped[dict[str, Any] | None] = mapped_column(
        postgresql.JSONB, nullable=True
    )
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # How the money went back: the sale's way unless the seller changed it
    # (owner decisions, 2026-10-04), and always one of the till's three ways.
    # NULL for a refund taken before revision 0035, which reads «не вказано»,
    # and for one of a sale paid in parts that only lowered the debt: no money
    # went back. Never changed after the insert; the database refuses it.
    payment_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # The period of the drawer of the store that took the goods back, stamped
    # by the database at insert (ADR-0012, B3). Never written by the
    # application.
    drawer_period: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint("organization_id", "command_id", name="uq_refund_org_command"),
        Index("ix_refund_sale", "sale_id"),
        Index("ix_refund_taken_at_store", "taken_at_store_id"),
        Index("ix_refund_taken_at_store_id_drawer_period", "taken_at_store_id", "drawer_period"),
        CheckConstraint("total_amount >= 0", name="amount_not_negative"),
        CheckConstraint("char_length(currency_code) = 3", name="currency_code_iso4217"),
        CheckConstraint(
            "payment_method IS NULL OR payment_method IN ('CASH', 'CARD', 'TRANSFER')",
            name="payment_method_known",
        ),
        CheckConstraint(
            "drawer_period IS NULL OR drawer_period > 0", name="drawer_period_positive"
        ),
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
    # `final_unit_price * quantity`, taken from the frozen SaleItem. Never
    # recomputed from the catalog and never supplied by the client
    # (invariant I8, `.ai/skills/financial-integrity.md`).
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Goods physically came back, so stock returns. A refund without restock
    # returns money for goods that did not come back, and must be explicit.
    restock: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # Intact or damaged, stated for every unit that came back (owner
    # decisions, 2026-09-15 §3 and 2026-10-01). Intact goes back where it was
    # sold from; damaged goes to the store's «Брак». NULL for goods that did
    # not come back, and for returns taken before the condition was asked —
    # guessing theirs would record a fact nobody stated.
    condition: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # Where the units went back: the warehouse the sale line drew them from
    # (owner decision, 2026-09-17), or the store's «Брак» for damaged ones
    # (2026-10-01). Nullable on purpose: a line that was not
    # restocked writes no movement, and asserting a shelf for goods that went
    # in the bin would invent history. The CHECK makes the two agree in both
    # directions, which is stronger than NOT NULL would be.
    destination_location_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("stock_location.id", ondelete="RESTRICT"),
        nullable=True,
    )

    __table_args__ = (
        Index("ix_refund_item_refund", "refund_id"),
        Index("ix_refund_item_sale_item", "sale_item_id"),
        CheckConstraint(
            "(restock IS TRUE) = (destination_location_id IS NOT NULL)",
            name="destination_matches_restock",
        ),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("amount >= 0", name="amount_not_negative"),
        CheckConstraint(
            "condition IS NULL OR (restock AND condition IN ('INTACT', 'DAMAGED'))",
            name="condition_only_for_goods_back",
        ),
        # A sale line may come back in parts, one per condition, and each part
        # is one row: the returnable check sums them all.
        UniqueConstraint(
            "refund_id",
            "sale_item_id",
            "condition",
            name="uq_refund_item_refund_sale_item_condition",
            postgresql_nulls_not_distinct=True,
        ),
    )


__all__ = ["Refund", "RefundItem", "ReturnCondition"]
