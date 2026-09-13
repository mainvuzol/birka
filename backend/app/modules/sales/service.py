"""The sale command.

One transaction, owned by this service. Either the sale, every stock movement,
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

import uuid
from dataclasses import dataclass, field, replace
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    CorrectionExceedsShortfallError,
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
    current_quantity,
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


async def _resolve_corrections(
    session: AsyncSession,
    *,
    store_id: uuid.UUID,
    lines: list[SaleLineInput],
    found_in_store: list[FoundInStore],
) -> list[MovementRequest]:
    """Turn "it is on the rack" into exact, audited corrections.

    Each correction must equal the shortfall precisely. This is not a back door
    to arbitrary stock editing: correcting more than is missing is refused, and
    broad adjustment stays a manager/owner permission.
    """
    corrections: list[MovementRequest] = []
    for found in found_in_store:
        if not 0 <= found.line_index < len(lines):
            raise ValidationFailedError(
                "found_in_store refers to a line that does not exist",
                line_index=found.line_index,
            )
        if found.quantity <= 0:
            raise ValidationFailedError("A correction must add stock", line_index=found.line_index)

        line = lines[found.line_index]
        available = await current_quantity(
            session,
            store_id=store_id,
            product_variant_id=line.product_variant_id,
            size_id=line.size_id,
        )
        shortfall = line.quantity - available
        if found.quantity != shortfall:
            raise CorrectionExceedsShortfallError(
                line_index=found.line_index,
                requested=found.quantity,
                shortfall=max(shortfall, 0),
                available=available,
            )

        corrections.append(
            MovementRequest(
                store_id=store_id,
                product_variant_id=line.product_variant_id,
                size_id=line.size_id,
                quantity_delta=found.quantity,
                movement_type=MovementType.ADJUSTMENT,
                reason_code=MovementReason.FOUND_DURING_SALE,
            )
        )
    return corrections


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

    described = await describe_variants(session, [line.product_variant_id for line in lines])
    for line in lines:
        description = described.get(line.product_variant_id)
        if description is None:
            raise NotFoundError(
                "Unknown product variant", product_variant_id=str(line.product_variant_id)
            )
        if description.organization_id != scope.organization_id:
            # A variant id supplied by the client is data to validate, never
            # proof of access (invariant I12).
            raise NotFoundError(
                "Unknown product variant", product_variant_id=str(line.product_variant_id)
            )
        if line.quantity <= 0:
            raise ValidationFailedError("Quantity must be positive")
        if line.unit_price < 0 or line.discount_amount < 0:
            raise ValidationFailedError("Prices and discounts cannot be negative")
        if line.discount_amount > line.unit_price:
            raise ValidationFailedError("A discount cannot exceed the price")

    corrections = await _resolve_corrections(
        session, store_id=store_id, lines=lines, found_in_store=corrections_requested
    )

    subtotal = money(sum((line.unit_price * line.quantity for line in lines), Decimal("0")))
    discount_total = money(
        sum((line.discount_amount * line.quantity for line in lines), Decimal("0"))
    )

    sale = Sale(
        organization_id=scope.organization_id,
        store_id=store_id,
        seller_user_id=scope.user_id,
        command_id=command_id,
        currency_code=currency_code,
        subtotal=subtotal,
        discount_total=discount_total,
        total=money(subtotal - discount_total),
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


__all__ = ["FoundInStore", "SaleLineInput", "SaleResult", "create_sale", "money"]
