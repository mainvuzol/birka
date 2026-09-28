# ADR-0005 — Legacy snapshot import and opening balances

Status: **Accepted, 2026-09-28 (M1-023).** Implemented and verified. See the [M1-023 report](../project-memory/m1-023-snapshot-import-report.md).

An independent design review found two major defects in the first draft, and three consequences that needed a guard or an owner decision. All five are resolved below; the review is summarised in the report.

Three independent reviews of the implementation followed: code, concurrency and ledger, and security and tenancy. They found three major issues and a dozen minor ones, none blocking. Every fix is folded in below and marked *(code review)*.

## Context

Gate M1C closes on "the legacy lists are imported as traceable opening balances". Earlier decisions fix the rules:

- **What a list is.** A legacy availability list is an `InventorySnapshot`, never reconstructed history. Approved rows produce **only** `OPENING_BALANCE` movements (invariant I17, constitution §27).
- **Evidence.** Every original line is kept verbatim, including lines nobody can interpret (`.ai/workflows/legacy-inventory-snapshot-import.md`).
- **No invented distributions.** A size or colour distribution is never invented, and `UNKNOWN_DISTRIBUTION` blocks approval (plan §12). "Size not known" is a real, stockable size for legacy goods (F34).
- **Where it lands.** Stock is keyed by `(location, variant, size)` (ADR-0004); the list describes the place that was counted.
- **Whose decision.** The owner has not decided whether existing balances will be imported at all (owner decisions 2026-09-17). M1-023 builds the capability; running it on real data stays the owner's decision.

The schema shipped in `0002` (`inventory_snapshot`, `inventory_snapshot_row`) predates both the stock-location re-key and any real reading of a legacy list. It has two gaps that matter:

- A row can resolve to exactly one `(variant, size)`, but a legacy line very often lists several sizes of one model ("Бомбер шоколад S M L").
- Nothing identifies the store or the person acting, or makes a retry safe.

Nothing has ever written either table, so this is the cheap moment to fix them.

## Decision

### 1. A module of its own

`app.modules.snapshots` owns the three snapshot tables and the workflow. It writes raw evidence **through catalog** (`catalog.raw_lines`) and stock **through inventory** (`inventory.service.apply_opening_balance`), as a sale does. Lots, movements and the history check stay inside `inventory`. Putting the workflow inside `inventory` would have meant `inventory → catalog` writes, which ADR-0001 limits to reads.

Permitted edges: `snapshots → inventory, catalog, authz, tenancy, core (+ audit)`. No other module may import it. The import-linter contracts ship with the module (ADR-0001 rule 5). ADR-0001's module list is amended accordingly.

### 2. Evidence first, interpretation beside it

Import stores every line as an append-only `RawInput` (`source_kind = SNAPSHOT_IMPORT`), a `ParseResult` from the pure parser, and one `inventory_snapshot_row`. The row's `quantity_total` / `quantity_state` summarise **what the line said**. They are evidence, not the answer, and are never overwritten.

- A line naming several sizes or colours is `UNKNOWN_DISTRIBUTION`, with or without a slash. For example, `Лама бежевая/персик/butter 3 шт` and `Лоран S M L 3 шт` are both total 3, split unknown *(code review)*.
- A count no stock could be (over 10 000) is kept as evidence and never taken as the line's total *(code review)*.
- Lines with identical text are shown as repeats. Which kind of repeat it is — one line per piece, or a transcription slip — only a person can say.

An import holds at most 1 000 lines, 500 characters per line and 100 000 characters in all. Its lines are parsed in a worker thread, because the parser's cost grows faster than a line's length. Real lines are a few dozen characters. *(security review)*

Import writes no catalog identity, no match decision, no stock and no alias.

### 3. A person states the answer, and where its numbers came from

A row is resolved in one of two ways.

**Allocations.** One or more `(variant, size, quantity)` stated explicitly (`inventory_snapshot_allocation`), with a **quantity basis**:

