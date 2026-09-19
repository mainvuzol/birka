"""Add the `MISSING_AT_SALE` movement reason.

M1-030. The owner answered the one open question on 2026-09-17: when a seller
reports that goods are not physically there, the sale proceeds for the quantity
that *is*. The shortfall the system believed in is removed by a negative
`ADJUSTMENT` carrying this reason.

It is deliberately not `LOST` and not `DAMAGED`. At the counter nobody knows
why the coat is missing — stolen, misfiled, already sold, or standing in the
other warehouse — so the reason records the observation and nothing more. Its
own code also makes the question "how often does the shelf disagree with the
app, and where?" answerable, which is the point of keeping `FOUND_DURING_SALE`
separate too.

Schema only: one enum value. No data is written, read or moved.

Revision ID: 0007_missing_at_sale
Revises: 0006_stock_rekey
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007_missing_at_sale"
down_revision: str | None = "0006_stock_rekey"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The order 0002 created, which `downgrade()` has to restore exactly: an enum's
# value order is part of its identity, and ORDER BY on the column depends on it.
REASONS_BEFORE = (
    "FOUND_DURING_SALE",
    "DAMAGED",
    "LOST",
    "STOCKTAKE",
    "SIZE_RECLASSIFICATION_IN",
    "SIZE_RECLASSIFICATION_OUT",
    "CORRECTION",
    "OTHER",
)


def upgrade() -> None:
    # After FOUND_DURING_SALE, because they are a pair and reports will read
    # better with them adjacent. PostgreSQL 12+ allows this inside a
    # transaction; the value simply cannot be *used* until it commits, and
    # nothing here uses it.
    op.execute("ALTER TYPE movement_reason ADD VALUE IF NOT EXISTS 'MISSING_AT_SALE'")


def downgrade() -> None:
    """Remove the value by rebuilding the type, refusing if anything uses it.

    PostgreSQL cannot drop an enum value, so the type is recreated without it
    and the column cast across. The refusal comes first and is the important
    half: rolling the schema back must never silently rewrite a ledger row into
    some other reason, and `stock_movement` is append-only precisely so that
    cannot happen quietly.
    """
    op.execute(
        """DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM stock_movement WHERE reason_code = 'MISSING_AT_SALE') THEN
            RAISE EXCEPTION
                'Cannot downgrade: movements already record MISSING_AT_SALE, and '
                'there is no other reason that means the same thing';
        END IF;
        END $$"""
    )
    values = ", ".join(f"'{reason}'" for reason in REASONS_BEFORE)
    op.execute("ALTER TYPE movement_reason RENAME TO movement_reason_old")
    op.execute(f"CREATE TYPE movement_reason AS ENUM ({values})")
    op.execute(
        "ALTER TABLE stock_movement ALTER COLUMN reason_code TYPE movement_reason "
        "USING reason_code::text::movement_reason"
    )
    op.execute("DROP TYPE movement_reason_old")
