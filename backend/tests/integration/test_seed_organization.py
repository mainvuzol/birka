"""Safe, repeatable warehouse bootstrap on a migrated PostgreSQL database."""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import pytest
from scripts.seed_organization import BootstrapConflictError, seed_in_session
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.modules.audit.models import AuditLog
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
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            yield session
            await session.rollback()
    finally:
        await engine.dispose()


def arguments() -> dict:
    return {
        "telegram_user_id": uuid.uuid4().int % 10**14,
        "owner_name": "Bootstrap test",
        "org_name": f"bootstrap-{uuid.uuid4()}",
    }


async def rows(session: AsyncSession, model: type, org_id: uuid.UUID) -> list:
    return list(await session.scalars(select(model).where(model.organization_id == org_id)))


async def selling(session: AsyncSession, org_id: uuid.UUID) -> list[StoreLocationAccess]:
    """The grants to warehouses goods are sold from — every one but «Брак»."""
    return [
        grant
        for grant in await rows(session, StoreLocationAccess, org_id)
        if not grant.damaged_returns
    ]


async def damaged(session: AsyncSession, org_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID]:
    """Each store's «Брак»: store id → warehouse id."""
    return {
        grant.store_id: grant.location_id
        for grant in await rows(session, StoreLocationAccess, org_id)
        if grant.damaged_returns
    }


async def test_seed_twice_creates_one_shared_warehouse(session: AsyncSession) -> None:
    args = arguments()
    org_id = await seed_in_session(session, **args)
    assert await seed_in_session(session, **args) == org_id
    stores = await rows(session, Store, org_id)
    locations = await rows(session, StockLocation, org_id)
    grants = await selling(session, org_id)
    assert len(stores) == 2
    # One shared warehouse, and one «Брак» for each store.
    assert len(locations) == 3
    shared = {grant.location_id for grant in grants}
    assert len(shared) == 1
    assert {grant.store_id for grant in grants} == {store.id for store in stores}
    assert all(grant.can_sell and grant.can_receive for grant in grants)
    assert len(await rows(session, AuditLog, org_id)) == 3


async def test_each_store_gets_its_own_bin_it_never_sells_from(session: AsyncSession) -> None:
    """Owner decision, 2026-10-01: damaged returns go to the store's own
    «Брак», which it receives into and never sells from."""
    args = arguments()
    org_id = await seed_in_session(session, **args)
    stores = {store.code: store for store in await rows(session, Store, org_id)}
    bins = await damaged(session, org_id)
    assert set(bins) == {store.id for store in stores.values()}
    assert len(set(bins.values())) == 2
    for code, store in stores.items():
        location = await session.get(StockLocation, bins[store.id])
        assert location is not None
        assert location.code == f"BOOTSTRAP-DAMAGED-{code}"
        assert location.name == f"Брак — {store.name}"
        assert location.managing_store_id is None
    grants = [g for g in await rows(session, StoreLocationAccess, org_id) if g.damaged_returns]
    assert all(not grant.can_sell and grant.can_receive for grant in grants)
    # Only its own store reaches each one.
    reach = await rows(session, StoreLocationAccess, org_id)
    for store_id, location_id in bins.items():
        assert {g.store_id for g in reach if g.location_id == location_id} == {store_id}


async def test_a_bin_revoked_by_hand_is_not_recreated(session: AsyncSession) -> None:
    args = arguments()
    org_id = await seed_in_session(session, **args)
    grants = [g for g in await rows(session, StoreLocationAccess, org_id) if g.damaged_returns]
    await session.delete(grants[0])
    await session.flush()
    await seed_in_session(session, **args)
    assert len(await damaged(session, org_id)) == 1
    assert len(await rows(session, StockLocation, org_id)) == 3


