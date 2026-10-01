"""Family discovery never leaks another tenant's identity or requires stock."""

from __future__ import annotations

import os

import pytest
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.errors import ValidationFailedError
from app.modules.authz.permissions import Permission
from app.modules.catalog.models import (
    BusinessCategory,
    CanonicalConcept,
    EntityStatus,
    GarmentType,
    ProductFamily,
    ProductVariant,
    SourceIdentity,
)
from app.modules.catalog.search import search_families
from app.modules.tenancy.models import Store, StoreState
from tests.conftest import requires_database
from tests.integration.test_catalog_decisions import scope
from tests.integration.test_sale_command import make_shop
from tests.integration.test_transfer_command import api

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def family(session, shop, name="Нова", **values):
    concept = CanonicalConcept(
        organization_id=shop.organization_id, name=name, normalized_name=name.casefold()
    )
    session.add(concept)
    await session.flush()
    item = ProductFamily(
        organization_id=shop.organization_id, canonical_concept_id=concept.id, **values
    )
    session.add(item)
    await session.flush()
    return item, concept


async def search(session, shop, **kwargs):
    return await search_families(session, scope=scope(shop), store_id=shop.store_id, **kwargs)


async def test_browse_empty_families_and_stable_pagination_without_writes(maker):
    async with maker() as session:
        shop = await make_shop(session)
        extra, _ = await family(session, shop)
        original = await session.get(ProductVariant, shop.variant_id)
        session.add(ProductVariant(product_family_id=original.product_family_id, length_cm=80))
        await session.commit()
        await session.execute(text("SET TRANSACTION READ ONLY"))
        whole = await search(session, shop)
        assert len(whole["items"]) == 2
        assert extra.id in {row["family_id"] for row in whole["items"]}
        first, second = (
            await search(session, shop, limit=1),
            await search(session, shop, limit=1, offset=1),
        )
        assert first["has_more"] and not second["has_more"]
        assert first["items"] + second["items"] == whole["items"]
        assert await search(session, shop, offset=2) == {"items": [], "has_more": False}
        assert not session.new and not session.dirty


async def test_source_category_garment_and_distinction_labels(maker):
    async with maker() as session:
        shop = await make_shop(session)
        source = SourceIdentity(
            organization_id=shop.organization_id, name="Понте", normalized_name="понте"
        )
        category = BusinessCategory(
            organization_id=shop.organization_id, name="Куртки", normalized_name="куртки"
        )
        garment = GarmentType(
            organization_id=shop.organization_id, name="Парка", normalized_name="парка"
        )
        session.add_all([source, category, garment])
        await session.flush()
        item, concept = await family(
            session, shop, source_identity_id=source.id, distinction_note="Інший КРІЙ"
        )
        concept.business_category_id, concept.garment_type_id = category.id, garment.id
        await session.commit()
        by_name = await search(session, shop, query="нОВ")
        for query in ("ПОНТ", "крій"):
            assert await search(session, shop, query=query) == by_name
        assert by_name["items"] == [
            {
                "family_id": item.id,
                "concept_name": "Нова",
                "source_name": "Понте",
                "business_category_name": "Куртки",
                "garment_type_name": "Парка",
                "distinction_note": "Інший КРІЙ",
            }
        ]


@pytest.mark.parametrize("needle", ["%", "_", "\\"])
async def test_search_wildcards_are_literal(maker, needle):
    async with maker() as session:
        shop = await make_shop(session)
        item, _ = await family(session, shop, name=f"Назва{needle}виробу")
        await session.commit()
        result = await search(session, shop, query=needle)
        assert [row["family_id"] for row in result["items"]] == [item.id]


@pytest.mark.parametrize(
    "link", ["concept", "source", "category", "family_garment", "concept_garment"]
)
async def test_malformed_cross_tenant_identity_chains_are_excluded(maker, link):
    async with maker() as session:
        shop, foreign = await make_shop(session), await make_shop(session)
        item, concept = await family(session, shop)
        foreign_source = SourceIdentity(
            organization_id=foreign.organization_id, name="SECRET", normalized_name="secret"
        )
        foreign_category = BusinessCategory(
            organization_id=foreign.organization_id, name="SECRET", normalized_name="secret"
        )
        foreign_garment = GarmentType(
            organization_id=foreign.organization_id, name="SECRET", normalized_name="secret"
        )
        session.add_all([foreign_source, foreign_category, foreign_garment])
        await session.flush()
        if link == "concept":
            item.canonical_concept_id = foreign.concept_id
        elif link == "source":
            item.source_identity_id = foreign_source.id
        elif link == "category":
            concept.business_category_id = foreign_category.id
        elif link == "family_garment":
            item.garment_type_id = foreign_garment.id
        else:
            concept.garment_type_id = foreign_garment.id
        await session.commit()
        result = await search(session, shop)
        assert len(result["items"]) == 1
        assert result["items"][0]["concept_name"] == "Лоран"
        assert str(foreign.concept_id) not in str(result) and "SECRET" not in str(result)


@pytest.mark.parametrize("inactive", ["family", "concept"])
async def test_inactive_identity_is_excluded(maker, inactive):
    async with maker() as session:
        shop = await make_shop(session)
        item, concept = await family(session, shop)
        if inactive == "family":
            item.status = EntityStatus.NEEDS_REVIEW
        else:
            concept.status = EntityStatus.NEEDS_REVIEW
        await session.commit()
        assert len((await search(session, shop))["items"]) == 1


async def test_api_permissions_store_and_input_validation(maker):
    async with maker() as session:
        shop, foreign = await make_shop(session), await make_shop(session)
    url = "/api/v1/catalog/families"
    params = {"store_id": str(shop.store_id)}
    for permissions in ({Permission.CATALOG_CREATE}, {Permission.CATALOG_CONFIRM}):
        async with api(maker, shop.scope(frozenset(permissions))) as client:
            assert (await client.get(url, params=params)).status_code == 403
    async with api(maker, scope(shop)) as client:
        result = await client.get(url, params=params)
        assert result.status_code == 200, result.text
        assert len(result.json()["items"]) == 1
        assert (
            await client.get(url, params={"store_id": str(foreign.store_id)})
        ).status_code == 403
        for invalid in (
            {"query": "\x00"},
            {"query": "x" * 201},
            {"limit": 51},
            {"offset": 10001},
            {"limit": 0},
            {"offset": -1},
        ):
            assert (await client.get(url, params=params | invalid)).status_code == 422
    async with maker() as session:
        await session.execute(
            update(Store).where(Store.id == shop.store_id).values(state=StoreState.BLOCKED)
        )
        await session.commit()
    async with api(maker, scope(shop)) as client:
        assert (await client.get(url, params=params)).status_code == 404


async def test_direct_service_rejects_invalid_query_and_pagination(maker):
    async with maker() as session:
        shop = await make_shop(session)
        for invalid in (
            {"query": "\ud800"},
            {"query": "\x00"},
            {"query": "x" * 201},
            {"limit": 0},
            {"offset": -1},
        ):
            with pytest.raises(ValidationFailedError):
                await search(session, shop, **invalid)


async def test_name_casefold_and_duplicate_family_identity_are_preserved(maker):
    async with maker() as session:
        shop = await make_shop(session)
        first, concept = await family(session, shop, name="Straße")
        second = ProductFamily(
            organization_id=shop.organization_id,
            canonical_concept_id=concept.id,
            distinction_note="Другий крій",
        )
        session.add(second)
        await session.commit()
        result = await search(session, shop, query="  STRASSE  ")
        assert [row["family_id"] for row in result["items"]] == sorted([first.id, second.id])
        assert len(result["items"]) == 2
