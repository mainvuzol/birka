"""Trouble on the server, kept. Owner decision, 2026-10-03.

The owner decided (business-rules.md, "failures are visible") that trouble on
the server — the app not answering, its database stopped, the disk nearly
full, nobody able to sign in — is told by the bot once when it starts, once a
day while it lasts and once when it works again, and is shown in the
«Резервні копії» section as the backups are. `scripts.backup_watch` looks
every minute.

**`server_incident`** — one row for each trouble, from when it began to when
it worked again: its kind, the sentence the bot used, when the start reached
someone, how many daily reminders were told. At most one of each kind is
open at a time (a unique index on `kind` where `ended_at IS NULL`), so a
watcher that restarts finds the trouble it already told about rather than
telling it again.

**`server_watch`** — one row: when the watcher last completed a look, so the
owner can tell a watcher that stopped from a server with nothing wrong.

Neither table has an `organization_id`: they describe the server, and hold no
organization's data. Both start empty.

**Downgrade** drops both tables. What they held was told already; the
watcher of the previous code does not look at the server.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0034_server_incidents"
down_revision: str | None = "0033_session_epoch"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Check constraint names are short: the naming convention on the
    # metadata makes them `ck_<table>_<name>`, as in the models.
    op.create_table(
        "server_incident",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("told_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reminders", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_server_incident"),
        sa.CheckConstraint(
            "kind IN ('NOT_ANSWERING', 'DISK_LOW', 'SIGN_IN_FAILING')",
            name="kind_known",
        ),
        sa.CheckConstraint("ended_at IS NULL OR ended_at >= started_at", name="ends_after_start"),
        sa.CheckConstraint("reminders >= 0", name="reminders_not_negative"),
    )
    op.create_index(
        "uq_server_incident_open_kind",
        "server_incident",
        ["kind"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.create_index("ix_server_incident_ended_at", "server_incident", ["ended_at"])

    op.create_table(
        "server_watch",
        sa.Column("id", sa.SmallInteger(), autoincrement=False, nullable=False),
        sa.Column("looked_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_server_watch"),
        sa.CheckConstraint("id = 1", name="one_row"),
    )


def downgrade() -> None:
    op.drop_table("server_watch")
    op.drop_index("ix_server_incident_ended_at", table_name="server_incident")
    op.drop_index("uq_server_incident_open_kind", table_name="server_incident")
    op.drop_table("server_incident")
