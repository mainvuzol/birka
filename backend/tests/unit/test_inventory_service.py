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
from app.modules.inventory.service import (
    DIRECTION,
    TRANSFER_REFERENCE,
    MovementRequest,
    validate_location_flows,
    validate_movement,
)

STORE = uuid.uuid4()
VARIANT = uuid.uuid4()
SIZE = uuid.uuid4()
LOCATION = uuid.uuid4()


def movement(**kwargs: object) -> MovementRequest:
    defaults: dict[str, object] = {
        "location_id": LOCATION,
        "acting_store_id": STORE,
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


def test_ordering_separates_locations_and_sizes() -> None:
    same_variant_other_size = movement(size_id=uuid.UUID(int=9))
    same_everything_other_location = movement(location_id=uuid.UUID(int=9))

    assert movement().sort_key != same_variant_other_size.sort_key
    # The location leads the key, so the same coat in two warehouses is two
    # rows that lock independently — and the global lock order still holds.
    assert movement().sort_key != same_everything_other_location.sort_key
    assert movement().sort_key[0] == str(LOCATION)


def test_the_acting_store_is_not_part_of_the_lock_order() -> None:
    """Two stores selling from one warehouse must contend, not pass each other.

    If the acting store were in the sort key, the shared balance would sort
    into two independent keys and the whole point of ADR-0004 would be lost.
    """
    assert movement().sort_key == movement(acting_store_id=uuid.uuid4()).sort_key


# ---------------------------------------------------------------------------
# Invariant I24 — goods leave one place for another only as a transfer
# ---------------------------------------------------------------------------

WAREHOUSE_A = uuid.UUID(int=0xA)
WAREHOUSE_B = uuid.UUID(int=0xB)
TRANSFER = uuid.uuid4()


def leg(movement_type: MovementType, location: uuid.UUID, quantity: int, **kwargs: object):
    """One half of a transfer, pointing back at it the way the ledger requires."""
    defaults: dict[str, object] = {
        "location_id": location,
        "movement_type": movement_type,
        "quantity_delta": quantity,
        "reference_type": TRANSFER_REFERENCE,
        "reference_id": TRANSFER,
    }
    defaults.update(kwargs)
    return movement(**defaults)


def test_a_transfer_is_a_matching_pair() -> None:
    validate_location_flows(
        [
            leg(MovementType.TRANSFER_OUT, WAREHOUSE_A, -3),
            leg(MovementType.TRANSFER_IN, WAREHOUSE_B, 3),
        ]
    )


def test_half_a_transfer_is_refused_in_either_direction() -> None:
    """A TRANSFER_OUT alone is stock that vanished; a TRANSFER_IN alone is
    stock that appeared from nowhere. The plan's own test for I24."""
    with pytest.raises(ValidationFailedError, match="exactly one location"):
        validate_location_flows([leg(MovementType.TRANSFER_OUT, WAREHOUSE_A, -1)])
    with pytest.raises(ValidationFailedError, match="exactly one location"):
        validate_location_flows([leg(MovementType.TRANSFER_IN, WAREHOUSE_B, 1)])


def test_a_transfer_must_put_in_what_it_takes_out() -> None:
    with pytest.raises(ValidationFailedError, match="exactly what it takes out"):
        validate_location_flows(
            [
                leg(MovementType.TRANSFER_OUT, WAREHOUSE_A, -3),
                leg(MovementType.TRANSFER_IN, WAREHOUSE_B, 2),
            ]
        )


def test_a_transfer_to_the_same_place_is_refused() -> None:
    with pytest.raises(ValidationFailedError, match="two different locations"):
        validate_location_flows(
            [
                leg(MovementType.TRANSFER_OUT, WAREHOUSE_A, -1),
                leg(MovementType.TRANSFER_IN, WAREHOUSE_A, 1),
            ]
        )


def test_a_transfer_leg_must_name_its_transfer() -> None:
    """Without the reference two legs cannot be told apart from two halves of
    two different moves, and nothing in the ledger could pair them later."""
    with pytest.raises(ValidationFailedError, match="must name the transfer"):
        validate_location_flows(
            [
                leg(MovementType.TRANSFER_OUT, WAREHOUSE_A, -1, reference_id=None),
                leg(MovementType.TRANSFER_IN, WAREHOUSE_B, 1, reference_id=None),
            ]
        )
    with pytest.raises(ValidationFailedError, match="must name the transfer"):
        validate_location_flows(
            [
                leg(MovementType.TRANSFER_OUT, WAREHOUSE_A, -1, reference_type="sale"),
                leg(MovementType.TRANSFER_IN, WAREHOUSE_B, 1, reference_type="sale"),
            ]
        )


def test_legs_of_two_different_transfers_do_not_pair_with_each_other() -> None:
    """The out of one transfer and the in of another are two halves, not a pair."""
    with pytest.raises(ValidationFailedError, match="exactly one location"):
        validate_location_flows(
            [
                leg(MovementType.TRANSFER_OUT, WAREHOUSE_A, -1),
                leg(MovementType.TRANSFER_IN, WAREHOUSE_B, 1, reference_id=uuid.uuid4()),
            ]
        )


def test_two_legs_out_for_one_leg_in_are_refused() -> None:
    with pytest.raises(ValidationFailedError, match="exactly one location"):
        validate_location_flows(
            [
                leg(MovementType.TRANSFER_OUT, WAREHOUSE_A, -1),
                leg(MovementType.TRANSFER_OUT, uuid.UUID(int=0xC), -1),
                leg(MovementType.TRANSFER_IN, WAREHOUSE_B, 2),
            ]
        )


def test_several_lines_of_one_transfer_each_pair_up() -> None:
    other_size = uuid.uuid4()
    validate_location_flows(
        [
            leg(MovementType.TRANSFER_OUT, WAREHOUSE_A, -2),
            leg(MovementType.TRANSFER_IN, WAREHOUSE_B, 2),
            leg(MovementType.TRANSFER_OUT, WAREHOUSE_A, -1, size_id=other_size),
            leg(MovementType.TRANSFER_IN, WAREHOUSE_B, 1, size_id=other_size),
        ]
    )


def test_a_basket_drawing_from_two_warehouses_is_not_a_transfer() -> None:
    """The plan's other test for I24: a multi-location sale is legitimate."""
    validate_location_flows(
        [
            movement(location_id=WAREHOUSE_A, movement_type=MovementType.SALE, quantity_delta=-1),
            movement(location_id=WAREHOUSE_B, movement_type=MovementType.SALE, quantity_delta=-2),
        ]
    )


def test_found_on_one_shelf_and_missing_from_another_is_not_a_transfer() -> None:
    """The exact call the sale makes for M1-030's owner-approved basket.

    +2 confirmed on one shelf, -1 found missing from another, same coat, one
    call. It looks like a move and is not: they are two bounded observations
    (I18, I25). An earlier version of the I24 check refused this call and with
    it a real sale; this test is here so that nobody adds that check back.
    """
    validate_location_flows(
        [
            movement(
                location_id=WAREHOUSE_A,
                movement_type=MovementType.ADJUSTMENT,
                quantity_delta=2,
                reason_code=MovementReason.FOUND_DURING_SALE,
            ),
            movement(
                location_id=WAREHOUSE_B,
                movement_type=MovementType.ADJUSTMENT,
                quantity_delta=-1,
                reason_code=MovementReason.MISSING_AT_SALE,
            ),
        ]
    )
