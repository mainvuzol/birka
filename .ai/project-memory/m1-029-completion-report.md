# M1-029 — stock locations: the balance moves to the warehouse — 2026-09-17

Status: **implemented and verified locally; independently reviewed. M1-029 is complete; gate M1C is not.** M1-018, M1-020…M1-023 remain, and one requirement raised the same day — «фізично відсутній» — is deliberately recorded rather than built.

This finishes what the [foundation report](m1-029-foundation-report.md) started. That change created `stock_location` and `store_location_access` empty; this one moves the stock key onto them.

## 1. What changed, in one sentence

`inventory` was keyed `(store_id, variant, size)` — one column meaning *where the goods are*, *who may sell them* and, by implication, *whose they are*. It is now keyed `(location_id, variant, size)`, with the selling store recorded separately on the sale and on every ledger row.

That is what lets one shared pile of coats be **one balance** that both shops draw from, while each sale is still credited to the shop that made it.

## 2. The owner's answers, and where each one lives in the code

| Confirmed 2026-09-17 | Implementation |
|---|---|
| All current data is test data; nothing cleaned or merged automatically | `0006` creates one warehouse per existing store and carries every quantity across. No balance is combined; assertion 1 aborts the migration if any warehouse ends up reachable by two stores |
| Shared primary warehouse + separate child warehouse; the child store chooses explicitly | `store_location_access(store, location, can_sell, can_receive)`, both flags `NOT NULL` with no default |
| Sale credited to the store that made it | `sale.store_id` unchanged; `stock_movement.acting_store_id` records who moved the goods, `location_id` records where |
| Shared balance not duplicated | `UNIQUE (location_id, product_variant_id, size_id)` — one row, and `GET /inventory` reports it once per warehouse, never as a per-store total |
| Warehouse stated per sale line; client may prefill; **no automatic fallback on shortage** | `SaleLinePayload.source_location_id` is required; a shortfall is `INSUFFICIENT_STOCK`, and `test_a_shortfall_never_falls_back_to_the_other_warehouse` proves no substitution happens |
| Refund restocks the warehouse that line was sold from | Destination read from `sale_item.source_location_id`, never from the client; the refunding store must hold `can_receive` there |
| Seller may do «фізично є» at a reachable warehouse, with the right permission | `FOUND_DURING_SALE` lands at the line's own warehouse, still capped at exactly the shortfall (I18) and still gated by `inventory:correct_during_sale` |
| Not every seller gets arbitrary correction | Access and permission are independent checks; `inventory:adjust` unchanged and still manager/owner |
| «Фізично відсутній» must not be assumed | **Not implemented.** Recorded with a proposed bounded scenario and one open question in [`physically-absent-proposal.md`](physically-absent-proposal.md) |

## 3. Design decisions worth stating

- **Access is data, never inference.** A store reaches a warehouse because a `store_location_access` row says so. Nothing is derived from a warehouse's name or a store's `StoreKind` — including in the tests, which write every grant out explicitly so they cannot accidentally prove the wrong thing.
- **Two independent checks guard every stock operation.** `scope.require(...)` asks whether this *person* may act; `require_location_access(...)` asks whether their *store* may act *here*. Neither implies the other, and both are tested in both directions.
- **Both checks run before the idempotency key is claimed.** A review of the refund command previously established that a permission check after the replay branch lets a revoked grant keep receiving a cached success. The same ordering applies here, and `test_revoking_access_stops_the_next_sale_and_is_honoured_on_a_replay` is what proves it — it caught exactly that bug during development, when the location check lived only in the service.
- **`lock_stock` asks two questions, not one.** Before the re-key, a single `validate_active_stores` call proved both the tenant and the store's activity on every stock command. Moving the key to the warehouse would have silently converted it into a location check and left nothing validating the acting store. It now calls `validate_active_locations` **and** retains `validate_active_stores`.
- **The warehouse is in the permanent command fingerprint.** The 7-day idempotency cache picks a new payload field up automatically; the permanent `command_fingerprint` on `Sale` is built by hand and would not. Without it, the same `command_id` retried against a different warehouse would be judged an identical retry and replayed — telling the caller "sold" about stock it never named.
- **`acting_store_id` is nullable only for transfers.** `CHECK (movement_type IN ('TRANSFER_IN','TRANSFER_OUT') OR acting_store_id IS NOT NULL)` preserves today's `NOT NULL` attribution everywhere a store really is responsible, and relaxes it only for a warehouse-to-warehouse move, which no single store owns.
- **`refund_item.destination_location_id` is nullable with a CHECK**, not `NOT NULL`: a line that was not restocked writes no movement, and asserting a shelf for goods that went in the bin would invent history. `CHECK ((restock IS TRUE) = (destination_location_id IS NOT NULL))` makes the two agree in both directions, which is stronger than `NOT NULL` would be.
- **`variant_price` keeps its store.** A suggested price is a store's offer to its customers, not a property of a shelf; two shops selling the same shared coat may price it differently.

