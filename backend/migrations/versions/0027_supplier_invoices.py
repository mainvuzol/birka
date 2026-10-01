"""What a store owes its suppliers. Owner decisions, 2026-10-01.

The owner decided (business-rules.md, "the store's purchases in parts") that
an invoice is recorded on its own — a supplier from the list, the sum on the
supplier's invoice, a note — and never with a delivery; that each invoice is
its own debt, paid in parts with no schedule, from nothing at once to the
whole sum; that goods returned to the supplier are set off against it for
the sum the supplier counted; that a payment, a set-off or the invoice itself
recorded by mistake is cancelled saying why; and that the owner writes off
what is left.

**`supplier_invoice`** — the sum on the invoice, never changed, and where it
stands (`OPEN`, `SETTLED`, `WRITTEN_OFF`, `CANCELLED`).

**`supplier_invoice_entry`** — its ledger: payments, set-offs and the
owner's write-off, each lowering what is owed. **`supplier_invoice_entry_
cancel`** and **`supplier_invoice_cancel`** — what was recorded by mistake.
All three are append-only, by the same trigger as the stock ledger.

**Permissions:** `supplier:debt` to every role that returns goods to a
supplier (`supplier:return`) — the owner's and managers', by default; and
`supplier:write_off` to every role that writes off a customer's debt
(`credit:write_off`) — the owner's.

**Downgrade** refuses while any invoice is recorded: what a store owes would
be lost, and 0026 cannot say so.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0027_supplier_invoices"
down_revision: str | None = "0026_supplier_returns"
branch_labels: str | None = None
depends_on: str | None = None

APPEND_ONLY = (
    "supplier_invoice_entry",
    "supplier_invoice_entry_cancel",
    "supplier_invoice_cancel",
)


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    now = sa.text("now()")

    op.create_table(
        "supplier_invoice",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("store_id", uuid, nullable=False),
        sa.Column("supplier_id", uuid, nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("currency_code", sa.String(length=3), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="OPEN"),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", uuid, nullable=False),
        sa.Column("command_id", uuid, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_supplier_invoice"),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_supplier_invoice_org_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "supplier_id"],
            ["supplier.organization_id", "supplier.id"],
            name="fk_supplier_invoice_org_supplier",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name="fk_supplier_invoice_created_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "organization_id", "command_id", name="uq_supplier_invoice_org_command"
        ),
        sa.CheckConstraint("amount > 0", name="amount_positive"),
        sa.CheckConstraint(
            "status IN ('OPEN', 'SETTLED', 'WRITTEN_OFF', 'CANCELLED')", name="status_known"
        ),
        sa.CheckConstraint("(status = 'OPEN') = (closed_at IS NULL)", name="closed_when_not_open"),
    )
    op.create_index(
        "ix_supplier_invoice_store_id_created_at", "supplier_invoice", ["store_id", "created_at"]
    )
    op.create_index("ix_supplier_invoice_supplier_id", "supplier_invoice", ["supplier_id"])

    op.create_table(
        "supplier_invoice_entry",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("invoice_id", uuid, nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("supplier_return_id", uuid, nullable=True),
        sa.Column("command_id", uuid, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("actor_user_id", uuid, nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("paid_at_store_id", uuid, nullable=True),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_supplier_invoice_entry"),
        sa.ForeignKeyConstraint(
            ["invoice_id"],
            ["supplier_invoice.id"],
            name="fk_supplier_invoice_entry_invoice_id_supplier_invoice",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["supplier_return_id"],
            ["supplier_return.id"],
            name="fk_supplier_invoice_entry_supplier_return_id_supplier_return",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["app_user.id"],
            name="fk_supplier_invoice_entry_actor_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "paid_at_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_supplier_invoice_entry_org_paid_at_store",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "organization_id", "command_id", name="uq_supplier_invoice_entry_org_command"
        ),
        sa.CheckConstraint("kind IN ('PAYMENT', 'SET_OFF', 'WRITE_OFF')", name="kind_known"),
        sa.CheckConstraint("amount > 0", name="amount_positive"),
        sa.CheckConstraint(
            "(kind = 'SET_OFF') = (supplier_return_id IS NOT NULL)", name="set_off_names_return"
        ),
        sa.CheckConstraint("(kind = 'WRITE_OFF') = (note IS NOT NULL)", name="write_off_says_why"),
        sa.CheckConstraint(
            "paid_at_store_id IS NULL OR kind = 'PAYMENT'", name="only_a_payment_is_made_elsewhere"
        ),
    )
    op.create_index(
        "ix_supplier_invoice_entry_invoice_id_created_at",
        "supplier_invoice_entry",
        ["invoice_id", "created_at"],
    )
    op.create_index(
        "ix_supplier_invoice_entry_supplier_return_id",
        "supplier_invoice_entry",
        ["supplier_return_id"],
    )

    op.create_table(
        "supplier_invoice_entry_cancel",
        sa.Column("id", uuid, nullable=False),
        sa.Column("entry_id", uuid, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", uuid, nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_supplier_invoice_entry_cancel"),
        sa.ForeignKeyConstraint(
            ["entry_id"],
            ["supplier_invoice_entry.id"],
            name="fk_supplier_invoice_entry_cancel_entry",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name="fk_supplier_invoice_entry_cancel_created_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("entry_id", name="uq_supplier_invoice_entry_cancel_entry_id"),
        sa.CheckConstraint("char_length(btrim(reason)) > 0", name="says_why"),
    )

    op.create_table(
        "supplier_invoice_cancel",
        sa.Column("id", uuid, nullable=False),
        sa.Column("invoice_id", uuid, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", uuid, nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_supplier_invoice_cancel"),
        sa.ForeignKeyConstraint(
            ["invoice_id"],
            ["supplier_invoice.id"],
            name="fk_supplier_invoice_cancel_invoice_id_supplier_invoice",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name="fk_supplier_invoice_cancel_created_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("invoice_id", name="uq_supplier_invoice_cancel_invoice_id"),
        sa.CheckConstraint("char_length(btrim(reason)) > 0", name="says_why"),
    )
    # Append-only, as the stock ledger is: the function has existed since 0002.
    for table in APPEND_ONLY:
        op.execute(
            f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION birka_reject_mutation();"
        )

    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT DISTINCT role_id, 'supplier:debt' FROM role_permission "
        "WHERE permission_code = 'supplier:return' "
        "ON CONFLICT DO NOTHING"
    )
    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT DISTINCT role_id, 'supplier:write_off' FROM role_permission "
        "WHERE permission_code = 'credit:write_off' "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM supplier_invoice) THEN
                RAISE EXCEPTION
                    'Invoices are recorded, and what the stores owe their suppliers '
                    'would be lost; 0026 cannot say so. Keep this revision.';
            END IF;
        END $$;
        """
    )
    op.execute(
        "DELETE FROM role_permission "
        "WHERE permission_code IN ('supplier:debt', 'supplier:write_off')"
    )
    for table in APPEND_ONLY:
        op.execute(f"DROP TRIGGER IF EXISTS {table}_append_only ON {table}")
    op.drop_table("supplier_invoice_cancel")
    op.drop_table("supplier_invoice_entry_cancel")
    op.drop_index(
        "ix_supplier_invoice_entry_supplier_return_id", table_name="supplier_invoice_entry"
    )
    op.drop_index(
        "ix_supplier_invoice_entry_invoice_id_created_at", table_name="supplier_invoice_entry"
    )
    op.drop_table("supplier_invoice_entry")
    op.drop_index("ix_supplier_invoice_supplier_id", table_name="supplier_invoice")
    op.drop_index("ix_supplier_invoice_store_id_created_at", table_name="supplier_invoice")
    op.drop_table("supplier_invoice")
