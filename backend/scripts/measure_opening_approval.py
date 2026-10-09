"""Measure what an opening list's approval costs, to set how large a list may be (ADR-0014 §10).

The owner decided that several files fill one warehouse's list, and that its
limits are raised (business-rules.md, 2026-10-08). The approval is the bound:
it writes the whole list in one transaction, holding the warehouse
exclusively (ADR-0005 §4, §5), about five or six statements per answer. The
5 000 answers a list took before were never measured.

**What runs.** For each size of list — 2 000, 5 000 and 10 000 answers — three
times, on a fresh empty warehouse:

1. the list is built through the service, in parts of 1 000 lines: the first
   from a file, through `import_snapshot`, the rest through `add_part`;
2. every line is answered `STATED`, one allocation each, through
   `resolve_row`. Each answer names its own stock key — the worst case:
   N/4 models × 4 sizes;
3. once per size, through the app: the list, its last page of lines, a
   further 1 000-line file added and then removed again (a list at its
   largest, with a removed file's lines in it);
4. the approval, through the app: `POST /snapshots/{id}/approve`;
5. once per size, through the app: the first page of what the list became.

Through the real app, in process (`httpx.ASGITransport`), on the app's own
engine (`app.core.db.create_engine`: its statement timeout included). Each
SQL statement is counted and timed at the cursor.

**The pass rule** (ADR-0014 §10): a size passes when its slowest approval
took at most 10 s and no statement of it over 5 s; adding a part passes at
5 s, a page at 0.5 s. The client waits 60 s for a slow call (§16). An
approval the app refuses fails its size outright; the size's further runs
are not made, since they would build the same list to watch it fail.

The module's caps are raised for the run, so every size can be built; the
header prints them. Nothing here changes them in the code.

Run it against a disposable database only; it writes tens of thousands of
lines and opens warehouses:

    BIRKA_PERF_DATABASE_URL=postgresql+asyncpg://…/birka_json_perf \\
    python -m scripts.measure_opening_approval

It migrates the database to head first. Its evidence goes to
`output/verification/<date>-json-import-approval/` (`run.txt`,
`summary.json`), or to `BIRKA_PERF_OUTPUT`.
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import subprocess
import sys
import time
import uuid
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

import app.models_registry  # noqa: F401  - every table on the metadata, like migrations/env.py
from app.core.config import Settings
from app.core.db import create_engine
from app.modules.authz.scope import RequestScope
from app.modules.authz.service import resolve_scope
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    CanonicalConcept,
    ProductFamily,
    ProductVariant,
    Size,
    SizeSystem,
    SizeSystemCode,
)
from app.modules.snapshots import service as snapshots
from app.modules.snapshots.models import SnapshotQuantityBasis
from app.modules.snapshots.stock_file import MAX_PART_LINES, StockFileV1
from app.modules.tenancy.models import StockLocation, StoreLocationAccess
from scripts.seed_organization import seed_in_session

# The same fence `measure_hot_path` uses, for the same reason: this writes
# tens of thousands of rows, and must never meet a real database.
ALLOWED_DATABASES = frozenset({"birka_perf", "birka_json_perf"})
BACKEND = Path(__file__).resolve().parents[1]

SIZES = (2_000, 5_000, 10_000)
RUNS = 3
SIZE_CODES = ("S", "M", "L", "XL")
# How many answers are given in one transaction while building a list. Each
# is still its own `resolve_row`, exactly as a phone's answer is.
ANSWERS_PER_COMMIT = 100

APPROVAL_BUDGET_S = 10.0
STATEMENT_BUDGET_S = 5.0
ADD_PART_BUDGET_S = 5.0
PAGE_BUDGET_S = 0.5

# Raised for the run, before the API is imported (its path and page bounds
# are read once, at import): the largest list, plus the file added and
# removed again.
RUN_CAPS = {
    "MAX_LIST_ALLOCATIONS": max(SIZES),
    "MAX_LIST_LINES": max(SIZES) + MAX_PART_LINES,
    "MAX_LIST_ROWS": max(SIZES) + MAX_PART_LINES,
}


@dataclass
class Clock:
    """Every statement the app's engine sends, while `on`."""

    on: bool = False
    count: int = 0
    slowest: float = 0.0
    slowest_sql: str = ""
    started: list[float] = field(default_factory=list)

    def reset(self) -> None:
        self.on, self.count, self.slowest, self.slowest_sql = True, 0, 0.0, ""

    def attach(self, engine: AsyncEngine) -> None:
        def before(*_: Any) -> None:
            self.started.append(time.perf_counter())

        def after(_c: Any, _k: Any, statement: str, *_: Any) -> None:
            elapsed = time.perf_counter() - self.started.pop()
            if not self.on:
                return
            self.count += 1
            if elapsed > self.slowest:
                self.slowest = elapsed
                self.slowest_sql = " ".join(statement.split())[:160]

        event.listen(engine.sync_engine, "before_cursor_execute", before)
        event.listen(engine.sync_engine, "after_cursor_execute", after)


