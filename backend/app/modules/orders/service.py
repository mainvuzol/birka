"""Caller-owned transactions; one reservation, dispatch and collection per order.

Postal arrival is not collection or payment. Only collection records a sale;
its goods have already left via ORDER_DISPATCH and are never removed twice.

Where an order goes is stated when it is made, its waybill written when it
is sent or later, and any of it corrected while the order is open (owner
decisions, 2026-10-01; see `models.py`). It moves no stock.

«Клієнт забрав» says how the order was paid (owner decisions, 2026-10-04):
in advance by transfer, cash on delivery through the carrier, or at the
counter now by cash, card or transfer. Optional in the request and required
of a new collection after the replay lookup, so a collection a phone kept
from before the way was asked still replays (ADR-0012, B2, B13). Paid in
parts, the way is the part paid now's (ADR-0012, G2).
"""

from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    IdempotencyConflictError,
    NotFoundError,
    ValidationFailedError,
    nothing_recorded,
)
from app.core.idempotency import fingerprint
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.read import describe_variants, size_label
from app.modules.credit import service as credit_service
from app.modules.identity.models import AppUser
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import (
    MovementRequest,
    ReservationRequest,
    apply_movements,
    dispatch_reserved_stock,
    release_stock,
    reserve_stock,
)
from app.modules.orders.models import (
    Carrier,
    CustomerOrder,
    CustomerOrderItem,
    CustomerOrderShippingChange,
    Destination,
    OrderCommand,
    OrderStatus,
    ShippingChangeKind,
)
from app.modules.sales.order_collection import CollectedSaleLine, record_collected_sale
from app.modules.sales.payment import ORDER_METHODS, PaymentMethod, print_of, stated_way
from app.modules.tenancy.models import StockLocation, StoreLocationAccess
from app.modules.tenancy.service import LocationCapability

MAX_MONEY = Decimal("9999999999.99")
MAX_WAYBILL = 64
MAX_NOTE = 1000
# How many other orders sharing a waybill an order names.
MAX_SAME_WAYBILL = 10


@dataclass(frozen=True, slots=True)
class OrderLineInput:
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    source_location_id: uuid.UUID
    quantity: int
    unit_price: Decimal
    discount_amount: Decimal = Decimal("0")


@dataclass(frozen=True, slots=True)
class Shipping:
    """Where an order goes, checked: what may stand together does."""

    destination: Destination
    carrier: Carrier | None
    waybill: str | None
    abroad_note: str | None


def waybill_key(waybill: str) -> str:
    """What makes two waybills one: «20 4500 1234 5678» and «20450012345678»
    are one, and so are «rr123456789ua» and «RR123456789UA»."""
    return re.sub(r"[^0-9A-Za-z]", "", waybill).upper()


def _text(value: str | None, *, limit: int, reason: str) -> str | None:
    clean = (value or "").strip()
    if not clean:
        return None
    if len(clean) > limit or not is_storable(clean):
        raise ValidationFailedError(f"At most {limit} characters", reason=reason)
    return clean


def check_shipping(
    destination: Destination,
    carrier: Carrier | None,
    waybill: str | None = None,
    abroad_note: str | None = None,
) -> Shipping:
    """Within Ukraine by one of the three carriers, always; a waybill only
    there, and the free text only abroad (owner decisions, 2026-10-01)."""
    number = _text(waybill, limit=MAX_WAYBILL, reason="WAYBILL")
    note = _text(abroad_note, limit=MAX_NOTE, reason="NOTE")
    if destination is Destination.UKRAINE:
        if carrier is None:
            raise ValidationFailedError(
                "An order within Ukraine goes by a carrier: pick one", reason="CARRIER"
            )
        if note is not None:
            raise ValidationFailedError(
                "Within Ukraine the waybill says how it went", reason="NOTE_ABROAD_ONLY"
            )
        if number is not None and not waybill_key(number):
            raise ValidationFailedError("A waybill has letters or digits", reason="WAYBILL")
    else:
        if carrier is not None:
            raise ValidationFailedError(
                "Abroad, the note says how it went", reason="CARRIER_WITHIN_UKRAINE"
            )
        if number is not None:
            raise ValidationFailedError(
                "Abroad, the note says how it went", reason="WAYBILL_WITHIN_UKRAINE"
            )
    return Shipping(destination=destination, carrier=carrier, waybill=number, abroad_note=note)


