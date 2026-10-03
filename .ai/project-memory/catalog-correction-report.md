# Correcting the catalogue — 2026-10-03

Baseline: `7149eb0` (the first days, merged as PR #63).
Status: implemented and verified locally. Migration `0031`.
Branch: `feat/catalog-correction`.
Design: [ADR-0008](../decisions/ADR-0008-catalog-correction.md).

## Why this was next

Asked what came next, the owner chose correcting the catalogue. Nothing could
correct a model once it was created. A typo made while the shops type their
stock (a Latin «a» in «Лоран») became a second, permanent model, and its stock,
prices and sales split between the two.

The owner decided on 2026-10-03 (business-rules.md, "correcting the
catalogue"):
- **four things:** rename a model; merge a duplicate into the model that
  stays; retire a model and bring it back; warn of a similar name at
  creation;
- **the owner and managers** correct it (`catalog:merge`);
- **a rename corrects one model**, everything in its name; a name another
  model has offers a merge;
- **a merge moves the duplicate's stock** to the model that stays, in the
  ledger, nothing added or lost. The price of the model that stays is kept,
  and the duplicate's taken where it has none. It cannot be undone, is
  confirmed first, and waits while anything of the duplicate is open.
  Afterwards the duplicate leads to the model that stays everywhere;
- **a retired model** is no longer offered or received; its stock still
  sells; it can be brought back;
- **a similar name** is warned about once; confirmed, it is still created.

A review of the first design against the code found 38 problems
(concurrency, the ledger, the owner's rules). The design was revised, and
three questions went to the owner, who answered the same day:
- **only a person with the right in every store merges;**
- **a merge does not reach into another store's own warehouse or a blocked
  one,** and shows where;
- **nothing is merged into a retired model.**

## What exists now

**In the app, «Моделі»** (the owner and managers):
- **Finding a model** by its words, retired ones too. A merged model's name
  finds the model that stays.
- **Renaming.** The model's whole name is stated again, prefilled. A similar
  word is warned about: take the spelling in use, or keep it. A name another
  model has offers the merge.
- **Merging.** Choose the model that stays. The preview shows both models
  with their prices, the stock that would move by warehouse and size, and
  what stops it. «Поміняти місцями» swaps them. The merge needs a tick,
  «Розумію: об’єднання не можна скасувати», and then «Об’єднати».
- **Retiring and bringing back.**
- **The tab** shows for `catalog:merge` in the store. The merge button shows
  only with that right in every store.

**At creation** («Каталог» → «Створити товар з опису»), a similar word is
warned about: «Взяти «…»» or «Це інша назва — створити як є».

**A phone that sent a command just before a merge** is not left blocked. If
its answer was lost and the model was merged or retired meanwhile, asking
again is refused with proof that nothing was recorded. The till, «Приймання»
and every journal clear it and say why.

**On the server:**
- **The ledger's door.** Every stock command holds its models first
  (`FOR KEY SHARE`). So a merge, a rename or a retirement and a command on
  the same model run one after the other. A command that waited for a merge
  is refused `MODEL_MERGED`, and nothing can leave stock under a merged
  model.
- **The merge** (`catalog_correction`, a module of its own):
  - holds both models `FOR UPDATE`;
  - checks every blocker under the hold;
  - moves stock only through `inventory.apply_catalog_merge`, the one writer
    of `CATALOG_MERGE_OUT`/`IN`, checked pair by pair at the door and by a
    database CHECK;
  - carries prices scope by scope;
  - marks the duplicate merged, pointing models merged into it at the model
    that stays;
  - merges a family it emptied.
- **Blockers** (`MERGE_BLOCKED`):
  - an open order of the duplicate;
  - borrowed goods on hand;
  - stock in «Брак»;
  - an opening list that waits;
  - stock in a closed warehouse, or out of the acting store's reach;
  - a retired model that stays.

  An open order of the model that stays does not block: the IN leg is exempt
  from the reservation guard.
- **What comes back later goes to the model that stays:**
  - a return of an old sale;
  - a supplier return cancelled;
  - a borrowed lot sent back;
  - every «Брак» step.

  The rows keep the name they froze.
- **«Звіт»** counts a merged model with the model that stays, named as it is
  now.
- **Search, the matcher and alias feedback** lead a merged model's name to
  the model that stays. Retired models are not offered.
- **Rename** finds a new family as creation does. The model's own family is
  no candidate, so a source added is never dropped. A name another model has
  is `SAME_AS`; a duplicate merged into this model does not stand in the way.
- **Creating a merged model's exact name** answers with the model that stays
  (`redirected_from`), in its family or in a family the merge emptied.
- **Similar names:**
  - folded with NFKC, the Latin letters that look Cyrillic, ï, ё and the
    apostrophes;
  - compared with every typed word of the same kind;
  - a typo a merge left is warned too;
  - a rename's own typo is not.
- **`catalog_correction`** records each correction once under its
  `command_id`, with the answer it gave, and the database refuses to change
  it. The audit log carries the same.
- **The restore drill** reports any stock left under a merged model.

**Migration `0031`:**
- adds `RETIRED` and the two merge reasons;
- creates `catalog_correction`, append-only;
- adds `merged_requires_target` on variants;
- makes the name key partial (merged models give up their name);
- adds the merge reasons' CHECK.

Its downgrade refuses while a model is retired, a merge is in the ledger or a
correction is recorded. The `0030` digest is frozen.

**Docs:**
- ADR-0008;
- ADR-0002 amended (a merge cannot be undone);
- ADR-0001 amended (29 contracts);
- business rules (the owner's answers and what was carried out);
- the risk register;
- the README;
- the release checklist.

## Evidence

**Backend: 1364 passed, 1 skipped** (the `age` test, which CI runs); 1230
before.
- **New test files (4).** The catalogue tests were written by four agents in
  parallel, each against the owner's rules and ADR-0008, then reviewed:
  - `test_catalog_merge.py`: the merge, prices, the preview, every blocker,
    authority, command identity, chains, families;
  - `test_catalog_merge_after.py`: everything after a merge, and the races
    the review found, with real row locks;
  - `test_catalog_rename.py`: rename, the family rule, the similar-name
    warning, the fold;
  - `test_catalog_retire.py`: retire and restore, the ledger door, the
    partial key, migration `0031`.
- **Changed by design (2):**
  - **receiving's search:** a merged model's name finds the model that stays
    (the old test said it was gone);
  - **a price test:** a merged model now needs the model it was merged into.
- **The restore drill** has a test for stock left under a merged model.

**Defects the tests found, fixed before this report:**
- a revoked grant replayed a stored correction;
- a rename was warned about the typo it fixed;
- a family named in a rename was not checked to be one the name could be,
  and a source added could be dropped;
- an exact merged name in a merged family was created again;
- the catalogue's journal refused to keep `similar_confirmed`.

**Gates:**
- ruff, format and mypy are clean;
- 29 import contracts are kept;
- `alembic check` is clean;
- migrations round-trip on an empty database.

**E2E: 134 → 145, all passing on a fresh database.** `e2e/models.spec.ts`
(11 journeys) covers:
- a merge after a preview, with a lost answer resolved once;
- no merge into a retired model;
- the rename warning, taken and kept;
- retire and restore;
- the till and «Приймання» clearing a lost attempt whose model was merged or
  retired meanwhile;
- the creation warning, taken and kept;
- who sees the tab and the merge.

**Mutation testing: 61 mutants, all caught (backend 44, frontend 17).** Six
backend mutants survived the first run. Each one showed a gap, and each gap
now has a test:
- a mutant whose text no longer matched;
- the exact merged name in a merged family;
- the matcher and a retired model;
- the matcher and an exact old name;
- alias feedback across a merge;
- a migration test that matched the SQL text instead of the raised error.

What the mutants cover:
- **Backend:**
  - the door: the model held first, merged and retired refused, the merge's
    reasons only from the merge, pairs equal, the IN leg's reservations;
  - prices kept;
  - every blocker, and who may merge;
  - the preview's hidden quantities;
  - pointing merged models at the one that stays;
  - rename: merged, `SAME_AS`, its own typo;
  - emptied families;
  - the similar-name warning, and a word a merge left;
  - creating a merged name, in its family or a merged one;
  - returns, «Брак», supplier returns and borrowed lots going to the model
    that stays;
  - «Звіт»'s grouping and names;
  - search and the matcher;
  - alias feedback;
  - the line named at approval;
  - the right before a replay;
  - the proof that nothing was recorded;
  - the downgrade's refusal;
  - the append-only record;
  - the restore drill.
- **Frontend:**
  - the proven refusal in the shared journal and the till;
  - the settled sale and delivery saying why;
  - taking a spelling, and keeping a word, in a rename and at creation;
  - the catalogue journal keeping the confirmation;
  - the merge's confirmation and blockers;
  - who is offered the merge and the tab;
  - the card after a merge;
  - retired models marked;
  - the preview's quantities.

Each frontend mutant ran on a freshly seeded database.

## Not covered here

- **A merge cannot be undone.** Nothing helps beyond the preview.
- **The check for similar names reads without a lock.** Two new spellings
  typed in the same instant both pass.
- **Once a typo is in use, typing the right spelling warns too.** Merge the
  typo away.
- **A sale of a model being merged waits for the merge.** The hot path's
  release reading (checklist row 22) is still owed.
- **Nothing has run in production.**

## Changed files

- New:
  - `backend/migrations/versions/0031_catalog_correction.py`;
  - `backend/app/modules/catalog_correction/`;
  - `backend/app/modules/catalog/corrections.py`, `similar.py`;
  - `backend/app/api/v1/catalog_corrections.py`;
  - `frontend/src/catalog/Models.tsx`, `modelCommands.ts`, `modelTypes.ts`,
    `Similar.tsx`;
  - `frontend/e2e/models.spec.ts`.
- Backend:
  - `inventory/service.py`, `models.py`: the door, the merge entry point;
  - `catalog/`: models, validation, service, read, search, matching,
    feedback, prices;
  - `refunds`, `suppliers`, `damaged`, `reports`, `snapshots`: the model
    that stays;
  - `core/errors.py`: the new refusals;
  - `scripts/restore_drill.py`.
- Frontend:
  - `App.tsx`: the tab, and the settled refusals;
  - `shared/api.ts`, `shared/journal.ts`, `sales/commands.ts`,
    `orders/commands.ts`: the proven refusal;
  - `catalog/CreateProduct.tsx`, `Catalog.tsx`, `commands.ts`, `types.ts`.
- Docs: ADR-0008, ADR-0002, ADR-0001, business rules, the risk register,
  the README and the release checklist.
