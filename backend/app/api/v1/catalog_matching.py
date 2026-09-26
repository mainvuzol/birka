"""Read-only matcher proposals; authorization precedes catalog retrieval."""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep
from app.core.text import CleanText
from app.modules.authz.permissions import Permission
from app.modules.catalog.matching import duplicate_family_signatures, preview_match

router = APIRouter(prefix="/catalog", tags=["catalog"])


class MatchPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    store_id: uuid.UUID
    raw_text: CleanText = Field(min_length=1, max_length=2000)
    family_id: uuid.UUID | None = None
    concept_name: CleanText | None = Field(default=None, min_length=1, max_length=200)
    business_category_name: CleanText | None = Field(default=None, min_length=1, max_length=120)
    limit: int = Field(default=10, ge=1, le=20)


class CandidateResponse(BaseModel):
    variant_id: uuid.UUID
    family_id: uuid.UUID
    display_name: str
    score: str
    distinction_note: str | None = None
    field_scores: dict[str, Any]
    conflicts: list[str]
    reasons: list[str]


class MatchPreviewResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    matcher_version: str
    parser_version: str
    requires_confirmation: Literal[True]
    resolved_variant_id: None
    decision_type: Literal["SAME_VARIANT", "NEW_VARIANT", "NEW_MODEL", "NEW_CATEGORY", "AMBIGUOUS"]
    knowledge_fingerprint: str
    knowledge_revision: int
    parser_preview: dict[str, Any]
    candidates: list[CandidateResponse]
    margin: str | None
    review_reasons: list[str]
    truncated: bool


@router.post("/match-preview", response_model=MatchPreviewResponse)
async def match_preview(
    payload: MatchPreviewRequest, scope: ScopeDep, session: SessionDep
) -> dict[str, Any]:
    scope.require(Permission.CATALOG_CONFIRM, payload.store_id)
    result = await preview_match(
        session,
        organization_id=scope.organization_id,
        raw_text=payload.raw_text,
        family_id=payload.family_id,
        concept_name=payload.concept_name,
        business_category_name=payload.business_category_name,
        limit=payload.limit,
    )
    return result.to_dict()


class DuplicateFamilyResponse(BaseModel):
    family_id: uuid.UUID
    distinction_note: str | None


class DuplicateSignatureResponse(BaseModel):
    canonical_concept_id: uuid.UUID
    source_identity_id: uuid.UUID | None
    garment_type_id: uuid.UUID | None
    family_count: int
    families_truncated: bool
    families: list[DuplicateFamilyResponse]


class DuplicateReportResponse(BaseModel):
    groups: list[DuplicateSignatureResponse]
    has_more: bool
    requires_confirmation: Literal[True]


@router.get("/duplicate-families", response_model=DuplicateReportResponse)
async def duplicates(
    scope: ScopeDep,
    session: SessionDep,
    store_id: uuid.UUID,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0, le=10000)] = 0,
) -> dict[str, Any]:
    scope.require(Permission.CATALOG_CONFIRM, store_id)
    return await duplicate_family_signatures(
        session,
        organization_id=scope.organization_id,
        limit=limit,
        offset=offset,
    )
