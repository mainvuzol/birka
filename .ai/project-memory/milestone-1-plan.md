# Milestone 1 Plan — Production Foundation Without Irreversible Catalog Assumptions

**Status:** `APPROVED — revision 3. Gate M1A implemented and independently reviewed.`
**Branch:** `feat/foundation-milestone-1`
**Prepared by:** Executive Orchestrator, planning runs 1–3
**Implementation started:** YES — gate M1A only. M1B does not open until M1A's exit criterion is met and independently reviewed.
**Verification status:** gate M1A — lint, format, strict types, import contracts and 95 tests pass locally; 15 database tests run in CI only. See the M1A completion report in §17.

Revision 2 applied ten planning corrections (§15). Revision 3 adds two technical clarifications and records the business confirmations for money, inventory granularity and the parser corpus (§16).

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

Confirmed at revision 3:

- **F33 (money).** Currency is **UAH**. A store/variant may carry a *current suggested selling price* so the seller does not retype it every sale. `SaleItem` always freezes its own `unit_price`, `discount_amount`, `final_unit_price` and `currency_code`, and those values are immutable afterwards. Acquisition cost belongs to `StockLot`, never to the catalog. Item-level discount **data** is supported in M1; a discount/promotion **engine** is not built. Money uses PostgreSQL `NUMERIC` and Python `Decimal` only.
- **F34 (inventory granularity).** Inventory is tracked by `store + product_variant + size` when size is known. `UNKNOWN_SIZE` is a legitimate domain size for legacy or incomplete data. Size distribution is never invented. Reclassifying `UNKNOWN_SIZE` stock into concrete sizes is an **audited inventory reclassification**, never a silent rewrite of history.
- **F35 (parser corpus).** The real legacy PDFs already provided satisfy the real-data requirement. Originals are private source material and are **not** committed to Git; they live under a gitignored `data/legacy/raw/`. A sanitized, versioned golden corpus derived from real lines lives under `backend/tests/fixtures/`.
- **F36 (command identity).** Business uniqueness of a critical command rests on a **permanent** `command_id`, not on a retention-limited idempotency record. See §4.5.
- **F37 (parse determinism).** A `ParseResult` is a pure function of `(raw_text, parser_version)`. Catalog knowledge must not leak into parsing. See §4.7.
- **F38 (gate order).** M1A starts immediately and does not wait on M1B questions.

### 3.2 Assumptions still standing

| # | Assumption | Default | If wrong |
|---|---|---|---|
| A1 | Catalog is org-wide; inventory is per store | one catalog, two inventories | low — add store scoping to catalog reads |
| A2 | Two stores, one organization | org-aware schema, one org seeded | low |
| A3 | Roles OWNER / MANAGER / SELLER composed from capabilities | 3 seeded roles | low — roles are data |
| A4 | Parent/child is a label, not behaviour | no hierarchy column | low |
| ~~A5, A6~~ | superseded by **F33** — currency, price source and discount handling are confirmed | — | — |
| ~~A7~~ | superseded by **F34** — per-size inventory with `UNKNOWN_SIZE` is confirmed | — | — |
| A8 | Transfers complete in one step | single-transaction OUT+IN | medium → Q5 |
| A9–A14 | No barcodes/photos/customers in M1; Telegram-only client; mixed UA/RU/latin shop language; single small VPS | as stated in revision 1 | low |

### 3.3 Open questions

| # | Question | Status |
|---|---|---|
| Q1 | Currency; price source; discounts | **ANSWERED → F33** |
| Q2 | Is stock counted per size | **ANSWERED → F34** |
| Q3 | Selling when system shows zero | **ANSWERED → F30** |
| Q4 | Number of sellers, shared vs personal devices, cross-store visibility | open — M1-008/009 defaults hold, blocks nothing |
| Q5 | Transfer confirmation on receipt | open — default single-step, blocks nothing |
| U11 | Real legacy documents | **ANSWERED → F35** |

**No open question blocks any Milestone 1 task.** Q4 and Q5 refine defaults that are already implemented safely.

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

### 4.5 Command identity and idempotency — two separate mechanisms

These are not the same thing and must not share a lifetime.

| | **Command identity** | **Idempotency record** |
|---|---|---|
| Question it answers | "Has this business operation already happened?" | "What did we answer last time?" |
| Lifetime | **permanent** | retention-limited (7 days) |
| Storage | `command_id` column on the business row | `idempotency_record` table |
| Enforcement | `UNIQUE` constraint — `DB_ENFORCED` | service replay logic |
| If it is missing | a duplicate business operation is created | a client gets a fresh execution instead of a cached answer |

**Command identity (permanent).** Every critical command carries a client-generated `command_id` (UUID) that is stored on the row it creates and constrained unique for the life of the data:

```text
sale      command_id UUID NOT NULL   UNIQUE (organization_id, command_id)
refund    command_id UUID NOT NULL   UNIQUE (organization_id, command_id)
transfer  command_id UUID NOT NULL   UNIQUE (organization_id, command_id)
```

