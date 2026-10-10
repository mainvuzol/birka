"""The sales report: what was sold and returned, and the money that went
through each till.

The owner decided on 2026-10-02 (business-rules.md, "the sales report"):

- the owner and managers see it (`report:view_financial`), each for the
  stores they hold it in;
- for today, or any day or days. A day is the store's own;
- what was sold and returned, and the money through the till;
- each store on its own, and the stores together for whoever sees several;
- a return counts on the day it was taken, never back on the day of its sale;
- a sale and its returns are the store's that sold. Money is the store's
  whose till it went through: a return taken at another store, or a debt paid
  there, is that store's money;
- what is paid to suppliers is not the till's;
- the models sold, and every sale and return of those days.

"One sum of money" was replaced on 2026-10-04 (business-rules.md, "cash and
card, the day's close"; ADR-0012, B11): the money is split by the way it was
paid — cash, card, transfer — and an order's says how it was paid at «Клієнт
забрав»; only what was paid at the counter went through the till.

**Money through the till** (`money`, «Разом») is:
- a sale paid in full, its total;
- a sale paid in parts, what was paid then, and every later payment, at the
  store that took it;
- less what a return handed back. A return of a sale paid in parts first
  lowered what was owed, so only its `cash_back` left the till;
- each of these only when it was paid at the counter: by cash, card or
  transfer, or «не вказано» on a row written before the way was asked. An
  order paid in advance by transfer, or by cash on delivery through the
  carrier, never went through the till: it has its own lines, outside
  «Разом» (owner decisions, 2026-10-04; ADR-0012, G24);
- plus what corrections moved into the till from those two ways, or out of
  it to them (`corrected_into_till`).

**A correction of the way counts on the day it is made**, at the drawer of
the money it corrects, as its own figure (`corrected`): never back on the day
of the sale, so a past day never changes (owner decisions, 2026-10-04: "a
correction dated the day it is made"; a return counts on its day the same
way). Each way's `net` is what came in, less what went out, plus what
corrections moved to it; the till's four add up to `money`.

Cash taken out of the drawer or put into it is not here: it is the drawer's,
in «Каса» (ADR-0012, G24).

A sale typed from paper (owner decisions, 2026-10-04 and 2026-10-07;
ADR-0013 §5.6) counts on the day it was typed, like any sale: its entry says
«продано під час збою», who sold and the paper's time, as the paper says, and
`by` stays whoever typed it. The mark changes no figure. A return typed from
paper carries it too (owner decision, 2026-10-10; ADR-0021): who took it
back and the paper's time.

Nothing here is stored, so it never disagrees with what it sums.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from enum import StrEnum
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, and_, func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.errors import ValidationFailedError
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.cash.current import CurrentMethod, refund_methods, sale_methods
from app.modules.cash.models import Direction, PaymentCorrection
from app.modules.catalog.read import current_variants, describe_variants
from app.modules.credit.models import CreditEntry, CustomerCredit, EntryKind
from app.modules.identity.models import AppUser
from app.modules.refunds.models import Refund, RefundItem
from app.modules.sales.models import Sale, SaleItem, SaleStatus
from app.modules.sales.payment import PaymentMethod
from app.modules.tenancy.models import Organization, Store, StoreState
from app.modules.tenancy.service import store_names

# The longest period asked at once: a year, leap day included.
MAX_DAYS = 366
ZERO = Decimal("0.00")
CENT = Decimal("0.01")
# Where a network has no store yet to say which day it is.
DEFAULT_ZONE = "Europe/Kyiv"

# «Не вказано»: a money row written before the way was asked (revision 0035).
# It is never guessed (owner decisions, 2026-10-04), and it went through the
# till, as everything did before orders said how they were paid.
NOT_STATED = "NOT_STATED"
# The till's ways, in the order the report shows them (ADR-0012, B11).
TILL_WAYS: tuple[str, ...] = (
    PaymentMethod.CASH.value,
    PaymentMethod.CARD.value,
    PaymentMethod.TRANSFER.value,
    NOT_STATED,
)
# An order paid in advance by transfer, or by cash on delivery through the
# carrier: it never went through the till, so it stays outside «Разом».
OFF_TILL_WAYS: tuple[str, ...] = (
    PaymentMethod.PREPAID_TRANSFER.value,
    PaymentMethod.CARRIER_COD.value,
)


def _money(value: Any) -> Decimal:
    """A sum as money: two places, nothing summed being 0.00."""
    return Decimal(value or 0).quantize(CENT)


def _way(stated: str | None) -> str:
    """A way as the report names it: «не вказано» for none."""
    return NOT_STATED if stated is None else stated


@dataclass(frozen=True, slots=True)
class Period:
    first: date
    last: date
    # Today, where the stores are.
    today: date


@dataclass(frozen=True, slots=True)
class WaySums:
    """The money of one way of paying in these days."""

    # Sales paid in full, and payments towards a debt.
    came_in: Decimal = ZERO
    # What returns handed back this way.
    went_out: Decimal = ZERO
    # What corrections made in these days moved to this way, less what they
    # moved from it.
    corrected: Decimal = ZERO

    @property
    def net(self) -> Decimal:
        return self.came_in - self.went_out + self.corrected

    def __add__(self, other: WaySums) -> WaySums:
        return WaySums(
            came_in=self.came_in + other.came_in,
            went_out=self.went_out + other.went_out,
            corrected=self.corrected + other.corrected,
        )


@dataclass(frozen=True, slots=True)
class Figures:
    # Sales made, the units in them, and what they were sold for: every sale,
    # an order collected included, however it was paid.
    sales: int = 0
    units: int = 0
    sold: Decimal = ZERO
    # Returns taken of this store's sales, and what the goods were worth.
    returns: int = 0
    returned_units: int = 0
    returned: Decimal = ZERO
    # Money into the till: sales paid in full, and payments towards a debt —
    # the first, made with the sale, and every later one. An order paid off
    # the till is in neither.
    paid_in_full: Decimal = ZERO
    debt_payments: Decimal = ZERO
    # Money out of the till: what returns taken here handed back.
    paid_back: Decimal = ZERO
    # Each way's money, by `PaymentMethod` value or `NOT_STATED`; a way
    # missing had none.
    ways: Mapping[str, WaySums] = field(default_factory=dict)

    @property
    def net(self) -> Decimal:
        """Sold, less what came back."""
        return self.sold - self.returned

    def way(self, name: str) -> WaySums:
        return self.ways.get(name, WaySums())

    @property
    def corrected_into_till(self) -> Decimal:
        """What corrections moved into the till from the order ways paid off
        it, less what they moved out to them. Between two of the till's own
        ways a correction moves nothing in or out."""
        return sum((self.way(name).corrected for name in TILL_WAYS), ZERO)

    @property
    def money(self) -> Decimal:
        """What went through the till in these days, by any of its ways:
        «Разом». The till's four ways add up to it."""
        return self.paid_in_full + self.debt_payments - self.paid_back + self.corrected_into_till

    def __add__(self, other: Figures) -> Figures:
        return Figures(
            sales=self.sales + other.sales,
            units=self.units + other.units,
            sold=self.sold + other.sold,
            returns=self.returns + other.returns,
            returned_units=self.returned_units + other.returned_units,
            returned=self.returned + other.returned,
            paid_in_full=self.paid_in_full + other.paid_in_full,
            debt_payments=self.debt_payments + other.debt_payments,
            paid_back=self.paid_back + other.paid_back,
            ways={
                name: self.way(name) + other.way(name)
                for name in (*TILL_WAYS, *OFF_TILL_WAYS)
                if name in self.ways or name in other.ways
            },
        )


