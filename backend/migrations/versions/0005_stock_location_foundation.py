"""Add empty location/access tables without changing the stock model.

No locations, grants or balances are inferred. Existing store-based inventory
and ledger remain untouched until the separately reviewed migration phase.
Downgrade refuses to remove provisioned locations or access rows. Roll back
application code while retaining this additive schema if these tables are used.

Revision ID: 0005_stock_locations
Revises: 0004_refund_replay
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_stock_locations"
down_revision: str | None = "0004_refund_replay"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stock_location",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_stock_location"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            name="fk_stock_location_organization_id_organization",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("organization_id", "code", name="uq_stock_location_org_code"),
        sa.UniqueConstraint("organization_id", "id", name="uq_stock_location_organization_id_id"),
    )
    op.create_table(
        "store_location_access",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("store_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("can_sell", sa.Boolean(), nullable=False),
        sa.Column("can_receive", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_store_location_access"),
        sa.UniqueConstraint(
            "store_id", "location_id", name="uq_store_location_access_store_location"
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_store_location_access_org_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_store_location_access_org_location",
            ondelete="RESTRICT",
        ),
    )


def downgrade() -> None:
    # Serialize the emptiness check with writes: never silently discard
    # locations/grants created after this originally empty foundation.
    op.execute("LOCK TABLE store_location_access, stock_location IN ACCESS EXCLUSIVE MODE")
    op.execute(
        """DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM store_location_access)
           OR EXISTS (SELECT 1 FROM stock_location) THEN
            RAISE EXCEPTION 'Cannot downgrade populated stock-location foundation';
        END IF;
        END $$"""
    )
    op.drop_table("store_location_access")
    op.drop_table("stock_location")
