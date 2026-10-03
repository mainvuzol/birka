"""Expired idempotency records are deleted (`app/core/idempotency.py
purge_expired`), on real PostgreSQL.

The records are a 7-day cache of answers, not the guarantee: every command
keeps its answer on its business row under its permanent `command_id`
(invariant I20). So a retry after its record was purged is still answered
with what was done, once, as the tests that delete records by hand show for
each command; here the purge itself does it, for a sale and for a catalogue
correction (a rename), retried under the very same Idempotency-Key.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.core.idempotency import (
    RETENTION,
    IdempotencyRecord,
    IdempotencyStatus,
    purge_expired,
)
from app.modules.sales.models import Sale
from app.modules.tenancy.models import Organization
from tests.conftest import requires_database
from tests.integration.test_catalog_rename import (
    audits,
    corrections,
    manager,
    model,
    rename,
    rename_body,
)
from tests.integration.test_sale_command import make_shop
from tests.integration.test_sale_regressions import api_sale, payload_for
from tests.integration.test_shared_warehouse import make_two_shops

pytestmark = [pytest.mark.integration, requires_database()]

# Past every record this run writes: they expire 7 days after they are made.
LATER = timedelta(days=1)


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def organization(session: AsyncSession) -> uuid.UUID:
    org = Organization(name=f"purge-{uuid.uuid4().hex[:8]}", currency_code="UAH")
    session.add(org)
    await session.flush()
    return org.id


async def records(session: AsyncSession, org: uuid.UUID, *expires: datetime) -> list[uuid.UUID]:
    rows = [
        IdempotencyRecord(
            organization_id=org,
            endpoint="POST /test",
            key=str(uuid.uuid4()),
            request_fingerprint="0" * 64,
            status=IdempotencyStatus.COMPLETED,
            response_snapshot={"ok": True},
            http_status=201,
            expires_at=moment,
        )
        for moment in expires
    ]
    session.add_all(rows)
    await session.commit()
    return [row.id for row in rows]


async def left(session: AsyncSession, org: uuid.UUID) -> set[uuid.UUID]:
    return set(
        (
            await session.scalars(
                select(IdempotencyRecord.id).where(IdempotencyRecord.organization_id == org)
            )
        ).all()
    )


async def test_only_expired_records_go_in_batches(maker: async_sessionmaker[AsyncSession]) -> None:
    now = datetime.now(tz=UTC) + RETENTION + LATER
    async with maker() as session:
        org = await organization(session)
        expired = await records(
            session, org, *[now - timedelta(hours=hour) for hour in range(1, 6)]
        )
        kept = await records(session, org, now, now + timedelta(seconds=1))

        purged = await purge_expired(session, now=now, batch=2)

        assert purged >= 5
        assert await left(session, org) == set(kept)
        assert not set(expired) & await left(session, org)
        # Nothing left to do: a second run deletes nothing.
        assert await purge_expired(session, now=now, batch=2) == 0


async def test_each_batch_is_committed(maker: async_sessionmaker[AsyncSession]) -> None:
    """Another connection sees the records gone: nothing waits on a commit."""
    now = datetime.now(tz=UTC) + RETENTION + LATER
    async with maker() as session:
        org = await organization(session)
        await records(session, org, now - timedelta(minutes=1), now - timedelta(minutes=2))
        await purge_expired(session, now=now, batch=1)
    async with maker() as other:
        assert await left(other, org) == set()


async def test_a_record_a_request_holds_is_skipped_not_waited_for(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(tz=UTC) + RETENTION + LATER
    async with maker() as session:
        org = await organization(session)
        held, _free = await records(
            session, org, now - timedelta(hours=1), now - timedelta(hours=2)
        )
    async with maker() as request:
        await request.execute(
            select(IdempotencyRecord.id).where(IdempotencyRecord.id == held).with_for_update()
        )
        async with maker() as session:
            await asyncio.wait_for(purge_expired(session, now=now), timeout=5)
            assert await left(session, org) == {held}
        await request.rollback()
    async with maker() as session:
        await purge_expired(session, now=now)
        assert await left(session, org) == set()


async def test_a_batch_must_take_something(maker: async_sessionmaker[AsyncSession]) -> None:
    async with maker() as session:
        with pytest.raises(ValueError, match="positive"):
            await purge_expired(session, now=datetime.now(tz=UTC), batch=0)


async def test_a_sale_retried_after_its_record_was_purged_is_the_same_sale(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    async with maker() as session:
        shop = await make_shop(session)
        payload = payload_for(shop, found=True)
        key = str(uuid.uuid4())
        original = await api_sale(session, shop, payload, key=key)
        assert (
            await session.scalar(
                select(func.count())
                .select_from(IdempotencyRecord)
                .where(IdempotencyRecord.organization_id == shop.organization_id)
            )
            == 1
        )

        await purge_expired(session, now=datetime.now(tz=UTC) + RETENTION + LATER)
        assert await left(session, shop.organization_id) == set()

        # The same request, the same key: the cache is gone, so it is
        # answered by its permanent command id instead.
        retried = await api_sale(session, shop, payload, key=key)

        assert retried.model_dump() == original.model_dump()
        assert (
            await session.scalar(
                select(func.count()).select_from(Sale).where(Sale.store_id == shop.store_id)
            )
            == 1
        )


async def test_a_rename_retried_after_its_record_was_purged_is_the_same_rename(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    """A catalogue correction is durable by its command id too (ADR-0008 §1):
    after the purge, the same request under the same key is answered with
    what it did, and nothing is renamed twice."""
    shops = await make_two_shops(maker)
    found = await model(maker, shops, concept="Лоран", color="шоколад")
    variant = found["product_variant_id"]
    body = rename_body(shops, concept="Лоран", variant={"color": "чорний"})
    key = str(uuid.uuid4())

    first = await rename(maker, manager(shops), variant, body, idempotency_key=key)
    assert first.status_code == 200, first.text
    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(IdempotencyRecord)
                .where(IdempotencyRecord.key == key)
            )
            == 1
        )
        await purge_expired(session, now=datetime.now(tz=UTC) + RETENTION + LATER)
        assert (
            await session.scalar(
                select(func.count())
                .select_from(IdempotencyRecord)
                .where(IdempotencyRecord.key == key)
            )
            == 0
        )

    retried = await rename(maker, manager(shops), variant, body, idempotency_key=key)

    assert retried.status_code == 200, retried.text
    assert retried.json() == first.json()
    assert [str(c.id) for c in await corrections(maker, shops)] == [first.json()["correction_id"]]
    assert len(await audits(maker, shops, "catalog.model_rename")) == 1
