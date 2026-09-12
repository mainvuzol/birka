# Milestone 1 Plan — Production Foundation Without Irreversible Catalog Assumptions

**Status:** `PROPOSED — AWAITING HUMAN APPROVAL`
**Branch:** `feat/foundation-milestone-1`
**Prepared by:** Executive Orchestrator run #1 (planning only)
**Implementation started:** NO — no application code exists yet
**Verification status:** `NOT VERIFIED` — no build, test, or migration has been executed, because none exists yet

---

## 1. Governing files actually read

Read in full during this run:

| File | Purpose taken from it |
|---|---|
| `.ai/constitution.md` | 28 principles, critical invariants, completion policy |
| `.ai/PRODUCT_EXCELLENCE_STANDARD.md` | 10-point standard, 80/20 first-class workflows, authority model |
| `.ai/80_20_OPERATING_PROFILE.md` | Role set, mandatory specialist checks by risk class |
| `.ai/architecture.md` | Reference topology, state ownership, sale transaction boundary |
| `.ai/CATALOG_ARCHITECTURE.md` | Identity layers, SourceIdentity, slash rule, attribute promotion rules |
| `.ai/ADAPTIVE_CATALOG_LEARNING.md` | Matching pipeline, 5 decision types, per-field confidence, margin, no online FT |
| `.ai/conventions.md` | Python/FastAPI/Postgres/TS conventions, git conventions |
| `.ai/definition-of-done.md` | DoD checklist and required completion evidence |
| `.ai/project.md` | Product config, approved stack, protected resources, `<CONFIRM>` gaps |
| `.ai/OPERATING_MANUAL.md` | Workflow classes, task contracts, approval gates, memory rules |
| `.ai/SKILL_INDEX.md` | 96 skills available |
| `.ai/project-memory/current-milestone.md` | Milestone 1 definition and focus |
| `.ai/project-memory/business-rules.md` | 13 durable business rules |
| `.ai/project-memory/glossary.md` | Domain vocabulary |
| `.ai/project-memory/known-risks.md` | 8 known risks |
| `.ai/project-memory/architecture-decisions.md` | Empty ADR index |
| `.ai/policies/tool-permissions.md` | Level 0–4 permission model |
| `.ai/policies/security-guardrails.md` | Untrusted-input and authorization rules |
| `.ai/policies/llm-operating-rules.md` | Evidence and anti-fabrication rules |
| `.ai/templates/task.yaml` | Task contract schema used in §10 |
| `.ai/workflows/sale.md`, `refund.md`, `inventory-adjustment.md`, `catalog-ingestion.md`, `legacy-inventory-snapshot-import.md` | Required sequences and required tests |
| `.ai/skills/` (16 files) | `executive-orchestrator`, `adaptive-catalog-architect`, `catalog-normalization-parser`, `catalog-matcher`, `catalog-confidence-policy`, `product-family-identity`, `source-identity-classifier`, `size-inventory-specialist`, `legacy-inventory-import`, `inventory-ledger-specialist`, `concurrency-transactions`, `financial-integrity`, `multi-tenancy-architect`, `rbac-permission-designer`, `modular-monolith-guardian`, `telegram-mini-app-specialist`, `high-frequency-pos-ux` |
| `.ai/README.md`, `INTEGRATION_GUIDE.md`, `REPOSITORY_INSTALLATION.md` | Pack usage and startup rules |

Not read (not needed for this planning run): the remaining ~79 skill files, `CHANGELOG_V2/V3.md`, `CHECKSUMS.sha256`, `manifest.json`, `examples/`, `templates/` other than `task.yaml`.

---

## 2. Repository map and current state

```text
D:\VScode\birka                      git repo, branch feat/foundation-milestone-1
├── .git/
├── .ai/                             153 files — governance pack v3 (committed 09a2456)
│   ├── *.md                         17 root governing documents
│   ├── skills/                      96 specialist skills
│   ├── workflows/                   10 workflow definitions
│   ├── templates/                   13 templates
│   ├── policies/                    3 policies
│   ├── integration/                 4 bridge templates
│   ├── project-memory/              5 durable memory files
│   ├── profiles/, examples/         3 files
│   └── manifest.json, CHECKSUMS.sha256
├── .cursor/rules/project-governance.mdc
├── AGENTS.md                        bridge file
├── CLAUDE.md                        bridge file
└── README.md                        2 lines
```

**Current code/tooling state — measured, not assumed:**

| Probe | Result |
|---|---|
| Application source code | NONE |
| `package.json` / `pyproject.toml` / `requirements.txt` | ABSENT |
| `docker-compose.yml` / `Dockerfile` / `Caddyfile` | ABSENT |
| `.github/` (CI) | ABSENT |
| `.gitignore` | ABSENT — **must be created before any dependency or env work** |
| `.env` / secrets in repo | NONE (good) |
| Migrations / database | NONE |
| Tests | NONE |
| Build/lint/test commands | NONE — `project.md` `<unknown>` entries are accurate |

**Conclusion:** this is a greenfield repository containing governance only. There is no legacy code to preserve, no existing architecture to reverse-engineer, and no migration-compatibility burden. Every `<unknown>` in `.ai/project.md` is currently correct and must not be filled with invented commands.

---

## 3. Known facts / Assumptions / Unknown

### 3.1 KNOWN FACTS

Sourced from `.ai/` governance, the repository itself, or the board-level product brief.

