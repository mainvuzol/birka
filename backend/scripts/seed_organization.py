"""Seed one organization, its two stores, the default roles and an owner.

Run once against a migrated database:

    python -m scripts.seed_organization --telegram-user-id 123456789

Idempotent: running it twice changes nothing. It is a setup tool, not a
migration — schema and data stay separate.
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.config import get_settings
from app.core.db import create_engine
from app.modules.authz.models import Membership
from app.modules.authz.permissions import RoleCode
from app.modules.authz.service import seed_default_roles
from app.modules.identity.models import AppUser
from app.modules.tenancy.models import Organization, Store, StoreKind


async def seed(*, telegram_user_id: int, owner_name: str, org_name: str) -> None:
    settings = get_settings()
    engine = create_engine(settings)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async with maker() as session:
        organization = (
            await session.execute(select(Organization).where(Organization.name == org_name))
        ).scalar_one_or_none()
        if organization is None:
            organization = Organization(name=org_name, currency_code=settings.default_currency_code)
            session.add(organization)
            await session.flush()
            print(f"created organization {organization.id}")

        for code, name, kind in (
            ("MAIN", "Основний магазин", StoreKind.PRIMARY),
            ("SECOND", "Другий магазин", StoreKind.SECONDARY),
        ):
            exists = (
                await session.execute(
                    select(Store).where(
                        Store.organization_id == organization.id, Store.code == code
                    )
                )
            ).scalar_one_or_none()
            if exists is None:
                session.add(Store(organization_id=organization.id, name=name, code=code, kind=kind))
                print(f"created store {code}")

        await session.flush()
        roles = await seed_default_roles(session, organization.id)

        user = (
            await session.execute(
                select(AppUser).where(AppUser.telegram_user_id == telegram_user_id)
            )
        ).scalar_one_or_none()
        if user is None:
            user = AppUser(telegram_user_id=telegram_user_id, display_name=owner_name)
            session.add(user)
            await session.flush()
            print(f"created user {user.id}")

        membership = (
            await session.execute(
                select(Membership).where(
                    Membership.user_id == user.id,
                    Membership.organization_id == organization.id,
                    Membership.store_id.is_(None),
                )
            )
        ).scalar_one_or_none()
        if membership is None:
            session.add(
                Membership(
                    user_id=user.id,
                    organization_id=organization.id,
                    store_id=None,
                    role_id=roles[RoleCode.OWNER.value].id,
                )
            )
            print("granted organization-wide OWNER membership")

        await session.commit()
        print("seed complete")

    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--telegram-user-id", type=int, required=True)
    parser.add_argument("--owner-name", default="Власниця")
    parser.add_argument("--org-name", default="birka")
    args = parser.parse_args()

    asyncio.run(
        seed(
            telegram_user_id=args.telegram_user_id,
            owner_name=args.owner_name,
            org_name=args.org_name,
        )
    )


if __name__ == "__main__":
    main()