@dataclass(frozen=True, slots=True)
class StoreFigures:
    store_id: uuid.UUID
    store_name: str
    store_state: StoreState
    figures: Figures


@dataclass(frozen=True, slots=True)
class SalesReport:
    period: Period
    currency_code: str
    stores: list[StoreFigures]
    # The stores together, for whoever sees more than one.
    total: Figures | None


@dataclass(frozen=True, slots=True)
class ModelFigures:
    product_variant_id: uuid.UUID
    # The model's name now: a model merged since is counted with, and named
    # as, the model that stays (owner decision, 2026-10-03).
    display_name: str
    units: int
    sold: Decimal
    returned_units: int
    returned: Decimal


class Kind(StrEnum):
    SALE = "SALE"
    RETURN = "RETURN"


@dataclass(frozen=True, slots=True)
class OutageView:
    """«Продано під час збою»: a sale typed from paper (ADR-0013 §5.6). Who
    sold and when, as the paper says; each None when the paper named none.
    A return typed from paper carries it too (owner decision, 2026-10-10;
    ADR-0021): `sold_by` is then who took it back, as `by` is who typed it."""

    sold_by: str | None
    sold_at: datetime | None


@dataclass(frozen=True, slots=True)
class EntryView:
    kind: Kind
    # The sale's id, or the return's.
    id: uuid.UUID
    sale_id: uuid.UUID
    at: datetime
    # The store that sold.
    store_id: uuid.UUID
    store_name: str
    # A return: the store that took it and handed the money back.
    taken_at_store_id: uuid.UUID | None
    taken_at_store_name: str | None
    # Who sold, or who took the return.
    by: str
    units: int
    # What the sale was for, or what the returned goods were worth.
    amount: Decimal
    # The money it moved: in for a sale (what was paid with it, for a sale
    # paid in parts), out for a return. An order paid off the till moved it
    # outside the till.
    money: Decimal
    # The way that money was stated with when it moved; None for «не
    # вказано», and for a return that only lowered a debt (it moved none).
    payment_method: PaymentMethod | None
    # The way it stands at now, when a correction changed it; None when none
    # did. The entry keeps saying what was stated: a correction is a note
    # beside it, never a rewrite (ADR-0012, B11).
    method_now: PaymentMethod | None
    paid_in_parts: bool
    goods: list[str]
    # The mark of a sale typed from paper; `by` above is still whoever typed
    # it (owner decision, 2026-10-04: «Звіт» shows who sold and who typed).
    outage: OutageView | None = None


