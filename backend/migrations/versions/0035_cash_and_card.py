"""Cash and card, the day's close. Owner decisions, 2026-10-04; ADR-0012.

The owner decided (business-rules.md, "cash and card, the day's close") that
each payment is made one way — cash, card or transfer, and for an order also
in advance by transfer or cash on delivery — that one drawer per store is
counted blind and closed once a day, that cash taken out is recorded with who
and why, and that a closed day is never reopened: a mistake is corrected on
the day the correction is made.

**The way of paying** — `payment_method` on `sale`, `credit_entry` (payments
only) and `refund` ("how the money went back"). NULL means «не вказано» and
exists only on rows written before this revision: nothing is backfilled and
nothing is guessed.

**The drawer's periods** — `drawer_period` on the same three, and on the two
new tables that move the drawer's cash. Period *k* of a store is everything
recorded at its drawer after close *k−1* and up to close *k*. It is stamped
by a BEFORE INSERT trigger under the store row's `FOR KEY SHARE`, which the
close's `FOR UPDATE` waits for, so membership follows commit order, never a
timestamp: a sale that began before a close and committed after it is in the
next close, exactly once (ADR-0012, B3). The application never writes it.
`birka_drawer_period` refuses to run at any isolation but READ COMMITTED: at
REPEATABLE READ its `max(number)` would read a snapshot taken before a close
it waited for, and stamp a period that close had already summed.

**`cash_close`** — one row per close, every figure frozen; append-only.
**`cash_close_reason`** — the reason for a close's difference, written once by
whoever counted; append-only. **`cash_movement`** — cash taken out of the
drawer, or put in for change; append-only. **`payment_correction`** — a wrong
way fixed by a new row, never by rewriting the money row; append-only, and
its trigger checks that it names its money row's drawer, amount and
direction, the close it explains, and the chain of earlier corrections.
**`cash_message`** — what the bot tells the network's owner of a difference,
written before it is sent; its status moves, as a backup alert's does.

`sale` and `refund` were immutable by convention only; a BEFORE UPDATE guard
now refuses any change to their way or period. `credit_entry` was append-only
already.

**Permissions:** `cash:close` and `cash:expense` to every role that sells
(`sale:create`); `cash:take_out` and `cash:correct` to every role that reads
the money (`report:view_financial`).

**Downgrade** refuses once any close, movement or correction exists, or any
money row has a way: 0034 cannot say how anything was paid.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0035_cash_and_card"
down_revision: str | None = "0034_server_incidents"
branch_labels: str | None = None
depends_on: str | None = None

FIVE_WAYS = "('CASH', 'CARD', 'TRANSFER', 'PREPAID_TRANSFER', 'CARRIER_COD')"
TILL_WAYS = "('CASH', 'CARD', 'TRANSFER')"

APPEND_ONLY = ("cash_close", "cash_close_reason", "cash_movement", "payment_correction")

# The period of a store's drawer that an insert made now belongs to.
DRAWER_PERIOD = """
CREATE FUNCTION birka_drawer_period(drawer uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    latest integer;
BEGIN
    -- At REPEATABLE READ the max() below would read a snapshot taken before a
    -- close this transaction waited for: refuse rather than misplace money.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'drawer periods need READ COMMITTED'
            USING ERRCODE = 'invalid_transaction_state';
    END IF;
    -- Waits while a close of this store runs (it holds the row FOR UPDATE),
    -- and keeps the next close waiting until this transaction ends.
    PERFORM 1 FROM store WHERE id = drawer FOR KEY SHARE;
    -- A new statement, so a new snapshot: it sees the close it waited for.
    SELECT max(number) INTO latest FROM cash_close WHERE store_id = drawer;
    RETURN coalesce(latest, 0) + 1;
END $$
"""

STAMP_SALE = """
CREATE FUNCTION birka_stamp_sale() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.drawer_period := birka_drawer_period(NEW.store_id);
    RETURN NEW;
END $$
"""

# A payment is in the drawer of the store that took it: the one that sold,
# or the one that took it while that one did not trade. Nothing else in the
# debt's ledger moves the drawer.
STAMP_CREDIT_ENTRY = """
CREATE FUNCTION birka_stamp_credit_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind = 'PAYMENT' THEN
        NEW.drawer_period := birka_drawer_period(coalesce(
            NEW.taken_at_store_id,
            (SELECT store_id FROM customer_credit WHERE id = NEW.credit_id)
        ));
    ELSE
        NEW.drawer_period := NULL;
    END IF;
    RETURN NEW;
END $$
"""

# Money handed back leaves the drawer of the store that took the goods back.
STAMP_REFUND = """
CREATE FUNCTION birka_stamp_refund() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.drawer_period := birka_drawer_period(NEW.taken_at_store_id);
    RETURN NEW;
END $$
"""

STAMP_MOVEMENT = """
CREATE FUNCTION birka_stamp_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.drawer_period := birka_drawer_period(NEW.store_id);
    RETURN NEW;
END $$
"""

# A correction is checked against its money row here, so a bug in the
# command is refused rather than stored (ADR-0012, B6.1).
STAMP_CORRECTION = """
CREATE FUNCTION birka_stamp_correction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    target_store uuid;
    target_amount numeric(12, 2);
    target_direction text;
    target_period integer;
    stated text;
    previous_seq integer;
    previous_to text;
    closed uuid;
BEGIN
    IF NEW.sale_id IS NOT NULL THEN
        -- A sale paid in parts took only its first payment: that is the
        -- money row a correction of it names.
        IF EXISTS (SELECT 1 FROM customer_credit WHERE sale_id = NEW.sale_id) THEN
            RAISE EXCEPTION 'A sale paid in parts is corrected through its first payment'
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT store_id, total, 'IN', drawer_period, payment_method
            INTO target_store, target_amount, target_direction, target_period, stated
            FROM sale WHERE id = NEW.sale_id;
        SELECT seq, to_method INTO previous_seq, previous_to
            FROM payment_correction WHERE sale_id = NEW.sale_id ORDER BY seq DESC LIMIT 1;
    ELSIF NEW.credit_entry_id IS NOT NULL THEN
        SELECT coalesce(entry.taken_at_store_id, credit.store_id), entry.amount, 'IN',
               entry.drawer_period, entry.payment_method
            INTO target_store, target_amount, target_direction, target_period, stated
            FROM credit_entry entry JOIN customer_credit credit ON credit.id = entry.credit_id
            WHERE entry.id = NEW.credit_entry_id AND entry.kind = 'PAYMENT';
        SELECT seq, to_method INTO previous_seq, previous_to
            FROM payment_correction WHERE credit_entry_id = NEW.credit_entry_id
            ORDER BY seq DESC LIMIT 1;
    ELSE
        SELECT refund.taken_at_store_id, coalesce(returned.cash_back, refund.total_amount), 'OUT',
               refund.drawer_period, refund.payment_method
            INTO target_store, target_amount, target_direction, target_period, stated
            FROM refund LEFT JOIN credit_entry returned ON returned.refund_id = refund.id
            WHERE refund.id = NEW.refund_id;
        SELECT seq, to_method INTO previous_seq, previous_to
            FROM payment_correction WHERE refund_id = NEW.refund_id ORDER BY seq DESC LIMIT 1;
    END IF;
    IF target_period IS NULL THEN
        RAISE EXCEPTION 'This money row is in no drawer period (recorded before 0035, or not '
            'a payment), so its way is not corrected'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.store_id IS DISTINCT FROM target_store
        OR NEW.amount IS DISTINCT FROM target_amount
        OR NEW.direction IS DISTINCT FROM target_direction
    THEN
        RAISE EXCEPTION 'A correction carries its money row''s drawer, amount and direction'
            USING ERRCODE = 'check_violation';
    END IF;
    -- From here the store's row is held: no close can commit before this
    -- transaction ends, so the close read below is the one that stands.
    NEW.drawer_period := birka_drawer_period(NEW.store_id);
    SELECT id INTO closed FROM cash_close
        WHERE store_id = NEW.store_id AND number = target_period;
    IF NEW.explains_close_id IS DISTINCT FROM closed THEN
        RAISE EXCEPTION 'A correction explains the close of its money row''s period, and only '
            'once that period is closed'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.seq IS DISTINCT FROM coalesce(previous_seq, 0) + 1 THEN
        RAISE EXCEPTION 'A correction follows the last one of its money row'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.from_method IS DISTINCT FROM (
        CASE WHEN previous_seq IS NULL THEN stated ELSE previous_to END
    ) THEN
        RAISE EXCEPTION 'A correction changes the way its money row has now'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$
"""

# Other columns stay as they were: tests backdate `sold_at`, and a sale's
# answer is written to it after the insert.
GUARD_MONEY_ROW = """
CREATE FUNCTION birka_guard_money_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.payment_method IS DISTINCT FROM OLD.payment_method
        OR NEW.drawer_period IS DISTINCT FROM OLD.drawer_period
    THEN
        RAISE EXCEPTION 'The way and the drawer period of % are never changed: a wrong way '
            'is corrected by a new row (ADR-0012)', TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END $$
"""


def _money_columns(table: str, ways: str) -> None:
    op.add_column(table, sa.Column("payment_method", sa.String(length=20), nullable=True))
    op.add_column(table, sa.Column("drawer_period", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "payment_method_known", table, f"payment_method IS NULL OR payment_method IN {ways}"
    )
    op.create_check_constraint(
        "drawer_period_positive", table, "drawer_period IS NULL OR drawer_period > 0"
    )


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    now = sa.text("now()")
    money = sa.Numeric(12, 2)

    # 1. The way and the period on the money rows. Columns added to the
    # append-only ledger, as 0025 added one: no row is rewritten.
    _money_columns("sale", FIVE_WAYS)
    _money_columns("credit_entry", FIVE_WAYS)
    _money_columns("refund", TILL_WAYS)
    op.create_check_constraint(
        "only_a_payment_has_a_method", "credit_entry", "payment_method IS NULL OR kind = 'PAYMENT'"
    )
    op.create_check_constraint(
        "only_a_payment_has_a_period", "credit_entry", "drawer_period IS NULL OR kind = 'PAYMENT'"
    )
    op.create_index("ix_sale_store_id_drawer_period", "sale", ["store_id", "drawer_period"])
    op.create_index(
        "ix_credit_entry_drawer_period",
        "credit_entry",
        ["drawer_period"],
        postgresql_where=sa.text("kind = 'PAYMENT'"),
    )
    op.create_index(
        "ix_refund_taken_at_store_id_drawer_period",
        "refund",
        ["taken_at_store_id", "drawer_period"],
    )

    # 2. The close.
    op.create_table(
        "cash_close",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("store_id", uuid, nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("is_opening", sa.Boolean(), nullable=False),
        sa.Column("business_day", sa.Date(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actor_user_id", uuid, nullable=False),
        sa.Column("command_id", uuid, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("opening_float", money, nullable=True),
        sa.Column("counted", money, nullable=False),
        sa.Column("cash_in", money, nullable=False),
        sa.Column("cash_out", money, nullable=False),
        sa.Column("taken_out", money, nullable=False),
        sa.Column("put_in", money, nullable=False),
        sa.Column("cash_corrected", money, nullable=False),
        sa.Column("expected", money, nullable=True),
        sa.Column("difference", money, nullable=True),
        sa.Column(
            "others", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"
        ),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_cash_close"),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["app_user.id"],
            name="fk_cash_close_actor_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("organization_id", "command_id", name="uq_cash_close_org_command"),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_cash_close_org_store",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("store_id", "number", name="uq_cash_close_store_id_number"),
        sa.UniqueConstraint("store_id", "business_day", name="uq_cash_close_store_id_business_day"),
        sa.UniqueConstraint("store_id", "id", name="uq_cash_close_store_id_id"),
        sa.CheckConstraint("number > 0", name="number_positive"),
        sa.CheckConstraint("counted >= 0", name="counted_not_negative"),
        sa.CheckConstraint("number <> 1 OR is_opening", name="first_is_opening"),
        sa.CheckConstraint("is_opening = (opening_float IS NULL)", name="opening_has_no_float"),
        sa.CheckConstraint(
            "(opening_float IS NULL) = (expected IS NULL) "
            "AND (expected IS NULL) = (difference IS NULL)",
            name="expected_with_float",
        ),
        sa.CheckConstraint(
            "expected IS NULL OR expected = "
            "opening_float + cash_in - cash_out - taken_out + put_in + cash_corrected",
            name="expected_is_the_sum",
        ),
        sa.CheckConstraint(
            "difference IS NULL OR difference = counted - expected", name="difference_is_counted"
        ),
        sa.CheckConstraint("jsonb_typeof(others) = 'object'", name="others_object"),
    )

    # 3. The reason for its difference: once, by whoever counted.
    op.create_table(
        "cash_close_reason",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("close_id", uuid, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor_user_id", uuid, nullable=False),
        sa.Column("command_id", uuid, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_cash_close_reason"),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["app_user.id"],
            name="fk_cash_close_reason_actor_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "organization_id", "command_id", name="uq_cash_close_reason_org_command"
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            name="fk_cash_close_reason_organization_id_organization",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["close_id"],
            ["cash_close.id"],
            name="fk_cash_close_reason_close_id_cash_close",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("close_id", name="uq_cash_close_reason_close_id"),
        sa.CheckConstraint(
            "char_length(btrim(reason)) > 0 AND char_length(reason) <= 1000", name="says_why"
        ),
    )

    # 4. Cash taken out, and put in for change.
    op.create_table(
        "cash_movement",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("store_id", uuid, nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("direction", sa.String(length=3), nullable=False),
        sa.Column("amount", money, nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("for_close_id", uuid, nullable=True),
        sa.Column("moved_to_close", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("drawer_period", sa.Integer(), nullable=True),
        sa.Column("actor_user_id", uuid, nullable=False),
        sa.Column("command_id", uuid, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_cash_movement"),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["app_user.id"],
            name="fk_cash_movement_actor_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("organization_id", "command_id", name="uq_cash_movement_org_command"),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_cash_movement_org_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["store_id", "for_close_id"],
            ["cash_close.store_id", "cash_close.id"],
            name="fk_cash_movement_store_for_close",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "kind IN ('OWNER', 'EXPENSES', 'SUPPLIER_COURIER', 'CHANGE')", name="kind_known"
        ),
        sa.CheckConstraint("direction IN ('IN', 'OUT')", name="direction_known"),
        sa.CheckConstraint("(direction = 'IN') = (kind = 'CHANGE')", name="direction_of_kind"),
        sa.CheckConstraint("amount > 0", name="amount_positive"),
        sa.CheckConstraint("note IS NULL OR char_length(note) <= 200", name="note_short"),
        sa.CheckConstraint(
            "NOT moved_to_close OR for_close_id IS NOT NULL", name="moved_names_close"
        ),
        sa.CheckConstraint(
            "drawer_period IS NULL OR drawer_period > 0", name="drawer_period_positive"
        ),
    )
    op.create_index(
        "ix_cash_movement_store_id_drawer_period", "cash_movement", ["store_id", "drawer_period"]
    )
    op.create_index("ix_cash_movement_for_close_id", "cash_movement", ["for_close_id"])

    # 5. A wrong way, corrected by a new row.
    op.create_table(
        "payment_correction",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("store_id", uuid, nullable=False),
        sa.Column("sale_id", uuid, nullable=True),
        sa.Column("credit_entry_id", uuid, nullable=True),
        sa.Column("refund_id", uuid, nullable=True),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("direction", sa.String(length=3), nullable=False),
        sa.Column("amount", money, nullable=False),
        sa.Column("from_method", sa.String(length=20), nullable=True),
        sa.Column("to_method", sa.String(length=20), nullable=False),
        sa.Column("explains_close_id", uuid, nullable=True),
        sa.Column("drawer_period", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("actor_user_id", uuid, nullable=False),
        sa.Column("command_id", uuid, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_payment_correction"),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["app_user.id"],
            name="fk_payment_correction_actor_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "organization_id", "command_id", name="uq_payment_correction_org_command"
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_payment_correction_org_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sale_id"], ["sale.id"], name="fk_payment_correction_sale_id_sale", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["credit_entry_id"],
            ["credit_entry.id"],
            name="fk_payment_correction_credit_entry_id_credit_entry",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["refund_id"],
            ["refund.id"],
            name="fk_payment_correction_refund_id_refund",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["store_id", "explains_close_id"],
            ["cash_close.store_id", "cash_close.id"],
            name="fk_payment_correction_store_explains_close",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("sale_id", "seq", name="uq_payment_correction_sale_id_seq"),
        sa.UniqueConstraint(
            "credit_entry_id", "seq", name="uq_payment_correction_credit_entry_id_seq"
        ),
        sa.UniqueConstraint("refund_id", "seq", name="uq_payment_correction_refund_id_seq"),
        sa.CheckConstraint(
            "num_nonnulls(sale_id, credit_entry_id, refund_id) = 1", name="one_money_row"
        ),
        sa.CheckConstraint("direction IN ('IN', 'OUT')", name="direction_known"),
        sa.CheckConstraint("(direction = 'OUT') = (refund_id IS NOT NULL)", name="out_is_a_refund"),
        sa.CheckConstraint(
            f"from_method IS NULL OR from_method IN {FIVE_WAYS}", name="from_method_known"
        ),
        sa.CheckConstraint(f"to_method IN {FIVE_WAYS}", name="to_method_known"),
        sa.CheckConstraint("from_method IS DISTINCT FROM to_method", name="changes_the_way"),
        sa.CheckConstraint("amount >= 0", name="amount_not_negative"),
        sa.CheckConstraint("seq > 0", name="seq_positive"),
        sa.CheckConstraint("note IS NULL OR char_length(note) <= 200", name="note_short"),
        sa.CheckConstraint(
            "drawer_period IS NULL OR drawer_period > 0", name="drawer_period_positive"
        ),
    )
    op.create_index(
        "ix_payment_correction_store_id_drawer_period",
        "payment_correction",
        ["store_id", "drawer_period"],
    )
    op.create_index(
        "ix_payment_correction_explains_close_id", "payment_correction", ["explains_close_id"]
    )

    # 6. What the bot tells of a difference, written before it is sent. Its
    # status moves, so it is not append-only.
    op.create_table(
        "cash_message",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("close_id", uuid, nullable=False),
        sa.Column("user_id", uuid, nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="PENDING"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=300), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_cash_message"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            name="fk_cash_message_organization_id_organization",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["close_id"],
            ["cash_close.id"],
            name="fk_cash_message_close_id_cash_close",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["app_user.id"],
            name="fk_cash_message_user_id_app_user",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("close_id", "user_id", name="uq_cash_message_close_id_user_id"),
        sa.CheckConstraint(
            "status IN ('PENDING', 'SENT', 'REFUSED', 'FAILED')", name="status_known"
        ),
        sa.CheckConstraint("(status = 'SENT') = (sent_at IS NOT NULL)", name="sent_has_time"),
        sa.CheckConstraint("attempts >= 0", name="attempts_not_negative"),
    )

    # 7. The stamps, the guards, and append-only, as the stock ledger is (the
    # function has existed since 0002).
    for function in (
        DRAWER_PERIOD,
        STAMP_SALE,
        STAMP_CREDIT_ENTRY,
        STAMP_REFUND,
        STAMP_MOVEMENT,
        STAMP_CORRECTION,
        GUARD_MONEY_ROW,
    ):
        op.execute(function)
    for trigger, table, function in (
        ("sale_drawer_period", "sale", "birka_stamp_sale"),
        ("credit_entry_drawer_period", "credit_entry", "birka_stamp_credit_entry"),
        ("refund_drawer_period", "refund", "birka_stamp_refund"),
        ("cash_movement_drawer_period", "cash_movement", "birka_stamp_movement"),
        ("payment_correction_stamp", "payment_correction", "birka_stamp_correction"),
    ):
        op.execute(
            f"CREATE TRIGGER {trigger} BEFORE INSERT ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {function}()"
        )
    for table in ("sale", "refund"):
        op.execute(
            f"CREATE TRIGGER {table}_money_guard BEFORE UPDATE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION birka_guard_money_row()"
        )
    for table in APPEND_ONLY:
        op.execute(
            f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION birka_reject_mutation()"
        )

    # 8. Grants: closing the drawer and paying expenses from it to whoever
    # sells; any take-out, cash put in and corrections to whoever reads the
    # money (ADR-0012, B9).
    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT DISTINCT role_id, 'cash:close' FROM role_permission "
        "WHERE permission_code = 'sale:create' "
        "ON CONFLICT DO NOTHING"
    )
    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT DISTINCT role_id, 'cash:expense' FROM role_permission "
        "WHERE permission_code = 'sale:create' "
        "ON CONFLICT DO NOTHING"
    )
    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT DISTINCT role_id, 'cash:take_out' FROM role_permission "
        "WHERE permission_code = 'report:view_financial' "
        "ON CONFLICT DO NOTHING"
    )
    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT DISTINCT role_id, 'cash:correct' FROM role_permission "
        "WHERE permission_code = 'report:view_financial' "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM cash_close)
                OR EXISTS (SELECT 1 FROM cash_movement)
                OR EXISTS (SELECT 1 FROM payment_correction)
                OR EXISTS (SELECT 1 FROM sale WHERE payment_method IS NOT NULL)
                OR EXISTS (SELECT 1 FROM credit_entry WHERE payment_method IS NOT NULL)
                OR EXISTS (SELECT 1 FROM refund WHERE payment_method IS NOT NULL)
            THEN
                RAISE EXCEPTION
                    'A drawer was closed, cash was moved or a way corrected, or a payment '
                    'was recorded with its way; 0034 cannot say how anything was paid. '
                    'Keep this revision.';
            END IF;
        END $$;
        """
    )
    op.execute(
        "DELETE FROM role_permission WHERE permission_code IN "
        "('cash:close', 'cash:expense', 'cash:take_out', 'cash:correct')"
    )

    for table in APPEND_ONLY:
        op.execute(f"DROP TRIGGER {table}_append_only ON {table}")
    for table in ("sale", "refund"):
        op.execute(f"DROP TRIGGER {table}_money_guard ON {table}")
    for trigger, table in (
        ("sale_drawer_period", "sale"),
        ("credit_entry_drawer_period", "credit_entry"),
        ("refund_drawer_period", "refund"),
        ("cash_movement_drawer_period", "cash_movement"),
        ("payment_correction_stamp", "payment_correction"),
    ):
        op.execute(f"DROP TRIGGER {trigger} ON {table}")
    for function in (
        "birka_guard_money_row()",
        "birka_stamp_correction()",
        "birka_stamp_movement()",
        "birka_stamp_refund()",
        "birka_stamp_credit_entry()",
        "birka_stamp_sale()",
        "birka_drawer_period(uuid)",
    ):
        op.execute(f"DROP FUNCTION {function}")

    op.drop_table("cash_message")
    op.drop_index("ix_payment_correction_explains_close_id", table_name="payment_correction")
    op.drop_index("ix_payment_correction_store_id_drawer_period", table_name="payment_correction")
    op.drop_table("payment_correction")
    op.drop_index("ix_cash_movement_for_close_id", table_name="cash_movement")
    op.drop_index("ix_cash_movement_store_id_drawer_period", table_name="cash_movement")
    op.drop_table("cash_movement")
    op.drop_table("cash_close_reason")
    op.drop_table("cash_close")

    op.drop_index("ix_refund_taken_at_store_id_drawer_period", table_name="refund")
    op.drop_index("ix_credit_entry_drawer_period", table_name="credit_entry")
    op.drop_index("ix_sale_store_id_drawer_period", table_name="sale")
    op.drop_constraint("only_a_payment_has_a_period", "credit_entry", type_="check")
    op.drop_constraint("only_a_payment_has_a_method", "credit_entry", type_="check")
    for table in ("sale", "credit_entry", "refund"):
        op.drop_constraint("drawer_period_positive", table, type_="check")
        op.drop_constraint("payment_method_known", table, type_="check")
        op.drop_column(table, "drawer_period")
        op.drop_column(table, "payment_method")