A replay arriving after the idempotency record has expired therefore still cannot create a second sale: the insert violates the unique constraint, the service catches it and returns the existing operation. The business invariant lives in the database and never expires.

**Idempotency record (retention-limited).** A cache that lets a retry get the original *response* — including the exact HTTP status and body — without re-executing. It is an optimisation and a UX guarantee, not the correctness guarantee.

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

Retention: records expire 7 days after creation; expiry is a cleanup job, never a silent reuse window inside those 7 days. **After expiry the business is still protected by the permanent `command_id` constraint** — the client simply re-executes and receives the existing operation instead of a cached response.

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

### 4.7 Parsing is deterministic; learning happens in matching

Parsing and learning must not be mixed, or `parser_version` stops meaning anything. If the parser consulted the alias table, then re-parsing the same line next month — after a seller confirmed one new alias — would silently produce a different `ParseResult` under the *same* version string. Every stored parse would become unreproducible, and a parser regression would be undiagnosable.

```text
RawInput  ──────────────────────────────────►  ParseResult
          pure function of (raw_text, parser_version)
          normalization · tokenization · slash rule
          per-field confidence · unclassified descriptors
          NO catalog lookups, NO alias table, NO database reads

ParseResult  +  current catalog knowledge  ──►  CatalogMatchDecision
                aliases · existing families · variants
                trigram retrieval · attribute conflicts
                records matcher_version AND knowledge revision
```

Rules:

1. **The parser reads no catalog state.** Given the same `raw_text` and `parser_version`, the output is byte-identical, forever. That is what makes `UNIQUE (raw_input_id, parser_version)` a correct constraint and reprocessing deterministic (§4.4).
2. **All catalog knowledge enters at the matching step.** Aliases, existing families, confirmations and rejections are matcher inputs, never parser inputs.
3. **`CatalogMatchDecision` records the knowledge it used**, so a decision is explainable after the catalog has moved on:
   - `matcher_version` — the matching algorithm,
   - `knowledge_revision` — a monotonic counter bumped whenever verified aliases or family/variant identity change,
   - the candidate set with per-field scores, margin and conflicts, as already specified.
4. **Re-matching is expected and cheap; re-parsing is rare.** A new decision over an old `ParseResult` is normal when catalog knowledge improves. The evidence and its parse stay untouched.
5. **Consequence for M1-020/M1-021:** the parser is unit-testable with no database at all — golden corpus in, structured fields out. That is why the parser corpus (F35) can be a pure fixture suite.

### 4.8 Money (F33)

Three places hold a monetary value, and each answers a different question.

```text
VariantPrice        -- "what should the seller be offered?"  MUTABLE, current only
  id PK, organization_id FK, store_id FK NULL, product_variant_id FK
  suggested_price NUMERIC(12,2) NOT NULL, currency_code CHAR(3) NOT NULL
  updated_by FK, updated_at
  UNIQUE NULLS NOT DISTINCT (organization_id, store_id, product_variant_id)
  -- store_id NULL = organization-wide default; a store row overrides it

SaleItem            -- "what was actually charged?"  IMMUTABLE, frozen at sale
  unit_price        NUMERIC(12,2) NOT NULL   -- before discount
  discount_amount   NUMERIC(12,2) NOT NULL DEFAULT 0
  final_unit_price  NUMERIC(12,2) NOT NULL   -- charged per unit
  currency_code     CHAR(3)       NOT NULL
  quantity          INT           NOT NULL CHECK (quantity > 0)
  line_total        NUMERIC(12,2) NOT NULL
  display_name_snapshot TEXT NOT NULL, variant_snapshot JSONB NOT NULL
  CHECK (final_unit_price = unit_price - discount_amount)
  CHECK (line_total      = final_unit_price * quantity)

StockLot            -- "what did it cost us?"  acquisition side, never catalog
  unit_cost NUMERIC(12,2) NULL, currency_code CHAR(3) NULL
```

Rules:

- Currency is **UAH** for the organization. `currency_code` is stored explicitly on every monetary row anyway, so historical rows stay self-describing if that ever changes.
- The suggested price is a *convenience*, not an authority. The sale request carries the actual prices; the server validates them but does not silently substitute the catalog price. A price changed after a sale never affects that sale (I8).
- `discount_amount` is **data**, not a rules engine. M1 stores what the seller applied. No promotion rules, no automatic discounts, no coupon model.
- The two `CHECK` constraints make the arithmetic relationship `DB_ENFORCED`, so a rounding bug in application code cannot persist an internally inconsistent line.
- Rounding: computed per line with `Decimal`, `ROUND_HALF_UP`, to 2 decimal places. Sale totals are the sum of stored line totals, never a recomputation from unit prices.

### 4.9 UNKNOWN_SIZE reclassification (F34)

`UNKNOWN_SIZE` stock is real stock. Turning it into concrete sizes is an audited operation, not an edit:

