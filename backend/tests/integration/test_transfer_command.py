"""M1-018 — moving goods between warehouses, over HTTP against real PostgreSQL.

The shape is the owner's (2026-09-15, refined 2026-09-17):

    W-SHARED   the primary store's warehouse — both stores sell from it
    W-CHILD    the child store's own warehouse

A transfer is how a coat gets from one to the other: a `TRANSFER_OUT` at the
source and a `TRANSFER_IN` at the destination, in one transaction, and never a
sale (invariants I16 and I24).

Every access row is written out explicitly, as in `test_shared_warehouse.py`:
nothing is derived from a store's name or kind, or these tests would prove the
wrong thing.

What each test is evidence for is named in its docstring. All data is
synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.core.errors import (
    InsufficientStockError,
    LocationAccessDeniedError,
    PermissionDeniedError,
)
from app.core.idempotency import IdempotencyRecord
from app.main import create_app
from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.identity.models import AppUser
from app.modules.inventory.models import Inventory, MovementType, StockMovement
from app.modules.inventory.service import find_divergences
from app.modules.sales.models import Sale
from app.modules.sales.payment import PaymentMethod
from app.modules.tenancy.models import (
    Organization,
    Store,
    StoreKind,
    StoreLocationAccess,
    StoreState,
)
from app.modules.transfers.models import Transfer, TransferItem, TransferStatus
from tests.conftest import provision_location, requires_database

pytestmark = [pytest.mark.integration, requires_database()]

SETTINGS = Settings(app_env="local", session_secret="transfer-command-secret-at-least-32-bytes")
SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]


@dataclass(frozen=True, slots=True)
class Shops:
    """One organization, two stores, two warehouses, one of them shared."""

    organization_id: uuid.UUID
    primary_store: uuid.UUID
    child_store: uuid.UUID
    shared_warehouse: uuid.UUID
    child_warehouse: uuid.UUID
    user_id: uuid.UUID

    def scope(
        self, store_id: uuid.UUID, permissions: frozenset[Permission] = MANAGER
    ) -> RequestScope:
        return RequestScope(
            user_id=self.user_id,
            organization_id=self.organization_id,
            store_permissions={store_id: permissions},
        )


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def make_shops(
    maker: async_sessionmaker[AsyncSession], *, child_may_receive_shared: bool = True
) -> Shops:
    """The owner's shape (2026-09-15): both stores sell from the shared
    warehouse, and the child store also has its own. The child store reaches
    the shared warehouse because of a row written here, never because of its
    kind.

    By default that row also lets the child store *receive* there, so goods
    can be moved back in both directions. The owner confirmed selling, not
    receiving; `child_may_receive_shared=False` is design §3's sell-only row,
    and the tests that depend on the difference use it."""
    async with maker() as session:
        org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", currency_code="UAH")
        session.add(org)
        await session.flush()
        primary = Store(
            organization_id=org.id, name="Основний", code="MAIN", kind=StoreKind.PRIMARY
        )
        child = Store(
            organization_id=org.id, name="Дочірній", code="CHILD", kind=StoreKind.SECONDARY
        )
        user = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name="Ірина")
        session.add_all([primary, child, user])
        await session.flush()

        shared = await provision_location(
            session,
            organization_id=org.id,
            store_id=primary.id,
            code="W-SHARED",
            name="Основний склад",
        )
        session.add(
            StoreLocationAccess(
                organization_id=org.id,
                store_id=child.id,
                location_id=shared,
                can_sell=True,
                can_receive=child_may_receive_shared,
            )
        )
        child_warehouse = await provision_location(
            session,
            organization_id=org.id,
            store_id=child.id,
            code="W-CHILD",
            name="Склад дочірнього",
        )
        await session.commit()
        return Shops(
            organization_id=org.id,
            primary_store=primary.id,
            child_store=child.id,
            shared_warehouse=shared,
            child_warehouse=child_warehouse,
            user_id=user.id,
        )


@asynccontextmanager
async def api(
    maker: async_sessionmaker[AsyncSession], scope: RequestScope
) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(SETTINGS)

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[get_current_scope] = lambda: scope
    app.dependency_overrides[session_dependency] = sessions
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


def key() -> dict[str, str]:
    return {"Idempotency-Key": str(uuid.uuid4())}


async def wait_until_blocked_by(engine: AsyncEngine, holder_pid: int) -> None:
    """Assert that some backend is genuinely waiting on `holder_pid`'s locks.

    Asked of PostgreSQL itself rather than inferred from a task not having
    finished yet: "not done after a sleep" is also what a slow machine looks
    like. `pg_locks` is read afresh by every query. `pg_stat_activity` is not:
    a backend takes it once per transaction, so a session that connects after
    the first look — the one this is waiting for — would never appear.
    """
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


@dataclass(frozen=True, slots=True)
class Coat:
    variant: str
    sizes: dict[str, str]  # size code -> size id

    def size(self, code: str = "M") -> str:
        return self.sizes[code]


async def stock(
    maker: async_sessionmaker[AsyncSession],
    shops: Shops,
    *,
    warehouse: uuid.UUID,
    store: uuid.UUID,
    quantities: dict[str, int],
    coat: Coat | None = None,
) -> Coat:
    """Create a coat (unless one is given) and receive `quantities` of it,
    size by size, into one warehouse on one store's authority."""
    async with api(maker, shops.scope(store)) as client:
        if coat is None:
            created = await client.post(
                "/api/v1/catalog/products",
                json={
                    "store_id": str(store),
                    "concept": f"Лоран-{uuid.uuid4().hex[:8]}",
                    "variant": {"color": "шоколад"},
                    "sizes": [{"system": "ALPHA", "code": code} for code in quantities],
                },
                headers=key(),
            )
            assert created.status_code == 201, created.text
            product = created.json()
            coat = Coat(
                variant=str(product["product_variant_id"]),
                sizes={size["code"]: str(size["size_id"]) for size in product["sizes"]},
            )
        received = await client.post(
            "/api/v1/inventory/receipts",
            json={
                "store_id": str(store),
                "location_id": str(warehouse),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": coat.variant,
                        "size_id": coat.size(code),
                        "quantity": qty,
                    }
                    for code, qty in quantities.items()
                    if qty > 0
                ],
            },
            headers=key(),
        )
        assert received.status_code == 201, received.text
    return coat


