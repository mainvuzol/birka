# Stock locations — design, impact, migration and acceptance — 2026-09-17

Companion to [ADR-0004](../decisions/ADR-0004-stock-locations.md), which holds the decision and the four blocking questions. This document holds the working detail: what changes where, how the scenarios run, how existing data moves, and what would have to pass before any of it is called done.

Status: **implemented as M1-029**, in two migrations — `0005_stock_locations` (empty foundation tables) and `0006_stock_rekey` (the re-key, backfill and API change). Stock is keyed by warehouse; Q-A…Q-D are answered in ADR-0004 §6. Two items in §5.5 are **not** done and are named there. Transfers (M1-018) are deliberately *not* implemented: this document designs them, nothing writes them yet. See the [foundation report](m1-029-foundation-report.md) and the [completion report](m1-029-completion-report.md). Neither shipped migration may be expanded; further schema change takes a new revision.

Revision 2, after an independent architecture review; §8 lists what changed and why.

**[CONFIRMED]** = owner requirement of 2026-09-15. **[PROPOSED]** = this document's engineering choice.

## 1. Impact analysis

### 1.1 `inventory` — the re-key

| | today | proposed |
|---|---|---|
| unique key | `(store_id, product_variant_id, size_id)` | `(location_id, product_variant_id, size_id)` |
| `CHECK (quantity >= 0)` | present | unchanged |
| `organization_id` column | **none** — tenancy is derived through `store_id → store.organization_id` | still none; derived through `location_id → stock_location.organization_id` |
| rows for shared stock | one per selling store | **one** |

Everything that reads or writes stock goes through `inventory/repository.py`, the single writer (invariant I3, enforced by an import-linter contract). That is why this re-key is tractable: `ensure_and_lock`, `decrement`, `increment`, `current_quantity`, `validate_lot_references` and `RECONCILE_SQL` are six functions in one file, and no other module may reach past them.

The conditional `UPDATE … WHERE quantity >= :q` carrying invariants I1/I6 does not change shape at all. It starts contending on the right row.

**`lock_stock` needs explicit attention, and revision 1 missed it.** `inventory/service.py:123-125` calls `validate_active_stores(organization_id, {key[0] for key in ordered})`, where `key[0]` is the `store_id`. That single call is what proves, on every receipt, adjustment, sale and refund, that the store belongs to this organization and is active. Re-keying `key[0]` to `location_id` silently converts it into a location check and leaves **nothing validating the acting store**. Both are needed:

```text
validate_active_locations(organization_id, {location_ids})   ← new
validate_active_stores(organization_id, {acting_store_id})   ← retained
```

This matters more than it looks, because `inventory` has no `organization_id` of its own: its tenancy rests entirely on one foreign key plus this service call.

### 1.2 `stock_lot`

`store_id` → `location_id`. A lot is a receipt of goods *at a place*; `unit_cost` and `currency_code` stay frozen acquisition facts.

Two things travel with it: `ix_stock_lot_store_variant` must be re-keyed, and `validate_lot_references` (`repository.py:55`) compares `(lot.store_id, variant, size)` against the stock key — it must become the location tuple, or lot validation silently stops matching anything.

`acquisition_type` already distinguishes `PURCHASE`, `CONSIGNMENT` and `BORROWED`. **[CONFIRMED]** ownership is a separate undefined dimension, and this column is where its evidence already sits, per batch. Noted so the future ownership design starts from the lot rather than inventing a location-level owner.

### 1.3 `stock_movement` — the ledger

`store_id` → `location_id`, plus `acting_store_id` with `CHECK (movement_type IN ('TRANSFER_IN','TRANSFER_OUT') OR acting_store_id IS NOT NULL)` — today's `NOT NULL` guarantee preserved wherever a store really is responsible, relaxed only for a warehouse-to-warehouse transfer. Both columns bound compositely through `organization_id` (ADR-0004 §2.2); the current store foreign key is single-column, and this re-key is the cheap moment to fix that.

`ix_stock_movement_key` is re-keyed to `(location_id, product_variant_id, size_id, created_at)`. The append-only trigger, `quantity_delta <> 0` and `movement_type <> 'ADJUSTMENT' OR reason_code IS NOT NULL` are unchanged.

