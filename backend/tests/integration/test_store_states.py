"""Store states (owner decisions, 2026-10-01), over HTTP against real
PostgreSQL, with real people signed in by a session token.

- The owner of the network blocks a store, unblocks it, archives it and
  opens it again, from the app and saying why. Nobody else does: not a
  manager, not the owner of the child store herself.
- A blocked or archived store does nothing. The owner and the network's
  managers read it; its own people see only its state and since when.
- Its open orders wait, their goods still held.
- Its customers' debts are paid at any store that trades, found there by
  the customer's whole phone while they are owed; the debt stays its own.
  The network's owner may write one off.
- Only an empty store is archived: nothing in its own warehouses or its
  «Брак», and no open order. The refusal says what is left.
- A store blocked while a command runs waits for it: what moves stock holds
  the store, and the change of state waits.

All data is synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.api.deps import session_dependency
from app.core.errors import ValidationFailedError
from app.main import create_app
from app.modules.audit.models import AuditLog
from app.modules.authz.models import Membership, Role
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from app.modules.authz.service import resolve_scope, seed_default_roles
from app.modules.credit.models import CreditEntry, CustomerCredit
from app.modules.credit.service import CUSTOMER, customer_key
from app.modules.identity.models import AppUser
from app.modules.identity.session import issue_session_token
from app.modules.inventory.service import find_divergences, lock_stock
from app.modules.stores.service import change_state
from app.modules.tenancy.models import StockLocation, Store, StoreState, StoreStateChange
from tests.conftest import provision_location, requires_database
from tests.integration.test_shared_warehouse import (
    SETTINGS,
    TwoShops,
    api,
    key,
    make_two_shops,
    quantity_at,
    sale_body,
    stock_a_coat,
)
from tests.integration.test_till_returns import give_bin

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@dataclass(frozen=True, slots=True)
class Network:
    shops: TwoShops
    # The owner and a manager of the whole network.
    owner: uuid.UUID
    manager: uuid.UUID
    # The child store's own owner and seller, and the primary store's seller.
    child_owner: uuid.UUID
    child_seller: uuid.UUID
    seller: uuid.UUID
    # The child store's own warehouse: it manages it, nobody else reaches it.
    own: uuid.UUID


async def network(maker: async_sessionmaker[AsyncSession]) -> Network:
    shops = await make_two_shops(maker)
    async with maker() as session:
        roles = await seed_default_roles(session, shops.organization_id)
        people: dict[str, uuid.UUID] = {}
        for name, role, store in (
            ("owner", RoleCode.OWNER, None),
            ("manager", RoleCode.MANAGER, None),
            ("child_owner", RoleCode.OWNER, shops.child_store),
            ("child_seller", RoleCode.SELLER, shops.child_store),
            ("seller", RoleCode.SELLER, shops.primary_store),
        ):
            user = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name=name)
            session.add(user)
            await session.flush()
            session.add(
                Membership(
                    user_id=user.id,
                    organization_id=shops.organization_id,
                    store_id=store,
                    role_id=roles[role.value].id,
                )
            )
            people[name] = user.id
        own = await provision_location(
            session,
            organization_id=shops.organization_id,
            store_id=shops.child_store,
            code=f"W-OWN-{uuid.uuid4().hex[:6]}",
            name="Власний склад дочірнього",
        )
        await session.execute(
            update(StockLocation)
            .where(StockLocation.id == own)
            .values(managing_store_id=shops.child_store)
        )
        await session.commit()
    return Network(shops=shops, own=own, **people)


@asynccontextmanager
async def as_(maker: async_sessionmaker[AsyncSession], net: Network, user_id: uuid.UUID):
    """Signed in as this person: a real token, and the scope the server
    builds for it on every request."""
    app = create_app(SETTINGS)

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    token, _ = issue_session_token(
        user_id=user_id,
        organization_id=net.shops.organization_id,
        secret=SETTINGS.session_secret.get_secret_value(),
        ttl_seconds=3600,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as client:
        yield client


async def set_state(
    maker,
    net: Network,
    state: str,
    *,
    store: uuid.UUID | None = None,
    by: uuid.UUID | None = None,
    reason: str = "перевірка",
    command_id: str | None = None,
) -> httpx.Response:
    async with as_(maker, net, by or net.owner) as client:
        return await client.post(
            f"/api/v1/stores/{store or net.shops.child_store}/state",
            json={"command_id": command_id or str(uuid.uuid4()), "state": state, "reason": reason},
        )


async def stocked(maker, net: Network, warehouse: uuid.UUID, *, qty: int = 3) -> tuple[str, str]:
    """Coats received into `warehouse` by the store that reaches it."""
    store = net.shops.child_store if warehouse == net.own else net.shops.primary_store
    async with api(maker, net.shops.scope(store)) as client:
        return await stock_a_coat(client, net.shops, store=store, warehouse=warehouse, qty=qty)


def not_trading(response: httpx.Response, state: str) -> None:
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "STORE_NOT_TRADING"
    assert response.json()["details"]["state"] == state


async def test_only_the_network_owner_changes_a_store_state(maker):
    net = await network(maker)
    for someone in (net.manager, net.child_owner, net.child_seller):
        refused = await set_state(maker, net, "BLOCKED", by=someone)
        assert refused.status_code == 403, refused.text
        assert refused.json()["code"] == "PERMISSION_DENIED"
        async with as_(maker, net, someone) as client:
            assert (await client.get("/api/v1/stores")).status_code == 403

    blocked = await set_state(maker, net, "BLOCKED", reason="ревізія")
    assert blocked.status_code == 200, blocked.text
    body = blocked.json()
    assert (body["state"], body["code"]) == ("BLOCKED", "CHILD")
    assert body["state_since"] is not None
    [change] = body["changes"]
    assert (change["from_state"], change["to_state"], change["reason"], change["by"]) == (
        "ACTIVE",
        "BLOCKED",
        "ревізія",
        "owner",
    )
    async with as_(maker, net, net.owner) as client:
        listed = (await client.get("/api/v1/stores")).json()
    assert [(store["code"], store["state"]) for store in listed] == [
        ("CHILD", "BLOCKED"),
        ("MAIN", "ACTIVE"),
    ]
    async with maker() as session:
        [audit] = (
            await session.scalars(
                select(AuditLog).where(AuditLog.entity_id == net.shops.child_store)
            )
        ).all()
        assert (audit.action, audit.reason) == ("store.blocked", "ревізія")
        assert (audit.before, audit.after) == ({"state": "ACTIVE"}, {"state": "BLOCKED"})


async def test_a_blocked_store_does_nothing_and_the_network_reads_it(maker):
    net = await network(maker)
    await give_bin(maker, net.shops.organization_id, net.shops.child_store)
    variant, size = await stocked(maker, net, net.shops.shared_warehouse)
    async with as_(maker, net, net.child_seller) as client:
        before = await client.post(
            "/api/v1/sales",
            json=sale_body(net.shops.child_store, net.shops.shared_warehouse, variant, size),
            headers=key(),
        )
        assert before.status_code == 201, before.text
        # Handed back damaged: a unit in the child store's «Брак».
        damaged = await client.post(
            f"/api/v1/sales/{before.json()['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": before.json()["items"][0]["id"],
                        "quantity": 1,
                        "restock": True,
                        "condition": "DAMAGED",
                    }
                ],
                "payment_method": "CASH",
            },
            headers=key(),
        )
        assert damaged.status_code == 201, damaged.text
    assert (await set_state(maker, net, "BLOCKED", reason="продавця звільнено")).status_code == 200

    async with as_(maker, net, net.child_seller) as client:
        # Signed in, and told only the state and since when: never why.
        me = (await client.get("/api/v1/me")).json()
        [store] = me["stores"]
        assert (store["code"], store["state"], store["permissions"]) == ("CHILD", "BLOCKED", [])
        assert store["state_since"] is not None
        assert "продавця" not in str(me)
        not_trading(
            await client.post(
                "/api/v1/sales",
                json=sale_body(net.shops.child_store, net.shops.shared_warehouse, variant, size),
                headers=key(),
            ),
            "BLOCKED",
        )
        # Not even a read of its own store.
        not_trading(
            await client.get("/api/v1/sales", params={"store_id": str(net.shops.child_store)}),
            "BLOCKED",
        )

    for reader in (net.owner, net.manager):
        async with as_(maker, net, reader) as client:
            store = next(
                s for s in (await client.get("/api/v1/me")).json()["stores"] if s["code"] == "CHILD"
            )
            assert store["state"] == "BLOCKED" and "sale:view" in store["permissions"]
            sales = await client.get(
                "/api/v1/sales", params={"store_id": str(net.shops.child_store)}
            )
            assert sales.status_code == 200, sales.text
            assert [sale["id"] for sale in sales.json()["sales"]] == [before.json()["id"]]
            stock = await client.get(
                "/api/v1/inventory", params={"store_id": str(net.shops.child_store)}
            )
            assert stock.status_code == 200, stock.text
            [unit] = (
                await client.get(
                    "/api/v1/damaged-units", params={"store_id": str(net.shops.child_store)}
                )
            ).json()["units"]
            # Nor a step that moves nothing: a network role reads, and only reads.
            not_trading(await client.post(f"/api/v1/damaged-units/{unit['id']}/take"), "BLOCKED")
            # Read, and nothing else: the network's own roles change nothing in it.
            not_trading(
                await client.post(
                    "/api/v1/sales",
                    json=sale_body(
                        net.shops.child_store, net.shops.shared_warehouse, variant, size
                    ),
                    headers=key(),
                ),
                "BLOCKED",
            )
    # The child store's own owner reads nothing while it is blocked.
    async with as_(maker, net, net.child_owner) as client:
        not_trading(
            await client.get("/api/v1/sales", params={"store_id": str(net.shops.child_store)}),
            "BLOCKED",
        )

    # The other store trades on, from the warehouse they share.
    async with as_(maker, net, net.seller) as client:
        sold = await client.post(
            "/api/v1/sales",
            json=sale_body(net.shops.primary_store, net.shops.shared_warehouse, variant, size),
            headers=key(),
        )
    assert sold.status_code == 201, sold.text

    assert (await set_state(maker, net, "ACTIVE", reason="все гаразд")).status_code == 200
    async with as_(maker, net, net.child_seller) as client:
        again = await client.post(
            "/api/v1/sales",
            json=sale_body(net.shops.child_store, net.shops.shared_warehouse, variant, size),
            headers=key(),
        )
        taken = await client.post(f"/api/v1/damaged-units/{unit['id']}/take")
    assert again.status_code == 201, again.text
    assert taken.status_code == 200, taken.text
    async with maker() as session:
        assert await quantity_at(session, net.shops.shared_warehouse, variant, size) == 0
        assert await find_divergences(session, organization_id=net.shops.organization_id) == []


async def test_a_blocked_stores_sale_comes_back_at_a_store_that_trades(maker):
    net = await network(maker)
    variant, size = await stocked(maker, net, net.shops.shared_warehouse)
    async with as_(maker, net, net.child_seller) as client:
        sale = (
            await client.post(
                "/api/v1/sales",
                json=sale_body(net.shops.child_store, net.shops.shared_warehouse, variant, size),
                headers=key(),
            )
        ).json()
    assert (await set_state(maker, net, "BLOCKED")).status_code == 200

    def lines() -> dict:
        return {
            "command_id": str(uuid.uuid4()),
            "lines": [
                {
                    "sale_item_id": sale["items"][0]["id"],
                    "quantity": 1,
                    "restock": True,
                    "condition": "INTACT",
                }
            ],
            "payment_method": "CASH",
        }

    async with as_(maker, net, net.child_seller) as client:
        not_trading(
            await client.post(f"/api/v1/sales/{sale['id']}/refunds", json=lines(), headers=key()),
            "BLOCKED",
        )
    async with as_(maker, net, net.seller) as client:
        found = await client.get(
            "/api/v1/sales",
            params={
                "store_id": str(net.shops.primary_store),
                "elsewhere": "true",
                "q": sale["items"][0]["display_name"][:8],
            },
        )
        assert [s["id"] for s in found.json()["sales"]] == [sale["id"]]
        back = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json=lines() | {"store_id": str(net.shops.primary_store)},
            headers=key(),
        )
    assert back.status_code == 201, back.text
    async with maker() as session:
        assert await quantity_at(session, net.shops.shared_warehouse, variant, size) == 3


async def test_open_orders_wait_while_the_store_is_blocked(maker):
    net = await network(maker)
    variant, size = await stocked(maker, net, net.shops.shared_warehouse, qty=1)
    async with as_(maker, net, net.child_seller) as client:
        order = await client.post(
            "/api/v1/orders",
            json={
                "store_id": str(net.shops.child_store),
                "command_id": str(uuid.uuid4()),
                "carrier": "NOVA_POSHTA",
                "lines": [
                    {
                        "product_variant_id": variant,
                        "size_id": size,
                        "source_location_id": str(net.shops.shared_warehouse),
                        "quantity": 1,
                        "unit_price": "1500.00",
                    }
                ],
            },
        )
    assert order.status_code == 201, order.text
    assert (await set_state(maker, net, "BLOCKED")).status_code == 200

    async with as_(maker, net, net.child_seller) as client:
        not_trading(
            await client.post(
                f"/api/v1/orders/{order.json()['id']}/cancel",
                json={"command_id": str(uuid.uuid4())},
            ),
            "BLOCKED",
        )
    # The coat stays held for the customer: the other store cannot sell it.
    async with as_(maker, net, net.seller) as client:
        held = await client.post(
            "/api/v1/sales",
            json=sale_body(net.shops.primary_store, net.shops.shared_warehouse, variant, size),
            headers=key(),
        )
    assert held.status_code == 409, held.text
    # Nor is a store with an open order archived.
    refused = await set_state(maker, net, "ARCHIVED")
    assert refused.status_code == 422, refused.text
    assert refused.json()["details"]["leftovers"] == [{"kind": "ORDERS", "count": 1}]

    assert (await set_state(maker, net, "ACTIVE")).status_code == 200
    async with as_(maker, net, net.child_seller) as client:
        cancelled = await client.post(
            f"/api/v1/orders/{order.json()['id']}/cancel",
            json={"command_id": str(uuid.uuid4())},
        )
    assert cancelled.status_code == 200, cancelled.text
    assert (await set_state(maker, net, "ARCHIVED")).status_code == 200


async def test_only_an_empty_store_is_archived_and_it_opens_again(maker):
    net = await network(maker)
    bin_ = await give_bin(maker, net.shops.organization_id, net.shops.child_store)
    variant, size = await stocked(maker, net, net.own, qty=2)
    # A unit handed back damaged at the child store, into its «Брак».
    async with as_(maker, net, net.child_seller) as client:
        sale = (
            await client.post(
                "/api/v1/sales",
                json=sale_body(net.shops.child_store, net.own, variant, size),
                headers=key(),
            )
        ).json()
        damaged = await client.post(
            f"/api/v1/sales/{sale['id']}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": sale["items"][0]["id"],
                        "quantity": 1,
                        "restock": True,
                        "condition": "DAMAGED",
                    }
                ],
                "payment_method": "CASH",
            },
            headers=key(),
        )
    assert damaged.status_code == 201, damaged.text

    # From trading or from blocked, alike.
    assert (await set_state(maker, net, "BLOCKED")).status_code == 200
    refused = await set_state(maker, net, "ARCHIVED", reason="закриваємось")
    assert refused.status_code == 422, refused.text
    assert refused.json()["details"]["reason"] == "NOT_EMPTY"
    assert refused.json()["details"]["leftovers"] == [
        {"kind": "DAMAGED", "location_id": str(bin_), "name": "Брак", "units": 1},
        {
            "kind": "STOCK",
            "location_id": str(net.own),
            "name": "Власний склад дочірнього",
            "units": 1,
        },
    ]
    async with maker() as session:
        assert (await session.get(Store, net.shops.child_store)).state == "BLOCKED"  # type: ignore[union-attr]

    # Emptied by the store's own people, which only a trading store can be:
    # what stands there is the store's, and archiving never does it for them.
    assert (await set_state(maker, net, "ACTIVE")).status_code == 200
    async with as_(maker, net, net.child_seller) as client:
        await client.post(
            "/api/v1/sales",
            json=sale_body(net.shops.child_store, net.own, variant, size),
            headers=key(),
        )
    async with api(maker, net.shops.scope(net.shops.child_store)) as client:
        [unit] = (
            await client.get(
                "/api/v1/damaged-units", params={"store_id": str(net.shops.child_store)}
            )
        ).json()["units"]
        assert (await client.post(f"/api/v1/damaged-units/{unit['id']}/take")).status_code == 200
        confirmed = await client.post(
            f"/api/v1/damaged-units/{unit['id']}/confirm", json={"note": "шов"}
        )
        assert confirmed.status_code == 200, confirmed.text
    async with api(
        maker,
        net.shops.scope(net.shops.child_store, DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]),
    ) as client:
        written = await client.post(
            f"/api/v1/damaged-units/{unit['id']}/write-off", json={"note": "не продати"}
        )
        assert written.status_code == 200, written.text

    archived = await set_state(maker, net, "ARCHIVED", reason="закриваємось")
    assert archived.status_code == 200, archived.text
    assert archived.json()["state"] == "ARCHIVED"
    async with as_(maker, net, net.child_seller) as client:
        [store] = (await client.get("/api/v1/me")).json()["stores"]
        assert (store["state"], store["permissions"]) == ("ARCHIVED", [])
    # An archived store opens to trade, never to a block.
    not_blocked = await set_state(maker, net, "BLOCKED")
    assert not_blocked.json()["details"]["reason"] == "NOT_FROM_ARCHIVE"

    reopened = await set_state(maker, net, "ACTIVE", reason="відкриваємось знову")
    assert reopened.status_code == 200, reopened.text
    assert [c["to_state"] for c in reopened.json()["changes"]] == [
        "ACTIVE",
        "ARCHIVED",
        "ACTIVE",
        "BLOCKED",
    ]
    # Its people come back with it, as they were.
    async with as_(maker, net, net.child_seller) as client:
        [store] = (await client.get("/api/v1/me")).json()["stores"]
        assert store["state"] == "ACTIVE" and "sale:create" in store["permissions"]


async def test_a_state_change_is_named_by_its_command(maker):
    net = await network(maker)
    command = str(uuid.uuid4())
    first = await set_state(maker, net, "BLOCKED", command_id=command, reason="ревізія")
    again = await set_state(maker, net, "BLOCKED", command_id=command, reason="ревізія")
    assert again.status_code == 200 and again.json() == first.json()
    other = await set_state(maker, net, "BLOCKED", command_id=command, reason="інше")
    assert other.status_code == 409, other.text

    # Unblocked in between, the old command is answered, never done again.
    assert (await set_state(maker, net, "ACTIVE")).status_code == 200
    late = await set_state(maker, net, "BLOCKED", command_id=command, reason="ревізія")
    assert late.status_code == 200, late.text
    assert late.json()["state"] == "ACTIVE"

    already = await set_state(maker, net, "ACTIVE")
    assert already.json()["details"]["reason"] == "ALREADY"
    blank = await set_state(maker, net, "BLOCKED", reason="   ")
    assert blank.status_code == 422, blank.text
    async with maker() as session:
        changes = await session.scalar(
            select(func.count())
            .select_from(StoreStateChange)
            .where(StoreStateChange.store_id == net.shops.child_store)
        )
    assert changes == 2


async def test_debts_of_a_store_that_does_not_trade_are_paid_at_one_that_does(maker):
    net = await network(maker)
    variant, size = await stocked(maker, net, net.shops.shared_warehouse)
    name = f"Ірина-{uuid.uuid4().hex[:6]}"
    async with as_(maker, net, net.child_seller) as client:
        sale = await client.post(
            "/api/v1/sales",
            json=sale_body(net.shops.child_store, net.shops.shared_warehouse, variant, size)
            | {
                "credit": {
                    "customer_name": name,
                    "customer_phone": "0671234567",
                    "paid_now": "500.00",
                }
            },
            headers=key(),
        )
    assert sale.status_code == 201, sale.text
    credit_id = sale.json()["credit"]["credit_id"]

    def payment(amount: str, store: uuid.UUID | None = None, command: str | None = None) -> dict:
        return {
            "command_id": command or str(uuid.uuid4()),
            "amount": amount,
            "payment_method": "CASH",
        } | ({"store_id": str(store)} if store else {})

    # While the store that sold trades, its debts are its own business.
    async with as_(maker, net, net.seller) as client:
        early = await client.post(
            f"/api/v1/credits/{credit_id}/payments",
            json=payment("100.00", net.shops.primary_store),
        )
        assert early.status_code == 422, early.text
        assert early.json()["details"]["reason"] == "PAID_WHERE_SOLD"
        assert (
            await client.get(
                f"/api/v1/credits/{credit_id}",
                params={"store_id": str(net.shops.primary_store)},
            )
        ).status_code == 403
        # Nor is it among the debts of the stores that do not trade.
        unseen = await client.get(
            "/api/v1/credits/customers",
            params={
                "store_id": str(net.shops.primary_store),
                "elsewhere": "true",
                "query": "0671234567",
            },
        )
        assert unseen.status_code == 200 and unseen.json()["items"] == []

    assert (await set_state(maker, net, "BLOCKED")).status_code == 200
    async with as_(maker, net, net.child_seller) as client:
        not_trading(
            await client.post(f"/api/v1/credits/{credit_id}/payments", json=payment("100.00")),
            "BLOCKED",
        )

    async with as_(maker, net, net.seller) as client:
        params = {"store_id": str(net.shops.primary_store), "elsewhere": "true"}
        found = await client.get(
            "/api/v1/credits/customers", params=params | {"query": "0671234567"}
        )
        assert found.status_code == 200, found.text
        [customer] = found.json()["items"]
        [debt] = customer["credits"]
        assert (debt["id"], debt["store_name"], debt["store_state"], debt["owed"]) == (
            credit_id,
            "Дочірній",
            "BLOCKED",
            "1000.00",
        )
        # The store's own list stays its own.
        own = await client.get(
            "/api/v1/credits/customers",
            params={"store_id": str(net.shops.primary_store), "query": name},
        )
        assert own.json()["items"] == []

        command = str(uuid.uuid4())
        paid = await client.post(
            f"/api/v1/credits/{credit_id}/payments",
            json=payment("400.00", net.shops.primary_store, command),
        )
        assert paid.status_code == 201, paid.text
        replayed = await client.post(
            f"/api/v1/credits/{credit_id}/payments",
            json=payment("400.00", net.shops.primary_store, command),
        )
        assert replayed.json() == paid.json()
        read = await client.get(
            f"/api/v1/credits/{credit_id}", params={"store_id": str(net.shops.primary_store)}
        )
        assert read.status_code == 200, read.text
    body = paid.json()
    # The debt stays the selling store's; the payment names who took it.
    assert (body["store_id"], body["owed"], body["paid"]) == (
        str(net.shops.child_store),
        "600.00",
        "900.00",
    )
    assert [(e["kind"], e["amount"], e["taken_at"]) for e in body["entries"]] == [
        ("PAYMENT", "500.00", None),
        ("PAYMENT", "400.00", "Основний"),
    ]
    async with maker() as session:
        entries = (
            await session.scalars(
                select(CreditEntry.taken_at_store_id)
                .order_by(CreditEntry.created_at)
                .where(CreditEntry.credit_id == uuid.UUID(credit_id))
            )
        ).all()
    assert entries == [None, net.shops.primary_store]

    # The network reads it there too; the child store's own owner does not.
    async with as_(maker, net, net.manager) as client:
        assert (await client.get(f"/api/v1/credits/{credit_id}")).status_code == 200
    async with as_(maker, net, net.child_owner) as client:
        not_trading(await client.get(f"/api/v1/credits/{credit_id}"), "BLOCKED")


async def test_a_debt_elsewhere_is_found_by_the_whole_phone_and_only_while_owed(maker):
    """Owner decisions, 2026-10-10: a store that trades finds a debt of one
    that does not by the customer's whole phone, however it is written, and
    sees only what is still owed. A name or a part of a number finds nobody,
    so another store's customers cannot be gone through."""
    net = await network(maker)
    variant, size = await stocked(maker, net, net.shops.shared_warehouse, qty=6)
    tag = uuid.uuid4().hex[:6]

    async def sold_on_credit(name: str, phone: str) -> str:
        async with as_(maker, net, net.child_seller) as client:
            sale = await client.post(
                "/api/v1/sales",
                json=sale_body(net.shops.child_store, net.shops.shared_warehouse, variant, size)
                | {
                    "credit": {
                        "customer_name": name,
                        "customer_phone": phone,
                        "paid_now": "500.00",
                    }
                },
                headers=key(),
            )
        assert sale.status_code == 201, sale.text
        return sale.json()["credit"]["credit_id"]

    # One customer, the number written four ways (owner decisions,
    # 2026-10-01 and 2026-10-10); another, a digit away; and a number from
    # abroad whose digits hold the first's whole.
    first = await sold_on_credit(f"Ірина-{tag}", "+38 (067) 123-45-67")
    second = await sold_on_credit(f"Ірина Коваль-{tag}", "0671234567")
    eight = await sold_on_credit(f"Ірина-{tag}-вісім", "8 (067) 123-45-67")
    zeros = await sold_on_credit(f"Ірина-{tag}-нулі", "0038 067 123 45 67")
    hers = {first, second, eight, zeros}
    other = await sold_on_credit(f"Ірина-{tag}-інша", "0671234568")
    abroad = await sold_on_credit(f"Ірина-{tag}-закордон", "+48 067 123 45 67")
    assert (await set_state(maker, net, "BLOCKED")).status_code == 200

    # The database reads each stored number as the same customer the code
    # does.
    async with maker() as session:
        keys = (
            await session.execute(
                select(CustomerCredit.phone_digits, CUSTOMER).where(
                    CustomerCredit.organization_id == net.shops.organization_id
                )
            )
        ).all()
    assert len(keys) == 6
    assert all(stored == customer_key(written) for written, stored in keys)
    assert {stored for _, stored in keys} == {"0671234567", "0671234568", "480671234567"}

    params = {"store_id": str(net.shops.primary_store), "elsewhere": "true"}

    async def search(client: httpx.AsyncClient, query: str, **more: str) -> httpx.Response:
        return await client.get(
            "/api/v1/credits/customers", params=params | {"query": query} | more
        )

    async def found(client: httpx.AsyncClient, query: str, **more: str) -> set[str]:
        response = await search(client, query, **more)
        assert response.status_code == 200, (query, response.text)
        assert response.json()["has_more"] is False
        customers = response.json()["items"]
        assert len(customers) <= 1, query
        return {debt["id"] for customer in customers for debt in customer["credits"]}

    async with as_(maker, net, net.seller) as client:
        # Neither a name nor a part of a number is a search here.
        for query in (
            "",
            "І",
            f"Ірина-{tag}",
            "Ірина 0671234567",
            "06",
            "067 123 45 6",
            "671234567",
            "0671234567890123",
        ):
            refused = await search(client, query)
            assert refused.status_code == 422, (query, refused.text)
            assert refused.json()["details"]["reason"] == "PHONE_REQUIRED", query
        # The whole number, however it is written or pasted, finds that
        # customer alone, under each of the ways it was written.
        for query in (
            "0671234567",
            "+380671234567",
            "38 (067) 123-45-67",
            "067.123.45.67",
            "8 067 123 45 67",
            "0038 067 123 45 67",
            # Copied from a phone's contacts, between two direction marks.
            "\u202a+38 067 123 45 67\u202c",
        ):
            assert await found(client, query) == hers, query
        assert await found(client, "0671234568") == {other}
        assert await found(client, "+48 067 123 45 67") == {abroad}

        # Paid in full here, the debt leaves the search; whatever is asked
        # for, only what is still owed is answered.
        paid = await client.post(
            f"/api/v1/credits/{first}/payments",
            json={
                "command_id": str(uuid.uuid4()),
                "amount": "1000.00",
                "payment_method": "CASH",
                "store_id": str(net.shops.primary_store),
            },
        )
        assert paid.status_code == 201, paid.text
        assert paid.json()["status"] == "SETTLED"
        for status in ({}, {"status": "OPEN"}, {"status": "SETTLED"}):
            assert await found(client, "0671234567", **status) == hers - {first}, status
        # Nor is it read by its id here any more: the payment's answer said
        # it was paid. One still owed is.
        at_primary = {"store_id": str(net.shops.primary_store)}
        closed = await client.get(f"/api/v1/credits/{first}", params=at_primary)
        assert closed.status_code == 403, closed.text
        assert closed.json()["code"] == "FORBIDDEN_STORE"
        assert (await client.get(f"/api/v1/credits/{second}", params=at_primary)).status_code == 200

    # Written off by the network's owner, a debt leaves the search too.
    async with as_(maker, net, net.owner) as client:
        written_off = await client.post(
            f"/api/v1/credits/{other}/write-off",
            json={"command_id": str(uuid.uuid4()), "reason": "перевірка"},
        )
        assert written_off.status_code == 200, written_off.text
    async with as_(maker, net, net.seller) as client:
        assert await found(client, "0671234568") == set()
        refused = await client.get(f"/api/v1/credits/{other}", params=at_primary)
        assert refused.status_code == 403, refused.text

    # The network reads the blocked store itself: every debt, by name too.
    async with as_(maker, net, net.manager) as client:
        listed = await client.get(
            "/api/v1/credits/customers",
            params={"store_id": str(net.shops.child_store), "query": f"Ірина-{tag}"},
        )
        assert listed.status_code == 200, listed.text
        assert {d["id"] for c in listed.json()["items"] for d in c["credits"]} == hers | {
            other,
            abroad,
        }