- F1. Greenfield repository; only governance files exist (measured, §2).
- F2. Business shape: one organization, one primary store and one related/child store.
- F3. Product is a Telegram Mini App for inventory + sales of women's outerwear.
- F4. The competing product is a paper notebook. Frequent flows must be no harder than the notebook.
- F5. Frequent operations are: goods receipt, sale, product search, inter-store transfer, stock check, error correction, return.
- F6. Natural-language entry is a core UX direction, e.g. `мышка шоколад гладкая 5`, `дубленка Лоран шоколад замш 70 см 2 шт`.
- F7. Catalog identity chain is mandated: RawInput → Normalization → Aliases/Evidence → BusinessCategory + GarmentType → CanonicalConcept → ProductFamily → ProductVariant → Size → StockLot → Inventory → StockMovement.
- F8. `BusinessCategory` and `GarmentType` are separate concepts.
- F9. `SourceIdentity` (Belardi / Ponte / Garcia / Manzari-like) is stored separately from model identity; default semantic type is `UNKNOWN`.
- F10. Same `CanonicalConcept` name across different sources does **not** prove the same `ProductFamily`.
- F11. `/` is not an alias delimiter; `Лама бежевая/персик/butter` is one concept with three colour variants.
- F12. When a total quantity covers several slash variants and distribution is unstated, distribution is `UNKNOWN` / `NEEDS_REVIEW` — never `1+1+1`.
- F13. Raw input is immutable evidence; interpretation is stored separately.
- F14. Matcher decisions must be one of `SAME_VARIANT`, `NEW_VARIANT`, `NEW_MODEL`, `NEW_CATEGORY`, `AMBIGUOUS`.
- F15. Confidence is per field; a low `garment_type` score must not discard a confident `model`/`color`/`size` parse.
- F16. Automatic matching requires both top confidence and candidate margin; structured attribute conflicts outrank semantic similarity.
- F17. Learning is via verified aliases, statistics, retrieval memory and feedback. No online fine-tuning after each correction.
- F18. Inventory cannot become negative through concurrency; sale + items + movements + inventory update are atomic; retries must not duplicate critical commands.
- F19. Money never uses binary floating point; historical `SaleItem` facts stay stable.
- F20. Transfers are `TRANSFER_OUT` + `TRANSFER_IN`, never disguised sales.
- F21. Legacy PDFs/notebooks are `InventorySnapshot` evidence, not invented purchase/sale history.
- F22. Sizes mix alpha (`XS…3XL`) and numeric (`36…44+`); no fixed enum.
- F23. Unproven terms are preserved as `unclassified_descriptor` with accumulating evidence.
- F24. Approved stack is fixed (React/TS/Vite/tma.js/TanStack Query/Zustand; FastAPI/Pydantic v2/SQLAlchemy async/Alembic/aiogram; PostgreSQL; Docker Compose + Caddy; pytest/HTTPX/Playwright; Sentry + structured logs + correlation IDs).
- F25. Modular monolith. No microservices/Kafka/K8s/Elasticsearch/Redis without measured need and an ADR.
- F26. Acquisition types to support at least conceptually: `PURCHASE`, `CONSIGNMENT`, `BORROWED`, `TRANSFER`, `RETURN`, `ADJUSTMENT`.
- F27. LLM output is never authoritative for money, stock, permissions, final accounting or final catalog merge.
- F28. Protected operations requiring human approval are listed in `.ai/project.md` and `policies/tool-permissions.md`.

### 3.2 ASSUMPTIONS (bounded, recorded, revisable)

Each assumption has a default, a blast radius and a revision cost. None of these blocks Milestone 1.

| # | Assumption | Default taken | If wrong |
|---|---|---|---|
| A1 | Catalog is shared org-wide; inventory is per store | One catalog, two inventories | Low cost — add `store_id` scoping to catalog reads |
| A2 | Two stores, one organization, no SaaS multi-tenancy today | Org-aware schema, single org seeded | Low — schema already org-aware |
| A3 | Roles are `OWNER`, `MANAGER`, `SELLER` | Capability-based RBAC, 3 seeded roles | Low — roles are data, not code |
| A4 | `parent/child` store relation is a label, not behaviour | No hierarchy column in v1 | Low — additive column |
| A5 | Single currency, 2 decimal places | `Numeric(12,2)` + org-level currency code | **Medium-high** — multi-currency changes Sale/SaleItem schema → see Q1 |
| A6 | Sale price is entered or confirmed by the seller at sale time | No price list entity in M1 | **High** — a price-list entity changes catalog and sale API → see Q1 |
| A7 | Stock is tracked per size where size is known | Inventory key = store + variant + size, with an `UNSPECIFIED` size sentinel | **High** → see Q2 |
| A8 | Transfers complete in one step (carried by hand between shops) | Single-transaction `TRANSFER_OUT` + `TRANSFER_IN` | Medium — two-phase adds `IN_TRANSIT` state → see Q5 |
| A9 | No barcodes, no printed labels in M1 | Text search + natural-language entry only | Low — additive |
| A10 | Telegram is the only client; no public web app | initData auth only | Low |
| A11 | Photos of goods are not required in M1 | No media storage | Medium — needs object storage decision later |
| A12 | No customer records, loyalty, or receipts-to-customer in M1 | Sale has no customer FK | Low — additive |
| A13 | Ukrainian/Russian mixed shop language; normalization must handle both, plus latin (`butter`, `Ponte`) | Unicode-aware normalization, no transliteration guessing | Medium — affects parser only |
| A14 | Deployment target is a single small VPS | Docker Compose + Caddy, no orchestrator | Low |

### 3.3 UNKNOWN / NEEDS BUSINESS CONFIRMATION

Listed here because inventing an answer would violate the constitution. Those marked **BLOCKING** must be answered before the tasks that depend on them start; the rest have safe defaults and can be answered later.

| # | Question | Blocks |
|---|---|---|
| U1 | Currency, and whether more than one currency ever appears in a sale | **BLOCKING** for M1-016 (Sale schema) |
| U2 | Where does a price come from — a per-variant price list, or typed per sale? Are discounts a thing? | **BLOCKING** for M1-016 |
| U3 | Is per-size stock required, or is a model+colour count enough? Do legacy records ever carry size? | **BLOCKING** for M1-013 (Inventory key) |
| U4 | When the app shows 0 but the item is physically on the rack, may the seller still sell it? | **BLOCKING** for M1-015/016 — see §5.1 |
| U5 | Should a transfer require confirmation at the receiving store? | M1-018 (default: no) |
| U6 | Are consignment/borrowed goods actually present, and must they be reported separately? | M2 reporting |
| U7 | Does the owner need purchase cost and margin visible in the app? | M2 reporting; affects `StockLot.unit_cost` exposure |
| U8 | Who physically uses the app — how many sellers, do they share a device? | M1-008 session lifetime |
| U9 | Volume: items in catalog, sales/day, size of the legacy backlog | Performance budgets; no infrastructure decision depends on it in M1 |
| U10 | Is there an existing list of business categories and garment types, or are they discovered from data? | M1-010 seeding strategy (default: discovered) |
| U11 | Real legacy documents (PDF/notebook photos/Excel) — format and volume | M1-023 parser scope; **the parser corpus cannot be finished without real samples** |
| U12 | Retention/backup expectations, and who owns the server | M2 disaster recovery |

---

## 4. Domain Model v1

Notation: `PK` primary key, `FK` foreign key, `U(...)` unique constraint, `CK` check constraint. All tables carry `created_at timestamptz NOT NULL`; mutable tables also carry `updated_at`. All ids are `uuid` unless stated. All money is `Numeric(12,2)`. All timestamps are UTC.

### 4.1 Tenancy, identity, authorization

```text
Organization(id PK, name, currency_code, created_at)
Store(id PK, organization_id FK, name, code, kind ENUM(PRIMARY, SECONDARY), timezone, is_active)
    U(organization_id, code)
User(id PK, telegram_user_id BIGINT, display_name, is_active, created_at)
    U(telegram_user_id)
Membership(id PK, user_id FK, organization_id FK, store_id FK NULL, role_id FK, is_active)
    U(user_id, organization_id, store_id)
    store_id NULL = organization-wide membership
Role(id PK, organization_id FK NULL, code, name, is_system)
    U(organization_id, code)
RolePermission(role_id FK, permission_code)   PK(role_id, permission_code)
```

