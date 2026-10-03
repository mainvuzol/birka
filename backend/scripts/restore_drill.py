"""Restore a backup into a scratch database and prove it is the same data.

    python -m scripts.restore_drill /backups/birka-20260930T030000Z.dump \\
        --scratch-url postgresql+asyncpg://birka:…@db:5432/postgres

The scratch URL names a server and a maintenance database to connect to.
The drill creates a new database there, `birka_restore_drill_<time>_<random>`,
restores into it, compares it with the manifest written beside the archive,
and drops it again (`--keep` leaves it for inspection, named with `_kept` at
the end). It never writes to any other database, so it may run on the
production server itself.

A drill stopped before it drops its copy — `pg_restore` killed at its time
limit, the container stopped — leaves a whole copy of the shop's data on the
server's disk. The nightly run drops such leftovers before its own drill
(`drop_leftovers`): only names a drill gives a copy it did not mean to keep,
and only once no drill could still be using them. A kept copy is never
dropped; whoever kept it drops it.

A backup that has never been restored is not a backup
(`.ai/skills/disaster-recovery.md`). The drill passes only if:

- the archive is the one the manifest describes (SHA-256), checked before
  anything is created;
- `pg_restore` completes in one transaction, stopping at the first error;
- the copy is at the same migration, with the same tables and the same
  number of rows in each, the same triggers in the same state, and the same
  locale — including lowercasing Cyrillic, which the catalog relies on;
- the stock ledger reconciles for every organization in the copy
  (invariant I3), with the app's own reconciliation query, and no stock is
  left under a merged model (ADR-0008 §9).

The report says how long the restore took: evidence for the recovery time.
Exit status 0 means every check passed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import secrets
import sys
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.modules.inventory.service import find_divergences, stock_under_merged_models
from scripts.backup_database import sha256
from scripts.postgres_tools import (
    CYRILLIC_LOWER,
    Database,
    ToolError,
    describe,
    require_compatible,
    run,
    timeout_for,
    tool,
    tool_major,
)

SCRATCH_PREFIX = "birka_restore_drill_"
# What a drill names a copy it will drop: the prefix, the UTC time it was
# made, and six random hex digits. A kept copy ends in `_kept` instead.
SCRATCH_NAME = re.compile(rf"^{SCRATCH_PREFIX}(\d{{14}})_[0-9a-f]{{6}}$")
KEPT_SUFFIX = "_kept"
# A copy is left over once no drill can still be using it: past the
# restore's own time limit, with an hour to spare for the checks after it.
LEFTOVER_MARGIN = timedelta(hours=1)
BACKEND = Path(__file__).resolve().parents[1]
# A locale name from a manifest goes into CREATE DATABASE, so it is held to
# the characters locale names are made of before it goes anywhere near SQL.
LOCALE_NAME = re.compile(r"^[A-Za-z0-9_.@-]{1,64}$")


@dataclass(frozen=True, slots=True)
class Check:
    name: str
    ok: bool
    detail: str


def code_head() -> str | None:
    """The migration this code expects, to say whether a restore needs one."""
    return ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini"))).get_current_head()


def literal(value: str) -> str:
    if not LOCALE_NAME.fullmatch(value):
        raise ValueError(f"Refusing a locale name that is not one: {value!r}")
    return f"'{value}'"


def create_statement(name: str, locale: dict[str, Any]) -> str:
    """CREATE DATABASE with the source's locale, which decides what lower()
    and ORDER BY do to Ukrainian text."""
    if not name.startswith(SCRATCH_PREFIX) or not re.fullmatch(r"[a-z0-9_]+", name):
        raise ValueError(f"Not a scratch database name: {name!r}")
    parts = [f'CREATE DATABASE "{name}" TEMPLATE template0 ENCODING {literal(locale["encoding"])}']
    provider = locale["provider"]
    collate, ctype = literal(locale["collate"]), literal(locale["ctype"])
    if provider == "i":
        parts.append(f"LOCALE_PROVIDER icu ICU_LOCALE {literal(locale['locale'])}")
    elif provider == "b":
        parts.append(f"LOCALE_PROVIDER builtin BUILTIN_LOCALE {literal(locale['locale'])}")
    elif provider == "c":
        parts.append("LOCALE_PROVIDER libc")
    else:
        raise ValueError(f"Unknown locale provider {provider!r}")
    parts.append(f"LC_COLLATE {collate} LC_CTYPE {ctype}")
    return " ".join(parts)


def scratch_name(now: datetime, *, keep: bool = False) -> str:
    name = f"{SCRATCH_PREFIX}{now.astimezone(UTC):%Y%m%d%H%M%S}_{secrets.token_hex(3)}"
    return name + KEPT_SUFFIX if keep else name


def is_leftover(name: str, *, now: datetime, older_than: timedelta) -> bool:
    """Whether `name` is a drill's scratch copy, not one kept, made more than
    `older_than` ago. Anything else — the shop's database, a kept copy, a
    name merely alike — is never one."""
    found = SCRATCH_NAME.fullmatch(name)
    if not found:
        return False
    try:
        made = datetime.strptime(found.group(1), "%Y%m%d%H%M%S").replace(tzinfo=UTC)
    except ValueError:
        return False
    return made < now - older_than


async def drop_leftovers(server: Database, *, now: datetime | None = None) -> list[str]:
    """Drop the scratch copies earlier drills left behind; return their names.

    The nightly run calls this under its lock, so no other night's drill is
    running. A drill run by hand might be: only copies older than the
    restore's time limit and a margin go, which no drill still uses.
    """
    older_than = timedelta(seconds=timeout_for("pg_restore")) + LEFTOVER_MARGIN
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    admin = create_async_engine(server.url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    dropped: list[str] = []
    try:
        async with admin.connect() as connection:
            names = (
                await connection.execute(
                    text("SELECT datname FROM pg_database WHERE starts_with(datname, :prefix)"),
                    {"prefix": SCRATCH_PREFIX},
                )
            ).scalars()
            for name in sorted(names.all()):
                if is_leftover(name, now=moment, older_than=older_than):
                    await connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
                    dropped.append(name)
    finally:
        await admin.dispose()
    return dropped


def compare(manifest: dict[str, Any], restored: dict[str, Any]) -> list[Check]:
    checks = [
        Check(
            "migration",
            restored["alembic_revision"] == manifest["alembic_revision"],
            f"restored {restored['alembic_revision']}, backed up {manifest['alembic_revision']}",
        )
    ]
    expected, actual = manifest["tables"], restored["tables"]
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    differ = sorted(
        f"{table}: {actual[table]} rows, backed up {expected[table]}"
        for table in set(expected) & set(actual)
        if actual[table] != expected[table]
    )
    checks.append(
        Check(
            "rows",
            not (missing or extra or differ),
            "; ".join(
                [f"missing tables {missing}"] * bool(missing)
                + [f"unexpected tables {extra}"] * bool(extra)
                + differ
            )
            or f"{len(expected)} tables, {sum(expected.values())} rows, all equal",
        )
    )
    # Equal is not enough. A trigger disabled on the source — the ledger's
    # append-only guard, say, left off after maintenance — is faithfully
    # disabled in the copy too, and a restored ledger nothing protects is not
    # a healthy one. 'D' is disabled; every other state fires.
    disabled = [f"{table}.{name}" for table, name, state in restored["triggers"] if state == "D"]
    same = restored["triggers"] == manifest["triggers"]
    checks.append(
        Check(
            "triggers",
            same and not disabled,
            f"{len(restored['triggers'])} restored, {len(manifest['triggers'])} backed up"
            + ("" if same else f": {restored['triggers']}")
            + (f"; disabled: {disabled}" if disabled else ""),
        )
    )
    checks.append(
        Check(
            "locale",
            restored["locale"] == manifest["locale"]
            and restored["lower_probe"] == manifest["lower_probe"],
            f"restored {restored['locale']}, lower() gives {restored['lower_probe']!r}",
        )
    )
    checks.append(
        Check(
            "cyrillic",
            restored["lower_probe"] == CYRILLIC_LOWER,
            f"lower() gives {restored['lower_probe']!r}; the catalog needs {CYRILLIC_LOWER!r}",
        )
    )
    return checks


async def ledger(scratch: Database) -> Check:
    """Invariant I3 on the copy: every balance equals its movements."""
    engine = create_async_engine(scratch.url, poolclass=NullPool)
    try:
        async with AsyncSession(engine) as session:
            organizations = (
                await session.execute(text("SELECT id FROM organization ORDER BY id"))
            ).scalars()
            divergent: list[str] = []
            count = 0
            for organization_id in organizations.all():
                count += 1
                organization = uuid.UUID(str(organization_id))
                for divergence in await find_divergences(session, organization_id=organization):
                    divergent.append(str(divergence))
                # A merge leaves nothing under the duplicate, and nothing can
                # move stock there afterwards (ADR-0008 §9).
                for stranded in await stock_under_merged_models(
                    session, organization_id=organization
                ):
                    divergent.append(f"stock under a merged model: {stranded}")
    finally:
        await engine.dispose()
    return Check(
        "ledger",
        not divergent,
        f"{count} organizations reconcile"
        if not divergent
        else f"{len(divergent)} balances disagree with their movements: {divergent[:5]}",
    )


async def drill(archive: Path, server: Database, *, keep: bool = False) -> dict[str, Any]:
    started = time.monotonic()
    manifest_path = archive.with_suffix(".json")
    manifest: dict[str, Any] = json.loads(manifest_path.read_text())
    report: dict[str, Any] = {
        "archive": str(archive),
        "manifest": str(manifest_path),
        "taken_at": manifest["taken_at"],
        "drilled_at": datetime.now(UTC).isoformat(),
        "code_head": code_head(),
        "backed_up_revision": manifest["alembic_revision"],
        "scratch_database": None,
        "kept": False,
        "checks": [],
    }
    checks: list[Check] = []

    actual_sha = sha256(archive)
    checks.append(
        Check(
            "archive",
            actual_sha == manifest["archive_sha256"],
            "SHA-256 matches the manifest"
            if actual_sha == manifest["archive_sha256"]
            else f"SHA-256 {actual_sha} is not the manifest's {manifest['archive_sha256']}",
        )
    )
    if not checks[-1].ok:
        return _finish(report, checks, started)

    pg_restore = tool("pg_restore")
    require_compatible("pg_restore", await tool_major(pg_restore), manifest["server_major"])

    name = scratch_name(datetime.now(UTC), keep=keep)
    scratch = server.on(name)
    admin = create_async_engine(server.url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    created = False
    try:
        async with admin.connect() as connection:
            await connection.execute(text(create_statement(name, manifest["locale"])))
        created = True
        report["scratch_database"] = name

        restore_started = time.monotonic()
        try:
            await run(
                pg_restore,
                "--exit-on-error",
                "--single-transaction",
                "--no-owner",
                "--no-privileges",
                f"--dbname={name}",
                str(archive),
                env=scratch.libpq_env(),
            )
        except ToolError as error:
            checks.append(Check("restore", False, str(error)))
            return _finish(report, checks, started)
        report["restore_seconds"] = round(time.monotonic() - restore_started, 3)
        checks.append(Check("restore", True, f"pg_restore took {report['restore_seconds']} s"))

        engine = create_async_engine(scratch.url, poolclass=NullPool)
        try:
            async with engine.connect() as connection:
                restored = await describe(connection)
        finally:
            await engine.dispose()
        checks.extend(compare(manifest, restored))
        checks.append(await ledger(scratch))
    finally:
        if created and not keep:
            async with admin.connect() as connection:
                await connection.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        report["kept"] = created and keep
        await admin.dispose()
    return _finish(report, checks, started)


def _finish(report: dict[str, Any], checks: list[Check], started: float) -> dict[str, Any]:
    report["checks"] = [asdict(check) for check in checks]
    report["ok"] = bool(checks) and all(check.ok for check in checks)
    report["total_seconds"] = round(time.monotonic() - started, 3)
    if report["code_head"] != report["backed_up_revision"]:
        report["note"] = (
            f"This code expects migration {report['code_head']}; after a real restore, "
            "run `alembic upgrade head` before starting the API."
        )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("archive", type=Path, help="a .dump written by scripts.backup_database")
    parser.add_argument(
        "--scratch-url",
        default=os.environ.get("BIRKA_RESTORE_SCRATCH_URL"),
        help="server and maintenance database to create the scratch copy on "
        "(default: BIRKA_RESTORE_SCRATCH_URL)",
    )
    parser.add_argument("--keep", action="store_true", help="leave the scratch copy in place")
    parser.add_argument("--report", type=Path, help="also write the JSON report here")
    arguments = parser.parse_args()
    if not arguments.scratch_url:
        print("--scratch-url or BIRKA_RESTORE_SCRATCH_URL is required", file=sys.stderr)
        return 2
    try:
        report = asyncio.run(
            drill(arguments.archive, Database(arguments.scratch_url), keep=arguments.keep)
        )
    except (ToolError, OSError, ValueError, KeyError) as error:
        print(f"restore drill failed to run: {error}", file=sys.stderr)
        return 1
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if arguments.report:
        arguments.report.write_text(rendered)
    print(rendered)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
