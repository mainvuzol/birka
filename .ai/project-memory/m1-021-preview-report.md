# M1-021: read-only matching preview

Date: 2026-09-25. Baseline: `d7925a0` (M1-020 merged in PR #23).
Status: first preview stage implemented; **M1-021 as a whole remains partial**.

## Delivered

- `POST /api/v1/catalog/match-preview`: exact verified aliases, PostgreSQL
  trigram candidate ranking, explicit per-field compatibility/conflicts, five
  advisory decision types, lexical margin and review reasons. Raw input is
  returned exactly beside the pure parser result.
- Explicit family/concept/category context is validated. Conflicting context,
  inactive identities, ambiguous parsing or a truncated candidate pool cannot
  establish an existing identity. New variants require an explicitly selected
  family and recognized attribute differences without context/status conflicts.
- `GET /api/v1/catalog/duplicate-families`: potential duplicate signatures,
  including nullable signature fields, distinction notes and pagination.
  At most 100 families per signature are returned with an explicit truncation flag.
- Both endpoints require `catalog:confirm` for the supplied store and derive
  organization from the authenticated scope. All exposed catalog joins are
  tenant-scoped. Foreign alias targets cannot disclose foreign products.
- Every proposal requires confirmation; `resolved_variant_id` is always null.
  Neither endpoint commits catalog, aliases, decisions, inventory or money.
  A PostgreSQL read-only transaction test verifies this property.

## Files

- `backend/app/modules/catalog/matching.py`: service and conservative policy.
- `backend/app/api/v1/catalog_matching.py`, `router.py`: API contracts/authorization.
- `backend/migrations/versions/0012_catalog_trigram.py`: `pg_trgm` prerequisite.
- `backend/tests/integration/test_catalog_matching.py`: database/API regressions.
- `backend/tests/unit/test_migration_history_is_frozen.py`: pin shipped 0011.
- `backend/pyproject.toml`: parser cannot import mutable matching knowledge.

## Migration and review

Run `alembic upgrade head` before using the endpoints. Migration 0012 creates
`pg_trgm` if absent; the database server must provide that extension and the
migration role must be able to install it. Downgrade deliberately retains the
extension because it may predate Birka or have other dependents. No business
rows are rewritten.

Independent static review found category context could be ignored by an existing
variant proposal and conflicting concept/status could be ignored by a new
variant proposal. Both were corrected and context regression tests added.
Family garment type remains authoritative; concept metadata is not inherited.

## Verification

Verification uses an isolated PostgreSQL 16.2 on port 55442 and disposable
`birka_match_check` / `birka_match_migration` databases. The portable runtime
needed official PostgreSQL 16.2 `pg_trgm` compiled under `/tmp`; no system package,
work database or Docker resource was changed.

- `ruff check .`: passed.
- `ruff format --check .`: 126 files formatted.
- `mypy app scripts`: passed, 71 source files.
- `lint-imports`: 12 contracts kept, 0 broken.
- `alembic check`: no schema drift.
- Empty-database upgrade head → downgrade base → upgrade head: passed;
  subsequent `alembic check` passed.
- `pytest -q --tb=short`: **673 passed**, no skips, 2 dependency deprecation
  warnings, 25.60 seconds; includes 12 new matching integration tests.
- `git diff --check`: passed.

## Remaining scope and limits

This endpoint is a transient preview. `knowledge_fingerprint` identifies its
retrieval snapshot and context; it is **not** the durable monotonic
`knowledge_revision` required by persisted `CatalogMatchDecision`.
Decision persistence, revision management, confirmation/revalidation and
M1-022 alias feedback/promotion remain next. No automatic catalog creation,
merge, import, stock allocation or calibrated auto-match threshold is enabled.
The lexical score is not a probability. A missing label is unknown evidence.

Retrieval evaluates tenant variants and returns a bounded pool of 200. If more
exist, the response is explicitly ambiguous. Database scan cost is not bounded
by that response limit; large-catalog performance/index design and calibration
on human-confirmed matches remain unmeasured. PostgreSQL 17 and UI/E2E were not
rerun for this backend-only preview change; CI still needs to verify it there.