`Permission` is a **code constant defined in application code**, not a table — the catalogue of capabilities is part of the deployed artifact and must not drift per environment. `RolePermission` references those codes. Initial catalogue:

```text
sale:create        sale:refund        sale:view
inventory:view     inventory:adjust   inventory:receive
transfer:create    transfer:receive
catalog:create     catalog:confirm    catalog:merge
snapshot:import    snapshot:approve
report:view_financial
user:manage
```

### 4.2 Catalog identity

```text
BusinessCategory(id PK, organization_id FK, name, normalized_name, is_active)
    U(organization_id, normalized_name)
GarmentType(id PK, organization_id FK, name, normalized_name, is_active)
    U(organization_id, normalized_name)

CanonicalConcept(id PK, organization_id FK, name, normalized_name,
                 business_category_id FK NULL, garment_type_id FK NULL,
                 status ENUM(ACTIVE, NEEDS_REVIEW, MERGED), merged_into_id FK NULL)
    U(organization_id, normalized_name)
    -- Лоран, Мышка, Ботега, 4 кармана. Category/type nullable: evidence may be absent.

SourceIdentity(id PK, organization_id FK, name, normalized_name,
               semantic_type ENUM(UNKNOWN, BRAND, SUPPLIER, FACTORY, LABEL, COLLECTION)
                            NOT NULL DEFAULT 'UNKNOWN',
               confirmed_by FK NULL, confirmed_at NULL)
    U(organization_id, normalized_name)
    -- Belardi, Ponte, Garcia, Manzari stay UNKNOWN until a human confirms the type.

ProductFamily(id PK, organization_id FK, canonical_concept_id FK,
              source_identity_id FK NULL, garment_type_id FK NULL,
              status ENUM(ACTIVE, NEEDS_REVIEW, MERGED), merged_into_id FK NULL, notes)
    U(organization_id, canonical_concept_id, source_identity_id, garment_type_id)
    -- THE identity boundary. Лоран/Belardi and Лоран/Ponte are two rows, never auto-merged.
```

> `source_identity_id` and `garment_type_id` are nullable, and PostgreSQL treats `NULL`s as
> distinct in unique indexes. To keep the boundary enforceable, each organization gets a
> reserved `SourceIdentity(name='—', semantic_type='UNKNOWN')` and `GarmentType(name='—')`
> sentinel row instead of storing `NULL` in the unique key. Same technique as sizes (§4.4).

```text
AttributeTerm(id PK, organization_id FK,
              kind ENUM(COLOR, MATERIAL, TEXTURE, FUR, COLLAR, CONSTRUCTION, HARDWARE, OTHER),
              name, normalized_name, status ENUM(ACTIVE, NEEDS_REVIEW, MERGED), merged_into_id NULL)
    U(organization_id, kind, normalized_name)
    -- шоколад, замш, гладкая, butter, персик … one dictionary, discriminated by kind.

ProductVariant(id PK, product_family_id FK,
               color_term_id FK NULL, material_term_id FK NULL, texture_term_id FK NULL,
               fur_term_id FK NULL, collar_term_id FK NULL,
               length_cm NUMERIC(5,1) NULL,
               attributes JSONB NOT NULL DEFAULT '{}',
               status ENUM(ACTIVE, NEEDS_REVIEW, MERGED), merged_into_id FK NULL)
    U(product_family_id, color_term_id, material_term_id, texture_term_id,
      fur_term_id, collar_term_id, length_cm)   -- sentinel terms, not NULL, for the same reason
```

Promoted to dedicated columns exactly the fields `CATALOG_ARCHITECTURE.md` names as high-confidence: colour, length, material, texture, fur, collar. Everything else (belt mode, hood, drawstring, detachable parts, reversible, hardware …) stays in `attributes` JSONB with a GIN index until repeated evidence justifies promotion. Promotion is an additive migration; nothing is destructive.

### 4.3 Raw input, aliases, matching, feedback

```text
RawInput(id PK, organization_id FK, store_id FK NULL,
         source_kind ENUM(MANUAL_ENTRY, BOT_MESSAGE, SNAPSHOT_IMPORT, API),
         source_ref, raw_text TEXT NOT NULL, created_by FK NULL, created_at)
    -- APPEND-ONLY. UPDATE and DELETE blocked by a database trigger, not merely by convention.

ParseResult(id PK, raw_input_id FK, parser_version TEXT,
            parsed JSONB, field_confidence JSONB, unclassified JSONB, created_at)
    -- Re-parsing inserts a new row. Interpretation never overwrites evidence.

ProductAlias(id PK, organization_id FK, normalized_phrase,
             target_type ENUM(CONCEPT, FAMILY, VARIANT, ATTRIBUTE_TERM, SIZE, SOURCE),
             target_id UUID,
             status ENUM(NEW, LEARNING, VERIFIED, REJECTED, AMBIGUOUS) DEFAULT 'NEW',
             confirm_count INT DEFAULT 0, reject_count INT DEFAULT 0)
    U(organization_id, normalized_phrase, target_type, target_id)

AliasEvidence(id PK, alias_id FK, raw_input_id FK NULL, decision_id FK NULL,
              event ENUM(CONFIRM, REJECT), actor_user_id FK, created_at)
    -- APPEND-ONLY. Promotion NEW → LEARNING → VERIFIED is derived from counts, never hand-set.

CatalogMatchDecision(id PK, organization_id FK, raw_input_id FK, parse_result_id FK,
                     decision_type ENUM(SAME_VARIANT, NEW_VARIANT, NEW_MODEL,
                                        NEW_CATEGORY, AMBIGUOUS),
                     resolved_variant_id FK NULL,
                     top_candidate_id NULL, top_score NUMERIC(4,3),
                     second_score NUMERIC(4,3), margin NUMERIC(4,3),
                     field_scores JSONB, conflicts JSONB,
                     matcher_version TEXT,
                     mode ENUM(AUTO, CONFIRMED, MANUAL),
                     status ENUM(PENDING, APPLIED, REJECTED, NEEDS_REVIEW),
                     decided_by FK NULL, decided_at NULL)

CatalogFeedback(id PK, decision_id FK, predicted_target_id NULL, actual_target_id NULL,
                correction_kind, actor_user_id FK, store_id FK NULL, created_at)

UnclassifiedDescriptor(id PK, organization_id FK, normalized_text, occurrences INT,
                       first_seen_raw_input_id FK, last_seen_at,
                       status ENUM(NEW, WATCHING, PROMOTED, IGNORED))
    U(organization_id, normalized_text)
```

### 4.4 Sizes

