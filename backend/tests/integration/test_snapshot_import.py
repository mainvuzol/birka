"""A legacy stock list becomes stock only through a person's review and an approval.

M1-023, ADR-0005. These tests run the whole workflow over HTTP against real
PostgreSQL. Each name states the property it pins:

- **Evidence.** Every line is kept verbatim. Import writes no identity, no match
  decision and no stock.
- **Answers.** A person says what a line means, and where its numbers came
  from. Nothing is inferred.
- **Approval.** It writes `OPENING_BALANCE` and nothing else (invariant I17).
  It opens a warehouse's ledger once, and never beside history. It is all or
  nothing, and replays exactly.
- **Guards added with it.** An opening balance cannot be written outside a
  list. A decided list is frozen. «Фізично є» cannot count "size not known"
  stock a second time.
- **Size clarified at the counter.** A seller holding a coat a list loaded as
  "size not known" says which size it is, and it is sold as that size: an
  audited, bounded pair of movements (owner decision, 2026-09-29).
- **Races.** The ones the design review raised, proven with `pg_locks` rather
  than timing.
- **Access.** Who may import, review, approve and read, at shared and private
  warehouses, and across tenants.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from decimal import Decimal

import httpx
import pytest
from scripts.seed_organization import seed_in_session
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.core.errors import ValidationFailedError
from app.main import create_app
from app.modules.audit.models import AuditLog
from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.authz.service import resolve_scope
from app.modules.catalog.evidence import (
    CatalogMatchDecision,
    ParseResult,
    ProcessingStatus,
    RawInput,
    RawInputProcessing,
    RawInputSource,
)
from app.modules.catalog.models import (
    EntityStatus,
    ProductVariant,
    Size,
    SizeSystem,
    SizeSystemCode,
)
from app.modules.identity.models import AppUser
from app.modules.inventory.models import (
    AcquisitionType,
    Inventory,
    MovementReason,
    MovementType,
    OpeningListHold,
    StockLot,
    StockMovement,
)
from app.modules.inventory.service import (
    OPENING_BALANCE_REFERENCE,
    MovementRequest,
    ReservationRequest,
    apply_movements,
    find_divergences,
    release_stock,
    reserve_stock,
    validate_movement,
)
from app.modules.sales.models import Sale
from app.modules.snapshots import service as snapshot_service
from app.modules.snapshots.models import (
    InventorySnapshot,
    InventorySnapshotAllocation,
    InventorySnapshotRow,
    SnapshotQuantityState,
    SnapshotRowStatus,
    SnapshotStatus,
)
from app.modules.snapshots.service import approve_snapshot
from app.modules.tenancy.models import StockLocation, Store, StoreLocationAccess
from tests.conftest import requires_database

pytestmark = [pytest.mark.integration, requires_database()]

# The list most tests start from, and how a person answers it.
LIST = [
    "Лоран шоколад S M L",  # sizes listed, no count: a split somebody has to know
    "Мышка чорний М 2 шт",  # a stated count, taken as it is
    "Куртки",  # a heading, not stock
]


@asynccontextmanager
async def client_for(maker: async_sessionmaker, user_id: uuid.UUID):
    app = create_app(
        Settings(app_env="local", session_secret="snapshot-test-secret-at-least-32-bytes")
    )

    async def sessions():
        async with maker() as session:
            yield session

    async def scope():
        async with maker() as session:
            return await resolve_scope(session, user_id)

    app.dependency_overrides[get_current_scope] = scope
    app.dependency_overrides[session_dependency] = sessions
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


@dataclass
class World:
    engine: AsyncEngine
    maker: async_sessionmaker
    org: uuid.UUID
    main: uuid.UUID
    second: uuid.UUID
    shared: uuid.UUID
    private: uuid.UUID
    users: dict[str, uuid.UUID]
    coat: uuid.UUID
    bomber: uuid.UUID
    bottega: uuid.UUID
    sizes: dict[str, uuid.UUID]

    def client(self, user: str = "owner"):
        return client_for(self.maker, self.users[user])


def idempotent() -> dict[str, str]:
    return {"Idempotency-Key": str(uuid.uuid4())}


async def create_product(client, store_id, concept, color, sizes):
    response = await client.post(
        "/api/v1/catalog/products",
        headers=idempotent(),
        json={
            "store_id": str(store_id),
            "concept": concept,
            "variant": {"color": color},
            "sizes": [{"system": "ALPHA", "code": code} for code in sizes],
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return uuid.UUID(body["product_variant_id"]), {
        size["code"]: uuid.UUID(size["size_id"]) for size in body["sizes"]
    }


async def seed_world(maker: async_sessionmaker) -> dict:
    async with maker.begin() as session:
        telegram_id = uuid.uuid4().int % 2**62
        org = await seed_in_session(
            session,
            telegram_user_id=telegram_id,
            owner_name="Owner",
            org_name=f"snapshot-{uuid.uuid4()}",
            with_child_warehouse=True,
        )
        stores = {
            store.code: store.id
            for store in await session.scalars(select(Store).where(Store.organization_id == org))
        }
        roles = {
            role.code: role.id
            for role in await session.scalars(select(Role).where(Role.organization_id == org))
        }
        owner = await session.scalar(
            select(AppUser.id).where(AppUser.telegram_user_id == telegram_id)
        )
        locations = list(
            await session.scalars(select(StockLocation).where(StockLocation.organization_id == org))
        )
        users = {"owner": owner}
        for name, store, role in (
            ("manager", "MAIN", "MANAGER"),
            ("seller", "MAIN", "SELLER"),
            ("child_manager", "SECOND", "MANAGER"),
        ):
            user = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name=name)
            session.add(user)
            await session.flush()
            users[name] = user.id
            session.add(
                Membership(
                    user_id=user.id,
                    organization_id=org,
                    store_id=stores[store],
                    role_id=roles[role],
                )
            )
    return {
        "org": org,
        "main": stores["MAIN"],
        "second": stores["SECOND"],
        "shared": next(loc.id for loc in locations if loc.code == "BOOTSTRAP-SHARED"),
        "private": next(loc.id for loc in locations if loc.managing_store_id is not None),
        "users": users,
    }


@pytest.fixture
async def world():
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


def import_body(w: World, lines, *, command_id=None, store=None, location=None, **extra):
    return {
        "command_id": str(command_id or uuid.uuid4()),
        "store_id": str(store or w.main),
        "location_id": str(location or w.shared),
        "lines": lines,
        **extra,
    }


async def imported(client, w: World, lines=LIST, **kwargs) -> dict:
    response = await client.post("/api/v1/snapshots", json=import_body(w, lines, **kwargs))
    assert response.status_code == 201, response.text
    return response.json()


def allocation(variant, size=None, quantity=1) -> dict:
    body = {"product_variant_id": str(variant), "quantity": quantity}
    if size is None:
        body["size_unknown"] = True
    else:
        body["size_id"] = str(size)
    return body


async def resolve(client, snapshot_id, line_no, **body) -> httpx.Response:
    return await client.put(f"/api/v1/snapshots/{snapshot_id}/lines/{line_no}", json=body)


async def approve(client, snapshot_id, revision) -> httpx.Response:
    return await client.post(
        f"/api/v1/snapshots/{snapshot_id}/approve", json={"expected_review_revision": revision}
    )


async def answer_list(client, w: World, snapshot_id) -> dict:
    """The standard answers to `LIST`. Returns the list as it then stands."""
    first = await resolve(
        client,
        snapshot_id,
        1,
        allocations=[
            allocation(w.coat, w.sizes["S"]),
            allocation(w.coat, w.sizes["M"]),
            allocation(w.coat, w.sizes["L"]),
        ],
        quantity_basis="OWNER_KNOWLEDGE",
        note="у списку — по одній кожного розміру",
    )
    assert first.status_code == 200, first.text
    second = await resolve(
        client,
        snapshot_id,
        2,
        allocations=[allocation(w.bomber, w.sizes["M"], 2)],
        quantity_basis="STATED",
    )
    assert second.status_code == 200, second.text
    third = await resolve(client, snapshot_id, 3, skip_reason="заголовок розділу")
    assert third.status_code == 200, third.text
    return third.json()["snapshot"]


async def prepared(client, w: World, **kwargs) -> dict:
    """`LIST`, imported and fully answered: ready to approve at revision 3."""
    snapshot = await imported(client, w, **kwargs)
    view = await answer_list(client, w, snapshot["snapshot_id"])
    assert view["ready_to_approve"] is True
    assert view["review_revision"] == 3
    return view


async def stock(w: World, location=None) -> dict[tuple[uuid.UUID, uuid.UUID], int]:
    async with w.maker() as session:
        rows = await session.execute(
            select(Inventory.product_variant_id, Inventory.size_id, Inventory.quantity).where(
                Inventory.location_id == (location or w.shared), Inventory.quantity > 0
            )
        )
        return {(variant, size): quantity for variant, size, quantity in rows}


async def movements(w: World) -> list[StockMovement]:
    async with w.maker() as session:
        return list(
            await session.scalars(
                select(StockMovement).where(StockMovement.organization_id == w.org)
            )
        )


async def wait_until_blocked_by(engine: AsyncEngine, holder_pid: int) -> None:
    """Some backend is genuinely waiting on `holder_pid`'s locks — asked of
    `pg_locks`, which is read afresh by every query (see M1-018's tests)."""
    async with engine.connect() as observer:
        for _ in range(1000):
            blocked = await observer.scalar(
                text(
                    "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted"
                    " AND CAST(:holder AS integer) = ANY(pg_blocking_pids(pid)))"
                ),
                {"holder": holder_pid},
            )
            await observer.rollback()
            if blocked:
                return
            await asyncio.sleep(0.01)
    pytest.fail("nothing ever waited on the held transaction's locks")


async def receive(client, w: World, *, location=None, store=None, variant=None) -> httpx.Response:
    """One coat received through the API, into the shared warehouse unless
    told otherwise."""
    return await client.post(
        "/api/v1/inventory/receipts",
        headers=idempotent(),
        json={
            "store_id": str(store or w.main),
            "location_id": str(location or w.shared),
            "command_id": str(uuid.uuid4()),
            "lines": [
                {
                    "product_variant_id": str(variant or w.bottega),
                    "size_id": str(w.sizes["M"]),
                    "quantity": 1,
                }
            ],
        },
    )


def delivery(w: World, variant, size, quantity=1) -> MovementRequest:
    return MovementRequest(
        location_id=w.shared,
        acting_store_id=w.main,
        product_variant_id=variant,
        size_id=size,
        quantity_delta=quantity,
        movement_type=MovementType.DELIVERY,
    )


# ---------------------------------------------------------------------------
# Import: evidence, and nothing else
# ---------------------------------------------------------------------------


async def test_a_list_is_kept_line_by_line_and_nothing_becomes_stock(world):
    w = world
    lines = [
        "  Бомбер шоколад 3 шт",
        "Лама бежевая/персик/butter 3 шт",
        "Куртка 1636",
        "Куртки",
    ]
    async with w.client() as client:
        view = await imported(
            client,
            w,
            lines,
            source_document_ref="зошит, сторінка 4",
            captured_at="осінь 2025",
        )
        page = await client.get(f"/api/v1/snapshots/{view['snapshot_id']}/lines")

    assert view["status"] == "IN_REVIEW"
    assert view["review_revision"] == 0
    assert view["store_id"] == str(w.main)
    assert view["location_id"] == str(w.shared)
    assert view["captured_at"] == "осінь 2025"
    assert view["summary"]["lines"] == 4
    assert view["ready_to_approve"] is False

    items = page.json()["items"]
    # Verbatim — leading spaces and all — beside what the parser read of it.
    assert [item["raw_text"] for item in items] == lines
    assert [(item["quantity_state"], item["quantity_total"]) for item in items] == [
        ("KNOWN", 3),
        ("UNKNOWN_DISTRIBUTION", 3),
        ("UNKNOWN_QUANTITY", None),
        ("UNKNOWN_QUANTITY", None),
    ]
    assert [item["status"] for item in items] == [
        "PENDING",
        "NEEDS_REVIEW",
        "NEEDS_REVIEW",
        "PENDING",
    ]
    assert "UNKNOWN_DISTRIBUTION" in items[1]["review_reasons"]
    # The rare item code stays an unclassified descriptor, never a quantity.
    assert "1636" in items[2]["unclassified"]

    snapshot_id = uuid.UUID(view["snapshot_id"])
    async with w.maker() as session:
        raws = list(
            await session.scalars(
                select(RawInput)
                .where(RawInput.organization_id == w.org, RawInput.store_id == w.main)
                .where(RawInput.source_kind == RawInputSource.SNAPSHOT_IMPORT)
            )
        )
        assert sorted(raw.raw_text for raw in raws) == sorted(lines)
        assert {raw.source_ref for raw in raws} == {
            f"inventory_snapshot:{snapshot_id}:{n}" for n in range(1, 5)
        }
        assert {raw.created_by_user_id for raw in raws} == {w.users["owner"]}
        processing = await session.scalars(
            select(RawInputProcessing.status).where(
                RawInputProcessing.raw_input_id.in_([raw.id for raw in raws])
            )
        )
        assert set(processing) == {ProcessingStatus.PARSED}
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ParseResult)
                .where(ParseResult.raw_input_id.in_([raw.id for raw in raws]))
            )
            == 4
        )
        # No matching, no decision, no identity, no stock.
        assert not await session.scalar(
            select(func.count())
            .select_from(CatalogMatchDecision)
            .where(CatalogMatchDecision.organization_id == w.org)
        )
        assert not await session.scalar(
            select(func.count())
            .select_from(StockLot)
            .where(StockLot.inventory_snapshot_id == snapshot_id)
        )
        audit = list(
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.organization_id == w.org, AuditLog.action == "snapshot.imported"
                )
            )
        )
        assert len(audit) == 1 and audit[0].entity_id == snapshot_id
    assert not await movements(w)


