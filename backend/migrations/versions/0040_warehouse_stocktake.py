"""A stocktake of a whole warehouse. Owner decisions, 2026-10-10; ADR-0022.

Until now a stocktake changed one balance at a time (`POST
/inventory/adjustments` with the reason `STOCKTAKE`), and nothing said which
corrections were one count of one warehouse, what it found, or what nobody
counted. The owner decided: the warehouse keeps selling while it is counted,
each position checked against its balance when it is saved; positions nobody
counted stay as they are; a manager or the owner counts, and each count
applies at once; the stocktake is one record, and the bot tells the owner its
sum, silently.

**`stocktake`** — one count of one warehouse: who started it and when, and
once it is finished, who finished it, when, and its sums — positions counted,
positions with stock nobody counted, the shortage and the surplus, in units
and in positions. One open per warehouse at a time (`uq_stocktake_open_location`).
A guard lets a row change once, from open to finished, and never deletes it.

**`stocktake_count`** — one count of one position: what the shelf held, what
the balance was when it was saved, the difference, and the stock adjustment
that applied it (none when they matched). Append-only, by the ledger's own
`birka_reject_mutation()`. A permanent `command_id`, as an adjustment's.

**`stocktake_message`** — the bot's message of one finished stocktake to one
owner, written before it is sent; its status moves, as `cash_message`'s.

**Downgrade** refuses once any stocktake exists: 0039 cannot say which
corrections were one. The corrections themselves are adjustments and stay.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0040_warehouse_stocktake"
down_revision: str | None = "0039_outage_mark_debts_returns"
branch_labels: str | None = None
depends_on: str | None = None

SUMS = (
    "counted_positions",
    "unchecked_positions",
    "shortage_units",
    "shortage_positions",
    "surplus_units",
    "surplus_positions",
)

GUARD_STOCKTAKE = """
CREATE FUNCTION birka_guard_stocktake() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'A stocktake is never deleted (ADR-0022)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.finished_at IS NOT NULL
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.location_id IS DISTINCT FROM OLD.location_id
        OR NEW.store_id IS DISTINCT FROM OLD.store_id
        OR NEW.started_by_user_id IS DISTINCT FROM OLD.started_by_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'A stocktake changes only once, when it is finished (ADR-0022)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $$
