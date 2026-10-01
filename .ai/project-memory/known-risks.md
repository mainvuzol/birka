# Known Risks

- Over-merging distinct products because they share a shop nickname/model name.
- Treating source identities as brands without business confirmation.
- Treating slash-separated values as aliases instead of distinct variants.
- Fabricating size/color quantity distribution during legacy import.
- Prematurely freezing taxonomy before enough real inventory samples are collected.
- LLM overconfidence on unfamiliar descriptors.
- Duplicate sales/stock corruption under retry/concurrency.
- Incorrect cross-store inventory authorization/transfer behavior.
- Client-supplied text that Python accepts and PostgreSQL cannot store (NUL, lone surrogates) turning an authorized request into a 500 after the write has begun. Guarded by `app/core/text.py`; any new free-text field must use it.
- Refund money drifting from the receipt if any future code path recomputes an amount instead of reading the frozen `SaleItem`.
- Shared stock recorded as two per-store balances: the two rows never contend, so the conditional update that prevents overselling has nothing to serialise on, and one coat can be sold twice. **Addressed by M1-029**: the balance is keyed by warehouse, so two stores selling one pile contend on one row. The risk returns for any future table that keys stock by store again.
- Granting a store `can_sell` on a warehouse whose contents were recorded under a different store. The migration deliberately grants nothing beyond today's reach; every shared arrangement is a deliberate data step, and combining two balances is never automatic.
- Combining the two stores' existing balances on the assumption that they are the same goods. Whether they are is unknowable from the database; a wrong merge is an irreversible loss of stock identity. Any correction must be an audited adjustment, never a migration.
- A seller in one store minting stock into a shared warehouse through `FOUND_DURING_SALE`, inflating a balance the other store depends on.
- Over-refunding under concurrency: invariant I9 has no database backstop and rests on one `FOR UPDATE`, so the reconciliation query cannot detect a violation — stock and ledger stay consistent while more is refunded than was sold.

### M1-029 foundation verification — 2026-09-17

Stock is keyed by warehouse as of `0006_stock_rekey`, and location access is enforced on every read and write. Live risks, in order:

