"""Sale endpoints.

`POST /sales` is the hot path — the thing a seller does hundreds of times a
shift. It carries two identifiers with different jobs:

* `Idempotency-Key` (header) — "give me the same answer" for 7 days;
* `command_id` (body) — "this is the same business operation", forever.

A corrected sale (`found_in_store`, `missing_in_store`, `size_clarified`) is a
*different* payload from the rejected one, and should carry a **new**
Idempotency-Key, so that one key always answers one payload and a later replay
of it is unambiguous.

Reusing the rejected key is not itself an error, though: the refusal rolled its
claim back with the rest of the transaction, so the key is free again. Nothing
is sold twice either way — `command_id` is permanent (I20), so the corrected
attempt is recognised as the same sale and replayed rather than repeated. Only
a key whose attempt *succeeded* returns `IDEMPOTENCY_CONFLICT` when a different
payload arrives under it. See `tests/integration/test_sale_retry_contract.py`.

`payment_method` is the button that sold: «Готівка», «Картка» or «Переказ»
(owner decisions, 2026-10-04). Optional here, because a body the schema
refused would never reach the replay below, and a sale a phone kept from
before the way was asked would be stuck for good, sold; the service requires
it of a new sale instead (ADR-0012, B13). Only the seller who sold, and the
owner and managers, read it back (`GET /sales/{id}`); the list of the
store's sales never carries it (ADR-0012, G32).

`outage` marks a sale typed from paper after the server did not answer:
«продано під час збою», with who sold and the paper's time, each optional
(owner decisions, 2026-10-04 and 2026-10-07; ADR-0013 §5). Only its shape is
checked here. Who may be named, and which day the time may be, are checked by
the service after the replay lookup: a refusal here, before it, would answer a
marked sale recorded and resent days later with a 422 that says nothing of
what was recorded, and leave that phone blocked for good (ADR-0013 §5.2). The
receipt, the sale read back and the store's list of sales all show the mark;
it carries no sum or way, so the blind count is untouched.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, NamedTuple

from fastapi import APIRouter, Header, Query, Response, status
from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ScopeDep, SessionDep, SettingsDep
from app.core import idempotency
from app.core.correlation import get_correlation_id
from app.core.errors import NotFoundError, ValidationFailedError
from app.core.text import CleanText
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.cash.current import sale_methods
from app.modules.cash.sold_today import sold_today
from app.modules.catalog.read import size_labels
from app.modules.credit import service as credit_service
from app.modules.refunds.service import refunded_quantities
from app.modules.sales.models import Sale, SaleItem, ShelfShortage
from app.modules.sales.outage import (
    MarkView,
    OutageMark,
    PaperMark,
    PaperView,
    marks_of,
    paper_time,
)
from app.modules.sales.payment import PaymentMethod
from app.modules.sales.read import MAX_QUERY, list_sales, way_shown_to
from app.modules.sales.service import (
    FoundInStore,
    MissingInStore,
    SaleLineInput,
    SizeClarified,
    correction_ids,
    create_sale,
    reclassification_ids,
    shortage_ids,
    units_of,
)
from app.modules.sales.shelf import ShelfLine, read_empty_shelf, report_empty_shelf
from app.modules.tenancy.service import LocationCapability, back_on_sale_locations, store_names

router = APIRouter(tags=["sales"])

SALES_ENDPOINT = "POST /sales"

# The till's three ways (`payment.TILL_METHODS`): a sale, a payment toward a
# debt, money handed back. And all five, which «Клієнт забрав» takes
# (`payment.ORDER_METHODS`).
TillMethodValue = Literal["CASH", "CARD", "TRANSFER"]
MethodValue = Literal["CASH", "CARD", "TRANSFER", "PREPAID_TRANSFER", "CARRIER_COD"]


def method_of(value: str | None) -> PaymentMethod | None:
    """A request's way, as the services take it."""
    return PaymentMethod(value) if value is not None else None


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
    the shelf with reason `MISSING_AT_SALE`. Zero drops the line from the sale
    (owner decision, 2026-10-01; Q-G); a basket left with nothing to sell is
    refused as `NOTHING_TO_SELL`, and `POST /shelf-shortages` records it.
    """

    line_index: int = Field(ge=0)
    quantity: int = Field(ge=0, le=1000)


class SizeClarifiedPayload(BaseModel):
    """The seller reading the size of goods held with their size not known (F34).

    `quantity` of the units the line sells come out of the size-not-known
    balance of the same model at the line's warehouse, and become the line's
    size first: an audited pair of movements. It must be exactly the line's
    shortfall at that size (owner decision, 2026-09-29).
    """

    line_index: int = Field(ge=0)
    quantity: int = Field(gt=0, le=1000)


class CreditPayload(BaseModel):
    """The customer pays in parts (owner decisions, 2026-10-01): takes the
    goods now, pays `paid_now` — above nothing, below the total — and owes the
    rest to this store."""

    model_config = ConfigDict(extra="forbid")

    customer_name: CleanText = Field(min_length=1, max_length=200)
    customer_phone: CleanText = Field(min_length=1, max_length=40)
    paid_now: Decimal = Field(gt=0, max_digits=12, decimal_places=2)


def _paper_time(written: str) -> str:
    """Kept exactly as written: the sale's prints carry the literal."""
    paper_time(written)
    return written


