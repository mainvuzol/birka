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
is not a write-off. The owner then answered Q-G on 2026-10-01: a line with
**nothing** on the shelf is dropped from the sale and its shortage recorded the
same way, and the rest of the basket is sold. When nothing is left to sell at
all, there is no sale: that is `shelf.report_empty_shelf`, which shares this
command's identity.

`size_clarified` is the owner's answer of 2026-09-29 to M1-023's fourth
question: a legacy list may load a coat as "size not known" (F34), and the
seller, holding it, can read its size. The units the line sells then move out
of the size-not-known balance and into the size — an audited pair of
`ADJUSTMENT`s, `SIZE_RECLASSIFICATION_OUT` and `_IN` — and are sold as that
size. It is bounded like «фізично є»: exactly the shortfall this sale consumes
at that size, so nothing is reclassified that is not leaving in the basket.

`payment_method` is how the customer pays, given by the button that sells
(owner decisions, 2026-10-04): one of the till's three ways, one per sale,
never split. A sale paid in parts gives the way of the money taken now. It is
optional in the request and required of a new sale after the replay lookup,
so a sale a phone kept from before the way was asked still replays
(ADR-0012, B2, B13).
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import (
    CorrectionExceedsShortfallError,
    IdempotencyConflictError,
    InsufficientStockError,
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
    SIZE_RECLASSIFICATION_REASONS,
    AppliedMovement,
    MovementRequest,
    apply_movements,
    available_stock,
    lock_stock,
    reserved_stock,
    sale_correction_ids,
    sale_reclassification_ids,
    sale_shortage_ids,
)
from app.modules.sales.models import Sale, SaleItem, ShelfShortage
from app.modules.sales.payment import TILL_METHODS, PaymentMethod, print_of, stated_way
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
class SizeClarified:
    """ "The app has this coat as size not known; it is an M." Index into the sale's lines.

    `quantity` is how many of the units the line sells come out of the
    size-not-known balance of the same model at the line's warehouse. The
    line's own size is the one the seller read.
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
    # Apart again: a reclassification neither adds nor removes a coat, it says
    # what size one already counted is. Both halves are listed.
    reclassifications: list[uuid.UUID] = field(default_factory=list)


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


class _LineReport(Protocol):
    """What every report a seller makes about a line has in common."""

    @property
    def line_index(self) -> int: ...


def _reported_keys(lines: list[SaleLineInput], *reports: Sequence[_LineReport]) -> set[StockKey]:
    """The stock keys the given reports speak about. Indexes are validated first."""
    return {_stock_key(lines[report.line_index]) for group in reports for report in group}


def _validate_reports(
    lines: list[SaleLineInput],
    found_in_store: list[FoundInStore],
    missing_in_store: list[MissingInStore],
    size_clarified: list[SizeClarified],
) -> None:
    """Index checks the reports share, plus the rules that span them.

    A seller may not say of the same goods that there are more here than the
    system thinks *and* fewer. Nor that goods are missing, or found from
    nowhere, while also saying they came out of the size-not-known balance.
    The rules are stated per stock key rather than per line: two lines drawing
    the same variant and size from the same warehouse are two statements about
    one shelf, and they would contradict each other just as flatly.
    """
    for label, reports in (
        ("found_in_store", found_in_store),
        ("missing_in_store", missing_in_store),
        ("size_clarified", size_clarified),
    ):
        seen_indexes: set[int] = set()
        for report in reports:
            if type(report.line_index) is not int or not 0 <= report.line_index < len(lines):
                raise ValidationFailedError(f"{label} refers to a line that does not exist")
            if report.line_index in seen_indexes:
                raise ValidationFailedError(f"Duplicate {label} line index")
            seen_indexes.add(report.line_index)

    found = {_stock_key(lines[report.line_index]) for report in found_in_store}
    missing = {_stock_key(lines[report.line_index]) for report in missing_in_store}
    clarified = {_stock_key(lines[report.line_index]) for report in size_clarified}
    if found & missing:
        raise ValidationFailedError(
            "The same goods cannot be reported both present and missing in one sale"
        )
    if clarified & (found | missing):
        raise ValidationFailedError(
            "Goods whose size is clarified cannot also be reported found or missing in one sale"
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
        # Zero present drops the line from the sale (owner decision,
        # 2026-10-01; Q-G). Not quietly: the seller stated it for this line,
        # the request carries it, and the receipt lists what was sold.
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


def _clarification_candidates(
    lines: list[SaleLineInput], size_clarified: list[SizeClarified], unknown: set[uuid.UUID]
) -> list[StockKey]:
    """Every size-not-known key a clarified line could draw on, to lock with the basket.

    A line already sold as size not known has no size to clarify, and is refused here.
    """
    candidates: list[StockKey] = []
    for report in size_clarified:
        line = lines[report.line_index]
        if line.size_id in unknown:
            raise ValidationFailedError(
                "A line sold with its size not known has no size to clarify",
                reason="SOLD_AS_SIZE_NOT_KNOWN",
                line_index=report.line_index,
            )
        candidates.extend(
            (line.source_location_id, line.product_variant_id, size_id)
            for size_id in sorted(unknown)
        )
    return candidates


def _clarification_sources(
    *,
    lines: list[SaleLineInput],
    size_clarified: list[SizeClarified],
    unknown: set[uuid.UUID],
    quantities: dict[StockKey, int],
    reported: set[StockKey],
) -> dict[StockKey, StockKey]:
    """Which size-not-known balance each clarified line draws on.

    A lookup, never a guess. An organization normally has one "size not
    known" (`ensure_unknown_size`), so there is one balance per model and
    warehouse to draw on. If a model were held under two of them, nobody at
    the counter could say which, and it is refused.

    The balance may not itself be reported found or missing in the same
    basket: each bound below reads it as the ledger holds it.
    """
    sources: dict[StockKey, StockKey] = {}
    for report in size_clarified:
        line = lines[report.line_index]
        held = [
            key
            for key in (
                (line.source_location_id, line.product_variant_id, size_id)
                for size_id in sorted(unknown)
            )
            if quantities.get(key, 0) > 0
        ]
        details = {
            "line_index": report.line_index,
            "location_id": str(line.source_location_id),
            "product_variant_id": str(line.product_variant_id),
            "size_id": str(line.size_id),
        }
        if not held:
            raise InsufficientStockError(
                "Nothing of this model is held here with its size not known",
                reason="SIZE_NOT_KNOWN_SHORT",
                requested=report.quantity,
                available=0,
                correctable=False,
                **details,
            )
        if len(held) > 1:
            raise ValidationFailedError(
                "This model is held here under more than one size nobody knows",
                reason="SIZE_NOT_KNOWN_AMBIGUOUS",
                **details,
            )
        if held[0] in reported:
            raise ValidationFailedError(
                "Goods held with their size not known cannot have a size clarified "
                "and be reported found or missing in one sale",
                reason="SIZE_NOT_KNOWN_REPORTED",
                **details,
            )
        sources[_stock_key(line)] = held[0]
    return sources


def _resolve_clarifications(
    *,
    store_id: uuid.UUID,
    lines: list[SaleLineInput],
    size_clarified: list[SizeClarified],
    quantities: dict[StockKey, int],
    sources: dict[StockKey, StockKey],
) -> list[MovementRequest]:
    """Move the units a line sells out of "size not known" and into its size.

    Three bounds. A line clarifies no more units than it sells. At the size
    being sold, the clarified units must be exactly the shortfall this basket
    consumes there, as with «фізично є»: the ledger's own M go first, and
    nothing is reclassified that is not leaving in this sale. And the
    size-not-known balance must hold them, beside whatever the basket sells
    from it as it is. The pair itself changes no total (milestone plan §4.9);
    the sale that follows is what takes the coat away.
    """
    demand: dict[StockKey, int] = {}
    for line in lines:
        key = _stock_key(line)
        demand[key] = demand.get(key, 0) + line.quantity

    requested: dict[StockKey, int] = {}
    # The first line naming each key, so a refusal can point at a line.
    first_line: dict[StockKey, int] = {}
    for report in size_clarified:
        line = lines[report.line_index]
        if type(report.quantity) is not int or report.quantity <= 0:
            raise ValidationFailedError(
                "A size clarification must name a positive integer quantity"
            )
        if report.quantity > line.quantity:
            # Per line as well as per key: the statement is about the units
            # this line sells, and it is stored and fingerprinted as such.
            raise ValidationFailedError(
                "A line cannot have more units clarified than it sells",
                reason="MORE_THAN_THE_LINE",
                line_index=report.line_index,
                quantity=line.quantity,
                clarified=report.quantity,
            )
        key = _stock_key(line)
        requested[key] = requested.get(key, 0) + report.quantity
        first_line.setdefault(key, report.line_index)

    taken: dict[StockKey, int] = {}
    drawn_by: dict[StockKey, StockKey] = {}
    into_sizes: list[MovementRequest] = []
    for key, quantity in sorted(requested.items()):
        available = quantities[key]
        shortfall = max(demand[key] - available, 0)
        if quantity != shortfall:
            raise CorrectionExceedsShortfallError(
                "A size clarification may only cover the exact shortfall of the size being sold",
                reason="SIZE_CLARIFIED",
                line_index=first_line[key],
                location_id=str(key[0]),
                product_variant_id=str(key[1]),
                size_id=str(key[2]),
                requested=quantity,
                shortfall=shortfall,
                available=available,
            )
        taken[sources[key]] = taken.get(sources[key], 0) + quantity
        drawn_by.setdefault(sources[key], key)
        into_sizes.append(
            MovementRequest(
                location_id=key[0],
                acting_store_id=store_id,
                product_variant_id=key[1],
                size_id=key[2],
                quantity_delta=quantity,
                movement_type=MovementType.ADJUSTMENT,
                reason_code=MovementReason.SIZE_RECLASSIFICATION_IN,
            )
        )

    out_of_unknown: list[MovementRequest] = []
    for source, quantity in sorted(taken.items()):
        wanted = quantity + demand.get(source, 0)
        if wanted > quantities[source]:
            # Shaped like the refusal when nothing is held at all: the line
            # and size being clarified, and the balance that fell short.
            raise InsufficientStockError(
                "Not that many of this model are held here with their size not known",
                reason="SIZE_NOT_KNOWN_SHORT",
                line_index=first_line[drawn_by[source]],
                location_id=str(source[0]),
                product_variant_id=str(source[1]),
                size_id=str(drawn_by[source][2]),
                size_not_known_id=str(source[2]),
                requested=wanted,
                available=quantities[source],
                correctable=False,
            )
        out_of_unknown.append(
            MovementRequest(
                location_id=source[0],
                acting_store_id=store_id,
                product_variant_id=source[1],
                size_id=source[2],
                quantity_delta=-quantity,
                movement_type=MovementType.ADJUSTMENT,
                reason_code=MovementReason.SIZE_RECLASSIFICATION_OUT,
            )
        )
    return out_of_unknown + into_sizes


async def _refuse_a_second_count_of_unknown_size_stock(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    corrections: list[MovementRequest],
    leaving: dict[StockKey, int],
) -> None:
    """«Фізично є» may not count a coat that a legacy list may already count.

    A legacy list loads goods nobody recorded a size for as "size not known"
    (F34, M1-023). Both directions of a correction could then count one coat
    twice, with nothing to ever notice, so both are refused with their own
    code:

    * A sized unit while the same variant will still be available here with
      size not known once this basket has taken what it takes from that
      balance (`leaving`: sold as it is, written off, or clarified). A seller
      selling one of those coats as, say, M finds the system at zero for M;
      correcting M upward would leave the size-unknown balance still counting
      it. The seller says instead that it is one of those coats
      (`size_clarified`, owner decision 2026-09-29), or sells it as size not
      known. A basket that takes the last of them has accounted for every
      such coat, so the one found cannot be among them.
    * A size-not-known unit, ever. "Size not known" enters only from a list,
      where its evidence exists (ADR-0005 §3); at the counter the coat is in
      hand and its size can be read. Added here, it could be the very M the
      ledger already holds.

    A size-unknown key this basket does not touch is read without its lock,
    deliberately: a concurrent sale of the last such unit can only make this
    refuse once more than it had to, never let a second count through. One
    the basket does touch is among its locked keys, so what it takes is
    subtracted from an exact figure. An opening balance cannot land in
    between — it waits for this command's warehouse lock (`lock_stock`).
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
        still_held = quantity - leaving.get(key, 0)
        if still_held > 0:
            raise UnknownSizeStockError(
                location_id=str(key[0]),
                product_variant_id=str(key[1]),
                unknown_size_id=str(key[2]),
                available=still_held,
            )


