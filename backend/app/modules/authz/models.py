"""Roles, role permissions and memberships.

A membership answers: *which user, in which organization, in which store (or
organization-wide), with which role.* It is the only source of a request's
authority — never a value supplied by the client.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class Role(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "role"

    # NULL organization_id = a system role template shared by every tenant.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=True,
    )
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    __table_args__ = (
        # NULLS NOT DISTINCT: a system role (organization_id IS NULL) must be
        # unique by code too. Without it PostgreSQL treats every NULL as
        # distinct and the constraint silently allows duplicates (ADR-0002).
        UniqueConstraint(
            "organization_id",
            "code",
            name="uq_role_organization_id_code",
            postgresql_nulls_not_distinct=True,
        ),
    )


class RolePermission(Base):
    """Role → permission code. The code is validated against `Permission`."""

    __tablename__ = "role_permission"

    role_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("role.id", ondelete="CASCADE"), primary_key=True
    )
    permission_code: Mapped[str] = mapped_column(String(60), primary_key=True)


class Membership(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "membership"

    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    # NULL store_id = the membership applies to every store in the organization.
    store_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("store.id", ondelete="CASCADE"), nullable=True
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("role.id", ondelete="RESTRICT"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    __table_args__ = (
        # Same reasoning as Role: an organization-wide membership has a NULL
        # store_id and must still be unique per user.
        UniqueConstraint(
            "user_id",
            "organization_id",
            "store_id",
            name="uq_membership_user_id_organization_id_store_id",
            postgresql_nulls_not_distinct=True,
        ),
    )


__all__ = ["Membership", "Role", "RolePermission"]
