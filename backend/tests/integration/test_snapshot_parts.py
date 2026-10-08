"""A warehouse's opening list filled by parts: a parser's files and hand-typed lines.

ADR-0014, after the owner's decisions of 2026-10-08 ("the shops' existing
stock"). These tests run the workflow over HTTP against real PostgreSQL. Each
name states the property it pins:

- **Parts.** A list is created from lines or from a file, and more files
  and hand-typed lines join it while it is under review, each a part with its
  own command id and its own range of the list's line numbers.
- **Removing.** A file added by mistake is removed, with the answers given to
  its lines; its lines stay as evidence and count nowhere. The last file is
  not removed: the list is rejected instead.
- **The database's guarantees.** What the service does, the triggers of
  `0037` enforce too.
- **Counts.** A parser's count is a hint unless the text states it with its
  unit; a split the text shows is confirmed by a tap (`STATED_BY_SIZE`).
- **Stores.** A list of the shared warehouse belongs to both stores.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.modules.audit.models import AuditLog
from app.modules.authz.service import resolve_scope
from app.modules.catalog.evidence import (
    ProcessingStatus,
    RawInput,
    RawInputProcessing,
    RawInputSource,
)
from app.modules.catalog.models import EntityStatus, ProductVariant
from app.modules.catalog.raw_lines import record_lines
from app.modules.identity.models import AppUser
from app.modules.inventory.models import MovementType, StockLot
from app.modules.snapshots import service as snapshot_service
from app.modules.snapshots.models import (
    InventorySnapshot,
    InventorySnapshotAllocation,
    InventorySnapshotPart,
    InventorySnapshotRow,
    SnapshotPartKind,
    SnapshotPriceKind,
    SnapshotQuantityState,
    SnapshotRowStatus,
)
from app.modules.snapshots.stock_file import StockFileV1, content_fingerprint_of_file
from app.modules.tenancy.models import Store, StoreLocationAccess
from tests.conftest import requires_database
from tests.integration.test_catalog_merge import a_pair, merged, refused_with, variant_row
from tests.integration.test_catalog_merge import warehouse as new_warehouse
from tests.integration.test_shared_warehouse import api, make_two_shops
from tests.integration.test_snapshot_import import (
    LIST,
    World,
    allocation,
    approve,
    client_for,
    create_product,
    import_body,
    imported,
    movements,
    prepared,
    receive,
    resolve,
    seed_world,
    stock,
    wait_until_blocked_by,
)
from tests.integration.test_suggested_price import owner

pytestmark = [pytest.mark.integration, requires_database()]

FILE_NAME = "зошит-1.json"


@pytest.fixture
async def world() -> AsyncIterator[World]:
    """The world `test_snapshot_import.py` builds: a network with a shared
    and a private warehouse, an owner, a manager, a seller of the main store
    and a manager of the second, and three models."""
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    seeded = await seed_world(maker)
    async with client_for(maker, seeded["users"]["owner"]) as client:
        coat, coat_sizes = await create_product(
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
        sizes=coat_sizes,
        **seeded,
    )
    await engine.dispose()


@pytest.fixture
async def maker() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine: AsyncEngine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


# ---------------------------------------------------------------------------
# Files, parts and their calls
# ---------------------------------------------------------------------------


def file_line(
    text_: str, photo: str = "IMG_0001.jpg", photo_line: int = 1, **reading: Any
) -> dict[str, Any]:
    return {"text": text_, "photo": photo, "photo_line": photo_line, **reading}


def stock_file(*lines: dict[str, Any], **envelope: Any) -> dict[str, Any]:
    return {"format": "birka.stock-list", "version": 1, "lines": list(lines), **envelope}


def counts(*pairs: tuple[str, int]) -> list[dict[str, Any]]:
    return [{"size": size, "count": count} for size, count in pairs]


# The first notebook: a split the text shows, a bare number the parser called
# the count, and a heading the parser left a word on.
NOTEBOOK = stock_file(
    file_line(
        "Лоран шоколад M-1 L-2",
        photo_line=1,
        model="Лоран",
        colours=["шоколад"],
        size_counts=counts(("M", 1), ("L", 2)),
    ),
    file_line("Бомбер M 3 1200", photo_line=2, model="Бомбер", sizes=["M"], count=3, price="1200"),
    file_line("Куртки", photo_line=3, note="заголовок"),
    source="Зошит Наталії",
    counted_on="осінь 2025",
    price_kind="purchase",
    parser="photo2json 0.3",
)
# A second notebook, other photos: a count with its unit the parser agrees
# with, and one size with its count.
SECOND = stock_file(
    file_line("Мышка чорний M 2 шт", photo="IMG_0002.jpg", photo_line=1, count=2),
    file_line(
        "Ботега бежевий M-1", photo="IMG_0002.jpg", photo_line=2, size_counts=counts(("M", 1))
    ),
)


def through(store: uuid.UUID | None) -> dict[str, str]:
    return {"store_id": str(store)} if store is not None else {}


async def from_file(
    client: httpx.AsyncClient,
    w: World,
    file: dict[str, Any],
    *,
    file_name: str = FILE_NAME,
    command_id: uuid.UUID | str | None = None,
    store: uuid.UUID | None = None,
    location: uuid.UUID | None = None,
    **extra: Any,
) -> httpx.Response:
    return await client.post(
        "/api/v1/snapshots",
        json={
            "command_id": str(command_id or uuid.uuid4()),
            "store_id": str(store or w.main),
            "location_id": str(location or w.shared),
            "file": file,
            "file_name": file_name,
            **extra,
        },
    )


async def created_from_file(
    client: httpx.AsyncClient, w: World, file: dict[str, Any] = NOTEBOOK, **kwargs: Any
) -> dict[str, Any]:
    response = await from_file(client, w, file, **kwargs)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def add_file(
    client: httpx.AsyncClient,
    snapshot_id: str,
    file: dict[str, Any] = SECOND,
    *,
    file_name: str = "зошит-2.json",
    command_id: uuid.UUID | str | None = None,
    store: uuid.UUID | None = None,
) -> httpx.Response:
    return await client.post(
        f"/api/v1/snapshots/{snapshot_id}/parts",
        params=through(store),
        json={"command_id": str(command_id or uuid.uuid4()), "file": file, "file_name": file_name},
    )


async def add_lines(
    client: httpx.AsyncClient,
    snapshot_id: str,
    lines: list[str],
    *,
    command_id: uuid.UUID | str | None = None,
    store: uuid.UUID | None = None,
    **extra: Any,
) -> httpx.Response:
    return await client.post(
        f"/api/v1/snapshots/{snapshot_id}/parts",
        params=through(store),
        json={"command_id": str(command_id or uuid.uuid4()), "lines": lines, **extra},
    )


async def added(response: httpx.Response) -> dict[str, Any]:
    assert response.status_code == 201, response.text
    part: dict[str, Any] = response.json()["part"]
    return part


async def remove(
    client: httpx.AsyncClient, snapshot_id: str, part_id: str, *, store: uuid.UUID | None = None
) -> httpx.Response:
    return await client.post(
        f"/api/v1/snapshots/{snapshot_id}/parts/{part_id}/remove", params=through(store), json={}
    )


async def parts_of(
    client: httpx.AsyncClient, snapshot_id: str, *, store: uuid.UUID | None = None
) -> list[dict[str, Any]]:
    response = await client.get(f"/api/v1/snapshots/{snapshot_id}/parts", params=through(store))
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


async def lines_of(
    client: httpx.AsyncClient, snapshot_id: str, *, store: uuid.UUID | None = None, **params: Any
) -> list[dict[str, Any]]:
    response = await client.get(
        f"/api/v1/snapshots/{snapshot_id}/lines",
        params={**through(store), "limit": 200, **params},
    )
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


async def view_of(
    client: httpx.AsyncClient, snapshot_id: str, *, store: uuid.UUID | None = None
) -> dict[str, Any]:
    response = await client.get(f"/api/v1/snapshots/{snapshot_id}", params=through(store))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def by_size(w: World, *pairs: tuple[str, int], variant: uuid.UUID | None = None) -> list[dict]:
    return [allocation(variant or w.coat, w.sizes[size], quantity) for size, quantity in pairs]


def conflict(response: httpx.Response, reason: str) -> dict[str, Any]:
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "SNAPSHOT_CONFLICT", response.text
    details: dict[str, Any] = response.json()["details"]
    assert details["reason"] == reason, response.text
    return details


async def store_name(w: World, store_id: uuid.UUID) -> str:
    async with w.maker() as session:
        name = await session.scalar(select(Store.name).where(Store.id == store_id))
    assert name is not None
    return name


async def audit_of(w: World, action: str) -> list[AuditLog]:
    async with w.maker() as session:
        return list(
            await session.scalars(
                select(AuditLog)
                .where(AuditLog.organization_id == w.org, AuditLog.action == action)
                .order_by(AuditLog.created_at)
            )
        )


async def rows_of(w: World, snapshot_id: str) -> list[InventorySnapshotRow]:
    async with w.maker() as session:
        return list(
            await session.scalars(
                select(InventorySnapshotRow)
                .where(InventorySnapshotRow.inventory_snapshot_id == uuid.UUID(snapshot_id))
                .order_by(InventorySnapshotRow.line_no)
            )
        )


async def refused_by_the_database(w: World, statement: str, match: str, **parameters: Any) -> None:
    async with w.maker() as session:
        with pytest.raises(DBAPIError, match=match):
            await session.execute(text(statement), parameters)
            await session.commit()


# ---------------------------------------------------------------------------
# Creating a list and adding parts
# ---------------------------------------------------------------------------


async def test_a_list_created_from_a_file_keeps_each_line_its_photo_and_reading(world):
    w = world
    async with w.maker() as session:
        models_before = await session.scalar(select(func.count()).select_from(ProductVariant))
    async with w.client() as client:
        view = await created_from_file(
            client, w, source_document_ref="Зошит Наталії", captured_at="осінь 2025"
        )
        items = await lines_of(client, view["snapshot_id"])
        [part] = await parts_of(client, view["snapshot_id"])

    assert (view["status"], view["review_revision"]) == ("IN_REVIEW", 0)
    assert view["store_name"] == await store_name(w, w.main)
    summary = view["summary"]
    assert (summary["lines"], summary["parts"], summary["parts_removed"]) == (3, 1, 0)
    assert summary["limits"] == {
        "lines": snapshot_service.MAX_LIST_LINES,
        "allocations": snapshot_service.MAX_LIST_ALLOCATIONS,
    }
    assert part["part_no"] == 1
    assert (part["kind"], part["file_name"], part["format_version"]) == ("FILE", FILE_NAME, 1)
    assert (part["source"], part["counted_on"]) == ("Зошит Наталії", "осінь 2025")
    assert (part["price_kind"], part["parser"]) == ("PURCHASE", "photo2json 0.3")
    assert (part["lines"], part["first_line_no"], part["last_line_no"]) == (3, 1, 3)
    assert (part["added_by_user_id"], part["added_by_name"]) == (str(w.users["owner"]), "Owner")
    assert (part["removed_at"], part["removed_by_name"]) == (None, None)
    assert part["progress"] == {"pending": 0, "needs_review": 3, "resolved": 0, "skipped": 0}

    # Each line verbatim, beside where it was written and what the parser read.
    assert [item["raw_text"] for item in items] == [line["text"] for line in NOTEBOOK["lines"]]
    assert [(item["photo_name"], item["photo_line"]) for item in items] == [
        ("IMG_0001.jpg", 1),
        ("IMG_0001.jpg", 2),
        ("IMG_0001.jpg", 3),
    ]
    assert {(item["part_id"], item["part_no"], item["price_kind"]) for item in items} == {
        (part["part_id"], 1, "PURCHASE")
    }
    empty = dict.fromkeys(("model", "colours", "sizes", "size_counts", "count", "price", "note"))
    assert [item["reading"] for item in items] == [
        {
            **empty,
            "model": "Лоран",
            "colours": ["шоколад"],
            "size_counts": counts(("M", 1), ("L", 2)),
        },
        {**empty, "model": "Бомбер", "sizes": ["M"], "count": 3, "price": "1200"},
        {**empty, "note": "заголовок"},
    ]
    split, hint, heading = items
    # The split the text shows, each size of the catalogue's, waits for a tap.
    assert split["shown_split"] == [
        {"size": "M", "count": 1, "size_id": str(w.sizes["M"])},
        {"size": "L", "count": 2, "size_id": str(w.sizes["L"])},
    ]
    assert (split["quantity_state"], split["quantity_total"], split["file_reasons"]) == (
        "UNKNOWN_DISTRIBUTION",
        3,
        [],
    )
    # «M 3 1200»: the parser's 3 is a hint, never the line's count.
    assert (hint["quantity_state"], hint["quantity_total"], hint["file_reasons"]) == (
        "UNKNOWN_QUANTITY",
        None,
        ["FILE_COUNT_HINT"],
    )
    assert (hint["shown_split"], hint["may_imply_one"]) == (None, False)
    assert (heading["file_reasons"], heading["status"]) == (["FILE_NOTE"], "NEEDS_REVIEW")
    assert [item["same_photo_lines"] for item in items] == [1, 1, 1]

    snapshot_id = uuid.UUID(view["snapshot_id"])
    async with w.maker() as session:
        stored = await session.scalar(
            select(InventorySnapshotPart).where(
                InventorySnapshotPart.inventory_snapshot_id == snapshot_id
            )
        )
        assert stored is not None
        assert stored.kind is SnapshotPartKind.FILE
        assert stored.price_kind is SnapshotPriceKind.PURCHASE
        assert stored.content_fingerprint == content_fingerprint_of_file(
            StockFileV1.model_validate(NOTEBOOK)
        )
        listed = await session.get(InventorySnapshot, snapshot_id)
        assert listed is not None
        # The list's first part is named by the list's own command.
        assert (stored.command_id, stored.command_fingerprint) == (
            listed.command_id,
            listed.command_fingerprint,
        )
        raws = list(
            await session.scalars(
                select(RawInput)
                .where(RawInput.organization_id == w.org)
                .where(RawInput.source_kind == RawInputSource.SNAPSHOT_IMPORT)
                .order_by(RawInput.source_ref)
            )
        )
        assert [raw.source_ref for raw in raws] == [
            f"inventory_snapshot:{snapshot_id}:{n}" for n in (1, 2, 3)
        ]
        # Nothing of the reading reached the catalogue, nor any stock.
        assert await session.scalar(select(func.count()).select_from(ProductVariant)) == (
            models_before
        )
        assert not await session.scalar(
            select(func.count())
            .select_from(StockLot)
            .where(StockLot.inventory_snapshot_id == snapshot_id)
        )
    [entry] = await audit_of(w, "snapshot.imported")
    assert entry.after["part_id"] == part["part_id"]
    assert (entry.after["kind"], entry.after["file_name"]) == ("FILE", FILE_NAME)
    assert (entry.after["format_version"], entry.after["parser"]) == (1, "photo2json 0.3")


async def test_the_same_file_import_twice_is_one_list(world):
    w = world
    command = uuid.uuid4()
    async with w.client() as client:
        first = await from_file(client, w, NOTEBOOK, command_id=command)
        again = await from_file(client, w, NOTEBOOK, command_id=command)
        # `$schema` is ignored: the same file.
        marked = await from_file(
            client, w, {**NOTEBOOK, "$schema": "./schema.json"}, command_id=command
        )
        renamed = await from_file(client, w, NOTEBOOK, command_id=command, file_name="інший.json")
        other = await from_file(client, w, SECOND, command_id=command)
        as_lines = await client.post(
            "/api/v1/snapshots", json=import_body(w, LIST, command_id=command)
        )

    assert first.status_code == 201, first.text
    for replay in (again, marked):
        assert replay.status_code == 200, replay.text
        assert replay.json()["snapshot_id"] == first.json()["snapshot_id"]
    for refused in (renamed, other, as_lines):
        assert (refused.status_code, refused.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    assert len(await rows_of(w, first.json()["snapshot_id"])) == 3


async def test_a_command_id_names_one_list_or_one_part_never_both(world):
    w = world
    async with w.client() as client:
        view = await imported(client, w)
        snapshot_id = view["snapshot_id"]
        as_part = await add_lines(
            client, snapshot_id, ["Шуба орех 70 см"], command_id=view["command_id"]
        )
        part_command = uuid.uuid4()
        part = await added(
            await add_lines(client, snapshot_id, ["Шуба орех 70 см"], command_id=part_command)
        )
        as_list = await client.post(
            "/api/v1/snapshots", json=import_body(w, LIST, command_id=part_command)
        )
        as_file_list = await from_file(client, w, NOTEBOOK, command_id=part_command)

    for refused in (as_part, as_list, as_file_list):
        assert (refused.status_code, refused.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    assert part["part_no"] == 2
    async with w.maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(InventorySnapshot)
                .where(InventorySnapshot.organization_id == w.org)
            )
            == 1
        )


async def test_a_part_replayed_under_another_list_is_a_conflict(world):
    w = world
    command = uuid.uuid4()
    async with w.client() as client:
        first = await imported(client, w)
        second = await imported(client, w)
        part = await added(await add_file(client, first["snapshot_id"], command_id=command))
        elsewhere = await add_file(client, second["snapshot_id"], command_id=command)
        replay = await add_file(client, first["snapshot_id"], command_id=command)
        changed = await add_file(
            client, first["snapshot_id"], command_id=command, file_name="інша назва.json"
        )

    assert (elsewhere.status_code, elsewhere.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    assert (changed.status_code, changed.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    assert replay.status_code == 200, replay.text
    assert replay.json()["part"]["part_id"] == part["part_id"]
    assert len(await rows_of(w, second["snapshot_id"])) == 3


async def test_creating_and_adding_under_one_command_id_at_once_never_fails_with_500(world):
    """Both take the same lock: one wins, and the other finds its name taken."""
    w = world
    async with w.client() as client:
        view = await imported(client, w)
    for _ in range(4):
        command = uuid.uuid4()
        async with w.client() as one, w.client() as two:
            results = await asyncio.gather(
                one.post(
                    "/api/v1/snapshots", json=import_body(w, ["Куртка 1636"], command_id=command)
                ),
                add_lines(two, view["snapshot_id"], ["Шуба орех 70 см"], command_id=command),
            )
        assert sorted(result.status_code for result in results) == [201, 409], [
            result.text for result in results
        ]
        assert {r.json()["code"] for r in results if r.status_code == 409} == {
            "IDEMPOTENCY_CONFLICT"
        }


async def test_two_deliveries_of_one_part_at_once_add_it_once(world):
    w = world
    command = uuid.uuid4()
    async with w.client() as client:
        view = await imported(client, w)
    async with w.client() as one, w.client() as two:
        results = await asyncio.gather(
            add_file(one, view["snapshot_id"], command_id=command),
            add_file(two, view["snapshot_id"], command_id=command),
        )

    assert sorted(result.status_code for result in results) == [200, 201]
    assert results[0].json()["part"]["part_id"] == results[1].json()["part"]["part_id"]
    assert len(await rows_of(w, view["snapshot_id"])) == 5


async def test_a_second_file_continues_the_list_s_line_numbers(world):
    w = world
    async with w.client() as client:
        view = await created_from_file(client, w)
        response = await add_file(client, view["snapshot_id"])
        items = await lines_of(client, view["snapshot_id"])

    part = await added(response)
    snapshot = response.json()["snapshot"]
    assert (part["part_no"], part["kind"], part["file_name"]) == (2, "FILE", "зошит-2.json")
    assert (part["lines"], part["first_line_no"], part["last_line_no"]) == (2, 4, 5)
    assert part["photo_lines_elsewhere"] == 0
    assert (snapshot["review_revision"], snapshot["summary"]["lines"]) == (1, 5)
    assert (snapshot["summary"]["parts"], snapshot["summary"]["parts_removed"]) == (2, 0)
    assert [item["line_no"] for item in items] == [1, 2, 3, 4, 5]
    assert [item["part_no"] for item in items] == [1, 1, 1, 2, 2]
    async with w.maker() as session:
        refs = set(
            await session.scalars(
                select(RawInput.source_ref).where(
                    RawInput.organization_id == w.org,
                    RawInput.source_kind == RawInputSource.SNAPSHOT_IMPORT,
                )
            )
        )
    assert refs == {f"inventory_snapshot:{view['snapshot_id']}:{n}" for n in range(1, 6)}
    [entry] = await audit_of(w, "snapshot.part_added")
    assert entry.entity_id == uuid.UUID(view["snapshot_id"])
    assert entry.after["part_id"] == part["part_id"]
    assert (entry.after["first_line_no"], entry.after["last_line_no"]) == (4, 5)
    assert (entry.after["part_no"], entry.after["review_revision"]) == (2, 1)


async def test_two_files_added_at_once_get_two_contiguous_ranges(world):
    w = world
    three = stock_file(
        *[file_line(f"Куртка {n}", photo="IMG_A.jpg", photo_line=n) for n in (1, 2, 3)]
    )
    four = stock_file(
        *[file_line(f"Шуба {n}", photo="IMG_B.jpg", photo_line=n) for n in (1, 2, 3, 4)]
    )
    async with w.client() as client:
        view = await imported(client, w, ["Куртки", "Шуби"])
    async with w.client() as one, w.client() as two:
        results = await asyncio.gather(
            add_file(one, view["snapshot_id"], three, file_name="a.json"),
            add_file(two, view["snapshot_id"], four, file_name="b.json"),
        )
    parts = sorted([await added(result) for result in results], key=lambda p: p["first_line_no"])
    async with w.client() as client:
        items = await lines_of(client, view["snapshot_id"])

    assert [p["part_no"] for p in parts] == [2, 3]
    assert parts[0]["first_line_no"] == 3
    assert parts[1]["first_line_no"] == parts[0]["last_line_no"] + 1
    assert parts[1]["last_line_no"] == 9
    assert [item["line_no"] for item in items] == list(range(1, 10))
    for part in parts:
        own = [item for item in items if item["part_id"] == part["part_id"]]
        assert [item["line_no"] for item in own] == list(
            range(part["first_line_no"], part["last_line_no"] + 1)
        )
        assert [item["raw_text"] for item in own] == [
            line["text"] for line in (three if part["file_name"] == "a.json" else four)["lines"]
        ]


async def test_the_same_file_twice_in_one_list_is_refused(world):
    w = world
    async with w.client() as client:
        view = await created_from_file(client, w)
        snapshot_id = view["snapshot_id"]
        copy = await add_file(client, snapshot_id, NOTEBOOK, file_name="копія.json")
        # The same lines in another envelope, keys in another order: the same file.
        enveloped = await add_file(
            client,
            snapshot_id,
            stock_file(
                *[dict(reversed(line.items())) for line in NOTEBOOK["lines"]],
                source="інший зошит",
                price_kind="sale",
                parser="інший парсер",
            ),
        )
        longer = await add_file(
            client, snapshot_id, stock_file(*NOTEBOOK["lines"], file_line("Шуба", photo_line=4))
        )

    for refused in (copy, enveloped):
        details = conflict(refused, "PART_DUPLICATE")
        assert (details["part_no"], details["file_name"]) == (1, FILE_NAME)
    assert (await added(longer))["part_no"] == 2


async def test_the_same_pasted_lines_may_still_go_into_two_lists(world):
    """Hand-typed parts and other lists are not checked: a rule the owner did
    not make, and one that would break the tests of a warehouse opened once."""
    w = world
    async with w.client() as client:
        first = await imported(client, w)
        second = await imported(client, w)
        again = await add_lines(client, first["snapshot_id"], LIST)
        file_twice = await created_from_file(client, w)

    assert first["snapshot_id"] != second["snapshot_id"]
    assert (await added(again))["first_line_no"] == 4
    # Another list may hold the same file too.
    assert file_twice["snapshot_id"] not in (first["snapshot_id"], second["snapshot_id"])


async def test_a_file_overlapping_the_list_is_counted_not_refused(world):
    w = world
    overlapping = stock_file(
        file_line("Лоран шоколад M-1 L-2 (ще раз)", photo_line=1),
        file_line("Куртки (ще раз)", photo_line=3),
        file_line("Шуба орех 70 см", photo="IMG_0009.jpg", photo_line=1),
    )
    async with w.client() as client:
        view = await created_from_file(client, w)
        part = await added(await add_file(client, view["snapshot_id"], overlapping))
        parts = await parts_of(client, view["snapshot_id"])
        items = await lines_of(client, view["snapshot_id"])

    assert part["photo_lines_elsewhere"] == 2
    assert [p["photo_lines_elsewhere"] for p in parts] == [2, 2]
    assert [item["same_photo_lines"] for item in items] == [2, 1, 2, 2, 2, 1]
    [entry] = await audit_of(w, "snapshot.part_added")
    assert entry.after["photo_lines_elsewhere"] == 2


async def test_hand_typed_lines_join_a_list_of_files_as_their_own_part(world):
    w = world
    async with w.client() as client:
        view = await created_from_file(client, w)
        part = await added(
            await add_lines(
                client,
                view["snapshot_id"],
                ["Шуба 1636", "Куртки"],
                source="сторінка 7",
                counted_on="осінь",
            )
        )
        items = await lines_of(client, view["snapshot_id"], part_id=part["part_id"])
        typed = await imported(client, w)
        with_a_file = await added(await add_file(client, typed["snapshot_id"], NOTEBOOK))

    assert (part["kind"], part["file_name"], part["source"], part["counted_on"]) == (
        "PASTED",
        None,
        "сторінка 7",
        "осінь",
    )
    assert (part["price_kind"], part["parser"], part["format_version"]) == (None, None, None)
    assert (part["first_line_no"], part["last_line_no"]) == (4, 5)
    for item in items:
        assert (item["photo_name"], item["photo_line"], item["reading"]) == (None, None, None)
        assert (item["file_reasons"], item["shown_split"], item["price_kind"]) == ([], None, None)
        assert item["same_photo_lines"] == 0
    # As for any typed line: a number that may be an item code needs a note.
    assert [item["may_imply_one"] for item in items] == [False, True]
    # And a list typed by hand takes a file.
    assert (with_a_file["kind"], with_a_file["first_line_no"]) == ("FILE", 4)


async def test_a_part_is_added_only_while_the_list_is_in_review(world):
    w = world
    command = uuid.uuid4()
    async with w.client() as client:
        waiting = await imported(client, w)
        part = await added(
            await add_lines(client, waiting["snapshot_id"], ["Шуба"], command_id=command)
        )
        rejected = await client.post(
            f"/api/v1/snapshots/{waiting['snapshot_id']}/reject", json={"reason": "не той склад"}
        )
        assert rejected.status_code == 200, rejected.text
        late = await add_file(client, waiting["snapshot_id"])
        # The part added before the decision still answers, as it is.
        replay = await add_lines(client, waiting["snapshot_id"], ["Шуба"], command_id=command)
        applied = await prepared(client, w)
        assert (await approve(client, applied["snapshot_id"], 3)).status_code == 200
        after_approval = await add_lines(client, applied["snapshot_id"], ["Шуба"])

    for refused in (late, after_approval):
        conflict(refused, "ALREADY_DECIDED")
    assert replay.status_code == 200, replay.text
    assert replay.json()["part"]["part_id"] == part["part_id"]
    assert replay.json()["snapshot"]["status"] == "REJECTED"


async def test_a_part_added_during_an_approval_lands_before_it_or_is_refused(world):
    """Approval takes the list first, as adding a part does: a part added
    while an approval runs waits for it and finds the list decided; an
    approval while a part is added waits, and finds the list changed."""
    w = world
    async with w.client() as client:
        first = await prepared(client, w)
    async with w.maker() as approval_session:
        scope = await resolve_scope(approval_session, w.users["owner"])
        await snapshot_service.approve_snapshot(
            approval_session,
            scope=scope,
            snapshot_id=uuid.UUID(first["snapshot_id"]),
            expected_revision=3,
        )
        holder = await approval_session.scalar(text("SELECT pg_backend_pid()"))
        async with w.client() as client:
            adding = asyncio.create_task(add_lines(client, first["snapshot_id"], ["Шуба"]))
            await wait_until_blocked_by(w.engine, holder)
            await approval_session.commit()
            refused = await adding
    conflict(refused, "ALREADY_DECIDED")

    async with w.client() as client:
        second = await prepared(client, w)
    async with w.maker() as part_session:
        scope = await resolve_scope(part_session, w.users["owner"])
        await snapshot_service.add_part(
            part_session,
            scope=scope,
            snapshot_id=uuid.UUID(second["snapshot_id"]),
            command_id=uuid.uuid4(),
            lines=["Шуба орех 70 см"],
        )
        holder = await part_session.scalar(text("SELECT pg_backend_pid()"))
        async with w.client() as client:
            approving = asyncio.create_task(approve(client, second["snapshot_id"], 3))
            await wait_until_blocked_by(w.engine, holder)
            await part_session.commit()
            changed = await approving
    details = conflict(changed, "REVISION_CHANGED")
    assert details["review_revision"] == 4


# ---------------------------------------------------------------------------
# Removing a part
# ---------------------------------------------------------------------------


async def two_files_answered(client: httpx.AsyncClient, w: World) -> tuple[dict, dict, dict]:
    """NOTEBOOK (lines 1–3) and SECOND (lines 4–5); line 1 and both lines
    of SECOND answered. Returns the list and its two parts."""
    view = await created_from_file(client, w)
    snapshot_id = view["snapshot_id"]
    second = await added(await add_file(client, snapshot_id))
    [first, _] = await parts_of(client, snapshot_id)
    for line_no, body in (
        (1, {"allocations": by_size(w, ("M", 1), ("L", 2)), "quantity_basis": "STATED_BY_SIZE"}),
        (4, {"allocations": [allocation(w.bomber, w.sizes["M"], 2)], "quantity_basis": "STATED"}),
        (5, {"skip_reason": "не товар"}),
    ):
        response = await resolve(client, snapshot_id, line_no, **body)
        assert response.status_code == 200, response.text
    return await view_of(client, snapshot_id), first, second


async def test_removing_a_file_takes_its_lines_and_answers_and_leaves_the_rest(world):
    w = world
    async with w.client() as client:
        view, first, second = await two_files_answered(client, w)
        snapshot_id = view["snapshot_id"]
        response = await remove(client, snapshot_id, second["part_id"])

    assert response.status_code == 200, response.text
    part, snapshot = response.json()["part"], response.json()["snapshot"]
    assert part["removed_at"] is not None
    assert (part["removed_by_user_id"], part["removed_by_name"]) == (str(w.users["owner"]), "Owner")
    assert part["progress"] == {"pending": 0, "needs_review": 0, "resolved": 0, "skipped": 0}
    assert snapshot["review_revision"] == view["review_revision"] + 1
    summary = snapshot["summary"]
    assert (summary["lines"], summary["resolved"], summary["skipped"]) == (3, 1, 0)
    assert (summary["allocations"], summary["units"]) == (2, 3)
    assert (summary["parts"], summary["parts_removed"]) == (1, 1)
    assert summary["lines_by_basis"]["STATED"] == 0

    rows = await rows_of(w, snapshot_id)
    removed = [row for row in rows if row.part_id == uuid.UUID(second["part_id"])]
    assert {row.status for row in removed} == {SnapshotRowStatus.REMOVED}
    for row in removed:
        assert (row.quantity_basis, row.resolution_note) == (None, None)
        assert (row.resolved_by_user_id, row.resolved_at) == (None, None)
    kept = [row for row in rows if row.part_id == uuid.UUID(first["part_id"])]
    assert [row.status for row in kept] == [
        SnapshotRowStatus.RESOLVED,
        SnapshotRowStatus.NEEDS_REVIEW,
        SnapshotRowStatus.NEEDS_REVIEW,
    ]
    async with w.maker() as session:
        answers = list(
            await session.scalars(
                select(InventorySnapshotAllocation.snapshot_row_id).where(
                    InventorySnapshotAllocation.snapshot_row_id.in_([row.id for row in rows])
                )
            )
        )
        assert sorted(answers) == sorted([kept[0].id, kept[0].id])
        processing = set(
            await session.scalars(
                select(RawInputProcessing.status).where(
                    RawInputProcessing.raw_input_id.in_([row.raw_input_id for row in removed])
                )
            )
        )
        assert processing == {ProcessingStatus.PARSED}
    [entry] = await audit_of(w, "snapshot.part_removed")
    assert entry.before == {
        "lines": 2,
        "pending": 0,
        "needs_review": 0,
        "resolved": 1,
        "skipped": 1,
        "allocations": 1,
        "units": 2,
    }
    assert entry.after["part_id"] == second["part_id"]
    assert (entry.after["first_line_no"], entry.after["last_line_no"]) == (4, 5)
    assert entry.after["review_revision"] == snapshot["review_revision"]
    # Every earlier answer stays in its own entry.
    resolved_rows = {e.entity_id for e in await audit_of(w, "snapshot.line_resolved")}
    assert {row.id for row in removed} <= resolved_rows


async def test_a_removed_file_s_lines_stay_as_evidence_and_are_read_by_part(world):
    w = world
    async with w.client() as client:
        view, first, second = await two_files_answered(client, w)
        snapshot_id = view["snapshot_id"]
        assert (await remove(client, snapshot_id, second["part_id"])).status_code == 200
        counted = await lines_of(client, snapshot_id)
        by_part = await lines_of(client, snapshot_id, part_id=second["part_id"])
        by_status = await lines_of(client, snapshot_id, status="REMOVED")
        first_only = await lines_of(client, snapshot_id, part_id=first["part_id"])
        parts = await parts_of(client, snapshot_id)

    assert [item["line_no"] for item in counted] == [1, 2, 3]
    assert [item["line_no"] for item in first_only] == [1, 2, 3]
    assert [item["line_no"] for item in by_part] == [4, 5]
    assert by_status == by_part
    for item, line in zip(by_part, SECOND["lines"], strict=True):
        assert (item["status"], item["raw_text"]) == ("REMOVED", line["text"])
        assert (item["photo_name"], item["photo_line"]) == (line["photo"], line["photo_line"])
        assert (item["allocations"], item["quantity_basis"]) == ([], None)
        assert item["reading"]["count"] == line.get("count")
    assert [p["removed_by_name"] for p in parts] == [None, "Owner"]


async def test_removing_a_removed_file_again_answers_even_after_approval(world):
    w = world
    async with w.client() as client:
        view = await prepared(client, w)
        snapshot_id = view["snapshot_id"]
        part = await added(await add_lines(client, snapshot_id, ["Шуба орех 70 см"]))
        first = await remove(client, snapshot_id, part["part_id"])
        again = await remove(client, snapshot_id, part["part_id"])
        assert (await approve(client, snapshot_id, 5)).status_code == 200
        after = await remove(client, snapshot_id, part["part_id"])
        [listed, _] = await parts_of(client, snapshot_id)
        live = await remove(client, snapshot_id, listed["part_id"])

    assert first.status_code == 200, first.text
    for replay in (again, after):
        assert replay.status_code == 200, replay.text
        assert replay.json()["part"] == first.json()["part"]
    assert again.json()["snapshot"]["review_revision"] == 5
    assert after.json()["snapshot"]["status"] == "APPLIED"
    conflict(live, "ALREADY_DECIDED")


async def test_a_file_of_another_list_is_not_found(world):
    w = world
    other = await seed_world(w.maker)
    async with w.client() as client:
        first = await imported(client, w)
        second = await imported(client, w)
        part = await added(await add_lines(client, first["snapshot_id"], ["Шуба"]))
        responses = [
            await remove(client, second["snapshot_id"], part["part_id"]),
            await remove(client, first["snapshot_id"], str(uuid.uuid4())),
            await client.get(
                f"/api/v1/snapshots/{second['snapshot_id']}/lines",
                params={"part_id": part["part_id"]},
            ),
        ]
    async with client_for(w.maker, other["users"]["owner"]) as client:
        responses.append(await remove(client, first["snapshot_id"], part["part_id"]))
        responses.append(await client.get(f"/api/v1/snapshots/{first['snapshot_id']}/parts"))

    for response in responses:
        assert (response.status_code, response.json()["code"]) == (404, "NOT_FOUND"), response.text


async def test_the_last_file_is_not_removed(world):
    """The list is rejected instead, which also lets its warehouse go (owner,
    2026-10-08)."""
    w = world
    async with w.client() as client:
        view = await created_from_file(client, w)
        snapshot_id = view["snapshot_id"]
        [only] = await parts_of(client, snapshot_id)
        alone = await remove(client, snapshot_id, only["part_id"])
        second = await added(await add_file(client, snapshot_id))
        assert (await remove(client, snapshot_id, only["part_id"])).status_code == 200
        last = await remove(client, snapshot_id, second["part_id"])
        waiting = await receive(client, w)
        rejected = await client.post(
            f"/api/v1/snapshots/{snapshot_id}/reject", json={"reason": "не той склад"}
        )
        free = await receive(client, w)

    assert conflict(alone, "LAST_PART")["part_id"] == only["part_id"]
    assert conflict(last, "LAST_PART")["part_id"] == second["part_id"]
    assert waiting.json()["code"] == "OPENING_LIST_PENDING"
    assert rejected.status_code == 200, rejected.text
    assert free.status_code == 201, free.text


async def test_a_removed_file_may_be_added_again_as_a_new_file(world):
    w = world
    async with w.client() as client:
        view, _, second = await two_files_answered(client, w)
        snapshot_id = view["snapshot_id"]
        assert (await remove(client, snapshot_id, second["part_id"])).status_code == 200
        again = await added(await add_file(client, snapshot_id))
        items = await lines_of(client, snapshot_id, part_id=again["part_id"])
        removed = await lines_of(client, snapshot_id, part_id=second["part_id"])

    assert (again["part_no"], again["first_line_no"], again["last_line_no"]) == (3, 6, 7)
    # Answered anew: nothing of the removed file's answers comes back.
    assert [(item["status"], item["allocations"]) for item in items] == [
        ("NEEDS_REVIEW", []),
        ("NEEDS_REVIEW", []),
    ]
    assert {item["status"] for item in removed} == {"REMOVED"}


async def test_a_removed_line_cannot_be_answered(world):
    w = world
    async with w.client() as client:
        view = await created_from_file(client, w)
        second = await added(await add_file(client, view["snapshot_id"]))
        assert (await remove(client, view["snapshot_id"], second["part_id"])).status_code == 200
        skipped = await resolve(client, view["snapshot_id"], 4, skip_reason="не товар")
        answered = await resolve(
            client,
            view["snapshot_id"],
            4,
            allocations=[allocation(w.bomber, w.sizes["M"], 2)],
            quantity_basis="STATED",
        )

    for refused in (skipped, answered):
        details = conflict(refused, "PART_REMOVED")
        assert (details["line_no"], details["part_id"]) == (4, second["part_id"])


async def test_a_model_only_a_removed_file_named_can_be_merged(maker):
    """A removed file's answers are gone, so they no longer hold a model in a
    waiting list (ADR-0008 §3, ADR-0014 §9)."""
    shops = await make_two_shops(maker)
    stays, duplicate = await a_pair(maker, shops)
    fresh = await new_warehouse(maker, shops, store=shops.primary_store, name="Новий склад")
    boss = owner(shops)
    async with api(maker, boss) as client:
        created = await client.post(
            "/api/v1/snapshots",
            json={
                "command_id": str(uuid.uuid4()),
                "store_id": str(shops.primary_store),
                "location_id": str(fresh),
                "lines": ["Куртки"],
            },
        )
        assert created.status_code == 201, created.text
        snapshot_id = created.json()["snapshot_id"]
        part = await added(
            await add_file(
                client, snapshot_id, stock_file(file_line("Лоран шокалад M 2 шт", count=2))
            )
        )
        answered = await resolve(
            client,
            snapshot_id,
            2,
            allocations=[allocation(duplicate.variant, duplicate.sizes["M"], 2)],
            quantity_basis="STATED",
        )
        assert answered.status_code == 200, answered.text

    found = await refused_with(
        maker,
        boss,
        store=shops.primary_store,
        duplicate=duplicate,
        into=stays,
        reasons=["OPENING_LIST_WAITING"],
    )
    assert found[0]["snapshot_ids"] == [snapshot_id]
    async with api(maker, boss) as client:
        assert (await remove(client, snapshot_id, part["part_id"])).status_code == 200
    await merged(maker, boss, store=shops.primary_store, duplicate=duplicate, into=stays)
    assert await variant_row(maker, duplicate) == (EntityStatus.MERGED, stays.id)


async def test_approval_never_takes_a_removed_line(world):
    w = world
    async with w.client() as client:
        view, first, second = await two_files_answered(client, w)
        snapshot_id = view["snapshot_id"]
        for line_no, body in (
            (
                2,
                {
                    "allocations": [allocation(w.bomber, w.sizes["M"], 3)],
                    "quantity_basis": "OWNER_KNOWLEDGE",
                    "note": "на фото 3, Оля перелічила",
                },
            ),
            (3, {"skip_reason": "заголовок"}),
        ):
            assert (await resolve(client, snapshot_id, line_no, **body)).status_code == 200
        removed = await remove(client, snapshot_id, second["part_id"])
        revision = removed.json()["snapshot"]["review_revision"]
        response = await approve(client, snapshot_id, revision)
        page = await client.get(f"/api/v1/snapshots/{snapshot_id}/application")

    assert response.status_code == 200, response.text
    assert response.json()["application"] == {"units": 6, "allocations": 3}
    assert await stock(w) == {
        (w.coat, w.sizes["M"]): 1,
        (w.coat, w.sizes["L"]): 2,
        (w.bomber, w.sizes["M"]): 3,
    }
    ledger = await movements(w)
    assert len(ledger) == 3
    assert {movement.movement_type for movement in ledger} == {MovementType.OPENING_BALANCE}
    assert [line["line_no"] for line in page.json()["items"]] == [1, 1, 2]
    [entry] = await audit_of(w, "snapshot.applied")
    assert entry.after["lines_removed"] == 2
    assert entry.after["parts"] == [
        {
            "part_id": first["part_id"],
            "part_no": 1,
            "kind": "FILE",
            "file_name": FILE_NAME,
            "lines": 3,
        }
    ]
    assert (entry.after["allocations"], entry.after["units"]) == (3, 6)


# ---------------------------------------------------------------------------
# The database's own guarantees
# ---------------------------------------------------------------------------


async def removed_third_part(client: httpx.AsyncClient, w: World) -> tuple[dict, dict, dict]:
    """`two_files_answered`, and a third part, removed. Returns the list, the
    second part (live, answered) and the third (removed)."""
    view, _, second = await two_files_answered(client, w)
    third = await added(await add_lines(client, view["snapshot_id"], ["Шуба орех 70 см"]))
    assert (await remove(client, view["snapshot_id"], third["part_id"])).status_code == 200
    return view, second, third


async def test_the_database_removes_a_part_whole(world):
    w = world
    async with w.client() as client:
        view, second, third = await removed_third_part(client, w)
    rows = {row.line_no: row for row in await rows_of(w, view["snapshot_id"])}
    owner_id = w.users["owner"]

    # Stamping a part while its lines stay answered fails at commit.
    async with w.maker() as session:
        await session.execute(
            text(
                "UPDATE inventory_snapshot_part SET removed_at = now(), removed_by_user_id = :user "
                "WHERE id = :part"
            ),
            {"user": owner_id, "part": uuid.UUID(second["part_id"])},
        )
        with pytest.raises(DBAPIError, match="removed whole"):
            await session.commit()
    # Even with every line marked removed, a kept answer fails it at commit:
    # the deferred check stands behind the line's own trigger.
    async with w.maker() as session:
        await session.execute(
            text(
                "ALTER TABLE inventory_snapshot_row DISABLE TRIGGER inventory_snapshot_row_is_fixed"
            )
        )
        await session.execute(
            text(
                "UPDATE inventory_snapshot_part SET removed_at = now(), removed_by_user_id = :user "
                "WHERE id = :part"
            ),
            {"user": owner_id, "part": uuid.UUID(second["part_id"])},
        )
        await session.execute(
            text(
                "UPDATE inventory_snapshot_row SET status = 'REMOVED', quantity_basis = NULL, "
                "resolution_note = NULL, resolved_by_user_id = NULL, resolved_at = NULL "
                "WHERE part_id = :part"
            ),
            {"part": uuid.UUID(second["part_id"])},
        )
        await session.execute(
            text(
                "ALTER TABLE inventory_snapshot_row ENABLE TRIGGER inventory_snapshot_row_is_fixed"
            )
        )
        with pytest.raises(DBAPIError, match="removed whole"):
            await session.commit()

    # A line becomes REMOVED only with its part.
    await refused_by_the_database(
        w,
        "UPDATE inventory_snapshot_row SET status = 'REMOVED' WHERE id = :row",
        "removed only with its part",
        row=rows[2].id,
    )
    # A removed line takes no answer, inserted or moved onto it.
    await refused_by_the_database(
        w,
        "INSERT INTO inventory_snapshot_allocation "
        "(id, snapshot_row_id, product_variant_id, size_id, quantity) "
        "VALUES (gen_random_uuid(), :row, :variant, :size, 1)",
        "takes no answer",
        row=rows[6].id,
        variant=w.coat,
        size=w.sizes["M"],
    )
    await refused_by_the_database(
        w,
        "UPDATE inventory_snapshot_allocation SET snapshot_row_id = :removed "
        "WHERE snapshot_row_id = :live",
        "takes no answer",
        removed=rows[6].id,
        live=rows[4].id,
    )
    assert third["part_no"] == 3


async def test_a_removed_part_is_never_restored(world):
    w = world
    async with w.client() as client:
        view, _, third = await removed_third_part(client, w)
    rows = {row.line_no: row for row in await rows_of(w, view["snapshot_id"])}
    [first_part] = [p for p in await _parts(w, view["snapshot_id"]) if p.part_no == 1]
    part = uuid.UUID(third["part_id"])

    for statement in (
        "UPDATE inventory_snapshot_part SET removed_at = NULL, removed_by_user_id = NULL "
        "WHERE id = :part",
        "UPDATE inventory_snapshot_part SET removed_at = now() WHERE id = :part",
        "UPDATE inventory_snapshot_part SET source = 'інше' WHERE id = :part",
    ):
        await refused_by_the_database(w, statement, "only ever changes by being removed", part=part)
    await refused_by_the_database(
        w,
        "UPDATE inventory_snapshot_part SET file_name = 'інше.json' WHERE id = :part",
        "only ever changes by being removed",
        part=first_part.id,
    )
    await refused_by_the_database(
        w, "DELETE FROM inventory_snapshot_part WHERE id = :part", "never deleted", part=part
    )
    await refused_by_the_database(
        w,
        "UPDATE inventory_snapshot_row SET status = 'PENDING' WHERE id = :row",
        "removed stock list line never changes",
        row=rows[6].id,
    )
    await refused_by_the_database(
        w,
        "INSERT INTO inventory_snapshot_part (id, organization_id, inventory_snapshot_id, "
        "part_no, command_id, kind, line_count, first_line_no, last_line_no, removed_at, "
        "removed_by_user_id) VALUES (gen_random_uuid(), :org, :list, 9, gen_random_uuid(), "
        "'PASTED', 1, 90, 90, now(), :user)",
        "never added removed",
        org=w.org,
        list=uuid.UUID(view["snapshot_id"]),
        user=w.users["owner"],
    )
    # No line joins a removed part.
    async with w.maker() as session:
        [line] = await record_lines(
            session,
            organization_id=w.org,
            store_id=w.main,
            actor_user_id=w.users["owner"],
            source_kind=RawInputSource.SNAPSHOT_IMPORT,
            source_refs=["test"],
            lines=["Шуба"],
        )
        session.add(
            InventorySnapshotRow(
                inventory_snapshot_id=uuid.UUID(view["snapshot_id"]),
                part_id=part,
                line_no=99,
                raw_input_id=line.raw_input_id,
                parse_result_id=line.parse_result_id,
                quantity_state=SnapshotQuantityState.UNKNOWN_QUANTITY,
                status=SnapshotRowStatus.PENDING,
                file_reasons=[],
            )
        )
        with pytest.raises(DBAPIError, match="never joins a removed part"):
            await session.flush()


async def _parts(w: World, snapshot_id: str) -> list[InventorySnapshotPart]:
    async with w.maker() as session:
        return list(
            await session.scalars(
                select(InventorySnapshotPart).where(
                    InventorySnapshotPart.inventory_snapshot_id == uuid.UUID(snapshot_id)
                )
            )
        )


async def test_a_row_cannot_name_another_list_s_part(world):
    w = world
    async with w.client() as client:
        first = await imported(client, w)
        second = await imported(client, w)
    [foreign] = await _parts(w, second["snapshot_id"])
    [row, *_] = await rows_of(w, first["snapshot_id"])

    async with w.maker() as session:
        [line] = await record_lines(
            session,
            organization_id=w.org,
            store_id=w.main,
            actor_user_id=w.users["owner"],
            source_kind=RawInputSource.SNAPSHOT_IMPORT,
            source_refs=["test"],
            lines=["Шуба"],
        )
        session.add(
            InventorySnapshotRow(
                inventory_snapshot_id=uuid.UUID(first["snapshot_id"]),
                part_id=foreign.id,
                line_no=99,
                raw_input_id=line.raw_input_id,
                parse_result_id=line.parse_result_id,
                quantity_state=SnapshotQuantityState.UNKNOWN_QUANTITY,
                status=SnapshotRowStatus.PENDING,
                file_reasons=[],
            )
        )
        with pytest.raises(IntegrityError, match="fk_inventory_snapshot_row_part"):
            await session.flush()
    await refused_by_the_database(
        w,
        "UPDATE inventory_snapshot_row SET part_id = :part WHERE id = :row",
        "evidence of a stock list line never changes",
        part=foreign.id,
        row=row.id,
    )


async def test_the_evidence_of_a_row_never_changes(world):
    w = world
    async with w.client() as client:
        view = await created_from_file(client, w)
        second = await added(await add_file(client, view["snapshot_id"]))
        other = await imported(client, w)
    rows = await rows_of(w, view["snapshot_id"])
    row = rows[0]
    for statement, parameters in (
        ("SET photo_name = 'IMG_9999.jpg'", {}),
        ("SET photo_line = photo_line + 1", {}),
        ("SET reading = '{}'::jsonb", {}),
        ("SET file_reasons = ARRAY['FILE_NOTE']::varchar[]", {}),
        ("SET shown_split = NULL", {}),
        ("SET quantity_total = 9", {}),
        ("SET quantity_state = 'UNKNOWN_QUANTITY', quantity_total = NULL", {}),
        ("SET line_no = 99", {}),
        ("SET raw_input_id = :raw", {"raw": rows[4].raw_input_id}),
        ("SET part_id = :part", {"part": uuid.UUID(second["part_id"])}),
        ("SET inventory_snapshot_id = :list", {"list": uuid.UUID(other["snapshot_id"])}),
    ):
        await refused_by_the_database(
            w,
            f"UPDATE inventory_snapshot_row {statement} WHERE id = :row",
            "evidence of a stock list line never changes",
            row=row.id,
            **parameters,
        )
    # The answer beside it is what changes, as before.
    async with w.client() as client:
        answered = await resolve(client, view["snapshot_id"], 1, skip_reason="не товар")
    assert answered.status_code == 200, answered.text


async def test_a_part_is_frozen_with_its_decided_list(world):
    w = world
    async with w.client() as client:
        applied = await prepared(client, w)
        assert (await approve(client, applied["snapshot_id"], 3)).status_code == 200
        rejected = await imported(client, w)
        response = await client.post(
            f"/api/v1/snapshots/{rejected['snapshot_id']}/reject", json={"reason": "дубль"}
        )
        assert response.status_code == 200, response.text

    for statement, snapshot, extra in (
        (
            "UPDATE inventory_snapshot_part SET source = 'x' WHERE inventory_snapshot_id = :id",
            applied,
            {},
        ),
        (
            "UPDATE inventory_snapshot_part SET removed_at = now(), removed_by_user_id = :user "
            "WHERE inventory_snapshot_id = :id",
            rejected,
            {"user": w.users["owner"]},
        ),
        (
            "INSERT INTO inventory_snapshot_part (id, organization_id, inventory_snapshot_id, "
            "part_no, command_id, kind, line_count, first_line_no, last_line_no) "
            "VALUES (gen_random_uuid(), :org, :id, 2, gen_random_uuid(), 'PASTED', 1, 4, 4)",
            applied,
            {"org": w.org},
        ),
    ):
        await refused_by_the_database(
            w,
            statement,
            "can no longer change",
            id=uuid.UUID(snapshot["snapshot_id"]),
            **extra,
        )
    await refused_by_the_database(
        w,
        "DELETE FROM inventory_snapshot_part WHERE inventory_snapshot_id = :id",
        "never deleted",
        id=uuid.UUID(applied["snapshot_id"]),
    )


# ---------------------------------------------------------------------------
# What a file line says about its count
# ---------------------------------------------------------------------------


async def test_a_count_stated_with_its_unit_and_agreed_by_the_file_is_stated(world):
    w = world
    async with w.client() as client:
        view = await created_from_file(
            client, w, stock_file(file_line("Мышка чорний M 2 шт", sizes=["M"], count=2))
        )
        [line] = await lines_of(client, view["snapshot_id"])
        stated = await resolve(
            client,
            view["snapshot_id"],
            1,
            allocations=[allocation(w.bomber, w.sizes["M"], 2)],
            quantity_basis="STATED",
        )

    assert (line["quantity_state"], line["quantity_total"], line["file_reasons"]) == (
        "KNOWN",
        2,
        [],
    )
    assert stated.status_code == 200, stated.text
    assert stated.json()["snapshot"]["summary"]["lines_by_basis"]["STATED"] == 1


async def test_a_number_the_parser_calls_the_count_needs_a_note(world):
    """«Бомбер M 3 1200», the parser reading 3 as the count (owner,
    2026-10-08): a hint shown to the person, who states the count in a note."""
    w = world
    file = stock_file(
        file_line("Бомбер M 3 1200", sizes=["M"], count=3, price="1200"),
        file_line("Бомбер шоколад", photo_line=2, count=1),
    )
    three = [allocation(w.bomber, w.sizes["M"], 3)]
    async with w.client() as client:
        view = await created_from_file(client, w, file)
        snapshot_id = view["snapshot_id"]
        hint, counted = await lines_of(client, snapshot_id)
        refused = [
            await resolve(client, snapshot_id, 1, allocations=three, quantity_basis="STATED"),
            await resolve(
                client, snapshot_id, 1, allocations=three, quantity_basis="STATED_BY_SIZE"
            ),
            await resolve(
                client, snapshot_id, 1, allocations=three, quantity_basis="OWNER_KNOWLEDGE"
            ),
            await resolve(
                client,
                snapshot_id,
                1,
                allocations=[allocation(w.bomber, w.sizes["M"], 1)],
                quantity_basis="LINE_IMPLIES_ONE",
            ),
            # A line the parser counted is never one piece in one tap.
            await resolve(
                client,
                snapshot_id,
                2,
                allocations=[allocation(w.bomber, w.sizes["M"], 1)],
                quantity_basis="LINE_IMPLIES_ONE",
            ),
        ]
        noted = await resolve(
            client,
            snapshot_id,
            1,
            allocations=three,
            quantity_basis="OWNER_KNOWLEDGE",
            note="на фото 3 шт, Оля перелічила",
        )

    assert (hint["quantity_state"], hint["quantity_total"]) == ("UNKNOWN_QUANTITY", None)
    assert (hint["file_reasons"], hint["reading"]["count"]) == (["FILE_COUNT_HINT"], 3)
    assert (hint["may_imply_one"], counted["may_imply_one"]) == (False, False)
    assert counted["file_reasons"] == ["FILE_COUNT_HINT"]
    for response in refused:
        assert (response.status_code, response.json()["code"]) == (422, "VALIDATION_ERROR")
    assert noted.status_code == 200, noted.text
    assert noted.json()["snapshot"]["review_revision"] == 1


async def test_a_split_the_text_shows_is_stated_by_size_in_one_answer(world):
    w = world
    file = stock_file(
        file_line("Лоран шоколад M-1 L-2", size_counts=counts(("M", 1), ("L", 2))),
        # One size with its count is the same case (owner, 2026-10-08).
        file_line("Лоран шоколад M-3", photo_line=2, size_counts=counts(("M", 3))),
    )
    async with w.client() as client:
        view = await created_from_file(client, w, file)
        snapshot_id = view["snapshot_id"]
        two, one = await lines_of(client, snapshot_id)
        first = await resolve(
            client,
            snapshot_id,
            1,
            allocations=by_size(w, ("L", 2), ("M", 1)),
            quantity_basis="STATED_BY_SIZE",
        )
        second = await resolve(
            client,
            snapshot_id,
            2,
            allocations=by_size(w, ("M", 3)),
            quantity_basis="STATED_BY_SIZE",
        )

    assert (two["quantity_state"], two["quantity_total"]) == ("UNKNOWN_DISTRIBUTION", 3)
    assert (one["quantity_state"], one["quantity_total"]) == ("UNKNOWN_QUANTITY", None)
    assert one["shown_split"] == [{"size": "M", "count": 3, "size_id": str(w.sizes["M"])}]
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    line = first.json()["line"]
    assert (line["status"], line["quantity_basis"], line["resolution_note"]) == (
        "RESOLVED",
        "STATED_BY_SIZE",
        None,
    )
    assert sorted((a["size_code"], a["quantity"]) for a in line["allocations"]) == [
        ("L", 2),
        ("M", 1),
    ]
    summary = second.json()["snapshot"]["summary"]
    assert summary["lines_by_basis"]["STATED_BY_SIZE"] == 2
    assert summary["units_by_basis"]["STATED_BY_SIZE"] == 6
    assert summary["lines_differing_from_source"] == 0


async def test_a_split_stated_by_size_must_match_the_line(world):
    w = world
    file = stock_file(file_line("Лоран шоколад M-1 L-2", size_counts=counts(("M", 1), ("L", 2))))
    async with w.client() as client:
        view = await created_from_file(client, w, file)
        snapshot_id = view["snapshot_id"]
        await added(await add_lines(client, snapshot_id, ["Лоран шоколад M-1 L-2"]))
        refused = [
            await resolve(
                client, snapshot_id, 1, allocations=answer, quantity_basis="STATED_BY_SIZE"
            )
            for answer in (
                by_size(w, ("M", 2), ("L", 2)),
                by_size(w, ("M", 1)),
                by_size(w, ("M", 1), ("L", 2), ("S", 1)),
                by_size(w, ("S", 1), ("L", 2)),
                [allocation(w.coat, w.sizes["M"], 1), allocation(w.bomber, w.sizes["L"], 2)],
                [allocation(w.coat, None, 3)],
                by_size(w, ("M", 3)),
            )
        ]
        # A typed line shows no split, whatever its text.
        typed = await resolve(
            client,
            snapshot_id,
            2,
            allocations=by_size(w, ("M", 1), ("L", 2)),
            quantity_basis="STATED_BY_SIZE",
        )
        after = await view_of(client, snapshot_id)

    for response in [*refused, typed]:
        assert (response.status_code, response.json()["code"]) == (422, "VALIDATION_ERROR")
    assert (after["review_revision"], after["summary"]["resolved"]) == (1, 0)


async def test_a_split_whose_size_the_catalogue_lacks_needs_a_note(world):
    w = world
    file = stock_file(file_line("Парка 46-1 48-2", size_counts=counts(("46", 1), ("48", 2))))
    async with w.client() as client:
        view = await created_from_file(client, w, file)
        snapshot_id = view["snapshot_id"]
        [line] = await lines_of(client, snapshot_id)
        tapped = await resolve(
            client,
            snapshot_id,
            1,
            allocations=by_size(w, ("M", 1), ("L", 2)),
            quantity_basis="STATED_BY_SIZE",
        )
        parka = await client.post(
            "/api/v1/catalog/products",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json={
                "store_id": str(w.main),
                "concept": "Парка",
                "sizes": [{"system": "NUMERIC_EU", "code": code} for code in ("46", "48")],
            },
        )
        assert parka.status_code == 201, parka.text
        variant = uuid.UUID(parka.json()["product_variant_id"])
        sizes = {size["code"]: uuid.UUID(size["size_id"]) for size in parka.json()["sizes"]}
        [now] = await lines_of(client, snapshot_id)
        by_tap = await resolve(
            client,
            snapshot_id,
            1,
            allocations=[allocation(variant, sizes["46"], 1), allocation(variant, sizes["48"], 2)],
            quantity_basis="STATED_BY_SIZE",
        )

    assert line["shown_split"] == [
        {"size": "46", "count": 1, "size_id": None},
        {"size": "48", "count": 2, "size_id": None},
    ]
    assert (tapped.status_code, tapped.json()["details"]["size"]) == (422, "46")
    assert now["shown_split"] == [
        {"size": "46", "count": 1, "size_id": str(sizes["46"])},
        {"size": "48", "count": 2, "size_id": str(sizes["48"])},
    ]
    assert by_tap.status_code == 200, by_tap.text


async def test_the_approval_counts_what_rests_on_a_split_the_text_shows(world):
    w = world
    file = stock_file(
        file_line("Лоран шоколад M-1 L-2", size_counts=counts(("M", 1), ("L", 2))),
        file_line("Мышка чорний M 2 шт", photo_line=2, count=2),
    )
    async with w.client() as client:
        view = await created_from_file(client, w, file)
        snapshot_id = view["snapshot_id"]
        for line_no, body in (
            (
                1,
                {"allocations": by_size(w, ("M", 1), ("L", 2)), "quantity_basis": "STATED_BY_SIZE"},
            ),
            (
                2,
                {
                    "allocations": [allocation(w.bomber, w.sizes["M"], 2)],
                    "quantity_basis": "STATED",
                },
            ),
        ):
            assert (await resolve(client, snapshot_id, line_no, **body)).status_code == 200
        response = await approve(client, snapshot_id, 2)

    assert response.status_code == 200, response.text
    summary = response.json()["summary"]
    expected_lines = {"STATED": 1, "LINE_IMPLIES_ONE": 0, "RECOUNTED": 0, "OWNER_KNOWLEDGE": 0}
    assert summary["lines_by_basis"] == {**expected_lines, "STATED_BY_SIZE": 1}
    assert summary["units_by_basis"]["STATED_BY_SIZE"] == 3
    [entry] = await audit_of(w, "snapshot.applied")
    assert entry.after["lines_by_basis"]["STATED_BY_SIZE"] == 1
    assert entry.after["units_by_basis"]["STATED_BY_SIZE"] == 3
    assert await stock(w) == {
        (w.coat, w.sizes["M"]): 1,
        (w.coat, w.sizes["L"]): 2,
        (w.bomber, w.sizes["M"]): 2,
    }


# ---------------------------------------------------------------------------
# Limits, and a file's 422
# ---------------------------------------------------------------------------


async def test_a_list_is_bounded_in_lines_rows_and_parts(world, monkeypatch):
    monkeypatch.setattr(snapshot_service, "MAX_LIST_LINES", 4)
    monkeypatch.setattr(snapshot_service, "MAX_LIST_ROWS", 6)
    monkeypatch.setattr(snapshot_service, "MAX_LIST_PARTS", 3)
    w = world
    async with w.client() as client:
        view = await imported(client, w, ["Куртки", "Шуби"])
        snapshot_id = view["snapshot_id"]
        second = await added(await add_lines(client, snapshot_id, ["Шуба 1", "Шуба 2"]))
        over_lines = await add_lines(client, snapshot_id, ["Шуба 3"])
        assert (await remove(client, snapshot_id, second["part_id"])).status_code == 200
        third = await added(await add_lines(client, snapshot_id, ["Шуба 3", "Шуба 4"]))
        assert (await remove(client, snapshot_id, third["part_id"])).status_code == 200
        # Two lines count now, but six rows were added: line numbers are bounded.
        over_rows = await add_lines(client, snapshot_id, ["Шуба 5"])
        monkeypatch.setattr(snapshot_service, "MAX_LIST_ROWS", 100)
        over_parts = await add_lines(client, snapshot_id, ["Шуба 5"])

    assert conflict(over_lines, "LIST_FULL") == {
        "reason": "LIST_FULL",
        "what": "lines",
        "limit": 4,
        "now": 4,
        "adding": 1,
    }
    assert conflict(over_rows, "LIST_FULL") == {
        "reason": "LIST_FULL",
        "what": "rows",
        "limit": 6,
        "now": 6,
        "adding": 1,
    }
    assert conflict(over_parts, "LIST_FULL") == {
        "reason": "LIST_FULL",
        "what": "parts",
        "limit": 3,
        "now": 3,
        "adding": 1,
    }


async def test_a_file_error_names_its_line_and_never_echoes_the_file(world):
    w = world
    secret = "Записано-лише-у-файлі-7731"
    bad = stock_file(
        file_line(f"{secret} M-1"),
        file_line(f"{secret}\nдругий рядок", photo_line=2),
        file_line(secret, photo_line=3, sizes=["M"], size_counts=counts(("M", 1))),
    )
    repeated = stock_file(file_line(secret), file_line(secret, photo_line=1))
    async with w.client() as client:
        created = await from_file(client, w, bad)
        view = await imported(client, w)
        adding = await add_file(client, view["snapshot_id"], bad)
        twice = await from_file(client, w, repeated)
        elsewhere = await client.post(
            "/api/v1/snapshots", json={**import_body(w, LIST), "command_id": secret}
        )

    for response in (created, adding):
        assert response.status_code == 422, response.text
        assert secret not in response.text
        detail = response.json()["detail"]
        assert [(error["type"], error["loc"], error["ctx"]["line"]) for error in detail] == [
            ("stock_file_control_character", ["body", "file", "lines", 1, "text"], 2),
            ("stock_file_sizes_and_size_counts", ["body", "file", "lines", 2], 3),
        ]
        for error in detail:
            assert "input" not in error and "url" not in error
    assert secret not in twice.text
    [error] = twice.json()["detail"]
    assert (error["type"], error["loc"], error["ctx"]) == (
        "stock_file_photo_line_repeated",
        ["body", "file", "lines", 1, "photo_line"],
        {"line": 2, "first_line": 1},
    )
    # Nothing else changes its shape: a refusal outside a file still says
    # what it refused.
    assert elsewhere.status_code == 422
    assert elsewhere.json()["detail"][0]["input"] == secret


# ---------------------------------------------------------------------------
# Rights, and a shared warehouse's list
# ---------------------------------------------------------------------------


async def test_only_importers_add_and_remove_files(world):
    w = world
    async with w.client() as client:
        view = await created_from_file(client, w)
        part = await added(await add_file(client, view["snapshot_id"]))
    async with w.client("seller") as client:
        seller_adds = await add_lines(client, view["snapshot_id"], ["Шуба"])
        seller_removes = await remove(client, view["snapshot_id"], part["part_id"])
        seller_reads = await client.get(f"/api/v1/snapshots/{view['snapshot_id']}/parts")
    async with w.client("manager") as client:
        manager_adds = await add_lines(client, view["snapshot_id"], ["Шуба"])
        manager_removes = await remove(client, view["snapshot_id"], part["part_id"])

    for refused in (seller_adds, seller_removes, seller_reads):
        assert (refused.status_code, refused.json()["code"]) == (403, "PERMISSION_DENIED")
    assert manager_adds.status_code == 201, manager_adds.text
    assert manager_removes.status_code == 200, manager_removes.text


async def test_a_shared_warehouse_s_list_is_seen_and_filled_from_either_store(world):
    """Owner, 2026-10-08: the managers of either store who may import lists
    see the shared warehouse's list, add files to it and review it."""
    w = world
    async with w.client("manager") as client:
        view = await created_from_file(client, w)
        snapshot_id = view["snapshot_id"]
    async with w.client("child_manager") as client:
        own_store_only = await client.get(f"/api/v1/snapshots/{snapshot_id}")
        seen = await view_of(client, snapshot_id, store=w.second)
        part = await added(await add_file(client, snapshot_id, store=w.second))
        answered = await resolve_through(
            client, snapshot_id, 4, w.second, skip_reason="не товар, перевірила Ніна"
        )
        listed = await client.get("/api/v1/snapshots", params={"store_id": str(w.second)})
        items = await lines_of(client, snapshot_id, store=w.second)
        removed = await remove(client, snapshot_id, part["part_id"], store=w.second)

    assert (own_store_only.status_code, own_store_only.json()["code"]) == (403, "FORBIDDEN_STORE")
    assert (seen["store_id"], seen["store_name"]) == (str(w.main), await store_name(w, w.main))
    assert part["added_by_user_id"] == str(w.users["child_manager"])
    assert answered.status_code == 200, answered.text
    assert [item["snapshot_id"] for item in listed.json()["items"]] == [snapshot_id]
    assert len(items) == 5
    assert removed.status_code == 200, removed.text
    async with w.maker() as session:
        # The list stays its own store's; the evidence names the store it
        # was added through.
        listed_row = await session.get(InventorySnapshot, uuid.UUID(snapshot_id))
        assert listed_row is not None and listed_row.acting_store_id == w.main
        stores = set(
            await session.scalars(
                select(RawInput.store_id).where(
                    RawInput.source_ref.in_(
                        [f"inventory_snapshot:{snapshot_id}:{n}" for n in (4, 5)]
                    )
                )
            )
        )
        assert stores == {w.second}


