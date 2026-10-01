"""Returns at another store. Owner decisions, 2026-10-01.

The owner decided (business-rules.md, "returns at another store") that any
store of the network may take back goods another of its stores sold, and that
the store taking them back is the one that hands the money back.

**`refund.taken_at_store_id`** — the store that took the return and paid it
out. `refund.store_id` stays the store that sold, which every earlier reading
of a refund means. Existing rows are backfilled with the store that sold:
until now a return could be taken nowhere else, so that is what happened.

**Downgrade** refuses while any return was taken at another store than the
one that sold: dropping the column would make it read as taken where the sale
was, and the money as paid out by a store that never paid it.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0024_returns_elsewhere"
down_revision: str | None = "0023_customer_credit"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "refund",
        sa.Column("taken_at_store_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute("UPDATE refund SET taken_at_store_id = store_id")
    op.alter_column("refund", "taken_at_store_id", nullable=False)
    op.create_foreign_key(
        op.f("fk_refund_taken_at_store_id_store"),
        "refund",
        "store",
        ["taken_at_store_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_refund_taken_at_store", "refund", ["taken_at_store_id"])


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM refund WHERE taken_at_store_id <> store_id) THEN
                RAISE EXCEPTION
                    'A return was taken at another store than the one that sold; '
                    '0023 cannot say so. Keep this revision.';
            END IF;
        END $$;
        """
    )
    op.drop_index("ix_refund_taken_at_store", table_name="refund")
    op.drop_constraint(op.f("fk_refund_taken_at_store_id_store"), "refund", type_="foreignkey")
    op.drop_column("refund", "taken_at_store_id")
