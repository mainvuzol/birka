# Milestone 1 Plan — Production Foundation Without Irreversible Catalog Assumptions

**Status:** `APPROVED IN PRINCIPLE — corrections applied, revision 2`
**Branch:** `feat/foundation-milestone-1`
**Prepared by:** Executive Orchestrator, planning runs 1–2
**Implementation started:** NO — M1-001 is held until the final planning diff is reviewed
**Verification status:** `NOT VERIFIED` — no build, test or migration has been executed, because none exists yet

Revision 2 applies ten planning corrections issued at conceptual approval. §15 records what changed and why.

---

## 1. Governing files actually read

Read in full across planning runs 1 and 2:

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
| `.ai/project-memory/*` | Current milestone, business rules, glossary, known risks, ADR index |
| `.ai/policies/*` | Tool permissions (L0–L4), security guardrails, LLM operating rules |
| `.ai/templates/task.yaml`, `.ai/templates/adr.md` | Task and ADR contracts used in §11 and the ADR files |
| `.ai/workflows/` | `sale`, `refund`, `inventory-adjustment`, `catalog-ingestion`, `legacy-inventory-snapshot-import` |
| `.ai/skills/` (17 files) | `executive-orchestrator`, `adaptive-catalog-architect`, `catalog-normalization-parser`, `catalog-matcher`, `catalog-confidence-policy`, `catalog-feedback-learning`, `taxonomy-evolution-guardian`, `product-family-identity`, `source-identity-classifier`, `size-inventory-specialist`, `legacy-inventory-import`, `inventory-ledger-specialist`, `concurrency-transactions`, `financial-integrity`, `multi-tenancy-architect`, `rbac-permission-designer`, `modular-monolith-guardian`, `telegram-mini-app-specialist`, `high-frequency-pos-ux` |

Not read (not needed for planning): the remaining ~78 skill files, `CHANGELOG_V2/V3.md`, `CHECKSUMS.sha256`, `manifest.json`, `examples/`.

---

## 2. Repository map and current state

```text
D:\VScode\birka                      git repo, branch feat/foundation-milestone-1
├── .git/
├── .ai/                             154 files — governance pack v3 + this plan
├── .cursor/rules/project-governance.mdc
├── AGENTS.md · CLAUDE.md            agent bridge files
└── README.md
```

| Probe | Result |
|---|---|
| Application source code | NONE |
| `pyproject.toml` / `package.json` | ABSENT |
| `docker-compose.yml` / `Caddyfile` | ABSENT |
| `.github/` (CI) | ABSENT |
| `.gitignore` | ABSENT — **first file created in M1-001** |
| Migrations / database / tests | NONE |
| Secrets in repo | NONE |

Greenfield. No legacy code, no schema-compatibility burden. Every `<unknown>` in `.ai/project.md` is accurate and must not be filled with invented commands.

---

## 3. Facts, assumptions, open questions

### 3.1 Established facts

Governance-derived facts F1–F28 are unchanged from revision 1 and are not restated here; they live in `.ai/constitution.md`, `.ai/CATALOG_ARCHITECTURE.md`, `.ai/ADAPTIVE_CATALOG_LEARNING.md` and `.ai/project-memory/business-rules.md`. Facts confirmed by the owner at conceptual approval are added here:

- **F29.** ProductFamily is an identity boundary with its own independent identifier. `(concept, source, garment_type)` is a strong matching signal and candidate key, **not** absolute business identity. Several families may legitimately share that triple. Automatic merge remains forbidden.
- **F30.** A seller may complete a sale when system stock is `0` but the goods are physically present. The stock correction and the sale commit in one database transaction, the correction is exactly the shortfall, the reason code is `FOUND_DURING_SALE`, and it is fully audited. Arbitrary inventory adjustment remains a manager/owner permission.
- **F31.** No LLM parsing and no embeddings in Milestone 1. Confirmed decision, not an assumption.
- **F32.** Milestone 1 is delivered through four internal gates: M1A platform, M1B first complete sale vertical slice, M1C refund/transfer/legacy import, M1D client/E2E/release.

### 3.2 Assumptions still standing

| # | Assumption | Default | If wrong |
|---|---|---|---|
| A1 | Catalog is org-wide; inventory is per store | one catalog, two inventories | low — add store scoping to catalog reads |
| A2 | Two stores, one organization | org-aware schema, one org seeded | low |
| A3 | Roles OWNER / MANAGER / SELLER composed from capabilities | 3 seeded roles | low — roles are data |
| A4 | Parent/child is a label, not behaviour | no hierarchy column | low |
| A5 | Single currency, 2 decimals | `NUMERIC(12,2)` + org currency code | **medium-high** → Q1 |
| A6 | Price entered or confirmed at sale time | no price-list entity in M1 | **high** → Q1 |
| A7 | Stock tracked per size, with "size unknown" as a real state | inventory key includes size | **high** → Q2 |
| A8 | Transfers complete in one step | single-transaction OUT+IN | medium → Q5 |
| A9–A14 | No barcodes/photos/customers in M1; Telegram-only client; mixed UA/RU/latin shop language; single small VPS | as stated in revision 1 | low |

