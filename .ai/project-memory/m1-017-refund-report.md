# M1-017 — Refund service and endpoint — 2026-09-15

Status: **implemented and locally verified; reviewed by two independent fresh-context reviewers; every blocking and major finding fixed.** This is not approval of gate M1C, and not a production release. Changes are local and uncommitted at the time of writing.

Gate M1C opens on one sentence: *mistakes are recoverable, goods move between stores, NL intake works on a real corpus, legacy lists are imported as traceable opening balances.* M1-017 delivers the first clause only — the return. M1-018 (transfers) and M1-020…M1-023 (catalog pipeline, legacy import) are untouched.

## What was built

`POST /sales/{sale_id}/refunds`, the refund command behind it, and revision `0004_refund_replay`.

The decisions inside it, and why they are what they are:

- **Money comes from history, never from the client.** A line's refund is its frozen `SaleItem.final_unit_price` times the quantity coming back. The request says *how many*, never *how much*; `amount` and `total_amount` are refused as unknown fields. Both operands are exact, so a full refund sums to exactly the sale's total with no rounding to reconcile.
- **The module may not import the catalog.** ADR-0001 permits `refunds → sales, inventory, authz, tenancy, core`, and a new import-linter contract (`refunds read history, not the catalog`) enforces it. Invariant I8 is therefore structural rather than a rule to remember: there is no path by which a later rename or re-price could reach a historical receipt. Catalog rows are reached *underneath* `inventory.service`, which checks that a stock key still exists before restocking — a present-day stock question, never a money or label one.
- **Over-refunding is prevented by a row lock, not by a read.** `refund ≤ sold − already refunded` (I9) is a check-then-act on the aggregate of every prior refund of that line. The sale's own `sale_item` rows are taken `FOR UPDATE`, in id order, before that aggregate is read. `EXPLAIN` confirms `LockRows` sits above the sort, so the rows really are locked in id order.
- **The whole receipt is locked, not only the lines being refunded.** Broader than I9 needs, and deliberate: one id order on every path is what makes the lock order provably identical between two refunds. The cost is that two returns from one receipt queue; the benefit is that they cannot deadlock.
- **The store comes from the sale.** It is not in the request. Letting a client name it would either be redundant or would quietly restock one shop from another shop's receipt — which is a transfer and has to be an explicit one (I16).
- **`restock` is stated, never defaulted, and strictly typed.** "Back on the rack" and "refunded and binned" are both ordinary, and the difference is stock that either exists or does not.
- **Command identity follows ADR-0003.** A permanent `command_id` with `UNIQUE (organization_id, command_id)` carries I20; `command_fingerprint` and `response_snapshot` let a retry arriving after the 7-day cache expires receive the original refund instead of a unique-violation 500. `sale_id` is folded into both fingerprints by hand because it is a path parameter, not a body field.
- **A closed store may give money back but has no shelf to put goods on.** Stated by the refund command rather than inherited from `lock_stock`, which refused it as "Unknown store" — wrong, and about a store the caller is standing in. **This split is an open question** (below).

## Verification

Run on 2026-09-15 on this machine. PostgreSQL was a disposable **16.2** cluster supplied by the `pgserver` wheel, created per check and dropped afterwards. Commands from `backend/`, executable prefix `/tmp/birka-review-venv/bin/`.

