"""Idempotency records.

Deliberately in `core`, not in a business module: this is transport-level
plumbing that every command endpoint uses, and it belongs beside correlation
ids rather than inside `sales` or `audit`.

**This is a cache, not an invariant.** It answers "what did we answer last
time?" for 7 days. The guarantee that a replayed command cannot create a second
business operation lives on the business rows themselves, as a permanent
`UNIQUE (organization_id, command_id)` (invariant I20). Deleting every row here
must never allow a duplicate sale — only a slower, re-executed one.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class IdempotencyStatus(StrEnum):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


class IdempotencyRecord(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "idempotency_record"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Namespaced by tenant AND operation: the same key used against two
    # different endpoints is two unrelated records, by construction.
    endpoint: Mapped[str] = mapped_column(String(120), nullable=False)
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    # sha256 of the canonical payload + actor + store. Same key with a
    # different fingerprint is a client bug, not a retry, and is refused.
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[IdempotencyStatus] = mapped_column(
        Enum(IdempotencyStatus, name="idempotency_status", native_enum=True),
        nullable=False,
        server_default=IdempotencyStatus.IN_PROGRESS.value,
    )
    response_snapshot: Mapped[dict[str, Any] | None] = mapped_column(
        postgresql.JSONB, nullable=True
    )
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "endpoint", "key", name="uq_idempotency_org_endpoint_key"
        ),
        Index("ix_idempotency_expires_at", "expires_at"),
    )


__all__ = ["IdempotencyRecord", "IdempotencyStatus"]
