"""Inventory endpoints.

`POST /inventory/receipts` is the structured intake path: the seller picks an
existing variant and size and states a quantity. Natural-language intake
(`POST /catalog/entries`) arrives in gate M1C and will funnel into the same
inventory service, so there stays exactly one way stock can change.
"""

from __future__ import annotations

import hashlib
import uuid
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Query, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ScopeDep, SessionDep, SettingsDep
from app.core import idempotency
from app.core.correlation import get_correlation_id
from app.core.errors import IdempotencyConflictError, ValidationFailedError
from app.core.text import CleanText
from app.modules.audit import service as audit
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.read import unknown_size_ids
from app.modules.inventory.models import (
    AcquisitionType,
    GoodsReceipt,
    MovementReason,
    MovementType,
    StockLot,
)
from app.modules.inventory.service import (
    MovementRequest,
    apply_movements,
    lock_stock,
    readable_stock,
)
from app.modules.tenancy.service import LocationCapability

router = APIRouter(prefix="/inventory", tags=["inventory"])

RECEIPTS_ENDPOINT = "POST /inventory/receipts"
ADJUSTMENTS_ENDPOINT = "POST /inventory/adjustments"


# What a receipt can say about goods arriving. The other acquisition types
# each belong to a command of their own — a transfer, a return, an adjustment,
# an opening balance — and a receipt labelled as one of them would put a lot
# in the books that no such command ever produced (ADR-0005).
ReceiptAcquisition = Literal[
    AcquisitionType.PURCHASE, AcquisitionType.CONSIGNMENT, AcquisitionType.BORROWED
]

# What an adjustment can say about why. The two size-reclassification reasons
# are absent: each is one half of a pair a sale writes when a seller gives a
# "size not known" coat its size (ADR-0005 §11), and a lone half written here
# would be stock that changed size with no trace of where it came from.
AdjustmentReason = Literal[
    MovementReason.FOUND_DURING_SALE,
    MovementReason.MISSING_AT_SALE,
    MovementReason.DAMAGED,
    MovementReason.LOST,
    MovementReason.STOCKTAKE,
    MovementReason.CORRECTION,
    MovementReason.OTHER,
]


async def _refuse_size_not_known(
    session: AsyncSession, *, organization_id: uuid.UUID, size_ids: set[uuid.UUID]
) -> None:
    """Goods arrive with a size. "Size not known" is a legal size only in a
    legacy stock list, the one place its evidence exists (ADR-0005 §3);
    stock already held that way can still be sold, moved or written off."""
    unknown = size_ids & await unknown_size_ids(session, organization_id=organization_id)
    if unknown:
        raise ValidationFailedError(
            "Goods with their size not known enter only from a legacy stock list; say the size",
            size_id=str(min(unknown)),
        )


class ReceiptLine(BaseModel):
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int = Field(gt=0, le=10_000)
    acquisition_type: ReceiptAcquisition = AcquisitionType.PURCHASE
    # Acquisition cost belongs to the lot, never to catalog identity (F33).
    unit_cost: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)


class ReceiptRequest(BaseModel):
    # Which store is acting, and which warehouse receives. Two facts, because
    # a shared warehouse is exactly where they differ (ADR-0004).
    store_id: uuid.UUID
    location_id: uuid.UUID
    # Client-generated and permanent, as for a sale, a refund or a transfer.
    # Required since `0016`: without it a receipt is idempotent only for as
    # long as its response cache, and an identical request arriving after
    # that receives the delivery a second time (invariant I20).
    command_id: uuid.UUID
    lines: list[ReceiptLine] = Field(min_length=1, max_length=200)
    notes: CleanText | None = Field(default=None, max_length=1000)


class ReceiptLineResult(BaseModel):
    location_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity_received: int
    quantity_after: int
    stock_lot_id: uuid.UUID
    movement_id: uuid.UUID


class ReceiptResponse(BaseModel):
    id: uuid.UUID
    store_id: uuid.UUID
    lines: list[ReceiptLineResult]


