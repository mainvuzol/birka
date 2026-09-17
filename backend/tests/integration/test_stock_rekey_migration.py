"""Migration `0006` moves the stock key and must lose nothing doing it.

This is the evidence behind the claim in ADR-0004 §5 that the re-key is a
*relabelling, not a reorganisation*. It runs the real migration against a real
database carrying real synthetic business data — sales, refunds, receipts,
corrections and a deliberately injected ledger divergence — and compares the
world before and after.

Each test names the specific property it proves. The two that matter most:

* nothing is merged — one location per store, and every quantity intact;
* the ledger's append-only trigger is suspended for the backfill and put back,
  because that suspension is the one moment invariants I10/I11 are relaxed.

Every database here is created and dropped by the test. `BIRKA_TEST_DATABASE_URL`
is only read for its connection details; that database is never modified.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from tests.conftest import requires_database

pytestmark = [pytest.mark.integration, requires_database()]

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REKEY = "0006_stock_rekey"
BEFORE = "0005_stock_locations"


def _url_for(database: str) -> str:
    """Swap the database name, leaving everything else exactly as configured.

    A plain string edit rather than `urlparse`/`urlunparse`: a Unix-socket URL
    carries its socket directory in the query string, and round-tripping it
    through urlunparse quietly drops it — the connection then falls back to
    TCP on localhost and fails somewhere far from here.
    """
    url = os.environ["BIRKA_TEST_DATABASE_URL"]
    head, separator, query = url.partition("?")
    base, _, _old = head.rpartition("/")
    return f"{base}/{database}{separator}{query}"


async def _run(config: Config, action: str, revision: str, *, database: str) -> None:
    """Run alembic against `database`, off the test's event loop.

    Two things need care. `migrations/env.py` calls `asyncio.run` itself, which
    cannot nest inside a running loop, so the command goes to a worker thread.
    And env.py deliberately resolves the URL from settings rather than from the
    alembic config, so pointing it at a scratch database means setting
    `BIRKA_DATABASE_URL` for the duration — restored afterwards, because a test
    that leaks an environment variable breaks whichever test runs next.
    """
    previous = os.environ.get("BIRKA_DATABASE_URL")
    os.environ["BIRKA_DATABASE_URL"] = _url_for(database)
    # `get_settings` is an `lru_cache(maxsize=1)` singleton, so without this
    # every migration after the first one silently runs against the first
    # scratch database — which by then has been dropped.
    get_settings.cache_clear()
    try:
        await asyncio.to_thread(getattr(command, action), config, revision)
    finally:
        if previous is None:
            os.environ.pop("BIRKA_DATABASE_URL", None)
        else:
            os.environ["BIRKA_DATABASE_URL"] = previous
        get_settings.cache_clear()


def _alembic(database: str) -> Config:
    config = Config(os.path.join(BACKEND_ROOT, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_ROOT, "migrations"))
    config.set_main_option("sqlalchemy.url", _url_for(database))
    return config


@pytest.fixture
async def scratch() -> AsyncIterator[str]:
    """A disposable database of this test's own, dropped afterwards."""
    name = f"birka_rekey_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    try:
        yield name
    finally:
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def _admin(statement: str) -> None:
    """`CREATE`/`DROP DATABASE`, on a connection of its own.

    Raw asyncpg rather than SQLAlchemy: these statements cannot run inside a
    transaction block, and a pooled SQLAlchemy connection may already have
    autobegun one by the time the isolation level is set.
    """
    url = os.environ["BIRKA_TEST_DATABASE_URL"]
    head, _, query = url.partition("?")
    parameters = dict(pair.split("=", 1) for pair in query.split("&") if "=" in pair)
    credentials = head.rpartition("/")[0].rpartition("//")[2]
    user = credentials.partition("@")[0].partition(":")[0] or "postgres"
    connection = await asyncpg.connect(host=parameters.get("host"), user=user, database="postgres")
    try:
        await connection.execute(statement)
    finally:
        await connection.close()


async def _engine(database: str) -> AsyncEngine:
    return create_async_engine(_url_for(database))


