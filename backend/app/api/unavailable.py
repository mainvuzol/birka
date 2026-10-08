"""Whether a request failed because the server cannot serve (ADR-0013 §2).

Asked by the request middleware (`app/core/correlation.py`) of an error
nothing handled, before it answers 500. A reason turns the answer into 503
`SERVER_UNAVAILABLE`, which the phone reads as "the server does not answer"
and tells the seller to sell on paper (owner decision, 2026-10-04).

- `DATABASE`: the error itself says the database does not answer
  (`app/core/unavailable.py`).
- `SCHEMA`: an undefined table, column or function, **and** the readiness
  check (`app/api/internal.py database_state`) says the schema is behind
  this code: a migration was not run. The same error with the schema at this
  code's head is a bug, and stays a 500 with its number. If the check finds
  the database not answering, that is the reason.

Anything this cannot decide is no reason: the request is answered 500, as
before.
"""

from __future__ import annotations

from app.api.internal import database_state
from app.core.db import get_sessionmaker
from app.core.unavailable import UnavailableReason, database_unreachable, schema_suspect


async def classify(error: BaseException) -> UnavailableReason | None:
    """`DATABASE`, `SCHEMA`, or None for a failure that is not the server's."""
    if database_unreachable(error):
        return "DATABASE"
    if not schema_suspect(error):
        return None
    try:
        # A session of its own: the request's is spoiled by the error.
        async with get_sessionmaker()() as session:
            state = await database_state(session)
    except Exception:
        # No engine (an app whose sessions a test supplies), or the check
        # itself failing: nothing proves the schema is behind.
        return None
    if state == "behind":
        return "SCHEMA"
    if state == "unreachable":
        return "DATABASE"
    return None


__all__ = ["classify"]
