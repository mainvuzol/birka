"""M1B schema behaviour against a real PostgreSQL.

The parity test proves the migration says what the models say. These prove the
database actually *does* what those words promise — triggers fire, CHECKs
reject, and the ADR-0002 identity rules hold in both directions.

Runs in CI against PostgreSQL 17; skips loudly without a database.
"""

from __future__ import annotations

import os
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.modules.catalog.evidence import RawInput, RawInputSource
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    CanonicalConcept,
    ProductFamily,
    ProductVariant,
    Size,
    SizeSystem,
    SizeSystemCode,
    SourceIdentity,
)
from app.modules.inventory.models import (
    Inventory,
    MovementType,
    StockMovement,
)
from app.modules.sales.models import Sale, SaleItem
from app.modules.tenancy.models import Organization, Store, StoreKind
from tests.conftest import requires_database

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def session() -> AsyncSession:
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"], poolclass=None)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
        await s.rollback()
    await engine.dispose()


class Fixture:
    """Minimal but real catalog + store, built once per test."""

    def __init__(self, **kwargs: object) -> None:
        self.__dict__.update(kwargs)


async def build(session: AsyncSession) -> Fixture:
    org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", currency_code="UAH")
    session.add(org)
    await session.flush()

    store = Store(organization_id=org.id, name="A", code="A", kind=StoreKind.PRIMARY)
    concept = CanonicalConcept(organization_id=org.id, name="Лоран", normalized_name="лоран")
    system = SizeSystem(organization_id=org.id, code=SizeSystemCode.ALPHA, name="Alpha")
    session.add_all([store, concept, system])
    await session.flush()

    size = Size(size_system_id=system.id, code="M", sort_order=2)
    unknown_size = Size(size_system_id=system.id, code="UNKNOWN", is_unknown=True)
    session.add_all([size, unknown_size])

    family = ProductFamily(organization_id=org.id, canonical_concept_id=concept.id)
    session.add(family)
    await session.flush()

    variant = ProductVariant(product_family_id=family.id)
    session.add(variant)
    await session.flush()

    return Fixture(
        org=org,
        store=store,
        concept=concept,
        size=size,
        unknown_size=unknown_size,
        family=family,
        variant=variant,
    )


# --- ADR-0002: identity -----------------------------------------------------


async def test_two_families_may_share_a_signature(session: AsyncSession) -> None:
    """The correction that produced revision 2 of the plan.

    `Лоран / Belardi` and a second `Лоран / Belardi` that the business says is a
    different coat must both be storable. A unique constraint on the signature
    would silently merge them — which is the single most expensive failure this
    system can produce.
    """
    f = await build(session)

    session.add(
        ProductFamily(
            organization_id=f.org.id,
            canonical_concept_id=f.concept.id,
            distinction_note="different construction, confirmed by the owner",
        )
    )
    await session.flush()

    count = (
        await session.execute(
            text("SELECT count(*) FROM product_family WHERE canonical_concept_id = :cid"),
            {"cid": f.concept.id},
        )
    ).scalar_one()
    assert count == 2


async def test_a_source_identity_stays_unknown_until_someone_decides(
    session: AsyncSession,
) -> None:
    f = await build(session)
    source = SourceIdentity(organization_id=f.org.id, name="Belardi", normalized_name="belardi")
    session.add(source)
    await session.flush()
    await session.refresh(source)

    assert source.semantic_type.value == "UNKNOWN"


async def test_variant_attributes_collapse_on_nulls_not_distinct(
    session: AsyncSession,
) -> None:
    """Two variants of one family with every attribute unstated are the same
    variant, not two. Without NULLS NOT DISTINCT the database would accept
    unlimited duplicates and fragment inventory for one physical product."""
    f = await build(session)

    session.add(ProductVariant(product_family_id=f.family.id))
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_variants_differing_by_one_attribute_are_distinct(
    session: AsyncSession,
) -> None:
    f = await build(session)
    colour = AttributeTerm(
        organization_id=f.org.id,
        kind=AttributeKind.COLOR,
        name="шоколад",
        normalized_name="шоколад",
    )
    session.add(colour)
    await session.flush()

    session.add(ProductVariant(product_family_id=f.family.id, color_term_id=colour.id))
    await session.flush()  # must not raise


# --- inventory invariants ---------------------------------------------------