async def seed_store_keyed_business(database: str) -> dict[str, object]:
    """Write the kind of rows `0005` leaves behind: everything keyed by store.

    Raw SQL on purpose. The ORM now describes the *post*-migration schema, so
    building this fixture through it would be impossible — and a fixture that
    could only exist after the migration would prove nothing about the data
    the migration has to carry across.
    """
    engine = await _engine(database)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        org = (
            await s.execute(
                text(
                    "INSERT INTO organization (id, name, currency_code, created_at) "
                    "VALUES (gen_random_uuid(), 'org', 'UAH', now()) RETURNING id"
                )
            )
        ).scalar_one()
        stores = []
        for code in ("MAIN", "CHILD"):
            stores.append(
                (
                    await s.execute(
                        text(
                            "INSERT INTO store (id, organization_id, name, code, kind, "
                            "timezone, is_active, created_at) VALUES (gen_random_uuid(), :o, "
                            ":c, :c, 'PRIMARY', 'Europe/Kyiv', true, now()) RETURNING id"
                        ),
                        {"o": org, "c": code},
                    )
                ).scalar_one()
            )
        concept = (
            await s.execute(
                text(
                    "INSERT INTO canonical_concept (id, organization_id, name, normalized_name, "
                    "created_at) VALUES (gen_random_uuid(), :o, 'Лоран', 'лоран', now()) "
                    "RETURNING id"
                ),
                {"o": org},
            )
        ).scalar_one()
        family = (
            await s.execute(
                text(
                    "INSERT INTO product_family (id, organization_id, canonical_concept_id, "
                    "status, created_at) VALUES (gen_random_uuid(), :o, :c, 'ACTIVE', now()) "
                    "RETURNING id"
                ),
                {"o": org, "c": concept},
            )
        ).scalar_one()
        variant = (
            await s.execute(
                text(
                    "INSERT INTO product_variant (id, product_family_id, attributes, "
                    "status, created_at) VALUES (gen_random_uuid(), :f, '{}'::jsonb, "
                    "'ACTIVE', now()) RETURNING id"
                ),
                {"f": family},
            )
        ).scalar_one()
        system = (
            await s.execute(
                text(
                    "INSERT INTO size_system (id, organization_id, code, name, created_at) "
                    "VALUES (gen_random_uuid(), :o, 'ALPHA', 'Alpha', now()) RETURNING id"
                ),
                {"o": org},
            )
        ).scalar_one()
        size = (
            await s.execute(
                text(
                    "INSERT INTO size (id, size_system_id, code, sort_order, is_unknown, "
                    "created_at) VALUES (gen_random_uuid(), :y, 'M', 1, false, now()) RETURNING id"
                ),
                {"y": system},
            )
        ).scalar_one()
        user = (
            await s.execute(
                text(
                    "INSERT INTO app_user (id, telegram_user_id, display_name, is_active, "
                    "created_at) VALUES (gen_random_uuid(), :t, 'Оля', true, now()) RETURNING id"
                ),
                {"t": int(uuid.uuid4().int % 10_000_000)},
            )
        ).scalar_one()

        # Balances, a ledger that agrees with them, a sale and a refund —
        # each store keyed the old way.
        for store, quantity in zip(stores, (7, 3), strict=True):
            await s.execute(
                text(
                    "INSERT INTO inventory (id, store_id, product_variant_id, size_id, "
                    "quantity, updated_at) VALUES (gen_random_uuid(), :s, :v, :z, :q, now())"
                ),
                {"s": store, "v": variant, "z": size, "q": quantity},
            )
            await s.execute(
                text(
                    "INSERT INTO stock_movement (id, organization_id, store_id, "
                    "product_variant_id, size_id, movement_type, quantity_delta, created_at) "
                    "VALUES (gen_random_uuid(), :o, :s, :v, :z, 'DELIVERY', :q, now())"
                ),
                {"o": org, "s": store, "v": variant, "z": size, "q": quantity},
            )
            await s.execute(
                text(
                    "INSERT INTO stock_lot (id, organization_id, store_id, product_variant_id, "
                    "size_id, acquisition_type, created_at) VALUES (gen_random_uuid(), :o, :s, "
                    ":v, :z, 'PURCHASE', now())"
                ),
                {"o": org, "s": store, "v": variant, "z": size},
            )

        sale = (
            await s.execute(
                text(
                    "INSERT INTO sale (id, organization_id, store_id, seller_user_id, "
                    "command_id, status, currency_code, subtotal, discount_total, total, "
                    "sold_at, created_at) VALUES (gen_random_uuid(), :o, :s, :u, "
                    "gen_random_uuid(), 'COMPLETED', 'UAH', 100, 0, 100, now(), now()) "
                    "RETURNING id"
                ),
                {"o": org, "s": stores[0], "u": user},
            )
        ).scalar_one()
        sale_item = (
            await s.execute(
                text(
                    "INSERT INTO sale_item (id, sale_id, product_variant_id, size_id, quantity, "
                    "unit_price, discount_amount, final_unit_price, line_total, currency_code, "
                    "display_name_snapshot, variant_snapshot) VALUES (gen_random_uuid(), :sale, "
                    ":v, :z, 1, 100, 0, 100, 100, 'UAH', 'Лоран', '{}'::jsonb) RETURNING id"
                ),
                {"sale": sale, "v": variant, "z": size},
            )
        ).scalar_one()
        refund = (
            await s.execute(
                text(
                    "INSERT INTO refund (id, organization_id, store_id, sale_id, actor_user_id, "
                    "command_id, command_fingerprint, total_amount, currency_code, created_at) "
                    "VALUES (gen_random_uuid(), :o, :s, :sale, :u, gen_random_uuid(), 'abc', "
                    "100, 'UAH', now()) RETURNING id"
                ),
                {"o": org, "s": stores[0], "sale": sale, "u": user},
            )
        ).scalar_one()
        # One restocked line and one written off, so the CHECK that ties the
        # destination to `restock` is exercised in both directions.
        for restock in (True, False):
            await s.execute(
                text(
                    "INSERT INTO refund_item (id, refund_id, sale_item_id, quantity, amount, "
                    "restock) VALUES (gen_random_uuid(), :r, :si, 1, 50, :restock)"
                ),
                {"r": refund, "si": sale_item, "restock": restock},
            )

        # A divergence that already exists must survive the migration visibly.
        await s.execute(
            text("UPDATE inventory SET quantity = quantity + 4 WHERE store_id = :s"),
            {"s": stores[1]},
        )
        await s.commit()
    await engine.dispose()
    return {"org": org, "stores": stores, "variant": variant, "size": size, "sale": sale}


