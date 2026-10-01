"""A sale paid in parts: opening the debt, payments, write-offs and returns.

See `models.py` for the owner's decisions. Every command here locks the
credit's row before reading what is owed, so two payments, or a payment and
a return, never both see the same debt and both lower it (the pattern a refund
uses on its sale, I9).
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import (
    IdempotencyConflictError,
    NotFoundError,
    ValidationFailedError,
)
from app.core.logging import get_logger
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.credit.models import CreditEntry, CreditStatus, CustomerCredit, EntryKind
from app.modules.identity.models import AppUser
from app.modules.sales.models import Sale, SaleItem
from app.modules.sales.service import money

logger = get_logger(__name__)

ZERO = Decimal("0.00")
MAX_NAME = 200
MAX_PHONE = 40
MAX_REASON = 1000
# Room for a country code; fewer than ten digits is not a phone anyone calls.
PHONE_DIGITS = range(10, 16)


@dataclass(frozen=True, slots=True)
class CreditTerms:
    """What the seller states when a customer pays in parts."""

    customer_name: str
    customer_phone: str
    paid_now: Decimal


@dataclass(frozen=True, slots=True)
class ReturnSettlement:
    """What a return did to a debt: the worth of the goods, split."""

    debt_reduced: Decimal
    cash_back: Decimal
    owed_after: Decimal


@dataclass(frozen=True, slots=True)
class Entry:
    kind: EntryKind
    amount: Decimal
    cash_back: Decimal
    at: datetime
    by: str
    note: str | None


@dataclass(frozen=True, slots=True)
class CreditView:
    id: uuid.UUID
    sale_id: uuid.UUID
    store_id: uuid.UUID
    customer_name: str
    customer_phone: str
    amount: Decimal
    currency_code: str
    status: CreditStatus
    paid: Decimal
    returned: Decimal
    cash_back: Decimal
    written_off: Decimal
    owed: Decimal
    opened_at: datetime
    last_payment_at: datetime | None
    closed_at: datetime | None
    goods: list[str]
    entries: list[Entry]


@dataclass(frozen=True, slots=True)
class CustomerView:
    """One customer's debts in a store: one phone, one customer (owner
    decision, 2026-10-01), whatever name each sale was written under."""

    phone_digits: str
    # As the newest of these debts wrote them.
    customer_name: str
    customer_phone: str
    owed: Decimal
    open_debts: int
    credits: list[CreditView]


@dataclass(frozen=True, slots=True)
class StoreDebts:
    """What a store is owed now, across its open debts."""

    owed: Decimal
    customers: int
    debts: int


def digits(phone: str) -> str:
    return re.sub(r"\D", "", phone)


def customer_key(phone_digits: str) -> str:
    """Who a phone belongs to: one phone is one customer (owner decision,
    2026-10-01), however it was written. «+38 (067) 123-45-67» and
    «0671234567» are one number, so a Ukrainian number is kept in its own
    ten digits."""
    if len(phone_digits) == 12 and phone_digits.startswith("380"):
        return phone_digits[2:]
    return phone_digits


# The same, in SQL, over what is stored: the stored digits stay as written.
_CUSTOMER = case(
    (
        and_(
            func.length(CustomerCredit.phone_digits) == 12,
            CustomerCredit.phone_digits.startswith("380"),
        ),
        func.substr(CustomerCredit.phone_digits, 3),
    ),
    else_=CustomerCredit.phone_digits,
)


def terms(*, customer_name: str, customer_phone: str, paid_now: Decimal) -> CreditTerms:
    """The seller's statement, checked and in the form the ledger keeps."""
    name = customer_name.strip()
    if not name or len(name) > MAX_NAME or not is_storable(name):
        raise ValidationFailedError(
            f"The customer's name is 1 to {MAX_NAME} characters", reason="CUSTOMER_NAME"
        )
    phone = customer_phone.strip()
    if len(phone) > MAX_PHONE or len(digits(phone)) not in PHONE_DIGITS or not is_storable(phone):
        raise ValidationFailedError(
            "The customer's phone has 10 to 15 digits", reason="CUSTOMER_PHONE"
        )
    paid = money(paid_now)
    if paid <= ZERO:
        # Owner decision, 2026-10-01: any first payment above nothing.
        raise ValidationFailedError("Something is paid when the goods leave", reason="NOTHING_PAID")
    return CreditTerms(customer_name=name, customer_phone=phone, paid_now=paid)


