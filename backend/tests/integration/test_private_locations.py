"""Private warehouses require direct operation rights, not global elevation."""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
from scripts.seed_organization import seed_in_session
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.main import create_app
from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.authz.service import resolve_scope
from app.modules.identity.models import AppUser
from app.modules.tenancy.models import (
    Organization,
    StockLocation,
    Store,
    StoreKind,
    StoreLocationAccess,
)
from tests.conftest import requires_database

pytestmark = [pytest.mark.integration, requires_database()]


@asynccontextmanager
async def client_for(maker, user_id):
    app = create_app(
        Settings(app_env="local", session_secret="private-test-secret-at-least-32-bytes")
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


@pytest.fixture
async def world():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker.begin() as session:
        telegram_id = uuid.uuid4().int % 2**62
        org = await seed_in_session(
            session,
            telegram_user_id=telegram_id,
            owner_name="Owner",
            org_name=f"private-{uuid.uuid4()}",
            with_child_warehouse=True,
        )
        stores = {
            s.code: s.id
            for s in await session.scalars(select(Store).where(Store.organization_id == org))
        }
        roles = {
            r.code: r.id
            for r in await session.scalars(select(Role).where(Role.organization_id == org))
        }
        owner = await session.scalar(select(AppUser).where(AppUser.telegram_user_id == telegram_id))
        locations = list(
            await session.scalars(select(StockLocation).where(StockLocation.organization_id == org))
        )
        private = next(
            location.id for location in locations if location.managing_store_id is not None
        )
        shared = next(location.id for location in locations if location.managing_store_id is None)
        sibling = Store(organization_id=org, code="THIRD", name="Sibling", kind=StoreKind.SECONDARY)
        session.add(sibling)
        viewer_role = Role(organization_id=org, code="VIEWER", name="Viewer", is_system=False)
        session.add(viewer_role)
        await session.flush()
        session.add(RolePermission(role_id=viewer_role.id, permission_code="inventory:view"))
        # Deliberately excessive store ACLs must not bypass private control.
        for store in (stores["MAIN"], sibling.id):
            session.add(
                StoreLocationAccess(
                    organization_id=org,
                    store_id=store,
                    location_id=private,
                    can_sell=True,
                    can_receive=True,
                )
            )
        users = {"owner": owner.id}
        for name, store_id, role_id in (
            ("child", stores["SECOND"], roles["MANAGER"]),
            ("seller", stores["SECOND"], roles["SELLER"]),
            ("primary", stores["MAIN"], roles["MANAGER"]),
            ("sibling", sibling.id, roles["MANAGER"]),
            ("elevated_viewer", stores["SECOND"], viewer_role.id),
        ):
            user = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name=name)
            session.add(user)
            await session.flush()
            users[name] = user.id
            session.add(
                Membership(user_id=user.id, organization_id=org, store_id=store_id, role_id=role_id)
            )
            if name == "elevated_viewer":
                session.add(
                    Membership(
                        user_id=user.id, organization_id=org, store_id=None, role_id=roles["OWNER"]
                    )
                )
    data = {
        "maker": maker,
        "org": org,
        "stores": stores,
        "users": users,
        "private": private,
        "shared": shared,
        "sibling": sibling.id,
    }
    async with client_for(maker, users["child"]) as client:
        result = await client.post(
            "/api/v1/catalog/products",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json={
                "store_id": str(stores["SECOND"]),
                "concept": "Private coat",
                "variant": {"color": "чорний"},
                "sizes": [{"system": "ALPHA", "code": "M"}],
            },
        )
        assert result.status_code == 201, result.text
        data["variant"] = result.json()["product_variant_id"]
        data["size"] = result.json()["sizes"][0]["size_id"]
        receipt = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=receipt_payload(data),
        )
        assert receipt.status_code == 201, receipt.text
    yield data
    await engine.dispose()


def receipt_payload(w):
    return {
        "store_id": str(w["stores"]["SECOND"]),
        "location_id": str(w["private"]),
        "lines": [{"product_variant_id": w["variant"], "size_id": w["size"], "quantity": 4}],
    }


@pytest.mark.parametrize("actor", ["owner", "primary", "sibling"])
async def test_private_hidden_even_with_excessive_acl(world, actor):
    w = world
    store_id = (
        w["stores"]["SECOND"]
        if actor == "owner"
        else (w["sibling"] if actor == "sibling" else w["stores"]["MAIN"])
    )
    async with client_for(w["maker"], w["users"][actor]) as client:
        listing = await client.get("/api/v1/stock-locations", params={"store_id": str(store_id)})
        assert listing.status_code == 200
        assert str(w["private"]) not in {location["id"] for location in listing.json()}
        stock = await client.get("/api/v1/inventory", params={"store_id": str(store_id)})
        assert stock.status_code == 200
        assert not stock.json()["rows"]
        explicit = await client.get(
            "/api/v1/inventory",
            params={"store_id": str(store_id), "location_id": str(w["private"])},
        )
        assert explicit.status_code == 403
        payload = receipt_payload(w)
        payload["store_id"] = str(store_id)
        refused = await client.post(
            "/api/v1/inventory/receipts",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json=payload,
        )
        assert refused.status_code == 403


