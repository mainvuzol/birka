# ADR-0005 — Legacy snapshot import and opening balances

Status: **Accepted, 2026-09-28 (M1-023).** Implemented and verified. See the [M1-023 report](../project-memory/m1-023-snapshot-import-report.md). **Amended 2026-09-29** with the owner's answers to the five open questions (§11). **Amended 2026-10-08 by [ADR-0014](ADR-0014-opening-stock-from-a-json-file.md)** (the shops' existing stock from a parser's files): a list is filled by parts and a wrong file is removed (§2, §8–§10), its limits are measured (§2, §3), a split a file line's text shows is stated by size (§3), and several documents for one warehouse go into one list (Consequences).

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

A part — a pasted text or a parser's file — holds at most 1 000 lines, 500 characters per line and 100 000 characters in all; a list holds what ADR-0014 §10 measured: 5 000 lines not removed, in at most 1 000 parts. Its lines are parsed in a worker thread, because the parser's cost grows faster than a line's length. Real lines are a few dozen characters. *(security review; amended by ADR-0014)*

Import writes no catalog identity, no match decision, no stock and no alias.

### 3. A person states the answer, and where its numbers came from

A row is resolved in one of two ways.

**Allocations.** One or more `(variant, size, quantity)` stated explicitly (`inventory_snapshot_allocation`), with a **quantity basis**:

- `STATED`: exactly the one count the line states, in one allocation. A split across sizes or colours is never "stated", because the parser reads no per-size counts — except a split a file line's text shows, each size with its count (`STATED_BY_SIZE`, ADR-0014 §5; owner, 2026-10-08).
- `STATED_BY_SIZE`: only for a line from a parser's file whose text writes each size joined to its count by a sign («S-1 M-2 L-1», «Лоран M-3»). One model, one allocation per size, each with exactly its count; never preselected (ADR-0014 §5).
- `LINE_IMPLIES_ONE`: a line with no number that could be a count, taken as one piece. A count is never assumed: a person states it, and this basis records only that the line itself reads as one piece. The owner left this to what a correct system does (question 3, §11), and this is it. It excludes:
  - a line in which the parser found any quantity, however unsure — two counts, or a negated one;
  - a line with a number the parser could not classify (`3 куртки`, `Куртка 1636`). Such a number may be a count, a size or an item code, so it needs a note *(code review)*.
- `RECOUNTED` or `OWNER_KNOWLEDGE`: anything, with a note saying who counted or how it is known. This is also the only way to answer an `UNKNOWN_DISTRIBUTION` line, or to differ from what a line states.

The approver sees how many lines and units rest on each basis.

"Size not known" is a legal size here, and here only, because this is the one place its evidence exists (F34). Enforced elsewhere *(code review)*:

- the catalog refuses its code (`UNSPECIFIED` / `UNKNOWN`, in any case);
- receipts and positive adjustments refuse the size;
- «фізично є» never adds it (§7).

A list takes at most `MAX_LIST_ALLOCATIONS` allocations in all, 5 000, as measured (ADR-0014 §10). That bounds the approval, which holds the warehouse exclusively, and every read of what the list became *(security review)*.

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

The sale refuses that correction with `UNKNOWN_SIZE_STOCK` (409) while the same variant is available at that warehouse with size not known — counted after what the basket itself takes from that balance, so a basket that takes the last such coat may find another size *(2026-09-29 review)*. The seller says instead which size the coat is (§11), or sells it as size not known.

**The other direction** *(code review)*. «Фізично є» never adds a unit with size not known (`details.reason = FOUND_AS_SIZE_NOT_KNOWN`). Only a list states that size, and at the counter the coat is in hand, so its size can be read. A size-unknown unit added there could be the very M the ledger already counts.

The guard reads available stock in one statement *(concurrency review)*. Reading on-hand and reserved separately could pair a reservation from before a dispatch with a quantity from after it.

### 8. A decided list is frozen

Trigger `inventory_snapshot_is_final` refuses any change to an applied or rejected list, its rows or its allocations. That includes:

- deleting one;
- moving a row or an allocation into one — both the list before the change and the list after it are checked *(code review)*.

The list is read under a share lock, so a decision cannot commit between the check and the write. With CHECK `applied_names_place_and_store` and the `RESTRICT` lot link, the provenance of an opening balance cannot be rewritten after the fact.

**Parts are frozen with their list** (ADR-0014 §14). A list's parts are never deleted, and a decided list's parts never change. A removed part is final: its rows become `REMOVED`, keep their evidence and take no allocation, and it never comes back; the same file comes back only as a new part.

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
| Add a part, a file or hand-typed lines (ADR-0014 §8) | `snapshot:import` | `can_receive` and the private-warehouse rule |
| Remove a part, with its answers (ADR-0014 §9) | `snapshot:import` | `can_receive` and the private-warehouse rule |
| Review | `snapshot:import` | `can_receive` and the private-warehouse rule |
| Approve | `snapshot:approve` | `can_receive` and the private-warehouse rule |
| Read | either permission | reach only |
| Reject | either permission | reach only, so a list for a paused warehouse can still be abandoned |

