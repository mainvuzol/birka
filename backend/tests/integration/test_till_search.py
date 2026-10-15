"""The till's list of what a warehouse holds: by name, and a search (redesign P0-2).

The till could only page through a warehouse in the order of its ids, a
hundred rows at a time, with one model's sizes scattered among the others.
Now the list reads by the model's name, its sizes together in the order
receiving reads them, and a few letters of the name or the colour narrow it,
as receiving's own search does. What the till may see is unchanged.
"""

from __future__ import annotations

import os
import re
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.main import create_app
from app.modules.authz.permissions import Permission
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    CanonicalConcept,
    EntityStatus,
    ProductFamily,
    ProductVariant,
    Size,
    SourceIdentity,
    SourceSemanticType,
)
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import MovementRequest, apply_movements
from tests.conftest import requires_database
from tests.integration.test_sale_command import Shop, make_shop

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = frozenset({Permission.INVENTORY_VIEW, Permission.SALE_CREATE})


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@asynccontextmanager
async def client_for(maker, shop: Shop, permissions=SELLER):
    app = create_app(Settings(app_env="local", session_secret="till-search-secret-32-bytes-long!"))

    async def sessions():
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    app.dependency_overrides[get_current_scope] = lambda: shop.scope(permissions)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://till"
    ) as client:
        yield client


async def a_model(
    maker,
    shop: Shop,
    name: str,
    colour: str | None = None,
    *,
    source: str | None = None,
    status: EntityStatus = EntityStatus.ACTIVE,
    merged_into: uuid.UUID | None = None,
) -> uuid.UUID:
    """A model of the shop's, in a family of its own, with a colour if named.

    A name the shop already has is the same model name, as in the catalogue.
    """
    async with maker() as session:
        concept = await session.scalar(
            select(CanonicalConcept).where(
                CanonicalConcept.organization_id == shop.organization_id,
                CanonicalConcept.normalized_name == name.casefold(),
            )
        )
        if concept is None:
            concept = CanonicalConcept(
                organization_id=shop.organization_id, name=name, normalized_name=name.casefold()
            )
            session.add(concept)
        source_id = None
        if source is not None:
            identity = SourceIdentity(
                organization_id=shop.organization_id,
                name=source,
                normalized_name=source.casefold(),
                semantic_type=SourceSemanticType.UNKNOWN,
            )
            session.add(identity)
            await session.flush()
            source_id = identity.id
        colour_id = None
        if colour is not None:
            term = AttributeTerm(
                organization_id=shop.organization_id,
                kind=AttributeKind.COLOR,
                name=colour,
                normalized_name=colour.casefold(),
            )
            session.add(term)
            await session.flush()
            colour_id = term.id
        await session.flush()
        family = ProductFamily(
            organization_id=shop.organization_id,
            canonical_concept_id=concept.id,
            source_identity_id=source_id,
        )
        session.add(family)
        await session.flush()
        variant = ProductVariant(
            product_family_id=family.id,
            color_term_id=colour_id,
            length_cm=70,
            status=status,
            merged_into_id=merged_into,
        )
        session.add(variant)
        await session.commit()
        return variant.id


async def sizes(maker, shop: Shop, *codes: str, unknown: str | None = None) -> dict[str, uuid.UUID]:
    """The shop's sizes by code, adding those it lacks; `unknown` is "size not known"."""
    async with maker() as session:
        system_id = await session.scalar(select(Size.size_system_id).where(Size.id == shop.size_id))
        known = dict(
            (
                await session.execute(
                    select(Size.code, Size.id).where(Size.size_system_id == system_id)
                )
            )
            .tuples()
            .all()
        )
        for code in codes:
            if code not in known:
                size = Size(size_system_id=system_id, code=code)
                session.add(size)
                await session.flush()
                known[code] = size.id
        if unknown is not None and unknown not in known:
            size = Size(size_system_id=system_id, code=unknown, is_unknown=True)
            session.add(size)
            await session.flush()
            known[unknown] = size.id
        await session.commit()
        return known


async def stock(
    maker,
    shop: Shop,
    variant_id: uuid.UUID,
    held: dict[uuid.UUID, int],
    how: MovementType = MovementType.DELIVERY,
) -> None:
    async with maker() as session:
        await apply_movements(
            session,
            organization_id=shop.organization_id,  # type: ignore[arg-type]
            requests=[
                MovementRequest(
                    location_id=shop.location_id,  # type: ignore[arg-type]
                    acting_store_id=shop.store_id,  # type: ignore[arg-type]
                    product_variant_id=variant_id,
                    size_id=size_id,
                    quantity_delta=quantity,
                    movement_type=how,
                )
                for size_id, quantity in held.items()
            ],
        )
        await session.commit()


