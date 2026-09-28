# M1-023 — Legacy stock lists become opening balances only through review and approval

Status: **implemented and verified on PostgreSQL 17.11; independently reviewed** (design review before implementation, three code reviews after). Local branch `feat/m1-023-snapshot-import` over `main` at `0ca93d8` (PR #31). **Not pushed, not merged** — the owner does both.

Whether the shops' real balances are imported at all is still the owner's decision (owner decisions 2026-09-17). This builds the capability and changes no data.

Design: [ADR-0005](../decisions/ADR-0005-legacy-snapshot-import.md).

## 1. What it does

```text
POST /api/v1/snapshots                    import, named by the client's command_id: every line kept verbatim and parsed;
                                          nothing matched, created or counted
PUT  /api/v1/snapshots/{id}/lines/{n}     review: what the line is (allocations + quantity basis), or why it is not stock
POST /api/v1/snapshots/{id}/approve       the whole list → OPENING_BALANCE lots and movements, or nothing
POST /api/v1/snapshots/{id}/reject        nothing becomes stock; the evidence stays
GET  /api/v1/snapshots?store_id=          the store's lists (a list the person may not see is left out)
GET  /api/v1/snapshots/{id}               header, summary by basis, and — once applied — what it became
GET  /api/v1/snapshots/{id}/lines         each line's evidence (raw text, parser reading, repeats) and answer
```

### The quantity basis

A person's answer records where its numbers came from:

- **`STATED`** — the one count the line states, in one allocation.
- **`LINE_IMPLIES_ONE`** — a line with no number that could be a count, taken as one piece.
- **`RECOUNTED`** / **`OWNER_KNOWLEDGE`** — anything, with a note saying who counted or how it is known.

A split across sizes or colours is never `STATED`. A line naming several of them, with a slash or without ("Лама бежевая/персик/butter 3 шт", "Лоран S M L 3 шт"), is `UNKNOWN_DISTRIBUTION`. It can only be answered on a recount or other knowledge, with a note. The approver sees the lines and units behind each basis.

### Refusals

| Situation | Answer |
|---|---|
| Missing `snapshot:import` / `snapshot:approve` | 403 `PERMISSION_DENIED` |
| The store has no `can_receive` at the warehouse (import, review, approve) | 403 `LOCATION_ACCESS_DENIED` |
| Private warehouse without a direct grant in its managing store | 403 `PERMISSION_DENIED` |
| Unknown or foreign list, line, product, size or warehouse; a paused warehouse (commands); a retired product | 404 `NOT_FOUND` |
| Same `command_id`, different list (another organization's same id is simply its own list) | 409 `IDEMPOTENCY_CONFLICT` |
| Lines still waiting; nothing to apply; changed since checked; already decided | 409 `SNAPSHOT_CONFLICT` + `details.reason` |
| The warehouse already has stock history | 409 `OPENING_BALANCE_CONFLICT` |
| «Фізично є» for a sized unit beside the same model held with size not known, or for a unit with size not known | 409 `UNKNOWN_SIZE_STOCK` |
| A regular size already named `UNKNOWN` | 409 `CATALOG_AMBIGUOUS` |
| Any of these: | 422 `VALIDATION_ERROR` |
| &nbsp;&nbsp;— a blank line, a line over 500 characters, a list over 100 000 characters | |
| &nbsp;&nbsp;— an answer claiming more than its basis, a split without a note, a duplicate allocation | |
| &nbsp;&nbsp;— a list over 5 000 allocations | |
| &nbsp;&nbsp;— "size not known" in a receipt or a positive adjustment, or the catalog size code `UNKNOWN` | |

## 2. Why it looks like this

The schema from `0002` could not express a line with several sizes, knew nobody acting, and had no safe retry. Nothing had ever written it, so `0015` reshapes it (ADR-0005 §2–3, §9). Resolution is an explicit statement per line, not a `CatalogMatchDecision`: confirming a decision needs an unchanged knowledge revision, and reviewing a list means creating products, which advances it.

### The design review (before implementation)

A fresh-context reviewer read the first ADR draft against the code and found:

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | MAJOR | The once-per-warehouse check held only for the list's own keys. A receipt, transfer or «фізично є» on another key could commit between the history check and the approval — the very "size not known beside sized stock" case the rule exists for. | Every stock command now holds a **shared** per-warehouse advisory lock (`lock_stock`); the opening balance takes it **exclusively** first. Pinned by a two-ordering race test using `pg_locks`. |
| 2 | MAJOR | `OPENING_BALANCE` could be written outside the workflow: `apply_movements` accepted it from anyone, and any `inventory:receive` holder could label a receipt lot `OPENING_BALANCE` (or `TRANSFER`, `RETURN`, `ADJUSTMENT`). | Ledger door refuses it without list and lot; database CHECKs on `stock_movement` and `stock_lot`; lot link `RESTRICT`; receipts limited to `PURCHASE` / `CONSIGNMENT` / `BORROWED`. |
| 3 | MAJOR | "Size not known" stock would be counted twice by «фізично є» selling one as, say, M. | The sale refuses that correction (`UNKNOWN_SIZE_STOCK`) while such stock is available at that warehouse. |
| 4 | MAJOR | Typed quantities and splits had no recorded basis: 1+1+1 for a slash line passed with no note. | The quantity basis above, checked per line and summarised for the approver; repeats shown; CHECKs keep the evidence summary consistent. |
| 5 | MAJOR (owner) | The once-per-warehouse rule has launch consequences the draft did not state. | Stated in ADR-0005 and put to the owner (question 1). |
| 6 | MINOR | `store_id` is the name ADR-0004 retired on this table, and `0006`'s downgrade recreates it. | Column is `acting_store_id`. |
| 7 | MINOR | The downgrade dropped lot links and rewrote the stated quantity. | The downgrade refuses while any decision exists; the upgrade refuses decisions it did not make. |
| 8 | MINOR | Provenance was not protected by the database. | Freeze trigger on decided lists, rows and allocations; `applied_names_place_and_store` CHECK. |
| 9 | MINOR | Access at import, review and read was unspecified, and nobody can approve a private warehouse's list by default. | Specified in ADR-0005 §9; the default pinned by a test and put to the owner (question 5). |
| 10–11 | NOTE | Identity scoping, lock key, module contracts. | Foreign id answers 409 like a changed request; lock key is (organization, id); contracts added; ADR-0001 amended. |

## 3. Invariants

- **I17** (legacy import fabricates nothing) is now `SERVICE_ENFORCED` + `DB_ENFORCED` + `CI_ENFORCED`.
  - The approval can write only `OPENING_BALANCE`, and only `apply_opening_balance` writes it; the public ledger door refuses it.
  - In the database, two CHECKs and trigger `opening_balance_traces_to_its_list` refuse an opening balance that does not come from an opening lot of the list it names.
  - The receipt schema refuses the `OPENING_BALANCE` label.
  - Opening only an empty warehouse is a service rule, held under the warehouse lock.
- **I15** (splits never invented): an `UNKNOWN_DISTRIBUTION` line blocks approval until a person answers it on a recount or other knowledge, with a note.
- **I3** (every quantity has a ledger entry): reconciliation is empty after every approval in the suite; the approval also checks each key's resulting quantity itself.
- **I13** (authority before replay): every command re-authorizes before any replay; pinned for approval.
- **I10/I11** (evidence and ledger append-only): lines are `RawInput`; the new freeze trigger extends "not silently rewritten" to decided lists.

## 4. Migration `0015_snapshot_import`

**`inventory_snapshot`** gains:

- `command_id`, unique per organization and backfilled from `id`;
- `acting_store_id` (composite FK) and `created_by_user_id`;
- `command_fingerprint` and `review_revision`;
- decision columns, four CHECKs and one index.

**Rows.** The row's single resolution is replaced by `inventory_snapshot_allocation`. The row gains `quantity_basis` (a new enum), a note, the verdict's actor and time, five CHECKs and a unique `raw_input_id`.

**Ledger:**

- `stock_movement` gains CHECK `opening_balance_names_its_list` and trigger `opening_balance_traces_to_its_list`;
- `stock_lot` gains CHECK `opening_lot_names_its_list`, and its link to the list becomes `RESTRICT`;
- trigger `inventory_snapshot_is_final` checks the list both before and after a change, under `FOR SHARE`.

- **Upgrade refuses** by name, changing nothing, if any of these exists (none can come from code before M1-023):
  - a list or line that already carries a decision;
  - a waiting line in a shape its CHECKs cannot hold;
  - an `OPENING_BALANCE` lot that names no list;
  - any `OPENING_BALANCE` movement.
- **Downgrade refuses** while any list or line carries a decision; otherwise it restores the `0002` shape.
- **Maintenance window**: the two ledger CHECKs scan `stock_movement` and `stock_lot` under an exclusive lock.
- **No older instance running.** Code before `0015` takes no warehouse lock, so it must not write stock while a list is approved.
- Rolling back code while keeping the schema is safe: no pre-0015 code reads these tables.

## 5. Changed files

Application:
- `backend/app/modules/snapshots/{__init__,models,service}.py` — new module (models moved from `inventory/models.py`).
- `backend/app/api/v1/snapshots.py`, `router.py` — the seven endpoints.
- `backend/app/modules/inventory/{models,service,repository}.py`:
  - `apply_opening_balance`, the only writer of `OPENING_BALANCE`;
  - the shared and exclusive warehouse lock;
  - the `OPENING_BALANCE` shape guard;
  - history, replay and one-statement availability queries;
  - two CHECKs and the `RESTRICT` lot link.
- `backend/app/modules/catalog/`:
  - `raw_lines.py` (new), which parses in a worker thread;
  - `validation.py` (`require_active_variants`);
  - `service.py` (`ensure_unknown_size`, and the reserved `UNKNOWN` code);
  - `read.py` (`unknown_size_ids`).
- `backend/app/modules/sales/service.py` — the `UNKNOWN_SIZE_STOCK` guard, both directions.
- `backend/app/api/v1/inventory.py` — receipts accept three acquisition types. Receipts and positive adjustments refuse "size not known".
- `backend/app/core/errors.py` — `SNAPSHOT_CONFLICT`, `OPENING_BALANCE_CONFLICT`, `UNKNOWN_SIZE_STOCK`.
- `backend/app/models_registry.py`, `backend/pyproject.toml` (two new contracts, seven extended).
- `backend/app/main.py`, `backend/tests/conftest.py`, `backend/scripts/{seed_organization,seed_orders_e2e,evaluate_catalog}.py` — import the model registry, so a lot's link to its list resolves in every process.
- `backend/migrations/versions/0015_snapshot_import.py`.

Tests:
- `backend/tests/integration/test_snapshot_import.py` (47 tests), `test_snapshot_migration.py` (5), `tests/unit/test_snapshot_import.py` (55).
- `tests/unit/test_migration_history_is_frozen.py` — `0014` frozen now that it shipped.

Found in passing (separate commit): three test files and `scripts/evaluate_catalog.py` read/wrote UTF-8 with the platform default. On Windows that is cp1251: 25 parser tests failed on the owner's machine, and the evaluation report was written in cp1251.

Docs: ADR-0005 (new), ADR-0001 amendment, ADR index, plan (§6 I17, §7, §8, §9, M1-023 row, §13), current milestone, business rules, known risks, README.

## 6. Verification

Environment: a disposable Docker container `postgres:17-alpine` — **PostgreSQL 17.11**, `--locale-provider=icu --icu-locale=uk-UA --locale=C.UTF-8`, exactly as CI and Compose — on `127.0.0.1:55432`, removed afterwards. The owner's own `birka-dev-db-1` container was not touched. Python 3.12.10, SQLAlchemy 2.0.54, Windows 10.

| Check | Result |
|---|---|
| `ruff check .` | clean |
| `ruff format --check .` | 153 files already formatted |
| `mypy app scripts` | no issues in 84 source files |
| `lint-imports` | 14 contracts kept, 0 broken |
| Migrations on an empty database | 15 revisions base → head, `alembic check`: no new upgrade operations; head → base → head, check clean again |
| Migration refusals | 5 tests on scratch databases:<br>• round trip while nothing is decided;<br>• refuses to downgrade over a decision;<br>• refuses to upgrade over a foreign decision;<br>• refuses to upgrade over an unlisted opening lot;<br>• refuses to upgrade over a hand-written line |
| Full suite `pytest -q` | **875 passed, 0 skipped**, 2 third-party deprecation warnings (Starlette, anyio) |
| One file alone (the models-registry regression) | `test_inventory_scope_locking.py`: 14 passed; 2 failed before the fix |
| Catalog evaluation gate (CI step) | exit 0 — 15/15 synthetic decisions, 0 unsafe SAME_VARIANT, `promotion_ready: false` (unchanged) |
| Mutation testing | **36 of 37 caught**; the one survivor is unreachable by construction (below) |

#### Mutation testing

Each mutation breaks one guard in the source. The relevant tests then run with `-x`, and the source is restored byte for byte. The table names the first test that failed.

The first run had 25 mutations and caught 22. Two survivors were real gaps in the tests, and each got a test (marked *added*); a rerun caught both.

After the reviews, 12 mutations were added for their fixes (#26–37). Three were re-anchored on the new import identity (#14–16). The final run over all 37 caught 36.

| # | Mutation | Caught by |
|---|---|---|
| 1 | `lock_stock` takes no shared warehouse lock | `test_stock_written_on_another_key_is_either_before_the_opening_or_after_it` |
| 2 | The opening balance takes no exclusive warehouse lock | `test_stock_written_on_another_key_is_either_before_the_opening_or_after_it` |
| 3 | No stock-history check | `test_a_warehouse_with_stock_history_is_not_opened` |
| 4 | History counts only earlier opening balances, so a warehouse sold back to zero looks new | `test_a_warehouse_sold_back_to_empty_still_has_history` (*added*) |
| 5 | The ledger door lets an opening balance name no list | `test_an_opening_balance_cannot_be_written_outside_a_list` |
| 6 | Receipts accept any acquisition type again | `test_an_opening_balance_cannot_be_written_outside_a_list` |
| 7 | No per-key reconciliation after the opening | **survives** — see below |
| 8 | Approval ignores the review revision | `test_a_list_that_changed_after_it_was_checked_is_not_approved` |
| 9 | Lines still waiting do not block approval | `test_lines_still_waiting_block_approval` |
| 10 | Products are not revalidated at approval | `test_a_product_retired_after_review_blocks_approval` |
| 11 | Approval needs only reach, not `can_receive` | `test_approval_needs_the_store_to_still_receive_here` |
| 12 | `snapshot:import` is enough to approve | `test_a_private_warehouse_takes_a_list_only_from_its_own_store` |
| 13 | A replayed approval omits what the list became | `test_approving_again_returns_exactly_what_was_done` |
| 14 | A changed import under the same command is a retry | `test_the_same_command_for_another_list_is_a_conflict` |
| 15 | A command is looked up in every organization | `test_the_same_command_for_another_list_is_a_conflict` |
| 16 | No advisory lock on the import's command | `test_two_deliveries_of_one_import_at_once_make_one_list` |
| 17 | Review without authorization | `test_only_importers_review` |
| 18 | A decided list can still be answered | `test_a_rejected_list_keeps_its_evidence_and_becomes_no_stock` |
| 19 | The same product and size twice in a line is summed | `test_the_same_product_and_size_twice_in_one_line_is_refused` |
| 20 | A `STATED` answer may use several allocations | `test_an_answer_may_not_claim_more_than_its_basis[KNOWN-3-STATED-quantities3-None-False]` (*added*: the stated 3 in one size plus one more piece) |
| 21 | A recount needs no note | `test_numbers_must_say_where_they_came_from` |
| 22 | A line's processing state is not recorded | `test_a_line_resolves_to_several_sizes_when_someone_says_how_they_know` |
| 23 | "Size not known" reuses a regular size named `UNKNOWN` | `test_a_regular_size_named_unknown_is_never_relabelled` |
| 24 | A retired variant counts as active | `test_a_foreign_or_retired_product_is_unknown` |
| 25 | The sale guard (a sized unit beside size not known) is off | `test_found_during_sale_cannot_count_size_unknown_stock_twice` |
| 26 | The public ledger door writes an opening balance | `test_an_opening_balance_cannot_be_written_outside_a_list` |
| 27 | Several sizes or colours without a slash may be stated | `test_numbers_must_say_where_they_came_from` |
| 28 | A count no stock could be becomes the line's total | `test_a_line_is_read_conservatively` |
| 29 | A line with a count may be taken as one piece | `test_numbers_must_say_where_they_came_from` |
| 30 | An unclassified number is not a possible count | `test_a_line_is_countless_only_when_nothing_in_it_could_be_a_count[3 куртки-False]` |
| 31 | Review treats every line as countless | `test_numbers_must_say_where_they_came_from` |
| 32 | No cap on a list's allocations | `test_a_list_opens_a_warehouse_with_a_bounded_number_of_allocations` |
| 33 | The list of lists hides lists after the page | `test_the_list_of_lists_leaves_out_what_a_person_may_not_see` |
| 34 | No bound on a list's characters | `test_an_import_that_is_not_a_list_of_lines_is_refused[list-too-long]` |
| 35 | `UNKNOWN` is an ordinary size code in the catalog | `test_a_regular_size_named_unknown_is_never_relabelled` |
| 36 | Receipts take "size not known" | `test_goods_with_their_size_not_known_enter_only_from_a_list` |
| 37 | «Фізично є» may add "size not known" | `test_found_during_sale_cannot_count_size_unknown_stock_twice` |

**Why #7 survives.** The reconciliation runs only after two things hold:

- the history check has proved the warehouse free of movements and of stock;
- `apply_movements` has added exactly each line's quantity.

No request can make a key's balance differ, so no test can reach the check without faking one of those steps. It stays as a cheap guard against a future change to either step. If it ever fires, it raises before commit, so nothing is written.

**Not mutated, and why:**

- **The service's own character bounds.** The API refuses first; they are defence in depth for other callers.
- **The one-statement availability read.** It closes a race that no test can force deterministically.
- **The model-registry imports.** Verified by running the affected file alone.
- **The SQL triggers.** Tested directly with raw SQL.

## 7. Independent code review

Three fresh-context reviewers read the finished change with read-only access and no database (OPERATING_MANUAL §6): code, concurrency and ledger, and security and tenancy. **No blocker.** The findings below are deduplicated across reviewers; every one was confirmed against the code before it was fixed.

| # | Severity (reviewer) | Finding | Resolution |
|---|---|---|---|
| 1 | MAJOR (security) | **One import could stall the whole API.** Up to 1 000 lines of 2 000 characters were parsed on the event loop, and the parser is superlinear. A hostile 2 000-character line costs ~70 ms, so one request blocked about 70 s on a single worker, and it stored tens of MB of parses. | Lines are capped at 500 characters and lists at 100 000 characters (real lines are ≤ 40), and parsing runs in a worker thread. The worst case is now about a second of CPU, off the loop. The parser's own complexity and the missing body-size limit and rate limit are recorded as risks. |
| 2 | MAJOR (code) | **The quantity basis ignored the parser's signals.** `Лоран S M L 3 шт` could be `STATED` as S×3. A line with two counts, a negated count or a bare number could be `LINE_IMPLIES_ONE`. | A line naming several sizes or colours is `UNKNOWN_DISTRIBUTION`, with or without a slash. `LINE_IMPLIES_ONE` needs a line with no number that could be a count, read from the line's stored parse. |
| 3 | MAJOR (code) | **Moving the snapshot models out of `inventory` broke `StockLot`'s link to its list.** It could not resolve in a process that never imported `snapshots`. `test_inventory_scope_locking.py` run alone failed with `NoReferencedTableError`, and so would any script that creates lots. | `app/main.py`, `tests/conftest.py` and the three database scripts now import `app.models_registry`, as `migrations/env.py` already did. The file passes alone. |
| 4 | MINOR (security, concurrency) | **The client's `snapshot_id` was a global primary key.** Another organization's id answered 409 while GET answered 404, which revealed that the id exists. Two organizations importing one id at once raced to a 500. Every other command scopes `command_id` per organization. | `command_id` is unique per organization, the server chooses the primary key, and the lock is scoped the same way. Another organization using the same id simply gets its own list. Pinned by a sequential and a concurrent test. |
| 5 | MINOR (code, security) | **"Size not known" leaked outside the list.** A seller could create the regular size `UNSPECIFIED/UNKNOWN` and block it for the whole organization. Receipts and adjustments accepted it. «Фізично є» could add it, the double count in the other direction. | The catalog reserves the code, in any case. Receipts and positive adjustments refuse the size. «Фізично є» never adds it (`FOUND_AS_SIZE_NOT_KNOWN`). |
| 6 | MINOR (security) | **The list of lists leaked private lists.** It computed `has_more` before hiding them, so organization-wide readers could learn their count, status and order. | Private lists are filtered in the query, per warehouse, with the same authorization as a single read. |
| 7 | MINOR (security, concurrency) | **One list could hold 50 000 allocations** (1 000 lines × 50). An approval would hold the warehouse exclusively for all of them, and every read would load them. | At most 5 000 allocations per list. |
| 8 | MINOR (concurrency, code) | **I17 was enforced by shape only.** The public ledger door accepted a well-formed `OPENING_BALANCE` on a purchased lot with a made-up list, which skipped the lock and the history check. | `apply_movements` refuses `OPENING_BALANCE`, and only `apply_opening_balance` writes it. Trigger `opening_balance_traces_to_its_list` requires an opening lot of the named list at the same key. |
| 9 | MINOR (concurrency, code) | **The freeze trigger had gaps.** It checked only the old parent on UPDATE, so an allocation could be moved into an applied list. It also read the list's status without a lock. | It checks the list before and after, under `FOR SHARE`. `TRUNCATE` stays unguarded, like `0002`'s append-only triggers. |
| 10 | MINOR (concurrency) | **The sale guard read on-hand and reserved in two statements.** A dispatch committing between them could let a double count through. | One statement (`available_quantities`). |
| 11 | MINOR (code) | **A count of 2³¹ or more overflowed the row's integer column.** `Куртка 3000000000 шт` turned the whole import into a 500. | A count over 10 000 is kept as evidence, never as the line's total. |
| 12 | MINOR (code) | **Nothing stopped other modules importing `snapshots`.** Import-linter did not forbid it for `orders`, `identity`, `tenancy`, `audit` or `core`, though the ADRs say no module may. | Contract "nothing depends on the legacy list workflow" (14 contracts). |
| 13 | MINOR (code) | **The upgrade named only decided rows in its refusals.** A hand-written waiting line violating a new CHECK, or one line of evidence in two rows, failed on a raw constraint error. | A named refusal, with a test. |
| 14 | MINOR (code) | **Deleting a user named by a decided list fails.** Actor links are `SET NULL`, which the freeze trigger refuses on a decided list. | Kept, consistent with `stock_movement` and `audit_log`. The app never hard-deletes users or organizations. Documented. |
| — | NOTE | Three small defects:<br>• `snapshot.applied` did not record `acting_store_id`;<br>• an error docstring named an unused reason;<br>• a comment said every command takes the warehouse lock. Order cancellation does not, harmlessly. | Fixed. |

**Checked and found sound by the reviewers:**

- **Authorization.** Every route re-checks before any replay (I13): import retry, approval replay, repeated rejection and a no-op resolution. The permission matrix matches ADR-0005 §9. The private-warehouse rule holds, and tenants get 404 across organizations.
- **Stock writers and locks.**
  - Every stock writer goes through `lock_stock`, and there is no lock-order cycle with sales, refunds, transfers or orders.
  - Taking the lock exclusively and then shared within one transaction is safe.
  - The history check sees every committed writer.
- **The list workflow.**
  - Approval replay and revision handling are correct.
  - Resolution locks and deletes before it inserts.
  - The migration takes its lock before its checks.
- **Audit.** Complete, and it logs no request body.

The reviewers ran nothing against a database. The implementer ran everything above against PostgreSQL 17.11.

## 8. Not verified

- **Hosted CI** — nothing is pushed.
- **Frontend and Playwright E2E** — not rerun. This increment changes no frontend code, and there is no UI for it yet. The backend order and sale flows under the new warehouse lock are covered by the integration suite.
- **Load / p95** — the extra shared advisory lock is on the `POST /sales` path, whose p95 budget has never been measured (owed since M1-029). Nor is the time an approval holds its warehouse at the 5 000-allocation cap.
- **Old and new code side by side** — not exercised. The migration's maintenance window assumes no older instance runs.
- **Real legacy lists** — `data/legacy/raw/` is empty on this machine. The real-row corpus in the fixtures has 44 product-only lines; no real list was imported.
- **Telegram devices, production deployment, restore drill** — gate M1D.

## 9. Questions for the owner

None blocks. The defaults in force are conservative and pinned by tests.

1. **Opening a warehouse.** An opening balance is accepted only into a warehouse with no stock history. Any receipt, sale, «фізично є» or transfer before approval closes the door for good, because the ledger is append-only. Is that right? The alternatives:
   - allow the approval only while the warehouse is paused (which contradicts "paused = no stock operations");
   - grant `can_sell` only after the list is approved (an operational rule);
   - treat the list as a stocktake that corrects a tracked warehouse to the count (a different command, which can reduce stock).
2. **The list's date.** Sales on paper between the date of the count and the approval are not in the opening balance. Should the list be recounted just before approval, or should those sales be entered first some other way?
3. **Lines without a count.** Does a line with no count mean exactly one piece? Today a reviewer must say so per line (`LINE_IMPLIES_ONE`), and the approver sees how many lines rest on it. Only a line with no number that could be a count qualifies; `Куртка 1636` or `Куртка 46` needs a note.
4. **Selling "size not known" stock.** Today «фізично є» on a sized unit is refused while the same model is held with size not known, and the seller sells it as size not known. «Фізично є» never adds size-not-known stock, and receipts refuse it. Should the seller instead be allowed to reclassify one unit to the size at the counter — an audited pair of movements, bounded to that unit?
5. **Private warehouses.** Who approves a list for a child store's own warehouse? By default nobody can: the owner's grant is organization-wide, which the private rule does not accept, and the child manager lacks `snapshot:approve`. Options:
   - give the owner a direct membership in the child store;
   - give the child manager `snapshot:approve`;
   - let organization-wide approval reach private warehouses for this one command.
