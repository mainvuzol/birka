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
- Receipts record only purchased, consigned or borrowed goods. Opening balances, transfers, returns and adjustments each have their own command.

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
  §1).
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