async def correction_ids(session: AsyncSession, sale: Sale) -> list[uuid.UUID]:
    """Recover the durable correction references, including receipts made before replay caching."""
    return await sale_correction_ids(session, organization_id=sale.organization_id, sale_id=sale.id)


async def shortage_ids(session: AsyncSession, sale: Sale) -> list[uuid.UUID]:
    """The same, for the shortages reported while the sale was made."""
    return await sale_shortage_ids(session, organization_id=sale.organization_id, sale_id=sale.id)


async def reclassification_ids(session: AsyncSession, sale: Sale) -> list[uuid.UUID]:
    """The same, for both halves of every size clarified while the sale was made."""
    return await sale_reclassification_ids(
        session, organization_id=sale.organization_id, sale_id=sale.id
    )


async def lock_command(
    session: AsyncSession, *, organization_id: uuid.UUID, command_id: uuid.UUID
) -> None:
    """Serialize one till command before taking stock locks.

    A sale and an empty shelf share their command ids, so both take this one
    lock. Hash collisions only serialize unrelated commands; the exact UUID
    pair still identifies the command."""
    lock_key = int.from_bytes(
        hashlib.sha256(organization_id.bytes + command_id.bytes).digest()[:8],
        byteorder="big",
        signed=True,
    )
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})