**`RECONCILE_SQL` needs a decision revision 1 skipped.** It groups by the stock key and today has **no organization predicate at all** — called with `store_id=None` it scans every tenant. Fifteen call sites pass a store. Under locations: it groups by location, gains an `organization_id` parameter, and the caller-facing question changes shape. "Is store C consistent?" stops being answerable once C's stock lives partly in a shared location; "is location W-C consistent?" replaces it. Invariant I3 keeps exactly its current meaning at the new key.

### 1.4 `sale` and `sale_item`

- `sale.store_id` — **unchanged**. **[CONFIRMED]** the sale belongs to the store that made it.
- `sale_item.source_location_id` — **new, `NOT NULL`** **[PROPOSED]**.

A frozen historical fact beside the frozen price, and what makes refunds honest. Per line, because one basket can legitimately draw from two warehouses.

Two caveats worth stating rather than discovering:

- It is a live foreign key, not a snapshot, unlike every other display fact on `sale_item` (`display_name_snapshot`, `variant_snapshot`). The id is stable, so a past receipt's *identity* is safe — but a receipt rendering "came from: «Основний склад»" would show today's name. Either the location is never shown on a receipt, or its label is snapshotted too. **[PROPOSED]** never shown; a location is an internal fact, not something a customer's receipt needs.
- "Immutable" has no database teeth here: `sale_item` is not in `APPEND_ONLY_TABLES`. Same status as the price snapshot beside it — service-enforced and tested, not trigger-enforced.

The sale command's authorization gains a second check: `sale:create` in the store **and** `can_sell` at the location (invariant I23). Both server-side, both read from the database, neither trusting the request.

**The permanent command fingerprint must include the location.** Two fingerprints exist and behave differently. The router's 7-day idempotency fingerprint is built from `payload.model_dump()` (`api/v1/sales.py:128-134`), so a new per-line field lands in it automatically. The **permanent** `command_fingerprint` persisted on `Sale` (ADR-0003) is hand-built field by field (`sales/service.py:235-255`) and would **not** pick it up. Left alone, the same `command_id` retried with a different `source_location_id` is judged an identical retry, the original sale is replayed, and the caller is told success for a warehouse it never named — Q-A's failure arriving through the replay path. `source_location_id` joins that dict; `destination_location_id` joins the refund's (`refunds/service.py:186-201`).

**`FOUND_DURING_SALE` at a shared location is question Q-D**, not a detail. The correction writes its `ADJUSTMENT` at the same location as the line it corrects — which at a shared warehouse means a seller in one store minting stock into the balance the other store depends on. See ADR-0004 §6.

### 1.5 `refund` and `refund_item`

- `refund.store_id` — **unchanged**, still derived from the sale, never client-supplied. This describes current behaviour; **[CONFIRMED]** who may accept a return from the other store, and which store handles the money, remain open owner questions (ADR-0004 §7).
- `refund_item.destination_location_id` — **new, nullable**, with `CHECK ((restock = true) = (destination_location_id IS NOT NULL))` **[PROPOSED]**.

Nullable deliberately: a non-restocked line writes no movement, so asserting a shelf for it would invent history — and the backfill would stamp one onto every historical binned line. The `CHECK` is stronger than `NOT NULL`: it makes condition and destination agree in both directions.

**The existing closed-store rule is retained unchanged.** `refunds/service.py:439-456` refuses to restock into an inactive *store*; a location-receive check is added **alongside** it. Revision 1 proposed replacing one with the other, which would have defined store-state semantics by deletion — directly against the owner's instruction not to equate those states with "may refund money but cannot receive goods". Both questions are real, separate, and the store-states one is out of scope here.

### 1.6 Permissions and access

No new permission codes **[PROPOSED]** — the existing sixteen stay as they are, and location access is a separate data check:

```text
sale:create               + can_sell     at the source location
inventory:receive         + can_receive  at the destination location
inventory:adjust          + can_receive  at the location      (an adjustment may go either way)
transfer:create           + can_sell at source AND can_receive at destination
sale:refund               + can_receive  at the destination location (restocking lines only)
inventory:view            + any access row at the location
inventory:correct_during_sale  ← Q-D: does can_sell imply the right to CREATE stock here?
```

Two orthogonal axes: a permission says what a *person* may do; an access row says where a *store* may do it. **[CONFIRMED]** neither is inferred from a name.

