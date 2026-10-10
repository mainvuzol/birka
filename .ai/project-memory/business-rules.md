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

Customer postal delivery is separate from warehouse receipt/transfer. Goods at “needs dispatch” are ordered, not yet a completed sale. Reserve them; consume reservation and physical stock once at dispatch; arrival changes delivery status only. Pre-dispatch cancellation releases reserve; after dispatch require a real return. Normal warehouse receipt immediately adds stock. Child warehouse management requires explicit child-store permissions; organization-wide permissions alone do not bypass this. Owner confirmed on 2026-09-23: recognize the completed sale when the customer collects the goods, never at dispatch or postal arrival. Collection does not imply payment. *Since 2026-10-04 the seller says at collection how the order was paid: in advance by transfer, cash on delivery, or cash, card or transfer at the counter ("cash and card, the day's close"). Whether the carrier paid out the cash on delivery is checked later, as separate work.* See [implementation sequence and evidence](bootstrap-and-order-next-steps.md).

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
  deleted on a night whose run failed. *Amended on 2026-10-09:* the owner's
  own copies are deleted when older than 3 months too ("customers' data").
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

  **All three answered on 2026-10-08:** photos → parser → JSON, in a format
  Birka defines, every line reviewed by a person ("the shops' existing
  stock", below).

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
  «+38 (067) 123-45-67» and «0671234567» are one number. *Since 2026-10-10
  «8 067 123 45 67» and «0038 067 123 45 67» are the same number too
  (owner, "a closed store's debts").*
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
  child store does not change their own store's state.
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
    network-wide role. *Since 2026-10-10 only for the network's owner and
    managers, not a seller added to every store (owner, "a closed store's
    debts").*
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
  other stores' sales are. They are never listed whole. *Superseded on
  2026-10-10 by the owner's "a closed store's debts": only by the
  customer's whole phone, and only what is still owed.*
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
  cash or by card; that can be split later, as separate work. *Replaced on
  2026-10-04 by "cash and card, the day's close".*
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

## Owner decision — 2026-10-04 (cash and card, the day's close)

Asked when the owner chose this work. The app did not know how a customer
paid, so nobody could count the drawer against it:
- «Разом у касі» in the sales report took every sale, debt payment and
  return as cash;
- an order's whole price counted as cash on the day «Забрав» was pressed,
  though every order comes by a carrier.

This replaces "one sum of money" in the sales report (2026-10-02).

- **Three ways of paying:** cash, card on the terminal, and a transfer to
  the shop's card or account. One list for every store.
- **One way for each payment.** A sale is paid one way, and so is each
  payment toward a debt. A sale is never split between cash and card.
- **The seller gives the way with the button that sells.**
  - «Продати» becomes «Готівка», «Картка» and «Переказ», so a sale still
    takes five taps and nothing is guessed.
  - The seller presses in Birka first, then charges the terminal for the sum
    Birka shows: the sum can change after the press, when a coat is not on
    the shelf.
- **An order at «Забрав».**
  - The seller says how it was paid: in advance by transfer, cash on
    delivery through the carrier, or at the counter.
  - Only cash paid at the counter is the drawer's.
  - Checking that the carrier paid out the cash on delivery is separate,
    later work.
- **Money handed back on a return** goes the way the sale was paid, unless
  the seller changes it, for example a card sale returned in cash.
  - Money returned to a card does not leave the drawer.
  - The same holds for a return taken at another store, and for cash handed
    back on a sale paid in parts.
- **The day's close.**
  - One drawer per store, closed once a day.
  - The seller on duty counts the cash and types it without seeing what the
    drawer should hold, then sees the difference.
  - What was counted is the next day's cash for change.
  - Card and transfer are not counted. Their sums are shown, to compare by
    eye with the terminal's end-of-day slip.
- **Cash taken out of the drawer** is recorded with who took it and why:
  for the owner, for expenses, for a supplier's courier.
  - The owner and managers record any.
  - A seller records only expenses.
- **A difference** is recorded with a reason, which is required. The bot
  tells the owner, **silently** at any hour, as with backups.
- **After the close.**
  - Selling goes on, and what is sold after the close goes into the next
    one.
  - A closed day is never reopened. The owner or a manager fixes a mistake,
    such as a wrong way of paying or cash taken out and forgotten, with a
    correction dated the day it is made.
  - Before the close, a seller may fix the way of paying on their own sale.
    The fix is recorded.
  - A day nobody closed goes into the next close, and shows as not closed.
- **A blocked store** can only be read, with one exception: the owner may
  still count and close its day.
- **Who sees the split by way of paying, and the closes:** the owner and
  managers, as with the sales report. A seller sees only the result of
  their own close.
- **Fiscal receipts (ПРРО) are not part of this.** Birka stays the shop's
  own record. Whether the shops must issue them is for the owner or the
  accountant.

Not asked, because nothing is live: sales recorded before this change are
test data. Their way of paying reads «не вказано», and is never guessed.

**Also answered on 2026-10-04,** when the design raised what the answers
above did not settle:
- **The first close of a store** only records what is in the drawer, with
  no difference, and that sum is where the next day starts. The same holds
  after a store comes back from the archive.
- **A correction of a closed day explains that day's difference.** It is
  dated the day it is made and shows in that day's report, but it does not
  change what the drawer should hold now: that money was already counted.
  The closed day then shows its difference as explained. The same holds for
  cash taken out and forgotten.
- **A close before 6:00 belongs to the evening before,** so a drawer closed
  at 00:10 can be closed again that evening. One close per such day.
- **Cash put into the drawer** (change brought in) is recorded as «Внесено в
  касу» by the owner or a manager, so the evening's count does not show it
  as a surplus.
- **The bot tells the network's owner only,** and not when the owner closed
  the drawer themselves.
- **The reason is enforced on the phone.** Until whoever counted writes the
  reason, only «Каса» stays open on their phone, and only they may write
  it. The bot waits up to 15 minutes for it, then writes without it.
- **An order paid at the counter** may be paid in cash, by card or by
  transfer. «Клієнт забрав» offers five choices: in advance by transfer,
  cash on delivery, or cash, card or transfer now. The counter money is paid
  when the customer collects.
- **Cash taken out** is of three kinds: for the owner, for expenses, for a
  supplier's courier. There is no «Інше», and the note is optional.
- **A difference under 1 грн** is recorded but needs no reason, and the bot
  does not write about it.
- **Before the close, a seller may fix the way of paying on any of their own
  operations:** sales, debt payments and returns.
- **A count that reaches the server more than 10 minutes late** is not
  recorded. The phone says to close the drawer as usual in the evening, and
  that day goes into that close.

**Carried out, 2026-10-04.** How it is carried out is technical, not
decided by the owner:
- **Each money operation is placed in its drawer's day by the order it was
  written in, not by its time.** The database does it under the store's
  lock: a sale made while the drawer is being closed goes into that close or
  the next one, never both and never neither.
- **A close is one record, never changed.** Every figure is fixed when it is
  made: the cash it started from, cash in and out, cash taken out and put
  in, the fixes of that day, what the drawer should hold, what was counted,
  and the difference. Card, transfer, the order ways and «не вказано» are
  kept beside. What explains its difference later is shown beside it.
- **The reason is a second step.** The count is recorded at «Так, закрити»;
  the reason comes after it, as its own record. Asking for both at once
  would show the difference before the count was final, and let it be typed
  again.
- **A fix of today's operation** changes what the drawer should hold now.
  **A fix of a closed day,** and cash taken out recorded against a closed
  close, change nothing now: that close then shows «Пояснено …» and «Не
  пояснено …». In «Звіт» a fix counts on the day it is made.
- **The bot's timing.** The watcher looks every minute. It writes once the
  reason is recorded, or 15 minutes after the close without it, and tries
  for a day. A close older than a day is no longer told.
- **A refusal says when nothing was recorded** (`recorded: false`), so a
  phone that never heard the answer stops waiting. An operation recorded
  before its store was blocked or archived is still answered with what it
  did; only a new one is refused.
- **Cash taken out after a close the form did not show.** It goes on that
  close only while it is the store's newest and was made at most ten
  minutes ago, by the server's clock. Otherwise it is not recorded: it is
  recorded again after the close, or the owner or a manager records it
  against that close.
- **Someone else closed while the count was typed:** the count is not
  recorded, and the phone says who closed and when.
- **An operation kept on a phone from before this change** and never
  recorded is refused when it is resent. The phone says to do it again and
  to say how it was paid.

**Confirmed by the owner on 2026-10-08, all 36 as built.** They were built
as the design recommended, or as the build read the rules, and were put to
the owner in Ukrainian, four to a question:
1. An order collected in parts: the part paid now may be any of the five
   ways, in advance or on delivery included. (G2)
2. An order paid partly in advance and the rest on delivery is recorded as
   «Накладений платіж». (G3)
3. A return of an order paid in advance or on delivery suggests
   «Переказом»; the seller may change it. (G4)
4. A return of a sale whose debt was paid in different ways suggests
   nothing, and the seller chooses; an old sale suggests nothing either.
   (G5)
5. A day nobody closed shows as «не закрито» in «Каса» and in the next
   close's message, and only if something was sold, paid, returned or
   taken out that day. (G9)
6. The owner and managers see no expected sum on the close form either, but
   a manager can work it out from «Звіт». (G13)
7. Only the network's owner closes a blocked store, not a network manager or
   a child store's owner; an archived store's drawer is not closed. (G14)
8. Nothing is taken out, put in or fixed in a blocked store; money the owner
   takes at its close is recorded «Власнику» after it is unblocked. (G15)
9. Cash taken out is recorded whenever it is taken; the close reminds to
   record it first. (G19)
10. A supplier's courier paid from the drawer is two records: the take-out
    in «Каса», and the invoice's payment in «Накладні» by a manager. (G20)
11. A miscounted close is not fixed: the next close shows the opposite
    difference, with its reason. (G21)
12. Card and transfer at a close cover the time since the previous close,
    not the calendar day, so after a day not closed they will not match one
    slip. (G22)
13. In «Борги» the three buttons «Готівка», «Картка» and «Переказ» replace
    «Прийняти внесок». (G23)
14. «Звіт» shows no cash taken out; orders paid in advance or on delivery
    have their own lines outside «Разом»; «Разом у касі» is now «Разом» and
    «Гроші в касі» is «Гроші». (G24)
15. A card the terminal refused, and a customer who left without the goods:
    a return «На картку». (G25)
16. A store may be archived with its drawer not closed; the owner closes it
    first if they wish. (G26)
17. After their close the seller sees what the drawer should have held, what
    they counted, the difference, and card and transfer, but not the order
    sums. (G27)
18. A note on a fix of the way of paying is optional. (G28)
19. Before their count a seller sees no list of their sales with sums or ways;
    a sale's way shows only on the one sale being returned or fixed. (G32)
20. A seller may record «Кур’єру постачальника», not only «Витрати». (G34)
21. A return of a sale paid in parts that only lowers the debt does not ask
    how the money goes back. (G35)
22. A customer who wants to pay part cash and part card pays one way, or
    the basket is sold as two sales. (G36)
23. Nobody sells while the drawer is counted; the form says «Поки рахуєте,
    не продавайте.» (G37)
24. A transfer that never arrived after the goods were handed over: the
    receipt asks to check first; if it never comes, a return, or the owner
    settles it outside the app. (G38)
25. A return «Переказом» is recorded at once, and whoever holds the shop's
    account sends the money. (G39)
26. No message when a day goes unclosed; the next close's message names
    it. (G42)
27. A card and cash mix-up found on the terminal's slip after the close is
    fixed by a manager or the owner, not the seller, and explains that
    close's difference. (G43)
28. A return of an order paid in advance or on delivery hands the money back
    through the till, and lowers «Разом» in «Звіт», not the order's own
    line.
29. «Продажі» in «Звіт» still counts every sale, orders paid in advance or
    on delivery included; only their money is outside «Разом».
30. Cash taken out sent after a colleague's close, more than ten minutes
    later or after two closes, is refused, and recorded again or by a
    manager against that close.
31. Cash taken out from a form opened before a colleague's close goes on
    that close, as money taken before it; the phone says «Записано до
    закриття …».
32. A seller sees the way of every debt payment and return in «Борги», a
    colleague's included.
33. A seller's return screen shows the sum and the way of any sale they may
    return, one sale at a time.
34. A seller who closed before their store was blocked still writes their
    close's reason after the block.
35. The closer's phone waits for the reason in whichever store of the
    network it opens.
36. «Закриття» shows the owner and managers 20 closes at a time, from a
    year back, with «Показати ще».

Built on 2026-10-04; see the [report](cash-and-card-report.md) and
[ADR-0012](../decisions/ADR-0012-cash-and-card.md).

## Owner decision — 2026-10-04 (the server is unreachable)

Asked when the owner chose this work. Until now the phone said «Сервер зараз
недоступний», recorded nothing, and said nothing about what to do with the
customer at the counter. A read-only mapping (four readers and a critic)
found what happens today:
- a basket already built can be sent and is kept on the phone until the
  server answers, and that phone sells nothing more until then;
- a basket not yet built cannot be built, because the stock list will not
  load;
- when the whole server is dead or the shop has no internet, the app does
  not open at all;
- the drawer cannot be closed, and the bot tells the owner after 5 minutes
  that sellers cannot sell.

- **The shop keeps selling, on paper.** The seller writes down the model,
  the size, the price, how it was paid and the time. When the server
  answers, the sales are typed in as ordinary sales. The app says so, and
  helps type them in. An offline mode in the app may be judged later, on
  real outages.
- **Whoever can, types them in, whenever they can.** There is no rule
  about who or when.
- **A late sale is dated the day it is typed,** as the paper sales of the
  first days are, and carries the mark «продано під час збою». The mark
  may name who sold and at what hour, from the paper; both are optional.
  «Звіт» then shows who sold and who typed. No earlier rule changes: a
  past day's report never changes, and the drawer counts by the order
  things were written.
- **Goods that are already gone from the ledger** when a late sale is
  typed, because a colleague's late sale took them or the balance was
  short: the sale is refused, and a manager fixes the balance first. It is
  the same order as for a paper sale from a later delivery. An empty shelf
  is reported only while standing at it, never afterwards.
- **The drawer is not closed while the server is down.** The seller
  counts the cash and writes the sum down for their own record. The drawer
  is closed the next evening: two days in one close, and the outage day
  shows as not closed. This is how it already works.
- **A cash sale of the outage typed after that day's close** leaves a
  surplus on that close and a shortage on the next, both with the reason
  «продаж під час збою». Both stand. The app reminds to type the outage's
  sales before the close, so the pair does not arise.
- **Debts, returns and orders go on paper too,** and are typed in later.
- **A debt payment taken on paper that the server refuses** when typed,
  because the debt was paid meanwhile or less is owed: it stays refused,
  and the extra money is given back to the customer. Until then it shows
  as a surplus of the drawer, with its reason.
- **What the seller is told:** «Сервер не відповідає. Продавайте на
  папері: модель, розмір, ціна, як оплачено, час. Коли сервер відповість
  — внесіть продажі до закриття каси.» Nothing about phoning the owner:
  the bot tells the owner itself.
- **An operation the server never answered** stays on the phone, as
  today, and the phone checks it itself as soon as the connection is back.
  Every sale of an outage stays on paper until the app shows it recorded;
  a lost phone then loses nothing that is not on paper.
- **The app does not open without the server,** when the server is dead
  or the shop has no internet. Paper. This keeps the earlier decision that
  no phone holds an old page, so updates stay safe.

## Owner decision — 2026-10-07 (the server is unreachable: what the 2026-10-04 answers left open)

Asked after the design of the outage work and its review (two lenses, 25
findings). Each answer is the recommended one.

- **An operation kept on the phone is not typed from paper.** The seller
  writes it on paper as well, marked «у телефоні — <ім’я>». Nobody types
  that line until the same phone says «не записано»; the phone checks it
  itself. If the phone is lost, a manager types the line after checking
  «Звіт». Typing it anyway would record the same sale twice: the server
  cannot tell the two apart.
- **Cards are taken during an outage,** charged on the terminal at once,
  with no receipt from the app. A sale typed from paper then says the card
  was charged during the outage and must not be charged again, in place of
  «Проведіть на терміналі». A kept sale the phone confirms by itself says:
  if the card was already charged, do not charge it a second time. A card
  debt payment that is refused goes back to the card through the terminal.
- **The paper switch stays on for a series of paper sales.** The pay
  buttons say the mode and, under them, who sold and from which warehouse
  («З паперу · Готівка»), so a forgotten switch is seen before the press.
  A wrong mark cannot be changed afterwards.
- **The paper records the warehouse** the goods left from, in a store that
  sells from two (its own and the shared one). Whoever types it chooses
  that warehouse.
- **When the server answers before 6:00** the same night, the seller types
  everything from paper first, then closes the drawer. If it does not, the
  drawer is closed the next evening, as decided on 2026-10-04.
- **The time from paper is an hour, with «вчора»** when it is typed the
  next day: today or yesterday only. An older sale is typed with no time.
- **The mark is on sales only.** Debt payments and returns typed from paper
  are ordinary ones; «Звіт» names who typed a return, «Борги» who took a
  payment (corrected 2026-10-08). A mark for them may be added later.
  *Superseded on 2026-10-10: they carry the mark too (owner, "returns and
  payments typed from paper").*
- **A kept sale recorded once the server answers carries no mark.** It is
  an ordinary sale, dated when it was recorded, sold by the phone's owner.
- **«Клієнт забрав» refused because the order was cancelled or came back
  meanwhile:** the goods are typed as a sale from paper, at the order's
  prices, with the mark.
- **Goods sold on paper and reserved for an order meanwhile:** a manager
  cancels or changes the order, not the balance; then the paper sale is
  typed.
- **A refused debt payment when less is owed:** the sum still owed is
  taken and the rest goes back to the customer: cash from the drawer, a
  card through the terminal, a transfer by transfer. Cash given back after
  the close shows a surplus, then a shortage, each with its reason.
- **A debt payment taken on paper in another store** while the selling
  store was blocked, refused once that store works again: the app says to
  pass the paper to a manager, who decides each case.

Also answered on 2026-10-08, after the review of the built change (each the
recommended option):
- **A lost phone's lines:** a manager checks its sales and returns in
  «Звіт» and its debt payments in «Борги», where each debt's history names
  who took each payment and when. «Звіт» shows debt payments only as one
  sum, so checking it alone could type a recorded payment a second time.
- **A kept return the phone confirms by itself** says, as for a card: if
  the money has not been given back yet, give it back; if it was given back
  while the server did not answer, do not give it back a second time.
- **A store blocked, or a warehouse closed, while a phone keeps an
  operation there:** the server refuses the resend before it looks the
  operation up, so the phone keeps it, and that store's screens on that
  phone wait, until the store trades again or the warehouse reopens. Then
  the phone checks it by itself. Nothing is recorded twice or lost, and the
  phone works in other stores. Kept as a known risk; no button to discard
  it.
- **The app does not open at all:** the seller checks the shop's internet;
  if there is none, they tell a manager, and sell on paper meanwhile. The
  bot knows only of the server's own failures, not of one shop's internet.

How it is carried out, not decided by the owner:
- **A refusal says when nothing was recorded** (`recorded: false`), now on
  every command a seller sends, whenever it is refused after the command
  was looked up: a sale, an empty shelf, a debt payment or a write-off, an
  order's step, a return, a delivery and a stock correction. A phone that
  never heard the answer stops waiting. A refusal about the command's own
  identity never says so.
- **A database that does not answer, or is not updated for this version,**
  answers «Сервер тимчасово недоступний.» (503), so the phone shows the
  owner's text, not a server error with a number. A fault in the code still
  shows its number.
- **The phone checks a kept operation by itself** with the same command,
  never a new one. While something waits, it asks the server every 20
  seconds whether it answers.
- **The mark is stored on the sale and never changed:** who sold, if named,
  and the paper's time, if given. Who typed stays the sale's seller. The
  sale's date, its day in «Звіт» and its drawer are those of the moment it
  was typed.
- **A marked sale is checked after it is looked up,** so one recorded, its
  answer lost, and resent days later, or after the named seller left, is
  answered as recorded.
- **A marked sale cannot answer the shelf** («Товар на місці», «На полиці
  немає жодної», a size from the label): nobody stands at the shelf when the
  paper is typed.
- **The paper's time may be up to 5 minutes ahead** of the server's clock,
  for clocks that differ; any later is refused.

**Confirmed by the owner on 2026-10-08, all fourteen as built.** They were
built as the design recommended ([ADR-0013](../decisions/ADR-0013-the-server-is-unreachable.md))
without being asked; each was then put to the owner with the question under
it, and each answer was the recommended one. G14 and G20 confirm the sellers'
page ([paper-when-the-server-is-down.md](paper-when-the-server-is-down.md)),
which is no longer a draft. The four answers of 2026-10-08 above (a lost
phone's lines, a kept return confirmed by the phone, a store blocked or a
warehouse closed while a phone keeps an operation there, the app that does
not open at all) were decided before.
1. A paper sale of a model the ledger holds only «без розміру» is typed as
   «розмір невідомий»: in paper mode the till does not offer the size from
   the label. (G3)
   - Питання: «Якщо в обліку ця модель є лише "без розміру", а на папері
     записано розмір — вносити як "розмір невідомий" чи уточнювати розмір за
     папером?»
2. Whoever is named as the seller is an active person who may sell in this
   store now, by a grant for this store or for the whole network, never
   someone of another network. Someone who has left since cannot be named;
   the field is left «Не вказано». (G4)
   - Питання: «Продавця, якого вже звільнили, вказати не можна — залишаємо
     "не вказано". Так?»
3. The mark is the word of whoever types it: nothing checks the named seller
   or the time, and «Звіт» names whoever typed. (G5)
   - Питання: «Позначка — зі слів того, хто вносить; перевірити її нічим. Так
     прийнятно?»
4. The close form's reminder to type the paper first is always shown, not
   only on a phone that saw the server down that day: another phone may have
   seen it. (G7)
   - Питання: «Нагадування "спершу внесіть усе з паперу" показувати завжди на
     формі закриття каси?»
5. Under «Чому не збігається?» two quick choices fill the reason, which can
   still be edited: «Продаж під час збою», and «Повернення чи внесок під час
   збою» for the pair a return or a debt payment typed after the close
   leaves. (G8)
   - Питання: «Додати до причини розбіжності кнопки-підказки «Продаж під час
     збою» і «Повернення чи внесок під час збою»?»
6. The bot's words: «Продавці продають на папері.» when the server does not
   answer, «Сервер знову відповідає: продажі з паперу можна вносити.» when it
   answers again, and «Хто ще не увійшов, продає на папері.» when nobody can
   sign in. (G10)
   - Питання: «Бот пише "Продавці продають на папері" і, коли сервер
     відповість, "продажі з паперу можна вносити". Так?»
7. The phone checks by itself every kept operation a seller can hold: sales,
   debt payments, returns, orders, deliveries, stock corrections, catalogue
   operations and «Каса». Changes to models, stores, invoices and returns to
   a supplier keep their button. (G11)
   - Питання: «Застосунок сам перевіряє незавершені продажі, внески,
     повернення, замовлення, приймання, коригування, операції каталогу й
     касу; зміни моделей, магазинів, накладних і повернень постачальнику —
     кнопкою. Так?»
8. It checks once when the server answers again, and once each time the app
   is opened with a kept operation, after sign-in and choosing the store:
   the same resend the button sends. (G12)
   - Питання: «Після перезапуску застосунку незавершений продаж (внесок,
     повернення) перевіряти одразу самому, як після повернення зв’язку, чи
     лишати кнопку «Перевірити результат»?»
9. The owner's text is shown on every screen: the owner's and managers' too,
   «Брак» (followed by «Повторне натискання безпечне.»), and under
   «Застосунок не завантажився». The managers' own "press again, it is safe"
   texts stay. (G13)
   - Питання: «Текст "Сервер не відповідає. Продавайте на папері…" показуємо
     всім, і власнику та менеджерам, і в «Браку». Так?»
10. The sellers' page: what the paper records beyond the five items (who
    sold; for a sale in parts, the customer's name and phone and the part
    paid; a debt payment, a return, a collected order), and its rules: the
    card, «у телефоні», the switch always on, the warehouse, the close, and
    what to do when the app refuses. (G14)
    - Питання: «Чи погоджуєте інструкцію для продавців: що записувати на
      папері для частинами, внесків, повернень і замовлень, і правила про
      картку, «у телефоні», перемикач і склад?»
11. A kept sale refused for any reason that proves nothing was recorded, not
    only for stock, says «Продаж не записано (<причина>). Якщо товар віддали
    покупцю — внесіть його з паперу з позначкою «Вношу продаж з паперу».»;
    goods gone from the ledger are typed after a manager fixes the balance.
    (G15)
    - Питання: «Продаж, який чекав на сервер і не пройшов (з будь-якої
      причини): застосунок каже, що його не записано, і якщо товар віддали —
      його вносять з паперу (коли товару вже немає в обліку — після
      виправлення залишку). Так?»
12. The mark shows on the receipt, on a kept marked sale's confirmation, in
    the sales list and in «Звіт»; not in «Каса» or the bot's message. (G16)
    - Питання: «Позначку видно в чеку, у списку продажів і у «Звіті»; у «Касі»
      її немає. Так?»
13. The other new texts of the app, as a whole: the banner's line, the
    switch, its band and the buttons, the till's refusals and their reserved
    variant, the marked receipt and the confirmations, «Борги» by the way
    paid, a kept sale's refusal, a late «Клієнт забрав», «Каса» and the crash
    screen (listed in ADR-0013). (G17) Built beyond the design, and in the
    same list:
    - «Борги»: a kept payment refused because nothing is owed any more reads
      only «Борги»'s own text, which already says «внесок не записано», with
      no «Внесок не записано.» before it; and the screen's own check of a sum
      over the debt says what the owner decided on 2026-10-07: take what is
      owed, give the rest back by the way it was paid.
    - A kept sale refused while units are reserved for an order says
      «частина цих одиниць у резерві замовлення — спершу менеджер має
      вирішити із замовленням».
    - Inside «Продаж не записано (…)» the till's reason starts lower-case and
      loses its final full stop.
    - The mark leaves out a seller or a paper time that was not given.
    - The line under the pay buttons says «склади: A, B» when the basket
      takes goods from both warehouses.
    - The text for a late «Клієнт забрав» (G24) is shown only when the server
      says the order was cancelled or returned. A «Клієнт забрав» refused
      for another reason, such as the order already collected from another
      phone, gets its ordinary text, which does not say to type it from
      paper.
    - Any other kept operation refused on resend, proven to have recorded
      nothing, says so before why: «Коригування не записано. …» (with the
      correction screen's own reason, such as «Поки ви рахували, облік
      змінився: …»), «Приймання не записано. …», «Операцію «<назва>» не
      записано. …» for an order's step, «Операцію каталогу не записано. …»
      and «Зміну каталогу не записано. …». It does not say what to do next,
      such as typing a delivery again.
    - The exact words of a kept return the phone confirms by itself (decided
      2026-10-08): «Якщо гроші ще не повернули — <як повернути>. Якщо вже
      повернули, поки сервер не відповідав, — не повертайте вдруге.»
    - A kept return of another store's sale, confirmed by the phone, names
      the warehouse of this store the goods went into; when its name cannot
      be read: «Цілий товар повернуто на склад вашого магазину.»
    - Питання: «Чи погоджуєте нові тексти застосунку (список додається)?»
14. A paper sale typed without «Вношу продаж з паперу» could be offered
    «Товар на місці», and the ledger would record a found coat that never
    was. Unticking the switch clears a basket already built, and the
    sellers' page says to switch it on always; a basket built without it from
    the start is taken as the seller's word. (G20)
    - Питання: «Якщо продаж з паперу внести без «Вношу продаж з паперу»,
      застосунок може запропонувати «Товар на місці», і облік запише
      знайдений товар, якого не було. Вимкнення перемикача для вже зібраного
      кошика очищає кошик, а в інструкції пишемо «завжди вмикайте»; решту
      приймаємо як «зі слів продавця». Так?»

Built on 2026-10-08; see the [report](outage-fallback-report.md) and
[ADR-0013](../decisions/ADR-0013-the-server-is-unreachable.md).

## Owner decision — 2026-10-08 (the shops' existing stock)

Asked on 2026-10-08, after PR #70. It answers what 2026-10-01 left open
("going live"): which of the two ways, the JSON's shape, and whether its
lines pass through review.

- **The shops' existing stock goes in by photos → parser → JSON.** The shops
  photograph their notebooks and tables, a parser reads them into JSON, and
  the app imports the JSON. The owner chose this over lists typed by hand.
- **Birka defines the JSON's format.** Birka describes the format and builds
  the import into the app; neither was done yet when this was decided (both
  built on 2026-10-08, below). The parser, whoever makes it, produces that
  file.
- **What a line holds.** A notebook line names the model, its size and its
  count, and sometimes its colour and a price.
- **The price is only shown.** It is the sale price or the purchase price,
  depending on the notebook. It stays with the line as the notebook's record
  and is shown during review. It never sets a model's price, which is set as
  today.
- **Every line is reviewed by a person,** as in «Початкові залишки» today:
  the parser's reading is a hint, a person confirms or corrects each line,
  and the owner approves the list. A model is never guessed.
- **Several files fill one list.** How many lines a warehouse holds is not
  known, and may be more than the 1 000 a list takes today. A warehouse's
  list is filled from several files (a notebook each, say), reviewed in
  parts and approved together, and the list's limits are raised.
- **The photos stay with the shops.** Birka keeps no photo: each line keeps
  the photo's name and its line number on it, to find it again.
- **The file is uploaded in the app,** in «Початкові залишки», by whoever may
  import a list today (the owner or a manager).
- **A file added by mistake is removed** (asked later the same day): the
  wrong notebook, or the wrong warehouse. While the list is not approved, the
  owner or a manager removes that one file, with its lines and the answers
  given to them. The list's history keeps who removed it and when, and the
  rest of the list stays as it was.
- **The owner and the managers review the lines,** as in «Початкові залишки»
  today; sellers do not. Only the owner approves the list.

Answered the same day, to the design's questions:
- **Removing a file needs no reason:** the history shows who removed it and
  when. Any manager or the owner may remove any file, not only whoever added
  it. The last file of a list is not removed: the list is rejected instead,
  and its warehouse is released. A removed file may be added again, as a new
  file, whose lines are answered anew.
- **Lines typed by hand** may be added to a list of files as a part of their
  own, for a page the parser could not read. They have no photo reference,
  and are reviewed the same way.
- **The parser's count is only a hint unless the line's text shows it.**
  When the parser's count differs from the count the text states («3 шт»
  read as 5), or the text shows no count at all, neither is taken: the
  person looks at the photo or the goods and states the count, with a note.
  A line with no count but with numbers, a price or a numeric size («Лоран 46
  1200»), is answered as today: with a note, never as one piece in one tap.
- **Counts per size occur in the notebooks** («S-1 M-2 L-1»). The file
  carries a count for each size, and a split that the line's text shows,
  each size with its count, is confirmed by a tap, without a note. For this
  case only, it changes the rule that a split is never "stated" (ADR-0005).
- **Every written line is passed on,** crossed out, illegible, a heading or
  a total included, with the parser's note («закреслено», «нерозбірливо»).
  The person decides, for example «Це не товар» with a reason.
- **One notebook holds one kind of price,** sale or purchase: the kind is
  given once per file.
- **The warehouse waits for the whole review,** even when it takes days: the
  rule of 2026-10-02 stands, and the shops sell from it on paper meanwhile.
- **A number without «шт» is not a count by itself,** even when the parser
  says it is («Бомбер M 3 1200», the parser reading 3 as the count). The
  parser's number is shown as a hint; the person states the count with a
  note, as today for a bare number. Notebooks kept as tables may have many
  such lines.
- **One size with its count** («Лоран M-3») is confirmed by a tap, as
  «S-1 M-2 L-1» is, but only when a sign stands between the size and its
  count («M-3», «M:3», «M=3»), in one size or in several. «M 3», with a space
  alone, is a number without «шт»: the person writes a note («Бомбер M 3
  1200», above).
- **A list of the shared warehouse belongs to both stores:** the managers of
  either store who may import lists see it, add files to it and review its
  lines. The app does not offer to start a second list for a warehouse whose
  list is waiting.

Answered later the same day, after hearing the measurement (ADR-0014 §10):
- **The limit stays at 5 000 answers per list** in this change. The shops
  first count the notebooks of their largest warehouse roughly (pages ×
  lines per page). If it comes out above 5 000, the limit is raised by a
  separate change to the ledger (the approval and its reading of the
  reservations), before going live.

Answered on 2026-10-09:
- **The largest warehouse comes to at most 5 000** (the owner's answer: «До
  5 000»). So the limit is not raised before going live, and raising it
  stays in the [backlog](backlog.md), for a warehouse whose files still
  come out above 5 000.
  The validator still gives each file's exact lines before the first is
  uploaded, and a file or an answer that would take a list past 5 000 is
  refused, saying the list is full (`LIST_FULL`).

Until the import is built, the rules of 2026-09-29 stand: an opening balance
only into a warehouse with no history, and only as the answer to a list.
With the import built, they still stand: its files fill such a list.

How it is carried out, not decided by the owner
([ADR-0014](../decisions/ADR-0014-opening-stock-from-a-json-file.md)):
- **The file's format is strict.** Birka describes it for the parser's
  author ([`formats/birka-stock-list/`](../../formats/birka-stock-list/README.md)):
  a key it does not know, a number written as text or as `3.0`, an empty
  value, a line break, a line separator or another control character inside
  a line, or the same photo and line twice is refused, and the refusal
  names the line. The phone checks a file before sending it; the server
  decides. A refusal never sends the file back; a key it names is cut to
  its first 60 characters.
- **Birka reads each line's text itself.** The parser's count is taken only
  when Birka's own reading of the text finds the same count with «шт»; the
  file can never make a count certain on its own word.
- **A split counts as shown** only when each size stands in the text once,
  as a whole word, joined to its count by one sign (`-`, a dash, a minus,
  `:` or `=`), the counts add up to any total the line gives, and the line
  names at most one colour and no «/» options. «M 3» never counts, nor
  «462» as size 46 with 2. Since the review of 2026-10-09, also:
  - the count ends with its digits: «M-3+2», «M-3 + 2», «M-3,5», «M-3/2»,
    «M-3х2» or «M-3½» holds no count of M;
  - the size stands in the text once in any of its spellings: «M-3 М» with
    a Cyrillic М writes M twice;
  - the text shows nothing beside the split: no other size, whether the
    parser reads it («Лоран S M-3») or it is a letter size the parser does
    not know («Лоран S-1 M-2 XXXL», «M-3 XXS»); no other size with a count
    («Лоран S-1 M-2 L-4» when the parser gave only S and M); and no other
    number, of any script, but the file's price, a count with «шт» or a
    length («S-1 M-2 L-1 разом 5» and «46-2 48» are answered with a note).
    A number the file calls the price is excused on the parser's word, so
    «46-2 48» with the price 48 shows its split (reading R-f, awaiting the
    owner, below).
- **A list's lines over its whole life** are at most 10 000, removed files'
  lines included, twice the 5 000 that count (reading R-b, awaiting the
  owner, below).
- **Lines typed by hand are removed as a file is,** with the answers given
  to them (reading R-c, confirmed as built by the owner on 2026-10-09, below).
- **A file may leave the kind of its prices out;** the prices are then
  shown without a kind (reading R-d, confirmed as built by the owner on 2026-10-09, below).
- **A removed file's lines stay in the list as «Прибрано»,** with their
  text, and count nowhere. The answers given to them are deleted; each stays
  in the list's history.
- **A file is sent once.** A resend after a lost answer adds nothing twice,
  and a file whose content is already in the list is refused.
- **Line numbers continue across files,** so a removed file leaves a gap.
- **Through the other store,** a list is reached when that store may receive
  goods into the warehouse and the person may import lists there, as in
  their own store. The list keeps the store that started it, and so do the
  opening movements of its approval; lines added through the other store
  name it in their evidence, and so does the history of every answer given
  through it.
- **While the store that started a list may no longer receive goods into
  its warehouse,** the list is only rejected through the other store, as
  while that store does not trade (reading 8): its approval would act
  through that store (review, 2026-10-09).
- **The approval writes the whole list at once,** or nothing. Its limit was
  measured: 7.6 s at 5 000 answers, while 10 000 fails in the ledger
  (ADR-0014 §10); the owner kept 5 000 (above). Measured again on
  2026-10-09 with every answer by size, which the approval reads again: at
  most 8.6 s, within the 10 s rule.
- **What a person sees is guarded:** control, invisible and bidirectional
  characters in a line, and in the names and reasons shown beside it, are
  shown as marks, never applied; the joiner and selector inside an emoji of
  a person's name («Оля ❤️») are left as they are.

**Answered by the owner on 2026-10-09.** Built as the design read the rules,
without being asked, then each put to the owner with the question under it.
Seven were confirmed as built; two changed (5 and 8), and both changes were
built the same day. The review of the built change, the same day, found
that reading 1's question did not say what is built: it was put again
(R-a, below), and confirmed as built.
1. While a warehouse is paused, its list is seen only from the store that
   started it, and there it can only be rejected. Files are added, lines
   answered and the list approved again once the warehouse reopens, when the
   other store sees it again too. **Put again and confirmed as built**
   (review, 2026-10-09): the owner had confirmed it on the question below,
   which said the list could be changed there, while the build lets that
   store only reject it; the question as built, R-a, was confirmed the same
   day.
   - Питання (2026-10-09): «Поки склад призупинено, його список видно й
     можна змінювати лише з магазину, який цей список почав. Так?»
2. The same file is refused a second time in one list, whatever its name,
   while it is not removed. A file whose photos and lines are partly in
   another file of the list is taken, and the app says how many. Lines typed
   by hand are not checked, and the same file may go into another
   warehouse's list.
   - Питання: «Той самий файл двічі в один список не приймаємо; файл, що
     частково повторює інший (ті самі фото й рядки), приймаємо й кажемо,
     скільки рядків повторюється. Так?»
3. Beside the 5 000 answers the owner kept, a list holds at most 5 000
   lines, as many as answers; a file at most 1 000 lines; a list at most
   1 000 parts — files and lines typed by hand — removed ones included. A
   line naming several sizes takes one answer per size, so a list full of
   such lines can run out of answers before its last line, and the shops'
   count counts each such size.
   - Питання: «Список бере до 5 000 рядків і 5 000 відповідей; рядок із
     кількома розмірами бере по відповіді на розмір, тож у підрахунку зошитів
     такий рядок рахується стільки разів, скільки в ньому розмірів. Файл — до
     1 000 рядків, у списку до 1 000 файлів. Так?»
   - The question did not say that the 1 000 counts parts — files and
     lines typed by hand — removed ones included: that part was **put
     again and confirmed as built** (R-e, below; review, 2026-10-09; worded
     so in its third round, the same day). The like bound of lines, 10 000
     with removed files' lines, was not among the readings; it is R-b.
4. A split is confirmed by a tap only when each of its sizes is already in
   the catalogue under that spelling; otherwise the size is created first, or
   the line is answered with a note.
   - Питання: «Розподіл по розмірах підтверджується одним натиском, лише коли
     всі його розміри вже є в каталозі; якщо розміру немає — спершу створити
     його або відповісти з приміткою. Так?»
5. «42-44» may pass for size 42 with 44 pieces when the parser reads it so.
   **Changed by the owner:** when a size with its count may also be read as a
   range of sizes, the app asks the person what the record means, and the
   person chooses; the tap is offered only after «розмір 42 — 44 шт» is
   chosen. **Built** (2026-10-09; ADR-0014 §5), and widened after the review
   the same day. A record may be a range when any one of these holds:
   - its size and count are both numbers, and the count, as written, reads
     as a larger size after it («42-44», «42-58», «98-104»), whatever the
     catalogue holds;
   - its count is a size of the catalogue under one spelling («M-3» with a
     size «3»);
   - the whole record is («42-44», a size of its own).

   The line's editor then asks «Запис «42-44» — це:», «Розмір 42 — 44 шт»
   or «Діапазон розмірів 42–44». Read as a range, nothing of that choice is
   sent: the line is answered with another basis and a note. The server
   refuses the tap without the choice «розмір 42 — 44 шт», checks it at the
   answer, and keeps that choice on the line and in its history, with the
   records it was said of. The answer names those records, the ones the
   person was asked about; a size created while the person answers can
   make another record a possible range, and the answer is then refused
   and asked again, naming it, never kept for a record nobody was asked
   about (review, third round, 2026-10-09). A size created after the
   answer can make a record a possible range, so the approval reads every
   such line again, record by record, and is refused, naming the lines,
   until each record that may be a range by then has the person's word:
   «Куртка 42-44 46-2», answered for «42-44», is asked again once a size
   «2» makes «46-2» a range too. A record of a letter size, or of a number
   size with a count no larger than it («46-2», «48-12»), is asked about
   only when the catalogue makes it a range (known risks).
   - Питання: «Запис "42-44" застосунок може прийняти за "розмір 42 — 44
     шт", якщо так його прочитав парсер; людина бачить рядок і фото й
     натискає сама. Прийнятно?»
6. A removed file's lines stay in the list, shown as «Прибрано», and count
   nowhere.
   - Питання: «Рядки прибраного файлу лишаються в списку з позначкою
     "Прибрано" — їх видно, але ніде не рахують. Так?»
7. Two people starting lists for one warehouse at the same moment from the
   two stores can still make two. Only one can be approved; the other is
   rejected, and its files are added to the first.
   - Питання: «Якщо двоє в різних магазинах в ту саму мить почнуть список
     для одного складу, буде два списки: затвердити можна лише один, другий
     відхиляють, а його файли додають до першого. Прийнятно?»
8. A shared warehouse's list whose own store is blocked or archived before
   the approval can be neither approved nor rejected, through either store,
   until that store trades again; the warehouse waits meanwhile, for both
   stores. **Changed by the owner:** the other store's manager, or the
   owner, may reject it, which releases the warehouse; its files then go
   into a new list started from the other store. It still cannot be
   approved while its own store does not trade. **Built** (2026-10-09;
   ADR-0014 §7): through the other store the list is rejected, its history
   naming that store, and the warehouse is released; the list's page says
   its store does not trade and offers only «Відхилити список», to that
   store's managers and the owner. Approving, answering and adding or
   removing files are refused while the store does not trade, and the
   refusal says so. Through the blocked or archived store itself nothing is
   done, as for any such store.
   - Питання: «Якщо магазин, що почав список спільного складу, заблокують чи
     заархівують до затвердження, список не можна ні затвердити, ні
     відхилити, доки магазин знову не запрацює, — і склад чекає для обох
     магазинів. Прийнятно?»
9. The prices from the notebooks, purchase prices included, are seen by
   everyone who reviews lists: the owner and the managers.
   - Питання: «Ціни з зошитів, зокрема закупівельні, бачать усі, хто
     розбирає списки, — власник і менеджери. Так?»

**Confirmed as built by the owner on 2026-10-09** (the review of the built
change, the same day; R-e and R-f from its second round). Built as Birka
read the rules, then put to the owner with the question under each, after
the code was final; every answer was the option as built.
- **R-a** (reading 1, put again as built). While a warehouse is paused, its
  list is seen only from the store that started it, and there it can only
  be rejected; files are added, lines answered and the list approved again
  once the warehouse reopens.
  - Питання: «Поки склад призупинено, його список видно лише з магазину,
    який цей список почав, і там його можна лише відхилити. Додавати файли,
    розбирати рядки й затверджувати можна знову, коли склад відкриють.
    Так?»
- **R-b.** A list takes at most 10 000 lines over its whole life, the lines
  of removed files included: twice the 5 000 that count. It guards against
  a file removed and added again without end. When that room is used up,
  the list takes no more lines: to add more, it is rejected and a new one
  started.
  - Питання: «У список за весь час можна додати до 10 000 рядків, рахуючи й
    рядки прибраних файлів (це вдвічі більше за 5 000 діючих). Це захист від
    безкінечного «прибрати — додати знову». Якщо місце вичерпано, список
    відхиляють і починають новий. Так?»
- **R-c.** Lines typed by hand, added to a list as a part of their own, are
  removed as a file is, with the answers given to them. The owner decided
  removal for files (2026-10-08).
  - Питання: «Рядки, додані вручну (не файлом), можна прибрати так само, як
    файл: разом із відповідями на них. Так?»
- **R-d.** A parser may leave the kind of prices out of a file when nobody
  knows which prices a notebook holds. The prices are then shown without a
  kind: «Ціна з зошита: 1200». The owner decided one kind per file
  (2026-10-08).
  - Питання: «Вид цін у файлі (продажу чи закупівлі) парсер може не
    вказати, якщо ніхто не знає, які ціни в зошиті. Тоді ціни показуються
    без виду: «Ціна з зошита: 1200». Так?»
- **R-e** (reading 3, its part the question left out). A list takes at most
  1 000 parts over its whole life — files and lines typed by hand, each
  added part one — removed ones included, as it takes at most 10 000 lines
  (R-b). When that room is used up, the list takes no more parts: to add
  more, it is rejected and a new one started.
  - Питання: «У список за весь час можна додати до 1 000 частин — файлів і
    рядків, внесених вручну, — рахуючи й прибрані. Якщо місце вичерпано,
    список відхиляють і починають новий. Так?»
- **R-f.** A split the line shows is confirmed by a tap only when every
  other number in the line is accounted for. A number the file calls the
  price is taken as the price on the parser's word alone, wherever it
  stands in the line: «46-2 48» with the price 48 shows its split, as does
  «Лоран S-1 M-2 L-1 1850» with the price 1850. Taking the price only where
  the line marks it («грн», «₴», «ціна») would ask more lines for a note.
  - Питання: «Якщо парсер записав число з рядка як ціну, застосунок вважає
    його ціною й дає підтвердити розподіл одним натиском — навіть у
    «46-2 48», коли ціна у файлі 48. Так, чи вважати число ціною, лише коли
    поруч написано «грн», «₴» або «ціна»?»

Built on 2026-10-08, readings 5 and 8 on 2026-10-09, and what the review of
the built change found the same day; see the
[report](json-stock-import-report.md) and
[ADR-0014](../decisions/ADR-0014-opening-stock-from-a-json-file.md).

## Owner decision — 2026-10-09 (customers' data)

Asked when the owner chose it as the next work: a sale paid in parts records
the customer's name and phone (2026-10-01), and nothing removed them, so
after going live they would only pile up, in every backup too. Only a debt
holds them: an order keeps no name, phone or address, the receipt and the
audit log leave them out (2026-10-01), and so do the logs and Sentry
(2026-10-03). Each answer below is quoted with the description its option
carried.

- **A debt paid or returned keeps the customer's name and phone a year**
  after it closed.
  - Питання: «Борг закрито: покупець сплатив усе або повернув товар. Скільки
    зберігати його ім'я й телефон?» Answer: «1 рік після закриття».
- **A written-off debt keeps them three years** after the write-off.
  - Питання: «Борг списано: покупець не заплатив. Скільки зберігати його
    ім'я й телефон?» Answer: «3 роки після списання» — about as long as a
    debt can still be claimed (to be checked with a lawyer), and whom not
    to sell to in parts again stays visible.
- **Then the name and phone are erased, and every sum stays.** The debt
  reads «Покупця стерто», with its date and sums; the drawer and the reports
  do not change. Deleting the debt whole was not offered: the money in the
  reports would change.
  - Питання: «Строк минув. Що стає з боргом?» Answer: «Стерти ім'я й
    телефон, суми лишити».
- **A customer who asks is erased at once, on the owner's word,** from their
  paid, returned and written-off debts. An open debt is not erased until it
  is closed.
  - Питання: «Покупець просить стерти його дані раніше строку. Що можна?»
    Answer: «Власник стирає закриті борги» — «Сплачені, повернені й
    списані борги стираються одразу, на слово власника. Відкритий борг не
    стирається, доки його не закрито.» Offered beside it: «Лише сплачені й
    повернені» (a written-off debt kept to the end of its term) and «Не
    передбачати».
- **The owner's own copies of the backups, older than 3 months, are
  deleted,** as on the server, so an erased name leaves every copy within 3
  months. A restore can then go back at most 3 months.
  - Питання: «Копії на вашому комп'ютері чи NAS зараз не видаляються
    ніколи, тож стерте ім'я лишається в старих копіях. Як їх тримати?»
    Answer: «Видаляти старші за 3 місяці».
- **Under the fields where people explain something, «Без імен і телефонів
  покупців»; and a write-off's reason is erased with the customer's name.**
  Other explanations stay.
  - Питання: «У поясненнях (причина списання боргу, причина повернення)
    люди іноді пишуть ім'я чи телефон покупця. Що робити?» Answer:
    «Підказка і стирати причину списання» — «Під полями пояснень написано
    «Без імен і телефонів». Причина списання боргу стирається разом з
    ім'ям покупця. Інші пояснення лишаються.»

How it is carried out, not decided by the owner
([ADR-0015](../decisions/ADR-0015-customer-data-retention.md)):
- **"A year after" is the same date a year later;** 29 February is
  28 February then. The erasure runs once an hour, so a name past its term
  is gone within the hour, and from the next night's backup.
- **"On the owner's word" is the network's owner, or a store's owner in that
  store** (`credit:erase_customer`; reading C-c, as the owner changed it,
  below). The network's owner erases in every store, a blocked or archived
  one too; the owner of one store, such as a child store, erases that
  store's debts while it trades.
- **The customer is everyone under their phone,** one phone being one
  customer (2026-10-01): the network owner's erasure reaches every closed
  debt of the network with that phone, a store owner's every closed debt of
  that store, and a couple sharing a phone are erased together. It is asked
  from a closed debt; the answer says how many of the customer's debts are
  still open within that reach (reading C-a, confirmed, below).
- **An open debt of a customer who asked keeps them once it closes,** until
  its own term runs out or the owner erases it again: nothing keeps a
  record that the customer asked, since that record would itself say who
  they are (reading C-b, confirmed, below).
- **An erased debt is found by neither the name nor the phone,** and stands
  alone in «Борги». A return of its goods is still taken.
- **The hint is under** the explanations about a customer's purchase or
  money: a return's reason at the till and on an order, a debt's write-off,
  a drawer's difference, a corrected way of paying, cash taken out or put
  in, where an order went abroad, and «Брак»'s notes, the one for the
  supplier included, since «Брак» came back from a customer. Supplier,
  invoice, catalogue, store and stock notes are not about a customer and
  have none (reading C-d, confirmed, below).
- **The owner's copies keep the newest night that can be restored,
  whatever its age,** as the server keeps its newest, so a collector that
  stopped hearing from the server never ends up with nothing. Older nights
  go by date on every run, also one that could not reach the server or found
  a damaged copy; such a run then fails, saying why.
- **A write-off's reason is no longer copied into the audit log,** which can
  never be changed; the debt keeps it until it is erased. The audit log says
  that a customer was erased, never who.
- **After a restore,** the term's erasure runs again by itself; an erasure
  on request made after the restored night is repeated by the owner
  (backup runbook, "restoring for real").
- **Three years is the owner's estimate** of how long an unpaid debt can
  still be claimed; the owner checks it with a lawyer (known risks).

Readings of how it is carried out, asked at the end of the build and
answered by the owner the same day:
- **C-a, confirmed.** The owner's erasure reaches every closed debt of the
  whole network under the customer's phone, a couple sharing a phone
  together.
  - Питання: «Покупець просить стерти дані. Застосунок стирає ім'я й
    телефон з усіх закритих боргів мережі (обох магазинів) за цим
    телефоном — бо один телефон — один покупець. Подружжя з одним
    телефоном стирається разом. Так?» Answer: «Так, з усієї мережі».
- **C-b, confirmed.** An open debt of a customer who asked keeps them once
  it closes, until its term runs out or the owner erases it again.
  - Питання: «Покупець, що просив стерти дані, ще має відкритий борг. Коли
    його закриють, ім'я й телефон лишаються на звичайний строк (рік чи
    три), доки власник не натисне «Стерти дані покупця» ще раз. Так?»
    Answer: «Так, власник стирає ще раз».
