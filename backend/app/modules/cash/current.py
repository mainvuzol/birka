"""The way each money row was paid now, and the way a return suggests.

Read-only. A money row keeps the way it was stated with forever; a wrong way
is corrected by `payment_correction` rows, and the current way is the
`to_method` of the highest `seq` — never the newest by time or by id
(ADR-0012, B6.1). The API merges these into the answers of the sales,
debts, refunds and orders, which do not import this module, and the drawer
and the sales report read them.

How money handed back is suggested to go back (owner decisions, 2026-10-04):
the way the sale was paid, unless the seller changes it. For the cases the
owner's answers did not settle, the design's readings (ADR-0012, G4, G5):
an order paid in advance or by cash on delivery suggests a transfer; a sale
paid in parts whose payments went one way suggests that way, and one whose
payments went several ways, or whose way was never stated, suggests nothing,
and the seller chooses.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.modules.cash.models import PaymentCorrection
from app.modules.credit.models import CreditEntry, CustomerCredit, EntryKind
from app.modules.refunds.models import Refund
from app.modules.sales.models import Sale
from app.modules.sales.payment import OFF_TILL_METHODS, PaymentMethod


@dataclass(frozen=True, slots=True)
class CurrentMethod:
    """One money row's way: as stated, and as it stands after corrections."""

    # NULL for «не вказано»: a row written before the way was asked.
    stated: PaymentMethod | None
    # `to_method` of its highest correction; the stated way when none.
    method: PaymentMethod | None
    corrected: bool


@dataclass(frozen=True, slots=True)
class SaleMethods:
    # The money taken with the sale: the sale row when it was paid in full
    # (an order collected included), its first payment when paid in parts.
    taken_with_sale: CurrentMethod
    # The current way of every payment toward its debt, the first included;
    # empty for a sale paid in full.
    payments: frozenset[PaymentMethod | None]
    # The way a return suggests the money goes back; None to let the seller
    # choose.
    refund_method: PaymentMethod | None


async def _latest(
    session: AsyncSession,
    column: InstrumentedAttribute[uuid.UUID | None],
    ids: set[uuid.UUID],
) -> dict[uuid.UUID, PaymentMethod]:
    """The `to_method` of the highest `seq` of each money row named."""
    if not ids:
        return {}
    rows = await session.execute(
        select(column, PaymentCorrection.to_method)
        .where(column.in_(ids))
        .order_by(column, PaymentCorrection.seq.desc())
        .distinct(column)
    )
    return {row_id: PaymentMethod(way) for row_id, way in rows.tuples() if row_id is not None}


def _current(stated: str | None, latest: PaymentMethod | None) -> CurrentMethod:
    way = PaymentMethod(stated) if stated is not None else None
    if latest is None:
        return CurrentMethod(stated=way, method=way, corrected=False)
    return CurrentMethod(stated=way, method=latest, corrected=True)


def _refund_way(ways: frozenset[PaymentMethod | None]) -> PaymentMethod | None:
    """One way, never stated or not: that way, a transfer for an order paid
    off the till. Several, or «не вказано»: nothing."""
    if len(ways) != 1:
        return None
    (way,) = ways
    if way is None:
        return None
    return PaymentMethod.TRANSFER if way in OFF_TILL_METHODS else way


async def sale_methods(
    session: AsyncSession, sale_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, SaleMethods]:
    """Each sale named that exists. The caller has already decided that the
    person may see these sales."""
    ids = set(sale_ids)
    if not ids:
        return {}
    sales = (
        await session.execute(
            select(Sale.id, Sale.command_id, Sale.payment_method).where(Sale.id.in_(ids))
        )
    ).all()
    entries = (
        await session.execute(
            select(
                CustomerCredit.sale_id,
                CreditEntry.id,
                CreditEntry.command_id,
                CreditEntry.payment_method,
            )
            .join(CreditEntry, CreditEntry.credit_id == CustomerCredit.id)
            .where(CustomerCredit.sale_id.in_(ids), CreditEntry.kind == EntryKind.PAYMENT.value)
        )
    ).all()
    sale_latest = await _latest(session, PaymentCorrection.sale_id, ids)
    entry_latest = await _latest(
        session, PaymentCorrection.credit_entry_id, {entry.id for entry in entries}
    )
    # The payments of each sale paid in parts, by their permanent command.
    payments: dict[uuid.UUID, dict[uuid.UUID | None, CurrentMethod]] = defaultdict(dict)
    for entry in entries:
        payments[entry.sale_id][entry.command_id] = _current(
            entry.payment_method, entry_latest.get(entry.id)
        )

    methods: dict[uuid.UUID, SaleMethods] = {}
    for sale in sales:
        if sale.id not in payments:
            taken = _current(sale.payment_method, sale_latest.get(sale.id))
            methods[sale.id] = SaleMethods(
                taken_with_sale=taken,
                payments=frozenset(),
                refund_method=_refund_way(frozenset({taken.method})),
            )
            continue
        ways = frozenset(payment.method for payment in payments[sale.id].values())
        methods[sale.id] = SaleMethods(
            # The first payment is the sale's own command (`credit.open_credit`).
            taken_with_sale=payments[sale.id][sale.command_id],
            payments=ways,
            refund_method=_refund_way(ways),
        )
    return methods


async def entry_methods(
    session: AsyncSession, credit_entry_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, CurrentMethod]:
    """Each entry of a debt's ledger named that exists. Only a payment has a
    way; a return's money went back on its refund (`refund_methods`), and a
    write-off moved none, so theirs read as never stated."""
    ids = set(credit_entry_ids)
    if not ids:
        return {}
    rows = (
        await session.execute(
            select(CreditEntry.id, CreditEntry.payment_method).where(CreditEntry.id.in_(ids))
        )
    ).all()
    latest = await _latest(session, PaymentCorrection.credit_entry_id, ids)
    return {row.id: _current(row.payment_method, latest.get(row.id)) for row in rows}


async def refund_methods(
    session: AsyncSession, refund_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, CurrentMethod]:
    """How the money of each refund named went back."""
    ids = set(refund_ids)
    if not ids:
        return {}
    rows = (
        await session.execute(select(Refund.id, Refund.payment_method).where(Refund.id.in_(ids)))
    ).all()
    latest = await _latest(session, PaymentCorrection.refund_id, ids)
    return {row.id: _current(row.payment_method, latest.get(row.id)) for row in rows}


__all__ = [
    "CurrentMethod",
    "SaleMethods",
    "entry_methods",
    "refund_methods",
    "sale_methods",
]
