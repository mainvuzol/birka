"""The drawer's arithmetic, as pure functions (ADR-0012, B4.1, B6.3, B7).

What the drawer should hold, the difference, what a correction moves, what
later records explain of a closed day, which business day a moment is, and
which differences need a reason. The worked examples of B7 are computed here
with their exact figures; `tests/integration/test_cash_close.py` proves the
same figures come out of the database.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.modules.cash.service import (
    NOT_STATED,
    SMALL_DIFFERENCE,
    business_day,
    cash_effect,
    difference_of,
    expected_cash,
    explained_by,
    reason_required,
    unexplained_of,
    way_effect,
)

KYIV = "Europe/Kyiv"


def d(value: str) -> Decimal:
    return Decimal(value)


def expected(
    opening: str | None,
    *,
    cash_in: str = "0",
    cash_out: str = "0",
    taken_out: str = "0",
    put_in: str = "0",
    corrected: str = "0",
) -> Decimal | None:
    return expected_cash(
        opening_float=None if opening is None else d(opening),
        cash_in=d(cash_in),
        cash_out=d(cash_out),
        taken_out=d(taken_out),
        put_in=d(put_in),
        cash_corrected=d(corrected),
    )


# --- what the drawer should hold ------------------------------------------------


def test_the_ordinary_day_of_b7():
    """Float 2000; cash in 3000 + 1000 + 900; handed back 1200; «Витрати»
    150; S4 corrected card → cash +700. Counted 6100: 150 short."""
    cash_in = d("3000") + d("1000") + d("900")
    corrected = cash_effect(direction="IN", amount=d("700"), from_method="CARD", to_method="CASH")
    assert corrected == d("700.00")
    should = expected(
        "2000", cash_in=str(cash_in), cash_out="1200", taken_out="150", corrected=str(corrected)
    )
    assert should == d("6250.00")
    assert difference_of(d("6100.00"), should) == d("-150.00")


@pytest.mark.parametrize(
    ("counted", "difference"),
    [("6100.00", "-150.00"), ("6250.00", "0.00"), ("6600.00", "350.00")],
)
def test_a_difference_is_counted_less_expected_either_way(counted, difference):
    assert difference_of(d(counted), d("6250.00")) == d(difference)


def test_cash_put_in_adds_and_cash_taken_out_takes_away():
    """Example I: 6100 counted, «Власнику» 6100, «Внесено в касу» 500, cash
    sales 1000 — the drawer holds 1500, so nothing is short."""
    assert expected("6100", cash_in="1000", taken_out="6100", put_in="500") == d("1500.00")
    # The signs matter: put in counted as taken out, or the other way round,
    # would show 1000 short.
    assert expected("6100", cash_in="1000", taken_out="500", put_in="6100") != d("1500.00")


def test_an_opening_count_has_nothing_to_compare():
    """Example D: the first close records what was counted, and nothing
    else (G6)."""
    assert expected(None, cash_in="3000") is None
    assert difference_of(d("2000.00"), None) is None
    assert unexplained_of(None, d("0.00")) is None
    assert not reason_required(None)


# --- what a correction moves ------------------------------------------------------


@pytest.mark.parametrize(
    ("direction", "from_method", "to_method", "cash"),
    [
        # Money taken: into cash, or out of it.
        ("IN", "CARD", "CASH", "350.00"),
        ("IN", "CASH", "CARD", "-350.00"),
        # Money handed back: the other way round.
        ("OUT", "CARD", "CASH", "-350.00"),
        ("OUT", "CASH", "CARD", "350.00"),
        # Neither side is cash: the drawer does not move.
        ("IN", "CARD", "TRANSFER", "0.00"),
        ("OUT", "TRANSFER", "CARD", "0.00"),
        # An order way and cash at the counter.
        ("IN", "CARRIER_COD", "CASH", "350.00"),
        ("IN", "CASH", "PREPAID_TRANSFER", "-350.00"),
        # From «не вказано»: it was in no way, so only the new one moves.
        ("IN", None, "CASH", "350.00"),
        ("OUT", None, "CASH", "-350.00"),
        ("IN", None, "CARD", "0.00"),
    ],
)
def test_a_corrections_cash_effect(direction, from_method, to_method, cash):
    assert cash_effect(
        direction=direction, amount=d("350.00"), from_method=from_method, to_method=to_method
    ) == d(cash)


def test_a_correction_moves_money_from_one_way_to_another_and_never_makes_any():
    """Every way's share sums to nothing, but for one from «не вказано»,
    which leaves «не вказано» for display."""
    ways = ("CASH", "CARD", "TRANSFER", "PREPAID_TRANSFER", "CARRIER_COD", NOT_STATED)
    for direction in ("IN", "OUT"):
        moved = [
            way_effect(
                way, direction=direction, amount=d("700"), from_method="CARD", to_method="CASH"
            )
            for way in ways
        ]
        assert sum(moved) == 0
        assert moved[ways.index("CARD")] == (d("-700.00") if direction == "IN" else d("700.00"))
        from_nothing = way_effect(
            NOT_STATED, direction=direction, amount=d("700"), from_method=None, to_method="CASH"
        )
        assert from_nothing == (d("-700.00") if direction == "IN" else d("700.00"))


def test_the_card_sums_of_the_ordinary_day_net_to_the_slip():
    """Card in 2500 + 700 (S4 recorded card), out 2500 (R2), S4 corrected
    away: the slip reads 2500 sales and 2500 refunds."""
    corrected = way_effect(
        "CARD", direction="IN", amount=d("700"), from_method="CARD", to_method="CASH"
    )
    assert corrected == d("-700.00")
    assert d("3200") - d("2500") + corrected == 0


# --- what explains a closed day ----------------------------------------------------


def test_a_wrong_way_found_after_the_close_explains_its_difference():
    """Example A: close #2 counted 350 over; S5 corrected card → cash the
    next day explains all of it, and changes no expected sum."""
    found = cash_effect(direction="IN", amount=d("350"), from_method="CARD", to_method="CASH")
    explained = explained_by([found], [])
    assert explained == d("350.00")
    assert unexplained_of(d("350.00"), explained) == d("0.00")
    # Period 3 starts from what was counted, which already holds the 350.
    assert expected("6600", cash_in="1000") == d("7600.00")


def test_a_forgotten_take_out_explains_a_shortage():
    """Example B: 1000 short; «Власнику 1000, до закриття 07.10» the next
    day explains it; period 3 is not lowered again."""
    explained = explained_by([], [d("-1000.00")])
    assert unexplained_of(d("-1000.00"), explained) == d("0.00")
    assert expected("5250", cash_in="1000") == d("6250.00")


def test_a_take_out_resent_after_another_phones_close_explains_that_close():
    """Example J: 150 short on #2; Olena's «Витрати 150» lands on #2."""
    assert unexplained_of(d("-150.00"), explained_by([], [d("-150.00")])) == d("0.00")
    assert expected("4850", cash_in="1000") == d("5850.00")


