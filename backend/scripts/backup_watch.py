"""Tell the owner when the server's backups fail, or stop happening — when
the site's certificate is about to run out — and when the server itself is
in trouble.

    python -m scripts.backup_watch             # what the `backup-watch` service runs
    python -m scripts.backup_watch --status    # the backups' state now; exit 0 only if OK

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

**The server.** The owner decided on 2026-10-03 ("failures are visible")
that trouble on the server — the app not answering, its database stopped,
the disk nearly full, nobody able to sign in — is told by the bot to the
people who hear about backups and to the administrators
(`BIRKA_ADMIN_TELEGRAM_IDS`), each chat once: when it starts, once a day
while it lasts, and when it works again; with a sound from 9:00 to 20:00 in
Kyiv and silently outside. So every minute this asks the API about itself
(`{BIRKA_API_URL}/internal/status`, on the compose network only) and
measures the disks — the backups' (`/backups`) and the container's own
(`/`, Docker's disk) — and `app.modules.backups.incidents` decides what is
news.

The database may be down exactly when this matters, so the watcher does not
depend on it to speak:
- the owners' chats are kept in memory from the last time the database
  answered, and messages go out from an outbox in memory, tried at every
  look and dropped a day after they were decided;
- the incidents are kept in memory, and written to `server_incident`
  whenever the database answers, with the times they really started and
  ended. On start the watcher reads the open ones, so a restart does not
  announce them again.
- the owners are read on their own, before the incidents are written, so a
  write that fails — `server_incident` missing because a migration was not
  run, which is itself the trouble to tell — does not keep them unknown.
A watcher restarted while the database is down knows only the
administrators: their ids are in its settings, the owners' chats are not.
The owners hear once the database answers again, if that is within the day.

**Outside.** A server that dies whole cannot say so. Every 10 minutes the
watcher checks in with an outside service (`BIRKA_HEARTBEAT_URL`), which
tells the owner when the check-ins stop — but only while its last look at
the server completed, the bot works (Telegram's `getMe`), and someone can be
told. A chat that refused a message for good (the person never started the
bot, or blocked it) is not someone who can be told, until a message reaches
it again or for a day. So a watcher that hangs, a revoked bot token, or
nobody to tell is noticed from outside too. A check-in that fails is logged,
never told — and logged without its address, which is its secret.

**The drawers.** The owner decided on 2026-10-04 ("cash and card, the day's
close") that a difference found when a store's drawer is closed is told by
the bot to the network's owner, silently at any hour, as with backups: once
its reason is written, or 15 minutes after the close without it; never to
whoever closed, and never for a difference under 1 грн. So every minute this
queues what is due (`app.modules.cash.messages.queue_due`) and sends it with
the same silent sender, retried for a day like a backup's message.

It also deletes expired idempotency records once an hour
(`app.core.idempotency.purge_expired`). Each look runs under a time limit; a
look that hangs is logged as one that failed. Errors go to Sentry when a DSN
is set (`app.core.sentry`).
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import functools
import json
import os
import shutil
import signal
import sys
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import aiohttp
import sentry_sdk
from aiogram.client.session.base import BaseSession
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.db import create_engine
from app.core.idempotency import purge_expired
from app.core.logging import configure_logging, get_logger
from app.core.sentry import install_sentry
from app.modules.backups.certificate import (
    CertificateExpiredError,
    Edge,
    ReadExpiry,
    certificate_alert,
    edge_to_watch,
    read_expiry,
)
from app.modules.backups.incidents import (
    ApiStatus,
    Book,
    Disk,
    Moment,
    News,
    Place,
    Signals,
    api_status,
    step,
    told,
    with_sound,
)
from app.modules.backups.server import keep, owner_chats
from app.modules.backups.service import Send, deliver, overview, queue_alert, queue_alerts
from app.modules.backups.status import State
from app.modules.cash.messages import deliver as deliver_cash
from app.modules.cash.messages import queue_due
from app.modules.telegram.messages import (
    BotTokenRefusedError,
    UndeliverableError,
    check_bot,
    send_message,
)

logger = get_logger(__name__)

# The backups and the certificate: every ten minutes, as before.
EVERY_SECONDS = 600
# The server: every minute (owner's threshold of 5 minutes, 2026-10-03).
HEALTH_EVERY = 60.0
CHECK_IN_EVERY = 600.0
PURGE_EVERY = 3600.0
# The drawers: every minute, so a reason written is told within one.
CASH_EVERY = 60.0

# Each look under a limit of its own; one that takes longer is cut off and
# counted as failed.
HEALTH_TIMEOUT = 45.0
BACKUPS_TIMEOUT = 300.0
PURGE_TIMEOUT = 300.0
CASH_TIMEOUT = 45.0
CHECK_IN_TIMEOUT = 30.0
# Within a look at the server, so its parts fit in its limit.
STATUS_TIMEOUT = 10.0
DATABASE_TIMEOUT = 15.0
TELEGRAM_TIMEOUT = 15.0
BOT_TIMEOUT = 10
PING_TIMEOUT = 10.0

# A message about the server not sent within a day is old news.
KEEP_UNSENT = timedelta(hours=24)
# The check-in needs a look at the server this recent, and a bot that
# answered this recently.
LOOK_FRESH = timedelta(minutes=3)
BOT_FRESH = timedelta(minutes=10)
# A chat that refused a message for good counts as nobody to tell for this
# long, unless a message reaches it first. Without an end, a person who
# unblocked the bot would hold the check-in down until the next trouble.
REFUSED_FOR = timedelta(hours=24)

# The disks measured, where they are mounted in the container.
DISKS: Sequence[tuple[Place, str]] = ((Place.BACKUPS, "/backups"), (Place.SERVER, "/"))

# chat, text, silent
Tell = Callable[[int, str, bool], Awaitable[None]]
ReadStatus = Callable[[], Awaitable[ApiStatus | None]]
Measure = Callable[[], Sequence[Disk]]
Check = Callable[[], Awaitable[None]]
Purge = Callable[..., Awaitable[int]]
Job = Callable[[datetime], Awaitable[object]]


def sender(token: str, *, session: BaseSession | None = None) -> Send:
    """The bot, sending without a sound (owner decision, 2026-10-01)."""
    return functools.partial(send_message, token, silent=True, session=session)


def teller(token: str, *, session: BaseSession | None = None) -> Tell:
    """The bot, with a sound or without, as each message about the server
    decides by the hour it is sent."""

    async def tell(chat: int, text: str, silent: bool) -> None:
        await send_message(token, chat, text, silent=silent, session=session)

    return tell


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
    """One look at the backups: queue what is news — about the backups, then
    about the site's certificate when there is one — then send what is
    queued."""
    async with maker() as session:
        queued = await queue_alerts(session, now=now)
    if edge is not None:
        queued += await look_at_certificate(maker, edge, read, now)
    async with maker() as session:
        sent = await deliver(session, send=send, now=now)
    if queued or sent:
        logger.info("backup_watch.told", queued=queued, sent=sent)


async def tell_cash(maker: async_sessionmaker[AsyncSession], send: Send, now: datetime) -> None:
    """One look at the drawers: queue what the network's owners must hear of
    a close's difference, then send what is queued — silently, by the `send`
    the backups use (owner decisions, 2026-10-04; ADR-0012, B8)."""
    async with maker() as session:
        queued = await queue_due(session, now=now)
    async with maker() as session:
        sent = await deliver_cash(session, send=send, now=now)
    if queued or sent:
        logger.info("backup_watch.cash_told", queued=queued, sent=sent)


async def purge_idempotency(
    maker: async_sessionmaker[AsyncSession], now: datetime, purge: Purge = purge_expired
) -> int:
    """Delete the idempotency records that expired: a cache of seven days
    that nothing else ever emptied."""
    async with maker() as session:
        deleted = await purge(session, now=now)
        await session.commit()
    logger.info("backup_watch.idempotency_purged", deleted=deleted)
    return deleted


# --- the server -----------------------------------------------------------------------


def _error(error: BaseException) -> str:
    return f"{type(error).__name__}: {error}"[:300]


async def read_status(api_url: str, *, timeout: float = STATUS_TIMEOUT) -> ApiStatus | None:
    """What the API says about itself, or None when it does not answer."""
    url = f"{api_url.rstrip('/')}/internal/status"
    try:
        async with (
            aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as client,
            client.get(url) as response,
        ):
            if response.status != 200:
                logger.warning("backup_watch.api_unanswered", status=response.status)
                return None
            payload = await response.json(content_type=None)
    except (aiohttp.ClientError, TimeoutError, ValueError) as error:
        logger.warning("backup_watch.api_unanswered", error=_error(error))
        return None
    found = api_status(payload)
    if found is None:
        logger.warning("backup_watch.api_unanswered", error="not a status")
    return found


def measure_disks(places: Sequence[tuple[Place, str]] = DISKS) -> list[Disk]:
    """Free space on each disk that exists here. `/backups` is there only
    when the backups' folder is mounted."""
    found = []
    for place, path in places:
        if not os.path.isdir(path):
            continue
        try:
            usage = shutil.disk_usage(path)
        except OSError as error:
            logger.warning("backup_watch.disk_unread", place=place.value, error=_error(error))
            continue
        found.append(Disk(place=place, free=usage.free, total=usage.total))
    return found