class Log:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.write_text("", encoding="utf-8")

    def __call__(self, line: str = "") -> None:
        print(line, flush=True)
        with self.path.open("a", encoding="utf-8") as out:
            out.write(line + "\n")


def describe_machine() -> list[str]:
    def sysctl(name: str) -> str:
        try:
            done = subprocess.run(  # noqa: S603 — a fixed command
                ["/usr/sbin/sysctl", "-n", name], capture_output=True, text=True, check=True
            )
        except (OSError, subprocess.CalledProcessError):
            return "unknown"
        return done.stdout.strip()

    memory = sysctl("hw.memsize")
    return [
        f"machine: {platform.platform()} ({platform.machine()}), {os.cpu_count()} CPUs, "
        f"{sysctl('machdep.cpu.brand_string')}, "
        f"{int(memory) // 2**30 if memory.isdigit() else memory} GiB",
        f"python: {platform.python_version()} ({platform.python_implementation()})",
    ]


async def describe_postgres(engine: AsyncEngine) -> list[str]:
    async with engine.connect() as connection:
        version = await connection.scalar(text("SELECT version()"))
        shown = {}
        for name in (
            "fsync",
            "synchronous_commit",
            "shared_buffers",
            "work_mem",
            "max_wal_size",
            "statement_timeout",
        ):
            shown[name] = await connection.scalar(text(f"SHOW {name}"))
    return [
        f"postgresql: {version}",
        "settings: " + ", ".join(f"{k} {v}" for k, v in shown.items()),
    ]


def migrate(url: str) -> None:
    """`alembic upgrade head` on the perf database, as its own process."""
    # The interpreter running this, a fixed command.
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND,
        env={**os.environ, "BIRKA_DATABASE_URL": url},
        check=True,
        capture_output=True,
    )


@dataclass(frozen=True, slots=True)
class Shop:
    organization_id: uuid.UUID
    store_id: uuid.UUID
    owner_id: uuid.UUID
    # Every key a list may name: (variant, size), N/4 models × 4 sizes.
    keys: list[tuple[uuid.UUID, uuid.UUID]]


