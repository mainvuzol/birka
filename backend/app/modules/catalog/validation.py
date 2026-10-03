"""Tenant-scoped catalog references for commands in other modules."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ModelMergedError, ModelRetiredError, NotFoundError
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


async def _held_variants(
    session: AsyncSession, *, organization_id: uuid.UUID, variant_ids: set[uuid.UUID]
) -> dict[uuid.UUID, tuple[EntityStatus, uuid.UUID | None]]:
    """Hold each variant `FOR KEY SHARE`, in id order, and read it under the hold.

    The first lock a stock command takes (ADR-0008 §9). A merge, a rename or a
    retirement holds its variants `FOR UPDATE`, which conflicts with this: a
    command that holds a model first lands before them, and one that comes
    after waits, then reads the row they left. A plain read would see the old
    row while they are uncommitted, and write under a model already merged.

    Plain columns, never the ORM entity, so nothing cached in the session can
    hide the row the lock returns. Unknown and foreign identifiers have the
    same non-disclosing outcome.
    """
    if not variant_ids:
        return {}
    rows = (
        await session.execute(
            select(ProductVariant.id, ProductVariant.status, ProductVariant.merged_into_id)
            .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
            .where(
                ProductVariant.id.in_(variant_ids),
                ProductFamily.organization_id == organization_id,
            )
            .order_by(ProductVariant.id)
            .with_for_update(read=True, key_share=True, of=ProductVariant)
        )
    ).all()
    held = {variant_id: (status, merged_into) for variant_id, status, merged_into in rows}
    if set(held) != variant_ids:
        raise NotFoundError("Unknown product variant")
    return held


async def hold_stock_variants(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    variant_ids: set[uuid.UUID],
    retired_refused: set[uuid.UUID] | frozenset[uuid.UUID] = frozenset(),
) -> None:
    """Hold a stock command's models, and refuse one it may not move.

    A merged model holds no stock any more: `MODEL_MERGED`, naming the model
    that stays. A retired one still sells, returns, moves and is written off;
    only goods taken in are refused (`retired_refused`, `MODEL_RETIRED`).
    """
    held = await _held_variants(session, organization_id=organization_id, variant_ids=variant_ids)
    for variant_id in sorted(held):
        status, merged_into = held[variant_id]
        if status is EntityStatus.MERGED:
            raise ModelMergedError(product_variant_id=str(variant_id), merged_into=str(merged_into))
        if status is EntityStatus.RETIRED and variant_id in retired_refused:
            raise ModelRetiredError(product_variant_id=str(variant_id))


async def hold_current_variants(
    session: AsyncSession, *, organization_id: uuid.UUID, variant_ids: set[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    """The model each one leads to, held as `hold_stock_variants` holds it.

    For goods that come back under a model a merge may have taken away: a
    return of an old sale, a supplier return cancelled, a borrowed lot sent
    back (ADR-0008 §5). Each model is held first; a merged one is followed to
    the model that stays, which is held in turn. So the answer cannot change
    under the command that uses it.
    """
    leading = {variant_id: variant_id for variant_id in variant_ids}
    pending = set(variant_ids)
    # `merged_into_id` names a model not merged, so one step suffices; a merge
    # committing between two of these holds can add one more.
    for _ in range(8):
        held = await _held_variants(session, organization_id=organization_id, variant_ids=pending)
        following = {
            variant_id: merged_into
            for variant_id, (status, merged_into) in held.items()
            if status is EntityStatus.MERGED and merged_into is not None
        }
        if not following:
            return leading
        leading = {source: following.get(target, target) for source, target in leading.items()}
        pending = set(following.values())
    raise NotFoundError("Unknown product variant")  # pragma: no cover - a cycle CHECKs forbid


async def validate_stock_references(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    variant_ids: set[uuid.UUID],
    size_ids: set[uuid.UUID],
) -> None:
    """Unknown and foreign identifiers have the same non-disclosing outcome."""
    if variant_ids:
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
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    variant_ids: set[uuid.UUID],
    hold: bool = False,
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
    A model of this organization that was merged or retired is named, though,
    so its line can be resolved again (`MODEL_MERGED`, `MODEL_RETIRED`).

    `hold` holds the variants `FOR KEY SHARE` first, as a stock command does,
    so a merge or a retirement running now lands wholly before or after
    (ADR-0008 §9).
    """
    if not variant_ids:
        return
    if hold:
        await _held_variants(session, organization_id=organization_id, variant_ids=variant_ids)
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
    missing = variant_ids - {row[0] for row in rows}
    if missing:
        await _refuse_merged_or_retired(
            session, organization_id=organization_id, variant_ids=missing
        )
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


async def _refuse_merged_or_retired(
    session: AsyncSession, *, organization_id: uuid.UUID, variant_ids: set[uuid.UUID]
) -> None:
    rows = (
        await session.execute(
            select(ProductVariant.id, ProductVariant.status, ProductVariant.merged_into_id)
            .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
            .where(
                ProductVariant.id.in_(variant_ids),
                ProductFamily.organization_id == organization_id,
            )
            .order_by(ProductVariant.id)
        )
    ).all()
    for variant_id, status, merged_into in rows:
        if status is EntityStatus.MERGED:
            raise ModelMergedError(product_variant_id=str(variant_id), merged_into=str(merged_into))
        if status is EntityStatus.RETIRED:
            raise ModelRetiredError(product_variant_id=str(variant_id))
