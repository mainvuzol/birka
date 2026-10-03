"""Settings validation — failing closed in deployed environments."""

from __future__ import annotations

import os

import pytest

from app.core.config import MIN_SESSION_SECRET_BYTES, Settings

GOOD_SECRET = "x" * MIN_SESSION_SECRET_BYTES


@pytest.fixture(autouse=True)
def _isolate_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Settings reads BIRKA_* and .env by default.

    Without this, a developer who exports BIRKA_SESSION_SECRET makes the
    "refuses to start without a secret" tests pass for the wrong reason.
    """
    for name in list(os.environ):
        if name.startswith("BIRKA_"):
            monkeypatch.delenv(name, raising=False)


def test_local_environment_starts_without_secrets() -> None:
    """Developers must not need production secrets to run tests."""
    Settings(_env_file=None, app_env="local").require_runtime_secrets()


def test_production_refuses_to_start_without_a_bot_token() -> None:
    settings = Settings(_env_file=None, app_env="production", session_secret=GOOD_SECRET)

    with pytest.raises(RuntimeError, match="BIRKA_TELEGRAM_BOT_TOKEN"):
        settings.require_runtime_secrets()


def test_production_refuses_to_start_without_a_session_secret() -> None:
    settings = Settings(_env_file=None, app_env="production", telegram_bot_token="123:abc")

    with pytest.raises(RuntimeError, match="BIRKA_SESSION_SECRET"):
        settings.require_runtime_secrets()


def test_production_refuses_a_weak_session_secret() -> None:
    """RFC 7518 section 3.2: an HS256 key below 32 bytes weakens the signature."""
    settings = Settings(
        _env_file=None, app_env="production", telegram_bot_token="123:abc", session_secret="short"
    )

    with pytest.raises(RuntimeError, match="at least 32 bytes"):
        settings.require_runtime_secrets()


def test_production_starts_with_complete_secrets() -> None:
    Settings(
        app_env="production", telegram_bot_token="123:abc", session_secret=GOOD_SECRET
    ).require_runtime_secrets()


def test_staging_is_treated_as_production() -> None:
    with pytest.raises(RuntimeError):
        Settings(_env_file=None, app_env="staging").require_runtime_secrets()


def test_database_url_must_use_the_async_driver() -> None:
    """A sync driver would block the event loop under load."""
    with pytest.raises(ValueError, match="asyncpg"):
        Settings(_env_file=None, database_url="postgresql://u:p@localhost/db")


def test_secrets_are_not_rendered_in_repr() -> None:
    settings = Settings(_env_file=None, app_env="local", session_secret="super-secret-value")

    assert "super-secret-value" not in repr(settings)


@pytest.mark.parametrize(
    ("raw", "ids"),
    [
        ("", []),
        ("123456789", [123456789]),
        ("123, 456", [123, 456]),
        ("123;456 789", [123, 456, 789]),
        # A typo drops that part rather than refusing the setting: a refused
        # setting would stop the watcher and every alert with it.
        ("123,@admin,45x6", [123]),
        ("１２３", []),
    ],
)
def test_administrators_telegram_ids_are_read_leniently(
    monkeypatch: pytest.MonkeyPatch, raw: str, ids: list[int]
) -> None:
    monkeypatch.setenv("BIRKA_ADMIN_TELEGRAM_IDS", raw)
    assert Settings(_env_file=None).admin_telegram_ids == ids


@pytest.mark.parametrize("raw", ["", "   "])
def test_an_empty_heartbeat_or_sentry_setting_is_unset(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    """Compose passes an unset variable as an empty string (`${VAR:-}`)."""
    monkeypatch.setenv("BIRKA_HEARTBEAT_URL", raw)
    monkeypatch.setenv("BIRKA_SENTRY_DSN", raw)
    settings = Settings(_env_file=None)
    assert settings.heartbeat_url is None
    assert settings.sentry_dsn is None
