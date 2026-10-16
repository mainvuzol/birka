"""The sales report (owner decisions, 2026-10-02): what the stores sold and
returned, and the money through each till, for today or any days. The money
is split by the way it was paid (owner decisions, 2026-10-04; ADR-0012, B11).

The owner and managers read it (`report:view_financial`), each for the stores
they hold it in. `date_from` and `date_to` are the stores' own days; left out,
the report is today's, and a `date_from` alone is that one day. A period is
one day to a year (`PERIOD`).

- `GET /reports/sales` — each store, and the stores together when there are
  several;
- `GET /reports/sales/models` — the models sold, the most money first;
- `GET /reports/sales/entries` — every sale and return, the newest first. A
  sale typed from paper carries its mark «продано під час збою» (`outage`):
  who sold and the paper's time; `by` is whoever typed it (ADR-0013 §5.6).
  A return typed from paper carries it too, `sold_by` then naming who took
  it back (ADR-0021).

The last two read one store (`store_id`), or every store the report shows.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.deps import ScopeDep, SessionDep
from app.modules.reports import sales as report
from app.modules.sales.payment import PaymentMethod
from app.modules.tenancy.models import StoreState

router = APIRouter(prefix="/reports", tags=["reports"])


class PeriodResponse(BaseModel):
    date_from: date
    date_to: date
    today: date


class WayResponse(BaseModel):
    """One of the till's ways: «не вказано» is a row written before the way
    was asked."""

    method: Literal["CASH", "CARD", "TRANSFER", "NOT_STATED"]
    came_in: Decimal
    went_out: Decimal
    # Moved to this way by corrections made in these days, less moved from it.
    corrected: Decimal
    net: Decimal


class OffTillWayResponse(BaseModel):
    """An order's money paid off the till. Nothing is ever handed back this
    way: money goes back through the till."""

    came_in: Decimal
    corrected: Decimal
    net: Decimal


class OffTillResponse(BaseModel):
    # «Переказ наперед» and «Накладений платіж»: outside «Разом».
    prepaid_transfer: OffTillWayResponse
    carrier_cod: OffTillWayResponse


class FiguresResponse(BaseModel):
    sales: int
    units: int
    sold: Decimal
    returns: int
    returned_units: int
    returned: Decimal
    # Sold, less what came back.
    net: Decimal
    # The till's money: an order paid off the till is in none of these.
    paid_in_full: Decimal
    debt_payments: Decimal
    paid_back: Decimal
    # What corrections moved into the till from the order ways, less out.
    corrected_into_till: Decimal
    # What went through the till in these days, «Разом»: the four ways' net
    # add up to it. It was `cash` until 2026-10-04: always money through the
    # till, never only banknotes.
    money: Decimal
    # CASH, CARD, TRANSFER, NOT_STATED: always these four, in this order.
    ways: list[WayResponse]
    off_till: OffTillResponse


class StoreFiguresResponse(FiguresResponse):
    store_id: uuid.UUID
    store_name: str
    store_state: StoreState


class SalesReportResponse(PeriodResponse):
    currency_code: str
    stores: list[StoreFiguresResponse]
    # The stores together, for whoever sees more than one.
    total: FiguresResponse | None


class ModelResponse(BaseModel):
    product_variant_id: uuid.UUID
    display_name: str
    units: int
    sold: Decimal
    returned_units: int
    returned: Decimal


class ModelsResponse(PeriodResponse):
    models: list[ModelResponse]


class OutageEntryResponse(BaseModel):
    """«Продано під час збою»: who sold and when, as the paper says; each
    None when the paper named none. `first_days` is «з паперу», the first
    days' paper, with no word of an outage."""

    sold_by: str | None
    sold_at: datetime | None
    first_days: bool


class EntryResponse(BaseModel):
    kind: report.Kind
    id: uuid.UUID
    sale_id: uuid.UUID
    at: datetime
    store_id: uuid.UUID
    store_name: str
    taken_at_store_id: uuid.UUID | None
    taken_at_store_name: str | None
    by: str
    units: int
    amount: Decimal
    # The money it moved: in for a sale, out for a return.
    money: Decimal
    # As stated when the money moved; None for «не вказано», and for a return
    # that only lowered a debt.
    payment_method: PaymentMethod | None
    # The way now, when a correction changed it; None when none did.
    method_now: PaymentMethod | None
    paid_in_parts: bool
    goods: list[str]
    # A sale typed from paper; None for every other entry. `by` stays whoever
    # typed it.
    outage: OutageEntryResponse | None = None


