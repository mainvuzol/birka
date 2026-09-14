"""The sale command.

One transaction, committed or rolled back by the caller. Either the sale, every stock movement,
every correction and the audit entry all commit, or none of them do.

Money is `Decimal` throughout and rounded once, per line, half-up. Totals are
the sum of the stored line totals — never recomputed from unit prices later,
and never read back from the catalog (invariant I8).

The `found_in_store` path is business fact F30: the notebook is often behind
reality, so the app will sometimes say zero while the coat is on the rack. The
seller is not blocked; the shortfall is corrected as an explicit, audited
`ADJUSTMENT` with reason `FOUND_DURING_SALE`, in the same transaction as the
sale. Stock never goes negative and both halves are in the ledger.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field, replace
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import (
    CorrectionExceedsShortfallError,
    IdempotencyConflictError,
    NotFoundError,
    ValidationFailedError,
)
from app.core.logging import get_logger
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.read import describe_variants, size_label
from app.modules.inventory.models import MovementReason, MovementType
from app.modules.inventory.service import (
    MovementRequest,
    apply_movements,
    lock_stock,
    sale_correction_ids,
)
from app.modules.sales.models import Sale, SaleItem

logger = get_logger(__name__)

CENTS = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    """Round once, half-up, to the currency's smallest unit.

    Rounding at the line is deliberate: rounding totals instead would let a
    receipt disagree with the sum of the lines printed on it.
    """
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


@dataclass(frozen=True, slots=True)
class SaleLineInput:
    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int
    unit_price: Decimal
    discount_amount: Decimal = Decimal("0")


@dataclass(frozen=True, slots=True)
class FoundInStore:
    """ "The coat is here, the app says zero." Index into the sale's lines."""

    line_index: int
    quantity: int


@dataclass(frozen=True, slots=True)
class SaleResult:
    sale: Sale
    items: list[SaleItem]
    corrections: list[uuid.UUID] = field(default_factory=list)


MAX_MONEY = Decimal("9999999999.99")
StockKey = tuple[uuid.UUID, uuid.UUID, uuid.UUID]


def _amount(value: Decimal) -> Decimal:
    """Accept only finite, nonnegative NUMERIC(12,2) values at the service boundary."""
    if not isinstance(value, Decimal) or not value.is_finite() or value < 0 or value > MAX_MONEY:
        raise ValidationFailedError("Money must be a finite nonnegative Decimal within range")
    rounded = money(value)
    if rounded != value:
        raise ValidationFailedError("Money cannot have fractions of a kopeck")
    return rounded


def _resolve_corrections(
    *,
    store_id: uuid.UUID,
    lines: list[SaleLineInput],
    found_in_store: list[FoundInStore],
    quantities: dict[StockKey, int],
) -> list[MovementRequest]:
    """Validate the total shortfall of each locked stock key, not isolated lines."""
    demand: dict[StockKey, int] = {}
    for line in lines:
        key = (store_id, line.product_variant_id, line.size_id)
        demand[key] = demand.get(key, 0) + line.quantity

    requested: dict[StockKey, int] = {}
    seen_indexes: set[int] = set()
    for found in found_in_store:
        if type(found.line_index) is not int or not 0 <= found.line_index < len(lines):
            raise ValidationFailedError("found_in_store refers to a line that does not exist")
        if found.line_index in seen_indexes:
            raise ValidationFailedError("Duplicate found_in_store line index")
        seen_indexes.add(found.line_index)
        if type(found.quantity) is not int or found.quantity <= 0:
            raise ValidationFailedError("A correction must add a positive integer quantity")
        line = lines[found.line_index]
        key = (store_id, line.product_variant_id, line.size_id)
        requested[key] = requested.get(key, 0) + found.quantity

    corrections: list[MovementRequest] = []
    for key, quantity in requested.items():
        available = quantities[key]
        shortfall = max(demand[key] - available, 0)
        if quantity != shortfall:
            raise CorrectionExceedsShortfallError(
                product_variant_id=str(key[1]),
                size_id=str(key[2]),
                requested=quantity,
                shortfall=shortfall,
                available=available,
            )
        corrections.append(
            MovementRequest(
                store_id=store_id,
                product_variant_id=key[1],
                size_id=key[2],
                quantity_delta=quantity,
                movement_type=MovementType.ADJUSTMENT,
                reason_code=MovementReason.FOUND_DURING_SALE,
            )
        )
    return corrections