async def _existing_command(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    request_fingerprint: str,
) -> SaleResult | None:
    await lock_command(session, organization_id=scope.organization_id, command_id=command_id)
    existing = await session.scalar(
        select(Sale).where(
            Sale.organization_id == scope.organization_id, Sale.command_id == command_id
        )
    )
    if existing is None:
        # The basket may already have been answered with an empty shelf: one
        # command, one outcome, never a sale as well (I20).
        if await session.scalar(
            select(ShelfShortage.id).where(
                ShelfShortage.organization_id == scope.organization_id,
                ShelfShortage.command_id == command_id,
            )
        ):
            raise IdempotencyConflictError(
                "This command_id already recorded an empty shelf", command_id=str(command_id)
            )
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
        reclassifications=await reclassification_ids(session, existing),
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
    size_clarified: list[SizeClarified] | None = None,
    credit_terms: Mapping[str, str] | None = None,
    correlation_id: str | None = None,
    payment_method: PaymentMethod | None = None,
    method_required: bool = True,
) -> SaleResult:
    """Sell the basket, or raise and let the transaction roll back.

    `credit_terms` is what a sale paid in parts states, as the credit module
    words it. The sale never reads it: it is part of what makes this command
    this command, so the same command_id retried with other terms, or none,
    is refused rather than replayed. The caller opens the credit itself.

    `payment_method` is in the print only when stated, and a new sale without
    it is refused after the replay lookup (`payment.stated_way`).
    `method_required=False` is for this service's unit tests only."""
    if not lines:
        raise ValidationFailedError("A sale must contain at least one line")

    scope.require(Permission.SALE_CREATE, store_id)
    corrections_requested = found_in_store or []
    shortages_requested = missing_in_store or []
    clarifications_requested = size_clarified or []
    if corrections_requested or clarifications_requested:
        # A narrow capability a seller may hold, unlike inventory:adjust. It
        # covers a size clarified at the counter too: bounded the same way,
        # and it changes no total, where «фізично є» adds a coat.
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
    _validate_reports(lines, corrections_requested, shortages_requested, clarifications_requested)
    if {m.line_index for m in shortages_requested if m.quantity == 0} == set(range(len(lines))):
        # Nothing on the shelf of anything in the basket: no sale to make. The
        # shortage is the empty-shelf command's to record, under this command_id.
        raise ValidationFailedError(
            "Nothing in this basket is on the shelf, so there is nothing to sell; "
            "report the empty shelf instead",
            reason="NOTHING_TO_SELL",
        )
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
            # And again: without the clarification the same command sells a
            # coat the ledger holds as M, or none at all.
            "size_clarified": [
                {"line_index": clarified.line_index, "quantity": clarified.quantity}
                for clarified in clarifications_requested
            ],
            # Absent, not empty, for a sale paid in full, so every sale made
            # before credit existed keeps the fingerprint it was stored with.
            **({"credit": dict(credit_terms)} if credit_terms is not None else {}),
            # The same for the way of paying: a sale a phone kept from before
            # it was asked has none, and must still replay (ADR-0012, B13).
            # One stated is part of the command: the same command_id resent
            # with another way is another sale, not a retry.
            **print_of(payment_method),
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
        (clarifications_requested, Permission.INVENTORY_CORRECT_DURING_SALE),
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
    # Only now, for a sale nothing recorded: one of the till's three ways.
    method = stated_way(payment_method, takes=TILL_METHODS, required=method_required)

    # The size-not-known balances a clarification may draw on are part of the
    # basket, so they are locked with it, in the same one global order.
    unknown = (
        await unknown_size_ids(session, organization_id=scope.organization_id)
        if clarifications_requested
        else set()
    )
    candidates = _clarification_candidates(lines, clarifications_requested, unknown)

    # Lock every stock key in one global order before reading any shortfall.
    # This also materializes missing rows, closing the first-receipt race.
    quantities = await lock_stock(
        session,
        organization_id=scope.organization_id,
        keys=[_stock_key(line) for line in lines] + candidates,
        acting_store_ids={store_id},
    )
    reserved = await reserved_stock(session, keys=list(quantities))
    corrected_keys = _reported_keys(
        lines, corrections_requested, shortages_requested, clarifications_requested
    )
    for key in sorted(corrected_keys | set(candidates)):
        if reserved.get(key, 0):
            # Which balance, so a client can offer what is still possible —
            # selling the coat as it is — rather than only this sentence.
            raise ValidationFailedError(
                "Release reservations before correcting this stock key",
                reason="RESERVED",
                location_id=str(key[0]),
                product_variant_id=str(key[1]),
                size_id=str(key[2]),
                reserved=reserved[key],
            )
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
    # being sold. No two reports touch the same stock key, so the corrections
    # and clarifications below still see the demand they were written against.
    lines, shortages = _resolve_shortages(
        store_id=store_id,
        lines=lines,
        missing_in_store=shortages_requested,
        quantities=quantities,
    )
    corrections = _resolve_corrections(
        store_id=store_id, lines=lines, found_in_store=corrections_requested, quantities=quantities
    )
    reclassifications = _resolve_clarifications(
        store_id=store_id,
        lines=lines,
        size_clarified=clarifications_requested,
        quantities=quantities,
        sources=_clarification_sources(
            lines=lines,
            size_clarified=clarifications_requested,
            unknown=unknown,
            quantities=quantities,
            reported=_reported_keys(lines, corrections_requested, shortages_requested),
        ),
    )
    if corrections:
        leaving: dict[StockKey, int] = {}
        for line in lines:
            leaving[_stock_key(line)] = leaving.get(_stock_key(line), 0) + line.quantity
        for request in shortages + reclassifications:
            if request.quantity_delta < 0:
                key = (request.location_id, request.product_variant_id, request.size_id)
                leaving[key] = leaving.get(key, 0) - request.quantity_delta
        await _refuse_a_second_count_of_unknown_size_stock(
            session,
            organization_id=scope.organization_id,
            corrections=corrections,
            leaving=leaving,
        )
    # A line with nothing on the shelf has been answered by its shortage and
    # leaves the sale here. Kept until now so every report's line_index above
    # still pointed at the line it was written against.
    lines = [line for line in lines if line.quantity > 0]
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
        payment_method=method.value if method is not None else None,
    )
    session.add(sale)
    await session.flush()

    correction_ids: list[uuid.UUID] = []
    shortage_ids: list[uuid.UUID] = []
    reclassification_ids: list[uuid.UUID] = []
    if corrections or shortages or reclassifications:
        # Applied before the sale lines, in one batch. Before, because stock
        # must be on the books before it can be sold and the ledger has to
        # read in that order. One batch, because two calls would take locks in
        # two orders — the deadlock `apply_movements`' global sort prevents.
        applied = await apply_movements(
            session,
            organization_id=scope.organization_id,
            requests=[
                replace(adjustment, reference_type="sale", reference_id=sale.id)
                for adjustment in corrections + shortages + reclassifications
            ],
            actor_user_id=scope.user_id,
            correlation_id=correlation_id,
        )
        reclassified = [
            entry for entry in applied if entry.request.reason_code in SIZE_RECLASSIFICATION_REASONS
        ]
        if reclassified:
            reclassification_ids = await _audit_reclassifications(
                session, scope=scope, sale=sale, applied=reclassified
            )
        for entry in applied:
            if entry.request.reason_code in SIZE_RECLASSIFICATION_REASONS:
                continue
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
        reclassifications=len(reclassification_ids),
        total=str(sale.total),
        payment_method=sale.payment_method,
    )
    return SaleResult(
        sale=sale,
        items=items,
        corrections=correction_ids,
        shortages=shortage_ids,
        reclassifications=reclassification_ids,
    )


