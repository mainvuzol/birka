"""Physical stock reservations and customer dispatch ledger types."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_stock_reservations"
down_revision: str | None = "0009_private_locations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'ORDER_DISPATCH'")
    op.execute("ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'ORDER_RETURN'")
    op.add_column(
        "inventory",
        sa.Column("reserved_quantity", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        op.f("ck_inventory_reservation_within_stock"),
        "inventory",
        "reserved_quantity >= 0 AND reserved_quantity <= quantity",
    )
    op.create_table(
        "stock_reservation",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("store_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reference_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "product_variant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("product_variant.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "size_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("size.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_stock_reservation_org_location",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_stock_reservation_org_store",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "organization_id",
            "reference_id",
            "location_id",
            "product_variant_id",
            "size_id",
            name="uq_stock_reservation_reference_key",
        ),
        sa.CheckConstraint("quantity > 0", name="quantity_positive"),
    )


def downgrade() -> None:
    op.execute("LOCK TABLE stock_reservation, inventory, stock_movement IN ACCESS EXCLUSIVE MODE")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM stock_reservation)
        OR EXISTS (SELECT 1 FROM inventory WHERE reserved_quantity <> 0)
        OR EXISTS (SELECT 1 FROM stock_movement WHERE movement_type::text IN ('ORDER_DISPATCH', 'ORDER_RETURN')) THEN
            RAISE EXCEPTION 'Reservation or order movement history exists; downgrade refused';
        END IF;
    END $$""")
    op.drop_table("stock_reservation")
    op.drop_constraint(op.f("ck_inventory_reservation_within_stock"), "inventory", type_="check")
    op.drop_column("inventory", "reserved_quantity")
    # PostgreSQL cannot remove enum values in place. Unused labels are harmless;
    # retaining them avoids rewriting the append-only ledger and its constraints.
