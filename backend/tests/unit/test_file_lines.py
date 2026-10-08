"""What a line from a parser's file says about its count (ADR-0014 §4, §5).

Birka's own parse of the line's text decides its count, as for a typed line.
The parser's reading only adds doubt, and never makes a line `KNOWN`:

- the parser's count is a hint unless the text states it with «шт» (owner,
  2026-10-08: «Бомбер M 3 1200» is a bare number, answered with a note);
- a split the text shows, each size joined to its count by a sign, one
  size or several («S-1 M-2 L-1», «Лоран M-3»), is kept for a tap; a space
  alone joins nothing («M 3»; owner, 2026-10-08).

Every case runs through the real parser, so what is pinned is what a line
will get.
"""

from __future__ import annotations

import itertools
from typing import Any

import pytest

from app.modules.catalog.parser import parse_catalog_line
from app.modules.snapshots.file_lines import (
    FILE_COUNT_DIFFERS,
    FILE_COUNT_HINT,
    FILE_NOTE,
    FILE_SPLIT_NOT_IN_TEXT,
    SPLIT_SEPARATORS,
    FileLineEvidence,
    countless,
    file_line_evidence,
    shown_split,
)
from app.modules.snapshots.models import SnapshotQuantityState
from app.modules.snapshots.stock_file import StockFileLineV1

KNOWN = SnapshotQuantityState.KNOWN
UNKNOWN_DISTRIBUTION = SnapshotQuantityState.UNKNOWN_DISTRIBUTION
UNKNOWN_QUANTITY = SnapshotQuantityState.UNKNOWN_QUANTITY


def line(text: str, **reading: Any) -> StockFileLineV1:
    return StockFileLineV1.model_validate(
        {"text": text, "photo": "IMG_0001.jpg", "photo_line": 1, **reading}
    )


def counts(*pairs: tuple[str, int]) -> list[dict[str, Any]]:
    return [{"size": size, "count": count} for size, count in pairs]


def evidence(text: str, **reading: Any) -> FileLineEvidence:
    return file_line_evidence(parse_catalog_line(text).to_dict(), line(text, **reading))


def split(text: str, **reading: Any) -> tuple[tuple[str, int], ...] | None:
    return shown_split(line(text, **reading), parse_catalog_line(text).to_dict())


@pytest.mark.parametrize(
    ("text", "count", "state", "total", "reasons"),
    [
        # The file gives no count: the line is as it would be typed.
        ("Бомбер шоколад 3 шт", None, KNOWN, 3, ()),
        ("Бомбер шоколад", None, UNKNOWN_QUANTITY, None, ()),
        ("Куртка 1636", None, UNKNOWN_QUANTITY, None, ()),
        # A count with its unit, equal to the file's: as typed.
        ("Бомбер шоколад 3 шт", 3, KNOWN, 3, ()),
        # Any count candidate, unequal or unsure: no count, and why.
        ("Бомбер шоколад 3 шт", 5, UNKNOWN_QUANTITY, None, (FILE_COUNT_DIFFERS,)),
        ("Куртка 2 шт 3 шт", 2, UNKNOWN_QUANTITY, None, (FILE_COUNT_DIFFERS,)),
        ("Куртка не 3 шт", 3, UNKNOWN_QUANTITY, None, (FILE_COUNT_DIFFERS,)),
        ("Куртка 10001 шт", 10_000, UNKNOWN_QUANTITY, None, (FILE_COUNT_DIFFERS,)),
        # No count in the text: the file's is a hint (owner, 2026-10-08).
        ("Бомбер шоколад", 3, UNKNOWN_QUANTITY, None, (FILE_COUNT_HINT,)),
        ("Куртка 1636", 1, UNKNOWN_QUANTITY, None, (FILE_COUNT_HINT,)),
    ],
)
def test_what_a_file_line_says_about_its_count(
    text: str,
    count: int | None,
    state: SnapshotQuantityState,
    total: int | None,
    reasons: tuple[str, ...],
) -> None:
    assert evidence(text, count=count) == FileLineEvidence(state, total, None, reasons)


def test_a_number_without_a_unit_is_only_a_hint() -> None:
    """«Бомбер M 3 1200», the parser reading 3 as the count: a number without
    «шт» is not a count by itself, even when the parser says it is."""
    assert evidence("Бомбер M 3 1200", sizes=["M"], count=3, price="1200") == FileLineEvidence(
        UNKNOWN_QUANTITY, None, None, (FILE_COUNT_HINT,)
    )
    # Read as a split of one size, a space still joins nothing.
    assert evidence("Бомбер M 3 1200", size_counts=counts(("M", 3))) == FileLineEvidence(
        UNKNOWN_QUANTITY, None, None, (FILE_SPLIT_NOT_IN_TEXT,)
    )


