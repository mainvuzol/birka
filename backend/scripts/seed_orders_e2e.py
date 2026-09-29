"""Seed a unique synthetic shop in an explicitly named isolated E2E database."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from decimal import Decimal
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models_registry  # noqa: F401  - every table on the metadata, like migrations/env.py
from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.authz.permissions import Permission
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    CanonicalConcept,
    ProductFamily,
    ProductVariant,
    Size,
    SizeSystem,
    SizeSystemCode,
)
from app.modules.identity.models import AppUser
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import MovementRequest, apply_movements
from app.modules.tenancy.models import (
    Organization,
    StockLocation,
    Store,
    StoreKind,
    StoreLocationAccess,
)


async def main() -> None:
    url = os.environ["BIRKA_TEST_DATABASE_URL"]
    # Refuse accidental use of a developer's normal database.
    if not url.startswith("postgresql+asyncpg://birka_review@127.0.0.1:55442/") or not url.endswith(
        "/birka_orders_ui"
    ):
        raise RuntimeError("This fixture only accepts the isolated birka_orders_ui database")
    engine = create_async_engine(url)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker.begin() as session:
        org = Organization(name=f"e2e-{uuid.uuid4().hex}", currency_code="UAH")
        session.add(org)
        await session.flush()
        store = Store(organization_id=org.id, name="Основний", code="MAIN", kind=StoreKind.PRIMARY)
        location = StockLocation(organization_id=org.id, name="Основний склад", code="E2E")
        # A second warehouse for the till's own flows. The order specs reserve
        # stock on the first one, and a reservation makes a shortfall
        # uncorrectable by design — so a sale test sharing that shelf could
        # never reach «фізично є».
        till = StockLocation(organization_id=org.id, name="Каса-склад", code="E2E-TILL")
        concept = CanonicalConcept(organization_id=org.id, name="Лоран", normalized_name="лоран")
        system = SizeSystem(organization_id=org.id, code=SizeSystemCode.ALPHA, name="Alpha")
        user = AppUser(telegram_user_id=uuid.uuid4().int % 2**52, display_name="Оля")
        colour = AttributeTerm(
            organization_id=org.id,
            kind=AttributeKind.COLOR,
            name="шоколад",
            normalized_name="шоколад",
        )
        session.add_all([store, location, till, concept, system, user, colour])
        await session.flush()
        size = Size(size_system_id=system.id, code="M")
        family = ProductFamily(organization_id=org.id, canonical_concept_id=concept.id)
        session.add_all([size, family])
        await session.flush()
        variant = ProductVariant(
            product_family_id=family.id, color_term_id=colour.id, length_cm=Decimal("70")
        )
        session.add(variant)
        for reachable in (location, till):
            session.add(
                StoreLocationAccess(
                    organization_id=org.id,
                    store_id=store.id,
                    location_id=reachable.id,
                    can_sell=True,
                    can_receive=True,
                )
            )
        await session.flush()
        await apply_movements(
            session,
            organization_id=org.id,
            actor_user_id=user.id,
            requests=[
                MovementRequest(
                    location_id=stocked.id,
                    acting_store_id=store.id,
                    product_variant_id=variant.id,
                    size_id=size.id,
                    quantity_delta=30,
                    movement_type=MovementType.DELIVERY,
                )
                for stocked in (location, till)
            ],
        )
        role = Role(organization_id=org.id, code="E2E", name="Тестовий продавець")
        session.add(role)
        await session.flush()
        session.add_all(
            [RolePermission(role_id=role.id, permission_code=p.value) for p in Permission]
        )
        session.add(
            Membership(
                user_id=user.id,
                organization_id=org.id,
                store_id=store.id,
                role_id=role.id,
            )
        )
        data = {
            "telegram_user_id": str(user.telegram_user_id),
            "store_id": str(store.id),
            "location_id": str(location.id),
            "till_location_id": str(till.id),
            "variant_id": str(variant.id),
            "size_id": str(size.id),
        }
    await engine.dispose()
    Path(os.environ["BIRKA_E2E_FIXTURE"]).write_text(json.dumps(data))


if __name__ == "__main__":
    asyncio.run(main())
