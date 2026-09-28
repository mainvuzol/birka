"""Migration `0015` reshapes the snapshot tables and refuses rather than guess.

Every database here is created and dropped by the test; `BIRKA_TEST_DATABASE_URL`
is only read for its connection details (see `test_stock_rekey_migration.py`,
whose helpers this reuses). The rows are written in raw SQL on purpose: the ORM
describes the schema *after* `0015`, and a fixture that could only exist after
the migration would prove nothing about what the migration has to carry.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from tests.conftest import requires_database
from tests.integration.test_stock_rekey_migration import _admin, _alembic, _engine, _run

pytestmark = [pytest.mark.integration, requires_database()]

BEFORE = "0014_alias_feedback_identity"
SNAPSHOTS = "0015_snapshot_import"


@pytest.fixture
async def scratch() -> AsyncIterator[str]:
    name = f"birka_snapshots_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    try:
        yield name
    finally:
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def _sql(database: str, *statements: tuple[str, dict]) -> list:
    engine = await _engine(database)
    results = []
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as s:
            for statement, parameters in statements:
                result = await s.execute(text(statement), parameters)
                results.append(result.scalar_one_or_none() if result.returns_rows else None)
            await s.commit()
    finally:
        await engine.dispose()
    return results


async def _version(database: str) -> str:
    return (await _sql(database, ("SELECT version_num FROM alembic_version", {})))[0]


async def seed_list_at_0014(
    database: str, *, resolved: bool = False, quantity_total: int | None = 2
) -> dict[str, uuid.UUID]:
    """An organization with a warehouse, a product and a one-line stock list,
    in `0002`'s shape: the line waiting, or — `resolved` — carrying the kind
    of single resolution no code before M1-023 ever wrote. `quantity_total`
    is the line's stated count; `None` beside `KNOWN` is a shape only a hand
    could write."""
    ids = {name: uuid.uuid4() for name in ("org", "store", "location", "concept", "family")}
    ids |= {name: uuid.uuid4() for name in ("variant", "system", "size", "raw", "snapshot")}
    await _sql(
        database,
        (
            "INSERT INTO organization (id, name, currency_code, created_at) "
            "VALUES (:org, 'org', 'UAH', now())",
            ids,
        ),
        (
            "INSERT INTO store (id, organization_id, name, code, kind, timezone, is_active, "
            "created_at) VALUES (:store, :org, 'Main', 'MAIN', 'PRIMARY', 'Europe/Kyiv', true, "
            "now())",
            ids,
        ),
        (
            "INSERT INTO stock_location (id, organization_id, code, name, is_active, created_at) "
            "VALUES (:location, :org, 'WH', 'Склад', true, now())",
            ids,
        ),
        (
            "INSERT INTO canonical_concept (id, organization_id, name, normalized_name, "
            "created_at) VALUES (:concept, :org, 'Лоран', 'лоран', now())",
            ids,
        ),
        (
            "INSERT INTO product_family (id, organization_id, canonical_concept_id, status, "
            "created_at) VALUES (:family, :org, :concept, 'ACTIVE', now())",
            ids,
        ),
        (
            "INSERT INTO product_variant (id, product_family_id, attributes, status, created_at) "
            "VALUES (:variant, :family, '{}', 'ACTIVE', now())",
            ids,
        ),
        (
            "INSERT INTO size_system (id, organization_id, code, name, created_at) "
            "VALUES (:system, :org, 'ALPHA', 'Alpha', now())",
            ids,
        ),
        (
            "INSERT INTO size (id, size_system_id, code, sort_order, is_unknown, created_at) "
            "VALUES (:size, :system, 'M', 0, false, now())",
            ids,
        ),
        (
            "INSERT INTO raw_input (id, organization_id, store_id, source_kind, raw_text, "
            "content_hash, created_at) VALUES (:raw, :org, :store, 'SNAPSHOT_IMPORT', "
            "'Лоран М 2 шт', 'hash', now())",
            ids,
        ),
        (
            "INSERT INTO inventory_snapshot (id, organization_id, location_id, status, "
            "created_at) VALUES (:snapshot, :org, :location, 'IN_REVIEW', now())",
            ids,
        ),
        (
            "INSERT INTO inventory_snapshot_row (id, inventory_snapshot_id, line_no, "
            "raw_input_id, quantity_total, quantity_state, resolved_variant_id, "
            "resolved_size_id, status, created_at) VALUES (gen_random_uuid(), :snapshot, 1, "
            ":raw, :total, 'KNOWN', :resolved_variant, :resolved_size, :status, now())",
            {
                **ids,
                "total": quantity_total,
                "resolved_variant": ids["variant"] if resolved else None,
                "resolved_size": ids["size"] if resolved else None,
                "status": "RESOLVED" if resolved else "PENDING",
            },
        ),
    )
    return ids


async def test_0015_round_trips_while_nothing_is_decided(scratch: str):
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    ids = await seed_list_at_0014(scratch)

    await _run(config, "upgrade", SNAPSHOTS, database=scratch)
    row = (
        await _sql(
            scratch,
            (
                "SELECT row(status, quantity_total, quantity_state, quantity_basis, "
                "raw_input_id)::text FROM inventory_snapshot_row",
                {},
            ),
        )
    )[0]
    assert row == f"(PENDING,2,KNOWN,,{ids['raw']})"
    # The line waits and can be reviewed; the list itself predates an acting
    # store, which a person has to supply by importing it again. Its own id
    # becomes its command id, so the unique name holds from the start.
    assert (await _sql(scratch, ("SELECT acting_store_id FROM inventory_snapshot", {})))[0] is None
    assert (await _sql(scratch, ("SELECT command_id FROM inventory_snapshot", {})))[0] == ids[
        "snapshot"
    ]

    await _run(config, "downgrade", BEFORE, database=scratch)
    assert await _version(scratch) == BEFORE
    assert (
        await _sql(
            scratch,
            ("SELECT count(*) FROM inventory_snapshot_row WHERE resolved_variant_id IS NULL", {}),
        )
    )[0] == 1

    await _run(config, "upgrade", SNAPSHOTS, database=scratch)
    assert await _version(scratch) == SNAPSHOTS


async def test_0015_refuses_to_downgrade_over_a_decision(scratch: str):
    """A person's answer cannot go back into `0002`'s single-resolution shape."""
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    await seed_list_at_0014(scratch)
    await _run(config, "upgrade", SNAPSHOTS, database=scratch)
    await _sql(
        scratch,
        (
            "UPDATE inventory_snapshot_row SET status = 'SKIPPED', "
            "resolution_note = 'заголовок', resolved_at = now()",
            {},
        ),
    )

    with pytest.raises(Exception, match="Cannot downgrade 0015_snapshot_import"):
        await _run(config, "downgrade", BEFORE, database=scratch)

    assert await _version(scratch) == SNAPSHOTS
    assert (await _sql(scratch, ("SELECT status::text FROM inventory_snapshot_row", {})))[
        0
    ] == "SKIPPED"


async def test_0015_refuses_to_upgrade_over_a_decision_it_did_not_make(scratch: str):
    """No code before M1-023 resolved a line. One that is resolved came from
    somewhere else, and needs a person, not a guessed allocation."""
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    await seed_list_at_0014(scratch, resolved=True)

    with pytest.raises(Exception, match="already carries a decision"):
        await _run(config, "upgrade", SNAPSHOTS, database=scratch)
    assert await _version(scratch) == BEFORE


async def test_0015_refuses_to_upgrade_over_an_opening_lot_that_names_no_list(scratch: str):
    """Before M1-023 a receipt could label its lot OPENING_BALANCE. Such a lot
    cannot be traced to any list, so it is refused by name, never relabelled."""
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    ids = await seed_list_at_0014(scratch)
    await _sql(
        scratch,
        (
            "INSERT INTO stock_lot (id, organization_id, location_id, product_variant_id, "
            "size_id, acquisition_type, created_at) VALUES (gen_random_uuid(), :org, :location, "
            ":variant, :size, 'OPENING_BALANCE', now())",
            ids,
        ),
    )

    with pytest.raises(Exception, match="without the stock list they came from"):
        await _run(config, "upgrade", SNAPSHOTS, database=scratch)
    assert await _version(scratch) == BEFORE


async def test_0015_refuses_to_upgrade_over_a_line_its_checks_cannot_hold(scratch: str):
    """A waiting line in a shape no code wrote — a known count without its
    total — is refused by name, not by a raw constraint error (the code
    review's eighth finding)."""
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    await seed_list_at_0014(scratch, quantity_total=None)

    with pytest.raises(Exception, match="that no code before M1-023 wrote"):
        await _run(config, "upgrade", SNAPSHOTS, database=scratch)
    assert await _version(scratch) == BEFORE
