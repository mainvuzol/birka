"""Legacy stock lists: import, review line by line, then approve or reject (M1-023).

Every command is identified by what it names rather than by an
`Idempotency-Key` header, like the catalog review commands: the import by its
client-generated `command_id` (unique within the organization, as for a sale),
a line's answer by the line itself, an approval by the review revision it
approves, a rejection by its reason. Each can be repeated safely. See ADR-0005.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Path, Query, Response, status
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.api.deps import ScopeDep, SessionDep
from app.core.text import CleanText, reject_unstorable
from app.modules.snapshots.models import (
    SnapshotQuantityBasis,
    SnapshotQuantityState,
    SnapshotRowStatus,
    SnapshotStatus,
)
from app.modules.snapshots.service import (
    MAX_ALLOCATIONS,
    MAX_LINE_CHARS,
    MAX_LINES,
    MAX_LIST_CHARS,
    AllocationInput,
    approve_snapshot,
    get_snapshot,
    import_snapshot,
    list_lines,
    list_snapshots,
    reject_snapshot,
    resolve_row,
)

router = APIRouter(prefix="/snapshots", tags=["snapshots"])

# A line is kept exactly as written: no stripping, no case folding. Blank
# lines are refused by the service, which says which line.
LineText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=MAX_LINE_CHARS),
    AfterValidator(reject_unstorable),
]


# --- requests ------------------------------------------------------------------


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The client's permanent name for this import, unique within its
    # organization: a retry repeats it, and only a retry may.
    command_id: uuid.UUID
    # Which store acts, and which warehouse was counted. Two facts (ADR-0004).
    store_id: uuid.UUID
    location_id: uuid.UUID
    source_document_ref: CleanText | None = Field(default=None, min_length=1, max_length=300)
    captured_at: CleanText | None = Field(default=None, min_length=1, max_length=40)
    lines: list[LineText] = Field(min_length=1, max_length=MAX_LINES)

    @model_validator(mode="after")
    def _bounded(self) -> ImportRequest:
        if sum(len(line) for line in self.lines) > MAX_LIST_CHARS:
            raise ValueError(f"A stock list holds at most {MAX_LIST_CHARS} characters")
        return self


class AllocationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_variant_id: uuid.UUID
    size_id: uuid.UUID | None = None
    size_unknown: bool = False
    quantity: int = Field(gt=0, le=10_000)

    @model_validator(mode="after")
    def _one_size(self) -> AllocationPayload:
        if (self.size_id is None) != self.size_unknown:
            raise ValueError("Give a size_id, or set size_unknown — exactly one")
        return self


class ResolutionRequest(BaseModel):
    """Either the line's allocations and where their numbers came from, or a
    skip reason. See `SnapshotQuantityBasis` for what each basis allows."""

    model_config = ConfigDict(extra="forbid")

    allocations: list[AllocationPayload] | None = Field(
        default=None, min_length=1, max_length=MAX_ALLOCATIONS
    )
    quantity_basis: SnapshotQuantityBasis | None = None
    note: CleanText | None = Field(default=None, min_length=1, max_length=1000)
    skip_reason: CleanText | None = Field(default=None, min_length=1, max_length=1000)

    @model_validator(mode="after")
    def _one_answer(self) -> ResolutionRequest:
        if (self.allocations is None) == (self.skip_reason is None):
            raise ValueError("Give allocations, or a skip_reason — exactly one")
        if self.allocations is not None and self.quantity_basis is None:
            raise ValueError("Allocations need a quantity_basis")
        if self.skip_reason is not None and (
            self.note is not None or self.quantity_basis is not None
        ):
            raise ValueError("A skipped line is explained by its skip_reason alone")
        return self


class ApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The review revision the approver looked at (ADR-0005 §4).
    expected_review_revision: int = Field(ge=0)


class RejectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: CleanText = Field(min_length=1, max_length=1000)


# --- responses -----------------------------------------------------------------


class SnapshotSummary(BaseModel):
    lines: int
    pending: int
    needs_review: int
    resolved: int
    skipped: int
    allocations: int
    units: int
    lines_differing_from_source: int
    # What the approver is asked to trust: how many lines, and units, rest on
    # each basis (ADR-0005 §3).
    lines_by_basis: dict[SnapshotQuantityBasis, int]
    units_by_basis: dict[SnapshotQuantityBasis, int]


class ApplicationLine(BaseModel):
    line_no: int
    allocation_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int
    stock_lot_id: uuid.UUID | None
    movement_id: uuid.UUID | None


class Application(BaseModel):
    lines: list[ApplicationLine]
    units: int


class SnapshotResponse(BaseModel):
    snapshot_id: uuid.UUID
    command_id: uuid.UUID
    store_id: uuid.UUID
    location_id: uuid.UUID
    status: SnapshotStatus
    source_document_ref: str | None
    captured_at: str | None
    review_revision: int
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    approved_by_user_id: uuid.UUID | None
    rejected_by_user_id: uuid.UUID | None
    rejection_reason: str | None
    decided_at: datetime | None
    summary: SnapshotSummary
    ready_to_approve: bool
    application: Application | None = None


class AllocationResponse(BaseModel):
    allocation_id: uuid.UUID
    product_variant_id: uuid.UUID
    display_name: str | None
    size_id: uuid.UUID
    size_code: str | None
    quantity: int
    stock_lot_id: uuid.UUID | None


class LineResponse(BaseModel):
    line_no: int
    raw_input_id: uuid.UUID
    raw_text: str | None
    # How many lines of this list read exactly the same. A repeat may be one
    # line per piece, or a slip of transcription; only a person can say which.
    same_text_lines: int
    status: SnapshotRowStatus
    quantity_state: SnapshotQuantityState
    quantity_total: int | None
    # A line with no number that could be a count, which may be taken as one
    # piece (`LINE_IMPLIES_ONE`); every other line needs its count stated.
    may_imply_one: bool
    review_reasons: list[str]
    candidates: dict[str, list[str]]
    unclassified: list[str]
    quantity_basis: SnapshotQuantityBasis | None
    allocations: list[AllocationResponse]
    resolution_note: str | None
    resolved_by_user_id: uuid.UUID | None
    resolved_at: datetime | None


class LinePage(BaseModel):
    items: list[LineResponse]
    has_more: bool


class ResolutionResponse(BaseModel):
    snapshot: SnapshotResponse
    line: LineResponse


class SnapshotPage(BaseModel):
    items: list[SnapshotResponse]
    has_more: bool


# --- routes ----------------------------------------------------------------------


@router.post("", response_model=SnapshotResponse, status_code=status.HTTP_201_CREATED)
async def import_list(
    payload: ImportRequest, scope: ScopeDep, session: SessionDep, response: Response
) -> dict[str, Any]:
    """Keep a legacy stock list as evidence. Nothing becomes stock yet."""
    view, created = await import_snapshot(
        session,
        scope=scope,
        command_id=payload.command_id,
        store_id=payload.store_id,
        location_id=payload.location_id,
        lines=payload.lines,
        source_document_ref=payload.source_document_ref,
        captured_at=payload.captured_at,
    )
    await session.commit()
    if not created:
        response.status_code = status.HTTP_200_OK
    return view


@router.get("", response_model=SnapshotPage)
async def list_lists(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    status: SnapshotStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> dict[str, Any]:
    return await list_snapshots(
        session, scope=scope, store_id=store_id, status=status, limit=limit, offset=offset
    )


@router.get("/{snapshot_id}", response_model=SnapshotResponse)
async def read_list(snapshot_id: uuid.UUID, scope: ScopeDep, session: SessionDep) -> dict[str, Any]:
    return await get_snapshot(session, scope=scope, snapshot_id=snapshot_id)


@router.get("/{snapshot_id}/lines", response_model=LinePage)
async def read_lines(
    snapshot_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    status: SnapshotRowStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=MAX_LINES)] = 0,
) -> dict[str, Any]:
    return await list_lines(
        session, scope=scope, snapshot_id=snapshot_id, status=status, limit=limit, offset=offset
    )


@router.put("/{snapshot_id}/lines/{line_no}", response_model=ResolutionResponse)
async def resolve_line(
    snapshot_id: uuid.UUID,
    line_no: Annotated[int, Path(ge=1, le=MAX_LINES)],
    payload: ResolutionRequest,
    scope: ScopeDep,
    session: SessionDep,
) -> dict[str, Any]:
    """Say what one line means. Replaces the line's previous answer, if any."""
    result = await resolve_row(
        session,
        scope=scope,
        snapshot_id=snapshot_id,
        line_no=line_no,
        allocations=[
            AllocationInput(
                product_variant_id=allocation.product_variant_id,
                quantity=allocation.quantity,
                size_id=allocation.size_id,
                size_unknown=allocation.size_unknown,
            )
            for allocation in payload.allocations
        ]
        if payload.allocations is not None
        else None,
        quantity_basis=payload.quantity_basis,
        skip_reason=payload.skip_reason,
        note=payload.note,
    )
    await session.commit()
    return result


@router.post("/{snapshot_id}/approve", response_model=SnapshotResponse)
async def approve_list(
    snapshot_id: uuid.UUID, payload: ApprovalRequest, scope: ScopeDep, session: SessionDep
) -> dict[str, Any]:
    """Turn the whole list into opening stock at its warehouse, or nothing."""
    result = await approve_snapshot(
        session,
        scope=scope,
        snapshot_id=snapshot_id,
        expected_revision=payload.expected_review_revision,
    )
    await session.commit()
    return result


@router.post("/{snapshot_id}/reject", response_model=SnapshotResponse)
async def reject_list(
    snapshot_id: uuid.UUID, payload: RejectionRequest, scope: ScopeDep, session: SessionDep
) -> dict[str, Any]:
    """Close a list without turning any of it into stock. The evidence stays."""
    result = await reject_snapshot(
        session, scope=scope, snapshot_id=snapshot_id, reason=payload.reason
    )
    await session.commit()
    return result


__all__ = ["router"]
