"""Explicit private warehouse control; preserve legacy/shared access.

Only recorded bootstrap child mappings are backfilled. Generic legacy
locations cannot be classified from names/codes. No stock/history is changed.
Downgrade refuses to erase any private control assignment.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_private_locations"
down_revision: str | None = "0008_transfer_replay"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "stock_location",
        sa.Column("managing_store_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    # Bootstrap evidence must be unambiguous and still refer to the same
    # tenant's records. Invalid UUIDs also abort this transaction, never guess.
    op.execute(
        """DO $$ BEGIN
        IF EXISTS (
            SELECT 1 FROM audit_log a
            LEFT JOIN stock_location l ON l.id = a.entity_id
                AND l.organization_id = a.organization_id
            LEFT JOIN store s ON s.id = (a.after->>'child_store_id')::uuid
                AND s.organization_id = a.organization_id
            WHERE a.action = 'bootstrap.child_warehouse.v1'
              AND (a.entity_type <> 'stock_location' OR l.id IS NULL OR s.id IS NULL
                   OR (a.after->>'location_id')::uuid IS DISTINCT FROM a.entity_id)
        ) OR EXISTS (
            SELECT entity_id FROM audit_log
            WHERE action = 'bootstrap.child_warehouse.v1'
            GROUP BY entity_id HAVING count(*) > 1
        ) THEN
            RAISE EXCEPTION 'Invalid bootstrap child mapping; explicit review required';
        END IF;
        END $$"""
    )
    op.execute(
        """UPDATE stock_location l
        SET managing_store_id = (a.after->>'child_store_id')::uuid
        FROM audit_log a
        WHERE a.action = 'bootstrap.child_warehouse.v1'
          AND a.entity_id = l.id AND a.organization_id = l.organization_id"""
    )
    op.create_foreign_key(
        "fk_stock_location_org_managing_store",
        "stock_location",
        "store",
        ["organization_id", "managing_store_id"],
        ["organization_id", "id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.execute("LOCK TABLE stock_location IN ACCESS EXCLUSIVE MODE")
    op.execute(
        """DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM stock_location WHERE managing_store_id IS NOT NULL) THEN
            RAISE EXCEPTION 'Cannot downgrade private warehouse controls';
        END IF;
        END $$"""
    )
    op.drop_constraint("fk_stock_location_org_managing_store", "stock_location", type_="foreignkey")
    op.drop_column("stock_location", "managing_store_id")
