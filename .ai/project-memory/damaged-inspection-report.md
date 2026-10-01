# The «Брак» section (M1-027) — 2026-10-01

Baseline: `5b4698d` — the returns at the till, merged as PR #45
([report](till-returns-report.md)).
Status: implemented and verified locally. Migration `0020`, the permission
`damaged:handle`, and `GET/POST /api/v1/damaged-units`.
Branch: `feat/m1-027-damaged-inspection`.

## Why this was next

The returns put damaged units in the store's «Брак», and nothing could take
them out again. A transfer needs `can_sell` at its source, and nothing sells
from «Брак». The owner decided what happens there the same day.

## The owner's decisions (2026-10-01)

Asked, not guessed; recorded in business-rules.md, "what happens in «Брак»".

- **Anyone who takes returns** — a seller, a manager or the owner — may take a
  unit in «Брак» for inspection. Then they either:
  - put it back on sale; or
  - keep it as «брак підтверджений».
- **A unit goes back to the warehouse it was sold from.** The person is shown
  it and confirms.
- **«На перевірці» is a status the others see**, as long as it does not
  clutter the app.
- **A confirmed unit stays in «Брак», no longer for sale.** People look
  through «Брак» from time to time and decide its fate. Anyone who takes
  returns may write it off.
- **Stock in «Брак» changes only through returns and this section.**

## What exists now

**One row per unit** (`damaged_unit`), registered by the refund command in
the return's own transaction.

```
AWAITING ──take──▶ INSPECTING ──back on sale──▶ RETURNED
    ▲                  └──confirm──▶ CONFIRMED ──write off──▶ WRITTEN_OFF
    └────────take again─────────────────┘
```

- **«На перевірці» names who took it.** A unit can be taken only while it
  is waiting or confirmed, so two people never start on one. Anyone may
  finish a unit someone else took, so a unit is never stranded by someone
  who has gone home.
- **Back on sale is a transfer** out of «Брак» into the warehouse the unit
  was sold from, and only there. It goes through the transfer command's own
  core, which `transfers.create_transfer` now shares as `move_goods`. The
  ledger writes the same pair, locks and audit as any transfer (I24).
- **Write-off is a stock adjustment** with reason «Пошкоджено». It goes
  through the stock correction's own core, which the correction endpoint now
  shares as `inventory.record_adjustment` (ADR-0007).
- **The row names the ledger fact that took the unit out** (the transfer or
  the adjustment), and the database holds that it does.
- **Every step is safe to press twice.** The unit's row is locked, and a step
  that finds the unit already where it leads answers with it as it is. A step
  that finds it anywhere else is refused with `DAMAGED_UNIT_CHANGED` and what
  it found. The ledger's own command ids are derived from the unit and the
  step, so not even a second transaction could move a unit twice.
- **The only doors to «Брак».** `inventory.apply_movements` refuses any
  movement at a store's «Брак» (`DAMAGED_STOCK_CLOSED`), unless the caller
  is a return taken damaged or this section. That covers deliveries,
  transfers, stock corrections and stock lists, so the units still in
  «Брак» always add up to what it holds.
- **`damaged:handle`** is in the seller's default role, as the owner
  decided. `0020` grants it to every role that holds `sale:refund`, whatever
  the role is called.
- **Returns taken damaged before `0020`** get their rows, waiting.

**The app:**
- **A «Брак» tab** with three groups — waiting, being inspected (with who and
  since when), and confirmed — each unit showing where it was sold from.
  «Повернути в продаж» asks to confirm the warehouse by name. «Брак
  підтверджений» and «Списати» take an optional note.
- **The stock screen** says what «Брак» is, and offers no correction there.

## Evidence

- **Backend: 1080 passed, 1 skipped** (the `age` test, run by CI). 12 are
  new: 10 for the section, 1 for the permission, and 1 freezing `0019`.
  - **The section's own tests:**
    - one row per unit;
    - who is looking, visible to the others;
    - back on sale only to where it was sold;
    - nothing leaves before someone has looked;
    - confirm, then write off;
    - a second look;
    - every other door to «Брак» refused;
    - the permission;
    - two people at once, moving the unit once;
    - the migration's backfill and grant.

    Each checks that the units still in «Брак» equal its stock, and that
    the ledger reconciles.
  - **Two existing tests were changed.**
    - One replaced the ledger door inside the correction endpoint, which now
      lives in `inventory`.
    - One found "the shared warehouse" by its lack of a managing store,
      which each store's «Брак» also lacks. On PR #45 that made CI fail at
      random; the fix is on #45 too.
- **E2E: 73 passed against the real API**, 5 of them new:
  - back on sale, checked in both warehouses' real balances;
  - confirmed with a note, then written off;
  - someone else getting there first;
  - the permission;
  - the stock screen.
- **A flaky journey fixed on the way.** On this PR's first CI run, a size
  journey from PR #42 failed once: "Response has been disposed". After a sale
  the app reads the shelf again, and the test's route handler was still
  answering that request when the page closed. Every spec now imports `test`
  from `e2e/fixtures.ts`. It waits for running route handlers before the
  context closes, and ESLint refuses Playwright's own `test` in a spec.
  - With the handler held back, the plain `test` cut off the second answer.
    The fixture let both finish.
  - The full suite passed twice on a fresh seed.
- **Gates:** ruff, format, mypy and all 19 import contracts are clean (two
  new). `alembic check` reports no drift. The downgrade to base and back up
  is lossless. Frontend lint and types pass.

**Mutation testing — nineteen, nineteen caught (backend 17, frontend 2):**
- the guard removed;
- a return unable to fill «Брак»;
- units not registered, or one row per part;
- each of the state machine's refusals and replays;
- back on sale anywhere;
- write-off with the wrong reason;
- the unit not locked;
- either permission check;
- the migration's grant and backfill;
- the stock screen offering a correction in «Брак»;
- the tab shown without the permission.

## Not verified here

- **A return to the supplier has no step of its own.** It is a write-off
  with a note until the owner wants more.
- **Nothing has run in production.**

## Changed files

- New:
  - migration `0020_damaged_units.py`;
  - `app/modules/damaged/` (models and service);
  - `app/api/v1/damaged.py`.
- `transfers/service.py` — `move_goods` extracted from `create_transfer`.
- `inventory/service.py` — the «Брак» guard and `record_adjustment`; the
  correction endpoint uses the latter.
- `refunds/service.py` — registers the units.
- Supporting changes:
  - `authz/permissions.py` — `damaged:handle`;
  - `core/errors.py` — two errors;
  - `tenancy/service.py` and `identity/service.py` — name lookups.
- Tests:
  - new: `test_damaged_units.py`;
  - changed: `test_authz.py`, `test_inventory_api_regressions.py` and the
    frozen migrations list.
- Frontend:
  - new: `src/damaged/` and `e2e/damaged.spec.ts`;
  - changed: `App.tsx`, `Stock.tsx`, `Returns.tsx` and `styles.css`;
  - E2E: new `e2e/fixtures.ts`, each spec's `test` import, and a rule in
    `eslint.config.js`.
- Docs:
  - business rules and the risk register;
  - ADR-0001 and ADR-0004 (amendments);
  - the milestone and the README.