def test_a_count_stated_with_its_unit_and_agreed_is_kept() -> None:
    assert evidence("Мышка чорний M 2 шт", sizes=["M"], count=2) == FileLineEvidence(
        KNOWN, 2, None, ()
    )
    # Several sizes: the total is stated, the split is not (the `Лоран S M L
    # 3 шт` rule).
    assert evidence("Лоран S M L 3 шт", sizes=["S", "M", "L"], count=3) == FileLineEvidence(
        UNKNOWN_DISTRIBUTION, 3, None, ()
    )


def test_a_count_read_differently_is_unknown() -> None:
    assert evidence("Лоран 3 шт", count=5) == FileLineEvidence(
        UNKNOWN_QUANTITY, None, None, (FILE_COUNT_DIFFERS,)
    )
    # The file lists several sizes or colours: the split stays unknown too,
    # and no total is kept, since none was agreed.
    for reading in ({"sizes": ["S", "M"]}, {"colours": ["чорна", "біла"]}):
        assert evidence("Лоран 3 шт", count=5, **reading) == FileLineEvidence(
            UNKNOWN_DISTRIBUTION, None, None, (FILE_COUNT_DIFFERS,)
        )
    # So does Birka's own reading of several.
    assert evidence("Лама бежевая/персик/butter 3 шт", count=4) == FileLineEvidence(
        UNKNOWN_DISTRIBUTION, None, None, (FILE_COUNT_DIFFERS,)
    )


def test_several_options_keep_the_total_and_leave_the_split_unknown() -> None:
    for reading in (
        {"sizes": ["S", "M"]},
        {"colours": ["чорна", "біла"]},
        {"size_counts": counts(("S", 1), ("M", 2))},
    ):
        assert evidence("Лоран 3 шт", **reading).state is UNKNOWN_DISTRIBUTION, reading
        assert evidence("Лоран 3 шт", **reading).total == 3, reading
    # One size, one colour: nothing several about it.
    assert evidence("Лоран 3 шт", sizes=["M"], colours=["чорна"]) == FileLineEvidence(
        KNOWN, 3, None, ()
    )
    assert evidence("Лоран 3 шт", size_counts=counts(("M", 3))) == FileLineEvidence(
        KNOWN, 3, None, (FILE_SPLIT_NOT_IN_TEXT,)
    )


@pytest.mark.parametrize(
    ("text", "pairs", "count", "state", "total"),
    [
        ("Лоран шоколад S-1 M-2 L-1", (("S", 1), ("M", 2), ("L", 1)), None, None, 4),
        ("Лоран шоколад S - 1 M - 2", (("S", 1), ("M", 2)), None, None, 3),
        ("Лоран S:1 M:2", (("S", 1), ("M", 2)), None, None, 3),
        ("Лоран S=1 M=2", (("S", 1), ("M", 2)), None, None, 3),
        ("Лоран 46-1 48-2", (("46", 1), ("48", 2)), None, None, 3),
        ("Лоран S–1 M—2 L−1", (("S", 1), ("M", 2), ("L", 1)), None, None, 4),
        ("Лоран S‐1 M‑2 L‒1 XL―1", (("S", 1), ("M", 2), ("L", 1), ("XL", 1)), None, None, 5),
        # The file's total and Birka's own «3 шт» agree with the sum.
        ("Лоран M-1 L-2", (("M", 1), ("L", 2)), 3, None, 3),
        ("Лоран M-1 L-2 3 шт", (("M", 1), ("L", 2)), None, None, 3),
        ("Лоран M-1 L-2 3 шт", (("M", 1), ("L", 2)), 3, None, 3),
        # Case does not matter, and the size is kept as the file wrote it.
        ("Лоран m-2 l-1", (("M", 2), ("L", 1)), None, None, 3),
        ("Лоран M-2 L-1", (("m", 2), ("l", 1)), None, None, 3),
        ("Лоран 10-20 12-1", (("10", 20), ("12", 1)), None, None, 21),
        # One size with its count is the same case (owner, 2026-10-08); it
        # stays as Birka read it, never `KNOWN` on the file's word.
        ("Лоран шоколад M-3", (("M", 3),), None, UNKNOWN_QUANTITY, None),
        ("Лоран шоколад M-3", (("M", 3),), 3, UNKNOWN_QUANTITY, None),
        ("Лоран шоколад M:3 3 шт", (("M", 3),), None, KNOWN, 3),
        ("Бомбер чорний M=1", (("M", 1),), 1, UNKNOWN_QUANTITY, None),
    ],
)
def test_a_split_the_text_shows_is_kept(
    text: str,
    pairs: tuple[tuple[str, int], ...],
    count: int | None,
    state: SnapshotQuantityState | None,
    total: int | None,
) -> None:
    found = evidence(text, size_counts=counts(*pairs), count=count)

    assert found.shown_split == pairs
    assert found.reasons == ()
    if len(pairs) > 1:
        assert (found.state, found.total) == (UNKNOWN_DISTRIBUTION, total)
    else:
        assert (found.state, found.total) == (state, total)


