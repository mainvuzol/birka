# Project Configuration v3

## Product

- Name: `<PRODUCT_NAME>`
- Domain: Telegram Mini App / POS / Inventory for women's outerwear retail
- Current business shape: one parent/primary store and one related/child store
- Primary users: Owner, Admin/Manager, Seller
- Primary UX competitor: paper notebook / manual stock lists
- UX objective: frequent stock/sale workflows must be no harder than notebook entry and ideally faster
- Tenant model: start organization-aware; do not assume future SaaS is impossible
- Currency: `<CONFIRM>`

## Approved technology direction

Frontend: React + TypeScript + Vite + Telegram Mini Apps/tma.js + Telegram UI + TanStack Query + Zustand

Backend: Python + FastAPI + Pydantic v2 + SQLAlchemy async + Alembic + aiogram

Data/infra: PostgreSQL + Docker Compose + Caddy + Sentry/structured logging

Testing: pytest + HTTPX + Playwright

## Catalog status

- Real legacy examples are still being collected.
- Core taxonomy is extensible-first and not yet fully frozen.
- Core identity direction: BusinessCategory + GarmentType + CanonicalConcept + ProductFamily + ProductVariant + Size.
- SourceIdentity is separate and may initially have type UNKNOWN.
- RawInput is immutable evidence.
- Slash-separated text may enumerate variants; it is not automatically alias syntax.
- Controlled adaptive matching uses confidence, candidate margin and human confirmation.
- No online fine-tuning.
- Core platform development may begin before taxonomy v1 freeze.

## Repositories

- Repository root: `<fill after agent repo-map>`
- Frontend path: `<to be decided by architecture plan>`
- Backend path: `<to be decided by architecture plan>`
- Infra path: `<to be decided by architecture plan>`
- Docs path: `.ai/` plus project docs as created

## Runtime environments

- Local: `<details>`
- Staging: `<details>`
- Production: `<details>`

## Commands

Populate after repository scaffolding; do not invent commands that do not exist.

- Frontend install: `<unknown>`
- Frontend lint: `<unknown>`
- Frontend typecheck: `<unknown>`
- Frontend test: `<unknown>`
- Frontend build: `<unknown>`
- Backend install: `<unknown>`
- Backend lint: `<unknown>`
- Backend typecheck: `<unknown>`
- Backend test: `<unknown>`
- E2E: `<unknown>`
- DB migration upgrade: `<unknown>`

## Protected resources

- Production database: human approval required
- Production deploy: human approval/release policy until explicitly automated
- DNS: human approval required
- Secrets: human approval required
- Destructive migrations: human approval required
- Bulk catalog merge/split affecting history: explicit review required
