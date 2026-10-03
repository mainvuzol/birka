"""The owner's «Резервні копії» section (owner decision, 2026-09-30).

Since 2026-10-03 ("failures are visible") it also shows trouble on the server,
as the backups are: when the watcher last looked, what is wrong now, and what
was wrong in the last week.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import ScopeDep, SessionDep
from app.modules.authz.permissions import Permission
from app.modules.backups.models import BackupAlert, BackupRun
from app.modules.backups.server import server_overview
from app.modules.backups.service import overview
from app.modules.backups.status import DUE, reasons

router = APIRouter(tags=["ops"])


class NightResponse(BaseModel):
    started_at: datetime
    finished_at: datetime
    ok: bool
    archive: str | None
    archive_bytes: int | None
    drill_ok: bool | None
    restore_seconds: float | None
    # What failed, worded exactly as the Telegram message words it.
    reasons: list[str]


class MessageResponse(BaseModel):
    kind: str
    status: str
    created_at: datetime
    sent_at: datetime | None
    error: str | None


class OpenTroubleResponse(BaseModel):
    kind: str
    # The sentence the bot used.
    reason: str
    started_at: datetime
    # When the bot's message reached its first chat; None while nobody has.
    told_at: datetime | None


class EndedTroubleResponse(BaseModel):
    kind: str
    reason: str
    started_at: datetime
    ended_at: datetime


class ServerResponse(BaseModel):
    # The watcher's last completed look, so a watcher that stopped shows.
    looked_at: datetime | None
    # Not ended, oldest first.
    open: list[OpenTroubleResponse]
    # Ended in the last 7 days, newest first, at most 10.
    recent: list[EndedTroubleResponse]


class BackupsResponse(BaseModel):
    state: str
    checked_at: datetime
    due_hours: int
    latest: NightResponse | None
    last_good: NightResponse | None
    nights: list[NightResponse]
    your_last_message: MessageResponse | None
    server: ServerResponse


def _night(night: BackupRun | None) -> NightResponse | None:
    if night is None:
        return None
    return NightResponse(
        started_at=night.started_at,
        finished_at=night.finished_at,
        ok=night.ok,
        archive=night.archive,
        archive_bytes=night.archive_bytes,
        drill_ok=night.drill_ok,
        restore_seconds=night.restore_seconds,
        reasons=reasons(night.problems),
    )


def _message(message: BackupAlert | None) -> MessageResponse | None:
    if message is None:
        return None
    return MessageResponse(
        kind=message.kind,
        status=message.status,
        created_at=message.created_at,
        sent_at=message.sent_at,
        error=message.last_error,
    )


@router.get("/backups", response_model=BackupsResponse)
async def read_backups(scope: ScopeDep, session: SessionDep) -> BackupsResponse:
    # Organization-wide only: a backup is of the whole server, so a grant
    # for one store does not reach it.
    scope.require(Permission.BACKUP_VIEW)
    now = datetime.now(UTC)
    seen = await overview(session, user_id=scope.user_id, now=now)
    server = await server_overview(session, now=now)
    nights = [_night(night) for night in seen.nights]
    return BackupsResponse(
        state=seen.state.value,
        checked_at=now,
        due_hours=int(DUE.total_seconds() // 3600),
        latest=_night(seen.latest),
        last_good=_night(seen.last_good),
        nights=[night for night in nights if night is not None],
        your_last_message=_message(seen.your_last_message),
        server=ServerResponse(
            looked_at=server.looked_at,
            open=[
                OpenTroubleResponse(
                    kind=trouble.kind,
                    reason=trouble.reason,
                    started_at=trouble.started_at,
                    told_at=trouble.told_at,
                )
                for trouble in server.open
            ],
            recent=[
                EndedTroubleResponse(
                    kind=trouble.kind,
                    reason=trouble.reason,
                    started_at=trouble.started_at,
                    ended_at=trouble.ended_at,
                )
                for trouble in server.recent
                if trouble.ended_at is not None
            ],
        ),
    )
