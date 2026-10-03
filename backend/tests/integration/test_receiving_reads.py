"""What the back door may offer: the catalogue, not the shelf.

The till searches stock because it can only sell what a warehouse holds. A
delivery is usually of something the shop has run out of — or of a model
nothing has been sold of yet — so a receiving screen built on `stock-options`
could never offer it. These two reads exist for that, and these tests pin
what they may and may not show.
"""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.main import create_app
from app.modules.authz.permissions import Permission
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    EntityStatus,
    ProductVariant,
    Size,
    SizeSystemCode,
)
from app.modules.catalog.read import SizeOption, _reading_order
from tests.conftest import requires_database
from tests.integration.test_sale_command import make_shop

pytestmark = [pytest.mark.integration, requires_database()]

RECEIVER = frozenset({Permission.INVENTORY_RECEIVE})


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@asynccontextmanager
async def client_for(maker, shop, permissions=RECEIVER):
    app = create_app(Settings(app_env="local", session_secret="receiving-reads-secret-32-bytes!"))

    async def sessions():
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    app.dependency_overrides[get_current_scope] = lambda: shop.scope(permissions)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://back-door"
    ) as client:
        yield client


async def add_variant(
    maker, shop, colour: str, *, status=EntityStatus.ACTIVE, merged_into=None
) -> uuid.UUID:
    """Another colour of the shop's model, in the same family."""
    async with maker() as session:
        family_id = await session.scalar(
            select(ProductVariant.product_family_id).where(ProductVariant.id == shop.variant_id)
        )
        term = AttributeTerm(
            organization_id=shop.organization_id,
            kind=AttributeKind.COLOR,
            name=colour,
            normalized_name=colour.casefold(),
        )
        session.add(term)
        await session.flush()
        variant = ProductVariant(
            product_family_id=family_id,
            color_term_id=term.id,
            length_cm=70,
            status=status,
            merged_into_id=merged_into,
        )
        session.add(variant)
        await session.commit()
        return variant.id


async def add_sizes(maker, shop, *codes: str, unknown: str | None = None) -> None:
    async with maker() as session:
        system_id = await session.scalar(select(Size.size_system_id).where(Size.id == shop.size_id))
        session.add_all([Size(size_system_id=system_id, code=code) for code in codes])
        if unknown:
            session.add(Size(size_system_id=system_id, code=unknown, is_unknown=True))
        await session.commit()


async def search(client, shop, query="", **params):
    return await client.get(
        "/api/v1/catalog/receivable-variants",
        params={"store_id": str(shop.store_id), "query": query, **params},
    )


async def test_a_model_the_shop_holds_none_of_can_still_be_received(maker):
    """The whole reason this read exists."""
    async with maker() as session:
        shop = await make_shop(session)  # a variant, and no stock of it at all
    async with client_for(maker, shop, RECEIVER | {Permission.INVENTORY_VIEW}) as client:
        shelf = await client.get(
            "/api/v1/catalog/stock-options",
            params={"store_id": str(shop.store_id), "location_id": str(shop.location_id)},
        )
        catalogue = await search(client, shop)
    assert shelf.status_code == 200
    assert shelf.json()["items"] == []
    assert catalogue.status_code == 200, catalogue.text
    assert [item["product_variant_id"] for item in catalogue.json()["items"]] == [
        str(shop.variant_id)
    ]
    assert catalogue.json()["items"][0]["display_name"].startswith("Лоран шоколад")


async def test_every_word_must_match_the_model_the_source_or_the_colour(maker):
    async with maker() as session:
        shop = await make_shop(session)
    black = await add_variant(maker, shop, "чорний")
    async with client_for(maker, shop) as client:
        both = await search(client, shop, "лоран")
        chocolate = await search(client, shop, "ЛОРАН   Шоколад")
        black_only = await search(client, shop, "чорн")
        neither = await search(client, shop, "лоран бордо")
    assert {item["product_variant_id"] for item in both.json()["items"]} == {
        str(shop.variant_id),
        str(black),
    }
    assert [item["product_variant_id"] for item in chocolate.json()["items"]] == [
        str(shop.variant_id)
    ]
    assert [item["product_variant_id"] for item in black_only.json()["items"]] == [str(black)]
    assert neither.json()["items"] == []


async def test_wildcards_typed_by_a_person_are_literal(maker):
    async with maker() as session:
        shop = await make_shop(session)
    async with client_for(maker, shop) as client:
        percent = await search(client, shop, "%")
        underscore = await search(client, shop, "_")
    assert percent.json()["items"] == []
    assert underscore.json()["items"] == []


