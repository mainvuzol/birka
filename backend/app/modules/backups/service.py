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
from datetime import datetime
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
from app.modules.telegram.messages import UndeliverableError

# How many times a message is tried before it is given up as `FAILED`. The
# watcher looks every few minutes, so this is under an hour of Telegram
# being unreachable.
MAX_ATTEMPTS = 5

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
    """Send every `PENDING` message; returns how many were sent. Each is
    locked while it is sent, so two watchers never send the same one at the
    same time. Commits."""
    pending = list(
        (
            await session.scalars(
                select(BackupAlert)
                .where(BackupAlert.status == AlertStatus.PENDING.value)
                .order_by(BackupAlert.created_at, BackupAlert.id)
                .with_for_update(skip_locked=True)
            )
        ).all()
    )
    chats = await telegram_chats(session, {message.user_id for message in pending})
    sent = 0
    for message in pending:
        chat = chats.get(message.user_id)
        message.attempts += 1
        if chat is None:
            message.status = AlertStatus.FAILED.value
            message.last_error = "the account is disabled"
            continue
        try:
            await send(chat, message.text)
        except UndeliverableError as refusal:
            message.status = AlertStatus.REFUSED.value
            message.last_error = str(refusal)[:300]
        except Exception as error:
            message.last_error = f"{type(error).__name__}: {error}"[:300]
            if message.attempts >= MAX_ATTEMPTS:
                message.status = AlertStatus.FAILED.value
        else:
            message.status = AlertStatus.SENT.value
            message.sent_at = now
            message.last_error = None
            sent += 1
    await session.commit()
    return sent


__all__ = [
    "MAX_ATTEMPTS",
    "Overview",
    "Send",
    "deliver",
    "latest_night",
    "overview",
    "queue_alert",
    "queue_alerts",
    "record_night",
]
