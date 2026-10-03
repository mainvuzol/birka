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

from sqlalchemy import Executable, Select, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    CatalogAmbiguousError,
    ModelRetiredError,
    NotFoundError,
    ValidationFailedError,
)
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.catalog.models import (
    VARIANT_NAME_COLUMNS,
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
from app.modules.catalog.read import current_variants, describe_variants
from app.modules.catalog.similar import TypedWord, refuse_similar

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
    if not is_storable(value):
        # A NUL or a lone surrogate. Same class of defect as the overflow
        # below: without this the driver raises after the write has begun and
        # a 422 becomes a 500 (app/core/text.py).
        raise ValidationFailedError("This name contains characters that cannot be stored")
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
    # The merged model whose name this was: creating it gave the model that
    # stays (ADR-0008 §4).
    redirected_from: uuid.UUID | None = None


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
    """Refuse a catalog row that is not active, saying why.

    A merged *model* never reaches here: `_resolve_variant` follows it to the
    model that stays, within this organization (ADR-0008 §4). A retired model
    is refused with `MODEL_RETIRED`, so the app can offer to bring it back.
    Anything else — a row parked for review, or a merged word — is
    `CATALOG_AMBIGUOUS`, naming its status.
    """
    if row.status is EntityStatus.ACTIVE:
        return
    if row.status is EntityStatus.RETIRED:
        raise ModelRetiredError(product_variant_id=str(row.id))
    raise CatalogAmbiguousError(
        "This catalog entry was merged"
        if row.status is EntityStatus.MERGED
        else "This catalog entry needs review",
        entity=entity,
        entity_id=str(row.id),
        status=row.status.value,
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


async def lock_concept(session: AsyncSession, *, concept_id: uuid.UUID) -> None:
    """Families of one concept are found and created one request at a time."""
    await session.execute(select(func.pg_advisory_xact_lock(_concept_lock_key(concept_id))))


async def family_candidates(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    concept_id: uuid.UUID,
    source_id: uuid.UUID | None,
    garment_type_id: uuid.UUID | None,
    exclude: frozenset[uuid.UUID] = frozenset(),
) -> list[uuid.UUID]:
    """The families that could be this product (ADR-0002): the concept's, not
    merged, whose source and garment type are the same or not stated. Taken
    under `lock_concept`. `exclude` leaves out the family a rename moves a
    model from: that is where it is, not a product it could be."""
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
    if exclude:
        conditions.append(ProductFamily.id.not_in(exclude))
    return list(
        (
            await session.scalars(
                select(ProductFamily.id).where(*conditions).order_by(ProductFamily.id)
            )
        ).all()
    )


async def _resolve_family(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    new_model: bool,
    distinction_note: str | None,
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
    await lock_concept(session, concept_id=concept_id)
    candidates = await family_candidates(
        session,
        organization_id=organization_id,
        concept_id=concept_id,
        source_id=source_id,
        garment_type_id=garment_type_id,
    )
    if candidates and not new_model:
        raise CatalogAmbiguousError(
            "A product with this name could already exist",
            candidate_family_ids=[str(candidate) for candidate in candidates],
        )

    family = ProductFamily(
        organization_id=organization_id,
        canonical_concept_id=concept_id,
        source_identity_id=source_id,
        garment_type_id=garment_type_id,
        distinction_note=distinction_note,
    )
    session.add(family)
    await session.flush()
    return family.id


async def _existing_family(
    session: AsyncSession, *, organization_id: uuid.UUID, product_family_id: uuid.UUID
) -> ProductFamily:
    # Held `FOR KEY SHARE` and read under the hold, so a correction merging
    # this family away (`merge_emptied_family`) lands wholly before — and is
    # seen here — or after the model created in it, and then finds it.
    family = await session.scalar(
        select(ProductFamily)
        .where(ProductFamily.id == product_family_id)
        .with_for_update(read=True, key_share=True)
        .execution_options(populate_existing=True)
    )
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


def same_name(
    product_family_id: uuid.UUID, terms: dict[str, uuid.UUID | None], length_cm: Decimal | None
) -> list[Any]:
    """The conditions that find a variant by its name within a family."""
    lookup = [
        ProductVariant.product_family_id == product_family_id,
        ProductVariant.length_cm.is_not_distinct_from(length_cm),
    ]
    lookup.extend(
        getattr(ProductVariant, column).is_not_distinct_from(value)
        for column, value in terms.items()
    )
    return lookup


async def _resolve_variant(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    product_family_id: uuid.UUID,
    terms: dict[str, uuid.UUID | None],
    length_cm: Decimal | None,
) -> tuple[uuid.UUID, bool, uuid.UUID | None]:
    """Find or create the attribute combination inside the family.

    Unlike a family, a variant *is* its attributes — the unique key says so,
    with `NULLS NOT DISTINCT` so that "not stated" collapses to one row instead
    of unlimited near-duplicates. Returning the existing row is therefore not
    a merge; it is the identity the schema already declared.

    A merged model gives up its name (ADR-0008 §4): the key covers only models
    not merged. So when the name is held only by a merged model, this answers
    with the model that stays, checked to be this organization's, and says
    which merged model led there. It never creates the typo again beside it.
    Returns `(variant, created, redirected_from)`.
    """
    lookup = same_name(product_family_id, terms, length_cm)
    live = select(ProductVariant.id).where(*lookup, ProductVariant.status != EntityStatus.MERGED)
    merged = (
        await session.scalars(
            select(ProductVariant.id)
            .where(*lookup, ProductVariant.status == EntityStatus.MERGED)
            .order_by(ProductVariant.id)
        )
    ).first()
    redirected_from: uuid.UUID | None = None
    if merged is not None and await session.scalar(live) is None:
        leading = await current_variants(
            session, organization_id=organization_id, variant_ids=[merged]
        )
        if merged in leading and leading[merged] != merged:
            redirected_from = merged
            variant = await session.get(ProductVariant, leading[merged])
            if variant is None:  # pragma: no cover - just resolved above
                raise NotFoundError("Unknown product variant")
            await session.refresh(variant)
            _require_active(variant, entity="product_variant")
            return variant.id, False, redirected_from

    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "product_family_id": product_family_id,
        "length_cm": length_cm,
        **terms,
    }
    variant_id, created = await _insert_or_select(
        session,
        insert=pg_insert(ProductVariant)
        .values(**values)
        .on_conflict_do_nothing(
            index_elements=list(VARIANT_NAME_COLUMNS),
            index_where=text("status <> 'MERGED'"),
        )
        .returning(ProductVariant.id),
        existing=live,
    )
    if created:
        return variant_id, True, None

    variant = await session.get(ProductVariant, variant_id)
    if variant is None:  # pragma: no cover - just resolved above
        raise NotFoundError("Unknown product variant")
    _require_active(variant, entity="product_variant")
    return variant.id, False, None


async def _merged_namesake(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    concept_id: uuid.UUID,
    source_id: uuid.UUID | None,
    terms: dict[str, uuid.UUID | None],
    length_cm: Decimal | None,
) -> tuple[uuid.UUID, uuid.UUID] | None:
    """A merged model with exactly this name, whose family a merge emptied and
    merged too, and the one model it leads to: `(merged, stays)`.

    Such a family is no candidate any more, so without this the concept's
    path would create the typo again in a family of its own. A family still
    alive is found the ordinary way, as a candidate (ADR-0002), and its merged
    model by `_resolve_variant`.
    """
    merged = list(
        (
            await session.scalars(
                select(ProductVariant.id)
                .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
                .where(
                    ProductFamily.organization_id == organization_id,
                    ProductFamily.canonical_concept_id == concept_id,
                    ProductFamily.source_identity_id.is_not_distinct_from(source_id),
                    ProductFamily.status == EntityStatus.MERGED,
                    ProductVariant.status == EntityStatus.MERGED,
                    ProductVariant.length_cm.is_not_distinct_from(length_cm),
                    *(
                        getattr(ProductVariant, column).is_not_distinct_from(value)
                        for column, value in terms.items()
                    ),
                )
                .order_by(ProductVariant.id)
            )
        ).all()
    )
    if not merged:
        return None
    leading = await current_variants(session, organization_id=organization_id, variant_ids=merged)
    stays = {leading[model] for model in merged if model in leading}
    if len(stays) != 1:
        return None
    return merged[0], next(iter(stays))


async def _resolve_sizes(
    session: AsyncSession, *, organization_id: uuid.UUID, drafts: tuple[SizeDraft, ...]
) -> tuple[SizeResult, ...]:
    """Find or create each size, keeping the shop's own spelling.

    The code is stored verbatim. "46-48" and "L/XL" are single sizes here, not
    ranges to be expanded: splitting them would invent stock that nobody
    counted (invariant I15).

    `is_unknown` is not settable through this path. The "size not known" state
    is real (business fact F34) but it belongs to the legacy snapshot import
    (M1-023), where the evidence for it exists. So its code is reserved here
    too: naming it would either hand out the "size not known" row as an
    ordinary size or, before that row exists, take its name for good and
    leave `ensure_unknown_size` refusing for the whole organization.

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
        if not is_storable(draft.code):
            # A size code is stored verbatim by design (invariant I15), so it
            # never passes through `normalize_label` and needs its own check.
            raise ValidationFailedError("A size code contains characters that cannot be stored")
        if (
            draft.system is SizeSystemCode.UNSPECIFIED
            and draft.code.casefold() == UNKNOWN_SIZE_CODE.casefold()
        ):
            raise ValidationFailedError(
                "UNKNOWN is reserved for a size nobody knows; only a legacy stock list states it",
                system=draft.system.value,
                code=draft.code,
            )
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


def typed_words(
    *,
    concept: str | None,
    source: str | None,
    variant: VariantDraft,
) -> list[TypedWord]:
    """The words of a name as a person typed them, for the similar-name check."""
    words: list[TypedWord] = []
    for field_name, value, limit in (
        ("concept", concept, NAME_LIMIT),
        ("source", source, NAME_LIMIT),
        ("color", variant.color, TERM_LIMIT),
        ("material", variant.material, TERM_LIMIT),
        ("texture", variant.texture, TERM_LIMIT),
        ("fur", variant.fur, TERM_LIMIT),
        ("collar", variant.collar, TERM_LIMIT),
    ):
        if value is not None:
            words.append(
                TypedWord(
                    field=field_name, name=value, normalized=normalize_label(value, limit=limit)
                )
            )
    return words


async def create_product(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    draft: ProductDraft,
    similar_confirmed: bool = False,
) -> ProductResult:
    """Turn one structured product statement into rows stock can be held against.

    A word that looks like one the catalogue already uses is refused once
    (`CATALOG_SIMILAR`), until the person takes the existing one or says
    `similar_confirmed` (owner decision, 2026-10-03).

    Does not open or commit a transaction — the calling command owns the unit
    of work (`.ai/conventions.md`), so the audit entry commits with the rows it
    describes, or not at all.
    """
    if (draft.concept is None) == (draft.product_family_id is None):
        raise ValidationFailedError("Name the product or give a product_family_id, not both")
    # Direct callers must enforce the same explanation rule as HTTP intake.
    note = draft.distinction_note.strip() if draft.distinction_note is not None else None
    if note is not None and not is_storable(note):
        raise ValidationFailedError("A distinction note contains characters that cannot be stored")
    if note is not None and len(note) > 1000:
        raise ValidationFailedError("A distinction note must not exceed 1000 characters")
    draft = replace(draft, distinction_note=note)
    if draft.new_model and not draft.distinction_note:
        raise ValidationFailedError("A new model needs a note saying how it is different")
    if not draft.sizes:
        raise ValidationFailedError("At least one size is required")
    if not similar_confirmed:
        await refuse_similar(
            session,
            organization_id=organization_id,
            words=typed_words(concept=draft.concept, source=draft.source, variant=draft.variant),
        )

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
    family_created = False
    namesake: tuple[uuid.UUID, uuid.UUID] | None = None
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
        namesake = await _merged_namesake(
            session,
            organization_id=organization_id,
            concept_id=concept_id,
            source_id=source_id,
            terms=terms,
            length_cm=draft.variant.length_cm,
        )
        if namesake is None:
            family_id = await _resolve_family(
                session,
                organization_id=organization_id,
                new_model=draft.new_model,
                distinction_note=draft.distinction_note,
                concept_id=concept_id,
                source_id=source_id,
                garment_type_id=garment_type_id,
            )
            family_created = True

    if draft.product_family_id is None and namesake is not None:
        # Exactly the name of a merged model whose family went with it: the
        # model that stays (ADR-0008 §4), not the typo made again.
        merged_name, stays = namesake
        redirected_from: uuid.UUID | None = merged_name
        variant = await session.get(ProductVariant, stays)
        if variant is None:  # pragma: no cover - just resolved
            raise NotFoundError("Unknown product variant")
        await session.refresh(variant)
        _require_active(variant, entity="product_variant")
        variant_id, variant_created = variant.id, False
        family_id = variant.product_family_id
    else:
        variant_id, variant_created, redirected_from = await _resolve_variant(
            session,
            organization_id=organization_id,
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
            **({"redirected_from": str(redirected_from)} if redirected_from else {}),
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
        redirected_from=redirected_from,
    )


# ADR-0002 names the "size not known" row: code UNKNOWN in the UNSPECIFIED
# system, flagged `is_unknown`.
UNKNOWN_SIZE_CODE = "UNKNOWN"


async def ensure_unknown_size(session: AsyncSession, *, organization_id: uuid.UUID) -> uuid.UUID:
    """This organization's "size not known" row, created the first time it is needed.

    Business fact F34: legacy stock genuinely exists without a known size, and
    must still be countable, sellable and reconcilable. The state belongs to
    the legacy snapshot import, where the evidence for it exists (M1-023), so
    this is the only path that can create it — `_resolve_sizes` cannot.

    A *regular* size that already uses the code is refused, never converted:
    somebody created it through the structured path and meant something by
    it, and turning it into "unknown" would re-label stock already held
    against it.
    """
    system_id, _ = await _insert_or_select(
        session,
        insert=pg_insert(SizeSystem)
        .values(
            id=uuid.uuid4(),
            organization_id=organization_id,
            code=SizeSystemCode.UNSPECIFIED,
            name=SIZE_SYSTEM_NAMES[SizeSystemCode.UNSPECIFIED],
        )
        .on_conflict_do_nothing(constraint="uq_size_system_org_code")
        .returning(SizeSystem.id),
        existing=select(SizeSystem.id).where(
            SizeSystem.organization_id == organization_id,
            SizeSystem.code == SizeSystemCode.UNSPECIFIED,
        ),
    )
    size_id, created = await _insert_or_select(
        session,
        insert=pg_insert(Size)
        .values(
            id=uuid.uuid4(),
            size_system_id=system_id,
            code=UNKNOWN_SIZE_CODE,
            sort_order=0,
            is_unknown=True,
        )
        .on_conflict_do_nothing(constraint="uq_size_system_code")
        .returning(Size.id),
        existing=select(Size.id).where(
            Size.size_system_id == system_id, Size.code == UNKNOWN_SIZE_CODE
        ),
    )
    if not created and not await session.scalar(select(Size.is_unknown).where(Size.id == size_id)):
        raise CatalogAmbiguousError(
            "A regular size is already named UNKNOWN; it cannot stand for a size nobody knows",
            size_id=str(size_id),
        )
    return size_id


__all__ = [
    "UNKNOWN_SIZE_CODE",
    "ProductDraft",
    "ProductResult",
    "SizeDraft",
    "SizeResult",
    "VariantDraft",
    "create_product",
    "ensure_unknown_size",
    "normalize_label",
]