| Check | Command | Result |
|---|---|---|
| Full suite, real database | `BIRKA_TEST_DATABASE_URL=… pytest -q` | **354 passed, 0 skipped** (288 at `d85cc13` + 51 refund + 15 unstorable-text) |
| Suite without a database | `pytest -q` | 152 passed, 202 skipped — every skip explicit, none silent |
| Lint | `ruff check .` | clean |
| Format | `ruff format --check .` | 90 files, clean |
| Types | `mypy app` | 55 source files, no issues |
| Module boundaries | `lint-imports` | **9 contracts kept, 0 broken** (8 before, plus the refunds contract) |
| Migrations, fresh cluster | `alembic upgrade head` | 4 revisions applied to an empty database |
| Migration round trip, empty | `upgrade head` → `downgrade base` → `upgrade head` | 4 / 4 / 4 |
| **Migration round trip, with 31 real refunds** | `upgrade` → `downgrade 0003` → `upgrade head` | succeeds; 31 rows and `uq_refund_org_command` survive; fingerprints become NULL, which the service treats as unverifiable |
| Model drift | `alembic check` | no new upgrade operations |
| Live end-to-end over real HTTP | uvicorn on `127.0.0.1:8099` | Telegram sign-in → create product → receive → sell → refund → idempotent retry → sale unchanged → over-refund refused: **all checks passed** |
| Ledger reconciliation | `find_divergences` over the whole database | only the 2 deliberate I3 detection fixtures; **0 attributable to refunds** |
| Invariant sweep in SQL | see below | 0 violations |

The SQL sweep, run against the database after the full suite: refunded-beyond-sold (I9) **0**; refund amount disagreeing with the frozen sale price (I8) **0**; refund total disagreeing with its lines **0**; refund in a store other than the sale's **0**; currency mismatch **0**; orphan refund movements **0**; negative inventory (I1) **0**. 32 refunds and 30 `REFUND_RETURN` movements written.

### Tests are load-bearing, not decorative

Every guard below was deleted or neutralised and the suite re-run, to confirm the tests fail without it:

| Guard removed | Tests that fail |
|---|---|
| `.with_for_update()` on the sale lines | 3 concurrency tests, deterministically, 5 runs of 5 |
| `pg_advisory_xact_lock` on `(org, command_id)` | `test_the_same_command_arriving_twice_at_once_is_serialized` |
| `sale_id` from the **router** fingerprint | `test_one_key_cannot_replay_an_answer_about_a_different_sale` |
| `sale_id` from the **service** fingerprint | the same test |
| the duplicate-sale-line check | `test_one_sale_line_may_appear_only_once` |
| both router permission checks | `test_a_replay_is_refused_once_the_grant_is_gone` (a revoked seller got 201 from the cache) |
| the `SaleStatus.COMPLETED` guard | `test_only_a_completed_sale_can_be_refunded` |
| `reject_unstorable` | all 15 unstorable-text tests |
| a direct `catalog` import added to `refunds` | the import-linter contract breaks |

Three tests failed this exercise when first written and were rewritten:

- `test_one_key_cannot_replay_an_answer_about_a_different_sale` generated a fresh `command_id` per call, so the payloads differed anyway and the path parameter was never isolated. It now sends a byte-identical body to two different receipts.
- `test_a_replay_is_refused_once_the_grant_is_gone` revoked the whole membership, which `require_store` refuses from three places; it passed with the pre-claim permission check deleted. It now revokes only `sale:refund`.
- The unstorable-text tests imported their own poison from the module under test, so neutralising the guard neutralised the tests. They now build it from `chr(0)` and raw JSON escapes.

One test was renamed rather than fixed: `test_a_refund_and_a_sale_of_the_same_item_do_not_deadlock` could not fail as a deadlock test, because `POST /sales` never locks a `sale_item` row. It is now named for what it proves — that the two agree on the ledger — and the lock-order guarantee is carried by `test_the_sale_line_lock_covers_the_whole_receipt`.

## Independent review

Two fresh-context reviewers read the change against the governing documents and a live database, per `.ai/OPERATING_MANUAL.md` §6: a code/adversarial reviewer, and a security + concurrency/database reviewer. Neither wrote the code. Between them they ran roughly 170 tool invocations, including 125 concurrent refunds across randomised race shapes, refunds at READ COMMITTED / REPEATABLE READ / SERIALIZABLE against deliberately stale snapshots, and 80 mixed concurrent commands over shared stock keys while watching `pg_stat_database.deadlocks`.

