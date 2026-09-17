"""Refund endpoints.

`POST /sales/{sale_id}/refunds` carries the same two identifiers a sale does,
with the same two jobs:

* `Idempotency-Key` (header) — "give me the same answer" for 7 days;
* `command_id` (body) — "this is the same business operation", forever.

The store is **not** in the request. A refund happens where the sale happened;
letting a client name the store would either be redundant or would quietly
restock one shop from another shop's receipt, which is a transfer and has to
be an explicit one (invariant I16).

The money is not in the request either. How many units come back is the
client's to say; what they are worth was decided when they were sold.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Header, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep
from app.core import idempotency
from app.core.correlation import get_correlation_id
from app.core.text import CleanText
from app.modules.authz.permissions import Permission
from app.modules.refunds.service import (
    RefundLineInput,
    RefundResult,
    create_refund,
    refund_destinations,
    sale_store_id,
)
from app.modules.tenancy.service import LocationCapability, require_location_access

router = APIRouter(tags=["refunds"])

REFUNDS_ENDPOINT = "POST /sales/{sale_id}/refunds"


class RefundLinePayload(BaseModel):
    # Unsupported fields are refused rather than silently dropped: a client
    # that sends `amount` must learn that refunds are computed, not quoted.
    model_config = ConfigDict(extra="forbid")

    sale_item_id: uuid.UUID
    # Strict: Pydantic's lax mode would turn `true` into 1, `"2"` into 2 and
    # `2.0` into 2, and every one of those is money going back to a customer
    # on the strength of a value the client did not mean to send. The service
    # checks `type(...) is not int` for exactly this, but lax coercion happens
    # first and it never sees the original.
    quantity: int = Field(gt=0, le=1000, strict=True)
    # No default, and strict. "Back on the rack" and "refunded and binned" are
    # both ordinary, and the difference is stock that either exists or does
    # not — so lax coercion turning `"yes"` or `1` into True would be the
    # schema deciding what the docstring says a person must state.
    restock: bool = Field(strict=True)


class RefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Client-generated and permanent. Two requests carrying the same command_id
    # are the same refund, however far apart they arrive.
    command_id: uuid.UUID
    lines: list[RefundLinePayload] = Field(min_length=1, max_length=100)
    reason: CleanText | None = Field(default=None, max_length=1000)


class RefundItemResponse(BaseModel):
    id: uuid.UUID
    sale_item_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int
    amount: Decimal
    restock: bool
    # Where the units went back. Derived from the sale line, never requested.
    destination_location_id: uuid.UUID | None = None
    # From the sale line's frozen snapshot, so a refund receipt reads the way
    # the original one did even after the product was renamed.
    display_name: str


class RefundResponse(BaseModel):
    id: uuid.UUID
    sale_id: uuid.UUID
    store_id: uuid.UUID
    currency_code: str
    total_amount: Decimal
    reason: str | None = None
    items: list[RefundItemResponse]
    movements: list[uuid.UUID] = Field(
        default_factory=list,
        description="REFUND_RETURN stock movements written for the restocked lines.",
    )


def _to_response(result: RefundResult) -> RefundResponse:
    return RefundResponse(
        id=result.refund.id,
        sale_id=result.refund.sale_id,
        store_id=result.refund.store_id,
        currency_code=result.refund.currency_code,
        total_amount=result.refund.total_amount,
        reason=result.refund.reason,
        movements=result.movements,
        items=[
            RefundItemResponse(
                id=line.refund_item.id,
                sale_item_id=line.refund_item.sale_item_id,
                product_variant_id=line.sale_item.product_variant_id,
                size_id=line.sale_item.size_id,
                quantity=line.refund_item.quantity,
                amount=line.refund_item.amount,
                restock=line.refund_item.restock,
                destination_location_id=line.refund_item.destination_location_id,
                display_name=line.sale_item.display_name_snapshot,
            )
            for line in result.lines
        ],
    )


@router.post(
    "/sales/{sale_id}/refunds",
    response_model=RefundResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create(
    sale_id: uuid.UUID,
    payload: RefundRequest,
    scope: ScopeDep,
    session: SessionDep,
    response: Response,
    idempotency_key: Annotated[
        CleanText, Header(alias="Idempotency-Key", min_length=8, max_length=200)
    ],
) -> RefundResponse:
    # The store comes from the sale, and the sale lookup is tenant-scoped, so a
    # receipt belonging to another organization is a 404 before any authority
    # is consulted. The permission decision then happens before the idempotency
    # key is claimed, so a revoked grant cannot replay an earlier success
    # (invariant I13).
    store_id = await sale_store_id(session, organization_id=scope.organization_id, sale_id=sale_id)
    scope.require(Permission.SALE_REFUND, store_id)
    # Where restocked goods would go is a property of the sale, so it can be
    # resolved — and its access checked — before the key is claimed, keeping a
    # revoked grant from replaying a cached success (invariants I13/I23).
    restock_destinations = await refund_destinations(
        session,
        organization_id=scope.organization_id,
        sale_id=sale_id,
        sale_item_ids={line.sale_item_id for line in payload.lines if line.restock},
    )
    await require_location_access(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        location_ids=restock_destinations,
        capability=LocationCapability.RECEIVE,
    )

    outcome = await idempotency.claim(
        session,
        organization_id=scope.organization_id,
        endpoint=REFUNDS_ENDPOINT,
        key=idempotency_key,
        request_fingerprint=idempotency.fingerprint(
            # `sale_id` is a path parameter, so it has to be folded in by hand.
            # Without it the same key and body aimed at a different receipt
            # would replay this one's answer.
            {"sale_id": str(sale_id), **payload.model_dump(mode="json")},
            actor_user_id=scope.user_id,
            store_id=store_id,
        ),
    )
    if isinstance(outcome, idempotency.Replay):
        # `SALE_REFUND` again, deliberately, not `SALE_VIEW`: requiring more to
        # retry than to issue would leave a client that timed out unable to
        # learn the outcome of its own successful refund, and the 403 would be
        # indistinguishable from "you were never allowed".
        scope.require(Permission.SALE_REFUND, store_id)
        response.status_code = outcome.http_status
        return RefundResponse.model_validate(outcome.response)

    result = await create_refund(
        session,
        scope=scope,
        sale_id=sale_id,
        command_id=payload.command_id,
        lines=[
            RefundLineInput(
                sale_item_id=line.sale_item_id,
                quantity=line.quantity,
                restock=line.restock,
            )
            for line in payload.lines
        ],
        reason=payload.reason,
        correlation_id=get_correlation_id(),
    )

    body = (
        RefundResponse.model_validate(result.refund.response_snapshot)
        if result.refund.response_snapshot is not None
        else _to_response(result)
    )
    result.refund.response_snapshot = body.model_dump(mode="json")
    await idempotency.complete(
        session,
        outcome.record_id,
        response=body.model_dump(mode="json"),
        http_status=status.HTTP_201_CREATED,
    )
    await session.commit()
    return body


__all__ = ["router"]
