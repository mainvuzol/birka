"""Legacy stock lists: evidence in, a person's answers beside it, stock only on approval.

M1-023, ADR-0005, ADR-0014, and `.ai/workflows/legacy-inventory-snapshot-import.md`:

1. **Import.** A list is filled by parts: lines typed by hand, or a parser's
   file in Birka's format (ADR-0014; owner decision, 2026-10-08). Every line
   is kept verbatim as catalog evidence and parsed. Nothing is matched,
   created or counted. A part added by mistake is removed, with the answers
   given to its lines; the lines stay as evidence and count nowhere.
2. **Review.** A person states what each line means — one or more
   `(variant, size, quantity)` allocations, and where the numbers came from —
   or that it is not stock, and why. Nothing is inferred: not a size, not a
   colour split, not a quantity. A parser's reading of a line is a hint.
3. **Approve** turns the whole list into `OPENING_BALANCE` stock at once, and
   only into a warehouse with no stock history. **Reject** turns none of it
   into stock and keeps all of it as evidence. Either way the database then
   freezes the list.

Authorization follows the rest of the stock commands: the person's permission
in the list's store (`snapshot:import` to import and review, `snapshot:approve`
to approve, either to read or reject), that store's explicit access to the
warehouse (`can_receive` and an open warehouse for anything that leads to
stock), and the private-warehouse rule. Every check runs before any replay
(invariant I13).

A list of the shared warehouse belongs to both stores (owner decision,
2026-10-08). Every command and read names the store the person acts through,
`via_store_id`, which defaults to the list's own. Through another store, that
store needs `can_receive` at the list's warehouse and the person the action's
permission there (ADR-0014 §7). The list's own store still acts in the ledger.
While the list's own store does not trade, the list can only be rejected,
through the other store, which releases its warehouse (owner decision,
2026-10-09); so too while it no longer holds `can_receive` at the list's
warehouse (review, 2026-10-09).

The caller owns the transaction.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import Text, and_, case, cast, delete, func, or_, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.correlation import get_correlation_id
from app.core.errors import (
    DomainError,
    IdempotencyConflictError,
    ModelMergedError,
    ModelRetiredError,
    NotFoundError,
    SnapshotConflictError,
    ValidationFailedError,
)
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.evidence import RawInputSource
from app.modules.catalog.raw_lines import (
    mark_lines,
    read_lines,
    record_lines,
    repeated_lines,
    text_of,
)
from app.modules.catalog.read import describe_variants, size_labels, sizes_by_spelling
from app.modules.catalog.service import ensure_unknown_size
from app.modules.catalog.validation import require_active_variants, validate_stock_references
from app.modules.inventory.service import (
    OpeningBalanceLine,
    apply_opening_balance,
    hold_for_opening_list,
    opening_balance_movement_ids,
    release_opening_list,
)
from app.modules.snapshots.file_lines import (
    SplitReading,
    countless,
    file_line_evidence,
    may_be_range,
    split_records,
)
from app.modules.snapshots.models import (
    InventorySnapshot,
    InventorySnapshotAllocation,
    InventorySnapshotPart,
    InventorySnapshotRow,
    SnapshotPartKind,
    SnapshotPriceKind,
    SnapshotQuantityBasis,
    SnapshotQuantityState,
    SnapshotRowStatus,
    SnapshotStatus,
)
from app.modules.snapshots.rules import (
    MAX_QUANTITY,
    SEVERAL_OPTIONS,
    check_basis,
    lines_import_request,
    mentions_no_count,
    request_fingerprint,
    source_quantity,
)
from app.modules.snapshots.stock_file import (
    MAX_LINE_CHARS,
    MAX_PART_LINES,
    MAX_PART_TEXT_CHARS,
    StockFileV1,
    canonical,
    content_fingerprint_of_file,
    has_control,
)
from app.modules.tenancy.models import StoreState
from app.modules.tenancy.service import (
    LocationCapability,
    accessible_locations,
    store_names,
    store_state,
    validate_active_stores,
)

MAX_ALLOCATIONS = 50
# What one list may open a warehouse with, in all. It bounds the approval —
# which writes the whole list in one transaction, holding the warehouse
# exclusively — and every read of what it became. Set by measurement
# (ADR-0014 §10): the largest of 2 000, 5 000 and 10 000 allocations whose
# slowest approval took at most 10 s, with no statement over 5 s. 5 000 took
# at most 7.6 s; 10 000 was refused outright, since the ledger reads every
# allocation's reservation in one statement, which PostgreSQL 16 refuses past
# about 6 500 keys (`max_stack_depth`). Measured 2026-10-08:
# output/verification/2026-10-08-json-import-approval/. Again on 2026-10-09
# with every answer by size, which the approval reads again: at most 8.6 s,
# the read itself 0.2 s (…/2026-10-09-json-import-approval-by-size/). Raise
# it only with a new measurement, and that read batched first.
MAX_LIST_ALLOCATIONS = 5_000
# As many lines as answers: the owner heard the limit as 5 000 lines of one
# size each, and the shops count their largest warehouse before its files go
# in (owner, 2026-10-08). A line naming several sizes takes one answer per
# size, so a list full of such lines can run out of answers before its last
# line is answered; the screen shows both, and the shops' count counts each
# size of such a line. The measurement approved 5 000 lines of one answer.
MAX_LIST_LINES = MAX_LIST_ALLOCATIONS
# Every row ever added, removed ones included: it bounds `line_no`. Twice the
# lines leaves room for files removed and added again; the measurement read
# pages of a 6 000-row list in at most 0.12 s.
MAX_LIST_ROWS = 2 * MAX_LIST_LINES
# Every part ever added, removed ones included.
MAX_LIST_PARTS = 1_000
MAX_FILE_NAME = 200
MAX_NOTE = 1000
OPEN_ROW_STATUSES = (SnapshotRowStatus.PENDING, SnapshotRowStatus.NEEDS_REVIEW)


@dataclass(frozen=True, slots=True)
class AllocationInput:
    """One quantity a person says a line means. Exactly one of `size_id` and
    `size_unknown`: "size not known" is stated, never defaulted to."""

    product_variant_id: uuid.UUID
    quantity: int
    size_id: uuid.UUID | None = None
    size_unknown: bool = False


def _lock_key(organization_id: uuid.UUID, command_id: uuid.UUID) -> int:
    """Scoped exactly like `uq_inventory_snapshot_org_command`, so two
    organizations using one command id never wait on each other. Creating a
    list and adding a part take the same one: a stock-list command id names
    one list or one added part, never both (ADR-0014 §8)."""
    digest = hashlib.sha256(
        b"inventory-snapshot:" + organization_id.bytes + command_id.bytes
    ).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


def _clean_text(value: str | None, *, limit: int, what: str, required: bool) -> str | None:
    """Kept exactly as written; refused rather than trimmed or truncated."""
    if value is None:
        if required:
            raise ValidationFailedError(f"{what} is required")
        return None
    if not value.strip() or len(value) > limit or not is_storable(value):
        raise ValidationFailedError(f"{what} must contain 1 to {limit} valid characters")
    return value


def _now() -> datetime:
    return datetime.now(tz=UTC)


# ---------------------------------------------------------------------------
# What a part brings
# ---------------------------------------------------------------------------


def _pasted_lines(lines: Sequence[str]) -> list[str]:
    if not 1 <= len(lines) <= MAX_PART_LINES:
        raise ValidationFailedError(f"A part of a stock list has 1 to {MAX_PART_LINES} lines")
    for line_no, text in enumerate(lines, start=1):
        if len(text) > MAX_LINE_CHARS:
            raise ValidationFailedError(
                f"A line holds at most {MAX_LINE_CHARS} characters", line_no=line_no
            )
    if sum(len(text) for text in lines) > MAX_PART_TEXT_CHARS:
        raise ValidationFailedError(
            f"A part of a stock list holds at most {MAX_PART_TEXT_CHARS} characters"
        )
    return list(lines)


def _checked_file(file: StockFileV1) -> StockFileV1:
    """The file as the format reads it, checked here too: a caller that did
    not come through the router gets the same refusal, not a broken row."""
    try:
        return StockFileV1.model_validate(canonical(file))
    except ValidationError as refused:
        first = refused.errors(include_url=False)[0]
        raise ValidationFailedError(
            "This file is not in Birka's format",
            type=first["type"],
            loc=[str(part) for part in first["loc"]],
            problems=refused.error_count(),
        ) from None


def _file_name(value: str | None) -> str:
    if value is None:
        raise ValidationFailedError("A file comes with its name")
    if (
        not value.strip()
        or len(value) > MAX_FILE_NAME
        or not is_storable(value)
        or has_control(value)
    ):
        raise ValidationFailedError(
            f"The file's name must contain 1 to {MAX_FILE_NAME} valid characters"
        )
    return value


def _part_content(
    *, lines: Sequence[str] | None, file: StockFileV1 | None, file_name: str | None
) -> tuple[list[str], StockFileV1 | None, str | None]:
    """Exactly one of lines and a file; a file's name only with a file."""
    if (lines is None) == (file is None):
        raise ValidationFailedError("Give the list's lines or a file, exactly one")
    if file is None:
        assert lines is not None
        if file_name is not None:
            raise ValidationFailedError("Only a file comes with a file name")
        return _pasted_lines(lines), None, None
    checked = _checked_file(file)
    return [line.text for line in checked.lines], checked, _file_name(file_name)


# ---------------------------------------------------------------------------
# Loading and authorization
# ---------------------------------------------------------------------------


async def _load(
    session: AsyncSession, *, scope: RequestScope, snapshot_id: uuid.UUID, lock: bool = False
) -> InventorySnapshot:
    query = select(InventorySnapshot).where(
        InventorySnapshot.id == snapshot_id,
        InventorySnapshot.organization_id == scope.organization_id,
    )
    if lock:
        query = query.with_for_update()
    snapshot = (
        await session.scalars(query.execution_options(populate_existing=True))
    ).one_or_none()
    # A list restored by a downgrade has lost its acting store and cannot be
    # authorized against anything; it answers exactly like one that never
    # existed, as does another organization's.
    if snapshot is None or snapshot.acting_store_id is None or snapshot.location_id is None:
        raise NotFoundError("Unknown stock list")
    return snapshot


async def _load_part(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot_id: uuid.UUID,
    part_id: uuid.UUID,
    lock: bool = False,
) -> InventorySnapshotPart:
    """A part of this list. Another list's, or another organization's, is as
    unknown as one that never existed."""
    query = select(InventorySnapshotPart).where(
        InventorySnapshotPart.id == part_id,
        InventorySnapshotPart.inventory_snapshot_id == snapshot_id,
        InventorySnapshotPart.organization_id == scope.organization_id,
    )
    if lock:
        query = query.with_for_update()
    part = (await session.scalars(query.execution_options(populate_existing=True))).one_or_none()
    if part is None:
        raise NotFoundError("Unknown file of this stock list", part_id=str(part_id))
    return part


