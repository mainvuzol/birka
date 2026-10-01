# M1-030 — «фізично відсутній»: the bounded negative correction — 2026-09-17

The owner answered the one open question on 2026-09-17: **the sale proceeds for the quantity that is actually there.** This is what that turned into.

## 1. What it does

A seller goes for two coats and finds one. They confirm *"one is here"*. The sale is made for one, the customer pays for one, and the unit the system believed in is removed from that warehouse by a negative `ADJUSTMENT` with reason `MISSING_AT_SALE` — in the sale's own transaction, audited with before and after.

The seller states **how many are present**, never the size of the shortage. Counting what you can see is a different cognitive act from subtracting, and only one of them puts off-by-one errors into a ledger.

## 2. Why it is safe to give someone

The positive half, `FOUND_DURING_SALE`, is safe because it is capped at the shortfall of the line being sold (invariant I18). The negative half has no such cap by nature — "the shelf is emptier than you think" is a statement about a whole shelf — so it carries two bounds, and both are enforced as **invariant I25**:

- **the line being sold.** Sell two, find one, and at most one unit can be written down. A seller who opens a drawer expecting fifty and finds it empty cannot record that here: that is a stocktake, `inventory:adjust`, manager or owner.
- **what the ledger already believed.** The correction is `min(available, demand) − confirmed`, and nothing is written unless that is positive. The system may only remove stock it thought was there.

The second bound was missing from the original proposal and is the more important one. Without it the same field could drive a balance negative, or — when a seller confirms *more* present than the ledger holds — quietly add stock through the path meant for removing it, bypassing the found-in-store permission entirely.

It is **not a write-off.** `MISSING_AT_SALE` is deliberately neither `LOST` nor `DAMAGED`: at the counter nobody knows whether the coat was stolen, misfiled, already sold, or standing in the other warehouse. The reason records what was observed and stops there. Its own code also keeps the question "how often does the shelf disagree with the app, and where?" answerable — the same reason `FOUND_DURING_SALE` is its own code.

## 3. Who may do it

A new capability, `inventory:report_missing_during_sale`, and it is **not in the default seller role**. It is not implied by `inventory:correct_during_sale` — putting goods on a shelf and taking them off are different authorities — and not implied by reaching the warehouse. Managers and owners have it because they already hold the unbounded `inventory:adjust`, so it adds nothing there. Whether a given seller gets it is a role edit, which is a deliberate act by the owner: roles are rows.

## 4. Changed files

**New:** `backend/migrations/versions/0007_missing_at_sale.py` (one enum value, nothing else); `backend/tests/integration/test_missing_at_sale.py`; this report.

**Changed:** `app/modules/inventory/models.py` (the reason), `app/modules/authz/permissions.py` (the capability and the manager default), `app/modules/sales/service.py` (`MissingInStore`, `_validate_reports`, `_resolve_shortages`, the fingerprint, the audit split, `SaleResult.shortages`), `app/modules/inventory/{service,repository}.py` (`sale_shortage_ids`, and one reason-narrowed query in place of two), `app/api/v1/sales.py` (`missing_in_store`, `shortages`, the permission check), `tests/unit/test_authz.py`, `tests/integration/test_shared_warehouse.py`, `tests/unit/test_migration_history_is_frozen.py` (0006 frozen now that it has shipped).

## 5. Verification

Isolated PostgreSQL 16.2, disposable database.

| Check | Result |
|---|---|
| Full backend suite | **415 passed, 0 skipped** (16 new in `test_missing_at_sale.py`, 3 new shared-warehouse cases, 1 new authz case) |
| `ruff check` / `ruff format --check` | clean, 98 files |
| `mypy app` | 55 source files, no issues |
| `lint-imports` | 9 contracts kept, 0 broken |
| `alembic check` | no drift |
| Migration `0007` | applies, `alembic check` clean, `downgrade` → `upgrade` round trip clean |

**Five deliberate mutations, five caught.** Removing the ledger bound (`min(available, demand)` → `available`) fails 8 tests; turning `shortfall <= 0` into `== 0` fails the test that proves this path can never add stock; dropping the permission check, dropping `missing_in_store` from the permanent fingerprint, and removing the present-and-missing contradiction rule each fail their own test.

**PostgreSQL 17 is not verified for this change set.** The 2026-09-17 isolated Docker run covers M1-029, not `0007`. `0007` adds an enum value and no behaviour that differs between 16 and 17, but that is an argument, not evidence.

## 6. Open

- **A line where nothing is present is refused**, not dropped from the basket, so the "last coat, empty rack" case still records nothing. Reasoning and the alternative are in [`physically-absent-proposal.md`](physically-absent-proposal.md) §7. Owner's call; small change either way.
- `POST /sales` p95 is still unmeasured against the 500 ms budget — unchanged by this work, and still owed from M1-029.
- Transfers (M1-018) remain unimplemented and are still the next task.

## Update — 2026-10-01: nothing on the shelf (Q-G)

This report left one case open: a line with nothing present was refused
(`physically-absent-proposal.md` §7). The owner answered it:
- **A line with nothing present is dropped from the sale and its shortage
  recorded.** The rest of the basket is sold.
- **When nothing is left to sell, the shortage is recorded without a sale**,
  by its own command under the basket's `command_id`.

See the [empty shelf report](empty-shelf-report.md).