async def test_the_same_import_twice_is_one_list(world):
    w = world
    body = import_body(w, LIST)
    async with w.client() as client:
        first = await client.post("/api/v1/snapshots", json=body)
        again = await client.post("/api/v1/snapshots", json=body)

    assert first.status_code == 201, first.text
    assert again.status_code == 200, again.text
    assert again.json()["snapshot_id"] == first.json()["snapshot_id"]
    assert first.json()["command_id"] == body["command_id"]
    async with w.maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(RawInput)
                .where(
                    RawInput.organization_id == w.org,
                    RawInput.source_kind == RawInputSource.SNAPSHOT_IMPORT,
                )
            )
            == 3
        )


async def test_the_same_command_for_another_list_is_a_conflict(world):
    w = world
    body = import_body(w, LIST)
    other = await seed_world(w.maker)
    async with w.client() as client:
        first = await client.post("/api/v1/snapshots", json=body)
        changed = await client.post(
            "/api/v1/snapshots", json={**body, "lines": [*LIST, "Шуба орех 70 см"]}
        )
    # Another organization's command ids are its own: the same one is simply
    # another list there, and says nothing about this one.
    async with client_for(w.maker, other["users"]["owner"]) as client:
        foreign = await client.post(
            "/api/v1/snapshots",
            json={
                **body,
                "store_id": str(other["main"]),
                "location_id": str(other["shared"]),
            },
        )

    assert first.status_code == 201, first.text
    assert (changed.status_code, changed.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    assert foreign.status_code == 201, foreign.text
    assert foreign.json()["command_id"] == first.json()["command_id"]
    assert foreign.json()["snapshot_id"] != first.json()["snapshot_id"]


async def test_two_organizations_importing_one_command_at_once_never_collide(world):
    """Two organizations, one command id, at the same moment: two lists. The
    retry lock is scoped like the unique key, so neither waits on the other
    and neither loses to a unique violation."""
    w = world
    other = await seed_world(w.maker)
    body = import_body(w, LIST)
    theirs = {**body, "store_id": str(other["main"]), "location_id": str(other["shared"])}
    async with w.client() as mine, client_for(w.maker, other["users"]["owner"]) as foreign:
        results = await asyncio.gather(
            mine.post("/api/v1/snapshots", json=body),
            foreign.post("/api/v1/snapshots", json=theirs),
        )

    assert [result.status_code for result in results] == [201, 201], [r.text for r in results]
    assert results[0].json()["snapshot_id"] != results[1].json()["snapshot_id"]


async def test_two_deliveries_of_one_import_at_once_make_one_list(world):
    w = world
    body = import_body(w, LIST)
    async with w.client() as first, w.client() as second:
        results = await asyncio.gather(
            first.post("/api/v1/snapshots", json=body),
            second.post("/api/v1/snapshots", json=body),
        )

    assert sorted(result.status_code for result in results) == [200, 201]
    assert results[0].json()["snapshot_id"] == results[1].json()["snapshot_id"]
    snapshot_id = uuid.UUID(results[0].json()["snapshot_id"])
    async with w.maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(InventorySnapshotRow)
                .where(InventorySnapshotRow.inventory_snapshot_id == snapshot_id)
            )
            == 3
        )


async def test_a_blank_line_is_refused_with_its_number_and_nothing_is_kept(world):
    w = world
    async with w.client() as client:
        response = await client.post(
            "/api/v1/snapshots", json=import_body(w, ["Куртка 1636", "   \t"])
        )

    assert response.status_code == 422, response.text
    assert response.json()["details"]["line_no"] == 2
    async with w.maker() as session:
        assert not await session.scalar(
            select(func.count())
            .select_from(InventorySnapshot)
            .where(InventorySnapshot.organization_id == w.org)
        )


async def test_only_someone_allowed_to_import_here_can(world):
    w = world
    other = await seed_world(w.maker)
    async with w.client("seller") as client:
        seller = await client.post("/api/v1/snapshots", json=import_body(w, LIST))
    async with w.client() as client:
        foreign = await client.post(
            "/api/v1/snapshots", json=import_body(w, LIST, location=other["shared"])
        )
    async with w.maker.begin() as session:
        await session.execute(
            update(StoreLocationAccess)
            .where(
                StoreLocationAccess.store_id == w.main,
                StoreLocationAccess.location_id == w.shared,
            )
            .values(can_receive=False)
        )
    async with w.client("manager") as client:
        no_receiving = await client.post("/api/v1/snapshots", json=import_body(w, LIST))
    async with w.maker.begin() as session:
        await session.execute(
            update(StockLocation).where(StockLocation.id == w.shared).values(is_active=False)
        )
    async with w.client() as client:
        paused = await client.post("/api/v1/snapshots", json=import_body(w, LIST, store=w.second))

    assert (seller.status_code, seller.json()["code"]) == (403, "PERMISSION_DENIED")
    # Another organization's warehouse is exactly as unknown as no warehouse.
    assert (foreign.status_code, foreign.json()["code"]) == (404, "NOT_FOUND")
    assert (no_receiving.status_code, no_receiving.json()["code"]) == (
        403,
        "LOCATION_ACCESS_DENIED",
    )
    # A paused warehouse takes no list: pausing stops everything that leads
    # to stock (owner decision, 2026-09-22).
    assert (paused.status_code, paused.json()["code"]) == (404, "NOT_FOUND")


async def test_a_private_warehouse_takes_a_list_only_from_its_own_store(world):
    """And only the child store's own owner approves it (owner decision, 2026-09-29).

    The private rule wants every operation granted directly in the managing
    store. The organization-wide owner's grant is not that, and the child
    store's manager does not hold `snapshot:approve`. Who does is in
    `test_the_child_store_s_own_owner_approves_its_private_warehouse`.
    """
    w = world
    async with w.client() as client:
        by_owner = await client.post(
            "/api/v1/snapshots", json=import_body(w, LIST, store=w.second, location=w.private)
        )
    async with w.client("child_manager") as client:
        by_child = await client.post(
            "/api/v1/snapshots", json=import_body(w, LIST, store=w.second, location=w.private)
        )
        assert by_child.status_code == 201, by_child.text
        snapshot_id = by_child.json()["snapshot_id"]
        view = await answer_list(client, w, snapshot_id)
        child_approves = await approve(client, snapshot_id, view["review_revision"])
    async with w.client() as client:
        owner_approves = await approve(client, snapshot_id, view["review_revision"])

    assert (by_owner.status_code, by_owner.json()["code"]) == (403, "PERMISSION_DENIED")
    assert (child_approves.status_code, child_approves.json()["code"]) == (
        403,
        "PERMISSION_DENIED",
    )
    assert (owner_approves.status_code, owner_approves.json()["code"]) == (
        403,
        "PERMISSION_DENIED",
    )
    assert not await stock(w, w.private)


async def test_the_child_store_s_own_owner_approves_its_private_warehouse(world):
    """Owner decision, 2026-09-29: "a user with admin rights to the child store".

    That is the owner's role, granted in the child store itself. No role
    changes for it: the private rule already accepts a grant made there.
    """
    w = world
    async with w.maker.begin() as session:
        owner_role = await session.scalar(
            select(Role.id).where(Role.organization_id == w.org, Role.code == "OWNER")
        )
        admin = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name="child admin")
        session.add(admin)
        await session.flush()
        session.add(
            Membership(
                user_id=admin.id, organization_id=w.org, store_id=w.second, role_id=owner_role
            )
        )
    async with client_for(w.maker, admin.id) as client:
        view = await prepared(client, w, store=w.second, location=w.private)
        approved = await approve(client, view["snapshot_id"], view["review_revision"])
        elsewhere = await client.post(
            "/api/v1/snapshots", json=import_body(w, LIST, store=w.main, location=w.shared)
        )

    assert approved.status_code == 200, approved.text
    assert await stock(w, w.private) == {
        (w.coat, w.sizes["S"]): 1,
        (w.coat, w.sizes["M"]): 1,
        (w.coat, w.sizes["L"]): 1,
        (w.bomber, w.sizes["M"]): 2,
    }
    # The grant is the child store's, and reaches nowhere else.
    assert (elsewhere.status_code, elsewhere.json()["code"]) == (403, "FORBIDDEN_STORE")


# ---------------------------------------------------------------------------
# Review: a person's answer, and where its numbers came from
# ---------------------------------------------------------------------------


async def test_a_line_resolves_to_several_sizes_when_someone_says_how_they_know(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w)
        response = await resolve(
            client,
            snapshot["snapshot_id"],
            1,
            allocations=[
                allocation(w.coat, w.sizes["S"]),
                allocation(w.coat, w.sizes["M"]),
                allocation(w.coat, w.sizes["L"]),
            ],
            quantity_basis="OWNER_KNOWLEDGE",
            note="у списку — по одній кожного розміру",
        )

    assert response.status_code == 200, response.text
    line = response.json()["line"]
    assert line["status"] == "RESOLVED"
    assert line["quantity_basis"] == "OWNER_KNOWLEDGE"
    assert [(item["size_code"], item["quantity"]) for item in line["allocations"]] == sorted(
        [("S", 1), ("M", 1), ("L", 1)],
        key=lambda pair: str(w.sizes[pair[0]]),
    )
    assert all(item["display_name"] for item in line["allocations"])
    summary = response.json()["snapshot"]["summary"]
    assert response.json()["snapshot"]["review_revision"] == 1
    assert summary["lines_by_basis"]["OWNER_KNOWLEDGE"] == 1
    assert summary["units_by_basis"]["OWNER_KNOWLEDGE"] == 3
    async with w.maker() as session:
        processing = await session.scalar(
            select(RawInputProcessing.status).where(
                RawInputProcessing.raw_input_id == uuid.UUID(line["raw_input_id"])
            )
        )
        assert processing is ProcessingStatus.RESOLVED
        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.organization_id == w.org, AuditLog.action == "snapshot.line_resolved"
            )
        )
        # The parser flagged the line (a tentative concept, several sizes).
        assert entry.before["status"] == "NEEDS_REVIEW"
        assert entry.after["quantity_basis"] == "OWNER_KNOWLEDGE"
        assert len(entry.after["allocations"]) == 3
        assert entry.reason == "у списку — по одній кожного розміру"