async def resolve_through(
    client: httpx.AsyncClient, snapshot_id: str, line_no: int, store: uuid.UUID, **body: Any
) -> httpx.Response:
    return await client.put(
        f"/api/v1/snapshots/{snapshot_id}/lines/{line_no}", params=through(store), json=body
    )


async def test_a_store_that_may_only_sell_there_does_not_see_the_list(world):
    w = world
    async with w.client("manager") as client:
        view = await created_from_file(client, w)
    async with w.maker.begin() as session:
        await session.execute(
            update(StoreLocationAccess)
            .where(
                StoreLocationAccess.store_id == w.second,
                StoreLocationAccess.location_id == w.shared,
            )
            .values(can_receive=False)
        )
    async with w.client("child_manager") as client:
        read = await client.get(
            f"/api/v1/snapshots/{view['snapshot_id']}", params={"store_id": str(w.second)}
        )
        adding = await add_file(client, view["snapshot_id"], store=w.second)
        listed = await client.get("/api/v1/snapshots", params={"store_id": str(w.second)})

    for refused in (read, adding):
        assert (refused.status_code, refused.json()["code"]) == (403, "LOCATION_ACCESS_DENIED")
    assert listed.json()["items"] == []


async def test_a_private_warehouse_s_list_stays_with_its_own_store(world):
    w = world
    async with w.client("child_manager") as client:
        view = await created_from_file(client, w, store=w.second, location=w.private)
        own = await view_of(client, view["snapshot_id"])
    async with w.client("manager") as client:
        through_main = await client.get(
            f"/api/v1/snapshots/{view['snapshot_id']}", params={"store_id": str(w.main)}
        )
        adding = await add_file(client, view["snapshot_id"], store=w.main)
    async with w.client() as client:
        listed = await client.get("/api/v1/snapshots", params={"store_id": str(w.main)})
        owner_through_main = await client.get(
            f"/api/v1/snapshots/{view['snapshot_id']}", params={"store_id": str(w.main)}
        )

    assert own["snapshot_id"] == view["snapshot_id"]
    for refused in (through_main, adding, owner_through_main):
        assert (refused.status_code, refused.json()["code"]) == (403, "LOCATION_ACCESS_DENIED")
    assert listed.json()["items"] == []


