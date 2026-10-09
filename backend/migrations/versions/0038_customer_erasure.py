"""A customer's name and phone are erased from a debt once it has been closed long enough, or on the owner's word. Owner decision, 2026-10-09; ADR-0015.

The owner decided (business-rules.md, "customers' data") that a debt paid or
returned keeps its customer's name and phone for a year after it closed, and
a written-off one for three; that then the name and phone are erased and
every sum stays; that the owner erases a closed debt's customer at once when
the customer asks; and that a write-off's reason goes with them. This
revision gives the schema what those need.

**`customer_credit`** gains `customer_erased_at`, and
`customer_erased_by_user_id`: the owner who erased on request, NULL when the
term ran out. The name, the phone and its digits become nullable, and are
NULL exactly when the customer is erased.

**What the database guarantees** (ADR-0015 §3):

- `customer_erased_whole`: a debt has its name, phone and digits, or none of
  them, and none exactly when it is erased;
- `customer_erased_when_closed`: an open debt is never erased, and an erased
  debt never opens again;
- `customer_erased_by_when_erased`: an erasing owner only on an erased debt;
- `customer_credit_stays_erased`: once erased, a debt's customer is never
  written again, and its erasure is never moved or reassigned;
- `credit_entry_guard`, in place of `credit_entry_append_only`: the debt's
  ledger stays append-only, with one exception. A write-off's reason may be
  set to NULL, nothing else in its row changing, once its debt's customer is
  erased. A write-off still says why when it is written: that check moves
  from the row's CHECK, which an erased reason would fail, to the insert.

The owner's role gets `credit:erase_customer`, granted as `0023` granted
`credit:write_off`: to every role that manages people.

Downgrade refuses once a customer has been erased: `0037`'s columns could not
hold the debt.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0038_customer_erasure"
down_revision: str | None = "0037_stock_list_parts"
branch_labels: str | None = None
depends_on: str | None = None

STAYS_ERASED = """
CREATE FUNCTION birka_customer_stays_erased() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.customer_erased_at IS NOT NULL AND (
        NEW.customer_erased_at IS DISTINCT FROM OLD.customer_erased_at
        OR NEW.customer_erased_by_user_id IS DISTINCT FROM OLD.customer_erased_by_user_id
    ) THEN
        RAISE EXCEPTION 'The customer of debt % is erased, and stays erased (ADR-0015)', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $$
"""

# Every column but `note` compared at once, so a column added later is
# guarded without this function being written again.
ENTRY_GUARD = """
CREATE FUNCTION birka_credit_entry_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.kind = 'WRITE_OFF' AND NEW.note IS NULL THEN
            RAISE EXCEPTION 'A write-off says why'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
        AND OLD.kind = 'WRITE_OFF'
        AND OLD.note IS NOT NULL
        AND NEW.note IS NULL
        AND (to_jsonb(NEW) - 'note') = (to_jsonb(OLD) - 'note')
        AND EXISTS (
            SELECT 1 FROM customer_credit
            WHERE id = OLD.credit_id AND customer_erased_at IS NOT NULL
        )
    THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION
        'Table % is append-only: % is not permitted (invariants I10/I11)',
        TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END $$
"""


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.add_column(
        "customer_credit",
        sa.Column("customer_erased_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("customer_credit", sa.Column("customer_erased_by_user_id", uuid, nullable=True))
    op.create_foreign_key(
        "fk_customer_credit_customer_erased_by_user_id_app_user",
        "customer_credit",
        "app_user",
        ["customer_erased_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    for column in ("customer_name", "customer_phone", "phone_digits"):
        op.alter_column("customer_credit", column, nullable=True)
    op.create_check_constraint(
        "customer_erased_whole",
        "customer_credit",
        "(customer_erased_at IS NULL AND customer_name IS NOT NULL "
        "AND customer_phone IS NOT NULL AND phone_digits IS NOT NULL) "
        "OR (customer_erased_at IS NOT NULL AND customer_name IS NULL "
        "AND customer_phone IS NULL AND phone_digits IS NULL)",
    )
    op.create_check_constraint(
        "customer_erased_when_closed",
        "customer_credit",
        "customer_erased_at IS NULL OR status <> 'OPEN'",
    )
    op.create_check_constraint(
        "customer_erased_by_when_erased",
        "customer_credit",
        "customer_erased_by_user_id IS NULL OR customer_erased_at IS NOT NULL",
    )
    # What the hourly erasure reads: closed debts whose customer is still kept.
    op.create_index(
        "ix_customer_credit_kept_closed",
        "customer_credit",
        ["closed_at"],
        postgresql_where=sa.text("customer_erased_at IS NULL AND status <> 'OPEN'"),
    )
    op.execute(STAYS_ERASED)
    op.execute(
        "CREATE TRIGGER customer_credit_stays_erased BEFORE UPDATE ON customer_credit "
        "FOR EACH ROW EXECUTE FUNCTION birka_customer_stays_erased()"
    )

    op.drop_constraint("write_off_says_why", "credit_entry", type_="check")
    op.create_check_constraint(
        "only_a_write_off_says_why", "credit_entry", "kind = 'WRITE_OFF' OR note IS NULL"
    )
    op.execute("DROP TRIGGER credit_entry_append_only ON credit_entry")
    op.execute(ENTRY_GUARD)
    op.execute(
        "CREATE TRIGGER credit_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON credit_entry "
        "FOR EACH ROW EXECUTE FUNCTION birka_credit_entry_guard()"
    )

    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT DISTINCT role_id, 'credit:erase_customer' FROM role_permission "
        "WHERE permission_code = 'user:manage' "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM customer_credit WHERE customer_erased_at IS NOT NULL) THEN
                RAISE EXCEPTION
                    'A customer has been erased; 0037 cannot hold a debt without one. '
                    'Keep this revision.';
            END IF;
        END $$;
        """
    )
    op.execute("DELETE FROM role_permission WHERE permission_code = 'credit:erase_customer'")

    op.execute("DROP TRIGGER credit_entry_guard ON credit_entry")
    op.execute("DROP FUNCTION birka_credit_entry_guard()")
    op.execute(
        "CREATE TRIGGER credit_entry_append_only BEFORE UPDATE OR DELETE ON credit_entry "
        "FOR EACH ROW EXECUTE FUNCTION birka_reject_mutation();"
    )
    op.drop_constraint("only_a_write_off_says_why", "credit_entry", type_="check")
    op.create_check_constraint(
        "write_off_says_why", "credit_entry", "(kind = 'WRITE_OFF') = (note IS NOT NULL)"
    )

    op.execute("DROP TRIGGER customer_credit_stays_erased ON customer_credit")
    op.execute("DROP FUNCTION birka_customer_stays_erased()")
    op.drop_index("ix_customer_credit_kept_closed", table_name="customer_credit")
    for name in (
        "customer_erased_by_when_erased",
        "customer_erased_when_closed",
        "customer_erased_whole",
    ):
        op.drop_constraint(name, "customer_credit", type_="check")
    for column in ("customer_name", "customer_phone", "phone_digits"):
        op.alter_column("customer_credit", column, nullable=False)
    op.drop_constraint(
        "fk_customer_credit_customer_erased_by_user_id_app_user",
        "customer_credit",
        type_="foreignkey",
    )
    op.drop_column("customer_credit", "customer_erased_by_user_id")
    op.drop_column("customer_credit", "customer_erased_at")
