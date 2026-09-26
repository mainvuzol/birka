"""Durable proposals preserve evidence and reject stale or unauthorized confirmation."""

from __future__ import annotations

import asyncio
import json
import os
import uuid

import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.errors import CatalogAmbiguousError, IdempotencyConflictError, NotFoundError
from app.modules.authz.permissions import Permission
from app.modules.catalog.decisions import confirm_decision, create_decision, get_decision
from app.modules.catalog.evidence import CatalogMatchDecision, ParseResult, RawInput
from app.modules.catalog.models import CanonicalConcept, ProductVariant
from tests.conftest import requires_database
from tests.integration.test_catalog_matching import make_alias
from tests.integration.test_sale_command import make_shop
from tests.integration.test_transfer_command import api

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def scope(shop):
    return shop.scope(frozenset(Permission))


async def proposal(session, shop, *, decision_id=None, raw_text="мій виріб", **context):
    return await create_decision(
        session,
        scope=scope(shop),
        decision_id=decision_id or uuid.uuid4(),
        store_id=shop.store_id,
        raw_text=raw_text,
        **context,
    )


async def confirm(session, shop, result, *, variant_id=None, revision=None):
    return await confirm_decision(
        session,
        scope=scope(shop),
        decision_id=uuid.UUID(str(result["decision_id"])),
        variant_id=variant_id or shop.variant_id,
        expected_knowledge_revision=result["knowledge_revision"] if revision is None else revision,
    )


async def test_exact_raw_evidence_and_retry_preserve_original_preview(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await make_alias(session, shop)
        decision_id = uuid.uuid4()
        raw = "  мій виріб\n"
        first = await proposal(session, shop, decision_id=decision_id, raw_text=raw)
        await session.commit()
        raw_row = await session.get(RawInput, uuid.UUID(str(first["raw_input_id"])))
        parsed = await session.get(ParseResult, uuid.UUID(str(first["parse_result_id"])))
        assert raw_row.raw_text == raw
        assert parsed.parsed["raw_text"] == raw
        assert first["requires_confirmation"] and first["resolved_variant_id"] is None
        assert first["knowledge_revision"] > 0
        await session.execute(
            update(CanonicalConcept)
            .where(CanonicalConcept.id == shop.concept_id)
            .values(name="Змінена назва")
        )
        await session.commit()
        replay = await proposal(session, shop, decision_id=decision_id, raw_text=raw)
        assert replay == first
        count = await session.scalar(
            select(func.count())
            .select_from(CatalogMatchDecision)
            .where(CatalogMatchDecision.id == decision_id)
        )
        assert count == 1
        with pytest.raises(IdempotencyConflictError):
            await proposal(session, shop, decision_id=decision_id, raw_text="інший текст")


async def test_confirm_is_idempotent_and_keeps_original_prediction(maker):
    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop, raw_text="невідомий виріб")
        assert first["preview"]["decision_type"] == "AMBIGUOUS"
        applied = await confirm(session, shop, first)
        await session.commit()
        assert applied["status"] == "APPLIED"
        assert str(applied["resolved_variant_id"]) == str(shop.variant_id)
        assert not applied["requires_confirmation"]
        assert applied["preview"] == first["preview"]
        await session.execute(
            update(CanonicalConcept)
            .where(CanonicalConcept.id == shop.concept_id)
            .values(name="Ще одна назва")
        )
        await session.commit()
        assert await confirm(session, shop, first) == applied
        with pytest.raises((IdempotencyConflictError, CatalogAmbiguousError)):
            await confirm(session, shop, first, variant_id=uuid.uuid4())


async def test_stale_revision_requires_a_new_proposal(maker):
    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop)
        await session.commit()
        await make_alias(session, shop)
        await session.commit()
        with pytest.raises(CatalogAmbiguousError):
            await confirm(session, shop, first)
        await session.rollback()
        row = await session.get(CatalogMatchDecision, uuid.UUID(str(first["decision_id"])))
        assert row.resolved_variant_id is None
        fresh = await proposal(session, shop)
        assert fresh["knowledge_revision"] > first["knowledge_revision"]
        assert (await confirm(session, shop, fresh))["status"] == "APPLIED"


async def test_wrong_client_revision_is_rejected(maker):
    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop)
        with pytest.raises(CatalogAmbiguousError):
            await confirm(session, shop, first, revision=first["knowledge_revision"] + 1)


async def test_foreign_decision_and_variant_are_rejected(maker):
    async with maker() as session:
        local, foreign = await make_shop(session), await make_shop(session)
        foreign_result = await proposal(session, foreign)
        await session.commit()
        with pytest.raises(NotFoundError):
            await get_decision(
                session,
                scope=scope(local),
                decision_id=uuid.UUID(str(foreign_result["decision_id"])),
            )
        first = await proposal(session, local)
        with pytest.raises((NotFoundError, CatalogAmbiguousError)):
            await confirm(session, local, first, variant_id=foreign.variant_id)


async def test_explicit_family_cannot_be_overridden_by_confirmation(maker):
    async with maker() as session:
        shop = await make_shop(session)
        variant = await session.get(ProductVariant, shop.variant_id)
        from app.modules.catalog.models import ProductFamily

        family = ProductFamily(
            organization_id=shop.organization_id,
            canonical_concept_id=shop.concept_id,
            distinction_note="інша модель",
        )
        session.add(family)
        await session.flush()
        other = ProductVariant(product_family_id=family.id)
        session.add(other)
        await session.flush()
        first = await proposal(session, shop, family_id=variant.product_family_id)
        with pytest.raises(CatalogAmbiguousError):
            await confirm(session, shop, first, variant_id=other.id)


