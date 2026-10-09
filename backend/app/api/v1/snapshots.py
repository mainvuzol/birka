"""Legacy stock lists: import, review line by line, then approve or reject (M1-023).

Every command is identified by what it names rather than by an
`Idempotency-Key` header, like the catalog review commands: the import by its
client-generated `command_id` (unique within the organization, as for a sale),
an added part by its own `command_id`, a line's answer by the line itself, a
removal by the part it removes, an approval by the review revision it
approves, a rejection by its reason. Each can be repeated safely. See ADR-0005
and ADR-0014.

A list is filled by parts: lines typed by hand, or a parser's file in Birka's
format (`birka.stock-list`, `app.modules.snapshots.stock_file`). Every route
on one list takes `store_id`, the store the person acts through, which is
the list's own store when left out: a shared warehouse's list belongs to
both stores (owner decision, 2026-10-08).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Path, Query, Response, status
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
from app.modules.identity.service import display_names
from app.modules.snapshots.file_lines import SplitReading
from app.modules.snapshots.models import (
    SnapshotPartKind,
    SnapshotPriceKind,
    SnapshotQuantityBasis,
    SnapshotQuantityState,
    SnapshotRowStatus,
    SnapshotStatus,
)
from app.modules.snapshots.service import (
    MAX_ALLOCATIONS,
    MAX_LINE_CHARS,
    MAX_LIST_ROWS,
    MAX_PART_LINES,
    MAX_PART_TEXT_CHARS,
    AllocationInput,
    add_part,
    approve_snapshot,
    get_snapshot,
    import_snapshot,
    list_application,
    list_lines,
    list_parts,
    list_snapshots,
    reject_snapshot,
    remove_part,
    resolve_row,
)
from app.modules.snapshots.stock_file import StockFileV1, has_control
from app.modules.tenancy.models import StoreState

router = APIRouter(prefix="/snapshots", tags=["snapshots"])

# A line is kept exactly as written: no stripping, no case folding. Blank
# lines are refused by the service, which says which line.
LineText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=MAX_LINE_CHARS),
    AfterValidator(reject_unstorable),
]


def _no_control_character(value: str) -> str:
    """The file's name, as the file's own strings: no C0 or C1 control, no
    line or paragraph separator (`stock_file.has_control`)."""
    if has_control(value):
        raise ValueError("A file's name holds no control character")
    return value


# The file's name as the phone read it, shown beside the part.
FileName = Annotated[
    CleanText,
    StringConstraints(min_length=1, max_length=200),
    AfterValidator(_no_control_character),
]
# The store the person acts through: the list's own when left out (ADR-0014 §7).
ActingThrough = Annotated[uuid.UUID | None, Query(alias="store_id")]


# --- requests ------------------------------------------------------------------


def _bounded(lines: list[str] | None) -> None:
    if lines is not None and sum(len(line) for line in lines) > MAX_PART_TEXT_CHARS:
        raise ValueError(f"A part of a stock list holds at most {MAX_PART_TEXT_CHARS} characters")


def _lines_or_a_file(
    lines: list[str] | None, file: StockFileV1 | None, file_name: str | None
) -> None:
    if (lines is None) == (file is None):
        raise ValueError("Give lines or a file — exactly one")
    if (file is None) != (file_name is None):
        raise ValueError("A file comes with its file_name, and only a file does")
    _bounded(lines)


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
    # The list's first part: lines typed by hand, or a parser's file.
    lines: list[LineText] | None = Field(default=None, min_length=1, max_length=MAX_PART_LINES)
    file: StockFileV1 | None = None
    file_name: FileName | None = None

    @model_validator(mode="after")
    def _one_source(self) -> ImportRequest:
        _lines_or_a_file(self.lines, self.file, self.file_name)
        return self


class AddPartRequest(BaseModel):
    """A file with its name, or lines typed by hand with where they came from."""

    model_config = ConfigDict(extra="forbid")

    # The client's permanent name for adding this part, as for an import.
    command_id: uuid.UUID
    lines: list[LineText] | None = Field(default=None, min_length=1, max_length=MAX_PART_LINES)
    file: StockFileV1 | None = None
    file_name: FileName | None = None
    # A file says these itself; hand-typed lines may.
    source: CleanText | None = Field(default=None, min_length=1, max_length=300)
    counted_on: CleanText | None = Field(default=None, min_length=1, max_length=40)

    @model_validator(mode="after")
    def _one_source(self) -> AddPartRequest:
        _lines_or_a_file(self.lines, self.file, self.file_name)
        if self.file is not None and (self.source is not None or self.counted_on is not None):
            raise ValueError("A file says where it came from itself")
        return self


class RemovePartRequest(BaseModel):
    """No body is needed, and none may say more: no reason (owner, 2026-10-08)."""

    model_config = ConfigDict(extra="forbid")


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
    # What a record of the line's split means when it may also be a range of
    # sizes («42-44», `may_be_range`): only `SIZE_WITH_COUNT`, and only with
    # `STATED_BY_SIZE`, which such a line needs it for (owner, 2026-10-09).
    split_read_as: SplitReading | None = None

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
        if (
            self.split_read_as is not None
            and self.quantity_basis is not SnapshotQuantityBasis.STATED_BY_SIZE
        ):
            raise ValueError("split_read_as goes only with STATED_BY_SIZE")
        return self


class ApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The review revision the approver looked at (ADR-0005 §4).
    expected_review_revision: int = Field(ge=0)


class RejectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: CleanText = Field(min_length=1, max_length=1000)


# --- responses -----------------------------------------------------------------


class SummaryLimits(BaseModel):
    # The most lines that count, and the most answers, one list takes.
    lines: int
    allocations: int


class SnapshotSummary(BaseModel):
    # Every count but `parts_removed` leaves a removed file's lines out.
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
    parts: int
    parts_removed: int
    limits: SummaryLimits


class ApplicationLine(BaseModel):
    line_no: int
    allocation_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int
    stock_lot_id: uuid.UUID | None
    movement_id: uuid.UUID | None


class Application(BaseModel):
    """What an applied list became, in all. Its lines are read by pages."""

    units: int
    allocations: int


class ApplicationPage(BaseModel):
    items: list[ApplicationLine]
    has_more: bool


class SnapshotResponse(BaseModel):
    snapshot_id: uuid.UUID
    command_id: uuid.UUID
    store_id: uuid.UUID
    # The list's own store, by name: a shared warehouse's list is seen from
    # the other store too.
    store_name: str | None
    # Whether that store trades. While it does not, the list is only
    # rejected, through the other store (owner decision, 2026-10-09).
    store_state: StoreState
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


class SizeCountResponse(BaseModel):
    size: str
    count: int


class ReadingResponse(BaseModel):
    """What the parser read of a line, exactly as the file said it. A hint."""

    model: str | None = None
    colours: list[str] | None = None
    sizes: list[str] | None = None
    size_counts: list[SizeCountResponse] | None = None
    count: int | None = None
    price: str | None = None
    note: str | None = None


class SplitResponse(BaseModel):
    size: str
    count: int
    # The catalogue's size of this spelling; null when it has none, and then
    # the split cannot be confirmed by a tap.
    size_id: uuid.UUID | None
    # The record as the line's text writes it («42-44»).
    written: str | None
    # Whether that record may also be a range of sizes: its count, or the
    # whole record, is a size of the catalogue too. Then the person says
    # what it means before the tap (`split_read_as`; owner, 2026-10-09).
    may_be_range: bool


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
    # What the person said a record of the line's split means, with an
    # answer `STATED_BY_SIZE`: `SIZE_WITH_COUNT`, or null when nobody was
    # asked. A line answered so whose record may now be a range, and was
    # never said to be a size with its count, stops the approval
    # (`SPLIT_MAY_BE_RANGE`; owner, 2026-10-09).
    split_read_as: SplitReading | None
    allocations: list[AllocationResponse]
    resolution_note: str | None
    resolved_by_user_id: uuid.UUID | None
    resolved_at: datetime | None
    # The part the line came in, and for a line from a file: where it was
    # written, what the parser read, the kind of its price, and why the
    # reading needs a person's eye (ADR-0014 §6).
    part_id: uuid.UUID
    part_no: int
    photo_name: str | None
    photo_line: int | None
    reading: ReadingResponse | None
    price_kind: SnapshotPriceKind | None
    file_reasons: list[str]
    # The split the line's text shows, each size with its count: what
    # `STATED_BY_SIZE` answers, never preselected.
    shown_split: list[SplitResponse] | None
    # How many lines that count name this photo and line; more than one is
    # a photo read twice, or put in two files.
    same_photo_lines: int


class LinePage(BaseModel):
    items: list[LineResponse]
    has_more: bool


class ResolutionResponse(BaseModel):
    snapshot: SnapshotResponse
    line: LineResponse


class SnapshotPage(BaseModel):
    items: list[SnapshotResponse]
    has_more: bool


class PartProgress(BaseModel):
    pending: int
    needs_review: int
    resolved: int
    skipped: int


class PartResponse(BaseModel):
    part_id: uuid.UUID
    part_no: int
    kind: SnapshotPartKind
    file_name: str | None
    source: str | None
    counted_on: str | None
    price_kind: SnapshotPriceKind | None
    parser: str | None
    format_version: int | None
    lines: int
    first_line_no: int
    last_line_no: int
    added_by_user_id: uuid.UUID | None
    added_by_name: str | None
    added_at: datetime
    removed_by_user_id: uuid.UUID | None
    removed_by_name: str | None
    removed_at: datetime | None
    progress: PartProgress
    # Lines of this part whose photo and line another part names too.
    photo_lines_elsewhere: int


class PartPage(BaseModel):
    items: list[PartResponse]


class PartChangeResponse(BaseModel):
    snapshot: SnapshotResponse
    part: PartResponse


async def _named(session: SessionDep, parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Who added and who removed each part, by name (ADR-0014 §12)."""
    names = await display_names(
        session,
        {
            user_id
            for part in parts
            for user_id in (part["added_by_user_id"], part["removed_by_user_id"])
            if user_id is not None
        },
    )
    return [
        {
            **part,
            "added_by_name": names.get(part["added_by_user_id"]),
            "removed_by_name": names.get(part["removed_by_user_id"]),
        }
        for part in parts
    ]