### 3.3 Open questions

| # | Question | Status |
|---|---|---|
| Q1 | Currency; price from a price list or typed at sale; discounts | **STILL OPEN — blocks M1-016** |
| Q2 | Is stock counted per size, or model+colour only | **STILL OPEN — blocks M1-013** |
| Q3 | Selling when system shows zero | **ANSWERED → F30** |
| Q4 | Number of sellers, shared vs personal devices, cross-store visibility | open — M1-008/009 defaults hold |
| Q5 | Transfer confirmation on receipt | open — default single-step |
| U11 | Real legacy documents (PDF/notebook pages) | **still required before M1-023 can close** |

---

## 4. Conceptual Domain Model

The conceptual model is the full business vocabulary. It is **not** a build list. §5 states which parts become physical tables in Milestone 1.

### 4.1 Entities by group

| Group | Entities |
|---|---|
| Tenancy & access | Organization, Store, User, Membership, Role, RolePermission |
| Catalog identity | BusinessCategory, GarmentType, CanonicalConcept, SourceIdentity, **ProductFamily**, AttributeTerm, ProductVariant |
| Size | SizeSystem, Size, SizeAlias |
| Evidence & learning | RawInput, RawInputProcessing, ParseResult, ProductAlias, AliasEvidence, CatalogMatchDecision, *CatalogFeedback*, *UnclassifiedDescriptor* |
| Inventory | StockLot, Inventory, StockMovement, InventorySnapshot, InventorySnapshotRow, *StockLotConsumption* |
| Money & movement | Sale, SaleItem, Refund, RefundItem, Transfer, TransferItem, *Price / PriceList*, *Customer* |
| Platform | IdempotencyRecord, AuditLog, *OutboxEvent* |
| Matching (future) | *ProductEmbedding* |

*Italic entities are conceptual only and are NOT built in Milestone 1.* Conceptual total: **42 entities**. Physical M1 total: **35 tables** (§5).

### 4.2 ProductFamily — corrected identity rule

This is the most important correction in revision 2.

```text
ProductFamily(
  id                    PK   -- independent surrogate identity
  organization_id       FK
  canonical_concept_id  FK   NOT NULL
  source_identity_id    FK   NULL      -- NULL = source not stated
  garment_type_id       FK   NULL      -- NULL = type not established
  distinction_note      TEXT NULL      -- why this family is separate from a look-alike
  status                ENUM(ACTIVE, NEEDS_REVIEW, MERGED)
  merged_into_id        FK   NULL
)

-- candidate key for retrieval and matching — deliberately NOT UNIQUE
INDEX ix_family_signature
  ON product_family (organization_id, canonical_concept_id,
                     source_identity_id, garment_type_id)
```

Rules:

1. **The triple is a signal, not an identity.** Two families may share `(concept, source, garment_type)` and still be different products — construction, cut, season or supplier batch may differ in ways the current schema does not model. Forcing a unique constraint on the triple would silently merge them, which is the exact failure the whole catalog design exists to prevent.
2. **Creating a second family with an identical triple is allowed but never automatic.** It requires a `NEW_MODEL` decision confirmed by a human, and `distinction_note` becomes mandatory on the new row so the reason survives.
3. **Automatic merge is forbidden.** Merging is an explicit, permissioned (`catalog:merge`), reversible, audited operation that writes `merged_into_id` and never rewrites historical `SaleItem` snapshots.
4. **The cost of this correction is acknowledged:** the database can no longer prevent accidental duplicate families. That protection moves from `DB_ENFORCED` to `SERVICE_ENFORCED` + `RECONCILIATION_DETECTED` — see §6 and the duplicate-signature report in M1-021.

### 4.3 Nullable uniqueness — sentinel rows vs `NULLS NOT DISTINCT`

Revision 1 proposed sentinel rows wherever a unique key spanned nullable columns. That was a database workaround dressed up as domain modelling. Corrected position:

| Case | Revision 1 | Revision 2 | Why |
|---|---|---|---|
| ProductFamily triple | sentinel `SourceIdentity('—')`, sentinel `GarmentType('—')` | **no sentinels**; plain `NULL` = "not stated"; index is non-unique | §4.2 removed the unique constraint, so the NULL problem disappears entirely |
| ProductVariant attribute tuple | sentinel terms | `UNIQUE NULLS NOT DISTINCT` on `(family_id, color, material, texture, fur, collar, length_cm)` | A variant *is* its attribute combination within a family. `NULL` means "attribute not applicable/unknown" and must collapse to one row, which is exactly `NULLS NOT DISTINCT` semantics. Requires **PostgreSQL ≥ 15** |
| Inventory key | sentinel `Size('UNKNOWN')` | **keep the row, for a different reason** | "Size not known" is a genuine domain state: legacy stock really is held without a known size and must be countable and reconcilable. It is a `Size` row because the business has that state, not to dodge a NULL |
| SourceIdentity semantic type | `UNKNOWN` enum value | unchanged | genuine domain state — the business has not decided whether Belardi is a brand or a supplier |

Rule adopted: **a sentinel row is legitimate only when the business genuinely has that state.** Where the only motivation is a unique index, use `NULLS NOT DISTINCT`. This pins PostgreSQL 15 or newer (M1-002 pins 17) and is recorded in ADR-0002.

