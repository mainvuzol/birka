"""Tell the owner when the server's backups fail, or stop happening — or
when the site's certificate is about to run out.

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

The owner decided on 2026-10-03 that if the site's certificate cannot be
renewed, the bot tells them a week before it runs out, as about a failed
backup. So each look also asks Caddy (`BIRKA_EDGE_HOST`, on the compose
network) for the certificate of `BIRKA_PUBLIC_DOMAIN`, and inside the last
week queues a warning for the same people, at most once a day
(`app.modules.backups.certificate`). Without a public domain — unset,
localhost, an address — it does not ask. An edge that cannot be asked is
logged and does not stop the backups being watched.
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
from app.modules.backups.certificate import (
    CertificateExpiredError,
    Edge,
    ReadExpiry,
    certificate_alert,
    edge_to_watch,
    read_expiry,
)
from app.modules.backups.service import Send, deliver, overview, queue_alert, queue_alerts
from app.modules.backups.status import State
from app.modules.telegram.messages import send_message

logger = get_logger(__name__)

EVERY_SECONDS = 600


def sender(token: str, *, session: BaseSession | None = None) -> Send:
    """The bot, sending without a sound (owner decision, 2026-10-01)."""
    return functools.partial(send_message, token, silent=True, session=session)


def edge_of(settings: Settings) -> Edge | None:
    """The site whose certificate is watched, or None when there is none."""
    return edge_to_watch(settings.public_domain, settings.edge_host, settings.edge_port)


async def look_at_certificate(
    maker: async_sessionmaker[AsyncSession], edge: Edge, read: ReadExpiry, now: datetime
) -> int:
    """Ask the edge when its certificate runs out, and queue a warning inside
    the owner's week. Returns how many messages were queued."""
    expires_at: datetime | None
    try:
        expires_at = await read(edge)
    except CertificateExpiredError:
        expires_at = None
    except Exception as error:
        # Caddy restarting, a certificate not issued yet, the domain pointed
        # elsewhere: none of it may stop the backups being watched.
        logger.warning(
            "backup_watch.certificate_unread",
            domain=edge.domain,
            host=edge.host,
            port=edge.port,
            error=f"{type(error).__name__}: {error}"[:300],
        )
        return 0
    alert = certificate_alert(edge.domain, expires_at, now)
    if alert is None:
        return 0
    async with maker() as session:
        return await queue_alert(session, alert, now=now)


async def look(
    maker: async_sessionmaker[AsyncSession],
    send: Send,
    now: datetime,
    edge: Edge | None = None,
    read: ReadExpiry = read_expiry,
) -> None:
    """One look: queue what is news — about the backups, then about the
    site's certificate when there is one — then send what is queued."""
    async with maker() as session:
        queued = await queue_alerts(session, now=now)
    if edge is not None:
        queued += await look_at_certificate(maker, edge, read, now)
    async with maker() as session:
        sent = await deliver(session, send=send, now=now)
    if queued or sent:
        logger.info("backup_watch.told", queued=queued, sent=sent)


async def watch(settings: Settings, every: float) -> None:
    engine = create_engine(settings)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    send = sender(settings.telegram_bot_token.get_secret_value())
    edge = edge_of(settings)
    stop = asyncio.Event()
    # PID 1 in a container ignores SIGTERM unless it asks for it.
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stop.set)
    logger.info(
        "backup_watch.started",
        every_seconds=every,
        certificate=None if edge is None else edge.domain,
    )
    try:
        while not stop.is_set():
            try:
                await look(maker, send, datetime.now(UTC), edge)
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
