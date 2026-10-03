"""Merging a duplicate, and retiring a model (ADR-0008 §3, §6).

The owner decided on 2026-10-03 (business-rules.md, "correcting the
catalogue"):

- **a duplicate is merged into the model that stays.** Its stock moves there
  in every warehouse and size, recorded in the ledger as the merge's own
  movements; the price of the model that stays is kept, the duplicate's taken
  where it has none, a store's own price alike. It cannot be undone: the app
  shows both models and asks first;
- **not while the duplicate has anything open:** an order holding goods,
  borrowed goods, units in «Брак», an opening list waiting;
- asked the same day: **only a person with the right over every store
  merges**; a merge **does not reach into another store's own warehouse or a
  blocked one**, and shows where; **nothing is merged into a retired model**;
- **a retired model** is no longer offered or received; its stock still
  sells; it can be brought back.

This module decides and orders; it writes stock only through
`inventory.apply_catalog_merge`, and a model's name and status only through
the catalogue's own primitives. It reads what blocks a merge from orders,
borrowed lots and opening lists, and nothing imports it but the API
(ADR-0001, 2026-10-03 amendment).
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    LocationAccessDeniedError,
    MergeBlockedError,
    PermissionDeniedError,
    ValidationFailedError,
)
from app.core.logging import get_logger
from app.modules.authz.locations import readable_location_ids, require_stock_access
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.corrections import (
    CorrectionResult,
    HeldModel,
    existing_correction,
    hold_models,
    merge_emptied_family,
    record_correction,
    refuse_merged,
    result_from_snapshot,
)
from app.modules.catalog.models import CorrectionKind, EntityStatus, ProductVariant
from app.modules.catalog.prices import carry_prices, suggested_prices
from app.modules.catalog.read import describe_variants, size_labels
from app.modules.inventory.service import (
    VariantBalance,
    apply_catalog_merge,
    variant_balances,
)
from app.modules.orders.models import CustomerOrder, CustomerOrderItem, OrderStatus
from app.modules.snapshots.models import (
    InventorySnapshot,
    InventorySnapshotAllocation,
    InventorySnapshotRow,
    SnapshotStatus,
)
from app.modules.suppliers.borrowed import lots_on_hand
from app.modules.tenancy.models import StockLocation, Store
from app.modules.tenancy.service import damaged_returns_locations, validate_active_stores

logger = get_logger(__name__)

# An order that may still hold or bring back goods (business-rules.md).
OPEN_ORDER_STATUSES = (
    OrderStatus.READY_TO_DISPATCH.value,
    OrderStatus.DISPATCHED.value,
    OrderStatus.ARRIVED.value,
)
# A list that is neither applied nor rejected waits. `DRAFT`, `PARSED` and
# `APPROVED` are never written, but would wait too.
DECIDED_LISTS = (SnapshotStatus.APPLIED, SnapshotStatus.REJECTED)


async def may_merge(session: AsyncSession, *, scope: RequestScope) -> bool:
    """Whether this person may merge: `catalog:merge` organization-wide, or in
    every store of the organization, paused ones too (owner decision,
    2026-10-03 — the shared price's rule, since a merge moves stock and
    prices in every store)."""
    if scope.can(Permission.CATALOG_MERGE):
        return True
    stores = (
        await session.scalars(
            select(Store.id).where(Store.organization_id == scope.organization_id)
        )
    ).all()
    return bool(stores) and all(scope.can(Permission.CATALOG_MERGE, s) for s in stores)


async def require_merge_right(
    session: AsyncSession, *, scope: RequestScope, store_id: uuid.UUID
) -> None:
    # The store is the working context; the authority is over every store.
    scope.require_store(store_id)
    if not await may_merge(session, scope=scope):
        raise PermissionDeniedError(
            f"Missing permission {Permission.CATALOG_MERGE.value} in every store",
            permission=Permission.CATALOG_MERGE.value,
            store_id=None,
        )
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={store_id}
    )


async def waiting_lists(
    session: AsyncSession, *, organization_id: uuid.UUID, product_variant_id: uuid.UUID
) -> list[uuid.UUID]:
    """Opening lists not yet decided with a line resolved to this model."""
    return list(
        (
            await session.scalars(
                select(InventorySnapshot.id)
                .join(
                    InventorySnapshotRow,
                    InventorySnapshotRow.inventory_snapshot_id == InventorySnapshot.id,
                )
                .join(
                    InventorySnapshotAllocation,
                    InventorySnapshotAllocation.snapshot_row_id == InventorySnapshotRow.id,
                )
                .where(
                    InventorySnapshot.organization_id == organization_id,
                    InventorySnapshot.status.not_in(DECIDED_LISTS),
                    InventorySnapshotAllocation.product_variant_id == product_variant_id,
                )
                .distinct()
                .order_by(InventorySnapshot.id)
            )
        ).all()
    )


async def _open_orders(
    session: AsyncSession, *, organization_id: uuid.UUID, product_variant_id: uuid.UUID
) -> list[uuid.UUID]:
    return list(
        (
            await session.scalars(
                select(CustomerOrder.id)
                .join(CustomerOrderItem, CustomerOrderItem.order_id == CustomerOrder.id)
                .where(
                    CustomerOrder.organization_id == organization_id,
                    CustomerOrder.status.in_(OPEN_ORDER_STATUSES),
                    CustomerOrderItem.product_variant_id == product_variant_id,
                )
                .distinct()
                .order_by(CustomerOrder.id)
            )
        ).all()
    )


async def _location_names(
    session: AsyncSession, *, organization_id: uuid.UUID, location_ids: set[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, bool]]:
    rows = await session.execute(
        select(StockLocation.id, StockLocation.name, StockLocation.is_active).where(
            StockLocation.organization_id == organization_id,
            StockLocation.id.in_(location_ids),
        )
    )
    return {location_id: (name, active) for location_id, name, active in rows.all()}


async def _reach(
    session: AsyncSession, *, scope: RequestScope, store_id: uuid.UUID, location_id: uuid.UUID
) -> bool:
    """Whether the acting store may change stock here: it has access, and a
    store's own warehouse only with the person's right granted there."""
    try:
        await require_stock_access(
            session,
            scope=scope,
            store_id=store_id,
            location_ids={location_id},
            capability=None,
            permission=Permission.CATALOG_MERGE,
        )
    except (PermissionDeniedError, LocationAccessDeniedError):
        return False
    return True


async def blockers(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    duplicate_id: uuid.UUID,
    into: HeldModel,
    balances: list[VariantBalance],
) -> list[dict[str, Any]]:
    """Everything that stops this merge, each with what to finish first."""
    organization_id = scope.organization_id
    found: list[dict[str, Any]] = []
    if into.status is EntityStatus.RETIRED:
        found.append({"reason": "TARGET_RETIRED", "product_variant_id": str(into.id)})
    orders = await _open_orders(
        session, organization_id=organization_id, product_variant_id=duplicate_id
    )
    if orders:
        found.append({"reason": "OPEN_ORDERS", "order_ids": [str(o) for o in orders]})
    lots = await lots_on_hand(
        session, organization_id=organization_id, product_variant_id=duplicate_id
    )
    if lots:
        found.append(
            {
                "reason": "BORROWED_ON_HAND",
                "lots": [{"stock_lot_id": str(lot), "on_hand": left} for lot, left in lots],
            }
        )
    places = {balance.location_id for balance in balances}
    damaged = await damaged_returns_locations(
        session, organization_id=organization_id, location_ids=places
    )
    names = await _location_names(session, organization_id=organization_id, location_ids=places)
    in_bin = [b for b in balances if b.location_id in damaged and b.quantity > 0]
    if in_bin:
        found.append(
            {
                "reason": "DAMAGED_IN_BIN",
                "units": sum(b.quantity for b in in_bin),
                "locations": _named(names, {b.location_id for b in in_bin}),
            }
        )
    lists = await waiting_lists(
        session, organization_id=organization_id, product_variant_id=duplicate_id
    )
    if lists:
        found.append({"reason": "OPENING_LIST_WAITING", "snapshot_ids": [str(s) for s in lists]})
    closed = {place for place in places - damaged if not names.get(place, ("", False))[1]}
    if closed:
        found.append({"reason": "WAREHOUSE_CLOSED", "locations": _named(names, closed)})
    out_of_reach = {
        place
        for place in sorted(places - damaged - closed)
        if not await _reach(session, scope=scope, store_id=store_id, location_id=place)
    }
    if out_of_reach:
        found.append({"reason": "STOCK_OUT_OF_REACH", "locations": _named(names, out_of_reach)})
    return found


def _named(
    names: dict[uuid.UUID, tuple[str, bool]], location_ids: set[uuid.UUID]
) -> list[dict[str, str]]:
    return [
        {"location_id": str(location_id), "name": names.get(location_id, ("", False))[0]}
        for location_id in sorted(location_ids)
    ]


def _check_pair(duplicate_id: uuid.UUID, into_id: uuid.UUID) -> None:
    if duplicate_id == into_id:
        raise ValidationFailedError("A model cannot be merged into itself")


async def preview_merge(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    duplicate_id: uuid.UUID,
    into_id: uuid.UUID,
) -> dict[str, Any]:
    """What a merge would do, and what stops it, before anyone confirms.

    The merge's own checks, without its locks: what this allows, the merge
    does, unless something changes in between. Quantities show only in
    warehouses the person may read; the others are named, as the owner chose.
    """
    await require_merge_right(session, scope=scope, store_id=store_id)
    _check_pair(duplicate_id, into_id)
    duplicate, into = await _models(
        session, organization_id=scope.organization_id, duplicate_id=duplicate_id, into_id=into_id
    )
    balances = await variant_balances(
        session, organization_id=scope.organization_id, product_variant_id=duplicate_id
    )
    found = await blockers(
        session,
        scope=scope,
        store_id=store_id,
        duplicate_id=duplicate_id,
        into=into,
        balances=balances,
    )
    places = {balance.location_id for balance in balances}
    readable = await readable_location_ids(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        location_ids=places,
        scope=scope,
    )
    names = await _location_names(
        session, organization_id=scope.organization_id, location_ids=places
    )
    sizes = await size_labels(session, list({balance.size_id for balance in balances}))
    described = await describe_variants(session, [duplicate_id, into_id])
    prices = await suggested_prices(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        variant_ids=[duplicate_id, into_id],
    )
    return {
        "duplicate": _model_view(duplicate, described, prices),
        "into": _model_view(into, described, prices),
        "stock": [
            {
                "location_id": balance.location_id,
                "location_name": names.get(balance.location_id, ("", False))[0],
                "size_id": balance.size_id,
                "size_label": sizes.get(balance.size_id),
                "quantity": balance.quantity if balance.location_id in readable else None,
            }
            for balance in balances
            if balance.quantity > 0
        ],
        "blockers": found,
    }


def _model_view(
    model: HeldModel, described: dict[uuid.UUID, Any], prices: dict[uuid.UUID, Any]
) -> dict[str, Any]:
    price = prices.get(model.id)
    return {
        "product_variant_id": model.id,
        "display_name": described[model.id].display_name,
        "status": model.status.value,
        "shared_price": None if price is None else price.shared,
        "store_price": None if price is None else price.store,
    }


async def _models(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    duplicate_id: uuid.UUID,
    into_id: uuid.UUID,
    hold: bool = False,
) -> tuple[HeldModel, HeldModel]:
    """Both models, refused when either is merged already. `hold` holds them
    `FOR UPDATE`, in id order; a preview only reads them."""
    held = await hold_models(
        session,
        organization_id=organization_id,
        variant_ids={duplicate_id, into_id},
        lock=hold,
    )
    duplicate, into = held[duplicate_id], held[into_id]
    refuse_merged(duplicate)
    refuse_merged(into)
    return duplicate, into


async def merge_models(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    duplicate_id: uuid.UUID,
    into_id: uuid.UUID,
    command_id: uuid.UUID,
    fingerprint: str,
    correlation_id: str | None,
) -> CorrectionResult:
    """Merge the duplicate into the model that stays, in one transaction.

    In this order (ADR-0008 §3): the command lock and its lookup; both models
    held `FOR UPDATE`, every blocker checked under the hold; the stock moved
    through the ledger's own door; the prices carried; the duplicate marked
    merged, and the models merged into it pointed at the model that stays;
    the correction recorded with its audit entry.

    Does not commit: the caller owns the unit of work.
    """
    await require_merge_right(session, scope=scope, store_id=store_id)
    _check_pair(duplicate_id, into_id)
    replay = await existing_correction(
        session,
        organization_id=scope.organization_id,
        command_id=command_id,
        fingerprint=fingerprint,
    )
    if replay is not None:
        return result_from_snapshot(replay)

    duplicate, into = await _models(
        session,
        organization_id=scope.organization_id,
        duplicate_id=duplicate_id,
        into_id=into_id,
        hold=True,
    )
    balances = await variant_balances(
        session, organization_id=scope.organization_id, product_variant_id=duplicate_id
    )
    found = await blockers(
        session,
        scope=scope,
        store_id=store_id,
        duplicate_id=duplicate_id,
        into=into,
        balances=balances,
    )
    if found:
        raise MergeBlockedError(reasons=found)

    described = await describe_variants(session, [duplicate_id, into_id])
    correction_id = uuid.uuid4()
    moved = await apply_catalog_merge(
        session,
        organization_id=scope.organization_id,
        correction_id=correction_id,
        duplicate_id=duplicate_id,
        into_id=into_id,
        acting_store_id=store_id,
        actor_user_id=scope.user_id,
        correlation_id=correlation_id,
    )
    carried = await carry_prices(
        session,
        organization_id=scope.organization_id,
        from_variant_id=duplicate_id,
        into_variant_id=into_id,
        actor_user_id=scope.user_id,
    )
    await session.execute(
        update(ProductVariant)
        .where(ProductVariant.id == duplicate_id)
        .values(status=EntityStatus.MERGED, merged_into_id=into_id)
        .execution_options(synchronize_session="fetch")
    )
    family_merged = await merge_emptied_family(
        session, family_id=duplicate.product_family_id, into_family_id=into.product_family_id
    )
    # Models merged into the duplicate before now lead to the model that
    # stays too, so `merged_into_id` always names a model not merged.
    await session.execute(
        update(ProductVariant)
        .where(ProductVariant.merged_into_id == duplicate_id)
        .values(merged_into_id=into_id)
        .execution_options(synchronize_session="fetch")
    )
    details = {
        "moved": [
            {
                "location_id": str(entry.location_id),
                "size_id": str(entry.size_id),
                "quantity": entry.quantity,
            }
            for entry in moved
        ],
        "prices": carried,
        "family_merged": family_merged,
    }
    result = CorrectionResult(
        correction_id=correction_id,
        kind=CorrectionKind.MERGE,
        product_variant_id=duplicate_id,
        into_variant_id=into_id,
        name_before=described[duplicate_id].display_name,
        name_after=described[into_id].display_name,
        status=EntityStatus.MERGED,
        details=details,
    )
    await record_correction(
        session,
        scope=scope,
        store_id=store_id,
        result=result,
        command_id=command_id,
        fingerprint=fingerprint,
        correlation_id=correlation_id,
    )
    logger.info(
        "catalog.model_merged",
        product_variant_id=str(duplicate_id),
        into_variant_id=str(into_id),
        keys_moved=len(moved),
    )
    return result


async def _set_status(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    product_variant_id: uuid.UUID,
    command_id: uuid.UUID,
    fingerprint: str,
    correlation_id: str | None,
    kind: CorrectionKind,
) -> CorrectionResult:
    scope.require(Permission.CATALOG_MERGE, store_id)
    await validate_active_stores(
        session, organization_id=scope.organization_id, store_ids={store_id}
    )
    replay = await existing_correction(
        session,
        organization_id=scope.organization_id,
        command_id=command_id,
        fingerprint=fingerprint,
    )
    if replay is not None:
        return result_from_snapshot(replay)
    model = (
        await hold_models(
            session, organization_id=scope.organization_id, variant_ids={product_variant_id}
        )
    )[product_variant_id]
    refuse_merged(model)
    name = (await describe_variants(session, [model.id]))[model.id].display_name
    retiring = kind is CorrectionKind.RETIRE
    target = EntityStatus.RETIRED if retiring else EntityStatus.ACTIVE
    if (model.status is EntityStatus.RETIRED) == retiring:
        # Already so: answered as it is, recorded nowhere.
        return CorrectionResult(
            correction_id=None,
            kind=kind,
            product_variant_id=model.id,
            into_variant_id=None,
            name_before=name,
            name_after=name,
            status=model.status,
        )
    if retiring:
        lists = await waiting_lists(
            session, organization_id=scope.organization_id, product_variant_id=model.id
        )
        if lists:
            # The list could never be approved with a retired model in it,
            # and its warehouse would stay waiting.
            raise ValidationFailedError(
                "An opening list that waits names this model; approve or reject it first",
                reason="OPENING_LIST_WAITING",
                snapshot_ids=[str(snapshot) for snapshot in lists],
            )
    await session.execute(
        update(ProductVariant)
        .where(ProductVariant.id == model.id)
        .values(status=target)
        .execution_options(synchronize_session="fetch")
    )
    details = {"status_before": model.status.value, "status_after": target.value}
    result = CorrectionResult(
        correction_id=uuid.uuid4(),
        kind=kind,
        product_variant_id=model.id,
        into_variant_id=None,
        name_before=name,
        name_after=name,
        status=target,
        details=details,
    )
    await record_correction(
        session,
        scope=scope,
        store_id=store_id,
        result=result,
        command_id=command_id,
        fingerprint=fingerprint,
        correlation_id=correlation_id,
    )
    return result


async def retire_model(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    product_variant_id: uuid.UUID,
    command_id: uuid.UUID,
    fingerprint: str,
    correlation_id: str | None,
) -> CorrectionResult:
    """Retire a model: no longer offered or received; its stock still sells,
    returns, moves and is written off (owner decision, 2026-10-03)."""
    return await _set_status(
        session,
        scope=scope,
        store_id=store_id,
        product_variant_id=product_variant_id,
        command_id=command_id,
        fingerprint=fingerprint,
        correlation_id=correlation_id,
        kind=CorrectionKind.RETIRE,
    )


async def restore_model(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    product_variant_id: uuid.UUID,
    command_id: uuid.UUID,
    fingerprint: str,
    correlation_id: str | None,
) -> CorrectionResult:
    """Bring a retired model back: offered and received again, as before."""
    return await _set_status(
        session,
        scope=scope,
        store_id=store_id,
        product_variant_id=product_variant_id,
        command_id=command_id,
        fingerprint=fingerprint,
        correlation_id=correlation_id,
        kind=CorrectionKind.RESTORE,
    )


__all__ = [
    "blockers",
    "may_merge",
    "merge_models",
    "preview_merge",
    "require_merge_right",
    "restore_model",
    "retire_model",
    "waiting_lists",
]