```text
BEGIN
  permission inventory:adjust
  decrement UNKNOWN_SIZE by n     → StockMovement(ADJUSTMENT, -n,
                                      reason_code = SIZE_RECLASSIFICATION_OUT)
  increment size M by n           → StockMovement(ADJUSTMENT, +n,
                                      reason_code = SIZE_RECLASSIFICATION_IN)
  INSERT AuditLog(before, after, reason, actor, linked movements)
COMMIT
```

Total quantity is unchanged, both halves are in the ledger, and the reclassification is reversible by the same mechanism. Nothing is rewritten.

**As built (2026-09-29, owner decision, [ADR-0005 §11](../decisions/ADR-0005-legacy-snapshot-import.md)):** at the counter first, inside `POST /sales` (`size_clarified`). A seller with `inventory:correct_during_sale` reclassifies exactly the units the sale is short of at the size being sold; the sale then takes them. The ledger door refuses half a pair, a pair out of a known size, and a pair into "size not known". So "reversible by the same mechanism" no longer holds for the size-not-known side: that size enters only from a list (ADR-0005 §3), and a misread size is corrected like any wrong sale. The stand-alone manager command above is not built yet.

---

## 5. M1 Physical Schema

**38 tables, including `stock_location` and `store_location_access`, which carry the stock key since M1-029.** Built because Milestone 1 needs them, not because the conceptual model lists them.

| # | Group | Tables | Gate |
|---|---|---|---|
| 1–6 | Tenancy & access | `organization`, `store`, `app_user`, `membership`, `role`, `role_permission` | **M1A** |
| 7–13 | Catalog identity | `business_category`, `garment_type`, `canonical_concept`, `source_identity`, `product_family`, `attribute_term`, `product_variant` | M1B |
| 14–16 | Size | `size_system`, `size`, `size_alias` | M1B |
| 17–22 | Evidence & learning | `raw_input`, `raw_input_processing`, `parse_result`, `product_alias`, `alias_evidence`, `catalog_match_decision` | M1B / M1C |
| 23–27 | Inventory | `stock_lot`, `inventory`, `stock_movement`, `inventory_snapshot`, `inventory_snapshot_row` | M1B / M1C |
| 28 | Price | `variant_price` — and no second price table; history is out of M1 | M1B |
| 29–36 | Money, movement, platform | `sale`, `sale_item`, `refund`, `refund_item`, `transfer`, `transfer_item`, `idempotency_record`, `audit_log` | M1B / M1C |

Exact list: 6 tenancy + 7 catalog + 3 size + 6 evidence + 5 inventory + 1 price + 8 money/platform = **36** original tables, plus `stock_location` and `store_location_access` in tenancy = **38**.

