"""A night that goes wrong still ends, and says so (failures are visible,
2026-10-03): every tool runs under a time limit, two nights never overlap,
and only a drill's own forgotten copies are ever dropped.

Fake tools stand in for `pg_dump`, `pg_restore` and `age`: shell scripts
that hang, with limits of a fraction of a second.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import scripts.postgres_tools as postgres_tools
from scripts.nightly_backup import LOCK_NAME, StillRunningError, encrypt, night_lock
from scripts.postgres_tools import STEP_TIMEOUTS, ToolError, run, timeout_for, tool_major
from scripts.restore_drill import (
    KEPT_SUFFIX,
    SCRATCH_NAME,
    SCRATCH_PREFIX,
    create_statement,
    is_leftover,
    scratch_name,
)

BACKEND = Path(__file__).resolve().parents[2]
RECIPIENT = "age1" + "q" * 58
NOW = datetime(2026, 10, 3, 3, 15, tzinfo=UTC)
LIMIT_VARIABLES = [variable for variable, _ in STEP_TIMEOUTS.values()]


@pytest.fixture(autouse=True)
def _default_limits(monkeypatch):
    for variable in LIMIT_VARIABLES:
        monkeypatch.delenv(variable, raising=False)


def fake_tool(directory: Path, name: str, body: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(f"#!/bin/sh\n{body}\n")
    path.chmod(0o755)
    return path


def hanging(directory: Path, name: str) -> Path:
    """A tool that writes its process id where its first argument says, then
    sleeps far longer than any test waits — as the same process, so the id
    is the one a timeout must stop."""
    return fake_tool(directory, name, 'echo $$ > "$1"\nexec sleep 60')


def gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    return False


# --- time limits --------------------------------------------------------------


async def test_a_tool_that_hangs_is_stopped_and_its_step_says_so(tmp_path):
    tool = hanging(tmp_path / "bin", "pg_dump")
    pidfile = tmp_path / "pid"
    started = time.monotonic()

    with pytest.raises(ToolError, match=r"^pg_dump did not finish within 0\.5 s and was stopped$"):
        await run(tool, str(pidfile), timeout=0.5)

    assert time.monotonic() - started < 10
    assert gone(int(pidfile.read_text())), "the hung tool was killed, not left behind"


async def test_each_step_has_its_own_limit_and_its_variable_changes_it(tmp_path, monkeypatch):
    assert timeout_for("pg_dump") == 2 * 3600
    assert timeout_for("pg_restore") == 2 * 3600
    assert timeout_for("age") == 30 * 60
    assert timeout_for("rsync") == 30 * 60, "any other tool is limited too"

    monkeypatch.setenv("BIRKA_BACKUP_RESTORE_TIMEOUT_SECONDS", "0.5")
    assert timeout_for("pg_restore") == 0.5
    assert timeout_for("pg_dump") == 2 * 3600
    tool = hanging(tmp_path / "bin", "pg_restore")
    pidfile = tmp_path / "pid"
    with pytest.raises(ToolError) as refused:
        await run(tool, str(pidfile))
    assert str(refused.value) == (
        "pg_restore did not finish within 0.5 s and was stopped; "
        "BIRKA_BACKUP_RESTORE_TIMEOUT_SECONDS gives it longer"
    )
    assert gone(int(pidfile.read_text()))


@pytest.mark.parametrize("value", ["soon", "0", "-5", "inf", "nan"])
async def test_a_limit_that_is_not_a_number_fails_the_step_in_words(tmp_path, monkeypatch, value):
    """Never a step run without a limit because its variable was mistyped."""
    monkeypatch.setenv("BIRKA_BACKUP_DUMP_TIMEOUT_SECONDS", value)
    tool = fake_tool(tmp_path / "bin", "pg_dump", "exit 0")
    with pytest.raises(ToolError, match="BIRKA_BACKUP_DUMP_TIMEOUT_SECONDS must be a number"):
        await run(tool)


def test_a_limit_is_said_in_the_units_a_person_reads():
    assert postgres_tools._duration(7200) == "2 h"
    assert postgres_tools._duration(1800) == "30 min"
    assert postgres_tools._duration(90) == "90 s"


async def test_asking_a_tool_its_version_has_a_short_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(postgres_tools, "VERSION_TIMEOUT_SECONDS", 0.5)
    tool = fake_tool(tmp_path / "bin", "pg_dump", "exec sleep 60")
    with pytest.raises(ToolError, match=r"did not finish within 0\.5 s"):
        await tool_major(tool)


async def test_a_tool_that_finishes_in_time_is_unchanged(tmp_path):
    tool = fake_tool(tmp_path / "bin", "pg_dump", "echo 'pg_dump (PostgreSQL) 17.6'")
    assert await tool_major(tool) == 17
    failing = fake_tool(tmp_path / "bin", "pg_restore", "echo broken >&2; exit 3")
    with pytest.raises(ToolError, match="pg_restore exited with 3: broken"):
        await run(failing)


async def test_a_night_cancelled_leaves_no_tool_running(tmp_path):
    tool = hanging(tmp_path / "bin", "pg_dump")
    pidfile = tmp_path / "pid"
    task = asyncio.create_task(run(tool, str(pidfile)))
    for _ in range(100):
        if pidfile.exists() and pidfile.read_text().strip():
            break
        await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert gone(int(pidfile.read_text()))


async def test_encryption_that_hangs_keeps_the_plaintext_and_nothing_half_written(
    tmp_path, monkeypatch
):
    """`BIRKA_AGE` may name any program; the encryption's limit is the step's,
    whatever the program is called."""
    age = fake_tool(
        tmp_path / "bin",
        "age-wrapper",
        # Starts writing its output, as age does, then hangs.
        'while [ "$1" != "--output" ]; do shift; done\necho partial > "$2"\nexec sleep 60',
    )
    monkeypatch.setenv("BIRKA_AGE", str(age))
    monkeypatch.setenv("BIRKA_BACKUP_ENCRYPT_TIMEOUT_SECONDS", "0.5")
    out = tmp_path / "backups"
    out.mkdir()
    archive = out / "birka-20261003T031500Z.dump"
    archive.write_bytes(b"the night's archive")

    with pytest.raises(ToolError, match=r"age-wrapper did not finish within 0\.5 s"):
        await encrypt(archive, [RECIPIENT])

    assert archive.read_bytes() == b"the night's archive"
    assert sorted(path.name for path in out.iterdir()) == [archive.name]


# --- one night at a time ------------------------------------------------------


def test_two_nights_never_overlap(tmp_path):
    first, second = NOW, NOW + timedelta(days=1)
    with night_lock(tmp_path, first):
        with pytest.raises(StillRunningError) as refused, night_lock(tmp_path, second):
            pytest.fail("a second night started beside the first")
        assert first.isoformat() in str(refused.value)
        assert "this night did not start" in str(refused.value)
    with night_lock(tmp_path, second):
        assert (tmp_path / LOCK_NAME).read_text() == second.isoformat()


def test_a_night_that_was_killed_never_blocks_the_next(tmp_path):
    """The kernel lets go of the lock with the process, however it ends."""
    lock = tmp_path / LOCK_NAME
    holder = subprocess.Popen(  # noqa: S603 — fixed source, current test interpreter
        [
            sys.executable,
            "-c",
            "import fcntl, sys, time\n"
            "f = open(sys.argv[1], 'a+')\n"
            "fcntl.flock(f, fcntl.LOCK_EX)\n"
            "print('held', flush=True)\n"
            "time.sleep(60)\n",
            str(lock),
        ],
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert holder.stdout is not None
        assert holder.stdout.readline().strip() == "held"
        with pytest.raises(StillRunningError, match="an unknown time"), night_lock(tmp_path, NOW):
            pass
    finally:
        holder.kill()
        holder.wait()
    with night_lock(tmp_path, NOW):
        pass


def test_a_night_turned_away_is_recorded_as_failed_and_exits_non_zero(tmp_path):
    """The whole script, as cron runs it, beside a night still holding the
    lock. Its database cannot be reached here, so the record fails too —
    and says so — but the night's own file names why it did not run."""
    out = tmp_path / "backups"
    unreachable = "postgresql+asyncpg://nobody@127.0.0.1:1/nothing"
    with night_lock(out, NOW):
        finished = subprocess.run(  # noqa: S603 — fixed module, current test interpreter
            [sys.executable, "-m", "scripts.nightly_backup", "--out", str(out)],
            cwd=BACKEND,
            env={
                **os.environ,
                "BIRKA_DATABASE_URL": unreachable,
                "BIRKA_RESTORE_SCRATCH_URL": unreachable,
                "BIRKA_BACKUP_AGE_RECIPIENTS": RECIPIENT,
            },
            capture_output=True,
            text=True,
            timeout=120,
        )

    assert finished.returncode == 1, finished.stderr
    night = json.loads((out / "last-run.json").read_text())
    assert night == json.loads(finished.stdout)
    assert night["ok"] is False
    assert [problem["step"] for problem in night["problems"]] == ["still_running", "record"]
    assert NOW.isoformat() in night["problems"][0]["detail"]
    assert "archive" not in night
    assert sorted(path.name for path in out.iterdir()) == [LOCK_NAME, "last-run.json"], (
        "nothing was started: no dump, no partial file left behind"
    )


