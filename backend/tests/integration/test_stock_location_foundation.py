"""Database boundaries for the unused, additive stock-location foundation."""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import delete, insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.modules.tenancy.models import (
    Organization,
    StockLocation,
    Store,
    StoreKind,
    StoreLocationAccess,
)
from tests.conftest import requires_database

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
        await session.rollback()
    await engine.dispose()


async def build(session: AsyncSession) -> tuple[Organization, Store, StockLocation]:
    org = Organization(name="Location foundation test")
    session.add(org)
    await session.flush()
    store = Store(organization_id=org.id, name="Shop", code="A", kind=StoreKind.PRIMARY)
    location = StockLocation(organization_id=org.id, name="Warehouse", code="A")
    session.add_all([store, location])
    await session.flush()
    return org, store, location


@pytest.mark.parametrize("foreign_endpoint", ["store", "location"])
async def test_access_cannot_cross_organization(
    session: AsyncSession, foreign_endpoint: str
) -> None:
    org, store, location = await build(session)
    _, foreign_store, foreign_location = await build(session)
    session.add(
        StoreLocationAccess(
            organization_id=org.id,
            store_id=foreign_store.id if foreign_endpoint == "store" else store.id,
            location_id=foreign_location.id if foreign_endpoint == "location" else location.id,
            can_sell=True,
            can_receive=False,
        )
    )
    with pytest.raises(IntegrityError, match="foreign key constraint"):
        await session.flush()


async def test_location_code_unique_within_organization_only(session: AsyncSession) -> None:
    org, _, _ = await build(session)
    await build(session)  # The same code is valid in another tenant.
    session.add(StockLocation(organization_id=org.id, name="Duplicate", code="A"))
    with pytest.raises(IntegrityError, match="uq_stock_location_org_code"):
        await session.flush()


async def test_access_pair_unique(session: AsyncSession) -> None:
    org, store, location = await build(session)
    for _ in range(2):
        session.add(
            StoreLocationAccess(
                organization_id=org.id,
                store_id=store.id,
                location_id=location.id,
                can_sell=False,
                can_receive=False,
            )
        )
    with pytest.raises(IntegrityError, match="uq_store_location_access_store_location"):
        await session.flush()


@pytest.mark.parametrize("missing_flag", ["can_sell", "can_receive"])
async def test_access_flags_must_be_explicit_in_direct_sql(
    session: AsyncSession, missing_flag: str
) -> None:
    org, store, location = await build(session)
    values = {
        "id": uuid.uuid4(),
        "organization_id": org.id,
        "store_id": store.id,
        "location_id": location.id,
        "can_sell": False,
        "can_receive": False,
    }
    del values[missing_flag]
    with pytest.raises(IntegrityError, match=missing_flag):
        await session.execute(insert(StoreLocationAccess.__table__).values(**values))


@pytest.mark.parametrize("endpoint", ["store", "location"])
async def test_access_prevents_endpoint_deletion(session: AsyncSession, endpoint: str) -> None:
    org, store, location = await build(session)
    session.add(
        StoreLocationAccess(
            organization_id=org.id,
            store_id=store.id,
            location_id=location.id,
            can_sell=False,
            can_receive=False,
        )
    )
    await session.flush()  # Explicit read-only access is valid.
    model, identifier = (Store, store.id) if endpoint == "store" else (StockLocation, location.id)
    with pytest.raises(IntegrityError, match="foreign key constraint"):
        await session.execute(delete(model).where(model.id == identifier))


async def test_location_requires_existing_organization(session: AsyncSession) -> None:
    session.add(StockLocation(organization_id=uuid.uuid4(), name="Orphan", code="A"))
    with pytest.raises(IntegrityError, match="foreign key constraint"):
        await session.flush()
