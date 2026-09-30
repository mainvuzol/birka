"""Tell the owner when the server's backups fail, or stop happening.

    python -m scripts.backup_watch             # what the `backup-watch` service runs
    python -m scripts.backup_watch --status    # the state now; exit 0 only if OK

The owner decided on 2026-09-30 that a failed backup or drill is sent by the
bot in Telegram, not only shown in the app. Every few minutes this queues
what the owners must hear (`app.modules.backups.service.queue_alerts`) and
sends what is queued. It runs beside the app, restarted by Docker, and not
from cron: a schedule that stopped is exactly what it has to notice, and the
nightly job cannot report a night it never ran.

It needs the database and the bot token. It sends to people holding
`backup:view` organization-wide, in their private chat with the bot, and
always silently: the owner decided on 2026-10-01 that a failed night must not
wake anyone, and that they look at the «Резервні копії» section themselves.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import functools
import json
import signal
import sys
from datetime import UTC, datetime

from aiogram.client.session.base import BaseSession
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.db import create_engine
from app.core.logging import configure_logging, get_logger
from app.modules.backups.service import Send, deliver, overview, queue_alerts
from app.modules.backups.status import State
from app.modules.telegram.messages import send_message

logger = get_logger(__name__)

EVERY_SECONDS = 600


def sender(token: str, *, session: BaseSession | None = None) -> Send:
    """The bot, sending without a sound (owner decision, 2026-10-01)."""
    return functools.partial(send_message, token, silent=True, session=session)


async def look(maker: async_sessionmaker[AsyncSession], send: Send, now: datetime) -> None:
    """One look: queue what is news, then send what is queued."""
    async with maker() as session:
        queued = await queue_alerts(session, now=now)
    async with maker() as session:
        sent = await deliver(session, send=send, now=now)
    if queued or sent:
        logger.info("backup_watch.told", queued=queued, sent=sent)


async def watch(settings: Settings, every: float) -> None:
    engine = create_engine(settings)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    send = sender(settings.telegram_bot_token.get_secret_value())
    stop = asyncio.Event()
    # PID 1 in a container ignores SIGTERM unless it asks for it.
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stop.set)
    logger.info("backup_watch.started", every_seconds=every)
    try:
        while not stop.is_set():
            try:
                await look(maker, send, datetime.now(UTC))
            except Exception:
                # The database may be down with everything else; keep looking.
                logger.exception("backup_watch.failed")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=every)
    finally:
        await engine.dispose()
        logger.info("backup_watch.stopped")


async def status(settings: Settings) -> dict[str, object]:
    engine = create_engine(settings)
    try:
        async with AsyncSession(engine) as session:
            now = datetime.now(UTC)
            seen = await overview(session, user_id=None, now=now)
    finally:
        await engine.dispose()
    latest = seen.latest
    return {
        "state": seen.state.value,
        "checked_at": now.isoformat(),
        "latest": None
        if latest is None
        else {
            "finished_at": latest.finished_at.isoformat(),
            "ok": latest.ok,
            "archive": latest.archive,
            "problems": latest.problems,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--status", action="store_true", help="print the state; exit 0 only if it is OK"
    )
    parser.add_argument("--every", type=float, default=EVERY_SECONDS, help="seconds between looks")
    arguments = parser.parse_args()
    settings = get_settings()
    configure_logging(settings)
    if arguments.status:
        found = asyncio.run(status(settings))
        print(json.dumps(found, ensure_ascii=False))
        return 0 if found["state"] == State.OK.value else 1
    if not settings.telegram_bot_token.get_secret_value():
        print("BIRKA_TELEGRAM_BOT_TOKEN is required to tell the owner", file=sys.stderr)
        return 2
    asyncio.run(watch(settings, arguments.every))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