- `STATED`: exactly the one count the line states, in one allocation. A split across sizes or colours is never "stated", because the parser reads no per-size counts.
- `LINE_IMPLIES_ONE`: a line with no number that could be a count, taken as one piece. This is a convention, recorded as one, pending the owner (question 3). It excludes:
  - a line in which the parser found any quantity, however unsure — two counts, or a negated one;
  - a line with a number the parser could not classify (`3 куртки`, `Куртка 1636`). Such a number may be a count, a size or an item code, so it needs a note *(code review)*.
- `RECOUNTED` or `OWNER_KNOWLEDGE`: anything, with a note saying who counted or how it is known. This is also the only way to answer an `UNKNOWN_DISTRIBUTION` line, or to differ from what a line states.

The approver sees how many lines and units rest on each basis.

"Size not known" is a legal size here, and here only, because this is the one place its evidence exists (F34). Enforced elsewhere *(code review)*:

- the catalog refuses its code (`UNSPECIFIED` / `UNKNOWN`, in any case);
- receipts and positive adjustments refuse the size;
- «фізично є» never adds it (§7).

A list takes at most 5 000 allocations in all. That bounds the approval, which holds the warehouse exclusively, and every read of what the list became *(security review)*.

**Skip.** The line is not stock (a heading, a note, goods that are gone), with a written reason.

Identity is chosen by a person holding `snapshot:import`. The matcher's candidates are only a hint, read through the existing read-only preview. A row may be re-resolved until the list is decided. Every change is audited with before and after, and bumps the list's `review_revision`.

**Why not `CatalogMatchDecision` per line.** Confirming a decision requires the catalog knowledge revision to be unchanged since the proposal. Reviewing a legacy list means creating products for many of its lines, and each creation advances that revision, so every other pending line would go stale.

### 4. Approval applies the whole list or nothing

`POST /snapshots/{id}/approve` requires all of the following:

- `snapshot:approve` (owner by default) in the list's store;
- `can_receive` at the warehouse, and the private-warehouse rule;
- an active store and warehouse;
- the `review_revision` the approver looked at;
- every row resolved or skipped, and at least one allocation;
- every allocated variant still active.

It writes one `StockLot` (`acquisition_type = OPENING_BALANCE`, linked to the list) and one `OPENING_BALANCE` movement per allocation, in one call to the ledger. It then verifies every key's resulting quantity against what was allocated to it, and links each allocation to its lot. The list becomes `APPLIED`, with the approver and the time.

### 5. An opening balance opens a warehouse's ledger — once, and nothing can slip in beside it

Approval is refused with `OPENING_BALANCE_CONFLICT` if the warehouse already has **any** stock movement or non-zero balance, including an earlier list. `inventory` enforces this, because it is a ledger rule. A balance counted on paper cannot be added to a warehouse the app already tracks without counting twice what it already knows. Correcting a tracked warehouse to a count is a stocktake: it can go down as well as up, and it is not an opening balance.

