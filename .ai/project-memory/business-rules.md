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
  that day goes into that close. *(The same evening, while the drawer is
  still to close, it says to count again and close, and opens the count:
  owner decision, 2026-10-21, В3.)*

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
      be read: «Цілий товар повернуто на склад вашого магазину.» *Since
      2026-10-18 (returns task list, P0-5, P1-2): «Цілі: 1 шт. — на склад
      вашого магазину.», in «Повернення записано один раз».*
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
  too, always; the owner confirmed that wording on 2026-10-11.

Built on 2026-10-10; see the [report](outage-mark-returns-payments-report.md)
and [ADR-0021](../decisions/ADR-0021-outage-mark-on-returns-and-payments.md).

## Owner decision — 2026-10-10 (a stocktake of a whole warehouse)

Chosen on 2026-10-10 after a closed store's debts, second after the mark on
returns and payments: a stocktake changed one balance at a time, and
nothing said what a count of the whole warehouse found or what nobody
counted. Each answer the recommended one.

- **The warehouse keeps selling while it is counted.** Each position is
  checked against its balance when it is saved. If it was sold or received
  meanwhile, that position alone is counted again.
- **Positions nobody counted stay as they are.** The end says how many were
  not checked.
- **A manager or the owner counts, and each count applies at once:**
  whoever may correct stock today.
- **One record, and the bot tells the owner.** Who, when, how many
  positions, the shortage and the surplus in units; the bot sends the sum
  to the owner silently, as a drawer's difference.

Not chosen: the warehouse stopped until the count is finished; what nobody
counted set to zero, or every position required; sellers counting and a
manager approving; only ordinary corrections with the reason «Перерахунок»,
or a record without the bot.

How it is carried out, not decided by the owner:
- **One open per warehouse.** Whoever starts one while it is open joins it,
  from any store that may correct that warehouse's stock.
- **A position counted again** keeps its last count; what the stocktake
  changed there is the sum of its counts, so a mistyped count counted again
  cancels out.
- **What a correction refuses, a count refuses:** «Брак», a warehouse
  waiting for its opening list, a difference on a balance an order holds,
  and a size not known counted upwards. A count equal to the balance is
  always recorded as checked.
- **The counter sees the balance,** as on the correction screen.
- **Goods the list does not show** are found in the catalogue and counted
  against zero.
- **The owner who receives the message** is whoever holds `store:manage`
  across the network, never whoever finished it, as for the drawer.

Built on 2026-10-10; see the [report](warehouse-stocktake-report.md) and
[ADR-0022](../decisions/ADR-0022-warehouse-stocktake.md).

## Owner decision — 2026-10-11 (instructions in Ukrainian for the launch)

Chosen on 2026-10-11 after the stocktake of a whole warehouse: the release
waits on steps a person takes on a server, and the server's instructions
were in English. Each answer the recommended one.

- **Who reads the server's instructions:** a technical person, an
  administrator who works with a server and its command line: exact
  commands, and what each prints when it held.
- **What they cover:** the first install, the bot, the people, the shops'
  existing stock, backups, being told of trouble, the day-to-day running
  and what to do when the server does not answer. A new version, going
  back, a full restore and security stay in the English runbook, for the
  developer.
- **A guide for managers:** stock on the warehouse — receiving, the selling
  price, correcting a balance, a stocktake of a whole warehouse, and «Брак».
- **Where:** pages in the project, as the sellers' page is, to print or
  send. The app does not change.

The owner confirmed the same day the sellers' page's steps 2, 6 and 7 of
2026-10-10 (returns and payments typed from paper).

**Goods found on a shelf that the books do not hold** (asked the same day,
after the review found the guide offered two ways with no rule):
- **known where from** — a delivery not entered, or goods the opening list
  missed — they go in through «Приймання», with the supplier and price if
  known, as decided on 2026-10-02;
- **not known** — a surplus of a count: «Знайшли товар, якого немає в
  списку» in a stock correction or a stocktake.

How it is carried out, not decided by the owner:
- **The English runbook stays the source.** Where the two differ, the
  English is right, and a change to an install step is made in both; each
  says so.
- **Step 9, the shops' existing stock,** is summed up in Ukrainian; its
  full detail stays in the English runbook.
- **The managers' guide names the screens' own words** and states only
  rules already decided, each where the owner decided it.

Written on 2026-10-11; see the [report](launch-guide-uk-report.md), the
[server's instructions](server-setup-uk.md) and the
[managers' guide](managers-stock-uk.md).

## Owner decision — 2026-10-14 (the till in the new design, first part)

Chosen on 2026-10-14, after the redesign direction was approved
(2026-10-11, `redesign/design-direction.md`) and the strategist's task list
for the till was written (`redesign/2026-10-11-redesign-tz-sale.md`): the
till first, in the new design. Not chosen now: the bottom menu of five
tabs, the task lists for the other sections, and the older items.

The owner answered three of the task list's ten questions, each with option
(а), the one recommended when they were asked:
- **В1. A coat in hand that the books hold none of** is found in the
  catalogue at the till and sold through «Товар на місці», as a shortage
  is today (F30): the customer does not wait. Built with the till's search
  (task P1-5), not yet.
- **В3. A sale at 0 грн** (a gift) is allowed, with a warning on its line.
  Built with task P1-8, not yet.
- **В6. The store is chosen every time** by whoever has two or more; none
  is remembered.

Built in the first part (tasks P0-1, P0-4, P0-5, P0-6); how it is carried
out, not decided by the owner:
- **One store opens straight**, with nothing to choose (the task list's
  P0-1), and the till is the first tab for whoever
  sells there; whoever does not sell opens on «Замовлення», as before. A
  kept operation still opens its own tab, a kept order «Замовлення» too.
- **The direction's palette, light and dark,** with the theme taken from
  Telegram's background by Telegram's own rule. Departures from the
  direction, chosen here: the dark backgrounds of the meaning colours, a
  few tokens it does not name (edges, focus, shadows), and the light theme
  changing visibly, as the palette replaces Telegram's colours.
- **What is sold, the total and the three ways under the thumb,** held at
  the bottom of the screen once the basket holds something; with «Оплата
  частинами» it reads «Зараз … · винен …». The
  server's shortage answer opens above it, in view and focused, its line
  marked, and kept clear of the panel; a seller who may not write a shelf
  off is told to remove the line and ask a manager to correct the
  balance.
- **A sale paid in parts** leads its receipt with what is paid now and
  how: «Картка · Проведіть на терміналі 1000,00 грн», never the whole.

Nothing about money, stock or who may do what changes. Built on
2026-10-15; see the [report](till-redesign-1-report.md).

## Owner decision — 2026-10-15 (the till's search, one tap of a size, the app's name)

Asked after the till's first part merged (PR #90): what next, and two of the
task list's open questions. Each answer was the option recommended when
asked.
- **Next: the till's search and one tap of a size** (the task list's P0-2,
  P0-3): a model is found by a few letters, and a tap on its size puts it in
  the basket, its quantity and price in the line.
- **В5. Two approved texts change,** as a seller cannot read them right:
  «Він увійде в сьогоднішній «Звіт» і в касу…» becomes «Він увійде в
  сьогоднішні продажі й у касу до наступного закриття.» (a seller does not
  see «Звіт»), and «Товар без розміру вносьте як «розмір невідомий».»
  becomes «Товар з невідомим розміром вносьте як «розмір невідомий».»
  («без розміру» reads as a coat that has no size). Nothing else about
  paper mode changes.
- **В4. The app is called «Бірка»**: in its header, on the sign-in and
  crash screens, and in the browser's tab, where it said «birka».

How it is carried out, not decided by the owner:
- **The search matches as receiving's does:** every word of what is typed
  must be in the model's name, its source or its colour, literally; a
  merged model's old name finds the model that stays (2026-10-03). It
  starts at two letters, after a pause of a third of a second.
- **The list reads by the model's name,** then its source and colour, each
  model's sizes together in receiving's order, a size not known last. A
  hundred rows a page; «Ще товари» adds the next under them. The order is
  the database's collation, `uk-UA` in production.
- **Each model is a tag:** its name, its price for this store, and a chip
  per size held, «M · 2»; a chip whose every coat an order holds offers
  nothing to sell, but from paper, where the server's refusal says to let
  a manager decide about the order first, as before (ADR-0013 §6). Only
  what the warehouse holds is listed, as before.
- **A tap on a chip puts one coat in the basket,** a second tap one more.
  The line has «−» and «+» (1 to 1000) and its own price field, filled
  with the model's price and changed freely; a model with none leaves it
  empty, with the cursor in it, and the three ways and «Разом» wait for a
  price in every line. Any change to the basket is a new sale, as before: the
  server's earlier answers about the shelf no longer apply.
- **«Розмір з етикетки» moves into the line** of a coat held with its size
  not known; its texts are unchanged, «без розміру» included, until the
  till's words are settled together (task P2-2). A line so read before
  «Вношу продаж з паперу» is ticked holds the ways until it is taken out:
  from paper no size is read off a label (G3).
- **One warehouse to sell from is named, not asked** («Склад: …»); with
  two, «З якого складу віддаєте?». A warehouse paused or no longer sold
  from stops being the till's.
- **«Новий продаж» puts the cursor in the search.**
- **Not changed here:** the return's own paper text says the same of
  «Звіт» («Воно увійде в сьогоднішній «Звіт» і в касу…»); В5 named the
  sale's, so it waits for the owner. (Changed after the owner's answer of
  2026-10-15, below.) The header's
  «РОБОЧЕ МІСЦЕ ПРОДАВЦЯ» stays until the header is redrawn (P1-6).

Built on 2026-10-15; see the [report](till-redesign-2-report.md).

## Owner decision — 2026-10-15 (the till's receipt and its small things; the first days' paper)

Asked after the till's search merged (PR #91), each answer the option
recommended when asked:
- **Next: the receipt and the till's small things** (the task list's P1-1,
  P1-2, P1-8, P1-9): the receipt by tags, the way to return a sale made by
  mistake, a warning on a line at 0,00 грн (В3, answered 2026-10-14), and
  the till's ticks as targets a thumb hits.
- **В2. Sales written on paper in the first days,** while a warehouse waits
  for its opening list to be approved, are typed in with a mark of their
  own, «з паперу», with no word of an outage: the till offers nothing about
  the shelf, as for paper typed after an outage, and the mark stays true.
  It needs a new value of the mark on the server. Built with the till's
  empty states (task P1-5), not yet.
- **The return's paper text changes like the sale's** (В5): «Повернення
  позначать «під час збою». Воно увійде в сьогоднішні повернення й у касу
  до наступного закриття. Гроші, які віддали під час збою, вдруге не
  віддавайте.», since a seller does not see «Звіт».

How it is carried out, not decided by the owner:
- **A receipt line is a tag:** «Лоран шоколад · M» and «1 × 1850,00 грн»;
  the size is the one the sale froze, and «розмір невідомий» for a size not
  known.
- **The shelf's corrections are said in coats,** counted by the server from
  the movements the sale wrote: «Знайдене на полиці додано в облік: 1 шт.»,
  «На полиці не знайшли — з обліку знято: 2 шт. Перевірте склад із
  менеджером.», «Розмір з етикетки записано: 1 шт. як M.» A shortage writes
  off what the books believed less what was on the shelf, which only the
  server knows; an answer stored before the counts says the same without a
  number.
- **Telegram buzzes when the server answers the till's press:** success
  once a sale is recorded, error once it is refused, nothing for the
  shelf's question, where Telegram has haptics.
- **«Помилилися з товаром чи ціною? Оформити повернення»** under «Новий
  продаж» opens «Повернення» on that very sale, for whoever may take
  returns; the return follows its usual rules. A sale is never changed.
- **A line at 0,00 грн says «Ціна 0,00 грн. Це справді подарунок? Перевірте
  ціну.»** and still sells. A model with no price says who sets one: «Ціни
  продажу ще немає — впишіть домовлену. Ціну для всіх задає менеджер у
  «Залишках».»
- **Every tick of the app is a row of at least 44 px,** the till's among
  them; ticking «Оплата частинами» puts the cursor in «Ім’я покупця».

Built on 2026-10-15; see the [report](till-redesign-3-report.md).

## Owner decision — 2026-10-15 (the sections and the header; the till's reminder after an outage)

Asked after the till's receipt merged (PR #92):
- **Next: the sections and the header, and the reminder after an outage**
  (the task list's P1-6, P1-7), the option recommended when asked.
- **A paper sale returned from its own receipt is a paper return,** marked
  «під час збою», as built in PR #92 (the option recommended): the paper
  switch is the store's, and a return made by mistake nets out in the
  till's cash with the sale it corrects.
- **В7: the bot does not tell sellers that the server answers again** (the
  option not recommended when asked). The owner and the administrator are
  told as before (G10); a seller is reminded at the till alone.

How it is carried out, not decided by the owner:
- **The counter's work stands in one row:** «Продаж», «Повернення»,
  «Борги», «Каса», each for whoever may do it, and «Ще», which opens every
  other section, each by the same right as before. Any section is two taps
  away. «Ще» is marked when the section open is one of its own, whose
  heading names it, and says «Ще ⚠» when the backups or the server need the
  owner. The row stays at the top, as the task list has it, not as tabs at
  the bottom (the design direction): the till's payment panel holds the
  bottom of the screen, and the tabs the direction draws («Товар»,
  «Клієнти», «Огляд») are screens not built yet.
- **The header is one line,** «{Магазин} · {Ім’я}», with «Змінити магазин»
  beside it for whoever has two or more stores. «РОБОЧЕ МІСЦЕ ПРОДАВЦЯ» is
  gone; the app's name, «Бірка», stays on the screens before a store opens,
  on the crash screen and in the title.
- **Once this phone has seen the server come back after it did not answer,
  the till says once:** «Сервер знову відповідає: продажі з паперу можна
  вносити. Внесіть їх до закриття каси.», with «Вношу продаж з паперу»,
  which ticks the same switch as the tick, and «Пізніше». Either answers it,
  and so does ticking the switch on any screen, or the server coming back
  while the paper mode is on: the paper is being typed. It is said again
  only after the server is lost and back once more. It is the phone's own
  memory: a reopened app says nothing until it sees an outage itself.

Built on 2026-10-16; see the [report](till-redesign-4-report.md).

## Owner decision — 2026-10-16 (the till's empty states; the first days' paper)

Asked after the sections merged (PR #93), each answer the option
recommended when asked:
- **Next: the till's empty states and the mark «з паперу»** (the task
  list's P1-5, with В1 (а) of 2026-10-14 and В2 (в) of 2026-10-15).
- **The money of the first days' paper goes into the drawer** until its
  next close, as every sale's and every outage's does: no new rule of the
  drawer.
- **Whoever types paper says once per series which paper it is:** the
  first days', before the opening list was approved, or an outage's.
  Nothing is guessed: the mark is permanent.
- **The first days' paper may be dated any day of the last two weeks**:
  an opening list may wait days for its review. An outage's paper keeps
  today or yesterday (G1). The sale is still dated the day it is typed.
- **Returns and debt payments typed from the first days' paper are
  «з паперу» too**, not «під час збою».
- **A warehouse where nothing has been recorded yet** — no opening list
  approved, no delivery — **is treated as one waiting for its list**: the
  till says to sell on paper there, and offers no coat from the catalogue
  until its first approved list or first delivery. A «Товар на місці» there
  would be its first movement and close it to its opening list for good
  (asked when the review found it, 2026-10-16).

How it is carried out, not decided by the owner:
- **A warehouse where nothing is recorded yet**, its list typed or not,
  says so at the till: «На складі «{склад}» зараз немає товару в обліку.
  Поки власник не затвердить початкові залишки, продавайте на папері.»,
  with nothing to search or sell (`GET /stock-locations` says
  `awaiting_first_stock`).
- **An empty warehouse** that has recorded stock names itself: «На складі
  «{склад}» зараз немає товару в обліку.» With nothing found by a search,
  with nothing at all, or under what a search found (the coat in hand may
  be another model's colour), the till asks «Товар у руках, а в списку його
  немає?» and offers «Знайти в каталозі»: the model from the whole catalogue, its size tapped, the line
  at its price. Pressed, the sale says the books hold none, and «Товар на
  місці — продати N» records the coat found, exactly what the sale is short
  of (F30, I18). For whoever may answer «Товар на місці» and read the
  catalogue (`inventory:correct_during_sale`, `inventory:receive`); never
  from paper. The server needed no change: a sale's «фізично є» on a key
  the warehouse never held already worked.
- **The mark «з паперу»** is the outage mark with `first_days` (revision
  0041; ADR-0013 §5.8): the same shelf rule, people and permanence. Shown
  as «Продано з паперу», «Повернено з паперу», «Внесок з паперу»; the paper
  mode's texts say «з паперу» and «вже взяли» instead of «під час збою».
- **The choice** is asked when the paper switch is ticked: «Що вносите з
  паперу?» — «Перші дні, до затвердження залишків» or «Сервер не
  відповідав». Until it is said, the buttons that send are held. The
  till's reminder that the server is back says «Сервер не відповідав»; it
  can be changed. The first days' paper asks «День з паперу» among the last
  14 days, today among them, beside «Час з паперу»: the two go together or
  not at all, and nothing guesses the one left out. «Це було вчора» is an
  outage's. Another kind chosen asks the day and time anew.
- **«Каса»** offers a third quick reason for a difference: «Продажі з
  паперу перших днів».

Built on 2026-10-16; see the [report](till-redesign-5-report.md).

## Owner decision — 2026-10-16 (the first sign-in and the kept sale; the guides; В8)

Asked after the till's first days merged (PR #94), each answer the option
recommended when asked:
- **Next: the first sign-in and the kept sale's banner** (the task list's
  P1-3 and P1-4).
- **The guides' new words are confirmed:** the seller's paper guide types
  an outage's paper with «Сервер не відповідав», and the server guides type
  the first days' paper with «Перші дні, до затвердження залишків» and its
  day and time.
- **В8: the seller sees «Сьогодні ви продали N шт.»,** units only, no sums
  and no ways, so the drawer's blind count (G32) keeps nothing to go by.
  Not built yet: it needs a count from the server, and comes with the next
  work on the till.

How it is carried out, not decided by the owner:
- **Someone not yet added** sees «Ваш Telegram ID: … — це не номер
  телефону. Надішліть його власнику магазину. Коли вас додадуть, закрийте
  застосунок і відкрийте його знову кнопкою в боті.», with «Скопіювати ID»
  where the phone lets the app copy, the ID selected whole where it does
  not, and «Спробувати ще раз» as before. People are still added on the
  server, on the owner's word.
- **Launch data the server refuses** — past its hour, or not signed by the
  shop's bot — says «Відкрийте застосунок знову кнопкою в боті вашого
  магазину.»: opened from the bot, the app signs in anew and finds any
  command kept from an earlier opening, so it does not speak of one here.
  A session that ends later keeps its words.
- **A kept sale's banner** says «Продаж ще не підтверджено» and which sale
  it was: «Продаж на 1850,00 грн · Картка — сервер не відповів. Двічі він
  не запишеться. Поки чекаємо, інші дії недоступні.» (the heading already
  says «ще не підтверджено», so the line does not repeat it); paid in
  parts, the part paid now; an attempt kept from before the way was asked
  names none, and one whose figures do not read names only its way. An
  empty shelf kept says «Запис нестачі ще не підтверджено» / «Сервер не
  відповів. Двічі нестача не запишеться. Поки чекаємо, інші дії
  недоступні.» The owner's line under it (G17, G18) is unchanged.
- **A kept sale confirmed** says «Продаж записано один раз: разом 1850,00
  грн готівкою.»

Built on 2026-10-16; see the [report](till-redesign-6-report.md).

## Owner decision — 2026-10-17 (money in one format; the till's words; its refusals)

Asked after the first sign-in merged (PR #95), each answer the option
recommended when asked:
- **Next: money in one format, one word for each thing at the till, and
  refusals that do not speak of an order** (the task list's P2-1, P2-2,
  P2-4). Only what the screen shows changes; the server does not.
- **The till's words are the task list's glossary (§9):** «розмір
  невідомий», not «без розміру»; «шт.», not «од.»; «Покупець», not
  «Клієнт»; «Спробувати ще раз», not «Повторити завантаження»; a kept sale
  confirmed, «Продаж записано один раз», not «Продаж підтверджено». The
  texts the owner approved keep their words.

How it is carried out, not decided by the owner:
- **Money** reads «1 850,00 грн» wherever the app writes a sum: the
  thousands apart by a no-break space, so the figure never breaks across
  two lines (a «грн» may still wrap after it), and every figure in even
  digits. A price is typed as before, «1850,50». The bot's message of a
  close's difference is the server's, and keeps «6100,00 грн».
- **At the till:** «Не читали — продати як «розмір невідомий»»; a line
  sold with the label's size from unknown stock, «Розмір з етикетки; в
  обліку — «розмір невідомий»»; the shelf's offer, «Розмір з етикетки —
  продати як M»; counts in «шт.» («У кошику: 3 шт.», «На місці фактично
  є, шт.», «Знято з обліку: 1 шт.»); a short shelf, «у кошику 2 шт., в
  обліку 1 шт.», with «поза резервом замовлення» when an order holds the
  rest; «Спробувати ще раз» where a read failed, the catalogue's too
  (shared with «Приймання»); and «Кошик» names only the lines to pay, no
  longer the whole form. A word in a sentence stays a word — «частина цих
  одиниць у резерві замовлення»; a count is «шт.».
- **A kept sale confirmed** says «Продаж записано один раз» / «Разом 3 000,00
  грн карткою.», with what it said of the card before.
- **Where the glossary names screens beyond the till:** the order's card
  («Розмір невідомий», «… за 1 шт.», «покупець винен», «Продаж
  записано.», «Продаж записуємо, коли покупець забрав товар.») and form
  («З якого складу віддаєте?», «Ціна, грн», «Прибрати», «Покупець забирає
  замовлення…», a coat of unknown size as «розмір невідомий»); a return's
  «за 1 шт.»; the supplier screens' «розмір невідомий».
- **Every banner that said «Нові операції заблоковано.»** — a kept
  delivery, return, payment, correction, count, order, and the drawer's —
  now ends «Поки чекаємо, інші дії недоступні.», as the kept sale's does.
- **A refusal the till knows no more of:** a conflict says «Дані змінилися,
  поки ви працювали. Спробуйте ще раз.», a request it could not read
  «Перевірте товар, кількість і ціну.», each followed by «Кошик збережено —
  нічого не продано.». A kept sale so refused on its resend says «Продаж не
  записано (дані змінилися, поки сервер не відповідав).», since its basket
  is gone and it is typed from paper. Other screens keep their words.
- **Kept as they were:** «Клієнт забрав», an order's status (ADR-0012);
  the kept banners of the catalogue, models, stores, suppliers and stock
  lists, which never said «Нові операції заблоковано»; «Повторити
  завантаження» in the catalogue's own screens, «Залишки», the suggested
  price, «Приймання» and the stocktake; and «од.» in the stocktake,
  corrections, «Приймання», stock lists, stores, suppliers, invoices and
  the report — screens the glossary does not name.

Built on 2026-10-17; see the [report](till-redesign-7-report.md).

## Owner decision — 2026-10-17 (the day's count at the till, В8)

Asked after money and the till's words merged (PR #96), each answer the
option recommended when asked:
- **Next: «Сьогодні ви продали N шт.»** (В8, decided on 2026-10-16).
- **The day is the store's business day, 06:00 to 06:00,** as the drawer's.
- **Counted: today's sales, less what was returned from those same sales:**
  a sale returned by «Помилилися?» adds nothing.
- **A sale typed from paper counts for whoever is named under «Хто
  продав»;** naming nobody, for whoever typed it.
- **Shown on the receipt after a sale,** under «Продаж записано»; not on
  an empty till.
- **A collected order is not counted:** only the till's sales.
- **After a sale typed from paper for someone else, the receipt says
  nothing** of the seller's count.

How it is carried out, not decided by the owner:
- **The server counts it each time it is asked** (`GET /sales/sold-today`),
  for whoever asks, in the till's store, and only for someone who may sell
  there (`sale:create`). It says the units and the day and nothing else: no
  sum, no way, nobody else's (G32).
- **A sale typed from paper counts on the day it was typed,** as in «Звіт»
  and the drawer, and as the till tells the seller («Він увійде в
  сьогоднішні продажі»), whatever day the paper says.
- **Every unit returned from those sales counts,** whoever took it back and
  wherever, and whether or not the goods came back.
- **Each store its own:** someone who sells in two stores sees each store's
  count.
- **The line is kept while the figure is read,** so nothing on the receipt
  moves under the finger. If the server does not answer, it stays empty and
  the receipt is the same.
- **Not on «Продажу немає»** (nothing was on the shelf), nor on a kept sale
  confirmed later: neither is the receipt after a sale.

Built on 2026-10-17; see the [report](till-redesign-8-report.md).

## Owner decision — 2026-10-17 (both warehouses in the till's search; the screen kept in place)

Chosen after the day's count merged (PR #97): the task list's P2-5 and P2-6.
Asked, each answer the option recommended:
- **A store that sells from two warehouses lists both at once, a chip per
  warehouse:** «M · Свій 1», «M · Спільний 2». One tap puts the coat in the
  basket from that very warehouse. A store with one is as before, «M · 3».
- **A warehouse still waiting for its opening list,** while the other
  sells: the other's goods are listed, and the till says «Склад «Свій» ще
  чекає початкових залишків: його товар продавайте на папері.»

How it is carried out, not decided by the owner:
- **The warehouse is still the seller's choice, line by line** (owner
  decision, 2026-09-17): each chip names its own, and the server never
  picks one. A coat in hand from the catalogue, with both listed, is asked
  «З якого складу віддаєте?» before anything is offered.
- **One may still be chosen alone:** «Склад» offers «Усі склади» first, and
  each warehouse after it; chosen alone, its chips read as a one-warehouse
  store's. A store may sell from more than two, and a seller may want one.
- **Both waiting:** «На складах магазину зараз немає товару в обліку. Поки
  власник не затвердить початкові залишки, продавайте на папері.»
- **A line says its warehouse** — in the basket, its count, «Прибрати», a
  shortfall and the receipt — while every warehouse is listed or the basket
  holds more than one: two «Лоран шоколад · M» are told apart, and a
  shortfall says which shelf to look at.
- **What is being read keeps its place** (P2-6): signing in and the
  warehouses show the places of the search field and three tags, the goods
  those of three tags, in their sizes, and a screen reader still hears
  «Входимо в магазин…», «Завантажуємо склади…», «Завантажуємо товари…». A
  search typed keeps the list where it was until the new one comes, so
  nothing under it moves under the finger.

Built on 2026-10-17; see the [report](till-redesign-9-report.md).

## Owner decision — 2026-10-17 («Повернення» in the new design: its task list's questions)

The returns section's task list
([redesign/2026-10-17-redesign-tz-returns.md](redesign/2026-10-17-redesign-tz-returns.md))
asked six questions; each answer the option recommended:
- **В1: no sums in the list of sales, for anyone** — sellers, managers and
  the owner alike, one list for all. A sale's sum shows once it is opened.
- **В2: a return made by mistake is undone by selling those goods again**
  at the till; damaged goods are first put back on sale in «Брак»; a
  mistake with a sale paid in parts is the owner's to settle.
- **В3: a sale of another store of the network is searched by a button
  under the results,** «Шукати в інших магазинах мережі»: never mixed with
  this store's.
- **В4: «Повернення» stays a button in the sections' row,** as decided on
  2026-10-15, until the bottom bar of five tabs.
- **В5: goods sold from the notebook, before Бірка,** are the manager's to
  decide; the app says to call the manager. No new rule.
- **В6: how far a debt paid in parts falls is said after the press,** as
  now; not before.

Then chosen next: the task list's P0-1 (the list) and P0-2 («Показати
ще»). How they are carried out, not decided by the owner:
- **«Що повертають?»** searches as it is typed, from two letters, after a
  pause, as the till does; Enter at once. A row is the sale's goods
  («Лоран шоколад · M», two lines, then «+ ще N»), its hour and count,
  and its marks — «Оплата частинами», «Продано з паперу» / «Продано під
  час збою», «Магазин «Другий»», «Усе вже повернено» — under the day's
  heading («Сьогодні», «Вчора», «15 жовтня»); the whole row opens it, and a
  sale returned whole opens nothing.
- **«Оновити» and the two lines of explanation go:** the list is read
  again when the section opens and the app comes back.
- **«Де купили» becomes the button under the results** (В3),
  «Шукати в інших магазинах мережі» / «Шукати в цьому магазині», what was
  typed kept when it changes. Only the button moved: the rest of the task
  list's P1-1 — its own words, shown from two letters, the heading of the
  other stores' list, warehouse chips — is still to do.
- **A list read again and refused says so** above the rows it had, with
  «Спробувати ще раз»; back from a sale, the list is read again.
- **«Показати ще» reads twenty more at a time** by `offset`, never past the
  server's fifty, a sale read twice shown once; a page that cannot be read
  keeps those read, with «Спробувати ще раз».

Built on 2026-10-17; see the [report](returns-redesign-1-report.md).

Then chosen next: P0-3 (one sale's screen), P0-4 (the panel under the
thumb) and P0-5 (the result). How they are carried out, not decided by the
owner:
- **Each unit's state is counted with «−» and «+», from none:** «Цілі» and
  «Пошкоджені» under each line's tag, «Лоран шоколад · M», never preset
  (owner decisions, 2026-09-15, §3); «+» stops at what may still come back,
  and the server checks it again (I9). No field opens the keyboard; the
  reason is behind «Додати причину».
- **What comes back, its sum and the way are in a panel under the thumb**
  once a unit is counted: «Повернути 3 000,00 грн» large, a switch
  «Готівкою | На картку | Переказом» with the sale's own way chosen (G4,
  G5), and one button with its words as before. Paid in parts: «Товар на
  …» and «Спершу зменшимо борг; скільки віддати — покажемо після.» (В6).
  From paper, the large line carries the button's «З паперу · », and that
  note is not said. A way that cannot be read says so; nothing is chosen.
