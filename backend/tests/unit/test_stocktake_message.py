"""What the bot tells the network's owner of a finished stocktake (owner
decision, 2026-10-10; ADR-0022): the sums, and what nobody counted, in the
store's own time."""

from __future__ import annotations

from datetime import UTC, datetime

from app.modules.stocktake.messages import message_text
from app.modules.stocktake.service import Sums


def text_of(**sums: int) -> str:
    figures = {
        "counted_positions": 40,
        "unchecked_positions": 0,
        "shortage_units": 0,
        "shortage_positions": 0,
        "surplus_units": 0,
        "surplus_positions": 0,
    } | sums
    return message_text(
        location_name="Склад на Подолі",
        store_name="Поділ",
        timezone="Europe/Kyiv",
        sums=Sums(**figures),
        started_by="Ганна",
        # 06:10 and 15:45 UTC: 09:10 and 18:45 in Kyiv, in October.
        started_at=datetime(2026, 10, 10, 6, 10, tzinfo=UTC),
        finished_by="Петро",
        finished_at=datetime(2026, 10, 10, 15, 45, tzinfo=UTC),
    )


def test_a_stocktake_that_found_nothing_says_so() -> None:
    assert text_of() == "\n".join(
        [
            "Інвентаризація: склад «Склад на Подолі», магазин «Поділ».",
            "Пораховано позицій: 40. Не перевірено: 0.",
            "Розбіжностей з обліком немає.",
            "Початок: Ганна, 10.10 09:10. Завершення: Петро, 10.10 18:45.",
        ]
    )


def test_a_shortage_alone_and_what_nobody_counted() -> None:
    lines = text_of(unchecked_positions=7, shortage_units=3, shortage_positions=2).splitlines()
    assert lines[1] == ("Пораховано позицій: 40. Не перевірено: 7 — їхні залишки не змінювались.")
    assert lines[2:4] == [
        "Нестача: 3 од. (позицій: 2).",
        "Початок: Ганна, 10.10 09:10. Завершення: Петро, 10.10 18:45.",
    ]


def test_a_surplus_alone() -> None:
    lines = text_of(surplus_units=5, surplus_positions=1).splitlines()
    assert lines[2] == "Надлишок: 5 од. (позицій: 1)."
    assert "Нестача" not in "\n".join(lines) and "Розбіжностей" not in "\n".join(lines)
