"""Correcting a model: renaming it, and what every correction shares (ADR-0008).

The owner decided on 2026-10-03 that the owner and managers correct the
catalogue: rename one model, merge a duplicate into the model that stays,
retire a model and bring it back. Renaming is identity alone, so it lives
here, in `catalog`, which stays a leaf. Merging, retiring and bringing back
must see stock, orders and opening lists, so they live in
`catalog_correction` and use the primitives below:

- **a correction's permanent identity** (`existing_correction`), as a
  receipt's or an adjustment's (I20);
- **holding a model** `FOR UPDATE`, first after the command lock, so a stock
  command that holds it `FOR KEY SHARE` lands wholly before or after (§9);
- **the record** (`record_correction`), with the audit entry beside it.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.errors import (
    CatalogAmbiguousError,
    IdempotencyConflictError,
    ModelMergedError,
    NotFoundError,
    SameAsError,
    ValidationFailedError,
    nothing_recorded,
)
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    CanonicalConcept,
    CatalogCorrection,
    CorrectionKind,
    EntityStatus,
    ProductFamily,
    ProductVariant,
    SourceIdentity,
)
from app.modules.catalog.read import current_variants, describe_variants
from app.modules.catalog.service import (
    NAME_LIMIT,
    VariantDraft,
    _existing_family,
    _resolve_concept,
    _resolve_garment_type,
    _resolve_source,
    _resolve_term,
    family_candidates,
    lock_concept,
    normalize_label,
    same_name,
    typed_words,
)
from app.modules.catalog.similar import refuse_similar
from app.modules.tenancy.service import validate_active_stores

_TERMS = (
    ("color", AttributeKind.COLOR),
    ("material", AttributeKind.MATERIAL),
    ("texture", AttributeKind.TEXTURE),
    ("fur", AttributeKind.FUR),
    ("collar", AttributeKind.COLLAR),
)


@dataclass(frozen=True, slots=True)
class HeldModel:
    """A model's row as read under its `FOR UPDATE` hold."""

    id: uuid.UUID
    product_family_id: uuid.UUID
    status: EntityStatus
    merged_into_id: uuid.UUID | None
    terms: dict[str, uuid.UUID | None]
    length_cm: Decimal | None


async def hold_models(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    variant_ids: set[uuid.UUID],
    lock: bool = True,
) -> dict[uuid.UUID, HeldModel]:
    """Hold models `FOR UPDATE`, in id order, and read them under the hold.

    The first row lock a correction takes (ADR-0008 §9). Plain columns, so a
    correction that waited behind a merge reads the merged row, not one the
    session cached. Unknown and foreign ids are one non-disclosing answer.
    `lock=False` only reads, for a preview.
    """
    statement = (
        select(
            ProductVariant.id,
            ProductVariant.product_family_id,
            ProductVariant.status,
            ProductVariant.merged_into_id,
            *(getattr(ProductVariant, f"{name}_term_id") for name, _ in _TERMS),
            ProductVariant.length_cm,
        )
        .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
        .where(
            ProductVariant.id.in_(variant_ids),
            ProductFamily.organization_id == organization_id,
        )
        .order_by(ProductVariant.id)
    )
    if lock:
        statement = statement.with_for_update(of=ProductVariant)
    rows = (await session.execute(statement)).all()
    held = {
        row[0]: HeldModel(
            id=row[0],
            product_family_id=row[1],
            status=row[2],
            merged_into_id=row[3],
            terms={f"{name}_term_id": row[4 + index] for index, (name, _) in enumerate(_TERMS)},
            length_cm=row[9],
        )
        for row in rows
    }
    if set(held) != variant_ids:
        raise NotFoundError("Unknown product variant")
    return held