# --- a drill's forgotten copies -----------------------------------------------


def test_a_drill_names_its_copies_so_the_ones_it_keeps_are_told_apart():
    dropped_later = scratch_name(NOW)
    kept = scratch_name(NOW, keep=True)
    assert SCRATCH_NAME.fullmatch(dropped_later)
    assert dropped_later.startswith(f"{SCRATCH_PREFIX}20261003031500_")
    assert kept.endswith(KEPT_SUFFIX)
    assert not SCRATCH_NAME.fullmatch(kept)
    # Both are names CREATE DATABASE accepts from the drill.
    locale = {"provider": "c", "collate": "C", "ctype": "C", "locale": None, "encoding": "UTF8"}
    create_statement(dropped_later, locale)
    create_statement(kept, locale)


@pytest.mark.parametrize(
    ("name", "leftover"),
    [
        (f"{SCRATCH_PREFIX}20261002031500_a1b2c3", True),
        (f"{SCRATCH_PREFIX}20200101000000_000000", True),
        # Made within the limit: a drill may still be using it.
        (f"{SCRATCH_PREFIX}20261003021600_a1b2c3", False),
        (f"{SCRATCH_PREFIX}20261003031500_a1b2c3", False),
        # Kept on purpose, for someone to inspect.
        (f"{SCRATCH_PREFIX}20261002031500_a1b2c3{KEPT_SUFFIX}", False),
        # Only alike, or not the drill's at all.
        (f"{SCRATCH_PREFIX}20261002031500_A1B2C3", False),
        (f"{SCRATCH_PREFIX}20261002031500_a1b2c3_x", False),
        (f"{SCRATCH_PREFIX}20261302031500_a1b2c3", False),
        (f"{SCRATCH_PREFIX}x", False),
        ("birka", False),
        ("postgres", False),
        ("birka_backup_source_0123456789", False),
        (f"x{SCRATCH_PREFIX}20261002031500_a1b2c3", False),
    ],
)
def test_only_a_drills_own_forgotten_copy_is_ever_a_leftover(name, leftover):
    assert is_leftover(name, now=NOW, older_than=timedelta(hours=1)) is leftover
