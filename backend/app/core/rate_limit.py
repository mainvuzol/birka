"""How often one address may sign in.

`POST /auth/telegram` is the one request anyone on the internet can make
without a session. A payload that fails its signature costs only an HMAC, but
any Telegram user gets a validly signed one for their own account by opening
the bot. That one costs a write and a scope query, and a member's also a
commit and a log line, and mints a 12-hour token. Unlimited, one address could
keep the database pool and the single event loop busy for everyone else.

So each address gets a token bucket: **30 sign-ins at once, refilled at 30 a
minute**. A technical default, not an owner rule. A whole shop shares one
address on its Wi-Fi, and a mobile carrier puts many phones behind one
address too; a handful of people opening the app together at opening time,
each reloading or retrying once or twice, takes a few of the 30, and a token
then lasts 12 hours. A flood from one address is held to one sign-in every
two seconds.

The buckets live in this process's memory. One uvicorn process serves the API
(`backend/Dockerfile`), so every request sees the same buckets and nothing
else is needed; a restart forgets them, which only ever lets someone in.
Memory is bounded: a bucket that has refilled is the same as none and is
dropped, and past `max_keys` the longest-idle buckets go first.

The address is `request.client.host`. Behind Caddy that is the client's own
address only when uvicorn trusts Caddy's `X-Forwarded-For`
(`--proxy-headers --forwarded-allow-ips`); otherwise every request comes from
Caddy, and everyone shares one bucket.
"""

from __future__ import annotations

import ipaddress
import math
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Request

from app.core.config import Settings, get_settings
from app.core.errors import RateLimitedError

# A server's numbers: the settings' defaults.
SIGN_INS_PER_MINUTE: int = Settings.model_fields["sign_ins_per_minute"].default
SIGN_IN_BURST: int = Settings.model_fields["sign_in_burst"].default


@dataclass(slots=True)
class _Bucket:
    tokens: float
    at: float


class TokenBucket:
    """One bucket per key: `burst` taken at once, refilled at `per_minute`.

    Not locked: it is only used from the event loop (`limit_sign_ins` is a
    coroutine, never run in a worker thread), and `take` never awaits, so no
    two requests interleave inside it.
    """

    def __init__(
        self,
        *,
        per_minute: float,
        burst: int,
        max_keys: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if per_minute <= 0 or burst < 1 or max_keys < 1:
            raise ValueError("a token bucket needs a positive rate, burst and size")
        self._rate = per_minute / 60.0
        self._burst = float(burst)
        self._max_keys = max_keys
        self._clock = clock
        # Least recently used first. A bucket's `at` is when it was last
        # used, so the order is also by `at`.
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()

    def take(self, key: str) -> float | None:
        """Take one token for `key`: None when taken, or else the seconds until
        the next one is there. A refusal takes nothing."""
        now = self._clock()
        self._forget_refilled(now)
        bucket = self._buckets.pop(key, None)
        if bucket is None:
            bucket = _Bucket(tokens=self._burst, at=now)
        else:
            bucket.tokens = min(self._burst, bucket.tokens + (now - bucket.at) * self._rate)
            bucket.at = now
        self._buckets[key] = bucket
        while len(self._buckets) > self._max_keys:
            # Past the bound, the longest idle go: forgetting one only ever
            # lets that address in.
            self._buckets.popitem(last=False)
        if bucket.tokens >= 1:
            bucket.tokens -= 1
            return None
        return (1 - bucket.tokens) / self._rate

    def __len__(self) -> int:
        return len(self._buckets)

    def _forget_refilled(self, now: float) -> None:
        refill = self._burst / self._rate
        while self._buckets:
            oldest = next(iter(self._buckets.values()))
            if now - oldest.at < refill:
                return
            self._buckets.popitem(last=False)


def client_address(request: Request) -> str:
    """Whom the bucket belongs to.

    An IPv6 address counts by its /64: a phone on a mobile network is given
    the whole /64 and may use any address in it, so counting each address
    would give one phone as many buckets as it likes. What is not an address
    at all (a test client) counts as it is.
    """
    host = request.client.host if request.client is not None else ""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return host
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return str(ipaddress.IPv6Network((address, 64), strict=False))
    return str(address)


def _sign_in_bucket(request: Request) -> TokenBucket:
    """The app's own buckets, made on its first sign-in: each app built by
    `create_app` (a test's, too) counts on its own."""
    state = request.app.state
    bucket: TokenBucket | None = getattr(state, "sign_in_bucket", None)
    if bucket is None:
        # Settings raise the numbers (BIRKA_SIGN_INS_PER_MINUTE,
        # BIRKA_SIGN_IN_BURST) only for a run that signs in from one address
        # far more often than people do: the end-to-end journeys. A server
        # keeps the defaults.
        settings: Settings = getattr(state, "settings", None) or get_settings()
        bucket = TokenBucket(per_minute=settings.sign_ins_per_minute, burst=settings.sign_in_burst)
        state.sign_in_bucket = bucket
    return bucket


async def limit_sign_ins(request: Request) -> None:
    """Refuse a sign-in past the address's bucket, before anything is checked.

    A coroutine on purpose: FastAPI runs a plain function dependency in a
    worker thread, where two requests could meet inside the buckets.
    `Retry-After` is rounded up to whole seconds, as the header requires.
    """
    wait = _sign_in_bucket(request).take(client_address(request))
    if wait is not None:
        raise RateLimitedError(retry_after=max(1, math.ceil(wait)))


__all__ = [
    "SIGN_INS_PER_MINUTE",
    "SIGN_IN_BURST",
    "TokenBucket",
    "client_address",
    "limit_sign_ins",
]
