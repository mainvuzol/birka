"""The «Брак» section: one row per unit returned damaged. M1-027.

The owner decided on 2026-10-01 (business-rules.md, "what happens in «Брак»")
that anyone who takes returns may take a unit in «Брак» for inspection —
visibly to the others — then put it back on sale in the warehouse it was sold
from, or confirm it damaged and, later, write it off; and that stock in «Брак»
changes only through returns and this section.

**`damaged_unit`** — one row per unit, bound to its organization compositely
as every stock table is, naming the damaged return it came back in and the
warehouse it was sold from. Its CHECKs hold that:

- a unit nobody touched has nobody's name on it, and a touched one does;
- a unit back on sale names the transfer that moved it;
- a written-off unit names the stock adjustment that did it.

The stock stays in the ledger: those two are ordinary ledger commands.

**Existing damaged returns** — taken under `0019`, before this revision — get
their rows now, one per unit, waiting for inspection. They are in «Брак» by
the ledger already; without rows they could never be inspected.

**`damaged:handle`** is granted to every role that holds `sale:refund`, as it
now is by default: the owner gave «Брак» to whoever takes returns, whatever a
role is called.

**Downgrade** drops the table and the grant. The ledger — the damaged returns,
the transfers back on sale, the write-offs — is untouched; what is lost is
which unit stood where, and who looked at it.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0020_damaged_units"
down_revision: str | None = "0019_till_returns"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    # Check constraint names are short: the naming convention on the metadata
    # makes them `ck_<table>_<name>`, as in the models.
    op.create_table(
        "damaged_unit",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("store_id", uuid, nullable=False),
        sa.Column("location_id", uuid, nullable=False),
        sa.Column("product_variant_id", uuid, nullable=False),
        sa.Column("size_id", uuid, nullable=False),
        sa.Column("refund_item_id", uuid, nullable=False),
        sa.Column("sold_from_location_id", uuid, nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("size_label", sa.String(length=40), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="AWAITING"),
        sa.Column("status_by_user_id", uuid, nullable=True),
        sa.Column("status_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("transfer_id", uuid, nullable=True),
        sa.Column("stock_adjustment_id", uuid, nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_damaged_unit"),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_damaged_unit_org_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_damaged_unit_org_location",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "sold_from_location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_damaged_unit_org_sold_from",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["product_variant_id"],
            ["product_variant.id"],
            name="fk_damaged_unit_product_variant_id_product_variant",
        ),
        sa.ForeignKeyConstraint(["size_id"], ["size.id"], name="fk_damaged_unit_size_id_size"),
        sa.ForeignKeyConstraint(
            ["refund_item_id"],
            ["refund_item.id"],
            name="fk_damaged_unit_refund_item_id_refund_item",
        ),
        sa.ForeignKeyConstraint(
            ["status_by_user_id"],
            ["app_user.id"],
            name="fk_damaged_unit_status_by_user_id_app_user",
        ),
        sa.ForeignKeyConstraint(
            ["transfer_id"], ["transfer.id"], name="fk_damaged_unit_transfer_id_transfer"
        ),
        sa.ForeignKeyConstraint(
            ["stock_adjustment_id"],
            ["stock_adjustment.id"],
            name="fk_damaged_unit_stock_adjustment_id_stock_adjustment",
        ),
        sa.CheckConstraint(
            "status IN ('AWAITING', 'INSPECTING', 'CONFIRMED', 'RETURNED', 'WRITTEN_OFF')",
            name="status_known",
        ),
        sa.CheckConstraint(
            "(status = 'AWAITING') = (status_by_user_id IS NULL AND status_at IS NULL)",
            name="touched_has_who_and_when",
        ),
        sa.CheckConstraint(
            "(status = 'RETURNED') = (transfer_id IS NOT NULL)", name="returned_by_transfer"
        ),
        sa.CheckConstraint(
            "(status = 'WRITTEN_OFF') = (stock_adjustment_id IS NOT NULL)",
            name="written_off_by_adjustment",
        ),
    )
    op.create_index("ix_damaged_unit_store_id_status", "damaged_unit", ["store_id", "status"])
    op.create_index("ix_damaged_unit_refund_item_id", "damaged_unit", ["refund_item_id"])

    # One row per unit of every damaged return already taken, waiting.
    op.execute(
        """
        INSERT INTO damaged_unit (
            id, organization_id, store_id, location_id, product_variant_id, size_id,
            refund_item_id, sold_from_location_id, display_name, size_label, created_at
        )
        SELECT gen_random_uuid(), r.organization_id, r.store_id, ri.destination_location_id,
               si.product_variant_id, si.size_id, ri.id, si.source_location_id,
               si.display_name_snapshot, si.variant_snapshot ->> 'size', r.created_at
        FROM refund_item ri
        JOIN refund r ON r.id = ri.refund_id
        JOIN sale_item si ON si.id = ri.sale_item_id
        CROSS JOIN LATERAL generate_series(1, ri.quantity)
        WHERE ri.condition = 'DAMAGED'
        """
    )
    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT role_id, 'damaged:handle' FROM role_permission "
        "WHERE permission_code = 'sale:refund' "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DELETE FROM role_permission WHERE permission_code = 'damaged:handle'")
    op.drop_index("ix_damaged_unit_refund_item_id", table_name="damaged_unit")
    op.drop_index("ix_damaged_unit_store_id_status", table_name="damaged_unit")
    op.drop_table("damaged_unit")
