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
    # Erase a closed debt's customer at their request (owner decision,
    # 2026-10-09; ADR-0015): network-wide only.
    CREDIT_ERASE_CUSTOMER = "credit:erase_customer"

    # Returning goods to a supplier, cancelling such a return, and keeping
    # the network's list of suppliers (owner decision, 2026-10-01): whoever
    # may already write off or correct stock.
    SUPPLIER_RETURN = "supplier:return"
    # What the store owes its suppliers: recording an invoice, paying it,
    # setting a return off against it, and cancelling any of those recorded
    # by mistake (owner decision, 2026-10-01: the owner and managers, "the
    # same people who return goods"). A seller never sees these debts.
    SUPPLIER_DEBT = "supplier:debt"
    # Writing off what is left of an invoice, with a reason. The owner's.
    SUPPLIER_WRITE_OFF = "supplier:write_off"

    # Blocking a store, archiving one and opening it again (owner decision,
    # 2026-10-01: "the owner, in the app"). Honoured network-wide only: the
    # owner of a child store does not change her own store's state.
    STORE_MANAGE = "store:manage"

    # The day's close (owner decisions, 2026-10-04): counting the store's
    # drawer blind and closing it, and writing the reason for one's own
    # close's difference. The seller on duty does it.
    CASH_CLOSE = "cash:close"
    # Cash taken out of the drawer for expenses or for a supplier's courier:
    # the owner's own example of a seller's expense is «пакети, кур’єр»
    # (ADR-0012, G34). A seller holds it.
    CASH_EXPENSE = "cash:expense"
    # Cash taken out of the drawer of any kind, for the owner included, and
    # cash put in for change (owner decisions, 2026-10-04: the owner and
    # managers record any).
    CASH_TAKE_OUT = "cash:take_out"
    # Correcting the way any sale, payment or return was paid, and recording
    # cash taken out and forgotten against the close it belongs to (owner
    # decisions, 2026-10-04: the owner or a manager fixes a closed day). A
    # seller fixes only their own operations, and only before the close,
    # without it (ADR-0012, B6.2).
    CASH_CORRECT = "cash:correct"


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
        # Owner decisions, 2026-10-04: the seller on duty closes the drawer,
        # and records the cash they take out for expenses.
        Permission.CASH_CLOSE,
        Permission.CASH_EXPENSE,
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
        # Owner decision, 2026-10-01: the owner and managers return goods to
        # a supplier, and keep what the store owes its suppliers.
        Permission.SUPPLIER_RETURN,
        Permission.SUPPLIER_DEBT,
        # Owner decisions, 2026-10-04: the owner and managers record any cash
        # taken out or put in, and correct a way of paying after the close.
        Permission.CASH_TAKE_OUT,
        Permission.CASH_CORRECT,
    }
)

_OWNER: frozenset[Permission] = _MANAGER | frozenset(
    {
        Permission.SNAPSHOT_APPROVE,
        Permission.USER_MANAGE,
        Permission.BACKUP_VIEW,
        # Owner decision, 2026-10-01: the owner writes off a debt, with a reason.
        Permission.CREDIT_WRITE_OFF,
        # Owner decision, 2026-10-09: the owner erases a customer who asks.
        Permission.CREDIT_ERASE_CUSTOMER,
        # Owner decision, 2026-10-01: the owner blocks and archives a store.
        Permission.STORE_MANAGE,
        # Owner decision, 2026-10-01: the owner writes off what a supplier
        # forgave, with a reason.
        Permission.SUPPLIER_WRITE_OFF,
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
