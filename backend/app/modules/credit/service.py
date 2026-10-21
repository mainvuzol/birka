"""A sale paid in parts: opening the debt, payments, write-offs and returns.

See `models.py` for the owner's decisions. Every command here locks the
credit's row before reading what is owed, so two payments, or a payment and
a return, never both see the same debt and both lower it (the pattern a refund
uses on its sale, I9).

Each payment says how it was paid, one way each (owner decisions,
2026-10-04): the first holds the way the sale was sold with, and a later one
is one of the till's three. Optional in the request and required of a new
payment after the replay lookup, so a payment a phone kept from before the
way was asked still replays (ADR-0012, B2, B13).
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, String, and_, case, cast, func, literal_column, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import (
    DomainError,
    ForbiddenStoreError,
    IdempotencyConflictError,
    NotFoundError,
    PermissionDeniedError,
    StoreNotTradingError,
    ValidationFailedError,
    nothing_recorded,
)
from app.core.logging import get_logger
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.credit.models import CreditEntry, CreditStatus, CustomerCredit, EntryKind
from app.modules.identity.models import AppUser
from app.modules.sales.models import Sale, SaleItem
from app.modules.sales.outage import (
    PaperMark,
    PaperView,
    checked_paper,
    names_of,
    paper_view,
    print_of_paper,
)
from app.modules.sales.payment import TILL_METHODS, PaymentMethod, print_of, stated_way
from app.modules.sales.service import money
from app.modules.tenancy.models import Store, StoreState
from app.modules.tenancy.service import hold_stores, store_names, store_state

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
    # Named so the API can merge in each payment's way, and each return's
    # refund's, as they stand after corrections (ADR-0012, B10): this module
    # reads neither the corrections nor the refunds.
    id: uuid.UUID
    refund_id: uuid.UUID | None
    kind: EntryKind
    amount: Decimal
    cash_back: Decimal
    at: datetime
    by: str
    note: str | None
    # A payment another store took, because the one that sold did not trade.
    taken_at: str | None
    # A payment typed from paper: who took it and when, as the paper says
    # (owner decision, 2026-10-10; ADR-0021). None for every other entry.
    outage: PaperView | None = None


@dataclass(frozen=True, slots=True)
class CreditView:
    id: uuid.UUID
    sale_id: uuid.UUID
    store_id: uuid.UUID
    # The store that sold, and whether it trades: while it does not, any store
    # of the network that trades takes the payments (owner decision,
    # 2026-10-01).
    store_name: str
    store_state: StoreState
    # None once the customer is erased (ADR-0015).
    customer_name: str | None
    customer_phone: str | None
    customer_erased_at: datetime | None
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
    decision, 2026-10-01), whatever name each sale was written under. A debt
    whose customer is erased is a customer of its own, with no phone."""

    phone_digits: str | None
    # As the newest of these debts wrote them; None once erased.
    customer_name: str | None
    customer_phone: str | None
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


# A Ukrainian number written with what dials it from elsewhere: «+38» or
# «38», the old long-distance «8», «0038» from abroad. Each, with how many
# digits it then has; the number itself is the last ten, from its «0».
_UKRAINIAN = (("380", 12), ("80", 11), ("00380", 14))


def customer_key(phone_digits: str) -> str:
    """Who a phone belongs to: one phone is one customer (owner decision,
    2026-10-01), however it was written. «+38 (067) 123-45-67»,
    «0671234567», «8 067 123 45 67» and «0038 067 123 45 67» are one number
    (owner decision, 2026-10-10), so a Ukrainian number is kept in its own
    ten digits."""
    for prefix, length in _UKRAINIAN:
        if len(phone_digits) == length and phone_digits.startswith(prefix):
            return phone_digits[length - 10 :]
    return phone_digits


# The same, in SQL, over what is stored: the stored digits stay as written.
# NULL for a debt whose customer is erased.
CUSTOMER = case(
    *(
        (
            and_(
                func.length(CustomerCredit.phone_digits) == length,
                CustomerCredit.phone_digits.startswith(prefix),
            ),
            func.substr(CustomerCredit.phone_digits, length - 9),
        )
        for prefix, length in _UKRAINIAN
    ),
    else_=CustomerCredit.phone_digits,
)
# How the debts are grouped into customers: an erased customer's debt stands
# alone.
_GROUP = func.coalesce(CUSTOMER, "erased:" + cast(CustomerCredit.id, String))


