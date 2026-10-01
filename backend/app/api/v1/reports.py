"""The sales report (owner decisions, 2026-10-02): what the stores sold and
returned, and the money through each till, for today or any days.

The owner and managers read it (`report:view_financial`), each for the stores
they hold it in. `date_from` and `date_to` are the stores' own days; left out,
the report is today's, and a `date_from` alone is that one day. A period is
one day to a year (`PERIOD`).

- `GET /reports/sales` — each store, and the stores together when there are
  several;
- `GET /reports/sales/models` — the models sold, the most money first;
- `GET /reports/sales/entries` — every sale and return, the newest first.

The last two read one store (`store_id`), or every store the report shows.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.deps import ScopeDep, SessionDep
from app.modules.reports import sales as report
from app.modules.tenancy.models import StoreState

router = APIRouter(prefix="/reports", tags=["reports"])


class PeriodResponse(BaseModel):
    date_from: date
    date_to: date
    today: date


class FiguresResponse(BaseModel):
    sales: int
    units: int
    sold: Decimal
    returns: int
    returned_units: int
    returned: Decimal
    # Sold, less what came back.
    net: Decimal
    paid_in_full: Decimal
    debt_payments: Decimal
    paid_back: Decimal
    # What the till should hold from these days.
    cash: Decimal


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
    # Into the till for a sale, out of it for a return.
    cash: Decimal
    paid_in_parts: bool
    goods: list[str]


class EntriesResponse(PeriodResponse):
    entries: list[EntryResponse]
    has_more: bool


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
        cash=figures.cash,
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
                cash=view.cash,
                paid_in_parts=view.paid_in_parts,
                goods=view.goods,
            )
            for view in views
        ],
        has_more=has_more,
    )


__all__ = ["router"]
