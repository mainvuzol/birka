# Stock view UI — 2026-09-29

Baseline: `3a66449`, snapshot import merged in PR #32 after evaluation PR #31.
Status: implemented and verified locally.
Bounded M1D/M1-025 increment: sellers can inspect stock without creating orders.
No commit, push or merge by the agent.

## Behavior

The new «Залишки» tab requires inventory:view. A person explicitly selects one
accessible warehouse; stock is never summed across stores sharing that warehouse.
The screen shows server-provided physical, reserved and available quantities,
size, and paginated products (50 per page). Paused/non-selling warehouses remain
readable when authorized, and fully reserved stock stays visible with available0.
Loading, empty, error, retry and refresh states are handled. Refresh rechecks
warehouse access; revocation clears the selection and stale data is hidden on
access errors. Query caches include organization/user/store scope and warehouse.
Existing pending-command navigation locks remain in force.

The stock-options response now includes additive `size_is_unknown`, derived from
the actual Size.is_unknown flag. The screen never infers unknown size from its
code: an ordinary ALPHA code UNKNOWN and an unknown-size state are different.
No schema migration or stock/money write. Existing API authorization enforces
private/shared warehouse boundaries.

## Changed files

- `frontend/src/inventory/Stock.tsx`: read-only screen.
- `frontend/src/App.tsx`: permission-gated navigation and scoped integration.
- `frontend/src/orders/types.ts`: additive response metadata.
- `backend/app/api/v1/catalog.py`: explicit unknown-size flag in stock options.
- `backend/tests/integration/test_order_read_api.py`: metadata regression tests.
- `frontend/e2e/stock.spec.ts`: mobile real-API flow and deterministic edge cases.
- Current milestone/plan: record PR #31/#32 merge and this local increment.

## Verification

- Stock/order read API integration file: **6 passed**, 0.78s, including three new flag/code cases.
- Full mobile Chromium suite: **28 passed**, 13.4s (23 existing +5 stock). Final stock-only rerun with server-quantity equality assertions also passed all5.
- Frontend lint, TypeScript and production build passed; mobile screenshot inspected, no horizontal overflow.
- Backend Ruff lint clean; **153 files** format-clean; `mypy app scripts`: **84 files** passed.
- Import-linter: **14 contracts kept, 0 broken**.
- Merged migrations through0015 applied successfully to a fresh disposable database. No new migration in this block.
- Python3.12/PostgreSQL16.2 C.UTF-8 in `/tmp`, port55442, database `birka_orders_ui`; fake seed only. No work data or global environment changes.
- `git diff --check` clean.

Independent frontend/API review found the size-code ambiguity before delivery;
fixed using server metadata and three regression cases. No remaining blocking
finding. Browser edge cases use routed responses for paused state, fully reserved
stock, unknown-size metadata, pagination and access revocation; the normal stock
flow uses the real API and disposable PostgreSQL.

Cleanup completed: test API and isolated PostgreSQL stopped; disposable database removed.

## Limits and next steps

This screen shows positive physical balances, not zero-stock catalog entries or
historical movements. No whole-catalog search, stock receipt, transfer, refund or
snapshot approval UI is added here. Those workflows and the release/restore drill
remain separate M1D increments. No real opening balances are imported; the owner
still decides whether to import them before launch. Full backend suite and
Docker/PostgreSQL17 were not repeated for this small read-response/UI change;
the merged M1-023 report contains the prior PostgreSQL17 verification evidence.