```text
SizeSystem(id PK, organization_id FK, code ENUM(ALPHA, NUMERIC_EU, UNSPECIFIED), name)
Size(id PK, size_system_id FK, code, sort_order INT, is_sentinel BOOL DEFAULT false)
    U(size_system_id, code)
SizeAlias(id PK, organization_id FK, normalized_text, size_id FK, status)
    U(organization_id, normalized_text)
```

Every organization is seeded with exactly one sentinel `Size` in the `UNSPECIFIED` system, code `UNKNOWN`. Legacy rows and quantities with no stated size land on the sentinel rather than on `NULL`, so `Inventory`'s unique key never contains `NULL` and duplicate inventory rows become impossible at the database level.

### 4.5 Inventory and the ledger

```text
StockLot(id PK, organization_id FK, store_id FK, product_variant_id FK, size_id FK,
         acquisition_type ENUM(PURCHASE, CONSIGNMENT, BORROWED, TRANSFER,
                               RETURN, ADJUSTMENT, OPENING_BALANCE),
         source_identity_id FK NULL, unit_cost NUMERIC(12,2) NULL, currency_code NULL,
         received_at, snapshot_id FK NULL, notes)

Inventory(id PK, store_id FK, product_variant_id FK, size_id FK,
          quantity INT NOT NULL, updated_at)
    U(store_id, product_variant_id, size_id)
    CK(quantity >= 0)          -- the hard floor, enforced by PostgreSQL

StockMovement(id PK, organization_id FK, store_id FK, product_variant_id FK, size_id FK,
              stock_lot_id FK NULL,
              movement_type ENUM(SALE, REFUND_RETURN, DELIVERY, ADJUSTMENT,
                                 TRANSFER_OUT, TRANSFER_IN, STOCKTAKE_CORRECTION,
                                 OPENING_BALANCE),
              quantity_delta INT NOT NULL CK(quantity_delta <> 0),
              reason_code TEXT NULL, reference_type TEXT, reference_id UUID,
              actor_user_id FK, correlation_id TEXT, created_at)
    -- APPEND-ONLY ledger. Trigger blocks UPDATE/DELETE.

InventorySnapshot(id PK, organization_id FK, store_id FK NULL, source_document_ref,
                  captured_at, status ENUM(DRAFT, PARSED, IN_REVIEW, APPROVED,
                                           APPLIED, REJECTED),
                  approved_by FK NULL, approved_at NULL)

InventorySnapshotRow(id PK, snapshot_id FK, line_no INT, raw_input_id FK,
                     parse_result_id FK NULL,
                     quantity_total INT NULL,
                     quantity_state ENUM(KNOWN, UNKNOWN_DISTRIBUTION, UNKNOWN_QUANTITY),
                     resolved_variant_id FK NULL, resolved_size_id FK NULL,
                     status ENUM(PENDING, RESOLVED, NEEDS_REVIEW, SKIPPED))
    U(snapshot_id, line_no)
```

`quantity_state = UNKNOWN_DISTRIBUTION` is exactly the `Лама бежевая/персик/butter 3 шт` case: the total 3 is preserved, the split across three colours is not invented, and the row cannot become an opening balance until a human resolves it.

### 4.6 Sales, refunds, transfers, audit

```text
Sale(id PK, organization_id FK, store_id FK, seller_user_id FK,
     status ENUM(COMPLETED, VOIDED), currency_code,
     subtotal NUMERIC(12,2), discount_total NUMERIC(12,2), total NUMERIC(12,2),
     idempotency_key TEXT, sold_at, created_at)
    U(organization_id, idempotency_key)

SaleItem(id PK, sale_id FK, product_variant_id FK, size_id FK, quantity INT CK(quantity > 0),
         unit_price NUMERIC(12,2), discount NUMERIC(12,2), line_total NUMERIC(12,2),
         display_name_snapshot TEXT NOT NULL, variant_snapshot JSONB NOT NULL)
    -- snapshots make history immune to later catalog edits, renames and merges

Refund(id PK, sale_id FK, organization_id FK, store_id FK, actor_user_id FK,
       total_amount NUMERIC(12,2), reason TEXT, idempotency_key TEXT, created_at)
    U(organization_id, idempotency_key)
RefundItem(id PK, refund_id FK, sale_item_id FK, quantity INT CK(quantity > 0),
           amount NUMERIC(12,2), restock BOOL NOT NULL)

Transfer(id PK, organization_id FK, from_store_id FK, to_store_id FK,
         status ENUM(DRAFT, SENT, RECEIVED, CANCELLED),
         created_by FK, idempotency_key TEXT, sent_at NULL, received_at NULL)
    U(organization_id, idempotency_key)
    CK(from_store_id <> to_store_id)
TransferItem(id PK, transfer_id FK, product_variant_id FK, size_id FK, quantity INT CK(quantity > 0))

IdempotencyRecord(id PK, organization_id FK, endpoint TEXT, key TEXT,
                  request_fingerprint TEXT, status ENUM(IN_PROGRESS, COMPLETED),
                  response_snapshot JSONB NULL, created_at, expires_at)
    U(organization_id, endpoint, key)

AuditLog(id PK, organization_id FK, actor_user_id FK NULL, action TEXT,
         entity_type TEXT, entity_id UUID, before JSONB NULL, after JSONB NULL,
         reason TEXT NULL, correlation_id TEXT, created_at)
    -- APPEND-ONLY
```

### 4.7 Deliberately NOT in the model yet

`OutboxEvent` (architecture.md mentions it, but Milestone 1 has no asynchronous consumer — `AuditLog` covers traceability; adding a transactional outbox with zero consumers is infrastructure without measured need per constitution §14). `Price` / `PriceList` (depends on Q1/U2). `Customer`, `Discount rules`, `Media/photos`, `Barcode`, `Embedding`/pgvector (deferred until matcher evaluation proves lexical retrieval insufficient — `ADAPTIVE_CATALOG_LEARNING.md` says semantic retrieval "when useful", not by default).

---

## 5. Business invariants and how each one is enforced

An invariant with no enforcement mechanism is a wish. Each row names the mechanism that makes it true and the test that proves it.

