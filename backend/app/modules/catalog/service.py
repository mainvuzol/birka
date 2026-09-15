"""Creating catalog identity from the words the shop actually uses.

This is the structured intake path for gate M1B: a person names the product,
and this module turns those words into the identity chain of
`.ai/CATALOG_ARCHITECTURE.md`:

    BusinessCategory + GarmentType
      -> CanonicalConcept -> ProductFamily -> ProductVariant -> Size

It parses nothing and infers nothing. Natural-language intake, alias learning
and automatic matching arrive in gate M1C (M1-020/M1-021) and will funnel into
these same rows; keeping this path free of guesses is what makes that safe.

Three rules do most of the work:

1. **A repeated name is the same row; a repeated *product* is not.**
   Categories, garment types, concepts, sources, attribute terms and sizes are
   each uniquely keyed by their normalized text inside the organization, so
   naming one twice returns the row that exists. `ProductFamily` is
   deliberately not keyed that way (ADR-0002): several families may share the
   whole `(concept, source, garment_type)` signature, so a second one appears
   only when a human says `new_model` and writes down why it is different.

2. **Nothing is inferred.** A source label stays `UNKNOWN` until somebody
   confirms what it is. A slash inside a size code is kept verbatim — "L/XL" is
   how this shop writes one size, and invariant I15 forbids inventing the
   split. An item code is not asked for, not required and not invented: staff
   very rarely record one (owner confirmation, 2026-09-14) and the schema does
   not model it yet.

3. **Every write is auditable.** The command writes one audit entry naming what
   it created and what it reused, inside the caller's transaction.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field, replace
from decimal import Decimal
from typing import Any

from sqlalchemy import Executable, Select, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import CatalogAmbiguousError, NotFoundError, ValidationFailedError
from app.modules.audit import service as audit
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
    SizeSystemCode,
    SourceIdentity,
)
from app.modules.catalog.read import describe_variants

# Display labels for the size systems. The code is the identity; neither the
# label nor the system is ever inferred from the size a seller types.
SIZE_SYSTEM_NAMES: dict[SizeSystemCode, str] = {
    SizeSystemCode.ALPHA: "Alpha",
    SizeSystemCode.NUMERIC_EU: "Numeric (EU)",
    SizeSystemCode.UNSPECIFIED: "Unspecified",
}


# Widths of the `normalized_name` columns these labels are stored in. They are
# checked here rather than only in the request schema because casefolding can
# make a string *longer*: 'ß' becomes 'ss', 'ﬄ' becomes 'ffl'. A name that fits
# the request cap can therefore overflow the column, and the driver error that
# follows is a 500 — an incident — for what is really a request the user should
# be told to shorten.
NAME_LIMIT = 200  # canonical_concept, source_identity
TERM_LIMIT = 120  # business_category, garment_type, attribute_term


def normalize_label(value: str, *, limit: int) -> str:
    """Casefold and collapse whitespace. Nothing else.

    This is the key that decides whether two typed names are the same row, so
    it has to be conservative. It deliberately does NOT transliterate, fold
    Cyrillic/Latin look-alikes, strip diacritics or split on a slash: each of
    those is a decision about real shop data that belongs to the parser in
    M1-020, made against a real corpus.

    The cost is visible and accepted: `Лоран` typed with a Latin `o` becomes a
    second concept. That is a duplicate a human can merge (invariant I14, and
    the duplicate-signature report in M1-021) — the opposite mistake, silently
    merging two different products, is not recoverable.

    Refuses rather than truncates when the result is too long for its column:
    a truncated key is a *different* key, and silently filing a product under
    one is exactly the kind of quiet mistake this module exists to avoid.
    """
    normalized = " ".join(value.split()).casefold()
    if len(normalized) > limit:
        raise ValidationFailedError(
            "This name is too long once normalized", limit=limit, length=len(normalized)
        )
    return normalized


def _concept_lock_key(concept_id: uuid.UUID) -> int:
    """A stable 64-bit advisory-lock key for one concept.

    `hash()` is salted per process and would give two workers different keys
    for the same concept, which is the one thing this must not do. A digest is
    stable everywhere and forever.
    """
    digest = hashlib.blake2b(concept_id.bytes, digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


@dataclass(frozen=True, slots=True)
class VariantDraft:
    """The attribute combination that makes this variant distinct."""

    color: str | None = None
    material: str | None = None
    texture: str | None = None
    fur: str | None = None
    collar: str | None = None
    length_cm: Decimal | None = None


@dataclass(frozen=True, slots=True)
class SizeDraft:
    system: SizeSystemCode
    code: str


@dataclass(frozen=True, slots=True)
class ProductDraft:
    """One structured product statement, exactly as a person made it.

    Either `concept` names the product, or `product_family_id` points at a
    family that already exists — never both, because those are two different
    claims about identity.
    """

    sizes: tuple[SizeDraft, ...]
    concept: str | None = None
    source: str | None = None
    business_category: str | None = None
    garment_type: str | None = None
    product_family_id: uuid.UUID | None = None
    new_model: bool = False
    distinction_note: str | None = None
    variant: VariantDraft = field(default_factory=VariantDraft)


@dataclass(frozen=True, slots=True)
class SizeResult:
    size_id: uuid.UUID
    system: SizeSystemCode
    code: str
    created: bool


@dataclass(frozen=True, slots=True)
class ProductResult:
    """What the command resolved to, and what it had to create to get there."""

    product_family_id: uuid.UUID
    product_variant_id: uuid.UUID
    canonical_concept_id: uuid.UUID
    source_identity_id: uuid.UUID | None
    business_category_id: uuid.UUID | None
    garment_type_id: uuid.UUID | None
    display_name: str
    sizes: tuple[SizeResult, ...]
    family_created: bool
    variant_created: bool


async def _insert_or_select(
    session: AsyncSession,
    *,
    insert: Executable,
    existing: Select[tuple[uuid.UUID]],
) -> tuple[uuid.UUID, bool]:
    """Return the id of a uniquely-keyed row, creating it only if absent.

    `ON CONFLICT DO NOTHING` rather than select-then-insert: two sellers naming
    the same colour at the same moment would otherwise race, and one of them
    would get a unique-violation 500 for doing nothing wrong. The insert waits
    on the other transaction's speculative row, then does nothing once it
    commits, and the fallback SELECT — a new statement, so a new snapshot —
    sees it.

    That last step is why this is correct only under READ COMMITTED, which is
    PostgreSQL's default and what this application runs at. Under REPEATABLE
    READ the fallback would keep the old snapshot, find nothing, and raise.
    Raising the isolation level anywhere near this module means revisiting it.
    """
    created: uuid.UUID | None = (await session.execute(insert)).scalar_one_or_none()
    if created is not None:
        return created, True
    found: uuid.UUID | None = (await session.execute(existing)).scalar_one_or_none()
    if found is None:  # pragma: no cover - only if the row is deleted mid-request
        raise NotFoundError("Catalog row disappeared while it was being created")
    return found, False


def _require_active(row: AttributeTerm | CanonicalConcept | ProductVariant, *, entity: str) -> None:
    """Refuse a catalog row that has been merged away.

    This deliberately does not follow `merged_into_id` to the row that replaced
    it, even though that is the friendlier behaviour and the pointer means
    exactly that. Two reasons. Nothing writes `merged_into_id` in this build —
    merging is gate M1C — so a redirect here would be an unreachable, untested
    path. And the pointer is a plain self-reference with no composite tenant
    key, so a row whose target sits in another organization would quietly hand
    one shop another shop's product and freeze its label onto their receipts.
    The command that writes merges owns that decision, with its own tenant
    check and its own tests.
    """
    if row.status is EntityStatus.ACTIVE:
        return
    raise CatalogAmbiguousError(
        "This catalog entry was merged and needs review",
        entity=entity,
        entity_id=str(row.id),
        merged_into_id=str(row.merged_into_id) if row.merged_into_id else None,
    )


async def _resolve_category(
    session: AsyncSession, *, organization_id: uuid.UUID, name: str | None
) -> uuid.UUID | None:
    if name is None:
        return None
    normalized = normalize_label(name, limit=TERM_LIMIT)
    category_id, _ = await _insert_or_select(
        session,
        insert=pg_insert(BusinessCategory)
        .values(
            id=uuid.uuid4(),
            organization_id=organization_id,
            name=name,
            normalized_name=normalized,
        )
        .on_conflict_do_nothing(constraint="uq_business_category_org_normalized")
        .returning(BusinessCategory.id),
        existing=select(BusinessCategory.id).where(
            BusinessCategory.organization_id == organization_id,
            BusinessCategory.normalized_name == normalized,
        ),
    )
    return category_id


async def _resolve_garment_type(
    session: AsyncSession, *, organization_id: uuid.UUID, name: str | None
) -> uuid.UUID | None:
    if name is None:
        return None
    normalized = normalize_label(name, limit=TERM_LIMIT)
    garment_type_id, _ = await _insert_or_select(
        session,
        insert=pg_insert(GarmentType)
        .values(
            id=uuid.uuid4(),
            organization_id=organization_id,
            name=name,
            normalized_name=normalized,
        )
        .on_conflict_do_nothing(constraint="uq_garment_type_org_normalized")
        .returning(GarmentType.id),
        existing=select(GarmentType.id).where(
            GarmentType.organization_id == organization_id,
            GarmentType.normalized_name == normalized,
        ),
    )
    return garment_type_id


async def _resolve_source(
    session: AsyncSession, *, organization_id: uuid.UUID, name: str | None
) -> uuid.UUID | None:
    """Belardi, Ponte, Garcia — stored as a label, never classified here.

    `semantic_type` stays at its `UNKNOWN` default. Whether a name is a brand,
    a supplier or a factory is a fact about the business that only the business
    can supply, and spelling is not evidence of it.
    """
    if name is None:
        return None
    normalized = normalize_label(name, limit=NAME_LIMIT)
    source_id, _ = await _insert_or_select(
        session,
        insert=pg_insert(SourceIdentity)
        .values(
            id=uuid.uuid4(),
            organization_id=organization_id,
            name=name,
            normalized_name=normalized,
        )
        .on_conflict_do_nothing(constraint="uq_source_identity_org_normalized")
        .returning(SourceIdentity.id),
        existing=select(SourceIdentity.id).where(
            SourceIdentity.organization_id == organization_id,
            SourceIdentity.normalized_name == normalized,
        ),
    )
    return source_id


async def _resolve_term(
    session: AsyncSession, *, organization_id: uuid.UUID, kind: AttributeKind, name: str | None
) -> uuid.UUID | None:
    if name is None:
        return None
    normalized = normalize_label(name, limit=TERM_LIMIT)
    term_id, created = await _insert_or_select(
        session,
        insert=pg_insert(AttributeTerm)
        .values(
            id=uuid.uuid4(),
            organization_id=organization_id,
            kind=kind,
            name=name,
            normalized_name=normalized,
        )
        .on_conflict_do_nothing(constraint="uq_attribute_term_org_kind_name")
        .returning(AttributeTerm.id),
        existing=select(AttributeTerm.id).where(
            AttributeTerm.organization_id == organization_id,
            AttributeTerm.kind == kind,
            AttributeTerm.normalized_name == normalized,
        ),
    )
    if created:
        return term_id
    term = await session.get(AttributeTerm, term_id)
    if term is None:  # pragma: no cover - just resolved above
        raise NotFoundError("Unknown attribute term")
    _require_active(term, entity="attribute_term")
    return term.id


async def _resolve_concept(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    name: str,
    business_category: str | None,
    garment_type_id: uuid.UUID | None,
) -> tuple[uuid.UUID, uuid.UUID | None]:
    """Find the shop-language name, or create it with what was stated now.

    Returns the concept and the business category that is actually in force —
    which may not be the one the caller typed.

    **An existing concept is never modified here.** An earlier draft filled in
    a classification that was absent, which looked like a person supplying
    evidence. It was two mistakes. The first seller to type a category would
    have set it for the whole organization, permanently, with no endpoint able
    to correct it — and `catalog:create` is a seller permission. The second is
    worse: `garment_type` is part of the family signature in ADR-0002 §4.2
    precisely so that two families under one concept may differ on it, so
    binding it to the concept made that dimension degenerate — "Лоран / Парка"
    would have made "Лоран / Косуха" unrepresentable forever.

    So the concept's classification is written once, when the concept is
    created, and the caller's `garment_type` goes where it belongs: on the
    family. Changing an existing concept is a separate, permissioned catalog
    operation and it belongs to gate M1C with the merge and confirm flows.
    """
    normalized = normalize_label(name, limit=NAME_LIMIT)
    existing = (
        await session.execute(
            select(CanonicalConcept).where(
                CanonicalConcept.organization_id == organization_id,
                CanonicalConcept.normalized_name == normalized,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        _require_active(existing, entity="canonical_concept")
        return existing.id, existing.business_category_id

    # Only now is a category row worth creating: naming a category for a
    # concept that already exists would leave an orphan behind on every call.
    business_category_id = await _resolve_category(
        session, organization_id=organization_id, name=business_category
    )
    concept_id, created = await _insert_or_select(
        session,
        insert=pg_insert(CanonicalConcept)
        .values(
            id=uuid.uuid4(),
            organization_id=organization_id,
            name=name,
            normalized_name=normalized,
            business_category_id=business_category_id,
            garment_type_id=garment_type_id,
        )
        .on_conflict_do_nothing(constraint="uq_canonical_concept_org_normalized")
        .returning(CanonicalConcept.id),
        existing=select(CanonicalConcept.id).where(
            CanonicalConcept.organization_id == organization_id,
            CanonicalConcept.normalized_name == normalized,
        ),
    )
    if created:
        return concept_id, business_category_id

    # Lost the race to a concurrent request. Whatever it stored stands; this
    # transaction does not get to revise it.
    concept = await session.get(CanonicalConcept, concept_id)
    if concept is None:  # pragma: no cover - just resolved above
        raise NotFoundError("Unknown canonical concept")
    _require_active(concept, entity="canonical_concept")
    return concept.id, concept.business_category_id


async def _resolve_family(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    draft: ProductDraft,
    concept_id: uuid.UUID,
    source_id: uuid.UUID | None,
    garment_type_id: uuid.UUID | None,
) -> uuid.UUID:
    """Apply ADR-0002: the signature retrieves candidates, it never decides.

    When nothing could be this product, one is created. When something could,
    the command refuses and hands back the candidate ids: either this *is* one
    of them — the caller re-sends with `product_family_id` — or it is genuinely
    a different model, and the caller says so with `new_model` and a note
    explaining the difference.

    "Could be" is doing real work in that sentence. `NULL` in this schema means
    *not stated*, not "a value of its own" (`models.py`: "NULL = not stated").
    An earlier draft matched candidates with `IS NOT DISTINCT FROM`, which
    compares NULL as if it were a value — so creating "Лоран / Belardi / Парка"
    and then the same coat with the garment type simply left out produced two
    families, silently, with no note and no human decision. Every one of those
    fields is optional, so that was the common case, and it is exactly the
    failure ADR-0002 exists to prevent.

    A stated field therefore matches a family that states the same thing **or
    states nothing**; an unstated field narrows nothing at all. The result is a
    superset: the command refuses more often than strictly necessary, and every
    refusal hands back the rows a person can look at. That asymmetry is the
    point — a duplicate family is a bad day and a merge, a wrongly merged
    product is not recoverable.
    """
    # Serialize family creation per concept. `product_family` has no unique
    # constraint by design, so the read above and the insert below are a
    # check-then-act that two simultaneous sellers would both pass, each
    # creating a family with no `distinction_note` and neither being asked.
    # An advisory lock held to commit closes that window without a schema
    # change; it is keyed per concept, so it only ever serializes two people
    # entering the same product name at the same moment.
    await session.execute(select(func.pg_advisory_xact_lock(_concept_lock_key(concept_id))))

    conditions = [
        ProductFamily.organization_id == organization_id,
        ProductFamily.canonical_concept_id == concept_id,
        # NEEDS_REVIEW is the status the M1C review queue produces. A family
        # parked there is the one most likely to be this product, so it must
        # not be the one the check cannot see. Only a merged family is gone.
        ProductFamily.status != EntityStatus.MERGED,
    ]
    if source_id is not None:
        conditions.append(
            or_(
                ProductFamily.source_identity_id.is_(None),
                ProductFamily.source_identity_id == source_id,
            )
        )
    if garment_type_id is not None:
        conditions.append(
            or_(
                ProductFamily.garment_type_id.is_(None),
                ProductFamily.garment_type_id == garment_type_id,
            )
        )

    candidates = list((await session.scalars(select(ProductFamily.id).where(*conditions))).all())
    if candidates and not draft.new_model:
        raise CatalogAmbiguousError(
            "A product with this name could already exist",
            candidate_family_ids=[str(candidate) for candidate in candidates],
        )

    family = ProductFamily(
        organization_id=organization_id,
        canonical_concept_id=concept_id,
        source_identity_id=source_id,
        garment_type_id=garment_type_id,
        distinction_note=draft.distinction_note,
    )
    session.add(family)
    await session.flush()
    return family.id


async def _existing_family(
    session: AsyncSession, *, organization_id: uuid.UUID, product_family_id: uuid.UUID
) -> ProductFamily:
    family = await session.get(ProductFamily, product_family_id)
    # A family in another organization is reported exactly like one that does
    # not exist: the answer must not confirm that it is out there somewhere.
    if family is None or family.organization_id != organization_id:
        raise NotFoundError("Unknown product family", product_family_id=str(product_family_id))
    if family.status is not EntityStatus.ACTIVE:
        raise CatalogAmbiguousError(
            "This product family is not active",
            product_family_id=str(family.id),
            status=family.status.value,
            merged_into_id=str(family.merged_into_id) if family.merged_into_id else None,
        )
    return family


async def _resolve_variant(
    session: AsyncSession,
    *,
    product_family_id: uuid.UUID,
    terms: dict[str, uuid.UUID | None],
    length_cm: Decimal | None,
) -> tuple[uuid.UUID, bool]:
    """Find or create the attribute combination inside the family.

    Unlike a family, a variant *is* its attributes — the unique constraint says
    so, with `NULLS NOT DISTINCT` so that "not stated" collapses to one row
    instead of unlimited near-duplicates. Returning the existing row is
    therefore not a merge; it is the identity the schema already declared.
    """
    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "product_family_id": product_family_id,
        "length_cm": length_cm,
        **terms,
    }
    lookup = [
        ProductVariant.product_family_id == product_family_id,
        ProductVariant.length_cm.is_not_distinct_from(length_cm),
    ]
    lookup.extend(
        getattr(ProductVariant, column).is_not_distinct_from(value)
        for column, value in terms.items()
    )
    variant_id, created = await _insert_or_select(
        session,
        insert=pg_insert(ProductVariant)
        .values(**values)
        .on_conflict_do_nothing(constraint="uq_product_variant_attributes")
        .returning(ProductVariant.id),
        existing=select(ProductVariant.id).where(*lookup),
    )
    if created:
        return variant_id, True

    variant = await session.get(ProductVariant, variant_id)
    if variant is None:  # pragma: no cover - just resolved above
        raise NotFoundError("Unknown product variant")
    _require_active(variant, entity="product_variant")
    return variant.id, False


async def _resolve_sizes(
    session: AsyncSession, *, organization_id: uuid.UUID, drafts: tuple[SizeDraft, ...]
) -> tuple[SizeResult, ...]:
    """Find or create each size, keeping the shop's own spelling.

    The code is stored verbatim. "46-48" and "L/XL" are single sizes here, not
    ranges to be expanded: splitting them would invent stock that nobody
    counted (invariant I15).

    `is_unknown` is not settable through this path. The "size not known" state
    is real (business fact F34) but it belongs to the legacy snapshot import
    (M1-023), where the evidence for it exists.

    Sizes are *inserted* in a total order rather than the order they were
    listed. Two requests naming the same two new sizes in opposite orders would
    otherwise each hold the other's speculative insert and deadlock — the loser
    getting a 500, the winner paying a second of `deadlock_timeout`. Same
    reasoning, and the same fix, as the global sort in `inventory/service.py`.
    The response is still built in the caller's own order.
    """
    ordered: list[SizeDraft] = []
    seen: set[tuple[SizeSystemCode, str]] = set()
    for draft in drafts:
        key = (draft.system, draft.code)
        if key in seen:
            # The same size twice in one request is a slip, not two sizes.
            continue
        seen.add(key)
        ordered.append(draft)

    resolved: dict[tuple[SizeSystemCode, str], SizeResult] = {}
    systems: dict[SizeSystemCode, uuid.UUID] = {}

    for draft in sorted(ordered, key=lambda size: (size.system.value, size.code)):
        if draft.system not in systems:
            system_id, _ = await _insert_or_select(
                session,
                insert=pg_insert(SizeSystem)
                .values(
                    id=uuid.uuid4(),
                    organization_id=organization_id,
                    code=draft.system,
                    name=SIZE_SYSTEM_NAMES[draft.system],
                )
                .on_conflict_do_nothing(constraint="uq_size_system_org_code")
                .returning(SizeSystem.id),
                existing=select(SizeSystem.id).where(
                    SizeSystem.organization_id == organization_id,
                    SizeSystem.code == draft.system,
                ),
            )
            systems[draft.system] = system_id

        size_id, created = await _insert_or_select(
            session,
            insert=pg_insert(Size)
            .values(id=uuid.uuid4(), size_system_id=systems[draft.system], code=draft.code)
            .on_conflict_do_nothing(constraint="uq_size_system_code")
            .returning(Size.id),
            existing=select(Size.id).where(
                Size.size_system_id == systems[draft.system], Size.code == draft.code
            ),
        )
        resolved[(draft.system, draft.code)] = SizeResult(
            size_id=size_id, system=draft.system, code=draft.code, created=created
        )
    return tuple(resolved[(draft.system, draft.code)] for draft in ordered)


async def create_product(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    draft: ProductDraft,
) -> ProductResult:
    """Turn one structured product statement into rows stock can be held against.

    Does not open or commit a transaction — the calling command owns the unit
    of work (`.ai/conventions.md`), so the audit entry commits with the rows it
    describes, or not at all.
    """
    if (draft.concept is None) == (draft.product_family_id is None):
        raise ValidationFailedError("Name the product or give a product_family_id, not both")
    # Direct callers must enforce the same explanation rule as HTTP intake.
    note = draft.distinction_note.strip() if draft.distinction_note is not None else None
    if note is not None and len(note) > 1000:
        raise ValidationFailedError("A distinction note must not exceed 1000 characters")
    draft = replace(draft, distinction_note=note)
    if draft.new_model and not draft.distinction_note:
        raise ValidationFailedError("A new model needs a note saying how it is different")
    if not draft.sizes:
        raise ValidationFailedError("At least one size is required")

    family_created = False
    if draft.product_family_id is not None:
        family = await _existing_family(
            session, organization_id=organization_id, product_family_id=draft.product_family_id
        )
        family_id = family.id
        concept_id = family.canonical_concept_id
        source_id = family.source_identity_id
        garment_type_id = family.garment_type_id
        concept = await session.get(CanonicalConcept, concept_id)
        if concept is None:  # pragma: no cover - RESTRICT forbids deleting it
            raise NotFoundError("Unknown canonical concept")
        category_id = concept.business_category_id
    else:
        if draft.concept is None:  # pragma: no cover - guarded above
            raise ValidationFailedError("A product needs a name")
        # The garment type is resolved either way: it is a dimension of the
        # family signature (ADR-0002 §4.2), not a property of the concept.
        garment_type_id = await _resolve_garment_type(
            session, organization_id=organization_id, name=draft.garment_type
        )
        # `category_id` is what is actually in force, which is not necessarily
        # what the caller typed: an existing concept keeps its own.
        concept_id, category_id = await _resolve_concept(
            session,
            organization_id=organization_id,
            name=draft.concept,
            business_category=draft.business_category,
            garment_type_id=garment_type_id,
        )
        source_id = await _resolve_source(
            session, organization_id=organization_id, name=draft.source
        )
        family_id = await _resolve_family(
            session,
            organization_id=organization_id,
            draft=draft,
            concept_id=concept_id,
            source_id=source_id,
            garment_type_id=garment_type_id,
        )
        family_created = True

    terms = {
        "color_term_id": await _resolve_term(
            session,
            organization_id=organization_id,
            kind=AttributeKind.COLOR,
            name=draft.variant.color,
        ),
        "material_term_id": await _resolve_term(
            session,
            organization_id=organization_id,
            kind=AttributeKind.MATERIAL,
            name=draft.variant.material,
        ),
        "texture_term_id": await _resolve_term(
            session,
            organization_id=organization_id,
            kind=AttributeKind.TEXTURE,
            name=draft.variant.texture,
        ),
        "fur_term_id": await _resolve_term(
            session,
            organization_id=organization_id,
            kind=AttributeKind.FUR,
            name=draft.variant.fur,
        ),
        "collar_term_id": await _resolve_term(
            session,
            organization_id=organization_id,
            kind=AttributeKind.COLLAR,
            name=draft.variant.collar,
        ),
    }
    variant_id, variant_created = await _resolve_variant(
        session,
        product_family_id=family_id,
        terms=terms,
        length_cm=draft.variant.length_cm,
    )
    sizes = await _resolve_sizes(session, organization_id=organization_id, drafts=draft.sizes)

    described = await describe_variants(session, [variant_id])
    description = described[variant_id]

    await audit.record(
        session,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action="catalog.product_created",
        entity_type="product_variant",
        entity_id=variant_id,
        after={
            "product_family_id": str(family_id),
            "product_variant_id": str(variant_id),
            "canonical_concept_id": str(concept_id),
            "display_name": description.display_name,
            "family_created": family_created,
            "variant_created": variant_created,
            "size_ids": [str(size.size_id) for size in sizes],
        },
        reason=draft.distinction_note,
    )

    return ProductResult(
        product_family_id=family_id,
        product_variant_id=variant_id,
        canonical_concept_id=concept_id,
        source_identity_id=source_id,
        business_category_id=category_id,
        garment_type_id=garment_type_id,
        display_name=description.display_name,
        sizes=sizes,
        family_created=family_created,
        variant_created=variant_created,
    )


__all__ = [
    "ProductDraft",
    "ProductResult",
    "SizeDraft",
    "SizeResult",
    "VariantDraft",
    "create_product",
    "normalize_label",
]
