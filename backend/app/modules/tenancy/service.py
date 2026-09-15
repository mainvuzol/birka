"""Public tenant validation for stock and other business commands."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.modules.tenancy.models import Store


async def store_is_active(
    session: AsyncSession, *, organization_id: uuid.UUID, store_id: uuid.UUID
) -> bool:
    """Is this store open for business?

    A question, not an assertion: a caller that wants to say something specific
    about a closed store needs the answer, not `validate_active_stores`'
    deliberately uninformative "Unknown store".
    """
    return (
        await session.scalar(
            select(Store.id).where(
                Store.id == store_id,
                Store.organization_id == organization_id,
                Store.is_active.is_(True),
            )
        )
    ) is not None


async def validate_active_stores(
    session: AsyncSession, *, organization_id: uuid.UUID, store_ids: set[uuid.UUID]
) -> None:
    stores = set(
        (
            await session.scalars(
                select(Store.id).where(
                    Store.id.in_(store_ids),
                    Store.organization_id == organization_id,
                    Store.is_active.is_(True),
                )
            )
        ).all()
    )
    if stores != store_ids:
        raise NotFoundError("Unknown store")
