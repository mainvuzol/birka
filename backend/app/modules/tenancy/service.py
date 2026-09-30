"""Public tenant validation for stock and other business commands."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import LocationAccessDeniedError, NotFoundError
from app.modules.tenancy.models import StockLocation, Store, StoreLocationAccess


@dataclass(frozen=True, slots=True)
class AccessibleLocation:
    id: uuid.UUID
    code: str
    name: str
    is_active: bool
    can_sell: bool
    can_receive: bool
    # The store's «Брак», where units returned damaged go.
    damaged_returns: bool


async def list_store_locations(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    private_store_id: uuid.UUID | None = None,
) -> list[AccessibleLocation]:
    """Discover granted places even when empty or paused.

    The API checks the person's inventory:view permission first. These flags
    describe the store's grants, not the person's authority to execute a
    command; existing command checks still require both plus active locations.
    """
    await validate_active_stores(session, organization_id=organization_id, store_ids={store_id})
    rows = await session.execute(
        select(
            StockLocation.id,
            StockLocation.code,
            StockLocation.name,
            StockLocation.is_active,
            StoreLocationAccess.can_sell,
            StoreLocationAccess.can_receive,
            StoreLocationAccess.damaged_returns,
        )
        .join(
            StoreLocationAccess,
            (StoreLocationAccess.location_id == StockLocation.id)
            & (StoreLocationAccess.organization_id == StockLocation.organization_id),
        )
        .where(
            StockLocation.organization_id == organization_id,
            or_(
                StockLocation.managing_store_id.is_(None),
                StockLocation.managing_store_id == private_store_id,
            ),
            StoreLocationAccess.organization_id == organization_id,
            StoreLocationAccess.store_id == store_id,
        )
        .order_by(StockLocation.code, StockLocation.id)
    )
    return [AccessibleLocation(*row) for row in rows]


async def damaged_returns_location(
    session: AsyncSession, *, organization_id: uuid.UUID, store_id: uuid.UUID
) -> uuid.UUID | None:
    """The store's «Брак», where units returned damaged at it go, if one has
    been set up (owner decision, 2026-10-01). Never guessed from a name."""
    return (
        await session.scalars(
            select(StoreLocationAccess.location_id).where(
                StoreLocationAccess.organization_id == organization_id,
                StoreLocationAccess.store_id == store_id,
                StoreLocationAccess.damaged_returns.is_(True),
            )
        )
    ).first()


async def sold_from(
    session: AsyncSession, *, organization_id: uuid.UUID, location_id: uuid.UUID
) -> bool:
    """Does any store sell from this warehouse? Damaged goods must not land
    where anyone can sell them, and the database holds that only for the
    store whose «Брак» it is."""
    return (
        await session.scalar(
            select(StoreLocationAccess.id)
            .where(
                StoreLocationAccess.organization_id == organization_id,
                StoreLocationAccess.location_id == location_id,
                StoreLocationAccess.can_sell.is_(True),
            )
            .limit(1)
        )
    ) is not None


async def store_is_active(
    session: AsyncSession, *, organization_id: uuid.UUID, store_id: uuid.UUID
) -> bool:
    """Is this store open for business?

    A question, not an assertion: a caller that wants to say something specific
    about a closed store needs the answer, not `validate_active_stores`'
    deliberately uninformative "Unknown store".
    """
    return (
        await session.scalar(
            select(Store.id).where(
                Store.id == store_id,
                Store.organization_id == organization_id,
                Store.is_active.is_(True),
            )
        )
    ) is not None


async def validate_active_stores(
    session: AsyncSession, *, organization_id: uuid.UUID, store_ids: set[uuid.UUID]
) -> None:
    stores = set(
        (
            await session.scalars(
                select(Store.id).where(
                    Store.id.in_(store_ids),
                    Store.organization_id == organization_id,
                    Store.is_active.is_(True),
                )
            )
        ).all()
    )
    if stores != store_ids:
        raise NotFoundError("Unknown store")


class LocationCapability(StrEnum):
    """What a store may do at a location. Never inferred from a name.

    The owner's rule of 2026-09-15: a warehouse's name must not imply who owns
    its contents or who may reach it. Capability is a row someone wrote.
    """

    SELL = "can_sell"
    RECEIVE = "can_receive"


async def validate_locations(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    location_ids: set[uuid.UUID],
    must_be_active: bool,
) -> None:
    """Every location must belong to this organization, and may have to be open.

    Closing a warehouse stops goods moving through it; it does not hide what is
    standing in it (ADR-0004 §2.2). `must_be_active` is therefore False for
    reads and True for every command — transfers included. Design §1.11 also
    proposed that a closed warehouse stay "transferable-out"; that is not
    built, because the owner has not yet said what closing one means (M1-018
    report).
    """
    if not location_ids:
        return
    statement = select(StockLocation.id).where(
        StockLocation.id.in_(location_ids),
        StockLocation.organization_id == organization_id,
    )
    if must_be_active:
        statement = statement.where(StockLocation.is_active.is_(True))
    found = set((await session.scalars(statement)).all())
    if found != location_ids:
        # Deliberately uninformative, and identical to "no such location":
        # a caller must not learn that another organization has one. An
        # inactive location of one's own is folded into the same answer for
        # the same reason the store check does it — one refusal, not a probe.
        raise NotFoundError("Unknown stock location")


async def validate_active_locations(
    session: AsyncSession, *, organization_id: uuid.UUID, location_ids: set[uuid.UUID]
) -> None:
    """Every location must belong to this organization and still be open.

    The counterpart of `validate_active_stores`, not its replacement: after the
    stock key moved to the location, *both* questions need asking on every
    command — where the goods are, and which store is acting.
    """
    await validate_locations(
        session,
        organization_id=organization_id,
        location_ids=location_ids,
        must_be_active=True,
    )


async def accessible_locations(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    capability: LocationCapability | None = None,
) -> list[uuid.UUID]:
    """Locations this store may reach, optionally narrowed to one capability.

    Any access row grants *reading* the location; `can_sell` and `can_receive`
    gate the two ways of changing it.
    """
    statement = select(StoreLocationAccess.location_id).where(
        StoreLocationAccess.organization_id == organization_id,
        StoreLocationAccess.store_id == store_id,
    )
    if capability is LocationCapability.SELL:
        statement = statement.where(StoreLocationAccess.can_sell.is_(True))
    elif capability is LocationCapability.RECEIVE:
        statement = statement.where(StoreLocationAccess.can_receive.is_(True))
    return list((await session.scalars(statement.order_by(StoreLocationAccess.location_id))).all())


async def require_location_access(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    location_ids: set[uuid.UUID],
    capability: LocationCapability | None,
) -> None:
    """Refuse a store that has no row granting this capability here.

    `capability=None` asks only for reach: any access row will do, which is
    what a read needs.

    Invariant I23. Two independent checks guard every stock command and they
    answer different questions: `scope.require` asks whether this *person* may
    do it, this asks whether their *store* may do it *here*.

    The location is validated first, so a location in another organization is a
    404 that reveals nothing, while a real one the store simply cannot reach is
    an explicit 403. Activity is required only of a command: a read of a closed
    warehouse still has to work, or its stock becomes invisible as well as
    frozen (ADR-0004 §2.2).
    """
    if not location_ids:
        return
    await validate_locations(
        session,
        organization_id=organization_id,
        location_ids=location_ids,
        must_be_active=capability is not None,
    )
    granted = set(
        await accessible_locations(
            session, organization_id=organization_id, store_id=store_id, capability=capability
        )
    )
    missing = location_ids - granted
    if missing:
        raise LocationAccessDeniedError(
            store_id=str(store_id),
            capability=capability.value if capability else "any",
            location_ids=sorted(str(location_id) for location_id in missing),
        )
