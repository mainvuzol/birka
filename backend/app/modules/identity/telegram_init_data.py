"""Server-side verification of Telegram Mini App ``initData``.

Algorithm per https://core.telegram.org/bots/webapps (validating data received
via the Mini App):

    data_check_string = "\\n".join(f"{k}={v}" for k, v in sorted(fields - {hash}))
    secret_key        = HMAC_SHA256(key=b"WebAppData", msg=bot_token)
    expected_hash     = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))

`initDataUnsafe` from the client is never trusted (`telegram-mini-app-specialist`).
Only the raw `initData` string, verified here, establishes identity.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import parse_qsl

from app.core.errors import InvalidInitDataError

_MAX_INIT_DATA_BYTES = 8192


@dataclass(frozen=True, slots=True)
class TelegramUser:
    telegram_user_id: int
    first_name: str
    last_name: str | None = None
    username: str | None = None
    language_code: str | None = None

    @property
    def display_name(self) -> str:
        parts = [self.first_name]
        if self.last_name:
            parts.append(self.last_name)
        return " ".join(p for p in parts if p).strip() or f"user{self.telegram_user_id}"


@dataclass(frozen=True, slots=True)
class VerifiedInitData:
    user: TelegramUser
    auth_date: datetime
    raw_fields: dict[str, str]


def _build_data_check_string(fields: dict[str, str]) -> str:
    # Every received field except `hash` participates, sorted by key. The
    # `signature` field (used by Telegram's separate third-party Ed25519 flow)
    # is one of the received fields and therefore stays in — Telegram computed
    # `hash` over it too.
    return "\n".join(f"{key}={fields[key]}" for key in sorted(fields) if key != "hash")


def _secret_key(bot_token: str) -> bytes:
    return hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()


def verify_init_data(
    init_data: str,
    bot_token: str,
    *,
    max_age_seconds: int,
    now: datetime | None = None,
    max_future_skew_seconds: int = 60,
) -> VerifiedInitData:
    """Verify `initData` and return the Telegram user it attests to.

    Raises `InvalidInitDataError` for anything that is not a currently valid,
    correctly signed payload. The exception message never contains the payload
    or the bot token.
    """
    if not bot_token:
        # Refusing is the only safe behaviour: with an empty token every
        # payload would verify against a predictable key.
        raise InvalidInitDataError("Telegram bot token is not configured")
    if not init_data:
        raise InvalidInitDataError("init data is empty")
    if len(init_data.encode("utf-8")) > _MAX_INIT_DATA_BYTES:
        raise InvalidInitDataError("init data is too large")

    try:
        pairs = parse_qsl(init_data, strict_parsing=True, keep_blank_values=True)
    except ValueError as exc:
        raise InvalidInitDataError("init data is not a valid query string") from exc

    fields: dict[str, str] = {}
    for key, value in pairs:
        if key in fields:
            # A duplicated key would make the check string ambiguous and is a
            # classic signature-bypass shape.
            raise InvalidInitDataError("init data contains duplicate fields")
        fields[key] = value

    received_hash = fields.get("hash")
    if not received_hash:
        raise InvalidInitDataError("init data has no hash")

    expected_hash = hmac.new(
        _secret_key(bot_token),
        _build_data_check_string(fields).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash.lower()):
        raise InvalidInitDataError()

    raw_auth_date = fields.get("auth_date")
    if not raw_auth_date:
        raise InvalidInitDataError("init data has no auth_date")
    try:
        auth_date = datetime.fromtimestamp(int(raw_auth_date), tz=UTC)
    except (ValueError, OverflowError, OSError) as exc:
        raise InvalidInitDataError("init data has an invalid auth_date") from exc

    current = now or datetime.now(tz=UTC)
    age = (current - auth_date).total_seconds()
    if age > max_age_seconds:
        raise InvalidInitDataError("init data has expired")
    if age < -max_future_skew_seconds:
        raise InvalidInitDataError("init data is dated in the future")

    raw_user = fields.get("user")
    if not raw_user:
        raise InvalidInitDataError("init data has no user")
    try:
        payload = json.loads(raw_user)
        telegram_user_id = int(payload["id"])
        first_name = str(payload.get("first_name") or "")
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise InvalidInitDataError("init data user payload is malformed") from exc

    user = TelegramUser(
        telegram_user_id=telegram_user_id,
        first_name=first_name,
        last_name=(str(payload["last_name"]) if payload.get("last_name") else None),
        username=(str(payload["username"]) if payload.get("username") else None),
        language_code=(str(payload["language_code"]) if payload.get("language_code") else None),
    )
    return VerifiedInitData(user=user, auth_date=auth_date, raw_fields=fields)


__all__ = ["TelegramUser", "VerifiedInitData", "verify_init_data"]
