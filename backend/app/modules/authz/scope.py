"""Request scope — the authority of the current request.

Pure logic, no database. It is built once per request from the authenticated
session and the user's memberships, and every authorization decision reads it.

Invariant I12/I13: a store id supplied by the client is *data to validate*
against this scope, never proof of access.

A store that does not trade — blocked or archived — is read and never changed
(owner decisions, 2026-10-01). Only someone whose role covers the whole
network reads it, and only in a request that reads (`reading`). Its own
people's grants give nothing there while it does not trade; they learn only
that it is blocked or archived.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field

from app.core.errors import ForbiddenStoreError, PermissionDeniedError, StoreNotTradingError
from app.modules.authz.permissions import Permission


@dataclass(frozen=True, slots=True)
class RequestScope:
    user_id: uuid.UUID
    organization_id: uuid.UUID
    # Permissions granted organization-wide (membership with store_id IS NULL).
    org_permissions: frozenset[Permission] = field(default_factory=frozenset)
    # Permissions granted for one specific store. Trading stores only.
    store_permissions: Mapping[uuid.UUID, frozenset[Permission]] = field(default_factory=dict)
    # Every store this person is linked to that does not trade, with its state
    # ("BLOCKED" or "ARCHIVED"): through a membership of its own, or through
    # a role that covers the whole network.
    closed_stores: Mapping[uuid.UUID, str] = field(default_factory=dict)
    # Those of them this person may read: every one, for the network's owner
    # and managers (`resolve_scope`); none for anyone else.
    readable_closed_stores: frozenset[uuid.UUID] = field(default_factory=frozenset)
    # Whether this request only reads. Nothing else is done in a store that
    # does not trade.
    reading: bool = False

    @property
    def store_ids(self) -> frozenset[uuid.UUID]:
        """The trading stores this person may act in."""
        return frozenset(self.store_permissions)

    def permissions_for(self, store_id: uuid.UUID | None) -> frozenset[Permission]:
        """Effective permissions, optionally within one store.

        An organization-wide membership applies in every store, so the store's
        effective set is the union of both. In a store that does not trade it
        applies only to a read, and the store's own grants not at all.
        """
        if store_id is None:
            return self.org_permissions
        if store_id in self.closed_stores:
            if self.reading and store_id in self.readable_closed_stores:
                return self.org_permissions
            return frozenset()
        return self.org_permissions | self.store_permissions.get(store_id, frozenset())

    def can(self, permission: Permission, store_id: uuid.UUID | None = None) -> bool:
        return permission in self.permissions_for(store_id)

    def require_store(self, store_id: uuid.UUID) -> None:
        """Reject a store the user has no membership for, or one that does
        not trade, unless this only reads it and it is readable to this person.

        Organization-wide membership grants store access implicitly, but only
        to stores that were loaded into this scope.
        """
        state = self.closed_stores.get(store_id)
        if state is not None:
            if self.reading and store_id in self.readable_closed_stores:
                return
            raise StoreNotTradingError(store_id=str(store_id), state=state)
        if store_id not in self.store_permissions:
            raise ForbiddenStoreError(store_id=str(store_id))

    def require(self, permission: Permission, store_id: uuid.UUID | None = None) -> None:
        """The authorization decision point.

        Called at the command boundary, which for every endpoint here is the
        router — before the idempotency key is claimed, and before a stored
        response is replayed, so that a revoked grant cannot keep returning a
        success it was once entitled to — but for a return, a debt payment
        and a write-off answered to whoever made them (`refunds.own_refund`,
        `credit.service._own`; owner decisions, 2026-10-18 and 2026-10-21). What
        matters is not which file holds the call but that the decision is made
        from this scope, which is rebuilt from the database on every request,
        and never from anything the client sent (invariants I12 and I13).
        """
        if store_id is not None:
            self.require_store(store_id)
        if permission not in self.permissions_for(store_id):
            raise PermissionDeniedError(
                f"Missing permission {permission.value}",
                permission=permission.value,
                store_id=str(store_id) if store_id else None,
            )


__all__ = ["RequestScope"]
