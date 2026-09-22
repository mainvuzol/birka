# M1-018 — transfers between warehouses — 2026-09-22

Status: **implemented, independently reviewed, every review finding fixed or put to the owner, verified on real PostgreSQL 17.11.** Branch `feat/m1-018-transfers`, local commits only: not pushed, not merged. That step is the owner's.

Three independent reviews ran, each in a fresh context and each running its own probes against real PostgreSQL without changing the repository: security and tenancy, concurrency and the ledger, migration and domain. **None found a blocking defect.** Between them they found five major and ten minor issues. §7 lists every one and what was done about it.

## 1. What it does

`POST /api/v1/transfers` moves goods from one stock location to another. It writes, in one transaction:

- a `TRANSFER_OUT` at the source and a matching `TRANSFER_IN` at the destination;
- a `transfer` row, and one `transfer_item` per product and size;
- one audit entry;

and nothing else. No sale, no money, no revenue (invariant I16).

```text
POST /api/v1/transfers
Idempotency-Key: <7-day cache key>
{
  "store_id":         <the store on whose authority the goods move>,
  "command_id":       <permanent, client-generated>,
  "from_location_id": <source warehouse>,
  "to_location_id":   <destination warehouse>,
  "lines": [ { "product_variant_id", "size_id", "quantity" } ]    1..100 lines, quantity 1..1000
}
→ 201 { id, store_id, from_location_id, to_location_id, status: "RECEIVED",
        sent_at, received_at, items[], movements[] }
```

**All or nothing, decided before anything is written.** Before the first row is written, every product, size and warehouse and the acting store are validated, and every stock key is locked. The source is then checked under those locks. A shortfall refuses the whole transfer with `409 INSUFFICIENT_STOCK`, which names the warehouse and has `correctable: false`, and there is nothing in the transaction to undo. Goods are never partly moved, and a shortfall is never made up from another warehouse.

Every refusal leaves no transfer, no ledger row and no idempotency claim:

| Answer | When |
|---|---|
| `403 FORBIDDEN_STORE` | the store is not one of the person's, or is no longer trading. The scope is rebuilt from the database on every request |
| `403 PERMISSION_DENIED` | the person does not hold `transfer:create` and `transfer:receive` in that store |
| `403 LOCATION_ACCESS_DENIED` | the store lacks `can_sell` at the source or `can_receive` at the destination; `details.capability` says which |
| `404 NOT_FOUND` | one of these is missing, belongs to another organization, or is a closed warehouse: a warehouse, a product or a size. Each kind gets one identical answer, so the response discloses nothing |
| `409 INSUFFICIENT_STOCK` | the source holds less than asked |
| `409 IDEMPOTENCY_CONFLICT` | the `command_id` was already used for a different request, or its original request can no longer be verified |
| `422` | any of these: the same warehouse at both ends; one product and size on two lines; a price or cost; a quantity that is not a strict integer from 1 to 1000; no lines, or more than 100 |

## 2. Choices made here, and which are the owner's to change

None of these is a new business rule. Each one is either written in the design or the conservative default where the owner has not decided. Each is a small change if the owner decides otherwise.

| Choice | Why | To change it |
|---|---|---|
| **Single-step.** The transfer is born `RECEIVED`, with `sent_at = received_at` | Assumption A8. Q5 ("transfer confirmation on receipt") is still open and blocks nothing. `DRAFT` and `SENT` already exist, so adding confirmation later changes the service, not the schema | Owner answers Q5 (question 1) |
| **The person needs `transfer:create` *and* `transfer:receive`** | In single-step mode the sender is also the receiver. Before the review, `transfer:receive` guarded nothing: an owner who removed it from a role would have seen no effect. Managers and owners hold both; sellers hold neither | When Q5 brings confirmation, `transfer:receive` moves to the receiving side |
| **The store needs `can_sell` at the source and `can_receive` at the destination** | Design §1.6, marked **[PROPOSED]**. The owner confirmed `can_sell` for *selling*. Whether it should also let a store take goods *out* has not been decided. A test pins today's behaviour | Owner question 2 |
| **A manager whose stores reach neither warehouse is refused** | Design §1.6 leaves this as a roles question. Refusing is the side that cannot move goods nobody authorised | Owner question 5 |
| **The initiating store is recorded as the acting store** on both ledger legs | The ledger allows a transfer to name no store, for a move no store is responsible for. This one has a store. Recording it also keeps the rule every stock command already follows (a store that is not trading moves no goods) instead of inventing a new one. This supersedes the M1-029 report's expectation that a transfer "no single store owns" | — |
| **A closed warehouse can be neither source nor destination** | Every stock command already follows this rule. Design §1.11 proposed "transferable-out", marked **[PROPOSED]**; that is not built. The owner has not said what closing a warehouse means, and asked that closed stores' operations, transfers included, be defined before they are built (owner decisions 2026-09-15 §2). Nothing in the application closes a warehouse today | Owner question 3 |
| **One line per product and size** | If a client sent two lines for the same goods, the server would have to add them up into a transfer nobody wrote down | — |
| **No price, cost or note** on a transfer | A transfer moves goods, never money. The table has no place for a note, and none was asked for | — |

