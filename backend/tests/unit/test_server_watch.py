"""The watcher's look at the server, with Telegram, the API and the disks
played by the test (owner decision, 2026-10-03, "failures are visible").

The database is down in every test here — exactly when the watcher must
still speak — so only the administrators, whose ids are in the settings, can
be told until the owners are known. (In one, it answers but has no
`server_incident` table.) What is kept in the database is proven
against PostgreSQL in `tests/integration/test_server_incidents.py`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import aiohttp
import pytest
from aiohttp import web
from multidict import CIMultiDict, CIMultiDictProxy
from scripts import backup_watch
from scripts.backup_watch import (
    KEEP_UNSENT,
    REFUSED_FOR,
    Watcher,
    every,
    measure_disks,
    ping,
    purge_idempotency,
    read_status,
)
from structlog.testing import capture_logs
from yarl import URL

from app.modules.backups.incidents import GIB, ApiStatus, Disk, Kind, Moment, Place, SignIns
from app.modules.telegram.messages import BotTokenRefusedError, UndeliverableError

DAY = datetime(2026, 10, 3, 7, 0, tzinfo=UTC)  # 10:00 in Kyiv
NIGHT = datetime(2026, 10, 3, 19, 0, tzinfo=UTC)  # 22:00 in Kyiv
ADMIN, OTHER_ADMIN, OWNER = 111, 222, 333
OK = ApiStatus(database="ok", sign_ins=None)


class DatabaseDown:
    """A session maker whose database does not answer."""

    def __init__(self) -> None:
        self.asked = 0

    def __call__(self) -> DatabaseDown:
        self.asked += 1
        return self

    async def __aenter__(self) -> Any:
        raise ConnectionRefusedError("the database is down")

    async def __aexit__(self, *exc: object) -> bool:
        return False


class Telegram:
    """Records what it is given, or fails as told."""

    def __init__(self) -> None:
        self.sent: list[tuple[int, str, bool]] = []
        self.refuse: dict[int, Exception] = {}
        self.down: Exception | None = None
        self.tried = 0

    async def __call__(self, chat: int, text: str, silent: bool) -> None:
        self.tried += 1
        if self.down is not None:
            raise self.down
        if chat in self.refuse:
            raise self.refuse[chat]
        self.sent.append((chat, text, silent))

    def chats(self) -> list[int]:
        return [chat for chat, _, _ in self.sent]


class Api:
    def __init__(self, answer: ApiStatus | None = OK) -> None:
        self.answer = answer

    async def __call__(self) -> ApiStatus | None:
        return self.answer


def watcher(
    telegram: Telegram,
    api: Api,
    disks: Sequence[Disk] = (),
    admins: Sequence[int] = (ADMIN, OTHER_ADMIN),
    **checks: Any,
) -> Watcher:
    return Watcher(
        DatabaseDown(),  # type: ignore[arg-type]
        tell=telegram,
        read_status=api,
        measure=lambda: list(disks),
        admins=admins,
        **checks,
    )


async def looks(seeing: Watcher, start: datetime, minutes: int) -> None:
    for minute in range(minutes + 1):
        await seeing.look_at_server(start + timedelta(minutes=minute))


async def test_trouble_reaches_each_administrator_once_with_a_sound_in_the_day():
    telegram = Telegram()
    seeing = watcher(telegram, Api(None), admins=(ADMIN, OTHER_ADMIN, ADMIN))

    await looks(seeing, DAY, 4)
    assert telegram.sent == []
    await seeing.look_at_server(DAY + timedelta(minutes=5))

    text = "⚠️ Сервер застосунку не відповідає. Продавці зараз не можуть продавати."
    assert telegram.sent == [(ADMIN, text, False), (OTHER_ADMIN, text, False)]
    assert seeing.book.open[Kind.NOT_ANSWERING].told_at == DAY + timedelta(minutes=5)
    await seeing.look_at_server(DAY + timedelta(minutes=6))
    assert len(telegram.sent) == 2


async def test_at_night_it_is_told_silently():
    telegram = Telegram()
    seeing = watcher(telegram, Api(), disks=[Disk(Place.SERVER, GIB, 100 * GIB)])

    await seeing.look_at_server(NIGHT)

    assert [silent for _, _, silent in telegram.sent] == [True, True]


async def test_a_look_with_the_database_down_still_completes():
    telegram = Telegram()
    seeing = watcher(telegram, Api(ApiStatus(database="unreachable", sign_ins=None)))

    await seeing.look_at_server(DAY)

    assert seeing.looked_at == DAY
    assert seeing.last_look_completed is True
    assert seeing.owners_known is False


async def test_telegram_unreachable_is_tried_at_every_look_and_given_up_after_a_day():
    telegram = Telegram()
    telegram.down = ConnectionError("network is unreachable")
    seeing = watcher(telegram, Api(), disks=[Disk(Place.SERVER, GIB, 100 * GIB)])
    seeing.owners_known = True

    await seeing.look_at_server(DAY)
    # One attempt per look: the rest wait rather than each waiting out a timeout.
    assert telegram.tried == 1
    assert len(seeing.outbox) == 1
    assert seeing.book.open[Kind.DISK_LOW].told_at is None

    telegram.down = None
    await seeing.look_at_server(DAY + timedelta(minutes=1))
    assert telegram.chats() == [ADMIN, OTHER_ADMIN]

    telegram.down = ConnectionError("network is unreachable")
    seeing.measure = lambda: [Disk(Place.SERVER, 60 * GIB, 100 * GIB)]
    await seeing.look_at_server(DAY + timedelta(minutes=2))
    [again] = seeing.outbox
    assert again.news.moment is Moment.AGAIN
    await seeing.look_at_server(DAY + timedelta(minutes=2) + KEEP_UNSENT - timedelta(seconds=1))
    assert len(seeing.outbox) == 1
    await seeing.look_at_server(DAY + timedelta(minutes=2) + KEEP_UNSENT)
    assert seeing.outbox == []


async def test_a_refused_bot_token_stops_the_look_and_keeps_every_message():
    telegram = Telegram()
    telegram.down = BotTokenRefusedError()
    seeing = watcher(telegram, Api(), disks=[Disk(Place.SERVER, GIB, 100 * GIB)])

    await seeing.look_at_server(DAY)

    assert telegram.tried == 1
    [waiting] = seeing.outbox
    assert waiting.reached == set()


async def test_a_chat_that_refuses_for_good_is_not_tried_again():
    telegram = Telegram()
    telegram.refuse[ADMIN] = UndeliverableError("Forbidden: bot was blocked by the user")
    seeing = watcher(telegram, Api(), disks=[Disk(Place.SERVER, GIB, 100 * GIB)])
    seeing.owners_known = True

    await seeing.look_at_server(DAY)
    await seeing.look_at_server(DAY + timedelta(minutes=1))

    assert telegram.chats() == [OTHER_ADMIN]
    assert telegram.tried == 2
    assert seeing.outbox == []


BLOCKED = UndeliverableError("Forbidden: bot was blocked by the user")


async def test_when_every_chat_refused_nobody_can_be_told_until_a_message_gets_through():
    """Every message would be lost, so the check-in stops and the outside
    service tells the owner (ADR-0011 §3: no check-in when there is nobody to
    tell)."""
    telegram = Telegram()
    telegram.refuse = {ADMIN: BLOCKED, OTHER_ADMIN: BLOCKED}
    seeing = watcher(
        telegram,
        Api(),
        disks=[Disk(Place.SERVER, GIB, 100 * GIB)],
        check_bot=Calls(),
        check_in=Calls(),
    )
    seeing.owners_known = True

    with capture_logs() as lines:
        await seeing.look_at_server(DAY)
    assert telegram.sent == []
    assert "backup_watch.nobody_to_tell" in [line["event"] for line in lines]
    assert await seeing.check_in(DAY + timedelta(minutes=1)) is False
    assert seeing.why_not_check_in(DAY + timedelta(minutes=1)) == ["nobody"]

    # One of them starts the bot again; the next message reaches them.
    del telegram.refuse[ADMIN]
    seeing.measure = lambda: [Disk(Place.SERVER, 60 * GIB, 100 * GIB)]
    await seeing.look_at_server(DAY + timedelta(minutes=2))
    assert telegram.chats() == [ADMIN]
    assert await seeing.check_in(DAY + timedelta(minutes=2)) is True


async def test_a_refusal_counts_for_a_day_and_only_when_nobody_else_can_be_told():
    telegram = Telegram()
    telegram.refuse = {ADMIN: BLOCKED}
    seeing = watcher(
        telegram,
        Api(),
        disks=[Disk(Place.SERVER, GIB, 100 * GIB)],
        check_bot=Calls(),
        check_in=Calls(),
    )
    seeing.owners_known = True

    await seeing.look_at_server(DAY)
    assert telegram.chats() == [OTHER_ADMIN]
    assert await seeing.check_in(DAY + timedelta(minutes=1)) is True

    # Were the one who refused the only one to tell:
    seeing.admins = frozenset({ADMIN})
    assert await seeing.check_in(DAY + timedelta(minutes=1)) is False
    assert seeing.why_not_check_in(DAY + timedelta(minutes=1)) == ["nobody"]
    # A person who unblocked the bot, with no message since, does not hold the
    # check-in down for longer than a day.
    almost = DAY + REFUSED_FOR - timedelta(seconds=1)
    seeing.looked_at = almost
    assert await seeing.check_in(almost) is False
    seeing.looked_at = DAY + REFUSED_FOR
    assert await seeing.check_in(DAY + REFUSED_FOR) is True


async def test_a_message_waits_for_the_owners_while_they_are_not_known():
    """A watcher restarted while the database is down knows only the
    administrators; the owners hear once the database answers, within the day."""
    telegram = Telegram()
    seeing = watcher(telegram, Api(), disks=[Disk(Place.SERVER, GIB, 100 * GIB)])

    await seeing.look_at_server(DAY)
    assert telegram.chats() == [ADMIN, OTHER_ADMIN]
    assert len(seeing.outbox) == 1

    seeing.owners, seeing.owners_known = frozenset({OWNER, ADMIN}), True
    await seeing.look_at_server(DAY + timedelta(minutes=1))
    assert telegram.chats() == [ADMIN, OTHER_ADMIN, OWNER]
    assert seeing.outbox == []


async def test_with_nobody_to_tell_nothing_is_kept():
    telegram = Telegram()
    seeing = watcher(telegram, Api(), disks=[Disk(Place.SERVER, GIB, 100 * GIB)], admins=())
    seeing.owners_known = True

    await seeing.look_at_server(DAY)

    assert telegram.tried == 0
    assert seeing.outbox == []


async def test_a_slow_telegram_is_cut_off_and_the_message_kept(monkeypatch):
    monkeypatch.setattr(backup_watch, "TELEGRAM_TIMEOUT", 0.05)

    async def hangs(chat: int, text: str, silent: bool) -> None:
        await asyncio.sleep(10)

    seeing = watcher(Telegram(), Api(), disks=[Disk(Place.SERVER, GIB, 100 * GIB)])
    seeing.tell = hangs

    await seeing.look_at_server(DAY)

    assert len(seeing.outbox) == 1
    assert seeing.last_look_completed is True


async def test_a_database_that_hangs_does_not_hold_the_look(monkeypatch):
    monkeypatch.setattr(backup_watch, "DATABASE_TIMEOUT", 0.05)

    class Hangs(DatabaseDown):
        async def __aenter__(self) -> Any:
            await asyncio.sleep(10)

    telegram = Telegram()
    seeing = watcher(telegram, Api(None))
    seeing.maker = Hangs()  # type: ignore[assignment]

    await asyncio.wait_for(seeing.look_at_server(DAY), 2)
    assert seeing.last_look_completed is True


async def test_the_owners_are_known_even_when_the_incidents_cannot_be_written(monkeypatch):
    """Migration 0034 not run: `server_incident` is missing, so writing the
    incidents fails at every look, while the owners can still be read. They
    are the ones to hear that the database is not updated."""

    class Session:
        async def __aenter__(self) -> Session:
            return self

        async def __aexit__(self, *exc: object) -> bool:
            return False

        async def commit(self) -> None:
            pass

    async def owners(session: Any) -> frozenset[int]:
        return frozenset({OWNER})

    async def no_table(session: Any, book: Any, *, now: datetime, looked_at: Any) -> Any:
        raise RuntimeError('relation "server_incident" does not exist')

    monkeypatch.setattr(backup_watch, "owner_chats", owners)
    monkeypatch.setattr(backup_watch, "keep", no_table)
    telegram = Telegram()
    seeing = watcher(telegram, Api(ApiStatus(database="behind", sign_ins=None)), admins=())
    seeing.maker = Session  # type: ignore[assignment]

    await seeing.remember(DAY)
    await looks(seeing, DAY, 5)

    assert telegram.sent == [
        (
            OWNER,
            "⚠️ База не оновлена до цієї версії застосунку: міграцію не виконано. "
            "Продавці зараз не можуть продавати.",
            False,
        )
    ]
    assert seeing.book.open[Kind.NOT_ANSWERING].told_at == DAY + timedelta(minutes=5)


async def test_sign_ins_failing_are_told_from_the_apis_count():
    telegram = Telegram()
    refused = ApiStatus(
        database="ok",
        sign_ins=SignIns(
            last_success_at=None,
            failing_since=DAY,
            failures=5,
            reasons={"expired": 5},
            last_failure_at=DAY + timedelta(minutes=9),
            senders=2,
        ),
    )
    seeing = watcher(telegram, Api(refused))

    await seeing.look_at_server(DAY + timedelta(minutes=10))

    assert {text for _, text, _ in telegram.sent} == {
        "⚠️ Ніхто не може увійти в застосунок: схоже, на сервері неправильний годинник. "
        "Продавці зараз не можуть продавати."
    }


# --- the check-in ---------------------------------------------------------------------


class Calls:
    def __init__(self, fail: Exception | None = None) -> None:
        self.fail = fail
        self.calls = 0

    async def __call__(self) -> None:
        self.calls += 1
        if self.fail is not None:
            raise self.fail


async def ready(**checks: Any) -> tuple[Watcher, Calls, Calls]:
    bot = checks.pop("bot", Calls())
    outside = checks.pop("outside", Calls())
    seeing = watcher(Telegram(), Api(), check_bot=bot, check_in=outside, **checks)
    await seeing.look_at_server(DAY)
    return seeing, bot, outside


async def test_it_checks_in_when_it_looked_the_bot_works_and_someone_can_be_told():
    seeing, bot, outside = await ready()

    assert await seeing.check_in(DAY + timedelta(minutes=1)) is True
    assert (bot.calls, outside.calls) == (1, 1)


async def test_a_refused_bot_token_withholds_the_check_in():
    seeing, _, outside = await ready(bot=Calls(BotTokenRefusedError()))

    assert await seeing.check_in(DAY + timedelta(minutes=1)) is False
    assert outside.calls == 0
    assert seeing.why_not_check_in(DAY + timedelta(minutes=1)) == ["bot"]


async def test_a_bot_that_worked_ten_minutes_ago_still_counts_but_not_longer():
    seeing, bot, outside = await ready()
    await seeing.check_in(DAY)
    bot.fail = ConnectionError("Telegram unreachable")

    seeing.looked_at = DAY + timedelta(minutes=10)
    assert await seeing.check_in(DAY + timedelta(minutes=10)) is True
    seeing.looked_at = DAY + timedelta(minutes=10, seconds=1)
    assert await seeing.check_in(DAY + timedelta(minutes=10, seconds=1)) is False
    assert outside.calls == 2


async def test_nobody_to_tell_withholds_the_check_in():
    seeing, _, outside = await ready(admins=())

    assert await seeing.check_in(DAY + timedelta(minutes=1)) is False
    assert seeing.why_not_check_in(DAY + timedelta(minutes=1)) == ["nobody"]
    assert outside.calls == 0

    seeing.owners = frozenset({OWNER})
    assert await seeing.check_in(DAY + timedelta(minutes=1)) is True


async def test_a_look_that_failed_or_is_old_withholds_the_check_in():
    seeing, _, outside = await ready()
    seeing.look_failed()
    assert await seeing.check_in(DAY + timedelta(minutes=1)) is False

    await seeing.look_at_server(DAY + timedelta(minutes=1))
    assert await seeing.check_in(DAY + timedelta(minutes=4)) is True
    assert await seeing.check_in(DAY + timedelta(minutes=4, seconds=1)) is False
    assert outside.calls == 1


async def test_a_check_in_that_fails_is_only_logged():
    seeing, _, outside = await ready(outside=Calls(ConnectionError("no route")))

    assert await seeing.check_in(DAY + timedelta(minutes=1)) is False
    assert outside.calls == 1


HEARTBEAT = URL("https://hc-ping.com/0b0b5e1c-7d2a-4f3e-9c1b-secret")


@pytest.mark.parametrize(
    ("error", "logged"),
    [
        (
            aiohttp.ClientResponseError(
                aiohttp.RequestInfo(HEARTBEAT, "GET", CIMultiDictProxy(CIMultiDict()), HEARTBEAT),
                (),
                status=404,
                message="Not Found",
            ),
            {"status": 404},
        ),
        (aiohttp.InvalidURL(str(HEARTBEAT)), {"error": "InvalidURL"}),
    ],
)
async def test_a_failed_check_in_is_logged_without_its_address(
    error: Exception, logged: dict[str, object]
) -> None:
    """The check-in's address is its secret (the runbook keeps it in .env),
    and aiohttp repeats it in the error's text."""
    assert HEARTBEAT.path in str(error)
    seeing, _, _ = await ready(outside=Calls(error))

    with capture_logs() as lines:
        assert await seeing.check_in(DAY + timedelta(minutes=1)) is False

    [failed] = [line for line in lines if line["event"] == "backup_watch.check_in_failed"]
    assert {key: failed[key] for key in logged} == logged
    assert "0b0b5e1c" not in repr(lines)


