"""Writing audit entries.

Always called inside the transaction of the change it describes. An audit row
that commits separately from the thing it audits is worse than none: it either
records something that did not happen, or misses something that did.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.correlation import get_correlation_id
from app.modules.audit.models import AuditLog


async def record(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
) -> AuditLog:
    """Append one audit entry.

    `before` and `after` are the point of the row: "stock was 0, is now 2" is
    what makes a correction reviewable months later, when nobody remembers it.
    """
    entry = AuditLog(
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before,
        after=after,
        reason=reason,
        correlation_id=get_correlation_id(),
    )
    session.add(entry)
    await session.flush()
    return entry


__all__ = ["record"]
