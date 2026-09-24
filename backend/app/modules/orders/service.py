"""Caller-owned transactions; one reservation, dispatch and collection per order.

Postal arrival is not collection or payment. Only collection records a sale;
its goods have already left via ORDER_DISPATCH and are never removed twice.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import IdempotencyConflictError, NotFoundError, ValidationFailedError
from app.core.idempotency import fingerprint
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.read import describe_variants, size_label
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import (
    MovementRequest,
    ReservationRequest,
    apply_movements,
    dispatch_reserved_stock,
    release_stock,
    reserve_stock,
)
from app.modules.orders.models import CustomerOrder, CustomerOrderItem, OrderCommand, OrderStatus
from app.modules.sales.order_collection import CollectedSaleLine, record_collected_sale
from app.modules.tenancy.models import StockLocation, StoreLocationAccess
from app.modules.tenancy.service import LocationCapability

MAX_MONEY = Decimal("9999999999.99")


@dataclass(frozen=True, slots=True)
class OrderLineInput:
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    source_location_id: uuid.UUID
    quantity: int
    unit_price: Decimal
    discount_amount: Decimal = Decimal("0")


def validate_lines(lines: list[OrderLineInput]) -> None:
    if not 1 <= len(lines) <= 100:
        raise ValidationFailedError("An order must contain 1 to 100 lines")
    seen = set()
    subtotal = Decimal("0")
    for line in lines:
        key = (line.source_location_id, line.product_variant_id, line.size_id)
        if key in seen:
            raise ValidationFailedError("Duplicate stock key in order")
        seen.add(key)
        if type(line.quantity) is not int or not 1 <= line.quantity <= 1000:
            raise ValidationFailedError("Quantity must be an integer between 1 and 1000")
        for amount in (line.unit_price, line.discount_amount):
            if (
                not isinstance(amount, Decimal)
                or not amount.is_finite()
                or not 0 <= amount <= MAX_MONEY
                or amount.quantize(Decimal("0.01")) != amount
            ):
                raise ValidationFailedError(
                    "Money must be a nonnegative Decimal with at most two decimal places"
                )
        if line.discount_amount > line.unit_price:
            raise ValidationFailedError("Discount exceeds unit price")
        subtotal += line.unit_price * line.quantity
    if subtotal > MAX_MONEY:
        raise ValidationFailedError("Order amount exceeds supported range")


async def _authorize(
    session: AsyncSession,
    scope: RequestScope,
    store_id: uuid.UUID,
    items: list[OrderLineInput] | list[CustomerOrderItem],
    action: str,
) -> None:
    permission = (
        Permission.SALE_VIEW
        if action == "read"
        else Permission.SALE_REFUND
        if action == "return"
        else Permission.SALE_CREATE
    )
    capability = (
        LocationCapability.RECEIVE
        if action == "return"
        else LocationCapability.SELL
        if action in {"create", "dispatch"}
        else None
    )
    await require_stock_access(
        session,
        scope=scope,
        store_id=store_id,
        location_ids={i.source_location_id for i in items},
        permission=permission,
        capability=capability,
    )
    if action == "return":
        await require_stock_access(
            session,
            scope=scope,
            store_id=store_id,
            location_ids={i.source_location_id for i in items},
            permission=Permission.INVENTORY_RECEIVE,
            capability=LocationCapability.RECEIVE,
        )


async def _command(
    session: AsyncSession, scope: RequestScope, command_id: uuid.UUID, request_fingerprint: str
) -> dict[str, Any] | None:
    lock_key = int.from_bytes(
        hashlib.sha256(scope.organization_id.bytes + command_id.bytes).digest()[:8],
        "big",
        signed=True,
    )
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
    old = await session.scalar(
        select(OrderCommand).where(
            OrderCommand.organization_id == scope.organization_id,
            OrderCommand.command_id == command_id,
        )
    )
    if old is None:
        return None
    if old.fingerprint != request_fingerprint:
        raise IdempotencyConflictError("Command already used for a different order operation")
    return old.response_snapshot


def _response(order: CustomerOrder, items: list[CustomerOrderItem]) -> dict[str, Any]:
    return {
        "id": str(order.id),
        "store_id": str(order.store_id),
        "status": order.status,
        "created_at": order.created_at.isoformat(),
        "sale_id": str(order.sale_id) if order.sale_id else None,
        "currency_code": order.currency_code,
        "total": str(
            sum(
                ((i.unit_price - i.discount_amount) * i.quantity for i in items), Decimal("0")
            ).quantize(Decimal("0.01"))
        ),
        "items": [
            {
                "id": str(i.id),
                "product_variant_id": str(i.product_variant_id),
                "size_id": str(i.size_id),
                "source_location_id": str(i.source_location_id),
                "quantity": i.quantity,
                "unit_price": str(i.unit_price.quantize(Decimal("0.01"))),
                "discount_amount": str(i.discount_amount.quantize(Decimal("0.01"))),
                "display_name": i.display_name_snapshot,
                "size_label": i.variant_snapshot.get("size"),
            }
            for i in sorted(items, key=lambda item: str(item.id))
        ],
    }


async def _save(
    session: AsyncSession,
    scope: RequestScope,
    order: CustomerOrder,
    items: list[CustomerOrderItem],
    command_id: uuid.UUID,
    request_fingerprint: str,
    action: str,
    before: str | None,
    reason: str | None = None,
) -> dict[str, Any]:
    await session.flush()
    body = _response(order, items)
    session.add(
        OrderCommand(
            organization_id=scope.organization_id,
            order_id=order.id,
            command_id=command_id,
            fingerprint=request_fingerprint,
            response_snapshot=body,
        )
    )
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action=f"order.{action}",
        entity_type="customer_order",
        entity_id=order.id,
        before={"status": before} if before else None,
        after={
            "status": order.status,
            "store_id": str(order.store_id),
            "reason": reason,
            "sale_id": body["sale_id"],
        },
    )
    await session.flush()
    return body


async def create_order(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    command_id: uuid.UUID,
    lines: list[OrderLineInput],
) -> dict[str, Any]:
    validate_lines(lines)
    await _authorize(session, scope, store_id, lines, "create")
    request_fingerprint = fingerprint(
        {
            "action": "create",
            "lines": [
                {
                    "variant": str(i.product_variant_id),
                    "size": str(i.size_id),
                    "location": str(i.source_location_id),
                    "quantity": i.quantity,
                    "price": str(i.unit_price.quantize(Decimal("0.01"))),
                    "discount": str(i.discount_amount.quantize(Decimal("0.01"))),
                }
                for i in lines
            ],
        },
        actor_user_id=scope.user_id,
        store_id=store_id,
    )
    replay = await _command(session, scope, command_id, request_fingerprint)
    if replay is not None:
        return replay
    order = CustomerOrder(
        id=uuid.uuid4(),
        organization_id=scope.organization_id,
        store_id=store_id,
        created_by_user_id=scope.user_id,
        status=OrderStatus.READY_TO_DISPATCH,
        currency_code="UAH",
    )
    # Inventory validates the tenant/product/size and locks the entire basket.
    await reserve_stock(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        reference_id=order.id,
        requests=[
            ReservationRequest(
                location_id=i.source_location_id,
                product_variant_id=i.product_variant_id,
                size_id=i.size_id,
                quantity=i.quantity,
            )
            for i in lines
        ],
        actor_user_id=scope.user_id,
    )
    descriptions = await describe_variants(session, [i.product_variant_id for i in lines])
    session.add(order)
    await session.flush()
    items = []
    for line in lines:
        description = descriptions[line.product_variant_id]
        snapshot = dict(description.snapshot)
        snapshot["size"] = await size_label(session, line.size_id)
        items.append(
            CustomerOrderItem(
                order_id=order.id,
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                source_location_id=line.source_location_id,
                quantity=line.quantity,
                unit_price=line.unit_price,
                discount_amount=line.discount_amount,
                display_name_snapshot=description.display_name,
                variant_snapshot=snapshot,
            )
        )
    session.add_all(items)
    return await _save(
        session, scope, order, items, command_id, request_fingerprint, "created", None
    )


async def _load(
    session: AsyncSession, scope: RequestScope, order_id: uuid.UUID, *, lock: bool = False
) -> tuple[CustomerOrder, list[CustomerOrderItem]]:
    statement = select(CustomerOrder).where(
        CustomerOrder.id == order_id, CustomerOrder.organization_id == scope.organization_id
    )
    if lock:
        statement = statement.with_for_update()
    order = await session.scalar(statement)
    if order is None:
        raise NotFoundError("Order not found")
    items = list(
        (
            await session.scalars(
                select(CustomerOrderItem).where(CustomerOrderItem.order_id == order.id)
            )
        ).all()
    )
    return order, items


async def read_order(
    session: AsyncSession, *, scope: RequestScope, order_id: uuid.UUID
) -> dict[str, Any]:
    order, items = await _load(session, scope, order_id)
    await _authorize(session, scope, order.store_id, items, "read")
    return _response(order, items)


async def list_orders(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Filter every source's current permission before ordering and pagination."""
    scope.require(Permission.SALE_VIEW, store_id)
    private_store = (
        store_id
        if Permission.SALE_VIEW in scope.store_permissions.get(store_id, frozenset())
        else None
    )
    accessible = (
        select(StockLocation.id)
        .join(StoreLocationAccess, StoreLocationAccess.location_id == StockLocation.id)
        .where(
            StockLocation.organization_id == scope.organization_id,
            StoreLocationAccess.organization_id == scope.organization_id,
            StoreLocationAccess.store_id == store_id,
            or_(
                StockLocation.managing_store_id.is_(None),
                StockLocation.managing_store_id == private_store,
            ),
        )
    )
    inaccessible_item = (
        select(CustomerOrderItem.id)
        .where(
            CustomerOrderItem.order_id == CustomerOrder.id,
            CustomerOrderItem.source_location_id.not_in(accessible),
        )
        .exists()
    )
    orders = list(
        (
            await session.scalars(
                select(CustomerOrder)
                .where(
                    CustomerOrder.organization_id == scope.organization_id,
                    CustomerOrder.store_id == store_id,
                    ~inaccessible_item,
                )
                .order_by(CustomerOrder.created_at.desc(), CustomerOrder.id.desc())
                .limit(limit + 1)
                .offset(offset)
            )
        ).all()
    )
    page = orders[:limit]
    grouped: dict[uuid.UUID, list[CustomerOrderItem]] = {order.id: [] for order in page}
    if page:
        for item in await session.scalars(
            select(CustomerOrderItem).where(CustomerOrderItem.order_id.in_(grouped))
        ):
            grouped[item.order_id].append(item)
    return {
        "orders": [_response(order, grouped[order.id]) for order in page],
        "has_more": len(orders) > limit,
    }