async def snapshot(database: str) -> dict[str, object]:
    engine = await _engine(database)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:

        async def one(sql: str) -> object:
            return (await s.execute(text(sql))).scalar_one()

        async def rows(sql: str) -> list[tuple]:
            return [tuple(r) for r in (await s.execute(text(sql))).all()]

        result = {
            "inventory_total": await one("SELECT COALESCE(SUM(quantity), 0) FROM inventory"),
            "inventory_rows": await one("SELECT count(*) FROM inventory"),
            "movement_rows": await one("SELECT count(*) FROM stock_movement"),
            "ledger_total": await one(
                "SELECT COALESCE(SUM(quantity_delta), 0) FROM stock_movement"
            ),
            "lot_rows": await one("SELECT count(*) FROM stock_lot"),
            "sale_rows": await one("SELECT count(*) FROM sale"),
            "sale_item_rows": await one("SELECT count(*) FROM sale_item"),
            "refund_rows": await one("SELECT count(*) FROM refund"),
            "refund_item_rows": await one("SELECT count(*) FROM refund_item"),
            "sale_money": await rows(
                "SELECT subtotal, discount_total, total, currency_code FROM sale ORDER BY id"
            ),
            "sale_item_money": await rows(
                "SELECT quantity, unit_price, discount_amount, final_unit_price, line_total "
                "FROM sale_item ORDER BY id"
            ),
            "refund_money": await rows(
                "SELECT total_amount, currency_code FROM refund ORDER BY id"
            ),
            "per_variant": await rows(
                "SELECT product_variant_id, size_id, SUM(quantity) FROM inventory "
                "GROUP BY product_variant_id, size_id ORDER BY 1, 2"
            ),
            "trigger": await one(
                "SELECT tgenabled FROM pg_trigger WHERE tgname = 'stock_movement_is_append_only'"
            ),
        }
    await engine.dispose()
    return result