async def test_a_merged_variant_leads_to_the_model_that_stays_and_one_in_review_stays(maker):
    """A merged model is gone, and its name finds the model that stays (owner
    decision, 2026-10-03: "searching the old name finds the model that
    stays"). A retired one is no longer offered.

    A coat whose catalogue entry is parked in review is still in the seller's
    hands at the back door; refusing to receive it until review finishes would
    leave real goods off the books.
    """
    async with maker() as session:
        shop = await make_shop(session)
    await add_variant(maker, shop, "сірий", status=EntityStatus.MERGED, merged_into=shop.variant_id)
    in_review = await add_variant(maker, shop, "пудра", status=EntityStatus.NEEDS_REVIEW)
    await add_variant(maker, shop, "оливка", status=EntityStatus.RETIRED)
    async with client_for(maker, shop) as client:
        merged = await search(client, shop, "сір")
        reviewed = await search(client, shop, "пудр")
        retired = await search(client, shop, "олив")
    assert [item["product_variant_id"] for item in merged.json()["items"]] == [str(shop.variant_id)]
    assert [item["product_variant_id"] for item in reviewed.json()["items"]] == [str(in_review)]
    assert retired.json()["items"] == []


async def test_another_organization_s_catalogue_is_invisible(maker):
    async with maker() as session:
        ours = await make_shop(session)
        theirs = await make_shop(session)  # also a "Лоран шоколад"
    async with client_for(maker, ours) as client:
        found = await search(client, ours, "лоран")
    assert [item["product_variant_id"] for item in found.json()["items"]] == [str(ours.variant_id)]
    assert str(theirs.variant_id) not in found.text


async def test_the_search_pages_without_repeating_itself(maker):
    async with maker() as session:
        shop = await make_shop(session)
    for colour in ("бордо", "беж", "графіт", "хакі"):
        await add_variant(maker, shop, colour)
    async with client_for(maker, shop) as client:
        first = await search(client, shop, "лоран", limit=3)
        second = await search(client, shop, "лоран", limit=3, offset=3)
    assert first.json()["has_more"] is True
    assert second.json()["has_more"] is False
    ids = [item["product_variant_id"] for item in first.json()["items"] + second.json()["items"]]
    assert len(ids) == len(set(ids)) == 5


@pytest.mark.parametrize("path", ["/api/v1/catalog/receivable-variants", "/api/v1/catalog/sizes"])
async def test_both_reads_need_the_right_to_receive(maker, path):
    async with maker() as session:
        shop = await make_shop(session)
    async with client_for(maker, shop, frozenset({Permission.INVENTORY_VIEW})) as client:
        refused = await client.get(path, params={"store_id": str(shop.store_id)})
    assert refused.status_code == 403


async def test_sizes_read_in_order_and_never_offer_size_not_known(maker):
    """Nothing sets `sort_order`, so without an order the list read L, M, S, XL, XS."""
    async with maker() as session:
        shop = await make_shop(session)  # already has M
    await add_sizes(maker, shop, "XL", "S", "L", "XS", "46-48", unknown="?")
    async with client_for(maker, shop) as client:
        sizes = await client.get("/api/v1/catalog/sizes", params={"store_id": str(shop.store_id)})
    assert sizes.status_code == 200, sizes.text
    assert [size["code"] for size in sizes.json()] == ["XS", "S", "M", "L", "XL", "46-48"]
    assert all(size["system"] == "ALPHA" for size in sizes.json())


def test_an_owner_s_sort_order_outranks_the_reading_order() -> None:
    """If someone ever sets `sort_order`, it wins; the sequence is only a default."""

    def option(code: str, sort_order: int = 0) -> SizeOption:
        return SizeOption(
            size_id=uuid.uuid4(), code=code, system=SizeSystemCode.ALPHA, sort_order=sort_order
        )

    ordered = sorted([option("S"), option("XL", sort_order=-1), option("M")], key=_reading_order)
    assert [o.code for o in ordered] == ["XL", "S", "M"]
    numeric = [
        SizeOption(size_id=uuid.uuid4(), code=c, system=SizeSystemCode.NUMERIC_EU, sort_order=0)
        for c in ("48", "100", "36")
    ]
    assert [o.code for o in sorted(numeric, key=_reading_order)] == ["36", "48", "100"]
