"""Trouble on the server, and what the owner and the administrator are told.

The owner decided on 2026-10-03 (business-rules.md, "failures are visible")
that trouble on the server is told by the bot: once when it starts, once a
day while it lasts, and once when it works again, with a sound in the shops'
hours. Trouble means the app does not answer, its database has stopped, the
disk is nearly full, or nobody can sign in. The owner accepted the proposed
thresholds: 5 minutes of no answer, less than 15 % or 3 GB of disk free, and
10 minutes in which no sign-in succeeded while people kept trying.

Pure: what the watcher saw at one look and the book of incidents in, the new
book and the news to tell out; only a new incident's row id is drawn at
random (`Incident.row`). `scripts.backup_watch` looks every minute,
keeps the book in memory and in `server_incident`, and sends the news.

Three kinds:

- **NOT_ANSWERING** — the API's `/internal/status` does not answer, or says
  its database is not `ok`, at every look for 5 minutes. It starts at the
  first look at which the first of those failed looks is 5 minutes old, and
  dates from that first failed look. It ends at the first look at which
  everything answers.
- **DISK_LOW** — less than 15 % or less than 3 GiB free on any disk measured
  (the backups' and the server's own). It starts at once, and ends only when
  every disk has at least 17 % and 4 GiB free, so a disk near the line does
  not start and end it again every minute.
- **SIGN_IN_FAILING** — the API counts sign-ins in its memory, and a
  refusal only when it has a sender (`identity/sign_ins.py`): a stranger's
  junk is not counted. It starts when sign-ins have been refused for at
  least 10 minutes, at least 3 times, with none succeeding since; the latest
  refusal is at most 5 minutes old, so people kept trying; and at least two
  people were refused, since one phone sending its stale launch again is not
  "nobody can sign in". One person is enough when most refusals are launches
  dated in the future: Telegram signed them, and no stale phone makes one. It
  dates from the first refusal, and ends when a sign-in succeeds. An API that
  restarted and has seen nobody try since says nothing either way: the
  incident stays open until a sign-in shows it works.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, time, timedelta
from enum import StrEnum
from zoneinfo import ZoneInfo

from app.modules.backups.models import IncidentKind as Kind

# The owner's thresholds (2026-10-03).
NOT_ANSWERING_AFTER = timedelta(minutes=5)
SIGN_IN_FAILING_AFTER = timedelta(minutes=10)
SIGN_IN_FAILURES = 3
# "While people kept trying": the latest refusal is at most this old.
SIGN_IN_TRIED_WITHIN = timedelta(minutes=5)
# Refused people, at least: one is a stale phone, not a broken sign-in.
SIGN_IN_SENDERS = 2
GIB = 1024**3
LOW_PERCENT = 15
LOW_BYTES = 3 * GIB
# A low disk is clear again only with this margin: no flapping around the line.
CLEAR_PERCENT = 17
CLEAR_BYTES = 4 * GIB

# "Once a day while it lasts", as with the backups.
REMIND_EVERY = timedelta(hours=24)

# With a sound in the shops' hours, 9:00 to 20:00 every day, Kyiv time; 20:00
# itself is already silent.
SHOP_ZONE = ZoneInfo("Europe/Kyiv")
SOUND_FROM = time(9, 0)
SOUND_UNTIL = time(20, 0)

# What the sellers do meanwhile, said after the reason. They sell on paper
# and type it in once the server answers (owner decision, 2026-10-04); the
# words are the ones proposed in ADR-0013 §10 (G10), built as recommended
# and listed for the owner to confirm.
ON_PAPER = "Продавці продають на папері."
FEEL: Mapping[Kind, str] = {
    Kind.NOT_ANSWERING: ON_PAPER,
    Kind.DISK_LOW: "Коли місце закінчиться, застосунок і нічні копії зупиняться.",
    # Whoever is signed in still sells: only a new sign-in fails.
    Kind.SIGN_IN_FAILING: "Хто ще не увійшов, продає на папері.",
}
AGAIN: Mapping[Kind, str] = {
    Kind.NOT_ANSWERING: "Сервер знову відповідає: продажі з паперу можна вносити.",
    Kind.DISK_LOW: "На диску сервера знову достатньо місця.",
    Kind.SIGN_IN_FAILING: "Вхід у застосунок знову працює.",
}

API_SILENT = "Сервер застосунку не відповідає."
DATABASE_SILENT = "База даних не відповідає."
SCHEMA_BEHIND = "База не оновлена до цієї версії застосунку: міграцію не виконано."

NOBODY_SIGNS_IN = "Ніхто не може увійти в застосунок"
CLOCK_WRONG = f"{NOBODY_SIGNS_IN}: схоже, на сервері неправильний годинник."
# A possibility, not a diagnosis: a launch whose signature fails is also
# what a forged one looks like, and a revoked token stops the bot itself.
TOKEN_WRONG = f"{NOBODY_SIGNS_IN}: можливо, токен бота на сервері не збігається з ботом."
SIGN_IN_REFUSED = f"{NOBODY_SIGNS_IN}."


class Place(StrEnum):
    """Which disk: the one holding the backups, or the server's own."""

    BACKUPS = "BACKUPS"
    SERVER = "SERVER"