async def transition_order(
    session: AsyncSession,
    *,
    scope: RequestScope,
    order_id: uuid.UUID,
    command_id: uuid.UUID,
    action: str,
    reason: str | None = None,
) -> dict[str, Any]:
    transitions = {
        "dispatch": ({OrderStatus.READY_TO_DISPATCH}, OrderStatus.DISPATCHED),
        "arrive": ({OrderStatus.DISPATCHED}, OrderStatus.ARRIVED),
        "collect": ({OrderStatus.ARRIVED}, OrderStatus.COLLECTED),
        "cancel": ({OrderStatus.READY_TO_DISPATCH}, OrderStatus.CANCELLED),
        "return": ({OrderStatus.DISPATCHED, OrderStatus.ARRIVED}, OrderStatus.RETURNED),
    }
    if action not in transitions:
        raise ValidationFailedError("Unknown order action")
    if action == "return" and (
        not isinstance(reason, str)
        or not reason.strip()
        or len(reason) > 1000
        or not is_storable(reason)
    ):
        raise ValidationFailedError(
            "Confirm physical return with a nonblank reason of at most 1000 characters"
        )
    # Command lock precedes order row lock, consistently across all actions.
    order, items = await _load(session, scope, order_id)
    await _authorize(session, scope, order.store_id, items, action)
    request_fingerprint = fingerprint(
        {"action": action, "order_id": str(order_id), "reason": reason},
        actor_user_id=scope.user_id,
        store_id=order.store_id,
    )
    replay = await _command(session, scope, command_id, request_fingerprint)
    if replay is not None:
        return replay
    # populate_existing refreshes the row after waiting on another transition.
    await session.refresh(order, with_for_update=True)
    allowed, target = transitions[action]
    if order.status not in allowed:
        raise ValidationFailedError("Invalid order transition", status=order.status, action=action)
    before = order.status
    if action == "dispatch":
        await dispatch_reserved_stock(
            session,
            organization_id=scope.organization_id,
            store_id=order.store_id,
            reference_id=order.id,
            actor_user_id=scope.user_id,
        )
    elif action == "cancel":
        await release_stock(
            session,
            organization_id=scope.organization_id,
            store_id=order.store_id,
            reference_id=order.id,
            actor_user_id=scope.user_id,
        )
    elif action == "return":
        await apply_movements(
            session,
            organization_id=scope.organization_id,
            requests=[
                MovementRequest(
                    location_id=i.source_location_id,
                    acting_store_id=order.store_id,
                    product_variant_id=i.product_variant_id,
                    size_id=i.size_id,
                    quantity_delta=i.quantity,
                    movement_type=MovementType.ORDER_RETURN,
                    reference_type="customer_order",
                    reference_id=order.id,
                )
                for i in items
            ],
            actor_user_id=scope.user_id,
        )
    elif action == "collect":
        sale = await record_collected_sale(
            session,
            scope=scope,
            store_id=order.store_id,
            order_id=order.id,
            command_id=command_id,
            lines=[
                CollectedSaleLine(
                    product_variant_id=i.product_variant_id,
                    size_id=i.size_id,
                    source_location_id=i.source_location_id,
                    quantity=i.quantity,
                    unit_price=i.unit_price,
                    discount_amount=i.discount_amount,
                    display_name_snapshot=i.display_name_snapshot,
                    variant_snapshot=i.variant_snapshot,
                )
                for i in items
            ],
        )
        order.sale_id = sale.id
    order.status = target
    return await _save(
        session, scope, order, items, command_id, request_fingerprint, action, before, reason
    )
