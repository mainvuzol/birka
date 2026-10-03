"""A message from the bot, told apart: sent, refused for good, or worth
another try. Telegram's answers are played through aiogram's own response
handling, without the network."""

from __future__ import annotations

import json
from typing import Any

import pytest
from aiogram.client.session.base import BaseSession
from scripts.backup_watch import sender, teller

from app.modules.telegram.messages import (
    MAX_TEXT,
    BotTokenRefusedError,
    UndeliverableError,
    check_bot,
    send_message,
)

TOKEN = "123456:TEST-TOKEN-not-a-real-secret"


class Telegram(BaseSession):
    """Answers every request as Telegram would, with `status` and `body`."""

    def __init__(self, status: int, body: dict[str, Any]) -> None:
        super().__init__()
        self.status = status
        self.body = body
        self.requests: list[Any] = []
        self.closed = False

    async def make_request(self, bot, method, timeout=None):
        self.requests.append(method)
        return self.check_response(
            bot=bot, method=method, status_code=self.status, content=json.dumps(self.body)
        ).result

    async def stream_content(self, *args, **kwargs):  # pragma: no cover - never streamed
        raise NotImplementedError

    async def close(self) -> None:
        self.closed = True


def refusal(status: int, description: str, **parameters: Any) -> Telegram:
    body: dict[str, Any] = {"ok": False, "error_code": status, "description": description}
    if parameters:
        body["parameters"] = parameters
    return Telegram(status, body)


def delivered() -> Telegram:
    return Telegram(
        200,
        {
            "ok": True,
            "result": {"message_id": 1, "date": 0, "chat": {"id": 42, "type": "private"}},
        },
    )


async def test_a_message_goes_as_plain_text_to_the_persons_chat():
    telegram = delivered()
    await send_message(TOKEN, 42, "⚠️ <b>not markup</b>", session=telegram)
    [request] = telegram.requests
    assert request.chat_id == 42
    assert request.text == "⚠️ <b>not markup</b>"
    assert request.parse_mode is None
    assert request.disable_notification is False
    assert telegram.closed


async def test_the_backup_watcher_sends_without_a_sound():
    """Owner decision, 2026-10-01: a failed night must not wake anyone; the
    owner reads the «Резервні копії» section."""
    telegram = delivered()
    await sender(TOKEN, session=telegram)(42, "⚠️ Нічна резервна копія не вдалася.")
    [request] = telegram.requests
    assert request.disable_notification is True
    assert request.chat_id == 42


async def test_a_message_longer_than_telegram_takes_is_cut_not_refused():
    telegram = delivered()
    await send_message(TOKEN, 42, "я" * (MAX_TEXT + 10), session=telegram)
    assert len(telegram.requests[0].text) == MAX_TEXT


@pytest.mark.parametrize(
    ("status", "description"),
    [
        (403, "Forbidden: bot can't initiate conversation with a user"),
        (403, "Forbidden: bot was blocked by the user"),
        (400, "Bad Request: chat not found"),
    ],
)
async def test_a_chat_telegram_refuses_for_good_is_undeliverable(status, description):
    telegram = refusal(status, description)
    with pytest.raises(UndeliverableError, match=description):
        await send_message(TOKEN, 42, "text", session=telegram)
    assert telegram.closed


@pytest.mark.parametrize(
    ("telegram", "retry"),
    [
        (refusal(502, "Bad Gateway"), "server"),
        (refusal(429, "Too Many Requests: retry after 5", retry_after=5), "flood"),
    ],
    ids=["server", "flood"],
)
async def test_anything_else_is_worth_another_try(telegram, retry):
    with pytest.raises(Exception) as raised:
        await send_message(TOKEN, 42, "text", session=telegram)
    assert not isinstance(raised.value, UndeliverableError | BotTokenRefusedError), retry
    assert telegram.closed


async def test_a_refused_bot_token_is_its_own_answer():
    """Revoked or replaced in @BotFather: no chat is to blame, and no message
    gets through until the server's token is fixed."""
    telegram = refusal(401, "Unauthorized")
    with pytest.raises(BotTokenRefusedError, match=r"^токен бота не приймається$"):
        await send_message(TOKEN, 42, "text", session=telegram)
    assert telegram.closed


def me() -> Telegram:
    return Telegram(
        200, {"ok": True, "result": {"id": 123456, "is_bot": True, "first_name": "Бірка"}}
    )


async def test_the_bot_is_checked_by_asking_telegram_who_it_is():
    telegram = me()
    await check_bot(TOKEN, session=telegram)
    [request] = telegram.requests
    assert type(request).__name__ == "GetMe"
    assert telegram.closed


async def test_a_bot_whose_token_is_refused_does_not_work():
    telegram = refusal(401, "Unauthorized")
    with pytest.raises(BotTokenRefusedError):
        await check_bot(TOKEN, session=telegram)
    assert telegram.closed


async def test_a_bot_telegram_cannot_be_asked_about_is_not_a_refused_token():
    telegram = refusal(502, "Bad Gateway")
    with pytest.raises(Exception) as raised:
        await check_bot(TOKEN, session=telegram)
    assert not isinstance(raised.value, BotTokenRefusedError)


@pytest.mark.parametrize("silent", [True, False])
async def test_trouble_on_the_server_is_sent_with_the_sound_it_is_given(silent):
    """With a sound in the shops' hours, silently outside (owner, 2026-10-03):
    the watcher decides, the bot obeys."""
    telegram = delivered()
    await teller(TOKEN, session=telegram)(42, "⚠️ База даних не відповідає.", silent)
    [request] = telegram.requests
    assert request.disable_notification is silent
    assert request.text == "⚠️ База даних не відповідає."
