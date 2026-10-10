"""How often one signed-in person may ask anything (`app/core/rate_limit.py`).

Owner decision, 2026-10-10 (ADR-0020): every person the same, on all their
phones together; a refusal says when to come back and that nothing was done;
the server's log, not the owner, hears of it.

The real app, with two routes of the test's own beside its own: one any
signed-in person may ask, one counted as heavy. The database's two questions
about the person are answered by stand-ins that count how often they were
asked, so a refusal is seen to come before them.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from structlog.testing import capture_logs

from app.api import deps
from app.api.deps import HeavyScopeDep, ScopeDep, session_dependency
from app.core.config import Settings
from app.core.rate_limit import TokenBucket
from app.main import create_app
from app.modules.authz.scope import RequestScope
from app.modules.identity.session import issue_session_token
from tests.conftest import TEST_BOT_TOKEN

SECRET = "unit-test-session-secret-at-least-32-bytes"
ORGANIZATION = uuid.uuid4()


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Database:
    """The person's two lookups, counted."""

    def __init__(self) -> None:
        self.asked = 0

    async def user(self, _session: Any, user_id: uuid.UUID) -> SimpleNamespace:
        self.asked += 1
        return SimpleNamespace(id=user_id, session_epoch=0)

    async def scope(self, _session: Any, user_id: uuid.UUID, *, reading: bool) -> RequestScope:
        return RequestScope(user_id=user_id, organization_id=ORGANIZATION, reading=reading)


@pytest.fixture
def database(monkeypatch: pytest.MonkeyPatch) -> Database:
    db = Database()
    monkeypatch.setattr(deps, "assert_user_is_active", db.user)
    monkeypatch.setattr(deps, "resolve_scope", db.scope)
    return db


def _app(**limits: int) -> Any:
    app = create_app(
        Settings(
            app_env="local",
            log_json=False,
            telegram_bot_token=TEST_BOT_TOKEN,
            session_secret=SECRET,
            **limits,
        )
    )

    async def no_database() -> AsyncIterator[None]:
        yield None

    async def light(scope: ScopeDep) -> dict[str, str]:
        return {"user": str(scope.user_id)}

    async def heavy(scope: HeavyScopeDep) -> dict[str, str]:
        return {"user": str(scope.user_id)}

    app.dependency_overrides[session_dependency] = no_database
    app.add_api_route("/test/light", light, methods=["GET"])
    app.add_api_route("/test/heavy", heavy, methods=["POST"])
    return app


def _token(person: uuid.UUID) -> str:
    token, _ = issue_session_token(
        user_id=person, organization_id=ORGANIZATION, secret=SECRET, ttl_seconds=3600
    )
    return token


