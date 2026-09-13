"""Money arithmetic.

Invariant I7: no binary floating point anywhere near a price. Invariant I22:
the line arithmetic the database enforces must be what the service produces,
or every sale fails on a CHECK constraint.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.modules.sales.service import money


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("10", "10.00"),
        ("10.004", "10.00"),
        ("10.005", "10.01"),  # half-up, not banker's rounding
        ("10.006", "10.01"),
        ("0.005", "0.01"),
        ("1999.999", "2000.00"),
        ("0", "0.00"),
    ],
)
def test_rounding_is_half_up_to_two_places(raw: str, expected: str) -> None:
    assert money(Decimal(raw)) == Decimal(expected)


def test_half_up_differs_from_python_default_rounding() -> None:
    """Python rounds 0.005 to 0.00 by default (banker's rounding).

    A shop expects 0.005 to become 0.01. Getting this wrong loses a hundredth
    per line, which is invisible per receipt and wrong in the monthly total.
    """
    assert money(Decimal("0.005")) == Decimal("0.01")
    assert money(Decimal("0.015")) == Decimal("0.02")


def test_line_arithmetic_matches_the_database_constraints() -> None:
    """The two CHECKs on sale_item: final = unit - discount, total = final x qty."""
    unit_price = money(Decimal("1250.50"))
    discount = money(Decimal("50.25"))
    quantity = 3

    final_unit_price = money(unit_price - discount)
    line_total = money(final_unit_price * quantity)

    assert final_unit_price == Decimal("1200.25")
    assert line_total == Decimal("3600.75")
    assert final_unit_price == unit_price - discount
    assert line_total == final_unit_price * quantity


def test_a_repeating_division_still_satisfies_the_constraint() -> None:
    """The dangerous shape: a price that does not divide cleanly.

    Rounding the unit price first and multiplying after is what keeps the
    stored line consistent; rounding only the total would not.
    """
    unit_price = money(Decimal("100") / 3)
    quantity = 3

    line_total = money(unit_price * quantity)

    assert unit_price == Decimal("33.33")
    assert line_total == Decimal("99.99")
    assert line_total == unit_price * quantity


def test_money_never_returns_a_float() -> None:
    result = money(Decimal("1.005"))

    assert isinstance(result, Decimal)
    assert not isinstance(result, float)
