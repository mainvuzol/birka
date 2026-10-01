"""A store's name, changed on the server on an owner's word.

The owner decided on 2026-10-01 that the stores carry their real names: given
when the server is set up (`seed_organization --main-name/--second-name`) and
changed later by the technical administrator, on an owner's word, as people
are (`people.py`). It lives beside people for that reason: both are changes
the app itself does not offer, approved by whoever holds `user:manage` where
they apply, and serialized under the same per-organization lock.

Only the name changes. A store's code, kind and history stay as they are.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, PermissionDeniedError, ValidationFailedError
from app.core.text import is_storable
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.identity.people import authorize
from app.modules.tenancy.models import Store

MAX_NAME = 200


def store_name(value: str) -> str:
    """A name as people read it: trimmed, not blank, storable, at most 200."""
    name = value.strip()
    if not name or len(name) > MAX_NAME or not is_storable(name):
        raise ValidationFailedError(f"A store's name is 1 to {MAX_NAME} characters of text")
    return name


async def rename_store(
    session: AsyncSession, *, approved_by: int, store_code: str, name: str
) -> bool:
    """Give a store its name. False when it already has it."""
    scope = await authorize(session, approved_by)
    new = store_name(name)
    store = await session.scalar(
        select(Store).where(
            Store.organization_id == scope.organization_id, Store.code == store_code
        )
    )
    if store is None:
        raise NotFoundError(f"No store has the code {store_code}", store_code=store_code)
    if Permission.USER_MANAGE not in scope.permissions_for(store.id):
        raise PermissionDeniedError(
            f"Only an owner may rename {store.code}",
            permission=Permission.USER_MANAGE.value,
            store_code=store.code,
        )
    if store.name == new:
        return False
    before = store.name
    store.name = new
    await session.flush()
    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="store.renamed",
        entity_type="store",
        entity_id=store.id,
        before={"name": before},
        after={"name": new, "code": store.code},
    )
    return True


__all__ = ["rename_store", "store_name"]