def group_of(credit: CustomerCredit) -> str:
    """`_GROUP`, of a debt read."""
    if credit.phone_digits is None:
        return f"erased:{credit.id}"
    return customer_key(credit.phone_digits)


def terms(*, customer_name: str, customer_phone: str, paid_now: Decimal) -> CreditTerms:
    """The seller's statement, checked and in the form the ledger keeps.

    A name and a phone are one line each: every run of whitespace, a line
    break included, becomes one space. The Mini App's fields cannot type a
    line break anyway, and a value split over lines would slip past what
    hides a refused row's values from the logs (`core.logging`)."""
    name = " ".join(customer_name.split())
    if not name or len(name) > MAX_NAME or not is_storable(name):
        raise ValidationFailedError(
            f"The customer's name is 1 to {MAX_NAME} characters", reason="CUSTOMER_NAME"
        )
    phone = " ".join(customer_phone.split())
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
    payment_method: PaymentMethod | None,
    correlation_id: str | None = None,
) -> CreditView:
    """The debt a sale paid in parts leaves, in the sale's own transaction.

    A retried sale finds its credit, which its fingerprint already proved is
    the same one. `payment_method` is the way the money taken now was paid,
    which the sale was sold with; the sale's command already required it."""
    scope.require(Permission.SALE_CREDIT, sale.store_id)
    existing = await session.scalar(select(CustomerCredit).where(CustomerCredit.sale_id == sale.id))
    if existing is not None:
        return await view(session, existing)
    if credit.paid_now >= sale.total:
        # Reached only by a sale new in this transaction: a sale recorded
        # with these terms already has its debt (found above), and the same
        # command with other terms is refused by its own lookup, the sale's
        # or the order's. So it proves the command recorded nothing, and
        # says so (ADR-0013 §1).
        raise ValidationFailedError(
            "Everything is paid now, so nothing is owed: sell it as an ordinary sale",
            reason="PAID_IN_FULL",
            total=str(sale.total),
            recorded=False,
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
            # The drawer reads the money taken now from here, and the sale
            # holds the same way for its receipt (ADR-0012, B1).
            payment_method=payment_method.value if payment_method is not None else None,
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


async def _own(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    fingerprint: str,
    credit_id: uuid.UUID,
    refusal: DomainError,
) -> CreditView:
    """What a payment or a write-off resent by whoever made it recorded, once
    they may no longer make it; never a new one (owner decision, 2026-10-21,
    as a return's, 2026-10-18).

    A phone keeps a command whose answer it never heard, and holds its till
    until it learns the outcome (ADR-0013). Were the resend refused as a new
    command is, a person whose right was taken away meanwhile would never
    learn it, and the phone would stay held. So the one who made it is
    answered what it recorded, for the very request that recorded it — the
    fingerprint names its person — and when nothing was recorded under it,
    given `refusal` saying so (`details.recorded = false`), so the phone
    settles it. Anyone else's is given `refusal` as it came. Called under the
    debt's row lock, which a first sending still running holds: the lookup
    is conclusive. Nothing is written either way.

    The answer is the debt as its person may still see it, who may no longer
    read debts: their own entry alone, and no phone — never a colleague's
    entry, a later write-off's reason, nor the customer's number (review,
    2026-10-21). Its sums are the debt's now, which the phone says as what
    is left.
    """
    entry = await session.scalar(
        select(CreditEntry).where(
            CreditEntry.organization_id == scope.organization_id,
            CreditEntry.command_id == command_id,
        )
    )
    if entry is None:
        refusal.details.setdefault("recorded", False)
        raise refusal
    if (
        entry.command_fingerprint != fingerprint
        or entry.credit_id != credit_id
        or entry.actor_user_id != scope.user_id
    ):
        raise refusal
    credit = await session.get(CustomerCredit, entry.credit_id)
    assert credit is not None
    whole = await view(session, credit)
    return replace(
        whole,
        customer_phone=None,
        entries=[own for own in whole.entries if own.id == entry.id],
        last_payment_at=(entry.created_at if entry.kind == EntryKind.PAYMENT.value else None),
    )


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
    at_store_id: uuid.UUID | None = None,
    correlation_id: str | None = None,
    payment_method: PaymentMethod | None = None,
    method_required: bool = True,
    outage: PaperMark | None = None,
) -> CreditView:
    """A later payment, taken in the store that sold while it trades, and in
    any store of the network that trades while it does not (owner decisions,
    2026-10-01). `at_store_id` is that other store; the debt stays the selling
    store's either way.

    `outage` marks a payment typed from paper (owner decision, 2026-10-10;
    ADR-0021): checked after the replay lookup, by the rules of the store
    taking it.

    `payment_method` is one of the till's three ways, required of a new
    payment after the replay lookup (`payment.stated_way`).
    `method_required=False` is for this service's unit tests only."""
    paid = money(amount)
    if paid <= ZERO:
        raise ValidationFailedError("A payment is more than nothing", reason="NOTHING_PAID")
    credit = await _locked(session, organization_id=scope.organization_id, credit_id=credit_id)
    taking = at_store_id or credit.store_id
    # The authority is the store taking the money. A blocked or archived one
    # is refused here by name, before any answer is replayed, and so is a
    # store this person no longer belongs to.
    scope.require_store(taking)
    fingerprint = idempotency.fingerprint(
        {
            "pay": str(credit_id),
            "amount": str(paid),
            # Only when it differs, so a payment where the goods were sold
            # is fingerprinted exactly as before.
            **({"taken_at_store_id": str(taking)} if taking != credit.store_id else {}),
            # The same for the way: none on a payment kept from before it was
            # asked (ADR-0012, B13).
            **print_of(payment_method),
            # And its mark, only when typed from paper (ADR-0021).
            **print_of_paper(outage),
        },
        actor_user_id=scope.user_id,
        store_id=credit.store_id,
    )
    if not scope.can(Permission.SALE_CREDIT, taking):
        return await _own(
            session,
            scope=scope,
            command_id=command_id,
            fingerprint=fingerprint,
            credit_id=credit.id,
            refusal=PermissionDeniedError(
                f"Missing permission {Permission.SALE_CREDIT.value}",
                permission=Permission.SALE_CREDIT.value,
                store_id=str(taking),
            ),
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
    # Under the debt's row lock, and no entry under this command: every
    # refusal from here on proves the payment recorded nothing, and says so
    # (ADR-0013 §1). A store blocked while this payment runs, the selling
    # store trading again, the debt paid off by a colleague: a phone that
    # never heard its answer settles the attempt, and the seller gives the
    # money back (owner decisions, 2026-10-04 and 2026-10-07). A store
    # blocked before the resend is refused above, by the scope, with no
    # `recorded`: the phone keeps the attempt (owner, 2026-10-08).
    with nothing_recorded():
        method = stated_way(payment_method, takes=TILL_METHODS, required=method_required)
        # Typed from paper: whoever it names may take payments in the store
        # taking it, and the paper's time is that store's today or yesterday.
        mark = (
            await checked_paper(
                session,
                organization_id=scope.organization_id,
                store_id=taking,
                mark=outage,
                may=Permission.SALE_CREDIT,
            )
            if outage is not None
            else None
        )
        states = await hold_stores(
            session, organization_id=scope.organization_id, store_ids={taking, credit.store_id}
        )
        if states[taking] is not StoreState.ACTIVE:
            raise StoreNotTradingError(store_id=str(taking), state=states[taking].value)
        if taking != credit.store_id and states[credit.store_id] is StoreState.ACTIVE:
            raise ValidationFailedError(
                "The store that sold takes the payments while it trades",
                reason="PAID_WHERE_SOLD",
                store_id=str(credit.store_id),
            )
        if credit.status != CreditStatus.OPEN.value:
            raise ValidationFailedError(
                "Nothing is owed on this sale any more", reason="NOT_OWED", status=credit.status
            )
        owed = await _owed(session, credit)
        if paid > owed:
            raise ValidationFailedError(
                "More than is owed", reason="MORE_THAN_OWED", owed=str(owed)
            )
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
                taken_at_store_id=taking if taking != credit.store_id else None,
                payment_method=method.value if method is not None else None,
                during_outage=mark is not None,
                outage_taken_by=mark.by_user_id if mark is not None else None,
                outage_taken_at=mark.at if mark is not None else None,
                outage_first_days=mark is not None and mark.first_days,
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
            after={
                "owed": str(money(owed - paid)),
                "paid": str(paid),
                **({"taken_at_store_id": str(taking)} if taking != credit.store_id else {}),
            },
        )
        logger.info("credit.paid", credit_id=str(credit.id), taken_at_store_id=str(taking))
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
    fingerprint = idempotency.fingerprint(
        {"write_off": str(credit_id), "reason": why},
        actor_user_id=scope.user_id,
        store_id=credit.store_id,
    )
    if (
        await store_state(session, organization_id=scope.organization_id, store_id=credit.store_id)
        is StoreState.ACTIVE
    ):
        scope.require_store(credit.store_id)
        if not scope.can(Permission.CREDIT_WRITE_OFF, credit.store_id):
            # Whoever may no longer write off here learns what their own
            # write-off recorded (owner decision, 2026-10-21).
            return await _own(
                session,
                scope=scope,
                command_id=command_id,
                fingerprint=fingerprint,
                credit_id=credit.id,
                refusal=PermissionDeniedError(
                    f"Missing permission {Permission.CREDIT_WRITE_OFF.value}",
                    permission=Permission.CREDIT_WRITE_OFF.value,
                    store_id=str(credit.store_id),
                ),
            )
    else:
        # Nothing is done in a store that does not trade, but a debt it is
        # owed is still the owner's to write off: the network's owner, whose
        # role covers every store (owner decision, 2026-10-01). Anyone else
        # is refused before the lookup, saying nothing of what was recorded:
        # the phone keeps it until the store trades again (owner,
        # 2026-10-08).
        scope.require(Permission.CREDIT_WRITE_OFF)
    replay = await _replayed(
        session,
        scope=scope,
        command_id=command_id,
        fingerprint=fingerprint,
        credit_id=credit.id,
    )
    if replay is not None:
        return replay
    # The same as a payment: after the lookup, nothing recorded (ADR-0013 §1).
    with nothing_recorded():
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
            # Never the reason: people write the customer's name in it, and
            # it is erased with them from the debt's ledger, which keeps it
            # (ADR-0015). The audit log is append-only.
        )
        logger.info("credit.written_off", credit_id=str(credit.id))
        return await view(session, credit)


