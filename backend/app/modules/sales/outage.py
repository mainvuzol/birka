"""The mark «продано під час збою». Owner decisions, 2026-10-04 and 2026-10-07; ADR-0013 §5.

The owner decided (business-rules.md, "the server is unreachable") that while
the server does not answer, the shop sells on paper, and that when it answers
the sales are typed in as ordinary sales: dated the day they are typed, with
the mark «продано під час збою». The mark may name who sold and at what hour,
as the paper says; both are optional. On 2026-10-07: the hour is today's, or
yesterday's with «вчора», and an older sale is typed with no time; the mark
is on sales only; a wrong mark cannot be changed afterwards. On 2026-10-10
the owner put the same mark on returns and debt payments typed from paper:
who took one and at what hour, as the paper says, both optional
(`PaperMark`, ADR-0021).

A sale's request may carry the mark (`OutageMark`), and everything here is
checked **after** the sale's replay lookup found nothing (`checked_mark`,
ADR-0013 §5.3). Who may be named, and which day it is, depend on people and
on the server's clock: a marked sale recorded, its answer lost and resent
days later — or after the person it names left — must still be answered with
what it did, never refused. A refusal from here then says `recorded: false`
(`core.errors.nothing_recorded`, around the sale command).

- **The shelf.** A marked sale says nothing about the shelf. «Фізично є»,
  «фізично відсутній» and a size clarified each describe the shelf, or the
  coat in hand, now, and at typing time nobody stands at it: goods already
  gone from the ledger are refused, and a manager fixes the balance first
  (owner decision, 2026-10-04; ADR-0013 §6).
- **Who sold.** One of `nameable_sellers`: an active person who may sell in
  this store now, by a grant for it or for the whole network, and never
  someone of another network (G4). The till's list of names asks the same
  function, so it never offers a name the check refuses.
- **The paper's time.** The store's own wall clock, to the minute, exactly as
  the request writes it (`YYYY-MM-DDTHH:MM`): today or yesterday in the
  store's zone, and not ahead of the server by more than its clocks may
  differ (G1). Stored as a moment composed in that zone; the sale's print
  keeps the literal, so it never depends on the store's zone setting.

Nothing here moves `sold_at`, the day in «Звіт» or the drawer period: the
paper's time is read only by the screens that show it.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationFailedError
from app.modules.authz.permissions import Permission
from app.modules.authz.service import holders_in_store
from app.modules.identity.models import AppUser
from app.modules.sales.models import Sale
from app.modules.tenancy.models import Store

# How a request writes the paper's time: the store's wall clock, to the
# minute, with no offset.
PAPER_TIME = "%Y-%m-%dT%H:%M"
# How far a paper time may run ahead of the server's clock and still be now:
# a phone or a wall clock a few minutes fast. A technical tolerance, not a
# rule (ADR-0013 §5.3).
CLOCKS_DIFFER_BY = timedelta(minutes=5)


def _now() -> datetime:
    """The server's clock, as a function a test can move."""
    return datetime.now(tz=UTC)


def paper_time(written: str) -> datetime:
    """The paper's time as written, a wall-clock time with no zone.

    Raises `ValueError` unless it is exactly `YYYY-MM-DDTHH:MM` and a real
    date and time. Only the shape, which depends on nothing but the value: a
    request's schema may check it before the replay lookup without ever
    stranding an attempt that was recorded (ADR-0013 §5.2).
    """
    parsed = datetime.fromisoformat(written)
    if parsed.isoformat(timespec="minutes") != written:
        # ISO takes seconds, an offset or a space too; one time is printed
        # one way, and an offset is the store's to know, not the phone's.
        raise ValueError("A time from paper is written YYYY-MM-DDTHH:MM")
    return parsed


@dataclass(frozen=True, slots=True)
class OutageMark:
    """The mark as a sale's request states it. `sold_at` is the paper's time
    exactly as the body carried it."""

    sold_by_user_id: uuid.UUID | None = None
    sold_at: str | None = None


@dataclass(frozen=True, slots=True)
class CheckedMark:
    """The mark as it is stored: who sold, and the paper's time as a moment."""

    sold_by_user_id: uuid.UUID | None
    sold_at: datetime | None


@dataclass(frozen=True, slots=True)
class MarkView:
    """The mark as a receipt and the store's list of sales show it: who sold,
    by name as well, and the paper's time; each None when the paper named
    none (ADR-0013 §5.6). «Звіт» reads the same columns itself: a report
    never reaches the command's module."""

    sold_by_user_id: uuid.UUID | None
    sold_by: str | None
    sold_at: datetime | None


