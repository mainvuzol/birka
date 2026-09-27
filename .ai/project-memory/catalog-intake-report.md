# Controlled catalog intake — 2026-09-27

Status: implemented and verified locally against merged baseline `5b0c037` (PR #28). No commit, push or merge by the agent. This closes the bounded manual new-product intake slice, not all M1C or M1-022.

## Delivered behavior

A reviewer may create a product from a preserved proposal using explicit structured fields, or select a candidate family and add/reuse a variant. The original raw description, parser result, preview and preview revision remain unchanged. No parser field is silently adopted. A repeated name does not silently merge families: a distinct model requires explicit intent and a distinction note. Size and size system are entered explicitly; this UI creates one size per submission (the API supports up to 50).

`POST /catalog/match-decisions/{id}/create-product` reuses the catalog creation service. Product creation, decision resolution, processing state and audit commit atomically. Actual result classification is NEW_MODEL, NEW_VARIANT or SAME_VARIANT. The decision UUID permanently binds the canonical request and frozen product result, independent of expiring idempotency cache. A changed payload or another resolution operation conflicts. Both catalog:create and catalog:confirm are required on the original active store. Full linked identity validation prevents cross-tenant or inactive catalog identity reuse.

This is a fresh manual draft, so a stale preview may be used as evidence without accepting its old match as current. After catalog writes, variant KEY SHARE and knowledge SHARE locks protect final validation. Validation refreshes cached ORM identity fields. The API retries the whole transaction up to three times only for PostgreSQL deadlock/serialization failures, then returns a retriable conflict. No schema migration, stock, money or automatic alias-learning writes are introduced.

The scoped browser journal persists the exact creation payload before sending. Lost successful responses are recovered by replay, never by assuming any APPLIED decision means this command succeeded. Explicit cancellation switches to a durable rejection on the same decision: whichever resolution holds the decision lock first wins. Any existing terminal result is displayed honestly and clears the cancelled pending creation. Access/network failures keep the journal recoverable.

## Changed code

- `backend/app/modules/catalog/intake.py`: atomic decision-bound product creation.
- `backend/app/api/v1/catalog_decisions.py`: endpoint, response metadata and bounded transaction retries.
- `backend/app/modules/catalog/decisions.py`: creation result response, cross-command replay exclusion, fresh identity validation.
- `backend/tests/integration/test_catalog_intake.py`: 12 service/API/replay/concurrency/rollback/security regression cases.
- `frontend/src/catalog/CreateProduct.tsx`, `Catalog.tsx`, `commands.ts`, `types.ts`: explicit intake form, permission visibility, durable recovery and safe cancellation.
- `frontend/e2e/catalog.spec.ts`: real API mobile creation, ambiguity, permissions and lost-response recovery/cancellation coverage.

## Verification

Isolated Python 3.12 virtualenv and PostgreSQL 16.2 under `/tmp`, port 55442. Two disposable databases: `birka_intake_check` and `birka_orders_ui`. No host Docker installation, work databases or global packages changed. Cleanup completed: test API and PostgreSQL stopped; both disposable databases dropped.

- Full backend `pytest -q`: **733 passed**, 33.31s; one dependency deprecation warning from Starlette's httpx TestClient integration.
- Ruff lint clean; Ruff format: **139 files already formatted**.
- Exact CI type command `mypy app scripts`: **77 source files passed**.
- Import-linter: **12 contracts kept, 0 broken**.
- Fresh migrations through `0014_alias_feedback_identity` succeeded on both databases; `alembic check`: **no new upgrade operations**.
- Frontend lint, TypeScript and production build passed.
- Mobile Chromium Playwright against real API/PostgreSQL: **21 passed**, 11.3s. Includes existing customer-order regressions.
- Created-product mobile screenshot inspected; no horizontal overflow. `git diff --check` clean.

Independent review found and corrected final catalog-validation locking, stale ORM references, and blocked recovery after a lost rejection/concurrent reviewer resolution. Regression tests cover these corrected paths.

## Limits and next work

This run did not repeat Docker/PostgreSQL 17 verification or live Telegram-device tests; prior isolated Docker evidence remains in its report. No production deployment is claimed. The creation form offers existing families from the proposal's candidate list; broader family search, multi-size UI, snapshot import (M1-023) and verified alias promotion/evaluation remain separate increments. Raw `1636` remains possible product-code evidence, never an inferred price, size or quantity. No unresolved blocking finding remains for this bounded slice.
