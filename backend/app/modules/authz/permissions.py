"""Capability catalogue.

Permissions are codes in application code, not rows in a table: the set of
capabilities ships with the deployed artifact and must not drift between
environments. Roles (which are data) map to these codes.

Adding a privileged capability means adding it here *and* adding a negative
test that proves an unprivileged role is refused (`rbac-permission-designer`).
"""

from __future__ import annotations

from enum import StrEnum


class Permission(StrEnum):
    SALE_CREATE = "sale:create"
    SALE_REFUND = "sale:refund"
    SALE_VIEW = "sale:view"

    INVENTORY_VIEW = "inventory:view"
    INVENTORY_RECEIVE = "inventory:receive"
    INVENTORY_ADJUST = "inventory:adjust"
    # Narrow capability: correct the *exact* shortfall while completing a sale
    # (business fact F30). It is deliberately separate from INVENTORY_ADJUST,
    # which allows arbitrary stock changes and stays with manager/owner.
    INVENTORY_CORRECT_DURING_SALE = "inventory:correct_during_sale"

    TRANSFER_CREATE = "transfer:create"
    TRANSFER_RECEIVE = "transfer:receive"

    CATALOG_CREATE = "catalog:create"
    CATALOG_CONFIRM = "catalog:confirm"
    CATALOG_MERGE = "catalog:merge"

    SNAPSHOT_IMPORT = "snapshot:import"
    SNAPSHOT_APPROVE = "snapshot:approve"

    REPORT_VIEW_FINANCIAL = "report:view_financial"
    USER_MANAGE = "user:manage"


class RoleCode(StrEnum):
    OWNER = "OWNER"
    MANAGER = "MANAGER"
    SELLER = "SELLER"


# ---------------------------------------------------------------------------
# Default role → permission matrix.
#
# These are *defaults seeded for a new organization*, not hard-coded authority:
# roles are rows, and an owner may re-compose them later. Open question Q4 (how
# many sellers, whether they may act across stores) may refine SELLER; until it
# is answered the defaults stay least-privilege in everything that moves money
# or rewrites stock arbitrarily.
# ---------------------------------------------------------------------------

_SELLER: frozenset[Permission] = frozenset(
    {
        Permission.SALE_CREATE,
        Permission.SALE_VIEW,
        # Returns are a frequent counter operation for this business, so a
        # seller can take one. Revisit under Q4 if the owner wants refunds
        # restricted to a manager.
        Permission.SALE_REFUND,
        Permission.INVENTORY_VIEW,
        Permission.INVENTORY_RECEIVE,
        Permission.INVENTORY_CORRECT_DURING_SALE,
        Permission.CATALOG_CREATE,
        Permission.CATALOG_CONFIRM,
    }
)

_MANAGER: frozenset[Permission] = _SELLER | frozenset(
    {
        Permission.INVENTORY_ADJUST,
        Permission.TRANSFER_CREATE,
        Permission.TRANSFER_RECEIVE,
        Permission.CATALOG_MERGE,
        Permission.SNAPSHOT_IMPORT,
        Permission.REPORT_VIEW_FINANCIAL,
    }
)

_OWNER: frozenset[Permission] = _MANAGER | frozenset(
    {
        Permission.SNAPSHOT_APPROVE,
        Permission.USER_MANAGE,
    }
)

DEFAULT_ROLE_PERMISSIONS: dict[RoleCode, frozenset[Permission]] = {
    RoleCode.SELLER: _SELLER,
    RoleCode.MANAGER: _MANAGER,
    RoleCode.OWNER: _OWNER,
}

ALL_PERMISSIONS: frozenset[Permission] = frozenset(Permission)

__all__ = [
    "ALL_PERMISSIONS",
    "DEFAULT_ROLE_PERMISSIONS",
    "Permission",
    "RoleCode",
]