def fingerprint_of(credit: CreditTerms) -> dict[str, str]:
    """What a sale's permanent fingerprint carries of its credit, so the same
    command_id retried with other terms is a different sale, not a retry."""
    return {
        "customer_name": credit.customer_name,
        "customer_phone": digits(credit.customer_phone),
        "paid_now": str(credit.paid_now),
    }


async def _owed(session: AsyncSession, credit: CustomerCredit) -> Decimal:
    lowered = await session.scalar(
        select(func.coalesce(func.sum(CreditEntry.amount), 0)).where(
            CreditEntry.credit_id == credit.id
        )
    )
    if credit.status != CreditStatus.OPEN.value:
        return ZERO
    return max(ZERO, money(credit.amount - Decimal(lowered or 0)))


async def _locked(
    session: AsyncSession, *, organization_id: uuid.UUID, credit_id: uuid.UUID
) -> CustomerCredit:
    credit = await session.scalar(
        select(CustomerCredit)
        .where(CustomerCredit.id == credit_id, CustomerCredit.organization_id == organization_id)
        .with_for_update()
    )
    if credit is None:
        raise NotFoundError("Unknown debt", credit_id=str(credit_id))
    return credit


def _settle_if_paid(credit: CustomerCredit, owed: Decimal) -> None:
    if owed == ZERO and credit.status == CreditStatus.OPEN.value:
        credit.status = CreditStatus.SETTLED.value
        credit.closed_at = datetime.now(tz=UTC)


async def open_credit(
    session: AsyncSession,
    *,
    scope: RequestScope,
    sale: Sale,
    credit: CreditTerms,
    correlation_id: str | None = None,
) -> CreditView:
    """The debt a sale paid in parts leaves, in the sale's own transaction.

    A retried sale finds its credit, which its fingerprint already proved is
    the same one."""
    scope.require(Permission.SALE_CREDIT, sale.store_id)
    existing = await session.scalar(select(CustomerCredit).where(CustomerCredit.sale_id == sale.id))
    if existing is not None:
        return await view(session, existing)
    if credit.paid_now >= sale.total:
        raise ValidationFailedError(
            "Everything is paid now, so nothing is owed: sell it as an ordinary sale",
            reason="PAID_IN_FULL",
            total=str(sale.total),
        )
    row = CustomerCredit(
        organization_id=sale.organization_id,
        store_id=sale.store_id,
        sale_id=sale.id,
        customer_name=credit.customer_name,
        customer_phone=credit.customer_phone,
        phone_digits=digits(credit.customer_phone),
        amount=sale.total,
        currency_code=sale.currency_code,
        opened_by_user_id=scope.user_id,
    )
    session.add(row)
    await session.flush()
    session.add(
        CreditEntry(
            organization_id=sale.organization_id,
            credit_id=row.id,
            kind=EntryKind.PAYMENT.value,
            amount=credit.paid_now,
            # The first payment is the sale's own command.
            command_id=sale.command_id,
            command_fingerprint=sale.command_fingerprint,
            actor_user_id=scope.user_id,
            correlation_id=correlation_id,
        )
    )
    await session.flush()
    # Never the phone: the audit log outlives the debt, and is read more
    # widely than the debts are.
    await audit.record(
        session,
        organization_id=sale.organization_id,
        actor_user_id=scope.user_id,
        action="credit.opened",
        entity_type="customer_credit",
        entity_id=row.id,
        after={
            "sale_id": str(sale.id),
            "amount": str(row.amount),
            "paid_now": str(credit.paid_now),
        },
    )
    logger.info("credit.opened", credit_id=str(row.id), sale_id=str(sale.id))
    return await view(session, row)


