# ADR-0004 — Stock locations, and separating where goods are from who sells them

Status: **Accepted for the stock re-key (M1-029), implemented 2026-09-17. Store states, returned-unit condition, ownership and payments remain out of scope (§7).**

The owner answered Q-A, Q-B, Q-C and Q-D on 2026-09-17; the answers are recorded in §6 and are implemented. A fifth question, Q-E, arrived with them and concerns "physically absent" — a new requirement that is **recorded and not built**; see [`physically-absent-proposal.md`](../project-memory/physically-absent-proposal.md).

Delivered in two migrations, deliberately separate. `0005_stock_locations` created the two tables empty, granting nothing and changing no existing row. `0006_stock_rekey` moved the stock key from the selling store to the warehouse, creating one location per existing store and merging nothing. See the [foundation report](../project-memory/m1-029-foundation-report.md) and the [M1-029 completion report](../project-memory/m1-029-completion-report.md).

Revision 2, after an independent architecture review (2026-09-17) that found four blocking and thirteen major defects in revision 1. The corrections are listed in [`m1-018-stock-location-design.md`](../project-memory/m1-018-stock-location-design.md) §8.

Throughout, **[CONFIRMED]** marks a requirement the owner stated on 2026-09-15 ([`owner-decisions-2026-09-15.md`](../project-memory/owner-decisions-2026-09-15.md)); **[PROPOSED]** marks this document's own engineering choice, which the owner has not seen.

## 1. Context

### 1.1 What the owner confirmed

- **[CONFIRMED]** One primary warehouse — the primary store's — and **both stores sell from it**.
- **[CONFIRMED]** The child store additionally has **its own separate warehouse**.
- **[CONFIRMED]** A sale is credited to **the store that made it**.
- **[CONFIRMED]** Shared stock has **one authoritative balance**, never one copy per selling store.
- **[CONFIRMED]** Selling store, physical location and **ownership are three different things**. A warehouse's name must not, on its own, imply who owns its contents or who may reach it.
- **[CONFIRMED]** Physical movement between places is **explicit and auditable**. Drawing shared stock for a sale is **not** a transfer.

### 1.2 What the code assumes today

`inventory` is keyed `UNIQUE (store_id, product_variant_id, size_id)`, and `stock_lot`, `stock_movement` and `inventory_snapshot` key on `store_id` in the same sense. That one column carries three meanings at once: where the goods are, which store may sell them, and by implication whose they are.

Eight tables carry a `store_id`, and they divide cleanly. The division is the heart of this ADR:

| Table | What `store_id` means today | Under this ADR |
|---|---|---|
| `inventory` | where the goods are | → `location_id` |
| `stock_lot` | where the goods arrived | → `location_id` |
| `stock_movement` | where the change happened | → `location_id` + `acting_store_id` |
| `inventory_snapshot` | where the list was counted | → `location_id` |
| `sale` | **who sold it** | unchanged |
| `refund` | **who took it back** | unchanged |
| `variant_price` | **whose price it is** | unchanged |
| `raw_input` | where the text was captured | unchanged |

### 1.3 Why this has to be settled before M1-018

**[PROPOSED] — this is reasoning, not a confirmed fact, and revision 1 wrongly asserted it as one.**

Today the model has no way to *express* a warehouse that serves two stores. Staff who need one have exactly two workarounds, and both damage the balance:

1. **Record the pile under both stores.** Two `inventory` rows for one pile of coats. `decrement` filters on `store_id` (`inventory/repository.py:109-120`), so the conditional `UPDATE … WHERE quantity >= :q` that invariants I1/I6 rely on never contends between them. Two sellers can each sell the last coat.
2. **Record it under the primary store only.** The child's sellers then cannot reach it — and the likely response is the `FOUND_DURING_SALE` path (business fact F30), minting the shortfall into the child's own row on every sale. The shared pile inflates across two rows, invisibly, one sale at a time.

