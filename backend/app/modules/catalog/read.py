"""Read-only catalog views for other modules.

`sales` needs to know what a variant is called at the moment of sale so the
receipt can freeze it. It must not reach into catalog tables itself — this is
the narrow, read-only surface it goes through instead.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.models import (
    AttributeTerm,
    BusinessCategory,
    CanonicalConcept,
    GarmentType,
    ProductFamily,
    ProductVariant,
    Size,
    SourceIdentity,
)


@dataclass(frozen=True, slots=True)
class VariantDescription:
    """Everything a sale line needs to freeze about a product."""

    product_variant_id: uuid.UUID
    organization_id: uuid.UUID
    display_name: str
    snapshot: dict[str, Any]


async def describe_variants(
    session: AsyncSession, variant_ids: list[uuid.UUID]
) -> dict[uuid.UUID, VariantDescription]:
    """Build the display name and snapshot for each variant, in one query.

    The name is assembled from the shop's own words — concept, source, colour,
    material, texture, fur, collar and length — the seller’s words on a receipt.
    Anything missing is simply left out rather than filled with a placeholder.
    """
    if not variant_ids:
        return {}

    terms = {
        "colour": ProductVariant.color_term_id,
        "material": ProductVariant.material_term_id,
        "texture": ProductVariant.texture_term_id,
        "fur": ProductVariant.fur_term_id,
        "collar": ProductVariant.collar_term_id,
    }
    aliases = {name: AttributeTerm.__table__.alias(name) for name in terms}
    family_garment = GarmentType.__table__.alias("family_garment")
    concept_garment = GarmentType.__table__.alias("concept_garment")
    statement = (
        select(
            ProductVariant.id,
            ProductVariant.length_cm,
            ProductVariant.attributes,
            ProductFamily.organization_id,
            ProductFamily.id.label("family_id"),
            ProductFamily.distinction_note,
            CanonicalConcept.id.label("concept_id"),
            CanonicalConcept.name.label("concept_name"),
            SourceIdentity.id.label("source_id"),
            SourceIdentity.name.label("source_name"),
            SourceIdentity.semantic_type.label("source_semantic_type"),
            BusinessCategory.id.label("business_category_id"),
            BusinessCategory.name.label("business_category_name"),
            family_garment.c.id.label("family_garment_type_id"),
            family_garment.c.name.label("family_garment_type_name"),
            concept_garment.c.id.label("concept_garment_type_id"),
            concept_garment.c.name.label("concept_garment_type_name"),
            *(alias.c.id.label(f"{name}_id") for name, alias in aliases.items()),
            *(alias.c.name.label(f"{name}_name") for name, alias in aliases.items()),
        )
        .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
        .join(CanonicalConcept, CanonicalConcept.id == ProductFamily.canonical_concept_id)
        .outerjoin(SourceIdentity, SourceIdentity.id == ProductFamily.source_identity_id)
        .outerjoin(BusinessCategory, BusinessCategory.id == CanonicalConcept.business_category_id)
        .outerjoin(family_garment, family_garment.c.id == ProductFamily.garment_type_id)
        .outerjoin(concept_garment, concept_garment.c.id == CanonicalConcept.garment_type_id)
        .where(ProductVariant.id.in_(variant_ids))
    )
    for name, column in terms.items():
        statement = statement.outerjoin(aliases[name], aliases[name].c.id == column)

    described: dict[uuid.UUID, VariantDescription] = {}
    for row in (await session.execute(statement)).mappings():
        parts = [row["concept_name"], row["source_name"]]
        parts.extend(row[f"{name}_name"] for name in terms)
        if row["length_cm"] is not None:
            parts.append(f"{row['length_cm']:g} см")
        display_name = " ".join(str(part) for part in parts if part)

        # Freeze every identity label beside its ID. Keep family and concept
        # garment classifications separate: missing evidence stays missing.
        snapshot: dict[str, Any] = {
            "product_variant_id": str(row["id"]),
            "product_family_id": str(row["family_id"]),
            "canonical_concept_id": str(row["concept_id"]),
            "concept": row["concept_name"],
            "family_distinction_note": row["distinction_note"],
            "source": row["source_name"],
            "source_semantic_type": row["source_semantic_type"],
            "length_cm": float(row["length_cm"]) if row["length_cm"] is not None else None,
            "attributes": row["attributes"],
        }
        for name in (
            *terms,
            "source",
            "business_category",
            "family_garment_type",
            "concept_garment_type",
        ):
            snapshot[name] = row[f"{name}_name"]
            snapshot[f"{name}_id"] = (
                str(row[f"{name}_id"]) if row[f"{name}_id"] is not None else None
            )
        described[row["id"]] = VariantDescription(
            product_variant_id=row["id"],
            organization_id=row["organization_id"],
            display_name=display_name,
            snapshot=snapshot,
        )

    return described


async def size_label(session: AsyncSession, size_id: uuid.UUID) -> str | None:
    """The size code as the shop writes it, for the receipt snapshot."""
    return (await session.execute(select(Size.code).where(Size.id == size_id))).scalar_one_or_none()


__all__ = ["VariantDescription", "describe_variants", "size_label"]
