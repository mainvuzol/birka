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
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app.api.deps import ScopeDep, SessionDep, SettingsDep
from app.core import idempotency
from app.core.correlation import get_correlation_id
from app.core.text import CleanText
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.inventory.models import (
    AcquisitionType,
    Inventory,
    MovementReason,
    MovementType,
    StockLot,
)
from app.modules.inventory.service import MovementRequest, apply_movements, lock_stock

router = APIRouter(prefix="/inventory", tags=["inventory"])

RECEIPTS_ENDPOINT = "POST /inventory/receipts"
ADJUSTMENTS_ENDPOINT = "POST /inventory/adjustments"


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
    notes: CleanText | None = Field(default=None, max_length=1000)


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
    idempotency_key: Annotated[
        CleanText, Header(alias="Idempotency-Key", min_length=8, max_length=200)
    ],
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

    await lock_stock(
        session,
        organization_id=scope.organization_id,
        keys=[(payload.store_id, line.product_variant_id, line.size_id) for line in payload.lines],
    )
    correlation_id = get_correlation_id()
    results: list[ReceiptLineResult] = []
    requests: list[MovementRequest] = []
    lots: list[StockLot] = []

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
        lots.append(lot)
    await session.flush()

    for line, lot in zip(payload.lines, lots, strict=True):
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

    by_lot = {entry.request.stock_lot_id: entry for entry in applied}
    for lot in lots:
        entry = by_lot[lot.id]
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


class AdjustmentRequest(BaseModel):
    """An arbitrary stock correction. Manager/owner only.

    Distinct from the FOUND_DURING_SALE path on POST /sales, which a seller may
    use but only for the exact shortfall of the line being sold.
    """

    store_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity_delta: int = Field(ge=-10_000, le=10_000)
    reason_code: MovementReason
    note: CleanText | None = Field(default=None, max_length=500)

    @field_validator("quantity_delta")
    @classmethod
    def _must_change_something(cls, value: int) -> int:
        # The database rejects a zero delta too; refusing here turns a 500
        # into a message the seller can act on.
        if value == 0:
            raise ValueError("An adjustment must change the quantity")
        return value


class AdjustmentResponse(BaseModel):
    movement_id: uuid.UUID
    quantity_before: int
    quantity_after: int


@router.post("/adjustments", response_model=AdjustmentResponse, status_code=status.HTTP_201_CREATED)
async def adjust_inventory(
    payload: AdjustmentRequest,
    scope: ScopeDep,
    session: SessionDep,
    response: Response,
    idempotency_key: Annotated[
        CleanText, Header(alias="Idempotency-Key", min_length=8, max_length=200)
    ],
) -> AdjustmentResponse:
    """Change stock outside a sale, with a reason and an audit entry.

    `.ai/workflows/inventory-adjustment.md`: authorized actor, mandatory
    reason, always a StockMovement, always an audit record of before and after.
    """
    scope.require(Permission.INVENTORY_ADJUST, payload.store_id)

    outcome = await idempotency.claim(
        session,
        organization_id=scope.organization_id,
        endpoint=ADJUSTMENTS_ENDPOINT,
        key=idempotency_key,
        request_fingerprint=idempotency.fingerprint(
            payload.model_dump(mode="json"),
            actor_user_id=scope.user_id,
            store_id=payload.store_id,
        ),
    )
    if isinstance(outcome, idempotency.Replay):
        response.status_code = outcome.http_status
        return AdjustmentResponse.model_validate(outcome.response)

    applied = await apply_movements(
        session,
        organization_id=scope.organization_id,
        requests=[
            MovementRequest(
                store_id=payload.store_id,
                product_variant_id=payload.product_variant_id,
                size_id=payload.size_id,
                quantity_delta=payload.quantity_delta,
                movement_type=MovementType.ADJUSTMENT,
                reason_code=payload.reason_code,
            )
        ],
        actor_user_id=scope.user_id,
        correlation_id=get_correlation_id(),
    )
    entry = applied[0]
    before = entry.quantity_after - entry.request.quantity_delta

    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="inventory.adjusted",
        entity_type="stock_movement",
        entity_id=entry.movement_id,
        before={"quantity": before},
        after={"quantity": entry.quantity_after},
        reason=payload.note or payload.reason_code.value,
    )

    body = AdjustmentResponse(
        movement_id=entry.movement_id,
        quantity_before=before,
        quantity_after=entry.quantity_after,
    )
    await idempotency.complete(
        session,
        outcome.record_id,
        response=body.model_dump(mode="json"),
        http_status=status.HTTP_201_CREATED,
    )
    await session.commit()
    return body
