# ADR-0008: Correcting the catalogue — rename, merge, retire

Status: Accepted (2026-10-03)
Owner decisions: business-rules.md, "correcting the catalogue" (2026-10-03),
with the answers asked the same day.
Amends: ADR-0001 (module boundaries, §8) and ADR-0002 (a merge is not
reversible, §10).

## Context

Nothing could correct a model once it was created. A typo made while the
shops type their stock (a Latin «a» in «Лоран», «шокалад») became a second,
permanent model: stock, prices and sales split between the two.

The owner decided four things:
- rename one model;
- merge a duplicate into the model that stays, its stock moving with it;
- retire a model and bring it back;
- warn of a similar name when a model is created.

ADR-0002 already says that a merge is explicit, needs `catalog:merge`, is
audited, writes `merged_into_id`, and never rewrites a sale (I8). It was
never built.

**"A model" is a `product_variant`:** what the till, receiving and the
reports name as one line, «концепт · позначка · колір … · N см».

A first draft of this ADR was reviewed adversarially against the code
(ledger, concurrency, the owner's rules). What it found is built in below;
the three questions it raised went to the owner.

## Decision

### 1. Who corrects, and the record

- **Rename, retire and bring back:** `catalog:merge` in the store the person
  acts in. Like creating a model, the change is seen by every store.
- **Merge, and its preview:** `catalog:merge` organization-wide, or in every
  store of the organization, paused ones included. It is the shared price's
  rule (`may_set_shared`), as the owner chose.

`catalog_correction` is append-only. Each row records:
- the kind (`RENAME`, `MERGE`, `RETIRE`, `RESTORE`);
- the model and, for a merge, the model that stays;
- the person and the store they acted in;
- the name before and after;
- for a merge, the stock that moved and the prices carried over.

Each correction is named by a permanent `command_id` (I20). The same command
is answered with what it did; another request under the same id is
`IDEMPOTENCY_CONFLICT`. Every command takes its command lock and looks its
`command_id` up before anything else, so every refusal below comes after
that lookup (§9). The audit log carries the same as the record.

### 2. Renaming one model

`POST /catalog/models/{id}/rename` states the model's whole name again:
- `concept`, `source`;
- `color`, `material`, `texture`, `fur`, `collar`;
- `length_cm`.

With it come `store_id` and `command_id`, and when they are needed:
- a new concept's category and garment type, which the app fills in from
  the current concept and shows;
- `product_family_id`, or `new_model` with a `distinction_note`;
- `similar_confirmed` (§7).

Rules:
- **A merged model is not renamed** (`MODEL_MERGED`, naming the model that
  stays). Its status is read from the statement that holds its row, so a
  rename that waited behind a merge sees it.
- **Each word is found or created** as when a model is created
  (normalized, never classified), after the similar-name check of §7.
- **The model's own row changes and keeps its id**, so its stock, prices,
  lots, reservations and history stay with it. Nothing else changes: other
  models that share a word keep it, as the owner chose.
- **A new concept or source finds its family as creation does** (ADR-0002,
  `_resolve_family`), under the same per-concept lock:
  - the candidates are that concept's families, not merged, whose source and
    garment type are the same or not stated;
  - with none, a family is created with that concept and source and the
    model's garment type;
  - with any, the rename is refused (`CATALOG_AMBIGUOUS`, listing them)
    unless the request names one of them, or says `new_model` with a
    `distinction_note`. This is creation's own answer: a family that could be
    the same is never chosen silently.
- **If the corrected name is another model's** in that family, the rename is
  refused with `SAME_AS`, naming the model it leads to (§5). The app offers
  to merge.
  - A merged model whose name it is and which leads to this very model does
    not stand in the way. The rename takes the name (§4).
  - The update runs in a savepoint. A model created with that name at the
    same moment surfaces as a unique violation, and is answered `SAME_AS`.
- **A name that changes nothing** is answered as it is, and records nothing.
- **Sale lines, order lines, supplier lines and «Брак» units keep their
  frozen names** (I8). Every live screen shows the new one.

### 3. Merging a duplicate

`POST /catalog/models/{id}/merge` with `into` (the model that stays),
`store_id` and `command_id`. A preview,
`GET /catalog/models/{id}/merge/{into}?store_id=`, shows:
- both models, with their names and prices;
- the stock that would move, by warehouse and size;
- anything that blocks the merge.

The preview runs the merge's own checks without its locks. What it allows,
the confirmation does, unless something changed in between. Quantities are
shown only in warehouses the person may read.

**Refused** (`MERGE_BLOCKED`, each reason listed with what to finish first):
- **The owner's rule: anything open of the duplicate.**
  - An order that is not closed (`READY_TO_DISPATCH`, `DISPATCHED`,
    `ARRIVED`).
  - Borrowed goods on hand: a lot paid when sold, with units still on hand.
  - A «Брак» unit not finished: in a «Брак» (`AWAITING`, `INSPECTING`,
    `CONFIRMED`), or sent back to its supplier (`SUPPLIER`), since that
    return can still be cancelled.
  - An opening list that waits: a line of a list not yet applied or
    rejected, resolved to the duplicate (`inventory_snapshot_allocation`).
- **The owner's follow-up: stock out of reach.** Stock of the duplicate in a
  warehouse where the acting store may not change stock: one it has no
  access to, or a store's own (private) warehouse without the person's own
  right granted there (`require_stock_access`). A blocked or archived acting
  store is refused, as every stock command is. Each such warehouse is named.
- **A closed warehouse** holding the duplicate's stock: nothing moves there
  (ADR-0004).
- **The model that stays is retired.** The app offers to bring it back
  first, as the owner chose.

Also refused:
- merging a model into itself, or into another organization's;
- merging a merged model, or into one (`MODEL_MERGED`).

**An order of the model that stays does not block.** Adding stock takes
nothing from what an order holds.

**Done, in one transaction, in this order:**
1. **The command lock, and the `command_id` lookup.**
2. **Both variant rows are held** `FOR UPDATE`, in id order. Their status is
   read from that statement, and every check above is made under the hold.
3. **Stock moves through `inventory.apply_catalog_merge`**, the only writer
   of the two merge reasons.
   - **The keys.** It locks the duplicate's stock keys, and the same
     warehouse and size of the model that stays, through `lock_stock` in one
     call, as the acting store.
   - **The movements.** For each key it takes `n` from the quantity read
     under that lock. It writes a pair of `ADJUSTMENT` movements in the same
     warehouse and size: `CATALOG_MERGE_OUT` −n on the duplicate,
     `CATALOG_MERGE_IN` +n on the model that stays. Both reference the
     correction (`reference_type = 'catalog_correction'`).
   - **The pairs are checked at the door,** as transfers and size
     reclassifications are: per warehouse and size one OUT and one IN, equal
     and opposite, on two different models, of the same correction.
   - **Only the merge writes these reasons.** `apply_movements` refuses them,
     as it refuses an opening balance. A database CHECK ties both reasons to
     `ADJUSTMENT` and to `reference_type = 'catalog_correction'`.
   - **The reservation guard.** The IN leg is exempt: adding stock cannot
     break a reservation. The OUT leg keeps the guard.
   - **Totals never change.** Lots stay with the duplicate as provenance.
4. **Prices.** In each scope (the organization's, and each store's) where
   the model that stays has no suggested price and the duplicate has one,
   the duplicate's is carried over, under that price's own lock. No
   `catalog:set_price` is asked: the merge right over every store covers it.
5. **The duplicate becomes `MERGED`**, with `merged_into_id` naming the model
   that stays.
   - Models already merged into the duplicate are pointed at the model that
     stays too. So `merged_into_id` always names a model that is not merged,
     in one step.
   - The database holds `merged_requires_target` on variants, as it already
     does on concepts and families.
6. **The correction is recorded, and the audit log written.**

There is no undo (§10). The preview and an explicit confirmation come first.

### 4. A merged model gives up its name

- **The unique key frees the name.** `uq_product_variant_attributes` becomes
  a partial unique index, `NULLS NOT DISTINCT … WHERE status <> 'MERGED'`. A
  merged model keeps its attributes (for its lots and its history), but no
  longer holds the name. So the model that stays may be renamed to it: if the
  owner kept the misspelled model because it holds more history, it can
  still take the right spelling.
- **Creating a merged model's name gives the model that stays.** Both doors,
  `create_product` and creating from a match decision, answer with it
  (`created = false`, `redirected_from`). This settles what `_require_active`
  left "to the command that writes merges".
- **Creating a retired model's name is refused** (`MODEL_RETIRED`, naming
  it). The app offers holders of `catalog:merge` to bring it back.
  `_require_active` names the real status instead of "merged".

