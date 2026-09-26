"""Durable human review of matcher proposals, without catalog or stock mutation.

The caller owns the transaction. Original parser/matcher evidence is retained
beside the eventual human resolution, including on idempotent command retries.
"""

from __future__ import annotations

import hashlib
import uuid
from decimal import Decimal
from typing import Any, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    CatalogAmbiguousError,
    IdempotencyConflictError,
    NotFoundError,
    ValidationFailedError,
)
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.evidence import (
    CatalogMatchDecision,
    MatchDecisionStatus,
    MatchDecisionType,
    MatchMode,
    ParseResult,
    ProcessingStatus,
    RawInput,
    RawInputProcessing,
    RawInputSource,
)
from app.modules.catalog.knowledge import lock_knowledge_revision
from app.modules.catalog.matching import preview_match
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    BusinessCategory,
    CanonicalConcept,
    EntityStatus,
    GarmentType,
    ProductFamily,
    ProductVariant,
    SourceIdentity,
)
from app.modules.tenancy.models import Store
from app.modules.tenancy.service import validate_active_stores


def _response(decision: CatalogMatchDecision, raw: RawInput) -> dict[str, Any]:
    return {
        "decision_id": str(decision.id),
        "store_id": str(raw.store_id),
        "raw_input_id": str(raw.id),
        "parse_result_id": str(decision.parse_result_id),
        "decision_type": decision.decision_type.value,
        "status": decision.status.value,
        "mode": decision.mode.value,
        "knowledge_revision": decision.knowledge_revision,
        "resolved_variant_id": (
            str(decision.resolved_variant_id) if decision.resolved_variant_id else None
        ),
        "requires_confirmation": decision.status != MatchDecisionStatus.APPLIED,
        "preview": decision.field_scores["preview"],
    }


async def _load(
    session: AsyncSession,
    *,
    scope: RequestScope,
    decision_id: uuid.UUID,
    lock: bool = False,
) -> tuple[CatalogMatchDecision, RawInput]:
    query = (
        select(CatalogMatchDecision, RawInput)
        .join(RawInput, RawInput.id == CatalogMatchDecision.raw_input_id)
        .join(Store, Store.id == RawInput.store_id)
        .where(
            CatalogMatchDecision.id == decision_id,
            CatalogMatchDecision.organization_id == scope.organization_id,
            RawInput.organization_id == scope.organization_id,
            Store.organization_id == scope.organization_id,
        )
    )
    if lock:
        query = query.with_for_update(of=CatalogMatchDecision)
    row = (await session.execute(query.execution_options(populate_existing=True))).one_or_none()
    if row is None:
        raise NotFoundError("Unknown catalog decision")
    decision, raw = row
    if raw.store_id is None:  # guarded by the store join
        raise NotFoundError("Unknown catalog decision")
    scope.require(Permission.CATALOG_CONFIRM, raw.store_id)
    return decision, raw


async def get_decision(
    session: AsyncSession, *, scope: RequestScope, decision_id: uuid.UUID
) -> dict[str, Any]:
    """Read historical evidence after rechecking current store permissions."""
    decision, raw = await _load(session, scope=scope, decision_id=decision_id)
    return _response(decision, raw)


def _score(value: str | None) -> Decimal | None:
    return Decimal(value).quantize(Decimal("0.001")) if value is not None else None


async def _lock_variant_key(
    session: AsyncSession, *, organization_id: uuid.UUID, variant_id: uuid.UUID
) -> None:
    """Protect a future FK without blocking non-key catalog edits.

    Acquire this before decision and knowledge locks: DELETE takes the variant
    lock before its FK action can lock a referring decision. Reversing that
    order can deadlock, even when the eventual revision check would reject it.
    """
    found = await session.scalar(
        select(ProductVariant.id)
        .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
        .where(
            ProductVariant.id == variant_id,
            ProductFamily.organization_id == organization_id,
        )
        .with_for_update(read=True, key_share=True, of=ProductVariant)
    )
    if found is None:
        raise CatalogAmbiguousError("Catalog variant changed; submit a new proposal")