Open and not decided here: whether `transfer:create` should require the initiating store to hold access at both ends, or whether an organization-wide manager may move goods between warehouses neither of their stores reaches. That is a roles question (owner decision §2), not a location question.

### 1.7 Audit

Unchanged in mechanism; every entry still written inside the transaction of the change it describes.

**[PROPOSED]** stock audit entries should carry the location in `before`/`after`: "quantity was 3, is now 2" is no longer a complete statement when the same variant exists in two warehouses. A content change, not a schema change — `AuditLog.before`/`after` are already JSONB.

### 1.8 Import and snapshots

`inventory_snapshot.store_id` → `location_id`, still nullable. A legacy availability list describes **a place that was counted**, which is a location — arguably more truthfully than it described a store. M1-023 then produces `OPENING_BALANCE` movements at a location; invariant I17 is unaffected.

**[CONFIRMED]** raw source records are untouched: `raw_input.store_id` stays, because it records where the *text* was captured, not where goods sit.

### 1.9 Untouched: `variant_price`

Keeps `store_id`. A suggested price is a store's offer to its customers, not a property of a shelf, and two stores selling the same shared coat may legitimately price it differently.

Stronger than it first appears: `VariantPrice.store_id` is nullable with `NULLS NOT DISTINCT`, so an organization-wide default already exists as the fallback when a store sells shared stock it has never priced itself. Stated explicitly so nobody later "fixes" this by moving the column to the location.

### 1.10 `GET /inventory` — the read contract

Revision 1 omitted this, and the obvious implementation re-creates at the read layer exactly the duplication the owner forbade: if the endpoint sums across a store's reachable locations, the shared pile appears in full under **both** stores. The write model would be correct and every report wrong, which is the harder bug to find.

**[PROPOSED]** the contract:

- rows are keyed `(location, variant, size)` and always name the location;
- no per-store total is ever returned that includes stock at a shared location;
- a store sees a location because it holds an access row there — reachable, which is not the same as owned;
- the same shared row appearing in two stores' responses is the *same row*, reported once per location, not twice as a store total.

This also requires the query to move out of the router (`api/v1/inventory.py:91-102` selects the ORM directly) and behind `inventory.service`. Without that move, invariant I23's read half has nowhere to be enforced.

### 1.11 Location lifecycle

**[PROPOSED]**, because revision 1 left it undefined:

- every new location foreign key is `ON DELETE RESTRICT`, matching the store foreign keys it replaces — a location holding stock cannot vanish;
- `is_active = false` refuses sell and receive, and is checked independently of the access rows;
- an inactive location remains **readable, reconcilable and transferable-out**, so stock is never stranded somewhere it cannot be counted or moved.

## 2. The minimal model

```text
stock_location                          store_location_access
  id                                      organization_id  ─┐
  organization_id                         store_id         ─┼─ two composite FKs
  code            unique per organization  location_id      ─┘
  name                                     can_sell     NOT NULL, no default
  is_active                                can_receive  NOT NULL, no default
  UNIQUE (organization_id, id)  ← composite-FK target
  (no owner, no kind — ADR-0004 §2.1)      UNIQUE (store_id, location_id)
```

```text
inventory          (location_id, variant_id, size_id) UNIQUE   ← one balance
stock_lot           location_id
stock_movement      location_id + acting_store_id
                    CHECK (movement_type IN ('TRANSFER_IN','TRANSFER_OUT')
                           OR acting_store_id IS NOT NULL)
inventory_snapshot  location_id (nullable)
sale_item           source_location_id       NOT NULL
refund_item         destination_location_id  nullable
                    CHECK ((restock = true) = (destination_location_id IS NOT NULL))
transfer            from_location_id, to_location_id, initiating_store_id
                    CHECK (from <> to)
sale, refund        store_id   unchanged — attribution
variant_price       store_id   unchanged — a store's offer
```

Two new tables, eight changed columns, no new permission codes, no new services, no new module. The smallest shape that can express "both stores sell from one pile" without also asserting who owns it.

## 3. Scenarios

**P** = primary store, **C** = child store, **W-P** = primary warehouse, **W-C** = child warehouse. Access rows: P→W-P (sell, receive); C→W-P (sell); C→W-C (sell, receive).

### 3.1 Both stores sell from the primary warehouse **[CONFIRMED]**

C's seller sells one coat held in W-P.

