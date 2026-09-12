"""Request scope — the authority of the current request.

Pure logic, no database. It is built once per request from the authenticated
session and the user's memberships, and every authorization decision reads it.

Invariant I12/I13: a store id supplied by the client is *data to validate*
against this scope, never proof of access.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field

from app.core.errors import ForbiddenStoreError, PermissionDeniedError
from app.modules.authz.permissions import Permission


@dataclass(frozen=True, slots=True)
class RequestScope:
    user_id: uuid.UUID
    organization_id: uuid.UUID
    # Permissions granted organization-wide (membership with store_id IS NULL).
    org_permissions: frozenset[Permission] = field(default_factory=frozenset)
    # Permissions granted for one specific store.
    store_permissions: Mapping[uuid.UUID, frozenset[Permission]] = field(default_factory=dict)

    @property
    def store_ids(self) -> frozenset[uuid.UUID]:
        return frozenset(self.store_permissions)

    def permissions_for(self, store_id: uuid.UUID | None) -> frozenset[Permission]:
        """Effective permissions, optionally within one store.

        An organization-wide membership applies in every store, so the store's
        effective set is the union of both.
        """
        if store_id is None:
            return self.org_permissions
        return self.org_permissions | self.store_permissions.get(store_id, frozenset())

    def can(self, permission: Permission, store_id: uuid.UUID | None = None) -> bool:
        return permission in self.permissions_for(store_id)

    def require_store(self, store_id: uuid.UUID) -> None:
        """Reject a store the user has no membership for.

        Organization-wide membership grants store access implicitly, but only
        to stores that were loaded into this scope.
        """
        if store_id not in self.store_permissions:
            raise ForbiddenStoreError(store_id=str(store_id))

    def require(self, permission: Permission, store_id: uuid.UUID | None = None) -> None:
        """The authorization decision point. Services call this; routers do not."""
        if store_id is not None:
            self.require_store(store_id)
        if permission not in self.permissions_for(store_id):
            raise PermissionDeniedError(
                f"Missing permission {permission.value}",
                permission=permission.value,
                store_id=str(store_id) if store_id else None,
            )


__all__ = ["RequestScope"]
