"""Seed a unique synthetic shop in an explicitly named isolated E2E database."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.authz.permissions import Permission
from app.modules.identity.models import AppUser
from tests.integration.test_sale_command import give_stock, make_shop


async def main() -> None:
    url = os.environ["BIRKA_TEST_DATABASE_URL"]
    # Refuse accidental use of a developer's normal database.
    if not url.startswith("postgresql+asyncpg://birka_review@127.0.0.1:55442/") or not url.endswith(
        "/birka_orders_ui"
    ):
        raise RuntimeError("This fixture only accepts the isolated birka_orders_ui database")
    engine = create_async_engine(url)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        shop = await make_shop(session)
        await give_stock(session, shop, 30)
        role = Role(organization_id=shop.organization_id, code="E2E", name="Тестовий продавець")
        session.add(role)
        await session.flush()
        session.add_all(
            [RolePermission(role_id=role.id, permission_code=p.value) for p in Permission]
        )
        session.add(
            Membership(
                user_id=shop.user_id,
                organization_id=shop.organization_id,
                store_id=shop.store_id,
                role_id=role.id,
            )
        )
        user = await session.scalar(select(AppUser).where(AppUser.id == shop.user_id))
        assert user is not None
        data = {
            "telegram_user_id": str(user.telegram_user_id),
            "store_id": str(shop.store_id),
            "location_id": str(shop.location_id),
            "variant_id": str(shop.variant_id),
            "size_id": str(shop.size_id),
        }
        await session.commit()
    await engine.dispose()
    Path(os.environ["BIRKA_E2E_FIXTURE"]).write_text(json.dumps(data))


if __name__ == "__main__":
    asyncio.run(main())