async def test_numbers_must_say_where_they_came_from(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(
            client,
            w,
            [
                "Лама бежевая/персик/butter 3 шт",
                "Бомбер шоколад 3 шт",
                "Куртка",
                "Лоран шоколад S M L 3 шт",
                "Куртка 2 шт 3 шт",
            ],
        )
        snapshot_id = snapshot["snapshot_id"]
        # 1+1+1 typed for a slash line cannot pass as what the line says.
        invented_split = await resolve(
            client,
            snapshot_id,
            1,
            allocations=[
                allocation(w.coat, w.sizes["S"]),
                allocation(w.coat, w.sizes["M"]),
                allocation(w.coat, w.sizes["L"]),
            ],
            quantity_basis="STATED",
        )
        # Nor can a number the line does not state.
        other_count = await resolve(
            client,
            snapshot_id,
            2,
            allocations=[allocation(w.bomber, None, 2)],
            quantity_basis="STATED",
        )
        # Nor "one piece" for a line that states a count.
        not_one = await resolve(
            client,
            snapshot_id,
            2,
            allocations=[allocation(w.bomber, None, 1)],
            quantity_basis="LINE_IMPLIES_ONE",
        )
        # Counted, but nobody said who or when.
        unexplained = await resolve(
            client,
            snapshot_id,
            1,
            allocations=[allocation(w.coat, None, 3)],
            quantity_basis="RECOUNTED",
        )
        # A line naming three sizes states no split either, slash or not: its
        # 3 cannot all go to S as what the line says.
        one_size_for_three = await resolve(
            client,
            snapshot_id,
            4,
            allocations=[allocation(w.coat, w.sizes["S"], 3)],
            quantity_basis="STATED",
        )
        # And a line with two counts is not a countless one, to be taken as one.
        two_counts_as_one = await resolve(
            client,
            snapshot_id,
            5,
            allocations=[allocation(w.coat, None, 1)],
            quantity_basis="LINE_IMPLIES_ONE",
        )
        # A countless line may be taken as one piece, as the convention it is.
        one = await resolve(
            client,
            snapshot_id,
            3,
            allocations=[allocation(w.coat, None, 1)],
            quantity_basis="LINE_IMPLIES_ONE",
        )
        # And a recount may say something else entirely, with a note.
        recounted = await resolve(
            client,
            snapshot_id,
            1,
            allocations=[allocation(w.coat, w.sizes["S"], 2)],
            quantity_basis="RECOUNTED",
            note="перелічили на складі 27.09",
        )

    for refused in (
        invented_split,
        other_count,
        not_one,
        unexplained,
        one_size_for_three,
        two_counts_as_one,
    ):
        assert refused.status_code == 422, refused.text
    assert one.status_code == 200, one.text
    assert recounted.status_code == 200, recounted.text
    summary = recounted.json()["snapshot"]["summary"]
    # The recount of 2 differs from the 3 the line states, and it shows.
    assert summary["lines_differing_from_source"] == 1
    assert summary["lines_by_basis"] == {
        "STATED": 0,
        "LINE_IMPLIES_ONE": 1,
        "RECOUNTED": 1,
        "OWNER_KNOWLEDGE": 0,
        # The basis a file's shown split is answered with (ADR-0014 §5);
        # no line typed by hand can rest on it.
        "STATED_BY_SIZE": 0,
    }


async def test_each_line_says_whether_it_may_be_taken_as_one_piece(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(
            client,
            w,
            ["Куртка", "Бомбер шоколад 3 шт", "Куртка 2 шт 3 шт", "Куртка 1636", "3 куртки"],
        )
        lines = await client.get(f"/api/v1/snapshots/{snapshot['snapshot_id']}/lines")

    assert lines.status_code == 200, lines.text
    # Only the countless line: never one with a count, two of them, or a
    # number nobody can say is a count.
    assert [line["may_imply_one"] for line in lines.json()["items"]] == [
        True,
        False,
        False,
        False,
        False,
    ]


async def test_size_not_known_is_one_row_that_only_this_path_creates(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w, ["Лоран шоколад 2 шт", "Мышка чорний"])
        first = await resolve(
            client,
            snapshot["snapshot_id"],
            1,
            allocations=[allocation(w.coat, None, 2)],
            quantity_basis="STATED",
        )
        second = await resolve(
            client,
            snapshot["snapshot_id"],
            2,
            allocations=[allocation(w.bomber, None, 1)],
            quantity_basis="LINE_IMPLIES_ONE",
        )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    unknown = {first.json()["line"]["allocations"][0]["size_id"]} | {
        second.json()["line"]["allocations"][0]["size_id"]
    }
    assert len(unknown) == 1
    async with w.maker() as session:
        size, system = (
            await session.execute(
                select(Size, SizeSystem)
                .join(SizeSystem, SizeSystem.id == Size.size_system_id)
                .where(Size.id == uuid.UUID(unknown.pop()))
            )
        ).one()
        assert size.is_unknown is True
        assert (system.code.value, size.code) == ("UNSPECIFIED", "UNKNOWN")
        assert system.organization_id == w.org


async def test_a_regular_size_named_unknown_is_never_relabelled(world):
    """The code is reserved: the catalog refuses it, in any case. A size made
    before it was reserved may still hold it, and "size not known" is then
    refused rather than taken over."""
    w = world
    async with w.client() as client:
        reserved = await client.post(
            "/api/v1/catalog/products",
            headers=idempotent(),
            json={
                "store_id": str(w.main),
                "concept": "Парка",
                "sizes": [{"system": "UNSPECIFIED", "code": "unknown"}],
            },
        )
    async with w.maker.begin() as session:
        system = SizeSystem(
            organization_id=w.org, code=SizeSystemCode.UNSPECIFIED, name="Unspecified"
        )
        session.add(system)
        await session.flush()
        session.add(Size(size_system_id=system.id, code="UNKNOWN", sort_order=0, is_unknown=False))
    async with w.client() as client:
        snapshot = await imported(client, w)
        refused = await resolve(
            client,
            snapshot["snapshot_id"],
            3,
            allocations=[allocation(w.coat, None, 1)],
            quantity_basis="LINE_IMPLIES_ONE",
        )

    assert (reserved.status_code, reserved.json()["code"]) == (422, "VALIDATION_ERROR")
    assert (refused.status_code, refused.json()["code"]) == (409, "CATALOG_AMBIGUOUS")


async def test_a_line_is_read_conservatively(world):
    """A count no stock could be is kept as evidence and never taken as stated;
    a line naming several sizes states no split, slash or not."""
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w, ["Куртка 3000000000 шт", "Лоран шоколад S M L 3 шт"])
        page = await client.get(f"/api/v1/snapshots/{snapshot['snapshot_id']}/lines")

    assert [(item["quantity_state"], item["quantity_total"]) for item in page.json()["items"]] == [
        ("UNKNOWN_QUANTITY", None),
        ("UNKNOWN_DISTRIBUTION", 3),
    ]
    assert page.json()["items"][0]["raw_text"] == "Куртка 3000000000 шт"


async def test_an_import_is_bounded_in_characters(world):
    w = world
    async with w.client() as client:
        long_line = await client.post(
            "/api/v1/snapshots", json=import_body(w, ["Куртка " + "M " * 250])
        )
        long_list = await client.post("/api/v1/snapshots", json=import_body(w, ["M " * 200] * 300))

    assert long_line.status_code == 422, long_line.text
    assert long_list.status_code == 422, long_list.text
    async with w.maker() as session:
        assert not await session.scalar(
            select(func.count())
            .select_from(InventorySnapshot)
            .where(InventorySnapshot.organization_id == w.org)
        )


async def test_a_list_opens_a_warehouse_with_a_bounded_number_of_allocations(world, monkeypatch):
    monkeypatch.setattr(snapshot_service, "MAX_LIST_ALLOCATIONS", 3)
    w = world
    three_sizes = [
        allocation(w.coat, w.sizes["S"]),
        allocation(w.coat, w.sizes["M"]),
        allocation(w.coat, w.sizes["L"]),
    ]
    async with w.client() as client:
        snapshot = await imported(client, w)
        snapshot_id = snapshot["snapshot_id"]
        full = await resolve(
            client,
            snapshot_id,
            1,
            allocations=three_sizes,
            quantity_basis="OWNER_KNOWLEDGE",
            note="по одній",
        )
        over = await resolve(
            client,
            snapshot_id,
            2,
            allocations=[allocation(w.bomber, w.sizes["M"], 2)],
            quantity_basis="STATED",
        )
        # A line's own earlier answer does not count against its new one.
        fewer = await resolve(
            client,
            snapshot_id,
            1,
            allocations=three_sizes[:2],
            quantity_basis="OWNER_KNOWLEDGE",
            note="L продана",
        )
        fits = await resolve(
            client,
            snapshot_id,
            2,
            allocations=[allocation(w.bomber, w.sizes["M"], 2)],
            quantity_basis="STATED",
        )

    assert full.status_code == 200, full.text
    assert over.status_code == 422, over.text
    # Still a 422, named as a full list is (review, 2026-10-09): what is full,
    # its limit, what the other lines hold and what this answer adds.
    assert over.json()["code"] == "VALIDATION_ERROR"
    assert over.json()["details"] == {
        "reason": "LIST_FULL",
        "what": "allocations",
        "limit": 3,
        "now": 3,
        "adding": 1,
    }
    assert fewer.status_code == 200, fewer.text
    assert fits.status_code == 200, fits.text
    assert fits.json()["snapshot"]["summary"]["allocations"] == 3


async def test_repeating_an_answer_changes_nothing(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w)
        body = {
            "allocations": [allocation(w.bomber, w.sizes["M"], 2)],
            "quantity_basis": "STATED",
        }
        first = await resolve(client, snapshot["snapshot_id"], 2, **body)
        again = await resolve(client, snapshot["snapshot_id"], 2, **body)

    assert first.json()["snapshot"]["review_revision"] == 1
    assert again.status_code == 200
    assert again.json()["snapshot"]["review_revision"] == 1
    assert again.json()["line"]["allocations"] == first.json()["line"]["allocations"]
    async with w.maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.organization_id == w.org, AuditLog.action == "snapshot.line_resolved"
                )
            )
            == 1
        )


async def test_a_new_answer_replaces_the_old_one_and_a_skip_withdraws_it(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w)
        snapshot_id = snapshot["snapshot_id"]
        await resolve(
            client,
            snapshot_id,
            2,
            allocations=[allocation(w.bomber, w.sizes["M"], 2)],
            quantity_basis="STATED",
        )
        replaced = await resolve(
            client,
            snapshot_id,
            2,
            allocations=[allocation(w.bomber, None, 2)],
            quantity_basis="STATED",
        )
        skipped = await resolve(client, snapshot_id, 2, skip_reason="продано до обліку")

    assert replaced.json()["snapshot"]["review_revision"] == 2
    assert [item["size_code"] for item in replaced.json()["line"]["allocations"]] == ["UNKNOWN"]
    line = skipped.json()["line"]
    assert skipped.json()["snapshot"]["review_revision"] == 3
    assert (line["status"], line["allocations"], line["quantity_basis"]) == ("SKIPPED", [], None)
    assert line["resolution_note"] == "продано до обліку"
    async with w.maker() as session:
        assert not await session.scalar(
            select(func.count())
            .select_from(InventorySnapshotAllocation)
            .join(
                InventorySnapshotRow,
                InventorySnapshotRow.id == InventorySnapshotAllocation.snapshot_row_id,
            )
            .where(InventorySnapshotRow.inventory_snapshot_id == uuid.UUID(snapshot_id))
        )
        processing = await session.scalar(
            select(RawInputProcessing.status).where(
                RawInputProcessing.raw_input_id == uuid.UUID(line["raw_input_id"])
            )
        )
        assert processing is ProcessingStatus.PARSED


async def test_the_same_product_and_size_twice_in_one_line_is_refused(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w)
        response = await resolve(
            client,
            snapshot["snapshot_id"],
            1,
            allocations=[allocation(w.coat, w.sizes["M"]), allocation(w.coat, w.sizes["M"])],
            quantity_basis="RECOUNTED",
            note="двічі",
        )
    assert response.status_code == 422, response.text


async def test_a_foreign_or_retired_product_is_unknown(world):
    w = world
    other = await seed_world(w.maker)
    async with client_for(w.maker, other["users"]["owner"]) as client:
        foreign, foreign_sizes = await create_product(
            client, other["main"], "Лоран", "шоколад", ["M"]
        )
    async with w.maker.begin() as session:
        await session.execute(
            update(ProductVariant)
            .where(ProductVariant.id == w.bottega)
            .values(status=EntityStatus.NEEDS_REVIEW)
        )
    async with w.client() as client:
        snapshot = await imported(client, w)
        responses = [
            await resolve(
                client,
                snapshot["snapshot_id"],
                3,
                allocations=[allocation(variant, size, 1)],
                quantity_basis="LINE_IMPLIES_ONE",
            )
            for variant, size in (
                (foreign, foreign_sizes["M"]),  # another shop's product
                (w.coat, foreign_sizes["M"]),  # another shop's size
                (w.bottega, None),  # a product parked for review
                (uuid.uuid4(), None),  # nothing at all
            )
        ]

    for response in responses:
        assert (response.status_code, response.json()["code"]) == (404, "NOT_FOUND"), response.text


async def test_a_line_that_does_not_exist_is_not_found(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w)
        response = await resolve(client, snapshot["snapshot_id"], 4, skip_reason="немає")
    assert (response.status_code, response.json()["code"]) == (404, "NOT_FOUND")


async def test_only_importers_review(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w)
    async with w.client("seller") as client:
        response = await resolve(client, snapshot["snapshot_id"], 3, skip_reason="заголовок")
        read = await client.get(f"/api/v1/snapshots/{snapshot['snapshot_id']}")
    assert (response.status_code, response.json()["code"]) == (403, "PERMISSION_DENIED")
    assert (read.status_code, read.json()["code"]) == (403, "PERMISSION_DENIED")


async def test_repeated_lines_are_shown_as_repeats(world):
    w = world
    lines = ["Бомбер шоколад накладной карман", "Куртки", "Бомбер шоколад накладной карман"]
    async with w.client() as client:
        snapshot = await imported(client, w, lines)
        page = await client.get(
            f"/api/v1/snapshots/{snapshot['snapshot_id']}/lines", params={"limit": 1, "offset": 2}
        )
    item = page.json()["items"][0]
    # Counted across the whole list, not just the page it appears on.
    assert (item["line_no"], item["same_text_lines"]) == (3, 2)
    assert page.json()["has_more"] is False


# ---------------------------------------------------------------------------
# Approval: opening stock, once, all or nothing
# ---------------------------------------------------------------------------


