"""The sale command against a real PostgreSQL.

Covers the required list in `.ai/workflows/sale.md`: happy path, insufficient
stock, duplicate idempotency request, two concurrent sales for the last unit,
a failure rolling back both sale and stock, and a seller unable to sell from a
foreign store. The seventh item on that list — the client handling a timeout
safely — belongs to gate M1D and is not claimed here.

Also covers business fact F30, the `FOUND_DURING_SALE` path.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.errors import (
    CorrectionExceedsShortfallError,
    ForbiddenStoreError,
    InsufficientStockError,
    NotFoundError,
    PermissionDeniedError,
)
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    CanonicalConcept,
    ProductFamily,
    ProductVariant,
    Size,
    SizeSystem,
    SizeSystemCode,
)
from app.modules.identity.models import AppUser
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import (
    MovementRequest,
    apply_movements,
    current_quantity,
    find_divergences,
)
from app.modules.sales.service import FoundInStore, SaleLineInput, create_sale
from app.modules.tenancy.models import Organization, Store, StoreKind
from tests.conftest import provision_location, requires_database

pytestmark = [pytest.mark.integration, requires_database()]

SELLER_PERMISSIONS = frozenset(
    {
        Permission.SALE_CREATE,
        Permission.SALE_VIEW,
        Permission.INVENTORY_VIEW,
        Permission.INVENTORY_CORRECT_DURING_SALE,
    }
)


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield engine
    await engine.dispose()


@pytest.fixture
async def session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
        await s.rollback()


class Shop:
    def __init__(self, **kwargs: object) -> None:
        self.__dict__.update(kwargs)

    def scope(self, permissions: frozenset[Permission] = SELLER_PERMISSIONS) -> RequestScope:
        return RequestScope(
            user_id=self.user_id,  # type: ignore[arg-type]
            organization_id=self.organization_id,  # type: ignore[arg-type]
            store_permissions={self.store_id: permissions},  # type: ignore[dict-item]
        )


async def make_shop(session: AsyncSession) -> Shop:
    org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", currency_code="UAH")
    session.add(org)
    await session.flush()

    store = Store(organization_id=org.id, name="Основний", code="MAIN", kind=StoreKind.PRIMARY)
    concept = CanonicalConcept(organization_id=org.id, name="Лоран", normalized_name="лоран")
    system = SizeSystem(organization_id=org.id, code=SizeSystemCode.ALPHA, name="Alpha")
    user = AppUser(telegram_user_id=uuid.uuid4().int % 2**62, display_name="Оля")
    colour = AttributeTerm(
        organization_id=org.id,
        kind=AttributeKind.COLOR,
        name="шоколад",
        normalized_name="шоколад",
    )
    session.add_all([store, concept, system, user, colour])
    await session.flush()

    size = Size(size_system_id=system.id, code="M")
    family = ProductFamily(organization_id=org.id, canonical_concept_id=concept.id)
    session.add_all([size, family])
    await session.flush()

    variant = ProductVariant(product_family_id=family.id, color_term_id=colour.id, length_cm=70)
    session.add(variant)
    await session.flush()
    location_id = await provision_location(
        session, organization_id=org.id, store_id=store.id, name="Основний склад"
    )
    await session.commit()

    return Shop(
        organization_id=org.id,
        store_id=store.id,
        location_id=location_id,
        user_id=user.id,
        size_id=size.id,
        variant_id=variant.id,
        concept_id=concept.id,
    )


async def give_stock(session: AsyncSession, shop: Shop, quantity: int) -> None:
    await apply_movements(
        session,
        organization_id=shop.organization_id,  # type: ignore[arg-type]
        requests=[
            MovementRequest(
                location_id=shop.location_id,  # type: ignore[arg-type]
                acting_store_id=shop.store_id,  # type: ignore[arg-type]
                product_variant_id=shop.variant_id,  # type: ignore[arg-type]
                size_id=shop.size_id,  # type: ignore[arg-type]
                quantity_delta=quantity,
                movement_type=MovementType.DELIVERY,
            )
        ],
    )
    await session.commit()


def basket(shop: Shop, quantity: int = 1, price: str = "1200.00", discount: str = "0") -> list:
    return [
        SaleLineInput(
            product_variant_id=shop.variant_id,  # type: ignore[arg-type]
            size_id=shop.size_id,  # type: ignore[arg-type]
            source_location_id=shop.location_id,  # type: ignore[arg-type]
            quantity=quantity,
            unit_price=Decimal(price),
            discount_amount=Decimal(discount),
        )
    ]


async def sell(session: AsyncSession, shop: Shop, **kwargs: object):
    defaults: dict[str, object] = {
        "scope": shop.scope(),
        "store_id": shop.store_id,
        "command_id": uuid.uuid4(),
        "lines": basket(shop),
        "currency_code": "UAH",
    }
    defaults.update(kwargs)
    return await create_sale(session, **defaults)  # type: ignore[arg-type]


# --- happy path --------------------------------------------------------------


async def test_a_sale_moves_stock_writes_the_ledger_and_totals_correctly(
    session: AsyncSession,
) -> None:
    shop = await make_shop(session)
    await give_stock(session, shop, 5)

    result = await sell(session, shop, lines=basket(shop, quantity=2, price="1200.50"))
    await session.commit()

    assert result.sale.subtotal == Decimal("2401.00")
    assert result.sale.total == Decimal("2401.00")
    assert result.items[0].line_total == Decimal("2401.00")
    assert (
        await current_quantity(
            session,
            location_id=shop.location_id,
            product_variant_id=shop.variant_id,
            size_id=shop.size_id,
        )
        == 3
    )
    assert await find_divergences(session, location_id=shop.location_id) == []


async def test_a_discounted_line_satisfies_the_database_constraints(
    session: AsyncSession,
) -> None:
    shop = await make_shop(session)
    await give_stock(session, shop, 3)

    result = await sell(
        session, shop, lines=basket(shop, quantity=3, price="1000.00", discount="150.00")
    )
    await session.commit()

    item = result.items[0]
    assert item.final_unit_price == Decimal("850.00")
    assert item.line_total == Decimal("2550.00")
    assert result.sale.discount_total == Decimal("450.00")
    assert result.sale.total == Decimal("2550.00")


async def test_the_receipt_freezes_the_name_it_was_sold_under(
    session: AsyncSession,
) -> None:
    """Invariant I8. Renaming the product afterwards must not rewrite history."""
    shop = await make_shop(session)
    await give_stock(session, shop, 1)

    result = await sell(session, shop)
    await session.commit()
    original_name = result.items[0].display_name_snapshot
    assert "Лоран" in original_name
    assert "шоколад" in original_name

    await session.execute(
        text("UPDATE canonical_concept SET name = 'Перейменовано' WHERE id = :i"),
        {"i": shop.concept_id},
    )
    await session.commit()
    await session.refresh(result.items[0])

    assert result.items[0].display_name_snapshot == original_name


# --- refusals ----------------------------------------------------------------


async def test_selling_more_than_is_on_the_shelf_is_refused(session: AsyncSession) -> None:
    shop = await make_shop(session)
    await give_stock(session, shop, 1)

    with pytest.raises(InsufficientStockError) as exc:
        await sell(session, shop, lines=basket(shop, quantity=4))

    assert exc.value.details["available"] == 1
    assert exc.value.details["correctable"] is True


async def test_a_failed_sale_leaves_neither_a_sale_nor_a_stock_change(
    session: AsyncSession,
) -> None:
    """`.ai/workflows/sale.md`: a failure rolls back sale and stock together."""
    shop = await make_shop(session)
    await give_stock(session, shop, 1)

    with pytest.raises(InsufficientStockError):
        await sell(session, shop, lines=basket(shop, quantity=9))
    await session.rollback()

    sales = (
        await session.execute(
            text("SELECT count(*) FROM sale WHERE store_id = :s"), {"s": shop.store_id}
        )
    ).scalar_one()
    assert sales == 0
    assert (
        await current_quantity(
            session,
            location_id=shop.location_id,
            product_variant_id=shop.variant_id,
            size_id=shop.size_id,
        )
        == 1
    )
    assert await find_divergences(session, location_id=shop.location_id) == []


async def test_a_seller_cannot_sell_from_a_foreign_store(session: AsyncSession) -> None:
    """Invariant I12. The store id is client input, not proof of access."""
    shop = await make_shop(session)
    other = await make_shop(session)
    await give_stock(session, other, 5)

    with pytest.raises(ForbiddenStoreError):
        await create_sale(
            session,
            scope=shop.scope(),  # membership in `shop` only
            store_id=other.store_id,  # type: ignore[arg-type]
            command_id=uuid.uuid4(),
            lines=basket(other),
            currency_code="UAH",
        )


async def test_a_variant_from_another_organization_is_not_found(
    session: AsyncSession,
) -> None:
    """Cross-tenant probing must not be distinguishable from a typo."""
    shop = await make_shop(session)
    other = await make_shop(session)
    await give_stock(session, shop, 5)

    with pytest.raises(NotFoundError):
        await create_sale(
            session,
            scope=shop.scope(),
            store_id=shop.store_id,  # type: ignore[arg-type]
            command_id=uuid.uuid4(),
            lines=basket(other),  # variant belongs to the other organization
            currency_code="UAH",
        )


async def test_the_same_command_id_cannot_create_a_second_sale(
    session: AsyncSession,
) -> None:
    """Invariant I20, independent of the idempotency record's retention."""
    shop = await make_shop(session)
    await give_stock(session, shop, 5)
    command_id = uuid.uuid4()

    original = await sell(session, shop, command_id=command_id)
    await session.commit()
    replay = await sell(session, shop, command_id=command_id)
    assert replay.sale.id == original.sale.id