# The store's wall clock as the paper says, to the minute: "2026-10-06T19:40".
PaperTime = Annotated[str, Field(min_length=16, max_length=16), AfterValidator(_paper_time)]


class OutageMarkPayload(BaseModel):
    """«Продано під час збою»: a sale typed from paper (ADR-0013 §5.2). `{}`
    marks it with nobody and no time named. With `first_days`, «з паперу»:
    the first days' paper, typed once the warehouse's opening list is
    approved, with no word of an outage (owner decisions, 2026-10-15 and
    2026-10-16; ADR-0013 §5.8).

    Only the shape: a real date and time, written `YYYY-MM-DDTHH:MM`. Whether
    the person may be named, and whether the time is recent enough, is
    decided after the replay lookup, never here."""

    model_config = ConfigDict(extra="forbid")

    # Who sold, as the paper says: one of the store's people.
    sold_by_user_id: uuid.UUID | None = None
    # The paper's time, the store's own wall clock with no offset; the phone
    # fills in the day: today or yesterday, or the first days' paper's.
    sold_at: PaperTime | None = None
    # The first days' paper, not an outage's.
    first_days: bool = False


class PaperMarkPayload(BaseModel):
    """«Під час збою» on a return or a debt payment typed from paper (owner
    decision, 2026-10-10; ADR-0021): who took it and the paper's time, as a
    sale's mark says who sold. `{}` marks it with nobody and no time named.
    Only the shape here; the rest is decided after the replay lookup."""

    model_config = ConfigDict(extra="forbid")

    # Who took it, as the paper says: one who may take it in the store
    # taking it.
    by_user_id: uuid.UUID | None = None
    # The paper's time, that store's wall clock with no offset.
    at: PaperTime | None = None
    # The first days' paper, «з паперу», not an outage's (owner decision,
    # 2026-10-16).
    first_days: bool = False

    def mark(self) -> PaperMark:
        return PaperMark(by_user_id=self.by_user_id, at=self.at, first_days=self.first_days)


def printed_mark(body: dict[str, object]) -> None:
    """A body's mark as its 7-day print reads it: an outage's exactly as
    before the first days' paper existed, so an attempt kept from then still
    matches what the cache stored; the first days' paper says so."""
    mark = body.get("outage")
    if isinstance(mark, dict) and not mark.get("first_days"):
        mark.pop("first_days", None)


class PaperMarkResponse(BaseModel):
    """A return's or a payment's mark (ADR-0021): who took it as the paper
    says, by name too, and the paper's time; each None when the paper named
    none. Who typed it is the entry's own `by`. `first_days` is «з паперу»,
    the first days' paper; false in answers stored before it existed."""

    by_user_id: uuid.UUID | None
    by: str | None
    at: datetime | None
    first_days: bool = False


def paper_response(view: PaperView | None) -> PaperMarkResponse | None:
    if view is None:
        return None
    return PaperMarkResponse(
        by_user_id=view.by_user_id, by=view.by, at=view.at, first_days=view.first_days
    )


