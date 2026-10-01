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
    # The mirror of the above, and separate from it on purpose: confirming
    # goods are *absent* removes stock, so holding one direction must not
    # hand over the other. Also separate from INVENTORY_ADJUST, which is
    # unbounded. Not in the seller default — the owner's instruction is that
    # no seller gets the run of the balances without being given it.
    INVENTORY_REPORT_MISSING_DURING_SALE = "inventory:report_missing_during_sale"

    # The store's «Брак»: take a unit returned damaged for inspection, put it
    # back on sale in the warehouse it was sold from, confirm it damaged, or
    # write it off. The owner gave all of it to anyone who takes returns
    # (2026-10-01): a seller, a manager, the owner. Separate from
    # `inventory:adjust` and `transfer:create`, which stay with managers: this
    # moves only units a return put in «Брак», and only where it says.
    DAMAGED_HANDLE = "damaged:handle"

    TRANSFER_CREATE = "transfer:create"
    TRANSFER_RECEIVE = "transfer:receive"

    CATALOG_CREATE = "catalog:create"
    CATALOG_CONFIRM = "catalog:confirm"
    CATALOG_MERGE = "catalog:merge"
    # The suggested selling price the till prefills (owner decision,
    # 2026-10-01: the owner and managers set it, a seller sees it). Held
    # organization-wide it sets the shared price; held in a store, that
    # store's own.
    CATALOG_SET_PRICE = "catalog:set_price"

    SNAPSHOT_IMPORT = "snapshot:import"
    SNAPSHOT_APPROVE = "snapshot:approve"

    REPORT_VIEW_FINANCIAL = "report:view_financial"
    USER_MANAGE = "user:manage"

    # The server's backups: whether last night's copy was made and proven,
    # and the Telegram message when it was not (owner decision, 2026-09-30:
    # "a section only the owner sees"). Honoured organization-wide only — a
    # backup is of the whole server, not of one store.
    BACKUP_VIEW = "backup:view"

    # A sale paid in parts (owner decision, 2026-10-01): selling that way,
    # taking a later payment in the store that sold, and seeing the store's
    # debts with the customers' names and phones. A seller holds it.
    SALE_CREDIT = "sale:credit"
    # Writing off what a customer will not pay, with a reason. The owner's.
    CREDIT_WRITE_OFF = "credit:write_off"


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
        # Owner decision, 2026-10-01: whoever takes returns handles «Брак».
        Permission.DAMAGED_HANDLE,
        # Owner decision, 2026-10-01: a seller sells in parts and takes payments.
        Permission.SALE_CREDIT,
    }
)

_MANAGER: frozenset[Permission] = _SELLER | frozenset(
    {
        Permission.INVENTORY_ADJUST,
        # A manager already holds the unbounded INVENTORY_ADJUST, so the
        # bounded shortage report adds no authority. Whether a *seller* gets
        # it is a role edit for the owner, not a default.
        Permission.INVENTORY_REPORT_MISSING_DURING_SALE,
        Permission.TRANSFER_CREATE,
        Permission.TRANSFER_RECEIVE,
        Permission.CATALOG_MERGE,
        # Owner decision, 2026-10-01: the owner and managers set prices.
        Permission.CATALOG_SET_PRICE,
        Permission.SNAPSHOT_IMPORT,
        Permission.REPORT_VIEW_FINANCIAL,
    }
)

_OWNER: frozenset[Permission] = _MANAGER | frozenset(
    {
        Permission.SNAPSHOT_APPROVE,
        Permission.USER_MANAGE,
        Permission.BACKUP_VIEW,
        # Owner decision, 2026-10-01: the owner writes off a debt, with a reason.
        Permission.CREDIT_WRITE_OFF,
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