- **PostgreSQL 17 is verified for this change set** (2026-09-17, isolated Docker run: 6 revisions, round trip, 394 tests, invariant sweep — [report](docker-postgresql17-verification.md#run-2--2026-09-17--the-m1-029-stock-re-key)). No longer a risk; kept here so nobody re-opens it.
- **`POST /sales` p95 was not re-measured** with the added access join, against the ≤ 500 ms budget the design sets. Still open: a functional run on PostgreSQL 17 is not a load profile.
- **`0006` refuses to run if `stock_location` or `store_location_access` already has rows.** Do not provision a warehouse by hand on a database still at `0005`.
- **Rollback of `0006` has hard bounds** and refuses outside them: a shared warehouse, a store with two warehouses, or a warehouse no store reaches. All three are states normal operation will reach — the shared-access data step and M1-018 both close the window. Prefer rolling back application code while keeping the schema, as ADR-0003 already prefers.
- **A migrated warehouse is always active**, never inheriting the store's flag; do not read a location's state as a statement about a shop.

### M1-018 transfers — 2026-09-22

Goods now move between warehouses (`POST /api/v1/transfers`, [report](m1-018-transfer-report.md)). Live risks, in order:

- **`can_sell` at the source is enough to take goods out, and that rule is a design proposal, not an owner decision.** With design §3's rows, a child-store manager can move the whole shared pile into the child's own warehouse, and then neither store can move it back: the child has no `can_receive` at the shared warehouse, the primary store no `can_sell` at the child's. Recovery is an access row or two audited adjustments. Pinned by `test_can_sell_alone_at_the_source_is_enough_to_move_goods_out`, so changing it is a decision rather than a drift. Owner question 2 in the report.
- **A closed warehouse cannot be emptied by a transfer.** Its stock stays readable but cannot move until it is reopened. Nothing in the application closes a warehouse today — only a direct operator action does, and the same action reopens it — so the risk is operational. Owner question 3.
- **Single-step transfers record goods as arrived the moment they leave** (assumption A8, Q5). Goods lost in transit would still be on the destination's books until a stocktake finds them.
- **Half of invariant I24 has no mechanical check.** Pairing is enforced at the ledger's door; "nothing else moves goods between places" holds only because every command is built that way. A new stock command must be reviewed against it; the cheap enforcement point, if one is wanted, is a per-location net ≤ 0 check inside the sale command, which has both of its ledger calls in hand.
- **A non-HTTP caller must build its scope from the database.** Real requests do, so a deactivated store is refused on replay; a hand-built or stale scope would replay a success for it. The future Telegram handler must use the same scope resolution.
- **Rolling back below `0007` is bounded by `0006`.** Every transfer needs a store that reaches two warehouses, which `0006`'s downgrade refuses by name; if the access rows were edited back to one-to-one while transfer rows remain, it fails on `NOT NULL` inside its own transaction instead. Safe, but not a friendly message. Prefer rolling back code and keeping the schema.

## Business review — 2026-09-22

See [review evidence and priorities](business-model-review-2026-09-22.md). Fresh migrate→seed reproduced two stores but zero warehouses/access (setup blocker). Existing single-step transfers immediately credit destination stock and do not implement the newly requested in-transit/arrival process. Shared/private topology needs explicit provisioning/policy; current generic grants only represent it when correctly configured. Postal arrival versus acceptance and organization-manager authority remain unanswered. 475 tests passed locally on PostgreSQL 16.2; this does not cover the missing setup or new staged behavior.

## M1-023 legacy stock lists — 2026-09-28

See the [report](m1-023-snapshot-import-report.md) and [ADR-0005](../decisions/ADR-0005-legacy-snapshot-import.md).

- **An opening balance is a one-way door per warehouse** (confirmed by the owner, 2026-09-29). Any stock movement at a warehouse before its list is approved closes that door for good, because the ledger is append-only. The seed grants `can_sell` from day one, so a single «фізично є» is enough. Warehouses holding test data can never take one: importing real balances at launch needs warehouses with no history, which belongs with the owner's import-or-start-empty decision.
- **Paper sales entered before the approval close the door.** The owner's procedure is to enter them afterwards (2026-09-29), and nothing in the app enforces the order: the mistake surfaces only at approval, as `OPENING_BALANCE_CONFLICT`, after the review work is done. A guard that refuses stock commands at a warehouse whose list awaits a decision would need a location state and a migration; it is proposed, not built.
- **Back-entered paper sales carry the date they were entered**, not the day they were made. Takings by day are off for that stretch. A "sold on" date is a separate change to sales and money.
- **"Size not known" stock gets its size only at the counter**, one sale at a time, bounded to what the sale takes (owner decision, 2026-09-29). Outside a sale there is still no reclassification command, so a manager cannot fix sizes in bulk. «Фізично є» on a sized key beside such stock is still refused, and «фізично є» never adds it; receipts and positive adjustments refuse it too.
- **The adjustment command no longer accepts the two `SIZE_RECLASSIFICATION_*` reasons** (422). No client sent one; a script that did now fails.
- **A reservation on either balance blocks a clarification**, as it blocks «фізично є» (found by the 2026-09-29 review). If a customer order holds a "size not known" coat of a model, no other coat of that model at that warehouse can be clarified until the order is dispatched or released; the seller sells it as size not known. The refusal names the balance so a client can offer that. Whether unreserved units may be clarified is a question for the owner if it comes up in practice.
- **«Фізично є» counts only unreserved "size not known" coats** (since M1-023). If every such coat of a model at a warehouse is reserved, a coat found at the counter may be one of them, and would be counted twice.
- **A size misread at the counter has no paired reversal.** Reclassifying back into "size not known" is refused by design, because that size enters only from a list. It is corrected like any wrong sale: a return and a new sale, or an adjustment.
- **Retries across this deploy are refused, not replayed.** Both fingerprints of a sale now include `size_clarified`, so a retry of a sale made before the deploy that arrives after it gets `409 IDEMPOTENCY_CONFLICT`. Nothing is sold twice, and there is no production data yet.
- **Some plainly single-piece lines need a note.** A line with a bare number (`Куртка 1636`, `Куртка 46`) or two counts cannot be taken as one piece without saying how that is known, because the number may be a count, a size or an item code.
- **Every stock command takes one more lock**: a shared advisory lock per warehouse. Cheap, but on the `POST /sales` hot path, whose p95 is still unmeasured.
- **No review screen.** Answering hundreds of lines through the API is not practical for staff. A UI is the next increment if the owner decides to import.
- **Transcription is manual.** Photos and PDFs are typed into lines by a person; there is no OCR and no LLM (M1 decision).
- **Receipts are narrower.** They no longer accept `TRANSFER`, `RETURN`, `ADJUSTMENT` or `OPENING_BALANCE` lots. No client sent them; a script that did now gets 422.
- **Migration `0015` scans `stock_movement` and `stock_lot` under an exclusive lock** to add its CHECKs. Run it in a maintenance window, **with no older instance of the app running**: code before `0015` takes no warehouse lock, so an old instance writing stock during an approval would reopen the design review's first finding.
- **Duplicated validation.** `catalog.validation.require_active_variants` and `catalog.decisions._validate_variant` enforce the same tenant-chain rule. They should be consolidated.

Found by the independent code reviews (2026-09-28). The fixes are in the report; these remain.

- **The catalog parser is superlinear.** Two things scale badly with a line's length: size tokens are rescanned per token, and the slash pattern backtracks. A 2 000-character hostile line costs about 70 ms. The stock-list import is bounded (500 characters a line, 100 000 a list) and parses off the event loop. A linear parser needs a parser version and the evaluation gate. The catalog preview and decisions take one line of up to 2 000 characters per request, bounds that predate this.
- **No request-size limit or rate limit in front of the API.** `infra/Caddyfile` sets no body limit, and nothing limits requests per user. This predates M1-023 and applies to every endpoint.
- **A parse is stored twice.** `ParseResult` keeps `unclassified` beside the full `parsed` document. This is bounded by the import limits, and changing it is a parser-storage change.
- **An approval holds its warehouse exclusively while it writes.** That is up to 5 000 lots and movements, with no `lock_timeout`, and it is not measured. By definition nothing else has written to that warehouse yet.
- **The catalog check at approval is unlocked.** `require_active_variants` reads variant status without a lock. No command retires or merges a variant today; one that does must serialize with approval.
- **Lines are stored verbatim, including bidirectional and zero-width characters.** Nothing renders them today. A future review screen must neutralise them.
- **The freeze and the ledger triggers guard rows, not `TRUNCATE`**, like `0002`'s append-only triggers. For the same reason, hard-deleting a user or an organization that a decided list names is refused. The app never hard-deletes either.

## The till — 2026-09-29

A seller can take money over the counter ([report](m1-025-sale-ui-report.md)).
Live risks and properties, in order:

- **An outstanding customer reservation on a stock key disables «фізично є»
  for that key**, for every seller, until the order is dispatched or released.
  This is the designed behaviour of `correctable`, not a defect, but it is the
  first time it is reachable from a screen: a seller holding a coat the ledger
  does not know about, of a model another customer has reserved, simply cannot
  sell it. The till says why. Found when a browser test sharing a warehouse
  with the order specs could never reach the correction.
- **The suggested price is now set and read (2026-10-01).** The owner
  answered Q-F; see the [report](suggested-price-report.md). What remains:
  - **A till open on one phone keeps the price it loaded** until its list is
    read again. The seller agrees the final price anyway, so a stale
    suggestion costs a correction, never a wrong sale.
  - **A price's history is in the audit log only.** Nothing shows it in the
    app.
  - **The shared price needs the permission in every store**, unless it is
    held organization-wide. A store opened later takes that right away from
    anyone holding it store by store, until they are given it in the new
    store too. That is deliberate: the shared price reaches the new till.
- **The sale journal lives in `localStorage`.** Clearing the app's data while a
  sale's outcome is unknown loses the record of which key to replay. The sale
  itself is still safe — `command_id` is permanent and the server holds the
  cached response for 7 days — but the seller loses the in-app path to it and
  needs a manager to look the sale up.
- **`size_clarified` has a screen** since PR #42: the till offers the size
  on the label.
- **Confirming zero present is refused**, and the till's honest answer is to
  remove the line by hand. One extra tap while a customer waits. The owner
  answered Q-G on 2026-10-01: drop the line and record the shortage. It is
  not built yet.
- **`POST /sales` p95 is measured and passes** (2026-09-29, worst p95 95 ms
  against a 500 ms budget with six concurrent sellers; the catalogue read is
  38 ms against 300 ms). The warehouse lock M1-023 put on the hot path costs
  nothing measurable — six sellers contending for one coat were *faster* at
  p95 than six selling different ones. See the [report](hot-path-budget-report.md).
  This was a laptop on PostgreSQL **16.2**, not the pinned 17, and no phone or
  mobile network was involved: it proves nothing is an order of magnitude
  wrong, not that a seller in a shop feels it.
- **`taps-to-sale` is 5 against 5 for a model with a suggested price**
  (2026-10-01), counted on the built screen. The till prefills the price, so
  nothing is typed. It is still 6, plus typing, for a model nobody has
  priced. The budget holds only as far as the shop prices its models.

## Command identity for stock intake — 2026-09-29

See [ADR-0006](../decisions/ADR-0006-goods-receipt-command-identity.md) and the
[report](receipt-command-identity-report.md).

- **`POST /inventory/adjustments` could apply twice** — a `STOCKTAKE` of +7
  replayed after its 7-day record was gone left 14. **Closed by `0017`**
  (ADR-0007, 2026-09-30): an adjustment now carries a permanent `command_id`
  and a late retry receives the original answer. Kept here so nobody reopens
  it. Manual adjustments made before `0017` name no command.
- **Receiving goods had the same defect until `0016`** and no longer does.
  Kept here so nobody reopens it: a receipt now carries a permanent
  `command_id`, and a retry at any distance in time returns the original
  delivery.
- **Rolling back `0016` keeps the stock but loses every receipt's identity.**
  Re-upgrading leaves those receipts open to a replay of their own
  `command_id`. Prefer rolling back code and keeping the schema.
- **Lots created before `0016` name no delivery.** `goods_receipt_id` is NULL
  for all of them, deliberately: their original request cannot be
  reconstructed, and inventing a receipt would record a fact nobody stated.

## Stock correction screen — 2026-09-30

See the [report](stock-correction-ui-report.md).

- **Only a stocktake is guarded against a balance that moved.** It carries
  `expected_quantity` and is refused as `STOCK_CHANGED`. A write-off of
  damaged or lost goods sends only the change, deliberately: one damaged coat
  is one coat whatever the balance. A script calling the API without
  `expected_quantity` gets the old delta behaviour for any reason.
- **The API still lets `DAMAGED` or `LOST` add stock**, and still accepts the
  two at-the-counter reasons from a manager. The screen offers neither; the
  API was not narrowed, because no rule says it must be and a caller may rely
  on it.
- **Goods the system holds none of need `inventory:receive` as well**, for
  the catalogue search. The default manager holds it; an owner who
  recomposes a role without it loses that half of the screen, not the
  correction of listed balances.
- **One balance at a time.** There is no bulk stocktake of a whole warehouse.

## A size read at the till — 2026-09-30

See the [report](size-clarified-ui-report.md).

- **Selling a coat by the size on its label needs `inventory:receive` too.**
  The organization's sizes come from the receiving endpoint. The default
  seller holds it. A role recomposed without it can still clarify a size as
  the answer to a shortfall on a line whose size is already listed.
- **The till learns that a model is held with its size not known from
  three places:**
  - the page of the list it has loaded;
  - a line built from such a row;
  - the server refusing «товар на місці» because of it.

  When none of these applies, the seller answers the shortfall once more.
  That costs one extra tap, and nothing is recorded wrongly.
- **One unit asked for no longer offers «на місці лише стільки»**: fewer
  than one present is none, and the answer is to remove the line (Q-G).

## Backups — 2026-09-30

See the [report](m1-028-backup-restore-report.md) and the
[runbook](backup-restore-runbook.md). The owner set the policy the same day:
daily, 7 days plus 3 monthly, encrypted, collected by the owner's machine.

- **None of it runs on the server yet.** Until someone does the setup, one
  disk failure can take the database and every backup with it:
  - the key;
  - the `.env` line;
  - cron;
  - the read-only SSH user;
  - the owner's collection schedule.
- **The owner now hears of a failed or missing night** — in the
  «Резервні копії» section and from the bot
  ([alerts report](m1-028-backup-alerts-report.md)). What is still not
  covered:
  - **The watcher lives on the same server.** If the whole server or its
    database is down, nobody sends anything. The shop sees the app down, and
    the owner's collection script finds nothing new, but no message says why.
  - **The bot reaches only an owner who pressed «Start» in its chat.**
    Until then Telegram refuses; the section shows that, but only to an
    owner who opens it.
  - **A message may arrive twice** if the watcher dies between sending it and
    recording it. Chosen over the opposite risk: a warning that never comes.
  - **Messages are silent** (owner decision, 2026-10-01): nothing wakes
    anyone at 03:15, and a warning is seen only when the owner looks at the
    bot's chat or the section. The tab's «⚠» is there for that.
  - **Not run in production and not sent to a real Telegram.** The Telegram
    client is tested against Telegram's own answers played back, not the
    network.
- **A restore loses up to a day.** No WAL archiving exists; the owner chose a
  daily backup knowing this.
- **The owner's private key is the only way to read any backup.** Lose every
  copy of it and every backup is unreadable. This is why it lives in the
  password manager and on paper or a USB stick.
- **A real restore has not been rehearsed on a server.** The drill uses the
  same `pg_restore` flags; the runbook's full sequence has not run in
  production.
- **`.env` is not in the backup.** Keep it in the password manager too.

## Returns at the till — 2026-10-01

See the [report](till-returns-report.md). The owner decided the rules the
same day: intact back where it was sold, damaged to the store's own «Брак».

- **«Брак» has its own section since the same day**
  ([report](damaged-inspection-report.md)). Stock there changes only
  through returns and that section; the server refuses every other way.
  - **A return to the supplier has no step of its own.** Until it does, a
    confirmed unit sent back is written off with a note.
  - **«На перевірці» is information, not a lock.** Anyone may finish a
    unit someone else took. Only taking it again is refused, so that two
    people do not start on one.
- **Only the refund checks that nobody sells from a «Брак».** The database
  holds it for the store the «Брак» belongs to. If an operator later lets
  another store sell there, goods already in it become sellable by that
  store. No screen can grant access today; setup is by script.
- **A delivery into «Брак» is refused by the server** too, since the
  owner's rule of the same day that «Брак» changes only through returns and
  its own section.
- **Returns taken before 2026-10-01 have no condition.** It was never asked,
  and is not guessed. There are none in production.
- **An organization set up before «Брак» existed gets it on the next run of
  `seed_organization`**, as a new, recorded warehouse. Until then a damaged
  return is refused there with `DAMAGED_RETURNS_UNAVAILABLE`, and says so.
- **A return goes only through the store that sold.** Returns from another
  store remain an open owner question.
