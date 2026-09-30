"""What a backup and a restore drill share: the PostgreSQL client tools, and
one description of a database that both sides can be compared by.

`describe` is read twice — from the source, inside the very snapshot
`pg_dump` copies, and from the restored copy — so every fact in a backup's
manifest is a fact the restored copy must reproduce exactly.
"""

from __future__ import annotations

import asyncio
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


async def run(executable: Path, *args: str, env: dict[str, str] | None = None) -> str:
    process = await asyncio.create_subprocess_exec(
        str(executable),
        *args,
        env={**os.environ, **(env or {})},
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await process.communicate()
    if process.returncode != 0:
        tail = err.decode(errors="replace").strip()[-2000:]
        raise ToolError(f"{executable.name} exited with {process.returncode}: {tail}")
    return out.decode(errors="replace")


async def tool_major(executable: Path) -> int:
    version = await run(executable, "--version")
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
