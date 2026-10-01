"""Organization and Store.

The tenant boundary. A user never supplies an organization or store id that the
server trusts: scope is derived from the authenticated session and the user's
memberships (invariant I12).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class StoreKind(StrEnum):
    """Label only — it carries no behaviour (assumption A4)."""

    PRIMARY = "PRIMARY"
    SECONDARY = "SECONDARY"


class StoreState(StrEnum):
    """Whether a store trades (owner decisions, 2026-10-01).

    Only a trading store does anything. A blocked or archived one is read by
    the owner and the network's managers and changed by nobody; its people
    see only that it is blocked or archived, and since when.
    """

    ACTIVE = "ACTIVE"
    # Stopped for now by the owner, and started again by the owner.
    BLOCKED = "BLOCKED"
    # Closed: it stopped trading. Only an empty store is archived, and the
    # owner may open it again.
    ARCHIVED = "ARCHIVED"


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
    state: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=StoreState.ACTIVE.value
    )
    # When the state last changed; NULL for a store that has always traded.
    state_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("state IN ('ACTIVE', 'BLOCKED', 'ARCHIVED')", name="state_known"),
        UniqueConstraint("organization_id", "code", name="uq_store_org_code"),
        # Target for membership's composite foreign key: a membership may only
        # reference a store belonging to its own organization (invariant I12).
        UniqueConstraint("organization_id", "id", name="uq_store_organization_id_id"),
    )


class StockLocation(UUIDPrimaryKey, TimestampMixin, Base):
    """A physical place, independent of selling store and goods ownership."""

    __tablename__ = "stock_location"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    # Explicit private-location control, not ownership of the goods. NULL
    # preserves shared/legacy access. Never inferred from store kind or name.
    managing_store_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "code", name="uq_stock_location_org_code"),
        UniqueConstraint("organization_id", "id", name="uq_stock_location_organization_id_id"),
        ForeignKeyConstraint(
            ["organization_id", "managing_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_stock_location_org_managing_store",
            ondelete="RESTRICT",
        ),
    )


class StoreLocationAccess(UUIDPrimaryKey, TimestampMixin, Base):
    """Explicit store access; no flag defaults may silently grant a capability.

    This additive foundation is not yet used by stock services. Both foreign
    keys bind the endpoints to the same organization even for direct SQL.
    """

    __tablename__ = "store_location_access"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    location_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    can_sell: Mapped[bool] = mapped_column(Boolean, nullable=False)
    can_receive: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # This is the store's «Брак»: where a unit returned damaged at this store
    # goes (owner decision, 2026-10-01). Every store has its own, because a
    # damaged coat stays where it was handed back. Nothing sells from it, so
    # the store may receive there and never sell.
    damaged_returns: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    __table_args__ = (
        UniqueConstraint("store_id", "location_id", name="uq_store_location_access_store_location"),
        CheckConstraint(
            "NOT damaged_returns OR (can_receive AND NOT can_sell)",
            name="damaged_returns_are_not_sold",
        ),
        # One «Брак» per store: a return must never have to choose.
        Index(
            "uq_store_location_access_damaged_returns",
            "store_id",
            unique=True,
            postgresql_where=text("damaged_returns"),
        ),
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_store_location_access_org_store",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_store_location_access_org_location",
            ondelete="RESTRICT",
        ),
    )


class StoreStateChange(UUIDPrimaryKey, TimestampMixin, Base):
    """Every change of a store's state, with the owner's reason. Append-only.

    Named by the client's permanent `command_id`, as a sale is: the same
    command is answered with what it did, however late it is retried, and
    never blocks a store twice after it was unblocked in between.
    """

    __tablename__ = "store_state_change"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    from_state: Mapped[str] = mapped_column(String(10), nullable=False)
    to_state: Mapped[str] = mapped_column(String(10), nullable=False)
    # Seen by the owner and whoever reads the store's history, never by its
    # sellers (owner decision, 2026-10-01).
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    command_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_store_state_change_org_store",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "from_state IN ('ACTIVE', 'BLOCKED', 'ARCHIVED') "
            "AND to_state IN ('ACTIVE', 'BLOCKED', 'ARCHIVED')",
            name="states_known",
        ),
        CheckConstraint("from_state <> to_state", name="changes_something"),
        CheckConstraint("char_length(btrim(reason)) > 0", name="says_why"),
        UniqueConstraint("organization_id", "command_id", name="uq_store_state_change_org_command"),
        Index("ix_store_state_change_store_id_created_at", "store_id", "created_at"),
    )


__all__ = [
    "Organization",
    "StockLocation",
    "Store",
    "StoreKind",
    "StoreLocationAccess",
    "StoreState",
    "StoreStateChange",
]
