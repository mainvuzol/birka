"""Store states: trading, blocked, archived. Owner decisions, 2026-10-01.

The owner decided (business-rules.md, "store states") that the owner of the
network blocks a store for a while, or archives one that stopped trading,
from the app and with a reason; that neither does anything but be read by the
owner and the network's managers; and that an archived store may be opened
again.

**`store.state`** replaces `store.is_active`. A store that was not active
becomes BLOCKED: nothing in the application could close one, so only an
operator did, and BLOCKED is the state that keeps every rule an inactive
store kept. ARCHIVED promises an empty store, which an old inactive one may
not be. **`store.state_since`** is when it last changed; NULL where unknown.

**`store_state_change`** — every change, its reason, who made it, and the
client's permanent `command_id`. Append-only, by the same trigger as the
stock ledger.

**`credit_entry.taken_at_store_id`** — the store that took a payment for a
store that was not trading. NULL for every other entry: nothing in this
append-only ledger is rewritten.

**Permissions:** `store:manage` to every role that manages people
(`user:manage`) — the owner's, by default. It is honoured network-wide only.

**Downgrade** refuses once any state was changed from the app, a store is
archived, or a payment was taken elsewhere: 0024 can say none of it.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0025_store_states"
down_revision: str | None = "0024_returns_elsewhere"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.add_column(
        "store", sa.Column("state", sa.String(length=10), nullable=False, server_default="ACTIVE")
    )
    op.add_column("store", sa.Column("state_since", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE store SET state = 'BLOCKED' WHERE NOT is_active")
    op.create_check_constraint("state_known", "store", "state IN ('ACTIVE', 'BLOCKED', 'ARCHIVED')")
    op.drop_column("store", "is_active")

    op.create_table(
        "store_state_change",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("store_id", uuid, nullable=False),
        sa.Column("from_state", sa.String(length=10), nullable=False),
        sa.Column("to_state", sa.String(length=10), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor_user_id", uuid, nullable=False),
        sa.Column("command_id", uuid, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_store_state_change"),
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_store_state_change_org_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["app_user.id"],
            name="fk_store_state_change_actor_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "from_state IN ('ACTIVE', 'BLOCKED', 'ARCHIVED') "
            "AND to_state IN ('ACTIVE', 'BLOCKED', 'ARCHIVED')",
            name="states_known",
        ),
        sa.CheckConstraint("from_state <> to_state", name="changes_something"),
        sa.CheckConstraint("char_length(btrim(reason)) > 0", name="says_why"),
        sa.UniqueConstraint(
            "organization_id", "command_id", name="uq_store_state_change_org_command"
        ),
    )
    op.create_index(
        "ix_store_state_change_store_id_created_at",
        "store_state_change",
        ["store_id", "created_at"],
    )
    # Append-only, as the stock ledger is: the function has existed since 0002.
    op.execute(
        "CREATE TRIGGER store_state_change_append_only "
        "BEFORE UPDATE OR DELETE ON store_state_change "
        "FOR EACH ROW EXECUTE FUNCTION birka_reject_mutation();"
    )

    op.add_column("credit_entry", sa.Column("taken_at_store_id", uuid, nullable=True))
    op.create_check_constraint(
        "only_a_payment_is_taken",
        "credit_entry",
        "taken_at_store_id IS NULL OR kind = 'PAYMENT'",
    )
    op.create_foreign_key(
        "fk_credit_entry_org_taken_at_store",
        "credit_entry",
        "store",
        ["organization_id", "taken_at_store_id"],
        ["organization_id", "id"],
        ondelete="RESTRICT",
    )

    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT DISTINCT role_id, 'store:manage' FROM role_permission "
        "WHERE permission_code = 'user:manage' "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM store_state_change)
                OR EXISTS (SELECT 1 FROM store WHERE state = 'ARCHIVED')
                OR EXISTS (SELECT 1 FROM credit_entry WHERE taken_at_store_id IS NOT NULL)
            THEN
                RAISE EXCEPTION
                    'A store state was changed from the app, a store is archived, or a '
                    'payment was taken for a store that was not trading; 0024 cannot '
                    'say so. Keep this revision.';
            END IF;
        END $$;
        """
    )
    op.execute("DELETE FROM role_permission WHERE permission_code = 'store:manage'")
    op.drop_constraint("fk_credit_entry_org_taken_at_store", "credit_entry", type_="foreignkey")
    op.drop_constraint("only_a_payment_is_taken", "credit_entry", type_="check")
    op.drop_column("credit_entry", "taken_at_store_id")

    op.execute("DROP TRIGGER IF EXISTS store_state_change_append_only ON store_state_change")
    op.drop_index("ix_store_state_change_store_id_created_at", table_name="store_state_change")
    op.drop_table("store_state_change")

    op.add_column(
        "store",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.execute("UPDATE store SET is_active = (state = 'ACTIVE')")
    op.drop_constraint("state_known", "store", type_="check")
    op.drop_column("store", "state_since")
    op.drop_column("store", "state")
