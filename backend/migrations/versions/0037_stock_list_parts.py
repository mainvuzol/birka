"""A stock list filled by parts: a parser's file, or lines typed by hand. Owner decision, 2026-10-08; ADR-0014.

The owner decided (business-rules.md, "the shops' existing stock") that the
shops' existing stock comes in as JSON files a parser writes from photos of
their notebooks; that several files fill one warehouse's list; that a file
added by mistake is removed, with its lines and their answers; and that a
split a line's text shows, each size beside its count, is confirmed by a
tap. This revision gives the schema what those need.

**`inventory_snapshot_part`** — one row per part of a list: a file
(`FILE`) or hand-typed lines (`PASTED`). It keeps its own command id and
fingerprint, a file's content fingerprint and what the file said of itself,
its line range, and who added and who removed it. Every list already here
becomes one `PASTED` part, under the list's own command id and fingerprint,
added by the list's creator at its creation.

**`inventory_snapshot_row`** gains its part (a composite link, so a row's
part is in its own list), the photo's name and line, the parser's `reading`,
the `file_reasons` it raised and the `shown_split`; and `split_read_as`, what
the person said a record of that split means when it may also be a range of
sizes, kept with an answer `STATED_BY_SIZE` only, with `split_read_records`,
the records it was said of, so that the approval can read them again, record
by record (owner, 2026-10-09; review, 2026-10-09). Both are part of the
answer, not of the evidence, and change with the answer.

**The enums.** `snapshot_row_status` gains `REMOVED` and
`snapshot_quantity_basis` gains `STATED_BY_SIZE`. Neither value can be used
before this revision commits, so no constraint or index here names them, and
the triggers compare them as text (as `0031` does).

**What the database guarantees** (ADR-0014 §14):

- `inventory_snapshot_part_is_final`: a part of an applied or rejected list
  never changes (the list read under a share lock, as in `0015`); a part is
  never deleted; and the only change ever made to one is its removal,
  setting `removed_at` and `removed_by_user_id` once, from NULL.
- `inventory_snapshot_row_is_fixed`: no row joins a removed part; a row's
  evidence (its list, part, line number, raw input, photo, reading, file
  reasons, shown split, stated total and state) never changes; a removed
  row never changes at all; and a row becomes `REMOVED` only when its part
  is removed and no allocation of it remains.
- `inventory_snapshot_allocation_row_is_live`: no allocation on a removed
  line, by insert or update; that covers approval's link to its lot.
- `inventory_snapshot_part_removed_whole`, deferred to commit: a removed
  part's rows are all `REMOVED`, and none keeps an allocation.
- One file is in a list once while neither copy is removed (a partial unique
  index).

`0015`'s `inventory_snapshot_is_final` is left as it is: its else-branch
reads `snapshot_row_id`, so it cannot guard the new table.

**The backfill.** Rows of decided lists are frozen by `0015`. The one update
that names each row's part runs between `DISABLE TRIGGER` and
`ENABLE TRIGGER`, which is transactional: no other session ever sees the
trigger off. The revision then asserts the trigger is enabled again, as
`0006` does.

**Refused, by name.** A list with no rows, a list whose line numbers are not
`1..n`, and a list of more than 1 000 rows: no code wrote one, and one part
could not hold it. Such a list needs a person.

**Downgrade** refuses what `0036` cannot hold: a file, a list of more than
one part, a removed part or line, a line with a photo, a reading or a shown
split, what a person said a split's record means, an answer
`STATED_BY_SIZE`. Otherwise it drops what this adds; a list
of one pasted part, decided or not, goes down and comes back with the same
fingerprints. The enums' labels stay, as `0031`'s downgrade leaves its own.

The three snapshot tables are locked `ACCESS EXCLUSIVE` for the revision, as
`0015` locks them: a maintenance window, not a trading-hours deploy.

Revision ID: 0037_stock_list_parts
Revises: 0036_outage_mark
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0037_stock_list_parts"
down_revision: str | None = "0036_outage_mark"
branch_labels: str | None = None
depends_on: str | None = None

UUID = postgresql.UUID(as_uuid=True)
PART_KIND = postgresql.ENUM("FILE", "PASTED", name="snapshot_part_kind", create_type=False)
PRICE_KIND = postgresql.ENUM("SALE", "PURCHASE", name="snapshot_price_kind", create_type=False)

PART_IS_FINAL = """
CREATE FUNCTION inventory_snapshot_part_is_final() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    decided snapshot_status;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a part of a stock list is never deleted; it is removed (ADR-0014)'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    -- Share-locked, so a decision cannot commit between this check and the
    -- write it guards. The service already holds the list FOR UPDATE.
    SELECT status INTO decided
    FROM inventory_snapshot WHERE id = NEW.inventory_snapshot_id FOR SHARE;
    IF decided IN ('APPLIED', 'REJECTED') THEN
        RAISE EXCEPTION 'stock list is % and can no longer change (inventory_snapshot_part)',
            decided
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.removed_at IS NOT NULL OR NEW.removed_by_user_id IS NOT NULL THEN
            RAISE EXCEPTION 'a part of a stock list is added, never added removed (ADR-0014)'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN NEW;
    END IF;
    -- The one change a part ever takes: its removal, once, from NULL.
    IF OLD.removed_at IS NOT NULL OR OLD.removed_by_user_id IS NOT NULL
        OR NEW.removed_at IS NULL OR NEW.removed_by_user_id IS NULL
        OR to_jsonb(NEW) - 'removed_at' - 'removed_by_user_id'
            IS DISTINCT FROM to_jsonb(OLD) - 'removed_at' - 'removed_by_user_id'
    THEN
        RAISE EXCEPTION 'a part of a stock list only ever changes by being removed, once (ADR-0014)'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END $$
