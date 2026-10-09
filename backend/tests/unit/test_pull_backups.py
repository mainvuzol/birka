"""`infra/pull-backups.sh`, the owner's machine collecting the server's copies.

rsync treats a local path like a remote one, so a directory stands in for
the server here; the SSH leg is the one part not exercised.

Since 2026-10-09 it deletes the nights older than 3 months, as the server
does, so a customer's erased name leaves every copy (owner decision; ADR-0015).
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest
from scripts.postgres_tools import ToolError, run

SCRIPT = Path(__file__).resolve().parents[3] / "infra" / "pull-backups.sh"
STEM = "birka-20260930T031500Z"
NOW = "20261009T090000Z"

pytestmark = pytest.mark.skipif(shutil.which("rsync") is None, reason="rsync is not installed")


def serve(server: Path, *, sealed: bytes = b"age-encrypted bytes") -> None:
    """A night as the server leaves it: sealed archive, manifest, drill report."""
    server.mkdir()
    (server / f"{STEM}.dump.age").write_bytes(sealed)
    (server / f"{STEM}.json").write_text(
        json.dumps(
            {"archive_sha256": "0" * 64, "encrypted_sha256": hashlib.sha256(sealed).hexdigest()},
            indent=2,
            sort_keys=True,
        )
    )
    (server / f"{STEM}.drill.json").write_text(json.dumps({"ok": True}))
    # What must never leave: a plaintext archive, and files that are not ours.
    (server / "birka-20260929T031500Z.dump").write_bytes(b"plaintext sales")
    (server / "last-run.json").write_text("{}")
    (server / "notes.txt").write_text("server only")


async def pull(server: Path, dest: Path, now: str = NOW, **env: str) -> str:
    return await run(
        Path("/bin/sh"),
        str(SCRIPT),
        env={
            "BIRKA_BACKUP_SOURCE": f"{server}/",
            "BIRKA_BACKUP_DEST": str(dest),
            "BIRKA_BACKUP_NOW": now,
            **env,
        },
    )


def nights_here(dest: Path, *stamps: str) -> None:
    """Nights collected before, as the server named them."""
    for stamp in stamps:
        for suffix in (".dump.age", ".json", ".drill.json"):
            (dest / f"birka-{stamp}{suffix}").write_text("{}")


def whole_night(dest: Path, stamp: str, sealed: bytes) -> None:
    """A night collected before, whose archive matches its manifest."""
    (dest / f"birka-{stamp}.dump.age").write_bytes(sealed)
    (dest / f"birka-{stamp}.json").write_text(
        json.dumps({"encrypted_sha256": hashlib.sha256(sealed).hexdigest()}, indent=2)
    )


def stamps_in(dest: Path) -> set[str]:
    return {path.name.split(".")[0].removeprefix("birka-") for path in dest.iterdir()}


async def test_only_encrypted_copies_and_their_records_are_collected(tmp_path):
    server, dest = tmp_path / "server", tmp_path / "owner"
    serve(server)

    said = await pull(server, dest)

    assert sorted(path.name for path in dest.iterdir()) == [
        f"{STEM}.drill.json",
        f"{STEM}.dump.age",
        f"{STEM}.json",
    ]
    assert "1 encrypted backups here are whole; 0 damaged" in said


async def test_the_owners_copy_is_never_overwritten_and_outlives_the_servers_week(tmp_path):
    server, dest = tmp_path / "server", tmp_path / "owner"
    serve(server)
    await pull(server, dest)
    kept_longer = dest / "birka-20260801T031500Z.dump.age"
    kept_longer.write_bytes(b"gone from the server, kept here")

    (server / f"{STEM}.drill.json").write_text(json.dumps({"ok": False}))
    await pull(server, dest)

    assert kept_longer.exists()
    assert json.loads((dest / f"{STEM}.drill.json").read_text()) == {"ok": True}


async def test_nights_older_than_three_months_are_deleted_and_nothing_else(tmp_path):
    server, dest = tmp_path / "server", tmp_path / "owner"
    serve(server)
    dest.mkdir()
    nights_here(dest, "20260601T031500Z", "20260709T085959Z", "20260709T090000Z")
    nights_here(dest, "20260709T090001Z", "20260801T031500Z")
    (dest / "notes.txt").write_text("the owner's own")
    (dest / "birka-notes.txt").write_text("not a night")

    said = await pull(server, dest)

    assert stamps_in(dest) == {
        "20260709T090001Z",
        "20260801T031500Z",
        "20260930T031500Z",
        "notes",
    }
    assert (dest / "birka-notes.txt").exists()
    assert "3 nights older than 3 months deleted here" in said


async def test_three_months_before_the_end_of_may_is_the_end_of_february(tmp_path):
    server, dest = tmp_path / "server", tmp_path / "owner"
    serve(server)
    dest.mkdir()
    nights_here(dest, "20260227T031500Z", "20260228T031500Z", "20260228T120000Z")
    nights_here(dest, "20260301T031500Z")

    await pull(server, dest, now="20260531T090000Z")

    # 31 February is 28 February: a night after 09:00 that day stays.
    assert stamps_in(dest) == {"20260228T120000Z", "20260301T031500Z", "20260930T031500Z"}


async def test_a_leap_february_and_a_year_back(tmp_path):
    server, dest = tmp_path / "server", tmp_path / "owner"
    serve(server)
    dest.mkdir()
    nights_here(dest, "20271129T031500Z", "20271130T031500Z")
    nights_here(dest, "20280229T031500Z", "20280301T031500Z")

    # Three months before 29 February is 29 November, a year back.
    await pull(server, dest, now="20280229T120000Z")
    after_february = stamps_in(dest)
    # Three months before 31 May 2028 is 29 February, a leap year's.
    await pull(server, dest, now="20280531T120000Z")

    # The server's night is the only one here whose archive is whole, so it
    # stays however old.
    assert after_february == {
        "20260930T031500Z",
        "20271130T031500Z",
        "20280229T031500Z",
        "20280301T031500Z",
    }
    assert stamps_in(dest) == {"20260930T031500Z", "20280301T031500Z"}


async def test_the_newest_night_is_kept_however_old(tmp_path):
    server, dest = tmp_path / "server", tmp_path / "owner"
    serve(server)
    dest.mkdir()

    said = await pull(server, dest, now="20300101T000000Z")

    assert stamps_in(dest) == {"20260930T031500Z"}
    assert "0 nights older than 3 months deleted here" in said


async def test_a_damaged_copy_fails_the_run_and_the_old_nights_still_go(tmp_path):
    """A copy damaged here is never collected again, so the run fails until
    someone deletes it; meanwhile old nights still leave."""
    server, dest = tmp_path / "server", tmp_path / "owner"
    serve(server)
    manifest = json.loads((server / f"{STEM}.json").read_text())
    manifest["encrypted_sha256"] = "f" * 64
    (server / f"{STEM}.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    dest.mkdir()
    nights_here(dest, "20260101T031500Z", "20260801T031500Z")

    with pytest.raises(ToolError, match="DAMAGED OR MISSING"):
        await pull(server, dest)

    assert stamps_in(dest) == {"20260801T031500Z", "20260930T031500Z"}


async def test_a_server_out_of_reach_fails_the_run_and_the_old_nights_still_go(tmp_path):
    dest = tmp_path / "owner"
    dest.mkdir()
    sealed = b"a night collected long ago"
    for stamp in ("20260101T031500Z", "20260301T031500Z", "20260801T031500Z"):
        whole_night(dest, stamp, sealed)

    with pytest.raises(ToolError, match="NOT COLLECTED: rsync exited"):
        await pull(tmp_path / "no-such-server", dest)

    assert stamps_in(dest) == {"20260801T031500Z"}


async def test_the_newest_whole_night_stays_when_newer_nights_have_no_archive(tmp_path):
    """A server whose encryption keeps failing sends manifests alone: the
    last night that can be restored is kept, however old."""
    server, dest = tmp_path / "server", tmp_path / "owner"
    server.mkdir()
    (server / "birka-20261008T031500Z.json").write_text(json.dumps({"archive_sha256": "0" * 64}))
    dest.mkdir()
    whole_night(dest, "20260601T031500Z", b"the last sealed night")

    await pull(server, dest)

    assert stamps_in(dest) == {"20260601T031500Z", "20261008T031500Z"}


async def test_a_copy_that_arrived_damaged_is_named_and_fails_the_run(tmp_path):
    server, dest = tmp_path / "server", tmp_path / "owner"
    serve(server)
    manifest = json.loads((server / f"{STEM}.json").read_text())
    manifest["encrypted_sha256"] = "f" * 64
    (server / f"{STEM}.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))

    with pytest.raises(ToolError, match=f"DAMAGED OR MISSING: .*{STEM}.dump.age"):
        await pull(server, dest)


async def test_a_scheduler_without_home_names_the_key(tmp_path):
    """A NAS's task scheduler may run the collector without HOME (restore
    rehearsal, 2026-10-09): it says what to set, or takes the key named."""
    server, dest = tmp_path / "server", tmp_path / "owner"
    serve(server)

    with pytest.raises(ToolError, match="set HOME, or BIRKA_BACKUP_SSH_KEY"):
        await pull(server, dest, HOME="")
    said = await pull(server, dest, HOME="", BIRKA_BACKUP_SSH_KEY=str(tmp_path / "key"))

    assert "1 encrypted backups here are whole; 0 damaged" in said