def print_of_mark(mark: OutageMark | None) -> dict[str, object]:
    """What a sale's permanent print carries of its mark (ADR-0013 §5.4).

    Nothing when there is none, so every sale recorded before the mark
    existed keeps the print it was stored with and still replays. The paper's
    time as the literal the body carried, never the moment composed in the
    store's zone: a print never depends on how the store's zone is set. The
    same command resent with another mark, or without one, is another sale.
    """
    if mark is None:
        return {}
    return {
        "outage": {
            "sold_by_user_id": (
                str(mark.sold_by_user_id) if mark.sold_by_user_id is not None else None
            ),
            "sold_at": mark.sold_at,
        }
    }


async def nameable_sellers(
    session: AsyncSession,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    may: Permission = Permission.SALE_CREATE,
) -> dict[uuid.UUID, str]:
    """Who may be named as having sold in this store, with their names, in
    the order of their names: an active person whose active membership of
    this organization, for this store or for the whole network, holds
    `sale:create` (ADR-0013 §5.3, G4). For a return or a debt payment typed
    from paper, who may take one here: `sale:refund` or `sale:credit`
    (ADR-0021).

    The check of a marked command and the screens' list (`GET
    /stores/{id}/sellers`) both ask here. Someone who has left cannot be
    named: the paper's line is typed with «не вказано».
    """
    holders = await holders_in_store(session, organization_id, store_id, may)
    if not holders:
        return {}
    rows = await session.execute(
        select(AppUser.id, AppUser.display_name)
        .where(AppUser.id.in_(holders), AppUser.is_active.is_(True))
        .order_by(AppUser.display_name, AppUser.id)
    )
    return dict(rows.tuples().all())


async def checked_mark(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    mark: OutageMark,
    reports_the_shelf: bool,
    now: datetime | None = None,
) -> CheckedMark:
    """The mark of a new sale as it is stored, or a refusal.

    Called only for a sale that carries the mark, so an ordinary sale asks
    nothing more of the database, and only after its replay lookup found
    nothing (ADR-0013 §5.3): every refusal here proves nothing was recorded.
    """
    if reports_the_shelf:
        raise ValidationFailedError(
            "A sale typed from paper says nothing about the shelf: "
            "a manager corrects the stock first, then the sale is typed",
            reason="OUTAGE_SHELF_REPORT",
        )
    if mark.sold_by_user_id is not None and mark.sold_by_user_id not in (
        await nameable_sellers(session, organization_id, store_id)
    ):
        raise ValidationFailedError(
            "Whoever is named as having sold may not sell in this store",
            reason="OUTAGE_SELLER_UNKNOWN",
            sold_by_user_id=str(mark.sold_by_user_id),
        )
    sold_at = (
        await _moment(
            session,
            organization_id=organization_id,
            store_id=store_id,
            written=mark.sold_at,
            now=now or _now(),
            detail="sold_at",
        )
        if mark.sold_at is not None
        else None
    )
    return CheckedMark(sold_by_user_id=mark.sold_by_user_id, sold_at=sold_at)


@dataclass(frozen=True, slots=True)
class PaperMark:
    """The mark as a return's or a debt payment's request states it
    (ADR-0021): who took it, and the paper's time exactly as the body
    carried it, each None when the paper names none."""

    by_user_id: uuid.UUID | None = None
    at: str | None = None


@dataclass(frozen=True, slots=True)
class CheckedPaper:
    """A return's or a payment's mark as it is stored: who took it, and the
    paper's time as a moment."""

    by_user_id: uuid.UUID | None
    at: datetime | None


@dataclass(frozen=True, slots=True)
class PaperView:
    """A return's or a payment's mark as its screens show it: who took it,
    by name as well, and the paper's time."""

    by_user_id: uuid.UUID | None
    by: str | None
    at: datetime | None


def print_of_paper(mark: PaperMark | None) -> dict[str, object]:
    """What a return's or a payment's prints carry of its mark: nothing when
    there is none, so every one recorded before the mark existed keeps its
    print and still replays; otherwise who and the literal time, as a
    sale's do (ADR-0021)."""
    if mark is None:
        return {}
    return {
        "outage": {
            "by_user_id": str(mark.by_user_id) if mark.by_user_id is not None else None,
            "at": mark.at,
        }
    }


