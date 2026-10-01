# Returns at another store — 2026-10-01

Baseline: `f349b00` (the credit screens, merged as PR #55).
Status: implemented and verified locally. Migration `0024`.
Branch: `feat/returns-elsewhere`.

## Why this was next

The owner chose it after the credit screens. Until now a return could be
taken only at the store that made the sale (business-rules.md, "returns at
the till"). Owner-decisions-2026-09-15.md §1 left open:
- who may take back goods the other store sold;
- where they go;
- which store handles the money.

The owner answered on 2026-10-01 (business-rules.md, "returns at another
store").

## What exists now

**«Повернення» → «Де купили: В іншому магазині мережі».**
- **Finding the sale.** The seller types the goods' name and finds the sale
  among the other stores' sales.
  - The card says which store sold it.
  - Nothing is listed until something is searched, and the server refuses a
    search shorter than two letters.
  - Only whoever takes returns here may search.
- **Taking it back.** The form works as for the store's own sales.
  - It says the goods were bought at the other store, that this store hands
    the money back, and that damaged goods stay in this store's «Брак».
  - The answer says the same.
- **Where intact goods go.** Back to the warehouse they were sold from: both
  stores share it, so it is reached from either.
  - **Not reached:** the other store's own warehouse is not reachable from
    here. The line then offers this store's own warehouses to choose from,
    never its «Брак». Nothing is sent until one is chosen.
- **Damaged goods** go to this store's «Брак», where they were handed back.
- **A sale paid in parts** comes back by the same rules. The debt is lowered
  first and stays the selling store's. Any cash back is handed over here.

**In «Брак»,** a unit sold from a warehouse this store does not reach goes
back on sale, after inspection, in one of this store's warehouses the
person chooses. Before, such a unit could only ever be confirmed damaged.

**On the server:**
- **The request.** `POST /sales/{id}/refunds` takes `store_id`, the store
  taking the goods back.
  - That store's own `sale:refund` decides, never the selling store's.
  - It must be a store of the network that is trading.
  - Each intact line takes `location_id` only when that store does not
    reach the warehouse the goods were sold from. It must then be one of
    that store's warehouses that receive, never a «Брак». Anything else is
    refused with a reason: `CHOOSE_A_WAREHOUSE`,
    `NOT_A_WAREHOUSE_OF_THIS_STORE` or `SOLD_FROM`.
  - A request that uses neither field is fingerprinted as before.
- **The record (migration `0024`).** `refund.taken_at_store_id` is the store
  that took the goods back and paid. `store_id` stays the store that sold.
  - Existing rows take the store that sold, which is where they were taken.
  - The downgrade refuses while any return was taken elsewhere.
- **The ledger.** The return's stock movements name the store taking the
  goods back as the one acting. The damaged units are that store's.
- **Replays.** A return replays for whoever may take returns at the store
  that took it. The same command named at another store is another
  operation (409).
- **The sales list.**
  - `GET /sales?elsewhere=true&q=…` searches the other stores' sales.
  - Every sale says which store sold it.
  - Every line says whether intact goods taken back here go where they were
    sold from (`back_to_sold_from`).
- **«Брак».** `GET /damaged-units` says the same per unit, and
  `return-to-sale` accepts a warehouse of the store's own in that case only.

## Evidence

- **Backend: 1170 passed, 1 skipped** (the `age` test, run by CI). 8 tests
  are new, in `test_returns_elsewhere.py`:
  - another store's sale is found only by a search, never among one's own;
  - only whoever takes returns searches;
  - goods bought at one store come back at another:
    - intact to the shared warehouse, damaged to the other's «Брак»;
    - the store that paid is recorded, and its stock movements name it;
  - the other store's own warehouse is not reached:
    - nothing chosen, another store's warehouse or a «Брак» are each refused
      with their reason;
    - a chosen warehouse is used;
    - a store's own sale still takes no choice;
  - a choice is only for intact goods;
  - the taking store's own authority decides:
    - not the selling store's, and not one of another network;
    - a replay works, and a revoked grant gets no cached answer;
    - another store with the same command is refused;
  - a sale paid in parts comes back elsewhere by the same rules, its debt
    staying the selling store's;
  - a unit handed back elsewhere goes back on sale in a warehouse of that
    store, never another store's own or a «Брак»;
  - the migration's downgrade refuses while a return was taken elsewhere,
    and round-trips while none was.
- **One older test changed by design.** `store_id` in a refund request was
  refused as an unsupported field. It is now the store taking the goods
  back, as the owner decided.
- **E2E: 104 passed** on a fresh database against the real API. 5 are new,
  in `returns-elsewhere.spec.ts`:
  - **A coat bought at «Другий» comes back at «Основний».**
    - Nothing is asked of the server before a search.
    - The card names the store, and the answer says who pays.
    - The body names the store taking the goods back.
    - The stock and «Брак» move.
  - **Sold from «Другий»'s own warehouse.** The seller must choose, «Брак»
    and the other store's warehouse are never offered, and the choice is sent
    and used.
  - **«Брак»** puts such a unit back on sale where chosen.
  - **A lost answer** is resent unchanged, store included, and the settled
    notice says who pays.
  - **A store's own sale** is returned as before, with no store in the body.
- **The E2E seed** gained a second store, «Другий». It has its own
  warehouse and sells from the returns warehouse too.
  - «Оля» holds the role in both stores, as she held it in every store
    before. The shared price needs `catalog:set_price` in every store, and
    two price journeys failed until she did.
- **Gates:**
  - ruff, format and mypy are clean.
  - All 20 import contracts are kept.
  - `alembic check` is clean.
  - Frontend lint, types and build pass, and prettier is clean on every
    changed file.

**Mutation testing — 26 mutants, all caught (backend 15, frontend 11).**
- **Backend:**
  - the selling store's authority deciding;
  - damaged goods going to the selling store's «Брак»;
  - the selling store recorded as paying out;
  - the selling store moving the goods;
  - no warehouse needing to be chosen;
  - any warehouse allowed as a choice;
  - a store's own sale taking a choice;
  - a foreign or closed store taking goods back;
  - another store with the same command treated as a replay;
  - own sales listed among the others';
  - the others' browsed without a search;
  - the others' searched without `sale:refund`;
  - every line said to go back where it was sold;
  - «Брак» putting a unit anywhere;
  - «Брак» saying every unit goes back where it was sold.
- **Frontend:**
  - the store taking the goods back not sent;
  - a return elsewhere not marked so in the journal;
  - the other stores browsed without a search;
  - the other stores never searched;
  - no warehouse needing to be chosen;
  - the chosen warehouse not sent;
  - «Брак» offered as a choice;
  - who pays not said;
  - the selling store not named;
  - «Брак»: the choice ignored;
  - «Брак»: no choice offered.

## Found on the way

- **A test checked an absence before there was anything to be absent.** The
  journey checked that «Брак» was not offered before this store's warehouses
  had loaded, so it always passed. Mutation testing found it: «Брак» offered
  as a choice survived. The journey now waits for the warehouses first.

## Not covered here

- **Nothing settles money between stores.** Each return records which store
  paid, but nothing adds up what one store paid for another's sales.
- **A closed store** keeps its old rule for its own sales: it may refund
  without restocking. It takes nothing back for another store.
- **Store states** (blocked, archived) are still undecided, as are
  supplier returns and purchase installments.
- **Nothing has run in production.**

## Changed files

- New:
  - `backend/migrations/versions/0024_returns_elsewhere.py`;
  - `backend/tests/integration/test_returns_elsewhere.py`;
  - `frontend/src/returns/places.ts`;
  - `frontend/e2e/returns-elsewhere.spec.ts`.
- Backend:
  - `app/modules/refunds/models.py` and `service.py` — the taking store, the
    choice, the destinations;
  - `app/api/v1/refunds.py` — `store_id`, `location_id`,
    `taken_at_store_id`;
  - `app/modules/sales/read.py`, `app/api/v1/sales.py` — `elsewhere`, the
    selling store, `back_to_sold_from`;
  - `app/modules/damaged/service.py`, `app/api/v1/damaged.py` — a choice
    after inspection;
  - `app/modules/tenancy/service.py` — `back_on_sale_locations`,
    `store_names`;
  - `scripts/seed_orders_e2e.py` — «Другий».
- Tests:
  - the frozen migration digests;
  - `test_till_returns.py` — a raw insert names the new column;
  - `test_refund_command.py` — `store_id` is no longer an unknown field.
- Frontend:
  - `src/returns/Returns.tsx`, `types.ts`, `commands.ts`;
  - `src/damaged/Damaged.tsx`, `types.ts`.
- Docs:
  - business rules;
  - the release checklist;
  - the risk register;
  - the milestone;
  - the README.