`sale`, `refund` and `transfer` each additionally carry a permanent `command_id` with `UNIQUE (organization_id, command_id)` — see §4.5.

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
| I12 | Store/tenant boundaries hold | `DB_ENFORCED` (membership↔organization) + `SERVICE_ENFORCED` + `CI_ENFORCED` | composite foreign keys bind `membership.store_id`/`role_id` to `membership.organization_id`; scope comes from the session only | cross-organization membership rejected by the database; store isolation in `resolve_scope`. API-level since 2026-09-15: `test_product_lifecycle_api.py` proves over HTTP that another organization can neither extend this catalog (404) nor act in this store (403), and that a foreign variant cannot be received into stock |
| I13 | Authorization is server-side | `SERVICE_ENFORCED` + `CI_ENFORCED` | `scope.require` at the command boundary — in practice the router, deliberately: a command must be refused before it claims an idempotency key or replays a stored response, so a revoked grant cannot keep returning an old success. The decision always reads the scope rebuilt from the database, never anything the client sent. Never in the UI | one escalation test per permission code; `test_a_replay_is_refused_once_the_grant_is_gone` covers the replay ordering |
| I14 | Uncertain interpretation never merges products | `SERVICE_ENFORCED` + `RECONCILIATION_DETECTED` | matcher returns `AMBIGUOUS`; merge is explicit and permissioned; duplicate-signature report lists families sharing a triple | Лоран/Belardi vs Лоран/Ponte golden case |
| I15 | Slash is not an alias; splits are never invented | `SERVICE_ENFORCED` + `CI_ENFORCED` | parser emits variant enumeration + `UNKNOWN_DISTRIBUTION` | golden test on `Лама бежевая/персик/butter 3 шт` |
| I16 | Transfers are movements, never sales | `SERVICE_ENFORCED` + `CI_ENFORCED` | transfer service writes only `TRANSFER_OUT`/`TRANSFER_IN` | no `sale` row, no revenue effect |
| I17 | Legacy import fabricates nothing | `SERVICE_ENFORCED` + `DB_ENFORCED` (since M1-023) + `CI_ENFORCED` | approval writes only `OPENING_BALANCE`, and only `inventory.apply_opening_balance` writes it (the public ledger door refuses it); CHECKs `opening_balance_names_its_list` / `opening_lot_names_its_list` and trigger `opening_balance_traces_to_its_list` refuse an opening balance that does not come from an opening lot of the list it names; receipts cannot label a lot `OPENING_BALANCE`; a decided list is frozen by trigger. Opening only an empty warehouse is service-enforced under the warehouse lock (ADR-0005) | `test_approval_turns_the_list_into_opening_stock_and_nothing_else`, `test_an_opening_balance_cannot_be_written_outside_a_list`, `test_a_decided_list_is_frozen_by_the_database` |
| I18 | Stock correction during a sale is exactly the shortfall | `SERVICE_ENFORCED` | assertion in the sale service; `CORRECTION_EXCEEDS_SHORTFALL` otherwise | over-correction rejected; audit entry present |
| I19 | Module boundaries hold | `CI_ENFORCED` (partial) | import-linter contracts. **Only the relationships already encoded** — a contract can name only modules that exist, so each ships with its module (ADR-0001 rule 5) | a deliberate illegal import fails the build |
| I20 | A critical command can never create a second business operation, at any distance in time | `DB_ENFORCED` | permanent `UNIQUE (organization_id, command_id)` on `sale`, `refund`, `transfer`, `inventory_snapshot` (M1-023) and `goods_receipt` (`0016`, [ADR-0006](../decisions/ADR-0006-goods-receipt-command-identity.md)) — independent of idempotency-record retention. **`POST /inventory/adjustments` is still outside it** and doubles a replayed correction once its 7-day cache expires; see ADR-0006's consequences | replay after the idempotency record is deleted still returns the original operation |
| I21 | A parse is reproducible forever | `DB_ENFORCED` + `CI_ENFORCED` | `UNIQUE (raw_input_id, parser_version)`; the parser performs no catalog or database reads | same input + same parser version yields byte-identical output; an import-linter rule forbids `catalog.matching`/repository imports inside the parser package |
| I22 | Money arithmetic on a sale line is internally consistent | `DB_ENFORCED` | `CHECK (final_unit_price = unit_price - discount_amount)` and `CHECK (line_total = final_unit_price * quantity)` | an inconsistent line cannot be inserted |
| I23 | A store may only read or change stock at a location it holds explicit access to | `SERVICE_ENFORCED` + `CI_ENFORCED` | `store_location_access` row required; a name or a `StoreKind` never grants reach | a store with no access row is refused before any row is read or written, and leaves no idempotency claim |
| I24 | A `TRANSFER_OUT` has exactly one matching `TRANSFER_IN` — same product, size and magnitude, a different location, naming the same transfer — and both pass through the ledger in one call. Goods do not move between locations under any other movement type | Pairing: `SERVICE_ENFORCED` at the ledger's door, for every caller. "No other movement type": **by construction and review only** — see below | `inventory.validate_location_flows` in `apply_movements`; the transfer command is the only writer of transfer movements; import contract: `sales` may not import `transfers` | half a transfer, two legs at one place, unequal legs and legs naming no transfer are each refused at the door; a multi-location sale basket, and a sale confirming stock on one shelf while reporting it missing from another, are **not** transfers |
| I25 | A `MISSING_AT_SALE` adjustment never exceeds the shortfall of the line being sold, never exceeds what the ledger already believed was there, and never adds stock | `SERVICE_ENFORCED` | `_resolve_shortages` in the sale service takes `min(available, demand) − confirmed` and skips anything not positive | a seller reporting a shortage cannot empty a shelf, cannot drive a balance negative, and cannot mint stock by claiming more is present than the ledger holds |

**I25 arrived with M1-030 and is in force.** It is the mirror of I18: both bound an in-sale correction to the line in front of the seller, which is what makes either safe to grant. A second stable capability, `inventory:report_missing_during_sale`, carries it, and it is **not** in the default seller role.

**I23 and I24 arrived with [ADR-0004](../decisions/ADR-0004-stock-locations.md). I23 is in force since M1-029. I24 is in force since M1-018 (2026-09-22) — its pairing half, at the ledger's door, for every caller.** Its other half is deliberately not a check: the mechanical form "no plus at one location beside a minus at another" refused a real sale when it was tried (the M1-030 basket that confirms coats on one shelf and finds one missing from another), and the sale writes its corrections and its lines in separate calls, so no single call sees a whole command. Apart from the transfer, no command nets one location upward while netting another downward; a new stock command must be reviewed against that ([M1-018 report](m1-018-transfer-report.md) §3). **I2 is restated** as one inventory row per *(location, variant, size)*. A new stable error code, `LOCATION_ACCESS_DENIED` (403), carries I23 at the API boundary.

**Honest summary:** 11 invariants have real database teeth. 10 depend on application code holding its discipline, backed by tests and CI. 2 are detected rather than prevented. The two that changed level in revision 2 are I3 (never was `DB_ENFORCED`; revision 1 implied it was) and I14 (lost its accidental database backstop when the ProductFamily unique constraint was correctly removed).

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

