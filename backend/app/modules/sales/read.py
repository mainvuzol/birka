"""A store's sales, newest first, as a seller looks one up to take a return.

The owner decided on 2026-10-01 that a seller finds the sale being returned
in the store's list of sales, searchable by the goods' name — and, since any
store of the network may take goods back, among the other stores' sales,
found only by a search. Everything here
is read from the frozen receipt — the name and size the seller saw — never
from the catalog as it is now.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.sales.models import Sale, SaleItem

MAX_QUERY = 100


@dataclass(frozen=True, slots=True)
class SalePage:
    sales: list[Sale]
    items: dict[uuid.UUID, list[SaleItem]]
    has_more: bool


async def list_sales(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    query: str | None,
    limit: int,
    offset: int,
    elsewhere: bool = False,
) -> SalePage:
    """One page of the store's sales, newest first; with `query`, only sales
    with a line whose name contains each of its words, in any order and
    letter case. `elsewhere` reads every other store's of the organization
    instead."""
    statement = select(Sale).where(
        Sale.organization_id == organization_id,
        Sale.store_id != store_id if elsewhere else Sale.store_id == store_id,
    )
    # Each word typed, literally, in the name of one line of the sale, as
    # the till's search reads each word (returns task list, P1-3): «шоколад
    # лоран» finds «Лоран шоколад»; words of two lines do not add up.
    # A word typed twice is looked for once.
    words = list(dict.fromkeys((query or "").strip().lower()[:MAX_QUERY].split()))
    if words:
        name = func.lower(SaleItem.display_name_snapshot)
        statement = statement.where(
            exists().where(
                SaleItem.sale_id == Sale.id,
                *(name.contains(word, autoescape=True) for word in words),
            )
        )
    found = list(
        (
            await session.scalars(
                statement.order_by(Sale.sold_at.desc(), Sale.id.desc())
                .offset(offset)
                .limit(limit + 1)
            )
        ).all()
    )
    sales = found[:limit]
    items: dict[uuid.UUID, list[SaleItem]] = {sale.id: [] for sale in sales}
    if sales:
        for item in (
            await session.scalars(
                select(SaleItem)
                .where(SaleItem.sale_id.in_(list(items)))
                .order_by(SaleItem.sale_id, SaleItem.id)
            )
        ).all():
            items[item.sale_id].append(item)
    return SalePage(sales=sales, items=items, has_more=len(found) > limit)


def way_shown_to(scope: RequestScope, *, store_id: uuid.UUID, seller_user_id: uuid.UUID) -> bool:
    """Whether this person may see how one sale was paid, outside the answer
    to the command that sold it (ADR-0012, G32).

    The seller counts the drawer without seeing what it should hold (owner
    decisions, 2026-10-04), and every holder of `sale:view` pages through
    the store's sales with their totals. So the way is never in that list,
    and a sale read on its own shows it only to whoever sold it — their own
    receipt — and to whoever sees the store's money split by way anyway: the
    owner and managers, with `report:view_financial` there."""
    return seller_user_id == scope.user_id or scope.can(Permission.REPORT_VIEW_FINANCIAL, store_id)


__all__ = ["SalePage", "list_sales", "way_shown_to"]
