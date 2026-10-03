"""Correcting the catalogue: rename, merge, retire, bring back (ADR-0008).

The owner decided on 2026-10-03 that the owner and managers correct the
catalogue (`catalog:merge`). A rename, a retirement and a bringing back need
it in the store the person acts in; a merge needs it in every store, as the
shared price does, because it moves stock and prices everywhere.

Every correction is a command with a permanent `command_id` (I20), and the
7-day `Idempotency-Key` cache in front of it as every command has. A
deadlock or a serialization failure is retried, as product creation from a
decision is: the victim wrote nothing, and its identity stays the same.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Response, status
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ScopeDep, SessionDep
from app.api.v1.catalog import Label, ShortLabel, VariantPayload
from app.core import idempotency
from app.core.correlation import get_correlation_id
from app.core.errors import CatalogAmbiguousError
from app.core.text import CleanText, reject_unstorable
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.corrections import (
    CorrectionResult,
    RenameDraft,
    model_card,
    rename_model,
    search_models,
)
from app.modules.catalog.service import VariantDraft
from app.modules.catalog_correction.service import (
    may_merge,
    merge_models,
    preview_merge,
    require_merge_right,
    restore_model,
    retire_model,
)

router = APIRouter(prefix="/catalog/models", tags=["catalog"])

RENAME_ENDPOINT = "POST /catalog/models/{id}/rename"
MERGE_ENDPOINT = "POST /catalog/models/{id}/merge"
RETIRE_ENDPOINT = "POST /catalog/models/{id}/retire"
RESTORE_ENDPOINT = "POST /catalog/models/{id}/restore"

Note = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=1000),
    AfterValidator(reject_unstorable),
]


class ModelItem(BaseModel):
    product_variant_id: uuid.UUID
    display_name: str
    status: str


class ModelSearchResponse(BaseModel):
    items: list[ModelItem]
    has_more: bool


class ModelRef(BaseModel):
    product_variant_id: uuid.UUID
    display_name: str


class ModelCardResponse(BaseModel):
    product_variant_id: uuid.UUID
    display_name: str
    status: str
    merged_into: ModelRef | None
    product_family_id: uuid.UUID
    concept: str
    source: str | None
    color: str | None
    material: str | None
    texture: str | None
    fur: str | None
    collar: str | None
    length_cm: float | None
    business_category: str | None
    garment_type: str | None
    distinction_note: str | None
    # Whether this person may merge: the right in every store (owner
    # decision, 2026-10-03). The app offers a merge only then.
    may_merge: bool


class CorrectionResponse(BaseModel):
    correction_id: uuid.UUID | None
    kind: str
    product_variant_id: uuid.UUID
    into_variant_id: uuid.UUID | None
    name_before: str
    name_after: str
    status: str
    details: dict[str, Any]


class RenameRequest(BaseModel):
    """The model's whole name, stated again (ADR-0008 §2)."""

    model_config = ConfigDict(extra="forbid")

    store_id: uuid.UUID
    command_id: uuid.UUID
    concept: Label
    source: Label | None = None
    variant: VariantPayload = Field(default_factory=VariantPayload)
    # A concept new to the catalogue is created with these: the app fills in
    # the current concept's and shows them.
    business_category: ShortLabel | None = None
    garment_type: ShortLabel | None = None
    # When the new concept or source could be one of several families.
    product_family_id: uuid.UUID | None = None
    new_model: bool = False
    distinction_note: Note | None = None
    similar_confirmed: bool = False


class StoreCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    store_id: uuid.UUID
    command_id: uuid.UUID


class MergeRequest(StoreCommand):
    # The model that stays.
    into: uuid.UUID


class MergeModelView(BaseModel):
    product_variant_id: uuid.UUID
    display_name: str
    status: str
    shared_price: Decimal | None
    store_price: Decimal | None


class MergeStockLine(BaseModel):
    location_id: uuid.UUID
    location_name: str
    size_id: uuid.UUID
    size_label: str | None
    # Null where the person may not read that warehouse's stock.
    quantity: int | None


