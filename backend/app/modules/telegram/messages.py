"""A message from the shop's bot to one person.

Telegram lets a bot write only to someone who has started a chat with it and
not blocked it. That refusal is final — retrying cannot fix it — and is told
apart from a network fault or a busy Telegram, which a later attempt may get
past. The text goes as plain text: nothing in it is read as markup.
"""

from __future__ import annotations

from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramNotFound

# Telegram's own limit for one message.
MAX_TEXT = 4096


class UndeliverableError(Exception):
    """Telegram refused this chat for good: the person never started the
    bot, blocked it, or the chat is gone."""


async def send_message(
    token: str,
    chat_id: int,
    text: str,
    *,
    timeout: int = 15,
    session: BaseSession | None = None,
) -> None:
    """Send `text`, or raise `UndeliverableError` when no retry can help;
    any other exception means a later attempt might succeed."""
    bot = Bot(token, session=session)
    try:
        await bot.send_message(
            chat_id=chat_id, text=text[:MAX_TEXT], parse_mode=None, request_timeout=timeout
        )
    except (TelegramForbiddenError, TelegramBadRequest, TelegramNotFound) as error:
        raise UndeliverableError(error.message) from error
    finally:
        await bot.session.close()


__all__ = ["MAX_TEXT", "UndeliverableError", "send_message"]