Neither found a way to break I1, I3, I8, I9, I12, I20 or atomicity. Every finding below is fixed.

| Severity | Finding | Fix | Regression test |
|---|---|---|---|
| **MAJOR** | **Revision 0004 was a one-way door.** `command_fingerprint` was `NOT NULL`; `downgrade()` dropped it, and the re-`upgrade` then failed with `NotNullViolationError` on any database that had taken a refund. The docstring's justification — "no historical row exists" — is true exactly once, at first deploy | Column is nullable, exactly as ADR-0003 made it on `sale`. NULL means "this row's original request cannot be proven", and the service refuses to guess a match | `test_a_refund_whose_original_request_cannot_be_proven_is_not_guessed`; the with-data round trip above |
| **MAJOR** | **A durable replay returned the lines in a different order than the original.** Creation preserved request order; the rebuild ordered by sale line. A refund created off HTTP has no `response_snapshot` at all, so the rebuild is its only path | One builder, one canonical order, used by both paths. Movements are re-read through the same query creation writes them with | `test_a_rebuilt_multi_line_replay_matches_the_original_exactly` |
| **MAJOR** | **The advisory lock was load-bearing and untested.** Two requests with the same `command_id` and different cache keys are not stopped by the row lock — the second reads `refund WHERE command_id` before reaching it. Deleting the advisory lock left all 34 tests green and turned an ordinary retry into a unique-violation 500 | none needed; the lock was already correct | `test_the_same_command_arriving_twice_at_once_is_serialized`, which holds one transaction open and asserts the other is parked on a real lock |
| **MAJOR** | **The I13 test could not fail.** See above | test rewritten | `test_a_replay_is_refused_once_the_grant_is_gone` |
| **MAJOR** | **Text the database cannot store crashed with a 500.** A NUL byte, and separately a lone surrogate, reach the INSERT and raise from the driver *after* authorization and after the write has begun — raised at will by the lowest-privileged role. **Pre-existing and API-wide**, not introduced here: the `Idempotency-Key` header is claimed by every mutating endpoint | One shared helper, `app/core/text.py`, applied at every client-supplied text field and at the header, plus service-level checks so a non-HTTP caller gets the same refusal. A `RequestValidationError` handler was added because FastAPI's own 422 echoes the offending value and could not encode it | 15 tests in `test_nul_byte_rejection.py`, covering refund, sale, receipt, adjustment, catalog names, size codes, distinction notes and the header |
| **MAJOR** | **A closed store refunded money but refused the goods**, inheriting the refusal accidentally from `lock_stock` and reporting it as "Unknown store" | The refund command states the rule itself, with a message naming the real reason. Flagged as an open question below | `test_restocking_into_a_closed_store_is_refused_whole` |
| MINOR | **Retry required a stricter permission than creation.** Creating needed `sale:refund`; replaying needed `sale:refund` *and* `sale:view`, so a client that timed out could never learn the outcome of its own authorized refund | Replay requires `sale:refund`, the right that issued the command | `test_the_service_guards_that_http_never_reaches_still_hold` |
| MINOR | **`quantity` and `restock` were coerced, not validated.** `{"quantity": true}` refunded one unit; `{"restock": "yes"}` put goods back on the rack | `strict=True` on both | two parametrized tests, 10 cases |
| MINOR | Three service guards survived deletion with the suite green (`MAX_LINES`, non-bool `restock`, the replay permission check) | none needed | `test_the_service_guards_that_http_never_reaches_still_hold` |
| MINOR | `.ai/workflows/refund.md`'s "cross-store access rejected" case was not covered as written — only cross-*organization* was | — | `test_a_sale_in_a_sibling_store_cannot_be_refunded`, two stores in one organization, which is this business's actual shape |
| MINOR | The module docstring claimed refunds "cannot reach the catalog at all". They reach it transitively through `inventory.service` | wording corrected | — |
| MINOR | The documented lock order omitted its first rung, the router's idempotency-row insert | wording corrected | — |

