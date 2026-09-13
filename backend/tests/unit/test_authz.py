"""Permission catalogue and request scope.

Invariants I12 (store boundaries) and I13 (server-side authorization) are
service-enforced, so the negative tests here are their proof.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.errors import ForbiddenStoreError, PermissionDeniedError
from app.modules.authz.permissions import (
    ALL_PERMISSIONS,
    DEFAULT_ROLE_PERMISSIONS,
    Permission,
    RoleCode,
)
from app.modules.authz.scope import RequestScope

STORE_A = uuid.uuid4()
STORE_B = uuid.uuid4()


def _scope(
    *,
    org: frozenset[Permission] = frozenset(),
    stores: dict[uuid.UUID, frozenset[Permission]] | None = None,
) -> RequestScope:
    return RequestScope(
        user_id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        org_permissions=org,
        store_permissions=stores if stores is not None else {},
    )


# --- permission catalogue --------------------------------------------------


# The expected matrix is spelled out rather than derived, so that widening a
# role is a visible, deliberate diff in this file. A test that computes the
# answer the same way the code does cannot fail.
EXPECTED_SELLER = {
    Permission.SALE_CREATE,
    Permission.SALE_REFUND,
    Permission.SALE_VIEW,
    Permission.INVENTORY_VIEW,
    Permission.INVENTORY_RECEIVE,
    Permission.INVENTORY_CORRECT_DURING_SALE,
    Permission.CATALOG_CREATE,
    Permission.CATALOG_CONFIRM,
}
EXPECTED_MANAGER = EXPECTED_SELLER | {
    Permission.INVENTORY_ADJUST,
    Permission.TRANSFER_CREATE,
    Permission.TRANSFER_RECEIVE,
    Permission.CATALOG_MERGE,
    Permission.SNAPSHOT_IMPORT,
    Permission.REPORT_VIEW_FINANCIAL,
}
EXPECTED_OWNER = EXPECTED_MANAGER | {
    Permission.SNAPSHOT_APPROVE,
    Permission.USER_MANAGE,
}


def test_every_role_covers_the_whole_role_catalogue() -> None:
    assert set(DEFAULT_ROLE_PERMISSIONS) == set(RoleCode)


def test_role_matrix_matches_the_declared_expectation() -> None:
    """Any change to who can do what must be made here too, on purpose."""
    assert DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER] == EXPECTED_SELLER
    assert DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER] == EXPECTED_MANAGER
    assert DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER] == EXPECTED_OWNER


def test_roles_are_strictly_increasing() -> None:
    seller = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
    manager = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
    owner = DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]

    assert seller < manager < owner


def test_seller_cannot_adjust_inventory_arbitrarily() -> None:
    """Business fact F30: arbitrary adjustment stays with manager/owner."""
    seller = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]

    assert Permission.INVENTORY_ADJUST not in seller
    assert Permission.INVENTORY_CORRECT_DURING_SALE in seller


def test_seller_cannot_merge_catalog_or_approve_snapshots() -> None:
    seller = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]

    assert Permission.CATALOG_MERGE not in seller
    assert Permission.SNAPSHOT_APPROVE not in seller
    assert Permission.USER_MANAGE not in seller


def test_only_owner_approves_snapshots_and_manages_users() -> None:
    manager = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
    owner = DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]

    assert Permission.SNAPSHOT_APPROVE not in manager
    assert Permission.SNAPSHOT_APPROVE in owner
    assert Permission.USER_MANAGE in owner


# --- scope -----------------------------------------------------------------


def test_store_permission_grants_access_in_that_store() -> None:
    scope = _scope(stores={STORE_A: frozenset({Permission.SALE_CREATE})})

    scope.require(Permission.SALE_CREATE, STORE_A)

    assert scope.can(Permission.SALE_CREATE, STORE_A)


def test_store_permission_does_not_leak_into_another_store() -> None:
    scope = _scope(
        stores={STORE_A: frozenset({Permission.SALE_CREATE}), STORE_B: frozenset()},
    )

    with pytest.raises(PermissionDeniedError):
        scope.require(Permission.SALE_CREATE, STORE_B)


def test_unknown_store_is_refused_before_permissions_are_considered() -> None:
    """A store the user has no membership for is not merely 'not permitted'."""
    scope = _scope(stores={STORE_A: frozenset({Permission.SALE_CREATE})})

    with pytest.raises(ForbiddenStoreError):
        scope.require(Permission.SALE_CREATE, STORE_B)


def test_org_wide_permission_applies_in_every_loaded_store() -> None:
    scope = _scope(
        org=frozenset({Permission.INVENTORY_VIEW}),
        stores={STORE_A: frozenset(), STORE_B: frozenset()},
    )

    scope.require(Permission.INVENTORY_VIEW, STORE_A)
    scope.require(Permission.INVENTORY_VIEW, STORE_B)


def test_store_and_org_permissions_are_unioned() -> None:
    scope = _scope(
        org=frozenset({Permission.INVENTORY_VIEW}),
        stores={STORE_A: frozenset({Permission.SALE_CREATE})},
    )

    assert scope.permissions_for(STORE_A) == {
        Permission.INVENTORY_VIEW,
        Permission.SALE_CREATE,
    }


def test_empty_scope_denies_everything() -> None:
    scope = _scope()

    for permission in ALL_PERMISSIONS:
        assert not scope.can(permission)
        with pytest.raises(PermissionDeniedError):
            scope.require(permission)


def test_denied_error_names_the_permission_but_not_the_user() -> None:
    scope = _scope(stores={STORE_A: frozenset()})

    with pytest.raises(PermissionDeniedError) as exc:
        scope.require(Permission.CATALOG_MERGE, STORE_A)

    assert exc.value.details["permission"] == Permission.CATALOG_MERGE.value
    assert str(scope.user_id) not in str(exc.value)


def test_scope_is_immutable() -> None:
    scope = _scope(org=frozenset({Permission.SALE_VIEW}))

    with pytest.raises((AttributeError, TypeError)):
        scope.org_permissions = frozenset()  # type: ignore[misc]


@pytest.mark.parametrize("role", [RoleCode.SELLER, RoleCode.MANAGER])
def test_no_role_below_owner_holds_every_capability(role: RoleCode) -> None:
    assert DEFAULT_ROLE_PERMISSIONS[role] < ALL_PERMISSIONS


def test_a_new_permission_is_not_silently_granted_to_anyone() -> None:
    """A capability added to the enum must be assigned deliberately.

    If this fails, someone added a Permission member without deciding which
    roles get it — decide here, do not just widen EXPECTED_OWNER.
    """
    unassigned = ALL_PERMISSIONS - EXPECTED_OWNER
    assert not unassigned, f"permissions with no role decision: {sorted(unassigned)}"