async def checked_paper(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    mark: PaperMark,
    may: Permission,
    now: datetime | None = None,
) -> CheckedPaper:
    """The mark of a new return or debt payment as it is stored, or a
    refusal, by the sale's rules (ADR-0021): whoever is named may take one in
    `store_id`, the store taking it (`may`), and the paper's time is that
    store's today or yesterday. Called only after the replay lookup found
    nothing, so a refusal proves nothing was recorded."""
    if mark.by_user_id is not None and mark.by_user_id not in (
        await nameable_sellers(session, organization_id, store_id, may)
    ):
        raise ValidationFailedError(
            "Whoever is named as having taken it may not take it in this store",
            reason="OUTAGE_SELLER_UNKNOWN",
            by_user_id=str(mark.by_user_id),
        )
    at = (
        await _moment(
            session,
            organization_id=organization_id,
            store_id=store_id,
            written=mark.at,
            now=now or _now(),
            detail="at",
        )
        if mark.at is not None
        else None
    )
    return CheckedPaper(by_user_id=mark.by_user_id, at=at)


async def _moment(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    written: str,
    now: datetime,
    detail: str,
) -> datetime:
    """The paper's time as a moment, in the store's zone: today's or
    yesterday's there, and not after the server's now by more than clocks
    differ (owner decision, 2026-10-07; G1). A refusal names the time under
    `detail`, the request's own name for it."""
    timezone = await session.scalar(
        select(Store.timezone).where(Store.id == store_id, Store.organization_id == organization_id)
    )
    if timezone is None:
        raise NotFoundError("Unknown store", store_id=str(store_id))
    zone = ZoneInfo(timezone)
    wall_clock = paper_time(written)
    # The day first: a date that old can never be ahead of now, so the two
    # refusals never meet, and a moment is composed only from a recent date.
    if wall_clock.date() < now.astimezone(zone).date() - timedelta(days=1):
        raise ValidationFailedError(
            "A time from paper is today's or yesterday's; type an older one without it",
            reason="OUTAGE_TIME_TOO_OLD",
            **{detail: written},
        )
    # fold=0: an hour the clocks repeat in autumn reads as its first pass.
    moment = wall_clock.replace(tzinfo=zone)
    if moment > now + CLOCKS_DIFFER_BY:
        raise ValidationFailedError(
            "This time from paper has not come yet",
            reason="OUTAGE_TIME_FUTURE",
            **{detail: written},
        )
    return moment.astimezone(UTC)


async def names_of(session: AsyncSession, named: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    """The names of the people a mark names, as they are named now: one
    query, and none when nobody is named."""
    if not named:
        return {}
    rows = await session.execute(
        select(AppUser.id, AppUser.display_name).where(AppUser.id.in_(named))
    )
    return dict(rows.tuples().all())


def paper_view(
    marked: bool, by_user_id: uuid.UUID | None, at: datetime | None, names: dict[uuid.UUID, str]
) -> PaperView | None:
    """A return's or a payment's mark from its stored columns, or None for
    one typed live."""
    if not marked:
        return None
    return PaperView(
        by_user_id=by_user_id,
        by=names.get(by_user_id) if by_user_id is not None else None,
        at=at,
    )


async def marks_of(session: AsyncSession, sales: Sequence[Sale]) -> dict[uuid.UUID, MarkView]:
    """The mark of each sale among `sales` that carries one, with the name of
    whoever it names, as that person is named now. One query for the names,
    and none when no sale names anyone: an ordinary sale costs nothing."""
    marked = [sale for sale in sales if sale.during_outage]
    named = {sale.outage_sold_by for sale in marked if sale.outage_sold_by is not None}
    names: dict[uuid.UUID, str] = (
        dict(
            (
                await session.execute(
                    select(AppUser.id, AppUser.display_name).where(AppUser.id.in_(named))
                )
            )
            .tuples()
            .all()
        )
        if named
        else {}
    )
    return {
        sale.id: MarkView(
            sold_by_user_id=sale.outage_sold_by,
            sold_by=names.get(sale.outage_sold_by) if sale.outage_sold_by is not None else None,
            sold_at=sale.outage_sold_at,
        )
        for sale in marked
    }


__all__ = [
    "CLOCKS_DIFFER_BY",
    "PAPER_TIME",
    "CheckedMark",
    "CheckedPaper",
    "MarkView",
    "OutageMark",
    "PaperMark",
    "PaperView",
    "checked_mark",
    "checked_paper",
    "marks_of",
    "nameable_sellers",
    "names_of",
    "paper_time",
    "paper_view",
    "print_of_mark",
    "print_of_paper",
]