### 4.4 RawInput lifecycle

`RawInput` is append-only evidence and must stay that way, so the lifecycle cannot live on it — a `status` column would require `UPDATE` on a table whose whole purpose is that it is never updated. The lifecycle goes in a companion row:

```text
RawInput(id PK, organization_id, store_id NULL, source_kind, source_ref,
         raw_text TEXT NOT NULL, content_hash, created_by, created_at)
  -- APPEND-ONLY; UPDATE and DELETE rejected by trigger

RawInputProcessing(raw_input_id PK/FK, 
         status ENUM(PENDING, PARSED, AMBIGUOUS, FAILED, RESOLVED),
         attempts INT NOT NULL DEFAULT 0,
         last_parse_result_id FK NULL,
         last_error TEXT NULL,
         parser_version TEXT NULL,
         next_retry_at TIMESTAMPTZ NULL,
         updated_at)
  -- mutable, exactly one row per RawInput
```

State transitions:

```text
PENDING ──parse ok──────────► PARSED ──decision applied──► RESOLVED
   │                             │
   │                             └──low confidence/conflict──► AMBIGUOUS ──human──► RESOLVED
   └──parser raised─────────► FAILED ──retry──► PENDING
```

Deterministic reprocessing:

- `ParseResult` is unique on `(raw_input_id, parser_version)`. Re-running the same parser version over the same raw text is a no-op that returns the existing row — retries are safe and repeatable.
- A new parser version produces a new `ParseResult` beside the old one. Nothing is overwritten, so parser regressions are diagnosable by comparing versions.
- Reprocessing never touches inventory. It can only move a row toward `PARSED`/`AMBIGUOUS`; applying a decision is a separate, permissioned step.
- `FAILED` rows are retryable in bulk after a parser fix: select by status, reset to `PENDING`, re-run. No row is ever dropped.

### 4.5 Idempotency contract

```text
IdempotencyRecord(
  id PK, organization_id FK, endpoint TEXT, key TEXT,
  request_fingerprint TEXT NOT NULL,     -- sha256 of canonical payload + actor + store
  status ENUM(IN_PROGRESS, COMPLETED),
  response_snapshot JSONB NULL,
  http_status INT NULL,
  created_at, expires_at)

UNIQUE (organization_id, endpoint, key)   -- namespaced by tenant AND operation
```

| Request | Outcome |
|---|---|
| New key | claim row `IN_PROGRESS`, execute, store response, mark `COMPLETED` |
| Same key + same fingerprint + `COMPLETED` | **replay** — return the stored response and status, execute nothing |
| Same key + same fingerprint + `IN_PROGRESS` | `409 IDEMPOTENCY_IN_PROGRESS`, client retries after a short delay |
| Same key + **different** fingerprint | `409 IDEMPOTENCY_CONFLICT` — never execute |
| Same key, different tenant or different endpoint | unrelated records; no collision by construction |

Retention: records expire 7 days after creation; expiry is a cleanup job, never a silent reuse window inside those 7 days.

**Interaction with `FOUND_DURING_SALE` (§4.6):** the corrected sale carries a different payload from the rejected one, so it **must** use a new idempotency key. The client generates a fresh key when the seller confirms the correction. Reusing the original key would correctly produce `IDEMPOTENCY_CONFLICT`; the client must not do that.

### 4.6 `FOUND_DURING_SALE` — the corrected sale flow

```text
1. POST /sales                      Idempotency-Key: K1
     line: variant V, size S, qty 2      inventory shows 0
   → 409 INSUFFICIENT_STOCK
     { line: 0, requested: 2, available: 0, correctable: true }

2. Seller taps «товар є в наявності»

3. POST /sales                      Idempotency-Key: K2   ← NEW key, different payload
     line: variant V, size S, qty 2
     found_in_store: [{ line: 0, quantity: 2 }]

   BEGIN
     permission check: sale:create  AND  inventory:correct_during_sale
     assert requested correction == exactly the shortfall (needed − available)
     UPDATE inventory  +2   →  StockMovement(ADJUSTMENT, +2,
                                             reason_code = FOUND_DURING_SALE)
     UPDATE inventory  −2   →  StockMovement(SALE, −2, reference = sale)
     INSERT Sale, SaleItems, AuditLog(actor, before 0, after 0, reason)
   COMMIT
   → 201 Sale
```

Constraints:

- The correction is **exactly** the shortfall. A request to correct more is rejected with `CORRECTION_EXCEEDS_SHORTFALL`. This is not a back door to arbitrary stock editing.
- Both movements are written. Net inventory change is `0`, and the ledger explains both halves.
- Permission `inventory:correct_during_sale` is narrow and may be granted to sellers. The broad `inventory:adjust` stays with manager/owner and is the only way to change stock outside a sale.
- The audit entry records actor, the system quantity before, the corrected quantity, the sale reference and the reason code.
- Reporting must be able to answer "how often did stock turn out to be wrong?" — `FOUND_DURING_SALE` frequency is a data-quality signal, not just a workaround.

---

## 5. M1 Physical Schema

