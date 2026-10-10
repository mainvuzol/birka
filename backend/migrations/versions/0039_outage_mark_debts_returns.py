"""The mark «під час збою» on returns and debt payments. Owner decision, 2026-10-10; ADR-0021.

The owner put on returns and debt payments typed from paper the mark a sale
typed from paper carries (revision 0036, ADR-0013 §5): who took it and at
what hour, as the paper says, both optional. Like a sale's, it never moves
the day in «Звіт» or the drawer's period: those stay the insert's own, as
revision 0035's triggers stamp them.

**`refund.during_outage`**, **`credit_entry.during_outage`** — the mark
itself; false on every row before this revision and on every one typed
live. **`outage_taken_by`** — who took the return or the payment, as the
paper says; NULL when nobody was named. **`outage_taken_at`** — the paper's
time, composed in the zone of the store that took it; NULL when none was
written. Who typed it needs no column: it is `actor_user_id`. A CHECK keeps
the two details off a row without the mark, and on the debt's ledger only a
payment is marked: a return's entry is its refund's, and a write-off is the
owner's, never typed from paper.

**Never changed.** A wrong mark is permanent, as a sale's (owner decision,
2026-10-07). On `refund` a guard refuses any update of the three columns,
`BEFORE UPDATE OF` them only: the answer written to every new refund after
its insert (`response_snapshot`) names none of them. On `credit_entry` the
ledger's own guard (revision 0038) already refuses every change but a
write-off's reason being erased, these columns included.

Adding a `NOT NULL DEFAULT false` column is metadata-only on PostgreSQL 11+:
neither table is rewritten, and no row trigger fires.

**Downgrade** refuses once any return or payment carries the mark: 0038
cannot hold it.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0039_outage_mark_debts_returns"
down_revision: str | None = "0038_customer_erasure"
branch_labels: str | None = None
depends_on: str | None = None

GUARD_REFUND_MARK = """
CREATE FUNCTION birka_guard_refund_outage_mark() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.during_outage IS DISTINCT FROM OLD.during_outage
        OR NEW.outage_taken_by IS DISTINCT FROM OLD.outage_taken_by
        OR NEW.outage_taken_at IS DISTINCT FROM OLD.outage_taken_at
    THEN
        RAISE EXCEPTION 'The mark of a return typed from paper is never changed (ADR-0021)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $$
"""


def _mark(table: str) -> None:
    op.add_column(
        table,
        sa.Column("during_outage", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(table, sa.Column("outage_taken_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        op.f(f"fk_{table}_outage_taken_by_app_user"),
        table,
        "app_user",
        ["outage_taken_by"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.add_column(table, sa.Column("outage_taken_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        "outage_details_need_the_mark",
        table,
        "during_outage OR (outage_taken_by IS NULL AND outage_taken_at IS NULL)",
    )


def _unmark(table: str) -> None:
    op.drop_constraint("outage_details_need_the_mark", table, type_="check")
    op.drop_column(table, "outage_taken_at")
    op.drop_constraint(op.f(f"fk_{table}_outage_taken_by_app_user"), table, type_="foreignkey")
    op.drop_column(table, "outage_taken_by")
    op.drop_column(table, "during_outage")


def upgrade() -> None:
    _mark("refund")
    op.execute(GUARD_REFUND_MARK)
    op.execute(
        "CREATE TRIGGER refund_outage_guard "
        "BEFORE UPDATE OF during_outage, outage_taken_by, outage_taken_at ON refund "
        "FOR EACH ROW EXECUTE FUNCTION birka_guard_refund_outage_mark()"
    )
    _mark("credit_entry")
    op.create_check_constraint(
        "only_a_payment_is_marked", "credit_entry", "NOT during_outage OR kind = 'PAYMENT'"
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE
            returns bigint;
            payments bigint;
        BEGIN
            SELECT count(*) INTO returns FROM refund WHERE during_outage;
            SELECT count(*) INTO payments FROM credit_entry WHERE during_outage;
            IF returns + payments > 0 THEN
                RAISE EXCEPTION
                    '0038 cannot hold the mark «під час збою» on returns and payments: '
                    '% returns and % payments carry it. Keep this revision.', returns, payments;
            END IF;
        END $$;
        """
    )
    op.drop_constraint("only_a_payment_is_marked", "credit_entry", type_="check")
    _unmark("credit_entry")
    op.execute("DROP TRIGGER refund_outage_guard ON refund")
    op.execute("DROP FUNCTION birka_guard_refund_outage_mark()")
    _unmark("refund")
