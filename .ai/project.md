# Project Configuration v3

## Product

- Name: `birka`
- Domain: Telegram Mini App / POS / Inventory for women's outerwear retail
- Current business shape: one parent/primary store and one related/child store
- Primary users: Owner, Admin/Manager, Seller
- Primary UX competitor: paper notebook / manual stock lists
- UX objective: frequent stock/sale workflows must be no harder than notebook entry and ideally faster
- Tenant model: start organization-aware; do not assume future SaaS is impossible
- Currency: **UAH**

## Approved technology direction

Frontend: React + TypeScript + Vite + Telegram Mini Apps/tma.js + Telegram UI + TanStack Query + Zustand

Backend: Python + FastAPI + Pydantic v2 + SQLAlchemy async + Alembic + aiogram

Data/infra: **PostgreSQL ≥ 15, pinned to 17** + Docker Compose + Caddy + Sentry/structured logging

Testing: pytest + HTTPX + Playwright

Architecture: modular monolith with CI-enforced module boundaries — see [ADR-0001](decisions/ADR-0001-module-boundaries.md)

The PostgreSQL floor comes from `UNIQUE NULLS NOT DISTINCT` — see [ADR-0002](decisions/ADR-0002-catalog-identity-and-nullable-uniqueness.md).

## Catalog status

- Real legacy PDFs have been supplied and satisfy the real-data requirement. Originals are private and are **not** committed: they live under a gitignored `data/legacy/raw/`. The sanitized, versioned golden parser corpus lives in `backend/tests/fixtures/`.
- Core taxonomy is extensible-first and not yet frozen.
- Core identity direction: BusinessCategory + GarmentType + CanonicalConcept + ProductFamily + ProductVariant + Size.
- **ProductFamily has independent identity.** `(concept, source, garment_type)` is a strong matching signal and candidate key, **not** absolute business identity; several families may share that triple. Automatic merge is forbidden. See ADR-0002.
- SourceIdentity is separate and may remain semantically `UNKNOWN` indefinitely.
- RawInput is immutable evidence; its processing lifecycle lives in a separate mutable row, never on the evidence itself.
- Slash-separated text may enumerate variants; it is not alias syntax.
- Controlled adaptive matching uses per-field confidence, candidate margin and human confirmation.
- **No LLM parsing and no embeddings in Milestone 1** (confirmed). Matcher v1 is deterministic: verified aliases → `pg_trgm` → structured attribute-conflict rules.
- No online fine-tuning.
- Core platform development may begin before taxonomy v1 freeze.

## Confirmed domain rules

### Money

- Currency is **UAH**. `currency_code` is stored explicitly on every monetary row.
- A store/variant may carry a **current suggested selling price** (`variant_price`) so the seller does not retype it. It is a convenience, never an authority.
- `SaleItem` always freezes its own `unit_price`, `discount_amount`, `final_unit_price` and `currency_code`. Those values are immutable and are never recomputed from the catalog.
- Acquisition/purchase cost belongs to `StockLot`, never to catalog identity.
- Item-level discount **data** is supported in M1. A discount or promotion **engine** is not built.
- Money uses PostgreSQL `NUMERIC(12,2)` and Python `Decimal` only. Binary floating point is banned and the ban is lint-enforced.

### Inventory granularity

- Inventory is tracked by `store + product_variant + size` when size is known.
- `UNKNOWN_SIZE` is a legitimate domain size for legacy or incomplete data, not a database placeholder.
- Size distribution is never invented.
- Reclassifying `UNKNOWN_SIZE` stock into concrete sizes is an **audited reclassification** — two `ADJUSTMENT` movements plus an audit entry — never a silent rewrite.

### Commands and parsing

- Critical commands (`sale`, `refund`, `transfer`) carry a **permanent** `command_id` with a unique constraint. Business uniqueness never depends on the retention-limited idempotency record.
- `ParseResult` is a pure function of `(raw_text, parser_version)`; the parser reads no catalog state. All learned knowledge enters at the matching step, and `CatalogMatchDecision` records `matcher_version` and `knowledge_revision`.

### Selling and stock

- A seller may complete a sale when system stock is `0` but the goods are physically present. The stock correction and the sale commit in **one** database transaction, the correction is **exactly** the shortfall, the reason code is `FOUND_DURING_SALE`, and the action is fully audited. The narrow permission `inventory:correct_during_sale` may be granted to sellers; arbitrary `inventory:adjust` stays with manager/owner.
- Inventory quantity may never be negative (`CHECK` constraint), and every quantity change is explained by a `StockMovement`.
- Money uses `NUMERIC(12,2)` and Python `Decimal`. Historical `SaleItem` facts never change.
- Transfers are explicit `TRANSFER_OUT` + `TRANSFER_IN` movements, never sales.
- Legacy availability documents are `InventorySnapshot` evidence and produce only `OPENING_BALANCE` movements.

## Repositories

- Repository root: `D:\VScode\birka` (`github.com/mainvuzol/birka`)
- Implementation branch: `feat/foundation-milestone-1`
- Frontend path: `frontend/` (approved, not yet created)
- Backend path: `backend/` (approved, not yet created)
- Infra path: `infra/` (approved, not yet created)
- Docs path: `.ai/` plus project docs as created
- ADRs: `.ai/decisions/`, indexed in `.ai/project-memory/architecture-decisions.md`

## Runtime environments

- Local: `<unknown>` — defined by task M1-002
- Staging: `<unknown>`
- Production: `<unknown>`

## Commands

Nothing is scaffolded yet. These stay `<unknown>` until task M1-001 creates the toolchain; do not invent commands that do not exist.

- Frontend install / lint / typecheck / test / build: `<unknown>`
- Backend install / lint / typecheck / test: `<unknown>`
- E2E: `<unknown>`
- DB migration upgrade: `<unknown>`

## Protected resources

- Production database: human approval required
- Production deploy: human approval/release policy until explicitly automated
- DNS: human approval required
- Secrets: human approval required
- Destructive migrations: human approval required
- Bulk catalog merge/split affecting history: explicit review required
- `git push`: performed by the product owner, not by an agent