class InventoryRow(BaseModel):
    location_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int
    reserved_quantity: int
    available_quantity: int


class InventoryPage(BaseModel):
    store_id: uuid.UUID
    rows: list[InventoryRow]


@router.get("", response_model=InventoryPage)
async def list_inventory(
    scope: ScopeDep,
    session: SessionDep,
    store_id: Annotated[uuid.UUID, Query()],
    location_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> InventoryPage:
    # The store id arrives from the client, so it is validated against the
    # caller's memberships before it is used (invariant I12).
    scope.require(Permission.INVENTORY_VIEW, store_id)

    # Through the service, not the ORM: the store's access to each warehouse is
    # checked there, and a row is reported once per place rather than summed
    # into a per-store total that would show shared coats under both shops.
    rows = await readable_stock(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        location_id=location_id,
        limit=limit,
        scope=scope,
    )
    return InventoryPage(
        store_id=store_id,
        rows=[
            InventoryRow(
                location_id=row.location_id,
                product_variant_id=row.product_variant_id,
                size_id=row.size_id,
                quantity=row.quantity,
                reserved_quantity=row.reserved_quantity,
                available_quantity=row.available_quantity,
            )
            for row in rows
        ],
    )


def _receipt_fingerprint(
    *, scope: RequestScope, store_id: uuid.UUID, payload: ReceiptRequest
) -> str:
    """Everything that makes this delivery *this* delivery.

    The warehouse is in it deliberately. The 7-day cache picks every payload
    field up by itself; this permanent fingerprint is built by hand, and
    without the warehouse the same `command_id` retried against a different
    one would be judged a retry and answered "received" about goods that
    never arrived there.
    """
    return idempotency.fingerprint(
        {
            "location_id": str(payload.location_id),
            "lines": [
                {
                    "product_variant_id": str(line.product_variant_id),
                    "size_id": str(line.size_id),
                    "quantity": line.quantity,
                    "acquisition_type": str(line.acquisition_type),
                    "unit_cost": None if line.unit_cost is None else str(line.unit_cost),
                }
                for line in payload.lines
            ],
        },
        actor_user_id=scope.user_id,
        store_id=store_id,
    )


async def _existing_receipt(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    request_fingerprint: str,
) -> ReceiptResponse | None:
    """Durable replay: has this permanent command already received goods?

    Taken before any stock lock, and only ever serializes two requests
    carrying the same `command_id` — which are by definition the same
    business operation. Mirrors `transfers.service._existing_command`.
    """
    lock_key = int.from_bytes(
        hashlib.sha256(scope.organization_id.bytes + command_id.bytes).digest()[:8],
        byteorder="big",
        signed=True,
    )
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
    existing = await session.scalar(
        select(GoodsReceipt).where(
            GoodsReceipt.organization_id == scope.organization_id,
            GoodsReceipt.command_id == command_id,
        )
    )
    if existing is None:
        return None
    if existing.command_fingerprint != request_fingerprint or existing.response_snapshot is None:
        # Same permanent command, different request. Never execute: one of the
        # two payloads is a client bug, and guessing which would receive a
        # delivery nobody sent. A NULL fingerprint is the same refusal for a
        # different reason — there is nothing to compare against — and exists
        # only on a receipt made before `0016` was rolled back and re-applied.
        details = {"command_id": str(command_id)}
        if existing.receiving_store_id in scope.store_ids and scope.can(
            Permission.INVENTORY_RECEIVE, existing.receiving_store_id
        ):
            details["goods_receipt_id"] = str(existing.id)
        raise IdempotencyConflictError(
            "The original request for this existing receipt cannot be verified"
            if existing.command_fingerprint is None
            else "This command_id was already used with a different request",
            **details,
        )
    # No permission recheck here, deliberately. The permanent fingerprint
    # binds the actor and the acting store, so reaching this line means the
    # request matches one this same person made from this same store — and
    # the handler already required `inventory:receive` there and access to
    # this warehouse, before the claim. A recheck would be unreachable: it
    # was written, mutated, and no test could tell the difference.
    return ReceiptResponse.model_validate(existing.response_snapshot)


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
    # Invariant I23: the person may receive goods — may this store receive
    # them *here*? Checked before the idempotency key is claimed, so a revoked
    # grant cannot keep replaying a stored success (invariant I13).
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.INVENTORY_RECEIVE,
        store_id=payload.store_id,
        location_ids={payload.location_id},
        capability=LocationCapability.RECEIVE,
    )
    await _refuse_size_not_known(
        session,
        organization_id=scope.organization_id,
        size_ids={line.size_id for line in payload.lines},
    )

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
        # Identical request, already executed, and answered from the 7-day
        # cache. Return the original answer rather than receiving the same
        # delivery twice.
        response.status_code = outcome.http_status
        return ReceiptResponse.model_validate(outcome.response)

    # The same question the cache just answered, asked of the permanent
    # record instead — the one that is still there in a year (invariant I20).
    permanent_fingerprint = _receipt_fingerprint(
        scope=scope, store_id=payload.store_id, payload=payload
    )
    replayed = await _existing_receipt(
        session,
        scope=scope,
        command_id=payload.command_id,
        request_fingerprint=permanent_fingerprint,
    )
    if replayed is not None:
        await idempotency.complete(
            session,
            outcome.record_id,
            response=replayed.model_dump(mode="json"),
            http_status=status.HTTP_201_CREATED,
        )
        await session.commit()
        response.status_code = status.HTTP_201_CREATED
        return replayed

    await lock_stock(
        session,
        organization_id=scope.organization_id,
        keys=[
            (payload.location_id, line.product_variant_id, line.size_id) for line in payload.lines
        ],
        acting_store_ids={payload.store_id},
    )
    correlation_id = get_correlation_id()
    results: list[ReceiptLineResult] = []
    requests: list[MovementRequest] = []
    lots: list[StockLot] = []

    receipt = GoodsReceipt(
        organization_id=scope.organization_id,
        location_id=payload.location_id,
        receiving_store_id=payload.store_id,
        created_by_user_id=scope.user_id,
        command_id=payload.command_id,
        notes=payload.notes,
        correlation_id=correlation_id,
        command_fingerprint=permanent_fingerprint,
    )
    session.add(receipt)
    await session.flush()

    for line in payload.lines:
        lot = StockLot(
            organization_id=scope.organization_id,
            location_id=payload.location_id,
            product_variant_id=line.product_variant_id,
            size_id=line.size_id,
            acquisition_type=line.acquisition_type,
            unit_cost=line.unit_cost,
            currency_code=settings.default_currency_code if line.unit_cost is not None else None,
            goods_receipt_id=receipt.id,
            notes=payload.notes,
        )
        session.add(lot)
        lots.append(lot)
    await session.flush()

    for line, lot in zip(payload.lines, lots, strict=True):
        requests.append(
            MovementRequest(
                location_id=payload.location_id,
                acting_store_id=payload.store_id,
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
                location_id=entry.request.location_id,
                product_variant_id=entry.request.product_variant_id,
                size_id=entry.request.size_id,
                quantity_received=entry.request.quantity_delta,
                quantity_after=entry.quantity_after,
                stock_lot_id=lot.id,
                movement_id=entry.movement_id,
            )
        )

    body = ReceiptResponse(id=receipt.id, store_id=payload.store_id, lines=results)
    receipt.response_snapshot = body.model_dump(mode="json")
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
    location_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity_delta: int = Field(ge=-10_000, le=10_000)
    reason_code: AdjustmentReason
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
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.INVENTORY_ADJUST,
        store_id=payload.store_id,
        location_ids={payload.location_id},
        capability=LocationCapability.RECEIVE,
    )
    if payload.quantity_delta > 0:
        await _refuse_size_not_known(
            session, organization_id=scope.organization_id, size_ids={payload.size_id}
        )

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
                location_id=payload.location_id,
                acting_store_id=payload.store_id,
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