- **C-c, changed by the owner.** Built first for the network's owner alone;
  the owner chose that a store's owner erases too, the debts of their own
  store.
  - Питання: «Стирати дані на прохання покупця може лише власник мережі.
    Хто має роль власника лише в одному магазині — не може, бо стирання
    діє в усій мережі. Так?» Answer: «І власник магазину» — «Власник
    окремого магазину стирає борги свого магазину.»
- **C-d, confirmed.** Which fields carry the hint (above).
  - Питання: the list of fields above, «Так?» Answer: «Так».

Built on 2026-10-09; see the [report](customer-data-retention-report.md)
and [ADR-0015](../decisions/ADR-0015-customer-data-retention.md).

## Owner decision — 2026-10-10 (text from outside, shown as it is)

Chosen on 2026-10-09 as the last of three risks left before the public
domain: «Початкові залишки» already showed a character that hides or
reorders text as its code. Asked on 2026-10-10, once a map showed a model's
name on some 60 places and other text from outside on some 90 more.

- **Every text from outside is shown that way, on every screen:** model and
  colour names, sizes, a parser's lines, people's names (which come from
  their Telegram), suppliers', customers' and stores' names, notes and
  reasons. A character that hides or reorders text shows as its code,
  «⟦U+202E⟧»; an emoji reads as written.
