"""Trouble on the server, and what is told about it (owner decision, 2026-10-03,
"failures are visible").

"A message once when trouble starts, once a day while it lasts, and once when
it works again", with the thresholds the owner accepted: the app not
answering for 5 minutes in a row, less than 15 % or 3 GB of the disk free,
and 10 minutes in which no sign-in succeeded while people kept trying. With
a sound from 9:00 to 20:00 in Kyiv, silently outside.

Pure: what the watcher saw and its book in, the new book and the news out.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.modules.backups.incidents import (
    API_SILENT,
    CLOCK_WRONG,
    DATABASE_SILENT,
    GIB,
    SCHEMA_BEHIND,
    SIGN_IN_REFUSED,
    TOKEN_WRONG,
    ApiStatus,
    Book,
    Disk,
    Incident,
    Kind,
    Moment,
    News,
    Place,
    Signals,
    SignIns,
    adopt,
    again_text,
    api_status,
    disk_reason,
    duration,
    is_clear,
    is_low,
    merged,
    reminder_text,
    sign_in_reason,
    start_text,
    step,
    told,
    with_sound,
)

T0 = datetime(2026, 10, 3, 7, 0, tzinfo=UTC)  # 10:00 in Kyiv
KYIV = ZoneInfo("Europe/Kyiv")

OK = ApiStatus(database="ok", sign_ins=None)
DOWN = None


def look(
    book: Book,
    at: datetime,
    api: ApiStatus | None = OK,
    disks: Sequence[Disk] = (),
) -> tuple[Book, list[News]]:
    return step(book, Signals(now=at, api=api, disks=disks))


def run(book: Book, looks: Sequence[tuple[datetime, ApiStatus | None]]) -> tuple[Book, list[News]]:
    said: list[News] = []
    for at, api in looks:
        book, news = look(book, at, api)
        said.extend(news)
    return book, said


def every_minute(start: datetime, until: datetime) -> list[datetime]:
    moments = []
    at = start
    while at <= until:
        moments.append(at)
        at += timedelta(minutes=1)
    return moments


def disk(free: int, total: int = 100 * GIB, place: Place = Place.SERVER) -> Disk:
    return Disk(place=place, free=free, total=total)


def refused(
    since: datetime | None = T0,
    failures: int = 3,
    last_success_at: datetime | None = None,
    *,
    last: datetime | None = T0 + timedelta(minutes=9),
    senders: int = 2,
    **reasons: int,
) -> ApiStatus:
    """Counted refusals since `since`, the latest at `last`, from `senders`
    people."""
    return ApiStatus(
        database="ok",
        sign_ins=SignIns(
            last_success_at=last_success_at,
            failing_since=since,
            failures=failures,
            reasons=reasons or {"signature": failures},
            last_failure_at=last if since is not None else None,
            senders=senders if since is not None else 0,
        ),
    )


RESTARTED = ApiStatus(
    database="ok",
    sign_ins=SignIns(last_success_at=None, failing_since=None, failures=0),
)


# --- the app does not answer ----------------------------------------------------------


def test_an_app_that_answers_is_no_news():
    book, news = run(Book(), [(at, OK) for at in every_minute(T0, T0 + timedelta(hours=1))])
    assert news == []
    assert book.open == {}


def test_five_minutes_without_an_answer_is_told_once_dating_from_the_first():
    book, news = run(Book(), [(T0, DOWN), (T0 + timedelta(minutes=4, seconds=59), DOWN)])
    assert news == []

    book, news = look(book, T0 + timedelta(minutes=5), DOWN)
    [start] = news
    assert (start.kind, start.moment) == (Kind.NOT_ANSWERING, Moment.START)
    assert start.text == ("⚠️ Сервер застосунку не відповідає. Продавці зараз не можуть продавати.")
    incident = book.open[Kind.NOT_ANSWERING]
    assert (incident.started_at, incident.reason, incident.told_at) == (T0, API_SILENT, None)

    _, news = run(
        book,
        [(at, DOWN) for at in every_minute(T0 + timedelta(minutes=6), T0 + timedelta(hours=2))],
    )
    assert news == []


def test_an_answer_in_between_starts_the_five_minutes_again():
    book, news = run(
        Book(),
        [
            (T0, DOWN),
            (T0 + timedelta(minutes=2), OK),
            (T0 + timedelta(minutes=3), DOWN),
            (T0 + timedelta(minutes=7, seconds=59), DOWN),
        ],
    )
    assert news == []
    assert book.failing_since == T0 + timedelta(minutes=3)

    book, news = look(book, T0 + timedelta(minutes=8), DOWN)
    assert [n.moment for n in news] == [Moment.START]
    assert book.open[Kind.NOT_ANSWERING].started_at == T0 + timedelta(minutes=3)


@pytest.mark.parametrize(
    ("api", "reason"),
    [
        (None, API_SILENT),
        (ApiStatus(database="unreachable", sign_ins=None), DATABASE_SILENT),
        (ApiStatus(database="behind", sign_ins=None), SCHEMA_BEHIND),
        # Anything the watcher does not know is not ok.
        (ApiStatus(database="", sign_ins=None), DATABASE_SILENT),
    ],
    ids=["api", "database", "behind", "unknown"],
)
def test_the_reason_says_what_did_not_answer(api, reason):
    book, news = run(Book(), [(T0, api), (T0 + timedelta(minutes=5), api)])
    assert book.open[Kind.NOT_ANSWERING].reason == reason
    assert news[0].text == f"⚠️ {reason} Продавці зараз не можуть продавати."


def test_the_spelled_out_reasons():
    assert DATABASE_SILENT == "База даних не відповідає."
    assert SCHEMA_BEHIND == "База не оновлена до цієї версії застосунку: міграцію не виконано."


def test_it_works_again_at_the_first_look_that_answers_and_says_how_long():
    book, _ = run(Book(), [(T0, DOWN), (T0 + timedelta(minutes=5), DOWN)])

    book, news = look(book, T0 + timedelta(minutes=12), OK)
    [again] = news
    assert (again.kind, again.moment) == (Kind.NOT_ANSWERING, Moment.AGAIN)
    assert again.text == "✅ Сервер знову відповідає: продавці можуть продавати. Тривало 12 хв."
    assert book.open == {}
    [ended] = book.ended
    assert (ended.started_at, ended.ended_at) == (T0, T0 + timedelta(minutes=12))
    assert book.failing_since is None

    _, news = look(book, T0 + timedelta(minutes=13), OK)
    assert news == []


def test_a_database_that_answers_again_behind_the_code_is_still_not_answering():
    behind = ApiStatus(database="behind", sign_ins=None)
    book, _ = run(Book(), [(T0, DOWN), (T0 + timedelta(minutes=5), DOWN)])
    book, news = look(book, T0 + timedelta(minutes=6), behind)
    assert news == []
    assert Kind.NOT_ANSWERING in book.open


# --- once a day while it lasts --------------------------------------------------------


def test_a_reminder_every_24_hours_from_the_start():
    book, _ = run(Book(), [(T0, DOWN), (T0 + timedelta(minutes=5), DOWN)])

    book, news = look(book, T0 + timedelta(hours=23, minutes=59, seconds=59), DOWN)
    assert news == []
    book, news = look(book, T0 + timedelta(hours=24), DOWN)
    [reminder] = news
    assert reminder.moment is Moment.REMINDER
    assert reminder.text == (
        "⚠️ Досі не виправлено, уже 24 год. Сервер застосунку не відповідає. "
        "Продавці зараз не можуть продавати."
    )
    book, news = look(book, T0 + timedelta(hours=24, minutes=1), DOWN)
    assert news == []
    book, news = look(book, T0 + timedelta(hours=48), DOWN)
    assert [n.text.split(".")[0] for n in news] == ["⚠️ Досі не виправлено, уже 48 год"]
    assert book.open[Kind.NOT_ANSWERING].reminders == 2


def test_days_without_a_look_owe_one_reminder_not_one_for_each_day():
    book, _ = run(Book(), [(T0, DOWN), (T0 + timedelta(minutes=5), DOWN)])
    book, news = look(book, T0 + timedelta(days=3, hours=1), DOWN)
    assert [n.moment for n in news] == [Moment.REMINDER]
    assert book.open[Kind.NOT_ANSWERING].reminders == 3


def test_a_reminder_says_the_reason_as_it_is_now():
    book, _ = run(Book(), [(T0, DOWN), (T0 + timedelta(minutes=5), DOWN)])
    database = ApiStatus(database="unreachable", sign_ins=None)
    book, news = look(book, T0 + timedelta(hours=24), database)
    assert DATABASE_SILENT in news[0].text
    assert book.open[Kind.NOT_ANSWERING].reason == DATABASE_SILENT


# --- the disk -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("free", "total", "low"),
    [
        (15 * GIB, 100 * GIB, False),  # exactly 15 %: not below
        (15 * GIB - 1, 100 * GIB, True),
        (3 * GIB, 10 * GIB, False),  # exactly 3 GiB: not below
        (3 * GIB - 1, 10 * GIB, True),
    ],
    ids=["15%", "under 15%", "3GiB", "under 3GiB"],
)
def test_a_disk_is_low_below_15_percent_or_3_gib(free, total, low):
    assert is_low(disk(free, total)) is low


@pytest.mark.parametrize(
    ("free", "total", "clear"),
    [
        (17 * GIB, 100 * GIB, True),
        (17 * GIB - 1, 100 * GIB, False),
        (4 * GIB, 20 * GIB, True),  # 20 %
        (4 * GIB - 1, 20 * GIB, False),  # 19.99 %, but under 4 GiB
        (int(3.4 * GIB), 20 * GIB, False),  # 17 %, but under 4 GiB
    ],
    ids=["17%", "under 17%", "4GiB", "under 4GiB", "17% under 4GiB"],
)
def test_a_disk_is_clear_only_with_17_percent_and_4_gib(free, total, clear):
    assert is_clear(disk(free, total)) is clear


def test_a_low_disk_is_told_at_once_naming_the_disk():
    book, news = look(Book(), T0, disks=[disk(12 * GIB + GIB // 2)])
    [start] = news
    assert (start.kind, start.moment) == (Kind.DISK_LOW, Moment.START)
    assert start.text == (
        "⚠️ На диску сервера лишилося 12,5 ГБ вільного місця (12 %). "
        "Коли місце закінчиться, застосунок і нічні копії зупиняться."
    )
    assert book.open[Kind.DISK_LOW].started_at == T0


def test_a_disk_between_the_lines_neither_starts_nor_ends_it():
    """No flapping: 16 % free does not start it, and does not end it either."""
    between = [disk(16 * GIB)]
    book, news = look(Book(), T0, disks=between)
    assert news == []

    book, _ = look(book, T0 + timedelta(minutes=1), disks=[disk(14 * GIB)])
    for minute in range(2, 30):
        book, news = look(book, T0 + timedelta(minutes=minute), disks=between)
        assert news == []
    assert Kind.DISK_LOW in book.open

    book, news = look(book, T0 + timedelta(minutes=31), disks=[disk(17 * GIB)])
    assert [(n.moment, n.text) for n in news] == [
        (Moment.AGAIN, "✅ На диску сервера знову достатньо місця. Тривало 30 хв.")
    ]


def test_the_worse_of_the_two_disks_is_named():
    backups = disk(2 * GIB, 50 * GIB, Place.BACKUPS)
    server = disk(10 * GIB, 100 * GIB, Place.SERVER)
    _, news = look(Book(), T0, disks=[server, backups])
    assert "На диску з резервними копіями лишилося 2,0 ГБ вільного місця (4 %)." in news[0].text

    roomy = disk(80 * GIB, 100 * GIB, Place.BACKUPS)
    _, news = look(Book(), T0, disks=[roomy, server])
    assert "На диску сервера лишилося 10,0 ГБ" in news[0].text


def test_it_ends_only_when_both_disks_are_clear():
    low = disk(2 * GIB, 50 * GIB, Place.BACKUPS)
    clear_server = disk(50 * GIB, 100 * GIB, Place.SERVER)
    book, _ = look(Book(), T0, disks=[low, clear_server])

    still = disk(8 * GIB, 50 * GIB, Place.BACKUPS)  # 16 %
    book, news = look(book, T0 + timedelta(minutes=1), disks=[still, clear_server])
    assert news == []
    book, news = look(
        book,
        T0 + timedelta(minutes=2),
        disks=[disk(9 * GIB, 50 * GIB, Place.BACKUPS), clear_server],
    )
    assert [n.moment for n in news] == [Moment.AGAIN]


def test_no_disk_measured_changes_nothing():
    book, _ = look(Book(), T0, disks=[disk(GIB)])
    book, news = look(book, T0 + timedelta(minutes=1), disks=[])
    assert news == []
    assert Kind.DISK_LOW in book.open


def test_the_disk_reason_rounds_down():
    assert disk_reason(disk(int(14.99 * GIB))) == (
        "На диску сервера лишилося 15,0 ГБ вільного місця (14 %)."
    )


# --- nobody can sign in ---------------------------------------------------------------


def test_sign_ins_refused_for_ten_minutes_three_times_are_told_dating_from_the_first():
    book, news = look(Book(), T0 + timedelta(minutes=9, seconds=59), refused())
    assert news == []

    book, news = look(book, T0 + timedelta(minutes=10), refused())
    [start] = news
    assert (start.kind, start.moment) == (Kind.SIGN_IN_FAILING, Moment.START)
    assert start.text == (
        "⚠️ Ніхто не може увійти в застосунок: "
        "можливо, токен бота на сервері не збігається з ботом. "
        "Продавці зараз не можуть продавати."
    )
    assert book.open[Kind.SIGN_IN_FAILING].started_at == T0


def test_sign_ins_refused_since_long_ago_are_told_once_not_reminded_at_once():
    """The watcher started long after the refusals began: a start, not a
    reminder on top of it."""
    book, news = look(Book(), T0 + timedelta(hours=30), refused(last=T0 + timedelta(hours=30)))
    assert [n.moment for n in news] == [Moment.START]
    assert book.open[Kind.SIGN_IN_FAILING].reminders == 1
    _, news = look(book, T0 + timedelta(hours=47, minutes=59), refused())
    assert news == []


def test_refusals_that_stopped_are_not_people_still_trying():
    """The owner's "while people kept trying" (2026-10-03): one burst of
    refusals and nobody since is not trouble, however long ago it began."""
    burst = refused(last=T0 + timedelta(seconds=20))
    for minutes in (10, 30, 12 * 60):
        _, news = look(Book(), T0 + timedelta(minutes=minutes), burst)
        assert news == []

    _, news = look(Book(), T0 + timedelta(minutes=14), refused(last=T0 + timedelta(minutes=9)))
    assert [n.moment for n in news] == [Moment.START]
    _, news = look(
        Book(), T0 + timedelta(minutes=14, seconds=1), refused(last=T0 + timedelta(minutes=9))
    )
    assert news == []


@pytest.mark.parametrize(
    ("senders", "reasons", "told"),
    [
        # One phone sending its stale launch again, however often.
        (1, {"expired": 30}, False),
        (1, {"signature": 30}, False),
        (2, {"expired": 30}, True),
        (2, {"signature": 3}, True),
        # Signed and dated ahead of the server: no stale phone makes that.
        (1, {"future": 3}, True),
        (1, {"future": 2, "expired": 1}, True),
        (1, {"future": 2, "expired": 2}, False),
        (1, {"expired": 2, "future": 1}, False),
    ],
    ids=[
        "one-expired",
        "one-signature",
        "two-expired",
        "two-signature",
        "one-future",
        "mostly-future",
        "future-tied",
        "mostly-expired",
    ],
)
def test_one_person_refused_is_not_nobody_signing_in_unless_dated_ahead(senders, reasons, told):
    seen = refused(failures=sum(reasons.values()), senders=senders, **reasons)
    _, news = look(Book(), T0 + timedelta(minutes=10), seen)
    assert bool(news) is told


@pytest.mark.parametrize(
    "last_success_at",
    [T0, T0 + timedelta(minutes=1)],
    ids=["same-second", "clock-stepped-back"],
)
def test_refusals_after_a_success_start_it_whatever_the_times_say(last_success_at):
    """The API clears `failing_since` at a success, so it being set is the
    signal: times cut to whole seconds can be equal, and a server clock
    stepped back dates the refusals before the success."""
    seen = refused(last_success_at=last_success_at)
    book, news = look(Book(), T0 + timedelta(minutes=10), seen)
    assert [n.moment for n in news] == [Moment.START]

    book, news = look(book, T0 + timedelta(minutes=11), seen)
    assert news == []
    assert Kind.SIGN_IN_FAILING in book.open


def test_two_refusals_are_not_trouble_however_long_ago():
    _, news = look(Book(), T0 + timedelta(hours=3), refused(failures=2))
    assert news == []


def test_a_success_after_the_refusals_is_not_trouble():
    succeeded = refused(since=None, failures=0, last_success_at=T0 + timedelta(minutes=1))
    _, news = look(Book(), T0 + timedelta(hours=1), succeeded)
    assert news == []


@pytest.mark.parametrize(
    ("reasons", "said"),
    [
        ({"expired": 2, "future": 2, "signature": 3}, CLOCK_WRONG),
        ({"future": 4}, CLOCK_WRONG),
        ({"signature": 5, "expired": 1}, TOKEN_WRONG),
        ({"expired": 2, "signature": 2}, SIGN_IN_REFUSED),
        ({"malformed": 9, "signature": 1}, SIGN_IN_REFUSED),
        ({}, SIGN_IN_REFUSED),
    ],
    ids=["clock", "future", "token", "tie", "malformed", "none"],
)
def test_the_commonest_reason_names_the_cause(reasons, said):
    sign_ins = SignIns(last_success_at=None, failing_since=T0, failures=9, reasons=reasons)
    assert sign_in_reason(sign_ins) == said


def test_the_spelled_out_sign_in_reasons():
    assert CLOCK_WRONG == (
        "Ніхто не може увійти в застосунок: схоже, на сервері неправильний годинник."
    )
    # A possibility: a forged launch looks the same as a wrong token's.
    assert TOKEN_WRONG == (
        "Ніхто не може увійти в застосунок: можливо, токен бота на сервері не збігається з ботом."
    )
    assert SIGN_IN_REFUSED == "Ніхто не може увійти в застосунок."


def test_it_works_again_when_a_sign_in_succeeds():
    book, _ = look(Book(), T0 + timedelta(minutes=10), refused())
    book, news = look(
        book, T0 + timedelta(minutes=40), refused(since=None, failures=0, last_success_at=T0)
    )
    assert [(n.moment, n.text) for n in news] == [
        (Moment.AGAIN, "✅ Вхід у застосунок знову працює. Тривало 40 хв.")
    ]


def test_a_restarted_api_that_nobody_has_tried_since_ends_nothing():
    """A restart that fixed nothing (the evening `up -d`, a wrong clock) is
    no recovery: it is open until a sign-in succeeds."""
    book, _ = look(Book(), T0 + timedelta(minutes=10), refused())
    book, news = look(book, T0 + timedelta(minutes=11), RESTARTED)
    assert news == []
    assert book.open[Kind.SIGN_IN_FAILING].started_at == T0

    book, news = look(
        book,
        T0 + timedelta(minutes=30),
        refused(since=None, failures=0, last_success_at=T0 + timedelta(minutes=25)),
    )
    assert [(n.moment, n.text) for n in news] == [
        (Moment.AGAIN, "✅ Вхід у застосунок знову працює. Тривало 30 хв.")
    ]


def test_refusals_counted_again_after_a_restart_keep_it_open_with_their_reason():
    book, _ = look(Book(), T0 + timedelta(minutes=10), refused())
    book, news = look(book, T0 + timedelta(minutes=11), RESTARTED)
    later = refused(since=T0 + timedelta(minutes=20), last=T0 + timedelta(hours=24), expired=5)
    book, news = look(book, T0 + timedelta(hours=24), later)
    assert [n.moment for n in news] == [Moment.REMINDER]
    assert book.open[Kind.SIGN_IN_FAILING].reason == CLOCK_WRONG


def test_an_api_that_does_not_answer_says_nothing_about_sign_ins():
    book, _ = look(Book(), T0 + timedelta(minutes=10), refused())
    book, news = look(book, T0 + timedelta(minutes=11), DOWN)
    assert news == []
    assert Kind.SIGN_IN_FAILING in book.open
    book, news = look(book, T0 + timedelta(minutes=12), ApiStatus("ok", None))
    assert news == []
    assert Kind.SIGN_IN_FAILING in book.open


# --- the sound ------------------------------------------------------------------------


def kyiv(hour: int, minute: int = 0, second: int = 0, day: int = 3, month: int = 10) -> datetime:
    return datetime(2026, month, day, hour, minute, second, tzinfo=KYIV).astimezone(UTC)


@pytest.mark.parametrize(
    ("moment", "sound"),
    [
        (kyiv(8, 59, 59), False),
        (kyiv(9, 0), True),
        (kyiv(13, 30), True),
        (kyiv(19, 59, 59), True),
        (kyiv(20, 0), False),
        (kyiv(3, 0), False),
        # Winter time: Kyiv is UTC+2, not UTC+3.
        (kyiv(9, 0, day=15, month=12), True),
        (kyiv(8, 59, 59, day=15, month=12), False),
        (kyiv(20, 0, day=15, month=12), False),
    ],
)
def test_with_a_sound_from_nine_to_twenty_in_kyiv(moment, sound):
    assert with_sound(moment) is sound


# --- words ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("span", "said"),
    [
        (timedelta(seconds=59), "менше хвилини"),
        (timedelta(minutes=7, seconds=30), "7 хв"),
        (timedelta(minutes=65), "1 год 5 хв"),
        (timedelta(hours=2), "2 год"),
        (timedelta(days=2, hours=3), "51 год"),
    ],
)
def test_how_long_it_lasted(span, said):
    assert duration(span) == said


def test_each_kind_says_what_the_sellers_feel():
    assert start_text(Kind.SIGN_IN_FAILING, CLOCK_WRONG).endswith(
        "Продавці зараз не можуть продавати."
    )
    assert reminder_text(Kind.DISK_LOW, "x", timedelta(hours=25)) == (
        "⚠️ Досі не виправлено, уже 25 год. x "
        "Коли місце закінчиться, застосунок і нічні копії зупиняться."
    )
    assert again_text(Kind.SIGN_IN_FAILING, timedelta(minutes=3)) == (
        "✅ Вхід у застосунок знову працює. Тривало 3 хв."
    )


# --- what the API says ----------------------------------------------------------------


def test_the_status_is_read_as_the_api_writes_it():
    status = api_status(
        {
            "started_at": "2026-10-03T10:00:00+00:00",
            "release": "abc1234",
            "database": "ok",
            "sign_ins": {
                "last_success_at": None,
                "failing_since": "2026-10-03T10:05:00+00:00",
                "last_failure_at": "2026-10-03T10:12:00+00:00",
                "failures": 4,
                "senders": 2,
                "reasons": {"expired": 1, "future": 0, "signature": 3, "malformed": 0},
            },
        }
    )
    assert status == ApiStatus(
        database="ok",
        sign_ins=SignIns(
            last_success_at=None,
            failing_since=datetime(2026, 10, 3, 10, 5, tzinfo=UTC),
            failures=4,
            reasons={"expired": 1, "future": 0, "signature": 3, "malformed": 0},
            last_failure_at=datetime(2026, 10, 3, 10, 12, tzinfo=UTC),
            senders=2,
        ),
    )


def test_a_status_that_is_not_one_counts_as_no_answer():
    assert api_status(["ok"]) is None
    assert api_status("ok") is None
    assert api_status(None) is None


def test_odd_fields_conclude_nothing_wrong():
    status = api_status(
        {
            "database": 1,
            "sign_ins": {
                "failing_since": "yesterday",
                "last_success_at": "2026-10-03T10:00:00",
                "last_failure_at": 5,
                "failures": True,
                "senders": -2,
                "reasons": "many",
            },
        }
    )
    assert status is not None
    assert status.database == ""
    assert status.sign_ins == SignIns(
        last_success_at=datetime(2026, 10, 3, 10, 0, tzinfo=UTC),
        failing_since=None,
        failures=0,
        reasons={},
    )
    assert api_status({"database": "ok"}) == ApiStatus(database="ok", sign_ins=None)


# --- the book and the database --------------------------------------------------------


def open_incident(**changes) -> Incident:
    values = {
        "kind": Kind.DISK_LOW,
        "reason": "На диску сервера лишилося 1,0 ГБ вільного місця (1 %).",
        "started_at": T0,
        "told_at": T0,
        "row": uuid.uuid4(),
    }
    values.update(changes)
    return Incident(**values)


def test_each_trouble_has_its_own_row_from_its_start_to_its_end():
    """Chosen before it is first written, so a write repeated after its
    confirmation was lost rewrites that row (`server.keep`)."""
    book, _ = look(Book(), T0, DOWN, disks=[disk(GIB)])
    book, _ = look(book, T0 + timedelta(minutes=5), DOWN, disks=[disk(GIB)])
    rows = {kind: incident.row for kind, incident in book.open.items()}
    assert set(rows) == {Kind.DISK_LOW, Kind.NOT_ANSWERING}
    assert None not in rows.values()
    assert len(set(rows.values())) == 2

    book, _ = look(book, T0 + timedelta(minutes=6), OK, disks=[disk(50 * GIB)])
    assert {incident.kind: incident.row for incident in book.ended} == rows


def test_an_open_incident_read_back_after_a_restart_is_not_told_again():
    stored = open_incident()
    book, news = adopt(Book(), stored, T0 + timedelta(hours=1))
    assert news == []
    assert book.open[Kind.DISK_LOW] == stored

    book, news = look(book, T0 + timedelta(hours=2), disks=[disk(GIB)])
    assert news == []
    book, news = look(book, T0 + timedelta(hours=3), disks=[disk(50 * GIB)])
    assert [n.moment for n in news] == [Moment.AGAIN]


def test_an_open_incident_nobody_heard_of_is_told_when_read_back():
    stored = open_incident(told_at=None)
    _, news = adopt(Book(), stored, T0 + timedelta(hours=1))
    assert [(n.moment, n.text) for n in news] == [
        (Moment.START, start_text(Kind.DISK_LOW, stored.reason))
    ]


def test_an_incident_the_book_already_holds_is_not_taken_in_twice():
    book, _ = look(Book(), T0, disks=[disk(GIB)])
    same, news = adopt(book, open_incident(started_at=T0 - timedelta(hours=1)), T0)
    assert same is book
    assert news == []


def test_one_trouble_noticed_twice_began_when_it_was_first_seen():
    stored = open_incident(
        started_at=T0 - timedelta(hours=2), told_at=T0 - timedelta(hours=2), reminders=1
    )
    remembered = Incident(
        kind=Kind.DISK_LOW,
        reason="new",
        started_at=T0,
        told_at=T0 + timedelta(minutes=1),
        ended_at=T0 + timedelta(minutes=30),
    )
    one = merged(remembered, stored)
    assert one == Incident(
        kind=Kind.DISK_LOW,
        reason="new",
        started_at=T0 - timedelta(hours=2),
        told_at=T0 - timedelta(hours=2),
        reminders=1,
        ended_at=T0 + timedelta(minutes=30),
        row=stored.row,
    )
    nobody = merged(replace_told(remembered, None), replace_told(stored, None))
    assert nobody.told_at is None


def replace_told(incident: Incident, told_at: datetime | None) -> Incident:
    return replace(incident, told_at=told_at)


def test_the_first_chat_reached_marks_the_start_told_once():
    book, _ = look(Book(), T0, disks=[disk(GIB)])
    book = told(book, Kind.DISK_LOW, T0 + timedelta(minutes=1))
    book = told(book, Kind.DISK_LOW, T0 + timedelta(minutes=2))
    assert book.open[Kind.DISK_LOW].told_at == T0 + timedelta(minutes=1)

    # It ended before the start reached anyone.
    book, _ = look(Book(), T0, disks=[disk(GIB)])
    book, _ = look(book, T0 + timedelta(minutes=1), disks=[disk(50 * GIB)])
    book = told(book, Kind.DISK_LOW, T0 + timedelta(minutes=2))
    assert book.ended[-1].told_at == T0 + timedelta(minutes=2)
    assert told(book, Kind.NOT_ANSWERING, T0) == book


def test_kinds_are_independent():
    book, news = look(Book(), T0, DOWN, disks=[disk(GIB)])
    assert [n.kind for n in news] == [Kind.DISK_LOW]
    book, news = look(book, T0 + timedelta(minutes=5), DOWN, disks=[disk(GIB)])
    assert [n.kind for n in news] == [Kind.NOT_ANSWERING]
    book, news = look(book, T0 + timedelta(minutes=6), OK, disks=[disk(GIB)])
    assert [(n.kind, n.moment) for n in news] == [(Kind.NOT_ANSWERING, Moment.AGAIN)]
    assert set(book.open) == {Kind.DISK_LOW}