**Concurrency** (fixes the review's first finding). The first draft locked only the list's own stock keys. A receipt, transfer or «фізично є» on *another* key at the same warehouse could therefore commit between the history check and the approval — exactly the "size not known beside sized stock" case that motivates a per-warehouse rule. Now:

- Every command that moves or reserves stock takes a **shared** transaction advisory lock on each warehouse it touches, in `lock_stock`, before any row lock. Cancelling an order's reservation only lowers `reserved_quantity` under row locks; a live reservation already means history there.
- The opening balance takes the same lock **exclusively**, first. It waits for every in-flight command at that warehouse and admits none until it commits.

Shared locks never wait for each other, and all are taken in location order before any row lock, so stock commands cannot deadlock on them. Before the exclusive lock, the approval holds only its list's row, which no stock command touches.

### 6. An opening balance is only ever the answer to a list

This fixes the review's second finding.

- **Ledger door.** `apply_movements` refuses any `OPENING_BALANCE`. Only `apply_opening_balance` writes one, after the exclusive lock and the history check *(code review)*. The shape check (list and lot named) stays in `validate_movement`.
- **Database.** CHECK `opening_balance_names_its_list` on `stock_movement` states the shape. Trigger `opening_balance_traces_to_its_list` requires the movement's lot to be an opening lot of the very list it names, at the same organization and stock key *(code review)*. `stock_movement` is append-only, so checking the insert is enough.
- **Lots.** An `OPENING_BALANCE` lot must name its list (CHECK `opening_lot_names_its_list`). Its link becomes `RESTRICT`, so a list whose goods became stock cannot be deleted.
- **Receipts.** A receipt accepts only `PURCHASE`, `CONSIGNMENT` or `BORROWED`. Before this, any holder of `inventory:receive` could label a delivered lot `OPENING_BALANCE`, `TRANSFER`, `RETURN` or `ADJUSTMENT` — lots no such command produced. No client sent those values.

### 7. "Size not known" is never counted twice by «фізично є»

This addresses the review's third finding. Take a coat held as "size not known" that a seller sells as an M. The system shows zero for M, so a `FOUND_DURING_SALE` correction would add an M the list already counted. The size-unknown balance would then stay one too high, with nothing to ever notice.

The sale refuses that correction with `UNKNOWN_SIZE_STOCK` (409) while the same variant is available at that warehouse with size not known. The seller sells it as size not known, or someone reclassifies it first. Whether a seller may instead reclassify at the counter is owner question 4.

**The other direction** *(code review)*. «Фізично є» never adds a unit with size not known (`details.reason = FOUND_AS_SIZE_NOT_KNOWN`). Only a list states that size, and at the counter the coat is in hand, so its size can be read. A size-unknown unit added there could be the very M the ledger already counts.

The guard reads available stock in one statement *(concurrency review)*. Reading on-hand and reserved separately could pair a reservation from before a dispatch with a quantity from after it.

### 8. A decided list is frozen

Trigger `inventory_snapshot_is_final` refuses any change to an applied or rejected list, its rows or its allocations. That includes:

- deleting one;
- moving a row or an allocation into one — both the list before the change and the list after it are checked *(code review)*.

The list is read under a share lock, so a decision cannot commit between the check and the write. With CHECK `applied_names_place_and_store` and the `RESTRICT` lot link, the provenance of an opening balance cannot be rewritten after the fact.

Like the ledger's append-only triggers (`0002`), it guards rows, not `TRUNCATE`. For the same reason, hard-deleting a user or an organization that a decided list names is refused. The app never hard-deletes either.

### 9. Identity, retries and access

**Identity and retries.**

- **Import.** Identified by a client-generated `command_id`, unique within the organization, like a sale or a transfer (`uq_inventory_snapshot_org_command`); the primary key is the server's. It is a permanent identity with no expiring cache. A stored fingerprint tells a retry (which returns the list as it is now) from a changed request, which gets `409`. Another organization using the same command id simply gets another list. *(security and concurrency reviews)* The first design made the client id the primary key and answered `409` across organizations. That let one organization learn that another's id existed, and two simultaneous imports raced to a `500`.
- **Resolution.** A `PUT` of the line's full answer; repeating it is a no-op.
- **Approval.** Idempotent by status and revision. A replay rebuilds its result from the ledger.
- **Rejection.** Idempotent by status and reason.

Every replay re-checks current permissions first (I13).

**Access.**

| Action | Permission (in the list's store) | Warehouse access |
|---|---|---|
| Import | `snapshot:import` | `can_receive` and the private-warehouse rule |
| Review | `snapshot:import` | `can_receive` and the private-warehouse rule |
| Approve | `snapshot:approve` | `can_receive` and the private-warehouse rule |
| Read | either permission | reach only |
| Reject | either permission | reach only, so a list for a paused warehouse can still be abandoned |

The acting store is stored as `acting_store_id`: ADR-0004 retired `store_id` on this table, and `0006`'s downgrade recreates it.

The list of a store's lists leaves out a list at a warehouse the person may not see. It does so in the query itself, so neither the page nor `has_more` reveals it *(security review)*.

By default **nobody can approve a list for a child store's private warehouse**. The private rule wants the permission granted directly in the child store; the owner's grant is organization-wide, and the child manager lacks `snapshot:approve`. This is recorded as owner question 5, not changed silently.

### 10. Lock order

| Operation | Locks, in order |
|---|---|
| Import | advisory lock on `(organization, command_id)`, scoped exactly like the unique key |
| Resolution | list `FOR UPDATE`, then row `FOR UPDATE` |
| Approval | list `FOR UPDATE`; exclusive warehouse advisory lock; inventory keys in the global order; lots, movements, allocation links, and status last (the freeze trigger allows the links only while the list is under review) |
| Rejection | list `FOR UPDATE` |
| Every command that moves or reserves stock | shared warehouse advisory locks in location order, then inventory keys |

## Alternatives considered

- **One `(variant, size)` per row.** Rejected. A line listing three sizes could then only become "size unknown × 3", or be split by hand into three lines, which rewrites the evidence.
- **Additive opening balance.** Rejected: it double counts whatever the app already tracked.
- **Per-key history check.** Rejected: legacy "size not known" stock beside app-tracked sized stock would still double count.
- **Stocktake semantics.** A different operation that can remove stock; it is not an opening balance, and the owner has not decided on it.
- **Opening balance on a paused warehouse.** Pausing would guarantee an empty ledger during review. But the owner defined pausing as "no stock operations", so this is owner question 1 rather than a default.
- **One `CatalogMatchDecision` per line.** Rejected, because of the staleness described in §3.

## Consequences

Positive:

- The legacy list stays verbatim, beside what the parser read, what a person decided and on what basis. Each opening lot traces to its source line.
- Invariant I17 now has database teeth. No lot can claim to be an opening balance without naming its list, and no movement can do so without coming from an opening lot of the list it names. Only the approval writes one: the rule that a warehouse is opened only once, into an empty ledger, is service-enforced under the warehouse lock.
- Identity confirmed line by line produces human-labelled data, which the catalog evaluation currently lacks.

Negative:

- **One-way opening.** A warehouse that has recorded anything cannot take an opening balance. With the seed granting `can_sell` from day one, a single «фізично є», receipt or transfer before approval closes that door for good, since the ledger is append-only. Warehouses holding test data can never take one. Several documents for one warehouse must go into one import. Paper sales between the count date and approval are not accounted for. (Owner question 1.)
- **Manual work.** Resolving a legacy list is manual, and this increment has no UI. Some lines that plainly mean one piece still need a note: a bare number or two counts may mean anything.
- **Sizes not known.** Goods loaded that way must be sold that way until the audited size reclassification (F34) gets a command.
- **Every stock command takes one more lock.** It is a shared advisory lock per warehouse — cheap, but on the hot path. It has not been measured against the `POST /sales` p95 budget, which was itself never measured.

## Operational impact

**Migration `0015_snapshot_import`:**

- reshapes the three snapshot tables, including the per-organization `command_id`, which a list that predates it takes from its own id;
- adds the two ledger CHECKs, the trace trigger, the lot link change and the freeze trigger;
- refuses to run over any of these, none of which code before M1-023 wrote:
  - decisions it did not make;
  - waiting lines in a shape its CHECKs cannot hold;
  - `OPENING_BALANCE` lots that name no list;
  - `OPENING_BALANCE` movements.

Adding CHECKs to `stock_lot` and `stock_movement` scans both under an exclusive lock, so run it in a maintenance window.

**Downgrade** refuses while any list or line carries a decision. Otherwise it restores the `0002` shape; what it loses is stated in its docstring.

**Rolling back code while keeping the schema** is safe because no pre-0015 code reads these tables. The receipt restriction and the sale guard go back with the code.

**Deploy it with no older instance running.** Code before this revision takes no shared warehouse lock. An old instance writing stock while a new one approves a list would reopen the design review's first finding. The migration's maintenance window covers this *(concurrency review)*.

No new infrastructure.
