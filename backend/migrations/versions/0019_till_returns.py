"""Returns at the till: intact or damaged, and each store's «Брак». M1-027.

The owner decided on 2026-10-01 (business-rules.md, "returns at the till"),
settling what 2026-09-15 §3 left to be designed:

- every returned unit is stated intact or damaged, and one sale line may come
  back partly each way;
- an intact unit goes back where it was sold from, as since 2026-09-17;
- a damaged unit goes to the store's own «Брак»: kept in the stock records,
  never sold from, until a manager decides its fate.

**`store_location_access.damaged_returns`** marks the one warehouse per store
that is its «Брак». The database holds that such a store may receive there
and never sell there, and that a store has at most one. Existing rows are
`false`: which warehouse, if any, is a store's «Брак» is set up explicitly,
never inferred from a name (the owner's rule of 2026-09-15).

**`refund_item.condition`** — `INTACT` or `DAMAGED`, only for goods that came
back. Existing rows stay NULL: those returns were taken before anyone was
asked, and guessing would record a fact nobody stated. A refund may now hold
one row per sale line *and condition*, which a unique constraint holds, with
NULLs not distinct.

**Downgrade** drops both columns and the constraint. It refuses while any
refund holds a sale line twice, which the constraint `0018` had not allowed,
rather than losing one of the two rows' meaning. A damaged unit's movement
into «Брак» is ledger history, and is not touched either way.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0019_till_returns"
down_revision: str | None = "0018_backup_alerts"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Check constraint names are short: the naming convention on the metadata
    # makes them `ck_<table>_<name>`, as in the models.
    op.add_column(
        "store_location_access",
        sa.Column("damaged_returns", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_check_constraint(
        "damaged_returns_are_not_sold",
        "store_location_access",
        "NOT damaged_returns OR (can_receive AND NOT can_sell)",
    )
    op.create_index(
        "uq_store_location_access_damaged_returns",
        "store_location_access",
        ["store_id"],
        unique=True,
        postgresql_where=sa.text("damaged_returns"),
    )

    op.add_column("refund_item", sa.Column("condition", sa.String(length=10), nullable=True))
    op.create_check_constraint(
        "condition_only_for_goods_back",
        "refund_item",
        "condition IS NULL OR (restock AND condition IN ('INTACT', 'DAMAGED'))",
    )
    op.create_unique_constraint(
        "uq_refund_item_refund_sale_item_condition",
        "refund_item",
        ["refund_id", "sale_item_id", "condition"],
        postgresql_nulls_not_distinct=True,
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM refund_item
                GROUP BY refund_id, sale_item_id
                HAVING count(*) > 1
            ) THEN
                RAISE EXCEPTION
                    'A refund returns a sale line in parts; 0018 cannot hold that. '
                    'Keep this revision.';
            END IF;
        END $$;
        """
    )
    op.drop_constraint("uq_refund_item_refund_sale_item_condition", "refund_item", type_="unique")
    op.drop_constraint(
        op.f("ck_refund_item_condition_only_for_goods_back"), "refund_item", type_="check"
    )
    op.drop_column("refund_item", "condition")
    op.drop_index("uq_store_location_access_damaged_returns", table_name="store_location_access")
    op.drop_constraint(
        op.f("ck_store_location_access_damaged_returns_are_not_sold"),
        "store_location_access",
        type_="check",
    )
    op.drop_column("store_location_access", "damaged_returns")