## 4. Verification

Everything below ran on 2026-09-17 in the isolated Birka environment: a disposable PostgreSQL **16.2** cluster from the `pgserver` wheel, on a private socket, with databases created and dropped per check. No Docker resource, no work database, no other project was touched.

| Check | Result |
|---|---|
| Full backend suite, real database | **394 passed, 0 skipped** (23 shared-warehouse + 10 migration + the frozen-history and migration-module cases, on top of the re-keyed suite) |
| `ruff check .` | clean |
| `ruff format --check .` | 96 files, clean |
| `mypy app` | 55 source files, no issues |
| `lint-imports` | 9 contracts kept, 0 broken |
| `alembic check` | no model drift |
| Migrations, fresh database | 6 revisions apply |
| Round trip, fresh database | `upgrade head` → `downgrade base` → `upgrade head` = 6 / 6 / 6, `alembic check` clean afterwards |
| Migrations `0001`–`0005` | `0001`–`0004` byte-identical to git HEAD; `0005` is untracked, so it has no HEAD to compare against — it is unmodified since the foundation session and frozen by digest |

### The migration, tested as a migration

`tests/integration/test_stock_rekey_migration.py` builds a database at `0005` with store-keyed sales, refunds, receipts, lots, a ledger and a **deliberately injected divergence**, using raw SQL — the ORM now describes the post-migration schema, so a fixture built through it could not exist before the migration and would prove nothing.

- quantities, ledger totals, row counts, sale and refund money all identical before and after;
- one warehouse per store, one store per warehouse — **nothing merged**; the two stores' balances stay 7 and 7;
- the pre-existing divergence survives **visibly** — the migration asserts the divergence set is *identical*, not *empty*, so a real data problem cannot be tidied away behind a schema change;
- the append-only ledger trigger is suspended for the backfill and restored, and an assertion refuses to let the migration finish otherwise;
- `upgrade → downgrade → upgrade` with data present returns the database to a byte-equal snapshot.

### Tests are load-bearing

Each guard was removed and the suite re-run:

| Guard removed | What fails |
|---|---|
| the sale **router**'s location check | `test_revoking_access_stops_the_next_sale_and_is_honoured_on_a_replay` |
| the sale **service**'s location check | `test_the_service_refuses_a_foreign_warehouse_without_the_router` |
| `source_location_id` from the permanent fingerprint | `test_the_same_command_against_a_different_warehouse_is_a_conflict` |
| `validate_active_stores` from `lock_stock` | the `inactive_store` scope case |
| the migration's trigger restore | `test_the_append_only_ledger_is_protected_again_afterwards` |

The router/service pair is worth noting: the service check alone was **not** load-bearing, because the router refuses first. Rather than delete it, a direct service-level test was added — defence in depth that nothing exercises is defence in depth that rots.

### The acceptance criteria, one by one

- **Two stores selling the last shared unit, no correction → exactly one succeeds.** `test_two_stores_cannot_both_sell_the_last_shared_coat` holds the first transaction open deliberately rather than relying on `asyncio.gather`, because whether two racing requests overlap at the critical moment is a coin flip. `test_many_racing_sellers_across_two_stores_sell_exactly_the_stock` adds ten concurrent sellers across both shops against three coats: three succeed, seven get `INSUFFICIENT_STOCK`, the shelf ends at zero.
- **Own and shared warehouses do not mix.** Same product in both; selling from one leaves the other untouched, and a shortfall in one never reaches into the other.
- **A return replenishes the source warehouse.** Including the case where the child store may sell from the shared warehouse but not receive into it — an explicit `LOCATION_ACCESS_DENIED`, not a silent restock elsewhere.
- **Retries do not duplicate movements; a changed warehouse is a command conflict.** Both directions tested.
- **Foreign organization, missing access, revoked access and insufficient permission are all refused.** A foreign warehouse is a 404 that discloses nothing; a reachable-but-ungranted one is an explicit 403.
- **Migration preserves quantities, history, links and the append-only ledger; rollback has explicit bounds.** Above, plus `test_downgrade_refuses_once_a_warehouse_is_genuinely_shared`.

## 5. Changed files

**New:** `backend/migrations/versions/0006_stock_location_rekey.py`; `backend/tests/integration/test_shared_warehouse.py`; `backend/tests/integration/test_stock_rekey_migration.py`; `backend/tests/unit/test_migration_history_is_frozen.py`; `backend/tests/unit/test_m1b_migration_module.py`; `.ai/project-memory/physically-absent-proposal.md`; this report.

