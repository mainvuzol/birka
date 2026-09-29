# A stock adjustment becomes a business operation — 2026-09-30

Baseline: `9feb2c6` (receipt command identity, PR #36).
Status: implemented and verified locally. Migration `0017_stock_adjustment`.
Decision: [ADR-0007](../decisions/ADR-0007-stock-adjustment-command-identity.md),
owner-confirmed 2026-09-30.

## What was wrong

Recorded as open in ADR-0006 and reproduced there: a `STOCKTAKE` of +7 sent to
`POST /inventory/adjustments`, replayed with its original Idempotency-Key after
the 7-day record was gone, left 14. It was the last stock-writing command
outside invariant I20, and it blocked the quick-correction screen from using a
durable client journal — the one pattern that reaches past seven days.

## What changed

The owner chose the option that matches the rest of the system: an aggregate
row, as for a receipt or a transfer.

- `stock_adjustment` holds what the ledger cannot say — warehouse, acting
  store, actor, permanent `command_id`, note, fingerprint and the answer given.
- The one `stock_movement` an adjustment writes now names it
  (`reference_type = 'stock_adjustment'`). Before, a manual correction's ledger
  row named nothing, and its note lived only in an audit entry.
- `command_id` is required; the response carries the adjustment's `id`.
- The permanent fingerprint covers the stock facts and **not the note**: a
  reworded note under the same command is a retry and gets the original
  answer; another amount, reason or warehouse is refused.

**One replay function for both commands.** The durable-replay logic written
for receipts in PR #36 would otherwise have been copied line for line; it is
now one helper, `_permanent_answer`, used by both. The six receipt tests are
what proved that refactor safe.

## Verification

- **925 backend tests passed**, 0 skipped (916 + 8 new + the frozen-history
  check for `0016`, which shipped in PR #36 and is now frozen).
- **17 revisions** apply, downgrade to base and re-apply on a clean database;
  `alembic check` reports no drift.
- Ruff, format (159 files), mypy (85 files), import-linter clean.

**Mutation testing — five, five caught:**

| Mutation | Caught by |
|---|---|
| The permanent record is never consulted | the reproduction, the new-key test, all three conflict cases |
| The note joins the fingerprint | `test_a_reworded_note_is_still_the_same_correction` |
| The warehouse leaves the fingerprint | the conflict test's *another warehouse* case |
| The ledger row does not name its adjustment | `test_the_ledger_row_names_the_adjustment_that_caused_it` |
| The answer is not frozen on the permanent record | the reproduction, the new-key and reworded-note tests |

## Changed files

- `backend/migrations/versions/0017_stock_adjustment.py` — new.
- `backend/app/modules/inventory/models.py` — `StockAdjustment`.
- `backend/app/api/v1/inventory.py` — required `command_id`, fingerprint, the
  shared replay helper, the row, the ledger reference, `id` on the response.
- `backend/app/models_registry.py`.
- `backend/tests/integration/test_adjustment_command_identity.py` — new, 8 tests.
- `backend/tests/unit/test_migration_history_is_frozen.py` — froze `0016`.
- 5 test files — `command_id` on every adjustment payload.
- ADR-0007; ADR-0006, the plan's I20, business rules and the risk register.

## What this unblocks

I20 now covers every command that writes stock through the API. The quick
correction screen — the last M1-025 flow — can use the same durable journal as
the till and the receiving screen. It is a manager's screen: the default
seller does not hold `inventory:adjust`, and their quick corrections are the
bounded in-sale ones the till already offers.