def transfer_body(
    shops: Shops,
    *,
    source: uuid.UUID,
    destination: uuid.UUID,
    lines: list[tuple[str, str, int]],
    store: uuid.UUID | None = None,
    command_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    return {
        "store_id": str(store or shops.child_store),
        "command_id": str(command_id or uuid.uuid4()),
        "from_location_id": str(source),
        "to_location_id": str(destination),
        "lines": [
            {"product_variant_id": variant, "size_id": size, "quantity": quantity}
            for variant, size, quantity in lines
        ],
    }


async def quantity_at(session: AsyncSession, warehouse: uuid.UUID, variant: str, size: str) -> int:
    return (
        await session.scalar(
            select(Inventory.quantity).where(
                Inventory.location_id == warehouse,
                Inventory.product_variant_id == uuid.UUID(variant),
                Inventory.size_id == uuid.UUID(size),
            )
        )
    ) or 0


async def transfer_movements(session: AsyncSession, shops: Shops) -> list[StockMovement]:
    return list(
        (
            await session.scalars(
                select(StockMovement)
                .where(
                    StockMovement.organization_id == shops.organization_id,
                    StockMovement.movement_type.in_(
                        [MovementType.TRANSFER_OUT, MovementType.TRANSFER_IN]
                    ),
                )
                .order_by(StockMovement.created_at, StockMovement.id)
            )
        ).all()
    )


async def count(session: AsyncSession, model: Any, shops: Shops) -> int:
    return (
        await session.scalar(
            select(func.count())
            .select_from(model)
            .where(model.organization_id == shops.organization_id)
        )
    ) or 0


async def assert_nothing_moved(
    maker: async_sessionmaker[AsyncSession], shops: Shops, coat: Coat, *, shared: int, child: int
) -> None:
    """A refusal leaves no transfer, no ledger row, no cached answer, and the
    shelves exactly as they were."""
    async with maker() as session:
        assert await count(session, Transfer, shops) == 0
        assert await transfer_movements(session, shops) == []
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == (
            shared
        )
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == (
            child
        )
        # Refused before the key was claimed, or rolled back with the claim:
        # either way the client may retry the same key once it is allowed.
        assert (
            await session.scalar(
                select(func.count())
                .select_from(IdempotencyRecord)
                .where(
                    IdempotencyRecord.organization_id == shops.organization_id,
                    IdempotencyRecord.endpoint == "POST /transfers",
                )
            )
            == 0
        )
        assert await find_divergences(session, organization_id=shops.organization_id) == []


# ---------------------------------------------------------------------------
# The move itself
# ---------------------------------------------------------------------------


async def test_a_transfer_moves_goods_between_warehouses_and_nothing_else(maker):
    """The whole contract of M1-018 in one scenario.

    Two coats of size M and one of size L go from the shared warehouse to the
    child's own. Afterwards: the shelves moved by exactly that much; each line
    left one `TRANSFER_OUT` and one `TRANSFER_IN` pointing back at the
    transfer (I24); the child store is recorded as the store that did it; no
    sale exists and no money moved (I16); the audit entry states the balances
    before and after at both places; and the ledger still explains every
    balance (I3).
    """
    shops = await make_shops(maker)
    coat = await stock(
        maker,
        shops,
        warehouse=shops.shared_warehouse,
        store=shops.primary_store,
        quantities={"M": 5, "L": 1},
    )
    body = transfer_body(
        shops,
        source=shops.shared_warehouse,
        destination=shops.child_warehouse,
        lines=[(coat.variant, coat.size("M"), 2), (coat.variant, coat.size("L"), 1)],
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post("/api/v1/transfers", json=body, headers=key())
    assert response.status_code == 201, response.text
    moved = response.json()

    assert moved["store_id"] == str(shops.child_store)
    assert moved["from_location_id"] == str(shops.shared_warehouse)
    assert moved["to_location_id"] == str(shops.child_warehouse)
    # Single-step until the owner answers Q5: sent and received at once.
    assert moved["status"] == TransferStatus.RECEIVED.value
    assert moved["sent_at"] is not None
    assert moved["sent_at"] == moved["received_at"]
    assert sorted((item["size_id"], item["quantity"]) for item in moved["items"]) == sorted(
        [(coat.size("M"), 2), (coat.size("L"), 1)]
    )
    assert len(moved["movements"]) == 4

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size("M")) == 3
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size("M")) == 2
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size("L")) == 0
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size("L")) == 1

        legs = await transfer_movements(session, shops)
        assert sorted(str(leg.id) for leg in legs) == sorted(moved["movements"])
        by_leg = {
            (leg.movement_type, leg.location_id, str(leg.size_id)): leg.quantity_delta
            for leg in legs
        }
        assert by_leg == {
            (MovementType.TRANSFER_OUT, shops.shared_warehouse, coat.size("M")): -2,
            (MovementType.TRANSFER_IN, shops.child_warehouse, coat.size("M")): 2,
            (MovementType.TRANSFER_OUT, shops.shared_warehouse, coat.size("L")): -1,
            (MovementType.TRANSFER_IN, shops.child_warehouse, coat.size("L")): 1,
        }
        assert {leg.reference_type for leg in legs} == {"transfer"}
        assert {str(leg.reference_id) for leg in legs} == {moved["id"]}
        # Where the goods went and which store moved them are separate facts.
        assert {leg.acting_store_id for leg in legs} == {shops.child_store}
        assert {leg.actor_user_id for leg in legs} == {shops.user_id}

        transfer = await session.get(Transfer, uuid.UUID(moved["id"]))
        assert transfer is not None
        assert transfer.initiating_store_id == shops.child_store
        assert transfer.created_by_user_id == shops.user_id
        assert transfer.command_id == uuid.UUID(body["command_id"])
        assert transfer.command_fingerprint is not None
        assert transfer.response_snapshot == moved
        items = (
            await session.scalars(
                select(TransferItem).where(TransferItem.transfer_id == transfer.id)
            )
        ).all()
        assert sorted((str(item.size_id), item.quantity) for item in items) == sorted(
            [(coat.size("M"), 2), (coat.size("L"), 1)]
        )

        # A transfer is never a sale: no receipt, no revenue.
        assert await count(session, Sale, shops) == 0

        audit = (
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.organization_id == shops.organization_id,
                    AuditLog.action == "inventory.transferred",
                )
            )
        ).one()
        assert audit.entity_type == "transfer"
        assert audit.entity_id == transfer.id
        assert audit.actor_user_id == shops.user_id
        assert audit.before is not None
        assert audit.after is not None
        before = {line["size_id"]: line for line in audit.before["lines"]}
        after = {line["size_id"]: line for line in audit.after["lines"]}
        assert (before[coat.size("M")]["from_quantity"], before[coat.size("M")]["to_quantity"]) == (
            5,
            0,
        )
        assert (after[coat.size("M")]["from_quantity"], after[coat.size("M")]["to_quantity"]) == (
            3,
            2,
        )
        assert after[coat.size("M")]["quantity"] == 2
        assert audit.after["from_location_id"] == str(shops.shared_warehouse)
        assert audit.after["to_location_id"] == str(shops.child_warehouse)

        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_goods_can_move_back_the_other_way(maker):
    """Nothing about a warehouse makes it only a source or only a destination:
    that is decided by the access rows alone."""
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=shops.shared_warehouse,
                lines=[(coat.variant, coat.size(), 2)],
            ),
            headers=key(),
        )
    assert response.status_code == 201, response.text
    async with maker() as session:
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 0
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == 2
        assert await find_divergences(session, organization_id=shops.organization_id) == []


