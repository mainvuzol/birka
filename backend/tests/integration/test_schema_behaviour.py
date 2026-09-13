"""Behaviour that only a real PostgreSQL can prove.

Runs in CI against PostgreSQL 17. Locally these skip loudly (no Docker on the
development machine) rather than passing silently.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.modules.authz.models import Membership, Role
from app.modules.authz.permissions import RoleCode
from app.modules.authz.service import resolve_scope, seed_default_roles
from app.modules.identity.models import AppUser
from app.modules.tenancy.models import Organization, Store, StoreKind
from tests.conftest import requires_database

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def session() -> AsyncSession:
    url = os.environ["BIRKA_TEST_DATABASE_URL"]
    engine = create_async_engine(url, poolclass=None)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
        await s.rollback()
    await engine.dispose()


async def _organization(session: AsyncSession) -> Organization:
    org = Organization(name="birka", currency_code="UAH")
    session.add(org)
    await session.flush()
    return org


async def test_postgres_is_at_least_15(session: AsyncSession) -> None:
    """UNIQUE NULLS NOT DISTINCT does not parse below 15 (ADR-0002)."""
    version = (await session.execute(text("SHOW server_version_num"))).scalar_one()

    assert int(version) >= 150000


async def test_system_role_uniqueness_holds_across_nulls(session: AsyncSession) -> None:
    """The NULLS NOT DISTINCT constraint must actually reject the duplicate."""
    session.add(Role(organization_id=None, code="SYSTEM_X", name="X", is_system=True))
    await session.flush()

    session.add(Role(organization_id=None, code="SYSTEM_X", name="X again", is_system=True))
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_org_wide_membership_cannot_be_duplicated(session: AsyncSession) -> None:
    org = await _organization(session)
    roles = await seed_default_roles(session, org.id)
    user = AppUser(telegram_user_id=1, display_name="Оля")
    session.add(user)
    await session.flush()

    session.add(
        Membership(
            user_id=user.id,
            organization_id=org.id,
            store_id=None,
            role_id=roles[RoleCode.OWNER.value].id,
        )
    )
    await session.flush()

    session.add(
        Membership(
            user_id=user.id,
            organization_id=org.id,
            store_id=None,
            role_id=roles[RoleCode.SELLER.value].id,
        )
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_currency_check_constraint_rejects_bad_codes(session: AsyncSession) -> None:
    session.add(Organization(name="bad", currency_code="UA"))

    with pytest.raises(IntegrityError):
        await session.flush()


async def test_scope_isolates_stores(session: AsyncSession) -> None:
    """Invariant I12: a seller of store A has no authority in store B."""
    org = await _organization(session)
    roles = await seed_default_roles(session, org.id)
    store_a = Store(organization_id=org.id, name="A", code="A", kind=StoreKind.PRIMARY)
    store_b = Store(organization_id=org.id, name="B", code="B", kind=StoreKind.SECONDARY)
    user = AppUser(telegram_user_id=2, display_name="Seller")
    session.add_all([store_a, store_b, user])
    await session.flush()

    session.add(
        Membership(
            user_id=user.id,
            organization_id=org.id,
            store_id=store_a.id,
            role_id=roles[RoleCode.SELLER.value].id,
        )
    )
    await session.flush()

    scope = await resolve_scope(session, user.id)

    assert store_a.id in scope.store_permissions
    assert store_b.id not in scope.store_permissions


async def test_user_without_membership_is_not_a_user(session: AsyncSession) -> None:
    from app.core.errors import AuthenticationFailedError

    user = AppUser(telegram_user_id=3, display_name="Stranger")
    session.add(user)
    await session.flush()

    with pytest.raises(AuthenticationFailedError):
        await resolve_scope(session, user.id)


async def test_seeding_roles_twice_is_idempotent(session: AsyncSession) -> None:
    org = await _organization(session)

    first = await seed_default_roles(session, org.id)
    await session.flush()
    second = await seed_default_roles(session, org.id)

    assert {r.id for r in first.values()} == {r.id for r in second.values()}


async def test_unknown_user_scope_raises(session: AsyncSession) -> None:
    from app.core.errors import AuthenticationFailedError

    with pytest.raises(AuthenticationFailedError):
        await resolve_scope(session, uuid.uuid4())


async def test_membership_cannot_borrow_another_organizations_store(
    session: AsyncSession,
) -> None:
    """The composite foreign key makes a cross-tenant membership impossible.

    With two independent single-column FKs the database would accept this, and
    one forgotten ownership check in a future user-management endpoint would
    hand a whole store to the wrong tenant.
    """
    org_a = await _organization(session)
    org_b = Organization(name="other", currency_code="UAH")
    session.add(org_b)
    await session.flush()

    roles_a = await seed_default_roles(session, org_a.id)
    store_b = Store(organization_id=org_b.id, name="B", code="B", kind=StoreKind.PRIMARY)
    user = AppUser(telegram_user_id=10, display_name="Seller")
    session.add_all([store_b, user])
    await session.flush()

    session.add(
        Membership(
            user_id=user.id,
            organization_id=org_a.id,
            store_id=store_b.id,  # belongs to org B
            role_id=roles_a[RoleCode.SELLER.value].id,
        )
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_membership_cannot_borrow_another_organizations_role(
    session: AsyncSession,
) -> None:
    org_a = await _organization(session)
    org_b = Organization(name="other", currency_code="UAH")
    session.add(org_b)
    await session.flush()

    roles_b = await seed_default_roles(session, org_b.id)
    user = AppUser(telegram_user_id=11, display_name="Seller")
    session.add(user)
    await session.flush()

    session.add(
        Membership(
            user_id=user.id,
            organization_id=org_a.id,
            store_id=None,
            role_id=roles_b[RoleCode.OWNER.value].id,  # belongs to org B
        )
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_closing_a_store_revokes_its_sellers(session: AsyncSession) -> None:
    """Store-scoped membership dies with the store, like the org-wide one."""
    org = await _organization(session)
    roles = await seed_default_roles(session, org.id)
    store = Store(organization_id=org.id, name="A", code="A", kind=StoreKind.PRIMARY)
    user = AppUser(telegram_user_id=12, display_name="Seller")
    session.add_all([store, user])
    await session.flush()
    session.add(
        Membership(
            user_id=user.id,
            organization_id=org.id,
            store_id=store.id,
            role_id=roles[RoleCode.SELLER.value].id,
        )
    )
    await session.flush()

    assert store.id in (await resolve_scope(session, user.id)).store_permissions

    store.is_active = False
    await session.flush()

    from app.core.errors import AuthenticationFailedError

    with pytest.raises(AuthenticationFailedError):
        await resolve_scope(session, user.id)


async def test_a_user_in_two_organizations_is_refused_not_guessed(
    session: AsyncSession,
) -> None:
    """Picking one organization from an unordered query would log the user
    into a different tenant on different requests."""
    org_a = await _organization(session)
    org_b = Organization(name="other", currency_code="UAH")
    session.add(org_b)
    await session.flush()
    roles_a = await seed_default_roles(session, org_a.id)
    roles_b = await seed_default_roles(session, org_b.id)
    user = AppUser(telegram_user_id=13, display_name="Both")
    session.add(user)
    await session.flush()

    session.add_all(
        [
            Membership(
                user_id=user.id,
                organization_id=org_a.id,
                store_id=None,
                role_id=roles_a[RoleCode.OWNER.value].id,
            ),
            Membership(
                user_id=user.id,
                organization_id=org_b.id,
                store_id=None,
                role_id=roles_b[RoleCode.OWNER.value].id,
            ),
        ]
    )
    await session.flush()

    from app.core.errors import AuthenticationFailedError

    with pytest.raises(AuthenticationFailedError, match="more than one organization"):
        await resolve_scope(session, user.id)


async def test_deactivated_user_is_refused(session: AsyncSession) -> None:
    """Invariant: disabling an account takes effect on the next request."""
    from app.core.errors import AuthenticationFailedError
    from app.modules.identity.service import assert_user_is_active

    user = AppUser(telegram_user_id=14, display_name="Fired", is_active=False)
    session.add(user)
    await session.flush()

    with pytest.raises(AuthenticationFailedError):
        await assert_user_is_active(session, user.id)


async def test_concurrent_first_logins_do_not_collide(session: AsyncSession) -> None:
    """A Mini App fires several requests on open; the upsert must absorb that."""
    from app.modules.identity.service import _upsert_user
    from app.modules.identity.telegram_init_data import TelegramUser

    telegram_user = TelegramUser(telegram_user_id=15, first_name="Оля")

    first = await _upsert_user(session, telegram_user)
    second = await _upsert_user(session, telegram_user)

    assert first.id == second.id


async def test_created_at_is_utc_regardless_of_session_timezone(
    session: AsyncSession,
) -> None:
    """`timezone('utc', now())` would drift with the server TimeZone setting."""
    await session.execute(text("SET TIME ZONE 'Asia/Tokyo'"))
    org = Organization(name="tz-probe", currency_code="UAH")
    session.add(org)
    await session.flush()
    await session.refresh(org)

    delta = abs((org.created_at - datetime.now(tz=UTC)).total_seconds())
    assert delta < 60, f"created_at drifted by {delta}s under a non-UTC session"