| # | Invariant | Enforced by | Proven by |
|---|---|---|---|
| I1 | Inventory quantity is never negative | `CK(quantity >= 0)` in PostgreSQL | Concurrency test: 2 parallel sales of the last unit |
| I2 | One inventory row per (store, variant, size) | Unique index with size sentinel (no `NULL`s) | Migration test + duplicate-insert test |
| I3 | Every quantity change has a StockMovement | Inventory writes only through `InventoryService`; import-linter forbids other modules touching the table | Reconciliation test: `SUM(quantity_delta) == Inventory.quantity` for every key |
| I4 | Sale, items, movements and inventory commit atomically | One transaction opened at the service boundary; no commits inside helpers (conventions.md) | Failure-injection test: forced error after movement write leaves zero rows |
| I5 | A retried critical command never duplicates | `U(organization_id, idempotency_key)` + `IdempotencyRecord` replay | Duplicate-POST test returns the original sale, stock changes once |
| I6 | Two simultaneous sales cannot oversell | Conditional `UPDATE … WHERE quantity >= :q`, rows touched in ascending `inventory.id` order | Concurrency test with real parallel sessions |
| I7 | Money is exact | `NUMERIC(12,2)` + Python `Decimal`; float banned by lint rule | Rounding test suite incl. half-up cases |
| I8 | Historical sale totals never change | `SaleItem` price/name/variant snapshots; no recomputation from catalog | Test: rename + merge the variant, re-read the old sale, totals identical |
| I9 | Refund ≤ sold − already refunded | `SELECT … FOR UPDATE` on the sale's items inside the refund transaction | Concurrency test: 2 simultaneous full refunds, one wins |
| I10 | Raw input is never rewritten | Database trigger rejecting `UPDATE`/`DELETE` on `RawInput` | Test asserting the trigger raises |
| I11 | Ledger and audit are append-only | Same trigger pattern on `StockMovement`, `AliasEvidence`, `AuditLog` | Same |
| I12 | Tenant/store isolation | Org/store scope derived from the server session only; repository base class requires an explicit scope argument | Negative tests: seller of store A cannot read, sell, refund or transfer in store B |
| I13 | Authorization is server-side | Permission check in the service layer, not the router and never the frontend | Privilege-escalation tests per permission code |
| I14 | Uncertain catalog interpretation never merges products | Matcher returns `AMBIGUOUS`; only an explicit reviewed operation writes `merged_into_id` | Matcher golden tests incl. `Лоран/Belardi` vs `Лоран/Ponte` |
| I15 | Slash never becomes an alias, and split quantities are never invented | Parser emits variant enumeration + `UNKNOWN_DISTRIBUTION` | Golden test on `Лама бежевая/персик/butter 3 шт` |
| I16 | Transfers are movements, never sales | `Transfer` writes only `TRANSFER_OUT`/`TRANSFER_IN` | Test asserting no `Sale` row and no revenue effect |
| I17 | A legacy import never fabricates history | Snapshot rows produce only `OPENING_BALANCE` movements after approval | Import test: no `DELIVERY`/`SALE` movement is ever produced |

### 5.1 The one invariant that needs a product decision — U4

`I1` says stock cannot go negative. That is a database floor and it stays. But there is a real workflow behind it: the notebook is often behind reality, so the app will sometimes show `0` while the coat is physically on the rack. If the app answers "cannot sell", the seller goes back to the notebook and the product has lost.

Proposed resolution, which keeps the invariant intact and is **not** an oversell:

> When a sale line exceeds available stock, the API returns `INSUFFICIENT_STOCK` with the current quantity. A user holding `inventory:adjust` may then take an explicit "товар є в наявності — виправити залишок" action, which writes a `StockMovement(type=ADJUSTMENT, reason_code=FOUND_IN_STORE)` with an audit entry, and only then completes the sale. Two movements, full traceability, quantity never negative, and the seller is never blocked.

This needs the owner's confirmation (Q3 in §12) because it defines who may correct stock during a sale.

---

## 6. Transaction boundaries

Each critical command is exactly one database transaction opened at the service boundary. No helper commits. The frontend never sees success before the commit.

**`POST /sales`**
```text
BEGIN
  resolve session → user, organization, store           (no client-supplied ids trusted)
  check permission sale:create for that store
  claim idempotency key (INSERT … ON CONFLICT → replay path)
  sort lines by inventory.id ascending                   ← deterministic order, no deadlocks
  for each line:
      UPDATE inventory SET quantity = quantity - :q
        WHERE store_id=… AND product_variant_id=… AND size_id=… AND quantity >= :q
        RETURNING quantity
      0 rows → raise InsufficientStock → ROLLBACK
  compute totals with Decimal
  INSERT Sale, SaleItems (with immutable snapshots)
  INSERT StockMovement per line (type=SALE, negative delta)
  INSERT AuditLog
  store idempotency response snapshot
COMMIT
```

**`POST /sales/{id}/refunds`** — `BEGIN` → load sale in tenant scope → `SELECT … FOR UPDATE` on sale items → validate refundable quantity → claim idempotency → compute amounts from the **original snapshots** → `INSERT Refund/RefundItems` → conditional `UPDATE inventory` upward where `restock` → `INSERT StockMovement(REFUND_RETURN)` → `AuditLog` → `COMMIT`.

**`POST /transfers`** (default single-step, A8) — `BEGIN` → permission `transfer:create` on source store → conditional decrement at source → increment at destination → `TRANSFER_OUT` + `TRANSFER_IN` movements → `AuditLog` → `COMMIT`. Two-phase mode splits this into two transactions with an `IN_TRANSIT` holding row; not built in M1 unless Q5 says otherwise.

**`POST /inventory/adjustments`** — `BEGIN` → permission `inventory:adjust` → conditional update → `ADJUSTMENT` movement with mandatory `reason_code` → `AuditLog` → `COMMIT`.

**`POST /catalog/entries`** (goods receipt / natural-language entry) — two transactions on purpose:
```text
TX1  INSERT RawInput  (evidence is persisted before interpretation, always)
     COMMIT
TX2  parse → retrieve candidates → score → decision
     if decision is AUTO or human-CONFIRMED:
         INSERT/resolve catalog entities
         conditional UPDATE inventory + DELIVERY movement   (only when a quantity was given)
         INSERT CatalogMatchDecision(status=APPLIED), AliasEvidence
     else:
         INSERT CatalogMatchDecision(status=NEEDS_REVIEW)   ← no inventory effect
     COMMIT
```
Splitting them is deliberate: raw evidence must survive even if parsing crashes, and an unresolved match must never touch stock (`catalog-ingestion.md`).

**`POST /snapshots/{id}/approve`** — `BEGIN` → permission `snapshot:approve` → assert no row is `PENDING`/`NEEDS_REVIEW` → for each resolved row `INSERT StockMovement(OPENING_BALANCE)` + upsert inventory → set snapshot `APPLIED` → `AuditLog` → `COMMIT`. Idempotent by snapshot status.

---

## 7. Modular monolith architecture

```text
backend/app/
├── core/            config, async engine/session, errors, correlation ids, logging, security
├── modules/
│   ├── identity/    User, Telegram initData verification, session issuance
│   ├── tenancy/     Organization, Store, Membership, scope resolution
│   ├── authz/       permission codes, role composition, decision points
│   ├── catalog/     terms, concepts, families, variants, sizes,
│   │                raw_input/, parsing/, matching/, aliases/, feedback/
│   ├── inventory/   inventory, movements, lots, snapshots, reconciliation
│   ├── sales/       sales + items
│   ├── refunds/
│   ├── transfers/
│   ├── audit/
│   └── telegram/    aiogram bot, webhook
├── api/v1/          thin routers: parse request → call service → shape response
└── migrations/      Alembic
frontend/src/
├── app/             routing, providers, Telegram bootstrap
├── shared/telegram/ the ONLY place tma.js is imported
├── features/        sale/, search/, receive/, transfer/, correct/, review/
└── entities/        typed API client generated from the OpenAPI schema
infra/               docker-compose.yml, Caddyfile, .env.example
```

