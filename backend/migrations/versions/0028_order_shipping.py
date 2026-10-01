"""Where an order goes. Owner decisions, 2026-10-01.

The owner decided (business-rules.md, "where an order goes") that an order
goes within Ukraine — the default — by one of three carriers, or abroad;
that the carrier is picked when the order is made, and the waybill number,
or abroad one free text, written when it is sent or later; and that it may be
corrected while the order is open, its earlier versions kept.

**`customer_order`** gains `destination`, `carrier`, `waybill` with its
`waybill_key` (letters and digits alone, which a search and the warning
about one waybill on two orders compare), and `abroad_note`. An order made
before this has none of them: no destination is invented for it.

**`customer_order_shipping_change`** — each version, append-only, by the
same trigger as the stock ledger.

**Downgrade** refuses while any order states where it goes: 0027 cannot say
so.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0028_order_shipping"
down_revision: str | None = "0027_supplier_invoices"
branch_labels: str | None = None
depends_on: str | None = None

CHECKS = (
    ("destination IS NULL OR destination IN ('UKRAINE', 'ABROAD')", "destination_known"),
    ("carrier IS NULL OR carrier IN ('NOVA_POSHTA', 'UKRPOSHTA', 'MEEST')", "carrier_known"),
    (
        "(carrier IS NOT NULL) = (destination IS NOT DISTINCT FROM 'UKRAINE')",
        "carrier_within_ukraine",
    ),
    ("waybill IS NULL OR destination = 'UKRAINE'", "waybill_within_ukraine"),
    ("abroad_note IS NULL OR destination = 'ABROAD'", "note_abroad_only"),
)


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.add_column("customer_order", sa.Column("destination", sa.String(length=8), nullable=True))
    op.add_column("customer_order", sa.Column("carrier", sa.String(length=16), nullable=True))
    op.add_column("customer_order", sa.Column("waybill", sa.String(length=64), nullable=True))
    op.add_column("customer_order", sa.Column("waybill_key", sa.String(length=64), nullable=True))
    op.add_column("customer_order", sa.Column("abroad_note", sa.Text(), nullable=True))
    for check, name in CHECKS:
        op.create_check_constraint(name, "customer_order", check)
    op.create_check_constraint(
        "waybill_has_key", "customer_order", "(waybill IS NULL) = (waybill_key IS NULL)"
    )
    op.create_index(
        "ix_customer_order_store_id_waybill_key", "customer_order", ["store_id", "waybill_key"]
    )

    op.create_table(
        "customer_order_shipping_change",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("order_id", uuid, nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("destination", sa.String(length=8), nullable=False),
        sa.Column("carrier", sa.String(length=16), nullable=True),
        sa.Column("waybill", sa.String(length=64), nullable=True),
        sa.Column("abroad_note", sa.Text(), nullable=True),
        sa.Column("changed_by_user_id", uuid, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_customer_order_shipping_change"),
        sa.ForeignKeyConstraint(
            ["organization_id", "order_id"],
            ["customer_order.organization_id", "customer_order.id"],
            name="fk_customer_order_shipping_change_org_order",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["changed_by_user_id"],
            ["app_user.id"],
            name="fk_customer_order_shipping_change_changed_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("kind IN ('CREATED', 'DISPATCHED', 'CORRECTED')", name="kind_known"),
        *(sa.CheckConstraint(check, name=name) for check, name in CHECKS),
    )
    op.create_index(
        "ix_customer_order_shipping_change_order_id",
        "customer_order_shipping_change",
        ["order_id", "created_at"],
    )
    # Append-only, as the stock ledger is: the function has existed since 0002.
    op.execute(
        "CREATE TRIGGER customer_order_shipping_change_append_only "
        "BEFORE UPDATE OR DELETE ON customer_order_shipping_change "
        "FOR EACH ROW EXECUTE FUNCTION birka_reject_mutation();"
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM customer_order WHERE destination IS NOT NULL) THEN
                RAISE EXCEPTION
                    'Orders state where they go; 0027 cannot say so. Keep this revision.';
            END IF;
        END $$;
        """
    )
    op.execute(
        "DROP TRIGGER IF EXISTS customer_order_shipping_change_append_only "
        "ON customer_order_shipping_change"
    )
    op.drop_index(
        "ix_customer_order_shipping_change_order_id", table_name="customer_order_shipping_change"
    )
    op.drop_table("customer_order_shipping_change")
    op.drop_index("ix_customer_order_store_id_waybill_key", table_name="customer_order")
    op.drop_constraint("waybill_has_key", "customer_order", type_="check")
    for _, name in reversed(CHECKS):
        op.drop_constraint(name, "customer_order", type_="check")
    for column in ("abroad_note", "waybill_key", "waybill", "carrier", "destination"):
        op.drop_column("customer_order", column)
