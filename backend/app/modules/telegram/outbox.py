"""Sending what a shop's module wrote down for the bot to tell (ADR-0012, B8).

A message is written as a row, `PENDING`, in the same transaction as what it
tells, and sent later by the watcher (`scripts.backup_watch`), never by the
API: a message sent after a commit would be lost with Telegram or the
process, and never retried. This is the one algorithm that sends such rows,
shared by the drawer's messages (`cash_message`) and a stocktake's
(`stocktake_message`, ADR-0022). The backups keep their own copy: a shop's
module may not import that section, and it may not import a shop's.

It reaches nobody's data: who a chat belongs to is the caller's `chats`,
which asks the people module, as `telegram` itself may not.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Iterable
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.telegram.messages import BotTokenRefusedError, UndeliverableError

PENDING = "PENDING"
SENT = "SENT"
# Telegram refused this person's chat for good: they never started the bot,
# or blocked it.
REFUSED = "REFUSED"
# Telegram could not be reached for a day, or the account was disabled.
FAILED = "FAILED"

# A message Telegram cannot be reached for is tried at every look until a day
# after it was queued, then given up, as a backup's is.
GIVE_UP_AFTER = timedelta(hours=24)

Send = Callable[[int, str], Awaitable[None]]
Chats = Callable[[AsyncSession, Iterable[uuid.UUID]], Awaitable[dict[uuid.UUID, int]]]


async def deliver(
    session: AsyncSession, *, model: Any, chats: Chats, send: Send, now: datetime
) -> int:
    """Send every `PENDING` row of `model`; returns how many were sent.

    Each message is locked, sent and committed on its own, so two watchers
    never send one at once and no transaction stays open across more than one
    call to Telegram. A chat Telegram refuses for good is `REFUSED`; any other
    failure is tried at every look for a day, then `FAILED`. A bot token
    Telegram refuses is nobody's chat and no attempt: every message stays
    `PENDING` and goes out once the token is fixed."""
    waiting = list(
        (
            await session.scalars(
                select(model.id).where(model.status == PENDING).order_by(model.created_at, model.id)
            )
        ).all()
    )
    await session.commit()
    sent = 0
    token_refused: BotTokenRefusedError | None = None
    for message_id in waiting:
        message = await session.scalar(
            select(model)
            .where(model.id == message_id, model.status == PENDING)
            .with_for_update(skip_locked=True)
        )
        if message is None:
            # Sent meanwhile, or another watcher holds it now.
            await session.commit()
            continue
        chat = (await chats(session, {message.user_id})).get(message.user_id)
        if chat is None:
            message.attempts += 1
            message.status = FAILED
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
                message.status = REFUSED
                message.last_error = str(refusal)[:300]
            except Exception as error:
                message.attempts += 1
                message.last_error = f"{type(error).__name__}: {error}"[:300]
                if now - message.created_at >= GIVE_UP_AFTER:
                    message.status = FAILED
            else:
                message.attempts += 1
                message.status = SENT
                message.sent_at = now
                message.last_error = None
                sent += 1
        await session.commit()
    return sent


__all__ = ["FAILED", "GIVE_UP_AFTER", "PENDING", "REFUSED", "SENT", "Chats", "Send", "deliver"]