class SaleRequest(BaseModel):
    # Every field a client ever sent is known (`sales/commands.ts`), so an
    # unknown one is a client mistake, refused rather than dropped, as the
    # payment, refund and order requests do (ADR-0012, B13).
    model_config = ConfigDict(extra="forbid")

    store_id: uuid.UUID
    # Client-generated and permanent. Two requests carrying the same command_id
    # are the same sale, however far apart they arrive.
    command_id: uuid.UUID
    lines: list[SaleLinePayload] = Field(min_length=1, max_length=100)
    found_in_store: list[FoundInStorePayload] = Field(default_factory=list, max_length=100)
    missing_in_store: list[MissingInStorePayload] = Field(default_factory=list, max_length=100)
    size_clarified: list[SizeClarifiedPayload] = Field(default_factory=list, max_length=100)
    # Present only when the customer pays in parts.
    credit: CreditPayload | None = None
    # How the customer pays: the button that sold. Paid in parts, the way of
    # the money taken now — beside `credit`, not inside it. Absent only from
    # a sale a phone kept from before it was asked.
    payment_method: TillMethodValue | None = None
    # Present only on a sale typed from paper (ADR-0013 §5).
    outage: OutageMarkPayload | None = None

    def fingerprinted(self) -> dict[str, object]:
        """The body as its 7-day print reads it: a request without a way is
        printed exactly as before ways existed, so an attempt kept from then
        still matches what the cache stored (ADR-0012, B13). The same for a
        sale without the mark, which every sale was before it existed
        (ADR-0013 §5.2)."""
        body = self.model_dump(mode="json")
        if body["payment_method"] is None:
            del body["payment_method"]
        if body["outage"] is None:
            del body["outage"]
        printed_mark(body)
        return body

    def mark(self) -> OutageMark | None:
        """The mark, as the service takes it."""
        if self.outage is None:
            return None
        return OutageMark(
            sold_by_user_id=self.outage.sold_by_user_id,
            sold_at=self.outage.sold_at,
            first_days=self.outage.first_days,
        )


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
    # The size as the receipt froze it, «UNKNOWN» for a size not known
    # (redesign P1-1). Null in answers stored before it was given.
    size: str | None = None


class SaleClarifiedResponse(BaseModel):
    """Coats sold with the size read off their label, out of "size not known"."""

    size: str
    quantity: int


class SaleCreditResponse(BaseModel):
    """What a sale paid in parts left owing. No name or phone: a receipt is
    read more widely than the store's debts are."""

    credit_id: uuid.UUID
    paid_now: Decimal
    owed: Decimal


class OutageMarkResponse(BaseModel):
    """«Продано під час збою» (ADR-0013 §5.6): who sold as the paper says, by
    name too, and the paper's time; each None when the paper named none. Who
    typed it is whoever sold it here, as for any sale. `first_days` is
    «з паперу», the first days' paper (§5.8); false in answers stored before
    it existed."""

    sold_by_user_id: uuid.UUID | None
    sold_by: str | None
    sold_at: datetime | None
    first_days: bool = False


def _outage(view: MarkView | None) -> OutageMarkResponse | None:
    if view is None:
        return None
    return OutageMarkResponse(
        sold_by_user_id=view.sold_by_user_id,
        sold_by=view.sold_by,
        sold_at=view.sold_at,
        first_days=view.first_days,
    )


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
    size_reclassifications: list[uuid.UUID] = Field(
        default_factory=list,
        description=(
            "Both stock movements of every size the seller clarified: out of size not known, "
            "into the size sold."
        ),
    )
    credit: SaleCreditResponse | None = None
    # The movements above, in units, for the receipt (redesign P1-1): found on
    # the shelf and added, missing and written off, sold with a size read off
    # a label. Counted from the ledger; null in answers stored before.
    found_quantity: int | None = None
    missing_quantity: int | None = None
    clarified: list[SaleClarifiedResponse] | None = None
    # The way the seller pressed, in the answer to the command and its stored
    # snapshot. Absent from answers given before it was asked; on a read,
    # only for whoever sold it and the owner and managers (ADR-0012, G32).
    payment_method: str | None = None
    # The mark of a sale typed from paper, frozen in the stored answer with
    # the rest; None for every other sale, and in answers given before it
    # existed.
    outage: OutageMarkResponse | None = None


class ReceiptUnits(NamedTuple):
    found: int
    missing: int
    clarified: list[SaleClarifiedResponse]