def _reader_permission(scope: RequestScope, store_id: uuid.UUID) -> Permission:
    """Either snapshot permission lets a person see the list.

    A permission held directly in the store is preferred, because only a
    direct grant opens a private warehouse (`require_stock_access`).
    """
    direct = scope.store_permissions.get(store_id, frozenset())
    for granted in (direct, scope.permissions_for(store_id)):
        for permission in (Permission.SNAPSHOT_IMPORT, Permission.SNAPSHOT_APPROVE):
            if permission in granted:
                return permission
    return Permission.SNAPSHOT_IMPORT  # `require` refuses it with a clear message


def _acting_through(snapshot: InventorySnapshot, via_store_id: uuid.UUID | None) -> uuid.UUID:
    assert snapshot.acting_store_id is not None
    return snapshot.acting_store_id if via_store_id is None else via_store_id


async def _authorize(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot: InventorySnapshot,
    permission: Permission,
    command: bool,
    via_store_id: uuid.UUID | None = None,
) -> None:
    """The person, then the store at this warehouse, then the private rule.

    Through the list's own store, as ADR-0005 §9 has it: a command that leads
    to stock needs `can_receive` and an open warehouse and store; reading a
    list needs only reach. Through another store, reads too need that store
    to hold `can_receive` at the list's warehouse: only a store that may
    import there shares the list (ADR-0014 §7). A child store's own
    warehouse is reached by that store alone, so its list stays its own.

    A command also needs the list's own store trading, and still holding
    `can_receive` at the list's warehouse, since it acts in the ledger.
    Through that store, the scope and its access row have already refused
    it by name (`STORE_NOT_TRADING`, `LOCATION_ACCESS_DENIED`); through the
    other store, it is refused here as `LIST_STORE_NOT_TRADING` or
    `LIST_STORE_CANNOT_RECEIVE`, naming the list's store: such a list can
    only be rejected (`reject_snapshot`; owner, 2026-10-09).
    """
    assert snapshot.acting_store_id is not None and snapshot.location_id is not None
    through = _acting_through(snapshot, via_store_id)
    own = through == snapshot.acting_store_id
    await require_stock_access(
        session,
        scope=scope,
        store_id=through,
        location_ids={snapshot.location_id},
        capability=LocationCapability.RECEIVE if command or not own else None,
        permission=permission,
    )
    if command:
        # The list's own store acts in the ledger, whoever acts through which
        # store; both must trade, and the list's store must still receive
        # goods at its warehouse.
        await validate_active_stores(
            session, organization_id=scope.organization_id, store_ids={through}
        )
        await _require_own_store_trading(session, snapshot=snapshot)
        if not own:
            await _require_own_store_receiving(session, snapshot=snapshot)


async def _require_own_store_trading(session: AsyncSession, *, snapshot: InventorySnapshot) -> None:
    """The store that started the list trades, or the list is refused by
    name: `LIST_STORE_NOT_TRADING`, with that store and its state."""
    assert snapshot.acting_store_id is not None
    state = await store_state(
        session, organization_id=snapshot.organization_id, store_id=snapshot.acting_store_id
    )
    if state is None:
        raise NotFoundError("Unknown store")
    if state is not StoreState.ACTIVE:
        raise SnapshotConflictError(
            "The store that started this list does not trade; the list can only be rejected",
            reason="LIST_STORE_NOT_TRADING",
            store_id=str(snapshot.acting_store_id),
            state=state.value,
        )


async def _require_own_store_receiving(
    session: AsyncSession, *, snapshot: InventorySnapshot
) -> None:
    """The store that started the list still holds `can_receive` at its
    warehouse, the access row its own commands are checked against, or the
    list is refused by name: `LIST_STORE_CANNOT_RECEIVE`, with that store and
    the warehouse. Its opening movements act through that store (ADR-0005
    §4), so a list whose store may no longer receive goods there is not
    filled, answered or approved through the other store either: it can only
    be rejected (review, 2026-10-09)."""
    assert snapshot.acting_store_id is not None and snapshot.location_id is not None
    receiving = await accessible_locations(
        session,
        organization_id=snapshot.organization_id,
        store_id=snapshot.acting_store_id,
        capability=LocationCapability.RECEIVE,
    )
    if snapshot.location_id not in receiving:
        raise SnapshotConflictError(
            "The store that started this list can no longer receive goods into its "
            "warehouse; the list can only be rejected",
            reason="LIST_STORE_CANNOT_RECEIVE",
            store_id=str(snapshot.acting_store_id),
            location_id=str(snapshot.location_id),
        )


async def _authorize_reader(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot: InventorySnapshot,
    via_store_id: uuid.UUID | None,
) -> None:
    await _authorize(
        session,
        scope=scope,
        snapshot=snapshot,
        permission=_reader_permission(scope, _acting_through(snapshot, via_store_id)),
        command=False,
        via_store_id=via_store_id,
    )


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------


async def _summary(session: AsyncSession, snapshot_id: uuid.UUID) -> dict[str, Any]:
    counts = dict(
        (
            await session.execute(
                select(InventorySnapshotRow.status, func.count())
                .where(InventorySnapshotRow.inventory_snapshot_id == snapshot_id)
                .group_by(InventorySnapshotRow.status)
            )
        )
        .tuples()
        .all()
    )
    # A removed file's lines count nowhere (ADR-0014 §9).
    counts.pop(SnapshotRowStatus.REMOVED, None)
    per_row = (
        select(
            InventorySnapshotRow.quantity_basis.label("basis"),
            InventorySnapshotRow.quantity_total.label("stated"),
            func.count(InventorySnapshotAllocation.id).label("allocations"),
            func.sum(InventorySnapshotAllocation.quantity).label("units"),
        )
        .join(
            InventorySnapshotAllocation,
            InventorySnapshotAllocation.snapshot_row_id == InventorySnapshotRow.id,
        )
        .where(
            InventorySnapshotRow.inventory_snapshot_id == snapshot_id,
            InventorySnapshotRow.status == SnapshotRowStatus.RESOLVED,
        )
        .group_by(
            InventorySnapshotRow.id,
            InventorySnapshotRow.quantity_basis,
            InventorySnapshotRow.quantity_total,
        )
        .subquery()
    )
    by_basis = (
        await session.execute(
            select(
                per_row.c.basis,
                func.count(),
                func.sum(per_row.c.allocations),
                func.sum(per_row.c.units),
                func.sum(
                    case(
                        (
                            (per_row.c.stated.is_not(None)) & (per_row.c.stated != per_row.c.units),
                            1,
                        ),
                        else_=0,
                    )
                ),
            ).group_by(per_row.c.basis)
        )
    ).all()
    lines_by_basis = {basis.value: 0 for basis in SnapshotQuantityBasis}
    units_by_basis = {basis.value: 0 for basis in SnapshotQuantityBasis}
    allocations = units = differing = 0
    for basis, lines, basis_allocations, basis_units, basis_differing in by_basis:
        lines_by_basis[basis.value] = int(lines)
        units_by_basis[basis.value] = int(basis_units)
        allocations += int(basis_allocations)
        units += int(basis_units)
        differing += int(basis_differing)
    parts, parts_removed = (
        await session.execute(
            select(
                func.count().filter(InventorySnapshotPart.removed_at.is_(None)),
                func.count().filter(InventorySnapshotPart.removed_at.is_not(None)),
            ).where(InventorySnapshotPart.inventory_snapshot_id == snapshot_id)
        )
    ).one()
    return {
        "lines": sum(counts.values()),
        "pending": counts.get(SnapshotRowStatus.PENDING, 0),
        "needs_review": counts.get(SnapshotRowStatus.NEEDS_REVIEW, 0),
        "resolved": counts.get(SnapshotRowStatus.RESOLVED, 0),
        "skipped": counts.get(SnapshotRowStatus.SKIPPED, 0),
        "allocations": allocations,
        "units": units,
        "lines_differing_from_source": differing,
        "lines_by_basis": lines_by_basis,
        "units_by_basis": units_by_basis,
        "parts": int(parts),
        "parts_removed": int(parts_removed),
        # Both headrooms: «рядків 1 840 з 5 000 · відповідей 3 120 з 5 000».
        "limits": {"lines": MAX_LIST_LINES, "allocations": MAX_LIST_ALLOCATIONS},
    }


async def _snapshot_view(
    session: AsyncSession,
    snapshot: InventorySnapshot,
    *,
    store_name: str | None = None,
    state: StoreState | None = None,
) -> dict[str, Any]:
    assert snapshot.acting_store_id is not None
    summary = await _summary(session, snapshot.id)
    if store_name is None:
        store_name = (
            await store_names(
                session,
                organization_id=snapshot.organization_id,
                store_ids={snapshot.acting_store_id},
            )
        ).get(snapshot.acting_store_id)
    if state is None:
        state = await store_state(
            session, organization_id=snapshot.organization_id, store_id=snapshot.acting_store_id
        )
    return {
        "snapshot_id": snapshot.id,
        "command_id": snapshot.command_id,
        "store_id": snapshot.acting_store_id,
        "store_name": store_name,
        # Whether the list's own store trades: while it does not, the list
        # can only be rejected, through the other store (owner, 2026-10-09).
        "store_state": state,
        "location_id": snapshot.location_id,
        "status": snapshot.status,
        "source_document_ref": snapshot.source_document_ref,
        "captured_at": snapshot.captured_at,
        "review_revision": snapshot.review_revision,
        "created_by_user_id": snapshot.created_by_user_id,
        "created_at": snapshot.created_at,
        "approved_by_user_id": snapshot.approved_by_user_id,
        "rejected_by_user_id": snapshot.rejected_by_user_id,
        "rejection_reason": snapshot.rejection_reason,
        "decided_at": snapshot.decided_at,
        "summary": summary,
        "ready_to_approve": snapshot.status is SnapshotStatus.IN_REVIEW
        and summary["pending"] == 0
        and summary["needs_review"] == 0
        and summary["allocations"] > 0,
    }


