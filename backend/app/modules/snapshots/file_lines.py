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
  The text shows the split and nothing beside it: no other size, no other
  size with a count, no other number but the price, a count with «шт» or a
  length (`shown_split`).
- **A record that may also be a range of sizes is asked about.** «42-44»
  may be size 42 with 44 pieces, or the sizes 42 to 44. When its numbers or
  the catalogue make it either, the person says which before the tap is
  offered (owner, 2026-10-09; `may_be_range`).

Pure: no database.
"""

from __future__ import annotations

import re
from collections.abc import Collection, Iterator, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from functools import lru_cache
from itertools import pairwise
from typing import Any

from app.modules.catalog.parser import parse_catalog_line
from app.modules.catalog.sizes import letter_rank, spell_size
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
# The signs after a count that make it part of something else
# (`_ends_cleanly`): a comma or a point before a numeral is a fraction, and
# the others, spaced or not, a sum or a product.
_FRACTION_SIGNS = ".,"
_ARITHMETIC_SIGNS = "+/×*xх·⋅"
# Any word joined by one sign to a run of digits, wherever it starts, so
# that records sharing a sign are each found: «M-3-2» holds «M-3» and «3-2».
_RECORD = re.compile(r"(?=(?<![^\W_])([^\W_]+)" + _GAP + r"(\d+))")
# A word of the text: a run of letters and digits («Лоран», «XXXL», «3шт»).
_WORD = re.compile(r"[^\W_]+")
# Birka's parser reads a lowercase Cyrillic «с» as the preposition, never as
# the size S («куртка с капюшоном»; `parser._SIZES`).
_PREPOSITION = "с"
# The parser's own signal that a line names slash options: contextual
# (constitution §21), so no split is shown beside one.
_SLASH = "SLASH_OPTIONS_REQUIRE_REVIEW"


class SplitReading(StrEnum):
    """What a person said a record of a shown split means, when it may also
    be a range of sizes (owner, 2026-10-09). Only `SIZE_WITH_COUNT` lets the
    split be stated by size: «розмір 42 — 44 шт». A range is answered with
    another basis and a note, as any line is."""

    SIZE_WITH_COUNT = "SIZE_WITH_COUNT"


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


def _numerals(text: str) -> Iterator[tuple[int, int]]:
    """Where each run of numerals stands in the text, of any script: «3»,
    «１８５０», and those no pattern's digit matches, «½», «²», «①», «Ⅲ»
    (`str.isnumeric`; review, 2026-10-09)."""
    start: int | None = None
    for index, character in enumerate(text):
        if character.isnumeric():
            if start is None:
                start = index
        elif start is not None:
            yield start, index
            start = None
    if start is not None:
        yield start, len(text)


def _ends_cleanly(text: str, end: int) -> bool:
    """Whether a count that ends here ends with its number (review,
    2026-10-09). A numeral of any script right after it continues it
    («M-3½», «M-3²»); a comma or a point with a numeral right after it makes
    a fraction («M-3,5», «M-3.5»); and `+ / × * x х · ⋅` with a numeral
    after it, spaces about the sign or not, a sum or a product («M-3+2»,
    «M-3 + 2», «M-3х2»). «S-1, M-2» and «L-1, 1850» list on."""
    if text[end : end + 1].isnumeric():
        return False
    after = text[end:].lstrip(" \t")
    sign, rest = after[:1], after[1:]
    if sign == "":
        return True
    if sign in _FRACTION_SIGNS:
        return not rest[:1].isnumeric()
    if sign in _ARITHMETIC_SIGNS:
        return not rest.lstrip(" \t")[:1].isnumeric()
    return True


def _places(text: str, size: str) -> list[re.Match[str]]:
    """Every place the text writes this size as a whole word, joined by one
    sign to a count, all its digits, that ends cleanly (`_ends_cleanly`):
    «M-3», «42 – 44». The digits are group 1."""
    pattern = re.compile(r"(?<![^\W_])" + re.escape(size) + _GAP + r"(\d+)", re.IGNORECASE)
    return [found for found in pattern.finditer(text) if _ends_cleanly(text, found.end())]


@lru_cache(maxsize=4096)
def _spelled(word: str) -> str | None:
    """A word of the text as the catalogue spells a size (`spell_size`,
    ADR-0009): «ХL» with a Cyrillic Х is `XL`, «2xl» is `XXL`. None for the
    parser's preposition «с». Kept: a list repeats its words."""
    return None if word == _PREPOSITION else spell_size(word)


