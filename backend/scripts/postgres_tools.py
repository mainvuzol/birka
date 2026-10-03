"""What a backup and a restore drill share: the PostgreSQL client tools, and
one description of a database that both sides can be compared by.

`describe` is read twice — from the source, inside the very snapshot
`pg_dump` copies, and from the restored copy — so every fact in a backup's
manifest is a fact the restored copy must reproduce exactly.

Every tool runs under a time limit (`run`). A step that hangs — `pg_dump`
waiting behind a lock, a connection that stalls — would otherwise keep the
night, its scratch copy and its container alive with nothing said, and the
owner would hear only "overdue" a day later. The limits are generous, far
beyond what the shops' database takes, and each can be changed by its
variable (`STEP_TIMEOUTS`).
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncConnection

# Cyrillic that the catalog matcher lowercases in SQL. Under the C locale
# lower('ОЛЯ') is 'ОЛЯ', and matching silently misses (infra/docker-compose.yml).
CYRILLIC_PROBE = "ОЛЯ"
CYRILLIC_LOWER = "оля"


class ToolError(RuntimeError):
    """A PostgreSQL client tool is missing, too old, or failed."""


# How long each step may run before it is stopped, in seconds, and the
# variable that changes it. By the tool's name, so a step is limited however
# it is called (`scripts.backup_database` runs `pg_dump` itself).
STEP_TIMEOUTS: dict[str, tuple[str, float]] = {
    "pg_dump": ("BIRKA_BACKUP_DUMP_TIMEOUT_SECONDS", 2 * 3600),
    "pg_restore": ("BIRKA_BACKUP_RESTORE_TIMEOUT_SECONDS", 2 * 3600),
    "age": ("BIRKA_BACKUP_ENCRYPT_TIMEOUT_SECONDS", 30 * 60),
}
# Any other tool run here.
OTHER_TIMEOUT_SECONDS = 30 * 60
# Asking a tool its version takes a moment; one that cannot say in a minute
# will not do the night's work either.
VERSION_TIMEOUT_SECONDS = 60


def timeout_for(name: str) -> float:
    """The limit for the tool called `name`: its variable when set, or its
    default. A variable that is not a positive number fails the step that
    reads it, in words, rather than running it without a limit."""
    if name not in STEP_TIMEOUTS:
        return OTHER_TIMEOUT_SECONDS
    variable, default = STEP_TIMEOUTS[name]
    value = os.environ.get(variable, "").strip()
    if not value:
        return default
    try:
        seconds = float(value)
    except ValueError:
        seconds = 0.0
    if not 0 < seconds < float("inf"):
        raise ToolError(f"{variable} must be a number of seconds above 0, not {value!r}")
    return seconds


def _duration(seconds: float) -> str:
    if seconds >= 3600 and seconds % 3600 == 0:
        return f"{seconds / 3600:g} h"
    if seconds >= 60 and seconds % 60 == 0:
        return f"{seconds / 60:g} min"
    return f"{seconds:g} s"


@dataclass(frozen=True, slots=True)
class Database:
    """One database on one server, from the app's own URL form."""

    url: str

    @property
    def name(self) -> str:
        name = make_url(self.url).database
        if not name:
            raise ValueError("The database URL names no database")
        return name

    def on(self, name: str) -> Database:
        """Another database on the same server, with the same credentials."""
        return Database(make_url(self.url).set(database=name).render_as_string(hide_password=False))

    def libpq_env(self) -> dict[str, str]:
        """The connection for `pg_dump`/`pg_restore`, as environment variables:
        a password on a command line is readable by every user on the host."""
        parsed = make_url(self.url)
        env = {"PGDATABASE": self.name, "PGCONNECT_TIMEOUT": "10"}
        for key, value in (
            ("PGHOST", parsed.host),
            ("PGPORT", parsed.port),
            ("PGUSER", parsed.username),
            ("PGPASSWORD", parsed.password),
        ):
            if value is not None:
                env[key] = str(value)
        return env


def tool(name: str) -> Path:
    """`BIRKA_PG_BIN/<name>` when set, otherwise the first on PATH."""
    directory = os.environ.get("BIRKA_PG_BIN")
    found = Path(directory) / name if directory else None
    if found is None:
        located = shutil.which(name)
        found = Path(located) if located else None
    if found is None or not found.exists():
        raise ToolError(f"{name} not found; install the PostgreSQL client or set BIRKA_PG_BIN")
    return found


