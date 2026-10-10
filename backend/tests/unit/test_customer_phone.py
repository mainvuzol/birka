"""One phone is one customer, however it was written (owner decisions,
2026-10-01 and 2026-10-10), and another store's customer is found only by
their whole phone (2026-10-10)."""

from __future__ import annotations

import pytest

from app.modules.credit.service import _whole_phone, customer_key, digits


@pytest.mark.parametrize(
    "written",
    [
        "0671234567",
        "+38 (067) 123-45-67",
        "380671234567",
        # The old long-distance eight, and the zeros that dial from abroad.
        "8 067 123 45 67",
        "8(067)1234567",
        "0038 067 123 45 67",
        "+0038 067 123-45-67",
    ],
)
def test_a_ukrainian_number_is_one_customer_however_written(written: str) -> None:
    assert customer_key(digits(written)) == "0671234567"


@pytest.mark.parametrize(
    ("written", "kept"),
    [
        # Abroad, or not a whole Ukrainian number: kept as written.
        ("+48 067 123 45 67", "480671234567"),
        ("+1 202 555 0143", "12025550143"),
        ("38 067 123 45 6", "38067123456"),
        ("80 671 234 56", "8067123456"),
        ("0380 671 234 567", "0380671234567"),
    ],
)
def test_other_numbers_are_kept_as_written(written: str, kept: str) -> None:
    assert customer_key(digits(written)) == kept


@pytest.mark.parametrize(
    "query",
    [
        "0671234567",
        "+38 (067) 123-45-67",
        "067.123.45.67",
        "067/123 45 67",
        "8 067 123 45 67",
        # Pasted from a phone's contacts, between direction marks.
        "\u202a+38 067 123 45 67\u202c",
        "\u2066067 123 45 67\u2069",
        "  067 123 45 67  ",
    ],
)
def test_a_whole_number_is_a_search(query: str) -> None:
    assert _whole_phone(query) == "0671234567"


@pytest.mark.parametrize(
    "query",
    [
        "",
        "06",
        "067 123 45 6",
        "Ірина",
        "Ірина 0671234567",
        "0671234567 Ірина",
        "067*123*45*67",
        "067_123_45_67",
        "0671234567890123",
    ],
)
def test_a_name_or_a_part_of_a_number_is_not(query: str) -> None:
    assert _whole_phone(query) is None