async def test_inventory_cannot_be_driven_negative(session: AsyncSession) -> None:
    """Invariant I1, at the database. Service logic is not the only guard."""
    f = await build(session)
    inventory = Inventory(
        store_id=f.store.id, product_variant_id=f.variant.id, size_id=f.size.id, quantity=1
    )
    session.add(inventory)
    await session.flush()

    inventory.quantity = -1
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_one_inventory_row_per_store_variant_size(session: AsyncSession) -> None:
    f = await build(session)
    session.add_all(
        [
            Inventory(
                store_id=f.store.id,
                product_variant_id=f.variant.id,
                size_id=f.size.id,
                quantity=1,
            ),
            Inventory(
                store_id=f.store.id,
                product_variant_id=f.variant.id,
                size_id=f.size.id,
                quantity=2,
            ),
        ]
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_unknown_size_is_a_normal_stockable_size(session: AsyncSession) -> None:
    """Business fact F34: legacy stock with no known size is still real stock,
    countable and sellable, not a placeholder."""
    f = await build(session)
    session.add(
        Inventory(
            store_id=f.store.id,
            product_variant_id=f.variant.id,
            size_id=f.unknown_size.id,
            quantity=3,
        )
    )
    await session.flush()  # must not raise


async def test_a_movement_that_changes_nothing_is_rejected(session: AsyncSession) -> None:
    f = await build(session)
    session.add(
        StockMovement(
            organization_id=f.org.id,
            store_id=f.store.id,
            product_variant_id=f.variant.id,
            size_id=f.size.id,
            movement_type=MovementType.DELIVERY,
            quantity_delta=0,
        )
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_an_adjustment_without_a_reason_is_rejected(session: AsyncSession) -> None:
    """`.ai/workflows/inventory-adjustment.md`: an untraceable stock edit must
    be impossible, not merely discouraged."""
    f = await build(session)
    session.add(
        StockMovement(
            organization_id=f.org.id,
            store_id=f.store.id,
            product_variant_id=f.variant.id,
            size_id=f.size.id,
            movement_type=MovementType.ADJUSTMENT,
            quantity_delta=5,
            reason_code=None,
        )
    )
    with pytest.raises(IntegrityError):
        await session.flush()


# --- append-only evidence ---------------------------------------------------


async def test_raw_input_cannot_be_updated(session: AsyncSession) -> None:
    """Invariant I10. The promise is kept by the database, not by convention."""
    f = await build(session)
    raw = RawInput(
        organization_id=f.org.id,
        source_kind=RawInputSource.MANUAL_ENTRY,
        raw_text="мышка шоколад гладкая 5",
        content_hash="0" * 64,
    )
    session.add(raw)
    await session.flush()

    with pytest.raises(DBAPIError):
        await session.execute(
            text("UPDATE raw_input SET raw_text = 'rewritten' WHERE id = :i"), {"i": raw.id}
        )


async def test_raw_input_cannot_be_deleted(session: AsyncSession) -> None:
    f = await build(session)
    raw = RawInput(
        organization_id=f.org.id,
        source_kind=RawInputSource.MANUAL_ENTRY,
        raw_text="дубленка Лоран шоколад замш 70 см 2 шт",
        content_hash="1" * 64,
    )
    session.add(raw)
    await session.flush()

    with pytest.raises(DBAPIError):
        await session.execute(text("DELETE FROM raw_input WHERE id = :i"), {"i": raw.id})


async def test_the_stock_ledger_cannot_be_rewritten(session: AsyncSession) -> None:
    """Invariant I11: every stock change is explainable forever."""
    f = await build(session)
    movement = StockMovement(
        organization_id=f.org.id,
        store_id=f.store.id,
        product_variant_id=f.variant.id,
        size_id=f.size.id,
        movement_type=MovementType.DELIVERY,
        quantity_delta=4,
    )
    session.add(movement)
    await session.flush()

    with pytest.raises(DBAPIError):
        await session.execute(
            text("UPDATE stock_movement SET quantity_delta = 99 WHERE id = :i"), {"i": movement.id}
        )


# --- money ------------------------------------------------------------------


async def _sale(session: AsyncSession, f: Fixture) -> Sale:
    user_id = (
        await session.execute(
            text(
                "INSERT INTO app_user (id, telegram_user_id, display_name, is_active, created_at)"
                " VALUES (gen_random_uuid(), :tg, 'Seller', true, now()) RETURNING id"
            ),
            {"tg": int(uuid.uuid4().int % 10_000_000)},
        )
    ).scalar_one()
    sale = Sale(
        organization_id=f.org.id,
        store_id=f.store.id,
        seller_user_id=user_id,
        command_id=uuid.uuid4(),
        currency_code="UAH",
        subtotal=Decimal("100.00"),
        discount_total=Decimal("0.00"),
        total=Decimal("100.00"),
    )
    session.add(sale)
    await session.flush()
    return sale


async def test_a_sale_line_with_inconsistent_arithmetic_is_rejected(
    session: AsyncSession,
) -> None:
    """Invariant I22: a rounding bug cannot persist a wrong line."""
    f = await build(session)
    sale = await _sale(session, f)

    session.add(
        SaleItem(
            sale_id=sale.id,
            product_variant_id=f.variant.id,
            size_id=f.size.id,
            quantity=2,
            unit_price=Decimal("50.00"),
            discount_amount=Decimal("5.00"),
            final_unit_price=Decimal("50.00"),  # should be 45.00
            line_total=Decimal("100.00"),
            currency_code="UAH",
            display_name_snapshot="Лоран шоколад",
            variant_snapshot={},
        )
    )
    with pytest.raises(IntegrityError):
        await session.flush()


async def test_a_correct_sale_line_is_accepted(session: AsyncSession) -> None:
    f = await build(session)
    sale = await _sale(session, f)

    session.add(
        SaleItem(
            sale_id=sale.id,
            product_variant_id=f.variant.id,
            size_id=f.size.id,
            quantity=2,
            unit_price=Decimal("50.00"),
            discount_amount=Decimal("5.00"),
            final_unit_price=Decimal("45.00"),
            line_total=Decimal("90.00"),
            currency_code="UAH",
            display_name_snapshot="Лоран шоколад",
            variant_snapshot={"color": "шоколад"},
        )
    )
    await session.flush()  # must not raise


async def test_the_same_command_cannot_create_two_sales(session: AsyncSession) -> None:
    """Invariant I20. This holds forever, unlike the 7-day idempotency record —
    a replay next year still cannot duplicate the sale."""
    f = await build(session)
    sale = await _sale(session, f)

    session.add(
        Sale(
            organization_id=f.org.id,
            store_id=f.store.id,
            seller_user_id=sale.seller_user_id,
            command_id=sale.command_id,
            currency_code="UAH",
            subtotal=Decimal("10.00"),
            discount_total=Decimal("0.00"),
            total=Decimal("10.00"),
        )
    )
    with pytest.raises(IntegrityError):
        await session.flush()
