"""Borrowed goods, and goods under consignment. Owner decisions, 2026-10-01.

The owner decided (business-rules.md, "goods borrowed from another shop")
that jackets taken from another shop, as from a supplier, are paid for only
once sold, at the price agreed for each, and go back unsold for nothing; and
that goods under consignment work the same. They arrive through receiving,
naming the supplier; the owner or a manager marks some sold, which is an
invoice in «Накладні», or sends them back, which is a return to the supplier.

**`goods_receipt.supplier_id`** — whose goods came. Required by the server
whenever any of them are borrowed or under consignment.

**`supplier_invoice.stock_lot_id`, `lot_quantity`, `lot_label`** — an
invoice for borrowed goods sold: which lot, how many of it, and what it was
called then.

**`supplier_return.stock_lot_id`** — borrowed goods going back unsold.

**Downgrade** refuses while any receipt names its supplier: 0028 cannot say
whose goods they were.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0029_borrowed_goods"
down_revision: str | None = "0028_order_shipping"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.add_column("goods_receipt", sa.Column("supplier_id", uuid, nullable=True))
    op.create_foreign_key(
        "fk_goods_receipt_org_supplier",
        "goods_receipt",
        "supplier",
        ["organization_id", "supplier_id"],
        ["organization_id", "id"],
        ondelete="RESTRICT",
    )

    op.add_column("supplier_invoice", sa.Column("stock_lot_id", uuid, nullable=True))
    op.add_column("supplier_invoice", sa.Column("lot_quantity", sa.Integer(), nullable=True))
    op.add_column("supplier_invoice", sa.Column("lot_label", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_supplier_invoice_stock_lot_id_stock_lot",
        "supplier_invoice",
        "stock_lot",
        ["stock_lot_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "sold_names_its_lot",
        "supplier_invoice",
        "(stock_lot_id IS NULL) = (lot_quantity IS NULL) "
        "AND (stock_lot_id IS NULL) = (lot_label IS NULL)",
    )
    op.create_check_constraint(
        "lot_quantity_positive", "supplier_invoice", "lot_quantity IS NULL OR lot_quantity > 0"
    )
    op.create_index("ix_supplier_invoice_stock_lot_id", "supplier_invoice", ["stock_lot_id"])

    op.add_column("supplier_return", sa.Column("stock_lot_id", uuid, nullable=True))
    op.create_foreign_key(
        "fk_supplier_return_stock_lot_id_stock_lot",
        "supplier_return",
        "stock_lot",
        ["stock_lot_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_supplier_return_stock_lot_id", "supplier_return", ["stock_lot_id"])


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM goods_receipt WHERE supplier_id IS NOT NULL) THEN
                RAISE EXCEPTION
                    'Receipts name whose goods they were; 0028 cannot say so. '
                    'Keep this revision.';
            END IF;
        END $$;
        """
    )
    op.drop_index("ix_supplier_return_stock_lot_id", table_name="supplier_return")
    op.drop_constraint(
        "fk_supplier_return_stock_lot_id_stock_lot", "supplier_return", type_="foreignkey"
    )
    op.drop_column("supplier_return", "stock_lot_id")
    op.drop_index("ix_supplier_invoice_stock_lot_id", table_name="supplier_invoice")
    op.drop_constraint("lot_quantity_positive", "supplier_invoice", type_="check")
    op.drop_constraint("sold_names_its_lot", "supplier_invoice", type_="check")
    op.drop_constraint(
        "fk_supplier_invoice_stock_lot_id_stock_lot", "supplier_invoice", type_="foreignkey"
    )
    for column in ("lot_label", "lot_quantity", "stock_lot_id"):
        op.drop_column("supplier_invoice", column)
    op.drop_constraint("fk_goods_receipt_org_supplier", "goods_receipt", type_="foreignkey")
    op.drop_column("goods_receipt", "supplier_id")