def _shipping_of(order: CustomerOrder) -> Shipping | None:
    if order.destination is None:
        return None
    return Shipping(
        destination=Destination(order.destination),
        carrier=Carrier(order.carrier) if order.carrier else None,
        waybill=order.waybill,
        abroad_note=order.abroad_note,
    )


def _ship(
    session: AsyncSession,
    scope: RequestScope,
    order: CustomerOrder,
    shipping: Shipping,
    kind: ShippingChangeKind,
) -> None:
    """The order goes so now, and its history says so."""
    order.destination = shipping.destination.value
    order.carrier = shipping.carrier.value if shipping.carrier else None
    order.waybill = shipping.waybill
    order.waybill_key = waybill_key(shipping.waybill) if shipping.waybill else None
    order.abroad_note = shipping.abroad_note
    session.add(
        CustomerOrderShippingChange(
            organization_id=order.organization_id,
            order_id=order.id,
            kind=kind.value,
            destination=order.destination,
            carrier=order.carrier,
            waybill=order.waybill,
            abroad_note=order.abroad_note,
            changed_by_user_id=scope.user_id,
        )
    )


def _shipping_print(shipping: Shipping) -> dict[str, Any]:
    return {
        "destination": shipping.destination.value,
        "carrier": shipping.carrier.value if shipping.carrier else None,
        "waybill": shipping.waybill,
        "abroad_note": shipping.abroad_note,
    }


async def _shipping_detail(session: AsyncSession, order: CustomerOrder) -> dict[str, Any]:
    """Every version of where the order went, and the store's other orders
    carrying the same waybill — saved anyway, since several orders may go in
    one parcel (owner decision, 2026-10-01)."""
    history = (
        await session.execute(
            select(CustomerOrderShippingChange, AppUser.display_name)
            .join(AppUser, AppUser.id == CustomerOrderShippingChange.changed_by_user_id)
            .where(CustomerOrderShippingChange.order_id == order.id)
            .order_by(CustomerOrderShippingChange.created_at, CustomerOrderShippingChange.id)
        )
    ).all()
    same = (
        (
            await session.execute(
                select(CustomerOrder.id, CustomerOrder.status)
                .where(
                    CustomerOrder.organization_id == order.organization_id,
                    CustomerOrder.store_id == order.store_id,
                    CustomerOrder.waybill_key == order.waybill_key,
                    CustomerOrder.id != order.id,
                )
                .order_by(CustomerOrder.created_at.desc(), CustomerOrder.id)
                .limit(MAX_SAME_WAYBILL)
            )
        ).all()
        if order.waybill_key
        else []
    )
    return {
        "shipping_history": [
            {
                "kind": change.kind,
                "destination": change.destination,
                "carrier": change.carrier,
                "waybill": change.waybill,
                "abroad_note": change.abroad_note,
                "by": name,
                "at": change.created_at.isoformat(),
            }
            for change, name in history
        ],
        "same_waybill": [{"id": str(row.id), "status": row.status} for row in same],
    }


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
    # "ship", where the order goes, needs what making it does, and no
    # warehouse's right: no goods move.
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
        "destination": order.destination,
        "carrier": order.carrier,
        "waybill": order.waybill,
        "abroad_note": order.abroad_note,
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
    credit: credit_service.CreditView | None = None,
    shipping_before: Shipping | None = None,
    payment_method: PaymentMethod | None = None,
) -> dict[str, Any]:
    await session.flush()
    body = (
        _response(order, items)
        | _credit(credit)
        | await _shipping_detail(session, order)
        # The collection's own answer says how it was paid, as the seller
        # said it; a read takes it from the collected sale (ADR-0012, B10).
        | print_of(payment_method)
    )
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
        before=(
            {"status": before}
            | ({"shipping": _shipping_print(shipping_before)} if shipping_before else {})
            if before
            else None
        ),
        after={
            "status": order.status,
            "store_id": str(order.store_id),
            "reason": reason,
            "sale_id": body["sale_id"],
        }
        | (
            {"shipping": _shipping_print(shipping)}
            if (shipping := _shipping_of(order)) is not None
            else {}
        ),
    )
    await session.flush()
    return body


def _credit(credit: credit_service.CreditView | None) -> dict[str, Any]:
    """A collected order paid in parts: what is paid and owed so far."""
    if credit is None:
        return {}
    return {
        "credit": {
            "credit_id": str(credit.id),
            "paid": str(credit.paid),
            "owed": str(credit.owed),
        }
    }