- **Only shown so.** Nothing is refused when it is typed, and nothing stored
  changes. A field opened to edit a name holds it as it is.

Built on 2026-10-10; see the [report](outside-text-report.md) and
[ADR-0018](../decisions/ADR-0018-outside-text-shown-as-it-is.md).

## Owner decision — 2026-10-10 (what the server is built from)

Chosen on 2026-10-10, after the three risks of 2026-10-09 were closed, from
what was left that needs neither a server nor a person; first of two, before
a request limit per person.

- **Everything the server is built from is pinned to what CI ran:** the
  images (PostgreSQL, Caddy, Node, Alpine, Python) by their digest, the
  Python libraries by their files' hashes, CI's GitHub Actions by commit, and
  CI itself on a named Ubuntu, `ubuntu-24.04`, rather than `ubuntu-latest`,
  which GitHub moves to 26.04 from 2026-10-19.
- **The network only to read** digests and hashes (Docker Hub, PyPI, the
  GitHub API); nothing is installed on the developer's Mac. Asked once the
  images had to be rebuilt to prove it, the owner also allowed downloading
  inside Docker only: the locked libraries, checked by their hashes, and the
  backup image's PostgreSQL client and `age` again.

Built on 2026-10-10; see the [report](pinned-build-report.md) and
[ADR-0019](../decisions/ADR-0019-what-the-server-is-built-from.md).