**Through another store** (ADR-0014 §7, §12): every action above may also be taken through another store that holds `can_receive` at the list's warehouse, with the permission held there under the private-warehouse rule; reads and rejection too. A list of the shared warehouse thus belongs to both stores (owner, 2026-10-08). The list's `acting_store_id`, and the store its opening movements name, do not change. While the list's own store is blocked or archived, only rejection passes, through the other store (ADR-0014 §7; owner, 2026-10-09); so too while it no longer holds `can_receive` at the list's warehouse (ADR-0014 §7; review, 2026-10-09).

The acting store is stored as `acting_store_id`: ADR-0004 retired `store_id` on this table, and `0006`'s downgrade recreates it.

The list of a store's lists leaves out a list at a warehouse the person may not see. It does so in the query itself, so neither the page nor `has_more` reveals it *(security review)*.

**A list for a child store's private warehouse is approved by someone holding the owner's role in the child store itself** (owner decision 2026-09-29, question 5, §11). The private rule wants the permission granted directly in the child store, and that grant is one. The organization-wide owner cannot, and nor can the child manager, who lacks `snapshot:approve`. No role changed for this.

### 10. Lock order

| Operation | Locks, in order |
|---|---|
| Import | advisory lock on `(organization, command_id)`, scoped exactly like the unique key; then, once the first part's lines are parsed and kept, the warehouse's advisory lock exclusively, to hold it (§12; the parse is not under it since the review of 2026-10-09, ADR-0014 §8) |
| Adding a part (ADR-0014 §8) | the same advisory lock on `(organization, command_id)`, then the list `FOR UPDATE`; no warehouse lock |
| Removing a part (ADR-0014 §9) | list `FOR UPDATE`, then the part `FOR UPDATE` |
| Resolution | list `FOR UPDATE`, then row `FOR UPDATE` |
| Approval | list `FOR UPDATE`; exclusive warehouse advisory lock; inventory keys in the global order; lots, movements, allocation links, and status last (the freeze trigger allows the links only while the list is under review) |
| Rejection | list `FOR UPDATE` |
| Every command that moves or reserves stock | shared warehouse advisory locks in location order, then inventory keys |

### 11. The owner's answers (2026-09-29)

| # | Question | Answer | What it means here |
|---|---|---|---|
| 1 | An opening balance only into a warehouse with no history? | Yes | §5 is the owner's rule now, not a default. |
| 2 | Paper sales between the count and the approval? | They are entered into the app later anyway | Approve the list first, then enter those sales as ordinary sales. Entering any of them before approval closes the warehouse to its list for good (§5). Each is dated when it is entered: a sale has no separate "sold on" date. |
| 3 | Does a line without a count mean one piece? | "Do what a correct system does" | A count is never assumed. §3 stands: the reviewer states it, `LINE_IMPLIES_ONE` records that the line reads as one piece, and the approver sees how many lines rest on that. |
| 4 | May a seller give a "size not known" coat its size at the counter? | Yes, with an audit record | `size_clarified` on `POST /sales`, below. |
| 5 | Who approves a list for a child store's private warehouse? | A user with admin rights to the child store | The owner's role granted in the child store itself, as the owner confirmed when asked (§9). |

**Size clarified at the counter.** The seller sells the coat as the size they read, say M. Per line, they say how many of its units come out of the same model's size-not-known balance at that warehouse: `size_clarified: [{line_index, quantity}]`. In the sale's own transaction:

- **Movements.** An `ADJUSTMENT` of −n at the size-not-known key (`SIZE_RECLASSIFICATION_OUT`) and one of +n at the size (`SIZE_RECLASSIFICATION_IN`), both referencing the sale (milestone plan §4.9). Then the sale takes the coat from the size.
- **Bounded like «фізично є».** n is exactly the shortfall this basket consumes at that size. The M the ledger already holds are sold first, and nothing is reclassified that is not leaving in this basket. The size-not-known balance must hold n beside whatever the basket sells from it directly.
- **Permission.** `inventory:correct_during_sale`, which the default seller holds, with the private-warehouse rule, checked before any replay. It is the same bounded authority as «фізично є», and it changes no total. The warehouse ends exactly where selling the coat as size not known would have left it; only the size on the receipt and in the ledger differs.
- **Refused**, each with a `reason` and the line, warehouse and size it concerns, so a client can offer what is still possible *(2026-09-29 review)*:
  - a line already sold as size not known;
  - more units than the line sells, even when another line sells the same size;
  - goods also reported found or missing, or whose size-not-known balance is;
  - a reserved balance on either side, as for «фізично є» — the seller can still sell the coat as it is;
  - a model held under more than one size not known, which never happens while an organization has one.