async def seed(maker: async_sessionmaker[AsyncSession]) -> Shop:
    """One organization, bootstrapped as the CLI does, and models enough for
    the largest list, each in four sizes."""
    async with maker.begin() as session:
        telegram_user_id = uuid.uuid4().int % 2**52
        organization_id = await seed_in_session(
            session,
            telegram_user_id=telegram_user_id,
            owner_name="Власниця",
            org_name=f"json-perf-{uuid.uuid4().hex[:8]}",
        )
        owner = await session.scalar(
            text("SELECT id FROM app_user WHERE telegram_user_id = :t"), {"t": telegram_user_id}
        )
        store = await session.scalar(
            text("SELECT id FROM store WHERE organization_id = :o AND code = 'MAIN'"),
            {"o": organization_id},
        )
        system = SizeSystem(
            organization_id=organization_id, code=SizeSystemCode.ALPHA, name="Alpha"
        )
        session.add(system)
        await session.flush()
        sizes = [Size(size_system_id=system.id, code=code) for code in SIZE_CODES]
        session.add_all(sizes)
        await session.flush()
        variants: list[ProductVariant] = []
        for index in range(max(SIZES) // len(SIZE_CODES)):
            concept = CanonicalConcept(
                organization_id=organization_id,
                name=f"Модель {index}",
                normalized_name=f"модель {index}",
            )
            colour = AttributeTerm(
                organization_id=organization_id,
                kind=AttributeKind.COLOR,
                name=f"колір {index}",
                normalized_name=f"колір {index}",
            )
            session.add_all([concept, colour])
            await session.flush()
            family = ProductFamily(organization_id=organization_id, canonical_concept_id=concept.id)
            session.add(family)
            await session.flush()
            variant = ProductVariant(
                product_family_id=family.id, color_term_id=colour.id, length_cm=Decimal("70")
            )
            session.add(variant)
            variants.append(variant)
        await session.flush()
        assert owner is not None and store is not None
        keys = [(variant.id, size.id) for variant in variants for size in sizes]
    return Shop(organization_id=organization_id, store_id=store, owner_id=owner, keys=keys)


async def fresh_warehouse(
    maker: async_sessionmaker[AsyncSession], shop: Shop, name: str
) -> uuid.UUID:
    async with maker.begin() as session:
        location = StockLocation(
            organization_id=shop.organization_id, code=f"PERF-{uuid.uuid4().hex[:8]}", name=name
        )
        session.add(location)
        await session.flush()
        session.add(
            StoreLocationAccess(
                organization_id=shop.organization_id,
                store_id=shop.store_id,
                location_id=location.id,
                can_sell=True,
                can_receive=True,
            )
        )
    return location.id


def a_file(part: int, first: int, count: int) -> StockFileV1:
    """A parser's file of `count` lines, one photo, each a count with its unit."""
    return StockFileV1.model_validate(
        {
            "format": "birka.stock-list",
            "version": 1,
            "source": f"Зошит {part}",
            "lines": [
                {
                    "text": f"Позиція {first + offset} 1 шт",
                    "photo": f"IMG_{part:04d}.jpg",
                    "photo_line": offset + 1,
                    "count": 1,
                }
                for offset in range(count)
            ],
        }
    )


async def build_list(
    maker: async_sessionmaker[AsyncSession], shop: Shop, *, size: int, location: uuid.UUID
) -> tuple[uuid.UUID, float]:
    """A list of `size` lines in parts of 1 000, every line answered.
    Returns the list and the slowest part added, in seconds."""
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
    for start in range(0, size, ANSWERS_PER_COMMIT):
        async with maker.begin() as session:
            for line_no in range(start + 1, min(start + ANSWERS_PER_COMMIT, size) + 1):
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
                    quantity_basis=SnapshotQuantityBasis.STATED,
                )
    return snapshot_id, slowest_add


@asynccontextmanager
async def app_client(
    maker: async_sessionmaker[AsyncSession], shop: Shop
) -> AsyncIterator[httpx.AsyncClient]:
    from app.api.deps import get_current_scope, session_dependency
    from app.main import create_app

    app = create_app(Settings(app_env="local", session_secret="measure-opening-approval-" * 2))

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    async def scope() -> RequestScope:
        async with maker() as session:
            return await resolve_scope(session, shop.owner_id)

    app.dependency_overrides[get_current_scope] = scope
    app.dependency_overrides[session_dependency] = sessions
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://perf",
        timeout=300.0,
    ) as client:
        yield client


class RefusedError(Exception):
    """The app answered something other than what the measurement needed."""

    def __init__(self, measured: dict[str, Any]) -> None:
        super().__init__(measured["error"])
        self.measured = measured