```text
permission  sale:create in C                  ✓
access      C can_sell at W-P                 ✓
UPDATE inventory SET quantity = quantity - 1
  WHERE location_id = W-P AND variant … AND quantity >= 1
stock_movement  SALE  −1  location=W-P  acting_store=C  reference=sale
sale            store_id = C        ← revenue credited to C
sale_item       source_location_id = W-P
```

One balance, decremented once. **No `TRANSFER_OUT`/`TRANSFER_IN`** — drawing shared stock is not a transfer **[CONFIRMED]**. P selling the same coat is identical but for `acting_store` and `sale.store_id`.

### 3.2 The child store sells from its own warehouse **[CONFIRMED]**

Identical with `location = W-C`. Only the access row differs. W-C's balance is untouched by anything P does.

### 3.3 A return

C refunds one unit of §3.1's sale.

```text
refund.store_id = sale.store_id = C                       (unchanged rule)
destination     = sale_item.source_location_id = W-P      ← Q-B
store active?   existing store_is_active check, retained  ✓
access          C can_receive at W-P?  — sell-only above: REFUSED
```

The refusal is the point: under §3.1's rows, C may take goods *out* of the shared warehouse and not put them *back*. Whether that is right is **Q-B**, and the answer is a row, not a code change. The money side is unchanged: the refund still pays from the frozen `SaleItem` price and I9's cap still counts every prior return of that line.

### 3.4 A transfer between warehouses **[CONFIRMED]**

```text
BEGIN
  permission  transfer:create on transfer.initiating_store_id
  access      can_sell at W-P, can_receive at W-C
  ONE apply_movements call carrying BOTH legs
    → both keys locked in a single globally sorted batch
  TRANSFER_OUT −q at W-P   TRANSFER_IN +q at W-C
  audit
COMMIT
```

The single call matters: two sequential `apply_movements` calls would lock the destination after the source, out of global order, and two opposing transfers would deadlock. This hazard does not exist today only because no transfer service exists.

Two movements, one transaction, one audit entry, no `sale` row and no revenue effect (invariants I16/I24).

### 3.5 Two sellers, one last coat, shared warehouse

| | today | after the future re-key migration | after the shared-access step |
|---|---|---|---|
| rows for the shared pile | two (one per store) | **still two** — nothing merged | **one** |
| both `UPDATE`s match | yes | yes | no — PostgreSQL serialises them |
| outcome | both succeed, one coat sold twice | unchanged | one succeeds, one gets `INSUFFICIENT_STOCK` |

The middle column is the correction revision 1 got wrong. The migration makes the fix *expressible*; step 12 delivers it. No new mechanism is needed — the conditional update and the `CHECK (quantity >= 0)` backstop already exist and simply start applying once the two sellers finally contend on one row. The loser may then use the ordinary `FOUND_DURING_SALE` path if the coat is physically present — which is **Q-D**.

A test of the pre-migration failure must seed both store rows with the same coat, i.e. assume the duplication Q-C says is unknown. That makes it a test of the mechanism, not evidence about the shops' real data, and it should be described that way.

## 4. Future migration plan — re-key after the empty-table foundation

**[CONFIRMED]** Do not merge existing balances. Do not make any warehouse shared. Preserve every quantity, ledger row and link.

### 4.1 Principle

A **relabelling, not a reorganisation**: one location per existing store, one access row for that same store, every quantity moved across untouched. Afterwards the system behaves exactly as it does now.

### 4.2 Steps

1. Require the existing empty foundation tables from `0005_stock_locations`; validate their state before backfill. Do not recreate them. A populated table must be explicitly reconciled or cause preflight refusal, never be overwritten or guessed.
2. One `stock_location` per `store`, `code` and `name` derived deterministically from the store's own.
3. One `store_location_access(organization, store, its own location, can_sell=true, can_receive=true)` — **exactly today's reach, not one location wider**. This table *is* the store↔location mapping; no temporary table is created, and `downgrade()` reads it back (§4.4).
4. Add nullable `location_id` to `inventory`, `stock_lot`, `stock_movement`, `inventory_snapshot`; nullable `acting_store_id` to `stock_movement`; nullable `sale_item.source_location_id` and `refund_item.destination_location_id`.
5. **Suspend the ledger's append-only trigger, backfill, restore it** — all inside the one transaction:
   ```sql
   ALTER TABLE stock_movement DISABLE TRIGGER stock_movement_is_append_only;
   -- backfill location_id and acting_store_id from the old store_id
   ALTER TABLE stock_movement ENABLE  TRIGGER stock_movement_is_append_only;
   ```
   Without this the migration simply **aborts**: `birka_reject_mutation()` refuses every `UPDATE` on `stock_movement` (migration `0002`, invariants I10/I11). `ADD COLUMN` and `DROP COLUMN` are DDL and pass; the row backfill does not. This is the only moment in the system's life when the ledger is mutable, and it is worth seeing in review rather than discovering in production.
