"""The mark «продано під час збою». Owner decisions, 2026-10-04 and 2026-10-07; ADR-0013.

The owner decided (business-rules.md, "the server is unreachable") that while
the server does not answer the shop sells on paper, and that a sale typed in
from paper later is an ordinary sale, dated the day it is typed, carrying the
mark «продано під час збою». The mark may name who sold, from the store's
people, and the hour on the paper, today or yesterday; both are optional.
It never moves the day in «Звіт» or the drawer's period: `sold_at` stays the
insert's own moment, and the period stays the trigger's (revision 0035).

**`sale.during_outage`** — the mark itself; false on every sale before this
revision and on every sale typed live. **`sale.outage_sold_by`** — who sold,
as the paper says; NULL when nobody was named. **`sale.outage_sold_at`** —
the paper's time, composed in the store's zone; NULL when none was written.
Who typed it needs no column: it is `seller_user_id`, as for every sale.
A CHECK keeps the two details off a sale without the mark.

**Never changed.** A wrong mark is permanent (owner decision, 2026-10-07):
a guard refuses any update of the three columns. A trigger of its own, so
`birka_guard_money_row` stays as 0035 shipped it, and `BEFORE UPDATE OF` the
three columns only: the answer written to every new sale after its insert
(`response_snapshot`) names none of them, so the hot path runs no second
plpgsql trigger (ADR-0013 §5.5, §11).

Adding a `NOT NULL DEFAULT false` column is metadata-only on PostgreSQL 11+:
`sale` is not rewritten. The CHECK is added plainly: the migration runs in
one transaction, where `ADD COLUMN` already holds the table's lock.

**Downgrade** refuses once any sale carries the mark: 0035 cannot hold it.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0036_outage_mark"
down_revision: str | None = "0035_cash_and_card"
branch_labels: str | None = None
depends_on: str | None = None

GUARD_OUTAGE_MARK = """
CREATE FUNCTION birka_guard_outage_mark() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.during_outage IS DISTINCT FROM OLD.during_outage
        OR NEW.outage_sold_by IS DISTINCT FROM OLD.outage_sold_by
        OR NEW.outage_sold_at IS DISTINCT FROM OLD.outage_sold_at
    THEN
        RAISE EXCEPTION 'The mark of a sale typed from paper is never changed (ADR-0013)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $$
"""


def upgrade() -> None:
    op.add_column(
        "sale",
        sa.Column("during_outage", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("sale", sa.Column("outage_sold_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        op.f("fk_sale_outage_sold_by_app_user"),
        "sale",
        "app_user",
        ["outage_sold_by"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.add_column("sale", sa.Column("outage_sold_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        "outage_details_need_the_mark",
        "sale",
        "during_outage OR (outage_sold_by IS NULL AND outage_sold_at IS NULL)",
    )

    op.execute(GUARD_OUTAGE_MARK)
    op.execute(
        "CREATE TRIGGER sale_outage_guard "
        "BEFORE UPDATE OF during_outage, outage_sold_by, outage_sold_at ON sale "
        "FOR EACH ROW EXECUTE FUNCTION birka_guard_outage_mark()"
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE
            marked bigint;
        BEGIN
            SELECT count(*) INTO marked FROM sale WHERE during_outage;
            IF marked > 0 THEN
                RAISE EXCEPTION
                    '0035 cannot hold the mark «продано під час збою»: % sales carry it. '
                    'Keep this revision.', marked;
            END IF;
        END $$;
        """
    )
    op.execute("DROP TRIGGER sale_outage_guard ON sale")
    op.execute("DROP FUNCTION birka_guard_outage_mark()")
    op.drop_constraint("outage_details_need_the_mark", "sale", type_="check")
    op.drop_column("sale", "outage_sold_at")
    op.drop_constraint(op.f("fk_sale_outage_sold_by_app_user"), "sale", type_="foreignkey")
    op.drop_column("sale", "outage_sold_by")
    op.drop_column("sale", "during_outage")
