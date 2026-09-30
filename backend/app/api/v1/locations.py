"""Authorized warehouse discovery, independent of whether stock exists."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.deps import ScopeDep, SessionDep
from app.modules.authz.locations import readable_private_store
from app.modules.authz.permissions import Permission
from app.modules.tenancy.service import list_store_locations

router = APIRouter(tags=["inventory"])


class LocationResponse(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    is_active: bool
    can_sell: bool
    can_receive: bool
    # The store's «Брак», where units returned damaged go; nothing sells there.
    damaged_returns: bool


@router.get("/stock-locations", response_model=list[LocationResponse])
async def list_locations(
    scope: ScopeDep, session: SessionDep, store_id: Annotated[uuid.UUID, Query()]
) -> list[LocationResponse]:
    scope.require(Permission.INVENTORY_VIEW, store_id)
    locations = await list_store_locations(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        private_store_id=readable_private_store(scope, store_id),
    )
    return [
        LocationResponse(
            id=location.id,
            code=location.code,
            name=location.name,
            is_active=location.is_active,
            can_sell=location.can_sell,
            can_receive=location.can_receive,
            damaged_returns=location.damaged_returns,
        )
        for location in locations
    ]