async def _replayed(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    fingerprint: str,
    credit_id: uuid.UUID,
) -> CreditView | None:
    """A payment or write-off already made under this command_id (I20)."""
    entry = await session.scalar(
        select(CreditEntry).where(
            CreditEntry.organization_id == scope.organization_id,
            CreditEntry.command_id == command_id,
        )
    )
    if entry is None:
        return None
    if entry.command_fingerprint != fingerprint or entry.credit_id != credit_id:
        raise IdempotencyConflictError(
            "This command_id was already used with a different request",
            command_id=str(command_id),
        )
    credit = await session.get(CustomerCredit, entry.credit_id)
    assert credit is not None
    return await view(session, credit)


async def pay(
    session: AsyncSession,
    *,
    scope: RequestScope,
    credit_id: uuid.UUID,
    command_id: uuid.UUID,
    amount: Decimal,
    correlation_id: str | None = None,
) -> CreditView:
    """A later payment, taken in the store that sold (owner decision)."""
    paid = money(amount)
    if paid <= ZERO:
        raise ValidationFailedError("A payment is more than nothing", reason="NOTHING_PAID")
    credit = await _locked(session, organization_id=scope.organization_id, credit_id=credit_id)
    scope.require(Permission.SALE_CREDIT, credit.store_id)
    fingerprint = idempotency.fingerprint(
        {"pay": str(credit_id), "amount": str(paid)},
        actor_user_id=scope.user_id,
        store_id=credit.store_id,
    )
    replay = await _replayed(
        session,
        scope=scope,
        command_id=command_id,
        fingerprint=fingerprint,
        credit_id=credit.id,
    )
    if replay is not None:
        return replay
    if credit.status != CreditStatus.OPEN.value:
        raise ValidationFailedError(
            "Nothing is owed on this sale any more", reason="NOT_OWED", status=credit.status
        )
    owed = await _owed(session, credit)
    if paid > owed:
        raise ValidationFailedError("More than is owed", reason="MORE_THAN_OWED", owed=str(owed))
    session.add(
        CreditEntry(
            organization_id=scope.organization_id,
            credit_id=credit.id,
            kind=EntryKind.PAYMENT.value,
            amount=paid,
            command_id=command_id,
            command_fingerprint=fingerprint,
            actor_user_id=scope.user_id,
            correlation_id=correlation_id,
        )
    )
    await session.flush()
    _settle_if_paid(credit, money(owed - paid))
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="credit.paid",
        entity_type="customer_credit",
        entity_id=credit.id,
        before={"owed": str(owed)},
        after={"owed": str(money(owed - paid)), "paid": str(paid)},
    )
    logger.info("credit.paid", credit_id=str(credit.id))
    return await view(session, credit)


async def write_off(
    session: AsyncSession,
    *,
    scope: RequestScope,
    credit_id: uuid.UUID,
    command_id: uuid.UUID,
    reason: str,
    correlation_id: str | None = None,
) -> CreditView:
    """The owner closes a debt that will not be paid, saying why."""
    why = reason.strip()
    if not why or len(why) > MAX_REASON or not is_storable(why):
        raise ValidationFailedError(f"Say why, in 1 to {MAX_REASON} characters", reason="NO_REASON")
    credit = await _locked(session, organization_id=scope.organization_id, credit_id=credit_id)
    scope.require(Permission.CREDIT_WRITE_OFF, credit.store_id)
    fingerprint = idempotency.fingerprint(
        {"write_off": str(credit_id), "reason": why},
        actor_user_id=scope.user_id,
        store_id=credit.store_id,
    )
    replay = await _replayed(
        session,
        scope=scope,
        command_id=command_id,
        fingerprint=fingerprint,
        credit_id=credit.id,
    )
    if replay is not None:
        return replay
    if credit.status != CreditStatus.OPEN.value:
        raise ValidationFailedError(
            "Nothing is owed on this sale any more", reason="NOT_OWED", status=credit.status
        )
    owed = await _owed(session, credit)
    session.add(
        CreditEntry(
            organization_id=scope.organization_id,
            credit_id=credit.id,
            kind=EntryKind.WRITE_OFF.value,
            amount=owed,
            command_id=command_id,
            command_fingerprint=fingerprint,
            actor_user_id=scope.user_id,
            note=why,
            correlation_id=correlation_id,
        )
    )
    credit.status = CreditStatus.WRITTEN_OFF.value
    credit.closed_at = datetime.now(tz=UTC)
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="credit.written_off",
        entity_type="customer_credit",
        entity_id=credit.id,
        before={"owed": str(owed)},
        after={"owed": "0.00"},
        reason=why,
    )
    logger.info("credit.written_off", credit_id=str(credit.id))
    return await view(session, credit)


