"""Reviewed creation is atomic, manually supplied and permanently repeatable."""

from __future__ import annotations

import asyncio
import os
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.errors import CatalogAmbiguousError, IdempotencyConflictError, NotFoundError
from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import Permission
from app.modules.catalog.decisions import get_decision
from app.modules.catalog.evidence import RawInput, RawInputProcessing
from app.modules.catalog.intake import create_product_from_decision
from app.modules.catalog.models import (
    CanonicalConcept,
    ProductFamily,
    ProductVariant,
    SizeSystemCode,
)
from app.modules.catalog.review import reject_decision
from app.modules.catalog.service import ProductDraft, SizeDraft, VariantDraft
from app.modules.tenancy.models import Store, StoreState
from tests.conftest import requires_database
from tests.integration.test_catalog_decisions import confirm, proposal, scope
from tests.integration.test_sale_command import make_shop
from tests.integration.test_transfer_command import api

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def draft(**changes):
    return ProductDraft(
        sizes=(SizeDraft(SizeSystemCode.ALPHA, "M"),),
        **({"concept": "Нова модель"} | changes),
    )


async def apply(session, shop, decision, product=None, **changes):
    return await create_product_from_decision(
        session,
        scope=scope(shop),
        decision_id=uuid.UUID(decision["decision_id"]),
        store_id=shop.store_id,
        draft=product or draft(**changes),
    )


async def test_creation_preserves_raw_preview_and_permanent_replay(maker):
    async with maker() as session:
        shop = await make_shop(session)
        decision = await proposal(session, shop, raw_text="  новий виріб\n")
        await session.commit()
        result = await apply(session, shop, decision)
        await session.commit()
        assert result["decision_type"] == "NEW_MODEL"
        assert result["mode"] == "MANUAL" and result["status"] == "APPLIED"
        assert result["creation"]["family_created"]
        assert result["preview"] == decision["preview"]
        assert result["knowledge_revision"] == decision["knowledge_revision"]
        assert (
            await session.get(RawInput, uuid.UUID(result["raw_input_id"]))
        ).raw_text == "  новий виріб\n"
        assert (
            await session.get(RawInputProcessing, uuid.UUID(result["raw_input_id"]))
        ).status.value == "RESOLVED"
        assert await apply(session, shop, decision) == result
        assert (
            await get_decision(
                session, scope=scope(shop), decision_id=uuid.UUID(decision["decision_id"])
            )
            == result
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.entity_id == uuid.UUID(decision["decision_id"]),
                    AuditLog.action == "catalog.product_created_from_decision",
                )
            )
            == 1
        )
        with pytest.raises(IdempotencyConflictError):
            await apply(session, shop, decision, concept="Змінений запит")
        with pytest.raises(IdempotencyConflictError):
            await confirm(
                session, shop, decision, variant_id=uuid.UUID(result["resolved_variant_id"])
            )


async def test_manual_creation_allows_stale_preview(maker):
    async with maker() as session:
        shop = await make_shop(session)
        decision = await proposal(session, shop)
        await session.commit()
        await session.execute(
            update(CanonicalConcept)
            .where(CanonicalConcept.id == shop.concept_id)
            .values(name="Змінена назва")
        )
        await session.commit()
        assert (await apply(session, shop, decision))["status"] == "APPLIED"


@pytest.mark.parametrize("reuse", [True, False])
async def test_existing_family_classifies_reused_and_new_variants(maker, reuse):
    async with maker() as session:
        shop = await make_shop(session)
        family = (await session.get(ProductVariant, shop.variant_id)).product_family_id
        decision = await proposal(session, shop, family_id=family)
        await session.commit()
        product = draft(
            concept=None,
            product_family_id=family,
            variant=VariantDraft(color="шоколад" if reuse else "чорний", length_cm=Decimal("70")),
        )
        result = await apply(session, shop, decision, product)
        assert result["decision_type"] == ("SAME_VARIANT" if reuse else "NEW_VARIANT")
        assert result["creation"]["variant_created"] is not reuse
        assert not result["creation"]["family_created"]


