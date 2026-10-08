"""Which failures are the server's own: its database does not answer, or its
schema is behind this code (ADR-0013 §2).

A request that fails for one of these was not refused, and nothing in it was
wrong: the server could not serve it at all. The phone reads such an answer
as "the server does not answer" and tells the seller to sell on paper (owner
decision, 2026-10-04), so it must never stand for a bug. Everything not named
here stays a 500 with its number (ADR-0011 §6).

Only the error's kind and its SQLSTATE are read, never its text: a connection
error's text may name the database's host (`app/api/internal.py` keeps it
out of the log for the same reason).

Core: the standard library and SQLAlchemy only. Whether a schema error means
the schema is behind is the readiness check's question, asked by the API
layer (`app/api/unavailable.py`).
"""

from __future__ import annotations

import socket
from collections.abc import Iterator
from typing import Literal

from sqlalchemy import exc as sa_exc

# What a 503 `SERVER_UNAVAILABLE` names in `details.reason`.
UnavailableReason = Literal["DATABASE", "SCHEMA"]

# How far down an error's causes are looked: SQLAlchemy's wrapper, the
# adapted DBAPI error, the driver's own, and what that one was raised from.
_DEPTH = 5

# SQLSTATE classes that mean the database cannot serve: 08, connection
# exception; 53, insufficient resources (disk full, too many connections).
_UNREACHABLE_CLASSES = frozenset({"08", "53"})
# 57P01 admin_shutdown, 57P02 crash_shutdown, 57P03 cannot_connect_now (the
# database is starting up). Not 57014: a statement cancelled by its timeout
# is a request that ran too long, not a server that is down.
_UNREACHABLE_STATES = frozenset({"57P01", "57P02", "57P03"})
# Undefined table, column, function: what code newer than its schema meets.
# Equally what a bug meets, so these alone decide nothing (ADR-0013 §2).
_SCHEMA_STATES = frozenset({"42P01", "42703", "42883"})


def _chain(error: BaseException) -> Iterator[BaseException]:
    """The error and what it carries: SQLAlchemy's `orig`, then `__cause__`
    and `__context__`, at most `_DEPTH` steps from the error, each once."""
    seen: set[int] = set()
    level: list[BaseException] = [error]
    for _ in range(_DEPTH + 1):
        following: list[BaseException] = []
        for item in level:
            if id(item) in seen:
                continue
            seen.add(id(item))
            yield item
            for linked in (getattr(item, "orig", None), item.__cause__, item.__context__):
                if isinstance(linked, BaseException):
                    following.append(linked)
        if not following:
            return
        level = following


def _sqlstate(error: BaseException) -> str | None:
    # Both asyncpg's own errors and SQLAlchemy's adapted ones carry it.
    state = getattr(error, "sqlstate", None)
    return state if isinstance(state, str) else None


def _unreachable(error: BaseException) -> bool:
    if isinstance(error, sa_exc.TimeoutError):
        # The pool gave up waiting for a free connection (`core/db.py`).
        return True
    if isinstance(error, ConnectionError | socket.gaierror | TimeoutError):
        # SQLAlchemy does not translate what fails while connecting: refused,
        # reset, a name that does not resolve, no answer in time. Any other
        # `OSError` (a file, say) is not the database.
        return True
    if isinstance(error, sa_exc.DBAPIError) and error.connection_invalidated:
        return True
    state = _sqlstate(error)
    return state is not None and (state[:2] in _UNREACHABLE_CLASSES or state in _UNREACHABLE_STATES)


def database_unreachable(error: BaseException) -> bool:
    """Whether `error` says the database does not answer, or cannot serve."""
    return any(_unreachable(item) for item in _chain(error))


def schema_suspect(error: BaseException) -> bool:
    """Whether `error` is what a schema behind this code raises. A suspicion
    only: the readiness check decides (`app/api/unavailable.py`)."""
    return any(_sqlstate(item) in _SCHEMA_STATES for item in _chain(error))


__all__ = ["UnavailableReason", "database_unreachable", "schema_suspect"]