async def _units(session: AsyncSession, sale: Sale) -> ReceiptUnits:
    """The receipt's units, from the movements the sale wrote."""
    units = await units_of(session, sale)
    # Most sales clarify nothing: no second query for them.
    labels = await size_labels(session, list(units.clarified)) if units.clarified else {}
    return ReceiptUnits(
        found=units.found,
        missing=units.missing,
        clarified=[
            SaleClarifiedResponse(size=labels[size_id], quantity=quantity)
            for size_id, quantity in sorted(
                units.clarified.items(), key=lambda pair: (labels[pair[0]], str(pair[0]))
            )
        ],
    )


def _to_response(
    sale: Sale,
    items: list[SaleItem],
    corrections: list[uuid.UUID],
    shortages: list[uuid.UUID],
    reclassifications: list[uuid.UUID],
    credit: credit_service.CreditView | None = None,
    outage: MarkView | None = None,
    units: ReceiptUnits | None = None,
) -> SaleResponse:
    return SaleResponse(
        found_quantity=units.found if units else None,
        missing_quantity=units.missing if units else None,
        clarified=units.clarified if units else None,
        outage=_outage(outage),
        payment_method=sale.payment_method,
        credit=(
            SaleCreditResponse(credit_id=credit.id, paid_now=credit.paid, owed=credit.owed)
            if credit is not None
            else None
        ),
        id=sale.id,
        store_id=sale.store_id,
        currency_code=sale.currency_code,
        subtotal=sale.subtotal,
        discount_total=sale.discount_total,
        total=sale.total,
        corrections=corrections,
        shortages=shortages,
        size_reclassifications=reclassifications,
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
                size=item.variant_snapshot.get("size"),
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
    if payload.found_in_store or payload.size_clarified:
        scope.require(Permission.INVENTORY_CORRECT_DURING_SALE, payload.store_id)
    if payload.missing_in_store:
        scope.require(Permission.INVENTORY_REPORT_MISSING_DURING_SALE, payload.store_id)
    credit = (
        credit_service.terms(
            customer_name=payload.credit.customer_name,
            customer_phone=payload.credit.customer_phone,
            paid_now=payload.credit.paid_now,
        )
        if payload.credit is not None
        else None
    )
    if credit is not None:
        scope.require(Permission.SALE_CREDIT, payload.store_id)
    # Invariant I23, and it belongs here rather than only in the service: the
    # service runs *after* the replay branch below, so a store whose warehouse
    # access was revoked would keep being handed its cached success.
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.SALE_CREATE,
        store_id=payload.store_id,
        location_ids={line.source_location_id for line in payload.lines},
        capability=LocationCapability.SELL,
    )
    for reports, permission in (
        (payload.found_in_store, Permission.INVENTORY_CORRECT_DURING_SALE),
        (payload.missing_in_store, Permission.INVENTORY_REPORT_MISSING_DURING_SALE),
        (payload.size_clarified, Permission.INVENTORY_CORRECT_DURING_SALE),
    ):
        if reports:
            await require_stock_access(
                session,
                scope=scope,
                store_id=payload.store_id,
                permission=permission,
                location_ids={
                    payload.lines[report.line_index].source_location_id
                    for report in reports
                    if 0 <= report.line_index < len(payload.lines)
                },
                capability=LocationCapability.SELL,
            )
    outcome = await idempotency.claim(
        session,
        organization_id=scope.organization_id,
        endpoint=SALES_ENDPOINT,
        key=idempotency_key,
        request_fingerprint=idempotency.fingerprint(
            payload.fingerprinted(),
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
        size_clarified=[
            SizeClarified(line_index=clarified.line_index, quantity=clarified.quantity)
            for clarified in payload.size_clarified
        ],
        credit_terms=credit_service.fingerprint_of(credit) if credit is not None else None,
        correlation_id=get_correlation_id(),
        payment_method=method_of(payload.payment_method),
        outage=payload.mark(),
    )
    opened = (
        await credit_service.open_credit(
            session,
            scope=scope,
            sale=result.sale,
            credit=credit,
            # The money taken now: its first payment holds the sale's way.
            payment_method=method_of(payload.payment_method),
            correlation_id=get_correlation_id(),
        )
        if credit is not None
        else None
    )

    body = (
        SaleResponse.model_validate(result.sale.response_snapshot)
        if result.sale.response_snapshot is not None
        else _to_response(
            result.sale,
            result.items,
            result.corrections,
            result.shortages,
            result.reclassifications,
            opened,
            # No query for an ordinary sale: it carries no mark.
            (await marks_of(session, [result.sale])).get(result.sale.id),
            await _units(session, result.sale),
        )
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


class EmptyShelfLinePayload(BaseModel):
    source_location_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    # How many the seller went for, and found none of.
    quantity: int = Field(gt=0, le=1000)


class EmptyShelfRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    store_id: uuid.UUID
    # The basket's own command_id — the one its sale attempts carried. A basket
    # becomes a sale or an empty shelf, never both.
    command_id: uuid.UUID
    lines: list[EmptyShelfLinePayload] = Field(min_length=1, max_length=100)


class EmptyShelfLineResponse(BaseModel):
    source_location_id: uuid.UUID
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    display_name: str
    size: str | None
    requested: int
    # Taken off the ledger: what it believed in of `requested`, and no more.
    removed: int


class EmptyShelfResponse(BaseModel):
    id: uuid.UUID
    store_id: uuid.UUID
    command_id: uuid.UUID
    recorded_at: datetime
    lines: list[EmptyShelfLineResponse]


def _empty_shelf(shortage: ShelfShortage) -> EmptyShelfResponse:
    return EmptyShelfResponse(
        id=shortage.id,
        store_id=shortage.store_id,
        command_id=shortage.command_id,
        recorded_at=shortage.created_at,
        lines=[EmptyShelfLineResponse.model_validate(line) for line in shortage.lines],
    )


@router.post(
    "/shelf-shortages", response_model=EmptyShelfResponse, status_code=status.HTTP_201_CREATED
)
async def record_empty_shelf(
    payload: EmptyShelfRequest, scope: ScopeDep, session: SessionDep
) -> EmptyShelfResponse:
    """Nothing in the basket was on the shelf: no sale, and the shortage
    recorded (owner decision, 2026-10-01; Q-G).

    No Idempotency-Key: the basket's `command_id` is permanent, and a retry is
    answered with what was recorded.
    """
    shortage = await report_empty_shelf(
        session,
        scope=scope,
        store_id=payload.store_id,
        command_id=payload.command_id,
        lines=[
            ShelfLine(
                source_location_id=line.source_location_id,
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity=line.quantity,
            )
            for line in payload.lines
        ],
        correlation_id=get_correlation_id(),
    )
    body = _empty_shelf(shortage)
    await session.commit()
    return body


@router.get("/shelf-shortages/{shortage_id}", response_model=EmptyShelfResponse)
async def read_empty_shelf_record(
    shortage_id: uuid.UUID, scope: ScopeDep, session: SessionDep
) -> EmptyShelfResponse:
    return _empty_shelf(await read_empty_shelf(session, scope=scope, shortage_id=shortage_id))


class SaleLineSummary(BaseModel):
    id: uuid.UUID
    display_name: str
    # The size as the receipt recorded it; "UNKNOWN" for goods sold with
    # their size not known.
    size: str | None
    source_location_id: uuid.UUID
    quantity: int
    final_unit_price: Decimal
    line_total: Decimal
    # Already come back, in every part and condition.
    refunded: int
    # Whether intact goods taken back at the asking store go back to the
    # warehouse they were sold from. When not — another store's own warehouse
    # — the seller chooses one of the asking store's (owner decision,
    # 2026-10-01).
    back_to_sold_from: bool = True


class SaleSummary(BaseModel):
    id: uuid.UUID
    # The store that sold it, which a sale found among other stores' differs
    # from the store asking.
    store_id: uuid.UUID
    store_name: str
    sold_at: datetime
    currency_code: str
    total: Decimal
    # A return of a sale paid in parts lowers its debt first; the refund's
    # answer says how much goes back in cash.
    paid_in_parts: bool
    items: list[SaleLineSummary]
    # «Продано під час збою», for a sale typed from paper (ADR-0013 §5.6).
    outage: OutageMarkResponse | None = None


class SaleListResponse(BaseModel):
    sales: list[SaleSummary]
    has_more: bool


@router.get("/sales", response_model=SaleListResponse)
async def list_store_sales(
    scope: ScopeDep,
    session: SessionDep,
    store_id: Annotated[uuid.UUID, Query()],
    q: Annotated[CleanText | None, Query(max_length=MAX_QUERY)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    elsewhere: bool = False,
) -> SaleListResponse:
    """The store's sales, newest first — where a seller finds the sale a
    customer is returning (owner decision, 2026-10-01).

    `elsewhere=true` searches the other stores' sales instead, for a return
    taken here of goods bought there: any store of the network may take them
    back (owner decisions, 2026-10-01). Only whoever takes returns here may,
    and only by a search — the other stores' sales are found, never browsed.
    """
    scope.require(Permission.SALE_VIEW, store_id)
    if elsewhere:
        scope.require(Permission.SALE_REFUND, store_id)
        # A word of two letters at least: «о о» browses as «о» would
        # (owner decision, 2026-10-18).
        if not any(len(word) >= 2 for word in (q or "").split()):
            raise ValidationFailedError(
                "Another store's sale is found by searching for its goods",
                reason="SEARCH_REQUIRED",
            )
    page = await list_sales(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        query=q,
        limit=limit,
        offset=offset,
        elsewhere=elsewhere,
    )
    refunded = await refunded_quantities(
        session, sale_item_ids=[item.id for items in page.items.values() for item in items]
    )
    names = await store_names(
        session,
        organization_id=scope.organization_id,
        store_ids={sale.store_id for sale in page.sales},
    )
    reached = (
        await back_on_sale_locations(
            session, organization_id=scope.organization_id, store_id=store_id
        )
        if elsewhere
        else None
    )
    paid_in_parts = await credit_service.credited_sales(
        session, sale_ids=[sale.id for sale in page.sales]
    )
    marks = await marks_of(session, page.sales)
    return SaleListResponse(
        has_more=page.has_more,
        sales=[
            SaleSummary(
                id=sale.id,
                store_id=sale.store_id,
                store_name=names.get(sale.store_id, ""),
                sold_at=sale.sold_at,
                currency_code=sale.currency_code,
                total=sale.total,
                paid_in_parts=sale.id in paid_in_parts,
                outage=_outage(marks.get(sale.id)),
                items=[
                    SaleLineSummary(
                        id=item.id,
                        display_name=item.display_name_snapshot,
                        size=item.variant_snapshot.get("size"),
                        source_location_id=item.source_location_id,
                        quantity=item.quantity,
                        final_unit_price=item.final_unit_price,
                        line_total=item.line_total,
                        refunded=refunded.get(item.id, 0),
                        back_to_sold_from=reached is None or item.source_location_id in reached,
                    )
                    for item in page.items[sale.id]
                ],
            )
            for sale in page.sales
        ],
    )


class SoldTodayResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    business_day: date
    units: int


@router.get("/sales/sold-today", response_model=SoldTodayResponse)
async def read_sold_today(
    scope: ScopeDep,
    session: SessionDep,
    store_id: Annotated[uuid.UUID, Query()],
) -> SoldTodayResponse:
    """«Сьогодні ви продали N шт.» on the till's receipt: the caller's own
    units sold today in this store, less those returned, and nothing else —
    no sum, no way, nobody else's (owner decisions, 2026-10-16, В8, and
    2026-10-17; `cash.sold_today`). Declared before `/sales/{sale_id}`,
    which would take its path for a sale's id."""
    scope.require(Permission.SALE_CREATE, store_id)
    figure = await sold_today(session, scope=scope, store_id=store_id)
    return SoldTodayResponse(business_day=figure.business_day, units=figure.units)


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
        body = SaleResponse.model_validate(sale.response_snapshot)
    else:
        items = (
            (await session.execute(select(SaleItem).where(SaleItem.sale_id == sale.id)))
            .scalars()
            .all()
        )
        body = _to_response(
            sale,
            list(items),
            await correction_ids(session, sale),
            await shortage_ids(session, sale),
            await reclassification_ids(session, sale),
            outage=(await marks_of(session, [sale])).get(sale.id),
            units=await _units(session, sale),
        )
    # Every holder of `sale:view` reads any of the store's sales, a seller
    # counting the drawer blind among them: the way only for whoever sold it
    # and the owner and managers, and then as it stands after corrections
    # (ADR-0012, G32).
    method: PaymentMethod | None = None
    if way_shown_to(scope, store_id=sale.store_id, seller_user_id=sale.seller_user_id):
        methods = await sale_methods(session, [sale.id])
        if sale.id in methods:
            method = methods[sale.id].taken_with_sale.method
    return body.model_copy(update={"payment_method": method.value if method else None})


__all__ = [
    "MethodValue",
    "PaperMarkPayload",
    "PaperMarkResponse",
    "TillMethodValue",
    "method_of",
    "paper_response",
    "printed_mark",
    "router",
]
