"""Application settings.

Everything the application needs to run comes from the environment. No secret
has a usable default: `SECURITY: production` settings must be supplied, and the
application refuses to start without them.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AppEnv = Literal["local", "ci", "staging", "production"]

# RFC 7518 section 3.2 minimum for HS256.
MIN_SESSION_SECRET_BYTES = 32


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables prefixed ``BIRKA_``."""

    model_config = SettingsConfigDict(
        env_prefix="BIRKA_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: AppEnv = "local"
    debug: bool = False

    # --- database ----------------------------------------------------------
    # PostgreSQL 15+ is required: the catalog schema uses UNIQUE NULLS NOT
    # DISTINCT (ADR-0002). The deployed version is pinned to 17.
    database_url: str = "postgresql+asyncpg://birka:birka@localhost:5432/birka"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_echo: bool = False

    # --- telegram ----------------------------------------------------------
    telegram_bot_token: SecretStr = SecretStr("")
    # How old Telegram initData may be when it is presented for login.
    telegram_init_data_max_age_seconds: int = 3600

    # --- session -----------------------------------------------------------
    session_secret: SecretStr = SecretStr("")
    # Owner decision, 2026-10-03: a seller stays signed in 12 hours.
    session_ttl_seconds: int = 12 * 3600
    # Sign-ins one address may make (`app.core.rate_limit`): a burst, then so
    # many a minute. Raised only for the end-to-end journeys, which sign in
    # from one address far more often than people do.
    sign_ins_per_minute: int = Field(default=30, gt=0)
    sign_in_burst: int = Field(default=30, gt=0)

    # --- the site's certificate ---------------------------------------------
    # The domain the Mini App is served on, as Caddy serves it (BIRKA_DOMAIN
    # in compose). The owner decided on 2026-10-03 that the bot tells them a
    # week before its certificate runs out; `scripts.backup_watch` looks.
    # Unset, localhost or a bare address: there is no public certificate, and
    # nothing is looked at.
    public_domain: str | None = None
    # Where the watcher asks for that certificate: Caddy, on the compose
    # network, asked for `public_domain` as a browser would ask for it.
    edge_host: str = "caddy"
    edge_port: int = 443

    # --- observability -----------------------------------------------------
    log_level: str = "INFO"
    log_json: bool = True
    sentry_dsn: str | None = None

    # --- money -------------------------------------------------------------
    # Confirmed business fact F33. Stored explicitly on every monetary row so
    # historical data stays self-describing.
    default_currency_code: str = Field(default="UAH", min_length=3, max_length=3)

    @field_validator("database_url")
    @classmethod
    def _require_async_driver(cls, value: str) -> str:
        if not value.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "database_url must use the postgresql+asyncpg driver; "
                f"got {value.split('://', 1)[0]!r}"
            )
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env in ("staging", "production")

    def require_runtime_secrets(self) -> None:
        """Fail fast when a deployed environment is missing a secret.

        Called during application startup rather than at import time, so tests
        and tooling can import the module without a full environment.
        """
        if not self.is_production:
            return

        problems: list[str] = []
        if not self.telegram_bot_token.get_secret_value():
            problems.append("BIRKA_TELEGRAM_BOT_TOKEN is not set")

        session_secret = self.session_secret.get_secret_value()
        if not session_secret:
            problems.append("BIRKA_SESSION_SECRET is not set")
        elif len(session_secret.encode("utf-8")) < MIN_SESSION_SECRET_BYTES:
            # RFC 7518 §3.2: an HS256 key shorter than the hash output weakens
            # the signature. Session tokens are the only thing standing between
            # a stranger and a seller's account.
            problems.append(
                f"BIRKA_SESSION_SECRET must be at least {MIN_SESSION_SECRET_BYTES} bytes"
            )

        if problems:
            raise RuntimeError(f"Refusing to start in {self.app_env}: " + "; ".join(problems))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings singleton."""
    return Settings()