## Owner decision — 2026-10-10 (requests per person)

Chosen on 2026-10-10 as the second of two, after what the server is built
from: one person's token could ask the API without end.

- **What the person sees when refused:** a text with how long to wait. The
  action is not done and is simply repeated after the pause; operations kept
  on the phone stay kept and are sent later.
- **Everyone the same:** one limit per person, on all their phones together,
  the owner's included.
- **The server's log only:** who was refused and how many times; the bot
  says nothing.

The limit's numbers are a measurement, not a rule: far above what anyone
does in the shop (ADR-0020). Built on 2026-10-10; see the
[report](per-person-limit-report.md) and
[ADR-0020](../decisions/ADR-0020-requests-per-person.md).

**Confirmed by the owner on 2026-10-10 (a reading of how it is built):**
the example text the owner was shown ended «— нічого не записано». It is
left out: the banner of an operation kept on a phone tells the seller to
type it from paper only when the app says «не записано», and a refused
re-check of a kept operation proves nothing about its first sending. The app
says «Забагато дій за короткий час. Зачекайте N с і повторіть.».

## Owner decision — 2026-10-10 (a closed store's debts)

Chosen on 2026-10-10, after requests per person. While a store is blocked
or archived, any store of the network that trades takes its debts' payments
(owner, 2026-10-01). A seller found them by a search of two letters or more,
with «Показати ще»: a rule of how it was built, not the owner's. «06» finds
nearly every phone, so a seller could page through the closed store's
customers, names and phones.

