"""The pure rules of a legacy stock list: what a line says, and what an answer may claim.

Moved here from `service.py` unchanged (ADR-0014), so the rules of a line
from a file (`file_lines.py`) and the service can share them without
importing each other. Nothing here reads the database.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Sequence
from typing import Any

from app.core.errors import ValidationFailedError
from app.modules.snapshots.models import SnapshotQuantityBasis, SnapshotQuantityState

# A count stock could be. Kept in `stock_file`, which must import nothing of
# the database, so a file's `count` and a line's answer share one bound.
from app.modules.snapshots.stock_file import MAX_QUANTITY

# The parser's own signal that a line names several sizes or several colours.
SEVERAL_OPTIONS = frozenset({"CONFLICTING_SIZE", "CONFLICTING_COLOR"})


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
    answer: Sequence[tuple[uuid.UUID, uuid.UUID, int]] = (),
    shown: Sequence[tuple[uuid.UUID, int]] | None = None,
) -> None:
    """Refuse an answer whose numbers claim more than their basis supports.

    * `STATED` — only the one count the line states, in one allocation. A
      split is never stated: the parser reads no per-size counts.
    * `STATED_BY_SIZE` — only the split a line from a file shows in its own
      text, each size beside its count (`shown`: the catalogue's size and the
      count, ADR-0014 §5): one model, one allocation per size, each with its
      count, and nothing else. The one exception to the rule above (owner,
      2026-10-08).
    * `LINE_IMPLIES_ONE` — only for a line with no number that could be a
      count (`countless`, see `mentions_no_count`), as exactly one piece.
    * `RECOUNTED` / `OWNER_KNOWLEDGE` — anything, with a note saying who
      counted or how it is known. This is also the only way to answer a line
      whose split is unknown, or to differ from what a line states.

    `answer` is the answer as `(variant, size, quantity)`; only
    `STATED_BY_SIZE` reads it.
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
    elif basis is SnapshotQuantityBasis.STATED_BY_SIZE:
        if not shown or len({size_id for size_id, _ in shown}) != len(shown):
            raise ValidationFailedError("This line does not show its split; say how it is known")
        if (
            len(answer) != len(shown)
            or len({variant_id for variant_id, _, _ in answer}) != 1
            or {(size_id, quantity) for _, size_id, quantity in answer} != set(shown)
        ):
            raise ValidationFailedError(
                "A split as the line shows it names each of its sizes with its count, for one model"
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


def lines_import_request(
    *,
    store_id: uuid.UUID,
    location_id: uuid.UUID,
    source_document_ref: str | None,
    captured_at: str | None,
    lines: Sequence[str],
) -> dict[str, Any]:
    """What an import of pasted lines is fingerprinted by.

    Exactly the request M1-023 fingerprinted, key for key: a retry sent
    before ADR-0014 was deployed still replays after it (ADR-0014 §8).
    """
    return {
        "store_id": str(store_id),
        "location_id": str(location_id),
        "source_document_ref": source_document_ref,
        "captured_at": captured_at,
        "lines": list(lines),
    }


__all__ = [
    "MAX_QUANTITY",
    "SEVERAL_OPTIONS",
    "check_basis",
    "lines_import_request",
    "mentions_no_count",
    "request_fingerprint",
    "source_quantity",
]