async def test_a_seller_in_every_store_sees_a_closed_one_only_as_its_state(maker):
    """Owner decision, 2026-10-10: a store that does not trade is read by the
    network's owner and managers (2026-10-01). A seller added to every store
    sees only its state, as its own sellers do, and finds its debts from a
    store that trades by the customer's whole phone."""
    net = await network(maker)
    variant, size = await stocked(maker, net, net.shops.shared_warehouse)
    async with as_(maker, net, net.child_seller) as client:
        sale = await client.post(
            "/api/v1/sales",
            json=sale_body(net.shops.child_store, net.shops.shared_warehouse, variant, size)
            | {
                "credit": {
                    "customer_name": "Ірина",
                    "customer_phone": "0671234567",
                    "paid_now": "500.00",
                }
            },
            headers=key(),
        )
    assert sale.status_code == 201, sale.text
    credit_id = sale.json()["credit"]["credit_id"]
    # A seller added to every store of the network at once.
    async with maker() as session:
        role = await session.scalar(
            select(Role).where(
                Role.organization_id == net.shops.organization_id,
                Role.code == RoleCode.SELLER.value,
            )
        )
        assert role is not None
        everywhere = AppUser(
            telegram_user_id=uuid.uuid4().int % 2**62, display_name="network_seller"
        )
        session.add(everywhere)
        await session.flush()
        session.add(
            Membership(
                user_id=everywhere.id,
                organization_id=net.shops.organization_id,
                store_id=None,
                role_id=role.id,
            )
        )
        await session.commit()
    assert (await set_state(maker, net, "BLOCKED")).status_code == 200
    child = {"store_id": str(net.shops.child_store)}

    async with as_(maker, net, everywhere.id) as client:
        for path, params in (
            ("/api/v1/credits/customers", child | {"query": "06"}),
            ("/api/v1/credits", child),
            ("/api/v1/credits/summary", child),
            (f"/api/v1/credits/{credit_id}", {}),
        ):
            not_trading(await client.get(path, params=params), "BLOCKED")
        me = (await client.get("/api/v1/me")).json()
        [blocked] = [store for store in me["stores"] if store["id"] == str(net.shops.child_store)]
        assert (blocked["state"], blocked["permissions"]) == ("BLOCKED", [])
        elsewhere = await client.get(
            "/api/v1/credits/customers",
            params={
                "store_id": str(net.shops.primary_store),
                "elsewhere": "true",
                "query": "067 123 45 67",
            },
        )
        assert elsewhere.status_code == 200, elsewhere.text
        assert [c["credits"][0]["id"] for c in elsewhere.json()["items"]] == [credit_id]

    # The network's manager reads the store itself, as before.
    async with as_(maker, net, net.manager) as client:
        assert (await client.get("/api/v1/credits", params=child)).status_code == 200
    async with maker() as session:
        manager = await resolve_scope(session, net.manager, reading=True)
        seller = await resolve_scope(session, everywhere.id, reading=True)
    assert net.shops.child_store in manager.readable_closed_stores
    assert seller.readable_closed_stores == frozenset()
    assert dict(seller.closed_stores) == {net.shops.child_store: "BLOCKED"}


