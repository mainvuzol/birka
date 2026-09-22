"""Transfer endpoints.

`POST /transfers` moves goods from one warehouse to another. It carries the
same two identifiers a sale and a refund do, with the same two jobs:

* `Idempotency-Key` (header) — "give me the same answer" for 7 days;
* `command_id` (body) — "this is the same business operation", forever.

`store_id` is the authority, not a place. Goods move between the two
*locations*; the store is whose permission and whose warehouse access the move
happens under, and which store the ledger records as having done it.

No price, cost or amount is accepted. A transfer moves goods, never money
(invariant I16).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Self

from fastapi import APIRouter, Header, Response, status
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.api.deps import ScopeDep, SessionDep
from app.core import idempotency
from app.core.correlation import get_correlation_id
from app.core.text import CleanText
from app.modules.authz.permissions import Permission
from app.modules.tenancy.service import LocationCapability, require_location_access
from app.modules.transfers.service import TransferLineInput, TransferResult, create_transfer

router = APIRouter(tags=["transfers"])

TRANSFERS_ENDPOINT = "POST /transfers"


class TransferLinePayload(BaseModel):
    # Unsupported fields are refused rather than silently dropped: a client
    # that sends a price must learn that a transfer does not carry one.
    model_config = ConfigDict(extra="forbid")

    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    # Strict, as on a refund: lax coercion would turn `true` into 1 and `"2"`
    # into 2, and each of those is goods leaving a shelf on the strength of a
    # value the client did not mean to send.
    quantity: int = Field(gt=0, le=1000, strict=True)


class TransferRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Whose authority the goods move under. Not where they are.
    store_id: uuid.UUID
    # Client-generated and permanent. Two requests carrying the same command_id
    # are the same transfer, however far apart they arrive.
    command_id: uuid.UUID
    from_location_id: uuid.UUID
    to_location_id: uuid.UUID
    lines: list[TransferLinePayload] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def _between_two_places(self) -> Self:
        if self.from_location_id == self.to_location_id:
            raise ValueError("A transfer must move goods between two different locations")
        return self


class TransferItemResponse(BaseModel):
    id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int


class TransferResponse(BaseModel):
    id: uuid.UUID
    store_id: uuid.UUID
    from_location_id: uuid.UUID
    to_location_id: uuid.UUID
    status: str
    sent_at: datetime | None = None
    received_at: datetime | None = None
    items: list[TransferItemResponse]
    movements: list[uuid.UUID] = Field(
        default_factory=list,
        description="TRANSFER_OUT and TRANSFER_IN stock movements, both legs of every line.",
    )


def _to_response(result: TransferResult) -> TransferResponse:
    transfer = result.transfer
    return TransferResponse(
        id=transfer.id,
        store_id=transfer.initiating_store_id,
        from_location_id=transfer.from_location_id,
        to_location_id=transfer.to_location_id,
        status=transfer.status.value,
        sent_at=transfer.sent_at,
        received_at=transfer.received_at,
        movements=result.movements,
        items=[
            TransferItemResponse(
                id=item.id,
                product_variant_id=item.product_variant_id,
                size_id=item.size_id,
                quantity=item.quantity,
            )
            for item in result.items
        ],
    )


@router.post("/transfers", response_model=TransferResponse, status_code=status.HTTP_201_CREATED)
async def create(
    payload: TransferRequest,
    scope: ScopeDep,
    session: SessionDep,
    response: Response,
    idempotency_key: Annotated[
        CleanText, Header(alias="Idempotency-Key", min_length=8, max_length=200)
    ],
) -> TransferResponse:
    # Every decision about authority happens before the idempotency key is
    # claimed, so a revoked grant — the person's or the store's — cannot keep
    # replaying a success it was once entitled to (invariants I13 and I23).
    scope.require(Permission.TRANSFER_CREATE, payload.store_id)
    # Single-step: the same person sends and receives (see the service).
    scope.require(Permission.TRANSFER_RECEIVE, payload.store_id)
    await require_location_access(
        session,
        organization_id=scope.organization_id,
        store_id=payload.store_id,
        location_ids={payload.from_location_id},
        capability=LocationCapability.SELL,
    )
    await require_location_access(
        session,
        organization_id=scope.organization_id,
        store_id=payload.store_id,
        location_ids={payload.to_location_id},
        capability=LocationCapability.RECEIVE,
    )

    outcome = await idempotency.claim(
        session,
        organization_id=scope.organization_id,
        endpoint=TRANSFERS_ENDPOINT,
        key=idempotency_key,
        request_fingerprint=idempotency.fingerprint(
            payload.model_dump(mode="json"),
            actor_user_id=scope.user_id,
            store_id=payload.store_id,
        ),
    )
    if isinstance(outcome, idempotency.Replay):
        response.status_code = outcome.http_status
        return TransferResponse.model_validate(outcome.response)

    result = await create_transfer(
        session,
        scope=scope,
        store_id=payload.store_id,
        command_id=payload.command_id,
        from_location_id=payload.from_location_id,
        to_location_id=payload.to_location_id,
        lines=[
            TransferLineInput(
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity=line.quantity,
            )
            for line in payload.lines
        ],
        correlation_id=get_correlation_id(),
    )

    body = (
        TransferResponse.model_validate(result.transfer.response_snapshot)
        if result.transfer.response_snapshot is not None
        else _to_response(result)
    )
    result.transfer.response_snapshot = body.model_dump(mode="json")
    await idempotency.complete(
        session,
        outcome.record_id,
        response=body.model_dump(mode="json"),
        http_status=status.HTTP_201_CREATED,
    )
    await session.commit()
    return body


__all__ = ["router"]