**Dependency direction (enforced, not aspirational):** `api → modules → core`. Cross-module access happens through service functions only; no module imports another module's repositories or models. Permitted edges: `sales → inventory, catalog, authz, tenancy`; `refunds → sales, inventory`; `transfers → inventory`; `catalog → ø (leaf)`; `inventory → catalog (read-only)`. Enforcement: an `import-linter` contract executed in CI, so a violating import fails the build rather than a review comment.

---

## 8. API boundary proposal

Base `/api/v1`. Every mutating endpoint requires an `Idempotency-Key` header. Every response carries `X-Request-ID` matching the log correlation id. Errors are `{code, message, details}` with stable machine-readable codes: `INSUFFICIENT_STOCK`, `CATALOG_AMBIGUOUS`, `FORBIDDEN_STORE`, `PERMISSION_DENIED`, `IDEMPOTENCY_CONFLICT`, `REFUND_EXCEEDS_SOLD`, `VALIDATION_ERROR`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/auth/telegram` | — | verifies initData HMAC server-side, issues a short-lived session token |
| GET | `/me` | — | user, stores, effective permissions |
| POST | `/catalog/parse` | `catalog:create` | **preview only, never mutates** — powers live typing feedback |
| POST | `/catalog/entries` | `catalog:create` / `inventory:receive` | raw line → decision → optional stock effect |
| GET | `/catalog/search` | `inventory:view` | trigram + alias search, store-scoped stock in the response |
| GET | `/catalog/review-queue` | `catalog:confirm` | `AMBIGUOUS` / `NEEDS_REVIEW` decisions |
| POST | `/catalog/decisions/{id}/resolve` | `catalog:confirm` | one-tap confirmation, writes `AliasEvidence` |
| POST | `/catalog/families/{id}/merge` | `catalog:merge` | explicit, reversible, audited; never automatic |
| GET | `/inventory` | `inventory:view` | by store, variant, size |
| POST | `/inventory/adjustments` | `inventory:adjust` | reason code mandatory |
| POST | `/sales` | `sale:create` | the hot path |
| GET | `/sales`, `/sales/{id}` | `sale:view` | |
| POST | `/sales/{id}/refunds` | `sale:refund` | |
| POST | `/transfers` | `transfer:create` | |
| POST | `/transfers/{id}/receive` | `transfer:receive` | only in two-phase mode (Q5) |
| POST | `/snapshots` … `/snapshots/{id}/approve` | `snapshot:import` / `snapshot:approve` | legacy import |

Performance budgets for the seller hot path (to be measured, not assumed): `/catalog/search` p95 ≤ 300 ms, `POST /sales` p95 ≤ 500 ms, time-to-sale ≤ 15 s for a known item, taps-to-sale ≤ 5.

---

## 9. MVP scope by 80/20

**In scope (the vital 20% that carries the trust):** Telegram auth; store/role context; find product; create sale; correct a mistake; return; receive goods via natural language; transfer between stores; stock check; legacy snapshot import; audit trail.

**Explicitly out of Milestone 1** (each is additive, none is blocked by these foundations): reporting dashboards and margin analysis; LLM-based parsing and reranking; semantic retrieval / pgvector; barcodes and printed labels; photos; customer records and loyalty; discount engine; multi-currency; consignment settlement; supplier orders; offline mode.

**Out of Milestone 1 but deliberately prepared for:** the matcher's decision record and per-field confidence already have the shape an LLM reranker would fill; `attributes` JSONB absorbs new descriptors without migration; `StockLot.acquisition_type` already distinguishes consignment and borrowed goods.

---

## 10. Milestone 1 — task graph

24 tasks in 6 waves. Owner skills come from `.ai/SKILL_INDEX.md`. Every task inherits the DoD from `.ai/definition-of-done.md`; the "proves it" column lists the check specific to that task.

### Wave 0 — repository foundation

| ID | Task | Owner skill(s) | Depends on | Proves it |
|---|---|---|---|---|
| M1-001 | Monorepo scaffold: `backend/`, `frontend/`, `infra/`, **`.gitignore` first**, ruff + mypy + pytest, eslint + tsc, pre-commit | `devops-docker-caddy`, `backend-fastapi-engineer` | — | `ruff`, `mypy`, `pytest`, `tsc` all run and pass on an empty project |
| M1-002 | Docker Compose: PostgreSQL + api + web + Caddy, `.env.example`, no secrets committed | `devops-docker-caddy` | M1-001 | `docker compose up` serves a health endpoint through Caddy |
| M1-003 | CI: lint, typecheck, unit, integration against a real Postgres service, migration-drift check | `ci-cd-engineer` | M1-001 | CI green on a PR; a deliberate drift fails it |
| M1-004 | ADR-0001 module boundaries + `import-linter` contract | `solution-architect`, `modular-monolith-guardian` | M1-001 | A deliberate illegal import fails CI |

### Wave 1 — platform core

| ID | Task | Owner skill(s) | Depends on | Proves it |
|---|---|---|---|---|
| M1-005 | App skeleton: settings, async session, error→HTTP mapping, correlation ids, structured logging, Sentry | `backend-fastapi-engineer`, `request-correlation`, `sre-observability` | M1-001 | Every response carries `X-Request-ID`; it appears in the log line |
| M1-006 | Alembic setup, naming conventions, autogenerate policy, drift check | `alembic-migration-engineer` | M1-005 | `upgrade head` then `downgrade` on a seeded DB, both clean |
| M1-007 | Tenancy schema + scope resolution (Organization, Store, User, Membership) | `multi-tenancy-architect` | M1-006 | Cross-store read returns 403 in a negative test |
| M1-008 | Telegram initData verification + session issuance | `telegram-mini-app-specialist`, `security-engineer` | M1-005 | Tampered initData rejected; expired `auth_date` rejected; `initDataUnsafe` never trusted |
| M1-009 | RBAC: permission codes, roles, service-layer decision points | `rbac-permission-designer` | M1-007 | One privilege-escalation test per permission code |

### Wave 2 — domain schema

| ID | Task | Owner skill(s) | Depends on | Proves it |
|---|---|---|---|---|
| M1-010 | Catalog identity schema + sentinel rows + uniqueness (§4.2) | `adaptive-catalog-architect`, `postgres-engineer` | M1-006 | `Лоран/Belardi` and `Лоран/Ponte` coexist as two families; a duplicate family insert fails |
| M1-011 | Size systems, sizes, aliases, `UNSPECIFIED` sentinel | `size-inventory-specialist` | M1-010 | `M`, `44`, `3XL` and "no size" all resolve; no `NULL` in the inventory key |
| M1-012 | RawInput + ParseResult with append-only triggers | `adaptive-catalog-architect` | M1-010 | `UPDATE`/`DELETE` on `RawInput` raises |
| M1-013 | Inventory + StockMovement + StockLot, `CK(quantity>=0)`, reconciliation query | `inventory-ledger-specialist`, `postgres-engineer` | M1-011 | Reconciliation finds an artificially injected divergence |

### Wave 3 — critical services (highest risk in the milestone)

| ID | Task | Owner skill(s) | Depends on | Proves it |
|---|---|---|---|---|
| M1-014 | Idempotency infrastructure: header contract, claim/replay, fingerprint conflict | `concurrency-transactions` | M1-013 | Same key twice → one effect, identical response; same key + different body → `IDEMPOTENCY_CONFLICT` |
| M1-015 | `InventoryService`: atomic conditional movement application, deterministic ordering | `concurrency-transactions`, `concurrency-test-engineer` | M1-013 | Parallel sales of the last unit: exactly one wins, final quantity 0, no partial rows |
| M1-016 | Sale service + `POST /sales` + Decimal money + immutable snapshots | `backend-fastapi-engineer`, `financial-integrity` | M1-014, M1-015, **Q1, Q2** | Full `workflows/sale.md` test list passes |
| M1-017 | Refund service + `POST /sales/{id}/refunds` | `compensating-operations`, `financial-integrity` | M1-016 | Full `workflows/refund.md` test list passes |
| M1-018 | Transfer service + endpoints, `TRANSFER_OUT`/`TRANSFER_IN` | `inventory-ledger-specialist` | M1-015 | Transfer moves stock, creates no `Sale`, produces no revenue |
| M1-019 | Adjustments + AuditLog + the "found in store" correction flow (§5.1) | `human-error-resilience` | M1-015, **Q3** | `workflows/inventory-adjustment.md` test list passes |

### Wave 4 — catalog pipeline v1 and legacy import

| ID | Task | Owner skill(s) | Depends on | Proves it |
|---|---|---|---|---|
| M1-020 | Normalization + deterministic parser v1: slash rule, per-field confidence, unclassified descriptors | `catalog-normalization-parser` | M1-012 | Golden corpus incl. `мышка шоколад гладкая 5`, `дубленка Лоран шоколад замш 70 см 2 шт`, `Лама бежевая/персик/butter 3 шт` |
| M1-021 | Matcher v1: verified alias → `pg_trgm` fuzzy → attribute compatibility → 5 decision types + margin policy | `catalog-matcher`, `catalog-confidence-policy` | M1-020, M1-010 | Conflicting-attribute pairs return `AMBIGUOUS`; no automatic cross-source merge, ever |
| M1-022 | Alias/feedback evidence store, promotion `NEW→LEARNING→VERIFIED`, review-queue API | `catalog-feedback-learning` | M1-021 | Promotion needs N confirmations; one rejection demotes; conflicts → `AMBIGUOUS` |
| M1-023 | Snapshot import foundation: raw rows, parse, review, approve → opening balances | `legacy-inventory-import` | M1-021, M1-013 | No `SALE`/`DELIVERY` movement is ever produced; unresolved rows block approval; totals match the source |

### Wave 5 — client and release

| ID | Task | Owner skill(s) | Depends on | Proves it |
|---|---|---|---|---|
| M1-024 | Frontend scaffold, Telegram integration layer, auth, typed API client | `frontend-react-engineer`, `telegram-mini-app-specialist` | M1-008 | Runs in the Telegram client; theme and safe areas respected |
| M1-025 | Seller flows: search, sale, receive goods, quick correction | `high-frequency-pos-ux` | M1-024, M1-016 | Tap/time budget measured against §8 |
| M1-026 | Catalog confirmation UI: 2–3 candidates, one tap, explicit "це новий товар" | `ux-product-designer` | M1-024, M1-021 | Ambiguous input never silently resolves |
| M1-027 | Playwright E2E golden paths | `playwright-e2e` | M1-025, M1-026 | Sale, refund, transfer, receive, ambiguous-confirm all pass |
| M1-028 | Release gate: DoD, perf budget, production readiness, backup **with verified restore** | `release-manager`, `production-readiness-review` | all | Restore drill executed, not merely documented |

### Expanded contracts for the four highest-risk tasks

```yaml
id: M1-015
title: "Atomic inventory movement application"
owner_skill: "concurrency-transactions"
priority: P0
objective: |
  A single service owns every write to Inventory and always writes a paired StockMovement,
  atomically, without lost updates and without deadlocks on multi-line commands.