**`POST /snapshots/{id}/approve`** — permission `snapshot:approve` → assert no row is `PENDING`/`NEEDS_REVIEW` → `OPENING_BALANCE` movements + inventory upsert → snapshot `APPLIED` → audit → commit. Idempotent by snapshot status. **As built (M1-023, ADR-0005):** also requires the `review_revision` the approver saw and an empty warehouse ledger; takes the warehouse's advisory lock exclusively (every stock command holds it shared) before the stock keys; one `StockLot` + one movement per stated allocation; verifies every key's resulting quantity.

---

## 8. Modular monolith

```text
backend/app/
├── core/            config · async session · errors · correlation ids · logging · security
├── modules/
│   ├── identity/  tenancy/  authz/
│   ├── catalog/   terms · concepts · families · variants · sizes
│   │              raw_input · parsing · matching · aliases
│   ├── inventory/ inventory · movements · lots · opening balances · reconciliation
│   ├── snapshots/ legacy stock lists (M1-023, ADR-0005 — originally planned inside inventory)
│   ├── sales/  refunds/  transfers/  audit/  telegram/
├── api/v1/          thin routers
└── migrations/
frontend/src/
├── shared/telegram/   the only place tma.js is imported
├── features/          sale · search · receive · transfer · correct · review
└── entities/          typed client generated from the OpenAPI schema
infra/                 docker-compose.yml · Caddyfile · .env.example
```

Permitted dependency edges: `sales → inventory, catalog, authz, tenancy`; `refunds → sales, inventory`; `transfers → inventory`; `snapshots → inventory, catalog, authz, tenancy` (M1-023); `inventory → catalog` (read-only); `catalog` is a leaf. Enforced by an import-linter contract in CI (I19), recorded in ADR-0001.

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
| POST | `/snapshots` · `PUT /snapshots/{id}/lines/{n}` · `/snapshots/{id}/approve` · `/reject` | `snapshot:import` / `snapshot:approve` (built in M1-023; reads and rejection take either) |

Permission codes (in application code, not a table): `sale:create`, `sale:refund`, `sale:view`, `inventory:view`, `inventory:receive`, `inventory:adjust`, `inventory:correct_during_sale`, `transfer:create`, `transfer:receive`, `catalog:create`, `catalog:confirm`, `catalog:merge`, `snapshot:import`, `snapshot:approve`, `report:view_financial`, `user:manage`.

Stable error codes: `INSUFFICIENT_STOCK`, `CORRECTION_EXCEEDS_SHORTFALL`, `CATALOG_AMBIGUOUS`, `FORBIDDEN_STORE`, `PERMISSION_DENIED`, `LOCATION_ACCESS_DENIED`, `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`, `REFUND_EXCEEDS_SOLD`, `VALIDATION_ERROR`.

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
| M1-013 | Inventory + stock movement + stock lot, `CHECK (quantity >= 0)`, reconciliation query | `inventory-ledger-specialist`, `postgres-engineer` | M1-011 |
| M1-014 | Idempotency: fingerprint, claim/replay, conflict, namespacing (§4.5) | `concurrency-transactions` | M1-013 |
| M1-015 | `InventoryService`: atomic conditional movement application + structured `POST /inventory/receipts` | `concurrency-transactions`, `concurrency-test-engineer` | M1-013 |
| M1-016 | Sale service + `POST /sales` + Decimal money + immutable snapshots | `backend-fastapi-engineer`, `financial-integrity` | M1-014, M1-015 |
| M1-019 | `FOUND_DURING_SALE` correction path + `inventory:adjust` for manager/owner + audit (§4.6) | `human-error-resilience` | M1-016 |

### Gate M1C — Refund, Transfer, Catalog pipeline, Legacy import (8 tasks)

*Exit criterion: mistakes are recoverable, goods move between stores, natural-language intake works on a real corpus, and the legacy lists are imported as traceable opening balances.*