async def settle_return(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    sale_id: uuid.UUID,
    refund_id: uuid.UUID,
    worth: Decimal,
    actor_user_id: uuid.UUID,
    correlation_id: str | None = None,
) -> ReturnSettlement | None:
    """Split returned goods' worth between the debt and cash, in the refund's
    transaction. None for a sale that was paid in full.

    Owner decision, 2026-10-01: returned goods first lower what is owed; money
    goes back only for what the customer paid beyond the worth of what they
    keep. So the cash back is what was paid, net of cash already given back,
    less what the goods still kept are worth — never less than nothing.
    A written-off debt is never turned into cash: only what was paid can come
    back.
    """
    credit = await session.scalar(
        select(CustomerCredit)
        .where(
            CustomerCredit.sale_id == sale_id,
            CustomerCredit.organization_id == organization_id,
        )
        .with_for_update()
    )
    if credit is None:
        return None
    sums = (
        await session.execute(
            select(CreditEntry.kind, func.sum(CreditEntry.amount), func.sum(CreditEntry.cash_back))
            .where(CreditEntry.credit_id == credit.id)
            .group_by(CreditEntry.kind)
        )
    ).all()
    lowered = {kind: (Decimal(amount), Decimal(back)) for kind, amount, back in sums}
    paid = lowered.get(EntryKind.PAYMENT.value, (ZERO, ZERO))[0]
    returned_debt, cash_back_before = lowered.get(EntryKind.RETURN.value, (ZERO, ZERO))
    worth = money(worth)
    kept = money(credit.amount - returned_debt - cash_back_before - worth)
    cash_back = min(worth, max(ZERO, money(paid - cash_back_before - kept)))
    debt_reduced = money(worth - cash_back)
    session.add(
        CreditEntry(
            organization_id=organization_id,
            credit_id=credit.id,
            kind=EntryKind.RETURN.value,
            amount=debt_reduced,
            cash_back=cash_back,
            refund_id=refund_id,
            actor_user_id=actor_user_id,
            correlation_id=correlation_id,
        )
    )
    await session.flush()
    owed = await _owed(session, credit)
    _settle_if_paid(credit, owed)
    await session.flush()
    return ReturnSettlement(debt_reduced=debt_reduced, cash_back=cash_back, owed_after=owed)


async def return_settlement(
    session: AsyncSession, *, refund_id: uuid.UUID
) -> ReturnSettlement | None:
    """What a return already did to its debt, for a replayed refund."""
    entry = await session.scalar(select(CreditEntry).where(CreditEntry.refund_id == refund_id))
    if entry is None:
        return None
    lowered_before = await session.scalar(
        select(func.coalesce(func.sum(CreditEntry.amount), 0)).where(
            CreditEntry.credit_id == entry.credit_id,
            or_(
                CreditEntry.created_at < entry.created_at,
                CreditEntry.id == entry.id,
            ),
        )
    )
    credit = await session.get(CustomerCredit, entry.credit_id)
    assert credit is not None
    return ReturnSettlement(
        debt_reduced=entry.amount,
        cash_back=entry.cash_back,
        owed_after=max(ZERO, money(credit.amount - Decimal(lowered_before or 0))),
    )