@dataclass(frozen=True, slots=True)
class _Store:
    id: uuid.UUID
    name: str
    state: StoreState
    # The period's first and last instants there: [start, end).
    start: datetime
    end: datetime


async def _visible(
    session: AsyncSession, scope: RequestScope, store_id: uuid.UUID | None
) -> list[Store]:
    """The stores this report reads: the one asked for, or every store this
    person holds `report:view_financial` in, one that does not trade
    included where they may read it."""
    if store_id is not None:
        scope.require(Permission.REPORT_VIEW_FINANCIAL, store_id)
        ids = {store_id}
    else:
        ids = {
            store
            for store in scope.store_ids | scope.readable_closed_stores
            if scope.can(Permission.REPORT_VIEW_FINANCIAL, store)
        }
        if not ids:
            scope.require(Permission.REPORT_VIEW_FINANCIAL)
    return list(
        (
            await session.scalars(
                select(Store)
                .where(Store.organization_id == scope.organization_id, Store.id.in_(ids))
                .order_by(Store.code, Store.id)
            )
        ).all()
    )


def _period(stores: Sequence[Store], first: date | None, last: date | None) -> Period:
    """Today unless asked otherwise; a first day alone is that one day."""
    zone = ZoneInfo(stores[0].timezone if stores else DEFAULT_ZONE)
    today = datetime.now(zone).date()
    first = first or last or today
    last = last or first
    if last < first or (last - first).days >= MAX_DAYS:
        raise ValidationFailedError(
            f"From one day to {MAX_DAYS} days, the first not after the last",
            reason="PERIOD",
            max_days=MAX_DAYS,
        )
    return Period(first=first, last=last, today=today)


def _bounded(stores: Sequence[Store], period: Period) -> list[_Store]:
    bounded = []
    for store in stores:
        zone = ZoneInfo(store.timezone)
        bounded.append(
            _Store(
                id=store.id,
                name=store.name,
                state=StoreState(store.state),
                start=datetime.combine(period.first, time(), zone),
                end=datetime.combine(period.last + timedelta(days=1), time(), zone),
            )
        )
    return bounded


def _within(store_column: Any, at_column: Any, stores: Iterable[_Store]) -> ColumnElement[bool]:
    """Rows of these stores, each within its own days."""
    return or_(
        *(
            and_(store_column == store.id, at_column >= store.start, at_column < store.end)
            for store in stores
        )
    )


def _completed(scope: RequestScope) -> list[ColumnElement[bool]]:
    return [
        Sale.organization_id == scope.organization_id,
        Sale.status == SaleStatus.COMPLETED,
    ]