async def merge_emptied_family(
    session: AsyncSession, *, family_id: uuid.UUID, into_family_id: uuid.UUID
) -> bool:
    """A family a correction left with no model that is not merged leads to
    the family its model went to (ADR-0008 §3, §5).

    Otherwise the typo a merge or a rename corrected would still be offered
    in family search, where picking it types no word the similar-name check
    could see, and the typo would come back as a new model. The family is
    held `FOR UPDATE` first: creating a model in it holds it `FOR KEY SHARE`
    (`_existing_family`), so that lands wholly before this — and the family
    is not empty — or after it, and is refused. Returns whether it merged.
    """
    if family_id == into_family_id:
        return False
    await session.execute(
        select(ProductFamily.id).where(ProductFamily.id == family_id).with_for_update()
    )
    live = await session.scalar(
        select(ProductVariant.id)
        .where(
            ProductVariant.product_family_id == family_id,
            ProductVariant.status != EntityStatus.MERGED,
        )
        .limit(1)
    )
    if live is not None:
        return False
    await session.execute(
        update(ProductFamily)
        .where(ProductFamily.id == family_id)
        .values(status=EntityStatus.MERGED, merged_into_id=into_family_id)
        .execution_options(synchronize_session="fetch")
    )
    # So `merged_into_id` names a family not merged, in one step.
    await session.execute(
        update(ProductFamily)
        .where(ProductFamily.merged_into_id == family_id)
        .values(merged_into_id=into_family_id)
        .execution_options(synchronize_session="fetch")
    )
    return True


def refuse_merged(model: HeldModel) -> None:
    if model.status is EntityStatus.MERGED:
        raise ModelMergedError(
            product_variant_id=str(model.id), merged_into=str(model.merged_into_id)
        )


def _command_lock_key(organization_id: uuid.UUID, command_id: uuid.UUID) -> int:
    # The key `_permanent_answer` uses for receipts and adjustments: two
    # requests under one `command_id` are by definition one operation.
    digest = hashlib.sha256(organization_id.bytes + command_id.bytes).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


async def existing_correction(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    command_id: uuid.UUID,
    fingerprint: str,
) -> dict[str, Any] | None:
    """Has this correction been made already? Returns what it answered then.

    Taken first, under the command's own lock, before any model is held: the
    same `command_id` is answered with what it did, and another request under
    it is refused. So every refusal after this proves the command recorded
    nothing (ADR-0008 §9).
    """
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:key)"),
        {"key": _command_lock_key(organization_id, command_id)},
    )
    existing = await session.scalar(
        select(CatalogCorrection).where(
            CatalogCorrection.organization_id == organization_id,
            CatalogCorrection.command_id == command_id,
        )
    )
    if existing is None:
        return None
    if existing.command_fingerprint != fingerprint or existing.response_snapshot is None:
        raise IdempotencyConflictError(
            "This command_id was already used with a different request",
            command_id=str(command_id),
        )
    return existing.response_snapshot


async def record_correction(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    result: CorrectionResult,
    command_id: uuid.UUID,
    fingerprint: str,
    correlation_id: str | None,
) -> None:
    """Write the correction, with the answer it gave, and its audit entry, in
    the caller's transaction. The row is never changed afterwards: the
    database refuses an update or a delete (append-only, as the ledger)."""
    if result.correction_id is None:  # pragma: no cover - a no-op is never recorded
        raise ValueError("A recorded correction names itself")
    session.add(
        CatalogCorrection(
            id=result.correction_id,
            organization_id=scope.organization_id,
            kind=result.kind.value,
            product_variant_id=result.product_variant_id,
            into_variant_id=result.into_variant_id,
            acting_store_id=store_id,
            created_by_user_id=scope.user_id,
            command_id=command_id,
            command_fingerprint=fingerprint,
            name_before=result.name_before,
            name_after=result.name_after,
            details=result.details,
            response_snapshot=result.snapshot(),
            correlation_id=correlation_id,
        )
    )
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action=f"catalog.model_{result.kind.value.lower()}",
        entity_type="product_variant",
        entity_id=result.product_variant_id,
        before={"display_name": result.name_before},
        after={
            "display_name": result.name_after,
            "catalog_correction_id": str(result.correction_id),
            **({"into_variant_id": str(result.into_variant_id)} if result.into_variant_id else {}),
            **result.details,
        },
    )


