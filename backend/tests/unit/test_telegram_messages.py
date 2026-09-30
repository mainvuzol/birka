"""A message from the bot, told apart: sent, refused for good, or worth
another try. Telegram's answers are played through aiogram's own response
handling, without the network."""

from __future__ import annotations

import json
from typing import Any

import pytest
from aiogram.client.session.base import BaseSession

from app.modules.telegram.messages import MAX_TEXT, UndeliverableError, send_message

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
    assert telegram.closed


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
        (refusal(401, "Unauthorized"), "token"),
    ],
    ids=["server", "flood", "token"],
)
async def test_anything_else_is_worth_another_try(telegram, retry):
    with pytest.raises(Exception) as raised:
        await send_message(TOKEN, 42, "text", session=telegram)
    assert not isinstance(raised.value, UndeliverableError), retry
    assert telegram.closed
