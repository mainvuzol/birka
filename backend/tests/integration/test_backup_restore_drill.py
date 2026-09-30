"""A backup is verified only by restoring it (M1-028).

Each test backs up a database of its own — freshly migrated, holding one
shop's stock and a sale — and restores it into a scratch database on the
same server. Not the shared test database: tests there corrupt stock on
purpose, to prove reconciliation sees it, and a drill over them fails for
exactly that reason (see the report).

The PostgreSQL client tools must match the server. CI installs those of
PostgreSQL 17; locally, `BIRKA_PG_BIN` points at them. Without them these
tests skip, and CI's no-skip assertion then fails the build.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

import pytest
import scripts.backup_database as backup_module
import scripts.nightly_backup as nightly_module
from scripts.backup_database import back_up, sha256
from scripts.nightly_backup import nightly
from scripts.postgres_tools import Database, ToolError, run, tool
from scripts.restore_drill import SCRATCH_PREFIX, drill
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from tests.conftest import requires_database
from tests.integration.test_sale_command import basket, give_stock, make_shop, sell

pytestmark = [pytest.mark.integration, requires_database()]

BACKEND = Path(__file__).resolve().parents[2]


def _tools_or_skip() -> None:
    try:
        tool("pg_dump")
        tool("pg_restore")
    except ToolError as error:
        pytest.skip(f"PostgreSQL client tools unavailable: {error}")


@pytest.fixture
async def source():
    """A migrated database of this test's own, with a shop that has sold."""
    _tools_or_skip()
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    name = f"birka_backup_source_{uuid.uuid4().hex[:10]}"
    admin = create_async_engine(server.url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    async with admin.connect() as connection:
        await connection.execute(text(f'CREATE DATABASE "{name}"'))
    database = server.on(name)
    try:
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND,
            env={**os.environ, "BIRKA_DATABASE_URL": database.url},
            check=True,
            capture_output=True,
        )
        engine = create_async_engine(database.url, poolclass=NullPool)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as session:
            shop = await make_shop(session)
            await give_stock(session, shop, 5)
            await sell(session, shop, lines=basket(shop, quantity=2))
            await session.commit()
        await engine.dispose()
        yield database, shop
    finally:
        async with admin.connect() as connection:
            await connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        await admin.dispose()


