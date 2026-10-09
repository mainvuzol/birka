"""Migration `0037` gives every list its first part, and goes back only when nothing is lost.

ADR-0014 §17. Every database here is created and dropped by the test;
`BIRKA_TEST_DATABASE_URL` is only read for its connection details (see
`test_stock_rekey_migration.py`, whose helpers this reuses). Lists are made
through the API at the head revision and taken down to `0036`, where they
are exactly what `0036` keeps: a list `0037` meets in a shop is one of those.
A state no code could write is planted in SQL, with the triggers that would
refuse it switched off for that one transaction.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from tests.conftest import provision_location, requires_database
from tests.integration.test_snapshot_import import (
    LIST,
    World,
    allocation,
    answer_list,
    approve,
    client_for,
    create_product,
    import_body,
    imported,
    resolve,
    seed_world,
)
from tests.integration.test_stock_rekey_migration import _admin, _alembic, _engine, _run

pytestmark = [pytest.mark.integration, requires_database()]

BEFORE = "0036_outage_mark"
PARTS = "0037_stock_list_parts"


@pytest.fixture
async def scratch() -> AsyncIterator[str]:
    name = f"birka_parts_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    try:
        yield name
    finally:
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@asynccontextmanager
async def world_in(database: str) -> AsyncIterator[World]:
    """The world of `test_snapshot_import.py`, in this database, at head."""
    engine: AsyncEngine = await _engine(database)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        seeded = await seed_world(maker)
        async with client_for(maker, seeded["users"]["owner"]) as client:
            coat, sizes = await create_product(
                client, seeded["main"], "Лоран", "шоколад", ["S", "M", "L"]
            )
            bomber, _ = await create_product(client, seeded["main"], "Мышка", "чорний", ["M"])
            bottega, _ = await create_product(client, seeded["main"], "Ботега", "бежевий", ["M"])
        yield World(
            engine=engine,
            maker=maker,
            coat=coat,
            bomber=bomber,
            bottega=bottega,
            sizes=sizes,
            **seeded,
        )
    finally:
        await engine.dispose()


async def rows_of(database: str, statement: str, **parameters: Any) -> list[tuple]:
    engine = await _engine(database)
    try:
        async with engine.connect() as connection:
            result = await connection.execute(text(statement), parameters)
            return [tuple(row) for row in result.all()]
    finally:
        await engine.dispose()


async def run(database: str, *statements: str, **parameters: Any) -> None:
    """Statements in one transaction, committed."""
    engine = await _engine(database)
    try:
        async with engine.begin() as connection:
            for statement in statements:
                await connection.execute(text(statement), parameters)
    finally:
        await engine.dispose()


async def version(database: str) -> str:
    [(found,)] = await rows_of(database, "SELECT version_num FROM alembic_version")
    return str(found)


async def warehouse_of_its_own(w: World) -> uuid.UUID:
    """An empty warehouse the main store receives into, for a list to open."""
    async with w.maker.begin() as session:
        return await provision_location(
            session, organization_id=w.org, store_id=w.main, name="Новий склад"
        )


async def lists_in_every_state(w: World) -> dict[str, str]:
    """Waiting and unanswered, waiting and answered, applied, rejected: every
    one a list of one part, typed by hand, as every list before 0037 is."""
    lists = {}
    async with w.client() as client:
        lists["waiting"] = (await imported(client, w))["snapshot_id"]
        answered = await imported(client, w)
        await answer_list(client, w, answered["snapshot_id"])
        lists["answered"] = answered["snapshot_id"]
        fresh = await warehouse_of_its_own(w)
        applied = await imported(client, w, location=fresh)
        view = await answer_list(client, w, applied["snapshot_id"])
        response = await approve(client, applied["snapshot_id"], view["review_revision"])
        assert response.status_code == 200, response.text
        lists["applied"] = applied["snapshot_id"]
        rejected = await imported(client, w)
        response = await client.post(
            f"/api/v1/snapshots/{rejected['snapshot_id']}/reject", json={"reason": "дубль"}
        )
        assert response.status_code == 200, response.text
        lists["rejected"] = rejected["snapshot_id"]
    return lists


LISTS = (
    "SELECT id, command_id, command_fingerprint, status, created_by_user_id, created_at "
    "FROM inventory_snapshot ORDER BY id"
)
ROWS = (
    "SELECT id, inventory_snapshot_id, line_no, raw_input_id, status, quantity_basis, "
    "resolution_note, quantity_total, quantity_state FROM inventory_snapshot_row ORDER BY id"
)
ALLOCATIONS = (
    "SELECT id, snapshot_row_id, product_variant_id, size_id, quantity, stock_lot_id "
    "FROM inventory_snapshot_allocation ORDER BY id"
)
PARTS_BY_LIST = (
    "SELECT inventory_snapshot_id, part_no, command_id, command_fingerprint, "
    "content_fingerprint, kind::text, line_count, first_line_no, last_line_no, "
    "added_by_user_id, created_at, removed_at, removed_by_user_id, file_name, source "
    "FROM inventory_snapshot_part ORDER BY inventory_snapshot_id, part_no"
)


async def test_the_migration_gives_every_list_its_first_part(scratch):
    config = _alembic(scratch)
    await _run(config, "upgrade", "head", database=scratch)
    async with world_in(scratch) as w:
        lists = await lists_in_every_state(w)
        async with w.client() as client:
            # Imported before the migration, with no proof of its request: a
            # list a downgrade of 0015 brought back has none.
            lists["unproven"] = (await imported(client, w))["snapshot_id"]

        await _run(config, "downgrade", BEFORE, database=scratch)
        assert await rows_of(scratch, "SELECT to_regclass('inventory_snapshot_part')") == [(None,)]
        await run(
            scratch,
            "UPDATE inventory_snapshot SET command_fingerprint = NULL WHERE id = :id",
            id=uuid.UUID(lists["unproven"]),
        )
        before_lists = await rows_of(scratch, LISTS)
        before_rows = await rows_of(scratch, ROWS)
        before_allocations = await rows_of(scratch, ALLOCATIONS)
        await _run(config, "upgrade", "head", database=scratch)

        assert await version(scratch) == PARTS
        # The schema changed under the world's pooled connections.
        await w.engine.dispose()
        assert await rows_of(scratch, LISTS) == before_lists
        assert await rows_of(scratch, ALLOCATIONS) == before_allocations
        assert await rows_of(scratch, ROWS) == before_rows
        parts = await rows_of(scratch, PARTS_BY_LIST)
        assert len(parts) == len(before_lists) == 5
        lines = {}
        for list_id, *_ in before_lists:
            lines[list_id] = sorted(row[2] for row in before_rows if row[1] == list_id)
        for part, listed in zip(parts, before_lists, strict=True):
            list_id, command_id, fingerprint, _, creator, created_at = listed
            assert part == (
                list_id,
                1,
                command_id,
                fingerprint,
                None,
                "PASTED",
                len(lines[list_id]),
                1,
                len(lines[list_id]),
                creator,
                created_at,
                None,
                None,
                None,
                None,
            )
        unproven = {row[0]: row[2] for row in before_lists}[uuid.UUID(lists["unproven"])]
        assert unproven is None
        # Every row names its list's one part.
        assert await rows_of(
            scratch,
            "SELECT count(*) FROM inventory_snapshot_row r JOIN inventory_snapshot_part p "
            "ON p.id = r.part_id AND p.inventory_snapshot_id = r.inventory_snapshot_id",
        ) == [(len(before_rows),)]

        # 0015's trigger is on again, and the new ones are there.
        assert await rows_of(
            scratch,
            "SELECT tgenabled::text FROM pg_trigger "
            "WHERE tgname = 'inventory_snapshot_row_is_final'",
        ) == [("O",)]
        assert {
            name
            for (name,) in await rows_of(
                scratch, "SELECT tgname FROM pg_trigger WHERE tgname LIKE 'inventory_snapshot%'"
            )
        } >= {
            "inventory_snapshot_part_is_final",
            "inventory_snapshot_row_is_fixed",
            "inventory_snapshot_allocation_row_is_live",
            "inventory_snapshot_part_removed_whole",
        }
        for decided in ("applied", "rejected"):
            with pytest.raises(DBAPIError, match="can no longer change"):
                await run(
                    scratch,
                    "UPDATE inventory_snapshot_row SET resolution_note = 'x' "
                    "WHERE inventory_snapshot_id = :id",
                    id=uuid.UUID(lists[decided]),
                )

        # The lists go on: an import's retry still replays, one without proof
        # is a conflict, and a waiting list takes a second part after its lines.
        async with w.client() as client:
            command = next(row[1] for row in before_lists if str(row[0]) == lists["waiting"])
            replay = await client.post(
                "/api/v1/snapshots", json=import_body(w, LIST, command_id=command)
            )
            unproven_command = next(
                row[1] for row in before_lists if str(row[0]) == lists["unproven"]
            )
            conflict = await client.post(
                "/api/v1/snapshots", json=import_body(w, LIST, command_id=unproven_command)
            )
            part = await client.post(
                f"/api/v1/snapshots/{lists['waiting']}/parts",
                json={"command_id": str(uuid.uuid4()), "lines": ["Шуба орех 70 см"]},
            )
            approved = await approve(client, lists["answered"], 3)
    assert replay.status_code == 200, replay.text
    assert replay.json()["snapshot_id"] == lists["waiting"]
    assert (conflict.status_code, conflict.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    assert part.status_code == 201, part.text
    assert (part.json()["part"]["part_no"], part.json()["part"]["first_line_no"]) == (2, 4)
    assert approved.status_code == 200, approved.text


async def test_the_migration_refuses_a_list_it_cannot_make_one_part(scratch):
    config = _alembic(scratch)
    await _run(config, "upgrade", "head", database=scratch)
    async with world_in(scratch) as w:
        async with w.client() as client:
            waiting = (await imported(client, w))["snapshot_id"]
    await _run(config, "downgrade", BEFORE, database=scratch)
    listed = uuid.UUID(waiting)

    async def refused(message: str, culprit: uuid.UUID) -> None:
        with pytest.raises(DBAPIError, match=message) as raised:
            await _run(config, "upgrade", "head", database=scratch)
        assert str(culprit) in str(raised.value)
        assert await version(scratch) == BEFORE
        assert await rows_of(scratch, "SELECT to_regclass('inventory_snapshot_part')") == [(None,)]

    # A gap in its line numbers.
    await run(
        scratch,
        "UPDATE inventory_snapshot_row SET line_no = 7 WHERE inventory_snapshot_id = :id "
        "AND line_no = 3",
        id=listed,
    )
    await refused("are not numbered 1 to n", listed)
    await run(
        scratch,
        "UPDATE inventory_snapshot_row SET line_no = 3 WHERE inventory_snapshot_id = :id "
        "AND line_no = 7",
        id=listed,
    )

    # A list with no line at all.
    empty = uuid.uuid4()
    await run(
        scratch,
        "INSERT INTO inventory_snapshot (id, organization_id, command_id, status) "
        "VALUES (:id, :org, gen_random_uuid(), 'IN_REVIEW')",
        id=empty,
        org=w.org,
    )
    await refused("has no lines", empty)
    await run(scratch, "DELETE FROM inventory_snapshot WHERE id = :id", id=empty)

    # More lines than one part holds.
    await run(
        scratch,
        "INSERT INTO raw_input (id, organization_id, store_id, source_kind, source_ref, "
        "raw_text, content_hash) SELECT gen_random_uuid(), :org, :store, 'SNAPSHOT_IMPORT', "
        "'planted:' || n, 'Куртка ' || n, md5(n::text) FROM generate_series(1, 998) n",
        "INSERT INTO inventory_snapshot_row (id, inventory_snapshot_id, line_no, raw_input_id, "
        "quantity_state, status) SELECT gen_random_uuid(), :id, "
        "3 + row_number() OVER (ORDER BY source_ref), id, 'UNKNOWN_QUANTITY', 'PENDING' "
        "FROM raw_input WHERE source_ref LIKE 'planted:%'",
        org=w.org,
        store=w.main,
        id=listed,
    )
    assert await rows_of(
        scratch,
        "SELECT count(*) FROM inventory_snapshot_row WHERE inventory_snapshot_id = :id",
        id=listed,
    ) == [(1001,)]
    await refused("or are more than 1 000", listed)
    await run(
        scratch,
        "DELETE FROM inventory_snapshot_row WHERE inventory_snapshot_id = :id AND line_no > 3",
        id=listed,
    )

    await _run(config, "upgrade", "head", database=scratch)
    assert await version(scratch) == PARTS


# Each state 0036 cannot hold, planted on a list of one part, typed by hand.
# `{part}` and `{row}` name its part and its first line.
OFF = "ALTER TABLE inventory_snapshot_row DISABLE TRIGGER inventory_snapshot_row_is_fixed"
ON = "ALTER TABLE inventory_snapshot_row ENABLE TRIGGER inventory_snapshot_row_is_fixed"
PLANTED: list[tuple[str, str, list[str], list[str]]] = [
    (
        "a file",
        "holds a file",
        [
            "ALTER TABLE inventory_snapshot_part DISABLE TRIGGER USER",
            "UPDATE inventory_snapshot_part SET kind = 'FILE', file_name = 'x.json', "
            "format_version = 1, content_fingerprint = repeat('0', 64) WHERE id = :part",
            "ALTER TABLE inventory_snapshot_part ENABLE TRIGGER USER",
        ],
        [
            "ALTER TABLE inventory_snapshot_part DISABLE TRIGGER USER",
            "UPDATE inventory_snapshot_part SET kind = 'PASTED', file_name = NULL, "
            "format_version = NULL, content_fingerprint = NULL WHERE id = :part",
            "ALTER TABLE inventory_snapshot_part ENABLE TRIGGER USER",
        ],
    ),
    (
        "a second part",
        "has more than one part",
        [
            "INSERT INTO inventory_snapshot_part (id, organization_id, inventory_snapshot_id, "
            "part_no, command_id, kind, line_count, first_line_no, last_line_no) "
            "SELECT gen_random_uuid(), organization_id, inventory_snapshot_id, 2, "
            "gen_random_uuid(), 'PASTED', 1, 9, 9 FROM inventory_snapshot_part WHERE id = :part",
        ],
        [
            "ALTER TABLE inventory_snapshot_part DISABLE TRIGGER USER",
            "DELETE FROM inventory_snapshot_part WHERE part_no = 2",
            "ALTER TABLE inventory_snapshot_part ENABLE TRIGGER USER",
        ],
    ),
    (
        "a removed part",
        "was removed",
        [
            "ALTER TABLE inventory_snapshot_part DISABLE TRIGGER USER",
            "UPDATE inventory_snapshot_part SET removed_at = now(), "
            "removed_by_user_id = added_by_user_id WHERE id = :part",
            "ALTER TABLE inventory_snapshot_part ENABLE TRIGGER USER",
        ],
        [
            "ALTER TABLE inventory_snapshot_part DISABLE TRIGGER USER",
            "UPDATE inventory_snapshot_part SET removed_at = NULL, removed_by_user_id = NULL "
            "WHERE id = :part",
            "ALTER TABLE inventory_snapshot_part ENABLE TRIGGER USER",
        ],
    ),
    (
        "a removed line",
        "line is removed",
        [OFF, "UPDATE inventory_snapshot_row SET status = 'REMOVED' WHERE id = :row", ON],
        [OFF, "UPDATE inventory_snapshot_row SET status = 'NEEDS_REVIEW' WHERE id = :row", ON],
    ),
    *[
        (
            f"a line's {column}",
            "keeps a photo, a reading or a split",
            # Constants of this module, not input.
            [OFF, f"UPDATE inventory_snapshot_row SET {change} WHERE id = :row", ON],  # noqa: S608
            [OFF, f"UPDATE inventory_snapshot_row SET {undo} WHERE id = :row", ON],  # noqa: S608
        )
        for column, change, undo in (
            (
                "photo",
                "photo_name = 'IMG_1.jpg', photo_line = 1",
                "photo_name = NULL, photo_line = NULL",
            ),
            ("reading", "reading = '{}'::jsonb", "reading = NULL"),
            ("shown split", "shown_split = '[]'::jsonb", "shown_split = NULL"),
            (
                "file reasons",
                "file_reasons = ARRAY['FILE_NOTE']::varchar[]",
                "file_reasons = '{}'",
            ),
        )
    ],
    (
        "what a person said of a split",
        "said a record of its split means",
        [
            "UPDATE inventory_snapshot_row SET quantity_basis = 'STATED_BY_SIZE', "
            "split_read_as = 'SIZE_WITH_COUNT', split_read_records = '[]'::jsonb "
            "WHERE id = :answered"
        ],
        [
            "UPDATE inventory_snapshot_row SET quantity_basis = 'STATED', "
            "split_read_as = NULL, split_read_records = NULL WHERE id = :answered"
        ],
    ),
    (
        "an answer by size",
        "by size, a basis 0036 does not know",
        [
            "UPDATE inventory_snapshot_row SET quantity_basis = 'STATED_BY_SIZE' "
            "WHERE id = :answered"
        ],
        ["UPDATE inventory_snapshot_row SET quantity_basis = 'STATED' WHERE id = :answered"],
    ),
]


async def test_the_downgrade_refuses_what_0036_cannot_hold(scratch):
    config = _alembic(scratch)
    await _run(config, "upgrade", "head", database=scratch)
    async with world_in(scratch) as w:
        async with w.client() as client:
            view = await imported(client, w)
            answered = await resolve(
                client,
                view["snapshot_id"],
                2,
                allocations=[allocation(w.bomber, w.sizes["M"], 2)],
                quantity_basis="STATED",
            )
            assert answered.status_code == 200, answered.text
        listed = uuid.UUID(view["snapshot_id"])
        [(part,)] = await rows_of(
            scratch,
            "SELECT id FROM inventory_snapshot_part WHERE inventory_snapshot_id = :id",
            id=listed,
        )
        [(row,), (answered_row,)] = await rows_of(
            scratch,
            "SELECT id FROM inventory_snapshot_row WHERE inventory_snapshot_id = :id "
            "AND line_no IN (1, 2) ORDER BY line_no",
            id=listed,
        )
        state = await rows_of(scratch, ROWS)
        where = {"part": part, "row": row, "answered": answered_row}

        for what, message, plant, undo in PLANTED:
            await run(
                scratch, *plant, **{k: v for k, v in where.items() if f":{k}" in " ".join(plant)}
            )
            with pytest.raises(DBAPIError, match=message):
                await _run(config, "downgrade", BEFORE, database=scratch)
            assert await version(scratch) == PARTS, what
            await run(
                scratch, *undo, **{k: v for k, v in where.items() if f":{k}" in " ".join(undo)}
            )
            assert await rows_of(scratch, ROWS) == state, what

        # And as the API makes them: a list from a file.
        async with w.client() as client:
            from_file = await client.post(
                "/api/v1/snapshots",
                json={
                    **import_body(w, LIST),
                    "lines": None,
                    "file": {
                        "format": "birka.stock-list",
                        "version": 1,
                        "lines": [{"text": "Лоран M-1", "photo": "IMG_1.jpg", "photo_line": 1}],
                    },
                    "file_name": "зошит.json",
                },
            )
            assert from_file.status_code == 201, from_file.text
    with pytest.raises(DBAPIError, match="holds a file"):
        await _run(config, "downgrade", BEFORE, database=scratch)
    assert await version(scratch) == PARTS


async def test_a_list_of_one_pasted_part_goes_down_and_comes_back_the_same(scratch):
    config = _alembic(scratch)
    await _run(config, "upgrade", "head", database=scratch)
    async with world_in(scratch) as w:
        lists = await lists_in_every_state(w)
        before = {
            query: await rows_of(scratch, query)
            for query in (LISTS, ROWS, ALLOCATIONS, PARTS_BY_LIST)
        }
        holds = await rows_of(scratch, "SELECT snapshot_id FROM opening_list_hold ORDER BY 1")

        await _run(config, "downgrade", BEFORE, database=scratch)
        assert await version(scratch) == BEFORE
        await _run(config, "upgrade", "head", database=scratch)
        # The schema changed under the world's pooled connections.
        await w.engine.dispose()

        for query, rows in before.items():
            assert await rows_of(scratch, query) == rows, query
        assert (
            await rows_of(scratch, "SELECT snapshot_id FROM opening_list_hold ORDER BY 1") == holds
        )
        assert len(before[PARTS_BY_LIST]) == 4
        # The lists answer as they did: the import's retry replays, and the
        # one answered is approved at the revision it was answered at.
        async with w.client() as client:
            command = next(row[1] for row in before[LISTS] if str(row[0]) == lists["waiting"])
            replay = await client.post(
                "/api/v1/snapshots", json=import_body(w, LIST, command_id=command)
            )
            approved = await approve(client, lists["answered"], 3)
    assert replay.status_code == 200, replay.text
    assert approved.status_code == 200, approved.text
