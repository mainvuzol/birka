"""How often one address may sign in (`app/core/rate_limit.py`).

The buckets are tested on a clock of the test's own, and the endpoint through
the real app. A sign-in here carries launch data that fails its signature, so
nothing reaches the database: the limit is taken before anything is checked.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest
from starlette.requests import Request

from app.api.deps import session_dependency
from app.core.config import Settings
from app.core.rate_limit import (
    SIGN_IN_BURST,
    SIGN_INS_PER_MINUTE,
    TokenBucket,
    client_address,
)
from app.main import create_app
from tests.conftest import TEST_BOT_TOKEN


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_a_whole_burst_is_taken_at_once_then_the_next_waits() -> None:
    clock = Clock()
    bucket = TokenBucket(per_minute=30, burst=30, clock=clock)

    assert [bucket.take("shop") for _ in range(30)] == [None] * 30
    # One every two seconds from then on.
    assert bucket.take("shop") == pytest.approx(2.0)


def test_a_refusal_takes_nothing_and_the_bucket_refills() -> None:
    clock = Clock()
    bucket = TokenBucket(per_minute=30, burst=3, clock=clock)
    for _ in range(3):
        bucket.take("shop")

    for _ in range(10):
        assert bucket.take("shop") == pytest.approx(2.0)
    clock.now += 1.0
    assert bucket.take("shop") == pytest.approx(1.0)
    clock.now += 1.0
    assert bucket.take("shop") is None
    assert bucket.take("shop") == pytest.approx(2.0)
    # Never more than the burst, however long it waits.
    clock.now += 3600
    assert [bucket.take("shop") for _ in range(4)][-1] == pytest.approx(2.0)


def test_another_address_has_its_own_bucket() -> None:
    clock = Clock()
    bucket = TokenBucket(per_minute=30, burst=2, clock=clock)
    bucket.take("shop")
    bucket.take("shop")

    assert bucket.take("shop") is not None
    assert bucket.take("home") is None


def test_memory_is_bounded() -> None:
    clock = Clock()
    bucket = TokenBucket(per_minute=60, burst=5, max_keys=3, clock=clock)
    for address in ("a", "b", "c", "d"):
        bucket.take(address)
        clock.now += 1

    # Past the bound, the longest idle goes: forgetting it only lets it in.
    assert len(bucket) == 3
    for _ in range(4):
        assert bucket.take("a") is None
    # A bucket that has refilled is the same as none, and is dropped.
    clock.now += 60
    bucket.take("e")
    assert len(bucket) == 1


def test_a_shop_never_meets_the_default() -> None:
    """A technical default, not an owner rule: a whole shop behind one
    address opening the app at once, each person twice, stays well inside."""
    assert SIGN_IN_BURST >= 30
    assert SIGN_INS_PER_MINUTE >= 30


def _request(host: str | None) -> Request:
    return Request({"type": "http", "client": None if host is None else (host, 50000)})


@pytest.mark.parametrize(
    ("host", "address"),
    [
        ("203.0.113.7", "203.0.113.7"),
        # A phone is given a whole /64, and counts once in it.
        ("2001:db8:1:2:aaaa::1", "2001:db8:1:2::/64"),
        ("2001:db8:1:2:bbbb::9", "2001:db8:1:2::/64"),
        ("2001:db8:1:3::1", "2001:db8:1:3::/64"),
        ("::ffff:203.0.113.7", "203.0.113.7"),
        ("testclient", "testclient"),
        (None, ""),
    ],
)
def test_whom_a_bucket_belongs_to(host: str | None, address: str) -> None:
    assert client_address(_request(host)) == address


# --- through the app ----------------------------------------------------------


def _app():
    app = create_app(
        Settings(
            app_env="local",
            log_json=False,
            telegram_bot_token=TEST_BOT_TOKEN,
            session_secret="unit-test-session-secret-at-least-32-bytes",
        )
    )

    async def no_database() -> AsyncIterator[None]:
        yield None

    app.dependency_overrides[session_dependency] = no_database
    return app


async def _sign_in(app, address: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app, client=(address, 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post(
            "/api/v1/auth/telegram", json={"init_data": "auth_date=1&hash=forged"}
        )


async def test_sign_ins_past_the_burst_are_refused_with_when_to_come_back() -> None:
    app = _app()

    tried = [await _sign_in(app, "203.0.113.7") for _ in range(SIGN_IN_BURST)]
    refused = await _sign_in(app, "203.0.113.7")

    # Each of the burst was looked at, and refused for what it carried.
    assert {(r.status_code, r.json()["code"]) for r in tried} == {(401, "INVALID_INIT_DATA")}
    assert refused.status_code == 429
    body = refused.json()
    assert body["code"] == "RATE_LIMITED"
    assert body["details"] == {"retry_after": 2}
    assert refused.headers["Retry-After"] == "2"
    # Another address is not held up by it.
    assert (await _sign_in(app, "198.51.100.20")).json()["code"] == "INVALID_INIT_DATA"


async def test_the_app_refills_and_each_app_counts_on_its_own() -> None:
    app = _app()
    clock = Clock()
    app.state.sign_in_bucket = TokenBucket(per_minute=30, burst=1, clock=clock)

    assert (await _sign_in(app, "203.0.113.7")).status_code == 401
    assert (await _sign_in(app, "203.0.113.7")).status_code == 429
    clock.now += 2
    assert (await _sign_in(app, "203.0.113.7")).status_code == 401
    # A new app starts with full buckets.
    assert (await _sign_in(_app(), "203.0.113.7")).status_code == 401


async def test_only_the_sign_in_is_limited() -> None:
    app = _app()
    app.state.sign_in_bucket = TokenBucket(per_minute=1, burst=1, clock=Clock())
    await _sign_in(app, "203.0.113.7")
    assert (await _sign_in(app, "203.0.113.7")).status_code == 429

    transport = httpx.ASGITransport(app=app, client=("203.0.113.7", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/api/v1/health")).status_code == 200
