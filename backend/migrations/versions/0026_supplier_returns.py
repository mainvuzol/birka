"""Returns to a supplier. Owner decisions, 2026-10-01.

The owner decided (business-rules.md, "returns to a supplier") that the owner
and managers return goods to a supplier — from a warehouse, as one document
with a list, or a confirmed unit from «Брак» — picking the supplier from the
network's list; that only the goods are recorded; and that a return may be
cancelled, whole, once, saying why, its goods going back where they left.

**`supplier`** — the network's list. A name is unique within it, whatever
its spacing or letter case (`normalized_name`).

**`supplier_return`, `supplier_return_line`, `supplier_return_cancel`** — a
return, what it took, and its cancellation. Append-only, by the same trigger
as the stock ledger: whether a return stands is whether a cancellation names
it. A return of a unit from «Брак» names it.

**`damaged_unit`** gains the status `SUPPLIER` and the return that took it,
while that return stands.

**`movement_type`** gains `SUPPLIER_RETURN` and `SUPPLIER_RETURN_CANCEL`.

**Permissions:** `supplier:return` to every role that may correct stock
(`inventory:adjust`) — the owner's and managers', by default.

**Downgrade** refuses while any supplier is on the list: its returns would
be left unexplained, the goods gone from stock for no reason 0025 can say.
The enum's labels stay, as 0010's do: PostgreSQL cannot drop them in place.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0026_supplier_returns"
down_revision: str | None = "0025_store_states"
branch_labels: str | None = None
depends_on: str | None = None

APPEND_ONLY = ("supplier_return", "supplier_return_line", "supplier_return_cancel")


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    now = sa.text("now()")
    op.execute("ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'SUPPLIER_RETURN'")
    op.execute("ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'SUPPLIER_RETURN_CANCEL'")

    op.create_table(
        "supplier",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("normalized_name", sa.String(length=200), nullable=False),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("created_by_user_id", uuid, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_supplier"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            name="fk_supplier_organization_id_organization",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name="fk_supplier_created_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "organization_id", "normalized_name", name="uq_supplier_organization_id_normalized_name"
        ),
        sa.UniqueConstraint("organization_id", "id", name="uq_supplier_organization_id_id"),
        sa.CheckConstraint("char_length(btrim(name)) > 0", name="has_a_name"),
    )

    op.create_table(
        "supplier_return",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("store_id", uuid, nullable=False),
        sa.Column("location_id", uuid, nullable=False),
        sa.Column("supplier_id", uuid, nullable=False),
        sa.Column("damaged_unit_id", uuid, nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", uuid, nullable=False),
        sa.Column("command_id", uuid, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_supplier_return"),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_supplier_return_org_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_supplier_return_org_location",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "supplier_id"],
            ["supplier.organization_id", "supplier.id"],
            name="fk_supplier_return_org_supplier",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["damaged_unit_id"],
            ["damaged_unit.id"],
            name="fk_supplier_return_damaged_unit_id_damaged_unit",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name="fk_supplier_return_created_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("organization_id", "command_id", name="uq_supplier_return_org_command"),
    )
    op.create_index(
        "ix_supplier_return_store_id_created_at", "supplier_return", ["store_id", "created_at"]
    )
    op.create_index("ix_supplier_return_supplier_id", "supplier_return", ["supplier_id"])
    op.create_index("ix_supplier_return_damaged_unit_id", "supplier_return", ["damaged_unit_id"])

    op.create_table(
        "supplier_return_line",
        sa.Column("id", uuid, nullable=False),
        sa.Column("supplier_return_id", uuid, nullable=False),
        sa.Column("product_variant_id", uuid, nullable=False),
        sa.Column("size_id", uuid, nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("size_label", sa.String(length=40), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_supplier_return_line"),
        sa.ForeignKeyConstraint(
            ["supplier_return_id"],
            ["supplier_return.id"],
            name="fk_supplier_return_line_supplier_return_id_supplier_return",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["product_variant_id"],
            ["product_variant.id"],
            name="fk_supplier_return_line_product_variant_id_product_variant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["size_id"],
            ["size.id"],
            name="fk_supplier_return_line_size_id_size",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "supplier_return_id",
            "product_variant_id",
            "size_id",
            name="uq_supplier_return_line_return_variant_size",
        ),
        sa.CheckConstraint("quantity > 0", name="quantity_positive"),
    )

    op.create_table(
        "supplier_return_cancel",
        sa.Column("id", uuid, nullable=False),
        sa.Column("supplier_return_id", uuid, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", uuid, nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_supplier_return_cancel"),
        sa.ForeignKeyConstraint(
            ["supplier_return_id"],
            ["supplier_return.id"],
            name="fk_supplier_return_cancel_supplier_return_id_supplier_return",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name="fk_supplier_return_cancel_created_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "supplier_return_id", name="uq_supplier_return_cancel_supplier_return_id"
        ),
        sa.CheckConstraint("char_length(btrim(reason)) > 0", name="says_why"),
    )
    # Append-only, as the stock ledger is: the function has existed since 0002.
    for table in APPEND_ONLY:
        op.execute(
            f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION birka_reject_mutation();"
        )

    op.add_column("damaged_unit", sa.Column("supplier_return_id", uuid, nullable=True))
    op.create_foreign_key(
        "fk_damaged_unit_supplier_return",
        "damaged_unit",
        "supplier_return",
        ["supplier_return_id"],
        ["id"],
    )
    op.drop_constraint("status_known", "damaged_unit", type_="check")
    op.create_check_constraint(
        "status_known",
        "damaged_unit",
        "status IN ('AWAITING', 'INSPECTING', 'CONFIRMED', 'RETURNED', 'WRITTEN_OFF', 'SUPPLIER')",
    )
    op.create_check_constraint(
        "with_the_supplier_by_a_return",
        "damaged_unit",
        "(status = 'SUPPLIER') = (supplier_return_id IS NOT NULL)",
    )

    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT DISTINCT role_id, 'supplier:return' FROM role_permission "
        "WHERE permission_code = 'inventory:adjust' "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM supplier) THEN
                RAISE EXCEPTION
                    'Suppliers are on the list, and goods may have gone back to them; '
                    '0025 cannot say so. Keep this revision.';
            END IF;
        END $$;
        """
    )
    op.execute("DELETE FROM role_permission WHERE permission_code = 'supplier:return'")
    op.drop_constraint("with_the_supplier_by_a_return", "damaged_unit", type_="check")
    op.drop_constraint("status_known", "damaged_unit", type_="check")
    op.create_check_constraint(
        "status_known",
        "damaged_unit",
        "status IN ('AWAITING', 'INSPECTING', 'CONFIRMED', 'RETURNED', 'WRITTEN_OFF')",
    )
    op.drop_constraint("fk_damaged_unit_supplier_return", "damaged_unit", type_="foreignkey")
    op.drop_column("damaged_unit", "supplier_return_id")
    for table in APPEND_ONLY:
        op.execute(f"DROP TRIGGER IF EXISTS {table}_append_only ON {table}")
    op.drop_table("supplier_return_cancel")
    op.drop_table("supplier_return_line")
    op.drop_index("ix_supplier_return_damaged_unit_id", table_name="supplier_return")
    op.drop_index("ix_supplier_return_supplier_id", table_name="supplier_return")
    op.drop_index("ix_supplier_return_store_id_created_at", table_name="supplier_return")
    op.drop_table("supplier_return")
    op.drop_table("supplier")