"""


def _fk(table: str, column: str, referred: str, ondelete: str = "RESTRICT"):
    return sa.ForeignKeyConstraint(
        [column],
        [f"{referred}.id"],
        name=f"fk_{table}_{column}_{referred}",
        ondelete=ondelete,
    )


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    now = sa.text("now()")

    op.create_table(
        "stocktake",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("location_id", uuid, nullable=False),
        sa.Column("store_id", uuid, nullable=False),
        sa.Column("started_by_user_id", uuid, nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_by_user_id", uuid, nullable=True),
        *(sa.Column(name, sa.Integer(), nullable=True) for name in SUMS),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_stocktake"),
        _fk("stocktake", "organization_id", "organization"),
        _fk("stocktake", "location_id", "stock_location"),
        _fk("stocktake", "store_id", "store"),
        _fk("stocktake", "started_by_user_id", "app_user"),
        _fk("stocktake", "finished_by_user_id", "app_user"),
        sa.CheckConstraint(
            "(finished_at IS NULL) = (finished_by_user_id IS NULL)"
            + "".join(f" AND (finished_at IS NULL) = ({name} IS NULL)" for name in SUMS),
            name="finished_has_its_sums",
        ),
        sa.CheckConstraint(
            " AND ".join(f"({name} IS NULL OR {name} >= 0)" for name in SUMS),
            name="sums_not_negative",
        ),
    )
    op.create_index(
        "uq_stocktake_open_location",
        "stocktake",
        ["location_id"],
        unique=True,
        postgresql_where=sa.text("finished_at IS NULL"),
    )
    op.create_index(
        "ix_stocktake_location_id_created_at", "stocktake", ["location_id", "created_at"]
    )

    op.create_table(
        "stocktake_count",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("stocktake_id", uuid, nullable=False),
        sa.Column("product_variant_id", uuid, nullable=False),
        sa.Column("size_id", uuid, nullable=False),
        sa.Column("counted_quantity", sa.Integer(), nullable=False),
        sa.Column("quantity_before", sa.Integer(), nullable=False),
        sa.Column("quantity_delta", sa.Integer(), nullable=False),
        sa.Column("adjustment_id", uuid, nullable=True),
        sa.Column("store_id", uuid, nullable=False),
        sa.Column("counted_by_user_id", uuid, nullable=False),
        sa.Column("command_id", uuid, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_stocktake_count"),
        _fk("stocktake_count", "organization_id", "organization"),
        _fk("stocktake_count", "stocktake_id", "stocktake"),
        _fk("stocktake_count", "product_variant_id", "product_variant"),
        _fk("stocktake_count", "size_id", "size"),
        _fk("stocktake_count", "adjustment_id", "stock_adjustment"),
        _fk("stocktake_count", "store_id", "store"),
        _fk("stocktake_count", "counted_by_user_id", "app_user"),
        sa.UniqueConstraint(
            "organization_id", "command_id", name="uq_stocktake_count_organization_id_command_id"
        ),
        sa.UniqueConstraint("adjustment_id", name="uq_stocktake_count_adjustment_id"),
        sa.CheckConstraint(
            "counted_quantity >= 0 AND quantity_before >= 0", name="quantities_not_negative"
        ),
        sa.CheckConstraint(
            "quantity_delta = counted_quantity - quantity_before", name="delta_is_the_difference"
        ),
        sa.CheckConstraint(
            "(quantity_delta = 0) = (adjustment_id IS NULL)", name="a_difference_is_adjusted"
        ),
    )
    op.create_index(
        "ix_stocktake_count_stocktake_id_position",
        "stocktake_count",
        ["stocktake_id", "product_variant_id", "size_id"],
    )

    op.create_table(
        "stocktake_message",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("stocktake_id", uuid, nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="PENDING"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=300), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_stocktake_message"),
        _fk("stocktake_message", "organization_id", "organization"),
        _fk("stocktake_message", "stocktake_id", "stocktake"),
        _fk("stocktake_message", "user_id", "app_user", ondelete="CASCADE"),
        sa.UniqueConstraint(
            "stocktake_id", "user_id", name="uq_stocktake_message_stocktake_id_user_id"
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'SENT', 'REFUSED', 'FAILED')", name="status_known"
        ),
        sa.CheckConstraint("(status = 'SENT') = (sent_at IS NOT NULL)", name="sent_has_time"),
        sa.CheckConstraint("attempts >= 0", name="attempts_not_negative"),
    )

    op.execute(GUARD_STOCKTAKE)
    op.execute(
        "CREATE TRIGGER stocktake_guard BEFORE UPDATE OR DELETE ON stocktake "
        "FOR EACH ROW EXECUTE FUNCTION birka_guard_stocktake()"
    )
    op.execute(
        "CREATE TRIGGER stocktake_count_append_only BEFORE UPDATE OR DELETE ON stocktake_count "
        "FOR EACH ROW EXECUTE FUNCTION birka_reject_mutation()"
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE
            taken bigint;
        BEGIN
            SELECT count(*) INTO taken FROM stocktake;
            IF taken > 0 THEN
                RAISE EXCEPTION
                    '0039 cannot hold a stocktake of a whole warehouse: % exist. '
                    'Keep this revision.', taken;
            END IF;
        END $$;
        """
    )
    op.execute("DROP TRIGGER stocktake_count_append_only ON stocktake_count")
    op.execute("DROP TRIGGER stocktake_guard ON stocktake")
    op.execute("DROP FUNCTION birka_guard_stocktake()")
    op.drop_table("stocktake_message")
    op.drop_index("ix_stocktake_count_stocktake_id_position", table_name="stocktake_count")
    op.drop_table("stocktake_count")
    op.drop_index("ix_stocktake_location_id_created_at", table_name="stocktake")
    op.drop_index("uq_stocktake_open_location", table_name="stocktake")
    op.drop_table("stocktake")