6. Backfill the rest through the access-row mapping: stock tables from their own `store_id`; `sale_item` from its `sale.store_id`; `refund_item` from its `refund.store_id`, **only where `restock = true`**.
7. **Assert** (§4.3). Any failure aborts inside the transaction, so nothing is half-applied.
8. Set `NOT NULL` where §2 says so; add the two `CHECK` constraints; swap `uq_inventory_store_variant_size` for the location-keyed unique index; re-key `ix_stock_movement_key` and `ix_stock_lot_store_variant`; drop `store_id` from the four stock tables.
9. Alter `transfer` to `from_location_id`/`to_location_id` + `initiating_store_id` — the table is empty and nothing has ever written it.

Steps 1–7 are additive and reversible on their own. Step 8 is destructive, and the assertions are what guard it.

### 4.3 Assertions the migration carries

Statements inside the migration that abort it — not test-suite checks. Honesty about which can actually fail matters as much as the list:

| # | Assertion | Can it fail? |
|---|---|---|
| 1 | one location per store, one store per location | **yes** — the guard that nothing merged |
| 2 | `stock_movement_is_append_only` exists and is enabled (`pg_trigger.tgenabled = 'O'`) | **yes** — step 5 forgot to restore it |
| 3 | zero rows with `location_id IS NULL` before step 8 | **yes** — an incomplete backfill |
| 4 | reconciliation produces the **same divergence set** at the new key as at the old | **yes** — the most valuable one |
| 5 | `refund_item`: destination present exactly where `restock = true` | **yes** — a backfill that stamped binned lines |
| 6 | `COUNT(*)` unchanged per table | no — belt and braces |
| 7 | `SUM(inventory.quantity)` unchanged, overall and per `(variant, size)` | no — belt and braces |

Assertions 6 and 7 are kept but **labelled non-falsifiable**: the migration issues no `INSERT`, `DELETE` or `quantity` write on those tables, and holds `ACCESS EXCLUSIVE` from step 4 onward so no concurrent writer can change them either. They can only fail if the migration is rewritten. Revision 1 listed a third of this kind — "every `sale_item` resolves to a location in its own organization" — which is true by construction of the step-6 backfill; it is replaced by the composite foreign keys of §2, which *prevent* the leak rather than observing its absence once.

**Assertion 4 is the one that earns its place.** The correct check is that the divergence set is *identical*, not *empty* — a pre-existing divergence must survive visibly rather than be tidied away. It is only computable between steps 6 and 8, while both keys exist, and the comparison must map old keys through the access rows. It is load-bearing against one specific mistake: backfilling `stock_movement.location_id` from a different source than `inventory.location_id`.

### 4.4 Rollback

`downgrade()` restores `store_id` from `location_id` through `store_location_access` — the sole access row per location — restores the old unique index and retains the two foundation tables created by 0005. Their rows require a provenance-aware rollback plan before this future migration is implemented; the 0005 downgrade intentionally refuses populated tables. It must suspend and restore the append-only trigger exactly as the upgrade does.

**Lossless only while the mapping is one-to-one.** Once a second store holds `can_sell` on a shared location, or the first transfer moves stock across locations, a downgrade cannot say which store a shared row belongs to. Release notes must state this; the shared-access step closes the window. Until then, rolling back application code while keeping the schema is the preferred recovery, as ADR-0003 prefers.

### 4.5 Operational window

From step 4 the migration holds `ACCESS EXCLUSIVE` on `inventory`, `stock_movement`, `stock_lot` and `inventory_snapshot` until commit. That is what makes the unique-index swap safe from concurrent writes, and it means every in-flight sale blocks or times out for the duration, on the largest table in the system. **A maintenance window, not a trading-hours deploy.** Measure the duration against a restored copy of real data before scheduling it.

