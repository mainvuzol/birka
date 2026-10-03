"""How sign-ins have gone lately, for the watcher.

The owner decided on 2026-10-03 that they and an administrator hear from the
bot when nobody can sign in: for 10 minutes no sign-in has succeeded while
people kept trying. The usual causes are the server's clock (launch data looks
expired or dated in the future) and a bot token that no longer matches the
bot (every signature fails). A seller reopening the app fixes neither. It
does fix one phone's stale launch data (an old launch sent again), and the
sign-in endpoint is open to anyone, so these figures also say how many
people were refused, and only refusals from someone really trying count.
The watcher (`scripts.backup_watch`) reads them from `GET /internal/status`
and decides.

What counts:

- **A success** is launch data that passed its signature and freshness
  checks. What follows it, a person with no access for one, is not a failed
  sign-in: the sign-in itself works.
- **A refusal** is launch data refused by those checks
  (`InvalidInitDataError`). It counts only with a sender, someone who is
  really trying:
  - `expired` and `future`: the signature passed, so the Telegram user it
    names is the sender;
  - `signature`: the id it claims, only when that id is an active person of
    the shop (`service.authenticate_with_init_data` asks the database). A
    stranger posting junk is not counted, and a wrong token still is: the
    sellers it refuses are the shop's people, even right after a restart;
  - `malformed`: never. No Telegram client sends it.
  A sign-in refused by the per-address limit is neither: it never reached
  the checks. Every refusal is logged, counted or not.

The figures live in the API process's memory. One uvicorn process serves the
API (`backend/Dockerfile`), so every sign-in is counted here; a restart starts
them again from nothing, which the watcher reads as "nobody has tried yet".
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any, get_args

from app.core.errors import InitDataRefusal

REFUSALS: tuple[InitDataRefusal, ...] = get_args(InitDataRefusal)

# The distinct senders kept, at most: the watcher asks for two, so a flood
# of ids only has to be counted, never all remembered.
SENDERS_AT_MOST = 100


def _iso(moment: datetime | None) -> str | None:
    return None if moment is None else moment.isoformat(timespec="seconds")


class SignInOutcomes:
    """The last success, and the counted refusals since it.

    Not locked: it is only touched from the event loop, and nothing in it
    awaits.
    """

    def __init__(self) -> None:
        self.last_success_at: datetime | None = None
        # The first counted refusal after the last success (or since the
        # process started, when nobody has signed in yet), and the latest.
        self.failing_since: datetime | None = None
        self.last_failure_at: datetime | None = None
        self._reasons: Counter[InitDataRefusal] = Counter()
        # Telegram user ids, never shown: the status gives their number only.
        self._senders: set[int] = set()

    def succeeded(self, at: datetime) -> None:
        self.last_success_at = at
        self.failing_since = None
        self.last_failure_at = None
        self._reasons.clear()
        self._senders.clear()

    def refused(self, reason: InitDataRefusal, at: datetime, *, sender: int | None) -> bool:
        """Count a refusal from `sender`; one with no sender, or `malformed`,
        is not counted. Returns whether it was."""
        if sender is None or reason == "malformed":
            return False
        if self.failing_since is None:
            self.failing_since = at
        self.last_failure_at = at
        self._reasons[reason] += 1
        if len(self._senders) < SENDERS_AT_MOST:
            self._senders.add(sender)
        return True

    @property
    def failures(self) -> int:
        return sum(self._reasons.values())

    def snapshot(self) -> dict[str, Any]:
        """As `GET /internal/status` gives it: every reason, zeros included,
        and how many people were refused, never who."""
        return {
            "last_success_at": _iso(self.last_success_at),
            "failing_since": _iso(self.failing_since),
            "last_failure_at": _iso(self.last_failure_at),
            "failures": self.failures,
            "senders": len(self._senders),
            "reasons": {reason: self._reasons[reason] for reason in REFUSALS},
        }


__all__ = ["REFUSALS", "SENDERS_AT_MOST", "SignInOutcomes"]
