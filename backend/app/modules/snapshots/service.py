"""Legacy stock lists: evidence in, a person's answers beside it, stock only on approval.

M1-023, ADR-0005, and `.ai/workflows/legacy-inventory-snapshot-import.md`:

1. **Import.** Every line is kept verbatim as catalog evidence and parsed.
   Nothing is matched, created or counted.
2. **Review.** A person states what each line means — one or more
   `(variant, size, quantity)` allocations, and where the numbers came from —
   or that it is not stock, and why. Nothing is inferred: not a size, not a
   colour split, not a quantity.
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

The caller owns the transaction.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.correlation import get_correlation_id
from app.core.errors import (
    DomainError,
    IdempotencyConflictError,
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
from app.modules.catalog.raw_lines import mark_lines, read_lines, record_lines, repeated_lines
from app.modules.catalog.read import describe_variants, size_labels
from app.modules.catalog.service import ensure_unknown_size
from app.modules.catalog.validation import require_active_variants, validate_stock_references
from app.modules.inventory.service import (
    OpeningBalanceLine,
    apply_opening_balance,
    opening_balance_movement_ids,
)
from app.modules.snapshots.models import (
    InventorySnapshot,
    InventorySnapshotAllocation,
    InventorySnapshotRow,
    SnapshotQuantityBasis,
    SnapshotQuantityState,
    SnapshotRowStatus,
    SnapshotStatus,
)
from app.modules.tenancy.service import LocationCapability, validate_active_stores

MAX_LINES = 1000
# The parser's cost grows faster than a line's length, and every line's parse
# is kept for good. Real lines are a few dozen characters (the store corpus has
# none over 40); these bounds hold the worst import to about a second of
# parsing, off the event loop (M1-023 security review).
MAX_LINE_CHARS = 500
MAX_LIST_CHARS = 100_000
MAX_ALLOCATIONS = 50
# What one list may open a warehouse with, in all. It bounds the approval —
# which holds the warehouse exclusively — and every read of what it became.
MAX_LIST_ALLOCATIONS = 5_000
MAX_QUANTITY = 10_000
MAX_NOTE = 1000
OPEN_ROW_STATUSES = (SnapshotRowStatus.PENDING, SnapshotRowStatus.NEEDS_REVIEW)
# The parser's own signal that a line names several sizes or several colours.
SEVERAL_OPTIONS = frozenset({"CONFLICTING_SIZE", "CONFLICTING_COLOR"})


@dataclass(frozen=True, slots=True)
class AllocationInput:
    """One quantity a person says a line means. Exactly one of `size_id` and
    `size_unknown`: "size not known" is stated, never defaulted to."""

    product_variant_id: uuid.UUID
    quantity: int
    size_id: uuid.UUID | None = None
    size_unknown: bool = False


# ---------------------------------------------------------------------------
# Pure rules
# ---------------------------------------------------------------------------


def source_quantity(parsed: dict[str, Any]) -> tuple[SnapshotQuantityState, int | None]:
    """What the line itself said about quantity, as the parser read it.

    A total counts only when the parser found exactly one quantity, was sure
    of it (`3 шт`), and it is a count stock could be (at most `MAX_QUANTITY`).
    A line naming several sizes or colours leaves the split unknown even when
    the total is stated — a slash enumeration (`Лама бежевая/персик/butter
    3 шт`) and a plain one (`Лоран S M L 3 шт`) alike (invariant I15). A bare
    number is never a quantity: the parser keeps it as a possible item code.
    """
    candidates = parsed.get("fields", {}).get("quantity", [])
    total: int | None = None
    if len(candidates) == 1 and candidates[0].get("confidence") == "EXPLICIT":
        value = int(candidates[0]["value"])
        if value <= MAX_QUANTITY:
            total = value
    if parsed.get("quantity_distribution") == "UNKNOWN_DISTRIBUTION" or SEVERAL_OPTIONS & set(
        parsed.get("review_reasons", [])
    ):
        return SnapshotQuantityState.UNKNOWN_DISTRIBUTION, total
    if total is None:
        return SnapshotQuantityState.UNKNOWN_QUANTITY, None
    return SnapshotQuantityState.KNOWN, total


def mentions_no_count(parsed: dict[str, Any] | None) -> bool:
    """True when nothing in the line could be a count.

    `LINE_IMPLIES_ONE` is for a line like `Бомбер шоколад М`. It never applies
    to a line the parser found any quantity in — two of them (`Куртка 2 шт
    3 шт`), a negated one (`Куртка не 3 шт`) — nor to a line with a number it
    could not classify (`3 куртки`, `Куртка 1636`): that may be a count, a size
    or an item code, and only a person can say which, in a note.
    """
    if parsed is None or parsed.get("fields", {}).get("quantity"):
        return False
    return not any(
        character.isdigit()
        for descriptor in parsed.get("unclassified_descriptors", [])
        for character in descriptor.get("text", "")
    )


def check_basis(
    *,
    state: SnapshotQuantityState,
    stated_total: int | None,
    basis: SnapshotQuantityBasis,
    quantities: Sequence[int],
    note: str | None,
    countless: bool,
) -> None:
    """Refuse an answer whose numbers claim more than their basis supports.

    * `STATED` — only the one count the line states, in one allocation. A
      split is never stated: the parser reads no per-size counts.
    * `LINE_IMPLIES_ONE` — only for a line with no number that could be a
      count (`countless`, see `mentions_no_count`), as exactly one piece.
    * `RECOUNTED` / `OWNER_KNOWLEDGE` — anything, with a note saying who
      counted or how it is known. This is also the only way to answer a line
      whose split is unknown, or to differ from what a line states.
    """
    if basis is SnapshotQuantityBasis.STATED:
        if state is not SnapshotQuantityState.KNOWN or stated_total is None:
            raise ValidationFailedError(
                "This line states no count to take as it is; say how the count is known"
            )
        if len(quantities) != 1:
            raise ValidationFailedError(
                "The line does not state a split across sizes or colours; say how it is known"
            )
        if quantities[0] != stated_total:
            raise ValidationFailedError(
                "A stated answer is the count the line states",
                stated=stated_total,
                allocated=quantities[0],
            )
    elif basis is SnapshotQuantityBasis.LINE_IMPLIES_ONE:
        if state is not SnapshotQuantityState.UNKNOWN_QUANTITY or not countless:
            raise ValidationFailedError(
                "Only a line with no number that could be a count can be taken as one piece; "
                "say how the count is known"
            )
        if list(quantities) != [1]:
            raise ValidationFailedError("A line taken as one piece is one allocation of one")
    elif note is None:
        raise ValidationFailedError("Say in a note who counted, or how the count is known")


def request_fingerprint(request: dict[str, Any]) -> str:
    """sha256 of the canonical import request: the retry proof (ADR-0003)."""
    canonical = json.dumps(request, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _lock_key(organization_id: uuid.UUID, command_id: uuid.UUID) -> int:
    """Scoped exactly like `uq_inventory_snapshot_org_command`, so two
    organizations using one command id never wait on each other."""
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


async def _authorize(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot: InventorySnapshot,
    permission: Permission,
    command: bool,
) -> None:
    """The person, then the store at this warehouse, then the private rule.

    A command that leads to stock needs `can_receive` and an open warehouse and
    store; reading a list needs only reach.
    """
    assert snapshot.acting_store_id is not None and snapshot.location_id is not None
    await require_stock_access(
        session,
        scope=scope,
        store_id=snapshot.acting_store_id,
        location_ids={snapshot.location_id},
        capability=LocationCapability.RECEIVE if command else None,
        permission=permission,
    )
    if command:
        await validate_active_stores(
            session, organization_id=scope.organization_id, store_ids={snapshot.acting_store_id}
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
    }


async def _snapshot_view(session: AsyncSession, snapshot: InventorySnapshot) -> dict[str, Any]:
    summary = await _summary(session, snapshot.id)
    return {
        "snapshot_id": snapshot.id,
        "command_id": snapshot.command_id,
        "store_id": snapshot.acting_store_id,
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
    # Repeats are counted across the whole list, not just this page.
    repeats = await repeated_lines(
        session,
        organization_id=organization_id,
        raw_input_ids=set(
            (
                await session.scalars(
                    select(InventorySnapshotRow.raw_input_id).where(
                        InventorySnapshotRow.inventory_snapshot_id == snapshot_id
                    )
                )
            ).all()
        ),
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
        views.append(
            {
                "line_no": row.line_no,
                "raw_input_id": row.raw_input_id,
                "raw_text": line.raw_text if line else None,
                "same_text_lines": repeats.get(row.raw_input_id, 1),
                "status": row.status,
                "quantity_state": row.quantity_state,
                "quantity_total": row.quantity_total,
                **_parse_summary(line.parsed if line else None),
                "quantity_basis": row.quantity_basis,
                "allocations": by_row.get(row.id, []),
                "resolution_note": row.resolution_note,
                "resolved_by_user_id": row.resolved_by_user_id,
                "resolved_at": row.resolved_at,
            }
        )
    return views


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


async def import_snapshot(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    store_id: uuid.UUID,
    location_id: uuid.UUID,
    lines: Sequence[str],
    source_document_ref: str | None = None,
    captured_at: str | None = None,
) -> tuple[dict[str, Any], bool]:
    """Keep a legacy list as evidence, line by line. Returns `(view, created)`.

    `command_id` is the client's permanent name for this import within its
    organization: repeating the same request returns the list as it is now;
    any other request under the same name is a conflict. Another organization
    using the same name is simply another list. Nothing is matched, created or
    counted: every line waits for a person.
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
    if not 1 <= len(lines) <= MAX_LINES:
        raise ValidationFailedError(f"A stock list has 1 to {MAX_LINES} lines")
    for line_no, text in enumerate(lines, start=1):
        if len(text) > MAX_LINE_CHARS:
            raise ValidationFailedError(
                f"A line holds at most {MAX_LINE_CHARS} characters", line_no=line_no
            )
    if sum(len(text) for text in lines) > MAX_LIST_CHARS:
        raise ValidationFailedError(f"A stock list holds at most {MAX_LIST_CHARS} characters")
    source_document_ref = _clean_text(
        source_document_ref, limit=300, what="The source document", required=False
    )
    captured_at = _clean_text(captured_at, limit=40, what="The list's date", required=False)
    request = {
        "store_id": str(store_id),
        "location_id": str(location_id),
        "source_document_ref": source_document_ref,
        "captured_at": captured_at,
        "lines": list(lines),
    }
    fingerprint = request_fingerprint(request)

    # Serializes two deliveries of the same import; the unique command would
    # otherwise turn the loser into a unique-violation 500.
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

    recorded = await record_lines(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        actor_user_id=scope.user_id,
        source_kind=RawInputSource.SNAPSHOT_IMPORT,
        source_refs=[
            f"inventory_snapshot:{snapshot.id}:{line_no}" for line_no in range(1, len(lines) + 1)
        ],
        lines=lines,
    )
    rows = []
    for line_no, line in enumerate(recorded, start=1):
        state, total = source_quantity(line.parsed)
        rows.append(
            InventorySnapshotRow(
                id=uuid.uuid4(),
                inventory_snapshot_id=snapshot.id,
                line_no=line_no,
                raw_input_id=line.raw_input_id,
                parse_result_id=line.parse_result_id,
                quantity_total=total,
                quantity_state=state,
                status=SnapshotRowStatus.NEEDS_REVIEW
                if line.parsed.get("review_reasons")
                else SnapshotRowStatus.PENDING,
            )
        )
    session.add_all(rows)
    await session.flush()
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
            "lines": len(lines),
            "source_document_ref": source_document_ref,
            "captured_at": captured_at,
        },
    )
    return await _snapshot_view(session, snapshot), True


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
    await require_active_variants(session, organization_id=organization_id, variant_ids=variant_ids)
    return sorted(
        (variant_id, size_id, quantity) for (variant_id, size_id), quantity in stated.items()
    )