async def test_the_rekey_preserves_quantities_history_money_and_links(scratch: str):
    """The headline property: a relabelling, not a reorganisation."""
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    seeded = await seed_store_keyed_business(scratch)
    before = await snapshot(scratch)

    await _run(config, "upgrade", REKEY, database=scratch)
    after = await snapshot(scratch)

    assert after == before, "the re-key changed data it was only supposed to relabel"

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        # One location per store, one store per location: nothing merged.
        assert (await s.execute(text("SELECT count(*) FROM stock_location"))).scalar_one() == 2
        assert (
            await s.execute(
                text(
                    "SELECT count(*) FROM (SELECT location_id FROM store_location_access "
                    "GROUP BY location_id HAVING count(*) > 1) x"
                )
            )
        ).scalar_one() == 0
        # The two stores' balances stayed apart — 7 and 7 (3 + the injected 4).
        balances = sorted(
            r[0] for r in (await s.execute(text("SELECT quantity FROM inventory"))).all()
        )
        assert balances == [7, 7]
        # Every row carries its warehouse, and the ledger its acting store.
        for table in ("inventory", "stock_lot", "stock_movement"):
            assert (
                await s.execute(text(f"SELECT count(*) FROM {table} WHERE location_id IS NULL"))  # noqa: S608
            ).scalar_one() == 0
        assert (
            await s.execute(
                text("SELECT count(*) FROM stock_movement WHERE acting_store_id IS NULL")
            )
        ).scalar_one() == 0
        # The sale line remembers where the goods left from…
        assert (
            await s.execute(text("SELECT count(*) FROM sale_item WHERE source_location_id IS NULL"))
        ).scalar_one() == 0
        # …and the refund destination exists exactly where goods came back.
        assert (
            await s.execute(
                text(
                    "SELECT count(*) FROM refund_item "
                    "WHERE (restock IS TRUE) <> (destination_location_id IS NOT NULL)"
                )
            )
        ).scalar_one() == 0
        # The sale's own store attribution is untouched.
        assert (
            await s.execute(text("SELECT store_id FROM sale WHERE id = :i"), {"i": seeded["sale"]})
        ).scalar_one() == seeded["stores"][0]
    await engine.dispose()


async def test_the_preexisting_divergence_survives_visibly(scratch: str):
    """A ledger that already disagreed with the balance must still disagree.

    Tidying it away during a migration would hide a real data problem behind a
    schema change — which is why the migration asserts the divergence set is
    *identical*, not *empty*.
    """
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    await seed_store_keyed_business(scratch)
    await _run(config, "upgrade", REKEY, database=scratch)

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        divergences = (
            await s.execute(
                text(
                    "SELECT COALESCE(i.quantity, 0) - COALESCE(m.d, 0) FROM inventory i "
                    "FULL OUTER JOIN (SELECT location_id, product_variant_id, size_id, "
                    "SUM(quantity_delta) AS d FROM stock_movement "
                    "GROUP BY location_id, product_variant_id, size_id) m "
                    "ON m.location_id = i.location_id "
                    "AND m.product_variant_id = i.product_variant_id "
                    "AND m.size_id = i.size_id "
                    "WHERE COALESCE(i.quantity, 0) <> COALESCE(m.d, 0)"
                )
            )
        ).all()
        assert [r[0] for r in divergences] == [4], divergences
    await engine.dispose()


async def test_the_append_only_ledger_is_protected_again_afterwards(scratch: str):
    """The backfill suspends invariants I10/I11 for one statement. If the
    trigger were not restored, the ledger would be silently editable forever."""
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    await seed_store_keyed_business(scratch)
    await _run(config, "upgrade", REKEY, database=scratch)

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        assert (
            await s.execute(
                text(
                    "SELECT tgenabled FROM pg_trigger "
                    "WHERE tgname = 'stock_movement_is_append_only'"
                )
            )
        ).scalar_one() in ("O", b"O")
        with pytest.raises(Exception, match="append-only"):
            await s.execute(text("UPDATE stock_movement SET quantity_delta = 99"))
        await s.rollback()
    await engine.dispose()