### 4.6 What the migration deliberately does not do

- It does not make W-P shared. That is a separate owner-approved data operation.
- It does not merge the two stores' balances. **[CONFIRMED]** whether they are the same goods twice or two piles is unknown and unknowable from the database.
- It does not create a warehouse with no store. Every location it creates has exactly one store, because that is what the current data says.

## 5. Checks and acceptance criteria

### 5.1 Migration

- [ ] Applies to an empty database and to one carrying real sales, refunds and movements.
- [ ] Assertions 1–5 each proven load-bearing. For 1 and 3 that means corrupting the data they guard; for 2, 4 and 5 it means corrupting **the migration's own SQL** — skipping the trigger restore, backfilling the ledger from the acting store instead of the location, dropping the `restock` predicate — because no input data can trip them.
- [ ] Assertions 6 and 7 documented as non-falsifiable, kept anyway.
- [ ] `upgrade → downgrade → upgrade` round-trips with data present, mapping intact, trigger enabled at every stage.
- [ ] The append-only trigger is enabled before and after; an `UPDATE` on `stock_movement` is refused outside the migration.
- [ ] `alembic check` reports no drift; migrations `0001`–`0004` untouched.
- [ ] Duration measured against a restored copy of real data.

### 5.2 Invariants

- [ ] **I1** — `CHECK (quantity >= 0)` holds at the new key.
- [ ] **I2** — a duplicate `(location, variant, size)` is refused by the database.
- [ ] **I3** — reconciliation clean after every §3 scenario; the divergence-detection test still detects an injected divergence; the new `organization_id` filter scopes it.
- [ ] **I6 / §3.5** — two concurrent sales from two different stores against the last unit of one shared location: exactly one succeeds. Fixture seeds the shared row deliberately; the test proves the mechanism, and its write-up must not claim more.
- [ ] **I8** — `sale_item.source_location_id` never changes; renaming a location does not alter a past receipt.
- [ ] **I12** — the composite foreign keys refuse a `store_location_access` row binding a store to another organization's location, at the database.
- [ ] **I16 / I24** — a `TRANSFER_OUT` has exactly one matching `TRANSFER_IN` at another location in the same transaction; a multi-location sale basket is *not* flagged as a transfer.
- [ ] **I23** — a store without an access row is refused before any row is read or written, and leaves no idempotency claim; enforced for reads too, which requires `GET /inventory` behind the service.

### 5.3 Authorization, tenancy and idempotency

- [ ] Permission and access are independently necessary; holding one without the other is refused, both directions.
- [ ] A location in another organization is a 404 disclosing nothing.
- [ ] Revoking `can_sell` stops future sales and is honoured on a cached idempotency replay (invariant I13).
- [ ] The same `command_id` retried with a changed `source_location_id` returns `IDEMPOTENCY_CONFLICT`, **not** a replay. Same for `destination_location_id` on a refund.
- [ ] `validate_active_locations` and `validate_active_stores` are both required: a negative test for each.
- [ ] `GET /inventory` never returns a per-store total containing shared stock; the same shared row in two stores' responses is the same row.

### 5.4 Concurrency

- [ ] Two stores selling the last shared unit — deterministic, by holding one transaction open, not `asyncio.gather` alone.
- [ ] Two **opposing** concurrent transfers (W-P→W-C and W-C→W-P): no deadlock. This is the hazard the single `apply_movements` call exists to prevent.
- [ ] A sale at W-P concurrent with a transfer out of W-P: no deadlock, ledger balances.
- [ ] A refund restocking into W-P concurrent with a sale drawing from it: no deadlock, ledger balances.
- [ ] Lock order stays globally sorted with `location_id` leading, and `lock_stock`'s UUID-tuple sort still agrees with `MovementRequest.sort_key`'s stringified sort.

### 5.5 Regression

- [x] All existing tests pass, adjusted only where they name a store as a stock key — never weakened. **394 pass**, 0 skipped, on isolated PostgreSQL 16.2.
- [x] `ruff`, `ruff format`, `mypy`, `lint-imports`, `alembic check` clean.
- [ ] **Not done.** Full suite on real PostgreSQL 17 under Compose, as the 2026-09-16 verification established. That report covers the *previous* baseline, not this change set.
- [ ] **Not done.** `POST /sales` p95 re-measured against the ≤ 500 ms budget with the added access join.

