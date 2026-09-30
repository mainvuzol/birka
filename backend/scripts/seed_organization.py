"""Bootstrap two stores, a shared warehouse, default roles and an owner.

Run against a migrated database:
    python -m scripts.seed_organization --telegram-user-id 123456789

Add --with-child-warehouse to create an optional SECOND-only warehouse.
Each store also gets its own «Брак», where units returned damaged go and
nothing is sold (owner decision, 2026-10-01).
Existing warehouses without a recorded bootstrap mapping require explicit
operator setup; their codes and names never imply authority. Repeating setup
preserves grants (including revocation), paused warehouses and quantities.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.models_registry  # noqa: F401  - every table on the metadata, like migrations/env.py
from app.core.config import get_settings
from app.core.db import create_engine
from app.modules.audit import service as audit
from app.modules.audit.models import AuditLog
from app.modules.authz.models import Membership
from app.modules.authz.permissions import RoleCode
from app.modules.authz.service import seed_default_roles
from app.modules.identity.models import AppUser
from app.modules.tenancy.models import (
    Organization,
    StockLocation,
    Store,
    StoreKind,
    StoreLocationAccess,
)

SHARED_ACTION = "bootstrap.shared_warehouse.v1"
CHILD_ACTION = "bootstrap.child_warehouse.v1"
DAMAGED_ACTION = "bootstrap.damaged_returns.v1"


class BootstrapConflictError(ValueError):
    """Existing setup needs an explicit operator decision, not guessed grants."""


async def _lock(session: AsyncSession, key: str) -> None:
    lock_id = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True)
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})


async def _marker(session: AsyncSession, org_id: uuid.UUID, action: str) -> AuditLog | None:
    rows = (
        await session.scalars(
            select(AuditLog).where(AuditLog.organization_id == org_id, AuditLog.action == action)
        )
    ).all()
    if len(rows) > 1:
        raise BootstrapConflictError("Multiple bootstrap records; explicit operator setup required")
    return rows[0] if rows else None


async def _validate_mapping(
    session: AsyncSession, org_id: uuid.UUID, marker: AuditLog
) -> tuple[uuid.UUID, uuid.UUID]:
    try:
        data = marker.after or {}
        main_id = uuid.UUID(data["main_store_id"])
        child_id = uuid.UUID(data["child_store_id"])
        location_id = uuid.UUID(data["location_id"])
    except (KeyError, ValueError, TypeError, AttributeError) as exc:
        raise BootstrapConflictError("Invalid bootstrap mapping; explicit setup required") from exc
    stores = set(
        await session.scalars(
            select(Store.id).where(
                Store.organization_id == org_id, Store.id.in_([main_id, child_id])
            )
        )
    )
    location = await session.scalar(
        select(StockLocation).where(
            StockLocation.organization_id == org_id, StockLocation.id == location_id
        )
    )
    if main_id == child_id or stores != {main_id, child_id} or location is None:
        raise BootstrapConflictError("Bootstrap targets changed; explicit operator setup required")
    expected_manager = child_id if marker.action == CHILD_ACTION else None
    if location.managing_store_id != expected_manager:
        raise BootstrapConflictError("Warehouse control changed; explicit operator setup required")
    return main_id, child_id


async def _create_warehouse(
    session: AsyncSession,
    *,
    org_id: uuid.UUID,
    main_id: uuid.UUID,
    child_id: uuid.UUID,
    child: bool,
) -> None:
    location = StockLocation(
        organization_id=org_id,
        code="BOOTSTRAP-CHILD" if child else "BOOTSTRAP-SHARED",
        name="Власний склад другого магазину" if child else "Спільний склад",
        managing_store_id=child_id if child else None,
    )
    session.add(location)
    await session.flush()
    for store_id in [child_id] if child else [main_id, child_id]:
        session.add(
            StoreLocationAccess(
                organization_id=org_id,
                store_id=store_id,
                location_id=location.id,
                can_sell=True,
                can_receive=True,
            )
        )
    await audit.record(
        session,
        organization_id=org_id,
        actor_user_id=None,
        action=CHILD_ACTION if child else SHARED_ACTION,
        entity_type="stock_location",
        entity_id=location.id,
        after={
            "main_store_id": str(main_id),
            "child_store_id": str(child_id),
            "location_id": str(location.id),
            "access": [
                {"store_id": str(store_id), "can_sell": True, "can_receive": True}
                for store_id in ([child_id] if child else [main_id, child_id])
            ],
        },
        reason="Explicit CLI organization bootstrap; no stock was created or moved",
    )


async def _ensure_damaged_returns(
    session: AsyncSession, *, org_id: uuid.UUID, stores: dict[str, uuid.UUID]
) -> None:
    """Each store's own «Брак» (owner decision, 2026-10-01): a warehouse the
    store receives damaged returns into and never sells from.

    Created once per store and recorded. A recorded one is never created
    again, even if an operator later revoked or changed its grant: repeating
    setup preserves what was changed by hand. A store someone already gave a
    «Брак» by hand keeps it.
    """
    recorded = {
        (entry.after or {}).get("store_id")
        for entry in await session.scalars(
            select(AuditLog).where(
                AuditLog.organization_id == org_id, AuditLog.action == DAMAGED_ACTION
            )
        )
    }
    for role, store_id in stores.items():
        if str(store_id) in recorded or await session.scalar(
            select(StoreLocationAccess.id).where(
                StoreLocationAccess.store_id == store_id,
                StoreLocationAccess.damaged_returns.is_(True),
            )
        ):
            continue
        code = f"BOOTSTRAP-DAMAGED-{role}"
        if await session.scalar(
            select(StockLocation.id).where(
                StockLocation.organization_id == org_id, StockLocation.code == code
            )
        ):
            raise BootstrapConflictError(
                f"Warehouse {code} exists but is not recorded as a store's «Брак»; "
                "set it up explicitly"
            )
        store = await session.get(Store, store_id)
        if store is None:
            raise BootstrapConflictError(
                "Bootstrap targets changed; explicit operator setup required"
            )
        location = StockLocation(organization_id=org_id, code=code, name=f"Брак — {store.name}")
        session.add(location)
        await session.flush()
        session.add(
            StoreLocationAccess(
                organization_id=org_id,
                store_id=store_id,
                location_id=location.id,
                can_sell=False,
                can_receive=True,
                damaged_returns=True,
            )
        )
        await audit.record(
            session,
            organization_id=org_id,
            actor_user_id=None,
            action=DAMAGED_ACTION,
            entity_type="stock_location",
            entity_id=location.id,
            after={
                "store_id": str(store_id),
                "location_id": str(location.id),
                "access": {"can_sell": False, "can_receive": True, "damaged_returns": True},
            },
            reason="Explicit CLI organization bootstrap; no stock was created or moved",
        )


async def seed_in_session(
    session: AsyncSession,
    *,
    telegram_user_id: int,
    owner_name: str,
    org_name: str,
    currency_code: str = "UAH",
    with_child_warehouse: bool = False,
) -> uuid.UUID:
    """Bootstrap inside a caller-owned transaction; caller must roll back failures.

    Transaction advisory locks serialize this CLI's organization setup and user
    creation. They do not replace an operational maintenance window for other
    administrative tools writing tenancy configuration concurrently.
    """
    await _lock(session, f"birka:bootstrap:organization:{org_name}")
    organizations = (
        await session.scalars(select(Organization).where(Organization.name == org_name))
    ).all()
    if len(organizations) > 1:
        raise BootstrapConflictError("Organization name is ambiguous; explicit setup required")
    organization = organizations[0] if organizations else None
    if organization is None:
        organization = Organization(name=org_name, currency_code=currency_code)
        session.add(organization)
        await session.flush()

    marker = await _marker(session, organization.id, SHARED_ACTION)
    if marker is None:
        if await session.scalar(
            select(StockLocation.id)
            .where(StockLocation.organization_id == organization.id)
            .limit(1)
        ):
            raise BootstrapConflictError(
                "Existing warehouses have no bootstrap mapping; configure their access explicitly. "
                "No warehouse, stock or grant was changed."
            )
        stores: dict[str, Store] = {}
        for code, name, kind in (
            ("MAIN", "Основний магазин", StoreKind.PRIMARY),
            ("SECOND", "Другий магазин", StoreKind.SECONDARY),
        ):
            store = await session.scalar(
                select(Store).where(Store.organization_id == organization.id, Store.code == code)
            )
            if store is None:
                store = Store(organization_id=organization.id, name=name, code=code, kind=kind)
                session.add(store)
                await session.flush()
            elif store.kind != kind:
                raise BootstrapConflictError("Existing store kind differs; explicit setup required")
            stores[code] = store
        main_id, child_id = stores["MAIN"].id, stores["SECOND"].id
        await _create_warehouse(
            session, org_id=organization.id, main_id=main_id, child_id=child_id, child=False
        )
    else:
        main_id, child_id = await _validate_mapping(session, organization.id, marker)

    if with_child_warehouse:
        child_marker = await _marker(session, organization.id, CHILD_ACTION)
        if child_marker is not None:
            mapped_stores = await _validate_mapping(session, organization.id, child_marker)
            if mapped_stores != (main_id, child_id):
                raise BootstrapConflictError("Inconsistent bootstrap store mappings")
        else:
            # Any unrecorded warehouse could already be the child's. A matching
            # code is not proof, and creating a second warehouse would hide that.
            recorded_locations = select(AuditLog.entity_id).where(
                AuditLog.organization_id == organization.id,
                AuditLog.action.in_([SHARED_ACTION, CHILD_ACTION, DAMAGED_ACTION]),
                AuditLog.entity_id.is_not(None),
            )
            if await session.scalar(
                select(StockLocation.id)
                .where(
                    StockLocation.organization_id == organization.id,
                    StockLocation.id.not_in(recorded_locations),
                )
                .limit(1)
            ):
                raise BootstrapConflictError(
                    "Unmapped warehouses exist; explicit child setup required"
                )
            await _create_warehouse(
                session, org_id=organization.id, main_id=main_id, child_id=child_id, child=True
            )

    await _ensure_damaged_returns(
        session, org_id=organization.id, stores={"MAIN": main_id, "SECOND": child_id}
    )

    roles = await seed_default_roles(session, organization.id)
    await _lock(session, f"birka:bootstrap:telegram-user:{telegram_user_id}")
    user = await session.scalar(select(AppUser).where(AppUser.telegram_user_id == telegram_user_id))
    if user is None:
        user = AppUser(telegram_user_id=telegram_user_id, display_name=owner_name)
        session.add(user)
        await session.flush()
    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == organization.id,
            Membership.store_id.is_(None),
        )
    )
    if membership is None:
        session.add(
            Membership(
                user_id=user.id,
                organization_id=organization.id,
                store_id=None,
                role_id=roles[RoleCode.OWNER.value].id,
            )
        )
    await session.flush()
    return organization.id


async def seed(
    *, telegram_user_id: int, owner_name: str, org_name: str, with_child_warehouse: bool = False
) -> None:
    settings = get_settings()
    engine = create_engine(settings)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False).begin() as session:
            org_id = await seed_in_session(
                session,
                telegram_user_id=telegram_user_id,
                owner_name=owner_name,
                org_name=org_name,
                currency_code=settings.default_currency_code,
                with_child_warehouse=with_child_warehouse,
            )
        print(f"seed complete for organization {org_id}")
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--telegram-user-id", type=int, required=True)
    parser.add_argument("--owner-name", default="Власниця")
    parser.add_argument("--org-name", default="birka")
    parser.add_argument("--with-child-warehouse", action="store_true")
    args = parser.parse_args()
    try:
        asyncio.run(seed(**vars(args)))
    except BootstrapConflictError as exc:
        parser.exit(2, f"Setup refused: {exc}\n")


if __name__ == "__main__":
    main()
