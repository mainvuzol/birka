"""Audit log.

APPEND-ONLY. Records who did what, to which entity, with what before/after
state and why. Written inside the same transaction as the change it describes,
so an audited operation cannot half-happen.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class AuditLog(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "audit_log"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )
    before: Mapped[dict[str, Any] | None] = mapped_column(postgresql.JSONB, nullable=True)
    after: Mapped[dict[str, Any] | None] = mapped_column(postgresql.JSONB, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        Index("ix_audit_log_org_created", "organization_id", "created_at"),
        Index("ix_audit_log_entity", "entity_type", "entity_id"),
    )


__all__ = ["AuditLog"]