- **The result replaces the form:** «Повернення записано», the sum to hand
  back large, from the server's answer, the way as a pill over it; from
  paper, «Уже повернули …» and never «Поверніть»; where each coat went, by
  the answer's lines, «Цілі: 1 шт. — …», «Пошкоджені: 1 шт. — у «Брак».»,
  the pointer to «Брак» only for whoever handles it. «Новий продаж» opens
  the till with its cursor in the search (В2: a mistake is mended by
  selling again); «Ще повернення» goes back to the list as searched;
  whoever may not sell gets «До списку».
- **Not changed:** the body sent, the kept return's notice (the task
  list's P1-2), the paper line under the button (P1-4).

Built on 2026-10-17; see the [report](returns-redesign-2-report.md).

## Owner decision — 2026-10-18 («Повернення»: two words after #100, and what next)

Asked after #100, each answer the option recommended:
- **From paper, the panel's large line stays «З паперу · Повернути …»,**
  the button's own words; the warning not to hand money back twice stays
  in the band «Режим: з паперу».
- **A sale paid in parts whose way cannot be read** says «Не вдалося
  прочитати, як платили. Якщо буде що повертати — оберіть, як.», the words
  of the choice's own name; every other sale keeps «… Оберіть, як
  повертаєте.»
- **Next:** the task list's P2-5 (a buzz on the server's answer), P1-2 (a
  kept return says which it is) and P1-4 (one line under the button from
  paper).

How they are carried out, not decided by the owner:
- **A kept return's banner** is «Повернення ще не підтверджено» and names
  it: «Повернення: Лоран шоколад · M × 1 · 3 000,00 грн готівкою — сервер
  не відповів. Двічі воно не запишеться, і гроші двічі не повернуться.
  Поки чекаємо, інші дії недоступні.»; in parts with no sum, «Повернення
  частинами: …»; an attempt kept before, or whose goods do not read, by its
  units and way, «Повернення 2 шт. · готівкою — …». The goods and the sum
  are the attempt's own, kept beside what is sent and never sent: a resend
  is byte for byte the same.
- **Confirmed later,** it is «Повернення записано один раз» with the
  result's block, compact — the money said to give back only if nobody did
  (2026-10-08), the pill over the sum naming the way alone, «Готівка», from
  paper «… повернули під час збою — вдруге не повертайте.», the goods
  where they went — and «Зрозуміло».
