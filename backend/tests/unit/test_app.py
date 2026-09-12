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
