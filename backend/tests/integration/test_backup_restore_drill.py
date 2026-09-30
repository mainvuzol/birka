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
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

import pytest
import scripts.backup_database as backup_module
from scripts.backup_database import back_up
from scripts.postgres_tools import Database, ToolError, tool
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
