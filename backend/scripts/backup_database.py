"""Back up the database, with a manifest a restore drill can hold it to.

Run against the live database (it only reads):
    python -m scripts.backup_database --out /backups

Writes `birka-<UTC time>.dump` (`pg_dump --format=custom`) and a
`birka-<UTC time>.json` manifest beside it: the archive's SHA-256, the
migration revision, the database's locale, its triggers, and the row count
of every table. The counts are taken inside the very snapshot `pg_dump`
copies (`pg_export_snapshot`), so they are exactly what the archive holds —
not a second reading that a sale in between could make disagree.

It never deletes or overwrites anything. How long backups are kept, how
often they are taken and where copies go off the server are the owner's
decisions (backup-restore-runbook.md), not this script's.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from scripts.postgres_tools import (
    Database,
    ToolError,
    describe,
    require_compatible,
    run,
    tool,
    tool_major,
)

MANIFEST_VERSION = 1


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as archive:
        for block in iter(lambda: archive.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


async def back_up(source: Database, out: Path, *, now: datetime | None = None) -> dict[str, Any]:
    """Write one archive and its manifest into `out`; return the manifest."""
    taken = (now or datetime.now(UTC)).astimezone(UTC)
    stem = f"birka-{taken:%Y%m%dT%H%M%SZ}"
    archive, manifest_path = out / f"{stem}.dump", out / f"{stem}.json"
    if archive.exists() or manifest_path.exists():
        raise FileExistsError(f"{archive} already exists; a backup is never overwritten")
    out.mkdir(parents=True, exist_ok=True)
    partial = out / f".{stem}.dump.partial"

    pg_dump = tool("pg_dump")
    dump_major = await tool_major(pg_dump)
    engine = create_async_engine(source.url, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            connection = await connection.execution_options(
                isolation_level="REPEATABLE READ", postgresql_readonly=True
            )
            async with connection.begin():
                snapshot = (
                    await connection.execute(text("SELECT pg_export_snapshot()"))
                ).scalar_one()
                facts = await describe(connection)
                require_compatible("pg_dump", dump_major, facts["server_major"])
                # The snapshot stays exported for as long as this transaction
                # is open, so the dump reads exactly what `describe` just read.
                await run(
                    pg_dump,
                    "--format=custom",
                    "--no-owner",
                    "--no-privileges",
                    f"--snapshot={snapshot}",
                    f"--file={partial}",
                    env=source.libpq_env(),
                )
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    finally:
        await engine.dispose()

    manifest = {
        "manifest_version": MANIFEST_VERSION,
        "taken_at": taken.isoformat(),
        "archive": archive.name,
        "archive_bytes": partial.stat().st_size,
        "archive_sha256": sha256(partial),
        "pg_dump_major": dump_major,
        "source_database": source.name,
        **facts,
    }
    partial.rename(archive)
    written = out / f".{stem}.json.partial"
    written.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True))
    written.rename(manifest_path)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, required=True, help="directory for the archive")
    arguments = parser.parse_args()
    url = os.environ.get("BIRKA_DATABASE_URL")
    if not url:
        print("BIRKA_DATABASE_URL is required", file=sys.stderr)
        return 2
    try:
        manifest = asyncio.run(back_up(Database(url), arguments.out))
    except (ToolError, FileExistsError) as error:
        print(f"backup failed: {error}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "archive": str(arguments.out / manifest["archive"]),
                "bytes": manifest["archive_bytes"],
                "sha256": manifest["archive_sha256"],
                "alembic_revision": manifest["alembic_revision"],
                "rows": sum(manifest["tables"].values()),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