async def test_ambiguous_creation_rolls_back_then_explicit_distinction_succeeds(maker):
    async with maker() as session:
        shop = await make_shop(session)
        decision = await proposal(session, shop)
        await session.commit()
        with pytest.raises(CatalogAmbiguousError):
            await apply(session, shop, decision, concept="Лоран", garment_type="Нова форма")
        await session.rollback()
        state = await get_decision(
            session, scope=scope(shop), decision_id=uuid.UUID(decision["decision_id"])
        )
        assert state["status"] == "NEEDS_REVIEW" and state["creation"] is None
        result = await apply(
            session, shop, decision, concept="Лоран", new_model=True, distinction_note="Інший крій"
        )
        await session.commit()
        assert result["creation"]["family_created"]
        assert (
            await apply(
                session,
                shop,
                decision,
                concept="Лоран",
                new_model=True,
                distinction_note="Інший крій",
            )
            == result
        )


async def test_original_family_and_prior_resolutions_cannot_be_overridden(maker):
    async with maker() as session:
        shop = await make_shop(session)
        family = (await session.get(ProductVariant, shop.variant_id)).product_family_id
        restricted = await proposal(session, shop, family_id=family)
        await session.commit()
        with pytest.raises(CatalogAmbiguousError):
            await apply(session, shop, restricted)
        await session.rollback()
        accepted = await proposal(session, shop)
        await confirm(session, shop, accepted)
        await session.commit()
        with pytest.raises(IdempotencyConflictError):
            await apply(session, shop, accepted)
        await session.rollback()
        rejected = await proposal(session, shop)
        await reject_decision(
            session,
            scope=scope(shop),
            decision_id=uuid.UUID(rejected["decision_id"]),
            reason="Не товар",
        )
        await session.commit()
        with pytest.raises(CatalogAmbiguousError):
            await apply(session, shop, rejected)


async def test_foreign_family_and_inactive_concept_fail_atomically(maker):
    async with maker() as session:
        shop, foreign = await make_shop(session), await make_shop(session)
        foreign_family = (await session.get(ProductVariant, foreign.variant_id)).product_family_id
        decision = await proposal(session, shop)
        await session.commit()
        with pytest.raises(NotFoundError):
            await apply(
                session, shop, decision, draft(concept=None, product_family_id=foreign_family)
            )
        await session.rollback()
        local_family = (await session.get(ProductVariant, shop.variant_id)).product_family_id
        await session.execute(
            update(ProductFamily)
            .where(ProductFamily.id == local_family)
            .values(canonical_concept_id=foreign.concept_id)
        )
        await session.commit()
        with pytest.raises(NotFoundError):
            await apply(
                session, shop, decision, draft(concept=None, product_family_id=local_family)
            )
        await session.rollback()
        assert (
            await get_decision(
                session, scope=scope(shop), decision_id=uuid.UUID(decision["decision_id"])
            )
        )["creation"] is None


async def test_api_permissions_store_scope_and_inactive_store(maker):
    async with maker() as session:
        shop, foreign = await make_shop(session), await make_shop(session)
        decision = await proposal(session, shop)
        await session.commit()
    endpoint = f"/api/v1/catalog/match-decisions/{decision['decision_id']}/create-product"
    payload = {
        "store_id": str(shop.store_id),
        "concept": "Нова модель",
        "sizes": [{"system": "ALPHA", "code": "M"}],
    }
    for permissions in ({Permission.CATALOG_CONFIRM}, {Permission.CATALOG_CREATE}):
        async with api(maker, shop.scope(frozenset(permissions))) as client:
            assert (await client.post(endpoint, json=payload)).status_code == 403
    async with api(maker, scope(shop)) as client:
        assert (
            await client.post(endpoint, json=payload | {"store_id": str(foreign.store_id)})
        ).status_code == 409
        assert (await client.post(endpoint, json=payload | {"sizes": []})).status_code == 422
        result = await client.post(endpoint, json=payload)
        assert result.status_code == 200, result.text
        assert result.json()["creation"]["display_name"] == "Нова модель"
    async with api(maker, scope(foreign)) as client:
        assert (await client.post(endpoint, json=payload)).status_code == 404
    async with maker() as session:
        await session.execute(
            update(Store).where(Store.id == shop.store_id).values(state=StoreState.BLOCKED)
        )
        await session.commit()
    async with api(maker, scope(shop)) as client:
        assert (await client.post(endpoint, json=payload)).status_code == 404