**The first version of this work misattributed the closed-warehouse rule.** It said the owner's own words were that closing a warehouse "freezes it". That sentence is M1-029's engineering wording about *reads* in `business-rules.md`, not something the owner said; the domain reviewer traced it with `git log -L`. The attribution is corrected in the code, the tests and `business-rules.md`, and the question goes to the owner below.

**Who can move what today,** with the default roles and access rows:

- `transfer:create` and `transfer:receive` are manager and owner permissions. A seller cannot move goods at all.
- The owner's shape: both stores sell from the shared warehouse, and the child store also has its own. With design §3's access rows, a manager of the child store can move goods from the shared warehouse to the child's.
- Moving goods from the child's warehouse back to the shared one needs one of two grants:
  - the child store gets `can_receive` at the shared warehouse, which also opens receipts, adjustments and refund restocks there; or
  - the primary store gets `can_sell` at the child's warehouse.

  There is no grant specific to transfers.

Every one of these is an access row: data the owner controls, not code.

## 3. Invariant I24: what is enforced and what is not

I24 has two halves.

**1. A transfer is always a pair. Enforced, at the one door every stock change goes through.** `inventory.apply_movements` refuses the following for any caller:

- a `TRANSFER_OUT` without its `TRANSFER_IN`, or the reverse;
- two legs at the same location;
- legs of unequal size;
- legs that do not name their transfer;
- legs of two different transfers posing as one pair.

So both legs of a transfer *must* go through one call, and that also makes them one globally sorted lock batch. The deadlock rule of ADR-0004 §2.5 is therefore enforced by the ledger, not by the transfer service remembering it.

**2. "Nothing else is a disguised transfer". Deliberately not enforced by a check.** The natural rule is "no increase at one location beside a decrease at another". It was implemented, and it **refused a real sale** when the full suite ran. That sale was the owner-approved M1-030 basket:

- it confirms two coats on one shelf (`FOUND_DURING_SALE`, +2);
- it finds one coat missing from another shelf (`MISSING_AT_SALE`, −1).

Those are two bounded observations (I18, I25), not a move. The sale also writes its corrections in one `apply_movements` call and its lines in another, so the door never sees a whole command anyway. The rule was removed, and a unit test pins that exact call so the rule is not added back. As the plan and ADR-0004 worded it, the clause would even have flagged an ordinary sale that confirms a found coat at one warehouse while selling at another.

The second half holds by construction:

- The transfer command is the only writer of transfer movements.
- `sales` may not import `transfers` (a new import contract).
- Apart from the transfer, no command raises one location's balance while lowering another's:
  - receipts and refund restocks only add;
  - an adjustment is one line;
  - a sale's corrections are capped at the shortfall it consumes at the same stock key.

A new stock command must be reviewed against this. If a mechanical check is ever wanted, the cheap place is a per-location check inside the sale command that the net change is ≤ 0. The sale command holds both of its ledger calls. The plan's I24 row and ADR-0004 §2.7 are restated to say exactly this.

## 4. Migration `0008_transfer_replay`

- **New columns.** `transfer.command_fingerprint` and `transfer.response_snapshot` are **nullable**, for the reason `0004` gives: a NOT NULL column cannot be added back over existing rows after a downgrade.
  - A NULL fingerprint can only occur after `0008` is rolled back and re-applied.
  - A retry of such a transfer is answered with `409 IDEMPOTENCY_CONFLICT`, never with a second transfer (tested).
- **Composite foreign keys.** The transfer's three references (both warehouses and the initiating store) are now bound through `organization_id`.
  - This matches the other tables that carry an `organization_id` beside a location: `stock_movement`, `stock_lot`, `inventory_snapshot` and `store_location_access` (ADR-0004 §2.2).
  - The database refuses a transfer row that names another organization's warehouse or store. Each of the three references is tested.