"""

ROW_IS_FIXED = """
CREATE FUNCTION inventory_snapshot_row_is_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    part_removed timestamptz;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT removed_at INTO part_removed
        FROM inventory_snapshot_part WHERE id = NEW.part_id FOR SHARE;
        IF part_removed IS NOT NULL OR NEW.status::text = 'REMOVED' THEN
            RAISE EXCEPTION 'a stock list line never joins a removed part, nor starts removed (ADR-0014)'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status::text = 'REMOVED' THEN
        RAISE EXCEPTION 'a removed stock list line never changes (ADR-0014)'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.inventory_snapshot_id IS DISTINCT FROM OLD.inventory_snapshot_id
        OR NEW.part_id IS DISTINCT FROM OLD.part_id
        OR NEW.line_no IS DISTINCT FROM OLD.line_no
        OR NEW.raw_input_id IS DISTINCT FROM OLD.raw_input_id
        OR NEW.photo_name IS DISTINCT FROM OLD.photo_name
        OR NEW.photo_line IS DISTINCT FROM OLD.photo_line
        OR NEW.reading IS DISTINCT FROM OLD.reading
        OR NEW.file_reasons IS DISTINCT FROM OLD.file_reasons
        OR NEW.shown_split IS DISTINCT FROM OLD.shown_split
        OR NEW.quantity_total IS DISTINCT FROM OLD.quantity_total
        OR NEW.quantity_state IS DISTINCT FROM OLD.quantity_state
    THEN
        RAISE EXCEPTION 'the evidence of a stock list line never changes (ADR-0014)'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.status::text = 'REMOVED' THEN
        SELECT removed_at INTO part_removed
        FROM inventory_snapshot_part WHERE id = NEW.part_id FOR SHARE;
        IF part_removed IS NULL
            OR EXISTS (SELECT 1 FROM inventory_snapshot_allocation WHERE snapshot_row_id = NEW.id)
        THEN
            RAISE EXCEPTION 'a stock list line is removed only with its part, and without its answer (ADR-0014)'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$
"""

ALLOCATION_ROW_IS_LIVE = """
CREATE FUNCTION inventory_snapshot_allocation_row_is_live() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    line_status text;
    part_removed timestamptz;
BEGIN
    SELECT r.status::text, p.removed_at INTO line_status, part_removed
    FROM inventory_snapshot_row r
    JOIN inventory_snapshot_part p ON p.id = r.part_id
    WHERE r.id = NEW.snapshot_row_id
    FOR SHARE OF p;
    IF line_status = 'REMOVED' OR part_removed IS NOT NULL THEN
        RAISE EXCEPTION 'a removed stock list line takes no answer (ADR-0014)'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END $$