def _words(text: str, size: str) -> int:
    """How many times the text writes this size as a whole word, with a count
    or without, in any of its spellings: «M-3 M 2» writes M twice, and so
    does «M-3 М» with a Cyrillic М (ADR-0009: one size)."""
    pattern = re.compile(r"(?<![^\W_])" + re.escape(size) + r"(?![^\W_])", re.IGNORECASE)
    spelling = spell_size(size).casefold()
    return len(
        {found.span() for found in pattern.finditer(text)}
        | {
            word.span()
            for word in _WORD.finditer(text)
            if (_spelled(word.group()) or "").casefold() == spelling
        }
    )


def _letter_size_beside(text: str, places: Sequence[tuple[int, int]]) -> bool:
    """Whether a word outside the split's places is a letter size by Birka's
    own spelling (`letter_rank`), read by the parser or not: «XXXL», «XXS»,
    «ХL» with a Cyrillic Х, «4XL», a Cyrillic «М» (review, 2026-10-09). The
    parser reads only XS to XXL, so «Лоран S-1 M-2 XXXL» names a third size
    it does not see."""
    return any(
        letter_rank(spelled) is not None
        for word in _WORD.finditer(text)
        if not any(start <= word.start() and word.end() <= end for start, end in places)
        and (spelled := _spelled(word.group())) is not None
    )


def _read_as_size(word: str) -> bool:
    """Whether Birka's parser, reading this word alone, reads a size in it:
    «L», «м», «XS»; never a number."""
    return bool(parse_catalog_line(word).fields.get("size"))


def _records(text: str) -> set[tuple[int, int]]:
    """Where the text holds a size with a count: a word Birka reads as a
    size, or a run of digits, joined by one sign to a run of digits, wherever
    the text holds one: «L-4», «46-2», «3-2» in «M-3-2»."""
    return {
        (found.start(1), found.end(2))
        for found in _RECORD.finditer(text)
        if found.group(1).isdecimal() or _read_as_size(found.group(1))
    }


def _spans(parsed: dict[str, Any], field: str) -> list[tuple[int, int]]:
    """Where Birka's own parse read this field in the text."""
    return [
        (int(evidence["start"]), int(evidence["end"]))
        for candidate in parsed.get("fields", {}).get(field, [])
        for evidence in candidate.get("evidence", [])
    ]


def _numbers_explained(
    text: str,
    price: str | None,
    places: Sequence[tuple[int, int]],
    parsed: dict[str, Any],
) -> bool:
    """Whether every run of numerals in the text (`_numerals`, «½» and «①»
    too) is one the line accounts for: in a size with its count of the
    split, in a count with its unit or a length Birka read («3 шт»,
    «110 см»), or the file's price, as its digits are written («1850»),
    once. Any other number may be another count («разом 5»), or another
    size whose count is lost («46-2 48»).

    The price is the parser's reading: a number the file calls the price is
    excused on its word, so «46-2 48» with a price "48" shows its split
    (ADR-0014 §5, a reading awaiting the owner)."""
    read = [*places, *_spans(parsed, "quantity"), *_spans(parsed, "length_cm")]
    loose = [
        text[first:last]
        for first, last in _numerals(text)
        if not any(start <= first and last <= end for start, end in read)
    ]
    written = price or ""
    price_digits = "".join(written[first:last] for first, last in _numerals(written))
    if price_digits in loose:
        # One number is the price; the same number again is something else.
        loose.remove(price_digits)
    return not loose


