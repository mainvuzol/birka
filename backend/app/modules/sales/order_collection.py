"""Internal financial boundary for a locked, collected customer order.

The orders service must verify shipment and serialize the transition before
calling this function. Shipment already wrote the stock ledger; this boundary
never writes inventory and does not imply that payment has been received.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import ValidationFailedError
from app.modules.audit import service as audit
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.sales.models import Sale, SaleItem
from app.modules.sales.service import _amount, _existing_command


@dataclass(frozen=True, slots=True)
class CollectedSaleLine:
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    source_location_id: uuid.UUID
    quantity: int
    unit_price: Decimal
    discount_amount: Decimal
    display_name_snapshot: str
    variant_snapshot: dict[str, Any]


async def record_collected_sale(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    order_id: uuid.UUID,
    command_id: uuid.UUID,
    lines: list[CollectedSaleLine],
) -> Sale:
    """Freeze the agreed order prices as a sale in the caller's transaction."""
    scope.require(Permission.SALE_CREATE, store_id)
    if not lines:
        raise ValidationFailedError("A collected order must contain at least one line")
    for line in lines:
        if type(line.quantity) is not int or not 0 < line.quantity <= 1000:
            raise ValidationFailedError("Quantity must be an integer between 1 and 1000")
        if _amount(line.discount_amount) > _amount(line.unit_price):
            raise ValidationFailedError("A discount cannot exceed the price")
        _amount((line.unit_price - line.discount_amount) * line.quantity)
    await require_stock_access(
        session,
        scope=scope,
        store_id=store_id,
        location_ids={line.source_location_id for line in lines},
        capability=None,
        permission=Permission.SALE_CREATE,
    )
    # Match ordinary sale command locking, preventing cross-endpoint reuse.
    fingerprint = idempotency.fingerprint(
        {
            "action": "order.collect",
            "order_id": str(order_id),
            "lines": [
                {
                    key: str(value) if isinstance(value, (uuid.UUID, Decimal)) else value
                    for key, value in asdict(line).items()
                }
                for line in lines
            ],
        },
        actor_user_id=scope.user_id,
        store_id=store_id,
    )
    existing = await _existing_command(
        session,
        scope=scope,
        command_id=command_id,
        request_fingerprint=fingerprint,
    )
    if existing is not None:
        return existing.sale
    subtotal = _amount(sum((line.unit_price * line.quantity for line in lines), Decimal(0)))
    discount = _amount(sum((line.discount_amount * line.quantity for line in lines), Decimal(0)))
    sale = Sale(
        organization_id=scope.organization_id,
        store_id=store_id,
        seller_user_id=scope.user_id,
        command_id=command_id,
        command_fingerprint=fingerprint,
        currency_code="UAH",
        subtotal=subtotal,
        discount_total=discount,
        total=_amount(subtotal - discount),
    )
    session.add(sale)
    await session.flush()
    for line in lines:
        final_price = _amount(line.unit_price - line.discount_amount)
        session.add(
            SaleItem(
                sale_id=sale.id,
                **asdict(line),
                final_unit_price=final_price,
                line_total=_amount(final_price * line.quantity),
                currency_code="UAH",
            )
        )
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="sale.completed_from_order",
        entity_type="sale",
        entity_id=sale.id,
        after={"order_id": str(order_id), "total": str(sale.total), "currency_code": "UAH"},
    )
    return sale
