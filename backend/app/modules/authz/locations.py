"""Person-level authority for shared and explicitly managed stock locations."""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import PermissionDeniedError
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.tenancy.models import StockLocation
from app.modules.tenancy.service import LocationCapability, require_location_access


async def require_stock_access(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    location_ids: set[uuid.UUID],
    capability: LocationCapability | None,
    permission: Permission,
) -> None:
    """Require both store grants and the person's exact operation authority.

    Organization-wide permissions never extend to a private warehouse. Every
    operation there requires its own permission granted directly at its
    managing store; a direct viewer cannot borrow a global manager's writes.
    """
    scope.require(permission, store_id)
    await require_location_access(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        location_ids=location_ids,
        capability=capability,
    )
    private_stores = (
        await session.scalars(
            select(StockLocation.managing_store_id).where(
                StockLocation.organization_id == scope.organization_id,
                StockLocation.id.in_(location_ids),
                StockLocation.managing_store_id.is_not(None),
            )
        )
    ).all()
    for managing_store_id in private_stores:
        if managing_store_id != store_id or permission not in scope.store_permissions.get(
            managing_store_id, frozenset()
        ):
            raise PermissionDeniedError(
                "Private stock location requires a direct managing-store permission",
                permission=permission.value,
                store_id=str(store_id),
            )


def readable_private_store(scope: RequestScope | None, store_id: uuid.UUID) -> uuid.UUID | None:
    """No scope means no authority to disclose private stock."""
    if scope is not None and Permission.INVENTORY_VIEW in scope.store_permissions.get(
        store_id, frozenset()
    ):
        return store_id
    return None


async def readable_location_ids(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    location_ids: set[uuid.UUID],
    scope: RequestScope | None,
) -> set[uuid.UUID]:
    private_store_id = readable_private_store(scope, store_id)
    return set(
        (
            await session.scalars(
                select(StockLocation.id).where(
                    StockLocation.organization_id == organization_id,
                    StockLocation.id.in_(location_ids),
                    or_(
                        StockLocation.managing_store_id.is_(None),
                        StockLocation.managing_store_id == private_store_id,
                    ),
                )
            )
        ).all()
    )