async def view(session: AsyncSession, credit: CustomerCredit) -> CreditView:
    entries = list(
        (
            await session.execute(
                select(CreditEntry, AppUser.display_name)
                .join(AppUser, AppUser.id == CreditEntry.actor_user_id)
                .where(CreditEntry.credit_id == credit.id)
                .order_by(CreditEntry.created_at, CreditEntry.id)
            )
        ).all()
    )
    total = dict.fromkeys(EntryKind, ZERO)
    cash_back = ZERO
    last_payment: datetime | None = None
    for entry, _ in entries:
        kind = EntryKind(entry.kind)
        total[kind] += entry.amount
        cash_back += entry.cash_back
        if kind is EntryKind.PAYMENT:
            last_payment = entry.created_at
    goods = [
        f"{name} × {quantity}"
        for name, quantity in (
            await session.execute(
                select(SaleItem.display_name_snapshot, SaleItem.quantity)
                .where(SaleItem.sale_id == credit.sale_id)
                .order_by(SaleItem.id)
            )
        ).all()
    ]
    return CreditView(
        id=credit.id,
        sale_id=credit.sale_id,
        store_id=credit.store_id,
        customer_name=credit.customer_name,
        customer_phone=credit.customer_phone,
        amount=credit.amount,
        currency_code=credit.currency_code,
        status=CreditStatus(credit.status),
        paid=money(total[EntryKind.PAYMENT]),
        returned=money(total[EntryKind.RETURN] + cash_back),
        cash_back=money(cash_back),
        written_off=money(total[EntryKind.WRITE_OFF]),
        owed=await _owed(session, credit),
        opened_at=credit.created_at,
        last_payment_at=last_payment,
        closed_at=credit.closed_at,
        goods=goods,
        entries=[
            Entry(
                kind=EntryKind(entry.kind),
                amount=entry.amount,
                cash_back=entry.cash_back,
                at=entry.created_at,
                by=name,
                note=entry.note,
            )
            for entry, name in entries
        ],
    )


async def read_credit(
    session: AsyncSession, *, scope: RequestScope, credit_id: uuid.UUID
) -> CreditView:
    credit = await session.scalar(
        select(CustomerCredit).where(
            CustomerCredit.id == credit_id,
            CustomerCredit.organization_id == scope.organization_id,
        )
    )
    if credit is None:
        raise NotFoundError("Unknown debt", credit_id=str(credit_id))
    scope.require(Permission.SALE_CREDIT, credit.store_id)
    return await view(session, credit)


async def credit_for_sale(session: AsyncSession, *, sale_id: uuid.UUID) -> CreditView | None:
    credit = await session.scalar(select(CustomerCredit).where(CustomerCredit.sale_id == sale_id))
    return None if credit is None else await view(session, credit)


async def credited_sales(session: AsyncSession, *, sale_ids: Sequence[uuid.UUID]) -> set[uuid.UUID]:
    """Which of these sales were paid in parts: a return of one lowers its
    debt first, so the till cannot say up front what goes back in cash."""
    if not sale_ids:
        return set()
    rows = await session.scalars(
        select(CustomerCredit.sale_id).where(CustomerCredit.sale_id.in_(sale_ids))
    )
    return set(rows.all())


async def list_credits(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    status: CreditStatus | None,
    query: str,
    limit: int,
    offset: int,
) -> tuple[list[CreditView], bool]:
    """A store's debts, newest first, found by the customer's name or phone."""
    scope.require(Permission.SALE_CREDIT, store_id)
    statement = _in_store(select(CustomerCredit), scope, store_id, status)
    wanted = query.strip()
    if wanted:
        statement = statement.where(_found_by(wanted))
    rows: Sequence[CustomerCredit] = (
        await session.scalars(
            statement.order_by(CustomerCredit.created_at.desc(), CustomerCredit.id)
            .limit(limit + 1)
            .offset(offset)
        )
    ).all()
    return [await view(session, credit) for credit in rows[:limit]], len(rows) > limit


def _in_store(
    statement: Select[Any], scope: RequestScope, store_id: uuid.UUID, status: CreditStatus | None
) -> Select[Any]:
    statement = statement.where(
        CustomerCredit.organization_id == scope.organization_id,
        CustomerCredit.store_id == store_id,
    )
    if status is not None:
        statement = statement.where(CustomerCredit.status == status.value)
    return statement


# What a phone is written with: «+38 (067) 123-45-67».
_PHONE_LIKE = re.compile(r"[\d\s()+\-]+")