# ---------------------------------------------------------------------------
# Refusals — each leaves nothing behind
# ---------------------------------------------------------------------------


async def test_a_shortfall_at_the_source_moves_nothing_at_all(maker):
    """All or nothing. Two lines, the second one short: the first does not move
    either, and the answer does not offer a correction — only a sale has one.
    The whole transfer is decided before any leg is written, so this holds
    whichever order the legs would have been applied in."""
    shops = await make_shops(maker)
    coat = await stock(
        maker,
        shops,
        warehouse=shops.shared_warehouse,
        store=shops.primary_store,
        quantities={"M": 1, "L": 1},
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.shared_warehouse,
                destination=shops.child_warehouse,
                lines=[(coat.variant, coat.size("M"), 1), (coat.variant, coat.size("L"), 3)],
            ),
            headers=key(),
        )
    assert response.status_code == 409, response.text
    error = response.json()
    assert error["code"] == "INSUFFICIENT_STOCK"
    assert error["details"]["location_id"] == str(shops.shared_warehouse)
    assert error["details"]["available"] == 1
    assert error["details"]["requested"] == 3
    assert error["details"]["correctable"] is False

    await assert_nothing_moved(maker, shops, coat, shared=1, child=0)
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size("L")) == 1


async def test_a_shortfall_never_takes_goods_from_another_warehouse(maker):
    """The source is the one named. Stock standing elsewhere is not a fallback
    — the owner's rule for sales (2026-09-17) holds for transfers too."""
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 5}
    )
    third = await _third_warehouse(maker, shops)
    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.shared_warehouse,
                destination=third,
                lines=[(coat.variant, coat.size(), 1)],
            ),
            headers=key(),
        )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "INSUFFICIENT_STOCK"
    async with maker() as session:
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 5
        assert await transfer_movements(session, shops) == []


async def test_the_same_warehouse_on_both_ends_is_refused(maker):
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=shops.child_warehouse,
                lines=[(coat.variant, coat.size(), 1)],
            ),
            headers=key(),
        )
    assert response.status_code == 422, response.text
    await assert_nothing_moved(maker, shops, coat, shared=0, child=2)


async def test_one_product_and_size_twice_in_one_transfer_is_refused(maker):
    """The client adds its own lines up. A server that summed them would record
    a transfer nobody wrote down."""
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 5}
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=shops.shared_warehouse,
                lines=[(coat.variant, coat.size(), 1), (coat.variant, coat.size(), 2)],
            ),
            headers=key(),
        )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"
    # The service's own refusal, which names the problem — not the ledger's
    # pairing rule further down, which would refuse it less helpfully.
    assert "only once" in response.json()["message"]
    await assert_nothing_moved(maker, shops, coat, shared=0, child=5)


@pytest.mark.parametrize(
    ("field", "value"),
    [("unit_cost", "870.00"), ("price", "1500.00"), ("quantity", "2"), ("quantity", True)],
)
async def test_money_and_loosely_typed_quantities_are_refused_not_ignored(maker, field, value):
    """A transfer carries no money, and a quantity is a number the client
    meant, not one the schema coerced out of a string or a boolean."""
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 5}
    )
    body = transfer_body(
        shops,
        source=shops.child_warehouse,
        destination=shops.shared_warehouse,
        lines=[(coat.variant, coat.size(), 1)],
    )
    body["lines"][0][field] = value
    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post("/api/v1/transfers", json=body, headers=key())
    assert response.status_code == 422, response.text
    await assert_nothing_moved(maker, shops, coat, shared=0, child=5)


# ---------------------------------------------------------------------------
# Authority: the person, and the store, independently
# ---------------------------------------------------------------------------


async def test_a_seller_without_the_permission_is_refused_despite_warehouse_access(maker):
    """`transfer:create` is not in the seller default. Access to both
    warehouses does not stand in for it: the two checks answer different
    questions."""
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    assert Permission.TRANSFER_CREATE not in SELLER
    async with api(maker, shops.scope(shops.child_store, SELLER)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=shops.shared_warehouse,
                lines=[(coat.variant, coat.size(), 1)],
            ),
            headers=key(),
        )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "PERMISSION_DENIED"
    await assert_nothing_moved(maker, shops, coat, shared=0, child=2)


async def test_the_store_must_be_allowed_to_take_goods_out_of_the_source(maker):
    """An access row that lets a store *receive* at a warehouse does not let it
    empty that warehouse. Taking goods out is `can_sell` (design §1.6)."""
    shops = await make_shops(maker)
    coat = await stock(
        maker,
        shops,
        warehouse=shops.shared_warehouse,
        store=shops.primary_store,
        quantities={"M": 2},
    )
    async with maker() as session:
        await session.execute(
            update(StoreLocationAccess)
            .where(
                StoreLocationAccess.store_id == shops.child_store,
                StoreLocationAccess.location_id == shops.shared_warehouse,
            )
            .values(can_sell=False, can_receive=True)
        )
        await session.commit()

    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.shared_warehouse,
                destination=shops.child_warehouse,
                lines=[(coat.variant, coat.size(), 1)],
            ),
            headers=key(),
        )
    assert response.status_code == 403, response.text
    error = response.json()
    assert error["code"] == "LOCATION_ACCESS_DENIED"
    assert error["details"]["capability"] == "can_sell"
    await assert_nothing_moved(maker, shops, coat, shared=2, child=0)


async def test_the_store_must_be_allowed_to_receive_at_the_destination(maker):
    """The child store may sell from the shared warehouse but, in this shape,
    not deliver into it. A transfer into it is a delivery, and is refused."""
    shops = await make_shops(maker, child_may_receive_shared=False)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=shops.shared_warehouse,
                lines=[(coat.variant, coat.size(), 1)],
            ),
            headers=key(),
        )
    assert response.status_code == 403, response.text
    error = response.json()
    assert error["code"] == "LOCATION_ACCESS_DENIED"
    assert error["details"]["capability"] == "can_receive"
    await assert_nothing_moved(maker, shops, coat, shared=0, child=2)


async def test_a_store_that_does_not_reach_one_end_cannot_move_goods_there(maker):
    """The primary store was never granted the child's warehouse. Holding
    `transfer:create` and reaching the source is not enough."""
    shops = await make_shops(maker)
    coat = await stock(
        maker,
        shops,
        warehouse=shops.shared_warehouse,
        store=shops.primary_store,
        quantities={"M": 2},
    )
    async with api(maker, shops.scope(shops.primary_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                store=shops.primary_store,
                source=shops.shared_warehouse,
                destination=shops.child_warehouse,
                lines=[(coat.variant, coat.size(), 1)],
            ),
            headers=key(),
        )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "LOCATION_ACCESS_DENIED"
    await assert_nothing_moved(maker, shops, coat, shared=2, child=0)


