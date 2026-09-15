"""Text that PostgreSQL can actually store.

Python's `str` is wider than the database column it ends up in, and JSON can
carry every value in the gap. Two of them reach a write and fail there:

* **NUL** (`U+0000`) is a legal Python and JSON character. A PostgreSQL `text`
  or `varchar` column cannot hold it, and asyncpg raises
  `CharacterNotInRepertoireError` when the statement runs.
* **A lone surrogate** (`U+D800`–`U+DFFF`, e.g. `"\\ud800"` in a JSON body) is
  a legal Python `str` that has no UTF-8 encoding at all, so asyncpg raises
  `DataError` before the value reaches the wire.

Both arrive *after* the request has been authorized and has begun writing, so
what the client sees is a 500 — raised at will by the lowest-privileged role,
on every endpoint that stores free text or claims an idempotency key. Both were
found by the independent reviews of M1-017 and are refused here instead, as a
422 that says what is wrong.

Only these two are refused, and deliberately so. Every other control character
stores fine, and the shop's own text is not this module's business to police —
refusing more would be inventing a rule about real data (`constitution.md`
§22: unknown input is preserved, not guessed at).
"""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator

NUL = "\x00"


def reject_unstorable(value: str) -> str:
    """Refuse text the database cannot hold. Public so services can reuse it.

    Services validate for themselves rather than trusting that a caller came
    through a router: a Telegram handler calling a command directly must get
    the same refusal, not a driver error.
    """
    if NUL in value:
        raise ValueError("Text may not contain a NUL character")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        # A lone surrogate. Named plainly rather than echoed: the offending
        # character is exactly the one that cannot be put in a response body.
        raise ValueError("Text may not contain unpaired surrogate characters") from exc
    return value


def is_storable(value: str) -> bool:
    """Non-raising form, for a service that reports failures its own way."""
    try:
        reject_unstorable(value)
    except ValueError:
        return False
    return True


#: A `str` that is safe to store. Use it for every client-supplied text field
#: that reaches the database, including header values.
CleanText = Annotated[str, AfterValidator(reject_unstorable)]


__all__ = ["NUL", "CleanText", "is_storable", "reject_unstorable"]