async def _figures(session: AsyncSession, scope: RequestScope, store: _Store) -> Figures:
    # Each way's money in, out, and moved by corrections.
    came_in: dict[str, Decimal] = defaultdict(lambda: ZERO)
    went_out: dict[str, Decimal] = defaultdict(lambda: ZERO)
    corrected: dict[str, Decimal] = defaultdict(lambda: ZERO)

    sales_here = [*_completed(scope), _within(Sale.store_id, Sale.sold_at, [store])]
    sales, sold, paid_in_full = 0, ZERO, ZERO
    # A sale paid in parts brought in its first payment, counted with the
    # payments below; its own way is that payment's.
    for way, count, total, in_full in (
        await session.execute(
            select(
                Sale.payment_method,
                func.count(Sale.id),
                func.coalesce(func.sum(Sale.total), 0),
                func.coalesce(func.sum(Sale.total).filter(CustomerCredit.id.is_(None)), 0),
            )
            .outerjoin(CustomerCredit, CustomerCredit.sale_id == Sale.id)
            .where(*sales_here)
            .group_by(Sale.payment_method)
        )
    ).tuples():
        sales += int(count)
        sold += _money(total)
        came_in[_way(way)] += _money(in_full)
        if _way(way) in TILL_WAYS:
            paid_in_full += _money(in_full)
    units = await session.scalar(
        select(func.coalesce(func.sum(SaleItem.quantity), 0))
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(*sales_here)
    )
    # Returns of what this store sold, wherever they were taken.
    returns_of_its_sales = [
        Refund.organization_id == scope.organization_id,
        _within(Refund.store_id, Refund.created_at, [store]),
    ]
    returns, returned = (
        await session.execute(
            select(func.count(Refund.id), func.coalesce(func.sum(Refund.total_amount), 0)).where(
                *returns_of_its_sales
            )
        )
    ).one()
    returned_units = await session.scalar(
        select(func.coalesce(func.sum(RefundItem.quantity), 0))
        .join(Refund, Refund.id == RefundItem.refund_id)
        .where(*returns_of_its_sales)
    )
    # Payments towards debts that this store's till took: its own, and those
    # of a store that did not trade. The first payment of an order collected
    # in parts may have been paid off the till (ADR-0012, G2).
    debt_payments = ZERO
    for way, amount in (
        await session.execute(
            select(CreditEntry.payment_method, func.coalesce(func.sum(CreditEntry.amount), 0))
            .join(CustomerCredit, CustomerCredit.id == CreditEntry.credit_id)
            .where(
                CreditEntry.organization_id == scope.organization_id,
                CreditEntry.kind == EntryKind.PAYMENT.value,
                _within(
                    func.coalesce(CreditEntry.taken_at_store_id, CustomerCredit.store_id),
                    CreditEntry.created_at,
                    [store],
                ),
            )
            .group_by(CreditEntry.payment_method)
        )
    ).tuples():
        came_in[_way(way)] += _money(amount)
        if _way(way) in TILL_WAYS:
            debt_payments += _money(amount)
    # What returns taken here handed back, by the way it went back: a sale
    # paid in full gets back what the goods were worth; one paid in parts its
    # `cash_back` alone. Money only ever goes back through the till.
    handed_back = func.coalesce(CreditEntry.cash_back, Refund.total_amount)
    paid_back = ZERO
    for way, amount in (
        await session.execute(
            select(Refund.payment_method, func.coalesce(func.sum(handed_back), 0))
            .select_from(Refund)
            .outerjoin(CreditEntry, CreditEntry.refund_id == Refund.id)
            .where(
                Refund.organization_id == scope.organization_id,
                _within(Refund.taken_at_store_id, Refund.created_at, [store]),
            )
            .group_by(Refund.payment_method)
        )
    ).tuples():
        went_out[_way(way)] += _money(amount)
        paid_back += _money(amount)
    # Corrections of the way made in these days at this store's drawer — the
    # store whose till the corrected money went through — whatever day the
    # money moved on. A sale's or a payment's money came in (IN); a refund's
    # went out (OUT), so moving it moves the other way.
    for from_way, to_way, direction, amount in (
        await session.execute(
            select(
                PaymentCorrection.from_method,
                PaymentCorrection.to_method,
                PaymentCorrection.direction,
                func.coalesce(func.sum(PaymentCorrection.amount), 0),
            )
            .where(
                PaymentCorrection.organization_id == scope.organization_id,
                _within(PaymentCorrection.store_id, PaymentCorrection.created_at, [store]),
            )
            .group_by(
                PaymentCorrection.from_method,
                PaymentCorrection.to_method,
                PaymentCorrection.direction,
            )
        )
    ).tuples():
        moved = _money(amount) if direction == Direction.IN.value else -_money(amount)
        corrected[_way(to_way)] += moved
        corrected[_way(from_way)] -= moved
    return Figures(
        sales=int(sales),
        units=int(units or 0),
        sold=_money(sold),
        returns=int(returns),
        returned_units=int(returned_units or 0),
        returned=_money(returned),
        paid_in_full=_money(paid_in_full),
        debt_payments=_money(debt_payments),
        paid_back=_money(paid_back),
        ways={
            name: WaySums(came_in=came_in[name], went_out=went_out[name], corrected=corrected[name])
            for name in (*TILL_WAYS, *OFF_TILL_WAYS)
        },
    )


