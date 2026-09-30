"""What the owner is told about the backups (owner decision, 2026-09-30).

Pure: nights and a time in, a state and a message out. A night that never
ran leaves no record, so silence past a night and its grace is a failure too.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.modules.backups.models import AlertKind, BackupRun
from app.modules.backups.status import DUE, REMIND_EVERY, State, alert_for, reasons, state_of

NOW = datetime(2026, 9, 30, 9, 0, tzinfo=UTC)


def night(*, ago: timedelta = timedelta(hours=6), problems: list | None = None) -> BackupRun:
    problems = problems or []
    return BackupRun(
        id=uuid.uuid4(),
        started_at=NOW - ago - timedelta(minutes=2),
        finished_at=NOW - ago,
        ok=not problems,
        problems=problems,
    )


LEDGER = {"step": "drill", "checks": ["ledger"], "detail": "ledger: 1 balance"}


def test_no_night_at_all_is_not_set_up():
    assert state_of(None, NOW) is State.NOT_SET_UP


def test_the_latest_night_decides_within_a_night_and_its_grace():
    assert state_of(night(ago=DUE), NOW) is State.OK
    assert state_of(night(ago=DUE, problems=[LEDGER]), NOW) is State.FAILED


def test_a_night_older_than_a_night_and_its_grace_is_overdue_whatever_it_said():
    late = DUE + timedelta(seconds=1)
    assert state_of(night(ago=late), NOW) is State.OVERDUE
    assert state_of(night(ago=late, problems=[LEDGER]), NOW) is State.OVERDUE


def test_every_step_is_worded_for_the_owner():
    assert reasons(
        [
            {"step": "backup", "detail": "pg_dump: connection refused"},
            LEDGER,
            {"step": "drill", "checks": [], "detail": "pg_restore not found"},
            {"step": "encrypt", "detail": "age: broken pipe"},
            {"step": "key", "detail": "not encrypted"},
            {"step": "mystery", "detail": "?"},
        ]
    ) == [
        "Не вдалося зробити копію бази.",
        "Копію зроблено, але перевірка відновленням не пройшла: "
        "залишки не сходяться з рухом товару.",
        "Копію зроблено, але перевірка відновленням не пройшла.",
        "Копію не вдалося зашифрувати, і вона лишилася на сервері незашифрованою.",
        "На сервері не задано ключ власника, тож копію не зашифровано.",
        "Не вдався крок «mystery».",
    ]


def test_an_unknown_check_is_named_rather_than_dropped():
    assert reasons([{"step": "drill", "checks": ["rows", "newcheck"]}]) == [
        "Копію зроблено, але перевірка відновленням не пройшла: "
        "у копії бракує даних або є зайві, newcheck."
    ]


def test_a_server_that_never_backed_up_is_told_once_a_day():
    first = alert_for(None, NOW, None)
    assert first is not None
    assert first.kind is AlertKind.NOT_SET_UP
    assert "не налаштоване" in first.text
    assert alert_for(None, NOW + timedelta(hours=10), AlertKind.NOT_SET_UP) == first
    later = alert_for(None, NOW + timedelta(days=1), AlertKind.NOT_SET_UP)
    assert later is not None and later.key != first.key


def test_a_failed_night_is_told_once_with_its_reasons():
    failed = night(problems=[LEDGER])
    alert = alert_for(failed, NOW, None)
    assert alert is not None
    assert alert.kind is AlertKind.FAILED
    assert alert.key == f"failed:{failed.id}"
    assert "залишки не сходяться з рухом товару" in alert.text
    assert "Попередні копії не видалено" in alert.text
    # Looking again finds the same news under the same key.
    assert alert_for(failed, NOW + timedelta(hours=1), AlertKind.FAILED) == alert


def test_an_overdue_backup_is_told_then_reminded_daily():
    last = night(ago=DUE + timedelta(minutes=10))
    first = alert_for(last, NOW, None)
    assert first is not None
    assert first.kind is AlertKind.OVERDUE
    assert "26 год" in first.text
    # The same news until a day has passed: queued once, however often looked at.
    again = alert_for(last, NOW + REMIND_EVERY - timedelta(minutes=11), AlertKind.OVERDUE)
    assert again is not None and again.key == first.key
    second = alert_for(last, NOW + REMIND_EVERY, AlertKind.OVERDUE)
    assert second is not None and second.key != first.key
    assert "50 год" in second.text


@pytest.mark.parametrize(
    "told", [AlertKind.FAILED, AlertKind.OVERDUE, AlertKind.NOT_SET_UP], ids=str
)
def test_a_good_night_after_a_warning_says_so(told):
    good = night()
    alert = alert_for(good, NOW, told)
    assert alert is not None
    assert alert.kind is AlertKind.RECOVERED
    assert alert.key == f"recovered:{good.id}"


@pytest.mark.parametrize("told", [None, AlertKind.RECOVERED], ids=str)
def test_a_good_night_with_nothing_to_undo_says_nothing(told):
    assert alert_for(night(), NOW, told) is None
