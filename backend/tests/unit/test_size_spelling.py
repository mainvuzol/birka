"""One size, one spelling (owner decision, 2026-10-03; ADR-0009 §1)."""

import pytest

from app.modules.catalog.sizes import SIZE_CODE_LIMIT, letter_rank, spell_size


@pytest.mark.parametrize(
    ("typed", "spelling"),
    [
        # Case does not matter.
        ("m", "M"),
        ("xl", "XL"),
        ("Xl", "XL"),
        ("xxs", "XXS"),
        # The Cyrillic spellings the owner named, in either case.
        ("М", "M"),
        ("м", "M"),
        ("Л", "L"),
        ("С", "S"),
        ("ХС", "XS"),
        ("ХЛ", "XL"),
        ("ХХЛ", "XXL"),
        ("хл", "XL"),
        ("ХХС", "XXS"),
        # Latin and Cyrillic mixed in one size.
        ("Xл", "XL"),
        ("хL", "XL"),
        # A count of X's is the X's written out, for every count.
        ("2XL", "XXL"),
        ("3XL", "XXXL"),
        ("4XL", "XXXXL"),
        ("5xl", "XXXXXL"),
        ("2XS", "XXS"),
        ("2хл", "XXL"),
        ("3ХС", "XXXS"),
        ("10XL", "XXXXXXXXXXL"),
        # The owner's follow-up: `1XL` is `XL`.
        ("1XL", "XL"),
        ("1xs", "XS"),
        # A double size: spaces and the kind of dash do not matter.
        ("46-48", "46-48"),
        ("46 - 48", "46-48"),
        ("46–48", "46-48"),
        ("46 — 48", "46-48"),
        ("46−48", "46-48"),
        ("46‐48", "46-48"),
        ("46－48", "46-48"),
        ("s-m", "S-M"),
        ("л / хл", "L/XL"),
        ("L / XL", "L/XL"),
        # A letter size inside a longer size is spelt too.
        ("48 (м)", "48 (M)"),
        ("м (48)", "M (48)"),
        ("хл 52", "XL 52"),
        # Latin letters are capitals, however they were typed.
        ("one size", "ONE SIZE"),
        ("os", "OS"),
        ("0xl", "0XL"),
        ("2xxl", "2XXL"),
        ("x", "X"),
        # Spaces at the ends, and runs of them, never count.
        ("  M  ", "M"),
        ("46  -  48", "46-48"),
        # NFKC: full-width letters are the letters, a full-width dash a dash.
        ("Ｍ", "M"),
        ("\uff58\uff4c", "XL"),
        ("46 \uff0d 48", "46-48"),
    ],
)
def test_spellings_that_are_one_size(typed: str, spelling: str) -> None:
    assert spell_size(typed) == spelling


@pytest.mark.parametrize(
    "typed",
    [
        # A slash is another size than a dash.
        "46/48",
        # A number stays a number.
        "46",
        "0",
        # A Cyrillic word keeps its letters: Latin capitals are not a
        # spelling it can take.
        "єдиний",
        "Єдиний",
        "сім",
        # An apostrophe is inside a word: its `м` is not a size.
        "м'який",
        "м’який",
        "48 (M)",
        # Not a size the owner named: nothing is guessed.
        "X",
        "XXX",
        "0XL",
        "2XXL",
        "XM",
        "хм",
        "C",
        "XC",
        # A space that is not around a dash stays.
        "46 48",
        "2 XL",
    ],
)
def test_what_is_not_respelt(typed: str) -> None:
    assert spell_size(typed) == typed


def test_a_slash_and_a_dash_stay_two_sizes() -> None:
    assert spell_size("46 / 48") == "46/48"
    assert spell_size("46/48") != spell_size("46-48")


def test_a_latin_c_is_not_an_s() -> None:
    assert spell_size("xc") == "XC"
    assert spell_size("хс") == "XS"


def test_a_cyrillic_word_beside_a_letter_size() -> None:
    assert spell_size("м / єдиний") == "M/єдиний"


def test_letter_sizes_read_in_order() -> None:
    order = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL"]
    ranks = [letter_rank(spelling) for spelling in order]
    assert ranks == sorted(ranks)
    assert None not in ranks


@pytest.mark.parametrize("spelling", ["46", "46-48", "L/XL", "єдиний", "X", "xl", "MM"])
def test_only_a_letter_size_has_a_rank(spelling: str) -> None:
    assert letter_rank(spelling) is None


def _frozen_spelling():
    """`0032`'s own copy of the spelling, loaded as alembic would."""
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "migrations/versions/0032_size_spelling.py"
    spec = importlib.util.spec_from_file_location("size_spelling_0032", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module._spell


CORPUS = [
    "m",
    # A mark after a letter made Latin composes with it.
    "\u041b\u0301",
    "\u041c\u0301",
    "999999999999999999XL",
    "xl",
    "Xl",
    "М",
    "м",
    "Л",
    "С",
    "ХС",
    "ХЛ",
    "ХХЛ",
    "Xл",
    "хL",
    "2XL",
    "3XL",
    "5xl",
    "2XS",
    "2хл",
    "3ХС",
    "10XL",
    "1XL",
    "1xs",
    "46-48",
    "46 - 48",
    "46–48",
    "46−48",
    "46－48",
    "s-m",
    "л / хл",
    "48 (м)",
    "м (48)",
    "хл 52",
    "one size",
    "os",
    "0xl",
    "2xxl",
    "x",
    "  M  ",
    "Ｍ",
    "46/48",
    "46",
    "єдиний",
    "Єдиний",
    "сім",
    "м'який",
    "XXX",
    "XM",
    "C",
    "XC",
    "46 48",
    "2 XL",
    "9XL-9XL",
    "UNKNOWN",
]


@pytest.mark.parametrize("typed", CORPUS)
def test_the_migration_spells_as_the_app_does_today(typed: str) -> None:
    """`0032` respelt every size with a frozen copy of `spell_size`. If the
    app's spelling changes, sizes already stored keep the old one: changing
    it needs a new revision that respells them, and this test says so."""
    assert _frozen_spelling()(typed) == spell_size(typed)


@pytest.mark.parametrize("typed", CORPUS)
def test_a_spelling_is_its_own_spelling(typed: str) -> None:
    """Respelling a stored size changes nothing, so two sizes can only become
    one when their spellings are the same (the migration's refusal)."""
    assert spell_size(spell_size(typed)) == spell_size(typed)


@pytest.mark.parametrize("typed", ["999999999999999999XL", "99999999XS", "20XL", "100xl"])
def test_a_count_too_long_to_write_out_is_never_written_out(typed: str) -> None:
    """`999999999XL` would be a gigabyte of X's. Written out at most one past
    the column, it is refused for its length like `20XL` is."""
    assert len(spell_size(typed)) == SIZE_CODE_LIMIT + 1


def test_the_longest_count_that_fits_is_written_out() -> None:
    assert spell_size("19XL") == "X" * 19 + "L"
