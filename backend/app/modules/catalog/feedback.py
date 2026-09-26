"""Explicit alias evidence; caller owns the transaction.

A reviewed decision supplies immutable raw text, never a guessed synonym. This
stage can demote verified mappings but cannot promote learning to VERIFIED.
Retries return the stored event with the alias's *current* counters and status.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import CatalogAmbiguousError, IdempotencyConflictError, ValidationFailedError
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.scope import RequestScope
from app.modules.catalog.decisions import _load, _lock_variant_key, _validate_variant
from app.modules.catalog.evidence import (
    AliasEvidence,
    AliasEvidenceEvent,
    AliasStatus,
    AliasTargetType,
    MatchDecisionStatus,
    ProductAlias,
)
from app.modules.tenancy.service import validate_active_stores


async def _lock(session: AsyncSession, value: bytes) -> None:
    key = int.from_bytes(hashlib.sha256(value).digest()[:8], "big", signed=True)
    await session.execute(select(func.pg_advisory_xact_lock(key)))


def _response(evidence: AliasEvidence, alias: ProductAlias) -> dict[str, Any]:
    return {
        "feedback_id": str(evidence.id),
        "decision_id": str(evidence.decision_id),
        "alias_id": str(alias.id),
        "variant_id": str(alias.target_id),
        "event": evidence.event.value,
        "normalized_phrase": alias.normalized_phrase,
        "status": alias.status.value,
        "confirm_count": alias.confirm_count,
        "reject_count": alias.reject_count,
    }


def _status(alias: ProductAlias, *, competing: bool) -> AliasStatus:
    # Historical ambiguity requires an explicit future resolution workflow.
    # In particular, demoted legacy VERIFIED rows may have zero counters.
    if alias.status == AliasStatus.AMBIGUOUS:
        return AliasStatus.AMBIGUOUS
    if alias.confirm_count and (alias.reject_count or competing):
        return AliasStatus.AMBIGUOUS
    if alias.reject_count:
        return AliasStatus.REJECTED
    if alias.status == AliasStatus.VERIFIED:
        return AliasStatus.AMBIGUOUS if competing else AliasStatus.VERIFIED
    return AliasStatus.LEARNING if alias.confirm_count else AliasStatus.NEW


async def record_alias_feedback(
    session: AsyncSession,
    *,
    scope: RequestScope,
    decision_id: uuid.UUID,
    feedback_id: uuid.UUID,
    variant_id: uuid.UUID,
    event: AliasEvidenceEvent,
) -> dict[str, Any]:
    """One explicit event per decision/mapping; retries never add evidence.

    Lock order: command, target KEY SHARE, phrase, existing alias rows in UUID
    order, then writes (whose triggers acquire the knowledge revision lock).
    No decision row or SHARE revision lock is acquired: terminal review states
    cannot be edited by review services. This avoids a revision lock upgrade and
    the variant-delete/decision-FK lock cycle. Phrase serialization spans targets.
    """
    decision, raw = await _load(session, scope=scope, decision_id=decision_id)
    assert raw.store_id is not None
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={raw.store_id}
    )
    phrase = " ".join(raw.raw_text.casefold().split())
    if not 1 <= len(phrase) <= 200 or not is_storable(phrase):
        raise ValidationFailedError("Alias phrase must contain 1 to 200 valid characters")
    await _lock(session, b"catalog-alias-feedback:" + feedback_id.bytes)
    existing = await session.get(AliasEvidence, feedback_id, populate_existing=True)
    if existing is not None:
        alias = await session.get(ProductAlias, existing.alias_id, populate_existing=True)
        if (
            alias is None
            or alias.organization_id != scope.organization_id
            or alias.target_type != AliasTargetType.VARIANT
            or alias.target_id != variant_id
            or existing.decision_id != decision_id
            or existing.event != event
        ):
            raise IdempotencyConflictError()
        return _response(existing, alias)
    if event == AliasEvidenceEvent.CONFIRM:
        if (
            decision.status != MatchDecisionStatus.APPLIED
            or decision.resolved_variant_id != variant_id
        ):
            raise CatalogAmbiguousError("Confirm the decision with this variant before learning it")
    elif event == AliasEvidenceEvent.REJECT:
        candidates = decision.field_scores.get("preview", {}).get("candidates", [])
        if (
            decision.status not in (MatchDecisionStatus.APPLIED, MatchDecisionStatus.REJECTED)
            or decision.resolved_variant_id == variant_id
            or not any(candidate.get("variant_id") == str(variant_id) for candidate in candidates)
        ):
            raise CatalogAmbiguousError("Reject only an unchosen candidate of a reviewed decision")
    else:
        raise ValidationFailedError("Unknown alias feedback event")
    await _lock_variant_key(session, organization_id=scope.organization_id, variant_id=variant_id)
    # For both events, validate the full tenant chain; unavailable identities
    # require fresh review rather than creating dangling polymorphic aliases.
    await _validate_variant(session, organization_id=scope.organization_id, variant_id=variant_id)
    await _lock(
        session,
        b"catalog-alias-phrase:" + scope.organization_id.bytes + phrase.encode("utf-8"),
    )
    aliases = list(
        (
            await session.scalars(
                select(ProductAlias)
                .where(
                    ProductAlias.organization_id == scope.organization_id,
                    ProductAlias.normalized_phrase == phrase,
                )
                .order_by(ProductAlias.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    alias = next(
        (
            item
            for item in aliases
            if item.target_type == AliasTargetType.VARIANT and item.target_id == variant_id
        ),
        None,
    )
    if alias is None:
        alias_id = await session.scalar(
            insert(ProductAlias)
            .values(
                organization_id=scope.organization_id,
                normalized_phrase=phrase,
                target_type=AliasTargetType.VARIANT,
                target_id=variant_id,
            )
            .on_conflict_do_nothing(constraint="uq_product_alias_org_phrase_target")
            .returning(ProductAlias.id)
        )
        # The unique constraint also protects against writers outside this service.
        alias = await session.scalar(
            select(ProductAlias)
            .where(
                ProductAlias.organization_id == scope.organization_id,
                ProductAlias.normalized_phrase == phrase,
                ProductAlias.target_type == AliasTargetType.VARIANT,
                ProductAlias.target_id == variant_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        assert alias is not None
        assert alias_id is None or alias.id == alias_id
        aliases.append(alias)
    duplicate = await session.scalar(
        select(AliasEvidence.id).where(
            AliasEvidence.alias_id == alias.id, AliasEvidence.decision_id == decision_id
        )
    )
    if duplicate is not None:
        raise IdempotencyConflictError("This decision already supplied evidence for this alias")
    evidence = AliasEvidence(
        id=feedback_id,
        alias_id=alias.id,
        raw_input_id=raw.id,
        decision_id=decision_id,
        event=event,
        actor_user_id=scope.user_id,
    )
    session.add(evidence)
    if event == AliasEvidenceEvent.CONFIRM:
        alias.confirm_count += 1
    else:
        alias.reject_count += 1
    # A verified mapping is positive evidence even if historical counts are zero.
    positive_targets = {
        (item.target_type, item.target_id)
        for item in aliases
        if item.confirm_count or item.status in (AliasStatus.VERIFIED, AliasStatus.AMBIGUOUS)
    }
    for item in aliases:
        item.status = _status(item, competing=len(positive_targets) > 1)
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="catalog.alias_feedback_recorded",
        entity_type="alias_evidence",
        entity_id=evidence.id,
        after=_response(evidence, alias),
    )
    return _response(evidence, alias)