async def _currency(session: AsyncSession, scope: RequestScope) -> str:
    return (
        await session.scalar(
            select(Organization.currency_code).where(Organization.id == scope.organization_id)
        )
    ) or "UAH"


async def sales_report(
    session: AsyncSession,
    *,
    scope: RequestScope,
    first: date | None,
    last: date | None,
) -> SalesReport:
    """Each store this person may see, and the stores together when there
    are several."""
    stores = await _visible(session, scope, None)
    period = _period(stores, first, last)
    figures = [
        StoreFigures(
            store_id=store.id,
            store_name=store.name,
            store_state=store.state,
            figures=await _figures(session, scope, store),
        )
        for store in _bounded(stores, period)
    ]
    total = None
    if len(figures) > 1:
        total = Figures()
        for each in figures:
            total += each.figures
    return SalesReport(
        period=period,
        currency_code=await _currency(session, scope),
        stores=figures,
        total=total,
    )


async def models_sold(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID | None,
    first: date | None,
    last: date | None,
) -> tuple[Period, list[ModelFigures]]:
    """The models sold in these days, the most money first, and what of each
    came back in them: in one store, or in every store this person sees."""
    visible = await _visible(session, scope, store_id)
    period = _period(visible, first, last)
    stores = _bounded(visible, period)
    if not stores:
        return period, []
    sold = (
        await session.execute(
            select(
                SaleItem.product_variant_id,
                SaleItem.display_name_snapshot,
                func.sum(SaleItem.quantity),
                func.sum(SaleItem.line_total),
                func.max(Sale.sold_at),
            )
            .join(Sale, Sale.id == SaleItem.sale_id)
            .where(*_completed(scope), _within(Sale.store_id, Sale.sold_at, stores))
            .group_by(SaleItem.product_variant_id, SaleItem.display_name_snapshot)
        )
    ).all()
    returned = (
        await session.execute(
            select(
                SaleItem.product_variant_id,
                SaleItem.display_name_snapshot,
                func.sum(RefundItem.quantity),
                func.sum(RefundItem.amount),
                func.max(Refund.created_at),
            )
            .join(Refund, Refund.id == RefundItem.refund_id)
            .join(SaleItem, SaleItem.id == RefundItem.sale_item_id)
            .where(
                Refund.organization_id == scope.organization_id,
                _within(Refund.store_id, Refund.created_at, stores),
            )
            .group_by(SaleItem.product_variant_id, SaleItem.display_name_snapshot)
        )
    ).all()
    # A duplicate merged since counts with the model that stays, as one
    # model (owner decision, 2026-10-03), and each line is named as its model
    # is named now. The figures stay the frozen lines' own.
    leading = await current_variants(
        session,
        organization_id=scope.organization_id,
        variant_ids=list({row[0] for rows in (sold, returned) for row in rows}),
    )
    frozen: dict[uuid.UUID, tuple[datetime, str]] = {}
    counts: dict[uuid.UUID, list[Any]] = {}
    for rows, offset in ((sold, 0), (returned, 2)):
        for variant, name, quantity, amount, at in rows:
            model = leading.get(variant, variant)
            if model not in frozen or frozen[model][0] < at:
                frozen[model] = (at, name)
            tally = counts.setdefault(model, [0, ZERO, 0, ZERO])
            tally[offset] += int(quantity)
            tally[offset + 1] += _money(amount)
    described = await describe_variants(session, list(counts))
    models = [
        ModelFigures(
            product_variant_id=variant,
            display_name=(
                described[variant].display_name if variant in described else frozen[variant][1]
            ),
            units=tally[0],
            sold=tally[1],
            returned_units=tally[2],
            returned=tally[3],
        )
        for variant, tally in counts.items()
    ]
    models.sort(
        key=lambda model: (-model.sold, -model.units, model.display_name, model.product_variant_id)
    )
    return period, models


