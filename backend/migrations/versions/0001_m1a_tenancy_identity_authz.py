"""M1A: tenancy, identity and authorization

Creates the six gate-M1A tables: organization, store, app_user, role,
role_permission, membership.

Two unique constraints use PostgreSQL's UNIQUE NULLS NOT DISTINCT (ADR-0002).
This is NOT a stylistic choice and must not be "simplified" away: without it,
PostgreSQL treats every NULL as distinct, so a system role (organization_id IS
NULL) or an organization-wide membership (store_id IS NULL) could be inserted
twice and the constraint would silently permit it. Requires PostgreSQL >= 15.

Revision ID: 0001_m1a
Revises:
Create Date: 2026-09-12

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_m1a"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# now() is timestamptz; timezone('utc', now()) would be naive (see app/core/orm.py).
UTC_NOW = sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "organization",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("currency_code", sa.String(length=3), server_default="UAH", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=UTC_NOW, nullable=False),
        sa.CheckConstraint(
            "char_length(currency_code) = 3", name="ck_organization_currency_code_iso4217"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_organization"),
    )

    op.create_table(
        "store",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("PRIMARY", "SECONDARY", name="store_kind"),
            nullable=False,
        ),
        sa.Column("timezone", sa.String(length=64), server_default="Europe/Kyiv", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=UTC_NOW, nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            name="fk_store_organization_id_organization",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_store"),
        sa.UniqueConstraint("organization_id", "code", name="uq_store_org_code"),
        sa.UniqueConstraint("organization_id", "id", name="uq_store_organization_id_id"),
    )

    op.create_table(
        "app_user",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("telegram_user_id", sa.BigInteger(), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column("language_code", sa.String(length=16), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=UTC_NOW, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_app_user"),
        sa.UniqueConstraint("telegram_user_id", name="uq_app_user_telegram_user_id"),
    )

    op.create_table(
        "role",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("is_system", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=UTC_NOW, nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            name="fk_role_organization_id_organization",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_role"),
        sa.UniqueConstraint(
            "organization_id",
            "code",
            name="uq_role_organization_id_code",
            postgresql_nulls_not_distinct=True,
        ),
        sa.UniqueConstraint("organization_id", "id", name="uq_role_organization_id_id"),
    )

    op.create_table(
        "role_permission",
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("permission_code", sa.String(length=60), nullable=False),
        sa.ForeignKeyConstraint(
            ["role_id"], ["role.id"], name="fk_role_permission_role_id_role", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("role_id", "permission_code", name="pk_role_permission"),
    )

    op.create_table(
        "membership",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("store_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=UTC_NOW, nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            name="fk_membership_organization_id_organization",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["app_user.id"], name="fk_membership_user_id_app_user", ondelete="CASCADE"
        ),
        # Composite: a membership cannot reference a store or a role owned by a
        # different organization. See app/modules/authz/models.py for why.
        sa.ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_membership_organization_id_store_id_store",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "role_id"],
            ["role.organization_id", "role.id"],
            name="fk_membership_organization_id_role_id_role",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_membership"),
        sa.UniqueConstraint(
            "user_id",
            "organization_id",
            "store_id",
            name="uq_membership_user_id_organization_id_store_id",
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_index("ix_membership_user_id", "membership", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_membership_user_id", table_name="membership")
    op.drop_table("membership")
    op.drop_table("role_permission")
    op.drop_table("role")
    op.drop_table("app_user")
    op.drop_table("store")
    op.drop_table("organization")
    # Enum types are not dropped by drop_table and would block a re-upgrade.
    sa.Enum(name="store_kind").drop(op.get_bind(), checkfirst=True)
