"""Authorization services: scope resolution and default role seeding."""

from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AuthenticationFailedError, NoAccessError
from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.tenancy.models import Store, StoreState


def _coerce(codes: list[str]) -> frozenset[Permission]:
    """Ignore permission codes the current build does not know about.

    A code can survive in the database after a capability is renamed or
    removed. Failing the whole request because of a stale row would lock a user
    out; dropping the unknown code is the safe direction (it only ever removes
    authority).
    """
    known: set[Permission] = set()
    for code in codes:
        try:
            known.add(Permission(code))
        except ValueError:
            continue
    return frozenset(known)


async def resolve_scope(
    session: AsyncSession, user_id: uuid.UUID, *, reading: bool = False
) -> RequestScope:
    """Build the request scope from the user's active memberships.

    Raises `NoAccessError` when the user has no active membership: an
    authenticated Telegram account with no membership is not a user of this
    system.

    `reading` says the request only reads: then, and only then, a role that
    covers the whole network also reads a store that does not trade (owner
    decisions, 2026-10-01).
    """
    stmt = (
        select(
            Membership.organization_id,
            Membership.store_id,
            Store.state,
            RolePermission.permission_code,
        )
        .join(
            Role,
            and_(
                Role.id == Membership.role_id,
                # A membership in organization A must not borrow a role owned by
                # organization B. Shared system templates (NULL) stay allowed.
                or_(
                    Role.organization_id.is_(None),
                    Role.organization_id == Membership.organization_id,
                ),
            ),
        )
        .join(RolePermission, RolePermission.role_id == Role.id)
        .outerjoin(Store, Store.id == Membership.store_id)
        .where(Membership.user_id == user_id, Membership.is_active.is_(True))
    )
    rows = (await session.execute(stmt)).all()
    if not rows:
        raise NoAccessError()

    organization_ids = {row.organization_id for row in rows}
    if len(organization_ids) > 1:
        # Assumption A2 is one organization. Silently picking one of them would
        # depend on row order and would log the user into a different tenant on
        # different requests; refusing is the honest behaviour for a state the
        # system does not support yet.
        raise AuthenticationFailedError("User belongs to more than one organization")

    organization_id: uuid.UUID = organization_ids.pop()
    org_codes: list[str] = []
    per_store: dict[uuid.UUID, list[str]] = defaultdict(list)
    closed: dict[uuid.UUID, str] = {}

    for row in rows:
        if row.store_id is None:
            org_codes.append(row.permission_code)
        elif row.state == StoreState.ACTIVE:
            per_store[row.store_id].append(row.permission_code)
        else:
            # A store-scoped membership grants nothing while its store does
            # not trade. Without this a blocked store would keep granting
            # authority to the sellers assigned to it. They are still told
            # which state it is in.
            closed[row.store_id] = row.state

    store_permissions: dict[uuid.UUID, frozenset[Permission]] = {
        store_id: _coerce(codes) for store_id, codes in per_store.items()
    }

    # An organization-wide membership grants access to every store of that
    # organization, so those stores must appear in the scope for
    # `require_store` to accept them. One that does not trade is read only.
    readable: set[uuid.UUID] = set()
    if org_codes:
        stores = await session.execute(
            select(Store.id, Store.state).where(Store.organization_id == organization_id)
        )
        for store_id, state in stores:
            if state == StoreState.ACTIVE:
                store_permissions.setdefault(store_id, frozenset())
            else:
                closed[store_id] = state
                readable.add(store_id)

    return RequestScope(
        user_id=user_id,
        organization_id=organization_id,
        org_permissions=_coerce(org_codes),
        store_permissions=store_permissions,
        closed_stores=closed,
        readable_closed_stores=frozenset(readable),
        reading=reading,
    )


async def organization_wide_holders(
    session: AsyncSession, permission: Permission
) -> list[uuid.UUID]:
    """Every user holding `permission` through an active organization-wide
    membership, in any organization.

    For news about the server itself, such as its backups, which belong to
    no single store: a grant for one store does not count.
    """
    stmt = (
        select(Membership.user_id)
        .join(
            Role,
            and_(
                Role.id == Membership.role_id,
                or_(
                    Role.organization_id.is_(None),
                    Role.organization_id == Membership.organization_id,
                ),
            ),
        )
        .join(RolePermission, RolePermission.role_id == Role.id)
        .where(
            Membership.is_active.is_(True),
            Membership.store_id.is_(None),
            RolePermission.permission_code == permission.value,
        )
        .distinct()
    )
    return sorted((await session.execute(stmt)).scalars())


async def organization_wide_holders_in(
    session: AsyncSession, organization_id: uuid.UUID, permission: Permission
) -> list[uuid.UUID]:
    """Every user holding `permission` through an active organization-wide
    membership of this one organization.

    For news about one network, such as a difference in one of its drawers,
    which the bot tells the network's owner (owner decisions, 2026-10-04):
    a grant for one store does not count, and nor does another network's
    owner. `organization_wide_holders` is the server-wide counterpart.
    """
    stmt = (
        select(Membership.user_id)
        .join(
            Role,
            and_(
                Role.id == Membership.role_id,
                or_(
                    Role.organization_id.is_(None),
                    Role.organization_id == Membership.organization_id,
                ),
            ),
        )
        .join(RolePermission, RolePermission.role_id == Role.id)
        .where(
            Membership.organization_id == organization_id,
            Membership.is_active.is_(True),
            Membership.store_id.is_(None),
            RolePermission.permission_code == permission.value,
        )
        .distinct()
    )
    return sorted((await session.execute(stmt)).scalars())


async def seed_default_roles(session: AsyncSession, organization_id: uuid.UUID) -> dict[str, Role]:
    """Create OWNER/MANAGER/SELLER for an organization if they do not exist.

    Roles are data, so they can be re-composed later; this only provides the
    least-privilege starting point defined in `permissions.py`.
    """
    existing = {
        role.code: role
        for role in (
            await session.execute(select(Role).where(Role.organization_id == organization_id))
        )
        .scalars()
        .all()
    }

    created: dict[str, Role] = dict(existing)
    for role_code, permissions in DEFAULT_ROLE_PERMISSIONS.items():
        if role_code.value in created:
            continue
        role = Role(
            organization_id=organization_id,
            code=role_code.value,
            name=role_code.value.capitalize(),
            is_system=True,
        )
        session.add(role)
        await session.flush()
        for permission in sorted(permissions):
            session.add(RolePermission(role_id=role.id, permission_code=permission.value))
        created[role_code.value] = role

    return created


__all__ = [
    "RoleCode",
    "organization_wide_holders",
    "organization_wide_holders_in",
    "resolve_scope",
    "seed_default_roles",
]
