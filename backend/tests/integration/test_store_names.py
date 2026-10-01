"""The stores' real names: given at setup, changed on an owner's word
(owner decision, 2026-10-01)."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid

import pytest
from scripts.seed_organization import seed_in_session
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.errors import NotFoundError, PermissionDeniedError, ValidationFailedError
from app.modules.audit.models import AuditLog
from app.modules.identity import people
from app.modules.identity.stores import rename_store
from app.modules.tenancy.models import Organization, Store, StoreKind
from tests.conftest import requires_database
from tests.integration.test_people import BACKEND, telegram_id

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def seeded(maker, **names: str) -> tuple[int, str]:
    owner, org_name = telegram_id(), f"names-{uuid.uuid4()}"
    async with maker.begin() as session:
        await seed_in_session(
            session, telegram_user_id=owner, owner_name="Власниця", org_name=org_name, **names
        )
    return owner, org_name


async def names(maker, org_name: str) -> dict[str, str]:
    async with maker() as session:
        rows = await session.execute(
            select(Store.code, Store.name)
            .join(Organization, Organization.id == Store.organization_id)
            .where(Organization.name == org_name)
        )
        return dict(rows.tuples().all())


async def rename(maker, owner: int, code: str, name: str) -> bool:
    async with maker.begin() as session:
        return await rename_store(session, approved_by=owner, store_code=code, name=name)


async def test_the_seed_gives_the_names_and_keeps_them_on_a_second_run(maker) -> None:
    owner, org_name = await seeded(maker, main_name="Лана", second_name="Лана Мала")

    assert await names(maker, org_name) == {"MAIN": "Лана", "SECOND": "Лана Мала"}
    async with maker.begin() as session:
        await seed_in_session(
            session,
            telegram_user_id=owner,
            owner_name="Власниця",
            org_name=org_name,
            main_name="Інша",
            second_name="Ще інша",
        )
    # A rerun keeps what exists; renaming is its own, recorded step.
    assert await names(maker, org_name) == {"MAIN": "Лана", "SECOND": "Лана Мала"}


async def test_a_store_that_already_exists_keeps_its_name(maker) -> None:
    # A store made before the seed ever ran, with no warehouse yet.
    org_name = f"names-{uuid.uuid4()}"
    async with maker.begin() as session:
        org = Organization(name=org_name, currency_code="UAH")
        session.add(org)
        await session.flush()
        session.add(
            Store(organization_id=org.id, name="Стара назва", code="MAIN", kind=StoreKind.PRIMARY)
        )
    async with maker.begin() as session:
        await seed_in_session(
            session,
            telegram_user_id=telegram_id(),
            owner_name="Власниця",
            org_name=org_name,
            main_name="Лана",
            second_name="Лана Мала",
        )

    assert await names(maker, org_name) == {"MAIN": "Стара назва", "SECOND": "Лана Мала"}


async def test_an_owner_renames_a_store_and_it_is_recorded(maker) -> None:
    owner, org_name = await seeded(maker)

    assert await rename(maker, owner, "MAIN", "  Лана, Хрещатик  ")
    assert not await rename(maker, owner, "MAIN", "Лана, Хрещатик")

    assert (await names(maker, org_name))["MAIN"] == "Лана, Хрещатик"
    async with maker() as session:
        [entry] = (
            await session.scalars(
                select(AuditLog)
                .where(AuditLog.action == "store.renamed")
                .join(Organization, Organization.id == AuditLog.organization_id)
                .where(Organization.name == org_name)
            )
        ).all()
    assert entry.before == {"name": "Основний магазин"}
    assert entry.after == {"name": "Лана, Хрещатик", "code": "MAIN"}
    assert entry.actor_user_id is not None


async def test_only_an_owner_renames_and_a_child_stores_owner_only_hers(maker) -> None:
    owner, org_name = await seeded(maker)
    manager, child_owner = telegram_id(), telegram_id()
    async with maker.begin() as session:
        await people.grant(
            session,
            approved_by=owner,
            telegram_user_id=manager,
            store_code=None,
            role_code="MANAGER",
        )
    async with maker.begin() as session:
        await people.grant(
            session,
            approved_by=owner,
            telegram_user_id=child_owner,
            store_code="SECOND",
            role_code="OWNER",
        )

    with pytest.raises(PermissionDeniedError, match="Only an owner may rename MAIN"):
        await rename(maker, manager, "MAIN", "Лана")
    with pytest.raises(PermissionDeniedError, match="Only an owner may rename MAIN"):
        await rename(maker, child_owner, "MAIN", "Лана")
    assert await rename(maker, child_owner, "SECOND", "Лана Мала")
    assert await names(maker, org_name) == {"MAIN": "Основний магазин", "SECOND": "Лана Мала"}


async def test_a_name_is_text_and_the_store_must_exist(maker) -> None:
    owner, _ = await seeded(maker)

    for bad in ("   ", "Л" * 201, "Лана\x00"):
        with pytest.raises(ValidationFailedError, match="1 to 200 characters"):
            await rename(maker, owner, "MAIN", bad)
    with pytest.raises(NotFoundError, match="code NOPE"):
        await rename(maker, owner, "NOPE", "Лана")


def run(module: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 — fixed module, current test interpreter
        [sys.executable, "-m", module, *args],
        cwd=BACKEND,
        env={**os.environ, "BIRKA_DATABASE_URL": os.environ["BIRKA_TEST_DATABASE_URL"]},
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


async def test_the_server_commands(maker) -> None:
    owner = telegram_id()
    org_name = f"names-{uuid.uuid4()}"

    seeded_ = run(
        "scripts.seed_organization", "--telegram-user-id", str(owner), "--org-name", org_name,
        "--main-name", "Лана", "--second-name", "Лана Мала",
    )  # fmt: skip
    blank = run(
        "scripts.seed_organization", "--telegram-user-id", str(telegram_id()),
        "--org-name", f"names-{uuid.uuid4()}", "--main-name", " ",
    )  # fmt: skip
    renamed = run(
        "scripts.stores", "rename", "--approved-by", str(owner), "--store", "SECOND",
        "--name", "Лана, Подол",
    )  # fmt: skip
    listed = run("scripts.stores", "list")
    refused = run(
        "scripts.stores", "rename", "--approved-by", str(telegram_id()), "--store", "MAIN",
        "--name", "Чужа",
    )  # fmt: skip

    assert seeded_.returncode == 0, seeded_.stderr
    assert blank.returncode == 2
    assert "1 to 200 characters" in blank.stderr
    assert renamed.stdout == "renamed: SECOND is «Лана, Подол»\n"
    assert f"MAIN     Лана  [{org_name}]\nSECOND   Лана, Подол  [{org_name}]\n" in listed.stdout
    assert refused.returncode == 2
    assert refused.stderr.endswith(
        "refused: Nobody with this Telegram account may approve changes\n"
    )
    assert await names(maker, org_name) == {"MAIN": "Лана", "SECOND": "Лана, Подол"}
