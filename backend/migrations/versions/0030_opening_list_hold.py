"""A warehouse waits for its opening list. Owner decision, 2026-10-02.

The owner decided (business-rules.md, "the first days") that the opening
lists are approved before new deliveries are received, and chose that the app
keep that order: while a list waits for a warehouse with no stock history,
nothing moves there.

**`opening_list_hold`** — one row per list that waits, naming its warehouse.
The legacy list workflow writes it when it keeps a list and deletes it when
the list is approved or rejected; the ledger reads it, so module `inventory`
never reads the lists themselves (ADR-0001).

Lists already waiting (`IN_REVIEW`) are given their hold.

**Downgrade** drops the table: a hold is only ever derived from a list that
waits, so nothing is lost.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0030_opening_list_hold"
down_revision: str | None = "0029_borrowed_goods"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "opening_list_hold",
        sa.Column("snapshot_id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("location_id", uuid, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["inventory_snapshot.id"],
            name="fk_opening_list_hold_snapshot_id_inventory_snapshot",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_opening_list_hold_org_location",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("snapshot_id", name="pk_opening_list_hold"),
    )
    op.create_index("ix_opening_list_hold_location_id", "opening_list_hold", ["location_id"])
    op.execute(
        "INSERT INTO opening_list_hold (snapshot_id, organization_id, location_id) "
        "SELECT id, organization_id, location_id FROM inventory_snapshot "
        "WHERE status = 'IN_REVIEW' AND location_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_opening_list_hold_location_id", table_name="opening_list_hold")
    op.drop_table("opening_list_hold")