@dataclass(frozen=True, slots=True)
class RenameDraft:
    """A model's whole name, stated again (ADR-0008 §2)."""

    concept: str
    source: str | None
    variant: VariantDraft
    # For a concept that does not exist yet: what the app filled in from the
    # current one and showed the person.
    business_category: str | None = None
    garment_type: str | None = None
    # When the new concept or source could be one of several families.
    product_family_id: uuid.UUID | None = None
    new_model: bool = False
    distinction_note: str | None = None
    similar_confirmed: bool = False

    def fingerprinted(self) -> dict[str, Any]:
        """What makes this rename *this* rename. `similar_confirmed` is out:
        it answers a warning, and changes nothing that is written."""
        return {
            "concept": self.concept,
            "source": self.source,
            "color": self.variant.color,
            "material": self.variant.material,
            "texture": self.variant.texture,
            "fur": self.variant.fur,
            "collar": self.variant.collar,
            "length_cm": None if self.variant.length_cm is None else str(self.variant.length_cm),
            "business_category": self.business_category,
            "garment_type": self.garment_type,
            "product_family_id": (
                None if self.product_family_id is None else str(self.product_family_id)
            ),
            "new_model": self.new_model,
            "distinction_note": self.distinction_note,
        }


@dataclass(frozen=True, slots=True)
class CorrectionResult:
    correction_id: uuid.UUID | None
    kind: CorrectionKind
    product_variant_id: uuid.UUID
    into_variant_id: uuid.UUID | None
    name_before: str
    name_after: str
    status: EntityStatus
    details: dict[str, Any] = field(default_factory=dict)

    def snapshot(self) -> dict[str, Any]:
        return {
            "correction_id": None if self.correction_id is None else str(self.correction_id),
            "kind": self.kind.value,
            "product_variant_id": str(self.product_variant_id),
            "into_variant_id": None if self.into_variant_id is None else str(self.into_variant_id),
            "name_before": self.name_before,
            "name_after": self.name_after,
            "status": self.status.value,
            "details": self.details,
        }


async def _family_for(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    model: HeldModel,
    draft: RenameDraft,
) -> tuple[uuid.UUID, bool]:
    """The family the renamed model belongs in, found as creation finds one.

    Unchanged concept and source keep the model's family. A new concept or
    source asks `_resolve_family` (ADR-0002): a family that could be the same
    is never chosen silently, and with none a family is created with the new
    concept and source and the model's own garment type. Returns the family
    and whether it was created.
    """
    family = await session.get(ProductFamily, model.product_family_id)
    if family is None:  # pragma: no cover - RESTRICT forbids deleting it
        raise NotFoundError("Unknown product family")
    concept = await session.get(CanonicalConcept, family.canonical_concept_id)
    if concept is None:  # pragma: no cover - RESTRICT forbids deleting it
        raise NotFoundError("Unknown canonical concept")
    source = (
        await session.get(SourceIdentity, family.source_identity_id)
        if family.source_identity_id is not None
        else None
    )
    same_concept = normalize_label(draft.concept, limit=NAME_LIMIT) == concept.normalized_name
    same_source = (
        None if draft.source is None else normalize_label(draft.source, limit=NAME_LIMIT)
    ) == (None if source is None else source.normalized_name)
    if same_concept and same_source:
        return family.id, False

    garment_type_id = await _resolve_garment_type(
        session, organization_id=organization_id, name=draft.garment_type
    )
    concept_id, _ = await _resolve_concept(
        session,
        organization_id=organization_id,
        name=draft.concept,
        business_category=draft.business_category,
        garment_type_id=garment_type_id,
    )
    source_id = await _resolve_source(session, organization_id=organization_id, name=draft.source)
    await lock_concept(session, concept_id=concept_id)
    # The model's own family is where it is, not a product it could be: a
    # source added to a model whose family states none must not be answered
    # with that very family, which would drop the source.
    candidates = await family_candidates(
        session,
        organization_id=organization_id,
        concept_id=concept_id,
        source_id=source_id,
        garment_type_id=family.garment_type_id,
        exclude=frozenset({family.id}),
    )
    if draft.product_family_id is not None:
        if draft.product_family_id not in candidates:
            raise ValidationFailedError(
                "The family named is not one this name could be",
                reason="NOT_A_CANDIDATE",
                product_family_id=str(draft.product_family_id),
            )
        chosen = await _existing_family(
            session, organization_id=organization_id, product_family_id=draft.product_family_id
        )
        return chosen.id, False
    if candidates and not draft.new_model:
        raise CatalogAmbiguousError(
            "A product with this name could already exist",
            candidate_family_ids=[str(candidate) for candidate in candidates],
        )
    created = ProductFamily(
        organization_id=organization_id,
        canonical_concept_id=concept_id,
        source_identity_id=source_id,
        garment_type_id=family.garment_type_id,
        distinction_note=draft.distinction_note,
    )
    session.add(created)
    await session.flush()
    return created.id, True