async def _split(
    session: AsyncSession, *, organization_id: uuid.UUID, sale_id: uuid.UUID, worth: Decimal
) -> tuple[CustomerCredit, Decimal, Decimal] | None:
    """The sale's debt, locked, and returned goods' worth split between it and
    money back: `(credit, debt_reduced, cash_back)`. None for a sale that was
    paid in full.

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
    return credit, money(worth - cash_back), cash_back


async def money_back(
    session: AsyncSession, *, organization_id: uuid.UUID, sale_id: uuid.UUID, worth: Decimal
) -> Decimal | None:
    """How much of returned goods' worth would go back to the customer as
    money, for a sale paid in parts; None for one paid in full, where all of
    it does.

    Asked by the refund before it is written, because the refund says how
    the money went back only when some does (ADR-0012, G35), and that is
    never changed after the insert. The debt is locked here and stays locked,
    so `settle_return` in the same transaction splits it the same way."""
    split = await _split(session, organization_id=organization_id, sale_id=sale_id, worth=worth)
    return None if split is None else split[2]


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
    """Split returned goods' worth between the debt and cash (`_split`), and
    write it to the debt's ledger, in the refund's transaction. None for a
    sale that was paid in full."""
    split = await _split(session, organization_id=organization_id, sale_id=sale_id, worth=worth)
    if split is None:
        return None
    credit, debt_reduced, cash_back = split
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
    names = await store_names(
        session,
        organization_id=credit.organization_id,
        store_ids={credit.store_id}
        | {entry.taken_at_store_id for entry, _ in entries if entry.taken_at_store_id},
    )
    state = await store_state(
        session, organization_id=credit.organization_id, store_id=credit.store_id
    )
    assert state is not None
    # Who a payment typed from paper names, by name: one query, and none when
    # no payment names anyone.
    people = await names_of(
        session,
        {
            entry.outage_taken_by
            for entry, _ in entries
            if entry.during_outage and entry.outage_taken_by is not None
        },
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
        store_name=names[credit.store_id],
        store_state=state,
        customer_name=credit.customer_name,
        customer_phone=credit.customer_phone,
        customer_erased_at=credit.customer_erased_at,
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
                id=entry.id,
                refund_id=entry.refund_id,
                kind=EntryKind(entry.kind),
                amount=entry.amount,
                cash_back=entry.cash_back,
                at=entry.created_at,
                by=name,
                note=entry.note,
                taken_at=names[entry.taken_at_store_id] if entry.taken_at_store_id else None,
                outage=paper_view(
                    entry.during_outage,
                    entry.outage_taken_by,
                    entry.outage_taken_at,
                    people,
                    first_days=entry.outage_first_days,
                ),
            )
            for entry, name in entries
        ],
    )


async def read_credit(
    session: AsyncSession,
    *,
    scope: RequestScope,
    credit_id: uuid.UUID,
    at_store_id: uuid.UUID | None = None,
) -> CreditView:
    """One debt, read in the store that sold it, or — while that store does
    not trade — in `at_store_id`, a store that takes its payments."""
    credit = await session.scalar(
        select(CustomerCredit).where(
            CustomerCredit.id == credit_id,
            CustomerCredit.organization_id == scope.organization_id,
        )
    )
    if credit is None:
        raise NotFoundError("Unknown debt", credit_id=str(credit_id))
    if at_store_id is None or at_store_id == credit.store_id:
        scope.require(Permission.SALE_CREDIT, credit.store_id)
    else:
        scope.require(Permission.SALE_CREDIT, at_store_id)
        if (
            await store_state(
                session, organization_id=scope.organization_id, store_id=credit.store_id
            )
            is StoreState.ACTIVE
        ):
            # Another store's debt is no business of this one while it trades.
            raise ForbiddenStoreError(store_id=str(credit.store_id))
        if credit.status != CreditStatus.OPEN.value:
            # Only what is still owed is another store's business (owner
            # decision, 2026-10-10). What was paid or written off is read in
            # the store itself, by the network's owner and managers; the
            # payment that closed it answered so when it was taken.
            raise ForbiddenStoreError(store_id=str(credit.store_id))
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
    statement: Select[Any],
    scope: RequestScope,
    store_id: uuid.UUID,
    status: CreditStatus | None,
    elsewhere: bool = False,
) -> Select[Any]:
    """The store's own debts; with `elsewhere`, those of every store of the
    network that does not trade, whose payments this one may take."""
    statement = statement.where(
        CustomerCredit.organization_id == scope.organization_id,
        CustomerCredit.store_id.in_(
            select(Store.id).where(
                Store.organization_id == scope.organization_id,
                Store.state != StoreState.ACTIVE.value,
            )
        )
        if elsewhere
        else CustomerCredit.store_id == store_id,
    )
    if status is not None:
        statement = statement.where(CustomerCredit.status == status.value)
    return statement


# Besides its digits, what a phone may be written or pasted with: spaces,
# «+», brackets, «-», «.», «/», and the invisible marks a phone's contacts
# add to a number copied from them (Unicode's format characters).
_PHONE_MARKS = frozenset("+()-./")


def _written_as_phone(wanted: str) -> bool:
    """Digits, and nothing else but what a phone is written or pasted with:
    «+38 (067) 123-45-67», «067.123.45.67», a number copied from contacts.
    One reading for this store's search and the closed stores': a number
    the one finds is never a name to the other (review, 2026-10-19)."""
    return bool(digits(wanted)) and all(
        char.isspace() or char in _PHONE_MARKS or unicodedata.category(char) == "Cf"
        for char in re.sub(r"\d", "", wanted)
    )


def _whole_phone(wanted: str) -> str | None:
    """The customer a whole phone number names, however it is written
    («+38 (067) 123-45-67», «0671234567»); None for a name or a part of a
    number. The digits' count and the equality make it exact."""
    if not _written_as_phone(wanted):
        return None
    if len(digits(wanted)) not in PHONE_DIGITS:
        return None
    return customer_key(digits(wanted))


