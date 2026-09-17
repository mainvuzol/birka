"""Single import point for every ORM model.

Alembic must see every table before it compares metadata to the database;
without this, a model that nothing else imports silently disappears from
migrations. Import this module — never rely on import side effects elsewhere.
"""

from app.core.idempotency import IdempotencyRecord
from app.modules.audit.models import AuditLog
from app.modules.authz.models import Membership, Role, RolePermission
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
from app.modules.identity.models import AppUser
from app.modules.inventory.models import (
    Inventory,
    InventorySnapshot,
    InventorySnapshotRow,
    StockLot,
    StockMovement,
)
from app.modules.refunds.models import Refund, RefundItem
from app.modules.sales.models import Sale, SaleItem
from app.modules.tenancy.models import Organization, StockLocation, Store, StoreLocationAccess
from app.modules.transfers.models import Transfer, TransferItem

__all__ = [
    "AliasEvidence",
    "AppUser",
    "AttributeTerm",
    "AuditLog",
    "BusinessCategory",
    "CanonicalConcept",
    "CatalogMatchDecision",
    "GarmentType",
    "IdempotencyRecord",
    "Inventory",
    "InventorySnapshot",
    "InventorySnapshotRow",
    "Membership",
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
    "StockLocation",
    "StockLot",
    "StockMovement",
    "Store",
    "StoreLocationAccess",
    "Transfer",
    "TransferItem",
    "VariantPrice",
]