| ID | Task | Owner skill | Depends on |
|---|---|---|---|
| M1-017 | Refund service + endpoint | `compensating-operations`, `financial-integrity` | M1-016 |
| **M1-029** ✅ | Stock locations: `stock_location`, `store_location_access`, stock key moved to the warehouse, `sale_item.source_location_id`, `refund_item.destination_location_id`, migrations `0005` + `0006` | `inventory-ledger-specialist`, `multi-tenancy-architect`, `concurrency-transactions` | M1-017 — **done 2026-09-17** |
| **M1-018** ✅ | Transfer service + endpoints, `TRANSFER_OUT`/`TRANSFER_IN` — **between warehouses, not stores**; both legs in one `apply_movements` call; migration `0008`; invariant I24 in force | `inventory-ledger-specialist` | M1-029 — **done 2026-09-22** on `feat/m1-018-transfers`, awaiting the owner's review and merge ([report](m1-018-transfer-report.md)) |
| **M1-030** ✅ | «Фізично відсутній»: a bounded negative correction during a sale — `MISSING_AT_SALE`, `inventory:report_missing_during_sale`, migration `0007`, invariant I25 | `inventory-ledger-specialist`, `rbac-permission-designer` | M1-029; Q-E answered 2026-09-17 — **done 2026-09-17** |
| M1-020 | ✅ Local implementation verified 2026-09-24: normalization + deterministic parser v1; slash rule, per-field evidence and unclassified descriptors ([report](m1-020-parser-report.md)) | `catalog-normalization-parser` | M1-012 |
| M1-021 | Matcher v1: alias → `pg_trgm` → attribute compatibility → 5 decision types + margin policy + **duplicate-signature report** | `catalog-matcher`, `catalog-confidence-policy` | M1-020, M1-010 |
| M1-022 | Alias/feedback evidence, `NEW→LEARNING→VERIFIED` promotion, review-queue API | `catalog-feedback-learning` | M1-021 |
| **M1-023** ✅ | Snapshot import: raw rows, parse, review, approve → opening balances — module `snapshots`, allocations with a quantity basis, opening balance only into an empty warehouse ledger, migration `0015` ([ADR-0005](../decisions/ADR-0005-legacy-snapshot-import.md)) | `legacy-inventory-import` | M1-021, M1-013 — **merged in PR #32 (`3a66449`)**, implemented 2026-09-28 ([report](m1-023-snapshot-import-report.md)) |

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
| Revision 3 clarifications and confirmations applied | DONE (§16) |
| Telegram initData algorithm | VERIFIED against `core.telegram.org/bots/webapps`: `secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)`, then compare `hex(HMAC_SHA256(key=secret_key, msg=data_check_string))` |
| Python 3.14 toolchain viability | VERIFIED — fastapi, pydantic v2, sqlalchemy, alembic, asyncpg, pytest, httpx, ruff, mypy, structlog, import-linter all install |
| Gate M1A | see the M1A completion report for evidence |
| `NULLS NOT DISTINCT` behaviour on PostgreSQL 17 | `VERIFIED` 2026-09-15 on PostgreSQL **17.9**: all three migrations apply to an empty cluster, `pg_index` reports 4 indexes with `indnullsnotdistinct`, and the behaviour tests in `test_schema_behaviour.py` and `test_m1b_schema_behaviour.py` pass against it |
| M1-023 snapshot import on PostgreSQL 17 | `VERIFIED` 2026-09-28 in a disposable Docker container, `postgres:17-alpine` **17.11** with the CI/Compose locale (ICU `uk-UA`, `C.UTF-8`): 15 revisions base → head → base → head, `alembic check` clean; full suite and mutation results in the [report](m1-023-snapshot-import-report.md) |
| M1-018 transfers on PostgreSQL 17 | `VERIFIED` 2026-09-22 on a portable **17.11** cluster (ICU `uk-UA`, `--locale=C`): 8 revisions base → head → base → head with `alembic check` clean at both heads; full suite **475 passed, 0 skipped**; 22 of 22 deliberate defects caught; three independent reviews, no blocking finding — [report](m1-018-transfer-report.md) §6–7 |
| ICU locale choice in `infra/docker-compose.yml` | `VERIFIED` 2026-09-15 on the same cluster (`--locale-provider=icu --icu-locale=uk-UA`): `lower('ОЛЯ')` returns `оля`, which is what catalog matching depends on and what the C locale would not have done |

---

## 14. Open items

**Nothing blocks Milestone 1.** Q1, Q2 and U11 were answered at revision 3 (F33, F34, F35). Q4 (users and devices) and Q5 (transfer confirmation) refine defaults that are already implemented safely and can be answered during M1C/M1D.

Environment limits that constrain *verification*, not design — recorded honestly rather than worked around:

Updated 2026-09-15. Two of the three original limits are gone; the Docker one is not.

| Limit | Consequence |
|---|---|
| No Docker on the development machine | `docker compose` config is authored, parsed and cross-checked against `.env.example` by inspection, but **`docker compose up` has never been executed** — not locally, not in CI. The whole deployment path is reviewed design, not observed behaviour |
| PostgreSQL is not installed; a portable cluster is stood up per session | Database tests run locally against a **throwaway PostgreSQL 17.9** cluster on a non-standard port, created and destroyed inside the session. Real, but not a standing environment: the next session has to bring one up again, or the tests skip |
| Windows cannot use the `C.UTF-8` libc locale | The local cluster is initialised with `--locale-provider=icu --icu-locale=uk-UA --locale=C` instead of the compose file's `--locale=C.UTF-8`. ICU — the part catalog matching depends on — is identical; the libc fallback differs from production and is not exercised locally |
| Node.js 24 is installed | The frontend lockfile install, lint and build run locally and pass. Telegram and E2E behaviour remains gate M1D |

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

---