### 5. The duplicate leads to the model that stays

`current_variants` gives the model that stands now. Since `merged_into_id`
always names one that is not merged, it is one step.

- **Stock commands.** `lock_stock`'s first statement holds the basket's
  variants:
  ```sql
  SELECT id, status, merged_into_id … ORDER BY id FOR KEY SHARE
  ```
  - A merged one is refused with `MODEL_MERGED`, naming the model that stays.
  - A receipt's call also refuses a retired one (`MODEL_RETIRED`).
  - A command that waited for a merge reads the merged row, so no command can
    leave stock under a merged model (§9).
- **Goods that come back.** These are resolved by
  `inventory.current_variants`, which holds the rows the same way and
  follows a merge until it holds a model that is not merged:
  - a return of an old sale;
  - a supplier return cancelled, other than a «Брак» unit's;
  - a borrowed lot sent back unsold.

  They restock as the model that stays. A return taken damaged registers its
  «Брак» unit as the model that stays. Unit, lot, return and sale rows keep
  naming what they named (frozen provenance). Refunds ask `inventory`, since
  they may not read the catalogue (ADR-0001).
- **Borrowed lots.** `lot_to_return` takes the model that stays in place of
  the lot's own, and the lot keeps naming the duplicate. The owner lets an
  invoice or a return be cancelled at any time, so a lot can reopen after the
  merge. It still goes back to the supplier.