- **Locks.** The size-not-known keys join the basket's keys in `lock_stock`, in the one global order, before anything is read. Two sellers clarifying the last such coat sell it once.
- **Trail.** One audit entry per model and warehouse (`inventory.size_reclassified_during_sale`): both balances before and after, the movements and the sale. The response lists both halves in `size_reclassifications`, and a durable replay rebuilds them in the same order.
- **Ledger door.** `validate_size_reclassifications` requires every such adjustment to be whole:
  - one half out and one or more halves in;
  - the same command, warehouse and model;
  - as many units in as out, into other sizes.

  `_apply_movements` also requires the half out to leave a size-not-known size, and the halves in to enter real sizes. `POST /inventory/adjustments`, which could write a lone half before, no longer accepts either reason.

  There is deliberately no pair back into "size not known": that size enters only from a list (§3). A size misread at the counter is corrected like any other wrong sale — a return and a new sale, or an adjustment.

No migration: both reasons have existed since `0002`.

### 12. A warehouse waits for its list (2026-10-02)

The owner decided that the lists are approved before new deliveries are
received, and chose that the app keep that order (business-rules.md, "the
first days"). §5 alone let a receipt land while a list waited, and the list
then could never be approved.

- **Kept, a list holds its warehouse** (`opening_list_hold`, one row per
  list). Approving or rejecting it lets go.
- **While a list holds a warehouse with no stock history, nothing moves
  there.** `_apply_movements` refuses every movement but the opening balance
  itself with `409 OPENING_LIST_PENDING`, naming the warehouses. That covers
  receipts, sales, «фізично є», corrections and transfers alike.
- **A list typed for a warehouse that already has history holds nothing.**
  It can never be approved (§5), and freezing a trading warehouse for it
  would stop the shop over a mistake.
- **Lock order.** A list takes the warehouse's advisory lock exclusively to
  hold it, as the opening balance does (§10). A stock command there lands
  wholly before the hold, and the list will find its history, or wholly
  after it, and is refused.
- **Module boundaries hold.** The hold table belongs to `inventory`, which
  reads only it. `snapshots` writes it through `inventory.service`, an edge
  it already had, and nothing imports `snapshots`.
- **`0030`** creates the table and holds the lists already waiting. Its
  downgrade drops the table and loses nothing, since a hold is derived from
  a list that waits.

## Alternatives considered

- **One `(variant, size)` per row.** Rejected. A line listing three sizes could then only become "size unknown × 3", or be split by hand into three lines, which rewrites the evidence.
- **Additive opening balance.** Rejected: it double counts whatever the app already tracked.
- **Per-key history check.** Rejected: legacy "size not known" stock beside app-tracked sized stock would still double count.
- **Stocktake semantics.** A different operation that can remove stock; it is not an opening balance, and the owner has not decided on it.
- **Opening balance on a paused warehouse.** Pausing would guarantee an empty ledger during review. But the owner defined pausing as "no stock operations", and confirmed on 2026-09-29 that an opening balance only opens an empty ledger (question 1).
- **One `CatalogMatchDecision` per line.** Rejected, because of the staleness described in §3.

## Consequences

Positive:

- The legacy list stays verbatim, beside what the parser read, what a person decided and on what basis. Each opening lot traces to its source line.
- Invariant I17 now has database teeth. No lot can claim to be an opening balance without naming its list, and no movement can do so without coming from an opening lot of the list it names. Only the approval writes one: the rule that a warehouse is opened only once, into an empty ledger, is service-enforced under the warehouse lock.
- Identity confirmed line by line produces human-labelled data, which the catalog evaluation currently lacks.

Negative:

- **One-way opening** (confirmed by the owner, 2026-09-29). A warehouse that has recorded anything cannot take an opening balance. With the seed granting `can_sell` from day one, a single «фізично є», receipt or transfer before approval closes that door for good, since the ledger is append-only. Warehouses holding test data can never take one. Several documents for one warehouse must go into one list, as its parts: pasted texts or parser's files (ADR-0014). Paper sales made between the count and the approval are entered afterwards, as sales, and are dated when they are entered (§11).
- **Manual work.** Resolving a legacy list is manual, and this increment has no UI. Some lines that plainly mean one piece still need a note: a bare number or two counts may mean anything.
- **Sizes not known.** A seller gives such a coat its size while selling it (§11). Outside a sale, reclassification still has no command.
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

**The 2026-09-29 amendment** needs no migration.

- `POST /sales` gains an optional `size_clarified`, and its response `size_reclassifications`. A client that sends neither sees no change.
- `POST /inventory/adjustments` no longer accepts the two `SIZE_RECLASSIFICATION_*` reasons (`422`).
- The refusal "Release reservations before correcting this stock key" now names the balance (`reason: RESERVED`, the stock key, the reserved count), for «фізично є» and «фізично відсутній» too.
- Both fingerprints of a sale now include `size_clarified`. A retry of a sale made before the deploy that arrives after it gets `409 IDEMPOTENCY_CONFLICT` instead of a replay. Nothing is sold twice, and there is no production data yet.