- **From paper, one line under the button:** «Хто прийняв: Ганна · за
  папером вчора, 19:40» («сьогодні», or the first days' «08.10»), the time
  only when given; «вдруге не віддавайте» is said once, in the band.
- **A buzz in the hand,** inside Telegram where it can: success once a
  return is recorded, error once it is refused; none for a lost answer or a
  kept one confirmed later.

Built on 2026-10-18; see the [report](returns-redesign-3-report.md).

Then chosen next, the same day: P1-1's rest, P1-5 and P1-6, by the
answers of 2026-10-17 (В3, В2, В5, each (а)). How they are carried out,
not decided by the owner:
- **The other stores are offered under this store's results once two
  letters are typed:** «Купили в іншому магазині мережі? Шукати там»;
  their results headed «В інших магазинах мережі», with «← У своєму
  магазині»; fewer than two letters typed, and it is this store's list
  again. Nothing of theirs is asked before (the server's own rule).
- **Intact goods sold from another store's own warehouse** go to one of
  this store's chosen by a chip, «Цілі — на який склад?», «Продали з
  власного складу іншого магазину.»; none chosen beforehand.
- **Under a return's result** (В2): «Помилилися з поверненням? Продайте ці
  речі знову на касі; пошкоджене спершу поверніть у продаж у «Браку».» —
  the «Брак» part only when damaged goods came back; to whoever may not
  sell or handle «Брак», said as how it is done («Ці речі продають знову
  на касі», «… спершу повертають у продаж у «Браку»»); for a sale in
  parts, «Помилилися з поверненням? Помилку з продажем частинами вирішує
  власник.» Not on a kept return's notice.
- **Nothing found in this store** (В5) adds «Продали ще до Бірки? Покличте
  менеджера — таке повернення вирішує він.», after the other stores'
  offer, which is tried first; nothing found in the other stores does
  not.

Built on 2026-10-18; see the [report](returns-redesign-4-report.md).

## Owner decision — 2026-10-18 («Повернення»: three readings after #102, and what next)

Asked after #102, each answer the option recommended:
- **The words of a mistake's mending to whoever may not sell or handle
  «Брак» stay impersonal,** «Ці речі продають знову на касі…», with no
  further step: the usual roles hold both rights.
- **«Продали ще до Бірки? Покличте менеджера — таке повернення вирішує
  він.» is the same for every role,** managers and the owner included.
- **«Помилку з продажем частинами вирішує власник.» is the same for every
  role,** the owner included.
- **Next:** the task list's P1-3 (a sale searched by each word) and P2-2
  (a return's refusals in its own words).

How they are carried out, not decided by the owner:
- **A sale is found by each word typed,** in any order and letter case,
  literally, every word in the name of one line of the sale, as the till's
  search reads each word: «шоколад лоран» finds «Лоран шоколад»; words of
  two lines do not add up. The other stores' search still starts at two
  letters for the whole query, and nothing else about who sees what
  changes.
- **A refusal «Повернення» knows nothing more of** says «Дані змінилися,
  поки ви працювали. Поверніться до списку й спробуйте ще раз.» for a
  conflict and «Перевірте, що повертають, і спробуйте ще раз.» for a
  request the server could not take, with «Нічого не повернено.» as
  before; a kept return refused so on resend, «Повернення не записано. Дані
  змінилися, поки сервер не відповідав. …», as a kept sale says. Never a
  word of an order.

Built on 2026-10-18; see the [report](returns-redesign-5-report.md).

## Owner decision — 2026-10-18 («Повернення»: three readings after #103, and the task list closed)

Asked after #103, each answer the option recommended:
- **A kept return still unconfirmed, refused for a conflict** — the server
  not saying it recorded nothing — says «Повернення ще не підтверджено:
  сервер відповів, що дані змінилися. Перевірте результат ще раз — двічі
  воно не запишеться.»: its own words, never an order's, and never «try
  again», which could hand the money back twice.
- **The other stores' sales are found by a word of two letters at
  least,** on the server and in the list: «о о» browses as «о» would, and
  is refused; «ло ш» is a search.
- **A kept return refused on resend, having recorded nothing, for a
  conflict** says «Повернення не записано. Дані змінилися, поки сервер не
  відповідав. Поверніться до списку в «Поверненні» й спробуйте ще раз.»:
  the section named, since it may show over the till.
- **Next:** the task list's P2-1, P2-3 and P2-4, which close it.

How they are carried out, not decided by the owner:
- **One set of words** (P2-1): what the task list's glossary cancelled is
  gone from «Повернення»; a kept return on a phone whose person may no
  longer take returns shows its banner over whatever is open, and the app
  no longer turns to «Повернення» to say «Немає права приймати
  повернення.», which is said nowhere now.
- **While the list is read** (P2-3), three rows' places stand where the
  sales will be, and a screen reader hears «Завантажуємо продажі…».
- **Pills by what they mean** (P2-4): «Оплата частинами» in the debt's
  colours, «Продано з паперу» / «Продано під час збою» and the result's
  paper mark as a warning, «Усе вже повернено» neutral, «Пошкоджені» on the
  result in the colour of «Брак»; the returns screens' meta at 14 px; each
  at 4.5:1 or more, light and dark.

Built on 2026-10-18; see the [report](returns-redesign-6-report.md).

## Owner decision — 2026-10-18 («Повернення»: two readings after #104, and what next)

Asked after #104, each answer the option recommended:
- **A return whose answer was lost, once its person may no longer take
  returns where it was taken,** is still learned by that person: the
  server answers what it recorded, and the phone shows it over the till;
  if nothing was recorded, the server says so, and the phone says
  «Повернення не записано. Немає доступу до цієї операції або складу.
  Зверніться до менеджера.» and frees the till. A new return without the
  right is refused, as before. Until now the phone stayed held for good:
  the server refused a resend to whoever lost the right, before looking it
  up (invariant I13).
- **A kept return still unconfirmed, refused as a request the server could
  not take** — not said to have recorded nothing — says «Повернення ще не
  підтверджено: сервер не прийняв запит. Перевірте результат ще раз —
  двічі воно не запишеться.», as its conflict does.
- **Next:** the task list of «Борги».

How they are carried out, not decided by the owner:
- **Only whoever recorded the return,** for the very request that recorded
  it, is answered without the right; anyone else's is refused, never
  answered its success nor told that nothing was recorded. The same request
  changed is refused as every replay's is.
- **The right to take returns, and with it the warehouses' access, is
  passed over** for such an answer, which moves no goods. A store the
  person no longer belongs to, or one that does not trade, refuses as
  before — its kept returns wait until it trades again (owner, 2026-10-08).
  So a person who still may take returns, but whose store no longer reaches
  the warehouse, stays held as before, while one without the right is
  answered (a reading for the owner).
- **A first sending still running is waited for:** the key is claimed
  first, and its answer given, never «nothing recorded» while it may still
  record. The claim is never committed: nothing is written for such an
  answer.

Built on 2026-10-18; see the [report](returns-redesign-7-report.md).

## Owner decision — 2026-10-18 («Повернення»: four readings after #105)

Asked after #105, each answer the option recommended:
- **A return is learned by whoever recorded it also when the store no
  longer reaches the warehouse it went to,** or the warehouse is closed, as
  when the right to take returns is gone: what it recorded, or that nothing
  was. No goods move; a new return to that warehouse is refused, as before.
- **«Повернення не записано …» said where the right or the warehouse is
  gone adds:** «Якщо гроші вже повернули — передайте папір менеджеру, щоб
  внести повернення з паперу.»
- **A first sending stalled before it claims its key,** for longer than the
  phone waits and the right taken away meanwhile, may record after the
  resend was told nothing was: accepted as a known risk.
- **The same rule for a kept sale, debt payment, delivery, stock correction
  or order's step** whose person lost the right: yes, later — after
  «Борги»'s list (backlog).

How they are carried out, not decided by the owner:
- **Every refusal of where the goods would go** — the store's reach of the
  warehouse, the one sold from or the one chosen, a private warehouse's own
  rule, a warehouse closed, a «Брак» undone — sends the resend to the same
  answer as the right gone, and carries the owner's sentence.
- **Whoever recorded it is judged by where it went,** as recorded, not where
  the store's setup would send it now, so it is answered past the days its
  key is kept too.
- **A warehouse closed reads** «Повернення не записано. Склад, куди йшов цей
  товар, закрито. Зверніться до менеджера.», with the owner's sentence; a
  «Брак» undone, «… У цього магазину ще немає складу «Брак» …», with it too.

Built on 2026-10-18; see the [report](credits-redesign-1-report.md).

## Owner decision — 2026-10-18 («Борги» in the new design: its task list's questions)

The task list: [2026-10-18-redesign-tz-credits.md](redesign/2026-10-18-redesign-tz-credits.md),
for the owner [2026-10-18-redesign-tz-credits-owner.md](redesign/2026-10-18-redesign-tz-credits-owner.md).
Each answer the option recommended:
- **В1. A payment's result by card or transfer** says what to do, as the
  till does: «Картка · Проведіть на терміналі 500,00 грн», «Переказ ·
  Перевірте, що переказ надійшов».
- **В2. A debt of a store that does not trade** is looked for by a quiet
  button under the results once a whole number is typed, as «Шукати там» in
  «Повернення».
- **В3. Debts from the notebook, from before Бірка,** are typed one by one —
  a new operation «Борг із зошита»: the customer's name and phone, what they
  owe, what they bought; by a manager or the owner. A new rule, and a work
  of its own (server and a migration).
- **В4. Paying in parts at the till** shows, in one line, that this number
  already owes, or had a debt written off; nothing is forbidden, the seller
  decides.
- **В5. No reminders of debts by the bot** now: with «Огляд», later.
- **Next:** the list and «Показати ще» (P0-1, P0-2).

How they are carried out, not decided by the owner:
- **A customer of more than one debt** opens their debts to choose from —
  P0-3's card, built with the list it is reached from: what they owe in all,
  and a row a debt; read by their phone, whatever was searched.
- **«Борг магазину, що зараз не працює?» stands under the results,** where
  В2 puts it; the way it looks for those debts is as before until P1-1.
- **A customer whose one debt is closed** says how it closed on the row,
  «Сплачено» or «Списано»; of more, «Нічого не винні».

Built on 2026-10-18; see the [report](credits-redesign-1-report.md).

## Owner decision — 2026-10-18 («Борги»: five readings after #106, and what next)

Asked after #106, each answer the option recommended — each confirms what
was built:
- **The customer card** — the name, the phone, «Винні всього» large, a row
  a debt with its goods, «з 01.10 · останній внесок 12.10» and what is owed
  — is approved; the seller chooses which debt is paid.
- **A customer whose one debt is closed** says on the row how it closed,
  «Сплачено» or «Списано»; of more, «Нічого не винні».
- **A kept return to a warehouse closed** reads «Повернення не записано.
  Склад, куди йшов цей товар, закрито. Зверніться до менеджера.», with the
  owner's sentence on money handed back.
- **A person who lost their right only at a private warehouse** is answered
  their kept return as a store that lost its reach of a warehouse is.
- **A «Брак» undone, or a warehouse to choose again,** also says
  «Якщо гроші вже повернули — передайте папір менеджеру, щоб внести
  повернення з паперу.»
- **Next:** the debt and the payment (P0-3, P0-4).

How the debt and the payment are carried out, not decided by the owner:
- **«← До боргів» leads back to the list;** a debt opened from a customer's
  card leads back to it by their name: one name for the «Борги» tab and a
  way back would be two buttons alike.
- **The payment's sum is named in its field** («Сума, грн»; read as «Сума
  внеску, грн»), so a usual debt's sum and ways are seen at 360 × 640
  without scrolling; the panel says the sum typed, or «Вкажіть суму внеску з
  точністю до копійок.» for one it cannot read.
- **«Вношу внесок з паперу» stands under the sum,** a group of its own.
- **Another store's payment in the history** reads «прийняв магазин
  «Центр»»: the store took it, never a verb of the person before it.

Built on 2026-10-18; see the [report](credits-redesign-2-report.md).

## Owner decision — 2026-10-18 («Борги»: four readings after #107, and what next)

Asked after #107, each answer the option recommended:
- **The way back from a debt** stays «← До боргів»; from a debt opened in a
  customer's card, the customer's name.
- **The payment's sum is named in its field,** and the panel says the sum
  typed.
- **«Вношу внесок з паперу» stays under the sum.**
- **A debt of more goods than one** names the first and «+ ще N»; a tap on
  it shows them all.
- **Next:** the payment's result (P0-5) and a payment kept unconfirmed
  (P1-2), with every good of a debt on a tap.

How the result and the kept payment are carried out, not decided by the
owner:
- **The result takes the place of the debt below its name and line,** its
  history too, until «Відкрити борг»: nothing to pay again under it.
- **Its main button is named as the debt's «←» is:** «До боргів» to the
  list, or the customer's name, back to their card, for a debt opened from
  it — two buttons of one name never lead to two places.
- **A screen reader hears the sentence it heard before:** «Внесок 500,00 грн
  прийнято карткою. Залишок боргу 1 500,00 грн.», with the heading as focus
  comes; the eye reads the pill, the sum and what is owed. From paper the
  sentence is seen, as it says not to charge the card again.
- **From paper, the pill is the paper's mark as the history says it:**
  «Внесок під час збою · хто прийняв: Ганна · за папером …»; confirmed
  later, the phone knows who only by an id, so the mark and its time.
- **Confirmed later, the way alone over the sum,** never «Проведіть» as a
  pill: only «Якщо картку ще не провели — …» below (owner decision,
  2026-10-07); the sum and way heard before it.
- **The kept banner names the first good and «+ ще N»;** goods that are
  not a list of names, or an empty first name, name none. «Перевіряємо
  списання…» while a write-off is asked about, as «Перевіряємо внесок…».
- **«+ ще N» opens the list once,** no «Сховати»; focus goes to the list.
- **The customer's phone,** on a debt and on their card, in the theme's
  accent, the same once called — asked for in the session.

Built on 2026-10-18; see the [report](credits-redesign-3-report.md).

## Owner decision — 2026-10-18 («Борги»: three readings after #108, and what next)

Asked after #108:
- **The result's main button, for a debt opened from a customer's card,**
  stays the customer's name, back to the card, as «←» is.
- **The sentence a screen reader hears after a card or a transfer payment**
  stays the one it heard before: «Внесок 500,00 грн прийнято карткою.
  Залишок боргу 1 500,00 грн.» — what to do with the money is in the pill,
  not said (the option recommended was to say it, as a return's result
  does; the owner chose not to).
- **Every good of a debt is read on the debt alone;** the list's row and the
  customer's card name the first and «+ ще N».
- **Next:** a debt found by each word of a name (P1-3), and «Борги»'s
  refusals in their own words, never an order's (P2-2).

How they are carried out, not decided by the owner:
- **A name is found word by word, as the till finds a model and
  «Повернення» a sale:** each word typed, literally, in any order and
  letter case, in the name of one debt; two spaces, or a space pasted from
  a contact, part two words as one does; a word typed twice is no
  different. Words of two debts of one customer do not add up: a customer
  whose debts are written «Ірина» and «Коваль» is not found by «Ірина
  Коваль». The customer found is shown with all their debts, as before. A
  query written as a phone, and the other stores' debts by a whole number,
  are as they were.
- **A payment or a write-off refused, as it is pressed, with nothing more
  than a conflict or a request refused** says what was not recorded, and
  why in the debt's words: «Внесок не записано. Дані боргу змінилися, поки
  ви працювали: перевірте залишок і спробуйте ще раз.», «Внесок не
  записано. Перевірте суму й спробуйте ще раз.»; a write-off's «Списання не
  записано. …», and for a request refused «Перевірте причину й спробуйте
  ще раз.», as a write-off has a reason, not a sum.
- **A kept one, not proven unrecorded, answered with a conflict or a
  request refused,** is not told to try again, as a return's is not (owner
  decisions, 2026-10-18): «Внесок ще не підтверджено:
  сервер відповів, що дані змінилися.» or «… сервер не прийняв запит.», and
  «Перевірте результат ще раз — двічі він не запишеться.» («воно» for
  «Списання»). Proven unrecorded: «Внесок не записано. Дані змінилися, поки
  сервер не відповідав.» or «Сервер не прийняв запит.», and «Відкрийте борг
  у «Боргах» і спробуйте ще раз.», the section named, as the banner may
  stand over any tab. Any other answer — a server's error, a request it
  could not find — keeps the words every screen shares, as a kept return's
  does.
- **A kept write-off is named so everywhere:** «Списання ще не
  підтверджено», «Перевірити результат списання», and once refused, its
  words drawn with its kind, never «Внесок» for a moment.
- **Other reads of «Борги»** — the list, a customer's card, erasing — keep
  the words they had.
- **The words are the task list's,** where it gives them; the write-off's,
  and the kept ones for a request refused, follow them, and wait for the
  owner's confirmation at hand-over, as «Повернення»'s did.

Built on 2026-10-18; see the [report](credits-redesign-4-report.md).

## Owner decision — 2026-10-18 («Борги»: four readings after #109, and what next)

Asked after #109, each answer the option recommended:
- **The words the task list did not give stay as built:** a write-off
  refused for its request, «Перевірте причину й спробуйте ще раз.»; a kept
  one's request refused, «… ще не підтверджено: сервер не прийняв запит …»,
  and proven unrecorded «… Сервер не прийняв запит. Відкрийте борг у
  «Боргах» і спробуйте ще раз.».
- **Words of two debts of one customer do not add up:** a customer whose
  debts are written «Ірина» and «Коваль» is found by either word, or by
  the phone, never by «Ірина Коваль».
- **A name is found whatever apostrophe it is typed with,** and a Latin
  «i» is the Ukrainian «і»: «Мар'яна», «Мар’яна» and «Марʼяна» are one name,
  as Android, an iPhone and a document write it; as the catalogue's check
  of a similar name reads them.
- **A kept payment, write-off or return asked about again and answered by
  a server's error, or a request not found,** is not told to try again: it
  could be paid or handed back twice. «Внесок ще не підтверджено: сервер не
  зміг відповісти. Перевірте результат ще раз — двічі він не запишеться.»,
  and the request's number, as the shared words gave it.
- **Next:** a closed store's debt asked for by the number already typed, by
  a quiet button, never a choice made first (P1-1; В2 (а)).

How they are carried out, not decided by the owner:
- **One field, «Ім’я або телефон».** When it holds a whole number, however
  written or pasted, a quiet button stands under this store's results for
  it, and under none, once this store has answered for that very number:
  «Борг магазину, що зараз не працює? Шукати за цим номером». It asks the stores that do not trade for the same number, under
  «Магазини, що не працюють», and «← У цьому магазині» comes back, the
  number kept both ways. Nothing is asked of them before the tap, nor for
  a name or a part of a number; a number changed there into one asks for
  the whole number again, as before.
- **A whole number that owes nothing here** says the rule: «За цим номером
  у цьому магазині боргів немає. Внесок приймає магазин, де продали.»; in a
  store that does not trade, the fact alone, «За цим номером у цьому
  магазині боргів немає.», with no button: it takes no payments.
- **This store reads a number as the closed stores do:** pasted from
  contacts between invisible marks, or written with dots or slashes, it is
  a phone here too, never a name owing nothing.
- **Each switch brings focus to what it opened:** «Магазини, що не
  працюють», or «Борги» on the way back.
- **The apostrophes read as one** are the catalogue's: ' ’ ʼ, and ` ´ ‘
  typed in their place; of its letters, only the Latin «i», as the owner
  answered — «a», «o» and the others are read as typed.
- **A server's error** is any answer the shared words met with «Не вдалося
  виконати операцію. Спробуйте ще раз.»: a 500, a request not found, any
  other the app has no words for. A 502, 503 or 504 is the server out of
  reach, with the outage's words; the app's own failure keeps its words;
  and a kept sale, delivery, correction or drawer command keeps the shared
  words, as the owner was asked of payments, write-offs and returns.

Built on 2026-10-19; see the [report](credits-redesign-5-report.md).

## «Борги» at the till: what a number already owes (P1-5) — 2026-10-19

After #110 was opened, asked to go on as recommended: P1-5, whose В4 the
owner answered on 2026-10-18 ((а): one line, nothing forbidden, the seller
decides). The three questions after #110 wait for its merge.

How it is carried out, not decided by the owner:
- **Under «Телефон покупця», once it holds a whole number,** however
  written or pasted, one line from the same read as «Борги» — this store's
  debts, the debt's store:
  - owed: «За номером уже винні 2 000,00 грн», in the debt's colour, the
    server's sum — said before any write-off;
  - nothing owed, a debt written off: «За номером борг списано
    12.03.2026», neutral, the latest write-off's date;
  - only paid off, a new number, or «Борги» not read: nothing, and the sale
    as any.
  Only for the number in the field, and only that very number's customer —
  never one whose number merely holds the digits typed. A digit changed,
  the line goes at once; never an answer from before a sale in parts. Its
  one line's room is kept once the number is whole, so nothing below moves
  when it comes. The same at «Клієнт забрав», asked of the order's store.
- **«За номером …», not the owner's example «За цим номером …»:** at 360 px
  the till's column holds 262 px; «За цим номером уже винні 2 000,00 грн»
  takes 268 in bold, a six-figure sum 285, the write-off 271 — two lines.
  «За номером …» takes at most 255, right under the phone it speaks of.
  For the owner to confirm.
- **What paying in parts means, in one line at 360 px:** «Решту — у
  «Боргах» цього магазину.», at the till and at «Клієнт забрав». The task
  list's «Решту покупець доплачує в «Боргах» цього магазину.» takes two
  lines in the till's column (346 px of 262), and «… магазину замовлення»
  for an order the same; an order is this store's, as its words before
  said. For the owner to confirm.
- **Nothing is sent differently,** and no rule «не продавати частинами»
  appears.

Built on 2026-10-19; see the [report](credits-redesign-6-report.md).

## Owner decision — 2026-10-19 (seven readings after #110 and P1-5, and what next)

Asked after #110 was merged, while P1-5's CI ran:
- **A kept sale, delivery, stock correction, drawer command or order step
  answered with a server's error** is not told to try again either, as a
  kept payment, write-off or return is not: «… ще не підтверджено: сервер не
  зміг відповісти. Перевірте результат ще раз — двічі … не запишеться.»,
  with the request's number. *(Built 2026-10-20, below.)*
- **A kept command answered «not found» three times** adds «Зверніться до
  менеджера — він перевірить, чи записано.»; the app still never records it
  twice. *(Built 2026-10-20, below.)*
- **A letter pasted in two parts** — «ї» as «і» and its dots, «й» as «и»
  and its breve — is the letter, in the debts' search.
- **The till's words for paying in parts stay as built:** «Решту — у
  «Боргах» цього магазину.», «За номером уже винні …», «За номером борг
  списано …».
- **A number that owes and had a debt written off** says what it owes
  only, as built.
- **A closed store's debt of the number is said at the till too,** on a
  line of its own — the option not recommended.
- **Next:** these, and the empty «Борги» that says where a debt begins
  (P1-4), without the notebook's operation (В3 (а), in the backlog).

How they are carried out, not decided by the owner:
- **The closed stores are asked by the whole number, for what is still owed
  there, as «Борги» asks them:** «Винні 1 500,00 грн магазину «Ринок»», in
  the debt's colour; for more than one, «Винні … магазинам, що не
  працюють». One line always, the sum first: a long name is cut, never the
  sum. Stores are counted by who they are, and only where something is
  owed. Both answers are waited for, so the lines come together — but this
  store's line waits on the closed stores a moment and a half at most, and
  not at all once they fail. Alone, the closed store's line stands in the
  line's room; beside this store's — rare — it is a second line, and what
  is below moves by it once.
- **An empty «Борги»:** «Зараз ніхто не винен. Борг з’являється, коли
  продають частинами.», and «Новий продаж» to the till's search for whoever
  may sell there, held while a kept command waits, as the till's own button
  is — not «До каси», which names the drawer here. A search that finds
  nothing, the paid and written off asked for, and a store that does not
  trade keep their words.
- **A letter's one form:** names are compared as Unicode's NFC, after the
  apostrophes and the Latin «i» are folded — so a Latin «i» and its dots is
  «ї» too; nothing stored changes.

Built on 2026-10-20; see the [report](credits-redesign-7-report.md).

## A kept command's words for a server's error, and a manager after three «not found» — built 2026-10-20

The owner's two answers of 2026-10-19 above, marked «to be built, next»,
are built.

How they are carried out, not decided by the owner:
- **The kept commands the owner named, and the stocktake's count** — a
  sale, a delivery, a stock correction, the drawer's commands and an
  order's step, beside the payment, write-off and return built before —
  answered by a server's error, a request not found, or any answer the app
  has no words for, while their outcome is unknown (at their first press,
  or asked about again), say «{what} ще не підтверджено: сервер не зміг
  відповісти. Перевірте результат ще раз — двічі {it} не запишеться.», and
  the request's number where the server gave one: «Продаж … він»,
  «Приймання … воно», «Коригування … воно», «Підрахунок … він», «Зміну
  способу оплати … вона», «Причину … вона», «Видачу … вона», «Внесення …
  воно», «Операцію «Відправлено» … вона» — named from its first press.
- **An order's step or a sale the server answered, whose reading alone
  failed,** keeps the shared words: it is recorded. A step refused at its
  first press keeps them too: it never was.
- **From the third «not found» in a row** for one kept command, its words
  add «Зверніться до менеджера: нехай перевірить, чи записано.» — the
  owner's «він перевірить» put without a gender, as the app's words are.
  Any other answer begins the count again; no answer at all, or the app's
  own failure, leaves it as it is. The count is the phone's own for the
  session, and begins again when an attempt is read from the phone's
  storage — reopened, or another store's. *(Superseded 2026-10-21: kept
  beside the attempt across reopening, below.)*
- **Not changed:** a refusal that proves nothing was recorded, a phone that
  cannot reach the server (502–504 too), the app's own failure, and the
  suppliers', invoices', stores' and catalogue's kept commands, which the
  owner's answer did not name.

Built on 2026-10-20; see the [report](kept-words-report.md).

## Owner decision — 2026-10-21 («Борги»: three readings after #112, and what next)

Asked after #112 was merged, with #113 open, each answer the option
recommended:
- **A closed store's line at the till stays as built:** «Винні 1 500,00 грн
  магазину «Ринок»», one line, the sum first, a long name cut.
- **A number whose debt here was written off and which owes a closed
  store** says what it owes there, alone — as what is owed here is said
  over a write-off (2026-10-19): what is owed comes before what was
  written off, anywhere. *(Built 2026-10-21, below.)*
- **A Latin «ï» typed as one sign** is «ї» in the debts' search, as a
  Latin «i» is «і»; nothing stored changes. *(Built 2026-10-21, below.)*
- **Next:** the task list's last three — one set of words, with «Немає
  доступу до боргів» said nowhere (P2-1); the list's places while it is
  read (P2-3); pills by what they mean, the meta at 14 px and both themes
  (P2-4).

## «Борги»'s task list closed, and the two answers after #112 — built 2026-10-21

How they are carried out, not decided by the owner:
- **The write-off here waits for the closed stores' answer, or their
  failure,** however long: it is never said and then taken back. This
  store's own debt still waits for them a moment and a half at most.
- **«ï»** is folded with the apostrophes and the Latin «i», after the letter
  case is lowered, so «Ï» is «ї» too, typed or stored.
- **A kept payment or write-off on a phone whose person may no longer open
  «Борги»** (`sale:credit`) shows its banner over whatever tab is open, as
  a kept return's banner stands: «Борги» is turned to only for whoever may
  open it, and «Немає доступу до боргів.» is said nowhere. Unlike a kept
  return (owner decision, 2026-10-18), nothing more changes: the server
  refuses such a person before it looks the command up, saying nothing of
  what was recorded, so the command stays kept, and the till, «Повернення»
  and «Каса» with it, until the right is given back — as before this
  change. Under the banner, the app's words for any refused right, «Немає
  доступу до цієї операції або складу. Зверніться до менеджера.». Whether
  it should be answered and the till freed, as a return is, is the
  owner's to say (asked after this change). The rest of the task list's
  words were changed with the tasks before.
- **While «Борги» is read,** the store's card «Магазину винні» stands in its
  own lines' heights, its sum and count grey, and three rows of a mark, a
  name and its meta, and a sum on the right; a screen reader hears
  «Завантажуємо борги…». Neither the field nor the first row moves when
  they come. A card that cannot be read leaves no place, so what is under
  it moves up once — rare, as the list is read from the same server; a sum
  of seven figures or more takes two lines at 360 px, and moves it down
  once.
- **Pills by what they mean:** «Сплачено» in the accent; «Списано», «Нічого
  не винні» and another store's «Магазин «…»» neutral; a payment's result
  from paper a warning, as before; and a payment from paper's mark in a
  debt's history in the warning's colour, its words as they were. What is
  owed stays in the debt's colour. Every one reads at 4.5:1 or more in the
  light theme and the dark, and a debt's screens' meta is 14 px.

Built on 2026-10-21; see the [report](credits-redesign-8-report.md).

## Owner decision — 2026-10-21 (kept commands: four readings after #113)

Asked after #113 and #114 were merged, each answer the option recommended:
- **«Зверніться до менеджера: нехай перевірить, чи записано.»** stays as
  built, without a gender.
- **The three «not found» are remembered across Telegram closing and
  reopening the app:** each opening checks a kept command once, so a count
  begun afresh would rarely reach three. *(Built 2026-10-21, below.)*
- **An order's step the server confirmed, whose order cannot be read
  after,** says its own words, never the shared «Не вдалося виконати
  операцію. Спробуйте ще раз.». *(Built 2026-10-21, below; its words to be
  confirmed.)*
- **A kept command answered that the server did not take its request** (a
  400) says «… ще не підтверджено: сервер не прийняв запит …», as a kept
  payment's 422 does — for every kept command. *(Built 2026-10-21, below.)*

## Kept commands: the count across reopening, a confirmed step, a request not taken — built 2026-10-21

How they are carried out, not decided by the owner:
- **The count is kept beside the attempt on the phone,** never in what is
  sent — a sale's, an order's step's, and every command of the shared
  journal (deliveries, corrections, counts, the drawer's, returns, payments
  and write-offs; the suppliers', invoices', stores' and models' too,
  though their words do not use it). An attempt read from the phone begins
  from its own count; one whose count is not a whole number from 0 begins
  from none, and is read as ever; past 999 it is 999. A count is written
  only beside the very attempt it counts, never over another command still
  unsettled.
- **A confirmed order's step whose order cannot be read:** «Операцію
  «Відправлено» записано. Замовлення не вдалося показати — натисніть
  «Оновити результат».» — the banner's own button, where the owner's
  option read «оновіть список замовлень»: the step's banner holds the
  screen until that button reads the order. They replace the shared «Не
  вдалося виконати операцію. Спробуйте ще раз.» alone, a server's own
  failure keeping its request's number; every answer with words of its own
  — the server out of reach, a session ended, too many requests — keeps
  them.
- **«Не прийняв запит»** also answers a 422 the shared words would call
  «Перевірте дані та поточний статус замовлення.» — an order's words on a
  sale's banner; a 422 with words of its own keeps them. A request's
  number is said for a server's own failure only, as before.
- **Not changed:** a sale the server answered whose reading alone failed
  keeps the shared words, as the owner was asked of an order's step only.

Built on 2026-10-21; see the [report](kept-answers-report.md).

## Owner decision — 2026-10-21 («Каса»'s task list: five questions, and what first)

Asked when «Каса»'s task list was written
([redesign/2026-10-21-redesign-tz-cash.md](redesign/2026-10-21-redesign-tz-cash.md)),
each answer the option recommended:
- **В1. The reminders before the count are on the count's screen:** «Спершу
  запишіть видане з каси», «Поки рахуєте, не продавайте.» and one line,
  «Спершу внесіть усе з паперу й перевірте, чи нічого не чекає на інших
  телефонах.»; none on «Каса»'s main screen. *(Built 2026-10-21, below.)*
- **В2. A kept drawer command's paper line is the drawer's own:** «Телефон
  перевірить сам. Нічого не повторюйте, поки він не скаже «не записано».»
  *(For P1-1.)*
- **В3. A count that reached the server more than ten minutes late,** the
  same evening, the drawer still open: «Перерахуйте касу ще раз і
  закрийте»; the next day, the words as before. *(For P1-1.)*
- **В4. A shortage and a surplus are both a warning's colour** — neither a
  debt nor anyone's fault; «Збіглося до копійки» the accent's. *(Built
  2026-10-21, below.)*
- **В5. The sellers' page says what to do with cash taken out during an
  outage:** «Видали гроші з каси — запишіть суму, на що й хто взяв; коли
  сервер відповість, внесіть через «Видати з каси» до підрахунку.» — the
  page's words only; the rule was there. *(Written 2026-10-21.)*
- **First:** the close — the main screen, the count and its result
  (P0-1, P0-2, P0-3), together.

## «Каса»: the close under the approved design — built 2026-10-21

How it is carried out, not decided by the owner:
- **«Каса»'s main screen:** its heading, one line where the drawer stands —
  «Каса відкрита · останнє закриття 06.10, 20:14 · Олена», «Каса ще не
  рахувалась», «Сьогодні закрито о 20:14 · Олена», or in a store that does
  not trade «Останнє закриття …» — and the count as one large card, «Закрити
  касу» / «Скільки мало бути — покажемо після підрахунку» («Перший
  підрахунок» / «Запишемо, скільки в касі зараз» the first time), for
  whoever may close and not yet today. Then the other tasks as rows, each
  with what it is for, by the same rights as before: «Видати з каси»,
  «Внести в касу», «Змінити спосіб оплати» (one word for the seller's and
  the manager's), «Закриття». Cash moved since the close, a row each: what
  for, when and who, the sum on the right, «−» out and «+» in. «Оновити» is
  gone: the drawer is read when «Каса» opens, after every command, and when
  the card is tapped — the count opens on that read alone, while it still
  asks for the count, so never while the server does not answer, whose
  words «Каса» says (G26). Nothing tells a sum before the count (G32). The dark
  card is the text's colour in either theme, so it inverts in the dark one
  — *superseded: the owner chose it dark in either theme (2026-10-21), built
  2026-10-22, below.*
- **The count, a screen of its own:** «← Каса», «Підрахунок каси», the
  owner's reminders, one large field for «Скільки готівки в касі зараз»
  with the cursor in it, and the panel under the thumb: «Впишіть суму» or
  «У касі 2 000,00 грн», «Закрити касу» held until the sum reads (0 is a
  sum; «2000,» is a sum still being typed), and its confirmation there —
  «Закрити касу: у касі …?», the sum as large, «Змінити потім не можна.»,
  «Так, закрити», «Скасувати», which keeps the sum. Still four taps and the
  sum. What is sent is as before: the count, its moment, and the newest
  close the card's read named; the panel waits while the drawer is read
  again. «Спершу запишіть видане з каси» records cash taken out and comes
  back to the count with its sum; left any other way, the sum is not kept —
  a count is of its moment (G31). The count is left, too, when the drawer
  can no longer be read or no longer asks for it. A refusal is said over
  the panel, the sum kept; no answer — «Каса» and its banner.
- **The result:** «Касу закрито» («Перший підрахунок записано» the first
  time), the close's day — and its store, when another's, as a reason owed
  is the closer's in any store — «Мало бути» and «Порахували» large, one
  under the other, and the difference on its own line; «Картка» and «Переказ» as rows, the card's
  parts and «звірте з чеком терміналу» under it. Every figure the server's.
  The owner's and managers' period figures as before, on a class of their
  own. A difference to explain owes its reason here: the field and the
  quick reasons on the screen, the cursor not in the field, «Записати
  причину» in the panel with «Поки причину не записано, інші розділи
  недоступні.»; once written, the reason and «Готово». A reason owed holds
  the other tabs, never «Каса»'s own tasks (G12): it opens by itself once,
  «← Каса» leads back, and «Каса» shows the close waiting for its reason
  with «Записати причину», its count and rows as ever. A close that cannot
  be read says so, with «Спробувати ще раз». A buzz when the close
  is recorded, another when it is refused; none for one kept and confirmed
  later. Today's own close stands on «Каса» compact: «Мало бути … ·
  Порахували … · Нестача …» and the reason.

Built on 2026-10-21; see the [report](cash-redesign-1-report.md).

## Owner decision — 2026-10-21 (six readings after #117 and #118)

Asked after #119 was opened and merged, each answer the option
recommended:
- **A kept payment or write-off whose person may no longer make it** is
  answered as a kept return is (2026-10-18): what it recorded, to whoever
  made it, or that nothing was, and the till is freed. *(Built 2026-10-21,
  below.)*
- **«Магазину винні» that cannot be read keeps its place,** with «Не вдалося
  прочитати» and a quiet «Спробувати ще раз»; nothing moves. *(Built
  2026-10-21, below.)*
- **A kept payment refused for the right says «Борги»'s own words,** never
  the shared «Немає доступу до цієї операції або складу». *(Built
  2026-10-21, below; the words confirmed by the owner on 2026-10-22.)*
- **A confirmed order's step whose order cannot be read** keeps «… натисніть
  «Оновити результат».», as built.
- **«Не прийняв запит» for a 422 the shared words would call «перевірте
  дані»** stays, as built.
- **Three «не прийняв запит» in a row** ask for a manager too, as three «not
  found» do. *(Built 2026-10-21, below.)*

## A kept payment answered to whoever lost the right, «Магазину винні» kept, a manager after three requests not taken — built 2026-10-21

How they are carried out, not decided by the owner:
- **The server answers a payment or a write-off resent by whoever may no
  longer make it** with their own command's entry — the request's
  fingerprint names its person — and the debt's sums now, but no phone and
  no one else's entry, as someone who may no longer read debts; or, when
  nothing was recorded under it, refuses for the right saying so
  (`recorded: false`), so the phone settles it and the till is freed.
  Looked up under the debt's row lock, which a first sending still running
  holds. Anyone else's command, or another request under the same command,
  is refused as before, saying nothing of what was recorded. A store this
  person no longer belongs to, a store that does not trade, and a write-off
  of a debt of a store that does not trade (the network's owner's) are
  refused as before, before any lookup, as a return's are: the phone keeps
  the command, for a store that does not trade until it trades again
  (owner, 2026-10-08).
- **«Борги»'s words for the right:** kept, «Внесок ще не підтверджено: у вас
  більше немає права приймати внески. Зверніться до менеджера.»
  («Списання … списувати борги. Зверніться до власника.» — the right to
  write off is the owner's to give); settled as recorded nothing, «Внесок не
  записано: у вас більше немає права приймати внески. Зверніться до
  менеджера. Якщо гроші вже взяли — передайте папір менеджеру, щоб внести
  внесок з паперу.», as a return's words say for money handed back;
  recorded, «Внесок записано один раз» over the till, as any.
- **«Магазину винні» that cannot be read** keeps the place it had while read,
  its lines unseen, «Не вдалося прочитати» and «Спробувати ще раз» over
  them.
- **The count towards a manager** takes «not found» and a request not taken
  — a 400 or a 422 — in one row, whichever comes; any other answer begins
  it again. A kept payment's and return's request not taken now say the
  shared words, the same as before, with the manager from the third.

Built on 2026-10-21; see the [report](credits-kept-right-report.md).

## Owner decision — 2026-10-22 (four readings after #120)

Asked after #120 was merged, each answer the option recommended:
- **A kept payment answered to whoever lost the right** shows their own
  payment and what the debt still owes, as built — never the customer's
  phone nor anyone else's payments.
- **The words for the right stay as built:** «… у вас більше немає права
  приймати внески. Зверніться до менеджера.», «… списувати борги.
  Зверніться до власника.», and after a payment proven unrecorded «Якщо
  гроші вже взяли — передайте папір менеджеру, щоб внести внесок з
  паперу.»
- **A payment proven unrecorded on a debt paid off meanwhile** keeps that
  paper line: the manager typing it sees the debt paid and gives the money
  back, as the sellers' page says.
- **A first sending stalled before the debt's lock** while the right is
  taken away, which may record after the phone was told «не записано», is
  **accepted**, as a return's was (2026-10-18).

## «Каса»'s kept command named by what and how much, a late count of the same evening counted again, the dark card dark in either theme — built 2026-10-22

The owner's answers of 2026-10-21 (В2, В3, and the dark card) carried out;
how, not decided by the owner:
- **A kept drawer command's banner is headed by what it is** — «Підрахунок
  ще не підтверджено», «Причину …», «Видачу …», «Внесення …», «Зміну
  способу оплати …»; «Перевіряємо підрахунок…» while it is checked — and
  says it from the attempt alone, once its first sending is unknown — never
  while that sending is under way: «Підрахунок 2 000,00 грн — сервер не
  відповів. Двічі він не запишеться. Поки чекаємо, інші дії недоступні.»,
  «Видача 150,00 грн · Витрати — …», «Внесення 100,00 грн — …», «Зміна
  способу оплати: Картка → Готівка — …», «Причина різниці — …». What does
  not read is left out. The sum is the count's own, never what the drawer
  should hold (G32). Its button: «Перевірити підрахунок», «… видачу», «…
  внесення», «… зміну способу оплати», «… причину».
- **Under it, the drawer's own line (В2):** «Чекає відповіді сервера з
  14:20. Телефон перевірить сам. Нічого не повторюйте, поки він не скаже
  «не записано».» — no paper mark and no name, since nothing of the drawer
  is typed from paper.
- **Confirmed:** «Підрахунок записано один раз.» under the close's figures;
  «Видачу записано один раз: Витрати, 150,00 грн.»; «Внесення записано
  один раз: 100,00 грн.»; «Зміну способу оплати записано один раз: Картка
  → Готівка.», and «Пояснює різницю закриття 07.10.» when it does;
  «Причину записано один раз.», then «Власник отримає повідомлення.» within
  the bot's 15 minutes of the close, «Власник уже отримав повідомлення без
  причини — побачить її в застосунку.» when first sent after them, and
  otherwise — recorded sometime between, unknown which side — «Власник
  побачить її в застосунку.» Cash the server put on a colleague's close:
  «… — до закриття 07.10, гроші взяли до нього.», or «… внесли …» for cash
  put in — as the words of one answered at once now say too.
- **A count refused for coming over ten minutes late (В3),** taken in the
  drawer's day now — 06:00 to 06:00 (G8), by the phone's clock, so 23:50
  and 00:15 are one evening's, 05:50 and 06:10 two days' — while the
  drawer's read says it is still to be closed today: «Підрахунок не
  записано — він дійшов надто пізно. Перерахуйте касу ще раз і закрийте.»,
  and the count opens by itself, from «Каса»'s own screen, once the drawer
  is read anew — never while it is read or cannot be (G26), and once for
  that refusal, however often «Каса» is opened again. Taken on an earlier
  day, the drawer closed meanwhile, or the drawer not read: the words as
  before, and nothing opens. The new count is a command of its own, with
  its own sum and moment.
- **The dark card in the dark theme:** a dark surface (`#222C29`), light
  text (`#F1F4F2`) and a 1 px edge (`#66726D`, 3:1 on the section and the
  page); in the light theme as before.

Built on 2026-10-22; see the [report](cash-redesign-2-report.md).

## Owner decision — 2026-10-22 (three readings after #121)

Asked after #121 was merged, each answer the option recommended:
- **A take-out the phone keeps is not written on paper.** The sellers' page
  says, under cash taken out during an outage: «Натиснули «Видати з каси», а
  телефон пише «Видачу ще не підтверджено» — на папір не пишіть: телефон
  перевірить сам.» *(Written 2026-10-22,
  [the sellers' page](paper-when-the-server-is-down.md).)*
- **«Власник побачить її в застосунку.»** after a kept reason whose message
  timing is unknown stays, as built.
- **«Перевірте результат ще раз — двічі … не запишеться.»** beside «Каса»'s
  banner stays, as built: it means the button, never repeating the
  operation.
- **Next:** «Каса»'s P1-2 and P1-3 together. *(Built 2026-10-22, below.)*

## «Видати з каси» and «Внести в касу» with chips and the sum under the thumb, «Змінити спосіб оплати» by rows and one operation's card — built 2026-10-22

«Каса»'s task list, P1-2 and P1-3, whose screens the direction did not
draw — to be approved from the screenshots. How they are carried out, not
decided by the owner:
- **Cash taken out:** «← Каса» and «Видати з каси»; what for as chips, 48 px
  or more — «Витрати», «Кур’єру постачальника», and «Власнику» for whoever
  takes it out for the owner — nothing chosen until the person chooses; the
  chip puts the cursor in «Сума», its figures large; the note and the
  courier's hint as before; «Коли?» for whoever corrects, as before; and
  «Видати 150,00 грн» in the panel under the thumb, not to be pressed
  without a kind and a sum above nothing. «Каса», «Видати з каси», a chip,
  the sum, the button: four taps and the sum. **Cash put in** has one kind:
  the cursor in «Сума» at once, «Внести 100,00 грн» — three taps and the
  sum. What is sent is as before.
- **Recorded:** a buzz, and back where it came from — «Каса», or the count,
  whose «← Підрахунок» this screen then shows — with the words as before
  («Записано: Витрати, 150,00 грн.»). **Refused:** a buzz, why over the
  panel, what was typed kept and the cursor in the sum; pressed again it is
  a new command. **Unanswered:** the form stays, held under «Каса»'s banner
  with what was typed; refused on the phone's own check, it is there to
  record again; confirmed, back where it came from with «Видачу записано
  один раз: …», nothing left on the form to press again — for a way changed
  too.
- **A way changed:** «← Каса», «Змінити спосіб оплати», «Ваші операції після
  останнього закриття», and the seller's operations a row each — the time
  on the left, «Продаж» / «Внесок» / «Повернення», the goods under it —
  never a sum nor a way (G32); an operation of a day nobody closed by its
  date too, «21.10, 18:40». One operation: «Продаж · 20:05» (the moment
  only when the list said it; from the receipt «Продаж»), its sum large,
  «Зараз: Картка» as a pill («· виправлено» when it was), the ways as the
  till's buttons — an order's sale's five a row each — the one it has now
  marked «зараз» and not to be chosen; «Пояснення (необов’язково)» as before; and
  «Змінити на «Готівка»» in the panel, «Оберіть новий спосіб» until one is.
  «Каса», the row, the operation, the way, the button: five taps; from the
  receipt three. A buzz when it is recorded or refused; a way changed
  meanwhile is read again, the way it now has no longer to be chosen, and
  the cursor on a way to choose. What is sent is as before.
- **The owner's and managers' correction** takes the same card for the
  operation they chose — «Продаж · 20:05 · the goods · who», «Інша
  операція» under the ways; refused, why is said over the day's list read
  again, where it was lost before. Its day and its list stay as they are
  until P2-4.

Built on 2026-10-22; see the [report](cash-redesign-3-report.md).

## Owner decision — 2026-10-22 (after #122)

Asked after #122 was merged, each answer the option recommended:
- **«Видати з каси» and «Змінити спосіб оплати» are approved as built**
  (2026-10-22, [screenshots](../../output/verification/2026-10-22-cash-move-fix/screens/)).
- **The seller's two chips stay as they are:** on a phone whose font is
  wider, the second goes to the next row, as the owner's three do.
- **Next:** «Каса»'s P1-4, «Закриття». *(Built 2026-10-22, below.)*

## «Закриття» a row a close, what it came to as a pill, a close tapped as its result — built 2026-10-22

«Каса»'s task list, P1-4, whose screen the direction left for a second
stage — to be approved from the screenshots. For the owner and managers
(`report:view_financial`), as before. How it is carried out, not decided
by the owner:
- **A row a close:** «20.10 · Оля», what it came to as a pill under it, one
  column down the list — «Нестача 50,00 грн» and «Надлишок 350,00 грн» a
  warning's, «Збіглося» the accent's (В4), «Перший підрахунок» plain — and
  under them «20:14 · порахували 2 000,00 · мало бути 2 050,00», with «·
  причину не вказано» when a reason was owed and not given, and «·
  пояснено +50,00» when there is a difference and something explains it,
  as the close itself says. Every figure is the server's.
- **A day nobody closed** is a row of its own, «19.10» and a plain pill «Не
  закрито», under the close it went into, newest first.
- **A close tapped** is all of it, as its result showed it, read again by
  its id: «Закриття 20.10» — a first count «Перший підрахунок 11.09», and
  without «З цієї суми почнемо наступного разу», long come — when and who,
  «Мало бути» and «Порахували» large and what it came to, the card and the
  transfer, the days nobody closed, the reason, the period's cash and what
  explains the difference; «← Закриття» back to the list where it was left,
  the row tapped in hand.
- **«← Каса»** where «До каси» was, as on «Каса»'s other screens; twenty
  closes a page and «Показати ще», a year back, as before.

Built on 2026-10-22; see the [report](cash-redesign-4-report.md).

## Owner decision — 2026-10-22 (after #124 was opened)

Asked when #124 was opened, each answer the option recommended:
- **«Закриття» is approved as built** (2026-10-22,
  [screenshots](../../output/verification/2026-10-22-cash-history/screens/)).
- **Next:** «Каса»'s P2-1, P2-2 and P2-3 together. *(Built 2026-10-22,
  below.)*

## «Каса»'s own words for a refusal it did not name, its places while read, a server that does not answer as a warning — built 2026-10-22

«Каса»'s task list, P2-1, P2-2 and P2-3. How they are carried out, not
decided by the owner — the words to be confirmed at delivery, as the task
list says:
- **A refusal «Каса»'s words do not name** says the drawer's own, never an
  order's: refused at the press, «Не записано: дані каси змінилися, поки ви
  працювали. Спробуйте ще раз.» for a conflict, and for a request not taken
  what it holds to check — «Не записано. Перевірте суму й спробуйте ще
  раз.» for a count, «… суму та примітку …» for cash moved, «… причину …»
  for a reason, «… пояснення …» for a way changed. A note the server cannot
  keep: «Не записано: у примітці є знаки, яких не зберегти. Приберіть їх і
  спробуйте ще раз.» A kept command the server says changed, with nothing
  proven, «{Що} ще не підтверджено: сервер відповів, що дані змінилися.
  Перевірте результат ще раз — двічі {воно} не запишеться.», as a return's
  and a payment's; proven unrecorded, «Видачу не записано. Дані каси
  змінилися, поки сервер не відповідав. Спробуйте ще раз.» (or «Сервер не
  прийняв запит. Спробуйте ще раз.»), cash moved named by its way. A
  refusal «Каса» names says why, as before; an operation that cannot be
  read is a read's words, never «Не записано».
- **«Немає доступу до каси.» is never said:** the right gone while «Каса» was
  open, it shows nothing, as «Борги».
- **Cash put in is of the kind «Розмін»:** «Записано: Розмін, 100,00 грн.»;
  its row «Внесено · розмін», as before. **The owner's and managers'
  correction** has «← Каса», as every screen of «Каса».
- **While «Каса» is read,** grey places: where the drawer stands, in its
  own slot over what is kept, the card «Закрити касу» in its own size where
  it will stand — for whoever may close — and two rows; an operation's, its
  sum, its way and the ways' row; a close's day and three figures; the
  lists' rows. Still under reduced motion. A screen reader still hears
  «Завантажуємо касу…» and the rest, as before.
- **The drawer that cannot be read** is a warning's plate on «Каса», never a
  debt's red, its words as before; other reads that fail, and a kept
  command's error, keep their alert. What is said under a field or a task
  is 14 px on every screen of «Каса».
- **Left as it is:** the server's own words for cash put in that explains a
  close, «Внесено в касу (розмін)», under «Що пояснює різницю».

Built on 2026-10-22; see the [report](cash-redesign-5-report.md).

## Owner decision — 2026-10-22 (after #125 was opened)

Asked when #125 was opened, each answer the option recommended:
- **«Каса»'s new words are approved as built:** a conflict, a request not
  taken by what it holds, a note the server cannot keep, a kept command
  proven unrecorded, cash put in of the kind «Розмін».
- **The server says «Розмін» too,** where cash put in explains a close
  («Що пояснює різницю»). *(Built 2026-10-23, below.)*
- **Next:** «Каса»'s P2-4, the owner's and managers' correction. *(Built
  2026-10-23, below.)*

## The owner's and managers' correction by a day's switch and rows, and «Розмін» from the server — built 2026-10-23

«Каса»'s task list, P2-4, whose screen the direction left for a second
stage — to be approved from the screenshots. For whoever corrects
(`cash:correct`), as before. How it is carried out, not decided by the
owner:
- **The day as a switch:** «Сьогодні», «Вчора», «Інший день» — the last
  opening the calendar's «День», nothing read until a day is chosen.
  «Сьогодні» and «Вчора» are the drawer's days by the phone's clock, 06:00
  to 06:00 (G8), as the server reads them: at 00:30 «Сьогодні» is the
  evening just worked, the calendar's latest day the same. The date field
  before opened on the calendar's day, which before 06:00 read a day not
  yet begun (review, 2026-10-23).
- **A row an operation:** «Продаж · 20:05 · Оля» and its sum beside it;
  under them, the row's whole width, the goods, the close it fell in
  («закриття 22.10») and, for one that may not be changed, «змінити не
  можна» — not to be pressed, read as clearly as any other; its way as a
  pill under the goods, «· виправлено» when it was. The task list put the
  pill beside the sum; at 360 px a collected order's «Накладений платіж ·
  виправлено» left the goods a word a line, so it stands under them, as
  «Закриття»'s pill does (review, 2026-10-23).
- **The close an operation fell in is the server's to name** (`close_day`
  of the day's events, read-only: the close that ended its period). The
  phone named it from the closes it had read — the last ten in thirty days
  — and for a day further back named the wrong one, on the card before
  this change too (review, 2026-10-23).
- **One chosen** is the card of P1-3, «Пояснить різницю закриття 22.10» a
  line under it, never a plate; «Інша операція» back to the day. A
  refusal is said over that day's list and goes with another day. Today's
  operation in five taps — «Каса», «Змінити спосіб оплати», the row, the
  way, «Змінити на «…»»; yesterday's in six, with «Вчора». What is sent is
  as before.
- **The server's word for cash put in is «Розмін»,** as everywhere in
  «Каса»: «Розмін: з банку» where it explains a close. Made when read;
  nothing stored changes.

Built on 2026-10-23; see the [report](cash-redesign-6-report.md).

## Owner decision — 2026-10-23 (after #126 was opened)

Asked when #126 was opened, each answer the option recommended:
- **«Змінити спосіб оплати» (P2-4) is approved as built,** the way under
  the goods as «Закриття»'s pill, not beside the sum as the task list had
  it.
- **Next: the task list for «Замовлення»,** the next section by how often
  it is used, with «Борги» the future tab «Клієнти». «Каса»'s P2-5 waits,
  with «Повернення»'s P2-6 and «Борги»'s P2-5, for the bottom menu, not
  chosen yet (2026-10-14).

## Owner decision — 2026-10-23 («Замовлення»'s task list)

Asked when «Замовлення»'s task list was written
([redesign/2026-10-23-redesign-tz-orders.md](redesign/2026-10-23-redesign-tz-orders.md)),
each answer option (а), the one recommended:
- **В1. An order is known by its goods and its waybill,** never by the
  eight characters of its id: no «№ 3f2a9c1b» in a row or a title; the
  number stays small on the order's card only.
- **В2. «Клієнт забрав»: the five ways are the buttons** that record it,
  as at the till and in «Борги»; after it, «Продаж записано» with the way
  and the sum large («Картка · Проведіть на терміналі»).
- **В3. A new order's price is the sale price filled in,** as at the till,
  and may be changed.
- **В4. An order's step the server has not confirmed says «Каса»'s line**
  — the phone checks it itself, nothing is to be repeated — never the
  shared line about paper: an order's steps are never typed from paper.
- **В5. The statuses' colours by what they mean:** «До відправлення» the
  warning's yellow; «Відправлено» and «Прибув на пошту» the blue «в
  дорозі»; «Клієнт забрав» the accent's green; «Скасовано» and «Повернено
  на склад» grey.
- **В6. An optional mark «Оплачено наперед» when an order is made:** new
  data, a separate task in the backlog, its own questions to the owner
  before it is built.
- **В7. Orders sent before Бірка are finished in the notebook;** Бірка
  holds only the new ones.
- **First: P0-1 and P0-4 together** — the list with «Потрібно
  відправити» and «В дорозі» on top, a row without a sum, the waybill
  found as it is typed; a question before an order is cancelled.

## «Замовлення»: the list by what is to be done, and a cancel asked first — built 2026-10-23

«Замовлення»'s task list, P0-1 and P0-4, chosen by the owner the same day.
How it is carried out, not decided by the owner:
- **What is to be done on top:** «Потрібно відправити · N» (to be sent)
  and «В дорозі · N» (sent, or arrived at the post office), oldest first —
  the next to send on top; a group with none is not shown. Counted once
  every open order is read: past a hundred, «Показати ще» reads the rest
  into their groups, and the groups say no number until it has.
- **A row a parcel's tag:** its goods, «Лоран шоколад · M × 2», two named
  and «+ ще N»; how it goes, «Нова пошта · ТТН 2045…», and since when, «з
  21.10», an abroad note by its first sixty characters, a long one broken
  where it must; its status as a pill under them, as «Закриття»'s and the
  correction's are — the task list put it on the right, where at 360 px it
  left the goods a word a line. No sum, no way, no id's characters (G32;
  В1). The whole row opens the order.