async def test_the_network_owner_writes_off_a_debt_of_a_store_that_does_not_trade(maker):
    net = await network(maker)
    variant, size = await stocked(maker, net, net.shops.shared_warehouse)
    async with as_(maker, net, net.child_seller) as client:
        sale = await client.post(
            "/api/v1/sales",
            json=sale_body(net.shops.child_store, net.shops.shared_warehouse, variant, size)
            | {
                "credit": {
                    "customer_name": "Петро",
                    "customer_phone": "0501234567",
                    "paid_now": "100.00",
                }
            },
            headers=key(),
        )
    credit_id = sale.json()["credit"]["credit_id"]
    assert (await set_state(maker, net, "BLOCKED")).status_code == 200

    def write_off() -> dict:
        return {"command_id": str(uuid.uuid4()), "reason": "поїхав"}

    for someone in (net.child_owner, net.manager):
        async with as_(maker, net, someone) as client:
            refused = await client.post(f"/api/v1/credits/{credit_id}/write-off", json=write_off())
        assert refused.status_code == 403, refused.text
    async with as_(maker, net, net.owner) as client:
        done = await client.post(f"/api/v1/credits/{credit_id}/write-off", json=write_off())
    assert done.status_code == 200, done.text
    assert (done.json()["status"], done.json()["written_off"]) == ("WRITTEN_OFF", "1400.00")