def test_explanations_sum_corrections_take_outs_and_put_ins():
    explained = explained_by([d("350.00"), d("-100.00"), d("0.00")], [d("-1000.00"), d("200.00")])
    assert explained == d("-550.00")
    assert unexplained_of(d("-600.00"), explained) == d("-50.00")


# --- the business day (G8) ------------------------------------------------------------


@pytest.mark.parametrize(
    ("utc", "day"),
    [
        # Kyiv is UTC+3 in October.
        (datetime(2026, 10, 7, 20, 59, tzinfo=UTC), date(2026, 10, 7)),  # 23:59
        (datetime(2026, 10, 7, 21, 10, tzinfo=UTC), date(2026, 10, 7)),  # 00:10
        (datetime(2026, 10, 8, 2, 59, tzinfo=UTC), date(2026, 10, 7)),  # 05:59
        (datetime(2026, 10, 8, 3, 0, tzinfo=UTC), date(2026, 10, 8)),  # 06:00
        (datetime(2026, 10, 8, 17, 14, tzinfo=UTC), date(2026, 10, 8)),  # 20:14
        # UTC+2 in winter: the boundary moves with the clock.
        (datetime(2026, 12, 8, 3, 59, tzinfo=UTC), date(2026, 12, 7)),  # 05:59
        (datetime(2026, 12, 8, 4, 0, tzinfo=UTC), date(2026, 12, 8)),  # 06:00
    ],
)
def test_a_close_before_six_is_the_evening_befores(utc, day):
    assert business_day(utc, KYIV) == day


# --- which differences need a reason (G41) ----------------------------------------------


@pytest.mark.parametrize(
    ("difference", "needed"),
    [
        ("0.00", False),
        ("0.40", False),
        ("-0.40", False),
        ("0.99", False),
        ("-0.99", False),
        ("1.00", True),
        ("-1.00", True),
        ("150.00", True),
        ("-150.00", True),
    ],
)
def test_a_difference_under_one_hryvnia_needs_no_reason(difference, needed):
    assert reason_required(d(difference)) is needed


def test_the_small_difference_is_one_hryvnia():
    assert SMALL_DIFFERENCE == d("1.00")
