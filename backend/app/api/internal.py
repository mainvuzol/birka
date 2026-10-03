"""What the API says about itself: whether it can serve, and how sign-ins go.

Two readers, two answers (owner decision, 2026-10-03: trouble on the server
is told by the bot):

- `GET /api/v1/ready` (router.py), public through Caddy: 200 when the
  database answers and its schema is not behind this code, else 503 with
  which. For whatever checks from outside or from Docker.
- `GET /internal/status`, here: what the watcher (`scripts.backup_watch`)
  reads over the compose network, at `{settings.api_url}/internal/status`,
  to decide when the owner is told. It is not under `/api`, so Caddy, which
  passes only `/api/*` to the API (infra/Caddyfile), never serves it to the
  internet. It answers 200 whenever the process runs, whatever the database
  does, because "the database does not answer" is one of its answers.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from alembic.script import ScriptDirectory
from fastapi import APIRouter, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.applications import Starlette

from app.api.deps import SessionDep, SettingsDep
from app.core.logging import get_logger
from app.modules.identity.sign_ins import SignInOutcomes

logger = get_logger(__name__)

# The database must answer within this, or it counts as not answering.
READY_WITHIN_SECONDS = 3.0

# Beside `app/` in the repository and in the image (backend/Dockerfile copies
# both), as alembic.ini's `script_location` names it.
_MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"

DatabaseState = Literal["ok", "unreachable", "behind"]


@dataclass(frozen=True, slots=True)
class CodeSchema:
    """The migrations this code ships: their head, and every revision."""

    heads: frozenset[str]
    known: frozenset[str]

    def is_behind(self, revisions: Iterable[str]) -> bool:
        """Whether a database at `revisions` lacks a migration this code needs.

        A revision this code knows but that is not its head is one of the
        head's ancestors (with one head, every revision is): the migration was
        not run. A revision the code does not know is ahead of it, from a
        newer build, and allowed: going back to the previous build alone is a
        documented step (server-runbook, rollback). A database with no
        revision at all was never migrated.
        """
        found = set(revisions)
        if not found:
            return True
        return any(revision in self.known and revision not in self.heads for revision in found)


@lru_cache(maxsize=1)
def code_schema() -> CodeSchema:
    """Read once per process: the migrations do not change under it."""
    script = ScriptDirectory(str(_MIGRATIONS))
    return CodeSchema(
        heads=frozenset(script.get_heads()),
        known=frozenset(revision.revision for revision in script.walk_revisions()),
    )


async def _database_revisions(session: AsyncSession) -> list[str]:
    exists = await session.scalar(text("SELECT to_regclass('alembic_version') IS NOT NULL"))
    if not exists:
        return []
    return list((await session.scalars(text("SELECT version_num FROM alembic_version"))).all())


async def database_state(session: AsyncSession) -> DatabaseState:
    """`ok`, `unreachable` (no answer within `READY_WITHIN_SECONDS`, or an
    error), or `behind` (the schema lacks a migration this code needs)."""
    try:
        async with asyncio.timeout(READY_WITHIN_SECONDS):
            await session.execute(text("SELECT 1"))
            revisions = await _database_revisions(session)
    except Exception as error:
        # Every failure is "does not answer". The kind only is logged: a
        # connection error's text may name the server.
        logger.warning("database.unreachable", error=type(error).__name__)
        return "unreachable"
    schema = code_schema()
    if schema.is_behind(revisions):
        logger.warning(
            "database.schema_behind", database=sorted(revisions), code=sorted(schema.heads)
        )
        return "behind"
    return "ok"


def sign_in_outcomes(app: Starlette) -> SignInOutcomes:
    """The app's own figures, made on first use: each app built by
    `create_app` (a test's, too) counts on its own."""
    outcomes: SignInOutcomes | None = getattr(app.state, "sign_ins", None)
    if outcomes is None:
        outcomes = SignInOutcomes()
        app.state.sign_ins = outcomes
    return outcomes


router = APIRouter(include_in_schema=False)


@router.get("/status")
async def status(request: Request, session: SessionDep, settings: SettingsDep) -> dict[str, Any]:
    """The process, its build, its database and its sign-ins
    (`.ai/decisions/ADR-0011-failures-are-visible.md`). `started_at` changes
    when the process restarts, which also starts the sign-in figures again."""
    started_at = request.app.state.started_at
    return {
        "started_at": started_at.isoformat(timespec="seconds"),
        "release": settings.release,
        "database": await database_state(session),
        "sign_ins": sign_in_outcomes(request.app).snapshot(),
    }


__all__ = [
    "READY_WITHIN_SECONDS",
    "CodeSchema",
    "DatabaseState",
    "code_schema",
    "database_state",
    "router",
    "sign_in_outcomes",
]