**35 tables.** Built because Milestone 1 needs them, not because the conceptual model lists them.

| # | Group | Tables |
|---|---|---|
| 1–6 | Tenancy & access | `organization`, `store`, `app_user`, `membership`, `role`, `role_permission` |
| 7–13 | Catalog identity | `business_category`, `garment_type`, `canonical_concept`, `source_identity`, `product_family`, `attribute_term`, `product_variant` |
| 14–16 | Size | `size_system`, `size`, `size_alias` |
| 17–22 | Evidence & learning | `raw_input`, `raw_input_processing`, `parse_result`, `product_alias`, `alias_evidence`, `catalog_match_decision` |
| 23–27 | Inventory | `stock_lot`, `inventory`, `stock_movement`, `inventory_snapshot`, `inventory_snapshot_row` |
| 28–35 | Money, movement, platform | `sale`, `sale_item`, `refund`, `refund_item`, `transfer`, `transfer_item`, `idempotency_record`, `audit_log` |

### 5.1 Conceptual entities deliberately NOT built in M1

| Entity | Why not now | When |
|---|---|---|
| `CatalogFeedback` | Redundant in M1 — `catalog_match_decision` already stores predicted target, resolved target, per-field scores, margin, matcher version and who decided. That *is* the eval dataset | M2, when feedback analytics needs its own shape |
| `UnclassifiedDescriptor` | Derivable by query over `parse_result.unclassified` JSONB. Materializing it now is a cache with no reader | M2, when the taxonomy-promotion review needs standing counters |
| `Price` / `PriceList` | Blocked on Q1 | after Q1 |
| `StockLotConsumption` | M1 records lots as receipt provenance only. No FIFO, no lot-based costing, so no consumption table | when cost/margin reporting is built |
| `OutboxEvent` | Nothing consumes events in M1. `audit_log` covers traceability. A transactional outbox with zero consumers is infrastructure without measured need (constitution §14) | first async consumer |
| `Customer` | Out of MVP scope | later |
| `ProductEmbedding` | **Confirmed excluded from M1** (F31). Lexical retrieval plus attribute-conflict rules only | only after matcher evaluation on real data proves lexical retrieval insufficient |

### 5.2 Scope limits on tables that are built

- `stock_lot` — receipt provenance and acquisition type only (`PURCHASE`, `CONSIGNMENT`, `BORROWED`, `TRANSFER`, `RETURN`, `ADJUSTMENT`, `OPENING_BALANCE`). `stock_movement.stock_lot_id` is nullable. No lot selection on sale in M1.
- `attribute_term` — one dictionary discriminated by `kind`; only the six promoted kinds are used in M1 (colour, material, texture, fur, collar, plus `OTHER` for staging).
- `product_variant.attributes` JSONB — descriptive in M1, not part of identity. If a JSONB attribute turns out to define a distinct sellable item, that is the promotion trigger (taxonomy-evolution-guardian), handled by an additive migration.
- `refund`, `transfer` and the snapshot tables ship in gate M1C, but their migrations land with the M1B schema so there is one coherent schema baseline rather than a partial one.

---

## 6. Invariants, classified by enforcement level

Per correction 6, each invariant names **what actually enforces it**. Service-layer protection is not called a database guarantee.

`DB_ENFORCED` — the database rejects the violation.
`SERVICE_ENFORCED` — application code prevents it; the database would accept a violation written another way.
`CI_ENFORCED` — a build/test gate fails when violated.
`RECONCILIATION_DETECTED` — not prevented; detected after the fact by a reconciliation query or report.

