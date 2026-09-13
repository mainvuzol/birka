"""Roles, role permissions and memberships.

A membership answers: *which user, in which organization, in which store (or
organization-wide), with which role.* It is the only source of a request's
authority — never a value supplied by the client.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
)
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
        # Target for membership's composite foreign key.
        UniqueConstraint("organization_id", "id", name="uq_role_organization_id_id"),
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
    # Both store_id and role_id are bound to organization_id by the composite
    # foreign keys below rather than by a plain single-column reference.
    store_id: Mapped[uuid.UUID | None] = mapped_column(postgresql.UUID(as_uuid=True), nullable=True)
    role_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
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
        # Composite foreign keys, not two independent single-column ones: they
        # make it impossible for a membership in organization A to point at a
        # store or a role owned by organization B. With separate FKs the
        # database would happily accept that, and a single forgotten ownership
        # check in a future user-management endpoint would leak a whole store
        # across the tenant boundary.
        #
        # store_id is nullable; under MATCH SIMPLE a NULL there satisfies the
        # constraint, so organization-wide memberships still work.
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_membership_organization_id_store_id_store",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["organization_id", "role_id"],
            ["role.organization_id", "role.id"],
            name="fk_membership_organization_id_role_id_role",
            ondelete="RESTRICT",
        ),
        # resolve_scope queries this on every authenticated request.
        Index("ix_membership_user_id", "user_id"),
    )


__all__ = ["Membership", "Role", "RolePermission"]