@pytest.mark.parametrize("actor", ["child", "seller", "elevated_viewer"])
async def test_explicit_child_view_remains_valid(world, actor):
    w = world
    async with client_for(w["maker"], w["users"][actor]) as client:
        result = await client.get(
            "/api/v1/inventory",
            params={"store_id": str(w["stores"]["SECOND"]), "location_id": str(w["private"])},
        )
        assert result.status_code == 200
        assert result.json()["rows"][0]["quantity"] == 4


@pytest.mark.parametrize("operation", ["receipt", "adjust", "sale", "transfer"])
async def test_org_owner_cannot_promote_direct_child_view_to_write(world, operation):
    w = world
    payload = receipt_payload(w)
    if operation == "receipt":
        path = "/api/v1/inventory/receipts"
    elif operation == "adjust":
        path = "/api/v1/inventory/adjustments"
        payload = {
            "store_id": payload["store_id"],
            "location_id": payload["location_id"],
            "product_variant_id": w["variant"],
            "size_id": w["size"],
            "quantity_delta": -1,
            "reason_code": "STOCKTAKE",
        }
    elif operation == "sale":
        path = "/api/v1/sales"
        payload = {
            "store_id": payload["store_id"],
            "command_id": str(uuid.uuid4()),
            "lines": [
                {
                    "product_variant_id": w["variant"],
                    "size_id": w["size"],
                    "source_location_id": str(w["private"]),
                    "quantity": 1,
                    "unit_price": "100.00",
                }
            ],
        }
    else:
        path = "/api/v1/transfers"
        payload = {
            "store_id": payload["store_id"],
            "command_id": str(uuid.uuid4()),
            "from_location_id": str(w["private"]),
            "to_location_id": str(w["shared"]),
            "lines": [{"product_variant_id": w["variant"], "size_id": w["size"], "quantity": 1}],
        }
    async with client_for(w["maker"], w["users"]["elevated_viewer"]) as client:
        result = await client.post(
            path, headers={"Idempotency-Key": str(uuid.uuid4())}, json=payload
        )
        assert result.status_code == 403, result.text


async def test_cached_receipt_refused_after_direct_membership_revocation(world):
    w = world
    headers = {"Idempotency-Key": str(uuid.uuid4())}
    async with w["maker"].begin() as session:
        owner_role = await session.scalar(
            select(Role.id).where(Role.organization_id == w["org"], Role.code == "OWNER")
        )
        session.add(
            Membership(
                user_id=w["users"]["child"],
                organization_id=w["org"],
                store_id=None,
                role_id=owner_role,
            )
        )
    async with client_for(w["maker"], w["users"]["child"]) as client:
        before = await client.post(
            "/api/v1/inventory/receipts", headers=headers, json=receipt_payload(w)
        )
        assert before.status_code == 201
        async with w["maker"].begin() as session:
            await session.execute(
                update(Membership)
                .where(
                    Membership.user_id == w["users"]["child"],
                    Membership.store_id == w["stores"]["SECOND"],
                )
                .values(is_active=False)
            )
        retry = await client.post(
            "/api/v1/inventory/receipts", headers=headers, json=receipt_payload(w)
        )
        assert retry.status_code == 403, retry.text


async def test_private_manager_fk_cannot_cross_tenant(world):
    w = world
    async with w["maker"]() as session:
        org = Organization(name="Foreign private test")
        session.add(org)
        await session.flush()
        session.add(
            StockLocation(
                organization_id=org.id,
                code="PRIVATE",
                name="Foreign",
                managing_store_id=w["stores"]["SECOND"],
            )
        )
        with pytest.raises(IntegrityError, match="fk_stock_location_org_managing_store"):
            await session.flush()