# --- found during sale (F30) -------------------------------------------------


async def test_the_seller_can_complete_a_sale_against_zero_stock(
    session: AsyncSession,
) -> None:
    """The whole point of F30: the notebook is behind, the coat is on the rack,
    and the seller must not be stopped. Two movements, net zero, full trail."""
    shop = await make_shop(session)  # no stock at all

    result = await sell(
        session,
        shop,
        lines=basket(shop, quantity=2),
        found_in_store=[FoundInStore(line_index=0, quantity=2)],
    )
    await session.commit()

    assert len(result.corrections) == 1
    assert (
        await current_quantity(
            session,
            location_id=shop.location_id,
            product_variant_id=shop.variant_id,
            size_id=shop.size_id,
        )
        == 0
    )
    assert await find_divergences(session, location_id=shop.location_id) == []

    movements = (
        await session.execute(
            text(
                "SELECT movement_type, quantity_delta, reason_code FROM stock_movement"
                " WHERE location_id = :s ORDER BY created_at, movement_type"
            ),
            {"s": shop.location_id},
        )
    ).all()
    assert ("ADJUSTMENT", 2, "FOUND_DURING_SALE") in [tuple(m) for m in movements]
    assert ("SALE", -2, None) in [tuple(m) for m in movements]


async def test_a_partial_shortfall_is_corrected_by_exactly_the_missing_amount(
    session: AsyncSession,
) -> None:
    shop = await make_shop(session)
    await give_stock(session, shop, 1)

    result = await sell(
        session,
        shop,
        lines=basket(shop, quantity=3),
        found_in_store=[FoundInStore(line_index=0, quantity=2)],
    )
    await session.commit()

    assert len(result.corrections) == 1
    assert (
        await current_quantity(
            session,
            location_id=shop.location_id,
            product_variant_id=shop.variant_id,
            size_id=shop.size_id,
        )
        == 0
    )


