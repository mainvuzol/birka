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

`missing_in_store` is its mirror (M1-030), and the owner settled its one open
question on 2026-09-17: **the sale proceeds for the quantity that is actually
there.** A seller who goes for two coats and finds one sells the one, and the
unit the system believed in is removed by a negative `ADJUSTMENT` with reason
`MISSING_AT_SALE`. It is bounded twice over — by the line being sold, and by
what the ledger already believed — so it can never become a stocktake, and it
is not a write-off.
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
    UnknownSizeStockError,
    ValidationFailedError,
)
from app.core.logging import get_logger
from app.modules.audit import service as audit
from app.modules.authz.locations import require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.read import describe_variants, size_label, unknown_size_ids
from app.modules.inventory.models import MovementReason, MovementType
from app.modules.inventory.service import (
    MovementRequest,
    apply_movements,
    available_stock,
    lock_stock,
    reserved_stock,
    sale_correction_ids,
    sale_shortage_ids,
)
from app.modules.sales.models import Sale, SaleItem
from app.modules.tenancy.service import LocationCapability

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
    # Which warehouse these units leave. Stated per line and never guessed:
    # the owner's rule of 2026-09-17 forbids falling back to another location
    # when one is short, because the mistake is invisible until someone counts.
    source_location_id: uuid.UUID
    quantity: int
    unit_price: Decimal
    discount_amount: Decimal = Decimal("0")


@dataclass(frozen=True, slots=True)
class FoundInStore:
    """ "The coat is here, the app says zero." Index into the sale's lines.

    The correction lands at the line's own `source_location_id`, so a seller
    confirming goods is confirming them on a specific shelf.
    """

    line_index: int
    quantity: int


@dataclass(frozen=True, slots=True)
class MissingInStore:
    """ "The app says two, there is one on the rack." Index into the sale's lines.

    `quantity` is the number of units **present**, never the size of the
    shortage. A person counting a shelf knows what they can see; asking them
    to subtract at the counter is how off-by-one errors get into a ledger.
    """

    line_index: int
    quantity: int


@dataclass(frozen=True, slots=True)
class SaleResult:
    sale: Sale
    items: list[SaleItem]
    corrections: list[uuid.UUID] = field(default_factory=list)
    # Kept apart from `corrections` rather than merged into one list of
    # adjustments: one of them puts goods on a shelf and the other takes them
    # off, and a receipt that blurs the two is the beginning of a balance
    # nobody can explain.
    shortages: list[uuid.UUID] = field(default_factory=list)


MAX_MONEY = Decimal("9999999999.99")
# (location, variant, size) — the stock key since ADR-0004.
StockKey = tuple[uuid.UUID, uuid.UUID, uuid.UUID]


def _amount(value: Decimal) -> Decimal:
    """Accept only finite, nonnegative NUMERIC(12,2) values at the service boundary."""
    if not isinstance(value, Decimal) or not value.is_finite() or value < 0 or value > MAX_MONEY:
        raise ValidationFailedError("Money must be a finite nonnegative Decimal within range")
    rounded = money(value)
    if rounded != value:
        raise ValidationFailedError("Money cannot have fractions of a kopeck")
    return rounded


def _stock_key(line: SaleLineInput) -> StockKey:
    return (line.source_location_id, line.product_variant_id, line.size_id)


def _validate_reports(
    lines: list[SaleLineInput],
    found_in_store: list[FoundInStore],
    missing_in_store: list[MissingInStore],
) -> None:
    """Index checks both reports share, plus the one rule that spans them.

    A seller may not say of the same goods that there are more here than the
    system thinks *and* fewer. The rule is stated per stock key rather than
    per line: two lines drawing the same variant and size from the same
    warehouse are two statements about one shelf, and they would contradict
    each other just as flatly.
    """
    for label, reports in (
        ("found_in_store", found_in_store),
        ("missing_in_store", missing_in_store),
    ):
        seen_indexes: set[int] = set()
        for report in reports:
            if type(report.line_index) is not int or not 0 <= report.line_index < len(lines):
                raise ValidationFailedError(f"{label} refers to a line that does not exist")
            if report.line_index in seen_indexes:
                raise ValidationFailedError(f"Duplicate {label} line index")
            seen_indexes.add(report.line_index)

    contested = {_stock_key(lines[found.line_index]) for found in found_in_store} & {
        _stock_key(lines[missing.line_index]) for missing in missing_in_store
    }
    if contested:
        raise ValidationFailedError(
            "The same goods cannot be reported both present and missing in one sale"
        )