### Confirmed correct, with evidence

Tenant isolation (a foreign receipt is a 404 revealing nothing; a foreign sale line is a 404; no cross-organization identifier in any payload). Authorization before the idempotency claim — a refused request leaves **zero** idempotency rows. `extra="forbid"` rejects injected `amount`, `total_amount`, `store_id`, `currency_code` and `actor_user_id`. No reachable `NUMERIC(12,2)` overflow: the sale's own cap transitively bounds the refund, verified at `9999999999.99 × 1`, `999999999.99 × 10`, `9999999.99 × 1000` and 100 lines × `99999999.99`. A rolled-back refund leaves no refund row *and* no idempotency row. Six concurrent requests with one `command_id` and six different keys → six 201s, one refund row, the same id returned to all six. Zero deadlocks across 80 mixed concurrent commands. No historical migration file modified. No error code invented outside the stable list. `sale_item.xmin` is unchanged by the `FOR UPDATE`, and `refund.xmin` is unchanged by a durable replay.

## Changed files

New: `backend/app/modules/refunds/service.py`, `backend/app/api/v1/refunds.py`, `backend/app/core/text.py`, `backend/migrations/versions/0004_refund_command_replay.py`, `backend/tests/integration/test_refund_command.py`, `backend/tests/integration/test_nul_byte_rejection.py`.

Modified: `backend/app/modules/refunds/models.py` (two replay columns), `backend/app/modules/inventory/{service,repository}.py` (`refund_return_movement_ids`), `backend/app/modules/tenancy/service.py` (`store_is_active`), `backend/app/api/v1/router.py` (wiring), `backend/app/main.py` (validation-error handler), `backend/pyproject.toml` (import-linter contract), and — for the shared unstorable-text fix — `backend/app/api/v1/{catalog,inventory,sales}.py` and `backend/app/modules/catalog/service.py`. Tests: `backend/tests/unit/test_m1b_schema_parity.py` (0004 added to the post-0002 column map), `backend/tests/integration/test_product_lifecycle_api.py` (the `SELLER` constant now reads the real matrix instead of a stale copy that was missing `sale:refund`).

## Migrations

`0004_refund_replay`, additive and reversible: `refund.command_fingerprint VARCHAR(64) NULL` and `refund.response_snapshot JSONB NULL`. No historical migration touched. No existing data rewritten. Downgrade preserves every refund row and `uq_refund_org_command`, so a downgraded database still cannot produce a duplicate refund; what it loses is exact replay for commands issued before the rollback, which become conflicts rather than replays.

## Open questions for the owner

Historical questions from implementation. The owner answered/refined them on 2026-09-15: see [confirmed decisions](owner-decisions-2026-09-15.md). The behavior below describes the implementation at review time, not the new target requirements. In particular, question4 was clarified as sale/payment modes, not approval of refund deductions.

1. **May a customer return goods to the other store?** Today a refund happens in the store of the sale, full stop. Restocking into a different store would move inventory between shops without a transfer, which I16 forbids. If returns to either shop are normal in practice, this needs a design (refund in store A, transfer to store B) rather than a relaxed check.
2. **Is "a closed store refunds money but takes no goods back" the right split?** The alternative is to refuse the refund outright and send the customer to the store that is still trading. Nothing sets `is_active = False` from the application yet, so this is reachable only by an operator today.
3. **May one return mix restocked and written-off units of the *same* sale line?** "Two coats back, one damaged" is a real case. Today it is two refund commands, which loses no data and bends no invariant, but it is clumsy. Because the answer is open, **no `UNIQUE (refund_id, sale_item_id)` constraint was added** — it would hard-code the restrictive answer into the schema and cost another migration to undo.
4. **May a refund ever return less money than was charged** (a restocking fee, a damaged-goods deduction)? Today, never: the amount is derived from the receipt. `restock=false` covers "we keep the goods" but still refunds in full.
5. **Is there a return window?** No document mentions one, so none is enforced. A sale from last year is refundable today.

