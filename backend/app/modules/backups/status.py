"""Whether the server's backups are healthy, and what the owner is told.

Pure: the nights and the time in, a state and a message out. The owner's
decision of 2026-09-30 is a backup every night, and "a failed backup or drill
is shown to the owner in the app, and sent by the bot in Telegram". A night
that never ran leaves no record at all, so silence past a night and its grace
is a failure too.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any

from app.modules.backups.models import AlertKind, BackupRun

# The job runs once a night; two hours' grace for a slow or late one.
DUE = timedelta(hours=26)
# While a backup stays overdue, or was never set up, the owner is reminded
# once a day, not every time the watcher looks.
REMIND_EVERY = timedelta(hours=24)

SECTION = "Подробиці — у застосунку, розділ «Резервні копії»."

# What each check of `scripts.restore_drill` means to the owner.
CHECKS: Mapping[str, str] = {
    "archive": "архів пошкоджений",
    "restore": "архів не відновлюється",
    "migration": "у копії інша версія бази",
    "rows": "у копії бракує даних або є зайві",
    "triggers": "у копії вимкнений захист журналу товару",
    "locale": "у копії інші налаштування мови",
    "cyrillic": "у копії не працює пошук кирилицею",
    "ledger": "залишки не сходяться з рухом товару",
}


class State(StrEnum):
    OK = "OK"
    FAILED = "FAILED"
    OVERDUE = "OVERDUE"
    NOT_SET_UP = "NOT_SET_UP"


@dataclass(frozen=True, slots=True)
class Alert:
    key: str
    kind: AlertKind
    text: str


def state_of(latest: BackupRun | None, now: datetime) -> State:
    """The latest night decides, unless it is older than a night and its grace."""
    if latest is None:
        return State.NOT_SET_UP
    if now - latest.finished_at > DUE:
        return State.OVERDUE
    return State.OK if latest.ok else State.FAILED


def reasons(problems: Iterable[Mapping[str, Any]]) -> list[str]:
    """Each failed step of a night, as the owner reads it."""
    said = []
    for problem in problems:
        step = problem.get("step")
        if step == "backup":
            said.append("Не вдалося зробити копію бази.")
        elif step == "drill":
            checks = [CHECKS.get(name, name) for name in problem.get("checks") or []]
            said.append(
                "Копію зроблено, але перевірка відновленням не пройшла"
                + (f": {', '.join(checks)}." if checks else ".")
            )
        elif step == "encrypt":
            said.append("Копію не вдалося зашифрувати, і вона лишилася на сервері незашифрованою.")
        elif step == "key":
            said.append("На сервері не задано ключ власника, тож копію не зашифровано.")
        elif step == "still_running":
            # The previous night still held the lock: two nights never run
            # side by side on a small disk.
            said.append("Попередня нічна копія ще не завершилась: нову не почато.")
        else:
            said.append(f"Не вдався крок «{step}».")
    return said


def hours_since(moment: datetime, now: datetime) -> int:
    return int((now - moment).total_seconds() // 3600)


def alert_for(latest: BackupRun | None, now: datetime, last_told: AlertKind | None) -> Alert | None:
    """What the owner must hear now, if anything; `last_told` is the kind of
    the newest message already queued. Keys repeat exactly when the news
    does, so queuing is idempotent."""
    if latest is None:
        return Alert(
            key=f"never:{now:%Y-%m-%d}",
            kind=AlertKind.NOT_SET_UP,
            text=(
                "⚠️ Резервне копіювання ще не налаштоване: на сервері немає жодної копії "
                "бази. Якщо сервер зламається, дані магазину буде втрачено."
            ),
        )
    state = state_of(latest, now)
    if state is State.OVERDUE:
        reminder = (now - latest.finished_at - DUE) // REMIND_EVERY
        return Alert(
            key=f"overdue:{latest.id}:{reminder}",
            kind=AlertKind.OVERDUE,
            text=(
                f"⚠️ Резервна копія не робилася вже {hours_since(latest.finished_at, now)} год. "
                "Ймовірно, на сервері зупинився нічний розклад. " + SECTION
            ),
        )
    if state is State.FAILED:
        return Alert(
            key=f"failed:{latest.id}",
            kind=AlertKind.FAILED,
            text="\n".join(
                [
                    "⚠️ Нічна резервна копія не вдалася.",
                    *reasons(latest.problems),
                    "Попередні копії не видалено. " + SECTION,
                ]
            ),
        )
    if last_told is not None and last_told is not AlertKind.RECOVERED:
        return Alert(
            key=f"recovered:{latest.id}",
            kind=AlertKind.RECOVERED,
            text="✅ Резервна копія знову працює: копію зроблено й перевірено відновленням.",
        )
    return None


__all__ = ["DUE", "REMIND_EVERY", "Alert", "State", "alert_for", "reasons", "state_of"]