async def _part_views(
    session: AsyncSession, *, snapshot_id: uuid.UUID, parts: Sequence[InventorySnapshotPart]
) -> list[dict[str, Any]]:
    """Each part with its progress and its overlap with the rest of the list.

    `photo_lines_elsewhere` counts the part's lines that name a photo and a
    line another part of the list names too: a photo read twice, or put in
    two files. Only lines not removed count, on either side.
    """
    if not parts:
        return []
    progress: dict[uuid.UUID, dict[SnapshotRowStatus, int]] = {}
    for part_id, status, count in (
        await session.execute(
            select(InventorySnapshotRow.part_id, InventorySnapshotRow.status, func.count())
            .where(
                InventorySnapshotRow.inventory_snapshot_id == snapshot_id,
                InventorySnapshotRow.part_id.in_([part.id for part in parts]),
            )
            .group_by(InventorySnapshotRow.part_id, InventorySnapshotRow.status)
        )
    ).tuples():
        progress.setdefault(part_id, {})[status] = count
    # One scan, and no join: a pair is named elsewhere when the parts naming
    # it are not all one. A join here is planned from statistics, and a list
    # being filled is newer than they are: a nested loop over thousands of
    # lines took seconds before autoanalyze caught up (measured, ADR-0014 §10).
    pair = (InventorySnapshotRow.photo_name, InventorySnapshotRow.photo_line)
    part_text = cast(InventorySnapshotRow.part_id, Text)
    spread = (
        select(
            InventorySnapshotRow.part_id,
            func.min(part_text).over(partition_by=pair).label("first"),
            func.max(part_text).over(partition_by=pair).label("last"),
        )
        .where(*_live_rows(snapshot_id), InventorySnapshotRow.photo_name.is_not(None))
        .subquery()
    )
    elsewhere = dict(
        (
            await session.execute(
                select(spread.c.part_id, func.count())
                .where(spread.c.first != spread.c.last)
                .group_by(spread.c.part_id)
            )
        )
        .tuples()
        .all()
    )
    views = []
    for part in parts:
        counts = progress.get(part.id, {})
        views.append(
            {
                "part_id": part.id,
                "part_no": part.part_no,
                "kind": part.kind,
                "file_name": part.file_name,
                "source": part.source,
                "counted_on": part.counted_on,
                "price_kind": part.price_kind,
                "parser": part.parser,
                "format_version": part.format_version,
                "lines": part.line_count,
                "first_line_no": part.first_line_no,
                "last_line_no": part.last_line_no,
                "added_by_user_id": part.added_by_user_id,
                "added_at": part.created_at,
                "removed_by_user_id": part.removed_by_user_id,
                "removed_at": part.removed_at,
                "progress": {
                    "pending": counts.get(SnapshotRowStatus.PENDING, 0),
                    "needs_review": counts.get(SnapshotRowStatus.NEEDS_REVIEW, 0),
                    "resolved": counts.get(SnapshotRowStatus.RESOLVED, 0),
                    "skipped": counts.get(SnapshotRowStatus.SKIPPED, 0),
                },
                "photo_lines_elsewhere": elsewhere.get(part.id, 0),
            }
        )
    return views


def _parse_summary(parsed: dict[str, Any] | None) -> dict[str, Any]:
    if parsed is None:
        return {"review_reasons": [], "candidates": {}, "unclassified": []}
    return {
        "review_reasons": list(parsed.get("review_reasons", [])),
        "candidates": {
            name: [candidate["value"] for candidate in candidates]
            for name, candidates in parsed.get("fields", {}).items()
        },
        "unclassified": [item["text"] for item in parsed.get("unclassified_descriptors", [])],
    }


async def _shown_splits(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    rows: Sequence[tuple[InventorySnapshotRow, str | None]],
) -> dict[uuid.UUID, list[dict[str, Any]]]:
    """Each kept split as the catalogue reads it now, per row and pair.

    - `size_id`: the organization's own size of that spelling, or none when
      the catalogue lacks it: what `STATED_BY_SIZE` would answer with.
    - `written`: the record as the line's text writes it («42-44»).
    - `may_be_range`: whether that record may also be a range of sizes, its
      count or the whole record being a size too (owner, 2026-10-09).

    Read at every look, never kept: a size created after the import makes
    a record ambiguous, as it makes a size known.
    """
    records = {
        row.id: split_records(text or "", row.shown_split)
        for row, text in rows
        if row.shown_split is not None
    }
    sizes = await sizes_by_spelling(
        session,
        organization_id=organization_id,
        written={
            spelling
            for found in records.values()
            for record in found
            for spelling in record.spellings()
        },
    )
    return {
        row_id: [
            {
                "size": record.size,
                "count": record.count,
                "size_id": sizes.get(record.size),
                "written": record.written,
                "may_be_range": may_be_range(record, sizes),
            }
            for record in found
        ]
        for row_id, found in records.items()
    }


def _live_rows(snapshot_id: uuid.UUID) -> Any:
    """The list's lines that count: every line but a removed file's."""
    return (
        InventorySnapshotRow.inventory_snapshot_id == snapshot_id,
        InventorySnapshotRow.status != SnapshotRowStatus.REMOVED,
    )


async def _row_views(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    rows: Sequence[InventorySnapshotRow],
) -> list[dict[str, Any]]:
    if not rows:
        return []
    allocations = (
        await session.scalars(
            select(InventorySnapshotAllocation)
            .where(InventorySnapshotAllocation.snapshot_row_id.in_([row.id for row in rows]))
            .order_by(
                InventorySnapshotAllocation.product_variant_id,
                InventorySnapshotAllocation.size_id,
            )
            .execution_options(populate_existing=True)
        )
    ).all()
    lines = await read_lines(
        session, organization_id=organization_id, raw_input_ids={row.raw_input_id for row in rows}
    )
    # Repeats are counted across the whole list, not just this page, and
    # only among the lines that count (ADR-0014 §6).
    repeats = await repeated_lines(
        session,
        organization_id=organization_id,
        raw_input_ids={row.raw_input_id for row in rows},
        among=select(InventorySnapshotRow.raw_input_id).where(*_live_rows(snapshot_id)),
    )
    photos = {
        (row.photo_name, row.photo_line)
        for row in rows
        if row.photo_name is not None and row.photo_line is not None
    }
    same_photo: dict[tuple[str | None, int | None], int] = {}
    if photos:
        same_photo = {
            (name, line): count
            for name, line, count in (
                await session.execute(
                    select(
                        InventorySnapshotRow.photo_name,
                        InventorySnapshotRow.photo_line,
                        func.count(),
                    )
                    .where(
                        *_live_rows(snapshot_id),
                        tuple_(
                            InventorySnapshotRow.photo_name, InventorySnapshotRow.photo_line
                        ).in_(photos),
                    )
                    .group_by(InventorySnapshotRow.photo_name, InventorySnapshotRow.photo_line)
                )
            ).tuples()
        }
    parts = {
        part_id: (part_no, price_kind)
        for part_id, part_no, price_kind in (
            await session.execute(
                select(
                    InventorySnapshotPart.id,
                    InventorySnapshotPart.part_no,
                    InventorySnapshotPart.price_kind,
                ).where(InventorySnapshotPart.id.in_({row.part_id for row in rows}))
            )
        ).tuples()
    }
    # The catalogue's size for each size a shown split names, and whether
    # its record may also be a range of sizes.
    splits = await _shown_splits(
        session,
        organization_id=organization_id,
        rows=[
            (row, line.raw_text if (line := lines.get(row.raw_input_id)) else None) for row in rows
        ],
    )
    names = await describe_variants(
        session, list({allocation.product_variant_id for allocation in allocations})
    )
    sizes = await size_labels(session, list({allocation.size_id for allocation in allocations}))
    by_row: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for allocation in allocations:
        description = names.get(allocation.product_variant_id)
        by_row.setdefault(allocation.snapshot_row_id, []).append(
            {
                "allocation_id": allocation.id,
                "product_variant_id": allocation.product_variant_id,
                "display_name": description.display_name if description else None,
                "size_id": allocation.size_id,
                "size_code": sizes.get(allocation.size_id),
                "quantity": allocation.quantity,
                "stock_lot_id": allocation.stock_lot_id,
            }
        )
    views = []
    for row in rows:
        line = lines.get(row.raw_input_id)
        part_no, price_kind = parts[row.part_id]
        views.append(
            {
                "line_no": row.line_no,
                "raw_input_id": row.raw_input_id,
                "raw_text": line.raw_text if line else None,
                "same_text_lines": repeats.get(row.raw_input_id, 1),
                "status": row.status,
                "quantity_state": row.quantity_state,
                "quantity_total": row.quantity_total,
                # Whether `LINE_IMPLIES_ONE` may answer it: `check_basis`'s own
                # rule, so a client offers only what the server accepts.
                "may_imply_one": row.quantity_state is SnapshotQuantityState.UNKNOWN_QUANTITY
                and countless(line.parsed if line else None, row.reading),
                **_parse_summary(line.parsed if line else None),
                "quantity_basis": row.quantity_basis,
                "split_read_as": row.split_read_as,
                "allocations": by_row.get(row.id, []),
                "resolution_note": row.resolution_note,
                "resolved_by_user_id": row.resolved_by_user_id,
                "resolved_at": row.resolved_at,
                "part_id": row.part_id,
                "part_no": part_no,
                "photo_name": row.photo_name,
                "photo_line": row.photo_line,
                "reading": row.reading,
                "price_kind": price_kind,
                "file_reasons": list(row.file_reasons),
                "shown_split": splits.get(row.id),
                # How many lines that count name this photo and line: more
                # than one is a photo read twice, or put in two files.
                "same_photo_lines": same_photo.get((row.photo_name, row.photo_line), 0)
                if row.photo_name is not None and row.photo_line is not None
                else 0,
            }
        )
    return views


# ---------------------------------------------------------------------------
# Import: a list, and its parts
# ---------------------------------------------------------------------------


async def _require_room(session: AsyncSession, *, snapshot_id: uuid.UUID, adding: int) -> None:
    """A part fits the list's lines, its rows ever added, and its parts."""
    lines, rows = (
        await session.execute(
            select(
                func.count().filter(InventorySnapshotRow.status != SnapshotRowStatus.REMOVED),
                func.count(),
            ).where(InventorySnapshotRow.inventory_snapshot_id == snapshot_id)
        )
    ).one()
    parts = await session.scalar(
        select(func.count()).where(InventorySnapshotPart.inventory_snapshot_id == snapshot_id)
    )
    for what, limit, now, more in (
        ("lines", MAX_LIST_LINES, int(lines), adding),
        ("rows", MAX_LIST_ROWS, int(rows), adding),
        ("parts", MAX_LIST_PARTS, int(parts or 0), 1),
    ):
        if now + more > limit:
            raise SnapshotConflictError(
                "This stock list has no room for this part",
                reason="LIST_FULL",
                what=what,
                limit=limit,
                now=now,
                adding=more,
            )


