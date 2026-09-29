"""A goods receipt becomes a business operation, not just its side effects.

Receiving goods was the one stock-writing command with no permanent identity.
A sale, a refund, a transfer and an approved legacy list all carry a
`command_id` under `UNIQUE (organization_id, command_id)` — invariant I20,
"a critical command can never create a second business operation, at any
distance in time" — and `POST /inventory/receipts` carried none. Nothing in
the plan, the ADRs or the tests recorded a decision to exempt it; it reads as
an omission, and it was reproduced before this revision was written:

    receive 10 → replay the same key → replayed, still 10   (the cache works)
    delete the idempotency record → replay the same key → 20, in two lots

Seven days is the whole of that protection, and the client pattern that
reaches past it is the ordinary one — a command written to durable storage
before it is sent and replayed when the app is opened again, exactly what the
till does for a sale.

**The table.** `goods_receipt` mirrors `transfer`: the warehouse that received
the goods and the store on whose authority they arrived, bound compositely to
the organization as every stock table is (ADR-0004 §2.2); the actor; the
permanent `command_id`; and, following ADR-0003, `command_fingerprint` and
`response_snapshot`, so a retry arriving after the cache expires receives the
original receipt instead of a unique violation.

Both replay columns are **nullable**, for the reason `0004` gives in full: a
NOT NULL column is dropped by `downgrade()` and cannot be re-added over rows
that exist, which would make this a one-way door the first time anyone
received a delivery.

**The link.** `stock_lot.goods_receipt_id` is nullable and `RESTRICT`, because
most lots have no receipt and never will: an opening balance comes from a
legacy list, and a restocking refund makes a lot out of goods already here.
Lots that predate this revision keep NULL — their original request cannot be
reconstructed, and inventing a receipt for them would be a fact nobody stated.

**Downgrade** drops the link and the table. It is safe over existing rows: no
stock, ledger row or lot is deleted, and a lot simply stops naming the
delivery it came from. What is lost is the permanent identity of every receipt
made under this revision, so re-upgrading leaves them unprotected against a
replay of their own `command_id` — prefer rolling back code and keeping the
schema, as ADR-0003 already prefers.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016_goods_receipt"
down_revision: str | None = "0015_snapshot_import"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "goods_receipt",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("receiving_store_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("command_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("response_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            name="fk_goods_receipt_organization_id_organization",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name="fk_goods_receipt_created_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_goods_receipt_org_location",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "receiving_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_goods_receipt_org_store",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("organization_id", "command_id", name="uq_goods_receipt_org_command"),
    )
    op.add_column(
        "stock_lot",
        sa.Column("goods_receipt_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_stock_lot_goods_receipt_id_goods_receipt",
        "stock_lot",
        "goods_receipt",
        ["goods_receipt_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_stock_lot_goods_receipt_id_goods_receipt", "stock_lot", type_="foreignkey"
    )
    op.drop_column("stock_lot", "goods_receipt_id")
    op.drop_table("goods_receipt")
