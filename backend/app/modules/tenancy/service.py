"""Public tenant validation for stock and other business commands."""

from __future__ import annotations

import uuid
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import LocationAccessDeniedError, NotFoundError
from app.modules.tenancy.models import StockLocation, Store, StoreLocationAccess


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
    standing in it. ADR-0004 §1.11: an inactive location stays *readable*,
    reconcilable and transferable-out, so stock is never stranded by a flag.
    `must_be_active` is therefore False for reads and True for commands.
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
    frozen (ADR-0004 §1.11).
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