def _goods(name: str, snapshot: dict[str, Any], quantity: int) -> str:
    size = snapshot.get("size")
    return f"{name}, {size} × {quantity}" if size else f"{name} × {quantity}"


async def entries(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID | None,
    first: date | None,
    last: date | None,
    limit: int,
    offset: int,
) -> tuple[Period, list[EntryView], bool]:
    """Every sale and return of these days, the newest first.

    A store's are its sales, the returns of them, and the returns it took of
    another store's sales: each changed its figures or its till."""
    visible = await _visible(session, scope, store_id)
    period = _period(visible, first, last)
    stores = _bounded(visible, period)
    if not stores:
        return period, [], False
    sales = select(
        literal(Kind.SALE.value).label("kind"),
        Sale.id.label("id"),
        Sale.sold_at.label("at"),
    ).where(*_completed(scope), _within(Sale.store_id, Sale.sold_at, stores))
    returns = select(
        literal(Kind.RETURN.value).label("kind"),
        Refund.id.label("id"),
        Refund.created_at.label("at"),
    ).where(
        Refund.organization_id == scope.organization_id,
        or_(
            _within(Refund.store_id, Refund.created_at, stores),
            _within(Refund.taken_at_store_id, Refund.created_at, stores),
        ),
    )
    listed = union_all(sales, returns).subquery()
    rows = (
        await session.execute(
            select(listed.c.kind, listed.c.id)
            .order_by(listed.c.at.desc(), listed.c.id.desc())
            .limit(limit + 1)
            .offset(offset)
        )
    ).all()
    page = rows[:limit]
    sale_ids = [row.id for row in page if row.kind == Kind.SALE.value]
    refund_ids = [row.id for row in page if row.kind == Kind.RETURN.value]
    views = {
        **await _sale_entries(session, sale_ids),
        **await _return_entries(session, refund_ids),
    }
    names = await store_names(
        session,
        organization_id=scope.organization_id,
        store_ids={view.store_id for view in views.values()}
        | {view.taken_at_store_id for view in views.values() if view.taken_at_store_id},
    )
    listed_views = []
    for row in page:
        view = views[row.id]
        listed_views.append(
            EntryView(
                kind=view.kind,
                id=view.id,
                sale_id=view.sale_id,
                at=view.at,
                store_id=view.store_id,
                store_name=names.get(view.store_id, ""),
                taken_at_store_id=view.taken_at_store_id,
                taken_at_store_name=(
                    names.get(view.taken_at_store_id, "") if view.taken_at_store_id else None
                ),
                by=view.by,
                units=view.units,
                amount=view.amount,
                money=view.money,
                payment_method=view.payment_method,
                method_now=view.method_now,
                paid_in_parts=view.paid_in_parts,
                goods=view.goods,
                outage=view.outage,
            )
        )
    return period, listed_views, len(rows) > limit


def _stated(current: CurrentMethod | None) -> PaymentMethod | None:
    """The way an entry's money was stated with when it moved."""
    return None if current is None else current.stated


def _now(current: CurrentMethod | None) -> PaymentMethod | None:
    """The way it stands at now, when a correction changed it."""
    return current.method if current is not None and current.corrected else None