def _resolve_shortages(
    *,
    store_id: uuid.UUID,
    lines: list[SaleLineInput],
    missing_in_store: list[MissingInStore],
    quantities: dict[StockKey, int],
) -> tuple[list[SaleLineInput], list[MovementRequest]]:
    """Reduce the reported lines to what is there, and write off only what the
    ledger already believed in.

    Two bounds, and the second is the one that keeps this safe. The seller's
    statement is about the units they went to fetch, so the correction can
    never exceed the line being sold. And the ledger may only remove stock it
    thinks exists: it believed in `min(available, demand)` for this basket, the
    seller found `confirmed`, and the difference is all that may be taken off.
    Anything beyond that would be a claim about the rest of the shelf — a
    stocktake, which needs `inventory:adjust` and a manager.

    So when the system already believed in no more than the seller found,
    nothing is written at all: the sale is still for the confirmed quantity,
    but there is no discrepancy to record.
    """
    if not missing_in_store:
        return lines, []

    demand: dict[StockKey, int] = {}
    for line in lines:
        key = _stock_key(line)
        demand[key] = demand.get(key, 0) + line.quantity

    present: dict[int, int] = {}
    for missing in missing_in_store:
        line = lines[missing.line_index]
        if type(missing.quantity) is not int or missing.quantity < 0:
            raise ValidationFailedError(
                "A shortage report must state how many units are present, as an integer"
            )
        if missing.quantity == 0:
            # Deliberately refused rather than quietly dropping the line: the
            # basket that comes back would no longer be the basket that was
            # sent. Recording an empty shelf with nothing to sell is a
            # stocktake, and `POST /inventory/adjustments` is where it lives.
            raise ValidationFailedError(
                "A line with nothing present cannot be sold; remove it from the basket",
                line_index=missing.line_index,
            )
        if missing.quantity >= line.quantity:
            raise ValidationFailedError(
                "Nothing is missing on this line: the confirmed count is not "
                "lower than the quantity being sold",
                line_index=missing.line_index,
            )
        present[missing.line_index] = missing.quantity

    confirmed: dict[StockKey, int] = {}
    adjusted: list[SaleLineInput] = []
    for index, line in enumerate(lines):
        quantity = present.get(index, line.quantity)
        key = _stock_key(line)
        confirmed[key] = confirmed.get(key, 0) + quantity
        adjusted.append(line if quantity == line.quantity else replace(line, quantity=quantity))

    requests: list[MovementRequest] = []
    for key in sorted({_stock_key(lines[missing.line_index]) for missing in missing_in_store}):
        believed = min(quantities[key], demand[key])
        shortfall = believed - confirmed[key]
        if shortfall <= 0:
            continue
        requests.append(
            MovementRequest(
                location_id=key[0],
                acting_store_id=store_id,
                product_variant_id=key[1],
                size_id=key[2],
                quantity_delta=-shortfall,
                movement_type=MovementType.ADJUSTMENT,
                reason_code=MovementReason.MISSING_AT_SALE,
            )
        )
    return adjusted, requests


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
        key = _stock_key(line)
        demand[key] = demand.get(key, 0) + line.quantity

    requested: dict[StockKey, int] = {}
    for found in found_in_store:
        if type(found.quantity) is not int or found.quantity <= 0:
            raise ValidationFailedError("A correction must add a positive integer quantity")
        line = lines[found.line_index]
        key = _stock_key(line)
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
                location_id=key[0],
                acting_store_id=store_id,
                product_variant_id=key[1],
                size_id=key[2],
                quantity_delta=quantity,
                movement_type=MovementType.ADJUSTMENT,
                reason_code=MovementReason.FOUND_DURING_SALE,
            )
        )
    return corrections


