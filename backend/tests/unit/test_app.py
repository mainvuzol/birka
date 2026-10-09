"""Application wiring: correlation ids, error mapping, auth guards.

These exercise the real ASGI app. Nothing here touches the database.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.correlation import REQUEST_ID_HEADER
from app.core.errors import DomainError, PermissionDeniedError
from app.main import create_app

TEST_SECRET = "unit-test-session-secret-at-least-32-bytes"


@pytest.fixture
def client() -> Iterator[TestClient]:
    settings = Settings(app_env="local", log_json=False, session_secret=TEST_SECRET)
    app = create_app(settings)

    @app.get("/_test/boom")
    async def _boom() -> None:
        raise PermissionDeniedError("nope", permission="sale:create")

    # Entering the context manager runs the lifespan, which is what initialises
    # the engine. Without it the app under test is not the app that runs.
    with TestClient(app) as test_client:
        yield test_client


def test_health_reports_the_environment(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "environment": "local"}


def test_every_response_carries_a_request_id(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    request_id = response.headers[REQUEST_ID_HEADER]
    assert uuid.UUID(request_id)


def test_a_client_supplied_request_id_is_echoed(client: TestClient) -> None:
    """Lets a mobile client correlate its own retry with our logs."""
    response = client.get("/api/v1/health", headers={REQUEST_ID_HEADER: "abc-123"})

    assert response.headers[REQUEST_ID_HEADER] == "abc-123"


def test_a_hostile_request_id_is_replaced_not_echoed(client: TestClient) -> None:
    """Header values reach log files; control characters are not echoed back."""
    response = client.get("/api/v1/health", headers={REQUEST_ID_HEADER: "bad value;drop"})

    echoed = response.headers[REQUEST_ID_HEADER]
    assert echoed != "bad value;drop"
    assert uuid.UUID(echoed)


def test_an_overlong_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={REQUEST_ID_HEADER: "x" * 500})

    assert uuid.UUID(response.headers[REQUEST_ID_HEADER])


def test_domain_errors_map_to_a_stable_payload(client: TestClient) -> None:
    response = client.get("/_test/boom")

    assert response.status_code == 403
    body = response.json()
    assert body["code"] == "PERMISSION_DENIED"
    assert body["details"]["permission"] == "sale:create"


def test_me_requires_a_token(client: TestClient) -> None:
    response = client.get("/api/v1/me")

    assert response.status_code == 401
    assert response.json()["code"] == "AUTHENTICATION_FAILED"


def test_me_rejects_a_non_bearer_scheme(client: TestClient) -> None:
    response = client.get("/api/v1/me", headers={"Authorization": "Basic abc"})

    assert response.status_code == 401


def test_me_rejects_a_forged_token(client: TestClient) -> None:
    response = client.get("/api/v1/me", headers={"Authorization": "Bearer not.a.token"})

    assert response.status_code == 401


def test_auth_rejects_an_empty_init_data(client: TestClient) -> None:
    response = client.post("/api/v1/auth/telegram", json={"init_data": ""})

    assert response.status_code == 422


def test_docs_are_exposed_outside_production() -> None:
    client = TestClient(create_app(Settings(app_env="local", session_secret=TEST_SECRET)))

    assert client.get("/docs").status_code == 200


def test_docs_are_hidden_in_production() -> None:
    settings = Settings(
        app_env="production",
        session_secret=TEST_SECRET,
        telegram_bot_token="123456:token",
    )
    client = TestClient(create_app(settings))

    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_domain_error_payload_omits_empty_details() -> None:
    assert DomainError("boom").to_payload() == {"code": "INTERNAL_ERROR", "message": "boom"}


def test_sentry_scrubber_removes_the_request_body() -> None:
    """Raw initData is a usable credential; it must never reach Sentry.

    sentry-sdk 2.x attaches request bodies regardless of send_default_pii, so
    this scrubber — not that flag — is what protects the login payload.
    """
    from app.core.sentry import scrub_request_body

    event = {
        "request": {
            "url": "/api/v1/auth/telegram",
            "data": {"init_data": "user=...&hash=secret"},
            "cookies": {"session": "abc"},
            "headers": {"Authorization": "Bearer token", "User-Agent": "tg"},
        }
    }

    scrubbed = scrub_request_body(event, {})

    assert "data" not in scrubbed["request"]
    assert "cookies" not in scrubbed["request"]
    assert "Authorization" not in scrubbed["request"]["headers"]
    assert scrubbed["request"]["headers"]["User-Agent"] == "tg"


def test_sentry_scrubber_tolerates_an_event_without_a_request() -> None:
    from app.core.sentry import scrub_request_body

    assert scrub_request_body({"message": "boom"}, {}) == {"message": "boom"}


@pytest.mark.parametrize(
    "invalid_value",
    [
        {"\ud800": "value"},
        {"nested": [{"\udfff": "value"}]},
        float("nan"),
        float("inf"),
        float("-inf"),
        {"nested": [float("nan"), {"amount": float("inf")}]},
    ],
)
def test_validation_errors_remain_json_encodable(client: TestClient, invalid_value: object) -> None:
    import json

    # Raw JSON reaches the actual auth route and validation handler. Invalid
    # init_data must be refused before authentication/database operations.
    response = client.post(
        "/api/v1/auth/telegram",
        content=json.dumps({"init_data": invalid_value}),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail[0]["loc"] == ["body", "init_data"]
    assert detail[0]["type"] == "string_type"
    # Strict serialization proves there is no surviving NaN, Infinity or
    # surrogate, even inside nested input dictionaries.
    json.dumps(detail, ensure_ascii=False, allow_nan=False).encode("utf-8")


def test_validation_errors_preserve_safe_input_details(client: TestClient) -> None:
    original = {"ключ": [True, 12, 1.25, None, "текст"]}
    response = client.post("/api/v1/auth/telegram", json={"init_data": original})
    assert response.status_code == 422
    assert response.json()["detail"][0]["input"] == original


def test_a_stock_list_s_refusal_names_a_key_or_a_value_by_sixty_characters_at_most() -> None:
    """Review, 2026-10-09: on `/api/v1/snapshots` a refusal loses its
    `input` and `url`, and each string of its `loc` and `ctx` is cut to its
    first sixty characters and «…»; what is short, and what is no string,
    stays as it is."""
    from app.main import MAX_NAMED, _without_input

    long = "з" * 300
    error = {
        "type": "stock_file_size_repeated",
        "loc": ("body", "file", "lines", 0, long),
        "msg": "The size is named twice",
        "input": {"text": long},
        "ctx": {"size": long, "line": 1, "field": "size"},
        "url": "https://errors.pydantic.dev",
    }

    assert MAX_NAMED == 60
    assert _without_input(error) == {
        "type": "stock_file_size_repeated",
        "loc": ["body", "file", "lines", 0, "з" * 60 + "…"],
        "msg": "The size is named twice",
        "ctx": {"size": "з" * 60 + "…", "line": 1, "field": "size"},
    }
    assert _without_input({"loc": ("body",), "ctx": None}) == {"loc": ["body"], "ctx": None}
    assert _without_input("not a refusal") == "not a refusal"
