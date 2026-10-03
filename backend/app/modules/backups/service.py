"""Recording the nights, reading them for the owner, and telling the owner.

Three callers, one per function group:

- `scripts.nightly_backup` records each night with `record_night`;
- `GET /api/v1/backups` reads `overview`;
- `scripts.backup_watch` calls `queue_alerts`, then `deliver`, every few
  minutes — and `queue_alert` for the site's certificate in between.

A message is written as `PENDING` for each owner before anything is sent,
under a key that names its news, so looking twice queues nothing twice. It is
then sent at least once: a watcher that dies mid-send leaves it `PENDING`
and the next one sends it again. A duplicate warning is a nuisance; a
missing one is the failure this exists to prevent.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.authz.permissions import Permission
from app.modules.authz.service import organization_wide_holders
from app.modules.backups.certificate import KEY_PREFIX as CERTIFICATE
from app.modules.backups.models import AlertKind, AlertStatus, BackupAlert, BackupRun
from app.modules.backups.status import Alert, State, alert_for, state_of
from app.modules.identity.service import telegram_chats
from app.modules.telegram.messages import BotTokenRefusedError, UndeliverableError

# A message Telegram cannot be reached for is tried at every look until a day
# after it was queued, then given up as `FAILED`. It used to be given up
# after five looks, about 40 minutes, and a longer Telegram outage lost a
# failed night for good — against the owner's rule that a failed night must
# reach them (2026-09-30).
GIVE_UP_AFTER = timedelta(hours=24)

Send = Callable[[int, str], Awaitable[None]]


async def record_night(session: AsyncSession, result: Mapping[str, Any]) -> BackupRun:
    """Keep what `scripts.nightly_backup` says about one night. Commits."""
    drill = result.get("drill") or {}
    night = BackupRun(
        started_at=datetime.fromisoformat(result["started_at"]),
        finished_at=datetime.fromisoformat(result["finished_at"]),
        ok=bool(result["ok"]),
        archive=result.get("archive"),
        archive_bytes=result.get("bytes"),
        drill_ok=drill.get("ok"),
        restore_seconds=drill.get("restore_seconds"),
        problems=list(result["problems"]),
    )
    session.add(night)
    await session.commit()
    return night


async def latest_night(session: AsyncSession) -> BackupRun | None:
    return (
        await session.scalars(
            select(BackupRun).order_by(BackupRun.finished_at.desc(), BackupRun.id).limit(1)
        )
    ).first()


@dataclass(frozen=True, slots=True)
class Overview:
    state: State
    latest: BackupRun | None
    last_good: BackupRun | None
    nights: list[BackupRun]
    # The newest message to the person reading, so they can see whether
    # Telegram reaches them before it matters.
    your_last_message: BackupAlert | None


async def overview(
    session: AsyncSession, *, user_id: uuid.UUID | None, now: datetime, nights: int = 14
) -> Overview:
    """The state, the recent nights, and — for `user_id` — their newest message."""
    recent = list(
        (
            await session.scalars(
                select(BackupRun).order_by(BackupRun.finished_at.desc(), BackupRun.id).limit(nights)
            )
        ).all()
    )
    latest = recent[0] if recent else None
    last_good = next((night for night in recent if night.ok), None)
    if last_good is None and latest is not None:
        last_good = await session.scalar(
            select(BackupRun)
            .where(BackupRun.ok.is_(True))
            .order_by(BackupRun.finished_at.desc(), BackupRun.id)
            .limit(1)
        )
    message = (
        None
        if user_id is None
        else await session.scalar(
            select(BackupAlert)
            .where(BackupAlert.user_id == user_id)
            .order_by(BackupAlert.created_at.desc(), BackupAlert.id)
            .limit(1)
        )
    )
    return Overview(
        state=state_of(latest, now),
        latest=latest,
        last_good=last_good,
        nights=recent,
        your_last_message=message,
    )


async def queue_alerts(session: AsyncSession, *, now: datetime) -> int:
    """Queue what the owners must hear now about the backups, once per owner.
    Returns how many messages were queued. Commits."""
    last_told = await session.scalar(
        select(BackupAlert.kind)
        # A warning about the site's certificate shares the queue, not the
        # story: it must not make a good night say the backups "work again".
        .where(~BackupAlert.key.startswith(CERTIFICATE, autoescape=True))
        .order_by(BackupAlert.created_at.desc(), BackupAlert.id)
        .limit(1)
    )
    alert = alert_for(await latest_night(session), now, AlertKind(last_told) if last_told else None)
    if alert is None:
        return 0
    return await queue_alert(session, alert, now=now)


async def queue_alert(session: AsyncSession, alert: Alert, *, now: datetime) -> int:
    """Queue `alert` once for each owner: everyone holding `backup:view`
    organization-wide, in their chat with the bot. The site's certificate
    (`certificate.certificate_alert`) is told to the same people, the owner
    decided on 2026-10-03, "as about a failed backup". Returns how many
    messages were queued. Commits."""
    owners = await organization_wide_holders(session, Permission.BACKUP_VIEW)
    chats = await telegram_chats(session, owners)
    if not chats:
        return 0
    queued = await session.execute(
        pg_insert(BackupAlert)
        .values(
            [
                {
                    "key": alert.key,
                    "kind": alert.kind.value,
                    "user_id": user_id,
                    "text": alert.text,
                    "created_at": now,
                }
                for user_id in sorted(chats)
            ]
        )
        .on_conflict_do_nothing(constraint="uq_backup_alert_key_user_id")
        .returning(BackupAlert.id)
    )
    count = len(queued.all())
    await session.commit()
    return count


async def deliver(session: AsyncSession, *, send: Send, now: datetime) -> int:
    """Send every `PENDING` message; returns how many were sent.

    Each message is locked, sent and committed on its own, so two watchers
    never send the same one at the same time, and no transaction stays open
    across more than one call to Telegram: the database ends a transaction
    left idle for a minute (`db_idle_in_transaction_timeout_seconds`), and a
    batch held open across slow sends would lose the record of the ones that
    went, and send them again.

    A bot token Telegram refuses is nobody's chat and no attempt: every
    message stays `PENDING`, untried after the first, saying why, and goes
    out once the token is fixed — however long that takes."""
    waiting = list(
        (
            await session.scalars(
                select(BackupAlert.id)
                .where(BackupAlert.status == AlertStatus.PENDING.value)
                .order_by(BackupAlert.created_at, BackupAlert.id)
            )
        ).all()
    )
    await session.commit()
    sent = 0
    token_refused: BotTokenRefusedError | None = None
    for message_id in waiting:
        message = await session.scalar(
            select(BackupAlert)
            .where(
                BackupAlert.id == message_id,
                BackupAlert.status == AlertStatus.PENDING.value,
            )
            .with_for_update(skip_locked=True)
        )
        if message is None:
            # Sent meanwhile, or another watcher holds it now.
            await session.commit()
            continue
        chat = (await telegram_chats(session, {message.user_id})).get(message.user_id)
        if chat is None:
            message.attempts += 1
            message.status = AlertStatus.FAILED.value
            message.last_error = "the account is disabled"
        elif token_refused is not None:
            message.last_error = str(token_refused)
        else:
            try:
                await send(chat, message.text)
            except BotTokenRefusedError as refusal:
                token_refused = refusal
                message.last_error = str(refusal)
            except UndeliverableError as refusal:
                message.attempts += 1
                message.status = AlertStatus.REFUSED.value
                message.last_error = str(refusal)[:300]
            except Exception as error:
                message.attempts += 1
                message.last_error = f"{type(error).__name__}: {error}"[:300]
                if now - message.created_at >= GIVE_UP_AFTER:
                    message.status = AlertStatus.FAILED.value
            else:
                message.attempts += 1
                message.status = AlertStatus.SENT.value
                message.sent_at = now
                message.last_error = None
                sent += 1
        await session.commit()
    return sent


__all__ = [
    "GIVE_UP_AFTER",
    "Overview",
    "Send",
    "deliver",
    "latest_night",
    "overview",
    "queue_alert",
    "queue_alerts",
    "record_night",
]
