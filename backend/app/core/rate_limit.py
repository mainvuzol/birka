"""How often one address may sign in, or report a broken screen, and how
often one signed-in person may ask anything.

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

`POST /client-errors` is the other request anyone may make without a
session: a screen can break before its sign-in. It writes one log line, and
its own bucket per address (**10 at once, refilled at 10 a minute**, also a
technical default) keeps one phone stuck in a crash loop, or anyone else,
from filling the server's log.

Every signed-in request counts against its person, on all their phones
together (owner decision, 2026-10-10; ADR-0020): **300 at once, refilled at
300 a minute**, and for the few that parse a file or a catalogue line on the
API's one event loop, **20 at once, refilled at 20 a minute**. Measured on the
end-to-end journeys (2026-10-10): the busiest makes 51 requests and 7 heavy
ones, and an opened app about 30 at once, so nobody working meets either; one
person's token, or one stolen, can no longer keep the API busy for everyone
else. The person is the session token's own `sub`, read before any database
query, and the refusal says nothing was done. A refused person is logged once
a minute, with how many were refused, not once a refusal; the owner is not
told (owner decision, 2026-10-10).

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
import uuid
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Request

from app.core.config import Settings, get_settings
from app.core.errors import RateLimitedError, TooManyRequestsError
from app.core.logging import get_logger

logger = get_logger(__name__)

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


def _app_bucket(
    request: Request, name: str, make: Callable[[Settings], TokenBucket]
) -> TokenBucket:
    """The app's own buckets, made on first use: each app built by
    `create_app` (a test's, too) counts on its own."""
    state = request.app.state
    bucket: TokenBucket | None = getattr(state, name, None)
    if bucket is None:
        settings: Settings = getattr(state, "settings", None) or get_settings()
        bucket = make(settings)
        setattr(state, name, bucket)
    return bucket


def _sign_in_bucket(request: Request) -> TokenBucket:
    # Settings raise the numbers (BIRKA_SIGN_INS_PER_MINUTE,
    # BIRKA_SIGN_IN_BURST) only for a run that signs in from one address far
    # more often than people do: the end-to-end journeys. A server keeps the
    # defaults.
    return _app_bucket(
        request,
        "sign_in_bucket",
        lambda settings: TokenBucket(
            per_minute=settings.sign_ins_per_minute, burst=settings.sign_in_burst
        ),
    )


def _client_error_bucket(request: Request) -> TokenBucket:
    return _app_bucket(
        request,
        "client_error_bucket",
        lambda settings: TokenBucket(
            per_minute=settings.client_errors_per_minute, burst=settings.client_error_burst
        ),
    )


def _refuse_past(bucket: TokenBucket, request: Request, message: str | None = None) -> None:
    """`Retry-After` is rounded up to whole seconds, as the header requires."""
    wait = bucket.take(client_address(request))
    if wait is not None:
        raise RateLimitedError(retry_after=max(1, math.ceil(wait)), message=message)


def _person_bucket(request: Request) -> TokenBucket:
    # Settings raise these only for the end-to-end journeys and the hot path,
    # each one person asking far faster than anyone can. A server keeps the
    # defaults.
    return _app_bucket(
        request,
        "person_bucket",
        lambda settings: TokenBucket(
            per_minute=settings.requests_per_minute_per_person,
            burst=settings.request_burst_per_person,
        ),
    )


def _heavy_bucket(request: Request) -> TokenBucket:
    return _app_bucket(
        request,
        "heavy_bucket",
        lambda settings: TokenBucket(
            per_minute=settings.heavy_requests_per_minute_per_person,
            burst=settings.heavy_request_burst_per_person,
        ),
    )


# How often a person still being refused is written to the log again.
REFUSALS_LOGGED_EVERY_SECONDS = 60.0


def _refuse_person(request: Request, bucket: TokenBucket, work: str, person: uuid.UUID) -> None:
    """Take one of the person's tokens, or refuse, logging the refusals of a
    person once a minute with their count."""
    wait = bucket.take(str(person))
    if wait is None:
        return
    retry_after = max(1, math.ceil(wait))
    state = request.app.state
    notes: OrderedDict[tuple[str, uuid.UUID], tuple[int, float]] | None = getattr(
        state, "person_refusals", None
    )
    if notes is None:
        notes = OrderedDict()
        state.person_refusals = notes
    now = time.monotonic()
    count, logged_at = notes.pop((work, person), (0, -REFUSALS_LOGGED_EVERY_SECONDS))
    count += 1
    if now - logged_at >= REFUSALS_LOGGED_EVERY_SECONDS:
        logger.warning(
            "person.rate_limited",
            user_id=str(person),
            work=work,
            refused=count,
            retry_after=retry_after,
        )
        count, logged_at = 0, now
    notes[(work, person)] = (count, logged_at)
    while len(notes) > 10_000:
        notes.popitem(last=False)
    raise TooManyRequestsError(retry_after=retry_after)


def limit_person(request: Request, person: uuid.UUID) -> None:
    """Refuse a signed-in request past its person's bucket.

    Called from `get_current_scope`, a coroutine, right after the session
    token is read and before any database query: never from a worker thread.
    """
    _refuse_person(request, _person_bucket(request), "requests", person)


def limit_heavy_work(request: Request, person: uuid.UUID) -> None:
    """Refuse a request that parses a file or a catalogue line past its
    person's own bucket for those (`HeavyScopeDep`)."""
    _refuse_person(request, _heavy_bucket(request), "heavy", person)


async def limit_sign_ins(request: Request) -> None:
    """Refuse a sign-in past the address's bucket, before anything is checked.

    A coroutine on purpose: FastAPI runs a plain function dependency in a
    worker thread, where two requests could meet inside the buckets.
    """
    _refuse_past(_sign_in_bucket(request), request)


async def limit_client_errors(request: Request) -> None:
    """Refuse a broken screen's note past the address's bucket, before its
    body is read. A coroutine for the same reason as `limit_sign_ins`."""
    _refuse_past(
        _client_error_bucket(request),
        request,
        "Too many error reports from this address; wait and try again",
    )


__all__ = [
    "SIGN_INS_PER_MINUTE",
    "SIGN_IN_BURST",
    "TokenBucket",
    "client_address",
    "limit_client_errors",
    "limit_heavy_work",
    "limit_person",
    "limit_sign_ins",
]
