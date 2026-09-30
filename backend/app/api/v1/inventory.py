"""Inventory endpoints.

`POST /inventory/receipts` is the structured intake path: the seller picks an
existing variant and size and states a quantity. Natural-language intake
(`POST /catalog/entries`) arrives in gate M1C and will funnel into the same
inventory service, so there stays exactly one way stock can change.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Callable
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, Query, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ScopeDep, SessionDep, SettingsDep
from app.core import idempotency
from app.core.correlation import get_correlation_id
from app.core.errors import (
    IdempotencyConflictError,
    StockChangedError,
    ValidationFailedError,
)
from app.core.text import CleanText
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.read import unknown_size_ids
from app.modules.inventory.models import (
    AcquisitionType,
    GoodsReceipt,
    MovementReason,
    MovementType,
    StockAdjustment,
    StockLot,
)
from app.modules.inventory.service import (
    MovementRequest,
    apply_movements,
    lock_stock,
    readable_stock,
    record_adjustment,
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
    # What the shop paid for one unit, as stored on the lot — so the receiving
    # screen shows what was recorded, not what it typed. A seller may enter
    # and see it (owner decision, 2026-09-30). Defaults keep an answer frozen
    # before these fields existed readable on a late replay.
    unit_cost: Decimal | None = None
    currency_code: str | None = None


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


# Constrained to the commands whose permanent identity lives on a row of
# their own here.
async def _permanent_answer[Command: (GoodsReceipt, StockAdjustment)](
    session: AsyncSession,
    *,
    scope: RequestScope,
    model: type[Command],
    store_of: Callable[[Command], uuid.UUID],
    permission: Permission,
    command_id: uuid.UUID,
    request_fingerprint: str,
) -> dict[str, Any] | None:
    """Durable replay: has this permanent command already changed stock?

    Shared by receipts (ADR-0006) and adjustments (ADR-0007), and a mirror of
    `transfers.service._existing_command`. Taken before any stock lock, and
    only ever serializes two requests carrying the same `command_id` — which
    are by definition the same business operation.

    Returns the original answer, `None` if the command is new, or refuses.
    """
    lock_key = int.from_bytes(
        hashlib.sha256(scope.organization_id.bytes + command_id.bytes).digest()[:8],
        byteorder="big",
        signed=True,
    )
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
    existing = await session.scalar(
        select(model).where(
            model.organization_id == scope.organization_id,
            model.command_id == command_id,
        )
    )
    if existing is None:
        return None
    if existing.command_fingerprint != request_fingerprint or existing.response_snapshot is None:
        # Same permanent command, different request. Never execute: one of the
        # two payloads is a client bug, and guessing which would change stock
        # nobody asked to change. A NULL fingerprint is the same refusal for a
        # different reason — there is nothing to compare against — and exists
        # only on a row made before its revision was rolled back and re-applied.
        details = {"command_id": str(command_id)}
        store_id = store_of(existing)
        if store_id in scope.store_ids and scope.can(permission, store_id):
            details[f"{model.__tablename__}_id"] = str(existing.id)
        raise IdempotencyConflictError(
            "The original request for this existing command cannot be verified"
            if existing.command_fingerprint is None
            else "This command_id was already used with a different request",
            **details,
        )
    # No permission recheck here, deliberately. The permanent fingerprint
    # binds the actor and the acting store, so reaching this line means the
    # request matches one this same person made from this same store — and
    # the handler already required the permission there, and access to this
    # warehouse, before the claim. A recheck would be unreachable: it was
    # written, mutated, and no test could tell the difference (ADR-0006).
    return existing.response_snapshot


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
    original = await _permanent_answer(
        session,
        scope=scope,
        model=GoodsReceipt,
        store_of=lambda row: row.receiving_store_id,
        permission=Permission.INVENTORY_RECEIVE,
        command_id=payload.command_id,
        request_fingerprint=permanent_fingerprint,
    )
    if original is not None:
        replayed = ReceiptResponse.model_validate(original)
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
                unit_cost=lot.unit_cost,
                currency_code=lot.currency_code,
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
    # Client-generated and permanent, required since `0017` (ADR-0007).
    # Without it a correction is idempotent only for as long as its response
    # cache, and an identical request arriving later applies it again.
    command_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity_delta: int = Field(ge=-10_000, le=10_000)
    reason_code: AdjustmentReason
    note: CleanText | None = Field(default=None, max_length=500)
    # The balance the correction was worked out against, when the person
    # stated a count ("the shelf holds 3") rather than a change. Given, the
    # correction applies only while the warehouse still holds exactly this
    # many; otherwise it is refused as STOCK_CHANGED and nothing is written.
    # Omitted, the delta applies to whatever is there — right for "one coat
    # is damaged", which is true whatever the balance.
    expected_quantity: int | None = Field(default=None, ge=0)

    @field_validator("quantity_delta")
    @classmethod
    def _must_change_something(cls, value: int) -> int:
        # The database rejects a zero delta too; refusing here turns a 500
        # into a message the seller can act on.
        if value == 0:
            raise ValueError("An adjustment must change the quantity")
        return value


class AdjustmentResponse(BaseModel):
    id: uuid.UUID
    movement_id: uuid.UUID
    quantity_before: int
    quantity_after: int


def _adjustment_fingerprint(*, scope: RequestScope, payload: AdjustmentRequest) -> str:
    """Everything that makes this correction *this* correction.

    The stock facts only — warehouse, stock key, delta and reason — for the
    reason the receipt's fingerprint leaves its notes out: a note is commentary,
    and the same `command_id` aimed at a different key or a different amount is
    a client bug, whereas the same change with a reworded note is not.

    `expected_quantity` is out too. It is a precondition, checked once when
    the correction first applies; a late retry is answered from the permanent
    record before any balance is compared, since the balance has moved on.
    """
    return idempotency.fingerprint(
        {
            "location_id": str(payload.location_id),
            "product_variant_id": str(payload.product_variant_id),
            "size_id": str(payload.size_id),
            "quantity_delta": payload.quantity_delta,
            "reason_code": str(payload.reason_code),
        },
        actor_user_id=scope.user_id,
        store_id=payload.store_id,
    )


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

    # The permanent record, which is still there after the cache has gone.
    permanent_fingerprint = _adjustment_fingerprint(scope=scope, payload=payload)
    original = await _permanent_answer(
        session,
        scope=scope,
        model=StockAdjustment,
        store_of=lambda row: row.acting_store_id,
        permission=Permission.INVENTORY_ADJUST,
        command_id=payload.command_id,
        request_fingerprint=permanent_fingerprint,
    )
    if original is not None:
        replayed = AdjustmentResponse.model_validate(original)
        await idempotency.complete(
            session,
            outcome.record_id,
            response=replayed.model_dump(mode="json"),
            http_status=status.HTTP_201_CREATED,
        )
        await session.commit()
        response.status_code = status.HTTP_201_CREATED
        return replayed

    if payload.expected_quantity is not None:
        # Locked here and held to commit, so nothing can move the balance
        # between this comparison and the movement below.
        key = (payload.location_id, payload.product_variant_id, payload.size_id)
        held = await lock_stock(
            session,
            organization_id=scope.organization_id,
            keys=[key],
            acting_store_ids={payload.store_id},
        )
        if held[key] != payload.expected_quantity:
            raise StockChangedError(expected=payload.expected_quantity, actual=held[key])

    recorded = await record_adjustment(
        session,
        organization_id=scope.organization_id,
        store_id=payload.store_id,
        actor_user_id=scope.user_id,
        command_id=payload.command_id,
        command_fingerprint=permanent_fingerprint,
        location_id=payload.location_id,
        product_variant_id=payload.product_variant_id,
        size_id=payload.size_id,
        quantity_delta=payload.quantity_delta,
        reason_code=payload.reason_code,
        note=payload.note,
        correlation_id=get_correlation_id(),
    )
    body = AdjustmentResponse(
        id=recorded.adjustment.id,
        movement_id=recorded.movement.movement_id,
        quantity_before=recorded.quantity_before,
        quantity_after=recorded.movement.quantity_after,
    )
    recorded.adjustment.response_snapshot = body.model_dump(mode="json")
    await idempotency.complete(
        session,
        outcome.record_id,
        response=body.model_dump(mode="json"),
        http_status=status.HTTP_201_CREATED,
    )
    await session.commit()
    return body