async def scratch_databases(server: Database) -> list[str]:
    engine = create_async_engine(server.url, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            return list(
                (
                    await connection.execute(
                        text("SELECT datname FROM pg_database WHERE datname LIKE :prefix"),
                        {"prefix": f"{SCRATCH_PREFIX}%"},
                    )
                ).scalars()
            )
    finally:
        await engine.dispose()


def failed(report: dict) -> dict[str, str]:
    return {check["name"]: check["detail"] for check in report["checks"] if not check["ok"]}


async def recorded(database: Database) -> list[dict]:
    """The nights `backup_run` holds, which is what the owner is shown."""
    engine = create_async_engine(database.url, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            rows = await connection.execute(
                text(
                    "SELECT ok, archive, archive_bytes, drill_ok, problems "
                    "FROM backup_run ORDER BY finished_at"
                )
            )
            return [dict(row._mapping) for row in rows]
    finally:
        await engine.dispose()


async def test_a_backup_restores_and_proves_it_is_the_same_data(source, tmp_path):
    database, _ = source
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    before = await scratch_databases(server)

    manifest = await back_up(database, tmp_path)
    assert manifest["alembic_revision"] is not None
    assert manifest["tables"]["sale"] == 1
    assert manifest["tables"]["stock_movement"] == 2
    assert manifest["triggers"], "the ledger's protections are part of what is backed up"

    report = await drill(tmp_path / manifest["archive"], server)

    assert report["ok"], failed(report)
    assert [check["name"] for check in report["checks"]] == [
        "archive",
        "restore",
        "migration",
        "rows",
        "triggers",
        "locale",
        "cyrillic",
        "ledger",
    ]
    assert report["restore_seconds"] >= 0
    assert report["scratch_database"].startswith(SCRATCH_PREFIX)
    assert await scratch_databases(server) == before, "the scratch copy is dropped"


async def test_the_counts_are_the_snapshot_the_archive_holds(source, tmp_path):
    """Written from one transaction's snapshot, so nothing in between counts."""
    database, _ = source
    manifest = await back_up(database, tmp_path)
    written = json.loads((tmp_path / manifest["archive"]).with_suffix(".json").read_text())
    assert written == manifest
    assert written["archive_sha256"] and written["archive_bytes"] > 0


async def test_a_damaged_archive_is_refused_before_anything_is_created(source, tmp_path):
    database, _ = source
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    manifest = await back_up(database, tmp_path)
    archive = tmp_path / manifest["archive"]
    damaged = bytearray(archive.read_bytes())
    damaged[len(damaged) // 2] ^= 0xFF
    archive.write_bytes(bytes(damaged))
    before = await scratch_databases(server)

    report = await drill(archive, server)

    assert not report["ok"]
    assert set(failed(report)) == {"archive"}
    assert report["scratch_database"] is None
    assert await scratch_databases(server) == before


async def test_a_copy_missing_rows_fails_and_names_the_table(source, tmp_path):
    database, _ = source
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    manifest = await back_up(database, tmp_path)
    manifest_path = (tmp_path / manifest["archive"]).with_suffix(".json")
    claimed = {**manifest, "tables": {**manifest["tables"], "sale": 2}}
    manifest_path.write_text(json.dumps(claimed))

    report = await drill(tmp_path / manifest["archive"], server)

    assert set(failed(report)) == {"rows"}
    assert "sale: 1 rows, backed up 2" in failed(report)["rows"]


async def test_a_ledger_that_does_not_reconcile_fails_the_drill(source, tmp_path):
    """A balance changed behind the ledger's back is in the backup too, and a
    restore that brings it back must not be called healthy."""
    database, shop = source
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    engine = create_async_engine(database.url, poolclass=NullPool)
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "UPDATE inventory SET quantity = quantity + 4 WHERE location_id = :l "
                "AND product_variant_id = :v AND size_id = :s"
            ),
            {"l": shop.location_id, "v": shop.variant_id, "s": shop.size_id},
        )
    await engine.dispose()

    manifest = await back_up(database, tmp_path)
    report = await drill(tmp_path / manifest["archive"], server)

    assert set(failed(report)) == {"ledger"}
    assert "1 balances disagree" in failed(report)["ledger"]


async def test_kept_copies_stay_for_inspection_and_are_never_the_source(source, tmp_path):
    database, _ = source
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    manifest = await back_up(database, tmp_path)

    report = await drill(tmp_path / manifest["archive"], server, keep=True)
    try:
        assert report["ok"], failed(report)
        assert report["kept"] is True
        assert report["scratch_database"] != database.name
        assert report["scratch_database"] in await scratch_databases(server)
    finally:
        admin = create_async_engine(server.url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
        async with admin.connect() as connection:
            await connection.execute(
                text(f'DROP DATABASE IF EXISTS "{report["scratch_database"]}" WITH (FORCE)')
            )
        await admin.dispose()


async def test_a_backup_is_never_overwritten(source, tmp_path):
    database, _ = source
    manifest = await back_up(database, tmp_path)
    taken = manifest["taken_at"]
    with pytest.raises(FileExistsError):
        await back_up(database, tmp_path, now=datetime.fromisoformat(taken))


async def test_a_sale_during_the_backup_is_in_neither_the_counts_nor_the_archive(
    source, tmp_path, monkeypatch
):
    """The shop does not stop for a backup. Stock received while `pg_dump`
    starts must be in neither the manifest nor the archive — or in both —
    and the drill must find them equal either way."""
    database, shop = source
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    original = backup_module.run

    async def busy_shop(executable, *args, **kwargs):
        if executable.name == "pg_dump":
            engine = create_async_engine(database.url, poolclass=NullPool)
            maker = async_sessionmaker(engine, expire_on_commit=False)
            async with maker() as session:
                await give_stock(session, shop, 1)
            await engine.dispose()
        return await original(executable, *args, **kwargs)

    monkeypatch.setattr(backup_module, "run", busy_shop)
    manifest = await back_up(database, tmp_path)
    assert manifest["tables"]["stock_movement"] == 2, "counted before the delivery"

    report = await drill(tmp_path / manifest["archive"], server)
    assert report["ok"], failed(report)


async def test_a_ledger_left_unprotected_fails_the_drill(source, tmp_path):
    """The copy keeps a disabled trigger disabled, faithfully — which is why
    faithful is not the whole check."""
    database, _ = source
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    engine = create_async_engine(database.url, poolclass=NullPool)
    async with engine.begin() as connection:
        guard = (
            await connection.execute(
                text(
                    "SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                    "WHERE c.relname = 'stock_movement' AND NOT t.tgisinternal "
                    "ORDER BY t.tgname LIMIT 1"
                )
            )
        ).scalar_one()
        await connection.execute(text(f'ALTER TABLE stock_movement DISABLE TRIGGER "{guard}"'))
    await engine.dispose()

    manifest = await back_up(database, tmp_path)
    report = await drill(tmp_path / manifest["archive"], server)

    assert set(failed(report)) == {"triggers"}
    assert f"disabled: ['stock_movement.{guard}']" in failed(report)["triggers"]


# --- the nightly run ----------------------------------------------------------


def _old_night(out: Path) -> Path:
    """A proven backup from long ago, which retention removes on a good night."""
    stem = "birka-20250105T030000Z"
    (out / f"{stem}.dump.age").write_bytes(b"sealed")
    (out / f"{stem}.json").write_text("{}")
    (out / f"{stem}.drill.json").write_text(json.dumps({"ok": True}))
    return out / f"{stem}.dump.age"


def _age_or_skip() -> Path:
    try:
        return nightly_module.tool_age()
    except ToolError as error:
        pytest.skip(f"age unavailable: {error}")


async def test_a_good_night_backs_up_proves_and_keeps_what_the_owner_keeps(source, tmp_path):
    database, _ = source
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    old = _old_night(tmp_path)

    result = await nightly(database, server, tmp_path, recipients=[], allow_plaintext=True)

    assert result["ok"], result["problems"]
    assert result["drill"]["ok"]
    stem = result["archive"].removesuffix(".dump")
    for suffix in (".dump", ".json", ".drill.json"):
        assert (tmp_path / f"{stem}{suffix}").exists()
    assert not old.exists(), "retention removed the old night"
    assert "birka-20250105T030000Z.dump.age" in result["pruned"]
    assert json.loads((tmp_path / "last-run.json").read_text()) == result
    assert await recorded(database) == [
        {
            "ok": True,
            "archive": result["archive"],
            "archive_bytes": (tmp_path / result["archive"]).stat().st_size,
            "drill_ok": True,
            "problems": [],
        }
    ]


async def test_a_night_without_the_owners_key_fails_and_deletes_nothing(source, tmp_path):
    """Copies leave the server only encrypted (owner decision, 2026-09-30)."""
    database, _ = source
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    old = _old_night(tmp_path)

    result = await nightly(database, server, tmp_path, recipients=[])

    assert not result["ok"]
    assert [problem["step"] for problem in result["problems"]] == ["key"]
    assert "not encrypted" in result["problems"][0]["detail"]
    assert result["pruned"] == []
    assert old.exists()
    assert (tmp_path / result["archive"]).exists(), "the night's backup is still kept"
    [night] = await recorded(database)
    assert night["ok"] is False
    assert night["problems"] == result["problems"]


async def test_a_night_whose_drill_fails_keeps_its_backup_and_deletes_nothing(source, tmp_path):
    """A drill failing on the data has found a problem in the data; the copy is
    still the best there is, and the copies before it must survive."""
    database, shop = source
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    engine = create_async_engine(database.url, poolclass=NullPool)
    async with engine.begin() as connection:
        await connection.execute(
            text("UPDATE inventory SET quantity = quantity + 1 WHERE location_id = :l"),
            {"l": shop.location_id},
        )
    await engine.dispose()
    old = _old_night(tmp_path)

    result = await nightly(database, server, tmp_path, recipients=[], allow_plaintext=True)

    assert not result["ok"]
    assert result["drill"]["failed"] == ["ledger"]
    [problem] = result["problems"]
    assert problem["step"] == "drill"
    assert problem["checks"] == ["ledger"]
    assert result["pruned"] == []
    assert old.exists()
    assert (tmp_path / result["archive"]).exists()
    [night] = await recorded(database)
    assert night["ok"] is False
    assert night["drill_ok"] is False
    assert night["problems"] == result["problems"]


async def test_a_night_that_cannot_back_up_says_so(tmp_path):
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    _tools_or_skip()
    missing = server.on(f"birka_backup_missing_{uuid.uuid4().hex[:8]}")

    result = await nightly(missing, server, tmp_path, recipients=[], allow_plaintext=True)

    assert not result["ok"]
    # Nor can it be recorded where the owner would see it: the database is
    # not there. The watcher sees a missing night as an overdue one.
    assert [problem["step"] for problem in result["problems"]] == ["backup", "record"]
    assert json.loads((tmp_path / "last-run.json").read_text())["ok"] is False


async def test_an_encrypted_night_can_only_be_read_with_the_owners_key(source, tmp_path):
    """The whole promise: the server writes a copy it cannot read, and the
    owner's key turns it back into exactly the archive that was drilled."""
    age = _age_or_skip()
    database, _ = source
    server = Database(os.environ["BIRKA_TEST_DATABASE_URL"])
    identity = tmp_path / "owner-key.txt"
    await run(age.with_name("age-keygen"), "-o", str(identity))
    # age-keygen writes "# public key: age1…" into the key file it creates.
    recipient = re.search(r"age1[0-9a-z]{58}", identity.read_text())
    assert recipient
    out = tmp_path / "backups"
    out.mkdir()

    result = await nightly(database, server, out, recipients=[recipient.group(0)])

    assert result["ok"], result["problems"]
    stem = result["archive"].removesuffix(".dump.age")
    assert result["archive"].endswith(".dump.age")
    assert not (out / f"{stem}.dump").exists(), "no plaintext is left on the server"
    manifest = json.loads((out / f"{stem}.json").read_text())
    sealed = out / result["archive"]
    assert manifest["encrypted_sha256"] == sha256(sealed)
    assert manifest["recipients"] == [recipient.group(0)]

    opened = tmp_path / "opened.dump"
    await run(age, "--decrypt", "-i", str(identity), "-o", str(opened), str(sealed))
    assert sha256(opened) == manifest["archive_sha256"]