async def test_the_rekey_round_trips_while_the_mapping_stays_one_to_one(scratch: str):
    """Rollback has explicit, safe bounds — and inside them it is lossless."""
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    await seed_store_keyed_business(scratch)
    before = await snapshot(scratch)

    await _run(config, "upgrade", REKEY, database=scratch)
    await _run(config, "downgrade", BEFORE, database=scratch)
    assert await snapshot(scratch) == before, "downgrade lost or changed data"

    await _run(config, "upgrade", REKEY, database=scratch)
    assert await snapshot(scratch) == before, "re-upgrade lost or changed data"


async def test_downgrade_refuses_once_a_warehouse_is_genuinely_shared(scratch: str):
    """The bound on that rollback, stated as behaviour rather than a comment.

    Once a second store can sell from one warehouse, that warehouse's rows
    belong to no single store, and a downgrade cannot attribute them back. It
    must refuse rather than guess — this is the window ADR-0004 §5 describes,
    and the moment it closes.
    """
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    seeded = await seed_store_keyed_business(scratch)
    await _run(config, "upgrade", REKEY, database=scratch)

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        shared = (
            await s.execute(
                text("SELECT location_id FROM store_location_access WHERE store_id = :s"),
                {"s": seeded["stores"][0]},
            )
        ).scalar_one()
        await s.execute(
            text(
                "INSERT INTO store_location_access (id, organization_id, store_id, location_id, "
                "can_sell, can_receive, created_at) VALUES (gen_random_uuid(), :o, :s, :l, "
                "true, false, now())"
            ),
            {"o": seeded["org"], "s": seeded["stores"][1], "l": shared},
        )
        await s.commit()
    await engine.dispose()

    with pytest.raises(Exception, match="shared by several stores"):
        await _run(config, "downgrade", BEFORE, database=scratch)

    # Refused, and nothing half-undone: the schema is still at the re-key.
    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        assert (
            await s.execute(text("SELECT version_num FROM alembic_version"))
        ).scalar_one() == REKEY
        assert (
            await s.execute(text("SELECT count(*) FROM inventory WHERE location_id IS NULL"))
        ).scalar_one() == 0
    await engine.dispose()


async def test_the_rekey_refuses_to_run_when_a_warehouse_already_exists(scratch: str):
    """Preflight: the migration owns the foundation tables while it runs.

    It treats `store_location_access` as *the* store<->location mapping for
    every backfill, which only holds because it wrote every row in it. A
    warehouse provisioned by hand between `0005` and here would silently join
    that mapping, so it is refused — and refused with the real reason, not with
    a downstream count mismatch that reads as "balances were merged".
    """
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    seeded = await seed_store_keyed_business(scratch)

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        await s.execute(
            text(
                "INSERT INTO stock_location (id, organization_id, code, name, is_active, "
                "created_at) VALUES (gen_random_uuid(), :o, 'W-EARLY', 'Заздалегідь', true, now())"
            ),
            {"o": seeded["org"]},
        )
        await s.commit()
    await engine.dispose()

    with pytest.raises(Exception, match="stock_location must be empty"):
        await _run(config, "upgrade", REKEY, database=scratch)

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        assert (
            await s.execute(text("SELECT version_num FROM alembic_version"))
        ).scalar_one() == BEFORE
        # Nothing invented on the way to the refusal.
        assert (
            await s.execute(text("SELECT count(*) FROM store_location_access"))
        ).scalar_one() == 0
    await engine.dispose()


async def test_migrated_warehouses_are_open_even_when_their_store_is_closed(scratch: str):
    """A place does not close because a shop does.

    Copying `store.is_active` onto the warehouse would invent a rule nobody
    stated — and would take the *shared* warehouse away from every other store
    the moment its original owner was blocked.
    """
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    seeded = await seed_store_keyed_business(scratch)

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        await s.execute(
            text("UPDATE store SET is_active = false WHERE id = :s"), {"s": seeded["stores"][0]}
        )
        await s.commit()
    await engine.dispose()

    await _run(config, "upgrade", REKEY, database=scratch)

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        states = (await s.execute(text("SELECT code, is_active FROM stock_location"))).all()
        assert dict(states) == {"MAIN": True, "CHILD": True}
        # The store's own state is untouched: the two facts stay separate.
        assert (
            await s.execute(
                text("SELECT is_active FROM store WHERE id = :s"), {"s": seeded["stores"][0]}
            )
        ).scalar_one() is False
    await engine.dispose()