- **Only by the customer's whole phone.** The seller types the customer's
  whole number, written any way («067…», «+38…»), and finds that customer
  alone. A name or a part of a number finds nobody.
- **Only what is still owed.** A payment is taken only on an open debt. What
  was paid or written off in a closed store is read by the owner and the
  network's managers, in that store itself.

Asked the same day, after an independent review of the built change:
- **A seller added to every store sees a closed store only as its state**
  («Магазин заблоковано» and since when), as its own sellers do. They find
  its debts from a store that trades, by the whole phone, like any seller.
  The whole closed store is read by the network's owner and managers only,
  as written on 2026-10-01.
- **«8 067 123 45 67» and «0038 067 123 45 67» are the same number** as
  «067 123 45 67» and «+38 067…»: one customer everywhere, in this search,
  in a customer's debts together and in erasing them on request. No record
  changes, only how numbers are compared.

How it is carried out, not decided by the owner:
- **A customer who does not remember their number** is found by the owner or
  a manager of the network in the closed store itself, as before.
- **"The network's owner and managers"** are those who hold the financial
  report (`report:view_financial`) for the whole network: by default the
  owner's and the manager's roles, not the seller's. Roles are rows the
  owner may compose, so the permission says it, not a role's name.
- **A debt is read by its id from another store only while it is owed.**
  The payment that closes it answers with it, paid; after that it is read in
  the closed store by the owner and managers.