- **Downgrade.** `downgrade()` restores the single-column keys under the exact names that `0006`'s own downgrade drops and renames.

What was verified:

- Here: base → head with `alembic check` clean, then head → base → head with `alembic check` clean again.
- By the migration reviewer:
  - head → 0007 → head over a real transfer row. The row survives, its fingerprint and snapshot come back NULL, and a retry gets a 409 with nothing moving twice.
  - A database downgraded to 0007 matches, constraint for constraint, one migrated straight to 0007.

**Rollback bound.** Rolling back below `0007` is limited by `0006`, not by this migration:

- `0006`'s downgrade puts stock back under stores only while every store maps to exactly one warehouse.
- Every transfer needs a store that reaches two warehouses. While the access rows still show that, `0006` refuses and says why.
- If the access rows were edited back to one-to-one while transfer rows remain, `0006` instead fails when it re-adds `transfer.to_store_id` as `NOT NULL`. The failure happens inside its own transaction, so nothing is half-applied, but the operator gets a database error rather than a reason.

Prefer rolling back application code and keeping the schema, as ADR-0003 already says.

## 5. Changed files

**New:**

- `backend/app/api/v1/transfers.py`
- `backend/app/modules/transfers/service.py`
- `backend/migrations/versions/0008_transfer_command_replay.py`
- `backend/tests/integration/test_transfer_command.py`
- this report

**Changed code:**

- `backend/app/modules/inventory/service.py`:
  - `validate_location_flows` (the I24 pairing check), called from `apply_movements`;
  - `InsufficientStockError` names the location, and is `correctable` only for a sale;
  - `TRANSFER_REFERENCE` and `transfer_movement_ids`.
- `backend/app/modules/inventory/repository.py`: `transfer_movement_ids`.
- `backend/app/modules/transfers/models.py`: the composite foreign keys and the two new columns.
- `backend/app/modules/tenancy/service.py`: docstrings only (the closed-warehouse wording and an ADR citation).
- `backend/app/api/v1/router.py`: mounts the new router.
- `backend/pyproject.toml`: two import contracts.
  - Transfers may not import sales, refunds, catalog or identity.
  - Sales may not import refunds or transfers.

**Changed tests:**

- `backend/tests/unit/test_inventory_service.py` and `backend/tests/integration/test_inventory_service_behaviour.py`: I24 at the door, and `correctable`.
- `backend/tests/unit/test_migration_history_is_frozen.py`: `0007` is frozen. Digests are now taken of the file as git stores it (LF line endings). This also fixes seven tests that were permanently red on a Windows checkout.
- `test_product_lifecycle_api.py`, `test_sale_command.py`, `test_shared_warehouse.py`, `test_transfer_command.py`: test Telegram ids (see §6).

**Changed docs:**

- `milestone-1-plan.md`
- `current-milestone.md`
- `business-rules.md`
- `known-risks.md`
- `ADR-0004-stock-locations.md`: a note in §2.2, and I24 in §2.7
- `m1-018-stock-location-design.md`: the status line and a §1.11 note

## 6. Verification

Real PostgreSQL 17.11: a portable, isolated cluster on a non-standard port with ICU `uk-UA`. Results after the review fixes:

| Check | Result |
|---|---|
| Full backend suite (`pytest -q`, fresh database) | **475 passed, 0 skipped**. The two warnings are third-party deprecations in `starlette.testclient`, unrelated to this change |
| Transfer suite | **47 passed** (36 before the review), then 14 more consecutive runs of the whole file, all green |
| `ruff check .` / `ruff format --check .` | clean, 102 files |
| `mypy app scripts` | no issues, 59 source files |
| `lint-imports` | 11 contracts kept, 0 broken |
| Migrations | base → head (8 revisions), `alembic check` clean. head → base → head, `alembic check` clean |
| Deliberate defects | **22 of 22 caught** |

**Deliberate defects.** Each guard was broken on its own and the suite run against it: the transfer, inventory-behaviour and inventory unit suites, all database-backed. There were 16 defects before the review and 6 added after it. Every one was caught, each by the test written for it:

