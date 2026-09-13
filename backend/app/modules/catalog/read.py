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
    CanonicalConcept,
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
    material, length — because that is what the seller recognises on a receipt.
    Anything missing is simply left out rather than filled with a placeholder.
    """
    if not variant_ids:
        return {}

    colour = AttributeTerm.__table__.alias("colour")
    material = AttributeTerm.__table__.alias("material")

    statement = (
        select(
            ProductVariant.id,
            ProductVariant.length_cm,
            ProductVariant.attributes,
            ProductFamily.organization_id,
            CanonicalConcept.name.label("concept_name"),
            SourceIdentity.name.label("source_name"),
            colour.c.name.label("colour_name"),
            material.c.name.label("material_name"),
        )
        .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
        .join(CanonicalConcept, CanonicalConcept.id == ProductFamily.canonical_concept_id)
        .outerjoin(SourceIdentity, SourceIdentity.id == ProductFamily.source_identity_id)
        .outerjoin(colour, colour.c.id == ProductVariant.color_term_id)
        .outerjoin(material, material.c.id == ProductVariant.material_term_id)
        .where(ProductVariant.id.in_(variant_ids))
    )

    described: dict[uuid.UUID, VariantDescription] = {}
    for row in (await session.execute(statement)).mappings():
        parts = [
            row["concept_name"],
            row["source_name"],
            row["colour_name"],
            row["material_name"],
        ]
        if row["length_cm"] is not None:
            parts.append(f"{row['length_cm']:g} см")
        display_name = " ".join(str(part) for part in parts if part)

        described[row["id"]] = VariantDescription(
            product_variant_id=row["id"],
            organization_id=row["organization_id"],
            display_name=display_name,
            snapshot={
                "concept": row["concept_name"],
                "source": row["source_name"],
                "colour": row["colour_name"],
                "material": row["material_name"],
                "length_cm": float(row["length_cm"]) if row["length_cm"] is not None else None,
                "attributes": row["attributes"],
            },
        )
    return described


async def size_label(session: AsyncSession, size_id: uuid.UUID) -> str | None:
    """The size code as the shop writes it, for the receipt snapshot."""
    return (await session.execute(select(Size.code).where(Size.id == size_id))).scalar_one_or_none()


__all__ = ["VariantDescription", "describe_variants", "size_label"]