def _row_state(
    row: InventorySnapshotRow, allocations: list[tuple[uuid.UUID, uuid.UUID, int]]
) -> dict[str, Any]:
    return {
        "status": row.status.value,
        "quantity_basis": row.quantity_basis.value if row.quantity_basis else None,
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
) -> dict[str, Any]:
    """Say what one line means, replacing whatever was said before.

    Either allocations with the basis of their numbers (`check_basis`) and an
    optional note, or a reason the line is not stock. Repeating the current
    answer changes nothing; any other answer bumps the list's
    `review_revision`, so an approval can never apply a list that changed
    after it was checked.
    """
    observed = await _load(session, scope=scope, snapshot_id=snapshot_id)
    await _authorize(
        session,
        scope=scope,
        snapshot=observed,
        permission=Permission.SNAPSHOT_IMPORT,
        command=True,
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

    if (allocations is None) == (skip_reason is None):
        raise ValidationFailedError("Give the line's allocations, or a reason to skip it")
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
        check_basis(
            state=row.quantity_state,
            stated_total=row.quantity_total,
            basis=basis,
            quantities=[quantity for _, _, quantity in desired],
            note=new_note,
            countless=mentions_no_count(evidence.parsed if evidence else None),
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
            raise ValidationFailedError(
                f"A stock list takes at most {MAX_LIST_ALLOCATIONS} allocations in all",
                allocations_elsewhere=elsewhere,
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
    unchanged = (
        row.status is new_status
        and row.quantity_basis is basis
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
            after={**_row_state(row, desired), "review_revision": snapshot.review_revision},
            reason=new_note,
        )
    view = await _row_views(
        session, organization_id=scope.organization_id, snapshot_id=snapshot_id, rows=[row]
    )
    return {"snapshot": await _snapshot_view(session, snapshot), "line": view[0]}


# ---------------------------------------------------------------------------
# Decision
# ---------------------------------------------------------------------------


async def _application(
    session: AsyncSession, *, organization_id: uuid.UUID, snapshot: InventorySnapshot
) -> dict[str, Any]:
    """What an applied list became, read back from the ledger — the same way
    for the approval that wrote it and for every replay of it."""
    rows = (
        await session.execute(
            select(InventorySnapshotAllocation, InventorySnapshotRow.line_no)
            .join(
                InventorySnapshotRow,
                InventorySnapshotRow.id == InventorySnapshotAllocation.snapshot_row_id,
            )
            .where(
                InventorySnapshotRow.inventory_snapshot_id == snapshot.id,
                InventorySnapshotRow.status == SnapshotRowStatus.RESOLVED,
            )
            .order_by(
                InventorySnapshotRow.line_no,
                InventorySnapshotAllocation.product_variant_id,
                InventorySnapshotAllocation.size_id,
            )
            .execution_options(populate_existing=True)
        )
    ).all()
    movements = await opening_balance_movement_ids(
        session, organization_id=organization_id, snapshot_id=snapshot.id
    )
    lines = [
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
        for allocation, line_no in rows
    ]
    return {"lines": lines, "units": sum(line["quantity"] for line in lines)}


async def approve_snapshot(
    session: AsyncSession, *, scope: RequestScope, snapshot_id: uuid.UUID, expected_revision: int
) -> dict[str, Any]:
    """Turn the whole list into opening stock, or refuse and change nothing.

    `expected_revision` is the review revision the approver looked at. The
    same approval repeated returns what it did; an approval of any other
    revision is refused. Invariant I17 holds by construction: the only thing
    this can write is `OPENING_BALANCE` (`inventory.apply_opening_balance`),
    and the database refuses an opening balance that names no list.
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
            "application": await _application(
                session, organization_id=scope.organization_id, snapshot=snapshot
            ),
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
                .where(
                    InventorySnapshotRow.inventory_snapshot_id == snapshot_id,
                    InventorySnapshotRow.status.in_(OPEN_ROW_STATUSES),
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
    allocations = list(
        (
            await session.scalars(
                select(InventorySnapshotAllocation)
                .join(
                    InventorySnapshotRow,
                    InventorySnapshotRow.id == InventorySnapshotAllocation.snapshot_row_id,
                )
                .where(
                    InventorySnapshotRow.inventory_snapshot_id == snapshot_id,
                    InventorySnapshotRow.status == SnapshotRowStatus.RESOLVED,
                )
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
    # it is. A variant merged or retired in between needs its line re-resolved.
    await require_active_variants(
        session,
        organization_id=scope.organization_id,
        variant_ids={allocation.product_variant_id for allocation in allocations},
    )
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
            "allocations": len(allocations),
            "units": sum(allocation.quantity for allocation in allocations),
            "lines_by_basis": view["summary"]["lines_by_basis"],
            "units_by_basis": view["summary"]["units_by_basis"],
        },
    )
    return {
        **view,
        "application": await _application(
            session, organization_id=scope.organization_id, snapshot=snapshot
        ),
    }


async def reject_snapshot(
    session: AsyncSession, *, scope: RequestScope, snapshot_id: uuid.UUID, reason: str
) -> dict[str, Any]:
    """Close a list without turning any of it into stock. The evidence stays.

    Needs only reach, not `can_receive` or an open warehouse: a list for a
    paused warehouse can still be abandoned.
    """
    clean = _clean_text(reason, limit=MAX_NOTE, what="The reason", required=True)
    observed = await _load(session, scope=scope, snapshot_id=snapshot_id)
    assert observed.acting_store_id is not None
    await _authorize(
        session,
        scope=scope,
        snapshot=observed,
        permission=_reader_permission(scope, observed.acting_store_id),
        command=False,
    )
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={observed.acting_store_id}
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
        },
        reason=clean,
    )
    return await _snapshot_view(session, snapshot)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def get_snapshot(
    session: AsyncSession, *, scope: RequestScope, snapshot_id: uuid.UUID
) -> dict[str, Any]:
    snapshot = await _load(session, scope=scope, snapshot_id=snapshot_id)
    assert snapshot.acting_store_id is not None
    await _authorize(
        session,
        scope=scope,
        snapshot=snapshot,
        permission=_reader_permission(scope, snapshot.acting_store_id),
        command=False,
    )
    view = await _snapshot_view(session, snapshot)
    if snapshot.status is SnapshotStatus.APPLIED:
        view["application"] = await _application(
            session, organization_id=scope.organization_id, snapshot=snapshot
        )
    return view


async def list_lines(
    session: AsyncSession,
    *,
    scope: RequestScope,
    snapshot_id: uuid.UUID,
    status: SnapshotRowStatus | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """A page of the list, in its own order, with each line's evidence and answer."""
    if not 1 <= limit <= 200 or not 0 <= offset <= MAX_LINES:
        raise ValidationFailedError("Invalid page")
    snapshot = await _load(session, scope=scope, snapshot_id=snapshot_id)
    assert snapshot.acting_store_id is not None
    await _authorize(
        session,
        scope=scope,
        snapshot=snapshot,
        permission=_reader_permission(scope, snapshot.acting_store_id),
        command=False,
    )
    query = select(InventorySnapshotRow).where(
        InventorySnapshotRow.inventory_snapshot_id == snapshot_id
    )
    if status is not None:
        query = query.where(InventorySnapshotRow.status == status)
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


async def list_snapshots(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    status: SnapshotStatus | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """This store's lists, newest first; a list at a warehouse the person may
    not see — a private one, a revoked one — is left out, not refused.

    Left out *in the query*, so the page and `has_more` say nothing about the
    lists left out. Each warehouse is authorized exactly as a single read of
    one of its lists would be (`_authorize`), once per warehouse.
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
    readable: set[uuid.UUID] = set()
    for location_id in sorted(place for place in places if place is not None):
        try:
            await require_stock_access(
                session,
                scope=scope,
                store_id=store_id,
                location_ids={location_id},
                capability=None,
                permission=permission,
            )
        except DomainError:
            continue
        readable.add(location_id)
    query = select(InventorySnapshot).where(*mine, InventorySnapshot.location_id.in_(readable))
    if status is not None:
        query = query.where(InventorySnapshot.status == status)
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
    return {
        "items": [await _snapshot_view(session, snapshot) for snapshot in snapshots[:limit]],
        "has_more": len(snapshots) > limit,
    }


__all__ = [
    "MAX_ALLOCATIONS",
    "MAX_LINES",
    "MAX_LINE_CHARS",
    "MAX_LIST_ALLOCATIONS",
    "MAX_LIST_CHARS",
    "AllocationInput",
    "approve_snapshot",
    "check_basis",
    "get_snapshot",
    "import_snapshot",
    "list_lines",
    "list_snapshots",
    "mentions_no_count",
    "reject_snapshot",
    "request_fingerprint",
    "resolve_row",
    "source_quantity",
]