async def test_another_organizations_warehouse_is_a_404_that_discloses_nothing(maker):
    """Invariant I12. The answer for a foreign warehouse is the answer for one
    that does not exist."""
    shops = await make_shops(maker)
    theirs = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        foreign = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=theirs.child_warehouse,
                lines=[(coat.variant, coat.size(), 1)],
            ),
            headers=key(),
        )
        missing = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=uuid.uuid4(),
                lines=[(coat.variant, coat.size(), 1)],
            ),
            headers=key(),
        )
    assert foreign.status_code == missing.status_code == 404, (foreign.text, missing.text)
    assert (
        foreign.json()
        == missing.json()
        == {
            "code": "NOT_FOUND",
            "message": "Unknown stock location",
        }
    )
    await assert_nothing_moved(maker, shops, coat, shared=0, child=2)


async def test_another_organizations_product_cannot_be_moved(maker):
    """Both warehouses are ours; the coat is not."""
    shops = await make_shops(maker)
    theirs = await make_shops(maker)
    their_coat = await stock(
        maker,
        theirs,
        warehouse=theirs.child_warehouse,
        store=theirs.child_store,
        quantities={"M": 2},
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=shops.shared_warehouse,
                lines=[(their_coat.variant, their_coat.size(), 1)],
            ),
            headers=key(),
        )
    assert response.status_code == 404, response.text
    async with maker() as session:
        assert await count(session, Transfer, shops) == 0
        assert (
            await quantity_at(
                session, theirs.child_warehouse, their_coat.variant, their_coat.size()
            )
            == 2
        )


@pytest.mark.parametrize("closed", ["source", "destination"])
async def test_a_closed_warehouse_is_neither_source_nor_destination(maker, closed):
    """A closed warehouse is refused by every stock command, and a transfer is
    one of them. Design §1.11 proposed letting goods out of a closed one; that
    is not built, because the owner has not said what closing a warehouse
    means (open question in the M1-018 report). If the answer is "let them
    out", this is the test that changes."""
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    frozen = shops.child_warehouse if closed == "source" else shops.shared_warehouse
    from app.modules.tenancy.models import StockLocation

    async with maker() as session:
        await session.execute(
            update(StockLocation).where(StockLocation.id == frozen).values(is_active=False)
        )
        await session.commit()

    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=shops.shared_warehouse,
                lines=[(coat.variant, coat.size(), 1)],
            ),
            headers=key(),
        )
    assert response.status_code == 404, response.text
    await assert_nothing_moved(maker, shops, coat, shared=0, child=2)


async def test_a_store_that_is_not_trading_does_not_move_goods(maker):
    """The rule every stock command obeys: the initiating store is the acting
    store, and a blocked store does nothing (owner decisions, 2026-10-01).
    Refused at the ledger's door by name, even for a scope built before the
    store was blocked."""
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    async with maker() as session:
        await session.execute(
            update(Store).where(Store.id == shops.child_store).values(state=StoreState.BLOCKED)
        )
        await session.commit()

    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=shops.shared_warehouse,
                lines=[(coat.variant, coat.size(), 1)],
            ),
            headers=key(),
        )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "STORE_NOT_TRADING"
    assert response.json()["details"]["state"] == "BLOCKED"
    await assert_nothing_moved(maker, shops, coat, shared=0, child=2)


# ---------------------------------------------------------------------------
# Retries: never twice, never a different move
# ---------------------------------------------------------------------------


async def test_a_retry_with_the_same_key_replays_and_moves_nothing_again(maker):
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 4}
    )
    body = transfer_body(
        shops,
        source=shops.child_warehouse,
        destination=shops.shared_warehouse,
        lines=[(coat.variant, coat.size(), 3)],
    )
    headers = key()
    async with api(maker, shops.scope(shops.child_store)) as client:
        first = await client.post("/api/v1/transfers", json=body, headers=headers)
        again = await client.post("/api/v1/transfers", json=body, headers=headers)
    assert first.status_code == again.status_code == 201, (first.text, again.text)
    assert again.json() == first.json()

    async with maker() as session:
        assert await count(session, Transfer, shops) == 1
        assert len(await transfer_movements(session, shops)) == 2
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 1
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == 3


async def test_a_retry_after_the_cache_is_gone_returns_the_original_transfer(maker):
    """Invariant I20. The 7-day idempotency record is a cache; the permanent
    `command_id` is the guarantee. With the cache gone, the same command gets
    the same answer and the goods do not move a second time."""
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 4}
    )
    body = transfer_body(
        shops,
        source=shops.child_warehouse,
        destination=shops.shared_warehouse,
        lines=[(coat.variant, coat.size(), 3)],
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        first = await client.post("/api/v1/transfers", json=body, headers=key())
        assert first.status_code == 201, first.text

        async with maker() as session:
            await session.execute(
                delete(IdempotencyRecord).where(
                    IdempotencyRecord.organization_id == shops.organization_id
                )
            )
            await session.commit()

        replayed = await client.post("/api/v1/transfers", json=body, headers=key())
    assert replayed.status_code == 201, replayed.text
    assert replayed.json() == first.json()

    async with maker() as session:
        assert await count(session, Transfer, shops) == 1
        assert len(await transfer_movements(session, shops)) == 2
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 1


async def test_a_transfer_whose_original_request_cannot_be_verified_is_not_guessed(maker):
    """Revision 0008 is reversible, and a downgrade followed by an upgrade
    drops `command_fingerprint` and adds it back empty. A retry of such a
    transfer, with the 7-day cache gone too, has nothing to be compared with:
    it is refused as a conflict — never taken for a match, never executed a
    second time. The caller may issue the command, so it learns which
    transfer holds it.
    """
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 4}
    )
    body = transfer_body(
        shops,
        source=shops.child_warehouse,
        destination=shops.shared_warehouse,
        lines=[(coat.variant, coat.size(), 3)],
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        first = await client.post("/api/v1/transfers", json=body, headers=key())
        assert first.status_code == 201, first.text

        async with maker() as session:
            # What 0008's downgrade and re-upgrade leave on an existing row.
            await session.execute(
                update(Transfer)
                .where(Transfer.id == uuid.UUID(first.json()["id"]))
                .values(command_fingerprint=None, response_snapshot=None)
            )
            await session.execute(
                delete(IdempotencyRecord).where(
                    IdempotencyRecord.organization_id == shops.organization_id
                )
            )
            await session.commit()

        retried = await client.post("/api/v1/transfers", json=body, headers=key())
    assert retried.status_code == 409, retried.text
    error = retried.json()
    assert error["code"] == "IDEMPOTENCY_CONFLICT"
    assert "cannot be verified" in error["message"]
    assert error["details"]["transfer_id"] == first.json()["id"]

    async with maker() as session:
        assert await count(session, Transfer, shops) == 1
        assert len(await transfer_movements(session, shops)) == 2
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 1
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == 3


async def test_each_transfer_answers_with_its_own_legs_only(maker):
    """The answer lists the ledger rows *this* transfer wrote, found by the
    transfer they name. With one transfer in an organization, a lookup that
    forgot to filter by it would still look right; with two, it hands each
    caller the other's legs as well — in the first answer, and again when a
    durable replay rebuilds the answer from the rows (independent review,
    2026-09-21).
    """
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 4}
    )
    bodies = [
        transfer_body(
            shops,
            source=shops.child_warehouse,
            destination=shops.shared_warehouse,
            lines=[(coat.variant, coat.size(), quantity)],
        )
        for quantity in (1, 2)
    ]
    async with api(maker, shops.scope(shops.child_store)) as client:
        answers = [
            await client.post("/api/v1/transfers", json=body, headers=key()) for body in bodies
        ]
        assert [a.status_code for a in answers] == [201, 201], [a.text for a in answers]

        async with maker() as session:
            # Make the replay rebuild its answer from the rows instead of
            # handing back the one it stored.
            await session.execute(
                update(Transfer)
                .where(Transfer.organization_id == shops.organization_id)
                .values(response_snapshot=None)
            )
            await session.execute(
                delete(IdempotencyRecord).where(
                    IdempotencyRecord.organization_id == shops.organization_id
                )
            )
            await session.commit()

        replays = [
            await client.post("/api/v1/transfers", json=body, headers=key()) for body in bodies
        ]

    async with maker() as session:
        legs = await transfer_movements(session, shops)
    assert len(legs) == 4
    for answer, replay in zip(answers, replays, strict=True):
        own = sorted(str(leg.id) for leg in legs if str(leg.reference_id) == answer.json()["id"])
        assert len(own) == 2
        assert sorted(answer.json()["movements"]) == own
        assert replay.status_code == 201, replay.text
        assert replay.json() == answer.json()


