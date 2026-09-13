"""Organization and Store.

The tenant boundary. A user never supplies an organization or store id that the
server trusts: scope is derived from the authenticated session and the user's
memberships (invariant I12).
"""

from __future__ import annotations

import uuid
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Enum,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class StoreKind(StrEnum):
    """Label only — it carries no behaviour (assumption A4)."""

    PRIMARY = "PRIMARY"
    SECONDARY = "SECONDARY"


class Organization(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "organization"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False, server_default="UAH")

    __table_args__ = (
        CheckConstraint("char_length(currency_code) = 3", name="currency_code_iso4217"),
    )


class Store(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "store"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    kind: Mapped[StoreKind] = mapped_column(
        Enum(StoreKind, name="store_kind", native_enum=True), nullable=False
    )
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, server_default="Europe/Kyiv")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    __table_args__ = (
        UniqueConstraint("organization_id", "code", name="uq_store_org_code"),
        # Target for membership's composite foreign key: a membership may only
        # reference a store belonging to its own organization (invariant I12).
        UniqueConstraint("organization_id", "id", name="uq_store_organization_id_id"),
    )


__all__ = ["Organization", "Store", "StoreKind"]