PLACE: Mapping[Place, str] = {
    Place.BACKUPS: "диску з резервними копіями",
    Place.SERVER: "диску сервера",
}


class Moment(StrEnum):
    START = "START"
    REMINDER = "REMINDER"
    AGAIN = "AGAIN"


@dataclass(frozen=True, slots=True)
class SignIns:
    """The API's own count of sign-ins since it started (`/internal/status`)."""

    last_success_at: datetime | None
    # The first counted refusal after the last success; None once one
    # succeeds, and after a restart until someone is refused.
    failing_since: datetime | None
    failures: int
    # How many counted refusals of each reason: expired, future, signature
    # (malformed is never counted).
    reasons: Mapping[str, int] = field(default_factory=dict)
    # The latest counted refusal.
    last_failure_at: datetime | None = None
    # How many people were refused; an API that does not say counts as none.
    senders: int = 0


@dataclass(frozen=True, slots=True)
class ApiStatus:
    """What the API said about itself. `database` is `ok`, `unreachable` or
    `behind` (its schema is older than the code)."""

    database: str
    # None when the API's answer did not say, so nothing is concluded.
    sign_ins: SignIns | None


@dataclass(frozen=True, slots=True)
class Disk:
    place: Place
    free: int
    total: int


@dataclass(frozen=True, slots=True)
class Signals:
    """One look. `api` is None when the API did not answer at all."""

    now: datetime
    api: ApiStatus | None
    # The disks that exist; none measured leaves DISK_LOW as it is.
    disks: Sequence[Disk] = ()


@dataclass(frozen=True, slots=True)
class Incident:
    kind: Kind
    # The sentence the bot used: at the start, then at the last reminder.
    reason: str
    started_at: datetime
    # When the start reached the first chat; None while nobody has heard.
    told_at: datetime | None = None
    reminders: int = 0
    ended_at: datetime | None = None
    # Its row in `server_incident`, chosen when it starts (`step`): a write
    # repeated after its confirmation was lost rewrites that row rather than
    # adding a second (`server.keep`).
    row: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class Book:
    """Everything the watcher remembers between looks."""

    open: Mapping[Kind, Incident] = field(default_factory=dict)
    # Incidents that ended and are not written yet: the database may be down.
    ended: tuple[Incident, ...] = ()
    # The first look of the current run of looks at which the API, or its
    # database, did not answer.
    failing_since: datetime | None = None


@dataclass(frozen=True, slots=True)
class News:
    kind: Kind
    moment: Moment
    text: str
    # When it was decided: an unsent message is dropped a day later.
    at: datetime


