# Durable Business Rules

- The application must simplify the existing notebook-based workflow rather than impose technical IDs on store staff.
- Owner clarification (2026-09-15): the primary and child stores both sell from the primary store’s shared warehouse; the child store also has a separate warehouse. Selling store and stock location are distinct concepts. This supersedes the earlier assumption that each store sells only its own store-specific inventory.
- Transfers between stores are explicit transfer movements, not sales.
  - **Implemented 2026-09-22 (M1-018)**, between *warehouses*: a `TRANSFER_OUT` and a matching `TRANSFER_IN` in one transaction — never a sale, never money. Historical defaults at implementation time (superseded where answered in the 2026-09-22 review): single-step (goods recorded as arrived the moment they leave, Q5); `can_sell` at the source is enough to take goods out; a closed warehouse is refused at either end; a manager whose stores reach neither warehouse is refused. See the [M1-018 report](m1-018-transfer-report.md).
- Business category and garment type are separate concepts.
- Raw catalog input is immutable evidence.
- Catalog identity uses CanonicalConcept -> ProductFamily -> ProductVariant; same shop name across sources is not automatically the same family.
- Source-like labels are stored separately and may remain semantically UNKNOWN until confirmed.
- Slash-separated values may represent multiple variants; slash is not automatically alias syntax.
- Size inventory must support both alpha and numeric size systems.
- Unknown terms remain unclassified until evidence supports classification.
- Owner confirmation (2026-09-14): staff very rarely record a product using its known item code instead of a descriptive name. Preserve such codes as optional identifiers when supported by evidence; do not require codes for everyday entry, infer their issuer or uniqueness, treat every bare number as a code, or merge products solely because their codes match.
- Legacy PDFs/availability sheets represent inventory snapshots, not transaction history.
- Adaptive matching requires explicit ambiguity handling and human confirmation when evidence is insufficient.
- User corrections improve alias/retrieval evidence; no online fine-tuning after each correction.

## Owner decisions — 2026-09-15

Confirmed requirements; documentation only, not claims of implemented behavior. Detailed scope and unresolved semantics: [warehouse, store status and payment decisions](owner-decisions-2026-09-15.md).

