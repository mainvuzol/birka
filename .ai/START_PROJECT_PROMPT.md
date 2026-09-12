# Master Start Prompt — Begin Project Implementation

Use this prompt after extracting this pack into `.ai/` in the repository root.

---

Act as the **Executive Orchestrator** for this repository. The repository contains `.ai/`, which is the governing AI Engineering Organization Pack v3 — Adaptive Catalog & Retail Intelligence Edition.

Your objective is to organize and deliver a production-grade Telegram Mini App for simplified inventory and sales accounting for two related women's outerwear stores. The product must feel simpler and faster than the owner's current notebook-based workflow while preserving strong database correctness, auditability and recoverability.

## Governing instructions

Before implementation, read and follow at minimum:
- `.ai/constitution.md`
- `.ai/PRODUCT_EXCELLENCE_STANDARD.md`
- `.ai/80_20_OPERATING_PROFILE.md`
- `.ai/architecture.md`
- `.ai/CATALOG_ARCHITECTURE.md`
- `.ai/ADAPTIVE_CATALOG_LEARNING.md`
- `.ai/conventions.md`
- `.ai/definition-of-done.md`
- `.ai/project.md`
- `.ai/OPERATING_MANUAL.md`
- `.ai/SKILL_INDEX.md`
- `.ai/project-memory/current-milestone.md`
- relevant policies and specialist skills only as needed.

Treat these files as project policy. Do not silently weaken them.

## Product direction

The product is a Telegram Mini App / POS / inventory system using the approved stack unless repository evidence or an ADR justifies change:
- React + TypeScript + Vite;
- Telegram Mini Apps / tma.js + Telegram UI;
- TanStack Query for server state;
- Zustand for local UI state;
- Python + FastAPI + Pydantic v2;
- SQLAlchemy async + Alembic;
- PostgreSQL;
- aiogram;
- pytest + HTTPX + Playwright;
- Docker Compose + Caddy;
- Sentry + structured logging/correlation IDs.

Prefer a modular monolith. Do not introduce microservices, Kafka, Kubernetes, Elasticsearch, Redis or other distributed infrastructure without measured need and an approved ADR.

## Product UX rule

Do not force store staff to work with technical IDs or mandatory physical labels merely because the database has IDs. The frequent workflows should be at least as easy as the notebook workflow and ideally faster.

Natural-language inventory entry is a core design direction. Preserve raw human input and progressively structure it.

## Catalog model

Use an extensible-first model:

`Raw Input -> Normalization -> Aliases/Descriptor Evidence -> BusinessCategory + GarmentType -> CanonicalConcept -> ProductFamily -> ProductVariant -> Size -> StockLot -> Inventory -> StockMovement`.

Important rules:
- `BusinessCategory` and `GarmentType` are separate.
- `SourceIdentity` is separate from model identity and may initially have semantic type `UNKNOWN`.
- same concept name across different sources must not be automatically merged into one ProductFamily;
- `/` is not an alias delimiter by default; it may enumerate variants, e.g. `Лама бежевая/персик/butter` represents multiple color variants;
- preserve `raw_input` immutably;
- preserve unknown terms as `unclassified_descriptors` rather than guessing;
- inventory is stored by store + variant + size where relevant;
- historical PDFs/notebook lists are `InventorySnapshot` evidence, not invented transaction history.

The taxonomy is intentionally not fully frozen yet. Build the catalog foundation so attributes can evolve without destructive schema rewrites. Core development may start now.

## Adaptive matching

Use the controlled learning model from `.ai/ADAPTIVE_CATALOG_LEARNING.md`:
1. deterministic normalization/dictionaries;
2. verified aliases;
3. lexical/fuzzy retrieval;
4. structured attribute extraction;
5. semantic retrieval only when useful;
6. optional LLM parser/reranker;
7. per-field confidence and candidate-margin policy;
8. human confirmation in uncertain cases;
9. feedback/alias evidence accumulation.

Every matcher decision must distinguish:
`SAME_VARIANT`, `NEW_VARIANT`, `NEW_MODEL`, `NEW_CATEGORY`, `AMBIGUOUS`.

LLM output is never authoritative for stock, money, permissions, or final catalog merging. Do not implement online fine-tuning after each correction.

## Critical domain invariants

At minimum:
- PostgreSQL committed state is authoritative.
- Inventory cannot become negative because of concurrency bugs.
- Sale and all stock effects commit atomically.
- Retry cannot duplicate a sale/refund/critical inventory command.
- Stock changes are represented through an auditable StockMovement ledger.
- Money uses fixed-precision decimal arithmetic, never binary float.
- Historical SaleItem price/name snapshots remain historically stable.
- Corrections use explicit/compensating operations instead of silently rewriting critical history.
- Authorization is server-side.
- Store/tenant data boundaries are enforced server-side.
- Destructive production operations require human approval.
- An uncertain catalog interpretation must never silently merge distinct goods.

## Your first phase: planning, not mass implementation

Do NOT immediately scaffold the entire application.

Perform these steps first:
1. Confirm which governing files you read.
2. Inspect the repository and create a repository map.
3. Report current code/tooling state without guessing.
4. Create `KNOWN FACTS`, `ASSUMPTIONS`, `UNKNOWN / NEEDS BUSINESS CONFIRMATION` as separate sections.
5. Propose domain model v1, including catalog, stores, inventory, sales, transfers, lots, snapshots, aliases/matching feedback and audit.
6. Define critical business invariants and DB transaction boundaries.
7. Propose modular-monolith module boundaries and API boundaries.
8. Define the MVP 80/20 scope.
9. Define Milestone 1: **Production Foundation Without Irreversible Catalog Assumptions**.
10. Build a dependency graph and concrete tasks using `.ai/templates/task.yaml` semantics.
11. Identify which tasks can safely run in parallel.
12. Identify genuinely blocking questions only.
13. Present the plan for human approval before broad implementation.

## Milestone 1 expected direction

Milestone 1 should normally include foundations such as:
- project structure;
- configuration and local environment;
- PostgreSQL/SQLAlchemy/Alembic;
- Telegram authentication foundation;
- Organization/Store/User/RBAC foundations;
- catalog extensibility foundation and immutable RawInput;
- Inventory / StockLot / StockMovement;
- InventorySnapshot import foundation;
- Sale/SaleItem and transaction/idempotency foundations;
- audit/logging/correlation IDs;
- test infrastructure;
- Docker/CI foundations.

Do not lock the final catalog taxonomy or aggressive auto-matching thresholds in Milestone 1.

## Verification

Never claim completion without evidence. Use `NOT VERIFIED` explicitly for checks you could not execute. Critical stock/catalog matching behavior requires independent review and automated tests appropriate to the risk.

Now begin with repository analysis and the planning deliverables above. Do not start broad implementation until the plan is presented.

---
