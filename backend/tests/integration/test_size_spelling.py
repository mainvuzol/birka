"""One size, one spelling (owner decision, 2026-10-03; ADR-0009).

A size used to be stored as typed, inside its size system, so `M` and `m`,
or `M` under two systems, were two sizes with two balances. The owner
decided which spellings are one size, that a size is shown in one spelling,
and that the size system does not separate sizes.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.api.v1.catalog import ProductResponse
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from app.modules.catalog.models import Size, SizeSystem, SizeSystemCode
from app.modules.catalog.service import ProductDraft, SizeDraft, VariantDraft
from app.modules.catalog.service import create_product as create_product_command
from tests.conftest import requires_database
from tests.integration.test_product_lifecycle_api import (
    Shop,
    api,
    create_product,
    make_shop,
    product_payload,
)
from tests.integration.test_transfer_command import wait_until_blocked_by

pytestmark = [pytest.mark.integration, requires_database()]

MANAGER = DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def unique() -> str:
    # Digits only: letters could fold like another test's, and warn.
    return str(uuid.uuid4().int % 10**9)


async def sized(maker, shop: Shop, *sizes: tuple[str, str]) -> Any:
    """A new model of the shop, made with the sizes as typed."""
    async with api(maker, shop.scope()) as client:
        response = await create_product(
            client,
            product_payload(
                shop,
                concept=f"Модель {unique()}",
                source=None,
                variant={},
                sizes=[{"system": system, "code": code} for system, code in sizes],
            ),
        )
    assert response.status_code == 201, response.text
    return response.json()["sizes"]


async def size_rows(maker, shop: Shop) -> list[tuple[str, SizeSystemCode]]:
    async with maker() as session:
        return [
            (code, system)
            for code, system in (
                await session.execute(
                    select(Size.code, SizeSystem.code)
                    .join(SizeSystem, SizeSystem.id == Size.size_system_id)
                    .where(Size.organization_id == shop.organization_id)
                    .order_by(Size.code)
                )
            ).all()
        ]


# ---------------------------------------------------------------------------
# Spellings that are one size
# ---------------------------------------------------------------------------


async def test_a_size_spelt_another_way_is_the_same_size(maker):
    """ "Case does not matter", and "`М` = `M`": whoever types `м` sees that
    the existing `M` was chosen."""
    shop = await make_shop(maker)
    [first] = await sized(maker, shop, ("ALPHA", "M"))
    assert (first["code"], first["created"], first["typed"]) == ("M", True, "M")

    for typed in ("m", "м", "М", " m "):
        [again] = await sized(maker, shop, ("ALPHA", typed))
        assert again["size_id"] == first["size_id"], typed
        assert (again["code"], again["created"], again["typed"]) == ("M", False, typed.strip())
    assert await size_rows(maker, shop) == [("M", SizeSystemCode.ALPHA)]


async def test_a_size_typed_under_another_system_is_the_existing_one(maker):
    """ "The size system does not separate sizes. `M` is one size whichever
    system was picked." The answer is the existing size, in its own system."""
    shop = await make_shop(maker)
    [first] = await sized(maker, shop, ("ALPHA", "M"))
    for system, typed in (("UNSPECIFIED", "m"), ("NUMERIC_EU", "M")):
        [again] = await sized(maker, shop, (system, typed))
        assert again["size_id"] == first["size_id"], system
        assert (again["system"], again["code"], again["created"]) == ("ALPHA", "M", False)
    assert await size_rows(maker, shop) == [("M", SizeSystemCode.ALPHA)]


async def test_a_count_of_xs_is_written_out(maker):
    """ "`2XL` = `XXL` … for every size with a count", and the owner's
    follow-up: `1XL` is `XL`. Shown with the X's written out."""
    shop = await make_shop(maker)
    [xxl] = await sized(maker, shop, ("ALPHA", "2XL"))
    assert (xxl["code"], xxl["created"]) == ("XXL", True)
    for typed in ("XXL", "ххл", "2хл", "xxl"):
        [again] = await sized(maker, shop, ("ALPHA", typed))
        assert again["size_id"] == xxl["size_id"], typed
    [xl] = await sized(maker, shop, ("ALPHA", "1XL"))
    [same] = await sized(maker, shop, ("ALPHA", "хл"))
    assert xl["code"] == "XL"
    assert same["size_id"] == xl["size_id"]


