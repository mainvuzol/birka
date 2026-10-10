"""Measure the two server-side budgets the release gate names (M1-028).

The plan sets `/catalog/search` p95 ≤ 300 ms and `POST /sales` p95 ≤ 500 ms and
says, in the same sentence, that they are **to be measured, not assumed**. They
never were. Two changes since then put work on that path and neither was
measured either: M1-029 added a warehouse-access join to every stock command,
and M1-023 added a shared advisory lock per warehouse to all of them.

What this measures is the server's own work — request in, receipt out — against
a real PostgreSQL over loopback. What it cannot tell you is what a seller feels
in a shop: no phone, no mobile network, no Telegram webview, no production
hardware. Treat a pass as "nothing here is an order of magnitude wrong" and a
failure as real.

A sale paid in parts is measured too, alone and by six sellers at once. PR #54
put it on `POST /sales`: a debt, its first payment and an audit row written in
the sale's own transaction. No reading had measured it. Its two cases run
after the first six, so those six still measure what they always have.

Every sale says how it was paid, as the till's buttons now send it (owner
decisions, 2026-10-04; ADR-0012): cash, the way the drawer counts. A sale
without one is refused, and «cash and card» puts its own work on the path —
the drawer's period stamped on every sale under its store's row — which is
what a reading after it measures.

The run prints how it ran before any figure: the gate, the CPUs, Python, the
PostgreSQL server and the API's environment. The evidence file then says what
made it.

Run it against a disposable database only; it writes thousands of sales.
The API it measures is started with the per-person limit raised,
`BIRKA_REQUESTS_PER_MINUTE_PER_PERSON=100000` and
`BIRKA_REQUEST_BURST_PER_PERSON=100000`, as CI's hot-path job does: each
seller here asks hundreds of times in seconds, and a server keeps 300 a
minute (ADR-0020), so the run would stop at a 429 `TOO_MANY_REQUESTS`. The
limit is still taken on every request, so its cost is in the figures.

    BIRKA_PERF_DATABASE_URL=postgresql+asyncpg://…/birka_perf \
    BIRKA_PERF_API_URL=http://127.0.0.1:58043 \
    BIRKA_TELEGRAM_BOT_TOKEN=<the API's own> \
    BIRKA_PERF_GATE=all \
    python -m scripts.measure_hot_path
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import itertools
import json
import os
import platform
import statistics
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from urllib.parse import urlencode

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models_registry  # noqa: F401  - every table on the metadata, like migrations/env.py
from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.authz.permissions import Permission
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
from app.modules.identity.models import AppUser
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import MovementRequest, apply_movements
from app.modules.tenancy.models import (
    Organization,
    StockLocation,
    Store,
    StoreKind,
    StoreLocationAccess,
)

# The same fence `evaluate_catalog` uses, for the same reason: this seeds and
# then sells thousands of times, and must never meet a real database.
ALLOWED_DATABASES = frozenset({"birka_perf"})

RequestBuilder = Callable[[httpx.AsyncClient, int], Awaitable[httpx.Response]]
# Name, request, how many, sellers at once.
Case = tuple[str, RequestBuilder, int, int]

# Two shops of women's outerwear. Deliberately generous: a few hundred models
# in a handful of colours each, six sizes, which is well past what the owner
# actually carries. A budget that holds here holds in the shop.
VARIANTS = 400
SIZES = ("XS", "S", "M", "L", "XL", "XXL")
STOCK_PER_KEY = 200

BUDGETS_MS = {"GET /catalog/stock-options": 300.0, "POST /sales": 500.0}

# Every sale is of coats at this price; a sale paid in parts pays a third of
# one now and owes the rest: above nothing and below the total, as the owner
# set it (owner decision, 2026-10-01, "paying in parts").
UNIT_PRICE = "1200.00"
PAID_NOW = "400.00"

# Which breaches fail the run. `all`, the default, is the release gate's own
# reading, and gates every case, six sellers at once included (owner decision,
# 2026-10-03, release checklist row 22). CI sets `one-seller`, where a breach
# under concurrency is printed and not fatal. On a shared two-CPU runner the
# harness, the API and the database share the same CPUs. Six sellers asking
# back to back, some hundred times the two shops' rate, put the runner as much
# as the code under test: its first two runs came within 3 % of a budget
# (hot-path-budget-report.md, 2026-10-01). One seller still has ten times
# headroom there.
GATES = ("all", "one-seller")
GATE = os.environ.get("BIRKA_PERF_GATE", "all")


@dataclass(frozen=True, slots=True)
class World:
    telegram_user_id: int
    store_id: uuid.UUID
    location_id: uuid.UUID
    keys: list[tuple[uuid.UUID, uuid.UUID]]


def init_data_for(telegram_user_id: int, bot_token: str) -> str:
    fields = {
        "auth_date": str(int(datetime.now(tz=UTC).timestamp())),
        "query_id": "AAEperf",
        "user": json.dumps({"id": telegram_user_id, "first_name": "Перф"}, separators=(",", ":")),
    }
    check = "\n".join(f"{key}={fields[key]}" for key in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


async def seed(url: str) -> World:
    engine = create_async_engine(url)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker.begin() as session:
        database = await session.scalar(text("SELECT current_database()"))
        if database not in ALLOWED_DATABASES:
            raise ValueError(f"Refusing to seed {database!r}: expected birka_perf")
        org = Organization(name=f"perf-{uuid.uuid4().hex}", currency_code="UAH")
        session.add(org)
        await session.flush()
        store = Store(organization_id=org.id, name="Основний", code="MAIN", kind=StoreKind.PRIMARY)
        location = StockLocation(organization_id=org.id, name="Основний склад", code="PERF")
        system = SizeSystem(organization_id=org.id, code=SizeSystemCode.ALPHA, name="Alpha")
        telegram_user_id = uuid.uuid4().int % 2**52
        user = AppUser(telegram_user_id=telegram_user_id, display_name="Перф")
        session.add_all([store, location, system, user])
        await session.flush()
        sizes = [Size(size_system_id=system.id, code=code) for code in SIZES]
        session.add_all(sizes)
        session.add(
            StoreLocationAccess(
                organization_id=org.id,
                store_id=store.id,
                location_id=location.id,
                can_sell=True,
                can_receive=True,
            )
        )
        role = Role(organization_id=org.id, code="PERF", name="Перф-продавець")
        session.add(role)
        await session.flush()
        session.add_all(
            [RolePermission(role_id=role.id, permission_code=p.value) for p in Permission]
        )
        session.add(
            Membership(user_id=user.id, organization_id=org.id, store_id=store.id, role_id=role.id)
        )
        variants: list[ProductVariant] = []
        for index in range(VARIANTS):
            concept = CanonicalConcept(
                organization_id=org.id, name=f"Модель {index}", normalized_name=f"модель {index}"
            )
            colour = AttributeTerm(
                organization_id=org.id,
                kind=AttributeKind.COLOR,
                name=f"колір {index}",
                normalized_name=f"колір {index}",
            )
            session.add_all([concept, colour])
            await session.flush()
            family = ProductFamily(organization_id=org.id, canonical_concept_id=concept.id)
            session.add(family)
            await session.flush()
            variant = ProductVariant(
                product_family_id=family.id,
                color_term_id=colour.id,
                length_cm=Decimal("70"),
            )
            session.add(variant)
            variants.append(variant)
        await session.flush()
        keys = [(variant.id, size.id) for variant in variants for size in sizes]
        # One ledger write per chunk, so seeding does not dominate the run.
        for start in range(0, len(keys), 500):
            await apply_movements(
                session,
                organization_id=org.id,
                actor_user_id=user.id,
                requests=[
                    MovementRequest(
                        location_id=location.id,
                        acting_store_id=store.id,
                        product_variant_id=variant_id,
                        size_id=size_id,
                        quantity_delta=STOCK_PER_KEY,
                        movement_type=MovementType.DELIVERY,
                    )
                    for variant_id, size_id in keys[start : start + 500]
                ],
            )
        world = World(
            telegram_user_id=telegram_user_id,
            store_id=store.id,
            location_id=location.id,
            keys=keys,
        )
    await engine.dispose()
    return world


def summarise(name: str, concurrency: int, samples: list[float]) -> dict[str, object]:
    ordered = sorted(samples)
    budget = next((ms for key, ms in BUDGETS_MS.items() if name.startswith(key)), None)
    p95 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
    return {
        "case": name,
        "concurrency": concurrency,
        "n": len(ordered),
        "p50": statistics.median(ordered),
        "p95": p95,
        "p99": ordered[min(len(ordered) - 1, int(len(ordered) * 0.99))],
        "max": ordered[-1],
        "budget": budget,
        "verdict": "—" if budget is None else ("pass" if p95 <= budget else "FAIL"),
        "gated": budget is not None and (GATE == "all" or concurrency == 1),
    }


async def token_for(client: httpx.AsyncClient, world: World, bot_token: str) -> str:
    response = await client.post(
        "/api/v1/auth/telegram",
        json={"init_data": init_data_for(world.telegram_user_id, bot_token)},
    )
    response.raise_for_status()
    return str(response.json()["access_token"])


async def postgres_described(url: str) -> str:
    """The server's version, and the two settings that most change what a
    committed sale costs: a run with either off reads far faster than a shop
    would see."""
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            version = await connection.scalar(text("SELECT version()"))
            fsync = await connection.scalar(text("SHOW fsync"))
            synchronous_commit = await connection.scalar(text("SHOW synchronous_commit"))
    finally:
        await engine.dispose()
    return f"{version}; fsync {fsync}, synchronous_commit {synchronous_commit}"


async def api_environment(client: httpx.AsyncClient) -> str:
    """The environment the API under test says it runs as, from the same
    `/api/v1/health` CI and the runbook ask. Asked before seeding, so an API
    that is not up stops the run before it writes anything."""
    response = await client.get("/api/v1/health")
    response.raise_for_status()
    return str(response.json()["environment"])


def customer(number: int) -> dict[str, str]:
    """The `number`th customer of a run who pays in parts.

    Each such sale is a new customer, with a phone of their own. One phone is
    one customer, and one customer may owe on several sales (owner decisions,
    2026-10-01), so one phone for every sale would be accepted. But hundreds of
    debts on one person in an hour is no shop's day. The phone is written the
    way a seller types it, and the server compares its digits."""
    digits = f"{number:07d}"
    return {
        "customer_name": f"Покупниця {number}",
        "customer_phone": f"+38 (067) {digits[:3]}-{digits[3:5]}-{digits[5:]}",
        "paid_now": PAID_NOW,
    }


def cases(world: World, headers: dict[str, str]) -> list[Case]:
    """Every case, in the order it runs.

    The first six are the ones every earlier reading measured, unchanged, so
    their figures still compare with the evidence of 2026-09-29 and
    2026-10-01. The sales paid in parts come after them."""
    # One count across both cases paid in parts, warm-ups included: no
    # customer of a run comes back.
    customers = itertools.count(1)

    def sale(lines: int, *, contended: bool, in_parts: bool = False) -> RequestBuilder:
        def build(client: httpx.AsyncClient, index: int) -> Awaitable[httpx.Response]:
            chosen = [
                world.keys[0 if contended else (index * lines + offset) % len(world.keys)]
                for offset in range(lines)
            ]
            body: dict[str, object] = {
                "store_id": str(world.store_id),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": str(variant_id),
                        "size_id": str(size_id),
                        "source_location_id": str(world.location_id),
                        "quantity": 1,
                        "unit_price": UNIT_PRICE,
                    }
                    # One line per distinct key: a basket may not name the
                    # same key twice.
                    for variant_id, size_id in dict.fromkeys(chosen)
                ],
                # «Готівка»: the button that sells, and the drawer's own way.
                "payment_method": "CASH",
            }
            if in_parts:
                body["credit"] = customer(next(customers))
            return client.post(
                "/api/v1/sales",
                headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
                json=body,
            )

        return build

    def options(client: httpx.AsyncClient, index: int) -> Awaitable[httpx.Response]:
        return client.get(
            "/api/v1/catalog/stock-options",
            headers=headers,
            params={
                "store_id": str(world.store_id),
                "location_id": str(world.location_id),
                "limit": 100,
                "offset": (index % 20) * 100,
            },
        )

    return [
        ("GET /catalog/stock-options", options, 200, 1),
        ("GET /catalog/stock-options (6 sellers)", options, 300, 6),
        ("POST /sales · 1 line", sale(1, contended=False), 200, 1),
        ("POST /sales · 1 line (6 sellers)", sale(1, contended=False), 300, 6),
        ("POST /sales · 4 lines (6 sellers)", sale(4, contended=False), 200, 6),
        ("POST /sales · same coat, 6 sellers", sale(1, contended=True), 120, 6),
        ("POST /sales · paid in parts", sale(1, contended=False, in_parts=True), 200, 1),
        (
            "POST /sales · paid in parts (6 sellers)",
            sale(1, contended=False, in_parts=True),
            300,
            6,
        ),
    ]


async def drive(
    client: httpx.AsyncClient,
    make_request: RequestBuilder,
    *,
    count: int,
    concurrency: int,
) -> list[float]:
    """Run `count` requests at a fixed concurrency, timing each one."""
    samples: list[float] = []
    semaphore = asyncio.Semaphore(concurrency)
    failures: list[str] = []

    async def once(index: int) -> None:
        async with semaphore:
            started = time.perf_counter()
            response = await make_request(client, index)
            elapsed = (time.perf_counter() - started) * 1000
            if response.status_code >= 400:
                failures.append(f"{response.status_code} {response.text[:160]}")
                return
            samples.append(elapsed)

    await asyncio.gather(*(once(index) for index in range(count)))
    if failures:
        raise RuntimeError(f"{len(failures)} request(s) failed, first: {failures[0]}")
    return samples


async def main() -> None:
    url = os.environ["BIRKA_PERF_DATABASE_URL"]
    api = os.environ.get("BIRKA_PERF_API_URL", "http://127.0.0.1:58043")
    # The same token the API under test is configured with; there is no
    # default, because signing with the wrong one fails as an opaque 401. Read
    # here, before anything is seeded, so the module imports without it.
    bot_token = os.environ["BIRKA_TELEGRAM_BOT_TOKEN"]
    if GATE not in GATES:
        raise SystemExit(f"BIRKA_PERF_GATE must be one of {', '.join(GATES)}, not {GATE!r}")
    # The figures mean little without the machine that made them.
    print(f"gate: {GATE}; {os.cpu_count()} CPUs; harness, API and database on one machine")
    print(f"python: {platform.python_version()} ({platform.python_implementation()})")
    print(f"postgresql: {await postgres_described(url)}")
    async with httpx.AsyncClient(base_url=api, timeout=10.0) as probe:
        print(f"api: {api}, environment {await api_environment(probe)}", flush=True)
    print(f"seeding {VARIANTS} variants × {len(SIZES)} sizes …", flush=True)
    world = await seed(url)
    print(f"seeded {len(world.keys)} stock keys", flush=True)

    rows: list[dict[str, object]] = []
    async with httpx.AsyncClient(base_url=api, timeout=60.0) as client:
        token = await token_for(client, world, bot_token)
        headers = {"Authorization": f"Bearer {token}"}
        for name, builder, count, concurrency in cases(world, headers):
            await drive(client, builder, count=20, concurrency=concurrency)  # warm up
            samples = await drive(client, builder, count=count, concurrency=concurrency)
            row = summarise(name, concurrency, samples)
            rows.append(row)
            print(
                f"{row['case']:<40} n={row['n']:<4} "
                f"p50={row['p50']:7.1f}  p95={row['p95']:7.1f}  "
                f"p99={row['p99']:7.1f}  max={row['max']:7.1f}  {row['verdict']}"
                f"{'' if row['gated'] else '  (not gated)'}",
                flush=True,
            )

    print()
    print(json.dumps(rows, indent=2))
    if any(row["verdict"] == "FAIL" and row["gated"] for row in rows):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
