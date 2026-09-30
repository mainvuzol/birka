"""`infra/pull-backups.sh`, the owner's machine collecting the server's copies.

rsync treats a local path like a remote one, so a directory stands in for
the server here; the SSH leg is the one part not exercised.
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


async def pull(server: Path, dest: Path) -> str:
    return await run(
        Path("/bin/sh"),
        str(SCRIPT),
        env={"BIRKA_BACKUP_SOURCE": f"{server}/", "BIRKA_BACKUP_DEST": str(dest)},
    )


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


async def test_the_owners_copy_is_never_deleted_or_overwritten(tmp_path):
    server, dest = tmp_path / "server", tmp_path / "owner"
    serve(server)
    await pull(server, dest)
    kept_longer = dest / "birka-20260101T031500Z.dump.age"
    kept_longer.write_bytes(b"gone from the server, kept here")

    (server / f"{STEM}.drill.json").write_text(json.dumps({"ok": False}))
    await pull(server, dest)

    assert kept_longer.exists()
    assert json.loads((dest / f"{STEM}.drill.json").read_text()) == {"ok": True}


async def test_a_copy_that_arrived_damaged_is_named_and_fails_the_run(tmp_path):
    server, dest = tmp_path / "server", tmp_path / "owner"
    serve(server)
    manifest = json.loads((server / f"{STEM}.json").read_text())
    manifest["encrypted_sha256"] = "f" * 64
    (server / f"{STEM}.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))

    with pytest.raises(ToolError, match=f"DAMAGED OR MISSING: .*{STEM}.dump.age"):
        await pull(server, dest)