async def _record_part(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot: InventorySnapshot,
    store_id: uuid.UUID,
    command_id: uuid.UUID,
    command_fingerprint: str,
    texts: Sequence[str],
    file: StockFileV1 | None,
    file_name: str | None,
    source: str | None,
    counted_on: str | None,
) -> InventorySnapshotPart:
    """Keep a part's lines as evidence, after the list's last line.

    Runs under the list's row lock (or, for a new list, before anyone else
    can see it), so two parts added at once get two contiguous ranges. A
    line from a file keeps its photo, the parser's reading, and what that
    reading says about its count (`file_lines`).
    """
    await _require_room(session, snapshot_id=snapshot.id, adding=len(texts))
    content_fingerprint: str | None = None
    if file is not None:
        content_fingerprint = content_fingerprint_of_file(file)
        twin = (
            await session.scalars(
                select(InventorySnapshotPart)
                .where(
                    InventorySnapshotPart.inventory_snapshot_id == snapshot.id,
                    InventorySnapshotPart.kind == SnapshotPartKind.FILE,
                    InventorySnapshotPart.removed_at.is_(None),
                    InventorySnapshotPart.content_fingerprint == content_fingerprint,
                )
                .order_by(InventorySnapshotPart.part_no)
            )
        ).first()
        if twin is not None:
            raise SnapshotConflictError(
                "This file is already in the list",
                reason="PART_DUPLICATE",
                part_id=str(twin.id),
                part_no=twin.part_no,
                file_name=twin.file_name,
            )
    last_line = await session.scalar(
        select(func.max(InventorySnapshotRow.line_no)).where(
            InventorySnapshotRow.inventory_snapshot_id == snapshot.id
        )
    )
    last_part = await session.scalar(
        select(func.max(InventorySnapshotPart.part_no)).where(
            InventorySnapshotPart.inventory_snapshot_id == snapshot.id
        )
    )
    first_line_no = (last_line or 0) + 1
    recorded = await record_lines(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        actor_user_id=scope.user_id,
        source_kind=RawInputSource.SNAPSHOT_IMPORT,
        source_refs=[
            f"inventory_snapshot:{snapshot.id}:{line_no}"
            for line_no in range(first_line_no, first_line_no + len(texts))
        ],
        lines=texts,
    )
    part = InventorySnapshotPart(
        id=uuid.uuid4(),
        organization_id=scope.organization_id,
        inventory_snapshot_id=snapshot.id,
        part_no=(last_part or 0) + 1,
        command_id=command_id,
        command_fingerprint=command_fingerprint,
        content_fingerprint=content_fingerprint,
        kind=SnapshotPartKind.FILE if file is not None else SnapshotPartKind.PASTED,
        file_name=file_name,
        source=source,
        counted_on=counted_on,
        price_kind=SnapshotPriceKind(file.price_kind.upper())
        if file is not None and file.price_kind is not None
        else None,
        parser=file.parser if file is not None else None,
        format_version=file.version if file is not None else None,
        line_count=len(texts),
        first_line_no=first_line_no,
        last_line_no=first_line_no + len(texts) - 1,
        added_by_user_id=scope.user_id,
    )
    session.add(part)
    await session.flush()

    rows = []
    for offset, line in enumerate(recorded):
        reasons: tuple[str, ...] = ()
        extra: dict[str, Any] = {}
        if file is None:
            state, total = source_quantity(line.parsed)
        else:
            written = file.lines[offset]
            evidence = file_line_evidence(line.parsed, written)
            state, total, reasons = evidence.state, evidence.total, evidence.reasons
            extra = {
                "photo_name": written.photo,
                "photo_line": written.photo_line,
                # Exactly what the file said, beside the text it read.
                "reading": written.model_dump(
                    mode="json", exclude_none=True, exclude={"text", "photo", "photo_line"}
                ),
                "shown_split": [
                    {"size": size, "count": count} for size, count in evidence.shown_split
                ]
                if evidence.shown_split is not None
                else None,
            }
        rows.append(
            InventorySnapshotRow(
                id=uuid.uuid4(),
                inventory_snapshot_id=snapshot.id,
                part_id=part.id,
                line_no=first_line_no + offset,
                raw_input_id=line.raw_input_id,
                parse_result_id=line.parse_result_id,
                quantity_total=total,
                quantity_state=state,
                file_reasons=list(reasons),
                status=SnapshotRowStatus.NEEDS_REVIEW
                if line.parsed.get("review_reasons") or reasons
                else SnapshotRowStatus.PENDING,
                **extra,
            )
        )
    session.add_all(rows)
    await session.flush()
    return part