async def test_the_owner_approves_a_shared_list_from_either_store_and_the_movements_name_the_list_s_store(  # noqa: E501
    world,
):
    w = world
    async with w.client("child_manager") as client:
        view = await prepared(client, w, store=w.second)
    async with w.client() as client:
        response = await client.post(
            f"/api/v1/snapshots/{view['snapshot_id']}/approve",
            params={"store_id": str(w.main)},
            json={"expected_review_revision": 3},
        )

    assert response.status_code == 200, response.text
    assert response.json()["store_id"] == str(w.second)
    ledger = await movements(w)
    assert len(ledger) == 4
    # The opening movements act through the list's own store (ADR-0005 §4).
    assert {movement.acting_store_id for movement in ledger} == {w.second}
    [entry] = await audit_of(w, "snapshot.applied")
    assert entry.after["via_store_id"] == str(w.main)


async def test_the_lists_waiting_at_a_warehouse_are_named_to_either_store(world):
    w = world
    async with w.client("manager") as client:
        view = await created_from_file(client, w)
    async with w.client("child_manager") as client:
        private = await created_from_file(client, w, store=w.second, location=w.private)
        waiting = await client.get(
            "/api/v1/snapshots",
            params={"store_id": str(w.second), "location_id": str(w.shared), "status": "IN_REVIEW"},
        )
        elsewhere = await client.get(
            "/api/v1/snapshots",
            params={"store_id": str(w.second), "location_id": str(w.private)},
        )
    async with w.client() as client:
        from_main = await client.get(
            "/api/v1/snapshots", params={"store_id": str(w.main), "location_id": str(w.shared)}
        )

    [item] = waiting.json()["items"]
    assert (item["snapshot_id"], item["store_id"]) == (view["snapshot_id"], str(w.main))
    assert item["store_name"] == await store_name(w, w.main)
    assert [i["snapshot_id"] for i in elsewhere.json()["items"]] == [private["snapshot_id"]]
    assert [i["snapshot_id"] for i in from_main.json()["items"]] == [view["snapshot_id"]]


