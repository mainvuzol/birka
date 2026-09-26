"""Durable catalog proposals and explicit confirmation of existing variants."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep
from app.core.text import CleanText
from app.modules.catalog.decisions import confirm_decision, create_decision, get_decision
from app.modules.catalog.evidence import MatchDecisionStatus, MatchDecisionType, MatchMode

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


@router.post("", response_model=DecisionResponse)
async def create(payload: DecisionRequest, scope: ScopeDep, session: SessionDep) -> dict[str, Any]:
    result = await create_decision(session, scope=scope, **payload.model_dump())
    await session.commit()
    return result


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
