"""Shared ORM building blocks: primary keys, timestamps, enum helper."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

UTC_NOW = text("timezone('utc', now())")


class UUIDPrimaryKey:
    """Surrogate UUID primary key.

    Catalog identity in particular must never be derived from business
    attributes (ADR-0002), so every table gets an opaque id of its own.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )


class TimestampMixin:
    """Creation timestamp, always timezone-aware and stored in UTC."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=UTC_NOW
    )


class UpdatedAtMixin:
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=UTC_NOW, onupdate=UTC_NOW
    )


__all__ = ["UTC_NOW", "TimestampMixin", "UUIDPrimaryKey", "UpdatedAtMixin"]