async def test_concurrent_new_model_retries_create_one_family(maker):
    async with maker() as session:
        shop = await make_shop(session)
        decision = await proposal(session, shop)
        await session.commit()

    async def run():
        async with maker() as session:
            result = await apply(
                session,
                shop,
                decision,
                concept="Лоран",
                new_model=True,
                distinction_note="Інший крій",
            )
            await session.commit()
            return result

    first, second = await asyncio.gather(run(), run())
    assert first == second


@pytest.mark.parametrize("failures", [1, 3])
async def test_api_retries_entire_transaction_without_partial_products(
    maker, monkeypatch, failures
):
    from sqlalchemy.exc import DBAPIError

    from app.api.v1 import catalog_decisions as route

    async with maker() as session:
        shop = await make_shop(session)
        decision = await proposal(session, shop)
        await session.commit()
    real = route.create_product_from_decision
    calls = 0

    class DeadlockError(Exception):
        sqlstate = "40P01"

    async def transient(session, **kwargs):
        nonlocal calls
        calls += 1
        result = await real(session, **kwargs)
        if calls <= failures:
            raise DBAPIError("test", {}, DeadlockError(), False)
        return result

    monkeypatch.setattr(route, "create_product_from_decision", transient)
    async with api(maker, scope(shop)) as client:
        response = await client.post(
            f"/api/v1/catalog/match-decisions/{decision['decision_id']}/create-product",
            json={
                "store_id": str(shop.store_id),
                "concept": "Новий товар після повтору",
                "sizes": [{"system": "ALPHA", "code": "M"}],
            },
        )
    assert response.status_code == (200 if failures == 1 else 409), response.text
    assert calls == (2 if failures == 1 else 3)
    async with maker() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(ProductFamily)
            .where(ProductFamily.organization_id == shop.organization_id)
        )
        assert count == (2 if failures == 1 else 1)
        state = await get_decision(
            session, scope=scope(shop), decision_id=uuid.UUID(decision["decision_id"])
        )
        assert state["status"] == ("APPLIED" if failures == 1 else "NEEDS_REVIEW")


async def test_final_validation_refreshes_cached_identity_after_concurrent_change(maker):
    from app.modules.catalog.decisions import _validate_variant
    from app.modules.catalog.knowledge import lock_knowledge_revision
    from app.modules.catalog.models import SourceIdentity

    async with maker() as session:
        shop, foreign = await make_shop(session), await make_shop(session)
        source = SourceIdentity(
            organization_id=foreign.organization_id, name="Foreign", normalized_name="foreign"
        )
        session.add(source)
        await session.commit()
        variant = await session.get(ProductVariant, shop.variant_id)
        cached = await session.get(ProductFamily, variant.product_family_id)
        assert cached.source_identity_id is None
        async with maker() as writer:
            await writer.execute(
                update(ProductFamily)
                .where(ProductFamily.id == cached.id)
                .values(source_identity_id=source.id)
            )
            await writer.commit()
        assert cached.source_identity_id is None
        await lock_knowledge_revision(session, shop.organization_id)
        with pytest.raises(NotFoundError):
            await _validate_variant(
                session, organization_id=shop.organization_id, variant_id=shop.variant_id
            )
