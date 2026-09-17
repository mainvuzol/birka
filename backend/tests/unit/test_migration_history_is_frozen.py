"""A shipped migration is history. It is never edited again.

This file replaces the re-rendering half of `test_m1b_schema_parity.py`.

That test proved the models and the `0002` schema agreed by rendering the live
models and diffing them against the shipped SQL. It worked while every later
revision only *added* columns — `0003` and `0004` were handled by removing
their additions from the projection before comparing.

`0006` moves the stock key from `store_id` to `location_id`. The current models
therefore no longer describe `0002`'s tables at all: `inventory.store_id` is
gone, `stock_movement` has two new columns and a new CHECK, and `transfer` has
different columns entirely. Reconstructing the `0002` projection from today's
models would mean re-deleting and re-adding a growing list of differences, and
every future revision would make that reconstruction more elaborate and less
trustworthy — a test that needs constant maintenance to keep agreeing with
itself is not evidence of anything.

What that test actually protected is kept here, and made absolute: **a shipped
migration's bytes never change.** Model-versus-database drift is proven by
`alembic check` against real PostgreSQL, which CI runs on every push together
with a full `downgrade base` → `upgrade head` round trip (`.github/workflows`).
That is a stronger check than the offline reconstruction ever was, because it
runs against the database rather than against a rendering of it.

Update a digest here **only** when adding a genuinely new migration file.
Changing one for an existing revision means someone edited history.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]
VERSIONS = BACKEND_ROOT / "migrations" / "versions"

# sha256 of every migration that has shipped. The newest revision is the one
# under active development and is deliberately absent: it is not history yet.
FROZEN: dict[str, str] = {
    "0001_m1a_tenancy_identity_authz.py": (
        "46b39759a8ef05197c0fd31496f40e077b655731e86b4398d76d2e0f731daec0"
    ),
    "0002_m1b_catalog_inventory_sales.py": (
        "2e9a11e1a54cf4254c153539b83c25857b3b684b1f72987a80ed3f7871ada833"
    ),
    "0002_m1b_schema.sql": ("19b3dabf590ed4b8f7b07ec16328335410e91ac2f8bb692f1fe5aef8777f5116"),
    "0003_sale_command_replay.py": (
        "b2e2c2160613c1d0a39f54928802f5502e9e2dd27b60c6d81515abea3cb155c5"
    ),
    "0004_refund_command_replay.py": (
        "b21759e7ee242af61f097a5a7cffa44c04955fb6d20f68013a1b4619739cec4d"
    ),
    "0005_stock_location_foundation.py": (
        "eb8294ba64888e1281aa464f1be26419da0da661685429fc7a38b308c32783c9"
    ),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.mark.parametrize("filename", sorted(FROZEN))
def test_a_shipped_migration_is_never_edited(filename: str) -> None:
    path = VERSIONS / filename
    assert path.exists(), f"{filename} has been deleted"
    assert digest(path) == FROZEN[filename], (
        f"{filename} has changed. A shipped migration is history: correct it with a NEW "
        "revision instead. If this file is genuinely new, add its digest rather than editing it."
    )


def test_every_migration_on_disk_is_accounted_for() -> None:
    """A new revision must be a new file, never an edit to an old one."""
    on_disk = {p.name for p in VERSIONS.iterdir() if p.suffix in {".py", ".sql"}}
    unknown = on_disk - set(FROZEN)
    # Exactly one revision may be unfrozen: the one being developed now.
    assert len(unknown) <= 1, (
        f"more than one migration is outside the frozen set: {sorted(unknown)}. "
        "Freeze the ones that have shipped."
    )