async def test_who_added_and_who_removed_a_file_are_named(world):
    w = world
    async with w.client("manager") as client:
        view = await created_from_file(client, w)
        part = await added(await add_file(client, view["snapshot_id"]))
    async with w.client("child_manager") as client:
        removed = await remove(client, view["snapshot_id"], part["part_id"], store=w.second)
        parts = await parts_of(client, view["snapshot_id"], store=w.second)

    assert removed.status_code == 200, removed.text
    assert [(p["added_by_name"], p["removed_by_name"]) for p in parts] == [
        ("manager", None),
        ("manager", "child_manager"),
    ]
    assert parts[1]["removed_by_user_id"] == str(w.users["child_manager"])
    async with w.maker() as session:
        name = await session.scalar(
            select(AppUser.display_name).where(AppUser.id == w.users["child_manager"])
        )
    assert name == "child_manager"


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def test_repeats_and_same_photo_lines_count_only_live_lines_across_files(world):
    w = world
    first = stock_file(
        file_line("Бомбер шоколад накладной карман", photo_line=1),
        file_line("Куртки", photo_line=2),
    )
    second = stock_file(
        file_line("Бомбер шоколад накладной карман", photo_line=1),
        file_line("Шуба орех 70 см", photo="IMG_0002.jpg", photo_line=1),
    )
    async with w.client() as client:
        view = await created_from_file(client, w, first)
        snapshot_id = view["snapshot_id"]
        part = await added(await add_file(client, snapshot_id, second))
        before = await lines_of(client, snapshot_id)
        paged = await lines_of(client, snapshot_id, limit=1, offset=2)
        assert (await remove(client, snapshot_id, part["part_id"])).status_code == 200
        after = await lines_of(client, snapshot_id)
        removed = await lines_of(client, snapshot_id, part_id=part["part_id"])

    assert [(i["same_text_lines"], i["same_photo_lines"]) for i in before] == [
        (2, 2),
        (1, 1),
        (2, 2),
        (1, 1),
    ]
    # Counted across the whole list, not just the page it appears on.
    assert [(i["line_no"], i["same_text_lines"]) for i in paged] == [(3, 2)]
    assert [(i["same_text_lines"], i["same_photo_lines"]) for i in after] == [(1, 1), (1, 1)]
    # A removed line is compared with the lines that count.
    assert [(i["same_text_lines"], i["same_photo_lines"]) for i in removed] == [(1, 1), (0, 0)]


