"""Tenant-scoped catalog references for commands in other modules."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.modules.catalog.models import ProductFamily, ProductVariant, Size, SizeSystem


async def validate_stock_references(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    variant_ids: set[uuid.UUID],
    size_ids: set[uuid.UUID],
) -> None:
    """Unknown and foreign identifiers have the same non-disclosing outcome."""
    variants = set(
        (
            await session.scalars(
                select(ProductVariant.id)
                .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
                .where(
                    ProductVariant.id.in_(variant_ids),
                    ProductFamily.organization_id == organization_id,
                )
            )
        ).all()
    )
    if variants != variant_ids:
        raise NotFoundError("Unknown product variant")
    sizes = set(
        (
            await session.scalars(
                select(Size.id)
                .join(SizeSystem, SizeSystem.id == Size.size_system_id)
                .where(Size.id.in_(size_ids), SizeSystem.organization_id == organization_id)
            )
        ).all()
    )
    if sizes != size_ids:
        raise NotFoundError("Unknown size")
