# Engineering Constitution v3

We are building a production-grade Telegram retail / inventory application that must be easier for real store staff than notebook-based accounting while preserving strong data correctness.

## Primary principles

1. Correctness before speed of implementation.
2. User workflow simplicity before ERP ceremony.
3. Data integrity before convenience.
4. PostgreSQL committed state is authoritative.
5. Frontend/cache/LLM state is not authoritative business state.
6. All inventory-changing operations are transactional and traceable.
7. All retryable critical commands are idempotent.
8. Money never uses binary floating-point arithmetic.
9. Authorization is enforced server-side.
10. Cross-store/tenant access is explicitly authorized.
11. Critical business history is auditable and not silently rewritten.
12. Performance is a product requirement and is measured.
13. Backup without verified restore is not considered reliable backup.
14. Do not introduce distributed infrastructure without measured need.
15. AI may propose; deterministic systems and approved human decisions enforce.

## Catalog principles

16. Catalog display names are not identity.
17. Preserve raw human catalog input immutably.
18. Separate BusinessCategory, GarmentType, CanonicalConcept, ProductFamily, ProductVariant and Size.
19. Keep SourceIdentity separate from model/concept identity; unknown semantic type remains UNKNOWN until confirmed.
20. Same concept/name does not prove the same ProductFamily.
21. `/` is contextual and is not an alias separator by default.
22. Unknown descriptors are preserved rather than guessed.
23. Structured attribute conflicts override superficial semantic similarity.
24. Uncertain matcher decisions must enter human review instead of silently merging products.
25. Matching confidence is evidence-based and may be per field; automation thresholds are calibrated, not invented permanently.
26. Catalog learning uses verified aliases, feedback, statistics and retrieval memory first; no uncontrolled online fine-tuning.
27. Legacy availability documents are InventorySnapshots, not invented transaction history.
28. Taxonomy evolves from real repeated evidence; do not rigidly normalize every rare descriptor.

## Architecture

Frontend: React + TypeScript + Vite + Telegram Mini Apps + TanStack Query + Zustand.

Backend: FastAPI + Pydantic + SQLAlchemy async + Alembic + aiogram.

Database: PostgreSQL.

Infrastructure: Docker Compose + Caddy.

Testing/observability: pytest + HTTPX + Playwright + Sentry + structured logging/correlation IDs.

Prefer a modular monolith until measurements justify extraction.

## Implementation rules

- Understand repository architecture before modifying substantial code.
- Never invent an external API; consult authoritative documentation when behavior depends on it.
- Never modify database schema without an explicit migration.
- Never weaken tests merely to make implementation pass.
- Never bypass domain services for critical stock/money operations without architectural justification.
- Never expose secrets or production credentials.
- Never execute destructive production actions without explicit approval.
- Do not claim `Done` without evidence from relevant checks.
- If verification was not executed, state `NOT VERIFIED`.

## Critical domain invariants

- Inventory cannot become negative due to concurrency bugs.
- Sale and its stock effects commit atomically.
- Retry cannot duplicate Sale/Refund/critical inventory commands.
- Historical SaleItem facts remain stable after catalog changes.
- All stock adjustments are explainable by StockMovement entries.
- Inventory transfers are explicit source/destination movements, not disguised sales.
- Catalog uncertainty must never silently corrupt stock identity.

## Completion policy

A meaningful change is complete only when implementation, relevant tests, migration checks, security/domain review, documentation and known-risk reporting satisfy `definition-of-done.md`.