@pytest.mark.parametrize("changed", ["destination", "source", "quantity"])
async def test_the_same_command_with_a_different_move_is_a_conflict(maker, changed):
    """Every fact of the move is in the permanent fingerprint. Without the
    destination, a retry aimed elsewhere would be answered "moved" about goods
    that never went there; without the source or the quantity, a retry taking
    goods from another shelf, or more of them, would be told it had happened.
    """
    shops = await make_shops(maker)
    third = await _third_warehouse(maker, shops)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 4}
    )
    command_id = uuid.uuid4()
    original: dict[str, Any] = {
        "source": shops.child_warehouse,
        "destination": shops.shared_warehouse,
        "quantity": 1,
    }
    retried = {**original, changed: {"destination": third, "source": third, "quantity": 2}[changed]}

    def body(move: dict[str, Any]) -> dict[str, Any]:
        return transfer_body(
            shops,
            source=move["source"],
            destination=move["destination"],
            lines=[(coat.variant, coat.size(), move["quantity"])],
            command_id=command_id,
        )

    async with api(maker, shops.scope(shops.child_store)) as client:
        first = await client.post("/api/v1/transfers", json=body(original), headers=key())
        assert first.status_code == 201, first.text
        different = await client.post("/api/v1/transfers", json=body(retried), headers=key())
    assert different.status_code == 409, different.text
    error = different.json()
    assert error["code"] == "IDEMPOTENCY_CONFLICT"
    # The caller may issue this command, so it may learn which transfer holds it.
    assert error["details"]["transfer_id"] == first.json()["id"]

    async with maker() as session:
        assert await count(session, Transfer, shops) == 1
        assert len(await transfer_movements(session, shops)) == 2
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 3
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == 1
        assert await quantity_at(session, third, coat.variant, coat.size()) == 0


@pytest.mark.parametrize(("end", "flag"), [("source", "can_sell"), ("destination", "can_receive")])
async def test_revoking_warehouse_access_is_honoured_on_a_replay(maker, end, flag):
    """Invariant I23 on the replay path, at both ends. Access is checked
    before the key is claimed, so a store that has lost either warehouse is
    refused rather than handed its cached success."""
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    body = transfer_body(
        shops,
        source=shops.child_warehouse,
        destination=shops.shared_warehouse,
        lines=[(coat.variant, coat.size(), 1)],
    )
    headers = key()
    async with api(maker, shops.scope(shops.child_store)) as client:
        first = await client.post("/api/v1/transfers", json=body, headers=headers)
        assert first.status_code == 201, first.text

        async with maker() as session:
            await session.execute(
                update(StoreLocationAccess)
                .where(
                    StoreLocationAccess.store_id == shops.child_store,
                    StoreLocationAccess.location_id
                    == (shops.child_warehouse if end == "source" else shops.shared_warehouse),
                )
                .values({flag: False})
            )
            await session.commit()

        replay = await client.post("/api/v1/transfers", json=body, headers=headers)
    assert replay.status_code == 403, replay.text
    assert replay.json()["code"] == "LOCATION_ACCESS_DENIED"
    assert replay.json()["details"]["capability"] == flag


@pytest.mark.parametrize("revoked", [Permission.TRANSFER_CREATE, Permission.TRANSFER_RECEIVE])
async def test_revoking_the_permission_is_honoured_on_a_replay(maker, revoked):
    """Invariant I13: the decision reads the scope as it is now — for both of
    the capabilities a single-step transfer needs."""
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    body = transfer_body(
        shops,
        source=shops.child_warehouse,
        destination=shops.shared_warehouse,
        lines=[(coat.variant, coat.size(), 1)],
    )
    headers = key()
    async with api(maker, shops.scope(shops.child_store)) as client:
        first = await client.post("/api/v1/transfers", json=body, headers=headers)
    assert first.status_code == 201, first.text
    async with api(maker, shops.scope(shops.child_store, MANAGER - {revoked})) as client:
        replay = await client.post("/api/v1/transfers", json=body, headers=headers)
    assert replay.status_code == 403, replay.text
    assert replay.json()["code"] == "PERMISSION_DENIED"


