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
    "0025_store_states.py": ("1aa112e98e56104e5412546efedb28599414514637e58b94fef88b428701f35f"),
    "0026_supplier_returns.py": (
        "2165966917e851a417cab0c4a78d3f51b7f2b993eb1339370ae0e305c67fca1c"
    ),
    "0027_supplier_invoices.py": (
        "faa311a75da50170cd6c95d9167ba21e03bbe3d778549bca397ebcabc68af70a"
    ),
    "0028_order_shipping.py": ("80cf0a4f44857fa5b7fc3f0ff65a20ac09b033eb72cd69b07a5b99376342841d"),
    "0029_borrowed_goods.py": ("57a954632c9dcb00cd26691ae9ed8b847c6eb257fbdc81b123a346dad9a4d7b3"),
    "0030_opening_list_hold.py": (
        "426cf27459d702f7a8c9b7df1efaa75a9f71dbfcce1692555ab35ff114b40700"
    ),
    "0031_catalog_correction.py": (
        "3d7a94b4124771d31de5ee623313489e726b71344dcb5b569ffa7855fe7ac0c2"
    ),
    "0024_returns_elsewhere.py": (
        "618c349021af46076a8f04fa20b7488c5b3457923d6eb895906d9d8b9657c622"
    ),
    "0023_customer_credit.py": ("a9098918a481fe955ab39dfcda6817fc8008bca4e670ad8307f03518b9f03b7e"),
    "0022_shelf_shortage.py": ("768923e27f7762e16cc6649223dd25cc2f1552e56b5dae0e945bfb567c8fb399"),
    "0021_suggested_price.py": ("f6dccf89a78a95dce1ccaa6e799629d9e84f2ecc8efa7dc3fd50c0f745c2e5c2"),
    "0020_damaged_units.py": ("f484c01a697fed2f7c4e190404cce7be1f83caf08339e85ebf4dd82611c5d26f"),
    "0019_till_returns.py": ("311f39a1107d6cdf82311bede61d4efc814d77a63dfb3c31e96370dad53fd591"),
    "0018_backup_alerts.py": ("d0c75935df5c52d2b0e8d13761d5ebb5c34ba414392c8ff2816f7c4a4effa2c8"),
    "0017_stock_adjustment.py": (
        "f1b7170aad51ec468532ccdc6072e4d8e0fae23eeb8525c785054af3fdb0ff44"
    ),
    "0016_goods_receipt.py": ("2b6343747cb223eb2543202c246aeae9e62b3500141970c1f999eae453d9167a"),
    "0015_snapshot_import.py": ("3f29376e1baf59af130312c29cc47b2bce4887db9d9324a110d1562903f1d02f"),
    "0014_alias_feedback_identity.py": (
        "f10ba32edd22d1566fe5419adf50d43f802dcf19cf2cc69d2020c703014fd541"
    ),
    "0013_catalog_knowledge.py": (
        "15cd588a95d565203e3d6bfd30fbfa8ff9bffd5bdec1cdd5f897c3319da8bec1"
    ),
    "0012_catalog_trigram.py": ("b7abb69dd5b2d9da7b070b903692dd351bf96f4f25e32656477b392a9859514a"),
    "0011_customer_orders.py": ("d0390e7579127564463b1bc4d0e8e6138e60e76f1c344379fa266ae7a828fc41"),
    "0009_private_location_control.py": (
        "e7e89fba66797b07af221df688a3bbba81445171b8a57ef723707e115bd79634"
    ),
    "0010_stock_reservations.py": (
        "dce060990668257d4b53f72f51c8922265f063bc2040de39b2fdb1df240b9043"
    ),
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
    "0006_stock_location_rekey.py": (
        "0daeb67e082736245bc36c54ff543275a1eba9cded95a0c43e409f6dc12a7722"
    ),
    "0007_missing_at_sale.py": ("ace1eb1d2de40e4c4ce12a5a64836ac60cdc440b1a6e0ed59461e682bba0b213"),
    "0008_transfer_command_replay.py": (
        "b731735a65326e8de2bac8d4b09beb5729234a994f717246b3287a186401d3cf"
    ),
}


def digest(path: Path) -> str:
    """The digest of the file as git stores it.

    Line endings are normalized first. A Windows checkout with
    `core.autocrlf=true` writes every file with CRLF, so hashing the raw bytes
    made this test fail on the owner's machine for every shipped migration —
    a permanently red test that says nothing. Git itself stores these files
    with LF, and CRLF versus LF changes nothing Python or Alembic executes, so
    ignoring the checkout's translation loses no protection against an edit.
    """
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


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
