"""Disposable local migration probe. Start this fixed database at revision 0008."""

import asyncio
import os
import subprocess
import sys
import uuid

import asyncpg

DSN = "postgresql://birka_review@127.0.0.1:55442/birka_private_migration"
ENV = {**os.environ, "BIRKA_DATABASE_URL": DSN.replace("postgresql:", "postgresql+asyncpg:")}


def migrate(*args, refusal=None):
    result = subprocess.run([sys.executable, "-m", "alembic", *args], env=ENV, capture_output=True, text=True)
    if refusal:
        assert result.returncode != 0 and refusal in result.stderr, result.stderr
    else:
        assert result.returncode == 0, result.stderr


async def main():
    # Empty-control rollback window remains usable.
    migrate("upgrade", "head")
    migrate("check")
    migrate("downgrade", "0008_transfer_replay")
    db = await asyncpg.connect(DSN)
    org, store, marked, legacy, audit = [uuid.uuid4() for _ in range(5)]
    try:
        await db.execute("INSERT INTO organization(id,name) VALUES($1,'Synthetic migration')", org)
        await db.execute("INSERT INTO store(id,organization_id,name,code,kind) VALUES($1,$2,'Child','SECOND','SECONDARY')", store, org)
        for location, code in ((marked, "MARKED"), (legacy, "LEGACY")):
            await db.execute("INSERT INTO stock_location(id,organization_id,name,code) VALUES($1,$2,$3,$3)", location, org, code)
        await db.execute(
            "INSERT INTO audit_log(id,organization_id,action,entity_type,entity_id,after) "
            "VALUES($1,$2,'bootstrap.child_warehouse.v1','stock_location',$3, "
            "jsonb_build_object('location_id',($3::uuid)::text,'child_store_id',$4::text))",
            audit, org, marked, str(store),
        )
        audit_before = await db.fetchval("SELECT row_to_json(a)::text FROM audit_log a WHERE id=$1", audit)
        migrate("upgrade", "head")
        assert await db.fetchval("SELECT managing_store_id FROM stock_location WHERE id=$1", marked) == store
        assert await db.fetchval("SELECT managing_store_id FROM stock_location WHERE id=$1", legacy) is None
        assert await db.fetchval("SELECT row_to_json(a)::text FROM audit_log a WHERE id=$1", audit) == audit_before
        migrate("downgrade", "0008_transfer_replay", refusal="Cannot downgrade private warehouse controls")
        assert await db.fetchval("SELECT version_num FROM alembic_version") == "0009_private_locations"
        assert await db.fetchval("SELECT managing_store_id FROM stock_location WHERE id=$1", marked) == store
        migrate("check")
        print("PASS: empty roundtrip; explicit child mapping backfilled; legacy unclassified; audit unchanged; unsafe downgrade refused; no drift")
    finally:
        await db.close()


asyncio.run(main())