Which of these the two shops are actually doing is **not known from the database** — that is question **Q-C**, and it is answerable only by counting shelves. What is certain is that the model offers no correct third option, and that both workarounds corrupt the quantity silently rather than loudly.

Building transfers (M1-018) first would also build the wrong operation: this business moves goods between *warehouses*, one of which serves both stores — not between *stores*.

**What this ADR does and does not fix.** Re-keying `inventory` to the location is what lets the shared pile become one row that two sellers contend on. But the migration in §5 deliberately creates one location per existing store and merges nothing, so **after it runs the duplication is unchanged**. The oversell becomes impossible only at implementation step 12 — the owner-approved shared-access grant, plus whatever audited correction Q-C calls for. Revision 1 claimed this ADR fixed the oversell; it does not. It makes the fix expressible.

## 2. Decision

### 2.1 A location is a place, and only a place

**[PROPOSED]** `stock_location`: `id`, `organization_id`, `code` (unique per organization), `name`, `is_active`, timestamps, plus `UNIQUE (organization_id, id)` as a composite-foreign-key target — the same device `store` already carries as `uq_store_organization_id_id`.

It deliberately has **no owner column and no kind/type enum**.

- No owner, because **[CONFIRMED]** ownership is a separate dimension the owner has not defined, and a column here would answer it by accident: it would say "a location owns its contents", which consignment and borrowed goods already contradict. `StockLot.acquisition_type` (`PURCHASE`, `CONSIGNMENT`, `BORROWED`) is where ownership evidence already lives, per batch, and is the right starting point later.
- No kind, because **[CONFIRMED]** a name must not grant access. An enum of `WAREHOUSE`/`SALES_FLOOR` is a name, and the first rule anyone writes against it — "sellers may sell from a SALES_FLOOR" — is exactly the inference the owner forbade. `StoreKind` is already documented as a label with no behaviour (assumption A4); this ADR does not repeat that mistake.

### 2.2 Access is explicit data, never inferred

**[PROPOSED]** `store_location_access`: `organization_id`, `store_id`, `location_id`, `can_sell`, `can_receive`, timestamps. `UNIQUE (store_id, location_id)`.

The `organization_id` column is not decoration. Two composite foreign keys depend on it:

```text
(organization_id, store_id)    → store(organization_id, id)
(organization_id, location_id) → stock_location(organization_id, id)
```

Revision 1 claimed "the same composite foreign keys `membership` uses" while omitting the column they need, which the review showed fails at DDL time. Without them this table — the *only* thing standing between a store and a foreign location — would be service-enforced at best, and a single missed check in a future endpoint would hand one organization another's warehouse. With them, invariant I12 keeps database teeth at the new key.

Both flags are `NOT NULL` with **no default**. A store reaches a location because somebody wrote a row, or not at all. Reading is granted by the presence of any access row, whichever flags it sets — a store that may sell from a warehouse can see what is in it.

Two consequences of that, stated because the code and the invariant text drifted apart once before:

- **A read does not require the location to be active.** Closing a warehouse stops goods moving through it; it must not stop anyone seeing what is standing in it, or the stock is invisible as well as frozen and nobody can count it before transferring it out (§1.11). `require_location_access(capability=None)` therefore validates tenancy but not activity, while every command validates both.

  *M1-018 note (2026-09-22):* "transferring it out" is design §1.11's proposal and is **not built**. A transfer is a command like any other, so a closed warehouse is refused at either end of one. The owner has not said what closing a warehouse means, and asked for closed *stores'* operations — transfers included — to be defined before they are built; a transfer-only exception would answer that by default. Open question in the [M1-018 report](../project-memory/m1-018-transfer-report.md).
- **A store with no access row at all reads an empty list, not a refusal.** It has no warehouses, so it has no stock; `200 {"rows": []}` is the honest answer. I23's "refused before any row is read" is about *naming* a location one cannot reach, which is still a 403.

