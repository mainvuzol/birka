"""Explicit alias observations are scoped, repeatable and never auto-verified."""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.errors import CatalogAmbiguousError, IdempotencyConflictError, ValidationFailedError
from app.modules.catalog.evidence import (
    AliasEvidence,
    AliasEvidenceEvent,
    AliasStatus,
    ProductAlias,
)
from app.modules.catalog.feedback import record_alias_feedback
from app.modules.catalog.matching import preview_match
from app.modules.catalog.models import ProductVariant
from tests.conftest import requires_database
from tests.integration.test_catalog_decisions import confirm, proposal, scope
from tests.integration.test_catalog_matching import make_alias
from tests.integration.test_catalog_review import reject
from tests.integration.test_sale_command import make_shop
from tests.integration.test_transfer_command import api

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def feedback(
    session, shop, decision, *, event=AliasEvidenceEvent.CONFIRM, variant_id=None, feedback_id=None
):
    return await record_alias_feedback(
        session,
        scope=scope(shop),
        decision_id=uuid.UUID(decision["decision_id"]),
        feedback_id=feedback_id or uuid.uuid4(),
        variant_id=variant_id or shop.variant_id,
        event=event,
    )


async def applied(session, shop, *, raw_text="мій виріб", variant_id=None):
    result = await proposal(session, shop, raw_text=raw_text)
    await confirm(session, shop, result, variant_id=variant_id)
    return result


async def test_confirm_evidence_is_idempotent_and_stays_learning(maker):
    async with maker() as session:
        shop = await make_shop(session)
        decision = await applied(session, shop, raw_text="  МІЙ   виріб\n")
        await session.commit()
        command = uuid.uuid4()
        result = await feedback(session, shop, decision, feedback_id=command)
        await session.commit()
        assert result["normalized_phrase"] == "мій виріб"
        assert result["status"] == "LEARNING"
        assert (result["confirm_count"], result["reject_count"]) == (1, 0)
        assert await feedback(session, shop, decision, feedback_id=command) == result
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AliasEvidence)
                .where(AliasEvidence.decision_id == uuid.UUID(decision["decision_id"]))
            )
            == 1
        )
        with pytest.raises(IdempotencyConflictError):
            await feedback(session, shop, decision)
        with pytest.raises(IdempotencyConflictError):
            await feedback(
                session, shop, decision, feedback_id=command, event=AliasEvidenceEvent.REJECT
            )
        preview = await preview_match(
            session, organization_id=shop.organization_id, raw_text="мій виріб"
        )
        assert preview.decision_type == "AMBIGUOUS"
        assert "VERIFIED_ALIAS" not in preview.candidates[0]["reasons"]


async def test_negative_and_mixed_evidence_are_preserved(maker):
    async with maker() as session:
        shop = await make_shop(session)
        positive = await applied(session, shop)
        negative = await proposal(session, shop)
        await reject(session, shop, negative)
        await session.commit()
        result = await feedback(session, shop, negative, event=AliasEvidenceEvent.REJECT)
        assert result["status"] == "REJECTED" and result["reject_count"] == 1
        result = await feedback(session, shop, positive)
        assert result["status"] == "AMBIGUOUS"
        assert (result["confirm_count"], result["reject_count"]) == (1, 1)
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AliasEvidence)
                .where(AliasEvidence.alias_id == uuid.UUID(str(result["alias_id"])))
            )
            == 2
        )


async def test_conflicting_targets_disable_existing_verified_alias(maker):
    async with maker() as session:
        shop = await make_shop(session)
        original = await session.get(ProductVariant, shop.variant_id)
        other = ProductVariant(product_family_id=original.product_family_id, length_cm=71)
        session.add(other)
        await session.flush()
        existing = await make_alias(session, shop)
        existing.confirm_count = 3
        await session.flush()
        decision = await applied(session, shop, variant_id=other.id)
        result = await feedback(session, shop, decision, variant_id=other.id)
        assert result["status"] == "AMBIGUOUS"
        await session.refresh(existing)
        assert existing.status == AliasStatus.AMBIGUOUS
        preview = await preview_match(
            session, organization_id=shop.organization_id, raw_text="мій виріб"
        )
        assert all("VERIFIED_ALIAS" not in c["reasons"] for c in preview.candidates)


