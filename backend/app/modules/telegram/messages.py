"""A message from the shop's bot to one person, and whether the bot works.

Telegram lets a bot write only to someone who has started a chat with it and
not blocked it. That refusal is final — retrying cannot fix it — and is told
apart from a network fault or a busy Telegram, which a later attempt may get
past. The text goes as plain text: nothing in it is read as markup. A
`silent` message arrives without a sound or a vibration.

A third answer is neither: Telegram does not accept the bot's token at all,
because it was revoked or replaced in @BotFather while the server's `.env`
still holds the old one. Nothing reaches anyone until someone fixes it, so a
message waits rather than being counted as tried, and the watcher stops
checking in with the outside service, which then tells the owner
(`scripts.backup_watch`).
"""

from __future__ import annotations

from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.exceptions import (
    TelegramBadRequest,
    TelegramForbiddenError,
    TelegramNotFound,
    TelegramUnauthorizedError,
)

# Telegram's own limit for one message.
MAX_TEXT = 4096

BOT_REFUSED = "токен бота не приймається"


class UndeliverableError(Exception):
    """Telegram refused this chat for good: the person never started the
    bot, blocked it, or the chat is gone."""


class BotTokenRefusedError(Exception):
    """Telegram does not accept the bot's token: it was revoked or replaced.
    No chat is to blame, and no message gets through until it is fixed."""

    def __init__(self) -> None:
        super().__init__(BOT_REFUSED)


async def send_message(
    token: str,
    chat_id: int,
    text: str,
    *,
    silent: bool = False,
    timeout: int = 15,
    session: BaseSession | None = None,
) -> None:
    """Send `text`, or raise `UndeliverableError` when no retry can help, or
    `BotTokenRefusedError` when the token is refused; any other exception
    means a later attempt might succeed."""
    bot = Bot(token, session=session)
    try:
        await bot.send_message(
            chat_id=chat_id,
            text=text[:MAX_TEXT],
            parse_mode=None,
            disable_notification=silent,
            request_timeout=timeout,
        )
    except TelegramUnauthorizedError as error:
        raise BotTokenRefusedError from error
    except (TelegramForbiddenError, TelegramBadRequest, TelegramNotFound) as error:
        raise UndeliverableError(error.message) from error
    finally:
        await bot.session.close()


async def check_bot(token: str, *, timeout: int = 10, session: BaseSession | None = None) -> None:
    """Ask Telegram who the bot is (`getMe`): return when the bot works, raise
    `BotTokenRefusedError` when its token is refused, or anything else when
    Telegram could not be asked."""
    bot = Bot(token, session=session)
    try:
        await bot.get_me(request_timeout=timeout)
    except TelegramUnauthorizedError as error:
        raise BotTokenRefusedError from error
    finally:
        await bot.session.close()


__all__ = [
    "BOT_REFUSED",
    "MAX_TEXT",
    "BotTokenRefusedError",
    "UndeliverableError",
    "check_bot",
    "send_message",
]
