"""A stocktake of a whole warehouse. Owner decisions, 2026-10-10; ADR-0022.

- **Started** for one warehouse by whoever may correct its stock there
  (`inventory:adjust`, as `POST /inventory/adjustments`). One is open per
  warehouse; whoever starts another while it is open joins it.
- **Counted** one position at a time. A count states what the shelf holds and
  the balance it was counted against; under the stock lock the balance must
  still be that, else `STOCK_CHANGED` and that position is counted again,
  alone. A count that differs applies at once as a stock adjustment with the
  reason `STOCKTAKE` (ADR-0007); one that matches changes nothing and is
  recorded as checked. The warehouse keeps selling meanwhile.
- **Finished** by whoever may count. Its sums are frozen: the positions
  counted; those with stock nobody counted, which stay as they are; the
  shortage and the surplus, in units and in positions. The bot then tells the
  network's owners, silently (`messages`).

A position counted twice has two counts. What it was counted at is its last;
what the stocktake changed there is the sum of its counts' deltas, so a count
mistyped and counted again cancels out, and a sale between two counts is no
shortage.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import ColumnElement, Subquery, case, exists, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.correlation import get_correlation_id
from app.core.errors import (
    DamagedStockClosedError,
    IdempotencyConflictError,
    NotFoundError,
    OpeningListPendingError,
    StockChangedError,
    StocktakeFinishedError,
    ValidationFailedError,
    nothing_recorded,
)
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.authz.service import organization_wide_holders_in
from app.modules.catalog.read import describe_variants, size_labels, unknown_size_ids
from app.modules.identity.service import display_names, telegram_chats
from app.modules.inventory.models import Inventory, MovementReason
from app.modules.inventory.service import awaiting_opening_list, lock_stock, record_adjustment
from app.modules.stocktake.messages import message_text
from app.modules.stocktake.models import Stocktake, StocktakeCount, StocktakeMessage
from app.modules.tenancy.models import StockLocation, Store
from app.modules.tenancy.service import LocationCapability, damaged_returns_locations

PositionState = Literal["uncounted", "counted", "differences"]


@dataclass(frozen=True, slots=True)
class Sums:
    counted_positions: int
    unchecked_positions: int
    shortage_units: int
    shortage_positions: int
    surplus_units: int
    surplus_positions: int


@dataclass(frozen=True, slots=True)
class StocktakeView:
    id: uuid.UUID
    location_id: uuid.UUID
    location_name: str
    store_id: uuid.UUID
    started_by: str
    started_at: datetime
    finished_by: str | None
    finished_at: datetime | None
    # Live while it is open; frozen once it is finished.
    sums: Sums


@dataclass(frozen=True, slots=True)
class CountView:
    id: uuid.UUID
    stocktake_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    counted_quantity: int
    quantity_before: int
    quantity_delta: int
    counted_at: datetime


@dataclass(frozen=True, slots=True)
class LastCount:
    counted_quantity: int
    # What the stocktake changed here: the sum of this position's counts.
    net_delta: int
    counted_by: str
    counted_at: datetime


@dataclass(frozen=True, slots=True)
class Position:
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    display_name: str
    size_label: str
    size_is_unknown: bool
    quantity: int
    reserved_quantity: int
    count: LastCount | None


async def _may_count(
    session: AsyncSession, scope: RequestScope, *, store_id: uuid.UUID, location_id: uuid.UUID
) -> None:
    """What a stock correction there asks (ADR-0007): each count may apply as
    one. «Брак» changes only through returns and its own section (owner
    decision, 2026-10-01), so it is never counted here."""
    await require_stock_access(
        session,
        scope=scope,
        store_id=store_id,
        location_ids={location_id},
        capability=LocationCapability.RECEIVE,
        permission=Permission.INVENTORY_ADJUST,
    )
    if await damaged_returns_locations(
        session, organization_id=scope.organization_id, location_ids={location_id}
    ):
        raise DamagedStockClosedError(location_ids=[str(location_id)])


async def _may_read(
    session: AsyncSession, scope: RequestScope, *, store_id: uuid.UUID, location_id: uuid.UUID
) -> None:
    await require_stock_access(
        session,
        scope=scope,
        store_id=store_id,
        location_ids={location_id},
        capability=None,
        permission=Permission.INVENTORY_VIEW,
    )


async def _stocktake(
    session: AsyncSession, scope: RequestScope, stocktake_id: uuid.UUID
) -> Stocktake:
    found = await session.scalar(
        select(Stocktake).where(
            Stocktake.id == stocktake_id, Stocktake.organization_id == scope.organization_id
        )
    )
    if found is None:
        raise NotFoundError("Stocktake not found")
    return found


def _counted(stocktake_id: uuid.UUID) -> Subquery:
    """Each position this stocktake counted, with the sum of its deltas."""
    return (
        select(
            StocktakeCount.product_variant_id,
            StocktakeCount.size_id,
            func.sum(StocktakeCount.quantity_delta).label("net"),
        )
        .where(StocktakeCount.stocktake_id == stocktake_id)
        .group_by(StocktakeCount.product_variant_id, StocktakeCount.size_id)
        .subquery()
    )


def _not_counted(stocktake_id: uuid.UUID) -> ColumnElement[bool]:
    """A balance with stock that this stocktake never counted."""
    return ~exists().where(
        StocktakeCount.stocktake_id == stocktake_id,
        StocktakeCount.product_variant_id == Inventory.product_variant_id,
        StocktakeCount.size_id == Inventory.size_id,
    )


async def _sums(session: AsyncSession, stocktake: Stocktake) -> Sums:
    if stocktake.finished_at is not None:
        assert stocktake.counted_positions is not None
        return Sums(
            counted_positions=stocktake.counted_positions,
            unchecked_positions=stocktake.unchecked_positions or 0,
            shortage_units=stocktake.shortage_units or 0,
            shortage_positions=stocktake.shortage_positions or 0,
            surplus_units=stocktake.surplus_units or 0,
            surplus_positions=stocktake.surplus_positions or 0,
        )
    counted = _counted(stocktake.id)
    row = (
        await session.execute(
            select(
                func.count(),
                func.coalesce(func.sum(case((counted.c.net < 0, -counted.c.net), else_=0)), 0),
                func.count().filter(counted.c.net < 0),
                func.coalesce(func.sum(case((counted.c.net > 0, counted.c.net), else_=0)), 0),
                func.count().filter(counted.c.net > 0),
            ).select_from(counted)
        )
    ).one()
    unchecked = await session.scalar(
        select(func.count())
        .select_from(Inventory)
        .where(
            Inventory.location_id == stocktake.location_id,
            Inventory.quantity > 0,
            _not_counted(stocktake.id),
        )
    )
    return Sums(
        counted_positions=int(row[0]),
        unchecked_positions=int(unchecked or 0),
        shortage_units=int(row[1]),
        shortage_positions=int(row[2]),
        surplus_units=int(row[3]),
        surplus_positions=int(row[4]),
    )


async def _views(session: AsyncSession, stocktakes: list[Stocktake]) -> list[StocktakeView]:
    people = await display_names(
        session,
        {s.started_by_user_id for s in stocktakes}
        | {s.finished_by_user_id for s in stocktakes if s.finished_by_user_id is not None},
    )
    places: dict[uuid.UUID, str] = {
        row.id: row.name
        for row in await session.execute(
            select(StockLocation.id, StockLocation.name).where(
                StockLocation.id.in_({s.location_id for s in stocktakes})
            )
        )
    }
    return [
        StocktakeView(
            id=s.id,
            location_id=s.location_id,
            location_name=places.get(s.location_id, ""),
            store_id=s.store_id,
            started_by=people.get(s.started_by_user_id, ""),
            started_at=s.created_at,
            finished_by=people.get(s.finished_by_user_id) if s.finished_by_user_id else None,
            finished_at=s.finished_at,
            sums=await _sums(session, s),
        )
        for s in stocktakes
    ]


async def start(
    session: AsyncSession, scope: RequestScope, *, store_id: uuid.UUID, location_id: uuid.UUID
) -> tuple[StocktakeView, bool]:
    """Start a stocktake of this warehouse, or join the one that is open.
    Returns it, and whether it was started now. Commits."""
    await _may_count(session, scope, store_id=store_id, location_id=location_id)
    if await awaiting_opening_list(
        session, organization_id=scope.organization_id, location_id=location_id
    ):
        raise OpeningListPendingError(location_ids=[str(location_id)])
    started = (
        await session.execute(
            pg_insert(Stocktake)
            .values(
                id=uuid.uuid4(),
                organization_id=scope.organization_id,
                location_id=location_id,
                store_id=store_id,
                started_by_user_id=scope.user_id,
            )
            .on_conflict_do_nothing(
                index_elements=["location_id"], index_where=text("finished_at IS NULL")
            )
            .returning(Stocktake.id)
        )
    ).scalar_one_or_none()
    stocktake = await session.scalar(
        select(Stocktake)
        .where(Stocktake.location_id == location_id, Stocktake.finished_at.is_(None))
        .execution_options(populate_existing=True)
    )
    assert stocktake is not None
    await session.commit()
    return (await _views(session, [stocktake]))[0], started is not None


async def read(
    session: AsyncSession, scope: RequestScope, *, stocktake_id: uuid.UUID, store_id: uuid.UUID
) -> StocktakeView:
    stocktake = await _stocktake(session, scope, stocktake_id)
    await _may_read(session, scope, store_id=store_id, location_id=stocktake.location_id)
    return (await _views(session, [stocktake]))[0]


async def of_warehouse(
    session: AsyncSession,
    scope: RequestScope,
    *,
    store_id: uuid.UUID,
    location_id: uuid.UUID,
    limit: int = 20,
) -> list[StocktakeView]:
    """This warehouse's stocktakes, the open one first, then the latest."""
    await _may_read(session, scope, store_id=store_id, location_id=location_id)
    stocktakes = list(
        (
            await session.scalars(
                select(Stocktake)
                .where(
                    Stocktake.organization_id == scope.organization_id,
                    Stocktake.location_id == location_id,
                )
                .order_by(Stocktake.finished_at.is_(None).desc(), Stocktake.created_at.desc())
                .limit(limit)
            )
        ).all()
    )
    return await _views(session, stocktakes)