async def test_only_reviewed_explicit_targets_are_accepted(maker):
    async with maker() as session:
        shop = await make_shop(session)
        original = await session.get(ProductVariant, shop.variant_id)
        other = ProductVariant(product_family_id=original.product_family_id, length_cm=71)
        session.add(other)
        await session.flush()
        pending = await proposal(session, shop)
        with pytest.raises((CatalogAmbiguousError, ValidationFailedError)):
            await feedback(session, shop, pending)
        chosen = await confirm(session, shop, pending)
        with pytest.raises((CatalogAmbiguousError, ValidationFailedError)):
            await feedback(session, shop, chosen, variant_id=other.id)
        with pytest.raises((CatalogAmbiguousError, ValidationFailedError)):
            await feedback(session, shop, chosen, event=AliasEvidenceEvent.REJECT)
        assert (
            await feedback(
                session, shop, chosen, variant_id=other.id, event=AliasEvidenceEvent.REJECT
            )
        )["status"] == "REJECTED"


async def test_long_normalized_phrase_is_not_truncated(maker):
    async with maker() as session:
        shop = await make_shop(session)
        decision = await applied(session, shop, raw_text="ß" * 101)
        with pytest.raises(ValidationFailedError):
            await feedback(session, shop, decision)
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ProductAlias)
                .where(ProductAlias.organization_id == shop.organization_id)
            )
            == 0
        )


async def test_feedback_rollback_preserves_counts_revision_and_audit(maker):
    async with maker() as session:
        shop = await make_shop(session)
        decision = await applied(session, shop)
        await session.commit()
        query = text("SELECT revision FROM catalog_knowledge_revision WHERE organization_id=:org")
        before = await session.scalar(query, {"org": shop.organization_id})
        await feedback(session, shop, decision)
        assert await session.scalar(query, {"org": shop.organization_id}) > before
        await session.rollback()
        assert await session.scalar(query, {"org": shop.organization_id}) == before
        assert (
            await session.scalar(
                select(func.count())
                .select_from(ProductAlias)
                .where(ProductAlias.organization_id == shop.organization_id)
            )
            == 0
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AliasEvidence)
                .where(AliasEvidence.decision_id == uuid.UUID(decision["decision_id"]))
            )
            == 0
        )


async def test_concurrent_same_feedback_creates_one_observation(maker):
    async with maker() as session:
        shop = await make_shop(session)
        decision = await applied(session, shop)
        await session.commit()
    command = uuid.uuid4()

    async def run():
        async with maker() as session:
            result = await feedback(session, shop, decision, feedback_id=command)
            await session.commit()
            return result

    first, second = await asyncio.wait_for(asyncio.gather(run(), run()), timeout=10)
    assert first == second and first["confirm_count"] == 1
    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count()).select_from(AliasEvidence).where(AliasEvidence.id == command)
            )
            == 1
        )


async def test_concurrent_different_decisions_keep_both_counts(maker):
    async with maker() as session:
        shop = await make_shop(session)
        decisions = [await applied(session, shop) for _ in range(2)]
        await session.commit()

    async def run(decision):
        async with maker() as session:
            result = await feedback(session, shop, decision)
            await session.commit()
            return result

    results = await asyncio.wait_for(asyncio.gather(*(run(d) for d in decisions)), timeout=10)
    assert {r["confirm_count"] for r in results} == {1, 2}
    assert {r["status"] for r in results} == {"LEARNING"}