# --- looks under a time limit ---------------------------------------------------------


async def test_a_look_that_hangs_is_cut_off_and_counted_failed(monkeypatch):
    captured: list[object] = []
    monkeypatch.setattr(backup_watch.sentry_sdk, "capture_exception", lambda: captured.append(1))
    stop = asyncio.Event()
    failures: list[str] = []
    runs = 0

    async def hangs(now: datetime) -> None:
        nonlocal runs
        runs += 1
        if runs == 2:
            stop.set()
        await asyncio.sleep(10)

    await asyncio.wait_for(
        every("server", 0.01, 0.05, hangs, stop, failed=lambda: failures.append("x")), 2
    )

    assert runs == 2
    assert failures == ["x", "x"]
    assert len(captured) == 2


async def test_a_look_that_fails_is_sent_to_sentry_and_the_next_one_runs(monkeypatch):
    captured: list[object] = []
    monkeypatch.setattr(backup_watch.sentry_sdk, "capture_exception", lambda: captured.append(1))
    stop = asyncio.Event()
    runs = 0

    async def fails(now: datetime) -> None:
        nonlocal runs
        runs += 1
        if runs == 3:
            stop.set()
        raise RuntimeError("boom")

    await asyncio.wait_for(every("backups", 0.01, 1, fails, stop), 2)

    assert runs == 3
    assert len(captured) == 3


