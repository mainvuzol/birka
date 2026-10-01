"""Single import point for every ORM model.

Alembic must see every table before it compares metadata to the database;
without this, a model that nothing else imports silently disappears from
migrations. Import this module — never rely on import side effects elsewhere.
"""

from app.core.idempotency import IdempotencyRecord
from app.modules.audit.models import AuditLog
from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.backups.models import BackupAlert, BackupRun
from app.modules.catalog.evidence import (
    AliasEvidence,
    CatalogMatchDecision,
    ParseResult,
    ProductAlias,
    RawInput,
    RawInputProcessing,
)
from app.modules.catalog.models import (
    AttributeTerm,
    BusinessCategory,
    CanonicalConcept,
    GarmentType,
    ProductFamily,
    ProductVariant,
    Size,
    SizeAlias,
    SizeSystem,
    SourceIdentity,
    VariantPrice,
)
from app.modules.credit.models import CreditEntry, CustomerCredit
from app.modules.damaged.models import DamagedUnit
from app.modules.identity.models import AppUser
from app.modules.inventory.models import (
    GoodsReceipt,
    Inventory,
    StockAdjustment,
    StockLot,
    StockMovement,
    StockReservation,
)
from app.modules.orders.models import (
    CustomerOrder,
    CustomerOrderItem,
    CustomerOrderShippingChange,
    OrderCommand,
)
from app.modules.refunds.models import Refund, RefundItem
from app.modules.sales.models import Sale, SaleItem
from app.modules.snapshots.models import (
    InventorySnapshot,
    InventorySnapshotAllocation,
    InventorySnapshotRow,
)
from app.modules.suppliers.models import (
    Supplier,
    SupplierInvoice,
    SupplierInvoiceCancel,
    SupplierInvoiceEntry,
    SupplierInvoiceEntryCancel,
    SupplierReturn,
    SupplierReturnCancel,
    SupplierReturnLine,
)
from app.modules.tenancy.models import (
    Organization,
    StockLocation,
    Store,
    StoreLocationAccess,
    StoreStateChange,
)
from app.modules.transfers.models import Transfer, TransferItem

__all__ = [
    "AliasEvidence",
    "AppUser",
    "AttributeTerm",
    "AuditLog",
    "BackupAlert",
    "BackupRun",
    "BusinessCategory",
    "CanonicalConcept",
    "CatalogMatchDecision",
    "CreditEntry",
    "CustomerCredit",
    "CustomerOrder",
    "CustomerOrderItem",
    "CustomerOrderShippingChange",
    "DamagedUnit",
    "GarmentType",
    "GoodsReceipt",
    "IdempotencyRecord",
    "Inventory",
    "InventorySnapshot",
    "InventorySnapshotAllocation",
    "InventorySnapshotRow",
    "Membership",
    "OrderCommand",
    "Organization",
    "ParseResult",
    "ProductAlias",
    "ProductFamily",
    "ProductVariant",
    "RawInput",
    "RawInputProcessing",
    "Refund",
    "RefundItem",
    "Role",
    "RolePermission",
    "Sale",
    "SaleItem",
    "Size",
    "SizeAlias",
    "SizeSystem",
    "SourceIdentity",
    "StockAdjustment",
    "StockLocation",
    "StockLot",
    "StockMovement",
    "StockReservation",
    "Store",
    "StoreLocationAccess",
    "StoreStateChange",
    "Supplier",
    "SupplierInvoice",
    "SupplierInvoiceCancel",
    "SupplierInvoiceEntry",
    "SupplierInvoiceEntryCancel",
    "SupplierReturn",
    "SupplierReturnCancel",
    "SupplierReturnLine",
    "Transfer",
    "TransferItem",
    "VariantPrice",
]
