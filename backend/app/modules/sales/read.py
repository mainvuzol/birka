"""A store's sales, newest first, as a seller looks one up to take a return.

The owner decided on 2026-10-01 that a seller finds the sale being returned
in the store's list of sales, searchable by the goods' name. Everything here
is read from the frozen receipt — the name and size the seller saw — never
from the catalog as it is now.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
) -> SalePage:
    """One page of the store's sales, newest first; with `query`, only sales
    with a line whose name contains it, in any letter case."""
    statement = select(Sale).where(
        Sale.organization_id == organization_id, Sale.store_id == store_id
    )
    wanted = (query or "").strip().lower()[:MAX_QUERY]
    if wanted:
        statement = statement.where(
            exists().where(
                SaleItem.sale_id == Sale.id,
                func.lower(SaleItem.display_name_snapshot).contains(wanted, autoescape=True),
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


__all__ = ["SalePage", "list_sales"]