async def correction_ids(session: AsyncSession, sale: Sale) -> list[uuid.UUID]:
    """Recover the durable correction references, including receipts made before replay caching."""
    return await sale_correction_ids(session, organization_id=sale.organization_id, sale_id=sale.id)


async def _existing_command(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    request_fingerprint: str,
) -> SaleResult | None:
    # Serialize this permanent command before taking stock locks. Hash collisions
    # only serialize unrelated commands; the exact UUID pair still identifies the sale.
    lock_key = int.from_bytes(
        hashlib.sha256(scope.organization_id.bytes + command_id.bytes).digest()[:8],
        byteorder="big",
        signed=True,
    )
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
    existing = await session.scalar(
        select(Sale).where(
            Sale.organization_id == scope.organization_id, Sale.command_id == command_id
        )
    )
    if existing is None:
        return None
    if existing.command_fingerprint != request_fingerprint:
        # Older rows have no provable original payload. Never guess that a retry
        # matches, nor turn an old command into another business operation.
        details = {"command_id": str(command_id)}
        if existing.store_id in scope.store_ids and scope.can(
            Permission.SALE_VIEW, existing.store_id
        ):
            details["sale_id"] = str(existing.id)
        message = (
            "The original request for this existing sale cannot be verified"
            if existing.command_fingerprint is None
            else "This command_id was already used with a different request"
        )
        raise IdempotencyConflictError(message, **details)
    scope.require(Permission.SALE_VIEW, existing.store_id)
    items = list(
        (await session.scalars(select(SaleItem).where(SaleItem.sale_id == existing.id))).all()
    )
    return SaleResult(
        sale=existing, items=items, corrections=await correction_ids(session, existing)
    )


