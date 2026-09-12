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


def test_every_role_grants_only_known_permissions() -> None:
    for role, permissions in DEFAULT_ROLE_PERMISSIONS.items():
        unknown = permissions - ALL_PERMISSIONS
        assert not unknown, f"{role} grants unknown permissions: {unknown}"


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


@pytest.mark.parametrize("role", list(RoleCode))
def test_no_role_can_do_everything_by_accident(role: RoleCode) -> None:
    """Only OWNER should hold the full capability set."""
    permissions = DEFAULT_ROLE_PERMISSIONS[role]
    if role is RoleCode.OWNER:
        assert permissions == ALL_PERMISSIONS
    else:
        assert permissions != ALL_PERMISSIONS
