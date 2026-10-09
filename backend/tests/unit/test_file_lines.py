"""What a line from a parser's file says about its count (ADR-0014 §4, §5).

Birka's own parse of the line's text decides its count, as for a typed line.
The parser's reading only adds doubt, and never makes a line `KNOWN`:

- the parser's count is a hint unless the text states it with «шт» (owner,
  2026-10-08: «Бомбер M 3 1200» is a bare number, answered with a note);
- a split the text shows, each size joined to its count by a sign, one
  size or several («S-1 M-2 L-1», «Лоран M-3»), is kept for a tap; a space
  alone joins nothing («M 3»; owner, 2026-10-08); and the text shows nothing
  beside it: no other size, no other size with a count, no number but the
  price, a count with «шт» or a length (review, 2026-10-09);
- a record of it that may also be a range of sizes («42-44») is asked about
  first (owner, 2026-10-09).

Every case runs through the real parser, so what is pinned is what a line
will get.
"""

from __future__ import annotations

import itertools
from typing import Any

import pytest

from app.modules.catalog.parser import parse_catalog_line
from app.modules.catalog.sizes import spell_size
from app.modules.snapshots.file_lines import (
    FILE_COUNT_DIFFERS,
    FILE_COUNT_HINT,
    FILE_NOTE,
    FILE_SPLIT_NOT_IN_TEXT,
    SPLIT_SEPARATORS,
    FileLineEvidence,
    SplitRecord,
    countless,
    file_line_evidence,
    may_be_range,
    shown_split,
    split_records,
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
        ("S-1 M-2 L-1", (("S", 1), ("M", 2), ("L", 1)), {}),
        ("Лоран бежевий S-1 M-2 L-1", (("S", 1), ("M", 2), ("L", 1)), {}),
        ("M-3", (("M", 3),), {}),
        ("Лоран M-3", (("M", 3),), {}),
        ("m:3 l = 12", (("M", 3), ("L", 12)), {}),
        ("42-44", (("42", 44),), {}),
        ("46-1 48-2", (("46", 1), ("48", 2)), {}),
        ("M:3 3 шт", (("M", 3),), {}),
        ("M=1", (("M", 1),), {}),
        ("S-1,M-2", (("S", 1), ("M", 2)), {}),
        ("S-1, M-2", (("S", 1), ("M", 2)), {}),
        ("S-1; M-2", (("S", 1), ("M", 2)), {}),
        ("46-2; 48-1", (("46", 2), ("48", 1)), {}),
        ("Лоран M-3 шт", (("M", 3),), {}),
        # The file's price, as its digits are written; a count with «шт»
        # equal to the sum; a length Birka reads.
        ("Лоран бежевий S-1 M-2 L-1 1850", (("S", 1), ("M", 2), ("L", 1)), {"price": "1850"}),
        ("Лоран M-3 1850 грн", (("M", 3),), {"price": "1850"}),
        ("Лоран M-3 1850", (("M", 3),), {"price": "1850 грн"}),
        ("Лоран M-1 L-2 3 шт 1200", (("M", 1), ("L", 2)), {"price": "1200"}),
        ("Пальто 110 см S-1 M-2", (("S", 1), ("M", 2)), {}),
        # A comma or a point lists on: no fraction without a digit right
        # after it.
        ("Лоран бежевий S-1, M-2, L-1, 1850", (("S", 1), ("M", 2), ("L", 1)), {"price": "1850"}),
        ("Лоран M-3. 1850", (("M", 3),), {"price": "1850"}),
        # The preposition «с» is no size S: lowercase, as the parser reads
        # it, or a capital «С» that begins a phrase Birka's parse reads
        # (review, fourth round, 2026-10-09); joined by a sign to its count,
        # «С» is a size of the split. A digit of another script is a digit.
        ("Куртка с капюшоном M-3", (("M", 3),), {}),
        ("Куртка с поясом M-3", (("M", 3),), {}),
        ("Куртка С капюшоном M-3", (("M", 3),), {}),
        ("Шуба С норкой M-3", (("M", 3),), {}),
        ("Куртка С капюшоном С-3", (("С", 3),), {}),
        ("Куртка с капюшоном с-3", (("с", 3),), {}),
        # What this does not see: a lowercase «с» written for S reads as the
        # preposition, as the parser reads it (ADR-0014 §5, known risks).
        ("Лоран M-3 с", (("M", 3),), {}),
        ("Лоран M-３", (("M", 3),), {}),
        # A Ukrainian word's apostrophe, between a Cyrillic letter and «я»,
        # «ю», «є» or «ї», joins it: the «м» of «м'ята» is no size M.
        ("Лоран м'ята M-3", (("M", 3),), {}),
        ("Лоран м’ятний S-1 M-2", (("S", 1), ("M", 2)), {}),
        ("Лоран м\u02bcята M-3", (("M", 3),), {}),
        # A modifier letter that writes an apostrophe is a sign, as «'» is
        # (review, after the fourth round, 2026-10-09): before a size or
        # after a count it joins nothing to them.
        ("Лоран 'M-3", (("M", 3),), {}),
        ("Лоран \u02bcM-3", (("M", 3),), {}),
        ("Лоран M-3\u02bc", (("M", 3),), {}),
        ("Лоран м'ята м-3", (("м", 3),), {}),
        # A comma with a space after it lists on, a bracket or a currency
        # sign opens something else, and a no-break space about the sign is
        # a space.
        ("M-3, 5", (("M", 3),), {"price": "5"}),
        ("Лоран M-3 (1850)", (("M", 3),), {"price": "1850"}),
        ("Лоран M-3 ₴1850", (("M", 3),), {"price": "1850"}),
        ("Лоран M\u00a0-\u00a03", (("M", 3),), {}),
        # The price is the parser's word: a number the file calls the price
        # is excused, whatever else it might be (ADR-0014 §5; a reading
        # awaiting the owner, R-f).
        ("Лоран 46-2 48", (("46", 2),), {"price": "48"}),
    ],
)
def test_a_split_shown_with_nothing_beside_it_but_a_price_a_count_or_a_length(
    text: str, pairs: tuple[tuple[str, int], ...], reading: dict[str, Any]
) -> None:
    """Review, 2026-10-09: the text shows the split and nothing beside it.
    Every number in it is the split's, or the file's price, a count with its
    unit or a length Birka read."""
    found = evidence(text, size_counts=counts(*pairs), **reading)

    assert split(text, size_counts=counts(*pairs), **reading) == pairs
    assert found.shown_split == pairs
    assert FILE_SPLIT_NOT_IN_TEXT not in found.reasons


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
        # A count that does not end with its digits is no count (review,
        # 2026-10-09): a sum, a fraction, a decimal or a product.
        ("Лоран M-3+2", (("M", 3),), {}),
        ("Лоран M-3 +2", (("M", 3),), {}),
        ("Лоран M-3,5", (("M", 3),), {}),
        ("Лоран M-3.5", (("M", 3),), {}),
        ("Лоран M-3/2", (("M", 3),), {}),
        ("Лоран M-3х2", (("M", 3),), {}),
        ("Лоран M-3Х2", (("M", 3),), {}),
        ("Лоран M-3x2", (("M", 3),), {}),
        ("Лоран M-3×2", (("M", 3),), {}),
        ("Лоран M-3*2", (("M", 3),), {}),
        ("Лоран M-3-2", (("M", 3),), {}),
        ("Лоран M-3·2", (("M", 3),), {}),
        # A sum or a product with spaces about its sign.
        ("Лоран M-3 + 2", (("M", 3),), {}),
        ("Лоран M-3 x 2", (("M", 3),), {}),
        ("Лоран M-3 * 2", (("M", 3),), {}),
        # The sign in either case, any whitespace about it, and the
        # multiplication signs ✕ ✖ ⨯ (review, third round, 2026-10-09):
        # even with the number after it the file's price.
        ("M-3X2", (("M", 3),), {"price": "2"}),
        ("M-3 Х 2", (("M", 3),), {"price": "2"}),
        ("M-3\u00a0x\u00a02", (("M", 3),), {"price": "2"}),
        ("M-3✕2", (("M", 3),), {"price": "2"}),
        ("M-3✖2", (("M", 3),), {"price": "2"}),
        ("M-3 ⨯ 2", (("M", 3),), {"price": "2"}),
        ("M-3\u2009+\u20092", (("M", 3),), {"price": "2"}),
        ("M-3\u3000X\u20032", (("M", 3),), {"price": "2"}),
        ("M-3\u202f,5", (("M", 3),), {"price": "5"}),
        # What may follow a count is named, and nothing else before a
        # numeral ends it (review, fourth round, 2026-10-09): a sign of
        # another width or kind, a dash with no-break spaces about it, and a
        # format character, which prints nothing, wherever it stands.
        ("M-3＋2", (("M", 3),), {"price": "2"}),
        ("M-3＊2", (("M", 3),), {"price": "2"}),
        ("M-3／2", (("M", 3),), {"price": "2"}),
        ("M-3ｘ2", (("M", 3),), {"price": "2"}),
        ("M-3Ｘ2", (("M", 3),), {"price": "2"}),
        ("M-3∗2", (("M", 3),), {"price": "2"}),
        ("M-3•2", (("M", 3),), {"price": "2"}),
        ("M-3÷2", (("M", 3),), {"price": "2"}),
        ("M-3⁄2", (("M", 3),), {"price": "2"}),
        ("M-3⨉2", (("M", 3),), {"price": "2"}),
        ("M-3－2", (("M", 3),), {"price": "2"}),
        ("M-3~2", (("M", 3),), {"price": "2"}),
        ("M-3\u00a0–\u00a02", (("M", 3),), {"price": "2"}),
        ("M-3\u3000-\u30002", (("M", 3),), {"price": "2"}),
        ("M-3\u200bx2", (("M", 3),), {"price": "2"}),
        ("M-3x\u200b2", (("M", 3),), {"price": "2"}),
        ("M-3\ufeffx2", (("M", 3),), {"price": "2"}),
        ("M-3\u00adx2", (("M", 3),), {"price": "2"}),
        ("M-3\u200b5", (("M", 3),), {"price": "5"}),
        ("M-3,\u200b5", (("M", 3),), {"price": "5"}),
        ("M-3٫5", (("M", 3),), {"price": "5"}),
        ("M-3，5", (("M", 3),), {"price": "5"}),
        ("M-3．5", (("M", 3),), {"price": "5"}),
        # A letter that looks like «x», in either case: the Greek «Χ», the
        # Cyrillic «Ҳ», «Ӽ» and «Ӿ»; «x» with a mark or a variation selector
        # on it, or written with one; and a mark between the count and what
        # follows it, or on the count's last digit (review, after the fourth
        # round, 2026-10-09).
        ("M-3\u03a72", (("M", 3),), {"price": "2"}),
        ("M-3\u03c72", (("M", 3),), {"price": "2"}),
        ("M-3\u04b22", (("M", 3),), {"price": "2"}),
        ("M-3\u04b32", (("M", 3),), {"price": "2"}),
        ("M-3\u04fc2", (("M", 3),), {"price": "2"}),
        ("M-3 \u04fd 2", (("M", 3),), {"price": "2"}),
        ("M-3\u04fe2", (("M", 3),), {"price": "2"}),
        ("M-3x\u03012", (("M", 3),), {"price": "2"}),
        ("M-3 x\u0301 2", (("M", 3),), {"price": "2"}),
        ("M-3x\ufe0f2", (("M", 3),), {"price": "2"}),
        ("M-3\u1e8b2", (("M", 3),), {"price": "2"}),
        ("M-3\u02e32", (("M", 3),), {"price": "2"}),
        ("M-3\u0301x2", (("M", 3),), {"price": "2"}),
        ("Лоран M-3\u0301", (("M", 3),), {}),
        ("M-3,\u03015", (("M", 3),), {"price": "5"}),
        # «;» or «)» with a numeral right after it, and any sign the rule
        # does not name before a numeral, spaced or not: read strictly, the
        # count is part of something more (ADR-0014 §5).
        ("46-2;48-1", (("46", 2), ("48", 1)), {}),
        ("Лоран M-3;2", (("M", 3),), {"price": "2"}),
        ("Лоран M-3)2", (("M", 3),), {"price": "2"}),
        ("Лоран M-3 @1850", (("M", 3),), {"price": "1850"}),
        ("Лоран M-3 #1850", (("M", 3),), {"price": "1850"}),
        ("Лоран M-3 №1850", (("M", 3),), {"price": "1850"}),
        # A numeral that is no digit (review, 2026-10-09): a fraction, a
        # superscript, a circled number, a Roman numeral sign.
        ("Лоран M-3½", (("M", 3),), {}),
        ("Лоран M-3²", (("M", 3),), {}),
        ("Лоран M-3 ①", (("M", 3),), {}),
        ("Лоран M-3 ²", (("M", 3),), {}),
        ("Лоран M-3 Ⅲ", (("M", 3),), {}),
        ("Лоран M-3 + ½", (("M", 3),), {}),
        ("Лоран M-3,½", (("M", 3),), {}),
        # ...even when the number after it is accounted for, here as the price.
        ("Лоран M-3+2", (("M", 3),), {"price": "2"}),
        ("Лоран M-3х2", (("M", 3),), {"price": "2"}),
        ("Лоран M-3,5", (("M", 3),), {"price": "5"}),
        ("Лоран M-3 + 2", (("M", 3),), {"price": "2"}),
        ("Лоран M-3·2", (("M", 3),), {"price": "2"}),
        ("Лоран M-3½", (("M", 3),), {"price": "½"}),
        ("Лоран M-3½", (("M", 3),), {"price": "3½"}),
        ("Лоран M-3 + ①", (("M", 3),), {"price": "①"}),
        # The size written once more, with a count or without.
        ("Лоран M-3 M 2", (("M", 3),), {}),
        ("Лоран M-3 (M)", (("M", 3),), {}),
        ("Лоран S-1 M-2 s", (("S", 1), ("M", 2)), {}),
        # Another size Birka reads in the text.
        ("Лоран S M-3", (("M", 3),), {}),
        ("Лоран M-3 L", (("M", 3),), {}),
        # A capital «С» outside a phrase Birka's parse reads is S, whatever
        # follows it (review, fourth round, 2026-10-09): nothing, a sign, a
        # price, a count, a size, or a word; with S in the split, it is S
        # written twice.
        ("M-3 С", (("M", 3),), {}),
        ("Лоран M-3 С.", (("M", 3),), {}),
        ("Лоран С M-3 С", (("M", 3),), {}),
        ("Лоран С M-3", (("M", 3),), {}),
        ("С M-3", (("M", 3),), {}),
        ("Лоран С, M-3", (("M", 3),), {}),
        ("Лоран M-3 С 1850", (("M", 3),), {"price": "1850"}),
        ("Лоран M-3, С 1850", (("M", 3),), {"price": "1850"}),
        ("Лоран M-3 С 1850 грн", (("M", 3),), {"price": "1850"}),
        ("Лоран M-3 С 3шт", (("M", 3),), {}),
        ("Лоран M-3 С без кількості", (("M", 3),), {}),
        ("Куртка С поясом M-3", (("M", 3),), {}),
        ("Лоран S-1 M-2 С 1850", (("S", 1), ("M", 2)), {"price": "1850"}),
        # An apostrophe joins no Latin size to a word: after a size, after a
        # count, or between two sizes (review, fourth round, 2026-10-09).
        ("Лоран M-3 L'", (("M", 3),), {}),
        ("Лоран M-3'L", (("M", 3),), {}),
        ("Лоран M-3’XL", (("M", 3),), {}),
        ("Лоран M-3 L'S", (("M", 3),), {}),
        ("Лоран M-3 XL’XXL", (("M", 3),), {}),
        ("Лоран S-1 M-2 L'L", (("S", 1), ("M", 2)), {}),
        ("Лоран S-1’M-2’L-4", (("S", 1), ("M", 2)), {}),
        ("Лоран M-3 С'Л", (("M", 3),), {}),
        # Nor does a modifier letter that writes an apostrophe, a prime or
        # another sign, though Unicode counts it a letter: it joins no two
        # words, and before a numeral it is a sign (review, after the
        # fourth round, 2026-10-09).
        ("Лоран M-3\u02bcL", (("M", 3),), {}),
        ("Лоран M-3 L\u02bcS", (("M", 3),), {}),
        ("Лоран M-3 XL\u02bcXXL", (("M", 3),), {}),
        ("Лоран S-1 M-2 L\u02bcL", (("S", 1), ("M", 2)), {}),
        ("Лоран M-3 \u0421\u02bc\u041b", (("M", 3),), {}),
        ("M-3\u02bc2", (("M", 3),), {"price": "2"}),
        # Another letter size by its spelling, though the parser reads only
        # XS to XXL (review, 2026-10-09): written out, with a Cyrillic letter,
        # or counted.
        ("Лоран S-1 M-2 XXXL", (("S", 1), ("M", 2)), {}),
        ("Лоран M-3 XXXL", (("M", 3),), {}),
        ("Лоран M-3 XXS", (("M", 3),), {}),
        ("Лоран M-3 XXXXL", (("M", 3),), {}),
        ("Лоран M-3 4XL", (("M", 3),), {}),
        ("Лоран M-3 ХL", (("M", 3),), {}),
        ("Лоран M-3 XL-XXL", (("M", 3),), {}),
        ("Лоран M-3 XXXL 1", (("M", 3),), {"price": "1"}),
        # The split's own size once more, in another spelling of it.
        ("Лоран M-3 М", (("M", 3),), {}),
        ("Лоран XXL-1 2XL", (("XXL", 1),), {}),
        ("Лоран XL-2 хл", (("XL", 2),), {}),
        ("Лоран OS-3 ＯＳ", (("OS", 3),), {}),
        # Another size with its count, of a letter size or a number one.
        ("Лоран S-1 M-2 L-4", (("S", 1), ("M", 2)), {}),
        ("Лоран M-3 L-5", (("M", 3),), {}),
        ("Лоран M-3 L-1200", (("M", 3),), {"price": "1200"}),
        ("Лоран 46-2 48-1200", (("46", 2),), {"price": "1200"}),
        # Another number: a bare total, a size whose count is lost, a price
        # the file does not give, or gives otherwise, or written twice.
        ("Лоран S-1 M-2 L-1 разом 5", (("S", 1), ("M", 2), ("L", 1)), {}),
        ("S-1 M-2 L-1 разом 5", (("S", 1), ("M", 2), ("L", 1)), {}),
        ("Лоран 46-2 48", (("46", 2),), {}),
        ("46-2 48", (("46", 2),), {}),
        ("Лоран M-3 1850", (("M", 3),), {}),
        ("Лоран M-3 1850", (("M", 3),), {"price": "1200"}),
        ("Лоран M-3 1850 1850", (("M", 3),), {"price": "1850"}),
        ("Лоран 2 в 1 M-3", (("M", 3),), {}),
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