async def test_a_store_given_a_bin_by_hand_keeps_it(session: AsyncSession) -> None:
    args = arguments()
    organization = Organization(name=args["org_name"])
    session.add(organization)
    await session.flush()
    org_id = await seed_in_session(session, **args)
    assert org_id == organization.id
    store = next(s for s in await rows(session, Store, org_id) if s.code == "MAIN")
    own = StockLocation(organization_id=org_id, code="MY-BIN", name="Мій брак")
    session.add(own)
    await session.flush()
    grant = next(
        g
        for g in await rows(session, StoreLocationAccess, org_id)
        if g.damaged_returns and g.store_id == store.id
    )
    grant.location_id = own.id
    await session.flush()
    await seed_in_session(session, **args)
    assert (await damaged(session, org_id))[store.id] == own.id


async def before_bins(session: AsyncSession, monkeypatch: pytest.MonkeyPatch, args: dict):
    """An organization set up before stores had a «Брак»."""
    from scripts import seed_organization

    async def nothing(*_args: object, **_kwargs: object) -> None:
        return None

    with monkeypatch.context() as patch:
        patch.setattr(seed_organization, "_ensure_damaged_returns", nothing)
        return await seed_in_session(session, **args)


async def test_an_organization_set_up_before_bins_gets_them_on_the_next_run(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    args = arguments()
    org_id = await before_bins(session, monkeypatch, args)
    assert await damaged(session, org_id) == {}
    await seed_in_session(session, **args)
    assert len(await damaged(session, org_id)) == 2
    assert len(await selling(session, org_id)) == 2


async def test_a_bin_code_taken_by_an_unrecorded_warehouse_refuses_guessing(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A warehouse carrying the «Брак» code, but not recorded as one, is not
    taken for one: its code proves nothing (the owner's rule of 2026-09-15)."""
    args = arguments()
    org_id = await before_bins(session, monkeypatch, args)
    session.add(StockLocation(organization_id=org_id, code="BOOTSTRAP-DAMAGED-MAIN", name="x"))
    await session.flush()
    with pytest.raises(BootstrapConflictError, match="not recorded as a store's «Брак»"):
        await seed_in_session(session, **args)
    assert await damaged(session, org_id) == {}


@pytest.mark.parametrize("child_on_first_run", [True, False])
async def test_optional_child_granted_only_to_second_store(
    session: AsyncSession, child_on_first_run: bool
) -> None:
    args = arguments()
    org_id = await seed_in_session(session, **args, with_child_warehouse=child_on_first_run)
    await seed_in_session(session, **args, with_child_warehouse=True)
    await seed_in_session(session, **args, with_child_warehouse=True)
    stores = {store.code: store.id for store in await rows(session, Store, org_id)}
    locations = {loc.code: loc.id for loc in await rows(session, StockLocation, org_id)}
    grants = await selling(session, org_id)
    assert len(locations) == 4
    assert len(grants) == 3
    assert {g.store_id for g in grants if g.location_id == locations["BOOTSTRAP-CHILD"]} == {
        stores["SECOND"]
    }
    assert len(await damaged(session, org_id)) == 2
    assert len(await rows(session, AuditLog, org_id)) == 4


async def test_repeat_preserves_revoked_grants_pause_and_renamed_targets(
    session: AsyncSession,
) -> None:
    args = arguments()
    org_id = await seed_in_session(session, **args, with_child_warehouse=True)
    grants = await selling(session, org_id)
    await session.delete(grants[0])
    grants[1].can_sell = False
    grants[1].can_receive = False
    locations = await rows(session, StockLocation, org_id)
    for location in locations:
        location.is_active = False
        location.code = str(uuid.uuid4())
    for store in await rows(session, Store, org_id):
        store.code = str(uuid.uuid4())
    await session.flush()
    await seed_in_session(session, **args, with_child_warehouse=True)
    remaining = await selling(session, org_id)
    assert len(remaining) == 2
    assert not grants[1].can_sell and not grants[1].can_receive
    assert all(not location.is_active for location in await rows(session, StockLocation, org_id))
    assert len(await rows(session, Store, org_id)) == 2


@pytest.mark.parametrize("code", ["MAIN", "BOOTSTRAP-SHARED", "custom"])
async def test_unmapped_existing_warehouse_never_grants_by_code(
    session: AsyncSession, code: str
) -> None:
    args = arguments()
    organization = Organization(name=args["org_name"])
    session.add(organization)
    await session.flush()
    location = StockLocation(organization_id=organization.id, code=code, name="Спільний склад")
    session.add(location)
    await session.flush()
    with pytest.raises(BootstrapConflictError, match="no bootstrap mapping"):
        await seed_in_session(session, **args)
    assert len(await rows(session, StockLocation, organization.id)) == 1
    assert await rows(session, StoreLocationAccess, organization.id) == []
    assert await rows(session, Store, organization.id) == []


async def test_old_seed_without_warehouses_can_be_repaired(session: AsyncSession) -> None:
    args = arguments()
    organization = Organization(name=args["org_name"])
    session.add(organization)
    await session.flush()
    for code, kind in [("MAIN", StoreKind.PRIMARY), ("SECOND", StoreKind.SECONDARY)]:
        session.add(Store(organization_id=organization.id, code=code, name=code, kind=kind))
    await session.flush()
    original_ids = {store.id for store in await rows(session, Store, organization.id)}
    await seed_in_session(session, **args)
    assert {store.id for store in await rows(session, Store, organization.id)} == original_ids
    assert len(await rows(session, StockLocation, organization.id)) == 3


async def test_unmapped_child_warehouse_blocks_optional_creation(session: AsyncSession) -> None:
    args = arguments()
    org_id = await seed_in_session(session, **args)
    session.add(StockLocation(organization_id=org_id, code="CUSTOM-CHILD", name="Private"))
    await session.flush()
    with pytest.raises(BootstrapConflictError, match="Unmapped warehouses"):
        await seed_in_session(session, **args, with_child_warehouse=True)
    assert len(await rows(session, StockLocation, org_id)) == 4
    assert len(await rows(session, StoreLocationAccess, org_id)) == 4


async def test_duplicate_org_name_refuses_guessing(session: AsyncSession) -> None:
    args = arguments()
    session.add_all([Organization(name=args["org_name"]), Organization(name=args["org_name"])])
    await session.flush()
    with pytest.raises(BootstrapConflictError, match="ambiguous"):
        await seed_in_session(session, **args)


async def test_missing_recorded_target_is_not_recreated(session: AsyncSession) -> None:
    args = arguments()
    org_id = await seed_in_session(session, **args)
    await session.execute(
        delete(StoreLocationAccess).where(StoreLocationAccess.organization_id == org_id)
    )
    await session.execute(delete(StockLocation).where(StockLocation.organization_id == org_id))
    with pytest.raises(BootstrapConflictError, match="targets changed"):
        await seed_in_session(session, **args)
    assert await rows(session, StockLocation, org_id) == []


async def test_failure_rolls_back_entire_bootstrap(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from scripts import seed_organization

    args = arguments()

    async def fail(*args: object, **kwargs: object) -> None:
        raise RuntimeError("injected audit failure")

    monkeypatch.setattr(seed_organization.audit, "record", fail)
    with pytest.raises(RuntimeError, match="injected"):
        async with session.begin():
            await seed_in_session(session, **args)
    assert (
        await session.scalar(select(Organization.id).where(Organization.name == args["org_name"]))
        is None
    )


async def test_concurrent_bootstraps_create_once() -> None:
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    args = arguments()

    async def run() -> uuid.UUID:
        async with maker.begin() as session:
            return await seed_in_session(session, **args, with_child_warehouse=True)

    try:
        first, second = await asyncio.gather(run(), run())
        assert first == second
        async with maker() as session:
            assert len(await rows(session, StockLocation, first)) == 4
            assert len(await rows(session, StoreLocationAccess, first)) == 5
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(Organization)
                    .where(Organization.name == args["org_name"])
                )
                == 1
            )
    finally:
        await engine.dispose()