async def test_what_a_list_became_is_read_by_pages(world):
    w = world
    async with w.client() as client:
        waiting = await imported(client, w)
        nothing = await client.get(f"/api/v1/snapshots/{waiting['snapshot_id']}/application")
        view = await prepared(client, w)
        approved = await approve(client, view["snapshot_id"], 3)
        pages = [
            await client.get(
                f"/api/v1/snapshots/{view['snapshot_id']}/application",
                params={"limit": 3, "offset": offset},
            )
            for offset in (0, 3)
        ]
        everything = await client.get(f"/api/v1/snapshots/{view['snapshot_id']}/application")
        too_long = await client.get(
            f"/api/v1/snapshots/{view['snapshot_id']}/application", params={"limit": 501}
        )
        read = await view_of(client, view["snapshot_id"])

    assert nothing.json() == {"items": [], "has_more": False}
    assert approved.status_code == 200, approved.text
    assert [page.json()["has_more"] for page in pages] == [True, False]
    assert [len(page.json()["items"]) for page in pages] == [3, 1]
    lines = [item for page in pages for item in page.json()["items"]]
    assert lines == everything.json()["items"]
    assert [line["line_no"] for line in lines] == [1, 1, 1, 2]
    assert {line["movement_id"] for line in lines} == {str(m.id) for m in await movements(w)}
    assert all(line["stock_lot_id"] for line in lines)
    assert read["application"] == {"units": 5, "allocations": 4}
    assert too_long.status_code == 422