def _found_by(wanted: str) -> Any:
    """The customer's name, or any spelling of their phone.

    Only a query written as a phone is looked for among phones: the digits of
    «Ірина 2» are part of a name, and would find whoever's number holds a 2.
    """
    conditions: list[Any] = [
        func.lower(CustomerCredit.customer_name).contains(wanted.lower(), autoescape=True)
    ]
    if _PHONE_LIKE.fullmatch(wanted) and digits(wanted):
        conditions.append(CustomerCredit.phone_digits.contains(digits(wanted), autoescape=True))
        conditions.append(_CUSTOMER.contains(customer_key(digits(wanted)), autoescape=True))
    return or_(*conditions)


async def list_customers(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    status: CreditStatus | None,
    query: str,
    limit: int,
    offset: int,
) -> tuple[list[CustomerView], bool]:
    """A store's debts by customer, the one with the newest debt first.

    A search finds customers by any of their debts, and then shows all of
    them: «Коваль» finds the phone, and the same phone's debt written down as
    «Ірина» is the same customer's. A payment is still taken on one debt the
    seller chooses (owner decision, 2026-10-01).
    """
    scope.require(Permission.SALE_CREDIT, store_id)
    customer = _CUSTOMER.label("customer")
    latest = func.max(CustomerCredit.created_at).label("latest")
    grouped = _in_store(select(customer, latest), scope, store_id, status)
    wanted = query.strip()
    if wanted:
        grouped = grouped.where(
            _CUSTOMER.in_(
                _in_store(select(_CUSTOMER), scope, store_id, status).where(_found_by(wanted))
            )
        )
    rows = (
        await session.execute(
            grouped.group_by(_CUSTOMER)
            .order_by(latest.desc(), _CUSTOMER)
            .limit(limit + 1)
            .offset(offset)
        )
    ).all()
    phones: list[str] = [row.customer for row in rows[:limit]]
    debts: dict[str, list[CreditView]] = {phone: [] for phone in phones}
    for credit in (
        await session.scalars(
            _in_store(select(CustomerCredit), scope, store_id, status)
            .where(_CUSTOMER.in_(phones))
            .order_by(CustomerCredit.created_at.desc(), CustomerCredit.id)
        )
    ).all():
        debts[customer_key(credit.phone_digits)].append(await view(session, credit))
    customers = [
        CustomerView(
            phone_digits=phone,
            customer_name=debts[phone][0].customer_name,
            customer_phone=debts[phone][0].customer_phone,
            owed=money(sum((debt.owed for debt in debts[phone]), ZERO)),
            open_debts=sum(1 for debt in debts[phone] if debt.status is CreditStatus.OPEN),
            credits=debts[phone],
        )
        for phone in phones
    ]
    return customers, len(rows) > limit


async def store_debts(
    session: AsyncSession, *, scope: RequestScope, store_id: uuid.UUID
) -> StoreDebts:
    """What the store is owed now: the owner sees it by store only (owner
    decision, 2026-10-01)."""
    scope.require(Permission.SALE_CREDIT, store_id)
    lowered = (
        select(func.coalesce(func.sum(CreditEntry.amount), 0))
        .where(CreditEntry.credit_id == CustomerCredit.id)
        .correlate(CustomerCredit)
        .scalar_subquery()
    )
    owed, customers, debts = (
        await session.execute(
            _in_store(
                select(
                    func.coalesce(func.sum(func.greatest(CustomerCredit.amount - lowered, 0)), 0),
                    func.count(func.distinct(_CUSTOMER)),
                    func.count(CustomerCredit.id),
                ),
                scope,
                store_id,
                CreditStatus.OPEN,
            )
        )
    ).one()
    return StoreDebts(owed=money(Decimal(owed)), customers=customers, debts=debts)


__all__ = [
    "CreditTerms",
    "CreditView",
    "CustomerView",
    "Entry",
    "ReturnSettlement",
    "StoreDebts",
    "credit_for_sale",
    "credited_sales",
    "customer_key",
    "fingerprint_of",
    "list_credits",
    "list_customers",
    "open_credit",
    "pay",
    "read_credit",
    "return_settlement",
    "settle_return",
    "store_debts",
    "terms",
    "view",
    "write_off",
]
