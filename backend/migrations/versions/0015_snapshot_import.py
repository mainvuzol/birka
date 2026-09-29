"""Legacy snapshot import: who acts, a safe retry, several sizes per line, a frozen record. M1-023.

`inventory_snapshot` and `inventory_snapshot_row` have existed since `0002`
and nothing has ever written them. M1-023 is their first writer, which makes
this the cheap moment to reshape them (ADR-0005).

**1. The list learns who is acting and what was asked.**

- `acting_store_id`: the store whose authority imports, reviews and approves
  the list. It is bound to the organization compositely, like every stock
  table (ADR-0004 §2.2), and is not named `store_id`: ADR-0004 retired that
  name on this table.
- `created_by_user_id`.
- `command_id`, unique within the organization, and `command_fingerprint`:
  the import's permanent name and retry proof, as for a sale or a transfer
  (ADR-0003). A list that predates them takes its own id as its name.
- `review_revision`: bumped by every review change, so an approval names
  exactly what it approved.
- The decision columns.

**2. A line may resolve to several sizes, on a stated basis.** `0002` gave each
row exactly one `(resolved_variant_id, resolved_size_id)`, but a legacy line
very often lists several sizes of one model. The answer moves to
`inventory_snapshot_allocation` — one row per `(variant, size, quantity)` a
person stated — with the row's `quantity_basis` saying where the numbers came
from. The row's `quantity_total` / `quantity_state` become what the source
line itself said.

**3. An opening balance is only ever the answer to a list (invariant I17).**

- `stock_movement`: `OPENING_BALANCE` must name the list and the lot it came
  from (CHECK), and that lot must be an opening lot of that very list, at the
  movement's own organization and stock key (trigger
  `opening_balance_traces_to_its_list`; `stock_movement` is append-only, so
  checking the insert is enough).
- `stock_lot`: an `OPENING_BALANCE` lot must name its list, and that link
  becomes `RESTRICT`, so a list whose goods became stock cannot be deleted
  out from under them.

**4. A decided list is frozen.** Trigger `inventory_snapshot_is_final` refuses
any change to an applied or rejected list, its rows or its allocations. That
includes deleting one, and moving a row or an allocation into one. The list is
read under a share lock, so a decision cannot commit between the check and
the write. Like the ledger's append-only triggers (`0002`), it guards rows,
not `TRUNCATE`.

**Both directions refuse rather than guess.**

- *Upgrade* refuses while any list or line already carries a decision. No code
  before M1-023 could have made one, so such a row is foreign and needs a
  person. It refuses a waiting line the new CHECKs could not hold, for the
  same reason. It also refuses while an `OPENING_BALANCE` lot or movement
  names no list; a receipt could label a lot that way before this revision.
- *Downgrade* refuses while any decision exists. `0002`'s single-resolution
  shape cannot hold allocations or a basis, and dropping them would erase
  the record of an opening balance.

The CHECKs below may therefore be exact, not merely one-directional.

Adding the CHECKs to `stock_lot` and `stock_movement` scans both tables under
an exclusive lock. That is brief at two shops' scale, but it is a maintenance
window, not a trading-hours deploy.

Revision ID: 0015_snapshot_import
Revises: 0014_alias_feedback_identity
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015_snapshot_import"
down_revision: str | None = "0014_alias_feedback_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
BASIS = postgresql.ENUM(name="snapshot_quantity_basis", create_type=False)

DECISIONS_EXIST = (
    "EXISTS (SELECT 1 FROM inventory_snapshot "
    "WHERE status IN ('APPROVED', 'APPLIED', 'REJECTED')) "
    "OR EXISTS (SELECT 1 FROM inventory_snapshot_row WHERE status IN ('RESOLVED', 'SKIPPED'))"
)

FINAL = """
CREATE FUNCTION inventory_snapshot_is_final() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    lists uuid[];
    decided snapshot_status;