async def create_decision(
    session: AsyncSession,
    *,
    scope: RequestScope,
    decision_id: uuid.UUID,
    store_id: uuid.UUID,
    raw_text: str,
    family_id: uuid.UUID | None = None,
    concept_name: str | None = None,
    business_category_name: str | None = None,
) -> dict[str, Any]:
    """Save a proposal once; the UUID names the exact input and request context."""
    scope.require(Permission.CATALOG_CONFIRM, store_id)
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={store_id}
    )
    request = {
        "store_id": str(store_id),
        "raw_text": raw_text,
        "family_id": str(family_id) if family_id else None,
        "concept_name": concept_name,
        "business_category_name": business_category_name,
    }
    # A separate namespace prevents accidental overlap with catalog family locks.
    key = int.from_bytes(
        hashlib.sha256(b"catalog-decision:" + decision_id.bytes).digest()[:8],
        "big",
        signed=True,
    )
    await session.execute(select(func.pg_advisory_xact_lock(key)))
    existing = await session.get(CatalogMatchDecision, decision_id)
    if existing is not None:
        decision, raw = await _load(session, scope=scope, decision_id=decision_id)
        if decision.field_scores.get("request") != request:
            raise IdempotencyConflictError()
        return _response(decision, raw)

    preview = (
        await preview_match(
            session,
            organization_id=scope.organization_id,
            raw_text=raw_text,
            family_id=family_id,
            concept_name=concept_name,
            business_category_name=business_category_name,
            limit=20,
        )
    ).to_dict()
    candidates = preview["candidates"]
    top = candidates[0] if candidates else None
    if top:
        await _lock_variant_key(
            session,
            organization_id=scope.organization_id,
            variant_id=uuid.UUID(top["variant_id"]),
        )
    revision = await lock_knowledge_revision(session, scope.organization_id)
    if revision != preview["knowledge_revision"]:
        raise CatalogAmbiguousError("Catalog knowledge changed; submit a new proposal")
    parsed = preview["parser_preview"]
    raw = RawInput(
        organization_id=scope.organization_id,
        store_id=store_id,
        source_kind=RawInputSource.API,
        raw_text=raw_text,
        content_hash=hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
        created_by_user_id=scope.user_id,
    )
    session.add(raw)
    await session.flush()
    parse = ParseResult(
        raw_input_id=raw.id,
        parser_version=preview["parser_version"],
        parsed=parsed,
        field_confidence={
            name: [candidate["confidence"] for candidate in candidates]
            for name, candidates in parsed["fields"].items()
        },
        unclassified=parsed["unclassified_descriptors"],
    )
    session.add(parse)
    await session.flush()
    decision = CatalogMatchDecision(
        id=decision_id,
        organization_id=scope.organization_id,
        raw_input_id=raw.id,
        parse_result_id=parse.id,
        decision_type=MatchDecisionType(preview["decision_type"]),
        top_candidate_variant_id=uuid.UUID(top["variant_id"]) if top else None,
        top_score=_score(top["score"]) if top else None,
        second_score=_score(candidates[1]["score"]) if len(candidates) > 1 else None,
        margin=_score(preview["margin"]),
        field_scores={"request": request, "preview": preview},
        conflicts=top["conflicts"] if top else [],
        matcher_version=preview["matcher_version"],
        knowledge_revision=preview["knowledge_revision"],
        mode=MatchMode.MANUAL,
        status=MatchDecisionStatus.NEEDS_REVIEW,
    )
    session.add(decision)
    session.add(
        RawInputProcessing(
            raw_input_id=raw.id,
            status=ProcessingStatus.AMBIGUOUS,
            attempts=1,
            parser_version=parse.parser_version,
            last_parse_result_id=parse.id,
        )
    )
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="catalog.match_proposed",
        entity_type="catalog_match_decision",
        entity_id=decision.id,
        after={"decision_type": decision.decision_type.value, "raw_input_id": str(raw.id)},
    )
    return _response(decision, raw)