async def _ask(app: Any, token: str, path: str = "/test/light") -> httpx.Response:
    transport = httpx.ASGITransport(app=app, client=("203.0.113.7", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {"Authorization": f"Bearer {token}"}
        if path == "/test/heavy":
            return await client.post(path, headers=headers)
        return await client.get(path, headers=headers)


async def test_a_person_past_their_burst_is_refused_before_the_database(
    database: Database,
) -> None:
    app = _app(requests_per_minute_per_person=60, request_burst_per_person=3)
    token = _token(uuid.uuid4())

    answers = [await _ask(app, token) for _ in range(3)]
    refused = await _ask(app, token)

    assert [a.status_code for a in answers] == [200, 200, 200]
    assert refused.status_code == 429
    assert refused.json() == {
        "code": "TOO_MANY_REQUESTS",
        "message": "Too many requests from this person; wait and try again",
        "details": {"retry_after": 1},
    }
    assert refused.headers["Retry-After"] == "1"
    # Refused before the database was asked who this is.
    assert database.asked == 3


async def test_a_person_counts_once_on_all_their_phones_and_nobody_else_waits(
    database: Database,
) -> None:
    app = _app(requests_per_minute_per_person=60, request_burst_per_person=2)
    seller = uuid.uuid4()
    phone, tablet = _token(seller), _token(seller)

    assert (await _ask(app, phone)).status_code == 200
    assert (await _ask(app, tablet)).status_code == 200
    assert (await _ask(app, phone)).status_code == 429
    assert (await _ask(app, tablet)).status_code == 429
    # Another person, even in the same shop behind the same address, is not
    # held up.
    assert (await _ask(app, _token(uuid.uuid4()))).status_code == 200


async def test_the_bucket_refills_and_a_new_app_starts_full(database: Database) -> None:
    app = _app()
    clock = Clock()
    app.state.person_bucket = TokenBucket(per_minute=60, burst=1, clock=clock)
    token = _token(uuid.uuid4())

    assert (await _ask(app, token)).status_code == 200
    assert (await _ask(app, token)).status_code == 429
    clock.now += 1
    assert (await _ask(app, token)).status_code == 200
    assert (await _ask(_app(), token)).status_code == 200


async def test_heavy_work_has_its_own_bucket_and_counts_in_the_other_too(
    database: Database,
) -> None:
    app = _app(
        requests_per_minute_per_person=60,
        request_burst_per_person=4,
        heavy_requests_per_minute_per_person=60,
        heavy_request_burst_per_person=2,
    )
    token = _token(uuid.uuid4())

    assert (await _ask(app, token, "/test/heavy")).status_code == 200
    assert (await _ask(app, token, "/test/heavy")).status_code == 200
    heavy = await _ask(app, token, "/test/heavy")
    assert heavy.status_code == 429
    assert heavy.json()["code"] == "TOO_MANY_REQUESTS"
    # The light bucket still has one: the three heavy ones took three of four.
    assert (await _ask(app, token)).status_code == 200
    assert (await _ask(app, token)).status_code == 429


async def test_a_request_without_a_valid_session_takes_nothing(database: Database) -> None:
    app = _app(requests_per_minute_per_person=60, request_burst_per_person=1)
    person = uuid.uuid4()
    forged, _ = issue_session_token(
        user_id=person,
        organization_id=ORGANIZATION,
        secret="another-secret-that-is-at-least-32-bytes",
        ttl_seconds=3600,
    )

    assert (await _ask(app, forged)).status_code == 401
    assert (await _ask(app, forged)).status_code == 401
    # The person's own one is still there.
    assert (await _ask(app, _token(person))).status_code == 200
    transport = httpx.ASGITransport(app=app, client=("203.0.113.7", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/api/v1/health")).status_code == 200


async def test_refusals_are_logged_once_a_minute_with_how_many(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = _app(requests_per_minute_per_person=60, request_burst_per_person=1)
    clock = Clock()
    monkeypatch.setattr("app.core.rate_limit.time.monotonic", clock)
    person = uuid.uuid4()
    token = _token(person)

    with capture_logs() as lines:
        await _ask(app, token)
        for _ in range(4):
            await _ask(app, token)
        clock.now += 61
        app.state.person_bucket = TokenBucket(per_minute=60, burst=1, clock=lambda: 0.0)
        await _ask(app, token)
        await _ask(app, token)

    limited = [line for line in lines if line["event"] == "person.rate_limited"]
    assert [(line["user_id"], line["work"], line["refused"]) for line in limited] == [
        (str(person), "requests", 1),
        (str(person), "requests", 4),
    ]
    # Not one line per refusal: the general `domain_error` line stays out.
    assert not [line for line in lines if line.get("code") == "TOO_MANY_REQUESTS"]


def test_the_server_keeps_the_measured_numbers() -> None:
    settings = Settings()
    assert (settings.requests_per_minute_per_person, settings.request_burst_per_person) == (
        300,
        300,
    )
    assert (
        settings.heavy_requests_per_minute_per_person,
        settings.heavy_request_burst_per_person,
    ) == (20, 20)


# The requests that parse a file or a catalogue line on the event loop, and
# nothing else (ADR-0020). A new one is added here and given HeavyScopeDep.
HEAVY = {
    ("POST", "/api/v1/catalog/match-decisions"),
    ("POST", "/api/v1/catalog/match-preview"),
    ("POST", "/api/v1/snapshots"),
    ("POST", "/api/v1/snapshots/{snapshot_id}/parts"),
    ("POST", "/api/v1/snapshots/{snapshot_id}/approve"),
}


async def test_exactly_the_heavy_routes_count_as_heavy(database: Database) -> None:
    """Every path the API has, asked twice while the heavy bucket holds one:
    the second is refused exactly where the route counts as heavy. What each
    route then does with a stand-in database does not matter here."""
    app = _app(
        request_burst_per_person=100_000,
        heavy_requests_per_minute_per_person=1,
        heavy_request_burst_per_person=1,
    )
    token = _token(uuid.uuid4())
    heavy = set()
    transport = httpx.ASGITransport(
        app=app, client=("203.0.113.7", 50000), raise_app_exceptions=False
    )
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        for path, operations in app.openapi()["paths"].items():
            if not path.startswith("/api/v1/"):
                continue
            url = path.format_map({name: uuid.uuid4() for name in _parameters(path)})
            for method in operations:
                app.state.heavy_bucket = None
                headers = {"Authorization": f"Bearer {token}"}
                answers = [
                    await client.request(method.upper(), url, headers=headers, json={})
                    for _ in range(2)
                ]
                if answers[1].status_code == 429:
                    assert answers[1].json()["code"] == "TOO_MANY_REQUESTS"
                    heavy.add((method.upper(), path))
    assert heavy == HEAVY


def _parameters(path: str) -> list[str]:
    return [part[1:-1] for part in path.split("/") if part.startswith("{")]
