"""Durable catalog proposals and explicit confirmation of existing variants."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import DBAPIError

from app.api.deps import ScopeDep, SessionDep
from app.api.v1.catalog import ProductRequest, ProductResponse
from app.core.errors import CatalogAmbiguousError
from app.core.text import CleanText
from app.modules.catalog.decisions import confirm_decision, create_decision, get_decision
from app.modules.catalog.evidence import (
    AliasEvidenceEvent,
    AliasStatus,
    MatchDecisionStatus,
    MatchDecisionType,
    MatchMode,
)
from app.modules.catalog.feedback import record_alias_feedback
from app.modules.catalog.intake import create_product_from_decision
from app.modules.catalog.review import list_decisions, reject_decision
from app.modules.catalog.service import ProductDraft, SizeDraft, VariantDraft

router = APIRouter(prefix="/catalog/match-decisions", tags=["catalog"])


class DecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision_id: uuid.UUID
    store_id: uuid.UUID
    raw_text: CleanText = Field(min_length=1, max_length=2000)
    family_id: uuid.UUID | None = None
    concept_name: CleanText | None = Field(default=None, min_length=1, max_length=200)
    business_category_name: CleanText | None = Field(default=None, min_length=1, max_length=120)


class ConfirmationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    variant_id: uuid.UUID
    expected_knowledge_revision: int = Field(ge=0)


class RejectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: CleanText = Field(min_length=1, max_length=1000)


class RejectionFeedback(BaseModel):
    reason: str
    actor_user_id: uuid.UUID


class DecisionResponse(BaseModel):
    decision_id: uuid.UUID
    store_id: uuid.UUID
    raw_input_id: uuid.UUID
    parse_result_id: uuid.UUID
    decision_type: MatchDecisionType
    status: MatchDecisionStatus
    mode: MatchMode
    knowledge_revision: int
    resolved_variant_id: uuid.UUID | None
    requires_confirmation: bool
    preview: dict[str, Any]
    rejection: RejectionFeedback | None = None
    creation: ProductResponse | None = None


@router.post("", response_model=DecisionResponse)
async def create(payload: DecisionRequest, scope: ScopeDep, session: SessionDep) -> dict[str, Any]:
    result = await create_decision(session, scope=scope, **payload.model_dump())
    await session.commit()
    return result


class DecisionListResponse(BaseModel):
    items: list[DecisionResponse]
    has_more: bool


@router.get("", response_model=DecisionListResponse)
async def review_queue(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    status: MatchDecisionStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=10000)] = 0,
) -> dict[str, Any]:
    return await list_decisions(
        session,
        scope=scope,
        store_id=store_id,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.get("/{decision_id}", response_model=DecisionResponse)
async def read(decision_id: uuid.UUID, scope: ScopeDep, session: SessionDep) -> dict[str, Any]:
    return await get_decision(session, scope=scope, decision_id=decision_id)


@router.post("/{decision_id}/confirm", response_model=DecisionResponse)
async def confirm(
    decision_id: uuid.UUID,
    payload: ConfirmationRequest,
    scope: ScopeDep,
    session: SessionDep,
) -> dict[str, Any]:
    result = await confirm_decision(
        session,
        scope=scope,
        decision_id=decision_id,
        variant_id=payload.variant_id,
        expected_knowledge_revision=payload.expected_knowledge_revision,
    )
    await session.commit()
    return result


@router.post("/{decision_id}/reject", response_model=DecisionResponse)
async def reject(
    decision_id: uuid.UUID,
    payload: RejectionRequest,
    scope: ScopeDep,
    session: SessionDep,
) -> dict[str, Any]:
    result = await reject_decision(
        session,
        scope=scope,
        decision_id=decision_id,
        reason=payload.reason,
    )
    await session.commit()
    return result


class AliasFeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feedback_id: uuid.UUID
    variant_id: uuid.UUID
    event: AliasEvidenceEvent


class AliasFeedbackResponse(BaseModel):
    feedback_id: uuid.UUID
    decision_id: uuid.UUID
    alias_id: uuid.UUID
    variant_id: uuid.UUID
    event: AliasEvidenceEvent
    normalized_phrase: str
    status: AliasStatus
    confirm_count: int
    reject_count: int


@router.post("/{decision_id}/alias-feedback", response_model=AliasFeedbackResponse)
async def alias_feedback(
    decision_id: uuid.UUID,
    payload: AliasFeedbackRequest,
    scope: ScopeDep,
    session: SessionDep,
) -> dict[str, Any]:
    result = await record_alias_feedback(
        session,
        scope=scope,
        decision_id=decision_id,
        feedback_id=payload.feedback_id,
        variant_id=payload.variant_id,
        event=payload.event,
    )
    await session.commit()
    return result


@router.post("/{decision_id}/create-product", response_model=DecisionResponse)
async def create_reviewed_product(
    decision_id: uuid.UUID,
    payload: ProductRequest,
    scope: ScopeDep,
    session: SessionDep,
) -> dict[str, Any]:
    # Retry the whole command, including commit. A database-selected deadlock
    # victim has no durable effects, so the permanent decision identity remains
    # safe. Other DB failures must not be disguised as a transient conflict.
    for attempt in range(3):
        try:
            result = await create_product_from_decision(
                session,
                scope=scope,
                decision_id=decision_id,
                store_id=payload.store_id,
                draft=ProductDraft(
                    concept=payload.concept,
                    source=payload.source,
                    business_category=payload.business_category,
                    garment_type=payload.garment_type,
                    product_family_id=payload.product_family_id,
                    new_model=payload.new_model,
                    distinction_note=payload.distinction_note,
                    variant=VariantDraft(**payload.variant.model_dump()),
                    sizes=tuple(
                        SizeDraft(system=size.system, code=size.code) for size in payload.sizes
                    ),
                ),
            )
            await session.commit()
            return result
        except DBAPIError as exc:
            code = getattr(exc.orig, "sqlstate", None) or getattr(exc.orig, "pgcode", None)
            if code not in {"40P01", "40001"}:
                raise
            await session.rollback()
            if attempt == 2:
                raise CatalogAmbiguousError(
                    "Catalog changed concurrently; retry this same product request",
                    retryable=True,
                ) from exc
    raise AssertionError("Unreachable retry state")
