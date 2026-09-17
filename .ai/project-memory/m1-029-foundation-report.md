# M1-029 — additive stock-location foundation, 2026-09-17

Status: **bounded foundation implemented and verified locally; M1-029 remains incomplete.**

## Scope and decision

The owner asked to establish the current development stage and continue. M1A/M1B are complete; M1C has the refund command. The pre-existing ADR-0004 draft correctly puts locations before M1-018 transfers. Four owner questions remain unanswered: existing child balances, shared-stock correction authority, sale source selection and refund destination.

To progress without deciding those questions, split the initial migration from the future stock re-key. `0005_stock_locations` creates only two empty tenancy tables. It does not backfill one location per store, grant access, disable ledger triggers or change any existing business table. Future re-key work must use a new revision, not extend this delivered migration. The complete ADR remains Proposed.

## Changed implementation

- `backend/app/modules/tenancy/models.py`: `StockLocation` and `StoreLocationAccess`.
- `backend/app/models_registry.py`: explicit registration/exports.
- `backend/migrations/versions/0005_stock_location_foundation.py`: additive migration from `0004_refund_replay`; downgrade locks both new tables and refuses if either contains rows.
- `backend/tests/integration/test_stock_location_foundation.py`: nine real database cases covering both cross-tenant endpoints, code/access uniqueness, missing flags, orphan locations and restricted deletion.
- `backend/tests/unit/test_m1b_schema_parity.py`: preserves the 30-table historical 0002 projection while checking 38 current tables. Historical migrations remain unchanged.
- Current milestone, ADR/design and roadmap updated to distinguish this foundation from the remaining stock migration.

## Integrity and security

Composite foreign keys bind both access endpoints to the declared organization. `can_sell` and `can_receive` have neither Python nor SQL defaults; capability values must be explicit. No HTTP route or provisioning path was added. No stock or financial writer changed, so existing concurrency/idempotency behavior remains the regression baseline. Independent static review found no correctness/security blocker for this bounded scope; it does not approve the future re-key.

## Verification

Used only the previously isolated Birka PostgreSQL 16.2 cluster under `/tmp/birka-m1b-review-pg`, port 55439, with a **new disposable database `birka_locations_review`**. No work database, Docker resource, image, host service configuration or other project was changed.

After verification, the new disposable database was removed and the temporary Birka cluster was stopped.

- Full backend suite: **370 passed, zero skipped**, two dependency deprecation warnings.
- Ruff lint and format: passed; **92 files** formatted.
- Mypy: **55 files**, no issues.
- Import boundaries: **9 contracts kept**, none broken.
- `alembic check`: no new operations/schema drift.
- Applied 0001–0004 to the new database, seeded synthetic stock/sales/refunds through regression tests, then verified **0004 → 0005 → 0004 → 0005**. Compared every row of all 36 legacy tables and ledger trigger state: identical.
- New tables empty immediately after upgrade: no implicit locations/grants.
- Downgrade with a location, and then with location plus access: both refused; rows and migration revision retained.
- Verification artifact: `output/verification/2026-09-17-stock-locations/migration_check.py`; full-suite log alongside it. The script accepts only this fixed disposable database and expects revision 0004 with synthetic business data; it is not an application or deployment tool.

An initial regression run overlapped implementation edits and caught an overlong PostgreSQL FK identifier plus the old schema-count projection. Both were fixed before the final passing run. No old test was weakened and 0002 SQL was not rewritten.

## Remaining work and release limits

1. Obtain Q-A…Q-D answers; finalize the full ADR and legacy-data handling.
2. Build the new backfill/re-key revision together with inventory, sale, refund, read-access and replay changes. Do not split the stock key switch from its service changes.
3. Prove shared-stock contention, permission revocation, refund destination and migration preservation; run PostgreSQL 17 CI/Compose for this new revision.
4. Then implement M1-018 location transfers; grant real shared access only after owner-approved data reconciliation.

This change has **not** been retested in Docker/PostgreSQL 17; the earlier report applies to the prior baseline. No frontend change, Telegram E2E, production deploy, commit, push or merge was performed. Roll back application code while retaining the additive schema if new location data exists; migration downgrade deliberately refuses to delete it.