class MergePreviewResponse(BaseModel):
    duplicate: MergeModelView
    into: MergeModelView
    # What would move from the duplicate.
    stock: list[MergeStockLine]
    # What the model that stays holds already.
    stock_into: list[MergeStockLine]
    blockers: list[dict[str, Any]]


def _response(result: CorrectionResult) -> CorrectionResponse:
    return CorrectionResponse.model_validate(result.snapshot())


async def _command(
    session: AsyncSession,
    *,
    scope: RequestScope,
    response: Response,
    endpoint: str,
    key: str,
    store_id: uuid.UUID,
    request: dict[str, Any],
    work: Callable[[str], Awaitable[CorrectionResult]],
    merging: bool = False,
) -> CorrectionResponse:
    """Claim the key, run the correction, commit; retried on a deadlock.

    The person's right is decided first, before the key is claimed and before
    a stored answer is replayed: a revoked grant must not keep receiving a
    success it was once entitled to (I12, I13). A merge needs the right in
    every store; the rest in the store acted in.
    """
    if merging:
        await require_merge_right(session, scope=scope, store_id=store_id)
    else:
        scope.require(Permission.CATALOG_MERGE, store_id)
    fingerprint = idempotency.fingerprint(request, actor_user_id=scope.user_id, store_id=store_id)
    for attempt in range(3):
        try:
            outcome = await idempotency.claim(
                session,
                organization_id=scope.organization_id,
                endpoint=endpoint,
                key=key,
                request_fingerprint=fingerprint,
            )
            if isinstance(outcome, idempotency.Replay):
                response.status_code = outcome.http_status
                return CorrectionResponse.model_validate(outcome.response)
            body = _response(await work(fingerprint))
            await idempotency.complete(
                session,
                outcome.record_id,
                response=body.model_dump(mode="json"),
                http_status=status.HTTP_200_OK,
            )
            await session.commit()
            return body
        except DBAPIError as exc:
            code = getattr(exc.orig, "sqlstate", None) or getattr(exc.orig, "pgcode", None)
            if code not in {"40P01", "40001"}:
                raise
            await session.rollback()
            if attempt == 2:
                raise CatalogAmbiguousError(
                    "The catalogue changed at the same moment; send this correction again",
                    retryable=True,
                ) from exc
    raise AssertionError("Unreachable retry state")


@router.get("", response_model=ModelSearchResponse)
async def find_models(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    query: Annotated[str, Query(max_length=200)] = "",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=10000)] = 0,
) -> dict[str, Any]:
    return await search_models(
        session, scope=scope, store_id=store_id, query=query, limit=limit, offset=offset
    )


@router.get("/{product_variant_id}", response_model=ModelCardResponse)
async def get_model(
    product_variant_id: uuid.UUID, store_id: uuid.UUID, scope: ScopeDep, session: SessionDep
) -> dict[str, Any]:
    card = await model_card(
        session, scope=scope, store_id=store_id, product_variant_id=product_variant_id
    )
    return card | {"may_merge": await may_merge(session, scope=scope)}


@router.post("/{product_variant_id}/rename", response_model=CorrectionResponse)
async def rename(
    product_variant_id: uuid.UUID,
    payload: RenameRequest,
    scope: ScopeDep,
    session: SessionDep,
    response: Response,
    idempotency_key: Annotated[
        CleanText, Header(alias="Idempotency-Key", min_length=8, max_length=200)
    ],
) -> CorrectionResponse:
    """Correct one model's name, keeping its id, its stock and its history."""
    draft = RenameDraft(
        concept=payload.concept,
        source=payload.source,
        variant=VariantDraft(**payload.variant.model_dump()),
        business_category=payload.business_category,
        garment_type=payload.garment_type,
        product_family_id=payload.product_family_id,
        new_model=payload.new_model,
        distinction_note=payload.distinction_note,
        similar_confirmed=payload.similar_confirmed,
    )
    return await _command(
        session,
        scope=scope,
        response=response,
        endpoint=RENAME_ENDPOINT,
        key=idempotency_key,
        store_id=payload.store_id,
        request={
            "kind": "RENAME",
            "product_variant_id": str(product_variant_id),
            "command_id": str(payload.command_id),
            **draft.fingerprinted(),
        },
        work=lambda fingerprint: rename_model(
            session,
            scope=scope,
            store_id=payload.store_id,
            product_variant_id=product_variant_id,
            command_id=payload.command_id,
            fingerprint=fingerprint,
            draft=draft,
            correlation_id=get_correlation_id(),
        ),
    )


