"""How a size is written: one size, one spelling (owner decision, 2026-10-03).

A size used to be stored exactly as typed, so `M` and `m` became two sizes
with two balances. The owner decided which spellings are one size:

- case does not matter;
- the Cyrillic `М Л С ХС ХЛ ХХЛ` are the Latin sizes;
- a count of X's is the X's written out, for every count, `1XL` included:
  `2XL` = `XXL`, `1XL` = `XL`;
- in a double size, spaces and the kind of dash do not matter; a slash is
  another size.

A size is shown in one spelling: capital Latin, the X's written out. This
module is the one place that decides it (ADR-0009 §1). It has no database:
the key a size is found by is `lower()` of this spelling, compared by the
database itself.
"""

from __future__ import annotations

import re
import unicodedata

# A size's column. A spelling can grow past what was typed (`9XL` is ten
# letters), so the spelling is what is measured.
SIZE_CODE_LIMIT = 20

_DASHES = str.maketrans(dict.fromkeys("\u2010\u2011\u2012\u2013\u2014\u2015\u2212", "-"))
_AROUND_SEPARATOR = re.compile(r" ?([-/]) ?")
# A word: a run of letters and digits, an apostrophe inside it included.
# `48 (м)` has two, `48` and `м`.
_WORD = re.compile(r"[^\W_]+(?:['\u2019\u02bc][^\W_]+)*")
# Only the letters the owner named, as the parser reads them in a notebook
# line (`parser._SIZES`). A Latin `C` is not an `S`.
_CYRILLIC = str.maketrans({"х": "x", "л": "l", "с": "s", "м": "m"})
_LETTER_SIZE = re.compile(r"M|X*[SL]|(?P<count>[1-9][0-9]*)X(?P<end>[SL])")
_LATIN = re.compile(r"[a-z]+")


def _spell_word(word: str) -> str:
    letters = word.casefold().translate(_CYRILLIC).upper()
    match = _LETTER_SIZE.fullmatch(letters)
    if match is None:
        # A number, or a word: its Latin letters are capitals, and a
        # Cyrillic word such as «єдиний» keeps its letters.
        return _LATIN.sub(lambda latin: latin.group().upper(), word)
    if match["count"]:
        # Written out at most one past the limit: a longer size is refused
        # for its length either way, and `999999999XL` must not build a
        # gigabyte of X's first.
        return "X" * min(int(match["count"]), SIZE_CODE_LIMIT) + match["end"]
    return letters


def spell_size(typed: str) -> str:
    """The one spelling of a typed size: `2хл` → `XXL`, `46 – 48` → `46-48`,
    `л / хл` → `L/XL`, `48 (м)` → `48 (M)`. A space elsewhere stays: `46 48`
    is not `46-48`."""
    text = " ".join(unicodedata.normalize("NFKC", typed).split())
    text = _AROUND_SEPARATOR.sub(r"\1", text.translate(_DASHES))
    # NFKC again: a Cyrillic `Л` made `L` may now compose with a mark after
    # it, and a spelling must be its own spelling.
    return unicodedata.normalize("NFKC", _WORD.sub(lambda word: _spell_word(word.group()), text))


def letter_rank(spelling: str) -> int | None:
    """Where a letter size reads in a list: `XXS XS S M L XL XXL …`.
    None for any other size."""
    if spelling == "M":
        return 0
    if re.fullmatch(r"X*[SL]", spelling):
        step = len(spelling)
        return -step if spelling.endswith("S") else step
    return None


__all__ = ["SIZE_CODE_LIMIT", "letter_rank", "spell_size"]