business_context: |
  Overselling and untraceable stock are the two failures that would destroy the owner's
  trust faster than any UI problem. The notebook never oversells.
constraints:
  - "Conditional UPDATE … WHERE quantity >= :q; no read-then-write"
  - "Process lines ordered by inventory.id ascending"
  - "No commit inside the service; the caller owns the transaction"
  - "Zero rows affected means INSUFFICIENT_STOCK, never a silent zero"
depends_on: ["M1-013"]
acceptance_criteria:
  - "Two parallel sales of the last unit: one succeeds, one gets INSUFFICIENT_STOCK, final quantity 0"
  - "Multi-line concurrent sales in opposite input order do not deadlock"
  - "Every quantity change has exactly one movement with a correct signed delta"
  - "SUM(quantity_delta) equals Inventory.quantity for every key after a randomized run"
required_checks:
  - "pytest backend/tests/concurrency -p no:randomly"
prohibited_actions: ["advisory locks as the primary mechanism", "application-level mutex"]
```

```yaml
id: M1-016
title: "Sale command"
owner_skill: "backend-fastapi-engineer"
priority: P0
objective: "POST /sales is atomic, idempotent, exact in money and historically stable."
depends_on: ["M1-014", "M1-015"]
blocked_by_business_question: ["Q1 currency and price source", "Q2 size granularity"]
constraints:
  - "Decimal only; a lint rule bans float in money paths"
  - "SaleItem persists display_name_snapshot and variant_snapshot"
  - "Totals are never recomputed from the live catalog"
acceptance_criteria:
  - "All seven tests listed in .ai/workflows/sale.md pass"
  - "Renaming and merging a variant leaves an old sale's total and displayed name unchanged"
  - "Duplicate Idempotency-Key returns the original sale and changes stock once"
required_checks: ["pytest backend/tests/sales", "pytest backend/tests/concurrency"]
```

```yaml
id: M1-021
title: "Catalog matcher v1"
owner_skill: "catalog-matcher"
priority: P0
objective: |
  Resolve a parsed line to SAME_VARIANT / NEW_VARIANT / NEW_MODEL / NEW_CATEGORY / AMBIGUOUS
  with per-field confidence, candidate margin and hard attribute-conflict rules.
