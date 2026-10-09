"""A debt's customer erased: the term ran out, or the owner was asked.

The owner decided on 2026-10-09 (business-rules.md, "customers' data";
ADR-0015):

- a debt paid or returned keeps its customer's name and phone for a year
  after it closed, and a written-off one for three;
- then the name and phone are erased, and every sum stays: the debt reads
  «Покупця стерто», and neither the drawer nor a report changes;
- a customer who asks is erased at once, on the owner's word, from every
  closed debt under their phone: the network's owner in the whole network,
  a store's owner in that store (2026-10-09, readings C-a and C-c); an open
  debt keeps them, then its own term runs, or the owner erases it again once
  it is closed (C-b);
- a write-off's reason is erased with the customer: people write names in it.

The database keeps an erased customer erased, and lets nothing but the
reason of a write-off change in the debt's ledger (`0038`).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationFailedError
from app.core.logging import get_logger
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.credit.models import CreditEntry, CreditStatus, CustomerCredit, EntryKind
from app.modules.credit.service import CUSTOMER, CreditView, customer_key, view

logger = get_logger(__name__)

# How long a closed debt keeps its customer (owner decisions, 2026-10-09).
KEPT_PAID_YEARS = 1
KEPT_WRITTEN_OFF_YEARS = 3
# Debts erased per transaction by the hourly erasure.
BATCH = 500


@dataclass(frozen=True, slots=True)
class Erased:
    """What the owner's erasure did."""

    # Closed debts whose customer was erased now.
    erased: int
    # The same customer's open debts: they keep the customer.
    still_open: int
    # The whole network, or only the debt's store.
    network: bool
    # The debt the owner erased from, as it reads now.
    credit: CreditView


def years_before(moment: datetime, years: int) -> datetime:
    """The same moment `years` earlier; 29 February is 28 February then."""
    try:
        return moment.replace(year=moment.year - years)
    except ValueError:
        return moment.replace(year=moment.year - years, day=28)


async def _erase(
    session: AsyncSession,
    credits: Sequence[CustomerCredit],
    *,
    now: datetime,
    by: uuid.UUID | None,
) -> None:
    """Erase these debts' customers, and their write-offs' reasons. The rows
    are locked by the caller."""
    for credit in credits:
        credit.customer_name = None
        credit.customer_phone = None
        credit.phone_digits = None
        credit.customer_erased_at = now
        credit.customer_erased_by_user_id = by
    await session.flush()
    await session.execute(
        update(CreditEntry)
        .where(
            CreditEntry.credit_id.in_([credit.id for credit in credits]),
            CreditEntry.kind == EntryKind.WRITE_OFF.value,
            CreditEntry.note.is_not(None),
        )
        .values(note=None)
        # The ledger's rows this session already holds read the erasure too.
        .execution_options(synchronize_session="fetch")
    )
    for credit in credits:
        # The audit log says that the customer was erased and why, never who
        # they were.
        await audit.record(
            session,
            organization_id=credit.organization_id,
            actor_user_id=by,
            action="credit.customer_erased",
            entity_type="customer_credit",
            entity_id=credit.id,
            after={"by": "term" if by is None else "request"},
        )


async def erase_expired(session: AsyncSession, *, now: datetime, batch: int = BATCH) -> int:
    """Erase every customer whose term has run out, a batch per transaction,
    and say how many. Run hourly by the watcher (`scripts.backup_watch`).

    A debt another transaction holds — a return being taken on it — is
    skipped, and erased an hour later."""
    paid_before = years_before(now, KEPT_PAID_YEARS)
    written_off_before = years_before(now, KEPT_WRITTEN_OFF_YEARS)
    erased = 0
    while True:
        credits = (
            await session.scalars(
                select(CustomerCredit)
                .where(
                    CustomerCredit.customer_erased_at.is_(None),
                    CustomerCredit.status != CreditStatus.OPEN.value,
                    or_(
                        and_(
                            CustomerCredit.status == CreditStatus.SETTLED.value,
                            CustomerCredit.closed_at <= paid_before,
                        ),
                        and_(
                            CustomerCredit.status == CreditStatus.WRITTEN_OFF.value,
                            CustomerCredit.closed_at <= written_off_before,
                        ),
                    ),
                )
                .order_by(CustomerCredit.closed_at, CustomerCredit.id)
                .limit(batch)
                .with_for_update(skip_locked=True)
            )
        ).all()
        if credits:
            await _erase(session, credits, now=now, by=None)
            erased += len(credits)
        await session.commit()
        if len(credits) < batch:
            if erased:
                logger.info("credit.customers_erased", erased=erased)
            return erased


async def erase_customer(
    session: AsyncSession, *, scope: RequestScope, credit_id: uuid.UUID
) -> Erased:
    """The owner erases this debt's customer at their request, from every
    closed debt under the same phone, one phone being one customer (owner
    decision, 2026-10-01): the network's owner in every store of the network,
    the owner of one store in the debt's store (owner, 2026-10-09, C-a and
    C-c). Asked of an open debt, it is refused; the customer's other open
    debts within that reach are counted and kept.

    Asked again, it finds the customer already erased and erases nothing."""
    network = scope.can(Permission.CREDIT_ERASE_CUSTOMER)
    if not network and not any(
        scope.can(Permission.CREDIT_ERASE_CUSTOMER, store_id) for store_id in scope.store_ids
    ):
        # Refused before the debt is even looked for.
        scope.require(Permission.CREDIT_ERASE_CUSTOMER)
    credit = await session.scalar(
        select(CustomerCredit).where(
            CustomerCredit.id == credit_id,
            CustomerCredit.organization_id == scope.organization_id,
        )
    )
    if credit is None:
        raise NotFoundError("Unknown debt", credit_id=str(credit_id))
    if not network:
        # A store's owner, in their store; a blocked or archived one is the
        # network owner's.
        scope.require(Permission.CREDIT_ERASE_CUSTOMER, credit.store_id)
    if credit.phone_digits is None:
        return Erased(erased=0, still_open=0, network=network, credit=await view(session, credit))
    if credit.status == CreditStatus.OPEN.value:
        raise ValidationFailedError(
            "An open debt keeps its customer until it is closed", reason="STILL_OWED"
        )
    reach = select(CustomerCredit).where(
        CustomerCredit.organization_id == scope.organization_id,
        CustomerCredit.customer_erased_at.is_(None),
        CUSTOMER == customer_key(credit.phone_digits),
    )
    if not network:
        reach = reach.where(CustomerCredit.store_id == credit.store_id)
    theirs = (await session.scalars(reach.order_by(CustomerCredit.id).with_for_update())).all()
    closed = [debt for debt in theirs if debt.status != CreditStatus.OPEN.value]
    if closed:
        await _erase(session, closed, now=datetime.now(tz=UTC), by=scope.user_id)
    await session.refresh(credit)
    logger.info(
        "credit.customer_erased",
        credit_id=str(credit.id),
        erased=len(closed),
        still_open=len(theirs) - len(closed),
        network=network,
    )
    return Erased(
        erased=len(closed),
        still_open=len(theirs) - len(closed),
        network=network,
        credit=await view(session, credit),
    )


__all__ = [
    "BATCH",
    "KEPT_PAID_YEARS",
    "KEPT_WRITTEN_OFF_YEARS",
    "Erased",
    "erase_customer",
    "erase_expired",
    "years_before",
]