Two independent server-side checks result, answering different questions:

```text
permission  — may this PERSON do this?     scope.require(Permission.X, store_id)
access      — may this STORE do it HERE?   store_location_access(store_id, location_id).can_*
```

**[CONFIRMED]** "both stores sell from the primary warehouse" is then two rows, not a rule in code.

### 2.3 One balance, keyed by location

**[PROPOSED]**

- `inventory`: `store_id` → `location_id`; unique key `(location_id, product_variant_id, size_id)`. `CHECK (quantity >= 0)` untouched. Shared stock becomes one row, so two stores selling it contend on it.
- `stock_lot`: `store_id` → `location_id`.
- `inventory_snapshot`: `store_id` → `location_id`, still nullable.
- `stock_movement`: `store_id` → `location_id`, plus `acting_store_id`.

`acting_store_id` is this ADR's separation written into the ledger: *where* the quantity changed and *which store caused it* are different facts, and a shared warehouse is exactly where they differ. It carries `CHECK (movement_type IN ('TRANSFER_IN','TRANSFER_OUT') OR acting_store_id IS NOT NULL)`, so today's `NOT NULL` guarantee is preserved everywhere a store really is responsible, and relaxed only for a transfer between two warehouses. Both it and `location_id` are bound compositely through `organization_id`, as in §2.2. Reconciliation continues to group by location alone, so invariant I3 is unchanged.

`stock_movement` is append-only, enforced by the `stock_movement_is_append_only` trigger from migration `0002`. The migration's backfill is therefore the one moment in the system's life when the ledger is mutable; §5 says exactly how narrow that moment is.

### 2.4 A sale line records where its goods came from

**[PROPOSED]** `sale_item` gains `source_location_id`, `NOT NULL` — a frozen historical fact beside the frozen price (invariant I8).

Per line, not per sale, because one basket may legitimately draw a coat from the shared warehouse and a scarf from the child's. Without it a refund cannot know where to put goods back and would have to guess, and a wrong guess silently moves stock between warehouses — the transfer invariant I16 says must be explicit.

`sale.store_id` is unchanged: **[CONFIRMED]** the sale belongs to the store that made it, wherever the goods came from.

**[PROPOSED]** `refund_item` gains `destination_location_id`, **nullable**, with `CHECK ((restock = true) = (destination_location_id IS NOT NULL))`.

Nullable deliberately. `restock` is never defaulted because "we refunded the customer and binned it" is an ordinary outcome, and those lines write no stock movement at all. A `NOT NULL` destination would assert a shelf for a coat that went in the bin — and the migration would stamp one onto every historical non-restocked line, inventing history. The `CHECK` is stronger than `NOT NULL` anyway: it makes the two facts agree in both directions.

### 2.5 A transfer moves between locations

**[PROPOSED]** `transfer.from_store_id`/`to_store_id` → `from_location_id`/`to_location_id`, keeping `CHECK (from <> to)`, **and keeping a store**: `initiating_store_id`, the store on whose authority the move happens and the subject of `scope.require(Permission.TRANSFER_CREATE, …)`. Dropping both store columns, as revision 1 did, would have left the permission check with nothing to check. Nothing has ever written this table, so there is no data to convert.

Both legs go into **one** `apply_movements` call, so the source and destination keys are locked in a single globally sorted batch. Two sequential calls would take the destination lock after the source lock, out of global order, and two opposing transfers would deadlock.

**[CONFIRMED]** and worth its own invariant: **drawing shared stock for a sale is not a transfer.** A sale writes `SALE` movements and nothing else. A transfer writes `TRANSFER_OUT` at the source and a matching `TRANSFER_IN` at the destination, in one transaction, audited.

### 2.6 Module placement

**[PROPOSED]** Both tables live in `tenancy`.