async def test_approval_turns_the_list_into_opening_stock_and_nothing_else(world):
    w = world
    async with w.client() as client:
        view = await prepared(client, w, captured_at="2025-10-01")
        response = await approve(client, view["snapshot_id"], view["review_revision"])
        # What the list became is read by pages (ADR-0014 §10).
        page = await client.get(f"/api/v1/snapshots/{view['snapshot_id']}/application")

    assert response.status_code == 200, response.text
    assert page.status_code == 200, page.text
    body = response.json()
    applied = page.json()["items"]
    snapshot_id = uuid.UUID(body["snapshot_id"])
    assert body["status"] == "APPLIED"
    assert body["approved_by_user_id"] == str(w.users["owner"])
    assert body["decided_at"] is not None
    assert body["application"] == {"units": 5, "allocations": 4}
    assert page.json()["has_more"] is False
    assert sum(line["quantity"] for line in applied) == 5
    assert [line["line_no"] for line in applied] == [1, 1, 1, 2]
    assert await stock(w) == {
        (w.coat, w.sizes["S"]): 1,
        (w.coat, w.sizes["M"]): 1,
        (w.coat, w.sizes["L"]): 1,
        (w.bomber, w.sizes["M"]): 2,
    }

    ledger = await movements(w)
    # Invariant I17: an opening balance and nothing else — no delivery, no
    # sale, no adjustment — one movement per allocation, each with its lot.
    assert {movement.movement_type for movement in ledger} == {MovementType.OPENING_BALANCE}
    assert len(ledger) == 4
    assert {(m.reference_type, m.reference_id) for m in ledger} == {
        ("inventory_snapshot", snapshot_id)
    }
    assert {m.acting_store_id for m in ledger} == {w.main}
    assert {m.actor_user_id for m in ledger} == {w.users["owner"]}
    assert {line["movement_id"] for line in applied} == {str(m.id) for m in ledger}
    async with w.maker() as session:
        lots = list(
            await session.scalars(
                select(StockLot).where(StockLot.inventory_snapshot_id == snapshot_id)
            )
        )
        assert {lot.acquisition_type for lot in lots} == {AcquisitionType.OPENING_BALANCE}
        assert {str(lot.id) for lot in lots} == {line["stock_lot_id"] for line in applied}
        # Every quantity is explained by the ledger (invariant I3).
        assert await find_divergences(session, organization_id=w.org) == []
        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.organization_id == w.org, AuditLog.action == "snapshot.applied"
            )
        )
        assert entry.after["units"] == 5
        assert entry.after["captured_at"] == "2025-10-01"
        assert entry.after["lines_by_basis"]["OWNER_KNOWLEDGE"] == 1
        assert entry.after["lines_by_basis"]["STATED"] == 1


async def test_a_manager_cannot_approve(world):
    w = world
    async with w.client("manager") as client:
        view = await prepared(client, w)
        response = await approve(client, view["snapshot_id"], view["review_revision"])
    assert (response.status_code, response.json()["code"]) == (403, "PERMISSION_DENIED")
    assert not await movements(w)


async def test_lines_still_waiting_block_approval(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w, [*LIST, "Лама бежевая/персик/butter 3 шт"])
        view = await answer_list(client, w, snapshot["snapshot_id"])
        response = await approve(client, snapshot["snapshot_id"], view["review_revision"])

    assert response.status_code == 409, response.text
    details = response.json()["details"]
    assert response.json()["code"] == "SNAPSHOT_CONFLICT"
    # The unknown split blocks approval until a person answers it (I15, I17).
    assert (details["reason"], details["line_nos"], details["count"]) == (
        "ROWS_NEED_REVIEW",
        [4],
        1,
    )
    assert not await movements(w)


async def test_a_list_that_changed_after_it_was_checked_is_not_approved(world):
    w = world
    async with w.client() as client:
        view = await prepared(client, w)
        checked = view["review_revision"]
        await resolve(client, view["snapshot_id"], 3, skip_reason="заголовок, не товар")
        response = await approve(client, view["snapshot_id"], checked)

    assert response.status_code == 409, response.text
    assert response.json()["details"]["reason"] == "REVISION_CHANGED"
    assert response.json()["details"]["review_revision"] == checked + 1
    assert not await movements(w)


async def test_approving_again_returns_exactly_what_was_done(world):
    w = world
    async with w.client() as client:
        view = await prepared(client, w)
        first = await approve(client, view["snapshot_id"], view["review_revision"])
        done = await client.get(f"/api/v1/snapshots/{view['snapshot_id']}/application")
        again = await approve(client, view["snapshot_id"], view["review_revision"])
        other = await approve(client, view["snapshot_id"], view["review_revision"] - 1)
        read = await client.get(f"/api/v1/snapshots/{view['snapshot_id']}")
        redone = await client.get(f"/api/v1/snapshots/{view['snapshot_id']}/application")

    assert again.status_code == 200, again.text
    assert again.json()["application"] == first.json()["application"]
    assert read.json()["application"] == first.json()["application"]
    # Line by line, the replay changed nothing: the same lots, the same movements.
    assert redone.json() == done.json()
    assert len(done.json()["items"]) == 4
    assert len(await movements(w)) == 4
    assert (other.status_code, other.json()["details"]["reason"]) == (409, "ALREADY_DECIDED")


async def test_a_replay_is_refused_once_the_grant_is_gone(world):
    """Invariant I13: authority is checked before an answer is replayed."""
    w = world
    async with w.maker.begin() as session:
        approver = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name="approver")
        session.add(approver)
        await session.flush()
        owner_role = await session.scalar(
            select(Role.id).where(Role.organization_id == w.org, Role.code == "OWNER")
        )
        membership = Membership(
            user_id=approver.id, organization_id=w.org, store_id=w.main, role_id=owner_role
        )
        session.add(membership)
    async with client_for(w.maker, approver.id) as client:
        view = await prepared(client, w)
        assert (await approve(client, view["snapshot_id"], 3)).status_code == 200
        async with w.maker.begin() as session:
            await session.execute(delete(Membership).where(Membership.user_id == approver.id))
            session.add(
                Membership(
                    user_id=approver.id,
                    organization_id=w.org,
                    store_id=w.second,
                    role_id=owner_role,
                )
            )
        replay = await approve(client, view["snapshot_id"], 3)
    assert (replay.status_code, replay.json()["code"]) == (403, "FORBIDDEN_STORE")


async def test_a_list_of_nothing_but_skips_has_nothing_to_apply(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w, ["Куртки", "Шуби"])
        for line_no in (1, 2):
            await resolve(client, snapshot["snapshot_id"], line_no, skip_reason="заголовок")
        response = await approve(client, snapshot["snapshot_id"], 2)
    assert (response.status_code, response.json()["details"]["reason"]) == (
        409,
        "NOTHING_TO_APPLY",
    )


async def test_a_warehouse_with_stock_history_is_not_opened(world):
    """A list typed for a warehouse that already records stock waits for
    nothing (it holds no one back) and is never approved."""
    w = world
    async with w.client() as client:
        receipt = await receive(client, w)
        assert receipt.status_code == 201, receipt.text
        view = await prepared(client, w)
        response = await approve(client, view["snapshot_id"], view["review_revision"])
        after = await client.get(f"/api/v1/snapshots/{view['snapshot_id']}")

    assert (response.status_code, response.json()["code"]) == (409, "OPENING_BALANCE_CONFLICT")
    assert after.json()["status"] == "IN_REVIEW"
    assert await stock(w) == {(w.bottega, w.sizes["M"]): 1}
    async with w.maker() as session:
        assert not await session.scalar(
            select(func.count())
            .select_from(StockLot)
            .where(StockLot.inventory_snapshot_id == uuid.UUID(view["snapshot_id"]))
        )


async def test_a_warehouse_sold_back_to_empty_still_has_history(world):
    """An empty shelf is not an empty ledger: a coat received and sold again
    leaves nothing to count, yet the warehouse already has a story the list
    knows nothing about."""
    w = world
    async with w.client() as client:
        receipt = await receive(client, w)
        assert receipt.status_code == 201, receipt.text
    async with w.client("seller") as client:
        sale = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json={
                "store_id": str(w.main),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": str(w.bottega),
                        "size_id": str(w.sizes["M"]),
                        "source_location_id": str(w.shared),
                        "quantity": 1,
                        "unit_price": "3900.00",
                    }
                ],
                "payment_method": "CASH",
            },
        )
        assert sale.status_code == 201, sale.text
    assert await stock(w) == {}
    async with w.client() as client:
        view = await prepared(client, w)
        response = await approve(client, view["snapshot_id"], view["review_revision"])
    assert (response.status_code, response.json()["code"]) == (409, "OPENING_BALANCE_CONFLICT")
    assert len(await movements(w)) == 2


async def test_a_warehouse_is_opened_once(world):
    w = world
    async with w.client() as client:
        first = await prepared(client, w)
        second = await prepared(client, w)
        assert (await approve(client, first["snapshot_id"], 3)).status_code == 200
        response = await approve(client, second["snapshot_id"], 3)
    assert (response.status_code, response.json()["code"]) == (409, "OPENING_BALANCE_CONFLICT")
    assert len(await movements(w)) == 4


async def test_two_lists_for_one_warehouse_approved_at_once_open_it_once(world):
    w = world
    async with w.client() as client:
        first = await prepared(client, w)
        second = await prepared(client, w)
    async with w.client() as one, w.client() as two:
        results = await asyncio.gather(
            approve(one, first["snapshot_id"], 3), approve(two, second["snapshot_id"], 3)
        )

    assert sorted(result.status_code for result in results) == [200, 409]
    assert {result.json().get("code") for result in results if result.status_code == 409} == {
        "OPENING_BALANCE_CONFLICT"
    }
    assert len(await movements(w)) == 4
    assert sum((await stock(w)).values()) == 5


async def test_stock_written_on_another_key_is_either_before_the_opening_or_after_it(world):
    """The design review's race (ADR-0005 §5): a receipt at the same warehouse
    on a key the list does not name. Every stock command holds the warehouse's
    shared lock while it writes; the opening balance takes it exclusively."""
    w = world

    # 1. The receipt is in flight first: the list typed meanwhile waits for it
    # (it holds the warehouse exclusively), then finds its history, and the
    # approval is refused.
    async with w.maker() as receipt_session:
        await apply_movements(
            receipt_session,
            organization_id=w.org,
            requests=[delivery(w, w.bottega, w.sizes["M"])],
        )
        holder = await receipt_session.scalar(text("SELECT pg_backend_pid()"))
        async with w.client() as client:
            typing = asyncio.create_task(prepared(client, w))
            await wait_until_blocked_by(w.engine, holder)
            await receipt_session.commit()
            before = await typing
    async with w.client() as client:
        refused = await approve(client, before["snapshot_id"], 3)
    assert (refused.status_code, refused.json()["code"]) == (409, "OPENING_BALANCE_CONFLICT")

    # 2. The opening is in flight first: the receipt waits, then lands after it.
    fresh = await seed_world(w.maker)
    other = World(
        engine=w.engine,
        maker=w.maker,
        coat=w.coat,
        bomber=w.bomber,
        bottega=w.bottega,
        sizes=w.sizes,
        **fresh,
    )
    async with other.client() as client:
        coat, sizes = await create_product(client, other.main, "Лоран", "шоколад", ["S", "M", "L"])
        bomber, _ = await create_product(client, other.main, "Мышка", "чорний", ["M"])
        bottega, _ = await create_product(client, other.main, "Ботега", "бежевий", ["M"])
    other = World(
        engine=w.engine,
        maker=w.maker,
        coat=coat,
        bomber=bomber,
        bottega=bottega,
        sizes=sizes,
        **fresh,
    )
    async with other.client() as client:
        view = await prepared(client, other)
    async with other.maker() as approval_session:
        scope = await resolve_scope(approval_session, other.users["owner"])
        await approve_snapshot(
            approval_session,
            scope=scope,
            snapshot_id=uuid.UUID(view["snapshot_id"]),
            expected_revision=3,
        )
        holder = await approval_session.scalar(text("SELECT pg_backend_pid()"))
        async with other.client() as client:
            receipt = asyncio.create_task(
                client.post(
                    "/api/v1/inventory/receipts",
                    headers=idempotent(),
                    json={
                        "store_id": str(other.main),
                        "location_id": str(other.shared),
                        "command_id": str(uuid.uuid4()),
                        "lines": [
                            {
                                "product_variant_id": str(other.bottega),
                                "size_id": str(other.sizes["M"]),
                                "quantity": 1,
                            }
                        ],
                    },
                )
            )
            await wait_until_blocked_by(w.engine, holder)
            await approval_session.commit()
            landed = await receipt
    assert landed.status_code == 201, landed.text
    assert (await stock(other))[(other.bottega, other.sizes["M"])] == 1
    assert sum((await stock(other)).values()) == 6


# ---------------------------------------------------------------------------
# A warehouse waits for its list (owner decision, 2026-10-02)
# ---------------------------------------------------------------------------


async def test_nothing_moves_in_a_warehouse_while_its_list_waits(world):
    """The owner chose that the lists are approved before new deliveries,
    and that the app keep that order: while a list waits for a warehouse with
    no history, nothing moves there — not a receipt, not a correction."""
    w = world
    async with w.client() as client:
        view = await prepared(client, w)
        receipt = await receive(client, w)
    async with w.client("manager") as client:
        correction = await client.post(
            "/api/v1/inventory/adjustments",
            headers=idempotent(),
            json={
                "store_id": str(w.main),
                "location_id": str(w.shared),
                "command_id": str(uuid.uuid4()),
                "product_variant_id": str(w.bottega),
                "size_id": str(w.sizes["M"]),
                "quantity_delta": 1,
                "expected_quantity": 0,
                "reason_code": "STOCKTAKE",
            },
        )
    async with w.client("child_manager") as client:
        elsewhere = await receive(client, w, location=w.private, store=w.second)

    for refused in (receipt, correction):
        assert refused.status_code == 409, refused.text
        assert refused.json()["code"] == "OPENING_LIST_PENDING"
        # Refused after each command's lookup, so each says nothing was
        # recorded (ADR-0013 §1).
        assert refused.json()["details"] == {"location_ids": [str(w.shared)], "recorded": False}
    assert all(movement.location_id != w.shared for movement in await movements(w))
    # Another warehouse, with no list of its own, goes on as before.
    assert elsewhere.status_code == 201, elsewhere.text

    async with w.client() as client:
        approved = await approve(client, view["snapshot_id"], 3)
        after = await receive(client, w)
    assert approved.status_code == 200, approved.text
    assert after.status_code == 201, after.text
    async with w.maker() as session:
        # Approving the list let the warehouse go.
        assert not await session.scalar(
            select(func.count())
            .select_from(OpeningListHold)
            .where(OpeningListHold.snapshot_id == uuid.UUID(view["snapshot_id"]))
        )