async def test_correcting_more_than_the_shortfall_is_refused(
    session: AsyncSession,
) -> None:
    """Not a back door to arbitrary stock editing."""
    shop = await make_shop(session)
    await give_stock(session, shop, 1)

    with pytest.raises(CorrectionExceedsShortfallError) as exc:
        await sell(
            session,
            shop,
            lines=basket(shop, quantity=2),
            found_in_store=[FoundInStore(line_index=0, quantity=5)],
        )

    assert exc.value.details["shortfall"] == 1
    assert exc.value.details["requested"] == 5


async def test_a_seller_without_the_narrow_permission_cannot_correct(
    session: AsyncSession,
) -> None:
    """Selling is allowed; correcting stock while selling is a separate grant."""
    shop = await make_shop(session)
    limited = RequestScope(
        user_id=shop.user_id,  # type: ignore[arg-type]
        organization_id=shop.organization_id,  # type: ignore[arg-type]
        store_permissions={shop.store_id: frozenset({Permission.SALE_CREATE})},  # type: ignore[dict-item]
    )

    with pytest.raises(PermissionDeniedError):
        await create_sale(
            session,
            scope=limited,
            store_id=shop.store_id,  # type: ignore[arg-type]
            command_id=uuid.uuid4(),
            lines=basket(shop),
            currency_code="UAH",
            found_in_store=[FoundInStore(line_index=0, quantity=1)],
        )


async def test_the_correction_is_audited_with_before_and_after(
    session: AsyncSession,
) -> None:
    """`.ai/workflows/inventory-adjustment.md`: the audit records actor,
    before, after and reason — which is what makes it reviewable in a month."""
    shop = await make_shop(session)

    await sell(
        session,
        shop,
        lines=basket(shop, quantity=1),
        found_in_store=[FoundInStore(line_index=0, quantity=1)],
    )
    await session.commit()

    entry = (
        (
            await session.execute(
                text(
                    "SELECT action, before, after, reason, actor_user_id FROM audit_log"
                    " WHERE organization_id = :o"
                ),
                {"o": shop.organization_id},
            )
        )
        .mappings()
        .one()
    )

    assert entry["action"] == "inventory.found_during_sale"
    assert entry["before"] == {"quantity": 0}
    assert entry["after"] == {"quantity": 1}
    assert entry["reason"] == "FOUND_DURING_SALE"
    assert entry["actor_user_id"] == shop.user_id


# --- concurrency -------------------------------------------------------------


async def test_two_sellers_racing_for_the_last_coat(engine: AsyncEngine) -> None:
    """`.ai/workflows/sale.md`: two concurrent sales for the last unit.

    One sale exists, one seller is refused, the shelf ends at zero and the
    ledger still agrees.
    """
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as setup:
        shop = await make_shop(setup)
        await give_stock(setup, shop, 1)

    async def attempt() -> str:
        async with maker() as s:
            try:
                await sell(s, shop)
                await s.commit()
                return "sold"
            except InsufficientStockError:
                await s.rollback()
                return "refused"

    outcomes = await asyncio.gather(attempt(), attempt())

    assert sorted(outcomes) == ["refused", "sold"]
    async with maker() as check:
        sales = (
            await check.execute(
                text("SELECT count(*) FROM sale WHERE store_id = :s"), {"s": shop.store_id}
            )
        ).scalar_one()
        assert sales == 1
        assert (
            await current_quantity(
                check,
                location_id=shop.location_id,
                product_variant_id=shop.variant_id,
                size_id=shop.size_id,
            )
            == 0
        )
        assert await find_divergences(check, location_id=shop.location_id) == []