async def test_api_authorizes_before_replay_and_hides_foreign_decisions(maker):
    async with maker() as session:
        shop, foreign = await make_shop(session), await make_shop(session)
        decision = await applied(session, shop)
        other = await applied(session, foreign)
        await session.commit()
    path = f"/api/v1/catalog/match-decisions/{decision['decision_id']}/alias-feedback"
    payload = {
        "feedback_id": str(uuid.uuid4()),
        "variant_id": str(shop.variant_id),
        "event": "CONFIRM",
    }
    async with api(maker, scope(shop)) as client:
        result = await client.post(path, json=payload)
        assert result.status_code == 200, result.text
        assert result.json()["status"] == "LEARNING"
        assert (await client.post(path, json={**payload, "event": "VERIFY"})).status_code == 422
        response = await client.post(
            f"/api/v1/catalog/match-decisions/{other['decision_id']}/alias-feedback", json=payload
        )
        assert response.status_code == 404, response.text
    async with api(maker, shop.scope()) as client:
        assert (await client.post(path, json=payload)).status_code == 403


@pytest.mark.parametrize("target_type", ["VARIANT", "FAMILY", "CONCEPT"])
async def test_legacy_verified_conflict_remains_ambiguous_after_later_feedback(maker, target_type):
    from app.modules.catalog.evidence import AliasTargetType

    async with maker() as session:
        shop = await make_shop(session)
        original = await session.get(ProductVariant, shop.variant_id)
        other = ProductVariant(product_family_id=original.product_family_id, length_cm=71)
        session.add(other)
        legacy = ProductAlias(
            organization_id=shop.organization_id,
            normalized_phrase="мій виріб",
            target_type=AliasTargetType(target_type),
            target_id={
                "VARIANT": shop.variant_id,
                "FAMILY": original.product_family_id,
                "CONCEPT": shop.concept_id,
            }[target_type],
            status=AliasStatus.VERIFIED,
        )
        session.add(legacy)
        await session.flush()
        first = await applied(session, shop, variant_id=other.id)
        second = await applied(session, shop, variant_id=other.id)
        await session.commit()
        assert (await feedback(session, shop, first, variant_id=other.id))["status"] == "AMBIGUOUS"
        await session.commit()
        assert (await feedback(session, shop, second, variant_id=other.id))["status"] == "AMBIGUOUS"
        await session.refresh(legacy)
        assert legacy.status == AliasStatus.AMBIGUOUS
        assert legacy.confirm_count == 0


async def test_database_rejects_second_observation_for_same_decision_alias(maker):
    from sqlalchemy.exc import IntegrityError

    async with maker() as session:
        shop = await make_shop(session)
        decision = await applied(session, shop)
        result = await feedback(session, shop, decision)
        await session.commit()
        with pytest.raises(IntegrityError):
            async with session.begin_nested():
                session.add(
                    AliasEvidence(
                        alias_id=uuid.UUID(result["alias_id"]),
                        decision_id=uuid.UUID(decision["decision_id"]),
                        event=AliasEvidenceEvent.REJECT,
                    )
                )
                await session.flush()


async def test_concurrent_competing_targets_are_both_ambiguous(maker):
    async with maker() as session:
        shop = await make_shop(session)
        original = await session.get(ProductVariant, shop.variant_id)
        other = ProductVariant(product_family_id=original.product_family_id, length_cm=71)
        session.add(other)
        await session.flush()
        first = await applied(session, shop)
        second = await applied(session, shop, variant_id=other.id)
        other_id = other.id
        await session.commit()

    async def run(decision, target):
        async with maker() as session:
            result = await feedback(session, shop, decision, variant_id=target)
            await session.commit()
            return result

    await asyncio.wait_for(
        asyncio.gather(run(first, shop.variant_id), run(second, other_id)), timeout=10
    )
    async with maker() as session:
        aliases = list(
            (
                await session.scalars(
                    select(ProductAlias).where(ProductAlias.organization_id == shop.organization_id)
                )
            ).all()
        )
        assert len(aliases) == 2
        assert all(a.status == AliasStatus.AMBIGUOUS and a.confirm_count == 1 for a in aliases)
