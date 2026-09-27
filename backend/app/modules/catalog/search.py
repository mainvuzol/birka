"""Read-only, permission-scoped family discovery for manual product intake."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.errors import ValidationFailedError
from app.core.text import is_storable
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.models import (
    BusinessCategory,
    CanonicalConcept,
    EntityStatus,
    GarmentType,
    ProductFamily,
    SourceIdentity,
)
from app.modules.tenancy.service import validate_active_stores


def _literal_pattern(value: str) -> str:
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


async def search_families(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    query: str = "",
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """Browse real families, including those with no variants or stock.

    Names use their casefolded catalog keys. Free-form distinction notes use
    PostgreSQL case-insensitive lower matching; neither path interprets LIKE
    wildcards supplied by the user. This is discovery, never identity matching.
    """
    scope.require(Permission.CATALOG_CREATE, store_id)
    scope.require(Permission.CATALOG_CONFIRM, store_id)
    if not 1 <= limit <= 50 or not 0 <= offset <= 10000:
        raise ValidationFailedError("Invalid family search pagination")
    if len(query) > 200 or not is_storable(query):
        raise ValidationFailedError("Search text must contain at most 200 valid characters")
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={store_id}
    )
    family_garment = aliased(GarmentType)
    concept_garment = aliased(GarmentType)
    statement = (
        select(
            ProductFamily.id.label("family_id"),
            CanonicalConcept.name.label("concept_name"),
            SourceIdentity.name.label("source_name"),
            BusinessCategory.name.label("business_category_name"),
            func.coalesce(family_garment.name, concept_garment.name).label("garment_type_name"),
            ProductFamily.distinction_note,
        )
        .join(CanonicalConcept, CanonicalConcept.id == ProductFamily.canonical_concept_id)
        .outerjoin(SourceIdentity, SourceIdentity.id == ProductFamily.source_identity_id)
        .outerjoin(BusinessCategory, BusinessCategory.id == CanonicalConcept.business_category_id)
        .outerjoin(family_garment, family_garment.id == ProductFamily.garment_type_id)
        .outerjoin(concept_garment, concept_garment.id == CanonicalConcept.garment_type_id)
        .where(
            ProductFamily.organization_id == scope.organization_id,
            ProductFamily.status == EntityStatus.ACTIVE,
            CanonicalConcept.organization_id == scope.organization_id,
            CanonicalConcept.status == EntityStatus.ACTIVE,
            or_(
                ProductFamily.source_identity_id.is_(None),
                SourceIdentity.organization_id == scope.organization_id,
            ),
            or_(
                CanonicalConcept.business_category_id.is_(None),
                BusinessCategory.organization_id == scope.organization_id,
            ),
            or_(
                ProductFamily.garment_type_id.is_(None),
                family_garment.organization_id == scope.organization_id,
            ),
            or_(
                CanonicalConcept.garment_type_id.is_(None),
                concept_garment.organization_id == scope.organization_id,
            ),
        )
    )
    normalized = " ".join(query.split())
    if normalized:
        name_pattern = _literal_pattern(normalized.casefold())
        statement = statement.where(
            or_(
                CanonicalConcept.normalized_name.like(name_pattern, escape="\\"),
                SourceIdentity.normalized_name.like(name_pattern, escape="\\"),
                func.lower(ProductFamily.distinction_note).like(
                    _literal_pattern(normalized.lower()), escape="\\"
                ),
            )
        )
    rows = (
        (
            await session.execute(
                statement.order_by(CanonicalConcept.normalized_name, ProductFamily.id)
                .limit(limit + 1)
                .offset(offset)
            )
        )
        .mappings()
        .all()
    )
    return {"items": [dict(row) for row in rows[:limit]], "has_more": len(rows) > limit}
