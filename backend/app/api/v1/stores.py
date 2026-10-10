"""Store states: the owner of the network blocks a store, archives it and
opens it again (owner decisions, 2026-10-01).

`GET /stores` lists every store of the network with its state and why it
changed. `POST /stores/{id}/state` changes it, with a reason, named by a
client `command_id` as a sale is. Both are the network owner's alone.

`GET /stores/{id}/sellers` is the till's: who may be named as having sold a
sale typed from paper there (owner decisions, 2026-10-04 and 2026-10-07;
ADR-0013 §5.7). Whoever may sell there reads it.
"""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep
from app.core.correlation import get_correlation_id
from app.core.text import CleanText
from app.modules.authz.permissions import Permission
from app.modules.sales.outage import nameable_sellers
from app.modules.stores import service
from app.modules.tenancy.models import StoreKind, StoreState

router = APIRouter(prefix="/stores", tags=["stores"])


class ChangeResponse(BaseModel):
    from_state: StoreState
    to_state: StoreState
    reason: str
    by: str
    at: datetime


class StoreResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    kind: StoreKind
    state: StoreState
    state_since: datetime | None
    # Newest first.
    changes: list[ChangeResponse]


class StateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command_id: uuid.UUID
    state: StoreState
    reason: CleanText = Field(min_length=1, max_length=1000)


def _response(view: service.StoreView) -> StoreResponse:
    return StoreResponse(
        id=view.id,
        name=view.name,
        code=view.code,
        kind=view.kind,
        state=view.state,
        state_since=view.state_since,
        changes=[
            ChangeResponse(
                from_state=change.from_state,
                to_state=change.to_state,
                reason=change.reason,
                by=change.by,
                at=change.at,
            )
            for change in view.changes
        ],
    )


@router.get("", response_model=list[StoreResponse])
async def list_stores(scope: ScopeDep, session: SessionDep) -> list[StoreResponse]:
    return [_response(view) for view in await service.list_stores(session, scope=scope)]


@router.post("/{store_id}/state", response_model=StoreResponse)
async def change_state(
    store_id: uuid.UUID, payload: StateRequest, scope: ScopeDep, session: SessionDep
) -> StoreResponse:
    """`BLOCKED` blocks a trading store, `ACTIVE` lets a blocked or archived
    one trade again, and `ARCHIVED` closes an empty one. Refusals carry a
    `reason`: `ALREADY`, `NOT_FROM_ARCHIVE`, `NO_REASON`, or `NOT_EMPTY` with
    the `leftovers` that keep a store from being archived."""
    view = await service.change_state(
        session,
        scope=scope,
        store_id=store_id,
        command_id=payload.command_id,
        state=payload.state,
        reason=payload.reason,
        correlation_id=get_correlation_id(),
    )
    await session.commit()
    return _response(view)


class SellerResponse(BaseModel):
    user_id: uuid.UUID
    display_name: str


class SellersResponse(BaseModel):
    # In the order of their names.
    sellers: list[SellerResponse]


# What a list of names is for: who sold, who took a return, who took a debt
# payment, each typed from paper; and who may be named for it.
_NAMED_FOR = {
    "sale": Permission.SALE_CREATE,
    "refund": Permission.SALE_REFUND,
    "credit": Permission.SALE_CREDIT,
}


@router.get("/{store_id}/sellers", response_model=SellersResponse)
async def list_sellers(
    store_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    named_for: Annotated[Literal["sale", "refund", "credit"], Query(alias="for")] = "sale",
) -> SellersResponse:
    """Who may be named in «Хто продав» when a sale typed from paper is
    marked «продано під час збою» here: active people with an active
    membership of this network, for this store or for all of it, whose role
    sells (`sale:create`); never another network's. Exactly whom the sale's
    own check accepts (`sales.outage.nameable_sellers`).

    `for=refund` and `for=credit` ask the same of a return or a debt payment
    typed from paper here (owner decision, 2026-10-10: the mark as a sale's):
    whoever may take one, `sale:refund` or `sale:credit`, a reading of how
    it is carried out (ADR-0021).

    Whoever may do it here reads it, asked as the command is: a store that
    does not trade gives nobody anything, not even to a role that reads the
    whole network."""
    may = _NAMED_FOR[named_for]
    replace(scope, reading=False).require(may, store_id)
    sellers = await nameable_sellers(session, scope.organization_id, store_id, may)
    return SellersResponse(
        sellers=[
            SellerResponse(user_id=user_id, display_name=name) for user_id, name in sellers.items()
        ]
    )


__all__ = ["router"]