@pytest.mark.parametrize("operation", ["sale", "transfer", "refund"])
async def test_permanent_and_cached_replay_require_direct_private_rights(world, operation):
    w = world
    async with w["maker"].begin() as session:
        owner_role = await session.scalar(
            select(Role.id).where(Role.organization_id == w["org"], Role.code == "OWNER")
        )
        session.add(
            Membership(
                user_id=w["users"]["child"],
                organization_id=w["org"],
                store_id=None,
                role_id=owner_role,
            )
        )
    sale_payload = {
        "store_id": str(w["stores"]["SECOND"]),
        "command_id": str(uuid.uuid4()),
        "lines": [
            {
                "product_variant_id": w["variant"],
                "size_id": w["size"],
                "source_location_id": str(w["private"]),
                "quantity": 1,
                "unit_price": "100.00",
            }
        ],
    }
    headers = {"Idempotency-Key": str(uuid.uuid4())}
    async with client_for(w["maker"], w["users"]["child"]) as client:
        if operation == "sale":
            path, payload = "/api/v1/sales", sale_payload
        elif operation == "transfer":
            path = "/api/v1/transfers"
            payload = {
                "store_id": sale_payload["store_id"],
                "command_id": str(uuid.uuid4()),
                "from_location_id": str(w["private"]),
                "to_location_id": str(w["shared"]),
                "lines": [
                    {"product_variant_id": w["variant"], "size_id": w["size"], "quantity": 1}
                ],
            }
        else:
            sale = await client.post(
                "/api/v1/sales", headers={"Idempotency-Key": str(uuid.uuid4())}, json=sale_payload
            )
            assert sale.status_code == 201, sale.text
            path = f"/api/v1/sales/{sale.json()['id']}/refunds"
            payload = {
                "command_id": str(uuid.uuid4()),
                "reason": "Private return",
                "lines": [
                    {"sale_item_id": sale.json()["items"][0]["id"], "quantity": 1, "restock": True}
                ],
            }
        original = await client.post(path, headers=headers, json=payload)
        assert original.status_code == 201, original.text
        async with w["maker"].begin() as session:
            await session.execute(
                update(Membership)
                .where(
                    Membership.user_id == w["users"]["child"],
                    Membership.store_id == w["stores"]["SECOND"],
                )
                .values(is_active=False)
            )
        for replay_headers in (headers, {"Idempotency-Key": str(uuid.uuid4())}):
            replay = await client.post(path, headers=replay_headers, json=payload)
            assert replay.status_code == 403, replay.text


@pytest.mark.parametrize(
    "report,permission",
    [
        ("found_in_store", "inventory:correct_during_sale"),
        ("missing_in_store", "inventory:report_missing_during_sale"),
        ("size_clarified", "inventory:correct_during_sale"),
    ],
)
async def test_private_sale_cannot_borrow_global_correction_permission(world, report, permission):
    w = world
    async with w["maker"].begin() as session:
        role = Role(organization_id=w["org"], code="SALE_ONLY", name="Sale only", is_system=False)
        session.add(role)
        await session.flush()
        session.add(RolePermission(role_id=role.id, permission_code="sale:create"))
        await session.execute(
            update(Membership)
            .where(
                Membership.user_id == w["users"]["elevated_viewer"],
                Membership.store_id == w["stores"]["SECOND"],
            )
            .values(role_id=role.id)
        )
    payload = {
        "store_id": str(w["stores"]["SECOND"]),
        "command_id": str(uuid.uuid4()),
        "lines": [
            {
                "product_variant_id": w["variant"],
                "size_id": w["size"],
                "source_location_id": str(w["private"]),
                "quantity": 2,
                "unit_price": "100.00",
            }
        ],
        report: [{"line_index": 0, "quantity": 1}],
    }
    async with client_for(w["maker"], w["users"]["elevated_viewer"]) as client:
        response = await client.post(
            "/api/v1/sales", headers={"Idempotency-Key": str(uuid.uuid4())}, json=payload
        )
        assert response.status_code == 403, response.text
        assert response.json()["details"]["permission"] == permission


async def test_child_manager_moves_private_to_shared_and_back(world):
    w = world
    async with client_for(w["maker"], w["users"]["child"]) as client:
        for source, destination in ((w["private"], w["shared"]), (w["shared"], w["private"])):
            response = await client.post(
                "/api/v1/transfers",
                headers={"Idempotency-Key": str(uuid.uuid4())},
                json={
                    "store_id": str(w["stores"]["SECOND"]),
                    "command_id": str(uuid.uuid4()),
                    "from_location_id": str(source),
                    "to_location_id": str(destination),
                    "lines": [
                        {"product_variant_id": w["variant"], "size_id": w["size"], "quantity": 1}
                    ],
                },
            )
            assert response.status_code == 201, response.text
        stock = await client.get(
            "/api/v1/inventory",
            params={"store_id": str(w["stores"]["SECOND"]), "location_id": str(w["private"])},
        )
        assert stock.json()["rows"][0]["quantity"] == 4


async def test_direct_child_seller_can_sell_and_restock_refund(world):
    w = world
    async with client_for(w["maker"], w["users"]["seller"]) as client:
        sale = await client.post(
            "/api/v1/sales",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json={
                "store_id": str(w["stores"]["SECOND"]),
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "source_location_id": str(w["private"]),
                        "product_variant_id": w["variant"],
                        "size_id": w["size"],
                        "quantity": 1,
                        "unit_price": "100.00",
                    }
                ],
            },
        )
        assert sale.status_code == 201, sale.text
        refund = await client.post(
            f"/api/v1/sales/{sale.json()['id']}/refunds",
            headers={"Idempotency-Key": str(uuid.uuid4())},
            json={
                "command_id": str(uuid.uuid4()),
                "reason": "Returned",
                "lines": [
                    {"sale_item_id": sale.json()["items"][0]["id"], "quantity": 1, "restock": True}
                ],
            },
        )
        assert refund.status_code == 201, refund.text
        stock = await client.get(
            "/api/v1/inventory",
            params={"store_id": str(w["stores"]["SECOND"]), "location_id": str(w["private"])},
        )
        assert stock.json()["rows"][0]["quantity"] == 4
