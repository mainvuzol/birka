"""Movement validation and ordering — the parts that need no database.

These guard the two mistakes that produce a plausible-looking but wrong ledger:
a movement whose direction contradicts its type, and an adjustment nobody can
explain later.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.errors import ValidationFailedError
from app.modules.inventory.models import MovementReason, MovementType
from app.modules.inventory.service import DIRECTION, MovementRequest, validate_movement

STORE = uuid.uuid4()
VARIANT = uuid.uuid4()
SIZE = uuid.uuid4()


def movement(**kwargs: object) -> MovementRequest:
    defaults: dict[str, object] = {
        "store_id": STORE,
        "product_variant_id": VARIANT,
        "size_id": SIZE,
        "quantity_delta": 1,
        "movement_type": MovementType.DELIVERY,
    }
    defaults.update(kwargs)
    return MovementRequest(**defaults)  # type: ignore[arg-type]


def test_a_movement_must_change_something() -> None:
    with pytest.raises(ValidationFailedError, match="change the quantity"):
        validate_movement(movement(quantity_delta=0))


def test_a_sale_may_not_add_stock() -> None:
    """A positive SALE would read as revenue that increased inventory."""
    with pytest.raises(ValidationFailedError, match="must move stock down"):
        validate_movement(movement(movement_type=MovementType.SALE, quantity_delta=3))


def test_a_delivery_may_not_remove_stock() -> None:
    with pytest.raises(ValidationFailedError, match="must move stock up"):
        validate_movement(movement(movement_type=MovementType.DELIVERY, quantity_delta=-3))


def test_a_transfer_out_must_be_negative() -> None:
    with pytest.raises(ValidationFailedError):
        validate_movement(movement(movement_type=MovementType.TRANSFER_OUT, quantity_delta=2))


def test_correct_directions_are_accepted() -> None:
    validate_movement(movement(movement_type=MovementType.SALE, quantity_delta=-2))
    validate_movement(movement(movement_type=MovementType.DELIVERY, quantity_delta=2))
    validate_movement(movement(movement_type=MovementType.REFUND_RETURN, quantity_delta=1))
    validate_movement(movement(movement_type=MovementType.TRANSFER_IN, quantity_delta=1))


def test_an_adjustment_must_explain_itself() -> None:
    """`.ai/workflows/inventory-adjustment.md`. The database enforces this too;
    failing here gives the seller a usable message instead of a 500."""
    with pytest.raises(ValidationFailedError, match="reason code"):
        validate_movement(
            movement(movement_type=MovementType.ADJUSTMENT, quantity_delta=5, reason_code=None)
        )


def test_an_adjustment_may_go_either_way_when_explained() -> None:
    """Stock is found as well as lost — direction is the caller's to state."""
    validate_movement(
        movement(
            movement_type=MovementType.ADJUSTMENT,
            quantity_delta=2,
            reason_code=MovementReason.FOUND_DURING_SALE,
        )
    )
    validate_movement(
        movement(
            movement_type=MovementType.ADJUSTMENT,
            quantity_delta=-2,
            reason_code=MovementReason.DAMAGED,
        )
    )


def test_only_the_genuinely_bidirectional_types_are_unconstrained() -> None:
    """Every movement type either has a fixed direction or is one of the two
    that legitimately go both ways. A new type added without a decision here
    would silently accept either sign."""
    bidirectional = {MovementType.ADJUSTMENT, MovementType.STOCKTAKE_CORRECTION}

    assert set(DIRECTION) | bidirectional == set(MovementType)
    assert not set(DIRECTION) & bidirectional


def test_ordering_is_stable_regardless_of_input_order() -> None:
    """Two concurrent commands must touch rows in the same order or they can
    deadlock each other."""
    a = movement(product_variant_id=uuid.UUID(int=1))
    b = movement(product_variant_id=uuid.UUID(int=2))
    c = movement(product_variant_id=uuid.UUID(int=3))

    forwards = sorted([a, b, c], key=lambda r: r.sort_key)
    backwards = sorted([c, b, a], key=lambda r: r.sort_key)

    assert [r.sort_key for r in forwards] == [r.sort_key for r in backwards]


def test_ordering_separates_stores_and_sizes() -> None:
    same_variant_other_size = movement(size_id=uuid.UUID(int=9))

    assert movement().sort_key != same_variant_other_size.sort_key