It is already the declared base module that depends on no sibling; ADR-0001 already grants `inventory → tenancy` for store validation; and `sales`, `refunds` and `transfers` all already have a `tenancy` edge. Nothing new is needed and no cycle appears. Putting them in `inventory` also compiles, but it would make the module that writes stock also the module that decides who may — muddling the single-writer boundary that makes invariant I3 checkable.

### 2.7 Invariants

Restated:

- **I2** — one `inventory` row per **(location, variant, size)**. Still `DB_ENFORCED`.
- **I6** — concurrent sales cannot oversell. Wording unchanged; it becomes true of shared stock only once the shared-access step lands (§1.3).
- **I12** — tenant boundaries. Extended to the new tables, `DB_ENFORCED` by the composite foreign keys of §2.2.
- **I16** — transfers are movements, never sales. Extended: a sale from a shared location is not a transfer either.

New **[PROPOSED]**:

- **I23** — a store may only read or change stock at a location it holds a `store_location_access` row for. `SERVICE_ENFORCED` + `CI_ENFORCED`. **In force since M1-029.** Naming an unreachable location is refused before any row is read or written, and before the idempotency key is claimed, so a revoked grant cannot replay a cached success. `GET /inventory` was moved out of the router and behind `inventory.service` to give the read half somewhere to be enforced at all; a store with no access rows lists nothing (§2.2).
- **I24** — a `TRANSFER_OUT` is accompanied by exactly one `TRANSFER_IN` of equal magnitude at a different location in the same transaction, and no other movement type pairs with an opposite-signed movement at another location within one command. `SERVICE_ENFORCED`. **Declared, not yet in force:** no code writes a transfer, so there is nothing for it to constrain. It becomes enforceable with M1-018 and must be tested there — an invariant with no enforcement point is a note, and calling it enforced would be the kind of paper guarantee this document exists to avoid.

  **Restated by M1-018 (2026-09-22), and now in force for its first half.** *A `TRANSFER_OUT` has exactly one matching `TRANSFER_IN` — same product, size and magnitude, a different location, naming the same transfer — and both pass through the ledger in the same call.* `SERVICE_ENFORCED` for every caller at `inventory.apply_movements` (`validate_location_flows`), and tested there. *Goods do not move between locations under any other movement type* — this half is kept **by construction, not by a check**. Its mechanical form above refused a real sale when it was implemented: the M1-030 basket that confirms coats on one shelf (`FOUND_DURING_SALE`) and finds one missing from another (`MISSING_AT_SALE`). As written it would also flag an ordinary sale that confirms a found coat at one warehouse while selling at another. What actually holds: apart from the transfer, no command nets one location upward while netting another downward — receipts and refund restocks only add, an adjustment is one line, a sale's corrections are capped at the shortfall it consumes at the same key. A new stock command must be reviewed against that; `sales` may not import `transfers` (import contract). See the [M1-018 report](../project-memory/m1-018-transfer-report.md) §3.

  Revision 1 stated I24 as "only a transfer writes two locations in one command", which its own §2.4 contradicts — a two-line basket drawing from two warehouses does exactly that, legitimately. The restatement targets what the invariant is actually protecting: goods appearing in one place because they left another must be an explicit, paired, audited transfer.

## 3. Alternatives considered

- **Keep `store_id`, add a nullable `warehouse_id`.** Rejected: two columns that both look authoritative, and every query must know which wins. The unique key still contains `store_id`, so the duplication of §1.3 survives.
- **Make the shared warehouse a third `Store`.** Tempting, because it reuses the access machinery. Rejected: a warehouse has no sellers, no sales, no prices and no revenue, so every report, permission matrix and store picker must special-case a row that is not a shop — and it re-conflates access with identity, the thing this ADR separates.
- **Derive access from `StoreKind`.** Rejected outright: **[CONFIRMED]** a name must not grant access, and `StoreKind` is documented as carrying no behaviour.
- **Put ownership on the location.** Rejected: §2.1.
- **One balance per store, reconciled nightly.** Rejected: **[CONFIRMED]** two balances for one pile is the duplication the owner ruled out, and reconciliation reports a double sale after the fact rather than preventing it.

