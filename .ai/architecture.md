# Reference Architecture v3

```text
Telegram
├── aiogram Bot
└── Mini App
    └── React + TypeScript + Vite
        ├── Telegram/tma.js integration
        ├── TanStack Query (server state)
        └── Zustand (local UI state)
             │
             ▼
           Caddy
             │
             ▼
           FastAPI modular monolith
        ├── Auth / Organizations / Stores / RBAC
        ├── Catalog
        │   ├── RawInput / Normalization
        │   ├── BusinessCategory / GarmentType
        │   ├── CanonicalConcept / ProductFamily / Variant / Size
        │   ├── SourceIdentity / Aliases / Descriptor evidence
        │   └── MatchDecision / Feedback
        ├── Inventory
        │   ├── StockLot
        │   ├── Inventory
        │   ├── StockMovement ledger
        │   └── InventorySnapshot import
        ├── Sales / Refunds / Transfers
        ├── Audit / Outbox / Observability
        ├── Domain Services
        ├── Repositories
        └── SQLAlchemy Async
             │
             ▼
         PostgreSQL
```

## State ownership

- PostgreSQL committed data: authoritative business state.
- FastAPI domain services: deterministic business rules and orchestration.
- Catalog matcher/LLM: suggestions and candidate interpretation, never authoritative stock/money/catalog merge authority.
- TanStack Query: cached server state.
- Zustand: local UX state only.
- Telegram: identity bootstrap/platform integration, not business source of truth.

## Catalog identity boundary

`BusinessCategory -> GarmentType -> CanonicalConcept -> ProductFamily -> ProductVariant -> Size`

See `CATALOG_ARCHITECTURE.md` for full rules. The taxonomy is extensible-first in early milestones.

## Critical sale transaction boundary

```text
BEGIN
  validate tenant/store/user
  resolve idempotency key
  lock or atomically update relevant inventory rows
  verify quantity is available
  create sale
  create immutable sale-item snapshots
  write stock movements
  update inventory
  write outbox events where needed
COMMIT
```

Any failure rolls back all business changes.

## Legacy inventory migration

PDF/notebook availability lists become versioned `InventorySnapshot` evidence. They do not imply purchase/sale event history. Approved imports create traceable opening balances.
