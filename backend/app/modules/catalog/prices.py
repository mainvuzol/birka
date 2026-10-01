"""Suggested selling prices — owner question Q-F, answered 2026-10-01.

The till prefills a model's suggested price, so a seller does not type it on
every sale (F33). It is a convenience, never an authority: the seller still
agrees the final price at the counter, the sale request carries it, and
`SaleItem` freezes its own copy (invariant I8). Changing a price here never
changes what a past sale charged.

What the owner decided (business-rules.md, "suggested selling price"):

- **The owner and managers set it** (`catalog:set_price`); a seller sees it.
- **One price for the whole shop, which a store may override.** A store's
  till suggests the store's own price when it has one, the shared one
  otherwise.
- **It is set where goods arrive, and on the stock screen.** One price per
  model and colour — a variant — for every size.

A store's own price takes `catalog:set_price` in that store: a store's
manager changes what that store's till suggests, and no other store's — the
scope rule every command already follows (I12/I13). The shared price reaches
every store's till, so it takes the permission over all of them: held
organization-wide, or held in every one of the organization's stores, paused
ones included (owner decision, 2026-10-01). A child store's owner who is also
a manager of the main store, in a shop of those two, sets the shared price.

**Nobody overwrites a price they have not seen.** A change states the price
the screen showed. If that no longer stands, the change is refused with the
one that does (`PRICE_CHANGED`). If the price already is what was asked, the
change is answered as done, so a retry after a lost answer is safe.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, PermissionDeniedError, PriceChangedError
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.models import (
    CanonicalConcept,
    EntityStatus,
    ProductFamily,
    ProductVariant,
    VariantPrice,
)
from app.modules.tenancy.models import Organization, Store
from app.modules.tenancy.service import validate_active_stores

KOPECK = Decimal("0.01")


class PriceScope(StrEnum):
    # The shared price, for every store without its own.
    ORGANIZATION = "ORGANIZATION"
    # One store's own price, which its till suggests instead.
    STORE = "STORE"


@dataclass(frozen=True, slots=True)
class SuggestedPrice:
    """A variant's prices as one store's till sees them."""

    shared: Decimal | None
    store: Decimal | None

    @property
    def suggested(self) -> Decimal | None:
        return self.store if self.store is not None else self.shared


async def suggested_prices(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    variant_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, SuggestedPrice]:
    """Every listed variant's prices for one store, in one query. A variant
    nobody has priced is answered with neither."""
    found: dict[uuid.UUID, dict[uuid.UUID | None, Decimal]] = {}
    if variant_ids:
        rows = await session.execute(
            select(
                VariantPrice.product_variant_id,
                VariantPrice.store_id,
                VariantPrice.suggested_price,
            ).where(
                VariantPrice.organization_id == organization_id,
                VariantPrice.product_variant_id.in_(set(variant_ids)),
                or_(VariantPrice.store_id.is_(None), VariantPrice.store_id == store_id),
            )
        )
        for variant_id, row_store_id, price in rows:
            found.setdefault(variant_id, {})[row_store_id] = price
    return {
        variant_id: SuggestedPrice(
            shared=found.get(variant_id, {}).get(None),
            store=found.get(variant_id, {}).get(store_id),
        )
        for variant_id in variant_ids
    }


async def currency(session: AsyncSession, *, organization_id: uuid.UUID) -> str:
    return (
        await session.execute(
            select(Organization.currency_code).where(Organization.id == organization_id)
        )
    ).scalar_one()


async def _require_variant(
    session: AsyncSession, *, organization_id: uuid.UUID, variant_id: uuid.UUID, lock: bool
) -> None:
    """The organization's own model, not merged away — the rule receiving
    follows: a model parked in review is still the coat in someone's hands.
    Before a write it is held FOR KEY SHARE, so the price row's foreign key
    cannot lose it."""
    statement = (
        select(ProductVariant.id)
        .join(ProductFamily, ProductFamily.id == ProductVariant.product_family_id)
        .join(CanonicalConcept, CanonicalConcept.id == ProductFamily.canonical_concept_id)
        .where(
            ProductVariant.id == variant_id,
            ProductFamily.organization_id == organization_id,
            CanonicalConcept.organization_id == organization_id,
            ProductVariant.status != EntityStatus.MERGED,
            ProductFamily.status != EntityStatus.MERGED,
            CanonicalConcept.status != EntityStatus.MERGED,
        )
    )
    if lock:
        statement = statement.with_for_update(read=True, key_share=True, of=ProductVariant)
    found = await session.scalar(statement)
    if found is None:
        raise NotFoundError("Unknown product variant", product_variant_id=str(variant_id))


async def prices_of(
    session: AsyncSession, *, scope: RequestScope, store_id: uuid.UUID, variant_id: uuid.UUID
) -> SuggestedPrice:
    """What one store's till suggests for a model, and where it comes from.

    Anyone working in the store may read it: it is the price on the shelf."""
    scope.require_store(store_id)
    await _require_variant(
        session, organization_id=scope.organization_id, variant_id=variant_id, lock=False
    )
    prices = await suggested_prices(
        session, organization_id=scope.organization_id, store_id=store_id, variant_ids=[variant_id]
    )
    return prices[variant_id]


async def may_set_shared(session: AsyncSession, *, scope: RequestScope) -> bool:
    """Whether this person may change the shared price: they hold
    `catalog:set_price` organization-wide, or in every store of the
    organization — paused ones too, whose tills will suggest it again."""
    if scope.can(Permission.CATALOG_SET_PRICE):
        return True
    stores = (
        await session.scalars(
            select(Store.id).where(Store.organization_id == scope.organization_id)
        )
    ).all()
    return bool(stores) and all(scope.can(Permission.CATALOG_SET_PRICE, s) for s in stores)


async def _lock(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID | None,
    variant_id: uuid.UUID,
) -> None:
    # Taken before the row is read, so two changes to one price are decided
    # one after the other, each against what the other left.
    value = f"birka:price:{organization_id}:{store_id or 'shared'}:{variant_id}".encode()
    key = int.from_bytes(hashlib.sha256(value).digest()[:8], "big", signed=True)
    await session.execute(select(func.pg_advisory_xact_lock(key)))


def _kopecks(value: Decimal | None) -> Decimal | None:
    return None if value is None else value.quantize(KOPECK)


async def set_price(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    variant_id: uuid.UUID,
    applies_to: PriceScope,
    expected: Decimal | None,
    price: Decimal | None,
) -> SuggestedPrice:
    """Set, change or remove one price — the shared one, or the store's own.

    `expected` is the price the screen showed for that scope, `None` when it
    showed none; `price=None` removes it. The caller owns the transaction."""
    # To the kopeck, as the column holds it, so "2000" and "2000.00" are one
    # price and the audit says what was stored.
    expected, price = _kopecks(expected), _kopecks(price)
    if applies_to is PriceScope.STORE:
        scope.require(Permission.CATALOG_SET_PRICE, store_id)
        row_store_id: uuid.UUID | None = store_id
    else:
        # The store is the working context; the authority is over every till.
        scope.require_store(store_id)
        if not await may_set_shared(session, scope=scope):
            raise PermissionDeniedError(
                f"Missing permission {Permission.CATALOG_SET_PRICE.value} in every store",
                permission=Permission.CATALOG_SET_PRICE.value,
                store_id=None,
            )
        row_store_id = None
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={store_id}
    )
    await _require_variant(
        session, organization_id=scope.organization_id, variant_id=variant_id, lock=True
    )
    await _lock(
        session,
        organization_id=scope.organization_id,
        store_id=row_store_id,
        variant_id=variant_id,
    )
    row = await session.scalar(
        select(VariantPrice).where(
            VariantPrice.organization_id == scope.organization_id,
            VariantPrice.product_variant_id == variant_id,
            VariantPrice.store_id.is_(None)
            if row_store_id is None
            else VariantPrice.store_id == row_store_id,
        )
    )
    current = row.suggested_price if row is not None else None
    if current != price:
        if current != expected:
            raise PriceChangedError(
                product_variant_id=str(variant_id),
                applies_to=applies_to.value,
                current=str(current) if current is not None else None,
            )
        if price is not None and row is None:
            session.add(
                VariantPrice(
                    organization_id=scope.organization_id,
                    store_id=row_store_id,
                    product_variant_id=variant_id,
                    suggested_price=price,
                    currency_code=await currency(session, organization_id=scope.organization_id),
                    updated_by_user_id=scope.user_id,
                )
            )
        elif price is not None and row is not None:
            row.suggested_price = price
            row.updated_by_user_id = scope.user_id
        elif row is not None:
            await session.delete(row)
        await session.flush()
        await audit.record(
            session,
            organization_id=scope.organization_id,
            actor_user_id=scope.user_id,
            action="catalog.price_set" if price is not None else "catalog.price_removed",
            entity_type="product_variant",
            entity_id=variant_id,
            before={
                "applies_to": applies_to.value,
                "store_id": str(row_store_id) if row_store_id else None,
                "suggested_price": str(current) if current is not None else None,
            },
            after={
                "applies_to": applies_to.value,
                "store_id": str(row_store_id) if row_store_id else None,
                "suggested_price": str(price) if price is not None else None,
            },
        )
    prices = await suggested_prices(
        session, organization_id=scope.organization_id, store_id=store_id, variant_ids=[variant_id]
    )
    return prices[variant_id]


__all__ = [
    "PriceScope",
    "SuggestedPrice",
    "currency",
    "may_set_shared",
    "prices_of",
    "set_price",
    "suggested_prices",
]