| Defect | Caught by |
|---|---|
| Router: no source check; no destination check; no `transfer:create`; no `transfer:receive` | the replay-revocation tests, one per guard |
| Service: no source check; no destination check | `test_the_service_refuses_a_store_without_access_without_the_router[source/destination]` |
| Service: no `transfer:create`; no `transfer:receive` | `test_the_service_refuses_a_person_without_either_permission_without_the_router[…]` |
| Service: no advisory lock on the permanent command | `test_the_same_command_arriving_twice_at_once_is_serialized` |
| Service: the shortfall is not decided before writing | `test_a_shortfall_leaves_nothing_even_for_a_caller_that_commits` |
| Repository: a transfer's legs are not filtered by the transfer | `test_each_transfer_answers_with_its_own_legs_only` |
| Service: source, destination or quantity missing from the permanent fingerprint | `test_the_same_command_with_a_different_move_is_a_conflict[…]` |
| Service: no durable replay | 7 tests |
| Service: no acting store; born `SENT`; no audit entry | `test_a_transfer_moves_goods_between_warehouses_and_nothing_else` |
| Service: duplicate lines accepted | `test_one_product_and_size_twice_in_one_transfer_is_refused` |
| Inventory: every shortfall offers a correction | `test_only_a_sale_shortfall_offers_a_correction` |
| Inventory: the ledger's door does not check transfer pairs | `test_half_a_transfer_is_refused_at_the_door_and_leaves_no_trace` |
| Inventory: stock locked in request order, not sorted | `test_opposing_transfers_all_complete_without_deadlock` |

**One intermittent failure, found and fixed.** One run of the transfer suite failed a single test and could not be reproduced by re-running.

- **Cause.** The PostgreSQL log shows it at that exact second: `duplicate key value violates unique constraint "uq_app_user_telegram_user_id"`. Four test files drew each test user's Telegram id from `uuid4().int % 10_000_000`, only ten million values, against a column that is unique across the whole table.
- **How likely.** A full run on a clean database creates 276 users, so a collision happens in about one run in 260. On a database that keeps its rows, as a local one does, the odds grow with every run.
- **Fix.** Ids now come from 2⁶² values.

This was not a product defect, and it already existed in three of the four files.

**The lock-wait checks now ask PostgreSQL.** Before, the two race tests "proved" that one side waited by sleeping 0.4 s and checking that it had not finished. A slow machine produces the same result. Now they check that some backend has an ungranted lock that `pg_blocking_pids` attributes to the holder.

The first version of that check read `pg_stat_activity`. A backend snapshots that view once per transaction, so it could never see the session it was waiting for, and both tests failed. The check now reads `pg_locks`, which is read fresh on every query.

## 7. Independent review: findings and what was done