async def _refuse_a_second_count_of_unknown_size_stock(
    session: AsyncSession, *, organization_id: uuid.UUID, corrections: list[MovementRequest]
) -> None:
    """«Фізично є» may not count a coat that a legacy list may already count.

    A legacy list loads goods nobody recorded a size for as "size not known"
    (F34, M1-023). Both directions of a correction could then count one coat
    twice, with nothing to ever notice, so both are refused with their own
    code:

    * A sized unit while the same variant is available here with size not
      known. A seller selling one of those coats as, say, M finds the system
      at zero for M; correcting M upward would leave the size-unknown balance
      still counting it. The seller sells it as size not known, or someone
      reclassifies it first.
    * A size-not-known unit, ever. "Size not known" enters only from a list,
      where its evidence exists (ADR-0005 §3); at the counter the coat is in
      hand and its size can be read. Added here, it could be the very M the
      ledger already holds.

    Read without locking the size-unknown keys, deliberately: a concurrent sale
    of the last such unit can only make this refuse once more than it had to,
    never let a second count through. An opening balance cannot land in
    between — it waits for this command's warehouse lock (`lock_stock`).
    Whether a seller may instead reclassify at the counter is the owner's
    decision (M1-023 report).
    """
    unknown = await unknown_size_ids(session, organization_id=organization_id)
    for correction in corrections:
        if correction.size_id in unknown:
            raise UnknownSizeStockError(
                "«Фізично є» never adds stock with its size not known; sell it by its size",
                location_id=str(correction.location_id),
                product_variant_id=str(correction.product_variant_id),
                unknown_size_id=str(correction.size_id),
                reason="FOUND_AS_SIZE_NOT_KNOWN",
            )
    keys = [
        (correction.location_id, correction.product_variant_id, size_id)
        for correction in corrections
        for size_id in sorted(unknown)
    ]
    if not keys:
        return
    for key, quantity in (await available_stock(session, keys=keys)).items():
        if quantity > 0:
            raise UnknownSizeStockError(
                location_id=str(key[0]),
                product_variant_id=str(key[1]),
                unknown_size_id=str(key[2]),
                available=quantity,
            )


async def correction_ids(session: AsyncSession, sale: Sale) -> list[uuid.UUID]:
    """Recover the durable correction references, including receipts made before replay caching."""
    return await sale_correction_ids(session, organization_id=sale.organization_id, sale_id=sale.id)


