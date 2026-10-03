"""Trouble on the server, kept in the database and read for the owner.

Two callers:

- `scripts.backup_watch` keeps its book of incidents (`incidents.Book`) in
  `server_incident` whenever the database answers (`keep`), and learns from
  it who the owners are (`owner_chats`);
- `GET /api/v1/backups` reads what the «Резервні копії» section shows
  (`server_overview`).

The watcher's memory is what it acts on; the database is what survives a
restart. While the database is down — exactly when trouble matters most —
the watcher goes on in memory, and writes what happened when the database is
back, with the times it really happened.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.authz.permissions import Permission
from app.modules.authz.service import organization_wide_holders
from app.modules.backups.incidents import Book, Incident, Kind, News, adopt, merged
from app.modules.backups.models import ServerIncident, ServerWatch
from app.modules.identity.service import telegram_chats

# What the section shows of trouble that has ended.
RECENT = timedelta(days=7)
RECENT_AT_MOST = 10

WATCH_ROW = 1


def incident_of(row: ServerIncident) -> Incident:
    return Incident(
        kind=Kind(row.kind),
        reason=row.reason,
        started_at=row.started_at,
        told_at=row.told_at,
        reminders=row.reminders,
        ended_at=row.ended_at,
        row=row.id,
    )


def _write(row: ServerIncident, incident: Incident) -> Incident:
    row.reason = incident.reason
    row.started_at = incident.started_at
    row.told_at = incident.told_at
    row.reminders = incident.reminders
    row.ended_at = incident.ended_at
    return replace(incident, row=row.id)


async def keep(
    session: AsyncSession, book: Book, *, now: datetime, looked_at: datetime | None
) -> tuple[Book, list[News]]:
    """Write `book` and take in what only the database knows. Returns the
    book as written — every incident with its row, nothing left unwritten —
    and the news an adopted incident still owes. Does not commit.

    One trouble is one row. An incident's row is the id it was given when
    it started (`incidents.step`), so a write repeated because its
    confirmation was lost (a time limit after the commit) finds the row it
    made and rewrites it. The database's open row of a kind and the
    watcher's incident of that kind are the same trouble, even when the
    watcher noticed it again after a restart with the database down: it
    began when the earlier of them saw it begin. An open row the watcher
    does not know is taken in, not announced again.

    `looked_at`, when given, is recorded as the watcher's last look."""
    stored = list(
        (
            await session.scalars(
                select(ServerIncident).where(ServerIncident.ended_at.is_(None)).with_for_update()
            )
        ).all()
    )
    open_rows = {Kind(row.kind): row for row in stored}
    taken: set[uuid.UUID] = set()

    async def row_for(incident: Incident) -> ServerIncident | None:
        if incident.row is not None:
            row = await session.get(ServerIncident, incident.row)
            if row is not None:
                return row
        row = open_rows.get(incident.kind)
        if row is not None and row.id not in taken:
            return row
        return None

    async def written(incident: Incident) -> Incident:
        row = await row_for(incident)
        if row is None:
            row = ServerIncident(id=incident.row or uuid.uuid4(), kind=incident.kind.value)
            session.add(row)
        else:
            incident = merged(incident, incident_of(row))
        taken.add(row.id)
        return _write(row, incident)

    # Closing first: an old open row closed by an incident that ended while
    # the database was down must be closed before a new one of the same kind
    # is opened, or the one-open-per-kind index refuses it.
    for incident in book.ended:
        await written(incident)
    await session.flush()
    opened = {kind: await written(incident) for kind, incident in book.open.items()}
    await session.flush()

    result = Book(open=opened, ended=(), failing_since=book.failing_since)
    news: list[News] = []
    for kind, row in open_rows.items():
        if row.id in taken or kind in result.open:
            continue
        result, owed = adopt(result, incident_of(row), now)
        news.extend(owed)

    if looked_at is not None:
        await session.execute(
            pg_insert(ServerWatch)
            .values(id=WATCH_ROW, looked_at=looked_at)
            .on_conflict_do_update(index_elements=["id"], set_={"looked_at": looked_at})
        )
    return result, news


async def owner_chats(session: AsyncSession) -> frozenset[int]:
    """The chats of the people who hear about backups: everyone holding
    `backup:view` organization-wide (owner decision, 2026-10-03: "the owner
    here means the people who hear about backups")."""
    owners = await organization_wide_holders(session, Permission.BACKUP_VIEW)
    return frozenset((await telegram_chats(session, owners)).values())


@dataclass(frozen=True, slots=True)
class ServerOverview:
    # The watcher's last completed look; None when it never looked.
    looked_at: datetime | None
    # Not ended, oldest first.
    open: list[ServerIncident]
    # Ended in the last week, newest first.
    recent: list[ServerIncident]


async def server_overview(session: AsyncSession, *, now: datetime) -> ServerOverview:
    looked_at = await session.scalar(
        select(ServerWatch.looked_at).where(ServerWatch.id == WATCH_ROW)
    )
    opened = list(
        (
            await session.scalars(
                select(ServerIncident)
                .where(ServerIncident.ended_at.is_(None))
                .order_by(ServerIncident.started_at, ServerIncident.id)
            )
        ).all()
    )
    recent = list(
        (
            await session.scalars(
                select(ServerIncident)
                .where(ServerIncident.ended_at >= now - RECENT)
                .order_by(ServerIncident.ended_at.desc(), ServerIncident.id)
                .limit(RECENT_AT_MOST)
            )
        ).all()
    )
    return ServerOverview(looked_at=looked_at, open=opened, recent=recent)


__all__ = [
    "RECENT",
    "RECENT_AT_MOST",
    "ServerOverview",
    "incident_of",
    "keep",
    "owner_chats",
    "server_overview",
]