| # | Invariant | Enforcement | Mechanism | Test |
|---|---|---|---|---|
| I1 | Inventory quantity never negative | `DB_ENFORCED` | `CHECK (quantity >= 0)` | two parallel sales of the last unit |
| I2 | One inventory row per (store, variant, size) | `DB_ENFORCED` | unique index; `size_id NOT NULL` | duplicate-insert test |
| I3 | Every quantity change has a ledger entry | `SERVICE_ENFORCED` + `CI_ENFORCED` + `RECONCILIATION_DETECTED` | only `InventoryService` writes `inventory`; import-linter forbids other modules; reconciliation compares `SUM(delta)` to `quantity` | injected divergence is detected |
| I4 | Sale and its stock effects are atomic | `SERVICE_ENFORCED` (DB-assisted) | one transaction opened at the service boundary; no commits in helpers | failure injection after movement write |
| I5 | A retried command never duplicates | `DB_ENFORCED` + `SERVICE_ENFORCED` | unique `(org, endpoint, key)` prevents the duplicate row; replay semantics are service logic | duplicate POST returns original; stock moves once |
| I6 | Concurrent sales cannot oversell | `DB_ENFORCED` | conditional `UPDATE … WHERE quantity >= :q`; `CHECK` is the backstop | parallel sessions, opposite line order |
| I7 | Money is exact | `DB_ENFORCED` + `CI_ENFORCED` | `NUMERIC(12,2)`; lint rule bans float in money paths | rounding suite, half-up cases |
| I8 | Historical sale facts never change | `DB_ENFORCED` + `SERVICE_ENFORCED` | snapshot columns `NOT NULL`; totals never recomputed from catalog | rename + merge, re-read old sale |
| I9 | Refund ≤ sold − already refunded | `SERVICE_ENFORCED` | `SELECT … FOR UPDATE` on sale items inside the refund transaction | two simultaneous full refunds |
| I10 | Raw input never rewritten | `DB_ENFORCED` | trigger rejects `UPDATE`/`DELETE` on `raw_input` | trigger raises |
| I11 | Ledger and audit are append-only | `DB_ENFORCED` | same trigger pattern on `stock_movement`, `alias_evidence`, `audit_log` | trigger raises |
| I12 | Store/tenant boundaries hold | `SERVICE_ENFORCED` + `CI_ENFORCED` | scope from session only; repository base requires explicit scope; negative test suite | seller of A blocked in B for read/sale/refund/transfer |
| I13 | Authorization is server-side | `SERVICE_ENFORCED` + `CI_ENFORCED` | permission check in services, not routers or UI | one escalation test per permission code |
| I14 | Uncertain interpretation never merges products | `SERVICE_ENFORCED` + `RECONCILIATION_DETECTED` | matcher returns `AMBIGUOUS`; merge is explicit and permissioned; duplicate-signature report lists families sharing a triple | Лоран/Belardi vs Лоран/Ponte golden case |
| I15 | Slash is not an alias; splits are never invented | `SERVICE_ENFORCED` + `CI_ENFORCED` | parser emits variant enumeration + `UNKNOWN_DISTRIBUTION` | golden test on `Лама бежевая/персик/butter 3 шт` |
| I16 | Transfers are movements, never sales | `SERVICE_ENFORCED` + `CI_ENFORCED` | transfer service writes only `TRANSFER_OUT`/`TRANSFER_IN` | no `sale` row, no revenue effect |
| I17 | Legacy import fabricates nothing | `SERVICE_ENFORCED` + `CI_ENFORCED` | approved rows emit only `OPENING_BALANCE` | no `DELIVERY`/`SALE` movement produced |
| I18 | Stock correction during a sale is exactly the shortfall | `SERVICE_ENFORCED` | assertion in the sale service; `CORRECTION_EXCEEDS_SHORTFALL` otherwise | over-correction rejected; audit entry present |
| I19 | Module boundaries hold | `CI_ENFORCED` | import-linter contract | a deliberate illegal import fails the build |

**Honest summary:** 8 invariants have real database teeth. 9 depend on application code holding its discipline, backed by tests and CI. 2 are detected rather than prevented. The two that changed level in revision 2 are I3 (never was `DB_ENFORCED`; revision 1 implied it was) and I14 (lost its accidental database backstop when the ProductFamily unique constraint was correctly removed).

---

## 7. Transaction boundaries

**`POST /sales`** — one transaction; see §4.6 for the `FOUND_DURING_SALE` variant.

```text
BEGIN
  resolve session → user, organization, store        (no client id trusted)
  check permission sale:create for that store
  claim idempotency key                              (conflict → replay or 409)
  sort lines by inventory.id ascending                ← deterministic order, no deadlocks
  for each line:
      [optional] found_in_store correction: +shortfall, ADJUSTMENT movement
      UPDATE inventory SET quantity = quantity - :q
        WHERE store_id=… AND product_variant_id=… AND size_id=… AND quantity >= :q
        RETURNING quantity
      0 rows → INSUFFICIENT_STOCK → ROLLBACK
  compute totals with Decimal
  INSERT Sale, SaleItems (immutable name/price snapshots)
  INSERT StockMovement per line (SALE, negative delta)
  INSERT AuditLog
  store idempotency response
COMMIT
```

**`POST /sales/{id}/refunds`** — load sale in tenant scope → `SELECT … FOR UPDATE` on sale items → validate refundable quantity → claim idempotency → compute from original snapshots → insert refund rows → conditional increment where `restock` → `REFUND_RETURN` movement → audit → commit.

**`POST /transfers`** — permission on source store → conditional decrement at source → increment at destination → `TRANSFER_OUT` + `TRANSFER_IN` → audit → commit. Two-phase mode adds an `IN_TRANSIT` holding state; not built unless Q5 says so.

**`POST /inventory/adjustments`** — permission `inventory:adjust` (manager/owner) → conditional update → `ADJUSTMENT` movement with mandatory reason code → audit → commit.

**`POST /catalog/entries`** — deliberately two transactions:

```text
TX1  INSERT RawInput + RawInputProcessing(status=PENDING)   COMMIT
TX2  parse → ParseResult → candidates → decision
     AUTO or human-CONFIRMED → resolve entities,
        conditional inventory update + DELIVERY movement (only if a quantity was given),
        decision status APPLIED, processing status RESOLVED, AliasEvidence
     otherwise → decision status NEEDS_REVIEW, processing status AMBIGUOUS,
        NO inventory effect
     COMMIT
```

**`POST /snapshots/{id}/approve`** — permission `snapshot:approve` → assert no row is `PENDING`/`NEEDS_REVIEW` → `OPENING_BALANCE` movements + inventory upsert → snapshot `APPLIED` → audit → commit. Idempotent by snapshot status.

---

