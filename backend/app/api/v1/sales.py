"""Sale endpoints.

`POST /sales` is the hot path — the thing a seller does hundreds of times a
shift. It carries two identifiers with different jobs:

* `Idempotency-Key` (header) — "give me the same answer" for 7 days;
* `command_id` (body) — "this is the same business operation", forever.

A corrected sale (`found_in_store`) is a *different* payload from the rejected
one, so the client must send it with a **new** Idempotency-Key. Reusing the
original key correctly returns `IDEMPOTENCY_CONFLICT`.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Header, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import ScopeDep, SessionDep, SettingsDep
from app.core import idempotency
from app.core.correlation import get_correlation_id
from app.core.errors import NotFoundError
from app.core.text import CleanText
from app.modules.authz.permissions import Permission
from app.modules.sales.models import Sale, SaleItem
from app.modules.sales.service import (
    FoundInStore,
    MissingInStore,
    SaleLineInput,
    correction_ids,
    create_sale,
    shortage_ids,
)
from app.modules.tenancy.service import LocationCapability, require_location_access

router = APIRouter(tags=["sales"])

SALES_ENDPOINT = "POST /sales"


class SaleLinePayload(BaseModel):
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    # Explicit per line. The client may prefill it when the store reaches only
    # one warehouse, but the server never chooses, and never falls back to
    # another warehouse when this one is short (owner decision, 2026-09-17).
    source_location_id: uuid.UUID
    quantity: int = Field(gt=0, le=1000)
    unit_price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)


class FoundInStorePayload(BaseModel):
    """The seller confirming the goods are physically present (F30)."""

    line_index: int = Field(ge=0)
    quantity: int = Field(gt=0, le=1000)


class MissingInStorePayload(BaseModel):
    """The seller confirming how many units are physically there (M1-030).

    `quantity` is the count **present**, not the shortage: the sale is then
    made for that many, and the difference the system believed in is taken off
    the shelf with reason `MISSING_AT_SALE`. `gt=0` because a line with
    nothing to sell is not a sale — an empty shelf with no sale behind it is a
    stocktake, and belongs to `POST /inventory/adjustments`.
    """

    line_index: int = Field(ge=0)
    quantity: int = Field(gt=0, le=1000)


class SaleRequest(BaseModel):
    store_id: uuid.UUID
    # Client-generated and permanent. Two requests carrying the same command_id
    # are the same sale, however far apart they arrive.
    command_id: uuid.UUID
    lines: list[SaleLinePayload] = Field(min_length=1, max_length=100)
    found_in_store: list[FoundInStorePayload] = Field(default_factory=list, max_length=100)
    missing_in_store: list[MissingInStorePayload] = Field(default_factory=list, max_length=100)


class SaleItemResponse(BaseModel):
    id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    source_location_id: uuid.UUID
    quantity: int
    unit_price: Decimal
    discount_amount: Decimal
    final_unit_price: Decimal
    line_total: Decimal
    display_name: str


class SaleResponse(BaseModel):
    id: uuid.UUID
    store_id: uuid.UUID
    currency_code: str
    subtotal: Decimal
    discount_total: Decimal
    total: Decimal
    items: list[SaleItemResponse]
    corrections: list[uuid.UUID] = Field(
        default_factory=list,
        description="Stock movements written because goods were found in store.",
    )
    shortages: list[uuid.UUID] = Field(
        default_factory=list,
        description="Stock movements written because goods the system believed in were not there.",
    )


def _to_response(
    sale: Sale,
    items: list[SaleItem],
    corrections: list[uuid.UUID],
    shortages: list[uuid.UUID],
) -> SaleResponse:
    return SaleResponse(
        id=sale.id,
        store_id=sale.store_id,
        currency_code=sale.currency_code,
        subtotal=sale.subtotal,
        discount_total=sale.discount_total,
        total=sale.total,
        corrections=corrections,
        shortages=shortages,
        items=[
            SaleItemResponse(
                id=item.id,
                product_variant_id=item.product_variant_id,
                size_id=item.size_id,
                source_location_id=item.source_location_id,
                quantity=item.quantity,
                unit_price=item.unit_price,
                discount_amount=item.discount_amount,
                final_unit_price=item.final_unit_price,
                line_total=item.line_total,
                display_name=item.display_name_snapshot,
            )
            for item in items
        ],
    )


@router.post("/sales", response_model=SaleResponse, status_code=status.HTTP_201_CREATED)
async def create(
    payload: SaleRequest,
    scope: ScopeDep,
    session: SessionDep,
    settings: SettingsDep,
    response: Response,
    idempotency_key: Annotated[
        CleanText, Header(alias="Idempotency-Key", min_length=8, max_length=200)
    ],
) -> SaleResponse:
    # Revoked store access/correction capability must apply to cached receipts too.
    scope.require(Permission.SALE_CREATE, payload.store_id)
    if payload.found_in_store:
        scope.require(Permission.INVENTORY_CORRECT_DURING_SALE, payload.store_id)
    if payload.missing_in_store:
        scope.require(Permission.INVENTORY_REPORT_MISSING_DURING_SALE, payload.store_id)
    # Invariant I23, and it belongs here rather than only in the service: the
    # service runs *after* the replay branch below, so a store whose warehouse
    # access was revoked would keep being handed its cached success.
    await require_location_access(
        session,
        organization_id=scope.organization_id,
        store_id=payload.store_id,
        location_ids={line.source_location_id for line in payload.lines},
        capability=LocationCapability.SELL,
    )
    outcome = await idempotency.claim(
        session,
        organization_id=scope.organization_id,
        endpoint=SALES_ENDPOINT,
        key=idempotency_key,
        request_fingerprint=idempotency.fingerprint(
            payload.model_dump(mode="json"),
            actor_user_id=scope.user_id,
            store_id=payload.store_id,
        ),
    )
    if isinstance(outcome, idempotency.Replay):
        scope.require(Permission.SALE_VIEW, payload.store_id)
        response.status_code = outcome.http_status
        return SaleResponse.model_validate(outcome.response)

    result = await create_sale(
        session,
        scope=scope,
        store_id=payload.store_id,
        command_id=payload.command_id,
        currency_code=settings.default_currency_code,
        lines=[
            SaleLineInput(
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                source_location_id=line.source_location_id,
                quantity=line.quantity,
                unit_price=line.unit_price,
                discount_amount=line.discount_amount,
            )
            for line in payload.lines
        ],
        found_in_store=[
            FoundInStore(line_index=found.line_index, quantity=found.quantity)
            for found in payload.found_in_store
        ],
        missing_in_store=[
            MissingInStore(line_index=missing.line_index, quantity=missing.quantity)
            for missing in payload.missing_in_store
        ],
        correlation_id=get_correlation_id(),
    )

    body = (
        SaleResponse.model_validate(result.sale.response_snapshot)
        if result.sale.response_snapshot is not None
        else _to_response(result.sale, result.items, result.corrections, result.shortages)
    )
    result.sale.response_snapshot = body.model_dump(mode="json")
    await idempotency.complete(
        session,
        outcome.record_id,
        response=body.model_dump(mode="json"),
        http_status=status.HTTP_201_CREATED,
    )
    await session.commit()
    return body


@router.get("/sales/{sale_id}", response_model=SaleResponse)
async def read_sale(sale_id: uuid.UUID, scope: ScopeDep, session: SessionDep) -> SaleResponse:
    sale = (
        await session.execute(
            select(Sale).where(Sale.id == sale_id, Sale.organization_id == scope.organization_id)
        )
    ).scalar_one_or_none()
    if sale is None:
        # Scoped to the caller's organization, so a sale in another tenant is
        # indistinguishable from one that does not exist.
        raise NotFoundError("Sale not found", sale_id=str(sale_id))

    scope.require(Permission.SALE_VIEW, sale.store_id)

    if sale.response_snapshot is not None:
        return SaleResponse.model_validate(sale.response_snapshot)

    items = (
        (await session.execute(select(SaleItem).where(SaleItem.sale_id == sale.id))).scalars().all()
    )
    return _to_response(
        sale,
        list(items),
        await correction_ids(session, sale),
        await shortage_ids(session, sale),
    )


__all__ = ["router"]