async def test_a_renamed_warehouse_still_downgrades_and_upgrades_again(scratch: str):
    """Rollback must not depend on a warehouse still being called what the
    migration called it.

    Renaming is the first thing anyone does to a warehouse. A cleanup that
    matched rows by code would leave the renamed one behind, stranding an
    access grant that then makes the next upgrade refuse — a database stuck
    between two revisions with no way forward or back.
    """
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    await seed_store_keyed_business(scratch)
    before = await snapshot(scratch)
    await _run(config, "upgrade", REKEY, database=scratch)

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        await s.execute(
            text(
                "UPDATE stock_location SET code = 'W-' || code || '-RENAMED', "
                "name = 'Перейменований ' || name"
            )
        )
        await s.commit()
    await engine.dispose()

    await _run(config, "downgrade", BEFORE, database=scratch)
    assert await snapshot(scratch) == before

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        assert (await s.execute(text("SELECT count(*) FROM stock_location"))).scalar_one() == 0
        assert (
            await s.execute(text("SELECT count(*) FROM store_location_access"))
        ).scalar_one() == 0
    await engine.dispose()

    # And forward again, which is what the leftovers used to make impossible.
    await _run(config, "upgrade", REKEY, database=scratch)
    assert await snapshot(scratch) == before


async def test_downgrade_refuses_a_store_that_gained_a_second_warehouse(scratch: str):
    """The other half of the rollback bound, and the one M1-018 will cross.

    One store, two warehouses: `store_id` cannot hold both, so restoring it
    would collide on the old unique key — an integrity error thrown in the
    middle of destructive DDL. Refuse first, in the open, with a reason.
    """
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    seeded = await seed_store_keyed_business(scratch)
    await _run(config, "upgrade", REKEY, database=scratch)

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        extra = (
            await s.execute(
                text(
                    "INSERT INTO stock_location (id, organization_id, code, name, is_active, "
                    "created_at) VALUES (gen_random_uuid(), :o, 'W-EXTRA', 'Ще один', true, now()) "
                    "RETURNING id"
                ),
                {"o": seeded["org"]},
            )
        ).scalar_one()
        await s.execute(
            text(
                "INSERT INTO store_location_access (id, organization_id, store_id, location_id, "
                "can_sell, can_receive, created_at) VALUES (gen_random_uuid(), :o, :s, :l, "
                "true, true, now())"
            ),
            {"o": seeded["org"], "s": seeded["stores"][0], "l": extra},
        )
        await s.commit()
    await engine.dispose()

    with pytest.raises(Exception, match="reaches several locations"):
        await _run(config, "downgrade", BEFORE, database=scratch)

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        assert (
            await s.execute(text("SELECT version_num FROM alembic_version"))
        ).scalar_one() == REKEY
        assert (await s.execute(text("SELECT count(*) FROM stock_location"))).scalar_one() == 3
    await engine.dispose()


async def test_downgrade_refuses_a_warehouse_no_store_reaches(scratch: str):
    """A provisioned warehouse with no access row is not ours to delete.

    Rolling back would have to either destroy it or leave it behind to block
    the next upgrade. Both are worse than stopping and saying so.
    """
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    seeded = await seed_store_keyed_business(scratch)
    await _run(config, "upgrade", REKEY, database=scratch)

    engine = await _engine(scratch)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        await s.execute(
            text(
                "INSERT INTO stock_location (id, organization_id, code, name, is_active, "
                "created_at) VALUES (gen_random_uuid(), :o, 'W-LONELY', 'Нічий', true, now())"
            ),
            {"o": seeded["org"]},
        )
        await s.commit()
    await engine.dispose()

    with pytest.raises(Exception, match="no store reaches"):
        await _run(config, "downgrade", BEFORE, database=scratch)
