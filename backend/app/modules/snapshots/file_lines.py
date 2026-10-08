"""What a line from a parser's file says about its count (ADR-0014 §4, §5).

The row's `quantity_state` and `quantity_total` still summarise what the
*text* says, by Birka's own parse (`rules.source_quantity`). The parser's
reading beside it only adds doubt, as reasons a person reads, and never
makes a line `KNOWN`:

- **The parser's count is a hint unless the text states it** with its unit
  («3 шт»). A number without «шт» is not a count by itself, even when the
  parser says it is («Бомбер M 3 1200»; owner, 2026-10-08).
- **A split the text shows is confirmed by a tap.** Each size and its count
  joined by a sign («S-1 M-2 L-1», one size too: «Лоран M-3»); a space
  alone is a bare number («M 3»; owner, 2026-10-08). Birka checks it in the
  text, never on the parser's word alone, and keeps it as `shown_split`.

Pure: no database.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

from app.modules.catalog.sizes import spell_size
from app.modules.snapshots.models import SnapshotQuantityState
from app.modules.snapshots.rules import SEVERAL_OPTIONS, mentions_no_count, source_quantity
from app.modules.snapshots.stock_file import StockFileLineV1

# The parser counted, and the text states no count with its unit.
FILE_COUNT_HINT = "FILE_COUNT_HINT"
# The parser counted, and the text states another count, or several, or one
# it is unsure of.
FILE_COUNT_DIFFERS = "FILE_COUNT_DIFFERS"
# The parser read counts per size, and the text does not show them so.
FILE_SPLIT_NOT_IN_TEXT = "FILE_SPLIT_NOT_IN_TEXT"
# The parser left a word for the person who reviews («закреслено»).
FILE_NOTE = "FILE_NOTE"
FILE_REASONS = (FILE_COUNT_HINT, FILE_COUNT_DIFFERS, FILE_SPLIT_NOT_IN_TEXT, FILE_NOTE)

# The signs that join a size to its count: the hyphen, the dashes, the minus,
# the colon and the equals sign. Spaces alone join nothing.
SPLIT_SEPARATORS = "-\u2010\u2011\u2012\u2013\u2014\u2015\u2212:="
_GAP = "[ \t]*[" + re.escape(SPLIT_SEPARATORS) + "][ \t]*"
# The parser's own signal that a line names slash options: contextual
# (constitution §21), so no split is shown beside one.
_SLASH = "SLASH_OPTIONS_REQUIRE_REVIEW"


@dataclass(frozen=True, slots=True)
class FileLineEvidence:
    """What a file line's row keeps: its count's summary, the split its text
    shows (`(size as written, count)`, in the file's order), and why the
    line needs a person's eye."""

    state: SnapshotQuantityState
    total: int | None
    shown_split: tuple[tuple[str, int], ...] | None
    reasons: tuple[str, ...]


def _quantities(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = parsed.get("fields", {}).get("quantity", [])
    return candidates


def shown_split(
    line: StockFileLineV1, parsed: dict[str, Any]
) -> tuple[tuple[str, int], ...] | None:
    """The split the line's text shows, each size beside its count, or None.

    ADR-0014 §5, every condition, read from the text and never from the
    parser's word alone:

    1. the file gives counts per size, for sizes distinct as spelled
       (`spell_size`, ADR-0009: `M` and `м` are one size);
    2. each size stands in the text exactly once as a whole word, followed
       by one sign and its count: `462` is never «46, 2», and `M 3` is never
       «M, 3»;
    3. no two of those places overlap;
    4. the totals agree: the file's `count`, if any, and Birka's own count
       with its unit, if any, which is then the only one and sure;
    5. one colour at most, in the file and in Birka's reading, and no slash.
    """
    pairs = line.size_counts or []
    if not pairs:
        return None
    spellings = {spell_size(pair.size).casefold() for pair in pairs}
    if len(spellings) != len(pairs):
        return None
    if len(line.colours or []) > 1:
        return None
    reasons = set(parsed.get("review_reasons", []))
    if "CONFLICTING_COLOR" in reasons or _SLASH in reasons or parsed.get("option_groups"):
        return None
    total = sum(pair.count for pair in pairs)
    if line.count is not None and line.count != total:
        return None
    candidates = _quantities(parsed)
    if candidates and (
        len(candidates) != 1
        or candidates[0].get("confidence") != "EXPLICIT"
        or int(candidates[0]["value"]) != total
    ):
        return None

    text = line.text
    places: list[tuple[int, int]] = []
    for pair in pairs:
        pattern = re.compile(
            r"(?<![^\W_])" + re.escape(pair.size) + _GAP + r"(\d+)(?!\d)", re.IGNORECASE
        )
        found = list(pattern.finditer(text))
        if len(found) != 1 or int(found[0].group(1)) != pair.count:
            return None
        places.append(found[0].span())
    places.sort()
    if any(earlier[1] > later[0] for earlier, later in pairwise(places)):
        return None
    return tuple((pair.size, pair.count) for pair in pairs)


def file_line_evidence(parsed: dict[str, Any], line: StockFileLineV1) -> FileLineEvidence:
    """The row of a line from a file (ADR-0014 §4).

    | Birka's parse of `text`         | the file's `count` | the row                    |
    |---------------------------------|--------------------|----------------------------|
    | any                             | absent             | as today                   |
    | a count with its unit, equal    | equal              | as today                   |
    | any count candidate, not equal  | given              | no count, FILE_COUNT_DIFFERS |
    | no count                        | given              | no count, FILE_COUNT_HINT  |

    Then a line naming several sizes or colours, in the file or by Birka's
    reading, leaves its split unknown, keeping its total if any. A split the
    text shows (`shown_split`) answers both: with two sizes or more it is
    `UNKNOWN_DISTRIBUTION` with the sum as its total, and with one it stays
    as Birka read it, so `STATED` is never offered on the file's word.
    """
    state, total = source_quantity(parsed)
    reasons: list[str] = []
    shown = shown_split(line, parsed)
    if shown is not None:
        if len(shown) > 1:
            state, total = SnapshotQuantityState.UNKNOWN_DISTRIBUTION, sum(c for _, c in shown)
    else:
        if line.size_counts:
            reasons.append(FILE_SPLIT_NOT_IN_TEXT)
        if line.count is not None:
            if not _quantities(parsed):
                state, total = SnapshotQuantityState.UNKNOWN_QUANTITY, None
                reasons.append(FILE_COUNT_HINT)
            elif total != line.count:
                state, total = SnapshotQuantityState.UNKNOWN_QUANTITY, None
                reasons.append(FILE_COUNT_DIFFERS)
        several = (
            len(line.colours or []) > 1
            or len(line.sizes or []) > 1
            or len(line.size_counts or []) > 1
            or parsed.get("quantity_distribution") == "UNKNOWN_DISTRIBUTION"
            or bool(SEVERAL_OPTIONS & set(parsed.get("review_reasons", [])))
        )
        if several:
            state = SnapshotQuantityState.UNKNOWN_DISTRIBUTION
    if line.note is not None:
        reasons.append(FILE_NOTE)
    return FileLineEvidence(state=state, total=total, shown_split=shown, reasons=tuple(reasons))


def countless(parsed: dict[str, Any] | None, reading: dict[str, Any] | None) -> bool:
    """Whether `LINE_IMPLIES_ONE` may answer the line: nothing in its text
    could be a count (`rules.mentions_no_count`), and the parser gave it no
    count either. «Рядок без кількості — одна штука» is never offered for a
    line the file counted (ADR-0014 §4)."""
    if reading is not None and (
        reading.get("count") is not None or reading.get("size_counts") is not None
    ):
        return False
    return mentions_no_count(parsed)


__all__ = [
    "FILE_COUNT_DIFFERS",
    "FILE_COUNT_HINT",
    "FILE_NOTE",
    "FILE_REASONS",
    "FILE_SPLIT_NOT_IN_TEXT",
    "SPLIT_SEPARATORS",
    "FileLineEvidence",
    "countless",
    "file_line_evidence",
    "shown_split",
]