# --- what the watcher saw -------------------------------------------------------------


def _moment(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _count(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def _sign_ins(value: object) -> SignIns | None:
    if not isinstance(value, Mapping):
        return None
    reasons = value.get("reasons")
    return SignIns(
        last_success_at=_moment(value.get("last_success_at")),
        failing_since=_moment(value.get("failing_since")),
        failures=_count(value.get("failures")),
        reasons=(
            {str(name): _count(count) for name, count in reasons.items()}
            if isinstance(reasons, Mapping)
            else {}
        ),
        last_failure_at=_moment(value.get("last_failure_at")),
        senders=_count(value.get("senders")),
    )


def api_status(payload: object) -> ApiStatus | None:
    """`GET /internal/status`'s body, or None when it is not an answer at all
    (then the API counts as not answering)."""
    if not isinstance(payload, Mapping):
        return None
    database = payload.get("database")
    return ApiStatus(
        database=database if isinstance(database, str) else "",
        sign_ins=_sign_ins(payload.get("sign_ins")),
    )


# --- each kind's rule -----------------------------------------------------------------


def not_answering(api: ApiStatus | None) -> str | None:
    """Why the app does not answer, or None when everything answers."""
    if api is None:
        return API_SILENT
    if api.database == "ok":
        return None
    if api.database == "behind":
        return SCHEMA_BEHIND
    # `unreachable`, or anything the watcher does not know: not ok.
    return DATABASE_SILENT


def is_low(disk: Disk) -> bool:
    """Less than 15 % or less than 3 GiB free."""
    return disk.free * 100 < LOW_PERCENT * disk.total or disk.free < LOW_BYTES


def is_clear(disk: Disk) -> bool:
    """At least 17 % and at least 4 GiB free."""
    return disk.free * 100 >= CLEAR_PERCENT * disk.total and disk.free >= CLEAR_BYTES


def _gigabytes(size: int) -> str:
    return f"{size / GIB:.1f}".replace(".", ",")


def disk_reason(disk: Disk) -> str:
    percent = disk.free * 100 // disk.total if disk.total > 0 else 0
    return (
        f"На {PLACE[disk.place]} лишилося {_gigabytes(disk.free)} ГБ вільного місця ({percent} %)."
    )


def _worst(disks: Sequence[Disk]) -> Disk:
    """The disk that fills first: the least free."""
    return min(disks, key=lambda disk: (disk.free, disk.place != Place.SERVER))


def _commonest(reasons: Mapping[str, int]) -> str | None:
    """The reason counted most often; None on a tie, or when none was."""
    most = max(reasons.values(), default=0)
    commonest = [reason for reason, count in reasons.items() if count == most]
    return commonest[0] if most > 0 and len(commonest) == 1 else None


def sign_ins_failing(sign_ins: SignIns, now: datetime) -> bool:
    """For 10 minutes no sign-in has succeeded while people kept trying
    (owner, 2026-10-03): refused for at least 10 minutes, at least 3 times,
    none succeeding since, the latest refusal at most 5 minutes ago, and at
    least two people refused, or one when most refusals are dated in the
    future.

    `failing_since` alone says none succeeded since: the API clears it at a
    success. Its times are whole seconds, and a clock stepped back makes a
    refusal look older than the success before it, so they are not compared.
    """
    if sign_ins.failing_since is None or sign_ins.last_failure_at is None:
        return False
    senders = 1 if _commonest(sign_ins.reasons) == "future" else SIGN_IN_SENDERS
    return (
        now - sign_ins.failing_since >= SIGN_IN_FAILING_AFTER
        and sign_ins.failures >= SIGN_IN_FAILURES
        and now - sign_ins.last_failure_at <= SIGN_IN_TRIED_WITHIN
        and sign_ins.senders >= senders
    )


def sign_in_reason(sign_ins: SignIns) -> str:
    """By the commonest reason: an expired or future-dated launch looks like
    the server's clock; a bad signature may be a bot token that is not this
    bot's, said as a possibility only. A tie, or anything else, names no
    cause rather than a wrong one."""
    counts = {
        CLOCK_WRONG: sign_ins.reasons.get("expired", 0) + sign_ins.reasons.get("future", 0),
        TOKEN_WRONG: sign_ins.reasons.get("signature", 0),
        SIGN_IN_REFUSED: sign_ins.reasons.get("malformed", 0),
    }
    most = max(counts.values())
    commonest = [reason for reason, count in counts.items() if count == most]
    if most == 0 or len(commonest) > 1:
        return SIGN_IN_REFUSED
    return commonest[0]


# --- what is said ---------------------------------------------------------------------


def duration(span: timedelta) -> str:
    minutes = int(span.total_seconds() // 60)
    if minutes < 1:
        return "менше хвилини"
    if minutes < 60:
        return f"{minutes} хв"
    hours, rest = divmod(minutes, 60)
    return f"{hours} год {rest} хв" if rest else f"{hours} год"


def start_text(kind: Kind, reason: str) -> str:
    return f"⚠️ {reason} {FEEL[kind]}"


def reminder_text(kind: Kind, reason: str, lasted: timedelta) -> str:
    hours = int(lasted.total_seconds() // 3600)
    return f"⚠️ Досі не виправлено, уже {hours} год. {reason} {FEEL[kind]}"


def again_text(kind: Kind, lasted: timedelta) -> str:
    return f"✅ {AGAIN[kind]} Тривало {duration(lasted)}."


def with_sound(moment: datetime) -> bool:
    """From 9:00 to 20:00 in Kyiv, every day; silent outside (owner, 2026-10-03)."""
    return SOUND_FROM <= moment.astimezone(SHOP_ZONE).time() < SOUND_UNTIL


# --- one look -------------------------------------------------------------------------


def step(book: Book, seen: Signals) -> tuple[Book, list[News]]:
    """What one look changes, and what must be told because of it."""
    now = seen.now
    opened = dict(book.open)
    ended = list(book.ended)
    news: list[News] = []
    # Each kind's reason as it stands now, for a reminder.
    current: dict[Kind, str] = {}

    def start(kind: Kind, reason: str, started_at: datetime) -> None:
        opened[kind] = Incident(
            kind=kind,
            reason=reason,
            started_at=started_at,
            # A trouble that began long ago is not reminded of at once.
            reminders=(now - started_at) // REMIND_EVERY,
            row=uuid.uuid4(),
        )
        news.append(News(kind, Moment.START, start_text(kind, reason), now))

    def end(kind: Kind) -> None:
        incident = opened.pop(kind, None)
        if incident is None:
            return
        ended.append(replace(incident, ended_at=now))
        news.append(News(kind, Moment.AGAIN, again_text(kind, now - incident.started_at), now))

    failing_since = book.failing_since
    trouble = not_answering(seen.api)
    if trouble is None:
        failing_since = None
        end(Kind.NOT_ANSWERING)
    else:
        failing_since = failing_since or now
        current[Kind.NOT_ANSWERING] = trouble
        if Kind.NOT_ANSWERING not in opened and now - failing_since >= NOT_ANSWERING_AFTER:
            start(Kind.NOT_ANSWERING, trouble, failing_since)

    if seen.disks:
        low = [disk for disk in seen.disks if is_low(disk)]
        unclear = [disk for disk in seen.disks if not is_clear(disk)]
        if Kind.DISK_LOW not in opened:
            if low:
                start(Kind.DISK_LOW, disk_reason(_worst(low)), now)
        elif not unclear:
            end(Kind.DISK_LOW)
        else:
            current[Kind.DISK_LOW] = disk_reason(_worst(unclear))

    sign_ins = seen.api.sign_ins if seen.api is not None else None
    if sign_ins is not None:
        if Kind.SIGN_IN_FAILING in opened:
            if sign_ins.failing_since is not None:
                current[Kind.SIGN_IN_FAILING] = sign_in_reason(sign_ins)
            elif sign_ins.last_success_at is not None:
                end(Kind.SIGN_IN_FAILING)
            # Neither: the API restarted and nobody has tried since. Nothing
            # shows that it works again, so it stays open as it was.
        elif sign_ins_failing(sign_ins, now) and sign_ins.failing_since is not None:
            start(Kind.SIGN_IN_FAILING, sign_in_reason(sign_ins), sign_ins.failing_since)

    for kind, incident in list(opened.items()):
        due = (now - incident.started_at) // REMIND_EVERY
        if due > incident.reminders:
            reason = current.get(kind, incident.reason)
            opened[kind] = replace(incident, reminders=due, reason=reason)
            news.append(
                News(
                    kind,
                    Moment.REMINDER,
                    reminder_text(kind, reason, now - incident.started_at),
                    now,
                )
            )

    return Book(open=opened, ended=tuple(ended), failing_since=failing_since), news


# --- the book and the database --------------------------------------------------------


def adopt(book: Book, stored: Incident, now: datetime) -> tuple[Book, list[News]]:
    """Take in an open incident the database holds and the book does not —
    after a restart — without announcing it again. One nobody has heard of
    yet is announced: its start never reached anyone."""
    if stored.kind in book.open:
        return book, []
    news = (
        []
        if stored.told_at is not None
        else [News(stored.kind, Moment.START, start_text(stored.kind, stored.reason), now)]
    )
    return replace(book, open={**book.open, stored.kind: stored}), news


def merged(remembered: Incident, stored: Incident) -> Incident:
    """One trouble the database and the watcher's memory both hold — the
    watcher restarted while the database was down, and noticed it again. It
    began when the earlier of them saw it begin."""
    told = [moment for moment in (remembered.told_at, stored.told_at) if moment is not None]
    return replace(
        remembered,
        started_at=min(remembered.started_at, stored.started_at),
        told_at=min(told) if told else None,
        reminders=max(remembered.reminders, stored.reminders),
        row=stored.row,
    )


def told(book: Book, kind: Kind, at: datetime) -> Book:
    """The start of `kind`'s trouble reached its first chat at `at`."""
    incident = book.open.get(kind)
    if incident is not None:
        if incident.told_at is not None:
            return book
        return replace(book, open={**book.open, kind: replace(incident, told_at=at)})
    ended = list(book.ended)
    for index in range(len(ended) - 1, -1, -1):
        if ended[index].kind is kind:
            if ended[index].told_at is None:
                ended[index] = replace(ended[index], told_at=at)
            break
    return replace(book, ended=tuple(ended))


__all__ = [
    "AGAIN",
    "API_SILENT",
    "CLEAR_BYTES",
    "CLEAR_PERCENT",
    "CLOCK_WRONG",
    "DATABASE_SILENT",
    "FEEL",
    "GIB",
    "LOW_BYTES",
    "LOW_PERCENT",
    "NOT_ANSWERING_AFTER",
    "REMIND_EVERY",
    "SCHEMA_BEHIND",
    "SIGN_IN_FAILING_AFTER",
    "SIGN_IN_FAILURES",
    "SIGN_IN_REFUSED",
    "SIGN_IN_SENDERS",
    "SIGN_IN_TRIED_WITHIN",
    "TOKEN_WRONG",
    "ApiStatus",
    "Book",
    "Disk",
    "Incident",
    "Kind",
    "Moment",
    "News",
    "Place",
    "SignIns",
    "Signals",
    "adopt",
    "again_text",
    "api_status",
    "disk_reason",
    "duration",
    "is_clear",
    "is_low",
    "merged",
    "not_answering",
    "reminder_text",
    "sign_in_reason",
    "sign_ins_failing",
    "start_text",
    "step",
    "told",
    "with_sound",
]
