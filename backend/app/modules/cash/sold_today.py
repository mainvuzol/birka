"""What a seller sold today at the till, in units: «Сьогодні ви продали N шт.»

The owner decided (business-rules.md, 2026-10-16, В8, and 2026-10-17): the
seller sees how many units they sold today, never a sum or a way, so the
drawer's blind count (G32) keeps nothing to go by. Counted:

- in the store's business day, 06:00 to 06:00 in its zone, as the drawer
  counts (G8); a sale typed from paper counts on the day it was typed, as
  everywhere (ADR-0013 §5.1);
- the sales of whoever sold them: the one named under «Хто продав» on a sale
  typed from paper, else whoever recorded it;
- at the till only: a collected order's sale, made by whoever pressed
  «Клієнт забрав», is not one;
- less every unit returned from those same sales, by whoever took the
  return, wherever, by the day's end.

Nothing here is stored: the figure is read from the rows it counts, each
time it is asked.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.modules.authz.scope import RequestScope
from app.modules.cash.service import business_day
from app.modules.orders.models import CustomerOrder
from app.modules.refunds.models import Refund, RefundItem
from app.modules.sales.models import Sale, SaleItem, SaleStatus
from app.modules.tenancy.models import Store

# The hour a business day begins, as `cash.service.DAY_STARTS` (G8).
DAY_BEGINS = time(6)


@dataclass(frozen=True, slots=True)
class SoldToday:
    business_day: date
    units: int


async def sold_today(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    now: datetime | None = None,
) -> SoldToday:
    """The caller's units sold today in this store, less those returned. The
    caller's right to it is checked by the API (`sale:create` there)."""
    store = await session.scalar(
        select(Store).where(Store.id == store_id, Store.organization_id == scope.organization_id)
    )
    if store is None:
        raise NotFoundError("Unknown store", store_id=str(store_id))
    zone = ZoneInfo(store.timezone)
    day = business_day(now or datetime.now(UTC), store.timezone)
    start = datetime.combine(day, DAY_BEGINS, zone)
    end = datetime.combine(day + timedelta(days=1), DAY_BEGINS, zone)
    counted = select(Sale.id).where(
        Sale.organization_id == scope.organization_id,
        Sale.store_id == store.id,
        Sale.status == SaleStatus.COMPLETED,
        Sale.sold_at >= start,
        Sale.sold_at < end,
        func.coalesce(Sale.outage_sold_by, Sale.seller_user_id) == scope.user_id,
        ~select(CustomerOrder.id).where(CustomerOrder.sale_id == Sale.id).exists(),
    )
    sold = await session.scalar(
        select(func.coalesce(func.sum(SaleItem.quantity), 0)).where(SaleItem.sale_id.in_(counted))
    )
    returned = await session.scalar(
        select(func.coalesce(func.sum(RefundItem.quantity), 0))
        .join(SaleItem, SaleItem.id == RefundItem.sale_item_id)
        .join(Refund, Refund.id == RefundItem.refund_id)
        .where(SaleItem.sale_id.in_(counted), Refund.created_at < end)
    )
    return SoldToday(business_day=day, units=int(sold or 0) - int(returned or 0))
