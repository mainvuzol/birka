"""What the bot tells the network's owner of a close's difference, written
before it is sent and delivered by the watcher (ADR-0012, B8).

The owner decided (business-rules.md, "cash and card, the day's close"): a
difference is recorded with a reason, and the bot tells the owner, silently
at any hour, as with backups; and the same day, when the design asked:

- the network's owner only — whoever holds `store:manage` through an
  organization-wide membership of that network — and not when the owner
  closed the drawer themselves (G10, G40);
- the bot waits up to 15 minutes for the reason, then writes without it, once
  (G11); a reason given later is in the app, not sent again;
- a difference under 1 грн is recorded but told to nobody (G41);
- a day nobody closed is told in the next close's message (G42).

`queue_due` writes one `PENDING` message per owner with a chat before
anything is sent, so looking twice queues nothing twice; `deliver` sends
them, by `telegram.outbox`, which a stocktake's messages share (ADR-0022).
It is `backups.service.deliver`'s algorithm, copied rather than shared: a
shop's module may not import the backups section (ADR-0012, B8; a known
duplication). Both run in the watcher (`scripts.backup_watch`), never in the
API: a message sent after a commit would be lost with Telegram or the
process, and never retried.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.authz.permissions import Permission
from app.modules.authz.service import organization_wide_holders_in
from app.modules.cash.models import CashClose, CashCloseReason, CashMessage
from app.modules.cash.read import unclosed_days
from app.modules.cash.service import SMALL_DIFFERENCE, money
from app.modules.identity.models import AppUser
from app.modules.identity.service import telegram_chats
from app.modules.telegram import outbox
from app.modules.telegram.outbox import GIVE_UP_AFTER, Send
from app.modules.tenancy.models import Store

# How long the bot waits for the reason before it writes without it (G11).
WAIT_FOR_REASON = timedelta(minutes=15)
# A close older than this is not told any more: the watcher was down for a
# day, and the close is in the app.
TOLD_WITHIN = timedelta(hours=24)


def grn(value: Decimal) -> str:
    """Money as the bot prints it: «6100,00 грн», a comma, no separator
    between thousands. The app has written «6 100,00 грн» since 2026-10-17
    (sale-slice TZ, P2-1); the bot's own words are the server's, unchanged."""
    return f"{money(value)}".replace(".", ",") + " грн"


def message_text(
    *,
    store_name: str,
    business_day: date,
    difference: Decimal,
    closed_by: str,
    closed_at: datetime,
    counted: Decimal,
    expected: Decimal,
    reason: str | None,
    unclosed: Sequence[date] = (),
) -> str:
    """The message, plain and impersonal like the app's texts (B8).
    `closed_at` is in the store's own time. Nothing in it is a customer's:
    the closer's name is staff."""
    found = "нестача" if difference < 0 else "надлишок"
    lines = [
        f"Каса «{store_name}», {business_day:%d.%m}: {found} {grn(abs(difference))}.",
        f"Підрахунок: {closed_by}, {closed_at:%H:%M} — {grn(counted)}; мало бути {grn(expected)}.",
        f"Причина: «{reason}»." if reason else "Причину не вказано.",
    ]
    if len(unclosed) == 1:
        lines.append(f"Не закрито: {unclosed[0]:%d.%m} — цей день увійшов у це закриття.")
    elif unclosed:
        days = ", ".join(f"{day:%d.%m}" for day in unclosed)
        lines.append(f"Не закрито: {days} — ці дні увійшли в це закриття.")
    return "\n".join(lines)


async def _text(session: AsyncSession, close: CashClose, reason: str | None) -> str:
    store = await session.get(Store, close.store_id)
    assert store is not None
    closer = await session.scalar(
        select(AppUser.display_name).where(AppUser.id == close.actor_user_id)
    )
    assert close.difference is not None and close.expected is not None
    return message_text(
        store_name=store.name,
        business_day=close.business_day,
        difference=close.difference,
        closed_by=closer or "",
        closed_at=close.closed_at.astimezone(ZoneInfo(store.timezone)),
        counted=close.counted,
        expected=close.expected,
        reason=reason,
        unclosed=await unclosed_days(session, store=store, close=close),
    )


async def queue_due(session: AsyncSession, *, now: datetime) -> int:
    """Queue the message of every close of the last day whose difference
    needs one and has none yet: once its reason is written, or 15 minutes
    after the close without it. One per owner of its network with a chat,
    never to whoever closed. Returns how many were queued. Commits."""
    reason = select(CashCloseReason.reason).where(CashCloseReason.close_id == CashClose.id)
    told = select(CashMessage.id).where(CashMessage.close_id == CashClose.id)
    due = (
        await session.execute(
            select(CashClose, reason.scalar_subquery())
            .where(
                CashClose.closed_at > now - TOLD_WITHIN,
                CashClose.closed_at <= now,
                func.abs(CashClose.difference) >= SMALL_DIFFERENCE,
                ~told.exists(),
                or_(reason.exists(), CashClose.closed_at <= now - WAIT_FOR_REASON),
            )
            .order_by(CashClose.closed_at, CashClose.id)
        )
    ).all()
    queued = 0
    for close, why in due:
        owners = await organization_wide_holders_in(
            session, close.organization_id, Permission.STORE_MANAGE
        )
        chats = await telegram_chats(
            session, [owner for owner in owners if owner != close.actor_user_id]
        )
        if not chats:
            continue
        text = await _text(session, close, why)
        inserted = await session.execute(
            pg_insert(CashMessage)
            .values(
                [
                    {
                        "organization_id": close.organization_id,
                        "close_id": close.id,
                        "user_id": user_id,
                        "text": text,
                        "created_at": now,
                    }
                    for user_id in sorted(chats)
                ]
            )
            .on_conflict_do_nothing(constraint="uq_cash_message_close_id_user_id")
            .returning(CashMessage.id)
        )
        queued += len(inserted.all())
    await session.commit()
    return queued


async def deliver(session: AsyncSession, *, send: Send, now: datetime) -> int:
    """Send every `PENDING` message; returns how many were sent, by the
    algorithm a stocktake's messages share (`telegram.outbox`)."""
    return await outbox.deliver(
        session, model=CashMessage, chats=telegram_chats, send=send, now=now
    )


async def messages_of(session: AsyncSession, close_id: uuid.UUID) -> list[CashMessage]:
    """What was told of one close, to whom and how it went."""
    return list(
        (
            await session.scalars(
                select(CashMessage)
                .where(CashMessage.close_id == close_id)
                .order_by(CashMessage.created_at, CashMessage.user_id)
            )
        ).all()
    )


__all__ = [
    "GIVE_UP_AFTER",
    "TOLD_WITHIN",
    "WAIT_FOR_REASON",
    "Send",
    "deliver",
    "grn",
    "message_text",
    "messages_of",
    "queue_due",
]
