"""Migration 0032, in a database of the test's own (ADR-0009 §4)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from tests.conftest import requires_database
from tests.integration.test_stock_rekey_migration import _admin, _alembic, _engine, _run

pytestmark = [pytest.mark.integration, requires_database()]

BEFORE = "0031_catalog_correction"
SPELLING = "0032_size_spelling"


@pytest.fixture
async def scratch() -> AsyncIterator[str]:
    name = f"birka_sizes_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    try:
        yield name
    finally:
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def _rows(database: str, statement: str, **parameters) -> list:
    engine = await _engine(database)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            result = await session.execute(text(statement), parameters)
            rows = list(result.all()) if result.returns_rows else []
            await session.commit()
            return rows
    finally:
        await engine.dispose()


async def _shape(database: str) -> dict:
    [(version, column, trigger, function, index)] = await _rows(
        database,
        "SELECT (SELECT version_num FROM alembic_version),"
        " EXISTS (SELECT 1 FROM information_schema.columns"
        "   WHERE table_name = 'size' AND column_name = 'organization_id'),"
        " EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'size_organization'),"
        " EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'birka_size_organization'),"
        " (SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_size_org_spelling')",
    )
    return {
        "version": version,
        "column": column,
        "trigger": trigger,
        "function": function,
        "index": index,
    }


# Refused or gone back, nothing of `0032` is left.
AT_BEFORE = {
    "version": BEFORE,
    "column": False,
    "trigger": False,
    "function": False,
    "index": None,
}

AT_SPELLING = {
    "version": SPELLING,
    "column": True,
    "trigger": True,
    "function": True,
    "index": "CREATE UNIQUE INDEX uq_size_org_spelling ON public.size USING btree "
    "(organization_id, lower((code)::text)) WHERE (NOT is_unknown)",
}


async def _organization(database: str) -> dict[str, uuid.UUID]:
    """An organization with its three size systems, in raw SQL valid at `0031`:
    the ORM describes the schema after `0032`."""
    ids = {name: uuid.uuid4() for name in ("org", "ALPHA", "NUMERIC_EU", "UNSPECIFIED")}
    await _rows(
        database,
        "INSERT INTO organization (id, name, currency_code) VALUES (:org, :name, 'UAH')",
        org=ids["org"],
        name=f"org-{ids['org'].hex[:8]}",
    )
    for system in ("ALPHA", "NUMERIC_EU", "UNSPECIFIED"):
        await _rows(
            database,
            "INSERT INTO size_system (id, organization_id, code, name)"
            " VALUES (:id, :org, CAST(:code AS size_system_code), :name)",
            id=ids[system],
            org=ids["org"],
            code=system,
            name=system,
        )
    return ids


async def _size(
    database: str, ids: dict, system: str, code: str, *, unknown: bool = False
) -> uuid.UUID:
    size = uuid.uuid4()
    await _rows(
        database,
        "INSERT INTO size (id, size_system_id, code, is_unknown)"
        " VALUES (:id, :system, :code, :unknown)",
        id=size,
        system=ids[system],
        code=code,
        unknown=unknown,
    )
    return size


async def test_0032_goes_up_down_and_up_again_on_an_empty_database(scratch):
    """Down, it drops the index, the trigger, its function and the column; up
    again, it creates them anew."""
    config = _alembic(scratch)
    await _run(config, "upgrade", SPELLING, database=scratch)
    assert await _shape(scratch) == AT_SPELLING

    await _run(config, "downgrade", BEFORE, database=scratch)
    assert await _shape(scratch) == AT_BEFORE

    await _run(config, "upgrade", SPELLING, database=scratch)
    assert await _shape(scratch) == AT_SPELLING


async def test_0032_respells_every_ordinary_size_and_fills_its_organization(scratch):
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    ids = await _organization(scratch)
    typed = {
        ("ALPHA", "2xl"): "XXL",
        ("ALPHA", "хл"): "XL",
        ("ALPHA", "m"): "M",
        ("ALPHA", "S"): "S",
        ("NUMERIC_EU", "46 – 48"): "46-48",
        ("NUMERIC_EU", "46/48"): "46/48",
        ("UNSPECIFIED", "Єдиний"): "Єдиний",
        ("UNSPECIFIED", "one size"): "ONE SIZE",
    }
    sizes = {
        await _size(scratch, ids, system, code): spelt for (system, code), spelt in typed.items()
    }
    unknown = await _size(scratch, ids, "UNSPECIFIED", "UNKNOWN", unknown=True)

    await _run(config, "upgrade", SPELLING, database=scratch)

    rows = await _rows(scratch, "SELECT id, code, organization_id FROM size")
    assert {row.id: row.code for row in rows} == sizes | {unknown: "UNKNOWN"}
    assert {row.organization_id for row in rows} == {ids["org"]}


async def test_0032_does_not_go_up_over_two_sizes_that_are_now_one(scratch):
    """Joining two sizes would move stock between their balances, which no
    rule decides: the upgrade stops and names them. Refused, nothing is
    respelt."""
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    ids = await _organization(scratch)
    await _size(scratch, ids, "ALPHA", "M")
    await _size(scratch, ids, "UNSPECIFIED", "м")
    await _size(scratch, ids, "ALPHA", "2xl")
    await _size(scratch, ids, "ALPHA", "XXL")
    await _size(scratch, ids, "ALPHA", "l")
    # A Cyrillic word keeps its letters, but its case does not matter.
    await _size(scratch, ids, "UNSPECIFIED", "Єдиний")
    await _size(scratch, ids, "NUMERIC_EU", "єдиний")

    with pytest.raises(RuntimeError) as refused:
        await _run(config, "upgrade", SPELLING, database=scratch)
    message = str(refused.value)
    assert message.startswith("Cannot upgrade: these sizes cannot take their one spelling")
    assert "«M» (ALPHA), «м» (UNSPECIFIED)" in message
    assert "«2xl» (ALPHA), «XXL» (ALPHA)" in message
    assert "«Єдиний» (UNSPECIFIED), «єдиний» (NUMERIC_EU)" in message
    assert "«l»" not in message

    assert await _shape(scratch) == AT_BEFORE
    codes = await _rows(scratch, "SELECT code FROM size ORDER BY code")
    assert sorted(row.code for row in codes) == sorted(
        ["M", "м", "2xl", "XXL", "l", "Єдиний", "єдиний"]
    )


async def test_0032_does_not_go_up_over_a_spelling_too_long_for_its_column(scratch):
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    ids = await _organization(scratch)
    await _size(scratch, ids, "ALPHA", "9XL-9XL")
    await _size(scratch, ids, "ALPHA", "999999999999999999XL")

    with pytest.raises(RuntimeError) as refused:
        await _run(config, "upgrade", SPELLING, database=scratch)
    message = str(refused.value)
    assert "«9XL-9XL» (ALPHA) is longer than 20 characters written out" in message
    assert "«999999999999999999XL» (ALPHA) is longer than 20 characters" in message
    assert await _shape(scratch) == AT_BEFORE


async def test_0032_keeps_two_organizations_sizes_apart(scratch):
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    first, second = await _organization(scratch), await _organization(scratch)
    await _size(scratch, first, "ALPHA", "M")
    await _size(scratch, second, "UNSPECIFIED", "m")

    await _run(config, "upgrade", SPELLING, database=scratch)

    rows = await _rows(scratch, "SELECT organization_id, code FROM size ORDER BY code")
    assert {(row.organization_id, row.code) for row in rows} == {
        (first["org"], "M"),
        (second["org"], "M"),
    }


async def test_0032_gives_a_size_its_systems_organization_and_keeps_it(scratch):
    """The trigger as `0032` installs it: a size takes its size system's
    organization, never another, and never moves."""
    config = _alembic(scratch)
    await _run(config, "upgrade", SPELLING, database=scratch)
    first, second = await _organization(scratch), await _organization(scratch)
    size = await _size(scratch, first, "ALPHA", "M")
    [(organization,)] = await _rows(
        scratch, "SELECT organization_id FROM size WHERE id = :id", id=size
    )
    assert organization == first["org"]

    with pytest.raises(Exception, match="organization of its size system"):
        await _rows(
            scratch,
            "INSERT INTO size (id, size_system_id, organization_id, code)"
            " VALUES (:id, :system, :org, 'L')",
            id=uuid.uuid4(),
            system=first["ALPHA"],
            org=second["org"],
        )
    with pytest.raises(Exception, match="never moves"):
        await _rows(
            scratch,
            "UPDATE size SET size_system_id = :system WHERE id = :id",
            system=second["ALPHA"],
            id=size,
        )
    await _rows(scratch, "UPDATE size SET code = 'm' WHERE id = :id", id=size)
    with pytest.raises(Exception, match="uq_size_org_spelling"):
        await _size(scratch, first, "UNSPECIFIED", "M")


async def test_0032_does_not_go_up_over_a_size_that_would_be_unknown(scratch):
    """`UNKNOWN` is the "size not known" only a legacy stock list states,
    reserved in every system. Before `0032` it was reserved only under «Інша»
    and only as typed, so `unknown` under «Літерна» or a full-width
    `ＵＮＫＮＯＷＮ` could exist; respelt, either would be `UNKNOWN`."""
    config = _alembic(scratch)
    await _run(config, "upgrade", BEFORE, database=scratch)
    ids = await _organization(scratch)
    await _size(scratch, ids, "UNSPECIFIED", "UNKNOWN", unknown=True)
    await _size(scratch, ids, "ALPHA", "unknown")
    await _size(scratch, ids, "UNSPECIFIED", "\uff35\uff2e\uff2b\uff2e\uff2f\uff37\uff2e")

    with pytest.raises(RuntimeError) as refused:
        await _run(config, "upgrade", SPELLING, database=scratch)
    message = str(refused.value)
    assert "«unknown» (ALPHA) would be written UNKNOWN" in message
    assert (
        "«\uff35\uff2e\uff2b\uff2e\uff2f\uff37\uff2e» (UNSPECIFIED) would be written UNKNOWN"
        in message
    )
    assert await _shape(scratch) == AT_BEFORE