## Known risks and deferred items

- **PostgreSQL 17 is not exercised.** Everything above ran on 16.2, the version bundled in the `pgserver` wheel; `project.md` and the compose file pin 17. Nothing in this change uses a 16/17 behavioural difference, but that is an argument, not evidence.
- **`docker compose up` has still never been run**, here or in CI. Unchanged by this task, and it remains M1A's open exit point.
- **No frontend.** The endpoint is reachable only by an API client; the seller's return flow is gate M1D.
- **A cross-store 403 discloses the sale's store id.** Same organization, unguessable UUID, so low impact — but unlike `POST /sales`, the store here is not client-supplied, so echoing it is genuine disclosure. It comes from `scope.require_store`, shared by every route; fixing it consistently is a separate change, not a refund-local patch.
- **`IDEMPOTENCY_CONFLICT` hands back a `refund_id` that cannot be fetched.** There is no `GET /refunds/{id}` — the plan's API table does not list one. Diagnostic value only.
- **A `command_id` reused across stores in one organization is refused permanently**, citing a command the caller knows nothing about. Refusing is correct — the unique constraint is org-wide, and a sale-scoped lookup would turn this into an unhandled integrity error — but the operator story is poor.
- **`IdempotencyRecord.expires_at` is written and never read.** Pre-existing and noted in the M1B report; the refund now depends on it equally. No purge job, so the "7-day cache" grows without bound, and a year-old record still replays from cache rather than the durable path.
- **Error responses remain absent from the OpenAPI schema.** The refund endpoint declares 201 and 422; its 403, 404 and 409 are real and tested but undiscoverable. Pre-existing across the whole API.
- **Test sessions use `autoflush=True` while production uses `autoflush=False`.** Pre-existing across the suite, not introduced here, but it means tests and production flush at different moments.
- **`SaleRequest` still lacks `extra="forbid"`**, which `RefundRequest` has. Noticed by a reviewer in passing; a change to an existing endpoint's contract and out of scope here.
- **Two refunds of one receipt serialize**, including refunds of different lines. Deliberate, and cheap at this shop's volume, but it is a throughput choice that should be revisited if returns ever become a hot path.

## Follow-up: validation error serialization — 2026-09-16

Fixed the remaining P2 from the subsequent review: malformed Unicode dictionary keys and nonfinite floats inside validation error details could still crash JSONResponse. `_encodable` now sanitizes dictionary keys as well as values, replaces NaN/Infinity with a JSON-safe description, and sanitizes fallback string representations. Invalid requests return422 rather than500; safe error input details remain unchanged. No catalog/stock/money writes or schema changes are introduced.

Changed: `backend/app/main.py`, `backend/tests/unit/test_app.py`, this report. Seven HTTP regressions use the real application auth endpoint without database writes: six reproduced failures before the fix, and the safe-input control passed.

Verification on temporary PostgreSQL16.2, Python3.12:
- From backend: `BIRKA_TEST_DATABASE_URL=postgresql+asyncpg://birka_review@127.0.0.1:55439/postgres /tmp/birka-review-venv/bin/pytest -q` — **361passed,0skipped**, two existing dependency deprecation warnings.
- `/tmp/birka-review-venv/bin/ruff check backend` from root — pass.
- From backend, same executable prefix: `ruff format --check .` —90files; `mypy app` —55source files; `lint-imports` —9kept/0broken.
- `git diff --check` — pass.

No migration needed. PostgreSQL17/Docker verification and owner-confirmed warehouse/payment extensions remain separate outstanding work. Fixes are local, not committed or pushed.

Independent read-only review of the final handler/test diff found no actionable correctness or security issues and approved the scoped P2 fix. Full-suite runtime evidence above was produced by the primary agent.
