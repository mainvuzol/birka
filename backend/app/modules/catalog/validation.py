"""Tenant-scoped catalog references for commands in other modules."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    BusinessCategory,
    CanonicalConcept,
    EntityStatus,
    GarmentType,
    ProductFamily,
    ProductVariant,
    Size,
    SizeSystem,
    SourceIdentity,
)


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


_TERM_COLUMNS = {
    AttributeKind.COLOR: "color_term_id",
    AttributeKind.MATERIAL: "material_term_id",
    AttributeKind.TEXTURE: "texture_term_id",
    AttributeKind.FUR: "fur_term_id",
    AttributeKind.COLLAR: "collar_term_id",
}


async def require_active_variants(
    session: AsyncSession, *, organization_id: uuid.UUID, variant_ids: set[uuid.UUID]
) -> None:
    """Every variant is active, and so is the identity chain it hangs from.

    For a command outside catalog that a person points at existing products —
    a legacy list line resolved by hand (M1-023). Single-column foreign keys do
    not bind a catalog row to its organization, so each link of the chain is
    checked here, as `catalog.decisions` does for one confirmed proposal:
    variant, family and concept active and in this organization; its source,
    garment types and business category in this organization; its attribute
    terms active, of the right kind, in this organization.

    Unknown, foreign and inactive variants have the same outcome, which names
    nothing: an answer must not confirm that another shop has a product. Plain
    column queries only, so nothing cached in the session can hide a change.
    """
    if not variant_ids:
        return
    rows = (
        await session.execute(
            select(
                ProductVariant.id,
                ProductFamily.source_identity_id,
                ProductFamily.garment_type_id,
                CanonicalConcept.garment_type_id,
                CanonicalConcept.business_category_id,
                *(getattr(ProductVariant, column) for column in _TERM_COLUMNS.values()),
            )
            .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
            .join(CanonicalConcept, CanonicalConcept.id == ProductFamily.canonical_concept_id)
            .where(
                ProductVariant.id.in_(variant_ids),
                ProductVariant.status == EntityStatus.ACTIVE,
                ProductFamily.organization_id == organization_id,
                ProductFamily.status == EntityStatus.ACTIVE,
                CanonicalConcept.organization_id == organization_id,
                CanonicalConcept.status == EntityStatus.ACTIVE,
            )
        )
    ).all()
    if {row[0] for row in rows} != variant_ids:
        raise NotFoundError("Unknown active catalog variant")

    linked: dict[type[SourceIdentity | GarmentType | BusinessCategory], set[uuid.UUID]] = {
        SourceIdentity: {row[1] for row in rows if row[1] is not None},
        GarmentType: {row[i] for row in rows for i in (2, 3) if row[i] is not None},
        BusinessCategory: {row[4] for row in rows if row[4] is not None},
    }
    for model, identifiers in linked.items():
        if not identifiers:
            continue
        found = set(
            (
                await session.scalars(
                    select(model.id).where(
                        model.id.in_(identifiers), model.organization_id == organization_id
                    )
                )
            ).all()
        )
        if found != identifiers:
            raise NotFoundError("Unknown active catalog variant")

    terms = {
        (kind, row[5 + index])
        for row in rows
        for index, kind in enumerate(_TERM_COLUMNS)
        if row[5 + index] is not None
    }
    if terms:
        found_terms = set(
            (
                await session.execute(
                    select(AttributeTerm.kind, AttributeTerm.id).where(
                        AttributeTerm.id.in_({term_id for _, term_id in terms}),
                        AttributeTerm.organization_id == organization_id,
                        AttributeTerm.status == EntityStatus.ACTIVE,
                    )
                )
            )
            .tuples()
            .all()
        )
        if not terms <= found_terms:
            raise NotFoundError("Unknown active catalog variant")