## 16. Revision 3 — clarifications and business confirmations

### Technical clarifications

| # | Clarification | Change made |
|---|---|---|
| 1 | Idempotency retention must not carry a business invariant | Split into two mechanisms (§4.5). `command_id` is permanent with `UNIQUE (organization_id, command_id)` on `sale`, `refund` and `transfer` — new invariant **I20**, `DB_ENFORCED`. `IdempotencyRecord` is demoted to a replay/response cache with a 7-day TTL. A replay after expiry still cannot create a second business operation |
| 2 | Evolving catalog knowledge must not change what `parser_version` means | Parsing and matching separated (§4.7). `ParseResult` is a pure function of `(raw_text, parser_version)` and performs no catalog or database reads; all learned knowledge enters at `CatalogMatchDecision`, which now records `matcher_version` **and** `knowledge_revision`. New invariant **I21**, enforced by a unique constraint plus an import-linter rule that forbids the parser from importing catalog matching or repositories |

### Business confirmations

| Question | Confirmed | Recorded as |
|---|---|---|
| Q1 money | Currency **UAH**. Store/variant may carry a current *suggested* selling price. `SaleItem` freezes `unit_price`, `discount_amount`, `final_unit_price`, `currency_code`, immutably. Acquisition cost lives on `StockLot`. Item-level discount **data** in M1, no discount engine. `NUMERIC` + `Decimal` only | **F33**, §4.8, new table `variant_price`, new invariant **I22** |
| Q2 inventory granularity | `store + product_variant + size` when size is known. `UNKNOWN_SIZE` is a legitimate domain size. Distribution is never invented. Reclassification is an audited two-movement operation, not a rewrite | **F34**, §4.9 |
| U11 parser corpus | The supplied legacy PDFs satisfy the real-data requirement. Originals stay private under a gitignored `data/legacy/raw/`; a sanitized versioned golden corpus lives in `backend/tests/fixtures/` | **F35**, enforced by `.gitignore` in M1-001 |

### Effect on the schedule

- Physical schema: 35 → **36 tables** (`variant_price` added).
- Invariants: 19 → **22**, of which 11 are now `DB_ENFORCED` (was 8).
- **No Milestone 1 task is blocked by an open question any more.**
- Gate **M1A started immediately** on this approval and does not wait for anything in M1B.

---

## 17. Gate M1A — completion report

**Tasks delivered:** M1-001 … M1-009 (9 of 28).
**Gate M1B is not open.** It starts only on the owner's explicit go-ahead.

### 17.1 Verification evidence

| Check | Command | Result |
|---|---|---|
| Lint | `ruff check .` | **All checks passed** |
| Format | `ruff format --check .` | **43 files already formatted** |
| Types | `mypy app scripts` (strict) | **no issues in 29 source files** |
| Architecture contracts | `lint-imports --config pyproject.toml` | **4 kept, 0 broken** |
| Tests | `pytest -q` | **95 passed, 15 skipped** (110 collected) |
| Migration renders | `alembic upgrade head --sql` | 6 tables + `alembic_version`, both `UNIQUE NULLS NOT DISTINCT` present |
| App boots | `uvicorn app.main:app` + curl | `/health` 200 with `X-Request-ID`; `/me` 401 `AUTHENTICATION_FAILED`; `/auth/telegram` 401 `INVALID_INIT_DATA` |

**`NOT VERIFIED` locally — no Docker, no PostgreSQL, no Node on this machine:**

| Item | Where it is proven |
|---|---|
| 15 database integration tests | CI (`postgres:17` service). They **skip loudly** locally, never pass silently |
| `alembic upgrade` / `downgrade` / `alembic check` drift | CI |
| `docker compose up`, Caddy, the `web` bundle | CI and the server |
| Frontend lint / typecheck / build | CI |
| Interpreter parity | local venv is CPython **3.14**; CI and the Dockerfile pin **3.12**. Local green is not evidence for the deployed interpreter |

### 17.2 Changed files

61 files in commit `8e510d6`, plus 26 files in the review-fix commit. Structure:

```text
.gitignore  .pre-commit-config.yaml  .github/workflows/ci.yml  README.md
backend/    pyproject.toml · alembic.ini · Dockerfile
            app/core/      config · db · orm · errors · logging · correlation
            app/modules/   tenancy · identity · authz
            app/api/       deps · v1/router          app/main.py
            migrations/    env.py · 0001_m1a_…
            scripts/       seed_organization.py
            tests/         unit (7 files) · integration (1 file)
frontend/   package.json · tsconfig · vite · eslint · Dockerfile · src/
infra/      docker-compose.yml · Caddyfile · .env.example
```

### 17.3 Migrations

| Revision | Creates | Notes |
|---|---|---|
| `0001_m1a` | `organization`, `store`, `app_user`, `role`, `role_permission`, `membership` | Single head. Two `UNIQUE NULLS NOT DISTINCT` constraints (ADR-0002). Composite foreign keys bind `membership.store_id` and `role_id` to `membership.organization_id`. Downgrade drops the `store_kind` enum, which `drop_table` leaves behind |