async def _sale_entries(
    session: AsyncSession, sale_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, EntryView]:
    if not sale_ids:
        return {}
    # Whoever the mark of a sale typed from paper names as having sold it.
    named = aliased(AppUser)
    sales = (
        await session.execute(
            select(Sale, AppUser.display_name, named.display_name)
            .join(AppUser, AppUser.id == Sale.seller_user_id)
            .outerjoin(named, named.id == Sale.outage_sold_by)
            .where(Sale.id.in_(sale_ids))
        )
    ).all()
    # A sale paid in parts took its first payment with it: that payment shares
    # the sale's command, and every such sale has one.
    first_payments: dict[uuid.UUID, Decimal] = dict(
        (
            await session.execute(
                select(CustomerCredit.sale_id, CreditEntry.amount)
                .join(CreditEntry, CreditEntry.credit_id == CustomerCredit.id)
                .join(Sale, Sale.id == CustomerCredit.sale_id)
                .where(
                    CustomerCredit.sale_id.in_(sale_ids),
                    CreditEntry.kind == EntryKind.PAYMENT.value,
                    CreditEntry.command_id == Sale.command_id,
                )
            )
        )
        .tuples()
        .all()
    )
    # The way of the money taken with each: the sale's own, or its first
    # payment's when it was paid in parts.
    taken = {
        sale_id: methods.taken_with_sale
        for sale_id, methods in (await sale_methods(session, sale_ids)).items()
    }
    items: dict[uuid.UUID, list[SaleItem]] = {}
    for item in (
        await session.scalars(
            select(SaleItem).where(SaleItem.sale_id.in_(sale_ids)).order_by(SaleItem.id)
        )
    ).all():
        items.setdefault(item.sale_id, []).append(item)
    return {
        sale.id: EntryView(
            kind=Kind.SALE,
            id=sale.id,
            sale_id=sale.id,
            at=sale.sold_at,
            store_id=sale.store_id,
            store_name="",
            taken_at_store_id=None,
            taken_at_store_name=None,
            by=seller,
            units=sum(item.quantity for item in items.get(sale.id, [])),
            amount=sale.total,
            money=first_payments.get(sale.id, sale.total),
            payment_method=_stated(taken.get(sale.id)),
            method_now=_now(taken.get(sale.id)),
            paid_in_parts=sale.id in first_payments,
            goods=[
                _goods(item.display_name_snapshot, item.variant_snapshot, item.quantity)
                for item in items.get(sale.id, [])
            ],
            outage=(
                OutageView(sold_by=sold_by, sold_at=sale.outage_sold_at)
                if sale.during_outage
                else None
            ),
        )
        for sale, seller, sold_by in sales
    }


async def _return_entries(
    session: AsyncSession, refund_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, EntryView]:
    if not refund_ids:
        return {}
    named = aliased(AppUser)
    refunds = (
        await session.execute(
            select(Refund, AppUser.display_name, CreditEntry.cash_back, named.display_name)
            .join(AppUser, AppUser.id == Refund.actor_user_id)
            .outerjoin(CreditEntry, CreditEntry.refund_id == Refund.id)
            .outerjoin(named, named.id == Refund.outage_taken_by)
            .where(Refund.id.in_(refund_ids))
        )
    ).all()
    lines: dict[uuid.UUID, list[tuple[RefundItem, SaleItem]]] = {}
    for refund_item, sale_item in (
        await session.execute(
            select(RefundItem, SaleItem)
            .join(SaleItem, SaleItem.id == RefundItem.sale_item_id)
            .where(RefundItem.refund_id.in_(refund_ids))
            .order_by(RefundItem.id)
        )
    ).all():
        lines.setdefault(refund_item.refund_id, []).append((refund_item, sale_item))
    methods = await refund_methods(session, refund_ids)
    return {
        refund.id: EntryView(
            kind=Kind.RETURN,
            id=refund.id,
            sale_id=refund.sale_id,
            at=refund.created_at,
            store_id=refund.store_id,
            store_name="",
            taken_at_store_id=refund.taken_at_store_id,
            taken_at_store_name=None,
            by=actor,
            units=sum(refund_item.quantity for refund_item, _ in lines.get(refund.id, [])),
            amount=refund.total_amount,
            money=refund.total_amount if cash_back is None else cash_back,
            payment_method=_stated(methods.get(refund.id)),
            method_now=_now(methods.get(refund.id)),
            paid_in_parts=cash_back is not None,
            goods=[
                _goods(
                    sale_item.display_name_snapshot,
                    sale_item.variant_snapshot,
                    refund_item.quantity,
                )
                for refund_item, sale_item in lines.get(refund.id, [])
            ],
            outage=(
                OutageView(sold_by=taken_by, sold_at=refund.outage_taken_at)
                if refund.during_outage
                else None
            ),
        )
        for refund, actor, cash_back, taken_by in refunds
    }


__all__ = [
    "MAX_DAYS",
    "NOT_STATED",
    "OFF_TILL_WAYS",
    "TILL_WAYS",
    "EntryView",
    "Figures",
    "Kind",
    "ModelFigures",
    "OutageView",
    "Period",
    "SalesReport",
    "StoreFigures",
    "WaySums",
    "entries",
    "models_sold",
    "sales_report",
]