- **The closed under «Показати завершені»:** «Завершені», newest made
  first, fifty at a time, «Завершених замовлень немає.» when none;
  «Сховати завершені» puts them away, the focus on what took the button's
  place. Nothing open: «Зараз
  нічого не треба відправляти.» — and never an order at all: «Замовлень ще
  немає. Замовлення тримає товар у резерві, поки його не відправили.» with
  «Нове замовлення» for whoever may make one.
- **«Номер ТТН» found as it is typed,** from two characters after a pause,
  Enter at once, as the till's search; every status, newest first, with its
  pill; the rows found before stand until the new ones come. Nothing
  found: «За «…» замовлень не знайдено. Перевірте номер ТТН.» and
  «Очистити» — never said before the search's own answer. What was typed,
  and the closed shown, stay while an order is opened and left; afresh
  when «Замовлення» is chosen again.
- **«+» beside «Замовлення»** opens «Нове замовлення», for whoever may make
  one in a store that trades; «+ Нове замовлення» stays under «Ще» until
  the bottom menu. «Оновити», «Знайти», «Попередні» and «Наступні» are
  gone: the list is read on entering, as the app comes back, and after
  every step; a list that cannot be read says so over the rows read, with
  «Спробувати ще раз».
- **The server reads the open or the closed** (`status=open|closed` on
  `GET /orders`): read-only, the stores' access filtered before the page as
  before, no migration.
- **«Скасувати замовлення» asked first,** at the card's foot after the
  history: «Скасувати замовлення? Резерв звільниться — товар знову можна
  продати. Відновити замовлення не можна.», «Так, скасувати» and «Ні,
  залишити», the focus on «Ні, залишити»; both held while the cancel is on
  its way or kept, as it may still be recorded. Cancelled, a buzz and
  «Замовлення скасовано, резерв звільнено.» under its pill «Скасовано».
  Refused, a buzz of its own, why at the screen's top brought to the
  finger, and the order read again. Only before it is sent, as before;
  what is sent is as before.
- **Not yet, by the task list's order:** the order's card (P0-2) — its
  title still «Замовлення № …»; «Клієнт забрав» (P0-3); «Нове замовлення»
  as a sale (P0-5); the statuses' colours (P2-3, В5); places while read
  (P2-2); the words of a refusal (P1-2).

Built on 2026-10-23; see the [report](orders-redesign-1-report.md).

## Owner decision — 2026-10-23 (after #127 was opened)

Asked when #127 was opened:
- **«Замовлення»'s groups newest first,** not oldest first as built: the
  order made last on top of «Потрібно відправити» and «В дорозі», the one
  waiting longest at the foot. The rest of the list is approved as built —
  the groups, the closed under «Показати завершені», the pill under the
  goods. *(Built 2026-10-23, below.)*
- **The cancel's question is approved as built:** its words, «Так,
  скасувати» and «Ні, залишити», and «Замовлення скасовано, резерв
  звільнено.» (the option recommended).
- **Next: the order's card, P0-2** (the option recommended).

## «Замовлення»: newest first, and the order's card — built 2026-10-23

The owner's answer after #127 (newest first) and «Замовлення»'s task list,
P0-2. How it is carried out, not decided by the owner:
- **Newest first** in «Потрібно відправити» and «В дорозі», as in
  «Завершені» and a search: the server reads every list so.
- **The card's top:** «← До замовлень»; the goods as its title, «Лоран
  шоколад · M», the first named and «+ ще N»; how it goes and since when,
  «Нова пошта · ТТН ще немає · з 21.10», in one line — abroad, its note in
  full, as only the card says it; the status's pill and
  beside it the number small, «№ 3f2a9c1b» (В1) — the task list put the
  number at the context's end, where at 360 px it took a second line.
- **Its lines with their sums:** «Лоран шоколад · M × 2» and on the right
  its sum, the price less the discount for every unit; «600,00 грн за 1
  шт. · знижка 20,00 грн» under it for more than one, or a discount;
  «Разом» large. To send, one line: «Товар у резерві — на касі його не
  продадуть.» The money's words only on «Клієнт забрав»'s step. A
  discount's words as before, for every unit.
- **The next step one button in the panel under the thumb,** what it is
  — as its title, «+ ще N» too — and how it goes over it, «Лоран шоколад ·
  M · Нова пошта»: «Відправлено», then «Прибув на пошту». No panel while
  where it goes is changed or it comes back: one form at a time. To send, «Номер ТТН (можна дописати пізніше)»
  under the sum, never under the panel — abroad, where and how it went.
  No panel on a closed order, nor for whoever may not step it. What is
  sent is as before.
- **After a step:** a buzz, and what it did over the pill — «Відправлено ·
  ТТН 0500012345678», «Відправлено. ТТН можна вписати пізніше.», abroad
  «Відправлено.», «Прибув на пошту». Any step refused: a buzz of its own,
  why at the screen's top brought to the finger, the order read again
  (its words are P1-2's).
- **The rare at the foot, quiet:** «Змінити доставку», the history,
  «Скасувати замовлення», «Товар повернувся на склад». «Оновити» is gone:
  the order is read again after every step and as the app comes back.
- **«Клієнт забрав» as before** until P0-3, its money's words over it.

Built on 2026-10-23; see the [report](orders-redesign-2-report.md).

## Owner decision — 2026-10-24 (after #128 was merged)

Asked when #128 was merged, each answer the option recommended:
- **The order's card is approved as built,** the number small beside the
  pill.
- **An order's conflict says the task list's words,** «Не записано: дані
  замовлення змінилися, поки ви працювали. Перевірте замовлення й
  спробуйте ще раз.», with the rest of an order's refusals (P1-2) — not
  built yet.
- **A line's discount says it is for every unit:** «… за 1 шт. · знижка
  20,00 грн за 1 шт.». *(Built with P0-3, below.)*
- **Next: «Клієнт забрав», P0-3.**

## «Клієнт забрав» by its ways, and a discount for every unit — built 2026-10-24

«Замовлення»'s task list, P0-3, and the owner's answers after #128. How it
is carried out, not decided by the owner:
- **The five ways are the step,** in the panel under the thumb, nothing
  chosen first (В2 (а)): «Зараз, у магазині» — «Готівка», «Картка»,
  «Переказ»; «Наперед чи перевізнику» — «Переказ наперед», «Накладений
  платіж». Over them what it is and how it went, and «Разом» large — in
  parts «Зараз … · винен …», as the till's panel says it. What is sent is
  as before, `{command_id, payment_method}`, in parts with its `credit`.
- **Over the panel one line,** «Продаж записуємо, коли покупець забрав
  товар.», the rest said by the rows' captions; «Оплата частинами» as
  before, for whoever pays in parts (`sale:credit`): its terms checked
  before anything is sent, why brought to the finger over the panel.
- **Recorded, the sale said as the till says one:** «Продаж записано», the
  way with what to do — «Картка · Проведіть на терміналі», «Переказ ·
  Перевірте, що переказ надійшов» — the sum taken large, the server's (in
  parts the part paid now), «Покупець винен … Наступні внески — у
  «Боргах».» from its answer; a buzz; «До замовлень», and the receipt's two
  quiet ways on: «Змінити спосіб оплати» for whoever opens «Каса» and is
  given the way, «Помилилися з товаром чи ціною? Оформити повернення» for
  whoever takes returns. «Разом» not over it: the sum taken alone. Seen
  again later: «Продаж записано · Картка» in a line — the way only to
  whoever the server gives it (G32) — and the same two.
- **A «Клієнт забрав» whose answer was lost, confirmed later,** says
  «Продаж записано один раз» and the way alone, never «Проведіть»; by card,
  to charge it only if nobody did meanwhile — never twice (ADR-0013 §5.6,
  owner decision 2026-10-07), as the till and a debt's payment say it.
- **A tap meant for the step just taken is let go** when it lands on the
  next step's buttons drawn in its place, within 0.7 s of its answer:
  never a sale by a double tap on «Прибув на пошту», nor an arrival by one
  on «Відправлено» (review, 2026-10-24).
- **The ways' groups are named by their captions** for whoever listens,
  each way by its own word — not «Клієнт забрав: готівкою — зараз, на
  касі», whose name would not hold the word seen.
- **«Повернення» opens on the order's sale** while it is among the store's
  newest sales, as from the receipt; past them, «Повернення»'s list, where
  it is found by its goods.
- **A line's discount for every unit:** «600,00 грн за 1 шт. · знижка
  20,00 грн за 1 шт.».

Built on 2026-10-24; see the [report](orders-redesign-3-report.md).


## Owner decision — 2026-10-24 (after #129 was merged)

Asked when #129 was merged, each answer the option recommended:
- **«Клієнт забрав» is approved as built:** the five ways' panel, and the
  sale's result — by card, and in parts.
- **After «Прибув на пошту» its line stays,** though the pill under it says
  the same words: every step is confirmed alike, a line and a buzz on its
  first showing.
- **Next: «Нове замовлення» as a sale, P0-5.**

## «Нове замовлення» as a sale — built 2026-10-24

«Замовлення»'s task list, P0-5, and the owner's answers after #129 (and В3
(а) of 2026-10-23). How it is carried out, not decided by the owner:
- **The till's search:** «Знайти модель» with the cursor in it; every
  warehouse the store sells from at once, a chip per size and warehouse —
  «M · Свій 1» when there are two or more — one warehouse named, «Склад:
  Свій», never chosen. Only what the ledger holds is reserved: no coat from
  the catalogue.
- **A tap on a size puts a line in the order** from that chip's warehouse,
  never another, at the store's price for it, the field filled and
  editable (В3 (а)), with the till's words under it: «Ціна продажу …
  Домовилися про іншу — змініть.», «Ціни продажу ще немає — …», 0,00 asked
  about, never refused. A model with no price: its field takes the cursor.
  «−»/«+» from 1 to what is free, at most 1000; its chip tapped again is one
  more; a chip all held or at nothing takes none, «Ще N шт. у резерві
  замовлення» under its tag; «Прибрати Лоран шоколад · M», its size named.
- **Where it goes:** «По Україні / За кордон» a switch, within Ukraine
  first; its carrier one of three chips in one row, none chosen; abroad
  none, and a carrier chosen before is forgotten. One line under them:
  «ТТН впишете, коли відправите.», abroad «Куди і як відправили — впишете,
  коли відправите.».
