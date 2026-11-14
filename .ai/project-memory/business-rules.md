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
  says why under the rows read, which stand, and its one «Спробувати ще
  раз» reads it again; «Показати ще» is gone meanwhile, as the report's
  thread has it (money task list after stage 2, P2-1, 2026-11-12). A
  filter changed (the supplier, still owed, on hand, other
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

## Chosen in chat — 2026-11-05 (stage 2 batch 3: «Нове замовлення» in the new system, «Доставка» a sheet, the steps' results; the opening-stock lists by readiness, a warehouse awaiting its stock; orders-paper P0-5, P1-1, P1-3; admin P0-1, P0-2)

Chosen in chat on 2026-11-05 («Orders + first days»), after #171: the
third batch proposed after #171. The owner's questions stand by their
(а): orders-paper В-ЗП3, В-ЗП6; admin В-А1, В-А2. No right, no server
rule and no figure changes: where things stand, how they are drawn, and
who is told of a list. The one server change closes what batch 2 found.

- **«Нове замовлення» (orders-paper P0-5; В-ЗП3 (а), В-ЗП6 (а)):** a task
  screen, the menu stepping aside, as the till's count and a payment.
  - Its head: «Нове замовлення», «← До замовлень» (Telegram's «Назад»
    too); with one warehouse the line under it says «Склад: {назва} ·
    {Ім’я}» in place of the store, otherwise the store's line, as on every
    screen.
  - The search and the cells as the till's: a cell tapped puts one coat in
    the order from that cell's warehouse, puts the keyboard away, a light
    buzz. A model with no price opens the sheet by itself, the cursor in
    its empty price.
  - The tray «У замовленні · N», «{Модель} · {розмір}» and «›», over it
    «Разом» or a dash while a line has no price; its sheet «У
    замовленні»: each line «{Модель} · {розмір}», «Склад: {назва}», «−»
    and «+» to what is free, «Ціна, грн» with the price's hint, «Прибрати
    {Модель} · {розмір}» (and «· {склад}» with two warehouses), «Готово».
    The keyboard's «Готово» in a price puts it away and closes the sheet,
    as the till's basket does. The last line taken out closes the sheet
    and the tray, the cursor back in the search. Decided here.
  - Where it goes: one row of four chips, «Нова пошта · Укрпошта · Міст ·
    За кордон», nothing chosen for the seller; the chosen one in the
    chosen colours, a choice's buzz; under it one line, «ТТН впишете, коли
    відправите.» or, abroad, «Куди і як відправили — впишете, коли
    відправите.». The row has no visible caption, only its name «Куди»
    for a reader, to keep the phone's height. The chips wrap to a second
    row on a narrow phone. Decided here.
  - Telegram's MainButton «Замовити та зарезервувати», set as the screen
    opens and held until a line has its price; «Оберіть перевізника» and
    held without a carrier; its ring while it is sent; taken away on «←».
    Pressed while the sheet is open, the sheet goes and it reserves: what
    the press comes to — a refusal's plate, a kept order's banner — is
    said on the page, never under the sheet; short of stock, the sheet
    opens again on its line (review, 2026-11-05). Outside Telegram the
    dock's one button, in the tray, the same words, shown from the
    screen's first moment, held. Decided here.
  - Refused short of stock: the sheet opens on the line the server names,
    with the approved words, focused; another refusal: the error's plate
    over «Куди», focused, an error buzz; the lines and the carrier kept.
    Kept on the phone: the banner, as before.
  - Telegram asks before closing while the order holds a line (from
    Telegram 6.2), never once it is recorded or emptied.
  - Five taps with the search typed: «Замовлення», «+ Нове замовлення»,
    the cell, the carrier, the MainButton. The body sent is unchanged.
- **«Доставка» a sheet over the card (orders-paper P1-1; В-ЗП3 (а)):** the
  order in its line («{Модель} · {розмір}»), the same row of chips with
  where it goes now chosen, «Номер ТТН» (`autocomplete="off"`, the
  keyboard's «Готово» puts it away) or «Куди і як відправили: місто,
  країна, спосіб» with «Без імен і телефонів покупців.»; a refusal said in
  the sheet over what was typed — the card read again after it, if that
  read fails, says so on the card under the sheet, read again once the
  sheet is closed. Telegram's MainButton «Зберегти доставку»
  in place of the card's, its first 0.7 s let go as before; outside
  Telegram the sheet's own button at its foot. A carrier is a chip, so
  «Оберіть перевізника» stands only for an order that has none. Telegram
  asks before closing while anything was changed; «Назад», Escape and the
  scrim close it, the cursor back on the row that opened it. Saved, the
  sheet closes and the card says «Доставку збережено». «ТТН ще немає —
  вписати» opens it with the cursor in the field: five taps from the menu
  with the typing, the fifth Telegram's MainButton. «← Замовлення» is
  gone. Decided here.
- **The steps' results (orders-paper P1-3):** a reserve recorded is torn
  off over the thread as a stub, «До відправлення» on it, then each line
  «{Модель} · {розмір} · склад «{назва}»» — as «У посилці» names a
  warehouse, never «з «{назва}»», which would decline a name — and
  «Зарезервовано: N шт. Чекає відправлення.»; the same for a kept reserve
  once its check says so. Every other step says its words, as before, in
  one line with a filled eyelet in the step's colour. Decided here.
- **The opening-stock lists by readiness (admin P0-1; В-А1 (а)):** read on
  «Сьогодні» and in «Ще» wherever the person makes or approves them
  (`snapshot:import` or `snapshot:approve`).
  - A list ready to approve: «Затвердьте початкові залишки», «N рядків» or
    «N списки», «Переглянути й затвердити» — only for whoever approves.
  - A list not ready: «Доробіть початкові залишки», «N рядків чекають
    рішення» (its lines unmatched or in doubt, summed over the store's
    lists), «Доробити», to «Початкові залишки» — only for whoever makes
    them. A list with no such line and nothing to put in stock says its
    lines, «12 рядків». Decided here.
  - Ready with only the making, or not ready with only the approving:
    nothing (В-А1 (а)). Another store's list: no verb; a shared
    warehouse's list waits in the store that keeps it, as before.
  - «Ще»: «N на затвердження» (ready, to approve) and «N доробити» (not
    ready, to make), each in the row's colour, joined by «·».
  - The catalogue's mark and the ink's tone, not «paper» as the TZ wrote:
    «paper» is the paper mode's alone since goods P2-3. Decided here.
- **A warehouse awaiting its stock (admin P0-2; В-А2 (а)):** a selling
  warehouse that is active, not «Брак», where nothing was ever recorded,
  with no list in review of it, is a tag for whoever makes the lists in
  the store: «Склад «{назва}» ще чекає початкових залишків» or «N склади
  ще чекають початкових залишків» with their names, then «Поки їх немає,
  продажі тут — на папері»; «Внести залишки» in the open store, to
  «Початкові залишки»; no verb in another store of the day. A warehouse
  two stores share is told once, through the first store of the day that
  sees it, the open one first. Told only once every store's warehouses
  and lists have answered, as the stocktakes are, so a shared one never
  moves between stores as they answer (review, 2026-11-05); a store
  whose lists could not be read tells none of its warehouses. A list
  typed, approved or rejected on «Початкові залишки» is said on
  «Сьогодні» at once: the lists and the warehouses are read again.
  Decided here.
- **The suppliers' refusals say what was not recorded (backend; closes
  batch 2's follow-up):** an invoice, a payment, a set-off, a write-off, a
  return to a supplier and borrowed goods marked sold, refused by a rule
  after the command found what it acts on, say `recorded: false` (ADR-0013
  §1): a kept one the server refuses is settled at once. What is refused
  before the lookup (the body itself) and a command id reused with
  another body keep their answer as before, as every other journal's.

## Chosen in chat — 2026-11-06 (stage 2 batch 4: «Накладні» as tags, the invoice's card and its payment, the supplier's field and its sheet; money P0-1, P0-2, P0-3)

Chosen in chat on 2026-11-06 (««Накладні» batch»), after #172: the fourth
batch proposed after #172. The owner's questions stand by their (а): В3
(the invoices one after another, the newest first, with the supplier's
field and the total) and В9 (no line about «Видати з каси» on the
payment). No right, no server rule, no command and no figure changes:
every sum is the server's, each command goes through the same journal
with the same body; what changes is how the invoices are drawn and
reached.

- **The supplier's field and its sheet (money P0-3):** at all four places
  — «Нова накладна», «Постачальникам» (its filter and the return's form),
  «Прийшов товар»'s «Як надійшов» and «Брак» — the supplier is a field
  «Постачальник» showing «Оберіть ›» or «{Назва} · {телефон} ›», never a
  native list.
  - A tap opens the sheet «Постачальник»: «Пошук постачальника» with the
    cursor in it, every word typed matched in a name or a phone, as the
    till's search; a row a supplier, its phone under it; the one chosen
    marked; a row picked closes the sheet with a choice's buzz, and on
    «Нова накладна» the cursor goes on to «Сума за накладною, грн».
  - «+ Новий постачальник» under the rows, or «+ Новий постачальник
    «{набране}»» when what is typed matches none, which opens the name
    (what was typed already in it) and «Телефон (необов’язково)» in the
    sheet, «Додати постачальника» its foot, a quiet «Скасувати» back to
    the list. A name already on the list is picked, never added: ««{Назва}»
    уже є у списку — обрано його.» under the field. The sheet's title
    stays «Постачальник» while a new one is typed. Decided here.
  - Nothing matching what is typed: «Нічого не знайшли за «{набране}»»
    under the rows, as «Сьогодні»'s search says, for a reader too (from
    the review). The sheet closed, a new supplier begun is forgotten (spec
    §6.29: nothing is remembered) — only «Як надійшов» keeps it; the sheet
    is never closed while «Додати постачальника» waits for its answer
    (from the review).
  - Inside «Як надійшов», a sheet already, the list and its search open
    in place under the field (its chevron turned up), never a sheet over a
    sheet; a new supplier begun is kept while the sheet is closed, as
    before. «Брак» is no sheet, so its field opens the sheet.
  - As a filter («Накладні», «Постачальникам»): the field shows «Усі
    постачальники ›» or the name; its sheet has «Усі постачальники» first
    while nothing is typed, and nothing to add; on «Накладні» each row
    says «винні {сума} · N накладні» from the server's summary, a supplier
    owed nothing nothing under its name; elsewhere its phone. The filter's
    name «Постачальник» is a reader's alone (visually hidden), as the
    search's: «Усі постачальники ›» says what it is, and the total and
    three tags fit over the menu on a 390×844 phone. Decided here.
- **«Накладні» as tags (money P0-1; В3 (а)):**
  - The head: «Накладні», «← Гроші» or «← Ще»; a «+» (read «Записати
    накладну») where the store trades, never on the others' list; «Оновити».
  - «Винні зараз · Усі», the first chosen; the supplier's field; the
    total in ink — «Винні {сума} · N накладні», or with a supplier chosen
    «Винні постачальнику «{Назва}» {сума} · N накладні»: a name is never
    declined, so not the task list's «Винні «Ганні»»; «Нічого не винні» at
    nought — and by it «дані на HH:MM» once five minutes old or a read
    failed. Decided here.
  - Each invoice a row tag, the newest first: its eyelet filled in ink
    while owed, a knot once paid or written off, none once cancelled; the
    supplier, and on the right in ink what is owed, or once closed the sum
    on it; under them «DD.MM · {хто}», then «сплачено X з Y» once anything
    is paid and «зараховано Z» once anything is set off — a line with
    nothing paid says no «сплачено 0,00» (decided here); a closed one its
    sticker with its glyph: «Сплачено повністю» (paid's tone, a check),
    «Залишок списано» (neutral, a minus — decided here), «Скасовано»
    (offline's tone, a cross); then «магазин «{Назва}»» for another
    store's, the borrowed goods it is for, or its note. «Сплатити», the
    tag's one verb, where the store trades and the invoice is owed, opens
    the payment at once; the tag itself opens its card.
  - Under the list «Накладні магазинів, що не працюють ›», where the store
    trades: the same screen of theirs, «← Накладні», no total, no «+».
  - Nothing to show (spec §6.28): the blank mark, the same words as before
    («Зараз магазин нічого не винен постачальникам.» and the others),
    «Кожна накладна — окремий борг: сплачують частинами, без графіка.» and
    a quiet «Записати накладну» in the store's own list where it trades.
  - A store that does not trade has no «Накладні», as before: its rights
    are the reading ones (`asShown`), and `supplier:debt` is none of them;
    its invoices are read and paid from a trading store's «Накладні
    магазинів, що не працюють ›». «Ви винні постачальникам» on its
    «Гроші» is a line with no way in.
  - «Нова накладна», a screen of its own: the supplier's field, nothing
    chosen; «Сума за накладною, грн», «Сплачено одразу, грн» (empty is
    nought, as before), «Примітка (необов’язково)» in one line; the dock's
    own button «Записати накладну», never Telegram's MainButton — it
    records money. Recorded, its stub «Накладну записано»: the sum, «{Назва}
    · {сума}», a perforation, «Залишок X.» or, knotted, «Накладну сплачено
    повністю.»; «Готово» (Telegram's MainButton where it is) to its card.
- **The invoice's card and its payment (money P0-2; В9 (а)):**
  - The card: the supplier its title, «Записано {коли} · {хто} ·
    {примітка}» under it; «Винні» and what is owed large, in ink, the bar
    in the paid colour, «Сплачено X з Y · остання оплата DD.MM» («Сплачено
    0,00 грн з Y» while nothing is paid: on the card the bar says it
    anyway, unlike the tag's line), what was
    set off and written off under it; a closed one its sticker and, once
    cancelled, «DD.MM · {чому} · {хто}», the sum on it. «Історія» as a
    thread: the day, a node filled once recorded, hollow once cancelled
    with its sticker and «DD.MM · {чому} · {хто}»; «{що} {сума}», «{хто} ·
    сплатив магазин «{Назва}» · {примітка}».
  - «Сплатити», Telegram's MainButton, hidden while a sheet is over the
    card; outside Telegram the dock's one button. Only where the store
    trades and the invoice is owed.
  - The payment, a task screen, the menu aside: the supplier its title,
    «← Накладна» from the card or «← Накладні» from the list (decided
    here); what is owed large; the app's keypad «Сума, грн» (never the
    phone's keyboard) with «Увесь залишок {сума}»; more than is owed holds
    the button and says «Це більше, ніж винні: залишок X. Сплатіть не
    більше.» (decided here); «Сплатити {сума}», the dock's own button —
    money is never paid by Telegram's MainButton. Telegram asks before
    Бірка closes while a sum is typed. Recorded: a success buzz, its stub
    «Оплату записано» — the sum, «{Назва} · накладна від DD.MM», «Залишок
    X.» or knotted «Накладну сплачено повністю.» — and «Готово» to the card;
    refused: an error buzz and the words over the keypad, the sum kept, the
    invoice read again; lost: the journal's stub, as before.
  - Behind the ⋯ by the title, a sheet named «Накладна «{Назва}» від
    DD.MM»: «Зарахувати повернення» and «Скасувати накладну» where the
    store trades and the invoice is its own and owed; «Списати залишок»
    for the owner (`supplier:write_off`) — for a store that does not trade,
    the network's owner. «Скасувати накладну» is dark while a payment or a
    set-off on it stands, «Спершу скасуйте її оплати й заліки.» under it.
    No ⋯ for whoever may do none of them.
  - Each in a sheet of its own that asks why: «Списати залишок X?» —
    «Залишок X закриється без оплати. Скасувати це потім не можна.»,
    «Чому списуємо», «Так, списати X»; «Скасувати накладну» —
    «Накладну записано помилково? Вона лишиться в історії як скасована.»,
    «Чому скасовуємо», «Так, скасувати накладну», «Не скасовувати». A line
    of the history that may be cancelled is pressed: «Скасувати: {що}
    {сума}» — «{Що} {сума} записано помилково? Борг зросте на цю суму.»,
    «Так, скасувати», «Не скасовувати». «Зарахувати повернення»: the
    returns of this store to that supplier still standing, each a choice
    («DD.MM · N шт. · склад «{назва}»», «уже зараховано X»), none chosen
    beforehand; «Скільки зарахував постачальник, грн»; «Зарахувати X». The
    sentences of the sheets are decided here.
  - A set-off or a write-off recorded is said over the sum by a filled
    eyelet, as an order's step, not as a stub (decided here). A refused
    set-off is said in its sheet, the return chosen and the sum kept, as a
    refused payment keeps its sum and as before (from the review); a
    refused write-off or cancellation closes its sheet — its sentence
    names a sum or a state that has moved on — and is said on the card;
    either way the invoice is read again. A cancellation unanswered stays
    in its sheet with «Немає відповіді сервера…», pressed again safely, as
    before. Telegram's «Назад» closes a sheet, never the card under it.
  - Paid, «← Накладна» goes to the card as the server answered, as
    «Готово» does, never the card as it was before the payment (from the
    review). An invoice read again after a refusal is shown only on a
    screen that still shows it: an answer that comes once the person has
    gone back never brings the screen back (from the review).
  - For a reader: a line of the history that may be cancelled is read
    «Скасувати: {день} {що} {сума} …»; a tag's «Сплатити» is described by
    the supplier, the sum and the day, so two of one supplier's are told
    apart (from the review).
  - Whatever is recorded, paid, set off, written off or cancelled, the
    list of invoices and the returns are read again at once, the list not
    shown too: a card opened from it on the way back is the invoice as it
    is now, never as the list last saw it (found by the set-off's journey:
    the card came back with the set-off's money still to take). Decided
    here.

## Chosen in chat — 2026-11-06 (stage 2 batch 5: the suppliers' side — «Постачальникам» as rows, «Повернути постачальнику» a task screen, «Позичене й під реалізацію» a screen of tags, the ways between them; money P0-4, P0-5, P1-3)

Chosen in chat on 2026-11-06 («Suppliers' side»), after #173: the fifth
batch proposed after #173. The owner's questions stand by their (а): В2
(«Позичене й під реалізацію» for whoever returns to suppliers, as before;
«Продано» for whoever keeps the invoices) and В7 (a mark of sold opens a
sheet: how many and the price for each before the press). No right, no
server rule, no command and no figure changes: each command goes through
the same journal with the same body; every sum is the server's.

- **«Постачальникам» (money P0-4):**
  - The head: «Постачальникам», «← Ще»; a «+» read «Повернути товар
    постачальнику», held while another command's outcome is unknown, and
    «Оновити». The supplier's field as a filter (P0-3).
  - Each return a row, the newest first: the supplier, on the right «N
    шт.»; «DD.MM · склад «X» · {хто}» or «DD.MM · з «Браку» «X» · {хто}»
    (В6 (а)); its goods, two named — «Кокон графіт, M × 2 · Лоран, S × 1»
    — and «+ ще N»; the stickers «Скасовано» (offline's tone, a cross) and
    «Зараховано {сума}», the sum of the set-offs standing; a chevron. The
    whole row opens the return.
  - Under the rows «Позичене й під реалізацію ›» and «Список
    постачальників ›».
  - Nothing to show (spec §6.28): the blank mark, «Цей магазин ще нічого не
    повертав постачальникам.», or with a supplier chosen «Постачальнику
    «{Назва}» цей магазин ще нічого не повертав.» (decided here: the task
    list names only the first), «Скільки постачальник за нього зарахував,
    записують заліком у «Накладних».», a quiet «Повернути товар
    постачальнику».
- **The return's screen (P0-4):** «← Постачальникам»; the supplier its
  title; «DD.MM, HH:MM · склад «X» · {хто}»; «Скасовано» with «DD.MM ·
  {чому} · {хто}» once cancelled; its goods, its note; «Постачальник
  зарахував {сума} у накладну · DD.MM» for each set-off standing, with
  «Відкрити накладну ›» for whoever keeps the invoices (P1-3). No
  MainButton.
  - The return is read again as the screen opens, by its supplier's
    returns (fifty at most), there being no read of one return: a set-off
    cancelled in «Накладних» meanwhile is gone from it. Decided here.
  - Quiet at the bottom «Скасувати повернення», held while another
    command's outcome is unknown, opens the sheet «Скасувати повернення»:
    «Товар повернеться на склад «X». Скасувати можна лише раз.» — «у
    «Брак» «X»» for a unit from «Брак» (decided here) —, «Чому
    скасовуємо», «Так, скасувати повернення», «Не скасовувати». A unit
    from «Брак» is cancelled through «Брак», as before.
  - Refused, the sheet goes and the words are said on the screen, the
    return read again on a conflict; no answer at all, the words stay in
    the sheet with its reason (decided here). Cancelled, the screen shows
    the server's answer, so a return older than its supplier's fifty
    newest shows its cancel too (from the review).
  - While a set-off stands: «Щоб скасувати повернення, спершу скасуйте
    залік у «Накладних».» in its place (owner decision, 2026-10-01).
- **«Повернути постачальнику» (P0-4), a task screen, the menu aside:**
  - «← Постачальникам», held while the return is sent the first time.
  - The warehouse: one said in a line «Склад «X»»; two or more as chips,
    none chosen beforehand; none, «Тут немає складу, з якого повертають.»
    (decided here). Another warehouse chosen is another return: what was
    counted and listed goes (decided here). Chosen, it stays chosen while
    the warehouses are read again: what was counted is never sent from
    another; one is said in a line only while it is the one (from the
    review).
  - The supplier's field (P0-3); picked, the cursor in the search.
  - «Пошук моделі», the till's: the server's, with the warehouse, from two
    letters; a model a row, its sizes free there under it «M 2 · L 1»;
    «Ще товари» for the next page. Nothing free: «На складі «X» немає
    вільного товару.», or «За «…» на складі «X» вільного товару немає.»
    (decided here). A size an order holds whole is never offered.
  - A model chosen: its name with «Змінити»; its sizes as steppers «− N
    +», two to a row, «вільно N» under each — the most; «+» held there, a
    number typed cut to it. «Додати ще модель» puts the counted sizes in
    «У поверненні», each with «Прибрати».
  - Said under the fields (decided here): «Оберіть постачальника.»; «Такий
    рядок уже в списку. Приберіть його, щоб змінити кількість.» (one model
    and size, one line); «В одному поверненні — до 100 рядків. Поверніть
    ці, а решту — окремим поверненням.»
  - «Примітка (необов’язково)» in one line; «N шт. · склад «X»» over the
    button.
  - Telegram's MainButton «Повернути постачальнику · N шт.» (a return
    moves goods, never money); outside Telegram the dock's one button;
    held at nought. Telegram asks before Бірка closes while anything is
    counted.
  - As it is sent, the sizes counted join «У поверненні»: refused, the
    list is kept, the words over the button, the warehouse read again on a
    conflict (decided here). The words stay while a count changes, as on
    «Прийшов товар»; another supplier, warehouse, model added or line
    taken away clears them.
  - Recorded: a success buzz, «Повернено постачальнику «X»: N шт.» with
    its mark, the stub — each line, «склад «X»» —, «Готово» to
    «Постачальникам».
- **«Список постачальників» (P0-4), a screen:** «← Постачальникам»;
  «Пошук постачальника», every word matched in a name or a phone; a row a
  supplier, its phone under it; «Нічого не знайшли за «…»». A tap opens
  «Змінити постачальника»: «Назва», «Телефон», «Зберегти»; a name the list
  holds already is said, never saved; none is deleted. Nothing on the list:
  «Постачальників ще немає.» and «Нового додають у полі «Постачальник» —
  там, де його обирають.» (decided here).
- **«Позичене й під реалізацію» (P0-5; В2 (а), В7 (а)), a screen:**
  - «← Ще», or «← Постачальникам», or «← Накладна» — wherever it was
    opened from; «Оновити»; «На руках · Усе», the first chosen.
  - Each lot a row tag, the newest first: the eyelet filled while some are
    in hand, a knot once none are; «{модель}, {розмір}», on the right «на
    руках N»; «Позичено у «X» · DD.MM · {склад}» or «Під реалізацію у …»;
    «{ціна} за шт. · взято N · продано N · повернено N». The verb
    «Продано» for whoever keeps the invoices (`supplier:debt`) while some
    are in hand; the tag or its verb opens the lot's sheet; a lot with
    none in hand opens nothing.
  - The sheet: the model and size its title, both lines under it; «На
    руках N» and «− 1 +», from one to all in hand; «Позначити проданим · N
    шт.» (`supplier:debt`; the app's button, never the MainButton — it
    records money) and «{ціна} за шт.» under it, as the server keeps it,
    nothing multiplied; quiet, «Повернути постачальнику · N шт.». Refused,
    the words in the sheet; a conflict reads the lots again, and the sheet
    shows «На руках» as read, the count cut to it (from the review).
  - Recorded, its stub: «Продано N шт.: у «Накладних» борг «X» {сума}.»,
    the server's sum, with «Відкрити накладну ›»; or «Повернено
    постачальнику «X»: N шт.»; «Готово» (Telegram's MainButton where it
    is) to the lots.
  - Nothing to show: «Позиченого на руках немає.» / «Цей магазин нічого не
    позичав.», «Товар інших магазинів і постачальників: сплачують лише
    продане, за домовленою ціною, непродане повертають. Береться через
    «Прийшов товар».»
  - A kept mark of sold, or a kept return of a lot, is «Позичене»'s: its
    stub there, a banner on any other screen (P0-6), so Бірка opens there.
  - «Прийшов товар»: «… Продане чи непродане позначають на екрані
    «Позичене й під реалізацію».»
- **The ways between them (P1-3):**
  - «Ще» › «Гроші»: «Постачальникам», then «Позичене й під реалізацію»
    (glyph `supplier`), for whoever returns to suppliers.
  - A return's set-off → «Відкрити накладну ›» → the invoice's card with
    «← Повернення» (read «Назад до «Повернення»»), back to that return,
    read again (decided here).
  - The sold stub → «Відкрити накладну ›» → the card with «← Позичене й під
    реалізацію».
  - The sold invoice's card → «Позичене й під реалізацію ›» under the
    borrowed goods it is for, for whoever returns to suppliers → the lots
    with «← Накладна», back to that card (decided here).
  - An invoice opened from elsewhere and not found among its supplier's
    fifty newest: that supplier's invoices, every one, not only those owed
    (decided here). Opened with the invoice in hand (the sold stub), it
    shows at once and is read again; that read never replaces a card paid
    or changed meanwhile (from the review).
  - Each way is held as the row of the screen it opens is (P0-6): «Назад
    до «Повернення»», «← Позичене й під реалізацію», «← Постачальникам» and
    «Позичене й під реалізацію ›» while «Постачальникам»'s row is held;
    «Відкрити накладну ›» and «← Накладна» while «Накладні»'s is — held as
    the row is at that moment, not as it was at the tap (from the review).
  - A return opened again on the way back from its invoice is opened once:
    the screen remade later (a kept return checked) opens the list (from
    the review). Back on the list from any of its screens, its heading
    takes the cursor (from the review).

## Chosen in chat — 2026-11-06 (stage 2 batch 6: the return in the new system, here and at another store; «Клієнт забрав» as a stub; «Щось пішло не так» and «Застосунок не завантажився»; orders-paper P0-6, P2-1, P1-2, P1-5, P2-2)

Chosen in chat on 2026-11-06 («Returns + orders' end»), after #174: the
orders-paper task list's last five points. The owner's questions stand by
their (а): В-ЗП6 (the menu steps aside on a return's form, as on «Внесок»
and the cash's count) and В-ЗП7 («Продали ще до Бірки? Покличте менеджера
— таке повернення вирішує він.» also under an empty search in the other
stores). No right, no server rule, no command, no sum and no word of a
return or a sale changes: each command goes through the same journal with
the same body; every sum is the server's.

- **A return's form a task's screen (P0-6, В-ЗП6 (а)):**
  - The menu steps aside while one sale's return is open; «← До списку»
    and Telegram's «Назад» lead back to the list, and the menu comes back
    there. While a return is kept, «← До списку» is held, as before: the
    form is left by the kept banner's check alone.
  - The form's stickers carry their glyphs: «Оплата частинами» the owed
    arrow, «Продано з паперу» / «Продано під час збою» the warning's
    triangle. The sales list's rows stay as built (the task list keeps
    them).
  - A line is a row of 64 at least: «{Модель} · {розмір}» 17/600, its
    price and what may come back in meta. «Цілі» and «Пошкоджені» side by
    side, each its name over «− N +», the buttons 44 square; «Пошкоджені»
    with «Брак»'s torn tag. Each «−» and «+» a light tap in the hand.
  - «Без прокрутки» at 360 × 640 with one line is read as: the person
    scrolls nothing — the line and the panel are whole on the screen once
    a unit is counted. The app bringing the counted tag above the panel
    itself, as before, stays (one plain line: 21 px; paid in parts from
    paper, with both stickers: 138 px). The screen is not squeezed to keep
    the title in view (decided here).
  - The way stays a group of three radios, drawn as §6.7's switch
    (segments on the field, the one chosen a card) and felt as a choice:
    nothing chosen is a state of its own here — the sale's way not read —
    which a mode switch does not have, and a reader hears a choice of
    three. It is not `ModeSwitch`'s buttons (decided here).
  - «В інших магазинах мережі» is the section's caption (13/700, in
    capitals), still a heading; «← У своєму магазині» beside it.
  - Nothing found, here or at the other stores, and no sale yet: §6.28's
    blank tag, the words as they were, «Очистити» under them. What to do
    next — «Купили в іншому магазині мережі? Шукати там», «Продали ще до
    Бірки? …» — under the blank tag, centred with it.
  - A refusal was already the error's plate (batch 1): unchanged.
- **Whose money it is, inside the stub (P2-1):** «Товар куплено в іншому
  магазині мережі — гроші віддаєте ви.» (and its paper's words) is a meta
  line inside the return's stub, under the way's sticker and over the sum;
  confirmed later, the same, with the money under its way.
- **«Клієнт забрав» as a sale's stub (P1-2):**
  - «Продаж записано» with the check in its eyelet, and the stub torn off,
    as the till's receipt: the way's sticker with its glyph (cash, card,
    transfer; «Переказ наперед» and «Накладений платіж» their words
    alone); what to do the line under it — «Проведіть на терміналі»,
    «Перевірте, що переказ надійшов» (the owner's words of 2026-10-23, В2
    (а), split as the till's, none changed); the server's sum large.
  - In parts, «Сплачено зараз» over the sum — heard before, now seen too;
    what is owed the stub's meta.
  - A kept one confirmed later: «Продаж записано один раз», no eyelet's
    check, the way alone, and «Якщо картку ще не провели…» in ink inside
    the stub.
- **«Щось пішло не так» as the door (P1-5):** the app's name and mark over
  a blank tag; the screen's title its one heading (it was «Бірка» as the
  first heading and the title second). While the server is silent, the
  owner's words and «Якщо сервер не відповідає, після перезапуску…» are
  the paper's warning banner, read as a status — no longer an alert in the
  error's colours. «Перезапустити» the one primary, 52 high; «Версія …» in
  meta. Its words are as they were. The blank tag is now one shared piece
  (`shared/BlankTag.tsx`) for the door and this screen.
- **«Застосунок не завантажився» (P2-2):** the page before any code takes
  the app's paper and ink, and their dark by the device's setting —
  Telegram's own theme is not known before the app's code reads it. Set
  on the page's element, so the app's own colours always win once it
  comes. The owner's words on the warning's plate with its triangle. Still
  shown only after 8 s. `index.html` grew by 1 371 bytes (the task list
  allows 2 KB).
- **From the batch's independent review (2026-11-06):**
  - The warehouse for the intact ones (P0-6, its decision 4): deciding
    chips 44, nothing chosen beforehand, the one chosen in the chosen
    colours (§6.13) as «Куди»'s — no longer the action's colour.
  - Returned at another store, paid in parts there, with nothing going
    back: no way's sticker heads the stub, so whose money it is stands
    first, kept clear of the stub's eyelet as a head is. Its words are as
    they were («…гроші віддаєте ви.» even when nothing goes back — not
    changed here).
  - «Клієнт забрав»: what to do is heard too — the heading's description
    is «{сума} {як}. Проведіть на терміналі.» / «…Перевірте, що переказ
    надійшов.», as the till's stub reads its line; still nothing for a kept
    one.
  - «Щось пішло не так»: the status's place is on the screen from the
    start, empty, and the paper's warning comes into it once the server
    goes quiet, so it is heard as it comes. The banner itself has no role.

## Chosen in chat — 2026-11-07 (stage 2 batch 7: the network's screens — «Магазини» as tags with a screen per store, a state's change in a sheet, «Резервні копії» as one verdict; the door with no store; admin P0-3, P0-4, P0-5, P2-3)

Chosen in chat on 2026-11-07 («Network screens»), after #175: the admin
task list's points that were left. P1-1 was built with the quick wins
(#170); P2-1 and P2-2 build nothing by their (а). The owner's questions
stand by their (а): В-А3 (a store opens as a screen of its own), В-А5
(«Цей розділ бачить лише власник.» stays), В-А6 (no state line under
«Магазини» in «Ще»), В-А4 (the archive's words as now), В-А7 (the
reason's hint as now). No right, no server rule, no command and no state
changes: a store's state goes through the same journal with the same body
and `command_id`; who may change it, what a blocked or archived store may
do, the archive's refusal and its counts, the backups' verdicts and the
watcher's quarter of an hour are as they were.

- **«Магазини» as tags, a screen per store (P0-3, В-А3 (а)):**
  - The list is the door's: one tag a store, in the server's order, its
    name and code; a store that does not trade with its sticker
    («Заблоковано з 12.10», «В архіві з …»). No hint over the list — its
    facts are the sheet's now. A tag's tap is a light «selection» buzz.
  - A tag is read «Магазин Ринок, Заблоковано з 12.10» — the sticker's
    words, never the code (decided here).
  - A store's own screen: «← Магазини» (read «Назад до магазинів») and
    Telegram's «Назад» to the list, the list's heading taking the cursor;
    again to «Ще». The big tag — name, code, sticker, and for a store that
    does not trade «Причина: …» of its latest change; under it «Історія
    змін» as a thread, newest first, never folded: the day, «Працює →
    Заблоковано», «{who} · {reason}», every node a knot. The day only —
    the time is not shown in the thread (decided here).
  - Its buttons at its foot, as before by state; ordinary buttons, never
    the action's colour, «Закрити в архів» the quiet one. Two taps from
    «Ще» to «Заблокувати».
  - Each screen of the section begins at its top, the section too — even
    when «Ще» was scrolled to its row (decided here, found by the 360 ×
    640 journey).
- **A state's change in a sheet (P0-4):**
  - «Заблокувати «Ринок»?», «Закрити «Ринок» в архів?», «Розблокувати
    «Ринок»?», «Відкрити «Старий» знову?» — what it means as before,
    «Борги його покупців приймає будь-який магазин, що працює.» for a
    block or an archive. The field «Причина», the cursor in it, and under
    it «Її бачите ви й менеджери мережі, не продавці.» (В-А7 (а)). The
    confirm stays closed while the reason is empty — and also once the
    change is no longer offered for the store's state (decided here).
  - While sent: the confirm pressed with the turning eyelet, «Скасувати»,
    Escape and Telegram's «Назад» held; nothing closes it.
  - A refusal stays in the sheet, the reason kept: its words as before
    (the store's own, never the orders'); the archive's «what is left»
    lines «Відкриті замовлення · N», «Брак «…» · N шт.», «Власний склад
    «…» · N шт.». Felt as a warning for «not empty», as an error for any
    other refusal (decided here).
  - Recorded: the sheet closes, the stub is torn on the store's screen —
    ««Ринок»: заблоковано.» and «14:05 · Причина: Ревізія каси» — the
    sticker changes, a «success» buzz. The time is the newest change into
    that state, the reason the one sent (decided here).
  - A lost answer: «Незавершена зміна стану» kept on the list and on every
    store's screen, with since when; checked only by «Перевірити
    результат» — never by itself, as before (decided here).
  - A kept change the phone cannot read: the sheet closes, and the alert
    says «Збережену зміну стану магазину не прочитати. Перевірте стан
    магазину в списку.» — whoever reads it is the owner, so it leaves the
    «Некоректн… Зверніться до…» family (P2-3).
- **«Резервні копії» as one verdict (P0-5, В-А5 (а)):**
  - The verdict one big tag, first and largest (34 px, over the screen's
    title of 28): its eyelet a knot for «Копії в порядку», filled in the
    warning's colour for the other three. Under it, the last good copy
    and what the verdict rests on: «перевірена відновленням за 0,4 с ·
    2,4 МБ»; the reasons and «Попередні копії не видалено.»; «Остання
    спроба: …» and the schedule's hint; the three sentences of
    NOT_SET_UP. A failed verdict no longer repeats the night's own
    «{when}:» line (decided here).
  - What is wrong now, under it with no caption (decided here): each
    trouble open on the server a row that waits — what, «з …, уже …», why
    — then «Стан сервера · сторож перевіряв 2 хв тому»; a watcher quiet
    for 15 minutes, or never, a row that waits, its words its title and
    «Поки він мовчить…» under it; all well, one line «Стан сервера ·
    проблем не помічено · сторож перевіряв щойно». The week's past
    troubles one line, «Минулі проблеми за 7 днів · N», their list in a
    sheet (decided here).
  - Telegram: a row that waits only when it refused or failed, with its
    words as before — read, no longer an alert announced at once (decided
    here); otherwise one line, «Сповіщення в Telegram · останнє 12.10 о
    03:20», «… · бот напише, щойно з копіями щось станеться», or «… ·
    повідомлення надсилається» (with «· Telegram поки недоступний, бот
    спробує ще» while it retries; decided here).
  - «Останні ночі» a thread: the day, «Перевірена» / «Не вдалася» (the
    first letter capital by style), «HH:MM · size» under it, a knot for a
    checked night, a filled node for a failed one and why.
  - The explanation one line at the foot, always: «Щоночі сервер робить
    копію бази, перевіряє її відновленням і шифрує вашим ключем. Цей
    розділ бачить лише власник.» Loading: the tag's and three rows' shape,
    «Завантажуємо стан копій…» read but not seen. The screen opens at its
    top. Nothing to feel: it only reads.
- **The door with no store (P2-3):** one blank tag, the app's name and
  mark over it — «Магазинів поки немає», «Зверніться до власника.» — and
  «Спробувати ще раз», which reads the person's stores again (not in the
  task list; decided here, as the closed store's tag has it). The old
  «Доступних магазинів немає. Зверніться до адміністратора.» is gone.
- **From the batch's independent review (2026-11-07):**
  - Recorded or refused, the answer is said at once: the list is read
    again behind it, never waited for, so «Так, …» is never there to be
    pressed a second time meanwhile.
  - What is said of a change — its stub, a kept one, the corrupt entry's
    alert — takes the cursor once the sheet is gone (it stood before the
    store's tag, where a reader moving on from the name never got); a
    refusal takes it inside the sheet, the button it was on having been
    held.
  - A kept change whose answer is lost says nothing more than its stub —
    never the error's own name («UNREACHABLE»). Checked and answered with
    no proof, the stub says why in every kept command's words: «Зміну стану
    ще не підтверджено: сервер відповів, що дані змінилися. Перевірте
    результат ще раз — двічі вона не виконається.» — never a manager to
    ask, its reader being the owner (decided here).
  - A kept entry cut short, not even JSON, is as unreadable as one of the
    wrong shape, and says so in the journal's own words — for every
    journal, not only the stores' (`shared/journal.ts`).
  - Found unreadable as the app opens: said on the plate as before, and
    the state's buttons held, as every other journal's are over its own.
  - Left as built: a check pressed on another store's screen tears its stub
    there (it names its store); «Спробувати ще раз» on the door with no
    store says nothing when there is still none, as the closed store's tag
    (P1-1) does.

## Chosen in chat — 2026-11-07 (stage 2 batch 8: «Інвентаризація» — its entry, start and end; counting by the model's tag; goods P0-2, P0-3)

Chosen in chat on 2026-11-07 («Goods: «Інвентаризація»»), after #176: the
goods task list's P0-2 and P0-3 in one batch. The owner's questions stand
by their (а): В-Г3 (no «Збігається · 3 шт.» in one tap — the number is
always typed), В-Г5 (no server change: the phone glues a model's sizes
into one tag; the models' order as the server gives it). No right, no
server rule, no command and no field changes: a stocktake starts, counts
and finishes through the same reads and commands; one open per warehouse,
the warehouse keeps selling, what nobody counts stays as it is, a count is
one command applied at once, a recount keeps the last, a count equal to the
balance is recorded as checked, the reserve's and the unknown size's
refusals are the server's as before, and the bot tells the network's owner
as before.

- **The entry (P0-2):**
  - «Інвентаризація» and its line, the warehouses as chips — or the only
    one said — as before.
  - The open stocktake a row tag: its eyelet filled in the live data's
    colour (`paid`; the task list names it `live`, which the tag's eyelets
    of §6.9 do not have — decided here), the stocktake's glyph, «Триває з
    10:20 · Тетяна» («Триває з 06.11, 10:20 · …» once it began another
    day; decided here), «Пораховано 34 · нестача 2 шт. · надлишок 1 шт.»
    (or «· розбіжностей немає»; decided here) and «Продовжити», felt
    lightly.
  - None open: Telegram's MainButton «Почати інвентаризацію», set on entry
    and gone as the person leaves or once one is open; outside Telegram the
    dock's own button.
  - «Попередні»: the finished ones as a thread, newest first — the day, a
    knot, «Нестача 2 шт. · надлишок 1 шт. · не перевірено 140» (a part
    that is nought left out; «Розбіжностей немає» with none; decided
    here) and «{who finished} · 18:40» (the time added; decided here); the
    last three and «Ще N». «Показати розбіжності» stays on a row that has
    any — the task list does not name it, and nothing that worked is taken
    away (decided here).
- **The start (P0-2):** a sheet «Почати інвентаризацію складу «Основний»?»
  — the task list's «…«Основного»?» declines the warehouse's name, which
  the app cannot do for any name, so «складу» and the name as written
  (decided here). Its text as before, unchanged. Telegram's MainButton
  «Почати» (a press sooner than 0.7 s after the sheet opened was meant for
  «Почати інвентаризацію» and is let go, as «Так, закрити»'s is); the
  app's «Скасувати»; Telegram's «Назад», Escape and the scrim close it.
  Started: a «success» buzz and straight to counting — two taps. Refused:
  in the sheet, its words as before, an «error» buzz.
- **Counting, a task's screen (P0-3):**
  - The menu steps aside; the phone is kept upright while it counts (not on
    the result — decided here). «← Інвентаризація» (read «Назад до
    інвентаризації») and Telegram's «Назад» go back to the entry.
  - Its title «Інвентаризація · «Основний»», its line «Почато о 10:20 ·
    Тетяна» («Почато 06.11 о 10:20 · …» another day) in place of the
    store and the person, «Змінити магазин» held as on every task's
    screen. «Завершити» quiet at the title's right — under it when the two
    do not fit — never the MainButton.
  - «Не пораховані N · Пораховані N»: the counts are the stocktake's own
    sums (`unchecked_positions`, `counted_positions`), read again after
    each count.
  - «Не пораховані»: a tag a model (§6.12), its name and a cell a size —
    the letter, «в обліку 3» under it, the pin badge with what orders hold,
    «?» and «? — розмір невідомий» for a size not known; read «M, в обліку
    3, у резерві 1». A model's positions from every page read so far are
    one tag (the server lists them by model). The sizes in the
    organization's order for whoever may read it (`inventory:receive`), a
    size outside it — the unknown one — last; for anyone else as the server
    gave them. While the order is read, the list keeps its place (decided
    here). «Показати ще» reads the next fifty; after each count the list is
    read again whole from its top, so nothing is skipped as positions leave
    it (decided here). A cell's tap is a «selection» buzz.
  - «Знайшли товар, якого немає в списку» under the list, as before: the
    catalogue and the size as before, then the position's own cell,
    «L / в обліку 0», whose tap opens the same sheet counted against
    nought — a held one refused with how many, and counted against that.
    The form goes once it is counted.
  - «Пораховані»: rows, newest first — «Марсель молочний · M — 3 → 1 (−2)»
    or «… — 3, збігається», «{who}, 11:40» («06.11, 11:40» another day) —
    each with «Перерахувати» (read «Перерахувати: Марсель молочний · M»),
    the same sheet. The number before the arrow is the count less what
    this stocktake changed there (`counted_quantity − net_delta`; the
    server sends no «before»): a position counted again after a sale moved
    it shows the stocktake's own change from there, never the sale's
    (decided here).
- **The count's sheet (P0-3):**
  - «Марсель молочний · M» — the model's one name as the catalogue spells
    it, then the size («розмір невідомий» for «?»); the task list's
    «Марсель · молочний · M» splits a name the app holds whole (decided
    here). «В обліку 3 · склад «Основний»», and the reserve's hint as
    before.
  - The app's keypad for pieces: «Фактично, шт.», no comma (its key's
    place empty), five figures at most, the phone's keyboard never open.
    As it is typed: «3 → 1 · −2», a shortage in the warning's colour and
    nobody's fault; «Збігається з обліком.» for the same number, as before;
    «Не більше 10000 шт. однієї позиції.» and «Облік товару з невідомим
    розміром можна лише зменшити.» as before.
  - Telegram's MainButton «Записати», held until a number is typed, then
    «Записати · 1 шт.»; outside Telegram the sheet's own. Telegram asks
    before Бірка closes only while a number is typed.
  - Recorded: a «light» buzz; the sheet goes on to the model's next cell
    not yet counted — in this sheet, or by anyone as the list was last
    read — round from the one counted (the task list says «the next one»;
    round, so a tap on M of S·M·L·XL still counts S — decided here), and
    closes after the last. A recount and goods found
    are one cell: it closes after them. Five taps and four numbers for a
    model of four sizes.
  - Refused: a «warning» buzz; it stays, the keypad empty (a person past
    their requests keeps the number, as before), saying why in the words
    of before.
  - Its answer lost: the sheet goes, and the kept count's stub is App's,
    as before.
  - A balance read again while it is open is the one counted against: the
    sheet follows the list as it is read.
- **«Записано» (P0-3):** while the sheet goes on to the next cell, its line
  stands in the sheet itself — a toast at the foot would cover the keypad's
  last row (decided here); once the sheet closes by itself after the last,
  a toast for 4 s: «Записано: Марсель молочний · XL — облік 2 → 1 (−1)» or
  «… — збігається з обліком (2)». A sheet closed by hand shows none.
- **The end (P0-2):** «Завершити» opens «Завершити інвентаризацію складу
  «Основний»?» (the name as written, as the start's), its sums read again
  as it opens (as before): «Нестача» and «Надлишок» large in pieces, the
  shortage in the warning's colour; «Розбіжностей немає» large when there
  are none (decided here); «Не перевірено позицій: 140 — їхні залишки не
  зміняться.» when any; the text about counting after and the bot as
  before. Telegram's MainButton «Так, завершити» (the same 0.7 s let go),
  the app's «Ще ні». Finished: a «success» buzz; refused: in the sheet, an
  «error» buzz. Two taps.
- **The result (P0-2):** its title with the check, «Інвентаризацію
  завершено», its line «Склад «Основний» · {who finished}» (decided here);
  the stub knotted (settled): «Пораховано позицій: 2», «Нестача 2 шт. · 1
  позиція», «Надлишок 1 шт. · 1 позиція» (or «Розбіжностей немає»), «Не
  перевірено позицій: N — їхні залишки не змінювались.», and the
  differences in the words of before, five and «Ще N», then «Показати
  ще». Telegram's MainButton «До інвентаризації» (the dock's own outside
  Telegram) back to the entry.
- **No «од.» anywhere in it:** pieces are «шт.»; «нестача 2 шт. · 2
  позиції».
- **From the review (2026-11-07), decided here:**
  - A toast of the last sheet is gone once another sheet opens: never back
    after it.
  - After a model's last cell its tag goes as the list is read again, and
    the cursor to the next model's first cell — the title when none is
    left; after goods found, to «Знайшли товар, якого немає в списку»,
    never the title far above.
  - «Показати ще» waits while the list is read again (asked meanwhile, it
    would be read past a position that moved up), and is not shown under a
    read that failed.
  - The sheet's status line stands from the start, empty, so its words are
    read; a reader hears «Далі: L.» after them, the title moving without a
    word.
  - «До інвентаризації» lets go a tap sooner than 0.7 s after the result
    came, as «Почати» and «Так, завершити» let theirs.
  - The start's sheet, refused as one is open, gives the cursor back to
    «Продовжити» on the tag that stands in place of «Почати
    інвентаризацію».

## Chosen in chat — 2026-11-07 (stage 2 batch 9: «Брак» — its life cycle and where «Оглянути» leads; the correction's and the price's sheets in the model's detail; goods P0-4, P1-3, P1-4)

Chosen in chat on 2026-11-07 («Goods: «Брак» + S23 sheets»), after #177:
the goods task list's P0-4, P1-3 and P1-4 in one batch. The owner's
questions stand by their (а): В-Г4 (returning a unit to sale stays two
steps, the warehouse named on the yes), В-Г8 (no history of «Брак»: what
became of a unit is said only by the stub right after it is recorded — the
server keeps only what is in «Брак»). No right, no server rule, no command
and no field changes: every step is the command it was
(`/damaged-units/{id}/take | return-to-sale | confirm | write-off |
return-to-supplier`, `POST /inventory/adjustments`, `POST
/catalog/prices`), with the same bodies; a unit goes back to the warehouse
it was sold from, or — sold from another store's own warehouse — to one of
this store's the person picks; «На перевірці» is seen by others and keeps
nobody from deciding; «Повернути постачальнику» needs `supplier:return`;
the reasons, the 10 000 limit, «never below nought», the reserve and the
size not known only reduced stand as before; the shared price and the
store's own, `expected_price` and «1 850,00 грн» stand as before.

- **«Брак», the screen (P0-4):**
  - «Брак», its line and «Оновити» as before; under them one switch, «Які
    речі»: «Чекають 2 · На перевірці 1 · Підтверджений 3» (a segment with
    nothing has no number). The rows on the paper, as «Гроші»'s and
    «Борги»'s, never a card round cards; the switch the screen's width, each
    segment as wide as its words at 15 px, so «Підтверджений 3» is whole at
    360 px (decided here, from the review: three equal thirds inside a card
    cut it).
  - It opens on the first segment with something in it — so from
    «Сьогодні»'s «Оглянути» and from «Ще»'s «Брак · N …» on «Чекають»,
    which is what they count. The segment is fixed once the list is read
    afresh, so a unit taken or decided never moves the screen to another
    segment (decided here).
  - Oldest first in every segment, by when the unit came back — sorted on
    the phone, whatever order the server gives (decided here).
  - A row tag a unit (§6.9): its eyelet dashed while it waits, a ring while
    someone looks at it, filled in «Брак»'s colour (`--damaged`) with the
    tag's edge torn once confirmed. «Марсель молочний · M» — the model's
    one name as the catalogue spells it, then the size, as batch 8's sheet
    (decided here: the task list's «Марсель · молочний · M» splits a name
    the app holds whole); «Оглядає Тетяна з 11:40» («з 06.11, 11:40»
    another day); «Повернули 03.11 · продано зі складу «Основний»» — the
    task list's «з «Основного»» declines a name, which the app cannot do
    for any name (decided here, as batch 8); its note.
  - One verb: «Взяти на перевірку» while it waits — recorded at once, felt
    lightly, its sheet open at once; «Вирішити» otherwise, opening it.
  - A segment with nothing: the empty tag 64 and «Нічого не чекає
    перевірки.» / «Зараз ніхто не оглядає.» / «Підтвердженого браку
    немає.»; nothing in «Брак» at all: «У «Брак» зараз нічого немає.» and no
    switch (decided here: nothing to switch between).
  - A store that does not trade: the rows without verbs, and «Магазин не
    торгує: тут лише перегляд.» (decided here; the hint about trading the
    old screen gave is gone with its buttons).
- **The unit's sheet (P0-4):** its title the unit's name; who looks, when it
  came back, its note.
  - Under inspection: «Повернути в продаж» and «Брак підтверджений», one
    under the other, quiet. Confirmed: «Списати», «Повернути
    постачальнику» (only with `supplier:return`) and «Перевірити ще раз».
  - «Перевірити ще раз» records at once, felt lightly, and the sheet stays
    on the inspected unit's two ways (decided here: the task list says it
    records at once, not that the sheet closes).
  - Each decision is a second step in the sheet:
    - back on sale: «Повернути в продаж на склад «Основний», звідки його
      продали?» and «Так, повернути на «Основний»» (В-Г4 (а));
    - sold from another store's own warehouse: «Його продали з власного
      складу іншого магазину. Оберіть склад вашого магазину.», this store's
      warehouses as chips («Склад вашого магазину»), the yes «Оберіть склад»
      and held until one is chosen; none at all: «Тут немає складу, куди
      повернути в продаж.» (decided here);
    - confirmed and written off: «Що з товаром (необов’язково)» / «Чому
      списуємо (необов’язково)», «Так, брак підтверджений» / «Так, списати»;
    - to a supplier: the supplier's field as «Постачальникам» draws it, in
      the sheet, «Примітка для постачальника (необов’язково)», «Так,
      повернути постачальнику», held until a supplier is chosen.
  - The yes is Telegram's MainButton, shown only in the second step;
    outside Telegram the sheet's own at its foot. A tap carried from the
    way chosen onto the yes risen in its place is let go for 0.7 s, as the
    sheets' own (decided here). Telegram's «Назад», Escape and the scrim
    close the whole sheet, nothing recorded (decided here: never back to
    the first step).
  - Refused: in the sheet, in the words of before, felt as an error.
- **What became of it (P0-4; В-Г8 (а)):** recorded, felt as a success, the
  sheet goes and a stub `recorded` stands over the list: «Повернули в
  продаж: Марсель молочний · M → «Основний»», «Брак підтверджений: …»,
  «Списали: …», «Повернули постачальнику «…»: …», and «Ви оглядаєте: …»
  once taken. The cursor lands on it. The row leaves its segment without a
  jump: its place is held, empty, among the rows still there, while the
  stub stands — until another segment is chosen, «Оновити» is pressed or
  the next step is recorded (decided here). The last row gone from a
  segment, it says it is empty under the stub; the last unit gone from
  «Брак», the stub stands over «У «Брак» зараз нічого немає.» (decided
  here, from the review). The unit drawn as the server answered at once, before
  the list is read again (decided here). Recording also reads again the
  till's stock (`sale-stock`), where a unit back on sale shows (decided
  here).
- **The correction's sheet (P1-3):**
  - Its title the model and the size, «Лоран шоколад · M», and under it
    «Склад «Основний»» (decided here: the sheet says where).
  - The five reasons as chips («Причина»), a «selection» buzz; «Додати ·
    Списати» («Що зробити») only where the way is asked and both are
    possible — «Списати» first, as before — never where the sign is
    already the only one (decided here).
  - The line over the keypad: «В обліку 3», and «В обліку 3 → 1 · −2» once
    a number that may be recorded is typed.
  - The app's keypad of pieces, once a reason is chosen: «Фактично, шт.»
    for a recount, «Списати, шт.» for damaged and lost, «Скільки, шт.»
    otherwise.
  - The note folded: «Додати примітку», then «Примітка», the cursor in it
    (decided here).
  - A number that cannot be recorded — «Вкажіть кількість від 1.», «В
    обліку лише 3 шт. — …», … — said under the keypad as it is typed, and
    read with the sum.
  - «Записати · −2 шт.» (no number until one is typed); Telegram's
    MainButton in the sheet, the sheet's own at its foot outside Telegram;
    no «Скасувати» — «Назад» leaves. Four taps and the number. Recorded:
    a success buzz and the stub as before; refused: a warning buzz, why in
    the words of before.
  - Where the correction stands on a screen and not in a sheet — «Залишки»,
    a stocktake's «Знайшли товар…» — its own button under it and
    «Скасувати» stay, never Telegram's MainButton: a screen may hold its
    own (decided here). There it is a group named «Виправити залишок:
    {модель} · {розмір}», as its fieldset named it, and «Скасувати» is held
    while it is recorded (from the review).
- **The price's sheet (P1-4):**
  - «Для всіх магазинів · Лише «Основний»» as before (P1-2), where both
    may be set; at 15 px, «Для всіх магазинів» whole and the store's name
    in the rest, cut with «…» only when it does not fit (decided here: two
    equal halves cut «Для всіх магазинів» beside «Основний» at 360 px).
  - «Зараз: …» as before; the sum on the app's keypad, its comma, «Нова
    ціна, грн», empty as it opens — «Зараз» names the price that stands, and
    a sum already full to its kopecks would take no figure typed (decided
    here, from the review: the old field started with the price).
  - «Зберегти · 3 600,00 грн» («Зберегти» while nothing is typed);
    Telegram's MainButton in the sheet, the sheet's own at its foot outside
    Telegram; no «Скасувати» — «Назад» leaves. Two taps and the sum. A sum
    of nought: the button held and «Ціну вкажіть у гривнях, до копійок,
    більше нуля, наприклад 1850,50.» said as it is typed (decided here:
    said as typed, not on a press). «1850,» reads as 1 850,00 (decided
    here).
  - «Прибрати ціну «Основний»» quiet for the store's own; «Прибрати
    спільну ціну» as before.
  - Saved: a success buzz and the stub «Ціну продажу збережено: …» as
    before; refused: an error buzz, in the words of before.
  - Where goods arrive and on «Залишки» it stands on the screen: its own
    button and «Скасувати», never Telegram's MainButton — «Приймання» has
    its own «Записати прихід» (decided here). There it is a group named
    «Змінити ціну продажу», as its fieldset was, and «Скасувати» is held
    while it is saved (from the review).

## Chosen in chat — 2026-11-08 (stage 2 batch 10: a new model where the coat is in hand — the live search, its empty answer and the sheet «Нова модель»; «Перевірка каталогу» as a queue and a proposal's screen; «Джерело» one word; goods P0-1, P1-1, P2-4)

Chosen in chat on 2026-11-08 («go next do»), after #178: the goods task
list's P0-1, P1-1 and P2-4 in one batch. The owner's questions stand by
their (а): В-Г1 (a new model is added from an empty search in «Прийшов
товар», in both forms of «Знайшли товар…» and on a line of «Початкові
залишки», by the same proposal as in «Перевірка каталогу»; no new right),
В-Г2 (the till has no such button; its search is live too, the component
being one), В-Г6 («Джерело» is one neutral word). No right, no server rule,
no command and no field changes: the proposal is `POST
/catalog/match-decisions` with the words as typed, then `/{id}/confirm`,
`/{id}/create-product`, `/{id}/reject` and `/{id}/alias-feedback`, with the
same bodies; a model is made only by an explicit «Ні, це нова модель» or
«Створити нову», a candidate is never chosen for the person, nothing is
merged and no name is confirmed by itself; making a model adds no stock;
the similar-spelling check stands where it was.

- **The catalogue's search (P0-1):** it is asked as it is typed, from two
  letters, 300 ms after the last; «Знайти» is gone. An empty field asks
  nothing (decided here: «Знайти» on an empty field listed the catalogue a
  page at a time; a line of «Початкові залишки» still starts from what the
  line reads). Rows «Назва моделі або колір» found, a tap puts the keyboard
  away and chooses; «Попередні · Ще товари» only when there is another
  page. Read and refused: the refusal and «Спробувати ще раз».
- **Found nothing:** «Нічого не знайшли за «…»», and a quiet «Додати нову
  модель «…»» — only where the screen lets one be added (never the till)
  and only with `catalog:create` and `catalog:confirm` in this store;
  held while a catalogue operation is kept on the phone.
- **The sheet «Нова модель»** over the screen: its lines stay — a
  delivery's, a found item's form, a list line's answer and where its count
  came from.
  - **«Як записано»:** what was searched, as typed, which may be added to;
    «Далі» saves the proposal. Left after it, the proposal waits in
    «Перевірка каталогу» › «Чекають», nothing is chosen, and the screen is
    as it was.
  - **«Схожі»:** the server's candidates (ten at most), rows with «Це вона»,
    none chosen; «Список кандидатів обмежено…» where the list is cut;
    «Підтвердити: {модель}» once one is chosen, «Оберіть модель» held
    until then; «Ні, це нова модель» under them. No candidate at all: the
    third step at once.
  - **The new model:** «Нова модель · Інший колір нашої моделі», explicit;
    «Назва моделі», or the model chosen from the candidates' models or
    found by «Пошук моделі в каталозі»; «Колір»; the sizes.
  - **The sizes (decided here, from ADR-0009):** every size the
    organisation has, as cells in the order a seller reads them, any number
    at once. The task list's chips of a size system over the cells are not
    drawn: a size system does not separate sizes — M is one size whichever
    system it was typed under (ADR-0009 §2, §3). A size typed by hand under
    «Іншого розміру немає — впишіть» asks its system, «Літерна · Числова EU
    · Інша», none chosen for the person, as the old form's choice had no
    default; one the organisation has, in the same letters whatever their
    case, is that size and asks none. The server still answers «Набрано «м»
    — це розмір «M»» where a spelling differs.
  - **«Ще ознаки», folded:** «Джерело», «Категорія», «Тип виробу» (a new
    model only), «Матеріал», «Фактура», «Хутро», «Комір», «Довжина, см»,
    «Окрема модель зі схожою назвою» and «Чим відрізняється модель». Refused
    because the catalogue has a model of that name (`CATALOG_AMBIGUOUS`),
    it opens by itself, so the way to say this is another model is in sight
    (decided here).
  - A similar spelling: the block «Схожа назва вже є» with «Взяти «…»» and
    «Це інша назва — створити як є», and the refusal's own words over it,
    as before: offered, never put in the field.
  - «Залишок не додається — кількість впишете тут.» Its one button
    «Додати модель · 3 розміри» (`розмір · розміри · розмірів`), every size
    in one creation.
- **Recorded:** the sheet closes; the model is the screen's choice — the
  proposal's resolved model — with the stub «Модель додано: {модель}.
  Кількість впишіть тут.» («Модель обрано: …» for a candidate confirmed)
  and a success buzz. {модель} is the catalogue's one name for it,
  «Новинка графіт» (decided here, as in batch 9: «Марсель · молочний»
  splits a name the app holds whole).
- **Kept, cancelled:** while a command is on its way or kept, the sheet
  stands — it is that operation's place, «Незавершена операція каталогу»
  with «Повторити ту саму операцію» and, for a creation, «Скасувати
  незавершене створення». A cancellation that finds the model saved
  already shows it as added, the model chosen (decided here: «Якщо товар
  уже збережено, покажемо результат»). Felt once, a warning, as it is kept;
  its later checks, answered or refused, felt nothing (spec §4.4) — in
  «Перевірка каталогу» too, which now buzzes a first answer's success or
  refusal (decided here: it buzzed nothing).
- **Telegram's MainButton** is the sheet's for as long as it is open: «Далі»,
  «Оберіть модель» held, «Підтвердити: …», «Додати модель · …»; held while
  an operation is kept. Never the screen's under it (decided here, from the
  review: hidden, it let «Записати прихід · …» show through and be pressed
  under the sheet).
- **«Перевірка каталогу» (P1-1):**
  - The queue: one switch «Стан пропозицій» — «Чекають» (waiting and to be
    checked) · «Підтверджені» · «Відхилені» — over rows: the words in
    quotes and the status's sticker, oldest first as the server gives.
    The task list's «Тетяна, 11:40» is not drawn: a proposal carries neither
    who made it nor when (decided here; the server's answer has neither).
    «Оновити» and «Нова пропозиція» quiet in the header; «Нова пропозиція»
    opens «Нова модель» at its first step. «Попередні пропозиції ·
    Наступні пропозиції» only when there is another page.
  - A proposal made there and left in its sheet opens its own screen
    (decided here: the queue is oldest first, it would be on its last page).
  - The proposal, its own screen «Пропозиція» with «← До черги перевірки»:
    the words large, the sticker, the reasons in one line, a rejection's
    reason, «Список кандидатів обмежено…»; the candidates' rows with «Це
    вона», none chosen; «Підтвердити: {модель}» once one is — Telegram's
    MainButton, or its own docked over the menu; «Створити нову» — the sheet
    «Нова модель» at its third step; «Відхилити» — the sheet «Відхилити
    пропозицію» with «Причина відхилення» and «Відхилити».
  - Decided, the name's answer folded under «Цей опис — назва товару?»:
    «Обраний товар: …» with «Так, це його назва», each other candidate with
    «Ні, не про нього»; «Збережено: «{опис}» — назва {модель}.» as before.
    The checkbox «Зберегти підтвердження назви» is gone: unfolding is the
    choice to answer (decided here). The commands are the same; nothing is
    sent unasked and no name is confirmed by itself
    (`.ai/ADAPTIVE_CATALOG_LEARNING.md`).
- **«Джерело» (P2-4):** the one word wherever `source` is named — the new
  model's fields and the similar-name warning («Фабрика або бренд» before),
  with no hint of what it is: a factory, a brand or a supplier is not known
  (`.ai/CATALOG_ARCHITECTURE.md`).
- `CreateProduct.tsx` is gone: «Нова модель» is the one form that makes a
  model from a proposal.
- **From the independent review (decided here):**
  - A model added: the organisation's sizes and the catalogue's search are
    read again, so a size typed by hand is there to be counted on the
    screen under the sheet, and the empty answer under it is not the old
    one. The empty answer «Нічого не знайшли за «…»» and its «Додати нову
    модель «…»» go for the words the model was added for; other words
    typed say it again.
  - The same letters typed by hand twice, under two systems, are one size
    (ADR-0009): the second asks no system and adds nothing. Its system is
    asked again whenever its letters change.
  - A sheet's refusal is said only in the sheet that sent it: a kept
    operation's refusal stays the screen's «Перевірка каталогу», never
    over a fresh sheet opened elsewhere.
  - The sheet's Telegram «Назад» is hidden while its command is on its way
    or kept, as a screen's held «←» is.
  - A person without `inventory:receive` is not asked the organisation's
    sizes in «Перевірка каталогу»'s sheet: the server would refuse; they
    type the sizes, as the old form had them.
  - On a line of «Початкові залишки», «Модель додано: …» stands under the
    model it says, not under every part.
  - After «Далі» and «Ні, це нова модель» the cursor stands on the words in
    quotes at the step's top, not lost.

## Chosen in chat — 2026-11-08 (stage 2 batch 11: «Початкові залишки» — a line answered on its own task screen, «Зберегти й далі»; the lists as tags, the list's big tag with its progress, a switch of three, approval as Telegram's MainButton and a sheet; «Сьогодні»'s tag opening the list; goods P0-5, P0-6)

Chosen in chat on 2026-11-08 («merged, go next»), after #179: the goods
task list's P0-5 and P0-6 in one batch. The owner's question В-Г7 stands by
its (а): what the line states stays chosen for the person, drawn dashed
until it is touched, and the MainButton names what will be recorded. No
right, no server rule, no command and no field changes: a line's answer is
`PUT /snapshots/{id}/lines/{n}` with the same bodies, approval and
rejection `POST /snapshots/{id}/approve` and `/reject` as before. Every
line is still answered by a person; the split a line shows is offered and
never chosen for them; approving is `snapshot:approve`'s only; the
warehouse waits while a list does; the limits of 5 000 stand.

- **A line's screen (P0-5).** «Розібрати» on a line's row opens the line as
  a task screen, the menu set aside: «Рядок 12 з 412» over «Склад «…» ·
  чекають N», «← {список}» back to the list with nothing sent (Telegram's
  «Назад» too; both held while an answer is on its way).
  - The line as the paper wrote it, on paper; under it what the list says
    of its count, its photo and file, what the parser read and its notes,
    the lines with the same text, and a range or a duplicate asked about —
    all moved here from the list's rows (decided here). A record that may
    be a range is asked as «Запис «42-44» — це:» on the screen, nothing in
    it chosen for the person; on a row whose screen opens, the row says
    «Потребує уваги» and no more. Where the screen does not open, the row
    keeps all of it (settled in the review, below).
  - «Модель»: the catalogue's search from the model as read, or the model
    chosen with «Інша модель».
  - «Розмір»: the size cells, «Розмір невідомий» last. The one size the
    parser read is chosen, dashed, with «Схоже на M — торкніться, щоб
    підтвердити» until it is touched (В-Г7 (а)); a tap on it confirms it.
  - The split a line shows is offered in «Розмір» as «Як у рядку: M 1 · L 2»
    (decided here; «Як у рядку, по розмірах: M × 1, L × 2» in «Звідки
    кількість» before), never taken by itself; taken, its sizes and counts
    stand as cells and nothing is typed.
  - «Звідки кількість»: the ways, one card each. What the line states —
    «Як у списку: 3 шт.», or one piece where the line implies it — is
    chosen, dashed, with «Прочитали в рядку» until it is touched (В-Г7
    (а)); as before, it was chosen for the person, only now it is drawn as
    the line's reading.
  - «Не товар» a toggle (decided here), its reason under it; «Пропустити»
    opens the next line with nothing sent (on the last, the list).
  - **The MainButton** names what will be recorded: «Зберегти й далі · M × 3
    шт.», «Зберегти й далі · M × 1, L × 2 шт.», «… · розмір невідомий × 1
    шт.», «… · не товар»; «Зберегти й далі» alone, held, until the answer
    is whole. The line's last in its filter says «Зберегти · …» and leads
    back to the list's big tag. Outside Telegram, its own docked over the
    menu.
  - **The next line** is found by the phone, the server unchanged: the
    first after this one in the same filter among the lines already read
    opens at once, the lines read again behind it (settled in the review:
    the screen does not wait for the server to say what the phone knows);
    none among them, the lines are read again, then the next pages; none
    left, the list's big tag. «Змінити відповідь» stays the verb of an
    answered line (decided here: the TZ's one verb «Розібрати» would not
    say the answer is there).
- **The lists (P0-6).** Rows on tags: «{список} · склад «…»», «Розібрано R
  з L · не товар S», «Веде магазин …» where another store keeps it, the
  state's sticker and «Відкрити». «Новий список» is Telegram's MainButton
  (`snapshot:import`), and the new list its own screen, «← Початкові
  залишки», «Закрити» gone; «Зберегти список» its MainButton. Its
  warehouse is chips; the only warehouse a list may be started at is said
  and taken (decided here, as at a delivery and a stocktake). Empty, a
  blank tag and one line: «Списки із зошита — рядок за рядком. Поки список
  чекає, склад не рухається.»; the five lines of hint are gone.
- **The list.** Its big tag: «Склад «…»», its state, when it was counted or
  which store keeps it, and — in review — «Розібрано R з L» over a bar,
  then «Не товар S · чекають N · U шт.». «Розібрано» counts the lines
  answered; «не товар» stands apart, and the bar fills with both, what is
  decided (decided here). The files stay above the lines.
  - **A switch of three:** «Потребують уваги N», «Чекають N», «Розібрані
    N»; «Не товар · N», «Усі · N» and «Прибрані» (where a file was removed)
    in the sheet «Інші рядки» behind ⋯. No filter is lost.
  - The lines as row tags: «N. текст», its state and what the list says of
    its count, what it was answered as, where its count came from, its
    note, its reason when not stock; «Розібрати» or «Змінити відповідь»;
    «Показати ще» for the next page.
- **Approval.** «Затвердити · 412 шт.» is Telegram's MainButton once
  nothing waits and the person may approve; before, there is none, and the
  big tag says what waits. It opens the sheet «Затвердити «{список}»?»:
  «412 шт.» large, «стануть початковим залишком складу «…». Скасувати це
  потім не можна.» and «Так, затвердити» (a press within 0.7 s of the
  sheet's opening was meant for the button under it and is let go). The
  summary of where the counts came from stays above; «Відхилити список» is
  as it was. Approved: a settled stub «Затверджено: 412 шт. стали
  початковим залишком складу «…».» — the sentence as it was (decided here:
  the TZ's «на «Основному»» needs a warehouse's name in the locative,
  which the app does not know).
- **«Сьогодні»'s tag.** «Переглянути й затвердити» opens the list itself
  when one list waits for approval, the lists when several do; «Доробити»
  opens the lists, as before. From a list the tag opened, «До списків»
  leads to the lists, and from them «← Сьогодні» (decided here: the list
  is under its lists). From «Сьогодні» to an approval: three taps, the
  tag's verb, «Затвердити · N шт.», «Так, затвердити».
- **Settled in the review (2026-11-08).** An independent review of the
  batch; each of these is decided here, none changes a rule:
  - **Where a line's screen does not open** — an approver who does not
    answer lines, a list only to reject, a list approved or rejected — its
    row keeps what the list and the parser say of it: the photo and file,
    what was read, the file's notes, the same-text count, and a record
    that may be a range said as «Запис «…» може означати й діапазон
    розмірів: під час розбору вкажіть, що саме.». The reasons to reject a
    list are not hidden behind a screen the person cannot open.
  - **«Рядок N з M»:** M is the last line's number, not the count of lines
    left: numbers go on past a file removed, so «Рядок 14 з 12» cannot be.
  - **A draft's warehouse no longer offered** (closed, or no longer taking
    goods) is no choice: the person chooses again, or the only one is
    taken. Never while a send's answer is unknown: its list is found by
    the warehouse it was sent for.
  - **The list's first filter:** «Потребують уваги» when any line needs
    it, else «Чекають» when any waits (or nothing is answered yet), else
    «Розібрані» — a list opened to approve shows what was answered.
  - **While lines are added by hand,** the approval's MainButton is not
    shown; the form's own is. The same under ⋯'s sheet.
  - **Back's names:** the line's screen «Назад до списку «{список}»», the
    new list «Назад до «Початкові залишки»»; each held while a send is on
    its way. Coming back from the new list, the cursor is on the lists'
    heading; from a line's screen, on that line's verb.
  - **The bar** says itself: «Розібрано R з L, не товар S».
  - **Not changed:** the headings' levels stay as the screens have them;
    the split as the line shows it stays an option in «Розмір», not in
    «Звідки кількість»; «Прибрати» stays on the extra size rows only, the
    first row being the answer itself.

## Chosen in chat — 2026-11-08 (stage 2 batch 12: «Моделі» — the live search, the model's big tag with ⋯, the rename sheet, the merge's own screen asked by Telegram's popup; «Залишки» for those without the till — a chip a warehouse, a tag a model, a tap to its detail; goods P1-2, P2-5)

Chosen in chat on 2026-11-08 («merged, go next»), after #180: the goods
task list's P1-2 and P2-5 in one batch — the last two of that list. No
right, no server rule, no command and no field changes: a correction is
`POST /catalog/models/{id}/rename`, `/merge`, `/retire` and `/restore` with
the same bodies, through the same journal; «Залишки» reads
`/stock-locations` and `/catalog/stock-options` as before. A merge still
cannot be undone, still shows both models and their stock first, and is
still the right of whoever may merge in every store (the card's
`may_merge`); what stops it is the server's to say.

- **The search (P1-2).** Asked as it is typed, from two letters, once
  typing pauses — no «Знайти», as the catalogue's search (P0-1). Each model
  a row; a retired one says «Прибрана» on its row, and its name read aloud
  ends «— Прибрана». Words no model has: «Нічого не знайшли за «…».». The
  same search finds the model that stays in a merge, the duplicate itself
  never offered.
- **The model's card.** A big tag: its name, «Джерело: …», the sticker
  «Прибрана» or «Об’єднана» where it is not «Діє», «Веде до моделі «…».»
  for a merged one, and — retired — «Прибрану модель не пропонують у
  «Прийшов товар» і пошуку; її залишок продають, повертають і списують.»
  («у «Прийманні»» before). «← Моделі» back to the search, the cursor on
  the row it was opened from.
  - **⋯** opens a sheet named by the model: «Перейменувати», «Об’єднати з
    іншою» (only where the card says it may be merged), «Прибрати модель» or
    «Повернути модель». None for a merged model. The four buttons under the
    card are gone.
  - **Retiring and bringing back** ask nothing (decided here, as the TZ's
    acceptance says): both are undone by the other, and what each does is
    said once it is done.
- **The rename sheet.** «Перейменувати модель»: «Змінюється лише ця модель.
  Старі продажі зберігають назву, під якою продали.» («Старі чеки…»
  before; «чек» is not the app's word), «Назва моделі» and «Колір», then
  «Ще ознаки» folding «Джерело», «Матеріал», «Фактура», «Хутро», «Комір»,
  «Довжина, см», «Категорія» and «Тип виробу». «Зберегти назву» is
  Telegram's MainButton, held while its answer is on its way; outside
  Telegram, the sheet's own button at its foot. The sheet stands while the
  answer is waited for.
  - A similar word, a name another model has, and a name several models
    have are asked in the sheet as before («Взяти «…»», «Це інша назва —
    зберегти як є», «Об’єднати з тією моделлю», the families to choose).
  - **Refused for another reason,** «Ще ознаки» unfolds by itself (decided
    here): the refusal may be of a word folded there.
- **The merge's screen.** «Об’єднати з іншою» opens a screen of its own,
  «Об’єднати моделі» under «← {модель}»: the search «Модель, що лишиться»,
  the cursor in it; then the two models as tags — «Зникне» and
  «Лишається», «Прибрана» beside where it is, the price — with their stock
  as cells, a row a warehouse, a cell a size, its count under its letter,
  «є» where this person may not read that warehouse's count (said aloud
  «M — є залишок, кількість не видно»). What stops it is rows under «Поки
  що не можна об’єднати». «Поміняти місцями» and «Обрати іншу модель»
  stay.
  - **«Об’єднати»** is Telegram's MainButton, shown once the model that
    stays is chosen, active while nothing stops it. The box to tick
    («Розумію: об’єднання не можна скасувати.») is gone: what cannot be
    undone is asked.
  - **The question.** Inside a Telegram that has its popup (6.2 and
    later): «Об’єднати «А» з «Б»? Скасувати не можна.», with «Ні» and the
    destructive «Об’єднати». The popup has no title, the whole question
    its message (decided here: Telegram's title holds 64 characters, the
    names do not fit it; an empty title is left out of the call, as
    Telegram's own library leaves it — no blank band over the message).
    The message holds 256: longer
    names are shortened alike with «…», the question whole. Outside
    Telegram, or in an older one, a sheet of the same words: its title the
    question, «Скасувати не можна.» under it, «Об’єднати» and «Ні». «Ні»,
    or the popup closed without a button, sends nothing.
  - From the model's card to a merge recorded: six taps — the duplicate's
    row, ⋯, «Об’єднати з іншою», the model that stays, «Об’єднати», and the
    popup's «Об’єднати».
  - Refused because something opened since the preview: the preview read
    again, its rows say what.
- **A kept correction (ADR-0013).** Its answer lost: the sheet goes, and
  «Зміну каталогу ще не підтверджено» stands over the screen («Незавершена
  зміна каталогу» before), «Невідомо, чи записано зміну. Перевірте
  результат — та сама зміна не запишеться двічі.» and «Чекає відповіді
  сервера з HH:MM. Телефон перевірить сам. Нічого не повторюйте, поки він
  не скаже «не записано».» — the words every kept operation now has, no
  paper line: a catalogue correction is not done on paper (decided here).
  - **Checked by itself** (decided here, as every kept operation): resent
    once as the server is seen back, and once as the app opens with it
    kept; «Перевірити результат зміни» stays. Until it is settled the card's
    ways, the merge's ways and every other section are held.
  - **Felt:** a first answer buzzes — success, or an error for a refusal;
    a kept one's later checks buzz nothing (decided here).
- **«Залишки» (P2-5)** — for whoever reads the stock with no till in the
  store; anyone else reads it on the till's search and a model's detail.
  - **The warehouse** is a chip, none taken for the person while there are
    several; the only one is said — «Склад «…»» — and taken (decided here,
    as at a delivery and a stocktake). A paused one says «Склад на паузі.
    Залишки доступні для перегляду.»; «Брак» says «Це склад «Брак»: тут
    лежить пошкоджений товар із повернень, він не продається. Змінюється
    лише через розділ «Брак».» (the select's «— брак, не продається» before).
    «Оновити» reads again («Оновити залишки» before).
  - **A tag a model,** its rows glued across the pages read (a row read
    twice counts once): its name, its price (none in «Брак»), a cell a
    size. Where the store sells from the warehouse, a cell says what is
    free under its letter — «у резерві», dashed, where every unit is held —
    and what orders hold is its pin, read aloud «M, вільно 2, у резерві
    1»; the tag ends «Можна продати N шт.» where anything is free. Where it
    does not sell from it (paused, not for sale, «Брак»), a cell says what
    lies there: «M, 3 шт.». The words «Розмір:», «На складі:», «У резерві:»
    and «Доступно:» are gone.
  - **A tap** on the tag — its name or anywhere on it — opens the model's
    detail (S23) with «← Залишки», «Ще» marked; back, the same warehouse
    and its tags. The detail reads the whole list for the model, with no
    search: a name is not a search's words.
  - **«Виправити залишок» and the price** are no longer on «Залишки»: they
    are the detail's (P1-3, P1-4), one tap away. A stock correction kept
    with no answer still stands and is settled on «Залишки» too, as on the
    detail and «Інвентаризація»: «Залишки» reads its balances again, and a
    kept one read from the phone opens there (as before).
- **The order's tags** in «Позичене» and «Накладні» drew list bullets:
  gone.

### Settled in the review (2026-11-08)

An independent review read the batch; what it found was settled so, none
of it a rule of the owner's:
- **The search's words stay** across the card and the merge's screen:
  «← Моделі» comes back to them, the cursor on the row it left.
- **A kept correction is checked once «Моделі» opens again** with it kept,
  as when the app opens with it — not only as the server comes back.
- **Settled by itself while the person is on the search,** it is said
  there — «Назву змінено: …», «Моделі об’єднано: …» — their words and
  cursor left alone; settled on the card or the merge, the model is shown.
- **Its answer lost with nothing kept** (the phone's memory unwritable):
  the sheet stands with its words; kept, the sheet goes and the cursor is
  on the stub.
- **Focus:** on the merge's heading once both models are known; on the
  model's name after a retirement refused; on the stub as it comes.
- **Enter** in a field of the rename sheet saves, as its button does; a
  similar word taken for a folded field unfolds «Ще ознаки».
- **The merge's question** is cut between whole characters: an emoji is
  never halved.
- **The live search** keeps the rows it shows while the next words are
  asked; «Нічого не знайшли…» only for the words asked, read aloud.
- **«Залишки»:** a model whose rows may run on to the next page is held
  back until that page is read, its count never cut; «Показати ще» puts the
  cursor on the first tag it brings; a refresh refused hides the tags it
  had, a next page refused keeps them under its own retry; the warehouse
  chosen is forgotten once «Залишки» is left for anything but the model it
  opened.
- **A long name** in a sheet's title or a «←» wraps rather than overflows.
- **Not changed:** the detail opened from «Залишки» still reads the whole
  list until the model (a recorded cost, «Not covered» in the report).

## Chosen in chat — 2026-11-08 (stage 2 batch 13: «Звіт про продажі» — «Гроші»'s periods as one switch, days of one's own in a sheet; one table, a column a store and «Усі разом»; «Моделі» and «Продажі й повернення» each a screen of its own with a switch of the store; «Як рахуємо» a sheet; money P1-1)

Chosen in chat on 2026-11-08 («Yes, start it»), after #181: the money task
list's P1-1, the last point of stage 2. The owner's В4 and В5 were not
answered; both built by (а), as the chat said — В4: the periods are
«Гроші»'s; В5: «Як рахуємо ›» opens a sheet. No right, no server rule and
no field changes: the report reads `/reports/sales`, `/reports/sales/models`
and `/reports/sales/entries` with the same queries, `report:view_financial`
as before, each store only where the person holds it (the server's).
Every figure is a field of the server's answer; nothing is added up on the
phone. Orders paid off the till stay outside «Разом»; a correction of the
way stays a note beside what was stated.

- **The period.** «Сьогодні · Вчора · Тиждень · Місяць» — «Гроші»'s own
  periods and days (`periods`, `rangeOf`), by the server's today; «Цей
  тиждень» and «Цей місяць» are gone (В4 (а)). It opens on the period
  chosen on «Гроші», as before. «Вчора», «Тиждень» and «Місяць» wait for
  the first answer, the server saying which day today is; «Сьогодні» is
  asked with no days, the server's own.
  - **«Інші дні»** is a quiet line under the switch; with days of one's
    own it reads «03.10 – 05.11 · Змінити», and nothing in the switch is
    pressed. It opens the sheet «Інші дні»: «Від», «До», «Показати» —
    pressable once both are given. The two date fields on the screen are
    gone.
  - **Days refused** as no period: «Оберіть період від одного дня до року;
    перший день — не пізніше останнього.», as an alert, with no «Спробувати
    ще раз» (as before).
  - **The line under the title** says the period in words and its days:
    «Тиждень · 02.11 – 05.11», «Вчора · 04.11», «Сьогодні · 05.11»; days of
    one's own, the days alone. A day of another year than the server's
    today carries its year, «30.12.2025 – 02.01» (decided here).
- **One table.** Rows down, the stores across, each as «Гроші» names it
  («в архіві», «заблоковано»); with two stores or more, the last column «Усі
  разом» — the server's `total`, never the stores' sum. «грн» once, in the
  corner; kopecks always; «−» for what went out.
  - **ПРОДАЖІ:** «Продажі», under the sum «12 · 15 шт.» (sales · units);
    «Повернення», «1 · 1 шт.»; «З урахуванням повернень», bold. «од.» is
    gone: «шт.» as everywhere.
  - **ГРОШІ:** «Оплачено одразу повністю», «Внески за борг», «Віддано при
    поверненнях»; «Виправлення способу оплати» only where a store's
    corrections moved money into or out of the till, «0,00» in the others
    (decided here: a row a store lacks reads «0,00», not blank); «Разом»,
    bold.
  - **ЗА СПОСОБОМ ОПЛАТИ:** «Готівка», «Картка», «Переказ» always;
    «Не вказано» only where a store has any.
  - **ОКРЕМО ВІД «РАЗОМ» — ЗАМОВЛЕННЯ:** «Переказ наперед», «Накладений
    платіж», each only where a store's orders brought or corrected any; the
    section gone where neither.
  - **Under the table,** a line a store whose way of payment was corrected:
    «Виправлення способу оплати: картка −350,00 грн, готівка +350,00 грн
    («Центр»)».
  - **Wider than the phone,** the table alone scrolls; its first column
    stays, 118 px wide, the labels wrapping in it; a column comes to rest
    whole beside it, never half hidden under it, and the last one can be
    brought there (decided here: a figure cut at the first column's edge
    read as another figure, «12 250,00» as «250,00»). A section's name stays
    in view as the stores scroll, wrapped within what the first column and
    the last keep in view — «Окремо від «Разом» —» over «замовлення», never
    cut to «РАЗОМ» — ЗАМОВЛЕННЯ», which reads the other way (decided here,
    seen in the screenshots).
- **How old it is** — «дані на HH:MM» — only while today is in the days
  and the answer is older than five minutes: past days do not change (as
  before).
- **Ways under the table** (spec §6.8): «Моделі ›» and «Продажі й
  повернення ›»; under them «Як рахуємо ›», a sheet of the three sentences
  the screen said before, unchanged (В5 (а)). The hint over the table is
  gone.
- **«Моделі»** — a screen of its own, «← Звіт про продажі», the period
  under its title. With two stores or more, the store's switch «Усі ·
  «Центр» · «Ринок»»; with four or more, a row of chips that scrolls. A
  row a model: its name; «15 шт. · повернено 1 шт. на 1 850,00 грн», or
  «15 шт.» where none came back; the sum sold on the right. None: «Нічого
  не продано.». The select «Моделі й продажі» is gone.
- **«Продажі й повернення»** — a screen of its own, the same switch: a
  thread by day, the newest first, the day said once at its first entry,
  each a filled eyelet; «Продаж 1 850,00 грн» or «Повернення −1 850,00
  грн»; «20:05 · Оля · Кокон графіт, M»; how it was paid or handed back,
  and the store's name where every store is shown («продав «…», прийняв
  «…»» for a return taken at another store, as before); the paper it was
  typed from, «… · внесено: …». «Показати ще» reads the next 50; an entry
  moved by a sale made meanwhile is shown once. «Попередні» and
  «Наступні» are gone. None: «Ні продажів, ні повернень.».
  - **The store chosen is kept** between the two screens and forgotten
    when the report is left (decided here).
  - **Back** to the report: where it was read to, the cursor on the row
    that opened the screen; each screen opens at its top, the cursor on its
    title (decided here).
- **The taps** (decided here, the owner to see): a week is three taps from
  «Гроші» — the tab, «Звіт про продажі», «Тиждень» — and the table, the
  switch, «ПРОДАЖІ» and «ГРОШІ» whole above the menu at 390 × 844 with two
  stores. One store's sales yesterday are five — «Гроші», the report,
  «Вчора», «Продажі й повернення», the store — but the rows stand under
  the table, as the task list draws them, so at 844 with two stores they
  are reached with one scroll. The task list asked for no scroll; to
  meet it the rows would go above the table. **Owner's question.**

### Settled in the review (2026-11-08)

An independent review read the batch; what it found was settled so, none
of it a rule of the owner's:
- **The period is kept as chosen,** never guessed from its days: on a
  Monday «Тиждень» is that day alone and stays «Тиждень», on the 1st
  «Місяць» stays «Місяць»; the report opens on «Гроші»'s period whatever
  its days are. Days of one's own stay one's own, even where they are a
  period's.
- **Read again each time it is opened** or its days chosen, whatever
  «Гроші» or «Сьогодні» read a minute before: a sale made since is in the
  table, as on its two screens.
- **«Сьогодні» is never held:** it needs no day said, so it can be chosen
  while the days it opened on could not be read; the others wait for the
  server's today.
- **A re-read that fails is said** under what was read, with «Спробувати
  ще раз»: on the table, on «Моделі», on the thread. A page of the thread
  that failed has that one retry; «Показати ще» is gone meanwhile.
- **Back from «Моделі» or «Продажі й повернення»,** the stores scrolled
  across as they were left.
- **A day of the thread of another year** than the server's today has its
  year under it, «31.12» and «2025»: the day's column holds five
  characters.
- **Not changed:** one store's yesterday is still five taps and a scroll
  (the owner's question above).

## Chosen in chat — 2026-11-09 (audit after stage 2, batch 1: the page is the paper, never a card — no base card, the gutter 16, a list's rows on a white block; the money buttons wait as the till's dock — «Клієнт забрав», «Змінити на «…»», «Видати / Внести»; frame P0-1, sale P0-1, orders-cash P0-1)

Chosen in chat on 2026-11-09 («Yes, start it»), after the audit after stage
2: its first batch, the frame's P0-1 with the till's share of it (sale
P0-1), and the money buttons' waiting (orders-cash P0-1). No right, no
server rule, no field and no word changes. The money is untouched: the
command and its `command_id`, the five ways with none chosen beforehand,
paying in parts and its check, the operation kept when its answer is lost,
what reaches the till — all as before; only how a press waits changed.

- **The page is the paper.** A `section` is a block of meaning, never a
  card: no fill, no outline, no corner, no inside of its own; the 2026-10-11
  card (18 round, 22 inside, 17 at ≤ 480 px) and every screen's own undoing
  of it are gone. White comes from what is on the paper: a tag, a list's
  block, a sheet, the menu.
  - **The screen's gutter 16** at every width (was 18, and 14 at ≤ 480 px).
  - **A list's rows on a white block** (spec §6.8): the card's white, 4
    round, a hairline round it in the light theme and none in the dark,
    where its fill parts it from the paper. Its rows 12 16 inside, the last
    with no line under it. «Ще»'s groups so, their labels on the paper; and
    «Гроші»'s rows under «Де гроші зараз» (settled in the review).
  - **A plate drawn as a section keeps a box of its own** (decided here):
    `section.notice` 12 16 inside, its warning's outline, 4 round — it had
    them from the card.
  - **The customer's card's blocks 4 round,** outlined as a list's block.
  - **The till's tray and the result's dock** lie on the screen's gutter,
    their −6 px gone: it was sized to the card's inside.
  - **The till's search,** held at the top while the tags scroll under it,
    on the paper (decided here, seen in the screenshots: it was a white
    band).
  - **A stub inside a section** is the card's white like any other: the
    rule that made it the paper's colour on the card is gone (decided
    here).
  - **The notebook's line on a line's task screen** («Початкові залишки») a
    slip of the card's white on the paper, as a tag is (settled in the
    review: paper on paper it all but vanished).
  - **Not changed here** (their own tasks): fields still `fold` with an
    `edge` outline on the paper (frame P1-1); the mode switch's track and
    the chips (frame P1-1); other lists' rows not yet on a block, and rows'
    lines across the whole width, not inset 16 (frame P2-2 and the
    sections' tasks).
- **«Клієнт забрав» on its way** waits as the till's dock (spec §5; the
  decision of 2026-10-28):
  - the pressed way turns the eyelet's ring and keeps its colour, the four
    others step back; «Оплата частинами» and its fields held, as before;
  - past 3 s, «Ще надсилаємо…» over the ways;
  - no way out until it is answered: neither Telegram's «Назад» (hidden),
    nor Escape, the scrim or the grip;
  - the five ways the till's height, 56;
  - pressed with the ways scrolled half out of the sheet («Оплата
    частинами» open), they are brought back into its view with the line's
    room over them (settled in the review);
  - answered, as before: recorded — the sale's stub; refused — why, over
    the ways, the ring gone; the answer lost — the card's kept operation.
- **«Змінити на «…»» on its way:** its ring on the button, in its colour;
  past 3 s, «Ще надсилаємо…» over it. Meanwhile neither «← Каса»,
  Telegram's «Назад» nor «Інша операція» leads off the screen (settled in
  the review: a refusal answered after it was left was lost). Only while
  it is on its way: a command kept unanswered holds nothing here, as
  before — «Каса»'s banner says it.
- **«Видати / Внести» on its way:** past 3 s, «Ще надсилаємо…» over the
  sheet's button; the button keeps its colour with its ring, and
  Telegram's «Назад» is hidden, as on «Клієнт забрав» (settled in the
  review). Whatever comes of the send — even one that fails on the phone —
  the ring stops and the sheet may be left again.

### Settled in the review (2026-11-09)

An independent review read the batch, with the financial-integrity lens on
the waiting. It found no second command possible, no outcome lost, no ring
on the wrong way and no state left «sending»; what it found was settled
so, none of it a rule of the owner's:
- «Видати / Внести»'s button in its colour and Telegram's «Назад» hidden
  while on its way; its send always lets the sheet go.
- «Змінити спосіб оплати» not left while a change is on its way.
- «Клієнт забрав»'s ways brought into the sheet's view on a press.
- «Гроші»'s rows on a white block, as «Ще»'s.
- The notebook's line on the openings' task screen the card's white.

### Settled after GitHub's run (2026-11-09)

- The model's grid's rows' names in `meta` (14/19/500, the type ramp's
  floor for reading text; they were 15, off the ramp): with the gutter 16,
  the grid at 360 px keeps its 12 px to spare on CI's Roboto. Not a rule of
  the owner's.

## Chosen in chat — 2026-11-09 (audit after stage 2, batch 2: «Сьогодні» — the folded line names both stores, a store's units in its name's row, the day-tag's padding by the spec; a list's row by §6.8; «←» unread in orders; «Прибув на пошту»'s ring; frame P0-2, P2-2, P2-3, orders-cash P2-5)

Chosen in chat on 2026-11-09 («Yes, start batch 2»), after batch 1 (#183)
was merged. No right, no server rule, no field and no word changes; every
figure is the server's, none added on the phone.

- **«Сьогодні»'s folded line** (frame P0-2, spec §6.10): with two stores,
  «Сьогодні досі · 12 050,00 грн · «Центр» 6 950,00 грн · «Ринок» 5 100,00
  грн» — the day's sum, then each store's with its name in «», each the
  report's own field; it breaks between its parts only. One store (a
  manager), or three and more: as before, the sum and its units. A store
  whose figures the report lacks (its rights came after the report was
  read): the line as before.
- **The day-tag's levers** (frame P0-2, measured at 390 × 741, light,
  «Центр + Ринок», the e2e day; this Mac's font):
  1. a store's «N шт.» in its name's row on the right, in `meta`, its sum
     alone on its line: the tag 366 → 350 px;
  2. the drawer's and «Винні …» lines on one line where the words fit at
     390: nothing to gain — the drawer's already is, and «Винні 8 400,00
     грн · 4 людини» does not fit a column of 154 px;
  3. the tag's padding spec §6.10's 28 16 16 (was 26 16 12), nothing of
     its own between its rows (the money line's 2 px and the parcels'
     line's 2 px gone, its 44 for the finger reaching 12 into the padding):
     350 → 350 px.
  - **Not met: two work tags over the menu.** With the tag at 350 px the
    first work tag ends 41 px under the menu's top, the second's title
    some 83 px. By В-К1 (б), the owner's default until they answer: the
    fold stays under 700 px of Telegram's steady height; the measure and
    the screenshot are in the batch's report.
- **A list's row** (frame P2-2, spec §6.8), one rule for every list: 64
  high at least; its title 17/600 in ink, its meta 14/500 in pencil;
  pressed, the fold under it; taking no tap, its title in pencil and
  nothing faded over it; its chevron the set's 16 in pencil, never the
  text «›». On a list's white block its sides are 16 and a hairline runs
  under it from its text's edge — 68 past a customer's two letters, 16
  else — none under the last; off a block, its sides stay 4, as the
  paper's other lines.
  - On a block now: «Покупці»'s lists (who owes, and a search's
    customers found in another store), the till's list of one customer's
    debts, «Повернення»'s rows a block a day under the day's heading (its
    heading 8 over it), and their places while read.
  - A store's debts on the customer's card lie on that block's own white,
    never a block in a block: the rows the card's width, their sides its
    16 (review).
  - Not on a block (decided here): the debts to pay into in «Внесок»'s
    sheet — a sheet is already the card's white.
  - The chevron as the set's in the twelve places the audit named; the
    orders' and «Каса»'s are their own task (orders-cash P2-4), their
    text «›» kept at 24 till then.
  - Still on the paper with the row's rule (their sections' tasks): «Каса»,
    «Закриття», «Замовлення»'s lists, suppliers', the report's, the
    search's results.
- **«←» never read aloud** (frame P2-3): in the five places of orders the
  arrow is drawn and hidden from a screen reader, as everywhere else; the
  words as before.
- **«Прибув на пошту» on its way** (orders-cash P2-5): the pressed verb
  turns the eyelet's ring before its words and keeps its colour; the
  list's other verbs held as before; one `success` buzz on the record, none
  on the press. Answered, the pressed verb keeps its ring and takes no
  second tap until the list is read again (review).

Settled in the review (an independent reviewer of the batch's diff):
- **A block in a block** on the customer's card: its debts were put on a
  list's white block inside the store's own white block — two outlines,
  26 px of each row lost at 360. Now they lie on the store's block itself.
- **The separator under a customer's two letters:** the hairline ran from
  16, under the letters; §6.8 says 68 where a row has them. Now 68.
- **«Прибув на пошту» answered, its list read again:** the ring went on
  spinning on a verb that took a tap again; a second tap would have sent
  a second write, refused by the server. Now it takes none till the list
  comes.
- **A row taking no tap was faded twice:** its title pencil under the
  buttons' 45 % — about 2:1 on the white. Now its title pencil alone, as
  §6.8 says; nothing faded over it.
- **The text «›» left to orders and «Каса»** had lost its 24 with the
  set's chevron's rule; now 24 as before. **The paper's series** turned its
  new chevron its own glyph's ink, or the warning's colour while the paper
  is unsaid; now pencil, as every chevron.
- **«Повернення»'s days** are told apart by their date, not their first
  sale: a sale coming on top no longer makes the day's rows anew.
- **«Повернути постачальнику»'s model rows** kept 56 of their own; now a
  list's row, 64.
- Seen and left: a pressed row on the paper (not on a block) turns the
  fold, barely seen in the light theme — those lists' own tasks put them
  on a block; a customer's two letters, the fold's colour, are lost in the
  pressed row's fold while pressed; a store's column on «Сьогодні» reads
  its units before its sum, as the task draws it.

## Chosen in chat — 2026-11-09 (audit after stage 2, batch 3: a button the secondary one unless it says it is the screen's main; fields, the ring, what is said under, the weights by §4; one Unread for a read that failed, the lint holding it; «Магазини»' words; one Empty; frame P1-1 part 1, P1-2, P2-1)

Chosen in chat on 2026-11-09 («Yes, start batch 3»), after batch 2 (#184)
was merged. No right, no server rule, no field changes; words change only
in «Магазини»' kept stub, as the TZ has them (approved with it). Part 2 of
frame P1-1 (the mode switch, the menu, the radii off the scale, the dead
rules, `index.html`) is a later batch.

- **A button is the secondary one** (frame P1-1, spec §5.5 `button-s`,
  §6.5): the card, an edge of 1, ink, 15/600, 44 high at least, the
  corner 8. **The screen's main says so** — `.primary`: the primary,
  52 high, 17/700, the corner 8; Telegram's MainButton's place outside
  Telegram (`.main-mimic`) is one too. One main a screen at most, its own
  or Telegram's, with what could not be read said on it too (S04, S07,
  S08, S16, S19, S25, S29 checked).
  - **Which buttons are the main** (decided here, by «one main a screen»):
    a screen's or a sheet's own finishing action where no MainButton
    stands — «Новий продаж» in the result's dock and after nothing sold,
    «Готово» on a recorded invoice and a closed drawer, «До замовлень»,
    «Прийняти повернення», «Записати причину», «Перезапустити», «Прийняти
    ще», «Так, стерти дані покупця», the write-off, the cash panel's
    send, the sheets' «Готово» and a picker's choice, a return's
    record, a store's change confirmed, «Позначити проданим · N шт.» — 33
    places in 25 files. Every other button that had no class is now the secondary:
    retries in a plate, «Зрозуміло», steppers, an empty place's «Новий
    продаж», the shortfall's answers, yes/no asked in the content, a
    sheet's list of ways, the collect's picker.
  - **The till's three ways and a debt payment's** (spec §6.15, S21): each
    the primary, 17/700 — the button is the sale. **«Клієнт забрав»'s
    ways**: the secondary, as §6.15's «a choice, then the MainButton» has
    them. «Каса»'s fix ways keep their own look (the fold, the accent
    pressed).
  - **The quiet button** (`.quiet`) takes the secondary's type, 15/600 and
    44 — it was 16/650 and 48; its transparent face as before. Standing in
    a smaller line («Оформити повернення» under a sale, «Шукати там») it
    reads at 15 too — it took the line's 13 or 14 before.
  - **Before a store** («Вхід через Telegram», «Магазинів поки немає», a
    store that stopped trading): «Спробувати ще раз» the text button, as
    S03's — three places.
  - **A server back** (the banner's «Оновити»): left the secondary;
    §6.23's text button not taken here (the banner is the orders-cash
    TZ's).
  - **A row, a picker's line, a tray, a tag or a size's cell that is a
    button** reads in the body's 16, as before — not a button's 15: its
    own lines keep their sizes.
  - **The supplier picker** (review): in its own sheet «Додати
    постачальника» is that sheet's main, and «Повернути постачальнику»
    hides Telegram's MainButton while the sheet is over it, showing it
    again once the sheet is gone; inside another sheet («Як надійшов»,
    «Брак»'s supplier step), whose foot or MainButton is the main, it is
    the secondary.
  - **Not done here** (review, low): outside Telegram the page's own main
    stays drawn under a modal sheet with a main of its own — the
    customer's dock «Внесок» under the write-off and erase sheets,
    «Закрити касу» under the count's confirmation; dimmed, not reachable.
    Inside Telegram the MainButton is hidden there already.
- **A field** (frame P1-1, spec §6.6): the corner 8; what is typed 16/400
  — never the label's 700 now; the card on the paper, the fold inside a
  white block (a sheet, the pay panel, a dock, a list's block), a field of
  its own look (the keypad's sum) keeping it. A search in a sheet takes
  the fold too (review); on the paper it stays the card.
- **The focus ring** (frame P1-1): 2 at 2 for every control; inside a tag,
  inward as before (−3; the drawer's ink tag −4); the switch's track 2 at
  2. No ring of 3 is left.
- **What is said under** (frame P1-1, spec §5.5 `meta`): `small`, `.hint`
  and «Ще»'s `.more-meta` 14/500 in pencil; a label 14/700.
- **No weight but the roles'** — 400, 500, 600, 700, 800: every 650 is 600
  (a row, a verb) or 700 (a label, a day's heading, a picker's label); a
  journey reads the stylesheet for it. The two 750s the TZ did not count
  — a debt's sum on its row and the drawer's difference — are 700, the
  nearest role (decided here; §4 has money as list text at 600, left to
  their sections).
- **One Unread** (frame P1-2, spec §6.23): a read that failed is the shared
  plate — the warning's, one line in the screen's words, the secondary
  «Спробувати ще раз» — never a bare alert. `Unread` takes two things it
  lacked: `held` (asked again, not answered yet: no second ask) and lines
  under its line (only «Каса»'s close while the server does not answer).
  - The 11 yellow copies of its markup are `Unread` now (Returns ×3,
    Closed, Catalog, NewModel, CatalogPicker, FromCatalog, Sale,
    paperMark, Cash); their words and retries as before.
  - **«Покупці»'s 8 red copies** (Credits ×4, Customer ×3, Debts) are
    `Unread` too, here: the frame TZ gave them to the sale TZ's P1-2 and
    that pointed back at the frame's rule — red for a read was the
    defect.
  - **The lint** (`eslint.config.js`, `no-restricted-syntax`): an element
    whose own `role="alert"` holds a `readText(` call, at any depth, is an
    error outside `shared/Unread.tsx`; it does not see `role={"alert"}` or
    a text read into a name first (review). On now, not after the sections' tasks as the TZ
    put it: the 8 goods places (FamilySearch, Model, Receive, Stock,
    Stocktaking, Openings, SuggestedPrice ×2) carry a marked exception
    each, «goods P1-1 moves it onto Unread», so a new copy anywhere fails
    at once.
- **«Магазини»' kept stub** (frame P1-2): «Зміну стану магазину ще не
  підтверджено», its button «Перевірити результат зміни»; its body, its
  time line and `byItself={false}` as before. The catalog's kept stub
  still says «Незавершена операція каталогу» — goods P1-4's words, not
  this task's; frame P1-2's third criterion waits for it.
- **One Empty** (frame P2-1, spec §6.28): `shared/Empty.tsx` — the blank
  tag at 64 in the edge, one line 17/600, a line of meta when needed, what
  the place offers under it; drawn as a section headed by its line when
  the screen focuses it; `hidden` hides it whatever its own display.
  «Сьогодні»'s «Вас нічого не чекає.» is on it, «Зроблено сьогодні» the
  section's gap of 8 under its line, as before.
  - Beyond the TZ (same markup, nothing else changed): the 9 empty places
    already drawn as `orders-empty` — Borrowed, Suppliers, SupplierList,
    Invoices, Damaged ×2, Returns ×2, Orders' «Замовлень ще немає.». The
    orders' search with nothing found (no mark) is left to orders-cash
    P2-3; the bare `.empty` places to their sections' tasks.

## Chosen in chat — 2026-11-10 (audit after stage 2, batch 4: every place read its shape in grey, «Завантажуємо …» said to a reader alone; a screen opened at its top, by its header; the goods' reads that failed on the warning's plate; frame P1-4, P1-3, goods P1-1)

Chosen in chat on 2026-11-10 («Yes, start batch 4»), after batch 3 (#185)
was merged. No right, no server rule, no field changes; words change only
on two buttons, as the goods TZ has them (approved with it).

- **One shape a place read** (frame P1-4, spec §5's skeleton, §6.27): the
  shared `Placeholder` draws each as the real element stands — a list's row
  64, with a round mark 40 or without; a tag 76 of a line and its meta; a
  store's tag 96, its eyelet on top; a field 52 under its label, the
  field's corner 8; a row of size cells 60 × 60, the cell's corner 6; a
  row of choices, the chip's corner 14, in the real row's own class; the
  model tags with their cells, as before. The grey's own corner 10 is never
  on a shape that has one of its own, and every shape is the one grey —
  the mark's too, never its fold (review). The sweep as before.
  - **«Завантажуємо …» is said to a reader alone** (`visually-hidden`),
    never drawn, in every place the `Placeholder` holds.
  - **The five places no section took:** «Магазини» — two stores' tags;
    «Нова модель» — a row of four cells, unless sizes typed by hand stand
    there already (then the real row, the words said to a reader); «Брак»'s
    warehouses — two choices in grey, 44 high as its chips (decided here:
    the TZ says «rows», but the real element is a row of chips, as
    «Повернення»'s warehouses, whose grey chips stood already); the price
    on «Прийшов товар» and in the price sheet — a field row (a label and a
    field 52).
  - **Two shapes no screen uses yet** — the row with a mark and the tag
    76 — stand in the `Placeholder` for the sections' tasks that take them
    (goods P2-2, money P1-3); a journey measures them against the design.
  - Left as they were: the 21 visible «Завантажуємо …» places the sections'
    TZs took (goods P2-2 — 12, money P1-3 — 8, sale — `FromCatalog`).
- **A screen begins at its top** (frame P1-3, spec §6.2): one reset, in
  `ScreenHeader`, before the screen is painted — whenever a header is
  drawn, its title changes, or the screen it says it stands for. That is
  every screen opened: a tab, a «Ще» row, a «Сьогодні» tag, a row's card,
  «←» and Telegram's «Назад».
  - **Within a screen the place stays:** a sheet, «Показати ще», a switch,
    a filter, a search draw no header of their own and change no title (no
    header stands in a sheet; each mode switch is under its screen's one
    header).
  - **A title of parts** — a mark beside it, a button in it («Сукня і ще
    2») — is not a screen's name: its header's coming is, so opening the
    rest of a debt's goods does not move the page.
  - **A screen that says which it is** (`screen`) is put at its top when
    it is another than the last so put, never when it is drawn anew as the
    same (review): **an order's card** says its order — read again with its
    status or its waybill moved on, or after a step, it is drawn afresh and
    stays where it was read to; the same waybill's other order opens at its
    top. **«Змінити спосіб оплати»** says its list and an operation's card,
    under one title, so a row tapped low on the list opens its card at the
    top.
  - **Removed**, the frame's now: the four the TZ names — the waybill's
    other order (`App.tsx`), «Магазини»' two (its heading still takes the
    cursor back on the list), «Резервні копії»' — and the sales report's
    own for a screen of its own.
  - **A screen that falls open where it was left** — «Закриття»'s list,
    the report's table, a list's row back from its line — puts itself
    there after the header's reset, before it is painted (a layout effect),
    so nothing flashes at the top, after Telegram's «Назад» either
    (review). «Моделі»'s row back from its model is focused just after the
    paint, as before: taken before it, the focus did not hold (two
    «Моделі» journeys).
  - **Left** (decided here): the 14 other resets of their own (suppliers,
    invoices, «Каса»'s count and close, the stocktake ×3, a list's line,
    the lists ×4, a debt, a customer) — each redundant or at a step the
    header does not see; not the TZ's four.
- **The goods' reads that failed are the warning's plate** (goods P1-1,
  spec §6.23): the 8 places the lint held — «Інший колір нашої моделі»'s
  search, the model's detail, «Прийшов товар»'s warehouses and sizes,
  «Залишки» (three), «Інвентаризація»'s warehouses and sizes, the check
  that no list waits at a warehouse, the price on «Прийшов товар» and in
  its sheet — are `Unread`; the lint has no exception left.
  - **Words** (the TZ's, approved with it): «Повторити пошук» and
    «Перевірити ще раз» → «Спробувати ще раз». The check's retry was quiet:
    the secondary now, as every plate's.
  - **The model's detail that could not be read** heads the screen with the
    name it was opened by and its «←» (a screen opened from another, 28),
    over the plate.
  - The search's retry waits while the screen is held, as before.

## Chosen in chat — 2026-11-10 (audit after stage 2, batch 5: one mode switch; the menu's pill and word; every corner on the scale; nothing left of what no screen draws; one sticker, its glyph brought by its meaning; frame P1-1 part 2, P1-5)

Chosen in chat on 2026-11-10 («Yes, start batch 5»), after batch 4 (#186)
was merged. No right, no server rule, no field, no word changes. With it
the frame TZ after stage 2 is built whole but for what its sections took.

- **One mode switch** (frame P1-1, 5; spec §6.7): the section's ways as
  buttons (`ModeSwitch`) and a choice as radios (`.way-switch`, the
  return's way) one look — 44 high, the fold's track 8 round with 3
  around, equal segments 6 round, the one open the card with its edge,
  15/600 in ink, the others 15/500 in pencil.
  - **A segment is drawn 38 high, its tap the track's whole 44**
    (decided here): the spec's 44 is the switch, and a tap is never under
    44 (direction §4, «касание ≥ 44»). A button's tap reaches over the
    track's 3 above and below it; a radio's input does the same.
  - **Left**: «Початкові залишки»' three counts at 14 in two lines where
    they must, until the list's own screen is drawn anew (goods P0-1); its
    ⋯ now as high as the switch beside it, not the old track's 52.
  - A long word in a segment is cut with «…» on its own span (the price's
    store, the report's stores), never wrapped; the button keeps the tap.
- **The menu** (frame P1-1, 6; spec §6.3): the open tab's pill 8 round,
  its word 13/700, the others 13/600, the word in the tab's role `.t-tab`.
- **Every corner on the scale's tokens** (frame P1-1, 7), each by the role
  of what it is: a button, a field, the search, a choice (chip), a
  stepper's −/+, the till's pay ways, «Повернути товар», ⋯, the count's
  sum field — 8; a block or a card («Борги»'s owed card, a return's
  «Цілі» / «Пошкоджені», the old section block, data's age) — 4; a
  sticker's grey and the debt's bar — 3; the sheet's handle, the toggle's
  track and knob and every 999 — round; the pay panel and the result's dock
  — the sheet's 16, as before; the grey's own 10 stays (batch 4), now the
  scale's 10. A choice's grey follows the choice to 8.
  - **Left** for their own task (orders and «Каса» TZ after stage 2,
    P2-4, which sets their heights too): `.cash-panel-button`,
    `.skeleton-way`, `.cancel-ask`, `.same-waybill`. A journey reads the
    sheet: no other corner off the scale.
- **Nothing left of what no screen draws** (frame P1-1, 9): `.t-button`,
  `.size-count`, `.owed-mode`, `.pay-amount`, `.pay-confirm`,
  `.order-status`, `.order-sent-with`, the base `header` and its `> span`.
- **The page before the app** (frame P1-1, 10): 560 wide, as the app's
  content; its plate's corner 4.
- **One sticker** (frame P1-5; spec §6.18): the shared `Sticker` — 28 high,
  corner 3, a glyph of 16 and a word of 14/600 — and nothing else draws a
  status; ESLint holds it (no `sticker` or `badge` class written by hand).
  - **The glyph comes with the meaning**: a debt — the arrow with a minus;
    a warning and paper — the triangle; a kept operation not yet confirmed
    — the dashed eyelet; paid or recorded — the check in a circle; on its
    way — the parcel in motion; held or online — the pin. A screen may draw
    another of the same meaning (an order at the post office its building,
    a settled invoice its check), never none. Grey and neutral ones draw a
    glyph where they did (an order cancelled, come back), none where they
    did not.
  - **Words and colours as they were**, but two (decided here): the mark
    of a sale typed from paper on a lost sale's settled answer was ink on
    the fold — now paper's warning with its triangle, as on the receipt
    and the returns' row; and «Сплачено» on a debt and on a customer now
    draws its check.
  - **«Збіглося» stays the paid's green with its knot** — on the close's
    stub and in «Закриття» — until the till's own match colour comes
    (orders and «Каса» TZ, P1-4).
  - **Never shrunk**: «Закриття»'s 13, a correction's and an order row's
    13, «Гроші»'s store state 13 at padding 6, the close's stub's 20/700
    at 32 high, a list's state at padding 2 — all the one 28 and 14/600.
  - Said by the way in pencil (a store's name, «Усе вже повернено»,
    «Списано») is `neutral` — the spec has no such tone; it keeps its look.
    «Списано» on a debt keeps it too, though the spec names the offline
    grey for it (§6.18): the task changes no colour but paper's mark; the
    difference is named in the batch's report, «Not covered».
  - **28 on one line, a long one wraps** (decided here; the spec's padding
    is 0 8): 5 above and below a line of 18, so a sticker that must wrap at 360 grows a line of 18
    and its words never touch its edge. In a line of text it sits on the
    line's middle.
  - **No «брак» tone yet**: no screen says a status of damaged goods in a
    sticker; the torn tag comes with the first one that does.

## Chosen in chat — 2026-11-10 (audit after stage 2, batch 6: «Каса»'s pack — what was recorded a line with its eyelet; to the kopeck the till's match, a line's difference with its sign; one context line; the history's thread; the blank tag; the docks' 52 and every corner on the scale; orders-cash P1-3, P1-4, P2-1, P2-2, P2-3, P2-4)

Chosen in chat on 2026-11-10 («Yes, start batch 6»), after batch 5 (#187)
was merged. No right, no server rule, no field, no word changes; the
money's sums, signs and blind count are as they were.

- **What «Каса» recorded** (P1-3; spec §2 P3): the line under «Каса», the
  count and the close's result — «Записано: …», «Записано до закриття …»,
  «Спосіб оплати змінено: …», «Причину записано…», «… записано один раз» —
  is an order's step line: its eyelet filled in ink, its words 600, still
  `role="status"`, gone with the next action as before. One component,
  `cash/DoneLine.tsx`.
- **To the kopeck the till's own match** (P1-4; owner's В4 (а), the design
  decision of 2026-10-28; spec §6.18): «Збіглося до копійки» on the close's
  stub and «Збіглося» in «Закриття» are the sticker's `match` tone — the
  thread on ink in the light theme, ink on the thread in the dark — its
  glyph the knot, brought by the tone. The paid's green is no longer theirs.
  - **A difference said in a line has its sign** (decided here, by the
    task): an old close's card and «Каса»'s own line of today draw the
    triangle before «Нестача» / «Надлишок» and the knot before «Збіглося до
    копійки», 16, in the line's colour; the line's colour stays — the
    warning's, and the accent's green for the match in text (2026-10-28).
  - **Found and set right:** batch 5 narrowed the line's rule to
    `p.cash-difference`, so «Каса»'s own line of today — a span — lost its
    700 and its colour. Its rule is every difference but the sticker now.
  - «Сьогодні» names a close only when it owes a reason, never one to the
    kopeck: nothing there to match.
- **One context line** (P2-1; spec §2 P2): under the title, the screen's
  one line, no second one —
  - the order's card: «{Магазин} · {Ім’я} · замовлено 13.10 · № {8}», the
    number small as the owner chose (В1); the header's line takes markup
    after the person for it. **Decided here:** at 360 the line holds two
    lines where it has the width; beside «Змінити магазин», kept at its
    right as on every screen (spec §6.2), a store named as long as
    «Основний» takes a third — the button is not moved under the line for
    one screen;
  - the close's result: «{магазин закриття} · {хто рахував} · закриття
    03.11» (decided here: the store always, not only another's; who counted
    by the close's own name); while the close is read, the store's line;
  - a close opened from «Закриття»: «{магазин} · 20:14 · Оля».
- **The history's thread** (P2-2; spec §6.21): «Видано й внесено після
  закриття» and «Історія доставки» — the day at the left, an eyelet filled
  on the thread, what it was 16/600, who and when in meta, a cash sum on
  the right with «−» / «+». Order as before: the drawer's as the server
  answers, the delivery's first version first (§10 of the task list: newest
  first waits for the sellers' answer).
  - **Decided here:** a movement of today has its time at the left; one of
    an earlier day its day there and its time first in the meta, so no
    moment is lost; a delivery version its day at the left, its time in the
    meta, how it went a line in ink under what it was.
  - **Decided here:** the day's column is the thread's shared one, 44 and
    its gap of 8 — 52 to the thread, as a customer's and an invoice's
    histories draw it; the sum in the thread's own place for it.
- **The blank tag** (P2-3; spec §6.28): «Касу цього магазину ще не
  закривали.», «Після останнього закриття ви ще нічого не провели.»,
  «Цього дня грошових операцій не було.» — the shared `Empty`; «Оберіть
  день.» stays the field's hint.
  - **Decided here:** «Доступних складів немає. Зверніться до менеджера.»
    on «Нове замовлення» is the line «Доступних складів немає.» and its
    meta «Зверніться до менеджера.» — the same words, a sentence each. The
    till's own words of it are the sale's task list's (P1-2).
- **The docks' 52 and every corner on the scale** (P2-4; direction §4;
  spec S26 №9): «Закрити касу», «Записати причину» (on the result and on
  «Каса»), «Змінити на «…»» and «Прийняти повернення» — the main button's
  52 and corner 8. The MainButton's own place outside Telegram on an
  order's card stays 50 with Telegram's corner 10 (spec §6.4). A way's
  place is 54 high, the ways' own height, corner 8.
  - **Decided here, by the review:** a way's lines are set, 18 and
    «зараз»'s 14, so the way with «зараз» under it is 54 on any font, not
    the font's own.
  - «Скасувати замовлення?» a card, corner 4; the same waybill's plate,
    corner 4. No corner off the scale is left.
  - The rows of «Закриття», «Змінити спосіб оплати» and the same waybill,
    and the new order's tray, have the set's chevron 16 in pencil, never a
    «›».

## Chosen in chat — 2026-11-10 (audit after stage 2, batch 7: «Замовлення»'s pack — the shared search field, the rows' places as tags, those to be sent under their warehouses at once, the blank tag; the goods come back a task's screen with Telegram's MainButton; a next page that failed one retry; orders-cash P1-1, P1-2, P2-6)

Chosen in chat on 2026-11-10 («merged go next»), after batch 6 (#188) was
merged. No right, no server rule, no field, no word changes: what a return
sends (`reason`, `physically_received: true`), the warehouse each coat goes
back to, the grouping by warehouse and what each group holds are as they
were. The orders and «Каса» task list after stage 2 is built whole with
this batch.

- **The search field** (P1-1; spec §6.6): «Замовлення»'s waybill field is
  the shared `SearchField` — its name «Номер ТТН» heard, not a line over
  it; «Номер ТТН» its hint (the server searches the waybill alone, not an
  order's number: S16's «ТТН або номер замовлення» is not taken); the
  magnifier; «×», which does what «Очистити» does — the field emptied, the
  cursor kept in it, the list back. From two characters, Enter at once, as
  before.
- **The rows' places are row tags** (P1-1; spec §6.27): while the open,
  the closed or the found orders are read, three grey row tags 76 in the
  order tags' own list, where the rows come — the shared `Placeholder`'s
  line tags, now the order tag's own shape (`order-tag tag-row
  tag-outline`, as «Брак» drew its places by hand; «Брак» takes it).
  - **Decided here:** to be sent, for whoever reads the stock, a grey
    label's place over them, as tall as «Склад «…» · N»: the first row
    comes under its label where its place stood.
- **Those to be sent under their warehouses at once** (P1-1): while the
  warehouses are read, the rows' places, never one list the labels come
  over later — no row moves once shown. The warehouses refused, or a line
  from one not read: one list, as before (the rule of 2026-11-01).
  - Read again after a refusal — the app come back, a step recorded — the
    rows shown stay: the places stand only until the warehouses are first
    answered (review).
  - A tap as the places give way to the rows is let go, as a tap as the
    labels came (review).
  - A long warehouse's name in its label breaks, never past the screen.
- **The blank tag** (P1-1; spec §6.28): «Тут посилок немає.», «Зараз
  нічого не треба відправляти.» and «За «…» замовлень не знайдено.
  Перевірте номер ТТН.» are the shared `Empty` — the blank tag 64 in the
  edge, the words as before; «Очистити» the found's one button. «Посилок до
  відправлення немає. Вставте повідомлення з чату…» (spec §6.28) waits for
  Q-4.
- **The card's place while it is read** (P1-1): the string of knots — the
  four hollow on the thread, each word and the day under «До
  відправлення» a grey line of its own size, the words drawn unseen — then
  «У посилці»'s place and two lines, in the card's own flow: what comes
  under the string stands where its place stood. The pill's place is gone
  (the card has none).
  - **Decided here:** the line under the title holds «замовлено … · № …»
    grey, so it wraps as the card's at 360.
  - Opened from its row, the order is known (review): a cancelled or come
    back one holds its sticker's place under the string, and one the server
    keeps no day for has no day's place, neither under «До відправлення»
    nor «замовлено» in the line. Opened another way (the same waybill's
    other order, from its plate), the places as for an order to be sent.
- **The goods come back, a task's screen** (P1-2; В-ЗП6 (а)): while
  «Товар повернувся на склад» is open the menu steps aside (as on every
  task screen of stage 2) and «Змінити магазин» is held; the line under
  its title is «{магазин} · {товар, as the card's title}»; the window that
  repeated the goods over the button is gone.
  - «Прийняти повернення» is Telegram's MainButton, held until the reason
    and the tick, turning while the server answers; the card's MainButton
    is put away while the step is open. Outside Telegram, the dock's one
    button — the MainButton's place, 50 with Telegram's corner 10 (spec
    §6.4), as the card's — its eyelet turning while it is answered.
  - Telegram's «Назад» is «← Замовлення», as before; while the return is
    answered it is hidden and the app's «← Замовлення» held, so the screen
    and what was typed stay until the answer (review). The order of the
    rest, the focus on the title, the keyboard only at the reason's tap —
    as before.
  - The line at 360: two lines where it has the width; beside «Змінити
    магазин», kept at its right as on every screen, a long product takes a
    third, as batch 6 decided for the order's line (review).
- **A next page that failed** (P2-6): on «Замовлення» (to be sent and the
  other open places, «Клієнт забрав», the cancelled and come back, and a
  waybill's search) and on «Закриття», the next page that could not be
  read is one warning plate where «Показати ще» stood, its «Спробувати ще
  раз» reading that page; the rows read stay. A whole list read again and
  refused is said over its rows, as before.
  - The page's failure is kept until the list is read with no error
    (review): a whole read again meanwhile — the app come back, a step
    recorded — still says it at the foot, its retry held until answered,
    never over the rows; answered, «Показати ще» is back. One hook,
    `shared/nextPage`, for «Замовлення»'s lists and «Закриття».

## Chosen in chat — 2026-11-10 (audit after stage 2, batch 8: «Внесок»'s and «Покупці»' search the shared field; the till's and the debts' empty places the blank tag, a block's «Не вдалося прочитати» a warning's line; S22's way back quiet under Telegram's MainButton; Telegram asks before closing for a return counted or kept and a payment kept; the paid bar and the price's error in their meanings' colours; sale P1-1, P1-2, P1-5, P2-1, P2-2)

Chosen in chat on 2026-11-10 («merged go next»), after batch 7 (#189) was
merged. No right, no server rule, no field changes; no word changes but
where a sentence of two is split into a line and its meta. Sale P2-4
(«{Ім’я} · винні всього {сума}» in a sheet) waits for its words'
approval; P1-3, P1-4, P2-3 and P2-5 are later batches.

- **The search field** (P1-1; spec §6.6): «Внесок» and «Покупці» search
  with the shared `SearchField`, as the till and «Повернути» do — «Ім’я
  або телефон» its name heard and its hint, no line over it; the
  magnifier; «×», the field emptied and the cursor kept in it. Inside the
  same `form role="search"`: from two characters after the pause, Enter at
  once, as before. In «Магазини, що не працюють» the field takes a
  number's keys (`inputmode="tel"`), the only search there being a whole
  number.
  - A letter more, or «×», forgets an Enter, as «Очистити» does: the same
    letters typed again wait for the pause — the return's and the orders'
    rule (review).
  - At the till, «Внесок»'s field stands where «Знайти модель» and «Що
    повертають?» stand: switching the segment moves nothing under the
    finger (review).
  - «Магазини, що не працюють» is the section's caption (`t-label`, 13/700
    in capitals) with the quiet «← У цьому магазині», as the return's.
  - The old form's `.search` rules and `.till-search input` are gone; a
    journey holds that nothing of them is back.
- **The blank tag** (P1-2; spec §6.28): the shared `Empty` — the tag 64
  in the edge, a line 17/600, at most one line of meta — stands for
  - the till with no warehouse («Доступних складів немає.» / «Зверніться
    до менеджера.»), with no goods on one warehouse or on all («На складі
    «…» зараз немає товару в обліку.» / «Поки власник не затвердить
    початкові залишки, продавайте на папері.»);
  - the till's search found nothing («За «…» {де} нічого немає.» /
    «Перевірте назву або очистіть пошук.», with «Очистити») or has no goods
    («{Де} зараз немає товару в обліку.»); «Товар у руках, а в списку його
    немає? Знайти в каталозі» stays under the tag;
  - «Внесок»'s and a single store's «Покупці»' found nothing («За «…»
    боргів не знайдено.» / «Перевірте ім’я або введіть номер телефону.»;
    a whole number: «За цим номером у цьому магазині боргів немає.», and
    to the seller «Внесок приймає магазин, де продали.»), and the closed
    stores' found nothing;
  - «Зараз ніхто не винен.» / «Борг з’являється, коли продають
    частинами.», its «Новий продаж» as before; to whoever only reads, «Зараз
    ніхто не винен цьому магазину.».
  - **Decided here:** «Очистити» is quiet, as on «Повернути» and
    «Замовлення»: the TZ's «вторинна кнопка» read as the tag's one button,
    not the filled secondary — beside it nothing else is pressed.
  - **Decided here:** a sentence of two is split at its full stop, the
    first the line, the second the meta; no word changes.
  - «Борг магазину, що зараз не працює? Шукати за цим номером» under the
    tag stands centred with it, as the return's offer (review).
  - In a network's «Покупці» each store's block keeps its lines («Нікого
    не знайдено.», «Сплачених боргів тут немає.», «Списаних боргів тут
    немає.») and its first weeks' words: the tag is for the whole list
    (the rule of 2026-11-01). The first weeks' words are one copy, drawn
    as the block's line or as the tag (review).
- **A block that could not be read** (P1-2; spec §4): «Не вдалося
  прочитати» in a store's block header is a warning's line in its place —
  the triangle 16, the warning's colour, no plate and no crossed circle —
  never the danger's: what is owed is not wrong, only not read. Its retry
  as before.
- **S22 inside Telegram** (P1-5): while «Відкрити борг» is Telegram's
  MainButton, the way back (`{backTo}`) is quiet under the stub, so the
  screen has one main; outside Telegram the way back is the one primary,
  «Відкрити борг» quiet, as before. Frame P1-1 had already made it the
  secondary; now quiet. The MainButton's word waits on its reading
  («Відкрити борг» against the spec's «Готово»), as before.
- **Before closing** (P2-1; В-Т7 (а)): Telegram asks before Бірка closes
  - while units are counted on a return («Цілі» or «Пошкоджені» above
    none), the first send included, until the result shows;
  - while a return or a payment whose answer was lost is kept on the
    phone — after a reload too, the form gone — until it is checked.
  None counted and nothing kept, it lets go.
- **The meanings' colours** (P2-2; spec §6.24, §4):
  - the paid bar «Сплачено X з Y» on S20, S21 and a debt's detail: 6 high
    with the sticker's corner 3, its track the fold with a 1 px hairline,
    filled in the paid's colour — never the hand's accent. The supplier's
    invoice draws the same bar (it shares the class); its own fill rule,
    the same colour, is gone (review).
  - **Decided here:** the hairline goes round the whole bar and the fill
    stands inside it, 4 of the 6: §6.24's «track `fold` with 1 px
    `hairline`» read as the track's edge (review: seen, kept).
  - «Впишіть ціну: гривні й копійки, напр. 1850 або 1850,50.» is the
    danger's colour with its crossed circle 16 before it, never the debts'
    colour; wherever the line's price is typed — the till's basket and
    «Нове замовлення», which share it.

## Chosen in chat — 2026-11-10 (audit after stage 2, batch 9: the till's list kept when a read again or a next page fails, «Показати ще»; one line of context on S21, the return form and «Покупці», S21's «Винні» over the dock at 360 × 640; «Знайти в каталозі», «Розмір з етикетки» and «Продажу немає» in the new system; sale P1-3, P1-4, P2-3)

Chosen in chat on 2026-11-10 («Sale P1-3, P1-4, P2-3»), after batch 8
(#190) was merged. No right, no server rule, no field changes. One word
changes: «Ще товари» → «Показати ще» (P1-4). P2-3's new words wait for the
owner's approval, so its screens change their look and keep their words.
Sale P2-4 («{Ім’я} · винні всього {сума}» in a sheet) still waits for its
words; P2-5 waits for В-П1.

- **The till's list kept** (P1-4; P7, §5; the returns' rule of a list
  read again): what is shown depends on what was read.
  - The first read failed, nothing read: the warning's plate in the
    list's place, as before.
  - Read, then a read again failed (back in the app, after a sale): the
    plate over the tags; the tags stay as read and their cells are
    pressed. **Decided here, as the TZ's flag asked:** the cells' free
    counts are the ones read before, named by the plate as not read
    again; the basket sells nothing over the books — the server checks at
    the way, and its shortage sheet answers, as ever. This is safer than
    an empty screen with a coat in hand (inventory-ledger reading).
  - A search that found nothing, or a warehouse with nothing, read again
    and refused: its blank tag, «Очистити» and the catalogue's way stay
    under the plate (review).
  - While the plate over the tags shows, «Показати ще» is held: its retry
    reads the whole list first, never a page on top of free counts gone
    stale (review).
  - The next page failed: the plate under the tags read, where «Показати
    ще» stood; its «Спробувати ще раз» reads that page alone
    (`fetchNextPage`, offset 100), never the list from the start.
  - «Ще товари» → «Показати ще», every list's word; «Нове замовлення»
    shares the list, so it says it too, and the journeys' helpers press
    it. «Ще товари» stays in the catalogue picker and the supplier's
    return: their passes' (a line in the TZ's observations).
  - The till and «Нове замовлення» no longer pass their own failure in:
    the list draws its plates itself.
- **One line of context** (P1-3; P2's budget, S19, S21): the header's
  line names what the screen is about, in the store's and the person's
  place; no paragraph of its own under the title.
  - S21 (the till's payment): «{покупець} · «{магазин}» · з {дд.мм}», the
    debt's own store in it; the `debt-context` paragraph is gone there.
    A debt's detail keeps its own line with the phone to call, and a
    closed store's debt keeps its plate «Продано в «…» …».
  - The return form: «Продаж {дд.мм, гг:хх} · {сума}», « · магазин «…»»
    when sold in another store; «← До списку» over the title, as on S21
    and stage 2's task screens, the same words; Telegram's «Назад» stands
    for it, as before.
  - «Покупці»: «Ті, хто купує частинами»; «Змінити магазин» stays at the
    line's right. At the till («Внесок») the line keeps the store and the
    person, as before.
- **S21 at 360 × 640** (P1-3; spec §6.25, the cash count's rule): below
  700 px of stable height the keys are 44, the sum's field 64. The keys
  alone left «Винні» under the dock, so, as the TZ's fallback says,
  «Винні» and its sum stand on one line in `money-l` (32/34), «Винні»'s
  words on the sum's baseline (review), «Сплачено X з Y» and its bar
  under them. Above 700 px nothing changes.
- **The till's rare screens** (P2-3; §5, §6.13, §6.27, §6.30; stage 2's
  screens, words to approve):
  - «Знайти в каталозі» is a part of the till, no card and no heading of
    its own; its words as before (the one-line hint «На складі «…» його
    немає в обліку.» waits for approval, and so does «До списку» for
    «Назад до списку»). With two warehouses or more, which one the coat
    leaves is asked by deciding chips 44 under «З якого складу
    віддаєте?», none chosen beforehand, the chosen one in the chosen
    colours — the seller's choice, never the till's (2026-09-17); the
    system's list and «Оберіть склад» are gone. The model's sizes are the
    till's cells 60 × 60 with no count under the letter — the books know
    none — a tap puts one coat in the basket, as before; while they are
    read, four grey cells in their place, «Завантажуємо розміри…» said to
    a reader alone. The taps: the link, the warehouse's chip (two or
    more), the model, the cell — as before; the sale's body as before.
  - «Розмір з етикетки» in the basket: deciding chips 44, «Не читали —
    продати як «розмір невідомий»» chosen by default as the list's empty
    choice was, then the model's sizes; a chip sends the same `size_id`
    the list did. The visible «Не читали» waits for approval: the chip
    says the whole words until then. While the sizes are read, two grey
    chips; a read that failed leaves «Не читали» alone, as the list did,
    and says so in the sheet with the warning's plate and its retry
    (review) — the till's own plate behind the sheet stays. Each row is
    read with its caption and its line's model, two lines whose size is
    not known told apart (review).
  - The chosen chip of either row is drawn in the pressed chip's own
    colours, which are the chosen ones in both themes: no rule of its own
    (review).
  - «Продажу немає»: «Нічого з кошика не було на полиці.», then the stub
    torn off (recorded, its eyelet filled) headed «Нестачу записано», a
    line a model — «{Модель} · {розмір}» and «Знято з обліку: N шт.» or
    «Облік і так не мав цих одиниць — нічого не знято.»; «Перевірте склад
    із менеджером.» its one line; «Новий продаж» in the receipt's dock.
    The shortage is the server's record; the screen only names it.
    **Decided here:** the sentence «Нічого з кошика не було на полиці.
    Нестачу записано.» is split — its second half heads the stub; no word
    changes.

## Owner decision — 2026-11-11 (the questions of the audit after stage 2)

Answered in chat on 2026-11-11, after batch 9 was opened as #191. Each
answer replaces the default the batches were built by until then.
- **В-П1 — a write refused says what happened, then the step (б).**
  Never «спробуйте ще раз» on a write; «Спробувати ще раз» stays only
  where something was not read. The sale tab's words (sale P2-5, now
  unblocked):
  - the till: «Дані змінилися, поки ви працювали.» + «Кошик збережено —
    нічого не продано. Натисніть спосіб оплати ще раз.»;
  - a return, the data changed: «Дані змінилися, поки ви працювали.
    Поверніться до списку й відкрийте продаж знову.» + «Нічого не
    повернено.»; a return checked: «Перевірте, що повертають.»;
  - a payment, the debt changed: «Внесок не записано. Дані боргу
    змінилися, поки ви працювали: перевірте залишок.»; the sum: «Внесок
    не записано. Перевірте суму.» (a write-off: «… Перевірте причину.»);
  - erasing a customer: «Дані покупця не стерто.» / «Дані покупця не
    стерто: борг щойно змінився — перегляньте його.».
  The words never promise what did not happen: «не записано», «нічого не
  продано», «нічого не повернено» stay.
- **The same rule reaches every section** — the catalogue, stocktake,
  receiving, «Брак», «Початкові залишки», suppliers and stores: their
  write refusals are rewritten by the same pattern in later batches, each
  batch listing its words in its report. **The kept operations' words
  stay** — what a sale, a return or a payment kept on the phone says when
  the server refuses it later (`frontend/src/cash/errors.ts`, the owner's
  decision of 2026-10-18).
- **Sale P2-3's words approved:** «Знайти в каталозі» says one line, «На
  складі «{склад}» його немає в обліку.» (the shortage sheet says the
  rest at the way of paying); «До списку» for «Назад до списку»; the
  label chip shows «Не читали», a reader still hearing «Не читали —
  продати як «розмір невідомий»».
- **Sale P2-4's line approved:** at the till, which debt a payment goes to
  is chosen in the sheet «На який борг вносить?», as on the customer's
  card; under its title one line «{Ім’я} · винні всього {сума}» — this
  store's sum only, never the network's; none in «Магазини, що не
  працюють», as now. P2-4 is unblocked.
- **В-ГР1 — «4 людини» (а):** those who owe are «людини» next to the sum
  on «Сьогодні», «Гроші» and «Ще», as in the design (S29). Nothing changes.
- **В-К1 — the day's tag folds below 700 px only (б):** as in the design;
  on an ordinary phone the work tags come after a short scroll. Nothing
  changes.
- **В-ТА1 — no «Відкласти під замовлення» on a model's page (а):** orders
  start from «Замовлення», as now.
- **Goods P0-1 approved** (the goods task list after stage 2): the
  «Початкові залишки» list opens on its tag and its lines; «Додати файл»,
  «Додати рядки вручну», «Файли списку» and «Відхилити список» go under
  the tag's «⋯»; the approval's summary moves into the sheet «Затвердити
  «{список}»?»; «Відхилити список» a sheet with its reason required and
  «Залишків цей список не змінить.». It replaces batch 11's «The files
  stay above the lines» and «The summary … stays above; «Відхилити
  список» is as it was». Who approves and rejects, the required reason
  and the warehouse waiting while the list is open do not change.

Not built by these answers; each waits for its batch: sale P2-4, sale
P2-5, the other sections' write refusals, goods P0-1.

## Chosen in chat — 2026-11-11 (audit after stage 2, batch 10: the «Початкові залишки» list on its tag and its lines — «← Початкові залишки», the tag's ⋯ with only what the person may do, the waiting's one line, a file's lines named over the switch; «Файли списку», «Додати файл» and «Додати рядки вручну» screens of their own; «Відхилити список» a sheet; the approval's summary in its sheet; the section's write refusals by В-П1 (б); goods P0-1)

Chosen in chat on 2026-11-11 («Yes, start batch 10»), after the owner's
answers (#192): goods P0-1 as the owner approved it, and the write refusals
of the screens it touches by В-П1 (б). No right, no server rule, no field
changes. Who approves and rejects, the reason required, the last file never
removed, the limits, the warehouse waiting while the list is open and the
approval never undone stay as they were. This replaces batch 11's «The
files stay above the lines» and «The summary … stays above; «Відхилити
список» is as it was» (2026-11-08), as the owner's answer says.
- **The header** (P2, §6.8): «← Початкові залишки» over the title, the
  arrow hidden from a reader, who hears «Назад до «Початкові залишки»»;
  Telegram's «Назад» does the same; from «Сьогодні»'s tag it leads where
  «До списків» led.
- **The tag** (§5): its warehouse with ⋯ on the same line, its sticker, its
  meta and progress as before, and one line inside it: «Поки список чекає
  рішення, на складі «…», де ще не було руху товару, нічого не приймають,
  не продають і не виправляють.» The tail «Затвердіть або відхиліть його.»
  / «Відхилити його можете й ви.» is gone: MainButton and ⋯ say what may
  be done. A store that does not trade keeps its plate «Магазин «…», що
  почав цей список, не працює: …», as the TZ says.
  - **Decided here:** ⋯ is named «Дії зі списком» to a reader (no visible
    word); it shows only when the sheet would hold something.
- **⋯'s sheet**, titled the list's name, only what the person may do:
  «Додати файл» and «Додати рядки вручну» (`snapshot:import`, the store
  trading, the list in review; held while the app is blocked); «Файли
  списку · N» where the list has files — two parts or more, or one file —
  as the section stood before; «Відхилити список» (`snapshot:approve` or
  `snapshot:import`, the list in review), in the danger's colour.
  - **Decided here (review):** N is the files still in the list as read on
    the list's screen, not the list's own count — a file whose answer was
    lost is the list's, though the list read before it knows nothing of it.
- **Under the tag at once** the switch of three and «Інші рядки» as they
  were, the lines and «Показати ще». A file's lines are no `<select>`:
  «Показати рядки» on «Файли списку» puts «Рядки файлу «2. {назва}»» over
  the switch, with a quiet «Усі файли» beside it; the line takes the cursor
  coming back.
  - **Decided here:** a part typed by hand says «2. Рядки, внесені вручну»
    there; a part removed meanwhile, « (прибрано)» after its name — the
    part as read now (review).
- **«Файли списку»**, a screen of its own, «← {список}», its heading taking
  the cursor: «Місце у списку: рядків … з … · відповідей … з …» (the same
  words); a tag a file — «N. «назва» · Звідки: …», «Рядки 1–40 ·
  розібрано 12 з 40» (removed: «Рядки 1–40 · рядків 40», struck through,
  in the offline tone) and «Додано: {хто}, {коли}» / «Прибрано: {хто},
  {коли}»; the line of lines its photo shares with other files only when
  there are any, in the warning's colour with its glyph; the verb «Показати
  рядки» and a quiet «Прибрати файл» / «Прибрати рядки» (the words kept);
  «Останній файл не прибрати» as before.
  - Its question in a sheet «Прибрати файл?», the same words, Telegram's
    MainButton «Так, прибрати», no «Скасувати» — «Назад», Escape and the
    scrim close it, the cursor back on the button.
  - **Decided here (review):** refused, the sheet closes at once and the
    screen says why; removed, the list is read again under the sheet's
    eyelet, then it closes — the tag comes back as it now is.
- **«Додати файл» and «Додати рядки вручну»** are screens of their own,
  «← {список}»: the form's old h3 the screen's heading, taking the cursor;
  Telegram's MainButton «Додати до списку» / «Додати рядки» — outside
  Telegram, the dock's one button. The forms, their checks, the file's
  kept command and the lines' draft as before.
  - **Decided here (review):** the room line «Місце у списку: …» on both:
    a list typed in one go has no files' screen to say it, and here is
    where its room is spent.
  - **Decided here:** added, the list is read again under the screen's
    eyelet, then the screen closes — the list never comes back as it was
    before, with «Затвердити» over a line just added (seen at 360 × 640).
  - A list decided, or its store stopped, while a form is open: the form
    gives way to the list (review).
- **«Відхилити «{список}»?»**, a sheet: «Чому відхиляємо», then «Залишків
  цей список не змінить.»; Telegram's MainButton «Так, відхилити», not
  active until a reason is given; no «Скасувати» — «Назад», Escape and the
  scrim close it. Refused, it stays open with the reason and says why;
  rejected, the list is read again under its eyelet, then it closes and the
  tag takes the cursor.
  - **Decided here (review):** Enter in the reason only puts the keyboard
    away and leaves the cursor in the sheet — a rejection is never undone,
    so only the button rejects; the reason is kept by the list while the
    sheet is closed and opened again, and cleared once rejected.
- **The approval** (P0-1, 7): the block «Затвердження» is gone. Under the
  large «N шт.» and «стануть початковим залишком складу «…». Скасувати це
  потім не можна.» the sheet «Затвердити «{список}»?» adds up:
  «{основа}: N рядок/рядки/рядків · N шт.» each basis, «Рядків, де
  відповідь відрізняється від списку: N» when there are any, «Файлів у
  списку: N» when more than one. «Затвердити можна, коли…» is gone; while
  lines wait there is no MainButton, and the tag says how many wait. The
  approval sheet keeps «Скасувати» (the TZ takes it from the other two).
  - **Decided here:** «N рядків» is said in its number's form — «1
    рядок», «2 рядки», «5 рядків».
  - A refused approval is said under the tag (it was said in the block):
    at once, the sheet closed, the list read again behind it; approved,
    the list is read again under the sheet's eyelet, then it closes.
  - **Decided here (review):** what is said under the tag is of its
    moment — gone once the list is decided or a line is opened to be
    answered.
- **The section's write refusals** (owner, В-П1 (б)): what was not done,
  then the step; never «спробуйте ще раз» on a write. Was → now:
  - a line's answer: «Відповідь не збережено. Перевірте її та спробуйте ще
    раз.» → «Відповідь не збережено. Перевірте її.»;
  - a new list: «Список не збережено. Перевірте рядки / файл та спробуйте
    ще раз.» → «Список не збережено. Перевірте рядки.» / «… Перевірте
    файл.»; its conflict «… Поки ви працювали, дані змінилися — спробуйте
    ще раз.» → «… Поки ви працювали, дані змінилися: перевірте склад і
    натисніть «Зберегти список» ще раз.»;
  - approval: «Список не затверджено. Спробуйте ще раз.» → «Список не
    затверджено. Перегляньте рядки списку.»;
  - rejection: «Список не відхилено. Перевірте причину та спробуйте ще
    раз.» → «Список не відхилено. Перевірте причину.»;
  - removal: «Файл не прибрано. Спробуйте ще раз.» → «Файл не прибрано.
    Перегляньте файли списку.» (and «Рядки не прибрано. …»);
  - adding: «Файл не додано. Перевірте його та спробуйте ще раз.» → «Файл
    не додано. Перевірте його.»; «Рядки не додано. Перевірте їх та
    спробуйте ще раз.» → «Рядки не додано. Перевірте їх.»;
  - a conflict none of them names: «Поки ви працювали, список змінився —
    перегляньте його й спробуйте ще раз.» → «Поки ви працювали, список
    змінився — перегляньте його.»;
  - **decided here (review):** the server's own failure on any of them
    (5xx): «Не вдалося виконати операцію. Спробуйте ще раз. Номер запиту:
    …» → «{що не зроблено} Натисніть ще раз — повторити безпечно. Номер
    запиту: …» — every command here is safe to send again (its command id,
    or the list's state); a refusal naming nothing (4xx): «{що не зроблено}
    {що перевірити}».
  The words that already said what happened and the step stay («Невідомо,
  чи … Натисніть ще раз — …», «Немає відповіді сервера…», each named
  reason). The other sections' write refusals wait for their batches.
- **360 × 640** (P0-1's first criterion): in a list in work of two files,
  light and dark, the header, the tag and the switch stand over the menu,
  and nothing stands between the switch's row and the first line. **Not
  met:** the first line itself begins about 30 px under the menu — the
  tag's approved line of what the waiting holds takes four lines at 360
  px. Asked of the owner (batch 10's report).
  - «Інші рядки ⋯» stands on its own row under the switch, as on main: the
    general `nav` rule wins over the row's grid. Beside the switch,
    «Потребують» would break inside the word at 360 px, so it is kept as
    it is (the TZ: the switch «как есть»).

### Settled in the review (2026-11-11)

An independent reviewer read the diff with P0-1 and В-П1 (б); it ran the
type check and ESLint. Nothing blocking, no right or idempotency broken.
Settled:
- Enter in the rejection's reason rejected the list (medium): only the
  button rejects now (above).
- A server failure still said «Спробуйте ще раз» (medium): the section's
  words for it (above).
- A refusal under the tag outlived its moment (low–medium): cleared when
  the list is decided or a line opened.
- The sheets closed before the list was read again, «Затвердити» back for
  a moment (low): a refusal frees its sheet at once; a success reads
  first, then closes.
- A form left standing for a list no longer open to it (low): the list.
- The file's line kept a copy of the file, removed meanwhile (low): read
  from the parts now, « (прибрано)».
- The reason lost when the sheet closed (low): kept by the list.
- «Місце у списку» never said for a list typed in one go (low): on the add
  screens too.
- «Файли списку · N» counts the files still in the list; the screen shows
  the removed ones too, struck through — kept, each its own meaning.
- Kept: outside Telegram, Enter in a field of «Додати рядки вручну» sends
  the lines, as the form did before — lines added are removed again as
  their part, unlike a rejection.

## Chosen in chat — 2026-11-11 (audit after stage 2, batch 11: the till's «На який борг вносить?» a sheet over the list, as on the card, «{Ім’я} · винні всього {сума}» its one line; the sale tab's write refusals by В-П1 (б); sale P2-3's approved words; sale P2-4, P2-5 — the sale task list closed)

Chosen in chat on 2026-11-11 («Yes, sale first»), after batch 10 (#193)
was merged: sale P2-4 and P2-5, with the owner's answers of 2026-11-11.
P2-3's words, approved the same day and not yet built, came with them, so
that the sale task list closes. No right, no server rule, no field changes.
- **«На який борг вносить?» at the till** (P2-4; §3, §6.29, S20):
  - A customer of two debts or more, tapped in the till's «Внесок» list:
    the sheet rises over the list, as on the customer's card. The list
    stays under it, out of reach while it is open, its search kept. The
    screen of its own is gone — the name for a header, «← До боргів», the
    phone as a link, the card «Винні всього».
  - Under the title, one line in pencil, read with the title: «{Ім’я} ·
    винні всього {сума}» — the server's sum for this store alone. Among
    «Магазини, що не працюють», the name alone, as before.
  - Its rows are the card's sheet's: the goods, since when, another
    store's sticker, what is owed with the debt's glyph, the chevron; each
    heard «{товар}, винні {сума}» (+ «, магазин «…»»). Only debts still
    owed are read (`status=OPEN`, as the till's list reads them); none is
    chosen beforehand (owner decision, 2026-10-01).
  - Read again by her phone, as the screen did: refused, the warning's
    plate in the sheet over the rows as they were; gone — every debt paid
    meanwhile — the sheet closes on the list, and the list under it is read
    again, so her row goes too (review: the screen did this by mounting the
    list anew; the sheet leaves it mounted).
  - A row tapped: the sheet is done with, S21 opens on that debt.
    **Decided here:** S21's «←» from the sheet says «До боргів», as from a
    single debt's row (decision 2026-11-01), and goes back to the list with
    no sheet over it; S22's way back is named the same. Before, it was
    named by the customer and went back to their screen, which is gone.
  - Telegram's «Назад», Escape, the scrim and the handle close it. Where a
    keyboard or a reader had the cursor on her row, it goes back there; a
    tap on a phone leaves no cursor, as on the card's sheet (review).
- **The sale tab's write refusals** (P2-5; owner, В-П1 (б)): what happened,
  the fate, the step, in the owner's words:
  - the till's conflict: «Дані змінилися, поки ви працювали. Кошик
    збережено — нічого не продано. Натисніть спосіб оплати ще раз.»;
  - a return's conflict: «Дані змінилися, поки ви працювали. Поверніться
    до списку й відкрийте продаж знову. Нічого не повернено.» (from paper
    «… Нічого не записано.»); a return the server could not take:
    «Перевірте, що повертають. Нічого не повернено.»;
  - a payment's or a write-off's conflict: «Внесок (Списання) не записано.
    Дані боргу змінилися, поки ви працювали: перевірте залишок.»; the
    request not taken: «Внесок не записано. Перевірте суму.», «Списання не
    записано. Перевірте причину.»;
  - erasing a customer: «Дані покупця не стерто.»; its conflict «Дані
    покупця не стерто: борг щойно змінився — перегляньте його.».
  - **Decided here, by batch 10's rule for «Початкові залишки»:** a
    refusal naming nothing at all — a 400 or 404 the screens have no words
    for, which said the shared «Не вдалося виконати операцію. Спробуйте ще
    раз.» — says the fate, then what to check: «Кошик збережено — нічого
    не продано. Перевірте товар, кількість і ціну.»; «Нічого не повернено.
    Перевірте, що повертають.»; «Внесок не записано. Перевірте суму.»
    («Списання … причину.»); «Дані покупця не стерто.». The server's own
    failure on erasing (a 5xx; erasing is sent directly, never kept):
    «Дані покупця не стерто. Натисніть ще раз — повторити безпечно. Номер
    запиту: …» — erasing is the same however often it is sent. A sale, a
    return and a payment answered with a 5xx are kept on the phone, as
    before, and say the kept operations' words.
  - **Decided here (review):** a pressed return refused because the
    warehouse its goods went to was closed meanwhile (a 404 the server
    names `WAREHOUSE_UNAVAILABLE`) says the kept return's words for it
    (owner decisions, 2026-10-18): «Склад, куди йшов цей товар, закрито.
    Зверніться до менеджера. Нічого не повернено.» — it said the shared
    failure before, and by the rule above would have sent the seller to
    check the goods.
  - The return's words are its list's too: the list's plate for a read
    refused with a conflict or a request not taken says them, as before.
  - **The kept operations' words stay** (owner): a kept return refused on
    resend for a request the server could not take still says
    «Повернення не записано. Перевірте, що повертають, і спробуйте ще
    раз.» — by a branch of its own now, since the pressed words changed.
    The phone's own failure before anything is sent keeps the shared
    words, as in batch 10.
  - One helper says this for the till, the return, the debt and
    «Початкові залишки»: `failedWrite` (`frontend/src/shared/api.ts`);
    batch 10's rule moved there unchanged.
- **Sale P2-3's words** (owner, 2026-11-11): «Знайти в каталозі» says one
  line, «На складі «{склад}» його немає в обліку.» (the shortage sheet
  says the rest at the way of paying); «До списку» for «Назад до списку»,
  both ways back from it; the label's chip shows «Не читали», a reader
  hearing «Не читали — продати як «розмір невідомий»».

## Chosen in chat — 2026-11-12 (audit after stage 2, batch 12: «Гроші»'s «Вам винні клієнти» in a debt's colour and «людини», as «Сьогодні» says it; «Ви винні постачальникам» the open store's line the way to its «Накладні», the title none; «Закриття · {магазин}»; money P1-1, P1-2)

Chosen in chat on 2026-11-12 («Yes, money first»), after batch 11 (#194)
was merged: the money task list after stage 2 starts with P1-1 and P1-2,
both on «Гроші». No right, no server rule, no field and no sum changes.
- **What customers owe** (P1-1; §4 «Долг», S29 №9; В-ГР1 (а)):
  - a store's line where customers owe something (`customers > 0` and a
    debt not «0,00») is drawn whole in the debt's colour, `owed`, as the
    day-tag's line on «Сьогодні»: the store's name, «Винні», the sum and
    the people. Its twin is «Винні» at the line's start;
  - its words: «Винні 8 400,00 грн · 4 людини» (`людина / людини /
    людей`, the count never parted from its word) — «покупці» is gone;
  - «Ніхто не винен» in pencil, as «Сьогодні» says it;
  - **Decided here:** the place's glyph `owed` takes the debt's colour
    while at least one store's line does; with nobody owing anywhere it
    stays in ink, so the colour is only where a debt is. The glyph is
    drawn once, at the place, never again on each line (S29 №9);
  - «Ви винні постачальникам», its glyph and its lines stay in ink: `owed`
    is for customers alone (§4);
  - while a store's line is read or could not be read, it has no colour of
    its own.
- **The suppliers' way and «Закриття»** (P1-2; S29 №10, №18; Q-1 «if
  not»):
  - «Ви винні постачальникам» is a title, no way: «Накладні» read the open
    store alone, while the place shows every store;
  - the open store's line, where its `supplier:debt` is, is the way to its
    «Накладні»: the place's whole width, 44 high, the set's chevron at its
    end. It comes first; the other stores' lines follow in the report's
    order and are lines, no way (Q-1 «if not»). With one store, the line
    is the way: as many taps as the title was;
  - heard «Накладні магазину «Центр»: 38 000,00 грн · 3 накладні» — what
    it shows after where it goes; while read, the name alone; not read,
    «…: не вдалося прочитати», the way kept (the place's plate with
    «Спробувати ще раз» under it, as before). An open store that does not
    trade has no `supplier:debt` (its rights as shown), so its line is
    never the way; should that change, its mark is heard too (review);
  - held as the title was: while a first send is in flight, and while
    another section's kept operation waits (`otherThanInvoices`). Held, it
    still reads: nothing faded over its money, its words in pencil, as a
    held row's (review);
  - without `supplier:debt` in the open store, every line is a line;
  - «Вам винні клієнти» keeps its way on the title: «Покупці» show every
    store's block, the open one first;
  - «Закриття» on «Гроші» is «Закриття · {магазин}», the open store's name
    without quotes, as «Каса · {магазин}» beside it. **The words wait for
    the owner's approval** (the task marks them so); the «Закриття» button
    on «Каса» itself does not change;
  - after a «yes» to Q-1, every line gets its «›» (S29 whole) — not here.

## Chosen in chat — 2026-11-12 (audit after stage 2, batch 13: the suppliers' screens hold grey places while read, never a «Завантажуємо …» line; one «Спробувати ще раз» after a failed page; the report's blank tags; «Продано»'s stub with its sum large; «Менше» felt, one line where a store does not trade, hairline dividers; money P1-3, P2-1…P2-4 — the money task list closed)

Chosen in chat on 2026-11-12 («merged go next»), after batch 12 (#195)
was merged: the rest of the money task list after stage 2 in one batch, as
its §8 orders it («Поставщики и отчёт»). No right, no server rule, no
field and no sum changes; what is read and how much is as before.
- **Grey places while read** (P1-3; spec §5 «Скелетон», §6.27; P7): no
  screen of the suppliers' shows «Завантажуємо …» to the eye. The words
  stay, said to a screen reader alone (`role="status"`, hidden), and the
  places are the real rows' shapes, from the shared `Placeholder`:
  - «Накладні» and «Позичене й під реалізацію»: three grey row tags, an
    order's (`lineTags`); the first tag comes where the first grey stood;
  - «Постачальникам»: three grey rows of a list (64);
  - the supplier's sheet and «Список постачальників»: three grey supplier
    rows (56, over a line — `rowShape`). «Список постачальників»' search
    stands from the start, over the places, so nothing moves when the
    rows come; it is not drawn for a list that came back empty, as before;
  - «Зарахувати повернення»: three grey cards of a return (`rowShape`);
  - «Повернути постачальнику»: its warehouses as two grey choices;
  - an invoice opened from another screen (a return's «Відкрити накладну»)
    while it is found among its supplier's: the title's place held, its
    «Записано …» line, what is owed large over its bar and what is paid,
    and two rows of its history on the thread, grey in their own sizes —
    as an order's card waits. Its «←» is the way it came, as before.
  - Where motion is reduced, the grey stands still (the shared rule).
- **A page that failed** (P2-1): on «Накладні», «Постачальникам» and
  «Позичене й під реалізацію», a page after the first that could not be
  read keeps the rows read and says why with its one «Спробувати ще раз»;
  «Показати ще» is gone meanwhile and comes back once that page is read.
  A whole re-read that fails is said as before. The rule of the first
  batch says so now.
- **The report with nothing in it** (P2-2; spec §6.28): «Моделі» and
  «Продажі й повернення» with no record in the period show the blank tag
  64 and their one line, «Нічого не продано.» / «Ні продажів, ні
  повернень.», no button and no second line — the line of context says
  the period.
- **«Продано»'s stub** (P2-3; spec §5 «Корешок», §6.30): a «Продано»
  recorded is a debt to the supplier, money, so its stub reads as an
  invoice's own:
  - the title «Продано 1 шт.» with its check;
  - the stub recorded: the invoice's sum as the server answered it
    (`invoice.amount`), large — nothing is multiplied on the phone; under
    it «Ганна · Кокон графіт, M × 1»; a perforation; «Борг «Ганна» — у
    «Накладних».» and «Відкрити накладну ›» (for `supplier:debt`, as
    before). The name is never declined;
  - a long name, even one with no space in it (a shop's Instagram name),
    wraps inside the stub; the sum stays whole;
  - «Повернено постачальнику …» is unchanged: no money in it;
  - **the words wait for the owner's approval** (the task marks them so).
- **Small things of one system** (P2-4):
  - «Менше» on «Повернути постачальнику»'s sizes and in a lot's sheet is
    felt as «Більше» is, a light tap (spec §6 rule 9), when the count goes
    down; held at its least, nothing changes and nothing is felt;
  - «Накладні» of a store that does not trade say one line under the
    store's own notice: «Сплачує будь-який магазин мережі, що працює.»
    Today no one sees it: such a store keeps only the rights that read
    (`asShown`), and «Накладні» need `supplier:debt`. It stays, in case
    that changes;
  - the rows of «Надійшло» and of the report's table are parted by the
    divider's `hairline`, never a control's `edge` (spec §6.8); «Разом»
    and «З урахуванням повернень» stay bold;
  - «Записано …» on an invoice, «Спершу скасуйте її оплати й заліки.»
    and «Щоб скасувати повернення, …» were already 14/500 in pencil (the
    frame's P1-1, #185): `.hint` is the meta's size. Nothing on these
    screens reads under 14 but the capitals' labels and a large sum's own
    «,00» and «грн».
- **After the independent review** (2026-11-12):
  - an invoice opened from another screen holds its ⋯'s place, unseen,
    while it is found: the line under the title stays where the card's
    will be (a «⋯» shows on every invoice still owed in a store that
    trades);
  - «Зарахувати повернення» holds three returns' cards, as the task says;
  - focused, «Продано 1 шт.» is heard with its sum and «Борг … — у
    «Накладних».» (described by them);
  - a name with no space wraps in «Борг …» too, never past the stub (it
    had widened the page by 2 px at 360);
  - the meta's floor, 14, for what the section still drew smaller: a cell's
    meta in the report's table (13), a day's year in its thread (12),
    «вільно N» under a size on «Повернути постачальнику» (13);
  - kept as the task says: «Повернути постачальнику»'s warehouses held as
    two grey choices, though a store with one is shown a line of 22 —
    what comes is not known before it is read.

## Chosen in chat — 2026-11-12 (audit after stage 2, batch 14: «Перевірка каталогу»'s queue and the catalogue's search by pages added under the first, one «Спробувати ще раз» after a failed page; «Товар»'s screens hold grey places while read, never a «Завантажуємо …» line; one blank tag for nothing; «← Перевірка каталогу» over a proposal; a receipt's result keeps its «←»; goods P2-1, P2-2, P2-3)

Chosen in chat on 2026-11-12 («merged, go next»), after batch 13 (#196)
was merged: the goods task list after stage 2's three points that wait for
no approval. Its P1-2, P1-3, P1-4, P1-5 and P2-4 are marked «нужно
утверждение» and stay. No right, no server rule, no field, no count and
no sum changes; what is read and how much is as before.
- **Pages added under the first** (P2-1; P7):
  - «Перевірка каталогу»'s queue: «Показати ще» reads the next twenty and
    adds them under the rows; «Попередні пропозиції» and «Наступні
    пропозиції» are gone. The server's limit stays: nothing past offset
    10 000. «Оновити» and a decision read again every page shown, in
    order, from the first; a switch back to a queue shows the pages read
    before at once and reads them again;
  - the catalogue's search («Пошук у каталозі» on «Прийшов товар», a
    stocktake's found goods, a line of «Початкові залишки», and the till's
    «Знайти в каталозі», which shares it): «Ще товари»
    adds the next page under what was found; «Попередні» is gone. Its word
    stays «Ще товари», as the batch of 2026-11-11 kept it for this search
    (the till's list says «Показати ще»);
  - after a page that could not be read, the rows read stay and its one
    «Спробувати ще раз» reads that page alone; «Показати ще» / «Ще товари»
    come back once it is read — as «Накладні»'s (batch 13).
- **Grey places while read** (P2-2; spec §5 «Скелетон», §6.27): no screen
  of «Товар» shows «Завантажуємо …» to the eye. The words stay, said to a
  screen reader alone, and the places are the real ones' shapes:
  - the queue: three grey proposals' rows, their lines the row's width;
  - a proposal opened: its words large, its sticker and two models offered
    with «Це вона»'s place 44, under «Пропозиція» and its «←»;
  - the catalogue's search: three grey rows of one line, «Шукаємо…» to a
    screen reader;
  - «Моделі»'s model: its hero tag — the eyelet, the name's line 42, ⋯'s
    place — under «← Моделі»;
  - «Прийшов товар», «Залишки» and «Інвентаризація»: the warehouses as two
    grey choices (as «Брак» and «Повернути постачальнику»); «Прийшов
    товар»'s sizes as four sizes' steps — the letters, «−», the count, «+»,
    44 high — two a line;
  - «Інвентаризація»'s stocktakes of a warehouse: «Попередні» and three
    rows of its thread, their eyelets round — what a warehouse's
    stocktakes most often are (an open one, when there is one, comes
    above it); a finished stocktake's differences: two grey lines in their
    own height;
  - «Початкові залишки»: three grey tags of the lists, and of a list's
    lines; a line's sizes, four grey cells 60 × 60.
  - Where motion is reduced, the grey stands still (the shared rule).
- **Nothing here** (P2-2; spec §6.28): the blank tag 64 and its one line,
  the words as they were. A line of two sentences says its first, the
  second under it as the blank tag's meta (decided here):
  - the queue: «Нічого не чекає перевірки.» / «Перевірка не змінює залишки
    й не об’єднує моделі.»; «Підтверджених пропозицій ще немає.»;
    «Відхилених пропозицій немає.»;
  - «Залишки»: «На цьому складі зараз немає товару.»;
  - counting: «Усі позиції з залишком пораховано.» / «Ще нічого не
    пораховано.»;
  - «Початкові залишки» with no list: «Списки із зошита — рядок за
    рядком.» / «Поки список чекає, склад не рухається.» — on the shared
    blank tag, no longer the screens' before a store («BlankTag»).
  - «Тут рядків немає.» under a list's switch is not a section's nothing
    and stays as it is (not in the task's list).
- **One way back** (P2-3; spec §6.8):
  - over a proposal, «← Перевірка каталогу»: the arrow unheard, read
    «Назад до «Перевірка каталогу»», drawn as every screen's «←» over its
    title;
  - «Прийшов товар»'s result keeps the form's «←» — «← Ще», «← {модель}»
    when it was opened from a model's page — and Telegram's «Назад» with
    it; «Прийняти ще» stays. Back on the model, its grid is read anew: a
    receipt recorded drops the stock read before, so «Залишки» and a
    model's grid never show the count from before the delivery.
- **Left as it is:** «Шукаємо моделі…» of «Інший колір нашої моделі» —
  that search is P1-5's, which waits for approval.
- **After the independent review** (2026-11-12):
  - what could not be read, as the till's list (sale P1-4): never read,
    the plate in the list's place; a page that failed, its retry at the
    rows' foot, held while the list is read, and still there while
    «Оновити» reads; a re-read refused, the plate over the rows read,
    which stay, «Показати ще» held under it — the queue and the
    catalogue's search alike (`useNextPageFailed`);
  - the catalogue's search typed again keeps what was found in place
    until the new search comes, as the till's list does; never «Нічого не
    знайшли» under the new words, nothing past offset 10 000;
  - «Показати ще» and «Ще товари» put the cursor on the first row they
    bring, as «Залишки»'s does;
  - a grey proposal's row has its sticker's place, 28, under its words —
    as high as the row that comes (±2, checked);
  - «Початкові залишки»'s grey tags are a list's own — its eyelet, name,
    meta, sticker and «Відкрити» 44 — and a line's — its eyelet, words,
    meta and verb 44 — where they come; a list awaited from «Сьогодні»
    shows its big tag over three lines in grey, never the lists' tags;
  - a stocktake's differences: as many grey lines as will be shown, five
    at most, folded;
  - a receipt confirmed — by its form, or on reopening the app — resets
    the stock read before: a screen showing it reads it again, the others
    wait in grey; the till's search reads it again too, as after a
    correction. Before, a receipt refreshed neither.

## Chosen in chat — 2026-11-12 (audit after stage 2, batch 15: the write refusals of the catalogue, «Моделі», prices, receiving, corrections, stocktakes, «Брак», suppliers and stores by В-П1 (б))

Chosen in chat on 2026-11-12 («merged, go next»), after batch 14 (#197)
was merged: the owner's В-П1 (б) carried to every section it named that
was not yet rewritten — «The same rule reaches every section» (owner
decision, 2026-11-11). Goods P1-2…P1-5 and P2-4 wait for the owner's
approval and are not in it. No right, no server rule, no field changes.
- **What a refused write says** (owner, В-П1 (б)): what was not done,
  then the step; never «спробуйте ще раз». By the refusal:
  - a request the server could not take (422), or one naming nothing
    (400, 404): «{не зроблено} {що перевірити}»;
  - a conflict (409): «{не зроблено}: {що змінилося} — перегляньте …»;
  - the server's own failure (5xx) on a command sent directly, never
    kept: «{не зроблено} Натисніть ще раз — повторити безпечно. Номер
    запиту: …» — every such command is the same however often it is sent
    (a price, a stocktake started or finished, «Брак»'s steps, a supplier
    added or saved);
  - a reason the server names, no server, a session ended, no access:
    their own words, as before.
- **Was → now**, screen by screen:
  - «Моделі», a new name: «Назву не змінено. Перевірте поля та спробуйте
    ще раз.» → «Назву не змінено. Перевірте поля.»; its conflict «… —
    перегляньте її й спробуйте ще раз.» → «… — перегляньте її.»;
  - «Моделі», a merge: «Моделі не об’єднано. Спробуйте ще раз.» → «Моделі
    не об’єднано. Перевірте, яка модель лишається.»; its conflict «… —
    перегляньте їх і спробуйте ще раз.» → «… — перегляньте їх.»;
  - «Моделі», retired or brought back: «Модель не прибрано (не
    повернуто). Спробуйте ще раз.» → «… Перегляньте її картку.»; its
    conflict «… — перегляньте її й спробуйте ще раз.» → «… — перегляньте
    її.»;
  - a catalogue operation («Перевірка каталогу», «Нова модель»), refused as
    it was pressed: a request naming nothing «Не вдалося виконати операцію.
    Спробуйте ще раз.» → «Операцію каталогу не записано. Перевірте модель
    і назву.» (a rejection's sheet: «… Перевірте причину відхилення.»); a
    request not taken and a conflict it does not name say «Операцію
    каталогу не записано.» before their words, as a kept one refused did;
  - a price: «Ціну не збережено. Перевірте суму та спробуйте ще раз.» →
    «Ціну не збережено. Перевірте суму.»; its conflict unchanged («… —
    перевірте й збережіть ще раз.»);
  - «Прийшов товар»: «Нічого не прийнято. Перевірте рядки та спробуйте ще
    раз — список збережено.» → «Нічого не прийнято, список збережено.
    Перевірте рядки.»; its conflict «… Перевірте рядки та спробуйте ще раз
    — список збережено.» → «Нічого не прийнято, список збережено: поки ви
    працювали, дані змінилися. Перевірте рядки й натисніть «Записати
    прихід» ще раз.»; a reason the server names: «{чому} Список збережено —
    нічого не прийнято.» → «{чому} Нічого не прийнято, список збережено.»,
    the fate in one order everywhere on the screen;
  - a correction and a count, pressed: «Перевірте кількість та спробуйте
    ще раз. Нічого не записано.» → «Перевірте кількість. Нічого не
    записано.»; their conflict «Облік змінився — перерахуйте товар і
    спробуйте ще раз.» → «Облік змінився — перерахуйте товар і введіть
    кількість ще раз.»;
  - a stocktake started: «Інвентаризацію не почато. Спробуйте ще раз.» →
    «Інвентаризацію не почато. Перевірте склад.»; finished: «… не
    завершено. Спробуйте ще раз.» → «… не завершено. Перегляньте
    підрахунок.»; their conflicts lose «і спробуйте ще раз»;
  - «Брак»: «Не записано. Перевірте дані та спробуйте ще раз.» → «Не
    записано. Перевірте дані одиниці.»;
  - borrowed goods marked sold: «Не записано. Перевірте кількість та
    спробуйте ще раз.» → «Не записано. Перевірте кількість.»;
  - an invoice's payment, set-off or write-off: «Не записано. Перевірте
    дані та спробуйте ще раз.» → «Не записано. Перевірте дані
    накладної.»;
  - a return to a supplier, or its cancelling: «Не записано. Перевірте
    повернення та спробуйте ще раз.» → «Не записано. Перевірте
    повернення.»;
  - a supplier added: «Постачальника не додано. Перевірте назву й телефон
    та спробуйте ще раз.» → «… Перевірте назву й телефон.»; its conflict
    «Постачальника не додано: дані змінилися — спробуйте ще раз.» →
    «Постачальника не додано: дані змінилися — перегляньте список
    постачальників.», and the list is read again, as it says (review:
    before, it was not); a supplier saved: the same, «не збережено»;
  - a store blocked, opened or archived: «Стан магазину не змінено.
    Перевірте причину та спробуйте ще раз.» → «… Перевірте причину.»; its
    conflict «… — перегляньте його й спробуйте ще раз.» → «… —
    перегляньте його.»;
  - every conflict above loses its «спробуйте ще раз»; what each screen
    reads again after it does not change.
- **Decided here** (each a reading for the owner):
  - the words of what to check, where the owner gave none: «Перевірте
    склад.», «Перегляньте підрахунок.», «Перевірте, яка модель
    лишається.», «Перегляньте її картку.», «Перевірте дані одиниці.»,
    «Перевірте дані накладної.», «Перевірте модель і назву.», «Перевірте
    причину відхилення.»;
  - **the kept operations' words stay** (owner), wherever the pressed
    words changed — each by a branch of its own, as batch 11's kept
    return: what a count, a correction, a «Моделі» change, an invoice's
    payment, set-off or write-off, a return to a supplier, borrowed goods
    marked sold or a store's state says when it was kept on the phone and
    the server refuses it later is as it was — «Перевірте кількість та
    спробуйте ще раз.», «Зміну каталогу не записано. …», «Не записано: дані
    змінилися — перегляньте їх і спробуйте ще раз.», «Стан магазину не
    змінено: його змінили — перегляньте його й спробуйте ще раз.» (review);
  - a catalogue operation still kept on the phone, its outcome unknown — the
    server's own failure, an answer proving nothing about a resend, a read
    failing after it was taken — says it as every kept command does:
    «Операцію каталогу ще не підтверджено: сервер не зміг відповісти
    (не прийняв запит; відповів, що дані змінилися). Перевірте результат
    ще раз — двічі вона не запишеться. Номер запиту: …» (owner decisions,
    2026-10-18 and 2026-10-25; review). Before, it said the shared «Не
    вдалося виконати операцію. Спробуйте ще раз.» beside its stub, and a
    request naming nothing would have said «не записано» of what may have
    been recorded;
  - a receipt, a count, a correction, a supplier's return or payment,
    borrowed goods marked sold, a store's state and «Моделі»'s changes
    answered with a 5xx are kept on the phone, as before, and say the kept
    operations' words;
  - the catalogue's «Модель неоднозначна або стан каталогу змінився. …»
    loses its last clause, «за тимчасового конфлікту повторіть спробу»;
  - a rejection's sheet, its operation kept and then refused as having
    recorded nothing, says «Операцію каталогу не записано.» first, as the
    queue's line above it does.
- One helper says this everywhere: `refusedWrite` (and, where the fate
  comes after the step, `refusalStep`) in `frontend/src/shared/api.ts`,
  built on batch 11's `failedWrite`; «Початкові залишки» moved onto it
  unchanged.
- **Not reached by this batch** (a question for the owner): «Каса»'s
  refusals as pressed (`cash/errors.ts`) and an order's conflict as
  pressed still end in «спробуйте ще раз», and a 400 or 404 there says the
  shared failure — В-П1's list named neither section. The app's own
  failure, before anything is sent, keeps the shared words everywhere, as
  in batch 10.

## Chosen in chat — 2026-11-12 (audit after stage 2, batch 16: a catalogue operation kept on the phone in the one form every kept operation has; «Інший колір нашої моделі» searched as it is typed, every model at once, «Показати ще»; goods P1-4, P1-5)

Chosen in chat on 2026-11-12, after batch 15 (#198) was merged: the user
chose goods P1-4 and P1-5 («P1-4 + P1-5»). The task list marks both
«нужно утверждение» — P1-4 its words, P1-5 its design. They are built as
the task list gives them, and what it did not give is a reading for the
owner. No right, no server rule, no field changes; the catalogue's
commands, their idempotency and a creation's cancelling stay as they were.
- **A kept catalogue operation** (P1-4; spec S12, §5 «Корешок» `kept`):
  «Перевірка каталогу» and the sheet «Нова модель» draw it in the shared
  `Kept` form, as its own screen's — the stub still attached, «Ще не
  підтверджено» on it, the phone's checking line («Перевіряємо кожні
  20 с …» while the server does not answer) — as «Моделі»'s change and the
  journals' kept operations do. Was → now:
  - «Незавершена операція каталогу» → «Операцію каталогу ще не
    підтверджено»;
  - «Результат ще не підтверджено. Повторна спроба використовує ту саму
    операцію.» → «Невідомо, чи записано операцію каталогу. Перевірте
    результат — та сама операція не запишеться двічі.»;
  - «Повторити ту саму операцію» → «Перевірити результат операції»: the
    same operation sent again, its key the same, as before;
  - the line of when and by whom (`keptText`): as before;
  - a creation's «Якщо створення не вдається, можна скасувати пропозицію.
    Якщо товар уже збережено, покажемо результат.» and the quiet
    «Скасувати незавершене створення» stand under the check, as before. The
    cancelling is still a rejection with the same reason
    (`CANCEL_CREATION_REASON`). One that finds the model saved shows it
    added.
  - A check pressed notes the last check's time, as every kept operation
    the phone checks by itself.
  - No stub's title says «Незавершена» any more: frame P1-2's third
    criterion, which waited for this, is met.
- **«Інший колір нашої моделі»** (P1-5; spec §5 «Поиск»):
  - searched as it is typed, from two letters, about 300 ms after the last
    — no «Знайти модель», no Enter; one letter is every model still, the
    list standing, nothing asked (review: a blank between, then every
    model again, then the answer, was a jump);
  - nothing typed: every model at once, its first page, as the empty search
    was — the model is two taps away (the kind, then the model);
  - one line of hint, «Схожі назви не означають однаковий товар.» (the
    catalogue's identity); «Пошук за назвою, джерелом або відмінністю.
    Порожній запит показує всі доступні моделі.» is gone;
  - the shared search field (52, the magnifier, «×»), its name read aloud
    «Пошук моделі в каталозі», as the label was;
  - the models as rows of one line; a tap chooses, the keyboard hidden;
    each heard «Обрати модель: {модель}», as before;
  - «Показати ще» adds the next twenty under them; «Попередні моделі» and
    «Наступні моделі» are gone. The server's limit stays: nothing past
    offset 10 000. The cursor goes to the first model a page brings — never
    once new words are typed (review). A page that fails says so where
    «Показати ще» stood, the rows staying; its «Спробувати ще раз» reads
    that page alone;
  - while read: three grey rows, a screen reader hearing «Шукаємо моделі…»;
    a read refused: the warning's plate, as before (P1-1);
  - found nothing: «Нічого не знайшли за «…»»; «Моделей не знайдено.
    Спробуйте іншу назву або перевірте дані нової моделі.» is gone;
  - what is searched (the name, the source, the difference) and the
    model's family are as before. Nothing is chosen by a likeness.
- **Revisits** stage 2's batch 10 (a kept operation's sheet says
  «Незавершена операція каталогу» with «Повторити ту саму операцію»,
  «Chosen in chat — 2026-11-08 (stage 2 batch 10 …)») and the audit's
  batch 3 note that the catalogue's stub kept its words until goods P1-4
  («Chosen in chat — 2026-11-09 (audit after stage 2, batch 3 …)»): the
  words above replace them. The owner's decisions are not touched.
- **Decided here** (each a reading for the owner):
  - the field's placeholder «Назва моделі або джерело» — «Назва, джерело
    або відмінність» does not fit at 360; the difference is still
    searched;
  - a catalogue with no model at all, nothing typed: «Моделей не
    знайдено.» (the task list gives only «Нічого не знайшли за «…»»);
  - one letter typed: every model still, as nothing typed (where «Моделі»
    shows nothing until the second: there nothing typed shows nothing
    too).

## Chosen in chat — 2026-11-13 (audit after stage 2, batch 17: «Знайшли товар, якого немає в списку» one screen for the stocktake's entry and its count, the model's sizes as cells, the count's or the correction's sheet over it; receiving's price a row and the model's sheet; goods P1-2, P1-3)

Chosen here on 2026-11-13, after batch 16 (#199) was merged («merged, go
next»): every point left of the goods task list waits for the owner's
approval, as P1-4 and P1-5 did when the user chose them; P1-2 and P1-3 are
the next in the task list's own order (§8). They are built as the task list
gives them, and what it did not give is a reading for the owner. No right, no
server rule, no field, no count changes; what is recorded is as before.
- **«Знайшли товар, якого немає в списку»** (P1-2; spec §5 «Ячейка
  размера», «Поиск», §6.3, §6.4):
  - one screen for both places — the stocktake's entry and its count, two
    forms before —, titled «Товар, якого немає в списку», under «←
    Інвентаризація» and Telegram's «Назад», back where it was opened; the
    menu aside, as a task's screen;
  - under the title one line, «Якщо товар уже є в обліку цього складу,
    сервер скаже, скільки саме.»; «Знайдіть модель у каталозі й оберіть
    розмір. …» is gone;
  - the catalogue's search as before, «Додати нову модель «…»» and the sheet
    «Нова модель» over the screen, its words kept;
  - a model chosen: its name and «Змінити», as receiving shows it; the
    organization's sizes as cells 60 × 60, in its order — the `<select>`
    «Розмір» / «Оберіть розмір» is gone; a cell tapped hides the keyboard;
  - at the count: a cell says «в обліку N» as the list read it — 0 where it
    holds none, as before —, and a tap opens the count's sheet at once
    (before: the size chosen, then a cell). Recorded: back to the count, its
    toast, the cursor on «Знайшли товар…». Four taps and the number:
    «Знайшли товар…», the model, the cell, the sheet's button;
  - at the entry: a cell tapped opens the correction's sheet, «{модель} ·
    {розмір}», «Склад «…»» in it, Telegram's MainButton «Записати · +2 шт.»
    its one button (outside Telegram the sheet's own) — before, the form
    on the screen with its own button beside the MainButton «Почати
    інвентаризацію». Recorded: back to the entry, «Коригування записано: …
    облік 0 → 2.» on a stub, as a model's detail says it (before, a line).
    Five taps and the number: «Знайшли товар…», the model, the cell, the
    reason, the MainButton;
  - no «Скасувати» and no MainButton of the screen's own: «←» and
    Telegram's «Назад» leave it, as «Назад» leaves the sheets.
  - Recorded as before: a correction at the entry, its reasons the same; a
    count at the count; a size the warehouse holds after all refused by the
    server, which says how many, and counted against that.
- **Receiving's price** (P1-3; spec S24 №5, S23 №3, §6.4):
  - «Ціна продажу: X — спільна для всіх магазинів» / «… — ціна магазину
    «…»» → «Ціна продажу X», the store's own price or the shared one, as on
    a model's detail; whose price it is, the sheet's switch says;
  - «Задати ціну продажу» / «Змінити ціну продажу» → «Змінити ціну», quiet,
    for `catalog:set_price` as before;
  - it opens the model's price sheet — the same as on a model's detail, now
    one component (`PriceSheet`): named by the model, the keypad in it
    alone, Telegram's MainButton «Зберегти · …»; «Записати прихід» put away
    while it stands, as under «Як надійшов»; no «Скасувати» — «Назад»
    closes it, nothing saved;
  - saved: the sheet closes, a toast «Ціну продажу збережено: {модель}.»
    (before, «Ціну збережено.» under the form), the row shows the new price;
    the sizes counted stay;
  - whose price, who changes it, «Цю ціну щойно змінив хтось інший» and
    the refusals by В-П1 (б): as before.
- **In passing:** «Пошук у каталозі» — a page pressed and not yet read, or
  failed, no longer takes the cursor from the field once something is typed
  (the review of batch 16 found it there, older than it); «Інший колір нашої
  моделі» resets it as a key is pressed too, not only once the words are
  asked (this batch's review).
- **From the review:** «Знайшли товар…» on the entry stands for the
  warehouse it was opened for, while it may be found there: that warehouse
  gone — paused, its right taken, another the only one now — and the screen
  goes with its sheet, the menu back, never to come back by itself.
- **Revisits** stage 2's batch 9 («Chosen in chat — 2026-11-07 (stage 2
  batch 9: …)»): the correction on a screen — a stocktake's «Знайшли
  товар…» — kept its own button and «Скасувати», never the MainButton; and
  the price's form on receiving kept its own button and «Скасувати» beside
  «Записати прихід». Both now stand in sheets; the owner's decisions are
  not touched.
- **Decided here** (each a reading for the owner):
  - «← Інвентаризація» over the screen from both places; a reader hears
    «Назад до інвентаризації» from the entry, «Назад до інвентаризації
    складу «…»» from the count;
  - at the entry a cell is its size alone — what the ledger holds, the
    sheet says («В обліку 0»);
  - the cursor in the search as the screen opens, the keyboard with it;
  - the model chosen shown as receiving shows it, the search gone with it;
  - the correction's stub over «Знайшли товар…» on the entry, where its line
    stood, the cursor on «Знайшли товар…».


## Chosen in chat — 2026-11-13 (audit after stage 2, batch 18: «Новий список» — the way in a switch, the list its one field, «Звідки список» and «Коли перелічено» under the quiet «Ще про список»; goods P2-4)

Chosen here on 2026-11-13, after batch 17 (#200) was merged («merged, go
next»): P2-4 is the last point of the goods task list after stage 2, marked
«нужно утверждение» as P1-2..P1-5 were; built as the task list gives it,
and what it did not give is a reading for the owner. No right, no server
rule, no field, no limit changes; the draft keeps what it kept, and what is
sent is as before.
- **«Новий список»** (P2-4; spec §5 «Переключатель режима»):
  - the radios «Як внести список: Вставити текст / Завантажити файл» → the
    switch «Вставити текст · Завантажити файл»; «Як внести список» is its
    name for a reader alone, no legend on the screen;
  - the screen's one field: the list's lines, or the file's chooser;
  - «Звідки список (необов’язково)» and «Коли перелічено (необов’язково)»
    → under the quiet «Ще про список», closed; a tap opens them, another
    closes them, their words kept and sent as before;
  - a refusal of them opens «Ще про список» by itself.
- **Decided here** (each a reading for the owner):
  - the switch's ways marked as pressed, as the form's other switches
    («Яку ціну змінюємо», «Що зробити»), never as a page;
  - «Ще про список» at the form's end, under the list's field and its
    hint;
  - it opens by itself also when what it holds would be saved unseen: a
    draft brought back with their words; a file read whole while they hold
    words — what it filled, or an earlier one did; the way switched while
    they hold words (the review's);
  - a refusal of them names them: «Список не збережено. Перевірте «Коли
    перелічено».» (before: «… Перевірте рядки.»); the lines too when they
    are refused with them, «Перевірте рядки та «Коли перелічено».»; unsure
    of the send before it, «Перевірте «…», потім натисніть ще раз — двічі
    список не збережеться.»; a file's problems refused with them, the
    file's problems, then «Перевірте «…».»;
  - the switch held while the list is sent, as the file's chooser is.
- **In passing** (the review's): a file picked instead of another replaces
  the name and date a file filled, field by field, as long as nobody typed
  over them — a broken file, or one that fills nothing, picked between them
  changes nothing (before, a broken file between them kept the first's name
  over the next one's). A file that fills nothing keeps the earlier one's,
  as before — now seen, «Ще про список» opened over it.

## Chosen in chat — 2026-11-13 (audit 2026-11-13, batch 1: «Сьогодні»'s places never read say «не вдалося прочитати», one «Спробувати ще раз» a tag; a failed next page in four «Товар» lists keeps the rows, one plate at the foot; an order step's refusal said where it was pressed; frame P1-1, goods P1-1, orders-cash P1-1)

Chosen here on 2026-11-13, after the new audit of the whole app
(`.ai/project-memory/redesign/2026-11-13-redesign-tz-audit-*.md`), by the
user's pick «Unread and refusals»: the first P1 of three of its task lists.
No right, no server rule, no read, no write changes; what was never read
says so, and what was refused is said where it was pressed.
- **«Сьогодні»** (frame P1-1):
  - a figure whose read failed before it ever answered says «не вдалося
    прочитати» in its place, never a grey line: the day's total, each
    store's sum, its drawer's and debts' lines, the online orders' line,
    the folded line;
  - one plate (`Unread`) at the day-tag's foot, however many of its reads
    failed; its «Спробувати ще раз» asks only those again; the server
    silent, «Сервер не відповідає.»;
  - «Чекає на вас»: its reads failed before they answered — the plate in
    the grey tag's place, never «Вас нічого не чекає.»; its retry asks only
    those;
  - what was read and failed later keeps its figures and its stamp, and
    gives no plate (the rule «a read that fails keeps what it showed»,
    unchanged).
- **Decided here** (each a reading for the owner):
  - nothing read at all and a read failed: no stamp on the day-tag, folded
    or not — the plate says why, as «Гроші»'s places;
  - folded (under 700 px), the plate under the folded line, outside its
    button;
  - «Чекає на вас» keeps its own plate: it reads the parcels by the same
    orders' read as the day's online line, so one failed orders' read is
    said in both tags, each retry asking it;
  - at 360 px the column's «не вдалося прочитати» takes two lines — the
    task list asked one —, as the debts' line does in the same ≈ 158 px
    column; nothing passes the column (a deviation, shown to the owner by
    the journey's screenshots).
- **Four «Товар» lists** (goods P1-1): «Інвентаризація»'s «Не пораховані»
  and «Пораховані», a finished stocktake's «Розбіжності», «Залишки», a
  list's lines in «Початкові залишки» — the shared form of batch 14
  (`useNextPageFailed`):
  - a next page refused: the rows read stand; one plate at the foot in
    «Показати ще»'s place, its «Спробувати ще раз» reading that page alone;
    «Показати ще» back once it is read;
  - the whole list read again and refused: the plate over the rows, which
    stand, «Показати ще» held under it;
  - the stocktake read again from its top after one's own count, as
    before.
- **Decided here:**
  - a read refused because the right is gone (403): nothing read before
    stays in sight, in all four lists — the rule «stock access denial hides
    stale balances» kept and made every list's; any other refusal keeps the
    rows;
  - so «Залишки» read again and refused for anything but the right keeps
    its tags under the plate (before: hidden, the plate alone), as the task
    list's «строки стоят» asks;
  - after «Показати ще» or its page's retry, the cursor goes to the first
    position it brought: «Не пораховані» its first cell, «Пораховані» its
    «Перерахувати», «Залишки» as before; a list's lines and «Розбіжності»
    keep it where it was, as their «Показати ще» did; the stocktake forgets
    where the cursor was to go when the other list is chosen or the page is
    refused (review).
- **An order's step refused** (orders-cash P1-1), said where it was pressed,
  nothing above it moving:
  - «Прибув на пошту» on its row: under its tag, inside its row; its order
    moved on meanwhile (another phone), where its tag stood;
  - the card's steps (its MainButton's, «Скасувати замовлення»), and a
    sheet's step whose order moved on: at the card's foot, over the dock;
  - «Прийняти повернення»: under the tick, over the dock; the order taken
    back meanwhile, at the card's foot;
  - the cursor on it, the screen scrolled to it only when it is out of
    sight;
  - unchanged: the words (`orderErrorText`), one `error` buzz, the row and
    card read again; a kept step's refusal and «… ще не підтверджено» at the
    app's top, as every kept operation's; a new order's on its screen; a
    sheet's in its sheet.
- **Decided here:**
  - under its tag until the next step, another place or another search;
    where its tag stood, until the next tap — let go once that tap is
    delivered, so nothing moves under the finger first (review);
  - forgotten with its screen — the list left for a card, the card left,
    the return's screen left by «←» — as a new order's refusal is: never
    said over another screen, nor brought back when the card is opened
    again (review); pressed and left before the answer came, it is said by
    the app's banner, as before;
  - drawn again (its row moved on, its card read anew), the cursor is not
    brought again and nothing scrolls — unless the cursor was lost with its
    old place: then back on it, still without a scroll (review);
  - each refusal its own: a second is said and brought to the cursor as
    the first was (review: it was silent).

## Chosen in chat — 2026-11-13 (audit 2026-11-13, batch 2: every result's main in a dock at the menu's top; «Внесок записано» and «Борг списано» their own result's screens, no «←»; what is still owed in the debt's colour with its arrow; sale P1-1, P1-2, P2-3, frame P2-9)

Chosen here on 2026-11-13, after batch 1 (#202) was merged («merged, go
next»): the next points in the audit's own order — the sale task list's
«Партия 1 «Итог под пальцем»» (P1-2 → P1-1, with P2-3), and the frame's
P2-9, which asks to be built with sale P1-2. Built as the task lists give
them; what they did not give is a reading for the owner. No right, no server
rule, no sum, no word changes; what is recorded, and how, is as before.
- **A result's screen** (frame P2-9, sale P1-2; spec §5 «Док дій», §6.3,
  §6.5):
  - at least as tall as what shows over the menu (Telegram's stable height,
    never `100vh`); its main the last thing on it, in the dock: on the
    menu's top on a short result, sticking there while a long one scrolls,
    and ending there — before, a short result's dock (or its main) stood
    under its text mid-screen, and a long one ended 40 px over the menu;
  - the results: the till's receipt, «Продажу немає», the return's, S22 and
    «Борг списано», the cash close's, receiving's, «Клієнт забрав» (the
    order's card, while it says the sale), an invoice's and its payment's;
  - the mains as they were: «Новий продаж», «Готово», «Прийняти ще», «До
    замовлень»; an invoice's «Готово» Telegram's MainButton, outside
    Telegram in its place in the dock (50 high, 10 round);
  - a result's quiet ways under its stub, in its flow, as the receipt's
    «Змінити спосіб оплати» and «Оформити повернення»: the return's «Ще
    повернення» under the hint of a mistake's mending, «Клієнт забрав»'s
    two;
  - a return without the till: «До списку» the dock's one button, the
    screen's main (before: a quiet button under the hint).
- **Decided here:**
  - the screen's height is counted from main's top: a banner over a result
    (a kept operation's, an outage's) lets the page scroll by its height, the
    dock still on the menu as the result is first seen;
  - the MainButton's place in any result's dock is 50/10, as in an order's
    dock and a sheet's foot — so «Перевірка каталогу»'s outside-Telegram
    button is 50/10 too (frame P2-5, item 4, the same rule);
  - not touched: «Продано N шт.» (Borrowed) and a supplier's return's
    result, whose «Готово» stands in the pay panel's dock — not named by
    the task list; and «Перевірка каталогу»'s dock, a step, not a result.
- **«Внесок записано» and «Борг списано»** (sale P1-1; spec S22):
  - their own result's screen in the debt's place: «✓ Внесок записано» /
    «✓ Борг списано» the page's heading (before: a small heading under the
    coat's title); no «←», no Telegram «Назад», no ⋯; the line under it the
    store's and the person's, as the receipt's;
  - the payment's stub in S22's order: the way, what to do with the money,
    the sum, a perforation, what she took — the debt's first good and «+ ще
    N», every good on a tap, in the stub —, what is left, «Усього винні
    магазину «…»»; knotted when nothing is left, as before; a write-off's
    stub as it was;
  - in Telegram, a payment's «Відкрити борг» is its MainButton, and the way
    back quiet under the stub, no dock; outside Telegram, the way back
    («До боргів», or her name) the dock's main, «Відкрити борг» quiet under
    the stub; a write-off: the way back the dock's main, «Відкрити борг»
    quiet, in Telegram too (both kept, owner 2026-10-18);
  - unchanged: the sentence a screen reader hears with the title as focus
    comes to it, the success buzz, the menu shown, every sum the server's;
    a payment confirmed later is the compact block in its notice, as
    before.
  - Decided here: the debt's own line («Оксана · «Центр» · з 01.10») is not
    on the result — the task list gives it the receipt's; her name stays on
    the way back when the debt was opened from her card.
  - A reading for the owner: a write-off opened from «Борги» no longer
    names the customer anywhere on its screen — before, her name was the
    debt's title over «Борг списано»; now the title is «Борг списано», the
    stub the sum, and «До боргів» the way back. Her name on the write-off's
    stub, if the owner wants it, is one line.
- **What is still owed** (sale P2-3; spec §4): its sum in the debt's colour,
  700, the debt's minus arrow 16 before it, as a list's row says it — on the
  receipt in parts («Покупець винен …»), the return's («Покупець ще винен
  …»), S22 («Залишок боргу …»), the basket («Лишиться винен …»; «За номером
  уже винні …», whose line was in the colour already, its arrow added); the
  words as they were (В13-П2 open); «Борг сплачено повністю.» and «Покупець
  більше нічого не винен.» without it; the till's tray untouched until its
  screenshot. Contrast on the card 6.8:1 light, 8.61:1 dark.

## Chosen in chat — 2026-11-13 (audit 2026-11-13, batch 3: a way's refusal said in the till's tray over the ways, the page never moved; «Оплата частинами» a switch row; «Каса»'s rows and lists on a list's white block, nothing faded while its write is on its way; sale P1-3, P2-6, orders-cash P1-2)

Chosen here on 2026-11-13, after batch 2 (#203) was merged («merged, go
next»): the P1s left that wait on no owner's answer, in their task lists'
own order — the sale list's «Партия 2 «Касса»» (P1-3 with P2-6), and the
orders-cash list's P1-2, next after P1-1. Built as the task lists give them;
what they did not give is decided here or a reading for the owner. No right,
no server rule, no sum, no word changes; what is sold, kept and recorded,
and how, is as before.
- **A way's refusal at the till** (sale P1-3; spec §5 «Док дій», §2 P7,
  S09):
  - said in the tray, in its own flow between «Разом» and the ways — the
    place the task list gives «Ще надсилаємо…», which is drawn over the
    tray while a press is sent; what the terms need, once the basket's
    sheet is closed over it, in the same place; one at a time. Before: a
    paragraph after
    the till's list, the page scrolled to it; this replaces the chat's
    choice of 2026-10-30 («brought into view where it stands at the page's
    end, clear of the tray») — a chat choice, not the owner's;
  - its look: the error's colour and crossed circle 16, 14/500, no plate of
    its own — the tray is its plate; read aloud (`role="alert"`), one error
    buzz, as before; over the tray only the terminal's hint;
  - under a long list the tray rises by it: the ways where they were (±1
    px), the page not moved;
  - it goes as before: a way pressed again, the paper switch turned; the
    basket's sheet and the shelf's question keep their own refusals.
  - Decided here (review): a way pressed takes the last refusal away at
    once, before anything is checked — a press stopped by the terms says
    only what they need, never the old «Натисніть спосіб оплати ще раз»;
    the terms changed in the basket's sheet take what they needed with
    them, as «Клієнт забрав»'s do.
  - Decided here: an emptied basket takes the tray, and what it said, with
    it — a coat added after starts a tray that says nothing (before, the
    refusal stood under the list, about a basket gone, until a way was
    pressed).
  - Decided here: a sheet closed gives the cursor back to the button that
    opened it without moving the page when that button is on what sticks
    — the tray, a dock: Chromium scrolled the page by ≈ 300 px to where a
    sticky button would stand unstuck, every time the basket's sheet
    closed over a long list. A cell under the tray is still brought into
    view, as before.
  - A reading for the owner: at 360 px a long refusal takes more than the
    four lines the task list asks — «Частина цих одиниць у резерві
    замовлення…» five, «Цього товару вже немає в обліку…» (from paper) six,
    the tray then 302 px of 640; the conflict's three. The words are the
    owner's (В-П1 (б)) and are not cut.
  - A reading: on a short list — the tray standing in the page's flow
    under the last tag, a search narrowed to one model — the tray grows
    down, the ways moving by the refusal's lines, as they moved by the
    plate over the tray before. A tray on the menu's top whatever the list
    is changes the till's layout beyond this task.
- **«Оплата частинами»** (sale P2-6; spec S10 п. 7, §6.15): a switch row, as
  «Вношу продаж з паперу» on the same till — its words on the left, the
  switch on the right, the whole 44 row its target, read aloud as a switch;
  turned on, the cursor goes to the customer's name, as before. One
  component for both (`SwitchRow`), in the till's basket sheet and in
  «Клієнт забрав»'s sheet, which share the terms' fields: its five ways
  still on the screen at 360 × 640, none chosen. A switch that takes no
  tap (a sale on its way, a store stopped) keeps its words in pencil,
  nothing faded over them; the switch itself dimmed (decided here,
  review) — before, the paper switch's words faded to 45 %.
  - A reading for the owner: «Зніміть «Оплата частинами»» (a sale paid in
    full) was written for a tick; a switch is «вимкніть». The words are
    unchanged here.
- **«Каса»'s rows and lists** (orders-cash P1-2; spec §6.8, S25 №6–№7):
  - «Каса»'s rows, the seller's own operations, a day's operations and
    «Закриття» lie on a list's white block, as «Гроші», «Покупці» and «Ще»:
    the card's white, 4 round, a hairline round it in the light theme;
    the rows' sides 16, a hairline under each from 16, none under the last;
    a day nobody closed the same sides and hairline; their places while
    read on the same block;
  - while a write of «Каса» is on its way, its rows that take no tap
    meanwhile (all but «Закриття», which stays open, as before) no longer
    fade to 45 %: their titles in pencil, as a list's row that takes no tap
    everywhere (4.5:1 and more on the card, both themes); a day's operation
    that may not be changed as before;
  - a «Каса» row's chevron the set's `sale-open`, in pencil 16, as before to
    the eye;
  - unchanged: the thread «Видано й внесено після закриття» and the ink tag
    «Закрити касу» stay on the paper; sums, order and who sees what.
  - Decided here: a person with none of «Каса»'s tasks sees no empty white
    block where its rows would lie (an empty list's block is not drawn,
    anywhere).
  - Noted: the no-fade rule reaches every row whose title is «Каса»'s
    class — suppliers' rows and «Сьогодні»'s search rows while held keep
    their titles in pencil and no longer fade; the frame's P2-4 asks the
    same of any row.

## Chosen in chat — 2026-11-14 (audit 2026-11-13, batch 4: «Гроші»'s places in store columns, a figure large; sums under 22 px in the text face; the invoice tag's sum `money-m`; the price sheet's no answer one text; money P1-1, P2-3, frame P2-8, goods P1-2 part 1)

Chosen here on 2026-11-14, after batch 3 (#204) was merged («merged, go
next»): the P1s left that wait on no owner's answer — the money list's P1-1,
with the frame's P2-8 it depends on («the condensed face never below 22»)
and the money list's P2-3 on the same rule; and the goods list's P1-2 part
1, which needs no answer (its part 2 waits on В13-Т1). Built as the task
lists give them; what they did not give is decided here or a reading for
the owner. No right, no server rule, no word changes; every figure is the
one the server answered, none added or counted again on the phone.
- **«Де гроші зараз»** (money P1-1; spec S29 №4, §5.5 `money-l` «money
  places»): this revisits the chat's choice «each place says a line a
  store» (2026-11-12, batch 12) — a chat choice, not the owner's.
  - A store's figure in its parts: the store's name as the day's tag names
    a store (`label`, «Центр» in its quotes), the words before the figure
    in `meta` pencil, the figure, the words after in `meta` pencil:
    «учора порахували» · 5 380,00 грн · «о 20:06»; «Винні» · 8 400,00 грн ·
    «4 людини»; 38 000,00 грн · «3 накладні»; the card's and transfers' a
    figure alone. Heard, a store is the phrase it was — «Центр»: учора
    порахували 5 380,00 грн о 20:06 — its colon and joints heard, never
    seen.
  - Two stores in a place, two columns, as the day's tag; one store, or
    three and more, a row each — the name and its words at the left, the
    figure at the right. Decided here: each place counts its own stores (a
    place read in one store is a row even where another place has two).
  - The figure 32/34 in the display face from 390 px; narrower, 20/24 in
    the text face, 600, even figures (`money-m`); in a row, `money-m`
    always. A million or more at 24 in the display face at any width, as
    the day's tag's `long` — decided here: the task list says «as the day's
    tag's», and the day's tag keeps it at 24 under 390 too.
  - Where there is no figure — «Каса ще не рахувалась», «Ніхто не винен»,
    «Нічого не винні», «не вдалося прочитати» — one line in the figure's
    place, 15/20; «Ніхто не винен» and «не вдалося прочитати» in pencil,
    the others in ink, as before; while read, a grey bar in the figure's
    place.
  - What customers owe: «Винні» and its figure in the debt's colour — its
    kopecks and «грн» too, as a customer's card says a debt (decided here,
    review) — the count after in pencil, the name in ink (before, the whole
    line was in the debt's colour); what is owed to suppliers in ink.
  - The open store of «Ви винні постачальникам» is the one way to its
    «Накладні», as before: its whole column, or its whole row, the button,
    44 high at least, as tall as the other store's column beside it
    (review); its chevron by the words after the figure in a column, by the
    line where there is no figure (review) — decided here: in a row, after
    the figure at the row's right, its parts in the row's middle;
    heard as before («Накладні магазину «Центр»: 38 000,00 грн · 3
    накладні»); held, its words in pencil, nothing faded.
  - Unchanged: «Сьогоднішня готівка — після вечірнього підрахунку.»,
    «Видано сьогодні» with its lines a line each, the rule's line, the
    places' plates, stamps and order; the day's tag is not shared as one
    component with «Гроші» — decided here: the same proportions, each its
    own markup (the frame's pass named no common column).
  - A reading: a place read slowly grows once read — its bar one line, its
    figure with its words two or three more; nothing is under the finger
    then (the places are read as the screen opens).
  - A reading: the parts are spans in the phrase's order, the colon and the
    joints hidden from the eye alone; a phone's reader that stops on each
    line of a column may read a store in three or four stops. Not measured
    on a phone.
- **Sums under 22 px** (frame P2-8; spec §5.5 «List money ≤ 20 px uses the
  text face 600 tnum, never the condensed face below 22»): the day's tag's
  store sums in rows, and in its two columns narrower than 390, and
  «Гроші»'s figures the same, in the text face, 600, even figures; their
  kopecks and «грн» as every sum's. 22 px and more stay in the display
  face — a million's 24 included.
- **The invoice tag's sum** (money P2-3): `money-m` as a model's price on its
  tag — the text face, 20/24, 600, ink, beside the supplier's name.
- **No answer in the price sheet** (goods P1-2 part 1): a gateway's 502, 503
  or 504 says what a lost network says there — «Немає відповіді сервера.
  Натисніть ще раз — повторне збереження безпечне.» — no paper's words in
  the sheet; the frame's plate over the screen as before. «Брак» and the
  stocktake's start and end keep their words until В13-Т1.
