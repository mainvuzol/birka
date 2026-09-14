# M1B review fixes — 2026-09-14

Status: requested review defects fixed and locally verified. This is not approval of the complete M1B product gate or a production release.

Branch: `codex/fix-m1b-review-defects`; base `b73c015`.

## Resolutions

| Finding | Fix | Regression evidence |
|---|---|---|
| P1 repeated correction indices create excess stock | Reject repeated indices; aggregate basket demand and corrections by stock key | `test_sale_regressions.py`: duplicate correction and repeated-line cases |
| P1 correction uses stale stock | Lock whole basket before evaluating exact shortfall | Concurrent receipt before/after locking tests |
| P1 cross-organization variant/size links | Validate active store, variant and size ownership before materializing stock; validate lot ownership and exact key | 13 scope/locking tests; HTTP receipt foreign/missing references return 404 with no stock/lot/movement |
| P1 repeated receipt lines lose their acquisition costs | Separate lot per input line, map results by lot ID, preserve input order | Receipt qty2/cost100 and qty3/cost200 retain separate provenance; cached retry changes no stock |
| P2 permanent command retry returns 500 | Persist normalized request fingerprint and frozen response; serialize command duplicates | New cache key, removed cache, simultaneous matching/mismatched requests, legacy NULL fingerprint |
| P2 cached replay bypasses revoked permissions | Authorize before replay; require sale-view on both cached and permanent replay | Revoked create/view/correction cases |
| P2 correction subset locking causes deadlock | Lock all keys once in global order before correction and sale movements | Opposite correction subsets and reversed first-receipt baskets |
| P2 adjustment audit uses stale before-value | Derive before from locked movement result minus delta | Interleaved delivery yields audit11→12 instead of10→12 |
| P2 frozen descriptions omit distinctions | Preserve modeled labels and IDs including texture, fur, collar, category and explicit garment types | Three distinct-attribute tests confirm later catalog renames cannot change stored sale snapshots |
| Carryover P1 Sentry exception locals expose credentials | Disable local-variable collection while preserving error and stack metadata | Actual SDK event captured in memory; synthetic Telegram credential absent; demonstrated failing before fix |

Money service validation also rejects nonfinite, float, out-of-range and sub-kopeck amounts. Totals equal the sum of frozen lines. Existing historical sale snapshots are not rewritten from today's catalog.

## Changed implementation and tests

- API: `backend/app/api/v1/inventory.py`, `sales.py`.
- Catalog: `backend/app/modules/catalog/read.py`, new `validation.py`.
- Inventory: `backend/app/modules/inventory/service.py`, `repository.py`; new `backend/app/modules/tenancy/service.py`.
- Sales: `backend/app/modules/sales/service.py`, `models.py`.
- Telemetry: `backend/app/main.py`.
- Migration: `backend/migrations/versions/0003_sale_command_replay.py`.
- New tests: `test_inventory_scope_locking.py`, `test_inventory_api_regressions.py`, `test_sale_regressions.py`, `test_catalog_sale_snapshot.py` (integration); `test_sentry_privacy.py` (unit).
- Updated tests: `test_sale_command.py`, `test_m1b_schema_parity.py`. The latter projects the immutable 0002 baseline by excluding only the two explicitly migrated columns; full live migration drift checking still uses all current metadata.
- Documentation: ADR-0001 clarification, new ADR-0003, architecture-decisions index, project runtime commands, current milestone and this report.

The preexisting owner-confirmed optional item-code business rule is preserved. Private source images/transcriptions remain outside these code changes; no catalog import or uncertain merge was performed.

## Exact verification

From `backend/`, temporary Python3.12.14 environment `/tmp/birka-review-venv`, PostgreSQL16.2 at localhost55439:

```sh
BIRKA_TEST_DATABASE_URL=postgresql+asyncpg://birka_review@127.0.0.1:55439/postgres /tmp/birka-review-venv/bin/pytest -q
/tmp/birka-review-venv/bin/ruff check .
/tmp/birka-review-venv/bin/ruff format --check .
/tmp/birka-review-venv/bin/mypy app
/tmp/birka-review-venv/bin/lint-imports
BIRKA_DATABASE_URL=postgresql+asyncpg://birka_review@127.0.0.1:55439/postgres /tmp/birka-review-venv/bin/alembic check
```

Results: **254 passed, 0 skipped**, two existing dependency deprecation warnings; Ruff passed; 81 Python files formatted; mypy50 source files passed; import contracts8 kept/0 broken; Alembic no new upgrade operations detected.

Migration checks: upgraded existing synthetic review database from0002 to0003. In a separate disposable database, `alembic upgrade head`, `alembic downgrade base`, `alembic upgrade head`, `alembic check` all passed; disposable database removed afterward. No production data was touched.

Independent reviewer examined the final inventory/catalog/tenancy/sales/API/migration changes and regression assertions, finding no remaining actionable defects in the nine original findings. The reviewer did not independently approve their own Sentry patch; the primary agent inspected that patch and verified the actual-event regression. No independent runtime rerun was claimed.

## Deployment and limits

Run `alembic upgrade head` with the target `BIRKA_DATABASE_URL` before starting the updated backend. Revision `0003_sale_replay` is additive; existing sales retain NULL replay fields and safely return409 on an unverifiable command retry. Authorized GET remains available. See ADR-0003 for rollback implications.

No known unresolved defect remains in the requested review fixes. PostgreSQL17, Docker/production deployment and Telegram end-to-end verification were not run here. Frontend is unchanged and was checked in the preceding review. Product-creation API/full M1B exit is a separate outstanding gate requirement. Changes are local, uncommitted and not pushed; no release or full-gate completion is claimed.