@router.get("/{product_variant_id}/merge/{into_id}", response_model=MergePreviewResponse)
async def merge_preview(
    product_variant_id: uuid.UUID,
    into_id: uuid.UUID,
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
) -> dict[str, Any]:
    """Both models, the stock that would move, and what stops the merge."""
    return await preview_merge(
        session,
        scope=scope,
        store_id=store_id,
        duplicate_id=product_variant_id,
        into_id=into_id,
    )


@router.post("/{product_variant_id}/merge", response_model=CorrectionResponse)
async def merge(
    product_variant_id: uuid.UUID,
    payload: MergeRequest,
    scope: ScopeDep,
    session: SessionDep,
    response: Response,
    idempotency_key: Annotated[
        CleanText, Header(alias="Idempotency-Key", min_length=8, max_length=200)
    ],
) -> CorrectionResponse:
    """Merge the duplicate into the model that stays. It cannot be undone."""
    return await _command(
        session,
        scope=scope,
        response=response,
        endpoint=MERGE_ENDPOINT,
        key=idempotency_key,
        store_id=payload.store_id,
        request={
            "kind": "MERGE",
            "product_variant_id": str(product_variant_id),
            "command_id": str(payload.command_id),
            "into": str(payload.into),
        },
        merging=True,
        work=lambda fingerprint: merge_models(
            session,
            scope=scope,
            store_id=payload.store_id,
            duplicate_id=product_variant_id,
            into_id=payload.into,
            command_id=payload.command_id,
            fingerprint=fingerprint,
            correlation_id=get_correlation_id(),
        ),
    )


@router.post("/{product_variant_id}/retire", response_model=CorrectionResponse)
async def retire(
    product_variant_id: uuid.UUID,
    payload: StoreCommand,
    scope: ScopeDep,
    session: SessionDep,
    response: Response,
    idempotency_key: Annotated[
        CleanText, Header(alias="Idempotency-Key", min_length=8, max_length=200)
    ],
) -> CorrectionResponse:
    """No longer offered or received; its stock still sells."""
    return await _command(
        session,
        scope=scope,
        response=response,
        endpoint=RETIRE_ENDPOINT,
        key=idempotency_key,
        store_id=payload.store_id,
        request={
            "kind": "RETIRE",
            "product_variant_id": str(product_variant_id),
            "command_id": str(payload.command_id),
        },
        work=lambda fingerprint: retire_model(
            session,
            scope=scope,
            store_id=payload.store_id,
            product_variant_id=product_variant_id,
            command_id=payload.command_id,
            fingerprint=fingerprint,
            correlation_id=get_correlation_id(),
        ),
    )


@router.post("/{product_variant_id}/restore", response_model=CorrectionResponse)
async def restore(
    product_variant_id: uuid.UUID,
    payload: StoreCommand,
    scope: ScopeDep,
    session: SessionDep,
    response: Response,
    idempotency_key: Annotated[
        CleanText, Header(alias="Idempotency-Key", min_length=8, max_length=200)
    ],
) -> CorrectionResponse:
    """A retired model offered and received again, as before."""
    return await _command(
        session,
        scope=scope,
        response=response,
        endpoint=RESTORE_ENDPOINT,
        key=idempotency_key,
        store_id=payload.store_id,
        request={
            "kind": "RESTORE",
            "product_variant_id": str(product_variant_id),
            "command_id": str(payload.command_id),
        },
        work=lambda fingerprint: restore_model(
            session,
            scope=scope,
            store_id=payload.store_id,
            product_variant_id=product_variant_id,
            command_id=payload.command_id,
            fingerprint=fingerprint,
            correlation_id=get_correlation_id(),
        ),
    )