async def shortage_ids(session: AsyncSession, sale: Sale) -> list[uuid.UUID]:
    """The same, for the shortages reported while the sale was made."""
    return await sale_shortage_ids(session, organization_id=sale.organization_id, sale_id=sale.id)


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
        sale=existing,
        items=items,
        corrections=await correction_ids(session, existing),
        shortages=await shortage_ids(session, existing),
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
    missing_in_store: list[MissingInStore] | None = None,
    correlation_id: str | None = None,
) -> SaleResult:
    """Sell the basket, or raise and let the transaction roll back."""
    if not lines:
        raise ValidationFailedError("A sale must contain at least one line")

    scope.require(Permission.SALE_CREATE, store_id)
    corrections_requested = found_in_store or []
    shortages_requested = missing_in_store or []
    if corrections_requested:
        # A narrow capability a seller may hold, unlike inventory:adjust.
        scope.require(Permission.INVENTORY_CORRECT_DURING_SALE, store_id)
    if shortages_requested:
        # Required separately: taking stock off a shelf is not the same
        # authority as putting it on, and neither implies the other.
        scope.require(Permission.INVENTORY_REPORT_MISSING_DURING_SALE, store_id)

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
    _validate_reports(lines, corrections_requested, shortages_requested)
    request_fingerprint = idempotency.fingerprint(
        {
            "currency_code": currency_code,
            "lines": [
                {
                    "product_variant_id": str(line.product_variant_id),
                    "size_id": str(line.size_id),
                    # Without this, the same command_id retried against a
                    # different warehouse would be judged an identical retry
                    # and replayed — telling the caller "sold" about stock it
                    # never named. The 7-day cache picks the field up on its
                    # own; this permanent one is built by hand and does not.
                    "source_location_id": str(line.source_location_id),
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
            # In the permanent fingerprint for the same reason the warehouse
            # is: the same command_id retried without the shortage report is a
            # different business command — it sells two coats, not one.
            "missing_in_store": [
                {"line_index": missing.line_index, "quantity": missing.quantity}
                for missing in shortages_requested
            ],
        },
        actor_user_id=scope.user_id,
        store_id=store_id,
    )
    # Invariant I23: the person may sell, but may this store sell *here*?
    # Checked before any row is locked, and before any stock is read.
    #
    # `can_sell` is the whole requirement, including for a FOUND_DURING_SALE
    # correction, and that is a deliberate rule rather than an oversight —
    # every *other* path that adds stock demands `can_receive`. Two reasons.
    # The owner's decision of 2026-09-17 grants a child-store seller "фізично
    # є" at any warehouse they can reach, and the correction cannot leave that
    # warehouse fuller than it found it: `_resolve_corrections` caps it at
    # exactly the shortfall this sale is about to consume, so the net movement
    # is `correction - demand`, which is never positive. A store denied
    # `can_receive` here still cannot deliver goods into this warehouse; it can
    # only account for goods it is simultaneously carrying out of it.
    await require_stock_access(
        session,
        scope=scope,
        permission=Permission.SALE_CREATE,
        store_id=store_id,
        location_ids={line.source_location_id for line in lines},
        capability=LocationCapability.SELL,
    )

    for reports, permission in (
        (corrections_requested, Permission.INVENTORY_CORRECT_DURING_SALE),
        (shortages_requested, Permission.INVENTORY_REPORT_MISSING_DURING_SALE),
    ):
        if reports:
            await require_stock_access(
                session,
                scope=scope,
                store_id=store_id,
                permission=permission,
                location_ids={
                    lines[report.line_index].source_location_id
                    for report in reports
                    if 0 <= report.line_index < len(lines)
                },
                capability=LocationCapability.SELL,
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
        keys=[(line.source_location_id, line.product_variant_id, line.size_id) for line in lines],
        acting_store_ids={store_id},
    )
    reserved = await reserved_stock(session, keys=list(quantities))
    for report in corrections_requested + shortages_requested:
        line = lines[report.line_index]
        key = (line.source_location_id, line.product_variant_id, line.size_id)
        if reserved.get(key, 0):
            raise ValidationFailedError("Release reservations before correcting this stock key")
    quantities = {key: physical - reserved.get(key, 0) for key, physical in quantities.items()}
    described = await describe_variants(session, [line.product_variant_id for line in lines])
    for line in lines:
        description = described.get(line.product_variant_id)
        if description is None or description.organization_id != scope.organization_id:
            raise NotFoundError(
                "Unknown product variant", product_variant_id=str(line.product_variant_id)
            )

    # Shortages first: they reduce the lines, and everything downstream — the
    # money, the sale movements, the stored items — is about what is actually
    # being sold. The two reports never touch the same stock key, so the
    # corrections below still see the demand they were written against.
    lines, shortages = _resolve_shortages(
        store_id=store_id,
        lines=lines,
        missing_in_store=shortages_requested,
        quantities=quantities,
    )
    corrections = _resolve_corrections(
        store_id=store_id, lines=lines, found_in_store=corrections_requested, quantities=quantities
    )
    if corrections:
        await _refuse_a_second_count_of_unknown_size_stock(
            session, organization_id=scope.organization_id, corrections=corrections
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
    shortage_ids: list[uuid.UUID] = []
    if corrections or shortages:
        # Applied before the sale lines, in one batch. Before, because stock
        # must be on the books before it can be sold and the ledger has to
        # read in that order. One batch, because two calls would take locks in
        # two orders — the deadlock `apply_movements`' global sort prevents.
        applied = await apply_movements(
            session,
            organization_id=scope.organization_id,
            requests=[
                replace(adjustment, reference_type="sale", reference_id=sale.id)
                for adjustment in corrections + shortages
            ],
            actor_user_id=scope.user_id,
            correlation_id=correlation_id,
        )
        for entry in applied:
            found = entry.request.reason_code is MovementReason.FOUND_DURING_SALE
            if found:
                correction_ids.append(entry.movement_id)
            else:
                shortage_ids.append(entry.movement_id)
            await audit.record(
                session,
                organization_id=scope.organization_id,
                actor_user_id=scope.user_id,
                action="inventory.found_during_sale" if found else "inventory.missing_at_sale",
                entity_type="stock_movement",
                entity_id=entry.movement_id,
                before={"quantity": entry.quantity_after - entry.request.quantity_delta},
                after={"quantity": entry.quantity_after},
                reason=(
                    MovementReason.FOUND_DURING_SALE.value
                    if found
                    else MovementReason.MISSING_AT_SALE.value
                ),
            )

    await apply_movements(
        session,
        organization_id=scope.organization_id,
        requests=[
            MovementRequest(
                location_id=line.source_location_id,
                acting_store_id=store_id,
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
            source_location_id=line.source_location_id,
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
        shortages=len(shortage_ids),
        total=str(sale.total),
    )
    return SaleResult(sale=sale, items=items, corrections=correction_ids, shortages=shortage_ids)


__all__ = [
    "FoundInStore",
    "MissingInStore",
    "SaleLineInput",
    "SaleResult",
    "correction_ids",
    "create_sale",
    "money",
    "shortage_ids",
]