def fingerprint(
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    stocktake_id: uuid.UUID,
    product_variant_id: uuid.UUID,
    size_id: uuid.UUID,
    counted_quantity: int,
) -> str:
    """Everything that makes a count *this* count. The balance it was counted
    against is out, as an adjustment's (ADR-0007): a precondition, checked
    once; a late retry is answered from its record before any balance is
    compared."""
    return idempotency.fingerprint(
        {
            "stocktake_id": str(stocktake_id),
            "product_variant_id": str(product_variant_id),
            "size_id": str(size_id),
            "counted_quantity": counted_quantity,
        },
        actor_user_id=scope.user_id,
        store_id=store_id,
    )


def _count_view(row: StocktakeCount) -> CountView:
    return CountView(
        id=row.id,
        stocktake_id=row.stocktake_id,
        product_variant_id=row.product_variant_id,
        size_id=row.size_id,
        counted_quantity=row.counted_quantity,
        quantity_before=row.quantity_before,
        quantity_delta=row.quantity_delta,
        counted_at=row.created_at,
    )


async def recorded_count(
    session: AsyncSession, scope: RequestScope, *, command_id: uuid.UUID, request_fingerprint: str
) -> CountView | None:
    """Durable replay: was this count recorded? Under a lock on its
    `command_id` only, as an adjustment's, before any stock is locked."""
    lock_key = int.from_bytes(
        hashlib.sha256(scope.organization_id.bytes + command_id.bytes).digest()[:8],
        byteorder="big",
        signed=True,
    )
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
    existing = await session.scalar(
        select(StocktakeCount).where(
            StocktakeCount.organization_id == scope.organization_id,
            StocktakeCount.command_id == command_id,
        )
    )
    if existing is None:
        return None
    if existing.command_fingerprint != request_fingerprint:
        raise IdempotencyConflictError(
            "This command_id was already used for a different count",
            command_id=str(command_id),
        )
    return _count_view(existing)