### 5.6 Documentation

- [ ] ADR-0004 → Accepted, with Q-A…Q-D answered inline.
- [ ] Plan invariant table gains I23/I24 and restates I2; the stock-key invariants are activated only with the service switch; foundation already moved the table count 36 → 38.
- [ ] Release notes carry the rollback window (§4.4) and the maintenance window (§4.5).

## 6. Implementation plan

| # | Step | Blocked on | Notes |
|---|---|---|---|
| 1 | Accept remaining ADR-0004 behavior; update stock invariants | Q-A…Q-D at their dependent steps | empty-table engineering foundation already implemented; full ADR remains Proposed |
| 2 | Foundation tables/models (`0005`) implemented; future migration performs §4 steps 2–7 | 1 for future backfill | 0005 creates empty tables only; no runtime service reads them yet |
| 3 | Migration assertions + their corruption tests | 2 | proves §4.3 before anything depends on it |
| 4 | `inventory` repository + service re-keyed; `validate_active_locations`; reconciliation scope | 3 | the single-writer boundary |
| 5 | `GET /inventory` moved behind the service; read contract of §1.10 | 4 | prerequisite for I23's read half |
| 6 | Receipts and adjustments take a location | 5 | smallest endpoints first |
| 7 | Sale command: `source_location_id`, access check, fingerprint, §3.5 test | **Q-A, Q-D** | 6 |
| 8 | Refund command: `destination_location_id` + `CHECK`, access check, fingerprint | **Q-B** | 7 |
| 9 | Migration steps 8–9 (destructive) + full regression on PostgreSQL 17 | 8 | maintenance window |
| 10 | Independent review: concurrency/database + security | 9 | per `.ai/OPERATING_MANUAL.md` §6 |
| 11 | **M1-018** — transfers between locations, both legs in one `apply_movements` | 10 | small, once the model is right |
| 12 | Shared-access data step: grant C `can_sell` at W-P, plus whatever Q-C's answer requires | **Q-C** | 11 — owner-approved data, not a migration |

Steps 4–9 are one indivisible change to the stock key: splitting them across releases would leave a database whose unique key disagrees with its service layer.

**Q-A and Q-D bind at step 7, Q-B at step 8, Q-C at step 12.** Steps 1–6 are fully determined by ADR-0004 §2 regardless of the answers, so the model can be built and proven while the owner decides. Revision 1 blocked all twelve steps on the answers, which would have asked the owner to settle seller workflow before seeing the model work.

## 7. Interaction points with out-of-scope work

Named explicitly, per the instruction not to expand into them:

- **Store states** (blocked / ceased trading). The refund's existing `store_is_active` check is retained; a location check is added alongside. Interaction point: `store_location_access` plus `stock_location.is_active`. Not designed here.
- **Damaged versus intact returns.** A damaged unit's destination becomes a location question the moment quarantine exists; `refund_item.destination_location_id` is the field it will use. Not designed here.
- **Ownership.** `StockLot.acquisition_type` already holds the evidence; deliberately no owner column on `stock_location`. Not designed here.
- **Cross-store returns and which store handles the money.** Owner-listed as open. Today the code permits no cross-store return at all, so nothing is broken; §1.5 describes current behaviour rather than settling it.
- **Negotiated prices, installments, purchase obligations.** No interaction with locations — a price is a store's offer, settlement is a customer relationship. Recorded to show the absence of interaction was checked.

## 8. What revision 2 changed, and why

An independent architecture review on 2026-09-17 read both artifacts against the governing documents and the real code, and tested schema assumptions on a disposable database. It found four blocking and thirteen major defects. All are fixed above.

