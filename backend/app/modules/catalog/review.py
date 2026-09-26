"""Store-scoped review queue and explicit rejection of matcher proposals.

The caller owns the transaction. Rejecting a proposal does not reject an alias:
no identity, learned knowledge or stock is changed by this service.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    CatalogAmbiguousError,
    IdempotencyConflictError,
    NotFoundError,
    ValidationFailedError,
)
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.decisions import _load, _response
from app.modules.catalog.evidence import CatalogMatchDecision, MatchDecisionStatus, RawInput
from app.modules.tenancy.models import Store
from app.modules.tenancy.service import validate_active_stores


async def list_decisions(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    status: MatchDecisionStatus | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """Oldest outstanding proposals first; explicit status includes history.

    Inactive stores retain readable evidence. Pagination is bounded and stable for
    an unchanged queue; a concurrent resolution may remove an item between pages.
    """
    scope.require(Permission.CATALOG_CONFIRM, store_id)
    if not 1 <= limit <= 100 or not 0 <= offset <= 10000:
        raise ValidationFailedError("Invalid review queue pagination")
    found = await session.scalar(
        select(Store.id).where(Store.id == store_id, Store.organization_id == scope.organization_id)
    )
    if found is None:
        raise NotFoundError("Unknown store")
    statuses = (
        (MatchDecisionStatus.PENDING, MatchDecisionStatus.NEEDS_REVIEW)
        if status is None
        else (status,)
    )
    rows = (
        await session.execute(
            select(CatalogMatchDecision, RawInput)
            .join(RawInput, RawInput.id == CatalogMatchDecision.raw_input_id)
            .join(Store, Store.id == RawInput.store_id)
            .where(
                CatalogMatchDecision.organization_id == scope.organization_id,
                RawInput.organization_id == scope.organization_id,
                Store.organization_id == scope.organization_id,
                Store.id == store_id,
                CatalogMatchDecision.status.in_(statuses),
            )
            .order_by(CatalogMatchDecision.created_at, CatalogMatchDecision.id)
            .limit(limit + 1)
            .offset(offset)
            .execution_options(populate_existing=True)
        )
    ).all()
    return {
        "items": [_response(decision, raw) for decision, raw in rows[:limit]],
        "has_more": len(rows) > limit,
    }


async def reject_decision(
    session: AsyncSession,
    *,
    scope: RequestScope,
    decision_id: uuid.UUID,
    reason: str,
) -> dict[str, Any]:
    """Close an unresolved proposal once, preserving its original evidence.

    The decision lock serializes rejection with confirmation. Stale knowledge does
    not prevent rejection: it cannot assert catalog identity. Processing remains
    AMBIGUOUS because the original input has not acquired a resolved identity.
    """
    if not 1 <= len(reason) <= 1000 or not reason.strip() or not is_storable(reason):
        raise ValidationFailedError("Rejection reason must contain 1 to 1000 valid characters")
    decision, raw = await _load(session, scope=scope, decision_id=decision_id, lock=True)
    assert raw.store_id is not None  # guarded by _load
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={raw.store_id}
    )
    if decision.status == MatchDecisionStatus.REJECTED:
        rejection = decision.field_scores.get("rejection")
        if not isinstance(rejection, dict) or rejection.get("reason") != reason:
            raise IdempotencyConflictError("This decision already has a different rejection")
        return _response(decision, raw)
    if decision.status not in (MatchDecisionStatus.PENDING, MatchDecisionStatus.NEEDS_REVIEW):
        raise CatalogAmbiguousError("This decision cannot be rejected")
    previous_status = decision.status
    decision.status = MatchDecisionStatus.REJECTED
    decision.resolved_variant_id = None
    decision.decided_by_user_id = scope.user_id
    decision.field_scores = {
        **decision.field_scores,
        "rejection": {"reason": reason, "actor_user_id": str(scope.user_id)},
    }
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="catalog.match_rejected",
        entity_type="catalog_match_decision",
        entity_id=decision.id,
        before={"status": previous_status.value, "resolved_variant_id": None},
        after={"status": decision.status.value, "resolved_variant_id": None},
        reason=reason,
    )
    return _response(decision, raw)