## 8. Modular monolith

```text
backend/app/
├── core/            config · async session · errors · correlation ids · logging · security
├── modules/
│   ├── identity/  tenancy/  authz/
│   ├── catalog/   terms · concepts · families · variants · sizes
│   │              raw_input · parsing · matching · aliases
│   ├── inventory/ inventory · movements · lots · snapshots · reconciliation
│   ├── sales/  refunds/  transfers/  audit/  telegram/
├── api/v1/          thin routers
└── migrations/
frontend/src/
├── shared/telegram/   the only place tma.js is imported
├── features/          sale · search · receive · transfer · correct · review
└── entities/          typed client generated from the OpenAPI schema
infra/                 docker-compose.yml · Caddyfile · .env.example
```

Permitted dependency edges: `sales → inventory, catalog, authz, tenancy`; `refunds → sales, inventory`; `transfers → inventory`; `inventory → catalog` (read-only); `catalog` is a leaf. Enforced by an import-linter contract in CI (I19), recorded in ADR-0001.

---

## 9. API boundary

Base `/api/v1`. `Idempotency-Key` required on every mutating endpoint. `X-Request-ID` on every response, matching the log correlation id.

| Method | Path | Permission |
|---|---|---|
| POST | `/auth/telegram` | — (initData verified server-side) |
| GET | `/me` | — |
| POST | `/catalog/parse` | `catalog:create` — **preview only, never mutates** |
| POST | `/catalog/entries` | `inventory:receive` |
| GET | `/catalog/search` | `inventory:view` |
| GET | `/catalog/review-queue` | `catalog:confirm` |
| POST | `/catalog/decisions/{id}/resolve` | `catalog:confirm` |
| POST | `/catalog/families/{id}/merge` | `catalog:merge` |
| GET | `/inventory` | `inventory:view` |
| POST | `/inventory/receipts` | `inventory:receive` — structured intake, no NL (M1B) |
| POST | `/inventory/adjustments` | `inventory:adjust` |
| POST | `/sales` | `sale:create` (+ `inventory:correct_during_sale` when correcting) |
| GET | `/sales`, `/sales/{id}` | `sale:view` |
| POST | `/sales/{id}/refunds` | `sale:refund` |
| POST | `/transfers` | `transfer:create` |
| POST | `/snapshots` … `/approve` | `snapshot:import` / `snapshot:approve` |

Permission codes (in application code, not a table): `sale:create`, `sale:refund`, `sale:view`, `inventory:view`, `inventory:receive`, `inventory:adjust`, `inventory:correct_during_sale`, `transfer:create`, `transfer:receive`, `catalog:create`, `catalog:confirm`, `catalog:merge`, `snapshot:import`, `snapshot:approve`, `report:view_financial`, `user:manage`.

Stable error codes: `INSUFFICIENT_STOCK`, `CORRECTION_EXCEEDS_SHORTFALL`, `CATALOG_AMBIGUOUS`, `FORBIDDEN_STORE`, `PERMISSION_DENIED`, `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`, `REFUND_EXCEEDS_SOLD`, `VALIDATION_ERROR`.

Performance budgets (to be measured, not assumed): `/catalog/search` p95 ≤ 300 ms, `POST /sales` p95 ≤ 500 ms, time-to-sale ≤ 15 s, taps-to-sale ≤ 5.

---

## 10. MVP scope

**In:** Telegram auth · store and role context · find a product · create a sale · correct a mistake · return · receive goods (structured in M1B, natural language in M1C) · transfer between stores · check stock · legacy snapshot import · audit trail.

**Out of M1:** reporting dashboards · margin analysis · **LLM parsing and reranking (confirmed, F31)** · **embeddings / semantic retrieval (confirmed, F31)** · barcodes and printed labels · photos · customer records · discount engine · multi-currency · consignment settlement · offline mode.

**Prepared for without being built:** `catalog_match_decision` already has the shape an LLM reranker would fill; `attributes` JSONB absorbs new descriptors with no migration; `stock_lot.acquisition_type` already separates consignment and borrowed goods.

---

## 11. Milestone 1 — 28 tasks in 4 gates

Revision 1 said "24 tasks" while listing M1-001…M1-028. The correct count is **28**. Gates replace the earlier wave numbering as the primary structure; waves remain only as a scheduling hint inside each gate.

### Gate M1A — Platform & Foundation (9 tasks)

*Exit criterion: `docker compose up` gives a running API with migrations, Telegram auth and RBAC, and CI is green.*

| ID | Task | Owner skill | Depends on |
|---|---|---|---|
| M1-001 | Monorepo scaffold, **`.gitignore` first**, ruff + mypy + pytest, eslint + tsc, pre-commit | `devops-docker-caddy`, `backend-fastapi-engineer` | — |
| M1-002 | Docker Compose: **PostgreSQL 17**, api, web, Caddy, `.env.example` | `devops-docker-caddy` | M1-001 |
| M1-003 | CI: lint, typecheck, unit, integration against real Postgres, migration-drift check | `ci-cd-engineer` | M1-001 |
| M1-004 | ADR-0001 module boundaries + import-linter contract | `solution-architect`, `modular-monolith-guardian` | M1-001 |
| M1-005 | App core: settings, async session, error→HTTP mapping, correlation ids, structured logging, Sentry | `backend-fastapi-engineer`, `request-correlation` | M1-001 |
| M1-006 | Alembic setup, naming conventions, drift check | `alembic-migration-engineer` | M1-005 |
| M1-007 | Tenancy schema + scope resolution | `multi-tenancy-architect` | M1-006 |
| M1-008 | Telegram initData verification + session issuance | `telegram-mini-app-specialist`, `security-engineer` | M1-005 |
| M1-009 | RBAC: permission codes, roles, service-layer decision points | `rbac-permission-designer` | M1-007 |

