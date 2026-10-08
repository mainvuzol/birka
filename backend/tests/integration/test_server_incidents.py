"""Trouble on the server, kept in PostgreSQL (owner decision, 2026-10-03,
"failures are visible").

"A message once when trouble starts, once a day while it lasts, and once when
it works again" — and a watcher that restarts must not say it again. The
database may be down exactly when there is trouble, so the watcher keeps its
book in memory and writes it, with the true times, when the database is
back. Telegram, the API and the disks are played by the test.

Each test runs in a database of its own: who is told is everyone holding
`backup:view` organization-wide in any organization.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime, timedelta

import pytest
from scripts.backup_watch import Watcher, watch
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.backups.incidents import (
    GIB,
    ApiStatus,
    Book,
    Disk,
    Kind,
    Place,
    Signals,
    SignIns,
    api_status,
    not_answering,
    step,
)
from app.modules.backups.models import ServerIncident, ServerWatch
from app.modules.backups.server import keep
from tests.conftest import TEST_BOT_TOKEN, requires_database
from tests.integration.test_backup_alerts import person
from tests.integration.test_product_lifecycle_api import api
from tests.integration.test_size_spelling_migration import _rows
from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

pytestmark = [pytest.mark.integration, requires_database()]

T0 = datetime(2026, 10, 3, 7, 0, tzinfo=UTC)  # 10:00 in Kyiv
ADMIN = 900_000_001
BEFORE = "0033_session_epoch"
INCIDENTS = "0034_server_incidents"

Maker = async_sessionmaker[AsyncSession]

LOW = [Disk(Place.SERVER, GIB, 100 * GIB)]
ROOMY = [Disk(Place.SERVER, 60 * GIB, 100 * GIB)]
DATABASE_DOWN = ApiStatus(database="unreachable", sign_ins=None)
OK = ApiStatus(database="ok", sign_ins=None)


@pytest.fixture
async def maker() -> AsyncIterator[Maker]:
    name = f"birka_server_watch_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = create_async_engine(_url_for(name), poolclass=NullPool)
    try:
        await _run(_alembic(name), "upgrade", "head", database=name)
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@pytest.fixture
async def unreachable() -> AsyncIterator[Maker]:
    """A database that refuses every connection, as one that has stopped."""
    engine = create_async_engine(
        "postgresql+asyncpg://birka_review@127.0.0.1:1/birka", poolclass=NullPool
    )
    try:
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()


class Telegram:
    def __init__(self) -> None:
        self.sent: list[tuple[int, str, bool]] = []

    async def __call__(self, chat: int, text: str, silent: bool) -> None:
        self.sent.append((chat, text, silent))

    def texts(self) -> list[str]:
        return [text for _, text, _ in self.sent]


class Seen:
    """What the API says and what the disks hold, as the test sets them."""

    def __init__(self, api: ApiStatus | None = OK, disks: Sequence[Disk] = ROOMY) -> None:
        self.api = api
        self.disks = list(disks)

    async def status(self) -> ApiStatus | None:
        return self.api

    def measure(self) -> list[Disk]:
        return self.disks


def watcher(maker: Maker, telegram: Telegram, seen: Seen) -> Watcher:
    return Watcher(
        maker, tell=telegram, read_status=seen.status, measure=seen.measure, admins=[ADMIN]
    )


async def incidents(maker: Maker) -> list[ServerIncident]:
    async with maker() as session:
        return list(
            (
                await session.scalars(select(ServerIncident).order_by(ServerIncident.started_at))
            ).all()
        )


async def looked_at(maker: Maker) -> datetime | None:
    async with maker() as session:
        return await session.scalar(select(ServerWatch.looked_at))


async def test_trouble_is_kept_and_a_restart_does_not_tell_it_again(maker):
    owner = await person(maker)
    telegram = Telegram()
    seen = Seen(disks=LOW)
    first = watcher(maker, telegram, seen)
    await first.remember(T0)

    await first.look_at_server(T0)

    start = (
        "⚠️ На диску сервера лишилося 1,0 ГБ вільного місця (1 %). "
        "Коли місце закінчиться, застосунок і нічні копії зупиняться."
    )
    # The owner and the administrator, each once, with a sound at 10:00 in Kyiv.
    assert sorted(telegram.sent) == sorted([(owner.chat, start, False), (ADMIN, start, False)])
    [kept] = await incidents(maker)
    assert (kept.kind, kept.reason, kept.started_at, kept.told_at, kept.ended_at) == (
        "DISK_LOW",
        "На диску сервера лишилося 1,0 ГБ вільного місця (1 %).",
        T0,
        T0,
        None,
    )
    assert await looked_at(maker) == T0

    # The watcher restarts: it reads the open trouble and says nothing new.
    telegram.sent.clear()
    again = watcher(maker, telegram, seen)
    await again.remember(T0 + timedelta(minutes=3))
    assert again.book.open[Kind.DISK_LOW].row == kept.id
    await again.look_at_server(T0 + timedelta(minutes=3))
    assert telegram.sent == []

    seen.disks = ROOMY
    await again.look_at_server(T0 + timedelta(minutes=20))
    assert set(telegram.texts()) == {"✅ На диску сервера знову достатньо місця. Тривало 20 хв."}
    assert {chat for chat, _, _ in telegram.sent} == {owner.chat, ADMIN}
    [ended] = await incidents(maker)
    assert (ended.id, ended.ended_at) == (kept.id, T0 + timedelta(minutes=20))
    assert await looked_at(maker) == T0 + timedelta(minutes=20)


async def test_a_reminder_counted_before_a_restart_is_not_repeated(maker):
    telegram = Telegram()
    seen = Seen(disks=LOW)
    first = watcher(maker, telegram, seen)
    await first.look_at_server(T0)
    await first.look_at_server(T0 + timedelta(hours=24))
    assert len(telegram.sent) == 2
    [kept] = await incidents(maker)
    assert kept.reminders == 1

    again = watcher(maker, telegram, seen)
    await again.remember(T0 + timedelta(hours=24, minutes=2))
    await again.look_at_server(T0 + timedelta(hours=24, minutes=2))
    assert len(telegram.sent) == 2
    await again.look_at_server(T0 + timedelta(hours=48))
    assert telegram.texts()[-1].startswith("⚠️ Досі не виправлено, уже 48 год.")


async def test_a_database_down_then_back_gets_the_trouble_with_its_true_start(maker, unreachable):
    """The API says its database stopped. The watcher cannot write either:
    it tells the administrator from memory and writes it all when the
    database answers again."""
    telegram = Telegram()
    seen = Seen(api=DATABASE_DOWN)
    seeing = watcher(unreachable, telegram, seen)
    await seeing.remember(T0)

    for minute in range(6):
        await seeing.look_at_server(T0 + timedelta(minutes=minute))
    assert telegram.texts() == ["⚠️ База даних не відповідає. Продавці продають на папері."]
    assert [chat for chat, _, _ in telegram.sent] == [ADMIN]

    seeing.maker = maker
    await seeing.look_at_server(T0 + timedelta(minutes=7))
    [kept] = await incidents(maker)
    assert (kept.kind, kept.started_at, kept.told_at, kept.ended_at) == (
        "NOT_ANSWERING",
        T0,
        T0 + timedelta(minutes=5),
        None,
    )
    assert await looked_at(maker) == T0 + timedelta(minutes=7)

    seen.api = OK
    await seeing.look_at_server(T0 + timedelta(minutes=9))
    [ended] = await incidents(maker)
    assert ended.ended_at == T0 + timedelta(minutes=9)


async def test_trouble_that_ended_while_the_database_was_down_is_written_whole(maker, unreachable):
    telegram = Telegram()
    seen = Seen(api=None)
    seeing = watcher(unreachable, telegram, seen)
    for minute in range(6):
        await seeing.look_at_server(T0 + timedelta(minutes=minute))
    seen.api = OK
    await seeing.look_at_server(T0 + timedelta(minutes=8))
    assert await incidents(maker) == []

    seeing.maker = maker
    await seeing.look_at_server(T0 + timedelta(minutes=9))
    [kept] = await incidents(maker)
    assert (kept.kind, kept.reason, kept.started_at, kept.ended_at) == (
        "NOT_ANSWERING",
        "Сервер застосунку не відповідає.",
        T0,
        T0 + timedelta(minutes=8),
    )
    assert seeing.book.ended == ()


async def test_a_write_whose_confirmation_was_lost_rewrites_the_rows_it_made(maker):
    """The watcher's time limit can fire after the database committed, and
    then its memory still holds the book as unwritten: the next look writes
    the same book again. A trouble that ended while the database was down is
    then no open row to be found by its kind, so it is found by its own id
    rather than written a second time."""
    book = Book()
    for minute, status in ((0, None), (5, None), (8, OK)):
        book, _ = step(book, Signals(now=T0 + timedelta(minutes=minute), api=status, disks=LOW))
    assert [incident.kind for incident in book.ended] == [Kind.NOT_ANSWERING]
    assert set(book.open) == {Kind.DISK_LOW}

    for _ in range(2):
        async with maker() as session:
            # What `keep` returns is the confirmation lost.
            await keep(session, book, now=T0 + timedelta(minutes=9), looked_at=None)
            await session.commit()

    kept = await incidents(maker)
    assert sorted((row.kind, row.started_at, row.ended_at) for row in kept) == [
        ("DISK_LOW", T0, None),
        ("NOT_ANSWERING", T0, T0 + timedelta(minutes=8)),
    ]
    assert {row.id for row in kept} == {
        book.open[Kind.DISK_LOW].row,
        book.ended[0].row,
    }


async def test_a_watcher_restarted_while_the_database_was_down_keeps_one_trouble(
    maker, unreachable
):
    """It noticed the disk again, and could only tell the administrator; once
    the database answers, it is the trouble already written, which began
    when it was first seen."""
    telegram = Telegram()
    seen = Seen(disks=LOW)
    first = watcher(maker, telegram, seen)
    await first.look_at_server(T0 - timedelta(hours=2))
    [before] = await incidents(maker)

    telegram.sent.clear()
    restarted = watcher(unreachable, telegram, seen)
    await restarted.remember(T0)
    await restarted.look_at_server(T0)
    assert [chat for chat, _, _ in telegram.sent] == [ADMIN]

    restarted.maker = maker
    await restarted.look_at_server(T0 + timedelta(minutes=1))
    [after] = await incidents(maker)
    assert (after.id, after.started_at, after.told_at, after.ended_at) == (
        before.id,
        T0 - timedelta(hours=2),
        T0 - timedelta(hours=2),
        None,
    )
    assert restarted.book.open[Kind.DISK_LOW].started_at == T0 - timedelta(hours=2)


async def test_an_open_trouble_nobody_heard_of_is_told_after_a_restart(maker):
    async with maker() as session:
        session.add(
            ServerIncident(
                kind="SIGN_IN_FAILING",
                reason="Ніхто не може увійти в застосунок.",
                started_at=T0 - timedelta(minutes=30),
            )
        )
        await session.commit()
    telegram = Telegram()
    refused = ApiStatus(
        database="ok",
        sign_ins=None,  # the API restarted and says nothing either way
    )
    seeing = watcher(maker, telegram, Seen(api=refused))

    await seeing.remember(T0)
    await seeing.look_at_server(T0)

    assert telegram.texts() == [
        "⚠️ Ніхто не може увійти в застосунок. Хто ще не увійшов, продає на папері."
    ]
    [kept] = await incidents(maker)
    assert kept.told_at == T0


async def test_one_open_trouble_of_each_kind(maker):
    async with maker() as session:
        session.add_all(
            [
                ServerIncident(kind="DISK_LOW", reason="a", started_at=T0),
                ServerIncident(
                    kind="DISK_LOW", reason="b", started_at=T0, ended_at=T0 + timedelta(hours=1)
                ),
                ServerIncident(kind="NOT_ANSWERING", reason="c", started_at=T0),
            ]
        )
        await session.commit()
    async with maker() as session:
        session.add(ServerIncident(kind="DISK_LOW", reason="d", started_at=T0))
        with pytest.raises(IntegrityError, match="uq_server_incident_open_kind"):
            await session.commit()
    async with maker() as session:
        session.add(ServerIncident(kind="MEMORY_LOW", reason="e", started_at=T0))
        with pytest.raises(IntegrityError, match="kind_known"):
            await session.commit()
    async with maker() as session:
        session.add(ServerWatch(id=2, looked_at=T0))
        with pytest.raises(IntegrityError, match="one_row"):
            await session.commit()


async def test_the_section_shows_when_the_watcher_looked_and_the_trouble(maker):
    owner = await person(maker)
    now = datetime.now(UTC)
    async with maker() as session:
        session.add(ServerWatch(id=1, looked_at=now - timedelta(seconds=30)))
        session.add_all(
            [
                ServerIncident(
                    kind="SIGN_IN_FAILING",
                    reason="Ніхто не може увійти в застосунок.",
                    started_at=now - timedelta(minutes=20),
                ),
                ServerIncident(
                    kind="DISK_LOW",
                    reason="На диску сервера лишилося 1,0 ГБ вільного місця (1 %).",
                    started_at=now - timedelta(hours=3),
                    told_at=now - timedelta(hours=3),
                ),
            ]
        )
        # Twelve in the last week, two a day: the section shows the newest ten.
        for half_day in range(12):
            session.add(
                ServerIncident(
                    kind="NOT_ANSWERING",
                    reason="Сервер застосунку не відповідає.",
                    started_at=now - timedelta(hours=12 * half_day + 1),
                    ended_at=now - timedelta(hours=12 * half_day, minutes=30),
                )
            )
        session.add(
            ServerIncident(
                kind="NOT_ANSWERING",
                reason="База даних не відповідає.",
                started_at=now - timedelta(days=8),
                ended_at=now - timedelta(days=7, minutes=1),
            )
        )
        await session.commit()
    scope = RequestScope(
        user_id=owner.user_id,
        organization_id=owner.organization_id,
        org_permissions=frozenset({Permission.BACKUP_VIEW}),
        store_permissions={owner.store_id: frozenset()},
    )

    async with api(maker, scope) as client:
        opened = await client.get("/api/v1/backups")

    assert opened.status_code == 200, opened.text
    server = opened.json()["server"]
    assert datetime.fromisoformat(server["looked_at"]) == now - timedelta(seconds=30)
    assert [(t["kind"], t["told_at"] is None) for t in server["open"]] == [
        ("DISK_LOW", False),
        ("SIGN_IN_FAILING", True),
    ]
    assert set(server["open"][0]) == {"kind", "reason", "started_at", "told_at"}
    assert server["open"][0]["reason"] == "На диску сервера лишилося 1,0 ГБ вільного місця (1 %)."
    recent = server["recent"]
    assert len(recent) == 10
    assert set(recent[0]) == {"kind", "reason", "started_at", "ended_at"}
    ends = [datetime.fromisoformat(t["ended_at"]) for t in recent]
    assert ends == sorted(ends, reverse=True)
    assert ends[0] == now - timedelta(minutes=30)
    assert "База даних не відповідає." not in {t["reason"] for t in recent}


async def test_the_section_before_the_watcher_ever_looked(maker):
    owner = await person(maker)
    scope = RequestScope(
        user_id=owner.user_id,
        organization_id=owner.organization_id,
        org_permissions=frozenset({Permission.BACKUP_VIEW}),
        store_permissions={owner.store_id: frozenset()},
    )
    async with api(maker, scope) as client:
        body = (await client.get("/api/v1/backups")).json()
    assert body["server"] == {"looked_at": None, "open": [], "recent": []}


async def test_the_watcher_looks_at_once_and_stops_when_told(maker):
    """What the `backup-watch` service runs: it looks at the server as it
    starts, records the look, and stops at once when Docker stops it — not
    after a look's time limit."""
    url = maker.kw["bind"].url.render_as_string(hide_password=False)
    settings = Settings(
        _env_file=None,
        database_url=url,
        telegram_bot_token=TEST_BOT_TOKEN,
        api_url="http://127.0.0.1:1",
        admin_telegram_ids=[],
    )
    stop = asyncio.Event()
    running = asyncio.create_task(watch(settings, 600, stop=stop))
    try:
        for _ in range(100):
            if await looked_at(maker) is not None:
                break
            await asyncio.sleep(0.1)
        assert await looked_at(maker) is not None
    finally:
        stop.set()
        await asyncio.wait_for(running, 5)


