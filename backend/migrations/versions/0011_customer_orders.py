"""Orders, frozen lines and permanent command responses; no stock backfill."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_customer_orders"
down_revision: str | None = "0010_stock_reservations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "customer_order",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organization.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("store_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("app_user.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column(
            "sale_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sale.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("currency_code", sa.String(3), server_default="UAH", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sale_id"),
        sa.UniqueConstraint("organization_id", "id"),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('READY_TO_DISPATCH','DISPATCHED','ARRIVED','COLLECTED','CANCELLED','RETURNED')",
            name="status_valid",
        ),
        sa.CheckConstraint(
            "(status = 'COLLECTED') = (sale_id IS NOT NULL)", name="sale_only_collected"
        ),
        sa.CheckConstraint("currency_code = 'UAH'", name="currency_uah"),
    )
    op.create_index("ix_customer_order_store_created", "customer_order", ["store_id", "created_at"])
    op.create_table(
        "customer_order_item",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("customer_order.id", ondelete="RESTRICT"),
            nullable=False,
        ),
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
        sa.Column(
            "source_location_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("stock_location.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("display_name_snapshot", sa.Text(), nullable=False),
        sa.Column("variant_snapshot", postgresql.JSONB(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "order_id",
            "source_location_id",
            "product_variant_id",
            "size_id",
            name="uq_customer_order_item_stock_key",
        ),
        sa.CheckConstraint("quantity BETWEEN 1 AND 1000", name="quantity_valid"),
        sa.CheckConstraint(
            "unit_price >= 0 AND discount_amount >= 0 AND discount_amount <= unit_price",
            name="money_valid",
        ),
    )
    op.create_table(
        "order_command",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organization.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("command_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("response_snapshot", postgresql.JSONB(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "command_id"),
        sa.ForeignKeyConstraint(
            ["organization_id", "order_id"],
            ["customer_order.organization_id", "customer_order.id"],
            ondelete="RESTRICT",
        ),
    )


def downgrade() -> None:
    op.execute(
        "LOCK TABLE customer_order, customer_order_item, order_command IN ACCESS EXCLUSIVE MODE"
    )
    op.execute(
        """DO $$ BEGIN IF EXISTS (SELECT 1 FROM customer_order) OR EXISTS (SELECT 1 FROM order_command) THEN RAISE EXCEPTION 'Cannot discard customer order history'; END IF; END $$"""
    )
    op.drop_table("order_command")
    op.drop_table("customer_order_item")
    op.drop_table("customer_order")