constraints:
  - "Verified aliases first, then pg_trgm lexical retrieval; NO embeddings in M1"
  - "Structured conflict (different source, length, colour) overrides similarity"
  - "Thresholds live in configuration and are provisional, never constants in code"
  - "No LLM call in this task"
acceptance_criteria:
  - "Лоран/Belardi never auto-matches Лоран/Ponte regardless of string similarity"
  - "Top score alone cannot trigger AUTO when the second candidate is within the margin"
  - "Every decision persists field_scores, margin, conflicts and matcher_version"
  - "Golden corpus precision is reported; automation thresholds stay conservative until evaluated"
prohibited_actions:
  - "writing merged_into_id automatically"
  - "mutating inventory from an unresolved decision"
```

```yaml
id: M1-023
title: "Legacy inventory snapshot import foundation"
owner_skill: "legacy-inventory-import"
priority: P1
objective: "Turn notebook/PDF availability lists into a reviewed, traceable opening balance."
constraints:
  - "Every source line is stored verbatim as RawInput, including unparseable ones"
  - "Unknown split across slash variants stays UNKNOWN_DISTRIBUTION"
  - "Approval is blocked while any row is PENDING or NEEDS_REVIEW"
acceptance_criteria:
  - "Only OPENING_BALANCE movements are produced — never DELIVERY or SALE"
  - "Approved snapshot totals reconcile against the source document"
  - "Re-approving an APPLIED snapshot is a no-op"
depends_on: ["M1-021", "M1-013"]
blocked_by_input: ["U11 real legacy documents"]
```

---

## 11. Parallelization

| Wave | Runs in parallel | Must be serial |
|---|---|---|
| 0 | M1-001 → then M1-002, M1-003, M1-004 together | M1-001 first — everything else needs the scaffold |
| 1 | M1-007, M1-008 in parallel after M1-005/006; M1-009 after M1-007 | M1-005 → M1-006 |
| 2 | M1-010 and M1-013 can start together; M1-011 after M1-010; M1-012 alongside | M1-011 before M1-013 finalizes the inventory key |
| 3 | M1-018 parallel with M1-016; M1-019 parallel with M1-017 | M1-014 → M1-015 → M1-016 → M1-017 (strict chain) |
| 4 | M1-020 can start as soon as M1-012 lands — **the parser is the natural parallel track to the whole of wave 3** | M1-020 → M1-021 → M1-022/M1-023 |
| 5 | M1-024 can start right after M1-008, long before wave 3 finishes; M1-025/026 follow their backends | M1-027 after both UI tracks; M1-028 last |

Three independent lanes can run concurrently for most of the milestone: **backend-critical** (waves 1→3), **catalog** (M1-012 → M1-020 → M1-021 → M1-022/023), and **client** (M1-024 → M1-025/026). They converge at M1-027.

Per `.ai/OPERATING_MANUAL.md` §6, the implementer of M1-015, M1-016, M1-017 and M1-021 must not be their own final reviewer. Each needs a fresh-context review: `code-reviewer` plus `adversarial-reviewer`, and `security-engineer` for M1-007/008/009.

---

## 12. Questions that genuinely block

Only these five are listed. Everything else in §3.3 has a safe default and can be answered during implementation.

**Q1 — Money. Blocks M1-016.**
What currency, and where does a price come from: a price list stored per model/variant, or typed by the seller at the moment of sale? Are discounts given, and if so per item or per sale? This decides whether a `Price` entity exists at all and what `SaleItem` must snapshot.

**Q2 — Sizes. Blocks M1-013 and M1-016.**
Must stock be counted per size, or is "model + colour = 5 pcs" the real unit of accounting? `мышка шоколад гладкая 5` looks like no size; `дубленка Лоран шоколад замш 70 см 2 шт` looks like a length, not a size. If per-size accounting is required only sometimes, that is fine and planned for — but it must be a stated rule, not a guess.

**Q3 — Selling when the app shows zero. Blocks M1-019, shapes M1-016.**
The proposal in §5.1: the seller is not blocked, but correcting the stock is an explicit, audited action. Confirm, and say whether an ordinary seller may do it or only the owner/manager.

**Q4 — Who works in the app.** How many sellers, one shared phone or personal devices, and may a seller see the other store's stock (see, transfer from, sell from)? This sets session lifetime and the default role matrix.

**Q5 — Transfers.** Does the receiving store confirm arrival, or does the stock move the moment it is sent? Default if unanswered: it moves immediately, one transaction.

Not blocking but needed before M1-023 can finish: **real legacy documents** (U11). The parser's golden corpus has to be built from actual lines, not from invented examples. Two or three real pages are enough to start.

---

## 13. Risks carried into this milestone

| Risk | Mitigation in this plan |
|---|---|
| Over-merging distinct goods sharing a shop nickname | `ProductFamily` boundary + `AMBIGUOUS` + no automatic merge (I14, M1-021) |
| Source identities wrongly treated as brands | `semantic_type` defaults to `UNKNOWN` and only a human changes it |
| Slash misread as aliases | Parser rule + golden test (I15, M1-020) |
| Fabricated size/colour distribution on import | `UNKNOWN_DISTRIBUTION` blocks approval (I17, M1-023) |
| Taxonomy frozen too early | JSONB `attributes` + `UnclassifiedDescriptor` evidence; promotion is additive |
| Duplicate sales under retry | Idempotency (I5, M1-014) |
| Cross-store authorization mistakes | Server-side scope + negative tests (I12, M1-007/009) |
| **Plan risk: parser corpus without real data** | M1-020 ships with a small corpus and an explicit "extend on real samples" follow-up; thresholds stay conservative |
| **Plan risk: three parallel lanes on one operator** | Waves are ordered so the critical chain (M1-014→017) can be done alone if capacity is limited |

---

## 14. Evidence and verification status for this run

| Item | Status |
|---|---|
| Governing files read | DONE — enumerated in §1 |
| Repository inspected | DONE — probes in §2 |
| Code written | NONE — planning run, as instructed |
| Tests run | `NOT VERIFIED` — no test suite exists yet |
| Migrations | `NOT VERIFIED` — none exist yet |
| Build/lint/typecheck | `NOT VERIFIED` — no toolchain exists yet |
| `.ai/project.md` updated | NOT DONE — deliberately deferred until this plan is approved, per `REPOSITORY_INSTALLATION.md` step 8 ("approved facts") |
| Files changed by this run | `.ai/project-memory/milestone-1-plan.md` (this file) only |

**On approval**, the next run will: record ADR-0001 (module boundaries) and ADR-0002 (identity/uniqueness strategy incl. sentinel rows) in `.ai/project-memory/architecture-decisions.md`; fill the confirmed values in `.ai/project.md`; update `.ai/project-memory/current-milestone.md` to `IN PROGRESS`; and begin with M1-001.