async def listed(client, shop: Shop, query: str | None = None, **params) -> httpx.Response:
    asked = {"store_id": str(shop.store_id), "location_id": str(shop.location_id), **params}
    if query is not None:
        asked["query"] = query
    return await client.get("/api/v1/catalog/stock-options", params=asked)


def rows(response: httpx.Response) -> list[tuple[str, str]]:
    """Each row's model and size; every coat here is 70 cm, and its length is left out."""
    assert response.status_code == 200, response.text
    return [
        (re.sub(r" [\d.]+ см$", "", item["display_name"]), item["size_label"])
        for item in response.json()["items"]
    ]


async def test_a_few_letters_find_the_model_and_nothing_else(maker):
    async with maker() as session:
        shop = await make_shop(session)  # «Лоран шоколад», size M
    milan = await a_model(maker, shop, "Мілан", "бордо")
    m = (await sizes(maker, shop, "M"))["M"]
    await stock(maker, shop, shop.variant_id, {m: 2})
    await stock(maker, shop, milan, {m: 1})
    async with client_for(maker, shop) as client:
        found = await listed(client, shop, "лор")
        capitals = await listed(client, shop, "ЛОР")
        nothing = await listed(client, shop, "зима")
    assert [name for name, _ in rows(found)] == ["Лоран шоколад"]
    assert rows(capitals) == rows(found)
    assert rows(nothing) == []
    assert nothing.json()["has_more"] is False


async def test_every_word_must_match_the_model_the_source_or_the_colour(maker):
    async with maker() as session:
        shop = await make_shop(session)
    black = await a_model(maker, shop, "Лоран", "чорний", source="Belardi")
    m = (await sizes(maker, shop, "M"))["M"]
    await stock(maker, shop, shop.variant_id, {m: 2})
    await stock(maker, shop, black, {m: 1})
    async with client_for(maker, shop) as client:
        both = await listed(client, shop, "лоран")
        chocolate = await listed(client, shop, "  лоран   ШОКОЛАД ")
        by_colour = await listed(client, shop, "чорн")
        by_source = await listed(client, shop, "belar лор")
        neither = await listed(client, shop, "лоран бордо")
    assert len(rows(both)) == 2
    assert [name for name, _ in rows(chocolate)] == ["Лоран шоколад"]
    assert [name for name, _ in rows(by_colour)] == ["Лоран Belardi чорний"]
    assert rows(by_source) == rows(by_colour)
    assert rows(neither) == []


async def test_wildcards_typed_by_a_person_are_literal(maker):
    async with maker() as session:
        shop = await make_shop(session)
    m = (await sizes(maker, shop, "M"))["M"]
    await stock(maker, shop, shop.variant_id, {m: 2})
    percent = await a_model(maker, shop, "Знижка 50%", "сірий")
    await stock(maker, shop, percent, {m: 1})
    async with client_for(maker, shop) as client:
        any_text = await listed(client, shop, "%")
        any_letter = await listed(client, shop, "л_ран")
        fifty = await listed(client, shop, "50%")
    assert [name for name, _ in rows(any_text)] == ["Знижка 50% сірий"]
    assert rows(any_letter) == []
    assert rows(fifty) == rows(any_text)


async def test_a_merged_model_s_old_name_finds_the_model_that_stays(maker):
    """Owner decision, 2026-10-03: searching the old name finds the model that
    stays, as receiving's search does. Its coats are the survivor's."""
    async with maker() as session:
        shop = await make_shop(session)
    await a_model(
        maker, shop, "Ларіса", "сірий", status=EntityStatus.MERGED, merged_into=shop.variant_id
    )
    m = (await sizes(maker, shop, "M"))["M"]
    await stock(maker, shop, shop.variant_id, {m: 2})
    async with client_for(maker, shop) as client:
        old_name = await listed(client, shop, "ларіс")
    assert [name for name, _ in rows(old_name)] == ["Лоран шоколад"]