@pytest.mark.parametrize(("end", "flag"), [("source", "can_sell"), ("destination", "can_receive")])
async def test_the_service_refuses_a_store_without_access_without_the_router(maker, end, flag):
    """Defence in depth that nothing exercises is defence in depth that rots.

    The router refuses first on every HTTP path, so the service's own access
    checks are never reached by an HTTP test. A caller that is not an HTTP
    request — the Telegram handler this module anticipates — reaches the
    command directly and must get the same refusal at either end: for a new
    command, and for a durable replay of one the store once had the right to
    issue.
    """
    from app.modules.transfers.service import TransferLineInput, create_transfer

    shops = await make_shops(maker)
    coat = await stock(
        maker,
        shops,
        warehouse=shops.shared_warehouse,
        store=shops.primary_store,
        quantities={"M": 2},
    )
    guarded = shops.shared_warehouse if end == "source" else shops.child_warehouse
    command_id = uuid.uuid4()

    async def grant(value: bool) -> None:
        async with maker() as session:
            await session.execute(
                update(StoreLocationAccess)
                .where(
                    StoreLocationAccess.store_id == shops.child_store,
                    StoreLocationAccess.location_id == guarded,
                )
                .values({flag: value})
            )
            await session.commit()

    async def move(session: AsyncSession) -> None:
        await create_transfer(
            session,
            scope=shops.scope(shops.child_store),
            store_id=shops.child_store,
            command_id=command_id,
            from_location_id=shops.shared_warehouse,
            to_location_id=shops.child_warehouse,
            lines=[TransferLineInput(uuid.UUID(coat.variant), uuid.UUID(coat.size()), 1)],
        )

    await grant(False)
    async with maker() as session:
        with pytest.raises(LocationAccessDeniedError) as refused:
            await move(session)
        await session.rollback()
    assert refused.value.details["capability"] == flag

    await grant(True)
    async with maker() as session:
        await move(session)
        await session.commit()

    await grant(False)
    async with maker() as session:
        # The same command_id: a durable replay, refused before it is answered.
        with pytest.raises(LocationAccessDeniedError):
            await move(session)
        await session.rollback()

    async with maker() as session:
        assert await count(session, Transfer, shops) == 1
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == 1
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 1


# ---------------------------------------------------------------------------
# Found by the independent review (2026-09-21): each either failed before its
# fix, or pins a guard that no test noticed being removed
# ---------------------------------------------------------------------------


async def test_moving_goods_needs_transfer_receive_as_well(maker):
    """Single-step: whoever sends the goods also receives them, so a role
    without `transfer:receive` cannot complete a transfer. Before the review
    it could, and an owner who removed that capability to stop a role
    receiving goods would have seen no effect (independent review,
    2026-09-21)."""
    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    async with api(
        maker, shops.scope(shops.child_store, MANAGER - {Permission.TRANSFER_RECEIVE})
    ) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=shops.shared_warehouse,
                lines=[(coat.variant, coat.size(), 1)],
            ),
            headers=key(),
        )
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "PERMISSION_DENIED"
    await assert_nothing_moved(maker, shops, coat, shared=0, child=2)


@pytest.mark.parametrize("unknown", ["product", "size"])
async def test_an_unknown_product_or_size_is_refused_exactly_like_a_foreign_one(maker, unknown):
    """`validate_stock_references` promises one answer for an id that does not
    exist and for one that belongs to another organization. The transfer used
    to write its lines before asking, so a made-up id hit the database's own
    foreign key and came back as a 500 while a foreign id was a 404 — which
    told a caller whether an id exists in someone else's catalog (independent
    review, 2026-09-21)."""
    shops = await make_shops(maker)
    theirs = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    their_coat = await stock(
        maker,
        theirs,
        warehouse=theirs.child_warehouse,
        store=theirs.child_store,
        quantities={"M": 1},
    )
    foreign = their_coat.variant if unknown == "product" else their_coat.size()

    def lines(value: str) -> list[tuple[str, str, int]]:
        return [(value, coat.size(), 1)] if unknown == "product" else [(coat.variant, value, 1)]

    async with api(maker, shops.scope(shops.child_store)) as client:
        responses = [
            await client.post(
                "/api/v1/transfers",
                json=transfer_body(
                    shops,
                    source=shops.child_warehouse,
                    destination=shops.shared_warehouse,
                    lines=lines(value),
                ),
                headers=key(),
            )
            for value in (str(uuid.uuid4()), foreign)
        ]
    assert [r.status_code for r in responses] == [404, 404], [r.text for r in responses]
    assert responses[0].json() == responses[1].json()
    await assert_nothing_moved(maker, shops, coat, shared=0, child=2)


async def test_a_shortfall_leaves_nothing_even_for_a_caller_that_commits(maker):
    """All or nothing must not depend on the caller rolling back.

    The destination is chosen to sort before the source, which is the order a
    leg into it would have been applied first. The transfer used to find the
    shortfall only after that leg — so a non-HTTP caller that caught the error
    and committed would have saved a transfer row and a lone `TRANSFER_IN`,
    stock created from nothing (independent review, 2026-09-21). Now the
    shortfall is found before anything is written.
    """
    from app.modules.transfers.service import TransferLineInput, create_transfer

    shops = await make_shops(maker)
    third = await _third_warehouse(maker, shops)
    destination, source = sorted([shops.child_warehouse, third])
    coat = await stock(maker, shops, warehouse=source, store=shops.child_store, quantities={"M": 1})
    await stock(
        maker, shops, warehouse=destination, store=shops.child_store, quantities={"M": 1}, coat=coat
    )

    async with maker() as session:
        with pytest.raises(InsufficientStockError):
            await create_transfer(
                session,
                scope=shops.scope(shops.child_store),
                store_id=shops.child_store,
                command_id=uuid.uuid4(),
                from_location_id=source,
                to_location_id=destination,
                lines=[TransferLineInput(uuid.UUID(coat.variant), uuid.UUID(coat.size()), 5)],
            )
        await session.commit()

    async with maker() as session:
        assert await count(session, Transfer, shops) == 0
        assert await transfer_movements(session, shops) == []
        assert await quantity_at(session, destination, coat.variant, coat.size()) == 1
        assert await quantity_at(session, source, coat.variant, coat.size()) == 1
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_the_same_command_arriving_twice_at_once_is_serialized(maker, engine):
    """The advisory lock on `(organization, command_id)` is load-bearing.

    A second request with the same permanent `command_id` but a new cache key
    reads `transfer WHERE command_id = …` before the first has committed, sees
    nothing, and would go on to insert — into `uq_transfer_org_command`, an
    unhandled error and a 500 for an ordinary retry. The advisory lock makes
    it wait and then answer with the original transfer. Every other test here
    stays green without the lock, which is why this one exists (independent
    review, 2026-09-21; the refund suite has its twin).
    """
    from app.modules.transfers.service import TransferLineInput, create_transfer

    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 3}
    )
    command_id = uuid.uuid4()

    def command(session: AsyncSession):
        return create_transfer(
            session,
            scope=shops.scope(shops.child_store),
            store_id=shops.child_store,
            command_id=command_id,
            from_location_id=shops.child_warehouse,
            to_location_id=shops.shared_warehouse,
            lines=[TransferLineInput(uuid.UUID(coat.variant), uuid.UUID(coat.size()), 1)],
        )

    async def retry() -> str:
        async with maker() as session:
            result = await command(session)
            await session.commit()
            return str(result.transfer.id)

    async with maker() as holder:
        first = await command(holder)
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        assert holder_pid is not None
        task = asyncio.create_task(retry())
        try:
            await wait_until_blocked_by(engine, holder_pid)
            assert not task.done(), "the duplicate command should be waiting"
        finally:
            await holder.commit()
            replayed = await asyncio.wait_for(task, timeout=20)

    # The retry got the original transfer back: not a second one, not a crash.
    assert replayed == str(first.transfer.id)
    async with maker() as session:
        assert await count(session, Transfer, shops) == 1
        assert len(await transfer_movements(session, shops)) == 2
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 2
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == 1
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_can_sell_alone_at_the_source_is_enough_to_move_goods_out(maker):
    """Pins the rule as it stands, so that changing it is a decision, not a drift.

    Design §1.6 proposes `can_sell` at the source. Here the child store may
    only *sell* from the shared warehouse, and its manager can still move the
    whole shared pile into the child's own warehouse — after which, with these
    grants, neither store can move it back. The owner has not decided whether
    that is right (open question in the M1-018 report). If the source should
    need more than `can_sell`, this is the test that changes with it.
    """
    shops = await make_shops(maker, child_may_receive_shared=False)
    coat = await stock(
        maker,
        shops,
        warehouse=shops.shared_warehouse,
        store=shops.primary_store,
        quantities={"M": 3},
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        moved = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.shared_warehouse,
                destination=shops.child_warehouse,
                lines=[(coat.variant, coat.size(), 3)],
            ),
            headers=key(),
        )
        back_by_child = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=shops.shared_warehouse,
                lines=[(coat.variant, coat.size(), 3)],
            ),
            headers=key(),
        )
    async with api(maker, shops.scope(shops.primary_store)) as client:
        back_by_primary = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                store=shops.primary_store,
                source=shops.child_warehouse,
                destination=shops.shared_warehouse,
                lines=[(coat.variant, coat.size(), 3)],
            ),
            headers=key(),
        )

    assert moved.status_code == 201, moved.text
    assert back_by_child.status_code == 403, back_by_child.text
    assert back_by_child.json()["details"]["capability"] == "can_receive"
    assert back_by_primary.status_code == 403, back_by_primary.text
    assert back_by_primary.json()["details"]["capability"] == "can_sell"
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == 0
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 3