### Gate M1B — First complete Sale vertical slice (8 tasks)

*Exit criterion: a product can be created, stock received, and sold — including the `FOUND_DURING_SALE` path — with every M1B invariant proven by test. This is the gate that proves the product's core promise.*

| ID | Task | Owner skill | Depends on |
|---|---|---|---|
| M1-010 | Catalog identity schema, **ProductFamily with independent id + non-unique signature index** (§4.2) | `adaptive-catalog-architect`, `postgres-engineer` | M1-006 |
| M1-011 | Size systems, sizes, aliases, "size unknown" as domain state | `size-inventory-specialist` | M1-010 |
| M1-012 | `raw_input` (append-only) + `raw_input_processing` lifecycle + `parse_result` uniqueness (§4.4) | `adaptive-catalog-architect` | M1-010 |
| M1-013 | Inventory + stock movement + stock lot, `CHECK (quantity >= 0)`, reconciliation query | `inventory-ledger-specialist`, `postgres-engineer` | M1-011, **Q2** |
| M1-014 | Idempotency: fingerprint, claim/replay, conflict, namespacing (§4.5) | `concurrency-transactions` | M1-013 |
| M1-015 | `InventoryService`: atomic conditional movement application + structured `POST /inventory/receipts` | `concurrency-transactions`, `concurrency-test-engineer` | M1-013 |
| M1-016 | Sale service + `POST /sales` + Decimal money + immutable snapshots | `backend-fastapi-engineer`, `financial-integrity` | M1-014, M1-015, **Q1, Q2** |
| M1-019 | `FOUND_DURING_SALE` correction path + `inventory:adjust` for manager/owner + audit (§4.6) | `human-error-resilience` | M1-016 |

### Gate M1C — Refund, Transfer, Catalog pipeline, Legacy import (6 tasks)

*Exit criterion: mistakes are recoverable, goods move between stores, natural-language intake works on a real corpus, and the legacy lists are imported as traceable opening balances.*

| ID | Task | Owner skill | Depends on |
|---|---|---|---|
| M1-017 | Refund service + endpoint | `compensating-operations`, `financial-integrity` | M1-016 |
| M1-018 | Transfer service + endpoints, `TRANSFER_OUT`/`TRANSFER_IN` | `inventory-ledger-specialist` | M1-015 |
| M1-020 | Normalization + deterministic parser v1: slash rule, per-field confidence, unclassified descriptors | `catalog-normalization-parser` | M1-012 |
| M1-021 | Matcher v1: alias → `pg_trgm` → attribute compatibility → 5 decision types + margin policy + **duplicate-signature report** | `catalog-matcher`, `catalog-confidence-policy` | M1-020, M1-010 |
| M1-022 | Alias/feedback evidence, `NEW→LEARNING→VERIFIED` promotion, review-queue API | `catalog-feedback-learning` | M1-021 |
| M1-023 | Snapshot import: raw rows, parse, review, approve → opening balances | `legacy-inventory-import` | M1-021, M1-013, **U11** |

### Gate M1D — Client, E2E, Release (5 tasks)

*Exit criterion: sellers can do the job in Telegram, golden paths pass end to end, and a restore drill has actually been executed.*

| ID | Task | Owner skill | Depends on |
|---|---|---|---|
| M1-024 | Frontend scaffold, Telegram integration layer, auth, typed API client | `frontend-react-engineer`, `telegram-mini-app-specialist` | M1-008 |
| M1-025 | Seller flows: search, sale, receive, quick correction | `high-frequency-pos-ux` | M1-024, M1-016 |
| M1-026 | Catalog confirmation UI: 2–3 candidates, one tap, explicit "це новий товар" | `ux-product-designer` | M1-024, M1-021 |
| M1-027 | Playwright E2E golden paths | `playwright-e2e` | M1-025, M1-026 |
| M1-028 | Release gate: DoD, perf budget, production readiness, **backup with verified restore** | `release-manager`, `production-readiness-review` | all |

**9 + 8 + 6 + 5 = 28.**

### Parallelism

M1A is mostly serial (M1-001 first; then 002/003/004 together, 005→006→007→008/009). Inside M1B the chain M1-013 → M1-014 → M1-015 → M1-016 → M1-019 is strictly serial; M1-010/011/012 precede it and can be done together. M1C splits into two independent tracks — money/movement (017, 018) and catalog (020 → 021 → 022/023). M1-024 can start any time after M1-008, so the client track overlaps M1B entirely.