## 4. Consequences

Positive:

- The shared pile becomes expressible as one row, so the conditional-update mechanism already in place can do its job — realised at step 12, not by the migration (§1.3).
- "Where is it" and "who sold it" become separately queryable: stock once, reporting per store.
- Access becomes auditable data rather than a rule compiled into a service.
- M1-018 becomes small: transfers already write `TRANSFER_OUT`/`TRANSFER_IN`; they simply name locations.

Negative and accepted:

- **Every stock-writing path changes together.** The repository, the inventory service, sale, refund, receipts, adjustments and reconciliation cannot be delivered separately: a half-migrated key is a corrupt key.
- **Every stock API gains a location**, including `GET /inventory`, whose contract must change so a shared pile is never reported as a per-store total (§1.3's duplication would otherwise return at the read layer while the write layer stays correct).
- **One more join** on the sale hot path to resolve a store's reachable locations. Small and indexed, but the `/sales` p95 ≤ 500 ms budget must be re-measured, not assumed.
- **A write-blocking migration window.** From the moment the new columns are added, the migration holds `ACCESS EXCLUSIVE` on `inventory`, `stock_movement`, `stock_lot` and `inventory_snapshot` until commit. That is what makes the unique-index swap safe from concurrent writes, and it means in-flight sales block for the duration. It must be run in a maintenance window, not during trading.
- **Reversibility expires.** §5.

## 5. Operational impact

`0005_stock_locations` added the two empty foundation tables. **`0006_stock_rekey` is the re-key itself, and it has shipped** — the description below is what it does, not what it would do. Full detail and its assertions in [`m1-018-stock-location-design.md`](../project-memory/m1-018-stock-location-design.md) §4.

**It is a relabelling, not a reorganisation.** One location per existing store, one access row for that same store, every quantity, lot, movement and snapshot moved across unchanged. Afterwards the system behaves exactly as it did before. The model gains the ability to express a shared warehouse; it does not yet contain one.

**The migration owns the foundation tables while it runs.** It treats `store_location_access` as *the* store↔location mapping for every backfill, which only holds because it wrote every row in it. So it refuses to start if either table already has data — a warehouse provisioned by hand between `0005` and `0006` would otherwise join that mapping silently. The refusal names that as the reason rather than surfacing as a downstream count mismatch, which reads as "balances were merged" and would send an operator looking in the wrong place.

**A migrated warehouse is always open.** `stock_location.is_active` is `true` for every location it creates, never copied from the store. A place does not close because a shop does — and copying the flag would mean blocking the primary store silently closes the *shared* warehouse underneath a child store that is trading normally.

**The ledger is briefly mutable.** Backfilling `stock_movement.location_id` requires disabling `stock_movement_is_append_only`, and the migration re-enables it and then asserts it is enabled. This is the only moment invariants I10/I11 are suspended, it happens inside one transaction, and it deserves to be seen by a reviewer rather than discovered.

**Every backfilled row is checked against the mapping, row by row.** While both columns exist, each table is asserted to name the location its own store maps to. This is what catches a backfill written from the wrong source. The separate assertion that the *reconciliation divergence set* is identical across the re-key is kept, but it is weaker than it looks: on data where nothing diverges it has nothing to compare and passes either way.

**[CONFIRMED]** The migration does **not** merge balances and does not make any warehouse shared. Whether the two stores' stock is the same goods recorded twice or two genuine piles is **not known**, and a migration must not guess (**Q-C**). Making the primary location shared is a separate, owner-approved data step afterwards.

**Rollback has explicit bounds, and refuses outside them.** `downgrade()` recovers each location's store from `store_location_access`, which answers "whose rows are these" only while the mapping stays one-to-one. It proves that shape first and refuses, before any DDL, when:

- a location is reachable by several stores (the shared-access step, once taken);
- a store reaches several locations (what M1-018 produces);
- a location exists that no store reaches (provisioned by hand, and not ours to delete).

Inside those bounds the rollback is lossless and the cleanup is complete: having proved the bijection, it removes *every* location and grant rather than trying to recognise the ones it created. That matters because renaming a warehouse is the first thing anyone does to one — a cleanup matching on code or name would leave a renamed warehouse behind, and its stranded access row would then make the next upgrade refuse, leaving the database stuck between two revisions with no way forward or back.

The window must be in the release notes, and the shared-access step closes it. Until then, rolling back application code while keeping the schema is the preferred recovery, as ADR-0003 already prefers.

## 6. The questions, and the owner's answers (2026-09-17)

All four blocking questions are answered and implemented. The wording below is the answer, not a proposal.

**Q-A — When a store reaches more than one warehouse, which does a sale line draw from? — ANSWERED: the request says so, per line.**
The warehouse is stated explicitly for every sale line. The client may prefill it when the store reaches exactly one, but the server never chooses. **Automatically switching to another warehouse when one is short is forbidden** — a shortfall is `INSUFFICIENT_STOCK`, never a quiet substitution. Implemented: `SaleLinePayload.source_location_id` is required, and `test_a_shortfall_never_falls_back_to_the_other_warehouse` proves the refusal.

**Q-B — Where do returned goods go? — ANSWERED: back where they were sold from.**
A refund that restocks returns the units to the warehouse that specific line was sold from, which `sale_item.source_location_id` records. Sending them elsewhere is a separate, explicit transfer. Sale and refund both stay attributed to the selling store. Implemented: the destination is derived from history and never accepted from the client, and the refunding store must hold `can_receive` there.

**Q-C — After the migration, what happens to the child store's existing balance? — ANSWERED: nothing, for now.**
All current data is test data. Whether to import existing balances or start from nothing is decided separately, before launch, and **nothing is cleaned or merged automatically**. Migration `0006` therefore creates one warehouse per existing store and carries every quantity across untouched. No balance is combined with another, and the question of which real-world pile is which never reaches the database.

**Q-D — Does reaching a shared warehouse include the right to *create* stock there? — ANSWERED: yes for «фізично є», with the existing narrow permission.**
A child-store seller may act at a warehouse they can reach, *with the appropriate rights*. `FOUND_DURING_SALE` therefore works at a shared warehouse — still gated by `inventory:correct_during_sale`, still capped at exactly the shortfall (invariant I18), and still audited. Reaching a warehouse never *implies* that right: access and permission are checked independently, and arbitrary correction stays with `inventory:adjust`. Per the owner's instruction, no seller is handed the run of the balances.

**The correction requires `can_sell` at that warehouse, and not `can_receive`** — the single exception to "adding stock needs `can_receive`", which receipts, adjustments and refund restocks all require. It is deliberate, and it is narrow in both directions:

- the owner's answer grants the action at any warehouse the seller can *reach to sell from*, which is what `can_sell` means;
- the correction cannot leave that warehouse fuller than it found it. It is capped at exactly the shortfall the sale is about to consume, so the net movement is `correction − demand`, never positive. A store denied `can_receive` still cannot deliver goods into the warehouse; it can only account for goods it is simultaneously carrying out.

An independent review flagged the asymmetry as a possible oversight, which is fair — it was implicit. It is now stated here, and `test_a_correction_needs_can_sell_only_and_can_never_leave_the_shelf_fuller` pins both halves, so tightening it to `can_receive` later is an owner's decision rather than a silent drift either way.

The negative half — **«фізично відсутній»** — is a **new requirement, recorded and deliberately not implemented**. Unlike the positive case it has no natural cap, and it must not be equated with zeroing a balance or writing stock off. [`physically-absent-proposal.md`](../project-memory/physically-absent-proposal.md) records it, proposes a bounded scenario (what quantity the seller confirms, how it affects the books, who may do it) and asks the single question that cannot be defaulted:

> **Q-E — open.** When a seller reports goods physically absent, does the sale proceed for the quantity that *is* there, or is the whole line refused until someone investigates? Both are defensible; they differ in what a seller experiences several times a week.

## 7. Explicitly out of scope

Named so nothing here is read as covering them. Each is a confirmed owner requirement of 2026-09-15 needing its own task:

- **Store states** (blocked / ceased trading). The refund command's existing `store_is_active` check on restock is **retained unchanged**; a location-receive check is added *alongside* it, not in place of it. Revision 1 proposed replacing one with the other, which would have defined store-state semantics by deletion — against the owner's explicit instruction not to equate those states with "may refund money but cannot receive goods".
- **Damaged versus intact returned units** and their destination, quarantine or write-off. `refund_item.destination_location_id` is the field that flow will use; the flow itself is not designed here.
- **Ownership of goods**, including in the child warehouse. See §2.1.
- **Who may accept a return from the other store, and which store handles the money.** The owner listed both as open. Today the code permits no cross-store return at all — a refund requires `sale:refund` in the sale's own store — so nothing is broken, and §2.4's "`refund.store_id` unchanged" describes current behaviour rather than settling the question.
- **Negotiated final prices, installment sales, purchase obligations.** No interaction with locations: a price is a store's offer and settlement is a customer relationship. Recorded to show the absence of interaction was checked, not overlooked.

## 2026-10-01 amendment — damaged returns go to the store's «Брак»

§7 left "damaged versus intact returned units" to its own task. The owner
settled it on 2026-10-01 (business-rules.md, "returns at the till"):

- **Every unit that comes back is stated intact or damaged**
  (`refund_item.condition`). One sale line may come back in parts, one per
  condition, and the returnable check (invariant I9) sums every part.
- **Intact goes back where it was sold from**, as Q-B answered.
- **Damaged goes to the store's own «Брак»**: the one warehouse per store
  whose access row has `damaged_returns`, which the database holds to
  `can_receive AND NOT can_sell`. The refund also refuses a «Брак» that any
  store sells from.

This is the one place a return lands anywhere other than the line's source.
It is not a disguised transfer (§5, I24): the destination is derived from the
stated condition and the store's setup, never requested, and the movement only
adds stock to one location. The bootstrap gives every store its «Брак» and
records it; which warehouse is a store's «Брак» is never inferred from its
name.

Taking goods out of «Брак» was built the same day, as the owner decided
(business-rules.md, "what happens in «Брак»"):
- **Back on sale.** After inspection a unit goes back on sale, only to the
  warehouse it was sold from. This is a transfer: the transfer command's own
  core, authorised by `damaged:handle` rather than by `transfer:create` and
  `can_sell` at the source.
- **Written off.** A confirmed unit may be written off, as a stock
  adjustment.
- **The only doors.** `inventory.apply_movements` refuses any movement at a
  store's «Брак» unless the caller is one of these two, or a return taken
  damaged (`DAMAGED_STOCK_CLOSED`). That holds for a delivery, a transfer, a
  correction and a stock list alike.

## 2026-10-17 amendment — the till lists every warehouse it sells from

The owner's choice of 2026-10-17 (business-rules.md; sale-slice TZ, P2-5):
a store that sells from two warehouses finds a coat in either at once, a
chip per warehouse.

- `GET /catalog/stock-options` takes `location_id` as before, and without
  it lists every warehouse the store sells from now — active, with
  `can_sell` — that the caller may read (I23 unchanged). Each row names its
  warehouse (`location_id`), and rows are ordered as before, then by
  warehouse, so pages neither repeat nor skip one.
- **The warehouse stays explicit on every sale line** (§6, 2026-09-17): the
  chip tapped is the line's warehouse; the server never chooses, and a
  shortfall is still `INSUFFICIENT_STOCK`, never another warehouse.