@pytest.mark.parametrize("missing", [Permission.TRANSFER_CREATE, Permission.TRANSFER_RECEIVE])
async def test_the_service_refuses_a_person_without_either_permission_without_the_router(
    maker, missing
):
    """The person's half of the same defence in depth. A caller that is not
    an HTTP request has no router to refuse it first, so the command itself
    must ask for both capabilities a single-step transfer needs — for a new
    command, and for a durable replay of one the person could once issue.
    """
    from app.modules.transfers.service import TransferLineInput, create_transfer

    shops = await make_shops(maker)
    coat = await stock(
        maker, shops, warehouse=shops.child_warehouse, store=shops.child_store, quantities={"M": 2}
    )
    command_id = uuid.uuid4()

    async def move(session: AsyncSession, permissions: frozenset[Permission]) -> None:
        await create_transfer(
            session,
            scope=shops.scope(shops.child_store, permissions),
            store_id=shops.child_store,
            command_id=command_id,
            from_location_id=shops.child_warehouse,
            to_location_id=shops.shared_warehouse,
            lines=[TransferLineInput(uuid.UUID(coat.variant), uuid.UUID(coat.size()), 1)],
        )

    async with maker() as session:
        with pytest.raises(PermissionDeniedError) as refused:
            await move(session, MANAGER - {missing})
        await session.rollback()
    assert refused.value.details["permission"] == missing.value

    async with maker() as session:
        await move(session, MANAGER)
        await session.commit()

    async with maker() as session:
        # The same command_id: a durable replay, refused before it is answered.
        with pytest.raises(PermissionDeniedError):
            await move(session, MANAGER - {missing})
        await session.rollback()

    async with maker() as session:
        assert await count(session, Transfer, shops) == 1
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 1
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == 1


@pytest.mark.parametrize("foreign", ["from_location_id", "to_location_id", "initiating_store_id"])
async def test_the_database_refuses_a_transfer_that_names_another_organization(maker, foreign):
    """Invariant I12 with database teeth on the transfer row itself (0008).

    The service already refuses this. The composite keys make the row
    unrepresentable even for a future caller that forgets to ask. The same row
    naming our own warehouses and store is accepted first, so the refusal can
    only be the foreign reference.
    """
    from sqlalchemy.exc import IntegrityError

    shops = await make_shops(maker)
    theirs = await make_shops(maker)
    own = {
        "from_location_id": shops.child_warehouse,
        "to_location_id": shops.shared_warehouse,
        "initiating_store_id": shops.child_store,
    }
    alien = {
        "from_location_id": theirs.child_warehouse,
        "to_location_id": theirs.shared_warehouse,
        "initiating_store_id": theirs.child_store,
    }

    def row(references: dict[str, uuid.UUID]) -> Transfer:
        return Transfer(
            organization_id=shops.organization_id,
            created_by_user_id=shops.user_id,
            command_id=uuid.uuid4(),
            status=TransferStatus.RECEIVED,
            **references,
        )

    async with maker() as session:
        session.add(row(own))
        await session.flush()
        await session.rollback()

    async with maker() as session:
        session.add(row({**own, foreign: alien[foreign]}))
        with pytest.raises(IntegrityError, match="fk_transfer_org_"):
            await session.flush()
        await session.rollback()


# ---------------------------------------------------------------------------
# Concurrency
# ---------------------------------------------------------------------------


async def test_both_legs_go_through_the_ledger_in_one_call(maker, monkeypatch):
    """ADR-0004 §2.5. The two legs must be locked in one sorted batch: two
    calls would lock the destination after the source — out of global order —
    and two opposing transfers could deadlock. Checked directly, because
    whether two racing requests happen to interleave at that moment is chance.
    """
    import app.modules.transfers.service as transfers

    calls: list[list[MovementType]] = []
    real = transfers.apply_movements

    async def recording(*args: Any, **kwargs: Any) -> Any:
        calls.append([request.movement_type for request in kwargs["requests"]])
        return await real(*args, **kwargs)

    monkeypatch.setattr(transfers, "apply_movements", recording)

    shops = await make_shops(maker)
    coat = await stock(
        maker,
        shops,
        warehouse=shops.child_warehouse,
        store=shops.child_store,
        quantities={"M": 2, "L": 2},
    )
    async with api(maker, shops.scope(shops.child_store)) as client:
        response = await client.post(
            "/api/v1/transfers",
            json=transfer_body(
                shops,
                source=shops.child_warehouse,
                destination=shops.shared_warehouse,
                lines=[(coat.variant, coat.size("M"), 1), (coat.variant, coat.size("L"), 2)],
            ),
            headers=key(),
        )
    assert response.status_code == 201, response.text
    assert len(calls) == 1
    assert sorted(calls[0]) == sorted([MovementType.TRANSFER_OUT, MovementType.TRANSFER_IN] * 2)