# The modifier letters that write a sign (`file_lines._SIGN_LETTERS`): primes
# and apostrophes, half rings, glottal stops, accents, lines and colons.
SIGN_LETTERS = [
    chr(code) for code in (*range(0x02B9, 0x02C2), *range(0x02C6, 0x02D2), 0x02EC, 0x02EE)
]


@pytest.mark.parametrize("sign", SIGN_LETTERS, ids=lambda sign: f"U+{ord(sign):04X}")
def test_a_modifier_letter_that_writes_a_sign_is_no_letter(sign: str) -> None:
    """Review, after the fourth round, 2026-10-09: Unicode counts these
    modifier letters as letters (`Lm`), and a line reads them as the signs
    they write. Such a sign joins no size to a word, as «'» joins none, and
    before a numeral after a count it is a sign as any other."""
    assert split(f"Лоран M-3{sign}L", size_counts=counts(("M", 3))) is None
    assert split(f"Лоран M-3 L{sign}S", size_counts=counts(("M", 3))) is None
    assert split(f"M-3{sign}2", size_counts=counts(("M", 3)), price="2") is None
    assert split(f"46-2{sign}48-1", size_counts=counts(("46", 2), ("48", 1))) is None
    # After the count, with nothing after it, it hides nothing.
    assert split(f"Лоран M-3{sign}", size_counts=counts(("M", 3))) == (("M", 3),)


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