- **A whole phone** is 10 to 15 digits, with spaces, «+», brackets, «-», «.»,
  «/» and the invisible marks a phone's contacts add to a copied number.
  Another country's number is found as it was written.

Built on 2026-10-10; see the [report](closed-store-debt-search-report.md).

## Owner decision — 2026-10-10 (returns and payments typed from paper)

Chosen on 2026-10-10 after a closed store's debts, from the backlog: the
mark «продано під час збою» was on sales only (2026-10-07), so a return
typed from paper told the seller to hand the money back again, and a card
payment said nothing about the terminal.

- **The mark holds what a sale's does.** Who took the return or the
  payment and at what hour (today or «вчора»), as the paper says; both
  optional. Who typed it is recorded too. It is dated the day it is typed,
  as a sale is. A wrong mark cannot be changed afterwards.
- **The till's switch «З паперу».** The same switch on the return screen
  and on a debt's payment: once on, it stays for the whole series, and the
  buttons say «З паперу · Готівка», so a forgotten switch is seen before
  the press.
- **The screen says the money was already handed over.** A return: «…
  грн готівкою повернули під час збою — вдруге не повертайте.» A card
  payment: «оплату провели під час збою, на терміналі не проводьте ще
  раз». As for a sale typed from paper at the till.
- **Where it shows.** A return in «Звіт», with the mark, who took it and
  who typed it, as a sale. A payment in the debt's history in «Борги», the
  same. In «Звіт» debt payments stay one sum.

How it is carried out, not decided by the owner:
- **One switch for the store,** on the till, «Повернення» and «Борги»
  together: ticked on one, it is on on the others; leaving the store
  clears it, as at the till. Who is named is each screen's own, so a name
  chosen for a sale is never sent for a return; the hour is each
  operation's own.
- **Who may be named:** someone who may take returns there
  (`sale:refund`), or payments (`sale:credit`), now, in the store taking
  it: for a return at another store, or a closed store's debt paid at one
  that trades, that store's people and its day.
- **Not marked:** the first payment of a sale paid in parts (the sale's
  own mark covers it), a write-off, an order collected (typed as a sale).
- **The sellers' page** says to tick the switch for a payment and a return
  too, always; that wording waits for the owner's confirmation.

Built on 2026-10-10; see the [report](outage-mark-returns-payments-report.md)
and [ADR-0021](../decisions/ADR-0021-outage-mark-on-returns-and-payments.md).
