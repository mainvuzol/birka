"""Refund endpoints.

`POST /sales/{sale_id}/refunds` carries the same two identifiers a sale does,
with the same two jobs:

* `Idempotency-Key` (header) — "give me the same answer" for 7 days;
* `command_id` (body) — "this is the same business operation", forever.

The store taking the goods back is in the request only when it is not the
one that sold: any store of the network may take them back, and it is the one
that hands the money back (owner decisions, 2026-10-01). Its own authority
decides, never the selling store's.

The money is not in the request either. How many units come back is the
client's to say; what they are worth was decided when they were sold.

Nor, as a rule, is where the goods go. The client says whether each unit came
back intact or damaged; intact goes back where it was sold from, and damaged
to the «Брак» of the store taking it (owner decisions, 2026-10-01). The one
exception: taken back at a store that does not reach the warehouse it was
sold from, an intact part goes to one of that store's own, which the seller
chooses.

How the money goes back is the client's to say: the way the sale was paid
unless the seller changes it (owner decisions, 2026-10-04), one of «Готівкою»,
«На картку», «Переказом». Optional here, so a return a phone kept from before
the way was asked still replays; the service requires it of a new one, and
of a sale paid in parts only when money goes back (ADR-0012, B13, G35).
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Response, status
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.api.deps import ScopeDep, SessionDep
from app.api.v1.sales import (
    PaperMarkPayload,
    PaperMarkResponse,
    TillMethodValue,
    method_of,
    paper_response,
)
from app.core import idempotency
from app.core.correlation import get_correlation_id
from app.core.text import CleanText
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.refunds.models import ReturnCondition
from app.modules.refunds.service import (
    RefundLineInput,
    RefundResult,
    create_refund,
    refund_destinations,
    sale_store_id,
)
from app.modules.tenancy.service import LocationCapability

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
    # Stated for goods that came back, and only for them (owner decisions,
    # 2026-09-15 §3 and 2026-10-01). A line coming back partly intact and
    # partly damaged is sent as two lines for the same `sale_item_id`.
    condition: Literal["INTACT", "DAMAGED"] | None = None
    # Only for intact goods taken back at a store that does not reach the
    # warehouse they were sold from: one of that store's own.
    location_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _condition_goes_with_the_goods(self) -> RefundLinePayload:
        if self.restock and self.condition is None:
            raise ValueError("say whether the goods that came back are INTACT or DAMAGED")
        if not self.restock and self.condition is not None:
            raise ValueError("goods that did not come back have no condition")
        return self


class RefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Client-generated and permanent. Two requests carrying the same command_id
    # are the same refund, however far apart they arrive.
    command_id: uuid.UUID
    lines: list[RefundLinePayload] = Field(min_length=1, max_length=100)
    reason: CleanText | None = Field(default=None, max_length=1000)
    # The store taking the goods back, when it is not the one that sold.
    store_id: uuid.UUID | None = None
    # How the money goes back, one of the till's three ways. Absent from a
    # return a phone kept from before it was asked, and allowed absent for a
    # sale paid in parts whose return only lowers the debt.
    payment_method: TillMethodValue | None = None
    # «Під час збою»: typed from paper after the server did not answer
    # (owner decision, 2026-10-10; ADR-0021).
    outage: PaperMarkPayload | None = None

    def fingerprinted(self) -> dict[str, object]:
        """The body as its idempotency fingerprint reads it: what a request
        that does not use the newer fields sends, it is fingerprinted as
        before, so a retry from before them still matches."""
        body = self.model_dump(mode="json")
        if body["store_id"] is None:
            del body["store_id"]
        if body["payment_method"] is None:
            del body["payment_method"]
        if body["outage"] is None:
            del body["outage"]
        for line in body["lines"]:
            if line["location_id"] is None:
                del line["location_id"]
        return body


class RefundItemResponse(BaseModel):
    id: uuid.UUID
    sale_item_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int
    amount: Decimal
    restock: bool
    # NULL for goods that did not come back, and for returns taken before the
    # condition was asked.
    condition: str | None = None
    # Where the units went back. Derived from the sale line, never requested.
    destination_location_id: uuid.UUID | None = None
    # From the sale line's frozen snapshot, so a refund receipt reads the way
    # the original one did even after the product was renamed.
    display_name: str


class CreditSettlementResponse(BaseModel):
    """A sale paid in parts: the returned goods' worth, split (owner decision,
    2026-10-01). Hand the customer `cash_back`, not `total_amount`."""

    debt_reduced: Decimal
    cash_back: Decimal
    owed_after: Decimal


class RefundResponse(BaseModel):
    id: uuid.UUID
    sale_id: uuid.UUID
    # The store that sold.
    store_id: uuid.UUID
    # The store that took the goods back and handed the money back. Absent
    # from answers given before it was recorded, which were the same store.
    taken_at_store_id: uuid.UUID | None = None
    currency_code: str
    total_amount: Decimal
    reason: str | None = None
    items: list[RefundItemResponse]
    movements: list[uuid.UUID] = Field(
        default_factory=list,
        description="REFUND_RETURN stock movements written for the restocked lines.",
    )
    # None for a sale paid in full, whose `total_amount` goes back.
    credit: CreditSettlementResponse | None = None
    # How the money went back. None when none did (a sale paid in parts
    # whose return only lowered the debt), and on answers given before the
    # way was asked.
    payment_method: str | None = None
    # Typed from paper (ADR-0021): who took it and when, as the paper says.
    # None for a return typed live, and on answers given before the mark.
    outage: PaperMarkResponse | None = None


def _to_response(result: RefundResult) -> RefundResponse:
    return RefundResponse(
        outage=paper_response(result.outage),
        payment_method=result.refund.payment_method,
        id=result.refund.id,
        sale_id=result.refund.sale_id,
        store_id=result.refund.store_id,
        taken_at_store_id=result.refund.taken_at_store_id,
        currency_code=result.refund.currency_code,
        total_amount=result.refund.total_amount,
        reason=result.refund.reason,
        movements=result.movements,
        credit=(
            CreditSettlementResponse(
                debt_reduced=result.credit.debt_reduced,
                cash_back=result.credit.cash_back,
                owed_after=result.credit.owed_after,
            )
            if result.credit is not None
            else None
        ),
        items=[
            RefundItemResponse(
                id=line.refund_item.id,
                sale_item_id=line.refund_item.sale_item_id,
                product_variant_id=line.sale_item.product_variant_id,
                size_id=line.sale_item.size_id,
                quantity=line.refund_item.quantity,
                amount=line.refund_item.amount,
                restock=line.refund_item.restock,
                condition=line.refund_item.condition,
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
    sold_at = await sale_store_id(session, organization_id=scope.organization_id, sale_id=sale_id)
    # The store taking the goods back decides: any store of the network may
    # (owner decisions, 2026-10-01).
    store_id = payload.store_id or sold_at
    scope.require(Permission.SALE_REFUND, store_id)
    # Where restocked goods would go is a property of the sale, so it can be
    # resolved — and its access checked — before the key is claimed, keeping a
    # revoked grant from replaying a cached success (invariants I13/I23).
    lines = [
        RefundLineInput(
            sale_item_id=line.sale_item_id,
            quantity=line.quantity,
            restock=line.restock,
            condition=ReturnCondition(line.condition) if line.condition else None,
            location_id=line.location_id,
        )
        for line in payload.lines
    ]
    restock_destinations = await refund_destinations(
        session,
        organization_id=scope.organization_id,
        sale_id=sale_id,
        store_id=store_id,
        lines=lines,
    )
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.SALE_REFUND,
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
            {"sale_id": str(sale_id), **payload.fingerprinted()},
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
        lines=lines,
        reason=payload.reason,
        correlation_id=get_correlation_id(),
        at_store_id=store_id,
        payment_method=method_of(payload.payment_method),
        outage=payload.outage.mark() if payload.outage is not None else None,
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