# ---------------------------------------------------------------------------
# A record that may also be a range of sizes (owner, 2026-10-09)
# ---------------------------------------------------------------------------


def found_in(catalogue: tuple[str, ...], records: list[SplitRecord]) -> set[str]:
    """What `catalog.read.sizes_by_spelling` answers for these records, with
    a catalogue of these codes: each spelling asked about whose one spelling
    (ADR-0009) is a code's, ignoring case."""
    codes = {spell_size(code).casefold() for code in catalogue}
    return {
        spelling
        for record in records
        for spelling in record.spellings()
        if spell_size(spelling).casefold() in codes
    }


def ranges(text: str, pairs: tuple[tuple[str, int], ...], *catalogue: str) -> list[bool]:
    records = split_records(text, counts(*pairs))
    sizes = found_in(catalogue, records)
    return [may_be_range(record, sizes) for record in records]


@pytest.mark.parametrize(
    ("text", "pairs", "written"),
    [
        ("Парка 42-44", (("42", 44),), [("42-44", "44")]),
        ("Парка 42 – 44", (("42", 44),), [("42 – 44", "44")]),
        ("Лоран m:3 l = 12", (("M", 3), ("L", 12)), [("m:3", "3"), ("l = 12", "12")]),
    ],
)
def test_each_record_of_a_split_is_found_as_the_text_writes_it(
    text: str, pairs: tuple[tuple[str, int], ...], written: list[tuple[str, str]]
) -> None:
    assert split(text, size_counts=counts(*pairs)) == pairs
    records = split_records(text, counts(*pairs))
    assert [(record.written, record.count_written) for record in records] == written


