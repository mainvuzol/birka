"""Run with the review venv, from backend/, against the disposable Birka DB only.

Start at 0004 with synthetic regression data. No supplied URL or real database
is accepted. This is a local verification artifact, not a production tool.
"""

import asyncio
import os
import subprocess
import sys
import uuid

import asyncpg

DSN = "postgresql://birka_review@127.0.0.1:55439/birka_locations_review"
ENV = {**os.environ, "BIRKA_DATABASE_URL": DSN.replace("postgresql:", "postgresql+asyncpg:")}
NEW_TABLES = {"stock_location", "store_location_access"}


def migrate(*args, succeeds=True):
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args], env=ENV, capture_output=True, text=True
    )
    if succeeds:
        assert result.returncode == 0, result.stderr
    else:
        assert result.returncode != 0, "Populated foundation downgrade must refuse"
        assert "Cannot downgrade" in result.stderr, result.stderr


async def snapshot():
    connection = await asyncpg.connect(DSN)
    try:
        tables = await connection.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
        )
        contents = {}
        for row in tables:
            name = row["tablename"]
            if name in NEW_TABLES or name == "alembic_version":
                continue
            quoted = '"' + name.replace('"', '""') + '"'
            contents[name] = sorted(
                await connection.fetchval(
                    f"SELECT coalesce(array_agg(row_to_json(t)::text), ARRAY[]::text[]) FROM {quoted} t"
                )
            )
        triggers = await connection.fetch(
            "SELECT tgname, tgenabled::text FROM pg_trigger "
            "WHERE tgrelid = 'stock_movement'::regclass AND NOT tgisinternal ORDER BY tgname"
        )
        return contents, [tuple(row) for row in triggers]
    finally:
        await connection.close()


async def main():
    before = await snapshot()
    assert all(before[0][table] for table in ("inventory", "stock_movement", "sale", "refund"))
    migrate("upgrade", "head")
    assert await snapshot() == before, "Upgrade changed existing data or ledger triggers"
    migrate("check")
    connection = await asyncpg.connect(DSN)
    try:
        assert await connection.fetchval("SELECT count(*) FROM stock_location") == 0
        assert await connection.fetchval("SELECT count(*) FROM store_location_access") == 0
    finally:
        await connection.close()
    migrate("downgrade", "0004_refund_replay")
    assert await snapshot() == before, "Downgrade changed legacy data"
    migrate("upgrade", "head")
    assert await snapshot() == before, "Second upgrade changed legacy data"

    connection = await asyncpg.connect(DSN)
    location_id, access_id = uuid.uuid4(), uuid.uuid4()
    try:
        store = await connection.fetchrow("SELECT id, organization_id FROM store LIMIT 1")
        await connection.execute(
            "INSERT INTO stock_location (id, organization_id, code, name) VALUES ($1,$2,$3,$4)",
            location_id, store["organization_id"], str(location_id), "Synthetic migration guard",
        )
        migrate("downgrade", "0004_refund_replay", succeeds=False)
        assert await connection.fetchval("SELECT count(*) FROM stock_location WHERE id=$1", location_id) == 1
        await connection.execute(
            "INSERT INTO store_location_access "
            "(id, organization_id, store_id, location_id, can_sell, can_receive) "
            "VALUES ($1,$2,$3,$4,false,false)",
            access_id, store["organization_id"], store["id"], location_id,
        )
        migrate("downgrade", "0004_refund_replay", succeeds=False)
        assert await connection.fetchval("SELECT count(*) FROM store_location_access WHERE id=$1", access_id) == 1
        assert await connection.fetchval("SELECT version_num FROM alembic_version") == "0005_stock_locations"
    finally:
        await connection.execute("DELETE FROM store_location_access WHERE id=$1", access_id)
        await connection.execute("DELETE FROM stock_location WHERE id=$1", location_id)
        await connection.close()
    assert await snapshot() == before
    migrate("check")
    print("PASS: 36 legacy tables and ledger triggers unchanged; empty-table upgrade/downgrade/upgrade; populated downgrade refused twice; no schema drift")


asyncio.run(main())
