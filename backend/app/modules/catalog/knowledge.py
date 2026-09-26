"""Locks for confirming a match against a stable committed catalog revision."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.modules.catalog.models import CatalogKnowledgeRevision


async def lock_knowledge_revision(session: AsyncSession, organization_id: uuid.UUID) -> int:
    """Hold a SHARE lock through the caller's transaction; never commit here.

    Row existence is guaranteed by migration backfill and organization INSERT
    trigger. SHARE conflicts with trigger UPDATE (KEY SHARE would not). At READ
    COMMITTED, waiting for a writer returns its latest committed counter value.
    Call before a fresh preview/check, not after relying on a previous snapshot.
    Confirmation must remain read-only with respect to catalog identity rows.
    """
    value = await session.scalar(
        select(CatalogKnowledgeRevision.revision)
        .where(CatalogKnowledgeRevision.organization_id == organization_id)
        .with_for_update(read=True)
    )
    if value is None:
        raise NotFoundError("Catalog knowledge revision not found")
    return value