async def _same_as(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    model: HeldModel,
    family_id: uuid.UUID,
    terms: dict[str, uuid.UUID | None],
    length_cm: Decimal | None,
) -> None:
    """Refuse a name that is another model's (`SAME_AS`, naming the model it
    leads to). A merged model that leads to this very one does not stand in
    the way: the model that stays may take the duplicate's name (§4)."""
    holders = (
        await session.execute(
            select(ProductVariant.id, ProductVariant.status)
            .where(*same_name(family_id, terms, length_cm), ProductVariant.id != model.id)
            .order_by(ProductVariant.id)
        )
    ).all()
    if not holders:
        return
    leading = await current_variants(
        session, organization_id=organization_id, variant_ids=[row[0] for row in holders]
    )
    for holder, _status in holders:
        target = leading.get(holder, holder)
        if target != model.id:
            raise SameAsError(same_as=str(target))


async def rename_model(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    product_variant_id: uuid.UUID,
    command_id: uuid.UUID,
    fingerprint: str,
    draft: RenameDraft,
    correlation_id: str | None,
) -> CorrectionResult:
    """Correct one model's name, keeping its id (ADR-0008 §2).

    Its stock, prices, lots, reservations and history stay with it; other
    models that share a word keep it, as the owner chose. Sale, order,
    supplier and «Брак» lines keep the name they froze (I8).

    Does not commit: the caller owns the unit of work.
    """
    scope.require(Permission.CATALOG_MERGE, store_id)
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={store_id}
    )
    note = draft.distinction_note.strip() if draft.distinction_note is not None else None
    if note is not None and (not is_storable(note) or len(note) > 1000):
        raise ValidationFailedError("A distinction note must be at most 1000 storable characters")
    if draft.new_model and not note:
        raise ValidationFailedError("A new model needs a note saying how it is different")

    replay = await existing_correction(
        session,
        organization_id=scope.organization_id,
        command_id=command_id,
        fingerprint=fingerprint,
    )
    if replay is not None:
        return result_from_snapshot(replay)

    with nothing_recorded():
        model = (
            await hold_models(
                session, organization_id=scope.organization_id, variant_ids={product_variant_id}
            )
        )[product_variant_id]
        refuse_merged(model)
        before = (await describe_variants(session, [model.id]))[model.id]

        if not draft.similar_confirmed:
            # Only the words this rename changes: a word the model already carries
            # was answered when it was typed.
            current = {
                "concept": before.snapshot["concept"],
                "source": before.snapshot["source"],
                **{
                    name: before.snapshot["colour" if name == "color" else name]
                    for name, _ in _TERMS
                },
            }
            changed = [
                word
                for word in typed_words(
                    concept=draft.concept, source=draft.source, variant=draft.variant
                )
                if current.get(word.field) is None
                or normalize_label(str(current[word.field]), limit=NAME_LIMIT) != word.normalized
            ]
            await refuse_similar(
                session,
                organization_id=scope.organization_id,
                words=changed,
                # The typo this rename fixes is the model's own, and so is a name
                # a duplicate merged into it left behind.
                ignore=frozenset({model.id}),
            )

        family_id, family_created = await _family_for(
            session,
            organization_id=scope.organization_id,
            model=model,
            draft=RenameDraft(
                concept=draft.concept,
                source=draft.source,
                variant=draft.variant,
                business_category=draft.business_category,
                garment_type=draft.garment_type,
                product_family_id=draft.product_family_id,
                new_model=draft.new_model,
                distinction_note=note,
            ),
        )
        terms: dict[str, uuid.UUID | None] = {}
        for name, kind in _TERMS:
            terms[f"{name}_term_id"] = await _resolve_term(
                session,
                organization_id=scope.organization_id,
                kind=kind,
                name=getattr(draft.variant, name),
            )
        length_cm = draft.variant.length_cm

        if (
            family_id == model.product_family_id
            and terms == model.terms
            and length_cm == model.length_cm
        ):
            # A name that changes nothing is answered as it is, and recorded nowhere.
            return CorrectionResult(
                correction_id=None,
                kind=CorrectionKind.RENAME,
                product_variant_id=model.id,
                into_variant_id=None,
                name_before=before.display_name,
                name_after=before.display_name,
                status=model.status,
            )

        await _same_as(
            session,
            organization_id=scope.organization_id,
            model=model,
            family_id=family_id,
            terms=terms,
            length_cm=length_cm,
        )
        variant = await session.get(ProductVariant, model.id)
        if variant is None:  # pragma: no cover - held above
            raise NotFoundError("Unknown product variant")
        try:
            # A model given this name at the same moment surfaces here as the
            # unique key's violation, and is answered as `SAME_AS` too.
            async with session.begin_nested():
                variant.product_family_id = family_id
                for column, value in terms.items():
                    setattr(variant, column, value)
                variant.length_cm = length_cm
                await session.flush()
        except IntegrityError as exc:
            if "uq_product_variant_attributes" not in str(exc.orig):
                raise
            holder = await session.scalar(
                select(ProductVariant.id).where(
                    *same_name(family_id, terms, length_cm),
                    ProductVariant.status != EntityStatus.MERGED,
                    ProductVariant.id != model.id,
                )
            )
            raise SameAsError(same_as=str(holder) if holder else None) from exc

        after = (await describe_variants(session, [model.id]))[model.id]
        family_merged = await merge_emptied_family(
            session, family_id=model.product_family_id, into_family_id=family_id
        )
        details = {
            "before": _words(model.product_family_id, model.terms, model.length_cm),
            "after": _words(family_id, terms, length_cm),
            "family_created": family_created,
            "family_merged": family_merged,
        }
        result = CorrectionResult(
            correction_id=uuid.uuid4(),
            kind=CorrectionKind.RENAME,
            product_variant_id=model.id,
            into_variant_id=None,
            name_before=before.display_name,
            name_after=after.display_name,
            status=model.status,
            details=details,
        )
        await record_correction(
            session,
            scope=scope,
            store_id=store_id,
            result=result,
            command_id=command_id,
            fingerprint=fingerprint,
            correlation_id=correlation_id,
        )
        return result


