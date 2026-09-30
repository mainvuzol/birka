"""The owner hears about the server's backups (M1-028, owner decision 2026-09-30).

"A failed backup or drill is shown to the owner in the app, in a «Резервні
копії» section only the owner sees, and sent by the bot in Telegram."

Each test runs in a database of its own: the backup tables describe the whole
server, and who is told is everyone holding `backup:view` organization-wide
in any organization — which, in the shared test database, would be every
owner every other test ever made.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from scripts.backup_watch import look, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings
from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.backups.models import AlertKind, AlertStatus, BackupAlert, BackupRun
from app.modules.backups.service import MAX_ATTEMPTS, deliver, overview, queue_alerts, record_night
from app.modules.backups.status import DUE, State
from app.modules.identity.models import AppUser
from app.modules.telegram.messages import UndeliverableError
from app.modules.tenancy.models import Organization, Store, StoreKind
from tests.conftest import requires_database
from tests.integration.test_product_lifecycle_api import api
from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

pytestmark = [pytest.mark.integration, requires_database()]

NOW = datetime(2026, 9, 30, 3, 40, tzinfo=UTC)
LEDGER = {"step": "drill", "checks": ["ledger"], "detail": "ledger: 1 balance"}

Maker = async_sessionmaker[AsyncSession]


@pytest.fixture
async def maker() -> AsyncIterator[Maker]:
    name = f"birka_backup_alerts_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = create_async_engine(_url_for(name), poolclass=NullPool)
    try:
        await _run(_alembic(name), "upgrade", "head", database=name)
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@dataclass(frozen=True)
class Person:
    user_id: uuid.UUID
    chat: int
    organization_id: uuid.UUID
    store_id: uuid.UUID


async def person(
    maker: Maker,
    permissions: frozenset[Permission] = DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER],
    *,
    org_wide: bool = True,
    user_active: bool = True,
    membership_active: bool = True,
) -> Person:
    """Someone in an organization of their own, holding `permissions` through
    one membership: organization-wide, or for its one store."""
    async with maker() as session:
        org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", currency_code="UAH")
        chat = uuid.uuid4().int % 2**52
        user = AppUser(telegram_user_id=chat, display_name="Власниця", is_active=user_active)
        session.add_all([org, user])
        await session.flush()
        store = Store(organization_id=org.id, name="Основний", code="MAIN", kind=StoreKind.PRIMARY)
        role = Role(organization_id=org.id, code=f"R{uuid.uuid4().hex[:6]}", name="Роль")
        session.add_all([store, role])
        await session.flush()
        session.add_all(
            [RolePermission(role_id=role.id, permission_code=p.value) for p in permissions]
        )
        session.add(
            Membership(
                user_id=user.id,
                organization_id=org.id,
                store_id=None if org_wide else store.id,
                role_id=role.id,
                is_active=membership_active,
            )
        )
        await session.commit()
        return Person(user.id, chat, org.id, store.id)


async def night(
    maker: Maker,
    *,
    ago: timedelta = timedelta(minutes=25),
    problems: list | None = None,
    now: datetime = NOW,
) -> BackupRun:
    finished = now - ago
    async with maker() as session:
        return await record_night(
            session,
            {
                "started_at": (finished - timedelta(minutes=3)).isoformat(),
                "finished_at": finished.isoformat(),
                "ok": not problems,
                "problems": problems or [],
                "archive": f"birka-{finished:%Y%m%dT%H%M%SZ}.dump.age",
                "bytes": 2_500_000,
                "drill": {"ok": not problems, "restore_seconds": 0.42},
            },
        )


async def queue(maker: Maker, now: datetime = NOW) -> int:
    async with maker() as session:
        return await queue_alerts(session, now=now)


async def messages(maker: Maker) -> list[BackupAlert]:
    async with maker() as session:
        return list(
            (
                await session.scalars(
                    select(BackupAlert).order_by(BackupAlert.created_at, BackupAlert.key)
                )
            ).all()
        )


class Bot:
    """Telegram, played by the test: records what it is given, or refuses."""

    def __init__(self, fail: Exception | None = None, pause: float = 0) -> None:
        self.fail = fail
        self.pause = pause
        self.sent: list[tuple[int, str]] = []

    async def __call__(self, chat: int, text: str) -> None:
        await asyncio.sleep(self.pause)
        if self.fail is not None:
            raise self.fail
        self.sent.append((chat, text))


async def test_a_night_is_ok_exactly_when_it_has_no_problems(maker):
    for ok, problems in [(True, [LEDGER]), (False, [])]:
        async with maker() as session:
            session.add(BackupRun(started_at=NOW, finished_at=NOW, ok=ok, problems=problems))
            with pytest.raises(IntegrityError, match="ok_means_no_problems"):
                await session.commit()


async def test_only_organization_wide_holders_of_backup_view_are_told(maker):
    owner = await person(maker)
    composed = await person(maker, frozenset({Permission.BACKUP_VIEW}))
    await person(maker, DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER])
    await person(maker, org_wide=False)  # the owner's role, for one store only
    await person(maker, user_active=False)
    await person(maker, membership_active=False)

    assert await queue(maker) == 2
    assert {m.user_id for m in await messages(maker)} == {owner.user_id, composed.user_id}


async def test_a_server_that_never_backed_up_is_told_once_a_day(maker):
    owner = await person(maker)

    assert await queue(maker) == 1
    assert await queue(maker, NOW + timedelta(hours=12)) == 0
    assert await queue(maker, NOW + timedelta(days=1)) == 1
    told = await messages(maker)
    assert [m.kind for m in told] == [AlertKind.NOT_SET_UP] * 2
    assert all(m.user_id == owner.user_id for m in told)
    assert all(m.status == AlertStatus.PENDING for m in told)


async def test_a_failed_night_is_told_once_with_its_reasons(maker):
    await person(maker)
    failed = await night(maker, problems=[LEDGER])

    assert await queue(maker) == 1
    assert await queue(maker, NOW + timedelta(hours=2)) == 0
    [told] = await messages(maker)
    assert told.kind == AlertKind.FAILED
    assert told.key == f"failed:{failed.id}"
    assert "залишки не сходяться з рухом товару" in told.text


async def test_a_good_night_after_a_warning_says_it_is_fixed_once(maker):
    await person(maker)
    await night(maker, ago=timedelta(days=1), problems=[LEDGER])
    await queue(maker, NOW - timedelta(days=1) + timedelta(minutes=10))
    await night(maker)

    assert await queue(maker) == 1
    assert await queue(maker, NOW + timedelta(hours=1)) == 0
    assert [m.kind for m in await messages(maker)] == [AlertKind.FAILED, AlertKind.RECOVERED]


async def test_a_good_night_with_nothing_to_undo_says_nothing(maker):
    await person(maker)
    await night(maker)

    assert await queue(maker) == 0


async def test_a_schedule_that_stopped_is_told_and_repeated_daily(maker):
    await person(maker)
    await night(maker, ago=DUE + timedelta(minutes=5))

    assert await queue(maker) == 1
    assert await queue(maker, NOW + timedelta(hours=6)) == 0
    assert await queue(maker, NOW + timedelta(days=1)) == 1
    assert [m.kind for m in await messages(maker)] == [AlertKind.OVERDUE] * 2


async def test_a_message_is_sent_to_the_persons_chat_and_marked(maker):
    owner = await person(maker)
    await queue(maker)
    bot = Bot()

    async with maker() as session:
        assert await deliver(session, send=bot, now=NOW) == 1
    [told] = await messages(maker)
    assert bot.sent == [(owner.chat, told.text)]
    assert (told.status, told.sent_at, told.attempts) == (AlertStatus.SENT, NOW, 1)
    async with maker() as session:
        assert await deliver(session, send=bot, now=NOW) == 0
    assert len(bot.sent) == 1


async def test_a_chat_telegram_refuses_is_not_tried_again(maker):
    await person(maker)
    await queue(maker)
    bot = Bot(UndeliverableError("Forbidden: bot can't initiate conversation with a user"))

    for _ in range(3):
        async with maker() as session:
            await deliver(session, send=bot, now=NOW)
    [told] = await messages(maker)
    assert (told.status, told.attempts) == (AlertStatus.REFUSED, 1)
    assert "initiate conversation" in (told.last_error or "")


async def test_telegram_unreachable_is_tried_again_then_given_up(maker):
    await person(maker)
    await queue(maker)
    bot = Bot(ConnectionError("network is unreachable"))

    for attempt in range(1, MAX_ATTEMPTS + 1):
        async with maker() as session:
            await deliver(session, send=bot, now=NOW)
        [told] = await messages(maker)
        assert told.attempts == attempt
        assert told.status == (
            AlertStatus.FAILED if attempt == MAX_ATTEMPTS else AlertStatus.PENDING
        )
    assert told.last_error == "ConnectionError: network is unreachable"


async def test_an_account_disabled_after_queuing_is_not_messaged(maker):
    owner = await person(maker)
    await queue(maker)
    async with maker() as session:
        await session.execute(
            text("UPDATE app_user SET is_active = false WHERE id = :id"), {"id": owner.user_id}
        )
        await session.commit()
    bot = Bot()

    async with maker() as session:
        await deliver(session, send=bot, now=NOW)
    assert bot.sent == []
    [told] = await messages(maker)
    assert told.status == AlertStatus.FAILED


async def test_two_watchers_never_send_the_same_message_at_once(maker):
    await person(maker)
    await person(maker)
    await queue(maker)
    bot = Bot(pause=0.3)

    async def watcher() -> int:
        async with maker() as session:
            return await deliver(session, send=bot, now=NOW)

    assert sum(await asyncio.gather(watcher(), watcher())) == 2
    assert len(bot.sent) == 2
    assert {m.status for m in await messages(maker)} == {AlertStatus.SENT}


async def test_one_look_queues_and_sends(maker):
    owner = await person(maker)
    await night(maker, problems=[{"step": "key", "detail": "not encrypted"}])
    bot = Bot()

    await look(maker, bot, NOW)

    [(chat, said)] = bot.sent
    assert chat == owner.chat
    assert "ключ власника" in said


async def test_the_overview_tells_the_owner_what_happened_and_what_they_were_sent(maker):
    owner = await person(maker)
    other = await person(maker)
    good = await night(maker, ago=timedelta(days=1))
    await night(maker, problems=[LEDGER])
    await queue(maker)
    async with maker() as session:
        await deliver(session, send=Bot(), now=NOW)

    async with maker() as session:
        seen = await overview(session, user_id=owner.user_id, now=NOW)
    assert seen.state is State.FAILED
    assert seen.latest is not None and seen.latest.ok is False
    assert seen.last_good is not None and seen.last_good.id == good.id
    assert [n.ok for n in seen.nights] == [False, True]
    assert seen.your_last_message is not None
    assert seen.your_last_message.user_id == owner.user_id
    assert seen.your_last_message.status == AlertStatus.SENT
    async with maker() as session:
        # A good night older than the nights listed is still found.
        short = await overview(session, user_id=owner.user_id, now=NOW, nights=1)
        assert short.last_good is not None and short.last_good.id == good.id
        assert (await overview(session, user_id=other.user_id, now=NOW)).your_last_message
        assert (await overview(session, user_id=uuid.uuid4(), now=NOW)).your_last_message is None


async def test_only_the_owner_opens_the_section(maker):
    owner = await person(maker)
    # The API reads the real clock.
    await night(maker, problems=[LEDGER], now=datetime.now(UTC))

    def scope(org: frozenset[Permission], store: frozenset[Permission]) -> RequestScope:
        return RequestScope(
            user_id=owner.user_id,
            organization_id=owner.organization_id,
            org_permissions=org,
            store_permissions={owner.store_id: store},
        )

    everything = frozenset(Permission)
    async with api(maker, scope(frozenset({Permission.BACKUP_VIEW}), frozenset())) as client:
        opened = await client.get("/api/v1/backups")
    assert opened.status_code == 200, opened.text
    body = opened.json()
    assert body["state"] == "FAILED"
    assert body["due_hours"] == 26
    assert body["latest"]["reasons"] == [
        "Копію зроблено, але перевірка відновленням не пройшла: "
        "залишки не сходяться з рухом товару."
    ]
    assert body["last_good"] is None
    assert body["your_last_message"] is None

    manager = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
    for refused in [scope(manager, manager), scope(frozenset(), everything)]:
        async with api(maker, refused) as client:
            assert (await client.get("/api/v1/backups")).status_code == 403


async def test_the_migration_lets_every_existing_owner_open_the_section():
    """`0018` grants `backup:view` to the system owner roles that already
    exist, as a new organization's owner now gets it; a role an owner
    composed is left as it was. Downgrading takes every grant away."""
    name = f"birka_backup_grant_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = create_async_engine(_url_for(name), poolclass=NullPool)
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "0017_stock_adjustment", database=name)
        ids = {key: uuid.uuid4() for key in ("org", "owner", "manager", "composed")}
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "INSERT INTO organization (id, name, currency_code, created_at) "
                    "VALUES (:org, 'org', 'UAH', now())"
                ),
                ids,
            )
            for role, code, system in [
                ("owner", "OWNER", True),
                ("manager", "MANAGER", True),
                ("composed", "OWNER_ASSISTANT", False),
            ]:
                await connection.execute(
                    text(
                        "INSERT INTO role (id, organization_id, code, name, is_system, created_at) "
                        "VALUES (:id, :org, :code, :code, :system, now())"
                    ),
                    {"id": ids[role], "org": ids["org"], "code": code, "system": system},
                )

        async def holders() -> set[uuid.UUID]:
            async with engine.connect() as connection:
                return set(
                    (
                        await connection.execute(
                            text(
                                "SELECT role_id FROM role_permission "
                                "WHERE permission_code = 'backup:view'"
                            )
                        )
                    ).scalars()
                )

        await _run(config, "upgrade", "0018_backup_alerts", database=name)
        assert await holders() == {ids["owner"]}
        await _run(config, "downgrade", "0017_stock_adjustment", database=name)
        assert await holders() == set()
        await _run(config, "upgrade", "head", database=name)
        assert await holders() == {ids["owner"]}
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def test_the_status_command_says_what_the_section_says(maker):
    """`python -m scripts.backup_watch --status`, which CI runs after a real
    night and an operator runs by hand."""
    await night(maker, now=datetime.now(UTC))
    url = maker.kw["bind"].url.render_as_string(hide_password=False)

    found = await status(Settings(database_url=url))

    assert found["state"] == "OK"
    assert found["latest"]["ok"] is True
    assert found["latest"]["archive"].endswith(".dump.age")
