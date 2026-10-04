"""The watcher's look at the drawers (owner decisions, 2026-10-04;
ADR-0012, B8), with Telegram played by the test, against real PostgreSQL.

Every minute the watcher queues what the network's owners must hear of a
close's difference — once its reason is written, or 15 minutes after the
close — and sends it with the backups' silent sender: never a sound, at any
hour. A chat Telegram refuses for good is not tried again; Telegram out of
reach is tried at every look for a day, then given up; a bot token Telegram
refuses leaves every message waiting, uncounted, until it is fixed.

Assertions are about this test's own chats: the watcher sends every
network's messages, and the shared test database holds other tests' too.
All data is synthetic.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

import pytest
from aiogram.client.session.base import BaseSession
from scripts import backup_watch
from scripts.backup_watch import CASH_EVERY, sender, tell_cash
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.core.config import Settings
from app.modules.cash.messages import GIVE_UP_AFTER, messages_of
from app.modules.telegram.messages import BotTokenRefusedError, UndeliverableError
from tests.conftest import requires_database
from tests.integration.test_cash_close import Net, at, close, give, network, sold

pytestmark = [pytest.mark.integration, requires_database()]

TOKEN = "123456:TEST-TOKEN-not-a-real-secret"
# December, so no other test's close is in the watcher's day.
EVENING = at(15, 20, 14, month=12)


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


class Bot:
    """Telegram, played by the test: records what it is given, or fails as
    told for some chats, or for all."""

    def __init__(self) -> None:
        self.sent: list[tuple[int, str]] = []
        self.fail: Exception | None = None
        self.refuse: dict[int, Exception] = {}

    async def __call__(self, chat: int, text: str) -> None:
        if chat in self.refuse:
            raise self.refuse[chat]
        if self.fail is not None:
            raise self.fail
        self.sent.append((chat, text))

    def to(self, chat: int) -> list[str]:
        return [text for to, text in self.sent if to == chat]


class Telegram(BaseSession):
    """Answers as Telegram does when a message is delivered, and keeps the
    requests it was given."""

    def __init__(self) -> None:
        super().__init__()
        self.requests: list[Any] = []

    async def make_request(self, bot, method, timeout=None):  # type: ignore[no-untyped-def]
        self.requests.append(method)
        body = {
            "ok": True,
            "result": {"message_id": 1, "date": 0, "chat": {"id": 1, "type": "private"}},
        }
        return self.check_response(
            bot=bot, method=method, status_code=200, content=json.dumps(body)
        ).result

    async def stream_content(self, *args, **kwargs):  # type: ignore[no-untyped-def]  # pragma: no cover
        raise NotImplementedError

    async def close(self) -> None:
        return None


async def short_close(maker, net: Net, *, by: uuid.UUID | None = None) -> Any:
    await close(maker, net, "2000.00", now=EVENING - timedelta(days=1))
    await sold(maker, net, "4250.00", "CASH")
    return await close(maker, net, "6100.00", now=EVENING, by=by)


async def look(maker, bot: Any, minutes: float) -> None:
    await tell_cash(maker, bot, EVENING + timedelta(minutes=minutes))


async def statuses(maker, close_id: uuid.UUID) -> list[tuple[str, int]]:
    async with maker() as session:
        return [(one.status, one.attempts) for one in await messages_of(session, close_id)]


async def test_the_owner_hears_once_the_reason_is_written_or_after_fifteen_minutes(maker):
    net = await network(maker)
    short = await short_close(maker, net)
    bot = Bot()
    await look(maker, bot, 1)
    await look(maker, bot, 14)
    assert bot.to(net.chats[net.owner]) == []
    await look(maker, bot, 15)
    [text] = bot.to(net.chats[net.owner])
    assert text.endswith("Причину не вказано.")
    assert await statuses(maker, short.id) == [("SENT", 1)]
    # Nobody else of the network, and never twice.
    for someone in (net.seller, net.manager, net.child_owner, net.colleague):
        assert bot.to(net.chats[someone]) == []
    await look(maker, bot, 16)
    assert len(bot.to(net.chats[net.owner])) == 1

    reasoned = await network(maker)
    other = await short_close(maker, reasoned)
    assert (await give(maker, reasoned, other.id, "здача", by=reasoned.seller)).status_code == 200
    await look(maker, bot, 2)
    assert bot.to(reasoned.chats[reasoned.owner])[0].endswith("Причина: «здача».")


async def test_the_closer_is_not_told(maker):
    net = await network(maker)
    await short_close(maker, net, by=net.owner)
    bot = Bot()
    await look(maker, bot, 16)
    assert bot.to(net.chats[net.owner]) == []


async def test_the_watcher_sends_without_a_sound():
    """The backups' sender, which the drawers share: `disable_notification`
    at any hour (owner decisions, 2026-10-04: «тихо»)."""
    telegram = Telegram()
    await sender(TOKEN, session=telegram)(42, "Каса «Ринок», 07.10: нестача 150,00 грн.")
    [request] = telegram.requests
    assert request.disable_notification is True


async def test_the_silent_sender_is_what_the_drawers_job_is_given(maker, monkeypatch):
    """`watch` starts the drawers' job beside the others, every minute, with
    the same silent `send` as the backups."""
    started: dict[str, tuple[float, Any]] = {}

    def every(name, seconds, timeout, job, stop, **kwargs):  # type: ignore[no-untyped-def]
        # Recorded when `watch` builds its jobs, before any of them runs.
        started[name] = (seconds, job)
        return asyncio.sleep(0)

    async def remember(self, now):  # type: ignore[no-untyped-def]
        return None

    sends: list[Any] = []
    monkeypatch.setattr(backup_watch, "every", every)
    monkeypatch.setattr(backup_watch.Watcher, "remember", remember)
    monkeypatch.setattr(backup_watch, "sender", lambda token: sends.append(token) or "silent")
    told: list[Any] = []

    async def tell(maker_, send, now):  # type: ignore[no-untyped-def]
        told.append(send)

    monkeypatch.setattr(backup_watch, "tell_cash", tell)
    stop = asyncio.Event()
    stop.set()
    settings = Settings(
        app_env="local",
        database_url=os.environ["BIRKA_TEST_DATABASE_URL"],
        telegram_bot_token=TOKEN,
    )
    await backup_watch.watch(settings, 600, stop=stop)
    assert started["cash"][0] == CASH_EVERY == 60.0
    await started["cash"][1](EVENING)
    assert told == ["silent"] and sends == [TOKEN]


async def test_telegram_out_of_reach_is_tried_for_a_day_then_given_up(maker):
    net = await network(maker)
    short = await short_close(maker, net)
    bot = Bot()
    bot.fail = ConnectionError("Telegram is down")
    await look(maker, bot, 16)
    await look(maker, bot, 17)
    assert await statuses(maker, short.id) == [("PENDING", 2)]
    bot.fail = None
    await look(maker, bot, 18)
    assert await statuses(maker, short.id) == [("SENT", 3)]

    later = await network(maker)
    lost = await short_close(maker, later)
    bot.fail = ConnectionError("Telegram is down")
    await look(maker, bot, 16)
    await look(maker, bot, 16 + GIVE_UP_AFTER.total_seconds() / 60)
    assert await statuses(maker, lost.id) == [("FAILED", 2)]


async def test_a_chat_that_refuses_for_good_is_not_tried_again(maker):
    net = await network(maker)
    short = await short_close(maker, net)
    bot = Bot()
    bot.refuse[net.chats[net.owner]] = UndeliverableError("bot was blocked by the user")
    await look(maker, bot, 16)
    await look(maker, bot, 17)
    assert await statuses(maker, short.id) == [("REFUSED", 1)]


async def test_a_refused_bot_token_keeps_the_message_waiting_uncounted(maker):
    net = await network(maker)
    short = await short_close(maker, net)
    bot = Bot()
    bot.refuse[net.chats[net.owner]] = BotTokenRefusedError()
    await look(maker, bot, 16)
    await look(maker, bot, 16 + GIVE_UP_AFTER.total_seconds() / 60)
    assert await statuses(maker, short.id) == [("PENDING", 0)]
    bot.refuse.clear()
    await look(maker, bot, 17 + GIVE_UP_AFTER.total_seconds() / 60)
    assert await statuses(maker, short.id) == [("SENT", 1)]