# --- routes ----------------------------------------------------------------------


@router.post("", response_model=SnapshotResponse, status_code=status.HTTP_201_CREATED)
async def import_list(
    payload: ImportRequest, scope: ScopeDep, session: SessionDep, response: Response
) -> dict[str, Any]:
    """Keep a legacy stock list as evidence: typed lines or a parser's file.
    Nothing becomes stock yet."""
    view, created = await import_snapshot(
        session,
        scope=scope,
        command_id=payload.command_id,
        store_id=payload.store_id,
        location_id=payload.location_id,
        lines=payload.lines,
        file=payload.file,
        file_name=payload.file_name,
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
    location_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> dict[str, Any]:
    """The store's own lists, and every list at a warehouse it may import into."""
    return await list_snapshots(
        session,
        scope=scope,
        store_id=store_id,
        status=status,
        location_id=location_id,
        limit=limit,
        offset=offset,
    )


@router.get("/{snapshot_id}", response_model=SnapshotResponse)
async def read_list(
    snapshot_id: uuid.UUID, scope: ScopeDep, session: SessionDep, via: ActingThrough = None
) -> dict[str, Any]:
    return await get_snapshot(session, scope=scope, snapshot_id=snapshot_id, via_store_id=via)


@router.get("/{snapshot_id}/lines", response_model=LinePage)
async def read_lines(
    snapshot_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    via: ActingThrough = None,
    status: SnapshotRowStatus | None = None,
    part_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=MAX_LIST_ROWS)] = 0,
) -> dict[str, Any]:
    """A page of lines. A removed file's lines only when asked for: by
    `status=REMOVED`, or by `part_id` naming that file."""
    return await list_lines(
        session,
        scope=scope,
        snapshot_id=snapshot_id,
        status=status,
        part_id=part_id,
        via_store_id=via,
        limit=limit,
        offset=offset,
    )