async def test_a_store_blocked_while_a_command_runs_waits_for_it(maker):
    """The command holds its store; the change of state waits, then reads
    what the command did. Without the hold, goods received in that instant
    would stand in an archived store that promised to be empty."""
    net = await network(maker)
    variant, size = await stocked(maker, net, net.own, qty=1)
    async with as_(maker, net, net.child_seller) as client:
        sale = await client.post(
            "/api/v1/sales",
            json=sale_body(net.shops.child_store, net.own, variant, size),
            headers=key(),
        )
    assert sale.status_code == 201, sale.text

    async with maker() as owner_session:
        owner = await resolve_scope(owner_session, net.owner)

    async with maker() as running:
        # A command in flight in the child store: it holds the store.
        await lock_stock(
            running,
            organization_id=net.shops.organization_id,
            keys=[(net.own, uuid.UUID(variant), uuid.UUID(size))],
            acting_store_ids={net.shops.child_store},
        )

        async def archive() -> Exception | None:
            async with maker() as session:
                try:
                    await change_state(
                        session,
                        scope=owner,
                        store_id=net.shops.child_store,
                        command_id=uuid.uuid4(),
                        state=StoreState.ARCHIVED,
                        reason="закриваємось",
                    )
                    await session.commit()
                except ValidationFailedError as error:
                    return error
            return None

        waiting = asyncio.create_task(archive())
        await asyncio.sleep(0.5)
        assert not waiting.done()
        # The command puts a coat back where the store manages it, and ends.
        from app.modules.inventory.models import Inventory

        await running.execute(
            update(Inventory)
            .where(Inventory.location_id == net.own)
            .values(quantity=Inventory.quantity + 1)
        )
        await running.commit()
    error = await waiting
    assert isinstance(error, ValidationFailedError)
    assert error.details["reason"] == "NOT_EMPTY"