async def may_count(
    session: AsyncSession, scope: RequestScope, *, stocktake_id: uuid.UUID, store_id: uuid.UUID
) -> None:
    """Whether this person may count this stocktake from this store: asked
    before a count's key is claimed, as a correction's is."""
    stocktake = await _stocktake(session, scope, stocktake_id)
    await _may_count(session, scope, store_id=store_id, location_id=stocktake.location_id)


async def count(
    session: AsyncSession,
    scope: RequestScope,
    *,
    stocktake_id: uuid.UUID,
    store_id: uuid.UUID,
    command_id: uuid.UUID,
    product_variant_id: uuid.UUID,
    size_id: uuid.UUID,
    counted_quantity: int,
    expected_quantity: int,
) -> tuple[CountView, bool]:
    """Record one position's count; returns it, and whether it was recorded
    now (False: answered from its record). Does not commit."""
    stocktake = await _stocktake(session, scope, stocktake_id)
    await _may_count(session, scope, store_id=store_id, location_id=stocktake.location_id)
    request_fingerprint = fingerprint(
        scope=scope,
        store_id=store_id,
        stocktake_id=stocktake_id,
        product_variant_id=product_variant_id,
        size_id=size_id,
        counted_quantity=counted_quantity,
    )
    original = await recorded_count(
        session, scope, command_id=command_id, request_fingerprint=request_fingerprint
    )
    if original is not None:
        return original, False

    # Refusals after this command's lookup record nothing (ADR-0013 §1).
    with nothing_recorded():
        # Shared: counts go on side by side, and a finish waits for them.
        still_open = await session.scalar(
            select(Stocktake.finished_at.is_(None))
            .where(Stocktake.id == stocktake_id)
            .with_for_update(read=True)
        )
        if not still_open:
            raise StocktakeFinishedError(stocktake_id=str(stocktake_id))
        key = (stocktake.location_id, product_variant_id, size_id)
        held = await lock_stock(
            session,
            organization_id=scope.organization_id,
            keys=[key],
            acting_store_ids={store_id},
        )
        if held[key] != expected_quantity:
            raise StockChangedError(expected=expected_quantity, actual=held[key])
        delta = counted_quantity - held[key]
        if delta > 0 and size_id in await unknown_size_ids(
            session, organization_id=scope.organization_id
        ):
            # As a correction (ADR-0005 §3): stock with its size not known
            # enters only from a legacy stock list.
            raise ValidationFailedError(
                "Goods with their size not known enter only from a legacy stock list; say the size",
                size_id=str(size_id),
            )
        adjustment_id = None
        if delta != 0:
            recorded = await record_adjustment(
                session,
                organization_id=scope.organization_id,
                store_id=store_id,
                actor_user_id=scope.user_id,
                command_id=command_id,
                command_fingerprint=request_fingerprint,
                location_id=stocktake.location_id,
                product_variant_id=product_variant_id,
                size_id=size_id,
                quantity_delta=delta,
                reason_code=MovementReason.STOCKTAKE,
                note=None,
                correlation_id=get_correlation_id(),
            )
            adjustment_id = recorded.adjustment.id
        row = StocktakeCount(
            organization_id=scope.organization_id,
            stocktake_id=stocktake_id,
            product_variant_id=product_variant_id,
            size_id=size_id,
            counted_quantity=counted_quantity,
            quantity_before=held[key],
            quantity_delta=delta,
            adjustment_id=adjustment_id,
            store_id=store_id,
            counted_by_user_id=scope.user_id,
            command_id=command_id,
            command_fingerprint=request_fingerprint,
        )
        session.add(row)
        await session.flush()
        await session.refresh(row)
    return _count_view(row), True


