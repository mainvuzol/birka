"""A sale paid in parts: what the customer owes. Owner decisions, 2026-10-01.

The owner decided (business-rules.md, "paying in parts") that a customer may
take the goods at once and pay in parts: something above nothing now, the
rest when they can, in the store that sold. Returned goods first reduce what
is owed; the owner may write off a debt with a reason.

**`customer_credit`** — one row per such sale: the customer's name and phone,
the agreed amount (the sale's total) and whether anything is still owed.
Bound to its organization compositely, as every newer table is.

**`credit_entry`** — its ledger: payments, returns and write-offs, each
lowering what is owed. Append-only, by the same trigger as the stock ledger:
what is owed is only ever the agreed amount less these rows, so no edit can
rewrite a debt.

**Permissions:** `sale:credit` to every role that sells (`sale:create`), and
`credit:write_off` to every role that manages people (`user:manage`) — the
owner's, by default.

**Downgrade** refuses while any credit exists: those sales' money would be
left unexplained, their totals reading as paid in full.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023_customer_credit"
down_revision: str | None = "0022_shelf_shortage"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    now = sa.text("now()")
    op.create_table(
        "customer_credit",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("store_id", uuid, nullable=False),
        sa.Column("sale_id", uuid, nullable=False),
        sa.Column("customer_name", sa.String(length=200), nullable=False),
        sa.Column("customer_phone", sa.String(length=40), nullable=False),
        sa.Column("phone_digits", sa.String(length=20), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency_code", sa.String(length=3), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="OPEN"),
        sa.Column("opened_by_user_id", uuid, nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_customer_credit"),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_customer_credit_org_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sale_id"], ["sale.id"], name="fk_customer_credit_sale_id_sale", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["opened_by_user_id"],
            ["app_user.id"],
            name="fk_customer_credit_opened_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("sale_id", name="uq_customer_credit_sale_id"),
        sa.CheckConstraint("amount > 0", name="amount_positive"),
        sa.CheckConstraint("status IN ('OPEN', 'SETTLED', 'WRITTEN_OFF')", name="status_known"),
        sa.CheckConstraint("(status = 'OPEN') = (closed_at IS NULL)", name="closed_when_not_open"),
    )
    op.create_index("ix_customer_credit_store_id_status", "customer_credit", ["store_id", "status"])
    op.create_index(
        "ix_customer_credit_organization_id_phone_digits",
        "customer_credit",
        ["organization_id", "phone_digits"],
    )

    op.create_table(
        "credit_entry",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("credit_id", uuid, nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("cash_back", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("refund_id", uuid, nullable=True),
        sa.Column("command_id", uuid, nullable=True),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("actor_user_id", uuid, nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_credit_entry"),
        sa.ForeignKeyConstraint(
            ["credit_id"],
            ["customer_credit.id"],
            name="fk_credit_entry_credit_id_customer_credit",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["refund_id"],
            ["refund.id"],
            name="fk_credit_entry_refund_id_refund",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["app_user.id"],
            name="fk_credit_entry_actor_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("organization_id", "command_id", name="uq_credit_entry_org_command"),
        sa.UniqueConstraint("refund_id", name="uq_credit_entry_refund_id"),
        sa.CheckConstraint("kind IN ('PAYMENT', 'RETURN', 'WRITE_OFF')", name="kind_known"),
        sa.CheckConstraint("amount >= 0 AND cash_back >= 0", name="amounts_not_negative"),
        sa.CheckConstraint("kind = 'RETURN' OR amount > 0", name="payment_lowers_the_debt"),
        sa.CheckConstraint("kind = 'RETURN' OR cash_back = 0", name="only_a_return_pays_back"),
        sa.CheckConstraint(
            "(kind = 'RETURN') = (refund_id IS NOT NULL)", name="return_names_refund"
        ),
        sa.CheckConstraint(
            "(kind = 'RETURN') = (command_id IS NULL AND command_fingerprint IS NULL)",
            name="command_names_payment",
        ),
        sa.CheckConstraint("(kind = 'WRITE_OFF') = (note IS NOT NULL)", name="write_off_says_why"),
    )
    op.create_index(
        "ix_credit_entry_credit_id_created_at", "credit_entry", ["credit_id", "created_at"]
    )
    # Append-only, as the stock ledger is (invariants I10/I11): the function
    # has existed since 0002.
    op.execute(
        "CREATE TRIGGER credit_entry_append_only BEFORE UPDATE OR DELETE ON credit_entry "
        "FOR EACH ROW EXECUTE FUNCTION birka_reject_mutation();"
    )

    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT DISTINCT role_id, 'sale:credit' FROM role_permission "
        "WHERE permission_code = 'sale:create' "
        "ON CONFLICT DO NOTHING"
    )
    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT DISTINCT role_id, 'credit:write_off' FROM role_permission "
        "WHERE permission_code = 'user:manage' "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM customer_credit) THEN
                RAISE EXCEPTION
                    'A sale paid in parts is recorded; 0022 cannot say what is owed on it. '
                    'Keep this revision.';
            END IF;
        END $$;
        """
    )
    op.execute(
        "DELETE FROM role_permission WHERE permission_code IN ('sale:credit', 'credit:write_off')"
    )
    op.execute("DROP TRIGGER IF EXISTS credit_entry_append_only ON credit_entry")
    op.drop_index("ix_credit_entry_credit_id_created_at", table_name="credit_entry")
    op.drop_table("credit_entry")
    op.drop_index("ix_customer_credit_organization_id_phone_digits", table_name="customer_credit")
    op.drop_index("ix_customer_credit_store_id_status", table_name="customer_credit")
    op.drop_table("customer_credit")
