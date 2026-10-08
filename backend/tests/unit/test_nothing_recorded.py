"""A refusal that proves nothing was recorded says so (ADR-0008 §9,
ADR-0013 §1).

`nothing_recorded()` wraps what a command does after its `command_id` was
looked up under its lock and found nothing: any refusal raised there proves
the command wrote nothing, and leaves with `details.recorded = false`, so a
phone that never heard the first answer settles the attempt instead of
holding every tab behind it. An identity refusal is the exception: a wrapped
region can hold another command's lookup («Клієнт забрав» runs the collected
sale's own inside the order's), and a `command_id` used for another request
proves nothing about what was recorded (mutant M22).
"""

from __future__ import annotations

import pytest

from app.core.errors import (
    DomainError,
    IdempotencyConflictError,
    IdempotencyInProgressError,
    InsufficientStockError,
    StoreNotTradingError,
    ValidationFailedError,
    nothing_recorded,
)
from app.modules.catalog import corrections


@pytest.mark.parametrize(
    ("refusal", "details"),
    [
        (ValidationFailedError("Invalid order transition"), {"recorded": False}),
        (
            InsufficientStockError(product_variant_id="v", requested=2, available=1),
            {"product_variant_id": "v", "requested": 2, "available": 1, "recorded": False},
        ),
        (
            StoreNotTradingError(store_id="s", state="BLOCKED"),
            {"store_id": "s", "state": "BLOCKED", "recorded": False},
        ),
    ],
    ids=lambda case: case.code if isinstance(case, DomainError) else None,
)
def test_a_refusal_inside_says_nothing_was_recorded(
    refusal: DomainError, details: dict[str, object]
):
    with pytest.raises(DomainError) as refused, nothing_recorded():
        raise refusal
    # The same refusal leaves: code and message as they were, `recorded` added.
    assert refused.value is refusal
    assert refused.value.to_payload() == {
        "code": refusal.code,
        "message": refusal.message,
        "details": details,
    }


def test_a_recorded_the_refusal_already_states_is_kept():
    refusal = ValidationFailedError(reason="SOMETHING", recorded=True)
    with pytest.raises(ValidationFailedError) as refused, nothing_recorded():
        raise refusal
    assert refused.value.details == {"reason": "SOMETHING", "recorded": True}


@pytest.mark.parametrize(
    "refusal",
    [IdempotencyConflictError(command_id="c"), IdempotencyInProgressError()],
    ids=lambda refusal: refusal.code,
)
def test_an_identity_refusal_leaves_untouched(refusal: DomainError):
    before = dict(refusal.details)
    with pytest.raises(type(refusal)) as refused, nothing_recorded():
        raise refusal
    assert refused.value is refusal
    assert refused.value.details == before
    assert "recorded" not in refused.value.to_payload().get("details", {})


def test_an_identity_refusal_from_a_nested_lookup_leaves_untouched():
    """The order's region holds the collected sale's own lookup, wrapped in
    turn: neither marks what that lookup refuses."""
    refusal = IdempotencyConflictError(command_id="c")
    with pytest.raises(IdempotencyConflictError) as refused, nothing_recorded():
        with nothing_recorded():
            raise refusal
    assert refused.value.details == {"command_id": "c"}


def test_anything_but_a_refusal_passes_untouched():
    failure = ValueError("not a refusal")
    with pytest.raises(ValueError, match="not a refusal") as raised, nothing_recorded():
        raise failure
    assert raised.value is failure
    assert not hasattr(raised.value, "details")


def test_the_catalogue_still_finds_it_where_it_was():
    """`catalog/intake.py` and `catalog_correction/service.py` import it from
    `catalog.corrections`; the move left them the same one."""
    assert corrections.nothing_recorded is nothing_recorded