async def test_0034_keeps_trouble_and_goes_down_and_up_again():
    """Both tables start empty; down, they go; up again, they are back."""
    name = f"birka_incidents_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    config = _alembic(name)

    async def tables() -> list[tuple[str]]:
        return await _rows(
            name,
            "SELECT table_name FROM information_schema.tables"
            " WHERE table_name IN ('server_incident', 'server_watch') ORDER BY table_name",
        )

    async def version() -> str:
        [(found,)] = await _rows(name, "SELECT version_num FROM alembic_version")
        return found

    try:
        await _run(config, "upgrade", BEFORE, database=name)
        assert await tables() == []

        await _run(config, "upgrade", INCIDENTS, database=name)
        assert (await version(), await tables()) == (
            INCIDENTS,
            [("server_incident",), ("server_watch",)],
        )
        assert await _rows(name, "SELECT count(*) FROM server_incident") == [(0,)]
        [(definition,)] = await _rows(
            name,
            "SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_server_incident_open_kind'",
        )
        assert "UNIQUE" in definition
        assert "WHERE (ended_at IS NULL)" in definition

        await _run(config, "downgrade", BEFORE, database=name)
        assert (await version(), await tables()) == (BEFORE, [])

        await _run(config, "upgrade", INCIDENTS, database=name)
        assert await tables() == [("server_incident",), ("server_watch",)]
    finally:
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def test_owners_are_read_from_whoever_hears_about_backups(maker):
    """The owner here means "the people who hear about backups" (2026-10-03):
    a manager is not told."""
    owner = await person(maker)
    await person(maker, DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER])
    seeing = watcher(maker, Telegram(), Seen())

    await seeing.remember(T0)

    assert seeing.owners == frozenset({owner.chat})
    assert seeing.owners_known is True
    # Reading is not a look: nothing is recorded as looked at.
    assert await looked_at(maker) is None


async def test_the_apis_own_status_is_read_as_everything_answering(maker):
    """Contract C2, end to end: what the API writes, the watcher reads — a
    database that answers at head, and nobody refused."""
    owner = await person(maker)
    scope = RequestScope(
        user_id=owner.user_id,
        organization_id=owner.organization_id,
        org_permissions=frozenset(),
        store_permissions={},
    )
    async with api(maker, scope) as client:
        answered = await client.get("/internal/status")

    assert answered.status_code == 200, answered.text
    found = api_status(answered.json())
    assert found == ApiStatus(
        database="ok",
        sign_ins=SignIns(
            last_success_at=None,
            failing_since=None,
            failures=0,
            reasons={"expired": 0, "future": 0, "signature": 0, "malformed": 0},
            last_failure_at=None,
            senders=0,
        ),
    )
    assert set(answered.json()["sign_ins"]) == {
        "last_success_at",
        "failing_since",
        "last_failure_at",
        "failures",
        "senders",
        "reasons",
    }
    assert not_answering(found) is None
