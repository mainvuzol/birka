"""Direct catalog changes invalidate decisions in the same transaction."""

import os

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.modules.catalog.evidence import AliasTargetType, ProductAlias
from app.modules.catalog.knowledge import lock_knowledge_revision
from app.modules.catalog.matching import preview_match
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    BusinessCategory,
    CanonicalConcept,
    CatalogKnowledgeRevision,
    GarmentType,
    ProductFamily,
    ProductVariant,
    SourceIdentity,
)
from tests.conftest import requires_database
from tests.integration.test_sale_command import make_shop

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def revision(session, org):
    return await session.scalar(
        select(CatalogKnowledgeRevision.revision).where(
            CatalogKnowledgeRevision.organization_id == org
        )
    )


async def fresh_row(session, shop, kind):
    shared = {"organization_id": shop.organization_id, "name": "new", "normalized_name": "new"}
    if kind is AttributeTerm:
        return kind(**shared, kind=AttributeKind.MATERIAL), {"name": "changed"}
    if kind is ProductFamily:
        return kind(organization_id=shop.organization_id, canonical_concept_id=shop.concept_id), {
            "distinction_note": "changed"
        }
    if kind is ProductVariant:
        original = await session.get(ProductVariant, shop.variant_id)
        return kind(product_family_id=original.product_family_id), {
            "attributes": {"hood": "absent"}
        }
    if kind is ProductAlias:
        return kind(
            organization_id=shop.organization_id,
            normalized_phrase="new",
            target_type=AliasTargetType.VARIANT,
            target_id=shop.variant_id,
        ), {"normalized_phrase": "changed"}
    return kind(**shared), {"name": "changed"}


@pytest.mark.parametrize(
    "kind",
    [
        BusinessCategory,
        GarmentType,
        CanonicalConcept,
        SourceIdentity,
        AttributeTerm,
        ProductFamily,
        ProductVariant,
        ProductAlias,
    ],
)
async def test_every_matching_input_insert_update_delete_invalidates(maker, kind):
    async with maker() as session:
        shop = await make_shop(session)
        before = await revision(session, shop.organization_id)
        row, changes = await fresh_row(session, shop, kind)
        session.add(row)
        await session.flush()
        assert await revision(session, shop.organization_id) == before + 1
        await session.execute(update(kind).where(kind.id == row.id).values(**changes))
        assert await revision(session, shop.organization_id) == before + 2
        await session.delete(row)
        await session.flush()
        assert await revision(session, shop.organization_id) == before + 3
        await session.rollback()
        assert await revision(session, shop.organization_id) == before


async def test_family_tenant_move_and_variant_reassignment_invalidate_both_orgs(maker):
    async with maker() as session:
        first = await make_shop(session)
        second = await make_shop(session)
        row = ProductFamily(
            organization_id=first.organization_id, canonical_concept_id=first.concept_id
        )
        session.add(row)
        await session.flush()
        a = await revision(session, first.organization_id)
        b = await revision(session, second.organization_id)
        row.organization_id = second.organization_id
        row.canonical_concept_id = second.concept_id
        await session.flush()
        assert await revision(session, first.organization_id) == a + 1
        assert await revision(session, second.organization_id) == b + 1
        original = await session.get(ProductVariant, first.variant_id)
        original.product_family_id = row.id
        await session.flush()
        assert await revision(session, first.organization_id) == a + 2
        assert await revision(session, second.organization_id) == b + 2
        result = await preview_match(
            session, organization_id=second.organization_id, raw_text="new"
        )
        assert result.knowledge_revision == b + 2


async def test_confirmation_share_lock_blocks_catalog_write_until_release(maker):
    async with maker() as setup:
        shop = await make_shop(setup)
    async with maker() as confirmation, maker() as writer:
        before = await lock_knowledge_revision(confirmation, shop.organization_id)
        await writer.execute(text("SET LOCAL lock_timeout = '100ms'"))
        with pytest.raises(DBAPIError) as caught:
            await writer.execute(
                update(CanonicalConcept)
                .where(CanonicalConcept.id == shop.concept_id)
                .values(name="blocked change")
            )
        assert caught.value.orig.sqlstate == "55P03"
        await writer.rollback()
        assert await revision(confirmation, shop.organization_id) == before
        await confirmation.commit()
        await writer.execute(
            update(CanonicalConcept)
            .where(CanonicalConcept.id == shop.concept_id)
            .values(name="committed change")
        )
        await writer.commit()
        assert await lock_knowledge_revision(confirmation, shop.organization_id) == before + 1
