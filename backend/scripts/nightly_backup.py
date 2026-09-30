"""The nightly backup: back up, prove it, encrypt it, keep what the owner keeps.

    python -m scripts.nightly_backup --out /backups

The owner's decisions of 2026-09-30 (business-rules.md, "backups"):

- one backup a day;
- every daily backup kept 7 days, and the first backup of each calendar
  month kept 3 months;
- copies encrypted to the owner's age public key before the owner's own
  computer collects them, so the server can write a copy it can never read
  back.

In order: `scripts.backup_database`, then `scripts.restore_drill` on the
fresh archive, then `age` encrypts it and the plaintext is removed, then
retention. A failed night still keeps its backup — a drill that fails on a
ledger divergence has found a problem in the data, and the copy is still the
best one there is — but it deletes nothing, so a broken job can never eat the
good copies before it.

Without `BIRKA_BACKUP_AGE_RECIPIENTS` the night fails: the owner decided
copies leave the server encrypted, and an unencrypted night is not that.
`--allow-plaintext` exists for tests and first setup only.

Every night ends with `last-run.json` in the directory, and with one row in
the database's `backup_run` — the only thing it ever writes there — which is
how the owner's «Резервні копії» section and the Telegram warning learn of it
(`scripts.backup_watch`). Exit status 0 only if everything above held.
"""

from __future__ import annotations

import argparse
import asyncio
import calendar
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.modules.backups.service import record_night
from scripts.backup_database import back_up, sha256
from scripts.postgres_tools import Database, ToolError, run
from scripts.restore_drill import drill

DAILY_DAYS = 7
MONTHLY_MONTHS = 3
STAMP = re.compile(r"^birka-(\d{8}T\d{6}Z)\.")
# An age X25519 recipient: "age1" and 58 bech32 characters.
RECIPIENT = re.compile(r"^age1[02-9ac-hj-np-z]{58}$")


@dataclass(frozen=True, slots=True)
class Backup:
    """One night's files, however many of them survive."""

    taken_at: datetime
    files: tuple[Path, ...]
    verified: bool


def months_before(moment: datetime, months: int) -> datetime:
    month = moment.month - months
    year = moment.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def backups_in(directory: Path) -> list[Backup]:
    """Every night whose files are named as this script names them. Anything
    else in the directory is not ours, and retention never touches it."""
    nights: dict[str, list[Path]] = {}
    for path in directory.iterdir():
        found = STAMP.match(path.name)
        if found and path.is_file():
            nights.setdefault(found.group(1), []).append(path)
    backups = []
    for stamp, files in nights.items():
        report = directory / f"birka-{stamp}.drill.json"
        verified = False
        if report.exists():
            try:
                verified = bool(json.loads(report.read_text()).get("ok"))
            except (OSError, ValueError):
                verified = False
        backups.append(
            Backup(
                taken_at=datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC),
                files=tuple(sorted(files)),
                verified=verified,
            )
        )
    return sorted(backups, key=lambda backup: backup.taken_at)


def to_keep(backups: list[Backup], now: datetime) -> set[datetime]:
    """The owner's retention, as a set of the nights it keeps.

    Every night of the last 7 days. For each calendar month, its first
    *verified* night — its first night if none was verified — while that
    night is less than 3 months old. And always the newest night, whatever
    its age: retention must never leave the directory empty.
    """
    if not backups:
        return set()
    kept = {b.taken_at for b in backups if b.taken_at > now - timedelta(days=DAILY_DAYS)}
    months: dict[tuple[int, int], list[Backup]] = {}
    for backup in backups:
        months.setdefault((backup.taken_at.year, backup.taken_at.month), []).append(backup)
    cutoff = months_before(now, MONTHLY_MONTHS)
    for nights in months.values():
        first = next((b for b in nights if b.verified), nights[0])
        if first.taken_at > cutoff:
            kept.add(first.taken_at)
    kept.add(backups[-1].taken_at)
    return kept


def prune(directory: Path, now: datetime) -> list[str]:
    backups = backups_in(directory)
    kept = to_keep(backups, now)
    removed = []
    for backup in backups:
        if backup.taken_at not in kept:
            for path in backup.files:
                path.unlink()
                removed.append(path.name)
    return removed


def recipients_from(value: str | None) -> list[str]:
    recipients = [part for part in re.split(r"[\s,]+", value or "") if part]
    for recipient in recipients:
        if not RECIPIENT.fullmatch(recipient):
            raise ValueError(f"Not an age public key: {recipient[:12]}…")
    return recipients


async def encrypt(archive: Path, recipients: list[str]) -> Path:
    """`archive.age`, readable only with a recipient's private key; then the
    plaintext goes. Written beside it first, so a failure leaves the plaintext."""
    sealed = archive.with_name(archive.name + ".age")
    partial = archive.with_name(f".{archive.name}.age.partial")
    arguments = [argument for recipient in recipients for argument in ("--recipient", recipient)]
    try:
        await run(tool_age(), "--encrypt", *arguments, "--output", str(partial), str(archive))
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    if partial.stat().st_size == 0:
        partial.unlink()
        raise ToolError("age wrote an empty file")
    partial.rename(sealed)
    archive.unlink()
    return sealed


