"""The 5 000-answer approval with every line answered by size (2026-10-09).

The approval reads every line answered `STATED_BY_SIZE` again
(`snapshots.service._splits_unsaid`, ADR-0014 §5). The 2026-10-08 run
answered every line `STATED`, so that read had nothing to do. This reuses
`backend/scripts/measure_opening_approval.py` (its seed, its runs, its
timing of the approval through the app), with one change: each line of its
files shows a split, «Позиція <letters> S-1» with `size_counts`, and is
answered `STATED_BY_SIZE`. The time of the re-check itself is logged per
approval. `MODE=stated` runs the 2026-10-08 method unchanged, for a figure
of the same hour on the same machine.

Run from `backend/`, against a disposable database only:

    BIRKA_PERF_DATABASE_URL=postgresql+asyncpg://…/<disposable> \
    BIRKA_PERF_OUTPUT=<folder> [MODE=stated] \
    python <this file>

It writes about 30 000 lines and opens three warehouses.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, os.getcwd())

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: E402

from app.core.config import Settings  # noqa: E402
from app.core.db import create_engine  # noqa: E402
from app.modules.authz.service import resolve_scope  # noqa: E402
from app.modules.snapshots import service as snapshots  # noqa: E402
from app.modules.snapshots.models import SnapshotQuantityBasis  # noqa: E402
from app.modules.snapshots.stock_file import MAX_PART_LINES, StockFileV1  # noqa: E402
from scripts import measure_opening_approval as m  # noqa: E402

LETTERS = "абвгдежзикнопрту"


def name(n: int) -> str:
    out = ""
    while True:
        n, r = divmod(n, len(LETTERS))
        out = LETTERS[r] + out
        if n == 0:
            return out


def a_file(part: int, first: int, count: int) -> StockFileV1:
    return StockFileV1.model_validate(
        {
            "format": "birka.stock-list",
            "version": 1,
            "source": f"Зошит {part}",
            "lines": [
                {
                    "text": f"Позиція {name(first + offset)} "
                    f"{m.SIZE_CODES[(first + offset - 1) % 4]}-1",
                    "photo": f"IMG_{part:04d}.jpg",
                    "photo_line": offset + 1,
                    "size_counts": [
                        {"size": m.SIZE_CODES[(first + offset - 1) % 4], "count": 1}
                    ],
                }
                for offset in range(count)
            ],
        }
    )


async def build_list(maker, shop, *, size, location):
    async with maker() as session:
        scope = await resolve_scope(session, shop.owner_id)
    slowest_add = 0.0
    async with maker.begin() as session:
        view, _ = await snapshots.import_snapshot(
            session,
            scope=scope,
            command_id=uuid.uuid4(),
            store_id=shop.store_id,
            location_id=location,
            file=a_file(1, 1, min(size, MAX_PART_LINES)),
            file_name="зошит-1.json",
        )
    snapshot_id = uuid.UUID(str(view["snapshot_id"]))
    for part, first in enumerate(range(MAX_PART_LINES + 1, size + 1, MAX_PART_LINES), start=2):
        started = time.perf_counter()
        async with maker.begin() as session:
            await snapshots.add_part(
                session,
                scope=scope,
                snapshot_id=snapshot_id,
                command_id=uuid.uuid4(),
                file=a_file(part, first, min(MAX_PART_LINES, size - first + 1)),
                file_name=f"зошит-{part}.json",
            )
        slowest_add = max(slowest_add, time.perf_counter() - started)
    for start in range(0, size, m.ANSWERS_PER_COMMIT):
        async with maker.begin() as session:
            for line_no in range(start + 1, min(start + m.ANSWERS_PER_COMMIT, size) + 1):
                variant_id, size_id = shop.keys[line_no - 1]
                await snapshots.resolve_row(
                    session,
                    scope=scope,
                    snapshot_id=snapshot_id,
                    line_no=line_no,
                    allocations=[
                        snapshots.AllocationInput(
                            product_variant_id=variant_id, quantity=1, size_id=size_id
                        )
                    ],
                    quantity_basis=SnapshotQuantityBasis.STATED_BY_SIZE,
                )
    return snapshot_id, slowest_add


async def main() -> None:
    url = os.environ["BIRKA_PERF_DATABASE_URL"]
    settings = Settings(app_env="local", database_url=url)
    engine = create_engine(settings)
    out = Path(os.environ["BIRKA_PERF_OUTPUT"])
    out.mkdir(parents=True, exist_ok=True)
    log = m.Log(out / "run.txt")
    stated = os.environ.get("MODE") == "stated"
    if not stated:
        m.a_file = a_file
        m.build_list = build_list
    for key, value in m.RUN_CAPS.items():
        setattr(snapshots, key, value)
    log(
        "5 000 allocations, every line answered "
        + ("STATED (the 2026-10-08 method)" if stated else "STATED_BY_SIZE (re-check reads all)")
    )
    for line in m.describe_machine():
        log(line)
    for line in await m.describe_postgres(engine):
        log(line)
    clock = m.Clock()
    clock.attach(engine)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    shop = await m.seed(maker)
    timings: list[float] = []
    original = snapshots._splits_unsaid

    async def timed_unsaid(*args, **kwargs):
        started = time.perf_counter()
        try:
            return await original(*args, **kwargs)
        finally:
            timings.append(time.perf_counter() - started)

    snapshots._splits_unsaid = timed_unsaid
    result = await m.measure_size(maker, clock, shop, 5_000, log)
    log(
        f"slowest approval {result['slowest_approval_s']:.2f} s, slowest statement "
        f"{result['slowest_statement_s']:.3f} s -> {'PASS' if result['approval_passes'] else 'FAIL'}"
    )
    log("re-check (_splits_unsaid) per approval: " + ", ".join(f"{t:.3f} s" for t in timings))
    (out / "summary.json").write_text(
        json.dumps({"result": result, "recheck_s": timings}, ensure_ascii=False, indent=2, default=str)
    )
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))
    await engine.dispose()


asyncio.run(main())
