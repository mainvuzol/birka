"""Read-only matching suggestions never become catalog or stock decisions."""

from __future__ import annotations

import os
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.modules.authz.permissions import Permission
from app.modules.catalog.evidence import AliasStatus, AliasTargetType, ProductAlias
from app.modules.catalog.matching import duplicate_family_signatures, preview_match
from app.modules.catalog.models import CanonicalConcept, ProductFamily, ProductVariant
from tests.conftest import requires_database
from tests.integration.test_sale_command import make_shop
from tests.integration.test_transfer_command import api

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def make_alias(
    session, shop, *, target=None, phrase="мій виріб", status=AliasStatus.VERIFIED
):
    alias = ProductAlias(
        organization_id=shop.organization_id,
        normalized_phrase=phrase,
        target_type=AliasTargetType.VARIANT,
        target_id=target or shop.variant_id,
        status=status,
    )
    session.add(alias)
    await session.flush()
    return alias


async def test_verified_alias_is_only_a_proposal_and_repeat_is_stable(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await make_alias(session, shop)
        before = await session.scalar(select(func.count()).select_from(ProductVariant))
        first = (
            await preview_match(session, organization_id=shop.organization_id, raw_text="мій виріб")
        ).to_dict()
        second = (
            await preview_match(session, organization_id=shop.organization_id, raw_text="мій виріб")
        ).to_dict()
        assert first == second
        assert first["decision_type"] == "SAME_VARIANT"
        assert first["requires_confirmation"] is True
        assert first["resolved_variant_id"] is None
        assert first["candidates"][0]["variant_id"] == str(shop.variant_id)
        assert await session.scalar(select(func.count()).select_from(ProductVariant)) == before
        assert not session.new and not session.dirty and not session.deleted


async def test_cross_tenant_alias_target_is_never_disclosed(maker):
    async with maker() as session:
        local = await make_shop(session)
        foreign = await make_shop(session)
        await make_alias(session, local, target=foreign.variant_id)
        result = (
            await preview_match(
                session, organization_id=local.organization_id, raw_text="мій виріб"
            )
        ).to_dict()
        assert str(foreign.variant_id) not in str(result)
        assert str(foreign.organization_id) not in str(result)


async def test_explicit_color_conflict_overrides_verified_alias(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await make_alias(session, shop, phrase="лоран чорний")
        result = (
            await preview_match(
                session, organization_id=shop.organization_id, raw_text="Лоран чорний"
            )
        ).to_dict()
        assert result["decision_type"] == "AMBIGUOUS"
        candidate = next(c for c in result["candidates"] if c["variant_id"] == str(shop.variant_id))
        assert candidate["conflicts"]
        assert result["requires_confirmation"] is True


async def test_duplicate_null_signatures_are_reported_but_never_merged(maker):
    async with maker() as session:
        shop = await make_shop(session)
        family = ProductFamily(
            organization_id=shop.organization_id,
            canonical_concept_id=shop.concept_id,
            distinction_note="Інша модель",
        )
        session.add(family)
        await session.flush()
        original = await session.get(ProductVariant, shop.variant_id)
        session.add(
            ProductVariant(
                product_family_id=family.id,
                color_term_id=original.color_term_id,
                length_cm=Decimal("70"),
            )
        )
        await session.flush()
        report = await duplicate_family_signatures(session, organization_id=shop.organization_id)
        assert str(family.id) in str(report)
        assert str(original.product_family_id) in str(report)
        result = (
            await preview_match(
                session, organization_id=shop.organization_id, raw_text="Лоран шоколад 70 см"
            )
        ).to_dict()
        assert result["decision_type"] == "AMBIGUOUS"
        assert len(result["candidates"]) == 2


async def test_knowledge_fingerprint_changes_when_catalog_label_changes(maker):
    async with maker() as session:
        shop = await make_shop(session)
        first = (
            await preview_match(session, organization_id=shop.organization_id, raw_text="Лоран")
        ).to_dict()
        await session.execute(
            update(CanonicalConcept)
            .where(CanonicalConcept.id == shop.concept_id)
            .values(name="Лоран новий", normalized_name="лоран новий")
        )
        second = (
            await preview_match(session, organization_id=shop.organization_id, raw_text="Лоран")
        ).to_dict()
        assert first["knowledge_fingerprint"] != second["knowledge_fingerprint"]


async def test_preview_api_authorizes_store_and_rejects_invalid_input(maker):
    async with maker() as session:
        shop = await make_shop(session)
        foreign = await make_shop(session)
    payload = {"store_id": str(shop.store_id), "raw_text": "Лоран"}
    async with api(maker, shop.scope()) as client:
        assert (await client.post("/api/v1/catalog/match-preview", json=payload)).status_code == 403
    async with api(maker, shop.scope(frozenset(Permission))) as client:
        good = await client.post("/api/v1/catalog/match-preview", json=payload)
        assert good.status_code == 200, good.text
        assert good.json()["resolved_variant_id"] is None
        for invalid in (" ", "\x00", "x" * 2001):
            response = await client.post(
                "/api/v1/catalog/match-preview", json={**payload, "raw_text": invalid}
            )
            assert response.status_code == 422, response.text
        assert (
            await client.post(
                "/api/v1/catalog/match-preview", json={**payload, "store_id": str(foreign.store_id)}
            )
        ).status_code == 403


async def test_foreign_family_cannot_be_used_as_explicit_context(maker):
    async with maker() as session:
        shop = await make_shop(session)
        foreign = await make_shop(session)
        variant = await session.get(ProductVariant, foreign.variant_id)
        foreign_family = str(variant.product_family_id)
    async with api(maker, shop.scope(frozenset(Permission))) as client:
        response = await client.post(
            "/api/v1/catalog/match-preview",
            json={"store_id": str(shop.store_id), "raw_text": "Лоран", "family_id": foreign_family},
        )
        assert response.status_code in {403, 404, 422}, response.text


async def test_new_category_and_model_proposals_need_explicit_context(maker):
    async with maker() as session:
        shop = await make_shop(session)
        unclear = (
            await preview_match(
                session, organization_id=shop.organization_id, raw_text="Невідомий виріб"
            )
        ).to_dict()
        assert unclear["decision_type"] == "AMBIGUOUS"
        category = (
            await preview_match(
                session,
                organization_id=shop.organization_id,
                raw_text="Невідомий виріб",
                business_category_name="Новий розділ",
            )
        ).to_dict()
        assert category["decision_type"] == "NEW_CATEGORY"
        model = (
            await preview_match(
                session,
                organization_id=shop.organization_id,
                raw_text="Невідомий виріб",
                concept_name="Нова назва",
            )
        ).to_dict()
        assert model["decision_type"] == "NEW_MODEL"
        assert category["requires_confirmation"] and model["requires_confirmation"]


async def test_explicit_context_conflicts_block_existing_and_new_variant(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await make_alias(session, shop)
        result = await preview_match(
            session,
            organization_id=shop.organization_id,
            raw_text="мій виріб",
            business_category_name="Інша категорія",
        )
        assert result.decision_type == "AMBIGUOUS"
        assert "category_context" in result.candidates[0]["conflicts"]
        variant = await session.get(ProductVariant, shop.variant_id)
        result = await preview_match(
            session,
            organization_id=shop.organization_id,
            raw_text="чорний",
            family_id=variant.product_family_id,
            concept_name="Інша модель",
        )
        assert result.decision_type == "AMBIGUOUS"
        result = await preview_match(
            session,
            organization_id=shop.organization_id,
            raw_text="чорний",
            family_id=variant.product_family_id,
        )
        assert result.decision_type == "NEW_VARIANT"
        assert result.requires_confirmation and result.resolved_variant_id is None


async def test_learning_alias_does_not_establish_identity(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await make_alias(session, shop, status=AliasStatus.LEARNING)
        result = await preview_match(
            session,
            organization_id=shop.organization_id,
            raw_text="мій виріб",
        )
        assert result.decision_type == "AMBIGUOUS"
        assert "VERIFIED_ALIAS" not in result.candidates[0]["reasons"]


async def test_preview_and_duplicate_report_work_in_read_only_transaction(maker):
    async with maker() as session:
        shop = await make_shop(session)
        await make_alias(session, shop)
        await session.commit()
    async with maker() as session:
        await session.execute(text("SET TRANSACTION READ ONLY"))
        result = await preview_match(
            session,
            organization_id=shop.organization_id,
            raw_text="мій виріб",
        )
        assert result.decision_type == "SAME_VARIANT"
        await duplicate_family_signatures(session, organization_id=shop.organization_id)


async def test_truncated_pool_never_establishes_identity(maker):
    async with maker() as session:
        shop = await make_shop(session)
        original = await session.get(ProductVariant, shop.variant_id)
        session.add_all(
            [
                ProductVariant(
                    product_family_id=original.product_family_id,
                    length_cm=Decimal(index + 1),
                )
                for index in range(201)
            ]
        )
        await make_alias(session, shop)
        result = await preview_match(
            session,
            organization_id=shop.organization_id,
            raw_text="мій виріб",
            limit=1,
        )
        assert result.decision_type == "AMBIGUOUS"
        assert result.truncated and len(result.candidates) == 1
        assert "CANDIDATE_POOL_TRUNCATED" in result.review_reasons