- **Under the thumb, once a line is in it** (as the till's, direction §5):
  what is ordered — «Лоран шоколад · M», «… × 2» for more than one of one
  line, or «У замовленні: 3 шт.» — «Разом» large, a dash while a line has
  no price; «Замовити та зарезервувати», held while a line has no price,
  and «Оберіть перевізника» while within Ukraine none is chosen, as
  «Каса»'s «Оберіть новий спосіб». What is sent is as before.
- **Refused for want of stock:** the line the server names marked with
  «Доступно лише 1 шт.» (and «— решта в резерві інших замовлень» when other
  orders hold some), brought to the finger, its «+» held to what is free,
  the goods read again, everything else as typed; none free, «Доступних уже
  немає — усі в резерві інших замовлень. Приберіть рядок.» or «Доступних уже
  немає. Приберіть рядок.». The mark stays until that line's count changes
  or it is taken out. Said on its line only, never over the page, and
  forgotten with the screen: never over the list, nor on the next new
  order. Any other refusal is said over the page, brought to the finger,
  with its buzz, the lines and the carrier kept.
- **Reserved:** a buzz, and the new order's card, from its top, says
  «Зарезервовано: 1 шт. Чекає відправлення.» — also when confirmed later,
  by «Повторити ту саму команду» or «Оновити результат», while it waits to
  be sent; one moved on meanwhile says nothing of it. A tap meant for
  «Замовити та зарезервувати», landing on the card's «Відправлено» within
  0.7 s, is let go.
- **«+ Нове замовлення» stays in «Ще»** beside the list's «+» until the
  bottom menu (P2-5); the shipping form keeps its lists until P1-3.

Built on 2026-10-24; see the [report](orders-redesign-4-report.md).

## Owner decision — 2026-10-24 (after #130 was merged)

Asked when #130 was merged, each answer the option recommended:
- **«Нове замовлення» as a sale is approved as built,** and the card after
  it.
- **Its two wordings stay:** «Лоран шоколад · M × 2» in the panel for one
  line of more than one unit, as the till's; and, none free, «Доступних уже
  немає — усі в резерві інших замовлень. Приберіть рядок.» (or without its
  reserve).
- **Next: an order's refusals in its own words, P1-2,** the conflict's as
  approved after #128.

## «Початкові залишки»'s refusals in its own words — built 2026-10-24

Asked on 2026-10-24, after a refusal of a list was seen saying «Перевірте
дані та поточний статус замовлення.» — the app's shared words, which speak
of an order. How it is carried out, not decided by the owner (the words
wait for the owner's approval):
- **A refusal the list's screens do not name says what was not done and
  what to check,** by the command:
  - a new list, by what was sent: «Список не збережено. Перевірте рядки
    та спробуйте ще раз.», or «… Перевірте файл …»; a conflict «Список не
    збережено. Поки ви працювали, дані змінилися — спробуйте ще раз.», the
    warehouse read again;
  - a new list sent again while the send before it never answered — it may
    have made the list: «Сервер не прийняв цей запит, а чи збережено список
    попередньою спробою — ще невідомо. Перевірте рядки й натисніть ще раз —
    двічі список не збережеться.» (a file «… Перевірте файл і …»);
  - a line's answer: «Відповідь не збережено. Перевірте її та спробуйте ще
    раз.»;
  - typed lines or a file added: «Рядки не додано. Перевірте їх та
    спробуйте ще раз.», «Файл не додано. Перевірте його та спробуйте ще
    раз.»;
  - removed: «Рядки не прибрано. Спробуйте ще раз.» or «Файл не прибрано.
    …» — the list read again by itself;
  - approved or rejected: «Список не затверджено. Спробуйте ще раз.»,
    «Список не відхилено. Перевірте причину та спробуйте ще раз.».
- **A conflict it does not name:** the same first words, then «Поки ви
  працювали, список змінився — перегляньте його й спробуйте ще раз.», and
  the list read again by the screen.
- **A reject that lost a race** — rejected meanwhile by someone else for
  another reason, which the server answers as a conflict of its command —
  says «Цей список уже затвердили або відхилили.», as one already decided.
- **Nothing in a list is stock** (`NOTHING_TO_APPLY`): «Список не
  затверджено: у ньому немає жодного рядка товару. Якщо так і є — відхиліть
  його.».
- **Lines typed by hand past what the server takes at once** — 1 000
  lines, 100 000 characters — are said before sending, the press held: «Рядків:
  1 200, а за раз їх беруть не більше 1 000. …» with what to do with the
  rest — in a new list, add it through «Додати рядки вручну»; added, in
  several goes.
- **The catalogue's search** in a line's answer, a delivery, a count and
  the till's catalogue takes at most 200 characters, as the server reads.
- **Every answer the screens already name keeps its words,** and so does
  every shared one that is not about an order: the server out of reach, a
  session ended, no access, the slow answer.

Built on 2026-10-24; see the [report](openings-refusals-report.md).

## Owner decision — 2026-10-25 (after #131 was merged)

Asked when #131 was merged, each answer the option recommended:
- **«Початкові залишки»'s own refusal words are approved as built** (the
  section above).
- **The other screens that still fall to the shared order words** —
  models, «Брак», a delivery, a stock correction, a stocktake, the
  suggested price, a store's state, suppliers, erasing a customer's data,
  the sign-in — **come next after P1-2, in one change,** each in its own
  words.

## An order's refusals in its own words — built 2026-10-24

«Замовлення»'s task list, P1-2, and the owner's answers after #128 and
#130. How it is carried out, not decided by the owner (the task list's
texts wait for the owner's approval at delivery):
- **A step another phone already made impossible** — sent, arrived or
  cancelled on an order cancelled, taken back or sent meanwhile — says
  what the order is now, by its pill's word: «Не записано: замовлення вже
  «Скасовано» — картку оновлено.»; with its buzz, brought to the finger,
  the card read again, the step pressed gone.
- **A closed order's shipping:** «Не записано: замовлення вже закрито,
  доставку більше не змінюють.».
- **A waybill of no digit or Latin letter,** said as the field's own
  fault, the field kept: «Номер ТТН має містити цифри або латинські
  літери. Перевірте його.» — not the task list's «цифри чи літери»: the
  server counts only Latin letters, so «НП» alone would have been told it
  holds none (review, 2026-10-24).
- **A conflict as the seller works** (a new order too): «Не записано: дані
  замовлення змінилися, поки ви працювали. Перевірте замовлення й
  спробуйте ще раз.», the owner's words; what was typed kept.
- **A saved step resent and refused, recorded nowhere,** says which, and
  why: «Операцію «Відправлено» не записано: замовлення вже «Скасовано».»,
  «Операцію «Зміна доставки» не записано: замовлення вже закрито, доставку
  більше не змінюють.»; a conflict «… дані замовлення змінилися, поки
  сервер не відповідав. Перевірте замовлення й спробуйте ще раз.», as
  every journal says a resend's; a waybill «… номер ТТН має містити цифри
  або латинські літери.», its field gone with the screen.
- **A saved step met by a conflict that proves nothing** stays
  unconfirmed, never «спробуйте ще раз», as a kept return says it:
  «Операцію «Відправлено» ще не підтверджено: сервер відповів, що дані
  змінилися. Перевірте результат ще раз — двічі вона не запишеться.».
- **After any refusal of a step, its row in the list is read again** with
  its card, so back on the list it is where it is now.
- **As before:** the late «Клієнт забрав» after a cancel or a return
  (G24), and a saved step without proof («… ще не підтверджено …»); a step
  recorded whose order could not be read never says «Не записано».

Built on 2026-10-24; see the [report](orders-redesign-5-report.md).

## Owner decision — 2026-10-25 (after #132 was merged)

Asked when #132 was merged, each answer the option recommended:
- **An order's refusals are approved as built,** with the three changed
  from the task list: a waybill «… цифри або латинські літери», a resend's
  «… поки сервер не відповідав …», and a saved step met by a conflict
  without proof «… ще не підтверджено …», never «спробуйте ще раз».
- **Now the other screens' refusals in their own words** (the decision
  after #131); **then «Замовлення»'s P1-1,** a saved step's words.

## The other screens' refusals in their own words — built 2026-10-25

The owner's decisions after #131 and #132. How it is carried out, not
decided by the owner (the words wait for the owner's approval):
- **A refusal a screen does not name says what was not done and what to
  check, and a conflict that the data changed — never the shared words,
  which speak of an order** (`inOwnWords`):
  - models: «Назву не змінено. Перевірте поля та спробуйте ще раз.»,
    «Моделі не об’єднано. Спробуйте ще раз.», «Модель не повернуто. …»,
    «Модель не прибрано. …»; a conflict «… модель щойно змінили —
    перегляньте її й спробуйте ще раз.»; a kept change refused on its check,
    recorded nowhere: «Зміну каталогу не записано. Внесіть її ще раз.», a
    conflict «… Каталог змінився, поки сервер не відповідав: перегляньте
    модель і внесіть зміну ще раз.»;
  - «Брак»: «Не записано. Перевірте дані та спробуйте ще раз.», a conflict
    «Не записано: цю одиницю щойно змінили — список оновлено, подивіться
    ще раз.»;
  - a delivery: «Нічого не прийнято. Перевірте рядки та спробуйте ще раз —
    список збережено.»; a conflict «Нічого не прийнято: поки ви працювали,
    дані змінилися. …»; a kept one recorded nowhere: «Приймання не
    записано. Перевірте список і внесіть його ще раз.», a conflict «… Дані
    змінилися, поки сервер не відповідав: …»;
  - a stock correction and a stocktake's count: «Перевірте кількість та
    спробуйте ще раз.», a conflict «Облік змінився — перерахуйте товар і
    спробуйте ще раз.», each with «Нічого не записано.», or after «…не
    записано.» for a kept one;
  - a stocktake: «Інвентаризацію не почато. Спробуйте ще раз.»,
    «Інвентаризацію не завершено. Спробуйте ще раз.»; a conflict «… дані
    складу змінилися — перегляньте їх і спробуйте ще раз.»;
  - the price: «Ціну не збережено. Перевірте суму та спробуйте ще раз.», a
    conflict «Ціну не збережено: її щойно змінили — перевірте й збережіть
    ще раз.»;
  - a store's state: «Стан магазину не змінено. Перевірте причину та
    спробуйте ще раз.», a conflict «… його змінили — перегляньте його й
    спробуйте ще раз.»;
  - a supplier edited or added: «Постачальника не збережено.» or «… не
    додано. Перевірте назву й телефон та спробуйте ще раз.»; a supplier
    return, made or cancelled: «Не записано. Перевірте повернення та
    спробуйте ще раз.», a conflict «Не записано: дані повернення змінилися
    — перегляньте їх і спробуйте ще раз.»;
  - invoices and borrowed goods, each command alike: «Не записано.
    Перевірте дані та спробуйте ще раз.» (borrowed: «… кількість …»), a
    conflict «Не записано: дані змінилися — перегляньте їх і спробуйте ще
    раз.»;
  - a customer's data erased: «Дані покупця не стерто. Спробуйте ще раз.»,
    a conflict «… борг щойно змінився — перегляньте його й спробуйте ще
    раз.»;
  - the sign-in: «Не вдалося увійти. Відкрийте застосунок знову кнопкою в
    боті вашого магазину.».
- **Where a conflict's words say to look again, the screen reads again
  what it shows:** the models and the card, the prices, the suppliers and
  their returns, the borrowed goods, a stocktake's list and record, the
  debts.
- **«Брак» refused by its own rule** (`DAMAGED_STOCK_CLOSED`: what is in
  «Брак» changes only through returns and its own section, owner decision
  2026-10-01) says «Залишок «Браку» змінюють лише повернення й розділ
  «Брак».», never a conflict to look again at.
- **Any kept command met by a conflict that proves nothing** — a sale, a
  delivery, a correction, a count, as already an order, a return, a payment
  and «Каса» — stays unconfirmed: «… ще не підтверджено: сервер відповів,
  що дані змінилися. Перевірте результат ще раз — двічі … не запишеться.»,
  never «спробуйте ще раз».
- **Every answer a screen already names keeps its words,** and so does
  every shared one that is not about an order.

Built on 2026-10-25; see the [report](screens-refusals-report.md).


## Owner decision — 2026-10-25 (after #134 was merged)

Asked when #134 was merged, the answer the option recommended:
- **The other screens' refusal words are approved as built,** each
  screen's as listed above, «Брак»'s rule and a kept command's conflict
  without proof included.
- **Next, as chosen after #132: «Замовлення»'s P1-1,** a saved step's words.

## A kept order step says which step and which order — built 2026-10-25

«Замовлення»'s task list, P1-1, and the owner's answers В4 (а) (2026-10-23)
and after #134. How it is carried out, not decided by the owner:
- **Its banner names the step,** as an order's refusals name it: «Операцію
  «Відправлено» ще не підтверджено», while checked «Перевіряємо операцію
  «Відправлено»…».
- **And the order:** «Лоран шоколад · M · Нова пошта · ТТН 20451234 —
  сервер не відповів. Двічі вона не запишеться. Поки чекаємо, інші дії
  недоступні.» — the goods as the card's title, how it goes, the waybill
  sent with it or the order's; a shipping change, the delivery it sets,
  whole; a new order, its first goods «+ ще N» and how it goes. Kept beside
  the command on the phone only to be shown: never sent, never trusted —
  anything but a string of at most 1 000 characters is dropped, the command
  kept as ever. An order holds no customer's name or phone, so none is kept. A
  command kept before it: «Операцію «Відправлено» — сервер не відповів. …».
- **Never from paper** (В4 (а)): «Телефон перевірить сам. Нічого не
  повторюйте, поки він не скаже «не записано».», as «Каса»'s; a step not
  recorded is made again here, one recorded the server refuses by its
  status.
- **Its button «Перевірити результат замовлення»;** «Оновити результат» for
  one answered whose order could not be read, which says «Операцію
  «Відправлено» записано» and «… — замовлення ще не вдалося показати.»,
  with no paper line: it is recorded.
- **No banner while a first press is on its way,** as «Каса»'s: nothing is
  unanswered until it comes back so.
- **Confirmed later, a step on an order says «Операцію «Відправлено»
  записано один раз»,** with a buzz — a shipping change and a return too; a
  new order still says what it reserved (P0-5, approved), or «… записано
  один раз» if it moved on meanwhile; a collect its sale «… один раз»
  (P0-3).

Built on 2026-10-25; see the [report](orders-redesign-6-report.md).


## Owner decision — 2026-10-25 (after #136 was merged)

Asked when #136 was merged, each answer the option recommended:
- **A kept order step's words are approved as built,** with those decided
  in building it: one answered whose order could not be read, «Операцію
  «Відправлено» записано» and «… — замовлення ще не вдалося показати.» with
  no paper line; one confirmed later, «Операцію «…» записано один раз», a
  shipping change and a return too.
- **The task list's two phrasings are changed:** a command kept before the
  order was kept beside it says «Операція «Відправлено» — …», its verb's
  subject, not «Операцію …»; and «Двічі вона не запишеться.» after a line of
  goods says «Двічі цю операцію не запишуть.». The order's banner only: was
  not asked of «Каса»'s, which says it the same way — to be asked.
- **Next: «Замовлення»'s P1-3,** shipping as its own step, its history in
  rows, and the same waybill as the other order's row.

## Where an order goes, its own step — built 2026-10-25

«Замовлення»'s task list, P1-3, and the owner's answers after #136. How it
is carried out, not decided by the owner; the screens and words wait for
the owner's approval:
- **Its own step:** «Змінити доставку ›» opens «Доставка» with «←
  Замовлення» — «По Україні» or «За кордон» by a switch, the carrier by a
  chip, «Номер ТТН» or «Куди і як відправили: місто, країна, спосіб» with
  «Без імен і телефонів покупців.», and «Зберегти доставку» under the
  thumb, «Оберіть перевізника» while within Ukraine no carrier is chosen.
  What is sent is unchanged. Saved, back on the card: «Доставку
  збережено», with a buzz — saved as it was too, no version added.
- **A waybill written later:** a parcel sent within Ukraine with no
  waybill offers «ТТН ще немає — вписати ›», opening with the cursor in
  «Номер ТТН»: five taps from «Ще» with the typing. Before it is sent, the
  waybill goes in the field over the panel, and the row says «Змінити
  доставку»; abroad, and an order made before orders said where they go,
  «Змінити доставку» too.
- **The card kept under «Доставка»,** with what was typed there; back, the
  row that opened it in focus; the card's «← До замовлень» is the card's
  own. A card read again and failed keeps what was last read, and the
  screen over it what was typed, with why and «Спробувати ще раз» over
  them.
- **Its history a row a version:** «Вказано при створенні», «Вписано при
  відправленні» or «Змінено», under it «22.10, 14:05 · Оля» by the phone's
  clock, how it went on the right.
- **The same waybill:** «Ця ТТН є також у замовленні — перевірте, чи це
  один пакунок.», «… у замовленнях — …» for several, and each other order
  its row — named as its card's title, «Лоран шоколад · M × 2 + ще 2», «з
  22.10», its pill and «›» — a tap opening it at its top; never its eight
  characters (В1). The server gives its first line, how many lines and since
  when, read only; an answer kept from before says only «Замовлення». An
  order its reader could not open is named nowhere, as the store's list
  leaves it out; before, it was named by its number.
- **Taps carried from a press are let go:** after every step that came
  back, the card is mounted afresh, a save that changed nothing too; and
  «Зберегти доставку» right after «Доставка» opened, «← До замовлень» right
  after «← Замовлення», are let go.

Built on 2026-10-25; see the [report](orders-redesign-7-report.md).

## Owner decision — 2026-10-25 (after #137 was merged)

Asked when #137 was merged, each answer the option recommended:
- **Where an order goes, its own step, is approved as built:** «Доставка»,
  its history's rows and the same waybill's other order its row, with what
  was decided in building it — «ТТН ще немає — вписати» only once the parcel
  is sent, «… у замовленнях — …» for several, and an order its reader could
  not open named nowhere.
- **«Каса»'s banners say it as the order's do:** «Двічі цю операцію не
  запишуть.», not «Двічі вона не запишеться.», carried out with the next
  task.
- **Next: «Замовлення»'s P2-4,** «Товар повернувся на склад» as its own
  step.

## The goods come back, their own step — built 2026-10-25

«Замовлення»'s task list, P2-4, and the owner's answers after #137. How it
is carried out, not decided by the owner; the screen and its words wait for
the owner's approval:
- **Its own step:** «Товар повернувся на склад ›», the last row of a sent
  order's card for whoever takes returns and receives goods, opens a screen
  of that name with «← Замовлення»: which warehouse each coat goes back to —
  «Повернеться на склад «Свій»: Лоран шоколад · M × 2», a line a warehouse,
  as the server puts each back where it left from — then, under «Фізичне
  повернення всього замовлення», «Причина повернення» with «Без імен і
  телефонів покупців.», the tick «Усі товари фізично отримані на складах
  відправлення», and «Прийняти повернення» under the thumb, held until both.
  What is sent is unchanged.
- **Taken, back on the card:** «Повернено на склад «Свій»: 1 шт.», a
  sentence a warehouse, with a buzz.
- **Warehouses named only where the server takes them back:** one not read
  — whoever may not see the store's warehouses, or a read refused since —
  or paused, or not receiving, and the screen says as before «Товар
  повернеться на ті склади, звідки його відправили.»; taken unnamed,
  «Повернено на склад відправлення: N шт.» («… на склади відправлення …»
  for several).
- **What comes back where is read first:** the heading in focus, the
  keyboard only once the reason is tapped — seven taps from «Ще» with the
  typing.
- **The tick only meant:** a tap carried from the row onto it within 0.7 s
  is let go — it says the goods are in hand.
- **Back, the row that opened it in focus,** as from «Доставка».
- **A kept return confirmed later** says «Операцію «Прийняти повернення»
  записано один раз» (P1-1), never which warehouse.
- **«Каса»'s banners** say «Двічі цю операцію не запишуть.» (the owner's
  answer after #137); its refusals' «… двічі вона не запишеться.» were not
  asked of, and stay — to be asked.

Built on 2026-10-25; see the [report](orders-redesign-8-report.md).

## Owner decision — 2026-10-25 (after #138 was merged)

Asked when #138 was merged:
- **The goods coming back, their own step, are approved as built,** with
  what was decided in building it — a line a warehouse and a sentence a
  warehouse taken; a warehouse named only where the server takes the goods
  back, else the old sentence and «Повернено на склад відправлення: N
  шт.»; the heading in focus; a carried tap on the tick let go; a kept
  return confirmed later naming no warehouse. (The option recommended.)
- **«Каса»'s refusals say it as its banners do:** «… — двічі цю операцію не
  запишуть.», not «… двічі вона не запишеться.» (the option recommended).
- **Next: «Замовлення»'s P2-1, P2-2 and P2-3 together,** in one change —
  the section's words and rights, its places while read, and its pills by
  what they mean — closing its task list but for P2-5, which waits on the
  bottom menu (the owner's choice over one task at a time).

## «Замовлення»'s words, rights, places while read and pills — built 2026-10-25

«Замовлення»'s task list, P2-1, P2-2 and P2-3, and the owner's answers after
#138. How it is carried out, not decided by the owner; the screens wait for
the owner's approval:
- **«Замовлення» only for whoever may read them** (`sale:view`): not in
  «Ще» otherwise, and «Немає права переглядати замовлення.» is said nowhere.
  Opened on it with no till to open first, the app opens on the first
  section shown instead — unless a kept operation turned to its own tab; a
  kept order step of whoever may not read orders turns to none, its banner
  standing over any.
- **To be asked:** a role that sells but may not read orders — no default
  role is so — still has «+ Нове замовлення», as before; its order,
  recorded, cannot be shown, since the phone reads it back, and its banner
  waits on «Оновити результат». Whether to offer it only with the right to
  read orders is the owner's.
- **One word for each thing:** what was left of the old words — the loading
  and searching lines — gives way to places while read; the rest was carried
  out with the tasks before.
- **Places while read:** the list, a group's heading and three rows; a
  search, three rows; the card, in its own frame, its title, its line of
  context, its pill and two lines. A screen reader hears «Завантажуємо
  замовлення…» and «Шукаємо…», as before.
- **Pills by what they mean** (В5 (а)): «До відправлення» a warning's,
  «Відправлено» and «Прибув на пошту» «в дорозі»'s blue, «Клієнт забрав» the
  accent, «Скасовано» and «Повернено на склад» nothing more to do.
- **What is said under a step, 14 px,** as «Каса»'s; «Товар у резерві — на
  касі його не продадуть.» close to what it explains, so an order to send
  stays whole on a phone of 360 × 640, its waybill's field over the panel.
- **What could not be read, on a warning's plate,** as «Каса»'s, never a
  debt's red: the list, the card and a new order's goods, each with
  «Спробувати ще раз»; a step refused stays red.
- **«Каса»'s refusals:** «… — двічі цю операцію не запишуть.», as its
  banners (the owner's answer after #138); the till's, deliveries',
  corrections', returns', stocktakes', debts' and orders' keep their own.

Built on 2026-10-25; see the [report](orders-redesign-9-report.md).

## Owner decision — 2026-10-26 (after #139 was merged)

Asked when #139 was merged, each answer the option recommended:
- **«Замовлення»'s words, rights, places while read and pills are approved
  as built,** with what was decided in building them — the first section
  shown to whoever may not read orders, a kept operation keeping its own
  tab, «Товар у резерві …» close to what it explains, a new order's goods
  not read on the same plate.
- **«+ Нове замовлення» only for whoever may also read orders**
  (`sale:create` and `sale:view`): whoever makes one sees it. No default
  role is touched; a role made to sell without reading orders no longer
  makes an order it cannot then be shown.
- **Next: the task list for the bottom menu** of five tabs by role
  (`redesign/design-direction.md` §3), put off on 2026-10-14; with it, what
  every counter section left for it — the till's, «Повернення»'s P2-6,
  «Борги»' P2-5, «Каса»'s P2-5, «Замовлення»'s P2-5.

## Owner decision — 2026-10-26 (the bottom menu's task list)

The task list for the bottom menu is written
(`redesign/2026-10-26-redesign-tz-navigation.md`, the owner's version
beside it). Asked its seven questions the same day, the owner answered each
with option (а), the one recommended:
- **В1. «Товар» and «Огляд» minimal now,** from what already exists; their
  full task lists apart, after the menu.
- **В2. «Каса» for the owner and managers in «Ще › Гроші»,** as the
  direction draws it; a seller's a tab. Theirs: «Огляд · Продаж · Товар ·
  Клієнти · Ще».
- **В3. The owner and managers open on «Огляд»** once it exists.
- **В4. «Огляд» shows the store open,** as every tab; the network in
  «Звіт про продажі», as now.
- **В5. «Тиждень» and «Місяць» from Monday and from the 1st** to today.
- **В6. The menu shown under the pay panel too, and the basket kept** until
  it is sold or the store changed: a tap gone astray loses nothing.
- **В7. Telegram's «Назад» does on a screen within a section what its «←»
  does.**
- **First: P0-1, «Продати | Повернути» on the till,** a pull request a
  step, each for the owner's approval.

## «Продати | Повернути» on the till — built 2026-10-26

The bottom menu's task list, P0-1, and the owner's answers of 2026-10-26.
How it is carried out, not decided by the owner; the switch and its words
wait for the owner's approval:
- **«Повернення» leaves the row:** the row is «Продаж · Борги · Каса · Ще».
  «Продаж» stands for the till and the returns, marked on either; for
  whoever only takes returns it opens them, with no switch, an order left
  open kept as before.
- **«Продати | Повернути» under the heading** of the till and of the
  returns' list, for whoever does both: two segments on a grey field, the
  way open marked, for a reader «Продаж або повернення»; a tap each way.
  Held while the row is held. None on a receipt, a sale's return or its
  result. The headings «Продаж» and «Повернення» name the way open, as
  before.
- **The way just chosen takes the focus,** never lost to the page.
- **The receipt's «Оформити повернення», a kept return and the result's
  «Новий продаж»** open as before; «Продаж» marked on each.
- **On a phone of 360 × 640** the switch, the search and the first tag's
  name stay in view; in a store of two warehouses, its sizes begin at the
  fold — to be seen on a phone (the task list's С1).
- **«+ Нове замовлення» only with the right to read orders** (the owner's
  decision after #139), built with it.

Built on 2026-10-26; see the [report](navigation-redesign-1-report.md).

## Owner decision — 2026-10-26 (after #140 was merged)

Asked when #140 was merged, each answer the option recommended:
- **«Продати | Повернути» is approved as built,** with what was decided in
  building it — the heading naming the way open, the till's own spacing (in
  a store of two warehouses, the first tag's sizes at the fold on a phone of
  360 × 640, to be seen on a phone), «Продаж» opening the returns for
  whoever only takes them.
- **Next: the bottom menu's P0-2, «Клієнти»** with «Борги | Замовлення».

## «Клієнти» with «Борги | Замовлення» — built 2026-10-26

The bottom menu's task list, P0-2, and the owner's answers after #140.
How it is carried out, not decided by the owner; the section, its switch
and its words wait for the owner's approval:
- **«Борги» leaves the row for «Клієнти»:** the row is «Продаж · Клієнти ·
  Каса · Ще», and a seller's «Ще» holds «Каталог · Приймання · Залишки ·
  Брак». «Клієнти» stands for the debts, the orders and a new order, marked
  on each; shown with the right to debts or to read orders, never without
  both.
- **«Клієнти» opens the debts,** or the one of the two this person has;
  whoever does none of the counter's work but reads orders opens on the
  orders, as before.
- **«Борги | Замовлення» under each list's heading** for whoever has both:
  two segments, for a reader «Борги або замовлення», the way open marked
  and focused, held as the row is. None on a debt, a customer's card, an
  order's card, a new order or its delivery. The headings «Борги» and
  «Замовлення» name the way open, as P0-1's do.
- **«Клієнти» pressed again** brings its way's first screen: the debts'
  list from a debt — a sum typed in a payment is lost, as on leaving for
  another section — and the orders' list from an order's card or a new
  order.
- **«Замовлення» and «+ Нове замовлення» leave «Ще»:** a new order is the
  «+» in «Замовлення»'s heading, as before; from the till, three taps where
  it was two (the task list's count).
- **A kept payment or write-off** opens on «Борги», «Клієнти» and the
  segment «Борги» marked; **a kept order step** on «Замовлення» and then
  its card, «Клієнти» marked.
- **A store that does not trade:** both ways read only, no «+».
- **The receipt's «Наступні внески — у розділі «Борги».»** is kept as it
  was, though the row has no «Борги» now: its words are the owner's to
  change.

Built on 2026-10-26; see the [report](navigation-redesign-2-report.md).

## Owner decision — 2026-10-26 (after #141 was merged)

Asked when #141 was merged, each answer the option recommended:
- **«Клієнти» with «Борги | Замовлення» is approved as built,** with what
  was decided in building it — the headings naming the way open («Борги»
  twice on the debts, the heading and the segment), the section opening on
  the debts, «Клієнти» pressed again on a debt bringing the list (a sum
  typed in a payment lost, as on leaving for another section), a new order
  three taps where it was two.
- **The receipt of a sale paid in parts says «Наступні внески — у розділі
  «Клієнти».»**: the row's button, which opens on the debts for whoever
  sells in parts.
- **Next: the bottom menu's P0-3, «Товар»** — the minimal one (В1).
- **«Товар»'s words as the task list has them:** the row's button and the
  heading «Товар» where «Залишки» was; the tiles «Прийшов товар», leading to
  «Приймання товару», and «Брак», its line «2 очікують перевірки» or
  «нічого не чекає»; «← Товар» over those screens. Approved again by the
  screens once built.

## «Товар», the minimal one — built 2026-10-26

The bottom menu's task list, P0-3, and the owner's answers after #141.
How it is carried out, not decided by the owner; the section, its tiles and
their icons wait for the owner's approval by the screens:
- **«Приймання», «Залишки» and «Брак» leave «Ще» for «Товар»:** the row is
  «Продаж · Товар · Клієнти · Каса · Ще», and a seller's «Ще» holds
  «Каталог». «Товар» stands for the stock, receiving and «Брак», marked on
  each; shown with any of their rights.
- **«Товар» is the stock's screen,** its heading «Товар» where «Залишки»
  was, «Оновити залишки» beside it as before, and under the heading two
  tiles, each by its own right — «Прийшов товар», leading to «Приймання
  товару», and «Брак» — one alone the whole width; the stock's list below,
  unchanged. Whoever may not read the stock has the heading and the tiles
  alone, and is told nothing of the rule.
- **«Брак»'s tile says how many units wait to be inspected,** from the same
  read as its screen: «2 очікують перевірки», one «1 очікує перевірки»,
  none «нічого не чекає»; grey while read, and unread, the tile with no line
  and nothing said.
- **«← Товар» over «Приймання товару» and «Брак»** leads back to the tiles,
  read as «Назад до товару», as «← Каса» is read «Назад до каси». It, the
  tiles and the row are held together; leaving receiving drops the lines
  typed, as leaving for any section did. A tile or «← Товар» closes «Ще».
- **A kept delivery** opens on «Приймання товару», a kept correction or
  count on «Товар»; «Товар» marked on each.
- **A store that does not trade:** no «Прийшов товар»; «Брак» read only.
- **Whoever neither sells nor reads orders** opens on the first section
  shown, which is now «Товар».
- **The tiles' two icons** — an arrow into a tray, a tag with a cross — are
  drawn here; the app has no icon set before the bottom menu (P0-6).
- **The receipt's «Наступні внески — у розділі «Клієнти».»,** the owner's
  answer, built with it. The till's «Решту — у «Боргах» цього магазину.» and
  an order's «Клієнт забрав» «Наступні внески — у «Боргах».» are kept: the
  first names the store's debts, the second is said inside «Клієнти», where
  «Борги» is the switch's.
- **Two texts still name sections that left «Ще»,** kept as they were, their
  words the owner's: the price hint «Ціну для всіх задає менеджер у
  «Залишках».» (the till, a new order) and «Початкові залишки»'s «…а
  відсутній товар прийміть через «Приймання».».

Built on 2026-10-26; see the [report](navigation-redesign-3-report.md).

## Owner decision — 2026-10-26 (after #142 was merged)

Asked when #142 was merged, each answer the option recommended:
- **«Товар» is approved as built,** with what was decided in building it —
  the tiles' two icons until the bottom menu's own set, «1 очікує
  перевірки» for one, «← Товар» read «Назад до товару», whoever neither
  sells nor reads orders opening on «Товар».
- **Two texts name the places as they are now:** the price hint «Ціну для
  всіх задає менеджер у «Товарі».», and «Початкові залишки»'s «…а
  відсутній товар прийміть через «Товар» › «Прийшов товар».». The till's
  «Решту — у «Боргах» цього магазину.» and an order's «Наступні внески — у
  «Боргах».» stay as they are.
- **Next: the bottom menu's P0-4, «Ще» by groups,** as the task list has it:
  its items named as their screens' headings («Каталог» → «Перевірка
  каталогу», «Звіт» → «Звіт про продажі»), the groups «Гроші»,
  «Постачальники», «Товар і каталог», «Мережа», the heading «Ще», «← Ще»
  over a section opened from it, and «Змінити магазин» from the header to
  the bottom of «Ще» — two taps for whoever has two or more stores; the
  header «{Магазин} · {Ім’я}» alone. Approved again by the screens once
  built.

## «Ще» by groups — built 2026-10-26

The bottom menu's task list, P0-4, and the owner's answers after #142. How
it is carried out, not decided by the owner; the screen and its words wait
for the owner's approval by the screens:
- **«Ще» is a screen of its own,** headed «Ще», no longer a list opened
  under the row: its sections by groups — «Гроші» («Звіт про продажі»),
  «Постачальники» («Накладні», «Постачальникам»), «Товар і каталог»
  («Перевірка каталогу», «Моделі», «Початкові залишки»), «Мережа»
  («Магазини», «Резервні копії» with its «⚠») — a group with nothing in it
  not shown; a row each, in the lists' rhythm (56 px) with its chevron,
  held by its own section's rule as before. A row chosen, the focus stays
  on «Ще», as it did when «Ще» was a list.
- **«Змінити магазин» is the last line of «Ще,»** for whoever has two
  stores or more, held as the row is; the header is «{Магазин} · {Ім’я}»
  alone. Only over a store that cannot be worked in, which has no «Ще», is
  it still in the header.
- **«Ще» is in the row only when it holds something** — a section, or the
  stores to change to — marked on its screen and on every section opened
  from it.
- **«Ще» and «← Ще» are held only while a first send is in flight,** free
  otherwise — while something is kept or a reason owed too. The task list
  says «Ще» is never held; that was written for a list opened over the
  screen, and «Ще» now leaves it: a sale's answer, said on the till alone,
  would be lost to whoever pressed «Ще» while it was sent, and the sale
  perhaps typed again. To approve.
- **«← Ще» over the heading of every section opened from «Ще»** leads back
  to its groups, read «Назад до «Ще»», as «← Каса» is «Назад до каси»; «Ще»
  pressed again does the same; the focus stays on «Ще».
- **«Каса» stays a tab for everyone** until «Огляд» takes its place (P1-1):
  the tab rule's «first four» are «Продаж · Товар · Клієнти · Каса» until
  then, so «Гроші» holds «Звіт про продажі» alone.
- **The two texts the owner changed:** the price hint «Ціну для всіх задає
  менеджер у «Товарі».» and «Початкові залишки»'s «…а відсутній товар
  прийміть через «Товар» › «Прийшов товар».».

Built on 2026-10-26; see the [report](navigation-redesign-4-report.md).

## Owner decision — 2026-10-26 (after #143 was merged)

Asked when #143 was merged, each answer the option recommended:
- **«Ще» by groups is approved as built,** with what was decided in building
  it — «Ще» and «← Ще» held only while a first send is in flight, the
  task list's «never held» written for a list opened over the screen; the
  focus kept on «Ще»; «← Ще» read «Назад до «Ще»»; «Змінити магазин» kept
  in the header of a store that cannot be worked in; rows of 56 px; «Каса»
  into «Гроші» only with «Огляд».
- **Next: the bottom menu's P0-5, the basket kept** while the till is left
  and come back to, as the task list has it (В6 (а)); no new words.

## The till's basket kept — built 2026-10-27

The bottom menu's task list, P0-5, and the owner's В6 (а) (2026-10-26).
How it is carried out, not decided by the owner:
- **The basket stays while the till is left** — by a tab of the row,
  «Повернути» or «Ще» — and comes back as it was: its lines, quantities and
  prices, paying in parts, the answers about the shelf, the way pressed and
  its `command_id`, together; the warehouse chosen with it.
- **It is gone as before:** once a sale is recorded, and after «Новий
  продаж»; with another store; on reload; and once a kept sale settles —
  kept under the store and the count of settled kept sales, so the till
  then opens empty and never takes the command of a sale already answered.
  A sale answered forgets it at once, whether or not the till is open.
- **An emptied basket keeps nothing:** paying in parts — a customer's name,
  number and the part paid — was the last customer's.
- **«Новий продаж» from a return's result and from «Борги»** opens the till
  on the basket kept, its cursor in the search: the basket is kept until it
  is sold or the store changed (В6 (а)). Asked of the owner.
- **The paper mode is one series across the screens:** every move of its
  switch is counted. A basket built from paper is gone once the switch
  moved elsewhere — unticked, or unticked and ticked again — never sent
  unmarked nor in another series; a basket built unmarked keeps its lines
  when the paper was ticked elsewhere, not its answers about the shelf nor
  its question, and is gone once it was unticked — as the till's own switch
  does. The paper's day and time are asked again: a wrong one is permanent.
- **Nothing new on the phone's disk,** and no new words.

Built on 2026-10-27; see the [report](navigation-redesign-5-report.md).

## Owner decision — 2026-10-27 (the design «Усе на бірці» becomes the direction)

Decided in chat on 2026-10-27: the concept and design «Усе на бірці»,
shown on 2026-10-22, become Birka's main design.
`redesign/design-direction.md` now describes it; the direction of
2026-10-11 is kept as `redesign/design-direction-2026-10-11.md`; the
concept's spec, tokens and icons are in `redesign/concept-all-on-the-tag/`.
- **Adopted:** the idea and its stub «Корінець»; seven principles; the
  tabs by role — «Сьогодні · Продаж · Замовлення · Гроші · Ще» for the
  owner and managers, «Продаж · Замовлення · Каса · Ще» for sellers (the
  concept's Q-12) — with «Внесок» on the till; the lime thread on
  greyboard and ink (Q-2, as shown; the olive not taken); Fira Sans Extra
  Condensed for titles, money and sizes, the system face for text; crisp
  radii and the tag silhouette; the components, the Telegram rules, the
  voice, and screens S01–S29 as look and behaviour.
- **Not decided by it:** the concept's proposals that change rules, data
  or behaviour — Q-1 (the owner opens on «Сьогодні» and picks a store at
  her first store action), Q-3 to Q-11, and Q-13 (an English interface).
  Until the owner answers, each is built as its «if no»
  (`redesign/design-direction.md` §9): the door question as now, no
  customer link on orders, no capture from chats, no channel, no wants,
  no payment plan, no count of days at the post office, «,00» everywhere,
  no message from the bot, only «Окремо від «Разом»» on «Гроші», Ukrainian
  only.
- **Work under way:** what was built under the 2026-10-11 direction stays
  until a new task list redoes it. Of the bottom menu's task list
  (`redesign/2026-10-26-redesign-tz-navigation.md`), P0-5 (the basket
  kept, built 2026-10-27) stays, and P1-2, P2-2, P2-3 fit the new
  design; P0-6, P1-1 and P2-1 are not built as written — a task list
  against the new direction takes their place.

## Chosen in chat — 2026-10-28 (the first work on «Усе на бірці»: two quick wins)

Chosen in chat on 2026-10-28, once the two task lists for «Усе на бірці»
were written (`redesign/2026-10-27-redesign-tz-all-on-the-tag.md`, the
frame; `redesign/2026-10-27-redesign-tz-all-on-the-tag-sections.md`, the
sections): the quick wins first — the frame's P2-1 and, of the sections'
P1-2, only the guard against a carried tap on «Так, закрити»; every
question to the owner built as its (а) until answered.
- **No rule said anywhere (frame P2-1).** A kept sale, delivery, stock
  correction or stocktake count turns to its own screen only for whoever
  may open it — `sale:create`, `inventory:receive`, `inventory:view` — as
  kept returns, payments and orders already did; anyone else sees its
  banner over the section open, and the phone checks it by itself. A
  section opened without its right shows nothing: the twelve sentences
  that named a rule («Немає права оформлювати продаж.», «Звіт бачать
  власник і менеджери.» and the rest) are gone. The till's shortfall,
  where neither correction is allowed, says the next step alone:
  «Покличте менеджера або зменшіть кількість.»
- **Kept as they are:** «Немає доступу до перевірки каталогу. Зверніться
  до менеджера.» (the catalogue's kept operation is checked on its own
  screen, as the task list says); the words for the server's refusal of
  a command, «Немає доступу до цієї операції або складу. Зверніться до
  менеджера.», which say what the server answered; and «Цей розділ бачить
  лише власник.» in the hint of «Резервні копії», said to the owner on the
  owner's own screen, not a refusal.
- **«Так, закрити» lets a double tap go (the quick win of sections P1-2).**
  It is drawn where «Закрити касу» stood: a tap on it sooner than 0.7 s
  after «Закрити касу» is taken as that tap's second half and does
  nothing, as on the orders' screens; a key held down from «Закрити
  касу» does not close it by its repeats; pressed once the sum is read, it
  closes. The close is still four taps and the sum. The rest of P1-2 —
  the keypad, the dock, the sheet with MainButton — waits for the frame's
  components.

## Chosen in chat — 2026-10-28 (the design system of «Усе на бірці»)

Chosen in chat on 2026-10-28, after #146: the frame's P0-1 next, and Fira
Sans Extra Condensed 800 fetched from its official source and subset for
the app (`all-on-the-tag-design-system-report.md`). No rule, figure or word
changes, except the space before «грн» and between thousands, now a
no-break space.
- **The owner's "accent", in the new palette.** «Клієнт забрав» (В5 (а))
  and «Сплачено» are the accent's green, which is the design's paid. The
  «Збіглося» pill (В4 (а)) is the design's match: the thread on ink in
  light, ink on the thread in dark (spec §6.18). The drawer's «Збіглося до
  копійки» in text is the same green.
- **Kept as the owner chose it:** «До відправлення» is a warning (В5 (а)),
  although the design approved on 2026-10-27 draws it `online`. To ask.
- **Decided here:**
  - a sticker with no meaning of its own is ink on the fold;
  - a chosen switch segment is the card with its edge, in ink, and the
    others are pencil (spec §6.7);
  - the narrow face draws headings and sums only, until each screen's own
    task;
  - an inline skeleton line breathes, while a block's place sweeps;
  - a changed sum shows the fold for 400 ms, never on first show and never
    with reduced motion.

## Chosen in chat — 2026-10-28 (the stub of «Усе на бірці»)

Chosen in chat on 2026-10-28, after #147: the frame's P0-2 next
(`all-on-the-tag-stub-report.md`). No rule, figure or sum changes. The words
are the task list's: «Готівка · Разом 1 850,00 грн» becomes the sticker
«Готівка», «У касу» and the sum; «Перевіряємо продаж…» becomes «Продаж ще
не підтверджено» with its ring; new are «Ще не підтверджено», «Ще
надсилаємо…», «Перевіряємо кожні 20 с · остання перевірка 11:42:20»,
«Чекаємо на сервер» and «У касу». Every other word stays as it was.
- **Decided here:**
  - an attempt's first send is its dock's to say — the pressed way's
    ring, then «Ще надсилаємо…» — and it is shown as kept only once its
    answer is lost, or while it is checked again;
  - the check line shows only while the phone does check: the server not
    answering, or a kept attempt being resent; its time is that of the
    last question, kept in memory only;
  - a kept operation confirmed later keeps its way's sticker but not what
    to do, as the owner chose on 2026-10-07 and 2026-10-08;
  - the knotted stub is a debt paid off in full;
  - the till's form while a sale is kept stays drawn and disabled, as
    before;
  - a sale typed from paper says only what the paper says of its money,
    and nothing of cash, as before;
  - the toast waits for its first user (P0-6 or P1-4).

## Chosen in chat — 2026-10-29 (the till's «Внесок» of «Усе на бірці»)

Chosen in chat on 2026-10-29, after #148: the frame's P0-3 next
(`all-on-the-tag-deposit-report.md`). No rule, figure or sum changes: the
server still refuses more than is owed (G9), a payment is still taken in
the store that sold, by `sale:credit`. The words are the task list's:
new are «Внесок» (the segment), «Внесок приймає «X»», «Історія · N ›»,
«Увесь залишок {сума}», «Сума, грн», and the reader names «Продаж,
повернення або внесок», «Продаж або внесок», «Повернення або внесок».
Every other word stays as it was.
- **Decided here:**
  - «Усього винні магазину «X» {сума}» for the task list's «Усього винні
    «Центру» …»: a store's name cannot be put in the dative; to ask the
    owner;
  - the total is said only while the customer still owes the store, read
    again by their phone once recorded; another store's debt names none;
  - «Внесок» only in a store that trades; whoever only takes payments has
    «Продаж» open on «Внесок», with no segment;
  - the bottom menu steps aside on S21 only, while its form stands;
  - another store's debt is asked only for a whole number this store
    lists nobody for, and only of stores where this person takes
    payments; its row opens nothing;
  - no «Магазину винні» card and no «Показати сплачені й списані» at the
    till;
  - «Історія · N ›» is not drawn for a debt with no entries;
  - a refusal of the sum pressed speaks alone until the sum is changed;
  - the till's «Внесок» and «Клієнти» are two screens, nothing carried
    between them;
  - a kept payment turns to «Продаж» › «Внесок» for whoever may take
    payments; a kept write-off, never made at the till, to «Борги»;
  - «Клієнти»'s debt keeps its field, the write-off and erasing until
    P0-4.

## Chosen in chat — 2026-10-29 (the frame of «Усе на бірці», part 1)

Chosen in chat on 2026-10-29, after #149: the frame's P0-4 next, built in
two parts (`all-on-the-tag-frame-1-report.md`); the screen's own title as
the page's heading is part 2. No right, rule or figure changes: every tab
and row of «Ще» is shown by the right that showed its section before. New
words: the groups «Люди», «Товар», «Гроші», «Мережа», «Цей телефон»
(capitals by style); «Товар і каталог» with its line «перевірка, моделі,
початкові залишки» (what is open); «Залишки» for «Товар»; «← Ще» for «←
Товар»; «Ціну для всіх задає менеджер у «Залишках».», «…прийміть через
«Ще» › «Прийшов товар».», «Наступні внески — у «Продажі» › «Внесок».».
Every other word stays as it was.
- **Decided here:**
  - the menu steps aside only while the keyboard is really up — a field
    it opens for in focus and the visible part shorter by more than 150 px
    — never on a cursor the till puts in its search;
  - «Брак»'s row keeps its tile's «N очікують перевірки» until P1-5;
  - «Прийшов товар» is the row's word, as the tile's;
  - «← Ще» is held only while a first send is in flight, as «Ще»; a row to
    a screen with its own journal is held by every journal but its own;
  - «Змінити магазин» on the store's line, held on S21 as the menu steps
    aside there;
  - «Вношу продаж з паперу» in «Ще» only for whoever sells in a store that
    trades;
  - whoever may not read orders opens on the first tab shown, «Ще» when it
    is the only one;
  - the receipt's next payments are built as the sections' task list's В5
    (а); to ask the owner;
  - expand and the swipe are asked once a launch.

## Chosen in chat — 2026-10-29 (the frame of «Усе на бірці», part 2)

Chosen in chat on 2026-10-29 («go further»), after #150: the frame's P0-4,
part 2 (`all-on-the-tag-frame-2-report.md`). Each screen of a store is
headed by its own title, the page's heading, with «{Магазин} · {Ім’я}» on
the line under it and «Змінити магазин» at that line's right for whoever
has two stores or more. No right, rule, figure or word changes.
- **Decided here:**
  - the title and its line stand on the page, over the screen's card, as
    the design draws them;
  - a tab's first screen is 34 — the till on each of its ways («Продаж»,
    «Повернення»), «Замовлення», a seller's «Каса», «Ще»; every other
    screen 28, as its heading was:
    «Каса» opened from «Ще», the results without a stub, the order's card
    (23 before);
  - the results with a stub — the receipt, a return's — keep their title's
    size and its check, and the line under it with «Змінити магазин»,
    though the design draws S11 without it: the task list asks for it one
    tap from any screen of a store;
  - what stood beside a title stands beside it still: «Оновити», «До
    списку», «До пошуку», orders' «+»;
  - the screens before a store opens keep «Бірка» as their heading until
    the sign-in's task (P1-4);
  - the headings inside a screen keep their levels: a third level follows
    the page's heading where a second stood before.

## Chosen in chat — 2026-10-29 (Telegram's «Назад», «Усе на бірці» P1-1)

Chosen in chat on 2026-10-29 («go next»), after #151: the frame's P1-1
(`all-on-the-tag-back-report.md`). Inside Telegram, a screen opened from
another shows Telegram's «Назад», and pressed it does what the screen's
«←» does; a tab's first screen keeps Telegram's «Закрити». No right, rule,
figure or word changes.
- **Decided here:**
  - every screen's way back is connected, those the task list does not
    name too: an invoice's «До списку накладних», an opening's «До
    списків», a model's «До пошуку»;
  - where two ways back stand on one screen, Telegram's is the innermost:
    a model's «До пошуку» before «← Ще»;
  - hidden whenever the screen's «←» is held, by what already held it —
    a kept payment holds a debt's and S21's, a first send in flight «← Ще»;
  - a result with no «←» (the receipt, S22's stub, «Продажу немає»,
    «Товар прийнято», a return's) shows none: where it would lead is each
    result's own question;
  - the orders' «← До замовлень» and «← Замовлення» take the quiet line of
    every other «←» over a title.


## Chosen in chat — 2026-10-29 (the till's cells, «Усе на бірці» P0-5, part 1)

Chosen in chat on 2026-10-29 («Start P0-5»), after #152: the first part of
the frame's P0-5 (`all-on-the-tag-cells-report.md`). The till's search finds
models as tags with a 60 × 60 cell per size, and the till chooses no
warehouse above the search. No right, rule or figure changes; the words that
change are the task list's.
- **Decided here:**
  - P0-5 goes in three parts: the cells, the model tags, the search and the
    warehouse (this one); the pay tray and the basket sheet; the shortage
    sheet, the paper switch row and the taps counted;
  - a store that sells from two warehouses or more lists them all at once,
    a cell each, as before with «Усі склади»; one warehouse may no longer
    be listed alone;
  - with no warehouse to sell from, the till says «Доступних складів немає.
    Зверніться до менеджера.», the words its list said when it had none;
  - a warehouse waiting for its opening list keeps the words it has: in a
    store with two, «Склад «X» ще чекає початкових залишків: його товар
    продавайте на папері.» (owner decision, 2026-10-17), for each one
    waiting; alone, «На складі «X» зараз немає товару в обліку…»;
  - a basket line says «Склад: X» under «{Модель} · {розмір}», whatever
    the store; the warehouse leaves the line's title; a «Прибрати …» and
    a line's quantity still name it, read aloud, where two are listed;
  - the receipt says «Склад: X» under the lines when the sale left from
    one warehouse; from two, each line its own, as before;
  - a cell is read aloud «M, вільно 2, у резерві 1, у кошику 1» — its
    warehouse after the size where the store has two («M, Свій, вільно 1»);
    a size not known, «розмір невідомий, вільно 3»;
  - in the basket, a cell's «×N» takes its top right corner and the pin of
    what orders hold moves to the top left;
  - a cell's «×N» is the line a tap on it adds to: a coat of a size not
    known whose label was read as M counts on the M cell, not the «?»;
  - a cell with no room left — a full basket, an order holding all that is
    free — is dimmed as a button that cannot be pressed; held whole, it is
    dashed instead;
  - a long warehouse name in a cell gives way, cut short, never the count;
    no cell is wider than the screen;
  - in «Нове замовлення» a cell is read aloud «…, у замовленні N»;
  - a cell of a size not known shows «?», and the tag says under its cells
    «? — розмір невідомий»;
  - the tag's line «{колір} · {вид}» is not drawn: the till's list names a
    model in one string, and the colour is not told apart from the name
    without the catalogue's own fields (no backend change in P0-5);
  - a model's tag has the row tag's hole, punched, not an eyelet: it says
    nothing of a record;
  - the search field with its «×» is shared (`shared/SearchField.tsx`), and
    used by the till and «Нове замовлення» now; «Повернути» and «Внесок»
    take it with their tasks; it stays at the top at the till alone, where
    a field the page scrolls to keeps clear of it — «Нове замовлення»'s
    scrolls with its form;
  - the light tap and the cell's `drop` to the tray wait for the tray (part
    2) and Telegram's rules (P1-2); the search in focus when the till opens
    waits for the tray, which must fit beside the keyboard (С1);
  - the bottom menu is drawn over the till's search where they meet, on
    the menu's layer of the design system (§5.7).

## Chosen in chat — 2026-10-30 (the till's tray and basket sheet, «Усе на бірці» P0-5, part 2)

Chosen in chat on 2026-10-29 («go next»), after #153: the second part of
the frame's P0-5 (`all-on-the-tag-tray-report.md`). The basket's lines,
their prices and «Оплата частинами» go into a sheet over the till, and the
panel under the thumb becomes the tray: one row of the basket that opens
the sheet, the sum, the three ways. No right, rule or figure changes: a way
still sells when pressed, with no way chosen before it (owner decision,
2026-10-04); every price, sum and term is as before. New words: «Кошик · N»
on the tray, «Кошик» as the sheet's title, «Готово» at its foot.
- **Decided here:**
  - the terminal's hint, or its paper variants, stands over the tray in the
    page's own flow, not inside it: inside, the tray grew to some 250 px at
    360 and covered the till;
  - the tray counts coats, not lines — «Кошик · 3» for a line of one and a
    line of two, as «У кошику: 3 шт.» counted — and names the first line
    only, «{Модель} · {розмір}», cut short where it is long;
  - the tray has the perforation along its top edge and no notches: it
    stands over the tags scrolling under it, and a notch would show them
    through;
  - the three ways keep their words with no icons: from paper «З паперу ·
    Готівка» already fills a third of 360 px;
  - the sheet opens from the tray's row, and by itself for a model with no
    price (the cursor in its price) and for a way pressed with the terms in
    parts not whole (what is missing said at its top); a tap on «?» does
    not open it — unread, the coat sells as «розмір невідомий», as before;
  - the sheet is closed by «Готово», Telegram's «Назад», Escape, a tap on
    the dimmed till, its handle pulled down past 80 px, and the keyboard's
    «Готово» after a price or after the sum paid now; closed, nothing of it
    is lost; it rises when it opens and is gone at once when it closes;
  - an emptied basket closes the sheet, and the next coat does not open it;
    emptied in the sheet, the cursor goes to the search;
  - while a line waits — for its price, or, from paper, to be taken out
    after its size was read off a label (G3) — the ways are dimmed but
    pressable: a press opens the sheet at that line, the cursor in the
    missing price, and nothing is sent;
  - for a moment after it opens, the sheet lets a tap go — the second of a
    double tap — as the order's steps do (review, 2026-10-24); a key's
    press is never let go;
  - the screen behind is out of reach while the sheet is open;
  - «Готово» is a quiet button at the sheet's foot, under its scrolling
    inside;
  - the till's search takes the cursor as the app opens on the till (S08)
    and on «Новий продаж», as before; the till reached by «Продати» or the
    menu leaves the cursor on what was pressed (review, 2026-10-17);
  - the shortage answer stays on the page until part 3 puts it in a sheet;
    while it stands, the till's search lets go of the top and goes up with
    the page: at 360 × 640 the answer fits over the tray only so.

## Chosen in chat — 2026-10-30 (the till's shortage sheet, paper switch row and taps, «Усе на бірці» P0-5, part 3)

Chosen in chat on 2026-10-30 («Start part 3»), after #154: the third and
last part of the frame's P0-5 (`all-on-the-tag-shortage-report.md`). The
shelf's question goes into a sheet over the till, «Вношу продаж з паперу»
becomes a switch row under the search, and a sale's taps are counted. No
right, rule or figure changes: every answer to the shelf's question is the
one it was, with its words, rights and what it sends; the paper switch is
the same state as before and as «Ще»'s.
- **Decided here:**
  - the shelf's question is closed by Telegram's «Назад», Escape or a tap on
    the dimmed till, as any sheet; closed, it sells nothing and the basket
    stays, its answers given so far with it; a way pressed again asks the
    server afresh, under the same `command_id`;
  - for a moment after it rises, the question lets a tap go, as the basket's
    sheet does: the second tap of a double press on a way never lands on
    «Товар на місці», which would record a coat found;
  - an answer that leaves less to sell than the sum paid now opens the
    basket's sheet with what the terms need, as a way pressed does; the
    question waits under it and is back once it closes — one sheet at a
    time;
  - a count refused in «На місці фактично є» is said inside the question's
    sheet, right under that field, not on the page under it; it goes with
    the line when «Прибрати з кошика» takes it out;
  - the basket's sheet closed over the question takes the terms' words with
    it: the question never shows them; an answer pressed again asks afresh;
  - a refusal of an answer, for a reason of its own, is brought into view
    where it stands at the page's end, clear of the tray — as a way's;
  - the question's sheet is read aloud with what it is about, its first
    line, after its title;
  - the till's search stays at the top again whatever stands: the question
    no longer stands in the page;
  - the paper switch row stands under the search, over the list, with the
    paper's fields under it; where the till shows no search — a warehouse
    waiting for its opening list, the catalogue, the warehouses being read —
    it stands where the search would; while the warehouses are read, under
    the grey field, about where it stays (6 px off: the grey field keeps the
    label the other screens' fields have);
  - the row is the box itself, read as a switch, the whole row its target;
    turned on by it, the paper's fields are brought into view over the
    tray, the ways waiting for them; turned on in «Ще», the till opens
    where it opens;
  - a sale's taps are counted from the till, typing not counted: three for a
    coat with a price — the search, its size, a way — in a store with one
    warehouse and with two; five paid in parts — and the tray's row and
    «Оплата частинами» — the keyboard moving through the customer's fields
    and closing the sheet. The app opened on the till has the cursor in the
    search already: two taps then.

## Chosen in chat — 2026-10-30 («Сьогодні», part 1: the tab and the day-tag, «Усе на бірці» P0-6)

Chosen in chat on 2026-10-30 («go next»), after #155: the frame's P0-6,
built in three parts, every owner question of it (В-Т1, В-Т2, В-Т3, В-Т5,
В-Т6) as its (а) until answered (`all-on-the-tag-today-1-report.md`). This
part: the tab, its head and the day-tag. No right, rule or figure changes:
every figure on «Сьогодні» is a field the server already answers, read by
the right it already needs; debts stay a store's own.
- **The first tab:** whoever holds `report:view_financial` in the store
  opened — the owner and managers — opens on «Сьогодні», the menu's first
  tab (owner decision, 2026-10-26, В3; the frame's §4а); a seller opens on
  the till as before. Kept operations still turn to their own tab.
- **Decided here:**
  - P0-6 in three parts: this one; the work tags of «Чекає на вас», the
    empty state, the backups line and the tab's badge; the news tags with
    «Бачу», the toast, what was seen kept on this phone and «Зроблено
    сьогодні»;
  - the day-tag reads the network (В-Т6 (а)): every store the report reads
    that trades, known from `/me` with its rights, a column each for two, a
    row each from three; one read alone has none, its drawer and debts
    standing in the tag; one that trades beside one that does not, a named
    row, the total holding both; a store that does not trade has no
    column, though the report's total holds it;
  - its drawer line, in the words «Каса» already has: «Каса відкрита»,
    «Касу закрито о 20:06», «Каса ще не рахувалась»;
  - a store nobody owes: «Ніхто не винен», in pencil, without the debt's
    arrow — «Борги»'s «Зараз ніхто не винен», shortened;
  - the money line: «Гроші» is the report's «Разом»; «поза касою:» names
    cash on delivery and the transfer in advance, each only when not
    nothing;
  - the parcels' line counts the open orders of the day's stores where
    this person reads orders, each state only when there is any, no line
    when none; past a store's hundred, every count with «+»; its tap opens
    «Замовлення» of the store open;
  - the age stamp is the oldest of the tag's reads: «● наживо · 11:40»;
    older than five minutes, or the last asking of any of them failed,
    «дані на 11:32» in a warning's colour with its triangle, «— сервер не
    відповідає» only when it went unanswered; nothing read yet and the
    reading failed: «сервер не відповідає», or «не вдалося прочитати» for
    another refusal;
  - below 700 px of Telegram's steady height, one line «Сьогодні досі ·
    12 050,00 грн · 6 шт.» — at 360 px two, broken after «Сьогодні досі ·»
    — the stamp under it when old or unread; tapped, the tag opens in
    place, the cursor on its heading, and stays open while the screen
    stays;
  - the day under the title is the stores' own once the report gives it,
    the phone's before;
  - a figure that waits holds its place in grey; a read that fails keeps
    what it showed, and hides nothing else;
  - the report, a drawer and a store's debts are read under the keys of
    their own screens: one asking for both, and what «Каса» or «Борги»
    learns shows on «Сьогодні»;
  - narrower than 390 px, a store's sum at 20, as the spec has under 360;
    a million a day or more in a column, at 24;
  - read as the screen opens, on the tab and as the app comes back, never
    more than once a minute — not while the screen stays open;
  - the report's right gone while «Сьогодні» is open: the first tab shown;
  - «Ще ⚠» stays in the menu until the backups tag (part 2) and «Ще»'s dot
    (P1-5).
- **The till further for whoever reads the report:** from the app's
  opening, «Продаж» first, and the cursor stays on the tab (review,
  2026-10-17): an owner's sale with a price is four taps from the opening,
  two before; a seller's stays two. The frame's three are counted from the
  till.
- **Not met:** the frame's «≤ 240 px at 390» — 347 px with «Центр +
  Ринок»: the concept's figures had no «,00», and its lines no words of
  their own. Part 2's two work tags over the menu at 390 × 741, with 64 px
  for the search, need some 70 px more: a reading for the owner.

## Chosen in chat — 2026-10-30 («Сьогодні», part 2: what waits, «Усе на бірці» P0-6)

Chosen in chat on 2026-10-30 («Merge, then part 2»), after #156: the
frame's P0-6, part 2 of 3, every owner question of it as its (а) until
answered (`all-on-the-tag-today-2-report.md`). No right, rule or figure
changes: each tag is a read the server already answers, by the right it
already needs, in the store it is of.
- **«Чекає на вас · N»:** a tag a kind and a store, in the frame's order —
  the network's backups while not in order or with trouble on the server,
  the parcels to send, «Брак», the lists of existing stock to approve.
  Each goes by itself once the work is done, at the next reading.
- **Decided here:**
  - the backups' tag says the backups screen's heading for the state, or
    the server block's while the copies are fine; its meta, what is wrong
    on the server now, in that screen's words;
  - the parcels' goods as «{модель і колір} {розмір}», «× 2» for more than
    one, the oldest order first, three and «+ ще N»;
  - «Брак» counts the units awaiting inspection, as its row in «Ще»; one
    being looked at waits on nobody here;
  - the lists in review, a shared warehouse's in the store that keeps it;
  - the lists' eyelet in ink: the frame gives them no colour;
  - a store named in a tag's meta whenever the day holds two stores or
    more; another store's tag has no verb (В-Т2 (а)); the open store's
    tags first of their kind, the others by code;
  - «+ ще N» from the eighth tag; tapped, the rest in place and the cursor
    on the first of them;
  - «Вас нічого не чекає.» alone, once every read has answered; a read not
    answered holds a tag's place, and a failed one says so there;
  - how old it is, the block's: the day-tag's stamp «дані на …» by
    «Чекає на вас · N», or under «Вас нічого не чекає.», once any of its
    reads is older than five minutes or failed at its last asking;
  - «Копії в порядку · сьогодні о 03:15» — «учора о», or the date — under
    it all, for whoever reads the backups, while nothing is wrong;
  - the tab's badge, «9+» past nine, is its description, «Чекає на вас: N»,
    never part of its name;
  - a section a tag opened goes back with «← Сьогодні», held as the menu's
    «Сьогодні» is; the cursor on the menu's «Сьогодні» after the verb and
    after «←», on «Замовлення» after the parcels' verb;
  - the backups' own read, for «Ще ⚠», asked again at most once a minute,
    as «Сьогодні» reads;
  - «Ще ⚠» stays until P1-5.
- **Not met:** the frame's two tags over the menu at 390 × 741 — part 1's
  open question of the day-tag's height; a reading for the owner.

## Chosen in chat — 2026-10-31 («Сьогодні», part 3: news, «Бачу», «Зроблено сьогодні», «Усе на бірці» P0-6)

Chosen in chat on 2026-10-31 («go next»), after #157: the frame's P0-6,
part 3 of 3, every owner question of it as its (а) until answered
(`all-on-the-tag-today-3-report.md`). No right, rule or figure changes:
each tag is a read the server already answers, by the right it already
needs; what was seen is this phone's alone (В-Т3 (а)). P0-6 is closed.
- **News among «Чекає на вас»'s tags,** in the frame's order: a drawer's
  difference after the backups, a stocktake finished last. Each goes once
  seen («Бачу»), with «Бірку сховано.» and «Повернути» for five seconds.
- **Decided here:**
  - «Бачу» on every piece of news, another store's too: it changes nothing
    there, it is only what this phone keeps;
  - one tag a close and a stocktake, not one a kind and a store;
  - a close is news when its difference wants a reason (the server's
    `reason_required`, 1,00 грн or more), of the drawer's yesterday or
    today, 06:00–06:00, said «учора» / «сьогодні» by that day, in «Каса»'s
    words; one read of the closes for every store whose money is read;
  - a stocktake is news finished yesterday or today by the phone's day,
    told in the store it was taken in — a store not of the day named, after
    the day's; a shared warehouse read once, through the open store first,
    once every store's warehouses have answered; «Брак» and a paused
    warehouse never read;
  - the meta: «{Ім’я} · о 20:06 · причина: «…»», or «причину не вказано»;
    a stocktake's «{Магазин} · {Ім’я} · учора о 18:30»;
  - the drawer's eyelet filled in warning; the stocktake's a ring in
    offline, as S04;
  - the toast five seconds, held while the cursor is in it, gone when
    «Зроблено сьогодні» opens; a double tap's second half let go on «Бачу»
    and on «Повернути» for 0.7 s, as a sheet's;
  - seen, the cursor on the tag after it, else before it, else the heading;
    brought back, on it;
  - «Зроблено сьогодні · N ›» by the heading, or under «Вас нічого не
    чекає.», for what was seen since the phone's midnight; its sheet read
    only, the latest first, a knot and «Побачили о 12:04» each;
  - this phone keeps `birka:seen:{organisation}:{person}`: ids and when,
    never what a tag said, forgotten after seven days;
  - the tab's badge counts only what is not seen;
  - a close in «Каса» reads every closes list again, «Сьогодні»'s too.
- **For the owner:** the toast's words — the frame's «Бірку сховано.»
  against §6.23's «Перенесено в «Зроблено сьогодні»»; «Бачу» on another
  store's news; the drawer's day and the phone's side by side before six;
  a stocktakes read for each warehouse (two stores with two each: 20 reads
  at entry).

## Chosen in chat — 2026-10-31 (Telegram's rules for the build, «Усе на бірці» P1-2)

Chosen in chat on 2026-10-31 («Start P1-2»), after #158: the frame's P1-2,
every owner question of it as its (а) until answered
(`all-on-the-tag-telegram-rules-report.md`). No right, rule or figure
changes: what changes is what Telegram is told — its question before
closing, the keyboard, the MainButton, the buzz and the screen's turn.
- **The question before closing** (`web_app_setup_closing_behavior`) is
  built by В-Т7 (а), against the owner's В7 (а) of 2026-10-26 (navigation
  task list): on while the till's basket holds goods — on the till, or
  left for another tab of the same store — while a sale kept on the phone
  waits to be checked, and while a sum is typed on S21; off otherwise. A
  basket from paper, gone as the paper switch is turned off on another
  screen, holds nothing: the question and the lock go with it.
- **Decided here:**
  - the sum typed is S21's at the till's «Внесок» and in «Борги»'s debt
    alike: the same form; off once the payment is taken, on again with the
    next sum; a payment kept on the phone keeps its sum on S21, and the
    question with it;
  - the screen kept upright (`web_app_toggle_orientation_lock`) while the
    basket holds goods — the spec's «while a basket is open» read as a
    sale under way, not as its sheet open; Telegram's lock keeps the
    screen as it is, so it is asked only while the phone is upright: held
    sideways as the first coat goes in, the screen is not locked so, and
    it is locked once the phone turns upright (review); the count's lock
    is «Каса»'s task list's;
  - the keyboard goes (`web_app_hide_keyboard` where Telegram knows it,
    and the field lets go of the cursor everywhere — review) on: a size
    cell at the till when its model has a price, or the coat is already in
    the basket — a new line without a price opens the sheet with the price
    in focus; a return's sale found; a
    debt's customer found; the price confirmed by the keyboard's key; what
    is paid now confirmed by it. «Каса»'s count and move keep theirs
    (part 2, the sections' task lists);
  - every field of part 1 says its key: the reason's fields «enter», a
    new line; the keypad's sum opens no keyboard and says none;
  - the MainButton is S22's «Відкрити борг» for a payment's result, at the
    till's «Внесок» and in «Борги» — the frame's «in a deposit, never» read
    as the payment's form, as the spec's rule 4 forbids a MainButton in the
    sale's loop and the payment's form only; a write-off's result keeps both its buttons. In
    Telegram the screen draws no «Відкрити борг» of its own: one primary
    a screen (spec §3, P2). In `primary` / `on-primary`, painted again
    when Telegram's theme turns;
  - the buzz, by the spec's vocabulary (§4.4):
    - a choice (`selection_change`): a store at its door, a way of the
      till («Продати · Повернути · Внесок»), «Бачу» (S04);
    - a light tap (`impact light`): a coat into the basket by its cell —
      one tap, one buzz: never a choice too, though S09 names both —
      «Менше» / «Більше» in the basket, a tag's verb on «Сьогодні»;
    - a warning: an operation kept on the phone, once, as it is first kept
      — a sale, an order's step, a return, a payment, every journal's
      command, a catalog's proposal — never again at a later check still
      unanswered; and a close short or over by any sum, under a hryvnia
      too, which wants no reason, in place of its success: as its colour
      is (review);
    - success and error as before;
  - a kept operation's warning replaces «a lost answer buzzes nothing»
    (returns task list, P2-5) and «kept, no buzz» (orders): the spec and
    the frame name a kept operation a warning;
  - Telegram is told only where it names its version, and only what the
    version knows: the question before closing from 6.2 — the SDK here
    takes it for any — the screen's turn from 8.0, the keyboard from 9.1,
    the buzz from 6.1, the MainButton in any; where it names none, nothing,
    and S22 draws its own «Відкрити борг».
- **For the owner:** the question before closing — В-Т7 (а) against your
  В7 (а); S22's MainButton — the frame's «Відкрити борг» against the spec's
  «Готово»; S22's MainButton at the till's «Внесок», against the frame's
  «в кассе, возврате и внеске — никогда» if it means the deposit's result
  too; a kept operation now felt as a warning where it was felt as
  nothing; a cell felt once, as the coat, where S09 names a choice and a
  tap.

## Chosen in chat — 2026-10-31 («Повернути» in the new system, «Усе на бірці» P1-3)

Chosen in chat on 2026-10-31 («merged go next»), after #159: the frame's
P1-3 (`all-on-the-tag-returns-report.md`). No right, rule, word or figure
changes: what changes is where the returns' words stand and how their rows
are drawn.
- **The returns' list is the till's place:** headed «Продаж», as the till
  and the till's «Внесок» are, «Повернути» pressed under it — for whoever
  only takes returns too, whose «Продаж» opens them with no switch. Its
  own «Повернення» goes from the list; the sale's screen keeps it, nested.
- **Decided here:**
  - the field is the till's search (spec §6.6), in the till's place under
    the switch — switching from «Продати» moves nothing while nothing is
    said over the till's field; «Внесок» keeps its own form until its task:
    its name «Що повертають?» is read, not seen, and its hint
    «Модель або колір» is what is seen in it — both the owner's words of
    2026-10-17, neither changed; the spec's «search «Що повертають?»» read
    as the field's name. It takes 100 letters, as the server's search of
    sales does, and empties by its «×» as the till's does;
  - a row (§6.8) is 64 high at least, its goods the row's title, 17/600 in
    ink; the hour leads the line under them, with the count and the
    stickers, as before — the frame's «{Модель} {колір} · {розмір} ·
    ГГ:ХХ» read as the row's reading order, since a sale of two lines
    cannot carry its hour after each size; no sum, as before;
  - the rows keep the app's lists' rhythm — on the page, a line between —
    as «Борги», «Каса», «Ще» and the orders draw theirs, not on a card of
    their own (§6.8's card and inset): one list looking unlike the rest
    would be read as a different thing;
  - a sale returned whole, which opens nothing, has its goods in pencil,
    as §6.8's row that takes no tap (review); its sticker says why;
  - the field's «×» forgets an Enter, as «Очистити» does: the same letters
    typed again wait for the pause (review);
  - the sale's screen, its dock over the menu and the result's stub are
    as P0-2 and P0-4 built them: «Повернення» at 28 with «← До списку»,
    «Продаж {день, ГГ:ХХ} · {сума}» under it.
- **A return is 4 taps** from the till, as before (`hot-path-budget-report.md`):
  «Повернути», the sale's row, «Цілі: більше», «Повернути покупцю …», the
  way the sale's own.
- **For the owner:** the row's hour under the goods, where the frame writes
  it after the size; the rows in the app's lists' rhythm, not on a card;
  «Що повертають?» read and «Модель або колір» seen, as at the till.

## Chosen in chat — 2026-10-31 (the way in, the door, «Ще»'s lines, other stores' units; «Усе на бірці» P1-4, P1-5, P2-3)

Chosen in chat on 2026-10-31 («merged, go next»), after #160, as one batch
(«in next iterations we can do more voluminous lists of points»): the
frame's P1-4, P1-5 and P2-3 (`all-on-the-tag-entry-more-report.md`). No
right or rule changes, and no word of a refused sign-in or a session's end
(К12).
- **The way in (P1-4), decided here:**
  - the name over «Доступу ще немає» is Telegram's first and last name from
    the launch data, read on the phone and sent nowhere, its initials in
    the avatar; with no name, the line is not shown;
  - the ID in threes from the right, a lone first digit joined to the next
    («5820 114 377», as the frame writes it); the groups stand apart by
    their margins, so what is copied or selected is the digits alone;
  - copied: a «success» buzz and the toast «ID скопійовано» (the app's
    toast with no action, 4 s); refused: the current words «Не вдалося
    скопіювати — виділіть ID і скопіюйте його.», as a toast; a phone with
    no clipboard has no button, and one tap selects the ID whole;
  - «Спробувати ще раз» reads the sign-in again with the screen kept as it
    is; still no access, the toast «Доступу поки немає. Попросіть власника
    магазину додати ваш ID.»; access given meanwhile, the app goes on;
  - a failed sign-in: the same blank tag, headed by its own title «Вхід
    через Telegram» (an h2 under «Бірка» before), its words as they were;
    «Бірка» stays on the screen as the line over the tag, the app's mark
    beside it (owner, 2026-10-15, В4);
  - opening (S02): a first screen's places — a title, a line, a field,
    three rows — with «Входимо в магазин…» read, and no menu; once the
    rights are read, the first tab's places under the real menu, as before.
    Signing in no longer shows the till's three tags (2026-10-17, «how it
    is carried out»): before the rights, the first screen may be
    «Сьогодні», the door or the till;
  - the door: «Де ви сьогодні?» (h1), «Продажі запишуться на той магазин,
    у якому ви зараз.», a big tag a store — 96 high at least, its eyelet,
    the whole tag pressable, the name 22/700 and its code under it, a store
    that does not trade with its state's sticker; nothing chosen
    beforehand, nothing remembered (В6). The person's name no longer heads
    the door: every screen after it says it in «{Магазин} · {Ім’я}»;
  - the session's end is the sign-in's moment plus the answer's
    `expires_in`, kept with the token; with no `expires_in`, or one no
    session has (over a year), no end is said.
- **«Ще»'s lines (P1-5), decided here:**
  - a glyph at 24 on every row, the switch too, from P0-1's set; the
    backups' row named plainly «Резервні копії»;
  - «Борги»: «{N} людина винна / людини винні / людей винні» — the frame's
    «{N} винні», said with its noun — in the debts' colour, `customers` of
    the open store's `GET /credits/summary`; none, «ніхто не винен», as
    «Борги» says «Зараз ніхто не винен»;
  - «Брак»: «{N} очікують перевірки» in «Брак»'s colour, as its tile said;
  - «Початкові залишки» and «Товар і каталог» that holds it: «{N} на
    затвердження» in ink — lists in review kept by the open store, a shared
    warehouse's in the store that keeps it, for whoever holds
    `snapshot:approve` there; «{N}+» when the read's hundred lists did not
    end, as «Сьогодні»'s parcels say theirs (review); «Товар і каталог»
    then says what it holds, after « · »; none known to wait, nothing said;
  - «Резервні копії»: «в порядку, уночі о ГГ:ХХ», the last copy's end by
    this phone's clock, or a dot in the warning's colour and «потрібна
    ваша увага» whenever the backups' screen has something to say (owner,
    2026-10-03); the same dot on «Ще» in the menu, its name read «Ще — є
    що перевірити»; no «⚠» anywhere in the app;
  - «Змінити магазин» says the store open now;
  - the foot: «Ви увійшли як {ім’я} · сесія до ГГ:ХХ», no role (К8); with
    no known end, the name alone;
  - a count being read is a grey place; a read that fails says nothing —
    no number is made up.
- **Other stores' units (P2-3), decided here:**
  - the line names the store undeclined, «Ще в магазині «Ринок»: M 1 ·
    L 1»: the frame's «Ще в «Ринку»» needs a case the app cannot make of
    any store's name — as «Усього винні магазину «X»» (P0-3);
  - asked: each of the person's other stores that trades (`ACTIVE`) where
    they hold `inventory:view`, once a typed search (two letters, the
    pause) and store, with the till's own request — the server lets it read
    what that store sells from, «Свій» only with a right there; nothing is
    asked while nothing is typed, and a search's answer stands a minute,
    not asked again as the app comes back to the front;
  - counted: free units only (`available_quantity` above nothing), summed
    by size in the server's order, a size not known «розмір невідомий»; a
    warehouse this till sells from is left out — its units are on the tag
    already (a warehouse two stores share);
  - a store whose answer does not end within its hundred rows, or fails,
    says nothing: no number is made up;
  - the line stands under a model's tag the till lists, in pencil, and is
    never pressed. A model the open store holds none of has no tag, so no
    line.
- **For the owner:** the store's name undeclined in «Ще в магазині
  «Ринок»»; a model this store has none of shows no other store's line
  (it has no tag here); «{N} людини винні» for the frame's «{N} винні»;
  the failed sign-in headed «Вхід через Telegram», «Бірка» over its tag;
  «в порядку, уночі о ГГ:ХХ» said of a copy made by day too (the spec's
  words).

## Chosen in chat — 2026-11-01 («Замовлення» thread, card, send sheet; sections P0-1..P0-3)

Chosen in chat on 2026-11-01 («Yes, start it»), after #161, as one batch:
the sections task list's P0-1 (S16), P0-2 (S17) and P0-3 (S18)
(`all-on-the-tag-orders-thread-report.md`). The owner's questions are built
by (а) / «если нет». No right, no server rule and no word of the money
changes; a sale is still recorded only by a way's button at «Клієнт
забрав», nothing chosen first.
- **The list (S16, P0-1), decided here:**
  - the string «До відправлення · Відправлено · Прибув на пошту · Клієнт
    забрав» is the filter, «До відправлення» chosen as it opens; the chosen
    knot is a ring, the others filled in their colours; each count under
    its word, its line kept while it is not counted (the open ones are
    counted once all are read; «Клієнт забрав» never — the server does not
    count it);
  - while a waybill is searched the string is hidden, and the rows found
    carry their stickers and their verbs; the open places carry no sticker
    (the place says it), «Клієнт забрав» and the cancelled do;
  - «Скасовані й повернені на склад ›» under «Клієнт забрав», shown when
    there are any or more pages to read; their own screen, «← До
    замовлень» back to the link;
  - those to be sent grouped «Склад «X» · N» and «З кількох складів · N»
    only when every line's warehouse is named (read by whoever has
    `inventory:view`); otherwise one list;
  - a row's verbs: «Відправити» and «Клієнт забрав» open the card with
    their sheet, a light buzz; «Прибув на пошту» records from the row, the
    list kept, the toast «Прибув на пошту: {товари}»; a tap within 0.7 s
    of the list changing is let go;
  - an empty place says «Тут посилок немає.»; while more open orders are
    to be read, a place none is in yet says nothing, and a warehouse's
    heading has no count — as the knots (review, 2026-11-01).
- **The card (S17, P0-2), decided here:**
  - its line «замовлено 13.10 · № {8}», without the store: the screen's
    line already says «{Магазин} · {Ім’я}»;
  - the string: a cancelled order shows its first knot passed, one come
    back the first two, no knot its own, the sticker under it; the day
    under «Відправлено» once it stands there or past it, by the last
    `DISPATCHED` version;
  - «Скопіювати ТТН» copies the waybill exactly as written; copied, a
    `success` buzz and «ТТН скопійовано»; refused, no buzz and the toast
    «Не вдалося скопіювати — виділіть ТТН і скопіюйте її.», as the way
    in's ID (2026-10-31);
  - the MainButton is put away while «Клієнт забрав»'s sheet is open (the
    ways are never it); outside Telegram the same step is the dock's one
    button;
  - the sheets live outside the card, so what was typed survives the card
    being read again; a step's sheet closes in the render that says what
    came of it — recorded, kept (the banner says it) or refused as the
    order moved on meanwhile (the card says what it is now, focused); any
    other refusal keeps the sheet with why, focused, what was typed kept;
  - what a step did takes the cursor where nothing else has it; the step
    is held on the MainButton while another operation is kept, as the
    dock's button is; Telegram's «Назад» closes a sheet before the card
    under it (review, 2026-11-01).
- **«Відправити» (S18, P0-3), decided here:**
  - «Пишемо як є — з Новою поштою не звіряємо.» only for Нова пошта; other
    carriers get no line; abroad, its own words and «Без імен і телефонів
    покупців.»;
  - a waybill another order has: recorded, a `warning` buzz (not
    `success`), the sheet kept with the approved block, the MainButton
    «Готово».
- **Taps (as the sections task list's scorecard counts them):** an order
  sent or at the post office is one knot further than before — a waybill
  written later is five taps from the menu, goods come back seven, «Клієнт
  забрав» four by the row's verb.
- **For the owner:** «Тут посилок немає.», «Склад «X» · N», «З кількох
  складів · N», «замовлено …», «У посилці», «Доставка», «Скопіювати ТТН»,
  «ТТН скопійовано», «Не вдалося скопіювати — виділіть ТТН і скопіюйте
  її.», «Пишемо як є — з Новою поштою не звіряємо.», «Відправити»,
  «Готово», «Прибув на пошту: {товари}».

## Chosen in chat — 2026-11-01 («Покупці», the customer's card, the payments' words; sections P0-4, P0-5, P2-2)

Chosen in chat on 2026-11-01 («Yes, after #162 merges»), after #162, as one
batch: the sections task list's P0-4 (S19), P0-5 (S20) and P2-2
(`all-on-the-tag-customers-report.md`). The owner's questions are built by
(а): В2 the switch «Винні зараз · Сплачені · Списані», В3 the keeping lines
as the task list words them, В5 «у «Продажі» › «Внесок»». No right, no
server rule and no sum changes: every figure is the server's, a store at a
time; nothing is added up on the phone.
- **«Покупці» (S19, P0-4), decided here:**
  - the blocks: the open store first, then this person's other stores that
    trade and where they hold `sale:credit`, in the order `/me` gives them;
    the stores that do not trade are asked for only by a whole number, as
    before, under the open store's block;
  - with more than one block, a block that finds no one says «Нікого не
    знайдено.»; under «Сплачені» and «Списані», «Сплачених боргів тут
    немає.» and «Списаних боргів тут немає.»; one block keeps the one
    store's words as they were;
  - another trading store's customer opens their card here; that store's
    debt is read here and paid, written off or erased there: «Внесок
    приймає «X»», no ⋯ on it;
  - a row's name for a screen reader still begins «Відкрити борг: …»,
    though it opens the card (a reading to note).
- **The card (S20, P0-5), decided here:**
  - it reads the phone's debts of every status, a read a store; a store's
    one debt is its block, two and more are rows to its detail;
  - the owner's ⋯ opens a sheet named by the goods; «Списати борг» is a
    sheet with its reason and its sum; «Стерти дані покупця» is Telegram's
    popup, and outside Telegram a sheet with the same words;
  - the debt's detail has no payment panel any more (the task list's «До
    S21 — панель…»: S21 exists): «Внесок» is the MainButton, outside
    Telegram the dock's one button, and opens S21;
  - S21's «←» names the screen it goes back to — the card by its name, or
    the debt's detail by the customer's name; the till's chooser and
    debt keep «← До боргів»;
  - the history's first line of a debt is «Частинами» with the sale's
    total; a refused copy says «Не вдалося скопіювати — виділіть номер і
    скопіюйте його.» with no buzz, as the waybill's;
  - while S21 stands, a kept payment waiting too, the menu stays aside.
- **The words (P2-2), decided here:** a refused write-off's words say
  «Відкрийте борг у «Покупцях» і спробуйте ще раз.» — the write-off is
  there, not at the till; a payment's say «у «Продажі» › «Внесок»». The
  till's chooser no longer shows a total across the stores asked.
- **After the review (2026-11-01), decided here:**
  - under «Сплачені» or «Списані» a row of two or more debts says how they
    closed («Сплачено», «Списано»), never «Нічого не винні»: only that
    status is read, and the customer may owe here now;
  - a payment or a write-off made on S21 or a debt's detail opened from the
    card: back on it, nothing it read before is shown — no old sum, no
    «Внесок» — until it is read again; while the card itself is read again
    (its own write-off, Telegram back in front), «Внесок» waits;
  - S21's and the detail's «←» name the customer as the card's heading
    does (the open store's spelling first);
  - among the stores that do not trade, «На який борг вносить?» names each
    debt's store;
  - the card and a debt open at their top, from wherever the list was
    scrolled;
  - the owner's ⋯ gone with its sheet open (the debt read again into rows)
    gives Telegram's «Внесок» back.
- **For the owner:** «Покупці», «Ті, хто купує частинами», «Винні зараз ·
  Сплачені · Списані», «Магазину «X» винні», «Магазин «X»», «Нікого не
  знайдено.», «Сплачених боргів тут немає.», «Списаних боргів тут
  немає.», the two keeping lines, «Скопіювати», «Телефон скопійовано»,
  «Магазин «X»: не винні», «Внесок приймає «X»», «На який борг
  вносить?», «Ще N», «Стерти дані покупця?», «Відкрийте борг у
  «Покупцях» і спробуйте ще раз.».

## Chosen in chat — 2026-11-01 («Гроші»: where the money is now, what came in; sections P0-7)

Chosen in chat on 2026-11-01 («Yes, start «Гроші»»), after #163: the
sections task list's P0-7 (S29) alone (`all-on-the-tag-money-report.md`).
The design's open questions are built as «if no»: Q-1 (the drawer and the
invoices are the open store's), Q-9 (kopecks everywhere), Q-10 (no Face
ID), Q-11 (no «У перевізника», no «Передоплати…»). No right, no server
rule and no sum changes: every figure is a field the server answered, a
store at a time; the phone adds nothing up — not the stores, not the
places.
- **The tab, decided here:**
  - «Гроші» is a tab of whoever holds `report:view_financial` in the open
    store, between «Замовлення» and «Ще», «Сьогодні · Продаж · Замовлення
    · Гроші · Ще»; its glyph is the spec's `tab-money`;
  - for them «Каса», «Звіт про продажі» and «Накладні» leave «Ще» ›
    «Гроші» and are opened from «Гроші»; «Постачальникам» stays in «Ще» ›
    «Гроші» (frame task list, §2а row 11); the screens opened from «Гроші»
    say «← Гроші» and mark its tab;
  - whoever reads no report keeps «Каса» as a tab and «Накладні» in «Ще»,
    as before; in a store that does not trade, whoever has «Гроші» opens
    «Каса» from it too — never a sixth tab.
- **«Де гроші зараз», decided here:**
  - the stores are the report's: where this person holds
    `report:view_financial`, by code, one that does not trade with
    «заблоковано» or «в архіві»; each place says a line a store, the
    store named even when there is one;
  - «У касах»: the last close's counted cash, «учора порахували 5 380,00
    грн о 20:06» or «сьогодні порахували …»; a close older than yesterday,
    «21.10 порахували …»; none yet, «Каса ще не рахувалась»; «Сьогоднішня
    готівка — після вечірнього підрахунку.» while a drawer of them is not
    closed today; «Видано сьогодні» lists each cash taken out in today's
    drawer day — «Ринок» · Кур’єру постачальника 1 040,00 грн · 11:30 —
    and nothing put in;
  - «Картка сьогодні · звірте з чеком» and «Перекази сьогодні»: today's
    report's card and transfer, as «Звіт про продажі» counts them;
  - «Вам винні клієнти»: each store where this person takes payments
    (`sale:credit`), «Винні 8 400,00 грн · 4 покупці» or «Ніхто не
    винен»; its name opens «Покупці» where the open store has
    `sale:credit`;
  - «Ви винні постачальникам»: each store whose invoices this person reads
    (`supplier:debt`), «38 000,00 грн · 3 накладні» or «Нічого не винні»;
    its name opens the open store's «Накладні» where it has
    `supplier:debt`;
  - how old it is: «● наживо · 11:40» or «дані на 11:32» beside «Де гроші
    зараз», as on «Сьогодні»'s day-tag; a place older than five minutes,
    or whose last asking failed, says so itself; one never read, its
    plate and «Спробувати ще раз», the others standing. Read as
    «Сьогодні» reads: as the screen opens and comes back, at most once a
    minute, under the keys «Каса», «Покупці» and «Накладні» read them by.
- **«Надійшло», decided here:**
  - «Сьогодні · Вчора · Тиждень · Місяць» (the report's «Цей тиждень»,
    «Цей місяць» stay there): from Monday and from the 1st to the server's
    `today`, as the report counts; held until today's report has answered;
  - a table, the ways down, the stores across: «Готівка», «Картка»,
    «Переказ», «Не вказано» only where a store has any, «Разом»; the
    figures without «грн», which heads the table once, kopecks always;
  - «Окремо від «Разом» — замовлення: переказ наперед … · накладений
    платіж … («Центр»)» a store where its orders brought any; «З них
    внески за борг: «Центр» 500,00 грн» the stores with any.
- **The rows, decided here:** «Звіт про продажі» opens on the period
  chosen; «Закриття» and «Каса · {магазин}» are the open store's, «Каса»
  by its own right as before.
- **After the review, decided here:**
  - «Видано сьогодні» leaves out cash recorded late against an earlier
    close (`for_close_id`, B6.3): it left before that close's count and is
    that close's, read in «Закриття»;
  - the line about tonight's count waits only for the stores that trade:
    one blocked or archived closes no day;
  - «Покупці» opened from «Гроші» marks «Гроші» too, as its other screens;
  - a place's name, held while another screen's operation waits, is a
    button held, as its row in «Ще» is — not plain words;
  - a period kept while today's report is forgotten and cannot be read
    again: «Надійшло» says so with «Спробувати ще раз», never a wait
    without end — its period's read is the day's own until today is
    known;
  - the right to read the report gone while «Гроші», «Закриття» or the
    report is open: the first screen this person has, as «Сьогодні» does;
  - «Гроші» is held as «Ще» is, only while a first send is in flight: it
    is the only way to «Каса» for whoever reads the report, a reason owed
    after a close included (G12); its ways keep their sections' holds.
- **For the owner:** «Гроші», «Де гроші зараз», «У касах», «учора
  порахували … о …», «сьогодні порахували … о …», «21.10 порахували … о
  …», «Сьогоднішня готівка — після вечірнього підрахунку.», «Видано
  сьогодні», «Картка сьогодні · звірте з чеком», «Перекази сьогодні»,
  «Вам винні клієнти», «Винні … · N покупці», «Ви винні постачальникам»,
  «N накладних», «Нічого не винні», «Кожне місце окремо — ніколи не
  складаємо в одну суму.», «Надійшло», «Тиждень», «Місяць», «Окремо від
  «Разом» — замовлення: …», «З них внески за борг», «Каса · {магазин}»,
  «← Гроші».

## Chosen in chat — 2026-11-01 («Товар»: the model's detail, «Інвентаризація»; sections P0-6, P1-5)

Chosen in chat on 2026-11-01 («go next»), after #164: the sections task
list's P0-6 (S23) and P1-5 as one step, as its §8 orders
(`all-on-the-tag-goods-report.md`). В4 is built by (а): the grid is read
only, a coat is sold from the till's cells. The design's Q-6 stays «if
no»: no «Відкласти під замовлення», no «Питали в чатах». No right, no
server rule and no figure changes: every number of the grid is a field
the server answered, and «Разом» and «Можна продати» are sums of its
units, never a new meaning.
- **The way in, decided here:** at the till, «Продати», the model's name
  on its tag is a button: it opens the model's detail (S23) with «←
  Продаж», Telegram's «Назад» doing the same; back on the till, its search
  is what it was and the basket as it was left. Not on the returns',
  orders' or debts' searches, which pick goods for their own task.
- **«Залишки», decided here:**
  - «Ще» › «Товар» › «Залишки» leaves for whoever has the till in the
    open store (`sale:create` in a store that trades): the till's search,
    a model a tag, and the model's detail are its place (design §3);
  - it stays, as it was, for whoever reads the stock there
    (`inventory:view`) but has no till — no `sale:create`, or a store
    blocked or archived: without it they would read no stock at all; its
    stocktake and «Знайшли товар, якого немає в списку» move to
    «Інвентаризація», for them too;
  - kept unconfirmed, when the app opens again: a count opens
    «Інвентаризація», where it was counted, for whoever may correct stock,
    else «Залишки» where it stays; a correction opens «Залишки» where it
    stays, as before — its balances are read again once it is settled;
    with the till, nothing is opened for it: its notice stands over the
    till, whose search shows the stock.
- **The model's detail (S23), decided here:**
  - read as the till reads, by the text its model was found by: the
    warehouses the store sells from, a hundred rows a page, page after
    page while its rows may go on (the server lists a model's rows
    together); each other warehouse the store reads — «Брак», one paused,
    one it does not sell from — by its own `location_id`, the same text;
    with no text, the whole list until the model's rows end;
  - its name in capitals; «Ціна продажу 3 600,00 грн», the price this
    store's till suggests, or «Ціна продажу не задана»; «Змінити ціну»
    for `catalog:set_price`, the price editor as it was, in a sheet named
    by the model;
  - the grid: the sizes in the server's order, «?» for a size not known
    (read «розмір невідомий»), «Разом»; a row a warehouse holding any of
    it, by its name as written: those the store sells from first, each
    with «з них у резерві» under it where orders hold any; «Брак» with
    its torn tag; one the store reads but does not sell from, plain; one
    paused, grey, and «Склад на паузі. Залишки доступні для перегляду.»
    under the grid; a rule, then «Можна продати» — what is free on the
    warehouses the store sells from. Nothing in the grid is pressed;
  - its ways under it, each by its own right: «Прийшов товар»
    (`inventory:receive`) opens «Прийшов товар» with this model chosen and
    «← {модель}»; «Виправити залишок» (`inventory:adjust`), where any
    warehouse that may be corrected holds it (active, receiving, not
    «Брак»), a sheet named by the model with a cell a size and such a
    warehouse — its letter, the warehouse and what the system holds — a
    cell an order holds any of held, «Є резерв замовлення — виправити
    залишок можна після його видачі або скасування.» under the cells; a
    tap, the correction form as it was; ⋯ (`inventory:adjust`), a sheet
    named by the model with «Інвентаризація», which opens it with «←
    {модель}»;
  - recorded: the sheet closes, and a stub over the grid says
    «Коригування записано: … облік 3 → 2.» or «Ціну продажу збережено:
    {модель}.»; the grid is read again; a correction whose answer is lost
    closes the sheet too: it is settled from the app's «Незавершене
    коригування», which the sheet would cover (as a debt's write-off);
  - whoever sells only: «Прийшов товар» alone;
  - «Можна продати» is always drawn, «·» under each size where nothing is
    free; a model no warehouse of the store holds now (sold out since
    the search, say) says «Зараз цієї моделі немає на складах магазину.»
    in place of the grid.
- **«Інвентаризація», decided here:** a screen of its own in «Ще» ›
  «Товар», after «Брак», for `inventory:adjust`, «← Ще», or «← {модель}»
  from a model; the warehouses that may be corrected as chips, none
  chosen while there are two or more, the only one chosen and said
  «Склад «…»»; the chosen one's stocktakes as they were, and «Знайшли
  товар, якого немає в списку» (`inventory:receive`) under them, as it
  was; the block's own «Інвентаризація складу» is the screen's title;
  with no warehouse that may be corrected, «Немає складу, де цей магазин
  може виправляти залишки. Зверніться до менеджера.»; «Повернутися до
  залишків» after a finished stocktake keeps its words (the TZ moves the
  screen as it is) and leads back to «Інвентаризація».
- **After the independent review, decided here (2026-11-01):**
  - a model's name tapped while a new search is still read opens it by
    the search its tag was found by, not the one typed since;
  - the sizes' order, for whoever may not read the organization's: the
    listings' own, merged — the selling one first (the server lists a
    model's rows by size, then warehouse), a size only another warehouse
    holds before the first size that follows it there;
  - a model with no rows says nothing of its price: «Ціна продажу …» is
    drawn with them, «Змінити ціну» stays;
  - the focus stays on «Продаж», marked all along, on the way to the
    model's detail, back, and to and from what it opens — as on «Ще»,
    «Сьогодні» and «Гроші»;
  - a kept correction or count, once settled, has the till's search read
    again too;
  - while a correction or a count waits, the model's «Прийшов товар» and
    «Виправити залишок» wait too, as «Ще»'s rows do; a price being saved
    keeps its sheet open until it is answered;
  - «Інвентаризація» needs `inventory:view` too, as it reads the warehouse
    it counts: whoever may correct the stock but not read it has no row,
    and a kept count does not open it for them;
  - a count belongs to its warehouse: the only warehouse gone and another
    the only one now, the count is not drawn on it;
  - the till's price hint names the place as it is now, as the owner
    chose after #142: «Ціни продажу ще немає — впишіть домовлену. Ціну для
    всіх задає менеджер: «Продаж» › назва моделі › «Змінити ціну».» (a
    manager with no till still sets it in «Залишки»).
- **For the owner:** a model held only on a warehouse paused or not sold
  from, or only in «Брак», is not on the till's search, so its detail is
  not reached: if no, it is read where it sells again, «Брак» in its own
  section; past stocktakes are read on «Інвентаризація», so whoever reads
  the stock but may not correct it no longer sees them (under «Залишки»
  they did): if no, they are a manager's; nor does anyone see the
  stocktakes of a warehouse paused, not received into, or «Брак»
  («Інвентаризація» offers only warehouses that may be corrected; under
  «Залишки» any warehouse's were read): if no, they wait until it may be
  corrected again; the price hint's new words; «Повернутися до залишків» on
  «Інвентаризація» — its words wait for stage 2; «Можна продати», «з них у резерві», «Разом», «?», «Ціна
  продажу …», «Змінити ціну», «← Продаж» on the model, «Інвентаризація»
  as a row and a title, «Склад «…»», «Зараз цієї моделі немає на складах
  магазину.», «Немає складу, де цей магазин може виправляти залишки.
  Зверніться до менеджера.».

## Chosen in chat — 2026-11-03 («Прийшов товар»; sections P1-4)

Chosen in chat on 2026-11-03 («Yes, start P1-4»), after #165: the sections
task list's P1-4 (S24) (`all-on-the-tag-receive-report.md`). The design's
Q-6 stays «if no»: no «Питали в чатах», no tag on «Сьогодні». No right, no
server rule and no figure changes: a delivery is still one record of every
line, one note and one `command_id`, with the supplier only when owed; a
changed list or another supplier is another delivery, as before.
- **The screen, decided here:** «Прийшов товар» heads it (was «Приймання
  товару»), «← Ще» or «← {модель}» as before; the hint «Оберіть склад, куди
  фізично надійшов товар…» goes, the chips say it.
- **The warehouse, decided here:** only those that take deliveries here —
  active, received into, not «Брак» — as chips, none chosen while there are
  two or more, the only one chosen and said «Склад «…»»; a paused one, one
  not received into and «Брак» are no longer listed (they were, greyed,
  with why); none, «Немає складу, куди цей магазин може приймати товар.
  Зверніться до менеджера.» as before.
- **The model, decided here:** the catalogue's search as before until one
  is chosen; then its name and «Змінити» (read «Змінити модель {назва}»),
  which clears what was counted of it and its price, and gives the search
  back, the cursor in it; the cursor goes to the name once chosen. From a
  model's detail it is chosen already. Its selling price as before, in one
  row with «Задати ціну продажу» / «Змінити ціну продажу» (words kept).
- **The sizes, decided here:** the organization's, a stepper each, two to a
  row: the code at 24, «−» and «+» at 44, the count between them, which may
  also be typed (thirty of a size are not thirty taps) — digits only, at
  most 10000; a light tap felt on «+»; a code longer than three stands
  over its stepper.
- **How it came, decided here:** one row, «Закупівля · ціна не вказана ›»,
  then the price «1 850,50 грн за шт.», the supplier's name once one is
  chosen for goods owed, and the note; it opens the sheet «Як надійшов»:
  the kinds as chips, for `supplier:debt` only; «Закупівельна ціна за шт.,
  грн (необов’язково)», or «Домовлена ціна за шт., грн» with «обов’язково»
  in it for goods owed; the supplier and the approved line «Позичене й під
  реалізацію сплачують…» while this kind or any listed line is owed; «Примітка
  (накладна, постачальник)»; «Готово». Closed any way, it keeps what was
  typed; Telegram's MainButton is put away under it.
- **«Додати ще модель», decided here:** the counted sizes go into «У
  поставці» (rows «2 шт. · Закупівля · 1 850,50 грн за шт.» and «Прибрати
  {модель}», a list as before), the model, its counts and its price are
  cleared and the search takes the cursor; the kind, the supplier and the
  note stay. Held while nothing of the model is counted. The checks are
  the old ones in the old words (the price's form, the agreed price, a
  line already listed); past the server's 200 lines, new words: «В одній
  поставці — до 200 рядків. Запишіть цю, а решту прийміть окремою
  поставкою.».
- **Recording, decided here:** «2 шт. · склад «Каса-склад»» under it (meta,
  600; «2 шт.» with none chosen), «Закупівельна вартість» and «Рядків без
  ціни» for the listed lines as before; Telegram's MainButton «Записати
  прихід · N шт.» — what is listed and what is counted — held at 0, with
  no warehouse, while blocked or sending, turning while sent; outside
  Telegram, the dock's one button. Pressed, what is counted joins the list
  and the whole list goes as one delivery; refused, the list is kept and
  sent again is the same delivery; recorded, «success» is felt. Telegram
  asks before Бірка closes while anything is counted or listed.
- **Recorded, decided here:** the heading «Прийшло 5 шт. · склад
  «Каса-склад» · Закупівля» with the check, the cursor on it — the kinds
  joined «, » when the delivery holds more than one; the recorded stub
  with a line a lot, «Лоран шоколад · M», «+5 · тепер на складі 40 · 1
  850,50 грн за шт.», and «Закупівельна вартість …»; «Прийняти ще» keeps
  the warehouse, the kind, the supplier, the model and its price, as
  before. «од.» is «шт.» on every line of the screen.
- **The hot path:** a model in two sizes, «M 2, L 1», from the screen: a
  warehouse, the search's field, «Знайти», the model, three «+», the
  button — 8 taps (7 with one warehouse); it was 14.
- **After the independent review, decided here (2026-11-03):**
  - the warehouses and the sizes, read again and refused (back from
    another chat on a poor line), stay as they were read: what is counted
    and the warehouse chosen stay in sight, since the button records them;
    «Повторити завантаження» only where nothing was read;
  - a price that is not money: «Готово» says «Закупівельну ціну вкажіть у
    гривнях, до копійок, наприклад 1850,50.» in the sheet and keeps it open;
    closed another way, the row says «ціна з помилкою»;
  - «−» at 0 and «+» at 10000 are held, not disabled, so the cursor stays
    on them;
  - «Прибрати» is read with its line's size (and price): a model's sizes
    are lines of their own; the row is read «Як надійшов: …»;
  - a new supplier being typed is kept while the sheet is closed;
  - a kept delivery proven recorded by the app's check opens «Прийшов
    товар» afresh: its list, edited, would have been recorded again (as on
    the screen before);
  - a line taken out, or another warehouse chosen, clears what was said.
- **For the owner:** «Закупівельна ціна за шт., грн (необов’язково)» (the
  TZ marks it for approval); «Прийшло N шт. · склад «…» · {вид}»; «Записати
  прихід · N шт.»; «Додати ще модель»; «У поставці»; «Змінити»; «Готово»;
  «ціна з помилкою»; «шт.» for «од.»; the 200 lines' words; a count typed
  as well as stepped; paused, not-received-into and «Брак» warehouses no
  longer listed with why: if no to any, as the TZ says or as it was.

## Chosen in chat — 2026-11-03 («Каса»: the count, its result, the drawer; sections P1-2, P1-3, P1-1)

Chosen in chat on 2026-11-03 («Yes, start «Каса»»), after #166: the
sections task list's P1-2, P1-3 and P1-1 as one task (S25–S28)
(`all-on-the-tag-cash-report.md`). The design's questions stay «if no». No
right, no server rule and no figure changes: the count is still blind
(G32), one close a day, its moment «Так, закрити» (G31), the newest close
it names (`after_close_id`); the reason is still only the closer's (G12)
and holds every other tab as before; every figure on the result is the
server's. The approved words of «Каса» (2026-10-21/22) stay, where the
spec's differ: «Видано й внесено після закриття», «Чому не збігається?
(обов’язково)», «Поки причину не записано, інші розділи недоступні.»,
«Причину записано. Власник отримає повідомлення.», no «День зав’язано».
- **The count (S26), decided here:** a task's screen — the menu steps
  aside while it stands, the phone is kept upright, and Telegram asks
  before Бірка closes while a sum is typed. Under «Підрахунок каси» the
  line «{Магазин} · {Ім’я} · 20:06», the phone's time, read again each
  minute. The approved reminders as they were («Спершу запишіть видане з
  каси ›» a line that opens the sheet below); the question «Скільки
  готівки в касі зараз» over the app's keypad (`Keypad`, spec §6.25): the
  phone's keyboard never opens, a computer's still types; a key that would
  make it not money does nothing, so «Вкажіть суму з точністю до копійок.»
  is never said here. The dock holds the question, the keypad's display
  with the sum (56) and «Закрити касу», held until a figure is typed (0 is
  one). «Впишіть суму» / «У касі 2 000,00 грн» (approved 2026-10-21) are no
  longer said: the display shows the sum, the confirmation says it with
  «грн», and at 360 × 640 the line would push the dock over the reminders.
  There the keys come down to 44 (60 elsewhere), the screen on the page
  itself, not in a card.
- **The confirmation (S27), decided here:** «Закрити касу» opens a sheet
  named «Закрити касу: у касі 5 260,00 грн?» — «Закрити касу: у касі»,
  the sum large with its «?», «Змінити потім не можна.», the app's
  «Скасувати», and Telegram's MainButton «Так, закрити» (turning while the
  server answers; outside Telegram, the sheet's own button). A tap sooner
  than 0.7 s after it opened is let go, and a key held from «Закрити
  касу» too; «Скасувати», «Назад», the scrim or Escape close it, the sum
  kept, the cursor back on «Закрити касу». Refused: the sheet goes, why is
  said over the dock, the sum kept; unknown: «Каса» holds it in its banner
  as before; recorded: the result.
- **The result (S28), decided here:** the check in its eyelet and «Касу
  закрито» (or «Перший підрахунок записано»); the stub (spec §6.30):
  «Мало бути» and «Порахували» (`money-l`), the sticker «Нестача X» or
  «Надлишок X» (`warning`, the triangle) or «Збіглося до копійки» (the
  accent, the knot) — the first count one figure and «З цієї суми почнемо
  наступного разу.»; a perforation; the card's and the transfer's rows as
  they were, «… · звірте з чеком терміналу». The stub's eyelet is knotted
  once nothing is owed — no difference to explain, or its reason written —
  filled while a reason is owed. The owner's period figures under it as
  they were. A close read in «Закриття» keeps its card: the stub is the
  close just made.
- **The reason, decided here:** the approved question; the three quick
  reasons as chips, the one in the field pressed; the field; «Поки
  причину не записано, інші розділи недоступні.»; Telegram's MainButton
  «Записати причину» (held while the field is empty, turning while it is
  sent; outside Telegram, the dock's button). «← Каса» stays while it is
  owed (approved). Written: «Причину записано. …» as before, the stub
  knots, «success» is felt, «Готово». The difference shown is felt as a
  warning, as before.
- **«Каса» (S25), decided here:** «Закрити касу» / «Перший підрахунок» is
  the ink tag (spec §6.11): the tag's cut corners, dark in both themes,
  its edge, an eyelet ring, the title in the thread's lime, the line
  under it; the whole tag one button. The rows as before, in their order,
  a chevron each. «Видати з каси» and «Внести в касу» open a sheet with
  what the screen had — the kinds as chips, the sum, the note, «Коли?»
  for whoever corrects — and the app's button «Видати 150,00 грн» /
  «Внести …» under it (never the MainButton: it moves money). From the
  count, the sheet stands over the count, its sum kept. Recorded: the
  sheet goes and «Записано: …» is said where it was opened; refused: why,
  in the sheet, what was typed kept; unknown: the sheet stays with
  «Каса»'s banner in it, what was typed kept, and goes once it is
  confirmed. «Видано й внесено після закриття» and its rows as before.
- **Decided while building:** «Каса», the count and the result stand on
  the page itself, not in a card, as the other redesigned sections; the
  ink tag is 112 high at least, its rows 64 with a chevron of 16 in
  pencil. While the cash is counted «Змінити магазин» is held too, as
  while a payment's form stands: «←» is the way out. The difference's
  sticker is the stub's figure, at 20 rather than a status sticker's 14.
  Inside Telegram, where the MainButton writes the reason, «Поки причину
  не записано, …» stands as a line, with no dock under it. A reason owed
  that comes while «Видати з каси» or «Внести в касу» is open does not
  open its result over the sheet (G12: «Каса»'s own tasks are never
  held); a sheet goes with the screen it stood over.
- **After the independent review (2026-11-03):** a reason owed that came
  while a sheet stood opens its result once the sheet goes, as it would
  have on «Каса». A refusal of «Закрити касу» is said in the dock over the
  keypad, never under it at 360 × 640. While cash taken out is recorded
  over the count, the count stays behind it whatever the drawer's read
  says, its sum kept, and while the drawer is read again it waits for
  that read; the sheet gone and the drawer still unread, or the count no
  longer due, the count is left as before (G26). The count opens
  with the cursor on its title; a sheet closing on a button that waits
  for its answer gives it to the screen's title. The ink tag's focus ring
  is drawn over its face in the thread's lime.

## Chosen in chat — 2026-11-04 (search on «Сьогодні»; frame P2-2)

Chosen in chat on 2026-11-04 («Yes, start P2-2»), after #167: the frame
task list's P2-2 (`all-on-the-tag-today-search-report.md`). The design's
questions stay «if no». No right, no server rule and no figure changes:
each group is read with the request and the right its own section reads
it by, in the store open in Бірка only (the TZ's deviation: no «№», К15);
every figure is the server's.
- **The field, decided here:** the app's search field (spec §6.6), named
  and placeholdered «Модель, покупець або ТТН», under «Сьогодні»'s title
  line and over the day-tag (S04 #3), for whoever has one of the groups'
  rights in the open store — none, no field, «Сьогодні» as before. Under
  two letters nothing is searched; from two, ≈ 300 ms after the last key
  (Enter at once), the groups stand where the day-tag and «Чекає на вас»
  stood; «×» or fewer than two letters brings those back.
- **The groups, decided here:** in the TZ's order, each under its heading
  as «Чекає на вас» is headed, shown while it is read, failed or found
  something:
  - «Товар» (`inventory:view`): `/catalog/stock-options` of every
    warehouse the store sells from, by the till's own matching; a row a
    model, in the server's order — its name, and under it what is free by
    size, «S 2 · M 1», the store's warehouses summed and held units not
    counted, or «Усе в резерві»; a model whose rows may go on past the
    page's hundred is not shown (no number made up). It opens the model's
    detail (S23), read by what found it.
  - «Покупці» (`sale:credit`): `/credits/customers` with no status, as the
    customer's card reads them; «Покупці»'s own rows. An erased customer
    has neither name nor phone to be found by, and is not shown. It opens
    the customer's card (S20).
  - «Замовлення» (`sale:view`): `/orders?waybill=`, asked only while what
    is typed can be a waybill — Latin letters and digits, spaces or
    hyphens between, at least one digit, 64 at most — since the server
    keeps a waybill's letters and digits alone, and any other text would
    match every order. A row: the card's title, «Нова пошта · ТТН … ·
    Відправлено»; never its sum, its way of payment nor its id (G32, В1).
    It opens the order's card (S17) in «Замовлення».
  - Each group five at most; more found: «Знайдено більше — уточніть
    пошук.» under it. Read: grey rows in its place, never a spinner, never
    an earlier search's rows. Failed: why and «Спробувати ще раз» in its
    place, the others standing. Every group asked answered with nothing:
    «Нічого не знайшли за «…»», what was typed in it.
- **Opening a result, decided here:** the keyboard goes; held while a kept
  operation holds «Сьогодні»'s verbs. The model's detail and the
  customer's card say «← Сьогодні» and go back there (what the detail
  opens comes back to it as before); the order's card keeps «← До
  замовлень», as the parcels' verb opens «Замовлення». The menu marks
  what a result opened as a tag's verb does: the model «Продаж», the card
  «Ще», the order «Замовлення»; the cursor on the menu's «Сьогодні», on
  «Замовлення» for an order. What was typed is kept while «Сьогодні» or
  what a result opened stands — back there, the field and its groups as
  left — and forgotten anywhere else, so «Сьогодні» opens on the day. A
  card with nothing left to show goes to «Покупці»'s list as before, with
  what was done said, «← Сьогодні» over it.
- **After the independent review (2026-11-04):** what Enter searched
  stands while more is typed, until the next pause — never the day nor an
  earlier search in between. What a reader hears — «Шукаємо…», or that
  nothing was found — is said in one line that stands from the start.
  Each group is read afresh whenever it is shown again, nothing read before
  shown meanwhile: what a row opened may have changed it. «Повернути» on
  a toast while searched brings the tag back unseen, the cursor staying by
  the search. What is typed is «Сьогодні»'s own until a row opens, the app
  keeping it then. Recorded, left as built: with only «Замовлення»'s right
  and text that can be no waybill, nothing is asked, and «Нічого не
  знайшли за «…»» says so; a single model in more than a page's hundred
  rows shows «Знайдено більше» alone; a model opened in a store that does
  not trade marks «Ще», as the till's own does there; «Ще»'s other store
  forgets the search, as any section does. P0-6's reading of two tags on
  the first screen, open since P0-6, is not changed by the field: still
  an owner's reading.

## Chosen in chat — 2026-11-05 (stage 2: the suppliers' pages, the plates said at once, every journal's kept stub; money P0-7, orders-paper P0-2, P0-1)

Chosen in chat on 2026-11-05 («Yes, start that»), after the stage-2 audit
on #168: the money and suppliers task list's P0-7, and the orders and paper
task list's P0-2 and P0-1 (`all-on-the-tag-stage2-foundations-report.md`).
The owner's questions stand by their (а): В-ЗП2 (а). No right, no server
rule and no figure changes; no words change but the kept journals' titles
and «… записано один раз» (В-ЗП2 (а)).

- **The suppliers' lists page by page (money P0-7, a defect):** «Показати
  ще» on «Накладні», on the returns to suppliers and on «Позичене й під
  реалізацію» reads the twenty after those read, by offset — never one
  longer page: the server takes fifty at most, so the third press was
  refused and the list gave way to the refusal. Each row once, by its id:
  a row the page's edge moved past is not shown twice. A page that fails
  says why under the rows read, which stand, and «Показати ще» reads it
  again. A filter changed (the supplier, still owed, on hand, other
  stores) reads from the first page; a filter come back to shows what was
  read under it while it is read again, as «Закриття» does (review).
- **The plates said at once (orders-paper P0-2):** a refusal, or what was
  typed wrong — every `role="alert"` — in the error's colours with the
  crossed circle, 4 px corners, 12 px padding; never the debt's colours,
  which are customers' debts alone. A warning said at once — a `.notice`
  with the alert's role: what could not be read with «Спробувати ще раз»,
  «Каса»'s server that does not answer, a name the catalogue already has, a
  merge not possible yet — in the warning's colours with the triangle, its
  words ink. Decided here: both drawn by the base style and `.notice`, not
  by new kinds of `Banner` (a status's role, where these are said at once),
  so every alert of the screens the parallel task lists redraw changes with
  them. The sticker «failed» in the error's colours with its circle.
  «Доступу ще немає», the body of the blank tag, takes no glyph.
  - The phone's memory unread, one journal or several: one plate, each
    journal's own sentence a line in it — the catalogue's two, the
    suppliers' two, the stores', «Каса»'s, an order's step, the sale, and
    after them a delivery, a return, a payment, a correction and a count,
    which stood as plates of their own (review: joined).
  - A store that does not trade: the «blocked» banner with a status's
    role, its words as they were — never a refusal's plate (review).
- **Every journal's kept operation is the sale's stub (orders-paper P0-1;
  В-ЗП2 (а)):** a delivery, a stock correction, a stocktake's count, an
  order's step and «Каса»'s command: on its own screen its stub still
  attached, «Ще не підтверджено» on it, the title, its own body as before,
  the phone's line (`keptText`; `keptCashText` for «Каса» and an order's
  step), the check line and the quiet check; over any other screen the
  kept banner with the same words. The title stands while it is checked:
  the ring on the check line says so, never «Перевіряємо …».
  - Its own screens, decided here: a delivery «Прийшов товар»; a
    correction wherever «Виправити залишок» is made — the model's detail,
    «Залишки», «Інвентаризація»; a count «Інвентаризація»; an order's step
    «Замовлення» and «Нове замовлення»; «Каса»'s, «Каса»'s screens, and
    nowhere else, as before.
  - Titles: «Приймання ще не підтверджено», «Коригування ще не
    підтверджено», «Підрахунок ще не підтверджено»; an order's step and
    «Каса»'s as they were.
  - Confirmed: torn off on its own screen, the recorded banner over any
    other, with «Зрозуміло»: «Приймання записано один раз» (new);
    «Коригування записано один раз» over «Облік 3 → 2.»; «Підрахунок
    записано один раз» over «Облік 3 → 2.» or «Збігається з обліком (3).»
    — the TZ's sentence a title and what it was, as the sale's settled
    stub says it. An order's step and «Каса»'s say it as they did. An
    order's step answered whose order could not be read is recorded: the
    stub torn off, or the recorded banner, «Операцію «…» записано», its
    line, the check line and «Оновити результат».
  - A first send, decided here: a delivery's press turns its own ring, so
    its stub stands only once its answer is lost, as the sale's; a
    correction's and a count's stub stands from the press, as built — the
    correction's sheet stays over it with its press until the answer, and
    steps aside once it is lost or recorded.
  - Felt: «warning» as it is first kept (as built); «success» as a kept
    delivery, correction, count or «Каса»'s command is confirmed; an
    order's step as it did. A close confirmed later is felt as one
    answered at once — a difference, short or over, a «warning» — which
    replaces «none for one kept and confirmed later» (the close's rule of
    2026-10-21) by the TZ's «success при подтверждении».
  - Telegram asks before Бірка closes while a delivery, a correction, a
    count, an order's step not yet answered or «Каса»'s command is kept,
    as for the sale; not for a step answered (it is recorded).
  - Recorded, left as built: a kept sale, return or payment confirmed later
    buzzes nothing, and a kept return or payment does not ask before
    closing — not in this task list.

## Chosen in chat — 2026-11-05 (stage 2 quick wins: goods P1-5, P2-1, P2-2, P2-3; orders-paper P1-4, P2-3; admin P1-1, P1-2; money P1-2, P2-1, P2-2)

Chosen in chat on 2026-11-05 («Quick wins first»), after #169: the small
points of the four stage-2 task lists, with the done key on the new
order's price and the delivery's waybill, and «Прийшов товар» on the
borrowed goods (`all-on-the-tag-stage2-quick-wins-report.md`). The
owner's questions stand by their (а): В-ЗП4, В6, В8. No right, no
server rule and no figure changes: words, marks and how a choice is drawn.

- **No rule said (goods P1-5):** whoever lacks a right is never told of
  it, nor who has it; what they cannot do is simply not offered.
  - «Перевірка каталогу» is shown with `catalog:confirm` alone; a tab
    left there when the right goes opens «Ще» (or the first section
    shown, with no «Ще»), never «Немає доступу…». Decided here.
  - «Початкові залишки»: whoever may not take stock in reads the lines
    with no «Розібрати рядок» and no sentence of the right; the decision
    line to whoever may not approve: «Відхилити його можете й ви.».
  - «Моделі»: a name another model has — «Така назва вже є в іншої
    моделі.», not who may join them; «Об’єднати з іншою» is not shown
    without the right, and nothing in its place.
  - «Інвентаризація» with no warehouse it may count: «Тут немає складу
    для інвентаризації.». Decided here, by it (review): «Прийшов товар»
    with none it may receive into, «Тут немає складу для приймання.»;
    «Залишки» with none it may read, «Тут немає складів.».
  - A catalogue operation kept on the phone when the right goes, decided
    here (review): its screen stays while it is kept — only there is it
    checked — with its retry and the server's refusal; answered, «Ще».
  - Left, recorded: the phone's-memory sentences, «Некоректне збережене
    … Зверніться до менеджера.», one family across every journal, of a
    damaged record, not a right; the till's «Доступних складів немає.
    Зверніться до менеджера.», outside this task list.
  - «Перевірка каталогу» with no candidates: «… створіть товар або
    відхиліть…» to whoever may create one; «Перевірте опис або відхиліть
    пропозицію з поясненням.» to whoever may not. Decided here.
- **One word for pieces, «шт.» (goods P2-1, money P2-2; В6 (а)):**
  «од.», «одиниць» and a bare «шт» become «шт.» on «Інвентаризація»,
  «Виправити залишок», «Початкові залишки», «Звіт про продажі»
  (sales and returns), «Позичене й під реалізацію» and the returns to
  suppliers. «Вкажіть, скільки штук.» and «Скільки, шт.» on a lot.
  «з «Брак»» becomes «з «Браку»» on a return to a supplier. Left as they
  are, recorded: the stores' «од.» on «Магазини» and «одиниць» in
  sentences the goods task list does not name.
- **The shop's words (goods P2-2):**
  - a name's answer: the legend «Цей опис — назва товару?», the buttons
    «Так, це його назва» and «Ні, не про нього»; saved, «Збережено:
    «{опис}» — назва {модель}.», or «— не назва {модель}.» for the
    model it is not — the description as read before the answer, spaces
    as one. «Ні, не про нього» answers for the model chosen in «Товар,
    якому ця назва не відповідає», as built, until goods P1-1 puts both
    buttons under the one question. «свідчення» no longer said: «зберігати
    відповідь ще раз не потрібно» in a conflict, «Опис задовгий для назви:
    назва — до 200 символів.». Decided here (review). Decided here: «Збережено.» alone when the proposal or the
    model's name is no longer read. «Автоматичне підтвердження назв
    вимкнене.» is no longer said.
  - «Старі продажі зберігають назву…», «…у «Прийшов товар» і пошуку»
    on «Моделі»; the catalogue's search «Назва моделі або колір».
  - «Спробувати ще раз» for every read that failed on the goods
    screens too («Залишки», «Прийшов товар», «Інвентаризація», «Моделі»,
    «Перевірка каталогу», the price). Decided here, with orders-paper
    P2-3.
- **«Товар і каталог»'s mark (goods P2-3):** its rows in «Ще» —
  «Перевірка каталогу», «Початкові залишки», «Моделі» — and the lists'
  line on «Сьогодні» take the catalogue's mark; «paper» is the paper
  mode's alone.
- **«Нове замовлення» in words (orders-paper P1-4; В-ЗП4 (а)):** the
  header's verb is «+ Нове замовлення», a text button beside the title.
  Decided here: no padding and an 8 px gap, so «Замовлення» and the verb
  hold one row at 360 px in the app's face; in the device's face, or with
  larger text, the verb goes under the title, whole, and the title's word
  is never broken (review). No orders yet: the large tag
  drawn, «Замовлень ще немає.» a row, what an order does its meta,
  «Нове замовлення» a quiet button.
- **The keyboard's «Готово» (orders-paper P0-5, P1-1):** the new
  order's price and the delivery's waybill take `enterkeyhint="done"`;
  Enter puts the keyboard away and sends nothing.
- **«Спробувати ще раз» (orders-paper P2-3):** in place of «Повторити
  завантаження» wherever a read failed.
- **A store that does not trade, to its own people (admin P1-1):** one
  blank tag under the store's line: «Магазин заблоковано власником з …»
  or «Магазин закрито, в архіві з …» its title, «Продажі, приймання,
  повернення й оплати тут зупинено. Зверніться до власника.» said as a
  status, and «Спробувати ще раз», which reads the store again.
- **The price's two (admin P1-2):** «Для всіх магазинів» and «Лише
  «{магазин}»» as two segments of one switch, pressed or not, never a
  list's wheel; the shared price first, as before, whenever this store
  has none of its own and the person may change the shared one. A long
  store name is cut with «…» in its segment. Whoever may change only this
  store's price: «Ця ціна діятиме лише в магазині «…».», and nothing of
  the shared price they may not change.
- **«Закриття» (money P1-2):** what a close came to is a sticker:
  «Збіглося» with the knot, a shortage or a surplus with the triangle,
  «Перший підрахунок» and «Не закрито» with no sign. Each close's row
  has the eyelet at its left: tied, or a ring in the warning's colour
  while its reason waits for whoever counted; a day not closed has none.
  The ring's colour decided here. A close opened from «Закриття» stays a
  card (В8 (а)).
- **«Змінити спосіб оплати» (money P2-1):** the way an operation was paid
  is the sale stub's sticker, its glyph centred beside its words wherever
  it stands (review): «Зараз: Готівка · виправлено» on the operation,
  «Картка · виправлено» on its row. The days are «Надійшло»'s switch of
  modes, pressed or not.
- **«Прийшов товар» (money):** the borrowed goods' and the lots' words
  name the section by its name, not «Прийняти товар».

## Chosen in chat — 2026-11-05 (stage 2 batch 2: the suppliers' and invoices' kept operations, one paper banner, one paper sample; money P0-6, orders-paper P0-3, P0-4)

Chosen in chat on 2026-11-05 («merged, go next»), after #170: the second
batch proposed after #169 (`all-on-the-tag-stage2-kept-and-paper-report.md`).
The owner's questions stand by their (а): money В1, orders-paper В-ЗП1,
В-ЗП5. No right, no server rule, no paper rule (ADR-0013, ADR-0021,
G1–G26) and no figure changes: where the words stand and how they are
drawn.

- **The suppliers' and the invoices' kept operations (money P0-6; В1 (а)):**
  as every kept operation since P0-2 — the stub still attached on its own
  screen, «Ще не підтверджено» on it; a banner over any other.
  - Its own screen: «Накладні» for an invoice, a payment, a set-off and a
    write-off; «Постачальникам» for borrowed goods marked sold
    («Позичене й під реалізацію» is there) and for a return to a
    supplier. Telegram reopening the app on a kept one opens that screen;
    its row in «Ще» stays open to it while every other screen's is held,
    its forms held too (review). Whoever may no longer send goods back to
    a supplier has a kept «Продано» on «Накладні». Decided here.
  - Its words: «{Накладну | Оплату | Залік | Списання | Продаж
    позиченого | Повернення постачальнику} ще не підтверджено»;
    «Невідомо, чи записано {оплату}. Перевірте результат — та сама
    операція не запишеться двічі.» (a return: «… те саме повернення не
    запишеться двічі.»); «Чекає відповіді сервера з 11:42.»; the button
    «Перевірити результат {оплати}». Decided here, in the sale's
    pattern.
  - Checked by its button alone (G11, as built): nothing says «Перевіряємо
    кожні 20 с», the ring turns only while the pressed check is asked,
    and the button is the stub's own, not a quiet one. A check answered
    by no answer adds nothing under it: the stub says since when it
    waits, and nothing of selling on paper, which is the till's. A check
    pressed on one never moves «остання перевірка» of what the phone
    checks by itself; the journal's own «Спершу завершіть збережену
    операцію з накладною.» is said as the screens said it (review).
  - Confirmed: «{Оплату} записано один раз» with what the screen said of
    it done, and «Зрозуміло»; the screen it was made on is read afresh, its
    form empty. No success buzz and no ask to close, as the sale's kept
    attempt confirmed later. Decided here.
  - Refused, proven to have recorded nothing: in the words its screen
    says it (borrowed goods' as «Позичене й під реалізацію» says them),
    under where the stub stood, while that refusal stands; the till is
    free.
  - «Продаж» stays held while one is kept, as built.
  - Found, not changed (backend follow-up): the suppliers' endpoints never
    say `recorded: false`, so a check the real server refuses is never
    proven to have recorded nothing — it stays kept, with the refusal's
    words under it, until a manager reads it.
- **One paper banner (orders-paper P0-3; В-ЗП1 (а)):** while the server
  does not answer, the owner's sentence (G13) once, at the top of every
  screen of the store, a status named «Сервер не відповідає»; gone with
  the first answer. Each place that could not be read for no answer says
  only «Сервер не відповідає.» and «Спробувати ще раз»; a server's own
  error keeps its words, with «Спробувати ще раз» too — one warning's
  plate wherever a read failed, thirty more places than before (review);
  a next page that failed reads that page again. The sign-in, the crash
  screen and the page before the app keep the whole sentence: no banner
  stands over them. Nor over a store that does not trade, where nothing is
  sold, on paper or not (review). Decided here.
- **One paper sample (orders-paper P0-4; В-ЗП5 (а)):** on the till, a
  return and a debt's payment, four rows:
  - the switch, «Вношу {продаж | повернення | внесок} з паперу»;
  - the series: which paper («Сервер не відповідав», «Перші дні, до
    затвердження залишків») and «Продавець: …» or «Хто прийняв: …»
    («не вказано» when nobody is); until the paper is said, «Оберіть, що
    вносите з паперу» with the warning's triangle, and no name;
  - «З паперу», a sheet the switch turned on opens in the same tap, and
    the series row opens again: which paper (nothing chosen for it — the
    mark is permanent) and «Хто продав» or «Хто прийняв», «Не вказано»
    first and chosen; a list not read says so with «Спробувати ще раз»;
    the app's quiet «Готово», Telegram's «Назад» and the scrim close it,
    and nothing chosen is lost; never a MainButton. «Сервер знову
    відповідає»'s «Вношу продаж з паперу» ticks the switch with the
    outage's paper said, as before, and opens no sheet; so does «Вношу
    продаж з паперу» in «Ще» › «Цей телефон», the till's series then
    saying «Оберіть, що вносите з паперу». Decided here.
  - the paper's time: «Це було вчора», a switch row, and the time; the
    first days' day picked.
  A return and a payment from paper take «Режим: з паперу» at their top
  once the paper is said, with its approved sentence. A series' first
  sale is at most seven taps from the switch, each next one three.