async def test_a_rejected_list_lets_its_warehouse_go(world):
    w = world
    async with w.client() as client:
        view = await imported(client, w)
        waiting = await receive(client, w)
        rejected = await client.post(
            f"/api/v1/snapshots/{view['snapshot_id']}/reject", json={"reason": "не той зошит"}
        )
        received = await receive(client, w)
    assert waiting.json()["code"] == "OPENING_LIST_PENDING"
    assert rejected.status_code == 200, rejected.text
    assert received.status_code == 201, received.text


async def test_a_warehouse_waits_until_its_last_list_is_decided(world):
    w = world
    async with w.client() as client:
        first = await imported(client, w)
        second = await imported(client, w)
        await client.post(
            f"/api/v1/snapshots/{first['snapshot_id']}/reject", json={"reason": "дубль"}
        )
        still = await receive(client, w)
        await client.post(
            f"/api/v1/snapshots/{second['snapshot_id']}/reject", json={"reason": "перелічимо"}
        )
        free = await receive(client, w)
    assert (still.status_code, still.json()["code"]) == (409, "OPENING_LIST_PENDING")
    assert free.status_code == 201, free.text


async def test_a_list_for_a_warehouse_with_history_holds_nothing_back(world):
    """It can never be approved, so the warehouse goes on trading."""
    w = world
    async with w.client() as client:
        assert (await receive(client, w)).status_code == 201
        await imported(client, w)
        again = await receive(client, w)
    assert again.status_code == 201, again.text


async def test_a_receipt_while_a_list_is_kept_waits_for_it_and_is_refused(world):
    """The list holds the warehouse exclusively while it is kept: a receipt
    in between waits, then finds the list and is refused."""
    w = world
    async with w.maker() as list_session:
        scope = await resolve_scope(list_session, w.users["owner"])
        await snapshot_service.import_snapshot(
            list_session,
            scope=scope,
            command_id=uuid.uuid4(),
            store_id=w.main,
            location_id=w.shared,
            lines=LIST,
        )
        holder = await list_session.scalar(text("SELECT pg_backend_pid()"))
        async with w.client() as client:
            receipt = asyncio.create_task(receive(client, w))
            await wait_until_blocked_by(w.engine, holder)
            await list_session.commit()
            refused = await receipt
    assert (refused.status_code, refused.json()["code"]) == (409, "OPENING_LIST_PENDING")
    assert not await movements(w)


async def test_a_paused_warehouse_is_not_opened(world):
    w = world
    async with w.client() as client:
        view = await prepared(client, w)
        async with w.maker.begin() as session:
            await session.execute(
                update(StockLocation).where(StockLocation.id == w.shared).values(is_active=False)
            )
        response = await approve(client, view["snapshot_id"], 3)
        rejected = await client.post(
            f"/api/v1/snapshots/{view['snapshot_id']}/reject", json={"reason": "склад закрито"}
        )
    assert (response.status_code, response.json()["code"]) == (404, "NOT_FOUND")
    # A list for a paused warehouse can still be abandoned.
    assert rejected.status_code == 200, rejected.text
    assert not await movements(w)


async def test_approval_needs_the_store_to_still_receive_here(world):
    """The grant is checked at approval, not only at import: a store that lost
    `can_receive` at the warehouse while the list was reviewed cannot open it."""
    w = world
    async with w.client() as client:
        view = await prepared(client, w)
        async with w.maker.begin() as session:
            await session.execute(
                update(StoreLocationAccess)
                .where(
                    StoreLocationAccess.store_id == w.main,
                    StoreLocationAccess.location_id == w.shared,
                )
                .values(can_receive=False)
            )
        response = await approve(client, view["snapshot_id"], 3)
        review = await resolve(client, view["snapshot_id"], 3, skip_reason="інша причина")
        read = await client.get(f"/api/v1/snapshots/{view['snapshot_id']}")
    assert (response.status_code, response.json()["code"]) == (403, "LOCATION_ACCESS_DENIED")
    assert (review.status_code, review.json()["code"]) == (403, "LOCATION_ACCESS_DENIED")
    # Reading needs only reach, which the store still has.
    assert read.status_code == 200, read.text
    assert not await movements(w)


async def test_a_product_retired_after_review_blocks_approval(world):
    w = world
    async with w.client() as client:
        view = await prepared(client, w)
        async with w.maker.begin() as session:
            await session.execute(
                update(ProductVariant)
                .where(ProductVariant.id == w.bomber)
                .values(status=EntityStatus.NEEDS_REVIEW)
            )
        response = await approve(client, view["snapshot_id"], 3)
    assert (response.status_code, response.json()["code"]) == (404, "NOT_FOUND")
    assert not await movements(w)


async def test_opening_stock_is_sold_like_any_other(world):
    w = world
    async with w.client() as client:
        view = await prepared(client, w)
        assert (await approve(client, view["snapshot_id"], 3)).status_code == 200
    async with w.client("seller") as client:
        sale = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json={
                "store_id": str(w.main),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": str(w.bomber),
                        "size_id": str(w.sizes["M"]),
                        "source_location_id": str(w.shared),
                        "quantity": 1,
                        "unit_price": "4200.00",
                    }
                ],
                "payment_method": "CASH",
            },
        )
    assert sale.status_code == 201, sale.text
    assert Decimal(sale.json()["total"]) == Decimal("4200.00")
    assert (await stock(w))[(w.bomber, w.sizes["M"])] == 1


# ---------------------------------------------------------------------------
# Guards that ship with the opening balance
# ---------------------------------------------------------------------------


async def test_found_during_sale_cannot_count_size_unknown_stock_twice(world):
    """The design review's third finding: a seller sells a coat held as "size
    not known" as an M, and «фізично є» would add an M the list already
    counted. Refused with its own code; selling it as size not known works,
    and once none is left the correction works again. The other direction —
    «фізично є» adding a coat with its size not known — is refused always:
    only a list states that size (the code review's sixth finding)."""
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w, ["Лоран шоколад 2 шт", "Куртки"])
        line = await resolve(
            client,
            snapshot["snapshot_id"],
            1,
            allocations=[allocation(w.coat, None, 2)],
            quantity_basis="STATED",
        )
        unknown = uuid.UUID(line.json()["line"]["allocations"][0]["size_id"])
        await resolve(client, snapshot["snapshot_id"], 2, skip_reason="заголовок")
        assert (await approve(client, snapshot["snapshot_id"], 2)).status_code == 200

    def sale(size, *, found: bool) -> dict:
        body = {
            "store_id": str(w.main),
            "command_id": str(uuid.uuid4()),
            "lines": [
                {
                    "product_variant_id": str(w.coat),
                    "size_id": str(size),
                    "source_location_id": str(w.shared),
                    "quantity": 1,
                    "unit_price": "9000.00",
                }
            ],
            "payment_method": "CASH",
        }
        if found:
            body["found_in_store"] = [{"line_index": 0, "quantity": 1}]
        return body

    async with w.client("seller") as client:
        twice = await client.post(
            "/api/v1/sales", headers=idempotent(), json=sale(w.sizes["M"], found=True)
        )
        as_unknown = [
            await client.post(
                "/api/v1/sales", headers=idempotent(), json=sale(unknown, found=False)
            )
            for _ in range(2)
        ]
        found_as_unknown = await client.post(
            "/api/v1/sales", headers=idempotent(), json=sale(unknown, found=True)
        )
        once_none_left = await client.post(
            "/api/v1/sales", headers=idempotent(), json=sale(w.sizes["M"], found=True)
        )

    assert (twice.status_code, twice.json()["code"]) == (409, "UNKNOWN_SIZE_STOCK")
    assert twice.json()["details"]["available"] == 2
    assert [response.status_code for response in as_unknown] == [201, 201]
    assert (found_as_unknown.status_code, found_as_unknown.json()["code"]) == (
        409,
        "UNKNOWN_SIZE_STOCK",
    )
    assert found_as_unknown.json()["details"]["reason"] == "FOUND_AS_SIZE_NOT_KNOWN"
    assert once_none_left.status_code == 201, once_none_left.text
    assert await stock(w) == {}
    async with w.maker() as session:
        assert await find_divergences(session, organization_id=w.org) == []


async def test_goods_with_their_size_not_known_enter_only_from_a_list(world):
    """Received or found, goods have a size. Stock a list loaded as "size not
    known" can still be written off, like any other."""
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w, ["Лоран шоколад 2 шт"])
        line = await resolve(
            client,
            snapshot["snapshot_id"],
            1,
            allocations=[allocation(w.coat, None, 2)],
            quantity_basis="STATED",
        )
        unknown = line.json()["line"]["allocations"][0]["size_id"]
        assert (await approve(client, snapshot["snapshot_id"], 1)).status_code == 200

        def adjustment(delta: int, reason: str) -> dict:
            return {
                "store_id": str(w.main),
                "location_id": str(w.shared),
                "command_id": str(uuid.uuid4()),
                "product_variant_id": str(w.coat),
                "size_id": unknown,
                "quantity_delta": delta,
                "reason_code": reason,
            }

        received = await client.post(
            "/api/v1/inventory/receipts",
            headers=idempotent(),
            json={
                "store_id": str(w.main),
                "location_id": str(w.shared),
                "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": str(w.coat), "size_id": unknown, "quantity": 1}],
            },
        )
        found = await client.post(
            "/api/v1/inventory/adjustments",
            headers=idempotent(),
            json=adjustment(1, "CORRECTION"),
        )
        written_off = await client.post(
            "/api/v1/inventory/adjustments",
            headers=idempotent(),
            json=adjustment(-1, "DAMAGED"),
        )

    assert (received.status_code, received.json()["code"]) == (422, "VALIDATION_ERROR")
    assert (found.status_code, found.json()["code"]) == (422, "VALIDATION_ERROR")
    assert written_off.status_code == 201, written_off.text
    assert await stock(w) == {(w.coat, uuid.UUID(unknown)): 1}


# ---------------------------------------------------------------------------
# Size clarified at the counter (owner decision, 2026-09-29)
# ---------------------------------------------------------------------------


async def held_as_size_not_known(w: World, quantity: int = 2) -> uuid.UUID:
    """The coat, opened at the shared warehouse with its size not known."""
    async with w.client() as client:
        snapshot = await imported(client, w, [f"Лоран шоколад {quantity} шт"])
        line = await resolve(
            client,
            snapshot["snapshot_id"],
            1,
            allocations=[allocation(w.coat, None, quantity)],
            quantity_basis="STATED",
        )
        assert line.status_code == 200, line.text
        assert (await approve(client, snapshot["snapshot_id"], 1)).status_code == 200
    return uuid.UUID(line.json()["line"]["allocations"][0]["size_id"])


def coat_sale(w: World, *lines, command_id=None, **reports) -> dict:
    """A sale of the coat at the shared warehouse; each line is `(size, quantity)`."""
    return {
        "store_id": str(w.main),
        "command_id": str(command_id or uuid.uuid4()),
        "lines": [
            {
                "product_variant_id": str(w.coat),
                "size_id": str(size),
                "source_location_id": str(w.shared),
                "quantity": quantity,
                "unit_price": "9000.00",
            }
            for size, quantity in lines
        ],
        # The till's button that sold (owner decisions, 2026-10-04).
        "payment_method": "CASH",
        **reports,
    }


def clarified(*reports: tuple[int, int]) -> list[dict]:
    return [{"line_index": index, "quantity": quantity} for index, quantity in reports]


async def test_a_seller_says_which_size_a_coat_held_as_size_not_known_is(world):
    """The answer to M1-023's fourth question. The coat leaves "size not known"
    for M, is sold as M, and the trail says who did it and what it was."""
    w = world
    unknown = await held_as_size_not_known(w)
    async with w.client("seller") as client:
        sold = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json=coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1))),
        )
        assert sold.status_code == 201, sold.text
        body = sold.json()
        read_back = await client.get(f"/api/v1/sales/{body['id']}")
        async with w.maker.begin() as session:
            await session.execute(
                update(Sale).where(Sale.id == uuid.UUID(body["id"])).values(response_snapshot=None)
            )
        rebuilt = await client.get(f"/api/v1/sales/{body['id']}")

    assert [item["size_id"] for item in body["items"]] == [str(w.sizes["M"])]
    assert (body["corrections"], body["shortages"]) == ([], [])
    assert len(body["size_reclassifications"]) == 2
    # Read back as it was answered, from the stored answer and from the ledger.
    assert read_back.json()["size_reclassifications"] == body["size_reclassifications"]
    assert rebuilt.json()["size_reclassifications"] == body["size_reclassifications"]
    assert await stock(w) == {(w.coat, unknown): 1}
    async with w.maker() as session:
        legs = (
            await session.execute(
                select(
                    StockMovement.id,
                    StockMovement.size_id,
                    StockMovement.movement_type,
                    StockMovement.quantity_delta,
                    StockMovement.reason_code,
                ).where(StockMovement.reference_id == uuid.UUID(body["id"]))
            )
        ).all()
        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.organization_id == w.org,
                AuditLog.action == "inventory.size_reclassified_during_sale",
            )
        )
        assert await find_divergences(session, organization_id=w.org) == []

    assert {tuple(leg[1:]) for leg in legs} == {
        (unknown, MovementType.ADJUSTMENT, -1, MovementReason.SIZE_RECLASSIFICATION_OUT),
        (w.sizes["M"], MovementType.ADJUSTMENT, 1, MovementReason.SIZE_RECLASSIFICATION_IN),
        (w.sizes["M"], MovementType.SALE, -1, None),
    }
    assert {str(leg.id) for leg in legs if leg.reason_code} == set(body["size_reclassifications"])
    assert entry is not None
    out = next(leg for leg in legs if leg.reason_code is MovementReason.SIZE_RECLASSIFICATION_OUT)
    assert (entry.entity_type, entry.entity_id) == ("stock_movement", out.id)
    assert entry.actor_user_id == w.users["seller"]
    assert entry.before["location_id"] == str(w.shared)
    assert entry.before["product_variant_id"] == str(w.coat)
    assert entry.before["size_not_known_id"] == str(unknown)
    assert entry.reason == "SIZE_RECLASSIFICATION"
    assert entry.before["quantities"] == {str(unknown): 2, str(w.sizes["M"]): 0}
    assert entry.after["quantities"] == {str(unknown): 1, str(w.sizes["M"]): 1}
    assert sorted(entry.after["movement_ids"]) == sorted(body["size_reclassifications"])
    assert entry.after["sale_id"] == body["id"]


