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

### Owner-confirmed scope update (2026-09-15)

The primary warehouse supplies both stores and the child store has a separate warehouse. Add blocked/archived store states, intact/damaged return conditions, negotiated final selling prices (below or above suggested prices), full/installment sale payments and separate purchase-installment tracking. These are requirements, not implemented features. See [owner decisions](project-memory/owner-decisions-2026-09-15.md) before extending transfers, refunds or money handling. M1-029 implemented the warehouse key; the other requirements remain subject to their individual completion reports. The 2026-09-22 review adds staged transfer receipt and explicit shared/private provisioning requirements.

### Inventory granularity

- Inventory is tracked by `location + product_variant + size` since M1-029. Selling store attribution is separate.
- `UNKNOWN_SIZE` is a legitimate domain size for legacy or incomplete data, not a database placeholder.
- Size distribution is never invented.
- Reclassifying `UNKNOWN_SIZE` stock into concrete sizes is an **audited reclassification** — two `ADJUSTMENT` movements plus an audit entry — never a silent rewrite.

### Commands and parsing

- Critical commands (`sale`, `refund`, `transfer`) carry a **permanent** `command_id` with a unique constraint. Business uniqueness never depends on the retention-limited idempotency record.
- `ParseResult` is a pure function of `(raw_text, parser_version)`; the parser reads no catalog state. All learned knowledge enters at the matching step, and `CatalogMatchDecision` records `matcher_version` and `knowledge_revision`.
- A product enters the catalog through a **structured** command first (`POST /catalog/products`): a person names the concept, an optional source and the attributes, and the endpoint creates or reuses the identity chain with no parsing and no matching. Natural-language intake (M1C) lands on the same rows.
- That command **refuses rather than guesses** when `(concept, source, garment_type)` already names a family: the caller either points at that family or declares a `new_model` with a written distinction (ADR-0002). A variant, by contrast, *is* its attribute combination, so restating the same attributes resolves to the same row.
- No **item code** is accepted anywhere yet. Staff very rarely record one (owner confirmation, 2026-09-14). When codes are added they stay optional identifiers backed by evidence — never required for everyday entry, never assumed unique or attributed to an issuer, never inferred from a bare number, and never a reason to merge two products.

### Selling and stock

- A seller may complete a sale when system stock is `0` but the goods are physically present. The stock correction and the sale commit in **one** database transaction, the correction is **exactly** the shortfall, the reason code is `FOUND_DURING_SALE`, and the action is fully audited. The narrow permission `inventory:correct_during_sale` may be granted to sellers; arbitrary `inventory:adjust` stays with manager/owner.
- Inventory quantity may never be negative (`CHECK` constraint), and every quantity change is explained by a `StockMovement`.
- Money uses `NUMERIC(12,2)` and Python `Decimal`. Historical `SaleItem` facts never change.
- Transfers are explicit `TRANSFER_OUT` + `TRANSFER_IN` movements, never sales.
- Legacy availability documents are `InventorySnapshot` evidence and produce only `OPENING_BALANCE` movements.

## Repositories

- Repository: `github.com/mainvuzol/birka` (local checkout path varies by host)
- Current implementation status and branch: `.ai/project-memory/current-milestone.md`
- Frontend path: `frontend/` (implemented scaffold)
- Backend path: `backend/` (implemented scaffold)
- Infra path: `infra/` (implemented scaffold)
- Docs path: `.ai/` plus project docs as created
- ADRs: `.ai/decisions/`, indexed in `.ai/project-memory/architecture-decisions.md`

## Runtime environments

- Local: FastAPI, Vite, PostgreSQL; Compose configuration in `infra/`
- Staging: `<unknown>`
- Production: `<unknown>`

## Commands

Run frontend commands from `frontend/`, backend commands from `backend/` with its Python environment active.

- Frontend: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`; `npm run test:e2e` (isolated real API fixture; see order UI report).
- Backend: `pip install --no-deps --require-hashes -r requirements-dev.lock` then `pip install --no-deps -e ".[dev]"` (ADR-0019), `ruff check .`, `ruff format --check .`, `mypy app`, `lint-imports`, `pytest -q`.
- Real DB tests require `BIRKA_TEST_DATABASE_URL`; without it they explicitly skip.
- E2E: `<unknown>`
- DB migration: set `BIRKA_DATABASE_URL`, run `alembic upgrade head` before starting the updated backend; verify with `alembic check`.

## Protected resources

- Production database: human approval required
- Production deploy: human approval/release policy until explicitly automated
- DNS: human approval required
- Secrets: human approval required
- Destructive migrations: human approval required
- Bulk catalog merge/split affecting history: explicit review required
- `git push`: performed by the product owner, not by an agent
