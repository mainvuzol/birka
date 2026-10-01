"""A store that does not trade, as the request scope sees it (owner
decisions, 2026-10-01): read by a role that covers the whole network, in a
request that only reads, and changed by nobody. Its own people's grants count
for nothing there; they are told its state."""

from __future__ import annotations

import uuid

import pytest

from app.core.errors import ForbiddenStoreError, StoreNotTradingError
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope

CLOSED = uuid.uuid4()
OPEN = uuid.uuid4()
NETWORK = frozenset({Permission.SALE_VIEW, Permission.SALE_CREATE})


def network_role(*, reading: bool) -> RequestScope:
    return RequestScope(
        user_id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        org_permissions=NETWORK,
        store_permissions={OPEN: frozenset()},
        closed_stores={CLOSED: "BLOCKED"},
        readable_closed_stores=frozenset({CLOSED}),
        reading=reading,
    )


def test_a_network_role_reads_a_closed_store() -> None:
    reader = network_role(reading=True)
    assert reader.permissions_for(CLOSED) == NETWORK
    assert reader.can(Permission.SALE_VIEW, CLOSED)
    reader.require(Permission.SALE_VIEW, CLOSED)


def test_nothing_is_changed_in_a_closed_store_whoever_asks() -> None:
    writer = network_role(reading=False)
    assert writer.permissions_for(CLOSED) == frozenset()
    assert not writer.can(Permission.SALE_CREATE, CLOSED)
    with pytest.raises(StoreNotTradingError) as refused:
        writer.require(Permission.SALE_CREATE, CLOSED)
    assert refused.value.details == {"store_id": str(CLOSED), "state": "BLOCKED"}
    # The stores that trade are as they were.
    assert writer.permissions_for(OPEN) == NETWORK
    writer.require(Permission.SALE_CREATE, OPEN)


def test_its_own_people_are_told_the_state_and_read_nothing() -> None:
    member = RequestScope(
        user_id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        closed_stores={CLOSED: "ARCHIVED"},
        reading=True,
    )
    assert member.store_ids == frozenset()
    assert member.permissions_for(CLOSED) == frozenset()
    with pytest.raises(StoreNotTradingError) as refused:
        member.require(Permission.SALE_VIEW, CLOSED)
    assert refused.value.details["state"] == "ARCHIVED"
    # A store they were never linked to stays nobody's business.
    with pytest.raises(ForbiddenStoreError):
        member.require(Permission.SALE_VIEW, uuid.uuid4())