| # | Severity | Finding | Found by | Done |
|---|---|---|---|---|
| 1 | MAJOR | A made-up product or size id gave **500**, while another organization's id gave 404. So the status code told a caller whether an id exists in another organization. The cause: the lines were written before the ids were checked, and the database's own foreign key answered first | security, concurrency | Everything is validated and every stock key is locked before the first row is written, in the same order the sale command uses. `test_an_unknown_product_or_size_is_refused_exactly_like_a_foreign_one` checks that made-up and foreign ids get identical 404 bodies |
| 2 | MAJOR | `can_sell` at the source lets a store take goods out without limit, one way. The rule is a design proposal, and the code cited a section that ADR-0004 does not have | security, domain | Kept, because it is exactly design §1.6, but no longer presented as decided. The citation is fixed, `test_can_sell_alone_at_the_source_is_enough_to_move_goods_out` pins it, and it is owner question 2 |
| 3 | MAJOR | The advisory lock on the permanent command was untested. Removing it left every test green, yet in reality turned an ordinary concurrent retry into a 500 | concurrency, domain | `test_the_same_command_arriving_twice_at_once_is_serialized` proves the wait through `pg_blocking_pids` |
| 4 | MAJOR | The closed-warehouse refusal was attributed to the owner, who never said it, and "recorded as an open question" was not true | domain | Attribution corrected in code, tests and `business-rules.md`. ADR-0004 §2.2, design §1.11 and `tenancy/service.py` updated. Owner question 3 |
| 5 | MAJOR | I24 was overclaimed in the code: it said a move "dressed up as anything else" is refused, and a probe showed it is not. The plan and the ADR misstated it too, in both directions | domain, concurrency | Code, the plan's row and ADR-0004 §2.7 restated (§3). New import contract: `sales` may not import `transfers` |
| 6 | MINOR | `transfer:receive` guarded nothing | security | Required in single-step mode, in both the router and the service. Tested over HTTP, at the service directly, and on replay |
| 7 | MINOR | All or nothing depended on the caller rolling back. When the destination sorted first, a caller that caught the shortfall and committed would have saved a lone `TRANSFER_IN` | concurrency | Fixed by #1: the shortfall is decided before anything is written. `test_a_shortfall_leaves_nothing_even_for_a_caller_that_commits` deliberately commits after the error |
| 8 | MINOR | "Lock order identical to the sale's" was not true: the transfer's inserts took foreign-key share locks before the inventory locks | concurrency | Fixed by #1. The docstring now states the order as it is |
| 9 | MINOR | Dropping the `reference_id` filter left every test green, and the NULL-fingerprint path had no test | domain | `test_each_transfer_answers_with_its_own_legs_only` uses two transfers and checks both the first answer and a durable replay rebuilt from rows. `test_a_transfer_whose_original_request_cannot_be_verified_is_not_guessed` covers the NULL fingerprint |
| 10 | MINOR | `0008`'s docstring made four false claims: that every other table has composite keys (three do not), that `0006` "refuses" (not always), that a report exists (it did not), and that "the table is empty" (not on re-upgrade) | domain | Rewritten |
| 11 | MINOR | `make_shops` called its default "the confirmed shape", but it gives the child store `can_receive` at the shared warehouse, which the owner never confirmed | domain | The docstring now separates what is confirmed from the test default |
| 12 | MINOR | Nothing forbade `sales → transfers`. This predates M1-018 | domain | New contract: "a sale neither refunds nor transfers" |
| 13 | MINOR | The governance docs were not updated | domain | Updated (§5) |
| 14 | MINOR | `IDEMPOTENCY_CONFLICT` can disclose a `transfer_id` to someone who still holds `transfer:create` in the original store after that store lost access to the warehouse | security | Accepted. Sales and refunds use the same pattern, and no endpoint reads a transfer. Recorded |
| 15 | MINOR | A deactivated store's replay is refused only because real requests rebuild the scope from the database. A hand-built scope would replay | security | Accepted, because HTTP always rebuilds the scope. Recorded in `known-risks.md` for the future Telegram handler |

The reviewers also checked the following and found it sound:

- **Lock order and deadlocks.** No deadlock under opposing, three-warehouse cyclic and cross-command overlaps.
- **Duplicate commands.** 30 simultaneous duplicate pairs produced exactly one transfer per command.
- **Audit figures.** Exact.
- **Durable replay.** Byte-identical, whether served from the stored snapshot or rebuilt from rows.
- **Input validation.** 17 malformed quantity values and every malformed request body were refused with 422.
- **Refusal responses.** Identical 404s for foreign, made-up and closed warehouses.
- **Tenancy.** `command_id` and `Idempotency-Key` are scoped per organization.

## 8. Not verified

- **The Compose PostgreSQL image.** This run used portable PostgreSQL 17.11 on Windows with `--locale=C`, because Windows has no `C.UTF-8`. The ICU `uk-UA` collation is identical to production; the libc fallback is not exercised.
- **CI.** Nothing was pushed, so GitHub Actions has not run this branch.
- **Load.** There is no p95 measurement for `POST /transfers`, and the `POST /sales` p95 is still owed from M1-029.
- **Client and E2E.** There is no transfer screen yet; that is gate M1D.

## 9. Questions for the owner

1. **Q5: should the receiving side confirm arrival?** Today a transfer is recorded as arrived the moment it leaves. If yes, a transfer becomes two steps (`SENT`, then `RECEIVED`), and `transfer:receive` belongs to the receiving side.
2. **May a store that can only *sell* from a warehouse also move goods out of it?** Today it may (design §1.6). With design §3's access rows, the child store can then move the whole shared pile into its own warehouse, and neither store can move it back. The alternative is a separate "may take goods out" grant.
3. **What does closing a warehouse mean?** Today a closed warehouse can be neither source nor destination, and its stock stays visible. Should it be possible to empty one by transfer, as the design proposed? This belongs with the store-states permission matrix you asked for.
4. **Should goods be able to go back from the child's warehouse to the shared one?** That needs one of two grants: the child store may *receive* at the shared warehouse (which also opens deliveries, adjustments and refund restocks there), or the primary store may *sell* from the child's warehouse. There is no transfer-only grant.
5. **May an organization-wide manager move goods between warehouses that none of their own stores reaches?** Today they may not.