- One primary warehouse supplies both stores; a separate child warehouse also exists. Keep sales attribution separate from the physical stock location; never duplicate the shared quantity under both stores. **Implemented 2026-09-17** as stock locations plus explicit store access — [ADR-0004](../decisions/ADR-0004-stock-locations.md), [design and migration plan](m1-018-stock-location-design.md), [M1-029 report](m1-029-completion-report.md).
- Add explicit store states: temporarily blocked by an administrator and ceased trading/archived. These are not the daily end of a shift. Exact allowed operations and responsible roles require a permission matrix before implementation.
- Returned units are marked intact or damaged. One return may contain both conditions from the same sale line; their aggregate quantity is capped by the remaining returnable quantity. Damaged is a condition, not an automatic write-off or permission to sell it again.
- Owner clarification (2026-09-15): an arbitrary sale amount is the agreed final selling price after negotiation, either below or above the suggested price (for example, +200 UAH). It is not a partial payment and does not itself create debt. Price agreement and payment timing are separate: sales may be paid in full or on installments. Installments concern sales, not paying customer refunds in installments. Freeze the agreed price in the sale; do not rewrite the catalog suggested price.
- Record separately when the store itself acquires goods on installments. Keep the store’s purchase obligations distinct from customer payments and the selling price.
- **Owner decision (2026-09-30): a seller may enter and see the purchase cost** of goods they receive. It is optional, stored per lot and never on catalog identity (F33), and shown back as stored. **Implemented 2026-09-30** on the receiving screen — [receiving report](receiving-ui-report.md). The decision covers the cost of a delivery; it does not change who sees financial reports, which stay behind `report:view_financial` (a manager's permission by default). Purchase installments above remain unbuilt.
- No automatic return cutoff based on sale age. Existing authorization, original-sale linkage and cumulative quantity limits still apply.

## Owner decisions — 2026-09-17 (warehouses)

Confirmed and, except where noted, implemented by M1-029.

- All current data is test data. Whether to import existing balances or start from nothing is decided separately before launch; **nothing is cleaned or merged automatically**.
- The child store chooses explicitly which warehouse it sells from. The shared balance is never duplicated between stores.
- A seller at the child store may perform «фізично є» and «фізично відсутній» at a warehouse they can reach, **with the appropriate rights**. Reaching a warehouse never by itself confers the right to change what is in it, and arbitrary balance correction is not given to every seller.
  - Concretely, for «фізично є» (`FOUND_DURING_SALE`): the store needs `can_sell` at that warehouse and the person needs `inventory:correct_during_sale`. `can_receive` is **not** required here, and this is the only stock-increasing path where it is not — receipts, adjustments and refund restocks all demand it. The reason it is safe is the cap: the correction may not exceed the shortfall the sale immediately consumes, so the warehouse is never left fuller than it was found. Tightening this to `can_receive` is an owner's decision, not a code detail.
  - Reading is separate again: any access row lets a store see what is in a warehouse, including a closed one. Closing a warehouse freezes it; it does not hide it. *(Clarified 2026-09-22: this sentence is M1-029's engineering wording about reads, not something the owner said. What a closed warehouse may still do — for example, be emptied by a transfer — is an open owner question; see the [M1-018 report](m1-018-transfer-report.md).)*
- The warehouse is stated explicitly for each sale line. A client may prefill it when only one is available. **Automatically switching to another warehouse when one is short is forbidden.**
- A refund that restocks returns the goods to the warehouse that line was sold from. Another warehouse requires a separate transfer. Sale and refund stay attributed to the store that made the sale.
- **«Фізично відсутній» is implemented (M1-030), bounded.** The owner answered the open question on 2026-09-17: **the sale proceeds for the quantity that is actually there.**
  - The seller states **how many units are present** for the line they are selling, never the size of the shortage. The line is sold for that many, and the customer pays for that many.
  - The shortfall is removed by a negative `ADJUSTMENT` with reason `MISSING_AT_SALE`, in the sale's own transaction, audited with before and after.
  - **Two bounds, both enforced (invariant I25):** the line being sold, and what the ledger already believed was there. So it can never empty a shelf (that is a stocktake, and needs `inventory:adjust`), never drive a balance negative, and never *add* stock.
  - It is **not a write-off.** `MISSING_AT_SALE` is deliberately not `LOST` or `DAMAGED`: at the counter nobody knows whether the coat was stolen, misfiled, already sold or standing in the other warehouse, so the reason records the observation and no more.
  - It needs its own permission, `inventory:report_missing_during_sale`, which is **not in the default seller role** and is not implied by `inventory:correct_during_sale` or by reaching the warehouse.
  - A line where **nothing** is present is refused rather than dropped from the basket: an empty shelf with no sale behind it is a stocktake. See the open note in [physically-absent-proposal.md](physically-absent-proposal.md).

## Owner clarification — 2026-09-22

See [business model review and implementation implications](business-model-review-2026-09-22.md). These are requirements; no runtime change was made by recording them.

- The primary store's warehouse is shared by the primary and all its children. Each child may optionally have its own warehouse, operated by that child. No sibling access is implied.
- Goods have an in-transit stage and a later arrival event. Postal arrival versus actual warehouse acceptance is not yet settled; never silently credit sellable stock merely from a shipping status.
- A closed child warehouse means temporarily paused, consistent with current behavior: visible balances, no stock mutations. Do not conflate this with pausing the shared warehouse or deleting stock.
- Shared↔own-child transfers must be possible with actor/store/time attribution. This does not abolish person-level permissions or authorize arbitrary stock adjustments.
- Organization-wide manager access without explicit warehouse grants is unanswered; retain existing checks.

## Latest customer-order clarification (recorded 2026-09-23)

Customer postal delivery is separate from warehouse receipt/transfer. Goods at “needs dispatch” are ordered, not yet a completed sale. Reserve them; consume reservation and physical stock once at dispatch; arrival changes delivery status only. Pre-dispatch cancellation releases reserve; after dispatch require a real return. Normal warehouse receipt immediately adds stock. Child warehouse management requires explicit child-store permissions; organization-wide permissions alone do not bypass this. Owner confirmed on 2026-09-23: recognize the completed sale when the customer collects the goods, never at dispatch or postal arrival. Collection does not imply payment. See [implementation sequence and evidence](bootstrap-and-order-next-steps.md).

### Private control implementation — 2026-09-23

An explicitly private location now requires an exact permission granted directly in its managing store, plus the existing store ACL. Organization-wide permissions do not substitute, and sibling/main store grants cannot bypass private control. Explicit child sellers retain their authorized operations. Migration 0009 classifies only known bootstrap child locations; unclassified legacy locations must be reviewed explicitly. Financial sale-history permissions are separate. See [evidence and rollout limits](private-location-report.md).

## Legacy stock lists (M1-023) — 2026-09-28, owner answers 2026-09-29

Implemented behavior. The owner answered all five open questions on 2026-09-29; what was marked *default* is now marked with the answer. See [ADR-0005 §11](../decisions/ADR-0005-legacy-snapshot-import.md) and the [M1-023 report](m1-023-snapshot-import-report.md).

- A legacy list is kept line by line, verbatim. For each line a person with `snapshot:import` states:
  - the product;
  - the size, or "size not known";
  - the quantity;
  - where the numbers came from: the line's own count, a countless line taken as one piece, a recount, or other knowledge with a note.

  Nothing is inferred: not a size split, not a colour split, not a count. A line naming several sizes or colours never states its split, slash or not: its count cannot all go into one size as "the line's own count". A line that is not stock is skipped with a reason.
- Someone with `snapshot:approve` (the owner by default) approves the whole list at once. It becomes `OPENING_BALANCE` stock at its warehouse, never deliveries or sales. An opening balance is only ever the answer to a list; the database refuses any other.
- **Owner decision (Q1):** an opening balance only **opens** a warehouse's ledger. A warehouse that has recorded any stock — a receipt, a sale, a «фізично є», an earlier list — cannot take one, ever.
- **Owner decision (Q2):** paper sales made between the count and the approval are entered into the app afterwards, as ordinary sales. So the list is approved first; entering any of them before approval closes the warehouse to its list for good. Each is dated when it is entered.
- **Owner delegated (Q3), "as a correct system does":** a count is never assumed. A countless line is taken as one piece only when the reviewer says so, and the approver sees how many lines rest on that. It must have nothing in it that could be a count: no count the parser found, however unsure, and no bare number, which may be a count, a size or an item code. Such lines need a note.
- **Owner decision (Q4):** a seller may give a coat held as "size not known" its size at the counter, with an audit record (`size_clarified` on the sale). It is bounded like «фізично є»: only the units the sale is short of at that size, taken from the same model's size-not-known balance at that warehouse, as an audited pair of movements. It needs `inventory:correct_during_sale`, which the default seller holds. «Фізично є» itself stays refused while the same model will still be held there with size not known once the sale has taken what it takes from that balance. A reserved balance on either side refuses the clarification, as it refuses «фізично є»; the coat can still be sold as size not known.
- *Default:* "size not known" stock enters only from a legacy list. «Фізично є» never adds it, receipts and positive adjustments refuse it, and the catalog reserves its code. Stock already held that way can still be sold, moved, written off, or given its size at the counter.
- **Owner decision (Q5):** a list for a child store's private warehouse is approved by a user with admin rights to the child store — the owner's role granted in the child store itself. Not the organization-wide owner, and not the child manager, who lacks `snapshot:approve`.
- Receipts record only purchased, consigned or borrowed goods. Opening balances, transfers, returns and adjustments each have their own command. *Widened on 2026-10-02:* goods found after a warehouse's opening list go in through receipts too (owner decision, "the first days").

## Owner decision — 2026-09-30 (stock corrections)

- **A manual stock adjustment is a business operation with a permanent identity**, like a receipt or a transfer: a correction retried at any distance in time is applied once. The owner chose the most consistent of the three options in ADR-0006 ("keep it the way that is most logical and correct"). See [ADR-0007](../decisions/ADR-0007-stock-adjustment-command-identity.md).

## Owner decision — 2026-09-30 (backups)

Asked as the runbook's five questions. See the
[runbook](backup-restore-runbook.md).

- **How often, and how much may be lost: a backup every day.** The owner
  first said once in two weeks, "or longer". Told that the shop will use the
  app every day, so a server failure could lose up to two weeks of sales,
  receipts and orders, the owner chose daily. A restore then loses at most
  one day.
- **Retention.**
  - Every daily backup is kept 7 days.
  - The first backup of each calendar month is kept 3 months.

  Roughly ten copies at a time. Nothing else is ever deleted, and nothing is
  deleted on a night whose run failed.
- **How long the shop may be without the app: no fixed target.** A new
  store opens when the owner decides, and the shop means to use the app
  every day. A restore the same day is enough; the restore itself takes
  seconds.
- **Copies leave the server encrypted, and the owner's own computer or NAS
  collects them.**
  - The server encrypts each copy with the owner's age public key.
  - Only the owner holds the private key, in a password manager plus on
    paper or a USB stick. The server never has it.
  - A server that is broken into cannot read the copies it already made.
- **A failed backup or drill is shown to the owner in the app**, in a
  «Резервні копії» section only the owner sees, **and sent by the bot in
  Telegram**, so it is not missed when nobody opens the section.

## Owner decision — 2026-10-01 (backup messages are silent)

Asked because the nightly job runs at 03:15, so a failed night's message
would arrive at night with a sound. The owner chose **silent**: every backup
message arrives without a sound or a vibration, whatever the hour, and the
owner looks at the «Резервні копії» section to see what went wrong. The
message is still delivered and stays in the bot's chat; it is not held
until morning.

## Owner decision — 2026-10-01 (returns at the till)

Asked because a till sale could not yet be returned from the app, and the
owner's rule of 2026-09-15 (owner-decisions-2026-09-15.md §3) left what
happens to a damaged unit to be designed.

- **Each returned unit is stated intact or damaged.** One sale line may come
  back partly intact and partly damaged in the same return. Every part counts
  towards what is still returnable.
- **An intact unit goes back to the warehouse it was sold from**, as before
  (2026-09-17).
- **A damaged unit goes to the store's own «Брак» warehouse.** It stays in
  the stock records, but nothing sells from there. A manager later decides
  its fate: repair it and put it back on sale, return it to the supplier, or
  write it off.
- **Every store has its own «Брак»**, because a warehouse in the app is a
  physical place, and a damaged coat stays where it was handed back.
  Gathering it elsewhere is an ordinary move.
- **A return is taken only in the store that made the sale.** Returns from
  another store remain a separate question (owner-decisions-2026-09-15.md
  §1). *Answered later the same day: see "returns at another store".*
- **The seller finds the sale in the store's list of sales**, newest first,
  searchable by the goods' name.

## Owner decision — 2026-10-01 (what happens in «Брак»)

Asked after the returns were built, because repaired goods had no way back
to sale.

- **Anyone who takes returns** — a seller, a manager or the owner — puts a
  unit returned damaged into their store's «Брак», marked damaged. (Built:
  the return at the till.)
- **From «Брак», any of them may pick a unit and take it for inspection.**
  Depending on what they find, they either:
  - **put it back among the goods on sale**; or
  - **keep it in «Брак» marked «брак підтверджений»** (damage confirmed).

The owner then answered the open questions the same day:
- **An inspected unit goes back to the warehouse it was sold from.** The
  person is shown it and confirms it.
- **«На перевірці» is a status the others see**, as long as it does not
  clutter the app. It says who is looking; it does not stop anyone else from
  finishing.
- **A confirmed unit stays in «Брак», no longer for sale.** People look
  through «Брак» from time to time and decide each unit's fate.
- **Anyone who takes returns may write a confirmed unit off.**
- **Stock in «Брак» changes only through returns and the «Брак» section.**
  It is never changed by a delivery, a transfer, a stock correction or a
  stock list, so the list of units always matches the stock.

Built on 2026-10-01; see the
[«Брак» report](damaged-inspection-report.md).

## Owner decision — 2026-10-01 (suggested selling price, Q-F)

Asked because the till could not prefill a price: `variant_price` existed,
but nobody had said who may set it. Typing a price on every sale kept
`taps-to-sale` over its budget.

- **The owner and managers set the suggested price; a seller sees it.** The
  final price is still agreed at the counter, as decided on 2026-09-15.
- **One price for the whole shop, which a store may override with its own.**
  That store's till suggests its own price, and every other till the shared
  one.
- **It is set where goods arrive and on the stock screen.** There is one
  price per model and colour, for every size.

The owner confirmed the details the same day:
- **A store's own price needs the permission in that store.** A manager who
  belongs to one store sets that store's price, never another store's (the
  scope rule, I12/I13).
- **The shared price needs the permission over every store's till.** It may
  be held organization-wide, as the owner's membership is by default. Or it
  may be held in every one of the organization's stores, paused ones
  included. For example, a child store's owner may also be a manager of the
  main store, and so sets the shared price too.
- **The seller may still adjust the prefilled price** at the counter.
- **A price is more than zero.** "No price" is a state of its own, so a till
  never prefills 0.

Built on 2026-10-01; see the
[suggested price report](suggested-price-report.md).

## Owner decision — 2026-10-01 (nothing on the shelf, Q-G)

Carried over from M1-030. The case: a seller confirms that **none** of a
line is on the shelf («фізично є 0»).
- **Drop the line from the basket and sell the rest.**
- **Record the shortage**, as «фізично відсутній» does for part of a line.
  The ledger takes off the units it believed were there, within that
  correction's bounds (I25).

This applies only to people allowed «фізично відсутній» — by default a manager
and the owner.

The owner answered the remaining case the same day:
- **When nothing is left to sell, the shortage is still recorded, without a
  sale.** The till says so, and the ledger takes off the units it believed
  were there, as for any other line.

Built on 2026-10-01; see the [empty shelf report](empty-shelf-report.md).

## Owner decision — 2026-10-01 (people, Q4)

Asked because nothing could add a seller: the bootstrap creates one owner,
and no screen or command gave anyone else a store.

- **A person is added on the server**, by a command the technical
  administrator runs, by the number of the person's Telegram account. The
  app has no section for it.
- **Only an owner adds and removes people.** The network's owner decides in
  any store. A child store's owner decides only in that store. A manager
  does not.
- **A person can leave one store, or be turned off completely.** Turning
  off covers every store at once. Either way access ends straight away, and
  what the person did stays in the history under their name.
- **Each seller works from their own Telegram** (Q4, devices), so every sale
  names who made it.

How it is carried out, not decided by the owner:
- **Every change names the owner on whose word it is made.** That owner must
  hold `user:manage` where the change applies, and every permission of the
  role given or taken away. So nobody gives more than they hold. The owner
  is the actor of the audit record.
- **A safety guard of our own:** a change is refused if it would leave nobody
  who manages people in every store. After that, no change could ever be
  approved again.
- **Someone the shop has not added sees their Telegram number** in the app,
  to pass on.

Built on 2026-10-01; see the [people report](people-report.md).

## Owner decision — 2026-10-01 (going live)

Asked while drawing up the [release checklist](release-checklist.md).

- **The shops' existing stock gets in in one of two ways.** Either:
  - lists with review, as decided on 2026-09-29 (ADR-0005): a list is kept
    line by line, a person states each line, and the owner approves it into
    opening balances; or
  - the shops photograph their notebooks and tables, a separate parser reads
    them, and the result is added to the warehouses as JSON.

  **Whatever is still missing is added one by one.** Not decided yet:
  - which of the two ways;
  - the JSON's shape, since the parser does not exist yet;
  - whether its lines still pass through review before approval.

  The rules of 2026-09-29 stand until the owner changes them: an opening
  balance only into a warehouse with no history, and only as the answer to a
  list.
- **Moving goods between warehouses needs no screen at the start.** Both
  stores sell from one shared warehouse.

## Owner decision — 2026-10-01 (store names)

- **The stores carry their real names.** They are given when the server is
  set up, and changed later on the server on an owner's word, as people
  are. The app has no section for it.
- **Who may rename a store:** whoever holds `user:manage` there. That is the
  network's owner in any store, and a child store's owner in theirs.
- **Each rename is recorded.**

## Owner decision — 2026-10-01 (paying in parts)

Asked when the owner chose this as the next work. The 2026-09-15 decisions
had confirmed full and installment payment, and left the rules open.

- **The customer takes the goods at once.** They pay part now and owe the
  rest. Any first payment above nothing will do.
- **The shop records the customer's name and phone.**
- **There is no schedule.** The customer pays when they can. The shop sees
  what was paid, what is left, and when the last payment came.
- **A seller and above** sell this way and take later payments.
- **Payments are taken only in the store that sold.**
- **Returned goods first lower what is owed.** Money goes back only when the
  customer has paid more than the goods they keep are worth.
- **The owner may write off a debt** that will not be paid, saying why.
  It shows in the history.

How it is carried out, not decided by the owner:
- **A payment above what is owed is refused.** A sale paid in full at once is
  an ordinary sale, not a debt.
- **A written-off debt never becomes cash.** After a write-off, a return gives
  back at most what was actually paid.
- **The phone is kept out of the audit log and the receipt.**

Server side built on 2026-10-01; see the [credit report](customer-credit-report.md).
The screens were built the same day; see the
[credit screens report](credit-screens-report.md).

## Owner decision — 2026-10-01 (debts by customer, totals, orders)

Asked when the debts by customer, the store's total and orders paid in parts
were taken up with the screens.

- **One phone is one customer**, whatever name each sale was written under.
  «+38 (067) 123-45-67» and «0671234567» are one number.
- **A customer with several debts pays on the debt the seller chooses.**
  The customer's card shows every debt and what they owe in all; nothing is
  spread across debts by itself.
- **What is owed in all is shown by store only**, in its «Борги». There is
  no network total.
- **An order collected may be paid in parts, by the till's rules:** something
  above nothing at collection, the rest owed to the store that took the
  order, and later payments in its «Борги».

How it is carried out, not decided by the owner: a Ukrainian number is
compared in its own ten digits, so `380…` written with the country code and
`0…` written without it are one. Other numbers are compared as written.

## Owner decision — 2026-10-01 (returns at another store)

Asked when the owner chose it as the next work. It answers what
owner-decisions-2026-09-15.md §1 left open: who may take back goods the other
store sold, where they go, and which store handles the money.

- **Any store of the network may take the goods back.** Whoever takes returns
  in their own store finds the other store's sale by a search, and takes it
  there. They see such sales only in that search.
- **Intact goods go back to the warehouse they were sold from**, as before.
  Where the store taking them back does not reach it (another store's own
  warehouse), the seller chooses one of their own store's.
- **The store taking them back hands the money back.** The record names both
  the store that sold and the store that paid out.
- **A sale paid in parts comes back by the same rules.** What is owed is
  lowered first and stays the selling store's debt; any cash back is handed
  over by the store taking the goods back.

How it is carried out, not decided by the owner:
- **Damaged goods go to the «Брак» of the store taking them back.** It
  follows the rule of the same day that a damaged coat stays where it was
  handed back.
- **A damaged unit from another store's own warehouse** goes back on sale,
  after inspection, in a warehouse of the store holding it that the person
  chooses. This is the same rule as intact goods.
- **Another store's sales are found by a search of two letters or more.**
  They are never listed whole.
- **A closed store takes nothing back for another store.** Its own sales keep
  the rule they had. *Superseded the same day by "store states": a blocked
  or archived store takes nothing back at all, its own sales included.*

Built on 2026-10-01; see the [report](returns-elsewhere-report.md).

## Owner decision — 2026-10-01 (store states)

Asked when the owner chose it as the next work. It answers what
owner-decisions-2026-09-15.md §2 left open: what a blocked or archived store
may do, and who blocks, archives and reopens one.

- **The owner of the network blocks, unblocks, archives and reopens a store,
  in the app.** Each change needs a reason and is recorded. The owner of a
  child store does not change her own store's state.
- **A blocked store is only read.** Nothing is done in it: no sale, receipt,
  return, debt payment, order, stock correction or «Брак» step.
  - The owner and the network's managers see its history, stock and debts.
  - Its own people see only that it is blocked, and since when.
  - Customers return its sales at another store (see "returns at another
    store").
  - Once it is unblocked, everything works as before.
- **Debts of a blocked or archived store are paid at any store of the network
  that trades.** The record names the store that took the money. The debt
  stays the selling store's.
- **Only an empty store is archived.** Its own warehouse and its «Брак» must
  be empty, and it must have no open orders. Otherwise the archive is refused
  with a list of what is left.
- **An archived store may be opened again by the owner,** with a reason. Its
  people come back with the roles they had, unless they were removed
  separately.
- **A blocked or archived store is read by the owner and managers of the
  network.** Someone added to that store alone, including the owner of a
  child store, sees only «Магазин заблоковано» or «…в архіві».
- **Open orders of a blocked store wait** until it is unblocked. Their goods
  stay held, and nobody else sells them. An archive is still refused while
  they are open.
- **Sellers see no reason**, only «Магазин заблоковано власником» and the
  date. The reason is for the owner and whoever reads the store's history.
- **The owner of the network may write off a debt of a blocked or archived
  store.** Writing off is the owner's decision about money, not an operation
  in the store. The owner of a child store does not.

How it is carried out, not decided by the owner:
- **"Nothing is done in it"** is enforced in one place: the person's scope.
  - A blocked or archived store answers any change with `STORE_NOT_TRADING`.
  - Only a request that reads (`GET`) is let through, and only for a
    network-wide role.
  - Its own people's grants count for nothing while it does not trade.
- **A command that moves stock holds its store until it commits.** A change
  of state waits for it, and a command that comes after sees the new state.
  So nothing lands in a store in the instant it is archived.
- **A private warehouse of a store stays private.** The network's owner
  reads a blocked store's shared warehouses, not its own one (owner rule of
  2026-09-23). The archive's refusal still names it and its unit count, so
  the owner knows what is left.
- **An archived store is opened, never blocked.** Archived → blocked is
  refused.
- **Other stores' debts are found by a search of two letters or more,** as
  other stores' sales are. They are never listed whole.
- **People are still let go from a blocked store** by `scripts.people`, on
  the network owner's word. Nobody new is added to it.
- **A store an operator had set inactive before this** becomes blocked: the
  state that keeps every rule an inactive store had.

Built on 2026-10-01; see the [report](store-states-report.md).

## Owner decision — 2026-10-01 (returns to a supplier)

Asked when the owner chose it as the next work. Until then a return to a
supplier was a write-off with a note (release checklist).

- **Suppliers are a list, one for the network.** The person picks a supplier
  from it, or adds a new one on the spot, with a name and, if wished, a
  phone. Whoever returns goods may correct a supplier's name or phone. Nobody
  deletes one. Receiving goods does not record a supplier yet.
- **Only the goods are recorded,** with a note. Money, or what the supplier
  sets against what the shop owes, stays outside the system until the
  store's purchase installments are built.
- **The owner and managers return goods to a supplier**: those who may
  already write off or correct stock. Not a seller.
- **From a warehouse and from «Брак».**
  - Unsold goods, consignment included, are returned from a warehouse in a
    section of their own.
  - A unit in «Брак» whose damage is confirmed may be returned to the
    supplier instead of being written off, with its own button in «Брак».
- **A return from a warehouse is one document with a list:** a warehouse, a
  supplier, several models and sizes with their quantities, and a note. The
  same section lists the store's returns, filtered by supplier.
- **A return can be cancelled, with a reason.**
  - Its goods go back where they were taken from: to the warehouse, or, for
    a unit from «Брак», back into «Брак» as confirmed damaged.
  - Both the return and its cancellation stay in the history.
  - The whole return is cancelled, never a part of it. If the supplier took
    only some of it, it is cancelled and recorded again as it was.
  - At any time, and only once.
- **The list shows this store's returns only,** as «Борги» shows this
  store's debts.

How it is carried out, not decided by the owner:
- **Only goods free to sell are returned.** Goods held for an order are not:
  the order is cancelled first.
- **A unit returned from «Брак» leaves «Брак» through the «Брак» section,
  and comes back through it when that return is cancelled.** So stock in
  «Брак» still changes only through returns and that section.
- **A warehouse's return never touches a «Брак»**, as a stock correction
  never does.
- **A supplier's name is unique in the network,** whatever its spacing or
  letter case, so one supplier is never written twice.
- **Cancelling twice changes nothing**: the second answers with the return
  as it is.


## Owner decision — 2026-10-01 (the store's purchases in parts)

Asked when the owner chose it as the next work, after returns to a
supplier. It is the last part of the owner's decisions of 2026-09-15 that was
still unbuilt: "record separately when the store purchased goods on
installments".

- **An invoice is recorded on its own, never with a delivery.** A supplier
  from the network's list, the sum on the supplier's invoice, typed in, and a
  note. Receiving goods stays as it is; the purchase prices on received
  lines stay optional and separate, and need not add up to an invoice.
- **Each invoice is its own debt.** A payment names the invoice, as a payment
  of a customer's debt names the sale. The app also shows what the store owes
  each supplier in all.
- **Anything from nothing to the whole sum may be paid at once.** Paid in
  full, the invoice is closed at once and stays in the history.
- **No schedule.** The store sees what was paid, what is left, and when the
  last payment was made.
- **The owner and managers record invoices and payments:** the same people
  who return goods to a supplier. A seller does not see these debts.
- **Each store keeps its own invoices,** with its own total. The list of
  suppliers is shared by the network.
- **Goods returned to a supplier are set off against an invoice:** a
  "set-off" on an invoice of the same supplier, for the sum the supplier
  counted for the returned goods, naming that return. One return may be set
  off against several invoices, in parts, when the supplier counted more
  than one invoice still owes.
- **A return set off against an invoice is not cancelled** while that
  set-off stands. The app says which set-off to cancel first.
- **What was recorded by mistake is cancelled, saying why:** a payment, a
  set-off, or the whole invoice, which is then recorded again. What was
  cancelled stays in the history. An invoice with a payment or a set-off
  still standing is not cancelled: those are cancelled first, so no money
  disappears by accident.
- **Only the owner writes off what is left,** saying why: when the supplier
  forgave it.
- **While a store is blocked or archived, any store of the network that
  trades pays its invoices,** as it takes payments of that store's
  customers' debts. Open invoices do not keep a store from the archive.

How it is carried out, not decided by the owner:
- **Never more than is owed** is paid, set off, or paid at once.
- **A write-off is final**, as a customer's debt's write-off is: neither it,
  nor the payments before it, nor the invoice is cancelled afterwards.
- **A set-off names a return of the same store and the same supplier** that
  still stands.
- **A payment made by another store, while the one that owes did not trade,
  is cancelled there too**, under the same rule as paying it. A set-off and
  the invoice itself are cancelled only in the store that owes, while it
  trades.
- **While a store does not trade, the network's owner writes off** what it
  owes, as for its customers' debts.
- **Cancelling twice changes nothing**: the second answers with the invoice
  as it is.

## Owner decision — 2026-10-01 (where an order goes)

The owner asked for it, and set the rules the same day.

- **An order goes within Ukraine, the default, or abroad.**
- **Within Ukraine, by one of three carriers:** «Нова пошта», «Укрпошта» or
  «Міст». One of them is always picked when the order is made. A new carrier
  is added by the developer.
- **Abroad, one free-text field** says it all together: the city, the
  country and how it was sent.
- **Where it goes, and the carrier, are stated when the order is made.** The
  waybill number, or the text abroad, is written when the order is sent.
- **An order may be marked sent without them**, and they are written later.
- **Any of it is corrected while the order is open** — until the customer
  collects it, or it is cancelled or comes back. What was there before stays
  in the order's history, with who changed it and when.
- **Whoever works with orders states and corrects it,** a seller included.
- **The waybill is written as typed, and not checked.** If another order of
  the store already has it, the app says so, and saves it anyway: several
  orders may travel in one parcel.
- **Nobody's name, phone or address is recorded** with an order. That is on
  the carrier's waybill.
- **The list of orders shows each one's carrier and waybill**, or "abroad",
  and orders are found by their waybill.

How it is carried out, not decided by the owner:
- **An order made before this has no destination.** None is invented: it
  reads «Доставку не вказано» until someone states one, and its waybill
  waits for that.
- **Two waybills are one** whatever their spaces, dashes or letter case.
- **A correction states the whole of it** — where, the carrier, the waybill
  or the text. Stating it again as it stands adds nothing to the history.

## Owner decision — 2026-10-01 (no settling between the network's stores)

Asked when settling money between stores was offered as the next work.

- **Stores of one network do not settle with each other.** The money is
  the network's. What one store paid out, or took, for another stays in each
  return's and payment's history, and nothing adds it up between stores.

## Owner decision — 2026-10-01 (goods borrowed from another shop)

The owner put it in place of settling between stores: a shop of the network
may take jackets from another shop, "as from a supplier, roughly", which is
"a loan of jackets with a sum".

- **Borrowed goods are paid for only once sold:** at the price agreed for
  each when they are taken. Unsold, they go back for nothing.
- **The other shop is a supplier** on the network's list.
- **Goods under consignment work the same:** the «Під реалізацію» choice in
  receiving.
- **The shop only borrows.** It does not lend its own jackets.
- **They are taken through receiving,** as «Позичено» or «Під реалізацію»,
  naming the supplier and the agreed price of each.
- **Only the owner and managers take them.** A seller receives the shop's
  own goods only.
- **The till sells them as any goods.** It does not tell a borrowed jacket
  from the shop's own of the same model and size.
- **The owner or a manager marks them sold, by hand,** in «Постачальникам»,
  in the list «Позичене». That is a debt to the supplier in «Накладні», for
  the agreed price of those sold, paid there like any invoice.
- **Unsold ones go back from the same list,** as a return to the supplier.
- **A «Продано» marked by mistake is undone by cancelling its invoice** in
  «Накладні». The goods are on hand again.

How it is carried out, not decided by the owner:
- **A price above nothing is required** for borrowed goods, and a supplier
  on the list.
- **Never more is marked sold or sent back than is still on hand:** what was
  taken, less what stands sold, less what stands returned. A cancelled
  return puts goods back on hand, as a cancelled invoice does.
- **Borrowed goods go back to the supplier they came from,** from where they
  arrived, one model and size at a time.
- **Goods borrowed before receipts named a supplier** are not on the list:
  nobody can say whose they were.

## Owner decision — 2026-10-02 (the sales report)

Asked when the owner chose a sales report as the next work: the app had no
figures of any kind for a day or a period.

- **The owner and managers see it.** A seller does not. It is the right the
  app already had for financial reports (`report:view_financial`), which the
  manager's role holds by default.
- **For today, or any day or days.** It opens on today; yesterday, this week
  and this month are a tap away, and any dates from one to the next.
- **What it shows:**
  - **sales and returns:** how many sales and units, for how much; the
    returns are taken off, and what was sold less what came back is shown;
  - **the money through the till:** sales paid in full, payments towards a
    debt (the first with the sale, and every later one), less what returns
    handed back. It is what the till should hold.
- **Each store on its own, and the stores together** for whoever sees more
  than one. Each person sees only the stores they have access to.
- **A return counts on the day it was taken.** A past day's report never
  changes.
- **A sale and its returns are the store's that sold; money is the store's
  whose till it went through.** A return taken at another store lowers the
  sales of the store that sold, and its money leaves the till of the store
  that took it. A debt paid at another store is that store's money.
- **One sum of money.** The app does not ask whether a customer paid in
  cash or by card; that can be split later, as separate work.
- **What the store pays its suppliers is not the till's.** It stays in
  «Накладні».
- **Beside the figures:** the models sold, with how many and for how much,
  the most first; and every sale and return of those days, with the time,
  the sum and who made it.

How it is carried out, not decided by the owner:
- **A day is the store's own,** by its clock (Europe/Kyiv): a return taken
  at 00:10 is that day's, though by UTC it is still the day before.
- **A period is one day to a year,** 366 days at most.
- **A return of a sale paid in parts** takes out of the till only the cash it
  handed back; the rest lowered what was owed.
- **A blocked or archived store is in the report** of whoever may read it:
  the owner and the network's managers. Its own people see nothing there.
- **A model renamed between two sales is one model,** named as it was last.
- **The «Продажі й повернення» list of a store** has its own sales, the
  returns of them wherever they were taken, and the returns it took of
  another store's sales: each changed its figures or its till.

Built on 2026-10-02; see the [report](sales-report-report.md).

## Owner decision — 2026-10-02 (the first days)

Asked when the server runbook's cutover was rewritten: what to do with a
delivery that arrives between the count and the opening list's approval, and
how goods found later go in.

- **Whoever enters the goods keeps the order.** The opening lists are
  approved first; new deliveries are received only after that. Getting this
  order right is the responsibility of the person entering them, not a rule
  the app has to work out.
- **These steps should be straightforward and simple in the app.** Asked
  how, the owner chose that **the warehouse waits while its list does**:
  while a list waits for approval or rejection, nothing is received, sold or
  corrected in that warehouse.
- **Goods found later go in through «Приймання»,** with their size: whoever
  enters them knows it.

How it is carried out, not decided by the owner:
- **Only a warehouse with no stock history waits.** A list typed for one
  that already records stock can never be approved, so it holds nothing
  back, and a mistaken list never stops a trading warehouse.
- **Every movement there is refused**, the opening balance aside:
  receipts, sales, «фізично є», corrections and transfers alike
  (`OPENING_LIST_PENDING`). The refusal says to approve or reject the list
  first.
- **A receipt of found goods is recorded as any receipt:** a delivery that
  day, a purchase when a seller enters it, its cost left empty unless known.
  Nothing marks it as found.
- **A paper sale of goods from a delivery that came after the count** needs
  that delivery received first, or the till finds the shelf short.


## Owner decision — 2026-10-03 (correcting the catalogue)

Asked when the owner chose it as the next work. A model in the catalogue
could not be renamed, merged with a duplicate or retired, so a typo made
while the shops type their stock would stay for good. The owner had never
given a rule on any of it.

- **Four things:** rename a model; merge a duplicate into the model that
  stays; retire a model, and bring it back; and warn about a similar name
  when a new model is created.
- **The owner and managers correct the catalogue** (`catalog:merge`). A
  seller creates models but does not correct them.
- **A rename corrects one model**, the one opened: not every model that
  shares the word. Everything in its name may be corrected: the model's
  name, the factory or brand label, colour, material, texture, fur, collar
  and length. If the corrected model is one that already exists, the app
  offers to merge them.
- **Old receipts keep the name they were sold under.** (A rule of the
  system since M1, invariant I8.)
- **Merging:**
  - **The duplicate's stock moves to the model that stays**, in every
    warehouse and size, recorded in the stock history as a move by the
    merge. Nothing is added or lost.
  - **The price of the model that stays is kept**; when it has none, the
    duplicate's is taken. A store's own price follows the same rule.
  - **A merge cannot be undone.** Before it, the app shows both models with
    their stock and asks for confirmation. A mistake is put right with the
    ordinary steps: a new model and a stock correction.
  - **Not while the duplicate has anything open:** an order holding goods,
    borrowed goods, units in «Брак», or an opening list waiting. The app
    lists what to finish first.
  - **Afterwards the duplicate leads to the model that stays everywhere:**
    goods from an old sale of the duplicate come back as the model that
    stays; «Звіт» counts the two as one; searching the old name finds the
    model that stays.
- **Retiring:**
  - **A retired model is no longer offered** in «Приймання», the
    catalogue search and the opening lists. What is in stock may still be
    sold, returned or written off.
  - **It can be brought back**, and is offered again as before.
- **A similar name at creation** (Latin letters in place of Cyrillic, case,
  extra spaces): the app shows the similar model and offers to take it. If
  the person confirms it is another model, it is still created.

Asked the same day, when a review of the design found what the answers above
left open:
- **Only a person with the right over every store merges:** the owner of the
  network, or a manager in every one of its stores, paused ones included. It
  is the shared price's rule, since a merge moves stock and prices in every
  store. Renaming, retiring and bringing back stay with a manager of any
  store, as creating a model does.
- **A merge does not reach into another store's own warehouse, or into a
  blocked one.** While the duplicate has stock there, the merge is refused
  and the app shows where. A store's own warehouse is changed only by that
  store, and nothing is done in a blocked store: the goods are moved to the
  shared warehouse first, or the store unblocked, and then they are merged.
- **Nothing is merged into a retired model.** The app offers to bring it
  back first; otherwise a duplicate still received would quietly stop being
  received.

How it is carried out, not decided by the owner:
- **"Not received" is a refusal.** A receipt or an opening list's line that
  names a retired model is refused (`MODEL_RETIRED`), and so is creating a
  model whose name is a retired model's; the app offers to bring it back.
- **A retired model's stock also moves between warehouses and is corrected
  after a count.** The goods are still there; only taking new ones in stops.
- **A model is not retired while an opening list that waits names it.** The
  list could then never be approved, and its warehouse would stay waiting.
- **"Units in «Брак»" are those still there.** A unit sent back to its
  supplier is out of «Брак» while that return stands, so it does not stop a
  merge.
- **What reopens after a merge goes to the model that stays.** A borrowed
  lot whose invoice or return is cancelled later is sent back to the supplier
  as the model that stays; the lot keeps naming the duplicate. A «Брак» unit
  whose return to its supplier is cancelled comes back, and is written off or
  put back on sale, as the model that stays; the unit keeps its name.
- **A merge moves stock as the store the person acts in,** and only where
  that store may change stock.
- **An order of the model that stays does not stop a merge.** Adding stock
  takes nothing from what an order holds.
- **The words of a renamed or merged model stay.** Typing a word now used
  only by merged models warns, as a similar name does, and offers the model
  that stays.
- **A rename that moves a model to another family** finds it as creating a
  model does: a family that could be the same is offered, never chosen
  silently.
- **«Звіт» names a merged model's line by the current name** of the model
  that stays. This replaces "named as it was last" (2026-10-02) for every
  model, so a renamed model also shows its new name.
- **The similar-name check** maps the Latin letters that look Cyrillic
  (a c e i o p x y k m t b h), ï and ё, and the different apostrophes.


## Owner decision — 2026-10-03 (one size, one spelling)

Asked when the owner chose it as the next work. A size was kept exactly as
it was typed when a product was created, so `M` and `m` became two sizes
with two separate balances, and two sizes cannot be put together afterwards.
It had been open since M1B, and the shops are about to type their stock.

- **Spellings that are one size:**
  - **case does not matter:** `m` = `M`, `xl` = `XL`;
  - **Cyrillic letters:** `М` = `M`, `Л` = `L`, `С` = `S`, `ХС` = `XS`,
    `ХЛ` = `XL`, `ХХЛ` = `XXL`, as the parser already reads them in a
    notebook line;
  - **a count of X's:** `2XL` = `XXL`, `3XL` = `XXXL`, `4XL` = `XXXXL`, and
    for every size with a count: `2XS` = `XXS`, `5XL` = `XXXXXL`.
- **A double size:** spaces and the kind of dash do not matter: `46-48` =
  `46 - 48` = `46–48`. `46/48` is another size, since a slash is written
  differently.
- **A size is shown in one spelling** everywhere (lists, the till, reports):
  capital Latin letters, `M`, `XL`, `46-48`, however it was typed. With
  several X's it is written out: `XXL`, `XXXL`. Whoever types `м` sees that
  the existing `M` was chosen.
- **The size system does not separate sizes.** `M` is one size whichever
  system was picked (letter, EU numeric or «Інша»). The system stays only for
  the order of the list.

Asked the same day, when a review of the design found it open: **`1XL` is
`XL`, and `1XS` is `XS`**, by the same rule, although some brands write
`1XL` for a size of their own.

How it is carried out, not decided by the owner:
- **A letter size inside a longer size is spelt too:** `48 (м)` is
  `48 (M)`, so a Cyrillic `м` there does not make a second size.
- **Latin letters are capitals in every size,** `os` → `OS`, `one size` →
  `ONE SIZE`. A Cyrillic word, such as «єдиний», keeps the letters it was
  first typed with; its case does not matter either.
- **Spaces matter only around a dash or a slash.** `46 48` is not `46-48`,
  and `2 XL` is not `XXL`: in a size field the `2` may be a count.
- **A size typed under another system is the existing one,** in its own
  system. Letter sizes read first in the list, by their X's, whichever
  system they were first typed in.
- **`UNKNOWN` is reserved in every system,** since a system no longer
  separates sizes: it is the "size not known" that only a legacy stock list
  states.
- **A spelling longer than 20 characters is refused,** as a name that grows
  when normalized is.
- **Records keep the spelling they froze:** a sale's receipt, a supplier
  return, a «Брак» unit. There is no shop database yet, so none holds an
  old spelling.
- **An upgrade over two existing sizes that are now one stops** and names
  them. Joining two sizes would move stock between balances, which no rule
  covers. No shop database exists yet.


## Owner decision — 2026-10-03 (before the public domain)

Asked when the owner chose to make the app safe to put on a public domain.
Personal data leaving the server, limits on what anyone may send, a blank app
after an update and the server's library versions are technical; these four
are about how the shops work.

- **A seller stays signed in for 12 hours** after opening the app, as now.
  Then the app is closed and opened again in Telegram; an unfinished
  operation is kept.
- **A lost phone:** on the owner's word, the administrator ends every
  sign-in of that person on the server, as people are added. The person
  keeps their access and opens the app again on the new phone.
- **The server is updated while the shops are closed**, in the evening or at
  night, so in the morning everyone opens the new version. An urgent
  security fix is the exception.
- **If the site's certificate cannot be renewed,** the owner is told by the
  bot a week before it runs out, as about a failed backup.

## Owner decision — 2026-10-03 (failures are visible)

Asked when the owner chose this work before the app goes on a server.
Until now nobody heard when something failed:
- a seller's screen that breaks goes blank;
- the server, its database or its disk can stop with nobody told.

How each failure is caught is technical. Who hears about it, how and how
often is the owner's to decide:

- **Trouble on the server is told to the owner and to an administrator,
  by the bot.**
  - Trouble means:
    - the app does not answer;
    - its database has stopped;
    - the disk is nearly full;
    - nobody can sign in.
  - The owner here means the people who hear about backups.
  - The administrator is not named yet. Their Telegram is added on the
    server once there is one.
  - Trouble is also shown in the «Резервні копії» section, as backups are.
- **With a sound in the shops' hours, 9:00–20:00 every day, Kyiv time;
  silently outside them.** Backup messages stay silent at any hour (owner
  decision, 2026-10-01).
- **A message once when trouble starts, once a day while it lasts, and once
  when it works again,** as with backups. The owner accepted the proposed
  thresholds:
  - the app has not answered for 5 minutes in a row;
  - less than 15 % or less than 3 GB of the disk is free;
  - for 10 minutes no sign-in has succeeded, while people kept trying.
- **A server that dies whole is noticed from outside.**
  - Every 10 minutes the server checks in with an outside service.
  - The service also checks that the site answers.
  - When the check-ins stop or the site does not answer, the service writes
    to the owner in Telegram or by email.
  - It learns only the site's address, never the shop's data.
  - The account is the owner's.
- **Error details do not go to Sentry yet.**
  - They stay in the server's log.
  - Sentry is prepared, and one setting turns it on once someone will read
    it.
- **A broken screen:**
  - the seller sees «Щось пішло не так» and «Перезапустити» instead of a
    blank screen, and an unsent sale is not lost;
  - a short note goes to the server's log only: which screen, which error,
    the app's version and the request's number;
  - the note never holds a name, a phone, what was typed, or the Telegram
    number;
  - the bot does not write about it.
- **The hot path's release reading (release checklist row 22) gates every
  case,** six sellers at once included, as it is written. It is taken on the
  laptop as before. A reading on the real server is an optional step.

**Carried out, 2026-10-03.** The owner's answers did not cover these; the
build took the readings below. The owner then confirmed three of them the
same day:
- **"Works again" sounds by the same hours** as the trouble it ends.
  Confirmed: "it fits".
- **An unsent sale.**
  - A sale sent whose answer never arrived is kept on the phone, and is
    checked after «Перезапустити», as before.
  - A basket still being filled lives only on the screen, and a broken
    screen loses it.
  - The crash screen says which of the two it is. It never claims a basket
    was kept.
  - Confirmed: if something happens to the app, the basket is emptied, and
    that is fine for now.
- **"While people kept trying"** means refusals from people, not strangers.
  The sign-in endpoint is open to anyone, so a refusal counts only when it
  comes from:
  - a Telegram user it could verify;
  - or, for a refused signature, someone the app knows.

  A refusal counts toward the alarm only when:
  - it is the third such refusal in 10 minutes;
  - the last one came in the last 5 minutes;
  - at least two people were refused. One is enough when their launch data
    was dated in the future, which only a wrong clock does.
- **The administrator hears of trouble on the server, not of backups.**
  Backups stay the owner's. Confirmed, for now.

**Also answered on 2026-10-03:**
- **Who is set up to hear.** The administrator's rights, and with them their
  Telegram id, are given when the app is published or tested. The owner
  says when; nothing is set up before that.
- **A sign-in alarm faked** with the Telegram ids of two of the shop's
  people is accepted for now. Keeping their phones is the people's own
  responsibility, and the check may be improved later.
- **The watcher lives on the server it watches.** Confirmed: the outside
  service is what notices that server dying whole.
