"""Catalog distinctions survive both receipt creation and later catalog edits."""

import copy
import os
from dataclasses import replace

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.modules.catalog.models import AttributeKind, AttributeTerm, ProductVariant
from app.modules.catalog.read import describe_variants
from app.modules.sales.models import SaleItem
from app.modules.sales.service import FoundInStore
from tests.conftest import requires_database
from tests.integration.test_sale_command import basket, make_shop, sell

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.mark.parametrize(
    "field,kind",
    [
        ("texture", AttributeKind.TEXTURE),
        ("fur", AttributeKind.FUR),
        ("collar", AttributeKind.COLLAR),
    ],
)
async def test_variant_distinctions_are_frozen_in_sale(field, kind):
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with maker() as session:
            shop = await make_shop(session)
            original = await session.get(ProductVariant, shop.variant_id)
            first = AttributeTerm(
                organization_id=shop.organization_id,
                kind=kind,
                name="перший",
                normalized_name="перший",
            )
            second = AttributeTerm(
                organization_id=shop.organization_id,
                kind=kind,
                name="другий",
                normalized_name="другий",
            )
            session.add_all([first, second])
            await session.flush()
            setattr(original, f"{field}_term_id", first.id)
            other = ProductVariant(
                product_family_id=original.product_family_id,
                color_term_id=original.color_term_id,
                length_cm=original.length_cm,
                **{f"{field}_term_id": second.id},
            )
            session.add(other)
            await session.flush()
            descriptions = await describe_variants(session, [original.id, other.id])
            assert descriptions[original.id].display_name != descriptions[other.id].display_name
            result = await sell(
                session,
                shop,
                lines=[*basket(shop), replace(basket(shop)[0], product_variant_id=other.id)],
                found_in_store=[FoundInStore(0, 1), FoundInStore(1, 1)],
            )
            await session.commit()
            frozen = [
                (item.id, item.display_name_snapshot, copy.deepcopy(item.variant_snapshot))
                for item in result.items
            ]
            assert frozen[0][2][field] == "перший"
            assert frozen[0][2][f"{field}_id"] == str(first.id)
            assert frozen[0][2]["product_family_id"] == str(original.product_family_id)
            first.name = "перейменовано"
            second.name = "інша назва"
            await session.commit()
        async with maker() as session:
            for item_id, name, snapshot in frozen:
                item = await session.get(SaleItem, item_id)
                assert item.display_name_snapshot == name
                assert item.variant_snapshot == snapshot
    finally:
        await engine.dispose()
