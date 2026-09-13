"""Idempotency records and the claim/replay protocol.

Deliberately in `core`, not in a business module: this is transport-level
plumbing that every command endpoint uses, and it belongs beside correlation
ids rather than inside `sales` or `audit`.

**This is a cache, not an invariant.** It answers "what did we answer last
time?" for 7 days. The guarantee that a replayed command cannot create a second
business operation lives on the business rows themselves, as a permanent
`UNIQUE (organization_id, command_id)` (invariant I20). Deleting every row here
must never allow a duplicate sale — only a slower, re-executed one.

Concurrency is handled by the database rather than by application locking. The
claim is an INSERT inside the caller's transaction, so a second request with
the same key blocks on the unique index until the first transaction ends:

* first commits  -> second sees COMPLETED and replays the stored response;
* first rolls back -> the claim disappears and the second proceeds normally,
  which is what a client retrying after a failure should get.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, UniqueConstraint, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.errors import IdempotencyConflictError, IdempotencyInProgressError
from app.core.orm import TimestampMixin, UUIDPrimaryKey

RETENTION = timedelta(days=7)


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


def fingerprint(payload: Any, *, actor_user_id: uuid.UUID, store_id: uuid.UUID | None) -> str:
    """Stable hash of everything that makes this request *this* request.

    The actor and store are included deliberately: the same body submitted by a
    different seller, or against a different store, is a different command and
    must not silently replay someone else's response.
    """
    canonical = json.dumps(
        {
            "payload": payload,
            "actor": str(actor_user_id),
            "store": str(store_id) if store_id else None,
        },
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class Claim:
    """Proceed with the command; call `complete()` before committing."""

    record_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class Replay:
    """Do not execute. Return this stored response instead."""

    response: dict[str, Any]
    http_status: int


async def claim(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    endpoint: str,
    key: str,
    request_fingerprint: str,
    now: datetime | None = None,
) -> Claim | Replay:
    """Reserve the key, or report that this exact request already ran.

    Raises `IdempotencyConflictError` when the key was used with a different
    payload, and `IdempotencyInProgressError` when an identical request is
    still running.
    """
    moment = now or datetime.now(tz=UTC)

    statement = (
        pg_insert(IdempotencyRecord)
        .values(
            organization_id=organization_id,
            endpoint=endpoint,
            key=key,
            request_fingerprint=request_fingerprint,
            status=IdempotencyStatus.IN_PROGRESS,
            expires_at=moment + RETENTION,
        )
        .on_conflict_do_nothing(index_elements=["organization_id", "endpoint", "key"])
        .returning(IdempotencyRecord.id)
    )
    claimed = (await session.execute(statement)).scalar_one_or_none()
    if claimed is not None:
        return Claim(record_id=claimed)

    existing = (
        await session.execute(
            select(IdempotencyRecord).where(
                IdempotencyRecord.organization_id == organization_id,
                IdempotencyRecord.endpoint == endpoint,
                IdempotencyRecord.key == key,
            )
        )
    ).scalar_one()

    if existing.request_fingerprint != request_fingerprint:
        # Same key, different request. Never execute: the client either reused
        # a key by mistake or changed the payload mid-retry, and guessing which
        # would risk performing an operation nobody asked for.
        raise IdempotencyConflictError(endpoint=endpoint)

    if existing.status is IdempotencyStatus.COMPLETED:
        return Replay(
            response=existing.response_snapshot or {},
            http_status=existing.http_status or 200,
        )

    raise IdempotencyInProgressError(endpoint=endpoint)


async def complete(
    session: AsyncSession,
    record_id: uuid.UUID,
    *,
    response: dict[str, Any],
    http_status: int,
) -> None:
    """Store the response so a retry can be answered without re-executing.

    Called inside the command's transaction: if the command rolls back, the
    claim rolls back with it and the key is free again.
    """
    record = await session.get(IdempotencyRecord, record_id)
    if record is None:  # pragma: no cover - only reachable if the claim vanished
        raise RuntimeError("idempotency record disappeared before completion")
    record.status = IdempotencyStatus.COMPLETED
    record.response_snapshot = response
    record.http_status = http_status


__all__ = [
    "RETENTION",
    "Claim",
    "IdempotencyRecord",
    "IdempotencyStatus",
    "Replay",
    "claim",
    "complete",
    "fingerprint",
]
