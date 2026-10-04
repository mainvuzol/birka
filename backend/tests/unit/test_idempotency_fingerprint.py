"""Request fingerprinting.

The fingerprint decides whether a repeated key is a retry (replay the answer)
or a mistake (refuse). Getting it wrong in either direction is bad: too loose
and one seller replays another's response, too strict and an honest retry
re-executes a sale.
"""

from __future__ import annotations

import uuid

from app.core.idempotency import fingerprint
from app.modules.sales.payment import PaymentMethod, print_of

ACTOR = uuid.uuid4()
STORE = uuid.uuid4()
PAYLOAD = {"store_id": str(STORE), "lines": [{"quantity": 2, "size_id": "s"}]}


def test_the_same_request_fingerprints_the_same() -> None:
    first = fingerprint(PAYLOAD, actor_user_id=ACTOR, store_id=STORE)
    second = fingerprint(PAYLOAD, actor_user_id=ACTOR, store_id=STORE)

    assert first == second


def test_key_order_does_not_change_the_fingerprint() -> None:
    """A client that serialises its JSON differently is still retrying."""
    reordered = {"lines": PAYLOAD["lines"], "store_id": PAYLOAD["store_id"]}

    assert fingerprint(reordered, actor_user_id=ACTOR, store_id=STORE) == fingerprint(
        PAYLOAD, actor_user_id=ACTOR, store_id=STORE
    )


def test_a_changed_quantity_changes_the_fingerprint() -> None:
    """The case the conflict rule exists for: same key, different command."""
    changed = {"store_id": str(STORE), "lines": [{"quantity": 3, "size_id": "s"}]}

    assert fingerprint(changed, actor_user_id=ACTOR, store_id=STORE) != fingerprint(
        PAYLOAD, actor_user_id=ACTOR, store_id=STORE
    )


def test_a_different_seller_is_a_different_command() -> None:
    """Two sellers on a shared shop phone must not replay each other."""
    other = uuid.uuid4()

    assert fingerprint(PAYLOAD, actor_user_id=other, store_id=STORE) != fingerprint(
        PAYLOAD, actor_user_id=ACTOR, store_id=STORE
    )


def test_a_different_store_is_a_different_command() -> None:
    assert fingerprint(PAYLOAD, actor_user_id=ACTOR, store_id=uuid.uuid4()) != fingerprint(
        PAYLOAD, actor_user_id=ACTOR, store_id=STORE
    )


def test_a_missing_store_is_handled() -> None:
    assert fingerprint(PAYLOAD, actor_user_id=ACTOR, store_id=None)


def test_the_fingerprint_is_a_sha256_hex_digest() -> None:
    value = fingerprint(PAYLOAD, actor_user_id=ACTOR, store_id=STORE)

    assert len(value) == 64
    assert all(c in "0123456789abcdef" for c in value)


def test_a_way_of_paying_changes_the_print_only_when_one_is_stated() -> None:
    """A command a phone kept from before the way was asked prints as it
    always did; one that states a way is another command, and so is one that
    states another way (ADR-0012, B13)."""
    before = fingerprint(PAYLOAD, actor_user_id=ACTOR, store_id=STORE)

    def with_way(way: PaymentMethod | None) -> str:
        return fingerprint(PAYLOAD | print_of(way), actor_user_id=ACTOR, store_id=STORE)

    assert with_way(None) == before
    assert with_way(PaymentMethod.CASH) != before
    assert with_way(PaymentMethod.CASH) != with_way(PaymentMethod.CARD)