async def test_a_clarification_covers_exactly_what_the_sale_is_short(world):
    """Like «фізично є»: the M the ledger already holds is sold first, and
    nothing is reclassified that is not leaving in this basket."""
    w = world
    unknown = await held_as_size_not_known(w, 3)
    async with w.client() as client:
        received = await client.post(
            "/api/v1/inventory/receipts",
            headers=idempotent(),
            json={
                "store_id": str(w.main),
                "location_id": str(w.shared),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {"product_variant_id": str(w.coat), "size_id": str(w.sizes["M"]), "quantity": 1}
                ],
            },
        )
        assert received.status_code == 201, received.text
    async with w.client("seller") as client:
        attempts = [
            await client.post("/api/v1/sales", headers=idempotent(), json=body)
            for body in (
                coat_sale(w, (w.sizes["M"], 2), size_clarified=clarified((0, 2))),
                coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1))),
                # Too few is refused too, not left for the sale to trip over.
                coat_sale(w, (w.sizes["M"], 3), size_clarified=clarified((0, 1))),
            )
        ]
        exact = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json=coat_sale(w, (w.sizes["M"], 2), size_clarified=clarified((0, 1))),
        )

    for attempt, shortfall in zip(attempts, (1, 0, 2), strict=True):
        assert (attempt.status_code, attempt.json()["code"]) == (
            422,
            "CORRECTION_EXCEEDS_SHORTFALL",
        )
        details = attempt.json()["details"]
        assert details["shortfall"] == shortfall
        assert (details["reason"], details["line_index"]) == ("SIZE_CLARIFIED", 0)
        assert (details["location_id"], details["size_id"]) == (str(w.shared), str(w.sizes["M"]))
    assert exact.status_code == 201, exact.text
    assert await stock(w) == {(w.coat, unknown): 2}


async def test_a_clarification_takes_only_what_is_held_with_size_not_known(world):
    """Beside whatever the basket sells from that balance as it is, and only
    for a model that has one here."""
    w = world
    unknown = await held_as_size_not_known(w)
    async with w.client("seller") as client:
        too_many = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json=coat_sale(w, (w.sizes["M"], 3), size_clarified=clarified((0, 3))),
        )
        with_the_rest = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json=coat_sale(w, (w.sizes["M"], 2), (unknown, 1), size_clarified=clarified((0, 2))),
        )
        none_held = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json={
                **coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1))),
                "lines": [
                    {
                        "product_variant_id": str(w.bomber),
                        "size_id": str(w.sizes["M"]),
                        "source_location_id": str(w.shared),
                        "quantity": 1,
                        "unit_price": "4200.00",
                    }
                ],
                "payment_method": "CASH",
            },
        )

    for refused, requested in ((too_many, 3), (with_the_rest, 3), (none_held, 1)):
        assert (refused.status_code, refused.json()["code"]) == (409, "INSUFFICIENT_STOCK")
        details = refused.json()["details"]
        assert (details["reason"], details["line_index"]) == ("SIZE_NOT_KNOWN_SHORT", 0)
        assert (details["size_id"], details["correctable"]) == (str(w.sizes["M"]), False)
        assert details["requested"] == requested
    assert with_the_rest.json()["details"]["size_not_known_id"] == str(unknown)
    assert await stock(w) == {(w.coat, unknown): 2}


async def test_only_a_sized_line_nothing_else_is_said_about_is_clarified(world):
    """The manager, who may report goods missing too, so every refusal is the
    rule's own and none is a missing permission. Each case is told apart by
    what it says, so none passes on another rule's refusal."""
    w = world
    unknown = await held_as_size_not_known(w)
    found = [{"line_index": 0, "quantity": 1}]
    missing = [{"line_index": 1, "quantity": 1}]
    cases = [
        # Sold as size not known: there is no size to clarify.
        (coat_sale(w, (unknown, 1), size_clarified=clarified((0, 1))), "SOLD_AS_SIZE_NOT_KNOWN"),
        # Found from nowhere and taken from "size not known" at once.
        (
            coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1)), found_in_store=found),
            "also be reported found or missing",
        ),
        # Two lines on one shelf are one statement about it, though the
        # shortage on the second line would stand on its own.
        (
            coat_sale(
                w,
                (w.sizes["M"], 1),
                (w.sizes["M"], 2),
                size_clarified=clarified((0, 1)),
                missing_in_store=missing,
            ),
            "also be reported found or missing",
        ),
        # The balance drawn on is itself reported missing.
        (
            coat_sale(
                w,
                (w.sizes["M"], 1),
                (unknown, 2),
                size_clarified=clarified((0, 1)),
                missing_in_store=missing,
            ),
            "SIZE_NOT_KNOWN_REPORTED",
        ),
        # More than the line sells, though another line sells the same size.
        (
            coat_sale(w, (w.sizes["M"], 1), (w.sizes["M"], 1), size_clarified=clarified((0, 2))),
            "MORE_THAN_THE_LINE",
        ),
        (coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((1, 1))), "does not exist"),
        (
            coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1), (0, 1))),
            "Duplicate size_clarified",
        ),
    ]
    async with w.client("manager") as client:
        refused = [
            await client.post("/api/v1/sales", headers=idempotent(), json=body) for body, _ in cases
        ]

    for response, (_, expected) in zip(refused, cases, strict=True):
        assert (response.status_code, response.json()["code"]) == (422, "VALIDATION_ERROR")
        said = f"{response.json()['message']} {response.json().get('details', {}).get('reason')}"
        assert expected in said, said
    assert await stock(w) == {(w.coat, unknown): 2}


async def test_clarifying_a_size_needs_the_correction_permission(world):
    """The same narrow capability as «фізично є», which the default seller
    holds. Once it is taken away, not even the stored answer to an earlier
    clarification is handed back (I13), and the seller still sells the coat
    as size not known."""
    w = world
    unknown = await held_as_size_not_known(w)
    earlier = coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1)))
    earlier_key = idempotent()
    async with w.client("seller") as client:
        granted = await client.post("/api/v1/sales", headers=earlier_key, json=earlier)
        assert granted.status_code == 201, granted.text
    async with w.maker.begin() as session:
        seller_role = select(Role.id).where(Role.organization_id == w.org, Role.code == "SELLER")
        await session.execute(
            delete(RolePermission).where(
                RolePermission.role_id == seller_role.scalar_subquery(),
                RolePermission.permission_code == "inventory:correct_during_sale",
            )
        )
    async with w.client("seller") as client:
        replayed = await client.post("/api/v1/sales", headers=earlier_key, json=earlier)
        clarifying = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json=coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1))),
        )
        as_it_is = await client.post(
            "/api/v1/sales", headers=idempotent(), json=coat_sale(w, (unknown, 1))
        )

    for refused in (replayed, clarifying):
        assert (refused.status_code, refused.json()["code"]) == (403, "PERMISSION_DENIED")
        assert refused.json()["details"]["permission"] == "inventory:correct_during_sale"
    assert as_it_is.status_code == 201, as_it_is.text
    assert await stock(w) == {}


async def test_the_same_command_without_its_clarification_is_a_conflict(world):
    """Invariant I20: without it the command is a different sale. With it, a
    retry after the cache is gone replays the same movements, written once —
    rebuilt from the ledger when no answer was stored."""
    w = world
    unknown = await held_as_size_not_known(w)
    command_id = uuid.uuid4()
    body = coat_sale(w, (w.sizes["M"], 1), command_id=command_id, size_clarified=clarified((0, 1)))
    async with w.client("seller") as client:
        first = await client.post("/api/v1/sales", headers=idempotent(), json=body)
        assert first.status_code == 201, first.text
        without = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json={key: value for key, value in body.items() if key != "size_clarified"},
        )
        retry = await client.post("/api/v1/sales", headers=idempotent(), json=body)
        async with w.maker.begin() as session:
            await session.execute(
                update(Sale).where(Sale.command_id == command_id).values(response_snapshot=None)
            )
        rebuilt = await client.post("/api/v1/sales", headers=idempotent(), json=body)

    assert (without.status_code, without.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    assert retry.status_code == 201, retry.text
    assert retry.json() == first.json()
    assert rebuilt.status_code == 201, rebuilt.text
    assert rebuilt.json() == first.json()
    assert await stock(w) == {(w.coat, unknown): 1}


async def test_two_sellers_clarifying_the_last_coat_sell_it_once(world):
    """The size-not-known balance is locked with the basket: the second sale
    finds it empty, rather than both reading one and each taking it."""
    w = world
    unknown = await held_as_size_not_known(w, 1)
    body = coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1)))
    async with w.client("seller") as seller, w.client("manager") as manager:
        responses = await asyncio.gather(
            seller.post("/api/v1/sales", headers=idempotent(), json=body),
            manager.post(
                "/api/v1/sales",
                headers=idempotent(),
                json={**body, "command_id": str(uuid.uuid4())},
            ),
        )

    assert sorted(response.status_code for response in responses) == [201, 409]
    lost = next(response for response in responses if response.status_code == 409)
    assert lost.json()["code"] == "INSUFFICIENT_STOCK"
    assert await stock(w) == {}
    async with w.maker() as session:
        assert await find_divergences(session, organization_id=w.org) == []
        assert (
            await session.scalar(
                select(func.count())
                .select_from(StockMovement)
                .where(
                    StockMovement.organization_id == w.org,
                    StockMovement.size_id == unknown,
                    StockMovement.reason_code == MovementReason.SIZE_RECLASSIFICATION_OUT,
                )
            )
            == 1
        )


async def test_reserved_goods_are_not_reclassified(world):
    """A reservation holds units of a balance, and this path corrects no
    reserved balance on either side, like «фізично є» and «фізично
    відсутній». The refusal names the balance, so a client can offer what is
    still possible: selling the coat as it is."""
    w = world
    unknown = await held_as_size_not_known(w)

    async def clarify() -> httpx.Response:
        async with w.client("seller") as client:
            return await client.post(
                "/api/v1/sales",
                headers=idempotent(),
                json=coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1))),
            )

    order = uuid.uuid4()
    async with w.maker.begin() as session:
        await reserve_stock(
            session,
            organization_id=w.org,
            store_id=w.main,
            reference_id=order,
            requests=[ReservationRequest(w.shared, w.coat, unknown, 1)],
            actor_user_id=w.users["owner"],
        )
    source_reserved = await clarify()
    async with w.maker.begin() as session:
        await release_stock(
            session,
            organization_id=w.org,
            store_id=w.main,
            reference_id=order,
            actor_user_id=w.users["owner"],
        )
    async with w.client() as client:
        received = await client.post(
            "/api/v1/inventory/receipts",
            headers=idempotent(),
            json={
                "store_id": str(w.main),
                "location_id": str(w.shared),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {"product_variant_id": str(w.coat), "size_id": str(w.sizes["M"]), "quantity": 1}
                ],
            },
        )
        assert received.status_code == 201, received.text
    async with w.maker.begin() as session:
        await reserve_stock(
            session,
            organization_id=w.org,
            store_id=w.main,
            reference_id=uuid.uuid4(),
            requests=[ReservationRequest(w.shared, w.coat, w.sizes["M"], 1)],
            actor_user_id=w.users["owner"],
        )
    size_reserved = await clarify()

    for refused, size in ((source_reserved, unknown), (size_reserved, w.sizes["M"])):
        assert (refused.status_code, refused.json()["code"]) == (422, "VALIDATION_ERROR")
        details = refused.json()["details"]
        assert (details["reason"], details["size_id"]) == ("RESERVED", str(size))
        assert (details["location_id"], details["reserved"]) == (str(w.shared), 1)
    assert await stock(w) == {(w.coat, unknown): 2, (w.coat, w.sizes["M"]): 1}