| Severity | Finding | Fix |
|---|---|---|
| **BLOCKING** | The migration **cannot run**: `stock_movement` is append-only and step 5 was an `UPDATE`. Reproduced — `birka_reject_mutation()` refuses it | §4.2 step 5 suspends and restores the trigger inside the transaction; assertion 2 proves it was restored |
| **BLOCKING** | `store_location_access` could not carry the composite foreign key it claimed — no `organization_id` column, and `stock_location` had no `UNIQUE (organization_id, id)` target. Reproduced: fails at DDL time. The table is the *only* guard against a cross-tenant location | `organization_id` added, two composite FKs, matching unique target; I12 keeps database teeth |
| **BLOCKING** | I24 contradicted §2.4: a two-line basket drawing from two warehouses writes two locations in one command, legitimately. Its test was circular | I24 restated as paired `TRANSFER_OUT`/`TRANSFER_IN` of equal magnitude; multi-location baskets explicitly allowed |
| **BLOCKING** | §1.5 replaced the refund's closed-store check with a location check — defining store-state semantics by deletion, against an explicit owner instruction | The existing check is retained unchanged; a location check is added alongside; the question moves to out-of-scope |
| MAJOR | The headline oversell claim was asserted as fact while §6 listed it as unknown, and the migration does not deliver the fix anyway | §1.3 rewritten as marked `[PROPOSED]` reasoning with both workarounds; §3.5 gains the "after migration: unchanged" column |
| MAJOR | The re-key silently deletes `lock_stock`'s `validate_active_stores` — the only tenant-and-active check on every stock write | §1.1: `validate_active_locations` **plus** retained `validate_active_stores` |
| MAJOR | The permanent `command_fingerprint` is hand-built and would not include the location, so a retry could replay a sale from a different warehouse | §1.4: the location joins both fingerprints; §5.3 tests it |
| MAJOR | I23 covered "read", but no flag grants reads and `GET /inventory` bypasses the service entirely | §2.2 any access row grants read; new step 5 moves the query behind the service |
| MAJOR | `GET /inventory` undefined; the obvious implementation re-creates the duplicated balance at the read layer | new §1.10 |
| MAJOR | `refund_item.destination_location_id NOT NULL` fabricates a shelf for binned goods and would stamp one on historical rows | nullable + `CHECK ((restock = true) = (… IS NOT NULL))` |
| MAJOR | `transfer` lost both store columns, leaving `scope.require(TRANSFER_CREATE, …)` with no subject | `initiating_store_id` retained |
| MAJOR | Module placement never stated | `tenancy`, with the reasoning (ADR-0004 §2.6) |
| MAJOR | The mapping was a temporary table that `downgrade()` could not read | mapping *is* `store_location_access`; temporary-table language removed |
| MAJOR | `FOUND_DURING_SALE` at a shared location lets a seller in one store mint stock into the other's supply — unexamined | promoted to blocking question **Q-D** |
| MAJOR | Three of seven assertions could not fail, while §5.1 demanded each be proven load-bearing | assertions re-ranked and labelled; the tautological one replaced by the composite FK; §5.1 reworded |
| MAJOR | Location deactivation and deletion undefined | new §1.11 |
| MAJOR | A transfer implemented as two `apply_movements` calls would deadlock against an opposing transfer | §3.4 requires one call; §5.4 tests opposing transfers |
| MINOR | `sale_item.source_location_id` is a live FK where every other receipt fact is snapshotted; "immutable" has no database teeth | stated in §1.4, with the decision that a location is never shown on a receipt |
| MINOR | `acting_store_id` nullable with no `CHECK` silently weakens today's `NOT NULL` attribution | `CHECK` added |
| MINOR | `ix_stock_lot_store_variant` and `validate_lot_references` unmentioned | §1.2 |
| MINOR | `RECONCILE_SQL` has no organization predicate at all and scans every tenant | §1.3 |
| MINOR | Step 0 blocked all twelve steps on questions binding at 7, 8 and 12 | §6 binds each question to its step |
| MINOR | No lock-window or downtime statement | §4.5 |
| MINOR | Plan says "36 tables"; two new ones make 38 | §5.6 |
| MINOR | `variant_price`'s organization-wide fallback strengthens §1.9's reasoning | §1.9 |

Confirmed sound by the same review, against the code: the `sale_item` and `refund_item` backfills via `sale.store_id`/`refund.store_id` are lossless, because the sale's stock key *is* the store; `transfer` really is empty; the global lock order survives the re-key, because `lock_stock`'s UUID sort and `MovementRequest.sort_key`'s text sort agree (verified over 20 000 random pairs); there is no lock-order inversion between the refund's sale-line lock and the new location locks; rejecting an owner column and a `kind` enum is right; keeping `variant_price` and `raw_input` store-scoped is right; I2's restatement stays genuinely `DB_ENFORCED`; and neither plausible module placement creates a forbidden ADR-0001 edge.