async def create_sale(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    command_id: uuid.UUID,
    lines: list[SaleLineInput],
    currency_code: str,
    found_in_store: list[FoundInStore] | None = None,
    correlation_id: str | None = None,
) -> SaleResult:
    """Sell the basket, or raise and let the transaction roll back."""
    if not lines:
        raise ValidationFailedError("A sale must contain at least one line")

    scope.require(Permission.SALE_CREATE, store_id)
    corrections_requested = found_in_store or []
    if corrections_requested:
        # A narrow capability a seller may hold, unlike inventory:adjust.
        scope.require(Permission.INVENTORY_CORRECT_DURING_SALE, store_id)

    if currency_code != "UAH":
        raise ValidationFailedError("Only UAH is supported")
    normalized: list[SaleLineInput] = []
    for line in lines:
        if type(line.quantity) is not int or not 0 < line.quantity <= 1000:
            raise ValidationFailedError("Quantity must be an integer between 1 and 1000")
        unit_price = _amount(line.unit_price)
        discount_amount = _amount(line.discount_amount)
        if discount_amount > unit_price:
            raise ValidationFailedError("A discount cannot exceed the price")
        normalized.append(replace(line, unit_price=unit_price, discount_amount=discount_amount))
    lines = normalized
    request_fingerprint = idempotency.fingerprint(
        {
            "currency_code": currency_code,
            "lines": [
                {
                    "product_variant_id": str(line.product_variant_id),
                    "size_id": str(line.size_id),
                    "quantity": line.quantity,
                    "unit_price": str(line.unit_price),
                    "discount_amount": str(line.discount_amount),
                }
                for line in lines
            ],
            "found_in_store": [
                {"line_index": found.line_index, "quantity": found.quantity}
                for found in corrections_requested
            ],
        },
        actor_user_id=scope.user_id,
        store_id=store_id,
    )
    existing = await _existing_command(
        session, scope=scope, command_id=command_id, request_fingerprint=request_fingerprint
    )
    if existing is not None:
        return existing

    # Lock every stock key in one global order before reading any shortfall.
    # This also materializes missing rows, closing the first-receipt race.
    quantities = await lock_stock(
        session,
        organization_id=scope.organization_id,
        keys=[(store_id, line.product_variant_id, line.size_id) for line in lines],
    )
    described = await describe_variants(session, [line.product_variant_id for line in lines])
    for line in lines:
        description = described.get(line.product_variant_id)
        if description is None or description.organization_id != scope.organization_id:
            raise NotFoundError(
                "Unknown product variant", product_variant_id=str(line.product_variant_id)
            )

    corrections = _resolve_corrections(
        store_id=store_id, lines=lines, found_in_store=corrections_requested, quantities=quantities
    )
    subtotal = _amount(sum((line.unit_price * line.quantity for line in lines), Decimal("0")))
    discount_total = _amount(
        sum((line.discount_amount * line.quantity for line in lines), Decimal("0"))
    )
    line_totals = [(line.unit_price - line.discount_amount) * line.quantity for line in lines]
    total = _amount(sum(line_totals, Decimal("0")))

    sale = Sale(
        organization_id=scope.organization_id,
        store_id=store_id,
        seller_user_id=scope.user_id,
        command_id=command_id,
        command_fingerprint=request_fingerprint,
        currency_code=currency_code,
        subtotal=subtotal,
        discount_total=discount_total,
        total=total,
        correlation_id=correlation_id,
    )
    session.add(sale)
    await session.flush()

    correction_ids: list[uuid.UUID] = []
    if corrections:
        # Applied before the sale lines: the stock must be on the books before
        # it can be sold, and the ledger must read in that order too.
        applied = await apply_movements(
            session,
            organization_id=scope.organization_id,
            requests=[
                replace(correction, reference_type="sale", reference_id=sale.id)
                for correction in corrections
            ],
            actor_user_id=scope.user_id,
            correlation_id=correlation_id,
        )
        correction_ids = [entry.movement_id for entry in applied]
        for entry in applied:
            await audit.record(
                session,
                organization_id=scope.organization_id,
                actor_user_id=scope.user_id,
                action="inventory.found_during_sale",
                entity_type="stock_movement",
                entity_id=entry.movement_id,
                before={"quantity": entry.quantity_after - entry.request.quantity_delta},
                after={"quantity": entry.quantity_after},
                reason=MovementReason.FOUND_DURING_SALE.value,
            )

    await apply_movements(
        session,
        organization_id=scope.organization_id,
        requests=[
            MovementRequest(
                store_id=store_id,
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity_delta=-line.quantity,
                movement_type=MovementType.SALE,
                reference_type="sale",
                reference_id=sale.id,
            )
            for line in lines
        ],
        actor_user_id=scope.user_id,
        correlation_id=correlation_id,
    )

    items: list[SaleItem] = []
    for line in lines:
        description = described[line.product_variant_id]
        final_unit_price = money(line.unit_price - line.discount_amount)
        snapshot = dict(description.snapshot)
        snapshot["size"] = await size_label(session, line.size_id)

        item = SaleItem(
            sale_id=sale.id,
            product_variant_id=line.product_variant_id,
            size_id=line.size_id,
            quantity=line.quantity,
            unit_price=money(line.unit_price),
            discount_amount=money(line.discount_amount),
            final_unit_price=final_unit_price,
            line_total=money(final_unit_price * line.quantity),
            currency_code=currency_code,
            display_name_snapshot=description.display_name,
            variant_snapshot=snapshot,
        )
        session.add(item)
        items.append(item)

    await session.flush()

    logger.info(
        "sale.created",
        sale_id=str(sale.id),
        store_id=str(store_id),
        lines=len(items),
        corrections=len(correction_ids),
        total=str(sale.total),
    )
    return SaleResult(sale=sale, items=items, corrections=correction_ids)


__all__ = ["FoundInStore", "SaleLineInput", "SaleResult", "correction_ids", "create_sale", "money"]