async def test_the_first_run_can_wait_and_a_stop_ends_the_wait():
    stop = asyncio.Event()
    runs = 0

    async def job(now: datetime) -> None:
        nonlocal runs
        runs += 1

    stop.set()
    await asyncio.wait_for(every("check_in", 0.01, 1, job, stop, first_after=10), 1)
    assert runs == 0


# --- the API, the outside service, the disks ------------------------------------------


async def serve(handler: Any) -> tuple[web.AppRunner, str]:
    app = web.Application()
    app.router.add_get("/{tail:.*}", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = runner.addresses[0][1]
    return runner, f"http://127.0.0.1:{port}"


async def test_the_status_is_read_from_the_api_on_its_internal_path():
    paths: list[str] = []

    async def status(request: web.Request) -> web.Response:
        paths.append(request.path)
        return web.json_response(
            {
                "started_at": "2026-10-03T10:00:00+00:00",
                "release": "abc1234",
                "database": "behind",
                "sign_ins": {
                    "last_success_at": None,
                    "failing_since": None,
                    "failures": 0,
                    "reasons": {},
                },
            }
        )

    runner, url = await serve(status)
    try:
        found = await read_status(url + "/")
    finally:
        await runner.cleanup()
    assert paths == ["/internal/status"]
    assert found == ApiStatus(
        database="behind",
        sign_ins=SignIns(last_success_at=None, failing_since=None, failures=0, reasons={}),
    )


@pytest.mark.parametrize("answer", ["503", "garbage", "list", "slow"])
async def test_an_api_that_does_not_answer_properly_counts_as_not_answering(answer):
    async def status(request: web.Request) -> web.Response:
        if answer == "503":
            return web.json_response({"database": "ok"}, status=503)
        if answer == "garbage":
            return web.Response(text="<html>bad gateway</html>")
        if answer == "slow":
            await asyncio.sleep(1)
        return web.json_response(["ok"])

    runner, url = await serve(status)
    try:
        assert await read_status(url, timeout=0.2) is None
    finally:
        await runner.cleanup()


async def test_an_api_that_is_not_there_counts_as_not_answering():
    async def nothing(request: web.Request) -> web.Response:
        return web.Response()

    runner, url = await serve(nothing)
    await runner.cleanup()
    assert await read_status(url, timeout=1) is None


async def test_the_check_in_is_a_plain_get_that_must_succeed():
    seen: list[tuple[str, str]] = []

    async def outside(request: web.Request) -> web.Response:
        seen.append((request.method, request.path_qs))
        return web.Response(status=500 if request.path == "/down" else 200)

    runner, url = await serve(outside)
    try:
        await ping(url + "/ping/abc")
        with pytest.raises(Exception, match="500"):
            await ping(url + "/down")
    finally:
        await runner.cleanup()
    assert seen == [("GET", "/ping/abc"), ("GET", "/down")]


def test_only_the_disks_that_exist_are_measured(tmp_path: Path):
    found = measure_disks(
        ((Place.BACKUPS, str(tmp_path / "absent")), (Place.SERVER, str(tmp_path)))
    )
    [server] = found
    assert server.place is Place.SERVER
    assert 0 < server.free <= server.total


# --- expired idempotency records ------------------------------------------------------


async def test_expired_idempotency_records_are_purged_and_counted():
    seen: list[datetime] = []

    class Session:
        committed = False

        async def __aenter__(self) -> Session:
            return self

        async def __aexit__(self, *exc: object) -> bool:
            return False

        async def commit(self) -> None:
            self.committed = True

    session = Session()

    async def purge(given: Any, *, now: datetime) -> int:
        assert given is session
        seen.append(now)
        return 1234

    deleted = await purge_idempotency(lambda: session, DAY, purge)  # type: ignore[arg-type]

    assert deleted == 1234
    assert seen == [DAY]
    assert session.committed