async def create_order(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    command_id: uuid.UUID,
    lines: list[OrderLineInput],
    destination: Destination = Destination.UKRAINE,
    carrier: Carrier | None = None,
) -> dict[str, Any]:
    """An order, reserving its goods, and where it goes: within Ukraine by
    a carrier, or abroad (owner decisions, 2026-10-01)."""
    validate_lines(lines)
    await _authorize(session, scope, store_id, lines, "create")
    stated = carrier is not None or destination is not Destination.UKRAINE
    request_fingerprint = fingerprint(
        {
            "action": "create",
            # Only when stated, so a command sent before orders said where
            # they go keeps its print and is still answered with its order.
            **(
                {"destination": destination.value, "carrier": carrier.value if carrier else None}
                if stated
                else {}
            ),
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
    # Under the command's lock, and nothing recorded under it: every refusal
    # from here on proves this order recorded nothing, and says so, so a
    # phone that never heard its answer can settle it (ADR-0013 §1).
    with nothing_recorded():
        shipping = check_shipping(destination, carrier)
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
        _ship(session, scope, order, shipping, ShippingChangeKind.CREATED)
        return await _save(
            session, scope, order, items, command_id, request_fingerprint, "created", None
        )


# An order not yet collected, cancelled or come back: its goods are still
# held for the customer.
OPEN_STATUSES = frozenset(
    {OrderStatus.READY_TO_DISPATCH, OrderStatus.DISPATCHED, OrderStatus.ARRIVED}
)


async def open_order_count(
    session: AsyncSession, *, organization_id: uuid.UUID, store_id: uuid.UUID
) -> int:
    """How many of this store's orders are still open. Only a store with
    none is archived (owner decision, 2026-10-01)."""
    return int(
        await session.scalar(
            select(func.count(CustomerOrder.id)).where(
                CustomerOrder.organization_id == organization_id,
                CustomerOrder.store_id == store_id,
                CustomerOrder.status.in_([status.value for status in OPEN_STATUSES]),
            )
        )
        or 0
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
    credit = (
        await credit_service.credit_for_sale(session, sale_id=order.sale_id)
        if order.sale_id is not None
        else None
    )
    return _response(order, items) | _credit(credit) | await _shipping_detail(session, order)


async def list_orders(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0,
    waybill: str | None = None,
) -> dict[str, Any]:
    """Filter every source's current permission before ordering and pagination.

    `waybill` finds the orders whose waybill holds it, however either is
    spaced (owner decision, 2026-10-01)."""
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
    wanted = waybill_key(waybill or "")
    orders = list(
        (
            await session.scalars(
                select(CustomerOrder)
                .where(
                    CustomerOrder.organization_id == scope.organization_id,
                    CustomerOrder.store_id == store_id,
                    ~inaccessible_item,
                    *([CustomerOrder.waybill_key.contains(wanted)] if wanted else []),
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
    credit: credit_service.CreditTerms | None = None,
    waybill: str | None = None,
    abroad_note: str | None = None,
    payment_method: PaymentMethod | None = None,
    method_required: bool = True,
) -> dict[str, Any]:
    """`waybill`, or `abroad_note` for an order going abroad, may come with
    `dispatch`: written when the order is sent, or later (owner decision,
    2026-10-01).

    `payment_method` comes with `collect` only, and a new collection without
    it is refused after the replay lookup (`payment.stated_way`).
    `method_required=False` is for this service's unit tests only."""
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
    if credit is not None and action != "collect":
        raise ValidationFailedError("Only a collected order is paid in parts")
    if payment_method is not None and action != "collect":
        raise ValidationFailedError("Only a collected order says how it was paid")
    details = {
        key: value for key, value in (("waybill", waybill), ("abroad_note", abroad_note)) if value
    }
    if details and action != "dispatch":
        raise ValidationFailedError("A waybill is written when the order is sent")
    order, items = await _load(session, scope, order_id)
    await _authorize(session, scope, order.store_id, items, action)
    if credit is not None:
        # As at the till, and before any replay: a revoked grant is not
        # handed its cached answer.
        scope.require(Permission.SALE_CREDIT, order.store_id)
    request_fingerprint = fingerprint(
        {"action": action, "order_id": str(order_id), "reason": reason}
        # Only when paid in parts, so every earlier command keeps its print:
        # the same command with other terms is another operation.
        | ({"credit": credit_service.fingerprint_of(credit)} if credit is not None else {})
        # The same for a waybill written when it was sent.
        | details
        # And for the way it was paid: none on a collection kept from before
        # it was asked (ADR-0012, B13).
        | print_of(payment_method),
        actor_user_id=scope.user_id,
        store_id=order.store_id,
    )
    replay = await _command(session, scope, command_id, request_fingerprint)
    if replay is not None:
        return replay
    # The same after this command's lookup (ADR-0013 §1). Another phone may
    # have cancelled the order or taken it back meanwhile: the late command
    # is refused as a transition no longer allowed, and settles. A refused
    # «Клієнт забрав» is then typed as a sale from paper (owner decision,
    # 2026-10-07). It runs the collected sale's own lookup in here: what that
    # refuses as another command's identity leaves as it came, never
    # claiming what was recorded.
    with nothing_recorded():
        method = (
            stated_way(payment_method, takes=ORDER_METHODS, required=method_required)
            if action == "collect"
            else None
        )
        # populate_existing refreshes the row after waiting on another transition.
        await session.refresh(order, with_for_update=True)
        allowed, target = transitions[action]
        opened: credit_service.CreditView | None = None
        if order.status not in allowed:
            raise ValidationFailedError(
                "Invalid order transition", status=order.status, action=action
            )
        before = order.status
        shipped = _shipping_of(order)
        if details:
            if shipped is None:
                raise ValidationFailedError(
                    "Say where the order goes before its waybill", reason="NO_DESTINATION"
                )
            _ship(
                session,
                scope,
                order,
                check_shipping(
                    shipped.destination,
                    shipped.carrier,
                    waybill if waybill else shipped.waybill,
                    abroad_note if abroad_note else shipped.abroad_note,
                ),
                ShippingChangeKind.DISPATCHED,
            )
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
                payment_method=method,
            )
            order.sale_id = sale.id
            # Collected before the debt is opened: an order holds a sale only
            # once collected, and opening the debt flushes the order.
            order.status = target
            if credit is not None:
                # In the collection's own transaction: the debt exists exactly
                # when the sale does.
                # Its first payment is the part paid now, which takes any of the
                # five ways (ADR-0012, G2).
                opened = await credit_service.open_credit(
                    session, scope=scope, sale=sale, credit=credit, payment_method=method
                )
        order.status = target
        return await _save(
            session,
            scope,
            order,
            items,
            command_id,
            request_fingerprint,
            action,
            before,
            reason,
            credit=opened,
            payment_method=method,
        )


async def change_shipping(
    session: AsyncSession,
    *,
    scope: RequestScope,
    order_id: uuid.UUID,
    command_id: uuid.UUID,
    destination: Destination,
    carrier: Carrier | None,
    waybill: str | None,
    abroad_note: str | None,
) -> dict[str, Any]:
    """Where an open order goes, corrected or written later, by whoever works
    with orders; every earlier version stays (owner decisions, 2026-10-01).
    Nothing changed, nothing is added to its history."""
    order, items = await _load(session, scope, order_id)
    await _authorize(session, scope, order.store_id, items, "ship")
    request_fingerprint = fingerprint(
        {
            "action": "ship",
            "order_id": str(order_id),
            "destination": destination.value,
            "carrier": carrier.value if carrier else None,
            "waybill": waybill,
            "abroad_note": abroad_note,
        },
        actor_user_id=scope.user_id,
        store_id=order.store_id,
    )
    replay = await _command(session, scope, command_id, request_fingerprint)
    if replay is not None:
        return replay
    # The same after this command's lookup (ADR-0013 §1).
    with nothing_recorded():
        await session.refresh(order, with_for_update=True)
        if order.status not in OPEN_STATUSES:
            raise ValidationFailedError(
                "The order is closed: where it went stays as it was",
                reason="ORDER_CLOSED",
                status=order.status,
            )
        shipping = check_shipping(destination, carrier, waybill, abroad_note)
        before = _shipping_of(order)
        if shipping != before:
            _ship(session, scope, order, shipping, ShippingChangeKind.CORRECTED)
        return await _save(
            session,
            scope,
            order,
            items,
            command_id,
            request_fingerprint,
            "shipping_changed",
            order.status,
            shipping_before=before,
        )