async def ping(url: str, *, timeout: float = PING_TIMEOUT) -> None:
    """Check in with the outside service: a plain GET, nothing in it but
    that the server is alive."""
    async with (
        aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as client,
        client.get(url) as response,
    ):
        response.raise_for_status()


@dataclass
class Unsent:
    """A message about the server, and the chats it has reached (or that
    refused it for good — those are also in `refused`)."""

    news: News
    reached: set[int] = field(default_factory=set)
    refused: set[int] = field(default_factory=set)


class Watcher:
    """The watcher's memory of the server: the book of incidents, the
    outbox, and whom to tell."""

    def __init__(
        self,
        maker: async_sessionmaker[AsyncSession],
        *,
        tell: Tell,
        read_status: ReadStatus,
        measure: Measure,
        admins: Sequence[int] = (),
        check_bot: Check | None = None,
        check_in: Check | None = None,
    ) -> None:
        self.maker = maker
        self.tell = tell
        self.read_status = read_status
        self.measure = measure
        self.admins = frozenset(admins)
        self.check_bot = check_bot
        self.check_in_at = check_in
        self.book = Book()
        self.outbox: list[Unsent] = []
        self.owners: frozenset[int] = frozenset()
        # Whether the owners were ever read: until then a message waits for
        # them, as well as reaching the administrators.
        self.owners_known = False
        # Chats that refused a message for good, and when (`REFUSED_FOR`).
        self.refused: dict[int, datetime] = {}
        # The last look at the server that completed, and whether the most
        # recent one did.
        self.looked_at: datetime | None = None
        self.last_look_completed = False
        self.bot_works_at: datetime | None = None

    def recipients(self) -> frozenset[int]:
        return self.owners | self.admins

    def reachable(self, now: datetime) -> frozenset[int]:
        """The recipients who have not refused a message within `REFUSED_FOR`."""
        return frozenset(
            chat
            for chat in self.recipients()
            if chat not in self.refused or now - self.refused[chat] >= REFUSED_FOR
        )

    async def remember(self, now: datetime) -> None:
        """Read the open incidents and the owners, when the database answers
        within its limit; otherwise go on without them."""
        try:
            await asyncio.wait_for(self._keep(now, looked_at=None), DATABASE_TIMEOUT)
        except Exception as error:
            logger.warning("backup_watch.incidents_unread", error=_error(error))

    async def look_at_server(self, now: datetime) -> None:
        """One look at the server: see, decide, tell, then write it down."""
        seen = Signals(
            now=now,
            api=await self.read_status(),
            disks=await asyncio.to_thread(self.measure),
        )
        self.book, news = step(self.book, seen)
        self.queue(news)
        await self.send(now)
        try:
            await asyncio.wait_for(self._keep(now, looked_at=now), DATABASE_TIMEOUT)
        except Exception as error:
            # The database may be down with everything else: the book stays
            # in memory and is written when it answers.
            logger.warning("backup_watch.incidents_unsaved", error=_error(error))
        self.looked_at = now
        self.last_look_completed = True

    def look_failed(self) -> None:
        self.last_look_completed = False

    def queue(self, news: Sequence[News]) -> None:
        for one in news:
            log = logger.info if one.moment is Moment.AGAIN else logger.warning
            log("backup_watch.server_trouble", kind=one.kind.value, moment=one.moment.value)
            self.outbox.append(Unsent(one))

    async def send(self, now: datetime) -> None:
        """Send what is in the outbox, within the look's share of time; what
        does not go out now is tried at the next look."""
        try:
            await asyncio.wait_for(self._send(now), TELEGRAM_TIMEOUT)
        except TimeoutError:
            logger.warning("backup_watch.telegram_slow", unsent=len(self.outbox))

    async def _send(self, now: datetime) -> None:
        silent = not with_sound(now)
        recipients = self.recipients()
        blocked = False
        kept: list[Unsent] = []
        for item in list(self.outbox):
            if now - item.news.at >= KEEP_UNSENT:
                logger.warning(
                    "backup_watch.server_message_dropped",
                    kind=item.news.kind.value,
                    moment=item.news.moment.value,
                    unreached=len(recipients - item.reached),
                )
                continue
            for chat in sorted(recipients - item.reached):
                if blocked:
                    break
                try:
                    await self.tell(chat, item.news.text, silent)
                except UndeliverableError:
                    # Never started the bot, or blocked it: only they can fix it.
                    item.reached.add(chat)
                    item.refused.add(chat)
                    self.refused[chat] = now
                    logger.warning("backup_watch.chat_refused", kind=item.news.kind.value)
                except BotTokenRefusedError:
                    blocked = True
                    logger.error("backup_watch.bot_token_refused")
                except Exception as error:
                    blocked = True
                    logger.warning("backup_watch.telegram_unreachable", error=_error(error))
                else:
                    item.reached.add(chat)
                    self.refused.pop(chat, None)
                    if item.news.moment is Moment.START:
                        self.book = told(self.book, item.news.kind, now)
            if self.owners_known and recipients <= item.reached:
                if not item.reached - item.refused:
                    logger.warning(
                        "backup_watch.nobody_to_tell",
                        kind=item.news.kind.value,
                        moment=item.news.moment.value,
                    )
                continue
            kept.append(item)
        # Only now: a send cut short by the time limit leaves the outbox
        # whole, each message remembering the chats it already reached.
        self.outbox = kept

    async def _keep(self, now: datetime, *, looked_at: datetime | None) -> None:
        # The owners first, in a session of their own: a write of the
        # incidents that fails — `server_incident` missing because migration
        # 0034 was not run — must not leave them unknown, when "the database
        # is not updated" is the very news they are owed.
        async with self.maker() as session:
            owners = await owner_chats(session)
        self.owners = owners
        self.owners_known = True
        async with self.maker() as session:
            book, owed = await keep(session, self.book, now=now, looked_at=looked_at)
            await session.commit()
        self.book = book
        self.queue(owed)

    def why_not_check_in(self, now: datetime) -> list[str]:
        """What stops the check-in now; nothing when all is well."""
        missing = []
        if (
            not self.last_look_completed
            or self.looked_at is None
            or now - self.looked_at > LOOK_FRESH
        ):
            missing.append("look")
        if self.bot_works_at is None or now - self.bot_works_at > BOT_FRESH:
            missing.append("bot")
        if not self.reachable(now):
            missing.append("nobody")
        return missing

    async def check_in(self, now: datetime) -> bool:
        """Ask whether the bot works, then check in with the outside service
        if everything holds. Returns whether it checked in."""
        if self.check_bot is not None:
            try:
                await self.check_bot()
            except BotTokenRefusedError:
                logger.error("backup_watch.bot_token_refused")
            except Exception as error:
                logger.warning("backup_watch.bot_unreachable", error=_error(error))
            else:
                self.bot_works_at = now
        missing = self.why_not_check_in(now)
        if missing:
            logger.warning("backup_watch.check_in_withheld", because=missing)
            return False
        if self.check_in_at is None:
            return False
        try:
            await self.check_in_at()
        except aiohttp.ClientResponseError as error:
            # Never the error's text: aiohttp repeats the address in it, and
            # the check-in's address is its secret.
            logger.warning("backup_watch.check_in_failed", status=error.status)
            return False
        except Exception as error:
            # Only the kind of error, for the same reason (InvalidURL, for
            # one, is the address itself).
            logger.warning("backup_watch.check_in_failed", error=type(error).__name__)
            return False
        logger.info("backup_watch.checked_in")
        return True