@router.put("/{snapshot_id}/lines/{line_no}", response_model=ResolutionResponse)
async def resolve_line(
    snapshot_id: uuid.UUID,
    line_no: Annotated[int, Path(ge=1, le=MAX_LIST_ROWS)],
    payload: ResolutionRequest,
    scope: ScopeDep,
    session: SessionDep,
    via: ActingThrough = None,
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
        via_store_id=via,
        split_read_as=payload.split_read_as,
    )
    await session.commit()
    return result


@router.get("/{snapshot_id}/parts", response_model=PartPage)
async def read_parts(
    snapshot_id: uuid.UUID, scope: ScopeDep, session: SessionDep, via: ActingThrough = None
) -> dict[str, Any]:
    """Every file and hand-typed part of the list, removed ones included."""
    parts = await list_parts(session, scope=scope, snapshot_id=snapshot_id, via_store_id=via)
    return {"items": await _named(session, parts)}


@router.post(
    "/{snapshot_id}/parts",
    response_model=PartChangeResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_list_part(
    snapshot_id: uuid.UUID,
    payload: AddPartRequest,
    scope: ScopeDep,
    session: SessionDep,
    response: Response,
    via: ActingThrough = None,
) -> dict[str, Any]:
    """Add a file, or lines typed by hand, to a list under review."""
    result, created = await add_part(
        session,
        scope=scope,
        snapshot_id=snapshot_id,
        command_id=payload.command_id,
        via_store_id=via,
        lines=payload.lines,
        file=payload.file,
        file_name=payload.file_name,
        source=payload.source,
        counted_on=payload.counted_on,
    )
    await session.commit()
    if not created:
        response.status_code = status.HTTP_200_OK
    return {"snapshot": result["snapshot"], "part": (await _named(session, [result["part"]]))[0]}


@router.post("/{snapshot_id}/parts/{part_id}/remove", response_model=PartChangeResponse)
async def remove_list_part(
    snapshot_id: uuid.UUID,
    part_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    via: ActingThrough = None,
    payload: Annotated[RemovePartRequest | None, Body()] = None,
) -> dict[str, Any]:
    """Take a file added by mistake out of the list, with its lines' answers."""
    result = await remove_part(
        session, scope=scope, snapshot_id=snapshot_id, part_id=part_id, via_store_id=via
    )
    await session.commit()
    return {"snapshot": result["snapshot"], "part": (await _named(session, [result["part"]]))[0]}


@router.post("/{snapshot_id}/approve", response_model=SnapshotResponse)
async def approve_list(
    snapshot_id: uuid.UUID,
    payload: ApprovalRequest,
    scope: ScopeDep,
    session: SessionDep,
    via: ActingThrough = None,
) -> dict[str, Any]:
    """Turn the whole list into opening stock at its warehouse, or nothing."""
    result = await approve_snapshot(
        session,
        scope=scope,
        snapshot_id=snapshot_id,
        expected_revision=payload.expected_review_revision,
        via_store_id=via,
    )
    await session.commit()
    return result


@router.get("/{snapshot_id}/application", response_model=ApplicationPage)
async def read_application(
    snapshot_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    via: ActingThrough = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    """What an applied list became, a page at a time: each answer, the lot it
    became and the movement that brought it in."""
    return await list_application(
        session,
        scope=scope,
        snapshot_id=snapshot_id,
        via_store_id=via,
        offset=offset,
        limit=limit,
    )


@router.post("/{snapshot_id}/reject", response_model=SnapshotResponse)
async def reject_list(
    snapshot_id: uuid.UUID,
    payload: RejectionRequest,
    scope: ScopeDep,
    session: SessionDep,
    via: ActingThrough = None,
) -> dict[str, Any]:
    """Close a list without turning any of it into stock. The evidence stays."""
    result = await reject_snapshot(
        session, scope=scope, snapshot_id=snapshot_id, reason=payload.reason, via_store_id=via
    )
    await session.commit()
    return result


__all__ = ["router"]