- **«Звіт»** groups a merged model with the model that stays. Each line is
  named by the current name of the model that stays; the figures come from
  the frozen lines. The report reads `catalog.read` for this alone (contract
  amended).
- **Search.** In receiving's search, the catalogue search and the matcher, a
  match leads to the model that stays. That covers a merged model's name and
  a learned alias that names a merged model.
  - Alias rows are human evidence and are not rewritten.
  - Alias feedback counts a merged model's alias and the stays model's alias
    of the same phrase as one target. So confirming the old phrase for the
    model that stays is no conflict.
- **Family search** lists only families with a model not merged.
- **Opening lists.**
  - Resolving a line holds its variants (`FOR KEY SHARE`) and refuses merged
    and retired ones.
  - Approval holds them before the warehouse lock. It names the line whose
    model was merged or retired, so it can be resolved again.

### 6. Retiring and bringing back

`POST /catalog/models/{id}/retire` and `/restore`, with `store_id` and
`command_id`.

**`RETIRED`** is a new status of a variant:
- **not offered** in receiving's search, the catalogue search (the matcher
  included) or the opening lists' picker;
- **not received:** a receipt naming it is refused (`MODEL_RETIRED`), and so
  is an opening list's line and creating its name (§4);
- **its stock still sells, returns and is written off** (the owner). It also
  moves between warehouses and is corrected after a count (carried out: the
  goods are still there).

**Not retired while an opening list that waits names it.** That list could
then never be approved, and its warehouse would stay waiting.

**Bringing it back** makes it `ACTIVE` again.

A merged model can be neither retired nor brought back. Retire and restore
hold the variant `FOR UPDATE`, so a receipt in flight lands first or is
refused.

### 7. A similar name

A typed word is folded:
- NFKC, then casefold;
- the Latin letters that look Cyrillic, mapped to Cyrillic: a c e i o p x y k
  m t b h → а с е і о р х у к м т в н;
- ï → ї and ё → е;
- the apostrophes unified;
- whitespace collapsed.

**When it warns.** Every typed word (concept, source, each of the five terms)
is compared with the organization's words of the same kind. The request is
refused once (`CATALOG_SIMILAR`) when either:
- another spelling folds the same and is used by a model not merged; or
- the typed word itself is used only by merged models, which is the typo a
  merge left behind.

The refusal names:
- the word;
- the spelling in use;
- a few models that use it, by their current names, so the person can take
  one, as the owner asked.

**How the person answers.** They either take the existing spelling or model,
or confirm with `similar_confirmed` that it is another.

**Where it runs:** `create_product`, creating from a match decision, and a
rename's new words.

**The check reads without a lock.** Two shops typing two new spellings in
the same instant can both pass; a merge puts that right (known risk).

### 8. Module boundaries (ADR-0001 amendment)

- **Rename, retire, restore and the similar-name check live in `catalog`.**
  They are identity, and `catalog` stays a leaf.
- **The merge is a module of its own, `catalog_merge`.**
  - `catalog_merge → catalog, inventory (service), orders (models),
    suppliers (borrowed lots, returns), snapshots (models), tenancy, authz,
    audit, core`.
  - It reads what blocks a merge. It moves stock only through
    `inventory.apply_catalog_merge`.
  - Nothing imports it but the API.
  - It reads «Брак» units at a supplier through the supplier returns, never
    `damaged`.