Amended in place after the review rather than superseded: it has never been applied to any database, so a corrective `0002` would have described a schema that never existed.

### 17.4 Independent review

Performed in a separate context by a reviewer that did not write the code, per `.ai/OPERATING_MANUAL.md` §6. Result: **no CRITICAL findings**, 3 HIGH, 10 MEDIUM, 13 LOW.

All 3 HIGH and all 10 MEDIUM are fixed. The three that mattered most:

- **Raw `initData` would have been sent to Sentry.** `send_default_pii=False` does not suppress request bodies in sentry-sdk 2.x; it only gates cookies. Since initData is a usable credential for up to an hour, anyone with Sentry read access could have replayed it. Fixed with `max_request_body_size="never"` plus a `before_send` scrubber, and the comment that claimed otherwise is gone.
- **The CI step guarding database coverage could never fail.** `grep -qv "skipped"` succeeds whenever *any* line lacks the word, which is always true of multi-line pytest output. A completely skipped integration suite would have gone green — and every `DB_ENFORCED` claim rests on that step. Replaced with an assertion of the positive (`N passed`) and the negative (no `N skipped`).
- **`AppUser.is_active` was dead.** Nothing read it, so disabling an account did nothing at all while its membership stayed active. Now checked at login and on every authenticated request.

Also fixed: a non-ASCII `hash` crashed the login endpoint with a 500 instead of a 401 (`hmac.compare_digest` raises on non-ASCII `str`); memberships could reference another organization's store or role; a two-organization user picked a tenant from an unordered query; first-login was a check-then-insert race; `timezone('utc', now())` stored a **naive** timestamp that drifts if the server is not UTC; the compose stack had no `web` service so the Mini App path 404'd; `--locale=C` broke `lower()` for Cyrillic, which would have silently degraded catalog matching and cannot be changed after `initdb`; the frontend CI job could not start because it referenced a lockfile that does not exist.

Three tests were rewritten because they could not fail: a tautological permission check, a role test whose name promised the opposite of its assertion, and config tests that read the developer's real environment.

### 17.5 Unresolved risks carried into M1B

| # | Risk | Status |
|---|---|---|
| R1 | **No dependency lockfile.** Rated "not reproducible" at first. That was an under-estimate: with no lockfile Dependabot **could not apply security updates at all**, and three vite advisories (one HIGH) sat open and unfixable. Discovered when the Dependabot job failed on `main` | **Frontend: closed.** `package-lock.json` committed, vite 5 → 8.3.0, `npm ci` + `npm audit --audit-level=high` in CI, `npm audit` reports 0 vulnerabilities. **Python: partly closed** — ruff, mypy and import-linter are pinned exactly, because their output gates CI and a version difference between the pre-commit hook and CI silently broke the build once (the hook formatted in an old style, CI rejected it). Runtime dependencies still resolve latest-compatible and need a constraints file |
| R1b | `@telegram-apps/*` packages are deprecated upstream in favour of `@tma.js/*` — which is also what `.ai/project.md` names as the approved stack | Swap during M1D, when the Telegram integration layer is actually written. No advisory, no rush |
| R1c | `eslint@9.39.5` reports "this version is no longer supported" | Bump with the M1D frontend work; `typescript-eslint` compatibility needs checking first |
| R2 | **No rate limiting on `POST /auth/telegram`** — unauthenticated, does an HMAC and a database write | Accepted at two-shop scale. Revisit before public exposure |
| R3 | **No session revocation** — a stolen token stays valid for up to 12 hours. Account and membership changes take effect immediately; the token itself cannot be killed | Accepted. Revisit if a device is ever lost |
| R4 | **No initData replay protection** — a captured payload can mint sessions for the remainder of its 1-hour window | Accepted; the window is configurable and could be shortened |
| R5 | `permissions_for(None)` returns only organization-wide permissions, so a store-scoped seller is denied by any organization-scoped check | Will bite immediately in M1B's `GET /sales` and `GET /inventory`. Decide the semantics there |
| R6 | Interpreter mismatch: local 3.14 vs CI/production 3.12 | Low. CI is authoritative |
| R7 | I19 (module boundaries) is enforced only for modules that exist | By design (ADR-0001 rule 5). Each new module must ship its contract |
| R8 | Q4 and Q5 still unanswered | Neither blocks M1B; defaults are implemented and least-privilege |

### 17.6 M1A exit criterion

> *"`docker compose up` gives a running API with migrations, Telegram auth and RBAC, and CI is green."*

**Met locally to the limit of this machine, and not beyond.** The API runs, migrations render, auth and RBAC work and are tested, and every local gate is green. `docker compose up` and CI cannot be executed here — no Docker, no Node. The first CI run after `git push` is what closes the gate honestly, and that push is the owner's to make.
