"""Store states: trading, blocked, archived (owner decisions, 2026-10-01).

The owner decided (business-rules.md, "store states"):

- the owner of the network blocks a store, unblocks it, archives it and opens
  it again, from the app, saying why each time; the owner of a child store
  does not change her own store's state;
- a blocked store does nothing: no sale, receipt, return, payment, order,
  correction or «Брак». The owner and the network's managers read it; its
  own people see only that it is blocked and since when, never why;
- its open orders wait, their goods still held, until it trades again;
- its customers' debts are paid at any store that trades, and the owner of
  the network may write one off;
- an archived store is read and changed by nobody in the same way, and only
  an empty one is archived: nothing in its own warehouses or its «Брак», and
  no open order. Otherwise the refusal lists what is left;
- an archived store may be opened again, and its people come back with it.

What a blocked or archived store may not do is refused at the person's scope
(`authz/scope.py`) and, for anything moving stock, held at the ledger's door
(`tenancy.service.hold_stores`). This module only changes the state.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import IdempotencyConflictError, NotFoundError, ValidationFailedError
from app.core.logging import get_logger
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.identity.models import AppUser
from app.modules.inventory.service import units_held
from app.modules.orders.service import open_order_count
from app.modules.tenancy.models import (
    StockLocation,
    Store,
    StoreKind,
    StoreLocationAccess,
    StoreState,
    StoreStateChange,
)
from app.modules.tenancy.service import location_names

logger = get_logger(__name__)

MAX_REASON = 1000
# The newest changes shown with a store; the rest stay in the table.
HISTORY = 20

# Every change the owner may make, and what the audit log calls it.
CHANGES: dict[tuple[StoreState, StoreState], str] = {
    (StoreState.ACTIVE, StoreState.BLOCKED): "store.blocked",
    (StoreState.BLOCKED, StoreState.ACTIVE): "store.unblocked",
    (StoreState.ACTIVE, StoreState.ARCHIVED): "store.archived",
    (StoreState.BLOCKED, StoreState.ARCHIVED): "store.archived",
    (StoreState.ARCHIVED, StoreState.ACTIVE): "store.reopened",
}


@dataclass(frozen=True, slots=True)
class Change:
    from_state: StoreState
    to_state: StoreState
    reason: str
    by: str
    at: datetime


@dataclass(frozen=True, slots=True)
class StoreView:
    id: uuid.UUID
    name: str
    code: str
    kind: StoreKind
    state: StoreState
    state_since: datetime | None
    changes: list[Change]


async def _view(session: AsyncSession, store: Store) -> StoreView:
    rows = (
        await session.execute(
            select(StoreStateChange, AppUser.display_name)
            .join(AppUser, AppUser.id == StoreStateChange.actor_user_id)
            .where(StoreStateChange.store_id == store.id)
            .order_by(StoreStateChange.created_at.desc(), StoreStateChange.id.desc())
            .limit(HISTORY)
        )
    ).all()
    return StoreView(
        id=store.id,
        name=store.name,
        code=store.code,
        kind=store.kind,
        state=StoreState(store.state),
        state_since=store.state_since,
        changes=[
            Change(
                from_state=StoreState(change.from_state),
                to_state=StoreState(change.to_state),
                reason=change.reason,
                by=name,
                at=change.created_at,
            )
            for change, name in rows
        ],
    )


async def list_stores(session: AsyncSession, *, scope: RequestScope) -> list[StoreView]:
    """Every store of the network, with its state and why it changed: for the
    owner of the network only."""
    scope.require(Permission.STORE_MANAGE)
    stores = (
        await session.scalars(
            select(Store)
            .where(Store.organization_id == scope.organization_id)
            .order_by(Store.code, Store.id)
        )
    ).all()
    return [await _view(session, store) for store in stores]


async def _leftovers(
    session: AsyncSession, *, organization_id: uuid.UUID, store_id: uuid.UUID
) -> list[dict[str, Any]]:
    """What keeps this store from being archived: units in its own
    warehouses or its «Брак», and orders still open. Empty when nothing."""
    own = set(
        (
            await session.scalars(
                select(StockLocation.id).where(
                    StockLocation.organization_id == organization_id,
                    StockLocation.managing_store_id == store_id,
                )
            )
        ).all()
    )
    damaged = set(
        (
            await session.scalars(
                select(StoreLocationAccess.location_id).where(
                    StoreLocationAccess.organization_id == organization_id,
                    StoreLocationAccess.store_id == store_id,
                    StoreLocationAccess.damaged_returns.is_(True),
                )
            )
        ).all()
    )
    held = await units_held(session, organization_id=organization_id, location_ids=own | damaged)
    names = await location_names(session, organization_id=organization_id, location_ids=set(held))
    left: list[dict[str, Any]] = [
        {
            "kind": "DAMAGED" if location_id in damaged else "STOCK",
            "location_id": str(location_id),
            "name": names[location_id],
            "units": held[location_id],
        }
        for location_id in sorted(held, key=lambda location_id: names[location_id])
    ]
    orders = await open_order_count(session, organization_id=organization_id, store_id=store_id)
    if orders:
        left.append({"kind": "ORDERS", "count": orders})
    return left


async def change_state(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    command_id: uuid.UUID,
    state: StoreState,
    reason: str,
    correlation_id: str | None = None,
) -> StoreView:
    """Block, unblock, archive or reopen a store, saying why.

    Named by the client's permanent `command_id`: the same command is
    answered with what it did, however late it is retried, and never blocks a
    store again after it was unblocked in between.
    """
    # The network's owner only: a role in one store never changes its state.
    scope.require(Permission.STORE_MANAGE)
    why = reason.strip()
    if not why or len(why) > MAX_REASON or not is_storable(why):
        raise ValidationFailedError(f"Say why, in 1 to {MAX_REASON} characters", reason="NO_REASON")
    # Every command of this store that got here first finishes before this
    # reads anything; every one after waits and then reads the new state
    # (`tenancy.service.hold_stores`).
    store = await session.scalar(
        select(Store)
        .where(Store.id == store_id, Store.organization_id == scope.organization_id)
        .with_for_update()
    )
    if store is None:
        raise NotFoundError("Unknown store", store_id=str(store_id))
    fingerprint = idempotency.fingerprint(
        {"store": str(store_id), "state": state.value, "reason": why},
        actor_user_id=scope.user_id,
        store_id=None,
    )
    done = await session.scalar(
        select(StoreStateChange).where(
            StoreStateChange.organization_id == scope.organization_id,
            StoreStateChange.command_id == command_id,
        )
    )
    if done is not None:
        if done.command_fingerprint != fingerprint:
            raise IdempotencyConflictError(
                "This command_id was already used with a different request",
                command_id=str(command_id),
            )
        return await _view(session, store)

    current = StoreState(store.state)
    if current is state:
        raise ValidationFailedError(
            "The store is in that state already", reason="ALREADY", state=state.value
        )
    action = CHANGES.get((current, state))
    if action is None:
        # Only ARCHIVED → BLOCKED: an archived store opens to trade.
        raise ValidationFailedError(
            "An archived store is opened, not blocked",
            reason="NOT_FROM_ARCHIVE",
            state=current.value,
        )
    if state is StoreState.ARCHIVED:
        left = await _leftovers(session, organization_id=scope.organization_id, store_id=store.id)
        if left:
            raise ValidationFailedError(
                "Only an empty store is archived", reason="NOT_EMPTY", leftovers=left
            )

    now = datetime.now(tz=UTC)
    store.state = state.value
    store.state_since = now
    session.add(
        StoreStateChange(
            organization_id=scope.organization_id,
            store_id=store.id,
            from_state=current.value,
            to_state=state.value,
            reason=why,
            actor_user_id=scope.user_id,
            command_id=command_id,
            command_fingerprint=fingerprint,
            correlation_id=correlation_id,
        )
    )
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action=action,
        entity_type="store",
        entity_id=store.id,
        before={"state": current.value},
        after={"state": state.value},
        reason=why,
    )
    logger.info(action, store_id=str(store.id))
    return await _view(session, store)


__all__ = ["CHANGES", "Change", "StoreView", "change_state", "list_stores"]