async def finish(
    session: AsyncSession, scope: RequestScope, *, stocktake_id: uuid.UUID, store_id: uuid.UUID
) -> StocktakeView:
    """Finish it: freeze its sums and write the bot's message to each of the
    network's owners but whoever finished it. Finishing one already finished
    answers it as it was. Commits."""
    found = await _stocktake(session, scope, stocktake_id)
    await _may_count(session, scope, store_id=store_id, location_id=found.location_id)
    # Exclusive: every count under way lands first, and none after.
    stocktake = await session.scalar(
        select(Stocktake)
        .where(Stocktake.id == stocktake_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert stocktake is not None
    if stocktake.finished_at is None:
        sums = await _sums(session, stocktake)
        now = await session.scalar(select(func.now()))
        assert now is not None
        stocktake.finished_at = now
        stocktake.finished_by_user_id = scope.user_id
        stocktake.counted_positions = sums.counted_positions
        stocktake.unchecked_positions = sums.unchecked_positions
        stocktake.shortage_units = sums.shortage_units
        stocktake.shortage_positions = sums.shortage_positions
        stocktake.surplus_units = sums.surplus_units
        stocktake.surplus_positions = sums.surplus_positions
        await session.flush()
        await _queue_message(session, stocktake, now=now)
    await session.commit()
    return (await _views(session, [stocktake]))[0]


async def _queue_message(session: AsyncSession, stocktake: Stocktake, *, now: datetime) -> None:
    """The sum, to the network's owners — whoever holds `store:manage` across
    the network — but never to whoever finished it, as a drawer's difference
    (owner decision, 2026-10-10; ADR-0012, G10)."""
    owners = await organization_wide_holders_in(
        session, stocktake.organization_id, Permission.STORE_MANAGE
    )
    chats = await telegram_chats(
        session, [owner for owner in owners if owner != stocktake.finished_by_user_id]
    )
    if not chats:
        return
    store = await session.get(Store, stocktake.store_id)
    place = await session.get(StockLocation, stocktake.location_id)
    assert store is not None and place is not None
    assert stocktake.finished_at is not None and stocktake.finished_by_user_id is not None
    people = await display_names(
        session, {stocktake.started_by_user_id, stocktake.finished_by_user_id}
    )
    text_ = message_text(
        location_name=place.name,
        store_name=store.name,
        timezone=store.timezone,
        sums=await _sums(session, stocktake),
        started_by=people.get(stocktake.started_by_user_id, ""),
        started_at=stocktake.created_at,
        finished_by=people.get(stocktake.finished_by_user_id, ""),
        finished_at=stocktake.finished_at,
    )
    await session.execute(
        pg_insert(StocktakeMessage)
        .values(
            [
                {
                    "organization_id": stocktake.organization_id,
                    "stocktake_id": stocktake.id,
                    "user_id": user_id,
                    "text": text_,
                    "created_at": now,
                }
                for user_id in sorted(chats)
            ]
        )
        .on_conflict_do_nothing(constraint="uq_stocktake_message_stocktake_id_user_id")
    )


async def positions(
    session: AsyncSession,
    scope: RequestScope,
    *,
    stocktake_id: uuid.UUID,
    store_id: uuid.UUID,
    state: PositionState,
    limit: int,
    offset: int,
) -> tuple[list[Position], bool]:
    """A page of this stocktake's positions: those with stock not counted yet,
    in the order «Залишки» lists them; or those counted, the last counted
    first; or only those where it found a difference."""
    stocktake = await _stocktake(session, scope, stocktake_id)
    await _may_read(session, scope, store_id=store_id, location_id=stocktake.location_id)
    if state == "uncounted":
        rows = (
            await session.execute(
                select(
                    Inventory.product_variant_id,
                    Inventory.size_id,
                    Inventory.quantity,
                    Inventory.reserved_quantity,
                )
                .where(
                    Inventory.location_id == stocktake.location_id,
                    Inventory.quantity > 0,
                    _not_counted(stocktake.id),
                )
                .order_by(Inventory.product_variant_id, Inventory.size_id)
                .limit(limit + 1)
                .offset(offset)
            )
        ).all()
        page: list[tuple[uuid.UUID, uuid.UUID, int, int, LastCount | None]] = [
            (r[0], r[1], r[2], r[3], None) for r in rows[:limit]
        ]
    else:
        counted = _counted(stocktake.id)
        last = (
            select(StocktakeCount)
            .where(StocktakeCount.stocktake_id == stocktake.id)
            .distinct(StocktakeCount.product_variant_id, StocktakeCount.size_id)
            .order_by(
                StocktakeCount.product_variant_id,
                StocktakeCount.size_id,
                StocktakeCount.created_at.desc(),
                StocktakeCount.id.desc(),
            )
            .subquery()
        )
        query = (
            select(
                last.c.product_variant_id,
                last.c.size_id,
                func.coalesce(Inventory.quantity, 0),
                func.coalesce(Inventory.reserved_quantity, 0),
                last.c.counted_quantity,
                counted.c.net,
                last.c.counted_by_user_id,
                last.c.created_at,
            )
            .join(
                counted,
                (counted.c.product_variant_id == last.c.product_variant_id)
                & (counted.c.size_id == last.c.size_id),
            )
            .outerjoin(
                Inventory,
                (Inventory.location_id == stocktake.location_id)
                & (Inventory.product_variant_id == last.c.product_variant_id)
                & (Inventory.size_id == last.c.size_id),
            )
        )
        if state == "differences":
            query = query.where(counted.c.net != 0)
        rows = (
            await session.execute(
                query.order_by(last.c.created_at.desc(), last.c.id.desc())
                .limit(limit + 1)
                .offset(offset)
            )
        ).all()
        people = await display_names(session, {r[6] for r in rows[:limit]})
        page = [
            (
                r[0],
                r[1],
                r[2],
                r[3],
                LastCount(
                    counted_quantity=r[4],
                    net_delta=int(r[5]),
                    counted_by=people.get(r[6], ""),
                    counted_at=r[7],
                ),
            )
            for r in rows[:limit]
        ]
    names = await describe_variants(session, [p[0] for p in page])
    labels = await size_labels(session, [p[1] for p in page])
    unknown = await unknown_size_ids(session, organization_id=scope.organization_id)
    return (
        [
            Position(
                product_variant_id=variant_id,
                size_id=size_id,
                display_name=names[variant_id].display_name,
                size_label=labels[size_id],
                size_is_unknown=size_id in unknown,
                quantity=quantity,
                reserved_quantity=reserved,
                count=last_count,
            )
            for variant_id, size_id, quantity, reserved, last_count in page
        ],
        len(rows) > limit,
    )


__all__ = [
    "CountView",
    "LastCount",
    "Position",
    "PositionState",
    "StocktakeView",
    "Sums",
    "count",
    "fingerprint",
    "finish",
    "may_count",
    "of_warehouse",
    "positions",
    "read",
    "recorded_count",
    "start",
]