@pytest.mark.parametrize(
    ("text", "pairs", "reading"),
    [
        # A size written twice.
        ("Лоран M-1 M-2 L-1", (("M", 1), ("L", 1)), {}),
        # A count that differs from the text's.
        ("Лоран M-1 L-2", (("M", 1), ("L", 3)), {}),
        ("Лоран шоколад M-3", (("M", 2),), {}),
        # «462» is never «46, 2».
        ("Лоран 462 48-1", (("46", 2), ("48", 1)), {}),
        # «XS» is not «S», and «L» inside «XL» is not «L».
        ("Лоран XS-1 M-2", (("S", 1), ("M", 2)), {}),
        ("Лоран XL-1 M-2", (("L", 1), ("M", 2)), {}),
        ("Лоран M-1 L-2", (("M", 1), ("L", 2)), {"colours": ["чорна", "біла"]}),
        # Two colours by Birka's reading, and a slash, are contextual.
        ("Лоран чорна біла M-1 L-2", (("M", 1), ("L", 2)), {}),
        ("Лоран чорна/біла M-1 L-2", (("M", 1), ("L", 2)), {}),
        ("Лоран M-1 L-2 /", (("M", 1), ("L", 2)), {}),
        # A total that disagrees: the file's, or Birka's with its unit, or
        # Birka's when it found two, or one it is unsure of.
        ("Лоран M-1 L-2", (("M", 1), ("L", 2)), {"count": 4}),
        ("Лоран M-1 L-2 5 шт", (("M", 1), ("L", 2)), {}),
        ("Лоран M-1 L-2 1 шт 2 шт", (("M", 1), ("L", 2)), {}),
        ("Лоран M-1 L-2 не 3 шт", (("M", 1), ("L", 2)), {}),
        # «M» and «м» are one size, so not two of a split.
        ("Лоран M-1 м-2", (("M", 1), ("м", 2)), {}),
        ("Лоран XXL-1 2XL-2", (("XXL", 1), ("2XL", 2)), {}),
        # A space alone joins nothing (owner, 2026-10-08).
        ("Бомбер M 3", (("M", 3),), {}),
        ("Лоран M2 L1", (("M", 2), ("L", 1)), {}),
        ("Лоран 46 1 48 2", (("46", 1), ("48", 2)), {}),
        ("Бомбер M 3 1200", (("M", 3),), {}),
        # Exactly one sign: two signs are not a size with its count.
        ("Лоран M--3", (("M", 3),), {}),
        ("Лоран M-:3", (("M", 3),), {}),
        # A size followed by letters, or a count by more digits, is not it.
        ("Лоран Mx-3", (("M", 3),), {}),
        ("Лоран M-30", (("M", 3),), {}),
        # Places that overlap are not two sizes with their counts.
        ("Лоран 46-48-2 48-1", (("46-48", 2), ("48", 1)), {}),
        ("Лоран M-1-2", (("M-1", 2), ("M", 1)), {}),
    ],
)
def test_a_split_is_shown_only_when_each_size_appears_once_with_its_count(
    text: str, pairs: tuple[tuple[str, int], ...], reading: dict[str, Any]
) -> None:
    found = evidence(text, size_counts=counts(*pairs), **reading)

    assert split(text, size_counts=counts(*pairs), **reading) is None
    assert found.shown_split is None
    # The file's counts are then a hint, answered with a note.
    assert FILE_SPLIT_NOT_IN_TEXT in found.reasons
    assert found.state is not KNOWN or found.total is not None


def test_no_split_is_shown_without_counts_per_size() -> None:
    for reading in ({}, {"sizes": ["M", "L"]}, {"count": 3}):
        assert split("Лоран M-1 L-2", **reading) is None, reading
        assert FILE_SPLIT_NOT_IN_TEXT not in evidence("Лоран M-1 L-2", **reading).reasons


