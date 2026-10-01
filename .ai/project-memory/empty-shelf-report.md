# Nothing on the shelf (M1-030, Q-G) — 2026-10-01

Baseline: `72012c6` — the suggested price, merged as PR #47
([report](suggested-price-report.md)).
Status: implemented and verified locally. Migration `0022`, and `POST/GET
/api/v1/shelf-shortages`.
Branch: `feat/m1-030-empty-shelf`.

## Why this was next

Q-G had been open since M1-030. A seller who went for a coat and found none
had one honest move: remove the line by hand. That cost a tap while the
customer waited, and the ledger kept believing in a coat nobody could find.
The owner answered on 2026-10-01.

## The owner's decisions (2026-10-01)

Asked, not guessed; recorded in business-rules.md, "nothing on the shelf".

- **A line with nothing on the shelf is dropped from the basket, and the rest
  is sold.**
- **The shortage is recorded**, as «фізично відсутній» does for part of a
  line.
- **When nothing is left to sell, the shortage is still recorded, without a
  sale.**

It is for whoever may report goods missing — by default a manager and the
owner.

## What exists now

**Part of the basket empty — a sale.**
- `missing_in_store` now takes `quantity: 0`.
- The line stays in the request until every report is resolved against it,
  then leaves the sale.
- Its `MISSING_AT_SALE` movement names the sale, and the receipt lists only
  what was sold.
- A basket whose every line is empty is refused as `NOTHING_TO_SELL` before
  anything is locked. Recording it is the next command's job.

**All of it empty — an empty shelf, no sale** (`sales/shelf.py`).
- `POST /shelf-shortages` names the lines the seller went for. For each stock
  key, the ledger takes off what it believed in for this basket,
  `min(available, demand)`, and no more (I25).
- The movements name the new `shelf_shortage` row, and the command is
  audited.
- It takes the till's own authorities: `sale:create`, `inventory:report_
  missing_during_sale`, and a warehouse the store sells from. «Брак» is
  refused: nothing sells there.
- A balance an order holds is refused by the ledger (`RESERVED`), as at a
  sale.

**One basket, one outcome (I20).**
- The `shelf_shortage` row is the command's permanent identity.
- It shares the basket's `command_id` with sales, under the same lock. A
  basket that became a sale cannot become an empty shelf, and the other way
  round.
- A retry is answered with what was recorded. The row exists even when the
  ledger believed in none of it, so a late retry after a delivery takes
  nothing off.

**The app:**
- The shortfall panel offers «На полиці немає жодної». It says «продати
  решту» or «записати нестачу», depending on whether anything else in the
  basket is left to sell.
- The receipt names what was not sold.
- An empty basket ends on «Продажу немає», which says what the ledger took
  off for each line.
- The till's journal carries the empty shelf like a sale. One whose answer
  was lost is checked again from the pending banner and settles as «Продажу
  не було». It is never recorded twice.

**Downgrade:** `0022` refuses while any empty shelf is recorded. Its movements
stay in the ledger whatever happens, and without the row a retried basket
could take its stock off again.

## Evidence

- **Backend: 1113 passed, 1 skipped** (the `age` test, run by CI). 16 are
  new: 15 for the empty shelf, and 1 freezing `0021`. One M1-030 test
  changed: zero present was refused, and a basket of nothing present is now
  refused as no sale.
  - **The empty shelf's own tests:**
    - an empty line is dropped and the rest sold, and a retry is the same
      sale;
    - only what the ledger believed in is taken off;
    - a basket of nothing is not a sale, and still needs the shortage
      permission;
    - an empty shelf is recorded without a sale, audited and readable;
    - a retry after a delivery takes nothing off;
    - a sale or an empty shelf, never both, either way round;
    - the till's authorities, «Брак», and a reserved balance;
    - two retries at once record one empty shelf;
    - the request's bounds;
    - the downgrade refusing while one is recorded.
- **E2E: 82 passed against the real API**, 4 of them new:
  - a line dropped and the rest sold;
  - a basket of nothing recording the shortage;
  - a lost answer checked and not recorded twice;
  - no empty-shelf answer without the permission.

  One existing journey changed: its message now points to the new answer.
- **Gates:** ruff, format, mypy and all 19 import contracts are clean.
  `alembic check` reports no drift. The downgrade to base and back up is
  lossless on a fresh database. Frontend lint, types and build pass.

**Mutation testing — twenty, twenty caught (backend 14, frontend 6).**
- **The first run let two through.**
  - The location test used a warehouse the store cannot reach at all. It
    refused whatever the capability, so selling-only was never tested. It
    now tries the store's own «Брак», which receives and never sells.
  - The empty shelf's own reservation check repeated the ledger's. A
    reserved balance is held stock, so the ledger always sees it. The check
    is gone, and the ledger's guard is mutated instead.
- **Caught:**
  - zero still refused;
  - an empty line kept in the sale;
  - an all-empty basket sold;
  - more taken off than the basket;
  - a retry recorded twice;
  - a sale after an empty shelf, and the other way round;
  - the shortage permission, and the selling capability;
  - the ledger's reservation guard;
  - the audit;
  - a fingerprint blind to quantities;
  - a record read from another store;
  - the downgrade;
  - in the app:
    - never an empty shelf;
    - dropped lines not named;
    - no empty-shelf answer, or one offered to anyone;
    - a lost empty shelf left unsettled;
    - the journal refusing zero present.

## Not verified here

- **Nothing shows recorded empty shelves** beyond the ledger and the audit
  log.
- **PostgreSQL 17 was not re-run locally.** CI runs every test on it.
- **Nothing has run in production.**

## Changed files

- New:
  - migration `0022_shelf_shortage.py`;
  - `app/modules/sales/shelf.py`;
  - `tests/integration/test_empty_shelf.py`.
- `sales/service.py` — zero present drops the line; `NOTHING_TO_SELL`; the
  shared `lock_command`; a sale refused after an empty shelf.
- `sales/models.py` — `ShelfShortage`.
- `api/v1/sales.py` — `POST/GET /shelf-shortages`, and `quantity ≥ 0` on
  `missing_in_store`.
- Tests: `test_missing_at_sale.py`, and the frozen migrations list.
- Frontend:
  - `Sale.tsx`, `commands.ts` and `types.ts` in `src/sales/`;
  - `App.tsx`;
  - new: `e2e/shelf.spec.ts`; changed: `e2e/sale.spec.ts`.
- Docs:
  - business rules;
  - the risk register;
  - the M1-030 and till reports;
  - the milestone and the README.
