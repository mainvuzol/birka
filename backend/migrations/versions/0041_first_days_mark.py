"""«З паперу»: the first days' paper, a mark of its own. Owner decisions, 2026-10-15 and 2026-10-16.

While a warehouse waits for its opening list, the shop sells on paper, and
the sales are typed in once the list is approved (2026-09-29, Q2). The owner
gave them a mark of their own, «з паперу», with no word of an outage (В2,
2026-10-15): the mark «продано під час збою» (revision 0036) would say an
outage that never was. On 2026-10-16 the owner put it on the returns and
debt payments of those days too, as the outage mark is (revision 0039).

**`outage_first_days`** on `sale`, `refund` and `credit_entry` — the marked
row is the first days' paper, not an outage's. False on every row before
this revision, on every row typed live and on every outage's. A CHECK keeps
it off a row without the mark. Its money goes into the drawer as every
sale's does: nothing about the drawer, the day in «Звіт» or `sold_at`
changes.

**Never changed.** A wrong mark is permanent (owner decision, 2026-10-07).
On `sale` and `refund` a guard of its own refuses any update of the column,
`BEFORE UPDATE OF` it only, so the answer written to every new row after its
insert runs no new trigger, and the outage marks' guards (revisions 0036 and
0039) stay as they shipped. On `credit_entry` the ledger's guard (revision
0038) compares every column but `note`, this one included.

Adding a `NOT NULL DEFAULT false` column is metadata-only on PostgreSQL 11+:
no table is rewritten, and no row trigger fires.

**Downgrade** refuses once any row carries it: 0040 cannot hold it.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0041_first_days_mark"
down_revision: str | None = "0040_warehouse_stocktake"
branch_labels: str | None = None
depends_on: str | None = None

MARKED = ("sale", "refund", "credit_entry")

GUARD_FIRST_DAYS = """
CREATE FUNCTION birka_guard_first_days_mark() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.outage_first_days IS DISTINCT FROM OLD.outage_first_days THEN
        RAISE EXCEPTION 'The mark of a % typed from paper is never changed (ADR-0013)',
            TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $$
"""


def upgrade() -> None:
    for table in MARKED:
        op.add_column(
            table,
            sa.Column("outage_first_days", sa.Boolean(), nullable=False, server_default="false"),
        )
        op.create_check_constraint(
            "first_days_need_the_mark", table, "NOT outage_first_days OR during_outage"
        )
    op.execute(GUARD_FIRST_DAYS)
    for table in ("sale", "refund"):
        op.execute(
            f"CREATE TRIGGER {table}_first_days_guard "
            f"BEFORE UPDATE OF outage_first_days ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION birka_guard_first_days_mark()"
        )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE
            marked bigint;
        BEGIN
            SELECT (SELECT count(*) FROM sale WHERE outage_first_days)
                 + (SELECT count(*) FROM refund WHERE outage_first_days)
                 + (SELECT count(*) FROM credit_entry WHERE outage_first_days)
            INTO marked;
            IF marked > 0 THEN
                RAISE EXCEPTION
                    '0040 cannot hold the mark «з паперу»: % rows carry it. '
                    'Keep this revision.', marked;
            END IF;
        END $$;
        """
    )
    for table in ("refund", "sale"):
        op.execute(f"DROP TRIGGER {table}_first_days_guard ON {table}")
    op.execute("DROP FUNCTION birka_guard_first_days_mark()")
    for table in reversed(MARKED):
        op.drop_constraint("first_days_need_the_mark", table, type_="check")
        op.drop_column(table, "outage_first_days")