async def timed(
    clock: Clock, request: Awaitable[httpx.Response], *, expect: int = 200
) -> dict[str, Any]:
    """One request, timed, with every statement it sent counted. The request
    is created by the caller and sent only here."""
    clock.reset()
    started = time.perf_counter()
    response = await request
    seconds = time.perf_counter() - started
    clock.on = False
    if response.status_code != expect:
        raise RefusedError(
            {
                "status": response.status_code,
                "error": response.text[:300],
                "seconds": round(seconds, 4),
                "statements": clock.count,
                "slowest_statement_s": round(clock.slowest, 4),
                "slowest_sql": clock.slowest_sql,
            }
        )
    return {
        "seconds": round(seconds, 4),
        "statements": clock.count,
        "slowest_statement_s": round(clock.slowest, 4),
        "slowest_sql": clock.slowest_sql,
        "reply_bytes": len(response.content),
        "body": response.json(),
    }


def strip(measured: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in measured.items() if key != "body"}


async def measure_size(
    maker: async_sessionmaker[AsyncSession],
    clock: Clock,
    shop: Shop,
    size: int,
    log: Log,
) -> dict[str, Any]:
    result: dict[str, Any] = {"allocations": size, "approvals": [], "pages": {}}
    for run in range(1, RUNS + 1):
        location = await fresh_warehouse(maker, shop, f"Склад {size}/{run}")
        started = time.perf_counter()
        snapshot_id, slowest_add = await build_list(maker, shop, size=size, location=location)
        log(
            f"  run {run}: built {size} lines in {time.perf_counter() - started:.1f} s "
            f"(slowest part added through the service {slowest_add:.2f} s)"
        )
        base = f"/api/v1/snapshots/{snapshot_id}"
        async with app_client(maker, shop) as client:
            if run == 1:
                pages = result["pages"]
                pages["GET /snapshots/{id}"] = strip(await timed(clock, client.get(base)))
                pages["GET lines, last page"] = strip(
                    await timed(
                        clock,
                        client.get(f"{base}/lines", params={"limit": 50, "offset": size - 50}),
                    )
                )
                extra = a_file(size // MAX_PART_LINES + 1, size + 1, MAX_PART_LINES)
                added = await timed(
                    clock,
                    client.post(
                        f"{base}/parts",
                        json={
                            "command_id": str(uuid.uuid4()),
                            "file": extra.model_dump(mode="json", by_alias=True, exclude_none=True),
                            "file_name": "ще-один.json",
                        },
                    ),
                    expect=201,
                )
                part_id = added["body"]["part"]["part_id"]
                result["add_part"] = strip(added)
                pages["GET parts"] = strip(await timed(clock, client.get(f"{base}/parts")))
                result["remove_part"] = strip(
                    await timed(clock, client.post(f"{base}/parts/{part_id}/remove", json={}))
                )
            view = await client.get(base)
            revision = view.json()["review_revision"]
            assert view.json()["ready_to_approve"], view.text
            try:
                approved = await timed(
                    clock,
                    client.post(f"{base}/approve", json={"expected_review_revision": revision}),
                )
            except RefusedError as refused:
                # A refusal is no time at all: the size fails, and every
                # further run would only build the same list to watch it fail.
                result["approvals"].append(refused.measured)
                result["refused"] = refused.measured
                log(
                    f"  run {run}: approve REFUSED after {refused.measured['seconds']:.2f} s, "
                    f"{refused.measured['statements']} statements: "
                    f"HTTP {refused.measured['status']} {refused.measured['error']}"
                )
                log("  not repeated: the refusal does not depend on the run")
                break
            assert approved["body"]["application"] == {"units": size, "allocations": size}
            result["approvals"].append(strip(approved))
            log(
                f"  run {run}: approve {approved['seconds']:.2f} s, "
                f"{approved['statements']} statements, "
                f"slowest {approved['slowest_statement_s']:.3f} s, "
                f"reply {approved['reply_bytes']} bytes"
            )
            if run == 1:
                result["pages"]["GET application, first 500"] = strip(
                    await timed(clock, client.get(f"{base}/application", params={"limit": 500}))
                )
    slowest = max(item["seconds"] for item in result["approvals"])
    slowest_statement = max(item["slowest_statement_s"] for item in result["approvals"])
    result["slowest_approval_s"] = slowest
    result["slowest_statement_s"] = slowest_statement
    result["approval_passes"] = (
        "refused" not in result
        and slowest <= APPROVAL_BUDGET_S
        and slowest_statement <= STATEMENT_BUDGET_S
    )
    result["add_part_passes"] = result["add_part"]["seconds"] <= ADD_PART_BUDGET_S
    result["pages_pass"] = all(
        page["seconds"] <= PAGE_BUDGET_S for page in result["pages"].values()
    )
    return result


async def main() -> None:
    url = os.environ["BIRKA_PERF_DATABASE_URL"]
    settings = Settings(app_env="local", database_url=url)
    engine = create_engine(settings)
    async with engine.connect() as connection:
        database = await connection.scalar(text("SELECT current_database()"))
    if database not in ALLOWED_DATABASES:
        raise SystemExit(
            f"Refusing to measure in {database!r}: expected one of {sorted(ALLOWED_DATABASES)}"
        )
    today = datetime.now(tz=UTC).date().isoformat()
    out = Path(
        os.environ.get(
            "BIRKA_PERF_OUTPUT",
            BACKEND.parent / "output" / "verification" / f"{today}-json-import-approval",
        )
    )
    out.mkdir(parents=True, exist_ok=True)
    log = Log(out / "run.txt")

    for name, value in RUN_CAPS.items():
        setattr(snapshots, name, value)
    log(f"measure_opening_approval, {datetime.now(tz=UTC).isoformat(timespec='seconds')}")
    for line in describe_machine():
        log(line)
    migrate(url)
    for line in await describe_postgres(engine):
        log(line)
    log(
        f"app: environment {settings.app_env}, statement_timeout "
        f"{settings.db_statement_timeout_seconds:g} s, in process (httpx.ASGITransport)"
    )
    log("caps raised for the run: " + ", ".join(f"{k} {v}" for k, v in RUN_CAPS.items()))
    log(
        f"rule: approval <= {APPROVAL_BUDGET_S:g} s and no statement > {STATEMENT_BUDGET_S:g} s; "
        f"adding a part <= {ADD_PART_BUDGET_S:g} s; a page <= {PAGE_BUDGET_S:g} s"
    )
    clock = Clock()
    clock.attach(engine)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    log("seeding …")
    shop = await seed(maker)
    log(
        f"seeded {len(shop.keys)} stock keys "
        f"({len(shop.keys) // len(SIZE_CODES)} models × {len(SIZE_CODES)} sizes)"
    )

    results = []
    for size in SIZES:
        log()
        log(f"{size} allocations, {RUNS} runs")
        results.append(await measure_size(maker, clock, shop, size, log))
        result = results[-1]
        log(
            f"  {size}: {'refused, ' if 'refused' in result else ''}"
            f"slowest approval {result['slowest_approval_s']:.2f} s, slowest statement "
            f"{result['slowest_statement_s']:.3f} s -> "
            f"{'PASS' if result['approval_passes'] else 'FAIL'}; "
            f"adding a 1 000-line file {result['add_part']['seconds']:.2f} s, "
            f"removing it {result['remove_part']['seconds']:.2f} s; pages "
            + ", ".join(f"{k} {v['seconds']:.3f} s" for k, v in result["pages"].items())
        )
    passing = [r["allocations"] for r in results if r["approval_passes"]]
    chosen = max(passing) if passing else None
    log()
    log(
        f"largest size that passes: {chosen}"
        if chosen
        else "no size passes: the opening path needs batching"
    )
    summary = {
        "measured_at": datetime.now(tz=UTC).isoformat(timespec="seconds"),
        "database": database,
        "caps_for_the_run": RUN_CAPS,
        "rule": {
            "approval_s": APPROVAL_BUDGET_S,
            "statement_s": STATEMENT_BUDGET_S,
            "add_part_s": ADD_PART_BUDGET_S,
            "page_s": PAGE_BUDGET_S,
        },
        "results": results,
        "largest_passing": chosen,
    }
    (out / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    await engine.dispose()
    if chosen is None:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
