# The suggested selling price (M1-028, Q-F) — 2026-10-01

Baseline: `465ce22` — «Брак», merged as PR #46
([report](damaged-inspection-report.md)).
Status: implemented and verified locally. Migration `0021`, the permission
`catalog:set_price`, and `GET/POST /api/v1/catalog/prices`.
Branch: `feat/m1-028-suggested-price`.

## Why this was next

`taps-to-sale ≤ 5` was the release gate's one failing budget: 6 taps plus
typing a price on every sale. `variant_price` existed since `0002` for exactly
this, shared or per store. Nothing wrote it, because nobody had said who may
(owner question Q-F). See the [hot path report](hot-path-budget-report.md).

## The owner's decisions (2026-10-01)

Asked, not guessed; recorded in business-rules.md, "suggested selling price".

- **The owner and managers set it; a seller sees it.** The final price is
  still agreed at the counter (2026-09-15).
- **One price for the whole shop, which a store may override with its own.**
- **It is set where goods arrive and on the stock screen.** One price per
  model and colour, for every size.

The owner answered Q-G at the same time: a line with nothing on the shelf is
dropped and the shortage recorded. That is the next branch, not this one.

## What exists now

**The price** (`catalog/prices.py`):
- **The till suggests the store's own price, else the shared one.**
  `stock-options` carries it as `suggested_price`.
- **A store's own price takes `catalog:set_price` in that store.** This is
  the scope rule every command follows (I12/I13): a manager who belongs to
  one store changes that store's till, and no other.
- **The shared price takes the permission over every till.** It may be held
  organization-wide, or in every store of the organization, paused ones
  included. The owner confirmed this, with a case in mind: a child store's
  owner may also manage the main store.
  - Only the server knows all the stores, so the price read answers
    `may_set_shared` and the app offers the choice from that.
- **Nobody overwrites a price they have not seen.**
  - A change states the price the screen showed (`expected_price`). If that
    no longer stands, the change is refused with the one that does
    (`PRICE_CHANGED`).
  - If the price already is what was asked, the change is answered as done.
    So a retry after a lost answer is safe without an idempotency key.
  - Two changes to one price take an advisory lock, so they are decided one
    after the other.
- **A price is more than nothing, to the kopeck.** "No price" is null. A till
  prefilled with 0 would sell a coat free.
- **The model must be the organization's own, and not merged away.** A model
  parked in review may be priced: it is the coat in someone's hands.
- **Every change is audited**, with the price before and after. A retry that
  changes nothing writes nothing.
- **A price never changes a sale.** The sale freezes the price it was sold at
  (I8).

**Who holds it:** `catalog:set_price` is in the manager's default role, and so
in the owner's. `0021` grants it to every role that holds `inventory:adjust`,
whatever the role is called.

**The app:**
- **The till prefills the price** when a model is picked, and says it is the
  suggested one, which the seller may change. A model with no price leaves the
  field empty, never the previous model's.
- **Receiving shows the model's price** beside the purchase cost, and lets
  whoever may set it change it. It is saved at once, on its own: it belongs to
  the model, not to that delivery.
- **The stock screen shows each model's price**, with «Змінити ціну
  продажу» for whoever may set it. «Брак» shows none: nothing there is for
  sale.
- **Whoever may set the shared price chooses** it or this store's own.
  Anyone else sets this store's own and is told so. Removing a store's own
  price brings the shared one back.

## Evidence

- **Backend: 1097 passed, 1 skipped** (the `age` test, run by CI). 17 are
  new: 15 for the price, 1 for the permission, and 1 freezing `0020`.
  - **The price's own tests:**
    - the store's price reaches its own till, and no other store's;
    - the shared price is refused to a manager of one store, and reaches
      every till;
    - whoever holds the price in every store sets the shared one. Holding it
      in some stores does not count, and a paused store counts as a store;
    - a store's own price overrides the shared one until it is removed;
    - a seller sees the price but does not set it;
    - nobody overwrites a price they have not seen, a retry is answered as
      done, and only real changes are audited;
    - two changes at once: one holds its transaction open and the other
      waits, then is refused with what the first left;
    - prices of 0, below 0, below a kopeck or too large are refused, and so
      are fields nobody asked for;
    - another organization's model, or a merged one, is not priced;
    - the migration's grant, and its removal on downgrade.
- **E2E: 78 passed against the real API**, 5 of them new:
  - a store's price, set on the stock screen, is what its till prefills and
    sells at, with nothing typed;
  - the owner sets the shared price while receiving, and the store's own
    overrides it until removed;
  - a price someone else changed meanwhile is not overwritten unseen;
  - whoever may set only this store's price is told so, and sets that;
  - whoever does not set prices sees them and is offered no change.

  The «Брак» stock test now also checks that «Брак» shows no price.
- **Gates:** ruff, format, mypy and all 19 import contracts are clean.
  `alembic check` reports no drift. The downgrade to base and back up is
  lossless on a fresh database. Frontend lint, types and build pass.

**Mutation testing: 27 tried, 26 caught (backend 18, frontend 8).**
- Caught:
  - either permission check, and the manager's default;
  - the shared price allowed from some stores, or with paused stores left
    out;
  - the stale-price refusal, and the retry answered as done;
  - the shared price beating the store's own;
  - the till not told the price, or not shown the store's own;
  - a merged model priced, and removal keeping the row;
  - the audit forgetting the price before;
  - a price of zero, and fields nobody asked for;
  - reading a price from another store;
  - the migration's grant;
  - the lock removed;
  - in the app:
    - the till keeping the previous model's price, or prefilling none;
    - the editor offered to anyone;
    - the shared price offered whatever the server says;
    - «Брак» showing a price;
    - a change stated against the wrong price;
    - the owner starting at the store's own price;
    - receiving showing no price.
- **One survivor, which changes no behaviour.** Fetching other stores' price
  rows too: the store's own price is picked by its id regardless.
- **The first concurrency test let the lock's removal survive**, because the
  two requests did not overlap. It now holds one change's transaction open,
  and the mutation is caught three runs out of three.

## Not verified here

- **Nothing has run in production.** The backups are still not set up on a
  server either.
- **`taps-to-sale` is met only for priced models.** A model nobody has priced
  is still typed.
- **PostgreSQL 17 was not re-run locally.** CI runs every test on it.

## Changed files

- New:
  - migration `0021_suggested_price.py`;
  - `app/modules/catalog/prices.py`;
  - `tests/integration/test_suggested_price.py`.
- `api/v1/catalog.py` — `GET/POST /catalog/prices`, and `suggested_price` on
  `stock-options`.
- `authz/permissions.py` — `catalog:set_price`, in the manager's default.
- `core/errors.py` — `PRICE_CHANGED`.
- Tests: `test_authz.py`, and the frozen migrations list.
- Frontend:
  - new: `src/prices/` and `e2e/price.spec.ts`;
  - changed: `Sale.tsx`, `Receive.tsx`, `Stock.tsx`, `App.tsx`,
    `orders/types.ts` and `e2e/damaged.spec.ts`.
- Docs:
  - business rules (Q-F and Q-G);
  - the risk register;
  - the hot path report;
  - the milestone.