def shown_split(
    line: StockFileLineV1, parsed: dict[str, Any]
) -> tuple[tuple[str, int], ...] | None:
    """The split the line's text shows, each size beside its count, or None.

    ADR-0014 §5, every condition, read from the text and never from the
    parser's word alone:

    1. the file gives counts per size, for sizes distinct as spelled
       (`spell_size`, ADR-0009: `M` and `м` are one size);
    2. each size stands in the text exactly once as a whole word, in any of
       its spellings, followed by one sign and its count, which ends
       cleanly: `462` is never «46, 2», `M 3` is never «M, 3», and «M-3+2»,
       «M-3 + 2», «M-3,5», «M-3/2», «M-3х2» or «M-3½» never «M, 3»;
    3. no two of those places overlap;
    4. the totals agree: the file's `count`, if any, and Birka's own count
       with its unit, if any, which is then the only one and sure;
    5. one colour at most, in the file and in Birka's reading, and no slash;
    6. nothing beside it (review, 2026-10-09): Birka reads no other size in
       the text («Лоран S M-3»), nor is another word a letter size by its
       spelling («Лоран S-1 M-2 XXXL», «Лоран M-3 М»; `_letter_size_beside`);
       the text holds no other size with a count («Лоран S-1 M-2 L-4», the
       file naming S and M); and every other number in it, of any script,
       is the file's price, a count with its unit or a length Birka read
       (`_numbers_explained`: not «S-1 M-2 L-1 разом 5», «46-2 48» or
       «M-3½»).
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

    places: list[tuple[int, int]] = []
    for pair in pairs:
        found = _places(line.text, pair.size)
        if (
            len(found) != 1
            or int(found[0].group(1)) != pair.count
            or _words(line.text, pair.size) != 1
        ):
            return None
        places.append(found[0].span())
    places.sort()
    if any(earlier[1] > later[0] for earlier, later in pairwise(places)):
        return None
    read = {
        spell_size(str(candidate["value"])).casefold()
        for candidate in parsed.get("fields", {}).get("size", [])
    }
    if read - spellings:
        return None
    if _letter_size_beside(line.text, places):
        return None
    if not _records(line.text) <= set(places):
        return None
    if not _numbers_explained(line.text, line.price, places, parsed):
        return None
    return tuple((pair.size, pair.count) for pair in pairs)


@dataclass(frozen=True, slots=True)
class SplitRecord:
    """One size of a shown split, and how the line's text writes it:
    `written` is the record («42-44», «M - 3») and `count_written` its count's
    digits («44»), exactly as in the text. None when the text no longer shows
    the record, which a row kept under today's rule cannot do: its text and
    its split are both fixed evidence."""

    size: str
    count: int
    written: str | None
    count_written: str | None

    def spellings(self) -> tuple[str, ...]:
        """What the catalogue is asked about: the size, the count, the record."""
        return tuple(
            value for value in (self.size, self.count_written, self.written) if value is not None
        )


def split_records(text: str, split: Sequence[Mapping[str, Any]]) -> list[SplitRecord]:
    """Each pair of a kept split (`{size, count}`, in the file's order) with
    its record in the line's text, found as `shown_split` found it."""
    records = []
    for pair in split:
        size, count = str(pair["size"]), int(pair["count"])
        found = [place for place in _places(text, size) if int(place.group(1)) == count]
        place = found[0] if len(found) == 1 else None
        records.append(
            SplitRecord(
                size=size,
                count=count,
                written=place.group(0) if place else None,
                count_written=place.group(1) if place else None,
            )
        )
    return records


def _counts_up(size: str, count: str) -> bool:
    """Whether a number size's count, as written, reads as a larger size
    after it: «42-44», «42-58», «98-104»; never «46-2» or «48-12»."""
    return (
        size.isdecimal()
        and count.isdecimal()
        and len(count) >= len(size)
        and int(count) > int(size)
    )


def may_be_range(record: SplitRecord, sizes: Collection[str]) -> bool:
    """Whether a record of a size with its count may also be read as a range
    of sizes (owner, 2026-10-09: "when a size with its count may also be read
    as a range of sizes, the app asks"). Any one of:

    - its size and its count are both numbers, and the count, as written,
      reads as a larger size after it («42-44», «98-104»), whatever the
      catalogue holds;
    - its count, as written, is itself one of the organization's sizes
      («M-3», with a size 3);
    - the whole record is («42 – 44», a size «42-44» of its own).

    `sizes` holds every spelling the catalogue has a size of, as
    `catalog.read.sizes_by_spelling` answers: one spelling, ADR-0009, so
    case and the kind of dash do not matter. A record the text no longer
    shows is asked about too: it cannot be told apart."""
    if record.written is None or record.count_written is None:
        return True
    if _counts_up(record.size, record.count_written):
        return True
    return record.count_written in sizes or record.written in sizes


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
    "SplitReading",
    "SplitRecord",
    "countless",
    "file_line_evidence",
    "may_be_range",
    "shown_split",
    "split_records",
]
