"""The approval's re-check read at 5 000 lines, with the statistics a test
suite leaves (review, third round, 2026-10-09).

Times the statement that reads the rows answered by size with their texts
(`snapshots.service._splits_unsaid`) in the old form, correlated on the raw
input's id and its organization, and in the new one (`catalog.raw_lines.
text_of`: the id alone, the organization checked with IS NOT DISTINCT
FROM), with EXPLAIN (ANALYZE, BUFFERS) of each, before this run's own rows
are analyzed. Then times `_splits_unsaid` itself, and checks that another
organization reads no text.

Run from `backend/`, on a disposable database, after the snapshot tests on
it (so that its statistics are a test suite's: many organizations of a few
lines each):

    BIRKA_TEST_DATABASE_URL=postgresql+asyncpg://…/<disposable> \
    python -m pytest -q -s tests/integration/test_snapshot_parts.py \
        tests/integration/test_snapshot_import.py
    BIRKA_TEST_DATABASE_URL=… python -m pytest -q -s -c pyproject.toml \
        --rootdir=. <this file>
"""
from __future__ import annotations

import time
import uuid

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.dialects import postgresql

from app.modules.catalog.evidence import RawInput
from app.modules.catalog.raw_lines import text_of
from app.modules.snapshots import service as snapshot_service
from app.modules.snapshots.models import (
    InventorySnapshotPart,
    InventorySnapshotRow,
    SnapshotQuantityBasis,
    SnapshotRowStatus,
)
from tests.conftest import requires_database
from tests.integration.test_snapshot_parts import (  # noqa: F401
    add_file, added, counts, created_from_file, file_line, stock_file, world,
)

pytestmark = [pytest.mark.integration, requires_database()]


def statement(org, sid, column):
    return (
        select(InventorySnapshotRow.id, column)
        .join(InventorySnapshotPart, InventorySnapshotPart.id == InventorySnapshotRow.part_id)
        .where(
            InventorySnapshotRow.inventory_snapshot_id == sid,
            InventorySnapshotRow.status == SnapshotRowStatus.RESOLVED,
            InventorySnapshotRow.quantity_basis == SnapshotQuantityBasis.STATED_BY_SIZE,
            InventorySnapshotPart.removed_at.is_(None),
        )
        .order_by(InventorySnapshotRow.line_no)
    )


async def test_cost(world):
    w = world
    async with w.client() as client:
        files = [
            stock_file(*[
                file_line(f"Лоран M-{(n % 9) + 1}", photo=f"IMG_{f}.jpg", photo_line=n,
                          size_counts=counts(("M", (n % 9) + 1)))
                for n in range(1, 1001)
            ])
            for f in range(5)
        ]
        view = await created_from_file(client, w, files[0])
        sid = view["snapshot_id"]
        for f in range(1, 5):
            await added(await add_file(client, sid, files[f], file_name=f"z{f}.json"))
    async with w.maker.begin() as session:
        user = (await session.execute(text("SELECT id FROM app_user LIMIT 1"))).scalar()
        await session.execute(text(
            "UPDATE inventory_snapshot_row SET status='RESOLVED', "
            "quantity_basis='STATED_BY_SIZE', resolved_at=now(), resolved_by_user_id=:u "
            "WHERE inventory_snapshot_id=:s"), {"u": user, "s": sid})
    snapshot_id = uuid.UUID(sid)
    old_column = (
        select(RawInput.raw_text)
        .where(RawInput.id == InventorySnapshotRow.raw_input_id, RawInput.organization_id == w.org)
        .scalar_subquery()
    )
    new_column = text_of(InventorySnapshotRow.raw_input_id, organization_id=w.org)
    async with w.maker() as session:
        stats = (await session.execute(text(
            "SELECT relname, n_live_tup, last_analyze, last_autoanalyze FROM pg_stat_user_tables "
            "WHERE relname IN ('raw_input','inventory_snapshot_row','inventory_snapshot_part') ORDER BY 1"))).all()
        for row in stats:
            print("STATS", tuple(row))
        orgs = (await session.execute(text("SELECT count(DISTINCT organization_id), count(*) FROM raw_input"))).one()
        print("RAW_INPUT organizations, rows:", tuple(orgs))
        for label, column in (("old (id AND organization_id)", old_column), ("new (text_of)", new_column)):
            sql = str(statement(w.org, snapshot_id, column).compile(
                dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
            plan = (await session.execute(text("EXPLAIN (ANALYZE, BUFFERS) " + sql))).all()
            print("PLAN ---", label)
            for row in plan:
                print("PLAN", row[0])
            for attempt in range(3):
                started = time.perf_counter()
                rows = (await session.execute(statement(w.org, snapshot_id, column))).all()
                print(f"STMT {label} run {attempt + 1}: {time.perf_counter() - started:.3f} s, {len(rows)} rows")
                assert len(rows) == 5000 and all(r[1] for r in rows)
    timings = []

    def before(conn, cursor, statement_, parameters, context, executemany):
        conn.info["t0"] = time.perf_counter()

    def after(conn, cursor, statement_, parameters, context, executemany):
        timings.append((time.perf_counter() - conn.info["t0"], statement_.split("\n")[0][:60]))

    event.listen(w.engine.sync_engine, "before_cursor_execute", before)
    event.listen(w.engine.sync_engine, "after_cursor_execute", after)
    async with w.maker() as session:
        for attempt in range(3):
            timings.clear()
            started = time.perf_counter()
            unsaid = await snapshot_service._splits_unsaid(
                session, organization_id=w.org, snapshot_id=snapshot_id)
            took = time.perf_counter() - started
            print(f"UNSAID run {attempt + 1}: {took:.3f} s ({len(unsaid)} unsaid); statements: "
                  + ", ".join(f"{t:.3f} s {s}" for t, s in timings))
    event.remove(w.engine.sync_engine, "before_cursor_execute", before)
    event.remove(w.engine.sync_engine, "after_cursor_execute", after)
    # Another organization's row reads as no text, by either form.
    async with w.maker() as session:
        other = uuid.uuid4()
        texts = (await session.execute(statement(other, snapshot_id, text_of(
            InventorySnapshotRow.raw_input_id, organization_id=other)))).all()
        print("TENANT other organization:", len(texts), "rows,", sum(1 for r in texts if r[1] is not None), "with text")
        assert all(r[1] is None for r in texts)
