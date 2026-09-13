"""Inventory endpoints.

`POST /inventory/receipts` is the structured intake path: the seller picks an
existing variant and size and states a quantity. Natural-language intake
(`POST /catalog/entries`) arrives in gate M1C and will funnel into the same
inventory service, so there stays exactly one way stock can change.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Header, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import ScopeDep, SessionDep, SettingsDep
from app.core import idempotency
from app.core.correlation import get_correlation_id
from app.modules.authz.permissions import Permission
from app.modules.inventory.models import AcquisitionType, Inventory, MovementType, StockLot
from app.modules.inventory.service import MovementRequest, apply_movements

router = APIRouter(prefix="/inventory", tags=["inventory"])

RECEIPTS_ENDPOINT = "POST /inventory/receipts"


class ReceiptLine(BaseModel):
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int = Field(gt=0, le=10_000)
    acquisition_type: AcquisitionType = AcquisitionType.PURCHASE
    # Acquisition cost belongs to the lot, never to catalog identity (F33).
    unit_cost: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)


class ReceiptRequest(BaseModel):
    store_id: uuid.UUID
    lines: list[ReceiptLine] = Field(min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)


class ReceiptLineResult(BaseModel):
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity_received: int
    quantity_after: int
    stock_lot_id: uuid.UUID
    movement_id: uuid.UUID


class ReceiptResponse(BaseModel):
    store_id: uuid.UUID
    lines: list[ReceiptLineResult]


class InventoryRow(BaseModel):
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int


class InventoryPage(BaseModel):
    store_id: uuid.UUID
    rows: list[InventoryRow]


@router.get("", response_model=InventoryPage)
async def list_inventory(
    scope: ScopeDep,
    session: SessionDep,
    store_id: Annotated[uuid.UUID, Query()],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> InventoryPage:
    # The store id arrives from the client, so it is validated against the
    # caller's memberships before it is used (invariant I12).
    scope.require(Permission.INVENTORY_VIEW, store_id)

    rows = (
        (
            await session.execute(
                select(Inventory)
                .where(Inventory.store_id == store_id, Inventory.quantity > 0)
                .order_by(Inventory.product_variant_id, Inventory.size_id)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return InventoryPage(
        store_id=store_id,
        rows=[
            InventoryRow(
                product_variant_id=row.product_variant_id,
                size_id=row.size_id,
                quantity=row.quantity,
            )
            for row in rows
        ],
    )


@router.post("/receipts", response_model=ReceiptResponse, status_code=status.HTTP_201_CREATED)
async def receive_goods(
    payload: ReceiptRequest,
    scope: ScopeDep,
    session: SessionDep,
    settings: SettingsDep,
    response: Response,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=200)],
) -> ReceiptResponse:
    """Record goods arriving in a store.

    Owns its transaction: every lot, movement and quantity change commits
    together, or nothing does.
    """
    scope.require(Permission.INVENTORY_RECEIVE, payload.store_id)

    outcome = await idempotency.claim(
        session,
        organization_id=scope.organization_id,
        endpoint=RECEIPTS_ENDPOINT,
        key=idempotency_key,
        request_fingerprint=idempotency.fingerprint(
            payload.model_dump(mode="json"),
            actor_user_id=scope.user_id,
            store_id=payload.store_id,
        ),
    )
    if isinstance(outcome, idempotency.Replay):
        # Identical request, already executed. Return the original answer
        # rather than receiving the same delivery twice.
        response.status_code = outcome.http_status
        return ReceiptResponse.model_validate(outcome.response)

    correlation_id = get_correlation_id()
    results: list[ReceiptLineResult] = []
    requests: list[MovementRequest] = []
    lots: dict[tuple[uuid.UUID, uuid.UUID], StockLot] = {}

    for line in payload.lines:
        lot = StockLot(
            organization_id=scope.organization_id,
            store_id=payload.store_id,
            product_variant_id=line.product_variant_id,
            size_id=line.size_id,
            acquisition_type=line.acquisition_type,
            unit_cost=line.unit_cost,
            currency_code=settings.default_currency_code if line.unit_cost is not None else None,
            notes=payload.notes,
        )
        session.add(lot)
        lots[(line.product_variant_id, line.size_id)] = lot
    await session.flush()

    for line in payload.lines:
        lot = lots[(line.product_variant_id, line.size_id)]
        requests.append(
            MovementRequest(
                store_id=payload.store_id,
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity_delta=line.quantity,
                movement_type=MovementType.DELIVERY,
                stock_lot_id=lot.id,
                reference_type="stock_lot",
                reference_id=lot.id,
            )
        )

    applied = await apply_movements(
        session,
        organization_id=scope.organization_id,
        requests=requests,
        actor_user_id=scope.user_id,
        correlation_id=correlation_id,
    )

    for entry in applied:
        lot = lots[(entry.request.product_variant_id, entry.request.size_id)]
        results.append(
            ReceiptLineResult(
                product_variant_id=entry.request.product_variant_id,
                size_id=entry.request.size_id,
                quantity_received=entry.request.quantity_delta,
                quantity_after=entry.quantity_after,
                stock_lot_id=lot.id,
                movement_id=entry.movement_id,
            )
        )

    body = ReceiptResponse(store_id=payload.store_id, lines=results)
    await idempotency.complete(
        session,
        outcome.record_id,
        response=body.model_dump(mode="json"),
        http_status=status.HTTP_201_CREATED,
    )
    await session.commit()
    return body


__all__ = ["router"]
