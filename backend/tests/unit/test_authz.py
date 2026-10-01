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
    # Owner decision, 2026-10-01: whoever takes returns handles «Брак».
    Permission.DAMAGED_HANDLE,
    # Owner decision, 2026-10-01: a seller sells in parts and takes payments.
    Permission.SALE_CREDIT,
}
EXPECTED_MANAGER = EXPECTED_SELLER | {
    Permission.INVENTORY_ADJUST,
    # M1-030. Deliberately not in EXPECTED_SELLER: confirming goods are absent
    # takes stock off a shelf, and the owner's instruction is that no seller
    # holds arbitrary balance correction by default. A manager already holds
    # the unbounded INVENTORY_ADJUST, so this adds no authority there.
    Permission.INVENTORY_REPORT_MISSING_DURING_SALE,
    Permission.TRANSFER_CREATE,
    Permission.TRANSFER_RECEIVE,
    Permission.CATALOG_MERGE,
    # Owner decision, 2026-10-01: the owner and managers set prices.
    Permission.CATALOG_SET_PRICE,
    Permission.SNAPSHOT_IMPORT,
    Permission.REPORT_VIEW_FINANCIAL,
    # Owner decision, 2026-10-01: the owner and managers return goods to a
    # supplier; a seller does not.
    Permission.SUPPLIER_RETURN,
}
EXPECTED_OWNER = EXPECTED_MANAGER | {
    Permission.SNAPSHOT_APPROVE,
    Permission.USER_MANAGE,
    # Owner decision, 2026-09-30: backups are "a section only the owner sees".
    Permission.BACKUP_VIEW,
    # Owner decision, 2026-10-01: the owner writes off a debt, with a reason.
    Permission.CREDIT_WRITE_OFF,
    # Owner decision, 2026-10-01: the owner blocks, archives and reopens a
    # store. Honoured network-wide only.
    Permission.STORE_MANAGE,
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


def test_the_two_in_sale_corrections_are_separate_grants() -> None:
    """M1-030. Holding one direction must not hand over the other: putting
    goods on a shelf and taking them off are different authorities, and the
    seller default carries only the first."""
    seller = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]

    assert Permission.INVENTORY_CORRECT_DURING_SALE in seller
    assert Permission.INVENTORY_REPORT_MISSING_DURING_SALE not in seller
    assert (
        Permission.INVENTORY_REPORT_MISSING_DURING_SALE
        in DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
    )


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


def test_everyone_who_takes_returns_handles_the_damaged_goods() -> None:
    """Owner decision, 2026-10-01: a seller, a manager and the owner alike."""
    for role in RoleCode:
        permissions = DEFAULT_ROLE_PERMISSIONS[role]
        assert Permission.SALE_REFUND in permissions
        assert Permission.DAMAGED_HANDLE in permissions


def test_the_owner_and_managers_set_prices_and_a_seller_does_not() -> None:
    """Owner decision, 2026-10-01 (Q-F): a seller sees the suggested price
    and agrees the final one at the counter, but does not set it."""
    assert Permission.CATALOG_SET_PRICE in DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]
    assert Permission.CATALOG_SET_PRICE in DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
    assert Permission.CATALOG_SET_PRICE not in DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]


def test_a_seller_sells_in_parts_and_only_the_owner_writes_a_debt_off() -> None:
    """Owner decisions, 2026-10-01: "a seller and above" sell in parts and
    take payments; the owner alone writes off what will not be paid."""
    for role in RoleCode:
        assert Permission.SALE_CREDIT in DEFAULT_ROLE_PERMISSIONS[role]
    assert Permission.CREDIT_WRITE_OFF in DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]
    assert Permission.CREDIT_WRITE_OFF not in DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]


def test_only_the_owner_sees_the_backups() -> None:
    """Owner decision, 2026-09-30: the backups section is the owner's alone."""
    assert Permission.BACKUP_VIEW in DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]
    assert Permission.BACKUP_VIEW not in DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
    assert Permission.BACKUP_VIEW not in DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]


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
