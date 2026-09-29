"""A stock adjustment becomes a business operation. ADR-0007.

`0016` gave receiving goods a permanent identity and said, in ADR-0006's
consequences, that `POST /inventory/adjustments` still had the same defect:
idempotent only for as long as its 7-day response cache. Reproduced the same
way — a `STOCKTAKE` of +7, replayed with its original key after the record is
gone, leaves 14. It was the last stock-writing command outside invariant I20.

ADR-0006 set out three ways to close it; the owner chose on 2026-09-30 the one
that matches the rest of the system (ADR-0007): an aggregate row, as for a
receipt or a transfer.

**The table.** `stock_adjustment` carries only what the ledger cannot say —
the warehouse and acting store, bound compositely to the organization as every
stock table is (ADR-0004 §2.2); the actor; the permanent `command_id` under
`UNIQUE (organization_id, command_id)`; the note, which until now survived only
in an audit entry; and, following ADR-0003, `command_fingerprint` and
`response_snapshot`, both nullable for the reason `0004` gives in full.

**The change itself stays in the ledger.** The one `stock_movement` an
adjustment writes names this row through `reference_type = 'stock_adjustment'`
and `reference_id`. No ledger fact is repeated here, so the two cannot
disagree. `stock_movement` is append-only; no existing row is touched. Manual
adjustments made before this revision keep a NULL reference — their original
request cannot be reconstructed, and inventing one would record a fact nobody
stated.

**Downgrade** drops the table. It is safe over existing rows: no stock or
ledger row is deleted, and the movements that named an adjustment keep a
reference to a row that no longer exists — `reference_id` has never been a
foreign key, for the same reason on every command. What is lost is each
adjustment's permanent identity. Prefer rolling back code and keeping the
schema, as ADR-0003 already prefers.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0017_stock_adjustment"
down_revision: str | None = "0016_goods_receipt"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "stock_adjustment",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("acting_store_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("command_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
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
            name="fk_stock_adjustment_organization_id_organization",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name="fk_stock_adjustment_created_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_stock_adjustment_org_location",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "acting_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_stock_adjustment_org_store",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "organization_id", "command_id", name="uq_stock_adjustment_org_command"
        ),
    )


def downgrade() -> None:
    op.drop_table("stock_adjustment")