"""

PART_REMOVED_WHOLE = """
CREATE FUNCTION inventory_snapshot_part_removed_whole() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.removed_at IS NOT NULL AND EXISTS (
        SELECT 1 FROM inventory_snapshot_row r
        WHERE r.part_id = NEW.id
          AND (r.status::text <> 'REMOVED'
               OR EXISTS (SELECT 1 FROM inventory_snapshot_allocation a
                          WHERE a.snapshot_row_id = r.id))
    ) THEN
        RAISE EXCEPTION 'a removed part of a stock list is removed whole: every line removed, no answer kept (ADR-0014)'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END $$
"""

FUNCTIONS = (
    "inventory_snapshot_part_removed_whole",
    "inventory_snapshot_allocation_row_is_live",
    "inventory_snapshot_row_is_fixed",
    "inventory_snapshot_part_is_final",
)

ROW_CHECKS = {
    "photo_named_with_its_line": "(photo_name IS NULL) = (photo_line IS NULL)",
    "photo_line_positive": "photo_line IS NULL OR photo_line >= 1",
    # The basis is compared as text: `STATED_BY_SIZE` cannot be used as an
    # enum value before this revision commits.
    "split_read_only_by_size": (
        "split_read_as IS NULL OR (split_read_as = 'SIZE_WITH_COUNT' "
        "AND quantity_basis::text = 'STATED_BY_SIZE')"
    ),
    "split_read_with_its_records": (
        "(split_read_as IS NULL) = (split_read_records IS NULL) "
        "AND (split_read_records IS NULL OR jsonb_typeof(split_read_records) = 'array')"
    ),
}


def _refuse_list(condition: str, message: str) -> None:
    """Refuse by name, naming the first list the condition finds. The
    condition and the message are this revision's own constants."""
    op.execute(
        f"""DO $$
        DECLARE
            culprit uuid;
        BEGIN
            SELECT s.id INTO culprit FROM inventory_snapshot s WHERE {condition}
            ORDER BY s.id LIMIT 1;
            IF culprit IS NOT NULL THEN
                RAISE EXCEPTION '{message}', culprit;
            END IF;
        END $$"""  # noqa: S608
    )


def _refuse_if(condition: str, message: str) -> None:
    op.execute(f"DO $$ BEGIN IF {condition} THEN RAISE EXCEPTION '{message}'; END IF; END $$")


