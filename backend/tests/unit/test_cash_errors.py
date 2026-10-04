"""Which refusals of the drawer's commands say `recorded: false` (ADR-0012,
B4, B10; ADR-0008 §9).

A refusal decided after a command looked itself up under its lock proves
the command wrote nothing, and says so: a phone that never heard the first
answer then settles the attempt, instead of holding every tab behind it for
good (`shared/journal.ts` settles an ambiguous attempt only on
`recordedNothing`). So does `STORE_NOT_TRADING` for a new command: whether
the store trades is decided after the lookup. A refusal decided before that
lookup — who may, which store, a `command_id` used for another request —
proves nothing of the kind, and must not say it.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.errors import (
    DomainError,
    ForbiddenStoreError,
    IdempotencyConflictError,
    NotFoundError,
    PaymentMethodChangedError,
    PermissionDeniedError,
    StoreNotTradingError,
    ValidationFailedError,
)
from app.modules.cash.service import REFUSALS, _not_trading, refuse
from app.modules.tenancy.models import StoreState

# B10: every reason marked "yes" that the drawer raises (`PAYMENT_METHOD_REQUIRED`
# is the money commands', builder 1's).
AFTER_THE_REPLAY = {
    "COUNT_IS_STALE",
    "CLOSED_BY_ANOTHER",
    "CLOSE_IN_BETWEEN",
    "ALREADY_CLOSED_TODAY",
    "NO_REASON",
    "NO_DIFFERENCE",
    "REASON_GIVEN",
    "DAY_CLOSED",
    "SAME_METHOD",
    "METHOD_NOT_FOR_THIS",
    "BEFORE_DRAWER",
}


def test_every_refusal_after_the_replay_is_known_and_no_other():
    assert set(REFUSALS) == AFTER_THE_REPLAY


@pytest.mark.parametrize("reason", sorted(AFTER_THE_REPLAY))
def test_each_refusal_after_the_replay_says_nothing_was_recorded(reason):
    with pytest.raises(ValidationFailedError) as refused:
        refuse(reason, closed_by="Олена")
    error = refused.value
    assert error.http_status == 422
    assert error.to_payload() == {
        "code": "VALIDATION_ERROR",
        "message": REFUSALS[reason],
        "details": {"reason": reason, "recorded": False, "closed_by": "Олена"},
    }


def test_a_way_changed_meanwhile_is_a_conflict_that_recorded_nothing():
    error = PaymentMethodChangedError(current="CASH")
    assert (error.code, error.http_status) == ("PAYMENT_METHOD_CHANGED", 409)
    assert error.to_payload()["details"] == {"current": "CASH", "recorded": False}
    # «Не вказано» stands as null, never as a missing key.
    assert PaymentMethodChangedError(current=None).details == {"current": None, "recorded": False}


def test_a_store_that_stopped_trading_refuses_a_new_command_saying_nothing_was_recorded():
    """Decided after the lookup, which answered a command recorded before the
    block or the archive with what it did."""
    with pytest.raises(StoreNotTradingError) as refused:
        _not_trading(uuid.UUID(int=1), StoreState.BLOCKED)
    error = refused.value
    assert (error.code, error.http_status) == ("STORE_NOT_TRADING", 403)
    assert error.to_payload()["details"] == {
        "store_id": str(uuid.UUID(int=1)),
        "state": "BLOCKED",
        "recorded": False,
    }


def test_an_unknown_reason_is_a_bug_not_a_refusal():
    with pytest.raises(KeyError):
        refuse("CLOSED_TODAY")


@pytest.mark.parametrize(
    "error",
    [
        IdempotencyConflictError(command_id="c"),
        PermissionDeniedError(permission="cash:close"),
        StoreNotTradingError(store_id="s", state="ARCHIVED"),
        ForbiddenStoreError(store_id="s"),
        NotFoundError("Unknown close"),
    ],
    ids=lambda error: error.code,
)
def test_refusals_before_the_replay_never_claim_nothing_was_recorded(error: DomainError):
    assert "recorded" not in error.to_payload().get("details", {})