async def test_opposing_transfers_all_complete_without_deadlock(maker):
    """Ten transfers each way between the same two warehouses, all at once.
    Every one completes, and the stock is exactly where the arithmetic says.

    Evidence rather than proof — interleaving is up to the scheduler — which
    is why the single-call test above exists as well.
    """
    shops = await make_shops(maker)
    coat = await stock(
        maker,
        shops,
        warehouse=shops.shared_warehouse,
        store=shops.primary_store,
        quantities={"M": 10},
    )
    await stock(
        maker,
        shops,
        warehouse=shops.child_warehouse,
        store=shops.child_store,
        quantities={"M": 10},
        coat=coat,
    )

    async def move(source: uuid.UUID, destination: uuid.UUID) -> int:
        async with api(maker, shops.scope(shops.child_store)) as client:
            response = await client.post(
                "/api/v1/transfers",
                json=transfer_body(
                    shops,
                    source=source,
                    destination=destination,
                    lines=[(coat.variant, coat.size(), 1)],
                ),
                headers=key(),
            )
            return response.status_code

    results = await asyncio.wait_for(
        asyncio.gather(
            *(move(shops.shared_warehouse, shops.child_warehouse) for _ in range(10)),
            *(move(shops.child_warehouse, shops.shared_warehouse) for _ in range(10)),
        ),
        timeout=90,
    )
    assert results == [201] * 20, results

    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == 10
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 10
        assert await count(session, Transfer, shops) == 20
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_a_transfer_and_a_sale_racing_for_the_last_coat_let_exactly_one_through(
    maker, engine
):
    """A sale at the shared warehouse while the last coat is being moved out
    of it. The transfer holds its transaction open deliberately — whether two
    racing requests overlap at the critical moment is otherwise a coin flip —
    and the sale must wait for it, then be told the coat is gone."""
    from app.modules.transfers.service import TransferLineInput, create_transfer

    shops = await make_shops(maker)
    coat = await stock(
        maker,
        shops,
        warehouse=shops.shared_warehouse,
        store=shops.primary_store,
        quantities={"M": 1},
    )

    async def primary_sells() -> httpx.Response:
        async with api(maker, shops.scope(shops.primary_store, SELLER)) as client:
            return await client.post(
                "/api/v1/sales",
                json={
                    "store_id": str(shops.primary_store),
                    "command_id": str(uuid.uuid4()),
                    "lines": [
                        {
                            "product_variant_id": coat.variant,
                            "size_id": coat.size(),
                            "source_location_id": str(shops.shared_warehouse),
                            "quantity": 1,
                            "unit_price": "1500.00",
                        }
                    ],
                    "payment_method": "CASH",
                },
                headers=key(),
            )

    async with maker() as holder:
        await create_transfer(
            holder,
            scope=shops.scope(shops.child_store),
            store_id=shops.child_store,
            command_id=uuid.uuid4(),
            from_location_id=shops.shared_warehouse,
            to_location_id=shops.child_warehouse,
            lines=[TransferLineInput(uuid.UUID(coat.variant), uuid.UUID(coat.size()), 1)],
        )
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        assert holder_pid is not None
        task = asyncio.create_task(primary_sells())
        await wait_until_blocked_by(engine, holder_pid)
        assert not task.done(), "the sale should be waiting on the shared row"
        await holder.commit()
        sale = await asyncio.wait_for(task, timeout=20)

    assert sale.status_code == 409, sale.text
    assert sale.json()["code"] == "INSUFFICIENT_STOCK"
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == 0
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 1
        assert await count(session, Sale, shops) == 0
        assert await find_divergences(session, organization_id=shops.organization_id) == []


async def test_a_sale_holding_the_last_coat_leaves_the_transfer_nothing_to_move(maker, engine):
    """The mirror: the sale commits first, the transfer waited behind it and is
    refused whole — with no correction offered, because a transfer has none."""
    from app.modules.sales.service import SaleLineInput, create_sale

    shops = await make_shops(maker)
    coat = await stock(
        maker,
        shops,
        warehouse=shops.shared_warehouse,
        store=shops.primary_store,
        quantities={"M": 1},
    )

    async def child_moves_it() -> httpx.Response:
        async with api(maker, shops.scope(shops.child_store)) as client:
            return await client.post(
                "/api/v1/transfers",
                json=transfer_body(
                    shops,
                    source=shops.shared_warehouse,
                    destination=shops.child_warehouse,
                    lines=[(coat.variant, coat.size(), 1)],
                ),
                headers=key(),
            )

    async with maker() as holder:
        await create_sale(
            holder,
            scope=shops.scope(shops.primary_store, SELLER),
            store_id=shops.primary_store,
            command_id=uuid.uuid4(),
            currency_code="UAH",
            lines=[
                SaleLineInput(
                    product_variant_id=uuid.UUID(coat.variant),
                    size_id=uuid.UUID(coat.size()),
                    source_location_id=shops.shared_warehouse,
                    quantity=1,
                    unit_price=Decimal("1500.00"),
                )
            ],
            payment_method=PaymentMethod.CASH,
        )
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        assert holder_pid is not None
        task = asyncio.create_task(child_moves_it())
        await wait_until_blocked_by(engine, holder_pid)
        assert not task.done(), "the transfer should be waiting on the shared row"
        await holder.commit()
        moved = await asyncio.wait_for(task, timeout=20)

    assert moved.status_code == 409, moved.text
    assert moved.json()["code"] == "INSUFFICIENT_STOCK"
    assert moved.json()["details"]["correctable"] is False
    async with maker() as session:
        assert await quantity_at(session, shops.shared_warehouse, coat.variant, coat.size()) == 0
        assert await quantity_at(session, shops.child_warehouse, coat.variant, coat.size()) == 0
        assert await count(session, Transfer, shops) == 0
        assert await find_divergences(session, organization_id=shops.organization_id) == []


# ---------------------------------------------------------------------------
# Helpers that need the fixtures above
# ---------------------------------------------------------------------------


async def _third_warehouse(maker: async_sessionmaker[AsyncSession], shops: Shops) -> uuid.UUID:
    """A second warehouse the child store may sell from and receive into."""
    async with maker() as session:
        location = await provision_location(
            session,
            organization_id=shops.organization_id,
            store_id=shops.child_store,
            code=f"W-3-{uuid.uuid4().hex[:6]}",
            name="Третій склад",
        )
        await session.commit()
        return location