async def _audit_reclassifications(
    session: AsyncSession, *, scope: RequestScope, sale: Sale, applied: list[AppliedMovement]
) -> list[uuid.UUID]:
    """One audit entry per model and warehouse whose size a seller clarified.

    The entry is the reclassification's, not each leg's: what the balances
    were and became on both sides, and which movements did it (milestone plan
    §4.9). Returns every leg's movement, in the order a durable replay reads
    them back (`sale_reclassification_ids`).
    """
    ordered = sorted(
        applied,
        key=lambda entry: (
            entry.request.location_id,
            entry.request.product_variant_id,
            entry.request.size_id,
            entry.movement_id,
        ),
    )
    groups: dict[tuple[uuid.UUID, uuid.UUID], list[AppliedMovement]] = {}
    for entry in ordered:
        groups.setdefault((entry.request.location_id, entry.request.product_variant_id), []).append(
            entry
        )
    for (location_id, variant_id), legs in groups.items():
        out = next(
            leg
            for leg in legs
            if leg.request.reason_code is MovementReason.SIZE_RECLASSIFICATION_OUT
        )
        await audit.record(
            session,
            organization_id=scope.organization_id,
            actor_user_id=scope.user_id,
            action="inventory.size_reclassified_during_sale",
            entity_type="stock_movement",
            entity_id=out.movement_id,
            before={
                "location_id": str(location_id),
                "product_variant_id": str(variant_id),
                "size_not_known_id": str(out.request.size_id),
                "quantities": {
                    str(leg.request.size_id): leg.quantity_after - leg.request.quantity_delta
                    for leg in legs
                },
            },
            after={
                "quantities": {str(leg.request.size_id): leg.quantity_after for leg in legs},
                "movement_ids": [str(leg.movement_id) for leg in legs],
                "sale_id": str(sale.id),
            },
            reason="SIZE_RECLASSIFICATION",
        )
    return [entry.movement_id for entry in ordered]


__all__ = [
    "FoundInStore",
    "MissingInStore",
    "SaleLineInput",
    "SaleResult",
    "SizeClarified",
    "correction_ids",
    "create_sale",
    "money",
    "reclassification_ids",
    "shortage_ids",
]