async def test_the_list_reads_by_name_with_each_model_s_sizes_in_order(maker):
    """Nothing sets a size's order, so by id the list read anyhow."""
    async with maker() as session:
        shop = await make_shop(session)
    known = await sizes(maker, shop, "XL", "S", "M", "L", "46", "42", "44", unknown="?")
    alpaca = await a_model(maker, shop, "Альпака", "беж")
    milan = await a_model(maker, shop, "Мілан", "бордо")
    await stock(maker, shop, milan, {known[code]: 1 for code in ("44", "46", "42")})
    await stock(maker, shop, shop.variant_id, {known[code]: 1 for code in ("XL", "?", "M", "S")})
    await stock(maker, shop, alpaca, {known["L"]: 3})
    async with client_for(maker, shop) as client:
        whole = await listed(client, shop)
        searched = await listed(client, shop, "а")
    assert rows(whole) == [
        ("Альпака беж", "L"),
        ("Лоран шоколад", "S"),
        ("Лоран шоколад", "M"),
        ("Лоран шоколад", "XL"),
        ("Лоран шоколад", "?"),
        ("Мілан бордо", "42"),
        ("Мілан бордо", "44"),
        ("Мілан бордо", "46"),
    ]
    assert whole.json()["items"][4]["size_is_unknown"] is True
    # «а» is in all three names: the same list.
    assert rows(searched) == rows(whole)


async def test_ukrainian_letters_read_in_the_alphabet_s_order(maker):
    """«Ґ», «Є», «І» and «Ї» are outside «а»–«я» in Unicode; the order is the
    database's collation, ICU `uk-UA` in production, CI and Compose."""
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    async with engine.connect() as connection:
        # `datlocprovider` is a one-byte "char", which the driver does not
        # read as a string: cast, or an ICU database looks like none.
        provider = await connection.scalar(
            text("SELECT datlocprovider::text FROM pg_database WHERE datname = current_database()")
        )
    await engine.dispose()
    if provider != "i":
        pytest.skip("this database does not collate by ICU uk-UA, as production does")
    async with maker() as session:
        shop = await make_shop(session)
    m = (await sizes(maker, shop, "M"))["M"]
    await stock(maker, shop, shop.variant_id, {m: 1})  # «Лоран», between «Ї» and «Я»
    for name in ("Яна", "Їжачок", "Ірис", "Жасмин", "Єва", "Ґудзик", "Вега"):
        await stock(maker, shop, await a_model(maker, shop, name), {m: 1})
    async with client_for(maker, shop) as client:
        whole = await listed(client, shop)
    assert [name.split()[0] for name, _ in rows(whole)] == [
        "Вега",
        "Ґудзик",
        "Єва",
        "Жасмин",
        "Ірис",
        "Їжачок",
        "Лоран",
        "Яна",
    ]


async def test_the_pages_neither_repeat_nor_skip_a_row(maker):
    async with maker() as session:
        shop = await make_shop(session)
    known = await sizes(maker, shop, "S", "M", "L")
    for colour in ("бордо", "беж", "графіт"):
        model = await a_model(maker, shop, "Лоран", colour)
        await stock(maker, shop, model, dict.fromkeys(known.values(), 1))
    async with client_for(maker, shop) as client:
        whole = rows(await listed(client, shop, "лоран"))
        pages = []
        for offset in range(0, 9, 4):
            page = await listed(client, shop, "лоран", limit=4, offset=offset)
            pages.extend(rows(page))
            assert page.json()["has_more"] is (offset + 4 < 9)
    assert len(whole) == 9
    assert pages == whole
    # One model's colours read in order, each with its sizes together.
    assert [name for name, _ in whole] == [
        *["Лоран беж"] * 3,
        *["Лоран бордо"] * 3,
        *["Лоран графіт"] * 3,
    ]
    assert [size for _, size in whole] == ["S", "M", "L"] * 3


async def test_a_model_sold_out_is_not_listed(maker):
    async with maker() as session:
        shop = await make_shop(session)
    m = (await sizes(maker, shop, "M"))["M"]
    await stock(maker, shop, shop.variant_id, {m: 1})
    await stock(maker, shop, shop.variant_id, {m: -1}, MovementType.SALE)
    async with client_for(maker, shop) as client:
        found = await listed(client, shop, "лоран")
    assert rows(found) == []


async def test_a_search_reaches_no_further_than_the_list(maker):
    async with maker() as session:
        shop = await make_shop(session)
        other = await make_shop(session)  # another network's «Лоран шоколад»
    m = (await sizes(maker, shop, "M"))["M"]
    await stock(maker, shop, shop.variant_id, {m: 1})
    async with client_for(maker, shop) as client:
        theirs = await listed(client, shop, "лоран", location_id=str(other.location_id))
    async with client_for(maker, shop, frozenset({Permission.SALE_CREATE})) as client:
        no_right = await listed(client, shop, "лоран")
    assert theirs.status_code == 404
    assert no_right.status_code == 403


@pytest.mark.parametrize("query", ["л" * 201, "лор\x00ан"])
async def test_a_search_that_cannot_be_read_is_refused(maker, query):
    async with maker() as session:
        shop = await make_shop(session)
    async with client_for(maker, shop) as client:
        refused = await listed(client, shop, query)
    assert refused.status_code == 422
