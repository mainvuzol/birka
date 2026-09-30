"""What the owner is told about the server's backups.

The nightly job (`scripts.nightly_backup`) records every night it ran in
`backup_run`. The watcher (`scripts.backup_watch`) reads them, decides what
the owner must hear, and records each message to each owner in
`backup_alert` before sending it, so a message is sent once however often
the watcher looks, and one Telegram cannot deliver stays visible in the app.

Both tables describe the server, not a shop: a backup is of the whole
database. Neither holds any organization's data — no row counts, no names —
so they carry no `organization_id`.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class AlertKind(StrEnum):
    FAILED = "FAILED"
    OVERDUE = "OVERDUE"
    NOT_SET_UP = "NOT_SET_UP"
    RECOVERED = "RECOVERED"


class AlertStatus(StrEnum):
    PENDING = "PENDING"
    SENT = "SENT"
    # Telegram refused this person's chat for good: they never started the
    # bot, or blocked it. Only they can fix it, so the app tells them how.
    REFUSED = "REFUSED"
    # Tried `MAX_ATTEMPTS` times and never got through.
    FAILED = "FAILED"


class BackupRun(UUIDPrimaryKey, TimestampMixin, Base):
    """One night of `scripts.nightly_backup`, as it ended.

    `problems` is the night's own list: `{"step", "detail"}` for each step
    that failed — `backup`, `drill` (with the failed `checks`), `encrypt` or
    `key`. A night is `ok` exactly when the list is empty.
    """

    __tablename__ = "backup_run"

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # The file the owner's computer collects: `birka-<time>.dump.age`, or the
    # plaintext `.dump` when encryption did not happen.
    archive: Mapped[str | None] = mapped_column(String(200), nullable=True)
    archive_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # NULL when there was nothing to drill.
    drill_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    restore_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    problems: Mapped[list[dict[str, Any]]] = mapped_column(
        postgresql.JSONB, nullable=False, server_default="[]"
    )

    __table_args__ = (
        CheckConstraint("finished_at >= started_at", name="finished_after_start"),
        CheckConstraint(
            "jsonb_typeof(problems) = 'array' AND ok = (jsonb_array_length(problems) = 0)",
            name="ok_means_no_problems",
        ),
        Index("ix_backup_run_finished_at", "finished_at"),
    )


class BackupAlert(UUIDPrimaryKey, TimestampMixin, Base):
    """One message to one owner, written before it is sent.

    `key` names what the message is about — a failed night, the Nth day a
    night is overdue — so the same news is never queued twice for the same
    person, however many times the watcher looks.
    """

    __tablename__ = "backup_alert"

    key: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=AlertStatus.PENDING.value
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("key", "user_id", name="uq_backup_alert_key_user_id"),
        CheckConstraint(
            "kind IN ('FAILED', 'OVERDUE', 'NOT_SET_UP', 'RECOVERED')", name="kind_known"
        ),
        CheckConstraint("status IN ('PENDING', 'SENT', 'REFUSED', 'FAILED')", name="status_known"),
        CheckConstraint("(status = 'SENT') = (sent_at IS NOT NULL)", name="sent_has_time"),
        CheckConstraint("attempts >= 0", name="attempts_not_negative"),
        Index("ix_backup_alert_user_id_created_at", "user_id", "created_at"),
    )


__all__ = ["AlertKind", "AlertStatus", "BackupAlert", "BackupRun"]
