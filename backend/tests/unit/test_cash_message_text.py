"""What the bot says of a close's difference (ADR-0012, B8).

Plain and impersonal, like the app's texts; money printed as the app printed
it until 2026-10-17 — «6100,00 грн», a comma and no separator between
thousands (the app now writes «6 100,00 грн», P2-1); the reason
quoted, or said to be missing; the days nobody closed named. Nothing in it is
a customer's.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.modules.cash.messages import grn, message_text

KYIV = ZoneInfo("Europe/Kyiv")


def text(**changes: object) -> str:
    values: dict[str, object] = {
        "store_name": "Ринок",
        "business_day": date(2026, 10, 7),
        "difference": Decimal("-150.00"),
        "closed_by": "Марина",
        "closed_at": datetime(2026, 10, 7, 20, 14, tzinfo=KYIV),
        "counted": Decimal("6100.00"),
        "expected": Decimal("6250.00"),
        "reason": "помилилась зі здачею",
        "unclosed": (),
    }
    values.update(changes)
    return message_text(**values)  # type: ignore[arg-type]


def test_a_shortage_with_its_reason():
    assert text() == (
        "Каса «Ринок», 07.10: нестача 150,00 грн.\n"
        "Підрахунок: Марина, 20:14 — 6100,00 грн; мало бути 6250,00 грн.\n"
        "Причина: «помилилась зі здачею»."
    )


def test_a_surplus_without_a_reason():
    told = text(difference=Decimal("350.00"), counted=Decimal("6600.00"), reason=None)
    assert told.splitlines() == [
        "Каса «Ринок», 07.10: надлишок 350,00 грн.",
        "Підрахунок: Марина, 20:14 — 6600,00 грн; мало бути 6250,00 грн.",
        "Причину не вказано.",
    ]


def test_one_day_not_closed():
    told = text(unclosed=[date(2026, 10, 6)])
    assert told.splitlines()[-1] == "Не закрито: 06.10 — цей день увійшов у це закриття."


def test_several_days_not_closed():
    told = text(unclosed=[date(2026, 10, 5), date(2026, 10, 6)])
    assert told.splitlines()[-1] == "Не закрито: 05.10, 06.10 — ці дні увійшли в це закриття."


@pytest.mark.parametrize(
    ("value", "printed"),
    [
        (Decimal("1000"), "1000,00 грн"),
        (Decimal("6250.5"), "6250,50 грн"),
        (Decimal("1234567.89"), "1234567,89 грн"),
        (Decimal("0.4"), "0,40 грн"),
    ],
)
def test_money_has_a_comma_and_no_thousands_separator(value, printed):
    assert grn(value) == printed


def test_a_thousand_short_reads_as_the_app_prints_it():
    told = text(difference=Decimal("-1000.00"), counted=Decimal("5250.00"))
    assert told.splitlines()[0] == "Каса «Ринок», 07.10: нестача 1000,00 грн."


def test_nothing_in_it_comes_from_anywhere_but_the_close():
    """Every word is fixed, or the close's own: the store, the day, the
    closer, the sums and their reason. No customer, no goods, no phone."""
    told = text(unclosed=[date(2026, 10, 6)])
    fixed = told.replace("Ринок", "").replace("Марина", "").replace("помилилась зі здачею", "")
    for word in fixed.split():
        assert word.strip("«».,:;—") in {
            "",
            "Каса",
            "07.10",
            "06.10",
            "нестача",
            "150,00",
            "грн",
            "Підрахунок",
            "20:14",
            "6100,00",
            "мало",
            "бути",
            "6250,00",
            "Причина",
            "Не",
            "закрито",
            "цей",
            "день",
            "увійшов",
            "у",
            "це",
            "закриття",
        }, word