async def _stopped(stop: asyncio.Event, seconds: float) -> bool:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    return stop.is_set()


async def every(
    name: str,
    seconds: float,
    timeout: float,
    job: Job,
    stop: asyncio.Event,
    *,
    failed: Callable[[], None] | None = None,
    first_after: float = 0,
) -> None:
    """Run `job` every `seconds` until `stop`, each run under `timeout`. A
    run that fails or hangs is logged — and sent to Sentry when it is on —
    and the next one runs as usual."""
    if first_after and await _stopped(stop, first_after):
        return
    while not stop.is_set():
        try:
            await asyncio.wait_for(job(datetime.now(UTC)), timeout)
        except TimeoutError:
            logger.error("backup_watch.look_hung", look=name, seconds=timeout)
            sentry_sdk.capture_exception()
            if failed is not None:
                failed()
        except Exception:
            # The database may be down with everything else; keep looking.
            logger.exception("backup_watch.failed", look=name)
            sentry_sdk.capture_exception()
            if failed is not None:
                failed()
        if await _stopped(stop, seconds):
            return


async def watch(
    settings: Settings, every_seconds: float, *, stop: asyncio.Event | None = None
) -> None:
    """Watch until SIGTERM, or until `stop` is set when one is given."""
    engine = create_engine(settings)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    token = settings.telegram_bot_token.get_secret_value()
    send = sender(token)
    edge = edge_of(settings)
    heartbeat = settings.heartbeat_url
    watcher = Watcher(
        maker,
        tell=teller(token),
        read_status=functools.partial(read_status, settings.api_url),
        measure=measure_disks,
        admins=settings.admin_telegram_ids,
        check_bot=functools.partial(check_bot, token, timeout=BOT_TIMEOUT),
        check_in=None if not heartbeat else functools.partial(ping, heartbeat),
    )
    if stop is None:
        stop = asyncio.Event()
        # PID 1 in a container ignores SIGTERM unless it asks for it.
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stop.set)
    logger.info(
        "backup_watch.started",
        every_seconds=every_seconds,
        certificate=None if edge is None else edge.domain,
        administrators=len(watcher.admins),
        check_in=bool(heartbeat),
    )
    await watcher.remember(datetime.now(UTC))
    jobs = [
        every(
            "server",
            HEALTH_EVERY,
            HEALTH_TIMEOUT,
            watcher.look_at_server,
            stop,
            failed=watcher.look_failed,
        ),
        every(
            "backups",
            every_seconds,
            BACKUPS_TIMEOUT,
            lambda now: look(maker, send, now, edge),
            stop,
        ),
        every(
            "cash",
            CASH_EVERY,
            CASH_TIMEOUT,
            lambda now: tell_cash(maker, send, now),
            stop,
        ),
        every(
            "idempotency",
            PURGE_EVERY,
            PURGE_TIMEOUT,
            lambda now: purge_idempotency(maker, now),
            stop,
        ),
    ]
    if heartbeat:
        # The first after the first look at the server has had time to end.
        jobs.append(
            every(
                "check_in",
                CHECK_IN_EVERY,
                CHECK_IN_TIMEOUT,
                watcher.check_in,
                stop,
                first_after=HEALTH_TIMEOUT + 5,
            )
        )
    tasks = [asyncio.create_task(job) for job in jobs]
    try:
        await stop.wait()
    finally:
        # A look in progress is cut short: Docker gives a stopping container
        # a few seconds, not a look's limit.
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
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
    parser.add_argument(
        "--every", type=float, default=EVERY_SECONDS, help="seconds between looks at the backups"
    )
    arguments = parser.parse_args()
    settings = get_settings()
    configure_logging(settings)
    install_sentry(settings, component="backup-watch")
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