async def run(
    executable: Path,
    *args: str,
    env: dict[str, str] | None = None,
    step: str | None = None,
    timeout: float | None = None,
) -> str:
    """Run a tool to the end and return what it printed.

    It is stopped (SIGKILL) once it has run `timeout` seconds — by default
    the limit of its `step`, named after the tool (`timeout_for`) — and the
    step fails saying so. It is stopped too when the night itself is
    cancelled: a tool is never left running behind it.
    """
    step = step or executable.name
    limit = timeout_for(step) if timeout is None else timeout
    process = await asyncio.create_subprocess_exec(
        str(executable),
        *args,
        env={**os.environ, **(env or {})},
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(process.communicate(), limit)
    except TimeoutError:
        await _stop(process)
        variable = STEP_TIMEOUTS.get(step, ("", 0))[0]
        raise ToolError(
            f"{executable.name} did not finish within {_duration(limit)} and was stopped"
            + (f"; {variable} gives it longer" if variable and timeout is None else "")
        ) from None
    except BaseException:
        await _stop(process)
        raise
    if process.returncode != 0:
        tail = err.decode(errors="replace").strip()[-2000:]
        raise ToolError(f"{executable.name} exited with {process.returncode}: {tail}")
    return out.decode(errors="replace")


async def _stop(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        with contextlib.suppress(ProcessLookupError):
            process.kill()
        await process.wait()


async def tool_major(executable: Path) -> int:
    version = await run(executable, "--version", timeout=VERSION_TIMEOUT_SECONDS)
    found = re.search(r"\(PostgreSQL\)\s+(\d+)", version)
    if not found:
        raise ToolError(f"Cannot read the version of {executable}: {version.strip()}")
    return int(found.group(1))


def require_compatible(name: str, tool_version: int, server_version: int) -> None:
    """`pg_dump` refuses a newer server, and an older `pg_restore` may not read
    a newer archive. Said here, before anything is written, in words."""
    if tool_version < server_version:
        raise ToolError(
            f"{name} is PostgreSQL {tool_version} but the server is {server_version}; "
            f"use the client tools of PostgreSQL {server_version} or newer"
        )


async def describe(connection: AsyncConnection) -> dict[str, Any]:
    """Everything a restored copy must reproduce, read in one transaction."""
    version_num = int((await connection.execute(text("SHOW server_version_num"))).scalar_one())
    database = (
        await connection.execute(
            text(
                "SELECT to_jsonb(d) - 'datacl' AS row, pg_encoding_to_char(d.encoding) AS encoding "
                "FROM pg_database d WHERE d.datname = current_database()"
            )
        )
    ).one()
    row = database.row
    has_alembic = (
        await connection.execute(text("SELECT to_regclass('public.alembic_version') IS NOT NULL"))
    ).scalar_one()
    revision = (
        (await connection.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
        if has_alembic
        else None
    )
    statements = (
        await connection.execute(
            text(
                "SELECT c.relname, format('SELECT count(*) FROM public.%I', c.relname) "
                "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname"
            )
        )
    ).all()
    rows = {
        name: int((await connection.execute(text(statement))).scalar_one())
        for name, statement in statements
    }
    triggers = [
        [table, name, enabled]
        for table, name, enabled in (
            await connection.execute(
                text(
                    "SELECT c.relname, t.tgname, t.tgenabled::text "
                    "FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'public' AND NOT t.tgisinternal "
                    "ORDER BY c.relname, t.tgname"
                )
            )
        ).all()
    ]
    lowered = (
        await connection.execute(text("SELECT lower(:probe)"), {"probe": CYRILLIC_PROBE})
    ).scalar_one()
    return {
        "server_version_num": version_num,
        "server_major": version_num // 10000,
        "alembic_revision": revision,
        "locale": {
            "provider": row["datlocprovider"],
            "collate": row["datcollate"],
            "ctype": row["datctype"],
            # `daticulocale` until PostgreSQL 16, `datlocale` from 17.
            "locale": row.get("datlocale") or row.get("daticulocale"),
            "encoding": database.encoding,
        },
        "lower_probe": lowered,
        "tables": rows,
        "triggers": triggers,
    }
