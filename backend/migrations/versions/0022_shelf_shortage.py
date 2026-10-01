"""The empty shelf: a basket nothing of which was there. M1-030, owner question Q-G.

The owner decided on 2026-10-01 (business-rules.md, "nothing on the shelf")
that a line with nothing on the shelf is dropped from the sale and its
shortage recorded, and that when this leaves nothing to sell the shortage is
still recorded, without a sale.

**`shelf_shortage`** — one row per such basket. It is the command's permanent
identity, sharing the basket's `command_id` with sales; the `MISSING_AT_SALE`
movements it wrote name it (`reference_type = 'shelf_shortage'`). It is bound
to its organization compositely, as every newer table is.

No other schema changes: dropping a line from a sale needs none.

**Downgrade** drops the table, and refuses while any row exists. Its
movements stay in the ledger whatever happens, and without the row they would
name nothing, and a retried basket could take its stock off again.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0022_shelf_shortage"
down_revision: str | None = "0021_suggested_price"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "shelf_shortage",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("store_id", uuid, nullable=False),
        sa.Column("reported_by_user_id", uuid, nullable=False),
        sa.Column("command_id", uuid, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("lines", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_shelf_shortage"),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_shelf_shortage_org_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reported_by_user_id"],
            ["app_user.id"],
            name="fk_shelf_shortage_reported_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("organization_id", "command_id", name="uq_shelf_shortage_org_command"),
    )
    op.create_index(
        "ix_shelf_shortage_store_created_at", "shelf_shortage", ["store_id", "created_at"]
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM shelf_shortage) THEN
                RAISE EXCEPTION
                    'An empty shelf is recorded, and its movements name it; 0021 cannot '
                    'hold that. Keep this revision.';
            END IF;
        END $$;
        """
    )
    op.drop_index("ix_shelf_shortage_store_created_at", table_name="shelf_shortage")
    op.drop_table("shelf_shortage")