def test_every_sign_joins_a_size_to_its_count_and_nothing_else_does() -> None:
    for sign in SPLIT_SEPARATORS:
        assert split(f"Лоран M{sign}1 L {sign} 2", size_counts=counts(("M", 1), ("L", 2))), sign
    for other in (" ", "  ", "_", ".", ",", "/", "+", "x", "×", "*", "~"):
        assert not split(f"Лоран M{other}1", size_counts=counts(("M", 1))), repr(other)


def test_a_line_with_a_file_count_or_counts_per_size_is_never_one_piece() -> None:
    parsed = parse_catalog_line("Бомбер шоколад М").to_dict()

    assert countless(parsed, None) is True
    assert countless(parsed, {}) is True
    assert countless(parsed, {"model": "Бомбер", "sizes": ["М"], "note": "x"}) is True
    assert countless(parsed, {"count": 1}) is False
    assert countless(parsed, {"size_counts": [{"size": "М", "count": 1}]}) is False
    # A line whose text has a number that may be a count stays as today.
    assert countless(parse_catalog_line("Куртка 46").to_dict(), {}) is False
    assert countless(None, None) is False


def test_a_note_sends_the_line_to_review() -> None:
    assert evidence("Куртки", note="заголовок") == FileLineEvidence(
        UNKNOWN_QUANTITY, None, None, (FILE_NOTE,)
    )
    assert evidence("Бомбер шоколад 3 шт", count=3, note="закреслено") == FileLineEvidence(
        KNOWN, 3, None, (FILE_NOTE,)
    )
    shown = evidence("Лоран M-1 L-2", size_counts=counts(("M", 1), ("L", 2)), note="нерозбірливо")
    assert (shown.shown_split, shown.reasons) == ((("M", 1), ("L", 2)), (FILE_NOTE,))


TEXTS = [
    "Бомбер шоколад 3 шт",
    "Бомбер шоколад",
    "Куртка 2 шт 3 шт",
    "Лоран S M L 3 шт",
    "Лоран M-1 L-2",
    "Лоран M-1 L-2 3 шт",
    "Лама бежевая/персик/butter 3 шт",
    "Бомбер M 3 1200",
]
READINGS: list[dict[str, Any]] = [
    {},
    {"count": 3},
    {"count": 7},
    {"sizes": ["M", "L"]},
    {"size_counts": counts(("M", 1), ("L", 2))},
    {"size_counts": counts(("M", 3))},
    {"colours": ["чорна", "біла"], "count": 3},
    {"note": "закреслено"},
]


@pytest.mark.parametrize(("text", "reading"), list(itertools.product(TEXTS, READINGS)))
def test_a_row_always_satisfies_its_checks(text: str, reading: dict[str, Any]) -> None:
    """What `file_line_evidence` gives always fits the row's CHECKs:
    `known_quantity_has_total` and `unknown_quantity_has_no_total`."""
    found = evidence(text, **reading)

    assert found.state is not KNOWN or found.total is not None
    assert found.state is not UNKNOWN_QUANTITY or found.total is None
    # And never `KNOWN` on the file's word: only Birka's own reading of the
    # text, with nothing from the file against it.
    if found.state is KNOWN:
        assert evidence(text).state is KNOWN
        assert not {FILE_COUNT_DIFFERS, FILE_COUNT_HINT} & set(found.reasons)


def test_a_split_is_not_shown_beside_two_counts_whatever_the_parser_calls_them() -> None:
    """Birka's own count with its unit must be the only one: a parse naming
    two counts, even sure ones, never confirms a split (ADR-0014 §5.4). The
    parser of today marks two different counts unsure; the rule does not
    lean on that."""
    two = {
        "fields": {
            "quantity": [
                {"value": "3", "confidence": "EXPLICIT"},
                {"value": "5", "confidence": "EXPLICIT"},
            ]
        },
        "review_reasons": [],
        "option_groups": [],
    }
    assert shown_split(line("Лоран M-1 L-2", size_counts=counts(("M", 1), ("L", 2))), two) is None
    one = {**two, "fields": {"quantity": two["fields"]["quantity"][:1]}}
    assert shown_split(line("Лоран M-1 L-2", size_counts=counts(("M", 1), ("L", 2))), one) == (
        ("M", 1),
        ("L", 2),
    )


def test_birka_s_own_reading_of_options_leaves_the_split_unknown() -> None:
    """A slash names options even with one colour Birka knows: the split
    stays unknown when the file's count differs, never a count unknown."""
    assert evidence("Куртка бежевая/xyz 3 шт", count=4) == FileLineEvidence(
        UNKNOWN_DISTRIBUTION, None, None, (FILE_COUNT_DIFFERS,)
    )
