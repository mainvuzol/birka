"""The owner hears about the server's backups. M1-028.

The owner decided on 2026-09-30 that "a failed backup or drill is shown to the
owner in the app, in a «Резервні копії» section only the owner sees, and sent
by the bot in Telegram" (business-rules.md, "backups").

**`backup_run`** — one row for each night `scripts.nightly_backup` ran: when,
whether it held, the archive and its size, the drill, and the failed steps. A
night is `ok` exactly when it has no problems; the database holds that. A
night that never ran leaves no row, which is how the watcher knows a backup
is overdue.

**`backup_alert`** — one row for each message to each owner, written before
it is sent, unique by what it is about and to whom. That is what stops the
same news going out twice, and what shows an owner in the app when Telegram
cannot reach them.

Neither table has an `organization_id`: a backup is of the whole server, and
neither holds any organization's data.

**`backup:view`** is granted to every existing system `OWNER` role, as it is
now granted to a new organization's owner by default. Without it the owner's
section would exist and nobody could open it. Roles an owner composed are left
as they are.

**Downgrade** drops both tables and every `backup:view` grant: the permission
does not exist before this revision. The backups themselves are files, and
are untouched.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018_backup_alerts"
down_revision: str | None = "0017_stock_adjustment"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Check constraint names are short: the naming convention on the
    # metadata makes them `ck_<table>_<name>`, as in the models.
    op.create_table(
        "backup_run",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("archive", sa.String(length=200), nullable=True),
        sa.Column("archive_bytes", sa.BigInteger(), nullable=True),
        sa.Column("drill_ok", sa.Boolean(), nullable=True),
        sa.Column("restore_seconds", sa.Float(), nullable=True),
        sa.Column(
            "problems",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_backup_run"),
        sa.CheckConstraint("finished_at >= started_at", name="finished_after_start"),
        sa.CheckConstraint(
            "jsonb_typeof(problems) = 'array' AND ok = (jsonb_array_length(problems) = 0)",
            name="ok_means_no_problems",
        ),
    )
    op.create_index("ix_backup_run_finished_at", "backup_run", ["finished_at"])

    op.create_table(
        "backup_alert",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="PENDING"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=300), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_backup_alert"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["app_user.id"],
            name="fk_backup_alert_user_id_app_user",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("key", "user_id", name="uq_backup_alert_key_user_id"),
        sa.CheckConstraint(
            "kind IN ('FAILED', 'OVERDUE', 'NOT_SET_UP', 'RECOVERED')",
            name="kind_known",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'SENT', 'REFUSED', 'FAILED')",
            name="status_known",
        ),
        sa.CheckConstraint("(status = 'SENT') = (sent_at IS NOT NULL)", name="sent_has_time"),
        sa.CheckConstraint("attempts >= 0", name="attempts_not_negative"),
    )
    op.create_index("ix_backup_alert_user_id_created_at", "backup_alert", ["user_id", "created_at"])

    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT id, 'backup:view' FROM role WHERE code = 'OWNER' AND is_system "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DELETE FROM role_permission WHERE permission_code = 'backup:view'")
    op.drop_index("ix_backup_alert_user_id_created_at", table_name="backup_alert")
    op.drop_table("backup_alert")
    op.drop_index("ix_backup_run_finished_at", table_name="backup_run")
    op.drop_table("backup_run")
