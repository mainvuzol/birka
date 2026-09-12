# AI Engineering Organization Pack v3 — Adaptive Catalog & Retail Intelligence Edition

A project operating system for building a production-grade Telegram Mini App / POS / Inventory system with an AI-assisted engineering team.

Version 3 retains the v2 80/20 Product Excellence rules and adds the catalog architecture learned from real inventory records from the target stores.

## What is new in v3

The catalog is no longer treated as a simple `product_name` problem. The pack now defines:

- raw-input preservation;
- BusinessCategory vs GarmentType separation;
- CanonicalConcept -> ProductFamily -> ProductVariant -> Size identity;
- SourceIdentity as a separate, initially possibly unknown business dimension;
- contextual slash parsing (variant enumeration vs aliases);
- size-level inventory with multiple size systems;
- legacy InventorySnapshot migration;
- controlled self-learning through aliases, feedback and retrieval memory;
- deterministic/fuzzy/semantic/LLM hybrid matching;
- per-field confidence, candidate margin and contradiction checks;
- explicit SAME_VARIANT / NEW_VARIANT / NEW_MODEL / NEW_CATEGORY / AMBIGUOUS outcomes;
- taxonomy evolution without premature schema rigidity;
- no uncontrolled online fine-tuning.

Read `CATALOG_ARCHITECTURE.md` and `ADAPTIVE_CATALOG_LEARNING.md` before catalog implementation.

## Start in an existing Git repository

1. Extract this pack into `.ai/` at the repository root.
2. Do **not** commit the ZIP itself; commit the extracted `.ai/` text files.
3. Copy the relevant bridge template from `.ai/integration/` to the location your coding agent recognizes (`AGENTS.md`, `CLAUDE.md`, Cursor rule, or generic project instructions).
4. Read `REPOSITORY_INSTALLATION.md`.
5. Start the first agent session with the prompt in `START_PROJECT_PROMPT.md`.
6. The first session should analyze and plan. Do not ask it to mass-generate the whole application immediately.

## Governing core

Always-on/high-priority files:
- `constitution.md`
- `PRODUCT_EXCELLENCE_STANDARD.md`
- `80_20_OPERATING_PROFILE.md`
- `conventions.md`
- `definition-of-done.md`
- `project.md`
- `CATALOG_ARCHITECTURE.md`
- `ADAPTIVE_CATALOG_LEARNING.md`
- `project-memory/current-milestone.md`

Use `skills/executive-orchestrator.md` for large tasks, loading only the specialist skills needed for the risk.

## Product philosophy

The application should simplify the owner's life, not force ERP ceremony onto a fast-moving store. Technical IDs exist internally; store staff should interact with natural names and fast flows. The system must accept imperfect human language, preserve evidence, learn from confirmations and protect business truth with deterministic backend/database rules.

## Target stack

Frontend:
- React + TypeScript + Vite
- Telegram Mini Apps / tma.js
- Telegram UI
- TanStack Query
- Zustand

Backend:
- Python + FastAPI
- Pydantic v2
- SQLAlchemy async
- Alembic
- aiogram

Data / Infra:
- PostgreSQL
- Docker Compose
- Caddy
- Sentry / structured logs / correlation IDs
- pytest + HTTPX
- Playwright

## Practical AI team

Use approximately 10–12 durable roles rather than dozens of simultaneously running agents:
1. Executive Orchestrator
2. Product & Retail Domain Strategist
3. Solution / Catalog Architect
4. Frontend + Telegram Engineer
5. Backend Engineer
6. Database / Concurrency Engineer
7. Security Engineer
8. QA / Eval Architect
9. Independent Reviewer
10. DevOps / SRE
11. Research / Documentation
12. Release Manager

Skills are loaded dynamically based on task risk.

## Core workflow

`RESEARCH -> REQUIREMENTS -> ARCHITECTURE -> TASK GRAPH -> IMPLEMENT -> TEST -> REVIEW -> ATTACK -> FIX -> VERIFY -> DOCUMENT -> RELEASE`

Catalog ingestion has an additional evidence loop:

`RAW -> PARSE -> RETRIEVE -> SCORE -> CONFIRM IF NEEDED -> APPLY -> FEEDBACK -> EVAL`

## Golden rules

- PostgreSQL committed state is authoritative.
- Catalog names are not database identity.
- Raw catalog input is never discarded.
- Uncertainty is represented explicitly; do not guess.
- False catalog merge is more dangerous than one confirmation tap.
- All inventory-changing operations are transactional and auditable.
- Critical retryable commands are idempotent.
- Money uses fixed-precision decimals.
- Authorization is server-side.
- LLM suggestions are not authority for stock, money, permissions or final catalog merging.
- No completion claim without verification evidence.