def upgrade() -> None:
    op.execute(
        "LOCK TABLE inventory_snapshot, inventory_snapshot_row, inventory_snapshot_allocation "
        "IN ACCESS EXCLUSIVE MODE"
    )
    # PostgreSQL 12+ allows these inside a transaction; the values cannot be
    # *used* until it commits, and nothing below uses them as enum values.
    op.execute("ALTER TYPE snapshot_row_status ADD VALUE IF NOT EXISTS 'REMOVED'")
    op.execute("ALTER TYPE snapshot_quantity_basis ADD VALUE IF NOT EXISTS 'STATED_BY_SIZE'")

    # None of these can exist: every list was imported with 1 to 1 000 lines,
    # numbered from 1. One that is here was written by hand and needs a person.
    rows = "SELECT 1 FROM inventory_snapshot_row r WHERE r.inventory_snapshot_id = s.id"
    _refuse_list(
        f"NOT EXISTS ({rows})",
        "Cannot apply 0037_stock_list_parts: stock list % has no lines, and a part has one "
        "at least. Review it explicitly; nothing was changed.",
    )
    _refuse_list(
        "EXISTS (SELECT 1 FROM inventory_snapshot_row r WHERE r.inventory_snapshot_id = s.id "
        "HAVING min(r.line_no) <> 1 OR max(r.line_no) <> count(*) OR count(*) > 1000)",
        "Cannot apply 0037_stock_list_parts: the lines of stock list % are not numbered "
        "1 to n, or are more than 1 000, so they cannot be one part. Review it explicitly; "
        "nothing was changed.",
    )

    # --- the parts ---------------------------------------------------------------
    op.execute("CREATE TYPE snapshot_part_kind AS ENUM ('FILE', 'PASTED')")
    op.execute("CREATE TYPE snapshot_price_kind AS ENUM ('SALE', 'PURCHASE')")
    op.create_table(
        "inventory_snapshot_part",
        sa.Column("id", UUID, nullable=False),
        sa.Column("organization_id", UUID, nullable=False),
        sa.Column("inventory_snapshot_id", UUID, nullable=False),
        sa.Column("part_no", sa.Integer(), nullable=False),
        sa.Column("command_id", UUID, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("content_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("kind", PART_KIND, nullable=False),
        sa.Column("file_name", sa.String(length=200), nullable=True),
        sa.Column("source", sa.String(length=300), nullable=True),
        sa.Column("counted_on", sa.String(length=40), nullable=True),
        sa.Column("price_kind", PRICE_KIND, nullable=True),
        sa.Column("parser", sa.String(length=100), nullable=True),
        sa.Column("format_version", sa.Integer(), nullable=True),
        sa.Column("line_count", sa.Integer(), nullable=False),
        sa.Column("first_line_no", sa.Integer(), nullable=False),
        sa.Column("last_line_no", sa.Integer(), nullable=False),
        sa.Column("added_by_user_id", UUID, nullable=True),
        sa.Column("removed_by_user_id", UUID, nullable=True),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("part_no >= 1", name="part_no_positive"),
        sa.CheckConstraint("line_count BETWEEN 1 AND 1000", name="line_count_bounded"),
        sa.CheckConstraint("first_line_no >= 1", name="first_line_positive"),
        sa.CheckConstraint(
            "last_line_no = first_line_no + line_count - 1", name="lines_contiguous"
        ),
        sa.CheckConstraint(
            "(kind = 'FILE') = (file_name IS NOT NULL AND format_version IS NOT NULL"
            " AND content_fingerprint IS NOT NULL)",
            name="file_names_itself",
        ),
        sa.CheckConstraint(
            "kind = 'FILE' OR (price_kind IS NULL AND parser IS NULL)",
            name="only_a_file_has_a_parser",
        ),
        sa.CheckConstraint(
            "(removed_at IS NULL) = (removed_by_user_id IS NULL)", name="removal_names_who"
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            name="fk_inventory_snapshot_part_organization_id_organization",
            ondelete="CASCADE",
        ),
        # Named by the metadata's convention, which shortens a name past
        # PostgreSQL's 63 characters exactly as the model's own is shortened.
        sa.ForeignKeyConstraint(
            ["inventory_snapshot_id"], ["inventory_snapshot.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["added_by_user_id"],
            ["app_user.id"],
            name="fk_inventory_snapshot_part_added_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["removed_by_user_id"],
            ["app_user.id"],
            name="fk_inventory_snapshot_part_removed_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_inventory_snapshot_part"),
        sa.UniqueConstraint(
            "organization_id", "command_id", name="uq_inventory_snapshot_part_org_command"
        ),
        sa.UniqueConstraint(
            "inventory_snapshot_id", "part_no", name="uq_inventory_snapshot_part_no"
        ),
        sa.UniqueConstraint(
            "inventory_snapshot_id", "id", name="uq_inventory_snapshot_part_list_id"
        ),
    )
    op.create_index(
        "uq_inventory_snapshot_part_active_file",
        "inventory_snapshot_part",
        ["inventory_snapshot_id", "content_fingerprint"],
        unique=True,
        postgresql_where=sa.text("removed_at IS NULL AND kind = 'FILE'"),
    )

    # --- the rows ------------------------------------------------------------------
    op.add_column("inventory_snapshot_row", sa.Column("part_id", UUID, nullable=True))
    op.add_column("inventory_snapshot_row", sa.Column("photo_name", sa.String(200), nullable=True))
    op.add_column("inventory_snapshot_row", sa.Column("photo_line", sa.Integer(), nullable=True))
    op.add_column(
        "inventory_snapshot_row",
        sa.Column("reading", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "inventory_snapshot_row",
        sa.Column(
            "file_reasons",
            postgresql.ARRAY(sa.String(length=40)),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
    )
    op.add_column(
        "inventory_snapshot_row",
        sa.Column("shown_split", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "inventory_snapshot_row", sa.Column("split_read_as", sa.String(20), nullable=True)
    )
    op.add_column(
        "inventory_snapshot_row",
        sa.Column("split_read_records", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    # --- every list here becomes one pasted part ---------------------------------
    # Its command id and fingerprint are the list's, so a retry of the import
    # still replays; the fingerprint is NULL for a list a downgrade restored.
    op.execute(
        """
        INSERT INTO inventory_snapshot_part (
            id, organization_id, inventory_snapshot_id, part_no, command_id,
            command_fingerprint, content_fingerprint, kind, line_count,
            first_line_no, last_line_no, added_by_user_id, created_at)
        SELECT gen_random_uuid(), s.organization_id, s.id, 1, s.command_id,
               s.command_fingerprint, NULL, 'PASTED', count(*), 1, count(*),
               s.created_by_user_id, s.created_at
        FROM inventory_snapshot s
        JOIN inventory_snapshot_row r ON r.inventory_snapshot_id = s.id
        GROUP BY s.id
        """
    )
    # Rows of decided lists are frozen by 0015's trigger. Disabling it is
    # transactional: no other session sees it off, and it is on again below.
    op.execute("ALTER TABLE inventory_snapshot_row DISABLE TRIGGER inventory_snapshot_row_is_final")
    op.execute(
        "UPDATE inventory_snapshot_row r SET part_id = p.id "
        "FROM inventory_snapshot_part p WHERE p.inventory_snapshot_id = r.inventory_snapshot_id"
    )
    op.execute("ALTER TABLE inventory_snapshot_row ENABLE TRIGGER inventory_snapshot_row_is_final")
    _refuse_if(
        "(SELECT tgenabled FROM pg_trigger WHERE tgname = 'inventory_snapshot_row_is_final') "
        "IS DISTINCT FROM 'O'",
        "0037 aborted: the trigger freezing decided stock lists was not restored",
    )
    _refuse_if(
        "EXISTS (SELECT 1 FROM inventory_snapshot_row WHERE part_id IS NULL)",
        "0037 aborted: a stock list line was left without its part",
    )

    op.alter_column("inventory_snapshot_row", "part_id", nullable=False)
    op.create_foreign_key(
        "fk_inventory_snapshot_row_part",
        "inventory_snapshot_row",
        "inventory_snapshot_part",
        ["inventory_snapshot_id", "part_id"],
        ["inventory_snapshot_id", "id"],
        ondelete="RESTRICT",
    )
    for name, condition in ROW_CHECKS.items():
        op.create_check_constraint(name, "inventory_snapshot_row", condition)
    op.create_index("ix_inventory_snapshot_row_part", "inventory_snapshot_row", ["part_id"])
    op.create_index(
        "ix_inventory_snapshot_row_photo",
        "inventory_snapshot_row",
        ["inventory_snapshot_id", "photo_name", "photo_line"],
    )

    # --- what the database guarantees -------------------------------------------
    op.execute(PART_IS_FINAL)
    op.execute(
        "CREATE TRIGGER inventory_snapshot_part_is_final "
        "BEFORE INSERT OR UPDATE OR DELETE ON inventory_snapshot_part "
        "FOR EACH ROW EXECUTE FUNCTION inventory_snapshot_part_is_final()"
    )
    op.execute(ROW_IS_FIXED)
    op.execute(
        "CREATE TRIGGER inventory_snapshot_row_is_fixed "
        "BEFORE INSERT OR UPDATE ON inventory_snapshot_row "
        "FOR EACH ROW EXECUTE FUNCTION inventory_snapshot_row_is_fixed()"
    )
    op.execute(ALLOCATION_ROW_IS_LIVE)
    op.execute(
        "CREATE TRIGGER inventory_snapshot_allocation_row_is_live "
        "BEFORE INSERT OR UPDATE ON inventory_snapshot_allocation "
        "FOR EACH ROW EXECUTE FUNCTION inventory_snapshot_allocation_row_is_live()"
    )
    op.execute(PART_REMOVED_WHOLE)
    op.execute(
        "CREATE CONSTRAINT TRIGGER inventory_snapshot_part_removed_whole "
        "AFTER UPDATE OF removed_at ON inventory_snapshot_part "
        "DEFERRABLE INITIALLY DEFERRED "
        "FOR EACH ROW EXECUTE FUNCTION inventory_snapshot_part_removed_whole()"
    )


def downgrade() -> None:
    op.execute(
        "LOCK TABLE inventory_snapshot, inventory_snapshot_part, inventory_snapshot_row, "
        "inventory_snapshot_allocation IN ACCESS EXCLUSIVE MODE"
    )
    for condition, message in (
        (
            "EXISTS (SELECT 1 FROM inventory_snapshot_part WHERE kind = 'FILE')",
            "Cannot downgrade 0037_stock_list_parts: a stock list holds a file, and 0036 "
            "keeps no photo, reading or file of a line. Keep this revision.",
        ),
        (
            "EXISTS (SELECT 1 FROM inventory_snapshot_part "
            "GROUP BY inventory_snapshot_id HAVING count(*) > 1)",
            "Cannot downgrade 0037_stock_list_parts: a stock list has more than one part, "
            "and 0036 knows a list as one import. Keep this revision.",
        ),
        (
            "EXISTS (SELECT 1 FROM inventory_snapshot_part WHERE removed_at IS NOT NULL)",
            "Cannot downgrade 0037_stock_list_parts: a part of a stock list was removed, "
            "and 0036 cannot say so. Keep this revision.",
        ),
        (
            "EXISTS (SELECT 1 FROM inventory_snapshot_row WHERE status::text = 'REMOVED')",
            "Cannot downgrade 0037_stock_list_parts: a stock list line is removed, and 0036 "
            "has no such state. Keep this revision.",
        ),
        (
            "EXISTS (SELECT 1 FROM inventory_snapshot_row WHERE photo_name IS NOT NULL "
            "OR photo_line IS NOT NULL OR reading IS NOT NULL OR shown_split IS NOT NULL "
            "OR cardinality(file_reasons) > 0)",
            "Cannot downgrade 0037_stock_list_parts: a stock list line keeps a photo, a "
            "reading or a split its text shows, which 0036 cannot hold. Keep this revision.",
        ),
        (
            "EXISTS (SELECT 1 FROM inventory_snapshot_row WHERE split_read_as IS NOT NULL "
            "OR split_read_records IS NOT NULL)",
            "Cannot downgrade 0037_stock_list_parts: a stock list line keeps what a person "
            "said a record of its split means, which 0036 cannot hold. Keep this revision.",
        ),
        (
            "EXISTS (SELECT 1 FROM inventory_snapshot_row "
            "WHERE quantity_basis::text = 'STATED_BY_SIZE')",
            "Cannot downgrade 0037_stock_list_parts: a stock list line is answered as its "
            "text shows it by size, a basis 0036 does not know. Keep this revision.",
        ),
    ):
        _refuse_if(condition, message)

    op.execute("DROP TRIGGER inventory_snapshot_part_removed_whole ON inventory_snapshot_part")
    op.execute(
        "DROP TRIGGER inventory_snapshot_allocation_row_is_live ON inventory_snapshot_allocation"
    )
    op.execute("DROP TRIGGER inventory_snapshot_row_is_fixed ON inventory_snapshot_row")
    op.execute("DROP TRIGGER inventory_snapshot_part_is_final ON inventory_snapshot_part")
    for function in FUNCTIONS:
        op.execute(f"DROP FUNCTION {function}()")

    op.drop_index("ix_inventory_snapshot_row_photo", table_name="inventory_snapshot_row")
    op.drop_index("ix_inventory_snapshot_row_part", table_name="inventory_snapshot_row")
    for name in ROW_CHECKS:
        op.drop_constraint(name, "inventory_snapshot_row", type_="check")
    op.drop_constraint(
        "fk_inventory_snapshot_row_part", "inventory_snapshot_row", type_="foreignkey"
    )
    for column in (
        "split_read_records",
        "split_read_as",
        "shown_split",
        "file_reasons",
        "reading",
        "photo_line",
        "photo_name",
        "part_id",
    ):
        op.drop_column("inventory_snapshot_row", column)

    op.drop_index("uq_inventory_snapshot_part_active_file", table_name="inventory_snapshot_part")
    op.drop_table("inventory_snapshot_part")
    op.execute("DROP TYPE snapshot_price_kind")
    op.execute("DROP TYPE snapshot_part_kind")