BEGIN
    IF TG_TABLE_NAME = 'inventory_snapshot' THEN
        IF OLD.status IN ('APPLIED', 'REJECTED') THEN
            decided := OLD.status;
        END IF;
    ELSE
        -- The list before the change and the list after it: moving a row or
        -- an allocation into a decided list changes that list too.
        IF TG_TABLE_NAME = 'inventory_snapshot_row' THEN
            lists := ARRAY[
                CASE WHEN TG_OP <> 'INSERT' THEN OLD.inventory_snapshot_id END,
                CASE WHEN TG_OP <> 'DELETE' THEN NEW.inventory_snapshot_id END];
        ELSE
            SELECT array_agg(r.inventory_snapshot_id) INTO lists
            FROM inventory_snapshot_row r
            WHERE r.id IN (
                CASE WHEN TG_OP <> 'INSERT' THEN OLD.snapshot_row_id END,
                CASE WHEN TG_OP <> 'DELETE' THEN NEW.snapshot_row_id END);
        END IF;
        -- Share-locked, so a decision cannot commit between this check and the
        -- write it guards. The service already holds each list FOR UPDATE.
        FOR decided IN
            SELECT status FROM inventory_snapshot WHERE id = ANY (lists) ORDER BY id FOR SHARE
        LOOP
            EXIT WHEN decided IN ('APPLIED', 'REJECTED');
        END LOOP;
    END IF;
    IF decided IN ('APPLIED', 'REJECTED') THEN
        RAISE EXCEPTION 'stock list is % and can no longer change (%)', decided, TG_TABLE_NAME
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END $$
"""

# Invariant I17 in the database: an opening balance comes from an opening lot of
# the very list it names, at the same organization and stock key. The CHECK
# `opening_balance_names_its_list` states the shape; this states the link.
TRACED = """
CREATE FUNCTION opening_balance_traces_to_its_list() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM stock_lot l
        WHERE l.id = NEW.stock_lot_id
          AND l.organization_id = NEW.organization_id
          AND l.acquisition_type = 'OPENING_BALANCE'
          AND l.inventory_snapshot_id = NEW.reference_id
          AND l.location_id = NEW.location_id
          AND l.product_variant_id = NEW.product_variant_id
          AND l.size_id = NEW.size_id
    ) THEN
        RAISE EXCEPTION
            'an opening balance must come from an opening lot of the stock list it names (I17)'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END $$