class EntriesResponse(PeriodResponse):
    entries: list[EntryResponse]
    has_more: bool


def _off_till(sums: report.WaySums) -> OffTillWayResponse:
    return OffTillWayResponse(came_in=sums.came_in, corrected=sums.corrected, net=sums.net)


def _figures(figures: report.Figures) -> FiguresResponse:
    return FiguresResponse(
        sales=figures.sales,
        units=figures.units,
        sold=figures.sold,
        returns=figures.returns,
        returned_units=figures.returned_units,
        returned=figures.returned,
        net=figures.net,
        paid_in_full=figures.paid_in_full,
        debt_payments=figures.debt_payments,
        paid_back=figures.paid_back,
        corrected_into_till=figures.corrected_into_till,
        money=figures.money,
        ways=[
            WayResponse(
                method=name,
                came_in=figures.way(name).came_in,
                went_out=figures.way(name).went_out,
                corrected=figures.way(name).corrected,
                net=figures.way(name).net,
            )
            for name in report.TILL_WAYS
        ],
        off_till=OffTillResponse(
            prepaid_transfer=_off_till(figures.way(PaymentMethod.PREPAID_TRANSFER.value)),
            carrier_cod=_off_till(figures.way(PaymentMethod.CARRIER_COD.value)),
        ),
    )


def _period(period: report.Period) -> dict[str, Any]:
    return {"date_from": period.first, "date_to": period.last, "today": period.today}


DateFrom = Annotated[date | None, Query()]
DateTo = Annotated[date | None, Query()]


@router.get("/sales", response_model=SalesReportResponse)
async def sales_report(
    scope: ScopeDep,
    session: SessionDep,
    date_from: DateFrom = None,
    date_to: DateTo = None,
) -> SalesReportResponse:
    """Each store this person reads the report for, and the stores together
    when there are several."""
    view = await report.sales_report(session, scope=scope, first=date_from, last=date_to)
    return SalesReportResponse(
        **_period(view.period),
        currency_code=view.currency_code,
        stores=[
            StoreFiguresResponse(
                store_id=store.store_id,
                store_name=store.store_name,
                store_state=store.store_state,
                **_figures(store.figures).model_dump(),
            )
            for store in view.stores
        ],
        total=None if view.total is None else _figures(view.total),
    )


@router.get("/sales/models", response_model=ModelsResponse)
async def models_sold(
    scope: ScopeDep,
    session: SessionDep,
    store_id: uuid.UUID | None = None,
    date_from: DateFrom = None,
    date_to: DateTo = None,
) -> ModelsResponse:
    period, models = await report.models_sold(
        session, scope=scope, store_id=store_id, first=date_from, last=date_to
    )
    return ModelsResponse(
        **_period(period),
        models=[
            ModelResponse(
                product_variant_id=model.product_variant_id,
                display_name=model.display_name,
                units=model.units,
                sold=model.sold,
                returned_units=model.returned_units,
                returned=model.returned,
            )
            for model in models
        ],
    )


@router.get("/sales/entries", response_model=EntriesResponse)
async def sales_entries(
    scope: ScopeDep,
    session: SessionDep,
    store_id: uuid.UUID | None = None,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> EntriesResponse:
    period, views, has_more = await report.entries(
        session,
        scope=scope,
        store_id=store_id,
        first=date_from,
        last=date_to,
        limit=limit,
        offset=offset,
    )
    return EntriesResponse(
        **_period(period),
        entries=[
            EntryResponse(
                kind=view.kind,
                id=view.id,
                sale_id=view.sale_id,
                at=view.at,
                store_id=view.store_id,
                store_name=view.store_name,
                taken_at_store_id=view.taken_at_store_id,
                taken_at_store_name=view.taken_at_store_name,
                by=view.by,
                units=view.units,
                amount=view.amount,
                money=view.money,
                payment_method=view.payment_method,
                method_now=view.method_now,
                paid_in_parts=view.paid_in_parts,
                goods=view.goods,
                outage=(
                    OutageEntryResponse(
                        sold_by=view.outage.sold_by,
                        sold_at=view.outage.sold_at,
                        first_days=view.outage.first_days,
                    )
                    if view.outage is not None
                    else None
                ),
            )
            for view in views
        ],
        has_more=has_more,
    )


__all__ = ["router"]
