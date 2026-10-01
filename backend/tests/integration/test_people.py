"""People: added on the server, on an owner's word (owner decisions, 2026-10-01).

Every change here is committed, as the server command commits it, so the next
step sees exactly what a person's next request would see.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from scripts.seed_organization import seed_in_session
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.core.errors import (
    NoAccessError,
    NotFoundError,
    PermissionDeniedError,
    ValidationFailedError,
)
from app.modules.audit.models import AuditLog
from app.modules.authz.models import Role, RolePermission
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.service import resolve_scope
from app.modules.identity import people
from app.modules.identity.models import AppUser
from app.modules.identity.service import authenticate_with_init_data
from app.modules.tenancy.models import Store, StoreState
from tests.conftest import TEST_BOT_TOKEN, build_init_data, requires_database

pytestmark = [pytest.mark.integration, requires_database()]

BACKEND = Path(__file__).resolve().parents[2]


def telegram_id() -> int:
    return uuid.uuid4().int % 2**52


class Shop:
    """An organization as the bootstrap leaves it: MAIN, SECOND and an owner."""

    def __init__(self, maker: async_sessionmaker[AsyncSession], owner: int, org_name: str):
        self.maker = maker
        self.owner = owner
        self.org_name = org_name

    async def grant(self, telegram_user_id: int, store: str | None, role: str, **kwargs) -> bool:
        approved_by = kwargs.pop("approved_by", self.owner)
        async with self.maker.begin() as session:
            return await people.grant(
                session,
                approved_by=approved_by,
                telegram_user_id=telegram_user_id,
                store_code=store,
                role_code=role,
                **kwargs,
            )

    async def remove(self, telegram_user_id: int, store: str | None, *, by: int | None = None):
        async with self.maker.begin() as session:
            return await people.remove(
                session,
                approved_by=by or self.owner,
                telegram_user_id=telegram_user_id,
                store_code=store,
            )

    async def deactivate(self, telegram_user_id: int, *, by: int | None = None) -> int:
        async with self.maker.begin() as session:
            return await people.deactivate(
                session, approved_by=by or self.owner, telegram_user_id=telegram_user_id
            )

    async def stores_of(self, telegram_user_id: int) -> dict[str, frozenset[Permission]]:
        """What this person may do where, as their next request would see it."""
        async with self.maker() as session:
            user = await session.scalar(
                select(AppUser).where(AppUser.telegram_user_id == telegram_user_id)
            )
            assert user is not None
            scope = await resolve_scope(session, user.id)
            codes = {
                store.id: store.code
                for store in await session.scalars(
                    select(Store).where(Store.organization_id == scope.organization_id)
                )
            }
            return {
                codes[store_id]: scope.permissions_for(store_id) for store_id in scope.store_ids
            }

    async def audit(self, action: str) -> list[AuditLog]:
        async with self.maker() as session:
            org_id = await self.organization_id(session)
            return list(
                await session.scalars(
                    select(AuditLog)
                    .where(AuditLog.organization_id == org_id, AuditLog.action == action)
                    .order_by(AuditLog.created_at)
                )
            )

    async def organization_id(self, session: AsyncSession) -> uuid.UUID:
        user = await session.scalar(select(AppUser).where(AppUser.telegram_user_id == self.owner))
        assert user is not None
        return (await resolve_scope(session, user.id)).organization_id

    async def user_id(self, telegram_user_id: int) -> uuid.UUID:
        async with self.maker() as session:
            user = await session.scalar(
                select(AppUser).where(AppUser.telegram_user_id == telegram_user_id)
            )
            assert user is not None
            return user.id


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def open_shop(maker: async_sessionmaker[AsyncSession]) -> Shop:
    owner = telegram_id()
    org_name = f"people-{uuid.uuid4()}"
    async with maker.begin() as session:
        await seed_in_session(
            session, telegram_user_id=owner, owner_name="Власниця", org_name=org_name
        )
    return Shop(maker, owner, org_name)


@pytest.fixture
async def shop(maker) -> Shop:
    return await open_shop(maker)


async def sign_in(maker, telegram_user_id: int, first_name: str = "Оля"):
    settings = Settings(telegram_bot_token=TEST_BOT_TOKEN, session_secret="s" * 48, app_env="local")
    async with maker() as session:
        return await authenticate_with_init_data(
            session,
            init_data=build_init_data(user={"id": telegram_user_id, "first_name": first_name}),
            settings=settings,
        )


async def test_an_owner_adds_a_seller_who_then_signs_in(shop: Shop, maker) -> None:
    seller = telegram_id()

    assert await shop.grant(seller, "MAIN", "SELLER", name="Оля з каси")

    # Known by the given name until Telegram's own replaces it.
    assert [p.display_name for p in await _people(maker) if p.telegram_user_id == seller] == [
        "Оля з каси"
    ]
    stores = await shop.stores_of(seller)
    assert stores == {"MAIN": DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]}
    _token, user, scope = await sign_in(maker, seller, first_name="Ольга")
    assert user.display_name == "Ольга"
    assert scope.user_id == user.id
    [entry] = await shop.audit("people.granted")
    assert entry.actor_user_id == await shop.user_id(shop.owner)
    assert entry.before is None
    assert entry.after == {
        "telegram_user_id": seller,
        "store": "MAIN",
        "role": "SELLER",
        "active": True,
    }


async def test_a_telegram_account_without_access_is_told_so(maker) -> None:
    stranger = telegram_id()

    with pytest.raises(NoAccessError) as refused:
        await sign_in(maker, stranger)

    assert refused.value.code == "NO_ACCESS"
    assert refused.value.http_status == 401
    # A refused sign-in writes nothing.
    async with maker() as session:
        assert (
            await session.scalar(select(AppUser).where(AppUser.telegram_user_id == stranger))
            is None
        )


async def test_granting_again_is_already_so_and_a_new_role_replaces_the_old(shop: Shop) -> None:
    seller = telegram_id()
    await shop.grant(seller, "MAIN", "SELLER")

    assert not await shop.grant(seller, "MAIN", "SELLER")
    assert await shop.grant(seller, "MAIN", "MANAGER")

    assert await shop.stores_of(seller) == {"MAIN": DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]}
    entries = await shop.audit("people.granted")
    assert len(entries) == 2
    assert entries[1].before == {"store": "MAIN", "role": "SELLER", "active": True}


async def test_only_an_owner_decides(shop: Shop) -> None:
    manager = telegram_id()
    await shop.grant(manager, None, "MANAGER")

    with pytest.raises(PermissionDeniedError, match="Only an owner"):
        await shop.grant(telegram_id(), "MAIN", "SELLER", approved_by=manager)
    with pytest.raises(PermissionDeniedError, match="may approve"):
        await shop.grant(telegram_id(), "MAIN", "SELLER", approved_by=telegram_id())


async def test_a_child_stores_owner_decides_only_in_hers(shop: Shop) -> None:
    # The owner's own example: a child store's owner who is also a manager of
    # the main store.
    child_owner = telegram_id()
    await shop.grant(child_owner, "SECOND", "OWNER")
    await shop.grant(child_owner, "MAIN", "MANAGER")
    seller = telegram_id()

    assert await shop.grant(seller, "SECOND", "SELLER", approved_by=child_owner)
    with pytest.raises(PermissionDeniedError, match="in MAIN"):
        await shop.grant(seller, "MAIN", "SELLER", approved_by=child_owner)
    with pytest.raises(PermissionDeniedError, match="every store"):
        await shop.grant(seller, None, "SELLER", approved_by=child_owner)
    with pytest.raises(PermissionDeniedError, match="in MAIN"):
        await shop.remove(child_owner, "MAIN", by=child_owner)

    assert await shop.stores_of(seller) == {"SECOND": DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]}


async def test_nobody_gives_or_takes_away_more_than_they_hold(shop: Shop, maker) -> None:
    # A role an owner composed: it manages people, and sells, and no more.
    async with maker.begin() as session:
        org_id = await shop.organization_id(session)
        role = Role(organization_id=org_id, code="DESK", name="Адміністратор каси")
        session.add(role)
        await session.flush()
        for permission in {Permission.USER_MANAGE, *DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]}:
            session.add(RolePermission(role_id=role.id, permission_code=permission.value))
    desk = telegram_id()
    await shop.grant(desk, "SECOND", "DESK")
    manager = telegram_id()
    await shop.grant(manager, "SECOND", "MANAGER")

    assert await shop.grant(telegram_id(), "SECOND", "SELLER", approved_by=desk)
    with pytest.raises(PermissionDeniedError, match="more than they hold") as refused:
        await shop.grant(telegram_id(), "SECOND", "MANAGER", approved_by=desk)
    assert "inventory:adjust" in refused.value.details["missing"]
    # Taking a manager's role away, or replacing it, is beyond them too.
    with pytest.raises(PermissionDeniedError, match="more than they hold"):
        await shop.remove(manager, "SECOND", by=desk)
    with pytest.raises(PermissionDeniedError, match="more than they hold"):
        await shop.grant(manager, "SECOND", "SELLER", approved_by=desk)
    with pytest.raises(PermissionDeniedError, match="more than they hold"):
        await shop.deactivate(manager, by=desk)

    assert await shop.stores_of(manager) == {"SECOND": DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]}


async def test_leaving_one_store_keeps_the_other(shop: Shop) -> None:
    seller = telegram_id()
    await shop.grant(seller, "MAIN", "SELLER")
    await shop.grant(seller, "SECOND", "SELLER")

    assert await shop.remove(seller, "MAIN")
    assert not await shop.remove(seller, "MAIN")

    assert set(await shop.stores_of(seller)) == {"SECOND"}
    [entry] = await shop.audit("people.removed")
    assert entry.before == {"store": "MAIN", "role": "SELLER", "active": True}
    assert entry.after["active"] is False
    with pytest.raises(NotFoundError, match="no role in every store"):
        await shop.remove(seller, None)


async def test_turned_off_everywhere_at_once_and_back_by_the_next_grant(shop: Shop, maker) -> None:
    person = telegram_id()
    await shop.grant(person, "MAIN", "SELLER")
    await shop.grant(person, None, "MANAGER")
    _token, user, _scope = await sign_in(maker, person)

    assert await shop.deactivate(person) == 2
    assert await shop.deactivate(person) == 0

    with pytest.raises(NoAccessError):
        await shop.stores_of(person)
    with pytest.raises(NoAccessError):
        await sign_in(maker, person)
    # What they did stays under their name.
    assert await shop.user_id(person) == user.id
    entries = await shop.audit("people.deactivated")
    assert sorted(e.before["store"] or "" for e in entries) == ["", "MAIN"]
    assert all(e.before["active"] and not e.after["active"] for e in entries)

    assert await shop.grant(person, "MAIN", "SELLER")
    assert set(await shop.stores_of(person)) == {"MAIN"}
    assert (await shop.audit("people.granted"))[-1].before == {
        "store": "MAIN",
        "role": "SELLER",
        "active": False,
    }


async def test_turning_off_is_all_or_nothing(shop: Shop) -> None:
    child_owner = telegram_id()
    await shop.grant(child_owner, "SECOND", "OWNER")
    seller = telegram_id()
    await shop.grant(seller, "SECOND", "SELLER")
    await shop.grant(seller, "MAIN", "SELLER")

    with pytest.raises(PermissionDeniedError, match="in MAIN"):
        await shop.deactivate(seller, by=child_owner)

    assert set(await shop.stores_of(seller)) == {"MAIN", "SECOND"}
    assert await shop.audit("people.deactivated") == []


async def test_the_last_owner_of_every_store_stays(shop: Shop) -> None:
    with pytest.raises(ValidationFailedError, match="nobody who manages") as refused:
        await shop.remove(shop.owner, None)
    assert refused.value.details["reason"] == "LAST_OWNER"
    with pytest.raises(ValidationFailedError, match="nobody who manages"):
        await shop.deactivate(shop.owner)
    with pytest.raises(ValidationFailedError, match="nobody who manages"):
        await shop.grant(shop.owner, None, "MANAGER")
    # A child store's owner does not count: they cannot approve in every store.
    child_owner = telegram_id()
    await shop.grant(child_owner, "SECOND", "OWNER")
    with pytest.raises(ValidationFailedError, match="nobody who manages"):
        await shop.remove(shop.owner, None)

    second = telegram_id()
    await shop.grant(second, None, "OWNER")
    assert await shop.remove(shop.owner, None, by=second)
    with pytest.raises(PermissionDeniedError, match="may approve"):
        await shop.grant(telegram_id(), "MAIN", "SELLER")


async def test_two_owners_removing_each_other_at_once_leave_one(shop: Shop) -> None:
    second = telegram_id()
    await shop.grant(second, None, "OWNER")

    # The first owner removes the second, and has not committed yet.
    async with shop.maker.begin() as first:
        assert await people.remove(
            first, approved_by=shop.owner, telegram_user_id=second, store_code=None
        )
        # Meanwhile the second, still an owner as far as anyone can see,
        # removes the first: it waits for the first change to end.
        meanwhile = asyncio.create_task(shop.remove(shop.owner, None, by=second))
        await asyncio.sleep(0.5)
        assert not meanwhile.done()

    # Then it is no longer made on an owner's word.
    with pytest.raises(PermissionDeniedError, match="may approve"):
        await meanwhile
    assert await _has_access(shop, shop.owner)
    assert not await _has_access(shop, second)


async def test_what_is_refused_names_what_is_wrong(shop: Shop, maker) -> None:
    with pytest.raises(NotFoundError, match="code NOPE"):
        await shop.grant(telegram_id(), "NOPE", "SELLER")
    with pytest.raises(NotFoundError, match="no role CASHIER"):
        await shop.grant(telegram_id(), "MAIN", "CASHIER")
    with pytest.raises(NotFoundError, match="works here"):
        await shop.remove(telegram_id(), "MAIN")
    with pytest.raises(NotFoundError, match="works here"):
        await shop.deactivate(telegram_id())
    # A store that does not trade takes nobody new.
    async with maker.begin() as session:
        org_id = await shop.organization_id(session)
        store = await session.scalar(
            select(Store).where(Store.organization_id == org_id, Store.code == "SECOND")
        )
        assert store is not None
        store.state = StoreState.BLOCKED
    with pytest.raises(ValidationFailedError, match="SECOND is not trading"):
        await shop.grant(telegram_id(), "SECOND", "SELLER")


async def test_one_organization_per_person(shop: Shop, maker) -> None:
    other = await open_shop(maker)
    seller = telegram_id()
    await other.grant(seller, "MAIN", "SELLER")

    with pytest.raises(ValidationFailedError, match="another organization"):
        await shop.grant(seller, "MAIN", "SELLER")
    # Nor does one organization's owner reach into the other.
    with pytest.raises(NotFoundError, match="no role in MAIN"):
        await shop.remove(seller, "MAIN")
    assert set(await other.stores_of(seller)) == {"MAIN"}


def run_people(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 — fixed module, current test interpreter
        [sys.executable, "-m", "scripts.people", *args],
        cwd=BACKEND,
        env={**os.environ, "BIRKA_DATABASE_URL": os.environ["BIRKA_TEST_DATABASE_URL"]},
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


async def test_the_server_command(shop: Shop) -> None:
    seller = telegram_id()
    owner = str(shop.owner)

    added = run_people(
        "grant", "--approved-by", owner, "--telegram-user-id", str(seller),
        "--store", "MAIN", "--role", "seller", "--name", "Оля",
    )  # fmt: skip
    again = run_people(
        "grant", "--approved-by", owner, "--telegram-user-id", str(seller),
        "--store", "MAIN", "--role", "SELLER",
    )  # fmt: skip
    listed = run_people("list")
    refused = run_people(
        "grant", "--approved-by", str(seller), "--telegram-user-id", str(telegram_id()),
        "--all-stores", "--role", "SELLER",
    )  # fmt: skip
    removed = run_people(
        "remove", "--approved-by", owner, "--telegram-user-id", str(seller), "--store", "MAIN"
    )
    turned_off = run_people("deactivate", "--approved-by", owner, "--telegram-user-id", str(seller))

    assert (added.returncode, added.stdout) == (0, f"granted: {seller} is SELLER in MAIN\n")
    assert again.stdout == f"already so: {seller} is SELLER in MAIN\n"
    assert f"{seller}  Оля  [{shop.org_name}]\n    SELLER   MAIN\n" in listed.stdout
    assert refused.returncode == 2
    assert refused.stderr.endswith("refused: Only an owner may change who works in every store\n")
    assert refused.stdout == ""
    assert removed.stdout == f"removed: {seller} from MAIN\n"
    assert turned_off.stdout == f"deactivated: {seller}, 0 role(s) ended\n"
    assert not await _has_access(shop, seller)


async def _people(maker) -> list[people.Person]:
    async with maker() as session:
        return await people.people(session)


async def _has_access(shop: Shop, telegram_user_id: int) -> bool:
    try:
        await shop.stores_of(telegram_user_id)
    except NoAccessError:
        return False
    return True