"""

FROZEN_TABLES = {
    "inventory_snapshot": "BEFORE UPDATE OR DELETE",
    "inventory_snapshot_row": "BEFORE INSERT OR UPDATE OR DELETE",
    "inventory_snapshot_allocation": "BEFORE INSERT OR UPDATE OR DELETE",
}


def _refuse_if(condition: str, message: str) -> None:
    op.execute(f"DO $$ BEGIN IF {condition} THEN RAISE EXCEPTION '{message}'; END IF; END $$")


def upgrade() -> None:
    # Nothing writes the snapshot tables before M1-023, but a hand-run script
    # could; the ledger tables take their CHECKs under the same lock.
    op.execute(
        "LOCK TABLE inventory_snapshot, inventory_snapshot_row, stock_lot, stock_movement "
        "IN ACCESS EXCLUSIVE MODE"
    )
    _refuse_if(
        DECISIONS_EXIST,
        "Cannot apply 0015_snapshot_import: a stock list or line already carries a decision "
        "that no code before M1-023 could have made. Review it explicitly; nothing was changed.",
    )
    _refuse_if(
        "EXISTS (SELECT 1 FROM stock_lot "
        "WHERE acquisition_type = 'OPENING_BALANCE' AND inventory_snapshot_id IS NULL)",
        "Cannot apply 0015_snapshot_import: stock lots are labelled OPENING_BALANCE without the "
        "stock list they came from (a receipt could label them so before M1-023). Relabel them "
        "explicitly first; nothing was changed.",
    )
    _refuse_if(
        "EXISTS (SELECT 1 FROM stock_movement WHERE movement_type = 'OPENING_BALANCE')",
        "Cannot apply 0015_snapshot_import: OPENING_BALANCE movements exist, and no code before "
        "M1-023 writes them. Review them explicitly; nothing was changed.",
    )
    # A waiting line in a shape the CHECKs below cannot hold was written by
    # hand, not by code: refused by name rather than by a raw constraint error.
    _refuse_if(
        "EXISTS (SELECT 1 FROM inventory_snapshot_row "
        "WHERE (quantity_state = 'KNOWN' AND quantity_total IS NULL) "
        "OR (quantity_state = 'UNKNOWN_QUANTITY' AND quantity_total IS NOT NULL)) "
        "OR EXISTS (SELECT 1 FROM inventory_snapshot_row "
        "GROUP BY raw_input_id HAVING count(*) > 1)",
        "Cannot apply 0015_snapshot_import: stock list lines exist that no code before M1-023 "
        "wrote (a count state without its total, or one line of evidence in two rows). Review "
        "them explicitly; nothing was changed.",
    )

    # --- inventory_snapshot ---------------------------------------------------
    op.add_column("inventory_snapshot", sa.Column("command_id", UUID, nullable=True))
    op.execute("UPDATE inventory_snapshot SET command_id = id")
    op.alter_column("inventory_snapshot", "command_id", nullable=False)
    op.create_unique_constraint(
        "uq_inventory_snapshot_org_command", "inventory_snapshot", ["organization_id", "command_id"]
    )
    op.add_column("inventory_snapshot", sa.Column("acting_store_id", UUID, nullable=True))
    op.create_foreign_key(
        "fk_inventory_snapshot_org_acting_store",
        "inventory_snapshot",
        "store",
        ["organization_id", "acting_store_id"],
        ["organization_id", "id"],
        ondelete="RESTRICT",
    )
    op.add_column("inventory_snapshot", sa.Column("created_by_user_id", UUID, nullable=True))
    op.create_foreign_key(
        "fk_inventory_snapshot_created_by_user_id_app_user",
        "inventory_snapshot",
        "app_user",
        ["created_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "inventory_snapshot", sa.Column("command_fingerprint", sa.String(64), nullable=True)
    )
    op.add_column(
        "inventory_snapshot",
        sa.Column("review_revision", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.add_column(
        "inventory_snapshot", sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("inventory_snapshot", sa.Column("rejected_by_user_id", UUID, nullable=True))
    op.create_foreign_key(
        "fk_inventory_snapshot_rejected_by_user_id_app_user",
        "inventory_snapshot",
        "app_user",
        ["rejected_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("inventory_snapshot", sa.Column("rejection_reason", sa.Text(), nullable=True))
    # Short names: the metadata's naming convention adds the `ck_<table>_`
    # prefix to check constraints, exactly as `0006` relies on.
    op.create_check_constraint(
        "review_revision_not_negative", "inventory_snapshot", "review_revision >= 0"
    )
    op.create_check_constraint(
        "rejection_has_reason",
        "inventory_snapshot",
        "(status = 'REJECTED') = (rejection_reason IS NOT NULL)",
    )
    op.create_check_constraint(
        "decision_has_time",
        "inventory_snapshot",
        "(status IN ('APPLIED', 'REJECTED')) = (decided_at IS NOT NULL)",
    )
    op.create_check_constraint(
        "applied_names_place_and_store",
        "inventory_snapshot",
        "status <> 'APPLIED' OR (location_id IS NOT NULL AND acting_store_id IS NOT NULL)",
    )
    op.create_index(
        "ix_inventory_snapshot_acting_store_created",
        "inventory_snapshot",
        ["acting_store_id", "created_at"],
    )

    # --- inventory_snapshot_row -------------------------------------------------
    op.execute(
        "CREATE TYPE snapshot_quantity_basis AS ENUM "
        "('STATED', 'LINE_IMPLIES_ONE', 'RECOUNTED', 'OWNER_KNOWLEDGE')"
    )
    op.add_column("inventory_snapshot_row", sa.Column("quantity_basis", BASIS, nullable=True))
    op.add_column("inventory_snapshot_row", sa.Column("resolution_note", sa.Text(), nullable=True))
    op.add_column("inventory_snapshot_row", sa.Column("resolved_by_user_id", UUID, nullable=True))
    op.create_foreign_key(
        "fk_inventory_snapshot_row_resolved_by_user_id_app_user",
        "inventory_snapshot_row",
        "app_user",
        ["resolved_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "inventory_snapshot_row",
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    # No row is resolved (refused above), so the single-resolution columns hold
    # no decision and go with their CHECK.
    op.drop_constraint("resolved_requires_complete_row", "inventory_snapshot_row", type_="check")
    op.drop_constraint(
        "fk_inventory_snapshot_row_resolved_variant_id_product_variant",
        "inventory_snapshot_row",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_inventory_snapshot_row_resolved_size_id_size",
        "inventory_snapshot_row",
        type_="foreignkey",
    )
    op.drop_column("inventory_snapshot_row", "resolved_size_id")
    op.drop_column("inventory_snapshot_row", "resolved_variant_id")
    for name, condition in (
        ("known_quantity_has_total", "quantity_state <> 'KNOWN' OR quantity_total IS NOT NULL"),
        (
            "unknown_quantity_has_no_total",
            "quantity_state <> 'UNKNOWN_QUANTITY' OR quantity_total IS NULL",
        ),
        ("basis_exactly_when_resolved", "(status = 'RESOLVED') = (quantity_basis IS NOT NULL)"),
        ("skip_has_reason", "status <> 'SKIPPED' OR resolution_note IS NOT NULL"),
        (
            "verdict_has_time",
            "(status IN ('RESOLVED', 'SKIPPED')) = (resolved_at IS NOT NULL)",
        ),
    ):
        op.create_check_constraint(name, "inventory_snapshot_row", condition)
    # One line of evidence belongs to one row. The service creates a RawInput
    # per line; this makes a second row pointing at it unrepresentable.
    op.create_unique_constraint(
        "uq_inventory_snapshot_row_raw_input_id", "inventory_snapshot_row", ["raw_input_id"]
    )

    # --- inventory_snapshot_allocation ------------------------------------------
    op.create_table(
        "inventory_snapshot_allocation",
        sa.Column("id", UUID, nullable=False),
        sa.Column("snapshot_row_id", UUID, nullable=False),
        sa.Column("product_variant_id", UUID, nullable=False),
        sa.Column("size_id", UUID, nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("stock_lot_id", UUID, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("quantity > 0", name="quantity_positive"),
        sa.ForeignKeyConstraint(
            ["snapshot_row_id"],
            ["inventory_snapshot_row.id"],
            name="fk_inventory_snapshot_allocation_row",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["product_variant_id"],
            ["product_variant.id"],
            name="fk_inventory_snapshot_allocation_variant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["size_id"],
            ["size.id"],
            name="fk_inventory_snapshot_allocation_size",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["stock_lot_id"],
            ["stock_lot.id"],
            name="fk_inventory_snapshot_allocation_stock_lot",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_inventory_snapshot_allocation"),
        sa.UniqueConstraint(
            "snapshot_row_id",
            "product_variant_id",
            "size_id",
            name="uq_inventory_snapshot_allocation_row_key",
        ),
        sa.UniqueConstraint("stock_lot_id", name="uq_inventory_snapshot_allocation_stock_lot_id"),
    )

    # --- the ledger: an opening balance is only ever the answer to a list ----
    op.drop_constraint(
        "fk_stock_lot_inventory_snapshot_id_inventory_snapshot", "stock_lot", type_="foreignkey"
    )
    op.create_foreign_key(
        "fk_stock_lot_inventory_snapshot_id_inventory_snapshot",
        "stock_lot",
        "inventory_snapshot",
        ["inventory_snapshot_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "opening_lot_names_its_list",
        "stock_lot",
        "acquisition_type <> 'OPENING_BALANCE' OR inventory_snapshot_id IS NOT NULL",
    )
    op.create_check_constraint(
        "opening_balance_names_its_list",
        "stock_movement",
        "movement_type <> 'OPENING_BALANCE' OR ("
        "reference_type = 'inventory_snapshot'"
        " AND reference_id IS NOT NULL AND stock_lot_id IS NOT NULL)",
    )
    op.execute(TRACED)
    op.execute(
        "CREATE TRIGGER opening_balance_traces_to_its_list BEFORE INSERT ON stock_movement "
        "FOR EACH ROW WHEN (NEW.movement_type = 'OPENING_BALANCE') "
        "EXECUTE FUNCTION opening_balance_traces_to_its_list()"
    )

    # --- a decided list is frozen ------------------------------------------------
    op.execute(FINAL)
    for table, timing in FROZEN_TABLES.items():
        op.execute(
            f"CREATE TRIGGER {table}_is_final {timing} ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION inventory_snapshot_is_final()"
        )


def downgrade() -> None:
    """Reversible while no list or line carries a decision.

    A downgrade keeps every list, row and line of raw evidence. It loses the
    acting store, the importer, the command id and the retry fingerprint, so a
    list that comes back through a downgrade can no longer be changed through
    the API; it has to be imported again.
    """
    op.execute(
        "LOCK TABLE inventory_snapshot, inventory_snapshot_row, inventory_snapshot_allocation, "
        "stock_lot, stock_movement IN ACCESS EXCLUSIVE MODE"
    )
    _refuse_if(
        DECISIONS_EXIST,
        "Cannot downgrade 0015_snapshot_import: stock lists carry decisions (resolved or skipped "
        "lines, applied or rejected lists) that 0014 cannot represent. Nothing was changed.",
    )

    for table in FROZEN_TABLES:
        op.execute(f"DROP TRIGGER {table}_is_final ON {table}")
    op.execute("DROP FUNCTION inventory_snapshot_is_final()")

    op.execute("DROP TRIGGER opening_balance_traces_to_its_list ON stock_movement")
    op.execute("DROP FUNCTION opening_balance_traces_to_its_list()")
    op.drop_constraint("opening_balance_names_its_list", "stock_movement", type_="check")
    op.drop_constraint("opening_lot_names_its_list", "stock_lot", type_="check")
    op.drop_constraint(
        "fk_stock_lot_inventory_snapshot_id_inventory_snapshot", "stock_lot", type_="foreignkey"
    )
    op.create_foreign_key(
        "fk_stock_lot_inventory_snapshot_id_inventory_snapshot",
        "stock_lot",
        "inventory_snapshot",
        ["inventory_snapshot_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_table("inventory_snapshot_allocation")

    op.drop_constraint(
        "uq_inventory_snapshot_row_raw_input_id", "inventory_snapshot_row", type_="unique"
    )
    for name in (
        "verdict_has_time",
        "skip_has_reason",
        "basis_exactly_when_resolved",
        "unknown_quantity_has_no_total",
        "known_quantity_has_total",
    ):
        op.drop_constraint(name, "inventory_snapshot_row", type_="check")
    op.drop_constraint(
        "fk_inventory_snapshot_row_resolved_by_user_id_app_user",
        "inventory_snapshot_row",
        type_="foreignkey",
    )
    for column in ("resolved_at", "resolved_by_user_id", "resolution_note", "quantity_basis"):
        op.drop_column("inventory_snapshot_row", column)
    op.execute("DROP TYPE snapshot_quantity_basis")
    op.add_column("inventory_snapshot_row", sa.Column("resolved_variant_id", UUID, nullable=True))
    op.add_column("inventory_snapshot_row", sa.Column("resolved_size_id", UUID, nullable=True))
    op.create_foreign_key(
        "fk_inventory_snapshot_row_resolved_variant_id_product_variant",
        "inventory_snapshot_row",
        "product_variant",
        ["resolved_variant_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_inventory_snapshot_row_resolved_size_id_size",
        "inventory_snapshot_row",
        "size",
        ["resolved_size_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "resolved_requires_complete_row",
        "inventory_snapshot_row",
        "status <> 'RESOLVED' OR ("
        " resolved_variant_id IS NOT NULL"
        " AND resolved_size_id IS NOT NULL"
        " AND quantity_total IS NOT NULL"
        " AND quantity_state = 'KNOWN')",
    )

    op.drop_index("ix_inventory_snapshot_acting_store_created", table_name="inventory_snapshot")
    for name in (
        "applied_names_place_and_store",
        "decision_has_time",
        "rejection_has_reason",
        "review_revision_not_negative",
    ):
        op.drop_constraint(name, "inventory_snapshot", type_="check")
    for foreign_key in (
        "fk_inventory_snapshot_rejected_by_user_id_app_user",
        "fk_inventory_snapshot_created_by_user_id_app_user",
        "fk_inventory_snapshot_org_acting_store",
    ):
        op.drop_constraint(foreign_key, "inventory_snapshot", type_="foreignkey")
    op.drop_constraint("uq_inventory_snapshot_org_command", "inventory_snapshot", type_="unique")
    for column in (
        "rejection_reason",
        "rejected_by_user_id",
        "decided_at",
        "review_revision",
        "command_fingerprint",
        "created_by_user_id",
        "acting_store_id",
        "command_id",
    ):
        op.drop_column("inventory_snapshot", column)