**Changed (application):** `app/modules/inventory/{models,repository,service}.py` — the stock key, the reconciliation query and its new tenant filter, and `readable_stock`; `app/modules/tenancy/{models,service}.py` — `LocationCapability`, `validate_active_locations`, `accessible_locations`, `require_location_access`; `app/modules/sales/{models,service}.py` — `source_location_id`, the access check, the fingerprint; `app/modules/refunds/{models,service}.py` — `destination_location_id` and `refund_destinations`; `app/modules/transfers/models.py` — warehouses plus `initiating_store_id`; `app/api/v1/{inventory,sales,refunds}.py`; `app/core/errors.py` — `LOCATION_ACCESS_DENIED`.

**Changed (tests):** ~130 existing cases moved from store-keyed to location-keyed stock. Every fixture now provisions a warehouse and an explicit access row. `tests/unit/test_m1b_schema_parity.py` was **removed** and replaced by `test_migration_history_is_frozen.py` — see §7.

**Changed (docs):** ADR-0004 (§6 now records the owner's answers), `business-rules.md`, `current-milestone.md`, `milestone-1-plan.md` (M1-029 done, M1-018 ready, M1-030 added and blocked), `known-risks.md`.

## 6. Migrations and their limits

`0006_stock_rekey`, one transaction, additive first and destructive only at the end.

**Its limits, stated plainly:**

- **The ledger is briefly mutable.** Backfilling `stock_movement` requires suspending `stock_movement_is_append_only` — the one moment invariants I10/I11 are relaxed. It happens inside the single transaction, and an assertion refuses to finish unless the trigger is back on.
- **It holds `ACCESS EXCLUSIVE`** on `inventory`, `stock_movement`, `stock_lot` and `inventory_snapshot` from the first `ADD COLUMN` to commit. That is what makes the unique-index swap safe from concurrent writes, and it means in-flight sales block for the duration. **A maintenance window, not a trading-hours deploy.**
- **It refuses to start unless the foundation tables are empty.** It treats `store_location_access` as *the* store↔location mapping for every backfill, which only holds because it wrote every row in it. A warehouse provisioned by hand on a database still at `0005` is refused by name, not by a downstream count mismatch.
- **Rollback is lossless only inside a stated shape, and refuses outside it.** `downgrade` recovers the mapping from `store_location_access`, which answers "whose rows are these" only while every warehouse has one store and every store has one warehouse. It proves that bijection *before any DDL* and refuses on: a shared warehouse, a store with two warehouses, or a warehouse no store reaches. Inside the bounds it then deletes every location and grant — having proved they are all its own — rather than matching on code or name, which would strand a renamed warehouse and block the next upgrade. Verified by four tests, including a renamed warehouse round trip. The test suite's own database legitimately cannot be downgraded: its warehouses really are shared.
- **A migrated warehouse is always active.** `is_active` is never copied from the store: blocking a shop must not silently close a warehouse another shop is trading from.
- **It creates no shared arrangement.** Making a warehouse shared is a deliberate data step afterwards, not something the migration does.
- **It merges nothing.** Whether two balances are the same goods recorded twice is not knowable from the database, and the owner has deferred that decision to before launch.

## 6a. The second independent review, and what it changed

A full independent review of the shipped change set (migration, access isolation, concurrency) ran against this tree. It could not produce an oversell — ten racing sellers, opposed two-warehouse baskets, sale-versus-refund and sale-versus-receipt races, mixed load, all with zero deadlocks and zero divergences — and confirmed the access matrix, the replay identity, the append-only restore on the failure path, and that no code path mutates a historical sale or refund line. It also found **two blocking and seven major defects**. All are fixed:

| # | Finding | Fix |
|---|---|---|
| B1 | The in-sale correction required only `can_sell`, while every other stock-*adding* path required `can_receive` — an undocumented asymmetry | Kept, because it is what the owner's Q-D answer grants, but **stated** in ADR-0004 §6 and `business-rules.md`, with the reason it is safe (the cap makes the net movement never positive) and a test pinning both halves |
| B2 | `downgrade()` deleted locations by matching code/name, so a renamed or hand-provisioned warehouse was stranded — leaving the database unable to upgrade again; and a store with two warehouses hit a raw `UniqueViolationError` mid-DDL | Guards now prove the bijection before any DDL and refuse with a reason; cleanup deletes every location and grant. Four new tests |
| M1 | The divergence-set assertion is blind when nothing diverges — the deploy case — so a ledger backfilled from the wrong store could pass | Per-row assertions added for all six backfilled tables, checked while both columns exist. Proven by mutating the ledger backfill to the wrong store |
| M2 | No preflight on the foundation tables; a pre-provisioned warehouse aborted with a message about merged balances | Explicit preflight naming the real problem, with a test |
| M3 | The migration copied `store.is_active` onto the warehouse, inventing "blocking a shop closes its warehouse" | Locations are always created active; test added |
| M4 | An inactive warehouse could be listed but not named — `200` then `404` for the same rows, contradicting the design's "readable, so stock is never stranded" | Reads no longer require activity; commands still do. Test added |
| M5 | Two behaviours right in the code but untested: the refund's pre-claim access check, and per-line refund destinations across two warehouses | Two tests added; each one now kills the mutation that previously survived |
| M6 | Four unit tests unrelated to re-rendering were deleted with `test_m1b_schema_parity.py` | Restored as `test_m1b_migration_module.py`, rebased on the frozen SQL rather than on live models |
| M7 | Documentation defects: stale risk and milestone text, a garbled sentence, I24 claimed "in force" with nothing to enforce it, an evidence log predating the final state | All corrected; I24 is now explicitly declared-but-not-in-force until M1-018 |

Minor items also addressed: the `transfer` foreign-key name now follows its renamed column (migrated and fresh schemas were silently different), `inventory_snapshot` gained the composite tenant foreign key its siblings already had, `lock_stock` no longer defaults away the acting-store check, an unscoped reconciliation sweep is refused rather than reading every tenant, and two stale test names, one misleading docstring and some dead code are gone. Left as noted, not fixed: `sale_item`/`refund_item` cannot carry composite tenant foreign keys (no `organization_id` column), so those stay service-enforced; and no new indexes were added on speculation.

## 7. A test that was replaced, and why

`tests/unit/test_m1b_schema_parity.py` re-rendered the live models and diffed them against the shipped `0002` SQL. That worked while later revisions only *added* columns. `0006` removes `inventory.store_id`, adds two columns and a CHECK to `stock_movement`, and reshapes `transfer`; reconstructing the `0002` projection from today's models would mean maintaining a growing list of deletions and re-additions, and a test that needs constant maintenance to keep agreeing with itself is not evidence of anything.

What it actually protected — *a shipped migration's bytes never change* — is now absolute, in `test_migration_history_is_frozen.py`: a sha256 per shipped revision, plus a check that at most one migration is outside the frozen set. Four of its tests never depended on the re-rendering at all — the append-only table set, the downgrade drop list, and the two statement-splitter tests, one of which exists because its absence once broke a real deploy. The independent review was right that deleting them was collateral damage; they are back in `tests/unit/test_m1b_migration_module.py`, now reading the frozen SQL instead of the live models. Model-versus-database drift is proven by `alembic check` against real PostgreSQL, which CI already runs on every push together with a full `downgrade base` → `upgrade head` round trip. That is stronger than the offline reconstruction, because it runs against the database rather than a rendering of it.

## 8. Not verified, and not claimed

- **PostgreSQL 17 was not exercised for this change.** Everything above ran on the 16.2 build bundled in `pgserver`. The 2026-09-16 isolated Docker/PostgreSQL 17.11 verification covers the *previous* baseline, not this one. Nothing here uses a 16/17 behavioural difference, but that is an argument, not evidence: **the PostgreSQL 17 run for `0006` is still owed**, through CI or an isolated Compose run.
- **No Docker/Compose run for this change**, for the same reason.
- **No frontend.** `GET /inventory` and the sale payload both changed shape; the Telegram client is gate M1D and has not been touched.
- **No production deploy, no push, no merge.** The work is local and uncommitted.
- **`POST /sales` p95 was not re-measured** against the ≤ 500 ms budget with the added access join. The join is small and indexed, but the budget is a product requirement and should be measured, not assumed.
- **Transfers are not implemented.** The `transfer` table changed shape (warehouses plus `initiating_store_id`) and nothing writes it. That is M1-018, deliberately kept out of this change set.

## 9. Open questions

1. **Q-E — «фізично відсутній»: does the sale proceed for the quantity that is present, or is the line refused until someone investigates?** The only question blocking M1-030. Recorded with a full proposed scenario in [`physically-absent-proposal.md`](physically-absent-proposal.md).
2. **When should the primary warehouse actually become shared in real data?** The model supports it; no such grant exists. Doing it is a deliberate, owner-approved data step, and it closes the rollback window in §6.
3. **Still open from earlier, untouched here:** store states (blocked / ceased trading), intact-versus-damaged returned units and their destination, goods ownership, negotiated prices and installments, and who may accept a return from the other store.
