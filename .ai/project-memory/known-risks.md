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
- **Back-entered paper sales carry the date they were entered**, not the day they were made. Takings by day are off for that stretch. A "sold on" date is a separate change to sales and money. *Since 2026-10-08 this covers the sales of an outage too: they keep the paper's hour in their mark, but count on the day they are typed (see [the server is unreachable](#the-server-is-unreachable--2026-10-08)).*
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

- **The catalog parser is superlinear.** Two things scale badly with a line's length: size tokens are rescanned per token, and the slash pattern backtracks. A 2 000-character hostile line costs about 70 ms. The stock-list import is bounded (500 characters a line, 100 000 a part: a pasted text or a file) and parses off the event loop. A linear parser needs a parser version and the evaluation gate. The catalog preview and decisions take one line of up to 2 000 characters per request, bounds that predate this.
- **No request-size limit or rate limit in front of the API.** Closed on 2026-10-03: Caddy refuses a body over 1 MB, and the API limits sign-ins per address ([before the public domain](#before-the-public-domain--2026-10-03)). Since 2026-10-10 signed-in requests are limited per person too ([ADR-0020](../decisions/ADR-0020-requests-per-person.md)).
- **A parse is stored twice.** `ParseResult` keeps `unclassified` beside the full `parsed` document. This is bounded by the import limits, and changing it is a parser-storage change.
- **An approval holds its warehouse exclusively while it writes.** That is up to 5 000 lots and movements, with no `lock_timeout`. By definition nothing else has written to that warehouse yet. **Measured on 2026-10-08** (ADR-0014 §10, [evidence](../../output/verification/2026-10-08-json-import-approval/README.md)): 7.6 s at 5 000 answers on the local PostgreSQL 16; on 2026-10-09, with every answer by size read again at the approval, at most 8.6 s, and the 2026-10-08 method up to 9.5 s the same hour on a busier laptop; measured again in the review's third round the same day, by size at most 8.48 s and the 2026-10-08 method up to 9.87 s, 0.13 s under the 10 s rule ([evidence](../../output/verification/2026-10-09-json-import-approval-by-size/README.md)); see [the JSON stock import](#the-json-stock-import--2026-10-08).
- **The catalog check at approval is unlocked.** `require_active_variants` reads variant status without a lock. No command retires or merges a variant today; one that does must serialize with approval. **Closed by ADR-0008 (2026-10-03):** resolving a line and approving a list hold their models `FOR KEY SHARE`, which a merge and a retirement wait for; the refusal names the lines.
- **Lines are stored verbatim, including bidirectional and zero-width characters.** Since 2026-10-08 «Початкові залишки» shows every line, and every string from a file, through a guard that marks them visibly (ADR-0014 §15). The catalogue screens showed raw text unguarded until 2026-10-10; now every screen marks text from outside (ADR-0018), and what is stored still holds the characters.
- **The freeze and the ledger triggers guard rows, not `TRUNCATE`**, like `0002`'s append-only triggers. Since 2026-10-09 the API's own role may not truncate at all (ADR-0016); the owner still may. For the same reason, hard-deleting a user or an organization that a decided list names is refused. The app never hard-deletes either.

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
- **Zero present is an answer now (Q-G, 2026-10-01).**
  - The line is dropped and its shortage recorded, and the rest is sold.
  - A basket with nothing left records an empty shelf without a sale.

  See the [report](empty-shelf-report.md). What remains:
  - **Nothing shows recorded empty shelves.** They are in the ledger and the
    audit log; a manager sees them only as `MISSING_AT_SALE` movements.
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
    Since 2026-10-03 ([ADR-0011](../decisions/ADR-0011-failures-are-visible.md)),
    the watcher tells of a database that stopped from the owners' chats it
    remembers, and an outside service hears its check-ins stop when the
    whole server dies, once someone has set that service up.
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
  production. It ran end to end on a laptop, in Docker, on 2026-10-09,
  which fixed its restore command and added setting backups up again
  ([report](restore-rehearsal-report.md)). Not rehearsed there: the SSH
  leg to the owner's computer, a real domain's certificate, and a server's
  own disk and cron.
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
  store remain an open owner question. *Built later the same day; see
  "returns at another store" below.*

## People — 2026-10-01

See the [report](people-report.md). The owner decided that people are added
on the server, on an owner's word.

- **The approval is a record, not authentication.** Whoever can run
  `scripts.people` can name any owner with `--approved-by`. Access to the
  server is the real lock, as it already is for the database itself.
- **The owner sees who has access only through the administrator** (`list`
  on the server). That is the owner's choice.
- **Turning a person off ends their memberships in this organization, not
  their account.** `app_user.is_active` exists and nothing sets it.
- **The last owner of every store cannot be removed or turned off.** This is
  a safety guard of our own, not an owner rule. If the only such owner
  leaves, `seed_organization` on the server is the way back.

## Release gate — 2026-10-01

See the [release checklist](release-checklist.md) and the
[server runbook](server-runbook.md).

- **The `hot-path` CI job measures on a shared two-CPU runner**, where six
  sellers asking back to back came within 3 % of a budget. CI fails only on
  the one-seller cases, which have 10× headroom there. A regression that
  shows only under concurrency is printed as `(not gated)`, not failed:
  read the artifact when touching locks or the hot path, and take the
  release reading with `BIRKA_PERF_GATE=all`.
- **A rebuild picked up new minor versions** of `postgres:17-alpine` and
  `caddy:2-alpine`, untested. **Closed on 2026-10-10**
  ([ADR-0019](../decisions/ADR-0019-what-the-server-is-built-from.md)):
  every image is pinned by its digest.
- **The server's size is an estimate**, and public HTTPS issuance has never
  run.
- **Docker logs were unbounded** until this gate; they are now 5 × 10 MB per
  service. The cron log of the nightly backup was not rotated; since
  2026-10-03 the backup runbook rotates it monthly.

## «Початкові залишки» — 2026-10-01

See the [report](opening-stock-screen-report.md).

- **A list goes only into a warehouse with no history.** Nothing says so
  before the approval. The screen's hint does, and the refusal explains
  itself. Approve the lists before the first receipt or sale there.
- **A list stops its warehouse until it is decided** (owner, 2026-10-02),
  when nothing has moved there yet. A list typed for the wrong empty
  warehouse stops that one: reject it. A list left waiting stops the
  warehouse for as long as it waits; nothing reminds anyone.
- **Paper sales and deliveries after the approval are in people's hands.**
  The app keeps lists before deliveries; the order of the paper sales and
  the deliveries that came after the count is whoever enters them to keep
  (owner, 2026-10-02).
- **Goods found later are received as ordinary receipts** (owner,
  2026-10-02): a delivery that day, a purchase when a seller enters them.
  Nothing tells them apart from goods bought that day.
- **The photos → parser → JSON way, chosen on 2026-10-08, is built** the
  same day ([the JSON stock import](#the-json-stock-import--2026-10-08)).
  Its JSON is never loaded as stock directly: its lines become a list's
  lines and pass through the same review (owner, 2026-10-08).
- **A slow review is the price of no invented counts.** Hundreds of lines on
  a phone take time. Not measured with real notebooks.


## Paying in parts — 2026-10-01

See the [credit report](customer-credit-report.md).

- **A return of a sale paid in parts must hand back `cash_back`, not
  `total_amount`.** The returns screen now says so, and says nothing about
  cash until the server has answered. See the
  [credit screens report](credit-screens-report.md).
- **One phone is one customer** (owner, 2026-10-01). Two people who share a
  phone, such as a couple, show as one customer with both their debts. A
  customer who changes number shows as two. Only a Ukrainian number is
  matched across its spellings (`380…` and `0…`).
- **What is owed is the agreed amount less the ledger's rows.** A written-off
  debt shows nothing owed whatever its rows add up to. A later return only
  ever pays back cash actually paid.
- **The customers' phones are personal data.** Everyone holding `sale:credit`
  in the store sees them, as the owner chose, and so do the backups. They are
  kept out of the audit log, the logs and the receipt. Since 2026-10-03 that
  holds for a debt search's query string, a refused row's values and Sentry
  too (`test_log_privacy.py`, `test_sentry_privacy.py`). Since 2026-10-09
  they are erased in time; see "Customers' data", below.

## Returns at another store — 2026-10-01

See the [report](returns-elsewhere-report.md).

- **A seller sees another store's sales in a search.** Whoever takes returns
  in their store may search the network's sales by the goods' name, as the
  owner chose. A search shows the goods, prices and dates, never a
  customer's name or phone.
- **Money paid out by one store for another's sale is recorded, not
  settled.** Each return names the store that paid. Nothing yet adds up what
  one store paid out for another, and nothing settles it between them.
  *By design (owner, 2026-10-01): stores of one network do not settle with
  each other.*
- **Goods may come back to a warehouse the selling store does not reach**,
  when the seller chooses one. It is recorded on the return and in the
  ledger.
- **A closed store's own returns keep the old rule.** It may refund without
  restocking. Taking back another store's goods there is refused.
  *Superseded by store states (2026-10-01): a blocked or archived store takes
  nothing back.*

## Store states — 2026-10-01

See the [report](store-states-report.md).

- **A command already running when a store is blocked finishes.** A command
  that moves stock holds its store, so a change of state waits for it.
  Anything else checked the store when the request arrived: a payment or an
  order step sent in that instant may still land. A block stops what comes
  after it, not what was already under way.
- **Goods could reach an archived store's own warehouse through another
  store,** if an owner ever grants that other store explicit access to it.
  The archive counts the warehouse empty when it closes. Nothing yet stops
  another store receiving into it later. No such grant exists in the shop
  today.
- **Money taken by one store for another's debt is recorded, not settled.**
  Each payment names the store that took it, as each return does. Nothing
  adds it up between stores yet.
  *By design (owner, 2026-10-01): stores of one network do not settle with
  each other.*
- **The network's owner cannot see a blocked store's private warehouse.**
  A network-wide role never reaches a private warehouse (owner rule of
  2026-09-23), blocked or not. The archive's refusal names it and its units.
- **"Only reading" is decided by the HTTP method.** Every command is a POST;
  a GET that changed something would be let through in a closed store. None
  does today, and a review of every `GET` handler found none writing.
- **Until 2026-10-04 the store's hold was stronger than written.**
  - `with_for_update(key_share=True)` renders `FOR NO KEY UPDATE`, not
    `FOR KEY SHARE`.
  - So every command of one store queued behind the one before it on the
    store's row: for instance, every sale behind a long delivery being
    received.
  - Fixed: the hold is `FOR KEY SHARE`, with a test that two commands of
    one store run at once while a change of state waits for both
    (`test_store_hold.py`).
  - What each command changes was already guarded by its own row locks.
    The stock rows are locked in order, so no new deadlock arises.
  - **What remains:** a change of state, or the day's close, waits for a
    moment when no command of the store is running. While the store's
    commands keep overlapping, later ones can go ahead of it. At a few
    sellers per store such a moment comes within a sale.
  - **Speed on the laptop barely changed,** with one API process. In four
    alternating readings, the median of the six-seller cases fell by 10–20 %
    and their p95 rose by 10–30 %. All cases stayed far inside the budget
    (worst p95 90 ms against 500). Evidence:
    [`output/verification/2026-10-04-store-hold/`](../../output/verification/2026-10-04-store-hold/).

## Returns to a supplier — 2026-10-01

See the [report](supplier-returns-report.md).

- **No money is recorded with a return.** The owner chose goods only: what
  the supplier pays back or sets off stays outside the system until the
  store's purchase installments are built. *Superseded (2026-10-01): what
  the supplier counts for returned goods is a set-off on an invoice, see
  below.*
- **Receiving does not record a supplier.** A return names one, but nothing
  links it to the delivery the goods came in.
- **A cancellation puts goods back where they left.** If that warehouse has
  been closed since, the cancellation is refused until it is reopened.
- **Acquisition costs are untouched.** A return does not say which lot went
  back; the ledger records the units only.


## What a store owes its suppliers — 2026-10-01

See the [report](supplier-invoices-report.md).

- **An invoice is not linked to the goods it paid for.** The owner chose to
  record it on its own. Nothing checks that the sum on it matches what was
  received, or the purchase prices typed on received lines.
- **A set-off's sum is what the person types.** Nothing ties it to the
  returned goods' worth: no purchase price is known for them. One return may
  be set off against several invoices, and nothing caps the total.
- **A payment above what is owed is refused**, so an advance to a supplier,
  or money the supplier owes back, has no place yet.
- **A write-off is final.** A write-off by mistake can only be answered
  outside the app; the owner did not ask for a way back, as for a customer's
  debt.
- **An archived store's invoices stay open until another store pays them or
  the owner writes them off.** They do not keep it from the archive, as the
  owner chose.
- **A set-off of a store that does not trade cannot be cancelled** until it
  trades again: only a payment is cancelled elsewhere.

## Where an order goes — 2026-10-01

See the [report](order-shipping-report.md).

- **A waybill is not checked.** A mistyped number is saved as typed; only a
  number already on another order of the store is pointed out. Nothing asks
  the carrier whether it exists.
- **Orders made before have no destination.** They read «Доставку не
  вказано» until someone states one; a waybill cannot be written for them
  until then. Nothing fills them in on its own.
- **A correction is open to whoever works with orders**, a seller included,
  as the owner chose. Every version stays, with who made it and when.
- **The note abroad is free text.** The country is not a field of its own,
  so orders cannot be counted or found by country.
- **A collected, cancelled or returned order is closed:** where it went is
  no longer corrected, as the owner chose.

## Goods borrowed from another shop — 2026-10-01

See the [report](borrowed-goods-report.md).

- **The till does not know a borrowed jacket from the shop's own** of the
  same model and size, as the owner chose. Until someone marks it sold, the
  list shows it on hand though it is gone. Nothing reminds anyone to mark it.
- **Goods borrowed and then sent back through a plain return** to the
  supplier, not from «Позичене», still read as on hand there. Only a return
  from the list names the lot.
- **«Продано» needs the goods on hand in the list, not on the shelf.** A
  return from the list needs them on the shelf too, so a jacket sold at the
  till but not marked sold cannot be sent back: it is refused for stock.
- **Goods borrowed before receipts named a supplier** are not on the list.
  Nothing has run in production, so there are none yet.
- **The price agreed is the lot's purchase price**, the one receiving
  already kept. It is what the invoice charges; the selling price at the
  till is separate, as always.

## The sales report — 2026-10-02

See the [report](sales-report-report.md).

- **«Разом у касі» is what the till should hold, not what it holds.** The app
  does not ask cash or card, as the owner chose, so a card payment is in the
  sum too. Nothing counts the till itself. *Superseded on 2026-10-04: every
  payment now says how it was paid, «Разом» is split by way, and the drawer
  is counted once a day. See "Cash and card — 2026-10-04" below.*
- **Every figure is summed when asked for, never stored.** A year of a busy
  network is read in one request; no index was added for it. It is a read
  for the owner and managers, not the till's hot path, and has not been
  measured.
- **A sale paid in parts counts at its full price in «Продажі»**, though only
  its first payment is in the till; the rest arrives as later payments, on
  the days they are made.
- **Debt payments are not in the «Продажі й повернення» list**, as the owner
  chose its contents; their sum is in «Внески за борг».
- **A model's name is its current one** since 2026-10-03 (ADR-0008): the
  report reads `catalog.read` to count a merged model with the model that
  stays. Its figures still come from the frozen lines.
- **A day is the store's own clock.** Every store is Europe/Kyiv today; a
  network whose stores kept different clocks would add up days that do not
  quite match.

## Correcting the catalogue — 2026-10-03

See the [report](catalog-correction-report.md) and
[ADR-0008](../decisions/ADR-0008-catalog-correction.md).

- **A merge cannot be undone,** as the owner decided. A wrong one is put
  right with a new model and stock corrections; nothing in the app helps
  with that beyond the preview before it.
- **Every stock command holds its models first** (`FOR KEY SHARE`), so a
  merge, a rename or a retirement and a command on the same model run one
  after the other. A sale of a model being merged waits for the merge: a few
  milliseconds per stock key, on the till's hot path, whose release reading
  is still owed (checklist row 22).
- **A refusal that proves nothing was recorded** (`details.recorded = false`)
  settles a phone's unknown attempt. It is true because every stock command
  looks its `command_id` up before it locks stock, and every correction
  before it decides; a new command must keep that order, or a refusal would
  clear an attempt that did commit.
- **The similar-name check reads without a lock.** Two shops typing two new
  spellings of one word in the same instant both pass; a merge puts it right.
- **The check is symmetric.** Once a typo is in the catalogue and in use,
  typing the right spelling warns too, naming the typo. That is the moment to
  merge the typo away; until then the person confirms the right spelling.
- **The fold also maps b, h, m and t,** which look Cyrillic only in capitals.
  A Latin word may be warned about against a Cyrillic one it does not look
  like; it costs one confirmation.
- **A merge refuses while the duplicate has stock another store keeps** (its
  own warehouse) or in a blocked store, as the owner chose. The goods are
  moved to the shared warehouse by their store first.
- **Only someone with `catalog:merge` in every store merges.** While any
  store is blocked or archived, a manager holding it store by store cannot
  merge, even one who is a manager there too: a store that does not trade
  gives its people's grants nothing, so the right cannot be seen. The owner
  of the network, whose membership is organization-wide, still can. The
  shared price works the same way. Whether an archived store should count
  as "every store" is a question for the owner if it comes up.
- **A family a correction emptied is merged** into the family its model went
  to, so family search does not offer the typo. A family that never had a
  model is still listed, as before.
- **A rename that moves a model to another family** asks, as creating a model
  does, when a family could be the same one. Adding a source to a model whose
  family states none offers that very family as a candidate: keeping it keeps
  the name without the source, so the separate-model answer is the way to add
  it.
- **A merged model's lots stay its own.** The lot list names the duplicate;
  goods sent back from it go as the model that stays.
- **Stock left under a merged model is reported only by the restore drill**
  (`inventory.stock_under_merged_models`, beside the ledger's reconciliation).
  No screen shows it.

## One size, one spelling — 2026-10-03

See the [report](size-spelling-report.md) and
[ADR-0009](../decisions/ADR-0009-one-size-one-spelling.md).

- **Two sizes cannot be joined.** The spelling stops a second one from being
  made; nothing puts two existing ones together. The upgrade to `0032` stops,
  naming them, if a database already holds two sizes that are now one. No shop
  database exists yet, so this can only happen to a database made for a test.
- **Spaces count everywhere except around a dash or a slash.** `46 48` and
  `46-48`, or `48 (M)` and `48(M)`, are two sizes. The owner's rule spoke of a
  dash; a bracketed size has never been seen in the shops' notebooks.
- **A letter glued to digits is not spelt.** `48М` and `48M` are two sizes,
  as are `OС` (Cyrillic С) and `OS`: a letter size is spelt only when it is a
  word of its own (`48 (м)` is `48 (M)`), as the parser reads one. Whether a
  glued size is one size is a question for the owner if it comes up.
- **`1XL` is `XL`,** as the owner decided, even where a brand means a size of
  its own by it.
- **A size typed under another system silently becomes the existing one.**
  «Створити товар з опису» says so only when the spelling differs; `M` typed
  under «Інша» when the shop's `M` is a letter size shows `M (ALPHA)` without a
  word.
- **A Cyrillic word size is case-blind through the database's `lower()`.** It
  needs a database whose locale lowers Cyrillic (CI's and the server's are
  `uk-UA` ICU and `C.UTF-8`). Characters that cannot be seen (zero-width
  spaces) are not removed, as they are not in names.
- **The app's spelling is frozen into `0032`.** A test compares the two; a
  change to `spell_size` needs a new revision that respells the stored sizes.
- **A rendered (`--sql`) upgrade refuses** to run over a database holding any
  ordinary size, since sizes are respelt row by row.
- **A size system may be created with no size of its own,** when its only size
  turned out to exist under another system. Nothing reads one.
- **The notebook parser still reads only `xs s m l xl xxl` and their Cyrillic
  spellings** (`_SIZES`). It names a size nowhere a size is made, so `ххл` or
  `3XL` in a notebook line changes nothing; a broader vocabulary needs a parser
  version and the evaluation gate.

## Before the public domain — 2026-10-03

See the [report](public-hardening-report.md) and
[ADR-0010](../decisions/ADR-0010-before-the-public-domain.md).

- **A captured launch payload still mints a session within its hour** (R4).
  The app now sends it once, and a sign-out ends what it minted, but a copy
  of it used before the hour is out signs in again. Making it one-time would
  break a reload inside Telegram.
- **A sign-out does not end the lost phone's Telegram session.** Whoever
  holds the phone opens the app again through the person's Telegram until
  that session is ended (Telegram → Settings → Devices); the runbook and the
  command's own output say so.
- **Signed-in requests were not limited per person.** One seller's token
  could keep the API busy: the catalogue parser runs on the only event loop.
  Since 2026-10-03 a statement is cancelled after 30 seconds, so the
  database is not held for long. **Closed on 2026-10-10**
  ([ADR-0020](../decisions/ADR-0020-requests-per-person.md)): every
  signed-in request counts against its person, on all their phones together,
  300 at once and 300 a minute, and the five requests that parse a file or a
  catalogue line, or approve a list, 20 at once and 20 a minute besides.
  The numbers were measured as far above anyone's work. What stays:
  - a stolen token spends its person's budget, and the person is refused
    with it until it refills; `scripts.people sign-out` ends both;
  - the buckets live in the API's memory, and a restart forgets them;
  - the heavy requests are a list in the code: a new one is added there on
    purpose (`tests/unit/test_person_limit.py` names them);
  - a kept operation refused when checked stays kept, and the till blocked,
    until it is checked again.
- **The API connected to PostgreSQL as the owner of every table**, in fact
  as a superuser, the official image's `POSTGRES_USER`. **Closed on
  2026-10-09** ([ADR-0016](../decisions/ADR-0016-the-apps-database-role.md)):
  the API and `backup-watch` connect as `birka_app`, which reads and writes
  rows and may not truncate, create, or alter, drop or disable a table or a
  trigger, nor make a temporary table that a trigger would read in a real
  one's place. What stays:
  - a compromised API still reads and writes every row the app can, the
    customers' names and phones among them; it may change its own password
    and defaults until the command runs again, connect to the cluster's
    other databases, where it holds no table, and make large objects;
  - `ops` and the database's container hold the superuser's password;
  - a restore that skips `scripts.app_role` leaves the API refused: every
    request fails until it is run, and the bot says the database does not
    answer (the API's log says `InvalidPasswordError` or
    `InsufficientPrivilegeError`);
  - the trigger functions name their tables without a schema: safe while
    the role may create nothing in the app's database, which the command
    checks each time it runs.
- **Containers ran with Docker's defaults:** a writable root filesystem, the
  default capabilities, no memory limits. **Closed on 2026-10-09**
  ([ADR-0017](../decisions/ADR-0017-what-a-container-may-do.md)): every
  image is read-only, every kernel privilege is dropped but PostgreSQL's
  five for its entrypoint and Caddy's one for ports below 1024, none is
  gained by running a program, and each container has a memory limit 2.5 to
  4 times the most it reached under the heaviest work measured. What stays:
  - the volumes stay writable, as they must: the database's data, Caddy's
    certificates, the backups for `ops`;
  - Caddy and `web` run as root, without privileges; the database's
    entrypoint starts as root;
  - no process-count limit;
  - a release that needs more memory than its limit is killed at it and
    restarted: CI's `edge` job runs the stack with the limits, but not the
    heaviest work, which was measured once (the report has how).
- **The content security policy names only `frame-ancestors`.** A strict one
  needs the app opened in each Telegram client first (row 21's real device).
- **The seller's address is in the API's log now**, since the sign-in limit
  counts by it. It stays on the server, 5 × 10 MB.
- **IPv6:** the domain must have no `AAAA` record, or every IPv6 client
  shares one sign-in limit (compose gives its network no IPv6).
- **The images `node:24-alpine`, `caddy:2-alpine` and `postgres:17-alpine`
  floated**, GitHub Actions were pinned by tag, and the Python lock had no
  hashes. **Closed on 2026-10-10**
  ([ADR-0019](../decisions/ADR-0019-what-the-server-is-built-from.md)):
  every image by its digest, the multi-arch index CI ran; every action by
  commit; CI on `ubuntu-24.04` with the images' Python and Node; each
  library by the hashes of its files, installed with `--require-hashes`.
  What stays:
  - the backup image's PostgreSQL client and `age` come from apt at each
    build, the newest of PostgreSQL 17 and of Debian: the PostgreSQL
    project's repository keeps only its newest release, so a pinned one
    would stop building;
  - a pin moves only when someone moves it: a security release of an image
    reaches the server only through a change, as the runbook says ("a
    pinned version, changed on purpose"); Caddy's tag already names a newer
    build than the pinned one;
  - going back to an older commit needs Docker Hub to still serve its
    digests, which it does for official images but does not promise;
  - CI alone still takes some things fresh, none of which the server's
    image holds: `pip-audit` and its dependencies; the `setuptools` that
    builds the backend's own package for `pip install -e`; the backend
    job's PostgreSQL 17 client and `age` from apt; Playwright's Chromium and
    the system packages it asks for; and the runner image's own Docker,
    Compose and Buildx, which GitHub updates weekly.
- **The certificate warning is stored as a backup alert** (kind `FAILED`,
  key `certificate:<date>`), so «Резервні копії» may show it as the last
  message sent. The bot says nothing when the certificate is renewed, and an
  edge it cannot reach at all is only logged; both are questions for the
  owner if they come up.
- **A debt search of two characters, paged,** can list another store's
  debtors one page at a time; the owner's "never listed whole" holds only
  per page.
- **A customer's name and phone are kept on one line**: a line break or a
  run of spaces in them becomes one space.

## Failures are visible — 2026-10-03

See the [report](failures-visible-report.md) and
[ADR-0011](../decisions/ADR-0011-failures-are-visible.md).

- **Nobody hears of a server that dies whole until the outside service is
  set up**, in the owner's name, and no administrator is named yet
  (runbook, step 8a). Until then the bot tells the owner of what the
  watcher sees, and only the sellers notice a dead server. The owner
  decided on 2026-10-03 to give the rights when the app is published or
  tested, and will say when.
- **The watcher lives on the server it watches.**
  - With the database down, it tells the owners from the chats it
    remembers.
  - Restarted while the database is down, it knows only the administrators.
    Its outbox is in memory, so a restart drops a message not yet sent.
- **The sign-in alarm can still be faked** by someone who knows the Telegram
  ids of two active people of the shop and sends forged launch data in their
  names. Checking the payload's Ed25519 `signature` against Telegram's
  public key would close it. Accepted by the owner on 2026-10-03: keeping
  their phones is the people's responsibility, and the check may be
  improved later.
  - Launch data that expired or is dated in the future counts for any
    Telegram user it names, since Telegram signed it.
  - The counts live in the API's memory: one process on the server, reset
    when it restarts.
- **The disk measured is the one the watcher's containers see**: the backups
  directory and Docker's own root. Both are normally the server's main disk,
  with the database's volume; check that on the server (`df -h /`
  `/var/lib/docker`).
- **A wedged API is told, not restarted.** Docker restarts a process that
  exits; one that hangs is reported after 5 minutes, and a person restarts
  it.
- **A broken screen's note is open to anyone.** It is limited per address
  (10 a minute, 4 KB) and kept only in the log, which keeps 5 × 10 MB. A
  flood from many addresses pushes older lines out.
- **A basket still being filled is lost when a screen breaks.** Only a
  command sent without an answer is kept, and the crash screen says which.
  The owner confirmed this on 2026-10-03: the basket is emptied, and that
  is fine for now.
  - A command waiting in another store, or for another person on the same
    phone, makes the screen say a command is kept.
- **One narrow case writes an ended trouble twice** in the «Резервні копії»
  list. It takes three things together:
  - the watcher restarted while the database was down;
  - the trouble ended before the database came back;
  - the first write after that lost its confirmation.
- **Error details are in the server's log only** (owner, 2026-10-03), and
  nobody reads that log unless something is reported. Sentry is ready but
  off.
- **The new edge probes ran on a local Docker only** (2026-10-03, CI's own
  steps). That covers `/ready` through Caddy, `/internal` answered 404, the
  API's healthcheck and the release tag. The watcher's messages have not
  reached a real Telegram.

## Cash and card — 2026-10-04

See the [report](cash-and-card-report.md) and
[ADR-0012](../decisions/ADR-0012-cash-and-card.md).

- **Going back by the code alone across `0035` is not safe** once phones run
  the new version.
  - A sale recorded with a way whose answer was lost, resent to the old
    server, gets a 409 and holds the phone until the next upgrade.
  - Payments, returns and collects from a new page are refused by the old
    code.
  - What the old code records reads «не вказано» and is in no expected sum,
    so the next close shows a false surplus until each is fixed from «не
    вказано».
  - Prefer a fix forward ([server runbook](server-runbook.md#going-back)).
- **A page of the previous version left open** refuses every sale, payment,
  return and collect, with the generic text, until the app is closed and
  opened again. After this deploy, reopen it on every phone.
- **Money commands must stay at READ COMMITTED.** The drawer's stamp refuses
  to run at any other isolation, so a default changed on the role, the
  database or the server would refuse every sale rather than misplace money.
- **Two closes and two commands that touch two stores can deadlock:** a
  payment or a return taken at another store, crossing the closes of both.
  PostgreSQL aborts one; the phone keeps it as unknown, and the resend goes
  through. A change of a store's state carries the same exposure.
- **The blind count is a guarantee of the screens,** not of memory or of
  what a seller may read:
  - they can remember their own sales;
  - «Борги» shows the way of every debt payment and return, a colleague's
    included, and `GET /credits` lists a store's debts with them. Reviewed
    on 2026-10-04: as designed, and the owner is asked;
  - one sale at a time, the return screen (`GET /cash/sales/{id}/method`)
    gives the sum and the way of any sale they may return. Reviewed: as
    designed;
  - a manager can work the expected sum out from «Звіт» and the history.
- **A sale, payment or return resent after another phone's close,** its
  answer lost, lands in the next close: +X on one and −X on the next. The
  close screen asks to check other phones' unfinished operations first.
  Only a take-out is moved onto the close in between.
- **Cash taken out from a form opened before a colleague's close** goes on
  that close, as money taken before it.
  - If it was in fact taken after, that close shows an unexplained surplus
    and the next a shortage.
  - The form reads the drawer when it opens, not at the press. Reading it
    at the press would be wrong in the commoner order: paid first, recorded
    after.
  - The phone says «Записано до закриття …», so the seller can tell a
    manager.
- **A genuine take-out resent more than ten minutes after the close in
  between,** or after two closes, is refused (`CLOSE_IN_BETWEEN`). It is
  recorded again, or a manager names the close. Within those ten minutes a
  seller could still put a made-up take-out on a colleague's fresh close;
  its explanation names them and the time.
- **Card and transfer at a close cover the time since the previous close,**
  not the calendar day: after a day not closed they do not match one
  terminal slip.
- **A miscounted close is not fixed.** The next close shows the opposite
  difference, with its own reason and message.
- **A reason may never come** if the closer never opens the app again. Their
  phone waits for it, read from the server, and the bot writes without it
  after 15 minutes.
- **A difference under 1,00 грн is told to nobody** and needs no reason.
  Many of them add up only in the history.
- **The bot does not tell a close older than a day,** for instance after the
  watcher was down that long. It is in the app.
- **Count while nobody sells.** A sale made between the physical count and
  «Так, закрити» is in the expected sum but maybe not in the drawer; the form
  only reminds.
- **An order's counter money is taken at «Клієнт забрав»** (owner,
  2026-10-04). Money paid at the counter when an order is made is not
  recorded then: it would show as a surplus that day and a shortage on the
  day it is collected.
- **The carrier's cash on delivery is not checked** against what the carrier
  paid out.
- **The outbox's sending algorithm is copied** from `backups` into
  `cash.messages`. A fix to one must be made in both.
- **«Звіт» sums more groups live,** by way and with the fixes, unmeasured and
  without an index of its own.
- **A seller whose only grant is the store's own** gets a plain 403 in a
  blocked store, without `recorded: false`. Their phone shows no «Каса» there
  and does not load its journal, so it is not held.
- **Sales recorded before `0035` are in no period:** they read «не вказано»,
  are in no close, and cannot be fixed (`BEFORE_DRAWER`). Nothing is live,
  so they are test data.
- **The frontend has no unit runner.** «Каса»'s paging past 100 closes was
  checked only in a harness outside the repo, and a seller fixing their own
  collected order to an order way only by a backend test.
- **Every sale, payment and return insert runs the stamp trigger,** which
  takes the store's row `FOR KEY SHARE`. The release reading after it passed
  with about 3× headroom (checklist row 22).

## The server is unreachable — 2026-10-08

See the [report](outage-fallback-report.md) and
[ADR-0013](../decisions/ADR-0013-the-server-is-unreachable.md). The owner
decided on 2026-10-04 that the shops sell on paper and type it in later, and
on 2026-10-07 answered what that left open; on 2026-10-08, four questions
the review of the built change raised.

- **A kept operation and its paper line can both be recorded.**
  - Someone types the paper line on another phone while the first phone
    still holds the attempt. The attempt is then resent, by its button or
    by the phone itself.
  - The server tells commands apart only by `command_id`, and the two have
    different ones; it refuses only below zero. With a second unit on the
    shelf, two sales are recorded: stock −2, and the drawer expects twice
    the money counted. The same holds for a kept debt payment while
    something is still owed, and a kept return while units remain to
    return.
  - Only the paper's rule prevents it: the line is marked «у телефоні —
    <ім’я>», and nobody types it until that phone says «не записано» (owner,
    2026-10-07). The banner says the same.
  - **A lost phone found and signed in again** resends its kept attempt,
    which may duplicate the line a manager typed from paper meanwhile.
  - A lost phone's lines are checked in «Звіт» for sales and returns, and
    in «Борги» for debt payments (owner, 2026-10-08): «Звіт» shows debt
    payments only as one sum, so checking it alone could type a recorded
    payment a second time.
- **The mark is the typist's word** (G5, accepted by the owner on
  2026-10-08). Nothing checks the named seller or the paper's time against
  anything. A wrong mark, a live sale made with the switch still on, is
  permanent: the database refuses any change to it. The pay buttons read
  «З паперу · …» with the seller and the warehouse, so a forgotten switch is
  seen before the press (owner, 2026-10-07).
- **A paper sale typed without the switch** is an ordinary sale. On a
  shortfall it gets «Товар на місці», which records a found unit that was
  never there, against the owner's rule that goods gone are fixed by a
  manager first. Unticking the switch clears a basket built in paper mode,
  but a basket built without the switch from the start cannot be told from
  a live sale. The sellers' page says to switch it on always (G20, accepted
  by the owner on 2026-10-08).
- **A card charged during the outage may be charged again** by a seller who
  follows a terminal prompt. Cards are taken during an outage (owner,
  2026-10-07): a marked receipt, and a kept card operation confirmed later,
  say not to charge twice, but nothing can check it. A return typed from
  paper «На картку» still says to pay back through the terminal, since
  returns carry no mark (G2).
- **The money for a kept return may be given back twice.** The seller gives
  it back during the outage, as the sellers' page says, and the phone
  confirms the return by itself later, perhaps hours later and on another
  shift. Its «Повернення оформлено» then says, as for a card (owner,
  2026-10-08): if the money has not been given back yet, give it back; if it
  was given back while the server did not answer, not a second time.
  Nothing can check which. A transfer, which needs no customer at the
  counter, is the likeliest to go out twice.
- **A store blocked, or a warehouse closed, while a phone keeps an operation
  there holds that phone in that store** (owner, 2026-10-08: kept as a known
  risk, with no button to discard the operation).
  - Only a block or a closing that lands while the command runs reaches the
    refusal that says nothing was recorded. A resend after it is refused
    before the lookup, with no `recorded`: by the scope, rebuilt on every
    request (`STORE_NOT_TRADING`), or by the warehouse's access (`NOT_FOUND`,
    «Unknown stock location»). That refusal cannot say it, since the
    attempt may have been recorded.
  - So the phone keeps the attempt, and that store's screens on that phone
    wait, the till included, until the store trades again or the warehouse
    reopens; only an operator reopens a warehouse. Then the phone checks it
    by itself the next time the app is opened in that store, or at its
    button. Nothing is recorded twice or lost, and the phone works in other
    stores.
  - The tests of a store blocked meanwhile (`test_refusals_record_nothing.py`,
    `test_sale_refusals_record_nothing.py`) hold a scope built before the
    block, so they prove only a block that lands while the command runs.
- **A kept sale resent days later still sells** what is on the shelf then,
  dated then, under the phone's person, **without a mark** (owner,
  2026-10-07). The phone checks it by itself when the server answers and
  when the app is opened, which shortens that window; a phone nobody opens
  keeps it.
- **An outage over the close leaves a pair:** a cash sale or debt payment of
  the outage typed after that day's close is +X on that close and −X on the
  next, each with its reason; a cash return the mirror (owner, 2026-10-04).
  The close form reminds to type the paper first.
- **A refused debt payment not given back by the close** shows as a surplus,
  then as a shortage on the close after it is given back, each with its
  reason (owner, 2026-10-07).
- **A server dead whole, or a shop with no internet, means no app at all**
  until it is back (owner, 2026-10-04): the page is never cached. The shops
  sell on paper. Nothing tells the owner of a dead server until the outside
  check-in is set up ([failures are visible](#failures-are-visible--2026-10-03)).
  Nothing tells anyone of one shop's own internet, not even that check-in:
  the seller checks it and tells a manager (owner, 2026-10-08).
- **What Telegram's WebView shows during an outage, and whether it says it
  is offline, is unmeasured.** The phone's side is proven in a browser on a
  phone profile only; the drill on a real phone is in the
  [release checklist](release-checklist.md).
- **The paper's date is the phone's.** The phone builds it from its own date
  and «Це було вчора»; the server refuses only a time more than 5 minutes
  ahead of its own, or before yesterday in the store's zone. A phone whose
  date is wrong within that window gives a wrong paper time, for good.
- **An outage answers 503 and is not re-raised,** so it reaches neither
  uvicorn's traceback nor Sentry: one warning line, `request.unavailable`,
  per request, and the watcher tells of it after 5 minutes. Only the
  database not answering, or a schema the readiness check calls behind, is
  an outage; an undefined column with the schema current is a bug, and
  stays a 500 with its number.
- **The probe asks `/api/v1/ready` every 20 seconds** from each phone while
  something waits, without a token, and nothing limits it. For a shop of a
  few phones this is nothing.
- **A kept operation whose own request keeps getting no answer, while reads
  do, is resent on each answered read.** The phone takes any answer as the
  server being back, so with `/api/v1/ready` answering and, say, a sale
  that hangs, it resends that sale about every half minute. Each resend
  carries the same key, so nothing is recorded twice; the phone checks it
  "once per return of the server" only while nothing else answers.
- **Going back by the code alone across `0036`** holds one kind of phone: a
  marked sale recorded by the new code whose answer was lost, resent to the
  old code, is refused before its lookup and stays kept until the server is
  upgraded again.

## The JSON stock import — 2026-10-08

See the [report](json-stock-import-report.md) and
[ADR-0014](../decisions/ADR-0014-opening-stock-from-a-json-file.md). The
owner chose on 2026-10-08 that the shops' existing stock goes in from photos,
through a parser, as files in Birka's format, every line reviewed by a
person; the same day the owner answered the design's questions.

- **The evidence is a transcription.** A line from a file is what the
  parser wrote, kept exactly; the original is the photo, and only the shop
  keeps it. Birka cannot check the one against the other. The line's photo
  name and line number lead a person back to it, and only at the shop.
- **The parser's precision is unknown.** No real file exists yet, and no
  parser either. Its reading is shown only as a hint, and its count is taken
  only when the text says it with «шт»; but how often it misreads a line,
  a photo's name or a line's number is unmeasured.
- **Tables of numbers mean notes.** A count without «шт» is a bare number:
  the person states it with a note (owner, 2026-10-08). Notebooks kept as
  tables may have many such lines, and their review is slower for it. Not
  measured with real notebooks.
- **A size range written with a sign can pass for a split.** «42-44» read
  by the parser as size 42 with a count of 44 passes the check of a split
  the text shows (ADR-0014 §5). *Asked since 2026-10-09 (owner), widened
  after the review the same day:* the app asks what the record means when
  its size and count are both numbers and the count reads as a larger size
  after it («42-44», «42-58», «98-104»), whatever the catalogue holds, and
  when its count, or the whole record, is one of the organization's sizes
  («M-3» with a size «3»). The tap is offered only once the person chooses
  «розмір 42 — 44 шт»; the server refuses the tap without that choice
  (`SPLIT_MAY_BE_RANGE`), and, since the review's third round, without
  each record that may be a range as the answer arrives among the records
  the answer names (the ones the editor asked about), so a size created
  while the person answers is never credited to their word. It keeps the
  choice on the line and in the answer's history with exactly the records
  named, and reads every such line again at the approval, record by
  record: a size created after the answer that makes a
  record the person's word did not cover a possible range stops the
  approval, naming the line, until it is answered again («Куртка 42-44
  46-2», answered for «42-44», once a size «2» exists).
  What is left: a record of a letter size, or of a number size with a count
  no larger than it («46-2», «48-12»), is read as a size with its count
  unless the catalogue makes it a range, the person seeing the text and the
  photo's line.
- **A split «shown» by more than the parser read** *(narrowed on
  2026-10-09, review, in four rounds; not closed).* The check once took a
  split when each of the parser's sizes stood once with its count, whatever
  else the text held: «Лоран S-1 M-2 L-4» with only S and M read, «Лоран
  M-3+2», «Лоран S M-3», «S-1 M-2 L-1 разом 5» and «Лоран 46-2 48» were
  tapped on the parser's pairs. Now a count ends with its number, a sum or
  a product with any whitespace about its sign included, the sign in
  either case and ✕ ✖ ⨯ among them («M-3 + 2», «M-3X2», «M-3 Х 2» with
  no-break spaces, «M-3✕2»; third round); since the fourth round what may
  end a count is named, and any other sign before a numeral is no end, so
  signs of another width or kind, a dash with no-break spaces about it, and
  a character that prints nothing between them no longer hide a sum
  («M-3＋2», «M-3∗2», «M-3 – 2», «M-3，5», «M-3x2» with a zero-width space;
  «M-3 @1850», «M-3 #1850», «M-3 №1850» and any other sign before a
  numeral go to a note too, and so do «46-2;48-1», «M-3;2» and «M-3)2»,
  read strictly on purpose though they may be a list: «46-2; 48-1» with
  its space keeps the tap); after the fourth round, a letter that looks
  like `x` (the Greek `χ`, the Cyrillic `ҳ` `ӽ` `ӿ`, either case, or `x`
  with a mark) and a combining mark on the count or after it no longer
  hide a product either («M-3Χ2», «M-3ҳ2»); each size stands in the text once, in
  any of its spellings («M-3 М» with a Cyrillic М writes M twice); and the text holds no other size, whether the parser
  reads it or it is a letter size the parser does not know («Лоран S-1 M-2
  XXXL», «M-3 XXS», «M-3 ХL»), no other size with a count, and no number,
  of any script («½», «①»), Birka cannot account for (the file's price, a
  count with «шт», a length). Otherwise the line is answered with a note.
  What is left:
  - **a number the file calls the price is excused on the parser's word.**
    «46-2 48» with a `price` of `"48"`, «S-1 M-2 L-1 разом 5» with `"5"`,
    or «Лоран M-3 3» with `"3"` shows its split: a parser that cannot tell
    the 48 from a price may well write it as the price. Reading R-f, awaiting
    the owner: excusing the price only where the text marks it («грн»,
    «₴», «ціна») would close it, at the cost of taps;
  - a size only the organization's catalogue knows, not a letter size
    («Лоран M-3 OS», «єдиний»), and a number written as a word («і ще два»)
    or in Latin letters («III»), are not seen beside a split;
  - **a lowercase «с» is the parser's preposition,** wherever it stands.
    So «Лоран M-3 с», where the «с» may be the size S with its count lost,
    shows the split of M, as Birka's parser reads the line. A capital «С»
    is read more strictly than the parser reads it (fourth round,
    2026-10-09): it is the preposition only where it begins a phrase
    Birka's parse reads («Куртка С капюшоном M-3» keeps its tap, as
    «куртка с капюшоном M-3» does), and S anywhere else, so «Лоран С M-3»,
    «Лоран M-3 С 1850», «Лоран M-3 С без кількості» and «Куртка С поясом
    M-3» go to a note. In the third round a capital «С» with any word after
    it was the preposition, as the parser reads it, and a «С» before a
    price hid a size;
  - the conservative side: a price the file leaves out, or one the text
    writes with a gap («1 850»), and a word that spells a letter size («м»
    for metres, «л»), send a line that does show its split to a note. A
    capital «С» outside a phrase Birka reads is S, so «Куртка С поясом M-3»
    goes to a note; and a word joined by an apostrophe is one word only as
    a Ukrainian word is, a Cyrillic letter before it and «я», «ю», «є» or
    «ї» after it: «Лоран м'ята M-3» and «м’ятний» keep their tap, while
    «M-3'L», «L'S» and «XL’XXL» each write a size and go to a note (fourth
    round; the third round joined any two words at an apostrophe and hid
    those sizes). A modifier letter that writes an apostrophe or another
    sign (U+02B9 to U+02C1, U+02C6 to U+02D1, U+02EC, U+02EE; `ʼ`, U+02BC,
    among them) is a sign, not a letter, though Unicode counts it one, so
    «M-3ʼL», «LʼS», «XLʼXXL», «LʼL» and «СʼЛ» write sizes and go to a note
    too, while «Лоран мʼята M-3» keeps its tap (after the fourth round;
    before it, those were one word each and hid the sizes).
  - **Left as they are after the fourth round** (2026-10-09, the review
    rounds stopped there): an apostrophe-like letter outside that range
    (U+0374 among them, though it equals U+02B9) still joins a size to the
    word before it; an «x» look-alike outside x, х, χ, ҳ, ӽ and ӿ before a
    numeral still reads as a letter, so «M-3» beside the price may keep its
    tap; and a spacing or enclosing mark (Mc, Me) right after a count is not
    pinned by a test. A parser that writes what the notebook shows does not
    produce these; the person still taps, seeing the line and its photo.
- **The limit, and a warehouse larger than it.** A list takes at most 5 000
  answers and 5 000 lines, and a warehouse takes one list, once. The owner
  kept 5 000 on 2026-10-08: the shops first count their largest warehouse
  roughly (pages × lines per page), and above 5 000 the limit is raised by
  a separate change to the ledger before going live. The count came to
  at most 5 000 (owner, 2026-10-09), so nothing is raised before going live.
  The count is rough,
  and a notebook line may name several sizes, each its own answer, so a
  warehouse counted just under 5 000 may still not fit, unless the count
  counts each size of such a line. Raising the limit needs the ledger changed first:
  above about 6 500 answers its read of the reservations
  (`inventory.repository.reserved_quantities`) fails with "stack depth
  limit exceeded", whatever the limit is set to. 5 000 is about 23 % under
  that ceiling.
- **Measured on PostgreSQL 16 on the laptop, not on the server.** The
  approval took 7.6 s at 5 000 answers on the local 16.2 cluster, and up to
  9.5 s on 2026-10-09 with the laptop busier (every answer by size: 8.6 s).
  Measured again in the review's third round, after the re-check's text
  read stopped depending on the planner's statistics, it took up to 9.87 s
  by the 2026-10-08 method, 0.13 s under the 10 s rule, and 8.48 s by size
  (the
  [evidence](../../output/verification/2026-10-09-json-import-approval-by-size/README.md));
  the server runs 17, on hardware not yet chosen (release checklist, row
  16). Both the timing and the ledger's ceiling may differ there, and the
  room under the 10 s rule is smaller than the first figure said. The client
  waits 60 s for the approval, six times the slowest figure measured
  (9.87 s).
- **The warehouse is held for the whole review,** even for days (owner,
  2026-10-08). The shared warehouse sells only on paper meanwhile, and those
  sales are typed after the approval. Nothing reminds anyone of a list left
  waiting.
- **Two lists at once from two stores.** The app offers no second list for
  a warehouse whose list waits, but its check is not atomic: two people
  starting lists for one warehouse at the same moment from the two stores
  can make two. Only one can be approved; the other is rejected, and its
  files are added to the first, its lines answered again.
- **A shared list whose own store stops trading** *(resolved for rejection
  on 2026-10-09, owner).* The list's opening movements name the store that
  started it (ADR-0005 §4), so it is still not approved, nor changed, while
  that store is blocked or archived: through the other store the server
  says so, `LIST_STORE_NOT_TRADING`, no longer a bare 404. It is rejected
  through the other store, by its managers or the owner, which releases
  the warehouse; its files are added again to a new list started there,
  and their lines answered anew (server runbook, step 9). What is left: a
  warehouse that is also paused is not reached through the other store
  (below), so such a list waits until the warehouse reopens or the store
  trades again. *Since the review, 2026-10-09,* the same holds while that
  store may no longer receive goods into the warehouse
  (`LIST_STORE_CANNOT_RECEIVE`). The list carries no flag for it, so its
  page says so only once a command is refused, and until then still offers
  the commands.
- **A store that may sell at the shared warehouse but not receive there**
  gets `OPENING_LIST_PENDING` at its till, which points to «Початкові
  залишки», but its managers do not see the list there. In both seeds both
  stores may receive, so this bites only after an access row is changed.
- **A paused warehouse's list is seen from its own store only.** `can_receive`
  through the other store needs the warehouse open, and there it can only be
  rejected until the warehouse reopens. The owner confirmed this reading on
  a question that said the list could be changed there; it was put again as
  built and confirmed on 2026-10-09 (business rules, R-a).
- **Readings confirmed as built on 2026-10-09** (business rules, R-a to
  R-f), each a risk the owner accepted: reading 1
  put again as built; the 10 000 lines a list takes over its life, removed
  files' included; lines typed by hand removed as a file is; a file without
  the kind of its prices; the 1 000 parts — files and lines typed by hand —
  a list takes over its life, removed ones included; a number the file
  calls the price excused beside a split on the parser's word.
- **The Telegram file picker is unproven on a phone.** iOS opens Files;
  Android depends on Telegram's WebView; a file received in a chat must
  first be saved to the phone. The drill on an Android and an iPhone is
  release checklist row 26. Telegram Desktop is expected to work but has
  not been tried; the drill tries it too.
- **The slow call is proven with a browser clock, not on a phone.**
  Creating a list from a file, adding a part (a file or typed lines) and
  approving wait 60 s, and their own timeout is not taken as the server
  being down (ADR-0014 §16). Three E2E journeys hold the answer and move
  the page's clock, one with the list made only after the phone stopped
  waiting; a fourth loses the answers on their way back from the server
  itself, a gateway's 504 among them; a phone on a slow network has not
  been tried.
- **A draft whose send was lost is settled by the server's word.** After
  no answer, none in time or a gateway's 502, 503 or 504, «Новий список»
  keeps the draft's command whatever is picked, and offers no new list. A
  refusal as the same command sent before in another form settles it,
  whatever became of the list that command made (waiting, rejected,
  approved, or at another warehouse), and a list it made, opened from the
  overview, ends the draft (fourth round, 2026-10-09). In the third round
  only a waiting list found at the draft's warehouse settled it: a draft
  whose list was rejected or approved offered no new list, even after a
  reload. What is left: a draft is the phone's own, so another phone, or
  this one after its storage is cleared, knows nothing of a lost send.
- **A removed file's lines are kept as evidence,** with their text and
  parse, and count nowhere. A list holds at most 10 000 rows with them, about
  2–3 KB each, so backups grow with removed files too.
- **The catalogue screens showed raw text** unguarded; only «Початкові
  залишки» marked control, bidirectional and invisible characters. **Closed
  on 2026-10-10** ([ADR-0018](../decisions/ADR-0018-outside-text-shown-as-it-is.md)):
  every text from outside is marked on every screen, as the owner chose; a
  field opened to edit it still holds it as typed, and a new screen needs
  `visible()` of its own: nothing checks that by itself. Before:
  It marks them by Unicode's classes since the review (2026-10-09), the line
  and paragraph separators included; a variation selector right after a
  pictograph or in a keycap, and the joiner between two pictographs, are
  left as they are, so «Оля ❤️» and «👨‍👩‍👧» read as written. A selector after
  a letter or a bare digit is still marked.
- **The edge's new check.** CI's `edge` job now sends 999 000 bytes and
  expects the API's own refusal, and 1 000 001 bytes and expects 413, never
  a 502, which the phone would read as an outage. Until that job has run, in
  CI or on the local runner, the Caddyfile's limit against a real file part
  is not verified.

## Customers' data — 2026-10-09

See the [report](customer-data-retention-report.md) and
[ADR-0015](../decisions/ADR-0015-customer-data-retention.md).

- **An erased name lives on in older backups for up to 3 months,** on the
  server and on the owner's computer, which now deletes its nights older
  than that (`infra/pull-backups.sh`), keeping the newest night that can be
  restored however old. A copy the owner moved elsewhere by hand is not
  deleted. The collector deletes only when it runs: a machine that stopped
  collecting keeps what it had. A copy damaged here fails every run until
  its night's files are deleted by hand (backup runbook); old nights still
  go meanwhile.
- **A restore brings back the names erased after its night.** The term's
  erasure runs again within the hour of the watcher starting. **An erasure
  on request does not:** the owner repeats it (backup runbook, "restoring
  for real"), from the old database's audit log while it can be read, from
  memory otherwise. Nothing else records who asked.
- **A command's fingerprint is a hash of the whole command, the customer's
  name and phone among them**: `sale.command_fingerprint`, the first
  payment's, and `order_command.fingerprint`; a write-off's fingerprint
  hashes its reason the same way. It is kept so a late retry is answered
  with what was done (ADR-0003), and cannot be read back into a name or a
  reason. Someone holding the database who guesses the exact name, the
  phone or the reason, and the rest of the command, could confirm the
  guess. `idempotency_record` holds the same kind of hash for 7 days.
- **Free text is not erased,** except a write-off's reason. A name typed in a
  return's reason, a drawer's difference, a cash note or «Брак»'s notes
  stays; the hint under each asks people not to. Supplier, invoice,
  catalogue, store and stock notes have no hint. A drawer difference's
  reason also reaches the owner's Telegram chat, beyond any erasure.
- **The seller's phone keeps a command whose answer never came** — a credit
  sale, an order collected in parts, a write-off — with its name, phone or
  reason, until it is resent or resolved, as before.
- **A failing erasure is logged and sent to Sentry** when it is on, as the
  idempotency purge is; it does not reach the owner's trouble messages.
- **Three years is the owner's estimate** of how long an unpaid debt can
  still be claimed, to be checked with a lawyer by the owner.
- **One phone is one customer in the owner's erasure too.** A couple sharing
  a phone are erased together; a customer who changed number is erased only
  under the number the debt was opened with, and the owner asks again with
  the other.
- **The terms run from the debt's closing,** in UTC, to the second; a debt
  closed by a return made after it was paid off keeps its first closing.
- **The terms are constants** (`credit/erasure.py`). Changing one is the
  owner's decision and a code change; debts erased under a shorter term
  cannot come back.
- **The hourly erasure skips a debt that a return is being taken on,** and
  erases it an hour later. A watcher that is down erases nothing until it
  is back; its check-ins with the outside service stop then, and that
  service tells the owner (ADR-0011).
- **Going back by the code alone across `0038` is not safe** once a customer
  is erased, by the owner or by the hourly erasure: the old code answers 500
  for «Борги» with everyone, the list of debts and an erased debt, and
  copies a write-off's reason into the audit log again (update rehearsal,
  2026-10-09). `0038`'s downgrade refuses then too. Fix forward, or go back
  whole from the backup taken before the update
  ([server runbook](server-runbook.md#going-back)).