async def test_a_double_size_ignores_spaces_and_dashes_but_not_a_slash(maker):
    """ "Spaces and the kind of dash do not matter: `46-48` = `46 - 48` =
    `46–48`. `46/48` is another size." """
    shop = await make_shop(maker)
    [dash] = await sized(maker, shop, ("NUMERIC_EU", "46 – 48"))
    assert dash["code"] == "46-48"
    [again] = await sized(maker, shop, ("NUMERIC_EU", "46-48"))
    assert again["size_id"] == dash["size_id"]
    [slash] = await sized(maker, shop, ("NUMERIC_EU", "46 / 48"))
    assert slash["code"] == "46/48"
    assert slash["size_id"] != dash["size_id"]


async def test_a_cyrillic_word_size_is_case_blind_and_keeps_its_first_spelling(maker):
    """A word keeps the letters it was first typed with; its case does not
    matter either (how it is carried out)."""
    shop = await make_shop(maker)
    [word] = await sized(maker, shop, ("UNSPECIFIED", "Єдиний"))
    [again] = await sized(maker, shop, ("ALPHA", "єдиний"))
    assert again["size_id"] == word["size_id"]
    assert (again["code"], again["system"], again["typed"]) == ("Єдиний", "UNSPECIFIED", "єдиний")


async def test_latin_letters_are_capitals_in_every_size(maker):
    shop = await make_shop(maker)
    [one] = await sized(maker, shop, ("UNSPECIFIED", "one size"))
    [bracket] = await sized(maker, shop, ("NUMERIC_EU", "48 (м)"))
    assert (one["code"], bracket["code"]) == ("ONE SIZE", "48 (M)")
    [again] = await sized(maker, shop, ("NUMERIC_EU", "48 (m)"))
    assert again["size_id"] == bracket["size_id"]


async def test_two_spellings_of_one_size_in_one_request_are_one_size(maker):
    shop = await make_shop(maker)
    sizes = await sized(maker, shop, ("ALPHA", "M"), ("UNSPECIFIED", "м"), ("ALPHA", "L"))
    assert [(size["code"], size["typed"]) for size in sizes] == [("M", "M"), ("L", "L")]


async def test_another_organizations_size_is_never_taken(maker):
    first, second = await make_shop(maker), await make_shop(maker)
    [theirs] = await sized(maker, first, ("ALPHA", "M"))
    [ours] = await sized(maker, second, ("UNSPECIFIED", "m"))
    assert ours["size_id"] != theirs["size_id"]
    assert (ours["code"], ours["system"], ours["created"]) == ("M", "UNSPECIFIED", True)


@pytest.mark.parametrize(
    ("system", "typed"),
    [
        ("ALPHA", "unknown"),
        ("NUMERIC_EU", "UNKNOWN"),
        ("UNSPECIFIED", "Unknown"),
        # Full-width letters spell `UNKNOWN` too.
        ("UNSPECIFIED", "ＵＮＫＮＯＷＮ"),
    ],
)
async def test_unknown_is_reserved_in_every_system(maker, system, typed):
    """A system no longer separates sizes, so `UNKNOWN` under any of them
    would be the "size not known" only a legacy stock list states."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        response = await create_product(
            client, product_payload(shop, sizes=[{"system": system, "code": typed}])
        )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert "reserved" in response.json()["message"]
    assert await size_rows(maker, shop) == []


@pytest.mark.parametrize("typed", ["9XL-9XL", "20XL", "999999999999999999XL"])
async def test_a_spelling_longer_than_the_column_is_refused(maker, typed):
    """`9XL-9XL` is seven letters typed and twenty-one written out: refused
    as a name that grows when normalized is, never a 500. A count of a
    billion X's is refused the same way, without writing them out."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        response = await create_product(
            client, product_payload(shop, sizes=[{"system": "ALPHA", "code": typed}])
        )
    assert response.status_code == 422, response.text
    assert response.json()["message"] == ("Written out, this size is longer than 20 characters")
    assert response.json()["details"]["code"] == typed
    assert len(response.content) < 1000
    assert await size_rows(maker, shop) == []


# ---------------------------------------------------------------------------
# What the person sees
# ---------------------------------------------------------------------------