def test_a_count_that_is_itself_a_size_may_be_a_range() -> None:
    assert ranges("Парка 42-44", (("42", 44),), "42", "44") == [True]
    assert ranges("Парка 42-44 46-2", (("42", 44), ("46", 2)), "42", "44", "46") == [True, False]


def test_a_record_that_is_itself_a_size_may_be_a_range() -> None:
    assert ranges("Парка 42-44", (("42", 44),), "42", "42-44") == [True]


def test_a_record_neither_way_a_size_is_a_size_with_its_count() -> None:
    assert ranges("Парка 46-2", (("46", 2),), "46", "2-4", "M") == [False]
    assert ranges("Лоран M-1 L-2", (("M", 1), ("L", 2)), "M", "L", "XL") == [False, False]
    # The size itself is no range: «42» alone answers nothing.
    assert ranges("Парка 42-1", (("42", 1),), "42") == [False]


@pytest.mark.parametrize(
    ("text", "pairs", "asked"),
    [
        ("Парка 42-44", (("42", 44),), [True]),
        ("Парка 42-58", (("42", 58),), [True]),
        ("Парка 98-104", (("98", 104),), [True]),
        ("Парка 42 – 44 46-2", (("42", 44), ("46", 2)), [True, False]),
        # A count smaller than the size, or shorter, reads as no size after it.
        ("Парка 46-2", (("46", 2),), [False]),
        ("Парка 48-12", (("48", 12),), [False]),
        ("Парка 104-98", (("104", 98),), [False]),
        ("Лоран M-3", (("M", 3),), [False]),
        ("Лоран M-30", (("M", 30),), [False]),
    ],
)
def test_a_number_size_whose_count_reads_as_a_larger_size_may_be_a_range(
    text: str, pairs: tuple[tuple[str, int], ...], asked: list[bool]
) -> None:
    """Review, 2026-10-09, of the owner's rule of that day: «42-44» may be the
    sizes 42 to 44 whatever the catalogue holds, so it is asked about even
    with no size 44 or «42-44» in it."""
    assert split(text, size_counts=counts(*pairs)) == pairs
    assert ranges(text, pairs) == asked
    assert ranges(text, pairs, *(size for size, _ in pairs)) == asked


def test_a_possible_range_is_found_under_any_spelling_of_the_size() -> None:
    """One size, one spelling (ADR-0009): case, Cyrillic letters, spaces and
    the kind of dash do not matter."""
    assert ranges("Парка 42 – 44", (("42", 44),), "42-44") == [True]
    assert ranges("Парка 42—44", (("42", 44),), "42 - 44") == [True]
    assert ranges("Лоран M-3", (("M", 3),), "м-3") == [True]
    assert ranges("Лоран m-3", (("M", 3),), "M-3") == [True]


def test_a_record_the_text_does_not_show_is_asked_about() -> None:
    [record] = split_records("Парка", counts(("42", 44)))

    assert (record.written, record.count_written) == (None, None)
    assert may_be_range(record, set()) is True
