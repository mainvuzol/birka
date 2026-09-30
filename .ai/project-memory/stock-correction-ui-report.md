# A manager corrects a balance from the stock screen (M1-025) — 2026-09-30

Baseline: `8e22396` (purchase cost on receiving, PR #38).
Status: implemented and verified locally. No migration.
Branch: `feat/m1-025-stock-correction`.

## Why this was next

M1-025's last flow. A correction could be made only through the API, and
safely only since ADR-0007 gave it a permanent identity. A manager who finds
a shelf that disagrees with the system had no way to say so from the app.

## What a manager can now do

In «Залишки», on a warehouse where the store may correct stock, each balance
offers **«Виправити залишок»**. It opens under the balance it corrects and
asks for a reason first, because the number a person knows depends on it:

| Reason | What is asked | What is sent |
|---|---|---|
| Перерахунок (`STOCKTAKE`) | what the shelf holds | the difference, **and the balance it was worked out from** |
| Пошкоджено, Втрачено | how many to write off | the change only |
| Помилка обліку, Інше | add or write off, and how many | the change only |

The screen shows `10 → 8 (−2)` before anything is sent, and the server's own
before and after once it is written.

**Goods the system holds none of** cannot appear in a list of balances.
«Знайшли товар, якого немає в списку» finds them in the catalogue — the
receiving screen's search, now a shared `CatalogPicker` — and counts them
against zero. If they turn out to be held after all, on another page or
received meanwhile, the server says how many and the form carries on as an
ordinary stocktake against that.

## The one API change: a count carries its balance

`POST /inventory/adjustments` takes an optional `expected_quantity`. Given,
the correction applies only while the warehouse still holds exactly that
many, compared under the stock lock; otherwise it is refused as
**`STOCK_CHANGED`** (409, `details.expected` and `details.actual`) and
nothing is written.

Why it was needed rather than nice: the API takes a change, and a stocktake
knows a count. A screen that turns "the shelf holds 3, the system says 5"
into −2 and sends it after a sale has taken a coat applies −2 to 4, and the
ledger records a coat going missing that nobody saw go. The workflow
(`.ai/workflows/inventory-adjustment.md`) already required a test of a
concurrent adjustment against a stock write; there is now one, and it fails
if the comparison moves outside the lock.

- It is a precondition, not part of the command's identity: a late retry is
  answered from the permanent record (ADR-0007) **before** any balance is
  compared, so a correction that did apply is never told to recount.
- Omitted, nothing changes. Write-offs omit it on purpose.
- The adjustment refusal for a reserved balance now carries the till's
  details (`reason: RESERVED`, the key, `reserved`), so the screen can say an
  order holds the stock rather than a generic 422.

## Decisions made here, not by the owner

None of these is a business rule; each follows from one already recorded.

- **The at-the-counter reasons are not offered.** `FOUND_DURING_SALE` and
  `MISSING_AT_SALE` record what a seller saw during a sale, and how often
  they happen is a signal the owner measures (the `MovementReason`
  docstring). A manager's stocktake under either would pollute it.
- **Write-offs only reduce, and a size not known is only reduced.** "Damaged"
  that adds stock means nothing; "size not known" enters only from a legacy
  list (ADR-0005 §3), which the server enforces too.
- **A reserved balance offers no correction** and says why — the server
  refuses it, and the balance may be corrected after the order is dispatched
  or released.
- **Correction appears only where the store has `can_receive`** at an active
  warehouse, which is what the server requires.

## A third journal, so the protocol is shared

The receiving report said to extract the journal "when a third appears, not
before". This was the third. `@/shared/journal` now holds the protocol for
receipts and corrections — written down before sending, a definite refusal
clears it, anything else blocks the app until the identical attempt is
resent. The till keeps its own, because a sale is read back by id once
acknowledged. The receipt journal's own browser tests are what proved the
extraction safe, and one mutation below is caught by both.

## Verification

- **944 backend tests passed**, 0 skipped (937 + 7 new). Ruff, format
  (161 files), mypy (85 files), import-linter clean; `alembic check` reports
  no drift.
- **50 Playwright tests** on mobile Chromium against the real API (42 + 8
  new), after a fresh seed. ESLint, `tsc`, production build clean.
- The seed gained a third warehouse, «Склад перерахунку», and a size `L`
  held nowhere, so correction tests change nothing another spec reads. One
  till test assumed the fixture had exactly two warehouses; it now says so
  itself.

**Mutation testing — ten, ten caught**, each by the intended test:

| Mutation | Caught by |
|---|---|
| The count is never compared | the moved-balance and under-the-lock tests |
| The count is compared outside the lock | `test_the_count_is_compared_under_the_lock` only |
| The count is judged before the permanent answer | `test_a_late_retry_gets_its_answer_even_after_the_balance_moved` |
| The reservation refusal names nothing | `test_a_reserved_balance_is_refused_and_says_how_much_is_reserved` |
| A stocktake is sent without its balance | four browser tests, including the moved-balance one |
| A stocktake sends the count as the change | the stocktake browser test |
| After `STOCK_CHANGED` the form judges from the stale balance | the moved-balance and found-but-held browser tests |
| The correction is offered without `inventory:adjust` | the permission browser test |
| Recovery resends under a fresh key (shared journal) | the correction **and** the receipt unknown-outcome tests |
| A size not known may be counted upwards | the reserved / size-not-known browser test |

## Changed files

- `backend/app/api/v1/inventory.py` — `expected_quantity`, the guard under
  the lock, fingerprint docstring.
- `backend/app/core/errors.py` — `StockChangedError`.
- `backend/app/modules/inventory/service.py` — details on the reservation
  refusal.
- `backend/tests/integration/test_adjustment_screen_contract.py` — new, 7.
- `backend/scripts/seed_orders_e2e.py` — third warehouse, size `L`.
- `frontend/src/shared/journal.ts` — new, the shared protocol.
- `frontend/src/inventory/{Correction.tsx,CatalogPicker.tsx,adjustmentCommands.ts,adjustmentTypes.ts}` — new.
- `frontend/src/inventory/{Stock.tsx,Receive.tsx,receiptCommands.ts}`,
  `frontend/src/App.tsx`, `frontend/src/styles.css`.
- `frontend/e2e/correct.spec.ts` — new, 8; `frontend/e2e/sale.spec.ts` — one
  test pinned to two warehouses.

## Limits

- **M1-025 is not complete.** Its flows all exist now, but the till still
  does not offer `size_clarified` — a "size not known" coat given its size at
  the counter, implemented in the backend since M1-023. *Done 2026-09-30:*
  see the [size at the till report](size-clarified-ui-report.md).
- One balance at a time; no bulk stocktake of a warehouse.
- Finding goods the system holds none of needs `inventory:receive` too.
- PostgreSQL 17 not re-run: no migration, and the one new SQL path is the
  existing stock lock.
