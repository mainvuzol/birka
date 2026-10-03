"""Explicit structured catalog creation tied permanently to reviewed raw evidence.

The decision UUID is the command identity. The caller owns the transaction.
Unlike confirming a matcher candidate, this command accepts a fresh human draft
against current catalog rules; old preview revisions do not assert identity.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import CatalogAmbiguousError, IdempotencyConflictError
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.decisions import _load, _lock_variant_key, _response, _validate_variant
from app.modules.catalog.evidence import (
    MatchDecisionStatus,
    MatchDecisionType,
    MatchMode,
    ProcessingStatus,
    RawInputProcessing,
)
from app.modules.catalog.knowledge import lock_knowledge_revision
from app.modules.catalog.service import ProductDraft, create_product
from app.modules.tenancy.service import validate_active_stores


async def create_product_from_decision(
    session: AsyncSession,
    *,
    scope: RequestScope,
    decision_id: uuid.UUID,
    store_id: uuid.UUID,
    draft: ProductDraft,
    similar_confirmed: bool = False,
) -> dict[str, Any]:
    """Create or reuse only the identity explicitly supplied by the reviewer.

    No parsing, alias feedback, stock or money writes happen here. The original
    matcher snapshot remains unchanged beside the exact structured command.
    """
    observed, raw = await _load(session, scope=scope, decision_id=decision_id)
    assert raw.store_id is not None
    scope.require(Permission.CATALOG_CREATE, raw.store_id)
    if store_id != raw.store_id:
        raise CatalogAmbiguousError("Product creation must use the original decision store")
    # The preview's FK may be deleted concurrently. Protect it before locking
    # the referring decision, matching confirmation's lock order.
    if observed.status != MatchDecisionStatus.APPLIED and observed.top_candidate_variant_id:
        await _lock_variant_key(
            session,
            organization_id=scope.organization_id,
            variant_id=observed.top_candidate_variant_id,
        )
    decision, raw = await _load(session, scope=scope, decision_id=decision_id, lock=True)
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={store_id}
    )
    request = {"store_id": str(store_id), **json.loads(json.dumps(asdict(draft), default=str))}
    if decision.status == MatchDecisionStatus.APPLIED:
        creation = decision.field_scores.get("creation")
        if not isinstance(creation, dict) or creation.get("request") != request:
            raise IdempotencyConflictError("This decision already has a different resolution")
        return _response(decision, raw)
    if decision.status not in (MatchDecisionStatus.PENDING, MatchDecisionStatus.NEEDS_REVIEW):
        raise CatalogAmbiguousError("This decision cannot create a product")
    requested_family = decision.field_scores["request"].get("family_id")
    if requested_family is not None and requested_family != str(draft.product_family_id):
        raise CatalogAmbiguousError("Selected product does not belong to the requested family")
    processing = await session.get(RawInputProcessing, raw.id)
    if processing is None:
        raise CatalogAmbiguousError("Missing processing state for this decision")

    # Do not take a SHARE knowledge lock: catalog writes increment the revision
    # themselves. This is a manual draft, not acceptance of the stale preview.
    result = await create_product(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        draft=draft,
        similar_confirmed=similar_confirmed,
    )
    # All catalog writes have finished. Protect the final FK, then freeze the
    # revision while validating: a fully reused variant may have made no writes
    # and therefore acquired no revision lock of its own.
    await _lock_variant_key(
        session, organization_id=scope.organization_id, variant_id=result.product_variant_id
    )
    await lock_knowledge_revision(session, scope.organization_id)
    # Single-column catalog FKs are insufficient to enforce tenant integrity.
    # Refuse malformed or inactive reused identity chains before committing.
    await _validate_variant(
        session, organization_id=scope.organization_id, variant_id=result.product_variant_id
    )
    product = json.loads(json.dumps(asdict(result), default=str))
    original_type = decision.decision_type
    decision.decision_type = (
        MatchDecisionType.NEW_MODEL
        if result.family_created
        else MatchDecisionType.NEW_VARIANT
        if result.variant_created
        else MatchDecisionType.SAME_VARIANT
    )
    decision.status = MatchDecisionStatus.APPLIED
    decision.mode = MatchMode.MANUAL
    decision.resolved_variant_id = result.product_variant_id
    decision.decided_by_user_id = scope.user_id
    decision.field_scores = {
        **decision.field_scores,
        "creation": {"request": request, "result": product, "actor_user_id": str(scope.user_id)},
    }
    processing.status = ProcessingStatus.RESOLVED
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="catalog.product_created_from_decision",
        entity_type="catalog_match_decision",
        entity_id=decision.id,
        before={"decision_type": original_type.value, "resolved_variant_id": None},
        after={
            "decision_type": decision.decision_type.value,
            "resolved_variant_id": str(result.product_variant_id),
            "family_created": result.family_created,
            "variant_created": result.variant_created,
        },
    )
    return _response(decision, raw)