async def _validate_variant(
    session: AsyncSession, *, organization_id: uuid.UUID, variant_id: uuid.UUID
) -> ProductFamily:
    # Single-column foreign keys do not themselves enforce tenant integrity.
    row = (
        await session.execute(
            select(ProductVariant, ProductFamily, CanonicalConcept)
            .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
            .join(CanonicalConcept, CanonicalConcept.id == ProductFamily.canonical_concept_id)
            .where(
                ProductVariant.id == variant_id,
                ProductVariant.status == EntityStatus.ACTIVE,
                ProductFamily.organization_id == organization_id,
                ProductFamily.status == EntityStatus.ACTIVE,
                CanonicalConcept.organization_id == organization_id,
                CanonicalConcept.status == EntityStatus.ACTIVE,
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Unknown active catalog variant")
    variant, family, concept = row
    for model, identifier in (
        (SourceIdentity, family.source_identity_id),
        (GarmentType, family.garment_type_id),
        (GarmentType, concept.garment_type_id),
        (BusinessCategory, concept.business_category_id),
    ):
        if identifier is not None:
            found = await session.scalar(
                select(model.id).where(
                    model.id == identifier, model.organization_id == organization_id
                )
            )
            if found is None:
                raise NotFoundError("Unknown active catalog variant")
    for name in ("color", "material", "texture", "fur", "collar"):
        term_id = getattr(variant, f"{name}_term_id")
        if term_id is not None:
            found = await session.scalar(
                select(AttributeTerm.id).where(
                    AttributeTerm.id == term_id,
                    AttributeTerm.organization_id == organization_id,
                    AttributeTerm.kind == AttributeKind(name.upper()),
                    AttributeTerm.status == EntityStatus.ACTIVE,
                )
            )
            if found is None:
                raise NotFoundError("Unknown active catalog variant")
    return cast(ProductFamily, family)


async def confirm_decision(
    session: AsyncSession,
    *,
    scope: RequestScope,
    decision_id: uuid.UUID,
    variant_id: uuid.UUID,
    expected_knowledge_revision: int,
) -> dict[str, Any]:
    """Resolve existing identity explicitly; never learn aliases or move stock."""
    if expected_knowledge_revision < 0:
        raise ValidationFailedError("Knowledge revision must be nonnegative")
    observed, _ = await _load(session, scope=scope, decision_id=decision_id)
    if observed.status != MatchDecisionStatus.APPLIED:
        # Protect both FK targets before locking the decision. A manual choice
        # may differ from the original top candidate, whose deletion also has
        # a referential action against this decision row.
        targets = {variant_id}
        if observed.top_candidate_variant_id is not None:
            targets.add(observed.top_candidate_variant_id)
        for target in sorted(targets):
            await _lock_variant_key(
                session, organization_id=scope.organization_id, variant_id=target
            )
    decision, raw = await _load(session, scope=scope, decision_id=decision_id, lock=True)
    assert raw.store_id is not None  # validated by _load
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={raw.store_id}
    )
    if decision.status == MatchDecisionStatus.APPLIED:
        if (
            decision.resolved_variant_id != variant_id
            or expected_knowledge_revision != decision.knowledge_revision
        ):
            raise IdempotencyConflictError("This decision already has a different resolution")
        return _response(decision, raw)
    if decision.status not in (MatchDecisionStatus.PENDING, MatchDecisionStatus.NEEDS_REVIEW):
        raise CatalogAmbiguousError("This decision cannot be confirmed")
    # Catalog triggers lock and increment this row before changes can commit.
    # Holding SHARE prevents knowledge changes until this resolution commits.
    revision = await lock_knowledge_revision(session, scope.organization_id)
    if (
        revision is None
        or revision != decision.knowledge_revision
        or revision != expected_knowledge_revision
    ):
        raise CatalogAmbiguousError("Catalog knowledge changed; submit a new proposal")
    family = await _validate_variant(
        session, organization_id=scope.organization_id, variant_id=variant_id
    )
    requested_family = decision.field_scores["request"].get("family_id")
    if requested_family is not None and requested_family != str(family.id):
        raise CatalogAmbiguousError("Selected variant does not belong to the requested family")
    original_type = decision.decision_type
    decision.decision_type = MatchDecisionType.SAME_VARIANT
    decision.resolved_variant_id = variant_id
    decision.status = MatchDecisionStatus.APPLIED
    decision.mode = (
        MatchMode.CONFIRMED
        if original_type == MatchDecisionType.SAME_VARIANT
        and decision.top_candidate_variant_id == variant_id
        else MatchMode.MANUAL
    )
    decision.decided_by_user_id = scope.user_id
    processing = await session.get(RawInputProcessing, raw.id)
    if processing is None:
        raise CatalogAmbiguousError("Missing processing state for this decision")
    processing.status = ProcessingStatus.RESOLVED
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="catalog.match_confirmed",
        entity_type="catalog_match_decision",
        entity_id=decision.id,
        before={"decision_type": original_type.value, "resolved_variant_id": None},
        after={"resolved_variant_id": str(variant_id), "mode": decision.mode.value},
    )
    return _response(decision, raw)
