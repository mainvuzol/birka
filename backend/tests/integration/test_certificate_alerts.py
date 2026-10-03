"""The owner hears about the site's certificate as about a failed backup
(owner decision 2026-10-03).

"If the site's certificate cannot be renewed, the owner is told by the bot a
week before it runs out, as about a failed backup." The watcher's look is
played whole — queue, then send — with the edge played by the test: it
answers with a date, says the certificate has run out, or cannot be reached.
Nothing here touches the network.

Each test runs in a database of its own, for the reason the backups' own
tests do (`test_backup_alerts`): who is told is everyone holding
`backup:view` organization-wide in any organization.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

import pytest
import scripts.backup_watch as backup_watch
from scripts.backup_watch import edge_of, look

from app.core.config import Settings
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.backups.certificate import KEY_PREFIX, CertificateExpiredError, Edge, ReadExpiry
from app.modules.backups.models import AlertKind, AlertStatus
from app.modules.backups.service import queue_alerts
from tests.conftest import requires_database
from tests.integration import test_backup_alerts as backups
from tests.integration.test_backup_alerts import LEDGER, NOW, Bot, Maker, messages, night, person

pytestmark = [pytest.mark.integration, requires_database()]

# A database of its own for each test, made and dropped as the backups'
# tests make theirs.
maker = backups.maker

EDGE = Edge("shop.example.com", "caddy", 443)


def expires(at: datetime) -> ReadExpiry:
    """An edge whose certificate runs out `at`."""

    async def read(edge: Edge) -> datetime:
        assert edge == EDGE
        return at

    return read


def fails(error: Exception) -> ReadExpiry:
    """An edge that refuses the handshake with `error`."""

    async def read(edge: Edge) -> datetime:
        raise error

    return read


async def never(edge: Edge) -> datetime:
    raise AssertionError("the edge must not be asked")


class Log:
    """The watcher's logger, played by the test."""

    def __init__(self) -> None:
        self.warnings: list[tuple[str, dict[str, Any]]] = []

    def warning(self, event: str, **fields: Any) -> None:
        self.warnings.append((event, fields))

    def __getattr__(self, name: str) -> Callable[..., None]:
        return lambda *args, **kwargs: None


def about_the_certificate(told: list[Any]) -> list[Any]:
    return [m for m in told if m.key.startswith(KEY_PREFIX)]


async def test_a_week_or_more_left_tells_nobody(maker: Maker) -> None:
    await person(maker)
    await night(maker)
    bot = Bot()

    await look(maker, bot, NOW, EDGE, expires(NOW + timedelta(days=7)))
    await look(maker, bot, NOW, EDGE, expires(NOW + timedelta(days=60)))

    assert await messages(maker) == []
    assert bot.sent == []


async def test_inside_the_last_week_the_owner_is_told_once_a_day(maker: Maker) -> None:
    owner = await person(maker)
    await night(maker)  # the backups are fine: only the certificate speaks
    bot = Bot()
    runs_out = expires(NOW + timedelta(days=5))

    await look(maker, bot, NOW, EDGE, runs_out)
    await look(maker, bot, NOW + timedelta(minutes=10), EDGE, runs_out)
    await look(maker, bot, NOW + timedelta(hours=12), EDGE, runs_out)
    assert len(bot.sent) == 1
    await look(maker, bot, NOW + timedelta(days=1), EDGE, runs_out)

    told = await messages(maker)
    assert [m.key for m in told] == ["certificate:2026-09-30", "certificate:2026-10-01"]
    assert all(m.status == AlertStatus.SENT and m.user_id == owner.user_id for m in told)
    assert [chat for chat, _ in bot.sent] == [owner.chat, owner.chat]
    first = bot.sent[0][1]
    assert "Сертифікат сайту shop.example.com закінчується 05.10.2026, лишилося 5 дн." in first
    assert "лишилося 4 дн." in bot.sent[1][1]


async def test_a_certificate_that_has_run_out_is_told(maker: Maker) -> None:
    owner = await person(maker)
    await night(maker)
    bot = Bot()

    await look(maker, bot, NOW, EDGE, fails(CertificateExpiredError("certificate has expired")))

    [(chat, said)] = bot.sent
    assert chat == owner.chat
    assert said.startswith("⚠️ Сертифікат сайту shop.example.com закінчився. ")


async def test_an_edge_that_cannot_be_asked_is_logged_and_the_backups_still_told(
    maker: Maker, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await person(maker)
    await night(maker, problems=[LEDGER])
    log = Log()
    monkeypatch.setattr(backup_watch, "logger", log)
    bot = Bot()

    await look(maker, bot, NOW, EDGE, fails(ConnectionRefusedError("Connect call failed")))

    [(chat, said)] = bot.sent
    assert chat == owner.chat
    assert said.startswith("⚠️ Нічна резервна копія не вдалася.")
    assert about_the_certificate(await messages(maker)) == []
    [(event, fields)] = log.warnings
    assert event == "backup_watch.certificate_unread"
    assert fields["domain"] == "shop.example.com"
    assert fields["error"] == "ConnectionRefusedError: Connect call failed"


async def test_without_a_public_domain_the_edge_is_not_asked(maker: Maker) -> None:
    await person(maker)
    await night(maker)

    for domain in [None, "localhost", "127.0.0.1"]:
        await look(
            maker, Bot(), NOW, edge_of(Settings(_env_file=None, public_domain=domain)), never
        )

    assert await messages(maker) == []


async def test_the_certificate_is_told_to_the_people_told_about_the_backups(
    maker: Maker,
) -> None:
    owner = await person(maker)
    composed = await person(maker, frozenset({Permission.BACKUP_VIEW}))
    await person(maker, DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER])
    await person(maker, org_wide=False)
    await person(maker, user_active=False)
    await person(maker, membership_active=False)

    # Nothing backed up yet, and a certificate in its last days: both news.
    await look(maker, Bot(), NOW, EDGE, expires(NOW + timedelta(days=2)))

    told = await messages(maker)
    certificate = {m.user_id for m in about_the_certificate(told)}
    backup = {m.user_id for m in told if m.kind == AlertKind.NOT_SET_UP}
    assert certificate == backup == {owner.user_id, composed.user_id}


async def test_a_warning_about_the_certificate_does_not_say_the_backups_work_again(
    maker: Maker,
) -> None:
    """It is queued as `FAILED`, the only word the queue has for it; the
    backups' story must not read it as a failed night now put right."""
    await person(maker)
    await night(maker)
    await look(maker, Bot(), NOW, EDGE, expires(NOW + timedelta(days=3)))

    async with maker() as session:
        assert await queue_alerts(session, now=NOW + timedelta(minutes=10)) == 0


async def test_a_failed_night_put_right_is_still_said_after_a_certificate_warning(
    maker: Maker,
) -> None:
    await person(maker)
    await night(maker, ago=timedelta(days=1), problems=[LEDGER])
    far_off = expires(NOW + timedelta(days=60))
    await look(maker, Bot(), NOW - timedelta(days=1) + timedelta(minutes=10), EDGE, far_off)
    await look(maker, Bot(), NOW - timedelta(hours=1), EDGE, expires(NOW + timedelta(days=3)))
    await night(maker)

    async with maker() as session:
        assert await queue_alerts(session, now=NOW) == 1
    assert [m.kind for m in await messages(maker)][-1] == AlertKind.RECOVERED