async def test_the_list_reads_letter_sizes_first_whatever_their_system(maker):
    """ADR-0009 §3: a seller who picked «Інша» for `M` does not put the
    shop's `M` after the numbers for good."""
    shop = await make_shop(maker)
    await sized(
        maker,
        shop,
        ("UNSPECIFIED", "m"),
        ("NUMERIC_EU", "46"),
        ("ALPHA", "xl"),
        ("UNSPECIFIED", "Єдиний"),
        ("ALPHA", "s"),
        ("NUMERIC_EU", "44"),
        # Read as a number, 8 comes before 44; as text, after it.
        ("NUMERIC_EU", "8"),
        ("ALPHA", "L"),
        ("UNSPECIFIED", "2XS"),
        # A digit `int()` cannot read sorts with the words.
        ("NUMERIC_EU", "\u1369"),
    )
    async with api(maker, shop.scope(MANAGER)) as client:
        response = await client.get(
            "/api/v1/catalog/sizes", params={"store_id": str(shop.store_id)}
        )
    assert response.status_code == 200, response.text
    assert [size["code"] for size in response.json()] == [
        "XXS",
        "S",
        "M",
        "L",
        "XL",
        "8",
        "44",
        "46",
        "\u1369",
        "Єдиний",
    ]


async def test_a_decision_keeps_how_the_size_was_typed(maker):
    """«Створити товар з опису» reads the decision's stored creation, so
    `typed` is kept with it (ADR-0009 §3)."""
    shop = await make_shop(maker)
    await sized(maker, shop, ("ALPHA", "M"))
    async with api(maker, shop.scope()) as client:
        proposed = await client.post(
            "/api/v1/catalog/match-decisions",
            json={
                "decision_id": str(uuid.uuid4()),
                "store_id": str(shop.store_id),
                "raw_text": "куртка нова",
            },
        )
        assert proposed.status_code == 200, proposed.text
        decision = proposed.json()["decision_id"]
        created = await client.post(
            f"/api/v1/catalog/match-decisions/{decision}/create-product",
            json={
                "store_id": str(shop.store_id),
                "concept": f"Модель {unique()}",
                "sizes": [{"system": "UNSPECIFIED", "code": "м"}],
            },
        )
        assert created.status_code == 200, created.text
        read = await client.get(f"/api/v1/catalog/match-decisions/{decision}")
    for body in (created.json(), read.json()):
        [size] = body["creation"]["sizes"]
        assert (size["code"], size["system"], size["typed"]) == ("M", "ALPHA", "м")


def test_an_answer_stored_before_the_spelling_still_reads():
    """A creation stored with a decision, or a reply cached for a repeated
    request, from before `typed` existed."""
    body = {
        "product_family_id": str(uuid.uuid4()),
        "product_variant_id": str(uuid.uuid4()),
        "canonical_concept_id": str(uuid.uuid4()),
        "source_identity_id": None,
        "business_category_id": None,
        "garment_type_id": None,
        "display_name": "Лоран",
        "sizes": [{"size_id": str(uuid.uuid4()), "system": "ALPHA", "code": "M", "created": False}],
        "family_created": False,
        "variant_created": False,
    }
    assert ProductResponse.model_validate(body).sizes[0].typed is None


# ---------------------------------------------------------------------------
# What the database itself keeps
# ---------------------------------------------------------------------------


async def _system(maker, shop: Shop, code: SizeSystemCode) -> uuid.UUID:
    async with maker() as session:
        system = SizeSystem(organization_id=shop.organization_id, code=code, name=code.value)
        session.add(system)
        await session.commit()
        return system.id


async def test_the_database_fills_a_sizes_organization_from_its_system(maker):
    shop = await make_shop(maker)
    system = await _system(maker, shop, SizeSystemCode.ALPHA)
    async with maker() as session:
        size = Size(size_system_id=system, code="M")
        session.add(size)
        await session.commit()
        assert size.organization_id == shop.organization_id


async def test_the_database_refuses_a_size_outside_its_systems_organization(maker):
    shop, other = await make_shop(maker), await make_shop(maker)
    system = await _system(maker, shop, SizeSystemCode.ALPHA)
    elsewhere = await _system(maker, other, SizeSystemCode.ALPHA)
    async with maker() as session:
        session.add(Size(size_system_id=system, organization_id=other.organization_id, code="M"))
        with pytest.raises(DBAPIError, match="organization of its size system"):
            await session.flush()
    async with maker() as session:
        size = Size(size_system_id=system, code="L")
        session.add(size)
        await session.commit()
    for change in ({"size_system_id": elsewhere}, {"organization_id": other.organization_id}):
        async with maker() as session:
            with pytest.raises(DBAPIError, match="never moves"):
                await session.execute(update(Size).where(Size.id == size.id).values(**change))


