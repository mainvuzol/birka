"""Public tenant validation for stock and other business commands."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.modules.tenancy.models import Store


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