- **`inventory` gains `apply_catalog_merge` and `current_variants`.**
- **`reports` may read `catalog.read`** for `current_variants` and the
  current names.
- **`refunds` asks `inventory.current_variants`.**
- **`suppliers` already reads the catalogue.**

### 9. Locks, and commands in flight

**One order for every command:**
1. variant rows, by id;
2. stores;
3. warehouses;
4. stock rows;
5. prices.

**How each command follows it:**
- **Stock commands:** `lock_stock`'s first statement (`FOR KEY SHARE`).
- **Merge, rename, retire, restore:** `FOR UPDATE` on their variant rows,
  first after their command lock. A rename then takes creation's
  per-concept lock.
- **`set_price`** already holds its variant before its price lock.
- **Opening-list approval** holds its variants before the warehouse's
  exclusive lock.

So a command that holds a model before a merge commits first, and the merge
then moves its stock. One that comes after waits, and is refused
`MODEL_MERGED`. No command leaves stock under a merged model.

**Retries.** Merge, rename, retire and restore are retried up to three times
on a deadlock or serialization failure, as `create_reviewed_product` is.

**Commands in flight.** Every stock command reaches `lock_stock` only after
its idempotency claim and its `command_id` lookup. So `MODEL_MERGED` and
`MODEL_RETIRED` there prove the command recorded nothing. They carry
`details.recorded = false`, and every journal treats such a refusal as final,
even after an attempt whose outcome was unknown: the attempt is cleared and
the basket handed back. A seller whose phone sent a sale of the duplicate
just before a merge is not left blocked.

**Reconciliation** reports any stock or reservation under a merged model.

### 10. Amendment to ADR-0002

ADR-0002 called a merge "reversible via `merged_into_id`" and counted that
as a mitigation for I14. On the owner's decision of 2026-10-03 **a merge
cannot be undone**. The mitigation is now the preview and an explicit
confirmation. A wrong merge is put right with a new model and stock
corrections. ADR-0002, the I14 row and the `EntityStatus` docstring say so.

### 11. Migration `0031`

- **Enums:** `catalog_entity_status` gains `RETIRED`; `movement_reason`
  gains `CATALOG_MERGE_OUT` and `CATALOG_MERGE_IN`.
- **New table:** `catalog_correction`.
- **On `product_variant`:**
  - `merged_requires_target` is added;
  - `uq_product_variant_attributes` becomes the partial unique index of §4.
- **On `stock_movement`:** a CHECK that a merge reason is an `ADJUSTMENT`
  referencing `catalog_correction`. It compares `reason_code::text`, because
  a new enum value cannot be used in the transaction that adds it.

**The downgrade** refuses while any of these exist:
- a variant that is `RETIRED` or `MERGED`;
- a merge movement;
- a recorded correction.

Otherwise it restores the unique constraint, and rebuilds both enum types
without the new values. That means dropping and restoring the defaults and
CHECKs that name a status.

## Consequences

- **Every correction bumps the catalogue's knowledge revision**, so open
  match proposals must be sent again. This is by design: the knowledge they
  were computed on changed.
- **A merge holds both models while it runs.** A sale of either waits for it:
  a few milliseconds per stock key.
- **Lots stay with the duplicate.** A borrowed lot fully settled before the
  merge keeps its history there.
- **No undo:** a wrong merge is put right with a new model and stock
  corrections, as the owner decided.
- **Two new spellings typed in the same instant** can both pass the
  similar-name check.

## Alternatives considered

- **Repointing history rows to the model that stays.** It would rewrite sale
  lines, ledger rows and lots, against I8 and the append-only ledger.
- **Moving stock by updating `inventory` rows.** Reconciliation against the
  ledger would then fail. Paired movements keep both in step.
- **A rename that changes the shared word for every model.** The owner chose
  one model.
- **Redirecting every movement at the ledger door.** Callers read stock by the
  key they hold, so it would silently diverge. Refusing under a merged model,
  and asking the callers that put goods back to use the model that stays, is
  explicit.
- **Reading status in `lock_stock` without a lock.** A command that read it
  before a merge committed would write afterwards under the merged model, and
  nothing could move those units again.
- **Holding the variant rows `FOR UPDATE` after the stock rows.** Every
  command takes the variant last, through its foreign keys, so the merge
  would deadlock with an ordinary sale.
- **Refusing a merge while the model that stays has an open order.** The
  owner did not make that rule, and nothing needs it.
- **Re-targeting learned aliases to the model that stays.** They are
  append-only human evidence. Reading them through the merge keeps them
  whole.