async def test_a_clarification_is_not_replayed_once_its_private_grant_is_gone(world):
    """I13 at a private warehouse. The seller's own grant in the child store is
    what let them clarify there; once it is gone, an organization-wide grant
    of the same permission does not bring the stored answer back."""
    w = world
    async with w.maker.begin() as session:
        roles = {
            role.code: role.id
            for role in await session.scalars(select(Role).where(Role.organization_id == w.org))
        }
        counter = Role(organization_id=w.org, code="CHILD_COUNTER", name="Counter", is_system=False)
        session.add(counter)
        await session.flush()
        for permission in ("sale:create", "sale:view", "inventory:correct_during_sale"):
            session.add(RolePermission(role_id=counter.id, permission_code=permission))
        users = {}
        for name in ("admin", "seller"):
            user = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name=name)
            session.add(user)
            await session.flush()
            users[name] = user.id
        for user, store, role in (
            (users["admin"], w.second, roles["OWNER"]),
            (users["seller"], w.second, counter.id),
            (users["seller"], None, roles["OWNER"]),
        ):
            session.add(
                Membership(user_id=user, organization_id=w.org, store_id=store, role_id=role)
            )
    async with client_for(w.maker, users["admin"]) as client:
        snapshot = await imported(
            client, w, ["Лоран шоколад 2 шт"], store=w.second, location=w.private
        )
        line = await resolve(
            client,
            snapshot["snapshot_id"],
            1,
            allocations=[allocation(w.coat, None, 2)],
            quantity_basis="STATED",
        )
        assert (await approve(client, snapshot["snapshot_id"], 1)).status_code == 200
    unknown = uuid.UUID(line.json()["line"]["allocations"][0]["size_id"])
    body = {
        **coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1))),
        "store_id": str(w.second),
    }
    body["lines"][0]["source_location_id"] = str(w.private)
    key = idempotent()
    async with client_for(w.maker, users["seller"]) as client:
        original = await client.post("/api/v1/sales", headers=key, json=body)
        assert original.status_code == 201, original.text
        async with w.maker.begin() as session:
            await session.execute(
                delete(RolePermission).where(
                    RolePermission.role_id == counter.id,
                    RolePermission.permission_code == "inventory:correct_during_sale",
                )
            )
        replayed = await client.post("/api/v1/sales", headers=key, json=body)

    assert (replayed.status_code, replayed.json()["code"]) == (403, "PERMISSION_DENIED")
    assert replayed.json()["details"]["permission"] == "inventory:correct_during_sale"
    assert await stock(w, w.private) == {(w.coat, unknown): 1}


async def test_one_basket_clarifies_several_sizes_beside_the_rest_of_it(world):
    """Two sizes read off two coats, a third coat sold as it is, and a
    shortage elsewhere on the rack. One reclassification out of "size not
    known" into both sizes, one audit entry, and the movements listed in the
    stock key's order however the answer is read back."""
    w = world
    unknown = await held_as_size_not_known(w, 4)
    async with w.client() as client:
        received = await client.post(
            "/api/v1/inventory/receipts",
            headers=idempotent(),
            json={
                "store_id": str(w.main),
                "location_id": str(w.shared),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {"product_variant_id": str(w.coat), "size_id": str(w.sizes["S"]), "quantity": 2}
                ],
            },
        )
        assert received.status_code == 201, received.text
    async with w.client("manager") as client:
        sold = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json=coat_sale(
                w,
                (w.sizes["M"], 1),
                (w.sizes["L"], 1),
                (unknown, 1),
                (w.sizes["S"], 2),
                size_clarified=clarified((0, 1), (1, 1)),
                missing_in_store=[{"line_index": 3, "quantity": 1}],
            ),
        )
        assert sold.status_code == 201, sold.text
        body = sold.json()
        async with w.maker.begin() as session:
            await session.execute(
                update(Sale).where(Sale.id == uuid.UUID(body["id"])).values(response_snapshot=None)
            )
        rebuilt = await client.get(f"/api/v1/sales/{body['id']}")

    assert await stock(w) == {(w.coat, unknown): 1}
    async with w.maker() as session:
        legs = (
            await session.execute(
                select(StockMovement.id, StockMovement.size_id, StockMovement.quantity_delta).where(
                    StockMovement.reference_id == uuid.UUID(body["id"]),
                    StockMovement.reason_code.in_(
                        [
                            MovementReason.SIZE_RECLASSIFICATION_OUT,
                            MovementReason.SIZE_RECLASSIFICATION_IN,
                        ]
                    ),
                )
            )
        ).all()
        entries = list(
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.organization_id == w.org,
                    AuditLog.action == "inventory.size_reclassified_during_sale",
                )
            )
        )
        assert await find_divergences(session, organization_id=w.org) == []

    assert sorted((leg.size_id, leg.quantity_delta) for leg in legs) == sorted(
        [(unknown, -2), (w.sizes["M"], 1), (w.sizes["L"], 1)]
    )
    in_key_order = [str(leg.id) for leg in sorted(legs, key=lambda leg: (leg.size_id, leg.id))]
    assert body["size_reclassifications"] == in_key_order
    assert rebuilt.json()["size_reclassifications"] == in_key_order
    assert len(body["shortages"]) == 1
    assert len(entries) == 1
    assert entries[0].before["quantities"] == {
        str(unknown): 4,
        str(w.sizes["M"]): 0,
        str(w.sizes["L"]): 0,
    }
    assert entries[0].after["quantities"] == {
        str(unknown): 2,
        str(w.sizes["M"]): 1,
        str(w.sizes["L"]): 1,
    }


async def test_a_basket_that_clarifies_the_last_such_coat_may_find_another_size(world):
    """«Фізично є» beside "size not known" stock waits until no such coat can
    be the one found. Once the basket itself takes the last of them, none can
    (the review's second finding)."""
    w = world
    unknown = await held_as_size_not_known(w, 2)
    basket = coat_sale(
        w,
        (w.sizes["M"], 1),
        (w.sizes["S"], 1),
        size_clarified=clarified((0, 1)),
        found_in_store=[{"line_index": 1, "quantity": 1}],
    )
    async with w.client("seller") as client:
        one_still_held = await client.post("/api/v1/sales", headers=idempotent(), json=basket)
        as_it_is = await client.post(
            "/api/v1/sales", headers=idempotent(), json=coat_sale(w, (unknown, 1))
        )
        assert as_it_is.status_code == 201, as_it_is.text
        the_last = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json={**basket, "command_id": str(uuid.uuid4())},
        )

    assert (one_still_held.status_code, one_still_held.json()["code"]) == (
        409,
        "UNKNOWN_SIZE_STOCK",
    )
    assert one_still_held.json()["details"]["available"] == 1
    assert the_last.status_code == 201, the_last.text
    assert len(the_last.json()["corrections"]) == 1
    assert len(the_last.json()["size_reclassifications"]) == 2
    assert await stock(w) == {}
    async with w.maker() as session:
        assert await find_divergences(session, organization_id=w.org) == []


async def test_a_model_held_under_two_sizes_nobody_knows_is_not_guessed(world):
    """Never the case while an organization has one "size not known". If it
    ever held two, the seller could not say which balance the coat is from."""
    w = world
    unknown = await held_as_size_not_known(w, 1)
    async with w.maker.begin() as session:
        system = await session.scalar(select(Size.size_system_id).where(Size.id == unknown))
        second = Size(
            size_system_id=system, code=f"UNKNOWN-{uuid.uuid4().hex[:8]}", is_unknown=True
        )
        session.add(second)
        await session.flush()
        other = second.id
        await apply_movements(
            session,
            organization_id=w.org,
            requests=[
                MovementRequest(
                    location_id=w.shared,
                    acting_store_id=w.main,
                    product_variant_id=w.coat,
                    size_id=other,
                    quantity_delta=1,
                    movement_type=MovementType.ADJUSTMENT,
                    reason_code=MovementReason.CORRECTION,
                )
            ],
        )
    async with w.client("seller") as client:
        refused = await client.post(
            "/api/v1/sales",
            headers=idempotent(),
            json=coat_sale(w, (w.sizes["M"], 1), size_clarified=clarified((0, 1))),
        )

    assert (refused.status_code, refused.json()["code"]) == (422, "VALIDATION_ERROR")
    assert refused.json()["details"]["reason"] == "SIZE_NOT_KNOWN_AMBIGUOUS"
    assert await stock(w) == {(w.coat, unknown): 1, (w.coat, other): 1}


async def test_the_size_not_known_balance_is_locked_in_the_basket_s_own_order(world):
    """Locked from the start with the basket's other keys, in the one global
    order, never after them (the review's third test gap). Here "size not
    known" sorts first. So a clarifying sale that finds it taken waits
    holding nothing above it, and a plain sale of both keys, taking them in
    the same order, can never deadlock with it. Proven with `pg_locks`, not
    timing."""
    w = world
    unknown = await held_as_size_not_known(w, 1)
    # All ones in the high half: after any size the server ever generated.
    last = uuid.UUID(int=(2**128 - 2**64) | uuid.uuid4().int % 2**64)
    assert unknown < last
    async with w.maker.begin() as session:
        system = await session.scalar(select(Size.size_system_id).where(Size.id == w.sizes["M"]))
        session.add(Size(id=last, size_system_id=system, code=f"Z{last.hex[-8:]}"))
        await session.flush()
        session.add(
            Inventory(location_id=w.shared, product_variant_id=w.coat, size_id=last, quantity=0)
        )

    lock_row = text(
        "SELECT id FROM inventory WHERE location_id = :location"
        " AND product_variant_id = :variant AND size_id = :size FOR UPDATE NOWAIT"
    )
    async with w.maker() as holder_session:
        await holder_session.execute(
            lock_row, {"location": w.shared, "variant": w.coat, "size": unknown}
        )
        holder = await holder_session.scalar(text("SELECT pg_backend_pid()"))
        async with w.client("seller") as client:
            sale = asyncio.create_task(
                client.post(
                    "/api/v1/sales",
                    headers=idempotent(),
                    json=coat_sale(w, (last, 1), size_clarified=clarified((0, 1))),
                )
            )
            await wait_until_blocked_by(w.engine, holder)
            # The key above the one it waits for is free: NOWAIT would raise.
            async with w.maker() as probe:
                await probe.execute(
                    lock_row, {"location": w.shared, "variant": w.coat, "size": last}
                )
                await probe.rollback()
            await holder_session.rollback()
            sold = await sale

    assert sold.status_code == 201, sold.text
    assert await stock(w) == {}


async def test_a_reclassification_is_never_written_by_halves(world):
    """Nor out of a size anybody knows, nor into "size not known". The
    adjustment command no longer takes either reason, and the ledger's door
    refuses half of one from any caller."""
    w = world
    unknown = await held_as_size_not_known(w, 1)

    def adjustment(size, delta: int, reason: str) -> dict:
        return {
            "store_id": str(w.main),
            "location_id": str(w.shared),
            "command_id": str(uuid.uuid4()),
            "product_variant_id": str(w.coat),
            "size_id": str(size),
            "quantity_delta": delta,
            "reason_code": reason,
        }

    async with w.client() as client:
        halves = [
            await client.post("/api/v1/inventory/adjustments", headers=idempotent(), json=body)
            for body in (
                adjustment(w.sizes["M"], 1, "SIZE_RECLASSIFICATION_IN"),
                adjustment(unknown, -1, "SIZE_RECLASSIFICATION_OUT"),
            )
        ]
    # Refused by the request's own shape, so FastAPI's `detail` names the field.
    assert [
        (response.status_code, response.json()["detail"][0]["loc"][-1]) for response in halves
    ] == [(422, "reason_code")] * 2

    def pair(source, target) -> list[MovementRequest]:
        reference = uuid.uuid4()
        return [
            MovementRequest(
                location_id=w.shared,
                acting_store_id=w.main,
                product_variant_id=w.coat,
                size_id=size,
                quantity_delta=delta,
                movement_type=MovementType.ADJUSTMENT,
                reason_code=reason,
                reference_type="sale",
                reference_id=reference,
            )
            for size, delta, reason in (
                (source, -1, MovementReason.SIZE_RECLASSIFICATION_OUT),
                (target, 1, MovementReason.SIZE_RECLASSIFICATION_IN),
            )
        ]

    async with w.maker() as session:
        with pytest.raises(ValidationFailedError, match="exactly one size"):
            await apply_movements(
                session, organization_id=w.org, requests=pair(unknown, w.sizes["M"])[:1]
            )
    for source, target in ((w.sizes["S"], w.sizes["M"]), (w.sizes["M"], unknown)):
        async with w.maker() as session:
            with pytest.raises(ValidationFailedError, match="size not known are reclassified"):
                await apply_movements(session, organization_id=w.org, requests=pair(source, target))
    assert await stock(w) == {(w.coat, unknown): 1}