# A name read as it is typed on any phone (owner decision, 2026-10-18): the
# apostrophes Android, iPhone and documents write, and those typed in their
# place, are one sign, and a Latin «i» is the Ukrainian «і» — as the
# catalogue reads a similar name (`app.modules.catalog.similar`); a Latin
# «ï» typed as one sign is «ї» (owner decision, 2026-10-21). Applied after
# the letter case is lowered, so «I» is «і» too, and «Ï» «ї».
_SAME_FROM = "’ʼ`´‘i" + chr(0x00EF)  # and a Latin «ï» typed as one sign
_SAME_TO = "'''''" + chr(0x0456) + chr(0x0457)  # five apostrophes, the Ukrainian «і» and «ї»
_SAME = str.maketrans(_SAME_FROM, _SAME_TO)


def _found_by(wanted: str) -> Any:
    """The customer's name, or any spelling of their phone.

    Each word typed, literally and in any letter case, in the name of one
    debt, in any order, as the till and «Повернення» read each word (credits
    task list, P1-3): «петренко оксана» finds «Оксана Петренко», and two
    spaces are one; «Мар'яна» finds «Мар’яна», «iрина» typed with a Latin
    «i» finds «Ірина», and an «ї» pasted in two parts or typed as a Latin
    «ï» is the letter. Words of two debts do not add up; a word typed twice
    is looked for once.

    Only a query written as a phone is looked for among phones: the digits of
    «Ірина 2» are part of a name, and would find whoever's number holds a 2.
    """
    # A letter pasted in two parts — «ї» as «і» and its dots — is the letter
    # written as one (owner decision, 2026-10-19): compared as Unicode's NFC
    # on both sides, after the fold, so a Latin «i» and its dots is «ї» too
    # (review, 2026-10-20). Nothing stored changes.
    name = func.normalize(
        func.translate(func.lower(CustomerCredit.customer_name), _SAME_FROM, _SAME_TO),
        literal_column("NFC"),
    )
    words = dict.fromkeys(unicodedata.normalize("NFC", wanted.lower().translate(_SAME)).split())
    conditions: list[Any] = [and_(*(name.contains(word, autoescape=True) for word in words))]
    if _written_as_phone(wanted):
        conditions.append(CustomerCredit.phone_digits.contains(digits(wanted), autoescape=True))
        conditions.append(CUSTOMER.contains(customer_key(digits(wanted)), autoescape=True))
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
    elsewhere: bool = False,
) -> tuple[list[CustomerView], bool]:
    """A store's debts by customer, the one with the newest debt first.

    A search finds customers by any of their debts, and then shows all of
    them: «Коваль» finds the phone, and the same phone's debt written down as
    «Ірина» is the same customer's. A payment is still taken on one debt the
    seller chooses (owner decision, 2026-10-01).

    `elsewhere` looks among the debts of the stores that do not trade, whose
    payments any trading store takes (owner decision, 2026-10-01): only by
    the customer's whole phone, however it is written, and only the debts
    still owed (owner decisions, 2026-10-10). Whoever pays brings their
    phone; other stores' customers are never browsed, by name or by a part
    of a number, and what was paid or written off there stays with the
    network's owner and managers, who read the store itself.
    """
    scope.require(Permission.SALE_CREDIT, store_id)
    wanted = query.strip()
    phone: str | None = None
    if elsewhere:
        phone = _whole_phone(wanted)
        if phone is None:
            raise ValidationFailedError(
                "Search for the customer by their whole phone number", reason="PHONE_REQUIRED"
            )
        status = CreditStatus.OPEN
    customer = _GROUP.label("customer")
    latest = func.max(CustomerCredit.created_at).label("latest")
    grouped = _in_store(select(customer, latest), scope, store_id, status, elsewhere)
    if elsewhere:
        grouped = grouped.where(CUSTOMER == phone)
    elif wanted:
        grouped = grouped.where(
            CUSTOMER.in_(
                _in_store(select(CUSTOMER), scope, store_id, status, elsewhere).where(
                    _found_by(wanted)
                )
            )
        )
    rows = (
        await session.execute(
            grouped.group_by(_GROUP).order_by(latest.desc(), _GROUP).limit(limit + 1).offset(offset)
        )
    ).all()
    phones: list[str] = [row.customer for row in rows[:limit]]
    debts: dict[str, list[CreditView]] = {phone: [] for phone in phones}
    for credit in (
        await session.scalars(
            _in_store(select(CustomerCredit), scope, store_id, status, elsewhere)
            .where(_GROUP.in_(phones))
            .order_by(CustomerCredit.created_at.desc(), CustomerCredit.id)
        )
    ).all():
        debts[group_of(credit)].append(await view(session, credit))
    # A customer whose every debt here was erased between the two reads has
    # none left under their phone: they are left out of this page.
    customers = [
        CustomerView(
            phone_digits=None if phone.startswith("erased:") else phone,
            customer_name=debts[phone][0].customer_name,
            customer_phone=debts[phone][0].customer_phone,
            owed=money(sum((debt.owed for debt in debts[phone]), ZERO)),
            open_debts=sum(1 for debt in debts[phone] if debt.status is CreditStatus.OPEN),
            credits=debts[phone],
        )
        for phone in phones
        if debts[phone]
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
                    func.count(func.distinct(CUSTOMER)),
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
    "CUSTOMER",
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
    "group_of",
    "list_credits",
    "list_customers",
    "money_back",
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