async def test_a_seller_only_in_a_blocked_store_still_signs_in(maker):
    net = await network(maker)
    assert (await set_state(maker, net, "BLOCKED")).status_code == 200
    async with maker() as session:
        scope = await resolve_scope(session, net.child_seller, reading=True)
    assert scope.store_ids == frozenset()
    assert dict(scope.closed_stores) == {net.shops.child_store: "BLOCKED"}


async def test_the_downgrade_refuses_once_a_state_was_changed():
    from tests.integration.test_stock_rekey_migration import _admin, _alembic, _run, _url_for

    name = f"birka_states_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    engine = new_engine(_url_for(name))
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        fresh = async_sessionmaker(engine, expire_on_commit=False)
        net = await network(fresh)
        # Blocked by an operator, as only one could before: it round-trips.
        async with fresh() as session:
            await session.execute(
                update(Store).where(Store.id == net.shops.child_store).values(state="BLOCKED")
            )
            await session.commit()
        await _run(config, "downgrade", "0024_returns_elsewhere", database=name)
        await _run(config, "upgrade", "head", database=name)
        async with fresh() as session:
            assert (await session.get(Store, net.shops.child_store)).state == "BLOCKED"  # type: ignore[union-attr]
            assert (await session.get(Store, net.shops.primary_store)).state == "ACTIVE"  # type: ignore[union-attr]
        assert (await set_state(fresh, net, "ACTIVE")).status_code == 200
        with pytest.raises(Exception, match="store state was changed"):
            await _run(config, "downgrade", "0024_returns_elsewhere", database=name)
    finally:
        await engine.dispose()
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