async def import_snapshot(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    store_id: uuid.UUID,
    location_id: uuid.UUID,
    lines: Sequence[str] | None = None,
    file: StockFileV1 | None = None,
    file_name: str | None = None,
    source_document_ref: str | None = None,
    captured_at: str | None = None,
) -> tuple[dict[str, Any], bool]:
    """Keep a legacy list as evidence, line by line. Returns `(view, created)`.

    From typed `lines` or from a parser's `file` with its `file_name`, exactly
    one: that is the list's first part. `command_id` is the client's
    permanent name for this import within its organization: repeating the
    same request returns the list as it is now; any other request under the
    same name is a conflict, and so is a name already given to an added part.
    Another organization using the same name is simply another list. Nothing
    is matched, created or counted: every line waits for a person.
    """
    await require_stock_access(
        session,
        scope=scope,
        store_id=store_id,
        location_ids={location_id},
        capability=LocationCapability.RECEIVE,
        permission=Permission.SNAPSHOT_IMPORT,
    )
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={store_id}
    )
    texts, checked, file_name = _part_content(lines=lines, file=file, file_name=file_name)
    source_document_ref = _clean_text(
        source_document_ref, limit=300, what="The source document", required=False
    )
    captured_at = _clean_text(captured_at, limit=40, what="The list's date", required=False)
    if checked is None:
        # Byte for byte the request M1-023 fingerprinted, so a retry sent
        # before this deploy still replays after it (ADR-0014 §8).
        request = lines_import_request(
            store_id=store_id,
            location_id=location_id,
            source_document_ref=source_document_ref,
            captured_at=captured_at,
            lines=texts,
        )
    else:
        request = {
            "store_id": str(store_id),
            "location_id": str(location_id),
            "source_document_ref": source_document_ref,
            "captured_at": captured_at,
            "file_name": file_name,
            "file": canonical(checked),
        }
    fingerprint = request_fingerprint(request)

    # Serializes two deliveries of the same import, and an import with a
    # part added under the same name; the unique commands would otherwise
    # turn the loser into a unique-violation 500.
    await session.execute(
        select(func.pg_advisory_xact_lock(_lock_key(scope.organization_id, command_id)))
    )
    existing = (
        await session.scalars(
            select(InventorySnapshot)
            .where(
                InventorySnapshot.organization_id == scope.organization_id,
                InventorySnapshot.command_id == command_id,
            )
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if existing is not None:
        if existing.command_fingerprint is None or existing.command_fingerprint != fingerprint:
            raise IdempotencyConflictError("This command id was already used for another list")
        # The same request: the same store and warehouse, authorized above.
        return await _snapshot_view(session, existing), False
    if await session.scalar(
        select(InventorySnapshotPart.id).where(
            InventorySnapshotPart.organization_id == scope.organization_id,
            InventorySnapshotPart.command_id == command_id,
        )
    ):
        raise IdempotencyConflictError("This command id names a file of another list")

    snapshot = InventorySnapshot(
        id=uuid.uuid4(),
        command_id=command_id,
        organization_id=scope.organization_id,
        location_id=location_id,
        acting_store_id=store_id,
        source_document_ref=source_document_ref,
        captured_at=captured_at,
        status=SnapshotStatus.IN_REVIEW,
        created_by_user_id=scope.user_id,
        command_fingerprint=fingerprint,
        review_revision=0,
    )
    session.add(snapshot)
    await session.flush()
    # The lines are parsed and kept first, while nobody else can see the
    # list: the warehouse's lock is not held over the parse of a thousand
    # lines, as it is not to add a part (ADR-0014 §8; review, 2026-10-09).
    part = await _record_part(
        session,
        scope=scope,
        snapshot=snapshot,
        store_id=store_id,
        command_id=command_id,
        command_fingerprint=fingerprint,
        texts=texts,
        file=checked,
        file_name=file_name,
        source=checked.source if checked is not None else None,
        counted_on=checked.counted_on if checked is not None else None,
    )
    # Nothing moves in the warehouse until the list is decided, while it has
    # no history (owner decision, 2026-10-02). A stock command there lands
    # wholly before the hold, and the approval finds its history, or after.
    await hold_for_opening_list(
        session,
        organization_id=scope.organization_id,
        location_id=location_id,
        snapshot_id=snapshot.id,
    )
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="snapshot.imported",
        entity_type="inventory_snapshot",
        entity_id=snapshot.id,
        after={
            "command_id": str(command_id),
            "store_id": str(store_id),
            "location_id": str(location_id),
            "lines": len(texts),
            "source_document_ref": source_document_ref,
            "captured_at": captured_at,
            "part_id": str(part.id),
            "kind": part.kind.value,
            "file_name": part.file_name,
            "format_version": part.format_version,
            "parser": part.parser,
        },
    )
    return await _snapshot_view(session, snapshot), True


async def _part_change(
    session: AsyncSession, snapshot: InventorySnapshot, part: InventorySnapshotPart
) -> dict[str, Any]:
    views = await _part_views(session, snapshot_id=snapshot.id, parts=[part])
    return {"snapshot": await _snapshot_view(session, snapshot), "part": views[0]}


async def add_part(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot_id: uuid.UUID,
    command_id: uuid.UUID,
    via_store_id: uuid.UUID | None = None,
    lines: Sequence[str] | None = None,
    file: StockFileV1 | None = None,
    file_name: str | None = None,
    source: str | None = None,
    counted_on: str | None = None,
) -> tuple[dict[str, Any], bool]:
    """Add a file, or hand-typed lines, to a list under review. Returns
    `({snapshot, part}, created)` (ADR-0014 §8).

    `command_id` names the part for good: the same request again answers
    with the part as it is now, even removed since, even once the list is
    decided; another request under it, or a list's name, is a conflict. The
    same file is not added twice to one list while neither copy is removed.
    A file naming photos and lines the list already holds is added, and the
    answer counts them (`photo_lines_elsewhere`), so a person can remove it.

    Locks: the command, then the list. No warehouse lock: the list's hold
    already keeps the warehouse still, and an approval takes the list first,
    so a part added after one finds the list decided.
    """
    observed = await _load(session, scope=scope, snapshot_id=snapshot_id)
    await _authorize(
        session,
        scope=scope,
        snapshot=observed,
        permission=Permission.SNAPSHOT_IMPORT,
        command=True,
        via_store_id=via_store_id,
    )
    texts, checked, file_name = _part_content(lines=lines, file=file, file_name=file_name)
    if checked is not None:
        if source is not None or counted_on is not None:
            raise ValidationFailedError("A file says where it came from itself")
        request: dict[str, Any] = {
            "snapshot_id": str(snapshot_id),
            "kind": SnapshotPartKind.FILE.value,
            "file_name": file_name,
            "file": canonical(checked),
        }
        source, counted_on = checked.source, checked.counted_on
    else:
        source = _clean_text(source, limit=300, what="The source document", required=False)
        counted_on = _clean_text(counted_on, limit=40, what="The lines' date", required=False)
        request = {
            "snapshot_id": str(snapshot_id),
            "kind": SnapshotPartKind.PASTED.value,
            "lines": texts,
            "source": source,
            "counted_on": counted_on,
        }
    fingerprint = request_fingerprint(request)

    await session.execute(
        select(func.pg_advisory_xact_lock(_lock_key(scope.organization_id, command_id)))
    )
    existing = (
        await session.scalars(
            select(InventorySnapshotPart)
            .where(
                InventorySnapshotPart.organization_id == scope.organization_id,
                InventorySnapshotPart.command_id == command_id,
            )
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if existing is not None:
        if existing.inventory_snapshot_id != snapshot_id:
            raise IdempotencyConflictError("This command id names a file of another list")
        if existing.command_fingerprint is None or existing.command_fingerprint != fingerprint:
            raise IdempotencyConflictError("This command id was already used for another file")
        current = await _load(session, scope=scope, snapshot_id=snapshot_id)
        return await _part_change(session, current, existing), False
    if await session.scalar(
        select(InventorySnapshot.id).where(
            InventorySnapshot.organization_id == scope.organization_id,
            InventorySnapshot.command_id == command_id,
        )
    ):
        raise IdempotencyConflictError("This command id names a stock list")

    snapshot = await _load(session, scope=scope, snapshot_id=snapshot_id, lock=True)
    if snapshot.status is not SnapshotStatus.IN_REVIEW:
        raise SnapshotConflictError(
            "This stock list is already decided", reason="ALREADY_DECIDED", status=snapshot.status
        )
    part = await _record_part(
        session,
        scope=scope,
        snapshot=snapshot,
        store_id=_acting_through(snapshot, via_store_id),
        command_id=command_id,
        command_fingerprint=fingerprint,
        texts=texts,
        file=checked,
        file_name=file_name,
        source=source,
        counted_on=counted_on,
    )
    snapshot.review_revision += 1
    await session.flush()
    result = await _part_change(session, snapshot, part)
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="snapshot.part_added",
        entity_type="inventory_snapshot",
        entity_id=snapshot.id,
        after={
            "part_id": str(part.id),
            "part_no": part.part_no,
            "kind": part.kind.value,
            "file_name": part.file_name,
            "source": part.source,
            "counted_on": part.counted_on,
            "parser": part.parser,
            "format_version": part.format_version,
            "lines": part.line_count,
            "first_line_no": part.first_line_no,
            "last_line_no": part.last_line_no,
            "photo_lines_elsewhere": result["part"]["photo_lines_elsewhere"],
            "review_revision": snapshot.review_revision,
            "via_store_id": str(_acting_through(snapshot, via_store_id)),
        },
    )
    return result, True


async def remove_part(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot_id: uuid.UUID,
    part_id: uuid.UUID,
    via_store_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Take a part added by mistake out of a list under review, with the
    answers given to its lines. Returns `{snapshot, part}` (ADR-0014 §9).

    Any owner or manager who may import there removes any part, with no
    reason (owner, 2026-10-08); the history shows who and when. A part
    already removed is answered as it is, before the list's state is
    checked. The last part is never removed: the list is rejected instead,
    which also lets its warehouse go. The part's lines stay as evidence,
    `REMOVED`, and count nowhere; every earlier answer stays in its own
    `snapshot.line_resolved` entry. Removal is final: a removed file comes
    back only by being added again, as a new part.
    """
    observed = await _load(session, scope=scope, snapshot_id=snapshot_id)
    await _authorize(
        session,
        scope=scope,
        snapshot=observed,
        permission=Permission.SNAPSHOT_IMPORT,
        command=True,
        via_store_id=via_store_id,
    )
    snapshot = await _load(session, scope=scope, snapshot_id=snapshot_id, lock=True)
    part = await _load_part(
        session, scope=scope, snapshot_id=snapshot_id, part_id=part_id, lock=True
    )
    if part.removed_at is not None:
        return await _part_change(session, snapshot, part)
    if snapshot.status is not SnapshotStatus.IN_REVIEW:
        raise SnapshotConflictError(
            "This stock list is already decided", reason="ALREADY_DECIDED", status=snapshot.status
        )
    others = await session.scalar(
        select(func.count()).where(
            InventorySnapshotPart.inventory_snapshot_id == snapshot_id,
            InventorySnapshotPart.removed_at.is_(None),
            InventorySnapshotPart.id != part.id,
        )
    )
    if not others:
        raise SnapshotConflictError(
            "The last file of a list is not removed; reject the list instead",
            reason="LAST_PART",
            part_id=str(part.id),
        )

    its_rows = select(InventorySnapshotRow.id).where(InventorySnapshotRow.part_id == part.id)
    statuses = dict(
        (
            await session.execute(
                select(InventorySnapshotRow.status, func.count())
                .where(InventorySnapshotRow.part_id == part.id)
                .group_by(InventorySnapshotRow.status)
            )
        )
        .tuples()
        .all()
    )
    allocations, units = (
        await session.execute(
            select(
                func.count(InventorySnapshotAllocation.id),
                func.coalesce(func.sum(InventorySnapshotAllocation.quantity), 0),
            ).where(InventorySnapshotAllocation.snapshot_row_id.in_(its_rows))
        )
    ).one()
    raw_input_ids = set(
        (
            await session.scalars(
                select(InventorySnapshotRow.raw_input_id).where(
                    InventorySnapshotRow.part_id == part.id
                )
            )
        ).all()
    )
    # In this order: the database lets a line be removed only once its part
    # is, and only without an answer (`inventory_snapshot_row_is_fixed`).
    await session.execute(
        delete(InventorySnapshotAllocation)
        .where(InventorySnapshotAllocation.snapshot_row_id.in_(its_rows))
        .execution_options(synchronize_session=False)
    )
    part.removed_at = _now()
    part.removed_by_user_id = scope.user_id
    await session.flush()
    await session.execute(
        update(InventorySnapshotRow)
        .where(InventorySnapshotRow.part_id == part.id)
        .values(
            status=SnapshotRowStatus.REMOVED,
            quantity_basis=None,
            split_read_as=None,
            split_read_records=None,
            resolution_note=None,
            resolved_by_user_id=None,
            resolved_at=None,
        )
        .execution_options(synchronize_session=False)
    )
    await mark_lines(
        session, organization_id=scope.organization_id, raw_input_ids=raw_input_ids, resolved=False
    )
    snapshot.review_revision += 1
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="snapshot.part_removed",
        entity_type="inventory_snapshot",
        entity_id=snapshot.id,
        before={
            "lines": part.line_count,
            "pending": statuses.get(SnapshotRowStatus.PENDING, 0),
            "needs_review": statuses.get(SnapshotRowStatus.NEEDS_REVIEW, 0),
            "resolved": statuses.get(SnapshotRowStatus.RESOLVED, 0),
            "skipped": statuses.get(SnapshotRowStatus.SKIPPED, 0),
            "allocations": int(allocations),
            "units": int(units),
        },
        after={
            "part_id": str(part.id),
            "part_no": part.part_no,
            "kind": part.kind.value,
            "file_name": part.file_name,
            "first_line_no": part.first_line_no,
            "last_line_no": part.last_line_no,
            "removed_at": part.removed_at.isoformat(),
            "review_revision": snapshot.review_revision,
            "via_store_id": str(_acting_through(snapshot, via_store_id)),
        },
    )
    return await _part_change(session, snapshot, part)


# ---------------------------------------------------------------------------
# Review
# ---------------------------------------------------------------------------


async def _normalize_allocations(
    session: AsyncSession, *, organization_id: uuid.UUID, allocations: Sequence[AllocationInput]
) -> list[tuple[uuid.UUID, uuid.UUID, int]]:
    """Validate a line's answer and put it in one canonical order.

    Every variant must be active with an active identity chain in this
    organization, every size must belong to it. The same variant and size
    twice is refused rather than summed: it is almost always a slip, and
    silently adding would turn it into stock.
    """
    if not 1 <= len(allocations) <= MAX_ALLOCATIONS:
        raise ValidationFailedError(f"A line takes 1 to {MAX_ALLOCATIONS} allocations")
    for allocation in allocations:
        if (allocation.size_id is None) != allocation.size_unknown:
            raise ValidationFailedError("Give each allocation a size, or say the size is unknown")
        if type(allocation.quantity) is not int or not 1 <= allocation.quantity <= MAX_QUANTITY:
            raise ValidationFailedError(f"A quantity is a whole number from 1 to {MAX_QUANTITY}")
    unknown_size_id: uuid.UUID | None = None
    if any(allocation.size_unknown for allocation in allocations):
        unknown_size_id = await ensure_unknown_size(session, organization_id=organization_id)
    stated: dict[tuple[uuid.UUID, uuid.UUID], int] = {}
    for allocation in allocations:
        size_id = unknown_size_id if allocation.size_unknown else allocation.size_id
        assert size_id is not None
        key = (allocation.product_variant_id, size_id)
        if key in stated:
            raise ValidationFailedError("The same product and size appear twice in one line")
        stated[key] = allocation.quantity
    variant_ids = {variant_id for variant_id, _ in stated}
    await validate_stock_references(
        session,
        organization_id=organization_id,
        variant_ids=variant_ids,
        size_ids={size_id for _, size_id in stated},
    )
    # Held as a stock command holds them, so a merge or a retirement running
    # now lands wholly before this answer (and refuses it) or after it, and
    # then finds this list waiting (ADR-0008 §5).
    await require_active_variants(
        session, organization_id=organization_id, variant_ids=variant_ids, hold=True
    )
    return sorted(
        (variant_id, size_id, quantity) for (variant_id, size_id), quantity in stated.items()
    )


def _record_key(pair: dict[str, Any]) -> str:
    """A record of a shown split as the person was asked about it: as the
    text writes it («42-44»), or its size when the text no longer shows it."""
    return str(pair["written"] or pair["size"])


def _stated_split(
    split: Sequence[dict[str, Any]] | None, read_as: SplitReading | None
) -> list[tuple[uuid.UUID, int]] | None:
    """The split a line shows, as `STATED_BY_SIZE` may answer it: the
    catalogue's own size for each size as written, with its count.

    A size the catalogue lacks makes it unavailable: the person creates the
    size, or answers with a note (ADR-0014 §5). A record that may also be a
    range of sizes («42-44») needs the person to have said it is a size
    with its count, `read_as` (owner, 2026-10-09); checked here, at the
    answer, since a size created after the line was read can make it so.
    """
    if split is None:
        return None
    shown = []
    for pair in split:
        if pair["size_id"] is None:
            raise ValidationFailedError(
                "A size of this line is not in the catalogue", size=pair["size"]
            )
        shown.append((pair["size_id"], int(pair["count"])))
    ranges = [_record_key(pair) for pair in split if pair["may_be_range"]]
    if ranges and read_as is not SplitReading.SIZE_WITH_COUNT:
        raise ValidationFailedError(
            "A record of this line may also be a range of sizes; say what it means",
            reason="SPLIT_MAY_BE_RANGE",
            records=ranges,
        )
    return shown


def _row_state(
    row: InventorySnapshotRow, allocations: list[tuple[uuid.UUID, uuid.UUID, int]]
) -> dict[str, Any]:
    return {
        "status": row.status.value,
        "quantity_basis": row.quantity_basis.value if row.quantity_basis else None,
        "split_read_as": row.split_read_as,
        "split_read_records": row.split_read_records,
        "resolution_note": row.resolution_note,
        "allocations": [
            {"product_variant_id": str(variant_id), "size_id": str(size_id), "quantity": quantity}
            for variant_id, size_id, quantity in allocations
        ],
    }


async def resolve_row(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot_id: uuid.UUID,
    line_no: int,
    allocations: Sequence[AllocationInput] | None = None,
    quantity_basis: SnapshotQuantityBasis | None = None,
    skip_reason: str | None = None,
    note: str | None = None,
    via_store_id: uuid.UUID | None = None,
    split_read_as: SplitReading | None = None,
) -> dict[str, Any]:
    """Say what one line means, replacing whatever was said before.

    Either allocations with the basis of their numbers (`check_basis`) and an
    optional note, or a reason the line is not stock. Repeating the current
    answer changes nothing; any other answer bumps the list's
    `review_revision`, so an approval can never apply a list that changed
    after it was checked. A line of a removed file takes no answer.

    `split_read_as` is what the person said a record of the line's split
    means, when it may also be a range of sizes (`_stated_split`): it goes
    only with `STATED_BY_SIZE`, and the line and the answer's audit entry
    keep it, with the records it was said of (`split_read_records`: those
    that may be a range as the person answers). The approval reads each
    record again, since a size created after the answer can make another
    record a possible range (`approve_snapshot`).
    """
    observed = await _load(session, scope=scope, snapshot_id=snapshot_id)
    await _authorize(
        session,
        scope=scope,
        snapshot=observed,
        permission=Permission.SNAPSHOT_IMPORT,
        command=True,
        via_store_id=via_store_id,
    )
    snapshot = await _load(session, scope=scope, snapshot_id=snapshot_id, lock=True)
    if snapshot.status is not SnapshotStatus.IN_REVIEW:
        raise SnapshotConflictError(
            "This stock list is already decided", reason="ALREADY_DECIDED", status=snapshot.status
        )
    row = (
        await session.scalars(
            select(InventorySnapshotRow)
            .where(
                InventorySnapshotRow.inventory_snapshot_id == snapshot_id,
                InventorySnapshotRow.line_no == line_no,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Unknown line in this stock list", line_no=line_no)
    if row.status is SnapshotRowStatus.REMOVED:
        raise SnapshotConflictError(
            "This line's file was removed from the list",
            reason="PART_REMOVED",
            line_no=line_no,
            part_id=str(row.part_id),
        )

    if (allocations is None) == (skip_reason is None):
        raise ValidationFailedError("Give the line's allocations, or a reason to skip it")
    if split_read_as is not None and quantity_basis is not SnapshotQuantityBasis.STATED_BY_SIZE:
        raise ValidationFailedError("What a record of the split means goes only with its split")
    read: dict[str, Any] = {}
    read_records: list[str] | None = None
    desired: list[tuple[uuid.UUID, uuid.UUID, int]]
    basis: SnapshotQuantityBasis | None
    if skip_reason is not None:
        if note is not None or quantity_basis is not None:
            raise ValidationFailedError("A skipped line is explained by its reason alone")
        new_status = SnapshotRowStatus.SKIPPED
        new_note = _clean_text(skip_reason, limit=MAX_NOTE, what="The reason", required=True)
        basis = None
        desired = []
    else:
        assert allocations is not None
        if quantity_basis is None:
            raise ValidationFailedError("Say where the numbers in this answer came from")
        new_status = SnapshotRowStatus.RESOLVED
        new_note = _clean_text(note, limit=MAX_NOTE, what="The note", required=False)
        basis = quantity_basis
        desired = await _normalize_allocations(
            session, organization_id=scope.organization_id, allocations=allocations
        )
        evidence = (
            await read_lines(
                session, organization_id=scope.organization_id, raw_input_ids={row.raw_input_id}
            )
        ).get(row.raw_input_id)
        shown = None
        if basis is SnapshotQuantityBasis.STATED_BY_SIZE:
            split = (
                await _shown_splits(
                    session,
                    organization_id=scope.organization_id,
                    rows=[(row, evidence.raw_text if evidence else None)],
                )
            ).get(row.id)
            shown = _stated_split(split, split_read_as)
            if split_read_as is not None:
                # What the person said the record means, beside the records
                # that could be read otherwise when they said it: those, and
                # only those, it was said of.
                read_records = [_record_key(pair) for pair in split or () if pair["may_be_range"]]
                read = {
                    "split_read_as": split_read_as.value,
                    "split_may_be_range": [
                        pair["written"] for pair in split or () if pair["may_be_range"]
                    ],
                }
        check_basis(
            state=row.quantity_state,
            stated_total=row.quantity_total,
            basis=basis,
            quantities=[quantity for _, _, quantity in desired],
            note=new_note,
            countless=countless(evidence.parsed if evidence else None, row.reading),
            answer=desired,
            shown=shown,
        )
        elsewhere = await session.scalar(
            select(func.count(InventorySnapshotAllocation.id))
            .join(
                InventorySnapshotRow,
                InventorySnapshotRow.id == InventorySnapshotAllocation.snapshot_row_id,
            )
            .where(
                InventorySnapshotRow.inventory_snapshot_id == snapshot_id,
                InventorySnapshotRow.id != row.id,
            )
        )
        if (elsewhere or 0) + len(desired) > MAX_LIST_ALLOCATIONS:
            # Still a 422, as every refusal of an answer is, and named as a
            # full list is: what is full, its limit, what the other lines
            # hold and what this answer adds (owner's limit, 2026-10-08).
            raise ValidationFailedError(
                f"A stock list takes at most {MAX_LIST_ALLOCATIONS} allocations in all",
                reason="LIST_FULL",
                what="allocations",
                limit=MAX_LIST_ALLOCATIONS,
                now=int(elsewhere or 0),
                adding=len(desired),
            )

    current_rows = list(
        (
            await session.scalars(
                select(InventorySnapshotAllocation).where(
                    InventorySnapshotAllocation.snapshot_row_id == row.id
                )
            )
        ).all()
    )
    current = sorted(
        (allocation.product_variant_id, allocation.size_id, allocation.quantity)
        for allocation in current_rows
    )
    read_as = split_read_as.value if split_read_as is not None else None
    unchanged = (
        row.status is new_status
        and row.quantity_basis is basis
        and row.split_read_as == read_as
        and row.split_read_records == read_records
        and row.resolution_note == new_note
        and current == desired
    )
    if not unchanged:
        before = _row_state(row, current)
        for allocation in current_rows:
            await session.delete(allocation)
        # The unique key may be reused by the new answer; the delete must land first.
        await session.flush()
        session.add_all(
            InventorySnapshotAllocation(
                id=uuid.uuid4(),
                snapshot_row_id=row.id,
                product_variant_id=variant_id,
                size_id=size_id,
                quantity=quantity,
            )
            for variant_id, size_id, quantity in desired
        )
        row.status = new_status
        row.quantity_basis = basis
        row.split_read_as = read_as
        row.split_read_records = read_records
        row.resolution_note = new_note
        row.resolved_by_user_id = scope.user_id
        row.resolved_at = _now()
        snapshot.review_revision += 1
        await session.flush()
        await mark_lines(
            session,
            organization_id=scope.organization_id,
            raw_input_ids={row.raw_input_id},
            resolved=new_status is SnapshotRowStatus.RESOLVED,
        )
        await audit.record(
            session,
            organization_id=scope.organization_id,
            actor_user_id=scope.user_id,
            action="snapshot.line_resolved",
            entity_type="inventory_snapshot_row",
            entity_id=row.id,
            before=before,
            after={
                **_row_state(row, desired),
                "review_revision": snapshot.review_revision,
                **read,
                "via_store_id": str(_acting_through(snapshot, via_store_id)),
            },
            reason=new_note,
        )
    view = await _row_views(
        session, organization_id=scope.organization_id, snapshot_id=snapshot_id, rows=[row]
    )
    return {"snapshot": await _snapshot_view(session, snapshot), "line": view[0]}


# ---------------------------------------------------------------------------
# Decision
# ---------------------------------------------------------------------------


def _counted_allocations(snapshot_id: uuid.UUID) -> Any:
    """The answers that count: resolved lines of parts not removed. A removed
    line has none (the database sees to it); the service filters too."""
    return (
        select(InventorySnapshotAllocation)
        .join(
            InventorySnapshotRow,
            InventorySnapshotRow.id == InventorySnapshotAllocation.snapshot_row_id,
        )
        .join(InventorySnapshotPart, InventorySnapshotPart.id == InventorySnapshotRow.part_id)
        .where(
            InventorySnapshotRow.inventory_snapshot_id == snapshot_id,
            InventorySnapshotRow.status == SnapshotRowStatus.RESOLVED,
            InventorySnapshotPart.removed_at.is_(None),
        )
    )


async def _splits_unsaid(
    session: AsyncSession, *, organization_id: uuid.UUID, snapshot_id: uuid.UUID
) -> list[int]:
    """The lines answered `STATED_BY_SIZE` whose split holds a record that may
    now be a range of sizes, and nobody said that record is a size with its
    count.

    A record is read against the catalogue as it is now (`_shown_splits`),
    as at every look: a size created after the answer makes «M-3» ambiguous
    from then on, with a size «3» (owner, 2026-10-09). The person's word
    covers the records it was said of (`split_read_records`), never one that
    became ambiguous after it: «Куртка 42-44 46-2», answered for «42-44»,
    is asked again once a size «2» makes «46-2» a range too (review,
    2026-10-09). Only lines that count: resolved, of parts not removed.

    The rows and their texts are read in one statement (`text_of`).
    """
    found = await session.execute(
        select(
            InventorySnapshotRow,
            text_of(InventorySnapshotRow.raw_input_id, organization_id=organization_id),
        )
        .join(InventorySnapshotPart, InventorySnapshotPart.id == InventorySnapshotRow.part_id)
        .where(
            InventorySnapshotRow.inventory_snapshot_id == snapshot_id,
            InventorySnapshotRow.status == SnapshotRowStatus.RESOLVED,
            InventorySnapshotRow.quantity_basis == SnapshotQuantityBasis.STATED_BY_SIZE,
            InventorySnapshotPart.removed_at.is_(None),
        )
        .order_by(InventorySnapshotRow.line_no)
        .execution_options(populate_existing=True)
    )
    rows = list(found.tuples().all())
    if not rows:
        return []
    splits = await _shown_splits(session, organization_id=organization_id, rows=rows)
    unsaid = []
    for row, _ in rows:
        said = (
            set(row.split_read_records or ())
            if row.split_read_as == SplitReading.SIZE_WITH_COUNT
            else set()
        )
        if any(
            pair["may_be_range"] and _record_key(pair) not in said
            for pair in splits.get(row.id, ())
        ):
            unsaid.append(row.line_no)
    return unsaid


async def _application(session: AsyncSession, *, snapshot: InventorySnapshot) -> dict[str, Any]:
    """What an applied list became, in all: units and allocations. The lines
    themselves are read by pages (`list_application`)."""
    counted = _counted_allocations(snapshot.id).subquery()
    allocations, units = (
        await session.execute(
            select(func.count(counted.c.id), func.coalesce(func.sum(counted.c.quantity), 0))
        )
    ).one()
    return {"units": int(units), "allocations": int(allocations)}


async def approve_snapshot(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot_id: uuid.UUID,
    expected_revision: int,
    via_store_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Turn the whole list into opening stock, or refuse and change nothing.

    `expected_revision` is the review revision the approver looked at. The
    same approval repeated returns what it did; an approval of any other
    revision is refused. Invariant I17 holds by construction: the only thing
    this can write is `OPENING_BALANCE` (`inventory.apply_opening_balance`),
    and the database refuses an opening balance that names no list. A
    removed file's lines are not part of it. A line answered by size whose
    record may now be a range of sizes, without the person having said it is
    a size with its count, is refused by name (`SPLIT_MAY_BE_RANGE`).
    """
    if expected_revision < 0:
        raise ValidationFailedError("A review revision is never negative")
    observed = await _load(session, scope=scope, snapshot_id=snapshot_id)
    await _authorize(
        session,
        scope=scope,
        snapshot=observed,
        permission=Permission.SNAPSHOT_APPROVE,
        command=True,
        via_store_id=via_store_id,
    )
    snapshot = await _load(session, scope=scope, snapshot_id=snapshot_id, lock=True)
    assert snapshot.acting_store_id is not None and snapshot.location_id is not None
    if snapshot.status is SnapshotStatus.APPLIED:
        if expected_revision != snapshot.review_revision:
            raise SnapshotConflictError(
                "This stock list was approved at another revision",
                reason="ALREADY_DECIDED",
                status=snapshot.status,
                review_revision=snapshot.review_revision,
            )
        return {
            **await _snapshot_view(session, snapshot),
            "application": await _application(session, snapshot=snapshot),
        }
    if snapshot.status is not SnapshotStatus.IN_REVIEW:
        raise SnapshotConflictError(
            "This stock list is already decided", reason="ALREADY_DECIDED", status=snapshot.status
        )
    if expected_revision != snapshot.review_revision:
        raise SnapshotConflictError(
            "This stock list changed after it was checked; look at it again",
            reason="REVISION_CHANGED",
            review_revision=snapshot.review_revision,
        )
    open_lines = list(
        (
            await session.scalars(
                select(InventorySnapshotRow.line_no)
                .join(
                    InventorySnapshotPart,
                    InventorySnapshotPart.id == InventorySnapshotRow.part_id,
                )
                .where(
                    InventorySnapshotRow.inventory_snapshot_id == snapshot_id,
                    InventorySnapshotRow.status.in_(OPEN_ROW_STATUSES),
                    InventorySnapshotPart.removed_at.is_(None),
                )
                .order_by(InventorySnapshotRow.line_no)
            )
        ).all()
    )
    if open_lines:
        raise SnapshotConflictError(
            "Some lines still need a person to say what they are",
            reason="ROWS_NEED_REVIEW",
            count=len(open_lines),
            line_nos=open_lines[:50],
        )
    # Answered by size, checked at the answer, and read again now: a size
    # created since can make a record a possible range, and the person must
    # say what it means before it opens the warehouse (owner, 2026-10-09).
    unsaid = await _splits_unsaid(
        session, organization_id=scope.organization_id, snapshot_id=snapshot_id
    )
    if unsaid:
        raise SnapshotConflictError(
            "Some lines answered by size may now be read as ranges of sizes; "
            "say what their records mean",
            reason="SPLIT_MAY_BE_RANGE",
            count=len(unsaid),
            line_nos=unsaid[:50],
        )
    allocations = list(
        (
            await session.scalars(
                _counted_allocations(snapshot_id)
                .order_by(
                    InventorySnapshotRow.line_no,
                    InventorySnapshotAllocation.product_variant_id,
                    InventorySnapshotAllocation.size_id,
                )
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    if not allocations:
        raise SnapshotConflictError(
            "Nothing in this stock list is stock", reason="NOTHING_TO_APPLY"
        )
    # Resolved against the catalog as it was; approved against the catalog as
    # it is. A variant merged or retired in between needs its line re-resolved,
    # so the refusal names its lines. Held before the warehouse's lock, the
    # one lock order of every command (ADR-0008 §9).
    try:
        await require_active_variants(
            session,
            organization_id=scope.organization_id,
            variant_ids={allocation.product_variant_id for allocation in allocations},
            hold=True,
        )
    except (ModelMergedError, ModelRetiredError) as refused:
        named = uuid.UUID(refused.details["product_variant_id"])
        refused.details["line_nos"] = sorted(
            (
                await session.scalars(
                    select(InventorySnapshotRow.line_no).where(
                        InventorySnapshotRow.id.in_(
                            {
                                allocation.snapshot_row_id
                                for allocation in allocations
                                if allocation.product_variant_id == named
                            }
                        )
                    )
                )
            ).all()
        )
        raise
    opened = await apply_opening_balance(
        session,
        organization_id=scope.organization_id,
        location_id=snapshot.location_id,
        acting_store_id=snapshot.acting_store_id,
        snapshot_id=snapshot.id,
        lines=[
            OpeningBalanceLine(
                reference_id=allocation.id,
                product_variant_id=allocation.product_variant_id,
                size_id=allocation.size_id,
                quantity=allocation.quantity,
            )
            for allocation in allocations
        ],
        actor_user_id=scope.user_id,
        correlation_id=get_correlation_id(),
    )
    lots = {entry.line.reference_id: entry.stock_lot_id for entry in opened}
    for allocation in allocations:
        allocation.stock_lot_id = lots[allocation.id]
    # Linked while the list is still under review: once it is applied, the
    # database refuses any change to it (`inventory_snapshot_is_final`).
    await session.flush()
    snapshot.status = SnapshotStatus.APPLIED
    snapshot.approved_by_user_id = scope.user_id
    snapshot.decided_at = _now()
    await session.flush()
    view = await _snapshot_view(session, snapshot)
    parts = (
        await session.scalars(
            select(InventorySnapshotPart)
            .where(
                InventorySnapshotPart.inventory_snapshot_id == snapshot.id,
                InventorySnapshotPart.removed_at.is_(None),
            )
            .order_by(InventorySnapshotPart.part_no)
        )
    ).all()
    lines_removed = await session.scalar(
        select(func.count()).where(
            InventorySnapshotRow.inventory_snapshot_id == snapshot.id,
            InventorySnapshotRow.status == SnapshotRowStatus.REMOVED,
        )
    )
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="snapshot.applied",
        entity_type="inventory_snapshot",
        entity_id=snapshot.id,
        before={"status": SnapshotStatus.IN_REVIEW.value},
        after={
            "status": SnapshotStatus.APPLIED.value,
            "review_revision": snapshot.review_revision,
            "acting_store_id": str(snapshot.acting_store_id),
            "location_id": str(snapshot.location_id),
            "captured_at": snapshot.captured_at,
            "source_document_ref": snapshot.source_document_ref,
            "lines_resolved": view["summary"]["resolved"],
            "lines_skipped": view["summary"]["skipped"],
            "lines_removed": int(lines_removed or 0),
            "allocations": len(allocations),
            "units": sum(allocation.quantity for allocation in allocations),
            "lines_by_basis": view["summary"]["lines_by_basis"],
            "units_by_basis": view["summary"]["units_by_basis"],
            "parts": [
                {
                    "part_id": str(part.id),
                    "part_no": part.part_no,
                    "kind": part.kind.value,
                    "file_name": part.file_name,
                    "lines": part.line_count,
                }
                for part in parts
            ],
            "via_store_id": str(_acting_through(snapshot, via_store_id)),
        },
    )
    return {
        **view,
        "application": {
            "units": sum(allocation.quantity for allocation in allocations),
            "allocations": len(allocations),
        },
    }


async def reject_snapshot(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot_id: uuid.UUID,
    reason: str,
    via_store_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Close a list without turning any of it into stock. The evidence stays.

    Through its own store, needs only reach, not `can_receive` or an open
    warehouse: a list for a paused warehouse can still be abandoned.

    Only the store acted through must trade. While the list's own store is
    blocked or archived, the list is rejected through the other store, by
    its managers or the owner, which releases the warehouse; its files then
    go into a new list started there. It is still not approved while its own
    store does not trade (owner decision, 2026-10-09).
    """
    clean = _clean_text(reason, limit=MAX_NOTE, what="The reason", required=True)
    observed = await _load(session, scope=scope, snapshot_id=snapshot_id)
    assert observed.acting_store_id is not None
    await _authorize_reader(session, scope=scope, snapshot=observed, via_store_id=via_store_id)
    await validate_active_stores(
        session,
        organization_id=scope.organization_id,
        store_ids={_acting_through(observed, via_store_id)},
    )
    snapshot = await _load(session, scope=scope, snapshot_id=snapshot_id, lock=True)
    if snapshot.status is SnapshotStatus.REJECTED:
        if snapshot.rejection_reason != clean:
            raise IdempotencyConflictError(
                "This stock list was already rejected for another reason"
            )
        return await _snapshot_view(session, snapshot)
    if snapshot.status is not SnapshotStatus.IN_REVIEW:
        raise SnapshotConflictError(
            "This stock list is already decided", reason="ALREADY_DECIDED", status=snapshot.status
        )
    snapshot.status = SnapshotStatus.REJECTED
    snapshot.rejected_by_user_id = scope.user_id
    snapshot.rejection_reason = clean
    snapshot.decided_at = _now()
    await session.flush()
    await release_opening_list(session, snapshot_id=snapshot.id)
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="snapshot.rejected",
        entity_type="inventory_snapshot",
        entity_id=snapshot.id,
        before={"status": SnapshotStatus.IN_REVIEW.value},
        after={
            "status": SnapshotStatus.REJECTED.value,
            "acting_store_id": str(snapshot.acting_store_id),
            "location_id": str(snapshot.location_id),
            "via_store_id": str(_acting_through(snapshot, via_store_id)),
        },
        reason=clean,
    )
    return await _snapshot_view(session, snapshot)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def get_snapshot(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot_id: uuid.UUID,
    via_store_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    snapshot = await _load(session, scope=scope, snapshot_id=snapshot_id)
    await _authorize_reader(session, scope=scope, snapshot=snapshot, via_store_id=via_store_id)
    view = await _snapshot_view(session, snapshot)
    if snapshot.status is SnapshotStatus.APPLIED:
        view["application"] = await _application(session, snapshot=snapshot)
    return view


async def list_parts(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot_id: uuid.UUID,
    via_store_id: uuid.UUID | None = None,
) -> list[dict[str, Any]]:
    """Every part of the list, removed ones included, in the order added.
    At most `MAX_LIST_PARTS`, so one page."""
    snapshot = await _load(session, scope=scope, snapshot_id=snapshot_id)
    await _authorize_reader(session, scope=scope, snapshot=snapshot, via_store_id=via_store_id)
    parts = (
        await session.scalars(
            select(InventorySnapshotPart)
            .where(InventorySnapshotPart.inventory_snapshot_id == snapshot_id)
            .order_by(InventorySnapshotPart.part_no)
            .execution_options(populate_existing=True)
        )
    ).all()
    return await _part_views(session, snapshot_id=snapshot_id, parts=parts)


async def list_application(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot_id: uuid.UUID,
    via_store_id: uuid.UUID | None = None,
    offset: int = 0,
    limit: int = 100,
) -> dict[str, Any]:
    """What an applied list became, a page at a time, in the list's own
    order: each allocation, the lot it became and the movement that brought
    it in. A list not applied became nothing."""
    if not 1 <= limit <= 500 or not 0 <= offset <= MAX_LIST_ALLOCATIONS:
        raise ValidationFailedError("Invalid page")
    snapshot = await _load(session, scope=scope, snapshot_id=snapshot_id)
    await _authorize_reader(session, scope=scope, snapshot=snapshot, via_store_id=via_store_id)
    if snapshot.status is not SnapshotStatus.APPLIED:
        return {"items": [], "has_more": False}
    rows = (
        await session.execute(
            select(InventorySnapshotAllocation, InventorySnapshotRow.line_no)
            .join(
                InventorySnapshotRow,
                InventorySnapshotRow.id == InventorySnapshotAllocation.snapshot_row_id,
            )
            .join(InventorySnapshotPart, InventorySnapshotPart.id == InventorySnapshotRow.part_id)
            .where(
                InventorySnapshotRow.inventory_snapshot_id == snapshot.id,
                InventorySnapshotRow.status == SnapshotRowStatus.RESOLVED,
                InventorySnapshotPart.removed_at.is_(None),
            )
            .order_by(
                InventorySnapshotRow.line_no,
                InventorySnapshotAllocation.product_variant_id,
                InventorySnapshotAllocation.size_id,
            )
            .limit(limit + 1)
            .offset(offset)
            .execution_options(populate_existing=True)
        )
    ).all()
    movements = await opening_balance_movement_ids(
        session, organization_id=scope.organization_id, snapshot_id=snapshot.id
    )
    return {
        "items": [
            {
                "line_no": line_no,
                "allocation_id": allocation.id,
                "product_variant_id": allocation.product_variant_id,
                "size_id": allocation.size_id,
                "quantity": allocation.quantity,
                "stock_lot_id": allocation.stock_lot_id,
                "movement_id": movements.get(allocation.stock_lot_id)
                if allocation.stock_lot_id
                else None,
            }
            for allocation, line_no in rows[:limit]
        ],
        "has_more": len(rows) > limit,
    }


async def list_lines(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot_id: uuid.UUID,
    status: SnapshotRowStatus | None = None,
    part_id: uuid.UUID | None = None,
    via_store_id: uuid.UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """A page of the list, in its own order, with each line's evidence and answer.

    A removed file's lines are left out unless asked for: by `status`
    `REMOVED`, or by `part_id` naming that file.
    """
    if not 1 <= limit <= 200 or not 0 <= offset <= MAX_LIST_ROWS:
        raise ValidationFailedError("Invalid page")
    snapshot = await _load(session, scope=scope, snapshot_id=snapshot_id)
    await _authorize_reader(session, scope=scope, snapshot=snapshot, via_store_id=via_store_id)
    query = select(InventorySnapshotRow).where(
        InventorySnapshotRow.inventory_snapshot_id == snapshot_id
    )
    removed_part = False
    if part_id is not None:
        part = await _load_part(session, scope=scope, snapshot_id=snapshot_id, part_id=part_id)
        removed_part = part.removed_at is not None
        query = query.where(InventorySnapshotRow.part_id == part_id)
    if status is not None:
        query = query.where(InventorySnapshotRow.status == status)
    elif not removed_part:
        query = query.where(InventorySnapshotRow.status != SnapshotRowStatus.REMOVED)
    rows = list(
        (
            await session.scalars(
                query.order_by(InventorySnapshotRow.line_no)
                .limit(limit + 1)
                .offset(offset)
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    return {
        "items": await _row_views(
            session,
            organization_id=scope.organization_id,
            snapshot_id=snapshot_id,
            rows=rows[:limit],
        ),
        "has_more": len(rows) > limit,
    }


async def _readable_places(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    location_ids: Sequence[uuid.UUID],
    capability: LocationCapability | None,
    permission: Permission,
) -> set[uuid.UUID]:
    readable: set[uuid.UUID] = set()
    for location_id in sorted(set(location_ids)):
        try:
            await require_stock_access(
                session,
                scope=scope,
                store_id=store_id,
                location_ids={location_id},
                capability=capability,
                permission=permission,
            )
        except DomainError:
            continue
        readable.add(location_id)
    return readable


async def list_snapshots(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    status: SnapshotStatus | None = None,
    location_id: uuid.UUID | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """The lists a store sees, newest first: its own, and every list waiting
    or decided at a warehouse it may import into (ADR-0014 §7).

    Its own lists follow the reach rule, and a list at a warehouse the person
    may not see — a private one, a revoked one — is left out, not refused.
    Another store's list is seen through this store exactly as a single read
    of it through this store would be: `can_receive` here, and the person's
    permission under the private rule. Each warehouse is authorized once.
    Both are left out *in the query*, so the page and `has_more` say nothing
    about the lists left out. `location_id` answers «what waits here».
    """
    if not 1 <= limit <= 100 or not 0 <= offset <= 10_000:
        raise ValidationFailedError("Invalid page")
    permission = _reader_permission(scope, store_id)
    scope.require(permission, store_id)
    mine = (
        InventorySnapshot.organization_id == scope.organization_id,
        InventorySnapshot.acting_store_id == store_id,
    )
    places = await session.scalars(
        select(InventorySnapshot.location_id)
        .where(*mine, InventorySnapshot.location_id.is_not(None))
        .distinct()
    )
    own = await _readable_places(
        session,
        scope=scope,
        store_id=store_id,
        location_ids=[place for place in places if place is not None],
        capability=None,
        permission=permission,
    )
    shared = await _readable_places(
        session,
        scope=scope,
        store_id=store_id,
        location_ids=await accessible_locations(
            session,
            organization_id=scope.organization_id,
            store_id=store_id,
            capability=LocationCapability.RECEIVE,
        ),
        capability=LocationCapability.RECEIVE,
        permission=permission,
    )
    query = select(InventorySnapshot).where(
        InventorySnapshot.organization_id == scope.organization_id,
        InventorySnapshot.acting_store_id.is_not(None),
        or_(
            and_(*mine, InventorySnapshot.location_id.in_(own)),
            InventorySnapshot.location_id.in_(shared),
        ),
    )
    if status is not None:
        query = query.where(InventorySnapshot.status == status)
    if location_id is not None:
        query = query.where(InventorySnapshot.location_id == location_id)
    snapshots = list(
        (
            await session.scalars(
                query.order_by(InventorySnapshot.created_at.desc(), InventorySnapshot.id)
                .limit(limit + 1)
                .offset(offset)
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    starting = {snapshot.acting_store_id for snapshot in snapshots if snapshot.acting_store_id}
    names = await store_names(session, organization_id=scope.organization_id, store_ids=starting)
    states = {
        store_id: await store_state(
            session, organization_id=scope.organization_id, store_id=store_id
        )
        for store_id in sorted(starting)
    }
    return {
        "items": [
            await _snapshot_view(
                session,
                snapshot,
                store_name=names.get(snapshot.acting_store_id)
                if snapshot.acting_store_id
                else None,
                state=states.get(snapshot.acting_store_id) if snapshot.acting_store_id else None,
            )
            for snapshot in snapshots[:limit]
        ],
        "has_more": len(snapshots) > limit,
    }


__all__ = [
    "MAX_ALLOCATIONS",
    "MAX_LINE_CHARS",
    "MAX_LIST_ALLOCATIONS",
    "MAX_LIST_LINES",
    "MAX_LIST_PARTS",
    "MAX_LIST_ROWS",
    "MAX_PART_LINES",
    "MAX_PART_TEXT_CHARS",
    "MAX_QUANTITY",
    "SEVERAL_OPTIONS",
    "AllocationInput",
    "add_part",
    "approve_snapshot",
    "check_basis",
    "get_snapshot",
    "import_snapshot",
    "list_application",
    "list_lines",
    "list_parts",
    "list_snapshots",
    "mentions_no_count",
    "reject_snapshot",
    "remove_part",
    "request_fingerprint",
    "resolve_row",
    "source_quantity",
]