async def test_the_database_keeps_one_size_per_spelling_across_systems(maker):
    """Whatever writes a size, `uq_size_org_spelling` holds: one ordinary
    size per `lower(code)` in an organization. "Size not known" stays
    outside it."""
    shop = await make_shop(maker)
    alpha = await _system(maker, shop, SizeSystemCode.ALPHA)
    other = await _system(maker, shop, SizeSystemCode.UNSPECIFIED)
    async with maker() as session:
        session.add(Size(size_system_id=alpha, code="M"))
        await session.commit()
    async with maker() as session:
        session.add(Size(size_system_id=other, code="m"))
        with pytest.raises(IntegrityError, match="uq_size_org_spelling"):
            await session.flush()
    async with maker() as session:
        session.add_all(
            [
                Size(size_system_id=other, code="UNKNOWN", is_unknown=True),
                Size(size_system_id=alpha, code="UNKNOWN", is_unknown=True),
            ]
        )
        await session.commit()


# ---------------------------------------------------------------------------
# Two people at once
# ---------------------------------------------------------------------------


async def test_one_new_size_typed_at_once_under_two_systems_is_one_size(maker, engine):
    """The insert arbitrates on every unique key (ADR-0009 §2): the second
    seller waits on the first one's uncommitted `M`, then takes it. A named
    conflict target would leave the spelling's key to raise a 500.

    Both add a size to a model that exists, so neither writes anything else
    the other could wait on: the wait is on the size itself."""
    shop = await make_shop(maker)
    async with api(maker, shop.scope()) as client:
        made = await create_product(
            client,
            product_payload(
                shop, variant={"color": "чорний"}, sizes=[{"system": "ALPHA", "code": "L"}]
            ),
        )
    assert made.status_code == 201, made.text
    family = uuid.UUID(made.json()["product_family_id"])

    def draft(system: SizeSystemCode, code: str) -> ProductDraft:
        return ProductDraft(
            product_family_id=family,
            variant=VariantDraft(color="чорний"),
            sizes=(SizeDraft(system=system, code=code),),
        )

    async def second() -> Any:
        async with maker() as session:
            result = await create_product_command(
                session,
                organization_id=shop.organization_id,
                actor_user_id=shop.user_id,
                draft=draft(SizeSystemCode.UNSPECIFIED, "м"),
            )
            await session.commit()
            return result

    async with maker() as holder:
        first = await create_product_command(
            holder,
            organization_id=shop.organization_id,
            actor_user_id=shop.user_id,
            draft=draft(SizeSystemCode.ALPHA, "M"),
        )
        pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        racer = asyncio.create_task(second())
        await wait_until_blocked_by(engine, pid)
        await holder.commit()
        outcome = await asyncio.wait_for(racer, timeout=10)

    [mine], [theirs] = first.sizes, outcome.sizes
    assert mine.created
    assert theirs.size_id == mine.size_id
    assert (theirs.code, theirs.system, theirs.created, theirs.typed) == (
        "M",
        SizeSystemCode.ALPHA,
        False,
        "м",
    )
    assert await size_rows(maker, shop) == [
        ("L", SizeSystemCode.ALPHA),
        ("M", SizeSystemCode.ALPHA),
    ]


@pytest.mark.parametrize("failures", [1, 3])
async def test_a_creation_that_deadlocks_is_retried_whole(maker, monkeypatch, failures):
    """Sizes of two systems, or two spellings, now meet on one key, so a
    creation can deadlock with another one. It is retried whole, as creating
    from a decision is; the third time it says to retry."""
    from app.api.v1 import catalog as route

    shop = await make_shop(maker)
    real = route.create_product
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

    monkeypatch.setattr(route, "create_product", transient)
    async with api(maker, shop.scope()) as client:
        response = await create_product(
            client,
            product_payload(
                shop,
                concept=f"Модель {unique()}",
                source=None,
                variant={},
                sizes=[{"system": "UNSPECIFIED", "code": "м"}],
            ),
        )
    assert calls == min(failures + 1, 3)
    if failures == 1:
        assert response.status_code == 201, response.text
        assert await size_rows(maker, shop) == [("M", SizeSystemCode.UNSPECIFIED)]
    else:
        assert response.status_code == 409, response.text
        assert response.json()["details"]["retryable"] is True
        assert await size_rows(maker, shop) == []