Per `.ai/OPERATING_MANUAL.md` §6, the implementer of M1-014, M1-015, M1-016, M1-017, M1-019 and M1-021 is not their own final reviewer: each gets a fresh-context `code-reviewer` plus `adversarial-reviewer`, and M1-007/008/009 additionally get `security-engineer`.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Over-merging goods that share a nickname | family boundary with independent id, `AMBIGUOUS`, no automatic merge (I14) |
| **New in rev 2: duplicate families created by accident** | matcher requires explicit `NEW_MODEL` + mandatory `distinction_note`; duplicate-signature report in M1-021; merge is reversible |
| Source labels wrongly treated as brands | `semantic_type` stays `UNKNOWN` until a human changes it |
| Invented size/colour distribution on import | `UNKNOWN_DISTRIBUTION` blocks snapshot approval (I17) |
| Taxonomy frozen too early | JSONB attributes; promotion is an additive migration |
| Duplicate sales on a flaky connection | idempotency with fingerprint (I5) |
| **`FOUND_DURING_SALE` used as a back door** | correction is exactly the shortfall (I18); frequency is reported as a data-quality signal |
| Parser corpus built without real data | conservative thresholds; corpus extended on real pages before automation increases (U11) |
| Three tracks, one operator | gates are ordered so M1A → M1B alone still delivers a working, correct sale |

---

## 13. Evidence and verification status

| Item | Status |
|---|---|
| Governing files read | DONE (§1) |
| Repository inspected | DONE (§2) |
| Corrections 1–10 applied | DONE (§15) |
| Code written | NONE — M1-001 not started |
| Tests run | `NOT VERIFIED` — no suite exists |
| Migrations | `NOT VERIFIED` — none exist |
| Build / lint / typecheck | `NOT VERIFIED` — no toolchain exists |
| `NULLS NOT DISTINCT` behaviour on PostgreSQL 17 | `NOT VERIFIED` — to be proven by a migration test in M1-010 |

---

## 14. Open items blocking implementation

- **Q1** (currency, price source, discounts) blocks M1-016.
- **Q2** (per-size stock) blocks M1-013.
- **U11** (real legacy documents) blocks closing M1-023.
- Q4 and Q5 have working defaults and do not block.

M1A (M1-001 … M1-009) depends on none of these and is ready to start on approval of this revision.

---

## 15. Revision 2 — what changed and why

| # | Correction | Change made | Consequence |
|---|---|---|---|
| 1 | ProductFamily identity | Removed `UNIQUE(concept, source, garment_type)`; family has its own id; triple demoted to a non-unique signature index and candidate key; `distinction_note` added | Prevents schema-forced merging of genuinely different products. Cost: duplicate-family protection drops from `DB_ENFORCED` to service + reconciliation (I14) |
| 2 | Nullable uniqueness | Sentinel rows dropped for source/garment type; `UNIQUE NULLS NOT DISTINCT` adopted for the variant tuple; "size unknown" kept as genuine domain state | Pins **PostgreSQL ≥ 15** (M1-002 pins 17). Sentinels now only where the business really has that state |
| 3 | `FOUND_DURING_SALE` | New flow (§4.6), new permission `inventory:correct_during_sale`, new invariant I18, new error `CORRECTION_EXCEEDS_SHORTFALL`, moved into M1-019 | Seller is never blocked; correction and sale are one transaction; arbitrary adjustment stays manager/owner |
| 4 | Idempotency | Fingerprint, four explicit outcomes, tenant+operation namespacing, 7-day retention, and the **new-key rule** for corrected sales (§4.5) | Replay and conflict are now specified behaviour, not an implementation detail |
| 5 | RawInput lifecycle | Lifecycle moved to a separate mutable `raw_input_processing` row so `raw_input` stays append-only; `parse_result` unique per `(raw_input, parser_version)` for deterministic retry | Evidence immutability preserved *and* reprocessing is safe and repeatable |
| 6 | Invariant enforcement levels | All 19 invariants classified `DB_ENFORCED` / `SERVICE_ENFORCED` / `CI_ENFORCED` / `RECONCILIATION_DETECTED` | I3 and I14 are no longer described as database guarantees, because they never were |
| 7 | Count inconsistencies | Tasks: 24 → **28** (actual count of M1-001…M1-028). Tables: "31" → **42 conceptual entities, 35 physical M1 tables** | Numbers now match the lists they describe |
| 8 | Conceptual vs physical | §4 is the conceptual model; §5 is the M1 build list; §5.1 names 7 entities deliberately not built and why | `CatalogFeedback` and `UnclassifiedDescriptor` dropped from M1 as redundant/derivable |
| 9 | Implementation gates | 28 tasks regrouped into M1A (9) / M1B (8) / M1C (6) / M1D (5), each with an exit criterion | M1A + M1B alone deliver a correct, working sale |
| 10 | No LLM/embeddings in M1 | Recorded as confirmed fact F31, not an assumption; `ProductEmbedding` listed as conceptual-only | Matcher v1 stays deterministic: aliases + trigram + attribute conflicts |

**On approval of this revision:** start M1-001. Q1 and Q2 must be answered before M1-013 and M1-016 open; everything in gate M1A is unblocked today.
