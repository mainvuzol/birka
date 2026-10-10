"""A stocktake of a whole warehouse (owner decisions, 2026-10-10; ADR-0022).

- `POST /stocktakes` starts one for a warehouse, or answers the one already
  open there (200), which whoever starts it then joins.
- `POST /stocktakes/{id}/counts` records one position's count, with the
  balance it was counted against; a permanent `command_id`, as a stock
  correction's (ADR-0007). A count that differs applies at once.
- `POST /stocktakes/{id}/finish` freezes its sums and tells the network's
  owners; finishing it again answers it as it was.
- `GET /stocktakes`, `GET /stocktakes/{id}` and `GET
  /stocktakes/{id}/positions` read them, for whoever sees the warehouse's
  stock.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Header, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep
from app.core import idempotency
from app.core.text import CleanText
from app.modules.stocktake import service as stocktakes
from app.modules.stocktake.service import CountView, Position, PositionState, StocktakeView

router = APIRouter(prefix="/stocktakes", tags=["stocktakes"])

COUNTS_ENDPOINT = "POST /stocktakes/{id}/counts"


class StartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Which store is acting, and which warehouse is counted (ADR-0004).
    store_id: uuid.UUID
    location_id: uuid.UUID


class FinishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    store_id: uuid.UUID


class CountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    store_id: uuid.UUID
    # Client-generated and permanent, as a stock correction's (ADR-0007).
    command_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    # What the shelf holds.
    counted_quantity: int = Field(ge=0, le=10_000)
    # The balance it was counted against: the count applies only while the
    # warehouse still holds exactly this many, else `STOCK_CHANGED`.
    expected_quantity: int = Field(ge=0)


class SumsResponse(BaseModel):
    counted_positions: int
    unchecked_positions: int
    shortage_units: int
    shortage_positions: int
    surplus_units: int
    surplus_positions: int


class StocktakeResponse(BaseModel):
    id: uuid.UUID
    location_id: uuid.UUID
    location_name: str
    store_id: uuid.UUID
    started_by: str
    started_at: datetime
    finished_by: str | None
    finished_at: datetime | None
    # Live while it is open, frozen once it is finished.
    sums: SumsResponse


class StocktakeListResponse(BaseModel):
    items: list[StocktakeResponse]


class CountResponse(BaseModel):
    id: uuid.UUID
    stocktake_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    counted_quantity: int
    quantity_before: int
    quantity_delta: int
    counted_at: datetime


class LastCountResponse(BaseModel):
    counted_quantity: int
    # What the stocktake changed here: the sum of this position's counts.
    net_delta: int
    counted_by: str
    counted_at: datetime


class PositionResponse(BaseModel):
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    display_name: str
    size_label: str
    size_is_unknown: bool
    quantity: int
    reserved_quantity: int
    count: LastCountResponse | None


class PositionsResponse(BaseModel):
    items: list[PositionResponse]
    has_more: bool


def _stocktake(view: StocktakeView) -> StocktakeResponse:
    return StocktakeResponse(
        id=view.id,
        location_id=view.location_id,
        location_name=view.location_name,
        store_id=view.store_id,
        started_by=view.started_by,
        started_at=view.started_at,
        finished_by=view.finished_by,
        finished_at=view.finished_at,
        sums=SumsResponse(
            counted_positions=view.sums.counted_positions,
            unchecked_positions=view.sums.unchecked_positions,
            shortage_units=view.sums.shortage_units,
            shortage_positions=view.sums.shortage_positions,
            surplus_units=view.sums.surplus_units,
            surplus_positions=view.sums.surplus_positions,
        ),
    )


def _count(view: CountView) -> CountResponse:
    return CountResponse(
        id=view.id,
        stocktake_id=view.stocktake_id,
        product_variant_id=view.product_variant_id,
        size_id=view.size_id,
        counted_quantity=view.counted_quantity,
        quantity_before=view.quantity_before,
        quantity_delta=view.quantity_delta,
        counted_at=view.counted_at,
    )


def _position(position: Position) -> PositionResponse:
    last = position.count
    return PositionResponse(
        product_variant_id=position.product_variant_id,
        size_id=position.size_id,
        display_name=position.display_name,
        size_label=position.size_label,
        size_is_unknown=position.size_is_unknown,
        quantity=position.quantity,
        reserved_quantity=position.reserved_quantity,
        count=None
        if last is None
        else LastCountResponse(
            counted_quantity=last.counted_quantity,
            net_delta=last.net_delta,
            counted_by=last.counted_by,
            counted_at=last.counted_at,
        ),
    )


@router.post("", response_model=StocktakeResponse, status_code=status.HTTP_201_CREATED)
async def start(
    payload: StartRequest, scope: ScopeDep, session: SessionDep, response: Response
) -> StocktakeResponse:
    view, started = await stocktakes.start(
        session, scope, store_id=payload.store_id, location_id=payload.location_id
    )
    if not started:
        response.status_code = status.HTTP_200_OK
    return _stocktake(view)


@router.get("", response_model=StocktakeListResponse)
async def of_warehouse(
    scope: ScopeDep,
    session: SessionDep,
    store_id: Annotated[uuid.UUID, Query()],
    location_id: Annotated[uuid.UUID, Query()],
) -> StocktakeListResponse:
    views = await stocktakes.of_warehouse(
        session, scope, store_id=store_id, location_id=location_id
    )
    return StocktakeListResponse(items=[_stocktake(view) for view in views])


@router.get("/{stocktake_id}", response_model=StocktakeResponse)
async def read(
    stocktake_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    store_id: Annotated[uuid.UUID, Query()],
) -> StocktakeResponse:
    return _stocktake(
        await stocktakes.read(session, scope, stocktake_id=stocktake_id, store_id=store_id)
    )


@router.get("/{stocktake_id}/positions", response_model=PositionsResponse)
async def positions(
    stocktake_id: uuid.UUID,
    scope: ScopeDep,
    session: SessionDep,
    store_id: Annotated[uuid.UUID, Query()],
    state: Annotated[PositionState, Query()] = "uncounted",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> PositionsResponse:
    items, has_more = await stocktakes.positions(
        session,
        scope,
        stocktake_id=stocktake_id,
        store_id=store_id,
        state=state,
        limit=limit,
        offset=offset,
    )
    return PositionsResponse(items=[_position(item) for item in items], has_more=has_more)


@router.post(
    "/{stocktake_id}/counts", response_model=CountResponse, status_code=status.HTTP_201_CREATED
)
async def count(
    stocktake_id: uuid.UUID,
    payload: CountRequest,
    scope: ScopeDep,
    session: SessionDep,
    response: Response,
    idempotency_key: Annotated[
        CleanText, Header(alias="Idempotency-Key", min_length=8, max_length=200)
    ],
) -> CountResponse:
    await stocktakes.may_count(session, scope, stocktake_id=stocktake_id, store_id=payload.store_id)
    outcome = await idempotency.claim(
        session,
        organization_id=scope.organization_id,
        endpoint=COUNTS_ENDPOINT,
        key=idempotency_key,
        request_fingerprint=idempotency.fingerprint(
            {"stocktake_id": str(stocktake_id), **payload.model_dump(mode="json")},
            actor_user_id=scope.user_id,
            store_id=payload.store_id,
        ),
    )
    if isinstance(outcome, idempotency.Replay):
        response.status_code = outcome.http_status
        return CountResponse.model_validate(outcome.response)
    view, _ = await stocktakes.count(
        session,
        scope,
        stocktake_id=stocktake_id,
        store_id=payload.store_id,
        command_id=payload.command_id,
        product_variant_id=payload.product_variant_id,
        size_id=payload.size_id,
        counted_quantity=payload.counted_quantity,
        expected_quantity=payload.expected_quantity,
    )
    body = _count(view)
    await idempotency.complete(
        session,
        outcome.record_id,
        response=body.model_dump(mode="json"),
        http_status=status.HTTP_201_CREATED,
    )
    await session.commit()
    return body


@router.post("/{stocktake_id}/finish", response_model=StocktakeResponse)
async def finish(
    stocktake_id: uuid.UUID, payload: FinishRequest, scope: ScopeDep, session: SessionDep
) -> StocktakeResponse:
    return _stocktake(
        await stocktakes.finish(
            session, scope, stocktake_id=stocktake_id, store_id=payload.store_id
        )
    )


__all__ = ["router"]