def _words(
    family_id: uuid.UUID, terms: dict[str, uuid.UUID | None], length_cm: Decimal | None
) -> dict[str, Any]:
    return {
        "product_family_id": str(family_id),
        **{column: None if value is None else str(value) for column, value in terms.items()},
        "length_cm": None if length_cm is None else str(length_cm),
    }


def result_from_snapshot(snapshot: dict[str, Any]) -> CorrectionResult:
    return CorrectionResult(
        correction_id=(
            None if snapshot["correction_id"] is None else uuid.UUID(snapshot["correction_id"])
        ),
        kind=CorrectionKind(snapshot["kind"]),
        product_variant_id=uuid.UUID(snapshot["product_variant_id"]),
        into_variant_id=(
            None if snapshot["into_variant_id"] is None else uuid.UUID(snapshot["into_variant_id"])
        ),
        name_before=snapshot["name_before"],
        name_after=snapshot["name_after"],
        status=EntityStatus(snapshot["status"]),
        details=snapshot.get("details") or {},
    )


# ---------------------------------------------------------------------------
# Finding a model to correct
# ---------------------------------------------------------------------------


def _literal_pattern(value: str) -> str:
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


async def search_models(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    query: str = "",
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """Models a person correcting the catalogue may open, retired ones too.

    Every word must match the model, the source or the colour, as in
    receiving's search. A match on a merged model's name leads to the model
    that stays (ADR-0008 §5), listed once.
    """
    scope.require(Permission.CATALOG_MERGE, store_id)
    if not 1 <= limit <= 50 or not 0 <= offset <= 10000:
        raise ValidationFailedError("Invalid model search pagination")
    if len(query) > 200 or not is_storable(query):
        raise ValidationFailedError("Search text must contain at most 200 valid characters")
    colour = aliased(AttributeTerm)
    leading = func.coalesce(ProductVariant.merged_into_id, ProductVariant.id)
    matched = (
        select(leading.label("variant_id"), CanonicalConcept.normalized_name.label("sort_name"))
        .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
        .join(CanonicalConcept, CanonicalConcept.id == ProductFamily.canonical_concept_id)
        .outerjoin(SourceIdentity, SourceIdentity.id == ProductFamily.source_identity_id)
        .outerjoin(colour, colour.id == ProductVariant.color_term_id)
        .where(
            ProductFamily.organization_id == scope.organization_id,
            CanonicalConcept.organization_id == scope.organization_id,
        )
    )
    for word in query.casefold().split():
        pattern = _literal_pattern(word)
        matched = matched.where(
            or_(
                CanonicalConcept.normalized_name.like(pattern, escape="\\"),
                SourceIdentity.normalized_name.like(pattern, escape="\\"),
                colour.normalized_name.like(pattern, escape="\\"),
            )
        )
    found = matched.subquery()
    stays = aliased(ProductVariant)
    stays_family = aliased(ProductFamily)
    statement = (
        select(found.c.variant_id, stays.status)
        .join(stays, stays.id == found.c.variant_id)
        .join(stays_family, stays_family.id == stays.product_family_id)
        .where(
            stays.status != EntityStatus.MERGED,
            stays_family.organization_id == scope.organization_id,
        )
        .group_by(found.c.variant_id, stays.status)
        .order_by(func.min(found.c.sort_name), found.c.variant_id)
        .limit(limit + 1)
        .offset(offset)
    )
    rows = (await session.execute(statement)).all()
    page = rows[:limit]
    names = await describe_variants(session, [row[0] for row in page])
    return {
        "items": [
            {
                "product_variant_id": variant_id,
                "display_name": names[variant_id].display_name,
                "status": status.value,
            }
            for variant_id, status in page
        ],
        "has_more": len(rows) > limit,
    }


async def model_card(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    product_variant_id: uuid.UUID,
) -> dict[str, Any]:
    """One model as a person correcting it sees it: its words and its state."""
    scope.require(Permission.CATALOG_MERGE, store_id)
    row = (
        await session.execute(
            select(ProductVariant.id, ProductVariant.status, ProductVariant.merged_into_id)
            .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
            .where(
                ProductVariant.id == product_variant_id,
                ProductFamily.organization_id == scope.organization_id,
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Unknown product variant")
    _, status, merged_into = row
    ids = [product_variant_id] + ([merged_into] if merged_into else [])
    described = await describe_variants(session, ids)
    snapshot = described[product_variant_id].snapshot
    return {
        "product_variant_id": product_variant_id,
        "display_name": described[product_variant_id].display_name,
        "status": status.value,
        "merged_into": (
            {
                "product_variant_id": merged_into,
                "display_name": described[merged_into].display_name,
            }
            if merged_into and merged_into in described
            else None
        ),
        "product_family_id": uuid.UUID(snapshot["product_family_id"]),
        "concept": snapshot["concept"],
        "source": snapshot["source"],
        "color": snapshot["colour"],
        "material": snapshot["material"],
        "texture": snapshot["texture"],
        "fur": snapshot["fur"],
        "collar": snapshot["collar"],
        "length_cm": snapshot["length_cm"],
        "business_category": snapshot["business_category"],
        "garment_type": snapshot["family_garment_type"] or snapshot["concept_garment_type"],
        "distinction_note": snapshot["family_distinction_note"],
    }


__all__ = [
    "CorrectionResult",
    "HeldModel",
    "RenameDraft",
    "existing_correction",
    "hold_models",
    "merge_emptied_family",
    "model_card",
    # Lives in `app.core.errors` since every seller's command uses it
    # (ADR-0013 §1); kept here for `catalog/intake.py` and
    # `catalog_correction/service.py`, which import it from this module.
    "nothing_recorded",
    "record_correction",
    "refuse_merged",
    "rename_model",
    "result_from_snapshot",
    "search_models",
]