def tool_age() -> Path:
    """`BIRKA_AGE`, or `age` on PATH — never `BIRKA_PG_BIN`, which holds only
    PostgreSQL's tools."""
    configured = os.environ.get("BIRKA_AGE") or shutil.which("age")
    if not configured or not Path(configured).exists():
        raise ToolError("age not found; install it or set BIRKA_AGE")
    return Path(configured)


async def nightly(
    source: Database,
    scratch: Database,
    out: Path,
    *,
    recipients: list[str],
    allow_plaintext: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    started = (now or datetime.now(UTC)).astimezone(UTC)
    result: dict[str, Any] = {"started_at": started.isoformat(), "ok": False, "problems": []}
    # One `{"step", "detail"}` for each step that failed, in the order they
    # ran: `backup`, `drill` (with the failed `checks`), `encrypt`, `key`,
    # and `record` when the night could not be written to the database.
    problems: list[dict[str, Any]] = result["problems"]
    # Every failure below is reported in last-run.json; none is hidden, and
    # none is raised past it, so the night always leaves its record.
    try:
        manifest = await back_up(source, out, now=started)
    except Exception as error:
        problems.append({"step": "backup", "detail": str(error)})
        return await _record(source, out, result)
    stem = manifest["archive"].removesuffix(".dump")
    archive = out / manifest["archive"]
    result["archive"] = manifest["archive"]
    result["bytes"] = manifest["archive_bytes"]
    result["rows"] = sum(manifest["tables"].values())

    try:
        report = await drill(archive, scratch)
    except Exception as error:
        report = {"ok": False, "checks": [], "error": str(error)}
    (out / f"{stem}.drill.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    failed = [check for check in report.get("checks", []) if not check["ok"]]
    result["drill"] = {
        "ok": report["ok"],
        "restore_seconds": report.get("restore_seconds"),
        "failed": [check["name"] for check in failed],
    }
    if not report["ok"]:
        problems.append(
            {
                "step": "drill",
                "checks": [check["name"] for check in failed],
                "detail": report.get("error")
                or "; ".join(f"{check['name']}: {check['detail']}" for check in failed),
            }
        )

    if recipients:
        try:
            sealed = await encrypt(archive, recipients)
        except (ToolError, OSError) as error:
            problems.append(
                {"step": "encrypt", "detail": f"encryption failed, the plaintext is kept: {error}"}
            )
        else:
            manifest.update(
                encrypted_archive=sealed.name,
                encrypted_sha256=sha256(sealed),
                encrypted_bytes=sealed.stat().st_size,
                recipients=recipients,
            )
            (out / f"{stem}.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True)
            )
            result["archive"] = sealed.name
            result["bytes"] = manifest["encrypted_bytes"]
    elif not allow_plaintext:
        problems.append(
            {
                "step": "key",
                "detail": "not encrypted: BIRKA_BACKUP_AGE_RECIPIENTS is not set, and copies "
                "leave the server only encrypted (owner decision, 2026-09-30)",
            }
        )

    result["ok"] = not problems
    # Only after a good night: a failing job must never delete the copies
    # that came before it.
    result["pruned"] = prune(out, started) if result["ok"] else []
    return await _record(source, out, result)


async def remember(source: Database, result: dict[str, Any]) -> None:
    """The night's row in `backup_run`, for the owner's section and warning."""
    engine = create_async_engine(source.url, poolclass=NullPool)
    try:
        async with AsyncSession(engine) as session:
            await record_night(session, result)
    finally:
        await engine.dispose()


async def _record(source: Database, out: Path, result: dict[str, Any]) -> dict[str, Any]:
    result["finished_at"] = datetime.now(UTC).isoformat()
    try:
        await remember(source, result)
    except Exception as error:
        # The owner is not told of this night, so it has not held. The
        # watcher still notices: a night missing from the database is an
        # overdue one.
        result["problems"].append({"step": "record", "detail": str(error)})
        result["ok"] = False
    written = out / ".last-run.json.partial"
    written.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    written.rename(out / "last-run.json")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, required=True, help="the backup directory")
    parser.add_argument(
        "--allow-plaintext",
        action="store_true",
        help="do not fail without an age recipient (tests and first setup only)",
    )
    arguments = parser.parse_args()
    url = os.environ.get("BIRKA_DATABASE_URL")
    scratch = os.environ.get("BIRKA_RESTORE_SCRATCH_URL")
    if not url or not scratch:
        print("BIRKA_DATABASE_URL and BIRKA_RESTORE_SCRATCH_URL are required", file=sys.stderr)
        return 2
    try:
        recipients = recipients_from(os.environ.get("BIRKA_BACKUP_AGE_RECIPIENTS"))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    arguments.out.mkdir(parents=True, exist_ok=True)
    result = asyncio.run(
        nightly(
            Database(url),
            Database(scratch),
            arguments.out,
            recipients=recipients,
            allow_plaintext=arguments.allow_plaintext,
        )
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
