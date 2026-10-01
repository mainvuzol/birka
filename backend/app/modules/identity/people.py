"""People: who works in which store, and in what role.

The owner answered four questions on 2026-10-01 (business-rules.md,
"people"):

- **A person is added on the server**, by a command the technical
  administrator runs (`scripts.people`), by the number of their Telegram
  account. The app has no section for it.
- **Only an owner decides it.** The network's owner decides in any store; a
  child store's owner only in hers. A manager does not. Every change names the
  owner on whose word it is made. That owner must hold `user:manage` where the
  change applies, and every permission of the role concerned, so nobody gives
  or takes away more than they hold. They are the audit record's actor.
- **A person leaves one store, or is turned off completely**: every store of
  the organization at once. Either way their access ends on their next
  request, and what they did stays under their name.
- **Each seller works from their own Telegram**, so every sale names who made
  it. Nothing here shares an account.

A change is never deleted: a membership is turned off, and turned on again by
the next grant. Changes are rare, so all of one organization's are serialized
under one lock. That is what lets the one guard of our own hold under
concurrency: **nobody may leave the organization without someone who manages
people in every store**, since then no change could ever be approved again.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    AuthenticationFailedError,
    NotFoundError,
    PermissionDeniedError,
    ValidationFailedError,
)
from app.core.logging import get_logger
from app.modules.audit import service as audit
from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.authz.service import resolve_scope
from app.modules.identity.models import AppUser
from app.modules.tenancy.models import Organization, Store

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class Access:
    """One membership: a role in one store, or in every store."""

    store_code: str | None
    role: str
    active: bool


@dataclass(frozen=True, slots=True)
class Person:
    organization: str
    telegram_user_id: int
    display_name: str
    username: str | None
    access: tuple[Access, ...]


_KNOWN = {permission.value: permission for permission in Permission}


def _permissions(codes: Iterable[str]) -> frozenset[Permission]:
    # A code the build no longer knows grants nothing, as in `resolve_scope`.
    return frozenset(_KNOWN[code] for code in codes if code in _KNOWN)


async def _lock(session: AsyncSession, organization_id: uuid.UUID) -> None:
    key = int.from_bytes(
        hashlib.sha256(b"birka:people:" + organization_id.bytes).digest()[:8],
        byteorder="big",
        signed=True,
    )
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


async def _approver(session: AsyncSession, telegram_user_id: int) -> RequestScope:
    refused = PermissionDeniedError(
        "Nobody with this Telegram account may approve changes",
        telegram_user_id=telegram_user_id,
    )
    user = await session.scalar(select(AppUser).where(AppUser.telegram_user_id == telegram_user_id))
    if user is None or not user.is_active:
        raise refused
    try:
        return await resolve_scope(session, user.id)
    except AuthenticationFailedError as exc:
        raise refused from exc


async def authorize(session: AsyncSession, approved_by: int) -> RequestScope:
    """The owner on whose word a change is made, and their authority once the
    organization's changes are serialized — not before, when a change waiting
    for the lock could still be made on the word of an owner it removed."""
    found = await _approver(session, approved_by)
    await _lock(session, found.organization_id)
    scope = await _approver(session, approved_by)
    if scope.organization_id != found.organization_id:
        raise PermissionDeniedError("The approver's organization changed; try again")
    return scope


async def _store(
    session: AsyncSession, organization_id: uuid.UUID, code: str | None
) -> Store | None:
    if code is None:
        return None
    store = await session.scalar(
        select(Store).where(Store.organization_id == organization_id, Store.code == code)
    )
    if store is None:
        raise NotFoundError(f"No store has the code {code}", store_code=code)
    return store


async def _role(
    session: AsyncSession,
    organization_id: uuid.UUID,
    *,
    code: str | None = None,
    role_id: uuid.UUID | None = None,
) -> tuple[Role, frozenset[Permission]]:
    condition = Role.code == code if role_id is None else Role.id == role_id
    role = await session.scalar(
        select(Role).where(Role.organization_id == organization_id, condition)
    )
    if role is None:
        raise NotFoundError(f"This organization has no role {code}", role=code)
    codes = await session.scalars(
        select(RolePermission.permission_code).where(RolePermission.role_id == role.id)
    )
    return role, _permissions(codes)


def _require_authority(
    scope: RequestScope, store: Store | None, permissions: frozenset[Permission]
) -> None:
    """Only an owner, and never more than they hold where it applies."""
    held = scope.permissions_for(store.id if store is not None else None)
    where = store.code if store is not None else "every store"
    if Permission.USER_MANAGE not in held:
        raise PermissionDeniedError(
            f"Only an owner may change who works in {where}",
            permission=Permission.USER_MANAGE.value,
            store_code=store.code if store is not None else None,
        )
    missing = permissions - held
    if missing:
        raise PermissionDeniedError(
            f"Nobody gives or takes away more than they hold in {where}",
            missing=sorted(permission.value for permission in missing),
        )


async def _require_someone_manages(session: AsyncSession, organization_id: uuid.UUID) -> None:
    """Checked after a change to a role in every store, the only kind that can
    take the last such owner away."""
    held = await session.scalar(
        select(Membership.id)
        .join(Role, Role.id == Membership.role_id)
        .join(RolePermission, RolePermission.role_id == Role.id)
        .join(AppUser, AppUser.id == Membership.user_id)
        .where(
            Membership.organization_id == organization_id,
            Membership.store_id.is_(None),
            Membership.is_active.is_(True),
            AppUser.is_active.is_(True),
            RolePermission.permission_code == Permission.USER_MANAGE.value,
        )
        .limit(1)
    )
    if held is None:
        raise ValidationFailedError(
            "This would leave nobody who manages people in every store",
            reason="LAST_OWNER",
        )


async def _person(session: AsyncSession, telegram_user_id: int) -> AppUser:
    user = await session.scalar(select(AppUser).where(AppUser.telegram_user_id == telegram_user_id))
    if user is None:
        raise NotFoundError(
            "Nobody with this Telegram account works here", telegram_user_id=telegram_user_id
        )
    return user


async def _membership(
    session: AsyncSession, *, user_id: uuid.UUID, organization_id: uuid.UUID, store: Store | None
) -> Membership | None:
    membership: Membership | None = await session.scalar(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.organization_id == organization_id,
            Membership.store_id.is_(None) if store is None else Membership.store_id == store.id,
        )
    )
    return membership


def _state(membership: Membership, role: Role, store: Store | None) -> dict[str, object]:
    return {
        "store": store.code if store is not None else None,
        "role": role.code,
        "active": membership.is_active,
    }


async def grant(
    session: AsyncSession,
    *,
    approved_by: int,
    telegram_user_id: int,
    store_code: str | None,
    role_code: str,
    name: str | None = None,
) -> bool:
    """Give a person a role in one store, or in every store.

    False when it was already so. The person need not have opened the app
    yet: they are known by their Telegram number until they do, and Telegram's
    name for them replaces `name` the first time they sign in.
    """
    scope = await authorize(session, approved_by)
    store = await _store(session, scope.organization_id, store_code)
    if store is not None and not store.is_active:
        raise ValidationFailedError(f"Store {store.code} is closed", store_code=store.code)
    role, permissions = await _role(session, scope.organization_id, code=role_code)
    _require_authority(scope, store, permissions)

    user = await session.scalar(select(AppUser).where(AppUser.telegram_user_id == telegram_user_id))
    if user is None:
        user = AppUser(
            telegram_user_id=telegram_user_id,
            display_name=(name or "").strip() or f"Telegram {telegram_user_id}",
        )
        session.add(user)
        await session.flush()
    elsewhere = await session.scalar(
        select(Membership.id).where(
            Membership.user_id == user.id,
            Membership.organization_id != scope.organization_id,
            Membership.is_active.is_(True),
        )
    )
    if elsewhere is not None:
        # One organization per person (assumption A2): `resolve_scope` would
        # refuse every sign-in of theirs.
        raise ValidationFailedError(
            "This person already works for another organization",
            telegram_user_id=telegram_user_id,
        )

    membership = await _membership(
        session, user_id=user.id, organization_id=scope.organization_id, store=store
    )
    before: dict[str, object] | None = None
    if membership is not None:
        old_role, old_permissions = await _role(
            session, scope.organization_id, role_id=membership.role_id
        )
        if membership.is_active and membership.role_id == role.id:
            return False
        before = _state(membership, old_role, store)
        if membership.is_active:
            # A change of role takes the old one away.
            _require_authority(scope, store, old_permissions)
        membership.role_id = role.id
        membership.is_active = True
    else:
        membership = Membership(
            user_id=user.id,
            organization_id=scope.organization_id,
            store_id=store.id if store is not None else None,
            role_id=role.id,
        )
        session.add(membership)
    await session.flush()
    if store is None:
        await _require_someone_manages(session, scope.organization_id)
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="people.granted",
        entity_type="membership",
        entity_id=membership.id,
        before=before,
        after={"telegram_user_id": telegram_user_id, **_state(membership, role, store)},
    )
    logger.info("people.granted", membership_id=str(membership.id), role=role.code)
    return True


async def remove(
    session: AsyncSession, *, approved_by: int, telegram_user_id: int, store_code: str | None
) -> bool:
    """Take a person out of one store, or out of their role in every store.

    False when they were already out of it. A membership they hold elsewhere
    is untouched.
    """
    scope = await authorize(session, approved_by)
    store = await _store(session, scope.organization_id, store_code)
    user = await _person(session, telegram_user_id)
    membership = await _membership(
        session, user_id=user.id, organization_id=scope.organization_id, store=store
    )
    if membership is None:
        raise NotFoundError(
            f"This person has no role in {store.code if store is not None else 'every store'}",
            telegram_user_id=telegram_user_id,
        )
    if not membership.is_active:
        return False
    role, permissions = await _role(session, scope.organization_id, role_id=membership.role_id)
    _require_authority(scope, store, permissions)
    before = _state(membership, role, store)
    membership.is_active = False
    await session.flush()
    if store is None:
        await _require_someone_manages(session, scope.organization_id)
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="people.removed",
        entity_type="membership",
        entity_id=membership.id,
        before=before,
        after={"telegram_user_id": telegram_user_id, **_state(membership, role, store)},
    )
    logger.info("people.removed", membership_id=str(membership.id))
    return True


async def deactivate(session: AsyncSession, *, approved_by: int, telegram_user_id: int) -> int:
    """Turn a person off in every store of the organization at once.

    All or nothing: refused whole if any of it is beyond the approver. Returns
    how many memberships it ended; 0 when they had none left.
    """
    scope = await authorize(session, approved_by)
    user = await _person(session, telegram_user_id)
    memberships = (
        await session.scalars(
            select(Membership).where(
                Membership.user_id == user.id,
                Membership.organization_id == scope.organization_id,
                Membership.is_active.is_(True),
            )
        )
    ).all()
    ended: list[tuple[Membership, Role, Store | None]] = []
    for membership in memberships:
        store = (
            await session.get(Store, membership.store_id)
            if membership.store_id is not None
            else None
        )
        role, permissions = await _role(session, scope.organization_id, role_id=membership.role_id)
        _require_authority(scope, store, permissions)
        ended.append((membership, role, store))
    for membership, _, _ in ended:
        membership.is_active = False
    await session.flush()
    if any(store is None for _, _, store in ended):
        await _require_someone_manages(session, scope.organization_id)
    for membership, role, store in ended:
        await audit.record(
            session,
            organization_id=scope.organization_id,
            actor_user_id=scope.user_id,
            action="people.deactivated",
            entity_type="membership",
            entity_id=membership.id,
            before={**_state(membership, role, store), "active": True},
            after={"telegram_user_id": telegram_user_id, **_state(membership, role, store)},
        )
    logger.info("people.deactivated", user_id=str(user.id), memberships=len(ended))
    return len(ended)


async def people(session: AsyncSession) -> list[Person]:
    """Everyone who works, or once worked, for any organization here."""
    rows = (
        await session.execute(
            select(
                Organization.name,
                AppUser.telegram_user_id,
                AppUser.display_name,
                AppUser.username,
                Store.code,
                Role.code.label("role"),
                Membership.is_active,
            )
            .join(Membership, Membership.organization_id == Organization.id)
            .join(AppUser, AppUser.id == Membership.user_id)
            .join(Role, Role.id == Membership.role_id)
            .outerjoin(Store, Store.id == Membership.store_id)
            .order_by(
                Organization.name,
                AppUser.display_name,
                AppUser.telegram_user_id,
                Store.code.nulls_first(),
            )
        )
    ).all()
    found: dict[tuple[str, int], tuple[Person, list[Access]]] = {}
    for row in rows:
        key = (row.name, row.telegram_user_id)
        if key not in found:
            person = Person(row.name, row.telegram_user_id, row.display_name, row.username, ())
            found[key] = (person, [])
        found[key][1].append(Access(row.code, row.role, row.is_active))
    return [
        Person(p.organization, p.telegram_user_id, p.display_name, p.username, tuple(access))
        for p, access in found.values()
    ]


__all__ = ["Access", "Person", "authorize", "deactivate", "grant", "people", "remove"]