async def test_api_permissions_validation_and_read_after_confirm(maker):
    async with maker() as session:
        shop = await make_shop(session)
    payload = {
        "decision_id": str(uuid.uuid4()),
        "store_id": str(shop.store_id),
        "raw_text": "мій виріб",
    }
    path = "/api/v1/catalog/match-decisions"
    async with api(maker, shop.scope()) as client:
        assert (await client.post(path, json=payload)).status_code == 403
    async with api(maker, scope(shop)) as client:
        for bad in (" ", "\x00", "\ud800", "a" * 2001):
            response = await client.post(
                path,
                content=json.dumps({**payload, "raw_text": bad}),
                headers={"Content-Type": "application/json"},
            )
            assert response.status_code == 422, response.text
        response = await client.post(path, json=payload)
        assert response.status_code == 200, response.text
        first = response.json()
        confirmation = {
            "variant_id": str(shop.variant_id),
            "expected_knowledge_revision": first["knowledge_revision"],
        }
        result = await client.post(f"{path}/{first['decision_id']}/confirm", json=confirmation)
        assert result.status_code == 200, result.text
        assert result.json()["status"] == "APPLIED"
        assert (await client.get(f"{path}/{first['decision_id']}")).json() == result.json()
    async with api(maker, shop.scope()) as client:
        assert (await client.get(f"{path}/{payload['decision_id']}")).status_code == 403
        assert (
            await client.post(f"{path}/{payload['decision_id']}/confirm", json=confirmation)
        ).status_code == 403


async def test_concurrent_same_command_creates_one_raw_input(maker):
    async with maker() as session:
        shop = await make_shop(session)
    command = uuid.uuid4()

    async def run():
        async with maker() as session:
            result = await proposal(session, shop, decision_id=command)
            await session.commit()
            return result

    first, second = await asyncio.wait_for(asyncio.gather(run(), run()), timeout=10)
    assert first == second
    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(RawInput)
                .where(RawInput.organization_id == shop.organization_id)
            )
            == 1
        )


async def test_confirmation_rollback_is_atomic(maker):
    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop)
        await session.commit()
        await confirm(session, shop, first)
        await session.rollback()
        unchanged = await get_decision(
            session, scope=scope(shop), decision_id=uuid.UUID(str(first["decision_id"]))
        )
        assert unchanged == first


async def test_revision_is_transactional_and_tenant_local(maker):
    async with maker() as session:
        local, foreign = await make_shop(session), await make_shop(session)

        async def revision(org):
            return await session.scalar(
                text("SELECT revision FROM catalog_knowledge_revision WHERE organization_id=:org"),
                {"org": org},
            )

        before = await revision(local.organization_id)
        foreign_before = await revision(foreign.organization_id)
        await session.execute(
            update(CanonicalConcept)
            .where(CanonicalConcept.id == local.concept_id)
            .values(name="Тимчасова назва")
        )
        assert await revision(local.organization_id) > before
        assert await revision(foreign.organization_id) == foreign_before
        await session.rollback()
        assert await revision(local.organization_id) == before


async def test_candidate_deleted_after_preview_returns_controlled_conflict(maker, monkeypatch):
    from app.modules.catalog import decisions

    async with maker() as session:
        shop = await make_shop(session)
    original = decisions.preview_match

    async def delete_after_snapshot(*args, **kwargs):
        result = await original(*args, **kwargs)
        async with maker() as writer:
            await writer.execute(
                text("DELETE FROM product_variant WHERE id=:id"), {"id": shop.variant_id}
            )
            await writer.commit()
        return result

    monkeypatch.setattr(decisions, "preview_match", delete_after_snapshot)
    async with maker() as session:
        with pytest.raises(CatalogAmbiguousError):
            await proposal(session, shop)
        await session.rollback()
        assert (
            await session.scalar(
                select(func.count())
                .select_from(RawInput)
                .where(RawInput.organization_id == shop.organization_id)
            )
            == 0
        )


async def test_concurrent_delete_before_confirmation_does_not_deadlock(maker, monkeypatch):
    from app.modules.catalog import decisions

    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop)
        await session.commit()
    started = asyncio.Event()
    original = decisions._lock_variant_key

    async def observe(*args, **kwargs):
        started.set()
        return await original(*args, **kwargs)

    monkeypatch.setattr(decisions, "_lock_variant_key", observe)

    async def run_confirmation():
        async with maker() as session:
            with pytest.raises(CatalogAmbiguousError):
                await confirm(session, shop, first)

    async with maker() as writer:
        await writer.execute(
            select(ProductVariant).where(ProductVariant.id == shop.variant_id).with_for_update()
        )
        task = asyncio.create_task(run_confirmation())
        try:
            await asyncio.wait_for(started.wait(), timeout=5)
            await asyncio.wait_for(
                writer.execute(
                    text("DELETE FROM product_variant WHERE id=:id"), {"id": shop.variant_id}
                ),
                timeout=5,
            )
            await writer.commit()
            await asyncio.wait_for(task, timeout=5)
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)


async def test_two_confirmations_resolve_once(maker):
    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop)
        await session.commit()

    async def run():
        async with maker() as session:
            result = await confirm(session, shop, first)
            await session.commit()
            return result

    left, right = await asyncio.wait_for(asyncio.gather(run(), run()), timeout=10)
    assert left == right
    from app.modules.audit.models import AuditLog

    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.entity_id == uuid.UUID(first["decision_id"]),
                    AuditLog.action == "catalog.match_confirmed",
                )
            )
            == 1
        )
