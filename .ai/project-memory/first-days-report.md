# The first days: a warehouse waits for its list — 2026-10-02

Baseline: `a834dba` (the sales report, merged as PR #62).
Status: implemented and verified locally. Migration `0030`.
Branch: `feat/first-days`.

## Why this was next

Asked what was left, the agent found that the server runbook's step 9 told
the owner to receive the first real delivery right after install. A
warehouse takes an opening balance only while nothing has been recorded
there (ADR-0005 §5), so that delivery would have shut the shops' existing
stock out of the shared warehouse for good.

The owner had the docs fixed, then answered on 2026-10-02 (business-rules.md,
"the first days"):
- **whoever enters the goods keeps the order:** the opening lists are
  approved first, then new deliveries are received;
- **goods found later go in through «Приймання»**, with their size;
- **these steps should be simple in the app.** Asked how, the owner chose
  that **the warehouse waits while its list does**.

## What exists now

**The documents.**
- **Server runbook, step 9,** is the cutover:
  1. ask the owner which way in;
  2. with lists: the count, the catalogue, one list per warehouse within its
     limits, the owner's approval (a child store's own warehouse: its own
     roles), the paper sales after it;
  3. only then deliveries and sales.

  The old check is step 10.
- **The release checklist** is re-assessed at `a834dba`:
  - the flows of PRs #52–#62;
  - 133 journeys;
  - row 22: the hot path's release reading is still owed.
- **The README** no longer says existing stock has no way in.

**In the app.**
- **«Початкові залишки»** says, on a list that waits: «Поки список чекає
  рішення, на складі «…», де ще не було руху товару, нічого не приймають, не
  продають і не виправляють. Затвердіть або відхиліть його.»
- **«Приймання», the till and the corrections** are refused there with:
  «На цьому складі чекає список початкових залишків. Спершу затвердіть або
  відхиліть його в «Початкових залишках».»

**On the server.**
- **`opening_list_hold`**, a table of module `inventory`, holds one row per
  list that waits, naming its warehouse.
  - **A list takes its hold** when it is kept, under the warehouse's
    advisory lock, exclusively.
  - **It lets go** when it is approved (`apply_opening_balance`) or
    rejected.
- **The ledger door** (`_apply_movements`) refuses every movement but the
  opening balance with `409 OPENING_LIST_PENDING` (`details.location_ids`)
  in a warehouse that a list holds and that has no stock history.
- **A list for a warehouse that already has history holds nothing back.** It
  can never be approved, and a mistake must not stop a trading warehouse.
- **Module boundaries hold:** `inventory` reads only its own table, and
  `snapshots` writes it through `inventory.service`. ADR-0005 §12.
- **Migration `0030`:**
  - creates the table;
  - holds the lists already waiting;
  - its downgrade drops it and loses nothing.

  The `0029` digest is frozen.

## Evidence

- **Backend: 1230 passed, 1 skipped** (the `age` test, run by CI).
- **New tests (6),** in `test_snapshot_import.py`:
  - **nothing moves while a list waits:** a receipt and a stocktake
    correction are refused, naming the warehouse; another warehouse goes on;
    once approved, the warehouse takes a receipt and the hold is gone;
  - **a rejected list lets its warehouse go;**
  - **a warehouse waits until its last list is decided;**
  - **a list for a warehouse with history holds nothing back;**
  - **a receipt while a list is being kept** waits for it, then is refused;
  - **the migration** holds the list already waiting, not the rejected one,
    and round-trips.
- **Changed by design (3):** the history guard at approval is now shown with
  the history made before the list is typed, which is the only way left to
  reach it. The race test's first half has the list wait for a receipt in
  flight, and then be refused at approval.
- **Gates:**
  - ruff, format and mypy are clean;
  - 27 import contracts are kept;
  - `alembic check` is clean.
- **E2E: 133 → 134,** on a fresh database. The new journey runs in the E2E
  seed's own empty warehouse, «Склад, що чекає»:
  1. a list is typed, and the screen says the warehouse waits;
  2. a delivery there is refused with the reason;
  3. the list is rejected;
  4. the delivery is received.

**Mutation testing — 11 mutants, all caught (backend 9, frontend 2).** Each
frontend mutant ran on a freshly seeded database, since the journey's last
receipt gives its warehouse a history.
- **Backend:**
  - nothing waits for a list, or a warehouse with history waits too;
  - a list holds nothing when kept;
  - a rejected or an approved list still holds its warehouse;
  - any list's decision lets the warehouse go;
  - the hold taken without the warehouse's lock;
  - the migration forgetting the lists already waiting, or holding decided
    ones.
- **Frontend:** the refusal not saying why; a waiting list not saying the
  warehouse waits.

## Not covered here

- **A list left waiting stops its warehouse** for as long as it waits.
  Nothing reminds anyone.
- **The order of the paper sales and the deliveries after the count** is in
  people's hands, as the owner decided.
- **Goods found later are ordinary receipts.** Nothing marks them as found.
- **Nothing has run in production.**

## Changed files

- New:
  - `backend/migrations/versions/0030_opening_list_hold.py`.
- Backend:
  - `inventory/models.py`, `repository.py`, `service.py`: the hold and the
    door;
  - `snapshots/service.py`: hold on keeping, let go on rejecting;
  - `core/errors.py`: `OPENING_LIST_PENDING`;
  - `scripts/seed_orders_e2e.py`: «Склад, що чекає».
- Frontend:
  - `src/openings/Openings.tsx`: the notice;
  - `src/shared/api.ts`: what the refusal says.
- Tests:
  - `test_snapshot_import.py`;
  - `test_migration_history_is_frozen.py`;
  - `e2e/openings.spec.ts`.
- Docs:
  - the server runbook, step 9;
  - the release checklist;
  - the README;
  - business rules;
  - the risk register;
  - ADR-0005 §12.