async def test_an_opening_balance_cannot_be_written_outside_a_list(world):
    w = world
    async with w.client() as client:
        receipt = await client.post(
            "/api/v1/inventory/receipts",
            headers=idempotent(),
            json={
                "store_id": str(w.main),
                "location_id": str(w.shared),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": str(w.coat),
                        "size_id": str(w.sizes["M"]),
                        "quantity": 1,
                        "acquisition_type": "OPENING_BALANCE",
                    }
                ],
            },
        )
    assert receipt.status_code == 422, receipt.text

    # The ledger's shape check refuses one that names no list and lot...
    with pytest.raises(ValidationFailedError, match="must name the stock list"):
        validate_movement(
            MovementRequest(
                location_id=w.shared,
                acting_store_id=w.main,
                product_variant_id=w.coat,
                size_id=w.sizes["M"],
                quantity_delta=1,
                movement_type=MovementType.OPENING_BALANCE,
            )
        )
    # ...and the ledger's public door refuses even one that does: only the
    # approval, which holds the warehouse and checks its history, writes it.
    async with w.maker() as session:
        with pytest.raises(ValidationFailedError, match="only by approving a stock list"):
            await apply_movements(
                session,
                organization_id=w.org,
                requests=[
                    MovementRequest(
                        location_id=w.shared,
                        acting_store_id=w.main,
                        product_variant_id=w.coat,
                        size_id=w.sizes["M"],
                        quantity_delta=1,
                        movement_type=MovementType.OPENING_BALANCE,
                        stock_lot_id=uuid.uuid4(),
                        reference_type=OPENING_BALANCE_REFERENCE,
                        reference_id=uuid.uuid4(),
                    )
                ],
            )

    # And past the service, straight at the database: refused there too. The
    # trace trigger runs first (a BEFORE trigger precedes the CHECKs)...
    shapeless = text(
        "INSERT INTO stock_movement (id, organization_id, location_id, acting_store_id,"
        " product_variant_id, size_id, movement_type, quantity_delta, created_at)"
        " VALUES (gen_random_uuid(), :org, :loc, :store, :variant, :size,"
        " 'OPENING_BALANCE', 1, now())"
    )
    key = {"org": w.org, "loc": w.shared, "store": w.main, "variant": w.coat, "size": w.sizes["M"]}
    async with w.maker() as session:
        with pytest.raises(DBAPIError, match="must come from an opening lot"):
            await session.execute(shapeless, key)
    # ...and behind it the CHECK states the shape on its own. The trigger is
    # set aside only inside this transaction, which is rolled back.
    async with w.maker() as session:
        await session.execute(
            text("ALTER TABLE stock_movement DISABLE TRIGGER opening_balance_traces_to_its_list")
        )
        with pytest.raises(DBAPIError, match="opening_balance_names_its_list"):
            await session.execute(shapeless, key)
    async with w.maker() as session:
        with pytest.raises(DBAPIError, match="opening_lot_names_its_list"):
            session.add(
                StockLot(
                    organization_id=w.org,
                    location_id=w.shared,
                    product_variant_id=w.coat,
                    size_id=w.sizes["M"],
                    acquisition_type=AcquisitionType.OPENING_BALANCE,
                )
            )
            await session.flush()

    # A well-formed one that names a list but rides on a purchased lot: the
    # database traces the lot, not just the shape (the reviews' I17 finding).
    async with w.client() as client:
        bought = await client.post(
            "/api/v1/inventory/receipts",
            headers=idempotent(),
            json={
                "store_id": str(w.main),
                "location_id": str(w.shared),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": str(w.bottega),
                        "size_id": str(w.sizes["M"]),
                        "quantity": 1,
                    }
                ],
            },
        )
        assert bought.status_code == 201, bought.text
    async with w.maker() as session:
        with pytest.raises(DBAPIError, match="must come from an opening lot"):
            await session.execute(
                text(
                    "INSERT INTO stock_movement (id, organization_id, location_id, acting_store_id,"
                    " product_variant_id, size_id, movement_type, quantity_delta, stock_lot_id,"
                    " reference_type, reference_id, created_at)"
                    " VALUES (gen_random_uuid(), :org, :loc, :store, :variant, :size,"
                    " 'OPENING_BALANCE', 1, :lot, 'inventory_snapshot', gen_random_uuid(), now())"
                ),
                {
                    "org": w.org,
                    "loc": w.shared,
                    "store": w.main,
                    "variant": w.bottega,
                    "size": w.sizes["M"],
                    "lot": uuid.UUID(bought.json()["lines"][0]["stock_lot_id"]),
                },
            )


async def test_a_decided_list_is_frozen_by_the_database(world):
    w = world
    async with w.client() as client:
        applied = await prepared(client, w)
        assert (await approve(client, applied["snapshot_id"], 3)).status_code == 200
        rejected = await imported(client, w)
        response = await client.post(
            f"/api/v1/snapshots/{rejected['snapshot_id']}/reject", json={"reason": "не той склад"}
        )
        assert response.status_code == 200
        waiting = await prepared(client, w)

    statements = [
        ("UPDATE inventory_snapshot SET captured_at = 'інший день' WHERE id = :id", applied),
        ("DELETE FROM inventory_snapshot WHERE id = :id", applied),
        (
            "UPDATE inventory_snapshot_row SET resolution_note = 'x' "
            "WHERE inventory_snapshot_id = :id",
            applied,
        ),
        (
            "UPDATE inventory_snapshot_allocation SET quantity = quantity + 1 "
            "WHERE snapshot_row_id IN "
            "(SELECT id FROM inventory_snapshot_row WHERE inventory_snapshot_id = :id)",
            applied,
        ),
        ("UPDATE inventory_snapshot SET rejection_reason = 'y' WHERE id = :id", rejected),
        (
            "DELETE FROM inventory_snapshot_row WHERE inventory_snapshot_id = :id",
            rejected,
        ),
    ]
    for statement, snapshot in statements:
        async with w.maker() as session:
            with pytest.raises(DBAPIError, match="can no longer change"):
                await session.execute(text(statement), {"id": uuid.UUID(snapshot["snapshot_id"])})

    # Moving a waiting list's answer into an applied one changes the applied
    # list, even though the answer came from a list still under review.
    async with w.maker() as session:
        with pytest.raises(DBAPIError, match="APPLIED and can no longer change"):
            await session.execute(
                text(
                    "UPDATE inventory_snapshot_allocation SET snapshot_row_id = ("
                    " SELECT id FROM inventory_snapshot_row"
                    " WHERE inventory_snapshot_id = :applied AND line_no = 3)"
                    " WHERE id = (SELECT a.id FROM inventory_snapshot_allocation a"
                    " JOIN inventory_snapshot_row r ON r.id = a.snapshot_row_id"
                    " WHERE r.inventory_snapshot_id = :waiting ORDER BY a.id LIMIT 1)"
                ),
                {
                    "applied": uuid.UUID(applied["snapshot_id"]),
                    "waiting": uuid.UUID(waiting["snapshot_id"]),
                },
            )


# ---------------------------------------------------------------------------
# Rejection
# ---------------------------------------------------------------------------


async def test_a_rejected_list_keeps_its_evidence_and_becomes_no_stock(world):
    w = world
    async with w.client() as client:
        view = await prepared(client, w)
        snapshot_id = view["snapshot_id"]
        rejected = await client.post(
            f"/api/v1/snapshots/{snapshot_id}/reject", json={"reason": "не той склад"}
        )
        again = await client.post(
            f"/api/v1/snapshots/{snapshot_id}/reject", json={"reason": "не той склад"}
        )
        changed = await client.post(
            f"/api/v1/snapshots/{snapshot_id}/reject", json={"reason": "інша причина"}
        )
        approval = await approve(client, snapshot_id, 3)
        review = await resolve(client, snapshot_id, 3, skip_reason="пізно")
        lines = await client.get(f"/api/v1/snapshots/{snapshot_id}/lines")

    body = rejected.json()
    assert rejected.status_code == 200, rejected.text
    assert (body["status"], body["rejection_reason"]) == ("REJECTED", "не той склад")
    assert body["rejected_by_user_id"] == str(w.users["owner"])
    assert again.status_code == 200
    assert (changed.status_code, changed.json()["code"]) == (409, "IDEMPOTENCY_CONFLICT")
    assert (approval.status_code, approval.json()["details"]["reason"]) == (409, "ALREADY_DECIDED")
    assert (review.status_code, review.json()["details"]["reason"]) == (409, "ALREADY_DECIDED")
    # The evidence and the answers stay readable.
    assert [item["raw_text"] for item in lines.json()["items"]] == LIST
    assert [item["status"] for item in lines.json()["items"]] == [
        "RESOLVED",
        "RESOLVED",
        "SKIPPED",
    ]
    assert not await movements(w)


# ---------------------------------------------------------------------------
# Reads and tenancy
# ---------------------------------------------------------------------------


async def test_another_organization_cannot_see_or_touch_a_list(world):
    w = world
    other = await seed_world(w.maker)
    async with w.client() as client:
        view = await prepared(client, w)
    snapshot_id = view["snapshot_id"]
    async with client_for(w.maker, other["users"]["owner"]) as client:
        responses = [
            await client.get(f"/api/v1/snapshots/{snapshot_id}"),
            await client.get(f"/api/v1/snapshots/{snapshot_id}/lines"),
            await resolve(client, snapshot_id, 3, skip_reason="чуже"),
            await approve(client, snapshot_id, 3),
            await client.post(f"/api/v1/snapshots/{snapshot_id}/reject", json={"reason": "чуже"}),
        ]
        listing = await client.get("/api/v1/snapshots", params={"store_id": str(other["main"])})

    for response in responses:
        assert (response.status_code, response.json()["code"]) == (404, "NOT_FOUND")
    assert listing.json()["items"] == []
    assert not await movements(w)


async def test_the_list_of_lists_leaves_out_what_a_person_may_not_see(world):
    w = world
    async with w.client("child_manager") as client:
        private = await imported(client, w, store=w.second, location=w.private)
    async with w.client() as client:
        shared = await imported(client, w, store=w.second)
        owner_view = await client.get("/api/v1/snapshots", params={"store_id": str(w.second)})
        filtered = await client.get(
            "/api/v1/snapshots", params={"store_id": str(w.second), "status": "APPLIED"}
        )
        first_page = await client.get(
            "/api/v1/snapshots", params={"store_id": str(w.second), "limit": 1}
        )
    async with w.client("child_manager") as client:
        child_view = await client.get("/api/v1/snapshots", params={"store_id": str(w.second)})

    assert [item["snapshot_id"] for item in owner_view.json()["items"]] == [shared["snapshot_id"]]
    assert filtered.json()["items"] == []
    # Left out in the query itself: a page does not even say more exist.
    assert [item["snapshot_id"] for item in first_page.json()["items"]] == [shared["snapshot_id"]]
    assert first_page.json()["has_more"] is False
    assert {item["snapshot_id"] for item in child_view.json()["items"]} == {
        private["snapshot_id"],
        shared["snapshot_id"],
    }


async def test_a_page_of_lines_can_be_filtered_by_status(world):
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w)
        await resolve(client, snapshot["snapshot_id"], 3, skip_reason="заголовок")
        skipped = await client.get(
            f"/api/v1/snapshots/{snapshot['snapshot_id']}/lines", params={"status": "SKIPPED"}
        )
        waiting = await client.get(
            f"/api/v1/snapshots/{snapshot['snapshot_id']}/lines",
            params={"status": "NEEDS_REVIEW", "limit": 1},
        )

    assert [item["line_no"] for item in skipped.json()["items"]] == [3]
    assert len(waiting.json()["items"]) == 1
    assert waiting.json()["has_more"] is True


async def test_a_list_row_keeps_the_quantity_its_line_stated(world):
    """The parser's reading of the line is evidence: a person's different
    answer sits beside it and never overwrites it."""
    w = world
    async with w.client() as client:
        snapshot = await imported(client, w, ["Бомбер шоколад 3 шт"])
        await resolve(
            client,
            snapshot["snapshot_id"],
            1,
            allocations=[allocation(w.coat, None, 2)],
            quantity_basis="RECOUNTED",
            note="одна продана до обліку",
        )
    async with w.maker() as session:
        row = await session.scalar(
            select(InventorySnapshotRow).where(
                InventorySnapshotRow.inventory_snapshot_id == uuid.UUID(snapshot["snapshot_id"])
            )
        )
        assert (row.quantity_state, row.quantity_total) == (SnapshotQuantityState.KNOWN, 3)
        assert row.status is SnapshotRowStatus.RESOLVED
    async with w.maker() as session:
        status = await session.scalar(
            select(InventorySnapshot.status).where(
                InventorySnapshot.id == uuid.UUID(snapshot["snapshot_id"])
            )
        )
        assert status is SnapshotStatus.IN_REVIEW


async def test_the_migration_holds_the_lists_already_waiting():
    """`0030` gives each list already waiting its hold, and a decided list
    none. Its downgrade drops the holds and loses nothing: a hold is only
    ever derived from a list that waits."""
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_holds_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = create_async_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        seeded = await seed_world(maker)
        lists = []
        async with client_for(maker, seeded["users"]["owner"]) as client:
            for _ in range(2):
                response = await client.post(
                    "/api/v1/snapshots",
                    json={
                        "command_id": str(uuid.uuid4()),
                        "store_id": str(seeded["main"]),
                        "location_id": str(seeded["shared"]),
                        "lines": LIST,
                    },
                )
                assert response.status_code == 201, response.text
                lists.append(response.json()["snapshot_id"])
            rejected = await client.post(
                f"/api/v1/snapshots/{lists[1]}/reject", json={"reason": "дубль"}
            )
            assert rejected.status_code == 200, rejected.text

        await _run(config, "downgrade", "0029_borrowed_goods", database=name)
        async with engine.connect() as connection:
            assert await connection.scalar(text("SELECT to_regclass('opening_list_hold')")) is None
        await _run(config, "upgrade", "head", database=name)

        async with maker() as session:
            held = (await session.scalars(select(OpeningListHold.snapshot_id))).all()
        assert held == [uuid.UUID(lists[0])]
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
