"""Units returned damaged, one row each, while they are in a store's «Брак».

The owner decided on 2026-10-01 (business-rules.md, "what happens in «Брак»"):

- a unit returned damaged goes to the store's own «Брак», marked damaged;
- from there anyone who takes returns may take it for inspection, which the
  others can see;
- after inspection it either goes back on sale — to the warehouse it was
  sold from — or stays, as «брак підтверджений», no longer for sale;
- a confirmed unit's fate is decided later: anyone who takes returns may
  write it off, and the owner and managers may return it to the supplier
  instead (owner decision, 2026-10-01, "returns to a supplier"); that return
  may be cancelled, and the unit is confirmed damaged in «Брак» again;
- stock in «Брак» changes only through returns and this section.

The stock itself stays in the ledger: a unit's return to sale is a transfer,
its write-off a stock adjustment. A row here says only which unit it is, where
it came from and where it stands. Because nothing else may move stock in or
out of «Брак», the units not yet gone always add up to what «Брак» holds.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class DamagedStatus(StrEnum):
    # Returned damaged; nobody has looked yet.
    AWAITING = "AWAITING"
    # Someone took it for inspection; the others see who.
    INSPECTING = "INSPECTING"
    # «Брак підтверджений»: stays in «Брак», no longer for sale.
    CONFIRMED = "CONFIRMED"
    # Back on sale, in the warehouse it was sold from. Gone from «Брак».
    RETURNED = "RETURNED"
    # Written off. Gone from «Брак».
    WRITTEN_OFF = "WRITTEN_OFF"
    # Returned to the supplier. Gone from «Брак» while that return stands.
    SUPPLIER = "SUPPLIER"


# The statuses of a unit still in «Брак».
IN_BIN = frozenset({DamagedStatus.AWAITING, DamagedStatus.INSPECTING, DamagedStatus.CONFIRMED})


class DamagedUnit(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "damaged_unit"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    # The store whose «Брак» holds it, which took the return.
    store_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    # The «Брак» itself.
    location_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("product_variant.id"), nullable=False
    )
    size_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("size.id"), nullable=False
    )
    # The damaged return it came back in.
    refund_item_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("refund_item.id"), nullable=False
    )
    # Where it goes back on sale: the warehouse it was sold from.
    sold_from_location_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    # From the receipt, so the list reads the way the sale did.
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    size_label: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, server_default=DamagedStatus.AWAITING.value
    )
    # Who last changed its status, and when; for INSPECTING, who is looking.
    status_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True
    )
    status_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The ledger fact that took it out of «Брак»: the transfer back on sale,
    # or the stock adjustment that wrote it off.
    transfer_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("transfer.id"), nullable=True
    )
    stock_adjustment_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("stock_adjustment.id"), nullable=True
    )
    # The return to a supplier that took it, while it stands; cleared when it
    # is cancelled, which the return's own history keeps.
    supplier_return_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("supplier_return.id", use_alter=True, name="fk_damaged_unit_supplier_return"),
        nullable=True,
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "store_id"],
            ["store.organization_id", "store.id"],
            name="fk_damaged_unit_org_store",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_damaged_unit_org_location",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["organization_id", "sold_from_location_id"],
            ["stock_location.organization_id", "stock_location.id"],
            name="fk_damaged_unit_org_sold_from",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status IN ('AWAITING', 'INSPECTING', 'CONFIRMED', 'RETURNED', 'WRITTEN_OFF', "
            "'SUPPLIER')",
            name="status_known",
        ),
        # Anyone looking is someone; a unit nobody touched has no one.
        CheckConstraint(
            "(status = 'AWAITING') = (status_by_user_id IS NULL AND status_at IS NULL)",
            name="touched_has_who_and_when",
        ),
        # Gone from «Брак» by exactly the ledger fact that says how.
        CheckConstraint(
            "(status = 'RETURNED') = (transfer_id IS NOT NULL)", name="returned_by_transfer"
        ),
        CheckConstraint(
            "(status = 'WRITTEN_OFF') = (stock_adjustment_id IS NOT NULL)",
            name="written_off_by_adjustment",
        ),
        CheckConstraint(
            "(status = 'SUPPLIER') = (supplier_return_id IS NOT NULL)",
            name="with_the_supplier_by_a_return",
        ),
        Index("ix_damaged_unit_store_id_status", "store_id", "status"),
        Index("ix_damaged_unit_refund_item_id", "refund_item_id"),
    )


__all__ = ["IN_BIN", "DamagedStatus", "DamagedUnit"]
