"""Goods borrowed from another shop, and goods under consignment.

The owner decided on 2026-10-01 (business-rules.md, "goods borrowed from
another shop"):

- jackets taken from another shop, which is a supplier on the network's
  list, are paid for only once sold, at the price agreed for each; unsold,
  they go back for nothing. Goods under consignment work the same;
- they arrive through receiving, as «Позичено» or «Під реалізацію», naming
  the supplier and the price of each; only the owner and managers take them;
- the till sells them as any goods. The owner or a manager marks some sold,
  by hand: that is an invoice in «Накладні» for their price
  (`invoices.record_invoice`), paid there. Cancelling that invoice puts them
  back on hand;
- unsold ones go back from the list «Позичене», as a return to the supplier
  naming their lot (`service.return_goods`). Cancelling that return puts them
  back on hand too.

**What is on hand is never stored:** what arrived, less what stands sold,
less what stands returned. The lot's row is held while either is added, so
two of them never both count the same goods.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationFailedError
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.catalog.read import current_variants as catalog_current_variants
from app.modules.catalog.read import describe_variants, size_labels
from app.modules.inventory.models import (
    AcquisitionType,
    GoodsReceipt,
    MovementType,
    StockLot,
    StockMovement,
)
from app.modules.inventory.service import current_variants
from app.modules.suppliers import invoices
from app.modules.suppliers.common import SupplierView, require_keeper, supplier_view
from app.modules.suppliers.models import (
    InvoiceStatus,
    Supplier,
    SupplierInvoice,
    SupplierReturn,
    SupplierReturnCancel,
    SupplierReturnLine,
)
from app.modules.tenancy.service import location_names

# What is owed for only once sold.
PAID_WHEN_SOLD = (AcquisitionType.BORROWED, AcquisitionType.CONSIGNMENT)
MAX_QUANTITY = 10_000
ZERO = Decimal("0.00")


@dataclass(frozen=True, slots=True)
class BorrowedView:
    """One lot of borrowed goods: what arrived, and where it stands."""

    stock_lot_id: uuid.UUID
    acquisition_type: AcquisitionType
    supplier: SupplierView
    location_id: uuid.UUID
    location_name: str
    product_variant_id: uuid.UUID
    # The model its goods are held under now: its own, or the model that
    # stays if it was merged since. They go back to the supplier as it.
    held_as_variant_id: uuid.UUID
    size_id: uuid.UUID
    display_name: str
    size_label: str | None
    # The price agreed for each, owed once sold.
    unit_cost: Decimal | None
    currency_code: str | None
    received: int
    sold: int
    returned: int
    on_hand: int
    at: datetime


def _received() -> Any:
    return (
        select(func.coalesce(func.sum(StockMovement.quantity_delta), 0))
        .where(
            StockMovement.stock_lot_id == StockLot.id,
            StockMovement.movement_type == MovementType.DELIVERY,
        )
        .correlate(StockLot)
        .scalar_subquery()
    )


def _sold() -> Any:
    return (
        select(func.coalesce(func.sum(SupplierInvoice.lot_quantity), 0))
        .where(
            SupplierInvoice.stock_lot_id == StockLot.id,
            SupplierInvoice.status != InvoiceStatus.CANCELLED.value,
        )
        .correlate(StockLot)
        .scalar_subquery()
    )


def _returned() -> Any:
    return (
        select(func.coalesce(func.sum(SupplierReturnLine.quantity), 0))
        .join(SupplierReturn, SupplierReturn.id == SupplierReturnLine.supplier_return_id)
        .where(
            SupplierReturn.stock_lot_id == StockLot.id,
            ~select(SupplierReturnCancel.id)
            .where(SupplierReturnCancel.supplier_return_id == SupplierReturn.id)
            .exists(),
        )
        .correlate(StockLot)
        .scalar_subquery()
    )


async def locked_lot(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    stock_lot_id: uuid.UUID,
) -> tuple[StockLot, GoodsReceipt]:
    """The lot of borrowed goods this store took, held until commit: what is
    on hand is counted against it one command at a time."""
    lot = await session.scalar(
        select(StockLot)
        .where(StockLot.id == stock_lot_id, StockLot.organization_id == organization_id)
        .with_for_update()
    )
    receipt = (
        await session.get(GoodsReceipt, lot.goods_receipt_id)
        if lot is not None and lot.goods_receipt_id is not None
        else None
    )
    if (
        lot is None
        or receipt is None
        or AcquisitionType(lot.acquisition_type) not in PAID_WHEN_SOLD
        or receipt.supplier_id is None
        or receipt.receiving_store_id != store_id
    ):
        raise NotFoundError("Unknown borrowed goods", stock_lot_id=str(stock_lot_id))
    return lot, receipt


async def on_hand(session: AsyncSession, lot: StockLot) -> int:
    row = (
        await session.execute(
            select(_received(), _sold(), _returned()).where(StockLot.id == lot.id)
        )
    ).one()
    return int(row[0]) - int(row[1]) - int(row[2])


async def lots_on_hand(
    session: AsyncSession, *, organization_id: uuid.UUID, product_variant_id: uuid.UUID
) -> list[tuple[uuid.UUID, int]]:
    """A model's borrowed or consignment lots with goods still on hand.

    A merge waits for them (owner decision, 2026-10-03): those goods belong to
    a supplier and go back from their own lot.
    """
    rows = await session.execute(
        select(StockLot.id, _received() - _sold() - _returned())
        .where(
            StockLot.organization_id == organization_id,
            StockLot.product_variant_id == product_variant_id,
            StockLot.acquisition_type.in_(PAID_WHEN_SOLD),
        )
        .order_by(StockLot.id)
    )
    return [(lot_id, int(left)) for lot_id, left in rows.all() if int(left) > 0]


async def ensure_on_hand(session: AsyncSession, lot: StockLot, *, quantity: int) -> None:
    """After a sale or a return is added for `quantity` of the lot: refused,
    and so undone, when it took more than was on hand."""
    left = await on_hand(session, lot)
    if left < 0:
        raise ValidationFailedError(
            "More than is still on hand", reason="MORE_THAN_ON_HAND", on_hand=left + quantity
        )


async def _label(session: AsyncSession, lot: StockLot) -> str:
    names = await describe_variants(session, [lot.product_variant_id])
    sizes = await size_labels(session, [lot.size_id])
    size = sizes.get(lot.size_id)
    name = names[lot.product_variant_id].display_name
    return f"{name}, {size}" if size else name


async def mark_sold(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    stock_lot_id: uuid.UUID,
    quantity: int,
    command_id: uuid.UUID,
    currency_code: str,
    correlation_id: str | None = None,
) -> invoices.InvoiceView:
    """Some of a lot of borrowed goods sold: the store owes the supplier
    their price, as an invoice in «Накладні» (owner decisions, 2026-10-01).
    The owner's and managers' (`supplier:debt`)."""
    scope.require(Permission.SUPPLIER_DEBT, store_id)
    if not 0 < quantity <= MAX_QUANTITY:
        raise ValidationFailedError(f"From 1 to {MAX_QUANTITY}", reason="QUANTITY")
    lot, receipt = await locked_lot(
        session, organization_id=scope.organization_id, store_id=store_id, stock_lot_id=stock_lot_id
    )
    if lot.unit_cost is None or lot.unit_cost <= ZERO:
        raise ValidationFailedError(
            "No price was agreed for these goods", reason="NO_PRICE", stock_lot_id=str(lot.id)
        )
    assert receipt.supplier_id is not None
    view = await invoices.record_invoice(
        session,
        scope=scope,
        store_id=store_id,
        command_id=command_id,
        supplier_id=receipt.supplier_id,
        amount=lot.unit_cost * quantity,
        paid_now=ZERO,
        note=None,
        currency_code=lot.currency_code or currency_code,
        correlation_id=correlation_id,
        sold=invoices.SoldLot(
            stock_lot_id=lot.id, quantity=quantity, label=await _label(session, lot)
        ),
    )
    await ensure_on_hand(session, lot, quantity=quantity)
    return view


async def lot_to_return(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    stock_lot_id: uuid.UUID,
    location_id: uuid.UUID,
    supplier_id: uuid.UUID,
    lines: Sequence[tuple[uuid.UUID, uuid.UUID, int]],
) -> StockLot:
    """A return naming a lot of borrowed goods sends back that lot: its
    warehouse, its supplier, its model and size, nothing else."""
    lot, receipt = await locked_lot(
        session, organization_id=organization_id, store_id=store_id, stock_lot_id=stock_lot_id
    )
    if receipt.supplier_id != supplier_id:
        raise ValidationFailedError(
            "These goods go back to the supplier they came from",
            reason="OTHER_SUPPLIER",
            supplier_id=str(receipt.supplier_id),
        )
    # The lot keeps naming the model it arrived as. If that model was merged
    # since, its goods are the model that stays now, and go back as it: a
    # lot can reopen after a merge, since an invoice or a return may be
    # cancelled at any time (ADR-0008 §5).
    leading = await current_variants(
        session, organization_id=organization_id, variant_ids={lot.product_variant_id}
    )
    if lot.location_id != location_id or [line[:2] for line in lines] != [
        (leading[lot.product_variant_id], lot.size_id)
    ]:
        raise ValidationFailedError(
            "A return of borrowed goods is of their own model and size, from where they are",
            reason="NOT_THE_LOT",
            stock_lot_id=str(lot.id),
        )
    return lot


async def list_borrowed(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    supplier_id: uuid.UUID | None,
    on_hand_only: bool,
    limit: int,
    offset: int,
) -> tuple[list[BorrowedView], bool]:
    """What this store borrowed, newest first: from whom, at what price, and
    how much of it was sold, returned or is still on hand."""
    require_keeper(scope, store_id)
    received, sold, returned = _received(), _sold(), _returned()
    statement = (
        select(StockLot, GoodsReceipt, received, sold, returned)
        .join(GoodsReceipt, GoodsReceipt.id == StockLot.goods_receipt_id)
        .where(
            GoodsReceipt.organization_id == scope.organization_id,
            GoodsReceipt.receiving_store_id == store_id,
            GoodsReceipt.supplier_id.is_not(None),
            StockLot.acquisition_type.in_(PAID_WHEN_SOLD),
        )
    )
    if supplier_id is not None:
        statement = statement.where(GoodsReceipt.supplier_id == supplier_id)
    if on_hand_only:
        statement = statement.where(received - sold - returned > 0)
    rows = (
        await session.execute(
            statement.order_by(GoodsReceipt.created_at.desc(), StockLot.id)
            .limit(limit + 1)
            .offset(offset)
        )
    ).all()
    page = rows[:limit]
    lots = [row[0] for row in page]
    names = await describe_variants(session, list({lot.product_variant_id for lot in lots}))
    held_as = await catalog_current_variants(
        session,
        organization_id=scope.organization_id,
        variant_ids=list({lot.product_variant_id for lot in lots}),
    )
    sizes = await size_labels(session, list({lot.size_id for lot in lots}))
    places = await location_names(
        session,
        organization_id=scope.organization_id,
        location_ids={lot.location_id for lot in lots},
    )
    suppliers = {
        supplier.id: supplier
        for supplier in (
            await session.scalars(
                select(Supplier).where(
                    Supplier.id.in_({row[1].supplier_id for row in page if row[1].supplier_id})
                )
            )
        ).all()
    }
    views = []
    for lot, receipt, came, went_sold, went_back in page:
        assert receipt.supplier_id is not None
        views.append(
            BorrowedView(
                stock_lot_id=lot.id,
                acquisition_type=AcquisitionType(lot.acquisition_type),
                supplier=supplier_view(suppliers[receipt.supplier_id]),
                location_id=lot.location_id,
                location_name=places.get(lot.location_id, ""),
                product_variant_id=lot.product_variant_id,
                held_as_variant_id=held_as.get(lot.product_variant_id, lot.product_variant_id),
                size_id=lot.size_id,
                display_name=names[lot.product_variant_id].display_name,
                size_label=sizes.get(lot.size_id),
                unit_cost=lot.unit_cost,
                currency_code=lot.currency_code,
                received=int(came),
                sold=int(went_sold),
                returned=int(went_back),
                on_hand=int(came) - int(went_sold) - int(went_back),
                at=receipt.created_at,
            )
        )
    return views, len(rows) > limit


__all__ = [
    "PAID_WHEN_SOLD",
    "BorrowedView",
    "ensure_on_hand",
    "list_borrowed",
    "locked_lot",
    "lot_to_return",
    "mark_sold",
    "on_hand",
]
